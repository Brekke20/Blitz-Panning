import test from 'node:test';
import assert from 'node:assert/strict';
import { isPickerVeld, wilPicker, open, grofPointer, installeerTijdPicker } from '../public/js/kern/tijd-picker.js';

const veld = (o) => ({ tagName: 'INPUT', type: 'time', readOnly: false, disabled: false, ...o });

test('tijd- en datumvelden komen in aanmerking', () => {
  assert.equal(isPickerVeld(veld({ type: 'time' })), true);
  assert.equal(isPickerVeld(veld({ type: 'date' })), true);
  assert.equal(isPickerVeld(veld({ type: 'DATE' })), true);
});

test('andere velden niet: tekst, getal, textarea, knop, null', () => {
  assert.equal(isPickerVeld(veld({ type: 'text' })), false);
  assert.equal(isPickerVeld(veld({ type: 'number' })), false);
  assert.equal(isPickerVeld(veld({ type: 'datetime-local' })), false);
  assert.equal(isPickerVeld({ tagName: 'TEXTAREA', type: 'textarea' }), false);
  assert.equal(isPickerVeld({ tagName: 'BUTTON', type: 'time' }), false);
  assert.equal(isPickerVeld(null), false);
  assert.equal(isPickerVeld({}), false);
});

test('readonly en uitgeschakelde velden niet', () => {
  assert.equal(isPickerVeld(veld({ readOnly: true })), false);
  assert.equal(isPickerVeld(veld({ disabled: true })), false);
});

test('picker enkel bij aanraking (grove aanwijzer), niet met muis', () => {
  assert.equal(wilPicker(veld(), true), true);
  assert.equal(wilPicker(veld(), false), false);
  assert.equal(wilPicker(veld({ type: 'text' }), true), false);
});

test('open: roept showPicker aan, slikt fouten en ontbrekende ondersteuning', () => {
  let n = 0;
  open({ showPicker() { n++; } });
  assert.equal(n, 1);
  assert.doesNotThrow(() => open({ showPicker() { throw new Error('NotAllowedError'); } }));
  assert.doesNotThrow(() => open({}));
});

test('grofPointer: zonder matchMedia of bij een fout geldt aanraking; (pointer: fine) is geen aanraking', () => {
  assert.equal(grofPointer(null), true);
  assert.equal(grofPointer({}), true);
  assert.equal(grofPointer({ matchMedia() { throw new Error('x'); } }), true);
  assert.equal(grofPointer({ matchMedia: () => ({ matches: true }) }), false);
  assert.equal(grofPointer({ matchMedia: () => ({ matches: false }) }), true);
});

test('installeerTijdPicker: een klik op een tijdveld roept showPicker aan (niet bij defaultPrevented of een fijne aanwijzer)', () => {
  let luisteraar;
  const doc = { addEventListener(naam, f) { assert.equal(naam, 'click'); luisteraar = f; } };
  let n = 0;
  const veldEl = veld({ showPicker() { n++; } });
  installeerTijdPicker(doc, { matchMedia: () => ({ matches: false }) });
  luisteraar({ target: veldEl, defaultPrevented: false });
  assert.equal(n, 1);
  luisteraar({ target: veldEl, defaultPrevented: true });
  assert.equal(n, 1);
  luisteraar({ target: veld({ type: 'text', showPicker() { n++; } }), defaultPrevented: false });
  assert.equal(n, 1);
  installeerTijdPicker(doc, { matchMedia: () => ({ matches: true }) }); // muis: gewoon gedrag
  luisteraar({ target: veldEl, defaultPrevented: false });
  assert.equal(n, 1);
});
