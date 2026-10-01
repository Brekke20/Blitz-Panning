// kern/brug.js — de ENIGE module die `window` aanraakt. Moet de eerste kern-module zijn die laadt
// (staat in index.html vóór app-dialog.js); modules draaien na het parsen, vóór DOMContentLoaded,
// dus enkel code binnen functies/handlers van het klassieke script mag deze namen gebruiken.
import * as tijd from './tijd.js';

window.kern = { tijd };

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
});
