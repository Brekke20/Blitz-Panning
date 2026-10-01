import { test, expect, startApp } from './helpers.mjs';

// Hulp: Tim plant de week (#1001 en #1002 komen op maandag 5 okt) en we openen #1001 vanuit de kalender.
async function planEnOpenTicket1001(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
  const resultaat = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
  await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
  await resultaat.getByRole('button', { name: 'Sluiten' }).click();
  await expect(resultaat).toBeHidden();
  await page.locator('.day-col[data-date="2026-10-05"]').getByRole('button', { name: '#1001', exact: true }).click();
  const detail = page.getByRole('dialog', { name: /Laadpaal offline na stroomuitval/ });
  await expect(detail).toBeVisible();
  return detail;
}

test.describe('voorstel, afspraak en blokkering', () => {
  test('voorstel openen toont ontvangers en voorbeeld zonder te versturen', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim' });
    const detail = await planEnOpenTicket1001(page);
    await detail.getByRole('button', { name: '📨 Voorstel' }).click();

    const modal = page.getByRole('dialog', { name: '📨 Afspraakvoorstel' });
    await expect(modal).toBeVisible();
    await expect(page.locator('#proposal-overlay')).toHaveClass(/open/);
    await expect(modal.locator('#proposal-ticket-label')).toHaveText('#1001 — Jan Peeters');

    await modal.getByLabel('Datum').fill('2026-10-07');
    await modal.getByLabel(/Tijdstip/).fill('10:00');

    // Hetzelfde adres staat zowel bij contact als eindklant: één keer genoemd.
    await expect(modal.locator('#proposal-email')).toHaveText('Wordt verstuurd naar: jan@test.be');
    await expect(modal.locator('#proposal-no-email')).toBeHidden();

    const voorbeeld = modal.locator('#proposal-preview');
    await expect(voorbeeld).toContainText('Geachte Jan Peeters,');
    await expect(voorbeeld).toContainText('woensdag 7 oktober 2026');
    await expect(voorbeeld).toContainText('Laadpaal offline na stroomuitval');
    await expect(voorbeeld).toContainText('Serienummer: CHARX-2291');

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
    await expect(dinsdag.locator('.day-body')).not.toHaveClass(/blocked-day/);

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
    await expect(dinsdag.locator('.day-body')).toHaveClass(/blocked-day/);
    // Andere dagen blijven vrij.
    await expect(page.locator('.day-col[data-date="2026-10-07"]').getByText('🔒 Geblokkeerd')).toHaveCount(0);
  });
});
