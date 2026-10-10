// /api/route: TomTom met NO_ROUTE_FOUND voor een departAt -> één keer opnieuw zonder departAt (verkeerNietBeschikbaar).
// Alle TomTom-aanroepen zijn een nep-fetch; nooit echt netwerk.
process.env.TZ = 'Europe/Brussels';
import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, v1Event, zetEnv } from './nep-fetch.mjs';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const DEPART = '2099-01-05T06:00:00Z';
const WPS = [{ lat: 51.1, lon: 4.2 }, { lat: 51.2, lon: 4.3 }];
const ROUTE_OK = {
  routes: [{
    summary: { travelTimeInSeconds: 600, lengthInMeters: 9000, trafficDelayInSeconds: 0, noTrafficTravelTimeInSeconds: 600, arrivalTime: 'x', departureTime: 'y' },
    legs: [{ summary: { travelTimeInSeconds: 600, noTrafficTravelTimeInSeconds: 600, trafficDelayInSeconds: 0, lengthInMeters: 9000 }, points: [{ latitude: 51.1, longitude: 4.2 }, { latitude: 51.2, longitude: 4.3 }] }],
    sections: [],
  }],
};
const GEEN_ROUTE = { error: { description: 'NO_ROUTE_FOUND: no route between waypoint 1 and waypoint 2' }, detailedError: { code: 'NO_ROUTE_FOUND', message: 'No route' } };

let herstel;
test.beforeEach(() => { herstel = zetEnv({ TOMTOM_API_KEY: 'SLEUTEL' }); });
test.afterEach(() => herstel());

async function roep(router, body) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers('route');
  const res = await metGlobaleFetch(fn, () => mod.handler(v1Event('POST', body)));
  return { res, calls, body: JSON.parse(res.body) };
}

test('NO_ROUTE_FOUND met departAt -> tweede aanvraag zonder departAt, antwoord gemarkeerd', async () => {
  const r = await roep((url) => (url.includes('departAt=') ? json(GEEN_ROUTE, 400) : json(ROUTE_OK)), { waypoints: WPS, departAt: DEPART });
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.calls.length, 2);
  assert.ok(r.calls[0].url.includes('departAt='));
  assert.ok(!r.calls[1].url.includes('departAt='));
  assert.equal(r.calls[1].url, r.calls[0].url.replace(/&departAt=[^&]*/, ''));
  assert.equal(r.body.verkeerNietBeschikbaar, true);
  assert.equal(r.body.departAtUsed, null);
  assert.equal(r.body.totalTravelTimeSeconds, 600);
});

test('departAt lukt: één aanvraag, geen markering', async () => {
  const r = await roep(() => json(ROUTE_OK), { waypoints: WPS, departAt: DEPART });
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.calls.length, 1);
  assert.equal(r.body.verkeerNietBeschikbaar, undefined);
  assert.equal(r.body.departAtUsed, DEPART);
});

test('NO_ROUTE_FOUND zonder departAt: geen tweede poging, 500 zoals voorheen', async () => {
  const r = await roep(() => json(GEEN_ROUTE, 400), { waypoints: WPS });
  assert.equal(r.res.statusCode, 500);
  assert.equal(r.calls.length, 1);
  assert.equal(r.body.error, 'No route returned from TomTom');
});

test('NO_ROUTE_FOUND ook zonder departAt: 500 na precies één nieuwe poging', async () => {
  const r = await roep(() => json(GEEN_ROUTE, 400), { waypoints: WPS, departAt: DEPART });
  assert.equal(r.res.statusCode, 500);
  assert.equal(r.calls.length, 2);
  assert.equal(r.body.error, 'No route returned from TomTom');
});

test('andere TomTom-fout met departAt (bv. 403 of 500): geen nieuwe poging, fout blijft', async () => {
  for (const status of [403, 500]) {
    const r = await roep(() => json({ error: { description: 'Forbidden' } }, status), { waypoints: WPS, departAt: DEPART });
    assert.equal(r.res.statusCode, 500);
    assert.equal(r.calls.length, 1);
    assert.equal(r.body.error, 'No route returned from TomTom');
  }
});
