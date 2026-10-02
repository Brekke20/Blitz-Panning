// public/js/kern/exceljs.js
// Laadt de ExcelJS-bibliotheek pas bij de eerste export (etappe 7, N2): ze woog 258 KB gzip in de koude start en wordt
// enkel door de twee Excel-exports (TicketLog en Inventaris) gebruikt. Eén gedeelde belofte zolang de lading loopt, en
// `window.ExcelJS` daarna: een tweede export, of twee gelijktijdige klikken, laden niet opnieuw. Een mislukte lading wordt niet onthouden, zodat een volgende klik opnieuw
// probeert; de fout bereikt de aanroeper, die ze in zijn bestaande `catch` toont.
export const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

let _belofte = null;

export function laadExcelJs() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (_belofte) return _belofte;
  _belofte = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = EXCELJS_URL;
    s.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('ExcelJS niet beschikbaar na het laden')));
    s.onerror = () => { s.remove(); reject(new Error('ExcelJS kon niet geladen worden')); };
    document.head.appendChild(s);
  }).finally(() => { _belofte = null; }); // enkel gedeeld zolang de lading loopt; daarna beslist window.ExcelJS
  return _belofte;
}
