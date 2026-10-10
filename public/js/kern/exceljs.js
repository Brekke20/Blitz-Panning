// public/js/kern/exceljs.js
// Laadt de ExcelJS-bibliotheek pas bij de eerste export (etappe 7, N2): ze woog 258 KB gzip in de koude start en wordt
// enkel door de twee Excel-exports (TicketLog en Inventaris) gebruikt. Eén gedeelde belofte zolang de lading loopt, en
// `window.ExcelJS` daarna: een tweede export, of twee gelijktijdige klikken, laden niet opnieuw. Een mislukte lading
// (fout of tijdlimiet) wordt niet onthouden, zodat een volgende klik opnieuw probeert; de fout bereikt de aanroeper,
// die ze in zijn bestaande `catch` toont.
export const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
export const EXCELJS_TIJDLIMIET_MS = 20000; // gelijk aan de standaardlimiet van kern/netwerk.js

let _belofte = null;

export function laadExcelJs({ limiet = EXCELJS_TIJDLIMIET_MS, setTimeoutFn = (f, ms) => setTimeout(f, ms), clearTimeoutFn = (t) => clearTimeout(t) } = {}) {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (_belofte) return _belofte;
  _belofte = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const timer = setTimeoutFn(() => {
      s.onload = s.onerror = null;
      s.remove();
      reject(new Error('ExcelJS laden duurde te lang'));
    }, limiet);
    s.src = EXCELJS_URL;
    s.onload = () => {
      clearTimeoutFn(timer);
      if (window.ExcelJS) resolve(window.ExcelJS); else reject(new Error('ExcelJS niet beschikbaar na het laden'));
    };
    s.onerror = () => { clearTimeoutFn(timer); s.remove(); reject(new Error('ExcelJS kon niet geladen worden')); };
    document.head.appendChild(s);
  }).finally(() => { _belofte = null; }); // enkel gedeeld zolang de lading loopt; daarna beslist window.ExcelJS
  return _belofte;
}

// Start de TicketLog-export: laadt excel-export.js lazy. Mislukt dat laden van de module (bv. offline en niet in de cache),
// dan komt dezelfde foutmelding als bij een mislukte export, in plaats van een onafgehandelde afwijzing.
export async function startTicketLogExport(laadModule, toonToast) {
  try {
    return await (await laadModule()).exportTicketLog();
  } catch (err) {
    toonToast(`✕ Export mislukt: ${err.message}`, 4000);
    console.error('exportTicketLog:', err);
  }
}
