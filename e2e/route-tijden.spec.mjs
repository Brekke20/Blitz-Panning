import { test, expect, startApp } from './helpers.mjs';
import { zetStartTijd, maakRouteMetStops, stopNummers, stopTijden } from './route-hulp.mjs';

// Karakterisering (etappe 3, taak 1) van de vier verbruikers van de aankomsttijd-berekening
// (berekenAankomsten): de route-lijst, "📨 Voorstel" op de ticketkaart, "📨 Voorstel" in het
// ticketdetail en het vooraf invullen van het tijdstip bij "📅 Toewijzen". Alle waarden zijn
// gemeten op de code van vóór de verhuizing; de verhuizing mag ze niet wijzigen.
//
// Uitgangspunt (zie route.spec.mjs): vanTijd 10:00, matrix/route 20 min per rit, standaardduur
// van een ticket 120 min. Met route: #1001 om 10:20, #1002 om 12:40. Zonder berekende route valt de
// berekening terug op 30 min per rit: #1001 om 10:30, #1002 om 13:00.

const voorstelVenster = (page) => page.getByRole('dialog', { name: '📨 Afspraakvoorstel' });
const voorstelTijd = (page) => voorstelVenster(page).getByLabel(/^Tijdstip/);

// Leest het tijdstip van het geopende voorstelvenster en annuleert het (nooit versturen).
async function leesEnAnnuleerVoorstel(page) {
  await expect(voorstelVenster(page)).toBeVisible();
  const tijd = await voorstelTijd(page).inputValue();
  await voorstelVenster(page).getByRole('button', { name: 'Annuleren' }).click();
  await expect(voorstelVenster(page)).toBeHidden();
  return tijd;
}

// Opent "📨 Voorstel" van de n-de stopkaart (0-gebaseerd) in de route-lijst.
async function voorstelTijdVanStop(page, n) {
  await page.getByTestId('route-stop').nth(n).getByRole('button', { name: '📨 Voorstel' }).click();
  return leesEnAnnuleerVoorstel(page);
}

// Opent het ticketdetail van `nummer` via de Kalender en klikt "📨 Voorstel".
async function voorstelTijdInDetail(page, nummer) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  // Ingeplande tickets zonder uur staan als chip "#nummer" in de dagkop van de kalender.
  await page.locator('.zu-chip').filter({ hasText: `#${nummer}` }).click();
  const detail = page.getByRole('dialog').filter({ has: page.getByTestId('detail-nummer').filter({ hasText: `#${nummer}` }) });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: '📨 Voorstel' }).click();
  return leesEnAnnuleerVoorstel(page);
}

// "Plan deze week" zonder de Route-tab te openen: er is dan geen berekende route.
async function planWeekZonderRoute(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
  const resultaat = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
  await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
  await resultaat.getByRole('button', { name: 'Sluiten' }).click();
  await expect(resultaat).toBeHidden();
  await expect(page.locator('.day-col').filter({ hasText: '#1001' })).toHaveCount(1);
}

// Opent het wachtrij-paneel "zonder datum", klapt "📅 Toewijzen" van #1005 uit en geeft de kaart terug.
async function openToewijzenRij(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  const paneel = page.locator('#kal-no-date-section');
  if (!(await paneel.evaluate(el => el.classList.contains('open')))) await page.locator('#kal-pending-pill').click();
  const kaart = paneel.locator('.ticket').filter({ hasText: '#1005' });
  await kaart.getByRole('button', { name: '📅 Toewijzen' }).click();
  return kaart;
}

test.describe('getoonde aankomsttijden', () => {
  test('route-lijst: een vast tijdstip springt naar dat uur en de volgende rekent daarvandaan', async ({ page }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    expect(await stopTijden(page)).toEqual(['10:20', '12:40']);

    // #1005 toewijzen voor 5 okt om 11:00 (testmodus: enkel lokaal, niets naar Zoho).
    const kaart = await openToewijzenRij(page);
    await kaart.getByLabel('Tijd toewijzen').fill('11:00');
    await kaart.getByRole('button', { name: '✓ Opslaan' }).click();
    await page.getByRole('tab', { name: 'Route' }).click();
    // Gemeten (R6): planning zit niet in het route-abonnement, dus de lijst toont de nieuwe stop pas na
    // "Bereken tijden". Dit verandert bewust in Taak 3 als planning wordt geabonneerd.
    await expect(page.getByTestId('route-stop')).toHaveCount(2);
    expect(await stopNummers(page)).toEqual(['#1001', '#1002']);
    await page.getByRole('button', { name: 'Bereken tijden' }).click();
    await expect(page.getByTestId('route-aantal-stops')).toHaveText('3');
    // Gemeten: 11:00 (vast) + 120 min standaardduur + 20 min rit = 13:20; daarna nogmaals 120 + 20 = 15:40.
    await expect.poll(() => stopTijden(page)).toEqual(['11:00', '13:20', '15:40']);
    // Het vaste uur staat vooraan (stops zijn op uur gesorteerd, zonder uur achteraan).
    expect(await stopNummers(page)).toEqual(['#1005', '#1001', '#1002']);
  });

  test('📨 Voorstel op de kaart in de route-lijst: afgerond op het volgende kwartier', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    expect(await stopTijden(page)).toEqual(['10:20', '12:40']);

    // Gemeten: 10:20 wordt 10:30, 12:40 wordt 12:45.
    expect(await voorstelTijdVanStop(page, 0)).toBe('10:30');
    expect(await voorstelTijdVanStop(page, 1)).toBe('12:45');
    expect(verzoeken.van('/api/propose')).toEqual([]);
  });

  test('📨 Voorstel in het ticketdetail: met berekende route', async ({ page }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);

    // Gemeten: dezelfde minuten als de route-lijst (10:20 -> 10:30, 12:40 -> 12:45).
    expect(await voorstelTijdInDetail(page, '1001')).toBe('10:30');
    expect(await voorstelTijdInDetail(page, '1002')).toBe('12:45');
  });

  test('📨 Voorstel in het ticketdetail: zonder berekende route (terugval 30 min per rit)', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await planWeekZonderRoute(page);
    expect(verzoeken.van('/api/route')).toEqual([]);

    // Gemeten: legs = null -> 30 min rit: #1001 om 10:30 (blijft 10:30), #1002 om 10:30 + 120 + 30 = 13:00.
    expect(await voorstelTijdInDetail(page, '1001')).toBe('10:30');
    expect(await voorstelTijdInDetail(page, '1002')).toBe('13:00');
  });

  test('📅 Toewijzen: tijdstip vooraf ingevuld, met en zonder berekende route', async ({ page }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await planWeekZonderRoute(page);

    // Zonder berekende route. Gemeten: de datum staat standaard op vandaag (5 okt) en het tijdstip op
    // 09:00: #1005 staat niet in planning[datum], dus computeArrivalTimes heeft geen aankomst voor dit
    // ticket en de terugvalwaarde 09:00 blijft staan.
    let kaart = await openToewijzenRij(page);
    await expect(kaart.getByLabel('Datum toewijzen')).toHaveValue('2026-10-05');
    await expect(kaart.getByLabel('Tijd toewijzen')).toHaveValue('09:00');

    // Met berekende route voor die dag: zelfde uitkomst (een wachtrij-ticket heeft nooit een berekende aankomst).
    await page.getByRole('tab', { name: 'Route' }).click();
    await page.getByRole('button', { name: 'Bereken tijden' }).click();
    await expect.poll(() => stopTijden(page)).toEqual(['10:20', '12:40']);
    kaart = await openToewijzenRij(page);
    await expect(kaart.getByLabel('Datum toewijzen')).toHaveValue('2026-10-05');
    await expect(kaart.getByLabel('Tijd toewijzen')).toHaveValue('09:00');
  });
});
