const { json, parseBody, fail } = require('../_lib/http');
const { authenticate } = require('../_lib/auth');
const { getUserRole, addMessage, projectForViewer } = require('../_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const userId = authenticate(req, res);
  if (!userId) return;

  try {
    // The tier is read here, not taken from the request, and stamped onto
    // the message — it is what makes an admin's message permanently
    // undeletable by the guest tier.
    const senderRole = await getUserRole(userId);
    if (!senderRole) return json(res, 401, { error: 'Locked' });

    const payload = parseBody(req);
    const text = (payload.text || '').trim().slice(0, 4000);
    const { mediaUrl, mediaType } = payload;
    if (!text && !mediaUrl) return json(res, 400, { error: 'Message is empty' });

    const message = await addMessage({ senderId: userId, senderRole, text, mediaUrl, mediaType });
    // Returned through the same projection a read uses, so the row the
    // sender appends locally carries identical fields to the one everyone
    // else will poll for — otherwise their own message would render without
    // the permission flag until the next full reload.
    return json(res, 200, { message: projectForViewer(message, { userId, role: senderRole }) });
  } catch (err) {
    return fail(res, 500, { error: 'Could not send message. Please try again.' }, err, 'secret/send');
  }
};
