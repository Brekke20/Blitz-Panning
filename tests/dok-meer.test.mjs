// Open dag, taak 6: de verdeling van de tabbladen over het dok en het "Meer"-blad (puur, schermen/dok-meer-logica.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dokVerdeling } from '../public/js/schermen/dok-meer-logica.js';

test('vijf of minder tabs: alles in het dok, geen Meer', () => {
  assert.deepEqual(dokVerdeling(['a', 'b', 'c', 'd', 'e'], 'a'), { inDok: ['a', 'b', 'c', 'd', 'e'], inMeer: [], meerActief: false });
  assert.deepEqual(dokVerdeling(['a', 'b'], 'b'), { inDok: ['a', 'b'], inMeer: [], meerActief: false });
});

test('zes tabs: vier in het dok, de rest in Meer; een actieve tab in Meer maakt Meer actief', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(dokVerdeling(ids, 'f'), { inDok: ['a', 'b', 'c', 'd'], inMeer: ['e', 'f'], meerActief: true });
  assert.deepEqual(dokVerdeling(ids, 'a'), { inDok: ['a', 'b', 'c', 'd'], inMeer: ['e', 'f'], meerActief: false });
  assert.deepEqual(dokVerdeling(ids, null), { inDok: ['a', 'b', 'c', 'd'], inMeer: ['e', 'f'], meerActief: false });
});

test('de standaard max is 5; een eigen max verschuift de grens', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.equal(dokVerdeling(ids, null).inDok.length, 4);
  assert.deepEqual(dokVerdeling(ids, 'g', 4), { inDok: ['a', 'b', 'c'], inMeer: ['d', 'e', 'f', 'g'], meerActief: true });
});

test('een lege lijst geeft twee lege lijsten', () => {
  assert.deepEqual(dokVerdeling([], null), { inDok: [], inMeer: [], meerActief: false });
  assert.deepEqual(dokVerdeling([], 'a'), { inDok: [], inMeer: [], meerActief: false });
});

// Taak 18: het bolletje op "Meer" volgt de zichtbare tellers van de tabs achter Meer (rood boven oranje boven gewoon).
import { meerBolletje, meerBolletjeLabel } from '../public/js/schermen/dok-meer-logica.js';

const teller = (tekst, extra = {}) => ({ tekst, verborgen: false, op: false, bijna: false, ...extra });

test('bolletje: geen tellers achter Meer, geen bolletje', () => {
  assert.equal(meerBolletje([]), null);
  assert.equal(meerBolletje(undefined), null);
  assert.equal(meerBolletje([null]), null); // een tab zonder teller
});

test('bolletje: een lege, verborgen of nul-teller telt niet mee', () => {
  assert.equal(meerBolletje([teller('0')]), null);
  assert.equal(meerBolletje([teller('')]), null);
  assert.equal(meerBolletje([teller('  ')]), null);
  assert.equal(meerBolletje([teller('3', { verborgen: true })]), null);
  assert.equal(meerBolletje([teller('0', { op: true })]), null, 'een nul blijft nul, ook met een statusklasse');
});

test('bolletje: een gewone teller geeft de gewone kleur', () => {
  assert.equal(meerBolletje([teller('2')]), 'gewoon');
});

test('bolletje: bijna geeft oranje, boven gewoon', () => {
  assert.equal(meerBolletje([teller('1', { bijna: true })]), 'bijna');
  assert.equal(meerBolletje([teller('4'), teller('1', { bijna: true })]), 'bijna');
});

test('bolletje: op en bijna samen geven rood', () => {
  assert.equal(meerBolletje([teller('1', { bijna: true }), teller('2', { op: true })]), 'op');
  assert.equal(meerBolletje([teller('2', { op: true }), teller('1', { bijna: true }), teller('5')]), 'op');
  assert.equal(meerBolletje([teller('2', { op: true, verborgen: true }), teller('1', { bijna: true })]), 'bijna', 'een verborgen rode teller telt niet');
});

test('bolletje: de aria-label van Meer', () => {
  assert.equal(meerBolletjeLabel(null), null);
  assert.equal(meerBolletjeLabel('op'), 'Meer, voorraad op');
  assert.equal(meerBolletjeLabel('bijna'), 'Meer, voorraad bijna op');
  assert.equal(meerBolletjeLabel('gewoon'), 'Meer, nieuwe meldingen');
});
