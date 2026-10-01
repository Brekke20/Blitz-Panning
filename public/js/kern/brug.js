// kern/brug.js — de ENIGE module die `window` aanraakt. Moet de eerste kern-module zijn die laadt
// (staat in index.html vóór app-dialog.js); modules draaien na het parsen, vóór DOMContentLoaded,
// dus enkel code binnen functies/handlers van het klassieke script mag deze namen gebruiken.
import * as tijd from './tijd.js';
import * as ui from './ui.js';
import * as selecties from './selecties.js';

window.kern = { tijd, ui, selecties };

// LEGACY-BRUG (verdwijnt in etappe 5): oude globale namen voor klassieke code en oudere modules
Object.assign(window, {
  localISO: tijd.localISO,
  todayStr: tijd.todayISO,
  getWeekStart: tijd.getWeekStart,
  timeStrToMin: tijd.timeStrToMin,
  minToTimeStr: tijd.minToTimeStr,
  extractLocalHour: tijd.extractLocalHour,
  fmtDate: tijd.fmtDate,
  fmtDateShort: tijd.fmtDateShort,
  fmtSec: tijd.fmtSec,
  escHtml: ui.escHtml,
  toast: ui.toast,
});
