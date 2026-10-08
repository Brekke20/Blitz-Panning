// kern/grafiek-hulp.js — gedeelde, pure hulpen voor de grafiekmodules (balken, kolommen, donut, lijn).
// Enkel strings en getallen; alle tekst uit data gaat door escHtml.
import { escHtml } from './ui.js';

const getalFormaat = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 1 });

// Getal in Belgische notatie ("1.840", "12,5"); niet-eindig = 0.
export function formatGetal(n) {
  return getalFormaat.format(Number.isFinite(n) ? n : 0);
}

// Niet-eindige of negatieve waarde telt als 0 (een grafiek tekent nooit NaN of negatieve lengtes).
export function positief(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

// Afgerond getal voor SVG-attributen (2 decimalen, zonder staartnullen).
export function n2(v) {
  return String(Math.round(v * 100) / 100);
}

// Categorisch slot 1-8 -> '1'..'8'; al het andere = 'overige' (grijs).
export function slotId(slot) {
  return Number.isInteger(slot) && slot >= 1 && slot <= 8 ? String(slot) : 'overige';
}
export const slotKleur = slot => `var(--viz-${slotId(slot)})`;

// Kort een label in tot max tekens (met '…').
export function kort(tekst, max) {
  const t = String(tekst ?? '');
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1))}…`;
}

export function leegBericht(tekst = 'Geen gegevens') {
  return `<p class="grafiek-leeg">${escHtml(tekst)}</p>`;
}

// Nette assticks vanaf 0: stap 1/2/5 × 10^k, hoogstens maxIntervallen intervallen (1840 -> 0 / 1.000 / 2.000).
export function mooieTicks(max, maxIntervallen = 3) {
  if (!(max > 0) || !Number.isFinite(max)) return { ticks: [0, 1], top: 1 };
  const ruw = max / maxIntervallen;
  const macht = 10 ** Math.floor(Math.log10(ruw));
  let stap = macht;
  for (const f of [1, 2, 5, 10]) { stap = f * macht; if (stap >= ruw) break; }
  const aantal = Math.ceil(max / stap - 1e-9);
  const ticks = [];
  for (let i = 0; i <= aantal; i++) ticks.push(Number((i * stap).toFixed(10)));
  return { ticks, top: ticks[ticks.length - 1] };
}

// Legende: kleurblokje + label (+ tekst, bv. "30 (30 %)"). items: [{ label, slot, tekst? }]
export function legendeHtml(items) {
  const lis = items.map(i => `<li><span class="swatch swatch--${slotId(i.slot)}" aria-hidden="true"></span>`
    + `<span class="legende-label">${escHtml(i.label)}</span>`
    + (i.tekst !== undefined ? `<span class="legende-aantal">${escHtml(i.tekst)}</span>` : '') + '</li>').join('');
  return `<ul class="legende">${lis}</ul>`;
}

// Houdt de eerste `max` reeksen en telt de rest op in 'Overige' (grijs). Kleur volgt het slot dat de aanroeper meegeeft.
export function beperkReeksen(reeksen, max, aantalCategorieen) {
  const schoon = reeksen.map(r => ({ ...r, waarden: Array.from({ length: aantalCategorieen }, (_, i) => positief(r.waarden?.[i])) }));
  if (schoon.length <= max) return schoon;
  const rest = schoon.slice(max);
  const overige = {
    sleutel: 'overige', label: 'Overige', slot: null,
    waarden: Array.from({ length: aantalCategorieen }, (_, i) => rest.reduce((s, r) => s + r.waarden[i], 0)),
  };
  return [...schoon.slice(0, max), overige];
}

// Pad met afgeronde bovenkant (data-kant van een kolom), vierkant op de basislijn.
export function padBoven(x, y, w, h, r = 4) {
  const q = Math.min(r, w / 2, h);
  return `M${n2(x)},${n2(y + h)}V${n2(y + q)}A${n2(q)},${n2(q)} 0 0 1 ${n2(x + q)},${n2(y)}H${n2(x + w - q)}`
    + `A${n2(q)},${n2(q)} 0 0 1 ${n2(x + w)},${n2(y + q)}V${n2(y + h)}Z`;
}
// Pad met afgeronde rechterkant (data-kant van een horizontale balk), vierkant aan de basis (links).
export function padRechts(x, y, w, h, r = 4) {
  const q = Math.min(r, h / 2, w);
  return `M${n2(x)},${n2(y)}H${n2(x + w - q)}A${n2(q)},${n2(q)} 0 0 1 ${n2(x + w)},${n2(y + q)}V${n2(y + h - q)}`
    + `A${n2(q)},${n2(q)} 0 0 1 ${n2(x + w - q)},${n2(y + h)}H${n2(x)}Z`;
}
// Vierkant segment.
export function padRechthoek(x, y, w, h) {
  return `M${n2(x)},${n2(y)}H${n2(x + w)}V${n2(y + h)}H${n2(x)}Z`;
}
