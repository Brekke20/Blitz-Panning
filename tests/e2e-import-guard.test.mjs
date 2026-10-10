// Importguard van de e2e-suite (etappe 5a, fix-ronde 1). Draait bij elke `node --test`, dus niet te
// omzeilen met `playwright test <spec>` of `-g`. Scant ALLE bestanden onder e2e/ recursief.
//  - Elke *.spec.mjs importeert `test` enkel uit ./helpers.mjs, of (onder e2e/productie/) enkel uit
//    ../productie-hulp.mjs. @playwright/test, playwright/test en playwright(-core) rechtstreeks: fout.
//  - Dynamische import/require met een niet-letterlijke naam: fout (niet te scannen).
//  - Productiebestanden: geen waitForTimeout; ?test en X-Blitz-Test enkel in een expliciete bestandslijst.
//  - Productiebestanden (behalve productie-hulp/-waarnemer): geen eigen routes (page.route, context.route,
//    unroute, routeFromHAR, routeWebSocket, route.continue/fallback); stubs komen enkel uit de fixture-API.
//  - Productiebestanden: geen node:module/createRequire, child_process, vm, eval, new Function.
//  - Productiebestanden (behalve de fixtures en de zelftest): geen APIRequestContext (page.request, context.request, .request.,
//    de `request`-fixture), geen browser.newContext/newPage/browser., geen node:http/https/net/tls/dns/http2, geen fetch( ;
//    dat alles loopt langs de routes van het vangnet heen.
//  - Productiebestanden (behalve de fixtures): geen test.use(, test.extend( en geen woord `serviceWorkers`; de fixture zet
//    `serviceWorkers: 'block'` en een spec zou dat anders met test.use({ serviceWorkers: 'allow' }) kunnen omzeilen.
//  - Ontsnappingskleppen (waarnemer, buitenHost, lekmeldingen wissen) enkel in de zelftest-bestanden.
//  - Derde klasse (etappe 7, Task 5): service worker-bestanden = e2e/sw/** en e2e/sw-*.mjs. Voor hen gelden alle productieregels,
//    maar specs importeren enkel ../sw-hulp.mjs (nooit helpers.mjs, productie-hulp.mjs of @playwright/test); de fixture
//    e2e/sw-hulp.mjs importeert enkel ./productie-hulp.mjs en ./sw-waarnemer.mjs. De woorden `serviceWorkers` en `setOffline`
//    staan enkel in de fixtures (e2e/sw-hulp.mjs): een spec bedient het offline-slot en de SW-modus enkel via de fixture-API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const WORTEL = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const E2E = path.join(WORTEL, 'e2e');

// Mogen @playwright/test zelf importeren (de twee fixtures).
const PLAYWRIGHT_TOEGESTAAN = new Set(['e2e/helpers.mjs', 'e2e/productie-hulp.mjs']);
// Mogen de interne waarnemer en de lekmeldingen aanraken.
const ZELFTEST = new Set([
  'e2e/productie/vangnet-zelftest.spec.mjs', 'e2e/productie/zelftest-hulp.mjs',
  'e2e/sw/vangnet-zelftest.spec.mjs', 'e2e/sw/zelftest-hulp.mjs',
]);
// Expliciete uitzonderingen op het ?test / X-Blitz-Test-verbod (per bestand). Nooit voor waitForTimeout.
const TESTWOORD_TOEGESTAAN = new Set([
  'e2e/productie-hulp.mjs',
  'e2e/productie-waarnemer.mjs',
  'e2e/productie/opstart.spec.mjs',
]);
// De twee fixture-bestanden: enkel zij mogen routes registreren.
const PRODUCTIE_FIXTURES = new Set(['e2e/productie-hulp.mjs', 'e2e/productie-waarnemer.mjs', 'e2e/sw-hulp.mjs', 'e2e/sw-waarnemer.mjs']);
// Toegestane imports per productiebestand (naast node:*); een ander bestand mag enkel ../productie-hulp.mjs.
const PRODUCTIE_IMPORTS = {
  'e2e/productie-hulp.mjs': ['@playwright/test', './helpers.mjs', './productie-waarnemer.mjs'],
  'e2e/productie-waarnemer.mjs': ['./vangnet-regels.mjs'],
  'e2e/productie/zelftest-hulp.mjs': ['../productie-waarnemer.mjs'],
  'e2e/productie/vangnet-zelftest.spec.mjs': ['../productie-hulp.mjs', './zelftest-hulp.mjs'],
  'e2e/sw-hulp.mjs': ['./productie-hulp.mjs', './sw-waarnemer.mjs'],
  'e2e/sw-waarnemer.mjs': [],
  'e2e/sw/zelftest-hulp.mjs': ['../sw-waarnemer.mjs', '../productie/zelftest-hulp.mjs'],
  'e2e/sw/vangnet-zelftest.spec.mjs': ['../sw-hulp.mjs', './zelftest-hulp.mjs'],
};

const PLAYWRIGHT_MODULE = /^(@playwright\/test|playwright(-core)?(\/test)?)$/;
const IMPORT_PATRONEN = [
  /\b(?:from|import)\s*['"]([^'"]+)['"]/g, // import 'x', import a from 'x', export * from 'x', export {a} from 'x'
  /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('x'), require('x')
];
const DYNAMISCH_NIET_LETTERLIJK = /\b(?:import|require)\s*\(\s*(?!['"])/;
const MUTATIE = '(?:\\.(?:length\\s*=(?!=)|splice\\s*\\(|pop\\s*\\(|shift\\s*\\(|push\\s*\\(|fill\\s*\\()|\\s*=(?!=))';
// Routes (a): elke eigen route in een spec kan het strenge slot omzeilen (page.route gaat voor op context.route,
// continue() laat een verzoek echt naar buiten). Alleen de fixture-bestanden mogen routes registreren.
const ROUTE_PATRONEN = [
  /\.\s*(?:un)?route\w*\s*\(/, // page.route(, context.route(, .unroute(, .unrouteAll(, .routeFromHAR(, .routeWebSocket(
  /\b(?:unrouteAll|unroute|routeFromHAR|routeWebSocket)\b/, // ook zonder punt (destructuring, doorgegeven)
  /\[\s*['"`](?:un)?route\w*['"`]\s*\]/, // page['route'](...)
  /\broute\s*\.\s*(?:continue|fallback)\b/, // route.continue / route.fallback
  /\.\s*(?:continue|fallback)\s*\(/, // route.continue() via een alias
  /\.\s*route\s*(?:[;,)\]}=]|$)/m, // alias zonder aanroep: const r = page.route;
  /\{[^}]*\broute\b[^}]*\}\s*=\s*(?:page|context)\b/, // const { route } = page;
];
// (b) Manieren om buiten de scan om code te laden of uit te voeren.
const UITVOER_MODULES = /^(?:node:)?(?:module|child_process|vm|worker_threads|cluster)$/;
const UITVOER_PATRONEN = [/\bcreateRequire\b/, /\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/];
// (c) Netwerk buiten de routes van het vangnet om: APIRequestContext, een eigen browsercontext en node-netwerkmodules.
const NETWERK_MODULES = /^(?:node:)?(?:http|https|net|tls|dns|http2)(?:\/.*)?$/;
const NETWERK_PATRONEN = [
  [/\b(?:page|context)\s*\.\s*request\b/, 'page.request/context.request'],
  [/\.\s*request\s*\./, '.request.'],
  [/\(\s*\{[^}]*\brequest\b[^}]*\}\s*[,)]/, 'request-fixture'],
  [/\.\s*(?:newContext|newPage)\s*\(/, 'newContext/newPage'],
  [/\bbrowser\s*\./, 'browser.'],
  [/\(\s*\{[^}]*\bbrowser\b[^}]*\}\s*[,)]/, 'browser-fixture'],
  // Toegestaan: enkel een browser-fetch met een letterlijke relatieve string als eerste argument (fetch('/api/…' of fetch("/api/…")):
  // die blijft same-origin en wordt door de fixture gestubd. Al het andere (variabele, template, absolute url, window/globalThis.fetch) faalt.
  [/(?<![\w$.])fetch\s*\((?!\s*['"]\/api\/)|\b(?:globalThis|global|window)\s*\.\s*fetch\b/, 'fetch('],
];
const KLEP_NAMEN = /\b(buitenHost|ongeoorloofd|testSignalen|neemGeblokkeerdeProbesOver|neemSwProbesOver|swOvertredingen|voorNavigatie|productie-waarnemer|sw-waarnemer|zelftest-hulp)\b/;
const KLEP_MUTATIE = new RegExp(`\\.(?:onverwacht|alle|schrijven|websockets)\\s*${MUTATIE}|\\bconsoleFouten\\s*${MUTATIE}`);

function importsVan(tekst) {
  const uit = [];
  for (const re of IMPORT_PATRONEN) for (const m of tekst.matchAll(re)) uit.push(m[1]);
  return uit;
}

// bestanden: [{ pad: 'e2e/...', tekst }] -> lijst met overtredingen (leeg = in orde)
export function controleer(bestanden) {
  const fouten = [];
  for (const { pad, tekst } of bestanden) {
    // Blokcommentaar eruit voor de scans (anders is `import/*x*/('...')` onzichtbaar).
    const kaal = tekst.replace(/\/\*[\s\S]*?\*\//g, ' ');
    const imports = importsVan(kaal);
    const isSpec = pad.endsWith('.spec.mjs');
    const sw = pad.startsWith('e2e/sw/') || pad.startsWith('e2e/sw-');
    const productie = pad.startsWith('e2e/productie/') || pad.startsWith('e2e/productie-') || sw;
    const fout = (m) => fouten.push(`${pad}: ${m}`);

    if (DYNAMISCH_NIET_LETTERLIJK.test(kaal)) fout('import/require met een niet-letterlijke naam');
    if (!PLAYWRIGHT_TOEGESTAAN.has(pad)) {
      for (const i of imports) if (PLAYWRIGHT_MODULE.test(i)) fout(`importeert ${i} rechtstreeks`);
    }
    for (const i of imports) {
      if (/productie/.test(i) && !productie) fout(`importeert ${i} buiten de productiebestanden`);
      if (/(^|\/)sw-(hulp|waarnemer)\.mjs$/.test(i) && !sw) fout(`importeert ${i} buiten de sw-bestanden`);
    }

    if (isSpec && !pad.startsWith('e2e/productie/') && !sw) {
      if (!imports.includes('./helpers.mjs')) fout('importeert test niet uit ./helpers.mjs');
    }
    if (productie) {
      const toegestaan = new Set(PRODUCTIE_IMPORTS[pad] ?? [sw ? '../sw-hulp.mjs' : '../productie-hulp.mjs']);
      for (const i of imports) {
        if (!i.startsWith('node:') && !toegestaan.has(i)) fout(`importeert ${i} (toegestaan: ${[...toegestaan].join(', ')})`);
      }
      if (isSpec && pad.startsWith('e2e/productie/') && !imports.includes('../productie-hulp.mjs')) {
        fout('importeert test niet uit ../productie-hulp.mjs');
      }
      if (isSpec && sw && !imports.includes('../sw-hulp.mjs')) fout('importeert test niet uit ../sw-hulp.mjs');
      if (sw && !isSpec && !PRODUCTIE_FIXTURES.has(pad) && !ZELFTEST.has(pad)) fout('onbekend bestand in de sw-klasse (geen fixture, geen zelftest, geen spec)');
      if (/waitForTimeout/.test(tekst)) fout('waitForTimeout');
      for (const i of imports) if (UITVOER_MODULES.test(i)) fout(`importeert ${i}`);
      if (!PRODUCTIE_FIXTURES.has(pad) && !ZELFTEST.has(pad)) {
        for (const i of imports) if (NETWERK_MODULES.test(i)) fout(`importeert netwerkmodule ${i}`);
        for (const [re, naam] of NETWERK_PATRONEN) if (re.test(kaal)) fout(`omzeilt het vangnet (${naam})`);
      }
      for (const re of UITVOER_PATRONEN) if (re.test(kaal)) fout(`gebruikt ${re.source}`);
      if (!PRODUCTIE_FIXTURES.has(pad)) {
        // Fixture-opties overschrijven (o.a. serviceWorkers: 'block' van het vangnet) kan alleen via test.use / test.extend.
        if (/\.\s*use\s*\(/.test(kaal)) fout('test.use( in een productiespec (overschrijft fixture-opties zoals serviceWorkers)');
        if (/\.\s*extend\s*\(/.test(kaal)) fout('test.extend( in een productiespec (overschrijft fixtures)');
        // Haakjesvorm, alias zonder aanroep en destructuring van test.
        if (/[\w$)\]]\s*\[\s*['"`](?:use|extend)['"`]\s*\]/.test(kaal)) fout("test['use'](/test['extend']( in een productiespec");
        if (/\.\s*(?:use|extend)\s*(?:[;,)\]}=]|$)/m.test(kaal)) fout('test.use/test.extend als alias (zonder aanroep) in een productiespec');
        if (/\{[^}]*\b(?:use|extend)\b[^}]*\}\s*=\s*[\w$.]*test\b/.test(kaal)) fout('destructuring van use/extend uit test in een productiespec');
        if (/\bserviceWorkers\b/.test(tekst)) fout('serviceWorkers in een productiespec (het slot staat in de fixture)');
        if (/\bsetOffline\b/.test(tekst)) fout('setOffline in een productie- of sw-spec (het offline-slot loopt enkel via de fixture-API)');
      }
      if (!PRODUCTIE_FIXTURES.has(pad)) {
        for (const re of ROUTE_PATRONEN) if (re.test(kaal)) fout(`registreert of omzeilt routes (${re.source})`);
      }
      if (!TESTWOORD_TOEGESTAAN.has(pad)) {
        if (/\?test\b/.test(tekst)) fout('?test');
        if (/x-blitz-test/i.test(tekst)) fout('X-Blitz-Test');
      }
      if (!ZELFTEST.has(pad) && !PRODUCTIE_FIXTURES.has(pad)) {
        if (KLEP_NAMEN.test(tekst)) fout(`raakt een ontsnappingsklep aan (${tekst.match(KLEP_NAMEN)[1]})`);
        if (KLEP_MUTATIE.test(tekst)) fout('wist of wijzigt een lekmelding of consolefout');
      }
    }
  }
  return fouten;
}

function lees(map, uit = []) {
  for (const e of fs.readdirSync(map, { withFileTypes: true })) {
    const vol = path.join(map, e.name);
    if (e.isDirectory()) lees(vol, uit);
    else if (/\.(mjs|js|cjs|ts)$/.test(e.name)) {
      uit.push({ pad: path.relative(WORTEL, vol).split(path.sep).join('/'), tekst: fs.readFileSync(vol, 'utf8') });
    }
  }
  return uit;
}

test('e2e-importguard: de echte e2e-map is in orde (recursief)', () => {
  const bestanden = lees(E2E);
  const specs = bestanden.filter(b => b.pad.endsWith('.spec.mjs'));
  assert.ok(specs.length > 10, 'verwacht veel specs');
  assert.ok(specs.some(b => b.pad.startsWith('e2e/productie/')), 'productiespecs worden meegescand');
  assert.ok(bestanden.some(b => b.pad === 'e2e/productie-hulp.mjs'));
  assert.deepEqual(controleer(bestanden), []);
});

// ── Het patroon zelf: slechte invoer moet falen. Modulenamen zijn samengesteld, zodat dit bestand niet zichzelf raakt. ──
const PW = '@play' + 'wright/test';
const slecht = (pad, tekst) => controleer([{ pad, tekst }]);
const HELP = "import { test } from './helpers.mjs';\n";
const PROD = "import { test } from '../productie-hulp.mjs';\n";
const ZELF = PROD + "import { n } from './zelftest-hulp.mjs';\n";

test('guard: rechtstreekse playwright-import faalt in elke vorm', () => {
  for (const regel of [
    `import { test } from '${PW}';`, `import '${PW}';`, `export * from '${PW}';`, `export { test } from '${PW}';`,
    `const t = await import('${PW}');`, `const t = require('${PW}');`, `import { test } from "${PW.slice(1)}";`,
    `import { test } from 'playwright-core';`,
  ]) {
    assert.notDeepEqual(slecht('e2e/x.spec.mjs', HELP + regel), [], regel);
    assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
    assert.notDeepEqual(slecht('e2e/kalender-hulp.mjs', regel), [], regel);
  }
});

test('guard: dynamische import met niet-letterlijke naam faalt', () => {
  assert.notDeepEqual(slecht('e2e/x.spec.mjs', HELP + 'await import(naam);'), []);
  assert.notDeepEqual(slecht('e2e/x.spec.mjs', HELP + 'await import(`${a}`);'), []);
  assert.notDeepEqual(slecht('e2e/x.spec.mjs', HELP + 'require(naam);'), []);
});

test('guard: een spec moet test uit de juiste fixture halen', () => {
  assert.notDeepEqual(slecht('e2e/x.spec.mjs', 'const a = 1;'), []);
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', HELP), []);
  assert.notDeepEqual(slecht('e2e/x.spec.mjs', HELP + "import { test } from './productie-hulp.mjs';"), []);
  assert.deepEqual(slecht('e2e/x.spec.mjs', HELP), []);
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD), []);
});

test('guard: productiebestanden mogen niets anders importeren', () => {
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "import { stubExtern } from '../helpers.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "import { waarnemer } from '../productie-waarnemer.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "import { n } from './zelftest-hulp.mjs';"), []);
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "import fs from 'node:fs';"), []);
});

test('guard: waitForTimeout, ?test en X-Blitz-Test in productiespecs', () => {
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + 'await page.waitForTimeout(5);'), []);
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "await page.goto('/?te" + "st');"), []);
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "headers['X-Blitz-" + "Test'] = '1';"), []);
  // De uitzonderingslijst geldt enkel voor ?test / X-Blitz-Test, nooit voor waitForTimeout.
  assert.deepEqual(slecht('e2e/productie/opstart.spec.mjs', PROD + '// zonder ?te' + 'st'), []);
  assert.notDeepEqual(slecht('e2e/productie/opstart.spec.mjs', PROD + 'await page.waitForTimeout(5);'), []);
});

test('guard: ontsnappingskleppen alleen in de zelftest', () => {
  for (const regel of [
    'verzoeken.buitenHost.length = 0;', 'verzoeken.buitenHost.splice(0);', 'expect(verzoeken.buitenHost).toEqual([]);',
    'neemGeblokkeerdeProbesOver(page, verzoeken);', 'verzoeken.onverwacht.length = 0;', 'verzoeken.alle.pop();',
    'consoleFouten.length = 0;', 'consoleFouten.splice(0);', 'verzoeken.onverwacht = [];',
  ]) {
    assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
    assert.deepEqual(slecht('e2e/productie/vangnet-zelftest.spec.mjs', ZELF + regel), [], regel);
  }
  // Lezen van onverwacht/alle blijft toegestaan.
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + 'expect(verzoeken.onverwacht).toEqual([]);'), []);
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "const n = verzoeken.alle.filter(r => r.pad === '/a');"), []);
});

test('guard: eigen routes in productiebestanden (behalve de fixtures) falen', () => {
  for (const regel of [
    "await page.route('**/*', r => r.continue());", "await context.route(u => true, r => r.fulfill({}));",
    "await page.unroute('**/*');", "await context.unrouteAll();", "await page.routeFromHAR('x.har');",
    "await page.routeWebSocket('/ws', () => {});", "route.continue();", "route.fallback();",
    "await page['route']('**/*', h);", "await page.\n route('**/*', h);", "const r = page.route; r.call(page);",
    "await page.route /* x */ ('**/*', h);", "const { unrouteAll } = context;", "h.continue();",
  ]) {
    assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
    assert.notDeepEqual(slecht('e2e/productie/vangnet-zelftest.spec.mjs', ZELF + regel), [], regel);
  }
  // De fixtures zelf mogen routes registreren.
  assert.deepEqual(slecht('e2e/productie-waarnemer.mjs', "import { isToegestaan } from './vangnet-regels.mjs';\nawait context.route(u => true, r => r.fallback());"), []);
  // Het woord 'route' in gewone tekst of een URL-pad is geen route-registratie.
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "await page.goto('/#route'); const p = '/api/route';"), []);
});

test('guard: commentaar verstopt een import niet', () => {
  assert.notDeepEqual(slecht('e2e/x.spec.mjs', HELP + "await import/*x*/('" + PW + "');"), []);
  assert.notDeepEqual(slecht('e2e/x.spec.mjs', HELP + "import /* x */ { test } from /* y */ '" + PW + "';"), []);
});

test('guard: geen module-/proces-/eval-ontsnapping in productiebestanden', () => {
  for (const regel of [
    "import { createRequire } from 'node:module';", "import module from 'module';", "import cp from 'node:child_process';",
    "import cp from 'child_process';", "import vm from 'node:vm';", "const r = createRequire(import.meta.url);",
    "eval('1');", "const f = new Function('return 1');", "const f = Function('return 1');",
  ]) {
    assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
    assert.notDeepEqual(slecht('e2e/productie-hulp.mjs', regel), [], regel);
  }
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "import fs from 'node:fs'; import path from 'node:path';"), []);
});

test('guard: netwerkmodules in productiespecs falen (met en zonder node:-voorvoegsel)', () => {
  for (const m of ['http', 'https', 'net', 'tls', 'dns', 'http2', 'dns/promises']) {
    for (const naam of [m, 'node:' + m]) {
      assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + `import x from '${naam}';`), [], naam);
      assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + `const x = await import('${naam}');`), [], naam);
    }
  }
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "import fs from 'node:fs';"), []);
  assert.deepEqual(slecht('e2e/productie/vangnet-zelftest.spec.mjs', ZELF + "import h from 'node:http';"), []);
});

test('guard: APIRequestContext in productiespecs faalt', () => {
  for (const regel of [
    "await page.request.get('/x');", "await context.request.post('/x');", "const r = page.request;", "await page .\n request.get('/x');",
    "test('a', async ({ request }) => {});", "test('a', async ({ page, request }) => {});", "await ctx.request.fetch('/x');",
  ]) {
    assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
    assert.deepEqual(slecht('e2e/productie/vangnet-zelftest.spec.mjs', ZELF + regel), [], regel);
  }
  // route.request() en een lokale variabele `request` zijn geen APIRequestContext.
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "const url = route.request().url(); const request = 1;"), []);
});

test('guard: eigen browsercontext of -pagina in productiespecs faalt', () => {
  for (const regel of [
    "const c = await browser.newContext();", "const p = await context.newPage();", "const p = await b.newPage();",
    "test('a', async ({ browser }) => {});", "await browser.close();",
  ]) {
    assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
    assert.deepEqual(slecht('e2e/productie/vangnet-zelftest.spec.mjs', ZELF + regel), [], regel);
  }
});

test('guard: fetch( in productiespecs faalt (de zelftest en fixtures niet)', () => {
  for (const regel of [
    "const r = await fetch('http://x');", "await globalThis.fetch('http://x');", "await page.evaluate(() => fetch('/x'));",
  ]) {
    assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
    assert.deepEqual(slecht('e2e/productie/vangnet-zelftest.spec.mjs', ZELF + regel), [], regel);
  }
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "const prefetch = 1; await page.goto('/fetch');"), []);
});

test('guard: een letterlijke relatieve fetch met een /api/-pad in een productiespec is toegestaan', () => {
  for (const regel of [
    "await page.evaluate(() => fetch('/api/fotos', { method: 'PUT', body: '{}' }));",
    'await page.evaluate(() => fetch("/api/plan").catch(() => {}));',
    "await page.evaluate(() => fetch( '/api/x'));",
  ]) assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
});

test('guard: elke andere fetch-vorm in een productiespec faalt nog steeds', () => {
  for (const regel of [
    "await page.evaluate((u) => fetch(u), '/api/x');", "await page.evaluate(() => fetch(`/api/${x}`));",
    "await page.evaluate(() => fetch('https://x.test/api/x'));", "await page.evaluate(() => fetch('//x.test/api/x'));",
    "await page.evaluate(() => fetch('/apix'));", "await page.evaluate(() => fetch('/x'));", "await page.evaluate(() => fetch());",
    "await page.evaluate(() => window.fetch('/api/x'));", "await page.evaluate(() => globalThis.fetch('/api/x'));",
    "await page.evaluate(() => window.fetch('http://x'));", "await page.evaluate(() => fetch(url + '/api/'));",
  ]) assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
});

test('guard: test.use, test.extend en serviceWorkers in productiespecs falen (het slot serviceWorkers: block is niet te overschrijven)', () => {
  for (const regel of [
    "test.use({ serviceWorkers: 'allow' });", "test.use({ locale: 'en' });", "test .use( { x: 1 } );", "test.describe('x', () => { test.use({ serviceWorkers: 'allow' }); });",
    "const t = test.extend({ serviceWorkers: 'allow' });", "test.extend({});", "const o = { serviceWorkers: 'allow' };", "// serviceWorkers\nconst x = 1;",
  ]) {
    assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
    assert.notDeepEqual(slecht('e2e/productie/vangnet-zelftest.spec.mjs', ZELF + regel), [], regel);
  }
  // De fixture zelf zet het slot (basis.extend met serviceWorkers: 'block').
  assert.deepEqual(slecht('e2e/productie-hulp.mjs', "const test = basis.extend({ serviceWorkers: ['block', { option: true }] });"), []);
  // Gewone specs buiten e2e/productie/ mogen test.use gebruiken (bv. hasTouch), en 'use' als woord of fixture blijft toegestaan.
  assert.deepEqual(slecht('e2e/x.spec.mjs', HELP + "test.use({ hasTouch: true });"), []);
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "test.describe.configure({ mode: 'serial' }); const gebruik = 'use'; await page.goto('/uses');"), []);
});

test('guard: test.use/test.extend via haakjes, alias of destructuring in productiespecs falen', () => {
  for (const regel of [
    "test['use']({ serviceWorkers: 'allow' });", 'test["use"]({ locale: "en" });', "test[`use`]({});", "test['extend']({});",
    "const { use } = test;", "const { use: gebruik } = test;", "const { extend } = test;", "const { describe, use } = test;",
    "const u = test.use; u({});", "const e = test.extend;", "const o = { ['serviceWorkers']: 'allow' };", 'const o = { "serviceWorkers": "allow" };',
    "test.use ;",
  ]) {
    assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), [], regel);
    assert.notDeepEqual(slecht('e2e/productie/vangnet-zelftest.spec.mjs', ZELF + regel), [], regel);
  }
  // Geen vals alarm voor gewone code, en de fixture zelf mag extend gebruiken.
  assert.deepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "const gebruikt = 1; const lijst = ['use']; await page.goto('/use');"), []);
  assert.deepEqual(slecht('e2e/productie-hulp.mjs', "export const test = basis.extend({}); const { use } = test;"), []);
});

// ── Derde klasse: service worker-bestanden (etappe 7, Task 5) ──
const SWHULP = "import { test } from '../sw-hulp.mjs';\n";
const SWZELF = SWHULP + "import { n } from './zelftest-hulp.mjs';\n";

test('guard (sw): een sw-spec importeert test enkel uit ../sw-hulp.mjs', () => {
  assert.deepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP), []);
  assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', 'const a = 1;'), []);
  assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', PROD), []);
  assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', HELP), []);
  assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP + "import { stubExtern } from '../helpers.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP + "import { test } from '../productie-hulp.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP + "import { waarnemer } from '../sw-waarnemer.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP + "import { n } from './zelftest-hulp.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP + `import { test } from '${PW}';`), []);
  // Een productiespec of gewone spec mag sw-hulp niet importeren.
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + "import { test } from '../sw-hulp.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/x.spec.mjs', HELP + "import { test } from './sw-hulp.mjs';"), []);
  assert.deepEqual(slecht('e2e/sw/vangnet-zelftest.spec.mjs', SWZELF), []);
});

test('guard (sw): serviceWorkers, setOffline, routes, fetch(, waitForTimeout, ?test en test.use in een sw-spec falen', () => {
  for (const regel of [
    "test.use({ serviceWorkers: 'allow' });", "const o = { serviceWorkers: 'block' };", "await page.context().setOffline(true);",
    "await context.setOffline(false);", "const z = page.context().setOffline; z(true);", "// setOffline\nconst x = 1;",
    "await page.route('**/*', r => r.continue());", "await context.route(u => true, r => r.fulfill({}));", "route.fallback();",
    "await page.evaluate(() => fetch('https://desk.zoho.eu/x'));", "await page.evaluate(() => fetch('/x'));",
    "await page.waitForTimeout(5);", "await page.goto('/?te" + "st');", "headers['X-Blitz-" + "Test'] = '1';",
    "const t = test.extend({});", "const b = await browser.newContext();", "await page.request.get('/x');",
    "verzoeken.buitenHost.length = 0;", "neemSwProbesOver(page, verzoeken);", "swOvertredingen.length = 0;",
    "const r = createRequire(import.meta.url);", "import cp from 'node:child_process';", "import h from 'node:https';",
  ]) assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP + regel), [], regel);
  // De zelftest mag de klep-namen wel gebruiken, maar nooit serviceWorkers/setOffline/routes/waitForTimeout.
  assert.deepEqual(slecht('e2e/sw/vangnet-zelftest.spec.mjs', SWZELF + 'verzoeken.buitenHost.length = 0; neemSwProbesOver(page, verzoeken);'), []);
  for (const regel of ["test.use({ serviceWorkers: 'allow' });", "await page.context().setOffline(true);", "await page.route('**/*', h);", 'await page.waitForTimeout(5);']) {
    assert.notDeepEqual(slecht('e2e/sw/vangnet-zelftest.spec.mjs', SWZELF + regel), [], regel);
  }
  // Een letterlijke relatieve /api-fetch en gewone woorden blijven toegestaan.
  assert.deepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP + "await page.evaluate(() => fetch('/api/tickets'));"), []);
  assert.deepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP + "const offlineBalk = page.locator('#offline-banner'); const sw = 1;"), []);
});

test('guard: voorNavigatie (volledige context in de startAppProductie-haak) enkel in de fixtures', () => {
  const regel = "await startAppProductie(page, { voorNavigatie: async (ctx) => {} });";
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + regel), []);
  assert.notDeepEqual(slecht('e2e/sw/x.spec.mjs', SWHULP + regel), []);
  assert.deepEqual(slecht('e2e/sw-hulp.mjs', "import { test as basis } from './productie-hulp.mjs';\n" + regel), []);
  assert.deepEqual(slecht('e2e/productie-hulp.mjs', regel), []);
});

test('guard (sw): setOffline staat in productiespecs niet, maar wel in niet-productiespecs', () => {
  assert.notDeepEqual(slecht('e2e/productie/x.spec.mjs', PROD + 'await page.context().setOffline(true);'), []);
  assert.deepEqual(slecht('e2e/x.spec.mjs', HELP + 'await page.context().setOffline(true);'), []);
});

test('guard (sw): de fixtures mogen serviceWorkers, setOffline, routes en fetch( gebruiken, maar enkel hun eigen imports', () => {
  const fixture = "import { test as basis } from './productie-hulp.mjs';\nimport { maakSwWaarnemer } from './sw-waarnemer.mjs';\n"
    + "export const test = basis.extend({ serviceWorkers: ['allow', { option: true }] });\n"
    + "await context.setOffline(true); await context.route(u => true, r => r.fallback()); await page.evaluate(() => fetch('https://x.test/y'));\n";
  assert.deepEqual(slecht('e2e/sw-hulp.mjs', fixture), []);
  assert.notDeepEqual(slecht('e2e/sw-hulp.mjs', fixture + `import { test } from '${PW}';`), []);
  assert.notDeepEqual(slecht('e2e/sw-hulp.mjs', fixture + "import { stubExtern } from './helpers.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/sw-hulp.mjs', fixture + "import { waarnemer } from './productie-waarnemer.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/sw-hulp.mjs', fixture + "import { x } from './vangnet-regels.mjs';"), []);
  assert.notDeepEqual(slecht('e2e/sw-hulp.mjs', fixture + "await page.waitForTimeout(5);"), []);
  assert.notDeepEqual(slecht('e2e/sw-hulp.mjs', fixture + "await page.goto('/?te" + "st');"), []);
  assert.notDeepEqual(slecht('e2e/sw-hulp.mjs', fixture + "eval('1');"), []);
  assert.deepEqual(slecht('e2e/sw-waarnemer.mjs', 'export function maakSwWaarnemer() { return {}; }\n'), []);
  assert.notDeepEqual(slecht('e2e/sw-waarnemer.mjs', "import { x } from './productie-hulp.mjs';"), []);
  // Een onbekend bestand in de sw-klasse is verboden (geen stille nieuwe uitzonderingen).
  assert.notDeepEqual(slecht('e2e/sw/hulp-extra.mjs', 'export const a = 1;'), []);
  assert.notDeepEqual(slecht('e2e/sw-extra.mjs', 'export const a = 1;'), []);
});
