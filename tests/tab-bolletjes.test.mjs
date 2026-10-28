// Open dag, taak 19: wat het bolletje van een tabteller betekent (puur, schermen/tab-bolletjes-logica.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNul, tellerKleur, tellerLabel } from '../public/js/schermen/tab-bolletjes-logica.js';

test('isNul: leeg, spaties en nul tellen niet; een aantal wel', () => {
  for (const t of ['', '  ', '0', ' 0 ', '00', null, undefined]) assert.equal(isNul(t), true, String(t));
  for (const t of ['1', '12', 'x']) assert.equal(isNul(t), false, t);
});

test('tellerKleur: op boven bijna boven gewoon; nul, verborgen of geen teller = geen bolletje', () => {
  assert.equal(tellerKleur({ tekst: '2', op: true, bijna: true }), 'op');
  assert.equal(tellerKleur({ tekst: '2', bijna: true }), 'bijna');
  assert.equal(tellerKleur({ tekst: '3' }), 'gewoon');
  assert.equal(tellerKleur({ tekst: '0', op: true }), null);
  assert.equal(tellerKleur({ tekst: '3', verborgen: true }), null);
  assert.equal(tellerKleur(null), null);
  assert.equal(tellerKleur(undefined), null);
});

test('tellerLabel: dezelfde woorden als "Meer"; geen bolletje = geen label', () => {
  assert.equal(tellerLabel('Inventaris', 'op', '2'), 'Inventaris, voorraad op');
  assert.equal(tellerLabel('Inventaris', 'bijna', '1'), 'Inventaris, voorraad bijna op');
  assert.equal(tellerLabel('Wachtrij', 'gewoon', ' 3 '), 'Wachtrij, 3 nieuw');
  assert.equal(tellerLabel('Wachtrij', null, '0'), null);
  assert.equal(tellerLabel('', 'gewoon', '3'), null);
});
