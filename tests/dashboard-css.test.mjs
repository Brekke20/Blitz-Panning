// Structuurtest dashboard.css: de grafieken mogen de pagina nooit horizontaal laten scrollen (telefoonbreedte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'css', 'dashboard.css'), 'utf8');

// Declaraties van de regel met precies deze kiezer ('' als hij ontbreekt).
function regel(kiezer) {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim() === kiezer) return m[2];
  }
  return '';
}

test('I1: de tabel-twin scrolt binnen zichzelf', () => {
  const r = regel('.tabel-twin');
  assert.match(r, /max-width:\s*100%/);
  assert.match(r, /overflow-x:\s*auto/);
  assert.match(r, /contain:\s*inline-size/, 'telt niet mee in de min-content van de ouder');
});

test('I1: de SVG-wrapper scrolt binnen zichzelf; grid/flex-ouders krijgen min-width:0', () => {
  assert.match(regel('.grafiek-scroll'), /overflow-x:\s*auto/);
  assert.match(regel('.grafiek-scroll'), /contain:\s*inline-size/);
  const r = regel('.grafiek, .balken-blok, .donut, .ring');
  assert.match(r, /min-width:\s*0/);
});
