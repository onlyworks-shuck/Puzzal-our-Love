const { json, parseBody, fail } = require('../_lib/http');
const { authenticate } = require('../_lib/auth');
const { getUserRole, touchSession, clearPresence, isPeerOnline, peerReadThrough } = require('../_lib/store');

// The chat's live state — who is here, and how far each side has read — is
// normally kept current by the message poll, which carries both signals on
// every tick. This endpoint is for the moments the poll cannot cover:
//
//   { online: false }  leaving the chat, backgrounding the tab or closing the
//                      page. The heartbeat would expire on its own, but saying
//                      so explicitly means the other side sees you go offline
//                      at once instead of a few seconds later.
//   { ack: <ts> }      "I have just seen everything up to here", sent the
//                      instant messages are rendered rather than waiting for
//                      the next poll to carry it. That is the difference
//                      between the sender's ticks turning blue in well under a
//                      second and taking three, and being prompt is the entire
//                      point of a read receipt.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const userId = authenticate(req, res);
  if (!userId) return;

  try {
    const role = await getUserRole(userId);
    if (!role) return json(res, 401, { error: 'Locked' });

    const { online, ack } = parseBody(req);
    const ackTs = Number(ack);

    // Going offline never carries an ack: the two happen at opposite moments
    // (leaving vs. looking), and clearing presence must not also record a read
    // for someone who has just stopped looking.
    const session =
      online === false
        ? await clearPresence(userId)
        : await touchSession(userId, role, Number.isFinite(ackTs) ? ackTs : 0);

    return json(res, 200, {
      ok: true,
      peerOnline: isPeerOnline(session, { userId, role }),
      peerReadThrough: peerReadThrough(session, { role })
    });
  } catch (err) {
    return fail(res, 500, { error: 'Could not update session state.' }, err, 'secret/session');
  }
};
