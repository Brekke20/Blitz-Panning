// /api/drukte  (POST)
// Body: { polyline: [[lat, lon], ...], departAt, segmentMeters? }
// Waarom: bij een toekomstig departAt geeft TomTom geen TRAFFIC-sections (zie route.js),
// dus is er geen "waar precies wordt het druk"-signaal binnen één rit. Dit endpoint knipt
// de al berekende routelijn om de ±segmentMeters op in tussenpunten (liggen op de weg, de
// route zelf wijzigt niet) en laat TomTom die reeks in één keer doorrekenen met
// computeTravelTimeFor=all, zodat we per stukje de historische vs. vrije-doorstroming-
// rijtijd terugkrijgen. Kostprijs: 1-3 TomTom-aanvragen per berekening (chunks van max
// 100 waypoints).
//
// Route-reconstructie (v1.5.1): de tussenpunten zijn gewone TomTom-"stops" — valt zo'n
// punt toevallig op de verkeerde rijbaan van een gescheiden weg (bv. een op- of afrit),
// dan tekent TomTom een keerlus/omweg om er exact langs te rijden, met een navenant
// foute rijtijd. Om dat te vermijden proberen we per chunk eerst "route reconstruction":
// een POST met `supportingPoints` (de originele routelijn zelf) die TomTom vertelt welk
// pad te volgen i.p.v. er zelf een te zoeken, op hetzelfde
// `calculateRoute/{lat,lon:...}/json`-pad als de GET-variant.
// Live vastgesteld (2026-09-22, echte TomTom-call): met méér dan 2 locations in het
// URL-pad (dus zodra een chunk tussenliggende stops bevat, wat bij een normale route
// altijd het geval is) weigert TomTom de combinatie met supportingPoints altijd, met
// HTTP 400 en `{"detailedError":{"message":"Invalid request: When supportingPoints are
// provided for the entire route, routePlanningLocations must not contain waypoints.",
// "code":"BAD_INPUT"}}`. Met exact 2 locations (enkel start+eind, geen tussenstops)
// aanvaardt TomTom de POST wel en volgt hij de supportingPoints exact (apart
// geverifieerd met een losse 2-punts-aanvraag). Reconstructie op chunk-niveau (zoals
// hieronder geïmplementeerd, conform de brief) faalt dus in de praktijk voor zo goed als
// elke chunk — `reconstructie` staat daardoor meestal op `false`. Bewust niet omgebouwd
// naar reconstructie per leg (elk paar opeenvolgende tussenpunten apart posten): dat zou
// het aantal TomTom-aanvragen per berekening doen exploderen (van 1-3 naar tot
// honderden bij een lange route), met alle kans-op-rate-limiting van dien. Bij een
// geweigerde chunk wordt de weigering gelogd en valt die chunk terug op de gewone
// GET-aanvraag — de sanity-check hieronder vangt eventuele afwijkende geometrie sowieso
// op (niet inkleuren i.p.v. fout inkleuren), ongeacht welke aanvraag gebruikt werd.

const TOMTOM_BASE = 'https://api.tomtom.com';
const API_KEY = () => process.env.TOMTOM_API_KEY;

const MAX_PUNTEN = 5000;
const MIN_SEGMENT_METERS = 500;
const MAX_SEGMENT_METERS = 5000;
const MIN_WAYPOINT_AFSTAND_METERS = 50;
const MAX_WAYPOINTS_PER_AANVRAAG = 100;
// TomTom's supportingPoints-array mag niet onbeperkt groot zijn — bij een chunk met meer
// dan dit aantal originele polyline-punten dunnen we uit (elke k-de behouden), maar de
// gekozen waypoint-punten zelf blijven altijd in de array staan.
const MAX_SUPPORTING_POINTS = 2000;

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

// Zelfde patroon, maar voor de POST-reconstructie-aanvraag (body met supportingPoints).
async function fetchTomTomRoutePost(url, body, attempt = 1) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && attempt <= 3) {
    await sleep(attempt * 400);
    return fetchTomTomRoutePost(url, body, attempt + 1);
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

// Som van de haversine-afstanden tussen opeenvolgende polyline-punten van startIndex t/m
// endIndex (inclusief) — de "originele" lengte van dat stuk, voor de sanity-check.
function lengteVanStuk(polyline, startIndex, endIndex) {
  let totaal = 0;
  for (let i = startIndex; i < endIndex; i++) {
    totaal += afstandMeters(polyline[i], polyline[i + 1]);
  }
  return totaal;
}

// Kies tussenpunten uit de polyline: altijd het eerste en laatste punt, daarna telkens
// het eerstvolgende punt zodra ≥ segmentMeters sinds het vorige gekozen punt is afgelegd.
// Punten die < 50 m van het vorige gekozen punt liggen worden overgeslagen — TomTom
// weigert vrijwel samenvallende waypoints. Elk gekozen punt bewaart zijn index in de
// originele polyline, zodat de client nadien het bijhorende stuk van de eigen lijn kan
// tekenen i.p.v. TomTom's teruggegeven leg-geometrie.
function kiesTussenpunten(polyline, segmentMeters) {
  const gekozen = [{ punt: polyline[0], index: 0 }];
  let sindsVorige = 0;
  for (let i = 1; i < polyline.length - 1; i++) {
    sindsVorige += afstandMeters(polyline[i - 1], polyline[i]);
    if (sindsVorige >= segmentMeters) {
      const laatste = gekozen[gekozen.length - 1];
      if (afstandMeters(laatste.punt, polyline[i]) >= MIN_WAYPOINT_AFSTAND_METERS) {
        gekozen.push({ punt: polyline[i], index: i });
        sindsVorige = 0;
      }
    }
  }
  const eindIndex = polyline.length - 1;
  const eind = polyline[eindIndex];
  const laatsteGekozen = gekozen[gekozen.length - 1];
  if (afstandMeters(laatsteGekozen.punt, eind) >= MIN_WAYPOINT_AFSTAND_METERS) {
    gekozen.push({ punt: eind, index: eindIndex });
  } else if (gekozen.length === 1) {
    // Polyline is korter dan MIN_WAYPOINT_AFSTAND_METERS in totaal — toch 2 punten nodig.
    gekozen.push({ punt: eind, index: eindIndex });
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

// Bouwt de supportingPoints-array voor de POST-reconstructie van één chunk: alle originele
// polyline-punten van chunk-startIndex t/m chunk-endIndex, eventueel uitgedund als dat er
// te veel zijn, met de gekozen waypoint-punten zelf altijd behouden.
function bouwSupportingPoints(polyline, chunk) {
  const startIndex = chunk[0].index;
  const endIndex = chunk[chunk.length - 1].index;
  const waypointIndices = new Set(chunk.map(t => t.index));
  const totaal = endIndex - startIndex + 1;

  let indices;
  if (totaal <= MAX_SUPPORTING_POINTS) {
    indices = [];
    for (let i = startIndex; i <= endIndex; i++) indices.push(i);
  } else {
    const k = Math.ceil(totaal / MAX_SUPPORTING_POINTS);
    const set = new Set();
    for (let i = startIndex; i <= endIndex; i += k) set.add(i);
    waypointIndices.forEach(i => set.add(i));
    set.add(startIndex);
    set.add(endIndex);
    indices = Array.from(set).sort((a, b) => a - b);
  }
  return indices.map(i => ({ latitude: polyline[i][0], longitude: polyline[i][1] }));
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
    let alleChunksReconstructie = true;

    for (const chunk of chunks) {
      const coordString = chunk.map(t => `${t.punt[0]},${t.punt[1]}`).join(':');
      const url =
        `${TOMTOM_BASE}/routing/1/calculateRoute/${coordString}/json` +
        `?key=${API_KEY()}` +
        `&travelMode=car` +
        `&traffic=true` +
        `&routeType=fastest` +
        `&computeTravelTimeFor=all` +
        `&departAt=${encodeURIComponent(chunkDepartAt)}`;

      let route = null;

      // Probeer eerst route-reconstructie: TomTom volgt dan de originele routelijn i.p.v.
      // zelf een pad tussen de tussenpunten te zoeken.
      try {
        const supportingPoints = bouwSupportingPoints(polyline, chunk);
        const postRes = await fetchTomTomRoutePost(url, { supportingPoints });
        if (postRes.ok) {
          const postData = await postRes.json();
          route = postData.routes?.[0] || null;
        } else {
          const body = await postRes.text();
          console.warn('drukte: reconstructie geweigerd', postRes.status, body.slice(0, 300));
        }
      } catch (err) {
        console.warn('drukte: reconstructie-aanvraag mislukt', err.message);
      }

      if (!route) {
        alleChunksReconstructie = false;
        const getRes = await fetchTomTomRoute(url);
        const getData = await getRes.json();
        route = getData.routes?.[0];
        if (!route) throw new Error(getData.error?.description || 'Geen route van TomTom voor drukte-detail');
      }

      let chunkTravelSeconds = 0;
      (route.legs || []).forEach((leg, j) => {
        const startIndex = chunk[j].index;
        const endIndex = chunk[j + 1].index;
        const origineleLengteMeters = lengteVanStuk(polyline, startIndex, endIndex);
        const tomtomLengte = leg.summary?.lengthInMeters ?? 0;
        // Sanity-check: als TomTom's leg-lengte te ver afwijkt van de originele
        // routelijn-lengte, heeft hij toch niet exact de reconstructie gevolgd (of de
        // GET-fallback een omweg gekozen) — zo'n stuk kleuren we niet in i.p.v. fout in te
        // kleuren.
        const betrouwbaar = origineleLengteMeters > 0
          ? (tomtomLengte <= 1.3 * origineleLengteMeters && tomtomLengte >= 0.7 * origineleLengteMeters)
          : true;
        segmenten.push({
          startIndex,
          endIndex,
          noTrafficSeconds: leg.summary?.noTrafficTravelTimeInSeconds ?? null,
          historicSeconds: leg.summary?.historicTrafficTravelTimeInSeconds ?? null,
          travelSeconds: leg.summary?.travelTimeInSeconds,
          lengteMeters: tomtomLengte,
          origineleLengteMeters: Math.round(origineleLengteMeters),
          betrouwbaar,
          vertrekOffsetSeconds: cumulatieveTravelSeconds + chunkTravelSeconds,
        });
        chunkTravelSeconds += leg.summary?.travelTimeInSeconds || 0;
      });

      cumulatieveTravelSeconds += chunkTravelSeconds;
      chunkDepartAt = new Date(Date.parse(departAt) + cumulatieveTravelSeconds * 1000).toISOString();
    }

    const onbetrouwbaar = segmenten.filter(s => !s.betrouwbaar).length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        segmenten,
        departAtUsed: departAt,
        aantalAanvragen: chunks.length,
        aantalWaypoints: tussenpunten.length,
        reconstructie: alleChunksReconstructie,
        onbetrouwbaar,
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
