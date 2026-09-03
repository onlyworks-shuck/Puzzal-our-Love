const crypto = require('crypto');
const blobStore = require('./blobStore');

const DATA_PREFIX = 'app-data/';
const MEDIA_PREFIX = 'secret-media/';

function dataKey(name) {
  return `${DATA_PREFIX}${name}.json`;
}

// Media ids are always crypto.randomUUID() values. This is enforced rather
// than assumed because the id is pulled back out of a message's mediaUrl,
// and that url arrives from the client. Deletion resolves what to erase by
// listing blobs under a prefix built from this id, so an empty or crafted
// id ("", "..", a bare "-") would widen that prefix and delete media
// belonging to other messages — or, when empty, every media object in the
// store. Anything that isn't a plain uuid is rejected outright.
const MEDIA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidMediaId(id) {
  return typeof id === 'string' && MEDIA_ID_RE.test(id);
}

function mediaIdFromUrl(url) {
  if (!url) return null;
  const match = /[?&]id=([^&]+)/.exec(url);
  if (!match) return null;
  const id = decodeURIComponent(match[1]);
  return isValidMediaId(id) ? id : null;
}

// ---------- Users ----------
async function getUsers() {
  return blobStore.readJSON(dataKey('users'), []);
}

async function saveUsers(users) {
  await blobStore.writeJSON(dataKey('users'), users);
}

async function findUserByUsername(username) {
  const users = await getUsers();
  return users.find((u) => u.username === username) || null;
}

async function findUserById(id) {
  const users = await getUsers();
  return users.find((u) => u.id === id) || null;
}

// Same read-modify-write hazard addMessage had: Blob storage has no
// compare-and-swap, so two registrations landing at the same instant (e.g.
// two tabs opened together) could race and one write clobber the other,
// silently dropping a user. Verify-and-retry like appendMessageToStore does.
async function addUser(user, attempt = 0) {
  const users = await getUsers();
  users.push(user);
  await saveUsers(users);

  const verify = await getUsers();
  if (!verify.some((u) => u.id === user.id)) {
    if (attempt >= 3) throw new Error('Could not create user after retries');
    await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 120));
    return addUser(user, attempt + 1);
  }
  return user;
}

// ---------- Secret channel unlock state ----------
// Keyed by userId -> 'guest' (no delete rights) | 'admin' (full delete
// rights). Permissions are derived server-side from the password tier used.
async function getRoles() {
  return blobStore.readJSON(dataKey('secret-roles'), {});
}

async function setUserRole(userId, role) {
  const roles = await getRoles();
  roles[userId] = role;
  await blobStore.writeJSON(dataKey('secret-roles'), roles);
}

async function getUserRole(userId) {
  const roles = await getRoles();
  return roles[userId] || null;
}

// The caller's own role plus the set of admin ids, from a single read of
// the roles record. Reads need both — the role to decide visibility, the
// admin set to resolve the tier of messages sent before senderRole existed.
async function getViewerContext(userId) {
  const roles = await getRoles();
  const adminIds = new Set(Object.keys(roles).filter((id) => roles[id] === 'admin'));
  return { userId, role: roles[userId] || null, adminIds };
}

async function isUnlocked(userId) {
  return !!(await getUserRole(userId));
}

// ---------- Live session state: who is here, and how far each side has read ----------
// One small record answers both of the chat's live questions, so a poll costs
// a single read no matter how much history exists:
//
//   participants: userId -> { role, lastSeen }   (drives the Online/Offline header)
//   receipts:     role   -> { read }             (drives the blue ticks)
//
// Both are answered *about the other side*: the guest watches the admin, the
// admin watches the guests. Which side that is depends on the caller's tier,
// which is a server-side fact, so it is resolved here rather than trusted from
// the client.
const SESSION_KEY = dataKey('secret-session');

// Read receipts are stored per role rather than per user, as a single
// high-water mark: "everyone on this side has read everything sent up to this
// moment". A watermark is all the blue tick ever needs (a message is read if
// it predates it), it collapses several people sharing the guest password into
// the one answer the sender cares about, and — unlike a per-message or
// per-user record — it cannot grow with history or with how many devices have
// ever opened the chat.
function emptySession() {
  return { participants: {}, receipts: { guest: { read: 0 }, admin: { read: 0 } } };
}

// Tolerates a missing or half-shaped record so a first run, or a record left
// by an earlier version, reads as "nobody here, nothing read yet" instead of
// throwing on every poll.
function normalizeSession(raw) {
  const session = emptySession();
  if (!raw || typeof raw !== 'object') return session;
  if (raw.participants && typeof raw.participants === 'object') {
    session.participants = { ...raw.participants };
  }
  for (const role of ['guest', 'admin']) {
    const read = raw.receipts?.[role]?.read;
    if (typeof read === 'number' && read > 0) session.receipts[role].read = read;
  }
  return session;
}

function peerRoleOf(role) {
  return role === 'admin' ? 'guest' : 'admin';
}

// A heartbeat counts as "still here" for this long. Comfortably more than
// three heartbeat intervals, so a couple of dropped requests on a phone
// connection never flicker someone to offline while they are still watching.
const PRESENCE_TTL_MS = 15000;

// The chat polls far faster than this; writing a heartbeat on every poll
// would mean a storage write every 1.5s per person for no added accuracy.
// A poll only writes once the previous heartbeat is this old.
const PRESENCE_HEARTBEAT_MS = 4000;

// Anyone silent this long is dropped from the record entirely. Guest ids are
// per-browser and effectively unlimited over time, so without this the record
// would grow forever with people who were here once.
const PRESENCE_RETENTION_MS = 10 * 60 * 1000;

async function getSession() {
  return normalizeSession(await blobStore.readJSON(SESSION_KEY, null));
}

function isPresenceFresh(entry, now) {
  return !!entry && typeof entry.lastSeen === 'number' && now - entry.lastSeen < PRESENCE_TTL_MS;
}

// Whether anyone on the *other* side is currently here. Guests watch the
// admin; the admin watches the guests, and is online to them if any one of
// them is here. The caller is always excluded — several people can share the
// guest password, but your own heartbeat must never make you look online to
// yourself.
function isPeerOnline(session, { userId, role }, now = Date.now()) {
  const peerRole = peerRoleOf(role);
  return Object.entries(session?.participants || {}).some(
    ([id, entry]) => id !== userId && entry && entry.role === peerRole && isPresenceFresh(entry, now)
  );
}

// How far the *other* side has read. The caller compares it against their own
// messages' timestamps: anything sent before this has been seen. Reading the
// other role's bucket is what keeps a reader from marking their own messages
// as read — and what stops one guest's reading from turning another guest's
// ticks blue, since a guest's messages are only ever read by the admin.
function peerReadThrough(session, { role }) {
  return session?.receipts?.[peerRoleOf(role)]?.read || 0;
}

// The one write on the polling path, doing two jobs at once:
//
//   heartbeat — "I am here", throttled, because the chat polls far faster than
//               presence needs to be recorded and every poll writing would be
//               a storage write every 1.5s per person for no added accuracy.
//   ack       — "I have now seen everything sent up to <ack>", written the
//               moment it moves. It only moves when a message the reader had
//               not seen actually arrives, so this is rare *and* immediate:
//               exactly the two properties a read receipt needs.
//
// `ack` is the timestamp of the newest message the caller actually holds, not
// the current time — a reader must never acknowledge a message that was sent
// in the moment between their last fetch and this request, or the sender would
// see it marked read before it had reached anyone.
//
// Like every other record here this is a read-modify-write with no
// compare-and-swap available, so two of these landing together can clobber one
// another. Neither job is harmed by that: a lost heartbeat falls back to the
// previous one and is restored well inside PRESENCE_TTL_MS, and a lost ack is
// re-sent on the very next poll because the client keeps sending its watermark
// until the server's answer catches up.
async function touchSession(userId, role, ack = 0) {
  const now = Date.now();
  const session = await getSession();

  const mine = session.participants[userId];
  const heartbeatDue = !mine || mine.role !== role || now - mine.lastSeen >= PRESENCE_HEARTBEAT_MS;

  // A reader can only ever acknowledge messages that already exist, so an ack
  // from a wrong or hostile clock is clamped to now rather than trusted.
  const ackTs = typeof ack === 'number' && Number.isFinite(ack) ? Math.min(ack, now) : 0;
  const ackDue = ackTs > session.receipts[role].read;

  if (!heartbeatDue && !ackDue) return session;

  if (heartbeatDue) {
    // Anyone silent past the retention window is dropped. Guest ids are
    // per-browser and effectively unlimited over time, so without this the
    // participant list would grow forever with people who were here once.
    // Receipts are untouched by this on purpose: they live per role, not per
    // user, so a reader going away never un-reads what they already read.
    for (const [id, entry] of Object.entries(session.participants)) {
      const stale = !entry || typeof entry.lastSeen !== 'number' || now - entry.lastSeen >= PRESENCE_RETENTION_MS;
      if (stale && id !== userId) delete session.participants[id];
    }
    session.participants[userId] = { role, lastSeen: now };
  }
  if (ackDue) session.receipts[role].read = ackTs;

  await blobStore.writeJSON(SESSION_KEY, session);
  return session;
}

// Explicit goodbye, sent when someone leaves the chat or backgrounds the tab.
// The TTL above would expire them anyway; this just makes the other side see
// it immediately instead of up to PRESENCE_TTL_MS later. Only presence is
// dropped — what this user has already read stays read.
async function clearPresence(userId) {
  const session = await getSession();
  if (!(userId in session.participants)) return session;
  delete session.participants[userId];
  await blobStore.writeJSON(SESSION_KEY, session);
  return session;
}

// ---------- Messages (chunked storage) ----------
// Messages are stored in fixed-size pages ("chunks") of at most
// MESSAGE_CHUNK_SIZE messages each, plus a tiny index blob tracking how many
// chunks exist. Only the most recent chunk is ever touched by a send, so
// every read/write stays small and fast no matter how long the conversation
// has been running, and the window in which two concurrent sends can
// collide shrinks to "the same chunk" instead of "the entire history".
const MESSAGE_CHUNK_SIZE = 200;
const MESSAGE_INDEX_KEY = dataKey('secret-messages-index');
const DELETIONS_KEY = dataKey('secret-deletions');
const DELETIONS_LOG_CAP = 300;
const HIDES_KEY = dataKey('secret-hides');
const HIDES_LOG_CAP = 300;

// ---------- Viewer-scoped visibility ----------
// Two different deletes exist. The guest tier can only *hide* its own
// messages: the message stays in storage and stays visible to the admin,
// flagged so the admin can see it was withdrawn. Only the admin tier can
// erase anything for real (see deleteMessage). So what a reader is allowed
// to see depends on who is asking, and every read path has to be told.
function isVisibleTo(message, viewer) {
  if (!viewer || viewer.role === 'admin') return true;
  return !(message.hiddenFor || []).includes(viewer.userId);
}

// A message sent while holding the admin password is untouchable by the
// guest tier — guests may hide each other's messages and their own, but
// have no control at all over the admin's. The role is stamped on the
// message when it is sent rather than looked up later, so a sender who
// changes tier afterwards cannot retroactively protect or expose messages
// they already sent.
function isAdminMessage(message) {
  return message.senderRole === 'admin';
}

// The admin needs `hiddenFor` to render the withdrawn marker; nobody else
// should learn who hid what, so it is stripped for the guest tier. Guests
// instead get `canHide`, which is the permission decided here on the server
// — the client only uses it to decide whether to draw the button, and the
// same rule is enforced again when a hide is actually attempted.
function projectForViewer(message, viewer) {
  if (viewer && viewer.role === 'admin') return message;
  const { hiddenFor, senderRole, ...rest } = message;

  // Messages sent before senderRole was stamped carry no tier, so the
  // sender's current one is used instead — passed in as a set by the caller
  // so this stays a plain lookup rather than a per-message storage read.
  const senderIsAdmin = senderRole
    ? senderRole === 'admin'
    : !!(viewer && viewer.adminIds && viewer.adminIds.has(message.senderId));

  return { ...rest, canHide: !senderIsAdmin };
}

function forViewer(messages, viewer) {
  return messages.filter((m) => isVisibleTo(m, viewer)).map((m) => projectForViewer(m, viewer));
}

function chunkKey(n) {
  return dataKey(`secret-messages-chunk-${n}`);
}

async function getMessageIndex() {
  return blobStore.readJSON(MESSAGE_INDEX_KEY, { chunkCount: 0 });
}

async function getChunk(n) {
  return blobStore.readJSON(chunkKey(n), { messages: [] });
}

async function saveChunk(n, chunk) {
  await blobStore.writeJSON(chunkKey(n), chunk);
}

async function appendMessageToStore(message, attempt = 0) {
  const index = await getMessageIndex();
  let chunkN = Math.max(0, index.chunkCount - 1);
  let chunk = index.chunkCount === 0 ? { messages: [] } : await getChunk(chunkN);

  if (chunk.messages.length >= MESSAGE_CHUNK_SIZE) {
    chunkN += 1;
    chunk = { messages: [] };
  }

  chunk.messages.push(message);
  await saveChunk(chunkN, chunk);

  if (chunkN + 1 > index.chunkCount) {
    await blobStore.writeJSON(MESSAGE_INDEX_KEY, { chunkCount: chunkN + 1 });
  }

  // Blob storage has no compare-and-swap, so a concurrent send hitting the
  // same chunk could still clobber this write. Read the chunk back and, if
  // our message isn't there, someone else's write won — retry from scratch
  // a few times. Cheap insurance for how rarely two sends land in the same
  // few-hundred-ms window in a small private chat.
  const verify = await getChunk(chunkN);
  if (!verify.messages.some((m) => m.id === message.id)) {
    if (attempt >= 3) throw new Error('Could not save message after retries');
    await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 120));
    return appendMessageToStore(message, attempt + 1);
  }
}

async function addMessage({ senderId, senderRole, text, mediaUrl, mediaType }) {
  const message = {
    id: crypto.randomUUID(),
    senderId,
    // Recorded at send time so admin messages stay protected from the guest
    // tier permanently, independent of any later role change.
    senderRole: senderRole === 'admin' ? 'admin' : 'guest',
    text: text || '',
    mediaUrl: mediaUrl || null,
    mediaType: mediaType || null,
    createdAt: Date.now()
  };
  await appendMessageToStore(message);
  return message;
}

// Most recent `limit` messages, oldest first. hasMore tells the caller
// whether older messages exist beyond what was returned (for pagination).
// Filtering happens before counting, so a guest who has hidden a lot of
// their own messages still receives a full window rather than a short one.
async function getRecentMessages(limit = 200, viewer = null) {
  const index = await getMessageIndex();
  let acc = [];
  let n = index.chunkCount - 1;
  while (n >= 0 && acc.length < limit) {
    const chunk = await getChunk(n);
    acc = [...forViewer(chunk.messages, viewer), ...acc];
    n--;
  }
  const hasMore = acc.length > limit || n >= 0;
  if (acc.length > limit) acc = acc.slice(acc.length - limit);
  return { messages: acc, hasMore };
}

// All messages strictly newer than sinceTs, oldest first. Only walks
// chunks that could actually contain something newer than the cursor, so
// cost stays proportional to "how much is new" rather than total history.
async function getMessagesSince(sinceTs, viewer = null) {
  const index = await getMessageIndex();
  let acc = [];
  let n = index.chunkCount - 1;
  while (n >= 0) {
    const chunk = await getChunk(n);
    if (chunk.messages.length === 0) {
      n--;
      continue;
    }
    const newer = forViewer(chunk.messages.filter((m) => m.createdAt > sinceTs), viewer);
    acc = [...newer, ...acc];
    const firstTs = chunk.messages[0].createdAt;
    if (firstTs <= sinceTs) break; // earlier chunks are strictly older
    n--;
  }
  return acc;
}

// Up to `limit` messages strictly older than beforeTs, oldest first, for
// "load older messages" pagination.
async function getMessagesBefore(beforeTs, limit = 100, viewer = null) {
  const index = await getMessageIndex();
  let acc = [];
  let n = index.chunkCount - 1;
  let hasMore = false;
  while (n >= 0) {
    const chunk = await getChunk(n);
    const older = forViewer(chunk.messages.filter((m) => m.createdAt < beforeTs), viewer);
    acc = [...older, ...acc];
    if (acc.length >= limit) {
      hasMore = acc.length > limit || n > 0;
      acc = acc.slice(acc.length - limit);
      break;
    }
    n--;
  }
  return { messages: acc, hasMore };
}

async function recordDeletion(messageId) {
  const log = await blobStore.readJSON(DELETIONS_KEY, { events: [] });
  log.events.push({ id: messageId, deletedAt: Date.now() });
  if (log.events.length > DELETIONS_LOG_CAP) {
    log.events = log.events.slice(log.events.length - DELETIONS_LOG_CAP);
  }
  await blobStore.writeJSON(DELETIONS_KEY, log);
}

// Ids deleted since sinceTs, for clients that already hold the older
// message in local state. If a client has been away longer than the log's
// retention window it will simply pick up the current state on its next
// full reload (e.g. reopening the chat), so the bounded log never grows.
async function getDeletionsSince(sinceTs) {
  const log = await blobStore.readJSON(DELETIONS_KEY, { events: [] });
  return log.events.filter((e) => e.deletedAt > sinceTs).map((e) => e.id);
}

// ---------- Soft delete (guest tier) ----------
// Hides a message from the caller's own view. Nothing is erased: the
// message stays in storage and stays visible to the admin, carrying a
// record of who withdrew it.
//
// Several people can share the guest password, each on their own device
// with their own identity. Any of them may hide their own messages and each
// other's — but never one sent by the admin, which the guest tier has no
// control over whatsoever. That single exception is the whole permission
// model, and it is enforced here rather than only in the UI.
async function hideMessageForUser(messageId, userId) {
  const index = await getMessageIndex();
  for (let n = index.chunkCount - 1; n >= 0; n--) {
    const chunk = await getChunk(n);
    const idx = chunk.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) continue;

    const message = chunk.messages[idx];

    // Messages predating senderRole carry no stamp; fall back to the
    // sender's current tier so old admin messages are protected too.
    const senderIsAdmin = message.senderRole
      ? isAdminMessage(message)
      : (await getUserRole(message.senderId)) === 'admin';
    if (senderIsAdmin) {
      return { error: "You cannot delete the admin's messages" };
    }

    const hiddenFor = new Set(message.hiddenFor || []);
    if (!hiddenFor.has(userId)) {
      message.hiddenFor = [...hiddenFor, userId];
      await saveChunk(n, chunk);
      await recordHide(messageId, userId);
    }
    return { ok: true };
  }
  return { error: 'Message not found' };
}

async function recordHide(messageId, userId) {
  const log = await blobStore.readJSON(HIDES_KEY, { events: [] });
  log.events.push({ id: messageId, userId, hiddenAt: Date.now() });
  if (log.events.length > HIDES_LOG_CAP) {
    log.events = log.events.slice(log.events.length - HIDES_LOG_CAP);
  }
  await blobStore.writeJSON(HIDES_KEY, log);
}

// Hide events since a cursor, so a poll can update both sides live: the
// guest's own view drops the message, and the admin's view grows the
// withdrawn marker without either needing to reload the conversation.
async function getHidesSince(sinceTs) {
  const log = await blobStore.readJSON(HIDES_KEY, { events: [] });
  return log.events.filter((e) => e.hiddenAt > sinceTs);
}

// Hard delete: the message is removed from its chunk entirely (no
// tombstone) and its media blob, if any, is erased too. Only the
// admin-tier role may delete — the guest tier has no delete capability at
// all, for its own messages or the other side's. Searches chunks most
// recent first since deletes usually target recent messages.
async function deleteMessage(messageId, requesterRole) {
  if (requesterRole !== 'admin') return { error: 'Delete is not permitted for this account' };

  const index = await getMessageIndex();
  for (let n = index.chunkCount - 1; n >= 0; n--) {
    const chunk = await getChunk(n);
    const idx = chunk.messages.findIndex((m) => m.id === messageId);
    if (idx === -1) continue;

    const message = chunk.messages[idx];

    // Media first, message second. The old order removed the message and
    // then swallowed any media-deletion failure, so a failed erase left a
    // file in the store that nothing referenced any more and no one could
    // ever target again — undeletable by design. Deleting the media first
    // means a failure here aborts the whole operation with the message
    // still intact and still retryable.
    const mediaId = mediaIdFromUrl(message.mediaUrl);
    if (mediaId) {
      try {
        await deleteAnyMedia(mediaId);
      } catch (err) {
        return { error: 'Could not delete the attached file. Nothing was removed — please try again.' };
      }
    }

    chunk.messages.splice(idx, 1);
    await saveChunk(n, chunk);
    await recordDeletion(messageId);

    return { ok: true };
  }

  return { error: 'Message not found' };
}

// ---------- Media blobs (legacy single-blob scheme) ----------
// Pre-dates chunked storage below. Kept read-only (never written again)
// purely so photos/videos sent before the chunked scheme shipped keep
// working.
async function saveMedia(id, buffer, contentType) {
  await blobStore.writeBinary(`${MEDIA_PREFIX}${id}`, buffer, contentType);
}

async function getMedia(id) {
  const result = await blobStore.readBinaryWithType(`${MEDIA_PREFIX}${id}`);
  if (!result) return null;
  return { buffer: result.buffer, contentType: result.contentType || 'application/octet-stream' };
}

// ---------- Chunked media storage (current scheme) ----------
// Large files are both uploaded and served back as a sequence of small
// pieces instead of one shot, to stay under Vercel's ~4.5MB request/response
// cap. Each piece is stashed under its own blob key permanently (never
// stitched into one big blob — a stitched file could never be read back in
// a single response either). Chunks for a given media id are always
// written sequentially by the same client, so there's no concurrent-writer
// race to worry about here the way there is for messages.
async function saveMediaChunk(id, index, buffer) {
  await blobStore.writeBinary(`${MEDIA_PREFIX}chunk-${id}-${index}`, buffer);
}

async function getMediaChunk(id, index) {
  return blobStore.readBinary(`${MEDIA_PREFIX}chunk-${id}-${index}`);
}

async function deleteMediaChunks(id, count) {
  await Promise.all(
    Array.from({ length: count }, (_, i) => blobStore.remove(`${MEDIA_PREFIX}chunk-${id}-${i}`).catch(() => {}))
  );
}

async function saveMediaMeta(id, meta) {
  await blobStore.writeJSON(`${MEDIA_PREFIX}media-meta-${id}.json`, meta);
}

async function getMediaMeta(id) {
  return blobStore.readJSON(`${MEDIA_PREFIX}media-meta-${id}.json`, null);
}

// ---------- Upload manifests ----------
// Records the size of each chunk as it lands, so finishing an upload can
// verify completeness by reading one small JSON file. The previous version
// downloaded every chunk back out of storage to add up the bytes, which
// meant finishing a 20MB video pulled 20MB through the function and a 100MB
// one pulled 100MB — reliably blowing the function's time limit and failing
// the upload at the very last step, after all the data had already been
// stored successfully.
//
// Chunks for one upload are always written sequentially by a single client,
// so this read-modify-write has no concurrent writer to race against.
function manifestKey(uploadId) {
  return `${MEDIA_PREFIX}upload-manifest-${uploadId}.json`;
}

async function recordUploadedChunk(uploadId, index, size) {
  const key = manifestKey(uploadId);
  const manifest = await blobStore.readJSON(key, { chunks: {}, createdAt: Date.now() });
  manifest.chunks[index] = size;
  manifest.updatedAt = Date.now();
  await blobStore.writeJSON(key, manifest);
}

async function getUploadManifest(uploadId) {
  return blobStore.readJSON(manifestKey(uploadId), null);
}

async function deleteUploadManifest(uploadId) {
  await blobStore.remove(manifestKey(uploadId));
}

// Removes chunks from uploads that were started but never finished (the
// sender closed the tab, lost connection, or never sent the message). They
// are identifiable as a manifest with no corresponding media-meta record;
// without this they would sit in the store forever, referenced by nothing
// and reachable by no one. Only sweeps uploads older than `minAgeMs` so an
// upload still in progress is never touched.
async function sweepAbandonedUploads(minAgeMs = 24 * 60 * 60 * 1000) {
  const manifests = await blobStore.listPrefix(`${MEDIA_PREFIX}upload-manifest-`);
  const now = Date.now();
  const swept = [];

  for (const blob of manifests) {
    const id = blob.pathname.slice(`${MEDIA_PREFIX}upload-manifest-`.length, -'.json'.length);
    if (!isValidMediaId(id)) continue;

    const manifest = await blobStore.readJSON(blob.pathname, null);
    const age = now - (manifest?.updatedAt || manifest?.createdAt || 0);
    if (age < minAgeMs) continue;

    // A finished upload has a meta record; that media is live, so the only
    // thing to clean up is the leftover manifest.
    const meta = await getMediaMeta(id);
    if (meta) {
      await blobStore.remove(blob.pathname);
      continue;
    }

    await deleteAnyMedia(id);
    swept.push(id);
  }
  return swept;
}

// Erases every object belonging to a media id and then proves it is gone.
//
// What exists for a given id varies: chunked uploads have N chunk blobs plus
// a meta record, pre-cutover media is a single blob under the bare id, and
// an upload abandoned midway leaves chunks plus a manifest and no meta. An
// earlier version trusted meta.totalChunks to decide what to remove, so any
// state where meta was missing or its count was wrong left blobs behind
// forever. This instead asks the store what actually exists, deletes all of
// it, and re-lists to confirm nothing survived — the delete is only reported
// as successful once the store agrees.
async function deleteAnyMedia(id) {
  if (!isValidMediaId(id)) throw new Error('Refusing to delete media: invalid id');

  const prefixes = [
    `${MEDIA_PREFIX}chunk-${id}-`,
    `${MEDIA_PREFIX}media-meta-${id}`,
    `${MEDIA_PREFIX}upload-manifest-${id}`,
    `${MEDIA_PREFIX}${id}`
  ];

  const found = (await Promise.all(prefixes.map((p) => blobStore.listPrefix(p)))).flat();
  await blobStore.removeMany(found.map((b) => b.pathname));

  const remaining = (await Promise.all(prefixes.map((p) => blobStore.listPrefix(p)))).flat();
  if (remaining.length > 0) {
    throw new Error(`Media ${id} not fully deleted (${remaining.length} object(s) remain)`);
  }
  return found.length;
}

module.exports = {
  getUsers,
  findUserByUsername,
  findUserById,
  addUser,
  setUserRole,
  getUserRole,
  getViewerContext,
  projectForViewer,
  isUnlocked,
  touchSession,
  clearPresence,
  getSession,
  isPeerOnline,
  peerReadThrough,
  addMessage,
  getRecentMessages,
  getMessagesSince,
  getMessagesBefore,
  getDeletionsSince,
  getHidesSince,
  hideMessageForUser,
  deleteMessage,
  saveMedia,
  getMedia,
  saveMediaChunk,
  getMediaChunk,
  deleteMediaChunks,
  saveMediaMeta,
  getMediaMeta,
  deleteAnyMedia,
  isValidMediaId,
  recordUploadedChunk,
  getUploadManifest,
  deleteUploadManifest,
  sweepAbandonedUploads
};
