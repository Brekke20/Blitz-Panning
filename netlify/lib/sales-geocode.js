// Sales-planner: geocoding via TomTom (enkel België). Gooit nooit. Uitkomst: een punt, `null` = echt "niet gevonden",
// of `{ fout: true }` = tijdelijke fout (429 na herhaling, netwerkfout, time-out, HTTP-fout, ongeldig antwoord,
// ontbrekende sleutel): de aanroeper mag het later opnieuw proberen. Elke aanvraag heeft een time-out (standaard 5 s).
// De sleutel is een parameter (de handlers lezen process.env.TOMTOM_API_KEY zelf) en komt nooit in een log of fout.
// Testmodus: deterministische (realistische) coördinaten, zie nepPunt; `fetch` wordt dan nooit aangeroepen.
import { createHash } from 'node:crypto';

const TOMTOM = 'https://api.tomtom.com/search/2';
const MAX_POGINGEN = 3;
const TIMEOUT_MS = 5000;
const POSTCODE = /^\d{4}$/;

const slaap = ms => new Promise(r => setTimeout(r, ms));

// Testmodus: deterministische, REALISTISCHE punten, zodat de demo ze met TomTom kan routeren (/api/route, /api/matrix). Bekende postcodes krijgen
// hun echte middelpunt (Limburg en omgeving; een adres met die postcode ligt er een paar honderd meter naast); een onbekende postcode of adres zonder
// postcode krijgt een deterministisch punt in een kader rond Limburg (land, met wegen), nooit zomaar ergens in de Belgische bounding box.
const POSTCODE_CENTRA = {
  1000: [50.8503, 4.3517], 2000: [51.2194, 4.4025], 2440: [51.1650, 4.9890], 2800: [51.0259, 4.4776], 3000: [50.8790, 4.7010],
  3300: [50.8070, 4.9380], 3400: [50.7520, 5.0800], 3500: [50.9307, 5.3325], 3510: [50.9600, 5.2700], 3520: [50.9900, 5.3700],
  3530: [51.0300, 5.3800], 3540: [50.9380, 5.1700], 3550: [51.0372, 5.2940], 3560: [50.9890, 5.2000], 3580: [51.0500, 5.2200],
  3590: [50.9000, 5.4180], 3600: [50.9650, 5.5008], 3620: [50.8900, 5.6500], 3630: [50.9600, 5.6900], 3640: [51.1469, 5.7478],
  3650: [51.0300, 5.7100], 3660: [51.0600, 5.5900], 3670: [51.0900, 5.5700], 3680: [51.0950, 5.7900], 3690: [50.9300, 5.5800],
  3700: [50.7800, 5.4650], 3720: [50.8600, 5.3900], 3730: [50.8400, 5.4900], 3740: [50.8700, 5.5200], 3800: [50.8170, 5.1870],
  3900: [51.2000, 5.4000], 3920: [51.2300, 5.3130], 3945: [51.0900, 5.1700], 3960: [51.1380, 5.5950], 3970: [51.1200, 5.2600],
  3980: [51.0700, 5.0800], 3990: [51.1300, 5.4600],
};
const LIMBURG = { latMin: 50.80, latMax: 51.20, lonMin: 5.10, lonMax: 5.70 };
const POSTCODE_IN_TEKST = /(?<!\d)([1-9]\d{3})(?!\d)/;
const rond = (x) => Math.round(x * 1e5) / 1e5;

function nepPunt(soort, invoer) {
  const h = createHash('sha256').update(`${soort}|${invoer}`).digest();
  const deel = (o) => h.readUInt32BE(o) / 0xffffffff;
  const pc = soort === 'postcode' ? invoer : POSTCODE_IN_TEKST.exec(invoer)?.[1];
  const midden = pc ? POSTCODE_CENTRA[Number(pc)] : null;
  if (midden) {
    // het middelpunt zelf voor een postcode; een adres in die gemeente ligt er een stukje naast (± ~1 km)
    if (soort === 'postcode') return { lat: midden[0], lon: midden[1] };
    return { lat: rond(midden[0] + (deel(0) - 0.5) * 0.02), lon: rond(midden[1] + (deel(4) - 0.5) * 0.03) };
  }
  return {
    lat: rond(LIMBURG.latMin + deel(0) * (LIMBURG.latMax - LIMBURG.latMin)),
    lon: rond(LIMBURG.lonMin + deel(4) * (LIMBURG.lonMax - LIMBURG.lonMin)),
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
