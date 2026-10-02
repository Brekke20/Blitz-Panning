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

// ---- N16 a/b/c en N19: SHELL en CDN_VAST van sw.js tegenover de bestanden op schijf en index.html ----
import { EXCELJS_URL } from '../public/js/kern/exceljs.js';

const swBron = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
const lijst = (naam) => {
  const m = swBron.match(new RegExp('const ' + naam + ' = \\[([^\\]]*)\\]'));
  assert.ok(m, `${naam} niet gevonden in sw.js`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
function bestanden(map, ext) {
  const uit = [];
  for (const e of fs.readdirSync(path.join(PUBLIC, map), { withFileTypes: true })) {
    const rel = `${map}/${e.name}`;
    if (e.isDirectory()) uit.push(...bestanden(rel, ext));
    else if (e.name.endsWith(ext)) uit.push('/' + rel);
  }
  return uit;
}

test('N16a: elke SHELL-regel bestaat in public/ (en geen dubbelen)', () => {
  const shell = lijst('SHELL');
  assert.deepEqual(shell.filter((p, i) => shell.indexOf(p) !== i), [], 'dubbele SHELL-regels');
  for (const p of shell) {
    const rel = p === '/' ? 'index.html' : p.slice(1);
    assert.ok(fs.existsSync(path.join(PUBLIC, rel)), `${p} staat in SHELL maar niet in public/`);
  }
});

test('N16b: elk .js onder public/js en .css onder public/css staat in SHELL', () => {
  const shell = lijst('SHELL');
  for (const p of [...bestanden('js', '.js'), ...bestanden('css', '.css')]) assert.ok(shell.includes(p), `${p} ontbreekt in SHELL`);
});

test('N16c: CDN_VAST is gelijk aan de externe script/link van index.html plus de ExcelJS-URL (fonts apart)', () => {
  const extern = [...html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="(https:\/\/[^"]+)"[^>]*>/g)]
    .filter((m) => !/rel="(?:preconnect|dns-prefetch)"/.test(m[0]))
    .map((m) => m[1])
    .filter((u) => !/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u));
  // Leaflet laadt zijn pictogrammen (markers, lagenknop) relatief aan leaflet.css; ze staan op dezelfde vaste versie in CDN_VAST,
  // zodat de kaart ook offline volledige pictogrammen heeft (Task 5).
  const leafletCss = extern.find((u) => /\/leaflet\/[\d.]+\/leaflet\.min\.css$/.test(u));
  assert.ok(leafletCss, 'leaflet.min.css staat in index.html');
  const leafletMap = leafletCss.replace(/leaflet\.min\.css$/, 'images/');
  const leafletAfbeeldingen = ['marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png', 'layers.png', 'layers-2x.png'].map((n) => leafletMap + n);
  assert.deepEqual([...lijst('CDN_VAST')].sort(), [...new Set([...extern, EXCELJS_URL, ...leafletAfbeeldingen])].sort());
  for (const u of lijst('CDN_VAST')) assert.match(u, /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//);
});

test('N16c: FONT_HOSTS dekt de Google Fonts-verwijzing van index.html', () => {
  const hosts = lijst('FONT_HOSTS');
  assert.deepEqual(hosts.sort(), ['fonts.googleapis.com', 'fonts.gstatic.com']);
  assert.ok(html.includes('https://fonts.googleapis.com/css2'));
});

test('N19: CACHE_NAME blijft blitz-planning-v25 tot de release (bij de bump van etappe 9 bewust aanpassen)', () => {
  assert.match(swBron, /const CACHE_NAME = 'blitz-planning-v25';/);
  assert.match(swBron, /const EXTERN_CACHE = 'blitz-extern-v1';/);
});

test('sw.js: importScripts van sw-strategie.js, /api wordt niet afgehandeld, respondWith enkel bij een antwoord', () => {
  assert.match(swBron, /importScripts\('\/sw-strategie\.js'\)/);
  assert.match(swBron, /strategie\.behandel\(/);
  assert.match(swBron, /if \(r\) e\.respondWith\(r\)/);
  assert.ok(fs.existsSync(path.join(PUBLIC, 'sw-strategie.js')));
});

test('app.js registreert de service worker met updateViaCache: none', () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'js/app.js'), 'utf8');
  assert.match(app, /register\('\/sw\.js', \{ updateViaCache: 'none' \}\)/);
});

test('sw.js leest ?navTimeout= via SwStrategie.leesNavTimeout met de constante NAV_TIMEOUT_MS (standaard 0) als terugval', () => {
  assert.match(swBron, /const NAV_TIMEOUT_MS = 0;/);
  assert.match(swBron, /self\.SwStrategie\.leesNavTimeout\(new URL\(self\.location\)\.search, NAV_TIMEOUT_MS\)/);
});
