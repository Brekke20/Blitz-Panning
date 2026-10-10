import { test, expect, startApp, opslagStub } from './helpers.mjs';

// Hulp: #1004 staat in DUMMY_DATA al ingepland (woensdag 7 okt, wacht op bevestiging); we openen het
// vanuit de kalender, zonder eerst "Plan deze week" te draaien (onafhankelijk van de uitkomst van autoPlan).
async function openTicket1004(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
  const detail = page.getByRole('dialog', { name: /Energiemeting klopt niet/ });
  await expect(detail).toBeVisible();
  return detail;
}

test.describe('voorstel, afspraak en blokkering', () => {
  test('voorstel openen toont ontvangers en voorbeeld zonder te versturen', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim' });
    const detail = await openTicket1004(page);
    await detail.getByRole('button', { name: '📨 Voorstel' }).click();

    const modal = page.getByRole('dialog', { name: '📨 Afspraakvoorstel' });
    await expect(modal).toBeVisible();
    await expect(page.locator('#proposal-overlay')).toHaveClass(/open/);
    await expect(modal.locator('#proposal-ticket-label')).toHaveText('#1004 — Luc Wouters');

    await modal.getByLabel('Datum').fill('2026-10-07');
    await modal.getByLabel(/Tijdstip/).fill('10:00');

    // Hetzelfde adres staat zowel bij contact als eindklant: één keer genoemd.
    await expect(modal.locator('#proposal-email')).toHaveText('Wordt verstuurd naar: luc@test.be');
    await expect(modal.locator('#proposal-no-email')).toBeHidden();

    const voorbeeld = modal.locator('#proposal-preview');
    await expect(voorbeeld).toContainText('Geachte Luc Wouters,');
    await expect(voorbeeld).toContainText('woensdag 7 oktober 2026');
    await expect(voorbeeld).toContainText('Energiemeting klopt niet');
    await expect(voorbeeld).toContainText('Serienummer: CHARX-3301');

    // De verzendknop bestaat, maar wordt bewust nooit aangeklikt (W11).
    await expect(modal.getByRole('button', { name: '✉️ Verstuur voorstel' })).toBeVisible();

    await modal.getByRole('button', { name: 'Annuleren' }).click();
    await expect(page.locator('#proposal-overlay')).not.toHaveClass(/open/);

    // Positief tegenstuk: de app deed wel verzoeken (laden), maar geen enkel naar de verzendpaden.
    expect(verzoeken.alle.length).toBeGreaterThan(0);
    expect(verzoeken.van('/api/propose')).toEqual([]);
    expect(verzoeken.verboden).toEqual([]);
  });

  test('klantbeschikbaarheid bewaren', async ({ page, verzoeken }) => {
    await startApp(page);
    await page.getByRole('button', { name: 'Open ticket #1001' }).click();
    const detail = page.getByRole('dialog', { name: /Laadpaal offline na stroomuitval/ });
    await expect(detail).toBeVisible();

    const opslaan = detail.getByRole('button', { name: '✓ Opslaan' });
    await expect(opslaan).toBeDisabled();
    expect(verzoeken.van('/api/klantbeschikbaarheid', 'PUT')).toEqual([]);

    await detail.getByLabel('Datum waarop de klant niet kan').fill('2026-10-09');
    await detail.getByRole('button', { name: '+ Datum toevoegen' }).click();
    await expect(detail.locator('.kb-chip')).toContainText('2026-10-09');
    await expect(opslaan).toBeEnabled();
    await opslaan.click();

    await expect(page.getByText('✓ Klantbeschikbaarheid opgeslagen')).toBeVisible();
    const puts = verzoeken.van('/api/klantbeschikbaarheid', 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].body.items.t1.geblokkeerd).toEqual(['2026-10-09']);
    // Na het bewaren is er niets meer te bewaren en blijft de datum zichtbaar.
    await expect(detail.locator('.kb-chip')).toContainText('2026-10-09');
    await expect(detail.getByRole('button', { name: '✓ Opslaan' })).toBeDisabled();
  });

  test('eigen afspraak toevoegen', async ({ page, verzoeken }) => {
    await startApp(page);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const kolom = page.locator('.day-col[data-date="2026-10-05"]');
    await expect(kolom).toBeVisible();
    await expect(kolom.getByText('Opleiding Zoho')).toHaveCount(0);

    await page.getByRole('button', { name: '➕ Afspraak' }).click();
    const modal = page.locator('#manueel-overlay');
    await expect(modal).toHaveClass(/open/);
    await modal.getByLabel('Titel *').fill('Opleiding Zoho');
    await modal.getByLabel('Datum *').fill('2026-10-05');
    await modal.getByLabel('Van *').fill('14:00');
    await modal.getByLabel('Tot *').fill('15:30');
    await modal.getByRole('button', { name: 'Opslaan' }).click();

    await expect(page.getByText('✓ Afspraak opgeslagen')).toBeVisible();
    await expect(modal).not.toHaveClass(/open/);
    const puts = verzoeken.van('/api/afspraken', 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].body.versie).toBe(0);
    expect(puts[0].body.afspraken).toHaveLength(1);
    expect(puts[0].body.afspraken[0]).toMatchObject({
      titel: 'Opleiding Zoho', datum: '2026-10-05', uur: '14:00', einduur: '15:30', bron: 'manueel',
    });
    await expect(kolom.getByText('Opleiding Zoho')).toBeVisible();
    // Niet op een andere dag.
    await expect(page.locator('.day-col[data-date="2026-10-06"]').getByText('Opleiding Zoho')).toHaveCount(0);
  });

  test('blokkering (uitzondering) toevoegen', async ({ page, verzoeken }) => {
    await startApp(page);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const dinsdag = page.locator('.day-col[data-date="2026-10-06"]');
    await expect(dinsdag.getByText('🔒 Geblokkeerd')).toHaveCount(0);

    await dinsdag.getByRole('button', { name: '⏱ Beschikbaar' }).click();
    const modal = page.getByRole('dialog', { name: '⛔ Beschikbaarheid' });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Geen blokkeringen voor deze dag.')).toBeVisible();
    await modal.getByLabel('Reden').fill('Verlof');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();

    await expect(modal.getByText('🔒 Hele dag — Verlof')).toBeVisible();
    const puts = verzoeken.van('/api/availability', 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].body.exceptions).toHaveLength(1);
    expect(puts[0].body.exceptions[0]).toMatchObject({
      date: '2026-10-06', kind: 'fullday', scope: 'global', person: null, reason: 'Verlof',
    });

    await modal.getByRole('button', { name: 'Sluiten' }).click();
    await expect(dinsdag.getByText('🔒 Geblokkeerd')).toBeVisible();
    // Andere dagen blijven vrij.
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByText('🔒 Geblokkeerd')).toHaveCount(0);
  });
  test('tijdvak-blokkering voor iedereen: payload en tijdlijnblok', async ({ page, verzoeken }) => {
    await startApp(page); // coordinator, Iedereen: enkel scope "global"
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const dinsdag = page.locator('.day-col[data-date="2026-10-06"]');
    await expect(dinsdag.locator('.tl-blocked')).toHaveCount(0);

    await dinsdag.getByRole('button', { name: '⏱ Beschikbaar' }).click();
    const modal = page.getByRole('dialog', { name: '⛔ Beschikbaarheid' });
    await modal.getByRole('button', { name: '⏱ Tijdvak' }).click();
    await modal.getByLabel('Van (tijd)').fill('12:00');
    await modal.getByLabel('Tot (tijd)').fill('13:30');
    await modal.getByLabel('Reden').fill('Middagpauze');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();

    await expect(modal.getByText('⏱ 12:00–13:30 — Middagpauze')).toBeVisible();
    const puts = verzoeken.van('/api/availability', 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].body.versie).toBe(0);
    expect(puts[0].body.exceptions).toHaveLength(1);
    expect(puts[0].body.exceptions[0]).toMatchObject({
      date: '2026-10-06', kind: 'range', from: '12:00', to: '13:30', scope: 'global', person: null, reason: 'Middagpauze',
    });

    await modal.getByRole('button', { name: 'Sluiten' }).click();
    // Zichtbaar effect: een blok op de tijdlijn, en de dag zelf blijft beschikbaar (geen volledige blokkade).
    await expect(dinsdag.locator('.tl-blocked')).toHaveText('🔒 12:00–13:30: Middagpauze');
    await expect(dinsdag.getByRole('button', { name: '⏱ 1 uitzondering' })).toBeVisible();
    await expect(dinsdag.getByText('🔒 Geblokkeerd')).toHaveCount(0);
    await expect(page.locator('.day-col[data-date="2026-10-07"]').locator('.tl-blocked')).toHaveCount(0);
  });

  test('tijdvak-blokkering voor één persoon: payload met die persoon', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim' });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const dinsdag = page.locator('.day-col[data-date="2026-10-06"]');
    await dinsdag.getByRole('button', { name: '⏱ Beschikbaar' }).click();
    const modal = page.getByRole('dialog', { name: '⛔ Beschikbaarheid' });
    await modal.getByRole('button', { name: '⏱ Tijdvak' }).click();
    // Met een gekozen technieker staat "Voor" standaard op die persoon.
    await expect(modal.getByRole('button', { name: '👤 Tim' })).toHaveAttribute('aria-pressed', 'true');
    await modal.getByLabel('Van (tijd)').fill('09:00');
    await modal.getByLabel('Tot (tijd)').fill('10:00');
    await modal.getByRole('button', { name: '➕ Toevoegen' }).click();

    await expect(modal.getByText('⏱ 09:00–10:00 (Tim)')).toBeVisible();
    const puts = verzoeken.van('/api/availability', 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].body.exceptions[0]).toMatchObject({
      date: '2026-10-06', kind: 'range', from: '09:00', to: '10:00', scope: 'person', person: 'Tim',
    });
    await modal.getByRole('button', { name: 'Sluiten' }).click();
    await expect(dinsdag.locator('.tl-blocked')).toHaveText('🔒 09:00–10:00');
  });

  test('een tijdvak van één persoon geldt enkel in de weergave van die persoon', async ({ page }) => {
    const roelsBlok = { id: 'r1', scope: 'person', person: 'Roel', date: '2026-10-06', kind: 'range', from: '13:00', to: '14:00', reason: 'Tandarts' };
    const overschrijf = { availability: opslagStub({ versie: 1, exceptions: [roelsBlok] }, 'exceptions') };

    // Als Tim: niets te zien op die dag.
    await startApp(page, { technieker: 'Tim', overschrijf });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const dinsdag = page.locator('.day-col[data-date="2026-10-06"]');
    await expect(dinsdag.getByRole('button', { name: '⏱ Beschikbaar' })).toBeVisible();
    await expect(dinsdag.locator('.tl-blocked')).toHaveCount(0);

    // Positief tegenstuk: zelfde data, als Roel is het blok er wel.
    await page.locator('#person-btn').click();
    await page.locator('#person-menu').getByRole('button', { name: /Roel/ }).click();
    await expect(dinsdag.locator('.tl-blocked')).toHaveText('🔒 13:00–14:00: Tandarts');
  });
});
