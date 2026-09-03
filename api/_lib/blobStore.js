// Picks the storage driver for whichever host this code is running on.
//
// The app now runs on two hosts: Netlify (frabjous-rolypoly-c01232, the live
// chat) and Vercel (puzzal01). Everything above this file — all of store.js
// and all twelve handlers — is written against the eight functions the two
// drivers both implement, so a handler never learns which host it is on and
// the two deployments cannot drift apart in behaviour.
//
// The drivers are NOT interchangeable at the data level: each one talks to
// its own host's blob store, and those hold two separate datasets. Swapping
// hosts moves code, never content.
// NETLIFY=true is set when a function runs inside a Netlify build, but NOT on
// every CLI-published deploy — the first draft of this port reported itself as
// "vercel" on Netlify while correctly reading Netlify's store, because two
// different definitions of "which host is this" had been written in two
// places. There is now exactly one, exported so nothing has to guess again:
// the presence of BLOBS_TOKEN (set on the Netlify site precisely because CLI
// deploys get no automatic Blobs context) is the reliable signal.
const onNetlify =
  process.env.NETLIFY === 'true' ||
  !!process.env.NETLIFY_DEV ||
  (!process.env.VERCEL && !!process.env.BLOBS_TOKEN);

const driver = onNetlify ? require('./blobStore.netlify') : require('./blobStore.vercel');

module.exports = { ...driver, onNetlify, host: onNetlify ? 'netlify' : 'vercel' };
