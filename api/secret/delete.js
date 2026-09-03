const { json, parseBody, fail } = require('../_lib/http');
const { authenticate } = require('../_lib/auth');
const { getUserRole, deleteMessage, hideMessageForUser } = require('../_lib/store');

// One endpoint, two very different operations, chosen by the caller's tier
// — never by anything the client sends, so a guest cannot ask for a hard
// delete by passing a flag:
//
//   admin -> permanent erase for everyone, including the stored file
//   guest -> hides the caller's own message from their own view only; the
//            admin still sees it, marked as withdrawn
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const userId = authenticate(req, res);
  if (!userId) return;

  try {
    const role = await getUserRole(userId);
    if (!role) return json(res, 401, { error: 'Locked' });

    const { messageId } = parseBody(req);
    if (!messageId) return json(res, 400, { error: 'Missing messageId' });

    if (role !== 'admin') {
      const hidden = await hideMessageForUser(messageId, userId);
      if (hidden.error) {
        const status = hidden.error === 'Message not found' ? 404 : 403;
        return json(res, status, { error: hidden.error });
      }
      return json(res, 200, { ok: true, mode: 'hidden' });
    }

    const result = await deleteMessage(messageId, role);
    if (result.error) {
      const status = result.error === 'Message not found' ? 404 : 403;
      return json(res, status, { error: result.error });
    }

    return json(res, 200, { ok: true, mode: 'deleted' });
  } catch (err) {
    return fail(res, 500, { error: 'Could not delete message. Please try again.' }, err, 'secret/delete');
  }
};
