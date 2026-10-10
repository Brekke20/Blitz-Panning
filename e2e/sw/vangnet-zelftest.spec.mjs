// Zelftest van het service worker-vangnet (etappe 7, N14/N15): bewijst dat de sloten ook dicht zijn voor een fetch IN de service worker,
// niet alleen voor een fetch uit de pagina. Draai deze eerst:  npx playwright test --project=sw vangnet-zelftest
//   - positief: een echte Zoho-, TomTom- en mailhost wordt uit de pagina EN uit een SW geblokkeerd (de fetch faalt met een TypeError) en
//     door de sloten genoteerd; pas daarna worden de bewuste meldingen overgenomen;
//   - negatief (`test.fail`): zonder overnemen laat precies die melding de test falen (het afterEach-vangnet slaat aan).
import { test, expect } from '../sw-hulp.mjs';
import { neemSwProbesOver } from './zelftest-hulp.mjs';

const DOELEN = [
  'https://desk.zoho.eu/api/v1/tickets',
  'https://api.tomtom.com/routing/1/calculateRoute/0,0:1,1/json',
  'https://smtp.mailgun.org/v3/example/messages',
];

test.describe.configure({ mode: 'serial' });

test('Zelftest: Zoho, TomTom en mail worden uit de pagina en uit een service worker geblokkeerd en gemeld', async ({ page, sw, verzoeken, consoleFouten }) => {
  await sw.start();
  for (const doel of DOELEN) {
    const uitPagina = await sw.probeUitPagina(doel);
    expect(uitPagina, `pagina -> ${doel}`).toEqual({ geslaagd: false, fout: 'TypeError' });
    const uitSw = await sw.probeUitSw(doel);
    expect(uitSw, `service worker -> ${doel}`).toEqual({ geslaagd: false, fout: 'TypeError' });
  }
  const gezien = neemSwProbesOver(page, verzoeken, consoleFouten);
  // Elke probe is twee keer genoteerd door het host-slot (één keer uit de pagina, één keer uit de SW).
  expect([...gezien.buitenHost].sort()).toEqual([...DOELEN, ...DOELEN].sort());
  expect(gezien.ongeoorloofd.length).toBe(DOELEN.length * 2);
  // De SW-waarnemer meldt enkel de drie probes die uit de SW kwamen.
  expect(gezien.swOvertredingen.length).toBe(DOELEN.length);
  for (const doel of DOELEN) expect(gezien.swOvertredingen.some(m => m.includes(doel)), doel).toBe(true);
  expect(gezien.consoleFouten.length).toBeGreaterThan(0);
});

test('Zelftest: een /api-verzoek van de service worker zelf wordt gemeld (ook al is het gestubd)', async ({ page, sw, verzoeken, consoleFouten }) => {
  await sw.start();
  await sw.probeUitSw('http://localhost:3338/api/tickets');
  const gezien = neemSwProbesOver(page, verzoeken, consoleFouten);
  expect(gezien.swOvertredingen).toEqual([expect.stringContaining('/api-verzoek van de service worker')]);
  expect(gezien.buitenHost).toEqual([]);
});

// Negatief: dezelfde probes zonder ze over te nemen. Het auto-vangnet moet de test laten falen; `test.fail` slaagt enkel als dat gebeurt.
test('Zelftest (moet falen): een fetch uit de pagina naar Zoho laat de test falen', async ({ sw }) => {
  test.fail();
  await sw.start();
  await sw.probeUitPagina(DOELEN[0]);
});

test('Zelftest (moet falen): een fetch uit een service worker naar Zoho laat de test falen', async ({ sw }) => {
  test.fail();
  await sw.start();
  await sw.probeUitSw(DOELEN[0]);
});

test('Zelftest (moet falen): een fetch uit een service worker naar TomTom laat de test falen', async ({ sw }) => {
  test.fail();
  await sw.start();
  await sw.probeUitSw(DOELEN[1]);
});

test('Zelftest (moet falen): een fetch uit een service worker naar een mailhost laat de test falen', async ({ sw }) => {
  test.fail();
  await sw.start();
  await sw.probeUitSw(DOELEN[2]);
});

test('Zelftest (moet falen): een /api-verzoek van de service worker laat de test falen', async ({ sw }) => {
  test.fail();
  await sw.start();
  await sw.probeUitSw('http://localhost:3338/api/tickets');
});
