const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg'
]);

// A recorded blob reports its type with the codec attached — Chrome hands
// back "audio/webm;codecs=opus" for a voice note, Firefox "audio/ogg;codecs=opus"
// — and none of those exact strings appear in ALLOWED_TYPES. The parameter is
// dropped everywhere a browser-supplied type is checked or stored, so a voice
// note is judged on "audio/webm" alone.
//
// This lived only inside the multipart parser before, which is why the two
// upload paths disagreed: a short voice note (single request, parsed here)
// was accepted, while a long one (chunked, whose type arrives as JSON in
// secret-media-finish.js) was rejected outright as "not audio".
function baseMimeType(value) {
  return typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
}

// Netlify Functions are Lambda-shaped and cap a synchronous request or
// response payload at 6MB — and a binary body crosses that boundary base64
// encoded, which inflates it by a third. 4MB of real bytes becomes ~5.33MB
// on the wire, which fits; 4.5MB would not. Files at or under this size go
// through the simple single-request upload; anything bigger is split
// client-side into pieces this size and streamed through the chunked upload
// flow (secret-media-chunk.js + secret-media-finish.js).
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

// Overall ceiling for a single uploaded file (applies to the chunked flow).
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

module.exports = { ALLOWED_TYPES, MAX_CHUNK_BYTES, MAX_TOTAL_BYTES, baseMimeType };
