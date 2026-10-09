// kern/grafiek-tabel.js — de tabelweergave bij elke grafiek (waarde nooit enkel als kleur of vorm).
import { escHtml } from './ui.js';
import { formatGetal } from './grafiek-hulp.js';

function cel(c, rij0) {
  if (typeof c === 'number') return `<td class="num">${formatGetal(c)}</td>`;
  if (c === null || c === undefined || c === '') return '<td class="num">—</td>';
  return rij0 ? `<th scope="row">${escHtml(c)}</th>` : `<td>${escHtml(c)}</td>`;
}

// kolommen: [string]; rijen: [[cel…]] (getal = rechts uitgelijnd met tabular-nums, tekst ge-escaped).
export function grafiekTabel({ kolommen, rijen, titel, open = false }) {
  const getalKolom = i => i > 0 && (rijen ?? []).some(r => typeof r[i] === 'number');
  const kop = (kolommen ?? []).map((k, i) => `<th scope="col"${getalKolom(i) ? ' class="num"' : ''}>${escHtml(k)}</th>`).join('');
  const body = (rijen ?? []).map(r => `<tr>${r.map((c, i) => cel(c, i === 0)).join('')}</tr>`).join('');
  return `<details class="tabel-twin"${open ? ' open' : ''}><summary>Tabel</summary><table aria-label="${escHtml(titel)}">`
    + `<caption>${escHtml(titel)}</caption><thead><tr>${kop}</tr></thead><tbody>${body}</tbody></table></details>`;
}
