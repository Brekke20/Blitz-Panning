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

    if (!optRes.ok) {
      const errBody = await optRes.json().catch(() => ({}));
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `TomTom route-optimalisatie mislukt (${optRes.status})`, details: errBody }),
      };
    }

    const optData = await optRes.json();
    if (!Array.isArray(optData.optimizedOrder)) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'TomTom gaf geen geldige optimizedOrder terug', details: optData }),
      };
    }

    // Eerste en laatste waypoint zijn het vertrekpunt (index 0 in allPoints) — die horen niet
    // in de teruggegeven volgorde van de tussenliggende stops.
    const optimizedOrder = optData.optimizedOrder
      .filter(i => i !== 0 && i !== allPoints.length - 1)
      .map(i => i - 1); // terug naar 0-based index in stopsGeo

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
