// tests/rolwisselaar.test.mjs — schermen/rolwisselaar.js (logins T19): de wisselaar bestaat enkel in testmodus op een lokale dev-server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rolwisselaarZichtbaar } from '../public/js/schermen/rolwisselaar.js';

test('rolwisselaarZichtbaar: enkel testmodus én lokale dev', () => {
  assert.equal(rolwisselaarZichtbaar({ testModus: true, lokaleDev: true }), true);
  assert.equal(rolwisselaarZichtbaar({ testModus: true, lokaleDev: false }), false);
  assert.equal(rolwisselaarZichtbaar({ testModus: false, lokaleDev: true }), false);
  assert.equal(rolwisselaarZichtbaar({ testModus: false, lokaleDev: false }), false);
});

test('rolwisselaarZichtbaar: alleen letterlijk true telt (fail-closed)', () => {
  assert.equal(rolwisselaarZichtbaar({ testModus: true, lokaleDev: 'true' }), false);
  assert.equal(rolwisselaarZichtbaar({ testModus: 1, lokaleDev: true }), false);
  assert.equal(rolwisselaarZichtbaar({ testModus: true, lokaleDev: null }), false);
  assert.equal(rolwisselaarZichtbaar({ testModus: true }), false);
  assert.equal(rolwisselaarZichtbaar({}), false);
  assert.equal(rolwisselaarZichtbaar(), false);
});
