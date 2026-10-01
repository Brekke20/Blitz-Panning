// Importguard van de e2e-suite (etappe 5a, fix-ronde 1). Draait bij elke `node --test`, dus niet te
// omzeilen met `playwright test <spec>` of `-g`. Scant ALLE bestanden onder e2e/ recursief.
//  - Elke *.spec.mjs importeert `test` enkel uit ./helpers.mjs, of (onder e2e/productie/) enkel uit
//    ../productie-hulp.mjs. @playwright/test, playwright/test en playwright(-core) rechtstreeks: fout.
//  - Dynamische import/require met een niet-letterlijke naam: fout (niet te scannen).
//  - Productiebestanden: geen waitForTimeout; ?test en X-Blitz-Test enkel in een expliciete bestandslijst.
//  - Ontsnappingskleppen (waarnemer, buitenHost, lekmeldingen wissen) enkel in de zelftest-bestanden.
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
const ZELFTEST = new Set(['e2e/productie/vangnet-zelftest.spec.mjs', 'e2e/productie/zelftest-hulp.mjs']);
// Expliciete uitzonderingen op het ?test / X-Blitz-Test-verbod (per bestand). Nooit voor waitForTimeout.
const TESTWOORD_TOEGESTAAN = new Set([
  'e2e/productie-hulp.mjs',
  'e2e/productie-waarnemer.mjs',
  'e2e/productie/opstart.spec.mjs',
]);
// Toegestane imports per productiebestand (naast node:*); een ander bestand mag enkel ../productie-hulp.mjs.
const PRODUCTIE_IMPORTS = {
  'e2e/productie-hulp.mjs': ['@playwright/test', './helpers.mjs', './productie-waarnemer.mjs'],
  'e2e/productie-waarnemer.mjs': ['./vangnet-regels.mjs'],
  'e2e/productie/zelftest-hulp.mjs': ['../productie-waarnemer.mjs'],
  'e2e/productie/vangnet-zelftest.spec.mjs': ['../productie-hulp.mjs', './zelftest-hulp.mjs'],
};

const PLAYWRIGHT_MODULE = /^(@playwright\/test|playwright(-core)?(\/test)?)$/;
const IMPORT_PATRONEN = [
  /\b(?:from|import)\s*['"]([^'"]+)['"]/g, // import 'x', import a from 'x', export * from 'x', export {a} from 'x'
  /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('x'), require('x')
];
const DYNAMISCH_NIET_LETTERLIJK = /\b(?:import|require)\s*\(\s*(?!['"])/;
const MUTATIE = '(?:\\.(?:length\\s*=(?!=)|splice\\s*\\(|pop\\s*\\(|shift\\s*\\(|push\\s*\\(|fill\\s*\\()|\\s*=(?!=))';
const KLEP_NAMEN = /\b(buitenHost|ongeoorloofd|testSignalen|neemGeblokkeerdeProbesOver|productie-waarnemer|zelftest-hulp)\b/;
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
    const imports = importsVan(tekst);
    const isSpec = pad.endsWith('.spec.mjs');
    const productie = pad.startsWith('e2e/productie/') || pad.startsWith('e2e/productie-');
    const fout = (m) => fouten.push(`${pad}: ${m}`);

    if (DYNAMISCH_NIET_LETTERLIJK.test(tekst)) fout('import/require met een niet-letterlijke naam');
    if (!PLAYWRIGHT_TOEGESTAAN.has(pad)) {
      for (const i of imports) if (PLAYWRIGHT_MODULE.test(i)) fout(`importeert ${i} rechtstreeks`);
    }
    for (const i of imports) {
      if (/productie/.test(i) && !productie) fout(`importeert ${i} buiten de productiebestanden`);
    }

    if (isSpec && !pad.startsWith('e2e/productie/')) {
      if (!imports.includes('./helpers.mjs')) fout('importeert test niet uit ./helpers.mjs');
    }
    if (productie) {
      const toegestaan = new Set(PRODUCTIE_IMPORTS[pad] ?? ['../productie-hulp.mjs']);
      for (const i of imports) {
        if (!i.startsWith('node:') && !toegestaan.has(i)) fout(`importeert ${i} (toegestaan: ${[...toegestaan].join(', ')})`);
      }
      if (isSpec && pad.startsWith('e2e/productie/') && !imports.includes('../productie-hulp.mjs')) {
        fout('importeert test niet uit ../productie-hulp.mjs');
      }
      if (/waitForTimeout/.test(tekst)) fout('waitForTimeout');
      if (!TESTWOORD_TOEGESTAAN.has(pad)) {
        if (/\?test\b/.test(tekst)) fout('?test');
        if (/x-blitz-test/i.test(tekst)) fout('X-Blitz-Test');
      }
      if (!ZELFTEST.has(pad) && !pad.startsWith('e2e/productie-')) {
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
