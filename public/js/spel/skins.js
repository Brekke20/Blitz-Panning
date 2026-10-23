// Blitz Run: skins van de Blitz-laadpaal (puur tekenwerk, enkel canvas-paden).
//
// Drempelladder (beste score, schaal 2 = 0,025 punt per eenheid afstand) voor de basisskins:
// 0, 500, 750, 1000, 1400, 1800, 2300, 2800, 3300, 3800 (Olijf na ca. 54 s in één run).
// Goud: 4500 (ca. 4 min 40 s in één run). Themaskins hebben geen drempel: ze komen uit de themapakketten (`spelskin`) en gaan open
// zolang hun thema actief is (`actieveThemaIds`). De server spiegelt `vrijgespeeld` (netlify/lib/spel.js via spel-regels.js).
import { HEMEL, RAND_KLEUR } from './skin-kleuren.js';

// De kleurconstanten staan in skin-kleuren.js (de validator van themapakketten leest enkel dat pure bestand); hier opnieuw
// aangeboden zodat de rest van het spel ze gewoon uit skins.js blijft halen.
export { HEMEL, RAND_KLEUR };

export const BASIS_SKINS = [
  { id: 'blitz', naam: 'Blitz Standaard', soort: 'basis', drempel: 0, faceplate: '#00dfa3', behuizing: '#121212', bliksem: '#0b3d2f' },
  { id: 'olijf', naam: 'Klassiek Olijf', soort: 'basis', drempel: 500, faceplate: '#6b7a2f', behuizing: '#141414', bliksem: '#e6edc2' },
  { id: 'nachtblauw', naam: 'Nachtblauw', soort: 'basis', drempel: 750, faceplate: '#4a6fa5', behuizing: '#121212', bliksem: '#e3edfb' },
  { id: 'bordeaux', naam: 'Bordeaux', soort: 'basis', drempel: 1000, faceplate: '#7a1f3d', behuizing: '#141414', bliksem: '#f6d7e1' },
  { id: 'snellader', naam: 'Snellader', soort: 'basis', drempel: 1400, faceplate: '#ffd400', behuizing: '#1c1c1c', bliksem: '#111111' },
  { id: 'stroomstoot', naam: 'Stroomstoot', soort: 'basis', drempel: 1800, faceplate: '#ff5a1f', behuizing: '#1f1f24', bliksem: '#fff1e8' },
  { id: 'turbo', naam: 'Turbo', soort: 'basis', drempel: 2300, faceplate: '#e11d2e', behuizing: '#0b0b0b', bliksem: '#ffffff' },
  { id: 'oceaan', naam: 'Oceaanstroom', soort: 'basis', drempel: 2800, faceplate: '#00c2ff', behuizing: '#0a2a43', bliksem: '#04283a' },
  { id: 'ultraviolet', naam: 'Ultraviolet', soort: 'basis', drempel: 3300, faceplate: '#b26bff', behuizing: '#2a1458', bliksem: '#ffffff' },
  { id: 'poolijs', naam: 'Poolijs', soort: 'basis', drempel: 3800, faceplate: '#1a1a1a', behuizing: '#e8eef2', bliksem: '#00dfa3' },
  { id: 'goud', naam: 'Gouden Paal', soort: 'goud', drempel: 4500, faceplate: '#ffe27a', behuizing: '#c9962a', bliksem: '#5a3d00' },
];

// Alias van BASIS_SKINS (de tien basisskins en goud), voor wie enkel de ingebouwde skins nodig heeft.
export const SKINS = BASIS_SKINS;

export function standaardSkin() {
  return 'blitz';
}

// DE ontgrendelregel (client en server): een themaskin is open als zijn thema actief is (`actieveThemaIds`), de rest op de score.
export function vrijgespeeld(skin, { besteScore = 0, actieveThemaIds = [] } = {}) {
  if (!skin) return false;
  if (skin.soort === 'thema') return Array.isArray(actieveThemaIds) && actieveThemaIds.includes(skin.id);
  return (Number(besteScore) || 0) >= (skin.drempel ?? 0);
}

// Een themaskin per pakket met een `spelskin`: { id: <thema-id>, naam, soort: 'thema', themaNaam, behuizing, faceplate, bliksem, rand?, extraVorm? }.
// `extraVorm` is de vorm uit `pakket.vormen` waar `spelskin.extra` naar wijst ({ viewBox, delen }); zonder extra geen hoed of muts.
// `pakketten`: een lijst pakketten of een kaart id -> pakket (zoals `themasNu().pakketten`); wat geen pakket met spelskin is, valt weg.
export function themaSkins(pakketten) {
  const lijst = Array.isArray(pakketten) ? pakketten : (pakketten && typeof pakketten === 'object' ? Object.values(pakketten) : []);
  const uit = [];
  for (const p of lijst) {
    const sk = p && typeof p === 'object' ? p.spelskin : null;
    if (!sk || typeof sk !== 'object' || typeof p.id !== 'string') continue;
    const skin = { id: p.id, naam: sk.naam, soort: 'thema', themaNaam: p.naam, behuizing: sk.behuizing, faceplate: sk.faceplate, bliksem: sk.bliksem };
    if (sk.rand !== undefined) skin.rand = sk.rand;
    const vormen = p.vormen && typeof p.vormen === 'object' ? p.vormen : {};
    if (typeof sk.extra === 'string' && Object.hasOwn(vormen, sk.extra) && vormen[sk.extra]) skin.extraVorm = vormen[sk.extra];
    uit.push(skin);
  }
  return uit;
}

// De volledige lijst: de tien basisskins en goud, daarna de themaskins van de gegeven pakketten.
export function alleSkins(pakketten) {
  return [...BASIS_SKINS, ...themaSkins(pakketten)];
}

// ---- Extra's (hoed, muts, ...): `skin.extraVorm` uit het themapakket, getekend met Path2D ----
// Afspraak (zie netlify/themas/pakketten.js): coördinaten in eenheden van de paal (0 tot 100 = breedte `bw` en hoogte `bh`, negatieve y boven de paal);
// `lijnDikte` in schermpixels; statisch (geen animatie). Elk deel wordt een Path2D (cirkel en ellips = twee bogen, rechthoek en veelhoek = M/L/Z,
// lijn = enkel een streep) dat eenmalig per vorm en per maat van de paal (staan en bukken) gebouwd wordt: tijdens het spel komt er per beeld
// geen enkele Path2D bij. De positie loopt via `ctx.translate`, de geometrie is al geschaald met bw / 100 en bh / 100.

const EXTRA_CACHE = new WeakMap(); // extraVorm -> { delen: [{ d, m, ... }], pad: Path2D[] (eenheidspaden), maten: Map }
const MAX_MATEN = 6; // staan en bukken zijn twee maten; een resize of dpr-wijziging verandert de logische maat niet

const g = (n) => String(Math.round(n * 1e4) / 1e4);
const GETAL = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const getallen = (t) => (String(t).match(GETAL) ?? []).map(Number);
const IDENTITEIT = [1, 0, 0, 1, 0, 0];
const maal = (p, q) => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
  p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
];

// "translate(a b) rotate(d cx cy) scale(s)" -> [a, b, c, d, e, f] (van links naar rechts samengesteld, zoals SVG).
function matrixVan(transform) {
  if (typeof transform !== 'string' || !transform) return IDENTITEIT;
  let m = IDENTITEIT;
  for (const [, naam, args] of transform.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)) {
    const n = getallen(args);
    let t = IDENTITEIT;
    if (naam === 'translate') t = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    else if (naam === 'scale') t = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else {
      const h = ((n[0] ?? 0) * Math.PI) / 180;
      const c = Math.cos(h);
      const s = Math.sin(h);
      t = [c, s, -s, c, 0, 0];
      if (n.length >= 3) t = maal(maal([1, 0, 0, 1, n[1], n[2]], t), [1, 0, 0, 1, -n[1], -n[2]]);
    }
    m = maal(m, t);
  }
  return m;
}

// Het pad (SVG-tekst) van een deel, of null als het niets tekent.
function padVan(deel) {
  const { soort } = deel;
  if (soort === 'path') return typeof deel.d === 'string' ? deel.d : null;
  if (soort === 'circle' || soort === 'ellipse') {
    const rx = soort === 'circle' ? deel.r : deel.rx;
    const ry = soort === 'circle' ? deel.r : deel.ry;
    if (!(rx > 0) || !(ry > 0) || !Number.isFinite(deel.cx) || !Number.isFinite(deel.cy)) return null;
    return `M${g(deel.cx - rx)} ${g(deel.cy)}A${g(rx)} ${g(ry)} 0 1 0 ${g(deel.cx + rx)} ${g(deel.cy)}A${g(rx)} ${g(ry)} 0 1 0 ${g(deel.cx - rx)} ${g(deel.cy)}Z`;
  }
  if (soort === 'rect') {
    const { x, y, width: w, height: h } = deel;
    if (![x, y, w, h].every(Number.isFinite) || !(w > 0) || !(h > 0)) return null;
    let rx = deel.rx ?? deel.ry ?? 0;
    let ry = deel.ry ?? deel.rx ?? 0;
    rx = Math.min(Math.max(0, rx), w / 2);
    ry = Math.min(Math.max(0, ry), h / 2);
    if (rx === 0 || ry === 0) return `M${g(x)} ${g(y)}H${g(x + w)}V${g(y + h)}H${g(x)}Z`;
    return `M${g(x + rx)} ${g(y)}H${g(x + w - rx)}A${g(rx)} ${g(ry)} 0 0 1 ${g(x + w)} ${g(y + ry)}V${g(y + h - ry)}A${g(rx)} ${g(ry)} 0 0 1 ${g(x + w - rx)} ${g(y + h)}`
      + `H${g(x + rx)}A${g(rx)} ${g(ry)} 0 0 1 ${g(x)} ${g(y + h - ry)}V${g(y + ry)}A${g(rx)} ${g(ry)} 0 0 1 ${g(x + rx)} ${g(y)}Z`;
  }
  if (soort === 'polygon') {
    const n = getallen(deel.points);
    if (n.length < 4) return null;
    const punten = [];
    for (let i = 0; i + 1 < n.length; i += 2) punten.push(`${g(n[i])} ${g(n[i + 1])}`);
    return `M${punten.join('L')}Z`;
  }
  if (soort === 'line') {
    if (![deel.x1, deel.y1, deel.x2, deel.y2].every(Number.isFinite)) return null;
    return `M${g(deel.x1)} ${g(deel.y1)}L${g(deel.x2)} ${g(deel.y2)}`;
  }
  return null;
}

const kleurVan = (v) => {
  if (v && typeof v === 'object') return typeof v.stops?.[0]?.kleur === 'string' ? v.stops[0].kleur : null; // een verloop: de eerste kleur
  return typeof v === 'string' && v !== 'geen' ? v : null;
};
const EINDE = { rond: 'round', recht: 'butt', vierkant: 'square' };
const HOEK = { rond: 'round', scherp: 'miter', schuin: 'bevel' };

// Alle tekenende delen van de vorm, groepen opengevouwen (een transform van de groep gaat voor die van het deel).
function platteDelen(delen, m = IDENTITEIT, uit = [], diepte = 0) {
  if (!Array.isArray(delen) || diepte > 2) return uit;
  for (const deel of delen) {
    if (!deel || typeof deel !== 'object') continue;
    const mDeel = maal(m, matrixVan(deel.transform));
    if (deel.soort === 'groep') { platteDelen(deel.delen, mDeel, uit, diepte + 1); continue; }
    const d = padVan(deel);
    if (!d) continue;
    const vul = deel.soort === 'line' ? null : kleurVan(deel.vul); // een lijn wordt nooit gevuld; zonder `vul` ook niets
    const lijn = kleurVan(deel.lijn);
    const dikte = Number.isFinite(deel.lijnDikte) ? deel.lijnDikte : 1;
    if (!vul && !(lijn && dikte > 0)) continue;
    uit.push({
      d, m: mDeel, vul, lijn: lijn && dikte > 0 ? lijn : null, dikte,
      dekking: Number.isFinite(deel.dekking) ? Math.min(1, Math.max(0, deel.dekking)) : 1,
      einde: EINDE[deel.lijnEinde] ?? 'butt', hoek: HOEK[deel.lijnHoek] ?? 'miter',
    });
  }
  return uit;
}

function bouwExtra(vorm) {
  let e = EXTRA_CACHE.get(vorm);
  if (e) return e;
  try {
    const delen = platteDelen(vorm.delen);
    e = { delen, pad: delen.map((dl) => new Path2D(dl.d)), maten: new Map() };
  } catch { e = { delen: [], pad: [], maten: new Map() }; }
  EXTRA_CACHE.set(vorm, e);
  return e;
}

// De Path2D's van de extra, geschaald naar een paal van bw x bh (eenmalig per maat).
function padenVoorMaat(e, bw, bh) {
  const sleutel = `${bw.toFixed(4)}|${bh.toFixed(4)}`;
  let paden = e.maten.get(sleutel);
  if (paden) return paden;
  if (e.maten.size >= MAX_MATEN) e.maten.clear();
  const sx = bw / 100;
  const sy = bh / 100;
  paden = e.delen.map((dl, i) => {
    const p = new Path2D();
    const m = dl.m;
    // `+ 0` maakt van een -0 een gewone 0 (een matrix zonder tekenverschil)
    p.addPath(e.pad[i], { a: sx * m[0] + 0, b: sy * m[1] + 0, c: sx * m[2] + 0, d: sy * m[3] + 0, e: sx * m[4] + 0, f: sy * m[5] + 0 });
    return p;
  });
  e.maten.set(sleutel, paden);
  return paden;
}

function tekenExtra(ctx, vorm, x, top, bw, bh) {
  if (!vorm || typeof Path2D !== 'function') return;
  const e = bouwExtra(vorm);
  if (!e.delen.length) return;
  const paden = padenVoorMaat(e, bw, bh);
  ctx.save();
  ctx.translate(x, top);
  for (let i = 0; i < e.delen.length; i++) {
    const dl = e.delen[i];
    ctx.globalAlpha = dl.dekking;
    if (dl.vul) { ctx.fillStyle = dl.vul; ctx.fill(paden[i]); }
    if (dl.lijn) {
      ctx.strokeStyle = dl.lijn;
      ctx.lineWidth = dl.dikte;
      ctx.lineCap = dl.einde;
      ctx.lineJoin = dl.hoek;
      ctx.stroke(paden[i]);
    }
  }
  ctx.restore();
}

// ---- Tekenen ----

// Bukken = dezelfde paal, platgedrukt: precies de hitbox van spel-logica.js (staan 18x52, bukken 32x30), zodat wat je ziet
// ook is wat botst. De aanroeper geeft altijd de STAANDE afmetingen mee; `bukken` schaalt ze.
const BUK_H = 30 / 52;
const BUK_B = 32 / 18;

// Het Blitz-logo (public/icons/icon.svg): twee schuine, afgeronde streken. Middenlijnen in logo-eenheden (viewBox 512).
const LOGO = Object.freeze({ x0: 174, x1: 332, y0: 119, y1: 417, streken: [[[332, 119], [208, 255]], [[298, 281], [174, 417]]] });

// Tekent het logo in het vak (x, y, b, h): de middenlijnen schalen mee met het vak, de streekdikte `dikte` blijft rond.
export function tekenLogoBliksem(ctx, x, y, b, h, dikte, kleur) {
  const r = dikte / 2;
  const sx = (v) => x + r + ((v - LOGO.x0) / (LOGO.x1 - LOGO.x0)) * Math.max(0, b - dikte);
  const sy = (v) => y + r + ((v - LOGO.y0) / (LOGO.y1 - LOGO.y0)) * Math.max(0, h - dikte);
  ctx.save();
  ctx.strokeStyle = kleur;
  ctx.lineWidth = dikte;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [[ax, ay], [bx, by]] of LOGO.streken) {
    ctx.moveTo(sx(ax), sy(ay));
    ctx.lineTo(sx(bx), sy(by));
  }
  ctx.stroke();
  ctx.restore();
}

export function tekenPaal(ctx, skin, { x, y, breedte, hoogte, bukken = false, t = 0 }) {
  const bw = bukken ? breedte * BUK_B : breedte;
  const bh = bukken ? hoogte * BUK_H : hoogte;
  const top = y - bh;

  ctx.save();
  ctx.fillStyle = skin.behuizing;
  ctx.fillRect(x, top, bw, bh);
  // Lichte contour + subtiele bovenglans: de paal steekt zo bij elke skin af tegen de nachthemel.
  const rand = skin.rand ?? RAND_KLEUR;
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, top, bw, Math.max(1, bh * 0.12));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rand;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, top + 0.75, bw - 1.5, bh - 1.5);

  // Faceplate linksboven: smal en staand, de grootte volgt de hoogte van de paal (bukken = dezelfde plaat, evenredig kleiner).
  const fh = bh * (bukken ? 0.4 : 0.36);
  const fw = Math.max(2, fh * 0.32);
  const fx = x + bh * (bukken ? 0.2 : 0.12);
  const fy = top + bh * 0.1;
  ctx.fillStyle = skin.faceplate;
  ctx.fillRect(fx, fy, fw, fh);
  tekenLogoBliksem(ctx, fx + fw * 0.12, fy + fh * 0.1, fw * 0.76, fh * 0.8, Math.max(0.8, fw * 0.3), skin.bliksem);

  // Subtiele lichte rand rechts: leest als 3D-kolom.
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + bw - Math.max(1, bw * 0.07), top, Math.max(1, bw * 0.07), bh);
  ctx.globalAlpha = 1;

  if (skin.soort === 'goud') {
    // Zachte glans die over de behuizing schuift.
    const f = (t % 2400) / 2400;
    const gx = x + bw * (-0.3 + 1.3 * f);
    const l = Math.max(x, gx);
    const r = Math.min(x + bw, gx + bw * 0.18);
    if (r > l) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath();
      ctx.moveTo(l, top);
      ctx.lineTo(r, top);
      ctx.lineTo(Math.min(x + bw, gx + bw * 0.08), y);
      ctx.lineTo(Math.max(x, gx - bw * 0.1), y);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  if (skin.extraVorm) tekenExtra(ctx, skin.extraVorm, x, top, bw, bh);
  ctx.restore();
}
