import { test, expect, startApp, VERBODEN_PADEN } from './helpers.mjs';
import { startSalesApp, maakSalesBackend, verwachtFout, BEHEERDER, SALES_GEBRUIKER, VERBODEN_PADEN_SALES } from './sales-hulp.mjs';

// Rollen en isolatie van de sales-planner (Task 19): wie ziet en doet wat. De stubs zijn de ECHTE server-handlers (geen eigen rechtenlogica
// in de test): een 403 komt dus van de echte rechtenrijen en `bepaalDoel`.
const zichtbareTabs = (page) => page.locator('.tabs-inner .tab:visible');
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const MET_ALLES = { ...SALES_GEBRUIKER, magAlleSales: true };

const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Bea V.', geexporteerdOp: null }, ...extra,
});
// Het blob van verkoper Bea (u-bea) met twee leads, voor de weergave van een collega.
const BEA_BLOB = { 'sales/u-bea': { versie: 4, leads: [lead('b1', 'Peeters'), lead('b2', 'Wouters')], blokken: [], grafstenen: [] } };

const lijst = (page) => page.locator('#view-sales-lijst');

// Een fetch vanuit de pagina, met de gewone headers van de app (X-Blitz bij schrijven): geeft { status, body }.
const apiGet = (page, pad) => page.evaluate(async (p) => {
  const r = await fetch(p);
  return { status: r.status, body: await r.json().catch(() => null) };
}, pad);

test.describe('sales: rollen en isolatie', () => {
  test('(a) rol sales: enkel de vier sales-tabs, #view-tickets niet actief, geen verzoek naar tickets, inventaris of rapport-archief', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await expect(zichtbareTabs(page)).toHaveText(['Te plannen', 'Kalender', 'Route', 'Afgewerkt']);
    await expect(page.locator('#view-tickets')).not.toHaveClass(/active/);
    await expect(page.locator('#view-tickets')).toBeHidden();
    // Elke sales-tab doorlopen: ook dan geen verboden verzoeken.
    for (const naam of ['Kalender', 'Route', 'Afgewerkt', 'Te plannen']) await tab(page, naam).click();
    await page.clock.runFor(10000);
    const paden = verzoeken.alle.map(r => r.pad);
    for (const verboden of ['/api/tickets', '/api/inventaris', '/api/rapport-archief', ...VERBODEN_PADEN, ...VERBODEN_PADEN_SALES]) {
      expect(paden, verboden).not.toContain(verboden);
    }
    expect(verzoeken.verboden).toEqual([]);
  });

  test('(b) verkoper A zonder "mag alle sales zien": geen keuzelijst; een andere verkoper opvragen geeft 403 van de echte handler', async ({ page, consoleFouten }) => {
    await startSalesApp(page, { blobs: BEA_BLOB });
    await expect(lijst(page).getByLabel('Verkoper')).toHaveCount(0);
    await expect(lijst(page).locator('.sales-verkoper')).toHaveCount(0);
    const ander = await apiGet(page, '/api/sales?gebruiker=u-bea');
    expect(ander.status).toBe(403);
    expect(ander.body.code).toBe('geen-recht');
    expect(JSON.stringify(ander.body)).not.toContain('Peeters');
    await verwachtFout(consoleFouten, '/api/sales', 403);
    // Het eigen blob blijft gewoon leesbaar.
    expect((await apiGet(page, '/api/sales')).status).toBe(200);
  });

  test('(c) met "mag alle sales zien": de keuzelijst toont B en diens leads zijn alleen-lezen (geen ✕, Export laden, Plan deze week of Instellingen)', async ({ page }) => {
    await startSalesApp(page, { gebruiker: MET_ALLES, blobs: BEA_BLOB, leads: [lead('e1', 'Eigenaar')] });
    const keuze = lijst(page).getByLabel('Verkoper');
    await expect(keuze).toBeVisible();
    await expect(keuze.locator('option')).toContainText(['Bea Verkoper', 'Carl Verkoper', 'Test Verkoper (jij)']);

    // Eigen leads: alles beschikbaar (controle dat de verborgen knoppen hieronder echt door de rol verdwijnen).
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await expect(lijst(page).getByRole('button', { name: 'Export laden' })).toBeVisible();
    await expect(lijst(page).getByRole('button', { name: /Verwijder/ })).toHaveCount(1);
    await expect(lijst(page).getByRole('button', { name: '⚙ Instellingen' })).toBeVisible();

    // De leads van Bea: zichtbaar, maar alleen-lezen.
    await keuze.selectOption('u-bea');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(2);
    await expect(lijst(page)).toContainText('Test Peeters');
    await expect(lijst(page).locator('.sales-alleen-lezen')).toBeVisible();
    await expect(lijst(page).locator('.sales-kaart-wis')).toHaveCount(0);
    await expect(lijst(page).getByRole('button', { name: 'Export laden' })).toHaveCount(0);
    await expect(lijst(page).getByRole('button', { name: '+ Lead' })).toHaveCount(0);
    await expect(lijst(page).getByRole('button', { name: '⚙ Instellingen' })).toBeHidden();

    await tab(page, 'Kalender').click();
    await expect(page.locator('#view-sales-kalender .sales-kal')).toBeVisible();
    await expect(page.locator('#view-sales-kalender .sales-alleen-lezen')).toBeVisible();
    await expect(page.locator('#view-sales-kalender').getByRole('button', { name: /Plan deze week/ })).toHaveCount(0);
    await expect(page.locator('#view-sales-kalender').getByRole('button', { name: /Blok/ })).toHaveCount(0);
    await expect(page.locator('#view-sales-kalender').getByRole('button', { name: '⚙ Instellingen' })).toBeHidden();
  });

  test('(c2) een verkoper met "mag alle sales zien" kan bij een collega niets schrijven (de server weigert met 403)', async ({ page, consoleFouten }) => {
    await startSalesApp(page, { gebruiker: MET_ALLES, blobs: BEA_BLOB });
    const r = await page.evaluate(async () => {
      const res = await fetch('/api/sales?gebruiker=u-bea', {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-blitz': '1' },
        body: JSON.stringify({ versie: 4, leads: [{ id: 'b1', velden: { notitie: 'binnengeglipt' } }] }),
      });
      return { status: res.status, body: await res.json() };
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('geen-recht');
    await verwachtFout(consoleFouten, '/api/sales', 403);
    const nu = await apiGet(page, '/api/sales?gebruiker=u-bea');
    expect(nu.status).toBe(200);
    expect(nu.body.versie).toBe(4);
    expect(JSON.stringify(nu.body)).not.toContain('binnengeglipt');
  });

  test('(d) beheerder: één tab "Sales" met subtabs en verkoperkeuze; mag schrijven (✕, Plan deze week) maar heeft geen Export laden', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs: BEA_BLOB });
    await tab(page, 'Sales').click();
    const subs = page.getByRole('tablist', { name: 'Sales-onderdelen' });
    await expect(subs.getByRole('tab')).toHaveText(['Te plannen', 'Kalender', 'Route', 'Afgewerkt']);
    const keuze = lijst(page).getByLabel('Verkoper');
    await expect(keuze).toBeVisible();
    await expect(keuze).toHaveValue('u-bea');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(2);
    await expect(lijst(page).locator('.sales-alleen-lezen')).toBeHidden(); // schrijfbaar
    await expect(lijst(page).locator('.sales-kaart-wis')).toHaveCount(2);
    await expect(lijst(page).getByRole('button', { name: 'Export laden' })).toHaveCount(0);
    await expect(lijst(page).getByRole('button', { name: '+ Lead' })).toHaveCount(0);

    await subs.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#view-sales-kalender .sales-kal')).toBeVisible();
    await expect(page.locator('#view-sales-kalender').getByRole('button', { name: /Plan deze week/ })).toBeVisible();
  });

  for (const rol of ['technieker', 'planner']) {
    test(`(e) rol ${rol}: geen sales-tabs en GET /api/sales geeft 403 geen-recht van de echte handler`, async ({ page, consoleFouten }) => {
      const gebruiker = { id: 'u-test', email: `${rol}@test.be`, naam: `Test ${rol}`, rol, actief: true };
      const { stubs } = maakSalesBackend({ gebruiker, blobs: BEA_BLOB });
      await startApp(page, { loginRol: rol, overschrijf: { sales: stubs.sales, 'sales-import': stubs['sales-import'] } });
      await expect(zichtbareTabs(page).first()).toBeVisible();
      for (const naam of ['Sales', 'Te plannen', 'Afgewerkt']) await expect(tab(page, naam)).toHaveCount(0);
      await expect(page.locator('[id^="view-sales"]')).toHaveCount(0);
      const r = await apiGet(page, '/api/sales');
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('geen-recht');
      const ander = await apiGet(page, '/api/sales?gebruiker=u-bea');
      expect(ander.status).toBe(403);
      expect(JSON.stringify(ander.body)).not.toContain('Peeters');
      await verwachtFout(consoleFouten, '/api/sales', 403, 4);
    });
  }
});
