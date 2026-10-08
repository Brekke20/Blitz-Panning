import test from 'node:test';
import assert from 'node:assert/strict';
import { bouwKalenderItems, maandChips, tintVan } from '../public/js/schermen/sales-kalender-logica.js';
import { bepaalLanes } from '../public/js/schermen/kalender-logica.js';

// Verzonnen leads en blokken.
const lead = (id, status, datum, start, extra = {}) => ({
  id, voornaam: 'Marie', naam: 'Janssens ' + id, postcode: '3500', gemeente: 'Hasselt', status,
  ...(datum ? { planning: { datum, start, vast: status === 'bevestigd' } } : {}), ...extra,
});
const DAG = '2026-10-12';

test('tintVan: bevestigd bij isVast, anders voorgesteld', () => {
  assert.equal(tintVan(lead('a', 'voorgesteld', DAG, '09:00')), 'voorgesteld');
  assert.equal(tintVan(lead('b', 'bevestigd', DAG, '09:00')), 'bevestigd');
  assert.equal(tintVan(lead('c', 'voorgesteld', DAG, '09:00', { planning: { datum: DAG, start: '09:00', vast: true } })), 'bevestigd');
});

test('bouwKalenderItems: enkel voorgesteld en bevestigd van die dag, plus blokken van die dag', () => {
  const leads = [
    lead('v', 'voorgesteld', DAG, '09:00'),
    lead('b', 'bevestigd', DAG, '14:00'),
    lead('tp', 'te-plannen'),
    lead('af', 'afgewerkt', null, null, { resultaat: { soort: 'offerte', op: '2026-10-01T10:00:00.000Z' } }),
    lead('anders', 'voorgesteld', '2026-10-13', '09:00'),
  ];
  const blokken = [
    { id: 'k', datum: DAG, start: '11:00', eind: '12:00', soort: 'kantoor', omschrijving: 'Teamoverleg' },
    { id: 'x', datum: '2026-10-14', start: '11:00', eind: '12:00', soort: 'kantoor' },
  ];
  const items = bouwKalenderItems({ leads, blokken, datum: DAG, standaardDuurMin: 60 });
  assert.deepEqual(items.map((i) => i.id), ['v', 'k', 'b']);
  assert.deepEqual(items.map((i) => i.type), ['bezoek', 'blok', 'bezoek']);
});

test('bouwKalenderItems: tint, titel en eindtijd uit duurMin of standaard', () => {
  const leads = [lead('v', 'voorgesteld', DAG, '09:00'), lead('b', 'bevestigd', DAG, '14:00', { duurMin: 90 })];
  const [v, b] = bouwKalenderItems({ leads, blokken: [], datum: DAG, standaardDuurMin: 45 });
  assert.equal(v.tint, 'voorgesteld');
  assert.equal(v.titel, 'Marie Janssens v');
  assert.equal(v.startMin, 540);
  assert.equal(v.endMin, 585);       // standaard 45
  assert.equal(b.tint, 'bevestigd');
  assert.equal(b.startMin, 840);
  assert.equal(b.endMin, 930);       // duurMin 90
});

test('bouwKalenderItems: een hele-dag blok loopt van 0 tot 1440', () => {
  const blokken = [{ id: 'v', datum: DAG, start: '00:00', eind: '23:59', soort: 'verlof' }];
  const [item] = bouwKalenderItems({ leads: [], blokken, datum: DAG, standaardDuurMin: 60 });
  assert.equal(item.startMin, 0);
  assert.equal(item.endMin, 1440);
  assert.equal(item.heleDag, true);
  assert.equal(item.titel, 'Verlof');
});

test('bouwKalenderItems: gewone blokken, titel uit omschrijving of soort', () => {
  const blokken = [
    { id: 'a', datum: DAG, start: '10:00', eind: '11:30', soort: 'afspraak', omschrijving: 'Tandarts' },
    { id: 'b', datum: DAG, start: '13:00', eind: '14:00', soort: 'kantoor' },
  ];
  const items = bouwKalenderItems({ leads: [], blokken, datum: DAG, standaardDuurMin: 60 });
  assert.deepEqual(items.map((i) => [i.titel, i.startMin, i.endMin, i.heleDag]), [['Tandarts', 600, 690, false], ['Kantoor', 780, 840, false]]);
  assert.ok(items.every((i) => i.tint === 'blok'));
});

test('bouwKalenderItems: de uitvoer gaat ongewijzigd door bepaalLanes', () => {
  const leads = [lead('a', 'voorgesteld', DAG, '09:00'), lead('b', 'bevestigd', DAG, '09:30')];
  const items = bepaalLanes(bouwKalenderItems({ leads, blokken: [], datum: DAG, standaardDuurMin: 60 }));
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.laneCount === 2));
  assert.deepEqual(items.map((i) => i.lane).sort(), [0, 1]);
});

test('bouwKalenderItems: lead zonder planning of uur wordt overgeslagen, ontbrekende lijsten zijn leeg', () => {
  const kapot = lead('k', 'voorgesteld', null, null);
  assert.deepEqual(bouwKalenderItems({ leads: [kapot], blokken: undefined, datum: DAG, standaardDuurMin: 60 }), []);
  assert.deepEqual(bouwKalenderItems({ datum: DAG, standaardDuurMin: 60 }), []);
});

test('maandChips: groepeert per datum, op uur gesorteerd, enkel binnen het maandraster', () => {
  const leads = [
    lead('b', 'bevestigd', '2026-10-12', '14:00'),
    lead('v', 'voorgesteld', '2026-10-12', '09:00'),
    lead('o', 'voorgesteld', '2026-10-20', '10:00'),
    lead('ver', 'voorgesteld', '2027-03-01', '10:00'),   // buiten het raster van oktober
    lead('tp', 'te-plannen'),
  ];
  const blokken = [
    { id: 'h', datum: '2026-10-12', start: '00:00', eind: '23:59', soort: 'verlof' },
    { id: 'k', datum: '2026-10-12', start: '11:00', eind: '12:00', soort: 'kantoor', omschrijving: 'Overleg' },
  ];
  const chips = maandChips({ leads, blokken, datum: '2026-10-08' });
  assert.deepEqual(Object.keys(chips).sort(), ['2026-10-12', '2026-10-20']);
  assert.deepEqual(chips['2026-10-12'], [
    { label: 'Verlof', tint: 'blok' },
    { label: '09:00 Marie Janssens v', tint: 'voorgesteld' },
    { label: '11:00 Overleg', tint: 'blok' },
    { label: '14:00 Marie Janssens b', tint: 'bevestigd' },
  ]);
  assert.deepEqual(chips['2026-10-20'], [{ label: '10:00 Marie Janssens o', tint: 'voorgesteld' }]);
});

test('maandChips: leeg zonder leads en blokken', () => {
  assert.deepEqual(maandChips({ datum: '2026-10-08' }), {});
});
