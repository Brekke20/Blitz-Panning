// Open dag-stijl, taak 1: de CSS-tokens (glas, stralen, letters, gloed, duur) en de lettertypen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/css/base.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const TOKENS = [
  'glas', 'glas-hover', 'glas-sterk', 'glas-venster', 'glas-rand', 'glas-rand-hover', 'glas-licht',
  'blur', 'glas-schaduw', 'knop2', 'knop2-hover', 'veld',
  'r-kaart', 'r-venster', 'r-ev', 'r-pil',
  'font-tekst', 'font-kop',
  'gloed-rood', 'gloed-oranje', 'gloed-groen', 'gloed-paars',
  'duur', 'duur-glans',
];

// Geeft de inhoud van het eerste blok dat met `begin` start (accolades komen in de tokenblokken niet genest voor).
function blok(begin) {
  const i = css.indexOf(begin);
  assert.ok(i >= 0, `blok ${begin} ontbreekt`);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}

test('base.css definieert alle Open dag-tokens in donker', () => {
  const root = blok(':root {');
  for (const naam of TOKENS) {
    assert.match(root, new RegExp('--' + naam + '\s*:'), `--${naam} ontbreekt in :root`);
  }
});

test('de vaste waarden van de stralen, letters en duur kloppen', () => {
  const root = blok(':root {');
  assert.match(root, /--r-kaart:\s*22px/);
  assert.match(root, /--r-venster:\s*28px/);
  assert.match(root, /--r-ev:\s*16px/);
  assert.match(root, /--r-pil:\s*999px/);
  assert.match(root, /--r-pill:\s*999px/, 'het bestaande --r-pill blijft');
  assert.match(root, /--font-tekst:\s*'Figtree'/);
  assert.match(root, /--font-kop:\s*'Bricolage Grotesque'/);
  assert.match(root, /--duur:\s*\.28s/);
  assert.match(root, /--duur-glans:\s*\.4s/);
});

test('de gloedtokens zijn afgeleid van de statuskleuren, die zelf niet overschreven worden', () => {
  const root = blok(':root {');
  for (const [naam, status] of [['rood', 'red'], ['oranje', 'orange'], ['groen', 'green'], ['paars', 'purple']]) {
    assert.match(root, new RegExp(String.raw`--gloed-${naam}:\s*color-mix\([^;]*var\(--${status}\)`));
  }
  assert.match(root, /--red:\s*#ff5a52/, 'de statuskleur blijft zoals ze was');
});

test('licht thema herdefinieert de glastokens', () => {
  const licht = blok(':root[data-theme="light"] {');
  for (const naam of ['glas', 'glas-rand', 'knop2']) {
    assert.match(licht, new RegExp('--' + naam + ':'), `--${naam} ontbreekt in het lichte thema`);
  }
});

test('gsm krijgt minder vervaging', () => {
  assert.match(css, /html\[data-apparaat="gsm"\][^{]*\{[^}]*--blur:\s*10px/);
});

test('verminderde transparantie zet de vervaging uit', () => {
  const m = css.match(/@media \(prefers-reduced-transparency: reduce\)\s*\{[\s\S]*?--blur:\s*0px/);
  assert.ok(m, 'prefers-reduced-transparency: reduce met --blur: 0px ontbreekt');
});

test('zonder backdrop-filter staat de vervaging uit', () => {
  assert.match(css, /@supports not \([^{]*backdrop-filter: blur\(1px\)[^{]*\{[\s\S]*?--blur:\s*0px/);
});

test('letters: Figtree en Bricolage, geen Inter', () => {
  assert.match(html, /family=Bricolage\+Grotesque/);
  assert.match(html, /family=Figtree/);
  assert.match(html, /fonts\.googleapis\.com\/css2\?[^"]*display=swap/);
  assert.doesNotMatch(html, /family=Inter/);
  assert.doesNotMatch(css, /'Inter'/);
  assert.match(css, /html, body \{[^}]*font-family:\s*var\(--font-tekst\)/);
});
