const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { json, parseBody, fail } = require('../_lib/http');
const { ConfigError, signToken, toPublicUser } = require('../_lib/auth');
const { findUserByUsername, addUser } = require('../_lib/store');

// Health probe. It lives on this endpoint rather than its own /api/health
// because a Vercel Hobby deployment is capped at 12 Serverless Functions and
// this project sits at exactly 12 — a 13th file under /api fails the whole
// build, which is what happened the last time one was added. Registration is
// also the endpoint that fails first when a deployment is misconfigured, so
// this is the most relevant place for it. It answers the GET that used to be
// a bare 405, and reports environment variables as booleans only, never
// their values.
async function probe(res) {
  const blobStore = require('../_lib/blobStore');
  // Taken from the storage layer rather than re-derived here, so the host this
  // reports can never disagree with the host whose store it just read.
  const onNetlify = blobStore.onNetlify;

  // Only the variables that matter on the host actually running this, so a
  // green probe means "this deployment is configured" rather than "some
  // other host's variables are missing".
  const env = {
    host: blobStore.host,
    JWT_SECRET: !!process.env.JWT_SECRET,
    SECRET_CHAT_PASSWORD: !!process.env.SECRET_CHAT_PASSWORD,
    SECRET_CHAT_ADMIN_PASSWORD: !!process.env.SECRET_CHAT_ADMIN_PASSWORD,
    ...(onNetlify
      ? { BLOBS_SITE_ID: !!process.env.BLOBS_SITE_ID, BLOBS_TOKEN: !!process.env.BLOBS_TOKEN }
      : {
          BLOB_READ_WRITE_TOKEN: !!process.env.BLOB_READ_WRITE_TOKEN,
          VERCEL_OIDC_TOKEN: !!process.env.VERCEL_OIDC_TOKEN,
          BLOB_STORE_ID: !!process.env.BLOB_STORE_ID
        })
  };

  // A real round-trip, because asking whether BLOB_READ_WRITE_TOKEN exists
  // proves nothing: a store connected through the dashboard authenticates
  // via OIDC and never sets it.
  let blob;
  try {
    const stamp = `probe-${Date.now()}`;
    await blobStore.writeJSON('healthcheck/probe.json', { stamp });
    const back = await blobStore.readJSON('healthcheck/probe.json', null);
    await blobStore.remove('healthcheck/probe.json').catch(() => {});
    blob = back?.stamp === stamp ? { ok: true } : { ok: false, error: 'read-back did not match' };
  } catch (err) {
    blob = { ok: false, error: `${err?.name || 'Error'}: ${err?.message || String(err)}` };
  }

  // Counted, never rewritten — this must not be able to touch the history.
  let history;
  try {
    const index = await blobStore.readJSON('app-data/secret-messages-index.json', { chunkCount: 0 });
    const users = await blobStore.readJSON('app-data/users.json', []);
    let messages = 0;
    for (let n = 0; n < (index.chunkCount || 0); n++) {
      const chunk = await blobStore.readJSON(`app-data/secret-messages-chunk-${n}.json`, { messages: [] });
      messages += chunk.messages.length;
    }
    history = { ok: true, chunks: index.chunkCount || 0, messages, users: users.length };
  } catch (err) {
    history = { ok: false, error: `${err?.name || 'Error'}: ${err?.message || String(err)}` };
  }

  res.setHeader('Cache-Control', 'no-store');
  return json(res, 200, { env, blob, history, node: process.version });
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return probe(res);
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const { username, password, displayName } = parseBody(req);
  if (!username || !password || password.length < 6) {
    return json(res, 400, { error: 'Username and a password of at least 6 characters are required' });
  }

  try {
    const normalizedUsername = username.trim().toLowerCase();
    const existing = await findUserByUsername(normalizedUsername);
    if (existing) {
      return json(res, 409, { error: 'Username is already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = {
      id: crypto.randomUUID(),
      username: normalizedUsername,
      passwordHash,
      displayName: displayName?.trim() || username,
      createdAt: Date.now()
    };
    await addUser(user);

    const token = signToken(user.id);
    return json(res, 201, { token, user: toPublicUser(user) });
  } catch (err) {
    // A deployment missing JWT_SECRET (or with its Blob store disconnected)
    // fails here for every visitor, forever, and no amount of refreshing
    // helps — so it must not be reported as the transient "please try
    // again" that a real hiccup gets. The client shows a different message
    // for this, and the cause is in the runtime log either way.
    if (err instanceof ConfigError) {
      return fail(
        res,
        503,
        { error: 'The server is not configured yet.', code: 'server_not_configured' },
        err,
        'auth/register'
      );
    }
    return fail(res, 500, { error: 'Could not start a session. Please try again.' }, err, 'auth/register');
  }
};
