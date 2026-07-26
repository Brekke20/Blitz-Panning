// /api/optimize  (POST)
// Body: { origin: "Adres vertrekpunt", stops: ["adres1", "adres2", ...] }
// Returns optimized order + geocoded coordinates via TomTom Waypoint Optimization API

const TOMTOM_BASE = 'https://api.tomtom.com';
const API_KEY = () => process.env.TOMTOM_API_KEY;

async function geocode(address) {
  const url = `${TOMTOM_BASE}/search/2/geocode/${encodeURIComponent(address)}.json?key=${API_KEY()}&countrySet=BE`;
  const res = await fetch(url);
  const data = await res.json();
  const pos = data.results?.[0]?.position;
  if (!pos) throw new Error(`Geocoding failed for: ${address}`);
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

    // Geocode all locations in parallel
    const [originGeo, ...stopsGeo] = await Promise.all([
      geocode(origin),
      ...stops.map(geocode),
    ]);

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

    // Geocoding is hier al gelukt. Een deel van de frontend (calculateRoute()) roept dit
    // endpoint uitsluitend aan om te geocoderen en leest alleen `locations` — een harde 502
    // bij een mislukte waypoint-optimalisatie zou dat werkende resultaat weggooien. Daarom:
    // altijd 200 + `locations`, met `optimizeError` als de optimalisatie zelf faalde. Callers
    // die de volgorde wél nodig hebben (optimizeRoute()) checken op `optimizeError` en vallen
    // terug op de bestaande volgorde. `optimizedOrder` wordt in dat geval NIET meegestuurd,
    // zodat een korte/kapotte array nooit als betrouwbaar bij een caller aankomt.
    const geocodeOnly = (optimizeError, details) => ({
      statusCode: 200,
      headers,
      body: JSON.stringify({
        locations: [originGeo, ...stopsGeo],
        optimizeError,
        ...(details ? { details } : {}),
      }),
    });

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
