import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_VERSIE, leesVersie } from '../public/js/versie.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('APP_VERSIE komt overeen met package.json', () => {
  assert.equal(APP_VERSIE, pkg.version);
});

test('package-lock.json heeft dezelfde versie', () => {
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});

test('leesVersie leest het nummer uit de eigen broncode van versie.js (v2.1.6: geen valse "nieuwe versie klaar")', () => {
  const bron = readFileSync(new URL('../public/js/versie.js', import.meta.url), 'utf8');
  assert.equal(leesVersie(bron), APP_VERSIE);
  assert.equal(leesVersie("export const APP_VERSIE = '9.8.7';"), '9.8.7');
  assert.equal(leesVersie('<html>offline</html>'), null);
  assert.equal(leesVersie(undefined), null);
});
