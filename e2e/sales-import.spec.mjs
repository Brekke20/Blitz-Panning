import { test, expect } from './helpers.mjs';
import { startSalesApp, salesStubs, verwachtFout, BEHEERDER, SALES_GEBRUIKER } from './sales-hulp.mjs';

// Het scherm "Te plannen" (Task 14): export laden, kaartjes, verwijderen met ongedaan maken en het leaddetail.
// Alle namen, e-mails en nummers zijn verzonnen. De stubs zijn de echte server-handlers met een in-memory store (testmodus: nepcoordinaten).
const OPSLAG_TEKST = 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.';
const lijst = (page) => page.locator('#view-sales-lijst');
const kaart = (page, naam) => lijst(page).locator('.sales-kaart', { hasText: naam });
const kaartTitel = (page, naam) => kaart(page, naam).locator('.sales-kaart-titel');
const melding = (page) => lijst(page).locator('.sales-melding');
const venster = (page) => page.locator('.sales-overlay.open');

const exportBestand = (extra = {}) => ({
  geexporteerdOp: '2026-10-08T08:00:00.000Z',
  verantwoordelijke: 'Test Verkoper',
  statussen: ['Nieuw', '1e contactpoging gedaan'],
  aantal: 6,
  leads: [
    { naam: 'Verzonnen', voornaam: 'Annelies', gsm: '+32 470 11 22 33', email: 'annelies@voorbeeld.test', adres: '3640' },
    { naam: 'Bedacht', voornaam: 'Boris', gsm: '0478 44 55 66', email: 'boris@voorbeeld.test', adres: 'Teststraat 5, 2830 Willebroek' },
    { naam: 'Fictief', voornaam: 'Carla', gsm: '+32000000', email: 'carla@voorbeeld.test', adres: 'bij de oude molen' },
    { naam: 'Nagemaakt', voornaam: 'Dirk', gsm: '0499 77 88 99', adres: '9000' },
    { naam: 'Gespeeld', voornaam: 'Els', email: 'els@voorbeeld.test', adres: '2000' },
    { naam: 'Proef', voornaam: 'Fons', adres: '3500' },
  ],
  ...extra,
});
const eenLead = (extra = {}) => exportBestand({ aantal: 1, leads: [{ naam: 'Enkelvoudig', voornaam: 'Greet', email: 'greet@voorbeeld.test', adres: '3500' }], ...extra });

const laad = (page, inhoud, naam = 'export.json') => lijst(page).locator('input[type=file]').setInputFiles({
  name: naam, mimeType: 'application/json', buffer: Buffer.from(typeof inhoud === 'string' ? inhoud : JSON.stringify(inhoud)),
});

const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});

test.describe('sales: Te plannen — export laden', () => {
  test('(a) export laden: samenvatting, kaartjes met adreslabels, geen kaart- of routeverzoeken; nogmaals laden voegt niets toe', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await expect(lijst(page).getByRole('button', { name: 'Export laden' })).toBeVisible();
    await laad(page, exportBestand());
    await expect(melding(page)).toContainText('6 nieuw, 0 al aanwezig, 1 adres nakijken');
    await expect(melding(page)).not.toContainText('eerder verwijderd');
    await expect(melding(page)).toContainText('Export van Test Verkoper');
    await expect(melding(page)).toContainText('6 leads');
    await expect(melding(page)).toContainText('Nieuw, 1e contactpoging gedaan');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(6);
    await expect(lijst(page).getByRole('heading', { name: /Nog in te plannen/ })).toBeVisible();
    await expect(kaart(page, 'Annelies Verzonnen')).toContainText('enkel postcode');
    await expect(kaart(page, 'Annelies Verzonnen')).toContainText('3640');
    await expect(kaart(page, 'Boris Bedacht')).toContainText('volledig adres');
    await expect(kaart(page, 'Carla Fictief')).toContainText('adres nakijken');
    await expect(kaart(page, 'Annelies Verzonnen').locator('a[href^="tel:"]')).toHaveAttribute('href', 'tel:+32470112233');
    await expect(kaart(page, 'Carla Fictief').locator('a[href^="tel:"]')).toHaveCount(0); // placeholder-gsm
    expect(verzoeken.van('/api/sales-import', 'POST')).toHaveLength(1);
    expect(verzoeken.van('/api/matrix')).toEqual([]);
    expect(verzoeken.van('/api/route')).toEqual([]);

    await laad(page, exportBestand());
    await expect(melding(page)).toContainText('0 nieuw, 6 al aanwezig');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(6);
  });

  test('(b) export van een andere verantwoordelijke: eerst een vraag; Terug bewaart niets, Toch inladen wel', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await laad(page, eenLead({ verantwoordelijke: 'Andere Verkoper' }));
    const dialoog = page.getByRole('alertdialog');
    await expect(dialoog).toContainText('Deze export is van Andere Verkoper. Toch inladen?');
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(dialoog).toHaveCount(0);
    expect(verzoeken.van('/api/sales-import')).toEqual([]);
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(0);

    await laad(page, eenLead({ verantwoordelijke: 'Andere Verkoper' }));
    await page.getByRole('alertdialog').getByRole('button', { name: 'Toch inladen' }).click();
    await expect(melding(page)).toContainText('1 nieuw, 0 al aanwezig');
    expect(verzoeken.van('/api/sales-import', 'POST')).toHaveLength(1);
  });

  test('(c) kapotte JSON geeft een foutmelding; een naam met HTML blijft letterlijke tekst', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await laad(page, '{ dit is geen json');
    await expect(melding(page)).toContainText('geen geldige JSON');
    await laad(page, '{"leads": "nee"}');
    await expect(melding(page)).toContainText('Geen geldige export');
    expect(verzoeken.van('/api/sales-import')).toEqual([]);

    const gevaarlijk = '<img src=x onerror="window.__xss=1">';
    await laad(page, exportBestand({ aantal: 1, leads: [{ naam: gevaarlijk, voornaam: 'Hacker', email: 'h@voorbeeld.test', adres: '3500' }] }));
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await expect(lijst(page).locator('.sales-kaart-titel')).toHaveText(`Hacker ${gevaarlijk}`);
    await expect(page.locator('img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('een bestand groter dan 2 MB wordt niet gelezen of verstuurd', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await lijst(page).locator('input[type=file]').setInputFiles({ name: 'groot.json', mimeType: 'application/json', buffer: Buffer.alloc(2 * 1024 * 1024 + 10, 32) });
    await expect(melding(page)).toContainText('groter dan 2 MB');
    expect(verzoeken.van('/api/sales-import')).toEqual([]);
  });

  test('(i) de beheerder krijgt geen knop Export laden', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, leads: [], blobs: { 'sales/u-bea': { versie: 1, leads: [lead('b1', 'Beheerdersklant')], blokken: [], grafstenen: [] } } });
    await page.getByRole('tab', { name: 'Sales', exact: true }).click();
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await expect(lijst(page).getByRole('button', { name: 'Export laden' })).toHaveCount(0);
    await expect(lijst(page).locator('input[type=file]')).toHaveCount(0);
    // de beheerder mag wel bewerken, dus de ✕ staat er
    await expect(lijst(page).getByRole('button', { name: /Verwijder/ })).toHaveCount(1);
  });

  test('alleen-lezen weergave van een andere verkoper: geen ✕, geen Export laden, het detail zonder invoer of knoppen', async ({ page }) => {
    const gebruiker = { ...SALES_GEBRUIKER, magAlleSales: true };
    await startSalesApp(page, { gebruiker, blobs: { 'sales/u-bea': { versie: 1, leads: [lead('b1', 'Beaklant', { notitie: 'Bel na vijf uur' })], blokken: [], grafstenen: [] } } });
    await lijst(page).getByLabel('Verkoper').selectOption('u-bea');
    await expect(kaart(page, 'Beaklant')).toBeVisible();
    await expect(lijst(page).getByRole('button', { name: 'Export laden' })).toHaveCount(0);
    await expect(lijst(page).getByRole('button', { name: /Verwijder/ })).toHaveCount(0);
    await kaartTitel(page, 'Beaklant').click();
    await expect(venster(page)).toBeVisible();
    await expect(venster(page)).toContainText('Bel na vijf uur');
    await expect(venster(page).locator('input:not([disabled]), textarea:not([disabled])')).toHaveCount(0);
    await expect(venster(page).getByRole('button', { name: /Opslaan|Vast uur|Terug naar te plannen|Label wissen/ })).toHaveCount(0);
  });
});

test.describe('sales: Te plannen — verwijderen met ongedaan maken', () => {
  test('(d) ✕ → bevestigen → Ongedaan maken binnen 5 s herstelt de lead zonder DELETE', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen'), lead('l2', 'Peeters')] });
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(2);
    await kaart(page, 'Verhaegen').getByRole('button', { name: 'Verwijder Test Verhaegen' }).click();
    const dialoog = page.getByRole('alertdialog');
    await expect(dialoog).toContainText('Test Verhaegen');
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(2); // Terug: niets gebeurd

    await kaart(page, 'Verhaegen').getByRole('button', { name: 'Verwijder Test Verhaegen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Verwijderen' }).click();
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await expect(kaart(page, 'Verhaegen')).toHaveCount(0);
    await page.clock.runFor(2000);
    await lijst(page).getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(2);
    await expect(lijst(page).getByRole('button', { name: 'Ongedaan maken' })).toHaveCount(0);
    await page.clock.runFor(10000);
    expect(verzoeken.van('/api/sales', 'DELETE')).toEqual([]);
  });

  test('(d) laten verlopen: na 5 s precies één DELETE en de balk verdwijnt', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen'), lead('l2', 'Peeters')] });
    await kaart(page, 'Verhaegen').getByRole('button', { name: 'Verwijder Test Verhaegen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Verwijderen' }).click();
    await expect(lijst(page).getByRole('button', { name: 'Ongedaan maken' })).toBeVisible();
    await page.clock.runFor(5000);
    await expect.poll(() => verzoeken.van('/api/sales', 'DELETE').length).toBe(1);
    await expect(lijst(page).getByRole('button', { name: 'Ongedaan maken' })).toHaveCount(0);
    await page.clock.runFor(6000);
    expect(verzoeken.van('/api/sales', 'DELETE')).toHaveLength(1);
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
  });

  test('de pagina verbergen (visibilitychange) stuurt een openstaande verwijdering meteen', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')] });
    await kaart(page, 'Verhaegen').getByRole('button', { name: 'Verwijder Test Verhaegen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Verwijderen' }).click();
    expect(verzoeken.van('/api/sales', 'DELETE')).toEqual([]);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => verzoeken.van('/api/sales', 'DELETE').length).toBe(1);
  });

  test('(g) eerder verwijderd: de lead komt terug met het label; Label wissen verwijdert het; het label verraadt niets', async ({ page, verzoeken }) => {
    await startSalesApp(page);
    await laad(page, exportBestand({ aantal: 2, leads: [
      { naam: 'Terugkomer', voornaam: 'Greet', email: 'greet@voorbeeld.test', adres: '3500' },
      { naam: 'Blijver', voornaam: 'Hans', email: 'hans@voorbeeld.test', adres: '3500' },
    ] }));
    await expect(melding(page)).toContainText('2 nieuw, 0 al aanwezig');
    await kaart(page, 'Greet Terugkomer').getByRole('button', { name: /Verwijder/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Verwijderen' }).click();
    await page.clock.runFor(5000);
    await expect.poll(() => verzoeken.van('/api/sales', 'DELETE').length).toBe(1);
    await expect(kaart(page, 'Greet Terugkomer')).toHaveCount(0);

    await laad(page, exportBestand({ aantal: 2, leads: [
      { naam: 'Terugkomer', voornaam: 'Greet', email: 'greet@voorbeeld.test', adres: '3500' },
      { naam: 'Blijver', voornaam: 'Hans', email: 'hans@voorbeeld.test', adres: '3500' },
    ] }));
    await expect(melding(page)).toContainText('1 nieuw (waarvan 1 eerder verwijderd), 1 al aanwezig');
    const label = kaart(page, 'Greet Terugkomer').locator('.sales-chip-eerder');
    await expect(label).toHaveText('eerder verwijderd');
    await expect(kaart(page, 'Hans Blijver').locator('.sales-chip-eerder')).toHaveCount(0);

    await kaartTitel(page, 'Greet Terugkomer').click();
    await expect(venster(page)).toBeVisible();
    await expect(venster(page).locator('.sales-venster-eerder')).not.toContainText('Blijver');
    await expect(venster(page).locator('.sales-venster-eerder')).not.toContainText('hans@');
    await venster(page).getByRole('button', { name: 'Label wissen' }).click();
    await expect(venster(page).getByRole('button', { name: 'Label wissen' })).toHaveCount(0);
    await expect(label).toHaveCount(0);
    const patches = verzoeken.van('/api/sales', 'PATCH');
    expect(patches.at(-1).body.leads[0].velden).toEqual({ eerderVerwijderd: null });
  });
});

test.describe('sales: leaddetail', () => {
  test('(e) straat en huisnummer invullen maakt er een volledig adres van', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen', { postcode: '3640', gemeente: 'Kinrooi' })] });
    await expect(kaart(page, 'Verhaegen')).toContainText('enkel postcode');
    await kaartTitel(page, 'Verhaegen').click();
    await expect(venster(page)).toBeVisible();
    await venster(page).getByLabel('Straat').fill('Dorpsstraat');
    await venster(page).getByLabel('Huisnummer').fill('12');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(kaart(page, 'Verhaegen')).toContainText('volledig adres');
    await expect(page.locator('#toast')).toHaveText('Adres opgeslagen');
    const patch = verzoeken.van('/api/sales', 'PATCH').at(-1).body;
    expect(patch.leads[0].velden).toMatchObject({ straat: 'Dorpsstraat', huisnr: '12' });
  });

  test('een ongeldige postcode of een straat zonder huisnummer wordt niet verstuurd', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')] });
    await kaartTitel(page, 'Verhaegen').click();
    await venster(page).getByLabel('Straat').fill('Dorpsstraat');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page).getByRole('alert')).toContainText('Vul straat én huisnummer in');
    await venster(page).getByLabel('Huisnummer').fill('3');
    await venster(page).getByLabel('Postcode').fill('35');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page).getByRole('alert')).toContainText('Postcode bestaat uit 4 cijfers');
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
  });

  test('de notitie en de bezoekhistoriek zijn zichtbaar; de notitie is bewerkbaar', async ({ page, verzoeken }) => {
    const l = lead('l1', 'Verhaegen', { notitie: 'Bel na vijf uur', bezoeken: [{ datum: '2026-09-28', resultaat: 'opnieuw', notitie: 'Niet thuis', op: '2026-09-28T10:00:00.000Z' }] });
    await startSalesApp(page, { leads: [l] });
    await kaartTitel(page, 'Verhaegen').click();
    await expect(venster(page).getByLabel('Notitie')).toHaveValue('Bel na vijf uur');
    await expect(venster(page).locator('.sales-historiek')).toContainText('Opnieuw langsgaan');
    await expect(venster(page).locator('.sales-historiek')).toContainText('Niet thuis');
    await venster(page).getByLabel('Notitie').fill('Liever per mail');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page)).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH').at(-1).body.leads[0].velden).toEqual({ notitie: 'Liever per mail' });
  });

  test('(f) Vast uur afspreken voor een nog niet ingeplande lead: hij verhuist naar Bevestigd; het uur is later te wijzigen', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')] });
    await kaartTitel(page, 'Verhaegen').click();
    await expect(venster(page).getByRole('heading', { name: 'Vast uur afspreken' })).toBeVisible();
    await venster(page).getByLabel('Datum', { exact: true }).fill('2026-10-06');
    await venster(page).getByLabel('Uur', { exact: true }).fill('10:00');
    await venster(page).getByRole('button', { name: 'Vast uur vastleggen' }).click();
    await expect(venster(page)).toHaveCount(0);
    const ingepland = lijst(page).locator('.sales-kolom[data-kolom="bevestigd"]');
    await expect(ingepland.locator('.sales-kaart', { hasText: 'Verhaegen' })).toContainText('di 6 okt 10:00');
    const patch = verzoeken.van('/api/sales', 'PATCH').at(-1).body;
    expect(patch.leads[0].velden).toEqual({ status: 'bevestigd', planning: { datum: '2026-10-06', start: '10:00', vast: true } });

    // opnieuw openen en een ander uur kiezen
    await kaartTitel(page, 'Verhaegen').click();
    await expect(venster(page).getByLabel('Datum', { exact: true })).toHaveValue('2026-10-06');
    await expect(venster(page).getByLabel('Uur', { exact: true })).toHaveValue('10:00');
    await venster(page).getByLabel('Uur', { exact: true }).fill('13:30');
    await venster(page).getByRole('button', { name: 'Uur wijzigen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(ingepland.locator('.sales-kaart', { hasText: 'Verhaegen' })).toContainText('di 6 okt 13:30');
  });

  test('(f) een datum in het verleden wordt geweigerd', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')] });
    await kaartTitel(page, 'Verhaegen').click();
    await venster(page).getByLabel('Datum', { exact: true }).fill('2026-10-01');
    await venster(page).getByLabel('Uur', { exact: true }).fill('10:00');
    await venster(page).getByRole('button', { name: 'Vast uur vastleggen' }).click();
    await expect(venster(page).getByRole('alert')).toContainText('Kies een datum vanaf vandaag');
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
  });

  test('(f) botsing met een bestaand vast uur: eerst een bevestigingsvraag; Terug legt niets vast, Toch vastleggen wel', async ({ page, verzoeken }) => {
    const bezet = lead('l2', 'Peeters', { status: 'bevestigd', planning: { datum: '2026-10-06', start: '10:00', vast: true } });
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen'), bezet] });
    await kaartTitel(page, 'Verhaegen').click();
    await venster(page).getByLabel('Datum', { exact: true }).fill('2026-10-06');
    await venster(page).getByLabel('Uur', { exact: true }).fill('10:30');
    await venster(page).getByRole('button', { name: 'Vast uur vastleggen' }).click();
    const dialoog = page.getByRole('alertdialog');
    await expect(dialoog).toContainText('Test Peeters');
    await expect(dialoog).toContainText('10:00');
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
    await expect(venster(page)).toBeVisible();

    await venster(page).getByRole('button', { name: 'Vast uur vastleggen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Toch vastleggen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(lijst(page).locator('.sales-kolom[data-kolom="bevestigd"]').locator('.sales-kaart', { hasText: 'Verhaegen' })).toContainText('10:30');
  });

  test('Terug naar te plannen haalt een bevestigde lead uit Bevestigd', async ({ page, verzoeken }) => {
    const vast = lead('l1', 'Verhaegen', { status: 'bevestigd', planning: { datum: '2026-10-06', start: '10:00', vast: true } });
    await startSalesApp(page, { leads: [vast] });
    await expect(lijst(page).locator('.sales-kolom[data-kolom="bevestigd"]').locator('.sales-kaart')).toHaveCount(1);
    await kaartTitel(page, 'Verhaegen').click();
    await venster(page).getByRole('button', { name: 'Terug naar te plannen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(lijst(page).locator('.sales-kolom[data-kolom="bevestigd"]').locator('.sales-kaart')).toHaveCount(0);
    await expect(lijst(page).locator('.sales-kolom[data-kolom="tePlannen"]').locator('.sales-kaart')).toHaveCount(1);
    expect(verzoeken.van('/api/sales', 'PATCH').at(-1).body.leads[0].velden).toMatchObject({ status: 'te-plannen', planning: null });
  });

  test('een voorgesteld bezoek dat een volledig adres krijgt: toast over de herberekende route', async ({ page }) => {
    const voorgesteld = lead('l1', 'Verhaegen', { postcode: '3640', gemeente: 'Kinrooi', status: 'voorgesteld', planning: { datum: '2026-10-06', start: '09:00', vast: false } });
    await startSalesApp(page, { leads: [voorgesteld] });
    await kaartTitel(page, 'Verhaegen').click();
    await venster(page).getByLabel('Straat').fill('Dorpsstraat');
    await venster(page).getByLabel('Huisnummer').fill('12');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toHaveText('Adres bijgewerkt — de route van die dag is herberekend. Plan de week opnieuw om de uren te herschikken.');
  });

  test('(h) een 503 opslag-storing op PATCH: opslagmelding in het venster, venster blijft open, geen loginscherm', async ({ page, consoleFouten }) => {
    const echte = salesStubs({ leads: [lead('l1', 'Verhaegen')] });
    const sales = async (z) => (z.methode === 'PATCH' ? { status: 503, json: { error: OPSLAG_TEKST, code: 'opslag-storing' } } : echte.sales(z));
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')], overschrijf: { sales } });
    await kaartTitel(page, 'Verhaegen').click();
    await venster(page).getByLabel('Notitie').fill('Nieuwe notitie');
    await venster(page).getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster(page).locator('.sales-venster-fout')).toHaveText(OPSLAG_TEKST);
    await expect(venster(page)).toBeVisible();
    await expect(venster(page).getByLabel('Notitie')).toHaveValue('Nieuwe notitie');
    await expect(page.locator('#login-overlay')).toHaveCount(0);
    await expect(kaart(page, 'Verhaegen')).toBeVisible();
    await verwachtFout(consoleFouten, '/api/sales', 503);
  });
});

test.describe('sales: Te plannen — zoeken, filter en telefoonbreedte', () => {
  test('zoeken op naam of gemeente en filteren op postcodegebied', async ({ page }) => {
    await startSalesApp(page, { leads: [
      lead('l1', 'Verhaegen'), lead('l2', 'Peeters', { postcode: '3640', gemeente: 'Kinrooi' }), lead('l3', 'Maes', { postcode: '2000', gemeente: 'Antwerpen' }),
    ] });
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(3);
    await lijst(page).getByRole('searchbox', { name: 'Zoeken' }).fill('kinrooi');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await expect(kaart(page, 'Peeters')).toBeVisible();
    await expect(lijst(page).getByRole('searchbox', { name: 'Zoeken' })).toBeFocused(); // het zoekveld blijft staan tijdens het typen
    await lijst(page).getByRole('searchbox', { name: 'Zoeken' }).fill('');
    await lijst(page).getByLabel('Postcodegebied').selectOption('20');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(1);
    await expect(kaart(page, 'Maes')).toBeVisible();
    await lijst(page).getByLabel('Postcodegebied').selectOption('');
    await expect(lijst(page).locator('.sales-kaart')).toHaveCount(3);
  });

  test('kaartjes zijn met het toetsenbord te openen', async ({ page }) => {
    await startSalesApp(page, { leads: [lead('l1', 'Verhaegen')] });
    await kaart(page, 'Verhaegen').focus();
    await page.keyboard.press('Enter');
    await expect(venster(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(venster(page)).toHaveCount(0);
  });

  test('op telefoonbreedte geen horizontale scroll, ook niet met lange namen en een venster', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const lang = 'Wolfeschlegelsteinhausenbergerdorffvoralternwarengewissenhaftschaferswessenschafewarenwohlgepflegeundsorgfaltigkeitbeschutzen';
    await startSalesApp(page, { viewport: { width: 375, height: 812 }, leads: [lead('l1', lang, { email: 'een.zeer.lange.mailadres.zonder.einde@voorbeeld-met-een-lange-naam.test', gsm: '32470112233' })] });
    const breedte = () => page.evaluate(() => ({ doc: document.documentElement.scrollWidth, venster: window.innerWidth }));
    let b = await breedte();
    expect(b.doc).toBeLessThanOrEqual(b.venster);
    await kaartTitel(page, 'Wolfe').click();
    await expect(venster(page)).toBeVisible();
    b = await breedte();
    expect(b.doc).toBeLessThanOrEqual(b.venster);
  });
});
