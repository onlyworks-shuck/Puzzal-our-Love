const { json, fail } = require('../_lib/http');
const { authenticate } = require('../_lib/auth');
const {
  getViewerContext,
  getRecentMessages,
  getMessagesSince,
  getMessagesBefore,
  getDeletionsSince,
  getHidesSince,
  touchSession,
  isPeerOnline,
  peerReadThrough
} = require('../_lib/store');

const DEFAULT_LIMIT = 200;
const MAX_PAGE_LIMIT = 200;

// Three ways to call this, so the client never has to re-fetch the whole
// conversation just to see what's new:
//  - no params:        most recent DEFAULT_LIMIT messages (first open)
//  - ?since=<ms>:       only messages newer than the cursor, plus any
//                       message ids deleted since then (polling)
//  - ?before=<ms>:      up to `limit` messages older than the cursor
//                       (scrolling up for history)
module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const userId = authenticate(req, res);
  if (!userId) return;

  try {
    // The role decides what this reader is allowed to see: a guest never
    // receives messages they have hidden, while the admin receives
    // everything, withdrawn ones included. The context also carries the
    // admin id set, used to mark which messages a guest may not hide.
    const viewer = await getViewerContext(userId);
    const role = viewer.role;
    if (!role) return json(res, 401, { error: 'Locked' });

    const params = req.query || {};
    const serverTime = Date.now();

    // The chat already polls this endpoint every couple of seconds, so both
    // live signals ride along with it — no separate request or timer for
    // either. Being here at all is what "online" means; `ack` is the caller
    // saying how far they have now read, which is what turns the sender's
    // ticks blue.
    //
    // `ack` is only sent while the chat is actually on screen, so a client
    // polling with the chat closed or the phone locked keeps receiving
    // messages without marking them read. Started before the messages are
    // fetched so the two run together, and isolated from them: a hiccup here
    // must never stop messages loading.
    const ack = Number(params.ack);
    const sessionPromise = touchSession(userId, role, Number.isFinite(ack) ? ack : 0).catch(() => null);
    const liveState = async () => {
      const session = await sessionPromise;
      return { peerOnline: isPeerOnline(session, viewer), peerReadThrough: peerReadThrough(session, viewer) };
    };

    if (params.since) {
      const sinceTs = Number(params.since);
      if (!Number.isFinite(sinceTs)) return json(res, 400, { error: 'Invalid since cursor' });
      const [messages, deletedIds, hides] = await Promise.all([
        getMessagesSince(sinceTs, viewer),
        getDeletionsSince(sinceTs),
        getHidesSince(sinceTs)
      ]);
      // A guest only needs to know which of its own messages to drop; the
      // admin needs the ids to mark as withdrawn.
      const hiddenEvents =
        role === 'admin' ? hides : hides.filter((e) => e.userId === userId).map((e) => ({ id: e.id }));
      return json(res, 200, { messages, deletedIds, hiddenEvents, serverTime, ...(await liveState()) });
    }

    if (params.before) {
      const beforeTs = Number(params.before);
      if (!Number.isFinite(beforeTs)) return json(res, 400, { error: 'Invalid before cursor' });
      const limit = Math.min(Math.max(Number(params.limit) || 100, 1), MAX_PAGE_LIMIT);
      const { messages, hasMore } = await getMessagesBefore(beforeTs, limit, viewer);
      return json(res, 200, { messages, hasMore, serverTime, ...(await liveState()) });
    }

    const { messages, hasMore } = await getRecentMessages(DEFAULT_LIMIT, viewer);
    return json(res, 200, { messages, hasMore, serverTime, ...(await liveState()) });
  } catch (err) {
    return fail(res, 500, { error: 'Could not load messages. Please try again.' }, err, 'secret/messages');
  }
};
