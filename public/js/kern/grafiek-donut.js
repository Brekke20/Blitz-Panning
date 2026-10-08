// kern/grafiek-donut.js — ringdiagram (donut) als inline SVG, met verplichte legende en tabel-twin.
// Puur (strings). Segmentvolgorde = invoervolgorde (nooit op grootte herschikt); kleur = categorisch slot van de aanroeper.
// Geometrie zoals de ring: diameter 96 (viewBox 100), dikte 10, start 12 uur, met de klok mee, 2px gap tussen segmenten.
import { escHtml } from './ui.js';
import { grafiekTabel } from './grafiek-tabel.js';
import { formatGetal, positief, n2, slotKleur, legendeHtml } from './grafiek-hulp.js';

const MAX_SEGMENTEN = 6;
const STRAAL = 45;
const OMTREK = 2 * Math.PI * STRAAL;
const GAP = 2;

// Schoon, begrensd en met aandeel per segment. Gooit RangeError bij meer dan 6 segmenten (verkeerd gebruik).
function bereken(segmenten) {
  if (!Array.isArray(segmenten) || segmenten.length > MAX_SEGMENTEN) {
    throw new RangeError(`Een donut toont hoogstens ${MAX_SEGMENTEN} segmenten (kreeg ${segmenten?.length ?? 0}); groepeer de rest.`);
  }
  const lijst = segmenten.map(s => ({ ...s, w: positief(s.waarde) }));
  const totaal = lijst.reduce((som, s) => som + s.w, 0);
  return { lijst, totaal, pct: s => (totaal > 0 ? Math.round((s.w / totaal) * 100) : 0) };
}

const aantalTekst = (s, pct) => `${formatGetal(s.w)} (${pct(s)} %)`;

// segmenten: [{ sleutel, label, waarde, slot }]; midden: { groot, klein } -> <svg role="img" aria-label="{titel}: …">
export function donutSvg({ segmenten, titel, midden }) {
  const { lijst, totaal, pct } = bereken(segmenten);
  const spoor = '<circle class="donut-spoor" cx="50" cy="50" r="45" fill="none" stroke-width="10"/>';
  let bogen = '';
  let beschrijving = 'geen gegevens';
  let tekst;
  if (totaal > 0) {
    let start = 0;
    for (const s of lijst) {
      if (s.w <= 0) continue;
      const deel = (s.w / totaal) * OMTREK;
      const lengte = Math.max(deel - GAP, 1);
      bogen += `<circle class="donut-boog" cx="50" cy="50" r="${STRAAL}" fill="none" stroke="${slotKleur(s.slot)}" stroke-width="10"`
        + ` stroke-dasharray="${n2(lengte)} ${n2(OMTREK - lengte)}" stroke-dashoffset="${n2(-(start + GAP / 2))}" transform="rotate(-90 50 50)"/>`;
      start += deel;
    }
    beschrijving = lijst.map(s => `${s.label} ${aantalTekst(s, pct)}`).join(', ');
    tekst = `<text class="donut-groot" x="50" y="47" text-anchor="middle" dominant-baseline="central">${escHtml(midden?.groot)}</text>`
      + `<text class="donut-klein" x="50" y="64" text-anchor="middle" dominant-baseline="central">${escHtml(midden?.klein)}</text>`;
  } else {
    tekst = '<text class="donut-klein" x="50" y="50" text-anchor="middle" dominant-baseline="central">geen gegevens</text>';
  }
  return `<svg class="donut-svg" viewBox="0 0 100 100" width="96" height="96" role="img" aria-label="${escHtml(`${titel}: ${beschrijving}`)}">`
    + `${spoor}${bogen}${tekst}</svg>`;
}

// Kleurblokje + naam + aantal + % per segment (het verplichte identiteitskanaal); ook bij totaal 0.
export function donutLegende(segmenten) {
  const { lijst, pct } = bereken(segmenten);
  return legendeHtml(lijst.map(s => ({ label: s.label, slot: s.slot, tekst: aantalTekst(s, pct) })));
}

// svg + legende + tabel-twin.
export function donutFiguur({ segmenten, titel, midden }) {
  const { lijst, pct } = bereken(segmenten);
  const tabel = grafiekTabel({
    titel, kolommen: ['Categorie', 'Aantal', 'Aandeel (%)'],
    rijen: lijst.map(s => [s.label, s.w, pct(s)]),
  });
  return `<figure class="donut">${donutSvg({ segmenten, titel, midden })}${donutLegende(segmenten)}${tabel}</figure>`;
}
