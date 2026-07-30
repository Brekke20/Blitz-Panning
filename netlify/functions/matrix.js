// /api/matrix  (POST)
// Body: { origin: {lat, lon}, destinations: [{lat, lon}, ...], departAt: ISO-string }
// Geeft voor elke destination de historische reistijd + afstand terug, via TomTom's
// Matrix Routing v2 API -- 1 aanvraag voor N bestemmingen i.p.v. N losse /api/route-
// aanvragen (nodig omdat de max-reistijd-check anders per kandidaat-ticket een aparte,
// sequentiële aanvraag zou doen -- traag bij een lange wachtrij).

const TOMTOM_BASE = 'https://api.tomtom.com';
const API_KEY = () => process.env.TOMTOM_API_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchTomTomMatrix(body, attempt = 1) {
  const res = await fetch(`${TOMTOM_BASE}/routing/matrix/2?key=${API_KEY()}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (res.status === 429 && attempt <= 3) {
    await sleep(attempt * 400);
    return fetchTomTomMatrix(body, attempt + 1);
  }
  return res;
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { origin, destinations, departAt } = JSON.parse(event.body || '{}');
    if (!origin || !destinations?.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'origin en destinations zijn verplicht' }) };
    }

    const body = {
      origins:      [{ point: { latitude: origin.lat, longitude: origin.lon } }],
      destinations: destinations.map(d => ({ point: { latitude: d.lat, longitude: d.lon } })),
      options: {
        departAt:   departAt || 'any',
        traffic:    'historical',
        travelMode: 'car',
      },
    };

    const res  = await fetchTomTomMatrix(body);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.description || `TomTom Matrix-fout (${res.status})`);

    // Terugmappen naar de originele destination-volgorde via destinationIndex (niet
    // aannemen dat de teruggegeven array al in volgorde staat). Een individuele mislukte
    // cel (bv. onbereikbaar adres) geeft null -- de aanroeper behandelt dit fail-open.
    const results = destinations.map((_, i) => {
      const cell    = data.data?.find(c => c.destinationIndex === i);
      const summary = cell?.routeSummary;
      return summary
        ? { travelTimeSeconds: summary.travelTimeInSeconds, distanceMeters: summary.lengthInMeters }
        : null;
    });

    return { statusCode: 200, headers, body: JSON.stringify({ results }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
