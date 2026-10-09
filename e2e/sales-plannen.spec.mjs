import { test, expect } from './helpers.mjs';
import { startSalesApp, salesStubs, verwachtFout, SALES_GEBRUIKER } from './sales-hulp.mjs';

// "Plan deze week" voor de verkoper (Task 17). Klok: maandag 5 okt 2026 09:00. Geen TomTom, geen Zoho: testmodus rekent reistijden met
// haversine x 1,3 zonder netwerkaanroep. Alle namen zijn verzonnen.
const kal = (page) => page.locator('#view-sales-kalender');
const dag = (page, iso) => kal(page).locator(`.day-col[data-date="${iso}"]`);
const venster = (page) => page.locator('.sales-overlay.open');
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const plan = (page) => kal(page).getByRole('button', { name: /Plan deze week/ });
const naarKalender = async (page) => { await tab(page, 'Kalender').click(); await expect(kal(page).locator('.day-col[data-date]').first()).toBeVisible(); };

// Dichtbij elkaar (Hasselt en omgeving), zodat de maximale reistijd nooit de beperking is.
const lead = (id, naam, i = 0, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93 + i * 0.004, lon: 5.34 + i * 0.004, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: `2026-10-0${1 + (i % 3)}T08:00:00.000Z`, bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
const voorgesteld = (id, naam, datum, start, i = 0, extra = {}) => lead(id, naam, i, { status: 'voorgesteld', planning: { datum, start, vast: false }, ...extra });
const bevestigd = (id, naam, datum, start, i = 0, extra = {}) => lead(id, naam, i, { status: 'bevestigd', planning: { datum, start, vast: true }, ...extra });
const NAMEN = ['Aerts', 'Bogaert', 'Claes', 'Desmet', 'Everaert', 'Fransen', 'Geerts', 'Hendrix'];
const achtLeads = () => NAMEN.map((n, i) => lead(`l${i}`, n, i));
const heleDag = (id, datum) => ({ id, datum, start: '00:00', eind: '23:59', soort: 'verlof' });

const min = (u) => Number(u.slice(0, 2)) * 60 + Number(u.slice(3, 5));
/** De [begin, einde] (minuten) van alle bezoeken in een dagkolom, uit de tijdtekst "09:00–10:00". */
const bezoekTijden = async (kolom) => (await kolom.locator('.tl-block.sales-bezoek .sales-kal-tijd').allTextContents()).map((t) => {
  const [b, e] = t.split('–');
  return [min(b), min(e)];
});
const overlap = (lijst) => lijst.some(([b1, e1], i) => lijst.some(([b2, e2], j) => i < j && b1 < e2 && b2 < e1));
const toast = (page) => page.locator('#toast');

test.describe('sales: Plan deze week', () => {
  test('(a) 8 te-plannen leads worden voorgesteld: resultaatvenster, één PATCH, geen matrix/route/propose/optimize', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: achtLeads(), blokken: [] });
    await naarKalender(page);
    await expect(kal(page).locator('.tl-block')).toHaveCount(0);
    await plan(page).click();
    await expect(venster(page)).toContainText('Planningsresultaat');
    await expect(venster(page).getByRole('heading', { name: 'Ingepland (8)' })).toBeVisible();
    await expect(venster(page).getByRole('heading', { name: /Niet ingepland/ })).toHaveCount(0);
    await venster(page).getByRole('button', { name: 'Klaar' }).click();
    await expect(kal(page).locator('.tl-block.sales-voorgesteld')).toHaveCount(8);
    await expect(kal(page).locator('.tl-block.sales-bevestigd')).toHaveCount(0);
    for (const kolom of await kal(page).locator('.day-col[data-date]').all()) expect(overlap(await bezoekTijden(kolom))).toBe(false);
    const patches = verzoeken.van('/api/sales', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body.leads).toHaveLength(8);
    for (const w of patches[0].body.leads) expect(w.velden).toMatchObject({ status: 'voorgesteld', planning: { vast: false } });
    for (const pad of ['/api/matrix', '/api/route', '/api/propose', '/api/optimize', '/api/voorstel']) expect(verzoeken.van(pad), pad).toEqual([]);
    // Geen lead blijft in Te plannen.
    await tab(page, 'Te plannen').click();
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(8);
    await expect(page.locator('#view-sales-lijst').getByRole('heading', { name: /Nog in te plannen/ })).toHaveCount(0);
  });

  test('(b) een vast uur dinsdag 10:00 via het detail blijft ongewijzigd, ook bij een tweede keer, zonder overlap en zonder vermelding in het venster', async ({ page, verzoeken }) => {
    const leads = achtLeads();
    await startSalesApp(page, { leads, blokken: [] });
    await tab(page, 'Te plannen').click();
    await page.locator('#view-sales-lijst .sales-kaart-titel', { hasText: 'Test Hendrix' }).click();
    await venster(page).locator('.sales-vast input[type=date]').fill('2026-10-06');
    await venster(page).locator('.sales-vast input[type=time]').fill('10:00');
    await venster(page).locator('.sales-vast').getByRole('button', { name: 'Vast uur vastleggen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await naarKalender(page);
    await expect(dag(page, '2026-10-06').locator('.tl-block.sales-bevestigd')).toContainText('10:00–11:00');

    for (const ronde of [1, 2]) {
      await plan(page).click();
      await expect(venster(page)).toContainText('Planningsresultaat');
      await expect(venster(page)).toContainText('Ingepland (7)');
      await expect(venster(page)).not.toContainText('Test Hendrix');
      await venster(page).getByRole('button', { name: 'Klaar' }).click();
      const vast = dag(page, '2026-10-06').locator('.tl-block.sales-bevestigd');
      await expect(vast).toHaveCount(1);
      await expect(vast).toContainText('Test Hendrix');
      await expect(vast).toContainText('10:00–11:00');
      for (const kolom of await kal(page).locator('.day-col[data-date]').all()) expect(overlap(await bezoekTijden(kolom)), `ronde ${ronde}`).toBe(false);
      await expect(kal(page).locator('.tl-block')).toHaveCount(8);
    }
    // De PATCH van de tweede ronde raakt de vaste lead niet.
    for (const p of verzoeken.van('/api/sales', 'PATCH').slice(1)) expect(p.body.leads.map((w) => w.id)).not.toContain('l7');
  });

  test('(b) een vast uur buiten de werkuren (07:00) blijft staan en een volle dag krijgt er niets bij', async ({ page }) => {
    const leads = [
      bevestigd('v1', 'Vroeg', '2026-10-07', '07:00', 0),
      // donderdag zit vol (4 per dag)
      bevestigd('d1', 'Dag1', '2026-10-08', '09:00', 1), bevestigd('d2', 'Dag2', '2026-10-08', '10:30', 2),
      bevestigd('d3', 'Dag3', '2026-10-08', '12:00', 3), bevestigd('d4', 'Dag4', '2026-10-08', '14:00', 4),
      ...NAMEN.slice(0, 5).map((n, i) => lead(`n${i}`, n, i)),
    ];
    await startSalesApp(page, { leads, blokken: [] });
    await naarKalender(page);
    await plan(page).click();
    await expect(venster(page)).toContainText('Ingepland (5)');
    await venster(page).getByRole('button', { name: 'Klaar' }).click();
    const vroeg = dag(page, '2026-10-07').locator('.tl-block.sales-bevestigd', { hasText: 'Test Vroeg' });
    await expect(vroeg).toContainText('07:00–08:00');
    await expect(dag(page, '2026-10-08').locator('.tl-block.sales-bevestigd')).toHaveCount(4);
    await expect(dag(page, '2026-10-08').locator('.tl-block.sales-voorgesteld')).toHaveCount(0);
    for (const kolom of await kal(page).locator('.day-col[data-date]').all()) expect(overlap(await bezoekTijden(kolom))).toBe(false);
  });

  test('(b) een vast uur in een andere week belemmert het plannen niet en blijft ongemoeid', async ({ page, verzoeken }) => {
    const leads = [bevestigd('v1', 'Volgende', '2026-10-14', '10:00', 0), bevestigd('v2', 'Later', '2026-11-11', '10:00', 1), ...NAMEN.slice(0, 3).map((n, i) => lead(`n${i}`, n, i))];
    await startSalesApp(page, { leads, blokken: [] });
    await naarKalender(page);
    await plan(page).click();
    await expect(venster(page)).toContainText('Ingepland (3)');
    await venster(page).getByRole('button', { name: 'Klaar' }).click();
    expect(verzoeken.van('/api/sales', 'PATCH')[0].body.leads.map((w) => w.id).sort()).toEqual(['n0', 'n1', 'n2']);
    await kal(page).getByRole('button', { name: 'Volgende periode' }).click();
    await expect(dag(page, '2026-10-14').locator('.tl-block.sales-bevestigd')).toContainText('10:00–11:00');
  });

  test('(c) een lead zonder locatie staat onder Niet ingepland met "Adres niet gevonden"', async ({ page }) => {
    const leads = [...achtLeads().slice(0, 3), lead('m1', 'Molenaar', 0, { postcode: null, gemeente: null, adresTekst: 'bij de molen', locatie: null })];
    await startSalesApp(page, { leads, blokken: [] });
    await naarKalender(page);
    await plan(page).click();
    await expect(venster(page).getByRole('heading', { name: 'Ingepland (3)' })).toBeVisible();
    await expect(venster(page).getByRole('heading', { name: 'Niet ingepland (1)' })).toBeVisible();
    await expect(venster(page).locator('.sales-plan-niet')).toContainText('Test Molenaar');
    await expect(venster(page).locator('.sales-plan-niet')).toContainText('Adres niet gevonden');
  });

  test('(d) een bevestigd bezoek wordt nooit herschikt; een voorgesteld bezoek op een geblokkeerde dag verhuist', async ({ page }) => {
    // Dinsdag is een verlofdag; het voorgestelde bezoek op dinsdag moet weg, het bevestigde blijft.
    const leads = [voorgesteld('p1', 'Pieters', '2026-10-06', '10:00', 0), bevestigd('b1', 'Bevest', '2026-10-06', '14:00', 1)];
    await startSalesApp(page, { leads, blokken: [heleDag('h1', '2026-10-06')] });
    await naarKalender(page);
    await plan(page).click();
    await expect(venster(page)).toContainText('Ingepland (1)');
    await venster(page).getByRole('button', { name: 'Klaar' }).click();
    await expect(dag(page, '2026-10-06').locator('.tl-block.sales-voorgesteld')).toHaveCount(0);
    await expect(dag(page, '2026-10-06').locator('.tl-block.sales-bevestigd')).toContainText('14:00–15:00');
    const elders = kal(page).locator('.day-col:not([data-date="2026-10-06"]) .tl-block.sales-voorgesteld', { hasText: 'Test Pieters' });
    await expect(elders).toHaveCount(1);
  });

  test('(d) een voorgesteld bezoek dat nergens meer past gaat terug naar Te plannen, met de reden in het venster', async ({ page, verzoeken }) => {
    // Alle werkdagen behalve dinsdag zijn verlof; dinsdag zit vol met 4 bevestigde bezoeken.
    const leads = [
      voorgesteld('p1', 'Verstraete', '2026-10-06', '10:00', 0),
      bevestigd('b1', 'Een', '2026-10-06', '08:30', 1), bevestigd('b2', 'Twee', '2026-10-06', '11:00', 2),
      bevestigd('b3', 'Drie', '2026-10-06', '13:00', 3), bevestigd('b4', 'Vier', '2026-10-06', '15:00', 4),
    ];
    const blokken = ['2026-10-05', '2026-10-07', '2026-10-08', '2026-10-09'].map((d, i) => heleDag(`h${i}`, d));
    await startSalesApp(page, { leads, blokken });
    await naarKalender(page);
    await plan(page).click();
    await expect(venster(page).getByRole('heading', { name: 'Niet ingepland (1)' })).toBeVisible();
    await expect(venster(page).locator('.sales-plan-niet')).toContainText('Test Verstraete');
    await expect(venster(page).locator('.sales-plan-niet .sales-plan-reden')).not.toBeEmpty();
    await venster(page).getByRole('button', { name: 'Klaar' }).click();
    await expect(kal(page).locator('.tl-block.sales-voorgesteld')).toHaveCount(0);
    await expect(kal(page).locator('.tl-block.sales-bevestigd')).toHaveCount(4);
    const patch = verzoeken.van('/api/sales', 'PATCH')[0];
    expect(patch.body.leads).toEqual([{ id: 'p1', velden: { status: 'te-plannen', planning: null } }]);
    await tab(page, 'Te plannen').click();
    await expect(page.locator('#view-sales-lijst .sales-kaart', { hasText: 'Test Verstraete' })).toBeVisible();
  });

  test('(e) een andere verkoper bekijken (magAlleSales): geen ⚡-knop', async ({ page }) => {
    const gebruiker = { ...SALES_GEBRUIKER, magAlleSales: true };
    await startSalesApp(page, { gebruiker, blobs: { 'sales/u-bea': { versie: 1, leads: achtLeads(), blokken: [], grafstenen: [] } } });
    await tab(page, 'Kalender').click();
    await expect(plan(page)).toBeVisible(); // zijn eigen agenda: wel
    await kal(page).getByLabel('Verkoper').selectOption('u-bea');
    await expect(kal(page).locator('.day-col[data-date]').first()).toBeVisible();
    await expect(plan(page)).toHaveCount(0);
  });

  test('(f) zonder bewaarde instellingen: ma-vr 08:00-17:00 en de toast over de ontbrekende startlocatie', async ({ page }) => {
    await startSalesApp(page, { leads: achtLeads(), blokken: [], instellingen: null });
    await naarKalender(page);
    await plan(page).click();
    await expect(venster(page)).toContainText('Ingepland (8)');
    await expect(toast(page)).toContainText('Geen startlocatie ingesteld: de ritten starten bij het eerste bezoek. Stel je startadres in via ⚙ Instellingen.');
    await venster(page).getByRole('button', { name: 'Klaar' }).click();
    await expect(kal(page).locator('.day-col[data-date]')).toHaveCount(5); // enkel ma-vr: geen enkel bezoek in het weekend
    for (const kolom of await kal(page).locator('.day-col[data-date]').all()) {
      for (const [b, e] of await bezoekTijden(kolom)) { expect(b).toBeGreaterThanOrEqual(8 * 60); expect(b).toBeLessThanOrEqual(16 * 60); expect(e).toBeLessThanOrEqual(17 * 60 + 60); }
    }
  });

  test('geen te plannen leads: toast "Geen leads om in te plannen" en geen PATCH', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [bevestigd('b1', 'Alleen', '2026-10-06', '10:00')], blokken: [] });
    await naarKalender(page);
    await plan(page).click();
    await expect(toast(page)).toHaveText('Geen leads om in te plannen');
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
    await expect(venster(page)).toHaveCount(0);
  });

  test('een week die voorbij is: melding en niets gepland', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: achtLeads(), blokken: [] });
    await naarKalender(page);
    await kal(page).getByRole('button', { name: 'Vorige periode' }).click();
    await plan(page).click();
    await expect(toast(page)).toContainText('is voorbij');
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
  });

  test('maandweergave: plant de week van de gekozen dag en zegt dat in het venster', async ({ page }) => {
    await startSalesApp(page, { leads: achtLeads().slice(0, 2), blokken: [] });
    await naarKalender(page);
    await kal(page).getByRole('button', { name: 'Maand', exact: true }).click();
    await plan(page).click();
    await expect(venster(page)).toContainText('Maandweergave: je plant de week van');
    await expect(venster(page)).toContainText('Ingepland (2)');
  });

  test('een 409-conflict op het bewaren: toast "Planning niet bewaard", de leads blijven ongewijzigd', async ({ page, verzoeken, consoleFouten }) => {
    const opties = { leads: achtLeads().slice(0, 3), blokken: [] };
    const echte = salesStubs(opties);
    const sales = async (z) => {
      if (z.methode !== 'PATCH') return echte.sales(z);
      const huidig = await echte.sales({ methode: 'GET', body: null, query: new URLSearchParams(), pad: '/api/sales' });
      return { status: 409, json: { error: 'Versiematch mislukt', serverVersie: huidig.json.versie, data: huidig.json } };
    };
    await startSalesApp(page, { ...opties, overschrijf: { sales } });
    await naarKalender(page);
    await plan(page).click();
    await expect(toast(page)).toHaveText('Planning niet bewaard: de gegevens waren intussen gewijzigd. Plan opnieuw.');
    await expect(venster(page)).toHaveCount(0);
    await expect(kal(page).locator('.tl-block')).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH')).toHaveLength(2); // één keer opnieuw na het 409
    await verwachtFout(consoleFouten, '/api/sales', 409, 4);
  });
});
