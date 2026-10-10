import { test, expect, startApp } from './helpers.mjs';

// De kaartstijl (kaartlaag kiezen op de Route-kaart) is een persoonlijke instelling: ze wordt altijd op de EIGEN instellingen van de
// ingelogde gebruiker bewaard (zelfde doel als ⚙), nooit op de getoonde persoon. Bekijkt hij een collega, dan geldt de keuze voor zijn
// eigen weergave. Het wisselen van persoon bewaart zelf niets en laat de eigen stijl staan. Testklok: maandag 5 okt 2026.

const TECHNIEKERS = { Tim: { gebruikerId: 'u-tim', instellingen: null }, Roel: { gebruikerId: 'u-roel', instellingen: null } };
const instellingenStub = () => ({ methode }) => (methode === 'PUT'
  ? { status: 200, json: { versie: 2 } }
  : { status: 200, json: { eigen: { gebruikerId: 'u-test', versie: 1, instellingen: null }, techniekers: TECHNIEKERS } });
const puts = (verzoeken) => verzoeken.van('/api/instellingen', 'PUT');
const laag = (page, naam) => page.locator('.leaflet-control-layers').getByRole('radio', { name: naam });

test.describe('kaartstijl is persoonlijk', () => {
  test('technieker (Mag zelf plannen) bekijkt een collega en kiest een kaartlaag: de PUT gaat naar zijn eigen record, niet naar de collega', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: { zohoNaam: 'Tim', magZelfPlannen: true }, technieker: 'Roel', overschrijf: { instellingen: instellingenStub() } });
    await expect(page.locator('#person-name-hdr')).toHaveText('Roel');
    await page.getByRole('tab', { name: 'Route' }).click();
    await expect(laag(page, 'Standaard')).toBeChecked();
    await laag(page, 'OpenStreetMap').check();
    await expect(laag(page, 'OpenStreetMap')).toBeChecked();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    const put = puts(verzoeken)[0].body;
    expect(put.gebruiker).toBeUndefined(); // het eigen serverrecord (Tim), niet dat van Roel (geen 403)
    expect(put.instellingen.kaartStijl).toBe('osm');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_settings_Tim')).kaartStijl)).toBe('osm');
    expect(await page.evaluate(() => localStorage.getItem('blitz_settings_Roel'))).toBeNull(); // de collega blijft onaangeroerd
    await expect(page.locator('#toast')).not.toContainText('Je mag de instellingen');
    // De getoonde set van Roel kreeg de keuze niet.
    expect(await page.evaluate(() => kern.toestand.get('settings').kaartStijl)).not.toBe('osm');
  });

  test('persoon wisselen: de eigen kaartstijl blijft staan en er wordt niets bewaard', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: { zohoNaam: 'Tim', magZelfPlannen: true }, technieker: 'Roel', overschrijf: { instellingen: instellingenStub() } });
    await page.getByRole('tab', { name: 'Route' }).click();
    await laag(page, 'OpenStreetMap').check();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    // Naar Tim (zichzelf) en terug naar Roel: de kaart blijft OpenStreetMap; geen nieuwe PUT.
    for (const naam of ['Tim', 'Roel']) {
      await page.locator('#person-btn').click();
      await page.locator('#person-menu').getByRole('button', { name: new RegExp(naam) }).click();
      await expect(page.locator('#person-name-hdr')).toHaveText(naam);
      await expect(laag(page, 'OpenStreetMap')).toBeChecked();
    }
    await page.waitForTimeout(400);
    expect(puts(verzoeken)).toHaveLength(1);
    // Na herladen start de kaart op de eigen stijl.
    await page.reload();
    await expect(page.locator('#cnt-tickets')).toBeVisible();
    await page.getByRole('tab', { name: 'Route' }).click();
    await expect(laag(page, 'OpenStreetMap')).toBeChecked();
  });
});
