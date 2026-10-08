// Service Worker — caches app shell for offline fallback
// Gedeelde verzendlogica voor de outbox (klassiek script, zet self.outboxVerzend).
try { importScripts('/js/outbox-verzend.js'); } catch (e) { /* offline install-race: SW blijft werken zonder sync */ }

const CACHE_NAME = 'blitz-planning-v25';
const SHELL = ['/', '/index.html', '/manifest.json', '/js/apparaat.js', '/js/app-dialog.js', '/js/venster.js', '/js/outbox.js', '/js/outbox-verzend.js', '/js/outbox-sync.js', '/js/test-upload.js', '/js/rapport-archief.js', '/js/excel-export.js', '/js/prijzen.js', '/js/rapport-wizard.js', '/js/inventaris.js', '/js/sorteer.js', '/css/base.css', '/css/app.css', '/css/wizard.css', '/css/prijzen.css', '/css/inventaris.css'];

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

// Background Sync (tag 'rapport-outbox'): de pagina registreert deze tag na het opslaan van een
// rapport in de outbox (public/js/outbox-sync.js). Op Android/Chrome wekt de browser deze service
// worker zodra er weer verbinding is -- ook als de app gesloten of het scherm vergrendeld is -- en
// verstuurt verzendAlles de wachtende items naar /api/rapport-ontvangen. Gooien bij mislukte items
// laat de browser later zelf opnieuw proberen. Web Locks in verzendAlles voorkomen dat pagina en
// service worker hetzelfde item tegelijk versturen (de server is bovendien idempotent op het id).
// iOS/Safari kent Background Sync niet (geen 'sync' in de registratie): daar hervat de outbox
// (public/js/outbox.js) gewoon bij het openen van de app, vanuit de IndexedDB-wachtrij.
self.addEventListener('sync', e => {
  if (e.tag === 'rapport-outbox' && self.outboxVerzend) {
    e.waitUntil(
      self.outboxVerzend.verzendAlles({ fetch: self.fetch.bind(self) }).then(r => {
        if (r.mislukt) throw new Error('Rapporten niet verstuurd');
      })
    );
  }
});

self.addEventListener('fetch', e => {
  // Network first voor API calls
  if (e.request.url.includes('/api/')) return;

  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
