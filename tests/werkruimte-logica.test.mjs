// tests/werkruimte-logica.test.mjs — de werkruimtes van de beheerder (kop B, taak 2): bewaarde keuze en de omzetting van de tab bij een wissel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leesWerkruimte, bewaarWerkruimte, omzetTab, tabHoortBij, WERKRUIMTE_SLEUTEL } from '../public/js/schermen/werkruimte-logica.js';

const opslag = (begin = {}) => {
  const m = new Map(Object.entries(begin));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('leesWerkruimte: enkel "sales" is sales; leeg, onbekend of een kapotte opslag is techniek', () => {
  assert.equal(leesWerkruimte(opslag({ [WERKRUIMTE_SLEUTEL]: 'sales' })), 'sales');
  assert.equal(leesWerkruimte(opslag({ [WERKRUIMTE_SLEUTEL]: 'techniek' })), 'techniek');
  assert.equal(leesWerkruimte(opslag()), 'techniek');
  assert.equal(leesWerkruimte(opslag({ [WERKRUIMTE_SLEUTEL]: 'iets-anders' })), 'techniek');
  assert.equal(leesWerkruimte({ getItem() { throw new Error('geen opslag'); } }), 'techniek');
  assert.equal(leesWerkruimte(null), 'techniek');
});

test('bewaarWerkruimte schrijft sales of techniek en slikt een kapotte opslag', () => {
  const o = opslag();
  bewaarWerkruimte(o, 'sales');
  assert.equal(o.getItem(WERKRUIMTE_SLEUTEL), 'sales');
  bewaarWerkruimte(o, 'nonsens');
  assert.equal(o.getItem(WERKRUIMTE_SLEUTEL), 'techniek');
  assert.doesNotThrow(() => bewaarWerkruimte({ setItem() { throw new Error('vol'); } }, 'sales'));
});

test('van techniek naar sales: dezelfde schermen blijven, de rest wordt Leads; Beheer blijft Beheer', () => {
  const naar = (t) => omzetTab(t, 'sales');
  assert.deepEqual(['tickets', 'kalender', 'planning', 'gepland', 'inventaris', 'rapporten', 'beheer'].map(naar),
    ['sales-lijst', 'sales-kalender', 'sales-route', 'sales-lijst', 'sales-lijst', 'sales-afgewerkt', 'beheer']);
});

test('van sales naar techniek: Leads -> Wachtrij, Afgewerkt -> Rapporten, Kalender en Route blijven, Beheer blijft', () => {
  const naar = (t) => omzetTab(t, 'techniek');
  assert.deepEqual(['sales-lijst', 'sales-kalender', 'sales-route', 'sales-afgewerkt', 'beheer'].map(naar),
    ['tickets', 'kalender', 'planning', 'rapporten', 'beheer']);
});

test('een tab die al bij de werkruimte hoort, blijft staan', () => {
  assert.equal(omzetTab('kalender', 'techniek'), 'kalender');
  assert.equal(omzetTab('gepland', 'techniek'), 'gepland');
  assert.equal(omzetTab('sales-afgewerkt', 'sales'), 'sales-afgewerkt');
});

test('een onbekende bewaarde tab (bv. de vroegere hoofdtab "sales") wordt de eerste tab van de werkruimte', () => {
  assert.equal(omzetTab('sales', 'sales'), 'sales-lijst');
  assert.equal(omzetTab('sales', 'techniek'), 'tickets');
  assert.equal(omzetTab('', 'sales'), 'sales-lijst');
  assert.equal(omzetTab(undefined, 'techniek'), 'tickets');
});

test('op een gsm bestaat Route niet: Route wordt Kalender, in beide richtingen en in dezelfde werkruimte', () => {
  assert.equal(omzetTab('planning', 'sales', { smal: true }), 'sales-kalender');
  assert.equal(omzetTab('sales-route', 'techniek', { smal: true }), 'kalender');
  assert.equal(omzetTab('planning', 'techniek', { smal: true }), 'kalender');
  assert.equal(omzetTab('sales-route', 'sales', { smal: true }), 'sales-kalender');
  assert.equal(omzetTab('planning', 'sales', { smal: false }), 'sales-route');
});

test('tabHoortBij', () => {
  assert.equal(tabHoortBij('tickets', 'techniek'), true);
  assert.equal(tabHoortBij('tickets', 'sales'), false);
  assert.equal(tabHoortBij('sales-lijst', 'sales'), true);
  assert.equal(tabHoortBij('sales-lijst', 'techniek'), false);
  assert.equal(tabHoortBij('beheer', 'sales'), true);
  assert.equal(tabHoortBij('beheer', 'techniek'), true);
});
