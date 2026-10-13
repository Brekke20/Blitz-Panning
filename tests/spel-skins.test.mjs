import test from 'node:test';
import assert from 'node:assert/strict';
import { snelheidBij, SNELHEID, SCORE_PER_EENHEID } from '../public/js/spel/spel-logica.js';
import { SKINS, tekenPaal, standaardSkin, vrijgespeeld, HEMEL, RAND_KLEUR } from '../public/js/spel/skins.js';

const HEX = /^#[0-9a-f]{6}$/i;

function opnemer() {
  const pts = [];
  const ctx = {
    punten: pts,
    fillRect(x, y, w, h) { pts.push([x, y], [x + w, y + h]); },
    strokeRect() {},
    moveTo(x, y) { pts.push([x, y]); },
    lineTo(x, y) { pts.push([x, y]); },
    quadraticCurveTo(cx, cy, x, y) { pts.push([cx, cy], [x, y]); },
    arc(x, y, r) { pts.push([x - r, y - r], [x + r, y + r]); },
  };
  for (const m of ['save', 'restore', 'beginPath', 'closePath', 'fill', 'stroke']) ctx[m] = () => {};
  return ctx;
}
function bbox(ctx) {
  const xs = ctx.punten.map((p) => p[0]);
  const ys = ctx.punten.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

test('unieke ids en geldige kleuren', () => {
  assert.equal(new Set(SKINS.map((s) => s.id)).size, SKINS.length);
  for (const s of SKINS) for (const k of ['faceplate', 'behuizing', 'bliksem']) assert.match(s[k], HEX, `${s.id}.${k}`);
});

test('basis: 10 skins met oplopende drempels vanaf 0', () => {
  const basis = SKINS.filter((s) => s.soort === 'basis');
  assert.equal(basis.length, 10);
  assert.equal(basis[0].drempel, 0);
  for (let i = 1; i < basis.length; i++) assert.ok(basis[i].drempel > basis[i - 1].drempel);
});

test('precies 1 goud met hoogste drempel; precies 1 halloween', () => {
  const goud = SKINS.filter((s) => s.soort === 'goud');
  assert.equal(goud.length, 1);
  assert.ok(SKINS.filter((s) => s !== goud[0] && s.drempel !== undefined).every((s) => s.drempel < goud[0].drempel));
  assert.equal(SKINS.filter((s) => s.eventId === 'halloween').length, 1);
  assert.ok(SKINS.filter((s) => s.soort === 'event').every((s) => s.eventId));
});

test('standaardSkin is vrij bij score 0', () => {
  const s = SKINS.find((k) => k.id === standaardSkin());
  assert.ok(s);
  assert.equal(vrijgespeeld(s, { besteScore: 0, eventSkins: [] }), true);
});

test('vrijgespeeld-regels', () => {
  const o = SKINS.find((s) => s.id === 'olijf');
  assert.equal(vrijgespeeld(o, { besteScore: 499, eventSkins: [] }), false);
  assert.equal(vrijgespeeld(o, { besteScore: 500, eventSkins: [] }), true);
  const g = SKINS.find((s) => s.soort === 'goud');
  assert.equal(vrijgespeeld(g, { besteScore: g.drempel - 1, eventSkins: [] }), false);
  assert.equal(vrijgespeeld(g, { besteScore: g.drempel, eventSkins: [] }), true);
  const h = SKINS.find((s) => s.eventId === 'halloween');
  assert.equal(vrijgespeeld(h, { besteScore: 99999, eventSkins: [] }), false);
  assert.equal(vrijgespeeld(h, { besteScore: 0, eventSkins: ['halloween'] }), true);
});

test('tekenPaal: elke skin, beide houdingen; bukken is breder en lager', () => {
  for (const s of SKINS) {
    for (const t of [0, 777, 5000]) {
      const a = opnemer();
      const b = opnemer();
      const p = { x: 100, y: 200, breedte: 14, hoogte: 56, t };
      assert.doesNotThrow(() => tekenPaal(a, s, { ...p, bukken: false }));
      assert.doesNotThrow(() => tekenPaal(b, s, { ...p, bukken: true }));
      const A = bbox(a);
      const B = bbox(b);
      assert.ok(B.x1 - B.x0 > A.x1 - A.x0, `${s.id} breder`);
      assert.ok(B.y0 > A.y0, `${s.id} lager`);
      assert.ok(B.y1 <= 200.001 && A.y1 <= 200.001, `${s.id} blijft op de grond`);
    }
  }
});

// ---- Contrast (I2): de paal moet bij élke skin duidelijk zichtbaar zijn tegen de nachthemel ----
const lum = (hex) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('de contour van elke skin heeft minstens 3:1 contrast met beide uiteinden van de hemel', () => {
  for (const s of SKINS) {
    const rand = s.rand ?? RAND_KLEUR;
    for (const hemel of [HEMEL.boven, HEMEL.onder]) {
      assert.ok(contrast(rand, hemel) >= 3, `${s.id}: contour ${rand} tegen ${hemel} = ${contrast(rand, hemel).toFixed(2)}`);
    }
  }
});

test('tekenPaal tekent een contour rond de behuizing met de randkleur (elke skin)', () => {
  for (const s of SKINS) {
    const ctx = opnemer();
    const gezien = [];
    ctx.strokeRect = () => gezien.push(ctx.strokeStyle);
    tekenPaal(ctx, s, { x: 50, y: 150, breedte: 24, hoogte: 44, t: 0 });
    assert.ok(gezien.includes(s.rand ?? RAND_KLEUR), s.id);
  }
});

// ---- Tempo van de ontgrendelingen (v2.1.1): verdiend, niet cadeau ----
// Seconden overleven om `score` te halen volgens de snelheidscurve (numeriek, stapjes van 10 ms).
function secondenVoor(score) {
  let afstand = 0; let t = 0;
  while (afstand * SCORE_PER_EENHEID < score) { afstand += snelheidBij(afstand) * 0.01; t += 0.01; }
  return t;
}

test('de drempels van alle skins met drempel stijgen strikt', () => {
  const lijst = SKINS.filter((s) => typeof s.drempel === 'number').map((s) => s.drempel);
  for (let i = 1; i < lijst.length; i++) assert.ok(lijst[i] > lijst[i - 1], `${lijst[i - 1]} < ${lijst[i]}`);
});

test('Klassiek Olijf vraagt minstens 40 s in één run; Gouden Paal ruim 4 minuten', () => {
  assert.ok(SNELHEID.max > SNELHEID.start);
  const olijf = SKINS.find((s) => s.id === 'olijf');
  const goud = SKINS.find((s) => s.soort === 'goud');
  assert.ok(secondenVoor(olijf.drempel) >= 40, `olijf ${secondenVoor(olijf.drempel)} s`);
  assert.ok(secondenVoor(goud.drempel) >= 240 && secondenVoor(goud.drempel) <= 330, `goud ${secondenVoor(goud.drempel)} s`);
});

test('tekenPaal: faceplate smal en staand in beide houdingen, de paal staat op de grond', () => {
  for (const bukken of [false, true]) {
    const ctx = opnemer();
    const rects = [];
    ctx.fillRect = (x, y, w, h) => rects.push({ x, y, w, h, kleur: ctx.fillStyle });
    tekenPaal(ctx, SKINS[0], { x: 56, y: 170, breedte: 18, hoogte: 52, bukken, t: 0 });
    const plaat = rects.find((r) => r.kleur === SKINS[0].faceplate);
    assert.ok(plaat.h > plaat.w * 2, `faceplate staand (bukken=${bukken})`);
    const behuizing = rects[0];
    assert.equal(Math.round(behuizing.y + behuizing.h), 170);
    assert.ok(plaat.x >= behuizing.x && plaat.x + plaat.w <= behuizing.x + behuizing.w, 'faceplate binnen de paal');
    assert.ok(plaat.y >= behuizing.y && plaat.y + plaat.h <= behuizing.y + behuizing.h, 'faceplate binnen de paal');
    assert.equal(Math.round(behuizing.w), bukken ? 32 : 18);
    assert.equal(Math.round(behuizing.h), bukken ? 30 : 52);
  }
});
