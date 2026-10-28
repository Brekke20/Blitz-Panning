// apparaat.js (klassiek script in <head>) draait hier in een vm met een nepvenster: de soortbepaling van de apparaatherkenning.
// Taak 17 (Brent, 2026-10-28): een automatisch herkende tablet (grove pointer, kortste schermzijde >= 600) is rechtop een gsm
// (indeling 'smal') en liggend een tablet (indeling 'breed'). Een handmatige keuze (blitz_weergave) gaat altijd voor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BRON = readFileSync(new URL('../public/js/apparaat.js', import.meta.url), 'utf8');

// `venster`: { b, h } = innerWidth/innerHeight; `scherm`: { b, h } = screen (standaard gelijk aan het venster)
function draai({ venster, scherm = venster, grof = true, weergave = null }) {
  const attrs = {};
  const luisteraars = {}, handlers = {};
  const sandbox = {
    innerWidth: venster.b, innerHeight: venster.h, screen: { width: scherm.b, height: scherm.h },
    document: {
      documentElement: {
        setAttribute: (n, v) => { attrs[n] = String(v); }, getAttribute: (n) => (n in attrs ? attrs[n] : null), hasAttribute: (n) => n in attrs,
      },
      addEventListener() {}, visibilityState: 'visible',
    },
    localStorage: { getItem: (k) => (k === 'blitz_weergave' ? weergave : null), setItem() {} },
    matchMedia: () => ({ matches: grof, addEventListener() {} }),
    requestAnimationFrame: (f) => f(),
    CustomEvent: class { constructor(naam, init) { this.type = naam; this.detail = init?.detail; } },
    dispatchEvent(e) { (luisteraars[e.type] ||= []).push(e.detail); },
    addEventListener(naam, f) { handlers[naam] = f; },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(BRON, sandbox);
  return { a: sandbox.apparaat, attrs, evenementen: luisteraars, sandbox, handlers };
}
const maat = (b, h) => ({ b, h });

test('tablet met aanraking rechtop = gsm, indeling smal', () => {
  const { a, attrs } = draai({ venster: maat(768, 1024) });
  assert.equal(a.soort, 'gsm');
  assert.equal(a.automatischeSoort, 'gsm');
  assert.equal(a.indeling, 'smal');
  assert.equal(attrs['data-apparaat'], 'gsm');
  assert.equal(attrs['data-indeling'], 'smal');
  assert.equal(attrs['data-nav'], 'dok');
});

test('tablet met aanraking liggend blijft tablet, indeling breed', () => {
  const { a, attrs } = draai({ venster: maat(1024, 768) });
  assert.equal(a.soort, 'tablet');
  assert.equal(a.indeling, 'breed');
  assert.equal(attrs['data-apparaat'], 'tablet');
  assert.equal(attrs['data-nav'], 'kolom');
});

test('een gsm blijft een gsm, rechtop en liggend', () => {
  assert.equal(draai({ venster: maat(375, 812) }).a.soort, 'gsm');
  assert.equal(draai({ venster: maat(812, 375) }).a.soort, 'gsm');
});

test('de grens: kortste schermzijde 599 is gsm, 600 liggend is tablet, 600 rechtop is gsm', () => {
  assert.equal(draai({ venster: maat(1024, 599) }).a.soort, 'gsm');
  assert.equal(draai({ venster: maat(1024, 600) }).a.soort, 'tablet');
  assert.equal(draai({ venster: maat(600, 1024) }).a.soort, 'gsm');
});

test('zonder aanraking (muis) is rechtop of liggend altijd een computer', () => {
  assert.equal(draai({ venster: maat(768, 1024), grof: false }).a.soort, 'computer');
  assert.equal(draai({ venster: maat(1024, 768), grof: false }).a.soort, 'computer');
});

test('een handmatige weergave gaat voor: tablet rechtop blijft tablet (indeling tablet-staand), gsm en computer ook', () => {
  const t = draai({ venster: maat(768, 1024), weergave: 'tablet' }).a;
  assert.equal(t.soort, 'tablet');
  assert.equal(t.indeling, 'tablet-staand');
  assert.equal(t.automatischeSoort, 'gsm'); // wat het toestel zelf zou zijn
  assert.equal(draai({ venster: maat(768, 1024), weergave: 'computer' }).a.soort, 'computer');
  assert.equal(draai({ venster: maat(1024, 768), weergave: 'gsm' }).a.soort, 'gsm');
});

test('een schermtoetsenbord (venster lager dan breed) maakt een rechtop gehouden tablet geen tablet: het scherm bepaalt rechtop of liggend', () => {
  // 800x1280-scherm rechtop; het toetsenbord laat een venster van 800x600 over: venster "liggend", scherm nog rechtop
  assert.equal(draai({ venster: maat(800, 600), scherm: maat(800, 1280) }).a.soort, 'gsm');
  // een echt liggende tablet met toetsenbord blijft tablet
  assert.equal(draai({ venster: maat(1280, 400), scherm: maat(1280, 800) }).a.soort, 'tablet');
});

test('draaien: een resize (of orientationchange) van rechtop naar liggend en terug wisselt soort en indeling live en meldt apparaatwijziging', () => {
  const { sandbox, evenementen, handlers, attrs } = draai({ venster: maat(768, 1024) });
  assert.equal(sandbox.apparaat.soort, 'gsm');
  assert.deepEqual(evenementen, {}); // de eerste evaluatie meldt nog niets
  const draaiNaar = (b, h, gebeurtenis) => { sandbox.innerWidth = b; sandbox.innerHeight = h; sandbox.screen = { width: b, height: h }; handlers[gebeurtenis](); };
  draaiNaar(1024, 768, 'resize');
  assert.equal(sandbox.apparaat.soort, 'tablet');
  assert.equal(attrs['data-apparaat'], 'tablet');
  assert.equal(attrs['data-indeling'], 'breed');
  assert.equal(evenementen.apparaatwijziging.length, 1);
  draaiNaar(768, 1024, 'orientationchange');
  assert.equal(sandbox.apparaat.soort, 'gsm');
  assert.equal(attrs['data-indeling'], 'smal');
  assert.equal(evenementen.apparaatwijziging.length, 2);
});
