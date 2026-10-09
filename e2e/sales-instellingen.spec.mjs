import { test, expect } from './helpers.mjs';
import { startSalesApp, salesStubs, verwachtFout, BEHEERDER, SALES_GEBRUIKER, ANDERE_VERKOPERS } from './sales-hulp.mjs';

// Het instellingenvenster van de verkoper (Task 13b). De stubs zijn de echte server-handlers (instellingen, sales) met een in-memory store.
// Verzonnen waarden; geen echte adressen van personen.
const OPSLAG_TEKST = 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.';
const venster = (page) => page.locator('.sales-overlay.open');
const lijst = (page) => page.locator('#view-sales-lijst');
const knop = (page) => lijst(page).getByRole('button', { name: '⚙ Instellingen' });

const lead = (id, naam) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null },
});

async function vul(page, { startadres, van, tot, laatste, duur }) {
  const v = venster(page);
  if (startadres !== undefined) await v.getByLabel('Startadres').fill(startadres);
  if (van !== undefined) await v.getByLabel('Werkuren van').fill(van);
  if (tot !== undefined) await v.getByLabel('Werkuren tot').fill(tot);
  if (laatste !== undefined) await v.getByLabel('Laatste start').fill(laatste);
  if (duur !== undefined) await v.getByLabel('Standaard bezoekduur (min)').fill(duur);
}

const toestandInstellingen = (page) => page.evaluate(() => import('/js/schermen/sales-data.js').then(m => m.salesToestand().instellingen));

test.describe('sales: instellingenvenster', () => {
  // De sales-schermen gebruiken Leaflet en handtekening niet: de CDN-scripts van index.html krijgen een leeg antwoord (een page-route gaat voor de
// context-routes van startApp). Zo hangt een trage of geblokkeerde CDN de test niet op en blijft het vangnet (consolefouten) schoon.
  test.beforeEach(async ({ page }) => {
    await page.route(/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//, (route) => route.fulfill({
      status: 200, contentType: route.request().url().endsWith('.css') ? 'text/css' : 'application/javascript', body: '/* stub */',
    }));
  });

  test('opent met de huidige waarden (standaard: 08:00 / 17:00 / 16:00 / 60, leeg startadres) en Annuleren sluit zonder verzoek', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')] });
    await knop(page).click();
    await expect(page.locator('.sales-overlay.open .mhdr-title')).toHaveText('Instellingen');
    await expect(venster(page).getByLabel('Startadres')).toHaveValue('');
    await expect(venster(page)).toContainText('enkel een postcode');
    await expect(venster(page).getByLabel('Werkuren van')).toHaveValue('08:00');
    await expect(venster(page).getByLabel('Werkuren tot')).toHaveValue('17:00');
    await expect(venster(page).getByLabel('Laatste start')).toHaveValue('16:00');
    await expect(venster(page).getByLabel('Standaard bezoekduur (min)')).toHaveValue('60');
    await venster(page).getByRole('button', { name: 'Annuleren' }).click();
    await expect(venster(page)).toHaveCount(0);
    expect(verzoeken.van('/api/instellingen', 'PUT')).toEqual([]);
  });

  test('bewaren: één PUT zonder gebruiker (met X-Blitz), toast, de toestand volgt en een herstart toont de bewaarde waarden', async ({ page, verzoeken }) => {
    const headers = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/api/instellingen')) headers.push(r.headers()); });
    const backend = await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')] });
    await knop(page).click();
    await vul(page, { startadres: '3640', van: '09:00', tot: '16:00', laatste: '15:00', duur: '45' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(page.locator('#toast')).toHaveText('Instellingen bewaard');

    const puts = verzoeken.van('/api/instellingen', 'PUT');
    expect(puts).toHaveLength(1);
    expect(Object.keys(puts[0].body)).toEqual(['instellingen']);               // geen `gebruiker`: de eigen instellingen
    expect(puts[0].body.instellingen).toMatchObject({ startlocatie: '3640', vanTijd: '09:00', totTijd: '16:00', laatsteStart: '15:00', bezoekDuurMin: 45 });
    expect(headers).toHaveLength(1);
    expect(headers[0]['x-blitz']).toBe('1');

    // de toestand die "Plan deze week" leest: eerste start 09:00, duur 45
    await expect.poll(() => toestandInstellingen(page)).toMatchObject({ vanTijd: '09:00', totTijd: '16:00', laatsteStart: '15:00', bezoekDuurMin: 45, startlocatie: '3640' });
    // na het bewaren leest de client de serverstand opnieuw (T10-punt): één GET extra
    await expect.poll(() => verzoeken.van('/api/instellingen', 'GET').length).toBeGreaterThanOrEqual(2);
    // bewaard in de store van de server
    const opgeslagen = await backend.test.get('instellingen', { type: 'json' });
    expect(opgeslagen.perGebruiker['u-test']).toMatchObject({ vanTijd: '09:00', bezoekDuurMin: 45, startlocatie: '3640' });

    // opnieuw laden: het venster toont de bewaarde waarden
    await page.reload();
    await expect(knop(page)).toBeVisible();
    await knop(page).click();
    await expect(venster(page).getByLabel('Startadres')).toHaveValue('3640');
    await expect(venster(page).getByLabel('Werkuren van')).toHaveValue('09:00');
    await expect(venster(page).getByLabel('Standaard bezoekduur (min)')).toHaveValue('45');
  });

  test('een eerder bewaarde kaartStijl en werkdagen zitten nog in de PUT-body; een leeggemaakt startadres wordt niet meer bewaard', async ({ page, verzoeken }) => {
    await startSalesApp(page, {
      leads: [lead('l1', 'Verhaegen')],
      instellingen: { kaartStijl: 'donker', werkdagen: [1, 2, 3], startlocatie: 'Dorpsstraat 12, 3640 Kinrooi', bezoekDuurMin: 90 },
    });
    await knop(page).click();
    await expect(venster(page).getByLabel('Startadres')).toHaveValue('Dorpsstraat 12, 3640 Kinrooi');
    await expect(venster(page).getByLabel('Standaard bezoekduur (min)')).toHaveValue('90');
    await vul(page, { startadres: '', duur: '' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).click();
    await expect(venster(page)).toHaveCount(0);
    const body = verzoeken.van('/api/instellingen', 'PUT')[0].body.instellingen;
    expect(body.kaartStijl).toBe('donker');
    expect(body.werkdagen).toEqual([1, 2, 3]);
    expect('startlocatie' in body).toBe(false);
    expect('bezoekDuurMin' in body).toBe(false);
    await expect.poll(() => toestandInstellingen(page)).toMatchObject({ bezoekDuurMin: 60, vanTijd: '08:00' }); // terug op de standaard
  });

  test('ongeldige invoer: de fouttekst staat in het venster en er gaat geen verzoek uit', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')] });
    await knop(page).click();
    await vul(page, { van: '17:00', tot: '09:00' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).click();
    await expect(venster(page).locator('.sales-venster-fout')).toHaveText('⚠ Begintijd moet voor eindtijd liggen');
    await vul(page, { van: '08:00', tot: '17:00', duur: '4' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).click();
    await expect(venster(page).locator('.sales-venster-fout')).toHaveText('⚠ Bezoekduur moet tussen 5 en 480 minuten liggen');
    await vul(page, { duur: 'abc' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).click();
    await expect(venster(page).locator('.sales-venster-fout')).toHaveText('⚠ Bezoekduur moet tussen 5 en 480 minuten liggen');
    await vul(page, { duur: '60', laatste: '18:00' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).click();
    await expect(venster(page).locator('.sales-venster-fout')).toHaveText('⚠ Laatste start moet tussen begin- en eindtijd liggen');
    await expect(venster(page)).toBeVisible();
    expect(verzoeken.van('/api/instellingen', 'PUT')).toEqual([]);
    // daarna een geldige invoer: de fout verdwijnt en het bewaart
    await vul(page, { laatste: '16:00' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).click();
    await expect(venster(page)).toHaveCount(0);
    expect(verzoeken.van('/api/instellingen', 'PUT')).toHaveLength(1);
  });

  test('een 503 opslag-storing: opslagmelding in het venster, het venster blijft open met de invoer, Bewaren is weer bruikbaar', async ({ page, consoleFouten }) => {
    const echte = salesStubs({ leads: [lead('l1', 'Verhaegen')] });
    const instellingen = async (z) => (z.methode === 'PUT' ? { status: 503, json: { error: OPSLAG_TEKST, code: 'opslag-storing' } } : echte.instellingen(z));
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')], overschrijf: { instellingen } });
    await knop(page).click();
    await vul(page, { duur: '45' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).click();
    await expect(venster(page).locator('.sales-venster-fout')).toHaveText(OPSLAG_TEKST);
    await expect(venster(page).getByLabel('Standaard bezoekduur (min)')).toHaveValue('45');
    await expect(venster(page).getByRole('button', { name: 'Bewaren' })).toBeEnabled();
    await expect(page.locator('#login-overlay')).toHaveCount(0);
    expect((await toestandInstellingen(page)).bezoekDuurMin).toBe(60); // niets overgenomen
    await verwachtFout(consoleFouten, '/api/instellingen', 503);
  });

  for (const [status, tekst] of [[400, '⚠ Ongeldige instellingen.'], [403, 'Je hebt hier geen toegang toe.']]) {
    test(`een ${status} van de server: de tekst van de server staat in het venster, dat open blijft`, async ({ page, consoleFouten }) => {
      const echte = salesStubs({ leads: [lead('l1', 'Verhaegen')] });
      const instellingen = async (z) => (z.methode === 'PUT' ? { status, json: { error: tekst, ...(status === 403 ? { code: 'geen-recht' } : {}) } } : echte.instellingen(z));
      await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')], overschrijf: { instellingen } });
      await knop(page).click();
      await venster(page).getByRole('button', { name: 'Bewaren' }).click();
      await expect(venster(page).locator('.sales-venster-fout')).toHaveText(tekst);
      await expect(venster(page)).toBeVisible();
      await verwachtFout(consoleFouten, '/api/instellingen', status);
    });
  }

  // Eindreview I1: een mislukte lading mag nooit tot een formulier met standaarden (en dus een overschreven serverobject) leiden.
  test('I1: de instellingen laden niet (503): melding i.p.v. formulier, geen Bewaren en geen PUT; "Opnieuw proberen" opent daarna het echte formulier en PUT behoudt de onbekende velden', async ({ page, verzoeken, consoleFouten }) => {
    const bewaard = { kaartStijl: 'donker', werkdagen: [1, 2, 3], startlocatie: 'Dorpsstraat 12, 3640 Kinrooi', vanTijd: '09:00', totTijd: '15:00', maxPerDag: 4, maxReistijdMin: 50 };
    const echte = salesStubs({ leads: [lead('l1', 'Verhaegen')], instellingen: bewaard });
    let stuk = true;
    const instellingen = async (z) => (z.methode === 'GET' && stuk ? { status: 503, json: { error: OPSLAG_TEKST, code: 'opslag-storing' } } : echte.instellingen(z));
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')], instellingen: bewaard, overschrijf: { instellingen } });
    await knop(page).click();
    await expect(venster(page).locator('.sales-venster-fout')).toContainText('konden niet geladen worden');
    await expect(venster(page).getByRole('button', { name: 'Bewaren' })).toHaveCount(0);
    await expect(venster(page).getByLabel('Startadres')).toHaveCount(0);
    // Opnieuw proberen terwijl het nog stuk is: de melding blijft, er is niets bewaard.
    await venster(page).getByRole('button', { name: 'Opnieuw proberen' }).click();
    await expect(venster(page).locator('.sales-venster-fout')).toContainText('konden niet geladen worden');
    expect(verzoeken.van('/api/instellingen', 'PUT')).toEqual([]);
    // Hersteld: opnieuw proberen opent het formulier met de ECHTE waarden (niet 08:00-17:00).
    stuk = false;
    await venster(page).getByRole('button', { name: 'Opnieuw proberen' }).click();
    await expect(venster(page).getByLabel('Werkuren van')).toHaveValue('09:00');
    await expect(venster(page).getByLabel('Werkuren tot')).toHaveValue('15:00');
    await expect(venster(page).getByLabel('Startadres')).toHaveValue('Dorpsstraat 12, 3640 Kinrooi');
    await vul(page, { duur: '45' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).click();
    await expect(venster(page)).toHaveCount(0);
    const puts = verzoeken.van('/api/instellingen', 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].body.instellingen).toMatchObject({ kaartStijl: 'donker', werkdagen: [1, 2, 3], maxPerDag: 4, maxReistijdMin: 50, vanTijd: '09:00', totTijd: '15:00', bezoekDuurMin: 45 });
    await verwachtFout(consoleFouten, '/api/instellingen', 503);
  });

  test('dubbelklik op Bewaren: precies één PUT', async ({ page, verzoeken }) => {
    const echte = salesStubs({ leads: [lead('l1', 'Verhaegen')] });
    const instellingen = async (z) => {
      if (z.methode === 'PUT') await new Promise(r => setTimeout(r, 400));
      return echte.instellingen(z);
    };
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')], overschrijf: { instellingen } });
    await knop(page).click();
    await vul(page, { duur: '45' });
    await venster(page).getByRole('button', { name: 'Bewaren' }).dblclick();
    await expect(venster(page)).toHaveCount(0);
    expect(verzoeken.van('/api/instellingen', 'PUT')).toHaveLength(1);
  });

  test('de knop staat in elk sales-scherm van de verkoper (balk)', async ({ page }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')] });
    await expect(knop(page)).toBeVisible();
    await page.getByRole('tab', { name: 'Afgewerkt', exact: true }).click();
    await expect(page.locator('#view-sales-afgewerkt').getByRole('button', { name: '⚙ Instellingen' })).toBeVisible();
  });

  test('een verkoper met "alle sales" ziet de knop bij de eigen leads, niet bij de weergave van een collega', async ({ page }) => {
    const ik = { ...SALES_GEBRUIKER, magAlleSales: true };
    await startSalesApp(page, { gebruiker: ik, leads: [lead('l1', 'Verhaegen')],
      blobs: { [`sales/${ANDERE_VERKOPERS[0].id}`]: { versie: 1, leads: [lead('l2', 'Maes')], blokken: [], grafstenen: [] } } });
    await expect(knop(page)).toBeVisible();
    await lijst(page).locator('.sales-verkoper-keuze').selectOption(ANDERE_VERKOPERS[0].id);
    await expect(lijst(page).locator('.sales-kaart', { hasText: 'Maes' })).toBeVisible();
    await expect(knop(page)).toBeHidden();
    await lijst(page).locator('.sales-verkoper-keuze').selectOption(ik.id);
    await expect(lijst(page).locator('.sales-kaart', { hasText: 'Verhaegen' })).toBeVisible();
    await expect(knop(page)).toBeVisible();
  });

  test('telefoonbreedte: geen horizontale scroll in het venster en op de pagina', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')], instellingen: { startlocatie: 'Een-heel-lange-straatnaam-zonder-spaties '.repeat(4).trim() } });
    await knop(page).click();
    await expect(venster(page).getByLabel('Startadres')).toBeVisible();
    const overloop = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overloop).toBeLessThanOrEqual(0);
    const modal = await venster(page).locator('.sales-venster-body').evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(modal).toBeLessThanOrEqual(0);
  });
});

// De beheerder gebruikt de volledige app (met kaart): daar blijft de CDN-stub weg.
test.describe('sales: instellingenvenster voor de beheerder', () => {
  test('als beheerder is er geen knop (Beheer > Instellingen)', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER });
    await page.getByRole('tab', { name: 'Sales', exact: true }).click();
    await expect(page.locator('#view-sales .sales-verkoper-keuze')).toBeVisible();
    await expect(page.getByRole('button', { name: '⚙ Instellingen' })).toHaveCount(0);
  });
});
