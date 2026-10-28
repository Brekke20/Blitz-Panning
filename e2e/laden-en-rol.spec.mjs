import { test, expect, startApp } from './helpers.mjs';

const TABS = ['Wachtrij', 'Kalender', 'Route', 'Ingepland', 'Inventaris', 'Rapporten'];
const tab = (page, naam) => page.getByRole('tab', { name: naam });
const kaart = (page, nummer) => page.getByRole('button', { name: `Open ticket #${nummer}` });

test.describe('laden en rol', () => {
  test('coördinator ziet alle tabs', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    await expect(page.locator('html')).toHaveAttribute('data-rol', 'coordinator');
    for (const naam of TABS) await expect(tab(page, naam)).toBeVisible();
  });

  // UI/UX P1-5: de rol komt uit het ACCOUNT (loginRol), niet meer uit een toestelkeuze (blitz_rol). Technieker: geen Wachtrij of Route.
  test('technieker (account) ziet geen coördinator-tabs', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', technieker: 'Tim' });

    await expect(page.locator('html')).toHaveAttribute('data-rol', 'technieker');
    for (const naam of ['Wachtrij', 'Route']) await expect(tab(page, naam)).toBeHidden();
    for (const naam of ['Kalender', 'Ingepland', 'Rapporten']) await expect(tab(page, naam)).toBeVisible();

    await tab(page, 'Kalender').click();
    await expect(page.locator('#tab-planning')).toBeHidden();
    await expect(page.getByRole('button', { name: '⚡ Plan deze week' })).toHaveCount(0);
  });

  test('technieker kiezen filtert de wachtrij', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await expect(kaart(page, 1001)).toBeVisible();
    await expect(kaart(page, 1002)).toBeVisible();
    await expect(kaart(page, 1003)).toBeVisible();

    await page.locator('#person-btn').click();
    await page.locator('#person-menu').getByRole('button', { name: /Tim/ }).click();
    await expect(page.locator('#person-name-hdr')).toHaveText('Tim');
    await expect(kaart(page, 1001)).toBeVisible();
    await expect(kaart(page, 1002)).toBeVisible();
    await expect(kaart(page, 1003)).toHaveCount(0);

    await page.locator('#person-btn').click();
    await page.locator('#person-menu').getByRole('button', { name: /Alle technici/ }).click();
    await expect(page.locator('#person-name-hdr')).toHaveText('Alle');
    await expect(kaart(page, 1003)).toBeVisible();
  });

  test.describe('tablet', () => {
    // isMobile: een echte tabletemulatie (het scherm zelf staat rechtop, screen.orientation = portrait); apparaat.js leest de oriëntatie van het scherm.
    test.use({ hasTouch: true, isMobile: true });

    // UI/UX P1-5: de eenmalige tablet-rolvraag bestaat niet meer; het account bepaalt de weergave (een beheerder is coördinator).
    test('tablet vraagt de rol niet meer: een beheerder blijft coördinator, ook zonder bewaarde toestelrol', async ({ page }) => {
      await startApp(page, { rol: null, viewport: { width: 820, height: 1180 } });
      await expect(page.getByRole('alertdialog', { name: 'Wie gebruikt deze tablet?' })).toHaveCount(0);
      await expect(page.locator('html')).toHaveAttribute('data-rol', 'coordinator');
      expect(await page.evaluate(() => localStorage.getItem('blitz_rol'))).toBeNull();
      // Taak 17 (Brent, 2026-10-28): een staande tablet is een gsm in de hele app (apparaat.js): Route bestaat er niet, wel het dok met "Meer".
      await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'gsm');
      await expect(tab(page, 'Wachtrij')).toBeVisible();
      await expect(tab(page, 'Route')).toBeHidden();
      // Open dag (v2.5.0): een staande tablet heeft het dok met "Meer": na de vierde tab staat Rapporten in het blad.
      await expect(page.locator('#tab-rapporten')).toHaveClass(/tab--in-meer/);
    });
  });
});
