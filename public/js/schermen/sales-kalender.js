// schermen/sales-kalender.js — de tab "Kalender" van de verkoper: week (tijdlijn of gestapelde kaartjes) en maand, met bezoeken (voorgesteld
// lichter dan bevestigd), blokken, ⚡ Plan deze week en ➕ Blok. Hergebruikt de uur-as, laan-indeling en dagkolommen van de technieker-kalender
// (kalender-logica.js, kalender.js) maar met eigen `sales-`-klassen voor alles wat de rol "sales" niet mag verbergen (geen .coord-only/.kal-actions).
// Alle leadgegevens gaan via textContent in de DOM. De gekozen dag is sales-data.gekozenDatum (gedeeld met de Route-tab).
import { localISO, getWeekStart, fmtDateShort, verschuifDatum, weekVerschil, minToTimeStr } from '../kern/tijd.js';
import { toast, maakActiveerbaar } from '../kern/ui.js';
import { getHolidayName } from '../kern/feestdagen.js';
import { TIMELINE_PX_PER_MIN, timelineTopHeight, bepaalLanes, maandRaster } from './kalender-logica.js';
import { computeTimelineRange, appendOffhoursBands, renderTimelineGutter } from './kalender.js';
import { startScherm } from './sales-schil.js';
import { salesToestand, gekozenDatum, zetGekozenDatum } from './sales-data.js';
import { schrijfbaarNu } from './sales-verkoper.js';
import { bouwKalenderItems, maandChips, weekDagen, navigatieAdres } from './sales-kalender-logica.js';
import { kaartInfo } from './sales-lijst-logica.js';
import { openBezoekActies, navigeer } from './sales-bezoek.js';
import { openBlokVenster } from './sales-blok.js';
import { plaatsLabel } from '../sales/adres.js';
import { dagLabel } from './sales-tekst.js';
import { el } from './sales-dom.js';

const STATUS_LABEL = { voorgesteld: 'Voorgesteld', bevestigd: 'Bevestigd' };
const MAX_CHIPS = 4;
const DAGNAMEN = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

// Schermtoestand (module-privé; er is één kalenderview).
let weergave = 'week'; // 'week' | 'maand'
let maandAnker = null; // oorspronkelijke dag bij opeenvolgende maandstappen (31 jan, 28 feb, 31 mrt)
let maandStapDatum = null;
let scrollSleutel = null;
let laatsteInhoud = null;
let luistert = false;

const herteken = () => { if (laatsteInhoud?.isConnected) teken(laatsteInhoud); };

// ---- navigatie ----

function stap(richting) {
  const iso = gekozenDatum();
  let nieuw;
  if (weergave === 'maand') {
    const anker = iso === maandStapDatum ? maandAnker : Number(iso.slice(8));
    nieuw = verschuifDatum(iso, { maanden: richting, ankerDag: anker });
    maandAnker = anker;
    maandStapDatum = nieuw;
  } else nieuw = verschuifDatum(iso, { dagen: 7 * richting });
  zetGekozenDatum(nieuw);
  herteken();
}

function naarVandaag() {
  zetGekozenDatum(localISO(new Date()));
  herteken();
}

function zetWeergave(w) {
  weergave = w;
  scrollSleutel = null;
  herteken();
}

// ---- kop ----

function periodeTekst() {
  const [j, m, d] = gekozenDatum().split('-').map(Number);
  const gekozen = new Date(j, m - 1, d);
  if (weergave === 'maand') {
    const t = gekozen.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const start = getWeekStart(gekozen, 0);
  const eind = new Date(start);
  eind.setDate(start.getDate() + 6);
  return `${fmtDateShort(start)} – ${fmtDateShort(eind)}`;
}

function nietVandaag() {
  const nu = new Date();
  const [j, m] = gekozenDatum().split('-').map(Number);
  if (weergave === 'maand') return j !== nu.getFullYear() || m !== nu.getMonth() + 1;
  return weekVerschil(gekozenDatum(), localISO(nu)) !== 0;
}

function maakKop(schrijfbaar) {
  const knop = (tekst, label, doe) => {
    const k = el('button', { type: 'button', class: 'kal-nav', 'aria-label': label, text: tekst });
    k.addEventListener('click', doe);
    return k;
  };
  const tekst = periodeTekst();
  const elders = nietVandaag();
  const label = el('button', { type: 'button', class: `kal-week-label${elders ? ' niet-vandaag' : ''}`, 'aria-label': elders ? `${tekst}, naar vandaag` : null },
    el('span', { class: 'kal-lbl-tekst', text: tekst }), el('span', { class: 'kal-lbl-vandaag', text: '↺ Vandaag' }));
  label.addEventListener('click', naarVandaag);
  const nav = el('div', { class: 'sales-kal-nav' }, knop('‹', 'Vorige periode', () => stap(-1)), el('div', { class: 'kal-label-wrap' }, label), knop('›', 'Volgende periode', () => stap(1)));

  const toggle = el('div', { class: 'kal-view-toggle' });
  for (const [id, naam] of [['week', 'Week'], ['maand', 'Maand']]) {
    const k = el('button', { type: 'button', class: `kal-view-btn${weergave === id ? ' active' : ''}`, 'aria-pressed': weergave === id ? 'true' : 'false', text: naam });
    k.addEventListener('click', () => zetWeergave(id));
    toggle.append(k);
  }

  const kop = el('div', { class: 'sales-kal-kop' }, nav, toggle);
  if (schrijfbaar) {
    const plan = el('button', { type: 'button', class: 'btn-autoplan', text: '⚡ Plan deze week' });
    plan.addEventListener('click', async () => {
      plan.disabled = true;
      plan.textContent = 'Bezig...';
      try { await (await import('./sales-plan.js')).planDezeWeek({ maandweergave: weergave === 'maand' }); }
      catch (e) { console.error('Plan deze week mislukt:', e); toast('✕ Plannen is mislukt. Probeer het opnieuw.'); }
      finally { plan.disabled = false; plan.textContent = '⚡ Plan deze week'; }
    });
    const blok = el('button', { type: 'button', class: 'btn-sec', text: '➕ Blok' });
    blok.addEventListener('click', () => openBlokVenster({ datum: gekozenDatum() }));
    kop.append(el('div', { class: 'sales-kal-acties' }, plan, blok));
  }
  return kop;
}

// ---- bezoeken en blokken ----

const tijdTekst = (i) => `${minToTimeStr(i.startMin)}–${minToTimeStr(i.endMin)}`;

/** Een tijdlijnblok of kaartje wordt een knop die de acties opent. */
function maakKlikbaar(node, item, naam) {
  node.dataset.id = item.id;
  const open = () => openBezoekActies(item.id);
  node.addEventListener('click', (e) => { if (e.target.closest('a, button')) return; open(); });
  maakActiveerbaar(node, open, naam);
  return node;
}

function bezoekInhoud(item, lead) {
  return [
    el('div', { class: 'sales-kal-tijd', text: tijdTekst(item) }),
    el('div', { class: 'sales-kal-naam', text: item.titel }),
    lead ? el('div', { class: 'sales-kal-plaats', text: plaatsLabel(lead) }) : null,
    el('div', { class: 'sales-kal-status', text: STATUS_LABEL[lead?.status] ?? '' }),
  ];
}

const blokTekst = (item) => `🔒 ${item.heleDag ? item.titel : `${tijdTekst(item)} ${item.titel}`}`;

function tijdlijnDag(iso, items, hoogte) {
  const { dagStartMin, displayStartH, displayEndH, totalHeight } = hoogte;
  const wrap = el('div', { class: 'tl-wrap' });
  wrap.style.height = `${totalHeight}px`;
  appendOffhoursBands(wrap, dagStartMin, totalHeight);
  for (let h = displayStartH; h <= displayEndH; h++) {
    const lijn = el('div', { class: 'tl-hour-line' });
    lijn.style.top = `${(h * 60 - dagStartMin) * TIMELINE_PX_PER_MIN}px`;
    wrap.append(lijn);
  }
  const leads = new Map(salesToestand().leads.map((l) => [l.id, l]));
  const geplaatst = bepaalLanes(items.filter((i) => !i.heleDag));
  for (const item of geplaatst) {
    const { top, height } = timelineTopHeight(item.startMin, item.endMin, dagStartMin, totalHeight);
    const blok = item.type === 'blok'
      ? el('div', { class: 'tl-block tl-blocked sales-blok' }, el('div', { text: blokTekst(item) }))
      : el('div', { class: `tl-block sales-bezoek sales-${item.tint}` }, ...bezoekInhoud(item, leads.get(item.id)));
    blok.style.top = `${top}px`;
    blok.style.height = `${height}px`;
    if (item.laneCount > 1) {
      blok.style.left = `calc(6px + (100% - 12px) * ${item.lane} / ${item.laneCount})`;
      blok.style.width = `calc((100% - 12px) / ${item.laneCount} - 2px)`;
      blok.style.right = 'auto';
    }
    wrap.append(maakKlikbaar(blok, item, `${item.titel}, ${tijdTekst(item)}`));
  }
  return wrap;
}

function kaartjesDag(items) {
  const leads = new Map(salesToestand().leads.map((l) => [l.id, l]));
  const lijst = [];
  for (const item of items) {
    if (item.type === 'blok') {
      lijst.push(maakKlikbaar(el('div', { class: 'sales-kal-kaart sales-kal-blokkaart' }, el('div', { class: 'sales-kal-naam', text: blokTekst(item) })), item, item.titel));
      continue;
    }
    const lead = leads.get(item.id);
    const kaart = el('div', { class: `sales-kal-kaart sales-${item.tint}` }, ...bezoekInhoud(item, lead));
    const info = kaartInfo(lead);
    const adres = navigatieAdres(lead);
    if (info.telHref || adres) {
      const acties = el('div', { class: 'sales-kal-kaart-acties' });
      if (info.telHref) acties.append(el('a', { class: 'btn btn--secondary', href: info.telHref, text: '📞 Bellen' }));
      if (adres) {
        const nav = el('button', { type: 'button', class: 'btn btn--secondary', text: '🧭 Navigeer' });
        nav.addEventListener('click', () => navigeer(adres));
        acties.append(nav);
      }
      kaart.append(acties);
    }
    lijst.push(maakKlikbaar(kaart, item, `${item.titel}, ${tijdTekst(item)}`));
  }
  return lijst;
}

function dagKolom(iso, { smal, hoogte, vandaag }) {
  const st = salesToestand();
  const dag = new Date(`${iso}T12:00:00`);
  const feest = getHolidayName(iso);
  const items = bouwKalenderItems({ leads: st.leads, blokken: st.blokken, datum: iso, standaardDuurMin: st.instellingen.bezoekDuurMin });
  const heleDagen = items.filter((i) => i.heleDag);
  const nota = el('div', { class: 'sales-kal-nota' });
  if (feest) nota.append(el('span', { class: 'sales-kal-feest', text: `🎌 ${feest}` }));
  if (!smal) {
    for (const b of heleDagen) {
      const k = el('button', { type: 'button', class: 'sales-kal-heledag', text: `🔒 ${b.titel}` });
      k.addEventListener('click', () => openBezoekActies(b.id));
      nota.append(k);
    }
  }
  const top = el('div', { class: 'day-hdr-top' },
    el('div', { class: `day-hdr-name${iso === vandaag ? ' today' : iso < vandaag ? ' past' : ''}`, text: dag.toLocaleDateString('nl-BE', { weekday: 'short' }) }),
    el('div', { class: `day-hdr-num${iso === vandaag ? ' today' : ''}`, text: dag.getDate() }));
  // Eén ingang voor een blok: de knop "➕ Blok" bovenaan (UI/UX P2-6); het venster vraagt de datum zelf.
  const hdr = el('div', { class: 'day-hdr' }, top, nota);
  const body = el('div', { class: `day-body${feest ? ' holiday-day' : heleDagen.length ? ' blocked-day' : ''}` });
  if (smal) {
    const kaartjes = kaartjesDag(items);
    if (kaartjes.length) body.append(...kaartjes); else body.append(el('div', { class: 'day-empty', text: '—' }));
  } else {
    body.append(tijdlijnDag(iso, items, hoogte));
  }
  const kolom = el('div', { class: 'day-col' }, hdr, body);
  kolom.dataset.date = iso;
  return kolom;
}

// ---- week ----

function weekWeergave({ smal }) {
  const st = salesToestand();
  const dagen = weekDagen({ gekozen: gekozenDatum(), werkdagen: st.instellingen.werkdagen, leads: st.leads, blokken: st.blokken });
  const hoogte = computeTimelineRange();
  const vandaag = localISO(new Date());
  const grid = el('div', { class: `week-grid sales-kal-grid${smal ? '' : ' tl-mode'}` });
  if (!smal) grid.append(renderTimelineGutter());
  for (const iso of dagen) grid.append(dagKolom(iso, { smal, hoogte, vandaag }));
  return grid;
}

// Naar de werkdag scrollen bij een wissel van week of weergave (niet bij elke hertekening: de verkoper scrolt zelf).
function scrollNaarWerkdag(grid) {
  const sleutel = `${localISO(getWeekStart(new Date(`${gekozenDatum()}T12:00:00`), 0))}|${weergave}`;
  if (sleutel === scrollSleutel || !grid.clientHeight) return;
  scrollSleutel = sleutel;
  const wrap = grid.querySelector('.tl-wrap');
  if (!wrap) return;
  const nu = new Date();
  const start = getWeekStart(new Date(`${gekozenDatum()}T12:00:00`), 0);
  const einde = new Date(start);
  einde.setDate(start.getDate() + 7);
  const doelMin = nu >= start && nu < einde ? Math.max(0, nu.getHours() * 60 + nu.getMinutes() - 60) : 8 * 60;
  const wrapTop = wrap.getBoundingClientRect().top - grid.getBoundingClientRect().top + grid.scrollTop;
  const hdr = grid.querySelector('.day-hdr');
  grid.scrollTop = Math.max(0, wrapTop + doelMin * TIMELINE_PX_PER_MIN - (hdr?.offsetHeight ?? 0));
}

// ---- maand ----

function maandWeergave() {
  const st = salesToestand();
  const [j, m] = gekozenDatum().split('-').map(Number);
  const chips = maandChips({ leads: st.leads, blokken: st.blokken, datum: gekozenDatum() });
  const vandaag = localISO(new Date());
  const grid = el('div', { class: 'month-grid sales-kal-maand' });
  for (const naam of DAGNAMEN) grid.append(el('div', { class: 'month-dow-hdr', text: naam }));
  for (const dag of maandRaster(new Date(j, m - 1, 1))) {
    const iso = localISO(dag);
    const cel = el('div', { class: `month-cell sales-kal-cel${dag.getMonth() !== m - 1 ? ' other-month' : ''}${iso === vandaag ? ' today-cell' : ''}` },
      el('div', { class: `month-cell-num${iso === vandaag ? ' today-num' : ''}`, text: dag.getDate() }));
    cel.dataset.date = iso;
    const feest = getHolidayName(iso);
    const lijst = [...(feest ? [{ label: `🎌 ${feest}`, klasse: 'holiday' }] : []), ...(chips[iso] ?? []).map((c) => ({ label: c.label, klasse: `sales-tint-${c.tint}` }))];
    for (const c of lijst.slice(0, MAX_CHIPS)) cel.append(el('div', { class: `month-chip ${c.klasse}`, title: c.label, text: c.label }));
    if (lijst.length > MAX_CHIPS) cel.append(el('div', { class: 'month-more', text: `+${lijst.length - MAX_CHIPS} meer` }));
    const open = () => { weergave = 'week'; scrollSleutel = null; zetGekozenDatum(iso); herteken(); };
    cel.addEventListener('click', open);
    maakActiveerbaar(cel, open, `Open de week van ${dagLabel(iso)}`);
    grid.append(cel);
  }
  return grid;
}

// ---- het scherm ----

function teken(inhoud) {
  laatsteInhoud = inhoud;
  if (!luistert) { luistert = true; window.addEventListener('apparaatwijziging', herteken); }
  const smal = window.apparaat?.indeling === 'smal';
  const schrijfbaar = schrijfbaarNu();
  const oud = inhoud.querySelector('.sales-kal-grid');
  const bewaard = oud ? { top: oud.scrollTop, links: oud.scrollLeft } : null;
  const wortel = el('div', { class: 'sales-kal' }, maakKop(schrijfbaar));
  const grid = weergave === 'maand' ? maandWeergave() : weekWeergave({ smal });
  wortel.append(grid);
  inhoud.replaceChildren(wortel);
  if (weergave === 'week' && !smal) {
    if (bewaard) { grid.scrollTop = bewaard.top; grid.scrollLeft = bewaard.links; }
    scrollNaarWerkdag(grid);
  }
}

export const toon = (view) => startScherm(view, teken);
