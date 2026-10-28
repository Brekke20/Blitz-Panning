import { test, expect, startApp, kiesHoofdtab } from './helpers.mjs';

// Inventaris, technieker-weergave: de voorraad staat in een raster (naam en aantal dicht bij elkaar, meerdere kolommen op een breed
// scherm) en de knop "Historiek" toont de log van enkel de gekozen persoon, met het ticketnummer bij een verbruik na een rapport.

const LOG = [
  { id: 'l1', datum: '2026-10-02T07:30:00.000Z', technieker: 'Tim', type: 'aanvulling', materiaalId: 'x1', materiaalNaam: 'Contactor 25A', aantal: 3, status: 'nieuw' },
  { id: 'l2', datum: '2026-10-05T06:00:00.000Z', technieker: 'Tim', type: 'verbruik', materiaalId: 'x2', materiaalNaam: 'Kabel', aantal: -2, status: null, ticketNummer: '3979' },
  { id: 'l3', datum: '2026-10-05T06:30:00.000Z', technieker: 'Roel', type: 'verbruik', materiaalId: 'x2', materiaalNaam: 'Antenne', aantal: -1, status: null },
];
const inventaris = () => ({ status: 200, json: { versie: 3, wagenvoorraad: {}, log: LOG } });

async function openInventaris(page, opties = {}) {
  await startApp(page, { technieker: 'Tim', overschrijf: { inventaris }, ...opties });
  await kiesHoofdtab(page, /Inventaris/); // Open dag: in een smal venster staat Inventaris in "Meer"
  await expect(page.locator('#inv-edit-btn')).toBeVisible();
}

test('raster: op een breed scherm meerdere kolommen, aantal vlak naast de naam', async ({ page }) => {
  await openInventaris(page, { viewport: { width: 1600, height: 900 } });
  const rijen = page.locator('.inv-raster .inv-row');
  await expect(rijen.first()).toBeVisible();
  const kolommen = await page.locator('.inv-raster').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(kolommen).toBeGreaterThanOrEqual(4);
  const breedte = await rijen.first().evaluate(el => el.getBoundingClientRect().width);
  expect(breedte).toBeLessThan(450);
});

test('raster op gsm-breedte: één kolom, geen horizontale scroll', async ({ page }) => {
  await openInventaris(page, { viewport: { width: 375, height: 800 } });
  const kolommen = await page.locator('.inv-raster').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(kolommen).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('per soort gegroepeerd zoals Prijzen, binnen een soort alfabetisch; zoeken verbergt lege soorten', async ({ page }) => {
  await openInventaris(page);
  await expect(page.locator('.inv-groep-titel')).toHaveText(['Controllers', 'Energiemeters', 'CT-klemmen', 'Overige componenten', 'Laadkabels & aansluitingen']);
  const controllers = page.getByRole('region', { name: 'Controllers' }).locator('.inv-row-naam');
  await expect(controllers.first()).toHaveText('Controller - CHARX 1000');
  const namen = await controllers.allTextContents();
  expect(namen).toEqual([...namen].sort((a, b) => a.localeCompare(b)));
  await page.locator('#inv-zoek').fill('ct-klem');
  await expect(page.locator('.inv-groep:not([hidden]) .inv-groep-titel')).toHaveText(['CT-klemmen']);
  await page.locator('#inv-zoek').fill('bestaatniet');
  await expect(page.locator('.inv-groep:not([hidden])')).toHaveCount(0);
  await expect(page.locator('.inv-zoek-leeg')).toHaveText("Geen onderdelen gevonden voor 'bestaatniet'");
});

test('Historiek: enkel de log van deze persoon, met ticketnummer; nogmaals klikken toont de voorraad weer', async ({ page }) => {
  await openInventaris(page);
  const knop = page.locator('#inv-hist-btn');
  await expect(knop).toHaveAttribute('aria-pressed', 'false');
  await knop.click();
  await expect(page.locator('#inv-hist-btn')).toHaveAttribute('aria-pressed', 'true');
  const regels = page.locator('#inventaris-body .inv-log-row');
  await expect(regels).toHaveCount(2); // Roel's regel niet
  await expect(regels.nth(0)).toContainText('Kabel');
  await expect(regels.nth(0)).toContainText('#3979');
  await expect(regels.nth(0)).toContainText('-2');
  await expect(regels.nth(1)).toContainText('Contactor 25A');
  await expect(regels.nth(1)).toContainText('nog niet verwerkt');
  await expect(page.locator('#inventaris-body .inv-log-verwerkt-btn')).toHaveCount(0); // alleen lezen
  await expect(page.locator('#inventaris-body .inv-log-technieker')).toHaveCount(0);
  await expect(page.locator('#inv-zoek')).toHaveCount(0);

  await page.locator('#inv-hist-btn').click();
  await expect(page.locator('#inv-zoek')).toBeVisible();
  await expect(page.locator('#inventaris-body .inv-log-row')).toHaveCount(0);
});

test('Bewerken vanuit de historiek gaat naar de bewerkmodus van de voorraad', async ({ page }) => {
  await openInventaris(page);
  await page.locator('#inv-hist-btn').click();
  await page.locator('#inv-edit-btn').click();
  await expect(page.locator('.inv-raster--bewerk .inv-cat-row').first()).toBeVisible();
  await page.locator('#inv-cancel-btn').click();
  await expect(page.locator('#inv-hist-btn')).toHaveAttribute('aria-pressed', 'false');
});

test('supervisor-weergave (Iedereen) toont het ticketnummer bij een verbruik', async ({ page }) => {
  await startApp(page, { overschrijf: { inventaris } });
  await kiesHoofdtab(page, /Inventaris/); // Open dag: in een smal venster staat Inventaris in "Meer"
  const kabel = page.locator('#inventaris-body .inv-log-row', { hasText: 'Kabel' });
  await expect(kabel).toContainText('#3979');
  await expect(kabel).toContainText('Tim');
  await expect(page.locator('#inventaris-body .inv-log-verwerkt-btn')).toHaveCount(1);
});
