import test from 'node:test';
import assert from 'node:assert/strict';
import { optimaliseerDag, kiesLeegTeMaken, kortsteVolgorde, DEPOT_ID } from '../public/js/schermen/sales-route-optimaliseer.js';
import { bouwRouteStops } from '../public/js/schermen/sales-route-logica.js';
import { ritMetMarge } from '../public/js/sales/planner-adapter.js';

const DAG = '2026-10-12';
// Punten op een rechte lijn (x = kilometers oostwaarts); een rit van 1 km = 1 minuut, zodat de verwachte uitkomsten leesbaar blijven.
const punt = (x) => ({ lat: 50, lon: 5 + x * 0.014 }); // enkel gebruikt voor de aanwezigheid van een locatie; de ritten komen uit `rit`
const lead = (id, x, start, extra = {}) => ({
  id, voornaam: 'T', naam: id, postcode: '3500', gemeente: 'Hasselt', status: 'voorgesteld', duurMin: 30,
  planning: { datum: DAG, start, vast: false }, locatie: { ...punt(x), bron: 'adres', x }, ...extra,
});
const vast = (id, x, start) => lead(id, x, start, { status: 'bevestigd', planning: { datum: DAG, start, vast: true } });
const xVan = (leads) => new Map([[DEPOT_ID, 0], ...leads.map((l) => [l.id, l.locatie.x])]);
// rit(a,b) = |x_a - x_b| minuten
const maakRit = (leads) => { const x = xVan(leads); return (a, b) => Math.abs(x.get(a) - x.get(b)); };
const bereken = (leads, extra = {}) => optimaliseerDag({
  stops: bouwRouteStops(leads, DAG), depot: punt(0), rit: maakRit(leads), vanTijd: '08:00', laatsteStart: '16:00', ...extra,
});

test('kortsteVolgorde: de kortste open route vanaf het depot; een enkel bezoek blijft staan', () => {
  const items = [['a', 10], ['b', 2], ['c', 6]].map(([id, x]) => ({ id, locatie: punt(x), x }));
  const depot = { id: DEPOT_ID, locatie: punt(0), x: 0 };
  const rit = (p, q) => Math.abs(p.x - q.x);
  assert.deepEqual(kortsteVolgorde(items, depot, rit).map((i) => i.id), ['b', 'c', 'a']);
  assert.deepEqual(kortsteVolgorde(items.slice(0, 1), depot, rit).map((i) => i.id), ['a']);
});

test('kortsteVolgorde: meer dan 8 bezoeken geeft ook de kortste route op een lijn', () => {
  const xs = [9, 1, 7, 3, 5, 2, 8, 4, 6, 10];
  const items = xs.map((x, i) => ({ id: `p${i}`, locatie: punt(x), x }));
  const orde = kortsteVolgorde(items, { id: DEPOT_ID, locatie: punt(0), x: 0 }, (a, b) => Math.abs(a.x - b.x));
  assert.deepEqual(orde.map((i) => i.x), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('optimaliseerDag: de verschuifbare bezoeken krijgen de kortste volgorde en nieuwe tijden vanaf de werkdagstart (met de reismarge)', () => {
  // Nu: ver (x=10) om 09:00, dichtbij (x=2) om 10:00, midden (x=6) om 11:00. Kortste route: 2 -> 6 -> 10.
  const leads = [lead('ver', 10, '09:00'), lead('dichtbij', 2, '10:00'), lead('midden', 6, '11:00')];
  const r = bereken(leads);
  assert.equal(r.ok, true);
  assert.deepEqual(r.volgorde.map((v) => v.leadId), ['dichtbij', 'midden', 'ver']);
  // vertrek 08:00; rit 2 min + marge: ceil(2*1.1+2)=5 -> 08:05 -> afgerond 08:05; einde 08:35; rit 4 -> ceil(4*1.1+2)=7 -> 08:42 -> 08:45; einde 09:15; rit 4 -> 7 -> 09:22 -> 09:25
  assert.equal(ritMetMarge(2), 5);
  assert.deepEqual(r.volgorde.map((v) => v.start), ['08:05', '08:45', '09:25']);
  assert.equal(r.volgordeGewijzigd, true);
  assert.equal(r.wijzigingen.length, 3);
  assert.ok(r.rijtijdNa < r.rijtijdVoor, `rijtijd ${r.rijtijdVoor} -> ${r.rijtijdNa}`);
  assert.equal(r.rijtijdNa, 10); // 0 -> 2 -> 6 -> 10
  assert.equal(r.rijtijdVoor, 10 + 8 + 4); // 0 -> 10 -> 2 -> 6
});

test('optimaliseerDag: een vast bezoek blijft op zijn uur staan, de rest wordt eromheen geplaatst', () => {
  // Het vaste bezoek (x=6) staat om 10:00 en blijft staan; twee vrije bezoeken (x=2 en x=10) worden herordend.
  const leads = [lead('ver', 10, '08:00'), lead('dichtbij', 2, '09:00'), vast('vast', 6, '10:00')];
  const r = bereken(leads);
  assert.equal(r.ok, true);
  const vastRij = r.volgorde.find((v) => v.leadId === 'vast');
  assert.equal(vastRij.start, '10:00');
  assert.equal(vastRij.vast, true);
  assert.equal(vastRij.verschoven, false);
  assert.equal(r.wijzigingen.some((w) => w.leadId === 'vast'), false); // een vast bezoek komt nooit in de wijzigingen
  // dichtbij 08:05 (einde 08:35), ver 08:50 (rit 8 min + marge 11 -> 08:46 -> 08:50), vast blijft 10:00
  assert.deepEqual(r.volgorde.map((v) => [v.leadId, v.start]), [['dichtbij', '08:05'], ['ver', '08:50'], ['vast', '10:00']]);
});

test('optimaliseerDag: een vrij bezoek dat niet voor het vaste uur past, komt erna', () => {
  // Het vaste bezoek staat om 08:10: er is geen ruimte voor een bezoek van 30 min ervoor, dus beide vrije bezoeken komen na 08:40.
  const leads = [lead('a', 4, '09:00'), lead('b', 3, '10:00'), vast('v', 8, '08:10')];
  const r = bereken(leads);
  assert.equal(r.ok, true);
  assert.equal(r.volgorde[0].leadId, 'v');
  assert.equal(r.volgorde[0].start, '08:10');
  const tijden = Object.fromEntries(r.volgorde.map((v) => [v.leadId, v.start]));
  assert.ok(tijden.a >= '08:40' && tijden.b >= '08:40');
});

test('optimaliseerDag: vaste bezoeken blijven gelijk en de vrije bezoeken botsen er niet mee (geen overlap)', () => {
  const leads = [lead('a', 9, '08:00'), lead('b', 1, '08:30'), lead('c', 5, '09:00'), vast('v1', 3, '09:30'), vast('v2', 7, '12:00')];
  const r = bereken(leads);
  assert.equal(r.ok, true);
  assert.equal(r.volgorde.find((v) => v.leadId === 'v1').start, '09:30');
  assert.equal(r.volgorde.find((v) => v.leadId === 'v2').start, '12:00');
  const stops = r.volgorde.map((v) => ({ id: v.leadId, start: v.start }));
  const min = (u) => Number(u.slice(0, 2)) * 60 + Number(u.slice(3));
  const gesorteerd = stops.slice().sort((p, q) => min(p.start) - min(q.start));
  for (let i = 1; i < gesorteerd.length; i++) assert.ok(min(gesorteerd[i].start) >= min(gesorteerd[i - 1].start) + 30, `${gesorteerd[i - 1].id} en ${gesorteerd[i].id} overlappen`);
});

test('optimaliseerDag: minder dan 2 verschuifbare bezoeken -> te-weinig', () => {
  assert.deepEqual(bereken([lead('a', 1, '09:00'), vast('v', 2, '10:00')]), { ok: false, reden: 'te-weinig' });
  assert.deepEqual(bereken([]), { ok: false, reden: 'te-weinig' });
});

test('optimaliseerDag: een bezoek dat na het laatste startuur zou beginnen -> te-laat, niets te wijzigen', () => {
  const leads = [lead('a', 1, '09:00'), lead('b', 2, '10:00')];
  const r = bereken(leads, { vanTijd: '16:00', laatsteStart: '16:00' });
  assert.equal(r.ok, false);
  assert.equal(r.reden, 'te-laat');
  assert.equal(r.laatsteStart, '16:00');
});

test('optimaliseerDag: zonder depot begint het eerste bezoek op de werkdagstart; zonder locatie komt een bezoek achteraan', () => {
  const leads = [lead('zonder', 0, '08:00', { locatie: null }), lead('b', 5, '09:00'), lead('a', 1, '10:00')];
  const r = optimaliseerDag({ stops: bouwRouteStops(leads, DAG), depot: null, rit: (a, b) => Math.abs((a === 'a' ? 1 : 5) - (b === 'a' ? 1 : 5)), vanTijd: '08:30', laatsteStart: '16:00' });
  assert.equal(r.ok, true);
  assert.equal(r.volgorde.at(-1).leadId, 'zonder');
  assert.equal(r.volgorde[0].start, '08:30');
});

test('optimaliseerDag: een ontbrekende reistijd valt terug op de schatting van de route (geen fout)', () => {
  const leads = [lead('a', 1, '09:00'), lead('b', 2, '10:00')];
  const r = optimaliseerDag({ stops: bouwRouteStops(leads, DAG), depot: punt(0), rit: () => null, vanTijd: '08:00', laatsteStart: '16:00' });
  assert.equal(r.ok, true);
  assert.equal(r.volgorde.length, 2);
});

test('optimaliseerDag: een al optimale dag verandert niets aan de volgorde', () => {
  const leads = [lead('a', 2, '08:05'), lead('b', 6, '08:45'), lead('c', 10, '09:25')];
  const r = bereken(leads);
  assert.equal(r.ok, true);
  assert.equal(r.volgordeGewijzigd, false);
  assert.deepEqual(r.wijzigingen, []);
});

test('kiesLeegTeMaken: enkel de niet-vaste bezoeken van die dag; de vaste worden geteld', () => {
  const leads = [
    lead('a', 1, '09:00'), lead('b', 2, '10:00'), vast('v', 3, '11:00'),
    lead('vastgezet', 4, '12:00', { planning: { datum: DAG, start: '12:00', vast: true } }), // voorgesteld maar vastgezet uur: vast
    lead('andere-dag', 5, '09:00', { planning: { datum: '2026-10-13', start: '09:00', vast: false } }),
    { id: 'tp', status: 'te-plannen', voornaam: 'E', naam: 'M' },
    lead('afgewerkt', 6, '09:00', { status: 'afgewerkt' }),
  ];
  assert.deepEqual(kiesLeegTeMaken(leads, DAG), { vrij: ['a', 'b'], vast: 2 });
  assert.deepEqual(kiesLeegTeMaken([], DAG), { vrij: [], vast: 0 });
  assert.deepEqual(kiesLeegTeMaken(leads, '2030-01-01'), { vrij: [], vast: 0 });
});
