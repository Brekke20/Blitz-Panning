import { test, expect, startApp } from './helpers.mjs';

// ⚙ opent ALTIJD de instellingen van de ingelogde gebruiker zelf, los van de persoonskiezer (Brent 2026-10-10).
// Doel = de eigen Zoho-naam; zonder Zoho-naam enkel de persoonlijke velden. Testklok: maandag 5 okt 2026.

const venster = (page) => page.getByRole('dialog', { name: '⚙️ Instellingen' });
const toastTekst = (page) => page.locator('#toast');
const leesOpslag = (page, sleutel) => page.evaluate((k) => localStorage.getItem(k), sleutel);
const WERKVELDEN = ['#set-start', '#set-duration', '#set-max', '#set-maxreistijd', '#set-laatste-start', '#set-van', '#set-tot', '#set-tijdslot'];
const TECHNIEKERS = { Tim: { gebruikerId: 'u-tim', instellingen: null }, Roel: { gebruikerId: 'u-roel', instellingen: null } };

// Stub van /api/instellingen: eigen id 'u-test' (zie e2e/instellingen-server.spec.mjs).
const instellingenStub = () => ({ methode }) => (methode === 'PUT'
  ? { status: 200, json: { versie: 2 } }
  : { status: 200, json: { eigen: { gebruikerId: 'u-test', versie: 1, instellingen: null }, techniekers: TECHNIEKERS } });
const puts = (verzoeken) => verzoeken.van('/api/instellingen', 'PUT');

async function openInstellingen(page) {
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  await expect(venster(page)).toBeVisible();
  return venster(page);
}
async function kiesPersoon(page, naam) {
  await page.locator('#person-btn').click();
  await page.locator('#person-menu').getByRole('button', { name: new RegExp(naam) }).click();
  await expect(page.locator('#person-name-hdr')).toHaveText(naam);
}

test.describe('⚙ opent altijd de eigen instellingen', () => {
  test('technieker (Mag zelf plannen) bekijkt een collega: ⚙ toont en bewaart zijn eigen set', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: { zohoNaam: 'Tim', magZelfPlannen: true }, technieker: 'Roel', overschrijf: { instellingen: instellingenStub() } });
    await expect(page.locator('#person-name-hdr')).toHaveText('Roel');
    const modal = await openInstellingen(page);
    await expect(modal.getByRole('heading', { name: '⚙️ Instellingen — Tim' })).toBeVisible();
    await expect(modal).not.toContainText('Roel');
    await expect(modal).not.toContainText('alle technici — ');
    await modal.locator('#set-max').fill('7');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor Tim');
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.gebruiker).toBeUndefined(); // het eigen serverrecord
    expect(JSON.parse(await leesOpslag(page, 'blitz_settings_Tim')).maxPerDag).toBe(7);
    expect(await leesOpslag(page, 'blitz_settings_Roel')).toBeNull(); // de bekeken collega blijft onaangeroerd
    // De getoonde persoon (Roel) behoudt zijn eigen set.
    expect(await page.evaluate(() => kern.toestand.get('settings').maxPerDag)).not.toBe(7);
  });

  test('beheerder met Zoho-naam bekijkt een collega: ⚙ toont de eigen naam; werkvelden alleen-lezen, kleur bewaarbaar', async ({ page, verzoeken }) => {
    await startApp(page, { loginGebruiker: { zohoNaam: 'Brent' }, technieker: 'Tim', overschrijf: { instellingen: instellingenStub() } });
    const modal = await openInstellingen(page);
    await expect(modal.getByRole('heading', { name: '⚙️ Instellingen — Brent' })).toBeVisible();
    for (const sel of WERKVELDEN) await expect(modal.locator(sel), sel).toBeDisabled();
    await modal.getByRole('button', { name: 'Blauw' }).click();
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor Brent');
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.gebruiker).toBeUndefined();
    expect(puts(verzoeken)[0].body.instellingen.routeKleur).toBe('#2563eb');
    expect(await leesOpslag(page, 'blitz_settings_Tim')).toBeNull();
  });

  test('planner met Zoho-naam: wisselen van persoon verandert ⚙ niet; kiest hij zichzelf, dan volgt de getoonde set de wijziging', async ({ page }) => {
    await startApp(page, { loginRol: 'planner', loginGebruiker: { zohoNaam: 'Brent' }, technieker: 'Tim', overschrijf: { instellingen: instellingenStub() } });
    let modal = await openInstellingen(page);
    await expect(modal.getByRole('heading', { name: '⚙️ Instellingen — Brent' })).toBeVisible();
    await modal.getByRole('button', { name: 'Annuleren' }).click();
    await kiesPersoon(page, 'Roel');
    modal = await openInstellingen(page);
    await expect(modal.getByRole('heading', { name: '⚙️ Instellingen — Brent' })).toBeVisible();
    await modal.getByRole('button', { name: 'Annuleren' }).click();
    await kiesPersoon(page, 'Brent');
    modal = await openInstellingen(page);
    await modal.locator('#set-max').fill('8');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor Brent');
    expect(await page.evaluate(() => kern.toestand.get('settings').maxPerDag)).toBe(8);
  });

  test('planner zonder Zoho-naam: enkel de persoonlijke velden, ook als hij een technieker bekijkt', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'planner', technieker: 'Tim', overschrijf: { instellingen: instellingenStub() } });
    const modal = await openInstellingen(page);
    await expect(modal.getByRole('heading', { name: '⚙️ Instellingen — Test Beheerder' })).toBeVisible();
    for (const sel of WERKVELDEN) await expect(modal.locator(sel), sel).toBeHidden();
    await expect(modal.locator('#days-grid')).toBeHidden();
    await expect(modal.locator('#set-routekleur')).toBeVisible();
    await expect(modal.locator('#set-drukte')).toBeVisible();
    await expect(modal.locator('#set-geen-werk-hint')).toBeHidden(); // enkel de beheerder krijgt de verwijzing
    await modal.locator('#set-drukte').uncheck();
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor Test');
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.gebruiker).toBeUndefined();
    expect(puts(verzoeken)[0].body.instellingen.drukteKleuring).toBe(false);
    expect(await leesOpslag(page, 'blitz_settings_Tim')).toBeNull();
  });

  test('beheerder zonder Zoho-naam: werkvelden verborgen met de verwijzing naar Beheer → Instellingen', async ({ page }) => {
    await startApp(page, { overschrijf: { instellingen: instellingenStub() } });
    const modal = await openInstellingen(page);
    for (const sel of WERKVELDEN) await expect(modal.locator(sel), sel).toBeHidden();
    await expect(modal.locator('#set-geen-werk-hint')).toBeVisible();
    await expect(modal.locator('#set-geen-werk-hint')).toContainText('Werkinstellingen van techniekers pas je aan in Beheer → Instellingen.');
  });
});
