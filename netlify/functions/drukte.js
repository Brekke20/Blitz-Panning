// /api/drukte  (POST)
// Body: { polyline: [[lat, lon], ...], departAt, segmentMeters? }
// Waarom: bij een toekomstig departAt geeft TomTom geen TRAFFIC-sections (zie route.js),
// dus is er geen "waar precies wordt het druk"-signaal binnen één rit. Dit endpoint knipt
// de al berekende routelijn om de ±segmentMeters op in tussenpunten (liggen op de weg, de
// route zelf wijzigt niet) en laat TomTom die reeks in één keer doorrekenen met
// computeTravelTimeFor=all, zodat we per stukje de historische vs. vrije-doorstroming-
// rijtijd terugkrijgen. Kostprijs: 1-3 TomTom-aanvragen per berekening (chunks van max
// 100 waypoints).

const TOMTOM_BASE = 'https://api.tomtom.com';
const API_KEY = () => process.env.TOMTOM_API_KEY;

const MAX_PUNTEN = 5000;
const MIN_SEGMENT_METERS = 500;
const MAX_SEGMENT_METERS = 5000;
const MIN_WAYPOINT_AFSTAND_METERS = 50;
const MAX_WAYPOINTS_PER_AANVRAAG = 100;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Zelfde retry-met-backoff-patroon als route.js's fetchTomTomRoute — TomTom's routing-tier
// laat maar een beperkt aantal aanvragen per seconde toe.
async function fetchTomTomRoute(url, attempt = 1) {
  const res = await fetch(url);
  if (res.status === 429 && attempt <= 3) {
    await sleep(attempt * 400);
    return fetchTomTomRoute(url, attempt + 1);
  }
  return res;
}

// Haversine-afstand in meters tussen twee [lat, lon]-punten.
function afstandMeters([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Kies tussenpunten uit de polyline: altijd het eerste en laatste punt, daarna telkens
// het eerstvolgende punt zodra ≥ segmentMeters sinds het vorige gekozen punt is afgelegd.
// Punten die < 50 m van het vorige gekozen punt liggen worden overgeslagen — TomTom
// weigert vrijwel samenvallende waypoints.
function kiesTussenpunten(polyline, segmentMeters) {
  const gekozen = [polyline[0]];
  let sindsVorige = 0;
  for (let i = 1; i < polyline.length - 1; i++) {
    sindsVorige += afstandMeters(polyline[i - 1], polyline[i]);
    if (sindsVorige >= segmentMeters) {
      const laatste = gekozen[gekozen.length - 1];
      if (afstandMeters(laatste, polyline[i]) >= MIN_WAYPOINT_AFSTAND_METERS) {
        gekozen.push(polyline[i]);
        sindsVorige = 0;
      }
    }
  }
  const eind = polyline[polyline.length - 1];
  const laatsteGekozen = gekozen[gekozen.length - 1];
  if (afstandMeters(laatsteGekozen, eind) >= MIN_WAYPOINT_AFSTAND_METERS) {
    gekozen.push(eind);
  } else if (gekozen.length === 1) {
    // Polyline is korter dan MIN_WAYPOINT_AFSTAND_METERS in totaal — toch 2 punten nodig.
    gekozen.push(eind);
  }
  return gekozen;
}

// Splits de tussenpunten op in opeenvolgende chunks van max MAX_WAYPOINTS_PER_AANVRAAG.
// Elke chunk begint met het laatste punt van de vorige, zodat de route aaneengesloten blijft.
function chunkWaypoints(punten) {
  if (punten.length <= MAX_WAYPOINTS_PER_AANVRAAG) return [punten];
  const chunks = [];
  let start = 0;
  while (start < punten.length - 1) {
    const eind = Math.min(start + MAX_WAYPOINTS_PER_AANVRAAG - 1, punten.length - 1);
    chunks.push(punten.slice(start, eind + 1));
    start = eind;
  }
  return chunks;
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
    const { polyline, departAt, segmentMeters } = JSON.parse(event.body || '{}');

    if (!Array.isArray(polyline) || polyline.length < 2 || polyline.length > MAX_PUNTEN ||
        !polyline.every(p => Array.isArray(p) && p.length === 2 &&
          typeof p[0] === 'number' && typeof p[1] === 'number' &&
          p[0] >= -90 && p[0] <= 90 && p[1] >= -180 && p[1] <= 180)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'polyline moet een array van [lat, lon]-punten zijn (2-5000 stuks)' }),
      };
    }

    // departAt is hier verplicht (i.t.t. route.js) — dit endpoint is enkel zinvol voor
    // toekomstige dagen; voor vandaag/nu levert het live-sections-vangnet al het juiste beeld.
    const departAtGeldig =
      typeof departAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(departAt) &&
      Date.parse(departAt) > Date.now() + 60_000;
    if (!departAtGeldig) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'departAt moet in de toekomst liggen' }),
      };
    }

    const segMeters = Math.min(MAX_SEGMENT_METERS, Math.max(MIN_SEGMENT_METERS, Number(segmentMeters) || 1500));

    const tussenpunten = kiesTussenpunten(polyline, segMeters);
    const chunks = chunkWaypoints(tussenpunten);

    const segmenten = [];
    let cumulatieveTravelSeconds = 0;
    let chunkDepartAt = departAt;

    for (const chunk of chunks) {
      const coordString = chunk.map(([lat, lon]) => `${lat},${lon}`).join(':');
      const url =
        `${TOMTOM_BASE}/routing/1/calculateRoute/${coordString}/json` +
        `?key=${API_KEY()}` +
        `&travelMode=car` +
        `&traffic=true` +
        `&routeType=fastest` +
        `&computeTravelTimeFor=all` +
        `&departAt=${encodeURIComponent(chunkDepartAt)}`;

      const res = await fetchTomTomRoute(url);
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) throw new Error(data.error?.description || 'Geen route van TomTom voor drukte-detail');

      let chunkTravelSeconds = 0;
      (route.legs || []).forEach(leg => {
        segmenten.push({
          punten: (leg.points || []).map(p => [p.latitude, p.longitude]),
          noTrafficSeconds: leg.summary?.noTrafficTravelTimeInSeconds ?? null,
          historicSeconds: leg.summary?.historicTrafficTravelTimeInSeconds ?? null,
          travelSeconds: leg.summary?.travelTimeInSeconds,
          lengteMeters: leg.summary?.lengthInMeters,
          vertrekOffsetSeconds: cumulatieveTravelSeconds + chunkTravelSeconds,
        });
        chunkTravelSeconds += leg.summary?.travelTimeInSeconds || 0;
      });

      cumulatieveTravelSeconds += chunkTravelSeconds;
      chunkDepartAt = new Date(Date.parse(departAt) + cumulatieveTravelSeconds * 1000).toISOString();
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        segmenten,
        departAtUsed: departAt,
        aantalAanvragen: chunks.length,
        aantalWaypoints: tussenpunten.length,
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
