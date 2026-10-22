// tests/spel-opening.test.mjs — 5× snel tikken op het logo laadt het spel pas bij de eerste activatie en schakelt het om.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { installeerSpelOpening, TIK_AANTAL, TIK_TUSSEN_MS, MELDING_MS, tikMelding } from '../public/js/spel/spel-opening.js';

const nepDoel = () => {
  const luisteraars = new Set();
  return {
    addEventListener: (t, f) => { if (t === 'click') luisteraars.add(f); },
    removeEventListener: (t, f) => luisteraars.delete(f),
    klik: () => [...luisteraars].forEach(f => f()),
    aantal: () => luisteraars.size,
  };
};
const nepMelding = () => { const m = { teksten: [], verbergen: 0, toon: (t) => m.teksten.push(t), verberg: () => { m.verbergen++; } }; return m; };
const wacht = () => new Promise(r => setImmediate(r));

test('de drempels: vijf tikken, elk binnen 600 ms na de vorige; melding 1,5 s', () => {
  assert.equal(TIK_AANTAL, 5);
  assert.equal(TIK_TUSSEN_MS, 600);
  assert.equal(MELDING_MS, 1500);
});

test('de meldingstekst: enkel na de 3e en 4e tik', () => {
  assert.equal(tikMelding(2), '');
  assert.equal(tikMelding(3), 'Nog 2 keer tikken om Blitz Run te openen');
  assert.equal(tikMelding(4), 'Nog 1 keer tikken om Blitz Run te openen');
});

test('de module wordt pas geladen bij de vijfde tik; elke volgende vijf tikken wisselen om', async () => {
  const doel = nepDoel();
  let geladen = 0;
  const wissels = [];
  let t = 0;
  installeerSpelOpening({
    doel, nu: () => (t += 100), melding: nepMelding(), isOpen: () => false,
    laad: async () => { geladen++; return { wisselSpel: (afh) => wissels.push(afh) }; },
    actieveThemas: () => ['th'], pakketten: () => ['pk'], haalPakketten: () => 'haal',
  });
  for (let i = 0; i < 4; i++) doel.klik();
  await wacht();
  assert.equal(geladen, 0);
  doel.klik();
  await wacht();
  assert.equal(geladen, 1);
  assert.equal(wissels.length, 1);
  // Bewust gewijzigd (taak 8): geen `actieveEvenementen` meer; de thema-afhankelijkheden van app.js worden doorgegeven.
  assert.equal(wissels[0].actieveThemas()[0], 'th', 'de actieve-themafunctie wordt doorgegeven');
  assert.equal(wissels[0].pakketten()[0], 'pk');
  assert.equal(wissels[0].haalPakketten(), 'haal');
  for (let i = 0; i < 5; i++) doel.klik();
  await wacht();
  assert.equal(geladen, 1, 'de module wordt maar één keer geladen');
  assert.equal(wissels.length, 2);
});

test('te traag tikken opent niets; zonder doel of na afmelden gebeurt er niets', async () => {
  const doel = nepDoel();
  let geladen = 0;
  let t = 0;
  const af = installeerSpelOpening({ doel, melding: nepMelding(), nu: () => (t += 1000), laad: async () => { geladen++; return { wisselSpel() {} }; } });
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
    doel, nu: () => 0, melding: nepMelding(),
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
  // Taak 6 maakte skins.js tijdelijk eager (de validator gebruikte HEMEL, RAND_KLEUR en de skin-id's eruit). Taak 8 herstelt de oude
  // verwachting: de validator leest enkel nog het pure skin-kleuren.js (eager), en skins.js (met het tekenwerk) is weer lazy.
  assert.ok(!html.includes('/js/spel/skins.js'));
  assert.ok(html.includes('/js/spel/skin-kleuren.js'));
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

test('meldingen: na de 3e en 4e snelle tik; een trage tik verbergt ze; bij de 5e tik verdwijnt de melding en opent het spel; niets bij sluiten', async () => {
  const doel = nepDoel();
  const m = nepMelding();
  let open = false;
  let t = 0;
  let stap = 100;
  const wissels = [];
  installeerSpelOpening({ doel, melding: m, isOpen: () => open, nu: () => (t += stap), laad: async () => ({ wisselSpel: () => wissels.push(1) }) });
  doel.klik(); doel.klik();
  assert.deepEqual(m.teksten, []);
  doel.klik();
  assert.deepEqual(m.teksten, ['Nog 2 keer tikken om Blitz Run te openen']);
  doel.klik();
  assert.equal(m.teksten[1], 'Nog 1 keer tikken om Blitz Run te openen');
  stap = 700; doel.klik(); // te traag: reset
  assert.equal(m.verbergen, 1);
  stap = 100; doel.klik(); doel.klik(); doel.klik(); // 2,3,4 na de reset
  assert.equal(m.teksten.length, 4);
  doel.klik(); // 5e
  await wacht();
  assert.equal(wissels.length, 1);
  assert.ok(m.verbergen >= 2);
  open = true; // sluiten: geen meldingen
  const voor = m.teksten.length;
  for (let i = 0; i < 5; i++) doel.klik();
  await wacht();
  assert.equal(m.teksten.length, voor);
  assert.equal(wissels.length, 2);
});
