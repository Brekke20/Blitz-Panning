// Karakterisering van de TomTom-functies (etappe 6, taak 2): route, matrix, optimize, drukte.
// Elke test controleert de VOLLEDIGE lijst uitgaande aanroepen (een onbekende URL geeft stil 404 {}).
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, v1Event, zetEnv } from './nep-fetch.mjs';

const NU = Date.parse('2026-10-01T10:00:00.000Z');
const TOEKOMST = '2026-10-02T08:00:00.000Z';
const BASIS = 'https://api.tomtom.com';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const JSON_H = { 'Content-Type': 'application/json' };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const uit = calls => calls.map(c => ({ method: c.method, url: c.url, headers: c.headers, body: c.body }));
const ontleed = res => ({ status: res.statusCode, headers: { ...res.headers }, body: JSON.parse(res.body) });
const kaal204 = res => ({ statusCode: res.statusCode, headers: { ...res.headers }, body: res.body });

let herstelEnv;
test.beforeEach(() => {
  herstelEnv = zetEnv({ TOMTOM_API_KEY: 'KEY' });
  mock.timers.enable({ apis: ['Date'], now: NU });
});
test.afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  herstelEnv();
});

async function draai(naam, event, router) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers(naam);
  const res = await metGlobaleFetch(fn, () => mod.handler(event));
  return { res, calls: uit(calls) };
}

// ======================= route =======================
const ROUTE_BASIS = (coords, extra = '') =>
  `${BASIS}/routing/1/calculateRoute/${coords}/json?key=KEY&travelMode=car&traffic=true&routeType=fastest` +
  `&computeTravelTimeFor=all&sectionType=traffic&report=effectiveSettings${extra}`;

const TT_ROUTE = {
  routes: [{
    summary: {
      lengthInMeters: 5000, travelTimeInSeconds: 600, trafficDelayInSeconds: 60,
      noTrafficTravelTimeInSeconds: 540, historicTrafficTravelTimeInSeconds: 580,
      departureTime: '2026-10-02T10:00:00+02:00', arrivalTime: '2026-10-02T10:10:00+02:00',
    },
    legs: [
      {
        summary: { lengthInMeters: 3000, travelTimeInSeconds: 400, trafficDelayInSeconds: 40, noTrafficTravelTimeInSeconds: 360, historicTrafficTravelTimeInSeconds: 380 },
        points: [{ latitude: 51, longitude: 4 }, { latitude: 51.1, longitude: 4.1 }],
      },
      {
        summary: { lengthInMeters: 2000, travelTimeInSeconds: 200, trafficDelayInSeconds: 20, noTrafficTravelTimeInSeconds: 180 },
        points: [{ latitude: 51.2, longitude: 4.2 }],
      },
    ],
    sections: [
      { sectionType: 'TRAFFIC', startPointIndex: 0, endPointIndex: 1, magnitudeOfDelay: 2, delayInSeconds: 40, simpleCategory: 'JAM', effectiveSpeedInKmh: 30 },
      { sectionType: 'TRAFFIC', startPointIndex: 1, endPointIndex: 2 },
      { sectionType: 'CAR_TRAIN', startPointIndex: 0, endPointIndex: 2 },
    ],
  }],
};
const WP = [{ lat: 51, lon: 4 }, { lat: 51.2, lon: 4.2 }];
const ROUTE_CALL = { method: 'GET', url: ROUTE_BASIS('51,4:51.2,4.2'), headers: {}, body: undefined };

test('route: OPTIONS geeft 204 met CORS en geen aanroepen', async () => {
  const { res, calls } = await draai('route', v1Event('OPTIONS'));
  assert.deepEqual(kaal204(res), { statusCode: 204, headers: CORS, body: undefined });
  assert.deepEqual(calls, []);
});

test('route: GET zonder body geeft 400 (geen 405) en geen aanroepen', async () => {
  const { res, calls } = await draai('route', v1Event('GET'));
  assert.deepEqual(ontleed(res), { status: 400, headers: CORS, body: { error: 'Need at least 2 waypoints' } });
  assert.deepEqual(calls, []);
});

test('route: minder dan 2 waypoints geeft 400', async () => {
  const { res, calls } = await draai('route', v1Event('POST', { waypoints: [WP[0]] }));
  assert.deepEqual(ontleed(res), { status: 400, headers: CORS, body: { error: 'Need at least 2 waypoints' } });
  assert.deepEqual(calls, []);
});

test('route: succes zonder departAt, volledige antwoordvorm', async () => {
  const { res, calls } = await draai('route', v1Event('POST', { waypoints: WP }), () => json(TT_ROUTE));
  assert.deepEqual(calls, [ROUTE_CALL]);
  assert.deepEqual(ontleed(res), {
    status: 200, headers: CORS,
    body: {
      totalTravelTimeSeconds: 600, totalDistanceMeters: 5000, totalTrafficDelaySeconds: 60,
      totalNoTrafficTravelTimeSeconds: 540, totalHistoricTrafficTravelTimeSeconds: 580,
      arrivalTime: '2026-10-02T10:10:00+02:00', departureTime: '2026-10-02T10:00:00+02:00',
      legs: [
        { travelTimeSeconds: 400, noTrafficTravelTimeSeconds: 360, travelTimeWithTrafficSeconds: 440, distanceMeters: 3000, trafficDelaySeconds: 40, historicTrafficTravelTimeSeconds: 380, pointCount: 2 },
        { travelTimeSeconds: 200, noTrafficTravelTimeSeconds: 180, travelTimeWithTrafficSeconds: 220, distanceMeters: 2000, trafficDelaySeconds: 20, historicTrafficTravelTimeSeconds: null, pointCount: 1 },
      ],
      sections: [
        { startPointIndex: 0, endPointIndex: 1, magnitudeOfDelay: 2, delayInSeconds: 40, simpleCategory: 'JAM', effectiveSpeedInKmh: 30 },
        { startPointIndex: 1, endPointIndex: 2, magnitudeOfDelay: 0, delayInSeconds: 0, simpleCategory: '', effectiveSpeedInKmh: null },
      ],
      departAtUsed: null,
      polyline: [[51, 4], [51.1, 4.1], [51.2, 4.2]],
    },
  });
});

test('route: ontbrekende optionele velden geven null, lege sections en lege polyline', async () => {
  const kaal = { routes: [{ summary: { lengthInMeters: 1, travelTimeInSeconds: 2, trafficDelayInSeconds: 0, departureTime: 'd', arrivalTime: 'a' } }] };
  const { res, calls } = await draai('route', v1Event('POST', { waypoints: WP }), () => json(kaal));
  assert.deepEqual(calls, [ROUTE_CALL]);
  assert.deepEqual(ontleed(res).body, {
    totalTravelTimeSeconds: 2, totalDistanceMeters: 1, totalTrafficDelaySeconds: 0,
    totalNoTrafficTravelTimeSeconds: null, totalHistoricTrafficTravelTimeSeconds: null,
    arrivalTime: 'a', departureTime: 'd', legs: [], sections: [], departAtUsed: null, polyline: [],
  });
});

test('route: geldige toekomstige departAt komt in de URL en in departAtUsed', async () => {
  const { res, calls } = await draai('route', v1Event('POST', { waypoints: WP, departAt: TOEKOMST }), () => json(TT_ROUTE));
  assert.deepEqual(calls, [{
    method: 'GET', headers: {}, body: undefined,
    url: ROUTE_BASIS('51,4:51.2,4.2', `&departAt=${encodeURIComponent(TOEKOMST)}`),
  }]);
  assert.equal(ontleed(res).body.departAtUsed, TOEKOMST);
});

test('route: verleden, bijna-nu en ongeldige departAt worden genegeerd', async () => {
  for (const departAt of ['2026-09-30T08:00:00.000Z', '2026-10-01T10:00:30.000Z', 'morgen', '2026-10-02T08:00:00+02:00', 5]) {
    const { res, calls } = await draai('route', v1Event('POST', { waypoints: WP, departAt }), () => json(TT_ROUTE));
    assert.deepEqual(calls, [ROUTE_CALL], String(departAt));
    assert.equal(ontleed(res).body.departAtUsed, null, String(departAt));
  }
});

test('route: 429 en dan 200 doet twee identieke aanvragen (echte backoff 400 ms)', async () => {
  let n = 0;
  const { res, calls } = await draai('route', v1Event('POST', { waypoints: WP }), () => (++n === 1 ? json({}, 429) : json(TT_ROUTE)));
  assert.deepEqual(calls, [ROUTE_CALL, ROUTE_CALL]);
  assert.equal(ontleed(res).status, 200);
});

test('route: geen route geeft 500 No route returned from TomTom', async () => {
  const { res, calls } = await draai('route', v1Event('POST', { waypoints: WP }), () => json({ routes: [] }));
  assert.deepEqual(calls, [ROUTE_CALL]);
  assert.deepEqual(ontleed(res), { status: 500, headers: CORS, body: { error: 'No route returned from TomTom' } });
});

// ======================= matrix =======================
const MATRIX_URL = `${BASIS}/routing/matrix/2?key=KEY`;

test('matrix: OPTIONS geeft 204 met CORS', async () => {
  const { res, calls } = await draai('matrix', v1Event('OPTIONS'));
  assert.deepEqual(kaal204(res), { statusCode: 204, headers: CORS, body: undefined });
  assert.deepEqual(calls, []);
});

test('matrix: GET geeft 405 als JSON', async () => {
  const { res, calls } = await draai('matrix', v1Event('GET'));
  assert.deepEqual(ontleed(res), { status: 405, headers: CORS, body: { error: 'Method not allowed' } });
  assert.deepEqual(calls, []);
});

test('matrix: ontbrekende origin of destinations geeft 400', async () => {
  for (const body of [{}, { origin: { lat: 1, lon: 2 } }, { origin: { lat: 1, lon: 2 }, destinations: [] }, { destinations: [{ lat: 1, lon: 2 }] }]) {
    const { res, calls } = await draai('matrix', v1Event('POST', body));
    assert.deepEqual(ontleed(res), { status: 400, headers: CORS, body: { error: 'origin en destinations zijn verplicht' } });
    assert.deepEqual(calls, []);
  }
});

test('matrix: succes, exacte aanvraag, terugmappen op destinationIndex met ontbrekende cel', async () => {
  const antwoord = { data: [
    { destinationIndex: 2, routeSummary: { travelTimeInSeconds: 300, lengthInMeters: 3000 } },
    { destinationIndex: 0, routeSummary: { travelTimeInSeconds: 100, lengthInMeters: 1000 } },
    { destinationIndex: 1 },
  ] };
  const dest = [{ lat: 51, lon: 4 }, { lat: 52, lon: 5 }, { lat: 53, lon: 6 }, { lat: 54, lon: 7 }];
  const { res, calls } = await draai('matrix', v1Event('POST', { origin: { lat: 50, lon: 3 }, destinations: dest, departAt: TOEKOMST }), () => json(antwoord));
  assert.deepEqual(calls, [{
    method: 'POST', url: MATRIX_URL, headers: JSON_H,
    body: JSON.stringify({
      origins: [{ point: { latitude: 50, longitude: 3 } }],
      destinations: dest.map(d => ({ point: { latitude: d.lat, longitude: d.lon } })),
      options: { departAt: TOEKOMST, traffic: 'historical', travelMode: 'car' },
    }),
  }]);
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS, body: { results: [
    { travelTimeSeconds: 100, distanceMeters: 1000 }, null, { travelTimeSeconds: 300, distanceMeters: 3000 }, null,
  ] } });
});

test('matrix: zonder departAt wordt het "any"; zonder data geeft alles null', async () => {
  const { res, calls } = await draai('matrix', v1Event('POST', { origin: { lat: 50, lon: 3 }, destinations: [{ lat: 51, lon: 4 }] }), () => json({}));
  assert.deepEqual(calls, [{
    method: 'POST', url: MATRIX_URL, headers: JSON_H,
    body: '{"origins":[{"point":{"latitude":50,"longitude":3}}],"destinations":[{"point":{"latitude":51,"longitude":4}}],"options":{"departAt":"any","traffic":"historical","travelMode":"car"}}',
  }]);
  assert.deepEqual(ontleed(res).body, { results: [null] });
});

test('matrix: !res.ok geeft 500 met error.description of de statusvariant', async () => {
  const event = v1Event('POST', { origin: { lat: 50, lon: 3 }, destinations: [{ lat: 51, lon: 4 }] });
  const verwacht = [{
    method: 'POST', url: MATRIX_URL, headers: JSON_H,
    body: '{"origins":[{"point":{"latitude":50,"longitude":3}}],"destinations":[{"point":{"latitude":51,"longitude":4}}],"options":{"departAt":"any","traffic":"historical","travelMode":"car"}}',
  }];
  let r = await draai('matrix', event, () => json({ error: { description: 'Quota op' } }, 403));
  assert.deepEqual(r.calls, verwacht);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS, body: { error: 'Quota op' } });
  r = await draai('matrix', event, () => json({}, 503));
  assert.deepEqual(r.calls, verwacht);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS, body: { error: 'TomTom Matrix-fout (503)' } });
});

// ======================= optimize =======================
const geocodeUrl = adres => `${BASIS}/search/2/geocode/${encodeURIComponent(adres)}.json?key=KEY&countrySet=BE,NL,LU,FR,DE`;
const geoCall = adres => ({ method: 'GET', url: geocodeUrl(adres), headers: {}, body: undefined });
const OPT_URL = `${BASIS}/routing/waypointoptimization/1?key=KEY`;
const POS = { 'Start 1, Gent': { lat: 51.05, lon: 3.72 }, 'A 1, Brugge': { lat: 51.2, lon: 3.22 }, 'B 2, Hasselt': { lat: 50.93, lon: 5.34 } };
const pt = p => ({ point: { latitude: p.lat, longitude: p.lon } });
const OPT_BODY = JSON.stringify({
  waypoints: [pt(POS['Start 1, Gent']), pt(POS['A 1, Brugge']), pt(POS['B 2, Hasselt']), pt(POS['Start 1, Gent'])],
  options: { travelMode: 'car', departAt: '2026-10-01T10:00:00.000Z' },
});
const OPT_CALLS = [
  geoCall('Start 1, Gent'), geoCall('A 1, Brugge'), geoCall('B 2, Hasselt'),
  { method: 'POST', url: OPT_URL, headers: JSON_H, body: OPT_BODY },
];
const OPT_EVENT = v1Event('POST', { origin: 'Start 1, Gent', stops: ['A 1, Brugge', 'B 2, Hasselt'] });
const OPT_LOCS = [loc3('Start 1, Gent'), loc3('A 1, Brugge'), loc3('B 2, Hasselt')];
function loc3(adres) { return { lat: POS[adres].lat, lon: POS[adres].lon, address: adres }; }

// Router: geocode volgens POS (andere adressen: geen resultaat), optimalisatie volgens `opt`.
const optRouter = (opt = () => json({ optimizedOrder: [0, 1, 2, 3] })) => (url, opts) => {
  if (url.startsWith(`${BASIS}/search/2/geocode/`)) {
    const adres = Object.keys(POS).find(a => url === geocodeUrl(a));
    return adres ? json({ results: [{ position: POS[adres] }] }) : json({ results: [] });
  }
  if (url === OPT_URL) return opt(url, opts);
  return undefined;
};

test('optimize: OPTIONS geeft 204 met CORS', async () => {
  const { res, calls } = await draai('optimize', v1Event('OPTIONS'));
  assert.deepEqual(kaal204(res), { statusCode: 204, headers: CORS, body: undefined });
  assert.deepEqual(calls, []);
});

test('optimize: ontbrekende origin of stops geeft 400', async () => {
  for (const body of [{}, { origin: 'X' }, { origin: 'X', stops: [] }, { stops: ['A'] }]) {
    const { res, calls } = await draai('optimize', v1Event('POST', body));
    assert.deepEqual(ontleed(res), { status: 400, headers: CORS, body: { error: 'Missing origin or stops' } });
    assert.deepEqual(calls, []);
  }
});

test('optimize: onvindbaar vertrekpunt geeft het 400-pad (stops worden wel geocodeerd)', async () => {
  const { res, calls } = await draai('optimize', v1Event('POST', { origin: 'Nergens 9', stops: ['A 1, Brugge'] }), optRouter());
  assert.deepEqual(calls, [geoCall('Nergens 9'), geoCall('A 1, Brugge')]);
  assert.deepEqual(ontleed(res), { status: 400, headers: CORS, body: { error: "Vertrekpunt 'Nergens 9' kon niet opgezocht worden (Geocoding failed for: Nergens 9 (HTTP 200))" } });
});

test('optimize: geocodefout met detailedError gebruikt die tekst', async () => {
  const router = url => url === geocodeUrl('Slecht') ? json({ detailedError: { message: 'Bad key' } }, 403) : undefined;
  const { res, calls } = await draai('optimize', v1Event('POST', { origin: 'Slecht', stops: ['x'] }), router);
  assert.deepEqual(calls, [geoCall('Slecht'), geoCall('x')]);
  assert.deepEqual(ontleed(res).body, { error: "Vertrekpunt 'Slecht' kon niet opgezocht worden (Geocoding failed for: Slecht (Bad key))" });
});

test('optimize: een onvindbare stop blijft tolerant, geen optimalisatie', async () => {
  const { res, calls } = await draai('optimize', v1Event('POST', { origin: 'Start 1, Gent', stops: ['A 1, Brugge', 'Admin'] }), optRouter());
  assert.deepEqual(calls, [geoCall('Start 1, Gent'), geoCall('A 1, Brugge'), geoCall('Admin')]);
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS, body: {
    locations: [loc3('Start 1, Gent'), loc3('A 1, Brugge'), null], optimizeError: 'Niet alle adressen gevonden',
  } });
});

test('optimize: geen enkele stop gevonden geeft dezelfde tolerante melding', async () => {
  const { res, calls } = await draai('optimize', v1Event('POST', { origin: 'Start 1, Gent', stops: ['Admin'] }), optRouter());
  assert.deepEqual(calls, [geoCall('Start 1, Gent'), geoCall('Admin')]);
  assert.deepEqual(ontleed(res).body, { locations: [loc3('Start 1, Gent'), null], optimizeError: 'Niet alle adressen gevonden' });
});

test('optimize: een stop geeft optimizedOrder [0] zonder optimalisatie-aanvraag', async () => {
  const { res, calls } = await draai('optimize', v1Event('POST', { origin: 'Start 1, Gent', stops: ['A 1, Brugge'] }), optRouter());
  assert.deepEqual(calls, [geoCall('Start 1, Gent'), geoCall('A 1, Brugge')]);
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS, body: { optimizedOrder: [0], locations: [loc3('Start 1, Gent'), loc3('A 1, Brugge')] } });
});

test('optimize: succes, exacte optimalisatie-aanvraag en teruggemapte volgorde', async () => {
  const optData = { optimizedOrder: [0, 2, 1, 3], summary: { x: 1 } };
  const { res, calls } = await draai('optimize', OPT_EVENT, optRouter(() => json(optData)));
  assert.deepEqual(calls, OPT_CALLS);
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS, body: {
    optimizedOrder: [1, 0], locations: OPT_LOCS, rawResponse: optData,
  } });
});

test('optimize: niet-ok optimalisatie geeft geocodeOnly met details; ongeldige body geeft lege details', async () => {
  let r = await draai('optimize', OPT_EVENT, optRouter(() => json({ error: 'kapot' }, 500)));
  assert.deepEqual(r.calls, OPT_CALLS);
  assert.deepEqual(ontleed(r.res), { status: 200, headers: CORS, body: { locations: OPT_LOCS, optimizeError: 'TomTom route-optimalisatie mislukt (500)', details: { error: 'kapot' } } });
  r = await draai('optimize', OPT_EVENT, optRouter(() => new Response('geen json', { status: 502 })));
  assert.deepEqual(r.calls, OPT_CALLS);
  assert.deepEqual(ontleed(r.res).body, { locations: OPT_LOCS, optimizeError: 'TomTom route-optimalisatie mislukt (502)', details: {} });
});

test('optimize: geen array of onbruikbare permutatie geeft geocodeOnly', async () => {
  let r = await draai('optimize', OPT_EVENT, optRouter(() => json({ foo: 1 })));
  assert.deepEqual(r.calls, OPT_CALLS);
  assert.deepEqual(ontleed(r.res).body, { locations: OPT_LOCS, optimizeError: 'TomTom gaf geen geldige optimizedOrder terug', details: { foo: 1 } });
  r = await draai('optimize', OPT_EVENT, optRouter(() => json(null)));
  assert.deepEqual(r.calls, OPT_CALLS);
  assert.deepEqual(ontleed(r.res).body, { locations: OPT_LOCS, optimizeError: 'TomTom gaf geen geldige optimizedOrder terug' });
  const kort = { optimizedOrder: [0, 1, 3] };
  r = await draai('optimize', OPT_EVENT, optRouter(() => json(kort)));
  assert.deepEqual(r.calls, OPT_CALLS);
  assert.deepEqual(ontleed(r.res).body, { locations: OPT_LOCS, optimizeError: 'TomTom gaf een onbruikbare optimizedOrder terug (1 van 2 stops)', details: kort });
  const dubbel = { optimizedOrder: [0, 1, 1, 3] };
  r = await draai('optimize', OPT_EVENT, optRouter(() => json(dubbel)));
  assert.deepEqual(r.calls, OPT_CALLS);
  assert.deepEqual(ontleed(r.res).body, { locations: OPT_LOCS, optimizeError: 'TomTom gaf een onbruikbare optimizedOrder terug (2 van 2 stops)', details: dubbel });
});

// ======================= drukte =======================
const PL2 = [[51, 4], [51.01, 4]];                       // ~1,1 km: precies 2 tussenpunten
const PL3 = [[51, 4], [51.01, 4], [51.02, 4]];           // met segmentMeters 500: 3 tussenpunten, geen POST
const DRUKTE_URL = coords =>
  `${BASIS}/routing/1/calculateRoute/${coords}/json?key=KEY&travelMode=car&traffic=true&routeType=fastest` +
  `&computeTravelTimeFor=all&departAt=${encodeURIComponent(TOEKOMST)}`;
const leg = (lengte, tijd, geen, hist) => ({ summary: { lengthInMeters: lengte, travelTimeInSeconds: tijd, noTrafficTravelTimeInSeconds: geen, historicTrafficTravelTimeInSeconds: hist } });
const POST2 = { method: 'POST', url: DRUKTE_URL('51,4:51.01,4'), headers: JSON_H, body: JSON.stringify({ supportingPoints: [{ latitude: 51, longitude: 4 }, { latitude: 51.01, longitude: 4 }] }) };
const GET2 = { method: 'GET', url: DRUKTE_URL('51,4:51.01,4'), headers: {}, body: undefined };

test('drukte: OPTIONS geeft 204 met CORS', async () => {
  const { res, calls } = await draai('drukte', v1Event('OPTIONS'));
  assert.deepEqual(kaal204(res), { statusCode: 204, headers: CORS, body: undefined });
  assert.deepEqual(calls, []);
});

test('drukte: ongeldige polyline geeft 400', async () => {
  const fout = 'polyline moet een array van [lat, lon]-punten zijn (2-5000 stuks)';
  const gevallen = [{}, { polyline: [[51, 4]] }, { polyline: 'x' }, { polyline: [[51, 4], [51, '4']] }, { polyline: [[51, 4], [91, 4]] }, { polyline: [[51, 4], [51, 181]] }, { polyline: [[51, 4], [51, 4, 1]] }];
  for (const body of gevallen) {
    const { res, calls } = await draai('drukte', v1Event('POST', { ...body, departAt: TOEKOMST }));
    assert.deepEqual(ontleed(res), { status: 400, headers: CORS, body: { error: fout } }, JSON.stringify(body));
    assert.deepEqual(calls, []);
  }
});

test('drukte: departAt in het verleden, ongeldig of afwezig geeft 400', async () => {
  for (const departAt of [undefined, 'morgen', '2026-09-30T08:00:00.000Z', '2026-10-01T10:00:30.000Z']) {
    const { res, calls } = await draai('drukte', v1Event('POST', { polyline: PL2, departAt }));
    assert.deepEqual(ontleed(res), { status: 400, headers: CORS, body: { error: 'departAt moet in de toekomst liggen' } }, String(departAt));
    assert.deepEqual(calls, []);
  }
});

test('drukte: 2-punts-polyline, POST wordt geweigerd (400) en valt terug op GET', async () => {
  const warn = mock.method(console, 'warn', () => {});
  const router = (url, opts) => opts.method === 'POST' ? json({ detailedError: { message: 'nee' } }, 400) : json({ routes: [{ legs: [leg(1112, 100, 90, 95)] }] });
  const { res, calls } = await draai('drukte', v1Event('POST', { polyline: PL2, departAt: TOEKOMST }), router);
  assert.deepEqual(calls, [POST2, GET2]);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[0], 'drukte: reconstructie geweigerd');
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS, body: {
    segmenten: [{ startIndex: 0, endIndex: 1, noTrafficSeconds: 90, historicSeconds: 95, travelSeconds: 100, lengteMeters: 1112, origineleLengteMeters: 1112, betrouwbaar: true, vertrekOffsetSeconds: 0 }],
    departAtUsed: TOEKOMST, aantalAanvragen: 2, aantalWaypoints: 2, reconstructie: false, onbetrouwbaar: 0,
  } });
});

test('drukte: 2-punts-polyline, POST gelukt geeft reconstructie true en 1 aanvraag', async () => {
  const router = () => json({ routes: [{ legs: [leg(1112, 100, 90, 95)] }] });
  const { res, calls } = await draai('drukte', v1Event('POST', { polyline: PL2, departAt: TOEKOMST }), router);
  assert.deepEqual(calls, [POST2]);
  const b = ontleed(res).body;
  assert.equal(b.aantalAanvragen, 1);
  assert.equal(b.reconstructie, true);
  assert.equal(b.segmenten.length, 1);
});

test('drukte: POST-aanvraag die gooit valt terug op GET', async () => {
  const warn = mock.method(console, 'warn', () => {});
  const router = (url, opts) => { if (opts.method === 'POST') throw new Error('netwerk'); return json({ routes: [{ legs: [leg(1112, 100, 90, 95)] }] }); };
  const { res, calls } = await draai('drukte', v1Event('POST', { polyline: PL2, departAt: TOEKOMST }), router);
  assert.deepEqual(calls, [POST2, GET2]);
  assert.deepEqual(warn.mock.calls.map(c => c.arguments), [['drukte: reconstructie-aanvraag mislukt', 'netwerk']]);
  const b = ontleed(res).body;
  assert.equal(b.aantalAanvragen, 2);
  assert.equal(b.reconstructie, false);
});

test('drukte: 3 tussenpunten geven enkel GET, onbetrouwbaar stuk wordt geschat en op null gezet', async () => {
  const router = () => json({ routes: [{ legs: [leg(1112, 100, 90, 95), leg(3336, 600, 500, 550)] }] });
  const { res, calls } = await draai('drukte', v1Event('POST', { polyline: PL3, departAt: TOEKOMST, segmentMeters: 500 }), router);
  assert.deepEqual(calls, [{ method: 'GET', url: DRUKTE_URL('51,4:51.01,4:51.02,4'), headers: {}, body: undefined }]);
  const b = ontleed(res).body;
  assert.equal(b.aantalWaypoints, 3);
  assert.equal(b.aantalAanvragen, 1);
  assert.equal(b.reconstructie, false);
  assert.equal(b.onbetrouwbaar, 1);
  assert.deepEqual(b.segmenten[0], { startIndex: 0, endIndex: 1, noTrafficSeconds: 90, historicSeconds: 95, travelSeconds: 100, lengteMeters: 1112, origineleLengteMeters: 1112, betrouwbaar: true, vertrekOffsetSeconds: 0 });
  const tweede = b.segmenten[1];
  assert.equal(tweede.betrouwbaar, false);
  assert.equal(tweede.noTrafficSeconds, null);
  assert.equal(tweede.historicSeconds, null);
  assert.equal(tweede.lengteMeters, 3336);
  assert.equal(tweede.vertrekOffsetSeconds, 100);
  assert.equal(tweede.travelSeconds, Math.round(600 * tweede.origineleLengteMeters / 3336));
});

test('drukte: geen route van TomTom geeft 500 met error.description of de standaardtekst', async () => {
  const event = v1Event('POST', { polyline: PL3, departAt: TOEKOMST, segmentMeters: 500 });
  const verwacht = [{ method: 'GET', url: DRUKTE_URL('51,4:51.01,4:51.02,4'), headers: {}, body: undefined }];
  let r = await draai('drukte', event, () => json({ error: { description: 'Zwaar kapot' } }));
  assert.deepEqual(r.calls, verwacht);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS, body: { error: 'Zwaar kapot' } });
  r = await draai('drukte', event, () => json({ routes: [] }));
  assert.deepEqual(r.calls, verwacht);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS, body: { error: 'Geen route van TomTom voor drukte-detail' } });
});
