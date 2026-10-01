// Zelftest van het productie-vangnet: bewijst dat de sloten echt dicht zijn. Draai deze eerst:
//   npx playwright test e2e/productie/vangnet-zelftest.spec.mjs
import { test, expect, startAppProductie, verwachtSchrijven, OPSTART_SCHRIJVEN, ongemeldeSchrijfverzoeken } from '../productie-hulp.mjs';
import { neemGeblokkeerdeProbesOver } from './zelftest-hulp.mjs';

test.describe.configure({ mode: 'serial' });

test('Zelftest: Zoho, TomTom, mail en een POST naar een CDN worden geblokkeerd', async ({ page, verzoeken, consoleFouten }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  const probes = [
    ['GET', 'https://desk.zoho.eu/api/v1/tickets'],
    ['GET', 'https://api.tomtom.com/routing/1/calculateRoute/x'],
    ['GET', 'https://smtp.example.com/'],
    ['POST', 'https://cdnjs.cloudflare.com/x'],
  ];
  for (const [methode, doel] of probes) {
    const uitkomst = await page.evaluate(([m, u]) => fetch(u, { method: m }).then(() => 'bereikt', (e) => e.name), [methode, doel]);
    expect(uitkomst, `${methode} ${doel}`).toBe('TypeError');
  }
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken);
  expect(gezien.buitenHost).toEqual(probes.map(([, doel]) => doel));
  expect(gezien.ongeoorloofd).toEqual(probes.map(([m, doel]) => `${m} ${doel}`));
  // De afgebroken fetches zijn ook requestfailed-meldingen; die horen bij deze bewuste probes.
  expect(consoleFouten.length).toBeGreaterThan(0);
  consoleFouten.length = 0;
});

test('Zelftest: zonder startAppProductie verlaat ook niets de eigen server', async ({ page, verzoeken, consoleFouten }) => {
  await page.goto('/sw.js'); // een bestaand statisch bestand; geen app, geen stubs
  const uitkomst = await page.evaluate(() => fetch('https://desk.zoho.eu/api/v1/tickets').then(() => 'bereikt', () => 'geblokkeerd'));
  expect(uitkomst).toBe('geblokkeerd');
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken);
  expect(gezien.buitenHost).toEqual(['https://desk.zoho.eu/api/v1/tickets']);
  consoleFouten.length = 0;
});

test('Zelftest: de catch-all blijft dicht (/api/onbestaand geeft 599)', async ({ page, verzoeken, consoleFouten }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  const status = await page.evaluate(() => fetch('/api/onbestaand').then(r => r.status));
  expect(status).toBe(599);
  expect(verzoeken.onverwacht).toEqual(['/api/onbestaand']);
  expect(consoleFouten).toEqual([expect.stringContaining('599')]); // de browser meldt de 599 als console.error
  verzoeken.onverwacht.length = 0;
  consoleFouten.length = 0;
});

test('Zelftest: elk schrijfverzoek naar de eigen server buiten de whitelist wordt gemeld', async ({ page, verzoeken, consoleFouten }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  // /api/plan is gestubd (neutraal succes); /niet-api bestaat niet op de statische server (404).
  await page.evaluate(() => fetch('/api/plan', { method: 'POST', body: '{}' }));
  await page.evaluate(() => fetch('/niet-api/x', { method: 'PUT', body: '{}' }));
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken);
  expect(ongemeldeSchrijfverzoeken(gezien.schrijven, [])).toEqual(['POST /api/planning-sinds', 'POST /api/plan', 'PUT /niet-api/x']);
  expect(ongemeldeSchrijfverzoeken(gezien.schrijven, [...OPSTART_SCHRIJVEN, 'POST /api/plan'])).toEqual(['PUT /niet-api/x']);
  expect(ongemeldeSchrijfverzoeken(gezien.schrijven, [...OPSTART_SCHRIJVEN, '/api/plan', 'PUT /niet-api/x'])).toEqual([]);
  expect(consoleFouten.some(f => f.includes('404'))).toBe(true); // de 404 van /niet-api/x
  consoleFouten.length = 0;
});

test('Zelftest: een WebSocket wordt geblokkeerd en gemeld', async ({ page, verzoeken }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  await page.evaluate(() => { window.__ws = new WebSocket('ws://127.0.0.1:3338/ws'); });
  await expect.poll(() => page.evaluate(() => window.__ws.readyState)).toBe(3); // gesloten
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken);
  expect(gezien.websockets).toEqual(['ws://127.0.0.1:3338/ws']);
});
