process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bouwDagItems, volgendeBeschikbareDag, capaciteitsKop } from '../public/js/schermen/capaciteit.js';
import { plaatsNieuw, extraPlaatsen } from '../public/js/planner-tijdlijn.js';

// Brent-besluit (proefperiode): het aantalmodel (capaciteitVoorDag/blokkeerMinuten, slots tellen) is vervangen door de
// plaatsingsregel uit planner-tijdlijn.js. De oude tests van die functies zijn bewust vervangen; de regel zelf staat in
// tests/planner-tijdlijn.test.mjs. Hier: de adapter naar dag-items, de dagzoeker en de kop.

const werk = (a, b) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); return (h2 * 60 + m2) - (h1 * 60 + m1); };
const inst = { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 4 };

// ── bouwDagItems ──
test('bouwDagItems: tickets, eigen afspraak met locatie (stop) en zonder locatie (blok), tijdvak-blokkering (blok)', () => {
  const items = bouwDagItems({
    tickets: [{ id: 'a', uur: '09:00', duurMin: 90 }, { id: 'b', uur: null, duurMin: 120 }],
    eigen: [
      { id: 'e1', uur: '13:00', einduur: '14:00', adres: 'Straat 1' },
      { id: 'e2', uur: '15:00', einduur: '15:30' },            // geen locatie: enkel een bezet tijdvak
      { id: 'e3', uur: null },                                  // geen uur en geen locatie: geen tijd bekend
    ],
    blokkeringen: [{ from: '10:00', to: '11:30' }],
    werktijdMin: werk,
  });
  assert.deepEqual(items, [
    { id: 'ta', uur: '09:00', duurMin: 90, soort: 'stop', ticket: true },
    { id: 'tb', uur: null, duurMin: 120, soort: 'stop', ticket: true },
    { id: 'le1', uur: '13:00', duurMin: 60, soort: 'stop' },
    { id: 'le2', uur: '15:00', duurMin: 30, soort: 'blok' },
    { id: 'b0', uur: '10:00', duurMin: 90, soort: 'blok' },
  ]);
});

test('bouwDagItems: een eigen afspraak met locatie maar zonder uur is een stop zonder uur (60 min), zoals in de Route-tab', () => {
  const items = bouwDagItems({ tickets: [], eigen: [{ id: 'x', uur: null, notitie: 'Magazijn' }], blokkeringen: [], werktijdMin: werk });
  assert.deepEqual(items, [{ id: 'lx', uur: null, duurMin: 60, soort: 'stop' }]);
});

// ── volgendeBeschikbareDag (2026-10-05 is een maandag) ──
const nu = new Date(2026, 9, 5, 10, 0);
const werkdagen = [1, 2, 3, 4, 5];

test('volgendeBeschikbareDag: vandaag heeft plaats = vandaag', () => {
  assert.equal(volgendeBeschikbareDag('2026-10-05', { nu, werkdagen, heeftPlaats: () => true }), '2026-10-05');
});

test('volgendeBeschikbareDag: vandaag vol = morgen', () => {
  assert.equal(volgendeBeschikbareDag('2026-10-05', { nu, werkdagen, heeftPlaats: d => d !== '2026-10-05' }), '2026-10-06');
});

test('volgendeBeschikbareDag: weekend wordt overgeslagen', () => {
  assert.equal(volgendeBeschikbareDag('2026-10-09', { nu, werkdagen, heeftPlaats: d => d !== '2026-10-09' }), '2026-10-12');
});

test('volgendeBeschikbareDag: een volle week schuift door naar de eerste dag met plaats in de volgende week', () => {
  // Brent-besluit (proefperiode): geen plek meer deze week (5 t/m 9 okt) = eerste dag met echte vrije tijd volgende week.
  const heeftPlaats = d => d >= '2026-10-13';
  assert.equal(volgendeBeschikbareDag('2026-10-05', { nu, werkdagen, heeftPlaats }), '2026-10-13');
});

test('volgendeBeschikbareDag: geen vrije dag in 60 dagen = null', () => {
  assert.equal(volgendeBeschikbareDag('2026-10-05', { nu, werkdagen, heeftPlaats: () => false }), null);
});

test('volgendeBeschikbareDag: een datum in het verleden wordt overgeslagen', () => {
  assert.equal(volgendeBeschikbareDag('2026-10-01', { nu, werkdagen, heeftPlaats: () => true }), '2026-10-05');
});

// ── Vrije tijd per dag via de items (de combinatie die "+" en de kop gebruiken) ──
test('dag met twee tickets (08:30-12:00 en 12:30-16:00) is vol', () => {
  const items = bouwDagItems({
    tickets: [{ id: 'a', uur: '08:30', duurMin: 210 }, { id: 'b', uur: '12:30', duurMin: 210 }],
    eigen: [], blokkeringen: [], werktijdMin: werk,
  });
  assert.equal(plaatsNieuw({ items, nieuw: { id: 'n', duurMin: 120 }, ...inst }), null);
  assert.equal(extraPlaatsen({ items, duurMin: 120, ...inst }), 0);
});

test('tijdvak-blokkering 10:00-17:00: geen plek (kop 0/0)', () => {
  const items = bouwDagItems({ tickets: [], eigen: [], blokkeringen: [{ from: '10:00', to: '17:00' }], werktijdMin: werk });
  assert.equal(extraPlaatsen({ items, duurMin: 120, ...inst }), 0);
});

test('lege dag: vier tickets van 120 min (aankomst 08:30, 11:00, 13:30, 16:00), begrensd door maxPerDag 4', () => {
  assert.equal(extraPlaatsen({ items: [], duurMin: 120, ...inst }), 4);
  assert.equal(extraPlaatsen({ items: [], duurMin: 120, ...inst, maxPerDag: 2 }), 2);
});

// ── capaciteitsKop ──
test('capaciteitsKop: 1/3 stops · ±2.5u', () => {
  assert.deepEqual(capaciteitsKop({ aantal: 1, cap: 3, duurMinuten: 120, travelMin: 30 }), { label: '1/3 stops · ±2.5u', vol: false });
});

test('capaciteitsKop: 3/3 is vol', () => {
  assert.deepEqual(capaciteitsKop({ aantal: 3, cap: 3, duurMinuten: 120, travelMin: 30 }), { label: '3/3 stops · ±7.5u', vol: true });
});

test('capaciteitsKop: 0/0 is vol', () => {
  assert.deepEqual(capaciteitsKop({ aantal: 0, cap: 0, duurMinuten: 120, travelMin: 30 }), { label: '0/0 stops · ±0u', vol: true });
});
