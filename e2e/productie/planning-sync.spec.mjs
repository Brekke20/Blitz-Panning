// v2.1.6 (tablet): een ticket dat op de pc uit de planning gehaald werd, bleef op de tablet staan. De tablet haalde de tickets enkel elke
// 5 minuten opnieuw op (en enkel terwijl de app zichtbaar was): wie de app op de achtergrond had en weer opende, zag tot de volgende poll
// de oude planning. Productiemodus: de nep-backend (/api/tickets) verandert zoals Zoho na "Uit planning halen" op de pc.
import { test, expect, startAppProductie, verwachtSchrijven, verwachtNetwerkFout, OPSTART_SCHRIJVEN, TICKETS_STUB } from '../productie-hulp.mjs';

test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

const planningVan = (page) => page.evaluate(() => Object.fromEntries(
  Object.entries(kern.toestand.get('planning')).map(([d, s]) => [d, s.map(p => p.ticket.id)])));

// Zoho na "Uit planning halen" op de pc: g1 is terug "Service in te plannen", zonder interventiedatum.
function naUitplannen() {
  const d = structuredClone(TICKETS_STUB);
  const g1 = d.plannedTickets.find(t => t.id === 'g1');
  d.plannedTickets = d.plannedTickets.filter(t => t.id !== 'g1');
  d.tickets.push({ ...g1, status: 'Service in te plannen', interventieDatum: null });
  return d;
}

function ticketsBackend() {
  const staat = { stand: structuredClone(TICKETS_STUB), offline: false };
  const tickets = () => (staat.offline ? { afbreken: 'failed' } : { status: 200, json: structuredClone(staat.stand) });
  return { staat, tickets };
}

async function zetZichtbaar(page, zichtbaar) {
  await page.evaluate((z) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (z ? 'visible' : 'hidden') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !z });
    document.dispatchEvent(new Event('visibilitychange'));
  }, zichtbaar);
}

test('tablet op de achtergrond: bij terugkeer naar de app verdwijnt het op de pc uitgeplande ticket meteen', async ({ page, verzoeken }) => {
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  const b = ticketsBackend();
  await startAppProductie(page, { overschrijf: { tickets: b.tickets } });
  expect((await planningVan(page))['2026-10-09']).toEqual(['g1']);

  await zetZichtbaar(page, false);
  b.staat.stand = naUitplannen(); // de pc haalt g1 uit de planning
  await page.clock.runFor(2 * 60 * 1000); // de poll slaat een onzichtbare pagina over
  expect((await planningVan(page))['2026-10-09']).toEqual(['g1']);

  await zetZichtbaar(page, true);
  await expect.poll(async () => (await planningVan(page))['2026-10-09']).toBeUndefined();
  await expect(page.locator('#cnt-tickets')).toHaveText('4');
});

test('tablet was offline: na het herstel van de verbinding verdwijnt het uitgeplande ticket', async ({ page, verzoeken }) => {
  verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
  verwachtNetwerkFout(verzoeken, [{ pad: '/api/tickets', methode: 'GET' }]);
  const b = ticketsBackend();
  await startAppProductie(page, { overschrijf: { tickets: b.tickets } });

  await zetZichtbaar(page, false);
  b.staat.stand = naUitplannen();
  b.staat.offline = true;
  await page.clock.runFor(2 * 60 * 1000);
  await zetZichtbaar(page, true); // terug in de app, maar zonder verbinding: de lading mislukt, de bestaande planning blijft staan
  await expect.poll(() => verzoeken.van('/api/tickets', 'GET').length).toBe(2);
  expect((await planningVan(page))['2026-10-09']).toEqual(['g1']);

  b.staat.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(async () => (await planningVan(page))['2026-10-09']).toBeUndefined();
  await expect(page.locator('#cnt-tickets')).toHaveText('4');
});
