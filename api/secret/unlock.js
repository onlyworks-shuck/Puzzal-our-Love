const { json, parseBody, fail } = require('../_lib/http');
const { authenticate } = require('../_lib/auth');
const { setUserRole } = require('../_lib/store');

// Three tiers, resolved purely server-side so the client never learns which
// password maps to which role:
//  - SECRET_CHAT_ADMIN_PASSWORD -> 'admin' (full access, checked first so it
//    can't accidentally collide with the guest password)
//  - SECRET_CHAT_PASSWORD       -> 'guest' (chat access, no delete rights)
//  - anything else              -> generic 401, identical to a bad guess,
//    so the client falls back to the decoy dashboard instead of ever
//    learning a secret chat exists.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const userId = authenticate(req, res);
  if (!userId) return;

  const guestPassword = process.env.SECRET_CHAT_PASSWORD;
  const adminPassword = process.env.SECRET_CHAT_ADMIN_PASSWORD;
  if (!guestPassword || !adminPassword) {
    // Not a wrong password and not a transient fault: the deployment is
    // missing its password variables, so *every* attempt fails. Answered as
    // 503 with a code, because the client counts a 401 here as a wrong guess
    // and three of those lock the owner out of their own chat.
    console.error('[secret/unlock] SECRET_CHAT_PASSWORD / SECRET_CHAT_ADMIN_PASSWORD are not both set');
    return json(res, 503, { error: 'Secret chat is not configured.', code: 'server_not_configured' });
  }

  const { password } = parseBody(req);
  if (typeof password !== 'string') return json(res, 401, { error: 'Incorrect password' });

  let role = null;
  if (password === adminPassword) role = 'admin';
  else if (password === guestPassword) role = 'guest';

  if (!role) return json(res, 401, { error: 'Incorrect password' });

  try {
    await setUserRole(userId, role);
    return json(res, 200, { ok: true, role });
  } catch (err) {
    return fail(res, 500, { error: 'Could not unlock. Please try again.' }, err, 'secret/unlock');
  }
};
