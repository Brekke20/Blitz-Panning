// Blitz Run: skins van de Blitz-laadpaal (puur tekenwerk, enkel canvas-paden).
//
// Drempelladder (beste score) voor de basisskins, een vlakke curve die naar boven toe
// steiler wordt: 0, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 6500.
// Goud: 10000. Eventskins hebben geen drempel; ze gaan open via `eventSkins`.
// De server spiegelt `vrijgespeeld`.

export const SKINS = [
  { id: 'blitz', naam: 'Blitz Standaard', soort: 'basis', drempel: 0, faceplate: '#00dfa3', behuizing: '#121212', bliksem: '#0b3d2f' },
  { id: 'olijf', naam: 'Klassiek Olijf', soort: 'basis', drempel: 250, faceplate: '#6b7a2f', behuizing: '#141414', bliksem: '#e6edc2' },
  { id: 'nachtblauw', naam: 'Nachtblauw', soort: 'basis', drempel: 500, faceplate: '#4a6fa5', behuizing: '#121212', bliksem: '#e3edfb' },
  { id: 'bordeaux', naam: 'Bordeaux', soort: 'basis', drempel: 1000, faceplate: '#7a1f3d', behuizing: '#141414', bliksem: '#f6d7e1' },
  { id: 'snellader', naam: 'Snellader', soort: 'basis', drempel: 1500, faceplate: '#ffd400', behuizing: '#1c1c1c', bliksem: '#111111' },
  { id: 'stroomstoot', naam: 'Stroomstoot', soort: 'basis', drempel: 2000, faceplate: '#ff5a1f', behuizing: '#1f1f24', bliksem: '#fff1e8' },
  { id: 'turbo', naam: 'Turbo', soort: 'basis', drempel: 3000, faceplate: '#e11d2e', behuizing: '#0b0b0b', bliksem: '#ffffff' },
  { id: 'oceaan', naam: 'Oceaanstroom', soort: 'basis', drempel: 4000, faceplate: '#00c2ff', behuizing: '#0a2a43', bliksem: '#04283a' },
  { id: 'ultraviolet', naam: 'Ultraviolet', soort: 'basis', drempel: 5000, faceplate: '#b26bff', behuizing: '#2a1458', bliksem: '#ffffff' },
  { id: 'poolijs', naam: 'Poolijs', soort: 'basis', drempel: 6500, faceplate: '#1a1a1a', behuizing: '#e8eef2', bliksem: '#00dfa3' },
  { id: 'goud', naam: 'Gouden Paal', soort: 'goud', drempel: 10000, faceplate: '#ffe27a', behuizing: '#c9962a', bliksem: '#5a3d00' },
  { id: 'halloween', naam: 'Spookpaal', soort: 'event', eventId: 'halloween', faceplate: '#ff7a00', behuizing: '#1b0f26', bliksem: '#1b0f26', extra: 'heksenhoed' },
  { id: 'kerst', naam: 'Kerstpaal', soort: 'event', eventId: 'kerst', faceplate: '#c8102e', behuizing: '#0f3d22', bliksem: '#ffffff', extra: 'kerstmuts' },
];

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
  const rand = g.bw * 0.7;
  const hoogte = g.bh * (g.bukken ? 0.5 : 0.38);
  const wiebel = Math.sin(t / 250) * g.bw * 0.04;
  const basis = g.top;
  ctx.fillStyle = '#2a1840';
  ctx.fillRect(cx - rand, basis - g.bh * 0.05, rand * 2, g.bh * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx - g.bw * 0.4, basis - g.bh * 0.05);
  ctx.lineTo(cx + g.bw * 0.4, basis - g.bh * 0.05);
  ctx.lineTo(cx + wiebel + g.bw * 0.25, basis - hoogte);
  ctx.lineTo(cx + wiebel, basis - hoogte - g.bh * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ff7a00';
  ctx.fillRect(cx - g.bw * 0.4, basis - g.bh * 0.12, g.bw * 0.8, g.bh * 0.05);
}

function kerstmuts(ctx, g, t) {
  const cx = g.x + g.bw * 0.5;
  const hoogte = g.bh * (g.bukken ? 0.4 : 0.3);
  const wiebel = Math.sin(t / 300) * g.bw * 0.05;
  const basis = g.top;
  ctx.fillStyle = '#d3162f';
  ctx.beginPath();
  ctx.moveTo(cx - g.bw * 0.4, basis);
  ctx.lineTo(cx + g.bw * 0.4, basis);
  ctx.lineTo(cx + wiebel + g.bw * 0.45, basis - hoogte);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - g.bw * 0.45, basis - g.bh * 0.05, g.bw * 0.9, g.bh * 0.05);
  ctx.beginPath();
  ctx.arc(cx + wiebel + g.bw * 0.45, basis - hoogte, Math.max(1.5, g.bw * 0.1), 0, Math.PI * 2);
  ctx.fill();
}

function pompoenlogo(ctx, g) {
  const r = Math.max(2, g.bw * 0.14);
  ctx.fillStyle = '#ff7a00';
  ctx.beginPath();
  ctx.arc(g.x + g.bw * 0.62, g.y - g.bh * 0.35, r, 0, Math.PI * 2);
  ctx.fill();
}

export const EXTRAS = { heksenhoed, kerstmuts, pompoenlogo };

// ---- Tekenen ----

const BUK_H = 0.55;
const BUK_B = 1.7;

function bliksemPad(ctx, fx, fy, fw, fh) {
  ctx.beginPath();
  ctx.moveTo(fx + fw * 0.62, fy + fh * 0.12);
  ctx.lineTo(fx + fw * 0.22, fy + fh * 0.55);
  ctx.lineTo(fx + fw * 0.48, fy + fh * 0.55);
  ctx.lineTo(fx + fw * 0.36, fy + fh * 0.88);
  ctx.lineTo(fx + fw * 0.8, fy + fh * 0.42);
  ctx.lineTo(fx + fw * 0.54, fy + fh * 0.42);
  ctx.closePath();
  ctx.fill();
}

export function tekenPaal(ctx, skin, { x, y, breedte, hoogte, bukken = false, t = 0 }) {
  const bw = bukken ? breedte * BUK_B : breedte;
  const bh = bukken ? hoogte * BUK_H : hoogte;
  const top = y - bh;

  ctx.save();
  ctx.fillStyle = skin.behuizing;
  ctx.fillRect(x, top, bw, bh);

  // Faceplate linksboven: ca. 1/5 van de breedte, 1/4 van de hoogte.
  const fw = Math.max(2, bw * 0.2);
  const fh = bh * 0.25;
  const fx = x + bw * 0.1;
  const fy = top + bh * 0.08;
  ctx.fillStyle = skin.faceplate;
  ctx.fillRect(fx, fy, fw, fh);
  ctx.fillStyle = skin.bliksem;
  bliksemPad(ctx, fx, fy, fw, fh);

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
