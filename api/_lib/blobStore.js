const { getStore } = require('@netlify/blobs');

// The storage layer. Everything above this file — all of store.js and all
// twelve handlers — is written against the eight functions exported at the
// bottom, so no handler ever touches `@netlify/blobs` directly.
//
// Handlers address blobs by pathname ("app-data/users.json"); Netlify Blobs
// has named stores holding bare keys (store "app-data", key "users"). This
// file is where that gap is closed.
//
// The mapping below is not a stylistic choice. A live store already holds
// this chat's history under the bare-key names it has used since July
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
// registrations once already, on a deployment that took the eventually
// consistent default.
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

  // Netlify's automatic Blobs context injection is unreliable here (a known
  // platform issue: https://answers.netlify.com/t/156201) and is never
  // injected at all on CLI deploys, which is how every site running this
  // code is published. BLOBS_SITE_ID / BLOBS_TOKEN are set on each site for
  // exactly that reason — without them every function throws
  // MissingBlobsEnvironmentError and registration fails outright.
  //
  // They also decide *which* site's store this deployment reads: point them
  // at another site and this code serves that site's conversation. Two
  // deployments sharing one pair share one dataset; two different pairs are
  // two separate datasets that never sync.
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

// Every object whose pathname starts with `prefix`. Returns the pathname-shaped
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
  // Reported by the health probe. Kept here so the probe can never disagree
  // with the layer that actually did the reading.
  host: 'netlify',
  readJSON,
  writeJSON,
  readBinary,
  readBinaryWithType,
  writeBinary,
  listPrefix,
  removeMany,
  remove
};
