const CACHE_NAME = 'puzzle-cache-v19';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './config.js',
  './js/api.js',
  './js/emoji.js',
  './js/secret.js',
  './js/game.js',
  './js/pwa.js',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
  './favicon-32.png',
  './manifest.json'
];

// Precached one file at a time rather than with cache.addAll().
//
// addAll() is all-or-nothing: a single non-OK response rejects the whole
// call, the install event's waitUntil() rejects with it, and the service
// worker never installs at all. Installing fifteen files means fifteen
// requests fired in the same instant, and this host answers a burst like
// that with an intermittent 403 bot challenge — so one unlucky request took
// down the entire service worker. That is not just an offline-mode problem:
// a registered service worker with a fetch handler is one of the things a
// browser requires before it will offer to install the app, so losing it is
// exactly what turns the Install button into a page of manual instructions.
//
// Individually cached, a file that fails is simply not cached; the network
// fetch below serves it and a later load will cache it. The one file that is
// genuinely required is the page itself, so only that one can fail the
// install.
async function precache() {
  const cache = await caches.open(CACHE_NAME);
  const results = await Promise.allSettled(
    APP_SHELL.map(async (url) => {
      // cache:'reload' bypasses the HTTP cache so an install always stores
      // the freshly deployed file rather than whatever the browser was
      // holding from the previous version.
      const response = await fetch(new Request(url, { cache: 'reload' }));
      if (!response.ok) throw new Error(`${url} -> ${response.status}`);
      await cache.put(url, response);
    })
  );

  const failed = results
    .map((r, i) => (r.status === 'rejected' ? APP_SHELL[i] : null))
    .filter(Boolean);
  if (failed.length > 0) console.warn('[sw] not precached:', failed.join(', '));

  // The shell is useless without the document, so that one is still fatal —
  // but nothing else is.
  const shellIndex = APP_SHELL.indexOf('./index.html');
  if (results[shellIndex] && results[shellIndex].status === 'rejected') {
    throw results[shellIndex].reason;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Network-first for the app shell so a redeploy is picked up on the very
// next load instead of a stale cache silently winning forever (a previous
// cache-first version of this file did exactly that and shipped a broken
// chat for days). Falls back to cache only when offline. API requests are
// never intercepted here — the chat polls those and needs live data.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // fetch() only rejects on a network failure — a 404/500 page still
        // resolves as a normal response, so an unqualified cache.put() here
        // would overwrite a good cached asset with an error page the moment
        // the deployment hiccups, poisoning the offline fallback for good.
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
