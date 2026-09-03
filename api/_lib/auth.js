const jwt = require('jsonwebtoken');
const { json } = require('./http');

// A deployment that cannot sign or verify tokens is broken in a way no
// caller can fix by retrying, and it must not be reported as if the caller
// did something wrong. Tagged so handlers can answer 503 ("this server is
// not set up") instead of a generic 500.
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function signToken(userId) {
  if (!process.env.JWT_SECRET) throw new ConfigError('Missing JWT_SECRET env var');
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

// Returns the userId for a valid Bearer token, or null.
function verifyAuth(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !process.env.JWT_SECRET) return null;

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.userId;
  } catch (err) {
    return null;
  }
}

// The guard every authenticated endpoint runs first. Returns the userId, or
// answers the request itself and returns null (so the caller just returns).
//
// The split between the two failure cases is the point of this existing.
// Without JWT_SECRET, verifyAuth() cannot validate *any* token, so every
// endpoint answered 401 — indistinguishable from a genuinely bad token. The
// chat's password prompt reads a 401 as "wrong password", so a deployment
// missing this one variable presented the owner's correct password as wrong,
// showed them the decoy dashboard, and burned a lockout strike each time.
// A misconfigured server now says so, in its own status code.
function authenticate(req, res) {
  if (!process.env.JWT_SECRET) {
    console.error('[auth] JWT_SECRET is not set — no token can be issued or verified');
    json(res, 503, { error: 'The server is not configured.', code: 'server_not_configured' });
    return null;
  }

  const userId = verifyAuth(req);
  if (!userId) {
    json(res, 401, { error: 'Invalid or expired token', code: 'invalid_token' });
    return null;
  }
  return userId;
}

function toPublicUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

module.exports = { ConfigError, signToken, verifyAuth, authenticate, toPublicUser };
