import { test, expect, startApp } from './helpers.mjs';
import { maakRouteMetStops } from './route-hulp.mjs';

// Kleurkeuze routelijn in ⚙: een rij vaste kleuren om op te tikken (kern/kleur-keuze.js) i.p.v. de native kleurkiezer.
// Testklok: maandag 5 okt 2026. Planner met Zoho-naam Tim: ⚙ bewaart onder de eigen naam (blitz_settings_Tim).

const PLANNER_TIM = { loginRol: 'planner', loginGebruiker: { zohoNaam: 'Tim' }, technieker: 'Tim' };
const venster = (page) => page.getByRole('dialog', { name: '⚙️ Instellingen' });
const leesJson = async (page, sleutel) => JSON.parse(await page.evaluate((k) => localStorage.getItem(k), sleutel));
const NAMEN = ['Oranje', 'Blauw', 'Rood', 'Groen', 'Paars', 'Roze', 'Turkoois', 'Limoen'];

async function openInstellingen(page) {
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  await expect(venster(page)).toBeVisible();
  return venster(page);
}
const staal = (modal, naam) => modal.locator('#set-routekleur').getByRole('button', { name: naam, exact: true });

test.describe('kleurkeuze routelijn', () => {
  test('8 staaltjes met kleurnaam, raakvlak minstens 40x40, standaard Oranje gekozen; geen native kleurkiezer meer', async ({ page }) => {
    await startApp(page, PLANNER_TIM);
    const modal = await openInstellingen(page);
    await expect(modal.locator('input[type="color"]')).toHaveCount(0);
    const knoppen = modal.locator('#set-routekleur button');
    await expect(knoppen).toHaveCount(8);
    for (const naam of NAMEN) {
      const knop = staal(modal, naam);
      await expect(knop).toBeVisible();
      const doos = await knop.boundingBox();
      expect(doos.width, naam).toBeGreaterThanOrEqual(40);
      expect(doos.height, naam).toBeGreaterThanOrEqual(40);
      await expect(knop, naam).toHaveAttribute('aria-pressed', naam === 'Oranje' ? 'true' : 'false');
    }
    await expect(modal.locator('#set-routekleur')).toHaveAttribute('role', 'group');
  });

  test('een kleur kiezen: aria-pressed wisselt, niets bewaard tot Opslaan; na opslaan en herladen blijft ze gekozen (hex in de opslag)', async ({ page }) => {
    await startApp(page, PLANNER_TIM);
    let modal = await openInstellingen(page);
    await staal(modal, 'Blauw').click();
    await expect(staal(modal, 'Blauw')).toHaveAttribute('aria-pressed', 'true');
    await expect(staal(modal, 'Oranje')).toHaveAttribute('aria-pressed', 'false');
    await expect(staal(modal, 'Blauw')).toHaveText('✓');
    expect(await page.evaluate(() => localStorage.getItem('blitz_settings_Tim'))).toBeNull(); // nog niet bewaard
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    expect((await leesJson(page, 'blitz_settings_Tim')).routeKleur).toBe('#2563eb');

    await page.reload();
    await expect(page.locator('#cnt-tickets')).toBeVisible();
    modal = await openInstellingen(page);
    await expect(staal(modal, 'Blauw')).toHaveAttribute('aria-pressed', 'true');
    // Annuleren verwerpt een nieuwe keuze.
    await staal(modal, 'Rood').click();
    await modal.getByRole('button', { name: 'Annuleren' }).click();
    modal = await openInstellingen(page);
    await expect(staal(modal, 'Blauw')).toHaveAttribute('aria-pressed', 'true');
  });

  test('een eerder bewaarde kleur buiten de reeks blijft zichtbaar als extra, gekozen staaltje en gaat niet verloren', async ({ page }) => {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      if (localStorage.getItem('blitz_settings_Tim') === null) localStorage.setItem('blitz_settings_Tim', JSON.stringify({ routeKleur: '#12ab34' }));
    });
    await startApp(page, PLANNER_TIM);
    const modal = await openInstellingen(page);
    await expect(modal.locator('#set-routekleur button')).toHaveCount(9);
    await expect(staal(modal, 'Eigen kleur')).toHaveAttribute('aria-pressed', 'true');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    expect((await leesJson(page, 'blitz_settings_Tim')).routeKleur).toBe('#12ab34');
  });

  test('de routelijn op de kaart krijgt de gekozen kleur', async ({ page }) => {
    await startApp(page, PLANNER_TIM);
    const modal = await openInstellingen(page);
    await staal(modal, 'Groen').click();
    await modal.locator('#set-drukte').uncheck(); // enkel de routelijn, geen drukte-kleuring
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(venster(page)).toBeHidden();
    await maakRouteMetStops(page);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('#map .leaflet-overlay-pane path')].map(p => p.getAttribute('stroke')))).toEqual(['#16a34a']);
  });
});
