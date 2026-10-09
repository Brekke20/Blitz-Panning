import { test, expect, startApp, standaardStub } from './helpers.mjs';

// Rapport en Zoho (W11): de wizard wordt enkel tot het Overzicht aangestuurd. De knop
// "✓ Rapport versturen" (laatste stap) wordt nooit aangeklikt.

async function openInstellingen(page) {
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '⚙️ Instellingen' });
  await expect(modal).toBeVisible();
  return modal;
}

const leesOpslag = (page, sleutel) => page.evaluate((k) => localStorage.getItem(k), sleutel);

test.describe('instellingen en rapport', () => {
  test('instellingen bewaren', async ({ page }) => {
    await startApp(page);
    let modal = await openInstellingen(page);
    await expect(modal.locator('#set-person-label')).toHaveText('Instellingen voor: Standaard (alle technici)');
    const oud = await modal.locator('#set-laatste-start').inputValue();
    expect(oud).not.toBe('15:00');
    expect(await leesOpslag(page, 'blitz_laatste_start')).toBeNull();

    await modal.getByLabel('Laatste start (geldt voor iedereen)').fill('15:00');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();

    await expect(page.getByText('✓ Instellingen opgeslagen voor alle technici')).toBeVisible();
    await expect(modal).toBeHidden();
    expect(await leesOpslag(page, 'blitz_laatste_start')).toBe('15:00');

    modal = await openInstellingen(page);
    await expect(modal.locator('#set-laatste-start')).toHaveValue('15:00');

    // Ook na herladen blijft de waarde staan (zelfde localStorage).
    await page.reload();
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    modal = await openInstellingen(page);
    await expect(modal.locator('#set-laatste-start')).toHaveValue('15:00');
  });

  test('laatste start buiten de werktijden wordt geweigerd', async ({ page }) => {
    await startApp(page);
    // Eerst een geldige waarde bewaren, zodat "blijft de oude waarde" iets betekent.
    let modal = await openInstellingen(page);
    await modal.getByLabel('Laatste start (geldt voor iedereen)').fill('15:00');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.getByText('✓ Instellingen opgeslagen voor alle technici')).toBeVisible();

    modal = await openInstellingen(page);
    await modal.locator('#set-van').fill('08:00');
    await modal.locator('#set-tot').fill('17:00');
    await modal.getByLabel('Laatste start (geldt voor iedereen)').fill('23:00');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();

    await expect(page.getByText('⚠ Laatste start moet tussen begin- en eindtijd liggen')).toBeVisible();
    // Het venster blijft open en er is niets bewaard.
    await expect(modal).toBeVisible();
    expect(await leesOpslag(page, 'blitz_laatste_start')).toBe('15:00');

    await modal.getByRole('button', { name: 'Annuleren' }).click();
    await expect(modal).toBeHidden();
    modal = await openInstellingen(page);
    await expect(modal.locator('#set-laatste-start')).toHaveValue('15:00');
  });

  test('instellingen voor één technieker', async ({ page }) => {
    await startApp(page, { technieker: 'Tim' });
    const modal = await openInstellingen(page);
    await expect(modal.locator('#set-person-label')).toHaveText('Instellingen voor: Tim');

    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.getByText('✓ Instellingen opgeslagen voor Tim')).toBeVisible();
    await expect(modal).toBeHidden();
    // Per-technieker sleutel, niet de algemene.
    expect(await leesOpslag(page, 'blitz_settings_Tim')).not.toBeNull();
    expect(await leesOpslag(page, 'blitz_settings')).toBeNull();
  });

  test('rapportwizard loopt tot het voorbeeld zonder te versturen', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim' });

    // #1001 moet ingepland zijn om de knop "Rapport" te tonen.
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
    const resultaat = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
    await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await resultaat.getByRole('button', { name: 'Sluiten' }).click();
    await expect(resultaat).toBeHidden();
    await page.locator('.day-col[data-date="2026-10-05"]').getByRole('button', { name: '#1001', exact: true }).click();
    const detail = page.getByRole('dialog', { name: /Laadpaal offline na stroomuitval/ });
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: '📋 Rapport' }).click();

    const wizard = page.getByRole('dialog', { name: '📋 Service Rapport' });
    const volgende = wizard.getByRole('button', { name: 'Volgende →' });
    const stap = wizard.locator('#wiz-step-label');

    // 1. Algemeen
    await expect(wizard).toHaveClass(/open/);
    await expect(stap).toHaveText('1 / 9 — Algemeen');
    await expect(wizard.getByLabel('Technieker Blitz')).toHaveValue('Tim');
    await wizard.getByRole('radio', { name: 'Interventie' }).check();
    await volgende.click();

    // 2. Facturatie, 3. Product (niets verplicht)
    await expect(stap).toHaveText('2 / 9 — Facturatie');
    await volgende.click();
    await expect(stap).toHaveText('3 / 9 — Product');
    await volgende.click();

    // 4. Omschrijving: zonder oorzaak blokkeert de wizard.
    await expect(stap).toHaveText('4 / 9 — Omschrijving');
    await wizard.getByLabel('Omschrijving probleem').fill('Paal start niet op na stroomuitval');
    await wizard.getByLabel('Ondernomen acties').fill('Voeding gecontroleerd en controller herstart');
    await volgende.click();
    await expect(page.getByText('⚠ Kies minstens één oorzaak.')).toBeVisible();
    await expect(stap).toHaveText('4 / 9 — Omschrijving');
    await wizard.getByText('Productfout', { exact: true }).click();
    await volgende.click();

    // 5. Foto's, 6. Status (geen foto's, geen onderdelen)
    await expect(stap).toHaveText("5 / 9 — Foto's");
    await volgende.click();
    await expect(stap).toHaveText('6 / 9 — Status');
    await wizard.getByLabel('Varia / opmerkingen').fill('Klant heeft uitleg gekregen');
    await volgende.click();

    // 7-8. Handtekeningen zijn niet verplicht (geen validatie in wizSaveSig*).
    await expect(stap).toHaveText('7 / 9 — Handtekening 1');
    await volgende.click();
    await expect(stap).toHaveText('8 / 9 — Handtekening 2');
    await volgende.click();

    // 9. Overzicht: de ingevulde tekst staat erin.
    await expect(stap).toHaveText('9 / 9 — Overzicht');
    await expect(wizard.getByRole('heading', { name: 'Overzicht' })).toBeVisible();
    await expect(wizard).toContainText('Paal start niet op na stroomuitval');
    await expect(wizard).toContainText('Voeding gecontroleerd en controller herstart');
    await expect(wizard).toContainText('Productfout');
    await expect(wizard).toContainText('Interventie');
    await expect(wizard).toContainText('Tim');
    await expect(wizard.getByText('⚠ Handtekening technieker ontbreekt')).toBeVisible();
    // De verzendknop bestaat (laatste stap), maar wordt bewust nooit aangeklikt (W11).
    await expect(wizard.getByRole('button', { name: '✓ Rapport versturen' })).toBeVisible();

    // Positief tegenstuk: de wizard deed wel verzoeken (aanrijtijd, foto's), maar nooit naar de verzendpaden.
    expect(verzoeken.alle.length).toBeGreaterThan(0);
    expect(verzoeken.van('/api/optimize').length).toBeGreaterThan(0);
    expect(verzoeken.van('/api/send-rapport')).toEqual([]);
    expect(verzoeken.van('/api/rapport')).toEqual([]);
    expect(verzoeken.van('/api/rapport-ontvangen')).toEqual([]); // v1.10.2: de outbox verstuurt in één stap naar dit pad
    expect(verzoeken.van('/api/rapport-verzonden')).toEqual([]);
    expect(verzoeken.van('/api/rapport-archief', 'POST')).toEqual([]);
    expect(verzoeken.van('/api/rapport-archief', 'PUT')).toEqual([]);
    // Alle verzoeken naar het archief zijn leesverzoeken (GET).
    expect(verzoeken.van('/api/rapport-archief').filter(r => r.methode !== 'GET')).toEqual([]);
    expect(verzoeken.verboden).toEqual([]);

    // Niets in de verzendwachtrij (IndexedDB-outbox). De store moet bestaan, anders is "0" niets waard.
    const wachtrij = await page.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('blitz-rapport-outbox');
      open.onerror = () => resolve({ bestaat: false, aantal: -1 });
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('items')) { db.close(); return resolve({ bestaat: false, aantal: -1 }); }
        const tel = db.transaction('items').objectStore('items').count();
        tel.onsuccess = () => { db.close(); resolve({ bestaat: true, aantal: tel.result }); };
        tel.onerror = () => { db.close(); resolve({ bestaat: true, aantal: -1 }); };
      };
    }));
    expect(wachtrij.bestaat, 'outbox-store "items" bestaat').toBe(true);
    expect(wachtrij.aantal).toBe(0);
  });

  // B7/C4: lukt de aanrijtijd-berekening niet, dan toont stap Facturatie een melding en laat Volgende enkel door met een ingevulde waarde (0 mag).
  const VERPLICHT = '⚠ Vul de aanrijtijd in (minuten, enkel heen). Typ 0 als er geen aanrijtijd is.';
  const ONBEKEND = '⚠ Aanrijtijd kon niet berekend worden — vul ze hieronder zelf in (minuten, enkel heen). Typ 0 als er geen aanrijtijd is.';

  // De planning (Plan deze week) mag nog normaal rekenen; pas bij het openen van het rapport faalt /api/route (200 zonder benen: geen HTTP-fout in het vangnet).
  async function openWizardTotFacturatie(page, { routeFaalt }) {
    const normaal = standaardStub('route');
    const stand = { faalt: false };
    await startApp(page, { technieker: 'Tim', overschrijf: { route: (o) => (stand.faalt ? { status: 200, json: { legs: [] } } : normaal(o)) } });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
    const resultaat = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
    await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
    await resultaat.getByRole('button', { name: 'Sluiten' }).click();
    await expect(resultaat).toBeHidden();
    await page.locator('.day-col[data-date="2026-10-05"]').getByRole('button', { name: '#1001', exact: true }).click();
    const detail = page.getByRole('dialog', { name: /Laadpaal offline na stroomuitval/ });
    await expect(detail).toBeVisible();
    stand.faalt = routeFaalt;
    await detail.getByRole('button', { name: '📋 Rapport' }).click();
    const wizard = page.getByRole('dialog', { name: '📋 Service Rapport' });
    await expect(wizard).toHaveClass(/open/);
    await wizard.getByRole('radio', { name: 'Interventie' }).check();
    await wizard.getByRole('button', { name: 'Volgende →' }).click();
    await expect(wizard.locator('#wiz-step-label')).toHaveText('2 / 9 — Facturatie');
    return wizard;
  }

  test('aanrijtijd mislukt: de stap Facturatie toont de melding, blokkeert Volgende zonder waarde en laat 0 of een getal toe', async ({ page }) => {
    const wizard = await openWizardTotFacturatie(page, { routeFaalt: true });
    const volgende = wizard.getByRole('button', { name: 'Volgende →' });
    const stap = wizard.locator('#wiz-step-label');
    const veld = wizard.locator('#f-aanrijtijd');

    await expect(wizard.getByRole('alert').filter({ hasText: ONBEKEND })).toBeVisible();
    await expect(veld).toHaveAttribute('aria-invalid', 'true');
    await expect(veld).toHaveValue('');
    await expect(wizard.getByText('📡 TomTom')).toHaveCount(0);

    // Leeg: geblokkeerd met de toast.
    await volgende.click();
    await expect(page.getByText(VERPLICHT)).toBeVisible();
    await expect(stap).toHaveText('2 / 9 — Facturatie');

    // 0 is een geldige invoer; terug en opnieuw: het veld toont dan 0 (geen stille lege waarde).
    await veld.fill('0');
    await volgende.click();
    await expect(stap).toHaveText('3 / 9 — Product');
    await wizard.getByRole('button', { name: '← Vorige' }).click();
    await expect(stap).toHaveText('2 / 9 — Facturatie');
    await expect(veld).toHaveValue('0');
    await expect(wizard.getByRole('alert').filter({ hasText: ONBEKEND })).toHaveCount(0);

    // Een ingevulde waarde komt in het Overzicht.
    await veld.fill('35');
    await volgende.click();
    await expect(stap).toHaveText('3 / 9 — Product');
    await volgende.click();
    await wizard.getByLabel('Omschrijving probleem').fill('Paal start niet op');
    await wizard.getByLabel('Ondernomen acties').fill('Controller herstart');
    await wizard.getByText('Productfout', { exact: true }).click();
    await volgende.click();
    await volgende.click(); // foto's
    await volgende.click(); // status
    await volgende.click(); // handtekening 1
    await volgende.click(); // handtekening 2
    await expect(stap).toHaveText('9 / 9 — Overzicht');
    await expect(wizard).toContainText('35 min');
  });

  test('aanrijtijd gelukt: geen melding en de TomTom-badge staat er', async ({ page }) => {
    const wizard = await openWizardTotFacturatie(page, { routeFaalt: false });
    await expect(wizard.locator('#f-aanrijtijd')).toHaveValue('20'); // stub: 1200 s
    await expect(wizard.getByText('📡 TomTom')).toBeVisible();
    await expect(wizard.getByRole('alert')).toHaveCount(0);
    await expect(wizard.locator('#f-aanrijtijd')).not.toHaveAttribute('aria-invalid', 'true');
    await wizard.getByRole('button', { name: 'Volgende →' }).click();
    await expect(wizard.locator('#wiz-step-label')).toHaveText('3 / 9 — Product');
  });

  // Etappe 5b, taak 6: de wizard leest de actieve technieker uit de toestand (geen stille terugval op 'all' meer).
  // Ticket p1 (#1004) is aan Tim toegewezen: met Roel als actieve persoon moet stap 1 Roel voorselecteren, niet Tim.
  // (Het persoonsfilter verbergt Tim's ticket in de kalender; daarom pas na het openen van het detail op Roel gezet.)
  test('rapportwizard selecteert de actieve technieker voor, niet de toegewezen technieker', async ({ page }) => {
    await startApp(page);
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
    const detail = page.getByRole('dialog', { name: /Energiemeting klopt niet/ });
    await expect(detail).toBeVisible();
    await page.evaluate(() => kern.toestand.set('activeAssigneeFilter', 'Roel'));
    await detail.getByRole('button', { name: '📋 Rapport' }).click();
    const wizard = page.getByRole('dialog', { name: '📋 Service Rapport' });
    await expect(wizard).toHaveClass(/open/);
    await expect(wizard.getByLabel('Technieker Blitz')).toHaveValue('Roel');
  });
});
