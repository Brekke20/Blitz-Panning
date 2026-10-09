// Offline starten (etappe 7, N21): na één online bezoek start de app uit de cache van de service worker, ook zonder netwerk,
// inclusief Leaflet uit de externe cache.
import { test, expect } from '../sw-hulp.mjs';

test('Offline: de app start uit de cache, Leaflet komt uit de externe cache', async ({ page, sw }) => {
  await sw.start();
  const voor = sw.swVerzoeken().length;
  await sw.zetOffline(true);
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(11); // de gecachte (beheerder-)sessie: zes tabs, Beheer en de vier sales-tabs
  await expect(page.locator('#cnt-tickets')).toBeAttached();
  await expect(page.locator('#offline-banner')).toBeVisible();
  // Leaflet (cdnjs) is er, zonder dat de SW de CDN opnieuw benaderde: cache-eerst uit blitz-extern.
  expect(await page.evaluate(() => typeof L)).toBe('object');
  const sindsOffline = sw.swVerzoeken().slice(voor).map(r => new URL(r.url).host);
  expect(sindsOffline.filter(h => h === 'cdnjs.cloudflare.com' || h === 'cdn.jsdelivr.net'), 'CDN-verzoeken van de SW terwijl offline').toEqual([]);
  // Ook een tweede herlading en een tabwissel werken offline.
  await page.reload();
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await expect(page.locator('#view-kalender')).toBeVisible();
  // Online terug: de offline-balk verdwijnt.
  await sw.zetOffline(false);
  await expect(page.locator('#offline-banner')).toBeHidden();
});
