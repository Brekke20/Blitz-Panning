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
