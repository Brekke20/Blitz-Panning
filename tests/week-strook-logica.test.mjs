process.env.TZ = 'Europe/Brussels';
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekstrookDagen, weekstrookVerschuif, isoNaarDatum, WEEKSTROOK_DAG } from '../public/js/schermen/week-strook-logica.js';
import { weekDagInfo } from '../public/js/schermen/sales-route-logica.js';
import { localISO } from '../public/js/kern/tijd.js';

const isos = (datum, werkdagen) => weekstrookDagen(datum, werkdagen).dagen.map(localISO);

test('weekstrookDagen: ma tot vr van de week van de gekozen dag (standaard)', () => {
  assert.deepEqual(isos('2026-10-07'), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.equal(localISO(weekstrookDagen('2026-10-07').maandag), '2026-10-05');
});

test('weekstrookDagen: een zondag hoort bij de week ervoor, een maandag bij zijn eigen week', () => {
  assert.equal(localISO(weekstrookDagen('2026-10-11').maandag), '2026-10-05');
  assert.equal(localISO(weekstrookDagen('2026-10-12').maandag), '2026-10-12');
});

test('weekstrookDagen: enkel de werkdagen uit de instellingen (getDay-nummers), op volgorde', () => {
  assert.deepEqual(isos('2026-10-07', [1, 2, 3]), ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.deepEqual(isos('2026-10-07', [6, 1]), ['2026-10-05', '2026-10-10']);
  assert.deepEqual(isos('2026-10-07', []), []);
});

test('weekstrookDagen: over een maand- en jaargrens heen', () => {
  assert.deepEqual(isos('2026-12-31'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01']);
});

test('weekstrookVerschuif: dagen erbij of eraf, ook over de zomertijdwissel (25 okt 2026)', () => {
  assert.equal(weekstrookVerschuif('2026-10-05', 7), '2026-10-12');
  assert.equal(weekstrookVerschuif('2026-10-26', -7), '2026-10-19');
  assert.equal(weekstrookVerschuif('2026-10-21', 7), '2026-10-28');
  assert.equal(weekstrookVerschuif('2026-12-28', 7), '2027-01-04');
});

test('namen van de dagen volgen getDay (zondag eerst)', () => {
  assert.equal(WEEKSTROOK_DAG[isoNaarDatum('2026-10-05').getDay()], 'MA');
  assert.equal(WEEKSTROOK_DAG[isoNaarDatum('2026-10-11').getDay()], 'ZO');
});

const lead = (id, status, datum, start, vast = false) => ({ id, voornaam: 'Test', naam: id, status, planning: { datum, start, vast }, locatie: null });

test('weekDagInfo: leeg, te bevestigen en bevestigd (zelfde vorm als de strook van de technieker)', () => {
  const leads = [
    lead('a', 'voorgesteld', '2026-10-05', '09:00'), lead('b', 'bevestigd', '2026-10-05', '10:30', true),
    lead('c', 'bevestigd', '2026-10-06', '09:00', true),
    { id: 'd', voornaam: 'Test', naam: 'd', status: 'te-plannen' },
    lead('e', 'afgewerkt', '2026-10-07', '09:00', true),
  ];
  assert.deepEqual(weekDagInfo(leads, '2026-10-05'), { klasse: 'nodig', status: '☎ bevestigen', aantal: '2 bezoeken', aria: '2 bezoeken, 1 te bevestigen' });
  assert.deepEqual(weekDagInfo(leads, '2026-10-06'), { klasse: 'klaar', status: '✓ bevestigd', aantal: '1 bezoek', aria: '1 bezoek, alle bezoeken bevestigd' });
  assert.deepEqual(weekDagInfo(leads, '2026-10-07'), { klasse: 'leeg', status: '—', aantal: '0 bezoeken', aria: '0 bezoeken, niets gepland' });
  assert.deepEqual(weekDagInfo([], '2026-10-05').klasse, 'leeg');
  assert.deepEqual(weekDagInfo(undefined, '2026-10-05').klasse, 'leeg');
});
