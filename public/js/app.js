// public/js/app.js — de app-schil (etappe 5b, taak 8; D3, D23): het voormalige klassieke `<script defer>` van index.html,
// nu een module en de LAATSTE `<script type="module">`. Het start zichzelf (geen exports).
// Moduleruimte i.p.v. klassiek script: top-level `let`/`function` zijn geen window-globals meer; wat de oudere modules
// van dit bestand nodig hadden, staat in kern/opslag.js, kern/verklikker.js, kern/ui.js (metBehoudScroll) of komt via
// `afh`. Cyclusregel: schermmodules importeren dit bestand nooit; dit bestand importeert uit hen.
// Een module draait na het parsen en vóór DOMContentLoaded, in documentvolgorde (zoals het `defer`-script); de
// voormalige DOMContentLoaded-handler heet nu `opstart()` en wordt onderaan dit bestand geregistreerd (zie daar).
import { foutTekst } from './kern/api.js';
import { toestand } from './kern/toestand.js';
import { TEST_MODE } from './kern/omgeving.js';
import { localISO, extractLocalHour } from './kern/tijd.js';
import { startTicketLogExport } from './kern/exceljs.js';
import { toast, registreerActies, metBehoudScroll } from './kern/ui.js';
import { ticketsVanTechnieker } from './kern/selecties.js';
import { maakDummyData } from './kern/testdata.js';
import { sjLog, sjZetTab, startVerklikker } from './kern/verklikker.js';
import { loadFromCache, saveToCache, geocacheLookup, geocacheStore } from './kern/opslag.js';
import * as route from './schermen/route.js';
import { renderRouteList, updateRouteBtns, calculateRoute, aankomstTijdenVoorDag as computeArrivalTimes } from './schermen/route.js';
import { initMap, applyKaartStijl } from './schermen/route-kaart.js';
import { renderKalender } from './schermen/kalender.js';
import * as routeKaart from './schermen/route-kaart.js';
import * as capaciteit from './schermen/capaciteit.js';
import * as wachtrij from './schermen/wachtrij.js';
import * as kalender from './schermen/kalender.js';
import * as ingepland from './schermen/ingepland.js';
import * as ticketdetailLogica from './schermen/ticketdetail-logica.js';
import * as ticketdetail from './schermen/ticketdetail.js';
import * as voorstel from './schermen/voorstel.js';
import * as annuleren from './schermen/annuleren.js';
import * as klantbeschikbaarheid from './schermen/klantbeschikbaarheid.js';
import * as beschikbaarheid from './schermen/beschikbaarheid.js';
import * as afspraken from './schermen/afspraken.js';
import * as instellingen from './schermen/instellingen.js';
import * as fotos from './schermen/fotos.js';
import * as rapportVerzenden from './schermen/rapport-verzenden.js';
import * as planacties from './schermen/planacties.js';
import { meervoud } from './schermen/ticketdetail-logica.js';
import { openPrijsBeheer, closePrijsBeheer, prijsReset, prijsOpslaan, loadPrijzen } from './prijzen.js';
import { openRapport, calcWerktijdMin, closeWizard, wizBack, wizNext } from './rapport-wizard.js';
import { _rapportArchief, _archiefVersie, zetArchiefVersie, laadRapportArchief, setRapportFilter, renderRapportArchief, herOpenRapport } from './rapport-archief.js';
import { refreshOutboxCache, flushOutbox } from './outbox.js';
import { _invData, loadInventaris, renderInventaris, updateInventarisBadge, resetInvSeenLog } from './inventaris.js';
import { appConfirm } from './app-dialog.js';
import { registreerVenster } from './venster.js';
import { startNaInlog } from './schermen/rol-schil.js';
import { laadTab } from './kern/navigatie.js';
import { installeerTijdPicker } from './kern/tijd-picker.js';


// Leesbare toegang tot de toestand: de plaats van de vroegere window-accessors (kern/brug.js) voor allTickets, planning, settings, ...
const get = k => toestand.get(k);
const set = (k, v) => toestand.set(k, v);

// ══════════════════════════════════════════════
// TESTMODUS: ?test in URL laadt dummy data
// ══════════════════════════════════════════════
// Het klassieke script van index.html lost hier op in een module (etappe 5b, D23): mechanische poort, geen logica.
// De opstartverzoeken, de volgorde van de luisteraars en alle namen blijven; wat vroeger een kale global was, is nu een import.
const DUMMY_DATA = maakDummyData(Date.now());

// escHtml verhuist naar kern/ui.js

// Vertaalt de ruwe Zoho-prioriteitswaarde (high/medium/low, wisselende hoofdletter) naar de
// Nederlandse UI-tekst. Dezelfde vertaling als excel-export.js's PRIO_NL (UX-ronde 2026-09-22,
// item 1) -- t.priority zelf blijft ongewijzigd, enkel de weergave verandert.
const PRIO_LABEL = { high: 'Hoog', medium: 'Middel', low: 'Laag' };
function prioLabel(priority) {
  return PRIO_LABEL[(priority || '').toLowerCase()] || priority || '';
}

// ══════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════
// planning: { "2026-06-23": [{ ticket, address, _lat, _lon }] }; Zoho is bron van waarheid (allPending seedt planning bij laden).
// allTickets, allPending, allGepland, planning, localEvents, avExceptions, klantBeschikbaarheid, voorstelStatus,
// settings en activeAssigneeFilter leven in toestand; hier via get('<sleutel>') en set('<sleutel>', waarde) (voorheen window-accessors uit kern/brug.js).
// activeBlockDate → vervangen door _avFormDate (zie beschikbaarheidssysteem)
// (drag-blokkering verwijderd — vervangen door beschikbaarheidssysteem)
// Live-detectie van nieuwe Inventaris-log-regels (enkel relevant op de supervisor-weergave,
// "Alle technici") -- bewust HIER, niet in inventaris.js: enkel de app-schil van deze
// pagina (app.js) leest activeAssigneeFilter (zie CLAUDE.md/module-conventie).
let _invPollTimer = null;

function startInvPoll() {
  stopInvPoll(); // idempotent: nooit twee actieve timers naast elkaar
  _invPollTimer = setInterval(() => {
    if (get('activeAssigneeFilter') !== 'all') return;
    const versieVoor = _invData.versie;
    loadInventaris().then(() => {
      if (_invData.versie === versieVoor) return; // niets gewijzigd -- geen onnodige re-render
      metBehoudScroll(() => {
        renderInventaris(get('activeAssigneeFilter'));
        updateInventarisBadge(get('activeAssigneeFilter'));
      });
    });
  }, 30000);
}

function stopInvPoll() {
  if (_invPollTimer) { clearInterval(_invPollTimer); _invPollTimer = null; }
}

// Effectieve interventieduur voor een ticket: override ?? globale standaard
function duurVoor(id) {
  const override = klantbeschikbaarheid.kbFor(id)?.duurOverride;
  return (override && override > 0) ? override : (get('settings').duurMinuten || 120);
}

// Migratie: old localStorage data verwijderen
localStorage.removeItem('blitz_blocked');
localStorage.removeItem('blitz_blocked_days');

// De instellingen (DEFAULT_SETTINGS, laden en bewaren per technieker) staan in schermen/instellingen.js.
// settings: gezaaid in DOMContentLoaded (hieronder)

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
// ── Eenmalige migratie: vervang oud Geel-adres door nieuw Kruibeke-adres ──
if (!localStorage.getItem('blitz_mig_startloc_v1')) {
  const OLD = 'Blitz Power, Geel';
  Object.keys(localStorage)
    .filter(k => k === 'blitz_settings' || k.startsWith('blitz_settings_'))
    .forEach(key => {
      try {
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        if (s.startlocatie === OLD) {
          s.startlocatie = instellingen.DEFAULT_SETTINGS.startlocatie;
          localStorage.setItem(key, JSON.stringify(s));
        }
      } catch {}
    });
  localStorage.setItem('blitz_mig_startloc_v1', '1');
}

// De opstartreeks (voorheen de DOMContentLoaded-handler van het klassieke script). Een module-script draait vóór DOMContentLoaded
// (readyState is dan 'interactive'), dus de handler wordt, net als vroeger, pas na het parsen en na alle modules uitgevoerd.
// Het registreren gebeurt onderaan dit bestand, nadat alle `const`/`let` van deze module bestaan.
function opstart() {
  // De rapport-wizard sluit via Escape/achtergrond met closeWizard (vraagt zelf een bevestiging); de andere vensters registreren zichzelf in hun init.
  registreerVenster({ el: document.getElementById('rapport-wizard'), sluit: closeWizard });
  // Klantbeschikbaarheid (schermen/klantbeschikbaarheid.js): laden, bewaren en de sectie in het detail; vóór de schermen die ze lezen.
  // Beschikbaarheid (schermen/beschikbaarheid.js): blokkeringsvenster en instellingen-tab; vóór de schermen die ze openen.
  beschikbaarheid.initBeschikbaarheid({ loadFromCache, saveToCache, sjLog });
  klantbeschikbaarheid.initKlantbeschikbaarheid({ loadFromCache, saveToCache, zetKbDirty: ticketdetail.zetKbIsDirty, renderTickets: wachtrij.renderTickets });
  // Instellingen (schermen/instellingen.js): instellingenvenster, toesteltab en de knoppen van het prijsbeheer; vóór `settings` gezaaid wordt.
  instellingen.initInstellingen({
    openPrijsBeheer: openPrijsBeheer, closePrijsBeheer: closePrijsBeheer,
    prijsReset: prijsReset, prijsOpslaan: prijsOpslaan,
    renderTickets: wachtrij.renderTickets, renderKalender: kalender.renderKalender, vernieuwKaart: route.vernieuwKaart,
  });
  // Foto's (schermen/fotos.js) en rapport verzenden (schermen/rapport-verzenden.js): vensters, knoppen en de Zoho-oplossing; vóór de schermen die ze openen.
  fotos.initFotos();
  rapportVerzenden.initRapportVerzenden({
    rapportArchief: () => _rapportArchief, archiefVersie: () => _archiefVersie, zetArchiefVersie,
    renderRapportArchief: () => renderRapportArchief(),
  });
  // Afspraken (schermen/afspraken.js): eigen afspraken, lokaal detail en import; vóór de schermen die ze openen.
  afspraken.initAfspraken({
    loadFromCache, saveToCache, sjLog, meervoud, navigate, openFotoModal: fotos.openFotoModal,
    registerArrival: ticketdetail.registerArrival, openRapport: (...a) => openRapport(...a),
  });
  // Capaciteit (schermen/capaciteit.js): leest `settings` pas bij gebruik; vóór koppelRenders().
  capaciteit.initCapaciteit({ duurVoor, werktijdMin: (a, b) => calcWerktijdMin(a, b), kbPreferredTime: klantbeschikbaarheid.kbPreferredTime });
  // Wachtrij-scherm (schermen/wachtrij.js): zoek/sorteer-luisteraars en de afhankelijkheden van andere schermen; vóór koppelRenders().
  wachtrij.initWachtrij({
    addTicketToDate: planacties.addTicketToDate, openDetail: ticketdetail.openDetail, prioLabel, kbFor: klantbeschikbaarheid.kbFor, kbPreferred: klantbeschikbaarheid.kbPreferred, kbPreferredTime: klantbeschikbaarheid.kbPreferredTime, meervoud,
    inFlight: planacties.inFlight, sjLog,
  });
  // Kalender-scherm (schermen/kalender.js): kaartjes, tijdlijn, weergaven, navigatie en hoogte-effecten; vóór koppelRenders().
  kalender.initKalender({
    tijdslotLabelVoor: ticketdetail.tijdslotLabelVoor, telNummer: ticketdetailLogica.telNummer, navigate,
    openDetail: ticketdetail.openDetail, openLocalEventDetail: afspraken.openLocalEventDetail, removeLocalEvent: afspraken.removeLocalEvent, bevestigUitplannen: planacties.bevestigUitplannen,
    herOpenRapport: (...a) => herOpenRapport(...a), rapportArchief: () => _rapportArchief, matchRespToPerson: afspraken.matchRespToPerson, duurVoor,
    setTab, sjLog, toggleAssignRow: ticketdetail.toggleAssignRow, saveToewijzen: ticketdetail.saveToewijzen, openBlockModal: beschikbaarheid.openBlockModal,
  });
  // Ingepland-scherm (schermen/ingepland.js): week-knoppen en de afhankelijkheden van andere schermen; vóór koppelRenders().
  ingepland.initIngepland({
    openDetail: ticketdetail.openDetail, tijdslotLabelVoor: ticketdetail.tijdslotLabelVoor,
    contactActiesHtml: ticketdetail.contactActiesHtml, koppelAdresNavigatie: ticketdetail.koppelAdresNavigatie, sjLog,
  });
  // Route-scherm (schermen/route.js): de afhankelijkheden van andere schermen (R11); vóór koppelRenders().
  route.initRoute({
    bevestigLateStops: ({ regels, laatsteStart }) => appConfirm({
      titel: `Start na ${laatsteStart}`,
      tekst: [...regels, `Deze tickets starten na het laatste startuur (${laatsteStart}). Toch vastleggen?`],
      bevestigLabel: 'Toch vastleggen', annuleerLabel: 'Terug',
    }),
    duurVoor, werktijdMin: (a, b) => calcWerktijdMin(a, b), kbPreferredTime: klantbeschikbaarheid.kbPreferredTime, geocacheLookup, geocacheStore,
    loadVoorstelStatus: voorstel.loadVoorstelStatus, loadTickets, heeftLopendVoorstel: t => ticketdetailLogica.heeftLopendVoorstel(t, toestand.get('voorstelStatus')), removeTicketFromDate: planacties.removeTicketFromDate,
    tijdslotLabelVoor: ticketdetail.tijdslotLabelVoor, bevestigdLabel: ticketdetailLogica.bevestigdLabel,
    telNummer: ticketdetailLogica.telNummer, meervoud, aankomstVoor: key => ticketdetail.arrivalData[key], openProposal: voorstel.openProposal,
    registerArrival: ticketdetail.registerArrival,
    openRapport: (...a) => openRapport(...a), bevestigUitplannen: planacties.bevestigUitplannen, openLocalEventDetail: afspraken.openLocalEventDetail, navigate,
    roundToNextQuarterStr: ticketdetailLogica.roundToNextQuarterStr, renderKalender: () => kalender.renderKalender(), testModus: () => TEST_MODE,
  });
  // Ticketdetail-scherm (schermen/ticketdetail.js): detail- en verzetvenster, toewijzen en aankomst; vóór koppelRenders().
  ticketdetail.initTicketdetail({
    renderKbSection: klantbeschikbaarheid.renderKbSection, openProposal: voorstel.openProposal, openAnnuleerVenster: annuleren.openAnnuleerVenster, openFotoModal: fotos.openFotoModal, openRapport: (...a) => openRapport(...a),
    addTicketToDate: planacties.addTicketToDate, bevestigUitplannen: planacties.bevestigUitplannen, vraagResyncNaOnzeker: planacties.vraagResyncNaOnzeker, navigate, kbBlocked: klantbeschikbaarheid.kbBlocked, kbPreferredTime: klantbeschikbaarheid.kbPreferredTime, prioLabel,
    bevestigdLabel: ticketdetailLogica.bevestigdLabel,
    heeftLopendVoorstel: t => ticketdetailLogica.heeftLopendVoorstel(t, toestand.get('voorstelStatus')),
    computeArrivalTimes: (...a) => computeArrivalTimes(...a),
    renderRouteList: (...a) => renderRouteList(...a),
  });
  // Voorstel-scherm (schermen/voorstel.js): voorstelvenster, verzenden en voorstelstatus; vóór koppelRenders().
  voorstel.initVoorstel({
    getPlanningTicket: ticketdetail.getPlanningTicket, sluitDetailStil: ticketdetail.sluitDetailStil,
    actiefTicket: ticketdetail.actiefTicket, zetActiefTicket: ticketdetail.zetActiefTicket,
    renderRouteList: (...a) => renderRouteList(...a), planResync: planacties.planResync,
  });
  // Annuleer-scherm (schermen/annuleren.js): annuleervenster, mailvoorbeeld en verzenden; vóór koppelRenders().
  annuleren.initAnnuleren({
    sluitDetailStil: ticketdetail.sluitDetailStil, actiefTicket: ticketdetail.actiefTicket,
    loadVoorstelStatus: voorstel.loadVoorstelStatus,
    renderRouteList: (...a) => renderRouteList(...a), updateRouteBtns: (...a) => updateRouteBtns(...a),
    inFlight: planacties.inFlight, planResync: planacties.planResync,
  });
  // Planacties (schermen/planacties.js): inplannen, uitplannen en "Plan deze week"; de Zoho-schrijfpaden. Vóór koppelRenders().
  planacties.initPlanacties({
    openAnnuleerVenster: annuleren.openAnnuleerVenster, loadTickets: (...a) => loadTickets(...a), routeOrderBezig: () => route.routeOrderBezig(),
    kbBlocked: klantbeschikbaarheid.kbBlocked, kbFor: klantbeschikbaarheid.kbFor, kbPreferred: klantbeschikbaarheid.kbPreferred, kbPreferredTime: klantbeschikbaarheid.kbPreferredTime,
    geocacheLookup, geocacheStore, duurVoor, calcWerktijdMin: (...a) => calcWerktijdMin(...a),
    renderRouteList: (...a) => renderRouteList(...a), updateRouteBtns: (...a) => updateRouteBtns(...a),
  });
  toestand.set('settings', instellingen.loadPersonSettings(localStorage.getItem('blitz_active_person') || 'all'));
  // Delegatie voor pilot-knoppen (kern-ui)
  registreerActies(document.body, {
    'persoon-menu': () => togglePersonMenu(),
    'vernieuw': () => loadTickets(),
    'thema': () => toggleTheme(),
    'instellingen': () => instellingen.openSettings(),
    'rapport-export': () => startTicketLogExport(() => import('./excel-export.js'), toast),
    'rapport-herlaad': () => laadRapportArchief(),
    'wizard-sluit': () => closeWizard(),
    'wizard-terug': () => wizBack(),
    'wizard-volgende': () => wizNext()
  });
  // Hoofdtabs (voorheen inline onclick op de zes knoppen): de klik bereikt niet meer document (zoals de inline stopPropagation).
  registreerActies(document.querySelector('.tabs-inner'), {
    'hoofdtab': (el, e, tab) => { e.stopPropagation(); setTab(tab); }
  });

  // Thema initialiseren (fallback als inline-script niet gelopen heeft)
  if (!document.documentElement.getAttribute('data-theme')) {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('blitz_theme') || 'dark');
  }
  document.getElementById('plan-date').value = localISO(new Date());
  set('gekozenDatum', localISO(new Date())); // gedeelde datum van Kalender, Route en Ingepland (niet bewaard over herladen)
  set('activeAssigneeFilter', localStorage.getItem('blitz_active_person') || 'all');
  koppelRenders(); // vanaf hier volgen de schermen de toestand (K6/K7)
  updatePersonHeader();
  // TEST badge tonen indien actief
  if (TEST_MODE) document.getElementById('test-badge').style.display = 'inline-block';
  // Offline banner
  const offlineBanner = document.getElementById('offline-banner');
  const updateOnlineState = () => {
    offlineBanner.style.display = navigator.onLine ? 'none' : 'flex';
  };
  window.addEventListener('offline', updateOnlineState);
  window.addEventListener('online',  updateOnlineState);
  updateOnlineState();
  // Sluit persoon-menu bij klik buiten
  document.addEventListener('click', (e) => {
    if (!document.getElementById('person-sel')?.contains(e.target))
      zetPersonMenuOpen(false);
  });
  document.querySelectorAll('.rapp-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setRapportFilter(btn.dataset.filter));
  });
  document.getElementById('set-routekleur')?.addEventListener('input', (e) => {
    document.getElementById('set-routekleur-hex').textContent = e.target.value.toUpperCase();
  });
  routeKaart.initKaart({
    instellingen: () => get('settings'),
    bewaarKaartStijl: () => instellingen.savePersonSettings(get('activeAssigneeFilter')),
    standaardRouteKleur: instellingen.DEFAULT_SETTINGS.routeKleur,
  });
  try {
    initMap();
  } catch (err) {
    // Fix (bugronde 2026-09-22, item G): een falende kaart-bibliotheek (Leaflet-CDN onbereikbaar)
    // mag de rest van de opstartreeks (tickets, polling, ...) niet blokkeren.
    console.error('Kaart kon niet geladen worden (Leaflet):', err);
    const mapWrap = document.getElementById('map-wrap') || document.getElementById('map');
    if (mapWrap) {
      mapWrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:0.85rem">⚠ Kaart kon niet geladen worden. De rest van de app werkt gewoon — herlaad de pagina om de kaart opnieuw te proberen.</div>';
    }
  }
  loadPrijzen();
  beschikbaarheid.loadAvailability();
  loadInventaris().then(() => metBehoudScroll(() => {
    renderInventaris(get('activeAssigneeFilter'));
    updateInventarisBadge(get('activeAssigneeFilter'));
  }));
  afspraken.loadAfspraken();
  klantbeschikbaarheid.loadKlantBeschikbaarheid();
  voorstel.loadVoorstelStatus();
  loadTickets();
  laadRapportArchief();
  startTicketPolling();
  refreshOutboxCache();
  flushOutbox();
  window.addEventListener('online', flushOutbox);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushOutbox();
  });
  // Initialiseer tab indicator op de actieve tab
  setTimeout(() => updateTabIndicator('tab-tickets'), 0);
  window.addEventListener('resize', () => {
    const active = document.querySelector('.tab.active');
    if (active) updateTabIndicator(active.id);
    zetTopbarHoogte();
  });
  zetTopbarHoogte();
  try {
    const tb = document.querySelector('.topbar-sticky');
    if (tb && window.ResizeObserver) new ResizeObserver(zetTopbarHoogte).observe(tb);
  } catch { /* best-effort */ }
  pasRolBeperkingToe();
  // De rol/indeling op het toestel bepaalt de coördinatorfuncties en de kalenderweergave:
  // bij een wijziging (rol, roteren, weergave) de tab-restrictie en de schermen herberekenen.
  if (!_apparaatListener) {
    _apparaatListener = true;
    window.addEventListener('apparaatwijziging', () => {
      sjLog('apparaatwijziging'); // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
      metBehoudScroll(() => {
        pasRolBeperkingToe();
        kalender.renderKalender();
        if (document.querySelector('.tab.active')?.id === 'tab-planning') {
          renderRouteList(document.getElementById('plan-date').value);
        }
      });
      // Tabs kunnen verschijnen/verdwijnen (rol) en de kop kan van hoogte wisselen (aanraak): onderstreping
      // en sticky-offset volgen.
      zetTopbarHoogte();
      const actief = document.querySelector('.tab.active');
      if (actief) updateTabIndicator(actief.id);
    });
  }
  // Herbereken indicator als gebruiker de tabbalk horizontaal scrollt
  document.querySelector('.tabs-inner')?.addEventListener('scroll', () => {
    const active = document.querySelector('.tab.active');
    if (active) updateTabIndicator(active.id);
  });
  // Registratie pas na de load-gebeurtenis (I5): de installatie (prefetch van de CDN-bestanden) mag niet met de eerste laad concurreren.
  if ('serviceWorker' in navigator) {
    const registreer = () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    if (document.readyState === 'complete') registreer(); else window.addEventListener('load', registreer, { once: true });
  }
  vraagRolOpTablet();
  planHerstelSchermStaat();
}

// De sticky kopjes (filterbalk, kalenderkop, ...) plakken onder de topbar; die is 96.8px op aanraak
// (tabs 44px) en 92px op muis -> volg de echte hoogte via --topbar-h.
function zetTopbarHoogte() {
  const tb = document.querySelector('.topbar-sticky');
  if (!tb) return;
  const h = Math.round(tb.getBoundingClientRect().height * 10) / 10;
  if (h > 0) document.documentElement.style.setProperty('--topbar-h', h + 'px');
}

// ── Tab + scrollpositie herstellen na een volledige herlaad (cache eerst, dan verse data; of het OS
// dat de PWA herstart). Bij pagehide / onzichtbaar worden bewaren we in sessionStorage; bij het laden
// herstellen we als het jonger is dan 10 minuten. Nooit een coord-only tab voor een technieker, en niet
// zolang de rolvraag op een tablet openstaat (dan pas na het antwoord).
const SCHERMSTAAT_KEY = 'blitz_schermstaat';
let _rolVraagOpen = false; // wacht de rolvraag nog op een antwoord? (dan stelt planHerstelSchermStaat uit)
let _schermStaatBewaarOk = false, _herstelUitgesteld = false, _herstelGebruikerActie = false;
function bewaarSchermStaat() {
  if (!_schermStaatBewaarOk) return; // nog niet hersteld: bewaar de oude staat niet met een lege
  try {
    const tab = (document.querySelector('.tab.active')?.id || '').replace(/^tab-/, '');
    if (!tab) return;
    const view = document.querySelector('.view.active');
    const grid = document.getElementById('week-grid');
    sessionStorage.setItem(SCHERMSTAAT_KEY, JSON.stringify({
      tab, scrollY: window.scrollY, viewScrollTop: view ? view.scrollTop : 0,
      gridScrollTop: grid ? grid.scrollTop : 0, t: Date.now(),
    }));
  } catch { /* sessionStorage kan ontbreken */ }
}
window.addEventListener('pagehide', bewaarSchermStaat);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') bewaarSchermStaat();
});
['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(ev =>
  document.addEventListener(ev, () => { _herstelGebruikerActie = true; _schermStaatBewaarOk = true; }, { capture: true, passive: true }));

function planHerstelSchermStaat() {
  if (_rolVraagOpen) { _herstelUitgesteld = true; return; } // na het antwoord (zie vraagRolOpTablet)
  let st = null;
  try { st = JSON.parse(sessionStorage.getItem(SCHERMSTAAT_KEY) || 'null'); } catch { /* negeer */ }
  const klaar = () => { _schermStaatBewaarOk = true; };
  if (!st || typeof st.t !== 'number' || Date.now() - st.t > 10 * 60 * 1000 || typeof st.tab !== 'string') {
    klaar(); return;
  }
  const tabEl = document.getElementById('tab-' + st.tab);
  const toegestaan = tabEl && !(window.apparaat?.rol === 'technieker' && tabEl.classList.contains('coord-only'))
    && st.tab !== 'planning'; // Route rekent bij openen (TomTom): niet automatisch herstellen
  if (!toegestaan) { klaar(); return; }
  if (document.querySelector('.tab.active')?.id !== 'tab-' + st.tab) setTab(st.tab);
  const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  const zet = () => {
    if (_herstelGebruikerActie) return; // de gebruiker is zelf al gaan scrollen
    if (document.querySelector('.tab.active')?.id !== 'tab-' + st.tab) return;
    const view = document.querySelector('.view.active');
    if (view && num(st.viewScrollTop)) view.scrollTop = num(st.viewScrollTop);
    const grid = document.getElementById('week-grid');
    if (st.tab === 'kalender' && grid && num(st.gridScrollTop)) grid.scrollTop = num(st.gridScrollTop);
    if (num(st.scrollY)) window.scrollTo(0, num(st.scrollY));
  };
  // setTab('kalender') plant zelf een render + scroll (activeerKalender) in een timeout(0): herstel erná.
  zet();
  setTimeout(zet, 60);
  setTimeout(() => { zet(); klaar(); }, 500);
}

// Eerste gebruik op een tablet: eenmalig vragen wie het toestel gebruikt (keuze wordt bewaard).
let _rolVraagGesteld = false;
function vraagRolOpTablet() {
  const a = window.apparaat;
  if (_rolVraagGesteld || !a || a.soort !== 'tablet' || a.rolGekozen) return;
  _rolVraagGesteld = true;
  _rolVraagOpen = true;
  appConfirm({
    titel: 'Wie gebruikt deze tablet?',
    tekst: 'Dit kan je later wijzigen in Instellingen → Dit toestel.',
    bevestigLabel: 'Coördinator',
    annuleerLabel: 'Technieker'
  }).then(ok => {
    _rolVraagOpen = false;
    _herstelGebruikerActie = false; // de tik op de dialoogknop telt niet als eigen scrollen
    window.zetRol(ok ? 'coordinator' : 'technieker');
    if (_herstelUitgesteld) { _herstelUitgesteld = false; planHerstelSchermStaat(); }
  });
}

// ══════════════════════════════════════════════
// DATA LADEN
// ══════════════════════════════════════════════
// De cache-/geocachehulp (loadFromCache, saveToCache, geocache*) staat in kern/opslag.js, metBehoudScroll in kern/ui.js.

// ── TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse ── (kern/verklikker.js)
startVerklikker(); // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse


// Past geladen tickets-data (van cache of van een verse fetch) toe op de globale state en rendert.
// reconcile: true betekent dat `data` verse fetch-data is waarvan de ticket-ID's als "live" mogen
// gelden — enkel dan mogen reconcilePlanning()/gcKlantBeschikbaarheid() draaien (zie Task 12). Bij
// cache-toepassing (reconcile: false, default) NIET aanroepen: verouderde cache-ID's zouden anders
// planning-entries kunnen opschonen die in de echte, huidige data nog wel bestaan.
// "In planning sinds": module-level register id -> ISO. Elke (her)load maakt verse ticketobjecten,
// dus de bekende waarden worden hier opnieuw opgelegd; zo wist de 5-min-poll niets uit voor het
// nieuwe antwoord van /api/planning-sinds binnen is. In TEST_MODE komen de waarden uit DUMMY_DATA.
const _planningSinds = new Map();
function pasPlanningSindsToe() {
  [...get('allTickets'), ...get('allPending'), ...get('allGepland')].forEach(t => {
    if (_planningSinds.has(t.id)) t.inPlanningSinds = _planningSinds.get(t.id);
  });
}
// Fire-and-forget: vraagt de wachttijden op; fouten enkel loggen, nooit de UI blokkeren.
function laadPlanningSinds() {
  if (TEST_MODE) return;
  const actief = [...get('allTickets'), ...get('allPending'), ...get('allGepland')].map(t => t.id);
  const opzoeken = get('allTickets').map(t => t.id);
  if (!actief.length) return;
  fetch('/api/planning-sinds', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opzoeken, actief }),
  }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(d => {
      Object.entries(d?.sinds || {}).forEach(([id, iso]) => { if (iso) _planningSinds.set(id, iso); });
      pasPlanningSindsToe();
      const actief = ticketdetail.actiefTicket();
      if (actief) { const t = [...get('allTickets'), ...get('allPending'), ...get('allGepland')].find(x => x.id === actief.id); if (t) actief.inPlanningSinds = t.inPlanningSinds; }
    })
    .catch(e => console.warn('planning-sinds mislukt:', e.message || e));
}

function applyTicketsData(data, opties = {}) {
  sjLog('applyTicketsData'); // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
  _eigenToepassing = true; // eigen toepassing telt niet als lokale wijziging (zie _lokaleWijziging)
  try {
    return metBehoudScroll(() => _applyTicketsData(data, opties));
  } finally {
    queueMicrotask(() => { _eigenToepassing = false; }); // ná de gebundelde verwittiging van de abonnees
  }
}
function _applyTicketsData(data, { reconcile = false } = {}) {
  // Alle schrijfacties in één transactie: de abonnementen (koppelRenders) spoelen synchroon aan het
  // einde, dus de schermen zijn hertekend nog vóór de reconciliatie hieronder.
  toestand.transactie(() => {
  set('allTickets', data.tickets        || []);
  set('allPending', data.pendingTickets || []);
  set('allGepland', data.plannedTickets || []);
  pasPlanningSindsToe();

  // Zoho is bron van waarheid: seed planning vanuit pendingTickets + geplande tickets
  // Wis alle pending/gepland entries eerst (interventieDatum kan gewijzigd zijn → re-seed hieronder)
  const pendingIds = new Set(get('allPending').map(t => t.id));
  const teplanIds  = new Set(get('allTickets').map(t => t.id));
  const geplandIds = new Set(get('allGepland').map(t => t.id));
  Object.keys(get('planning')).forEach(date => {
    get('planning')[date] = get('planning')[date].filter(p => {
      // Ticket terug in wachtrij (klant geweigerd) → verwijder uit planning
      if (teplanIds.has(p.ticket.id)) return false;
      // Pending/gepland: verwijder zodat we opnieuw seeden met correcte interventieDatum
      if (pendingIds.has(p.ticket.id) || geplandIds.has(p.ticket.id)) return false;
      return true;
    });
    if (!get('planning')[date].length) delete get('planning')[date];
  });

  // Voeg pendingTickets én geplande tickets toe op hun (mogelijk gewijzigde) interventieDatum
  [...get('allPending'), ...get('allGepland')].forEach(t => {
    if (!t.interventieDatum) return;
    const date = localISO(new Date(t.interventieDatum));
    if (!get('planning')[date]) get('planning')[date] = [];
    if (!get('planning')[date].find(p => p.ticket.id === t.id)) {
      const entry = { ticket: t, address: t.address, uur: extractLocalHour(t.interventieDatum) };
      // Fix (kaart-snelheid-onderzoek 2026-09-22, oorzaak 1): dit entry-object wordt hier
      // ALTIJD vers aangemaakt (elke loadTickets(), dus ook de 5-min-poll) zonder ooit de
      // _lat/_lon van een eventueel eerder entry over te nemen. Een cache-hit op t.address is de
      // meest voorkomende weg om dat te herstellen -- zonder deze regel gooit elke ticketherlaad
      // de geocode stilzwijgend weg, ook al is het adres niet gewijzigd.
      const hit = t.hasAddress && t.address ? geocacheLookup(t.address) : null;
      if (hit) { entry._lat = hit.lat; entry._lon = hit.lon; }
      get('planning')[date].push(entry);
    }
  });
  toestand.raak('planning'); // in-place filter/push/delete over meerdere dagen: één raak na de lussen

  document.getElementById('cnt-tickets').textContent = get('allTickets').length;
  document.getElementById('cnt-gepland').textContent = get('allGepland').length;

  // Een opgeslagen technieker die niet meer bestaat valt hier terug op 'all' (binnen de transactie,
  // zodat de abonnees maar één ronde nodig hebben i.p.v. een tweede na een reset in buildPersonSelector).
  valideerActievePersoon();
  }); // einde transactie: koppelRenders hertekent hier (zie koppelRenders)

  if (reconcile) {
    // Ghost-reconciliatie: planning-entries van gesloten/verwijderde tickets opruimen
    const liveIds = new Set([...get('allTickets'), ...get('allPending'), ...get('allGepland')].map(t => t.id));
    reconcilePlanning(liveIds);

    // GC: wees-entries verwijderen van gesloten tickets
    klantbeschikbaarheid.gcKlantBeschikbaarheid(liveIds);

    // Fix 5 (finale review): enkel bij een échte, gelukte fetch (reconcile:true) de poll-throttle
    // bijwerken. Deze regel stond voorheen onvoorwaardelijk aan het einde van de functie, waardoor
    // ook het toepassen van een stale cache (reconcile:false, bv. tijdens een netwerkstoring) de
    // tickets als "net succesvol geladen" markeerde en de poll-retry-lus 5 minuten onderdrukte --
    // net tijdens het offline-scenario dat Blok 1D net moest verzachten.
    _lastTicketLoad = Date.now();
  }
}

// stilleToast: sla enkel de succes-/telmelding over (een foutmelding van de oproeper blijft dan zichtbaar).
// stil: ook de foutmelding van deze lading zelf blijft weg (de oproeper toonde al een eigen melding; N7).
// zonderCache: de bewaarde kopie wordt niet toegepast (een resync na een onzeker resultaat mag niets verouderds terugzetten).
// De kopie geldt enkel voor de allereerste lading (offline start): een poll of "Vernieuwen" zet nooit verouderde data terug (N8).
let _eersteLading = true;
// Bescherming tegen een verouderd antwoord (N7): een herlading mag geen lokale wijziging overschrijven die ná haar start begon
// (plan-aanroep, route-volgorde, wijziging aan planning/tickets), en een oudere GET nooit het resultaat van een latere.
let _laadVolgnr = 0;
let _laatsteToegepast = 0;
let _lokaleWijziging = 0;
let _eigenToepassing = false;
async function loadTickets({ stilleToast = false, stil = false, zonderCache = false, negeerSchrijfstand = false } = {}) {
  const eersteLading = _eersteLading;
  const gebruikCache = _eersteLading && !zonderCache;
  _eersteLading = false;
  const mijnNr = ++_laadVolgnr;
  const startStand = { wijziging: _lokaleWijziging, ...planacties.schrijfStand() };
  const legeTekstEl = document.getElementById('empty-tickets');
  const vorigeLegeTekst = legeTekstEl.textContent;
  if (!stil) document.getElementById('empty-tickets').textContent = 'Laden...';
  if (!TEST_MODE && gebruikCache) {
    const cached = loadFromCache('blitz_tickets_cache');
    if (cached) applyTicketsData(cached);
  }
  try {
    let data;
    if (TEST_MODE) {
      await new Promise(r => setTimeout(r, 400));
      data = DUMMY_DATA;
    } else {
      const res = await fetch('/api/tickets');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
      if (data.error) throw new Error(data.error);
    }

    if (!TEST_MODE && !eersteLading) {
      // Live lezen na de await.
      const nu = planacties.schrijfStand();
      const achterhaald = !negeerSchrijfstand && (startStand.bezig || nu.bezig || nu.teller !== startStand.teller || _lokaleWijziging !== startStand.wijziging);
      if (achterhaald || mijnNr < _laatsteToegepast) {
        if (!stil || legeTekstEl.textContent === 'Laden...') legeTekstEl.textContent = vorigeLegeTekst;
        if (achterhaald && mijnNr >= _laatsteToegepast) planacties.planResync(); // opnieuw proberen zodra het rustig is
        return;
      }
    }
    _laatsteToegepast = mijnNr;
    if (!TEST_MODE) saveToCache('blitz_tickets_cache', data);
    applyTicketsData(data, { reconcile: true });
    laadPlanningSinds();
    // Geslaagde lading: 'Laden...' vervangen; bij een lege wachtrij (na het technieker-filter) de lege tekst; een lading met ongewijzigde data hertekent niet.
    if (!ticketsVanTechnieker(get('allTickets'), get('activeAssigneeFilter')).length) document.getElementById('empty-tickets').textContent = 'Geen tickets om in te plannen';

    if (TEST_MODE) toast('🧪 Testmodus actief — dummy data geladen');
    else if (!stilleToast) toast(`${get('allTickets').length} te plannen · ${get('allPending').length} wacht bevestiging · ${get('allGepland').length} gepland`);
  } catch (err) {
    const rauw = err.message || '';
    const msg = foutTekst(err) || '';
    const isAuth = /401|403|invalid.token|expired|unauthorized/i.test(rauw);
    if (isAuth) {
      toast('🔑 Sessie met Zoho verlopen. Meld dit aan Brent; de koppeling moet opnieuw ingesteld worden.', 6000);
      document.getElementById('empty-tickets').textContent =
        'Sessie met Zoho verlopen. Meld dit aan Brent; de koppeling moet opnieuw ingesteld worden.';
    } else if (!stil) {
      toast('✕ ' + msg, 4000);
      document.getElementById('empty-tickets').textContent = 'Kon tickets niet laden: ' + msg;
    }
  }
}

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// PERSOON SELECTOR
// ══════════════════════════════════════════════
function initials(name) {
  if (!name || name === 'all') return 'A';
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function personenUitTickets() {
  return [...new Set([
    ...get('allTickets').map(t => t.assignee),
    ...get('allGepland').map(t => t.assignee),
    ...get('allPending').map(t => t.assignee),
  ])].filter(Boolean).sort();
}

// Valideer: als opgeslagen persoon niet meer bestaat → reset naar 'all'. Schrijft de toestand
// (activeAssigneeFilter, settings); het koptekst-abonnement in koppelRenders werkt de kop bij.
// Wordt enkel in _applyTicketsData binnen de transactie aangeroepen (niet in de render-/abonneepad), zodat
// er geen extra renderronde ontstaat en de filter tot de volgende dataload blijft staan.
function valideerActievePersoon(agents = personenUitTickets()) {
  if (get('activeAssigneeFilter') !== 'all' && !agents.includes(get('activeAssigneeFilter'))) {
    set('activeAssigneeFilter', 'all');
    localStorage.setItem('blitz_active_person', 'all');
    set('settings', instellingen.loadPersonSettings('all'));
    applyKaartStijl();
  }
}

function buildPersonSelector() {
  const agents = personenUitTickets();
  // Geen validatie hier: dit is een abonnee. Enkel _applyTicketsData (dataload) valideert; anders reset
  // het inplannen van het laatste wachtrij-ticket van een technieker diens filter naar 'all'.

  const menu = document.getElementById('person-menu');
  menu.innerHTML = '';

  // "Alle" optie
  const allItem = document.createElement('button');
  allItem.className = `pm-item coord-only${get('activeAssigneeFilter') === 'all' ? ' active' : ''}`;
  allItem.innerHTML = `<div class="pm-avatar">A</div><div class="pm-item-info"><div class="pm-item-name">Alle technici</div><div class="pm-item-sub">Gecombineerde weergave</div></div>`;
  allItem.onclick = () => selectPerson('all');
  menu.appendChild(allItem);

  agents.forEach(agent => {
    const item = document.createElement('button');
    item.className = `pm-item${get('activeAssigneeFilter') === agent ? ' active' : ''}`;
    item.innerHTML = `<div class="pm-avatar">${initials(agent)}</div><div class="pm-item-info"><div class="pm-item-name">${agent}</div><div class="pm-item-sub">Persoonlijke planning</div></div>`;
    item.onclick = () => selectPerson(agent);
    menu.appendChild(item);
  });
}

function updatePersonHeader() {
  const el = document.getElementById('person-avatar-hdr');
  const nm = document.getElementById('person-name-hdr');
  if (el) el.textContent = initials(get('activeAssigneeFilter'));
  if (nm) nm.textContent = get('activeAssigneeFilter') === 'all' ? 'Alle' : get('activeAssigneeFilter').split(' ')[0];
}


function zetPersonMenuOpen(open) {
  document.getElementById('person-menu')?.classList.toggle('open', open);
  document.getElementById('person-btn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function togglePersonMenu() {
  zetPersonMenuOpen(!document.getElementById('person-menu')?.classList.contains('open'));
}

function selectPerson(name) {
  // De schermen volgen via koppelRenders: kop, selector, wachtrij, kalender, ingepland, route, inventaris.
  toestand.transactie(() => {
    set('activeAssigneeFilter', name);
    set('settings', instellingen.loadPersonSettings(name));
    applyKaartStijl();
    localStorage.setItem('blitz_active_person', name);
    zetPersonMenuOpen(false);
  });
}

// Eén plek met alle abonnementen van de schermen op de toestand (K6). Elk scherm één abonnement met de
// unie van zijn sleutels, in de volgorde van de vroegere handmatige aanroepen (_applyTicketsData/selectPerson).
// Bewust GEEN abonnement op voorstelStatus, klantBeschikbaarheid en settings: er hangt geen
// uniforme render-keten aan (de plaatsen die ze schrijven, hertekenen zelf wat ze nodig hebben).
// Het route-abonnement dekt wel planning en localEvents (etappe 3): elke in-place schrijf op planning roept raak('planning') aan.
// De abonnees verwijzen via arrow-functies naar de renders van de schermmodules (kern.<scherm>.renderTelling() telt in de modules zelf).
function koppelRenders() {
  const st = toestand;
  st.spoel(); // beginwaarden van vóór de koppeling mogen niets hertekenen
  st.zetOmhulling(draai => metBehoudScroll(draai));
  const planDatum = () => document.getElementById('plan-date')?.value || localISO(new Date());
  st.abonneer(['activeAssigneeFilter'], () => updatePersonHeader());
  st.abonneer(['planning', 'allTickets', 'allPending', 'allGepland'], () => { if (!_eigenToepassing) _lokaleWijziging++; });
  st.abonneer(['allTickets', 'allPending', 'allGepland', 'activeAssigneeFilter'], () => buildPersonSelector());
  st.abonneer(['allTickets', 'activeAssigneeFilter'], () => wachtrij.renderTickets());
  st.abonneer(['allTickets', 'allPending', 'allGepland', 'localEvents', 'avExceptions', 'activeAssigneeFilter', 'gekozenDatum'], () => kalender.renderKalender());
  st.abonneer(['allGepland', 'activeAssigneeFilter', 'gekozenDatum'], () => ingepland.renderGepland());
  st.abonneer(['gekozenDatum'], () => route.volgGekozenDatum()); // de datumkiezer en de weekstrook van de Route-tab volgen de gedeelde datum
  st.abonneer(['allTickets', 'allPending', 'allGepland', 'activeAssigneeFilter'], () => {
    renderInventaris(get('activeAssigneeFilter'));
    updateInventarisBadge(get('activeAssigneeFilter'));
  });
  st.abonneer(['planning', 'localEvents', 'allTickets', 'allPending', 'allGepland', 'activeAssigneeFilter'], () => {
    renderRouteList(planDatum());
    updateRouteBtns(planDatum());
  });
}

// ══════════════════════════════════════════════
// TICKETS TAB
// ══════════════════════════════════════════════
// Wachtrij (lijst, zoeken, sorteren, snelinplannen): schermen/wachtrij.js (etappe 4).

// Inplannen, uitplannen en "Plan deze week": schermen/planacties.js (etappe 5b).

// ══════════════════════════════════════════════
// BESCHIKBAARHEID (cloud-synced)
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// GHOST TICKET RECONCILIATIE (#10)
// ══════════════════════════════════════════════
function reconcilePlanning(knownIds) {
  // Verwijder planning-entries van tickets die niet meer in Zoho bestaan,
  // maar ALLEEN voor toekomstige datums. Vandaag en verleden blijven intact:
  // de technieker is actief bezig op die stops en tickets kunnen gesloten zijn
  // na rapport genereren zonder dat ze uit de dagroute mogen verdwijnen.
  const today = localISO(new Date());
  const ghosts = [];
  for (const date of Object.keys(get('planning'))) {
    if (date <= today) continue; // vandaag + verleden: niet aanraken
    get('planning')[date] = get('planning')[date].filter(p => {
      const id = p.ticket?.id;
      if (!id) return true;
      if (planacties.inFlight(id)) return true;
      if (knownIds.has(id)) return true;
      ghosts.push(`#${p.ticket.number || id}`);
      return false;
    });
    if (!get('planning')[date].length) delete get('planning')[date];
  }
  if (ghosts.length) {
    console.warn('Ghost tickets verwijderd uit planning:', ghosts);
    toast(`⚠ ${meervoud(ghosts.length, 'toekomstige afspraak', 'toekomstige afspraken')} verwijderd (ticket gesloten in Zoho): ${ghosts.join(', ')}`, 5000);
    toestand.raak('planning'); // in-place filter/delete: koppelRenders hertekent de route
    renderKalender();
  }
}

// Polling: herlaad tickets elke 5 min als tab zichtbaar is
let _lastTicketLoad = 0;
let _pollInterval   = null;
function startTicketPolling() {
  if (_pollInterval) return;
  _pollInterval = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    // I4: applyRouteOrder() muteert planning[date]-objecten; een herseed via loadTickets()
    // tijdens die actie zou die objecten onder de lopende berekening vandaan vervangen.
    if (route.routeOrderBezig()) return;
    if (Date.now() - _lastTicketLoad < 5 * 60 * 1000) return;
    loadTickets();
    // I3: ✉️/🔒-badges (isStopLocked/isStopAnchored) vers houden -- fire-and-forget, eigen
    // error-handling in loadVoorstelStatus() zelf.
    voorstel.loadVoorstelStatus();
  }, 30 * 1000); // check elke 30s, laad pas als 5min verstreken
}

// ══════════════════════════════════════════════
// ROUTE TAB
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════
// Pijltjestoetsen in de tabbalk (roving tabindex): alleen zichtbare tabs tellen (coord-only kan verborgen zijn).
document.querySelector('.tabs-inner')?.addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = [...document.querySelectorAll('.tabs-inner .tab')].filter(t => t.offsetParent !== null);
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
    : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[n].focus();
});

function updateTabIndicator(tabId) {
  const tab  = document.getElementById(tabId);
  const tabs = document.querySelector('.tabs');
  if (!tab || !tabs) return;
  const tr = tab.getBoundingClientRect();
  const pr = tabs.getBoundingClientRect();
  // tr.left - pr.left geeft de huidige visuele positie van de tab t.o.v. .tabs,
  // ook na horizontaal scrollen van .tabs-inner — geen scrollLeft nodig.
  tabs.style.setProperty('--ind-left',  (tr.left - pr.left) + 'px');
  tabs.style.setProperty('--ind-width', tr.width + 'px');
}

function setTab(tab) {
  sjZetTab(); sjLog('setTab:' + tab); // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
  document.querySelectorAll('.tab').forEach(el => { el.classList.remove('active'); el.setAttribute('aria-selected', 'false'); el.tabIndex = -1; });
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const _tabEl = document.getElementById('tab-' + tab);
  _tabEl.classList.add('active'); _tabEl.setAttribute('aria-selected', 'true'); _tabEl.tabIndex = 0;
  document.getElementById('view-' + tab).classList.add('active');
  updateTabIndicator('tab-' + tab);
  laadTab(tab);
  if (tab === 'planning') {
    setTimeout(() => routeKaart.invalideerKaartGrootte(), 50);
    const date = document.getElementById('plan-date').value;
    // Automatisch berekenen (in de al-geplande volgorde, niet optimaliseren) als er nog
    // geen actuele route voor deze dag in het geheugen zit -- vermijdt onnodige
    // TomTom-aanvragen bij elke tabwissel zonder wijzigingen.
    if (date && !route.routeActueelVoor(date)) calculateRoute();
  }
  // Defer kalender/gepland render één tick zodat de tab-click geen elementen in de nieuw gerenderde view raakt
  window.scrollTo(0, 0); // tabwissel door de gebruiker start altijd bovenaan (sync-herrenders behouden de scroll: metBehoudScroll)
  if (tab === 'kalender')  setTimeout(() => kalender.activeerKalender(), 0);
  if (tab === 'gepland')   setTimeout(() => ingepland.renderGepland(), 0);
  if (tab === 'rapporten') setTimeout(() => laadRapportArchief(), 0);
  if (tab === 'inventaris') {
    setTimeout(() => {
      loadInventaris().then(() => {
        renderInventaris(get('activeAssigneeFilter'));
        updateInventarisBadge(get('activeAssigneeFilter'));
      });
    }, 0);
    startInvPoll();
  } else {
    stopInvPoll();
    resetInvSeenLog();
  }
}

let _apparaatListener = false; // de 'apparaatwijziging'-luisteraar is maar één keer gekoppeld
// NOTE: 'kalender' is de vaste terugvaltab voor de technieker en mag nooit de klasse coord-only dragen.
function pasRolBeperkingToe() {
  if (window.apparaat?.rol !== 'technieker') return;
  const active = document.querySelector('.tab.active');
  if (active && active.classList.contains('coord-only')) setTab('kalender');
}

// ══════════════════════════════════════════════
// INSTELLINGEN: schermen/instellingen.js
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════
function navigate(enc) {
  // Android toont zelf een native keuzemenu (met "1 keer"/"altijd") wanneer een geo:-
  // koppeling geopend wordt, omdat alle navigatie-apps (Google Maps, Waze, ...) zich
  // hiervoor registreren bij het besturingssysteem -- geen eigen menu nodig. Niet-Android
  // toestellen (zeldzaam in dit team) vallen terug op het bestaande Google Maps-gedrag.
  if (/Android/i.test(navigator.userAgent)) {
    window.location.href = `geo:0,0?q=${enc}`;
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${enc}&travelmode=driving`, '_blank');
  }
}

// Enkelvoud/meervoud (meervoud) staat in schermen/ticketdetail-logica.js; toast en toastTimer in kern/ui.js.

// ── Light/dark toggle ────────────────────────────────────────────────────────
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('blitz_theme', next);
  document.getElementById('meta-theme-color')
    ?.setAttribute('content', next === 'light' ? '#f5f6f7' : '#181e24');
}

// Escape/focusval per venster: zie public/js/venster.js

installeerTijdPicker(document, window); // tik op een tijd-/datumveld opent de klok/kalender (Android)
document.addEventListener('DOMContentLoaded', () => startNaInlog(opstart));
