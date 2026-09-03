const CACHE_NAME = 'puzzle-cache-v16';
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

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
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
