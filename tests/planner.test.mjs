import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeek, haversine } from '../public/js/planner.js';

// ---- hulpfuncties ----------------------------------------------------------
const nepReistijden = async (van, naar) =>
  new Map(naar.map(n => [n.id, haversine(van.lat, van.lon, n.lat, n.lon) * 1.3]));

const DAGEN = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];

// Verzonnen coordinaten rond Antwerpen / Gent / Hasselt
const KANDIDATEN = [
  { id: 't1', number: '101', priority: 'High',   interventieDatum: '2026-10-08', lat: 51.22, lon: 4.40, duurMin: 120 },
  { id: 't2', number: '102', priority: 'Medium', interventieDatum: null,         lat: 51.25, lon: 4.45, duurMin: 120 },
  { id: 't3', number: '103', priority: 'Low',    interventieDatum: '2026-10-20', lat: 51.05, lon: 3.72, duurMin: 120 },
  { id: 't4', number: '104', priority: 'High',   interventieDatum: null,         lat: 51.06, lon: 3.75, duurMin: 120 },
  { id: 't5', number: '105', priority: 'Medium', interventieDatum: '2026-10-12', lat: 50.93, lon: 5.34, duurMin: 120 },
  { id: 't6', number: '106', priority: 'Low',    interventieDatum: null,         lat: 50.95, lon: 5.30, duurMin: 120 },
  { id: 't7', number: '107', priority: 'High',   interventieDatum: '2026-10-06', lat: 51.20, lon: 4.38, duurMin: 120 },
  { id: 't8', number: '108', priority: null,     interventieDatum: null,         lat: 51.03, lon: 3.70, duurMin: 120 },
];

function maakInvoer(extra = {}) {
  return {
    kandidaten: KANDIDATEN.map(k => ({ ...k })),
    dagen: DAGEN,
    extraVoor: {},
    bestaandPerDag: {},
    eigenAfspraken: {},
    blokkeringen: {},
    klant: {},
    instellingen: { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 3, maxReistijdMin: 45, duurMinuten: 120 },
    depot: { lat: 51.17, lon: 4.33 },
    vandaag: '2026-10-05',
    reistijden: nepReistijden,
    capPerDag: Object.fromEntries(DAGEN.map(d => [d, 3])),
    ...extra,
  };
}

const datumsVan = (uitkomst, id) => uitkomst.geplaatst.filter(g => g.ticketId === id).map(g => g.datum);

// ---- tests -----------------------------------------------------------------
test('huidig: vult dagen chronologisch en respecteert capPerDag', async () => {
  const u = await planWeek(maakInvoer());
  const perDag = {};
  for (const g of u.geplaatst) perDag[g.datum] = (perDag[g.datum] || 0) + 1;
  for (const aantal of Object.values(perDag)) assert.ok(aantal <= 3);
  assert.equal(u.geplaatst.length + u.nietGepland.length, KANDIDATEN.length);
  const datums = u.geplaatst.map(g => g.datum);
  assert.deepEqual(datums, [...datums].sort());
  assert.ok(u.nietGepland.every(n => n.reden === 'geen-plaats'));
  assert.deepEqual(u.waarschuwingen, []);
});

test('huidig: voorkeursdag-ticket enkel op zijn dag', async () => {
  const u = await planWeek(maakInvoer({ klant: { t5: { voorkeur: '2026-10-07' } } }));
  assert.deepEqual(datumsVan(u, 't5'), ['2026-10-07']);
});

test('huidig: klant-geblokkeerde dag wordt overgeslagen', async () => {
  const basis = await planWeek(maakInvoer());
  const dag = basis.geplaatst.find(g => g.ticketId === 't1').datum;
  const u = await planWeek(maakInvoer({ klant: { t1: { geblokkeerd: [dag] } } }));
  assert.ok(!datumsVan(u, 't1').includes(dag));
});

test('huidig: vast uur botst met bestaande stop', async () => {
  const u = await planWeek(maakInvoer({
    klant: { t2: { voorkeurTijd: '10:00' } },
    bestaandPerDag: { '2026-10-05': [{ id: 'x', uur: '09:30', duurMin: 120, lat: 51.2, lon: 4.4 }] },
  }));
  assert.ok(!datumsVan(u, 't2').includes('2026-10-05'));
});

test('huidig: snapshot', async () => {
  const u = await planWeek(maakInvoer());
  assert.deepEqual(u.geplaatst, SNAPSHOT);
});

const SNAPSHOT = [
  { ticketId: 't7', datum: '2026-10-05', verwachteAankomst: '08:00' },
  { ticketId: 't1', datum: '2026-10-05', verwachteAankomst: '10:03' },
  { ticketId: 't2', datum: '2026-10-05', verwachteAankomst: '12:10' },
  { ticketId: 't4', datum: '2026-10-06', verwachteAankomst: '08:00' },
  { ticketId: 't3', datum: '2026-10-06', verwachteAankomst: '10:03' },
  { ticketId: 't8', datum: '2026-10-06', verwachteAankomst: '12:07' },
  { ticketId: 't5', datum: '2026-10-07', verwachteAankomst: '08:00' },
  { ticketId: 't6', datum: '2026-10-07', verwachteAankomst: '10:05' },
];
