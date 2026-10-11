import { test, expect } from './helpers.mjs';
import { startSalesApp, kiesVerkoper, BEHEERDER } from './sales-hulp.mjs';

// Kop B, taak 2: de beheerder wisselt van werkruimte via de persoonskiezer. Een technieker (of "Alle technici") = Techniek, een verkoper = Sales.
// De hoofdtab "Sales" bestaat niet meer; de tabs wisselen en de beheerder blijft op het gelijkaardige scherm. De stubs zijn de echte sales-handlers.
const zichtbareTabs = (page) => page.locator('.tabs-inner .tab:visible');
const tab = (page, naam) => page.getByRole('tab', { name: new RegExp('^' + naam + '( [0-9]+)?$') }); // Wachtrij en Ingepland hebben een teller
const knop = (page) => page.locator('#person-btn');
const actieveTab = (page) => page.locator('.tab.active');
const toast = (page) => page.locator('#toast');

const TECHNIEK_TABS = ['Wachtrij', 'Kalender', 'Route', 'Ingepland', 'Inventaris', 'Rapporten', 'Beheer'];
const SALES_TABS = ['Leads', 'Kalender', 'Route', 'Afgewerkt', 'Beheer'];

const lead = (id, naam) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Bea V.', geexporteerdOp: null },
});
const BLOBS = { 'sales/u-bea': { versie: 1, leads: [lead('b1', 'Peeters')], blokken: [], grafstenen: [] }, 'sales/u-carl': { versie: 1, leads: [lead('c1', 'Wouters'), lead('c2', 'Claes')], blokken: [], grafstenen: [] } };

test.describe('kop B: werkruimte-wissel van de beheerder', () => {
  test('een verkoper kiezen: de tabs worden Leads, Kalender, Route, Afgewerkt, Beheer; de knop wordt "Sales: Bea"; één melding', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs: BLOBS, werkruimte: 'techniek' });
    await expect(zichtbareTabs(page)).toHaveText(TECHNIEK_TABS.map(t => new RegExp('^' + t)));
    await expect(knop(page)).toContainText('Planning:');
    await expect(knop(page)).not.toHaveAttribute('data-werkruimte', 'sales');
    await kiesVerkoper(page, 'u-bea');
    await expect(zichtbareTabs(page)).toHaveText(SALES_TABS);
    for (const naam of ['Wachtrij', 'Ingepland', 'Inventaris', 'Rapporten']) await expect(tab(page, naam)).toHaveCount(0);
    await expect(knop(page)).toContainText('Sales:');
    await expect(knop(page)).toContainText('Bea');
    await expect(knop(page)).toHaveAttribute('data-werkruimte', 'sales');
    await expect(toast(page)).toHaveText('Je bekijkt nu de sales-planning van Bea Verkoper.');
    // van Wachtrij naar Leads, met de leads van Bea
    await expect(actieveTab(page)).toHaveText('Leads');
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('blitz_werkruimte'))).toBe('sales');
    expect(await page.evaluate(() => localStorage.getItem('blitz_sales_verkoper'))).toBe('u-bea');
    await expect(page.locator('#tab-sales')).toHaveCount(0);
  });

  test('de tab blijft het gelijkaardige scherm: Kalender blijft Kalender, Route blijft Route, Rapporten wordt Afgewerkt, Ingepland wordt Leads — en terug', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs: BLOBS, werkruimte: 'techniek', technieker: 'Tim' });
    const wissel = async (van, naar, verkoper) => {
      await tab(page, van).click();
      await kiesVerkoper(page, verkoper);
      await expect(actieveTab(page)).toHaveText(naar);
    };
    await wissel('Kalender', 'Kalender', 'u-bea');
    await expect(page.locator('#view-sales-kalender')).toBeVisible();
    await expect(page.locator('#view-kalender')).toBeHidden();
    // Sales -> Techniek via een technieker: Kalender blijft Kalender
    await knop(page).click();
    await page.locator('#person-menu .pm-item[data-soort="technieker"]', { hasText: 'Tim' }).click();
    await expect(actieveTab(page)).toHaveText('Kalender');
    await expect(page.locator('#view-kalender')).toBeVisible();
    await expect(zichtbareTabs(page)).toHaveText(TECHNIEK_TABS.map(t => new RegExp('^' + t)));
    // Rapporten -> Afgewerkt en terug Afgewerkt -> Rapporten
    await wissel('Rapporten', 'Afgewerkt', 'u-bea');
    await knop(page).click();
    await page.locator('#person-menu .pm-item[data-soort="alle"]').click();
    await expect(actieveTab(page)).toHaveText('Rapporten');
    await expect(knop(page)).toContainText('Alle');
    // Ingepland -> Leads
    await wissel('Ingepland', 'Leads', 'u-carl');
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(2);
    // Route -> Route (de route rekent bij openen: in de sales-werkruimte de eigen kaart)
    await tab(page, 'Route').click();
    await kiesVerkoper(page, 'u-bea');
    await expect(actieveTab(page)).toHaveText('Route');
    await expect(page.locator('#view-sales-route')).toBeVisible();
    await expect(page.locator('#view-planning')).toBeHidden();
  });

  test('het menu: "↩ Terug naar techniekers (Tim)" staat bovenaan zolang je een verkoper bekijkt, en brengt je terug naar Tim', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs: BLOBS, werkruimte: 'techniek', technieker: 'Tim' });
    await knop(page).click();
    await expect(page.locator('#person-menu .pm-terug')).toHaveCount(0); // in Techniek is er niets om naar terug te keren
    await page.locator('#person-menu .pm-item[data-sleutel="u-carl"]').click();
    await expect(zichtbareTabs(page)).toHaveText(SALES_TABS);
    await knop(page).click();
    const terug = page.locator('#person-menu .pm-terug');
    await expect(terug).toHaveText('↩ Terug naar techniekers (Tim)');
    await expect(page.locator('#person-menu > *').first()).toHaveClass(/pm-terug/);
    await terug.click();
    await expect(zichtbareTabs(page)).toHaveText(TECHNIEK_TABS.map(t => new RegExp('^' + t)));
    await expect(knop(page)).toContainText('Planning:');
    await expect(knop(page)).toContainText('Tim');
    await expect(toast(page)).toHaveText('Je bekijkt nu de planning van Tim.');
    expect(await page.evaluate(() => localStorage.getItem('blitz_werkruimte'))).toBe('techniek');
    expect(await page.evaluate(() => localStorage.getItem('blitz_active_person'))).toBe('Tim');
  });

  test('van verkoper wisselen in Sales verandert de tabs niet, enkel de leads', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs: BLOBS });
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(1); // Bea
    await kiesVerkoper(page, 'u-carl');
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(2);
    await expect(zichtbareTabs(page)).toHaveText(SALES_TABS);
    await expect(knop(page)).toContainText('Carl');
    await expect(toast(page)).not.toHaveText(/Je bekijkt nu de sales-planning/);
  });

  test('herladen houdt de werkruimte, de verkoper en de tab; Beheer blijft Beheer bij een wissel', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs: BLOBS });
    await kiesVerkoper(page, 'u-carl');
    await tab(page, 'Afgewerkt').click();
    await expect(page.locator('#view-sales-afgewerkt')).toBeVisible();
    await page.reload();
    await expect(zichtbareTabs(page)).toHaveText(SALES_TABS);
    await expect(actieveTab(page)).toHaveText('Afgewerkt');
    await expect(knop(page)).toContainText('Carl');
    // Beheer is er in beide werkruimtes en blijft staan bij een wissel
    await tab(page, 'Beheer').click();
    await kiesVerkoper(page, 'u-bea');
    await expect(actieveTab(page)).toHaveText('Beheer');
    await knop(page).click();
    await page.locator('#person-menu .pm-terug').click();
    await expect(actieveTab(page)).toHaveText('Beheer');
    await expect(zichtbareTabs(page)).toHaveText(TECHNIEK_TABS.map(t => new RegExp('^' + t)));
  });

  test('een oude bewaarde tab "sales" (de vroegere hoofdtab) of een tab van de andere werkruimte wordt omgezet; geen fout', async ({ page, consoleFouten }) => {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      sessionStorage.setItem('blitz_schermstaat', JSON.stringify({ tab: 'sales', scrollY: 0, viewScrollTop: 0, gridScrollTop: 0, t: Date.now() }));
      sessionStorage.setItem('blitz_sales_subtab', 'sales-afgewerkt');
    });
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs: BLOBS });
    await expect(actieveTab(page)).toHaveText('Leads'); // onbekende tab in de werkruimte Sales -> de eerste tab
    expect(await page.evaluate(() => sessionStorage.getItem('blitz_sales_subtab'))).toBeNull(); // de oude subtab-keuze is opgeruimd
    expect(consoleFouten).toEqual([]);
  });

  test('een bewaarde Sales-werkruimte zonder verkopers in de lijst: Leads met een duidelijke melding; kiezen van een technieker werkt nog', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, verkopers: [] });
    await expect(page.locator('#view-sales-lijst')).toContainText('Geen actieve verkopers gevonden.');
    await knop(page).click();
    await expect(page.locator('#person-menu .pm-terug')).toBeVisible();
    await page.locator('#person-menu .pm-item[data-soort="alle"]').click();
    await expect(zichtbareTabs(page)).toHaveText(TECHNIEK_TABS.map(t => new RegExp('^' + t)));
  });

  test('de gedeelde datum gaat mee: de week van de Kalender in Techniek is de week van de Kalender in Sales', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs: BLOBS, werkruimte: 'techniek' });
    await tab(page, 'Kalender').click();
    await page.locator('#view-kalender [data-actie="kal-nav"][data-arg="1"]').click();
    const datum = await page.evaluate(() => kern.toestand.get('gekozenDatum'));
    await kiesVerkoper(page, 'u-bea');
    await expect(actieveTab(page)).toHaveText('Kalender');
    await expect.poll(() => page.evaluate(() => import('/js/schermen/sales-data.js').then(m => m.gekozenDatum()))).toBe(datum);
  });

  test('gsm 375 px: de kiezer wisselt de werkruimte en de kop blijft binnen het scherm', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      await startSalesApp(page, { gebruiker: BEHEERDER, blobs: BLOBS, werkruimte: 'techniek' });
      await kiesVerkoper(page, 'u-bea');
      await expect(zichtbareTabs(page).filter({ hasText: 'Leads' })).toHaveCount(1);
      await expect(knop(page)).toHaveAttribute('data-werkruimte', 'sales');
      await expect(zichtbareTabs(page)).toHaveText(['Leads', 'Kalender', 'Afgewerkt', 'Beheer']); // op een gsm bestaat Route voor niemand (ook niet in Sales)
      const m = await page.evaluate(() => ({ pagina: document.documentElement.scrollWidth, scherm: window.innerWidth, rechts: Math.max(...[...document.querySelectorAll('header button')].map(b => b.getBoundingClientRect().right)) }));
      expect(m.pagina).toBeLessThanOrEqual(m.scherm);
      expect(m.rechts).toBeLessThanOrEqual(m.scherm);
    } finally { await context.close(); }
  });
});
