// Pulls the hidden chat out of Vercel Blob and writes it to a single file you
// can open and listen to with no server running.
//
// This exists because the live site cannot be used to read the history: the
// project is over its usage limit, so /api answers 500 and no deployment can
// be made. The storage itself is a separate thing from the project, and a
// read-write token for the store still reads it. That is the same route the
// Netlify history was rescued through when that host went dead.
//
// The credential is read from .blob-token (gitignored) or BLOB_READ_WRITE_TOKEN
// and is never printed. Nothing here writes or deletes — it only reads.
//
// Usage:
//   node scripts/export-chat.js                 today only
//   node scripts/export-chat.js --day=2026-08-22
//   node scripts/export-chat.js --all
//
// Output: chat-export-<range>/index.html  (open it in any browser)
//         chat-export-<range>/media/...   (the files themselves)
const fs = require('fs');
const path = require('path');
const { get } = require('@vercel/blob');

const DATA_PREFIX = 'app-data/';
const MEDIA_PREFIX = 'secret-media/';

// Media is embedded directly into the page below this size so the export is
// one self-contained file. Anything larger is written alongside and linked,
// because a base64 data URI is a third larger than the file and a browser has
// to hold the whole page in memory at once.
const INLINE_LIMIT_BYTES = 8 * 1024 * 1024;

const EXTENSIONS = {
  'audio/webm': '.webm',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

function loadToken() {
  const fromFile = path.join(__dirname, '..', '.blob-token');
  if (fs.existsSync(fromFile)) {
    const value = fs.readFileSync(fromFile, 'utf8').trim();
    if (value) return value;
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;

  console.error(
    'No storage token found.\n\n' +
      'Get one from the Vercel dashboard: Storage -> your Blob store -> ".env.local" /\n' +
      'tokens, copy the BLOB_READ_WRITE_TOKEN value, and save it as a single line in:\n' +
      '  ' + fromFile + '\n\n' +
      'That file is gitignored. Do not paste the token into a chat or a commit.'
  );
  process.exit(1);
}

const token = loadToken();

// Vercel's edge bot filter answers 403 with an "x-vercel-mitigated: challenge"
// page when it dislikes the caller, and a burst of requests is exactly what
// trips it — which an export of a whole day's media unavoidably is. It clears
// on its own after a pause, so a blocked read waits and tries again rather
// than abandoning an export that is already half done. A genuinely bad token
// would fail identically every time and simply run out of attempts.
async function withBackoff(label, operation, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt === attempts - 1) break;
      const waitMs = 15000 * 2 ** attempt;
      console.log(`  blocked on ${label} — waiting ${Math.round(waitMs / 1000)}s`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}

async function readJSON(pathname, fallback) {
  // useCache:false for the same reason api/_lib/blobStore.js uses it — the CDN
  // copy of a mutable record can lag behind what was actually written.
  const result = await withBackoff(pathname, () =>
    get(pathname, { access: 'private', useCache: false, token })
  );
  if (!result) return fallback;
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  return JSON.parse(buffer.toString('utf8'));
}

async function readBinary(pathname) {
  const result = await withBackoff(pathname, () => get(pathname, { access: 'private', token }));
  if (!result) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

// ---------- what to export ----------
function parseRange(argv) {
  if (argv.includes('--all')) return { label: 'all', from: 0, to: Infinity };

  const dayArg = argv.find((a) => a.startsWith('--day='));
  const day = dayArg ? dayArg.slice('--day='.length) : null;

  // Local midnight to local midnight, not UTC: "today" has to mean the day the
  // person reading this actually lived through, and the chat timestamps its
  // messages against their clock too.
  const start = day ? new Date(`${day}T00:00:00`) : new Date();
  if (Number.isNaN(start.getTime())) {
    console.error(`Not a date: ${day}. Use --day=YYYY-MM-DD.`);
    process.exit(1);
  }
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  // Formatted from the local date parts, not toISOString(): the range is
  // local midnight to local midnight, but ISO renders it in UTC, so any clock
  // ahead of UTC labelled tonight's export with yesterday's date.
  const pad = (n) => String(n).padStart(2, '0');
  const label = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  return { label, from: start.getTime(), to: end.getTime() };
}

function mediaIdFromUrl(url) {
  const match = /[?&]id=([^&]+)/.exec(url || '');
  return match ? decodeURIComponent(match[1]) : null;
}

async function loadMessages(range) {
  const index = await readJSON(`${DATA_PREFIX}secret-messages-index.json`, { chunkCount: 0 });
  const all = [];
  for (let n = 0; n < (index.chunkCount || 0); n++) {
    const chunk = await readJSON(`${DATA_PREFIX}secret-messages-chunk-${n}.json`, { messages: [] });
    all.push(...chunk.messages);
  }
  return all
    .filter((m) => m.createdAt >= range.from && m.createdAt < range.to)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Media is stored split into pieces, so it is reassembled here the same way
// the app's own player does it. Files sent before the chunked scheme existed
// are a single blob under the bare id.
async function loadMedia(id) {
  const meta = await readJSON(`${MEDIA_PREFIX}media-meta-${id}.json`, null);
  if (!meta) {
    const legacy = await readBinary(`${MEDIA_PREFIX}${id}`);
    return legacy ? { buffer: legacy, contentType: 'application/octet-stream' } : null;
  }
  const parts = [];
  for (let i = 0; i < meta.totalChunks; i++) {
    const part = await readBinary(`${MEDIA_PREFIX}chunk-${id}-${i}`);
    if (!part) return null;
    parts.push(part);
  }
  return { buffer: Buffer.concat(parts), contentType: meta.contentType };
}

// ---------- the page ----------
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clock = (ts) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function renderMessage(msg, media) {
  const mine = msg.senderRole === 'admin';
  const who = mine ? 'admin' : 'guest';
  const parts = [];

  if (media) {
    if (media.kind === 'audio') {
      parts.push(`<audio controls preload="metadata" src="${media.src}"></audio>`);
    } else if (media.kind === 'video') {
      parts.push(`<video controls preload="metadata" src="${media.src}"></video>`);
    } else {
      parts.push(`<img loading="lazy" src="${media.src}" alt="">`);
    }
    parts.push(`<a class="save" href="${media.src}" download="${media.filename}">Save ${escapeHtml(media.filename)}</a>`);
  } else if (msg.mediaUrl) {
    parts.push('<p class="missing">[this file could not be read out of storage]</p>');
  }

  // The message text is copied through exactly as it was sent — not trimmed,
  // corrected, translated or annotated. Only HTML-escaped, so that a message
  // containing < or & displays as itself instead of breaking the page.
  if (msg.text) parts.push(`<p class="text">${escapeHtml(msg.text)}</p>`);

  parts.push(`<span class="meta">${clock(msg.createdAt)}</span>`);
  return `<div class="row ${who}"><div class="bubble">${parts.join('')}</div></div>`;
}

function renderPage(label, rendered, counts) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat export — ${escapeHtml(label)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:24px 12px; background:#0b0b12; color:#e9e9f0;
         font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  header { max-width:760px; margin:0 auto 20px; opacity:.7; font-size:13px; }
  main { max-width:760px; margin:0 auto; display:flex; flex-direction:column; gap:8px; }
  .row { display:flex; }
  .row.admin { justify-content:flex-end; }
  .bubble { max-width:min(80%,520px); padding:8px 12px; border-radius:14px;
            background:#1e2030; display:flex; flex-direction:column; gap:6px; }
  .row.admin .bubble { background:#1f6f4a; }
  .text { margin:0; white-space:pre-wrap; word-wrap:break-word; }
  .meta { align-self:flex-end; font-size:11px; opacity:.6; }
  audio { width:280px; max-width:100%; }
  img, video { max-width:100%; border-radius:8px; display:block; }
  .save { font-size:12px; opacity:.75; color:inherit; }
  .missing { margin:0; font-size:13px; opacity:.6; font-style:italic; }
</style></head>
<body>
<header>${escapeHtml(label)} — ${counts.messages} messages, ${counts.audio} voice notes,
${counts.image} photos, ${counts.video} videos. Exported ${new Date().toLocaleString()}.</header>
<main>
${rendered.join('\n')}
</main>
</body></html>
`;
}

// ---------- run ----------
(async () => {
  const range = parseRange(process.argv.slice(2));
  console.log(`Reading storage for: ${range.label}`);

  const messages = await loadMessages(range);
  if (messages.length === 0) {
    console.log('Nothing found in that range. Try --day=YYYY-MM-DD or --all.');
    return;
  }

  const outDir = path.join(process.cwd(), `chat-export-${range.label}`);
  const mediaDir = path.join(outDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });

  const counts = { messages: messages.length, audio: 0, image: 0, video: 0, unreadable: 0 };
  const rendered = [];

  for (const msg of messages) {
    let media = null;
    const id = mediaIdFromUrl(msg.mediaUrl);
    if (id) {
      const loaded = await loadMedia(id).catch(() => null);
      if (!loaded) {
        counts.unreadable++;
      } else {
        const kind = msg.mediaType || 'image';
        counts[kind] = (counts[kind] || 0) + 1;
        const filename = id + (EXTENSIONS[loaded.contentType] || '');

        // Always written to disk as a real, correctly-named file, so a voice
        // note can be played in anything — not only in this page.
        fs.writeFileSync(path.join(mediaDir, filename), loaded.buffer);

        const src =
          loaded.buffer.length <= INLINE_LIMIT_BYTES
            ? `data:${loaded.contentType};base64,${loaded.buffer.toString('base64')}`
            : `media/${filename}`;
        media = { kind, src, filename };
      }
    }
    rendered.push(renderMessage(msg, media));
  }

  const indexPath = path.join(outDir, 'index.html');
  fs.writeFileSync(indexPath, renderPage(range.label, rendered, counts));

  console.log(
    `\n${counts.messages} messages, ${counts.audio} voice notes, ` +
      `${counts.image} photos, ${counts.video} videos` +
      (counts.unreadable ? `, ${counts.unreadable} file(s) unreadable` : '')
  );
  console.log(`\nOpen: ${indexPath}`);
})().catch((err) => {
  console.error(`\nCould not read storage: ${err?.message || err}`);
  console.error(
    'If this says the store is suspended or the token is unauthorized, the storage\n' +
      'is blocked by the same usage limit as the project, not just the deployment.'
  );
  process.exit(1);
});
