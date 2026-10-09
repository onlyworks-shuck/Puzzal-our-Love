function json(res, statusCode, body) {
  res.status(statusCode).json(body);
}

// The adapter hands `application/json` request bodies over already parsed
// into req.body (see netlify/lib/adapter.js), so there's no JSON.parse step
// here — this just guards against a missing/non-object body.
function parseBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

// Answering a failure *and* leaving a trace of what actually failed.
//
// Every handler used to end in `catch (err) { return json(res, 500, ...) }`,
// which discarded `err` entirely. The function log then showed a bare
// 500 with no cause, so an outage could only be diagnosed by redeploying a
// throwaway probe endpoint — which is exactly what had to be done, twice.
// The message still tells the caller nothing sensitive; the stack goes to
// the server log where only the owner can read it.
function fail(res, statusCode, body, err, context) {
  console.error(`[${context}] ${err?.message || err}`, err?.stack || '');
  return json(res, statusCode, body);
}

module.exports = { json, parseBody, fail };
