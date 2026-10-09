// tests/server-sales-opruimen.test.mjs — ruimAllesOp (lib) en de geplande functie sales-opruimen (Task 12).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { ruimAllesOp } from '../netlify/lib/sales-opruimen.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { maakOpruimHandler, config, MIN_TUSSENPOOZ_MS, MARKER_SLEUTEL } from '../netlify/functions/sales-opruimen.js';

const NU0 = Date.parse('2026-10-08T10:00:00.000Z'); // grens: 2025-10-08
const afgewerkt = (id, op) => ({ id, status: 'afgewerkt', resultaat: { soort: 'verkocht', op }, bezoeken: [{ datum: op.slice(0, 10) }], geimporteerdOp: '2025-01-01T00:00:00.000Z' });
const open = (id, extra = {}) => ({ id, status: 'te-plannen', bezoeken: [], geimporteerdOp: '2026-05-01T00:00:00.000Z', ...extra });
const OUD = { geimporteerdOp: '2024-01-01T00:00:00.000Z' }; // een niet afgewerkte lead zonder activiteit sinds 2024
const blob = (leads, grafstenen = [], versie = 4, blokken = []) => ({ versie, leads, blokken, grafstenen });
const sleutels = store => store._schrijfacties.map(a => a.key);
const logItems = store => JSON.parse(store._data.get('activiteit/2026-10') ?? '{"items":[]}').items;
const blobVan = (store, id) => JSON.parse(store._data.get(`sales/${id}`));

const begin = () => ({
  'sales/u-sal': blob([afgewerkt('oud', '2025-09-30T09:00:00.000Z'), afgewerkt('recent', '2025-10-15T09:00:00.000Z'), open('open-oud', OUD), open('open-nieuw')],
    [{ h: ['x1'], op: '2025-09-01T00:00:00.000Z' }, { h: ['x2'], op: '2026-09-01T00:00:00.000Z' }], 4,
    [{ id: 'bl-oud', datum: '2025-01-01', start: '09:00', eind: '10:00', soort: 'afspraak', omschrijving: 'afspraak bij Peeters' }, { id: 'bl-nieuw', datum: '2026-10-20', start: '09:00', eind: '10:00', soort: 'afspraak' }]),
  // een verkoper die niet meer in `gebruikers` staat: zijn blob wordt toch opgeruimd
  'sales/u-weg': blob([afgewerkt('w1', '2025-01-01T09:00:00.000Z'), afgewerkt('w2', '2025-02-01T09:00:00.000Z')]),
  // niets te wissen: geen schrijfactie
  'sales/u-sam': blob([afgewerkt('vers', '2026-09-01T09:00:00.000Z'), open('o')], [{ h: ['y'], op: '2026-01-01T00:00:00.000Z' }]),
  'postcode-cache': { 3640: { lat: 1, lon: 2, gemeente: 'X' } },
  gebruikers: { versie: 1, gebruikers: [{ id: 'u-sal', rol: 'sales', actief: true }] },
});

// Een store waarvan het lezen van één blob mislukt (de rest werkt).
const kapotBij = (echt, sleutel) => ({
  ...echt,
  get: async (k, o) => { if (k === sleutel) throw new Error('geheim detail'); return echt.get(k, o); },
});

test('rechtenrij: sales-opruimen is open (geplande functie)', () => {
  assert.equal(RECHTEN['sales-opruimen']['*'], 'open');
});

test('ruimAllesOp: wist leads zonder activiteit (ook niet afgewerkte), blokken en grafstenen ouder dan 12 maanden, bij alle sales/*-blobs', async () => {
  const echt = maakNepStore(begin());
  const r = await ruimAllesOp({ store: echt, nu: NU0 });
  assert.deepEqual(r, { gewist: 4, blokkenGewist: 1, grafstenenGewist: 1 });
  assert.deepEqual(blobVan(echt, 'u-sal').leads.map(l => l.id), ['recent', 'open-nieuw']);
  assert.deepEqual(blobVan(echt, 'u-sal').blokken.map(b => b.id), ['bl-nieuw']);
  assert.deepEqual(blobVan(echt, 'u-sal').grafstenen.map(g => g.h[0]), ['x2']);
  assert.equal(blobVan(echt, 'u-sal').versie, 5);
  assert.deepEqual(blobVan(echt, 'u-weg').leads, []); // ook de verkoper die niet meer bestaat
  assert.ok(echt._data.has('postcode-cache')); // niets buiten sales/
});

test('ruimAllesOp: schrijft niets bij geen wijziging en laat het blob onaangeroerd', async () => {
  const echt = maakNepStore(begin());
  const voor = echt._data.get('sales/u-sam');
  await ruimAllesOp({ store: echt, nu: NU0 });
  assert.equal(echt._data.get('sales/u-sam'), voor);
  assert.ok(!sleutels(echt).includes('sales/u-sam'));
});

test('I3: blobs van geblokkeerde of verwijderde verkopers worden ook opgeruimd (hun leads blijven niet eeuwig bewaard)', async () => {
  const echt = maakNepStore({
    'sales/u-geblokkeerd': blob([open('a', OUD), open('b', OUD), open('c')]),
    'sales/u-verwijderd': blob([open('d', OUD)]),
    gebruikers: { versie: 1, gebruikers: [{ id: 'u-geblokkeerd', rol: 'sales', actief: false }] }, // u-verwijderd staat er niet meer in
  });
  const r = await ruimAllesOp({ store: echt, nu: NU0 });
  assert.equal(r.gewist, 3);
  assert.deepEqual(blobVan(echt, 'u-geblokkeerd').leads.map(l => l.id), ['c']);
  assert.deepEqual(blobVan(echt, 'u-verwijderd').leads, []);
});

test('I3: logStore null (testopslag) ruimt op zonder logregel', async () => {
  const test = maakNepStore({ 'sales/test-sales': blob([open('a', OUD)]) });
  const r = await ruimAllesOp({ store: test, nu: NU0, logStore: null });
  assert.equal(r.gewist, 1);
  assert.deepEqual(blobVan(test, 'test-sales').leads, []);
  assert.deepEqual(logItems(test), []);
});

test('ruimAllesOp: idempotent (tweede run: niets, geen schrijfacties, geen extra logregels)', async () => {
  const echt = maakNepStore(begin());
  await ruimAllesOp({ store: echt, nu: NU0 });
  const acties = echt._schrijfacties.length;
  const logs = logItems(echt).length;
  assert.deepEqual(await ruimAllesOp({ store: echt, nu: NU0 }), { gewist: 0, blokkenGewist: 0, grafstenenGewist: 0 });
  assert.equal(echt._schrijfacties.length, acties);
  assert.equal(logItems(echt).length, logs);
});

test('ruimAllesOp: één logregel per verkoper met gewiste leads, door Systeem, enkel een aantal', async () => {
  const echt = maakNepStore(begin());
  await ruimAllesOp({ store: echt, nu: NU0 });
  const items = logItems(echt);
  assert.equal(items.length, 2);
  for (const i of items) {
    assert.equal(i.actie, 'sales-lead-verwijderd');
    assert.equal(i.gebruikerId, 'systeem');
    assert.equal(i.naam, 'Systeem');
  }
  const perVerkoper = Object.fromEntries(items.map(i => [i.onderwerp, JSON.parse(i.details)]));
  assert.deepEqual(perVerkoper, { 'u-sal': { aantal: 2 }, 'u-weg': { aantal: 2 } });
});

test('ruimAllesOp: enkel grafstenen weg -> blob geschreven, geen logregel (geen leads gewist)', async () => {
  const echt = maakNepStore({ 'sales/u-g': blob([open('a')], [{ h: ['z'], op: '2024-01-01T00:00:00.000Z' }]) });
  assert.deepEqual(await ruimAllesOp({ store: echt, nu: NU0 }), { gewist: 0, blokkenGewist: 0, grafstenenGewist: 1 });
  assert.deepEqual(blobVan(echt, 'u-g').grafstenen, []);
  assert.deepEqual(logItems(echt), []);
});

test('ruimAllesOp: een kapotte blob stopt de andere niet; de fout staat in het resultaat', async () => {
  const echt = maakNepStore(begin());
  const r = await ruimAllesOp({ store: kapotBij(echt, 'sales/u-sal'), nu: NU0 });
  assert.equal(r.mislukt, 1);
  assert.equal(r.gewist, 2); // enkel u-weg; u-sal faalde
  assert.deepEqual(blobVan(echt, 'u-weg').leads, []);
});

test('ruimAllesOp: lege store -> niets', async () => {
  assert.deepEqual(await ruimAllesOp({ store: maakNepStore(), nu: NU0 }), { gewist: 0, blokkenGewist: 0, grafstenenGewist: 0 });
});

// ---------------- de functie ----------------
test('sales-opruimen: dagelijks gepland, geen eigen path (via de /api/*-redirect wel bereikbaar, daarom idempotent en begrensd), standaard-export zonder argumenten', async () => {
  assert.equal(config.schedule, '@daily');
  assert.equal(config.path, undefined);
  const module = await import('../netlify/functions/sales-opruimen.js');
  assert.equal(typeof module.default, 'function');
  assert.equal(module.default.length, 0);
});

// Een getStore die de echte en de testopslag onderscheidt.
const tweeStores = (echt, test) => opties => {
  assert.ok(['blitz-data', 'blitz-data-test'].includes(opties.name), opties.name);
  return opties.name === 'blitz-data' ? echt : test;
};

test('sales-opruimen: draait zonder login op de echte store en antwoordt 200 met de aantallen; tweede run verandert niets', async () => {
  const echt = maakNepStore(begin());
  const test = maakNepStore();
  const run = maakOpruimHandler({ getStore: tweeStores(echt, test), nu: () => NU0 });
  const res = await run();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { gewist: 4, blokkenGewist: 1, grafstenenGewist: 1 });
  const acties = echt._schrijfacties.length;
  assert.equal((await run()).status, 200);
  assert.equal(echt._schrijfacties.length, acties);
});

test('I3: de opruiming draait ook op de testopslag (echte leads in testmodus), telt mee en logt daar niets', async () => {
  const echt = maakNepStore(begin());
  const test = maakNepStore({ 'sales/test-sales': blob([open('t-oud', OUD), open('t-nieuw')], [], 2, [{ id: 'tb', datum: '2025-01-01', start: '09:00', eind: '10:00', soort: 'verlof' }]) });
  const res = await maakOpruimHandler({ getStore: tweeStores(echt, test), nu: () => NU0 })();
  assert.deepEqual(await res.json(), { gewist: 5, blokkenGewist: 2, grafstenenGewist: 1 });
  assert.deepEqual(blobVan(test, 'test-sales').leads.map(l => l.id), ['t-nieuw']);
  assert.deepEqual(blobVan(test, 'test-sales').blokken, []);
  assert.deepEqual(logItems(test), []);
});

test('I3: een falende testopslag geeft 500 maar de echte opslag is opgeruimd', async () => {
  const echt = maakNepStore(begin());
  const kapot = { async list() { throw new Error('geheim detail'); } };
  const res = await maakOpruimHandler({ getStore: tweeStores(echt, kapot), nu: () => NU0 })();
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(await res.json()).includes('geheim'));
  assert.deepEqual(blobVan(echt, 'u-weg').leads, []);
});

test('sales-opruimen: kapotte store -> 500 zonder foutdetails in het antwoord', async () => {
  const kapot = { async list() { throw new Error('geheim detail'); } };
  const res = await maakOpruimHandler({ getStore: () => kapot, nu: () => NU0 })();
  assert.equal(res.status, 500);
  assert.ok(!JSON.stringify(await res.json()).includes('geheim'));
});

test('sales-opruimen: een mislukte blob geeft 500 (de scheduler ziet de fout) maar de andere blobs zijn opgeruimd', async () => {
  const echt = maakNepStore(begin());
  const res = await maakOpruimHandler({ getStore: () => kapotBij(echt, 'sales/u-sal'), nu: () => NU0 })();
  assert.equal(res.status, 500);
  assert.deepEqual(blobVan(echt, 'u-weg').leads, []);
});

// ---------------- begrenzing: hoogstens eens per 6 uur ----------------
test('sales-opruimen: een tweede aanroep binnen 6 uur antwoordt overgeslagen zonder een verkoperblob te lezen of te schrijven', async () => {
  const echt = maakNepStore(begin());
  let tijd = NU0;
  const run = maakOpruimHandler({ getStore: () => echt, nu: () => tijd });
  assert.equal((await run()).status, 200);
  assert.ok(echt._data.has(MARKER_SLEUTEL));
  assert.ok(!MARKER_SLEUTEL.startsWith('sales/'), 'de marker is geen verkoperblob');
  const leesBlobs = [];
  const bewaakt = { ...echt, get: async (k, o) => { leesBlobs.push(k); return echt.get(k, o); }, list: async () => { throw new Error('mag niet'); } };
  const acties = echt._schrijfacties.length;
  tijd = NU0 + MIN_TUSSENPOOZ_MS - 1;
  const res = await maakOpruimHandler({ getStore: () => bewaakt, nu: () => tijd })();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { overgeslagen: true });
  assert.ok(leesBlobs.every(k => !k.startsWith('sales/')), 'geen verkoperblob gelezen');
  assert.equal(echt._schrijfacties.length, acties);
});

test('sales-opruimen: na het venster (en bij de dagelijkse scheduler) draait de opruiming weer en wist ze nieuw verouderde data', async () => {
  const echt = maakNepStore(begin());
  const run = maakOpruimHandler({ getStore: () => echt, nu: () => NU0 });
  await run();
  // negen dagen later is de lead 'recent' (laatste bezoek 2025-10-15) verouderd (grens 2025-10-09 + ...): 2026-10-17 -> grens 2025-10-17
  const later = NU0 + 9 * 24 * 3600 * 1000;
  const res = await maakOpruimHandler({ getStore: () => echt, nu: () => later })();
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.overgeslagen, undefined);
  assert.equal(b.gewist, 1);
  assert.deepEqual(blobVan(echt, 'u-sal').leads.map(l => l.id), ['open-nieuw']);
});

test('sales-opruimen: een klok die achteruit lijkt te lopen (marker in de toekomst) blokkeert de opruiming niet', async () => {
  const echt = maakNepStore({ ...begin(), [MARKER_SLEUTEL]: { op: new Date(NU0 + 3 * 24 * 3600 * 1000).toISOString() } });
  const res = await maakOpruimHandler({ getStore: () => echt, nu: () => NU0 })();
  assert.equal((await res.json()).overgeslagen, undefined);
});

test('sales-opruimen: een kapotte marker (geen datum) wordt genegeerd en overschreven', async () => {
  const echt = maakNepStore({ ...begin(), [MARKER_SLEUTEL]: { op: 'kapot' } });
  const res = await maakOpruimHandler({ getStore: () => echt, nu: () => NU0 })();
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(echt._data.get(MARKER_SLEUTEL)).op, new Date(NU0).toISOString());
});

test('sales-opruimen: ruimAllesOp zelf raakt de marker niet aan (enkel sales/*)', async () => {
  const echt = maakNepStore({ ...begin(), [MARKER_SLEUTEL]: { op: new Date(NU0).toISOString() } });
  await ruimAllesOp({ store: echt, nu: NU0 });
  assert.ok(echt._data.has(MARKER_SLEUTEL));
});
