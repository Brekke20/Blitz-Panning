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
import * as capaciteit from '../schermen/capaciteit.js';
import * as wachtrij from '../schermen/wachtrij.js';
import * as kalender from '../schermen/kalender.js';
import * as ingepland from '../schermen/ingepland.js';
import * as ticketdetailLogica from '../schermen/ticketdetail-logica.js';
import * as ticketdetail from '../schermen/ticketdetail.js';
import * as voorstel from '../schermen/voorstel.js';
import * as annuleren from '../schermen/annuleren.js';
import * as klantbeschikbaarheid from '../schermen/klantbeschikbaarheid.js';
import * as beschikbaarheid from '../schermen/beschikbaarheid.js';
import * as afspraken from '../schermen/afspraken.js';
import * as instellingen from '../schermen/instellingen.js';
import * as fotos from '../schermen/fotos.js';
import * as rapportVerzenden from '../schermen/rapport-verzenden.js';
import * as planacties from '../schermen/planacties.js';
import { openPrijsBeheer, closePrijsBeheer, prijsReset, prijsOpslaan } from '../prijzen.js';

window.kern = { tijd, ui, selecties, toestand, api };
window.kern.route = { ...routeTijden, ...routeKaart, ...route };
window.kern.capaciteit = { ...capaciteit };
window.kern.wachtrij = { ...wachtrij };
window.kern.kalender = { ...kalender };
window.kern.ingepland = { ...ingepland };
window.kern.ticketdetailLogica = { ...ticketdetailLogica };
window.kern.ticketdetail = { ...ticketdetail };
window.kern.voorstel = { ...voorstel };
window.kern.annuleren = { ...annuleren };
window.kern.klantbeschikbaarheid = { ...klantbeschikbaarheid };
window.kern.beschikbaarheid = { ...beschikbaarheid };
window.kern.afspraken = { ...afspraken };
window.kern.instellingen = { ...instellingen };
window.kern.fotos = { ...fotos };
window.kern.rapportVerzenden = { ...rapportVerzenden };
window.kern.planacties = { ...planacties };
window.kern.prijzen = { openPrijsBeheer, closePrijsBeheer, prijsReset, prijsOpslaan }; // enkel de venster-knoppen; PRIJZEN is een live `let` in prijzen.js

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
  renderTickets: wachtrij.renderTickets,
  renderKalender: kalender.renderKalender,
  renderRouteList: route.renderRouteList,
  updateRouteBtns: route.updateRouteBtns,
  calculateRoute: route.calculateRoute,
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
