import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// Brent-verzoek (proefperiode): Kalender, Route-tab en Ingepland tonen dezelfde week via de gedeelde `gekozenDatum`.
// Klok: maandag 5 okt 2026 09:00 (VASTE_NU).

const volgende = (page) => page.getByRole('button', { name: 'Volgende periode' }).first();
const kalLabel = (page) => page.locator('#kal-label');

test.describe('gedeelde week', () => {
  test('een latere week in de Kalender is ook de week en dag van de Route-tab', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await volgende(page).click();
    await volgende(page).click();
    await expect(kalLabel(page)).toContainText('19 okt – 25 okt');

    await page.getByRole('tab', { name: 'Route' }).click();
    // De datumkiezer en de weekstrook staan op de gekozen datum (5 okt + 14 dagen = 19 okt).
    await expect(page.getByTestId('route-datum')).toHaveValue('2026-10-19');
    await expect(page.locator('#week-strip .ws-dag.actief')).toContainText('19');
    // De Route-tab op de achtergrond rekende niets: er is geen route-aanvraag voor een lege dag.
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(0);
  });

  test('een dag kiezen in de Route-tab (kiezer en weekstrook) verplaatst de Kalender en Ingepland', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByTestId('route-datum').fill('2026-10-14');
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(kalLabel(page)).toContainText('12 okt – 18 okt');

    // Weekstrook: volgende week (›) in de Route-tab geeft 21 okt.
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByRole('button', { name: 'Volgende week' }).click();
    await expect(page.getByTestId('route-datum')).toHaveValue('2026-10-21');
    await page.getByRole('tab', { name: /Ingepland/ }).click();
    await expect(page.locator('#gep-label')).toHaveText('19 okt – 25 okt');
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(kalLabel(page)).toContainText('19 okt – 25 okt');
  });

  test('"Vandaag" in de Kalender zet ook de Route-tab terug op vandaag', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await volgende(page).click();
    await expect(kalLabel(page)).toContainText('12 okt – 18 okt');
    await kalLabel(page).click();
    await expect(kalLabel(page)).toContainText('5 okt – 11 okt');
    await page.getByRole('tab', { name: 'Route' }).click();
    await expect(page.getByTestId('route-datum')).toHaveValue('2026-10-05');
  });

  test('een andere dag in de Route-tab kiezen en dan "Vandaag" in de Kalender zet beide terug', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByTestId('route-datum').fill('2026-10-28');
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(kalLabel(page)).toContainText('26 okt – 1 nov');
    await kalLabel(page).click();
    await expect(kalLabel(page)).toContainText('5 okt – 11 okt');
    await page.getByRole('tab', { name: 'Route' }).click();
    await expect(page.getByTestId('route-datum')).toHaveValue('2026-10-05');
  });

  test('Ingepland: › verschuift ook de Kalender', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: /Ingepland/ }).click();
    await page.locator('#gep-label + button').click();
    await expect(page.locator('#gep-label')).toHaveText('12 okt – 18 okt');
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await expect(kalLabel(page)).toContainText('12 okt – 18 okt');
  });

  test('de maandweergave volgt de gekozen dag uit de Route-tab, en de maandstap verschuift de gedeelde datum', async ({ page }) => {
    await startApp(page, { technieker: 'Tim', overschrijf: seed() });
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByTestId('route-datum').fill('2026-11-18');
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.locator('#kal-view-month').click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('November 2026');
    await volgende(page).click();
    await expect(page.locator('#kal-label-tekst')).toHaveText('December 2026');
    await page.getByRole('tab', { name: 'Route' }).click();
    await expect(page.getByTestId('route-datum')).toHaveValue('2026-12-18');
  });
});
