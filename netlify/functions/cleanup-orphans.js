const { toNetlify } = require('../lib/adapter');

// Netlify entry point. All logic lives in ../../api/cleanup-orphans.js — shared verbatim with the
// Vercel deployment so the two hosts cannot drift apart.
exports.handler = toNetlify(require('../../api/cleanup-orphans.js'));
