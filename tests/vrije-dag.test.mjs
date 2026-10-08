import test from 'node:test';
import assert from 'node:assert/strict';
import vrijeDag from '../public/js/vrije-dag.js';

const { vandaagNogBruikbaar } = vrijeDag;
const u = (h, m = 0) => h * 60 + m;
const basis = { vanMin: u(8), totMin: u(17), duurMin: 120, reisMin: 30 };

test('vandaag om 22:25 (werkdag voorbij) is niet meer bruikbaar', () => {
  assert.equal(vandaagNogBruikbaar({ ...basis, nuMin: u(22, 25) }), false);
});

test('vandaag vroeg op de dag is bruikbaar', () => {
  assert.equal(vandaagNogBruikbaar({ ...basis, nuMin: u(6, 0) }), true);
  assert.equal(vandaagNogBruikbaar({ ...basis, nuMin: u(10, 30) }), true);
});

test('precies op de grens (nu + reis + duur = einde) kan nog', () => {
  assert.equal(vandaagNogBruikbaar({ ...basis, nuMin: u(14, 30) }), true);
});

test('één minuut te laat voor een volledig ticket kan niet meer', () => {
  assert.equal(vandaagNogBruikbaar({ ...basis, nuMin: u(14, 31) }), false);
});

test('na einde werkdag maar korte duur: nog steeds niet', () => {
  assert.equal(vandaagNogBruikbaar({ ...basis, duurMin: 30, reisMin: 0, nuMin: u(17, 1) }), false);
});

test('ontbrekende of ongeldige waarden: vandaag blijft toegelaten (oud gedrag)', () => {
  assert.equal(vandaagNogBruikbaar({ ...basis, nuMin: NaN }), true);
  assert.equal(vandaagNogBruikbaar({ ...basis, totMin: undefined, nuMin: u(22) }), true);
});

test('vandaagBruikbaarNu leest instellingen en klok (22:25 nee, 09:00 ja)', () => {
  const inst = { vanTijd: '08:00', totTijd: '17:00', duurMinuten: 120 };
  assert.equal(vrijeDag.vandaagBruikbaarNu(inst, new Date(2026, 9, 8, 22, 25)), false);
  assert.equal(vrijeDag.vandaagBruikbaarNu(inst, new Date(2026, 9, 8, 9, 0)), true);
  assert.equal(vrijeDag.vandaagBruikbaarNu(inst, new Date(2026, 9, 8, 15, 0)), false);
});
