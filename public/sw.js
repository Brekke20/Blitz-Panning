// Service Worker -- dun omhulsel; alle beslissingen staan in /sw-strategie.js (zuiver en met node --test getest).
// Etappe 7 (N3): de schil blijft netwerk-eerst met cache als terugval, de CDN-bibliotheken staan vast in de cache op exacte
// URL+versie, Google Fonts lopen stale-while-revalidate in een tweede cache. /api en alles wat geen GET is, raakt deze
// worker nooit aan.
importScripts('/sw-strategie.js');

const CACHE_NAME = 'blitz-planning-v25';
const EXTERN_CACHE = 'blitz-extern-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/js/apparaat.js', '/js/kern/brug.js', '/js/kern/tijd.js', '/js/kern/ui.js', '/js/kern/selecties.js', '/js/kern/toestand.js', '/js/kern/api.js', '/js/kern/netwerk.js', '/js/kern/mailcontrole.js', '/js/kern/omgeving.js', '/js/kern/feestdagen.js', '/js/kern/testdata.js', '/js/kern/verklikker.js', '/js/kern/opslag.js', '/js/kern/verbruik-wachtrij.js', '/js/kern/exceljs.js', '/js/schermen/route-tijden.js', '/js/schermen/route-kaart.js', '/js/schermen/route.js', '/js/schermen/capaciteit.js', '/js/schermen/wachtrij-logica.js', '/js/schermen/wachtrij.js', '/js/schermen/kalender-logica.js', '/js/schermen/kalender.js', '/js/schermen/ingepland.js', '/js/schermen/ticketdetail-logica.js', '/js/schermen/ticketdetail.js', '/js/schermen/voorstel.js', '/js/schermen/annuleren.js', '/js/schermen/klantbeschikbaarheid-logica.js', '/js/schermen/klantbeschikbaarheid.js', '/js/schermen/beschikbaarheid.js', '/js/schermen/beschikbaarheid-logica.js', '/js/schermen/afspraken.js', '/js/schermen/afspraken-logica.js', '/js/schermen/instellingen.js', '/js/schermen/instellingen-logica.js', '/js/schermen/fotos.js', '/js/schermen/rapport-verzenden.js', '/js/schermen/planacties.js', '/js/app.js', '/js/app-dialog.js', '/js/venster.js', '/js/outbox.js', '/js/rapport-archief.js', '/js/excel-export.js', '/js/prijzen.js', '/js/rapport-wizard.js', '/js/inventaris.js', '/js/sorteer.js', '/js/planner.js', '/css/base.css', '/css/app.css', '/css/wizard.css', '/css/prijzen.css', '/css/inventaris.css'];
const CDN_VAST = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/signature_pad/4.1.7/signature_pad.umd.min.js', 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/layers.png', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/layers-2x.png'];
// Staat wel in CDN_VAST (cache-eerst, bewaard bij het eerste gebruik) maar wordt niet bij de installatie opgehaald: ExcelJS is 258 kB gzip en
// enkel voor de export nodig.
const CDN_LUI = ['https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Navigatie-time-out (Q5, Brent 2026-10-02): standaard 4000 ms; daarna start de app uit de bewaarde kopie (die één release oud mag zijn).
// De tests kunnen dit overschrijven via '/sw.js?navTimeout=<ms>' (gehele getallen 0-30000; 0 = uit).
const NAV_TIMEOUT_MS = 4000;
const navTimeoutMs = self.SwStrategie.leesNavTimeout(new URL(self.location).search, NAV_TIMEOUT_MS);

const strategie = self.SwStrategie.maakStrategie({
  cacheNaam: CACHE_NAME,
  externNaam: EXTERN_CACHE,
  shell: SHELL,
  cdnVast: CDN_VAST,
  cdnLui: CDN_LUI,
  fontHosts: FONT_HOSTS,
  eigenOrigin: self.location.origin,
  navTimeoutMs,
  caches: self.caches,
  fetchFn: (...a) => self.fetch(...a),
  nu: () => Date.now(),
  wacht: (ms) => new Promise((res) => setTimeout(res, ms)),
});

self.addEventListener('install', e => {
  e.waitUntil(strategie.installeer());
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(strategie.activeer());
  self.clients.claim();
});

// (T20) Geen 'sync'-event/Background Sync geregistreerd: dat zou een onderbroken rapport-verzending
// ook kunnen afwerken terwijl de app/tab gesloten is, maar wordt bewust niet gebruikt -- niet
// beschikbaar op iOS (waar deze app ook draait) en nergens elders in deze app aanwezig. De
// outbox (public/js/outbox.js) herneemt in plaats daarvan gewoon bij de eerstvolgende
// app-opening, dankzij de IndexedDB-wachtrij die het punt onthoudt waar een poging bleef steken.
self.addEventListener('fetch', e => {
  // behandel() geeft null voor /api, niet-GET en onbekende hosts: dan doet de browser het verzoek zelf.
  const r = strategie.behandel(e.request, { waitUntil: (p) => e.waitUntil(p) });
  if (r) e.respondWith(r);
});
