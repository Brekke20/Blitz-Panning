// tests/versiering-bewegingen.test.mjs — schermen/versiering-bewegingen.js: de gedeelde plaatsen van één opbouw (fix-ronde 1, punt 7).
// Twee `hangen`-elementen of twee keer dezelfde hoek mogen nooit op elkaar komen te liggen. Met een minimale DOM (geen browser).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BOUWERS, maakPlaatsen } from '../public/js/schermen/versiering-bewegingen.js';

function maakElement(naam) {
  const stijl = new Map();
  return {
    naam, className: '', attrs: new Map(), kinderen: [],
    setAttribute(n, v) { this.attrs.set(n, String(v)); },
    getAttribute(n) { return this.attrs.get(n) ?? null; },
    appendChild(k) { this.kinderen.push(k); return k; },
    insertBefore(k) { this.kinderen.unshift(k); return k; },
    get firstChild() { return this.kinderen[0] ?? null; },
    style: { setProperty: (p, v) => stijl.set(p, String(v)), get: (p) => stijl.get(p) },
  };
}
const oud = globalThis.document;
before(() => { globalThis.document = { createElement: maakElement, createElementNS: (_ns, n) => maakElement(n) }; });
after(() => { globalThis.document = oud; });

const PAKKET = { vormen: { bol: { viewBox: '0 0 10 10', delen: [{ soort: 'circle', cx: 5, cy: 5, r: 4, vul: '#ff0000' }] } } };
const klassen = (el) => el.className || el.getAttribute('class') || '';

test('twee hangen-elementen delen de hangplaatsen: elk beeld een eigen plek, hoogstens 3', () => {
  const laag = maakElement('div');
  const plaatsen = maakPlaatsen();
  BOUWERS.hangen({ beweging: 'hangen', beeld: 'bol', aantal: 2 }, PAKKET, { laag, plaatsen, max: 3 });
  BOUWERS.hangen({ beweging: 'hangen', beeld: 'bol', aantal: 2 }, PAKKET, { laag, plaatsen, max: 1 });
  const links = laag.kinderen.map((h) => h.style.get('left'));
  assert.equal(links.length, 3);
  assert.equal(new Set(links).size, 3, `plaatsen ${links}`);
  // zonder gedeelde plaatsen (oude gedrag) zou het tweede element weer op plaats 1 beginnen
  assert.deepEqual(links, ['1.2%', '95%', '72%']);
});

test('dezelfde hoek in twee hoek-elementen wordt maar één keer getekend (de eerste wint)', () => {
  const laag = maakElement('div');
  const plaatsen = maakPlaatsen();
  BOUWERS.hoek({ beweging: 'hoek', beeld: 'bol', hoeken: ['lb', 'ro'] }, PAKKET, { laag, plaatsen, max: 4 });
  BOUWERS.hoek({ beweging: 'hoek', beeld: 'bol', hoeken: ['ro', 'rb'], richting: 'naarHoek' }, PAKKET, { laag, plaatsen, max: 2 });
  const hoeken = laag.kinderen.map((k) => klassen(k).match(/ev-hoek-(\w+)/)[1]);
  assert.deepEqual(hoeken, ['lb', 'ro', 'rb']);
  assert.ok(!klassen(laag.kinderen[1]).includes('ev-naar-hoek'), 'ro blijft van het eerste (rechtop) element');
});

test('zonder gedeelde plaatsen (losse aanroep) werkt een bouwer nog op zichzelf', () => {
  const laag = maakElement('div');
  BOUWERS.hangen({ beweging: 'hangen', beeld: 'bol', aantal: 2 }, PAKKET, { laag, max: 3 });
  assert.equal(laag.kinderen.length, 2);
});
