// tests/window-namen.test.mjs — geen stille uitval door verdwenen window-namen (D27).
// Een `window.<naam>`-lezing (of `typeof <naam> === 'function'` op een kale naam) van een naam die nergens meer gedefinieerd
// wordt, valt stil terug (optionele aanroep, undefined) en laat dus geen fout zien. Deze test scant public/js/**/*.js en
// public/index.html (zonder commentaar) en eist dat elke gelezen naam gedefinieerd is: toegewezen aan window
// (`window.x =`, `Object.defineProperty(window, 'x'`, `Object.assign(window, { x … })`), of een functie/var op het hoogste
// niveau van het klassieke script in index.html (die worden vanzelf een window-eigenschap), of in de browser-allowlist.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Eigenschappen die de browser zelf levert, of die een externe bibliotheek (CDN) op window zet.
const BROWSER = new Set([
  'location', 'localStorage', 'sessionStorage', 'matchMedia', 'open', 'close', 'innerWidth', 'innerHeight', 'scrollTo', 'scrollBy',
  'scrollX', 'scrollY', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'fetch', 'confirm', 'alert', 'screen',
  'navigator', 'document', 'history', 'requestAnimationFrame', 'getComputedStyle', 'setTimeout', 'clearTimeout',
  'SignaturePad', 'L', 'ExcelJS', 'indexedDB', 'Notification', 'ResizeObserver',
]);

// Lokale namen (parameter of variabele binnen één bestand) waarop een typeof-controle terecht is: geen window-naam.
const LOKAAL = new Set(['onBevestig']);

function bestanden(map) {
  const uit = [];
  for (const naam of fs.readdirSync(map, { withFileTypes: true })) {
    const p = path.join(map, naam.name);
    if (naam.isDirectory()) uit.push(...bestanden(p));
    else if (naam.name.endsWith('.js')) uit.push(p);
  }
  return uit;
}

// Commentaar eruit (regel- en blokcommentaar); `//` binnen een URL ("https://") blijft staan.
function zonderCommentaar(tekst) {
  return tekst.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

export function scan(bronnen) {
  const gedefinieerd = new Set();
  const gelezen = new Map(); // naam -> eerste bestand
  const kaleLezingen = new Map();
  for (const { naam, tekst: ruw } of bronnen) {
    const tekst = zonderCommentaar(ruw);
    // window.x, window?.x, globalThis.x, window['x'], window?.['x'] (toewijzing = definitie, anders lezing)
    for (const m of tekst.matchAll(/\b(?:window|globalThis)\??\.([A-Za-z_$][\w$]*)(\s*=(?!=))?/g)) {
      if (m[2]) gedefinieerd.add(m[1]);
      else if (!gelezen.has(m[1])) gelezen.set(m[1], naam);
    }
    for (const m of tekst.matchAll(/\b(?:window|globalThis)\s*(?:\?\.)?\[\s*['"]([\w$]+)['"]\s*\]\s*(=(?!=))?/g)) {
      if (m[2]) gedefinieerd.add(m[1]);
      else if (!gelezen.has(m[1])) gelezen.set(m[1], naam);
    }
    // venster.js zoekt de sluitfunctie van elk tabelvenster dynamisch op (window[naam]): elke naam in de tabel is een lezing.
    if (naam.endsWith('venster.js')) {
      for (const m of tekst.matchAll(/\[\s*'[\w-]+'\s*,\s*'([\w$]+)'\s*\]/g)) {
        if (!gelezen.has(m[1])) gelezen.set(m[1], naam + ' (sluitVia-tabel)');
      }
    }
    for (const m of tekst.matchAll(/Object\.defineProperty\(\s*window\s*,\s*['"]([\w$]+)['"]/g)) gedefinieerd.add(m[1]);
    for (const m of tekst.matchAll(/Object\.assign\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
      for (const k of m[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*[:,]/gm)) gedefinieerd.add(k[1]);
    }
    // Een naam die in dit bestand geïmporteerd wordt (`import { x }`, `import { y as x }`) is een gewone binding, geen window-naam.
    const geimporteerd = new Set();
    for (const m of tekst.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
      for (const k of m[1].split(',')) { const l = k.trim().split(/\s+as\s+/).pop(); if (l) geimporteerd.add(l); }
    }
    for (const m of tekst.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*===?\s*['"]function['"]/g)) {
      if (geimporteerd.has(m[1])) continue;
      if (!kaleLezingen.has(m[1])) kaleLezingen.set(m[1], naam);
    }
    // Functies en var op het hoogste niveau (kolom 0) van een klassiek script worden vanzelf window-eigenschappen.
    if (naam.endsWith('index.html')) {
      for (const m of tekst.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) gedefinieerd.add(m[1]);
      for (const m of tekst.matchAll(/^var\s+([A-Za-z_$][\w$]*)/gm)) gedefinieerd.add(m[1]);
    }
  }
  const ontbrekend = [];
  for (const [n, f] of gelezen) if (!gedefinieerd.has(n) && !BROWSER.has(n)) ontbrekend.push(`window.${n} (gelezen in ${f})`);
  for (const [n, f] of kaleLezingen) if (!gedefinieerd.has(n) && !BROWSER.has(n) && !LOKAAL.has(n)) ontbrekend.push(`typeof ${n} (gelezen in ${f})`);
  return ontbrekend;
}

const bronnen = () => [
  ...bestanden(path.join(PUBLIC, 'js')).map(p => ({ naam: path.relative(PUBLIC, p).replace(/\\/g, '/'), tekst: fs.readFileSync(p, 'utf8') })),
  { naam: 'index.html', tekst: fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8') },
];

test('elke window.<naam>-lezing en typeof-controle verwijst naar een gedefinieerde naam', () => {
  assert.deepEqual(scan(bronnen()), []);
});

test('de scan vindt een lezing van een naam zonder definitie (zelftest)', () => {
  const weg = scan([{ naam: 'x.js', tekst: "const a = window.getActiveAssignee ? window.getActiveAssignee() : 'all';" }]);
  assert.deepEqual(weg, ['window.getActiveAssignee (gelezen in x.js)']);
});

test('de scan accepteert toewijzing, defineProperty, Object.assign, top-level functies en de allowlist (zelftest)', () => {
  const ok = scan([
    { naam: 'a.js', tekst: "window.a1 = 1; Object.defineProperty(window, 'a2', {}); Object.assign(window, {\n  a3: x,\n  a4,\n});\nwindow.location.href; window.a1(); window.a2; window.a3; window.a4;" },
    { naam: 'index.html', tekst: "function a5() {}\nasync function a6() {}\nwindow.a5; window.a6; if (typeof a5 === 'function') a5();" },
  ]);
  assert.deepEqual(ok, []);
});

test('een typeof-controle op een kale naam zonder definitie wordt gevonden (zelftest)', () => {
  assert.deepEqual(scan([{ naam: 'x.js', tekst: "if (typeof metBehoudScroll === 'function') metBehoudScroll(render);" }]), ['typeof metBehoudScroll (gelezen in x.js)']);
});

test('een typeof-controle op een geïmporteerde naam is geen window-lezing (zelftest)', () => {
  assert.deepEqual(scan([{ naam: 'x.js', tekst: "import { metBehoudScroll } from './kern/ui.js';\nif (typeof metBehoudScroll === 'function') metBehoudScroll(render);" }]), []);
  assert.deepEqual(scan([{ naam: 'y.js', tekst: "import { a as metBehoudScroll, b } from './x.js';\nif (typeof metBehoudScroll === 'function') b();" }]), []);
});

test("window['x'], window?.x en globalThis.x tellen als lezing (zelftest)", () => {
  const r = scan([{ naam: 'x.js', tekst: "window['a'](); window?.b; window?.['c']; globalThis.d; globalThis.ok = 1; globalThis.ok;" }]);
  assert.deepEqual(r.sort(), ['window.a (gelezen in x.js)', 'window.b (gelezen in x.js)', 'window.c (gelezen in x.js)', 'window.d (gelezen in x.js)']);
});

test('een sluitVia-tabelnaam in venster.js zonder definitie wordt gevonden (zelftest)', () => {
  const r = scan([{ naam: 'js/venster.js', tekst: "[\n  ['result-overlay', 'closeWeg'],\n].forEach(x => x);" }]);
  assert.deepEqual(r, ['window.closeWeg (gelezen in js/venster.js (sluitVia-tabel))']);
});

test('commentaar telt niet mee (zelftest)', () => {
  assert.deepEqual(scan([{ naam: 'x.js', tekst: '// window.weg()\n/* window.ook() */\nconst u = "https://x.be/a";' }]), []);
});

// ── Kale namen van het voormalige klassieke script (etappe 5b, taak 8) ──
// Het klassieke <script> van index.html is een module geworden (public/js/app.js): zijn top-level namen zijn geen
// window-globals meer. Een kale lezer elders (oudere module, inline handler, e2e-evaluate) zou dus een ReferenceError geven
// (of, achter `typeof`/`?.`, stil niets doen). Elk bestand behalve app.js mag zo'n naam enkel kaal gebruiken als het hem zelf
// definieert of importeert.
const VOORMALIG_KLASSIEK = [
  'PRIO_LABEL', 'prioLabel', 'DUMMY_DATA', 'startInvPoll', 'stopInvPoll', 'easterDate', 'getBelgianHolidays', 'getHolidayName',
  'duurVoor', 'zetTopbarHoogte', 'bewaarSchermStaat', 'planHerstelSchermStaat', 'vraagRolOpTablet', 'loadFromCache', 'saveToCache',
  'normAdres', 'loadGeocache', 'geocacheLookup', 'geocacheStore', 'metBehoudScroll', 'sjLog', 'pasPlanningSindsToe',
  'laadPlanningSinds', 'applyTicketsData', 'loadTickets', 'initials', 'personenUitTickets', 'valideerActievePersoon',
  'buildPersonSelector', 'updatePersonHeader', 'zetPersonMenuOpen', 'togglePersonMenu', 'selectPerson', 'koppelRenders',
  'reconcilePlanning', 'startTicketPolling', 'updateTabIndicator', 'setTab', 'pasRolBeperkingToe', 'navigate', 'meervoud', 'toggleTheme',
];

export function kaleLezers(bronnen, namen = VOORMALIG_KLASSIEK) {
  const uit = [];
  for (const { naam, tekst: ruw } of bronnen) {
    if (naam === 'js/app.js') continue;
    const tekst = zonderCommentaar(ruw);
    for (const n of namen) {
      const gebruik = new RegExp(String.raw`(?<![\w$.'"\`-])${n}(?![\w$'"\`:-])`);
      if (!gebruik.test(tekst)) continue;
      const geimporteerd = [...tekst.matchAll(/import\s*\{([^}]*)\}\s*from/g)].some(m => m[1].split(',').some(k => k.trim().split(/\s+as\s+/).pop() === n));
      const eigen = new RegExp(String.raw`(?:function\s+${n}\b|\b(?:const|let|var)\s+${n}\b|\{[^}]*\b${n}\b[^}]*\}\s*=|\{[^}]*\b${n}\b[^}]*\}\s*\)\s*(?:\{|=>))`).test(tekst) || geimporteerd;
      if (!eigen) uit.push(`${n} (kaal gelezen in ${naam})`);
    }
  }
  return uit;
}

const e2eBronnen = () => {
  const map = path.join(PUBLIC, '..', 'e2e');
  const lijst = [];
  const loop = (m) => { for (const d of fs.readdirSync(m, { withFileTypes: true })) { const p = path.join(m, d.name); if (d.isDirectory()) { if (d.name !== 'fixtures') loop(p); } else if (d.name.endsWith('.mjs')) lijst.push({ naam: 'e2e/' + path.relative(map, p).split(path.sep).join('/'), tekst: fs.readFileSync(p, 'utf8') }); } };
  loop(map);
  return lijst;
};

test('geen kale lezer van een voormalige klassieke-script-naam in public/js, index.html of e2e', () => {
  assert.deepEqual(kaleLezers([...bronnen(), ...e2eBronnen()]), []);
});

test('de kale-lezerscan vindt een kale oproep en accepteert import, eigen definitie, eigenschap en object-sleutel (zelftest)', () => {
  assert.deepEqual(kaleLezers([{ naam: 'js/x.js', tekst: 'setTab("kalender");' }]), ['setTab (kaal gelezen in js/x.js)']);
  assert.deepEqual(kaleLezers([{ naam: 'e2e/x.mjs', tekst: 'await page.evaluate(() => loadTickets());' }]), ['loadTickets (kaal gelezen in e2e/x.mjs)']);
  assert.deepEqual(kaleLezers([{ naam: 'js/x.js', tekst: "import { meervoud } from './a.js';\nmeervoud(1, 'a', 'b');" }]), []);
  assert.deepEqual(kaleLezers([{ naam: 'js/x.js', tekst: 'function navigate(x) {}\nnavigate(1);' }]), []);
  assert.deepEqual(kaleLezers([{ naam: 'js/x.js', tekst: "afh.navigate(1); const o = { navigate: 1 }; kern.x.setTab('a'); 'setTab';" }]), []);
  assert.deepEqual(kaleLezers([{ naam: 'js/app.js', tekst: 'setTab("kalender");' }]), []);
});
