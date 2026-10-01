import { test, expect, startApp } from './helpers.mjs';

test.describe('kern: ui-delegatie', () => {
  test('vernieuwen-knop toont testmodus-toast', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    // Klik op de vernieuwen-knop
    await page.locator('button[data-actie="vernieuw"]').click();

    // Controleer dat er een toast verschijnt met "Testmodus"
    const toast = page.locator('#toast');
    await expect(toast).toHaveClass(/show/);
    await expect(toast).toContainText('Testmodus actief');

    // Controleer dat ticketteller nog steeds 3 is
    await expect(page.locator('#cnt-tickets')).toContainText('3');
  });

  test('persoonmenu werkt via delegatie', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const personBtn = page.locator('#person-btn');
    const personMenu = page.locator('#person-menu');

    // Menu zou gesloten moeten zijn (geen class "open")
    let classes = await personMenu.getAttribute('class');
    expect(classes).not.toContain('open');

    // Klik op persoon-menu button
    await personBtn.click();
    classes = await personMenu.getAttribute('class');
    expect(classes).toContain('open');

    // Klik op persoon-menu button om te sluiten
    await personBtn.click();
    classes = await personMenu.getAttribute('class');
    expect(classes).not.toContain('open');
  });

  test('instellingen opent instellingenvenster', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    // Klik op instellingen-knop
    await page.locator('button[data-actie="instellingen"]').click();

    // Controleer dat het instellingenvenster opent
    const instellingenDlg = page.getByRole('dialog', { name: /Instellingen|Voorkeuren/ });
    await expect(instellingenDlg).toBeVisible();
  });

  test('thema-wissel werkt', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const html = page.locator('html');
    const originalTheme = await html.getAttribute('data-theme');

    // Klik op thema-wissel knop
    await page.locator('button[data-actie="thema"]').click();

    // Theme moet veranderd zijn
    const newTheme = await html.getAttribute('data-theme');
    expect(newTheme).not.toBe(originalTheme);

    // Klik nog een keer om terug te switchen
    await page.locator('button[data-actie="thema"]').click();

    const restoredTheme = await html.getAttribute('data-theme');
    expect(restoredTheme).toBe(originalTheme);
  });
});
