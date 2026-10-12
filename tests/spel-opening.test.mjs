// tests/spel-opening.test.mjs — 5× tikken op de titel laadt het spel pas bij de eerste activatie en schakelt het om.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { installeerSpelOpening, TIK_AANTAL, TIK_VENSTER_MS } from '../public/js/spel/spel-opening.js';

const nepDoel = () => {
  const luisteraars = new Set();
  return {
    addEventListener: (t, f) => { if (t === 'click') luisteraars.add(f); },
    removeEventListener: (t, f) => luisteraars.delete(f),
    klik: () => [...luisteraars].forEach(f => f()),
    aantal: () => luisteraars.size,
  };
};
const wacht = () => new Promise(r => setImmediate(r));

test('de drempels: vijf tikken binnen twee seconden', () => {
  assert.equal(TIK_AANTAL, 5);
  assert.equal(TIK_VENSTER_MS, 2000);
});

test('de module wordt pas geladen bij de vijfde tik; elke volgende vijf tikken wisselen om', async () => {
  const doel = nepDoel();
  let geladen = 0;
  const wissels = [];
  let t = 0;
  installeerSpelOpening({
    doel, nu: () => (t += 100),
    laad: async () => { geladen++; return { wisselSpel: (afh) => wissels.push(afh) }; },
    actieveEvenementen: () => ['ev'],
  });
  for (let i = 0; i < 4; i++) doel.klik();
  await wacht();
  assert.equal(geladen, 0);
  doel.klik();
  await wacht();
  assert.equal(geladen, 1);
  assert.equal(wissels.length, 1);
  assert.equal(wissels[0].actieveEvenementen()[0], 'ev', 'de event-functie wordt doorgegeven');
  for (let i = 0; i < 5; i++) doel.klik();
  await wacht();
  assert.equal(geladen, 1, 'de module wordt maar één keer geladen');
  assert.equal(wissels.length, 2);
});

test('te traag tikken opent niets; zonder doel of na afmelden gebeurt er niets', async () => {
  const doel = nepDoel();
  let geladen = 0;
  let t = 0;
  const af = installeerSpelOpening({ doel, nu: () => (t += 1000), laad: async () => { geladen++; return { wisselSpel() {} }; } });
  for (let i = 0; i < 10; i++) doel.klik();
  await wacht();
  assert.equal(geladen, 0);
  af();
  assert.equal(doel.aantal(), 0);
  assert.equal(installeerSpelOpening({ doel: null }), null);
});

test('een mislukte lading is stil en wordt de volgende keer opnieuw geprobeerd', async () => {
  const doel = nepDoel();
  let pogingen = 0;
  installeerSpelOpening({
    doel, nu: () => 0,
    laad: () => { pogingen++; return pogingen === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ wisselSpel() {} }); },
  });
  for (let i = 0; i < 5; i++) doel.klik();
  await wacht();
  for (let i = 0; i < 5; i++) doel.klik();
  await wacht();
  assert.equal(pogingen, 2);
});

test('opstartgedrag: spel-ui.js wordt enkel dynamisch geïmporteerd en staat niet in de eager modulegraaf van index.html', () => {
  const pub = path.join(import.meta.dirname, '..', 'public');
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  assert.ok(!html.includes('spel-ui.js'));
  assert.ok(!html.includes('spel/spel.js'));
  assert.ok(!html.includes('skins.js'));
  assert.match(fs.readFileSync(path.join(pub, 'js/spel/spel-opening.js'), 'utf8'), /import\('\.\/spel-ui\.js'\)/);
  assert.ok(html.includes('/js/spel/spel-opening.js'));
});

test('alle spelbestanden staan in SHELL van de service worker (offline beschikbaar)', () => {
  const pub = path.join(import.meta.dirname, '..', 'public');
  const sw = fs.readFileSync(path.join(pub, 'sw.js'), 'utf8');
  for (const f of fs.readdirSync(path.join(pub, 'js', 'spel')).filter(x => x.endsWith('.js'))) {
    assert.ok(sw.includes(`'/js/spel/${f}'`), f);
  }
});
