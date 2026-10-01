import { test, expect, startApp } from './helpers.mjs';

test.describe('ticketdetail', () => {
  test('ticket openen toont gegevens en sinds-datum', async ({ page, verzoeken }) => {
    await startApp(page);

    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    const venster = page.getByRole('dialog', { name: /Laadpaal offline na stroomuitval/ });
    await expect(venster).toBeVisible();
    await expect(venster.locator('#d-num')).toHaveText('#1001');
    await expect(venster).toContainText('Antwerpseweg 50, 2440 Geel');
    // In testmodus komt de waarde uit DUMMY_DATA (nu - 1 dag, met de vaste klok 5 okt -> 4 okt), niet uit
    // de stub: laadPlanningSinds() keert in TEST_MODE meteen terug (index.html:1231).
    await expect(venster.locator('#d-ticket .mrow', { hasText: 'In planning sinds' }).locator('.mval'))
      .toHaveText('4 okt');
    expect(verzoeken.van('/api/planning-sinds')).toEqual([]);
  });

  test('detailvenster sluit', async ({ page }) => {
    await startApp(page);
    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    const venster = page.getByRole('dialog', { name: /Laadpaal offline/ });
    await expect(venster).toBeVisible();

    await venster.getByRole('button', { name: 'Sluiten' }).click();
    await expect(venster).toBeHidden();
  });
});
