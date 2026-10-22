import test from 'node:test';
import assert from 'node:assert/strict';
import { snelheidBij, SNELHEID, SCORE_PER_EENHEID } from '../public/js/spel/spel-logica.js';
import { SKINS, BASIS_SKINS, themaSkins, alleSkins, tekenPaal, standaardSkin, vrijgespeeld, HEMEL, RAND_KLEUR } from '../public/js/spel/skins.js';
import { BASIS_SKIN_IDS } from '../public/js/spel/skin-kleuren.js';
import { VOORGELADEN } from '../netlify/themas/pakketten.js';

// Node kent geen Path2D: een nepklasse die enkel onthoudt wat ermee gebeurt (tekst `d`, samengevoegde paden + matrix) en telt
// hoeveel er gemaakt worden (de extra mag per beeld niets nieuws maken: ze worden per skin en maat eenmalig gebouwd).
class NepPath2D {
  static aantal = 0;
  constructor(d) { NepPath2D.aantal++; this.d = d ?? null; this.delen = []; }
  addPath(pad, matrix) { this.delen.push({ pad, matrix }); }
}
globalThis.Path2D = NepPath2D;

const THEMA = themaSkins(VOORGELADEN);
const ALLE = alleSkins(VOORGELADEN);

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
  ctx.vullingen = [];
  ctx.streken = [];
  ctx.verplaatsingen = [];
  ctx.translate = (x, y) => ctx.verplaatsingen.push([x, y]);
  ctx.fill = (pad) => { if (pad) ctx.vullingen.push({ pad, kleur: ctx.fillStyle, dekking: ctx.globalAlpha }); };
  ctx.stroke = (pad) => { if (pad) ctx.streken.push({ pad, kleur: ctx.strokeStyle, dikte: ctx.lineWidth, dekking: ctx.globalAlpha }); };
  for (const m of ['save', 'restore', 'beginPath', 'closePath']) ctx[m] = () => {};
  return ctx;
}
function bbox(ctx) {
  const xs = ctx.punten.map((p) => p[0]);
  const ys = ctx.punten.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

test('unieke ids en geldige kleuren (basis, goud en alle themaskins)', () => {
  assert.equal(new Set(ALLE.map((s) => s.id)).size, ALLE.length);
  for (const s of ALLE) for (const k of ['faceplate', 'behuizing', 'bliksem']) assert.match(s[k], HEX, `${s.id}.${k}`);
});

test('SKINS blijft een alias van BASIS_SKINS (tien basis + goud) en BASIS_SKIN_IDS komt uit skin-kleuren.js', () => {
  assert.equal(SKINS, BASIS_SKINS);
  assert.equal(BASIS_SKINS.length, 11);
  assert.deepEqual([...BASIS_SKIN_IDS].sort(), BASIS_SKINS.map((s) => s.id).sort());
  assert.ok(BASIS_SKINS.every((s) => s.soort === 'basis' || s.soort === 'goud'), 'geen event- of themaskins meer in de code');
});

test('basis: 10 skins met oplopende drempels vanaf 0', () => {
  const basis = SKINS.filter((s) => s.soort === 'basis');
  assert.equal(basis.length, 10);
  assert.equal(basis[0].drempel, 0);
  for (let i = 1; i < basis.length; i++) assert.ok(basis[i].drempel > basis[i - 1].drempel);
});

// Bewust gewijzigd (taak 8, themaskins uit pakketten): de oude assert "precies 1 halloween" (event-skin in de code) vervalt;
// de event-skins verhuisden naar de pakketten en zijn nu themaskins met het thema-id als skin-id.
test('precies 1 goud met hoogste drempel; elke themaskin komt uit een pakket en heeft het thema-id', () => {
  const goud = SKINS.filter((s) => s.soort === 'goud');
  assert.equal(goud.length, 1);
  assert.ok(SKINS.filter((s) => s !== goud[0] && s.drempel !== undefined).every((s) => s.drempel < goud[0].drempel));
  assert.equal(THEMA.length, VOORGELADEN.length);
  assert.deepEqual(THEMA.map((s) => s.id), VOORGELADEN.map((p) => p.id));
  assert.ok(THEMA.every((s) => s.soort === 'thema' && s.drempel === undefined));
  assert.equal(THEMA.filter((s) => s.id === 'halloween').length, 1);
  assert.equal(THEMA.find((s) => s.id === 'halloween').naam, 'Spookpaal');
  assert.equal(THEMA.find((s) => s.id === 'kerst').naam, 'Kerstpaal');
});

test('themaSkins: kleuren en naam uit spelskin, themanaam uit het pakket, vorm van de extra; een pakket zonder spelskin valt weg', () => {
  const h = VOORGELADEN.find((p) => p.id === 'halloween');
  const s = themaSkins([h])[0];
  assert.equal(s.faceplate, h.spelskin.faceplate);
  assert.equal(s.behuizing, h.spelskin.behuizing);
  assert.equal(s.bliksem, h.spelskin.bliksem);
  assert.equal(s.themaNaam, h.naam);
  assert.equal(s.extraVorm, h.vormen[h.spelskin.extra]);
  assert.deepEqual(themaSkins([{ id: 'zonder', naam: 'Zonder', vormen: {} }, null, 'x']), []);
  assert.deepEqual(themaSkins(undefined), []);
  // Ook een kaart id -> pakket (zoals themasNu().pakketten) kan.
  assert.equal(themaSkins({ halloween: h }).length, 1);
  assert.deepEqual(alleSkins([]), [...BASIS_SKINS]);
  assert.deepEqual(alleSkins(VOORGELADEN).slice(0, BASIS_SKINS.length), [...BASIS_SKINS]);
});

test('standaardSkin is vrij bij score 0', () => {
  const s = SKINS.find((k) => k.id === standaardSkin());
  assert.ok(s);
  assert.equal(vrijgespeeld(s, { besteScore: 0, actieveThemaIds: [] }), true);
});

test('vrijgespeeld-regels', () => {
  const o = SKINS.find((s) => s.id === 'olijf');
  assert.equal(vrijgespeeld(o, { besteScore: 499, actieveThemaIds: [] }), false);
  assert.equal(vrijgespeeld(o, { besteScore: 500, actieveThemaIds: [] }), true);
  const g = SKINS.find((s) => s.soort === 'goud');
  assert.equal(vrijgespeeld(g, { besteScore: g.drempel - 1, actieveThemaIds: [] }), false);
  assert.equal(vrijgespeeld(g, { besteScore: g.drempel, actieveThemaIds: [] }), true);
  const h = THEMA.find((s) => s.id === 'halloween');
  assert.equal(vrijgespeeld(h, { besteScore: 99999, actieveThemaIds: [] }), false);
  assert.equal(vrijgespeeld(h, { besteScore: 0, actieveThemaIds: ['halloween'] }), true);
  assert.equal(vrijgespeeld(h, { besteScore: 0, actieveThemaIds: ['kerst'] }), false);
});

test('tekenPaal: elke skin (ook themaskins), beide houdingen; bukken is breder en lager', () => {
  for (const s of ALLE) {
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

// Bewust gewijzigd (taak 8): de event-skins staan nu als themaskins in de pakketten; elke themaskin uit VOORGELADEN haalt het contrast.
test('de contour van elke skin (basis, goud en elke themaskin uit VOORGELADEN) heeft minstens 3:1 contrast met beide uiteinden van de hemel', () => {
  for (const s of ALLE) {
    const rand = s.rand ?? RAND_KLEUR;
    for (const hemel of [HEMEL.boven, HEMEL.onder]) {
      assert.ok(contrast(rand, hemel) >= 3, `${s.id}: contour ${rand} tegen ${hemel} = ${contrast(rand, hemel).toFixed(2)}`);
    }
  }
});

test('tekenPaal tekent een contour rond de behuizing met de randkleur (elke skin)', () => {
  for (const s of ALLE) {
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

// ---- Extra's uit de pakketten (Path2D, eenmalig gebouwd) ----

test('tekenPaal: een themaskin tekent zijn extra met Path2D, in eenheden van de paal (a = bw/100, d = bh/100) en op de bovenkant van de paal', () => {
  const h = THEMA.find((s) => s.id === 'halloween');
  const ctx = opnemer();
  tekenPaal(ctx, h, { x: 56, y: 170, breedte: 18, hoogte: 52, bukken: false, t: 0 });
  // 3 delen in de heksenhoed: 3 vullingen (alle drie hebben `vul`), 2 strepen (de hoedrand en de kegel hebben `lijn`).
  assert.equal(ctx.vullingen.length, 3);
  assert.equal(ctx.streken.length, 2);
  assert.deepEqual(ctx.verplaatsingen.at(-1), [56, 170 - 52], 'de oorsprong van de extra is de linkerbovenhoek van de paal');
  const eerste = ctx.vullingen[0];
  assert.equal(eerste.kleur, '#2a1840');
  assert.equal(eerste.pad.delen.length, 1);
  assert.equal(eerste.pad.delen[0].pad.d, 'M-10 -5H110V0H-10Z');
  assert.equal(eerste.pad.delen[0].matrix.a, 18 / 100);
  assert.equal(eerste.pad.delen[0].matrix.d, 52 / 100);
  assert.equal(ctx.streken[0].kleur, '#e9f2f8');
  assert.equal(ctx.streken[0].dikte, 1.2, 'lijnDikte is in schermpixels: niet geschaald');
});

test('tekenPaal: bukken schaalt de extra mee met de platgedrukte paal (breder en lager), de kleuren blijven', () => {
  const k = THEMA.find((s) => s.id === 'kerst');
  const staand = opnemer();
  const bukkend = opnemer();
  const p = { x: 56, y: 170, breedte: 18, hoogte: 52, t: 0 };
  tekenPaal(staand, k, { ...p, bukken: false });
  tekenPaal(bukkend, k, { ...p, bukken: true });
  const a = staand.vullingen[0].pad.delen[0].matrix;
  const b = bukkend.vullingen[0].pad.delen[0].matrix;
  assert.ok(b.a > a.a && b.d < a.d);
  assert.ok(Math.abs(b.a - (18 * 32 / 18) / 100) < 1e-9 && Math.abs(b.d - (52 * 30 / 52) / 100) < 1e-9);
  assert.deepEqual(staand.vullingen.map((v) => v.kleur), bukkend.vullingen.map((v) => v.kleur));
});

test('tekenPaal: de extra maakt per beeld geen nieuwe Path2D (eenmalig per skin en maat, ook na wissel staan/bukken)', () => {
  const k = THEMA.find((s) => s.id === 'kerst');
  const ctx = opnemer();
  const p = { x: 56, y: 170, breedte: 18, hoogte: 52 };
  tekenPaal(ctx, k, { ...p, bukken: false, t: 0 });
  tekenPaal(ctx, k, { ...p, bukken: true, t: 16 });
  const na = NepPath2D.aantal;
  for (let i = 0; i < 200; i++) tekenPaal(ctx, k, { ...p, y: 170 - (i % 40), bukken: i % 3 === 0, t: i * 16 });
  assert.equal(NepPath2D.aantal, na, 'geen nieuwe Path2D tijdens het spelen');
  // Een nieuw skinobject van hetzelfde pakket (themaSkins bij elke aanroep) hergebruikt de bouwsels.
  const opnieuw = themaSkins(VOORGELADEN).find((s) => s.id === 'kerst');
  tekenPaal(ctx, opnieuw, { ...p, bukken: false, t: 0 });
  assert.equal(NepPath2D.aantal, na);
});

test('tekenPaal: andere deelsoorten van een extra worden een pad (cirkel en ellips met twee bogen, rechthoek en veelhoek met M/L/Z, lijn als streep); transform wordt in de matrix verwerkt', () => {
  const vorm = {
    viewBox: '0 -50 100 50',
    delen: [
      { soort: 'circle', cx: 10, cy: -10, r: 5, vul: '#ff0000' },
      { soort: 'ellipse', cx: 50, cy: -10, rx: 8, ry: 4, vul: '#00ff00', dekking: 0.5 },
      { soort: 'rect', x: 0, y: -4, width: 20, height: 4, vul: '#0000ff' },
      { soort: 'polygon', points: '0,0 10,0 5,-8', vul: '#ffffff', lijn: '#000000', lijnDikte: 2 },
      { soort: 'line', x1: 0, y1: 0, x2: 10, y2: -10, lijn: '#abcdef', lijnDikte: 1 },
      { soort: 'path', d: 'M0 0L5 5', vul: '#123456', transform: 'translate(10 -20) scale(2)' },
      { soort: 'groep', transform: 'translate(5 5)', delen: [{ soort: 'path', d: 'M0 0L1 1', vul: '#654321' }] },
    ],
  };
  const skin = { id: 'proef', naam: 'Proef', soort: 'thema', behuizing: '#111111', faceplate: '#222222', bliksem: '#333333', extraVorm: vorm };
  const ctx = opnemer();
  tekenPaal(ctx, skin, { x: 0, y: 100, breedte: 100, hoogte: 100, bukken: false, t: 0 });
  const ds = [...ctx.vullingen, ...ctx.streken].map((v) => v.pad.delen[0].pad.d);
  assert.ok(ds.includes('M5 -10A5 5 0 1 0 15 -10A5 5 0 1 0 5 -10Z'), 'cirkel: twee bogen ' + ds.join('|'));
  assert.ok(ds.includes('M42 -10A8 4 0 1 0 58 -10A8 4 0 1 0 42 -10Z'), 'ellips: twee bogen');
  assert.ok(ds.includes('M0 -4H20V0H0Z'), 'rechthoek');
  assert.ok(ds.includes('M0 0L10 0L5 -8Z'), 'veelhoek');
  assert.ok(ds.includes('M0 0L10 -10'), 'lijn');
  const m = ctx.vullingen.find((v) => v.kleur === '#123456').pad.delen[0].matrix;
  assert.deepEqual([m.a, m.b, m.c, m.d, m.e, m.f], [2, 0, 0, 2, 10, -20]);
  const groep = ctx.vullingen.find((v) => v.kleur === '#654321').pad.delen[0].matrix;
  assert.deepEqual([groep.e, groep.f], [5, 5]);
  assert.equal(ctx.vullingen.find((v) => v.kleur === '#00ff00').dekking, 0.5);
  assert.equal(ctx.streken.find((v) => v.kleur === '#abcdef').dikte, 1);
  assert.equal(ctx.vullingen.some((v) => v.pad.delen[0].pad.d === 'M0 0L10 -10'), false, 'een lijn wordt nooit gevuld');
});

test('tekenPaal: met een kapotte vorm of zonder Path2D blijft de paal tekenbaar, zonder extra', () => {
  const h = THEMA.find((s) => s.id === 'halloween');
  const kapot = { ...h, extraVorm: { viewBox: '0 0 1 1', delen: [{ soort: 'path', d: 'M0 0', vul: 'geen' }, null, { soort: 'onbekend' }] } };
  assert.doesNotThrow(() => tekenPaal(opnemer(), kapot, { x: 56, y: 170, breedte: 18, hoogte: 52, t: 0 }));
  const bewaard = globalThis.Path2D;
  try {
    delete globalThis.Path2D;
    const ctx = opnemer();
    assert.doesNotThrow(() => tekenPaal(ctx, { ...h, extraVorm: { viewBox: h.extraVorm.viewBox, delen: [...h.extraVorm.delen] } }, { x: 56, y: 170, breedte: 18, hoogte: 52, t: 0 }));
    assert.equal(ctx.vullingen.length, 0);
  } finally { globalThis.Path2D = bewaard; }
});
