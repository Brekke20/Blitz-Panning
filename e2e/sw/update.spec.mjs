// Updatepad (etappe 7, N4): een bestaande bezoeker heeft de service worker van main (v25, bevroren kopie in e2e/fixtures/sw-v25-main.js).
// Na het uitrollen van de nieuwe SW neemt die het over, vult de nieuwe schil en de externe cache, ruimt oude caches op en werkt offline.
// (Na de CACHE_NAME-bump van etappe 9 leest deze test de nieuwe naam uit public/sw.js en de oude cache verdwijnt.)
import { test, expect, SHELL, CACHE_NAME, EXTERN_CACHE } from '../sw-hulp.mjs';

test('Update van de v25-SW van main naar de nieuwe SW: overname, nieuwe schil, externe cache, offline', async ({ page, sw }) => {
  // 1. Oude SW (main): enkel de oude schil in de cache, geen externe cache.
  sw.serveerOudeSw();
  await sw.start();
  const voor = await sw.cacheUrls();
  expect(Object.keys(voor)).toEqual(['blitz-planning-v25']);
  const hoofdVoor = voor['blitz-planning-v25'].map(u => new URL(u).pathname);
  expect(hoofdVoor).toContain('/js/outbox.js');
  expect(hoofdVoor, 'de oude SW kent /js/kern/netwerk.js nog niet').not.toContain('/js/kern/netwerk.js');
  await page.evaluate(() => { window.__controllerwissels = 0; navigator.serviceWorker.addEventListener('controllerchange', () => { window.__controllerwissels++; }); });

  // 2. Nieuwe SW wordt aangeboden; de pagina controleert op een update.
  sw.serveerNieuweSw();
  await sw.updateSw();
  await expect.poll(async () => Object.keys(await sw.cacheUrls()).sort(), { timeout: 20000 }).toEqual([CACHE_NAME, EXTERN_CACHE].sort());
  await expect.poll(() => page.evaluate(() => window.__controllerwissels), { timeout: 15000 }).toBeGreaterThanOrEqual(1);
  const na = await sw.cacheUrls();
  const hoofdNa = na[CACHE_NAME].map(u => new URL(u).pathname);
  for (const p of SHELL) expect(hoofdNa, p).toContain(p);
  expect(hoofdNa).toContain('/js/kern/netwerk.js');
  expect(na[EXTERN_CACHE].some(u => u.endsWith('/leaflet.min.js'))).toBe(true);

  // 3. De app werkt daarna offline (ook Leaflet, dat de oude SW nooit bewaarde).
  await sw.zetOffline(true);
  await page.reload();
  await expect(page.getByRole('tab')).toHaveCount(7); // de gecachte (beheerder-)sessie: zes tabs plus Beheer
  await expect(page.locator('#offline-banner')).toBeVisible();
  expect(await page.evaluate(() => typeof L)).toBe('object');
  await sw.zetOffline(false);
});
