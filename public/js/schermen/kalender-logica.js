// schermen/kalender-logica.js — pure logica van de kalender: tijdlijnindeling, zichtbare dagen, maandraster,
// scrollsleutel. Geen DOM, geen toestand, geen brein-aanroepen (aantalmodel, spec C3).
import { getWeekStart, localISO } from '../kern/tijd.js';

export const TIMELINE_PX_PER_MIN = 1.3;
// Post-launch feedback (2026-08-17): 26px liet de tickettekst (nummer/tijd/onderwerp/adres)
// afkappen zodra de blokhoogte (duur × TIMELINE_PX_PER_MIN) korter was dan de kaart zelf nodig
// heeft (~150px gemeten zonder de bel-/navigeerknoppen, die enkel op mobiel getoond worden — zie
// buildTicketCard()'s showActions) -- deze vloer garandeert dat elk blok, ongeacht duur, minstens
// de volledige kaart toont.
export const TIMELINE_MIN_BLOCK_PX = 155;

// Werkuren (fase 2 v1.7.0): de tijdlijn toont het volledige etmaal; buiten deze uren komt een
// donkere band. Start vóór 08:30 of op/na 17:00 = "buiten werkuren".
export const WERKUUR_START = 8 * 60 + 30;
export const WERKUUR_EIND  = 17 * 60;
export function isBuitenWerkuren(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return false;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min < WERKUUR_START || min >= WERKUUR_EIND;
}

export function timelineTopHeight(startMin, endMin, dagStartMin, totalHeight) {
  endMin = Math.min(endMin, 1440);
  let top = Math.max(0, (startMin - dagStartMin) * TIMELINE_PX_PER_MIN);
  const height = Math.max(TIMELINE_MIN_BLOCK_PX, (endMin - startMin) * TIMELINE_PX_PER_MIN);
  // Een laat blok (bv. 23:30) moet volledig zichtbaar blijven binnen de tijdlijn.
  if (totalHeight != null && top + height > totalHeight) top = Math.max(0, totalHeight - height);
  return { top, height };
}

// Laan-toewijzing voor blokken die elkaar overlappen (tickets, lokale afspraken en rapporten samen).
// Algoritme: verbonden-componenten (twee blokken die -al dan niet via een tussenliggend blok-
// overlappen delen dezelfde "cluster" en dus dezelfde laan-breedte), binnen elke cluster een
// gulzige laan-toewijzing (eerste vrije laan wiens laatste blok al afgelopen is vóór dit blok
// begint). Klein aantal items per dag in de praktijk, dus een simpele O(n²)-aanpak volstaat.
// Zet `lane` en `laneCount` op elk item (muteert) en geeft de items terug.
export function bepaalLanes(items) {
  const n = items.length;
  // v1.10.1: overlap bepalen op de ZICHTBARE hoogte van het blok, niet op de werkelijke duur. Een
  // kort blok (bv. afgerond rapport 13:17–13:53) wordt minstens TIMELINE_MIN_BLOCK_PX hoog getekend
  // (~2 u) en liep zo visueel over een blok om 14:23 heen, terwijl de laan-toewijzing ze als
  // niet-overlappend zag.
  const minDuurMin = TIMELINE_MIN_BLOCK_PX / TIMELINE_PX_PER_MIN;
  const visEnd = it => Math.max(it.endMin, it.startMin + minDuurMin);
  const parent = items.map((_, i) => i);
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (items[i].startMin < visEnd(items[j]) && items[j].startMin < visEnd(items[i])) union(i, j);
    }
  }
  const clusters = new Map(); // root -> array van item-indices
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(i);
  }
  clusters.forEach(idxs => {
    idxs.sort((a, b) => items[a].startMin - items[b].startMin);
    const laneEnds = []; // laneEnds[lane] = endMin van het laatst toegewezen item in die laan
    idxs.forEach(i => {
      let lane = laneEnds.findIndex(end => end <= items[i].startMin);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(visEnd(items[i])); }
      else laneEnds[lane] = visEnd(items[i]);
      items[i].lane = lane;
    });
    const laneCount = laneEnds.length;
    idxs.forEach(i => { items[i].laneCount = laneCount; });
  });
  return items;
}

// Gepositioneerde tijdlijnitems van één dag, vóór de laan-toewijzing:
// { type: 'ticket'|'event'|'report', startMin, endMin, stop|ev|report }.
// - tickets: enkel met `uur`, einde = start + duurVoor(ticket.id)
// - eigen afspraken: enkel met `uur`, einde = `einduur`, anders terugval tijdslotMinuten / 3 (1 u bij 180)
// - rapporten: enkel met rapportData.start, einde = rapportData.stop, anders start + duurMinuten
export function bouwTijdlijnItems({ dayStops, dayEvents, dayReports }, { duurVoor, tijdslotMinuten, duurMinuten }) {
  const positioned = [];
  dayStops.forEach(stop => {
    if (!stop.uur) return; // geen tijdstip toegekend — blijft ongepositioneerd
    const [h, m] = stop.uur.split(':').map(Number);
    const startMin = h * 60 + m;
    const endMin = startMin + duurVoor(stop.ticket.id);
    positioned.push({ type: 'ticket', startMin, endMin, stop });
  });
  dayEvents.forEach(ev => {
    if (!ev.uur) return;
    const [h, m] = ev.uur.split(':').map(Number);
    const startMin = h * 60 + m;
    let endMin = startMin + (tijdslotMinuten || 180) / 3; // fallback: 1u als geen einduur
    if (ev.einduur) {
      const [eh, em] = ev.einduur.split(':').map(Number);
      endMin = eh * 60 + em;
    }
    positioned.push({ type: 'event', startMin, endMin, ev });
  });
  // Afgeronde rapporten met een gekende werkelijke start-/stoptijd staan op hun eigen plaats op de tijdlijn.
  dayReports.filter(r => r.rapportData?.start).forEach(r => {
    const rd = r.rapportData;
    const [h, m] = rd.start.split(':').map(Number);
    const startMin = h * 60 + m;
    let endMin = startMin + duurMinuten;
    if (rd.stop) {
      const [eh, em] = rd.stop.split(':').map(Number);
      endMin = eh * 60 + em;
    }
    positioned.push({ type: 'report', startMin, endMin, report: r });
  });
  return positioned;
}

// Zichtbare dagen (Date[]) van de weekweergave: gewoon de werkdagen van de week (weekOffset), behalve op een
// tablet rechtop: dan 3 opeenvolgende werkdagen vanaf vandaag, verschoven met dagOffset werkdagen.
export function zichtbareDagen(today, { werkdagen, tabletStaand, weekOffset, dagOffset }) {
  const wd = werkdagen || [];
  const dagen = [];
  if (tabletStaand && wd.length) {
    const d = new Date(today);
    const volgende = (stap) => { do { d.setDate(d.getDate() + stap); } while (!wd.includes(d.getDay())); };
    if (!wd.includes(d.getDay())) volgende(1);          // vandaag geen werkdag: eerstvolgende werkdag
    for (let n = Math.abs(dagOffset); n > 0; n--) volgende(dagOffset > 0 ? 1 : -1);
    for (let n = 0; n < 3; n++) { dagen.push(new Date(d)); if (n < 2) volgende(1); }
    return dagen;
  }
  const weekStart = getWeekStart(today, weekOffset);
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart); day.setDate(weekStart.getDate() + i);
    if (wd.includes(day.getDay())) dagen.push(day);
  }
  return dagen;
}

// Maandraster: 42 datums (6 rijen van ma–zo) vanaf de maandag van de week die de 1e van de maand van `ref` bevat.
export function maandRaster(ref) {
  const firstOfMonth = new Date(ref.getFullYear(), ref.getMonth(), 1);
  // getDay() → 0=zo,1=ma; pas aan naar ma=0
  const startDow = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - startDow);
  const dagen = [];
  for (let i = 0; i < 42; i++) {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    day.setHours(0,0,0,0);
    dagen.push(day);
  }
  return dagen;
}

// Sleutel waarmee de automatische scroll weet dat week of weergave gewisseld is.
export function autoScrollSleutel(weekStart, weergave) {
  return `${localISO(weekStart)}|${weergave}`;
}
