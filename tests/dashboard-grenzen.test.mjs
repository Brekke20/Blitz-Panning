import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RING_METRICS, STANDAARD_GRENZEN, valideerGrenzen, statusVoor } from '../public/js/kern/dashboard-grenzen.js';

test('standaard heeft voor elke ringmetric een rij', () => {
  assert.deepEqual(RING_METRICS, ['opTijd', 'firstTimeFix', 'bevestigdViaKnop', 'garantie', 'metInstallateur']);
  for (const s of RING_METRICS) assert.ok(STANDAARD_GRENZEN[s], s);
});

test('statusVoor opTijd beslist op het afgeronde getal', () => {
  assert.equal(statusVoor('opTijd', 90), 'goed');
  assert.equal(statusVoor('opTijd', 89.4), 'aandacht'); // toont 89
  assert.equal(statusVoor('opTijd', 89.6), 'goed');     // toont 90
  assert.equal(statusVoor('opTijd', 75), 'aandacht');
  assert.equal(statusVoor('opTijd', 74.4), 'slecht');    // toont 74
});

test('statusVoor firstTimeFix', () => {
  assert.equal(statusVoor('firstTimeFix', 80), 'goed');
  assert.equal(statusVoor('firstTimeFix', 64.9), 'aandacht'); // toont 65
});

test('statusVoor zonder grenzen is neutraal; zonder gegevens null', () => {
  assert.equal(statusVoor('metInstallateur', 50), 'neutraal');
  assert.equal(statusVoor('opTijd', null), null);
  assert.equal(statusVoor('opTijd', undefined), null);
  assert.equal(statusVoor('opTijd', NaN), null);
});

test('statusVoor richting laag: laag is goed', () => {
  const g = { garantie: { groen: 5, oranje: 10, richting: 'laag' } };
  assert.equal(statusVoor('garantie', 3, g), 'goed');
  assert.equal(statusVoor('garantie', 7, g), 'aandacht');
  assert.equal(statusVoor('garantie', 12, g), 'slecht');
});

test('valideerGrenzen: lege invoer geeft de standaard', () => {
  const r = valideerGrenzen({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.waarde, STANDAARD_GRENZEN);
  assert.notEqual(r.waarde, STANDAARD_GRENZEN); // kopie, niet de constante zelf
});

test('valideerGrenzen: eigen waarden worden overgenomen, de rest aangevuld', () => {
  const r = valideerGrenzen({ opTijd: { groen: 95, oranje: 80, richting: 'hoog' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.waarde.opTijd, { groen: 95, oranje: 80, richting: 'hoog' });
  assert.deepEqual(r.waarde.firstTimeFix, STANDAARD_GRENZEN.firstTimeFix);
});

test('valideerGrenzen: hoog eist groen >= oranje, laag eist groen <= oranje', () => {
  assert.equal(valideerGrenzen({ opTijd: { groen: 70, oranje: 80, richting: 'hoog' } }).ok, false);
  assert.equal(valideerGrenzen({ garantie: { groen: 10, oranje: 5, richting: 'laag' } }).ok, false);
  assert.equal(valideerGrenzen({ garantie: { groen: 5, oranje: 10, richting: 'laag' } }).ok, true);
  assert.equal(valideerGrenzen({ opTijd: { groen: 80, oranje: 80, richting: 'hoog' } }).ok, true);
});

test('valideerGrenzen: groen en oranje samen null of samen een getal', () => {
  const r = valideerGrenzen({ opTijd: { groen: 90, oranje: null } });
  assert.equal(r.ok, false);
  assert.equal(typeof r.fout, 'string');
  assert.equal(valideerGrenzen({ opTijd: { groen: null, oranje: 75 } }).ok, false);
  assert.equal(valideerGrenzen({ opTijd: { groen: null, oranje: null } }).ok, true);
});

test('valideerGrenzen: getallen 0-100, geen tekst', () => {
  assert.equal(valideerGrenzen({ opTijd: { groen: 101, oranje: 75 } }).ok, false);
  assert.equal(valideerGrenzen({ opTijd: { groen: 90, oranje: -1 } }).ok, false);
  assert.equal(valideerGrenzen({ opTijd: { groen: 'abc', oranje: 75 } }).ok, false);
  assert.equal(valideerGrenzen({ opTijd: { groen: 100, oranje: 0 } }).ok, true);
});

test('valideerGrenzen: onzin als invoer of als richting is ongeldig', () => {
  assert.equal(valideerGrenzen(null).ok, false);
  assert.equal(valideerGrenzen('x').ok, false);
  assert.equal(valideerGrenzen({ opTijd: 5 }).ok, false);
  assert.equal(valideerGrenzen({ opTijd: { groen: 90, oranje: 75, richting: 'zijwaarts' } }).ok, false);
});
