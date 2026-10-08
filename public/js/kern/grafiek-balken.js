// kern/grafiek-balken.js — horizontale balkrijen, gestapelde kolommen en gestapelde balken als inline SVG.
// Puur (strings). Kleur volgt de entiteit: het `slot` komt van de aanroeper, nooit van de rang.
// Marks: ≤ 24px dik, 4px afgerond aan de data-kant en vierkant aan de basis, 2px gap tussen aanliggende vlakken.
import { escHtml } from './ui.js';
import { grafiekTabel } from './grafiek-tabel.js';
import {
  formatGetal, positief, n2, slotKleur, kort, leegBericht, mooieTicks, legendeHtml, beperkReeksen,
  padBoven, padRechts, padRechthoek,
} from './grafiek-hulp.js';

const GAP = 2;
const eenheidTekst = eenheid => (eenheid ? ` ${eenheid}` : '');

// rijen: [{ label, waarde, tekst? }] -> raster: label | balk (svg, % van het maximum) | waardetekst.
export function balkenRijen({ rijen, slot = 1, eenheid = '', titel }) {
  if (!rijen?.length) return leegBericht();
  const max = Math.max(0, ...rijen.map(r => positief(r.waarde)));
  const kleur = slotKleur(slot);
  const html = rijen.map(r => {
    const w = positief(r.waarde);
    const pct = max > 0 ? n2((w / max) * 100) : '0';
    const tekst = r.tekst ?? `${formatGetal(w)}${eenheidTekst(eenheid)}`;
    const label = escHtml(`${r.label}: ${tekst}`);
    // 4px afgerond aan de data-kant (rx op het vlak), vierkant aan de basis (extra vierkant stukje links).
    const balk = w > 0
      ? `<rect x="0" y="0" width="${pct}%" height="16" rx="4" fill="${kleur}"/>${Number(pct) >= 3 ? `<rect x="0" y="0" width="4" height="16" fill="${kleur}"/>` : ''}`
      : `<rect x="0" y="0" width="0%" height="16" fill="${kleur}"/>`;
    return `<div class="balk-rij"><span class="balk-label">${escHtml(r.label)}</span>`
      + `<svg class="balk-svg" width="100%" height="16" role="img" aria-label="${label}"><title>${label}</title>${balk}</svg>`
      + `<span class="balk-waarde">${escHtml(tekst)}</span></div>`;
  }).join('');
  const tabel = grafiekTabel({
    titel, kolommen: ['Categorie', `Waarde${eenheidTekst(eenheid)}`],
    rijen: rijen.map(r => [r.label, positief(r.waarde)]),
  });
  return `<div class="balken-blok"><div class="balken" role="group" aria-label="${escHtml(titel)}">${html}</div>${tabel}</div>`;
}

// Gedeeld: schoon, beperk tot maxReeksen (+ Overige), totalen per categorie.
function voorbereid(categorieen, reeksen, maxReeksen) {
  const lijst = beperkReeksen(reeksen ?? [], maxReeksen, categorieen.length);
  const totalen = categorieen.map((_, i) => lijst.reduce((s, r) => s + r.waarden[i], 0));
  return { lijst, totalen, ticks: mooieTicks(Math.max(0, ...totalen)) };
}

function tabelVan(titel, categorieen, lijst, totalen, categorieLabel) {
  return grafiekTabel({
    titel, kolommen: [categorieLabel, ...lijst.map(r => r.label), 'Totaal'],
    rijen: categorieen.map((c, i) => [c, ...lijst.map(r => r.waarden[i]), totalen[i]]),
  });
}

function segmentTekst(cat, reeks, waarde, eenheid) {
  return `${cat} · ${reeks.label}: ${formatGetal(waarde)}${eenheidTekst(eenheid)}`;
}

function legende(lijst) {
  return lijst.length > 1 ? legendeHtml(lijst.map(r => ({ label: r.label, slot: r.slot }))) : '';
}

// Zichtbare segmenten van categorie i met hun span [van, tot] langs de waardeas (in pixels, basis = 0).
function stapel(lijst, i, schaal) {
  let basis = 0;
  const zichtbaar = [];
  for (const r of lijst) {
    const w = r.waarden[i];
    if (w <= 0) continue;
    zichtbaar.push({ r, w, van: basis, tot: basis + schaal(w) });
    basis += schaal(w);
  }
  return zichtbaar;
}

// Lengte van een segment na aftrek van de helft van de gap aan elke kant waar een buur ligt.
const lengteMetGap = (s, eerste, laatste) => Math.max(1, (s.tot - s.van) - (eerste ? 0 : GAP / 2) - (laatste ? 0 : GAP / 2));

function segmentPad(s, d, cat, eenheid) {
  const tekst = escHtml(segmentTekst(cat, s.r, s.w, eenheid));
  return `<path class="seg" d="${d}" fill="${slotKleur(s.r.slot)}" tabindex="0" role="img" aria-label="${tekst}"><title>${tekst}</title></path>`;
}

function omhulsel(klasse, B, H, titel, delen, lijst, tabel) {
  const svg = `<svg class="grafiek-svg" viewBox="0 0 ${B} ${H}" role="group" aria-label="${escHtml(titel)}">${delen.join('')}</svg>`;
  return `<div class="grafiek ${klasse}"><div class="grafiek-scroll">${svg}</div>${legende(lijst)}${tabel}</div>`;
}

// categorieen: [string]; reeksen: [{ sleutel, label, slot, waarden:[number] }] -> verticale gestapelde kolommen.
export function gestapeldeKolommen({ categorieen, reeksen, titel, eenheid = '', maxReeksen = 7, categorieLabel = 'Categorie' }) {
  if (!categorieen?.length || !reeksen?.length) return leegBericht();
  const { lijst, totalen, ticks } = voorbereid(categorieen, reeksen, maxReeksen);
  const B = 600, H = 260, L = 52, R = 8, T = 12, O = 32;
  const plotB = B - L - R, plotH = H - T - O, basisY = T + plotH;
  const schaal = v => (v / ticks.top) * plotH;
  const slotB = plotB / categorieen.length;
  const kolomB = Math.min(24, slotB * 0.7);
  // Labels uitdunnen (zoals de lijngrafiek): elk label krijgt minstens zijn eigen breedte (max 12 tekens ≈ 6,5 per teken).
  const langste = Math.min(12, Math.max(...categorieen.map(c => String(c).length)));
  const elke = Math.max(1, Math.ceil((langste * 6.5 + 4) / slotB));
  const delen = [];
  for (const t of ticks.ticks) {
    const y = basisY - schaal(t);
    delen.push(`<line class="grid" x1="${L}" x2="${B - R}" y1="${n2(y)}" y2="${n2(y)}" vector-effect="non-scaling-stroke"/>`
      + `<text class="as-tekst" x="${L - 8}" y="${n2(y)}" text-anchor="end" dominant-baseline="central">${formatGetal(t)}</text>`);
  }
  delen.push(`<line class="as" x1="${L}" x2="${B - R}" y1="${basisY}" y2="${basisY}" vector-effect="non-scaling-stroke"/>`);
  categorieen.forEach((cat, i) => {
    const x0 = L + i * slotB, x = x0 + (slotB - kolomB) / 2;
    const samen = lijst.map(r => segmentTekst(cat, r, r.waarden[i], eenheid)).join('\n');
    delen.push(`<rect class="kolom-hit" x="${n2(x0)}" y="${T}" width="${n2(slotB)}" height="${plotH}" fill="transparent"><title>${escHtml(samen)}</title></rect>`);
    const segs = stapel(lijst, i, schaal);
    segs.forEach((s, k) => {
      const eerste = k === 0, laatste = k === segs.length - 1;
      const hoogte = lengteMetGap(s, eerste, laatste);
      const bovenY = basisY - s.tot + (laatste ? 0 : GAP / 2);
      delen.push(segmentPad(s, laatste ? padBoven(x, bovenY, kolomB, hoogte) : padRechthoek(x, bovenY, kolomB, hoogte), cat, eenheid));
    });
    if (i % elke === 0) delen.push(`<text class="as-tekst" x="${n2(x0 + slotB / 2)}" y="${H - 12}" text-anchor="middle"><title>${escHtml(cat)}</title>${escHtml(kort(cat, Math.max(3, Math.floor((slotB * elke) / 6.5))))}</text>`);
  });
  return omhulsel('grafiek--kolommen', B, H, titel, delen, lijst, tabelVan(titel, categorieen, lijst, totalen, categorieLabel));
}

// Horizontale variant (bv. top-oorzaken per type): categorie = rij, segmenten van links naar rechts.
export function gestapeldeBalken({ categorieen, reeksen, titel, eenheid = '', maxReeksen = 7, categorieLabel = 'Categorie' }) {
  if (!categorieen?.length || !reeksen?.length) return leegBericht();
  const { lijst, totalen, ticks } = voorbereid(categorieen, reeksen, maxReeksen);
  const B = 600, L = 160, R = 16, T = 6, RIJ = 28, O = 26;
  const H = T + categorieen.length * RIJ + O;
  const plotB = B - L - R, basisY = T + categorieen.length * RIJ;
  const schaal = v => (v / ticks.top) * plotB;
  const delen = [];
  for (const t of ticks.ticks) {
    const x = L + schaal(t);
    delen.push(`<line class="grid" x1="${n2(x)}" x2="${n2(x)}" y1="${T}" y2="${basisY}" vector-effect="non-scaling-stroke"/>`
      + `<text class="as-tekst" x="${n2(x)}" y="${basisY + 16}" text-anchor="middle">${formatGetal(t)}</text>`);
  }
  delen.push(`<line class="as" x1="${L}" x2="${L}" y1="${T}" y2="${basisY}" vector-effect="non-scaling-stroke"/>`);
  categorieen.forEach((cat, i) => {
    const y0 = T + i * RIJ, y = y0 + (RIJ - 16) / 2;
    const samen = lijst.map(r => segmentTekst(cat, r, r.waarden[i], eenheid)).join('\n');
    delen.push(`<rect class="kolom-hit" x="0" y="${y0}" width="${B}" height="${RIJ}" fill="transparent"><title>${escHtml(samen)}</title></rect>`
      + `<text class="as-tekst" x="${L - 8}" y="${y0 + RIJ / 2}" text-anchor="end" dominant-baseline="central"><title>${escHtml(cat)}</title>${escHtml(kort(cat, 24))}</text>`);
    const segs = stapel(lijst, i, schaal);
    segs.forEach((s, k) => {
      const eerste = k === 0, laatste = k === segs.length - 1;
      const breedte = lengteMetGap(s, eerste, laatste);
      const x = L + s.van + (eerste ? 0 : GAP / 2);
      delen.push(segmentPad(s, laatste ? padRechts(x, y, breedte, 16) : padRechthoek(x, y, breedte, 16), cat, eenheid));
    });
  });
  return omhulsel('grafiek--balken', B, H, titel, delen, lijst, tabelVan(titel, categorieen, lijst, totalen, categorieLabel));
}
