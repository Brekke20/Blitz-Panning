import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOK_SOORTEN, isHeleDag, valideerBlok } from '../public/js/sales/blok-regels.js';

const blok = (extra = {}) => ({ id: 'b1', datum: '2026-10-07', start: '13:00', eind: '14:00', soort: 'kantoor', ...extra });

test('BLOK_SOORTEN', () => assert.deepEqual(BLOK_SOORTEN, ['verlof', 'kantoor', 'afspraak']));

test('isHeleDag: 00:00 tot 23:59 of 24:00', () => {
  assert.equal(isHeleDag(blok({ start: '00:00', eind: '23:59' })), true);
  assert.equal(isHeleDag(blok({ start: '00:00', eind: '24:00' })), true);
  assert.equal(isHeleDag(blok({ start: '00:00', eind: '23:00' })), false);
  assert.equal(isHeleDag(blok({ start: '08:00', eind: '24:00' })), false);
  assert.equal(isHeleDag(null), false);
});

test('valideerBlok: geldig blok komt terug', () => {
  const r = valideerBlok(blok({ omschrijving: 'Tandarts', lat: 50.9, lon: 5.3 }));
  assert.equal(r.fout, undefined);
  assert.deepEqual(r.blok, blok({ omschrijving: 'Tandarts', lat: 50.9, lon: 5.3 }));
  assert.equal(valideerBlok(blok({ start: '00:00', eind: '24:00', soort: 'verlof' })).fout, undefined);
});

test('valideerBlok: weigert foute invoer', () => {
  assert.ok(valideerBlok(blok({ eind: '13:00' })).fout);
  assert.ok(valideerBlok(blok({ eind: '12:00' })).fout);
  assert.ok(valideerBlok(blok({ soort: 'vakantie' })).fout);
  assert.ok(valideerBlok(blok({ datum: '2026-02-30' })).fout);
  assert.ok(valideerBlok(blok({ datum: '07/10/2026' })).fout);
  assert.ok(valideerBlok(blok({ start: '25:00' })).fout);
  assert.ok(valideerBlok(blok({ start: '9:00' })).fout);
  assert.ok(valideerBlok(blok({ omschrijving: 'x'.repeat(201) })).fout);
  assert.equal(valideerBlok(blok({ omschrijving: 'x'.repeat(200) })).fout, undefined);
  assert.ok(valideerBlok(null).fout);
});
