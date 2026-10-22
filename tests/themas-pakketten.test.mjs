// tests/themas-pakketten.test.mjs — de voorgeladen themapakketten (netlify/themas): Halloween en Kerst.
// Elk pakket moet door de validator (kern/themapakket-validatie.js) en blijft gelijk aan wat de app nu hardcode toont.
// Alles waarmee vergeleken wordt dat een latere taak uit de code schrapt (de SVG-constanten van evenement-laag.js, de scène van
// evenement-scene.js, de skins en canvas-extra's van spel/skins.js, LEGE_TEKSTEN) staat hieronder als vastgelegde kopie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VOORGELADEN } from '../netlify/themas/pakketten.js';
import { valideerPakket, contrastVerhouding, MAX_PAKKET_BYTES } from '../public/js/kern/themapakket-validatie.js';

const pakket = (id) => VOORGELADEN.find((p) => p.id === id);
const halloween = () => pakket('halloween');
const kerst = () => pakket('kerst');

// ---- Vastgelegde kopieën ----

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): evenement-laag.js:23-25
const WEB = '<path d="M0 0H100M0 0L90 40M0 0L70 70M0 0L40 90M0 0V100"/><path d="M22 0Q20 18 0 22M45 0Q40 40 0 45M70 0Q60 60 0 70M95 0Q80 80 0 95"/>';
const SPIN = '<ellipse cx="12" cy="13" rx="4" ry="5"/><circle cx="12" cy="7.5" r="2.6"/><path d="M8 11L2 7M8 13L1 13M8 15L2 20M9 17L5 23M16 11L22 7M16 13L23 13M16 15L22 20M15 17L19 23" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>';
const VLEERMUIS = '<path d="M16 17c-2-3-4-6-9-7 1 2 1 4 0 6-2-1-5 0-7 2 3 0 5 1 6 3 1-1 3-1 4 1 1-2 3-3 6-3 3 0 5 1 6 3 1-2 3-2 4-1 1-2 3-3 6-3-2-2-5-3-7-2-1-2-1-4 0-6-5 1-7 4-9 7z" transform="translate(4 3)"/>';

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): aantal tekenelementen van sceneSvg() in evenement-scene.js,
// met de vier `<use href="#ev-vv">` uitgeschreven (per vogelverschrikker 1 cirkel, 3 paden en 2 rechthoeken).
const SCENE_AANTALLEN = { circle: 57, path: 25, rect: 28, ellipse: 0, polygon: 0, line: 0 };

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): LEGE_TEKSTEN.halloween in kern/versiering-logica.js
const HALLOWEEN_TEKSTEN = { wachtrijLeeg: 'Geen spoken in de wachtrij.', ingeplandLeeg: 'Geen spookbezoeken gepland deze week' };

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): de event-skins in spel/skins.js
const HALLOWEEN_SKIN = { naam: 'Spookpaal', faceplate: '#ff7a00', behuizing: '#1b0f26', bliksem: '#1b0f26', extra: 'heksenhoed' };
const KERST_SKIN = { naam: 'Kerstpaal', faceplate: '#c8102e', behuizing: '#0f3d22', bliksem: '#ffffff', extra: 'kerstmuts' };

// karakterisering van v2.2.0 (bron wordt in een latere taak geschrapt): de canvascode van `heksenhoed` en `kerstmuts` in spel/skins.js,
// uitgevoerd met bw = bh = 100, x = 0, top = 0, t = 0 en niet bukkend (dus eenheden = procent van de paal). Opgenomen aanroepen:
//   heksenhoed: fillStyle #2a1840, strokeStyle #e9f2f8, lineWidth 1.2; fillRect+strokeRect(-10,-5,120,5);
//               vlak (10,-5) (90,-5) (75,-38) (50,-42) met vulling en lijn; fillStyle #ff7a00, fillRect(10,-12,80,5)
//   kerstmuts:  fillStyle #d3162f; moveTo(5,-3) quad(10,-39.8 -> 70,-35) quad(107,-33.4 -> 112,-20.6) quad(90,-19 -> 95,-3) sluiten, vullen;
//               fillStyle #ffffff, fillRect(0,-6,100,7.8); cirkel (112,-20.6) met straal 11
const HEKSENHOED_DELEN = [
  { soort: 'path', d: 'M-10 -5H110V0H-10Z', vul: '#2a1840', lijn: '#e9f2f8', lijnDikte: 1.2 },
  { soort: 'path', d: 'M10 -5L90 -5L75 -38L50 -42Z', vul: '#2a1840', lijn: '#e9f2f8', lijnDikte: 1.2 },
  { soort: 'path', d: 'M10 -12H90V-7H10Z', vul: '#ff7a00' },
];
const KERSTMUTS_KEGEL = 'M5 -3Q10 -39.8 70 -35Q107 -33.4 112 -20.6Q90 -19 95 -3Z';
const KERSTMUTS_PELS = 'M0 -6H100V1.8H0Z';

// ---- Hulpen ----

// Telt de tekenende delen (geen groepen) per soort, groepen worden doorlopen.
function tel(delen, uit = { circle: 0, path: 0, rect: 0, ellipse: 0, polygon: 0, line: 0 }) {
  for (const d of delen) {
    if (d.soort === 'groep') tel(d.delen, uit);
    else uit[d.soort] += 1;
  }
  return uit;
}
function alleDelen(delen) {
  return delen.flatMap((d) => (d.soort === 'groep' ? alleDelen(d.delen) : [d]));
}
// Leest een rij `<tag a="b" .../>` uit een SVG-fragment als [{ tag, attrs }].
function leesTags(html) {
  return [...html.matchAll(/<(\w+)([^>]*)\/>/g)].map(([, tag, rest]) => ({
    tag,
    attrs: Object.fromEntries([...rest.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])),
  }));
}
const GEOMETRIE = { path: ['d'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'] };
// Controleert dat de delen van een vorm dezelfde meetkunde (en eventuele lijndikte en transformatie) hebben als de oude SVG-tekst.
function vergelijkMetOudeSvg(vorm, html) {
  const tags = leesTags(html);
  assert.equal(vorm.delen.length, tags.length, 'evenveel delen als de oude tekening');
  tags.forEach(({ tag, attrs }, i) => {
    const deel = vorm.delen[i];
    assert.equal(deel.soort, tag, `deel ${i}: soort`);
    for (const sleutel of GEOMETRIE[tag]) {
      const verwacht = sleutel === 'd' ? attrs.d : Number(attrs[sleutel]);
      assert.equal(deel[sleutel], verwacht, `deel ${i}: ${sleutel}`);
    }
    if (attrs['stroke-width']) assert.equal(deel.lijnDikte, Number(attrs['stroke-width']), `deel ${i}: lijnDikte`);
    if (attrs.transform) assert.equal(deel.transform, attrs.transform, `deel ${i}: transform`);
  });
}

// ---- Alle voorgeladen pakketten ----

test('VOORGELADEN is een bevroren lijst en bevat Halloween en Kerst', () => {
  assert.ok(Array.isArray(VOORGELADEN));
  assert.ok(Object.isFrozen(VOORGELADEN));
  assert.ok(halloween(), 'halloween ontbreekt');
  assert.ok(kerst(), 'kerst ontbreekt');
});

test('elk voorgeladen pakket is geldig en blijft onder 512 kB', () => {
  for (const p of VOORGELADEN) {
    const r = valideerPakket(p);
    assert.equal(r.ok, true, `${p.id}: ${JSON.stringify(r.fouten)}`);
    assert.ok(JSON.stringify(p).length <= MAX_PAKKET_BYTES, `${p.id} is te groot`);
  }
});

test('de id van elk voorgeladen pakket is uniek en gelijk aan de bestandsnaam', async () => {
  const ids = VOORGELADEN.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const { readdirSync } = await import('node:fs');
  const bestanden = readdirSync(new URL('../netlify/themas/', import.meta.url)).filter((f) => f.endsWith('.blitzthema.json')).sort();
  assert.deepEqual(bestanden, ids.map((id) => `${id}.blitzthema.json`).sort());
});

// ---- Halloween ----

test('Halloween: periode, kleuren en voorkeurthema zoals nu', () => {
  const p = halloween();
  assert.equal(p.naam, 'Halloween');
  assert.deepEqual(p.periode, { van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 } });
  assert.equal(p.kleuren.donker.accent, '#f97316');
  assert.equal(p.kleuren.licht.accent, '#c2570c');
  assert.equal(p.kleuren.voorkeurThema, 'donker');
});

test('Halloween: de versiering is hoek (web, 4 hoeken), hangen, kruipen, vliegen en mist', () => {
  assert.deepEqual(halloween().versiering, [
    { beweging: 'hoek', beeld: 'web', hoeken: ['lb', 'rb', 'lo', 'ro'] },
    { beweging: 'hangen', beeld: 'spin', aantal: 2 },
    { beweging: 'kruipen', beeld: 'spin', aantal: 1, langs: 'tabbalk' },
    { beweging: 'vliegen', beeld: 'vleermuis', aantal: 1 },
    { beweging: 'mist' },
  ]);
});

test('Halloween: de lege teksten zijn die van v2.2.0', () => {
  assert.deepEqual(halloween().teksten, HALLOWEEN_TEKSTEN);
});

test('Halloween: de spelskin heeft de kleuren van de huidige skin en de heksenhoed als extra', () => {
  assert.deepEqual(halloween().spelskin, HALLOWEEN_SKIN);
  assert.ok(halloween().vormen.heksenhoed, 'de vorm heksenhoed ontbreekt');
});

test('Halloween: de vormen web, spin en vleermuis hebben exact de padstrings van v2.2.0', () => {
  const { vormen } = halloween();
  vergelijkMetOudeSvg(vormen.web, WEB);
  vergelijkMetOudeSvg(vormen.spin, SPIN);
  vergelijkMetOudeSvg(vormen.vleermuis, VLEERMUIS);
  assert.equal(vormen.web.viewBox, '0 0 100 100');
  assert.equal(vormen.spin.viewBox, '0 0 24 24');
  assert.equal(vormen.vleermuis.viewBox, '0 0 40 26');
});

test('Halloween: de web is een lijntekening zonder vulling, de spin heeft pootjes als lijn', () => {
  const { web, spin } = halloween().vormen;
  for (const d of web.delen) { assert.equal(d.vul, 'geen'); assert.equal(d.lijnDikte, 1); assert.ok(d.lijn); }
  const poten = spin.delen.find((d) => d.soort === 'path');
  assert.equal(poten.vul, 'geen');
  assert.ok(poten.lijn);
});

test('Halloween: de vorm scene telt evenveel cirkels, paden en rechthoeken als sceneSvg() van v2.2.0', () => {
  const { scene } = halloween().vormen;
  assert.deepEqual(tel(scene.delen), SCENE_AANTALLEN);
  assert.equal(scene.viewBox, '0 0 1600 900');
});

test('Halloween: de scène schrijft de vier vogelverschrikkers uit als groepen met dezelfde transformatie', () => {
  const groepen = halloween().vormen.scene.delen.filter((d) => d.soort === 'groep');
  const verschrikkers = groepen.filter((g) => g.delen.length === 6);
  assert.deepEqual(verschrikkers.map((g) => g.transform), [
    'translate(250 790) rotate(-4) scale(0.95)',
    'translate(560 765) rotate(3) scale(0.75)',
    'translate(1010 770) rotate(-3) scale(0.8)',
    'translate(1420 790) rotate(4) scale(1.05)',
  ]);
  for (const g of verschrikkers) assert.deepEqual(tel(g.delen), { circle: 1, path: 3, rect: 2, ellipse: 0, polygon: 0, line: 0 });
});

test('Halloween: de scène heeft de lucht en twee gloeden als verloop, en de achtergrondinstellingen kloppen', () => {
  const p = halloween();
  const verlopen = alleDelen(p.vormen.scene.delen).filter((d) => d.vul && typeof d.vul === 'object');
  assert.deepEqual(verlopen.map((d) => d.vul.verloop), ['lineair', 'radiaal', 'radiaal']);
  assert.deepEqual(p.achtergrond, { vorm: 'scene', kijkvensterStaand: '820 0 780 900', dekkingLicht: 0.2 });
});

test('Halloween: de heksenhoed is opgebouwd uit paden met de kleuren van de canvascode', () => {
  const { heksenhoed } = halloween().vormen;
  assert.deepEqual(heksenhoed.delen, HEKSENHOED_DELEN);
});

// ---- Kerst ----

test('Kerst: periode 7/12 tot 31/12 en een accent dat op beide achtergronden afsteekt', () => {
  const p = kerst();
  assert.equal(p.naam, 'Kerst');
  assert.deepEqual(p.periode, { van: { maand: 12, dag: 7 }, tot: { maand: 12, dag: 31 } });
  for (const [modus, achtergrond] of [['donker', '#181e24'], ['licht', '#f5f6f7']]) {
    const accent = p.kleuren[modus].accent;
    for (const bg of ['#181e24', '#f5f6f7']) {
      assert.ok(contrastVerhouding(accent, bg) >= 3, `${modus}.accent ${accent} tegen ${bg}`);
    }
    assert.ok(contrastVerhouding(accent, achtergrond) >= 3);
  }
});

test('Kerst: vallen (sneeuwvlok), hangen (kerstbal, 2) en vliegen (rendier, 1)', () => {
  const { versiering, vormen } = kerst();
  assert.deepEqual(versiering.map((e) => e.beweging), ['vallen', 'hangen', 'vliegen']);
  assert.equal(versiering[0].beeld, 'sneeuwvlok');
  assert.deepEqual(versiering[1], { beweging: 'hangen', beeld: 'kerstbal', aantal: 2 });
  assert.deepEqual(versiering[2], { beweging: 'vliegen', beeld: 'rendier', aantal: 1 });
  for (const naam of ['sneeuwvlok', 'kerstbal', 'rendier']) assert.ok(vormen[naam], `vorm ${naam} ontbreekt`);
});

test('Kerst: de spelskin heeft de kleuren van de huidige skin en de kerstmuts als extra', () => {
  assert.deepEqual(kerst().spelskin, KERST_SKIN);
});

test('Kerst: de kerstmuts is opgebouwd uit paden met de kleuren van de canvascode', () => {
  const { delen } = kerst().vormen.kerstmuts;
  assert.equal(delen.length, 3);
  assert.deepEqual(delen[0], { soort: 'path', d: KERSTMUTS_KEGEL, vul: '#d3162f' });
  assert.deepEqual(delen[1], { soort: 'path', d: KERSTMUTS_PELS, vul: '#ffffff' });
  // De pompon is een cirkel met straal 11 % van de breedte: in de eenheden van de box een ellips (de paal is 18 breed en 52 hoog).
  assert.equal(delen[2].soort, 'path');
  assert.equal(delen[2].vul, '#ffffff');
  assert.match(delen[2].d, /^M123 -20\.6A11 3\.8 0 1 0 101 -20\.6A11 3\.8 0 1 0 123 -20\.6Z$/);
});

test('beide skins gebruiken enkel paden in hun extra (zo kan het spel ze met Path2D tekenen)', () => {
  for (const [p, extra] of [[halloween(), 'heksenhoed'], [kerst(), 'kerstmuts']]) {
    const delen = p.vormen[extra].delen;
    assert.ok(delen.every((d) => d.soort === 'path'), `${extra}: enkel paden`);
  }
});
