import test from 'node:test';
import assert from 'node:assert/strict';
import { magLezen, magSchrijven, kanVerkoperKiezen } from '../public/js/sales/toegang.js';

const salesA = { id: 'a', rol: 'sales' };
const salesAlle = { id: 'a', rol: 'sales', magAlleSales: true };
const beheerder = { id: 'x', rol: 'beheerder' };

test('sales: eigen blob lezen en schrijven', () => {
  assert.equal(magLezen(salesA, 'a'), true);
  assert.equal(magSchrijven(salesA, 'a'), true);
});

test('sales zonder vinkje: andere verkoper niet lezen, niet schrijven', () => {
  assert.equal(magLezen(salesA, 'b'), false);
  assert.equal(magSchrijven(salesA, 'b'), false);
  assert.equal(magLezen({ ...salesA, magAlleSales: false }, 'b'), false);
});

test('sales met magAlleSales: lezen ja, schrijven nee', () => {
  assert.equal(magLezen(salesAlle, 'b'), true);
  assert.equal(magSchrijven(salesAlle, 'b'), false);
  assert.equal(magSchrijven(salesAlle, 'a'), true);
});

test('beheerder: iedereen lezen en schrijven', () => {
  assert.equal(magLezen(beheerder, 'b'), true);
  assert.equal(magSchrijven(beheerder, 'b'), true);
});

test('andere rollen en geen gebruiker: nooit', () => {
  for (const rol of ['planner', 'technieker']) {
    const g = { id: 'a', rol, magAlleSales: true };
    assert.equal(magLezen(g, 'a'), false);
    assert.equal(magSchrijven(g, 'a'), false);
    assert.equal(kanVerkoperKiezen(g), false);
  }
  assert.equal(magLezen(null, 'a'), false);
  assert.equal(magSchrijven(undefined, 'a'), false);
  assert.equal(magLezen(salesA, undefined), false);
});

test('kanVerkoperKiezen: beheerder of sales met magAlleSales', () => {
  assert.equal(kanVerkoperKiezen(beheerder), true);
  assert.equal(kanVerkoperKiezen(salesAlle), true);
  assert.equal(kanVerkoperKiezen(salesA), false);
  assert.equal(kanVerkoperKiezen(null), false);
});
