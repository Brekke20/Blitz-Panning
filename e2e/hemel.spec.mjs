import { test, expect, startApp } from './helpers.mjs';

// Open dag-stijl, taak 2: de hemel (#hemel, html[data-hemel]) volgt het uur van Brussel. Testklok: maandag 5 okt 2026, 09:00 (ochtend).
const html = (page) => page.locator('html');

test.describe('hemel', () => {
  test('hemel volgt het uur', async ({ page }) => {
    await startApp(page);
    await expect(html(page)).toHaveAttribute('data-hemel', 'ochtend');
    await expect(page.locator('#hemel')).toHaveCount(1);
    await expect(page.locator('#hemel')).toHaveCSS('position', 'fixed');
    await expect(page.locator('#hemel')).toHaveCSS('pointer-events', 'none');
    await page.clock.fastForward('01:01:00'); // 10:01
    await expect(html(page)).toHaveAttribute('data-hemel', 'middag');
    await page.clock.fastForward('07:00:00'); // 17:01
    await expect(html(page)).toHaveAttribute('data-hemel', 'avond');
    await page.clock.fastForward('04:00:00'); // 21:01
    await expect(html(page)).toHaveAttribute('data-hemel', 'nacht');
  });

  test('de body laat de hemel zien (geen effen achtergrond ervoor)', async ({ page }) => {
    await startApp(page);
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('hemel klopt meteen na terugkeer (Review Focus 5)', async ({ page }) => {
    await startApp(page);
    await expect(html(page)).toHaveAttribute('data-hemel', 'ochtend');
    await page.clock.fastForward('01:01:00'); // 10:01
    await expect(html(page)).toHaveAttribute('data-hemel', 'middag');
    // de pagina is verborgen: de minuutklok slaat over
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { value: true, configurable: true }));
    await page.clock.fastForward('07:00:00'); // 17:01
    await page.clock.runFor(60000); // de minuut loopt, maar verborgen
    await expect(html(page)).toHaveAttribute('data-hemel', 'middag');
    // terug op de pagina: meteen juist, zonder op de minuut te wachten
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(html(page)).toHaveAttribute('data-hemel', 'avond');
  });

  test('thema met achtergrond vervangt de hemel', async ({ page }) => {
    await startApp(page, { query: '?test&versiering=aan' }); // de standaardstub is het Halloween-pakket (met achtergrond)
    await expect(html(page)).toHaveAttribute('data-event-achtergrond', 'ja');
    await expect(page.locator('#event-achtergrond')).toHaveCount(1);
    await expect(page.locator('#hemel')).toHaveCSS('display', 'none');
  });

  test('zonder thema is de hemel zichtbaar', async ({ page }) => {
    await startApp(page);
    await expect(html(page)).not.toHaveAttribute('data-event-achtergrond', 'ja');
    await expect(page.locator('#hemel')).not.toHaveCSS('display', 'none');
  });

  test('print toont geen hemel', async ({ page }) => {
    await startApp(page);
    await expect(page.locator('#hemel')).not.toHaveCSS('display', 'none');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#hemel')).toHaveCSS('display', 'none');
    await expect(page.locator('#hemel')).toBeHidden();
  });

  test('de hemel verschilt per thema (donker en licht) en per dagdeel', async ({ page }) => {
    await startApp(page);
    const beeld = () => page.locator('#hemel').evaluate((el) => getComputedStyle(el).backgroundImage);
    await expect(html(page)).toHaveAttribute('data-hemel', 'ochtend');
    const donkerOchtend = await beeld();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const lichtOchtend = await beeld();
    expect(lichtOchtend).not.toBe(donkerOchtend);
    await page.clock.fastForward('01:01:00');
    expect(await beeld()).not.toBe(lichtOchtend);
  });
});
