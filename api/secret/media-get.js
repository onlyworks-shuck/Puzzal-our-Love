const { fail } = require('../_lib/http');
const { authenticate } = require('../_lib/auth');
const { isUnlocked, getMediaMeta, getMediaChunk, getMedia } = require('../_lib/store');

// This endpoint is auth-gated per request (authenticate + isUnlocked below) —
// a public/shared cache directive would let a CDN serve the first
// authenticated response to any later unauthenticated caller for the same
// id, bypassing the gate entirely. Applied to every response below, so
// it's a plain helper instead of the shared json() one.
function jsonNoStore(res, statusCode, body) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(statusCode).json(body);
}

function failNoStore(res, statusCode, body, err, context) {
  res.setHeader('Cache-Control', 'private, no-store');
  return fail(res, statusCode, body, err, context);
}

// Media can be up to 100MB (see mediaLimits.js), but a single function
// response is capped at ~4.5MB — so a large file is fetched in two steps: a
// metadata call (no `chunk` param) to learn how many pieces exist, then one
// call per piece, each safely under the cap since every stored piece is at
// most MAX_CHUNK_BYTES. Media uploaded before this scheme existed has no
// metadata blob and falls back to the old single-shot read — safe because
// everything saved through that old path was already small enough for one
// response.
//
// Most media is not large. A voice note is a few dozen KB and always lands
// in exactly one piece, yet the two-step dance still cost it two cold
// function invocations and five strongly-consistent blob reads before a
// single byte reached the player — which is what made a recorded message
// take seconds to appear while the text beside it was instant. A client that
// asks for `inline=1` gets the bytes themselves in the metadata response
// whenever the file fits in one piece, halving that to one request.
//
// The inline answer is opt-in rather than the default on purpose: a client
// still running older cached JS asks without the flag and keeps getting the
// JSON manifest it expects, so this deploys without a flag-day.
function inlineBody(res, buffer, contentType) {
  // The real type travels in a header because the body itself must stay
  // octet-stream: it is the only content type Netlify's Lambda bridge will
  // hand back verbatim as base64 binary. The client rebuilds the Blob with
  // this value so playback still knows what it is holding.
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Media-Content-Type', contentType || 'application/octet-stream');
  res.setHeader('X-Media-Chunks', '1');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(buffer);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return jsonNoStore(res, 405, { error: 'Method not allowed' });

  // Set before the auth guard so its own rejection carries the directive
  // too — the guard answers with the shared json() helper, which does not
  // know this endpoint must never be cached.
  res.setHeader('Cache-Control', 'private, no-store');
  const userId = authenticate(req, res);
  if (!userId) return;

  try {
    if (!(await isUnlocked(userId))) return jsonNoStore(res, 401, { error: 'Locked' });

    const id = req.query?.id;
    if (!id) return jsonNoStore(res, 400, { error: 'Missing id' });

    const chunkParam = req.query?.chunk;

    if (chunkParam !== undefined) {
      const index = Number(chunkParam);
      if (!Number.isInteger(index) || index < 0) return jsonNoStore(res, 400, { error: 'Invalid chunk index' });

      // Straight to the piece. Reading the metadata record first — which is
      // what this used to do — added a second blob round-trip to every piece
      // of every file purely to decide which of two lookups to attempt, and
      // the answer is already implied by whether the piece exists.
      const buffer = (await getMediaChunk(id, index)) || (index === 0 ? (await getMedia(id))?.buffer : null);
      if (!buffer) return jsonNoStore(res, 404, { error: 'Not found' });

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(buffer);
    }

    const wantsInline = req.query?.inline === '1';
    const meta = await getMediaMeta(id);

    if (meta) {
      if (wantsInline && meta.totalChunks === 1) {
        const buffer = await getMediaChunk(id, 0);
        // A missing piece is a genuinely broken item, not a reason to fall
        // back — the manifest answer below would send the client after the
        // same absent blob and fail one request later.
        if (!buffer) return jsonNoStore(res, 404, { error: 'Not found' });
        return inlineBody(res, buffer, meta.contentType);
      }
      return jsonNoStore(res, 200, { contentType: meta.contentType, totalChunks: meta.totalChunks });
    }

    const legacy = await getMedia(id);
    if (!legacy) return jsonNoStore(res, 404, { error: 'Not found' });
    if (wantsInline) return inlineBody(res, legacy.buffer, legacy.contentType);
    return jsonNoStore(res, 200, { contentType: legacy.contentType, totalChunks: 1 });
  } catch (err) {
    return failNoStore(res, 500, { error: 'Could not load media. Please try again.' }, err, 'secret/media-get');
  }
};
