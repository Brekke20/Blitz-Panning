// tests/testmodus-auth.test.mjs — authenticatiegegevens worden nooit naar de testopslag gekopieerd.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { zorgVoorTestkopie, wisTestopslag } from '../netlify/lib/testmodus.js';

test('zorgVoorTestkopie kopieert verkoperleads (sales/<id>) NIET, de postcode-cache wel', async () => {
  const echt = maakNepStore({
    'sales/u-x': { versie: 3, leads: [{ id: 'l1', naam: 'Klant' }], blokken: [], grafstenen: [] }, 'sales/test-sales': { versie: 1 },
    'postcode-cache': { 3640: { lat: 51, lon: 5, gemeente: 'Kinrooi' } }, afspraken: { lijst: [1] },
  });
  const testStore = maakNepStore();
  const getStore = ({ name }) => (name === 'blitz-data' ? echt : testStore);
  await zorgVoorTestkopie(getStore, { gooiFout: true });
  assert.deepEqual([...testStore._data.keys()].filter(k => k !== '_testkopie').sort(), ['afspraken', 'postcode-cache']);
  await wisTestopslag(getStore); // de kopievlag staat per proces: zet hem terug voor de volgende test
});

test('zorgVoorTestkopie kopieert gebruikers, pogingen, laatste logins, noodroute en activiteit NIET', async () => {
  const echt = maakNepStore({
    gebruikers: { versie: 1, gebruikers: [] }, 'login-pogingen': {}, 'login-laatst': {}, 'herstel-noodroute': 'h',
    'activiteit/2026-10': { items: [] }, afspraken: { lijst: [1] },
  });
  const testStore = maakNepStore();
  const getStore = ({ name }) => (name === 'blitz-data' ? echt : testStore);
  const n = await zorgVoorTestkopie(getStore, { gooiFout: true });
  assert.equal(n, 1);
  const sleutels = [...testStore._data.keys()].filter(k => k !== '_testkopie');
  assert.deepEqual(sleutels, ['afspraken']);
});
