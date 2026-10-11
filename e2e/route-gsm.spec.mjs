import { test, expect, startApp } from './helpers.mjs';
import { startSalesApp } from './sales-hulp.mjs';

// Kop B, taak 4: Route bestaat alleen op een tablet en een computer. Op een gsm (data-indeling="smal", apparaat.js) is er voor NIEMAND een
// Route-tab: niet voor de planner/beheerder, de technieker met "Mag zelf plannen" of de verkoper. Draait iemand op Route naar een gsm-indeling,
// dan gaat hij naar Kalender. Klok: maandag 5 okt 2026 09:00.
const GSM = { width: 375, height: 812 };
const TABLET = { width: 800, height: 1280 };
const TIM = { zohoNaam: 'Tim', magZelfPlannen: true };
const weergave = (page, w) => page.addInitScript((x) => { if (window === window.top) localStorage.setItem('blitz_weergave', x); }, w);
const tab = (page, naam) => page.getByRole('tab', { name: new RegExp('^' + naam) });
const zichtbareTabs = (page) => page.locator('.tabs-inner .tab:visible');
const namen = async (page) => (await zichtbareTabs(page).allTextContents()).map((t) => t.replace(/\s*\d+$/, '').trim());
const actief = (page) => page.locator('.tabs-inner .tab.active');

test.describe('Route alleen op tablet en computer: geen Route-tab op een gsm', () => {
  test('gsm 375 px: de planner (beheerder) heeft geen Route-tab', async ({ page }) => {
    await weergave(page, 'gsm');
    await startApp(page, { viewport: GSM });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
    await expect(tab(page, 'Route')).toBeHidden();
    expect(await namen(page)).not.toContain('Route');
    expect(await namen(page)).toEqual(expect.arrayContaining(['Wachtrij', 'Kalender', 'Ingepland']));
  });

  test('gsm 375 px: de technieker met "Mag zelf plannen" heeft Wachtrij maar geen Route; ook geen "Route bekijken" in de Kalender', async ({ page }) => {
    await weergave(page, 'gsm');
    await startApp(page, { viewport: GSM, loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    expect(await namen(page)).toEqual(['Wachtrij', 'Kalender', 'Ingepland', 'Inventaris', 'Rapporten']);
    await tab(page, 'Kalender').click();
    await expect(page.locator('.day-col')).not.toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Route bekijken' })).toHaveCount(0);
  });

  test('gsm 375 px: de verkoper heeft Leads, Kalender en Afgewerkt, zonder Route', async ({ page }) => {
    await weergave(page, 'gsm');
    await startSalesApp(page, { viewport: GSM });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
    expect(await namen(page)).toEqual(['Leads', 'Kalender', 'Afgewerkt']);
  });

  test('tablet 800 px rechtop: Route is er wel (planner, technieker met vinkje en verkoper)', async ({ page, browser }) => {
    await weergave(page, 'tablet');
    await startApp(page, { viewport: TABLET });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'tablet-staand');
    await expect(tab(page, 'Route')).toBeVisible();

    const tweede = await browser.newContext({ viewport: TABLET, locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
    const p2 = await tweede.newPage();
    await weergave(p2, 'tablet');
    await startApp(p2, { viewport: TABLET, loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    await expect(tab(p2, 'Route')).toBeVisible();
    await tweede.close();

    const derde = await browser.newContext({ viewport: TABLET, locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
    const p3 = await derde.newPage();
    await weergave(p3, 'tablet');
    await startSalesApp(p3, { viewport: TABLET });
    await expect(p3.getByRole('tab', { name: 'Route', exact: true })).toBeVisible();
    await derde.close();
  });

  test('de planner op Route die naar een gsm-indeling draait, komt op Kalender; terug naar een tablet brengt Route terug', async ({ page }) => {
    await weergave(page, 'tablet');
    await startApp(page, { viewport: { width: 1280, height: 800 } });
    await tab(page, 'Route').click();
    await expect(actief(page)).toHaveText('Route');
    await page.evaluate(() => window.zetWeergave('gsm'));
    await expect(actief(page)).toHaveText('Kalender');
    await expect(page.locator('#view-kalender')).toHaveClass(/active/);
    await expect(tab(page, 'Route')).toBeHidden();
    await page.evaluate(() => window.zetWeergave('tablet'));
    await expect(tab(page, 'Route')).toBeVisible();
  });

  test('de technieker met vinkje op Route die naar een gsm-indeling draait, komt op Kalender', async ({ page }) => {
    await weergave(page, 'tablet');
    await startApp(page, { viewport: { width: 1280, height: 800 }, loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    await tab(page, 'Route').click();
    await expect(actief(page)).toHaveText('Route');
    await page.evaluate(() => window.zetWeergave('gsm'));
    await expect(actief(page)).toHaveText('Kalender');
    await expect(tab(page, 'Route')).toBeHidden();
  });

  test('de verkoper op Route die naar een gsm-indeling draait, komt op Kalender', async ({ page }) => {
    await weergave(page, 'tablet');
    await startSalesApp(page, { viewport: { width: 1280, height: 800 } });
    await page.getByRole('tab', { name: 'Route', exact: true }).click();
    await expect(page.locator('#view-sales-route')).toHaveClass(/active/);
    await page.evaluate(() => window.zetWeergave('gsm'));
    await expect(actief(page)).toHaveText('Kalender');
    await expect(page.locator('#view-sales-kalender')).toHaveClass(/active/);
    await expect(page.getByRole('tab', { name: 'Route', exact: true })).toBeHidden();
  });
});
