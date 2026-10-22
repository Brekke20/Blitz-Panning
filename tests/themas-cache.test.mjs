// tests/themas-cache.test.mjs — kern/themas-cache.js: de themacache in localStorage (puur: de opslag wordt meegegeven).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOORGELADEN } from '../netlify/themas/pakketten.js';
import {
  CACHE_SLEUTEL, ACTIEF_SLEUTEL, MAX_CACHE_BYTES, leesCache, bewaarCache, actiefRecord, bewaarActiefRecord,
} from '../public/js/kern/themas-cache.js';

const halloween = () => structuredClone(VOORGELADEN.find((p) => p.id === 'halloween'));
const kerst = () => structuredClone(VOORGELADEN.find((p) => p.id === 'kerst'));
const rij = (p, extra = {}) => ({ id: p.id, naam: p.naam, aan: true, periode: p.periode, periodeOverride: null, pakketHash: 'h-' + p.id, ...extra });
const DATUM = new Date('2026-10-15T10:00:00+02:00');

function nepOpslag({ gooi = false } = {}) {
  const kaart = new Map();
  return {
    kaart,
    getItem: (k) => (kaart.has(k) ? kaart.get(k) : null),
    setItem(k, v) { if (gooi) throw new Error('vol'); kaart.set(k, String(v)); },
    removeItem: (k) => { kaart.delete(k); },
  };
}

test('leesCache: geen sleutel geeft null', () => {
  assert.equal(leesCache(nepOpslag()), null);
});

test('leesCache: kapotte JSON geeft null', () => {
  const o = nepOpslag();
  o.setItem(CACHE_SLEUTEL, '{kapot');
  assert.equal(leesCache(o), null);
});

test('leesCache: een opslag die gooit geeft null', () => {
  assert.equal(leesCache({ getItem() { throw new Error('geen toegang'); } }), null);
});

test('leesCache: een pakket met een script in de cache wordt weggelaten', () => {
  const o = nepOpslag();
  const slecht = halloween();
  slecht.vormen.web.delen[0].d = '<script>alert(1)</script>';
  const goed = kerst();
  o.setItem(CACHE_SLEUTEL, JSON.stringify({ index: { versie: 3, themas: [rij(slecht), rij(goed)] }, pakketten: { halloween: slecht, kerst: goed } }));
  const c = leesCache(o);
  assert.deepEqual(Object.keys(c.pakketten), ['kerst']);
  assert.equal(c.index.versie, 3);
});

test('leesCache: een pakket onder een andere sleutel dan zijn id wordt weggelaten', () => {
  const o = nepOpslag();
  o.setItem(CACHE_SLEUTEL, JSON.stringify({ index: { versie: 1, themas: [rij(halloween())] }, pakketten: { kerst: halloween() } }));
  assert.deepEqual(Object.keys(leesCache(o).pakketten), []);
});

test('leesCache: een kapotte indexregel valt weg, de rest blijft', () => {
  const o = nepOpslag();
  const h = halloween();
  o.setItem(CACHE_SLEUTEL, JSON.stringify({
    index: { versie: 1, themas: [rij(h), { id: 'kapot', periode: { van: 'x' } }, null, { id: 5 }] },
    pakketten: { halloween: h },
  }));
  assert.deepEqual(leesCache(o).index.themas.map((t) => t.id), ['halloween']);
});

test('leesCache: een cache zonder index of pakketten geeft null', () => {
  const o = nepOpslag();
  o.setItem(CACHE_SLEUTEL, JSON.stringify({ iets: 1 }));
  assert.equal(leesCache(o), null);
});

test('bewaarCache en leesCache: rondreis', () => {
  const o = nepOpslag();
  const h = halloween();
  assert.equal(bewaarCache(o, { index: { versie: 2, themas: [rij(h)] }, pakketten: { halloween: h } }, { datum: DATUM }), true);
  const c = leesCache(o);
  assert.equal(c.index.versie, 2);
  assert.deepEqual(Object.keys(c.pakketten), ['halloween']);
  assert.deepEqual(JSON.parse(JSON.stringify(c.pakketten.halloween)), h); // de gevalideerde kopie is inhoudelijk gelijk (de volgorde van de sleutels mag verschillen)
});

test('bewaarCache: bij 2 MB aan pakketten blijft enkel het actieve pakket', () => {
  const o = nepOpslag();
  const h = halloween();
  const k = kerst();
  const groot = { ...k, id: 'groot', opvulling: 'x'.repeat(2 * 1024 * 1024) };
  const index = { versie: 4, themas: [rij(h), rij(k), rij(groot, { periode: k.periode })] };
  assert.equal(bewaarCache(o, { index, pakketten: { halloween: h, kerst: k, groot } }, { datum: DATUM }), true);
  const ruw = JSON.parse(o.getItem(CACHE_SLEUTEL));
  assert.deepEqual(Object.keys(ruw.pakketten), ['halloween']);
  assert.ok(o.getItem(CACHE_SLEUTEL).length <= MAX_CACHE_BYTES);
  assert.equal(ruw.index.themas.length, 3, 'de index blijft volledig');
});

test('bewaarCache: een opslag die gooit geeft false zonder uitzondering', () => {
  const h = halloween();
  assert.equal(bewaarCache(nepOpslag({ gooi: true }), { index: { versie: 1, themas: [rij(h)] }, pakketten: { halloween: h } }, { datum: DATUM }), false);
});

test('bewaarCache: zonder opslag geeft false', () => {
  assert.equal(bewaarCache(null, { index: { versie: 1, themas: [] }, pakketten: {} }, { datum: DATUM }), false);
});

test('actiefRecord op 15 oktober 2026: halloween tot 31 oktober', () => {
  const h = halloween();
  const r = actiefRecord({ versie: 1, themas: [rij(h)] }, { halloween: h }, DATUM);
  assert.equal(r.id, 'halloween');
  assert.equal(r.tot, '2026-10-31');
  assert.equal(r.voorkeurThema, 'donker');
  assert.equal(r.kleuren.donker.accent, '#f97316');
  assert.equal(r.kleuren.licht.accent, '#c2570c');
});

test('actiefRecord: ontbrekende lichte sleutels vallen terug op de donkere', () => {
  const h = halloween();
  delete h.kleuren.licht.accentDim;
  delete h.kleuren.licht.opAccent;
  const r = actiefRecord({ versie: 1, themas: [rij(h)] }, { halloween: h }, DATUM);
  assert.equal(r.kleuren.licht.accentDim, h.kleuren.donker.accentDim);
  assert.equal(r.kleuren.licht.opAccent, h.kleuren.donker.opAccent);
  assert.equal(r.kleuren.licht.accent, '#c2570c');
});

test('actiefRecord: zonder lichte set is licht gelijk aan donker', () => {
  const h = halloween();
  delete h.kleuren.licht;
  const r = actiefRecord({ versie: 1, themas: [rij(h)] }, { halloween: h }, DATUM);
  assert.deepEqual({ ...r.kleuren.licht }, { ...r.kleuren.donker });
});

test('actiefRecord: halloween uitgezet geeft null', () => {
  const h = halloween();
  assert.equal(actiefRecord({ versie: 1, themas: [rij(h, { aan: false })] }, { halloween: h }, DATUM), null);
});

test('actiefRecord: buiten de periode geeft null', () => {
  const h = halloween();
  assert.equal(actiefRecord({ versie: 1, themas: [rij(h)] }, { halloween: h }, new Date('2026-11-05T10:00:00+01:00')), null);
});

test('actiefRecord: een override van de beheerder gaat voor op de periode van het pakket', () => {
  const h = halloween();
  const override = { van: { maand: 11, dag: 1 }, tot: { maand: 11, dag: 10 } };
  const index = { versie: 1, themas: [rij(h, { periodeOverride: override })] };
  assert.equal(actiefRecord(index, { halloween: h }, DATUM), null);
  assert.equal(actiefRecord(index, { halloween: h }, new Date('2026-11-05T10:00:00+01:00')).tot, '2026-11-10');
});

test('actiefRecord: periode over de jaarwissel geeft het einde in het volgende jaar', () => {
  const k = kerst();
  const wissel = { van: { maand: 12, dag: 20 }, tot: { maand: 1, dag: 6 } };
  const r = actiefRecord({ versie: 1, themas: [rij(k, { periodeOverride: wissel })] }, { kerst: k }, new Date('2027-01-03T10:00:00+01:00'));
  assert.equal(r.id, 'kerst');
  assert.equal(r.tot, '2027-01-06');
});

test('actiefRecord: actief thema zonder pakket in de cache geeft null', () => {
  assert.equal(actiefRecord({ versie: 1, themas: [rij(halloween())] }, {}, DATUM), null);
});

test('actiefRecord: zonder index geeft null', () => {
  assert.equal(actiefRecord(null, {}, DATUM), null);
});

test('bewaarActiefRecord: bewaart het record, null wist de sleutel', () => {
  const o = nepOpslag();
  const h = halloween();
  const r = actiefRecord({ versie: 1, themas: [rij(h)] }, { halloween: h }, DATUM);
  assert.equal(bewaarActiefRecord(o, r), true);
  assert.equal(JSON.parse(o.getItem(ACTIEF_SLEUTEL)).id, 'halloween');
  assert.equal(bewaarActiefRecord(o, null), true);
  assert.equal(o.getItem(ACTIEF_SLEUTEL), null);
});

test('bewaarActiefRecord: een opslag die gooit geeft false', () => {
  assert.equal(bewaarActiefRecord(nepOpslag({ gooi: true }), { id: 'x' }), false);
});
