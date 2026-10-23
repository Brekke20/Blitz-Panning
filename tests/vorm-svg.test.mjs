// tests/vorm-svg.test.mjs — schermen/vorm-svg.js: een vorm (gegevens uit een themapakket) wordt een SVG-element, enkel via
// createElementNS en een vaste lijst attributen. Nooit innerHTML, href, style, on* of een element buiten de vaste soorten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { svgAttributen, lichtVariabelen, vormNaarSvg } from '../public/js/schermen/vorm-svg.js';
import { valideerPakket } from '../public/js/kern/themapakket-validatie.js';

const HALLOWEEN = valideerPakket(JSON.parse(fs.readFileSync(new URL('../netlify/themas/halloween.blitzthema.json', import.meta.url), 'utf8'))).pakket;
const namen = (lijst) => lijst.map(([n]) => n);

// Een minimale DOM: elementen onthouden hun naamruimte, attributen, kinderen en stijl-eigenschappen. innerHTML/outerHTML gooien,
// zodat een test faalt zodra de module het zou gebruiken.
function maakDom() {
  const gemaakt = [];
  const element = (ns, naam) => {
    const el = {
      ns, naam, attrs: new Map(), kinderen: [], stijl: new Map(),
      setAttribute(n, v) { this.attrs.set(n, String(v)); },
      getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; },
      appendChild(k) { this.kinderen.push(k); return k; },
      insertBefore(k) { this.kinderen.unshift(k); return k; },
      get firstChild() { return this.kinderen[0] ?? null; },
      style: { setProperty: (p, v) => el.stijl.set(p, String(v)) },
    };
    for (const verboden of ['innerHTML', 'outerHTML']) {
      Object.defineProperty(el, verboden, { get() { throw new Error(`${verboden} gelezen`); }, set() { throw new Error(`${verboden} gezet`); } });
    }
    gemaakt.push(el);
    return el;
  };
  return {
    gemaakt,
    createElementNS: (ns, naam) => element(ns, naam),
    createElement() { throw new Error('createElement (HTML) gebruikt voor SVG'); },
  };
}
function alle(el, uit = []) { uit.push(el); for (const k of el.kinderen) alle(k, uit); return uit; }

test('svgAttributen: geometrie en stijl van een pad', () => {
  const a = svgAttributen({ soort: 'path', d: 'M0 0L10 10', vul: '#ff0000', lijn: '#00ff00', lijnDikte: 1.5, dekking: 0.4, lijnEinde: 'rond', lijnHoek: 'schuin', transform: 'translate(4 3)' });
  assert.deepEqual(a, [
    ['d', 'M0 0L10 10'], ['fill', '#ff0000'], ['stroke', '#00ff00'], ['stroke-width', '1.5'], ['opacity', '0.4'],
    ['stroke-linecap', 'round'], ['stroke-linejoin', 'bevel'], ['transform', 'translate(4 3)'],
  ]);
});

test('svgAttributen: elke soort krijgt enkel zijn eigen geometrie', () => {
  assert.deepEqual(namen(svgAttributen({ soort: 'circle', cx: 1, cy: 2, r: 3, d: 'M0 0', x: 5 })), ['cx', 'cy', 'r']);
  assert.deepEqual(namen(svgAttributen({ soort: 'ellipse', cx: 1, cy: 2, rx: 3, ry: 4, width: 9 })), ['cx', 'cy', 'rx', 'ry']);
  assert.deepEqual(namen(svgAttributen({ soort: 'rect', x: 0, y: 0, width: 5, height: 6, rx: 1, ry: 2 })), ['x', 'y', 'width', 'height', 'rx', 'ry']);
  assert.deepEqual(namen(svgAttributen({ soort: 'polygon', points: '0,0 1,1 2,0' })), ['points']);
  assert.deepEqual(namen(svgAttributen({ soort: 'line', x1: 0, y1: 0, x2: 1, y2: 1 })), ['x1', 'y1', 'x2', 'y2']);
  assert.deepEqual(svgAttributen({ soort: 'groep', transform: 'rotate(60 12 12)' }), [['transform', 'rotate(60 12 12)']]);
});

test('svgAttributen: onload, href, style, xlink:href en andere vreemde sleutels komen er nooit uit', () => {
  const kwaad = {
    soort: 'path', d: 'M0 0', vul: '#000000',
    onload: 'alert(1)', onclick: 'x()', href: 'javascript:alert(1)', 'xlink:href': '#x', style: 'fill:url(https://x)', class: 'x', id: 'y',
  };
  const a = svgAttributen(kwaad);
  assert.deepEqual(namen(a), ['d', 'fill']);
  for (const [n, w] of a) { assert.ok(!/^on|href|style/i.test(n)); assert.ok(!/javascript|url\(/i.test(w)); }
  assert.deepEqual(svgAttributen({ soort: 'script', d: 'M0 0' }), []);
  assert.deepEqual(svgAttributen({ soort: 'foreignObject' }), []);
  assert.deepEqual(svgAttributen(null), []);
});

test('svgAttributen: waarden die de validator nooit zou doorlaten, worden alsnog geweigerd (diepteverdediging)', () => {
  assert.deepEqual(namen(svgAttributen({ soort: 'path', d: 'M0 0"/><script>', vul: 'red; x' })), []);
  assert.deepEqual(namen(svgAttributen({ soort: 'circle', cx: '1', cy: Infinity, r: NaN })), []);
  assert.deepEqual(namen(svgAttributen({ soort: 'path', d: 'M0 0', transform: 'matrix(1 0 0 1 0 0)', lijnEinde: 'x', lijnHoek: 'y', dekking: 2 })), ['d']);
  assert.deepEqual(namen(svgAttributen({ soort: 'polygon', points: '0,0 1,1"' })), []);
});

test('svgAttributen: geen, verloop en lichte varianten', () => {
  assert.deepEqual(svgAttributen({ soort: 'path', d: 'M0 0', vul: 'geen', lijn: 'geen' }), [['d', 'M0 0'], ['fill', 'none'], ['stroke', 'none']]);
  // een verloop is geen attribuutwaarde: vormNaarSvg maakt er een <linearGradient> met een eigen id van
  assert.deepEqual(namen(svgAttributen({ soort: 'rect', x: 0, y: 0, width: 1, height: 1, vul: { verloop: 'lineair', stops: [{ op: 0, kleur: '#000000' }] } })), ['x', 'y', 'width', 'height']);
  // lichte varianten: een klasse (vaste tekst) en een CSS-variabele met de gevalideerde kleur
  assert.deepEqual(svgAttributen({ soort: 'path', d: 'M0 0', vul: '#aab3bd', vulLicht: '#2b2b2b', lijnLicht: 'geen' }), [['d', 'M0 0'], ['fill', '#aab3bd'], ['class', 'ev-vl ev-ll']]);
  assert.deepEqual(lichtVariabelen({ soort: 'path', d: 'M0 0', vulLicht: '#2b2b2b', lijnLicht: 'geen' }), [['--ev-vl', '#2b2b2b'], ['--ev-ll', 'none']]);
  assert.deepEqual(lichtVariabelen({ soort: 'path', d: 'M0 0', vulLicht: 'url(x)' }), []);
});

test('vormNaarSvg: bouwt met createElementNS, met viewBox, klasse, aria-hidden en geen focus', () => {
  const dom = maakDom();
  const svg = vormNaarSvg(HALLOWEEN.vormen.spin, { klasse: 'ev-beeld ev-beeld-spin', document: dom });
  assert.equal(svg.naam, 'svg');
  assert.equal(svg.ns, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(svg.getAttribute('class'), 'ev-beeld ev-beeld-spin');
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('focusable'), 'false');
  assert.deepEqual(svg.kinderen.map((k) => k.naam), ['ellipse', 'circle', 'path']);
  for (const el of alle(svg)) assert.equal(el.ns, 'http://www.w3.org/2000/svg');
  // de lichte kleur van de spin staat als CSS-variabele op het deel (geen style-attribuut)
  assert.equal(svg.kinderen[0].stijl.get('--ev-vl'), '#2b2b2b');
  assert.equal(svg.kinderen[0].getAttribute('style'), null);
});

test('vormNaarSvg: de scène (verlopen, groepen) krijgt per laag unieke verloop-id\'s en enkel toegelaten elementen', () => {
  const dom = maakDom();
  const a = vormNaarSvg(HALLOWEEN.vormen.scene, { klasse: 'x', document: dom });
  const b = vormNaarSvg(HALLOWEEN.vormen.scene, { klasse: 'x', document: dom });
  const toegelaten = new Set(['svg', 'defs', 'g', 'path', 'circle', 'ellipse', 'rect', 'polygon', 'line', 'linearGradient', 'radialGradient', 'stop']);
  for (const el of [...alle(a), ...alle(b)]) {
    assert.ok(toegelaten.has(el.naam), el.naam);
    for (const n of el.attrs.keys()) assert.ok(!/^on|href|^style$/i.test(n), `${el.naam}.${n}`);
  }
  const ids = (s) => alle(s).filter((e) => /Gradient$/.test(e.naam)).map((e) => e.getAttribute('id'));
  // lucht, maanglans, raamglans, elk ook in een lichte versie (taak 9c: eigen lichte versie, keuze opdrachtgever 2026-10-22)
  assert.equal(ids(a).length, 6);
  assert.equal(new Set([...ids(a), ...ids(b)]).size, 12);
  // elke url(#…) verwijst naar een verloop in hetzelfde svg
  for (const s of [a, b]) {
    const eigen = new Set(ids(s));
    for (const el of alle(s)) {
      const fill = el.getAttribute('fill');
      if (fill?.startsWith('url(')) assert.ok(eigen.has(fill.slice(5, -1)), fill);
    }
  }
  // de telling van v2.2.0 (57 cirkels, 25 paden, 28 rechthoeken) blijft na het bouwen
  const tel = (s, naam) => alle(s).filter((e) => e.naam === naam).length;
  assert.deepEqual([tel(a, 'circle'), tel(a, 'path'), tel(a, 'rect')], [57, 25, 28]);
});

// Taak 9c: een licht verloop (vulLicht als verloop) wordt een tweede verloop in hetzelfde svg; het deel krijgt de klasse ev-vl en
// --ev-vl = url(#<eigen id>). Het donkere verloop blijft het fill-attribuut.
test('vormNaarSvg: een licht verloop wordt een eigen verloop, met de klasse ev-vl en --ev-vl als url naar dat verloop', () => {
  const dom = maakDom();
  const deel = {
    soort: 'rect', x: 0, y: 0, width: 10, height: 10,
    vul: { verloop: 'lineair', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ op: 0, kleur: '#070a1c' }, { op: 1, kleur: '#352552' }] },
    vulLicht: { verloop: 'lineair', x1: 0, y1: 0, x2: 0, y2: 1, stops: [{ op: 0, kleur: '#cfd8f2' }, { op: 1, kleur: '#f6dcc4' }] },
  };
  assert.deepEqual(svgAttributen(deel).find(([n]) => n === 'class'), ['class', 'ev-vl']);
  assert.deepEqual(lichtVariabelen(deel), []);
  const svg = vormNaarSvg({ viewBox: '0 0 10 10', delen: [deel] }, { klasse: 'x', document: dom });
  const grads = alle(svg).filter((e) => e.naam === 'linearGradient');
  assert.equal(grads.length, 2);
  const rect = alle(svg).find((e) => e.naam === 'rect');
  assert.equal(rect.getAttribute('fill'), `url(#${grads[0].getAttribute('id')})`);
  assert.equal(rect.stijl.get('--ev-vl'), `url(#${grads[1].getAttribute('id')})`);
  assert.deepEqual(grads[1].kinderen.map((s) => s.getAttribute('stop-color')), ['#cfd8f2', '#f6dcc4']);
  // een licht verloop met een effen donkere vulling kan ook; een ongeldig verloop geeft geen variabele en geen klasse
  const effen = vormNaarSvg({ viewBox: '0 0 1 1', delen: [{ soort: 'circle', cx: 0, cy: 0, r: 1, vul: '#000000', vulLicht: { verloop: 'radiaal', stops: [{ op: 0, kleur: '#ffffff' }] } }] }, { document: dom });
  assert.match(alle(effen).find((e) => e.naam === 'circle').stijl.get('--ev-vl'), /^url\(#ev-verloop-\d+\)$/);
  const fout = { soort: 'circle', cx: 0, cy: 0, r: 1, vulLicht: { verloop: 'conisch', stops: [] } };
  assert.equal(svgAttributen(fout).find(([n]) => n === 'class'), undefined);
});

test('vormNaarSvg: een verloop krijgt zijn coördinaten en stops', () => {
  const dom = maakDom();
  const svg = vormNaarSvg({ viewBox: '0 0 10 10', delen: [{ soort: 'circle', cx: 5, cy: 5, r: 5, vul: { verloop: 'radiaal', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ op: 0, kleur: '#fff3cf8c' }, { op: 1, kleur: '#8f86e800' }] } }] }, { klasse: 'x', document: dom });
  const grad = alle(svg).find((e) => e.naam === 'radialGradient');
  assert.deepEqual([...grad.attrs.keys()].sort(), ['cx', 'cy', 'id', 'r']);
  const stops = grad.kinderen;
  assert.deepEqual(stops.map((s) => [s.getAttribute('offset'), s.getAttribute('stop-color')]), [['0', '#fff3cf8c'], ['1', '#8f86e800']]);
});
