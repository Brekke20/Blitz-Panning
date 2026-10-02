// /api en niet-GET raken de service worker nooit (etappe 7, N3/N21): geen verzoek van de SW, nergens bewaard of uit een cache beantwoord.
import { test, expect, verwachtNetwerkFout } from '../sw-hulp.mjs';

test('Geen /api via de service worker: opstart + een /api-aanroep, geen SW-verzoek naar /api of niet-GET', async ({ page, sw }) => {
  await sw.start();
  const r = await sw.apiAanroep('/api/tickets');
  expect(r.status).toBe(200);
  const alle = sw.swVerzoeken();
  expect(alle.length).toBeGreaterThan(0); // de SW doet wel verzoeken (schil, CDN), dus de controle is niet leeg
  expect(alle.filter(v => new URL(v.url).pathname.startsWith('/api')), 'SW-verzoeken naar /api').toEqual([]);
  expect(alle.filter(v => v.methode !== 'GET'), 'niet-GET SW-verzoeken').toEqual([]);
  const urls = await sw.cacheUrls();
  for (const lijst of Object.values(urls)) expect(lijst.filter(u => new URL(u).pathname.startsWith('/api')), '/api in een cache').toEqual([]);
});

test('/api wordt nooit uit de cache beantwoord: offline na een geslaagde laad faalt dezelfde /api-aanroep (geen oude data)', async ({ page, sw, verzoeken }) => {
  verwachtNetwerkFout(verzoeken, [{ pad: '/api/tickets', methode: 'GET' }]);
  await sw.start();
  const online = await sw.apiAanroep('/api/tickets');
  expect(online.status).toBe(200);
  expect(online.tekst).toContain('tickets');
  // Zonder verbinding bereikt een /api-aanroep de server niet. Had de SW /api bewaard, dan kwam hier het oude antwoord terug;
  // dat gebeurt niet: de aanroep faalt.
  await sw.zetOffline(true);
  sw.breekAf('/api/tickets');
  const offline = await sw.apiAanroep('/api/tickets');
  expect(offline).toEqual({ fout: 'TypeError' });
  expect(sw.swVerzoeken().filter(v => new URL(v.url).pathname.startsWith('/api'))).toEqual([]);
  const urls = await sw.cacheUrls();
  for (const lijst of Object.values(urls)) expect(lijst.filter(u => new URL(u).pathname.startsWith('/api')), '/api in een cache').toEqual([]);
});
