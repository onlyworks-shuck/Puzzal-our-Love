const { toNetlify } = require('../lib/adapter');

// Netlify entry point. All logic lives in ../../api/secret/send.js — shared verbatim with the
// Vercel deployment so the two hosts cannot drift apart.
exports.handler = toNetlify(require('../../api/secret/send.js'));
