// schermen/week-strook.js — de weekstrook bovenaan de Route-tab (v1.9.5): per werkdag van de gekozen week de naam, het aantal stops en een korte status,
// met ‹ › voor de vorige en volgende week. Gedeeld door de route van de technieker (route.js, #week-strip) en die van de verkoper
// (sales-route.js); de markup en de klassen (.week-strip, .ws-dag, ...) zijn gelijk, dus ook het uiterlijk (css/app.css).
// De luisteraars (klik, pijltjestoetsen) komen één keer op de strook; elke tekening ververst de toestand die ze lezen.
// Alle tekst die erin komt is eigen of een telwoord; er staat nooit gebruikersinvoer in (de verkoper toont aantallen, geen namen).
import { escHtml } from '../kern/ui.js';
import { localISO } from '../kern/tijd.js';
import { WEEKSTROOK_DAG, weekstrookDagen, weekstrookVerschuif } from './week-strook-logica.js';

/**
 * Tekent de strook in `el`.
 *  - datum: de gekozen dag ('YYYY-MM-DD'); werkdagen: getDay()-nummers; vandaag: 'YYYY-MM-DD'
 *  - dagInfo(iso, datumObject) -> { aantal: '2 stops', status: '✓ tijden', klasse: 'klaar' | 'nodig' | 'leeg', aria: '2 stops, alle tijden klaar' }
 *  - kies(iso): de gebruiker koos een dag of een andere week
 */
export function renderWeekstrook(el, { datum, werkdagen, vandaag, dagInfo, kies }) {
  if (!el || !datum) return;
  el._ws = { datum, werkdagen, kies };
  if (!el._gebonden) {
    el._gebonden = true;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ws]');
      if (!b) return;
      const { datum: nu, kies: kiesNu } = el._ws;
      if (b.dataset.ws === 'vorige') kiesNu(weekstrookVerschuif(nu, -7));
      else if (b.dataset.ws === 'volgende') kiesNu(weekstrookVerschuif(nu, 7));
      else kiesNu(b.dataset.ws);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const b = e.target.closest('button[data-ws]');
      if (!b || b.dataset.ws === 'vorige' || b.dataset.ws === 'volgende') return;
      e.preventDefault();
      const { werkdagen: dagenNu, kies: kiesNu } = el._ws;
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const { dagen } = weekstrookDagen(b.dataset.ws, dagenNu);
      const isos = dagen.map(localISO);
      const i = isos.indexOf(b.dataset.ws) + dir;
      if (i >= 0 && i < isos.length) { el._focusNaRender = true; return kiesNu(isos[i]); }
      // Week-omslag: eerste/laatste werkdag van de volgende/vorige week
      const buur = weekstrookDagen(weekstrookVerschuif(b.dataset.ws, dir * 7), dagenNu).dagen;
      if (!buur.length) return;
      el._focusNaRender = true;
      kiesNu(localISO(dir > 0 ? buur[0] : buur[buur.length - 1]));
    });
  }
  const hadFocus = el.contains(document.activeElement) || el._focusNaRender;
  el._focusNaRender = false;
  const { dagen } = weekstrookDagen(datum, werkdagen);
  const geselecteerd = dagen.some((d) => localISO(d) === datum);
  let html = '<button type="button" class="ws-nav" data-ws="vorige" aria-label="Vorige week" title="Vorige week">‹</button><div class="ws-dagen">';
  dagen.forEach((d, idx) => {
    const iso = localISO(d);
    const info = dagInfo(iso, d);
    const sel = iso === datum;
    const tab = sel || (!geselecteerd && idx === 0) ? 0 : -1;
    const naam = `${WEEKSTROOK_DAG[d.getDay()]} ${d.getDate()}`;
    html += `<button type="button" class="ws-dag ${info.klasse}${sel ? ' actief' : ''}${iso === vandaag ? ' vandaag' : ''}" data-ws="${iso}" tabindex="${tab}" aria-pressed="${sel}"${sel ? ' aria-current="date"' : ''}` +
      ` aria-label="${escHtml(`${naam}: ${info.aria}`)}">` +
      `<span class="ws-naam">${naam}</span><span class="ws-aantal">${escHtml(info.aantal)}</span><span class="ws-status">${escHtml(info.status)}</span></button>`;
  });
  html += '</div><button type="button" class="ws-nav" data-ws="volgende" aria-label="Volgende week" title="Volgende week">›</button>';
  el.innerHTML = html;
  if (hadFocus) (el.querySelector('.ws-dag.actief') || el.querySelector('.ws-dag'))?.focus();
  el.querySelector('.ws-dag.actief')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}
