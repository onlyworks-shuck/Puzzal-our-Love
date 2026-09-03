const crypto = require('crypto');
const { json, fail } = require('../_lib/http');
const { authenticate } = require('../_lib/auth');
const { isUnlocked, saveMediaChunk, saveMediaMeta } = require('../_lib/store');
const { parseMultipart } = require('../_lib/multipart');
const { ALLOWED_TYPES, MAX_CHUNK_BYTES } = require('../_lib/mediaLimits');

// Single-request upload path for files at or under MAX_CHUNK_BYTES. Larger
// files (most real videos) go through secret-media-chunk.js +
// secret-media-finish.js instead — see mediaLimits.js for why.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const userId = authenticate(req, res);
  if (!userId) return;

  try {
    if (!(await isUnlocked(userId))) return json(res, 401, { error: 'Locked' });

    let parsed;
    try {
      parsed = await parseMultipart(req, { maxBytes: MAX_CHUNK_BYTES });
    } catch (err) {
      return json(res, 400, { error: 'Could not parse upload' });
    }

    if (parsed.truncated) {
      return json(res, 400, { error: 'File is too large for a single upload' });
    }
    if (!parsed.file) {
      return json(res, 400, { error: 'No file uploaded' });
    }
    if (!ALLOWED_TYPES.has(parsed.file.mimeType)) {
      return json(res, 400, { error: 'Only images, videos and audio are allowed' });
    }

    // Stored the same single-chunk way a chunked upload would be (see
    // secret-media-finish.js) so secret-media-get.js has exactly one
    // retrieval path to support, regardless of how a file got uploaded.
    const id = crypto.randomUUID();
    await saveMediaChunk(id, 0, parsed.file.buffer);
    await saveMediaMeta(id, {
      contentType: parsed.file.mimeType,
      totalChunks: 1,
      totalSize: parsed.file.buffer.length
    });

    const type = parsed.file.mimeType.startsWith('video/')
      ? 'video'
      : parsed.file.mimeType.startsWith('audio/')
        ? 'audio'
        : 'image';
    return json(res, 200, { url: `/api/secret/media-get?id=${id}`, type });
  } catch (err) {
    return fail(res, 500, { error: 'Upload failed. Please try again.' }, err, 'secret/media');
  }
};
