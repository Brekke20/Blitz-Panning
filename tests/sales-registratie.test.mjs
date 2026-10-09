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

test('sales: de vier tabs in de volgorde Te plannen, Kalender, Route, Afgewerkt, elk met een laad-functie', () => {
  const s = spionen();
  registreerSalesRol(s);
  const sales = s.tabs.find(t => t.rol === 'sales');
  assert.ok(sales);
  assert.deepEqual(sales.lijst.map(t => t.id), ['sales-lijst', 'sales-kalender', 'sales-route', 'sales-afgewerkt']);
  assert.deepEqual(sales.lijst.map(t => t.label), ['Te plannen', 'Kalender', 'Route', 'Afgewerkt']);
  for (const t of sales.lijst) assert.equal(typeof t.laad, 'function', t.id);
});

test('beheerder: dezelfde id\'s, labels beginnen met "Sales: " en botsen niet met de bestaande tabnamen (Kalender, Route)', () => {
  const s = spionen();
  registreerSalesRol(s);
  const beheer = s.tabs.find(t => t.rol === 'beheerder');
  assert.ok(beheer);
  assert.deepEqual(beheer.lijst.map(t => t.id), SALES_TABS.map(t => t.id));
  for (const t of beheer.lijst) {
    assert.ok(t.label.startsWith('Sales: '), t.label);
    assert.equal(typeof t.laad, 'function', t.id);
  }
  // Playwright/Testing Library zoeken tabs op een deel van de naam: "Sales: Kalender" zou de tab "Kalender" dubbel maken.
  for (const bestaand of ['Wachtrij', 'Kalender', 'Route', 'Ingepland', 'Inventaris', 'Rapporten', 'Beheer']) {
    assert.deepEqual(beheer.lijst.filter(t => t.label.toLowerCase().includes(bestaand.toLowerCase())).map(t => t.label), [], bestaand);
  }
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
  for (const naam of ['sales-schil', 'sales-venster', 'sales-verkoper', 'sales-start', 'sales-lijst', 'sales-kalender', 'sales-route', 'sales-afgewerkt']) {
    assert.ok(fs.existsSync(path.join(SCHERMEN, naam + '.js')), naam + '.js');
  }
});
