// Zelftest van het productie-vangnet: bewijst dat de sloten echt dicht zijn. Draai deze eerst:
//   npx playwright test e2e/productie/vangnet-zelftest.spec.mjs
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, verwachtNetwerkFout, verwachtConsoleFout, zohoStubs, OPSTART_SCHRIJVEN, ongemeldeSchrijfverzoeken } from '../productie-hulp.mjs';
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
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten);
  expect(gezien.buitenHost).toEqual(probes.map(([, doel]) => doel));
  expect(gezien.ongeoorloofd).toEqual(probes.map(([m, doel]) => `${m} ${doel}`));
  // De afgebroken fetches zijn ook requestfailed-meldingen; die horen bij deze bewuste probes.
  expect(gezien.consoleFouten.length).toBeGreaterThan(0);
});

test('Zelftest: zonder startAppProductie verlaat ook niets de eigen server', async ({ page, verzoeken, consoleFouten }) => {
  await page.goto('/sw.js'); // een bestaand statisch bestand; geen app, geen stubs
  const uitkomst = await page.evaluate(() => fetch('https://desk.zoho.eu/api/v1/tickets').then(() => 'bereikt', () => 'geblokkeerd'));
  expect(uitkomst).toBe('geblokkeerd');
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten);
  expect(gezien.buitenHost).toEqual(['https://desk.zoho.eu/api/v1/tickets']);
});

test('Zelftest: de catch-all blijft dicht (/api/onbestaand geeft 599)', async ({ page, verzoeken, consoleFouten }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  const status = await page.evaluate(() => fetch('/api/onbestaand').then(r => r.status));
  expect(status).toBe(599);
  expect(verzoeken.onverwacht).toEqual(['/api/onbestaand']);
  expect(consoleFouten).toEqual([expect.stringContaining('599')]); // de browser meldt de 599 als console.error
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten);
  expect(gezien.onverwacht).toEqual(['/api/onbestaand']);
});

test('Zelftest: elk schrijfverzoek naar de eigen server buiten de whitelist wordt gemeld', async ({ page, verzoeken, consoleFouten }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  // /api/plan is gestubd (neutraal succes); /niet-api bestaat niet op de statische server (404).
  await page.evaluate(() => fetch('/api/plan', { method: 'POST', body: '{}' }));
  await page.evaluate(() => fetch('/niet-api/x', { method: 'PUT', body: '{}' }));
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten);
  expect(ongemeldeSchrijfverzoeken(gezien.schrijven, [])).toEqual(['POST /api/planning-sinds', 'POST /api/plan', 'PUT /niet-api/x']);
  expect(ongemeldeSchrijfverzoeken(gezien.schrijven, [...OPSTART_SCHRIJVEN, 'POST /api/plan'])).toEqual(['PUT /niet-api/x']);
  expect(ongemeldeSchrijfverzoeken(gezien.schrijven, [...OPSTART_SCHRIJVEN, '/api/plan', 'PUT /niet-api/x'])).toEqual([]);
  expect(gezien.consoleFouten.some(f => f.includes('404'))).toBe(true); // de 404 van /niet-api/x
});

test('Zelftest: een WebSocket wordt geblokkeerd en gemeld', async ({ page, verzoeken, consoleFouten }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  await page.evaluate(() => { window.__ws = new WebSocket('ws://127.0.0.1:3338/ws'); });
  await expect.poll(() => page.evaluate(() => window.__ws.readyState)).toBe(3); // gesloten
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten);
  expect(gezien.websockets).toEqual(['ws://127.0.0.1:3338/ws']);
});

// Specs krijgen alleen-lezen weergaven: wissen van een lekmelding is onmogelijk, ook niet via destructuring
// of haakjes-toegang, en de gemelde lek blijft voor het afterEach-vangnet bewaard.
test('Zelftest: een spec kan lekmeldingen niet wissen (alleen-lezen weergaven)', async ({ page, verzoeken, consoleFouten }) => {
  await startAppProductie(page, { technieker: 'Tim' });
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  await page.evaluate(() => fetch('https://desk.zoho.eu/api/v1/tickets').then(() => 'bereikt', () => 'geblokkeerd'));
  await page.evaluate(() => fetch('/api/onbestaand').then(r => r.status));
  expect(verzoeken.buitenHost).toEqual(['https://desk.zoho.eu/api/v1/tickets']);

  const { buitenHost, onverwacht, alle } = verzoeken; // destructuring
  const poging = (f) => expect(f).toThrow(/alleen-lezen/);
  poging(() => { buitenHost.length = 0; });
  poging(() => { verzoeken['buitenHost'].length = 0; }); // haakjes-toegang
  poging(() => { verzoeken.buitenHost.splice(0); });
  poging(() => { verzoeken.buitenHost.pop(); });
  poging(() => { verzoeken.buitenHost.push('x'); });
  poging(() => { buitenHost[0] = 'x'; });
  poging(() => { delete buitenHost[0]; });
  poging(() => { onverwacht.length = 0; });
  poging(() => { alle.length = 0; });
  poging(() => { alle[0].pad = '/anders'; }); // ook de verzoekobjecten zelf
  poging(() => { verzoeken.buitenHost = []; });
  poging(() => { verzoeken['alle'] = []; });
  poging(() => { consoleFouten.length = 0; });
  poging(() => { consoleFouten.push('x'); });
  poging(() => { consoleFouten[0] = 'x'; });
  const { 0: eerste } = consoleFouten;
  expect(typeof eerste).toBe('string');

  // De originelen zijn onaangeroerd: de lekken zijn er nog en worden pas hier (zelftest-hulp) overgenomen.
  const gezien = neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten);
  expect(gezien.buitenHost).toEqual(['https://desk.zoho.eu/api/v1/tickets']);
  expect(gezien.onverwacht).toEqual(['/api/onbestaand']);
  expect(gezien.consoleFouten.length).toBeGreaterThan(0);
});

// verwachtHttpFout: exact pad + status wordt toegelaten, alles anders blijft een consolefout.
test('Zelftest: verwachtHttpFout laat enkel de aangegeven pad+status door', async ({ page, verzoeken, consoleFouten }) => {
  const z = zohoStubs();
  z.zetAntwoord('plan', { status: 500, json: { error: 'x' } });
  z.zetAntwoord('plan-datum', { status: 500, json: { error: 'x' } });
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/plan', '/api/plan-datum']);
  verwachtHttpFout(verzoeken, [{ pad: '/api/plan', status: 500 }]);
  await startAppProductie(page, { technieker: 'Tim', overschrijf: z.overschrijf });
  await page.evaluate(() => fetch('/api/plan', { method: 'POST', body: '{}' })); // toegelaten
  await page.evaluate(() => fetch('/api/plan-datum', { method: 'POST', body: '{}' })); // ander pad: blijft fout
  await expect.poll(() => consoleFouten.length).toBeGreaterThan(0);
  expect(consoleFouten.some(f => f.includes('/api/plan-datum'))).toBe(true);
  expect(consoleFouten.some(f => f.includes('/api/plan ') || f.endsWith('/api/plan)') || /\/api\/plan(?!-)/.test(f))).toBe(false);
  neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten);
});

// Een verwachte HTTP-fout die uitblijft laat de test falen (test.fail: het afterEach-vangnet moet breken).
test('Zelftest: een verwachte HTTP-fout die uitblijft faalt de test', async ({ page, verzoeken }) => {
  test.fail();
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  verwachtHttpFout(verzoeken, [{ pad: '/api/plan', status: 500 }]);
  await startAppProductie(page, { technieker: 'Tim' });
});

// verwachtNetwerkFout (etappe 7): een afgebroken verzoek is enkel toegelaten voor het aangegeven pad.
test('Zelftest: verwachtNetwerkFout laat enkel het aangegeven pad door', async ({ page, verzoeken }) => {
  const z = zohoStubs();
  z.zetAntwoord('plan', { afbreken: 'failed' });
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/plan']);
  verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan' }]);
  await startAppProductie(page, { technieker: 'Tim', overschrijf: z.overschrijf });
  const uitkomst = await page.evaluate(() => fetch('/api/plan', { method: 'POST', body: '{}' }).then(() => 'bereikt', (e) => e.name));
  expect(uitkomst).toBe('TypeError');
  expect(z.opnames.plan).toHaveLength(1); // het verzoek bereikte de stub, daarna brak de route het af
});

// Een niet-verwachte requestfailed blijft een consolefout (test.fail: het afterEach-vangnet moet breken).
test('Zelftest: een niet-verwachte netwerkfout faalt de test', async ({ page, verzoeken }) => {
  test.fail();
  const z = zohoStubs();
  z.zetAntwoord('plan', { afbreken: 'failed' });
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/plan']);
  await startAppProductie(page, { technieker: 'Tim', overschrijf: z.overschrijf });
  await page.evaluate(() => fetch('/api/plan', { method: 'POST', body: '{}' }).then(() => 'bereikt', (e) => e.name));
});

// Een verwachte netwerkfout op een ander pad dekt de fout niet: die blijft een consolefout.
test('Zelftest: verwachtNetwerkFout voor een ander pad dekt de fout niet', async ({ page, verzoeken }) => {
  test.fail();
  const z = zohoStubs();
  z.zetAntwoord('plan', { afbreken: 'failed' });
  verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/plan']);
  verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan-datum' }]);
  await startAppProductie(page, { technieker: 'Tim', overschrijf: z.overschrijf });
  await page.evaluate(() => fetch('/api/plan', { method: 'POST', body: '{}' }).then(() => 'bereikt', (e) => e.name));
});

// Een verwachte netwerkfout die uitblijft laat de test falen.
test('Zelftest: een verwachte netwerkfout die uitblijft faalt de test', async ({ page, verzoeken }) => {
  test.fail();
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  verwachtNetwerkFout(verzoeken, [{ pad: '/api/plan' }]);
  await startAppProductie(page, { technieker: 'Tim' });
});

// verwachtConsoleFout (etappe 7): enkel een console.error met de aangegeven tekst is toegelaten.
test('Zelftest: verwachtConsoleFout laat enkel de aangegeven tekst door', async ({ page, verzoeken, consoleFouten }) => {
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  verwachtConsoleFout(verzoeken, [{ bevat: 'bewuste testmelding' }]);
  await startAppProductie(page, { technieker: 'Tim' });
  await page.evaluate(() => console.error('dit is een bewuste testmelding van de zelftest'));
  await page.evaluate(() => console.error('een andere fout'));
  await expect.poll(() => consoleFouten.length).toBe(1);
  expect(consoleFouten[0]).toContain('een andere fout');
  neemGeblokkeerdeProbesOver(page, verzoeken, consoleFouten);
});

test('Zelftest: een verwachte consolefout die uitblijft faalt de test', async ({ page, verzoeken }) => {
  test.fail();
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  verwachtConsoleFout(verzoeken, [{ bevat: 'komt nooit' }]);
  await startAppProductie(page, { technieker: 'Tim' });
});
