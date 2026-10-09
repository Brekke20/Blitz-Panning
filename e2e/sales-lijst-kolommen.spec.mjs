import { test, expect } from './helpers.mjs';
import { startSalesApp, BEHEERDER } from './sales-hulp.mjs';

// Het scherm "Leads" in drie kolommen: Nog in te plannen | Ingepland | Bevestigd. Klok: maandag 5 okt 2026 09:00. Alle namen zijn verzonnen.
const lijst = (page) => page.locator('#view-sales-lijst');
const kolom = (page, sleutel) => lijst(page).locator(`.sales-kolom[data-kolom="${sleutel}"]`);
const kaartIn = (page, sleutel, naam) => kolom(page, sleutel).locator('.sales-kaart', { hasText: naam });
const namenIn = (page, sleutel) => kolom(page, sleutel).locator('.sales-kaart-titel').allTextContents();
const venster = (page) => page.locator('.sales-overlay.open');
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const kal = (page) => page.locator('#view-sales-kalender');

const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
const voorgesteld = (id, naam, datum, start, extra = {}) => lead(id, naam, { status: 'voorgesteld', planning: { datum, start, vast: false }, ...extra });
const bevestigd = (id, naam, datum, start, extra = {}) => lead(id, naam, { status: 'bevestigd', planning: { datum, start, vast: true }, ...extra });

const MIX = () => [
  lead('t2', 'Nieuw', { geimporteerdOp: '2026-10-04T08:00:00.000Z' }),
  lead('t1', 'Oud', { geimporteerdOp: '2026-09-20T08:00:00.000Z' }),
  voorgesteld('v-verlopen', 'Verlopen', '2026-10-02', '09:00', { geimporteerdOp: '2026-09-25T08:00:00.000Z' }),
  voorgesteld('v2', 'Dinsdag', '2026-10-06', '13:00'),
  voorgesteld('v1', 'Maandag', '2026-10-05', '15:00'),
  bevestigd('b2', 'Donderdag', '2026-10-08', '10:00'),
  bevestigd('b1', 'Dinsdagochtend', '2026-10-06', '08:30'),
  lead('z', 'Klaar', { status: 'afgewerkt', resultaat: { soort: 'verkocht', op: '2026-10-02T10:00:00.000Z' } }),
];

test.describe('sales: Leads in drie kolommen', () => {
  test('drie kolommen met titel en aantal, elk op zijn eigen sortering; afgewerkt ontbreekt; verlopen voorstel links met label', async ({ page }) => {
    await startSalesApp(page, { leads: MIX() });
    await expect(lijst(page).getByRole('heading', { name: 'Nog in te plannen (3)' })).toBeVisible();
    await expect(lijst(page).getByRole('heading', { name: 'Ingepland (2)' })).toBeVisible();
    await expect(lijst(page).getByRole('heading', { name: 'Bevestigd (2)' })).toBeVisible();
    // links: langst wachtende eerst (oudste import); midden en rechts: op datum en uur
    expect(await namenIn(page, 'tePlannen')).toEqual(['Test Oud', 'Test Verlopen', 'Test Nieuw']);
    expect(await namenIn(page, 'ingepland')).toEqual(['Test Maandag', 'Test Dinsdag']);
    expect(await namenIn(page, 'bevestigd')).toEqual(['Test Dinsdagochtend', 'Test Donderdag']);
    await expect(lijst(page).locator('.sales-kaart', { hasText: 'Test Klaar' })).toHaveCount(0);
    await expect(kaartIn(page, 'tePlannen', 'Test Verlopen').locator('.sales-chip-verlopen')).toHaveText('voorstel verlopen');
    await expect(kaartIn(page, 'ingepland', 'Test Maandag')).toContainText('ma 5 okt 15:00');
    await expect(kaartIn(page, 'bevestigd', 'Test Donderdag')).toContainText('do 8 okt 10:00');
  });

  test('breed scherm: de drie kolommen staan naast elkaar, in de volgorde links-midden-rechts, zonder tabbalk', async ({ page }) => {
    await startSalesApp(page, { viewport: { width: 1280, height: 800 }, leads: MIX() });
    await expect(lijst(page).locator('.sales-kolomtabs')).toBeHidden();
    const vakken = [];
    for (const k of ['tePlannen', 'ingepland', 'bevestigd']) { await expect(kolom(page, k)).toBeVisible(); vakken.push(await kolom(page, k).boundingBox()); }
    expect(vakken[0].x + vakken[0].width).toBeLessThanOrEqual(vakken[1].x + 1);
    expect(vakken[1].x + vakken[1].width).toBeLessThanOrEqual(vakken[2].x + 1);
    expect(Math.abs(vakken[0].y - vakken[1].y)).toBeLessThan(2);
    expect(Math.abs(vakken[1].y - vakken[2].y)).toBeLessThan(2);
    const b = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, venster: window.innerWidth }));
    expect(b.doc).toBeLessThanOrEqual(b.venster);
  });

  test('lege kolommen blijven staan met aantal 0 en een korte tekst', async ({ page }) => {
    await startSalesApp(page, { leads: [lead('t1', 'Enig')] });
    await expect(lijst(page).getByRole('heading', { name: 'Ingepland (0)' })).toBeVisible();
    await expect(lijst(page).getByRole('heading', { name: 'Bevestigd (0)' })).toBeVisible();
    await expect(kolom(page, 'ingepland')).toContainText('Geen voorgestelde bezoeken.');
    await expect(kolom(page, 'bevestigd')).toContainText('Geen bevestigde bezoeken.');
  });

  test('zoeken filtert in alle kolommen; de aantallen volgen', async ({ page }) => {
    await startSalesApp(page, { leads: MIX() });
    await lijst(page).getByLabel('Zoeken').fill('dinsdag');
    await expect(lijst(page).getByRole('heading', { name: 'Nog in te plannen (0)' })).toBeVisible();
    await expect(lijst(page).getByRole('heading', { name: 'Ingepland (1)' })).toBeVisible();
    await expect(lijst(page).getByRole('heading', { name: 'Bevestigd (1)' })).toBeVisible();
  });

  test('een lead verhuist: Plan deze week -> Ingepland, Bevestigen -> Bevestigd, Terug naar te plannen -> Nog in te plannen', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('t1', 'Verhuizer')], blokken: [] });
    await expect(kaartIn(page, 'tePlannen', 'Test Verhuizer')).toHaveCount(1);
    // links -> midden (Plan deze week in de kalender)
    await tab(page, 'Kalender').click();
    await expect(kal(page).locator('.day-col[data-date]').first()).toBeVisible();
    await kal(page).getByRole('button', { name: /Plan deze week/ }).click();
    await page.getByRole('dialog', { name: '⚡ Planningsresultaat' }).getByRole('button', { name: 'Sluiten' }).click();
    await tab(page, 'Leads').click();
    await expect(kaartIn(page, 'ingepland', 'Test Verhuizer')).toHaveCount(1);
    await expect(kolom(page, 'tePlannen').locator('.sales-kaart')).toHaveCount(0);
    await expect(lijst(page).getByRole('heading', { name: 'Ingepland (1)' })).toBeVisible();
    // midden -> rechts: knop Bevestigen op de kaart zelf (één PATCH)
    const voor = verzoeken.van('/api/sales', 'PATCH').length;
    await kaartIn(page, 'ingepland', 'Test Verhuizer').getByRole('button', { name: 'Bevestig Test Verhuizer' }).click();
    await expect(kaartIn(page, 'bevestigd', 'Test Verhuizer')).toHaveCount(1);
    await expect(kolom(page, 'ingepland').locator('.sales-kaart')).toHaveCount(0);
    await expect(lijst(page).getByRole('heading', { name: 'Bevestigd (1)' })).toBeVisible();
    const patches = verzoeken.van('/api/sales', 'PATCH');
    expect(patches).toHaveLength(voor + 1);
    expect(patches.at(-1).body.leads[0].velden).toMatchObject({ status: 'bevestigd', planning: { vast: true } });
    await expect(kaartIn(page, 'bevestigd', 'Test Verhuizer').getByRole('button', { name: /Bevestig/ })).toHaveCount(0);
    // rechts -> links: Terug naar te plannen in het detail
    await kaartIn(page, 'bevestigd', 'Test Verhuizer').locator('.sales-kaart-titel').click();
    await venster(page).getByRole('button', { name: 'Terug naar te plannen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(kaartIn(page, 'tePlannen', 'Test Verhuizer')).toHaveCount(1);
    await expect(kolom(page, 'bevestigd').locator('.sales-kaart')).toHaveCount(0);
    await expect(lijst(page).getByRole('heading', { name: 'Nog in te plannen (1)' })).toBeVisible();
  });

  test('Vast uur vastleggen vanuit een kaart in Ingepland: de lead staat rechts met het nieuwe uur', async ({ page }) => {
    await startSalesApp(page, { leads: [voorgesteld('v1', 'Wijziger', '2026-10-06', '09:00')] });
    await expect(kaartIn(page, 'ingepland', 'Test Wijziger')).toHaveCount(1);
    await kaartIn(page, 'ingepland', 'Test Wijziger').locator('.sales-kaart-titel').click();
    await venster(page).getByLabel('Datum', { exact: true }).fill('2026-10-07');
    await venster(page).getByLabel('Uur', { exact: true }).fill('11:15');
    await venster(page).getByRole('button', { name: 'Vast uur vastleggen' }).click();
    await expect(kaartIn(page, 'bevestigd', 'Test Wijziger')).toContainText('wo 7 okt 11:15');
    await expect(kolom(page, 'ingepland').locator('.sales-kaart')).toHaveCount(0);
  });

  test('verwijderen met ongedaan maken werkt in de linkerkolom; de aantallen volgen', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [lead('t1', 'Weg'), lead('t2', 'Blijf')] });
    await kaartIn(page, 'tePlannen', 'Test Weg').getByRole('button', { name: 'Verwijder Test Weg' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Verwijderen' }).click();
    await expect(lijst(page).getByRole('heading', { name: 'Nog in te plannen (1)' })).toBeVisible();
    await lijst(page).getByRole('button', { name: 'Ongedaan maken' }).click();
    await expect(lijst(page).getByRole('heading', { name: 'Nog in te plannen (2)' })).toBeVisible();
    await page.clock.runFor(10000);
    expect(verzoeken.van('/api/sales', 'DELETE')).toEqual([]);
  });

  test('het verwijderknopje (✕) staat enkel bij Nog in te plannen, niet bij ingeplande of bevestigde bezoeken', async ({ page }) => {
    await startSalesApp(page, { leads: MIX() });
    await expect(kolom(page, 'tePlannen').getByRole('button', { name: /Verwijder/ })).toHaveCount(3);
    await expect(kolom(page, 'ingepland').getByRole('button', { name: /Verwijder/ })).toHaveCount(0);
    await expect(kolom(page, 'bevestigd').getByRole('button', { name: /Verwijder/ })).toHaveCount(0);
    await expect(kolom(page, 'ingepland').getByRole('button', { name: /Bevestig/ })).toHaveCount(2); // Bevestigen blijft
    // een bevestigd bezoek verwijderen kan pas na Terug naar te plannen (in het detail)
    await kaartIn(page, 'bevestigd', 'Test Donderdag').locator('.sales-kaart-titel').click();
    await venster(page).getByRole('button', { name: 'Terug naar te plannen' }).click();
    await expect(kaartIn(page, 'tePlannen', 'Test Donderdag').getByRole('button', { name: 'Verwijder Test Donderdag' })).toHaveCount(1);
  });

  test('leadgegevens worden in elke kolom als tekst getoond (geen HTML)', async ({ page }) => {
    const gevaarlijk = '<img src=x onerror="window.__gehackt=1">';
    await startSalesApp(page, { leads: [
      lead('a', gevaarlijk), voorgesteld('b', gevaarlijk, '2026-10-06', '09:00'), bevestigd('c', gevaarlijk, '2026-10-07', '09:00'),
    ] });
    for (const k of ['tePlannen', 'ingepland', 'bevestigd']) await expect(kolom(page, k).locator('.sales-kaart-titel')).toHaveText(`Test ${gevaarlijk}`);
    await expect(lijst(page).locator('.sales-kaart img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__gehackt)).toBeUndefined();
  });

  test('de beheerder ziet dezelfde drie kolommen in zijn tab Sales', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER, leads: [], blobs: { 'sales/u-bea': { versie: 1, leads: MIX(), blokken: [], grafstenen: [] } } });
    await tab(page, 'Sales').click();
    await expect(lijst(page).getByRole('heading', { name: 'Nog in te plannen (3)' })).toBeVisible();
    await expect(lijst(page).getByRole('heading', { name: 'Ingepland (2)' })).toBeVisible();
    await expect(lijst(page).getByRole('heading', { name: 'Bevestigd (2)' })).toBeVisible();
    await expect(lijst(page).getByRole('button', { name: 'Export laden' })).toHaveCount(0);
  });
});

test.describe('sales: Leads op een telefoon (375 px)', () => {
  test('drie tabbladen met aantal, de eerste kolom toont zich; wisselen toont één kolom tegelijk; geen horizontale scroll', async ({ page }) => {
    await startSalesApp(page, { viewport: { width: 375, height: 812 }, leads: MIX() });
    const tabs = lijst(page).locator('.sales-kolomtabs');
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab')).toHaveCount(3);
    await expect(tabs.getByRole('tab').nth(0)).toHaveText('Nog in te plannen3');
    await expect(tabs.getByRole('tab').nth(1)).toHaveText('Ingepland2');
    await expect(tabs.getByRole('tab').nth(2)).toHaveText('Bevestigd2');
    await expect(tabs.getByRole('tab').nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(kolom(page, 'tePlannen')).toBeVisible();
    await expect(kolom(page, 'ingepland')).toBeHidden();
    await expect(kolom(page, 'bevestigd')).toBeHidden();
    await tabs.getByRole('tab').nth(1).click();
    await expect(kolom(page, 'ingepland')).toBeVisible();
    await expect(kolom(page, 'tePlannen')).toBeHidden();
    await expect(tabs.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
    await tabs.getByRole('tab').nth(2).click();
    await expect(kolom(page, 'bevestigd')).toBeVisible();
    await expect(kaartIn(page, 'bevestigd', 'Test Donderdag')).toBeVisible();
    const b = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, venster: window.innerWidth }));
    expect(b.doc).toBeLessThanOrEqual(b.venster);
  });

  test('de gekozen tab blijft staan na een wijziging (Bevestigen op de tab Ingepland)', async ({ page }) => {
    await startSalesApp(page, { viewport: { width: 375, height: 812 }, leads: [voorgesteld('v1', 'Eerste', '2026-10-06', '09:00'), voorgesteld('v2', 'Tweede', '2026-10-06', '11:00')] });
    const tabs = lijst(page).locator('.sales-kolomtabs');
    await tabs.getByRole('tab').nth(1).click();
    await kaartIn(page, 'ingepland', 'Test Eerste').getByRole('button', { name: /Bevestig/ }).click();
    await expect(tabs.getByRole('tab').nth(1)).toHaveText('Ingepland1');
    await expect(tabs.getByRole('tab').nth(2)).toHaveText('Bevestigd1');
    await expect(kolom(page, 'ingepland')).toBeVisible();
    await expect(kaartIn(page, 'ingepland', 'Test Tweede')).toBeVisible();
  });
});
