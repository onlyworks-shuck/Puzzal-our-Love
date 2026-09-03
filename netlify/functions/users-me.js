const { toNetlify } = require('../lib/adapter');

// Netlify entry point. All logic lives in ../../api/users/me.js — shared verbatim with the
// Vercel deployment so the two hosts cannot drift apart.
exports.handler = toNetlify(require('../../api/users/me.js'));
