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
