const state = {
  me: null,
  messages: [],
  unlocked: false,
  role: null, // 'guest' (no delete) | 'admin' (full delete + bulk select)
  cursor: null, // server timestamp of the last successful sync — drives incremental polling
  hasMoreOlder: false,
  // Whether the *other* side is in the chat right now. Which side that is
  // depends on who you are, and the server works it out: a guest sees the
  // admin's status, the admin sees the guests'. Starts false so the header
  // reads Offline until the server has actually said otherwise.
  peerOnline: false,
  // How far the other side has read, as a message timestamp. Every message of
  // your own sent before this has been seen, and shows blue ticks. One number
  // covers the whole conversation, so a poll never has to carry per-message
  // receipt data.
  peerReadThrough: 0
};

// ---------- Helpers ----------
function resolveUploadUrl(path) {
  // Media URLs are already same-origin absolute paths (e.g.
  // /api/secret/media-get?id=...), so no host needs to be prepended.
  return path || '';
}

function isSameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function formatClockTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(ts) {
  const now = Date.now();
  if (isSameDay(ts, now)) return 'Today';
  if (isSameDay(ts, now - 86400000)) return 'Yesterday';
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
}

function toast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ---------- Guest session bootstrap ----------
async function createGuestSession() {
  const suffix = Math.random().toString(36).slice(2, 8);
  const username = `guest_${suffix}`;
  const displayName = `Guest ${suffix.slice(0, 4).toUpperCase()}`;
  const password = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const { token, user } = await Api.register(username, password, displayName);
  Storage.setToken(token);
  Storage.setUser(user);
  return user;
}

// The stored identity is only ever discarded when the *server* has actually
// rejected it. This used to throw the token and user away on any failure at
// all — a dropped request, a 5xx, a deployment mid-redeploy — and then
// register a brand new guest. That is not a harmless reset: `senderId` is
// what decides which side of the conversation every message renders on, the
// unlocked password tier is stored against that same id, and so are hide
// records. Re-registering over a passing fault silently hands the whole
// history to a stranger who happens to be you, and drops you back to locked.
//
// A 401 is the one answer that leaves no alternative: the token can no
// longer be verified (expired, or JWT_SECRET was rotated) so nothing can be
// done with it. Everything else keeps the identity — including a 404 from
// /users/me, because no chat endpoint looks the caller up in the users
// record; the token alone still authenticates all of them.
function isRejectedToken(err) {
  return err?.status === 401;
}

async function ensureSession() {
  const cached = Storage.getUser();

  if (Storage.getToken() && cached) {
    try {
      const me = await Api.getMe();
      Storage.setUser(me);
      return me;
    } catch (err) {
      if (!isRejectedToken(err)) return cached;
      Storage.clearToken();
      Storage.clearUser();
    }
  }
  return createGuestSession();
}

// Bootstrapping retries instead of giving up after one attempt. The old
// version toasted once and left state.me null for the rest of the page's
// life, so a backend that recovered a second later still could not be
// reached without a manual reload — and every render path that reads
// state.me.id would have thrown if the chat had somehow been opened.
const SESSION_RETRY_BASE_MS = 2000;
const SESSION_RETRY_MAX_MS = 30000;

let sessionAttempt = null;
let sessionRetryTimer = null;
let sessionRetryDelay = SESSION_RETRY_BASE_MS;
let sessionErrorShown = false;
let lastSessionError = null;

// Three genuinely different problems, which the single old message
// ("check your connection") described wrongly in two cases out of three.
// Being told to check a connection that is fine, about a server that is
// missing an environment variable, is how an afternoon gets lost.
function describeSessionError(err) {
  if (err?.isNetworkError) return 'No connection. This will start itself once you are back online.';
  if (err?.code === 'server_not_configured' || err?.status === 503) {
    return 'The server is not set up yet, so no session could start.';
  }
  return 'Could not start a session yet — still trying.';
}

function scheduleSessionRetry() {
  if (sessionRetryTimer) return;
  sessionRetryTimer = setTimeout(() => {
    sessionRetryTimer = null;
    bootstrapSession();
  }, sessionRetryDelay);
  sessionRetryDelay = Math.min(sessionRetryDelay * 2, SESSION_RETRY_MAX_MS);
}

// Resolves with the session's user, or null if one still could not be made.
// Never rejects, and concurrent callers share the one attempt in flight.
function bootstrapSession() {
  if (state.me) return Promise.resolve(state.me);
  if (sessionAttempt) return sessionAttempt;

  sessionAttempt = ensureSession()
    .then((me) => {
      state.me = me;
      lastSessionError = null;
      sessionErrorShown = false;
      sessionRetryDelay = SESSION_RETRY_BASE_MS;
      return me;
    })
    .catch((err) => {
      lastSessionError = err;
      // Said once rather than on every retry — a toast every two seconds is
      // its own kind of broken. Saying nothing is worse: an app that looks
      // fine while quietly being unable to do anything is what cost days
      // here before.
      if (!sessionErrorShown) {
        sessionErrorShown = true;
        toast(describeSessionError(err));
      }
      scheduleSessionRetry();
      return null;
    })
    .finally(() => {
      sessionAttempt = null;
    });

  return sessionAttempt;
}

bootstrapSession();

// Two moments worth retrying at once instead of waiting out the backoff:
// the connection returning, and the tab being looked at again.
window.addEventListener('online', () => {
  if (state.me) return;
  sessionRetryDelay = SESSION_RETRY_BASE_MS;
  bootstrapSession();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !state.me) bootstrapSession();
});

// ---------- Secret room (polled over REST — no persistent server needed) ----------
// Kept under two seconds so a sent message lands on the other side inside
// that window. Polling is suspended entirely while the tab is hidden (see
// the visibilitychange handler), so the faster cadence only costs requests
// while someone is actually looking at the chat.
const POLL_INTERVAL_MS = 1500;
let pollTimer = null;

// ---------- Online / offline indicator ----------
// The header shows whether the other side is in the chat right now. Nothing
// is inferred locally: every poll response carries the answer, because only
// the server knows who holds which password and when they were last seen.
const presenceEl = document.getElementById('secret-presence');
const presenceTextEl = document.getElementById('secret-presence-text');

function renderPresence() {
  const online = state.unlocked && state.peerOnline;
  presenceEl.dataset.state = online ? 'online' : 'offline';
  presenceTextEl.textContent = online ? 'Online' : 'Offline';
}

function setPeerOnline(online) {
  const next = !!online;
  if (next === state.peerOnline) return;
  state.peerOnline = next;
  renderPresence();
}

// How long the last answer from the server stays trustworthy. Polls fail
// silently by design (a blip shouldn't disturb the chat), but a screen that
// cannot reach the server does not know the other side is still there — and
// must not keep insisting they are. Matches the server's own presence TTL:
// past this point the other side has stopped hearing from us too, so both
// screens agree on Offline.
const PRESENCE_STALE_MS = 15000;
let lastPresenceSyncAt = 0;

// Says "I'm here" / "I've gone" outside the poll's own heartbeat — on the way
// into the chat and on the way out. Failures are ignored on purpose: the
// heartbeat expiring server-side reaches the same result a few seconds later,
// so a dropped beacon costs a little promptness and nothing else.
function announcePresence(online, { keepalive = false } = {}) {
  Api.updateSecretSession({ online }, { keepalive }).catch(() => {});
}

// ---------- Read receipts ----------
const chatRootEl = document.getElementById('chat-root');

// Reading only counts while the chat is genuinely in front of the person: the
// tab visible *and* the chat itself on screen. The second half matters for the
// guest, whose unlock shows a reveal screen over the chat first — polling has
// already started by then, and messages must not be marked read from behind it.
function isChatOnScreen() {
  return document.visibilityState === 'visible' && !chatRootEl.classList.contains('hidden');
}

// What this side is prepared to swear it has seen: the newest message
// actually held, sent back with each poll so the other side's ticks can turn
// blue. Deliberately *not* the current time — acknowledging "everything up to
// now" would mark a message read in the moment between it being sent and this
// side ever receiving it, which is the one thing a read receipt must never do.
function readAcknowledgement() {
  if (!isChatOnScreen() || state.messages.length === 0) return undefined;
  return state.messages[state.messages.length - 1].createdAt;
}

// Blue once the other side's read watermark has passed this message. Only the
// sender's own messages carry ticks, exactly as in WhatsApp — there is nothing
// to report to you about a message you received.
function tickStateFor(msg) {
  return msg.createdAt <= state.peerReadThrough ? 'read' : 'sent';
}

// Tells the other side "seen" the instant their message is on screen, instead
// of letting the next poll carry it a beat later. Only fires when a message
// actually arrived and is actually being looked at, so it costs one small
// request per incoming batch and nothing while the chat sits idle.
function acknowledgeNow() {
  const ack = readAcknowledgement();
  if (!ack) return;
  Api.updateSecretSession({ ack })
    .then((result) => applyReadReceipts(result?.peerReadThrough))
    .catch(() => {});
}

// Repaints the ticks already on screen when the watermark moves. One pass over
// the sender's own messages, and only when the number actually changed, so the
// common poll (nothing new read) costs nothing at all.
function applyReadReceipts(peerReadThrough) {
  if (!state.me) return;
  const next = Number(peerReadThrough) || 0;
  if (next <= state.peerReadThrough) return;
  state.peerReadThrough = next;

  state.messages.forEach((msg) => {
    if (msg.senderId !== state.me.id) return;
    const ticks = rowsById.get(msg.id)?.querySelector('.msg-ticks');
    if (ticks) ticks.dataset.state = tickStateFor(msg);
  });
}

// Initial load only — fetches the most recent window of messages and sets
// the incremental-sync cursor. Later updates come through pollMessages(),
// which only asks the server for what changed since that cursor instead of
// re-fetching the whole conversation.
async function loadMessages() {
  try {
    const { messages, hasMore, serverTime, peerOnline, peerReadThrough } = await Api.getSecretMessages();
    state.messages = messages || [];
    state.hasMoreOlder = !!hasMore;
    state.cursor = serverTime;
    state.peerOnline = !!peerOnline;
    state.peerReadThrough = Number(peerReadThrough) || 0;
    lastPresenceSyncAt = Date.now();
    rowsById.clear();
    lastDateKey = null;
    return true;
  } catch (err) {
    return false;
  }
}

async function pollMessages() {
  try {
    const { messages, deletedIds, hiddenEvents, serverTime, peerOnline, peerReadThrough } =
      await Api.getSecretMessages({ since: state.cursor, ack: readAcknowledgement() });
    if (deletedIds && deletedIds.length > 0) removeMessageRows(deletedIds);
    if (hiddenEvents && hiddenEvents.length > 0) applyHiddenEvents(hiddenEvents);
    if (messages && messages.length > 0) appendMessages(messages);
    state.cursor = serverTime;
    lastPresenceSyncAt = Date.now();
    setPeerOnline(peerOnline);
    applyReadReceipts(peerReadThrough);

    // This poll's request carried the watermark from *before* these messages
    // arrived, so the sender is still waiting on them. Confirm straight away.
    const received = (messages || []).some((m) => m.senderId !== state.me?.id);
    if (received && isChatOnScreen()) acknowledgeNow();
  } catch (err) {
    // Silent — the next tick retries. A transient network blip shouldn't
    // interrupt the chat or throw an error every 2.5 seconds. The status
    // shown is the one exception: it stands only as long as it is fresh.
    if (Date.now() - lastPresenceSyncAt > PRESENCE_STALE_MS) setPeerOnline(false);
  }
}

async function loadOlderMessages() {
  if (loadingOlder || !state.hasMoreOlder || state.messages.length === 0) return;
  loadingOlder = true;
  loadOlderBtn.disabled = true;
  try {
    const oldest = state.messages[0].createdAt;
    const { messages, hasMore } = await Api.getSecretMessages({ before: oldest, limit: 100 });
    state.hasMoreOlder = !!hasMore;
    prependMessages(messages || []);
    updateLoadOlderUi();
  } catch (err) {
    toast('Could not load older messages.');
  } finally {
    loadingOlder = false;
    loadOlderBtn.disabled = false;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollMessages, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (!state.unlocked) return;
  if (document.hidden) {
    stopPolling();
    // Polling stopping is what would eventually mark this side offline, but
    // waiting for that would leave the other screen saying Online for someone
    // who has switched apps. Say so now instead. Sent with keepalive because
    // a backgrounded page can be frozen the moment this handler returns.
    announcePresence(false, { keepalive: true });
  } else {
    // No matching "I'm back" call needed — the poll below heartbeats as part
    // of asking for new messages, so this side is online again immediately.
    pollMessages();
    startPolling();
  }
});

// Closing the tab or navigating away. pagehide covers the mobile case that
// beforeunload does not fire for reliably (a phone discarding a backgrounded
// page), and the request is left to fly on its own — the page is going.
window.addEventListener('pagehide', () => {
  if (!state.unlocked) return;
  announcePresence(false, { keepalive: true });
});

window.SecretChat = {
  tryUnlock: async (password) => {
    // Without a session there is no token, so /secret/unlock answers 401 —
    // and a 401 from here is read below as "wrong password". That is how a
    // backend that never issued a session turned the owner's *correct*
    // password into the decoy dashboard, three times, and then locked the
    // 10-tap trigger out of their own chat. A missing session is a session
    // problem, reported as one, and never counted as a failed guess.
    if (!state.me) {
      const me = await bootstrapSession();
      if (!me) {
        return lastSessionError?.isNetworkError
          ? { ok: false, networkError: true }
          : { ok: false, serverError: true };
      }
    }

    let result;
    try {
      result = await Api.unlockSecret(password);
    } catch (err) {
      if (err.isNetworkError) {
        toast('Could not reach the server — the backend may not be running.');
        return { ok: false, networkError: true };
      }
      // A 5xx means the server is misconfigured or down, which must not be
      // counted against the person typing — that is what previously locked
      // this browser out for a day during an outage nobody could have
      // avoided. 503 lands here too, which is what a deployment missing its
      // password variables now answers.
      if (err.status && err.status >= 500) {
        toast('The server had a problem. Try again in a moment.');
        return { ok: false, serverError: true };
      }
      // A 401 about the *token* is this session being rejected, not the
      // password being wrong — same reasoning as above. The server tags it;
      // the wording check is the fallback for a client running ahead of a
      // deployment that does not send the tag yet.
      const tokenRejected =
        err.status === 401 && (err.code === 'invalid_token' || !/password/i.test(err.message || ''));
      if (tokenRejected) {
        Storage.clearToken();
        Storage.clearUser();
        state.me = null;
        bootstrapSession();
        return { ok: false, serverError: true };
      }
      return { ok: false, wrongPassword: err.status === 401 };
    }

    state.role = result.role;
    const loaded = await loadMessages();
    if (!loaded) {
      toast('Connected, but could not open the secret channel. Try again.');
      // The password was right — the failure came afterwards, so this is
      // not a wrong-password strike either.
      return { ok: false, serverError: true };
    }
    state.unlocked = true;
    renderAll();
    renderPresence();
    updateLoadOlderUi();
    focusComposer();
    startPolling();
    updateSelectUi();
    return { ok: true, role: state.role };
  },
  stop: () => {
    // Leaving the chat is going offline, so tell the other side before
    // tearing anything down — while the token and role are still around to
    // authenticate the call.
    if (state.unlocked) announcePresence(false);
    state.unlocked = false;
    state.peerOnline = false;
    state.peerReadThrough = 0;
    renderPresence();
    stopPolling();
    selectionMode = false;
    selectedIds.clear();
    rowsById.clear();
    mediaObjectUrlCache.forEach((entry) => URL.revokeObjectURL(entry.url));
    mediaObjectUrlCache.clear();
    state.messages = [];
    state.cursor = null;
    state.hasMoreOlder = false;
  }
};

// ---------- Rendering ----------
// The old version tore down and rebuilt the entire message list — including
// re-downloading every photo/video/voice note — on every 2.5s poll tick and
// every send. That's the "keeps reloading" behavior. Now:
//  - Each message's resolved media Object URL is cached for the life of the
//    session (mediaObjectUrlCache), so a given photo/video is fetched from
//    the server exactly once, never again.
//  - New messages (from a poll or a send) are appended to the existing DOM
//    instead of rebuilding it (appendMessages/appendSingleRow). Deletions
//    remove just their own row (removeMessageRows). Only a handful of rare,
//    deliberate actions (opening the chat, toggling selection mode, loading
//    older history) still do a full rebuild — and even those reuse the
//    media cache, so no network refetch happens even then.
const messagesEl = document.getElementById('secret-messages');
const loadOlderBtn = document.getElementById('secret-load-older-btn');

const mediaObjectUrlCache = new Map(); // messageId -> { url }
const rowsById = new Map(); // messageId -> row element
let lastDateKey = null;
let loadingOlder = false;

// Only a *successful* fetch is remembered. A failure deliberately leaves the
// cache empty so the next attempt really does go back to the network —
// caching the rejection is what would turn one dropped request into a
// permanently missing message.
//
// The media type is passed along because it decides queue position: a voice
// note is fetched ahead of the photos and videos it shares the connection
// with (see MEDIA_PRIORITY in api.js).
function resolveMedia(msg) {
  const cached = mediaObjectUrlCache.get(msg.id);
  if (cached) return Promise.resolve(cached.url);
  return Api.fetchSecretMediaBlob(resolveUploadUrl(msg.mediaUrl), null, msg.mediaType).then((blob) => {
    const objectUrl = URL.createObjectURL(blob);
    mediaObjectUrlCache.set(msg.id, { url: objectUrl });
    return objectUrl;
  });
}

// Drawn rather than typed: a "✓✓" built from font glyphs lands differently on
// every phone, and the two ticks have to overlap by a fixed amount to read as
// one mark. Both ticks are always in the markup; the state on the wrapper
// decides the colour, so turning a message blue later is one attribute change
// with no rebuild and no flicker.
// The second tick is the first one shifted right, with its short leg left off:
// overlapped that closely the leg would be hidden behind the first tick
// anyway, and drawing it only thickens the join. The viewBox is sized to the
// drawing plus half a stroke on each side, so the mark sits flush against the
// timestamp instead of floating in empty space.
const TICKS_SVG =
  '<svg viewBox="0 0 13 11" class="msg-ticks-svg" aria-hidden="true">' +
  '<path d="M1 6.3L3.7 9L9 2.4" /><path d="M6.9 9L12.2 2.4" />' +
  '</svg>';

function buildTicks(msg) {
  const ticks = document.createElement('span');
  ticks.className = 'msg-ticks';
  ticks.dataset.state = tickStateFor(msg);
  ticks.innerHTML = TICKS_SVG;
  return ticks;
}

function buildMessageRow(msg) {
  const isOut = !!state.me && msg.senderId === state.me.id;
  const row = document.createElement('div');
  row.className = `msg-row ${isOut ? 'out' : 'in'}`;

  const canSelect = selectionMode && state.role === 'admin';
  if (canSelect) {
    row.classList.add('selecting');
    const checkbox = document.createElement('div');
    checkbox.className = 'msg-select-checkbox';
    if (selectedIds.has(msg.id)) checkbox.classList.add('checked');
    row.appendChild(checkbox);
    row.addEventListener('click', () => toggleMessageSelected(msg.id));
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  if (canSelect) bubble.classList.add('msg-bubble-noninteractive');

  if (msg.mediaUrl && msg.mediaType === 'audio') {
    const audioWrap = document.createElement('div');
    audioWrap.className = 'msg-audio-wrap';

    // A voice message that is still downloading, one that failed, and one
    // that was never sent all used to look identical: an <audio> element with
    // no source renders as a dead greyed-out player and says nothing. That is
    // why a slow voice note read as a missing one. The player is held back
    // until it actually has audio, and this line stands in for it — reporting
    // progress, and doubling as the retry control if the fetch fails.
    const status = document.createElement('button');
    status.type = 'button';
    status.className = 'msg-audio-status';

    const audioEl = document.createElement('audio');
    audioEl.className = 'msg-audio';
    audioEl.controls = true;
    // The source is an in-memory object URL by the time it is set, so there
    // is nothing to fetch: loading it in full costs no network at all and is
    // what makes the play button respond on the first tap instead of
    // buffering.
    audioEl.preload = 'auto';

    audioWrap.appendChild(status);
    audioWrap.appendChild(audioEl);

    const loadAudio = () => {
      audioWrap.dataset.state = 'loading';
      status.textContent = 'Loading voice message…';
      status.disabled = true;
      resolveMedia(msg)
        .then((objectUrl) => {
          audioEl.src = objectUrl;
          audioWrap.dataset.state = 'ready';
        })
        .catch(() => {
          audioWrap.dataset.state = 'error';
          status.textContent = 'Voice message didn’t load — tap to retry';
          status.disabled = false;
        });
    };

    status.addEventListener('click', loadAudio);
    loadAudio();

    bubble.appendChild(audioWrap);
  } else if (msg.mediaUrl) {
    const mediaWrap = document.createElement('div');
    mediaWrap.className = 'msg-media-wrap';

    const mediaEl = document.createElement(msg.mediaType === 'video' ? 'video' : 'img');
    mediaEl.className = 'msg-media';
    if (msg.mediaType === 'video') {
      // No inline controls: the thumbnail is just a poster frame, real
      // playback happens in the fullscreen viewer opened on click.
      mediaEl.muted = true;
      mediaEl.playsInline = true;
      mediaEl.preload = 'metadata';
    } else {
      mediaEl.loading = 'lazy';
    }
    mediaWrap.appendChild(mediaEl);

    if (msg.mediaType === 'video') {
      const playIcon = document.createElement('div');
      playIcon.className = 'msg-play-icon';
      mediaWrap.appendChild(playIcon);
    }

    const saveBtn = document.createElement('a');
    saveBtn.className = 'msg-save-btn';
    saveBtn.download = msg.mediaType === 'video' ? 'chat-video' : 'chat-photo';
    saveBtn.title = 'Save';
    saveBtn.textContent = '⬇';
    mediaWrap.appendChild(saveBtn);

    // The endpoint behind the media URL requires the caller's auth token,
    // which an <img>/<video> src can't send — fetch it as a blob instead
    // and point both the thumbnail and the save link at the object URL.
    let resolvedObjectUrl = null;

    const loadMedia = () => {
      mediaWrap.classList.remove('msg-media-error');
      resolveMedia(msg)
        .then((objectUrl) => {
          resolvedObjectUrl = objectUrl;
          mediaEl.src = objectUrl;
          saveBtn.href = objectUrl;
        })
        // Marked, visibly, and retryable: this used to add a class that no
        // stylesheet defined, so a failed photo was an invisible blank the
        // viewer could do nothing about.
        .catch(() => mediaWrap.classList.add('msg-media-error'));
    };

    mediaEl.addEventListener('click', () => {
      if (resolvedObjectUrl) openMediaViewer(resolvedObjectUrl, msg.mediaType);
      else if (mediaWrap.classList.contains('msg-media-error')) loadMedia();
    });
    loadMedia();

    bubble.appendChild(mediaWrap);
  }

  if (msg.text) {
    const text = document.createElement('div');
    text.className = 'msg-text';
    text.textContent = msg.text;
    bubble.appendChild(text);
  }

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  const time = document.createElement('span');
  time.textContent = formatClockTime(msg.createdAt);
  meta.appendChild(time);
  // Ticks belong only on your own messages — there is nothing to report to
  // you about one you received.
  if (isOut) meta.appendChild(buildTicks(msg));
  bubble.appendChild(meta);

  // The admin sees a red marker on anything the other side withdrew. The
  // message is still here and still theirs to keep or erase — the marker
  // only reports that the sender removed it from their own view.
  if (state.role === 'admin' && (msg.hiddenFor || []).length > 0) {
    const flag = document.createElement('span');
    flag.className = 'msg-withdrawn-dot';
    flag.title = 'Deleted by the sender from their side — still stored here';
    bubble.appendChild(flag);
    bubble.classList.add('msg-withdrawn');
  }

  // Both tiers get a delete control, but they do different things and the
  // server decides which (see api/secret/delete.js) — the admin erases for
  // everyone, a guest only hides from its own view.
  //
  // Several people can share the guest password; they may hide their own
  // messages and each other's, but never one the admin sent. `canHide` is
  // that decision, made server-side and sent with the message — the client
  // never works it out itself, and the same rule is enforced again when the
  // hide is attempted. Hidden while bulk-selecting so there's one way to
  // delete at a time.
  const canHideOwn = state.role !== 'admin' && msg.canHide === true;
  if (!selectionMode && (state.role === 'admin' || canHideOwn)) {
    const delBtn = document.createElement('button');
    delBtn.className = 'msg-delete-btn';
    delBtn.title = state.role === 'admin' ? 'Delete permanently for everyone' : 'Delete from my view';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', () => deleteMessage(msg.id));
    bubble.appendChild(delBtn);
  }

  row.appendChild(bubble);
  return row;
}

function appendSingleRow(msg, { scroll = true } = {}) {
  const dateKey = new Date(msg.createdAt).toDateString();
  if (dateKey !== lastDateKey) {
    const sep = document.createElement('div');
    sep.className = 'date-separator';
    sep.textContent = formatDateSeparator(msg.createdAt);
    messagesEl.appendChild(sep);
    lastDateKey = dateKey;
  }
  const row = buildMessageRow(msg);
  rowsById.set(msg.id, row);
  messagesEl.appendChild(row);
  if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Full rebuild — used only for rare, deliberate transitions (opening the
// chat, toggling selection mode, loading older history). Media is still
// served from cache, so this never re-triggers a network fetch for
// already-seen messages.
function renderAll() {
  messagesEl.innerHTML = '';
  rowsById.clear();
  lastDateKey = null;
  state.messages.forEach((msg) => appendSingleRow(msg, { scroll: false }));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Hot path: called on every poll tick and every send. Only touches the
// messages that are actually new.
function appendMessages(msgs) {
  const newOnes = msgs.filter((m) => !rowsById.has(m.id)).sort((a, b) => a.createdAt - b.createdAt);
  if (newOnes.length === 0) return;

  const lastExisting = state.messages[state.messages.length - 1];
  const outOfOrder = lastExisting && newOnes[0].createdAt < lastExisting.createdAt;
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 200;

  newOnes.forEach((m) => state.messages.push(m));

  if (outOfOrder) {
    // Rare (two messages landing in the same tiny window from different
    // senders) — fall back to a full rebuild to keep chronological order
    // correct. Still cache-backed, so no media refetch/flicker.
    state.messages.sort((a, b) => a.createdAt - b.createdAt);
    renderAll();
  } else {
    newOnes.forEach((m) => appendSingleRow(m, { scroll: false }));
  }

  if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function prependMessages(msgs) {
  if (msgs.length === 0) return;
  const sorted = [...msgs].sort((a, b) => a.createdAt - b.createdAt);
  state.messages = [...sorted, ...state.messages];

  const prevScrollHeight = messagesEl.scrollHeight;
  const prevScrollTop = messagesEl.scrollTop;
  renderAll();
  messagesEl.scrollTop = messagesEl.scrollHeight - prevScrollHeight + prevScrollTop;
}

// A guest hiding one of their messages and the admin's view of that same
// message are two different outcomes of one event, so both are driven from
// the same poll payload:
//   guest -> the message leaves their view entirely
//   admin -> the message stays, and grows the red withdrawn marker
function applyHiddenEvents(events) {
  if (state.role !== 'admin') {
    removeMessageRows(events.map((e) => e.id));
    return;
  }

  events.forEach((event) => {
    const msg = state.messages.find((m) => m.id === event.id);
    if (!msg) return;
    const hiddenFor = new Set(msg.hiddenFor || []);
    if (event.userId) hiddenFor.add(event.userId);
    msg.hiddenFor = [...hiddenFor];

    // Re-render just this row so the marker appears without disturbing
    // scroll position or reloading any media already on screen.
    const oldRow = rowsById.get(event.id);
    if (oldRow) {
      const newRow = buildMessageRow(msg);
      oldRow.replaceWith(newRow);
      rowsById.set(event.id, newRow);
    }
  });
}

function removeMessageRows(ids) {
  const idSet = new Set(ids);
  idSet.forEach((id) => {
    const row = rowsById.get(id);
    if (row) {
      row.remove();
      rowsById.delete(id);
    }
    const cached = mediaObjectUrlCache.get(id);
    if (cached) {
      URL.revokeObjectURL(cached.url);
      mediaObjectUrlCache.delete(id);
    }
  });
  state.messages = state.messages.filter((m) => !idSet.has(m.id));
}

function updateLoadOlderUi() {
  loadOlderBtn.classList.toggle('hidden', !state.hasMoreOlder);
}

loadOlderBtn.addEventListener('click', loadOlderMessages);

// ---------- Fullscreen media viewer ----------
const mediaViewer = document.getElementById('media-viewer');
const mediaViewerContent = document.getElementById('media-viewer-content');
const mediaViewerClose = document.getElementById('media-viewer-close');

function openMediaViewer(url, type) {
  mediaViewerContent.innerHTML = '';
  const el = document.createElement(type === 'video' ? 'video' : 'img');
  el.src = url;
  if (type === 'video') {
    el.controls = true;
    el.autoplay = true;
    el.playsInline = true;
  }
  mediaViewerContent.appendChild(el);
  mediaViewer.classList.remove('hidden');
}

function closeMediaViewer() {
  mediaViewer.classList.add('hidden');
  mediaViewerContent.innerHTML = '';
}

mediaViewerClose.addEventListener('click', closeMediaViewer);
mediaViewer.addEventListener('click', (e) => {
  if (e.target === mediaViewer) closeMediaViewer();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !mediaViewer.classList.contains('hidden')) closeMediaViewer();
});

async function deleteMessage(id) {
  const prompt =
    state.role === 'admin'
      ? 'Permanently delete this message for everyone? Any photo or video on it is erased from storage too, and this cannot be undone.'
      : 'Delete this message from your view?';
  if (!window.confirm(prompt)) return;
  try {
    await Api.deleteSecretMessage(id);
    removeMessageRows([id]);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Composer ----------
const messageInput = document.getElementById('secret-message-input');
const sendBtn = document.getElementById('secret-send-btn');
const attachBtn = document.getElementById('secret-attach-btn');
const mediaInput = document.getElementById('secret-media-input');

function focusComposer() {
  messageInput?.focus();
}

async function sendCurrentMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = '';
  messageInput.style.height = 'auto';

  try {
    const { message } = await Api.sendSecretMessage({ text, mediaUrl: null, mediaType: null });
    appendMessages([message]);
  } catch (err) {
    toast(err.message);
  }
}

// Used by camera capture and voice notes: a single already-uploaded media
// result, optionally paired with whatever text is currently typed.
async function sendUploadedMedia(uploadResult) {
  const text = messageInput.value.trim();
  messageInput.value = '';
  messageInput.style.height = 'auto';

  try {
    const { message } = await Api.sendSecretMessage({
      text,
      mediaUrl: uploadResult.url,
      mediaType: uploadResult.type
    });
    appendMessages([message]);
  } catch (err) {
    toast(err.message);
  }
}

// Used by the multi-file attach flow: uploads and sends each file as its
// own message, one at a time, so a single failure never blocks the rest of
// the batch. Any typed text is sent as a separate trailing message once all
// files are done (a caption shared by several different files at once
// would be ambiguous).
async function sendMediaFiles(files) {
  const pendingText = messageInput.value.trim();
  messageInput.value = '';
  messageInput.style.height = 'auto';

  attachBtn.disabled = true;
  attachBtn.classList.add('uploading');

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    try {
      const result = await Api.uploadSecretMediaAuto(file);
      const { message } = await Api.sendSecretMessage({ text: '', mediaUrl: result.url, mediaType: result.type });
      appendMessages([message]);
      successCount++;
    } catch (err) {
      failCount++;
      toast(`Could not send "${file.name || 'file'}": ${err.message}`);
    }
  }

  attachBtn.disabled = false;
  attachBtn.classList.remove('uploading');

  if (pendingText) {
    try {
      const { message } = await Api.sendSecretMessage({ text: pendingText, mediaUrl: null, mediaType: null });
      appendMessages([message]);
    } catch (err) {
      toast(err.message);
    }
  }

  if (failCount > 0 && successCount > 0) {
    toast(`${successCount} sent, ${failCount} failed.`);
  }
}

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendCurrentMessage();
  }
});

sendBtn.addEventListener('click', () => sendCurrentMessage());

attachBtn.addEventListener('click', () => mediaInput.click());

mediaInput.addEventListener('change', async () => {
  const files = Array.from(mediaInput.files);
  mediaInput.value = '';
  if (files.length === 0) return;
  await sendMediaFiles(files);
});

// ---------- Camera capture (photo/video straight into chat) ----------
// Uses getUserMedia + MediaRecorder/canvas instead of a file-input capture
// flow so the device's live camera opens on both mobile and desktop, and so
// the captured frame/clip only ever exists as an in-memory Blob — it is
// never handed to the OS, so nothing is written to the gallery/DCIM/camera
// roll at any point.
const cameraBtn = document.getElementById('secret-camera-btn');
const cameraModal = document.getElementById('camera-modal');
const cameraLiveWrap = document.getElementById('camera-live-wrap');
const cameraLiveEl = document.getElementById('camera-live');
const cameraCloseBtn = document.getElementById('camera-close-btn');
const cameraShutterBtn = document.getElementById('camera-shutter-btn');
const cameraVideoBtn = document.getElementById('camera-video-btn');
const cameraRecordTimerEl = document.getElementById('camera-record-timer');
const cameraPreviewWrap = document.getElementById('camera-preview-wrap');
const cameraPreviewImg = document.getElementById('camera-preview-img');
const cameraPreviewVideo = document.getElementById('camera-preview-video');
const cameraRetakeBtn = document.getElementById('camera-retake-btn');
const cameraSendBtn = document.getElementById('camera-send-btn');
const cameraCaptureCanvas = document.getElementById('camera-capture-canvas');

let cameraStream = null;
let cameraRecorder = null;
let cameraRecordedChunks = [];
let cameraRecordStartTime = null;
let cameraRecordTimerInterval = null;
let capturedBlob = null;
let capturedKind = null; // 'image' | 'video'
let capturedPreviewUrl = null;

async function openCameraModal() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: true
    });
  } catch (err) {
    toast('Camera access denied.');
    return;
  }
  cameraLiveEl.srcObject = cameraStream;
  cameraModal.classList.remove('hidden');
  cameraLiveWrap.classList.remove('hidden');
  cameraPreviewWrap.classList.add('hidden');
}

function stopCameraStream() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  cameraLiveEl.srcObject = null;
}

function revokeCapturedPreviewUrl() {
  if (capturedPreviewUrl) {
    URL.revokeObjectURL(capturedPreviewUrl);
    capturedPreviewUrl = null;
  }
}

function closeCameraModal() {
  if (cameraRecorder && cameraRecorder.state === 'recording') {
    cameraRecorder.stop();
  }
  clearInterval(cameraRecordTimerInterval);
  cameraRecordTimerInterval = null;
  stopCameraStream();
  revokeCapturedPreviewUrl();
  capturedBlob = null;
  capturedKind = null;
  cameraPreviewImg.classList.add('hidden');
  cameraPreviewVideo.classList.add('hidden');
  cameraPreviewImg.src = '';
  cameraPreviewVideo.src = '';
  cameraModal.classList.add('hidden');
}

function showCapturedPreview() {
  stopCameraStream();
  cameraLiveWrap.classList.add('hidden');
  cameraPreviewWrap.classList.remove('hidden');
  revokeCapturedPreviewUrl();
  capturedPreviewUrl = URL.createObjectURL(capturedBlob);

  if (capturedKind === 'video') {
    cameraPreviewVideo.src = capturedPreviewUrl;
    cameraPreviewVideo.classList.remove('hidden');
    cameraPreviewImg.classList.add('hidden');
  } else {
    cameraPreviewImg.src = capturedPreviewUrl;
    cameraPreviewImg.classList.remove('hidden');
    cameraPreviewVideo.classList.add('hidden');
  }
}

function capturePhoto() {
  const width = cameraLiveEl.videoWidth;
  const height = cameraLiveEl.videoHeight;
  if (!width || !height) return;

  cameraCaptureCanvas.width = width;
  cameraCaptureCanvas.height = height;
  cameraCaptureCanvas.getContext('2d').drawImage(cameraLiveEl, 0, 0, width, height);
  cameraCaptureCanvas.toBlob(
    (blob) => {
      if (!blob) return;
      capturedBlob = blob;
      capturedKind = 'image';
      showCapturedPreview();
    },
    'image/jpeg',
    0.92
  );
}

function updateCameraRecordTimer() {
  const elapsed = Math.floor((Date.now() - cameraRecordStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  cameraRecordTimerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function startVideoCapture() {
  cameraRecordedChunks = [];
  const preferredMimeType = ['video/webm', 'video/mp4'].find(
    (type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)
  );
  cameraRecorder = preferredMimeType
    ? new MediaRecorder(cameraStream, { mimeType: preferredMimeType })
    : new MediaRecorder(cameraStream);

  cameraRecorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) cameraRecordedChunks.push(e.data);
  });
  cameraRecorder.addEventListener('stop', () => {
    clearInterval(cameraRecordTimerInterval);
    cameraRecordTimerInterval = null;
    cameraRecordTimerEl.classList.add('hidden');
    cameraVideoBtn.classList.remove('recording');
    cameraShutterBtn.disabled = false;

    if (cameraRecordedChunks.length === 0) return;
    const mimeType = cameraRecorder.mimeType || 'video/webm';
    capturedBlob = new Blob(cameraRecordedChunks, { type: mimeType });
    capturedKind = 'video';
    showCapturedPreview();
  });

  cameraRecorder.start();
  cameraRecordStartTime = Date.now();
  updateCameraRecordTimer();
  cameraRecordTimerInterval = setInterval(updateCameraRecordTimer, 500);
  cameraRecordTimerEl.classList.remove('hidden');
  cameraVideoBtn.classList.add('recording');
  cameraShutterBtn.disabled = true;
}

function stopVideoCapture() {
  if (cameraRecorder && cameraRecorder.state === 'recording') {
    cameraRecorder.stop();
  }
}

cameraBtn.addEventListener('click', openCameraModal);
cameraCloseBtn.addEventListener('click', closeCameraModal);
cameraShutterBtn.addEventListener('click', capturePhoto);
cameraVideoBtn.addEventListener('click', () => {
  if (cameraRecorder && cameraRecorder.state === 'recording') {
    stopVideoCapture();
  } else {
    startVideoCapture();
  }
});

cameraRetakeBtn.addEventListener('click', () => {
  revokeCapturedPreviewUrl();
  capturedBlob = null;
  capturedKind = null;
  cameraPreviewImg.classList.add('hidden');
  cameraPreviewVideo.classList.add('hidden');
  openCameraModal();
});

cameraSendBtn.addEventListener('click', async () => {
  if (!capturedBlob) return;
  const mimeType = capturedBlob.type || (capturedKind === 'video' ? 'video/webm' : 'image/jpeg');
  const extension = capturedKind === 'video' ? (mimeType.includes('mp4') ? 'mp4' : 'webm') : 'jpg';
  const file = new File([capturedBlob], `camera-${capturedKind}.${extension}`, { type: mimeType });

  cameraSendBtn.disabled = true;
  try {
    const result = await Api.uploadSecretMediaAuto(file);
    closeCameraModal();
    sendUploadedMedia(result);
  } catch (err) {
    toast(err.message);
  } finally {
    cameraSendBtn.disabled = false;
  }
});

// ---------- Voice notes ----------
const micBtn = document.getElementById('secret-mic-btn');
const voiceCancelBtn = document.getElementById('secret-voice-cancel-btn');
const recordingIndicator = document.getElementById('secret-recording-indicator');
const recordingTimerEl = document.getElementById('secret-recording-timer');

let mediaRecorder = null;
let recordingStream = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimerInterval = null;
let voiceRecordingCancelled = false;

function updateRecordingTimer() {
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  recordingTimerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function stopRecordingTracks() {
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
    recordingStream = null;
  }
}

function setRecordingUiActive(active) {
  messageInput.classList.toggle('hidden', active);
  recordingIndicator.classList.toggle('hidden', !active);
  voiceCancelBtn.classList.toggle('hidden', !active);
  micBtn.classList.toggle('recording', active);
  micBtn.title = active ? 'Stop and send' : 'Record voice message';
  attachBtn.disabled = active;
  cameraBtn.disabled = active;
}

async function startVoiceRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    toast('Microphone access denied.');
    return;
  }

  recordingStream = stream;
  audioChunks = [];
  voiceRecordingCancelled = false;

  const preferredMimeType = ['audio/webm', 'audio/mp4'].find(
    (type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)
  );
  mediaRecorder = preferredMimeType
    ? new MediaRecorder(stream, { mimeType: preferredMimeType })
    : new MediaRecorder(stream);

  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  });
  mediaRecorder.addEventListener('stop', onVoiceRecordingStopped);
  mediaRecorder.start();

  recordingStartTime = Date.now();
  updateRecordingTimer();
  recordingTimerInterval = setInterval(updateRecordingTimer, 500);
  setRecordingUiActive(true);
}

async function onVoiceRecordingStopped() {
  stopRecordingTracks();
  clearInterval(recordingTimerInterval);
  recordingTimerInterval = null;
  setRecordingUiActive(false);

  const chunks = audioChunks;
  audioChunks = [];

  if (voiceRecordingCancelled) {
    voiceRecordingCancelled = false;
    return;
  }

  const mimeType = mediaRecorder.mimeType || 'audio/webm';
  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size === 0) return;

  const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
  const file = new File([blob], `voice-note.${extension}`, { type: mimeType });

  micBtn.disabled = true;
  micBtn.classList.add('uploading');
  try {
    const result = await Api.uploadSecretMediaAuto(file);
    sendUploadedMedia(result);
  } catch (err) {
    toast(err.message);
  } finally {
    micBtn.disabled = false;
    micBtn.classList.remove('uploading');
  }
}

micBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  } else {
    startVoiceRecording();
  }
});

voiceCancelBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    voiceRecordingCancelled = true;
    mediaRecorder.stop();
  }
});

// ---------- Admin bulk select & delete ----------
const secretHeaderEl = document.getElementById('secret-header');
const selectBtn = document.getElementById('secret-select-btn');
const selectBar = document.getElementById('secret-select-bar');
const selectCountEl = document.getElementById('secret-select-count');
const selectAllBtn = document.getElementById('secret-select-all-btn');
const selectDeleteBtn = document.getElementById('secret-select-delete-btn');
const selectCancelBtn = document.getElementById('secret-select-cancel-btn');

let selectionMode = false;
let selectedIds = new Set();

function updateSelectUi() {
  selectBtn.classList.toggle('hidden', state.role !== 'admin');
  secretHeaderEl.classList.toggle('hidden', selectionMode);
  selectBar.classList.toggle('hidden', !selectionMode);
  selectCountEl.textContent = `${selectedIds.size} selected`;
  selectDeleteBtn.disabled = selectedIds.size === 0;
}

function toggleMessageSelected(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  const row = rowsById.get(id);
  const checkbox = row?.querySelector('.msg-select-checkbox');
  checkbox?.classList.toggle('checked', selectedIds.has(id));
  updateSelectUi();
}

function enterSelectionMode() {
  selectionMode = true;
  selectedIds.clear();
  updateSelectUi();
  renderAll();
}

function exitSelectionMode() {
  selectionMode = false;
  selectedIds.clear();
  updateSelectUi();
  renderAll();
}

selectBtn.addEventListener('click', enterSelectionMode);
selectCancelBtn.addEventListener('click', exitSelectionMode);

selectAllBtn.addEventListener('click', () => {
  const allIds = state.messages.map((m) => m.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
  selectedIds = allSelected ? new Set() : new Set(allIds);
  updateSelectUi();
  renderAll();
});

selectDeleteBtn.addEventListener('click', async () => {
  if (selectedIds.size === 0) return;
  if (!window.confirm(`Delete ${selectedIds.size} selected message(s) for everyone?`)) return;

  const ids = Array.from(selectedIds);
  selectDeleteBtn.disabled = true;
  const results = await Promise.allSettled(ids.map((id) => Api.deleteSecretMessage(id)));
  const deletedIds = ids.filter((_, i) => results[i].status === 'fulfilled');
  removeMessageRows(deletedIds);

  const failedCount = ids.length - deletedIds.length;
  if (failedCount > 0) toast(`${failedCount} message(s) could not be deleted.`);
  exitSelectionMode();
});

// ---------- Emoji picker ----------
// Category tabs + search rather than one long grid: the full set runs to
// well over a thousand entries, and scrolling that as a single list makes
// most of it effectively unreachable.
const secretEmojiPicker = document.getElementById('secret-emoji-picker');
const secretEmojiBtn = document.getElementById('secret-emoji-btn');

const RECENT_EMOJI_KEY = 'wc_recent_emoji';
const RECENT_EMOJI_MAX = 32;
const SKIN_TONE_KEY = 'wc_emoji_skin_tone';

let activeCategoryId = 'recent';
let activeTone = localStorage.getItem(SKIN_TONE_KEY) || '';
let emojiSearchTerm = '';

function getRecentEmoji() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_EMOJI_KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(0, RECENT_EMOJI_MAX) : [];
  } catch (err) {
    return [];
  }
}

function rememberEmoji(emoji) {
  const next = [emoji, ...getRecentEmoji().filter((e) => e !== emoji)].slice(0, RECENT_EMOJI_MAX);
  localStorage.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
}

function insertEmoji(emoji) {
  const start = messageInput.selectionStart ?? messageInput.value.length;
  const end = messageInput.selectionEnd ?? messageInput.value.length;
  messageInput.value = messageInput.value.slice(0, start) + emoji + messageInput.value.slice(end);
  messageInput.focus();
  messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
  messageInput.dispatchEvent(new Event('input'));
  rememberEmoji(emoji);
}

// Emoji have no names attached here, so search matches on the category name
// instead — enough to jump to "flags" or "food" without a name database.
function emojiForActiveView() {
  if (emojiSearchTerm) {
    const term = emojiSearchTerm.toLowerCase();
    return EMOJI_CATEGORIES.filter(
      (c) => c.name.toLowerCase().includes(term) || c.id.includes(term)
    ).flatMap((c) => c.emoji.map((e) => toneFor(e, c.id)));
  }
  if (activeCategoryId === 'recent') return getRecentEmoji();
  const category = EMOJI_CATEGORIES.find((c) => c.id === activeCategoryId);
  if (!category) return [];
  return category.emoji.map((e) => toneFor(e, category.id));
}

function toneFor(emoji, categoryId) {
  return TONEABLE_CATEGORIES.has(categoryId) ? applySkinTone(emoji, activeTone) : emoji;
}

function renderEmojiGrid() {
  const grid = secretEmojiPicker.querySelector('.emoji-grid');
  grid.innerHTML = '';
  const list = emojiForActiveView();

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'emoji-empty';
    empty.textContent =
      activeCategoryId === 'recent' && !emojiSearchTerm
        ? 'Emoji you use will appear here.'
        : 'Nothing found.';
    grid.appendChild(empty);
    return;
  }

  list.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = emoji;
    btn.addEventListener('click', () => insertEmoji(emoji));
    grid.appendChild(btn);
  });
}

function buildEmojiPicker() {
  secretEmojiPicker.innerHTML = '';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'emoji-search';
  search.placeholder = 'Search categories…';
  search.addEventListener('input', () => {
    emojiSearchTerm = search.value.trim();
    renderEmojiGrid();
  });
  secretEmojiPicker.appendChild(search);

  const tones = document.createElement('div');
  tones.className = 'emoji-tones';
  SKIN_TONES.forEach((tone) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tone.swatch;
    btn.title = tone.label;
    btn.classList.toggle('active', tone.modifier === activeTone);
    btn.addEventListener('click', () => {
      activeTone = tone.modifier;
      localStorage.setItem(SKIN_TONE_KEY, activeTone);
      tones.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderEmojiGrid();
    });
    tones.appendChild(btn);
  });
  secretEmojiPicker.appendChild(tones);

  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  secretEmojiPicker.appendChild(grid);

  const tabs = document.createElement('div');
  tabs.className = 'emoji-tabs';
  [{ id: 'recent', icon: '🕐', name: 'Recent' }, ...EMOJI_CATEGORIES].forEach((category) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = category.icon;
    tab.title = category.name;
    tab.classList.toggle('active', category.id === activeCategoryId);
    tab.addEventListener('click', () => {
      activeCategoryId = category.id;
      emojiSearchTerm = '';
      search.value = '';
      tabs.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      tab.classList.add('active');
      renderEmojiGrid();
    });
    tabs.appendChild(tab);
  });
  secretEmojiPicker.appendChild(tabs);

  renderEmojiGrid();
}

buildEmojiPicker();

secretEmojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const opening = secretEmojiPicker.classList.contains('hidden');
  secretEmojiPicker.classList.toggle('hidden');
  // Recents change as the picker is used, so refresh on open.
  if (opening && activeCategoryId === 'recent') renderEmojiGrid();
});

document.addEventListener('click', (e) => {
  if (!secretEmojiPicker.contains(e.target) && e.target !== secretEmojiBtn) {
    secretEmojiPicker.classList.add('hidden');
  }
});

// ---------- Back to game ----------
document.getElementById('secret-back-btn').addEventListener('click', () => {
  window.SecretChat.stop();
  document.getElementById('chat-root').classList.add('hidden');
  document.getElementById('game-view').classList.remove('hidden');
});
