// Consistentietests van de app-schil (etappe 7, N16d): de modulepreload-lijst in index.html moet precies de modulegraaf
// zijn (geen ontbrekende, geen overbodige, geen dubbele), en de externe hosts staan in een preconnect.
// De graaf wordt afgeleid uit de <script type="module">-tags van index.html en de import-regels van elk bestand
// (statisch én dynamisch: een lazy geladen module wordt wel vooraf opgehaald, niet uitgevoerd).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');

const IMPORT_RE = /(?:^|[^\w$.])(?:import|export)\s*(?:[^'"`;()]*?\sfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

function modulegraaf() {
  const start = [...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)].map(m => m[1]);
  const gezien = new Set();
  const wachtrij = [...start];
  while (wachtrij.length) {
    const pad = wachtrij.shift();
    if (gezien.has(pad)) continue;
    gezien.add(pad);
    const bron = fs.readFileSync(path.join(PUBLIC, pad), 'utf8');
    for (const m of bron.matchAll(IMPORT_RE)) {
      const rel = m[1] || m[2];
      wachtrij.push(path.posix.normalize(path.posix.join(path.posix.dirname(pad), rel)));
    }
  }
  return gezien;
}

const preloads = [...html.matchAll(/<link\s+rel="modulepreload"\s+href="([^"]+)"/g)].map(m => m[1]);

test('de modulegraaf is niet leeg en bevat de bekende hoofdmodules', () => {
  const graaf = modulegraaf();
  for (const m of ['/js/kern/brug.js', '/js/app.js', '/js/excel-export.js', '/js/rapport-wizard.js']) assert.ok(graaf.has(m), m);
  assert.ok(graaf.size > 40, `graaf telt ${graaf.size}`);
});

test('modulepreload: precies de modulegraaf, zonder dubbelen', () => {
  const graaf = modulegraaf();
  const dubbel = preloads.filter((p, i) => preloads.indexOf(p) !== i);
  assert.deepEqual(dubbel, [], 'dubbele modulepreload-tags');
  assert.deepEqual([...graaf].filter(p => !preloads.includes(p)), [], 'modules zonder modulepreload');
  assert.deepEqual(preloads.filter(p => !graaf.has(p)), [], 'modulepreload voor een module die niet (meer) in de graaf zit');
});

test('modulepreload: de kritieke keten (brug.js, app.js) staat vooraan', () => {
  assert.equal(preloads[0], '/js/kern/brug.js');
  assert.ok(preloads.indexOf('/js/app.js') < 3);
});

test('preconnect naar de twee CDN-hosts', () => {
  for (const host of ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net']) {
    assert.ok(html.includes(`<link rel="preconnect" href="${host}"`), host);
  }
});

test('ExcelJS staat niet meer als synchroon script in index.html (N2)', () => {
  assert.doesNotMatch(html, /<script[^>]+exceljs/i);
});

test('elke module van de graaf staat in SHELL van sw.js (N19)', () => {
  const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  const shell = sw.match(/const SHELL = \[([^\]]*)\]/)[1];
  for (const m of modulegraaf()) assert.ok(shell.includes(`'${m}'`), `${m} ontbreekt in SHELL`);
});
