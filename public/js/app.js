// public/js/app.js — de app-schil (etappe 5b, taak 8; D3, D23): het voormalige klassieke `<script defer>` van index.html,
// nu een module en de LAATSTE `<script type="module">`. Het start zichzelf (geen exports).
// Moduleruimte i.p.v. klassiek script: top-level `let`/`function` zijn geen window-globals meer; wat de oudere modules
// van dit bestand nodig hadden, staat in kern/opslag.js, kern/verklikker.js, kern/ui.js (metBehoudScroll) of komt via
// `afh`. Cyclusregel: schermmodules importeren dit bestand nooit; dit bestand importeert uit hen.
// Een module draait na het parsen en vóór DOMContentLoaded, in documentvolgorde (zoals het `defer`-script); de
// voormalige DOMContentLoaded-handler heet nu `opstart()` en wordt onderaan dit bestand geregistreerd (zie daar).
import { zetStickyOffsets } from './sticky-offset.js';
import { foutTekst } from './kern/api.js';
import { lopendeSchrijfverzoeken } from './kern/netwerk.js';
import { toestand } from './kern/toestand.js';
import { TEST_MODE } from './kern/omgeving.js';
import { localISO, extractLocalHour, openingsDatum } from './kern/tijd.js';
import { startTicketLogExport } from './kern/exceljs.js';
import { toast, registreerActies, metBehoudScroll } from './kern/ui.js';
import { toonSkelet } from './kern/skelet.js';
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
import { refreshOutboxCache, flushOutbox, _outboxInFlight } from './outbox.js';
import { _invData, loadInventaris, renderInventaris, updateInventarisBadge, resetInvSeenLog, meldLageVoorraadBijStart } from './inventaris.js';
import { appConfirm } from './app-dialog.js';
import { APP_VERSIE, leesVersie } from './versie.js';
import { registreerVenster } from './venster.js';
import { startNaInlog, pasWerkruimteToe } from './schermen/rol-schil.js';
import { leesWerkruimte, bewaarWerkruimte, omzetTab, tabHoortBij } from './schermen/werkruimte-logica.js';
import * as persoonskiezer from './schermen/persoonskiezer.js';
import { laadTab } from './kern/navigatie.js';
import { eigenZohoNaam, huidigeRechten, huidigeGebruiker, magPlannenVoor } from './kern/sessie.js';
import { installeerTijdPicker } from './kern/tijd-picker.js';
import { startVersiering, bewaarThemaWissel, herbereken as herberekenVersiering } from './schermen/evenement-laag.js';
import { startHemel } from './schermen/hemel-laag.js';
import { zetTabIconen } from './kern/tab-iconen.js';
import { initDokMeer } from './schermen/dok-meer.js';
import { initPaginakop } from './schermen/paginakop.js';
import { laadThemas, themasNu, pakkettenVoorSpel, haalOntbrekendePakketten } from './schermen/themas-bron.js';
import { actieveThemas } from './kern/themapakket.js';
import { installeerSpelOpening } from './spel/spel-opening.js';


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
  // Verborgen spel (spel/): 5× snel tikken op het bliksem-icoon (.logo-icon) opent het; de spelmodule wordt pas dan geladen. Raakt de planning niet aan.
  // Op `breed` staat het logo in de zijkolom (.zijkolom-logo-icoon) en is dat van de kop verborgen (Open dag, taak 7): beide tellen, met één teller.
  // De themas (schermen/themas-bron.js) bepalen de themaskins: welke thema's nu actief zijn (lokale schatting tot de server antwoordt), welke pakketten bekend
  // zijn (voor de skinlijst en de extra's) en het eenmalig ophalen van pakketten die nog niet in de cache zitten. Het spel zelf (skins) blijft lazy.
  installeerSpelOpening({
    doel: [document.querySelector('.logo-icon'), document.querySelector('.zijkolom-logo-icoon')],
    actieveThemas: (datum) => actieveThemas(datum, themasNu().index?.themas ?? []),
    pakketten: pakkettenVoorSpel,
    haalPakketten: haalOntbrekendePakketten,
  });
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
  capaciteit.initCapaciteit({ duurVoor, werktijdMin: (a, b) => calcWerktijdMin(a, b), kbPreferredTime: klantbeschikbaarheid.kbPreferredTime, kbPreferred: klantbeschikbaarheid.kbPreferred, kbFor: klantbeschikbaarheid.kbFor });
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
    eersteVrijUur: capaciteit.eersteVrijUur, setTab, sjLog, toggleAssignRow: ticketdetail.toggleAssignRow, saveToewijzen: ticketdetail.saveToewijzen, openBlockModal: beschikbaarheid.openBlockModal,
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
    eersteVrijUur: capaciteit.eersteVrijUur,
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
    'persoon-menu': (el, e) => persoonskiezer.toggleMenu({ focus: e?.detail === 0 }), // detail 0: via het toetsenbord geopend, dan gaat de focus het menu in
    'vernieuw': () => {
      loadTickets();
      // De beheerder in de werkruimte Sales: ook het open sales-scherm opnieuw laden.
      if (huidigeWerkruimte() === 'sales') import('./schermen/sales-schil.js').then(m => m.herlaadActief()).catch(() => {});
      if (huidigeRechten().beheer) persoonskiezer.laadLijsten({ ververs: true }).catch(() => {}); // ook de lijsten van de kiezer (na een mislukte lading)
    },
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
  // In het weekend openen Kalender, Route en Ingepland op de komende week (eerste werkdag), niet op de week die voorbij is.
  const openingsdag = openingsDatum(new Date(), get('settings').werkdagen);
  document.getElementById('plan-date').value = openingsdag;
  set('gekozenDatum', openingsdag); // gedeelde datum van Kalender, Route en Ingepland (niet bewaard over herladen)
  set('activeAssigneeFilter', localStorage.getItem('blitz_active_person') || 'all');
  // De persoonskiezer (schermen/persoonskiezer.js): de lijst en de knop volgen de toestand; een technieker kiezen loopt via selectPerson, een
  // verkoper kiezen (enkel de beheerder) wisselt van werkruimte (hieronder).
  persoonskiezer.initPersoonskiezer({
    ticketNamen: personenUitTickets, gekozenTechnieker: () => get('activeAssigneeFilter'),
    gekozenVerkoper: () => { try { return localStorage.getItem('blitz_sales_verkoper'); } catch { return null; } },
    werkruimte: huidigeWerkruimte, metSales: () => huidigeRechten().beheer === true,
    laadVerkopers: async () => { // lazy: de sales-modules horen niet bij de eerste lading
      _salesVerkoper = await import('./schermen/sales-verkoper.js');
      const ok = await _salesVerkoper.zorgVoorVerkopers({ ververs: true });
      return { ok, lijst: _salesVerkoper.lijstVerkopers() };
    },
    verkopersNu: () => (_salesVerkoper ? _salesVerkoper.lijstVerkopers() : null),
    kies: (item) => { if (item.soort === 'verkoper') kiesVerkoper(item.sleutel); else kiesTechnieker(item.sleutel); },
    terug: (sleutel) => kiesTechnieker(sleutel),
  });
  persoonskiezer.koppelLuisteraars();
  koppelRenders(); // vanaf hier volgen de schermen de toestand (K6/K7)
  updatePersonHeader();
  buildPersonSelector(); // meteen vullen (eigen naam / "Alle technici"): faalt de ticketlading, dan blijft de kiezer niet leeg
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
  document.querySelectorAll('.rapp-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => setRapportFilter(btn.dataset.filter));
  });
  routeKaart.initKaart({
    instellingen: () => get('settings'),
    bewaarKaartStijl: (sleutel) => instellingen.bewaarEigenKaartStijl(sleutel), // persoonlijk: altijd de eigen instellingen, nooit die van de getoonde persoon
    eigenKaartStijl: () => instellingen.eigenKaartStijl(),
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
  const inventarisGeladen = loadInventaris().then(() => metBehoudScroll(() => {
    renderInventaris(get('activeAssigneeFilter'));
    updateInventarisBadge(get('activeAssigneeFilter'));
  }));
  afspraken.loadAfspraken();
  klantbeschikbaarheid.loadKlantBeschikbaarheid();
  voorstel.loadVoorstelStatus();
  const ticketsGeladen = loadTickets();
  // Eenmalig "Check je voorraad" als er iets onder de meldgrens zit (v2.4.0). Er is maar één meldingsvak: pas na de opstartmelding
  // van de tickets (4 s), anders duwt die de voorraadmelding meteen weg.
  Promise.allSettled([inventarisGeladen, ticketsGeladen]).then(() => setTimeout(meldLageVoorraadBijStart, 4500));
  laadRapportArchief();
  startTicketPolling();
  refreshOutboxCache();
  flushOutbox();
  window.addEventListener('online', () => { flushOutbox(); verversNaTerugkeer(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { flushOutbox(); verversNaTerugkeer(); }
  });
  // Initialiseer tab indicator op de actieve tab
  setTimeout(() => updateTabIndicator(document.querySelector('.tab.active')?.id || 'tab-tickets'), 0); // onder de actieve (zichtbare) tab, ook in de werkruimte Sales
  window.addEventListener('resize', () => {
    const active = document.querySelector('.tab.active');
    if (active) updateTabIndicator(active.id);
    zetStickyOffsets();
    routeKaart.invalideerKaartGrootte(); // de kaart van de Route-tab volgt een nieuwe venstergrootte (Leaflet meet zichzelf niet opnieuw)
  });
  zetStickyOffsets(); // verder houdt sticky-offset.js de variabelen bij (ResizeObserver op kop, tabbalk en meldingsbalken)
  pasRolBeperkingToe();
  // Een beheerder die in de werkruimte Sales werkt (bewaard op dit toestel) start op Leads: de lijst met verkopers voor de knop in de kop laadt mee.
  if (huidigeWerkruimte() === 'sales') {
    setTab(omzetTab('tickets', 'sales'));
    persoonskiezer.laadLijsten().catch(() => {});
  }
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
      zetStickyOffsets();
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
    volgSwUpdates();
  }
  planHerstelSchermStaat();
}

// ── Tab + scrollpositie herstellen na een volledige herlaad (cache eerst, dan verse data; of het OS
// dat de PWA herstart). Bij pagehide / onzichtbaar worden bewaren we in sessionStorage; bij het laden
// herstellen we als het jonger is dan 10 minuten. Nooit een coord-only tab voor een technieker.
const SCHERMSTAAT_KEY = 'blitz_schermstaat';
// Een coördinatortab die de beperkte (technieker-)weergave niet toont; een technieker met "Mag zelf plannen" houdt de plan-tabs (.plan-eigen).
// Route (.alleen-groot) bestaat op een gsm (indeling 'smal') voor niemand: ook die tab is dan verborgen (kop B).
const tabVerborgenVoorToestel = (tabEl) => (window.apparaat?.indeling === 'smal' && tabEl.classList.contains('alleen-groot'))
  || (window.apparaat?.rol === 'technieker' && tabEl.classList.contains('coord-only')
    && !(tabEl.classList.contains('plan-eigen') && window.apparaat.planEigen === true));
let _schermStaatBewaarOk = false, _herstelGebruikerActie = false;
function bewaarSchermStaat() {
  if (!_schermStaatBewaarOk) return; // nog niet hersteld: bewaar de oude staat niet met een lege
  try {
    const tab = (document.querySelector('.tab.active')?.id || '').replace(/^tab-/, '');
    if (!tab) return;
    const view = document.querySelector('.view.active');
    const grid = document.getElementById('week-grid');
    sessionStorage.setItem(SCHERMSTAAT_KEY, JSON.stringify({
      tab, werkruimte: huidigeWerkruimte(), scrollY: window.scrollY, viewScrollTop: view ? view.scrollTop : 0,
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
  let st = null;
  try { st = JSON.parse(sessionStorage.getItem(SCHERMSTAAT_KEY) || 'null'); } catch { /* negeer */ }
  const klaar = () => { _schermStaatBewaarOk = true; };
  if (!st || typeof st.t !== 'number' || Date.now() - st.t > 10 * 60 * 1000 || typeof st.tab !== 'string') {
    klaar(); return;
  }
  // De beheerder heeft twee werkruimtes (kop B): een bewaarde tab die niet bij de huidige werkruimte past (bv. de vroegere tab "Sales" of een tab
  // van de andere werkruimte) wordt omgezet naar het gelijkaardige scherm; Route rekent bij openen (TomTom) en wordt nooit automatisch hersteld.
  let tab = st.tab;
  if (huidigeRechten().beheer && (st.werkruimte !== huidigeWerkruimte() || !tabHoortBij(tab, huidigeWerkruimte()))) tab = omzetTab(tab, huidigeWerkruimte(), { smal: document.documentElement.dataset.indeling === 'smal' });
  const tabEl = document.getElementById('tab-' + tab);
  const toegestaan = tabEl && !tabEl.hidden && !tabVerborgenVoorToestel(tabEl)
    && tab !== 'planning' && tab !== 'sales-route' && st.tab !== 'planning' && st.tab !== 'sales-route';
  if (!toegestaan) { klaar(); return; }
  if (document.querySelector('.tab.active')?.id !== 'tab-' + tab) setTab(tab);
  if (tab !== st.tab) { klaar(); return; } // een omgezette tab (andere werkruimte): de bewaarde scrollstand hoort bij een ander scherm
  const num = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
  const zet = () => {
    if (_herstelGebruikerActie) return; // de gebruiker is zelf al gaan scrollen
    if (document.querySelector('.tab.active')?.id !== 'tab-' + tab) return;
    const view = document.querySelector('.view.active');
    if (view && num(st.viewScrollTop)) view.scrollTop = num(st.viewScrollTop);
    const grid = document.getElementById('week-grid');
    if (tab === 'kalender' && grid && num(st.gridScrollTop)) grid.scrollTop = num(st.gridScrollTop);
    if (num(st.scrollY)) window.scrollTo(0, num(st.scrollY));
  };
  // setTab('kalender') plant zelf een render + scroll (activeerKalender) in een timeout(0): herstel erná.
  zet();
  setTimeout(zet, 60);
  setTimeout(() => { zet(); klaar(); }, 500);
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
  // Eerste lading zonder iets te tonen (geen bewaarde kopie): wachtrij-kaarten als skelet i.p.v. enkel "Laden..."; pas na 150 ms, en nooit als er al tickets staan.
  const skelet = stil ? null : toonSkelet(document.getElementById('ticket-list'), { vorm: 'kaarten', aantal: 4, isLeeg: () => get('allTickets').length === 0, verberg: [legeTekstEl] });
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
    buildPersonSelector(); // een mislukte lading verandert de toestand niet, dus geen abonnee-render: de kiezer toch (her)bouwen
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
  } finally {
    skelet?.stop(); // na de (her)tekening van de wachtrij of de foutmelding: het skelet maakt altijd plaats
  }
}

// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// PERSOON SELECTOR
// ══════════════════════════════════════════════
// Wie zelf interventies uitvoert (een account met een Zoho-naam) kan zichzelf altijd kiezen, ook als er op dat moment geen ticket
// op zijn naam staat.
function personenUitTickets() {
  return [...new Set([
    ...get('allTickets').map(t => t.assignee),
    ...get('allGepland').map(t => t.assignee),
    ...get('allPending').map(t => t.assignee),
    eigenZohoNaam(),
  ])].filter(Boolean).sort();
}

// Valideer: als opgeslagen persoon niet meer bestaat → reset naar 'all'. Schrijft de toestand
// (activeAssigneeFilter, settings); het koptekst-abonnement in koppelRenders werkt de kop bij.
// Wordt enkel in _applyTicketsData binnen de transactie aangeroepen (niet in de render-/abonneepad), zodat
// er geen extra renderronde ontstaat en de filter tot de volgende dataload blijft staan.
function valideerActievePersoon(agents = [...personenUitTickets(), ...persoonskiezer.bekendeZohoNamen()]) {
  if (get('activeAssigneeFilter') !== 'all' && !agents.includes(get('activeAssigneeFilter'))) {
    set('activeAssigneeFilter', 'all');
    localStorage.setItem('blitz_active_person', 'all');
    set('settings', instellingen.loadPersonSettings('all'));
    applyKaartStijl();
  }
}

// De lijst en de knop tekent schermen/persoonskiezer.js (namen enkel via textContent); hier blijven de dunne aanroepen voor de abonnees.
function buildPersonSelector() { persoonskiezer.bouwMenu(); }
function updatePersonHeader() { persoonskiezer.werkKnopBij(); }

function selectPerson(name) {
  // De schermen volgen via koppelRenders: kop, selector, wachtrij, kalender, ingepland, route, inventaris.
  toestand.transactie(() => {
    set('activeAssigneeFilter', name);
    set('settings', instellingen.loadPersonSettings(name));
    applyKaartStijl();
    localStorage.setItem('blitz_active_person', name);
    persoonskiezer.zetMenuOpen(false);
  });
}

// ── Werkruimtes van de beheerder (kop B) ─────────────────────────────────────────────────────────────────────────
// De beheerder werkt in Techniek of Sales; de persoonskiezer wisselt ervan: een technieker of "Alle technici" = Techniek, een verkoper = Sales.
// De keuze staat in localStorage `blitz_werkruimte` (schermen/werkruimte-logica.js). Alle anderen werken altijd in Techniek (sales heeft zijn eigen start).
let _salesVerkoper = null; // de lazy geladen module sales-verkoper.js (na de eerste lijst van de persoonskiezer)
function huidigeWerkruimte() { return huidigeRechten().beheer ? leesWerkruimte(globalThis.localStorage) : 'techniek'; }

// Een technieker (of "Alle technici") gekozen: in Sales betekent dat terug naar Techniek, op hetzelfde soort scherm.
function kiesTechnieker(naam) {
  selectPerson(naam);
  if (huidigeWerkruimte() === 'sales') wisselWerkruimte('techniek');
}

// Een verkoper gekozen (enkel de beheerder): de keuze bewaren, en uit Techniek wisselen naar Sales.
async function kiesVerkoper(id) {
  _salesVerkoper = await import('./schermen/sales-verkoper.js');
  const verkoper = _salesVerkoper.lijstVerkopers().find(v => v.id === id);
  const wasSales = huidigeWerkruimte() === 'sales';
  _salesVerkoper.kiesVerkoper(id); // bewaart en laat het open sales-scherm de leads van deze verkoper laden
  if (wasSales) { persoonskiezer.bouwMenu(); persoonskiezer.werkKnopBij(); } else await wisselWerkruimte('sales', { verkoper });
}

// Wisselt van werkruimte: de tabs van de nieuwe werkruimte tonen, op het gelijkaardige scherm blijven (en in dezelfde week), de kop en het menu
// bijwerken en het melden. De pagina springt naar boven zoals bij elke tabwissel (setTab).
async function wisselWerkruimte(naar, { verkoper } = {}) {
  if (huidigeWerkruimte() === naar) return;
  const actief = document.querySelector('.tab.active')?.id.replace(/^tab-/, '') || '';
  bewaarWerkruimte(globalThis.localStorage, naar);
  pasWerkruimteToe(huidigeGebruiker());
  try { // dezelfde week: de gedeelde datum van Kalender en Route gaat mee naar de andere werkruimte
    const sd = await import('./schermen/sales-data.js');
    if (naar === 'sales') sd.zetGekozenDatum(get('gekozenDatum'));
    else if (sd.salesToestand().datumGekozen) set('gekozenDatum', sd.gekozenDatum());
  } catch { /* de datum is een gemak, geen voorwaarde */ }
  setTab(omzetTab(actief, naar, { smal: document.documentElement.dataset.indeling === 'smal' }));
  persoonskiezer.bouwMenu();
  persoonskiezer.werkKnopBij();
  const filter = get('activeAssigneeFilter');
  toast(naar === 'sales'
    ? `Je bekijkt nu de sales-planning van ${verkoper?.naam || 'de gekozen verkoper'}.`
    : `Je bekijkt nu de planning van ${filter === 'all' ? 'alle technici' : filter}.`);
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
  // Een technieker met "Mag zelf plannen" die de week van een collega (of iedereen) bekijkt: "Plan deze week" verdwijnt (CSS
  // html[data-plan-ander="ja"]); autoPlan en de server weigeren het hoe dan ook. Planner en beheerder: altijd 'nee'.
  const zetPlanAnder = () => document.documentElement.setAttribute('data-plan-ander',
    window.apparaat?.rol === 'technieker' && !magPlannenVoor(get('activeAssigneeFilter')) ? 'ja' : 'nee');
  st.abonneer(['activeAssigneeFilter'], zetPlanAnder);
  zetPlanAnder();
  st.abonneer(['planning', 'allTickets', 'allPending', 'allGepland'], () => { if (!_eigenToepassing) _lokaleWijziging++; });
  st.abonneer(['allTickets', 'allPending', 'allGepland', 'activeAssigneeFilter'], () => buildPersonSelector());
  st.abonneer(['allTickets', 'activeAssigneeFilter'], () => wachtrij.renderTickets());
  st.abonneer(['allTickets', 'allPending', 'allGepland', 'localEvents', 'avExceptions', 'activeAssigneeFilter', 'gekozenDatum'], () => kalender.renderKalender());
  st.abonneer(['allGepland', 'allPending', 'activeAssigneeFilter', 'gekozenDatum'], () => ingepland.renderGepland()); // allPending: de paginakop telt "wacht op bevestiging" (taak 8a)
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
    afspraken.verversAfspraken(); // v2.1.6: ook de eigen afspraken (vroeger enkel bij de start geladen)
  }, 30 * 1000); // check elke 30s, laad pas als 5min verstreken
}

// Terug naar de app (visibilitychange) of de verbinding is terug (online), v2.1.6: een tablet die de app op de achtergrond had, toonde
// tot de volgende poll een planning met items die intussen op de pc verwijderd waren. De afspraken (Blobs, licht) altijd; de tickets
// (Zoho, zwaar) als de laatste geslaagde lading meer dan een minuut oud is. Nooit tijdens het vastleggen van een routevolgorde (I4);
// eigen wijzigingen die nog onderweg zijn, beschermen loadTickets (schrijfstand) en verversAfspraken zelf.
// Nieuwe release terwijl de app openstaat (v2.1.6). Een tablet laat de PWA dagen openstaan: de pagina draait dan de code van de dag
// waarop ze geladen werd, en een nieuwe service worker neemt de pagina over (skipWaiting + clients.claim) zonder dat haar modules
// veranderen; late imports zouden daarna wel van de nieuwe release komen. Daarom: bij terugkeer naar de app hoogstens elk half uur naar
// een nieuwe SW vragen, en zodra een nieuwe SW een pagina overneemt die al een SW had, het versielabel eerlijk maken en de pagina één
// keer herladen op het eerstvolgende veilige moment: wanneer de gebruiker de app wegzet (onzichtbaar), zonder open rapport of venster
// en zonder lopende planwijziging. De eerste installatie (nog geen SW) herlaadt niet: die pagina kwam al van het netwerk.
const SW_UPDATE_INTERVAL_MS = 30 * 60 * 1000;
let _swUpdateGevraagd = Date.now();
let _nieuweVersieKlaar = false;
// Niet herladen met een open rapport, venster, dialoog of het spel (role=dialog), met een invoerveld in gebruik (bv. een zoekterm of een
// tabel buiten een venster), zolang een schrijfactie naar de server onderweg is (opslaan, voorstel, rapport, foto, outbox: een herlading
// breekt die af en maakt het resultaat onzeker) of tijdens een planwijziging. Lukt het niet, dan volgt een nieuwe kans bij het volgende
// wegzetten.
function veiligOmTeHerladen() {
  if (document.getElementById('rapport-wizard')?.classList.contains('open')) return false;
  if (document.querySelector('.overlay.open, .open[role="dialog"], .open[role="alertdialog"]')) return false;
  const actief = document.activeElement;
  if (actief && actief !== document.body && (actief.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(actief.tagName))) return false;
  if (lopendeSchrijfverzoeken() > 0 || _outboxInFlight.size > 0) return false;
  if (planacties.schrijfStand().bezig) return false;
  return true;
}
function volgSwUpdates() {
  const sw = navigator.serviceWorker;
  const hadSw = !!sw.controller;
  sw.addEventListener('controllerchange', async () => {
    if (!hadSw || _nieuweVersieKlaar) return;
    // Kwam deze pagina al van het netwerk met de nieuwe release (eerste start na een update), dan neemt de nieuwe SW enkel over:
    // geen melding en geen herlading. Lukt de controle niet, dan liever één herlading te veel dan een mengeling van versies.
    try {
      const r = await fetch('/js/versie.js', { cache: 'no-store' });
      if (r.ok && leesVersie(await r.text()) === APP_VERSIE) return;
    } catch { /* onbekend: als nieuwe versie behandelen */ }
    if (_nieuweVersieKlaar) return;
    _nieuweVersieKlaar = true;
    const label = document.getElementById('app-versie');
    if (label && !label.textContent.includes('nieuwe versie')) label.textContent += ' · nieuwe versie klaar, wordt geladen bij het wegzetten van de app';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (_nieuweVersieKlaar && veiligOmTeHerladen()) location.reload();
      return;
    }
    if (Date.now() - _swUpdateGevraagd < SW_UPDATE_INTERVAL_MS) return;
    _swUpdateGevraagd = Date.now();
    sw.getRegistration().then(reg => reg?.update()).catch(() => {});
  });
}

const TERUGKEER_TICKETS_MS = 60 * 1000;
function verversNaTerugkeer() {
  if (document.visibilityState !== 'visible') return;
  afspraken.verversAfspraken();
  if (route.routeOrderBezig()) return;
  if (Date.now() - _lastTicketLoad < TERUGKEER_TICKETS_MS) return;
  loadTickets({ stilleToast: true, stil: true });
  voorstel.loadVoorstelStatus();
}

// ══════════════════════════════════════════════
// ROUTE TAB
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════
// Pijltjestoetsen in de tabbalk (roving tabindex): alleen zichtbare tabs tellen (coord-only kan verborgen zijn).
// In de zijkolom (data-nav="kolom", kern/navigatievorm.js) staan de tabs onder elkaar (Open dag): aria-orientation="vertical" en ook pijl
// omhoog/omlaag; links/rechts blijven werken.
function zetTabOrientatie() {
  const balk = document.querySelector('.tabs-inner');
  if (!balk) return;
  if (document.documentElement.getAttribute('data-nav') === 'kolom') balk.setAttribute('aria-orientation', 'vertical');
  else balk.removeAttribute('aria-orientation');
}
zetTabOrientatie();
window.addEventListener('navigatievormwijziging', zetTabOrientatie); // zijkolom <-> dok: weergavewissel of een breder/smaller venster
document.querySelector('.tabs-inner')?.addEventListener('keydown', e => {
  const verticaal = e.currentTarget.getAttribute('aria-orientation') === 'vertical';
  const vooruit = e.key === 'ArrowRight' || (verticaal && e.key === 'ArrowDown');
  const achteruit = e.key === 'ArrowLeft' || (verticaal && e.key === 'ArrowUp');
  if (!vooruit && !achteruit && e.key !== 'Home' && e.key !== 'End') return;
  const tabs = [...document.querySelectorAll('.tabs-inner .tab')].filter(t => t.offsetParent !== null);
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
    : (i + (vooruit ? 1 : -1) + tabs.length) % tabs.length;
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
  const active = document.querySelector('.tab.active');
  if (active && tabVerborgenVoorToestel(active)) setTab(huidigeWerkruimte() === 'sales' ? 'sales-kalender' : 'kalender'); // de beheerder in Sales valt terug op de Kalender van Sales
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
  bewaarThemaWissel(next); // tijdens een evenement in de eigen sleutel, anders blitz_theme
  document.getElementById('meta-theme-color')
    ?.setAttribute('content', next === 'light' ? '#e5eefa' : '#0d1530');
}

// Escape/focusval per venster: zie public/js/venster.js

installeerTijdPicker(document, window); // tik op een tijd-/datumveld opent de klok/kalender (Android)
window.addEventListener('versiering-gewijzigd', () => { // thema aan/uit: lege-tekst-lijsten direct hertekenen
  try { wachtrij.renderTickets(); ingepland.renderGepland(); } catch (e) { /* app nog niet opgestart: de eerste render pakt het thema vanzelf */ }
});
// Feestelijke versiering (schermen/evenement-laag.js): meteen het thema uit de cache (themasNu, geen netwerk); na het inloggen
// (opstart) de verse themas van /api/themas (schermen/themas-bron.js) en opnieuw berekenen; ook bij terugkeer naar de pagina
// (hoogstens één keer per minuut) en, voor een toestel dat dagen vooraan blijft staan, in de minuutcontrole zodra de laatste lading
// meer dan 30 minuten oud is (fix-ronde 1: een thema dat de beheerder uitzet, bereikt zo ook de planner-pc). Uit in ?test (tenzij
// ?versiering=aan) en op aanraak enkel statisch. Een mislukte lading laat de cache staan (nooit een fout); de 30 minuten tellen
// vanaf de laatste poging, zodat een toestel zonder netwerk niet elke minuut opnieuw probeert.
const THEMAS_MAX_OUDERDOM_MS = 30 * 60000;
let themasGeladenOm = 0; // 0 = nog niet ingelogd/opgestart: geen lading bij terugkeer naar de pagina of in de minuutcontrole
function vernieuwThemas() {
  themasGeladenOm = Date.now();
  laadThemas().then(herberekenVersiering, () => {}).catch((e) => console.warn('themas herberekenen mislukt:', e?.message || e));
}
startVersiering({
  bewegingUit: () => instellingen.eigenBewegingUit(), // persoonlijke instelling van het account (schermen/instellingen.js)
  elkeMinuut: () => { if (themasGeladenOm && Date.now() - themasGeladenOm > THEMAS_MAX_OUDERDOM_MS) vernieuwThemas(); },
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && themasGeladenOm && Date.now() - themasGeladenOm > 60000) vernieuwThemas();
});
// De verse themas (/api/themas) pas na het inloggen (vóór de login gebruikt de app geen gegevens van de server), voor elke rol: ook
// sales, dat een eigen start heeft en `opstart` niet doorloopt (fix-ronde 1).
document.addEventListener('DOMContentLoaded', () => {
  startHemel(); // de hemel (css/hemel.css) meteen, vóór het inloggen: ook het inlogscherm staat op de hemel van het uur
  initDokMeer(); // "Meer" in het dok (schermen/dok-meer.js): meteen, vóór de login en voor elke rol (ook sales, dat `opstart` niet doorloopt); abonneert zich niet op de toestand
  initPaginakop(); // titel + samenvatting van de paginakop op `breed` (schermen/paginakop.js): ook voor sales; volgt de actieve tab, geen abonnement op de toestand
  zetTabIconen(document); // de iconen van de vaste tabs (index.html); rol-schil.js zet ze voor de tabs die het zelf aanmaakt
  return startNaInlog(opstart).then(() => {
    if (!huidigeGebruiker()) return;
    herberekenVersiering(); // de instellingen zijn gesynchroniseerd (ook `bewegingUit`): niet wachten op de themas
    vernieuwThemas();
  }).catch((e) => console.warn('start na inloggen mislukt:', e?.message || e));
});
