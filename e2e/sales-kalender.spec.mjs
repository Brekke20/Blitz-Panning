import { test, expect } from './helpers.mjs';
import { startSalesApp, BEHEERDER, SALES_GEBRUIKER } from './sales-hulp.mjs';

// De agenda van de verkoper (Task 16): week en maand, tinten, blokken en de acties op een bezoek.
// Klok: maandag 5 okt 2026 09:00. Alle namen en nummers zijn verzonnen; de stubs zijn de echte server-handlers (testmodus).
const kal = (page) => page.locator('#view-sales-kalender');
const dag = (page, iso) => kal(page).locator(`.day-col[data-date="${iso}"]`);
const venster = (page) => page.locator('.sales-overlay.open');
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const naarKalender = async (page) => { await tab(page, 'Kalender').click(); await expect(kal(page).locator('.day-col[data-date]').first()).toBeVisible(); };

const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
const voorgesteld = (id, naam, datum, start, extra = {}) => lead(id, naam, { status: 'voorgesteld', planning: { datum, start, vast: false }, ...extra });
const bevestigd = (id, naam, datum, start, extra = {}) => lead(id, naam, { status: 'bevestigd', planning: { datum, start, vast: true }, ...extra });
const KANTOOR = { id: 'k1', datum: '2026-10-08', start: '11:00', eind: '12:00', soort: 'kantoor', omschrijving: 'Teamoverleg' };

const zaaien = () => ({
  leads: [voorgesteld('v1', 'Verhaegen', '2026-10-06', '09:00'), bevestigd('b1', 'Peeters', '2026-10-07', '14:00'), lead('t1', 'Tegelaar')],
  blokken: [KANTOOR],
});

test.describe('sales: kalender — week en tinten', () => {
  test('dagkolommen tonen voorgesteld lichter dan bevestigd en het blok gearceerd met 🔒', async ({ page, verzoeken }) => {
    await startSalesApp(page, zaaien());
    await naarKalender(page);
    await expect(kal(page).locator('.day-col[data-date]')).toHaveCount(5); // ma-vr
    const v = dag(page, '2026-10-06').locator('.tl-block.sales-voorgesteld');
    await expect(v).toHaveCount(1);
    await expect(v).toContainText('Test Verhaegen');
    await expect(v).toContainText('09:00–10:00');
    const b = dag(page, '2026-10-07').locator('.tl-block.sales-bevestigd');
    await expect(b).toHaveCount(1);
    await expect(b).toContainText('Test Peeters');
    await expect(dag(page, '2026-10-06').locator('.sales-bevestigd')).toHaveCount(0);
    const blok = dag(page, '2026-10-08').locator('.tl-block.tl-blocked');
    await expect(blok).toContainText('🔒');
    await expect(blok).toContainText('Teamoverleg');
    await expect(kal(page).getByText('Test Tegelaar')).toHaveCount(0); // te plannen staat niet in de agenda
    expect(verzoeken.van('/api/matrix')).toEqual([]);
    expect(verzoeken.van('/api/route')).toEqual([]);
  });

  test('‹ › en Vandaag verschuiven de week; maandweergave toont chips en een klik op een dag opent die week', async ({ page }) => {
    await startSalesApp(page, { leads: [voorgesteld('v1', 'Verhaegen', '2026-10-06', '09:00'), bevestigd('b2', 'Janssen', '2026-10-13', '10:00')], blokken: [] });
    await naarKalender(page);
    await expect(dag(page, '2026-10-06')).toBeVisible();
    await kal(page).getByRole('button', { name: 'Volgende periode' }).click();
    await expect(dag(page, '2026-10-13')).toBeVisible();
    await expect(dag(page, '2026-10-13').locator('.sales-bevestigd')).toContainText('Test Janssen');
    await expect(dag(page, '2026-10-06')).toHaveCount(0);
    await kal(page).getByRole('button', { name: /vandaag/i }).click();
    await expect(dag(page, '2026-10-06')).toBeVisible();

    await kal(page).getByRole('button', { name: 'Maand', exact: true }).click();
    await expect(kal(page).locator('.month-cell')).toHaveCount(42);
    await expect(kal(page).locator('.month-chip', { hasText: 'Test Verhaegen' })).toHaveCount(1);
    await expect(kal(page).locator('.month-chip', { hasText: 'Test Janssen' })).toHaveCount(1);
    await expect(kal(page).locator('.month-chip', { hasText: 'Test Verhaegen' })).toHaveClass(/sales-tint-voorgesteld/);
    await kal(page).locator('.month-cell[data-date="2026-10-13"]').click();
    await expect(dag(page, '2026-10-13')).toBeVisible(); // weekweergave van die dag
    await expect(kal(page).locator('.month-cell')).toHaveCount(0);
  });
});

test.describe('sales: kalender — acties op een bezoek', () => {
  test('Bevestigen maakt het voorgestelde bezoek vast (PATCH status bevestigd, planning.vast)', async ({ page, verzoeken }) => {
    await startSalesApp(page, zaaien());
    await naarKalender(page);
    await dag(page, '2026-10-06').locator('.tl-block.sales-voorgesteld').click();
    await expect(venster(page)).toContainText('Test Verhaegen');
    await venster(page).getByRole('button', { name: 'Bevestigen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(dag(page, '2026-10-06').locator('.tl-block.sales-bevestigd')).toHaveCount(1);
    await expect(dag(page, '2026-10-06').locator('.tl-block.sales-voorgesteld')).toHaveCount(0);
    const patches = verzoeken.van('/api/sales', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body.leads).toEqual([{ id: 'v1', velden: { status: 'bevestigd', planning: { datum: '2026-10-06', start: '09:00', vast: true } } }]);
  });

  test('een bevestigd bezoek heeft geen Bevestigen; Bellen en Navigeren staan er', async ({ page }) => {
    await startSalesApp(page, { leads: [bevestigd('b1', 'Peeters', '2026-10-07', '14:00', { gsm: '32470112233', straat: 'Teststraat', huisnr: '5' })], blokken: [] });
    await naarKalender(page);
    await dag(page, '2026-10-07').locator('.tl-block').click();
    await expect(venster(page).getByRole('button', { name: 'Bevestigen' })).toHaveCount(0);
    await expect(venster(page).locator('a[href="tel:+32470112233"]')).toBeVisible();
    await expect(venster(page).getByRole('button', { name: /Navigeer/ })).toBeVisible();
    await expect(venster(page).getByRole('button', { name: 'Resultaat' })).toBeVisible();
    await expect(venster(page).getByRole('button', { name: 'Terug naar te plannen' })).toBeVisible();
  });

  test('Uur wijzigen opent het detail bij "Vast uur afspreken"; een nieuw uur verplaatst het bezoek (nog bevestigd)', async ({ page }) => {
    await startSalesApp(page, zaaien());
    await naarKalender(page);
    await dag(page, '2026-10-07').locator('.tl-block.sales-bevestigd').click();
    await venster(page).getByRole('button', { name: 'Uur wijzigen' }).click();
    await expect(venster(page).getByRole('heading', { name: 'Vast uur afspreken' })).toBeVisible();
    await expect(venster(page).locator('.sales-vast input[type=date]')).toBeFocused();
    await venster(page).locator('.sales-vast input[type=date]').fill('2026-10-09');
    await venster(page).locator('.sales-vast input[type=time]').fill('15:30');
    await venster(page).locator('.sales-vast').getByRole('button', { name: 'Uur wijzigen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(dag(page, '2026-10-07').locator('.tl-block')).toHaveCount(0);
    const nieuw = dag(page, '2026-10-09').locator('.tl-block.sales-bevestigd');
    await expect(nieuw).toContainText('Test Peeters');
    await expect(nieuw).toContainText('15:30–16:30');
  });

  test('Uur wijzigen op een voorgesteld bezoek legt het vast (bevestigd)', async ({ page }) => {
    await startSalesApp(page, zaaien());
    await naarKalender(page);
    await dag(page, '2026-10-06').locator('.tl-block.sales-voorgesteld').click();
    await venster(page).getByRole('button', { name: 'Uur wijzigen' }).click();
    await venster(page).locator('.sales-vast input[type=date]').fill('2026-10-06');
    await venster(page).locator('.sales-vast input[type=time]').fill('13:00');
    await venster(page).locator('.sales-vast').getByRole('button', { name: /Uur|Vast uur/ }).click();
    await expect(dag(page, '2026-10-06').locator('.tl-block.sales-bevestigd')).toContainText('13:00');
  });

  // Vereist sales-resultaat.js (Task 15, tak refactor-sales): de actie laadt dat venster lazy.
  test('Resultaat: na "Verkocht" verdwijnt het bezoek uit de agenda en staat de lead niet meer in Leads bij Nog in te plannen', async ({ page, verzoeken }) => {
    await startSalesApp(page, zaaien());
    await naarKalender(page);
    await dag(page, '2026-10-07').locator('.tl-block.sales-bevestigd').click();
    await venster(page).getByRole('button', { name: 'Resultaat', exact: true }).click();
    await expect(venster(page)).toContainText('Resultaat — Test Peeters');
    await venster(page).getByLabel('Notitie').fill('Wil een offerte voor de zomer');
    await venster(page).getByRole('button', { name: 'Verkocht', exact: true }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(dag(page, '2026-10-07').locator('.tl-block')).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH')).toHaveLength(1);
    await tab(page, 'Leads').click();
    await expect(page.locator('#view-sales-lijst .sales-kaart', { hasText: 'Test Peeters' })).toHaveCount(0);
  });

  test('Terug naar te plannen: het bezoek verdwijnt uit de agenda en de lead staat in Leads bij Nog in te plannen', async ({ page, verzoeken }) => {
    await startSalesApp(page, zaaien());
    await naarKalender(page);
    await dag(page, '2026-10-07').locator('.tl-block').click();
    await venster(page).getByRole('button', { name: 'Terug naar te plannen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(dag(page, '2026-10-07').locator('.tl-block')).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH')).toHaveLength(1);
    await tab(page, 'Leads').click();
    await expect(page.locator('#view-sales-lijst .sales-kaart', { hasText: 'Test Peeters' })).toBeVisible();
    await expect(page.locator('#view-sales-lijst').getByRole('heading', { name: /Nog in te plannen/ })).toBeVisible();
  });
});

test.describe('sales: kalender — blokken', () => {
  test('Verlof de hele dag op dinsdag: 🔒 in de dagkolom; verwijderen haalt het weg', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [], blokken: [] });
    await naarKalender(page);
    await kal(page).getByRole('button', { name: '➕ Blok', exact: true }).click();
    const v = venster(page);
    await v.getByLabel('Datum').fill('2026-10-06');
    await v.getByLabel('Hele dag').check();
    await expect(v.getByLabel('Van')).toBeDisabled();
    await v.getByLabel('Soort').selectOption('verlof');
    await v.getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toHaveCount(0);
    const banner = dag(page, '2026-10-06').locator('.sales-kal-heledag');
    await expect(banner).toContainText('🔒 Verlof');
    const patches = verzoeken.van('/api/sales', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body.blokken.toevoegen).toEqual([{ datum: '2026-10-06', start: '00:00', eind: '23:59', soort: 'verlof' }]);

    await banner.click();
    await expect(venster(page)).toContainText('Verlof');
    await venster(page).getByRole('button', { name: 'Verwijderen' }).click();
    await expect(dag(page, '2026-10-06').locator('.sales-kal-heledag')).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH')).toHaveLength(2);
  });

  test('een blok met uren en omschrijving; een einde voor het begin geeft een fout in het venster; het +-knopje per dag vult de datum in', async ({ page }) => {
    await startSalesApp(page, { leads: [], blokken: [] });
    await naarKalender(page);
    await dag(page, '2026-10-09').getByRole('button', { name: /Blok toevoegen op/ }).click();
    const v = venster(page);
    await expect(v.getByLabel('Datum')).toHaveValue('2026-10-09');
    await v.getByLabel('Van').fill('14:00');
    await v.getByLabel('Tot').fill('13:00');
    await v.getByRole('button', { name: 'Opslaan' }).click();
    await expect(v.getByRole('alert')).toContainText('einde');
    await v.getByLabel('Tot').fill('15:30');
    await v.getByLabel('Soort').selectOption('afspraak');
    await v.getByLabel('Omschrijving').fill('Tandarts <b>x</b>');
    await v.getByRole('button', { name: 'Opslaan' }).click();
    const blok = dag(page, '2026-10-09').locator('.tl-block.tl-blocked');
    await expect(blok).toContainText('14:00–15:30');
    await expect(blok).toContainText('Tandarts <b>x</b>'); // letterlijke tekst, geen markup
    await expect(blok.locator('b')).toHaveCount(0);
  });
});

test.describe('sales: kalender — gsm en alleen-lezen', () => {
  test('op de gsm: gestapelde kaartjes per dag (geen tijdlijn), Bellen en Navigeren op het kaartje, geen horizontale scroll', async ({ page }) => {
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem('blitz_weergave', 'gsm'); });
    await startSalesApp(page, {
      viewport: { width: 375, height: 812 },
      leads: [
        bevestigd('b1', 'Peeters met een erg lange achternaam die niet in een kaartje past zonder af te breken', '2026-10-07', '14:00', { gsm: '32470112233', straat: 'Teststraat', huisnr: '5' }),
        voorgesteld('v1', 'Verhaegen', '2026-10-07', '09:00'),
      ],
      blokken: [KANTOOR, { id: 'v', datum: '2026-10-06', start: '00:00', eind: '23:59', soort: 'verlof' }],
    });
    await naarKalender(page);
    await expect(kal(page).locator('.tl-wrap')).toHaveCount(0);
    const woensdag = dag(page, '2026-10-07');
    const kaartjes = woensdag.locator('.sales-kal-kaart');
    await expect(kaartjes).toHaveCount(2);
    await expect(kaartjes.nth(0)).toContainText('09:00'); // op uur gesorteerd
    await expect(kaartjes.nth(0)).toHaveClass(/sales-voorgesteld/);
    await expect(kaartjes.nth(1)).toHaveClass(/sales-bevestigd/);
    await expect(kaartjes.nth(1).locator('a[href="tel:+32470112233"]')).toBeVisible();
    await expect(kaartjes.nth(1).getByRole('button', { name: /Navigeer/ })).toBeVisible();
    await expect(dag(page, '2026-10-06').locator('.sales-kal-kaart')).toContainText('🔒 Verlof');
    const breedte = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, venster: window.innerWidth }));
    expect(breedte.doc).toBeLessThanOrEqual(breedte.venster);
    await kaartjes.nth(0).click();
    await expect(venster(page)).toContainText('Test Verhaegen');
  });

  test('een andere verkoper bekijken (magAlleSales): geen ➕ Blok, geen ⚡, geen schrijfknoppen op een bezoek', async ({ page }) => {
    const gebruiker = { ...SALES_GEBRUIKER, magAlleSales: true };
    await startSalesApp(page, { gebruiker, blobs: { 'sales/u-bea': { versie: 1, leads: [voorgesteld('b1', 'Beaklant', '2026-10-06', '09:00', { gsm: '32470112233' })], blokken: [KANTOOR], grafstenen: [] } } });
    await tab(page, 'Kalender').click();
    await kal(page).getByLabel('Verkoper').selectOption('u-bea');
    await expect(dag(page, '2026-10-06').locator('.tl-block.sales-voorgesteld')).toContainText('Test Beaklant');
    await expect(kal(page).getByRole('button', { name: '➕ Blok', exact: true })).toHaveCount(0);
    await expect(kal(page).getByRole('button', { name: /Plan deze week/ })).toHaveCount(0);
    await expect(kal(page).getByRole('button', { name: /Blok toevoegen op/ })).toHaveCount(0);
    await dag(page, '2026-10-06').locator('.tl-block.sales-voorgesteld').click();
    await expect(venster(page)).toContainText('Test Beaklant');
    await expect(venster(page).locator('a[href="tel:+32470112233"]')).toBeVisible();
    await expect(venster(page).getByRole('button', { name: /Bevestigen|Uur wijzigen|Terug naar te plannen|Resultaat/ })).toHaveCount(0);
    await venster(page).getByRole('button', { name: 'Sluiten' }).click();
    await dag(page, '2026-10-08').locator('.tl-block.tl-blocked').click();
    await expect(venster(page).getByRole('button', { name: 'Verwijderen' })).toHaveCount(0);
  });

  test('de beheerder ziet de kalender in het subtab Kalender van de tab Sales', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, leads: [], blobs: { 'sales/u-bea': { versie: 1, leads: [bevestigd('b1', 'Beaklant', '2026-10-06', '09:00')], blokken: [], grafstenen: [] } } });
    await tab(page, 'Sales').click();
    await page.locator('#sales-subtab-sales-kalender').click();
    await expect(kal(page).getByLabel('Verkoper')).toBeVisible();
    await expect(dag(page, '2026-10-06').locator('.sales-bevestigd')).toContainText('Test Beaklant');
    await expect(kal(page).getByRole('button', { name: '➕ Blok', exact: true })).toBeVisible(); // de beheerder schrijft ook
  });
});
