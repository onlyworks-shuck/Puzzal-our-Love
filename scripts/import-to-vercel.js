// One-time import of the exported Netlify history (the export script it came
// from is gone; its output is the backup dir below) into the store used by /api.
//
// Two things this deliberately does NOT do naively:
//
//  1. It MERGES rather than overwrites. The live site has been in use since
//     the cutover, so any users/messages created in the meantime must
//     survive the import. Everything is deduped by id and re-sorted by
//     createdAt, so the old history slots in underneath the new activity.
//
//  2. It converts media out of the old single-blob format into the chunked
//     format. On Netlify a whole file came back in one response (~6MB cap);
//     Vercel's cap is ~4.5MB, and five of the exported videos are larger
//     than that (up to 14.69MB) — served whole they would simply fail. Split
//     into <=4MB pieces, api/secret/media-get.js serves them piece by piece
//     and the client reassembles, which is the path it already uses for
//     anything uploaded post-cutover.
//
// The credential is read from .blob-token (gitignored) or BLOB_READ_WRITE_TOKEN
// and is never printed.
//
// Usage:
//   node scripts/import-to-vercel.js --dry-run
//   node scripts/import-to-vercel.js
const fs = require('fs');
const path = require('path');
const { put, get } = require('@vercel/blob');

const BACKUP_DIR = path.join('C:', 'Users', 'pc', 'Desktop', 'Game-backup-netlify');
const MEDIA_DIR = path.join(BACKUP_DIR, 'media');
const DATA_PREFIX = 'app-data/';
const MEDIA_PREFIX = 'secret-media/';
const MESSAGE_CHUNK_SIZE = 200;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

const DRY_RUN = process.argv.includes('--dry-run');

function loadToken() {
  const fromFile = path.join(__dirname, '..', '.blob-token');
  if (fs.existsSync(fromFile)) {
    const value = fs.readFileSync(fromFile, 'utf8').trim();
    if (value) return value;
  }
  return process.env.BLOB_READ_WRITE_TOKEN || null;
}

const token = loadToken();
if (!token) {
  console.error('No Blob credential found. Put the store\'s read-write token in');
  console.error('.blob-token at the repo root, or set BLOB_READ_WRITE_TOKEN.');
  process.exit(1);
}

const opts = { token };

function readBackup(name) {
  return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name), 'utf8'));
}

async function readRemoteJSON(pathname, fallback) {
  const result = await get(pathname, { access: 'private', ...opts });
  if (!result) return fallback;
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  return JSON.parse(buffer.toString('utf8'));
}

async function writeRemoteJSON(pathname, value) {
  if (DRY_RUN) return;
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    ...opts
  });
}

async function writeRemoteBinary(pathname, buffer, contentType) {
  if (DRY_RUN) return;
  await put(pathname, buffer, {
    access: 'private',
    contentType: contentType || 'application/octet-stream',
    addRandomSuffix: false,
    allowOverwrite: true,
    ...opts
  });
}

// Merge by id, keeping whichever copy is already live if an id somehow
// exists on both sides, then restore chronological order.
function mergeById(existing, incoming, label) {
  const byId = new Map();
  incoming.forEach((item) => byId.set(item.id, item));
  let kept = 0;
  existing.forEach((item) => {
    if (byId.has(item.id)) kept++;
    byId.set(item.id, item);
  });
  const merged = [...byId.values()];
  console.log(
    `${label}: ${incoming.length} from backup + ${existing.length} live ` +
      `(${kept} already present) -> ${merged.length} total`
  );
  return merged;
}

async function importMessages(deletedIds) {
  // A hard delete removes the message from its chunk outright, so an
  // exported chunk should already be free of them — but filter anyway, so
  // "deleted stays deleted" is guaranteed by this script rather than by an
  // assumption about the old site's state.
  const backup = readBackup('messages.json').filter((m) => !deletedIds.has(m.id));

  // Read whatever the live store has accumulated since the cutover.
  const index = await readRemoteJSON(`${DATA_PREFIX}secret-messages-index.json`, { chunkCount: 0 });
  let live = [];
  for (let n = 0; n < index.chunkCount; n++) {
    const chunk = await readRemoteJSON(`${DATA_PREFIX}secret-messages-chunk-${n}.json`, { messages: [] });
    live = live.concat(chunk.messages || []);
  }

  const merged = mergeById(live, backup, 'messages').sort((a, b) => a.createdAt - b.createdAt);

  const chunkCount = Math.max(1, Math.ceil(merged.length / MESSAGE_CHUNK_SIZE));
  for (let n = 0; n < chunkCount; n++) {
    const slice = merged.slice(n * MESSAGE_CHUNK_SIZE, (n + 1) * MESSAGE_CHUNK_SIZE);
    await writeRemoteJSON(`${DATA_PREFIX}secret-messages-chunk-${n}.json`, { messages: slice });
  }
  await writeRemoteJSON(`${DATA_PREFIX}secret-messages-index.json`, { chunkCount });
  console.log(`  wrote ${chunkCount} chunk(s)`);
}

async function importUsers() {
  const backup = readBackup('users.json') || [];
  const live = await readRemoteJSON(`${DATA_PREFIX}users.json`, []);
  const merged = mergeById(live, backup, 'users');
  await writeRemoteJSON(`${DATA_PREFIX}users.json`, merged);
}

async function importRoles() {
  const backup = readBackup('secret-roles.json') || {};
  const live = await readRemoteJSON(`${DATA_PREFIX}secret-roles.json`, {});
  // Live roles win: they were granted against the current JWT_SECRET.
  const merged = { ...backup, ...live };
  console.log(
    `roles: ${Object.keys(backup).length} from backup + ${Object.keys(live).length} live ` +
      `-> ${Object.keys(merged).length} total`
  );
  await writeRemoteJSON(`${DATA_PREFIX}secret-roles.json`, merged);
}

async function importDeletions() {
  const backup = readBackup('secret-deletions.json') || { events: [] };
  const live = await readRemoteJSON(`${DATA_PREFIX}secret-deletions.json`, { events: [] });
  const seen = new Set();
  const events = [...(backup.events || []), ...(live.events || [])]
    .filter((e) => {
      const key = `${e.id}:${e.deletedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.deletedAt - b.deletedAt);
  console.log(`deletions: ${events.length} events`);
  await writeRemoteJSON(`${DATA_PREFIX}secret-deletions.json`, { events });

  // A message deleted on the old site must not reappear via this import.
  return new Set(events.map((e) => e.id));
}

async function importMedia() {
  const manifest = readBackup('media-manifest.json');
  let split = 0;
  let done = 0;

  for (const item of manifest) {
    const buffer = fs.readFileSync(path.join(MEDIA_DIR, item.id));
    const totalChunks = Math.max(1, Math.ceil(buffer.length / MAX_CHUNK_BYTES));
    if (totalChunks > 1) split++;

    for (let i = 0; i < totalChunks; i++) {
      const piece = buffer.subarray(i * MAX_CHUNK_BYTES, (i + 1) * MAX_CHUNK_BYTES);
      await writeRemoteBinary(`${MEDIA_PREFIX}chunk-${item.id}-${i}`, piece);
    }
    await writeRemoteJSON(`${MEDIA_PREFIX}media-meta-${item.id}.json`, {
      contentType: item.contentType,
      totalChunks,
      totalSize: buffer.length
    });

    done++;
    if (done % 10 === 0 || done === manifest.length) {
      console.log(`  media ${done}/${manifest.length}`);
    }
  }
  console.log(`media: ${manifest.length} files (${split} split into multiple pieces)`);
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (nothing will be written) ===\n' : '=== IMPORTING ===\n');
  const deletedIds = await importDeletions();
  await importMessages(deletedIds);
  await importUsers();
  await importRoles();
  await importMedia();
  console.log(DRY_RUN ? '\nDry run complete — no changes made.' : '\nImport complete.');
}

main().catch((err) => {
  console.error('IMPORT FAILED:', err);
  process.exit(1);
});
