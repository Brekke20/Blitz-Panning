// kern/grafiek-ring.js — ring (percentage) als inline SVG. Puur: enkel strings, geen DOM, geen I/O.
// Kleuren staan in public/css/dashboard.css (klassen .ring--goed/--aandacht/--slecht/--neutraal/--geen).
// Alle tekst uit data gaat door escHtml.
import { escHtml } from './ui.js';

export const STATUS_TEKST = {
  goed:     { icoon: '✓', woord: 'Op doel' },
  aandacht: { icoon: '!', woord: 'Let op' },
  slecht:   { icoon: '✕', woord: 'Onder doel' },
};

const STATUSSEN = ['goed', 'aandacht', 'slecht', 'neutraal'];
const STRAAL = 45;
const OMTREK = 2 * Math.PI * STRAAL;
const getal = new Intl.NumberFormat('nl-BE');

const heeftWaarde = pct => typeof pct === 'number' && Number.isFinite(pct);
const begrens = pct => Math.min(100, Math.max(0, pct));

// Klassenaam van de kleurvariant: zonder waarde 'geen', anders de status (onbekend = neutraal).
function variant(pct, status) {
  if (!heeftWaarde(pct)) return 'geen';
  return STATUSSEN.includes(status) ? status : 'neutraal';
}

// -> <svg role="img" aria-label="{titel}: 87 %"> spoor + boog + percentage in het midden.
export function ringSvg({ pct, status, titel, grootte = 96 }) {
  const heeft = heeftWaarde(pct);
  const afgerond = heeft ? Math.round(begrens(pct)) : null;
  const label = `${escHtml(titel)}: ${heeft ? `${afgerond} %` : 'geen gegevens'}`;
  const lengte = heeft ? (begrens(pct) / 100) * OMTREK : 0;
  const boog = lengte > 0
    ? `<circle class="ring-boog" cx="50" cy="50" r="${STRAAL}" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${lengte.toFixed(2)} ${OMTREK.toFixed(2)}" transform="rotate(-90 50 50)"/>`
    : '';
  const g = Number.isFinite(grootte) && grootte > 0 ? grootte : 96;
  return `<svg class="ring-svg ring--${variant(pct, status)}" viewBox="0 0 100 100" width="${g}" height="${g}" role="img" aria-label="${label}">`
    + `<circle class="ring-spoor" cx="50" cy="50" r="${STRAAL}" fill="none" stroke-width="10"/>`
    + boog
    + `<text class="ring-pct" x="50" y="50" text-anchor="middle" dominant-baseline="central">${heeft ? `${afgerond}%` : '—'}</text>`
    + '</svg>';
}

// -> <figure class="ring ring--{variant}"> ring + <figcaption>: statusregel (icoon + woord, enkel bij
// goed/aandacht/slecht), "n van noemer" of "geen gegevens", en sub (bv. de verdeling te vroeg/op tijd/te laat).
export function ringFiguur({ pct, status, titel, n = null, noemer = null, sub = '' }) {
  const v = variant(pct, status);
  const regels = [];
  if (STATUS_TEKST[v]) {
    const t = STATUS_TEKST[v];
    regels.push(`<span class="ring-status"><span class="ring-icoon" aria-hidden="true">${t.icoon}</span> ${t.woord}</span>`);
  }
  if (!heeftWaarde(pct)) regels.push('<span class="ring-n">geen gegevens</span>');
  else if (Number.isFinite(n) && Number.isFinite(noemer)) regels.push(`<span class="ring-n">${getal.format(n)} van ${getal.format(noemer)}</span>`);
  else if (Number.isFinite(n)) regels.push(`<span class="ring-n">${getal.format(n)}</span>`);
  if (sub) regels.push(`<span class="ring-sub">${escHtml(sub)}</span>`);
  return `<figure class="ring ring--${v}">${ringSvg({ pct, status, titel })}<figcaption>${regels.join('')}</figcaption></figure>`;
}
