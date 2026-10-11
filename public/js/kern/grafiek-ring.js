// kern/grafiek-ring.js — ring (percentage) als inline SVG. Puur: enkel strings, geen DOM, geen I/O.
// Kleuren staan in public/css/dashboard.css (klassen .ring--goed/--aandacht/--slecht/--neutraal/--geen).
// Alle tekst uit data gaat door escHtml.
import { escHtml } from './ui.js';

// Het statusteken is een inline SVG (cirkel + vink/uitroepteken/kruis als paden), geen tekstglyph: zo staat het teken exact in het
// midden van zijn cirkel, los van het lettertype. Kleur via var(--ring-kleur) (zie .ring-icoon in dashboard.css).
export const STATUS_TEKST = {
  goed:     { icoon: 'vink', woord: 'Op doel' },
  aandacht: { icoon: 'uitroepteken', woord: 'Let op' },
  slecht:   { icoon: 'kruis', woord: 'Onder doel' },
};

const ICOON_TEKEN = {
  vink: '<path d="M7.5 12.3 L10.5 15.3 L16.5 8.7"/>',
  uitroepteken: '<path d="M12 7.2 L12 12.6"/><circle class="ring-icoon-punt" cx="12" cy="16.6" r="1.2"/>',
  kruis: '<path d="M8.5 8.5 L15.5 15.5 M15.5 8.5 L8.5 15.5"/>',
};

export function statusIcoon(naam) {
  return `<svg class="ring-icoon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/>${ICOON_TEKEN[naam] ?? ''}</svg>`;
}

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
    regels.push(`<span class="ring-status">${statusIcoon(t.icoon)} ${t.woord}</span>`);
  }
  if (!heeftWaarde(pct)) regels.push('<span class="ring-n">geen gegevens</span>');
  else if (Number.isFinite(n) && Number.isFinite(noemer)) regels.push(`<span class="ring-n">${getal.format(n)} van ${getal.format(noemer)}</span>`);
  else if (Number.isFinite(n)) regels.push(`<span class="ring-n">${getal.format(n)}</span>`);
  if (sub) regels.push(`<span class="ring-sub">${escHtml(sub)}</span>`);
  return `<figure class="ring ring--${v}">${ringSvg({ pct, status, titel })}<figcaption>${regels.join('')}</figcaption></figure>`;
}
