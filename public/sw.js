// Service Worker -- dun omhulsel; alle beslissingen staan in /sw-strategie.js (zuiver en met node --test getest).
// Etappe 7 (N3): de schil blijft netwerk-eerst met cache als terugval, de CDN-bibliotheken staan vast in de cache op exacte
// URL+versie, Google Fonts lopen stale-while-revalidate in een tweede cache. /api en alles wat geen GET is, raakt deze
// worker nooit aan.
importScripts('/sw-strategie.js');
// Gedeelde verzendlogica voor de outbox (klassiek script, zet self.outboxVerzend; v1.10.2). In een try: bij een offline
// install-race blijft de worker werken, enkel zonder Background Sync.
try { importScripts('/js/outbox-verzend.js'); } catch (e) { /* zie hierboven */ }

const CACHE_NAME = 'blitz-planning-v27';
const EXTERN_CACHE = 'blitz-extern-v1';
const SHELL = ['/', '/index.html', '/manifest.json', '/js/apparaat.js', '/js/kern/brug.js', '/js/kern/tijd.js', '/js/kern/ui.js', '/js/kern/selecties.js', '/js/kern/toestand.js', '/js/kern/api.js', '/js/kern/netwerk.js', '/js/kern/sessie.js', '/js/kern/navigatie.js', '/js/kern/eigenaar.js', '/js/kern/instellingen-sync.js', '/js/kern/mailcontrole.js', '/js/kern/omgeving.js', '/js/kern/feestdagen.js', '/js/kern/testdata.js', '/js/kern/verklikker.js', '/js/kern/opslag.js', '/js/kern/verbruik-wachtrij.js', '/js/kern/exceljs.js', '/js/kern/instellingen-regels.js', '/js/schermen/route-tijden.js', '/js/schermen/route-kaart.js', '/js/schermen/route.js', '/js/schermen/capaciteit.js', '/js/schermen/wachtrij-logica.js', '/js/schermen/wachtrij.js', '/js/schermen/kalender-logica.js', '/js/schermen/kalender.js', '/js/schermen/ingepland.js', '/js/schermen/ticketdetail-logica.js', '/js/schermen/ticketdetail.js', '/js/schermen/voorstel.js', '/js/schermen/annuleren.js', '/js/schermen/klantbeschikbaarheid-logica.js', '/js/schermen/klantbeschikbaarheid.js', '/js/schermen/beschikbaarheid.js', '/js/schermen/beschikbaarheid-logica.js', '/js/schermen/afspraken.js', '/js/schermen/afspraken-logica.js', '/js/schermen/instellingen.js', '/js/schermen/instellingen-logica.js', '/js/schermen/inloggen-logica.js', '/js/schermen/inloggen.js', '/js/schermen/rol-schil.js', '/js/schermen/rolwisselaar.js', '/js/schermen/gebruikersmenu.js', '/js/schermen/fotos.js', '/js/schermen/rapport-verzenden.js', '/js/schermen/planacties.js', '/js/app.js', '/js/app-dialog.js', '/js/venster.js', '/js/outbox.js', '/js/outbox-verzend.js', '/js/outbox-sync.js', '/js/test-upload.js', '/js/rapport-inhoud.js', '/js/rapport-status.js', '/js/rapport-archief.js', '/js/excel-export.js', '/js/prijzen.js', '/js/rapport-wizard.js', '/js/inventaris.js', '/js/sorteer.js', '/js/planner.js', '/js/planner-tijdlijn.js', '/js/sticky-offset.js', '/js/versie.js', '/css/base.css', '/css/app.css', '/css/wizard.css', '/css/prijzen.css', '/css/inventaris.css', '/css/inloggen.css', '/css/beheer.css', '/js/schermen/beheer.js', '/js/schermen/beheer-tabs.js', '/js/schermen/beheer-gebruikers-logica.js', '/js/schermen/beheer-gebruikers.js', '/js/schermen/beheer-instellingen.js', '/js/schermen/beheer-activiteit-logica.js', '/js/schermen/beheer-activiteit.js', '/js/schermen/beheer-systeemstatus.js', '/js/kern/loonkost.js', '/js/kern/dashboard-grenzen.js', '/js/kern/grafiek-ring.js', '/js/kern/grafiek-hulp.js', '/js/kern/grafiek-tabel.js', '/js/kern/grafiek-balken.js', '/js/kern/grafiek-donut.js', '/js/kern/grafiek-lijn.js', '/js/schermen/beheer-performance-logica.js', '/js/schermen/beheer-performance-blokhulp.js', '/js/schermen/beheer-performance-tijd.js', '/js/schermen/beheer-performance-kwaliteit.js', '/js/schermen/beheer-performance-onderdelen.js', '/js/schermen/beheer-performance-klant.js', '/js/schermen/beheer-performance-sales.js', '/css/dashboard.css'];
const CDN_VAST = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/signature_pad/4.1.7/signature_pad.umd.min.js', 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/layers.png', 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/layers-2x.png'];
// URL's in CDN_VAST die NIET bij de installatie worden opgehaald (enkel bij het eerste gebruik bewaard). Nu leeg: ExcelJS (258 kB gzip) wordt
// weer vooraf opgehaald zodat de eerste Excel-export ook offline werkt (zoals live); omdat de URL op versie vastgepind is, kost dat één keer per
// toestel (de installatie slaat wat al in de externe cache staat over, I5).
const CDN_LUI = [];
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
  // behandel() geeft null voor /api, niet-GET en onbekende hosts: dan doet de browser het verzoek zelf.
  const r = strategie.behandel(e.request, { waitUntil: (p) => e.waitUntil(p) });
  if (r) e.respondWith(r);
});
