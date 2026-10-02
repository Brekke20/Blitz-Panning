import { test, expect, startApp, opslagStub } from './helpers.mjs';

// Etappe 5b, taak 1: "Verstuur rapport" in testmodus (?test). voorbeeldRapport slaat het voorbeeld over en roept
// verstuurRapport aan, dat enkel lokaal een demo-verzending doet (W11: geen verzoek naar /api/send-rapport of
// /api/rapport-verzonden; die paden zijn verboden en laten elke test falen). De echte paden staan in
// e2e/productie/rapport.spec.mjs.
const RAPPORT = { id: 'r1', ticketId: 't1', ticketNumber: '1001', datum: '2026-10-05', technieker: 'Tim', rapportData: { _html: '<p>Rapport</p>' } };

test.describe('rapport verzenden in testmodus', () => {
  test('Verstuur: geen verzoek, demo-toast en het "✓ Verzonden"-badge (verzondenKlant gezet)', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: { 'rapport-archief': opslagStub({ versie: 4, rapports: [RAPPORT] }, 'rapports') } });
    await page.getByRole('tab', { name: 'Rapporten' }).click();
    const knop = page.locator('.btn-verstuur-rapport');
    await expect(knop).toHaveText('✉️ Verstuur rapport');
    await knop.click();

    // Geen voorbeeldvenster: de testmodus slaat het over; de knop is meteen uitgeschakeld.
    await expect(page.locator('#rapport-preview-overlay')).not.toHaveClass(/open/);
    await expect(page.locator('#toast')).toHaveText('🧪 Testmodus — rapport verstuurd (demo)');
    await expect(knop).toHaveText('✓ Verzonden');
    await expect(knop).toBeEnabled(); // de kaart is hertekend
    const lokaal = await page.evaluate(() => JSON.parse(JSON.stringify(window._rapportArchief)));
    expect(lokaal).toHaveLength(1);
    expect(lokaal[0].verzondenKlant).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(lokaal[0].verzondenContact).toBeUndefined();
    expect(lokaal[0].verzondenInstallateur).toBeUndefined();

    expect(verzoeken.van('/api/send-rapport')).toEqual([]);
    expect(verzoeken.van('/api/rapport-verzonden')).toEqual([]);
    expect(verzoeken.verboden).toEqual([]);
    // Geen enkel schrijfverzoek naar het archief.
    expect(verzoeken.van('/api/rapport-archief').filter(r => r.methode !== 'GET')).toEqual([]);
  });
});
