import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berekenLoonkost } from '../public/js/kern/loonkost.js';

test('2e-lijn: basis 175 tot en met 3 uur (werk + aanrijtijd)', () => {
  assert.equal(berekenLoonkost('2e-lijn', 120, 30).bruto, 175);
});

test('2e-lijn: elk gestart extra uur boven 3 uur kost 75', () => {
  const r = berekenLoonkost('2e-lijn', 180, 60);
  assert.equal(r.totMin, 240);
  assert.equal(r.extraUren, 1);
  assert.equal(r.bruto, 250);
});

test('1e-lijn: gestarte uren x 115', () => {
  const r = berekenLoonkost('1e-lijn', 61, 0);
  assert.equal(r.bruto, 230);
  assert.equal(r.gestartUren, 2);
  assert.equal(r.extraUren, 0);
});

test('garantie: zelfde als 1e-lijn maar netto 0', () => {
  const r = berekenLoonkost('garantie', 90, 0);
  assert.equal(r.bruto, 230);
  assert.equal(r.netto, 0);
});

test('undefined invoer telt als 0', () => {
  assert.equal(berekenLoonkost('2e-lijn', undefined, undefined).bruto, 175);
  assert.equal(berekenLoonkost('2e-lijn', undefined, undefined).totMin, 0);
  assert.equal(berekenLoonkost('1e-lijn', undefined, undefined).bruto, 0);
});
