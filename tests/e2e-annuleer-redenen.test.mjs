// De handmatige kopie ANNULEER_REDENEN in e2e/productie-hulp.mjs moet gelijklopen met netlify/lib/annulatie.js (REDENEN).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { REDENEN } from '../netlify/lib/annulatie.js';

const WORTEL = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');

test('productie-hulp ANNULEER_REDENEN = REDENEN (code en label, zelfde volgorde)', () => {
  const tekst = fs.readFileSync(path.join(WORTEL, 'e2e/productie-hulp.mjs'), 'utf8');
  const blok = tekst.match(/const ANNULEER_REDENEN = (\[[\s\S]*?\n\]);/);
  assert.ok(blok, 'ANNULEER_REDENEN niet gevonden');
  const kopie = new Function(`return ${blok[1]};`)();
  assert.deepEqual(kopie, REDENEN.map(({ code, label }) => ({ code, label })));
});
