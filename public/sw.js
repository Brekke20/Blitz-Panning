// Service Worker — caches app shell for offline fallback
const CACHE_NAME = 'blitz-planning-v9';
const SHELL = ['/', '/index.html', '/manifest.json', '/js/outbox.js', '/js/rapport-archief.js', '/js/excel-export.js', '/js/prijzen.js', '/js/rapport-wizard.js', '/js/inventaris.js', '/css/base.css', '/css/app.css', '/css/wizard.css', '/css/prijzen.css', '/css/inventaris.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first voor API calls
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
