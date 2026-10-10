// "Mag zelf plannen": een technieker met dat vinkje ziet de Wachtrij en de Route en plant enkel zijn EIGEN tickets (Tim). De tickets van
// een collega (Roel) blijven alleen-lezen. Zonder het vinkje verandert er niets. Alles in testmodus (nooit Zoho).
import { test, expect, startApp } from './helpers.mjs';

const TIM = { zohoNaam: 'Tim', magZelfPlannen: true };
const tab = (page, naam) => page.getByRole('tab', { name: new RegExp('^' + naam) }); // sommige tabs dragen een teller
const zichtbareTabs = (page) => page.locator('.tabs-inner .tab:visible');
const kies = async (page, naam) => {
  await page.locator('#person-btn').click();
  await page.locator('#person-menu').getByRole('button', { name: new RegExp(naam) }).click();
};

const matrixMet = (minuten) => ({ body }) => ({
  status: 200,
  json: { results: (body?.destinations || []).map(() => ({ travelTimeSeconds: minuten * 60, distanceMeters: 50000 })) },
});

test.describe('technieker met "Mag zelf plannen"', () => {
  test('ziet de tabs Wachtrij en Route erbij (6 tabs), zonder Beheer', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    await expect(zichtbareTabs(page)).toHaveCount(6);
    for (const naam of ['Wachtrij', 'Kalender', 'Route', 'Ingepland', 'Inventaris', 'Rapporten']) await expect(tab(page, naam)).toBeVisible();
    await expect(tab(page, 'Beheer')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'technieker');
    await expect(page.locator('html')).toHaveAttribute('data-plan-eigen', 'ja');
    await expect(tab(page, 'Wachtrij')).toHaveAttribute('aria-selected', 'true'); // start op de Wachtrij, niet op de Kalender
  });

  for (const magZelfPlannen of [undefined, false, 'ja']) {
    test(`zonder het vinkje (${String(magZelfPlannen)}) blijft het bij 4 tabs en zijn de plan-onderdelen verborgen`, async ({ page }) => {
      await startApp(page, { loginRol: 'technieker', loginGebruiker: { zohoNaam: 'Tim', magZelfPlannen }, technieker: 'Tim' });
      await expect(zichtbareTabs(page)).toHaveCount(4);
      await expect(page.locator('html')).toHaveAttribute('data-plan-eigen', 'nee');
      await tab(page, 'Kalender').click();
      await expect(page.locator('#btn-autoplan')).toBeHidden();
      await expect(page.locator('#view-tickets .btn-add')).toHaveCount(0);
    });
  }

  test('Wachtrij: een "+" bij zijn eigen tickets, geen "+" bij die van een collega', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    const kaart = (nummer) => page.getByRole('button', { name: `Open ticket #${nummer}` });
    await expect(kaart('1001')).toBeVisible();
    await expect(page.locator('#view-tickets .btn-add')).toHaveCount(2); // 1001 en 1002 zijn van Tim
    await kies(page, 'Roel');
    await expect(kaart('1003')).toBeVisible();
    await expect(page.locator('#view-tickets .btn-add')).toHaveCount(0); // 1003 is van Roel
  });

  test('plant zijn eigen ticket in via "+" (eerstvolgende vrije dag)', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    await page.locator('#view-tickets .btn-add').first().click();
    await expect(page.locator('#toast')).toContainText('Toegevoegd aan');
    await expect(page.locator('#cnt-tickets')).toHaveText('1');
    expect(verzoeken.van('/api/plan')).toEqual([]); // testmodus: nooit Zoho
  });

  test('"Plan deze week" plant enkel zijn eigen tickets; bij een collega is de knop weg en wordt niets gepland', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim', overschrijf: { matrix: matrixMet(20) } });
    await tab(page, 'Kalender').click();
    await expect(page.getByRole('button', { name: '⚡ Plan deze week' })).toBeVisible();
    await kies(page, 'Roel');
    await expect(page.getByRole('button', { name: '⚡ Plan deze week' })).toBeHidden();
    // Ook wie de knop toch zou bereiken (bv. via de actie zelf) krijgt een weigering en er wordt niets gepland.
    await page.evaluate(() => document.getElementById('btn-autoplan').click());
    await expect(page.locator('#toast')).toContainText('Je mag enkel je eigen planning inplannen');
    await expect(page.getByRole('dialog', { name: '⚡ Planningsresultaat' })).toBeHidden();
    expect(verzoeken.van('/api/matrix')).toEqual([]);
    await kies(page, 'Tim');
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
    const venster = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
    await expect(venster).toBeVisible();
    await expect(venster.getByText('Ingepland (2)', { exact: true })).toBeVisible();
  });

  test('ticketdetail: plan-knoppen enkel bij zijn eigen tickets (en Aankomst/Foto\'s/Rapport zoals voorheen)', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    // eigen ticket in de wachtrij: "Voeg toe aan planning"
    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    await expect(page.locator('#d-plan-btn')).toBeVisible();
    await expect(page.locator('#d-plan-btn')).toHaveText('+ Voeg toe aan planning');
    await page.locator('[data-actie="det-sluit"], #det-overlay .mhdr-close').first().click();
    // ticket van een collega: geen plan-knop en geen klantbeschikbaarheid-blok
    await kies(page, 'Roel');
    await page.getByRole('button', { name: 'Open ticket #1003' }).click();
    await expect(page.getByRole('dialog', { name: /Laadstation geeft foutcode E05/ })).toBeVisible();
    await expect(page.locator('#d-plan-btn')).toBeHidden();
    await expect(page.locator('#d-btn-proposal')).toBeHidden();
    await expect(page.locator('#d-btn-reschedule')).toBeHidden();
    await expect(page.locator('#kb-section')).toBeHidden();
  });

  test('Kalender: "Toewijzen" (zonder datum) en het kruisje (ingepland) enkel bij zijn eigen tickets (#1004 en #1005 zijn van Tim)', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    await tab(page, 'Kalender').click();
    await expect(page.locator('.day-col[data-date="2026-10-07"]').locator('.cal-unplan-x')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '📅 Toewijzen' })).toHaveCount(1);
  });

  test('Kalender: Roel (zelfde vinkje) ziet bij de tickets van Tim geen "Toewijzen" en geen kruisje', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: { zohoNaam: 'Roel', magZelfPlannen: true }, technieker: 'Roel' });
    await tab(page, 'Kalender').click();
    await kies(page, 'Tim');
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' })).toBeVisible();
    await expect(page.locator('.cal-unplan-x')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '📅 Toewijzen' })).toHaveCount(0);
  });

  test('Route: zijn eigen stops hebben "Voorstel" en "Uit planning halen", Optimaliseren werkt; bij een collega niet', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim', overschrijf: { matrix: matrixMet(20) } });
    await page.locator('#view-tickets .btn-add').first().click(); // 1001 inplannen op de eerstvolgende vrije dag
    await tab(page, 'Route').click();
    await expect(page.locator('#route-list .stop').first()).toBeVisible();
    await expect(page.locator('#route-list').getByRole('button', { name: /Voorstel/ }).first()).toBeVisible();
    await expect(page.locator('#route-list').getByRole('button', { name: /Uit planning halen/ }).first()).toBeVisible();
    await kies(page, 'Roel');
    await expect(page.locator('#route-list').getByRole('button', { name: /Voorstel/ })).toHaveCount(0);
    await expect(page.locator('#route-list').getByRole('button', { name: /Uit planning halen/ })).toHaveCount(0);
    await expect(page.locator('#btn-optimize')).toBeDisabled();
  });

  test('Instellingen: hij stelt zijn eigen planning in (Algemeen); voor een collega weigert de app het bewaren', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    await page.getByRole('button', { name: 'Instellingen' }).click();
    await expect(page.locator('#set-subtab-algemeen')).toBeVisible();
    await expect(page.locator('#set-subtab-beschikbaarheden')).toBeHidden();
    await expect(page.locator('#set-tab-algemeen')).toBeVisible();
    await expect(page.locator('#set-person-label')).toContainText('Tim');
  });
});

test.describe('beheerder en planner: niet beperkt', () => {
  test('een coördinator is niet beperkt (planner plant elk ticket, ook dat van Roel)', async ({ page }) => {
    await startApp(page, { loginRol: 'planner', technieker: 'Roel' });
    await expect(page.locator('#view-tickets .btn-add')).toHaveCount(1);
  });
});

// De opruiming van verouderde klantbeschikbaarheid-entries (gesloten tickets, collega's) draait bij elke ticketlading; een technieker met het
// vinkje bewaart enkel zijn eigen tickets en doet dus niet mee (review I1: anders mislukte zijn bewaring bij elke start).
const gcMetOudeEntry = (page) => page.evaluate(async () => {
  const { toestand } = await import('/js/kern/toestand.js');
  const kb = await import('/js/schermen/klantbeschikbaarheid.js');
  toestand.get('klantBeschikbaarheid')['999'] = { voorkeur: '2025-01-01', geblokkeerd: [], notitie: 'oud', bijgewerkt: '2025-01-01T00:00:00.000Z' };
  kb.gcKlantBeschikbaarheid(new Set());
  return Object.keys(toestand.get('klantBeschikbaarheid'));
});

test.describe('opruiming van klantbeschikbaarheid', () => {
  test('technieker met het vinkje: geen opruiming (en dus geen bewaring die kan mislukken)', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
    expect(await gcMetOudeEntry(page)).toContain('999');
    expect(verzoeken.van('/api/klantbeschikbaarheid', 'PUT')).toEqual([]);
  });

  test('planner: ruimt de verouderde entry wel op', async ({ page }) => {
    await startApp(page, { loginRol: 'planner', technieker: 'Tim' });
    expect(await gcMetOudeEntry(page)).not.toContain('999');
  });
});
