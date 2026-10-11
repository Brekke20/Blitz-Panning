import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { zetFetch } from '../public/js/kern/api.js';
import { berekenAanrijtijd } from '../public/js/rapport-aanrijtijd.js';

afterEach(() => zetFetch(null));

// Nep-fetch: antwoorden in volgorde; onthoudt de aanroepen.
function nepFetch(...antwoorden) {
  const aanroepen = [];
  const fn = async (pad, init) => {
    aanroepen.push({ pad, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const a = antwoorden.shift();
    if (a instanceof Error) throw a;
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => { if (a.json === undefined) throw new Error('geen json'); return a.json; } };
  };
  fn.aanroepen = aanroepen;
  return fn;
}
const LOC = { origin: { lat: 51, lon: 4 }, dest: { lat: 51.1, lon: 4.1 } };
const GEO = { status: 200, json: { locations: [LOC.origin, LOC.dest] } };
const START = 'Heirbaan 9, 9150 Kruibeke';
const ADRES = 'Antwerpseweg 50, 2440 Geel';
const doe = () => berekenAanrijtijd({ adres: ADRES, startlocatie: START });

test('gelukt: minuten uit travelTimeSeconds afgerond (1799 s wordt 30)', async () => {
  zetFetch(nepFetch(GEO, { status: 200, json: { legs: [{ travelTimeSeconds: 1799 }] } }));
  assert.deepEqual(await doe(), { minuten: 30, reden: null });
});

test('0 seconden is geldig: minuten 0, reden null', async () => {
  zetFetch(nepFetch(GEO, { status: 200, json: { legs: [{ travelTimeSeconds: 0 }] } }));
  assert.deepEqual(await doe(), { minuten: 0, reden: null });
});

test('geen locations: reden geocode, minuten null', async () => {
  zetFetch(nepFetch({ status: 200, json: {} }));
  assert.deepEqual(await doe(), { minuten: null, reden: 'geocode' });
});

test('origin of dest ontbreekt: reden geocode', async () => {
  zetFetch(nepFetch({ status: 200, json: { locations: [LOC.origin] } }));
  assert.deepEqual(await doe(), { minuten: null, reden: 'geocode' });
  zetFetch(nepFetch({ status: 200, json: { locations: [null, LOC.dest] } }));
  assert.deepEqual(await doe(), { minuten: null, reden: 'geocode' });
});

test('route zonder legs of zonder getal: reden route', async () => {
  for (const json of [{}, { legs: [] }, { legs: [{}] }, { legs: [{ travelTimeSeconds: null }] }, { legs: [{ travelTimeSeconds: 'x' }] }, { legs: [{ travelTimeSeconds: -5 }] }, { legs: [{ travelTimeSeconds: NaN }] }]) {
    zetFetch(nepFetch(GEO, { status: 200, json }));
    assert.deepEqual(await doe(), { minuten: null, reden: 'route' }, JSON.stringify(json));
  }
});

test('HTTP 500/502 geeft nooit een throw: geocode-stap geeft geocode, route-stap geeft route', async () => {
  for (const status of [500, 502]) {
    zetFetch(nepFetch({ status }));
    assert.deepEqual(await doe(), { minuten: null, reden: 'geocode' });
    zetFetch(nepFetch(GEO, { status }));
    assert.deepEqual(await doe(), { minuten: null, reden: 'route' });
  }
});

test('netwerkfout en TimeoutError: reden netwerk, in beide stappen', async () => {
  const time = Object.assign(new Error('time-out'), { name: 'TimeoutError' });
  for (const fout of [new TypeError('Failed to fetch'), time]) {
    zetFetch(nepFetch(fout));
    assert.deepEqual(await doe(), { minuten: null, reden: 'netwerk' });
    zetFetch(nepFetch(GEO, fout));
    assert.deepEqual(await doe(), { minuten: null, reden: 'netwerk' });
  }
});

test('onleesbaar antwoord (geen JSON) gooit niet: geocode resp. route', async () => {
  zetFetch(nepFetch({ status: 200 }));
  assert.deepEqual(await doe(), { minuten: null, reden: 'geocode' });
  zetFetch(nepFetch(GEO, { status: 200 }));
  assert.deepEqual(await doe(), { minuten: null, reden: 'route' });
});

test('geen adres of geen startlocatie: geen enkele fetch, de juiste reden', async () => {
  const f = nepFetch();
  zetFetch(f);
  assert.deepEqual(await berekenAanrijtijd({ adres: '', startlocatie: START }), { minuten: null, reden: 'geen-adres' });
  assert.deepEqual(await berekenAanrijtijd({ adres: '  ', startlocatie: START }), { minuten: null, reden: 'geen-adres' });
  assert.deepEqual(await berekenAanrijtijd({ adres: ADRES, startlocatie: '' }), { minuten: null, reden: 'geen-startlocatie' });
  assert.deepEqual(await berekenAanrijtijd({ adres: ADRES }), { minuten: null, reden: 'geen-startlocatie' });
  assert.equal(f.aanroepen.length, 0);
});

test('eerste aanroep gaat met { origin, stops: [adres] }, tweede met { waypoints }', async () => {
  const f = nepFetch(GEO, { status: 200, json: { legs: [{ travelTimeSeconds: 600 }] } });
  zetFetch(f);
  await doe();
  assert.equal(f.aanroepen.length, 2);
  assert.equal(f.aanroepen[0].pad, '/api/optimize');
  assert.equal(f.aanroepen[0].init.method, 'POST');
  assert.deepEqual(f.aanroepen[0].body, { origin: START, stops: [ADRES] });
  assert.equal(f.aanroepen[1].pad, '/api/route');
  assert.deepEqual(f.aanroepen[1].body, { waypoints: [LOC.origin, LOC.dest] });
});
