// tests/sales-registratie.test.mjs — de tabregistratie van de sales-planner (Task 13): tabs per rol, de start en de
// modulepreload-graaf (sales-registratie.js mag geen statische imports hebben: de rest laadt lazy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registreerSalesRol, SALES_TABS } from '../public/js/schermen/sales-registratie.js';

const SCHERMEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'schermen');

function spionen() {
  const tabs = []; const starts = [];
  return { tabs, starts, registreerTabs: (rol, lijst) => tabs.push({ rol, lijst }), registreerStart: (rol, fn) => starts.push({ rol, fn }) };
}

test('sales: de vier tabs in de volgorde Leads, Kalender, Route, Afgewerkt, elk met een laad-functie', () => {
  const s = spionen();
  registreerSalesRol(s);
  const sales = s.tabs.find(t => t.rol === 'sales');
  assert.ok(sales);
  assert.deepEqual(sales.lijst.map(t => t.id), ['sales-lijst', 'sales-kalender', 'sales-route', 'sales-afgewerkt']);
  assert.deepEqual(sales.lijst.map(t => t.label), ['Leads', 'Kalender', 'Route', 'Afgewerkt']);
  for (const t of sales.lijst) assert.equal(typeof t.laad, 'function', t.id);
});

test('beheerder: één tab "Sales" met een laad-functie (de vier schermen zitten in subtabs, niet in de hoofdbalk)', () => {
  const s = spionen();
  registreerSalesRol(s);
  const beheer = s.tabs.filter(t => t.rol === 'beheerder').flatMap(t => t.lijst);
  assert.deepEqual(beheer.map(t => [t.id, t.label]), [['sales', 'Sales']]);
  assert.equal(typeof beheer[0].laad, 'function');
  assert.equal('beheerLabel' in beheer[0], false);
});

test('de start voor rol sales is een functie', () => {
  const s = spionen();
  registreerSalesRol(s);
  assert.equal(s.starts.length, 1);
  assert.equal(s.starts[0].rol, 'sales');
  assert.equal(typeof s.starts[0].fn, 'function');
});

test('sales-registratie.js heeft geen statische import-regel (de modulepreload-graaf is enkel dit bestand)', () => {
  const bron = fs.readFileSync(path.join(SCHERMEN, 'sales-registratie.js'), 'utf8');
  const zonderCommentaar = bron.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual(zonderCommentaar.match(/^\s*import\b[^(\n]*\bfrom\b.*$/gm) ?? [], []);
  assert.deepEqual(zonderCommentaar.match(/^\s*import\s+['"].*$/gm) ?? [], []);
});

test('elk lazy scherm bestaat als bestand (geen 404 bij de eerste tabwissel)', () => {
  for (const naam of ['sales-schil', 'sales-beheer', 'sales-venster', 'sales-verkoper', 'sales-start', 'sales-lijst', 'sales-kalender', 'sales-route', 'sales-afgewerkt']) {
    assert.ok(fs.existsSync(path.join(SCHERMEN, naam + '.js')), naam + '.js');
  }
});
