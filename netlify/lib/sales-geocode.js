// Sales-planner: geocoding via TomTom (enkel België). Gooit nooit. Uitkomst: een punt, `null` = echt "niet gevonden",
// of `{ fout: true }` = tijdelijke fout (429 na herhaling, netwerkfout, time-out, HTTP-fout, ongeldig antwoord,
// ontbrekende sleutel): de aanroeper mag het later opnieuw proberen. Elke aanvraag heeft een time-out (standaard 5 s).
// De sleutel is een parameter (de handlers lezen process.env.TOMTOM_API_KEY zelf) en komt nooit in een log of fout.
// Testmodus: deterministische nepcoördinaten uit een hash van de invoer; `fetch` wordt dan nooit aangeroepen.
import { createHash } from 'node:crypto';

const TOMTOM = 'https://api.tomtom.com/search/2';
const MAX_POGINGEN = 3;
const TIMEOUT_MS = 5000;
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

const fout = () => ({ fout: true });

// Eén TomTom-aanvraag met 429-backoff (attempt * 400 ms, zoals optimize.js) en time-out per poging.
// Geeft results[0], null (geen resultaat) of { fout: true } (tijdelijk).
async function eersteResultaat(url, { fetch: f = globalThis.fetch, wacht = slaap, timeoutMs = TIMEOUT_MS }) {
  for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
    let res;
    try {
      res = await f(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return fout(); // netwerkfout of time-out
    }
    if (res.status === 429) {
      if (poging < MAX_POGINGEN) await wacht(poging * 400);
      continue;
    }
    if (!res.ok) return fout();
    try {
      const data = await res.json();
      return data?.results?.[0] ?? null;
    } catch {
      return fout(); // ongeldig antwoord of afgebroken tijdens het lezen
    }
  }
  return fout();
}

const geldigPunt = pos => Number.isFinite(pos?.lat) && Number.isFinite(pos?.lon);

/** Adrestekst -> { lat, lon } | null (niet gevonden) | { fout: true } (tijdelijk). Gooit nooit. */
export async function geocodeAdres(adres, { fetch, sleutel, testModus = false, wacht, timeoutMs } = {}) {
  const tekst = typeof adres === 'string' ? adres.trim() : '';
  if (!tekst) return null;
  if (testModus) return nepPunt('adres', tekst);
  if (!sleutel) return fout();
  try {
    const url = `${TOMTOM}/geocode/${encodeURIComponent(tekst)}.json?key=${encodeURIComponent(sleutel)}&countrySet=BE&limit=1`;
    const r = await eersteResultaat(url, { fetch, wacht, timeoutMs });
    if (r?.fout) return r;
    return geldigPunt(r?.position) ? { lat: r.position.lat, lon: r.position.lon } : null;
  } catch {
    return fout();
  }
}

/**
 * Belgische postcode (1000-9999) -> { lat, lon, gemeente } | null (niet gevonden) | { fout: true } (tijdelijk).
 * Het teruggegeven `address.postalCode` moet exact de gevraagde postcode zijn, anders telt het als niet gevonden
 * (TomTom geeft anders soms een naburige of ruimere plaats terug). Gooit nooit.
 */
export async function geocodePostcode(pc, { fetch, sleutel, testModus = false, wacht, timeoutMs } = {}) {
  if (typeof pc !== 'string' || !POSTCODE.test(pc) || Number(pc) < 1000) return null;
  if (testModus) return { ...nepPunt('postcode', pc), gemeente: 'Testgemeente' };
  if (!sleutel) return fout();
  try {
    const url = `${TOMTOM}/structuredGeocode.json?key=${encodeURIComponent(sleutel)}&countryCode=BE&postalCode=${pc}&limit=1`;
    const r = await eersteResultaat(url, { fetch, wacht, timeoutMs });
    if (r?.fout) return r;
    if (!geldigPunt(r?.position) || String(r.address?.postalCode ?? '').trim() !== pc) return null;
    return { lat: r.position.lat, lon: r.position.lon, gemeente: r.address?.municipality ?? '' };
  } catch {
    return fout();
  }
}
