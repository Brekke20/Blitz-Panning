import { test, expect, startApp } from './helpers.mjs';

test.describe('kern: ui-delegatie', () => {
  test('vernieuwen-knop toont testmodus-toast na startup', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const toast = page.locator('#toast');
    // Wacht tot startup-toast verdwenen is
    await expect(toast).not.toHaveClass(/show/);

    // Klik vernieuwen
    await page.locator('button[data-actie="vernieuw"]').click();

    // Toast moet verschijnen met "Testmodus"
    await expect(toast).toHaveClass(/show/);
    await expect(toast).toContainText('Testmodus actief');

    // Ticker moet nog 3 zijn (Testmodus laadt niet echt)
    await expect(page.locator('#cnt-tickets')).toContainText('3');
  });

  test('persoonmenu opent en sluit via delegatie', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const personBtn = page.locator('#person-btn');
    const personMenu = page.locator('#person-menu');

    // Menu gesloten
    await expect(personMenu).not.toHaveClass(/open/);

    // Klik button → open
    await personBtn.click();
    await expect(personMenu).toHaveClass(/open/);

    // Klik button → dicht
    await personBtn.click();
    await expect(personMenu).not.toHaveClass(/open/);
  });

  test('persoonmenu sluit bij klik buiten', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const personBtn = page.locator('#person-btn');
    const personMenu = page.locator('#person-menu');

    // Open menu
    await personBtn.click();
    await expect(personMenu).toHaveClass(/open/);

    // Klik ergens neutraal (op de main content area)
    await page.locator('main').click();

    // Menu moet dicht zijn
    await expect(personMenu).not.toHaveClass(/open/);
  });

  test('instellingen opent instellingenvenster', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    // Klik op instellingen-knop
    await page.locator('button[data-actie="instellingen"]').click();

    // Controleer dat het instellingenvenster opent
    const instellingenDlg = page.getByRole('dialog', { name: /Instellingen|Voorkeuren/ });
    await expect(instellingenDlg).toBeVisible();
  });

  test('kalender-navigatie (‹/›/vandaag) via delegatie', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    // Zorg dat kalender tab zichtbaar is
    await page.getByRole('tab', { name: 'Kalender' }).click();

    const kalLabel = page.locator('#kal-label');
    // Wacht tot label zichtbaar is
    await expect(kalLabel).toBeVisible();
    const originalLabel = await kalLabel.textContent();

    // Klik volgende periode (wacht tot button zichtbaar is)
    await expect(page.getByRole('button', { name: 'Volgende periode' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Volgende periode' }).first().click();
    const nextLabel = await kalLabel.textContent();
    expect(nextLabel).not.toBe(originalLabel);

    // Klik vorige periode terug
    await page.getByRole('button', { name: 'Vorige periode' }).first().click();
    const restoredLabel = await kalLabel.textContent();
    expect(restoredLabel).toBe(originalLabel);
  });

  test('thema-wissel werkt', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const html = page.locator('html');
    const originalTheme = await html.getAttribute('data-theme');

    // Klik thema-wissel
    await page.locator('button[data-actie="thema"]').click();

    // Theme moet veranderd zijn
    const newTheme = await html.getAttribute('data-theme');
    expect(newTheme).not.toBe(originalTheme);

    // Klik nog een keer terug
    await page.locator('button[data-actie="thema"]').click();

    const restoredTheme = await html.getAttribute('data-theme');
    expect(restoredTheme).toBe(originalTheme);
  });
});
