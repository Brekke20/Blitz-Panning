// schermen/kalender.js — de Kalender-tab (etappe 4): kaartjes, tijdlijn, maand, nu-lijn, hoogte, toestand en navigatie.
// De code is letterlijk uit index.html verhuisd. De pure indeling (lanen, tijdlijnitems, constanten) staat in
// `kalender-logica.js`; gegevens komen uit `kern/toestand`, de afhankelijkheden van andere schermen via
// `initKalender(afh)` (aan het begin van DOMContentLoaded, vóór koppelRenders). Raakt `document`/`window` enkel
// binnen functies, nooit op moduleniveau; de hoogste-niveau-effecten (observer, resize, visibilitychange) draaien
// in `initKalender`. Alleen `kern/brug.js` wijst `window`-namen toe. De schermtoestand (`kalOffset`,
// `kalDagOffset`, `kalView`, auto-scrollsleutel) is module-privé; de knoppen lopen via data-actie-delegatie (C8).
import { toestand } from '../kern/toestand.js';
import { escHtml, registreerActies, maakActiveerbaar } from '../kern/ui.js';
import { localISO, getWeekStart, fmtDateShort } from '../kern/tijd.js';
import { blokkeringenVoor, planItemsVanTechnieker, eigenAfsprakenVoor } from '../kern/selecties.js';
import {
  TIMELINE_PX_PER_MIN, WERKUUR_START, WERKUUR_EIND, isBuitenWerkuren, timelineTopHeight,
  bepaalLanes, bouwTijdlijnItems, zichtbareDagen, maandRaster, autoScrollSleutel,
} from './kalender-logica.js';
import { capaciteitsKop, capacityForDay } from './capaciteit.js';
import { renderRouteList } from './route.js';

// Afhankelijkheden uit het klassieke script (ingevuld door initKalender); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('kalender: initKalender() is niet aangeroepen'); } });

let _kalRO = null, _kalROFrame = 0;
let _kalResizeTimer = null;
let _nuLijnTimer = null;

// Schermtoestand (voorheen globals in index.html).
let kalOffset = 0;
let kalDagOffset = 0; // tablet rechtop: verschuiving in WERKDAGEN t.o.v. vandaag (los van kalOffset, mag negatief)
let kalView = 'week'; // 'week' | 'month'
let _kalAutoScrollKey = null;
let renderTeller = 0; // e2e telt hertekeningen hiermee, ook interne oproepen

// Aantal keren dat renderKalender() draaide (voor e2e/kern.spec.mjs).
export function renderTelling() { return renderTeller; }
// Weekverschuiving voor autoPlan (index.html): geeft kalOffset ongewijzigd terug (C13).
export function weekOffset() { return kalOffset; }
// Tabwissel naar Kalender: tekenen en naar de werkdag scrollen.
export function activeerKalender() { renderKalender(); kalAutoScroll(true); }

// aria-pressed bijwerken waar de 'active'-klasse gezet wordt
function zetPressed(el, aan) {
  if (el) el.setAttribute('aria-pressed', aan ? 'true' : 'false');
}

export function initKalender(afhankelijkheden) {
  afh = afhankelijkheden;
  // Alle knoppen van dit scherm via data-actie-delegatie (de kaartluisteraars slaan zulke klikken over, C8).
  registreerActies(document.body, {
    'kal-uitplannen': el => afh.bevestigUitplannen(el.dataset.ticketId, el.dataset.datum),
    'kal-event-verwijder': el => afh.removeLocalEvent(el.dataset.eventId),
    'kal-nav': (el, e, arg) => kalNav(Number(arg)),
    'kal-vandaag': () => kalToday(),
    'kal-weergave': (el, e, arg) => setKalView(arg),
    'kal-pending': () => togglePendingPanel(),
    'kal-blok': el => afh.openBlockModal(el.dataset.date),
    'kal-toewijzen-open': el => afh.toggleAssignRow(el.dataset.ticketId),
    'kal-toewijzen-opslaan': el => afh.saveToewijzen(el.dataset.ticketId),
    'kal-toewijzen-sluit': el => { document.getElementById('assign-row-' + el.dataset.ticketId).style.display = 'none'; },
  });
  kalStartHoogteObserver();
  window.addEventListener('resize', () => {
    clearTimeout(_kalResizeTimer);
    _kalResizeTimer = setTimeout(kalPasGridHoogteAan, 100);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateNuLijn(); });
}

function buildTicketCard(stop, dateStr, { showActions = true } = {}) {
  const isPending   = stop.ticket.status === 'Wachten op bevestiging planning';
  const cardClass   = isPending ? 'pending' : 'confirmed';
  const badgeLabel  = isPending ? 'Wacht bevestiging' : 'Bevestigd';
  const card        = document.createElement('div');
  card.className    = `cal-ticket ${cardClass}`;
  card.innerHTML    = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
      <div style="flex:1;min-width:0">
        <div class="cal-num">#${escHtml(stop.ticket.number)}</div>
        <span class="cal-badge ${cardClass}">${badgeLabel}</span>
        ${stop.uur ? (() => {
          // Tijdslot (Task 9, Blok 1C): primair label, consistent met wat de klant ziet in de
          // voorstel-mail. Bewuste keuze (zie taakbrief Step 5): de technieker ziet, i.t.t. de
          // klant, ook de exacte geplande tijd als kleiner detail — nuttig voor zijn eigen
          // planning-efficiëntie. buildTicketCard() wordt gedeeld door de desktop-tijdlijn en
          // de mobiele gestapelde lijst, dus dit geldt voor beide (geen mobiel/desktop-verschil).
          const win = afh.tijdslotLabelVoor(stop, dateStr);
          return `<div class="cal-meta" style="font-weight:600">🕐 ${escHtml(win)} <span style="opacity:0.65;font-size:0.85em">(gepland ${stop.uur})</span></div>`;
        })() : ''}
        <div class="cal-sub">${escHtml(stop.ticket.subject) || '—'}</div>
        ${stop.ticket.assignee ? `<div class="cal-meta">${escHtml(stop.ticket.assignee)}</div>` : ''}
        <div class="cal-addr ${stop.ticket.hasAddress ? '' : 'miss'}">${stop.ticket.hasAddress ? escHtml(stop.address) : 'Geen adres'}</div>
      </div>
      <button class="cal-unplan-x coord-only" data-actie="kal-uitplannen" data-ticket-id="${escHtml(stop.ticket.id)}" data-datum="${escHtml(dateStr)}" title="Uit planning halen" aria-label="Uit planning halen" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;flex-shrink:0;padding:2px 4px;line-height:1">×</button>
    </div>
    ${showActions ? `<div class="cal-actions">
      ${/\d/.test(afh.telNummer(stop.ticket.telefoonEindklant||stop.ticket.phone)) ? `<a class="cal-btn" href="tel:${escHtml(afh.telNummer(stop.ticket.telefoonEindklant||stop.ticket.phone))}">📞 Bellen</a>` : ''}
      ${stop.ticket.hasAddress ? `<button class="cal-btn btn-navigeer" data-adres="${escHtml(stop.address||stop.ticket.address||'')}">🧭 Navigeer</button>` : ''}
    </div>` : ''}`;
  card.querySelector('.btn-navigeer')?.addEventListener('click', e => {
    e.stopPropagation();
    afh.navigate(encodeURIComponent(e.currentTarget.dataset.adres));
  });
  // Bugfix (W5): "Bellen" opende naast het gesprek ook het ticketdetail; nu stopt de klik hier, zoals bij Navigeer.
  card.querySelector('a.cal-btn[href^="tel:"]')?.addEventListener('click', e => e.stopPropagation());
  // Bubbel-guard (C8): een klik op een data-actie-knop opent het detail niet.
  card.addEventListener('click', e => { if (e.target.closest('[data-actie]')) return; afh.openDetail(stop.ticket); });
  maakActiveerbaar(card, () => afh.openDetail(stop.ticket), 'Open ticket #' + stop.ticket.number);
  return card;
}

function buildReportCard(entry) {
  const rd = entry.rapportData || {};
  const tijdLabel = rd.start ? `${escHtml(rd.start)}${rd.stop ? '–' + escHtml(rd.stop) : ''}` : '';
  const card = document.createElement('div');
  card.className = 'cal-ticket afgerond';
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
      <div style="flex:1;min-width:0">
        ${entry.ticketNumber ? `<div class="cal-num">#${escHtml(entry.ticketNumber)}</div>` : ''}
        <span class="cal-badge afgerond">✓ Afgerond</span>
        ${tijdLabel ? `<div class="cal-meta" style="font-weight:600">🕐 ${tijdLabel}</div>` : ''}
        <div class="cal-sub">${escHtml(entry.klant) || '—'}</div>
        ${entry.technieker ? `<div class="cal-meta">${escHtml(entry.technieker)}</div>` : ''}
        <div class="cal-addr ${entry.adres ? '' : 'miss'}">${entry.adres ? escHtml(entry.adres) : 'Geen adres'}</div>
      </div>
    </div>`;
  // Bubbel-guard (C8): een klik op een data-actie-knop opent het rapport niet (deze kaart heeft er geen; vangnet).
  card.addEventListener('click', e => { if (e.target.closest('[data-actie]')) return; afh.herOpenRapport(afh.rapportArchief().indexOf(entry)); });
  return card;
}

function buildLocalEventCard(ev, { showActions = true } = {}) {
  const card = document.createElement('div');
  card.className = 'cal-local-event';
  const tijdLabel = ev.uur ? `${ev.uur}${ev.einduur ? '–' + ev.einduur : ''}` : '';
  const adresLabel = ev.adres || ev.notitie;
  card.innerHTML = `
    <button class="cal-local-del" data-actie="kal-event-verwijder" data-event-id="${escHtml(ev.id)}" title="Verwijderen" aria-label="Afspraak verwijderen">✕</button>
    <span class="cal-local-type">${escHtml(ev.type)}</span>
    <div class="cal-sub" style="margin-top:2px">${escHtml(ev.titel)}</div>
    ${tijdLabel ? `<div class="cal-local-time">⏱ ${tijdLabel}</div>` : ''}
    ${adresLabel ? `<div class="cal-addr">${escHtml(adresLabel)}</div>` : ''}
    ${ev.persoon ? `<div class="cal-meta">${escHtml(ev.persoon)}</div>` : ''}
    ${showActions ? `<div class="cal-actions">
      ${/\d/.test(afh.telNummer(ev.telefoon)) ? `<a class="cal-btn cal-ev-call" href="tel:${escHtml(afh.telNummer(ev.telefoon))}">📞 Bellen</a>` : ''}
      ${adresLabel ? `<button class="cal-btn cal-ev-nav">🧭 Navigeer</button>` : ''}
    </div>` : ''}`;
  // ev.id komt uit de afspraken-blob (niet-geauthenticeerd) — daarom als geëscapete data-attribuut, niet als
  // inline onclick-string (niet veilig tegen apostrofs in de brondata); de verwijderknop loopt via data-actie.
  card.querySelector('.cal-ev-call')?.addEventListener('click', e => e.stopPropagation());
  card.querySelector('.cal-ev-nav')?.addEventListener('click', e => { e.stopPropagation(); afh.navigate(encodeURIComponent(adresLabel)); });
  // Bubbel-guard (C8): een klik op een data-actie-knop (✕) opent het detail niet.
  card.addEventListener('click', e => { if (e.target.closest('[data-actie]')) return; afh.openLocalEventDetail(ev); });
  return card;
}

// Post-launch feedback (2026-08-17): gedeeld door renderDayTimeline() (elke dag-kolom) EN
// renderTimelineGutter() (de uren-kolom vóór maandag) -- beide MOETEN exact dezelfde
// dagStartMin/dagEindMin/totalHeight gebruiken, anders lopen de uur-lijnen in de dag-kolommen niet
// meer gelijk met de uur-labels in de gutter. Fase 2 (v1.7.0): vast 00:00-24:00 (het volledige
// etmaal), zodat ook vroege/late afspraken zichtbaar zijn; de werkuren-instelling speelt geen rol meer.
function computeTimelineRange() {
  const dagStartMin = 0;
  const dagEindMin = 1440;
  const displayStartH = 0;
  const displayEndH = 24;
  const totalHeight = (dagEindMin - dagStartMin) * TIMELINE_PX_PER_MIN;
  return { dagStartMin, dagEindMin, displayStartH, displayEndH, totalHeight };
}

// Twee achtergrondbanden (00:00-werkuurstart en werkuureinde-24:00); eerste kinderen van de wrap.
function appendOffhoursBands(wrap, dagStartMin, totalHeight) {
  const boven = document.createElement('div');
  boven.className = 'tl-offhours';
  boven.style.top = '0px';
  boven.style.height = `${(WERKUUR_START - dagStartMin) * TIMELINE_PX_PER_MIN}px`;
  const onder = document.createElement('div');
  onder.className = 'tl-offhours';
  const onderTop = (WERKUUR_EIND - dagStartMin) * TIMELINE_PX_PER_MIN;
  onder.style.top = `${onderTop}px`;
  onder.style.height = `${totalHeight - onderTop}px`;
  wrap.appendChild(boven);
  wrap.appendChild(onder);
}

// Smalle kolom vóór maandag met enkel de uur-labels (zie .day-col.tl-gutter in app.css) --
// voorheen stonden deze labels IN de eerste dag-kolom, die daardoor een 34px-marge reserveerde
// die de andere kolommen ook reserveerden (voor uitlijning) maar nooit gebruikten: lege ruimte in
// elke kolom behalve de eerste, en alle kolommen "verschillend" qua bruikbare breedte. Nu krijgen
// alle dag-kolommen exact dezelfde afmetingen.
function renderTimelineGutter() {
  const { dagStartMin, displayStartH, displayEndH, totalHeight } = computeTimelineRange();
  const col = document.createElement('div');
  col.className = 'day-col tl-gutter';
  const hdr = document.createElement('div');
  hdr.className = 'day-hdr';
  const body = document.createElement('div');
  body.className = 'day-body';
  const wrap = document.createElement('div');
  wrap.className = 'tl-gutter-wrap';
  wrap.style.height = `${totalHeight}px`;
  appendOffhoursBands(wrap, dagStartMin, totalHeight);
  for (let h = displayStartH; h <= displayEndH; h++) {
    const top = (h * 60 - dagStartMin) * TIMELINE_PX_PER_MIN;
    const label = document.createElement('div');
    label.className = 'tl-gutter-label';
    label.style.top = `${top}px`;
    label.textContent = `${String(h).padStart(2,'0')}:00`;
    wrap.appendChild(label);
  }
  body.appendChild(wrap);
  col.appendChild(hdr);
  col.appendChild(body);
  return col;
}

// Tekent één dag als een echte tijdlijn (uur-as, blokken proportioneel aan duur) — enkel voor
// desktop/web (zie renderKalender()'s responsieve vertakking). Mobiel behoudt de bestaande
// gestapelde-kaartjeslijst volledig ongewijzigd.
// Let op: bouwt met echte DOM-nodes (niet HTML-strings) — buildTicketCard/buildLocalEventCard/
// buildReportCard maken elementen met addEventListener-listeners (klik → detail, navigeer-knop);
// via een HTML-string (bv. .outerHTML) zouden die listeners bij het opnieuw parsen verloren gaan.
function renderDayTimeline(dateStr, dayStops, dayEvents, dayReports, hdrEl) {
  // Fase 2 (v1.7.0): de tijdlijn toont vast het volledige etmaal 00:00-24:00 (zie computeTimelineRange()).
  const { dagStartMin, displayStartH, displayEndH, totalHeight } = computeTimelineRange();

  const frag = document.createDocumentFragment();

  const wrap = document.createElement('div');
  wrap.className = 'tl-wrap';
  wrap.style.height = `${totalHeight}px`;
  appendOffhoursBands(wrap, dagStartMin, totalHeight);

  // Uur-labels staan niet meer hier (zie renderTimelineGutter()) -- enkel de streeplijnen zelf,
  // voor de visuele uitlijning van blokken met het uur-raster.
  for (let h = displayStartH; h <= displayEndH; h++) {
    const top = (h * 60 - dagStartMin) * TIMELINE_PX_PER_MIN;
    const line = document.createElement('div');
    line.className = 'tl-hour-line';
    line.style.top = `${top}px`;
    wrap.appendChild(line);
  }

  // Geblokkeerde/verlof-tijdvakken (avExceptions, kind==='range') als gepositioneerd segment —
  // vóór dayStops/dayEvents toegevoegd zodat ze in DOM-volgorde ONDER de ticket/event-blokken
  // liggen (die zelf geen z-index zetten, dus DOM-volgorde bepaalt de zichtbare laag). Hele-dag
  // (kind==='fullday') uitzonderingen krijgen hier geen los blok — die worden al elders als
  // kolom-brede stripe (blocked-day-klasse) getoond.
  const dayExceptions = blokkeringenVoor(toestand.get('avExceptions'), dateStr, toestand.get('activeAssigneeFilter'), 'range');
  dayExceptions.forEach(e => {
    const [fromH, fromM] = e.from.split(':').map(Number);
    const [toH, toM]     = e.to.split(':').map(Number);
    const startMin = fromH * 60 + fromM;
    const endMin   = toH * 60 + toM;
    const { top, height } = timelineTopHeight(startMin, endMin, dagStartMin, totalHeight);
    // Let op: dit is textContent/title (DOM-property), geen innerHTML — dus GEEN escHtml() hier;
    // die zou entities dubbel encoderen ("&" -> "&amp;" zichtbaar als tekst i.p.v. "&").
    const reasonPart = e.reason ? `: ${e.reason}` : '';
    const block = document.createElement('div');
    block.className = 'tl-block tl-blocked';
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    block.title = `Niet beschikbaar${reasonPart}`;
    block.textContent = `🔒 ${e.from}–${e.to}${reasonPart}`;
    wrap.appendChild(block);
  });

  // Post-launch feedback (2026-08-17): tickets + lokale afspraken samen door de laan-toewijzing
  // halen (ze kunnen elkaar ook onderling overlappen, niet enkel binnen hun eigen soort), dan pas
  // de DOM-elementen bouwen met de toegewezen lane/laneCount. Afgeronde rapporten met een gekende
  // werkelijke start-/stoptijd staan ook op hun eigen plaats; enkel rapporten ZONDER gekende tijd
  // blijven in de ongepositioneerde lijst hieronder.
  const settings = toestand.get('settings');
  const positioned = bouwTijdlijnItems(
    { dayStops, dayEvents, dayReports },
    { duurVoor: afh.duurVoor, tijdslotMinuten: settings.tijdslotMinuten, duurMinuten: settings.duurMinuten });
  bepaalLanes(positioned);

  positioned.forEach(item => {
    const { top, height } = timelineTopHeight(item.startMin, item.endMin, dagStartMin, totalHeight);
    const block = document.createElement('div');
    block.className = item.type === 'ticket' ? 'tl-block tl-ticket'
      : item.type === 'report' ? 'tl-block tl-report'
      : 'tl-block tl-event';
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    // Laan-breedte/positie via CSS calc() t.o.v. de 6px links-/rechtermarge (zie .tl-block in
    // app.css): de beschikbare breedte wordt gelijk verdeeld over laneCount lanen, met een kleine
    // 2px-tussenruimte zodat naast-elkaar-staande blokken visueel gescheiden blijven.
    if (item.laneCount > 1) {
      block.style.left  = `calc(6px + (100% - 12px) * ${item.lane} / ${item.laneCount})`;
      block.style.width = `calc((100% - 12px) / ${item.laneCount} - 2px)`;
      block.style.right = 'auto';
    }
    if (item.type === 'ticket') {
      block.dataset.ticketId = item.stop.ticket.id;
      // Post-launch feedback (2026-08-17): bel-/navigeerknoppen enkel op mobiel nodig — op
      // desktop opent een klik op de kaart toch al het detail (met bel/navigeer erin).
      block.appendChild(buildTicketCard(item.stop, dateStr, { showActions: false }));
    } else if (item.type === 'report') {
      block.appendChild(buildReportCard(item.report));
    } else {
      block.appendChild(buildLocalEventCard(item.ev, { showActions: false }));
    }
    wrap.appendChild(block);
  });

  // Items ZONDER gekend uur (tickets zonder uur, rapporten zonder starttijd) staan als compacte
  // klikbare chips IN de sticky dagkop (altijd zichtbaar, ook na de auto-scroll naar de werkdag).
  const zonderUur = [
    ...dayStops.filter(s => !s.uur).map(s => ({ label: `#${s.ticket.number}`, title: s.ticket.subject || '', open: () => afh.openDetail(s.ticket) })),
    ...dayReports.filter(r => !r.rapportData?.start).map(r => ({ label: r.ticketNumber ? `#${r.ticketNumber}` : (r.klant || 'Rapport'), title: r.klant || '', open: () => afh.herOpenRapport(afh.rapportArchief().indexOf(r)) })),
  ];
  if (zonderUur.length && hdrEl) {
    const rij = document.createElement('div');
    rij.className = 'day-hdr-zonderuur';
    const lbl = document.createElement('span');
    lbl.className = 'zu-label';
    lbl.textContent = 'Zonder uur:';
    rij.appendChild(lbl);
    zonderUur.slice(0, 4).forEach(it => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'zu-chip';
      chip.textContent = it.label;
      if (it.title) chip.title = it.title;
      chip.addEventListener('click', e => { e.stopPropagation(); it.open(); });
      rij.appendChild(chip);
    });
    if (zonderUur.length > 4) {
      const meer = document.createElement('span');
      meer.className = 'zu-meer';
      meer.textContent = `+${zonderUur.length - 4} meer`;
      meer.title = zonderUur.slice(4).map(it => it.label).join(', ');
      rij.appendChild(meer);
    }
    hdrEl.appendChild(rij);
  }

  frag.appendChild(wrap);

  return frag;
}

// Eén verticale scrollbalk: in de tijdlijnweergave is #week-grid de scrollcontainer met een
// hoogte die het resterende venster vult (meten bij render time: er staat UI boven het grid).
function kalPasGridHoogteAan() {
  const grid = document.getElementById('week-grid');
  if (!grid || !grid.classList.contains('tl-mode')) return;
  // Niet meten als het grid geen layoutbox heeft (verborgen tab): top is dan 0 en de hoogte fout.
  if (!grid.getClientRects().length) return;
  // Document-relatief meten (niet t.o.v. de viewport): anders klopt de hoogte niet als de pagina gescrold is.
  const top = grid.getBoundingClientRect().top + window.scrollY;
  grid.style.height = `${Math.max(400, Math.round(window.innerHeight - top - 16))}px`;
}
// Eén ResizeObserver (eenmalig aangemaakt) op alles wat boven het grid staat: verandert dat van
// hoogte (zonder-datum-paneel, offline-/outbox-banner, tab zichtbaar) dan wordt de hoogte herberekend.
function kalStartHoogteObserver() {
  if (_kalRO || typeof ResizeObserver === 'undefined') return;
  _kalRO = new ResizeObserver(() => {
    cancelAnimationFrame(_kalROFrame);
    _kalROFrame = requestAnimationFrame(kalPasGridHoogteAan);
  });
  ['offline-banner', 'outbox-banner', 'kal-header', 'kal-no-date-section']
    .forEach(id => { const el = document.getElementById(id) || document.querySelector('#view-kalender .' + id); if (el) _kalRO.observe(el); });
}

// Rode "nu"-lijn: staat in de .tl-wrap van de kolom van vandaag (enkel de tijdlijnweergave);
// in maand-/lijstweergave of een andere week is er geen kolom en verdwijnt ze gewoon.
// Nu-markering in de gsm-lijst (gestapelde kaartjes): één dunne rode regel vóór de eerste kaart
// van vandaag met sortKey > nu (kaarten zonder uur = '99:99' tellen als later).
function updateNuMarker() {
  const grid = document.getElementById('week-grid');
  if (!grid) return;
  const nu = new Date();
  const hhmm = `${String(nu.getHours()).padStart(2,'0')}:${String(nu.getMinutes()).padStart(2,'0')}`;
  const body = grid.querySelector(`.day-col[data-date="${localISO(nu)}"] .day-body`);
  grid.querySelectorAll('.kal-nu-marker').forEach(el => { if (!body || el.parentNode !== body) el.remove(); });
  if (!body || body.querySelector('.tl-wrap')) return;   // geen lijstweergave van vandaag
  let marker = body.querySelector(':scope > .kal-nu-marker');
  if (!marker) { marker = document.createElement('div'); marker.className = 'kal-nu-marker'; }
  marker.textContent = `nu ${hhmm}`;
  const kaarten = Array.from(body.querySelectorAll(':scope > [data-sortkey]'));
  const volgende = kaarten.find(k => k.dataset.sortkey > hhmm);
  if (volgende) body.insertBefore(marker, volgende); else body.appendChild(marker);
}
function updateNuLijn() {
  updateNuMarker();
  const grid = document.getElementById('week-grid');
  if (!grid) return;
  const nu = new Date();
  const wrap = grid.querySelector(`.day-col[data-date="${localISO(nu)}"] .tl-wrap`);
  grid.querySelectorAll('.tl-now').forEach(el => { if (!wrap || el.parentNode !== wrap) el.remove(); });
  if (!wrap) return;
  let lijn = wrap.querySelector(':scope > .tl-now');
  if (!lijn) {
    lijn = document.createElement('div');
    lijn.className = 'tl-now';
    const label = document.createElement('span');
    label.className = 'tl-now-label';
    lijn.appendChild(label);
    wrap.appendChild(lijn);
  }
  const { dagStartMin } = computeTimelineRange();
  const nuMin = nu.getHours() * 60 + nu.getMinutes();
  lijn.style.top = `${(nuMin - dagStartMin) * TIMELINE_PX_PER_MIN}px`;
  lijn.firstChild.textContent = `${String(nu.getHours()).padStart(2,'0')}:${String(nu.getMinutes()).padStart(2,'0')}`;
}
function startNuLijnTimer() {
  if (!_nuLijnTimer) _nuLijnTimer = setInterval(updateNuLijn, 60000);
}

// ── Kalender: weergave, navigatie, renderen ─────────────────────────────────
function setKalView(v) {
  kalView = v;
  document.getElementById('kal-view-week').classList.toggle('active',  v === 'week');
  document.getElementById('kal-view-month').classList.toggle('active', v === 'month');
  zetPressed(document.getElementById('kal-view-week'),  v === 'week');
  zetPressed(document.getElementById('kal-view-month'), v === 'month');
  kalOffset = 0; kalDagOffset = 0; // reset offsets bij wisselen
  renderKalender();
  kalAutoScroll(true);
}

// Zichtbare dagen van de weekweergave: gewoon de werkdagen van de week (kalOffset), behalve op een
// tablet rechtop: dan 3 opeenvolgende werkdagen vanaf vandaag, verschoven met kalDagOffset werkdagen.
function kalZichtbareDagen(today) {
  return zichtbareDagen(today, {
    werkdagen: toestand.get('settings').werkdagen, tabletStaand: window.apparaat.indeling === 'tablet-staand',
    weekOffset: kalOffset, dagOffset: kalDagOffset,
  });
}

function kalZetVandaagKnop() {
  // "↺ Vandaag" enkel tonen als de getoonde periode niet de huidige is
  const dagModus = window.apparaat.indeling === 'tablet-staand' && kalView !== 'month';
  const nietVandaag = dagModus ? kalDagOffset !== 0 : kalOffset !== 0;
  const knop = document.getElementById('kal-label');
  if (knop) knop.classList.toggle('niet-vandaag', nietVandaag);
}
// Label zetten + aria-label met de periode (enkel "naar vandaag" aankondigen als dat iets doet)
function kalZetLabel(tekst) {
  const knop = document.getElementById('kal-label');
  document.getElementById('kal-label-tekst').textContent = tekst;
  if (knop.classList.contains('niet-vandaag')) knop.setAttribute('aria-label', tekst + ', naar vandaag');
  else knop.removeAttribute('aria-label');
}
export function renderKalender() {
  renderTeller++;
  kalZetVandaagKnop();
  afh.sjLog('renderKalender'); // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
  const today     = new Date(); today.setHours(0,0,0,0);

  // Pending zonder datum — gemeenschappelijk voor week én maandweergave
  const noInterventieDatum = toestand.get('allPending').filter(t => !t.interventieDatum);
  const pill      = document.getElementById('kal-pending-pill');
  const noDateSec = document.getElementById('kal-no-date-section');
  if (noInterventieDatum.length) {
    document.getElementById('kal-pending-count').textContent = noInterventieDatum.length;
    pill.style.display = '';
    const inner = document.createElement('div');
    inner.className = 'kal-pending-inner';
    inner.innerHTML = `<div class="kal-pending-hdr">Wacht bevestiging — zonder datum</div>`;
    noInterventieDatum.forEach(t => {
      const card = document.createElement('div');
      card.className = 'ticket';
      card.style.cssText = 'cursor:pointer';
      card.innerHTML = `<div class="t-body">
        <div class="t-top"><span class="tnum">#${escHtml(t.number)}</span><span class="stag pending">Wacht bevestiging</span>${t.assignee ? `<span class="atag">${escHtml(t.assignee)}</span>` : ''}</div>
        <div class="tsub">${escHtml(t.subject) || '—'}</div>
        <div class="taddr ${t.hasAddress ? 'ok' : 'miss'}">${t.hasAddress ? escHtml(t.address) : 'Geen adres bekend'}</div>
        <div class="t-assign-row" id="assign-row-${t.id}" style="display:none;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px">
          <input type="date" id="assign-date-${t.id}" aria-label="Datum toewijzen" style="font-size:0.8rem;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)">
          <input type="time" id="assign-time-${t.id}" aria-label="Tijd toewijzen" style="font-size:0.8rem;padding:3px 6px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text)" value="09:00">
          <button data-actie="kal-toewijzen-opslaan" data-ticket-id="${escHtml(t.id)}" style="font-size:0.75rem;padding:3px 8px;background:var(--accent);color:var(--on-accent);border:none;border-radius:4px;cursor:pointer;font-weight:600">✓ Opslaan</button>
          <button aria-label="Sluiten" data-actie="kal-toewijzen-sluit" data-ticket-id="${escHtml(t.id)}" style="font-size:0.75rem;padding:3px 6px;background:none;border:1px solid var(--border);border-radius:4px;cursor:pointer;color:var(--muted)">✕</button>
        </div>
        <div style="margin-top:6px">
          <button data-actie="kal-toewijzen-open" data-ticket-id="${escHtml(t.id)}" style="font-size:0.75rem;padding:3px 8px;background:var(--accent-dim,rgba(0,223,163,.15));color:var(--accent-ink);border:1px solid var(--accent);border-radius:4px;cursor:pointer;font-weight:600">📅 Toewijzen</button>
        </div>
      </div>`;
      // Bubbel-guard (C8): een klik op een data-actie-knop opent het detail niet.
      card.addEventListener('click', e => { if (e.target.closest('[data-actie]')) return; afh.openDetail(t); });
      maakActiveerbaar(card, () => afh.openDetail(t), 'Open ticket #' + t.number);
      inner.appendChild(card);
    });
    noDateSec.innerHTML = '';
    noDateSec.appendChild(inner);
  } else {
    pill.style.display = 'none';
    pill.setAttribute('aria-expanded', 'false');
    noDateSec.innerHTML = '';
    noDateSec.classList.remove('open');
  }

  // Branch: week of maand
  if (kalView === 'month') {
    const mg = document.getElementById('week-grid');
    mg.className = 'month-grid';
    mg.style.height = '';
    renderMonthView(today);
    return;
  }

  // Week-view
  const weekStart = getWeekStart(today, kalOffset);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  const dagen = kalZichtbareDagen(today);
  if (window.apparaat.indeling === 'tablet-staand' && dagen.length) {
    kalZetLabel(fmtDateShort(dagen[0]) + ' – ' + fmtDateShort(dagen[dagen.length - 1]));
  } else {
    kalZetLabel(fmtDateShort(weekStart) + ' – ' + fmtDateShort(weekEnd));
  }

  const grid = document.getElementById('week-grid');
  const isDesktopTijdlijnWeek = window.apparaat.indeling !== 'smal';
  // scrollpositie bewaren: innerHTML = '' zet die anders terug op 0 bij elke her-render (polling)
  const bewaardTop = grid.scrollTop, bewaardLeft = grid.scrollLeft;
  grid.className = isDesktopTijdlijnWeek ? 'week-grid tl-mode' : 'week-grid';
  grid.innerHTML = '';
  if (isDesktopTijdlijnWeek) kalPasGridHoogteAan(); else { grid.style.height = ''; _kalAutoScrollKey = null; }

  // Post-launch feedback (2026-08-17): de uren staan vóór maandag in een eigen smalle kolom (zie
  // renderTimelineGutter()) i.p.v. IN de eerste dag-kolom -- zo hebben alle dag-kolommen exact
  // dezelfde afmetingen. Enkel relevant in de desktop-tijdlijn-weergave.
  if (isDesktopTijdlijnWeek) grid.appendChild(renderTimelineGutter());

  for (const day of dagen) {
    const dateStr       = localISO(day);
    const isToday       = day.getTime() === today.getTime();
    const isPast        = day.getTime() < today.getTime();
    const holidayName    = afh.getHolidayName(dateStr);
    const isDayBlocked   = !!holidayName || blokkeringenVoor(toestand.get('avExceptions'), dateStr, toestand.get('activeAssigneeFilter'), 'fullday').length > 0;
    const dayStops      = planItemsVanTechnieker(toestand.get('planning')[dateStr], toestand.get('activeAssigneeFilter'));
    const dayBlockCount = blokkeringenVoor(toestand.get('avExceptions'), dateStr, toestand.get('activeAssigneeFilter')).length;
    const travelEst     = 30; // conservatief voor capaciteitsweergave
    const cap           = capacityForDay(dateStr, travelEst);
    const { label: capLabel, vol: capFull } = capaciteitsKop({ aantal: dayStops.length, cap, duurMinuten: toestand.get('settings').duurMinuten, travelMin: travelEst });

    const col = document.createElement('div');
    col.className = 'day-col';
    col.dataset.date = dateStr;
    col.innerHTML = `
      <div class="day-hdr">
        <div class="day-hdr-top">
          <div class="day-hdr-name ${isToday ? 'today' : isPast ? 'past' : ''}">${day.toLocaleDateString('nl-BE', { weekday:'short' })}</div>
          <div class="day-hdr-num${isToday ? ' today' : ''}">${day.getDate()}</div>
        </div>
        <div class="day-cap coord-only ${capFull ? 'full' : ''}">${holidayName ? `🎌 ${holidayName}` : isDayBlocked ? '🔒 Geblokkeerd' : capLabel}</div>
        <button class="day-block-btn coord-only ${holidayName ? 'holiday' : isDayBlocked ? 'blocked' : ''}" data-actie="kal-blok" data-date="${dateStr}">
          ${holidayName ? `🎌 ${holidayName}` : isDayBlocked ? '🔓 Blokkade beheren' : dayBlockCount > 0 ? `⏱ ${dayBlockCount} uitzondering${dayBlockCount > 1 ? 'en' : ''}` : '⏱ Beschikbaar'}
        </button>
      </div>
      <div class="day-body${holidayName ? ' holiday-day' : isDayBlocked ? ' blocked-day' : ''}" id="daybody-${dateStr}">
        ${dayStops.length === 0 ? '<div class="day-empty">—</div>' : ''}
      </div>`;

    // Lokale afspraken (import / manueel)
    const dayEvents = eigenAfsprakenVoor(toestand.get('localEvents'), dateStr, toestand.get('activeAssigneeFilter'));

    // Afgeronde tickets met een rapport (blijven zichtbaar ook nadat Zoho ze sluit/verwijdert).
    // Uitgesloten als het ticket toevallig nog live in dayStops staat (rapport al gemaakt,
    // ticket in Zoho nog niet gesloten) — anders zie je hetzelfde ticket dubbel.
    const dayReports = afh.rapportArchief().filter(r =>
      r.datum === dateStr &&
      (toestand.get('activeAssigneeFilter') === 'all' || afh.matchRespToPerson(r.technieker, [toestand.get('activeAssigneeFilter')]) === toestand.get('activeAssigneeFilter')) &&
      !dayStops.some(s => s.ticket.id === r.ticketId) &&
      !dayEvents.some(e => e.id === r.ticketId)
    );

    const dayBodyEl = col.querySelector('.day-body');
    const isDesktopTijdlijn = window.apparaat.indeling !== 'smal';
    if (isDesktopTijdlijn) {
      dayBodyEl.appendChild(renderDayTimeline(dateStr, dayStops, dayEvents, dayReports, col.querySelector('.day-hdr')));
    } else {
      // Bestaande gestapelde-kaartjeslijst-logica — VOLLEDIG ONGEWIJZIGD.
      const timeline = [
        ...dayStops.map(stop => ({ kind: 'ticket', sortKey: stop.uur || '99:99', stop })),
        ...dayEvents.map(ev   => ({ kind: 'event',  sortKey: ev.uur   || '99:99', ev })),
        ...dayReports.map(r    => ({ kind: 'report', sortKey: r.rapportData?.start || '99:99', report: r })),
      ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

      timeline.forEach(item => {
        const card = item.kind === 'ticket' ? buildTicketCard(item.stop, dateStr)
          : item.kind === 'event' ? buildLocalEventCard(item.ev)
          : buildReportCard(item.report);
        card.dataset.sortkey = item.sortKey;
        // Badge "buiten werkuren" (enkel gsm-lijst; op de tijdlijn tonen de donkere banden dit al)
        if (item.kind !== 'report' && isBuitenWerkuren(item.sortKey)) {
          const badge = document.createElement('span');
          badge.className = 'badge-buitenuren';
          badge.textContent = 'buiten werkuren';
          const anker = card.querySelector('.cal-badge, .cal-local-type');
          if (anker) anker.after(badge); else card.prepend(badge);
        }
        dayBodyEl.appendChild(card);
      });
    }

    // "—" placeholder verwijderen als er nu events of afgeronde rapporten zijn
    if (dayStops.length === 0 && (dayEvents.length > 0 || dayReports.length > 0)) {
      const empty = col.querySelector('.day-empty');
      if (empty) empty.remove();
    }

    // Route knop als er stops zijn — bovenaan de kolom, vaste grootte (geen flex-grow,
    // anders vult hij in .day-body (een verticale flex-kolom) alle overblijvende hoogte
    // op — dat is exact de bug die dit oploste).
    if (dayStops.length > 0 || dayEvents.some(e => e.adres || e.notitie)) {
      const rb = document.createElement('button');
      rb.className = 'cal-btn coord-only';
      rb.style.cssText = 'flex:none;width:100%;margin-bottom:4px;background:var(--accent-dim);border:1px solid rgba(245,158,11,0.2);color:var(--accent-ink);padding:4px;border-radius:4px;cursor:pointer;font-size:0.7rem;font-weight:600;font-family:inherit;';
      rb.textContent = 'Route berekenen';
      rb.onclick = () => {
        document.getElementById('plan-date').value = dateStr;
        afh.setTab('planning');
        renderRouteList(dateStr);
      };
      dayBodyEl.prepend(rb);
    }

    grid.appendChild(col);
  }

  if (isDesktopTijdlijnWeek) {
    // De gutter's .day-hdr is een lege spacer (enkel om de tl-gutter-wrap eronder verticaal uit
    // te lijnen met de echte dag-kolommen se tl-wrap) -- inhoudsloos heeft hij een andere hoogte
    // dan een echte .day-hdr (die weekdag/datum/capaciteit/blokkeer-knop toont). Hoogte hier
    // expliciet gelijkzetten aan een echte kolom i.p.v. de opbouw te dupliceren, zodat dit ook
    // correct blijft als de inhoud van .day-hdr ooit verandert.
    // Alle koppen (incl. de gutter-spacer) krijgen de hoogte van de HOOGSTE kop (chips "zonder uur").
    const hdrs = Array.from(grid.querySelectorAll('.day-col .day-hdr'));
    const maxHdr = Math.max(...hdrs.map(h => h.offsetHeight));
    hdrs.forEach(h => { h.style.boxSizing = 'border-box'; h.style.minHeight = `${maxHdr}px`; });

    // Post-launch feedback (2026-08-17): vóór de tijdlijn zelf staat per dag soms een "—"
    // leeg-placeholder (geen stops) of de "Route berekenen"-knop (wel stops) -- verschillend qua
    // hoogte, dus startten de uur-lijnen van elke kolom vroeger op een ANDERE hoogte, ook al leek
    // dat door de gedeelde uren-gutter hierboven niet meer zo. I.p.v. deze twee gevallen apart
    // hard te coderen: gewoon meten hoeveel ruimte elke kolom vóór zijn tijdlijn inneemt, en de
    // kortste kolommen (incl. de gutter zelf) met een marge naar beneden duwen tot ze allemaal
    // op dezelfde hoogte beginnen als de kolom die het meeste ruimte nodig had.
    const wraps = Array.from(grid.querySelectorAll('.tl-wrap, .tl-gutter-wrap'));
    const offsets = wraps.map(w => {
      const body = w.closest('.day-body');
      return w.getBoundingClientRect().top - body.getBoundingClientRect().top;
    });
    const maxOffset = Math.max(...offsets);
    wraps.forEach((w, i) => {
      const delta = maxOffset - offsets[i];
      if (delta > 0) w.style.marginTop = `${delta}px`;
    });

    // Alle dag-kolommen (en de gutter) even hoog: align-items:flex-start geeft ze inhoudshoogte
    // (nodig voor de sticky kop), dus kolommen met minder inhoud zouden vroeg eindigen.
    const cols = Array.from(grid.querySelectorAll('.day-col'));
    const maxH = Math.max(...cols.map(c => c.offsetHeight));
    cols.forEach(c => { c.style.minHeight = `${maxH}px`; });
  }

  // Rode nu-lijn (fase 2): na elke render herplaatsen; één gedeelde minuut-timer
  // (drijft ook de nu-markering in de gsm-lijst).
  updateNuLijn();
  startNuLijnTimer();
  if (isDesktopTijdlijnWeek) {
    // Scrollpositie terugzetten, tenzij de week/weergave gewisseld is (dan scrolt kalAutoScroll)
    grid.scrollTop = bewaardTop; grid.scrollLeft = bewaardLeft;
    kalAutoScroll(false);
  }
}

// Automatisch naar de werkdag scrollen: enkel bij wissel van week/weergave (sleutel) of force.
function kalAutoScroll(force) {
  const grid = document.getElementById('week-grid');
  if (!grid || !grid.classList.contains('tl-mode')) return;
  const today = new Date(); today.setHours(0,0,0,0);
  let weekStart = getWeekStart(today, kalOffset);
  let weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
  if (window.apparaat.indeling === 'tablet-staand') {
    const dagen = kalZichtbareDagen(today);
    if (dagen.length) {
      weekStart = dagen[0];
      weekEnd = new Date(dagen[dagen.length - 1]); weekEnd.setDate(weekEnd.getDate() + 1);
    }
  }
  const key = autoScrollSleutel(weekStart, kalView);
  if (!force && key === _kalAutoScrollKey) return;
  _kalAutoScrollKey = key;
  const nu = new Date();
  const heeftVandaag = nu >= weekStart && nu < weekEnd;
  const doelMin = heeftVandaag ? Math.max(0, nu.getHours() * 60 + nu.getMinutes() - 60) : 8 * 60;
  const wrap = grid.querySelector('.tl-wrap');
  const hdr = grid.querySelector('.day-hdr');
  if (!wrap) return;
  const gridTop = grid.getBoundingClientRect().top;
  const wrapOffset = wrap.getBoundingClientRect().top - gridTop + grid.scrollTop;
  const hdrH = hdr ? hdr.offsetHeight : 0;
  grid.scrollTop = Math.max(0, wrapOffset + doelMin * TIMELINE_PX_PER_MIN - hdrH);
}

function kalNav(dir) {
  // Tablet rechtop + weekweergave: ‹ › schuiven 1 werkdag; maandweergave blijft per maand (kalOffset)
  if (window.apparaat.indeling === 'tablet-staand' && kalView !== 'month') kalDagOffset += dir; else kalOffset += dir;
  renderKalender(); kalAutoScroll(true);
}
function kalToday() {
  const dagModus = window.apparaat.indeling === 'tablet-staand' && kalView !== 'month';
  if (dagModus ? kalDagOffset === 0 : kalOffset === 0) { kalAutoScroll(true); return; }
  if (dagModus) kalDagOffset = 0; else kalOffset = 0;
  renderKalender();
  kalAutoScroll(true);
}

function renderMonthView(today) {
  // Maand bepalen via kalOffset (aantal maanden tov vandaag)
  const ref = new Date(today.getFullYear(), today.getMonth() + kalOffset, 1);
  const maandLabel = ref.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  kalZetLabel(maandLabel.charAt(0).toUpperCase() + maandLabel.slice(1));

  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';

  // Dag-headers (ma–zo)
  const dagNamen = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
  dagNamen.forEach(d => {
    const hdr = document.createElement('div');
    hdr.className = 'month-dow-hdr';
    hdr.textContent = d;
    grid.appendChild(hdr);
  });

  // Maandraster (42 datums vanaf de maandag van de week die de 1e bevat): schermen/kalender-logica.js
  const raster = maandRaster(ref);

  const MAX_CHIPS = 4;

  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const day = raster[row * 7 + col];

      const dateStr      = localISO(day);
      const isThisMonth  = day.getMonth() === ref.getMonth();
      const isToday      = day.getTime() === today.getTime();
      const isPast       = day < today;

      const cell = document.createElement('div');
      cell.className = `month-cell${!isThisMonth ? ' other-month' : ''}${isToday ? ' today-cell' : ''}`;

      const numDiv = document.createElement('div');
      numDiv.className = 'month-cell-num' + (isToday ? ' today-num' : '');
      numDiv.textContent = day.getDate();
      cell.appendChild(numDiv);

      // Chips verzamelen
      let chips = [];

      // Feestdag?
      const holidayName = afh.getHolidayName(dateStr);
      if (holidayName) chips.push({ label: `🎌 ${holidayName}`, cls: 'holiday' });

      // Blokkering?
      const isBlocked = blokkeringenVoor(toestand.get('avExceptions'), dateStr, toestand.get('activeAssigneeFilter'), 'fullday').length > 0;
      if (isBlocked) chips.push({ label: '🔒 Geblokkeerd', cls: 'blocked' });

      // Zoho tickets
      const dayStops = planItemsVanTechnieker(toestand.get('planning')[dateStr], toestand.get('activeAssigneeFilter'));
      dayStops.forEach(s => {
        const isPend = s.ticket.status === 'Wachten op bevestiging planning';
        // Tijdslot-prefix (Task 9, Blok 1C): geeft in de maandweergave meteen een indicatie van
        // het (klant-zichtbare) tijdslot zonder de cel te hoeven openen. Enkel toegevoegd als de
        // stop een uur heeft; geen wijziging aan de onderliggende exacte tijd.
        const lbl = afh.tijdslotLabelVoor(s, dateStr);
        const winLabel = lbl ? lbl + ' · ' : '';
        chips.push({ label: `${winLabel}#${s.ticket.number} ${s.ticket.subject || ''}`.trim(), cls: isPend ? 'pending' : 'confirmed' });
      });

      // Lokale afspraken
      const dayEvents = eigenAfsprakenVoor(toestand.get('localEvents'), dateStr, toestand.get('activeAssigneeFilter'));
      dayEvents.forEach(ev => {
        const tijdPfx = ev.uur ? ev.uur + ' ' : '';
        chips.push({ label: tijdPfx + ev.titel, cls: 'local' });
      });

      // Render chips (max MAX_CHIPS, rest als +N)
      const visible = chips.slice(0, MAX_CHIPS);
      const rest    = chips.length - visible.length;
      visible.forEach(c => {
        const chip = document.createElement('div');
        chip.className = `month-chip ${c.cls}`;
        chip.textContent = c.label;
        chip.title = c.label;
        cell.appendChild(chip);
      });
      if (rest > 0) {
        const more = document.createElement('div');
        more.className = 'month-more';
        more.textContent = `+${rest} meer`;
        cell.appendChild(more);
      }

      grid.appendChild(cell);
    }
  }
}

// ── Pending-panel toggle ─────────────────────────────────────────────────────
function togglePendingPanel() {
  const open = document.getElementById('kal-no-date-section').classList.toggle('open');
  document.getElementById('kal-pending-pill')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}
