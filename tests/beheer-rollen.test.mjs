// tests/beheer-rollen.test.mjs — welke subtabs van Beheer elke rol ziet (beheer.js: beheerRolVan, zichtbareTabs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beheerRolVan, zichtbareTabs, registreerBeheerTab } from '../public/js/schermen/beheer.js';

const render = async () => {};
const ALLE = [
  { id: 'gebruikers', label: 'Gebruikers', render, rollen: ['beheerder'] },
  { id: 'instellingen', label: 'Instellingen', render, rollen: ['beheerder', 'planner', 'sales-manager'] },
  { id: 'activiteit', label: 'Activiteitenlog', render, rollen: ['beheerder'] },
  { id: 'systeemstatus', label: 'Systeemstatus', render, rollen: ['beheerder'] },
  { id: 'performance', label: 'Performance', render, rollen: ['beheerder', 'planner', 'sales-manager'] },
];

test('beheerRolVan: beheerder, planner en sales met magAlleSales (true) hebben Beheer; technieker, gewone sales en niemand niet', () => {
  assert.equal(beheerRolVan({ rol: 'beheerder' }), 'beheerder');
  assert.equal(beheerRolVan({ rol: 'planner' }), 'planner');
  assert.equal(beheerRolVan({ rol: 'sales', magAlleSales: true }), 'sales-manager');
  assert.equal(beheerRolVan({ rol: 'sales', magAlleSales: 'ja' }), null);
  assert.equal(beheerRolVan({ rol: 'sales', magAlleSales: false }), null);
  assert.equal(beheerRolVan({ rol: 'sales' }), null);
  assert.equal(beheerRolVan({ rol: 'technieker', magAlleSales: true }), null);
  assert.equal(beheerRolVan({ rol: 'planner', magAlleSales: true }), 'planner');
  assert.equal(beheerRolVan(null), null);
});

test('zichtbareTabs: beheerder alles in volgorde; planner en sales manager enkel Instellingen en Performance; geen rol niets', () => {
  const namen = r => zichtbareTabs(r, ALLE).map(t => t.label);
  assert.deepEqual(namen('beheerder'), ['Gebruikers', 'Instellingen', 'Activiteitenlog', 'Systeemstatus', 'Performance']);
  assert.deepEqual(namen('planner'), ['Instellingen', 'Performance']);
  assert.deepEqual(namen('sales-manager'), ['Instellingen', 'Performance']);
  assert.deepEqual(namen(null), []);
  assert.deepEqual(namen('onbekend'), []);
});

test('registreerBeheerTab: zonder rollen is een tab enkel voor de beheerder (fail-closed)', () => {
  registreerBeheerTab({ id: 'proef-zonder-rollen', label: 'Proef', render });
  assert.ok(zichtbareTabs('beheerder').some(t => t.id === 'proef-zonder-rollen'));
  assert.ok(!zichtbareTabs('planner').some(t => t.id === 'proef-zonder-rollen'));
  assert.ok(!zichtbareTabs('sales-manager').some(t => t.id === 'proef-zonder-rollen'));
});
