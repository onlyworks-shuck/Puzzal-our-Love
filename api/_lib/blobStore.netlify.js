const { getStore } = require('@netlify/blobs');

// Netlify Blobs driver. Implements the same eight functions as
// blobStore.vercel.js so store.js never has to know which host it is on.
//
// The two hosts address blobs differently and this file is where that gap is
// closed:
//
//   Vercel  — one flat namespace of pathnames: "app-data/users.json"
//   Netlify — named stores holding bare keys: store "app-data", key "users"
//
// The mapping below is not a stylistic choice. The live Netlify store already
// holds this chat's history under the bare-key names it has used since July
// (`users`, `secret-messages-chunk-0`, `media-meta-<id>`, …). Get the
// translation wrong in either direction and the app reads an empty store and
// renders an empty conversation while the real data sits untouched beside it.
const DATA_STORE = 'app-data';
const MEDIA_STORE = 'secret-media';
const DATA_PREFIX = 'app-data/';
const MEDIA_PREFIX = 'secret-media/';

// Strong consistency everywhere, including media.
//
// Netlify Blobs reads are eventually consistent by default, served from a
// CDN edge that can hand back a copy from before the last write. Every
// mutable record here is updated read-modify-write (append a message to its
// chunk, add a user, record a hide, update an upload manifest), so a stale
// read means writing back a version missing whatever changed in between —
// silently losing data. That exact failure cost this project a batch of
// registrations on the other host before `useCache: false` was added there.
//
// Media blobs are written once and never modified, so they would be safe on
// eventual reads — but `list()` is not: deleteAnyMedia() deletes a media
// item, re-lists to confirm nothing survived, and throws if anything does. A
// stale list there reports a successful delete as a failure and shows the
// user an error for work that actually completed. Correctness wins over the
// latency saved.
function storeOptions(name) {
  const { BLOBS_SITE_ID: siteID, BLOBS_TOKEN: token } = process.env;
  const options = { name, consistency: 'strong' };

  // Netlify's automatic Blobs context injection is unreliable on this site
  // (a known platform issue: https://answers.netlify.com/t/156201) and is
  // never injected at all on CLI deploys, which is how this site is
  // published. BLOBS_SITE_ID / BLOBS_TOKEN are set on the site for exactly
  // this reason — without them every function throws
  // MissingBlobsEnvironmentError and registration fails outright.
  if (siteID && token) return { ...options, siteID, token };
  return options;
}

function dataStore() {
  return getStore(storeOptions(DATA_STORE));
}

function mediaStore() {
  return getStore(storeOptions(MEDIA_STORE));
}

// pathname -> the store that holds it and the key it lives under.
//
// Only the app-data side drops a ".json" suffix, because that is the side
// whose existing keys never had one. Media keys are kept verbatim: the
// upload manifests genuinely are named "upload-manifest-<id>.json" in the
// store, and stripping that would orphan every one of them.
function resolve(pathname) {
  if (pathname.startsWith(MEDIA_PREFIX)) {
    return { store: mediaStore(), key: pathname.slice(MEDIA_PREFIX.length) };
  }
  if (pathname.startsWith(DATA_PREFIX)) {
    return { store: dataStore(), key: pathname.slice(DATA_PREFIX.length).replace(/\.json$/, '') };
  }
  // Anything outside the two known namespaces (the health probe writes
  // "healthcheck/probe.json") lands in the data store under its full path.
  // Netlify Blobs keys may contain "/", so this needs no further mangling.
  return { store: dataStore(), key: pathname };
}

// The prefix form of resolve(). Deliberately does NOT strip ".json": a
// prefix is matched with startsWith, so trimming it here would widen the
// match instead of narrowing it.
function resolvePrefix(prefix) {
  if (prefix.startsWith(MEDIA_PREFIX)) {
    return { store: mediaStore(), keyPrefix: prefix.slice(MEDIA_PREFIX.length), pathPrefix: MEDIA_PREFIX };
  }
  if (prefix.startsWith(DATA_PREFIX)) {
    return { store: dataStore(), keyPrefix: prefix.slice(DATA_PREFIX.length), pathPrefix: DATA_PREFIX };
  }
  return { store: dataStore(), keyPrefix: prefix, pathPrefix: '' };
}

async function readJSON(pathname, fallback) {
  const { store, key } = resolve(pathname);
  const value = await store.get(key, { type: 'json', consistency: 'strong' });
  return value ?? fallback;
}

async function writeJSON(pathname, value) {
  const { store, key } = resolve(pathname);
  await store.setJSON(key, value);
}

async function readBinary(pathname) {
  const { store, key } = resolve(pathname);
  const result = await store.get(key, { type: 'arrayBuffer', consistency: 'strong' });
  return result ? Buffer.from(result) : null;
}

// Same as readBinary, but also returns the content type stored alongside the
// object. Netlify Blobs has no native content-type field, so it is kept in
// the blob's metadata (see writeBinary) — the same place the pre-cutover
// Netlify code put it, which is what keeps the 38 media files already in
// this store playable.
async function readBinaryWithType(pathname) {
  const { store, key } = resolve(pathname);
  const result = await store.getWithMetadata(key, { type: 'arrayBuffer', consistency: 'strong' });
  if (!result) return null;
  return {
    buffer: Buffer.from(result.data),
    contentType: result.metadata?.contentType || 'application/octet-stream'
  };
}

async function writeBinary(pathname, buffer, contentType) {
  const { store, key } = resolve(pathname);
  await store.set(key, buffer, {
    metadata: { contentType: contentType || 'application/octet-stream' }
  });
}

// Every object whose pathname starts with `prefix`. Returns the Vercel-shaped
// { pathname } objects the callers in store.js expect, so a blob found here
// can be handed straight back to removeMany().
//
// An empty prefix would match an entire store, so callers must never pass
// one — the guard is here rather than only at the call sites because the
// blast radius (deleting every blob) is total.
async function listPrefix(prefix) {
  if (!prefix) throw new Error('listPrefix requires a non-empty prefix');

  const { store, keyPrefix, pathPrefix } = resolvePrefix(prefix);
  if (!keyPrefix) throw new Error('listPrefix requires a non-empty key prefix');

  const { blobs } = await store.list({ prefix: keyPrefix });
  return (blobs || []).map((blob) => ({ pathname: `${pathPrefix}${blob.key}`, size: blob.size }));
}

// Netlify Blobs has no batch delete, so this is N calls. Bounded concurrency
// keeps a large delete from opening a hundred sockets at once while still
// finishing well inside the 10s function limit this host allows — a 100MB
// video is 25 chunks plus its metadata, which lands in well under a second.
const DELETE_CONCURRENCY = 8;

async function removeMany(pathnames) {
  const unique = [...new Set(pathnames)].filter(Boolean);
  if (unique.length === 0) return 0;

  for (let i = 0; i < unique.length; i += DELETE_CONCURRENCY) {
    const batch = unique.slice(i, i + DELETE_CONCURRENCY);
    // An already-absent blob is not a failure: deleteAnyMedia() deliberately
    // deletes across four overlapping prefixes and re-lists afterwards to
    // decide whether the erase actually succeeded. That verification is the
    // authority here, not the individual delete calls.
    await Promise.all(batch.map((pathname) => remove(pathname).catch(() => {})));
  }
  return unique.length;
}

async function remove(pathname) {
  const { store, key } = resolve(pathname);
  await store.delete(key);
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
