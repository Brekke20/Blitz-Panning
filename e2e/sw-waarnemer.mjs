// Waarnemer van de service worker-verzoeken (etappe 7, Task 5). Importeren mag ENKEL e2e/sw-hulp.mjs en de zelftest-hulp
// (e2e/sw/zelftest-hulp.mjs); de importguard laat elk ander bestand falen. De lekmeldingen staan hier: wie ze kan leegmaken, kan
// een lek wegpoetsen. Een service worker-verzoek is een verzoek dat Playwright als `request.serviceWorker()` meldt (de pagina
// zelf doet zijn eigen verzoeken; die controleren de sloten van productie-hulp.mjs).
//
// Regels voor wat de SW zelf mag ophalen (een overtreding laat de test falen in afterEach):
//   - nooit een /api-verzoek (de SW handelt /api niet af: geen cache, geen doorsturen);
//   - nooit iets anders dan GET;
//   - enkel de eigen server (localhost:3338), de twee CDN-hosts en de twee Google Fonts-hosts.
// Zoho/TomTom/mail zijn hiermee uitgesloten (de host-regel is een toelatingslijst, geen verbodslijst).
// Eén bewuste uitbreiding: de bevroren SW van main (updatepad-test, `toestaOudeSw`) stuurt ALLE niet-/api-verzoeken door naar het netwerk, dus ook de
// kaarttegels; die staan enkel toe voor GET naar de twee tegelhosts, die stubExtern altijd zelf beantwoordt (nooit echt opgehaald).
const EIGEN_HOSTS = ['localhost:3338', '127.0.0.1:3338'];
const SW_HOSTS = new Set([...EIGEN_HOSTS, 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
const PER_CONTEXT = new WeakMap();

// Waarom (indien ooit) een SW-verzoek niet mag; null = in orde.
const TEGEL_HOSTS = /^(server\.arcgisonline\.com|[a-c]\.tile\.openstreetmap\.org)$/;
export function swOvertreding({ methode, url }, { oudeSw = false } = {}) {
  let u;
  try { u = new URL(url); } catch { return `ongeldige URL: ${url}`; }
  if (!/^https?:$/.test(u.protocol)) return null; // data:/blob: verlaten de browser niet
  if (methode !== 'GET') return `niet-GET van de service worker: ${methode} ${u.href}`;
  if (EIGEN_HOSTS.includes(u.host) && (u.pathname === '/api' || u.pathname.startsWith('/api/'))) return `/api-verzoek van de service worker: ${u.href}`;
  if (oudeSw && TEGEL_HOSTS.test(u.hostname)) return null;
  if (!SW_HOSTS.has(u.host)) return `service worker-verzoek naar een niet-toegestane host: ${u.href}`;
  return null;
}

export function swWaarnemer(context) {
  if (PER_CONTEXT.has(context)) return PER_CONTEXT.get(context);
  const w = { verzoeken: [], overtredingen: [], oudeSw: false };
  context.on('request', (req) => {
    if (!req.serviceWorker()) return;
    const methode = req.method();
    const url = req.url();
    w.verzoeken.push({ methode, url });
    const reden = swOvertreding({ methode, url }, { oudeSw: w.oudeSw });
    if (reden) w.overtredingen.push(reden);
  });
  PER_CONTEXT.set(context, w);
  return w;
}

// Enkel voor de zelftest: geeft de bewust uitgelokte overtredingen terug en leegt ze.
export function neemOvertredingenOver(context) {
  const w = swWaarnemer(context);
  const uit = [...w.overtredingen];
  w.overtredingen.length = 0;
  return uit;
}

// Enkel voor de updatepad-test (sw-hulp.serveerOudeSw): de bevroren SW van main mag de tegelhosts (gestubde GET's) doorsturen.
export function toestaOudeSw(context) {
  swWaarnemer(context).oudeSw = true;
}
