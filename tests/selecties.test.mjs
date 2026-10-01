// tests/selecties.test.mjs — unit-tests voor kern/selecties.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  isAlle, persoonOfNull, ticketsVanTechnieker, planItemsVanTechnieker, eigenAfsprakenVoor, stopsVoorDag, blokkeringenVoor,
} from '../public/js/kern/selecties.js';

const tickets = [
  { id: 1, assignee: 'Tim' }, { id: 2, assignee: 'Sam' }, { id: 3, assignee: 'Tim' }, { id: 4, assignee: null },
];
const items = [
  { ticket: { id: 1, assignee: 'Tim' }, uur: '10:00' },
  { ticket: { id: 2, assignee: 'Sam' }, uur: '08:30' },
  { ticket: { id: 3, assignee: 'Tim' } },
];
const events = [
  { id: 'a', datum: '2026-10-05', persoon: 'Tim', adres: 'Straat 1', uur: '09:00' },
  { id: 'b', datum: '2026-10-05', persoon: 'Sam', notitie: 'bel eerst', uur: '14:00' },
  { id: 'c', datum: '2026-10-05', persoon: null, titel: 'Teamoverleg' },
  { id: 'd', datum: '2026-10-05', persoon: '', adres: 'Depot', uur: '07:00' },
  { id: 'e', datum: '2026-10-06', persoon: 'Tim', adres: 'Elders' },
];

test('isAlle / persoonOfNull', () => {
  assert.equal(isAlle('all'), true);
  assert.equal(isAlle('Tim'), false);
  assert.equal(persoonOfNull('all'), null);
  assert.equal(persoonOfNull('Tim'), 'Tim');
});

test('ticketsVanTechnieker: all = alles (nieuwe array), Tim = enkel Tim', () => {
  const alle = ticketsVanTechnieker(tickets, 'all');
  assert.deepEqual(alle, tickets);
  assert.notEqual(alle, tickets);
  assert.deepEqual(ticketsVanTechnieker(tickets, 'Tim').map(t => t.id), [1, 3]);
  assert.deepEqual(ticketsVanTechnieker(tickets, 'Niemand'), []);
  assert.deepEqual(ticketsVanTechnieker(undefined, 'Tim'), []);
});

test('planItemsVanTechnieker: filtert op ticket.assignee, zelfde objecten', () => {
  assert.equal(planItemsVanTechnieker(items, 'all').length, 3);
  const tim = planItemsVanTechnieker(items, 'Tim');
  assert.equal(tim.length, 2);
  assert.equal(tim[0], items[0]);
  assert.deepEqual(planItemsVanTechnieker(undefined, 'Tim'), []);
});

test('eigenAfsprakenVoor: ongetrouwde afspraken blijven bij een filter', () => {
  const tim = eigenAfsprakenVoor(events, '2026-10-05', 'Tim');
  assert.deepEqual(tim.map(e => e.id), ['a', 'c', 'd']);
  assert.deepEqual(eigenAfsprakenVoor(events, '2026-10-05', 'all').map(e => e.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(eigenAfsprakenVoor(events, '2026-10-06', 'Sam').map(e => e.id), []);
});

test('eigenAfsprakenVoor: alleenMetLocatie sluit events zonder adres en notitie uit', () => {
  assert.deepEqual(
    eigenAfsprakenVoor(events, '2026-10-05', 'all', { alleenMetLocatie: true }).map(e => e.id),
    ['a', 'b', 'd']
  );
  assert.deepEqual(
    eigenAfsprakenVoor(events, '2026-10-05', 'Sam', { alleenMetLocatie: true }).map(e => e.id),
    ['b', 'd']
  );
});

// Kopie van de oorspronkelijke functie uit index.html (vóór de migratie)
function oudStopsVoorDag(planning, localEvents, activeAssigneeFilter, date) {
  const stops = (planning[date] || []).filter(p =>
    activeAssigneeFilter === 'all' || p.ticket.assignee === activeAssigneeFilter
  );
  const localForDate = localEvents.filter(e =>
    e.datum === date && (e.adres || e.notitie) &&
    (activeAssigneeFilter === 'all' || !e.persoon || e.persoon === activeAssigneeFilter)
  );
  const allStops = [
    ...stops.map(s => ({ kind: 'ticket', item: s, uur: s.uur })),
    ...localForDate.map(e => ({ kind: 'local', item: e, uur: e.uur })),
  ].sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'));
  return { stops, localForDate, allStops };
}

test('stopsVoorDag is gelijk aan de oorspronkelijke functie (filters x datums)', () => {
  const planning = { '2026-10-05': items, '2026-10-06': [items[1]] };
  for (const filter of ['all', 'Tim', 'Sam', 'Niemand']) {
    for (const datum of ['2026-10-05', '2026-10-06', '2026-10-07']) {
      assert.deepEqual(
        stopsVoorDag({ planning, localEvents: events }, filter, datum),
        oudStopsVoorDag(planning, events, filter, datum),
        `${filter} ${datum}`
      );
    }
  }
});

test('stopsVoorDag: allStops gesorteerd op uur, ontbrekend uur achteraan ("99:99")', () => {
  const planning = { '2026-10-05': items };
  const { allStops } = stopsVoorDag({ planning, localEvents: events }, 'all', '2026-10-05');
  assert.deepEqual(allStops.map(s => s.uur), ['07:00', '08:30', '09:00', '10:00', '14:00', undefined]);
});

test('stopsVoorDag: verse wrappers, maar item is hetzelfde object (referentie)', () => {
  const planning = { '2026-10-05': items };
  const a = stopsVoorDag({ planning, localEvents: events }, 'all', '2026-10-05');
  const b = stopsVoorDag({ planning, localEvents: events }, 'all', '2026-10-05');
  assert.notEqual(a.allStops[0], b.allStops[0]);
  for (const s of a.allStops) {
    const bron = s.kind === 'ticket' ? items : events;
    assert.ok(bron.includes(s.item));
  }
  assert.equal(a.stops[0], items[0]);
  assert.equal(a.localForDate[0], events[0]);
});

test('stopsVoorDag: ontbrekende planning-datum geeft lege lijsten', () => {
  assert.deepEqual(stopsVoorDag({ planning: {}, localEvents: [] }, 'Tim', '2026-10-05'),
    { stops: [], localForDate: [], allStops: [] });
});

// ── blokkeringenVoor ──
const blokken = [
  { id: 'a', date: '2026-10-05', scope: 'global', person: null, kind: 'fullday' },
  { id: 'b', date: '2026-10-05', scope: 'person', person: 'Tim', kind: 'range', from: '09:00', to: '10:00' },
  { id: 'c', date: '2026-10-05', scope: 'person', person: 'Sam', kind: 'fullday' },
  { id: 'd', date: '2026-10-06', scope: 'global', person: null, kind: 'range', from: '08:00', to: '09:00' },
];
const ids = r => r.map(e => e.id);

test('blokkeringenVoor: globaal plus eigen persoon, andere personen en andere data niet', () => {
  assert.deepEqual(ids(blokkeringenVoor(blokken, '2026-10-05', 'Tim')), ['a', 'b']);
  assert.deepEqual(ids(blokkeringenVoor(blokken, '2026-10-05', 'Sam')), ['a', 'c']);
});

test("blokkeringenVoor: filter 'all' geeft enkel de globale", () => {
  assert.deepEqual(ids(blokkeringenVoor(blokken, '2026-10-05', 'all')), ['a']);
});

test('blokkeringenVoor: soort filtert op kind', () => {
  assert.deepEqual(ids(blokkeringenVoor(blokken, '2026-10-05', 'Tim', 'range')), ['b']);
  assert.deepEqual(ids(blokkeringenVoor(blokken, '2026-10-05', 'Tim', 'fullday')), ['a']);
});

test('blokkeringenVoor: lege of ontbrekende invoer geeft een lege array', () => {
  assert.deepEqual(blokkeringenVoor([], '2026-10-05', 'Tim'), []);
  assert.deepEqual(blokkeringenVoor(undefined, '2026-10-05', 'Tim'), []);
  assert.deepEqual(blokkeringenVoor(blokken, '2030-01-01', 'Tim'), []);
});
