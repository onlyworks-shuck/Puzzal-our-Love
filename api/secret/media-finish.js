const { json, parseBody, fail } = require('../_lib/http');
const { authenticate } = require('../_lib/auth');
const {
  isUnlocked,
  saveMediaMeta,
  getUploadManifest,
  deleteUploadManifest,
  isValidMediaId
} = require('../_lib/store');
const { ALLOWED_TYPES, MAX_CHUNK_BYTES, MAX_TOTAL_BYTES, baseMimeType } = require('../_lib/mediaLimits');

const MAX_CHUNKS = Math.ceil(MAX_TOTAL_BYTES / MAX_CHUNK_BYTES);

// Validates the pieces uploaded via secret-media-chunk.js and records them
// as one media item. The pieces are NOT stitched into one big blob — a
// stitched 100MB file could never be read back in a single function
// response either (same ~4.5MB cap that motivated chunked upload in the
// first place), so they stay split and secret-media-get.js serves them back
// piece by piece. uploadId doubles as the permanent media id.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const userId = authenticate(req, res);
  if (!userId) return;

  try {
    if (!(await isUnlocked(userId))) return json(res, 401, { error: 'Locked' });

    const { uploadId, totalChunks, mimeType: rawMimeType, totalSize } = parseBody(req);
    // A recorded file's type carries its codec ("audio/webm;codecs=opus"),
    // which matches nothing in ALLOWED_TYPES. The single-request path has
    // always dropped that parameter inside the multipart parser; this path
    // never did, so every voice note long enough to be chunked (and every
    // recorded video) was rejected here as "not audio" after all of its
    // pieces had already been uploaded successfully.
    const mimeType = baseMimeType(rawMimeType);
    // uploadId becomes the permanent media id, and media ids are the key
    // that deletion builds its blob prefixes from — so it has to be a real
    // uuid, not merely url-safe.
    if (!isValidMediaId(uploadId)) {
      return json(res, 400, { error: 'Invalid upload id' });
    }
    if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) {
      return json(res, 400, { error: 'Invalid chunk count' });
    }
    if (!mimeType || !ALLOWED_TYPES.has(mimeType)) {
      // Named, for the same reason as in media.js: the rejected type is the
      // only thing that explains the rejection, and it is invisible to the
      // person holding the phone otherwise.
      return json(res, 400, {
        error: `${mimeType || 'That file type'} is not supported here — send a JPEG, PNG, MP4 or a recorded voice note.`
      });
    }
    if (!Number.isFinite(totalSize) || totalSize <= 0 || totalSize > MAX_TOTAL_BYTES) {
      return json(res, 400, { error: 'File is too large' });
    }

    // Verified from the manifest each chunk upload wrote, so completing an
    // upload costs one small JSON read no matter how large the file is.
    // Reading the chunks back to add up their bytes (what this used to do)
    // made the final step scale with file size and time out on exactly the
    // large videos it was meant to support.
    const manifest = await getUploadManifest(uploadId);
    if (!manifest) {
      return json(res, 400, { error: 'Upload incomplete — please try again.' });
    }

    const missing = [];
    let actualSize = 0;
    for (let i = 0; i < totalChunks; i++) {
      const size = manifest.chunks[i];
      if (typeof size !== 'number') missing.push(i);
      else actualSize += size;
    }
    if (missing.length > 0) {
      return json(res, 400, {
        error: `Upload incomplete — ${missing.length} part(s) did not arrive. Please try again.`
      });
    }
    if (Math.abs(actualSize - totalSize) > 1024) {
      return json(res, 400, { error: 'Uploaded file looks corrupted. Please try again.' });
    }

    await saveMediaMeta(uploadId, { contentType: mimeType, totalChunks, totalSize: actualSize });
    // The manifest has served its purpose; leaving it would make a finished
    // upload look abandoned to the sweeper.
    await deleteUploadManifest(uploadId).catch(() => {});

    const type = mimeType.startsWith('video/') ? 'video' : mimeType.startsWith('audio/') ? 'audio' : 'image';
    return json(res, 200, { url: `/api/secret/media-get?id=${uploadId}`, type });
  } catch (err) {
    return fail(res, 500, { error: 'Could not finish upload. Please try again.' }, err, 'secret/media-finish');
  }
};
