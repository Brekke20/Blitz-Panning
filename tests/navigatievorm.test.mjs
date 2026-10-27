// Open dag, taak 8a (Ruling 12): de navigatievorm (zijkolom of dok) los van het toestel (kern/navigatievorm.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navigatieVorm, NAV_MIN_BREEDTE, startNavigatievorm } from '../public/js/kern/navigatievorm.js';

test('breed en een venster van minstens 768 px: zijkolom', () => {
  assert.equal(navigatieVorm({ indeling: 'breed', breedte: 1366 }), 'kolom');
  assert.equal(navigatieVorm({ indeling: 'breed', breedte: 768 }), 'kolom');
  assert.equal(NAV_MIN_BREEDTE, 768);
});

test('breed maar een smal venster (< 768 px): dok', () => {
  assert.equal(navigatieVorm({ indeling: 'breed', breedte: 767 }), 'dok');
  assert.equal(navigatieVorm({ indeling: 'breed', breedte: 375 }), 'dok');
});

test('gsm en staande tablet: altijd dok, ook in een breed venster', () => {
  assert.equal(navigatieVorm({ indeling: 'smal', breedte: 1366 }), 'dok');
  assert.equal(navigatieVorm({ indeling: 'tablet-staand', breedte: 820 }), 'dok');
  assert.equal(navigatieVorm({ indeling: 'tablet-staand', breedte: 1366 }), 'dok');
});

test('een ontbrekende indeling is geen breed: dok', () => {
  assert.equal(navigatieVorm({ indeling: null, breedte: 1366 }), 'dok');
  assert.equal(navigatieVorm({}), 'dok');
});

// Een nepvenster: genoeg voor de starter (attribuut op <html>, resize, apparaatwijziging).
function nepVenster({ indeling = 'breed', breedte = 1366 } = {}) {
  const attrs = { 'data-indeling': indeling };
  const luisteraars = {};
  const gestuurd = [];
  const win = {
    innerWidth: breedte,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    document: {
      documentElement: {
        getAttribute: (n) => (n in attrs ? attrs[n] : null),
        setAttribute: (n, v) => { attrs[n] = String(v); },
      },
    },
    addEventListener: (t, f) => { (luisteraars[t] ||= []).push(f); },
    removeEventListener: (t, f) => { luisteraars[t] = (luisteraars[t] || []).filter(x => x !== f); },
    dispatchEvent: (e) => { gestuurd.push(e.type); return true; },
  };
  const vuur = (t) => (luisteraars[t] || []).forEach(f => f({ type: t }));
  return { win, attrs, vuur, gestuurd, luisteraars };
}

test('de starter zet data-nav meteen en volgt resize en apparaatwijziging', () => {
  const { win, attrs, vuur, gestuurd } = nepVenster();
  const stop = startNavigatievorm(win);
  assert.equal(attrs['data-nav'], 'kolom');
  assert.deepEqual(gestuurd, []); // de eerste stand is geen wijziging

  win.innerWidth = 500; vuur('resize');
  assert.equal(attrs['data-nav'], 'dok');
  assert.deepEqual(gestuurd, ['navigatievormwijziging']);

  win.innerWidth = 1200; vuur('resize');
  assert.equal(attrs['data-nav'], 'kolom');

  attrs['data-indeling'] = 'smal'; vuur('apparaatwijziging');
  assert.equal(attrs['data-nav'], 'dok');
  assert.equal(gestuurd.length, 3);

  vuur('resize'); // geen verandering: geen nieuw signaal
  assert.equal(gestuurd.length, 3);

  stop();
  attrs['data-indeling'] = 'breed'; vuur('apparaatwijziging');
  assert.equal(attrs['data-nav'], 'dok'); // gestopt: luistert niet meer
});

// Taak 8b: data-nav staat al bij de eerste verf. apparaat.js (klassiek script in <head>, kan de module niet importeren) zet het
// attribuut de eerste keer met dezelfde regel; deze test laat het script echt draaien en pint de twee aan elkaar.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function draaiApparaat({ weergave, breedte, hoogte = 800 }) {
  const attrs = {};
  const sandbox = {
    innerWidth: breedte, innerHeight: hoogte, screen: { width: breedte, height: hoogte },
    document: {
      documentElement: {
        setAttribute: (n, v) => { attrs[n] = String(v); },
        getAttribute: (n) => (n in attrs ? attrs[n] : null),
        hasAttribute: (n) => n in attrs,
      },
      addEventListener() {}, visibilityState: 'visible',
    },
    localStorage: { getItem: (k) => (k === 'blitz_weergave' ? weergave : null), setItem() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: (f) => f(),
    CustomEvent: class {},
    dispatchEvent() {},
    addEventListener() {},
  };
  sandbox.window = sandbox;
  vm.runInNewContext(readFileSync(new URL('../public/js/apparaat.js', import.meta.url), 'utf8'), sandbox);
  return attrs;
}

test('apparaat.js zet data-nav bij de eerste verf met dezelfde regel als kern/navigatievorm.js', () => {
  for (const weergave of ['gsm', 'tablet', 'computer', null]) {
    for (const breedte of [320, 375, 767, 768, 800, 1024, 1366]) {
      const attrs = draaiApparaat({ weergave, breedte, hoogte: weergave === 'tablet' ? breedte + 100 : 700 });
      assert.ok(attrs['data-nav'], `data-nav ontbreekt (${weergave}, ${breedte})`);
      const verwacht = navigatieVorm({ indeling: attrs['data-indeling'], breedte });
      assert.equal(attrs['data-nav'], verwacht, `${weergave} ${breedte}: ${attrs['data-indeling']}`);
    }
  }
});
