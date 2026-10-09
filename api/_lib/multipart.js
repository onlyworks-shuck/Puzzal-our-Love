const Busboy = require('busboy');
const { baseMimeType } = require('./mediaLimits');

// Only application/json, urlencoded and text/plain bodies are auto-parsed
// into req.body — multipart/form-data is left as a raw Buffer. Some runtime
// versions instead leave the stream unconsumed, so this handles both: use
// req.body if it's already a Buffer, otherwise read the stream.
function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === 'string') return Promise.resolve(Buffer.from(req.body, 'utf8'));

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Parses a multipart/form-data request into { file, fields, truncated }.
// `file` is { buffer, mimeType } | null. `fields` collects any plain text
// form fields alongside the file (e.g. chunk index/uploadId).
async function parseMultipart(req, { maxBytes }) {
  const contentType = req.headers['content-type'] || req.headers['Content-Type'];
  if (!contentType) throw new Error('Missing content-type');

  const rawBody = await getRawBody(req);

  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: { 'content-type': contentType }, limits: { fileSize: maxBytes } });
    let file = null;
    let truncated = false;
    const fields = {};

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    busboy.on('file', (_fieldname, stream, info) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('end', () => {
        // Browsers report the recorder's mime type with a codecs parameter
        // (e.g. "audio/webm;codecs=opus"), which won't exact-match the plain
        // entries in ALLOWED_TYPES, so only the base type is kept here — the
        // same normalisation the chunked path applies in media-finish.js.
        file = { buffer: Buffer.concat(chunks), mimeType: baseMimeType(info.mimeType) };
      });
    });

    busboy.on('finish', () => resolve({ file, fields, truncated }));
    busboy.on('error', reject);
    busboy.end(rawBody);
  });
}

module.exports = { parseMultipart };
