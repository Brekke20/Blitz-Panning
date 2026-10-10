// tests/opslag.test.mjs — kern/opslag.js: cache-helpers en persistente geocode-cache (nep-localStorage).
import { test, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadFromCache, saveToCache, geocacheLookup, geocacheStore } from '../public/js/kern/opslag.js';

function nepOpslag() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => m.delete(k), _m: m };
}
beforeEach(() => { globalThis.localStorage = nepOpslag(); });

test('saveToCache en loadFromCache: rondreis; onbekende sleutel en kapotte JSON geven null', () => {
  saveToCache('a', { x: 1 });
  assert.deepEqual(loadFromCache('a'), { x: 1 });
  assert.equal(loadFromCache('onbekend'), null);
  localStorage.setItem('kapot', '{nope');
  assert.equal(loadFromCache('kapot'), null);
});

test('saveToCache slikt een vol quotum (best-effort)', () => {
  localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.doesNotThrow(() => saveToCache('a', 1));
});

test('geocacheStore/geocacheLookup: genormaliseerd adres (hoofdletters, witruimte)', () => {
  geocacheStore('  Antwerpseweg   50, 2440 Geel ', 51.1, 4.9);
  assert.deepEqual(geocacheLookup('antwerpseweg 50, 2440 geel'), { lat: 51.1, lon: 4.9 });
  assert.equal(geocacheLookup('elders'), null);
  assert.equal(geocacheLookup(''), null);
});

test('geocacheStore negeert lege adressen en ontbrekende coördinaten', () => {
  geocacheStore('', 1, 2);
  geocacheStore('x', null, 2);
  geocacheStore('y', 1, undefined);
  assert.equal(localStorage._m.has('blitz_geocache'), false);
});

test('geocacheLookup: een item ouder dan 90 dagen telt niet meer', () => {
  const oud = Date.now() - 91 * 86400000;
  localStorage.setItem('blitz_geocache', JSON.stringify({ oud: { lat: 1, lon: 2, t: oud }, vers: { lat: 3, lon: 4, t: Date.now() } }));
  assert.equal(geocacheLookup('oud'), null);
  assert.deepEqual(geocacheLookup('vers'), { lat: 3, lon: 4 });
});

test('geocacheStore: boven 500 adressen sneuvelt het oudste', () => {
  const cache = {};
  for (let i = 0; i < 500; i++) cache['adres' + i] = { lat: 1, lon: 1, t: 1000 + i };
  localStorage.setItem('blitz_geocache', JSON.stringify(cache));
  geocacheStore('nieuw', 5, 6);
  const na = JSON.parse(localStorage.getItem('blitz_geocache'));
  assert.equal(Object.keys(na).length, 500);
  assert.equal('adres0' in na, false);
  assert.deepEqual(geocacheLookup('nieuw'), { lat: 5, lon: 6 });
});
