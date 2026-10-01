// kern/brug.js — de ENIGE module die `window` aanraakt. Moet de eerste kern-module zijn die laadt
// (staat in index.html vóór app-dialog.js); modules draaien na het parsen, vóór DOMContentLoaded,
// dus enkel code binnen functies/handlers van het klassieke script mag deze namen gebruiken.
import * as tijd from './tijd.js';
import * as ui from './ui.js';
import * as selecties from './selecties.js';
import * as api from './api.js';
import { toestand, SLEUTELS } from './toestand.js';
import * as routeTijden from '../schermen/route-tijden.js';
import * as routeKaart from '../schermen/route-kaart.js';
import * as route from '../schermen/route.js';

window.kern = { tijd, ui, selecties, toestand, api };
window.kern.route = { ...routeTijden, ...routeKaart, ...route };

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
  initMap: routeKaart.initMap,
  applyKaartStijl: routeKaart.applyKaartStijl,
  renderRouteList: route.renderRouteList,
  updateRouteBtns: route.updateRouteBtns,
  calculateRoute: route.calculateRoute,
  updateMap: route.updateMap,
  computeArrivalTimes: route.aankomstTijdenVoorDag,
});

// Toestandssleutels als globale namen: lezen/schrijven gaat via de toestand (toewijzing verwittigt, in-place niet: raak()).
function installeerToestandAlsGlobals(store, sleutels) {
  for (const k of sleutels) Object.defineProperty(window, k, {
    configurable: true, enumerable: true,
    get: () => store.get(k), set: v => store.set(k, v),
  });
}
installeerToestandAlsGlobals(toestand, SLEUTELS);
