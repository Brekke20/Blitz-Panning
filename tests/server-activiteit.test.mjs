// tests/server-activiteit.test.mjs — /api/activiteit (lezen, enkel beheerder) en activiteit-opruimen (dagelijks)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { maakHandler } from '../netlify/functions/activiteit.js';
import { maakOpruimHandler, config as opruimConfig } from '../netlify/functions/activiteit-opruimen.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { metRol } from './auth-hulp.mjs';

const NU0 = Date.parse('2026-10-08T10:00:00.000Z');

const item = (op, gebruikerId, naam, actie, onderwerp = null) => ({ op, gebruikerId, naam, actie, onderwerp, details: null });

const begin = () => ({
  'activiteit/2026-09': { versie: 2, items: [
    item('2026-09-02T08:00:00.000Z', 'u-bea', 'Bea', 'gebruiker-aangemaakt', 'u-jan'),
    item('2026-09-20T09:00:00.000Z', 'u-jan', 'Jan', 'afspraak-gepland', 'T-1'),
  ] },
  'activiteit/2026-10': { versie: 3, items: [
    item('2026-10-01T07:00:00.000Z', 'u-jan', 'Jan', 'afspraak-gepland', 'T-2'),
    item('2026-10-05T12:30:00.000Z', 'systeem', 'Systeem', 'herstel-mislukt-reeks', null),
    item('2026-10-07T23:59:59.000Z', 'u-bea', 'Bea', 'wachtwoord-gereset', 'u-tim'),
    item('2026-10-08T00:00:00.000Z', 'u-jan', 'Jan', 'afspraak-gepland', 'T-3'),
  ] },
});

function opzet(extra = {}) {
  const echt = maakNepStore({ ...begin(), ...extra });
  const test = maakNepStore({});
  const getStore = opties => (opties.name === 'blitz-data' ? echt : test);
  return { echt, test, h: maakHandler({ getStore, nu: () => NU0 }) };
}

const get = (zoek = '', headers = {}) => new Request(`http://localhost/api/activiteit${zoek}`, {
  method: 'GET', headers: { 'x-blitz': '1', ...headers },
});
const lees = async (h, zoek, rol = 'beheerder') => {
  const res = await metRol(rol, () => h(get(zoek)));
  return { status: res.status, body: await res.json() };
};

// ---------------- rechtenrijen ----------------
test('rechtenrijen: activiteit enkel beheerder (GET), opruimen open', () => {
  assert.deepEqual([...RECHTEN.activiteit.GET], ['beheerder']);
  assert.equal(RECHTEN.activiteit.POST, undefined);
  assert.equal(RECHTEN.activiteit['*'], undefined);
  assert.equal(RECHTEN['activiteit-opruimen']['*'], 'open');
});

test('rechten: planner, technieker en sales krijgen 403 geen-recht', async () => {
  const { h } = opzet();
  for (const rol of ['planner', 'technieker', 'sales']) {
    const { status, body } = await lees(h, '', rol);
    assert.equal(status, 403, rol);
    assert.equal(body.code, 'geen-recht', rol);
    assert.equal(body.items, undefined, rol);
  }
});

test('POST op activiteit: 405 (geen regel)', async () => {
  const { h } = opzet();
  const res = await metRol('beheerder', () => h(new Request('http://localhost/api/activiteit', {
    method: 'POST', headers: { 'x-blitz': '1' }, body: '{}',
  })));
  assert.equal(res.status, 405);
});

// ---------------- lezen ----------------
test('beheerder: alle items van twee maanden, nieuwste eerst, met gebruikerslijst', async () => {
  const { h } = opzet();
  const { status, body } = await lees(h, '');
  assert.equal(status, 200);
  assert.equal(body.items.length, 6);
  const ops = body.items.map(i => i.op);
  assert.deepEqual(ops, [...ops].sort().reverse());
  assert.equal(body.items[0].onderwerp, 'T-3');
  assert.deepEqual(
    [...body.gebruikers].sort((a, b) => a.id.localeCompare(b.id)),
    [{ id: 'systeem', naam: 'Systeem' }, { id: 'u-bea', naam: 'Bea' }, { id: 'u-jan', naam: 'Jan' }],
  );
});

test('filter op actie', async () => {
  const { h } = opzet();
  const { body } = await lees(h, '?actie=afspraak-gepland');
  assert.deepEqual(body.items.map(i => i.onderwerp), ['T-3', 'T-2', 'T-1']);
});

test('filter op gebruiker; de gebruikerslijst blijft volledig voor de filter', async () => {
  const { h } = opzet();
  const { body } = await lees(h, '?gebruiker=u-bea');
  assert.deepEqual(body.items.map(i => i.actie), ['wachtwoord-gereset', 'gebruiker-aangemaakt']);
  assert.equal(body.gebruikers.length, 3);
});

test('filter op gebruiker en actie samen', async () => {
  const { h } = opzet();
  const { body } = await lees(h, '?gebruiker=u-jan&actie=afspraak-gepland&van=2026-10-01&tot=2026-10-31');
  assert.deepEqual(body.items.map(i => i.onderwerp), ['T-3', 'T-2']);
});

test('van en tot zijn hele dagen (UTC), grenzen inbegrepen', async () => {
  const { h } = opzet();
  const { body } = await lees(h, '?van=2026-10-07&tot=2026-10-07');
  assert.deepEqual(body.items.map(i => i.actie), ['wachtwoord-gereset']);
  const dag = await lees(h, '?van=2026-10-08&tot=2026-10-08');
  assert.deepEqual(dag.body.items.map(i => i.onderwerp), ['T-3']);
});

test('van na tot: lege lijst (geen fout)', async () => {
  const { h } = opzet();
  const { status, body } = await lees(h, '?van=2026-10-08&tot=2026-09-01');
  assert.equal(status, 200);
  assert.deepEqual(body.items, []);
  assert.deepEqual(body.gebruikers, []);
});

test('ongeldige datum: 400', async () => {
  const { h } = opzet();
  for (const zoek of ['?tot=morgen', '?van=gisteren', '?tot=2026-13-01', '?van=2026-02-30', '?tot=2026-1-5', '?van=2026-10-08T10:00:00Z']) {
    const { status, body } = await lees(h, zoek);
    assert.equal(status, 400, zoek);
    assert.equal(typeof body.error, 'string', zoek);
  }
});

test('maximaal 1000 items', async () => {
  const veel = Array.from({ length: 1200 }, (_, i) => item(new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(), 'u-jan', 'Jan', 'x'));
  const { h } = opzet({ 'activiteit/2026-10': { versie: 1, items: veel } });
  const { body } = await lees(h, '?van=2026-10-01');
  assert.equal(body.items.length, 1000);
});

test('leest altijd uit de echte store, ook bij een testverzoek', async () => {
  const { h } = opzet();
  const res = await metRol('beheerder', () => h(get('', { 'x-blitz-test': '1' })));
  assert.equal((await res.json()).items.length, 6);
});

test('opslagfout: 503 opslag-storing', async () => {
  const kapot = { async list() { throw new Error('boem'); }, async get() { throw new Error('boem'); } };
  const h = maakHandler({ getStore: () => kapot, nu: () => NU0 });
  const res = await metRol('beheerder', () => h(get('')));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'opslag-storing');
});

// ---------------- opruimen ----------------
test('opruimen: config is dagelijks gepland', () => {
  assert.equal(opruimConfig.schedule, '@daily');
});

test('opruimen: activiteit/2025-09 weg, activiteit/2025-10 blijft (klok 2026-10-08), tweede run verandert niets', async () => {
  const echt = maakNepStore({
    'activiteit/2025-08': { versie: 1, items: [] },
    'activiteit/2025-09': { versie: 1, items: [] },
    'activiteit/2025-10': { versie: 1, items: [] },
    'activiteit/2026-10': { versie: 1, items: [] },
    gebruikers: { versie: 1, gebruikers: [] },
  });
  const run = maakOpruimHandler({ getStore: () => echt, nu: () => NU0 });
  const res1 = await run();
  assert.equal(res1.status, 200);
  assert.deepEqual([...echt._data.keys()].sort(), ['activiteit/2025-10', 'activiteit/2026-10', 'gebruikers']);
  const na1 = echt._schrijfacties.length;
  const res2 = await run();
  assert.equal(res2.status, 200);
  assert.equal(echt._schrijfacties.length, na1);
  assert.deepEqual((await res2.json()).verwijderd, []);
});

test('opruimen: gooit niet bij een kapotte store', async () => {
  const kapot = { async list() { throw new Error('boem'); }, async delete() { throw new Error('boem'); } };
  const run = maakOpruimHandler({ getStore: () => kapot, nu: () => NU0 });
  const res = await run();
  assert.equal(res.status, 500);
});

test('opruimen: standaard-export is een functie zonder verplichte argumenten', async () => {
  const module = await import('../netlify/functions/activiteit-opruimen.js');
  assert.equal(typeof module.default, 'function');
  assert.equal(module.default.length, 0);
});
