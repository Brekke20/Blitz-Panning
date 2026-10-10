import { test, expect } from './helpers.mjs';
import { startSalesApp, salesStubs, maakSalesBackend, verwachtFout, BEHEERDER, SALES_GEBRUIKER, ANDERE_VERKOPERS } from './sales-hulp.mjs';
// Het export-object van "+ Lead" (zelfde vorm als bouwManueelExport in public/js/sales/manueel.js).
const bouwManueelExport = ({ voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, notitie }) => ({
  bron: 'manueel', verantwoordelijke: null, geexporteerdOp: null, aantal: 1, statussen: [], leads: [{ voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, notitie }],
});

// Een lead manueel toevoegen (Task 14b): knop "+ Lead", minimum naam + (gsm of e-mail) + postcode, samenvoegen met een latere export.
// Alle namen, e-mails en nummers zijn verzonnen; de stubs zijn de echte server-handlers (testmodus: nepcoordinaten).
const OPSLAG_TEKST = 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.';
const lijst = (page) => page.locator('#view-sales-lijst');
const kaart = (page, naam) => lijst(page).locator('.sales-kaart', { hasText: naam });
const venster = (page) => page.locator('.sales-overlay.open');
const plusLead = (page) => lijst(page).getByRole('button', { name: '+ Lead' });

async function vul(page, waarden) {
  for (const [label, tekst] of Object.entries(waarden)) await venster(page).getByLabel(label, { exact: false }).first().fill(tekst);
}

const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});

test.describe('sales: lead manueel toevoegen', () => {
  test('met het minimum: de kaart verschijnt met "zelf toegevoegd", de bron staat in het verzoek en de focus keert terug op "+ Lead"', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await plusLead(page).click();
    await expect(venster(page)).toBeVisible();
    await expect(page.locator('.sales-overlay.open .mhdr-title')).toHaveText('Lead toevoegen');
    await venster(page).getByLabel('Voornaam').fill('Greet');
    await venster(page).getByLabel('Gsm').fill('0470 11 22 33');
    await venster(page).getByLabel('Postcode').fill('3500');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(kaart(page, 'Greet')).toBeVisible();
    await expect(kaart(page, 'Greet')).toContainText('zelf toegevoegd');
    await expect(kaart(page, 'Greet')).toContainText('3500');
    await expect(kaart(page, 'Greet')).toContainText('enkel postcode');
    await expect(page.locator('#toast')).toHaveText('Lead toegevoegd');
    await expect(plusLead(page)).toBeFocused();
    const post = verzoeken.van('/api/sales-import', 'POST');
    expect(post).toHaveLength(1);
    expect(post[0].body.export.bron).toBe('manueel');
    expect(post[0].body.export.leads).toHaveLength(1);
    expect(verzoeken.van('/api/matrix')).toEqual([]);
    expect(verzoeken.van('/api/route')).toEqual([]);
  });

  test('zonder naam, gsm of e-mail en postcode: de drie foutteksten en niets verstuurd', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await plusLead(page).click();
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toContainText('Vul een naam in');
    await expect(venster(page)).toContainText('Vul een gsm-nummer of e-mailadres in');
    await expect(venster(page)).toContainText('Vul een postcode in');
    await expect(venster(page).getByLabel('Voornaam')).toBeFocused(); // naar het eerste ongeldige veld
    expect(verzoeken.van('/api/sales-import')).toEqual([]);

    // een geldige invoer na de fouten: de teksten verdwijnen
    await venster(page).getByLabel('Voornaam').fill('Greet');
    await venster(page).getByLabel('E-mail').fill('greet@voorbeeld.test');
    await venster(page).getByLabel('Postcode').fill('3500');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(kaart(page, 'Greet')).toBeVisible();
  });

  test('een gsm of e-mail die niet klopt wordt gemeld (niet stilzwijgend weggelaten)', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await plusLead(page).click();
    await vul(page, { Voornaam: 'Greet', Postcode: '3500' });
    await venster(page).getByLabel('Gsm').fill('0470 11');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toContainText('Dit gsm-nummer lijkt niet te kloppen');
    expect(verzoeken.van('/api/sales-import')).toEqual([]);
  });

  test('Enter in het laatste veld (de notitie) bewaart; de notitie staat daarna in de fiche en is te bewerken', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await plusLead(page).click();
    await vul(page, { Voornaam: 'Greet', 'E-mail': 'greet@voorbeeld.test', Postcode: '3500', Gemeente: 'Hasselt' });
    await venster(page).getByLabel('Notitie').fill('Bel na vijf uur');
    await page.keyboard.press('Enter');
    await expect(venster(page)).toHaveCount(0);
    await expect(kaart(page, 'Greet')).toContainText('Hasselt (3500)');
    expect(verzoeken.van('/api/sales-import', 'POST')[0].body.export.leads[0].notitie).toBe('Bel na vijf uur');

    await kaart(page, 'Greet').locator('.sales-kaart-titel').click();
    await expect(venster(page).getByLabel('Notitie')).toHaveValue('Bel na vijf uur');
    await venster(page).getByLabel('Notitie').fill('Liever per mail');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH').at(-1).body.leads[0].velden).toEqual({ notitie: 'Liever per mail' });
  });

  test('met straat en huisnummer: een volledig adres', async ({ page }) => {
    await startSalesApp(page);
    await plusLead(page).click();
    await vul(page, { Voornaam: 'Greet', Gsm: '0470 11 22 33', Postcode: '2830', Gemeente: 'Willebroek', Straat: 'Teststraat', Huisnr: '5' });
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(kaart(page, 'Greet')).toContainText('volledig adres');
  });

  test('een klant die al in de lijst staat: melding, de bestaande fiche opent en er komt niets dubbel bij', async ({ page }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen', { gsm: '32470112233' })] });
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await plusLead(page).click();
    await vul(page, { Voornaam: 'Greetje', Gsm: '+32 470 11 22 33', Postcode: '3500' });
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toHaveText('Deze klant staat al in je lijst');
    // de fiche van de bestaande lead is open (de titel is zijn naam), de lijst telt nog één kaart
    await expect(page.locator('.sales-overlay.open .mhdr-title')).toHaveText('Test Verhaegen');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
  });

  test('een eerder verwijderde klant komt terug met het label "eerder verwijderd"', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    const voegToe = async () => {
      await plusLead(page).click();
      await vul(page, { Voornaam: 'Greet', 'E-mail': 'greet@voorbeeld.test', Postcode: '3500' });
      await venster(page).getByRole('button', { name: 'Opslaan' }).click();
      await expect(venster(page)).toHaveCount(0);
    };
    await voegToe();
    await kaart(page, 'Greet').getByRole('button', { name: /Verwijder/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Verwijderen' }).click();
    await page.clock.runFor(5000);
    await expect.poll(() => verzoeken.van('/api/sales', 'DELETE').length).toBe(1);
    await expect(kaart(page, 'Greet')).toHaveCount(0);
    await voegToe();
    await expect(page.locator('#toast')).toContainText('eerder verwijderd');
    await expect(kaart(page, 'Greet').locator('.sales-chip-eerder')).toHaveText('eerder verwijderd');
    await expect(kaart(page, 'Greet')).toContainText('zelf toegevoegd');
  });

  test('een latere export met dezelfde persoon voegt samen: één lead, lege velden aangevuld, het eigen blijft', async ({ page }) => {
    await startSalesApp(page);
    await plusLead(page).click();
    await vul(page, { Voornaam: 'Greet', 'E-mail': 'greet@voorbeeld.test', Postcode: '3500' });
    await venster(page).getByLabel('Notitie').fill('Eigen notitie');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(kaart(page, 'Greet')).toBeVisible();

    const exp = { geexporteerdOp: '2026-10-08T08:00:00.000Z', verantwoordelijke: 'Test Verkoper', statussen: ['Nieuw'], aantal: 1,
      leads: [{ voornaam: 'Greta', naam: 'Peeters', gsm: '0470 11 22 33', email: 'greet@voorbeeld.test', adres: 'Dorpsstraat 12, 3500 Hasselt' }] };
    await lijst(page).locator('input[type=file]').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exp)) });
    await expect(lijst(page).locator('.sales-melding')).toContainText('0 nieuw, 1 al aanwezig');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await expect(kaart(page, 'Greet Peeters')).toBeVisible();          // naam aangevuld, voornaam blijft "Greet"
    await expect(kaart(page, 'Greet Peeters')).toContainText('zelf toegevoegd');
    await kaart(page, 'Greet Peeters').locator('.sales-kaart-titel').click();
    await expect(venster(page).getByLabel('Notitie')).toHaveValue('Eigen notitie');
    await expect(venster(page).getByLabel('Straat')).toHaveValue('Dorpsstraat');
  });

  test('een 503 opslag-storing: de melding in het venster, het venster blijft open met de invoer', async ({ page, consoleFouten }) => {
    const echte = salesStubs();
    const overschrijf = { 'sales-import': async () => ({ status: 503, json: { error: OPSLAG_TEKST, code: 'opslag-storing' } }) };
    await startSalesApp(page, { overschrijf: { sales: echte.sales, instellingen: echte.instellingen, gebruikers: echte.gebruikers, ...overschrijf } });
    await plusLead(page).click();
    await vul(page, { Voornaam: 'Greet', Gsm: '0470 11 22 33', Postcode: '3500' });
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page).locator('.sales-venster-fout')).toHaveText(OPSLAG_TEKST);
    await expect(venster(page).getByLabel('Voornaam')).toHaveValue('Greet');
    await expect(page.locator('#login-overlay')).toHaveCount(0);
    await verwachtFout(consoleFouten, '/api/sales-import', 503);
  });

  test('Annuleren en Escape sluiten zonder iets te bewaren; de focus keert terug op "+ Lead"', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await plusLead(page).click();
    await vul(page, { Voornaam: 'Greet' });
    await venster(page).getByRole('button', { name: 'Annuleren' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(plusLead(page)).toBeFocused();
    await plusLead(page).click();
    await expect(venster(page).getByLabel('Voornaam')).toHaveValue(''); // een nieuw, leeg formulier
    await page.keyboard.press('Escape');
    await expect(venster(page)).toHaveCount(0);
    expect(verzoeken.van('/api/sales-import')).toEqual([]);
  });

  test('de weergave van een andere verkoper (sales met "mag alle sales zien") krijgt geen knop "+ Lead"', async ({ page }) => {
    await startSalesApp(page, { gebruiker: { ...SALES_GEBRUIKER, magAlleSales: true }, blobs: { 'sales/u-bea': { versie: 1, leads: [lead('b1', 'Beaklant')], blokken: [], grafstenen: [] } } });
    await expect(plusLead(page)).toBeVisible(); // eerst de eigen leads
    await lijst(page).getByLabel('Verkoper').selectOption('u-bea');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await expect(plusLead(page)).toHaveCount(0);
  });

  test('de beheerder krijgt "+ Lead" (niet "Export laden") voor de gekozen verkoper; niet bij een geblokkeerde verkoper', async ({ page }) => {
    const geblokkeerd = { id: 'u-aad', email: 'aad@test.be', naam: 'Aad Verkoper', rol: 'sales', salesNaam: 'Aad V.', magAlleSales: false, actief: false };
    await startSalesApp(page, { gebruiker: BEHEERDER, verkopers: [geblokkeerd, ...ANDERE_VERKOPERS], blobs: { 'sales/u-bea': { versie: 1, leads: [lead('b1', 'Beaklant')], blokken: [], grafstenen: [] } } });
    await page.getByRole('tab', { name: 'Sales', exact: true }).click();
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await expect(plusLead(page)).toBeVisible();
    await expect(lijst(page).getByRole('button', { name: 'Export laden' })).toHaveCount(0);
    await lijst(page).getByLabel('Verkoper').selectOption('u-aad');
    await expect(lijst(page).locator('.sales-alleen-lezen')).toBeVisible();
    await expect(plusLead(page)).toHaveCount(0);
    await lijst(page).getByLabel('Verkoper').selectOption('u-carl');
    await expect(plusLead(page)).toBeVisible();
  });

  test('de beheerder voegt een lead toe voor de gekozen verkoper: de kaart verschijnt, het blob van die verkoper bevat hem, dat van de beheerder niet', async ({ page, verzoeken }) => {
    const backend = await startSalesApp(page, { gebruiker: BEHEERDER });
    await page.getByRole('tab', { name: 'Sales', exact: true }).click();
    await lijst(page).getByLabel('Verkoper').selectOption('u-carl');
    await expect(plusLead(page)).toBeVisible();
    await plusLead(page).click();
    await venster(page).getByLabel('Voornaam').fill('Greet');
    await venster(page).getByLabel('Gsm').fill('0470 11 22 33');
    await venster(page).getByLabel('Postcode').fill('3500');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(kaart(page, 'Greet')).toBeVisible();
    await expect(kaart(page, 'Greet')).toContainText('zelf toegevoegd');
    await expect(page.locator('#toast')).toHaveText('Lead toegevoegd');
    expect(verzoeken.van('/api/sales-import', 'POST')).toHaveLength(1);
    const blobCarl = JSON.parse(backend.test._data.get('sales/u-carl'));
    expect(blobCarl.leads).toHaveLength(1);
    expect(blobCarl.leads[0].voornaam).toBe('Greet');
    expect(backend.test._data.get('sales/u-test')).toBeUndefined(); // de beheerder zelf heeft geen blob
    // een andere verkoper blijft leeg
    await lijst(page).getByLabel('Verkoper').selectOption('u-bea');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(0);
  });

  test('de verkoper ziet de lead die de beheerder voor hem toevoegde (echte handler, daarna de app als die verkoper)', async ({ page }) => {
    const carl = ANDERE_VERKOPERS.find(v => v.id === 'u-carl');
    const door = maakSalesBackend({ gebruiker: BEHEERDER });
    const r = await door.stubs['sales-import']({
      methode: 'POST', pad: '/api/sales-import', query: new URLSearchParams('gebruiker=u-carl'),
      body: { export: bouwManueelExport({ voornaam: 'Greet', naam: 'Peeters', gsm: '0470 11 22 33', email: null, postcode: '3500', gemeente: null, straat: null, huisnr: null, notitie: null }) },
    });
    expect(r.status).toBe(200);
    const blobCarl = JSON.parse(door.test._data.get('sales/u-carl'));
    await startSalesApp(page, { gebruiker: carl, blobs: { 'sales/u-carl': blobCarl } });
    await expect(kaart(page, 'Greet Peeters')).toBeVisible();
    await expect(kaart(page, 'Greet Peeters')).toContainText('zelf toegevoegd');
  });

  test('een verkoper kan niet voor een andere verkoper toevoegen (403 van de echte handler, niets geschreven); voor zichzelf wel', async ({ page, consoleFouten }) => {
    const backend = await startSalesApp(page);
    const post = (pad, body) => page.evaluate(async ([p, b]) => {
      const res = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-blitz': '1' }, body: JSON.stringify(b) });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, [pad, body]);
    const manueel = bouwManueelExport({ voornaam: 'Greet', naam: null, gsm: '0470 11 22 33', email: null, postcode: '3500', gemeente: null, straat: null, huisnr: null, notitie: null });
    const ander = await post('/api/sales-import?gebruiker=u-bea', { export: manueel });
    expect(ander.status).toBe(403);
    expect(ander.body.code).toBe('geen-recht');
    expect(backend.test._data.get('sales/u-bea')).toBeUndefined();
    await verwachtFout(consoleFouten, '/api/sales-import', 403);
    expect((await post('/api/sales-import', { export: manueel })).status).toBe(200);
  });

  test('op telefoonbreedte past het venster zonder horizontale scroll en blijft Opslaan bereikbaar', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await startSalesApp(page, { viewport: { width: 375, height: 667 } });
    await plusLead(page).click();
    await expect(venster(page)).toBeVisible();
    const b = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, venster: window.innerWidth, modal: document.querySelector('.sales-overlay.open .modal').scrollWidth, modalBreed: document.querySelector('.sales-overlay.open .modal').clientWidth }));
    expect(b.doc).toBeLessThanOrEqual(b.venster);
    expect(b.modal).toBeLessThanOrEqual(b.modalBreed);
    await venster(page).getByRole('button', { name: 'Opslaan' }).scrollIntoViewIfNeeded();
    await expect(venster(page).getByRole('button', { name: 'Opslaan' })).toBeVisible();
  });
});
