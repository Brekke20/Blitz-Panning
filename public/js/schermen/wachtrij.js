// schermen/wachtrij.js — de Wachtrij-tab (etappe 4): lijst, zoeken, sorteren en snelinplannen ("+").
// De code is letterlijk uit index.html verhuisd. De zoektekst en de sorteerkeuze zijn module-privé; gegevens komen
// uit `kern/toestand`, de afhankelijkheden van andere schermen via `initWachtrij(afh)` (aan het begin van
// DOMContentLoaded). Raakt `document` enkel binnen functies, nooit op moduleniveau. Alleen `kern/brug.js` wijst
// `window`-namen toe. `quickAdd` zoekt de eerste dag met echte vrije tijd (planner-tijdlijn.js, proefperiode-bugfix).
import { toestand } from '../kern/toestand.js';
import { magPlannenVoor } from '../kern/sessie.js';
import { toast, escHtml, registreerActies, maakActiveerbaar, strengeAfh } from '../kern/ui.js';
import { localISO, todayISO, fmtDateShort } from '../kern/tijd.js';
import { ticketsVanTechnieker } from '../kern/selecties.js';
import { nextAvailableDay } from './capaciteit.js';
import { zoekWoorden, filterOpZoek, isOverdue, sorteerWachtrij } from './wachtrij-logica.js';

// Afhankelijkheden uit app.js (ingevuld door initWachtrij); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('wachtrij: initWachtrij() is niet aangeroepen'); } });

// Wachtrij zoeken en sorteren. De zoektekst wordt niet bewaard; de sorteerkeuze wel.
let wqZoek = '';
let wqSorteer = 'standaard'; // 'standaard' | 'oudst' | 'nieuwst' | 'interventie'
const WQ_SORTEER_OPTIES = ['standaard', 'oudst', 'nieuwst', 'interventie'];
let renderTeller = 0; // e2e telt hertekeningen hiermee, ook interne oproepen

// Aantal keren dat renderTickets() draaide (voor e2e/kern.spec.mjs).
export function renderTelling() { return renderTeller; }

export function initWachtrij(afhankelijkheden) {
  afh = strengeAfh('wachtrij', afhankelijkheden);
  try {
    const w = localStorage.getItem('blitz_wachtrij_sorteer');
    if (WQ_SORTEER_OPTIES.includes(w)) wqSorteer = w;
  } catch {}
  // De "+"-knop via data-actie-delegatie (de kaartluisteraar slaat zulke klikken over, C8).
  registreerActies(document.body, { 'wq-inplannen': el => quickAdd(el.dataset.ticketId) });
  // Zoekveld en sorteerkeuze: eenmalig gekoppeld; de balk zit buiten wat renderTickets herbouwt.
  const zoek = document.getElementById('wq-zoek'), sel = document.getElementById('wq-sorteer');
  if (!zoek || !sel) return;
  sel.value = wqSorteer;
  let timer = null;
  zoek.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { wqZoek = zoek.value; renderTickets(); }, 150);
  });
  sel.addEventListener('change', () => {
    wqSorteer = WQ_SORTEER_OPTIES.includes(sel.value) ? sel.value : 'standaard';
    try { localStorage.setItem('blitz_wachtrij_sorteer', wqSorteer); } catch {}
    renderTickets();
  });
}

export function renderTickets() {
  renderTeller++;
  afh.sjLog('renderTickets'); // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
  const list  = document.getElementById('ticket-list');
  const empty = document.getElementById('empty-tickets');
  [...list.querySelectorAll('.ticket')].forEach(el => el.remove());

  const filtered = ticketsVanTechnieker(toestand.get('allTickets'), toestand.get('activeAssigneeFilter'));
  const totaal = filtered.length;

  // Zoeken: alle woorden moeten voorkomen
  const woorden = zoekWoorden(wqZoek);
  const gevonden = filterOpZoek(filtered, wqZoek);

  // Teller en lege-tekst
  const teller = document.getElementById('wq-teller');
  if (teller) teller.textContent = woorden.length ? `${gevonden.length} van ${afh.meervoud(totaal, 'ticket', 'tickets')}` : afh.meervoud(totaal, 'ticket', 'tickets');
  if (woorden.length && !gevonden.length && totaal) {
    if (empty.dataset.orig === undefined) empty.dataset.orig = empty.textContent;
    empty.textContent = `Geen tickets gevonden voor '${wqZoek.trim()}'`;
  } else if (!woorden.length && !totaal) {
    // Lege wachtrij zonder zoekopdracht: de bestaande tekst uit autoPlan i.p.v. de beginwaarde 'Laden...'.
    empty.textContent = 'Geen tickets om in te plannen';
    delete empty.dataset.orig;
  } else if (empty.dataset.orig !== undefined) {
    empty.textContent = empty.dataset.orig;
    delete empty.dataset.orig;
  }
  // Badge toont het totaal (na assignee-filter, vóór zoeken)
  document.getElementById('cnt-tickets').textContent = totaal;

  if (!gevonden.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  const vandaag = todayISO();
  const gesorteerd = sorteerWachtrij(gevonden, wqSorteer, { vandaag, nu: new Date() });

  gesorteerd.forEach(t => {
    const overdue = isOverdue(t, vandaag);
    const card = document.createElement('div');
    card.className = 'ticket' + (overdue ? ' overdue' : '');
    const meta = [escHtml(t.account || t.naamEindklant), escHtml(t.regio)].filter(Boolean).join(' · ');
    const kbPrefDatum = afh.kbPreferred(t.id);
    const kbPrefUur   = afh.kbPreferredTime(t.id);
    const kbPrefLabel = kbPrefDatum
      ? `📌 ${fmtDateShort(kbPrefDatum)}${kbPrefUur ? ' ' + kbPrefUur : ''}`
      : (kbPrefUur ? `🕐 ${kbPrefUur}` : '');
    const kbPrefTitle = [kbPrefDatum ? `Voorkeursdatum klant: ${kbPrefDatum}` : '', kbPrefUur ? `Voorkeursuur klant: ${kbPrefUur}` : '']
      .filter(Boolean).join(' — ');
    card.innerHTML = `
      <div class="t-body">
        <div class="t-top">
          <span class="tnum">#${escHtml(t.number)}</span>
          ${overdue ? `<span class="stag">Verlopen</span>` : ''}
          ${t.priority ? `<span class="prtag ${escHtml((t.priority||'').toLowerCase())}">${escHtml(afh.prioLabel(t.priority))}</span>` : ''}
          ${t.assignee ? `<span class="atag">${escHtml(t.assignee)}</span>` : ''}
          ${kbPrefLabel ? `<span class="atag" title="${escHtml(kbPrefTitle)}" style="background:rgba(0,223,163,.15);color:var(--accent-ink);border:1px solid var(--accent)">${escHtml(kbPrefLabel)}</span>` : ''}
          ${(afh.kbFor(t.id)?.geblokkeerd?.length) ? `<span class="atag" title="Klant kan niet: ${afh.kbFor(t.id).geblokkeerd.join(', ')}" style="background:rgba(255,80,80,.1);color:#f55;border:1px solid #f55">🚫 ${afh.kbFor(t.id).geblokkeerd.length}</span>` : ''}
        </div>
        <div class="tsub">${escHtml(t.subject) || '—'}</div>
        ${meta ? `<div class="tmeta">${meta}</div>` : ''}
        <div class="taddr ${t.hasAddress ? 'ok' : 'miss'}">${t.hasAddress ? escHtml(t.address) : 'Geen adres bekend'}</div>
      </div>
      <div class="t-action">
        ${magPlannenVoor(t.assignee) ? `<button class="btn-add" data-actie="wq-inplannen" data-ticket-id="${escHtml(t.id)}" title="Inplannen op eerstvolgende vrije dag" aria-label="Inplannen op eerstvolgende vrije dag" ${afh.inFlight(t.id) ? 'disabled' : ''}>+</button>` : ''}
      </div>`;
    // Bubbel-guard (C8): een klik op een data-actie-knop opent het detail niet.
    card.addEventListener('click', e => { if (e.target.closest('[data-actie]')) return; afh.openDetail(t); });
    maakActiveerbaar(card, () => afh.openDetail(t), 'Open ticket #' + t.number);
    list.appendChild(card);
  });
}

export async function quickAdd(ticketId) {
  const today = localISO(new Date());
  const date  = nextAvailableDay(today, ticketId);
  if (!date) return toast('Geen beschikbare werkdag gevonden');
  if (!(await afh.addTicketToDate(ticketId, date))) return;
  toast('✓ Toegevoegd aan ' + fmtDateShort(date));
}
