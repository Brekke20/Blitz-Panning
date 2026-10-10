// kern/grafiek-lijn.js — lijngrafiek over de tijd als inline SVG (één y-as, nooit dual-axis).
// Puur (strings). 2px lijnen, eind-marker r=4 met 2px oppervlakte-ring, hairline gridlijnen, label aan het eind in tekstkleur,
// onzichtbare verticale hit-stroken (≥ 24px, focusbaar) met een <title> voor alle reeksen op die dag, en een tabel-twin.
import { escHtml } from './ui.js';
import { grafiekTabel } from './grafiek-tabel.js';
import { formatGetal, n2, slotKleur, kort, leegBericht, mooieTicks, legendeHtml } from './grafiek-hulp.js';

const MAX_REEKSEN = 4;
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const LABEL_HOOGTE = 14;

// 'YYYY-MM-DD' -> '5 okt'; al het andere blijft zoals het is (bv. een weeklabel).
function dagLabel(punt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(punt));
  return m && MAANDEN[Number(m[2]) - 1] ? `${Number(m[3])} ${MAANDEN[Number(m[2]) - 1]}` : String(punt ?? '');
}

const schoneWaarde = v => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null);
const eenheidTekst = eenheid => (eenheid ? ` ${eenheid}` : '');

// Aaneengesloten stukken (runs) van niet-null waarden: [[i, i+1, …], …].
function runs(waarden) {
  const uit = [];
  let huidig = null;
  waarden.forEach((w, i) => {
    if (w === null) { huidig = null; return; }
    if (!huidig) { huidig = []; uit.push(huidig); }
    huidig.push(i);
  });
  return uit;
}

// Schuift eindlabels uit elkaar zodat ze niet over elkaar liggen (minstens LABEL_HOOGTE tussen twee labels).
function spreid(labels, min, max) {
  const gesorteerd = [...labels].sort((a, b) => a.y - b.y);
  gesorteerd.forEach((l, i) => { if (i > 0) l.y = Math.max(l.y, gesorteerd[i - 1].y + LABEL_HOOGTE); });
  const over = gesorteerd.length ? gesorteerd[gesorteerd.length - 1].y - max : 0;
  if (over > 0) gesorteerd.forEach(l => { l.y = Math.max(min, l.y - over); });
  return labels;
}

// punten: [datum-strings]; reeksen: [{ sleutel, label, slot, waarden:[number|null] }] (max 4) -> <svg> + legende + tabel-twin.
export function lijnGrafiek({ punten, reeksen, titel, eenheid = 'min', categorieLabel = 'Dag' }) {
  if ((reeksen?.length ?? 0) > MAX_REEKSEN) {
    throw new RangeError(`Een lijngrafiek toont hoogstens ${MAX_REEKSEN} reeksen (kreeg ${reeksen.length}).`);
  }
  if (!punten?.length || !reeksen?.length) return leegBericht();
  const lijst = reeksen.map(r => ({ ...r, w: punten.map((_, i) => schoneWaarde(r.waarden?.[i])) }));
  const alle = lijst.flatMap(r => r.w).filter(w => w !== null);
  if (!alle.length) return leegBericht();

  const ticks = mooieTicks(Math.max(...alle));
  const B = 600, H = 260, L = 52, R = 110, T = 22, O = 32;
  const plotB = B - L - R, plotH = H - T - O, basisY = T + plotH;
  const x = i => (punten.length === 1 ? L + plotB / 2 : L + (i * plotB) / (punten.length - 1));
  const y = v => basisY - (v / ticks.top) * plotH;
  const stap = punten.length === 1 ? plotB : plotB / (punten.length - 1);
  const delen = [];

  for (const t of ticks.ticks) {
    delen.push(`<line class="grid" x1="${L}" x2="${B - R}" y1="${n2(y(t))}" y2="${n2(y(t))}" vector-effect="non-scaling-stroke"/>`
      + `<text class="as-tekst" x="${L - 8}" y="${n2(y(t))}" text-anchor="end" dominant-baseline="central">${formatGetal(t)}</text>`);
  }
  delen.push(`<line class="as" x1="${L}" x2="${B - R}" y1="${basisY}" y2="${basisY}" vector-effect="non-scaling-stroke"/>`);
  if (eenheid) delen.push(`<text class="as-tekst as-eenheid" x="4" y="${T - 8}">${escHtml(eenheid)}</text>`);

  // x-labels: niet vaker dan er ruimte is (≈ 48 eenheden per label).
  const elke = Math.max(1, Math.ceil(punten.length / Math.max(1, Math.floor(plotB / 48))));
  punten.forEach((p, i) => {
    if (i % elke === 0) delen.push(`<text class="as-tekst" x="${n2(x(i))}" y="${H - 12}" text-anchor="middle">${escHtml(dagLabel(p))}</text>`);
  });

  // hit-stroken eerst (onder de lijnen): hover én focus tonen de waarden van alle reeksen op die dag.
  const hitB = Math.max(24, stap);
  punten.forEach((p, i) => {
    const regels = [dagLabel(p), ...lijst.map(r => `${r.label}: ${r.w[i] === null ? 'geen gegevens' : `${formatGetal(r.w[i])}${eenheidTekst(eenheid)}`}`)];
    const tekst = escHtml(regels.join('\n'));
    delen.push(`<rect class="lijn-hit" x="${n2(x(i) - hitB / 2)}" y="${T}" width="${n2(hitB)}" height="${plotH}" fill="transparent" tabindex="0" role="img" aria-label="${escHtml(regels.join(', '))}"><title>${tekst}</title></rect>`);
  });

  const eindlabels = [];
  for (const r of lijst) {
    const stukken = runs(r.w);
    const d = stukken.filter(s => s.length > 1)
      .map(s => s.map((i, k) => `${k === 0 ? 'M' : 'L'}${n2(x(i))},${n2(y(r.w[i]))}`).join(''))
      .join('');
    if (d) delen.push(`<path class="lijn" d="${d}" fill="none" stroke="${slotKleur(r.slot)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
    const laatste = stukken.length ? stukken[stukken.length - 1].at(-1) : null;
    const markers = new Set(stukken.filter(s => s.length === 1).map(s => s[0]));
    if (laatste !== null) markers.add(laatste);
    for (const i of markers) {
      delen.push(`<circle class="lijn-marker" cx="${n2(x(i))}" cy="${n2(y(r.w[i]))}" r="4" fill="${slotKleur(r.slot)}" stroke="var(--surface)" stroke-width="4" paint-order="stroke"/>`);
    }
    if (laatste !== null) eindlabels.push({ r, x: x(laatste) + 10, y: y(r.w[laatste]) });
  }
  for (const l of spreid(eindlabels, T + 6, basisY)) {
    delen.push(`<text class="lijn-label" x="${n2(l.x)}" y="${n2(l.y)}" dominant-baseline="central"><title>${escHtml(l.r.label)}</title>${escHtml(kort(l.r.label, 14))}</text>`);
  }

  const svg = `<svg class="grafiek-svg" viewBox="0 0 ${B} ${H}" role="group" aria-label="${escHtml(titel)}">${delen.join('')}</svg>`;
  const legende = lijst.length > 1 ? legendeHtml(lijst.map(r => ({ label: r.label, slot: r.slot }))) : '';
  const tabel = grafiekTabel({
    titel, kolommen: [categorieLabel, ...lijst.map(r => r.label)],
    rijen: punten.map((p, i) => [dagLabel(p), ...lijst.map(r => r.w[i])]),
  });
  return `<div class="grafiek grafiek--lijn"><div class="grafiek-scroll">${svg}</div>${legende}${tabel}</div>`;
}
