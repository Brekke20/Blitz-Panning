import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// Tijd-/datumvelden op een telefoon (grove aanwijzer): een tik op het midden van het veld roept showPicker() aan
// (kern/tijd-picker.js, uit fix/tijdveld-android). Het echte Android-klokvenster is niet te testen: showPicker wordt bespioneerd
// via addInitScript. Alles in ?test.
// Telefoonprofiel (zoals Pixel 7): aanraking => (pointer: coarse). `devices` importeren mag niet (e2e-importguard), de opties wel.
test.use({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });

async function spioneerShowPicker(page) {
  await page.addInitScript(() => {
    window.__pickerCalls = [];
    HTMLInputElement.prototype.showPicker = function () { window.__pickerCalls.push(this.id || this.type); };
  });
}
const aantal = (page) => page.evaluate(() => window.__pickerCalls.length);
const laatste = (page) => page.evaluate(() => window.__pickerCalls.at(-1));
const MIDDEN = { position: { x: 40, y: 12 } };

async function openWizard(page) {
  await spioneerShowPicker(page);
  await startApp(page, { overschrijf: seed() });
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
  await expect(page.locator('#det-overlay')).toHaveClass(/open/);
  await page.locator('#d-btn-rapport').click();
  await expect(page.locator('#rapport-wizard')).toHaveClass(/open/);
  await expect(page.locator('#f-start')).toBeVisible();
}

test.describe('tijdveld: een tik op het veld opent de klok (Android)', () => {
  test('rapportwizard: een tik op het midden van starttijd en stoptijd roept showPicker aan', async ({ page }) => {
    await openWizard(page);
    expect(await aantal(page)).toBe(0);
    await page.locator('#f-start').tap(MIDDEN);
    expect(await aantal(page)).toBe(1);
    expect(await laatste(page)).toBe('f-start');
    await page.locator('#f-stop').tap(MIDDEN);
    expect(await laatste(page)).toBe('f-stop');
    expect(await aantal(page)).toBe(2);
  });

  test('een readonly tijdveld en een tekstveld krijgen geen picker; een fout van showPicker laat de pagina heel', async ({ page }) => {
    await openWizard(page);
    await page.evaluate(() => { document.getElementById('f-start').readOnly = true; });
    await page.locator('#f-start').tap(MIDDEN);
    await page.locator('#f-zoho').tap();
    expect(await aantal(page)).toBe(0);
    await page.evaluate(() => {
      document.getElementById('f-start').readOnly = false;
      HTMLInputElement.prototype.showPicker = function () { throw new DOMException('x', 'NotAllowedError'); };
    });
    await page.locator('#f-stop').tap(MIDDEN);
    await expect(page.locator('#f-stop')).toBeVisible();
  });

  test('ook een tijdveld buiten de wizard (Instellingen: werkuren van) krijgt de picker', async ({ page }) => {
    await spioneerShowPicker(page);
    await startApp(page, { loginRol: 'planner', loginGebruiker: { zohoNaam: 'Brent' } }); // eigen werkuren: planner met Zoho-naam (beheerder: alleen-lezen; zonder naam: verborgen)
    await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
    const van = page.locator('#set-van');
    await expect(van).toBeVisible();
    await van.tap(MIDDEN);
    expect(await laatste(page)).toBe('set-van');
    expect(await aantal(page)).toBe(1);
  });
});
