// tests/testdata.test.mjs — kern/testdata.js: de dummy-data van de testmodus, berekend vanaf een meegegeven `nu`.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakDummyData } from '../public/js/kern/testdata.js';

const NU = Date.parse('2026-10-05T09:00:00+02:00');
const DAG = 86400000;

test('maakDummyData: structuur en aantallen', () => {
  const d = maakDummyData(NU);
  assert.deepEqual(Object.keys(d), ['tickets', 'pendingTickets', 'plannedTickets']);
  assert.deepEqual(d.tickets.map(t => t.id), ['t1', 't2', 't3']);
  assert.deepEqual(d.pendingTickets.map(t => t.id), ['p1', 'p2']);
  assert.deepEqual(d.plannedTickets.map(t => t.id), ['g1']);
  assert.equal(d.tickets[0].number, '1001');
  assert.equal(d.plannedTickets[0].number, '1006');
});

test('maakDummyData: inPlanningSinds ligt 1, 10 en 25 dagen voor nu (enkel de te plannen tickets)', () => {
  const d = maakDummyData(NU);
  assert.deepEqual(d.tickets.map(t => Date.parse(t.inPlanningSinds)), [NU - 1 * DAG, NU - 10 * DAG, NU - 25 * DAG]);
  assert.ok(d.pendingTickets.every(t => !('inPlanningSinds' in t)));
  assert.ok(d.plannedTickets.every(t => !('inPlanningSinds' in t)));
});

test('maakDummyData: interventieDatum t1 -2, p1 +2, g1 +4 dagen; de rest null', () => {
  const d = maakDummyData(NU);
  assert.equal(Date.parse(d.tickets[0].interventieDatum), NU - 2 * DAG);
  assert.equal(Date.parse(d.pendingTickets[0].interventieDatum), NU + 2 * DAG);
  assert.equal(Date.parse(d.plannedTickets[0].interventieDatum), NU + 4 * DAG);
  assert.equal(d.tickets[1].interventieDatum, null);
  assert.equal(d.pendingTickets[1].interventieDatum, null);
});

test('maakDummyData: elke aanroep levert een nieuw object (geen gedeelde toestand)', () => {
  const a = maakDummyData(NU), b = maakDummyData(NU);
  assert.notEqual(a, b);
  a.tickets[0].subject = 'gewijzigd';
  assert.notEqual(b.tickets[0].subject, 'gewijzigd');
});
