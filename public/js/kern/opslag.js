// kern/opslag.js — localStorage-hulpen: cache-eerst-laden/-bewaren en de persistente geocode-cache (geen DOM, geen window).
// Letterlijk uit het klassieke script van index.html (etappe 5b, taak 8); enkel `export`. `inventaris.js` importeert
// `loadFromCache`/`saveToCache` hier (voorheen kale globals); de schermen krijgen ze via `afh` van app.js.

// Generieke cache-first-helpers (Blok 1D). Elke loader die dit gebruikt: leest eerst synchroon
// uit localStorage en past dat toe (render meteen "wat lokaal bekend is"), start dan de echte
// fetch op de achtergrond, en werkt bij zodra die binnenkomt ("stale-while-revalidate"). Dit is
// een BEWUSTE gedragswijziging t.o.v. vandaag (waar deze 3 loaders bij een fetch-fout terugvallen
// naar een LEGE staat) — bij een fetch-fout blijft nu de laatst gekende cache staan i.p.v. leeg te
// worden, wat een verbetering is, geen toevallige bijwerking (zie Task 12's Let op).
export function loadFromCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveToCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* quota vol o.i.d. — cache is best-effort */ }
}

// Persistente geocode-cache (kaart-snelheid-onderzoek 2026-09-22, oorzaak 1): coördinaten die
// TomTom al eens opzocht voor een adres, blijven bewaard tussen pagina-herladen/sessies — i.p.v.
// enkel in-memory op planning[]-objecten te staan, die applyTicketsData() bij elke ticketherlaad
// (dus ook de 5-min-poll) stilzwijgend wegwerpt (zie hieronder). Cap ~500 adressen, oudste
// timestamp sneuvelt eerst bij overschrijding; 90 dagen TTL (een adres dat 3 maanden niet meer
// gebruikt werd, wordt gewoon stilzwijgend opnieuw geocodeerd -- geen harde foutmelding nodig).
const GEOCACHE_KEY    = 'blitz_geocache';
const GEOCACHE_MAX    = 500;
const GEOCACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function normAdres(adres) {
  return String(adres || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function loadGeocache() {
  try { return JSON.parse(localStorage.getItem(GEOCACHE_KEY) || '{}'); } catch { return {}; }
}
export function geocacheLookup(adres) {
  const key = normAdres(adres);
  if (!key) return null;
  const hit = loadGeocache()[key];
  if (!hit || (Date.now() - hit.t) > GEOCACHE_TTL_MS) return null;
  return { lat: hit.lat, lon: hit.lon };
}
export function geocacheStore(adres, lat, lon) {
  const key = normAdres(adres);
  if (!key || lat == null || lon == null) return;
  const cache = loadGeocache();
  cache[key] = { lat, lon, t: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > GEOCACHE_MAX) {
    keys.sort((a, b) => cache[a].t - cache[b].t)
        .slice(0, keys.length - GEOCACHE_MAX)
        .forEach(k => delete cache[k]);
  }
  try { localStorage.setItem(GEOCACHE_KEY, JSON.stringify(cache)); } catch { /* quota vol — best-effort */ }
}
