const { toNetlify } = require('../lib/adapter');

// Netlify entry point. All logic lives in ../../api/secret/media-finish.js — shared verbatim
// with every other site running this code, so deployments cannot drift apart.
exports.handler = toNetlify(require('../../api/secret/media-finish.js'));
