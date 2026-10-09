process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bouwDagItems, volgendeBeschikbareDag, capaciteitsKop, initCapaciteit, eersteVrijUur } from '../public/js/schermen/capaciteit.js';
import { plaatsNieuw, extraPlaatsen } from '../public/js/planner-tijdlijn.js';
import { toestand } from '../public/js/kern/toestand.js';

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

// ── eersteVrijUur (B16): toestandslezer, vaste toekomstdatum zodat de klok van nu geen rol speelt ──
const DAG = '2030-03-12'; // dinsdag, geen feestdag
function zaaiToestand({ planning = {}, avExceptions = [], localEvents = [] } = {}) {
  toestand.set('settings', { vanTijd: '08:00', laatsteStart: '16:00', duurMinuten: 120, maxPerDag: 4, werkdagen: [1, 2, 3, 4, 5] });
  toestand.set('activeAssigneeFilter', 'all');
  toestand.set('planning', planning);
  toestand.set('avExceptions', avExceptions);
  toestand.set('localEvents', localEvents);
  initCapaciteit({ duurVoor: () => 120, werktijdMin: werk, kbPreferredTime: () => null });
}
const stop = (id, uur) => ({ ticket: { id, assignee: 'Tim' }, address: 'x', uur });

test('eersteVrijUur(datum): lege dag geeft vanTijd + reistijd', () => {
  zaaiToestand();
  assert.equal(eersteVrijUur(DAG, 'x'), '08:30');
});

test('eersteVrijUur(datum): afrondend naar het volgende kwartier', () => {
  // Stop 08:00-10:00 (duur 120): nieuw kan pas na het einde: 10:00 + 30 min reistijd = 10:30; stop 08:20 geeft 10:20 + 30 = 10:50 -> 11:00.
  zaaiToestand({ planning: { [DAG]: [stop('a', '08:20')] } });
  assert.equal(eersteVrijUur(DAG, 'x'), '11:00');
});

test('eersteVrijUur(datum): ook na de laatste starttijd (volle dag) wordt een uur voorgesteld', () => {
  zaaiToestand({ planning: { [DAG]: [stop('a', '08:30'), stop('b', '11:00'), stop('c', '13:30'), stop('d', '16:00')] } });
  const uur = eersteVrijUur(DAG, 'x');
  assert.match(uur, /^\d\d:\d\d$/);
  assert.ok(uur > '16:00', uur);
});

test('eersteVrijUur(datum): null bij feestdag/hele-dag-blokkering', () => {
  zaaiToestand();
  assert.equal(eersteVrijUur('2030-05-01', 'x'), null); // Dag van de Arbeid
  zaaiToestand({ avExceptions: [{ id: 'b', scope: 'global', person: null, date: DAG, kind: 'fullday', from: null, to: null, reason: '' }] });
  assert.equal(eersteVrijUur(DAG, 'x'), null);
});
