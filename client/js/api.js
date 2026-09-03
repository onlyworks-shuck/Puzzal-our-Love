const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

// Must match MAX_CHUNK_BYTES in api/_lib/mediaLimits.js — files at or under
// this go through one plain upload request; anything bigger is split into
// pieces this size so it never trips the server's per-request body cap (a
// real phone video easily exceeds that cap).
const MAX_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;

// Must match MAX_TOTAL_BYTES in api/_lib/mediaLimits.js. Checked up front so
// an oversized file is refused immediately with a message that says what is
// wrong, instead of uploading every piece and only failing at the last step.
const MAX_MEDIA_TOTAL_BYTES = 100 * 1024 * 1024;

// How many pieces of one file are fetched at once when reading media back.
// Unbounded parallelism meant a large video opened every request together
// and held the whole file in memory at once, which is what made big videos
// stall or crash the tab on phones.
const MEDIA_FETCH_CONCURRENCY = 3;

// How many separate media items are fetched at once, across the whole chat.
// Opening the room builds every row in the window in one pass, and each row
// carrying an attachment started its own download there and then — thirty
// photos and videos all reaching for the network in the same moment. A
// browser only runs a handful of requests per origin at a time, so everything
// else queued behind them: a voice note arriving right then waited on
// megabytes of unrelated video before its own few KB were even requested.
const MEDIA_ITEM_CONCURRENCY = 4;

// Ordering within that queue, highest first. A voice note is small, it was
// just spoken to you, and there is nothing to look at while it loads — so it
// goes ahead of the photo backlog rather than behind it.
const MEDIA_PRIORITY = { audio: 2, image: 1, video: 0 };

// A media request that never settles has to be given up on rather than left
// holding one of the four slots above forever — a phone that walks out of
// signal mid-request stalls the socket rather than failing it, and four of
// those would wedge every remaining attachment in the room. Generous enough
// that a 4MB piece on a slow connection still finishes; abandoning is treated
// as a transient fault, so the attempt is simply made again.
const MEDIA_REQUEST_TIMEOUT_MS = 45000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A single dropped request shouldn't cost the whole upload — on a phone
// connection one piece of a twenty-piece video failing is routine.
async function withRetry(operation, { attempts = 3, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      // A rejection from the server (too large, wrong type, locked) will
      // fail again identically, so only transient network faults retry.
      if (!err.isNetworkError) throw err;
      if (attempt < attempts - 1) await delay(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

// Items waiting for a slot. Ties break towards the most recently queued one:
// on opening the chat that is the newest message — the one actually on
// screen — and afterwards it is whatever just arrived, which is exactly what
// someone is sitting there waiting to see.
const mediaQueue = [];
let mediaInFlight = 0;
let mediaSeq = 0;

function pumpMediaQueue() {
  while (mediaInFlight < MEDIA_ITEM_CONCURRENCY && mediaQueue.length > 0) {
    let best = 0;
    for (let i = 1; i < mediaQueue.length; i++) {
      const candidate = mediaQueue[i];
      const leader = mediaQueue[best];
      if (
        candidate.priority > leader.priority ||
        (candidate.priority === leader.priority && candidate.seq > leader.seq)
      ) {
        best = i;
      }
    }
    const job = mediaQueue.splice(best, 1)[0];
    mediaInFlight++;
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        mediaInFlight--;
        pumpMediaQueue();
      });
  }
}

function queueMediaFetch(run, kind) {
  return new Promise((resolve, reject) => {
    mediaQueue.push({
      run,
      resolve,
      reject,
      priority: MEDIA_PRIORITY[kind] ?? MEDIA_PRIORITY.image,
      seq: mediaSeq++
    });
    pumpMediaQueue();
  });
}

// A failed media request used to be final: the row was marked broken and the
// file was never asked for again for the rest of the session, so one dropped
// request on a phone connection meant a voice message that simply never
// appeared for the person it was sent to. Transient faults are retried here
// before the caller ever hears about them.
function isTransientMediaError(err) {
  return !!err && (err.isNetworkError === true || (err.status >= 500 && err.status <= 599));
}

async function fetchMediaWithRetry(url, headers, { attempts = 3, baseDelayMs = 400 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      let res;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MEDIA_REQUEST_TIMEOUT_MS);
      try {
        res = await fetch(url, { headers, signal: controller.signal });
      } catch (err) {
        // Covers both a refused connection and a request abandoned by the
        // timeout above; either way the next attempt is worth making.
        const networkError = new Error('Could not load media');
        networkError.isNetworkError = true;
        throw networkError;
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const error = new Error('Could not load media');
        error.status = res.status;
        throw error;
      }
      return res;
    } catch (err) {
      lastError = err;
      // Locked (401) and erased (404) answer the same way however often they
      // are asked, so only a fault that could plausibly clear is retried.
      if (!isTransientMediaError(err)) throw err;
      if (attempt < attempts - 1) await delay(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

const Storage = {
  getToken: () => localStorage.getItem('wc_token'),
  setToken: (token) => localStorage.setItem('wc_token', token),
  clearToken: () => localStorage.removeItem('wc_token'),
  getUser: () => {
    const raw = localStorage.getItem('wc_user');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      // A half-written or hand-edited value used to throw synchronously out
      // of every session attempt, including the retries — so the app could
      // never recover from it without the person clearing site data. Treat
      // it as no stored user instead, which registers a fresh one.
      return null;
    }
  },
  setUser: (user) => localStorage.setItem('wc_user', JSON.stringify(user)),
  clearUser: () => localStorage.removeItem('wc_user')
};

async function apiRequest(path, { method = 'GET', body, isForm = false, keepalive = false } = {}) {
  const headers = {};
  const token = Storage.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!isForm && body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      keepalive,
      body: isForm ? body : body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    // fetch() itself throws when the server can't be reached at all (not
    // running, wrong URL, CORS blocked, offline) — a completely different
    // problem from the server responding with an error, so callers need to
    // be able to tell the two apart instead of both looking like the same
    // generic failure.
    const networkError = new Error('Could not reach the server. Is it running?');
    networkError.isNetworkError = true;
    throw networkError;
  }

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }

  if (!res.ok) {
    // The status is carried on the error so callers can tell a genuine
    // rejection (a wrong password is a 401) apart from the server being
    // broken or misconfigured (5xx). Without it both look identical, and
    // an outage gets counted against the user as failed attempts.
    const error = new Error(data?.error || `Request failed with status ${res.status}`);
    error.status = res.status;
    // Some failures are neither the caller's fault nor transient — a
    // deployment missing JWT_SECRET or the chat passwords can only ever
    // fail, however many times it is retried. Those answers carry a `code`,
    // and it travels with the error so the UI can say something true
    // instead of blaming the connection.
    error.code = data?.code || null;
    throw error;
  }

  return data;
}

function buildQuery(params) {
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

const Api = {
  register: (username, password, displayName) =>
    apiRequest('/auth/register', { method: 'POST', body: { username, password, displayName } }),

  getMe: () => apiRequest('/users/me'),

  unlockSecret: (password) => apiRequest('/secret/unlock', { method: 'POST', body: { password } }),

  // Small/plain single-request upload. For files over MAX_MEDIA_CHUNK_BYTES,
  // use uploadSecretMediaAuto() instead — this will fail against the
  // server's per-request size cap.
  uploadSecretMedia: (file) => {
    const form = new FormData();
    form.append('media', file);
    return apiRequest('/secret/media', { method: 'POST', body: form, isForm: true });
  },

  // Splits large files into pieces and sends them one at a time so big
  // videos never hit the server's request-size limit. Each piece retries on
  // a network fault, so one blip partway through a long upload doesn't
  // discard the pieces already stored.
  uploadSecretMediaChunked: async (file, onProgress) => {
    // The id doubles as the permanent media id, and the server requires a
    // real uuid because deletion derives its storage keys from it.
    const uploadId = crypto.randomUUID();
    const totalChunks = Math.max(1, Math.ceil(file.size / MAX_MEDIA_CHUNK_BYTES));

    for (let i = 0; i < totalChunks; i++) {
      const start = i * MAX_MEDIA_CHUNK_BYTES;
      const slice = file.slice(start, start + MAX_MEDIA_CHUNK_BYTES);
      await withRetry(() => {
        // Rebuilt per attempt: a FormData body is consumed once a request
        // has read it, so reusing one across retries would send nothing.
        const form = new FormData();
        form.append('uploadId', uploadId);
        form.append('index', String(i));
        form.append('chunk', slice);
        return apiRequest('/secret/media-chunk', { method: 'POST', body: form, isForm: true });
      });
      onProgress?.((i + 1) / totalChunks);
    }

    return withRetry(() =>
      apiRequest('/secret/media-finish', {
        method: 'POST',
        body: { uploadId, totalChunks, mimeType: file.type, totalSize: file.size }
      })
    );
  },

  // Picks the right upload path based on file size — callers never need to
  // know about the chunking threshold.
  uploadSecretMediaAuto: (file, onProgress) => {
    if (file.size > MAX_MEDIA_TOTAL_BYTES) {
      const mb = (n) => `${(n / 1024 / 1024).toFixed(1)}MB`;
      return Promise.reject(
        new Error(`This file is ${mb(file.size)} — the limit is ${mb(MAX_MEDIA_TOTAL_BYTES)}.`)
      );
    }
    if (file.size === 0) {
      return Promise.reject(new Error('This file is empty.'));
    }
    if (file.size <= MAX_MEDIA_CHUNK_BYTES) {
      return withRetry(() => Api.uploadSecretMedia(file));
    }
    return Api.uploadSecretMediaChunked(file, onProgress);
  },

  // No params: most recent window. { since } for incremental polling
  // (only new messages + ids deleted since that cursor). { before, limit }
  // for loading older history.
  getSecretMessages: (params) => apiRequest(`/secret/messages${buildQuery(params)}`),

  // Out-of-band live state: leaving the chat, and acknowledging messages the
  // moment they are seen. While the chat is open the message poll carries both
  // signals itself, so this is only for the edges the poll cannot reach.
  // keepalive lets the "I'm leaving" call still go out from a page that is
  // being closed or backgrounded, which a normal fetch would cancel on the way
  // out.
  updateSecretSession: (payload, { keepalive = false } = {}) =>
    apiRequest('/secret/session', { method: 'POST', body: payload, keepalive }),

  sendSecretMessage: (payload) => apiRequest('/secret/send', { method: 'POST', body: payload }),
  deleteSecretMessage: (messageId) => apiRequest('/secret/delete', { method: 'POST', body: { messageId } }),

  // Media is served from a password-gated endpoint, so it can't be loaded
  // via a plain <img>/<video> src (those can't carry an Authorization
  // header) — fetch it as an authenticated blob instead.
  //
  // A file too big for one response (Netlify caps a single Function response
  // around 6MB) is read as a manifest — "this file is in N pieces" — followed
  // by one request per piece, reassembled here in index order.
  //
  // Anything that fits in a single piece, which is every voice note and most
  // photos, skips that entirely: `inline=1` asks the endpoint to answer the
  // very first request with the bytes themselves, so a recorded message costs
  // one round trip instead of two. Which of the two answers came back is read
  // off the response rather than assumed, so this still works unchanged
  // against a deployment that only knows how to send a manifest.
  //
  // `kind` decides queue position only (see MEDIA_PRIORITY) — the bytes are
  // identical either way.
  fetchSecretMediaBlob: (url, onProgress, kind) =>
    queueMediaFetch(async () => {
      const token = Storage.getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const sep = url.includes('?') ? '&' : '?';

      const firstRes = await fetchMediaWithRetry(`${url}${sep}inline=1`, headers);

      if (firstRes.headers.get('X-Media-Chunks') === '1') {
        const contentType = firstRes.headers.get('X-Media-Content-Type') || 'application/octet-stream';
        const buffer = await firstRes.arrayBuffer();
        onProgress?.(1);
        return new Blob([buffer], { type: contentType });
      }

      const { contentType, totalChunks } = await firstRes.json();

      // Fetched a few pieces at a time rather than all at once. Requesting
      // every piece of a large video simultaneously opened dozens of parallel
      // downloads and peaked at the entire file in memory, which is what made
      // big videos fail to open on phones. Results are stored by index so the
      // file still reassembles in the right order.
      const parts = new Array(totalChunks);
      let nextIndex = 0;
      let completed = 0;

      async function fetchNext() {
        while (nextIndex < totalChunks) {
          const i = nextIndex++;
          const res = await fetchMediaWithRetry(`${url}${sep}chunk=${i}`, headers);
          parts[i] = await res.arrayBuffer();
          completed++;
          onProgress?.(completed / totalChunks);
        }
      }

      const workers = Math.min(MEDIA_FETCH_CONCURRENCY, totalChunks);
      await Promise.all(Array.from({ length: workers }, fetchNext));

      return new Blob(parts, { type: contentType });
    }, kind)
};
