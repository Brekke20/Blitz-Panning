import { test, expect, startApp } from './helpers.mjs';
import { startSalesApp, BEHEERDER } from './sales-hulp.mjs';

// Open dag, taak 6: heeft het dok (gsm, staande tablet) meer dan 5 zichtbare tabbladen, dan toont het de eerste 4 en een knop "Meer"
// (.dok-meer, geen .tab, buiten .tabs-inner) die een glazen blad opent met de rest. De echte .tab-knoppen blijven in .tabs-inner staan;
// het blad klikt ze door. Op `breed` verandert er niets.

const GSM = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const PC = { width: 1366, height: 768 };

const zetWeergave = (page, weergave) => page.addInitScript((w) => {
  if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
  localStorage.setItem('blitz_weergave', w);
}, weergave);

const dokTabs = (page) => page.locator('.tabs-inner .tab:visible').evaluateAll(els => els.map(e => e.id));
const meer = (page) => page.locator('.dok-meer');
const blad = (page) => page.locator('.dok-meer-overlay');
const bladKnoppen = (page) => page.locator('.dok-meer-blad button').evaluateAll(els => els.map(e => e.textContent.trim()));

const TIM = { zohoNaam: 'Tim', magZelfPlannen: true };

test.describe('"Meer" in het dok', () => {
  test('planner ziet 4 tabbladen en Meer', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { loginRol: 'planner', viewport: GSM });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
    await expect(meer(page)).toBeVisible();
    expect(await dokTabs(page)).toEqual(['tab-tickets', 'tab-kalender', 'tab-gepland', 'tab-inventaris']);
    // Meer is geen tab (de app-schil telt .tab.active en loopt met de pijltjestoetsen over .tab) en staat buiten de tablist
    await expect(meer(page)).not.toHaveClass(/\btab\b/);
    await expect(page.locator('.tabs-inner .dok-meer')).toHaveCount(0);
    await expect(meer(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(blad(page)).not.toHaveClass(/open/);

    await meer(page).click();
    await expect(blad(page)).toHaveClass(/open/);
    await expect(meer(page)).toHaveAttribute('aria-expanded', 'true');
    expect(await bladKnoppen(page)).toEqual(['Rapporten', 'Beheer']);
    // het blad ligt boven het dok: een klik op een knop in het blad komt aan (geen bedekking door het dok)
    await page.getByRole('dialog', { name: 'Meer tabbladen' }).getByRole('button', { name: 'Beheer' }).click();
    await expect(page.locator('#tab-beheer')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.tab.active')).toHaveCount(1);
    await expect(meer(page)).toHaveClass(/\bactief\b/);
    await expect(blad(page)).not.toHaveClass(/open/);
    await expect(meer(page)).toHaveAttribute('aria-expanded', 'false');

    // een tab in het dok maakt Meer weer inactief
    await page.locator('#tab-kalender').click();
    await expect(meer(page)).not.toHaveClass(/\bactief\b/);
    // geen horizontaal scrollen van het dok of de pagina
    const scroll = await page.evaluate(() => { const b = document.querySelector('.tabs-inner'); return { dok: b.scrollWidth - b.clientWidth, pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth }; });
    expect(scroll.dok).toBeLessThanOrEqual(0);
    expect(scroll.pagina).toBeLessThanOrEqual(0);
  });

  test('Escape sluit het blad, en de focus keert terug naar Meer', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { loginRol: 'planner', viewport: GSM });
    await meer(page).click();
    await expect(blad(page)).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(blad(page)).not.toHaveClass(/open/);
    await expect(meer(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(meer(page)).toBeFocused();
  });

  test('een tik naast het blad (achtergrond) sluit het blad zonder tab te wisselen', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { loginRol: 'planner', viewport: GSM });
    await meer(page).click();
    await expect(blad(page)).toHaveClass(/open/);
    await blad(page).click({ position: { x: 10, y: 10 } });
    await expect(blad(page)).not.toHaveClass(/open/);
    await expect(page.locator('#tab-tickets')).toHaveAttribute('aria-selected', 'true');
  });

  test('staande tablet: ook daar 4 tabbladen en Meer', async ({ page }) => {
    await zetWeergave(page, 'tablet');
    await startApp(page, { loginRol: 'planner', viewport: TABLET });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'tablet-staand');
    await expect(meer(page)).toBeVisible();
    // op een staande tablet is Route (alleen-groot) wel zichtbaar: 7 tabs, 4 in het dok
    const ids = await dokTabs(page);
    expect(ids.length).toBe(4);
    await meer(page).click();
    expect((await bladKnoppen(page)).length).toBe(3);
  });

  test('technieker: geen Meer', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { loginRol: 'technieker', loginGebruiker: { zohoNaam: 'Tim' }, technieker: 'Tim', viewport: GSM });
    expect(await dokTabs(page)).toEqual(['tab-kalender', 'tab-gepland', 'tab-inventaris', 'tab-rapporten']);
    await expect(meer(page)).toBeHidden();
    await expect(page.locator('.tab--in-meer')).toHaveCount(0);
  });

  test('technieker met Mag zelf plannen: 5 tabbladen, geen Meer', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim', viewport: GSM });
    expect(await dokTabs(page)).toEqual(['tab-tickets', 'tab-kalender', 'tab-gepland', 'tab-inventaris', 'tab-rapporten']);
    await expect(meer(page)).toBeHidden();
  });

  test('pc: niets verandert (zijkolom met alle tabs, geen Meer)', async ({ page }) => {
    await startApp(page, { loginRol: 'planner', viewport: PC });
    expect((await dokTabs(page)).length).toBe(7);
    await expect(meer(page)).toBeHidden();
    await expect(page.locator('.tab--in-meer')).toHaveCount(0);
  });

  test('wisselen van weergave zonder herladen: pc -> gsm toont Meer, gsm -> pc haalt het weg', async ({ page }) => {
    await startApp(page, { loginRol: 'planner', viewport: PC });
    await expect(meer(page)).toBeHidden();
    await page.setViewportSize(GSM);
    await page.evaluate(() => window.zetWeergave('gsm'));
    await expect(meer(page)).toBeVisible();
    expect(await dokTabs(page)).toEqual(['tab-tickets', 'tab-kalender', 'tab-gepland', 'tab-inventaris']);
    await page.setViewportSize(PC);
    await page.evaluate(() => window.zetWeergave('computer'));
    await expect(meer(page)).toBeHidden();
    await expect(page.locator('.tab--in-meer')).toHaveCount(0);
    expect((await dokTabs(page)).length).toBe(7);
  });

  test('beheerder wisselt van werkruimte (Review Focus 1)', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startSalesApp(page, { gebruiker: BEHEERDER, werkruimte: 'sales', viewport: GSM });
    // Sales-werkruimte: Leads, Kalender, Afgewerkt, Beheer (Route is alleen-groot): 4 tabs, geen Meer
    expect(await dokTabs(page)).toEqual(['tab-sales-lijst', 'tab-sales-kalender', 'tab-sales-afgewerkt', 'tab-beheer']);
    await expect(meer(page)).toBeHidden();
    // terug naar Techniek: de volgorde van Techniek, dus Meer met Rapporten en Beheer
    await page.locator('#person-btn').click();
    await page.locator('#person-menu .pm-item[data-soort="technieker"]', { hasText: 'Tim' }).click();
    await expect(meer(page)).toBeVisible();
    expect(await dokTabs(page)).toEqual(['tab-tickets', 'tab-kalender', 'tab-gepland', 'tab-inventaris']);
    await meer(page).click();
    expect(await bladKnoppen(page)).toEqual(['Rapporten', 'Beheer']);
    await page.keyboard.press('Escape');
    // en weer naar Sales: Meer verdwijnt
    await page.locator('#person-btn').click();
    await page.locator('#person-menu .pm-item[data-soort="verkoper"]').first().click();
    await expect(meer(page)).toBeHidden();
    expect(await dokTabs(page)).toEqual(['tab-sales-lijst', 'tab-sales-kalender', 'tab-sales-afgewerkt', 'tab-beheer']);
  });
});
