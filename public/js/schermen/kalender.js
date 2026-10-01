// schermen/kalender.js — de Kalender-tab (etappe 4, deel 1): kaartjes, tijdlijn, nu-lijn en hoogte.
// De code is letterlijk uit index.html verhuisd. De pure indeling (lanen, tijdlijnitems, constanten) staat in
// `kalender-logica.js`; gegevens komen uit `kern/toestand`, de afhankelijkheden van andere schermen via
// `initKalender(afh)` (aan het begin van DOMContentLoaded, vóór koppelRenders). Raakt `document`/`window` enkel
// binnen functies, nooit op moduleniveau; de hoogste-niveau-effecten (observer, resize, visibilitychange) draaien
// in `initKalender`. Alleen `kern/brug.js` wijst `window`-namen toe. `renderKalender`, de maandweergave, de
// state en de navigatie volgen in deel 2 en staan nog in index.html.
import { toestand } from '../kern/toestand.js';
import { escHtml, registreerActies, maakActiveerbaar } from '../kern/ui.js';
import { localISO } from '../kern/tijd.js';
import { blokkeringenVoor } from '../kern/selecties.js';
import {
  TIMELINE_PX_PER_MIN, WERKUUR_START, WERKUUR_EIND, isBuitenWerkuren, timelineTopHeight,
  bepaalLanes, bouwTijdlijnItems, zichtbareDagen, maandRaster,
} from './kalender-logica.js';

// Voor de klassieke renderKalender zolang die in index.html staat.
export { isBuitenWerkuren, TIMELINE_PX_PER_MIN, zichtbareDagen, maandRaster };

// Afhankelijkheden uit het klassieke script (ingevuld door initKalender); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('kalender: initKalender() is niet aangeroepen'); } });

let _kalRO = null, _kalROFrame = 0;
let _kalResizeTimer = null;
let _nuLijnTimer = null;

export function initKalender(afhankelijkheden) {
  afh = afhankelijkheden;
  // Het kruisje (uit planning halen) op de ticketkaart via data-actie-delegatie (de kaartluisteraar slaat zulke klikken over, C8).
  registreerActies(document.body, { 'kal-uitplannen': el => afh.bevestigUitplannen(el.dataset.ticketId, el.dataset.datum) });
  kalStartHoogteObserver();
  window.addEventListener('resize', () => {
    clearTimeout(_kalResizeTimer);
    _kalResizeTimer = setTimeout(kalPasGridHoogteAan, 100);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateNuLijn(); });
}

export function buildTicketCard(stop, dateStr, { showActions = true } = {}) {
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

export function buildReportCard(entry) {
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

export function buildLocalEventCard(ev, { showActions = true } = {}) {
  const card = document.createElement('div');
  card.className = 'cal-local-event';
  const tijdLabel = ev.uur ? `${ev.uur}${ev.einduur ? '–' + ev.einduur : ''}` : '';
  const adresLabel = ev.adres || ev.notitie;
  card.innerHTML = `
    <button class="cal-local-del" title="Verwijderen" aria-label="Afspraak verwijderen">✕</button>
    <span class="cal-local-type">${escHtml(ev.type)}</span>
    <div class="cal-sub" style="margin-top:2px">${escHtml(ev.titel)}</div>
    ${tijdLabel ? `<div class="cal-local-time">⏱ ${tijdLabel}</div>` : ''}
    ${adresLabel ? `<div class="cal-addr">${escHtml(adresLabel)}</div>` : ''}
    ${ev.persoon ? `<div class="cal-meta">${escHtml(ev.persoon)}</div>` : ''}
    ${showActions ? `<div class="cal-actions">
      ${/\d/.test(afh.telNummer(ev.telefoon)) ? `<a class="cal-btn cal-ev-call" href="tel:${escHtml(afh.telNummer(ev.telefoon))}">📞 Bellen</a>` : ''}
      ${adresLabel ? `<button class="cal-btn cal-ev-nav">🧭 Navigeer</button>` : ''}
    </div>` : ''}`;
  // ev.id komt uit de afspraken-blob (niet-geauthenticeerd) — via closure doorgeven i.p.v.
  // inline onclick, want een inline JS-string is niet veilig tegen apostrofs in de brondata.
  card.querySelector('.cal-local-del')?.addEventListener('click', e => { e.stopPropagation(); afh.removeLocalEvent(ev.id); });
  card.querySelector('.cal-ev-call')?.addEventListener('click', e => e.stopPropagation());
  card.querySelector('.cal-ev-nav')?.addEventListener('click', e => { e.stopPropagation(); afh.navigate(encodeURIComponent(adresLabel)); });
  // Bubbel-guard (C8): een klik op een data-actie-knop opent het detail niet (deze kaart heeft er geen; vangnet).
  card.addEventListener('click', e => { if (e.target.closest('[data-actie]')) return; afh.openLocalEventDetail(ev); });
  return card;
}

// Post-launch feedback (2026-08-17): gedeeld door renderDayTimeline() (elke dag-kolom) EN
// renderTimelineGutter() (de uren-kolom vóór maandag) -- beide MOETEN exact dezelfde
// dagStartMin/dagEindMin/totalHeight gebruiken, anders lopen de uur-lijnen in de dag-kolommen niet
// meer gelijk met de uur-labels in de gutter. Fase 2 (v1.7.0): vast 00:00-24:00 (het volledige
// etmaal), zodat ook vroege/late afspraken zichtbaar zijn; de werkuren-instelling speelt geen rol meer.
export function computeTimelineRange() {
  const dagStartMin = 0;
  const dagEindMin = 1440;
  const displayStartH = 0;
  const displayEndH = 24;
  const totalHeight = (dagEindMin - dagStartMin) * TIMELINE_PX_PER_MIN;
  return { dagStartMin, dagEindMin, displayStartH, displayEndH, totalHeight };
}

// Twee achtergrondbanden (00:00-werkuurstart en werkuureinde-24:00); eerste kinderen van de wrap.
export function appendOffhoursBands(wrap, dagStartMin, totalHeight) {
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
export function renderTimelineGutter() {
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
export function renderDayTimeline(dateStr, dayStops, dayEvents, dayReports, hdrEl) {
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
export function kalPasGridHoogteAan() {
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
export function updateNuLijn() {
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
export function startNuLijnTimer() {
  if (!_nuLijnTimer) _nuLijnTimer = setInterval(updateNuLijn, 60000);
}
