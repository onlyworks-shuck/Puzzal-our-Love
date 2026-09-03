const { json, fail } = require('../_lib/http');
const { authenticate, toPublicUser } = require('../_lib/auth');
const { findUserById } = require('../_lib/store');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const userId = authenticate(req, res);
  if (!userId) return;

  try {
    const user = await findUserById(userId);
    if (!user) return json(res, 404, { error: 'User not found' });

    return json(res, 200, toPublicUser(user));
  } catch (err) {
    return fail(res, 500, { error: 'Could not load user. Please try again.' }, err, 'users/me');
  }
};
