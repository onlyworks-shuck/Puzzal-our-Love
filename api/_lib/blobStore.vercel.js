const { put, get, del, list } = require('@vercel/blob');

// Everything is stored as a 'private' blob (requires the store's read-write
// token to fetch), addressed directly by pathname — get()/put()/del() all
// accept a plain pathname, no need to track/resolve URLs ourselves.
async function streamToBuffer(stream) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

// useCache:false is required, not an optimisation choice. get() otherwise
// serves from the CDN cache, which can hand back a stale copy of a blob
// that was just written. Every mutable record here is updated by
// read-modify-write (append a message to its chunk, add a user, add a role,
// hide a message), so a stale read means writing back a version that is
// missing whatever changed in between — silently losing data — and it makes
// the read-back verification in addUser/appendMessageToStore fail against
// content that was actually stored correctly. That surfaced as
// registrations failing roughly two times in three.
//
// Binary media below deliberately keeps the cache: those blobs are written
// once and never modified, so there is no stale version to read.
async function readJSON(pathname, fallback) {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (!result) return fallback;
  const buffer = await streamToBuffer(result.stream);
  return JSON.parse(buffer.toString('utf8'));
}

async function writeJSON(pathname, value) {
  await put(pathname, JSON.stringify(value), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true
  });
}

async function readBinary(pathname) {
  const result = await get(pathname, { access: 'private' });
  if (!result) return null;
  return streamToBuffer(result.stream);
}

// Same as readBinary, but also returns the content type Vercel Blob stored
// alongside the object (set via put()'s contentType option) instead of
// requiring a separate metadata record.
async function readBinaryWithType(pathname) {
  const result = await get(pathname, { access: 'private' });
  if (!result) return null;
  const buffer = await streamToBuffer(result.stream);
  return { buffer, contentType: result.blob.contentType };
}

async function writeBinary(pathname, buffer, contentType) {
  await put(pathname, buffer, {
    access: 'private',
    contentType: contentType || 'application/octet-stream',
    addRandomSuffix: false,
    allowOverwrite: true
  });
}

// Every object whose pathname starts with `prefix`, following pagination to
// the end. Deletion relies on this to find what actually exists rather than
// trusting a metadata record that may itself be missing or half-written.
//
// An empty prefix would match the entire store, so callers must never pass
// one — the guard is here rather than only at the call sites because the
// blast radius (deleting every blob) is total.
async function listPrefix(prefix) {
  if (!prefix) throw new Error('listPrefix requires a non-empty prefix');

  const found = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    found.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return found;
}

// del() accepts an array, but is batched here so a single call can't grow
// unboundedly with history.
async function removeMany(pathnames) {
  const unique = [...new Set(pathnames)].filter(Boolean);
  if (unique.length === 0) return 0;

  const BATCH = 100;
  for (let i = 0; i < unique.length; i += BATCH) {
    await del(unique.slice(i, i + BATCH));
  }
  return unique.length;
}

async function remove(pathname) {
  await del(pathname);
}

module.exports = {
  readJSON,
  writeJSON,
  readBinary,
  readBinaryWithType,
  writeBinary,
  listPrefix,
  removeMany,
  remove
};
