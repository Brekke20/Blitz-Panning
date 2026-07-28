// /api/route  (POST)
// Body: { waypoints: [{lat, lon}, ...] }
// Returns full route with travel times, distance, traffic info

const TOMTOM_BASE = 'https://api.tomtom.com';
const API_KEY = () => process.env.TOMTOM_API_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// TomTom's routing-tier laat maar een beperkt aantal aanvragen per seconde toe. De
// max-reistijd-check in autoPlan() roept dit endpoint nu potentieel meerdere keren na
// elkaar aan tijdens één "Plan deze week"-run — zelfde retry-met-backoff-patroon als
// optimize.js's geocode() voor exact hetzelfde soort probleem.
async function fetchTomTomRoute(url, attempt = 1) {
  const res = await fetch(url);
  if (res.status === 429 && attempt <= 3) {
    await sleep(attempt * 400);
    return fetchTomTomRoute(url, attempt + 1);
  }
  return res;
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
    const { waypoints } = JSON.parse(event.body || '{}');
    if (!waypoints?.length || waypoints.length < 2) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Need at least 2 waypoints' }),
      };
    }

    const coordString = waypoints.map(w => `${w.lat},${w.lon}`).join(':');
    const url =
      `${TOMTOM_BASE}/routing/1/calculateRoute/${coordString}/json` +
      `?key=${API_KEY()}` +
      `&travelMode=car` +
      `&traffic=true` +
      `&routeType=fastest` +
      `&computeTravelTimeFor=all` +
      `&sectionType=traffic` +
      `&report=effectiveSettings`;

    const res = await fetchTomTomRoute(url);
    const data = await res.json();

    const route = data.routes?.[0];
    if (!route) throw new Error('No route returned from TomTom');

    const summary = route.summary;
    const legs = route.legs?.map(leg => ({
      travelTimeSeconds: leg.summary.travelTimeInSeconds,
      noTrafficTravelTimeSeconds: leg.summary.noTrafficTravelTimeInSeconds,
      travelTimeWithTrafficSeconds: leg.summary.trafficDelayInSeconds + leg.summary.travelTimeInSeconds,
      distanceMeters: leg.summary.lengthInMeters,
      trafficDelaySeconds: leg.summary.trafficDelayInSeconds,
    })) || [];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalTravelTimeSeconds: summary.travelTimeInSeconds,
        totalDistanceMeters: summary.lengthInMeters,
        totalTrafficDelaySeconds: summary.trafficDelayInSeconds,
        arrivalTime: summary.arrivalTime,
        departureTime: summary.departureTime,
        legs,
        polyline: route.legs?.flatMap(leg =>
          leg.points?.map(p => [p.latitude, p.longitude]) || []
        ) || [],
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
