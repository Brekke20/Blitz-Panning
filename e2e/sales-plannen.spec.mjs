import { test, expect } from './helpers.mjs';
import { startSalesApp, salesStubs, verwachtFout, BEHEERDER, SALES_GEBRUIKER } from './sales-hulp.mjs';

// "Plan deze week" voor de verkoper (Task 17). Klok: maandag 5 okt 2026 09:00. Geen echte TomTom, geen Zoho: de stubs van helpers.mjs antwoorden (matrix overal 20 min). Zonder bestaande bezoeken of depot vraagt het brein geen reistijd; de
// reistijd-tests staan onderaan (buiten de testmodus). Alle namen zijn verzonnen.
const kal = (page) => page.locator('#view-sales-kalender');
const dag = (page, iso) => kal(page).locator(`.day-col[data-date="${iso}"]`);
const venster = (page) => page.locator('.sales-overlay.open');
// Het resultaat van "Plan deze week" is hetzelfde venster als bij de technieker (#result-overlay): zelfde naam, zelfde sluitknop.
const resultaat = (page) => page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
const sluitResultaat = (page) => resultaat(page).getByRole('button', { name: 'Sluiten' }).click();
const sectie = (page, titel) => resultaat(page).locator('.result-section', { hasText: titel });
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
  test('(a) 8 te-plannen leads worden voorgesteld: resultaatvenster, één PATCH, geen route/propose/optimize (de matrix mag: reistijden via de stub)', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: achtLeads(), blokken: [] });
    await naarKalender(page);
    await expect(kal(page).locator('.tl-block')).toHaveCount(0);
    await plan(page).click();
    await expect(resultaat(page)).toBeVisible();
    await expect(resultaat(page).getByText('Ingepland (8)', { exact: true })).toBeVisible();
    await expect(resultaat(page).getByText(/Niet ingepland/)).toHaveCount(0);
    await sluitResultaat(page);
    await expect(kal(page).locator('.tl-block.sales-voorgesteld')).toHaveCount(8);
    await expect(kal(page).locator('.tl-block.sales-bevestigd')).toHaveCount(0);
    for (const kolom of await kal(page).locator('.day-col[data-date]').all()) expect(overlap(await bezoekTijden(kolom))).toBe(false);
    const patches = verzoeken.van('/api/sales', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body.leads).toHaveLength(8);
    for (const w of patches[0].body.leads) expect(w.velden).toMatchObject({ status: 'voorgesteld', planning: { vast: false } });
    for (const pad of ['/api/route', '/api/propose', '/api/optimize', '/api/voorstel']) expect(verzoeken.van(pad), pad).toEqual([]);
    // Geen lead blijft bij Nog in te plannen: alle acht staan in de middelste kolom.
    await tab(page, 'Leads').click();
    await expect(page.locator('#view-sales-lijst .sales-kaart')).toHaveCount(8);
    await expect(page.locator('#view-sales-lijst').getByRole('heading', { name: 'Nog in te plannen (0)' })).toBeVisible();
    await expect(page.locator('#view-sales-lijst').getByRole('heading', { name: 'Ingepland (8)' })).toBeVisible();
  });

  test('(b) een vast uur dinsdag 10:00 via het detail blijft ongewijzigd, ook bij een tweede keer, zonder overlap en zonder vermelding in het venster', async ({ page, verzoeken }) => {
    const leads = achtLeads();
    await startSalesApp(page, { leads, blokken: [] });
    await tab(page, 'Leads').click();
    await page.locator('#view-sales-lijst .sales-kaart-titel', { hasText: 'Test Hendrix' }).click();
    await venster(page).locator('.sales-vast input[type=date]').fill('2026-10-06');
    await venster(page).locator('.sales-vast input[type=time]').fill('10:00');
    await venster(page).locator('.sales-vast').getByRole('button', { name: 'Vast uur vastleggen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await naarKalender(page);
    await expect(dag(page, '2026-10-06').locator('.tl-block.sales-bevestigd')).toContainText('10:00–11:00');

    for (const ronde of [1, 2]) {
      await plan(page).click();
      await expect(resultaat(page)).toBeVisible();
      await expect(resultaat(page)).toContainText('Ingepland (7)');
      await expect(resultaat(page)).not.toContainText('Test Hendrix');
      await sluitResultaat(page);
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
    await expect(resultaat(page)).toContainText('Ingepland (5)');
    await sluitResultaat(page);
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
    await expect(resultaat(page)).toContainText('Ingepland (3)');
    await sluitResultaat(page);
    expect(verzoeken.van('/api/sales', 'PATCH')[0].body.leads.map((w) => w.id).sort()).toEqual(['n0', 'n1', 'n2']);
    await kal(page).getByRole('button', { name: 'Volgende periode' }).click();
    await expect(dag(page, '2026-10-14').locator('.tl-block.sales-bevestigd')).toContainText('10:00–11:00');
  });

  test('(c) een lead zonder locatie staat onder Niet ingepland met "Adres niet gevonden"', async ({ page }) => {
    const leads = [...achtLeads().slice(0, 3), lead('m1', 'Molenaar', 0, { postcode: null, gemeente: null, adresTekst: 'bij de molen', locatie: null })];
    await startSalesApp(page, { leads, blokken: [] });
    await naarKalender(page);
    await plan(page).click();
    await expect(resultaat(page).getByText('Ingepland (3)', { exact: true })).toBeVisible();
    await expect(resultaat(page).getByText('Niet ingepland (1)', { exact: true })).toBeVisible();
    await expect(sectie(page, 'Niet ingepland')).toContainText('Test Molenaar');
    await expect(sectie(page, 'Niet ingepland')).toContainText('Adres niet gevonden');
  });

  test('(d) een bevestigd bezoek wordt nooit herschikt; een voorgesteld bezoek op een geblokkeerde dag verhuist', async ({ page }) => {
    // Dinsdag is een verlofdag; het voorgestelde bezoek op dinsdag moet weg, het bevestigde blijft.
    const leads = [voorgesteld('p1', 'Pieters', '2026-10-06', '10:00', 0), bevestigd('b1', 'Bevest', '2026-10-06', '14:00', 1)];
    await startSalesApp(page, { leads, blokken: [heleDag('h1', '2026-10-06')] });
    await naarKalender(page);
    await plan(page).click();
    await expect(resultaat(page)).toContainText('Ingepland (1)');
    await sluitResultaat(page);
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
    await expect(resultaat(page).getByText('Niet ingepland (1)', { exact: true })).toBeVisible();
    await expect(sectie(page, 'Niet ingepland')).toContainText('Test Verstraete');
    await expect(sectie(page, 'Niet ingepland').locator('.result-item > div:last-child > div')).not.toBeEmpty();
    await sluitResultaat(page);
    await expect(kal(page).locator('.tl-block.sales-voorgesteld')).toHaveCount(0);
    await expect(kal(page).locator('.tl-block.sales-bevestigd')).toHaveCount(4);
    const patch = verzoeken.van('/api/sales', 'PATCH')[0];
    expect(patch.body.leads).toEqual([{ id: 'p1', velden: { status: 'te-plannen', planning: null } }]);
    await tab(page, 'Leads').click();
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
    await expect(resultaat(page)).toContainText('Ingepland (8)');
    await expect(toast(page)).toContainText('Geen startlocatie ingesteld: de ritten starten bij het eerste bezoek. Stel je startadres in via ⚙ Instellingen.');
    await sluitResultaat(page);
    await expect(kal(page).locator('.day-col[data-date]')).toHaveCount(5); // enkel ma-vr: geen enkel bezoek in het weekend
    for (const kolom of await kal(page).locator('.day-col[data-date]').all()) {
      for (const [b, e] of await bezoekTijden(kolom)) { expect(b).toBeGreaterThanOrEqual(8 * 60); expect(b).toBeLessThanOrEqual(16 * 60); expect(e).toBeLessThanOrEqual(17 * 60 + 60); }
    }
  });

  test('I1: de beheerder wisselt van verkoper en de instellingen van de nieuwe laden niet: Plan deze week plant niet met die van de vorige', async ({ page, verzoeken, consoleFouten }) => {
    const bea = { versie: 1, leads: achtLeads().slice(0, 2), blokken: [], grafstenen: [] };
    const carl = { versie: 1, leads: achtLeads().slice(2, 4), blokken: [], grafstenen: [] };
    const blobs = {
      'sales/u-bea': bea, 'sales/u-carl': carl,
      instellingen: { versie: 1, perGebruiker: { 'u-bea': { startlocatie: 'Hasselt', vanTijd: '10:00', werkdagen: [1] }, 'u-carl': { vanTijd: '08:00' } } },
    };
    const echte = salesStubs({ gebruiker: BEHEERDER, blobs });
    const instellingen = async (z) => (z.query?.get('gebruiker') === 'u-carl' ? { status: 503, json: { error: 'Opslag stuk', code: 'opslag-storing' } } : echte.instellingen(z));
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs, overschrijf: { instellingen } });
    await tab(page, 'Sales').click();
    await page.getByRole('tablist', { name: 'Sales-onderdelen' }).getByRole('tab', { name: 'Kalender' }).click();
    await expect(kal(page).getByLabel('Verkoper')).toHaveValue('u-bea');
    await kal(page).getByLabel('Verkoper').selectOption('u-carl');
    await expect(kal(page).locator('.day-col[data-date]').first()).toBeVisible();
    await plan(page).click();
    await expect(toast(page)).toContainText('instellingen van deze verkoper konden niet geladen worden');
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
    await expect(resultaat(page)).toBeHidden();
    await verwachtFout(consoleFouten, '/api/instellingen', 503);
  });

  test('I2: een voorstel van vorige week dat niet bevestigd werd: Plan deze week plant het opnieuw; bevestigd en vast blijven; de lijst toonde het als "voorstel verlopen"', async ({ page, verzoeken }) => {
    const leads = [
      voorgesteld('v1', 'Verlopen', '2026-09-30', '09:00', 0),
      bevestigd('b1', 'Bevestigd', '2026-09-30', '10:00', 1),
      lead('t1', 'Nieuw', 2),
    ];
    await startSalesApp(page, { leads, blokken: [] });
    await tab(page, 'Leads').click();
    const lijst = page.locator('#view-sales-lijst');
    const verlopen = lijst.locator('.sales-kaart', { hasText: 'Test Verlopen' });
    await expect(verlopen.locator('.sales-chip-verlopen')).toHaveText('voorstel verlopen');
    await expect(lijst.locator('.sales-kolom[data-kolom="tePlannen"]').locator('.sales-kaart', { hasText: 'Test Verlopen' })).toHaveCount(1);
    await expect(lijst.locator('.sales-kaart', { hasText: 'Test Bevestigd' }).locator('.sales-chip-verlopen')).toHaveCount(0);
    await naarKalender(page);
    await plan(page).click();
    await expect(resultaat(page)).toContainText('Ingepland (2)'); // Verlopen + Nieuw
    await sluitResultaat(page);
    const patch = verzoeken.van('/api/sales', 'PATCH');
    expect(patch).toHaveLength(1);
    expect(patch[0].body.leads.map((w) => w.id).sort()).toEqual(['t1', 'v1']); // het bevestigde bezoek is niet aangeraakt
    const nieuw = patch[0].body.leads.find((w) => w.id === 'v1').velden;
    expect(nieuw.status).toBe('voorgesteld');
    expect(nieuw.planning.datum >= '2026-10-05').toBe(true);
    await tab(page, 'Leads').click();
    await expect(lijst.locator('.sales-chip-verlopen')).toHaveCount(0);
  });

  test('geen te plannen leads: toast "Geen leads om in te plannen" en geen PATCH', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [bevestigd('b1', 'Alleen', '2026-10-06', '10:00')], blokken: [] });
    await naarKalender(page);
    await plan(page).click();
    await expect(toast(page)).toHaveText('Geen leads om in te plannen');
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
    await expect(resultaat(page)).toBeHidden();
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
    await expect(resultaat(page)).toContainText('Maandweergave: je plant de week van');
    await expect(resultaat(page)).toContainText('Ingepland (2)');
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
    await expect(resultaat(page)).toBeHidden();
    await expect(kal(page).locator('.tl-block')).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH')).toHaveLength(2); // één keer opnieuw na het 409
    await verwachtFout(consoleFouten, '/api/sales', 409, 4);
  });
});

// Hetzelfde resultaatvenster als bij de technieker (Brent, proefperiode: de planning van de verkoper moet er hetzelfde uitzien en zich gedragen).
test.describe('sales: resultaatvenster van Plan deze week (zelfde als technieker)', () => {
  test('in testmodus (?test) vraagt het brein de reistijd ook via /api/matrix (stub), zoals de technieker', async ({ page, verzoeken }) => {
    const leads = [bevestigd('b1', 'Bevest', '2026-10-05', '10:00', 0), lead('n1', 'Verstraete', 6)];
    await startSalesApp(page, { leads, blokken: [], instellingen: { vanTijd: '08:00', totTijd: '17:00', werkdagen: [1] } });
    await naarKalender(page);
    await plan(page).click();
    await expect(resultaat(page).getByText('Ingepland (1)', { exact: true })).toBeVisible();
    expect(verzoeken.van('/api/matrix', 'POST').length).toBeGreaterThanOrEqual(1);
  });

  test('titel, ✕ en Escape sluiten; secties Ingepland en Niet ingepland met het bolletje en de reden eronder', async ({ page }) => {
    const leads = [...achtLeads().slice(0, 2), lead('m1', 'Molenaar', 0, { postcode: null, gemeente: null, adresTekst: 'bij de molen', locatie: null })];
    await startSalesApp(page, { leads, blokken: [] });
    await naarKalender(page);
    await plan(page).click();
    await expect(resultaat(page)).toBeVisible();
    await expect(resultaat(page).locator('#result-titel')).toHaveText('⚡ Planningsresultaat');
    await expect(sectie(page, 'Ingepland (2)').locator('.result-item')).toHaveCount(2);
    await expect(sectie(page, 'Ingepland (2)').locator('.result-dot.ok')).toHaveCount(2);
    await expect(sectie(page, 'Ingepland (2)')).toContainText(/Test Aerts → .*5 okt/);
    await expect(sectie(page, 'Niet ingepland (1)').locator('.result-dot.skip')).toHaveCount(1);
    await expect(sectie(page, 'Niet ingepland (1)')).toContainText('Test Molenaar');
    await expect(sectie(page, 'Niet ingepland (1)')).toContainText('Adres niet gevonden');
    await page.keyboard.press('Escape');
    await expect(resultaat(page)).toBeHidden();
    await plan(page).click(); // de lead zonder locatie is nog te plannen: het venster komt opnieuw
    await expect(resultaat(page)).toBeVisible();
    await sluitResultaat(page);
    await expect(resultaat(page)).toBeHidden();
    await expect(plan(page)).toBeFocused(); // de focus keert terug naar de knop (die intussen opnieuw getekend is)
  });

  test('namen in het resultaat worden nooit als HTML getoond', async ({ page }) => {
    const gevaarlijk = '<img src=x onerror="window.__pwned=1">';
    await startSalesApp(page, { leads: [lead('x1', gevaarlijk, 0), lead('x2', 'Normaal', 1, { postcode: null, gemeente: null, adresTekst: 'ergens', locatie: null, voornaam: gevaarlijk })], blokken: [] });
    await naarKalender(page);
    await plan(page).click();
    await expect(resultaat(page)).toBeVisible();
    await expect(resultaat(page).locator('#result-body')).toContainText('<img src=x onerror="window.__pwned=1">');
    await expect(resultaat(page).locator('#result-body img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test('telefoonbreedte: het venster past binnen het scherm, geen horizontale scroll op de pagina', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await startSalesApp(page, { leads: [lead('l1', 'Een-heel-lange-familienaam-zonder-spaties-erin-voor-de-proef', 0), lead('l2', 'Janssens', 1)], blokken: [] });
    await naarKalender(page);
    await plan(page).click();
    await expect(resultaat(page)).toBeVisible();
    const m = await page.evaluate(() => ({
      breedte: document.getElementById('result-modal').getBoundingClientRect().width,
      overloop: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      binnen: document.getElementById('result-body').scrollWidth - document.getElementById('result-body').clientWidth,
    }));
    expect(m.breedte).toBeLessThanOrEqual(375);
    expect(m.overloop).toBeLessThanOrEqual(0);
    expect(m.binnen).toBeLessThanOrEqual(0);
  });

  test('de beheerder (subtab Kalender van "Sales") krijgt hetzelfde venster, en het sluit netjes', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, blobs: { 'sales/u-bea': { versie: 1, leads: achtLeads().slice(0, 3), blokken: [], grafstenen: [] } } });
    await tab(page, 'Sales').click();
    await page.getByRole('tablist', { name: 'Sales-onderdelen' }).getByRole('tab', { name: 'Kalender' }).click();
    await expect(kal(page).locator('.day-col[data-date]').first()).toBeVisible();
    await plan(page).click();
    await expect(resultaat(page).getByText('Ingepland (3)', { exact: true })).toBeVisible();
    await sluitResultaat(page);
    await expect(resultaat(page)).toBeHidden();
    await expect(kal(page).locator('.tl-block.sales-voorgesteld')).toHaveCount(3);
  });
});

// Buiten de testmodus (de pagina opnieuw laden zonder ?test): echte reistijden via /api/matrix, zoals bij de technieker. De stubs van de sales-server
// blijven testmodus; het depot staat in de geocache van het toestel, zodat er geen TomTom-geocoding nodig is.
test.describe('sales: Plan deze week buiten de testmodus (echte reistijden)', () => {
  const DEPOT = 'Depotstraat 1, 3500 Hasselt';
  const INSTELLING = { startlocatie: DEPOT, vanTijd: '08:00', totTijd: '17:00', werkdagen: [1] };
  const matrixMet = (minuten) => ({ body }) => ({
    status: 200, json: { results: (body?.destinations ?? []).map(() => ({ travelTimeSeconds: minuten * 60, distanceMeters: 50000 })) },
  });
  const startLive = async (page, { leads, instellingen = INSTELLING, overschrijf }) => {
    await page.addInitScript(({ adres }) => {
      if (window !== window.top) return;
      localStorage.setItem('blitz_geocache', JSON.stringify({ [adres.toLowerCase()]: { lat: 50.93, lon: 5.34, t: Date.now() } }));
    }, { adres: DEPOT });
    const backend = await startSalesApp(page, { instellingen, leads, blokken: [], overschrijf });
    await page.goto('/'); // zonder ?test
    await expect(tab(page, 'Leads')).toBeVisible();
    expect(await page.evaluate(() => new URLSearchParams(location.search).has('test'))).toBe(false);
    await naarKalender(page);
    return backend;
  };
  const metBevestigd = () => [bevestigd('b1', 'Bevest', '2026-10-05', '10:00', 0), lead('n1', 'Verstraete', 6, { locatie: { lat: 51.2, lon: 5.6, bron: 'adres' } })];

  test('het brein vraagt de reistijd op via /api/matrix; is die te lang, dan staat het bezoek onder Niet ingepland met de reden', async ({ page, verzoeken }) => {
    await startLive(page, { leads: metBevestigd(), overschrijf: { matrix: matrixMet(90) } });
    await plan(page).click();
    await expect(resultaat(page).getByText('Niet ingepland (1)', { exact: true })).toBeVisible();
    await expect(sectie(page, 'Niet ingepland')).toContainText('Test Verstraete');
    await expect(sectie(page, 'Niet ingepland')).toContainText('Te ver van de andere afspraken (meer dan 45 min)');
    await expect(resultaat(page).getByText(/Ingepland \(/)).toHaveCount(0);
    const oproepen = verzoeken.van('/api/matrix', 'POST');
    expect(oproepen.length).toBeGreaterThanOrEqual(1);
    for (const o of oproepen) {
      expect(typeof o.body.origin.lat).toBe('number');
      expect(o.body.destinations.length).toBeGreaterThanOrEqual(1);
    }
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]); // niets te bewaren: het bevestigde bezoek bleef, de lead bleef te plannen
  });

  test('een korte reistijd: het bezoek wordt voorgesteld', async ({ page, verzoeken }) => {
    await startLive(page, { leads: metBevestigd(), overschrijf: { matrix: matrixMet(10) } });
    await plan(page).click();
    await expect(resultaat(page).getByText('Ingepland (1)', { exact: true })).toBeVisible();
    await expect(resultaat(page).getByText(/Niet ingepland/)).toHaveCount(0);
    await expect(resultaat(page).getByText(/Reistijd kon niet gecontroleerd worden/)).toHaveCount(0);
    expect(verzoeken.van('/api/matrix', 'POST').length).toBeGreaterThanOrEqual(1);
    expect(verzoeken.van('/api/sales', 'PATCH')).toHaveLength(1);
  });

  test('de matrix valt uit: het bezoek wordt toch voorgesteld met de waarschuwing dat de reistijd geschat is', async ({ page, consoleFouten }) => {
    await startLive(page, {
      leads: metBevestigd(), instellingen: { ...INSTELLING, maxReistijdMin: 300 },
      overschrijf: { matrix: () => ({ status: 500, json: { error: 'matrix stuk' } }) },
    });
    await plan(page).click();
    await expect(resultaat(page).getByText('Ingepland (1)', { exact: true })).toBeVisible();
    await expect(resultaat(page).getByText('⚠ Reistijd kon niet gecontroleerd worden voor 1 bezoek — kijk de route na')).toBeVisible();
    await verwachtFout(consoleFouten, '/api/matrix', 500, 1);
  });
});
