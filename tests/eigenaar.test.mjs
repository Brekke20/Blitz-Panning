// Tests voor kern/eigenaar.js (logins T15, fix 1): de lokale staat hoort bij één gebruiker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimToestel, geefToestelVrij, isAndereEigenaar, EIGENAAR_SLEUTEL, PERSOONLIJKE_SLEUTELS } from '../public/js/kern/eigenaar.js';

const maakOpslag = (begin = {}) => {
  const m = new Map(Object.entries(begin));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, sleutels: () => [...m.keys()].sort() };
};

test('isAndereEigenaar: ontbrekend of verschillend is "andere"; gelijk niet; zonder gebruiker nooit', () => {
  assert.equal(isAndereEigenaar(null, 'u1'), true);
  assert.equal(isAndereEigenaar('u2', 'u1'), true);
  assert.equal(isAndereEigenaar('u1', 'u1'), false);
  assert.equal(isAndereEigenaar('u1', undefined), false);
  assert.equal(isAndereEigenaar('u1', ''), false);
});

test('claimToestel met een andere eigenaar wist persoon, caches en schermstaat en zet de markering', () => {
  const ls = maakOpslag({
    [EIGENAAR_SLEUTEL]: 'tim', blitz_active_person: 'Tim', blitz_tickets_cache: '{}', blitz_afspraken_cache: '{}',
    blitz_availability_cache: '{}', blitz_klantbeschikbaarheid_cache: '{}', blitz_inventaris_cache: '{}', blitz_inventaris_cache_test: '{}',
    blitz_verbruik_wachtrij: '[1]', blitz_geocache: '{}', blitz_theme: 'dark', blitz_arrivals: '{}', blitz_settings_Tim: '{}',
  });
  const ss = maakOpslag({ blitz_schermstaat: '{}', ander: 'x' });
  assert.equal(claimToestel(ls, ss, 'roel'), true);
  assert.equal(ls.getItem(EIGENAAR_SLEUTEL), 'roel');
  for (const k of PERSOONLIJKE_SLEUTELS) assert.equal(ls.getItem(k), null, k);
  assert.deepEqual(ls.sleutels(), [EIGENAAR_SLEUTEL, 'blitz_arrivals', 'blitz_geocache', 'blitz_settings_Tim', 'blitz_theme', 'blitz_verbruik_wachtrij'].sort());
  assert.deepEqual(ss.sleutels(), ['ander']);
});

test('claimToestel zonder markering (eerste keer) wist ook en claimt', () => {
  const ls = maakOpslag({ blitz_tickets_cache: '{}' });
  assert.equal(claimToestel(ls, maakOpslag(), 'tim'), true);
  assert.equal(ls.getItem('blitz_tickets_cache'), null);
  assert.equal(ls.getItem(EIGENAAR_SLEUTEL), 'tim');
});

test('claimToestel met dezelfde eigenaar laat alles staan', () => {
  const ls = maakOpslag({ [EIGENAAR_SLEUTEL]: 'tim', blitz_active_person: 'Tim', blitz_tickets_cache: '{}' });
  const ss = maakOpslag({ blitz_schermstaat: '{}' });
  assert.equal(claimToestel(ls, ss, 'tim'), false);
  assert.deepEqual(ls.sleutels(), [EIGENAAR_SLEUTEL, 'blitz_active_person', 'blitz_tickets_cache'].sort());
  assert.deepEqual(ss.sleutels(), ['blitz_schermstaat']);
});

test('geefToestelVrij haalt persoon, markering en schermstaat weg, de caches niet', () => {
  const ls = maakOpslag({ [EIGENAAR_SLEUTEL]: 'tim', blitz_active_person: 'Tim', blitz_tickets_cache: '{}' });
  const ss = maakOpslag({ blitz_schermstaat: '{}' });
  geefToestelVrij(ls, ss);
  assert.deepEqual(ls.sleutels(), ['blitz_tickets_cache']);
  assert.deepEqual(ss.sleutels(), []);
});

test('een kapotte opslag gooit niet', () => {
  const stuk = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => claimToestel(stuk, stuk, 'tim'));
  assert.doesNotThrow(() => geefToestelVrij(stuk, stuk));
  assert.doesNotThrow(() => claimToestel(null, null, 'tim'));
});

test('claimToestel met een andere eigenaar wist ook de gekozen verkoper van de sales-planner', () => {
  const ls = maakOpslag({ [EIGENAAR_SLEUTEL]: 'sam', blitz_sales_verkoper: 'u-sal' });
  assert.ok(PERSOONLIJKE_SLEUTELS.includes('blitz_sales_verkoper'));
  assert.equal(claimToestel(ls, maakOpslag(), 'bea'), true);
  assert.equal(ls.getItem('blitz_sales_verkoper'), null);
  // dezelfde eigenaar: de keuze blijft
  const ls2 = maakOpslag({ [EIGENAAR_SLEUTEL]: 'sam', blitz_sales_verkoper: 'u-sal' });
  assert.equal(claimToestel(ls2, maakOpslag(), 'sam'), false);
  assert.equal(ls2.getItem('blitz_sales_verkoper'), 'u-sal');
});
