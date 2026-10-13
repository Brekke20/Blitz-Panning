// Blitz Run: skins van de Blitz-laadpaal (puur tekenwerk, enkel canvas-paden).
//
// Drempelladder (beste score, schaal 2 = 0,025 punt per eenheid afstand) voor de basisskins:
// 0, 500, 750, 1000, 1400, 1800, 2300, 2800, 3300, 3800 (Olijf na ca. 54 s in één run).
// Goud: 4500 (ca. 4 min 40 s in één run). Eventskins hebben geen drempel; ze gaan open via `eventSkins`.
// De server spiegelt `vrijgespeeld`.

export const SKINS = [
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
  { id: 'halloween', naam: 'Spookpaal', soort: 'event', eventId: 'halloween', faceplate: '#ff7a00', behuizing: '#1b0f26', bliksem: '#1b0f26', extra: 'heksenhoed' },
  { id: 'kerst', naam: 'Kerstpaal', soort: 'event', eventId: 'kerst', faceplate: '#c8102e', behuizing: '#0f3d22', bliksem: '#ffffff', extra: 'kerstmuts' },
];

// Nachthemel van het spel (verloop boven -> onder) en de lichte contour van de paal: de paal moet bij elke skin duidelijk
// afsteken, ook als de behuizing zelf donker is. `tests/spel-skins.test.mjs` bewaakt een contrast van minstens 3:1.
export const HEMEL = Object.freeze({ boven: '#2f4358', onder: '#1b2836' });
export const RAND_KLEUR = '#e9f2f8';

export function standaardSkin() {
  return 'blitz';
}

export function vrijgespeeld(skin, { besteScore = 0, eventSkins = [] } = {}) {
  if (!skin) return false;
  if (skin.soort === 'event') return Array.isArray(eventSkins) && eventSkins.includes(skin.id);
  return (Number(besteScore) || 0) >= (skin.drempel ?? 0);
}

// ---- Extra's: id -> tekenfunctie(ctx, g, t). g = { x, y, bw, bh, top, bukken } ----
// bw/bh zijn al geschaald voor de houding, dus extra's volgen het bukken vanzelf.

function heksenhoed(ctx, g, t) {
  const cx = g.x + g.bw * 0.5;
  const rand = g.bw * 0.6;
  const hoogte = g.bh * (g.bukken ? 0.5 : 0.38);
  const wiebel = Math.sin(t / 250) * g.bw * 0.04;
  const basis = g.top;
  ctx.fillStyle = '#2a1840';
  ctx.strokeStyle = RAND_KLEUR;
  ctx.lineWidth = 1.2;
  ctx.fillRect(cx - rand, basis - g.bh * 0.05, rand * 2, g.bh * 0.05);
  ctx.strokeRect(cx - rand, basis - g.bh * 0.05, rand * 2, g.bh * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx - g.bw * 0.4, basis - g.bh * 0.05);
  ctx.lineTo(cx + g.bw * 0.4, basis - g.bh * 0.05);
  ctx.lineTo(cx + wiebel + g.bw * 0.25, basis - hoogte);
  ctx.lineTo(cx + wiebel, basis - hoogte - g.bh * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ff7a00';
  ctx.fillRect(cx - g.bw * 0.4, basis - g.bh * 0.12, g.bw * 0.8, g.bh * 0.05);
}

function kerstmuts(ctx, g, t) {
  const cx = g.x + g.bw * 0.5;
  const hoogte = g.bh * (g.bukken ? 0.42 : 0.32);
  const zwiep = Math.sin(t / 300) * g.bw * 0.04;
  const rand = g.bh * 0.06;
  const basis = g.top - rand * 0.5;
  const l = cx - g.bw * 0.45;
  const r = cx + g.bw * 0.45;
  // Gebogen, naar rechts afhangende rode kegel.
  const tipX = cx + g.bw * 0.62 + zwiep;
  const tipY = basis - hoogte * 0.55;
  ctx.fillStyle = '#d3162f';
  ctx.beginPath();
  ctx.moveTo(l, basis);
  ctx.quadraticCurveTo(l + g.bw * 0.05, basis - hoogte * 1.15, cx + g.bw * 0.2, basis - hoogte);
  ctx.quadraticCurveTo(tipX - g.bw * 0.05, basis - hoogte * 0.95, tipX, tipY);
  ctx.quadraticCurveTo(cx + g.bw * 0.4, basis - hoogte * 0.5, r, basis);
  ctx.closePath();
  ctx.fill();
  // Witte pelsrand.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(l - g.bw * 0.05, basis - rand * 0.5, r - l + g.bw * 0.1, rand * 1.3);
  // Pompon.
  ctx.beginPath();
  ctx.arc(tipX, tipY, Math.max(1.5, g.bw * 0.11), 0, Math.PI * 2);
  ctx.fill();
}

export const EXTRAS = { heksenhoed, kerstmuts };

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

  const extra = skin.extra && EXTRAS[skin.extra];
  if (extra) extra(ctx, { x, y, bw, bh, top, bukken: !!bukken }, t);
  ctx.restore();
}
