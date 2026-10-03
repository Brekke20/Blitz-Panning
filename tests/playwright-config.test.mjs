// Pint de testopzet vast (etappe 7, M6): het DNS-slot van het project `sw` en de OneDrive-veilige uitvoermap.
// De zelftest van de sw-fixture slaagt ook dankzij de route-sloten, dus zonder deze test kan het DNS-slot ongemerkt verdwijnen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import config from '../playwright.config.mjs';

const project = (naam) => config.projects.find((p) => p.name === naam);
const argsVan = (p) => p?.use?.launchOptions?.args || [];

test('project sw: --host-resolver-rules lost enkel localhost en de twee CDN-hosts op', () => {
  const regel = argsVan(project('sw')).find((a) => a.startsWith('--host-resolver-rules='));
  assert.ok(regel, 'het project sw heeft --host-resolver-rules niet meer');
  assert.match(regel, /MAP \* ~NOTFOUND/);
  const uitgezonderd = [...regel.matchAll(/EXCLUDE ([^,\s]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(uitgezonderd, ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'localhost', '127.0.0.1'].sort());
});

test('project chromium heeft het DNS-slot niet (de gewone specs draaien met route-sloten) en blokkeert service workers', () => {
  assert.equal(argsVan(project('chromium')).some((a) => a.includes('host-resolver-rules')), false);
  assert.equal(config.use.serviceWorkers, 'block');
  assert.equal(project('sw').use.serviceWorkers, 'allow');
});

test('uitvoermap buiten de repo (OneDrive) en trace lokaal uit', () => {
  assert.equal(config.outputDir, path.join(os.tmpdir(), 'blitz-planning-pw'));
  assert.equal(config.use.trace, process.env.CI ? 'retain-on-failure' : 'off');
});
