// tests/themas-bron.test.mjs — schermen/themas-bron.js: ophalen, cache en terugval (nep-fetch en nep-localStorage, nooit netwerk).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { VOORGELADEN } from '../netlify/themas/pakketten.js';
import { zetFetch } from '../public/js/kern/api.js';
import { CACHE_SLEUTEL, ACTIEF_SLEUTEL } from '../public/js/kern/themas-cache.js';

const halloween = () => structuredClone(VOORGELADEN.find((p) => p.id === 'halloween'));
const kerst = () => structuredClone(VOORGELADEN.find((p) => p.id === 'kerst'));
const rij = (p, hash, extra = {}) => ({ id: p.id, naam: p.naam, aan: true, periode: p.periode, periodeOverride: null, pakketHash: hash, ...extra });
const DATUM = new Date('2026-10-15T10:00:00+02:00');
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

let teller = 0;
const laadVers = () => import(`../public/js/schermen/themas-bron.js?v=${++teller}`);

function zetOpslag(begin = {}) {
  const kaart = new Map(Object.entries(begin));
  globalThis.localStorage = {
    getItem: (k) => (kaart.has(k) ? kaart.get(k) : null),
    setItem: (k, v) => { kaart.set(k, String(v)); },
    removeItem: (k) => { kaart.delete(k); },
  };
  return kaart;
}

// Een nep-fetch met een router; neemt de aanroepen op.
function nepFetch(router) {
  const aanroepen = [];
  zetFetch(async (url) => { aanroepen.push(String(url)); return router(String(url)); });
  return aanroepen;
}

beforeEach(() => { zetOpslag(); });
afterEach(() => { zetFetch(null); delete globalThis.localStorage; });

test('laadThemas: bewaart de index, het pakket en het actieve record', async () => {
  const kaart = zetOpslag();
  const h = halloween();
  nepFetch(() => json({ versie: 2, themas: [rij(h, 'h1')], pakketten: { halloween: h } }));
  const { laadThemas, themasNu } = await laadVers();
  const r = await laadThemas({ datum: DATUM });
  assert.equal(r.index.versie, 2);
  assert.deepEqual(Object.keys(r.pakketten), ['halloween']);
  assert.equal(themasNu(), r);
  assert.equal(JSON.parse(kaart.get(CACHE_SLEUTEL)).index.themas[0].pakketHash, 'h1');
  assert.equal(JSON.parse(kaart.get(ACTIEF_SLEUTEL)).tot, '2026-10-31');
});

test('laadThemas: haalt een pakket met een gewijzigde hash apart op (?id=)', async () => {
  const h = halloween();
  const oud = halloween();
  oud.versie = 'oud';
  zetOpslag({ [CACHE_SLEUTEL]: JSON.stringify({ index: { versie: 1, themas: [rij(oud, 'oud')] }, pakketten: { halloween: oud } }) });
  const aanroepen = nepFetch((url) => (url.includes('?id=halloween') ? json(h) : json({ versie: 2, themas: [rij(h, 'nieuw')], pakketten: {} })));
  const { laadThemas } = await laadVers();
  const r = await laadThemas({ datum: DATUM });
  assert.deepEqual(aanroepen, ['/api/themas', '/api/themas?id=halloween']);
  assert.equal(r.pakketten.halloween.versie, h.versie);
});

test('laadThemas: een pakket met dezelfde hash als in de cache wordt niet opnieuw opgehaald', async () => {
  const h = halloween();
  zetOpslag({ [CACHE_SLEUTEL]: JSON.stringify({ index: { versie: 1, themas: [rij(h, 'zelfde')] }, pakketten: { halloween: h } }) });
  const aanroepen = nepFetch(() => json({ versie: 2, themas: [rij(h, 'zelfde')], pakketten: {} }));
  const { laadThemas } = await laadVers();
  const r = await laadThemas({ datum: DATUM });
  assert.deepEqual(aanroepen, ['/api/themas']);
  assert.deepEqual(Object.keys(r.pakketten), ['halloween']);
});

test('laadThemas: een ongeldig pakket uit het antwoord wordt weggelaten', async () => {
  const h = halloween();
  h.vormen.web.delen[0].d = '<script>alert(1)</script>';
  nepFetch((url) => (url.includes('?id=') ? json({ error: 'nee' }, 404) : json({ versie: 1, themas: [rij(h, 'x')], pakketten: { halloween: h } })));
  const { laadThemas } = await laadVers();
  const r = await laadThemas({ datum: DATUM });
  assert.deepEqual(Object.keys(r.pakketten), []);
});

test('laadThemas: bij een netwerkfout komt de cache terug', async () => {
  const h = halloween();
  zetOpslag({ [CACHE_SLEUTEL]: JSON.stringify({ index: { versie: 7, themas: [rij(h, 'h')] }, pakketten: { halloween: h } }) });
  nepFetch(() => { throw new TypeError('Failed to fetch'); });
  const { laadThemas } = await laadVers();
  const r = await laadThemas({ datum: DATUM });
  assert.equal(r.index.versie, 7);
  assert.deepEqual(Object.keys(r.pakketten), ['halloween']);
});

test('laadThemas: bij een foutstatus komt de cache terug en wordt niets overschreven', async () => {
  const h = halloween();
  const kaart = zetOpslag({ [CACHE_SLEUTEL]: JSON.stringify({ index: { versie: 7, themas: [rij(h, 'h')] }, pakketten: { halloween: h } }) });
  const voor = kaart.get(CACHE_SLEUTEL);
  nepFetch(() => json({ error: 'stuk' }, 503));
  const { laadThemas } = await laadVers();
  const r = await laadThemas({ datum: DATUM });
  assert.equal(r.index.versie, 7);
  assert.equal(kaart.get(CACHE_SLEUTEL), voor);
});

test('laadThemas: zonder cache en zonder netwerk geeft { index: null, pakketten: {} }', async () => {
  nepFetch(() => { throw new TypeError('Failed to fetch'); });
  const { laadThemas } = await laadVers();
  assert.deepEqual(await laadThemas({ datum: DATUM }), { index: null, pakketten: {} });
});

test('laadThemas: een onleesbaar antwoord gooit niet', async () => {
  nepFetch(() => new Response('geen json', { status: 200 }));
  const { laadThemas } = await laadVers();
  assert.deepEqual(await laadThemas({ datum: DATUM }), { index: null, pakketten: {} });
});

test('laadThemas: een opslag die gooit breekt de lading niet', async () => {
  globalThis.localStorage = { getItem() { throw new Error('geen toegang'); }, setItem() { throw new Error('vol'); }, removeItem() { throw new Error('geen'); } };
  const h = halloween();
  nepFetch(() => json({ versie: 1, themas: [rij(h, 'h')], pakketten: { halloween: h } }));
  const { laadThemas } = await laadVers();
  const r = await laadThemas({ datum: DATUM });
  assert.deepEqual(Object.keys(r.pakketten), ['halloween']);
});

test('laadThemas: een thema dat niet meer actief is wist het actieve record', async () => {
  const h = halloween();
  const kaart = zetOpslag({ [ACTIEF_SLEUTEL]: JSON.stringify({ id: 'halloween', tot: '2026-10-31' }) });
  nepFetch(() => json({ versie: 3, themas: [rij(h, 'h', { aan: false })], pakketten: { halloween: h } }));
  const { laadThemas } = await laadVers();
  await laadThemas({ datum: DATUM });
  assert.equal(kaart.get(ACTIEF_SLEUTEL), undefined);
});

test('themasNu: zonder lading komt het uit de cache, zonder cache leeg', async () => {
  const { themasNu } = await laadVers();
  assert.deepEqual(themasNu(), { index: null, pakketten: {} });
  const h = halloween();
  zetOpslag({ [CACHE_SLEUTEL]: JSON.stringify({ index: { versie: 1, themas: [rij(h, 'h')] }, pakketten: { halloween: h } }) });
  const vers = await laadVers();
  assert.deepEqual(Object.keys(vers.themasNu().pakketten), ['halloween']);
});

test('zetVoorbeeld en voorbeeld: enkel in het geheugen', async () => {
  const kaart = zetOpslag();
  const { zetVoorbeeld, voorbeeld } = await laadVers();
  assert.equal(voorbeeld(), null);
  const h = halloween();
  zetVoorbeeld(h);
  assert.equal(voorbeeld(), h);
  assert.equal(kaart.size, 0);
  zetVoorbeeld(null);
  assert.equal(voorbeeld(), null);
});
