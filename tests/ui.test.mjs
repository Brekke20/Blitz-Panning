// tests/ui.test.mjs — unit-tests voor kern/ui.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { escHtml, toastDuur, registreerActies } from '../public/js/kern/ui.js';

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
    aanroepen.push({ tag: el.dataset.actie, arg });
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
  const nep_event = {
    target: {
      closest(selector) {
        if (selector === '[data-actie]') {
          return {
            dataset: { actie: 'a', arg: '-1' }
          };
        }
        return null;
      }
    }
  };

  nep_wortel._listener(nep_event);

  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0].arg, '-1');
});

test('registreerActies — onbekende actie wordt genegeerd', () => {
  const handlers = {};
  handlers['a'] = () => { throw new Error('should not call'); };

  const nep_wortel = {
    addEventListener(type, fn) {
      this._listener = fn;
    },
    removeEventListener(type, fn) {
      // Noop
    }
  };

  registreerActies(nep_wortel, handlers);

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
  // Geen fout gegooid = test passed
});

test('registreerActies — geen closest → niets', () => {
  const handlers = {};
  handlers['a'] = () => { throw new Error('should not call'); };

  const nep_wortel = {
    addEventListener(type, fn) {
      this._listener = fn;
    },
    removeEventListener(type, fn) {
      // Noop
    }
  };

  registreerActies(nep_wortel, handlers);

  const nep_event = {
    target: { closest: null }
  };

  nep_wortel._listener(nep_event);
  // Geen fout gegooid = test passed
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

  // Controleer dat removeEventListener is aangeroepen
  assert.equal(removedType, 'click');
  assert.ok(removedFn);
});
