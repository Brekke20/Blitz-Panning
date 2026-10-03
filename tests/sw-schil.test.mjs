// Consistentietests van de app-schil (etappe 7, N16d): de modulepreload-lijst in index.html moet precies de modulegraaf
// zijn (geen ontbrekende, geen overbodige, geen dubbele), en de externe hosts staan in een preconnect.
// De graaf wordt afgeleid uit de <script type="module">-tags van index.html en de STATISCHE import-regels van elk bestand.
// Dynamische import()-randen (lazy: excel-export.js) horen er niet bij: die module wordt niet vooraf opgehaald of geladen, maar staat
// wel in SHELL van sw.js (offline beschikbaar).
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
      const rel = m[1]; // m[2] = dynamische import(): buiten de eager graaf (I4)
      if (!rel) continue;
      wachtrij.push(path.posix.normalize(path.posix.join(path.posix.dirname(pad), rel)));
    }
  }
  return gezien;
}

const preloads = [...html.matchAll(/<link\s+rel="modulepreload"\s+href="([^"]+)"/g)].map(m => m[1]);

test('de modulegraaf is niet leeg en bevat de bekende hoofdmodules', () => {
  const graaf = modulegraaf();
  for (const m of ['/js/kern/brug.js', '/js/app.js', '/js/rapport-wizard.js']) assert.ok(graaf.has(m), m);
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

test('preconnect enkel naar de hosts die de opstart gebruikt (cdnjs, Google Fonts); niet naar jsdelivr (ExcelJS is lazy, M1)', () => {
  assert.ok(html.includes('<link rel="preconnect" href="https://cdnjs.cloudflare.com"'));
  assert.ok(html.includes('<link rel="preconnect" href="https://fonts.googleapis.com"'));
  assert.ok(!html.includes('cdn.jsdelivr.net'), 'index.html verwijst niet naar jsdelivr');
});

test('excel-export.js is lazy (I4): geen script en geen modulepreload in index.html, niet in de eager graaf, wel in SHELL en via import() in app.js', () => {
  assert.ok(!html.includes('excel-export.js'));
  assert.ok(!modulegraaf().has('/js/excel-export.js'));
  assert.match(fs.readFileSync(path.join(PUBLIC, 'js/app.js'), 'utf8'), /import\('\.\/excel-export\.js'\)/);
  assert.ok(fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8').includes("'/js/excel-export.js'"));
});

test('modulepreloads staan na de stijlbladen (M2)', () => {
  const laatsteCss = html.lastIndexOf('rel="stylesheet"');
  assert.ok(laatsteCss > 0);
  assert.ok(html.indexOf('rel="modulepreload"') > laatsteCss, 'eerste modulepreload staat vóór een stylesheet');
});

test('ExcelJS staat in CDN_VAST en wordt vooraf opgehaald: CDN_LUI is leeg (fix-ronde 1, Excel-export offline zoals live)', () => {
  const sw = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  const lui = [...sw.match(/const CDN_LUI = \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(lui, []);
  assert.ok(sw.match(/const CDN_VAST = \[([^\]]*)\]/)[1].includes(EXCELJS_URL));
  assert.match(sw, /cdnLui: CDN_LUI/);
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

// Refactor-tak vóór release: CACHE_NAME staat bewust vast op v25 (de live waarde). De releasestap (docs/release-checklist-2.0.md §1)
// verhoogt hem en past deze test BEWUST aan. Elke latere release die iets onder public/ wijzigt moet hem opnieuw ophogen (CLAUDE.md).
test('N19 (refactor-tak vóór release): CACHE_NAME staat nog op blitz-planning-v25; de releasestap past dit bewust aan', () => {
  assert.match(swBron, /const CACHE_NAME = 'blitz-planning-v25';/);
  assert.match(swBron, /const EXTERN_CACHE = 'blitz-extern-v1';/);
});

test('sw.js: importScripts van sw-strategie.js, /api wordt niet afgehandeld, respondWith enkel bij een antwoord', () => {
  assert.match(swBron, /importScripts\('\/sw-strategie\.js'\)/);
  assert.match(swBron, /strategie\.behandel\(/);
  assert.match(swBron, /if \(r\) e\.respondWith\(r\)/);
  assert.ok(fs.existsSync(path.join(PUBLIC, 'sw-strategie.js')));
});

test('app.js registreert de service worker met updateViaCache: none, pas na de load-gebeurtenis (I5)', () => {
  const app = fs.readFileSync(path.join(PUBLIC, 'js/app.js'), 'utf8');
  assert.match(app, /register\('\/sw\.js', \{ updateViaCache: 'none' \}\)/);
  assert.match(app, /readyState === 'complete'\) registreer\(\); else window\.addEventListener\('load', registreer/);
});

test('sw.js leest ?navTimeout= via SwStrategie.leesNavTimeout met de constante NAV_TIMEOUT_MS (standaard 4000, Q5) als terugval', () => {
  assert.match(swBron, /const NAV_TIMEOUT_MS = 4000;/); // W5-fix (Q5): was 0 (uit)
  assert.match(swBron, /self\.SwStrategie\.leesNavTimeout\(new URL\(self\.location\)\.search, NAV_TIMEOUT_MS\)/);
});
