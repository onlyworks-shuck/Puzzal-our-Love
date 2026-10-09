const { toNetlify } = require('../lib/adapter');

// Netlify entry point. All logic lives in ../../api/users/me.js — shared verbatim
// with every other site running this code, so deployments cannot drift apart.
exports.handler = toNetlify(require('../../api/users/me.js'));
