// tests/testmodus-auth.test.mjs — authenticatiegegevens worden nooit naar de testopslag gekopieerd.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { zorgVoorTestkopie } from '../netlify/lib/testmodus.js';

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
