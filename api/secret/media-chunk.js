const { json, fail } = require('../_lib/http');
const { authenticate } = require('../_lib/auth');
const { isUnlocked, saveMediaChunk, recordUploadedChunk, isValidMediaId } = require('../_lib/store');
const { parseMultipart } = require('../_lib/multipart');
const { MAX_CHUNK_BYTES, MAX_TOTAL_BYTES } = require('../_lib/mediaLimits');

const MAX_CHUNK_INDEX = Math.ceil(MAX_TOTAL_BYTES / MAX_CHUNK_BYTES) - 1;

// Stashes one piece of a large file being uploaded in pieces (see
// mediaLimits.js). Chunks are collected by secret-media-finish.js once the
// client has sent them all.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const userId = authenticate(req, res);
  if (!userId) return;

  try {
    if (!(await isUnlocked(userId))) return json(res, 401, { error: 'Locked' });

    let parsed;
    try {
      // Small headroom over MAX_CHUNK_BYTES: the client slices exactly at
      // that boundary, but multipart framing adds a few bytes of overhead.
      parsed = await parseMultipart(req, { maxBytes: MAX_CHUNK_BYTES + 4096 });
    } catch (err) {
      return json(res, 400, { error: 'Could not parse chunk' });
    }

    const uploadId = parsed.fields.uploadId;
    const index = Number(parsed.fields.index);
    // uploadId becomes the permanent media id and is what deletion builds
    // its blob prefixes from, so it must be a real uuid. The index is
    // bounded too — an arbitrary one would let a caller scatter blobs
    // outside the range any later cleanup knows to look at.
    if (!isValidMediaId(uploadId) || !Number.isInteger(index) || index < 0 || index > MAX_CHUNK_INDEX) {
      return json(res, 400, { error: 'Invalid chunk metadata' });
    }
    if (parsed.truncated || !parsed.file) {
      return json(res, 400, { error: 'Chunk is missing or too large' });
    }

    await saveMediaChunk(uploadId, index, parsed.file.buffer);
    // Recorded so finishing the upload can verify completeness without
    // reading every chunk back out of storage.
    await recordUploadedChunk(uploadId, index, parsed.file.buffer.length);
    return json(res, 200, { ok: true });
  } catch (err) {
    return fail(res, 500, { error: 'Chunk upload failed. Please try again.' }, err, 'secret/media-chunk');
  }
};
