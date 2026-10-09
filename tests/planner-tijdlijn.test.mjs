process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leggDagUit, plaatsNieuw, extraPlaatsen, eersteVrijeStart } from '../public/js/planner-tijdlijn.js';
import { stopsVoorDag } from '../public/js/kern/selecties.js';
import { isTeLaat } from '../public/js/schermen/route-tijden.js';

// Brent-besluiten (proefperiode): aankomst uiterlijk op laatsteStart (B1, einde niet getoetst); echte vrije tijd per dag (B3/B4);
// reistijd 30 min per rit (terugval van de Route-tab). Tijden in minuten na middernacht.
const u = (h, m = 0) => h * 60 + m;
const inst = { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 4 };
const tk = (id, uur, duurMin = 120) => ({ id, uur, duurMin, soort: 'stop', ticket: true });
const blok = (id, uur, duurMin) => ({ id, uur, duurMin, soort: 'blok' });

test('een volle dag geeft null', () => {
  const items = [tk('a', '08:30', 210), tk('b', '12:30', 210)];
  assert.equal(plaatsNieuw({ items, nieuw: { id: 'n', duurMin: 120 }, ...inst }), null);
});

test('een lege dag: eerste aankomst vanTijd + 30 min reistijd', () => {
  assert.deepEqual(plaatsNieuw({ items: [], nieuw: { id: 'n', duurMin: 120 }, ...inst }), { start: u(8, 30), eind: u(10, 30) });
});

test('een plek VOOR een vast uur als daar ruimte is (B3)', () => {
  const r = plaatsNieuw({ items: [tk('a', '14:00')], nieuw: { id: 'n', duurMin: 120 }, ...inst });
  assert.deepEqual(r, { start: u(8, 30), eind: u(10, 30) });
});

test('een plek vóór een vast uur wordt geweigerd als de rit naar die volgende stop niet meer past', () => {
  // vast 10:50: nieuw 08:30-10:30 + 30 min rit = 11:00 > 10:50, dus pas ná dat uur (einde 12:50, aankomst 13:20)
  const r = plaatsNieuw({ items: [tk('a', '10:50')], nieuw: { id: 'n', duurMin: 120 }, ...inst });
  assert.deepEqual(r, { start: u(13, 20), eind: u(15, 20) });
});

test('een tijdvak-blokkering telt mee (overlap), een eigen afspraak met locatie ook', () => {
  assert.deepEqual(plaatsNieuw({ items: [blok('b', '10:00', 120)], nieuw: { id: 'n', duurMin: 120 }, ...inst }), { start: u(12, 30), eind: u(14, 30) });
  assert.deepEqual(plaatsNieuw({ items: [{ id: 'e', uur: '08:30', duurMin: 240, soort: 'stop' }], nieuw: { id: 'n', duurMin: 120 }, ...inst }), { start: u(13, 0), eind: u(15, 0) });
});

test('een blokkering over de hele werkdag geeft null', () => {
  assert.equal(plaatsNieuw({ items: [blok('b', '08:00', 540)], nieuw: { id: 'n', duurMin: 120 }, ...inst }), null);
});

test('grens laatsteStart: aankomst om precies 16:00 mag (B1), 16:01 niet; het einde wordt niet getoetst', () => {
  const rand = plaatsNieuw({ items: [blok('b', '08:00', 450)], nieuw: { id: 'n', duurMin: 120 }, ...inst }); // blok tot 15:30
  assert.deepEqual(rand, { start: u(16, 0), eind: u(18, 0) });          // einde 18:00 is toegelaten
  const over = plaatsNieuw({ items: [blok('b', '08:00', 451)], nieuw: { id: 'n', duurMin: 120 }, ...inst }); // blok tot 15:31
  assert.equal(over, null);                                              // aankomst 16:01
});

test('items zonder uur worden in lijstvolgorde vanaf vanTijd geketend; het nieuwe ticket komt erachter', () => {
  const items = [tk('a', null), tk('b', null)];
  const { plaatsingen } = leggDagUit({ items: [...items, tk('n', null)], ...inst });
  assert.deepEqual(plaatsingen.map(p => [p.id, p.start]), [['a', u(8, 30)], ['b', u(11, 0)], ['n', u(13, 30)]]);
  assert.deepEqual(plaatsNieuw({ items, nieuw: { id: 'n', duurMin: 120 }, ...inst }), { start: u(13, 30), eind: u(15, 30) });
});

test('items zonder uur springen over een vast uur (geen overlap) en tellen mee in maxPerDag', () => {
  const items = [tk('v', '09:00', 120), tk('a', null)];
  const { plaatsingen } = leggDagUit({ items, ...inst });
  // a: 08:30-10:30 botst met v (09:00-11:00): klok 11:00, aankomst 11:30
  assert.deepEqual(plaatsingen.map(p => [p.id, p.start]), [['v', u(9)], ['a', u(11, 30)]]);
  assert.equal(plaatsNieuw({ items: [...items, tk('x', '14:00'), tk('y', '15:30')], nieuw: { id: 'n', duurMin: 60 }, ...inst }), null, 'maxPerDag 4 bereikt');
});

test('een bestaand item zonder uur dat na laatsteStart valt wordt gemarkeerd (laat), niet weggelaten', () => {
  const { plaatsingen } = leggDagUit({ items: [blok('b', '08:00', 480), tk('a', null)], ...inst });
  const a = plaatsingen.find(p => p.id === 'a');
  assert.equal(a.laat, true);
  assert.equal(a.start, u(16, 30)); // blok tot 16:00, plus 30 min rit
});

test('maxPerDag 0: nooit plek; ontbrekend: geen grens', () => {
  assert.equal(plaatsNieuw({ items: [], nieuw: { id: 'n', duurMin: 60 }, ...inst, maxPerDag: 0 }), null);
  assert.ok(plaatsNieuw({ items: [], nieuw: { id: 'n', duurMin: 60 }, vanTijd: '08:00', laatsteStart: '16:00' }));
});

test('voorkeursuur van het nieuwe ticket: vast, vrijgesteld van laatsteStart, maar geen overlap', () => {
  assert.deepEqual(plaatsNieuw({ items: [], nieuw: { id: 'n', duurMin: 60, uur: '17:00' }, ...inst }), { start: u(17), eind: u(18) });
  assert.equal(plaatsNieuw({ items: [tk('a', '09:30', 60)], nieuw: { id: 'n', duurMin: 60, uur: '10:00' }, ...inst }), null);
});

test('extraPlaatsen telt hoeveel tickets er nog bij kunnen (basis voor n/cap)', () => {
  assert.equal(extraPlaatsen({ items: [], duurMin: 120, ...inst }), 4);
  assert.equal(extraPlaatsen({ items: [tk('a', '09:00')], duurMin: 120, ...inst }), 2); // 11:30 en 14:00; 16:30 is te laat
});

// ── De Route-tab volgt dezelfde volgorde (stopsVoorDag met opties) ──
const optiesRoute = { vanTijd: '08:00', laatsteStart: '16:00', duurVoor: () => 120, werktijdMin: () => 60 };
const planning = (items) => ({ '2026-10-06': items.map(([id, uur]) => ({ ticket: { id, assignee: 'Tim' }, uur })) });

test('Route-tab: een stop zonder uur komt voor een vast uur als daar plek is (zelfde regel als "+")', () => {
  const { allStops } = stopsVoorDag({ planning: planning([['a', '14:00'], ['nieuw', null]]), localEvents: [] }, 'all', '2026-10-06', optiesRoute);
  assert.deepEqual(allStops.map(e => e.item.ticket.id), ['nieuw', 'a']);
});

test('Route-tab: een stop zonder uur zonder plek vóór het vaste uur komt erachter', () => {
  const { allStops } = stopsVoorDag({ planning: planning([['a', '09:00'], ['nieuw', null]]), localEvents: [] }, 'all', '2026-10-06', optiesRoute);
  assert.deepEqual(allStops.map(e => e.item.ticket.id), ['a', 'nieuw']);
});

test('Route-tab zonder opties: oud gedrag (geen uur = achteraan)', () => {
  const { allStops } = stopsVoorDag({ planning: planning([['a', '14:00'], ['nieuw', null]]), localEvents: [] }, 'all', '2026-10-06');
  assert.deepEqual(allStops.map(e => e.item.ticket.id), ['a', 'nieuw']);
});

test('isTeLaat: een ticket (met of zonder vast uur) met aankomst na laatsteStart; een eigen afspraak niet', () => {
  assert.equal(isTeLaat({ kind: 'ticket', uur: undefined }, u(16, 1), u(16)), true);
  assert.equal(isTeLaat({ kind: 'ticket', uur: undefined }, u(16), u(16)), false);
  assert.equal(isTeLaat({ kind: 'ticket', uur: '17:00' }, u(17), u(16)), true);
  assert.equal(isTeLaat({ kind: 'local', uur: '17:00' }, u(17), u(16)), false);
  assert.equal(isTeLaat({ kind: 'ticket', uur: '17:00' }, u(17), u(16), true), false); // anker (voorkeursuur, bevestigd): vrijgesteld
});

// ── Fix-ronde 1 ──
test('voorkeursuur: de rit naar de stop ervoor en erna moet haalbaar zijn (zoals in het brein)', () => {
  // vaste stop 09:00-10:00; voorkeursuur 10:20 (20 min na einde, rit 30 min): niet haalbaar
  assert.equal(plaatsNieuw({ items: [tk('a', '09:00', 60)], nieuw: { id: 'n', duurMin: 60, uur: '10:20' }, ...inst }), null);
  assert.ok(plaatsNieuw({ items: [tk('a', '09:00', 60)], nieuw: { id: 'n', duurMin: 60, uur: '10:30' }, ...inst }));
  // naar de stop erna: einde 11:00 + 30 > 11:20
  assert.equal(plaatsNieuw({ items: [tk('a', '11:20', 60)], nieuw: { id: 'n', duurMin: 60, uur: '10:00' }, ...inst }), null);
});

test('vroegst: de aankomst valt niet vóór de klok van nu (vandaag)', () => {
  const r = plaatsNieuw({ items: [], nieuw: { id: 'n', duurMin: 120, vroegst: u(9, 0) }, ...inst });
  assert.deepEqual(r, { start: u(9, 0), eind: u(11, 0) });
  // na 16:00 is er vandaag geen plek meer
  assert.equal(plaatsNieuw({ items: [], nieuw: { id: 'n', duurMin: 120, vroegst: u(16, 5) }, ...inst }), null);
});

test('stopsVoorDag: twee eigen afspraken zonder id botsen niet', () => {
  const ev = (uur) => ({ datum: '2026-10-06', uur, adres: 'X' });
  const { allStops } = stopsVoorDag({ planning: {}, localEvents: [ev('14:00'), ev('09:00')] }, 'all', '2026-10-06', optiesRoute);
  assert.deepEqual(allStops.map(e => e.item.uur), ['09:00', '14:00']);
});

// ── eersteVrijeStart (B16): het eerste vrije uur voor "Toewijzen", zonder grens op maxPerDag ──
const evs = (items, extra = {}) => eersteVrijeStart({ items, duurMin: 120, vanTijd: '08:00', laatsteStart: '16:00', ...extra });

test('eersteVrijeStart: lege dag geeft vanTijd + reistijd', () => {
  assert.deepEqual(evs([]), { startMin: u(8, 30), laat: false });
  assert.deepEqual(evs([], { vanTijd: '10:00' }), { startMin: u(10, 30), laat: false });
});

test('eersteVrijeStart: een vast uur 08:30-10:30 duwt het voorstel naar 11:00 (reistijd inbegrepen)', () => {
  assert.deepEqual(evs([tk('a', '08:30')]), { startMin: u(11, 0), laat: false });
});

test('eersteVrijeStart: een gat tussen twee vaste stops waar het ticket past', () => {
  // a 08:00-09:00 (duur 60), b 15:00: nieuw 09:30-11:30 + 30 min rit = 12:00 <= 15:00
  assert.deepEqual(evs([tk('a', '08:00', 60), tk('b', '15:00', 60)]), { startMin: u(9, 30), laat: false });
});

test('eersteVrijeStart: een tijdvak-blokkering (soort blok) telt mee zonder reistijd', () => {
  // blok 08:30-10:30: nieuw start 08:30 botst, klok naar 10:30, aankomst 11:00 (reistijd enkel vanaf de klok)
  assert.deepEqual(evs([blok('b', '08:30', 120)]), { startMin: u(11, 0), laat: false });
  // blok 10:00-12:00: nieuw 08:30-10:30 botst; na het blok: 12:00 + 30 = 12:30
  assert.deepEqual(evs([blok('b', '10:00', 120)]), { startMin: u(12, 30), laat: false });
});

test('eersteVrijeStart: vroegst (vandaag 10:12) geeft niet vóór 10:42', () => {
  assert.deepEqual(evs([], { vroegst: u(10, 12) }).startMin, u(10, 42));
});

test('eersteVrijeStart: volle dag: startMin na laatsteStart met laat true', () => {
  const r = evs([tk('a', '08:30', 210), tk('b', '12:30', 210)]);
  assert.equal(r.laat, true);
  assert.ok(r.startMin > u(16, 0));
});

test('eersteVrijeStart: maxPerDag speelt geen rol', () => {
  const items = [tk('a', '08:30', 60), tk('b', '10:30', 60), tk('c', '12:30', 60), tk('d', '14:30', 60)];
  const r = eersteVrijeStart({ items, duurMin: 60, vanTijd: '08:00', laatsteStart: '18:00', maxPerDag: 1 });
  assert.equal(typeof r.startMin, 'number');
  assert.equal(r.startMin, u(16, 0)); // na stop d (15:30) + 30 min rit
  assert.equal(r.laat, false);
});
