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

    // TomTom Waypoint Optimization
    const waypointsBody = {
      waypoints: stopsGeo.map((s, i) => ({
        point: { latitude: s.lat, longitude: s.lon },
        waypoint_id: String(i),
      })),
      departureTime: new Date().toISOString(),
    };

    const optRes = await fetch(
      `${TOMTOM_BASE}/routing/waypointoptimization/1?key=${API_KEY()}` +
      `&origin=${originGeo.lat},${originGeo.lon}` +
      `&destination=${originGeo.lat},${originGeo.lon}` + // return to origin optional
      `&travelMode=car`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(waypointsBody),
      }
    );

    const optData = await optRes.json();

    // Extract optimized order
    const optimizedOrder = optData.optimizedOrder || stopsGeo.map((_, i) => i);

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
