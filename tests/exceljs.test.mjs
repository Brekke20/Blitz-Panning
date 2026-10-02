// Unit: de lazy ExcelJS-lader (etappe 7, N2) met een nep-document. Pint: één script-element per lading, gedeelde belofte,
// geen tweede lading als window.ExcelJS bestaat, en bij een mislukte lading een afwijzing die de export in zijn bestaande
// catch toont ("✕ Export mislukt: …"), waarna een volgende klik opnieuw probeert.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let scripts;
beforeEach(() => {
  scripts = [];
  globalThis.window = {};
  globalThis.document = {
    createElement: () => ({ remove() { this.verwijderd = true; } }),
    head: { appendChild: s => scripts.push(s) },
  };
});
const { laadExcelJs, EXCELJS_URL } = await import('../public/js/kern/exceljs.js');

test('de URL is de vastgepinde jsdelivr-versie', () => {
  assert.equal(EXCELJS_URL, 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');
});

test('gelijktijdige aanroepen delen één script-element en geven window.ExcelJS terug', async () => {
  const a = laadExcelJs(), b = laadExcelJs();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, EXCELJS_URL);
  window.ExcelJS = { Workbook: class {} };
  scripts[0].onload();
  assert.equal(await a, window.ExcelJS);
  assert.equal(await b, window.ExcelJS);
});

test('een tweede aanroep na een geslaagde lading laadt niet opnieuw', async () => {
  window.ExcelJS = { Workbook: class {} };
  assert.equal(await laadExcelJs(), window.ExcelJS);
  assert.equal(scripts.length, 0);
});

test('een mislukte lading wijst af met een duidelijke fout; de volgende aanroep probeert opnieuw', async () => {
  const eerste = laadExcelJs();
  scripts[0].onerror();
  await assert.rejects(eerste, /ExcelJS kon niet geladen worden/);
  assert.equal(scripts[0].verwijderd, true);
  const tweede = laadExcelJs();
  assert.equal(scripts.length, 2);
  window.ExcelJS = {};
  scripts[1].onload();
  assert.equal(await tweede, window.ExcelJS);
});

test('een script dat laadt zonder window.ExcelJS wijst af', async () => {
  const p = laadExcelJs();
  scripts[0].onload();
  await assert.rejects(p, /niet beschikbaar/);
});
