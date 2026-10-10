import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch } from './nep-fetch.mjs';
import { maakNepStore } from './nep-blobs.mjs';
import { isPostcode, zoekPostcode, zoekPostcodes } from '../netlify/lib/sales-postcode.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const postcodeVan = url => /postalCode=(\d+)/.exec(url)?.[1];
const antwoord = pc => json({ results: [{ position: { lat: 50 + Number(pc) / 10000, lon: 5 }, address: { postalCode: pc, municipality: 'Gemeente ' + pc } }] });
const deps = fetch => ({ fetch, sleutel: 'NEP', testModus: false, wacht: async () => {} });
const cacheVan = store => JSON.parse(store._data.get('postcode-cache') ?? '{}');

test('isPostcode: enkel 4 cijfers', () => {
  assert.equal(isPostcode('3640'), true);
  for (const x of ['36', 'abcd', '36400', '', ' 3640', 3640, null, undefined]) assert.equal(isPostcode(x), false, String(x));
});

test('zoekPostcode: cache-hit -> 0 fetches', async () => {
  const store = maakNepStore({ 'postcode-cache': { 3640: { lat: 51.1, lon: 5.7, gemeente: 'Kinrooi' } } });
  const { fn, calls } = maakNepFetch();
  assert.deepEqual(await zoekPostcode(store, '3640', deps(fn)), { lat: 51.1, lon: 5.7, gemeente: 'Kinrooi' });
  assert.equal(calls.length, 0);
  assert.equal(store._schrijfacties.length, 0);
});

test('zoekPostcode: miss -> 1 fetch en de cache bevat de postcode', async () => {
  const store = maakNepStore();
  const { fn, calls } = maakNepFetch(url => antwoord(postcodeVan(url)));
  const r = await zoekPostcode(store, '3640', deps(fn));
  assert.equal(r.gemeente, 'Gemeente 3640');
  assert.equal(calls.length, 1);
  assert.deepEqual(cacheVan(store)['3640'], { lat: 50.364, lon: 5, gemeente: 'Gemeente 3640' });
  // tweede keer: uit de cache
  await zoekPostcode(store, '3640', deps(fn));
  assert.equal(calls.length, 1);
});

test('zoekPostcode: ongeldige postcode -> null zonder fetch', async () => {
  const store = maakNepStore();
  const { fn, calls } = maakNepFetch();
  assert.equal(await zoekPostcode(store, '36', deps(fn)), null);
  assert.equal(await zoekPostcode(store, 'abcd', deps(fn)), null);
  assert.equal(calls.length, 0);
});

test('zoekPostcode: niet gevonden -> null en NIET gecachet', async () => {
  const store = maakNepStore();
  const { fn, calls } = maakNepFetch(() => json({ results: [] }));
  assert.equal(await zoekPostcode(store, '9999', deps(fn)), null);
  assert.equal(store._schrijfacties.length, 0);
  assert.deepEqual(cacheVan(store), {});
  await zoekPostcode(store, '9999', deps(fn));
  assert.equal(calls.length, 2, 'wordt opnieuw geprobeerd');
});

test('zoekPostcode: een onbruikbare cache-ingang telt als miss', async () => {
  const store = maakNepStore({ 'postcode-cache': { 3640: { lat: 'x' } } });
  const { fn, calls } = maakNepFetch(url => antwoord(postcodeVan(url)));
  assert.ok(await zoekPostcode(store, '3640', deps(fn)));
  assert.equal(calls.length, 1);
});

test('zoekPostcodes: 12 unieke postcodes, nooit meer dan 5 gelijktijdig, één schrijfactie', async () => {
  const store = maakNepStore();
  let nu = 0, max = 0;
  const { fn, calls } = maakNepFetch(async url => {
    nu++; max = Math.max(max, nu);
    await new Promise(r => setImmediate(r));
    nu--;
    return antwoord(postcodeVan(url));
  });
  const lijst = Array.from({ length: 12 }, (_, i) => String(3000 + i)).concat(['3000', '3001', 'xx']); // dubbels + ongeldig
  const { gevonden, open } = await zoekPostcodes(store, lijst, { ...deps(fn), parallel: 5 });
  assert.equal(Object.keys(gevonden).length, 12);
  assert.deepEqual(open, []);
  assert.equal(calls.length, 12);
  assert.ok(max <= 5 && max > 1, 'gelijktijdig: ' + max);
  assert.equal(store._schrijfacties.length, 1);
  assert.equal(Object.keys(cacheVan(store)).length, 12);
});

test('zoekPostcodes: tijdsbudget bereikt -> de rest in open, de gevonden stuks toch bewaard', async () => {
  const store = maakNepStore();
  let klok = 0;
  const { fn } = maakNepFetch(url => { klok += 1000; return antwoord(postcodeVan(url)); });
  const lijst = Array.from({ length: 10 }, (_, i) => String(2000 + i));
  const { gevonden, open } = await zoekPostcodes(store, lijst, { ...deps(fn), parallel: 1, maxTijdMs: 3000, nu: () => klok });
  assert.equal(Object.keys(gevonden).length, 3);
  assert.equal(open.length, 7);
  assert.deepEqual([...Object.keys(gevonden), ...open].sort(), lijst.slice().sort());
  assert.equal(store._schrijfacties.length, 1);
  assert.equal(Object.keys(cacheVan(store)).length, 3);
});

test('zoekPostcodes: cache-hits tellen niet mee voor het budget en geven geen schrijfactie', async () => {
  const store = maakNepStore({ 'postcode-cache': { 3640: { lat: 51, lon: 5, gemeente: 'A' }, 3500: { lat: 50, lon: 5, gemeente: 'B' } } });
  const { fn, calls } = maakNepFetch();
  const { gevonden, open } = await zoekPostcodes(store, ['3640', '3500'], { ...deps(fn), maxTijdMs: 0 });
  assert.equal(Object.keys(gevonden).length, 2);
  assert.deepEqual(open, []);
  assert.equal(calls.length, 0);
  assert.equal(store._schrijfacties.length, 0);
});

test('zoekPostcodes: niet-gevonden postcodes staan in open', async () => {
  const store = maakNepStore();
  const { fn } = maakNepFetch(url => (postcodeVan(url) === '1111' ? json({ results: [] }) : antwoord(postcodeVan(url))));
  const { gevonden, open, fouten } = await zoekPostcodes(store, ['1111', '2222'], deps(fn));
  assert.deepEqual(Object.keys(gevonden), ['2222']);
  assert.deepEqual(open, ['1111']);
  assert.deepEqual(fouten, [], 'echt niet gevonden is geen tijdelijke fout');
});

test('zoekPostcodes: twee gelijktijdige aanroepen met verschillende postcodes -> de cache bevat beide reeksen', async () => {
  const store = maakNepStore();
  const { fn } = maakNepFetch(async url => { await new Promise(r => setImmediate(r)); return antwoord(postcodeVan(url)); });
  const a = ['3000', '3001', '3002'], b = ['4000', '4001', '4002'];
  await Promise.all([zoekPostcodes(store, a, deps(fn)), zoekPostcodes(store, b, deps(fn))]);
  assert.deepEqual(Object.keys(cacheVan(store)).sort(), [...a, ...b].sort());
});

test('zoekPostcodes: verloren schrijfactie (ok:false) -> resultaat toch teruggegeven, console.error, geen exception', async () => {
  const echt = maakNepStore();
  const store = { get: echt.get, list: echt.list, async setJSON() { /* ongemerkt verloren */ } };
  const { fn } = maakNepFetch(url => antwoord(postcodeVan(url)));
  const oud = console.error;
  const fouten = [];
  console.error = (...a) => fouten.push(a.join(' '));
  try {
    const { gevonden } = await zoekPostcodes(store, ['3640'], deps(fn));
    assert.equal(gevonden['3640'].gemeente, 'Gemeente 3640');
  } finally { console.error = oud; }
  assert.ok(fouten.length >= 1);
  assert.ok(!fouten.join('').includes('Gemeente'), 'enkel het fouttype wordt gelogd');
});

test('zoekPostcodes: een gooiende store (lezen en schrijven) breekt het resultaat niet', async () => {
  const store = { async get() { throw new Error('storing'); }, async setJSON() { throw new Error('storing'); } };
  const { fn } = maakNepFetch(url => antwoord(postcodeVan(url)));
  const oud = console.error;
  let aantal = 0;
  console.error = () => { aantal++; };
  try {
    const { gevonden } = await zoekPostcodes(store, ['3640'], deps(fn));
    assert.ok(gevonden['3640']);
  } finally { console.error = oud; }
  assert.ok(aantal >= 1);
});

test('zoekPostcodes: testmodus bewaart geen nepcoördinaten in de cache en gebruikt geen fetch', async () => {
  const store = maakNepStore();
  const { fn, calls } = maakNepFetch();
  const { gevonden } = await zoekPostcodes(store, ['3640', '3500'], { fetch: fn, testModus: true });
  assert.equal(Object.keys(gevonden).length, 2);
  assert.equal(calls.length, 0);
  assert.equal(store._schrijfacties.length, 0);
});

test('zoekPostcodes: tijdelijke fout (HTTP 500) -> in open en NIET gecachet; later opnieuw geprobeerd', async () => {
  const store = maakNepStore();
  let stuk = true;
  const { fn, calls } = maakNepFetch(url => (stuk ? json({}, 500) : antwoord(postcodeVan(url))));
  const r1 = await zoekPostcodes(store, ['3640'], deps(fn));
  assert.deepEqual(r1.open, ['3640']);
  assert.deepEqual(r1.fouten, ['3640'], 'tijdelijke fout apart gemeld');
  assert.deepEqual(r1.gevonden, {});
  assert.equal(store._schrijfacties.length, 0);
  stuk = false;
  const r2 = await zoekPostcodes(store, ['3640'], deps(fn));
  assert.ok(r2.gevonden['3640']);
  assert.equal(calls.length, 2);
});

test('zoekPostcodes: antwoord met een andere postalCode dan gevraagd wordt niet gecachet (niet gevonden)', async () => {
  const store = maakNepStore();
  const { fn } = maakNepFetch(() => json({ results: [{ position: { lat: 51, lon: 5 }, address: { postalCode: '3500', municipality: 'Hasselt' } }] }));
  const { gevonden, open } = await zoekPostcodes(store, ['3640'], deps(fn));
  assert.deepEqual(gevonden, {});
  assert.deepEqual(open, ['3640']);
  assert.deepEqual(cacheVan(store), {});
});

test('zoekPostcodes: enkel 1000-9999 wordt opgezocht en gecachet', async () => {
  const store = maakNepStore();
  const { fn, calls } = maakNepFetch(url => antwoord(postcodeVan(url)));
  const { gevonden } = await zoekPostcodes(store, ['0123', '0999', '1000', '9999'], deps(fn));
  assert.deepEqual(Object.keys(gevonden).sort(), ['1000', '9999']);
  assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(cacheVan(store)).sort(), ['1000', '9999']);
});

test('een mislukte cache-LEZING logt "lezen mislukt" (niet "schrijven")', async () => {
  const store = { async get() { throw new Error('storing'); }, async setJSON() {} };
  const { fn } = maakNepFetch(url => antwoord(postcodeVan(url)));
  const oud = console.error;
  const regels = [];
  console.error = (...a) => regels.push(a.join(' '));
  try { await zoekPostcodes(store, ['3640'], deps(fn)); } finally { console.error = oud; }
  assert.ok(regels.some(r => r.includes('lezen mislukt')), regels.join('|'));
  assert.ok(regels.every(r => !r.includes('Error') || r.includes('(Error)')));
});
