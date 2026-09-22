// Service Worker — caches app shell for offline fallback
const CACHE_NAME = 'blitz-planning-v12';
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

// (T20) Geen 'sync'-event/Background Sync geregistreerd: dat zou een onderbroken rapport-verzending
// ook kunnen afwerken terwijl de app/tab gesloten is, maar wordt bewust niet gebruikt -- niet
// beschikbaar op iOS (waar deze app ook draait) en nergens elders in deze app aanwezig. De
// outbox (public/js/outbox.js) herneemt in plaats daarvan gewoon bij de eerstvolgende
// app-opening, dankzij de IndexedDB-wachtrij die het punt onthoudt waar een poging bleef steken.
self.addEventListener('fetch', e => {
  // Network first voor API calls
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
