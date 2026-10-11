import { test, expect, VERBODEN_PADEN } from './helpers.mjs';
import { startSalesApp, salesStubs, verwachtFout, kiesVerkoper, SALES_GEBRUIKER, BEHEERDER, VERBODEN_PADEN_SALES } from './sales-hulp.mjs';

// De schil van de sales-planner (Task 13): tabs per rol, start, verkoperkeuze en de foutmelding bij een opslagstoring.
const zichtbareTabs = (page) => page.locator('.tabs-inner .tab:visible');
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const MET_ALLES = { ...SALES_GEBRUIKER, magAlleSales: true };

test.describe('sales: schil en start', () => {
  test('precies de vier sales-tabs, geen ticket-tabs, geen verzoek naar de ticket- of planning-API\'s', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await expect(zichtbareTabs(page)).toHaveCount(4);
    await expect(zichtbareTabs(page)).toHaveText(['Leads', 'Kalender', 'Route', 'Afgewerkt']);
    for (const naam of ['Wachtrij', 'Ingepland', 'Inventaris', 'Rapporten', 'Beheer']) await expect(tab(page, naam)).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'sales');
    await expect(page.locator('nav[aria-label="Hoofdmenu"]')).toBeVisible();
    // ↺, ⚙, thema en het gebruikersmenu staan in de kop; de persoonskiezer niet.
    await expect(page.locator('[data-actie="vernieuw"]')).toBeVisible(); // ↺ staat voor sales net als bij de techniekers in de kop (kop B)
    await expect(page.locator('[data-actie="instellingen"]')).toBeVisible(); // ⚙ staat voor sales net als bij de techniekers in de kop (kop B)
    await expect(page.locator('#person-sel')).toBeHidden();
    await expect(page.locator('[data-actie="thema"]')).toBeVisible();
    await expect(page.locator('#gebruiker-sel .gebruiker-btn')).toBeVisible();

    await page.clock.runFor(10000);
    const paden = verzoeken.alle.map(r => r.pad);
    for (const verboden of [...VERBODEN_PADEN, ...VERBODEN_PADEN_SALES]) expect(paden, verboden).not.toContain(verboden);
    expect([...new Set(paden)].sort()).toEqual(['/api/auth-ik', '/api/instellingen', '/api/sales']);
    expect(verzoeken.verboden).toEqual([]);
  });

  test('"Leads" is de eerste tab en toont de lege toestand zonder consolefouten', async ({ page, consoleFouten }) => {
    await startSalesApp(page);
    await expect(tab(page, 'Leads')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-sales-lijst')).toHaveClass(/active/);
    await expect(page.locator('#view-tickets')).not.toHaveClass(/active/);
    await expect(page.locator('#view-sales-lijst')).toContainText('Nog geen leads. Laad een export of voeg zelf een lead toe.');
    expect(consoleFouten).toEqual([]);
  });

  test('een klik op "Kalender" activeert #view-sales-kalender (de start koppelt de tabklik) en de streep volgt', async ({ page }) => {
    await startSalesApp(page);
    await tab(page, 'Kalender').click();
    await expect(page.locator('#view-sales-kalender')).toHaveClass(/active/);
    await expect(page.locator('#view-sales-lijst')).not.toHaveClass(/active/);
    await expect(tab(page, 'Kalender')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Leads')).toHaveAttribute('aria-selected', 'false');
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
    await tab(page, 'Leads').click();
    await expect(page.locator('#view-sales-lijst .sales-leeg')).toHaveCount(1);
    await expect(page.locator('#view-sales-lijst .sales-inhoud')).toHaveCount(1);
    await expect.poll(() => verzoeken.van('/api/sales', 'GET').length).toBeGreaterThanOrEqual(3); // het herladen loopt asynchroon
  });

  test('zonder bewaarde instellingen (instellingen: null) werkt alles met de standaardwaarden', async ({ page, verzoeken, consoleFouten }) => {
    await startSalesApp(page, { instellingen: null });
    await tab(page, 'Kalender').click();
    await expect(page.locator('#view-sales-kalender')).toHaveClass(/active/);
    expect(verzoeken.van('/api/instellingen', 'GET').length).toBeGreaterThan(0);
    expect(consoleFouten).toEqual([]);
  });

  test('met bewaarde leads toont "Leads" ze (de schil laadt het eigen blob)', async ({ page }) => {
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
    await expect(tab(page, 'Leads')).toBeVisible();
    await verwachtFout(consoleFouten, '/api/sales', 503);

    await view.getByRole('button', { name: 'Opnieuw' }).click();
    await expect(view).toContainText('Nog geen leads. Laad een export of voeg zelf een lead toe.');
    await expect(view.getByRole('button', { name: 'Opnieuw' })).toHaveCount(0);
  });
});

test.describe('sales: ↺ in de kop', () => {
  test('↺ laadt de leads en de instellingen van het open scherm opnieuw (en enkel dat scherm)', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [{ id: 'l1', voornaam: 'Test', naam: 'Verhaegen', gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null, locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [], geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null } }] });
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(1);
    const sales = () => verzoeken.van('/api/sales', 'GET').length;
    const instellingen = () => verzoeken.van('/api/instellingen', 'GET').length;
    const [s0, i0] = [sales(), instellingen()];
    await page.locator('[data-actie="vernieuw"]').click();
    await expect.poll(sales).toBe(s0 + 1);
    await expect.poll(instellingen).toBe(i0 + 1);
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(1);
    await expect(page.locator('[data-actie="vernieuw"]')).toHaveAttribute('aria-label', 'Vernieuwen');
  });
});

test.describe('sales: verkoperkeuze', () => {
  test('een gewone verkoper ziet geen kiezer en vraagt geen verkopers op', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await expect(page.locator('#person-sel')).toBeHidden();
    await expect(page.locator('#view-sales-lijst .sales-verkoper')).toHaveCount(0);
    await expect(page.locator('#view-sales-lijst')).toContainText('Nog geen leads');
    expect(verzoeken.van('/api/gebruikers')).toEqual([]);
    await expect.poll(() => verzoeken.van('/api/sales', 'GET').length).toBeGreaterThan(0);
  });

  test('een verkoper met "mag alle sales zien" kiest een verkoper in de kop; de keuze blijft en de andere blob wordt gelezen', async ({ page, verzoeken }) => {
    const echte = salesStubs({ gebruiker: MET_ALLES });
    const gevraagd = [];
    const sales = (z) => { if (z.methode === 'GET') gevraagd.push(z.query.get('gebruiker')); return echte.sales(z); };
    await startSalesApp(page, { gebruiker: MET_ALLES, overschrijf: { sales } });
    const knop = page.locator('#person-btn');
    await expect(knop).toBeVisible();
    await expect(knop).toContainText('Sales:');
    await expect(knop).toHaveAttribute('aria-label', /Kies verkoper, nu Test Verkoper$/); // standaard: de eigen leads
    await expect(page.locator('.person-lezen')).toHaveCount(0);
    await kiesVerkoper(page, 'u-bea');
    await expect(knop).toHaveAttribute('aria-label', /nu Bea Verkoper, alleen lezen/);
    await expect(page.locator('.person-lezen')).toHaveText('Alleen lezen');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('blitz_sales_verkoper'))).toBe('u-bea');
    await tab(page, 'Kalender').click();
    await expect(knop).toHaveAttribute('aria-label', /nu Bea Verkoper/);
    // De blob van Bea werd aangevraagd (niet de eigen).
    await expect.poll(() => gevraagd.includes('u-bea')).toBe(true);
    expect(gevraagd[0]).toBeNull(); // de eigen blob: geen ?gebruiker=
    expect(verzoeken.van('/api/gebruikers', 'GET').length).toBeGreaterThan(0);
  });

  test('de beheerder in de werkruimte Sales: precies de tabs Leads, Kalender, Route, Afgewerkt en Beheer; geen tab "Sales", geen subtabs', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER });
    await expect(zichtbareTabs(page)).toHaveText(['Leads', 'Kalender', 'Route', 'Afgewerkt', 'Beheer']);
    for (const naam of ['Sales', 'Wachtrij', 'Ingepland', 'Inventaris', 'Rapporten']) await expect(tab(page, naam)).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'Sales-onderdelen' })).toHaveCount(0);
    await expect(page.locator('#view-sales')).toHaveCount(0);
    await expect(tab(page, 'Leads')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#view-sales-lijst')).toBeVisible();
    await expect(page.locator('#person-btn')).toContainText('Sales:');
    await expect(page.locator('#person-btn')).toHaveAttribute('aria-label', /nu Bea Verkoper/); // de eerste actieve verkoper (op naam)
    await tab(page, 'Kalender').click();
    await expect(page.locator('#view-sales-kalender')).toBeVisible();
    await expect(page.locator('#view-sales-lijst')).toBeHidden();
    await expect(page.locator('#view-sales-kalender .sales-kal')).toBeVisible(); // de echte kalender (Task 16)
    await expect(page.locator('.person-lezen')).toHaveCount(0); // de beheerder mag schrijven
  });

  test('S7: een verkoper die intussen is aangemaakt staat in de kiezer zodra de beheerder een sales-scherm opnieuw opent', async ({ page }) => {
    const NIEUW = { id: 'u-nieuw', email: 'nieuw@test.be', naam: 'Nieuwe Verkoper', rol: 'sales', salesNaam: 'Nieuwe V.', magAlleSales: false, actief: true };
    const echte = salesStubs({ gebruiker: BEHEERDER, verkopers: [NIEUW] }); // de gebruiker bestaat in de opslag; de lijst "verschijnt" pas later
    let lijst = [];
    const gebruikers = (z) => (z.methode === 'GET' && z.query?.get('rol') === 'sales' ? { status: 200, json: { gebruikers: lijst } } : echte.gebruikers(z));
    await startSalesApp(page, { gebruiker: BEHEERDER, overschrijf: { ...echte, gebruikers } });
    await expect(page.locator('#view-sales-lijst')).toContainText('Geen actieve verkopers gevonden.');
    // In Beheer > Gebruikers wordt een verkoper aangemaakt (hier: de stub geeft hem nu terug).
    lijst = [NIEUW];
    await tab(page, 'Beheer').click();
    await tab(page, 'Leads').click();
    await expect(page.locator('#view-sales-lijst')).not.toContainText('Geen actieve verkopers gevonden.');
    await expect(page.locator('#person-btn')).toHaveAttribute('aria-label', /nu Nieuwe Verkoper/);
    await page.locator('#person-btn').click();
    await expect(page.locator('#person-menu .pm-item[data-sleutel="u-nieuw"] .pm-item-name')).toHaveText('Nieuwe Verkoper');
  });

  test('de beheerder zonder actieve verkopers ziet een duidelijke melding', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, verkopers: [] });
    await expect(page.locator('#view-sales-lijst')).toContainText('Geen actieve verkopers gevonden.');
  });

  test('de lijst met verkopers kan niet geladen worden (beheerder): foutmelding met Opnieuw, en daarna staat de verkoper er', async ({ page, consoleFouten }) => {
    const echte = salesStubs({ gebruiker: BEHEERDER });
    let stuk = true;
    const gebruikers = (z) => (stuk && z.methode === 'GET' && z.query?.get('rol') === 'sales' ? { status: 503, json: { error: 'opslag', code: 'opslag-storing' } } : echte.gebruikers(z));
    await startSalesApp(page, { gebruiker: BEHEERDER, overschrijf: { ...echte, gebruikers } });
    const view = page.locator('#view-sales-lijst');
    await expect(view).toContainText('De lijst met verkopers kon niet geladen worden.');
    stuk = false;
    await view.getByRole('button', { name: 'Opnieuw' }).click();
    await expect(view).not.toContainText('De lijst met verkopers kon niet geladen worden.');
    await expect(page.locator('#person-btn')).toHaveAttribute('aria-label', /nu Bea Verkoper/);
    consoleFouten.length = 0; // de 503 op /api/gebruikers is hier de bedoelde fout
  });
});
