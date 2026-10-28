import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// Taak 17 (wijziging van Brent, 2026-10-28): een tablet rechtop is in de HELE app een gsm; liggend blijft hij een tablet (zoals op de computer).
// apparaat.js: een automatisch herkend toestel met een grove pointer, kortste schermzijde vanaf 600 en staand krijgt soort 'gsm' en indeling 'smal'
// (dok met "Meer", gsm-kalender, gsm-glas, geen voorraadbel). Een handmatige keuze (blitz_weergave) gaat voor. Echte tabletemulatie: isMobile + aanraking.
// Klok: vrijdag 9 okt 2026, 10:30.
const VRIJDAG = '2026-10-09T10:30:00+02:00';
const STAAND = { width: 768, height: 1024 };
const LIGGEND = { width: 1024, height: 768 };

const attr = (page) => page.evaluate(() => {
  const d = document.documentElement.dataset;
  return { apparaat: d.apparaat, indeling: d.indeling, nav: d.nav, orientatie: d.orientatie, aanraak: d.aanraak };
});
const start = async (page, viewport, weergave = null) => {
  if (weergave) await page.addInitScript((w) => { if (window === window.top) localStorage.setItem('blitz_weergave', w); }, weergave);
  await startApp(page, { viewport, nu: VRIJDAG, wachtOpApp: false, overschrijf: seed() });
  await expect(page.locator('html')).toHaveAttribute('data-nav', /kolom|dok/);
};

test.describe('tablet met aanraking (768x1024 en 1024x768, isMobile)', () => {
  test.use({ viewport: STAAND, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('rechtop: gsm in de hele app (apparaat, indeling smal, dok met Meer, gsm-kalender met de sprong naar nu)', async ({ page }) => {
    await start(page, STAAND);
    expect(await attr(page)).toEqual({ apparaat: 'gsm', indeling: 'smal', nav: 'dok', orientatie: 'staand', aanraak: 'ja' });
    await expect(page.locator('.tabs')).toBeVisible();
    await expect(page.locator('.dok-meer')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Route' })).toBeHidden(); // Route bestaat niet op een gsm
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#week-grid')).not.toHaveClass(/tl-mode/);
    await expect(page.locator('.tl-wrap')).toHaveCount(0);
    await expect(page.locator('.day-col[data-date]')).toHaveCount(5);
    const marker = page.locator('.day-col[data-date="2026-10-09"] .kal-nu-marker');
    await expect(marker).toHaveText(/^nu 10:3\d$/);
    await expect.poll(() => marker.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })).toBe(true);
  });

  test('liggend: tablet zoals voorheen (indeling breed, zijkolom, tijdlijn)', async ({ page }) => {
    await start(page, LIGGEND);
    expect(await attr(page)).toEqual({ apparaat: 'tablet', indeling: 'breed', nav: 'kolom', orientatie: 'liggend', aanraak: 'ja' });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('#week-grid')).toHaveClass(/tl-mode/);
    await expect(page.locator('.tl-wrap')).toHaveCount(5);
    await expect(page.getByRole('tab', { name: 'Route' })).toBeVisible();
  });

  test('draaien schakelt alles live om, zonder herladen: rechtop naar liggend en terug', async ({ page }) => {
    await start(page, STAAND);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(page.locator('.kal-nu-marker')).toHaveCount(1);
    await page.evaluate(() => { window.__zonderHerlaad = true; });

    await page.setViewportSize(LIGGEND);
    await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'tablet');
    expect(await attr(page)).toMatchObject({ indeling: 'breed', nav: 'kolom', orientatie: 'liggend' });
    await expect(page.locator('#week-grid')).toHaveClass(/tl-mode/);
    await expect(page.locator('.tl-wrap')).toHaveCount(5);
    await expect(page.locator('.kal-nu-marker')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Route' })).toBeVisible();

    await page.setViewportSize(STAAND);
    await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'gsm');
    expect(await attr(page)).toMatchObject({ indeling: 'smal', nav: 'dok', orientatie: 'staand' });
    await expect(page.locator('#week-grid')).not.toHaveClass(/tl-mode/);
    await expect(page.locator('.kal-nu-marker')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: 'Route' })).toBeHidden();
    expect(await page.evaluate(() => window.__zonderHerlaad)).toBe(true);
  });

  test('een handmatig gekozen weergave gaat voor: "tablet" blijft tablet, ook rechtop', async ({ page }) => {
    await start(page, STAAND, 'tablet');
    expect(await attr(page)).toMatchObject({ apparaat: 'tablet', indeling: 'tablet-staand' });
  });
});

test.describe('geen aanraking: een computervenster blijft een computer', () => {
  test('een rechtop venster van 768x1024 met muis is geen gsm', async ({ page }) => {
    await start(page, STAAND);
    expect(await attr(page)).toMatchObject({ apparaat: 'computer', indeling: 'breed', aanraak: 'nee' });
  });
});
