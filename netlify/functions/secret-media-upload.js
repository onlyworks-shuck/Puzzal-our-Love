const { toNetlify } = require('../lib/adapter');

// Netlify entry point. All logic lives in ../../api/secret/media.js — shared verbatim with the
// Vercel deployment so the two hosts cannot drift apart.
exports.handler = toNetlify(require('../../api/secret/media.js'));
