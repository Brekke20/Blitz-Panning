// Sales-planner: geocoding via TomTom (enkel België). Gooit nooit; geeft bij elke mislukking null.
// De sleutel is een parameter (de handlers lezen process.env.TOMTOM_API_KEY zelf) en komt nooit in een log of fout.
// Testmodus: deterministische nepcoördinaten uit een hash van de invoer; `fetch` wordt dan nooit aangeroepen.
import { createHash } from 'node:crypto';

const TOMTOM = 'https://api.tomtom.com/search/2';
const MAX_POGINGEN = 3;
const BE = { latMin: 49.55, latMax: 51.45, lonMin: 2.6, lonMax: 6.3 };
const POSTCODE = /^\d{4}$/;

const slaap = ms => new Promise(r => setTimeout(r, ms));

// Deterministisch punt in de Belgische bounding box; zelfde invoer = zelfde punt.
function nepPunt(soort, invoer) {
  const h = createHash('sha256').update(`${soort}|${invoer}`).digest();
  const deel = (o) => h.readUInt32BE(o) / 0xffffffff;
  return {
    lat: Math.round((BE.latMin + deel(0) * (BE.latMax - BE.latMin)) * 1e5) / 1e5,
    lon: Math.round((BE.lonMin + deel(4) * (BE.lonMax - BE.lonMin)) * 1e5) / 1e5,
  };
}

// Eén TomTom-aanvraag met 429-backoff (attempt * 400 ms, zoals optimize.js). Geeft results[0] of null.
async function eersteResultaat(url, { fetch: f = globalThis.fetch, wacht = slaap }) {
  for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
    const res = await f(url);
    if (res.status === 429) {
      if (poging < MAX_POGINGEN) await wacht(poging * 400);
      continue;
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.[0] ?? null;
  }
  return null;
}

const geldigPunt = pos => Number.isFinite(pos?.lat) && Number.isFinite(pos?.lon);

/** Adrestekst -> { lat, lon } | null. Gooit nooit. */
export async function geocodeAdres(adres, { fetch, sleutel, testModus = false, wacht } = {}) {
  const tekst = typeof adres === 'string' ? adres.trim() : '';
  if (!tekst) return null;
  if (testModus) return nepPunt('adres', tekst);
  if (!sleutel) return null;
  try {
    const url = `${TOMTOM}/geocode/${encodeURIComponent(tekst)}.json?key=${encodeURIComponent(sleutel)}&countrySet=BE&limit=1`;
    const r = await eersteResultaat(url, { fetch, wacht });
    return geldigPunt(r?.position) ? { lat: r.position.lat, lon: r.position.lon } : null;
  } catch {
    return null;
  }
}

/** Belgische postcode (4 cijfers) -> { lat, lon, gemeente } | null. Gooit nooit. */
export async function geocodePostcode(pc, { fetch, sleutel, testModus = false, wacht } = {}) {
  if (typeof pc !== 'string' || !POSTCODE.test(pc)) return null;
  if (testModus) return { ...nepPunt('postcode', pc), gemeente: 'Testgemeente' };
  if (!sleutel) return null;
  try {
    const url = `${TOMTOM}/structuredGeocode.json?key=${encodeURIComponent(sleutel)}&countryCode=BE&postalCode=${pc}&limit=1`;
    const r = await eersteResultaat(url, { fetch, wacht });
    if (!geldigPunt(r?.position)) return null;
    return { lat: r.position.lat, lon: r.position.lon, gemeente: r.address?.municipality ?? '' };
  } catch {
    return null;
  }
}
