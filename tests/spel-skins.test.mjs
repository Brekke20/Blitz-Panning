import test from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, tekenPaal, standaardSkin, vrijgespeeld } from '../public/js/spel/skins.js';

const HEX = /^#[0-9a-f]{6}$/i;

function opnemer() {
  const pts = [];
  const ctx = {
    punten: pts,
    fillRect(x, y, w, h) { pts.push([x, y], [x + w, y + h]); },
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
  assert.equal(vrijgespeeld(o, { besteScore: 249, eventSkins: [] }), false);
  assert.equal(vrijgespeeld(o, { besteScore: 250, eventSkins: [] }), true);
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
