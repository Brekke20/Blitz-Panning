// /api/route  (POST)
// Body: { waypoints: [{lat, lon}, ...], departAt? }
// Returns full route with travel times, distance, traffic info
// departAt (optioneel, ISO-8601 UTC, moet in de toekomst liggen): laat TomTom rekenen met
// historische verkeerspatronen voor die dag/dat uur i.p.v. het verkeer van "nu".

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
    const { waypoints, departAt } = JSON.parse(event.body || '{}');
    if (!waypoints?.length || waypoints.length < 2) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Need at least 2 waypoints' }),
      };
    }

    // departAt moet een geldige ISO-8601 UTC-string in de toekomst zijn — TomTom weigert
    // een vertrektijd in het verleden. Ongeldig/verleden wordt genegeerd (= nu, live verkeer).
    const departAtGeldig =
      typeof departAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(departAt) &&
      Date.parse(departAt) > Date.now() + 60_000;
    const departAtUsed = departAtGeldig ? departAt : null;

    const coordString = waypoints.map(w => `${w.lat},${w.lon}`).join(':');
    const url =
      `${TOMTOM_BASE}/routing/1/calculateRoute/${coordString}/json` +
      `?key=${API_KEY()}` +
      `&travelMode=car` +
      `&traffic=true` +
      `&routeType=fastest` +
      `&computeTravelTimeFor=all` +
      `&sectionType=traffic` +
      `&report=effectiveSettings` +
      (departAtUsed ? `&departAt=${encodeURIComponent(departAtUsed)}` : '');

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
      pointCount: leg.points?.length || 0,
    })) || [];

    // TRAFFIC-secties: indices verwijzen naar de geconcateneerde puntenlijst van alle legs,
    // exact zoals `polyline` hieronder is opgebouwd — passen dus 1-op-1 op `polyline`.
    const sections = route.sections
      ?.filter(s => s.sectionType === 'TRAFFIC')
      .map(s => ({
        startPointIndex: s.startPointIndex,
        endPointIndex: s.endPointIndex,
        magnitudeOfDelay: s.magnitudeOfDelay ?? 0,
        delayInSeconds: s.delayInSeconds ?? 0,
        simpleCategory: s.simpleCategory || '',
        effectiveSpeedInKmh: s.effectiveSpeedInKmh ?? null,
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
        sections,
        departAtUsed,
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
