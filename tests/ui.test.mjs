// tests/ui.test.mjs — unit-tests voor kern/ui.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { escHtml, toastDuur, registreerActies, maakActiveerbaar } from '../public/js/kern/ui.js';

test('escHtml(null) → ""', () => {
  assert.equal(escHtml(null), '');
});

test('escHtml("<a href="x">&\'") → "&lt;a href=&quot;x&quot;&gt;&amp;&#39;"', () => {
  assert.equal(
    escHtml('<a href="x">&\''),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;'
  );
});

test('toastDuur("Opgeslagen") = 4000', () => {
  assert.equal(toastDuur('Opgeslagen'), 4000);
});

test('toastDuur("✕ Mislukt") = 7000', () => {
  assert.equal(toastDuur('✕ Mislukt'), 7000);
});

test('toastDuur("⚠ kan niet") = 7000', () => {
  assert.equal(toastDuur('⚠ kan niet'), 7000);
});

test('toastDuur("Fout bij laden") = 7000', () => {
  assert.equal(toastDuur('Fout bij laden'), 7000);
});

test('toastDuur("Ok", 9000) = 9000', () => {
  assert.equal(toastDuur('Ok', 9000), 9000);
});

test('toastDuur("Ok", 1000) = 4000 (duur mag enkel verlengen)', () => {
  assert.equal(toastDuur('Ok', 1000), 4000);
});

test('registreerActies — basic delegatie', () => {
  const handlers = {};
  let aanroepen = [];
  handlers['a'] = (el, event, arg) => {
    aanroepen.push({ el, event, arg, tag: el.dataset.actie });
  };

  const nep_wortel = {
    addEventListener(type, fn) {
      this._listener = fn;
    },
    removeEventListener(type, fn) {
      // Noop voor nu
    }
  };

  const afmelden = registreerActies(nep_wortel, handlers);

  // Simuleer een click event
  const nep_element = {
    dataset: { actie: 'a', arg: '-1' }
  };
  const nep_event = {
    target: {
      closest(selector) {
        if (selector === '[data-actie]') {
          return nep_element;
        }
        return null;
      }
    }
  };

  nep_wortel._listener(nep_event);

  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0].arg, '-1');
  assert.equal(aanroepen[0].tag, 'a');
  assert.ok(aanroepen[0].el === nep_element, 'handler ontvangt el');
  assert.ok(aanroepen[0].event === nep_event, 'handler ontvangt event');
});

test('registreerActies — onbekende actie wordt genegeerd', () => {
  const handlers = {};
  let callCount = 0;
  handlers['a'] = () => { callCount++; };

  const nep_wortel = {
    _listener: null,
    addEventListener(type, fn) {
      this._listener = fn;
    },
    removeEventListener(type, fn) {
      // Noop
    }
  };

  registreerActies(nep_wortel, handlers);

  // Assert listener is geregistreerd
  assert.ok(nep_wortel._listener, 'listener moet geregistreerd zijn');

  const nep_event = {
    target: {
      closest(selector) {
        if (selector === '[data-actie]') {
          return {
            dataset: { actie: 'onbekend', arg: '' }
          };
        }
        return null;
      }
    }
  };

  nep_wortel._listener(nep_event);
  // Handler mag niet opgeroepen zijn
  assert.equal(callCount, 0, 'onbekende actie mag geen handler oproepen');
});

test('registreerActies — geen closest → niets', () => {
  const handlers = {};
  let callCount = 0;
  handlers['a'] = () => { callCount++; };

  const nep_wortel = {
    _listener: null,
    addEventListener(type, fn) {
      this._listener = fn;
    },
    removeEventListener(type, fn) {
      // Noop
    }
  };

  registreerActies(nep_wortel, handlers);

  // Assert listener is geregistreerd
  assert.ok(nep_wortel._listener, 'listener moet geregistreerd zijn');

  const nep_event = {
    target: { closest: null }
  };

  nep_wortel._listener(nep_event);
  // Handler mag niet opgeroepen zijn
  assert.equal(callCount, 0, 'target zonder closest mag geen handler oproepen');
});

test('registreerActies — teruggegeven functie meldt af', () => {
  const handlers = {};
  let gecalled = false;
  handlers['a'] = () => { gecalled = true; };

  let removedType = null;
  let removedFn = null;

  const nep_wortel = {
    _listener: null,
    addEventListener(type, fn) {
      this._listener = fn;
    },
    removeEventListener(type, fn) {
      removedType = type;
      removedFn = fn;
    }
  };

  const afmelden = registreerActies(nep_wortel, handlers);

  // Roep afmelden aan
  afmelden();

  // Controleer dat removeEventListener is aangeroepen met dezelfde listener
  assert.equal(removedType, 'click');
  assert.equal(removedFn, nep_wortel._listener, 'afmelden geeft dezelfde listener aan removeEventListener');
});

// ── maakActiveerbaar ──
function nepElement() {
  const attrs = {}, luisteraars = {};
  return {
    tabIndex: -1,
    attrs,
    setAttribute(k, v) { attrs[k] = v; },
    addEventListener(soort, fn) { luisteraars[soort] = fn; },
    keydown(e) { luisteraars.keydown(e); },
  };
}
function nepToets(key, doel) {
  const e = { key, target: doel, voorkomen: 0, preventDefault() { this.voorkomen++; } };
  return e;
}

test('maakActiveerbaar: zet tabIndex, role en aria-label', () => {
  const el = nepElement();
  maakActiveerbaar(el, () => {}, 'Open ticket #5');
  assert.equal(el.tabIndex, 0);
  assert.equal(el.attrs.role, 'button');
  assert.equal(el.attrs['aria-label'], 'Open ticket #5');
});

test('maakActiveerbaar: zonder label geen aria-label', () => {
  const el = nepElement();
  maakActiveerbaar(el, () => {});
  assert.equal('aria-label' in el.attrs, false);
});

test('maakActiveerbaar: Enter en Space roepen de handler en voorkomen de standaardactie', () => {
  const el = nepElement();
  let n = 0;
  maakActiveerbaar(el, () => n++, 'x');
  for (const key of ['Enter', ' ']) {
    const e = nepToets(key, el);
    el.keydown(e);
    assert.equal(e.voorkomen, 1);
  }
  assert.equal(n, 2);
});

test('maakActiveerbaar: andere toetsen doen niets', () => {
  const el = nepElement();
  let n = 0;
  maakActiveerbaar(el, () => n++, 'x');
  const e = nepToets('a', el);
  el.keydown(e);
  assert.equal(n, 0);
  assert.equal(e.voorkomen, 0);
});

test('maakActiveerbaar: toets uit een binnenste knop wordt genegeerd', () => {
  const el = nepElement();
  let n = 0;
  maakActiveerbaar(el, () => n++, 'x');
  const knop = { closest: () => ({}) };
  const e = nepToets('Enter', knop);
  el.keydown(e);
  assert.equal(n, 0);
  assert.equal(e.voorkomen, 0);
});

test('maakActiveerbaar: toets uit een binnenste element zonder knop/link/veld werkt wel', () => {
  const el = nepElement();
  let n = 0;
  maakActiveerbaar(el, () => n++, 'x');
  const e = nepToets('Enter', { closest: () => null });
  el.keydown(e);
  assert.equal(n, 1);
});
