import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// UI/UX-review P1-1: de keuzerijen van de rapportwizard (.wiz-radio-cards.row) liepen op 375 px rechts buiten beeld
// (geen flex-wrap): "Dual 2", "Configuratiefout" en "Andere" waren onzichtbaar terwijl stap 4 een oorzaak verplicht.
test.use({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

async function openWizard(page) {
  await startApp(page, { overschrijf: seed() });
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
  await expect(page.locator('#det-overlay')).toHaveClass(/open/);
  await page.locator('#d-btn-rapport').click();
  await expect(page.locator('#rapport-wizard')).toHaveClass(/open/);
}

// Alle opgegeven keuzes liggen volledig binnen de breedte van het scherm (niet rechts afgesneden).
async function binnenBeeld(page, selectors) {
  const breedte = page.viewportSize().width;
  for (const sel of selectors) {
    const kaart = page.locator(sel).locator('xpath=ancestor::label[1]');
    await expect(kaart).toBeVisible();
    const box = await kaart.boundingBox();
    expect(box.x, `${sel} links`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${sel} rechts`).toBeLessThanOrEqual(breedte);
  }
}

test('wizard op gsm: alle keuzes van Type (stap Product) en Oorzaak storing zijn zichtbaar en bereikbaar', async ({ page }) => {
  await openWizard(page);
  const volgende = page.locator('#wiz-btn-next');
  // Stap voor stap vooruit tot de stap met Type; elke stap kan een verplicht veld hebben, dus we vullen minimaal in.
  for (let i = 0; i < 8 && !(await page.locator('input[name="f-type"]').count()); i++) {
    await volgende.click();
  }
  await expect(page.locator('input[name="f-type"]')).toHaveCount(3);
  await binnenBeeld(page, ['input[name="f-type"][value="Single"]', 'input[name="f-type"][value="Dual 1"]', 'input[name="f-type"][value="Dual 2"]']);
  for (let i = 0; i < 8 && !(await page.locator('#f-oorzaak-andere').count()); i++) {
    await volgende.click();
  }
  await expect(page.locator('#f-oorzaak-andere')).toHaveCount(1);
  await binnenBeeld(page, ['#f-oorzaak-product', '#f-oorzaak-installatie', '#f-oorzaak-configuratie', '#f-oorzaak-andere']);
  // De verplichte keuze is echt te bedienen: "Andere" aantikken.
  await page.locator('#f-oorzaak-andere').locator('xpath=ancestor::label[1]').click();
  await expect(page.locator('#f-oorzaak-andere')).toBeChecked();
});
