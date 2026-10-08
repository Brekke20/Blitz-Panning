import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch } from './nep-fetch.mjs';
import { geocodeAdres, geocodePostcode } from '../netlify/lib/sales-geocode.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const SLEUTEL = 'NEP-SLEUTEL-123';
const geenWacht = async () => {};
const opts = (fetch, extra = {}) => ({ fetch, sleutel: SLEUTEL, testModus: false, wacht: geenWacht, ...extra });

test('geocodeAdres: URL met geëncodeerde tekst, countrySet=BE en sleutel; geeft lat/lon', async () => {
  const { fn, calls } = maakNepFetch(() => json({ results: [{ position: { lat: 51.1, lon: 5.7 } }] }));
  const r = await geocodeAdres('Dorpsstraat 12, 3640 Kinrooi', opts(fn));
  assert.deepEqual(r, { lat: 51.1, lon: 5.7 });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith('https://api.tomtom.com/search/2/geocode/' + encodeURIComponent('Dorpsstraat 12, 3640 Kinrooi') + '.json?'));
  assert.match(calls[0].url, /countrySet=BE/);
  assert.match(calls[0].url, /limit=1/);
  assert.ok(calls[0].url.includes('key=' + SLEUTEL));
});

test('geocodeAdres: geen resultaten -> null', async () => {
  const { fn } = maakNepFetch(() => json({ results: [] }));
  assert.equal(await geocodeAdres('Nergensstraat 1, 3640 Kinrooi', opts(fn)), null);
});

test('geocodeAdres: netwerkfout, ongeldig antwoord of HTTP-fout -> null, gooit nooit', async () => {
  assert.equal(await geocodeAdres('X 1, 3640 Y', opts(async () => { throw new Error('netwerk'); })), null);
  assert.equal(await geocodeAdres('X 1, 3640 Y', opts(async () => new Response('geen json', { status: 200 }))), null);
  assert.equal(await geocodeAdres('X 1, 3640 Y', opts(async () => json({}, 500))), null);
  assert.equal(await geocodeAdres('X 1, 3640 Y', opts(async () => json({ results: [{ position: { lat: 'a', lon: null } }] }))), null);
});

test('geocodeAdres: 429 daarna 200 -> resultaat na 2 pogingen, met backoff', async () => {
  let n = 0;
  const wachten = [];
  const { fn, calls } = maakNepFetch(() => (++n === 1 ? json({}, 429) : json({ results: [{ position: { lat: 50.9, lon: 5.3 } }] })));
  const r = await geocodeAdres('Dorpsstraat 12, 3640 Kinrooi', opts(fn, { wacht: async ms => { wachten.push(ms); } }));
  assert.deepEqual(r, { lat: 50.9, lon: 5.3 });
  assert.equal(calls.length, 2);
  assert.deepEqual(wachten, [400]);
});

test('geocodeAdres: blijvend 429 -> null na 3 pogingen', async () => {
  const wachten = [];
  const { fn, calls } = maakNepFetch(() => json({}, 429));
  assert.equal(await geocodeAdres('Dorpsstraat 12, 3640 Kinrooi', opts(fn, { wacht: async ms => { wachten.push(ms); } })), null);
  assert.equal(calls.length, 3);
  assert.deepEqual(wachten, [400, 800]);
});

test('geocodeAdres: testmodus is deterministisch, in België en roept fetch nooit aan', async () => {
  const { fn, calls } = maakNepFetch();
  const a = await geocodeAdres('Dorpsstraat 12, 3640 Kinrooi', opts(fn, { testModus: true, sleutel: undefined }));
  const b = await geocodeAdres('Dorpsstraat 12, 3640 Kinrooi', opts(fn, { testModus: true, sleutel: undefined }));
  const c = await geocodeAdres('Kerkstraat 3, 3500 Hasselt', opts(fn, { testModus: true, sleutel: undefined }));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const p of [a, c]) {
    assert.ok(p.lat >= 49.5 && p.lat <= 51.5, 'lat in België');
    assert.ok(p.lon >= 2.5 && p.lon <= 6.4, 'lon in België');
  }
  assert.equal(calls.length, 0);
});

test('geocodeAdres: ontbrekende sleutel buiten testmodus -> null zonder fetch; lege tekst ook', async () => {
  const { fn, calls } = maakNepFetch();
  assert.equal(await geocodeAdres('Dorpsstraat 12, 3640 Kinrooi', opts(fn, { sleutel: undefined })), null);
  assert.equal(await geocodeAdres('Dorpsstraat 12, 3640 Kinrooi', opts(fn, { sleutel: '' })), null);
  assert.equal(await geocodeAdres('  ', opts(fn)), null);
  assert.equal(await geocodeAdres(null, opts(fn)), null);
  assert.equal(calls.length, 0);
});

test('geocodePostcode: URL met postalCode en countryCode=BE, gemeente uit het antwoord', async () => {
  const { fn, calls } = maakNepFetch(() => json({ results: [{ position: { lat: 51.16, lon: 5.74 }, address: { municipality: 'Kinrooi' } }] }));
  const r = await geocodePostcode('3640', opts(fn));
  assert.deepEqual(r, { lat: 51.16, lon: 5.74, gemeente: 'Kinrooi' });
  assert.match(calls[0].url, /^https:\/\/api\.tomtom\.com\/search\/2\/structuredGeocode\.json\?/);
  assert.match(calls[0].url, /postalCode=3640/);
  assert.match(calls[0].url, /countryCode=BE/);
  assert.match(calls[0].url, /limit=1/);
  assert.ok(calls[0].url.includes('key=' + SLEUTEL));
});

test('geocodePostcode: geen resultaat, fout of geen gemeente-veld', async () => {
  assert.equal(await geocodePostcode('3640', opts(maakNepFetch(() => json({ results: [] })).fn)), null);
  assert.equal(await geocodePostcode('3640', opts(async () => { throw new Error('x'); })), null);
  const r = await geocodePostcode('3640', opts(maakNepFetch(() => json({ results: [{ position: { lat: 51, lon: 5 }, address: {} }] })).fn));
  assert.deepEqual(r, { lat: 51, lon: 5, gemeente: '' });
});

test('geocodePostcode: enkel Belgische postcodes (4 cijfers), anders null zonder fetch', async () => {
  const { fn, calls } = maakNepFetch();
  for (const pc of ['36', 'abcd', '36400', '3640 ', 3640, null, undefined, '1000A']) {
    assert.equal(await geocodePostcode(pc, opts(fn)), null, String(pc));
  }
  assert.equal(calls.length, 0);
});

test('geocodePostcode: testmodus deterministisch zonder fetch', async () => {
  const { fn, calls } = maakNepFetch();
  const a = await geocodePostcode('3640', opts(fn, { testModus: true, sleutel: undefined }));
  const b = await geocodePostcode('3640', opts(fn, { testModus: true, sleutel: undefined }));
  const c = await geocodePostcode('3500', opts(fn, { testModus: true, sleutel: undefined }));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(typeof a.gemeente, 'string');
  assert.ok(a.gemeente.length > 0);
  assert.ok(a.lat >= 49.5 && a.lat <= 51.5 && a.lon >= 2.5 && a.lon <= 6.4);
  assert.equal(calls.length, 0);
});

test('de sleutel komt nooit in de logs', async () => {
  const oud = { log: console.log, error: console.error, warn: console.warn };
  const regels = [];
  for (const k of Object.keys(oud)) console[k] = (...a) => regels.push(a.join(' '));
  try {
    await geocodeAdres('X 1, 3640 Y', opts(async () => { throw new Error('netwerk ' + SLEUTEL); }));
    await geocodePostcode('3640', opts(async () => json({}, 500)));
    await geocodeAdres('X 1, 3640 Y', opts(async () => json({}, 429)));
  } finally { Object.assign(console, oud); }
  assert.ok(!regels.join('\n').includes(SLEUTEL));
});
