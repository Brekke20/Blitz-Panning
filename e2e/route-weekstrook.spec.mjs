import { test, expect, startApp } from './helpers.mjs';
import { maakRouteMetStops, zetStartTijd } from './route-hulp.mjs';

// Karakterisering van de weekstrook van de Route-tab van de technieker (#week-strip), nadat de strook gedeeld werd met de route van de verkoper
// (schermen/week-strook.js). Uitgangspunt: Tim, "Plan deze week" zet #1001 en #1002 op maandag 5 okt (VASTE_NU), nog zonder tijdstip.
const strook = (page) => page.locator('#week-strip');
const dagen = (page) => strook(page).locator('.ws-dag');
const datum = (page) => page.getByTestId('route-datum');

async function naarRoute(page) {
  await zetStartTijd(page, '10:00');
  await startApp(page, { technieker: 'Tim' });
  await maakRouteMetStops(page);
}

test.describe('route: weekstrook van de technieker', () => {
  test('de werkdagen met aantal stops en status; de actieve dag en vandaag gemarkeerd; aria-labels', async ({ page }) => {
    await naarRoute(page);
    await expect(dagen(page).locator('.ws-naam')).toHaveText(['MA 5', 'DI 6', 'WO 7', 'DO 8', 'VR 9']);
    await expect(dagen(page).nth(0).locator('.ws-aantal')).toHaveText('2 stops');
    await expect(dagen(page).nth(1).locator('.ws-aantal')).toHaveText('0 stops');
    await expect(dagen(page).nth(1).locator('.ws-status')).toHaveText('—');
    await expect(dagen(page).nth(1)).toHaveClass(/leeg/);
    await expect(dagen(page).nth(0)).toHaveClass(/actief/);
    await expect(dagen(page).nth(0)).toHaveClass(/vandaag/);
    await expect(strook(page).locator('.ws-dag.actief')).toHaveCount(1);
    await expect(dagen(page).nth(0)).toHaveAttribute('aria-current', 'date');
    await expect(dagen(page).nth(1)).toHaveAttribute('aria-label', 'DI 6: 0 stops, niets gepland');
    // twee stops zonder tijdstip of met een tijdstip: de label noemt het ene of het andere
    await expect(dagen(page).nth(0)).toHaveAttribute('aria-label', /^MA 5: 2 stops, (2 zonder tijdstip|alle tijden klaar)$/);
    await expect(dagen(page).nth(0)).toHaveClass(/nodig|klaar/);
  });

  test('een dag aanklikken zet de datum van de route; ‹ en › springen een week', async ({ page }) => {
    await naarRoute(page);
    await dagen(page).nth(2).click();
    await expect(datum(page)).toHaveValue('2026-10-07');
    await expect(dagen(page).nth(2)).toHaveClass(/actief/);
    await expect(strook(page).locator('.ws-dag.actief')).toHaveCount(1);
    await strook(page).getByRole('button', { name: 'Volgende week' }).click();
    await expect(datum(page)).toHaveValue('2026-10-14');
    await expect(dagen(page).locator('.ws-naam')).toHaveText(['MA 12', 'DI 13', 'WO 14', 'DO 15', 'VR 16']);
    await strook(page).getByRole('button', { name: 'Vorige week' }).click();
    await expect(datum(page)).toHaveValue('2026-10-07');
  });

  test('pijltjestoetsen: volgende werkdag, week-omslag en de focus blijft op de strook', async ({ page }) => {
    await naarRoute(page);
    await dagen(page).nth(3).focus(); // do 8
    await page.keyboard.press('ArrowRight');
    await expect(datum(page)).toHaveValue('2026-10-09');
    await expect(dagen(page).nth(4)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(datum(page)).toHaveValue('2026-10-12');
    await expect(dagen(page).nth(0)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(datum(page)).toHaveValue('2026-10-09');
    await expect(dagen(page).nth(4)).toBeFocused();
  });

  test('enkel de werkdagen uit de instellingen (ma-wo)', async ({ page }) => {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      if (localStorage.getItem('blitz_settings_Tim') === null) localStorage.setItem('blitz_settings_Tim', JSON.stringify({ vanTijd: '10:00', werkdagen: [1, 2, 3] }));
    });
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    await expect(dagen(page).locator('.ws-naam')).toHaveText(['MA 5', 'DI 6', 'WO 7']);
  });

  test('één werkbalk: 📅, de weekstrook en de knoppen staan op één regel (computer), geen aparte kop meer', async ({ page }) => {
    await naarRoute(page);
    await expect(page.locator('.plan-header')).toHaveCount(0);
    const balk = await page.locator('#route-balk').boundingBox();
    const knop = await page.getByTestId('route-datum-knop').boundingBox();
    const stroken = await strook(page).boundingBox();
    const optimaliseer = await page.locator('#btn-optimize').boundingBox();
    expect(balk.height).toBeLessThanOrEqual(60);
    for (const doos of [knop, stroken, optimaliseer]) {
      expect(doos.y).toBeGreaterThanOrEqual(balk.y);
      expect(doos.y + doos.height).toBeLessThanOrEqual(balk.y + balk.height + 1);
    }
    expect(stroken.x).toBeGreaterThanOrEqual(knop.x + knop.width - 1);
    expect(optimaliseer.x).toBeGreaterThanOrEqual(stroken.x + stroken.width - 1);
    // De dagknop is 44 px hoog, met links dag en status en rechts het aantal.
    const dag = await dagen(page).first().boundingBox();
    expect(dag.height).toBe(44);
    const naam = await dagen(page).first().locator('.ws-naam').boundingBox();
    const aantal = await dagen(page).first().locator('.ws-aantal').boundingBox();
    expect(aantal.x).toBeGreaterThan(naam.x + naam.width);
  });

  test('📅 opent de datumkiezer (showPicker) en een gekozen datum zet de route op die dag', async ({ page }) => {
    await naarRoute(page);
    await page.evaluate(() => { window.__picker = 0; HTMLInputElement.prototype.showPicker = function () { window.__picker++; }; });
    await page.getByTestId('route-datum-knop').click();
    expect(await page.evaluate(() => window.__picker)).toBe(1);
    await datum(page).fill('2026-10-08');
    await expect(dagen(page).nth(3)).toHaveClass(/actief/);
    await expect(page.getByTestId('route-aantal-stops')).toHaveText('0');
  });

  test('zonder showPicker valt 📅 terug op het veld zelf (focus en klik)', async ({ page }) => {
    await naarRoute(page);
    await page.evaluate(() => {
      window.__klik = 0;
      HTMLInputElement.prototype.showPicker = undefined;
      document.getElementById('plan-date').addEventListener('click', () => { window.__klik++; });
    });
    await page.getByTestId('route-datum-knop').click();
    expect(await page.evaluate(() => window.__klik)).toBe(1);
  });
});
