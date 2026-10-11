// schermen/ingepland.js — de Ingepland-tab (etappe 4): geplande tickets per week, met week-navigatie.
// De code is letterlijk uit index.html verhuisd. De getoonde week volgt de gedeelde `gekozenDatum`; gegevens komen uit
// `kern/toestand`, de afhankelijkheden van andere schermen via `initIngepland(afh)` (aan het begin van
// DOMContentLoaded). Raakt `document` enkel binnen functies, nooit op moduleniveau. Alleen `kern/brug.js` wijst
// `window`-namen toe.
import { toestand } from '../kern/toestand.js';
import { escHtml, registreerActies, maakActiveerbaar, strengeAfh } from '../kern/ui.js';
import { localISO, getWeekStart, fmtDateShort, verschuifDatum } from '../kern/tijd.js';
import { ticketsVanTechnieker } from '../kern/selecties.js';

// Afhankelijkheden uit app.js (ingevuld door initIngepland); een vergeten init faalt luid.
let afh = new Proxy({}, { get() { throw new Error('ingepland: initIngepland() is niet aangeroepen'); } });

let renderTeller = 0; // e2e telt hertekeningen hiermee, ook interne oproepen

// Aantal keren dat renderGepland() draaide (voor e2e/kern.spec.mjs).
export function renderTelling() { return renderTeller; }

export function initIngepland(afhankelijkheden) {
  afh = strengeAfh('ingepland', afhankelijkheden);
  // De week-knoppen via data-actie-delegatie.
  registreerActies(document.body, {
    'gep-nav': (el, e, arg) => gepNav(Number(arg)),
    'gep-spring': (el, e, arg) => { if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) toestand.set('gekozenDatum', arg); },
  });
}

// Brent-verzoek (proefperiode): Ingepland toont dezelfde week als de Kalender en de Route-tab (gedeelde `gekozenDatum`); ‹ › = één week.
function gepNav(dir) { toestand.set('gekozenDatum', verschuifDatum(toestand.get('gekozenDatum'), { dagen: 7 * dir })); }

export function renderGepland() {
  renderTeller++;
  afh.sjLog('renderGepland'); // TIJDELIJK scrollsprong-verklikker (v1.8.0) — verwijderen na analyse
  const today     = new Date(); today.setHours(0,0,0,0);
  const [gy, gm, gd] = toestand.get('gekozenDatum').split('-').map(Number);
  const weekStart = getWeekStart(new Date(gy, gm - 1, gd), 0);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
  document.getElementById('gep-label').textContent = fmtDateShort(weekStart) + ' – ' + fmtDateShort(weekEnd);

  const allGepland = toestand.get('allGepland');
  const activeAssigneeFilter = toestand.get('activeAssigneeFilter');
  const planning = toestand.get('planning');

  const body   = document.getElementById('gep-body');
  body.innerHTML = '';
  const byDate = {};
  ticketsVanTechnieker(allGepland, activeAssigneeFilter)
    .forEach(t => {
      const key = t.interventieDatum ? localISO(new Date(t.interventieDatum)) : 'none';
      (byDate[key] = byDate[key] || []).push(t);
    });

  let any = false;
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart); day.setDate(weekStart.getDate() + i);
    const key = localISO(day);
    if (!byDate[key]?.length) continue;
    any = true;
    const isToday = day.getTime() === today.getTime();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<div class="cal-day-hdr ${isToday ? 'today' : ''}">${isToday ? '⬤ ' : ''}${day.toLocaleDateString('nl-BE', { weekday:'long', day:'numeric', month:'long' })}</div>`;
    byDate[key].forEach(t => {
      const card = document.createElement('div');
      card.className = 'ticket';
      card.style.cursor = 'pointer';
      const meta = [escHtml(t.account || t.naamEindklant), escHtml(t.assignee)].filter(Boolean).join(' · ');
      // Fix (UX-ronde 2026-09-22, snelle winst): tijdstip toevoegen, zelfde weergave als de
      // Kalender-tab (buildTicketCard()) en Route-tab -- gebaseerd op de planning[]-stop van dit
      // ticket op deze datum, die (i.t.t. het platte allGepland-ticket) het .uur-veld draagt.
      const stop = (planning[key] || []).find(p => p.ticket.id === t.id);
      const tijdHtml = stop?.uur
        ? `<div class="tmeta" style="font-weight:600">🕐 ${escHtml(afh.tijdslotLabelVoor(stop, key))} <span style="opacity:0.65;font-size:0.85em">(gepland ${escHtml(stop.uur)})</span></div>`
        : '';
      card.innerHTML = `<div class="t-body">
        <div class="t-top"><span class="tnum">#${escHtml(t.number)}</span><span class="stag confirmed">Ingepland</span>${t.assignee ? `<span class="atag">${escHtml(t.assignee)}</span>` : ''}</div>
        <div class="tsub">${escHtml(t.subject) || '—'}</div>
        ${tijdHtml}
        ${meta ? `<div class="tmeta">${meta}</div>` : ''}
        <div class="taddr ${t.hasAddress ? 'ok' : 'miss'}">${t.hasAddress ? escHtml(t.address) : 'Geen adres bekend'}</div>
        ${afh.contactActiesHtml(t)}
      </div>`;
      afh.koppelAdresNavigatie(card);
      // Klik op Bellen/Mailen opent niet het detail (Navigeer stopt de bubbel zelf).
      card.querySelectorAll('.contact-acties a').forEach(a => a.addEventListener('click', e => e.stopPropagation()));
      // Bubbel-guard (C8): klikken uit een data-actie-knop openen het detail niet.
      card.addEventListener('click', e => { if (e.target.closest('[data-actie]')) return; afh.openDetail(t); });
      maakActiveerbaar(card, () => afh.openDetail(t), 'Open ticket #' + t.number);
      wrapper.appendChild(card);
    });
    body.appendChild(wrapper);
  }
  // Badge toont gefilterd gepland-aantal (alle weken); een lege getoonde week legt dat uit en biedt de sprong naar de dichtstbijzijnde week met service.
  const filteredGepland = ticketsVanTechnieker(allGepland, activeAssigneeFilter);
  if (!any) {
    body.innerHTML = '<div class="empty">Geen geplande service deze week</div>';
    const datums = filteredGepland.filter(t => t.interventieDatum).map(t => localISO(new Date(t.interventieDatum))).sort();
    if (datums.length) {
      const ws = localISO(weekStart);
      const naDeze = datums.find(d => d >= ws) || datums[datums.length - 1];
      const hint = document.createElement('div');
      hint.className = 'gep-elders';
      hint.style.cssText = 'text-align:center;color:var(--muted);font-size:0.875rem;margin-top:-40px;padding-bottom:40px';
      hint.innerHTML = `${datums.length} ingepland in een andere week · <button type="button" class="btn-sec" style="padding:4px 10px;font-size:0.8rem" data-actie="gep-spring" data-arg="${escHtml(naDeze)}">Ga naar ${escHtml(fmtDateShort(new Date(`${naDeze}T12:00:00`)))}</button>`;
      body.appendChild(hint);
    }
  }
  document.getElementById('cnt-gepland').textContent = filteredGepland.length;
}
