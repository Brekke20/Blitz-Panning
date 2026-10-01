import { test, expect, startApp } from './helpers.mjs';

test('app laadt als coördinator zonder consolefouten', async ({ page, verzoeken }) => {
  await startApp(page);

  await expect(page.locator('#cnt-tickets')).toHaveText('3');
  // De TEST-badge staat in de DOM, maar is in de huidige app onzichtbaar: index.html:915 zet
  // style.display = '' terwijl app.css:1085 display:none heeft. Vastgelegd als bevinding; de
  // testmodus zelf blijkt uit de dummy-wachtrij (3 tickets).
  await expect(page.locator('#test-badge')).toHaveText('TEST');
  // De knop staat in de kalenderweergave, niet in de standaard geopende wachtrij.
  await expect(page.getByRole('button', { name: '⚡ Plan deze week' })).toBeHidden();
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await expect(page.getByRole('button', { name: '⚡ Plan deze week' })).toBeVisible();
  await expect(page.locator('#tab-planning')).toBeVisible();
  expect(verzoeken.onverwacht).toEqual([]);
});
