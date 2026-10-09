// Een account met een Zoho-naam (beheerder of planner) voert ook zelf interventies uit: eigen tickets met Aankomst/Foto's/Rapport,
// "Mijn rapporten" en de eigen persoon in de kiezer. Zonder Zoho-naam verandert er niets.
import { test, expect, startApp, opslagStub } from './helpers.mjs';

const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const RAPPORTEN = [
  { id: 'r1', ticketId: 't1', ticketNumber: '1001', datum: '2026-10-05', technieker: 'Brent Calaerts', rapportData: { _html: '<p>A</p>' } },
  { id: 'r2', ticketId: 't2', ticketNumber: '1002', datum: '2026-10-05', technieker: 'Tim', ingediendDoor: 'u-test', rapportData: { _html: '<p>B</p>' } },
  { id: 'r3', ticketId: 't3', ticketNumber: '1003', datum: '2026-10-05', technieker: 'Roel', ingediendDoor: 'u-roel', rapportData: { _html: '<p>C</p>' } },
];
const archief = { 'rapport-archief': opslagStub({ versie: 3, rapports: RAPPORTEN }, 'rapports') };

for (const loginRol of ['beheerder', 'planner']) {
  test(`${loginRol} met een Zoho-naam: de filter "Mijn rapporten" toont enkel de eigen rapporten`, async ({ page }) => {
    await startApp(page, { loginRol, loginGebruiker: { zohoNaam: 'Brent Calaerts' }, technieker: 'all', overschrijf: archief });
    await tab(page, 'Rapporten').click();
    const body = page.locator('#rapp-archief-body');
    await expect(body).toContainText('1001');
    await expect(body).toContainText('1003');
    await page.getByRole('button', { name: 'Mijn rapporten' }).click();
    await expect(body).toContainText('1001'); // mijn Zoho-naam op het rapport
    await expect(body).toContainText('1002'); // door mij ingediend (ingediendDoor = mijn id), onder een andere naam
    await expect(body).not.toContainText('1003');
    await page.getByRole('button', { name: 'Alle', exact: true }).click();
    await expect(body).toContainText('1003');
  });
}

test('een planner zonder Zoho-naam heeft geen filter "Mijn rapporten"', async ({ page }) => {
  await startApp(page, { loginRol: 'planner', overschrijf: archief });
  await tab(page, 'Rapporten').click();
  await expect(page.getByRole('button', { name: 'Mijn rapporten' })).toBeHidden();
});

test('technieker: geen filter "Mijn rapporten" (de server geeft toch enkel zijn eigen rapporten)', async ({ page }) => {
  await startApp(page, { loginRol: 'technieker', overschrijf: archief });
  await tab(page, 'Rapporten').click();
  await expect(page.getByRole('button', { name: 'Mijn rapporten' })).toBeHidden();
});

test("een account met een Zoho-naam ziet Aankomst, Foto's en Rapport bij zijn eigen ingepland ticket (#1004 is van Tim)", async ({ page }) => {
  await startApp(page, { rol: 'technieker', loginRol: 'planner', loginGebruiker: { zohoNaam: 'Tim' }, technieker: 'Tim' });
  await tab(page, 'Kalender').click();
  await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
  const detail = page.getByRole('dialog', { name: /Energiemeting klopt niet/ });
  await expect(detail).toBeVisible();
  await expect(detail.locator('#d-btn-arrival')).toBeVisible();
  await expect(detail.locator('#d-btn-fotos')).toBeVisible();
  await expect(detail.locator('#d-btn-rapport')).toBeVisible();
});
