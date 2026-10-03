// schermen/route.js — de Route-tab (etappe 3): routelijst, weekstrook, tijden, "Bereken tijden", slepen, optimaliseren en "Tijden vastleggen".
// De code is letterlijk uit index.html verhuisd. Routeschermtoestand (`routeData`, `currentRouteDate`, ...) is
// module-privé (bewust buiten de store, K4); gegevens en instellingen komen uit `kern/toestand`, de afhankelijkheden
// van andere schermen via `initRoute(afh)` (aan het begin van DOMContentLoaded). Raakt `document` enkel binnen
// functies, nooit op moduleniveau. Alleen `kern/brug.js` wijst `window`-namen toe.
import { toestand } from '../kern/toestand.js';
import { toast, escHtml, registreerActies, strengeAfh } from '../kern/ui.js';
import { localISO, fmtSec, timeStrToMin, minToTimeStr, extractLocalHour } from '../kern/tijd.js';
import { apiVerzoek, foutTekst } from '../kern/api.js';
import { planItemsVanTechnieker, stopsVoorDag as selStopsVoorDag } from '../kern/selecties.js';
import { maakSorteerbaar } from '../sorteer.js';
import {
  berekenAankomsten, aankomstPerTicket, fmtTijd, dagHeeftEenTechnieker, stopZonderTijdstip, routeHandtekening,
  mergeMetAnkers, buitenDagklok as buitenDagklokTijd, isTeLaat,
} from './route-tijden.js';
import { updateKaart, wisKaart, herstelWegafsluitingToast, zoomOpGekendeStops } from './route-kaart.js';

// Afhankelijkheden uit app.js (ingevuld door initRoute); een vergeten initRoute faalt luid.
let afh = new Proxy({}, { get() { throw new Error('route: initRoute() is niet aangeroepen'); } });
export function initRoute(afhankelijkheden) {
  afh = strengeAfh('route', afhankelijkheden);
  // R9: de knoppen van dit scherm via data-actie-delegatie (de afhankelijkheden van andere schermen via afh).
  const kaart = el => el.closest('.stop').dataset;
  registreerActies(document.body, {
    'route-optimaliseer': () => optimizeRoute(),
    'route-bereken': () => calculateRoute(),
    'route-leeg': () => clearDay(),
    // W11: opent enkel het voorstelvenster; verstuurt niets.
    'route-voorstel': el => { const s = kaart(el); afh.openProposal(s.ticketId, s.datum, s.aankomst === '' ? null : Number(s.aankomst)); },
    'route-aankomst': el => { const s = kaart(el); afh.registerArrival(s.ticketId, s.datum); },
    'route-rapport': el => { const s = kaart(el); afh.openRapport(s.ticketId, s.datum); },
    'route-uitplannen': el => { const s = kaart(el); afh.bevestigUitplannen(s.ticketId, s.datum); },
  });
  document.getElementById('plan-date').addEventListener('change', e => onDateChange(e.target.value));
}

const get = k => toestand.get(k);

// Module-privé routetoestand.
let routeData = null, currentRouteDate = null;
let routeVerouderdDatum = null;
let dagBerekenTimer = null;
let sorteer = null;       // de sorteer-instantie van de lijst (één per render)
let _routeOrderBezig = false; // I4: true zolang applyRouteOrder() planning[date]-objecten muteert (zie routeOrderBezig)
let renderTeller = 0;     // R10: e2e telt hertekeningen hiermee, ook interne oproepen

// Aantal keren dat renderRouteList() draaide (voor e2e/kern.spec.mjs).
export function renderTelling() { return renderTeller; }

// Is er een berekende route (met polylijn) voor deze dag? (was `routeData?.polyline?.length && currentRouteDate === date`)
export function routeActueelVoor(date) { return !!(routeData?.polyline?.length && currentRouteDate === date); }

// Kaart opnieuw tekenen als er al een berekende route staat (kleur/drukte-instelling net gewijzigd).
export function vernieuwKaart() { if (routeData && currentRouteDate) updateMap(currentRouteDate); }

// I4 (eindreview v1.4.0): true zolang applyRouteOrder() bezig is met het muteren van
// planning[date]-objecten (tijdstippen toekennen/verfijnen/persisteren). De 5-min ticket-poll
// herseedt planning[date] met NIEUWE objecten (zie applyTicketsData) -- zonder deze guard kan
// een poll die net tijdens een sleep/optimize-actie binnenkomt de objecten waar applyRouteOrder
// nog op werkt vervangen, met een race tussen twee versies van dezelfde tickets als gevolg.
export function routeOrderBezig() { return _routeOrderBezig; }

// Gedeelde opbouw van de stops van één dag, voor de Route-tab en het ticketdetail:
// `stops` = planning[date] gefilterd op activeAssigneeFilter, `localForDate` = eigen afspraken
// (met adres of notitie) van die dag en technieker, `allStops` = beide gecombineerd als
// { kind: 'ticket'|'local', item, uur }, gesorteerd op uur (geen uur = achteraan).
// Filter en sortering moeten overal identiek zijn: calculateRoute() bouwt de waypoints op
// dezelfde manier, en berekenAankomsten() leidt daaruit legIdx af. Wijkt één kopie af, dan
// klopt de legIdx-mapping (en dus de aankomsttijden) niet meer.
// De wrapper-objecten zijn telkens vers (`uur` is een snapshot), maar `item` blijft hetzelfde
// object als in planning[date]/localEvents: applyRouteOrder() muteert dat rechtstreeks.
export function stopsVoorDag(date) {
  // Volgorde = de tijd die de gedeelde plaatsingsregel geeft (planner-tijdlijn.js): stops zonder uur komen in de gaten tussen
  // de vaste uren, zoals "+" en het planner-brein ze plaatsen (Brent-besluit, proefperiode).
  return selStopsVoorDag({ planning: get('planning'), localEvents: get('localEvents') }, get('activeAssigneeFilter'), date,
    { vanTijd: get('settings').vanTijd, laatsteStart: get('settings').laatsteStart, duurVoor: afh.duurVoor, werktijdMin: afh.werktijdMin });
}

// De enige aankomsttijd-berekening (route-tijden.js `berekenAankomsten`, puur) met de opties uit de
// instellingen. `legs` enkel als de berekende route bij deze dag hoort; zonder route overal de
// 30-min-reistijd-terugval.
export function legsVoorDag(date) { return routeData?.legs && currentRouteDate === date ? routeData.legs : null; }
export function aankomstenVoorDag(date, allStops = stopsVoorDag(date).allStops) {
  return berekenAankomsten(allStops, legsVoorDag(date),
    { vanTijd: get('settings').vanTijd, duurVoor: afh.duurVoor, werktijdMin: afh.werktijdMin });
}

// Bereken aankomsttijden (minuten na middernacht) per ticket voor een dag. Hergebruikt
// aankomstenVoorDag() (dezelfde berekening als renderRouteList()/de Route-tab) op dezelfde
// allStops-opbouw (tickets + lokale afspraken, gesorteerd op uur) -- zodat het ticketdetail-
// venster en de Route-tab nooit meer een ander voorgesteld tijdstip tonen voor hetzelfde ticket
// (bugronde 2026-09-22, item F). Geeft { [ticketId]: arrivalMin } terug. (Was `computeArrivalTimes`.)
export function aankomstTijdenVoorDag(date) {
  const { allStops } = stopsVoorDag(date);
  if (!allStops.length) return {};

  const { arrivalTimes } = aankomstenVoorDag(date, allStops);
  return aankomstPerTicket(allStops, arrivalTimes);
}

// Kaart (route-kaart.js) tekenen met de huidige routetoestand.
export function updateMap(date) {
  updateKaart({ date, allStops: stopsVoorDag(date).allStops, routeData, currentRouteDate });
}

// ══════════════════════════════════════════════
// ROUTE TAB
// ══════════════════════════════════════════════

// De gedeelde gekozen datum is gewijzigd (door de Kalender of Ingepland): datumkiezer en lijst volgen. Staat de Route-tab niet open,
// dan wordt er niets berekend (setTab rekent bij het openen); een eigen keuze in deze tab zette de datum zelf al (geen tweede render).
export function volgGekozenDatum() {
  const gekozen = toestand.get('gekozenDatum');
  const inp = document.getElementById('plan-date');
  if (!inp || !gekozen || inp.value === gekozen) return;
  inp.value = gekozen;
  onDateChange(gekozen);
}

export function onDateChange(val) {
  if (val && val !== toestand.get('gekozenDatum')) toestand.set('gekozenDatum', val); // eigen keuze: Kalender en Ingepland volgen
  wisRouteWeergave();   // route/markers/samenvatting van de vorige dag mogen niet blijven staan
  routeVerouderdDatum = null;
  renderRouteList(val);
  updateRouteBtns(val);
  routeData = null;
  // Kort uitstellen: snel door de dagen tikken (strook, pijltjestoetsen) mag geen reeks
  // TomTom-aanroepen geven; enkel de laatst gekozen dag wordt berekend.
  clearTimeout(dagBerekenTimer);
  // Enkel berekenen als de Route-tab open staat; anders doet setTab het bij het openen (geen TomTom-aanvraag op de achtergrond).
  if (document.getElementById('view-planning')?.classList.contains('active')) dagBerekenTimer = setTimeout(() => calculateRoute(), 300);
}

export function clearDay() {
  const date  = document.getElementById('plan-date').value;
  const stops = planItemsVanTechnieker(get('planning')[date], get('activeAssigneeFilter'));
  if (!stops.length) return;
  // Tickets met een verstuurd/bevestigd voorstel blijven staan: die moeten via "Afspraak annuleren".
  const vrij = stops.filter(p => !afh.heeftLopendVoorstel(p.ticket));
  const overgeslagen = stops.length - vrij.length;
  if (vrij.length) {
    if (!confirm(`Alle ${afh.meervoud(vrij.length, 'stop', 'stops')} verwijderen op ${date}?`)) return;
    vrij.forEach(s => afh.removeTicketFromDate(s.ticket.id, date));
  }
  if (overgeslagen) toast(`${afh.meervoud(overgeslagen, 'stop', 'stops')} met verstuurd voorstel niet verwijderd — annuleer ze afzonderlijk.`, 7000);
}

export function updateRouteBtns(date) {
  const stops = planItemsVanTechnieker(get('planning')[date], get('activeAssigneeFilter'));
  document.getElementById('btn-optimize').disabled = stops.length < 2;
  document.getElementById('btn-route').disabled    = stops.length < 1;
  document.getElementById('s-stops').textContent   = stops.length;
}

// Vergrendeld = tijdstip is aan de klant gecommuniceerd (voorstel verstuurd) of bevestigd.
// Niet versleepbaar in de Route-tab (Taak 4, Beslissing Brent 2026-09-21) -- de rest schuift
// errond. `item` is een ticket-stop-object ({ ticket, address, uur, ... }), niet een
// allStops-entry.
export function isStopLocked(item) {
  const id = item.ticket?.id;
  const vs = get('voorstelStatus')[id];
  if (vs?.contact || vs?.klant || vs?.installateur) return true;
  if (vs?.bevestigd) return true;
  return ['Geplande service', 'Geplande support'].includes(item.ticket?.status);
}

// Anker in de tijdstip-toekenning (C1, eindreview v1.4.0): naast vergrendelde tickets
// (isStopLocked) telt ook een ticket met een voorkeursuur van de klant (kbPreferredTime) als
// anker -- het uur wordt nooit door slepen/optimaliseren herschikt en nooit naar Zoho gepost
// (zie applyRouteOrder/optimizeRoute/mergeMetAnkers). LET OP: de versleepbaarheid in renderRouteList
// blijft bewust gekoppeld aan isStopLocked, niet aan deze functie -- een voorkeursuur-ticket
// mag nog wél als kaartje versleept worden (bv. om het ergens anders in de lijst te tonen),
// enkel het tijdstip zelf staat vast. De kaart krijgt een 🕐-marker zodat dat duidelijk is.
export function isStopAnchored(item) {
  return isStopLocked(item) || !!afh.kbPreferredTime(item.ticket?.id);
}

// ── Weekstrook (v1.9.5) ──────────────────────────────────────────────
// Week (ma..zo) van de gekozen datum: per werkdag aantal stops (met persoonsfilter, zoals de
// routelijst) en tijdstatus. Wordt vanuit renderRouteList() ververst -- dat is het bestaande
// her-render-pad (optimaliseren, slepen, herladen, datumwissel); luisteraars staan 1x op de strook.
const WEEKSTROOK_DAG = ['ZO','MA','DI','WO','DO','VR','ZA'];
function isoNaarDatum(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function weekstrookDagen(date) {
  const d0 = isoNaarDatum(date);
  const maandag = new Date(d0); maandag.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  const dagen = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(maandag); d.setDate(maandag.getDate() + i);
    if ((get('settings').werkdagen || [1,2,3,4,5]).includes(d.getDay())) dagen.push(d);
  }
  return { maandag, dagen };
}
function weekstrookKies(iso) {
  const inp = document.getElementById('plan-date');
  if (!iso || !inp) return;
  inp.value = iso;
  onDateChange(iso);
}
function weekstrookVerschuif(date, dagen) {
  const d = isoNaarDatum(date); d.setDate(d.getDate() + dagen); return localISO(d);
}
// Handtekening van de huidige (gefilterde) stops van een dag, voor de verouderd-controle.
function routeHandtekeningVoorDag(date) {
  const { stops, localForDate } = stopsVoorDag(date);
  return routeHandtekening(stops, localForDate);
}
// Wist route, markers, legende en samenvatting (kaart en statistiekbalk) van de Route-tab.
function wisRouteWeergave() {
  routeData = null; currentRouteDate = null;
  wisKaart();
  ['s-dist', 's-time', 's-delay', 's-eta'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  const w = document.getElementById('s-warn'); if (w) w.textContent = '';
}

function renderWeekstrook(date) {
  const el = document.getElementById('week-strip');
  if (!el || !date) return;
  if (!el._gebonden) {
    el._gebonden = true;
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-ws]');
      if (!b) return;
      const cur = document.getElementById('plan-date').value;
      if (b.dataset.ws === 'vorige') weekstrookKies(weekstrookVerschuif(cur, -7));
      else if (b.dataset.ws === 'volgende') weekstrookKies(weekstrookVerschuif(cur, 7));
      else weekstrookKies(b.dataset.ws);
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const b = e.target.closest('button[data-ws]');
      if (!b || b.dataset.ws === 'vorige' || b.dataset.ws === 'volgende') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const { dagen } = weekstrookDagen(b.dataset.ws);
      const isos = dagen.map(localISO);
      const i = isos.indexOf(b.dataset.ws) + dir;
      if (i >= 0 && i < isos.length) { el._focusNaRender = true; return weekstrookKies(isos[i]); }
      // Week-omslag: eerste/laatste werkdag van de volgende/vorige week
      const buur = weekstrookDagen(weekstrookVerschuif(b.dataset.ws, dir * 7)).dagen;
      if (!buur.length) return;
      el._focusNaRender = true;
      weekstrookKies(localISO(dir > 0 ? buur[0] : buur[buur.length - 1]));
    });
  }
  const hadFocus = el.contains(document.activeElement) || el._focusNaRender;
  el._focusNaRender = false;
  const { dagen } = weekstrookDagen(date);
  const vandaag = localISO(new Date());
  const geselecteerd = dagen.some(d => localISO(d) === date);
  let html = '<button type="button" class="ws-nav" data-ws="vorige" aria-label="Vorige week" title="Vorige week">‹</button><div class="ws-dagen">';
  dagen.forEach((d, idx) => {
    const iso = localISO(d);
    const stops = planItemsVanTechnieker(get('planning')[iso], get('activeAssigneeFilter'));
    const zonder = stops.filter(p => stopZonderTijdstip(p, isStopAnchored(p))).length;
    let status, cls;
    if (!stops.length) { status = '—'; cls = 'leeg'; }
    else if (zonder) { status = '⏱ nodig'; cls = 'nodig'; }
    else { status = '✓ tijden'; cls = 'klaar'; }
    const sel = iso === date;
    const tab = sel || (!geselecteerd && idx === 0) ? 0 : -1;
    html += `<button type="button" class="ws-dag ${cls}${sel ? ' actief' : ''}${iso === vandaag ? ' vandaag' : ''}" data-ws="${iso}" tabindex="${tab}" aria-pressed="${sel}"${sel ? ' aria-current="date"' : ''}` +
      ` aria-label="${WEEKSTROOK_DAG[d.getDay()]} ${d.getDate()}: ${afh.meervoud(stops.length, 'stop', 'stops')}, ${zonder ? zonder + ' zonder tijdstip' : (stops.length ? 'alle tijden klaar' : 'niets gepland')}">` +
      `<span class="ws-naam">${WEEKSTROOK_DAG[d.getDay()]} ${d.getDate()}</span><span class="ws-aantal">${afh.meervoud(stops.length, 'stop', 'stops')}</span><span class="ws-status">${status}</span></button>`;
  });
  html += '</div><button type="button" class="ws-nav" data-ws="volgende" aria-label="Volgende week" title="Volgende week">›</button>';
  el.innerHTML = html;
  if (hadFocus) (el.querySelector('.ws-dag.actief') || el.querySelector('.ws-dag'))?.focus();
  el.querySelector('.ws-dag.actief')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

export function renderRouteList(date) {
  renderTeller++;
  const list  = document.getElementById('route-list');
  renderWeekstrook(date);
  const { stops, allStops } = stopsVoorDag(date);
  // Fix-ronde 1 (#3): slepen mag enkel als de dag (na filter) van hoogstens één technieker is
  // -- anders zou de volgorde/persist-logica tijden van meerdere technici als één
  // sequentiële route door elkaar husselen.
  const eenTechnieker = dagHeeftEenTechnieker(stops);
  // Verouderde route (stops verwijderd/gewisseld, andere dag of filter): kaart en samenvatting
  // leegmaken, markers van de resterende stops opnieuw tekenen; geen automatische TomTom-aanroep.
  if (routeData && (currentRouteDate !== date || routeData._sig !== routeHandtekeningVoorDag(date))) {
    wisRouteWeergave();
    routeVerouderdDatum = allStops.length ? date : null;
    updateMap(date);
  } else if (!routeData && !allStops.length) {
    wisRouteWeergave();
    updateMap(date);
  }
  sorteer?.vernietig(); sorteer = null;
  list.innerHTML = '';
  if (!allStops.length) { list.innerHTML = '<div class="route-empty">Voeg tickets of installaties toe via de Kalender</div>'; return; }
  if (routeVerouderdDatum === date && !(routeData && currentRouteDate === date)) {
    const hint = document.createElement('div');
    hint.className = 'route-tijdbalk route-hint';
    hint.textContent = 'De route is verouderd en van de kaart gehaald. Klik op Bereken tijden om ze opnieuw te tekenen.';
    list.appendChild(hint);
  }
  const zonderTijd = stops.filter(p => stopZonderTijdstip(p, isStopAnchored(p))).length;
  if (zonderTijd) {
    const bar = document.createElement('div');
    bar.className = 'route-tijdbalk';
    bar.innerHTML = `<span>⏱ ${afh.meervoud(zonderTijd, 'ticket', 'tickets')} zonder tijdstip</span>`;
    const knop = document.createElement('button');
    knop.type = 'button'; knop.className = 'btn btn--primary'; knop.textContent = 'Tijden vastleggen';
    // Zelfde pad als slepen: huidige volgorde behouden en de tijdstippen bewaren (ankers blijven staan).
    if (eenTechnieker) {
      knop.title = 'Houdt de huidige volgorde en legt de tijdstippen vast';
      knop.onclick = async () => {
        knop.disabled = true;
        // Vroege returns in applyRouteOrder (meerdere technici, vergrendelstatus niet geladen)
        // her-renderen niet: knop dan weer beschikbaar maken.
        try { await applyRouteOrder(date, allStops.slice()); }
        finally { if (knop.isConnected) knop.disabled = false; }
      };
    } else {
      knop.disabled = true;
      knop.title = 'Kies eerst één technieker via het filter bovenaan';
    }
    bar.appendChild(knop);
    list.appendChild(bar);
  }

  // Bereken cumulatieve aankomsttijden als routeData beschikbaar is
  const hasRoute = !!legsVoorDag(date);
  // Zelfde waypoint-membership test als calculateRoute() (`stops.filter(p => p._lat)` +
  // `localForDate.filter(e => e._lat)`, zie allWpStops in calculateRoute): alleen geocodeerde stops
  // gingen daadwerkelijk als waypoint mee, dus alleen die hebben een leg in routeData.legs.
  // allStops bevat óók de niet-geocodeerde stops (die moeten in de lijst blijven staan), dus
  // legIdx[i] mapt de allStops-index naar de juiste index in routeData.legs. Zonder die
  // mapping schuift elke stop ná een adresloze/niet-geocodeerde stop een leg uit fase —
  // dezelfde bug die Task 13 in openRapport() oploste.
  // Vastgezet tijdstip (via "Toewijzen" of "Datum/tijd wijzigen"): toon dat effectief
  // afgesproken uur i.p.v. de opgetelde rijtijd -- zelfde principe als aankomstTijdenVoorDag()
  // al toepast voor de Kalender/het Voorstel. Geen botsingsdetectie (bewust, zie eerdere
  // designdoc over aankomstTijdenVoorDag). Bij !hasRoute wordt legs=null doorgegeven; het
  // resultaat wordt dan gewoon niet getoond (zie timeHtml hieronder) -- gedrag identiek aan
  // vroeger, enkel de berekening zelf is nu een herbruikbare helper (Taak 4).
  const { arrivalTimes, legIdx } = aankomstenVoorDag(date, allStops);
  const laatsteStartTekst = get('settings').laatsteStart || '16:00';
  const laatsteStartMin = timeStrToMin(laatsteStartTekst);

  allStops.forEach((entry, i) => {
    // Idem: via legIdx i.p.v. i, anders hoort de getoonde rit bij de verkeerde stop.
    // legIdx[i] > 0 vervangt de oude `i > 0`-guard: leg 0 is de rit vertrekpunt→eerste
    // waypoint en wordt (net als voorheen) niet als tussenrit getoond.
    if (hasRoute && legIdx[i] > 0 && routeData.legs[legIdx[i]]) {
      const leg = routeData.legs[legIdx[i]];
      const d   = document.createElement('div');
      d.className   = 'stop-leg';
      d.textContent = `🚗 ${Math.round(leg.travelTimeSeconds / 60)} min · ${(leg.distanceMeters / 1000).toFixed(1)} km`;
      list.appendChild(d);
    }
    const timeHtml = hasRoute && arrivalTimes[i] !== undefined
      ? `<div class="stop-time" data-testid="route-stop-tijd">⏱ ${fmtTijd(arrivalTimes[i])}</div>`
      : '';
    // Brent-besluit (proefperiode): een stop zonder vast uur die de klant niet meer vóór het laatste startuur bereikt,
    // krijgt een duidelijke waarschuwing i.p.v. een stille late tijd; ook voor een vast uur na dat tijdstip (fix-ronde 1).
    const teLaat = isTeLaat(entry, arrivalTimes[i], laatsteStartMin, entry.kind === 'ticket' && isStopAnchored(entry.item));
    const laatHtml = teLaat
      ? `<div class="stop-laat" data-testid="route-stop-laat" role="alert">⚠ Start na het laatste startuur (${escHtml(laatsteStartTekst)}): aankomst ${hasRoute || entry.uur ? '' : '± '}${fmtTijd(arrivalTimes[i])}</div>`
      : '';
    const stop = document.createElement('div');
    stop.className = 'stop';
    stop.dataset.testid = 'route-stop';

    const isTicket = entry.kind === 'ticket';
    // Vergrendeld (Taak 4): tijdstip is aan de klant gecommuniceerd of bevestigd (zie
    // isStopLocked) — niet versleepbaar, het gemailde/herberekende tijdslot wordt extra
    // getoond zodat duidelijk is waarom deze kaart niet meeschuift.
    const locked = isTicket && isStopLocked(entry.item);
    if (locked) stop.classList.add('locked');

    if (isTicket) {
      const item = entry.item;
      const arrKey     = `${date}__${item.ticket.id}`;
      const arrivalHtml = afh.aankomstVoor(arrKey)
        ? `<div class="stop-arrival">✓ Aangekomen ${afh.aankomstVoor(arrKey)}</div>`
        : '';
      const blok = locked ? afh.tijdslotLabelVoor(item, date) : '';
      // M9: het blok komt ofwel uit een effectief gemaild/bevestigd tijdslot (📨), ofwel is het
      // een herberekening op basis van het huidige uur (🕐) -- enkel het eerste geval is
      // daadwerkelijk aan de klant gecommuniceerd.
      const blokIsGemaild = !!(get('voorstelStatus')[item.ticket.id]?.tijdslot && get('voorstelStatus')[item.ticket.id]?.tijdslotDatum === date);
      // C1: voorkeursuur van de klant -- telt als anker in de tijdstip-toekenning
      // (isStopAnchored) maar blijft, i.t.t. isStopLocked, wél versleepbaar als kaart; de
      // marker maakt duidelijk waarom het tijdstip zelf niet meeschuift.
      const heeftVoorkeursuur = !!afh.kbPreferredTime(item.ticket.id);
      stop.innerHTML = `
        <div class="stop-top">
          <div class="stop-num"${locked ? ' title="Tijdstip is aan de klant gecommuniceerd"' : ''}>${i+1}${locked ? '🔒' : ''}${heeftVoorkeursuur ? '<span class="stop-preftime" title="Voorkeursuur van de klant — tijdstip wordt niet verzet">🕐</span>' : ''}</div>
          <div class="stop-info">
            <div class="stop-sub"><span class="stop-numtag" data-testid="route-stop-nummer">#${escHtml(item.ticket.number)}</span>${escHtml(item.ticket.subject) || '—'}</div>
            <div class="stop-addr">${escHtml(item.address) || 'Geen adres'}</div>
            ${timeHtml}${blok ? `<div class="stop-time" data-testid="route-stop-tijd">${blokIsGemaild ? '📨' : '🕐'} ${escHtml(blok)}</div>` : ''}${laatHtml}${arrivalHtml}
            ${(() => {
              const vs = get('voorstelStatus')[item.ticket.id];
              const blabel = afh.bevestigdLabel(vs);
              if (blabel && vs?.bevestigd?.tijdstip) {
                const ts = new Date(vs.bevestigd.tijdstip).toLocaleString('nl-BE', {dateStyle:'short', timeStyle:'short'});
                return `<div class="stop-confirmed-by" title="${escHtml(ts)} — Via welke mail bevestigd werd, niet wie er fysiek op drukte">${escHtml(blabel)}</div>`;
              }
              if ((vs?.contact || vs?.klant || vs?.installateur)) {
                return '<div class="stop-proposal-sent">✉️ Voorstel verstuurd</div>';
              }
              return '';
            })()}
          </div>
        </div>
        <div class="stop-actions">
          <button class="sico btn-navigeer" title="Navigeren" data-adres="${escHtml(item.address||'')}">🧭 Navigeer</button>
          <button class="sico" title="Afspraakvoorstel sturen" data-actie="route-voorstel">📨 Voorstel</button>
          <button class="sico" title="Aankomst registreren" data-actie="route-aankomst">⏱️ Aankomst</button>
          <button class="sico" title="Service rapport" data-actie="route-rapport">📋 Rapport</button>
          <button class="sico" title="Uit planning halen" data-actie="route-uitplannen">✕ Uit planning halen</button>
        </div>`;
      // R9: de knoppen lezen ticket, datum en aankomstminuten van de kaart (dataset i.p.v. inline-strings; waarden blijven exact zoals voorheen).
      stop.dataset.ticketId = item.ticket.id;
      stop.dataset.datum = date;
      stop.dataset.aankomst = hasRoute && arrivalTimes[i] !== undefined ? String(arrivalTimes[i]) : '';
    } else {
      // Lokaal event (installatie / afspraak) — nooit versleepbaar, wel een geldig drop-doel.
      const ev = entry.item;
      const adres = ev.adres || ev.notitie || '';
      const tijdLabel = ev.uur ? `${ev.uur}${ev.einduur ? '–' + ev.einduur : ''}` : '';
      const evArrKey     = `${date}__${ev.id}`;
      const evArrivalHtml = afh.aankomstVoor(evArrKey)
        ? `<div class="stop-arrival">✓ Aangekomen ${afh.aankomstVoor(evArrKey)}</div>`
        : '';
      stop.innerHTML = `
        <div class="stop-top">
          <div class="stop-num" style="background:rgba(124,92,252,0.15);color:#7c5cfc;border-color:#7c5cfc">${i+1}</div>
          <div class="stop-info">
            <div class="stop-sub" style="color:#7c5cfc">${escHtml(ev.type)} — ${escHtml(ev.titel)}</div>
            <div class="stop-addr">${escHtml(adres) || 'Geen adres'}</div>
            ${tijdLabel ? `<div class="stop-time" data-testid="route-stop-tijd" style="color:var(--muted)">🗓 ${tijdLabel}</div>` : ''}
            ${timeHtml}${evArrivalHtml}
            ${ev.persoon ? `<div class="stop-arrival">${escHtml(ev.persoon)}</div>` : ''}
          </div>
        </div>
        <div class="stop-actions">
          ${/\d/.test(afh.telNummer(ev.telefoon)) ? `<a class="sico" href="tel:${escHtml(afh.telNummer(ev.telefoon))}" title="Bellen">📞 Bellen</a>` : ''}
          ${adres ? `<button class="sico btn-navigeer" title="Navigeren" data-adres="${escHtml(adres)}">🧭 Navigeer</button>` : ''}
          <button class="sico" title="Aankomst registreren" data-actie="route-aankomst">⏱️ Aankomst</button>
          <button class="sico btn-ev-details" title="Details">📋 Details</button>
        </div>`;
      stop.dataset.ticketId = ev.id;
      stop.dataset.datum = date;
    }

    // Slepen (Taak 4 + tablet-fase Taak 5): vasthouden en verschuiven via maakSorteerbaar()
    // (zie na de forEach). Enkel niet-vergrendelde tickets zijn zelf versleepbaar; ALLE kaartjes
    // (ook ankers/lokale afspraken) zijn een geldig doel. Fix-ronde 1 (#3): bij meerdere
    // technici is niets versleepbaar (eenTechnieker). data-sleepbaar markeert de kaartjes.
    if (isTicket && !locked) {
      if (eenTechnieker) stop.dataset.sleepbaar = '1';
      else stop.title = 'Kies eerst een technieker om de volgorde aan te passen';
    }

    const navBtn = stop.querySelector('.btn-navigeer');
    navBtn?.addEventListener('click', () => afh.navigate(encodeURIComponent(navBtn.dataset.adres)));
    // ev via closure i.p.v. lookup-string in inline onclick (zelfde reden als .cal-local-del hierboven).
    stop.querySelector('.btn-ev-details')?.addEventListener('click', () => afh.openLocalEventDetail(entry.item));
    list.appendChild(stop);
  });

  // Eén sorteer-instantie per render: de vorige eerst vernietigen (geen dubbele listeners).
  // De .stop-kaartjes staan in DOM-volgorde 1:1 met allStops (stop-leg-regels zijn andere
  // elementen), dus posities = allStops-indices. naar = eindpositie van het verplaatste item
  // (M7: vóór het doel; bij van < naar schuift het doel na het wegsnijden één op -- dat is
  // hier al verrekend in `naar`, ook voor "helemaal achteraan").
  sorteer?.vernietig();
  sorteer = maakSorteerbaar(list, {
    itemSelector: '.stop',
    isVersleepbaar: el => el.dataset.sleepbaar === '1',
    opVolgorde: (van, naar) => {
      const nieuw = allStops.slice();
      const [verplaatst] = nieuw.splice(van, 1);
      nieuw.splice(naar, 0, verplaatst);
      applyRouteOrder(date, nieuw);
    },
  });
  updateRouteBtns(date);
}

export async function calculateRoute() {
  // Nieuwe routeberekening → de wegafsluiting-toast (als die van toepassing is) mag
  // opnieuw één keer verschijnen, ook al roept deze berekening updateMap() nog meermaals
  // aan (rit-vangnet meteen, dan het per-wegvak-detail dat asynchroon binnenkomt).
  herstelWegafsluitingToast();
  const date  = document.getElementById('plan-date').value;
  const { stops, localForDate } = stopsVoorDag(date);
  if (!stops.length && !localForDate.length) return;

  // Cache-hydratatie (punt a) — vóór er iets van TomTom nodig is.
  stops.forEach(p => { if (!p._lat) { const hit = afh.geocacheLookup(p.address); if (hit) { p._lat = hit.lat; p._lon = hit.lon; } } });
  localForDate.forEach(e => { if (!e._lat) { const hit = afh.geocacheLookup(e.adres || e.notitie); if (hit) { e._lat = hit.lat; e._lon = hit.lon; } } });

  // Vroeg inzoomen (punt d) — vóór de netwerkaanroepen, op wat al gekend is.
  zoomOpGekendeStops(stops, localForDate, routeActueelVoor(date));

  const needsGeo      = stops.filter(p => !p._lat && p.ticket?.hasAddress && p.address);
  const localNeedsGeo = localForDate.filter(e => !e._lat);
  let origin = afh.geocacheLookup(get('settings').startlocatie);

  if (needsGeo.length || localNeedsGeo.length) toast('Adressen opzoeken...', 8000);
  else toast('Route berekenen...', 8000);
  try {
    // Gebundelde geocode-aanvraag (i.p.v. 3 sequentiële): needsGeo + localNeedsGeo in ÉÉN
    // /api/optimize-call — optimize.js geocodeert zijn `stops`-array toch al parallel
    // server-side (optimize.js:58-61). `origin` is een verplicht veld van /api/optimize; is de
    // startlocatie al gekend uit de cache, dan sturen we 'm toch mee (anders faalt de aanvraag
    // op "Missing origin"), maar negeren we `locations[0]` van het antwoord. Is er helemaal
    // niets te geocoderen (alles al gekend, incl. startlocatie), dan wordt /api/optimize
    // volledig overgeslagen.
    if (needsGeo.length || localNeedsGeo.length || !origin) {
      const combinedAdressen = [...needsGeo.map(p => p.address), ...localNeedsGeo.map(e => e.adres || e.notitie)];
      const gData = (await apiVerzoek('/api/optimize', {
        methode: 'POST',
        body:    {
          origin: get('settings').startlocatie,
          stops:  combinedAdressen.length ? combinedAdressen : [get('settings').startlocatie],
        },
      })).data;
      if (gData.locations) {
        let i = 1;
        needsGeo.forEach(p => { const loc = gData.locations[i++]; if (loc) { p._lat = loc.lat; p._lon = loc.lon; afh.geocacheStore(p.address, loc.lat, loc.lon); } });
        localNeedsGeo.forEach(e => { const loc = gData.locations[i++]; if (loc) { e._lat = loc.lat; e._lon = loc.lon; afh.geocacheStore(e.adres || e.notitie, loc.lat, loc.lon); } });
        if (!origin && gData.locations[0]) { origin = gData.locations[0]; afh.geocacheStore(get('settings').startlocatie, origin.lat, origin.lon); }
      }
      // (C2b/I2) /api/optimize is nu tolerant voor losse mislukte stops (Promise.allSettled,
      // zie optimize.js) en geeft enkel een harde fout terug als het VERTREKPUNT zelf niet
      // gevonden werd (statusCode 400 + `error`, geen `locations`). Toon in dat geval de echte
      // serverfout i.p.v. altijd dezelfde vaste "Startlocatie niet gevonden"-melding.
      if (!origin) throw new Error(gData.error || `Vertrekpunt '${get('settings').startlocatie}' kon niet opgezocht worden`);
    }
    if (!origin) throw new Error(`Vertrekpunt '${get('settings').startlocatie}' kon niet opgezocht worden`);
    toast('Route berekenen...', 8000);
    // Combineer geocoded Zoho stops + lokale events als waypoints, gesorteerd op ingesteld
    // uur (geen uur = achteraan) zodat de route de echte geplande volgorde volgt i.p.v.
    // altijd Zoho-tickets vóór handmatige afspraken te zetten.
    // Zelfde volgorde als de lijst (stopsVoorDag, gedeelde plaatsingsregel), anders klopt legIdx niet.
    const allWpStops = stopsVoorDag(date).allStops.map(e => e.item).filter(p => p._lat);
    const wps = [{ lat: origin.lat, lon: origin.lon }, ...allWpStops.map(p => ({ lat: p._lat, lon: p._lon }))];
    if (wps.length < 2) return;
    // Vertrektijd = vroegste geplande uur van de dag (of settings.vanTijd zonder vaste uren).
    // TomTom rekent dan met historische verkeerspatronen voor die dag/dat uur i.p.v. het
    // verkeer van nu; verleden/vandaag zonder toekomstig tijdstip → live verkeer (geen departAt).
    // Fix-ronde 1: de eerste stop in de werkelijke volgorde (een stop zonder uur vóór een vast uur start om vanTijd).
    const tijd    = allWpStops[0]?.uur || get('settings').vanTijd;
    const vertrek = new Date(`${date}T${tijd}:00`);
    const departAt = vertrek > new Date() ? vertrek.toISOString() : undefined;
    const rData = (await apiVerzoek('/api/route', {
      methode: 'POST',
      body:    { waypoints: wps, departAt },
    })).data;
    if (rData.error) throw new Error(rData.error);
    // Ondertussen een andere dag gekozen: dit (verouderde) antwoord niet meer tonen.
    if (document.getElementById('plan-date').value !== date) return;
    routeData = rData; currentRouteDate = date; routeData._sig = routeHandtekeningVoorDag(date); routeVerouderdDatum = null;
    renderRouteList(date);
    updateMap(date);
    document.getElementById('s-dist').textContent  = (rData.totalDistanceMeters / 1000).toFixed(0) + ' km';
    document.getElementById('s-time').textContent  = fmtSec(rData.totalTravelTimeSeconds);
    // Live vertraging (trafficDelaySeconds) is bij een toekomstig departAt altijd ~0 —
    // TomTom levert dan geen live sections. Val in dat geval terug op het verschil tussen
    // de historische (typische) reistijd en de vrije doorstroming als "verwachte" vertraging.
    const verwachtVerschil = (rData.totalHistoricTrafficTravelTimeSeconds != null && rData.totalNoTrafficTravelTimeSeconds != null)
      ? rData.totalHistoricTrafficTravelTimeSeconds - rData.totalNoTrafficTravelTimeSeconds
      : 0;
    if (rData.totalTrafficDelaySeconds > 60) {
      document.getElementById('s-delay').textContent = '+' + fmtSec(rData.totalTrafficDelaySeconds);
    } else if (verwachtVerschil > 60) {
      document.getElementById('s-delay').textContent = '+' + fmtSec(verwachtVerschil) + ' (verwacht)';
    } else {
      document.getElementById('s-delay').textContent = 'geen';
    }
    document.getElementById('s-eta').textContent   = rData.arrivalTime ? new Date(rData.arrivalTime).toLocaleTimeString('nl-BE', { hour:'2-digit', minute:'2-digit' }) : '—';
    // (C2c) Stops die nog steeds geen coördinaten hebben na de geocode-stap hierboven (adres
    // niet gevonden, of een lokale afspraak met een vrije-tekst-notitie i.p.v. een echt adres)
    // staan niet op `allWpStops`/de berekende route -- dat gebeurt stil, dus altijd één duidelijke
    // toast i.p.v. de gewone "Route berekend ✓" als dat hier is voorgevallen. De route zelf is al
    // berekend en getekend (updateMap() hierboven) mét de rest van de stops.
    const nietGevonden = needsGeo.filter(p => !p._lat).length + localNeedsGeo.filter(e => !e._lat).length;
    if (nietGevonden > 0) {
      toast(`⚠ ${nietGevonden} adres(sen) niet gevonden — die stops staan niet op de route`, 6000);
    } else {
      toast('Route berekend ✓');
    }
    // Zonder await: de kaart met het rit-vangnet staat al, het per-wegvak-detail kleurt na.
    laadDrukteDetail(date, rData);
  } catch (err) { toast('✕ Route: ' + foutTekst(err), 4000); updateMap(date); }
}

// Verwachte drukte per wegvak (i.p.v. per rit) voor een toekomstige dag: haalt TomTom's
// historische reistijd per ±1,5 km-stukje op via /api/drukte, ná de gewone routeberekening.
// Enkel zinvol als er een toekomstig departAt is (anders geeft route.js al live sections).
async function laadDrukteDetail(date, rData) {
  // rData.sections?.length blokkeert dit niet meer: TomTom geeft voor een toekomstig
  // departAt wél sections terug, maar dat zijn geplande wegenwerken/afsluitingen (geen
  // drukte-signaal) — zie updateMap() voor hoe die er los bovenop getekend worden.
  if (!get('settings').drukteKleuring || !rData.departAtUsed || !(rData.polyline?.length >= 2)) return;
  toast('Drukte laden...', 4000);
  try {
    const data = (await apiVerzoek('/api/drukte', {
      methode: 'POST',
      body:    { polyline: rData.polyline, departAt: rData.departAtUsed, segmentMeters: DRUKTE_SEGMENT_METERS },
    })).data;
    if (data.error) throw new Error(data.error);
    // De route kan ondertussen vervangen zijn door een nieuwe berekening — dan is dit
    // detail verouderd en negeren we het.
    if (routeData === rData && currentRouteDate === date) {
      rData.drukteDetail = data.segmenten;
      rData.drukteDetailInfo = { reconstructie: data.reconstructie, onbetrouwbaar: data.onbetrouwbaar, aantalAanvragen: data.aantalAanvragen };
      console.info('drukte-detail:', rData.drukteDetailInfo);
      updateMap(date);
    }
  } catch (err) {
    console.warn('Drukte-detail niet beschikbaar:', err);
  }
}

// Lengte van de wegvak-stukjes voor het /api/drukte-detail (zie laadDrukteDetail) — een
// instelling is YAGNI, dit is geen keuze die een gebruiker per rit wil aanpassen.
const DRUKTE_SEGMENT_METERS = 1500;

// applyRouteOrder(date, orderedEntries): vertaalt een gewenste allStops-volgorde
// ({kind,item,uur}[], alle stops van de dag voor de actieve filter incl. ankers) naar
// concrete tijdstippen en bewaart die (Taak 4, Beslissing Brent 2026-09-21). Aangeroepen door
// de drop-handlers hierboven én door optimizeRoute().
export async function applyRouteOrder(date, orderedEntries) {
  // Fix-ronde 1 (#3, defensief): dagHeeftEenTechnieker() blokkeert dit al in de UI (niet
  // versleepbaar / Optimaliseren geeft een toast), maar dit is de laatste linie zodat geen
  // enkel code-pad ooit tijden van meerdere technici als één sequentiële route kan bewaren.
  const ticketItems = orderedEntries.filter(e => e.kind === 'ticket').map(e => e.item);
  if (!dagHeeftEenTechnieker(ticketItems)) {
    return toast('⚠ Kies eerst een technieker — de dag bevat stops van meerdere technici');
  }

  // I4 (eindreview v1.4.0): vanaf hier tot de finally muteert deze functie planning[date]-
  // objecten -- de 5-min ticket-poll moet in die periode geen loadTickets() draaien (zie
  // startTicketPolling()).
  _routeOrderBezig = true;
  try {
  // I3 (eindreview v1.4.0): vergrendelstatus verversen vóórdat we beslissen wat anker is en
  // wat niet -- anders kan een net (elders) verstuurd voorstel/bevestiging hier nog als "vrij"
  // behandeld worden en per ongeluk verplaatst/herpost worden. isStopLocked/isStopAnchored
  // hieronder lezen allemaal uit de globale `voorstelStatus`, dus deze ene refresh vóór stap 1
  // volstaat om de rest van de functie op verse data te laten werken.
  const statusOk = await afh.loadVoorstelStatus();
  if (!statusOk) {
    return toast('✕ Vergrendelstatus kon niet geladen worden — volgorde niet bewaard', 5000);
  }

  // Fix-ronde 1 (#4): originele uren van de verplaatsbare tickets bewaren vóór we ze in stap 1
  // overschrijven, zodat we bij een mislukte routeberekening niets hoeven te gokken en alles
  // gewoon kunnen terugdraaien i.p.v. de ruwe 30-min-schatting te bewaren.
  // C1: isStopAnchored (i.p.v. isStopLocked) zodat ook voorkeursuur-tickets hier als anker
  // gelden -- hun uur wordt nooit overschreven, dus hoeft ook nooit teruggedraaid te worden.
  const origineleUren = new Map();
  for (const entry of orderedEntries) {
    if (entry.kind === 'ticket' && !isStopAnchored(entry.item)) {
      origineleUren.set(entry, entry.item.uur);
    }
  }
  const restoreOrigineleUren = () => {
    for (const [entry, origUur] of origineleUren) {
      entry.uur = origUur;
      entry.item.uur = origUur;
    }
  };

  // I2: begrenzing van de dagklok -- zie buitenDagklok.
  const buitenDagklok = (minutenRuw, uurStr) => buitenDagklokTijd(minutenRuw, uurStr, get('settings').totTijd);
  const abortDagklok = () => {
    restoreOrigineleUren();
    toast('✕ Te veel stops voor één dag — volgorde niet bewaard', 5000);
    renderRouteList(date);
    updateMap(date);
    updateRouteBtns(date);
  };

  // Stap 1: voorlopige uren toekennen zodat de bestaande uur-sort (renderRouteList/
  // calculateRoute/updateMap) de gesleepte volgorde exact reproduceert, nog vóór er een
  // (nieuwe) route berekend is. Ankers (lokale afspraken + vergrendelde/voorkeursuur-tickets)
  // behouden hun eigen uur als vast punt — de klok springt ernaartoe vooruit (nooit terug);
  // verplaatsbare tickets krijgen een ruwe 30-min-reistijd-schatting, die stap 3 hieronder
  // verfijnt met de echte (TomTom-)reistijden zodra die gekend zijn.
  let cur = timeStrToMin(get('settings').vanTijd || '08:00');
  for (const entry of orderedEntries) {
    const item = entry.item;
    const isAnker = entry.kind === 'local' || isStopAnchored(item);
    if (isAnker) {
      if (item.uur) cur = Math.max(cur, timeStrToMin(item.uur));
      const duur = entry.kind === 'ticket'
        ? afh.duurVoor(item.ticket.id)
        : (afh.werktijdMin(item.uur, item.einduur) || 60);
      cur += duur;
    } else {
      cur += 30;
      const nieuwUur = afh.roundToNextQuarterStr(minToTimeStr(cur));
      if (buitenDagklok(cur, nieuwUur)) { abortDagklok(); return; }
      item.uur = nieuwUur;
      cur = timeStrToMin(item.uur) + afh.duurVoor(item.ticket.id);
    }
  }

  // Stap 2: route herberekenen in de nieuwe volgorde — calculateRoute() sorteert intern zelf
  // weer op `uur` (zie allWpStops), wat nu exact de hierboven toegekende volgorde oplevert.
  const dateInp = document.getElementById('plan-date');
  if (dateInp && dateInp.value !== date) dateInp.value = date;
  routeData = null;
  await calculateRoute();

  // Fix-ronde 1 (#4): geen (geldige) route → nooit gokken. De ruwe stap-1-schatting is geen
  // betrouwbare tijd om te tonen/bewaren, dus alles terugdraaien naar de originele uren en
  // stoppen (geen verfijning, geen persist).
  if (!legsVoorDag(date)) {
    restoreOrigineleUren();
    toast('✕ Route kon niet berekend worden — volgorde niet bewaard', 5000);
    renderRouteList(date);
    updateMap(date);
    updateRouteBtns(date);
    return;
  }

  // Stap 3: de ruwe (30-min-fallback) uren van de verplaatsbare tickets vervangen door tijden
  // gebaseerd op de echte reistijden. Draait ook in testmodus (enkel stap 4 hieronder, het
  // echte persisteren, wordt daar overgeslagen) zodat dit ook lokaal testbaar is.
  //
  // Ontwerpkeuze (zie brief, ter documentatie): berekenAankomsten() springt naar `entry.uur`
  // zodra dat gezet is (bestaand "vastgezet tijdstip"-gedrag, nodig voor ankers). Na stap 1
  // hebben ook de verplaatsbare tickets al een (ruw) uur — een aanroep zou voor hen dus altijd
  // gewoon naar dat reeds bestaande uur "springen" en de echte routeData.legs volledig
  // negeren, hoe vaak je de aanroep ook herhaalt. In plaats daarvan wissen we hier eenmalig het
  // `uur` van de verplaatsbare entries vóór de aanroep (ankers blijven ongemoeid) — de array-
  // volgorde ligt al vast via de sort hierboven, enkel de uur-waarden worden verfijnd — zodat
  // de cumulatieve klok voor hen wél op de echte legSec steunt. Eén aanroep volstaat zo.
  //
  // FIX (ronde 1, #1 CRITICAL): berekenAankomsten() leest het WRAPPER-veld `entry.uur` (dat bij
  // de opbouw hieronder als snapshot `uur: s.uur` wordt meegegeven), niet `entry.item.uur`. De
  // eerste versie wiste enkel `entry.item.uur`, waardoor de (stale) wrapper-waarde bleef staan
  // en elke entry gewoon naar dat oude uur "sprong" -- de verfijning was zo een complete no-op
  // en de bewaarde tijden waren altijd de ruwe stap-1-gok. Beide velden moeten dus gewist én
  // teruggeschreven worden.
  const { stops, allStops } = stopsVoorDag(date);

  for (const entry of allStops) {
    if (entry.kind === 'ticket' && !isStopAnchored(entry.item)) {
      entry.uur = undefined;
      entry.item.uur = undefined;
    }
  }
  const { arrivalTimes } = aankomstenVoorDag(date, allStops);
  for (let i = 0; i < allStops.length; i++) {
    const entry = allStops[i];
    if (entry.kind === 'ticket' && !isStopAnchored(entry.item)) {
      const nieuwUur = afh.roundToNextQuarterStr(minToTimeStr(arrivalTimes[i]));
      // I2: ook de verfijnde (echte-reistijd) uren begrenzen -- de stap-1-schatting kon binnen
      // de klok vallen, maar de echte reistijden kunnen nog altijd over de grens duwen.
      if (buitenDagklok(arrivalTimes[i], nieuwUur)) { abortDagklok(); return; }
      entry.uur = nieuwUur;
      entry.item.uur = nieuwUur;
    }
  }

  // Fix-ronde 1 (Brent-besluit): een nieuw vastgelegd tijdstip na `laatsteStart` is een late start. Eerst een waarschuwing met
  // bevestiging, vóór er iets geschreven wordt. Annuleren zet de oorspronkelijke uren terug en bewaart niets.
  {
    const laatsteStartTekst = get('settings').laatsteStart || '16:00';
    const laatsteStartMin = timeStrToMin(laatsteStartTekst);
    const laat = [];
    allStops.forEach((entry, i) => {
      if (entry.kind === 'ticket' && !isStopAnchored(entry.item) && isTeLaat(entry, arrivalTimes[i], laatsteStartMin)) {
        laat.push(`#${entry.item.ticket.number}: aankomst ${entry.item.uur}`);
      }
    });
    if (laat.length) {
      const doorgaan = await afh.bevestigLateStops({ regels: laat, laatsteStart: laatsteStartTekst });
      if (!doorgaan) {
        restoreOrigineleUren();
        wisRouteWeergave();
        routeVerouderdDatum = date;
        toast('Niet bewaard — de oorspronkelijke volgorde en tijden zijn teruggezet', 5000);
        renderRouteList(date);
        updateMap(date);
        updateRouteBtns(date);
        return;
      }
    }
  }

  // Stap 4: persisteren naar Zoho — overgeslagen in testmodus (dummy ticket-id's zijn niet
  // numeriek; /api/plan-datum accepteert enkel numerieke Zoho-ticket-id's). `stops` is
  // hetzelfde gefilterde array als hierboven in stap 3 (membership verandert niet door de
  // uur-mutaties) -- hergebruikt i.p.v. opnieuw op te bouwen. C1: isStopAnchored zodat een
  // voorkeursuur-ticket nooit gepost wordt, ook al staat het (toevallig) niet op zijn oude uur.
  if (!afh.testModus()) {
    for (const item of stops) {
      if (isStopAnchored(item)) continue;
      const huidigUur = extractLocalHour(item.ticket.interventieDatum);
      if (item.uur === huidigUur) continue;
      const utcInterventieDatum = new Date(`${date}T${item.uur}:00`).toISOString();
      try {
        const res  = await fetch('/api/plan-datum', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ticketId: item.ticket.id, utcInterventieDatum }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Onbekende fout');
        item.ticket.interventieDatum = utcInterventieDatum;
      } catch (err) {
        toast('✕ Volgorde bewaren mislukt voor #' + item.ticket.number, 5000);
        await afh.loadTickets({ stilleToast: true, zonderCache: true, negeerSchrijfstand: true }); // W5-fix (N8) (negeerSchrijfstand slaat de HELE schrijfstand-controle over, niet enkel het routedeel; bekend restant, zeldzaam, bewust gelaten omdat het smaller maken de planacties-teller raakt (W11); negeerSchrijfstand: deze herlading is de enige schrijver terwijl de route bezig is): nooit de bewaarde kopie terugzetten; anders overschrijft de telmelding de foutmelding meteen
        return;
      }
    }
  }

  // M8 (eindreview v1.4.0): de opgeslagen volgorde kan afwijken van de gevraagde sleep-/
  // optimaliseer-volgorde, omdat ankers (vergrendeld of voorkeursuur) altijd op hun eigen uur
  // blijven staan en de rest daar omheen herschikt wordt. Na stap 3 hebben alle verplaatsbare stops een uur, dus sorteren op
  // `uur` (geen uur = achteraan) komt overeen met de volgorde die renderRouteList (plaatsingsregel) nadien toont.
  const idVoor = e => e.kind === 'ticket' ? `t:${e.item.ticket.id}` : `l:${e.item.id}`;
  const uiteindelijkeVolgorde = allStops
    .slice()
    .sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'))
    .map(idVoor);
  const gevraagdeVolgorde = orderedEntries.map(idVoor);
  const volgordeAangepast = uiteindelijkeVolgorde.length !== gevraagdeVolgorde.length
    || uiteindelijkeVolgorde.some((id, i) => id !== gevraagdeVolgorde[i]);

  // Stap 5: UI verversen.
  renderRouteList(date);
  updateMap(date);
  afh.renderKalender();
  updateRouteBtns(date);
  toast(volgordeAangepast
    ? 'ℹ️ Volgorde aangepast rond een vast tijdstip'
    : '✓ Volgorde en tijdstippen bijgewerkt');
  } finally {
    _routeOrderBezig = false;
  }
}

export async function optimizeRoute() {
  const date  = document.getElementById('plan-date').value;
  // Zelfde filter als renderRouteList() — stops van andere technici raakt deze functie nooit
  // aan (die zitten simpelweg niet in `stops`/`localForDate`, en applyRouteOrder() muteert
  // enkel de objecten die het zelf meekrijgt).
  const { stops, localForDate } = stopsVoorDag(date);

  // Fix-ronde 1 (#3, Controller-ruling): niet optimaliseren zolang de dag (na filter) stops
  // van meerdere technici bevat -- anders zou de resulterende volgorde/tijden hen als één
  // sequentiële route door elkaar husselen. Zelfde regel als in renderRouteList() voor drag.
  if (!dagHeeftEenTechnieker(stops)) {
    return toast('⚠ Kies eerst een technieker — de dag bevat stops van meerdere technici');
  }

  // Optimaliseren start altijd vanaf nul (Beslissing Brent, 2026-09-21): negeert de
  // sleepvolgorde/huidige uren van vrije tickets. Ankers (lokale afspraken + vergrendelde
  // tickets, incl. bevestigde afspraken) blijven op hun uur staan; enkel de rest wordt vrij
  // herschikt via TomTom.
  // C1: isStopAnchored (i.p.v. isStopLocked) zodat een ticket met een voorkeursuur van de
  // klant ook bij "Optimaliseren" op zijn uur blijft staan en nooit door TomTom herschikt
  // wordt -- enkel de écht vrije tickets gaan mee in de optimalisatie-aanvraag.
  const ankers = [
    ...localForDate.map(e => ({ kind: 'local', item: e, uur: e.uur })),
    ...stops.filter(p => isStopAnchored(p)).map(p => ({ kind: 'ticket', item: p, uur: p.uur })),
  ];
  const vrij   = stops.filter(p => !isStopAnchored(p) && p.ticket?.hasAddress && p.address);
  const noAddr = stops.filter(p => !isStopAnchored(p) && (!p.ticket?.hasAddress || !p.address));

  if (vrij.length < 2) return toast('Minimaal 2 verplaatsbare stops met adres nodig voor optimalisatie');
  toast('Route optimaliseren...', 8000);
  try {
    const data = (await apiVerzoek('/api/optimize', {
      methode: 'POST',
      body:    { origin: get('settings').startlocatie, stops: vrij.map(p => p.address) },
    })).data;
    if (data.error) throw new Error(data.error);
    // /api/optimize geeft 200 + locations + optimizeError als geocoding lukte maar de
    // waypoint-optimalisatie niet. Dan de bestaande volgorde behouden (nooit planning[date]
    // herschrijven op basis van een onbetrouwbare/ontbrekende optimizedOrder), maar de
    // coördinaten wél bewaren zodat calculateRoute() niet opnieuw hoeft te geocoderen.
    if (data.optimizeError || !Array.isArray(data.optimizedOrder)
        || data.optimizedOrder.length !== vrij.length) {
      vrij.forEach((p, i) => {
        const loc = data.locations?.[i+1];
        if (loc) { p._lat = loc.lat; p._lon = loc.lon; afh.geocacheStore(p.address, loc.lat, loc.lon); }
      });
      toast('⚠ Optimalisatie niet beschikbaar — volgorde ongewijzigd', 4500);
      renderRouteList(date);
      await calculateRoute();
      return;
    }
    // Muteer de bestaande objecten i.p.v. kopieën te maken, zodat planning[date] dezelfde
    // referenties blijft bevatten.
    const geoptimaliseerd = data.optimizedOrder.map(i => {
      const p   = vrij[i];
      const loc = data.locations?.[i+1];
      if (loc) { p._lat = loc.lat; p._lon = loc.lon; afh.geocacheStore(p.address, loc.lat, loc.lon); }
      return p;
    });
    const samengevoegd = mergeMetAnkers(geoptimaliseerd, ankers,
      { vanTijd: get('settings').vanTijd, duurVoor: afh.duurVoor, werktijdMin: afh.werktijdMin });
    // Adresloze niet-vergrendelde tickets konden sowieso niet meegerekend worden — achteraan.
    noAddr.forEach(p => samengevoegd.push({ kind: 'ticket', item: p, uur: p.uur }));
    await applyRouteOrder(date, samengevoegd);
  } catch (err) { toast('✕ ' + foutTekst(err), 4000); await calculateRoute(); }
}
