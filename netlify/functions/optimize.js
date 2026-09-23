// /api/optimize  (POST)
// Body: { origin: "Adres vertrekpunt", stops: ["adres1", "adres2", ...] }
// Returns optimized order + geocoded coordinates via TomTom Waypoint Optimization API

const TOMTOM_BASE = 'https://api.tomtom.com';
const API_KEY = () => process.env.TOMTOM_API_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// TomTom's geocode-tier laat maar een handvol aanvragen per seconde toe. Deze app vuurt per
// knopklik gemakkelijk 5-10 gelijktijdige geocode-aanvragen af (elk ticketadres + de
// startlocatie, soms meermaals na elkaar via optimizeRoute() -> calculateRoute()) — dat
// overschrijdt die limiet vaak (HTTP 429 "TooManyRequests"), vandaar de eerder
// onbetrouwbare/onverklaarbare foutmeldingen. Retry met backoff lost het overgrote deel
// hiervan vanzelf op; de foutmelding bij een écht mislukte geocoding blijft ook duidelijker.
async function geocode(address, attempt = 1) {
  // Niet enkel België: Blitz Power rijdt ook grensklanten (bv. net over de grens in
  // Nederland) — countrySet=BE alleen liet zulke adressen nooit geocoderen (TomTom gaf
  // dan gewoon 0 resultaten, geen fout), ook al was het adres perfect geldig.
  const url = `${TOMTOM_BASE}/search/2/geocode/${encodeURIComponent(address)}.json?key=${API_KEY()}&countrySet=BE,NL,LU,FR,DE`;
  const res = await fetch(url);
  if (res.status === 429 && attempt <= 3) {
    await sleep(attempt * 400);
    return geocode(address, attempt + 1);
  }
  const data = await res.json();
  const pos = data.results?.[0]?.position;
  if (!pos) {
    const reason = data.detailedError?.message || `HTTP ${res.status}`;
    throw new Error(`Geocoding failed for: ${address} (${reason})`);
  }
  return { lat: pos.lat, lon: pos.lon, address };
}

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { origin, stops } = body;

    if (!origin || !stops?.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing origin or stops' }),
      };
    }

    // (C2) Geocode all locations — tolerant per stop met Promise.allSettled i.p.v. Promise.all:
    // één onvindbaar adres (of een lokale afspraak wiens "adres" eigenlijk een vrije-tekst
    // notitie is, bv. "Administratie") mag niet de hele batch laten mislukken — vóór deze fix
    // gaf één mislukte geocode() een throw die Promise.all liet rejecten, waardoor ALLE stops
    // (ook de wél vindbare) zonder coördinaten bleven. Het VERTREKPUNT blijft hard vereist: zonder
    // vertrekpunt is er niets om een route vanaf te berekenen/tekenen, dus dat geeft nog steeds
    // een harde fout terug.
    const results = await Promise.allSettled([geocode(origin), ...stops.map(geocode)]);
    const [originResult, ...stopResults] = results;

    if (originResult.status === 'rejected') {
      const reason = originResult.reason?.message || String(originResult.reason);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Vertrekpunt '${origin}' kon niet opgezocht worden (${reason})` }),
      };
    }
    const originGeo = originResult.value;
    // Index-uitlijning met `stops` blijft behouden: een mislukte stop wordt `null` i.p.v. uit de
    // array verwijderd, zodat callers (optimizeRoute()/autoPlan()/calculateRoute()) elke stop nog
    // altijd op zijn oorspronkelijke index kunnen terugvinden — en nooit een null cachen.
    const stopsGeo = stopResults.map(r => (r.status === 'fulfilled' ? r.value : null));
    const aantalMislukt = stopsGeo.filter(s => !s).length;

    // Geocoding is hier al gelukt (voor het vertrekpunt, en voor de stops die wél lukten). Een
    // deel van de frontend (calculateRoute()) roept dit endpoint uitsluitend aan om te geocoderen
    // en leest alleen `locations` — een harde fout bij een mislukte waypoint-optimalisatie zou dat
    // werkende resultaat weggooien. Daarom: altijd 200 + `locations`, met `optimizeError` als de
    // optimalisatie zelf (gedeeltelijk) faalde. Callers die de volgorde wél nodig hebben
    // (optimizeRoute()) checken op `optimizeError` en vallen terug op de bestaande volgorde.
    // `optimizedOrder` wordt in dat geval NIET meegestuurd, zodat een korte/kapotte array nooit
    // als betrouwbaar bij een caller aankomt.
    const geocodeOnly = (optimizeError, details) => ({
      statusCode: 200,
      headers,
      body: JSON.stringify({
        locations: [originGeo, ...stopsGeo],
        optimizeError,
        ...(details ? { details } : {}),
      }),
    });

    if (stopsGeo.length === 0 || stopsGeo.every(s => !s)) {
      // Geen enkele stop kon gegeocodeerd worden (vertrekpunt wel) -- niets om te optimaliseren.
      return geocodeOnly('Niet alle adressen gevonden');
    }

    if (aantalMislukt > 0) {
      // Eén of meer (maar niet alle) stops niet gevonden -- de waypoint-optimalisatiestap vereist
      // ALLE punten (kan geen `null` naar TomTom sturen), dus die stap wordt overgeslagen.
      // `locations` blijft wel volledig (met `null` op de mislukte posities) zodat de client de
      // wél gevonden stops alsnog op de kaart kan tonen (bestaande `optimizeError`-fallback in
      // optimizeRoute()/calculateRoute() dekt dit al af).
      return geocodeOnly('Niet alle adressen gevonden');
    }

    if (stopsGeo.length === 1) {
      // Only one stop — no optimization needed
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          optimizedOrder: [0],
          locations: [originGeo, ...stopsGeo],
        }),
      };
    }

    // TomTom Waypoint Optimization v1: origin/destination zijn zelf waypoints
    // (eerste en laatste element), en de opties horen in de body onder "options" —
    // niet als query-parameters (die worden door deze API genegeerd).
    const allPoints = [originGeo, ...stopsGeo, originGeo]; // start en eind bij het vertrekpunt
    const waypointsBody = {
      waypoints: allPoints.map((s) => ({
        point: { latitude: s.lat, longitude: s.lon },
      })),
      options: {
        travelMode: 'car',
        departAt: new Date().toISOString(),
      },
    };

    const optRes = await fetch(
      `${TOMTOM_BASE}/routing/waypointoptimization/1?key=${API_KEY()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(waypointsBody),
      }
    );

    if (!optRes.ok) {
      const errBody = await optRes.json().catch(() => ({}));
      return geocodeOnly(`TomTom route-optimalisatie mislukt (${optRes.status})`, errBody);
    }

    const optData = await optRes.json().catch(() => null);
    if (!optData || !Array.isArray(optData.optimizedOrder)) {
      return geocodeOnly('TomTom gaf geen geldige optimizedOrder terug', optData ?? undefined);
    }

    // Eerste en laatste waypoint zijn het vertrekpunt (index 0 in allPoints) — die horen niet
    // in de teruggegeven volgorde van de tussenliggende stops.
    const optimizedOrder = optData.optimizedOrder
      .filter(i => i !== 0 && i !== allPoints.length - 1)
      .map(i => i - 1); // terug naar 0-based index in stopsGeo

    // Defensief: de volgorde moet exact één keer naar elke stop verwijzen. Een korte of
    // kapotte array zou bij de caller stops laten verdwijnen of dupliceren (planning[date]
    // wordt daarmee overschreven), dus behandelen we dat als een mislukte optimalisatie.
    const isVolledigePermutatie =
      optimizedOrder.length === stopsGeo.length &&
      new Set(optimizedOrder).size === stopsGeo.length &&
      optimizedOrder.every(i => Number.isInteger(i) && i >= 0 && i < stopsGeo.length);

    if (!isVolledigePermutatie) {
      return geocodeOnly(
        `TomTom gaf een onbruikbare optimizedOrder terug (${optimizedOrder.length} van ${stopsGeo.length} stops)`,
        optData,
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        optimizedOrder,
        locations: [originGeo, ...stopsGeo],
        rawResponse: optData,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
