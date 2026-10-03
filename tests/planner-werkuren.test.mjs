// Proefperiode-bug "ticket na werkuren" (Brent-besluit): het brein en de gedeelde plaatsingsregel (planner-tijdlijn.js) moeten
// hetzelfde zien. Vervangt tests/scratch-bug-werkuren.test.mjs. B1: de AANKOMST is hoogstens laatsteStart (16:00); het einde
// (aankomst + duur) wordt niet getoetst. Reistijd in deze tests: 30 min per rit, gelijk aan de terugval van "+" en de Route-tab.
process.env.TZ = 'Europe/Brussels';
import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeek } from '../public/js/planner.js';
import { leggDagUit } from '../public/js/planner-tijdlijn.js';
import { berekenAankomsten } from '../public/js/schermen/route-tijden.js';
import { stopsVoorDag } from '../public/js/kern/selecties.js';

const DAG = '2026-10-06'; // dinsdag
const INST = { vanTijd: '08:00', duurMinuten: 120, maxPerDag: 4, laatsteStart: '16:00', maxReistijdMin: 45 };
const loc = { lat: 51.2, lon: 4.4 };
const vast30 = async (van, naar) => new Map(naar.map(n => [n.id, 30]));
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

const kand = (id = 'nieuw', duurMin = 120) => ({ id, number: id, priority: 'High', interventieDatum: null, ...loc, duurMin });
const basis = (bestaand, extra = {}) => ({
  kandidaten: [kand()], dagen: [DAG], bestaandPerDag: { [DAG]: bestaand }, eigenAfspraken: {}, blokkeringen: {}, klant: {},
  instellingen: INST, depot: loc, vandaag: '2026-10-05', reistijden: vast30, ...extra,
});
const bez = (id, uur, duurMin) => ({ id, uur, duurMin, ...loc });

test('volle dag met twee vaste interventies (08:30-12:00, 12:30-16:00): niets meer geplaatst', async () => {
  const u = await planWeek(basis([bez('a', '08:30', 210), bez('b', '12:30', 210)]));
  assert.equal(u.geplaatst.length, 0);
  assert.equal(u.nietGepland[0].reden, 'geen-plaats');
});

test('volle dag met twee ketens zonder uur (elk 200 min): geen ticket dat pas na 16:00 aankomt', async () => {
  const u = await planWeek(basis([bez('a', null, 200), bez('b', null, 200)], { kandidaten: [kand('nieuw', 240)] }));
  // keten: 08:30-11:50, 12:20-15:40; nieuw zou om 16:10 aankomen: te laat
  assert.equal(u.geplaatst.length, 0);
});

test('grens: een aankomst om precies 16:00 mag (het einde 18:00 wordt niet getoetst)', async () => {
  // twee ketens van 120 min: 08:30-10:30 en 11:00-13:00; nieuw komt om 13:30. Met 3 ketens: 08:30, 11:00, 13:30-15:30; nieuw 16:00.
  const u = await planWeek(basis([bez('a', null, 120), bez('b', null, 120), bez('c', null, 120)]));
  assert.deepEqual(u.geplaatst.map(g => g.verwachteAankomst), ['16:00']);
});

test('een rustige dag: het brein kiest een goed uur (vroegste plek)', async () => {
  const u = await planWeek(basis([]));
  assert.deepEqual(u.geplaatst.map(g => g.verwachteAankomst), ['08:30']);
});

test('maxPerDag (4) blijft de bovengrens voor het brein: 4 bestaande = vol', async () => {
  const u = await planWeek(basis([bez('a', '08:30', 30), bez('b', '10:00', 30), bez('c', '11:30', 30), bez('d', '13:00', 30)]));
  assert.equal(u.geplaatst.length, 0);
});

// ── Gelijkloop brein / gedeelde regel (hypothese: brein ketent vanaf vanTijd, Route-tab zette ze achteraan) ──
test('gelijkloop: bestaande stop zonder uur naast een vast uur staat bij het brein op dezelfde plek als in de gedeelde regel', async () => {
  const bestaand = [bez('v', '10:50', 120), bez('a', null, 120)];
  const regel = leggDagUit({
    items: [
      { id: 'v', uur: '10:50', duurMin: 120, soort: 'stop', ticket: true },
      { id: 'a', uur: null, duurMin: 120, soort: 'stop', ticket: true },
      { id: 'nieuw', uur: null, duurMin: 120, soort: 'stop', ticket: true },
    ],
    vanTijd: '08:00', laatsteStart: '16:00', reisMin: 30,
  }).plaatsingen;
  const verwacht = regel.find(p => p.id === 'nieuw');
  assert.equal(verwacht.start, min('15:50'));
  const u = await planWeek(basis(bestaand));
  assert.deepEqual(u.geplaatst.map(g => g.verwachteAankomst), ['15:50']);
});

test('gelijkloop: de Route-tab (berekenAankomsten op stopsVoorDag) toont dezelfde aankomst voor dat ticket als het brein dacht', async () => {
  // Het ticket staat daarna zonder uur in de planning (enkel de dag wordt bewaard); de Route-tab rekent met 30 min per rit.
  const planning = { [DAG]: [
    { ticket: { id: 'v', assignee: 'Tim' }, uur: '10:50' }, { ticket: { id: 'a', assignee: 'Tim' }, uur: null }, { ticket: { id: 'nieuw', assignee: 'Tim' }, uur: null },
  ] };
  const duurVoor = () => 120;
  const { allStops } = stopsVoorDag({ planning, localEvents: [] }, 'all', DAG, { vanTijd: '08:00', laatsteStart: '16:00', duurVoor, werktijdMin: () => 60 });
  const { arrivalTimes } = berekenAankomsten(allStops, null, { vanTijd: '08:00', duurVoor, werktijdMin: () => 60 });
  const perId = Object.fromEntries(allStops.map((e, i) => [e.item.ticket.id, arrivalTimes[i]]));
  const u = await planWeek(basis([bez('v', '10:50', 120), bez('a', null, 120)]));
  assert.equal(perId.nieuw, min(u.geplaatst[0].verwachteAankomst));
  assert.equal(perId.a, min('13:20'));
});
