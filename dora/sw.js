/* Simple offline cache for Dora's app shell. */

const CACHE_NAME = 'dora-app-v2';

const APP_SHELL = [
  './',
  './index.html',
  './app.html',
  './manifest.json',
  './app-manifest.json',
  './dora.webp'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k === CACHE_NAME ? Promise.resolve() : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cache-first for same-origin (app shell + assets).
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        // Best-effort cache update for same-origin assets.
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Network-first for everything else (Firebase, CDNs).
  event.respondWith(
    fetch(req).catch(() => caches.match(req))
  );
});
