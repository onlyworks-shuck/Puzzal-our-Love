const { Readable } = require('stream');

// Runs an /api handler unchanged on Netlify.
//
// The twelve handlers in /api are written to the (req, res) convention Vercel
// uses. Netlify Functions are Lambda-shaped: one `event` in, one
// { statusCode, headers, body } out. Rather than fork twelve files — which is
// what happened the last time this app lived on two hosts, and they drifted
// until only one of them worked — this shim translates between the two
// shapes, and the handlers themselves are byte-identical on both deployments.
//
// The surface below is not a general Express polyfill. It is exactly what the
// twelve handlers actually touch, verified by reading all of them:
//
//   req.method   req.headers   req.query   req.body   (+ stream fallback)
//   res.status() res.json()    res.send()  res.setHeader()

function buildRequest(event) {
  const headers = event.headers || {};
  const contentType = headers['content-type'] || headers['Content-Type'] || '';

  // A binary upload arrives base64-encoded; JSON arrives as plain text.
  let raw = Buffer.alloc(0);
  if (event.body) {
    raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8');
  }

  // Vercel auto-parses JSON into an object and leaves multipart as a raw
  // Buffer, and the handlers rely on both behaviours: http.parseBody() wants
  // the object, multipart.getRawBody() checks Buffer.isBuffer() first.
  let body;
  if (contentType.includes('application/json')) {
    try {
      body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
    } catch (err) {
      body = {};
    }
  } else if (raw.length) {
    body = raw;
  }

  // A real Readable, so multipart.getRawBody()'s stream fallback works if it
  // is ever reached rather than hanging on an object that never emits 'end'.
  const req = Readable.from(raw.length ? [raw] : []);
  req.method = event.httpMethod;
  req.headers = headers;
  req.query = event.queryStringParameters || {};
  req.body = body;
  return req;
}

function buildResponse() {
  const state = { statusCode: 200, headers: {}, body: '', isBase64Encoded: false, ended: false };

  const res = {
    setHeader(name, value) {
      state.headers[name] = value;
      return res;
    },
    // Must return `res`: every handler calls res.status(code).json(body).
    status(code) {
      state.statusCode = code;
      return res;
    },
    json(payload) {
      state.headers['Content-Type'] = 'application/json';
      state.body = JSON.stringify(payload);
      state.ended = true;
      return res;
    },
    send(payload) {
      if (Buffer.isBuffer(payload)) {
        // Netlify returns binary only when it is told the body is base64.
        // Without this flag a media chunk arrives at the browser as mojibake
        // text and every photo and video in the chat silently fails to load.
        state.body = payload.toString('base64');
        state.isBase64Encoded = true;
      } else if (typeof payload === 'object' && payload !== null) {
        state.headers['Content-Type'] = 'application/json';
        state.body = JSON.stringify(payload);
      } else {
        state.body = payload == null ? '' : String(payload);
      }
      state.ended = true;
      return res;
    },
    end(payload) {
      if (payload !== undefined) return res.send(payload);
      state.ended = true;
      return res;
    },
    _state: state
  };

  return res;
}

function toNetlify(handler) {
  return async (event) => {
    const req = buildRequest(event);
    const res = buildResponse();

    try {
      await handler(req, res);
    } catch (err) {
      // A handler that throws past its own try/catch would otherwise become
      // an opaque Netlify 502 with nothing in the log to act on.
      console.error(`[adapter] unhandled: ${err?.message || err}`, err?.stack || '');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Something went wrong. Please try again.' })
      };
    }

    const { statusCode, headers, body, isBase64Encoded, ended } = res._state;
    if (!ended) {
      // Every path through every handler answers; if one ever stops doing so,
      // say that plainly instead of returning a hanging empty 200.
      console.error('[adapter] handler returned without sending a response');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Something went wrong. Please try again.' })
      };
    }

    return { statusCode, headers, body, isBase64Encoded };
  };
}

module.exports = { toNetlify };
