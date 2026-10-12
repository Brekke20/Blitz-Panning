// Productiefout v2.0.1: het tabblad Rapporten toonde "✕ Laden mislukt: Cannot read properties of null (reading 'id')".
// Het archief wordt getekend door renderRapportArchief() en renderKalender() in één try; een null-record in de wachtrij-lijst
// van het toestel (_outboxItems), in de planning of in de afspraken liet die twee falen op `.id`/`.datum`. Elk scherm moet
// kapotte records negeren en de rest gewoon tonen.
import { test, expect, startApp, opslagStub } from './helpers.mjs';

const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
// 2026-10-07 is een dag met een ingepland ticket van Tim (#1004) in de dummydata.
const RAPPORTEN = [
  { id: 'r1', ticketId: 't-oud', ticketNumber: '1002', datum: '2026-10-07', technieker: 'Tim', rapportData: { _html: '<p>A</p>' } },
  { id: 'r2', ticketId: 't-oud2', ticketNumber: '1003', datum: '2026-10-07', technieker: 'Tim', rapportData: { _html: '<p>B</p>' } },
];
const archief = { 'rapport-archief': opslagStub({ versie: 3, rapports: RAPPORTEN }, 'rapports') };

for (const filter of ['Tim', 'all']) {
  test(`Rapporten laadt ondanks een null in de wachtrij van het toestel (filter ${filter})`, async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', technieker: filter, overschrijf: archief });
    // De wachtrij-lijst (IndexedDB) kan geen null bevatten; dit is het vangnet voor wat de lijst ook ooit levert.
    await page.evaluate(() => Object.defineProperty(window, '_outboxItems', { get: () => [null, { id: 'r2' }], configurable: true }));
    await tab(page, 'Rapporten').click();
    const body = page.locator('#rapp-archief-body');
    await expect(body).toContainText('1002');
    await expect(body).not.toContainText('Laden mislukt');
    await expect(body).toContainText('In wachtrij'); // r2 staat in de (gezuiverde) wachtrij
  });
}

test('Rapporten laadt ondanks een planning-item zonder ticket (filter all)', async ({ page }) => {
  await startApp(page, { loginRol: 'beheerder', technieker: 'all', overschrijf: archief });
  await page.evaluate(() => {
    const planning = window.kern.toestand.get('planning');
    planning['2026-10-07'].push({ ticket: null, uur: null }, null); // zonder raak(): enkel de volgende render ziet het
  });
  await tab(page, 'Rapporten').click();
  const body = page.locator('#rapp-archief-body');
  await expect(body).toContainText('1002');
  await expect(body).not.toContainText('Laden mislukt');
});

// Vastgelegd gedrag: een beheerder ziet in Rapporten ALLE rapporten, ongeacht de gekozen persoon in de kop.
for (const filter of ['Tim', 'Roel', 'all']) {
  test(`beheerder ziet alle rapporten in Rapporten, ook met persoon ${filter} gekozen`, async ({ page }) => {
    const alle = [
      ...RAPPORTEN,
      { id: 'r3', ticketId: 't3', ticketNumber: '1005', datum: '2026-10-06', technieker: 'Roel', rapportData: { _html: '<p>C</p>' } },
      { id: 'r4', ticketId: 't4', ticketNumber: '1006', datum: '2026-10-02', technieker: 'Iemand Anders', rapportData: { _html: '<p>D</p>' } },
    ];
    await startApp(page, { loginRol: 'beheerder', technieker: filter, overschrijf: { 'rapport-archief': opslagStub({ versie: 3, rapports: alle }, 'rapports') } });
    await tab(page, 'Rapporten').click();
    const body = page.locator('#rapp-archief-body');
    for (const nr of ['1002', '1003', '1005', '1006']) await expect(body).toContainText(nr);
    await expect(body).not.toContainText('Laden mislukt');
  });
}

test('Rapporten laadt ondanks een null in het archief zelf', async ({ page }) => {
  await startApp(page, {
    loginRol: 'beheerder', technieker: 'Tim',
    overschrijf: { 'rapport-archief': opslagStub({ versie: 3, rapports: [null, ...RAPPORTEN] }, 'rapports') },
  });
  await tab(page, 'Rapporten').click();
  const body = page.locator('#rapp-archief-body');
  await expect(body).toContainText('1002');
  await expect(body).toContainText('1003');
  await expect(body).not.toContainText('Laden mislukt');
});
