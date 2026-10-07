// Network-first service worker: always fresh when online, cached copy when offline.
const CACHE = 'wortweg-v12';
const ASSETS = [
  './', './index.html', './ai-config.js', './manifest.webmanifest', './css/app.css',
  './data/vocabulary.js', './js/app.js', './js/engine.js', './js/session.js', './js/validate.js', './js/mistakes.js', './js/articles.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).catch(() => {}));
});
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});