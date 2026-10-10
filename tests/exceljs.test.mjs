// Unit: de lazy ExcelJS-lader (etappe 7, N2) met een nep-document. Pint: één script-element per lading, gedeelde belofte,
// geen tweede lading als window.ExcelJS bestaat, tijdlimiet, en bij een mislukte lading een afwijzing die de export in zijn
// bestaande catch toont ("✕ Export mislukt: …"), waarna een volgende klik opnieuw probeert.
import { test, beforeEach, afterEach } from 'node:test';
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
afterEach(() => { delete globalThis.window; delete globalThis.document; });
const { laadExcelJs, startTicketLogExport, EXCELJS_URL, EXCELJS_TIJDLIMIET_MS } = await import('../public/js/kern/exceljs.js');

// Nep-timers: verzamelt de geplande functies zodat een test de tijd kan laten verstrijken.
function nepTimers() {
  const t = { gepland: [], gewist: [] };
  t.setTimeoutFn = (f, ms) => { t.gepland.push({ f, ms }); return t.gepland.length; };
  t.clearTimeoutFn = (id) => t.gewist.push(id);
  return t;
}

test('de URL is de vastgepinde jsdelivr-versie en de tijdlimiet is 20 s', () => {
  assert.equal(EXCELJS_URL, 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');
  assert.equal(EXCELJS_TIJDLIMIET_MS, 20000);
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

test('tijdlimiet: na 20 s wordt het script verwijderd en afgewezen; een latere klik probeert opnieuw', async () => {
  const t = nepTimers();
  const p = laadExcelJs(t);
  assert.equal(t.gepland[0].ms, 20000);
  t.gepland[0].f();
  await assert.rejects(p, /duurde te lang/);
  assert.equal(scripts[0].verwijderd, true);
  assert.equal(scripts[0].onload, null);
  const opnieuw = laadExcelJs(t);
  assert.equal(scripts.length, 2);
  window.ExcelJS = {};
  scripts[1].onload();
  assert.equal(await opnieuw, window.ExcelJS);
  assert.deepEqual(t.gewist, [2]); // de timer van de geslaagde lading is gewist
});

test('startTicketLogExport: een mislukte modulelading toont de bestaande foutmelding', async () => {
  const toasts = [];
  const log = console.error; console.error = () => {};
  try {
    await startTicketLogExport(() => Promise.reject(new Error('Failed to fetch dynamically imported module')), (t, ms) => toasts.push([t, ms]));
  } finally { console.error = log; }
  assert.deepEqual(toasts, [['✕ Export mislukt: Failed to fetch dynamically imported module', 4000]]);
});

test('startTicketLogExport: bij een geladen module wordt exportTicketLog uitgevoerd, zonder toast', async () => {
  let aangeroepen = 0;
  await startTicketLogExport(async () => ({ exportTicketLog: async () => { aangeroepen++; } }), () => assert.fail('geen toast'));
  assert.equal(aangeroepen, 1);
});
