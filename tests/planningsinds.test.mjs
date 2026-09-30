import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAJECT, berekenSinds, volgendePaginaNodig, leesRegister, schrijfRegister } from '../netlify/lib/planningsinds.js';

const ev = (eventTime, van, naar) => ({
  eventName: 'TicketUpdated',
  eventTime,
  eventInfo: [{ propertyName: 'Status', propertyValue: { previousValue: van, updatedValue: naar, type: 'Text' }, propertyType: 'ValueTransition' }],
});

test('berekenSinds: patroon ticket 3638', () => {
  const events = [
    ev('2026-09-30T13:33:36.000Z', 'Wachten op planning', 'Wachten op bevestiging planning'),
    ev('2026-09-29T08:13:43.000Z', 'Wachten op klant', 'Wachten op planning'),
    ev('2026-09-29T08:13:31.000Z', 'Open', 'Wachten op klant'),
    ev('2026-09-26T09:49:42.000Z', 'Gesloten', 'Open'),
  ];
  assert.equal(berekenSinds(events, '2026-06-29T17:07:44.000Z'), '2026-09-29T08:13:43.000Z');
});

test('berekenSinds: nooit uit traject -> createdTime', () => {
  const events = [ev('2026-09-02T10:00:00.000Z', 'Wachten op planning', 'Geplande service')];
  assert.equal(berekenSinds(events, '2026-06-29T17:07:44.000Z'), '2026-06-29T17:07:44.000Z');
  assert.equal(berekenSinds([], '2026-06-29T17:07:44.000Z'), '2026-06-29T17:07:44.000Z');
  assert.equal(berekenSinds([], undefined), null);
});

test('berekenSinds: terugkeer na Wachten op klant -> laatste instap', () => {
  const events = [
    ev('2026-09-20T10:00:00.000Z', 'Wachten op klant', 'Wachten op planning'),
    ev('2026-09-10T10:00:00.000Z', 'Wachten op planning', 'Wachten op klant'),
    ev('2026-09-01T10:00:00.000Z', 'Open', 'Wachten op planning'),
  ];
  assert.equal(berekenSinds(events, '2026-06-01T00:00:00.000Z'), '2026-09-20T10:00:00.000Z');
});

test('berekenSinds: bevestiging -> terug naar te plannen telt door', () => {
  const events = [
    ev('2026-09-25T10:00:00.000Z', 'Wachten op bevestiging planning', 'Wachten op planning'),
    ev('2026-09-22T10:00:00.000Z', 'Wachten op planning', 'Wachten op bevestiging planning'),
    ev('2026-09-15T10:00:00.000Z', 'Open', 'Wachten op planning'),
  ];
  assert.equal(berekenSinds(events, '2026-06-01T00:00:00.000Z'), '2026-09-15T10:00:00.000Z');
});

test('berekenSinds: items zonder Status-transitie worden genegeerd', () => {
  const ander = { eventName: 'TicketUpdated', eventTime: '2026-09-28T00:00:00.000Z',
    eventInfo: [{ propertyName: 'Priority', propertyValue: { previousValue: 'Low', updatedValue: 'High' } }] };
  const events = [ander, { eventTime: 'x' }, ev('2026-09-15T10:00:00.000Z', 'Open', 'Wachten op planning')];
  assert.equal(berekenSinds(events, '2026-06-01T00:00:00.000Z'), '2026-09-15T10:00:00.000Z');
});

test('TRAJECT bevat de vijf statussen', () => {
  assert.equal(TRAJECT.length, 5);
  assert.ok(TRAJECT.includes('Wachten op planning'));
});

test('volgendePaginaNodig: 50 events zonder verlaat-event -> true', () => {
  const events = Array.from({ length: 50 }, () =>
    ev('2026-09-10T10:00:00.000Z', 'Wachten op planning', 'Wachten op bevestiging planning'));
  assert.equal(volgendePaginaNodig(events, 50), true);
});

test('volgendePaginaNodig: verlaat-event gevonden of minder dan een volle pagina -> false', () => {
  const events = Array.from({ length: 50 }, () => ev('2026-09-10T10:00:00.000Z', 'Wachten op planning', 'Geplande service'));
  events[10] = ev('2026-09-01T10:00:00.000Z', 'Open', 'Wachten op planning');
  assert.equal(volgendePaginaNodig(events, 50), false);
  const kort = Array.from({ length: 3 }, () => ev('2026-09-10T10:00:00.000Z', 'Wachten op planning', 'Geplande service'));
  assert.equal(volgendePaginaNodig(kort, 50), false);
});

function nepStore(init = {}) {
  const data = { ...init };
  return {
    data,
    async get(k) { return k in data ? data[k] : null; },
    async setJSON(k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
  };
}

test('leesRegister: kapotte blob -> {}', async () => {
  const kapot = { async get() { throw new Error('kapot'); } };
  assert.deepEqual(await leesRegister(kapot), {});
  assert.deepEqual(await leesRegister(nepStore()), {});
  assert.deepEqual(await leesRegister(nepStore({ 'planning-sinds': 'onzin' })), {});
});

test('schrijfRegister / leesRegister: rondreis op sleutel planning-sinds', async () => {
  const store = nepStore();
  await schrijfRegister(store, { 3638: { sinds: '2026-09-29T08:13:43.000Z' } });
  assert.ok('planning-sinds' in store.data);
  assert.deepEqual(await leesRegister(store), { 3638: { sinds: '2026-09-29T08:13:43.000Z' } });
});
