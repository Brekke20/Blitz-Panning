import { test, expect, VERBODEN_PADEN } from './helpers.mjs';
import { startSalesApp, salesStubs, verwachtFout, SALES_GEBRUIKER, BEHEERDER, VERBODEN_PADEN_SALES } from './sales-hulp.mjs';

// De schil van de sales-planner (Task 13): tabs per rol, start, verkoperkeuze en de foutmelding bij een opslagstoring.
const zichtbareTabs = (page) => page.locator('.tabs-inner .tab:visible');
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const MET_ALLES = { ...SALES_GEBRUIKER, magAlleSales: true };

test.describe('sales: schil en start', () => {
  test('precies de vier sales-tabs, geen ticket-tabs, geen verzoek naar de ticket- of planning-API\'s', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await expect(zichtbareTabs(page)).toHaveCount(4);
    await expect(zichtbareTabs(page)).toHaveText(['Te plannen', 'Kalender', 'Route', 'Afgewerkt']);
    for (const naam of ['Wachtrij', 'Ingepland', 'Inventaris', 'Rapporten', 'Beheer']) await expect(tab(page, naam)).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'sales');
    await expect(page.locator('nav[aria-label="Hoofdmenu"]')).toBeVisible();
    // De koptknoppen die enkel na de gewone opstart werken zijn weg; thema en het gebruikersmenu blijven.
    await expect(page.locator('[data-actie="vernieuw"]')).toBeHidden();
    await expect(page.locator('[data-actie="instellingen"]')).toBeHidden();
    await expect(page.locator('#person-sel')).toBeHidden();
    await expect(page.locator('[data-actie="thema"]')).toBeVisible();
    await expect(page.locator('#gebruiker-sel .gebruiker-btn')).toBeVisible();

    await page.clock.runFor(10000);
    const paden = verzoeken.alle.map(r => r.pad);
    for (const verboden of [...VERBODEN_PADEN, ...VERBODEN_PADEN_SALES]) expect(paden, verboden).not.toContain(verboden);
    expect([...new Set(paden)].sort()).toEqual(['/api/auth-ik', '/api/instellingen', '/api/sales']);
    expect(verzoeken.verboden).toEqual([]);
  });

  test('"Te plannen" is de eerste tab en toont de lege toestand zonder consolefouten', async ({ page, consoleFouten }) => {
    await startSalesApp(page);
    await expect(tab(page, 'Te plannen')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-sales-lijst')).toHaveClass(/active/);
    await expect(page.locator('#view-tickets')).not.toHaveClass(/active/);
    await expect(page.locator('#view-sales-lijst')).toContainText('Nog geen leads. Laad een export.');
    expect(consoleFouten).toEqual([]);
  });

  test('een klik op "Kalender" activeert #view-sales-kalender (de start koppelt de tabklik) en de streep volgt', async ({ page }) => {
    await startSalesApp(page);
    await tab(page, 'Kalender').click();
    await expect(page.locator('#view-sales-kalender')).toHaveClass(/active/);
    await expect(page.locator('#view-sales-lijst')).not.toHaveClass(/active/);
    await expect(tab(page, 'Kalender')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Te plannen')).toHaveAttribute('aria-selected', 'false');
    const streep = await page.locator('.tabs').evaluate(el => ({ links: el.style.getPropertyValue('--ind-left'), breed: el.style.getPropertyValue('--ind-width') }));
    expect(parseFloat(streep.breed)).toBeGreaterThan(0);
    await tab(page, 'Afgewerkt').click();
    await expect(page.locator('#view-sales-afgewerkt')).toHaveClass(/active/);
    await tab(page, 'Route').click();
    await expect(page.locator('#view-sales-route')).toHaveClass(/active/);
  });

  test('een tabwissel heen en weer tekent het scherm niet dubbel en herlaadt de leads', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await tab(page, 'Kalender').click();
    await tab(page, 'Te plannen').click();
    await expect(page.locator('#view-sales-lijst .sales-leeg')).toHaveCount(1);
    await expect(page.locator('#view-sales-lijst .sales-inhoud')).toHaveCount(1);
    expect(verzoeken.van('/api/sales', 'GET').length).toBeGreaterThanOrEqual(3);
  });

  test('zonder bewaarde instellingen (instellingen: null) werkt alles met de standaardwaarden', async ({ page, verzoeken, consoleFouten }) => {
    await startSalesApp(page, { instellingen: null });
    await tab(page, 'Kalender').click();
    await expect(page.locator('#view-sales-kalender')).toHaveClass(/active/);
    expect(verzoeken.van('/api/instellingen', 'GET').length).toBeGreaterThan(0);
    expect(consoleFouten).toEqual([]);
  });

  test('met bewaarde leads toont "Te plannen" ze (de schil laadt het eigen blob)', async ({ page }) => {
    await startSalesApp(page, { leads: [{ id: 'l1', naam: 'Verhaegen', voornaam: 'Lotte', status: 'te-plannen', bezoeken: [] }] });
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(1);
    await expect(page.locator('#view-sales-lijst')).toContainText('Lotte Verhaegen');
  });
});

test.describe('sales: opslagstoring', () => {
  test('een 503 opslag-storing op GET /api/sales toont de melding met Opnieuw, zonder loginscherm; Opnieuw laadt alsnog', async ({ page, consoleFouten }) => {
    const echte = salesStubs();
    let eerste = true;
    const sales = async (z) => {
      if (z.methode === 'GET' && eerste) { eerste = false; return { status: 503, json: { error: 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.', code: 'opslag-storing' } }; }
      return echte.sales(z);
    };
    await startSalesApp(page, { overschrijf: { sales, instellingen: echte.instellingen, gebruikers: echte.gebruikers } });
    const view = page.locator('#view-sales-lijst');
    // De globale fetch-omhulling toont dezelfde tekst ook als toast: scope op de view.
    await expect(view.getByText('De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.')).toBeVisible();
    await expect(view.getByRole('button', { name: 'Opnieuw' })).toBeVisible();
    await expect(page.locator('#login-overlay')).toHaveCount(0);
    await expect(tab(page, 'Te plannen')).toBeVisible();
    await verwachtFout(consoleFouten, '/api/sales', 503);

    await view.getByRole('button', { name: 'Opnieuw' }).click();
    await expect(view).toContainText('Nog geen leads. Laad een export.');
    await expect(view.getByRole('button', { name: 'Opnieuw' })).toHaveCount(0);
  });
});

test.describe('sales: verkoperkeuze', () => {
  test('een gewone verkoper ziet geen keuzelijst en vraagt geen verkopers op', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await expect(page.locator('#view-sales-lijst .sales-verkoper')).toHaveCount(0);
    await expect(page.locator('#view-sales-lijst')).toContainText('Nog geen leads');
    expect(verzoeken.van('/api/gebruikers')).toEqual([]);
    await expect.poll(() => verzoeken.van('/api/sales', 'GET').length).toBeGreaterThan(0);
  });

  test('een verkoper met "mag alle sales zien" kiest een verkoper; de keuze blijft en de andere blob wordt gelezen', async ({ page, verzoeken }) => {
    const echte = salesStubs({ gebruiker: MET_ALLES });
    const gevraagd = [];
    const sales = (z) => { if (z.methode === 'GET') gevraagd.push(z.query.get('gebruiker')); return echte.sales(z); };
    await startSalesApp(page, { gebruiker: MET_ALLES, overschrijf: { sales } });
    const keuze = page.locator('#view-sales-lijst').getByLabel('Verkoper');
    await expect(keuze).toBeVisible();
    await expect(keuze).toHaveValue('u-test'); // standaard: de eigen leads
    await expect(page.locator('#view-sales-lijst .sales-alleen-lezen')).toBeHidden();
    await keuze.selectOption('u-bea');
    await expect(page.locator('#view-sales-lijst .sales-alleen-lezen')).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('blitz_sales_verkoper'))).toBe('u-bea');
    await tab(page, 'Kalender').click();
    await expect(page.locator('#view-sales-kalender').getByLabel('Verkoper')).toHaveValue('u-bea');
    // De blob van Bea werd aangevraagd (niet de eigen).
    await expect.poll(() => gevraagd.includes('u-bea')).toBe(true);
    expect(gevraagd[0]).toBeNull(); // de eigen blob: geen ?gebruiker=
    expect(verzoeken.van('/api/gebruikers', 'GET').length).toBeGreaterThan(0);
  });

  test('de beheerder krijgt één tab "Sales" met subtabs en een verkoperkeuze; de hoofdtabnamen blijven eenduidig', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER });
    await expect(zichtbareTabs(page)).toHaveCount(8);
    await expect(tab(page, 'Sales')).toBeVisible();
    // De subtabs bestaan enkel binnen de Sales-view: zolang die niet open is, blijven Kalender en Route eenduidig.
    await expect(page.getByRole('tab', { name: 'Kalender' })).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Route' })).toHaveCount(1);
    await tab(page, 'Sales').click();
    const subs = page.getByRole('tablist', { name: 'Sales-onderdelen' });
    await expect(subs.getByRole('tab')).toHaveText(['Te plannen', 'Kalender', 'Route', 'Afgewerkt']);
    await expect(subs.getByRole('tab', { name: 'Te plannen' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-sales-lijst')).toBeVisible();
    await expect(page.locator('#view-sales-kalender')).toBeHidden();
    await expect(page.locator('#view-sales-lijst').getByLabel('Verkoper')).toHaveValue('u-bea'); // de eerste verkoper (op naam)

    await subs.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#view-sales-kalender')).toBeVisible();
    await expect(page.locator('#view-sales-lijst')).toBeHidden();
    await expect(page.locator('#view-sales-kalender')).toContainText('De kalender volgt.');
    await expect(page.locator('#view-sales-kalender .sales-alleen-lezen')).toBeHidden(); // de beheerder mag schrijven
    await expect(page.locator('#view-sales-kalender').getByLabel('Verkoper')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('blitz_sales_subtab'))).toBe('sales-kalender');
  });

  test('subtabs: pijltjestoetsen en Home/End, en het gekozen subtab wordt onthouden', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER });
    await tab(page, 'Sales').click();
    const subs = page.getByRole('tablist', { name: 'Sales-onderdelen' });
    await subs.getByRole('tab', { name: 'Te plannen' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(subs.getByRole('tab', { name: 'Kalender' })).toHaveAttribute('aria-selected', 'true');
    await expect(subs.getByRole('tab', { name: 'Kalender' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(subs.getByRole('tab', { name: 'Afgewerkt' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-sales-afgewerkt')).toBeVisible();
    await page.keyboard.press('ArrowRight'); // omwikkelen
    await expect(subs.getByRole('tab', { name: 'Te plannen' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(subs.getByRole('tab', { name: 'Afgewerkt' })).toHaveAttribute('aria-selected', 'true');
    // Wegnavigeren en terug, en na een herlaad: hetzelfde subtab.
    // Met de Sales-view open bestaat "Kalender" twee keer (hoofdtab en subtab): de hoofdbalk wordt expliciet bevraagd.
    await page.locator('.tabs-inner').getByRole('tab', { name: 'Kalender', exact: true }).click();
    await tab(page, 'Sales').click();
    await expect(subs.getByRole('tab', { name: 'Afgewerkt' })).toHaveAttribute('aria-selected', 'true');
    await page.reload();
    await tab(page, 'Sales').click();
    await expect(subs.getByRole('tab', { name: 'Afgewerkt' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-sales-afgewerkt')).toBeVisible();
  });

  test('de beheerder zonder actieve verkopers ziet een duidelijke melding', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, verkopers: [] });
    await tab(page, 'Sales').click();
    await expect(page.locator('#view-sales-lijst')).toContainText('Geen actieve verkopers gevonden.');
  });
});
