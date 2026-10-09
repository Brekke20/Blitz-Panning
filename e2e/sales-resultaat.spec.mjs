import { test, expect } from './helpers.mjs';
import { startSalesApp, salesStubs, verwachtFout, SALES_GEBRUIKER } from './sales-hulp.mjs';

// Resultaat van een bezoek en het scherm Afgewerkt (Task 15). De stubs zijn de echte server-handlers (VASTE_NU = ma 5 okt 2026).
// Het venster Resultaat wordt in Task 16 vanuit de kalender geopend; hier openen we het rechtstreeks via de module (zelfde module-instantie).
// Alle namen zijn verzonnen.
// De sales-schermen gebruiken Leaflet en handtekening niet: de CDN-scripts van index.html krijgen een leeg antwoord (een page-route gaat voor de
// context-routes van startApp). Zo hangt een trage of geblokkeerde CDN de test niet op en blijft het vangnet (consolefouten) schoon.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//, (route) => route.fulfill({
    status: 200, contentType: route.request().url().endsWith('.css') ? 'text/css' : 'application/javascript', body: '/* stub */',
  }));
});

const OPSLAG_TEKST = 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.';
const venster = (page) => page.locator('.sales-overlay.open');
const lijst = (page) => page.locator('#view-sales-lijst');
const afgewerkt = (page) => page.locator('#view-sales-afgewerkt');
const rij = (page, naam) => afgewerkt(page).locator('.sales-afgewerkt-rij', { hasText: naam });

// Wacht eerst tot de leads geladen zijn (de toestand is bij de start leeg).
const openResultaat = async (page, leadId) => {
  await expect.poll(() => page.evaluate(() => import('/js/schermen/sales-data.js').then(m => m.salesToestand().leads.length))).toBeGreaterThan(0);
  return page.evaluate((id) => import('/js/schermen/sales-resultaat.js').then(m => m.openResultaat(id)), leadId);
};

const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
const bevestigd = (id, naam, extra = {}) => lead(id, naam, { status: 'bevestigd', planning: { datum: '2026-10-06', start: '10:00', vast: true }, ...extra });
const klaar = (id, naam, soort, datum, notitie, extra = {}) => lead(id, naam, {
  status: 'afgewerkt', resultaat: { soort, ...(notitie ? { notitie } : {}), op: `${datum}T10:00:00.000Z` },
  bezoeken: [{ datum, resultaat: soort, ...(notitie ? { notitie } : {}), op: `${datum}T10:00:00.000Z` }], ...extra,
});

test.describe('sales: resultaat ingeven', () => {
  test('"Verkocht" + notitie: één PATCH met enkel de velden uit geefResultaat; lead weg uit Te plannen en in Afgewerkt met datum en notitie', async ({ page, verzoeken }) => {
    const backend = await startSalesApp(page, { leads: [bevestigd('l1', 'Verhaegen'), lead('l2', 'Maes')] });
    await expect(lijst(page).locator('.sales-kaart', { hasText: 'Verhaegen' })).toBeVisible();
    await openResultaat(page, 'l1');
    await expect(page.locator('.sales-overlay.open .mhdr-title')).toContainText('Verhaegen');
    for (const naam of ['Offerte', 'Verkocht', 'Geen interesse', 'Opnieuw langsgaan']) await expect(venster(page).getByRole('button', { name: naam })).toBeVisible();
    await venster(page).getByLabel('Notitie').fill('Wil twee laadpalen, <b>vrijdag</b> bellen');
    await venster(page).getByRole('button', { name: 'Verkocht' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(page.locator('#toast')).toContainText('Resultaat bewaard');

    const patch = verzoeken.van('/api/sales', 'PATCH');
    expect(patch).toHaveLength(1);
    const item = patch[0].body.leads;
    expect(item).toHaveLength(1);
    expect(item[0].id).toBe('l1');
    expect(Object.keys(item[0].velden).sort()).toEqual(['bezoeken', 'planning', 'resultaat', 'status']);
    expect(item[0].velden.status).toBe('afgewerkt');
    expect(item[0].velden.planning).toBeNull();
    expect(item[0].velden.resultaat.soort).toBe('verkocht');
    expect(item[0].velden.resultaat.notitie).toBe('Wil twee laadpalen, <b>vrijdag</b> bellen');
    expect(item[0].velden.bezoeken).toHaveLength(1);
    expect(item[0].velden.bezoeken[0]).toMatchObject({ datum: '2026-10-06', resultaat: 'verkocht' });

    // Te plannen: weg
    await expect(lijst(page).locator('.sales-kaart', { hasText: 'Verhaegen' })).toHaveCount(0);
    await expect(lijst(page).locator('.sales-kaart', { hasText: 'Maes' })).toBeVisible();
    // Afgewerkt: met resultaat, datum en notitie (letterlijke tekst, niet als HTML)
    await page.getByRole('tab', { name: 'Afgewerkt', exact: true }).click();
    const r = rij(page, 'Verhaegen');
    await expect(r).toBeVisible();
    await expect(r).toContainText('Verkocht');
    await expect(r).toContainText('di 6 okt');
    await expect(r).toContainText('Wil twee laadpalen, <b>vrijdag</b> bellen');
    await expect(r.locator('b')).toHaveCount(0);
    // opgeslagen in de blob
    const blob = await backend.test.get('sales/u-test', { type: 'json' });
    expect(blob.leads.find(l => l.id === 'l1')).toMatchObject({ status: 'afgewerkt', resultaat: { soort: 'verkocht' } });
    expect(blob.leads.find(l => l.id === 'l1').planning).toBeUndefined();
  });

  test('"Opnieuw langsgaan": lead terug in "Nog in te plannen", het bezoek staat in de historiek en niet in Afgewerkt', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [bevestigd('l1', 'Verhaegen')] });
    await expect(lijst(page).locator('.sales-groep', { hasText: 'Ingepland' })).toBeVisible();
    await openResultaat(page, 'l1');
    await venster(page).getByLabel('Notitie').fill('Niet thuis');
    await venster(page).getByRole('button', { name: 'Opnieuw langsgaan' }).click();
    await expect(venster(page)).toHaveCount(0);

    const patch = verzoeken.van('/api/sales', 'PATCH');
    expect(patch).toHaveLength(1);
    const velden = patch[0].body.leads[0].velden;
    expect(velden.status).toBe('te-plannen');
    expect(velden.planning).toBeNull();
    expect(velden.resultaat).toBeNull();
    expect(velden.bezoeken).toHaveLength(1);
    expect(velden.bezoeken[0]).toMatchObject({ datum: '2026-10-06', resultaat: 'opnieuw', notitie: 'Niet thuis' });

    const groep = lijst(page).locator('.sales-groep', { hasText: 'Nog in te plannen' });
    await expect(groep.locator('.sales-kaart', { hasText: 'Verhaegen' })).toBeVisible();
    await expect(lijst(page).locator('.sales-groep', { hasText: 'Ingepland' })).toHaveCount(0);
    await groep.locator('.sales-kaart', { hasText: 'Verhaegen' }).click();
    await expect(venster(page).locator('.sales-historiek')).toContainText('Opnieuw langsgaan');
    await expect(venster(page).locator('.sales-historiek')).toContainText('Niet thuis');
    await venster(page).getByRole('button', { name: 'Sluiten' }).click();
    await page.getByRole('tab', { name: 'Afgewerkt', exact: true }).click();
    await expect(afgewerkt(page).locator('.sales-afgewerkt-rij')).toHaveCount(0);
    await expect(afgewerkt(page)).toContainText('Nog geen afgewerkte leads.');
  });

  test('dubbelklik: precies één PATCH (de knoppen zijn tijdens de aanvraag uitgeschakeld)', async ({ page, verzoeken }) => {
    const echte = salesStubs({ leads: [bevestigd('l1', 'Verhaegen')] });
    const sales = async (z) => {
      if (z.methode === 'PATCH') await new Promise(r => setTimeout(r, 400));
      return echte.sales(z);
    };
    await startSalesApp(page, { leads: [bevestigd('l1', 'Verhaegen')], overschrijf: { sales } });
    await openResultaat(page, 'l1');
    const knop = venster(page).getByRole('button', { name: 'Offerte' });
    await knop.dblclick();
    // tijdens de aanvraag: alle vier uitgeschakeld
    await expect(venster(page).getByRole('button', { name: 'Verkocht' })).toBeDisabled();
    await expect(venster(page)).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH')).toHaveLength(1);
    await page.getByRole('tab', { name: 'Afgewerkt', exact: true }).click();
    await expect(rij(page, 'Verhaegen')).toContainText('Offerte');
  });

  test('een 503 opslag-storing: melding in het venster, venster blijft open, knoppen weer bruikbaar, de lead blijft staan', async ({ page, consoleFouten }) => {
    const echte = salesStubs({ leads: [bevestigd('l1', 'Verhaegen')] });
    const sales = async (z) => (z.methode === 'PATCH' ? { status: 503, json: { error: OPSLAG_TEKST, code: 'opslag-storing' } } : echte.sales(z));
    await startSalesApp(page, { leads: [bevestigd('l1', 'Verhaegen')], overschrijf: { sales } });
    await openResultaat(page, 'l1');
    await venster(page).getByLabel('Notitie').fill('Blijft staan');
    await venster(page).getByRole('button', { name: 'Verkocht' }).click();
    await expect(venster(page).locator('.sales-venster-fout')).toHaveText(OPSLAG_TEKST);
    await expect(venster(page).getByRole('button', { name: 'Verkocht' })).toBeEnabled();
    await expect(venster(page).getByLabel('Notitie')).toHaveValue('Blijft staan');
    await expect(lijst(page).locator('.sales-kaart', { hasText: 'Verhaegen' })).toBeVisible();
    await verwachtFout(consoleFouten, '/api/sales', 503);
  });

  test('een 409: het bezoek wordt op de verse stand opnieuw samengesteld (de historiek van de server blijft behouden)', async ({ page, verzoeken, consoleFouten }) => {
    const echte = salesStubs({ leads: [bevestigd('l1', 'Verhaegen')] });
    const eerder = { datum: '2026-10-01', resultaat: 'opnieuw', op: '2026-10-01T10:00:00.000Z' };
    const serverStand = { versie: 5, gebruikerId: 'u-test', leads: [bevestigd('l1', 'Verhaegen', { bezoeken: [eerder] })], blokken: [] };
    let aantal = 0;
    const sales = async (z) => {
      if (z.methode !== 'PATCH') return echte.sales(z);
      aantal += 1;
      if (aantal === 1) return { status: 409, json: { error: 'Gegevens zijn intussen gewijzigd', data: serverStand } };
      return { status: 200, json: { ...serverStand, versie: 6, open: 0 } };
    };
    await startSalesApp(page, { leads: [bevestigd('l1', 'Verhaegen')], overschrijf: { sales } });
    await openResultaat(page, 'l1');
    await venster(page).getByRole('button', { name: 'Offerte' }).click();
    await expect(venster(page)).toHaveCount(0);
    const patches = verzoeken.van('/api/sales', 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[0].body.leads[0].velden.bezoeken).toHaveLength(1);
    expect(patches[1].body.versie).toBe(5);
    expect(patches[1].body.leads[0].velden.bezoeken).toHaveLength(2);
    expect(patches[1].body.leads[0].velden.bezoeken[0]).toMatchObject({ resultaat: 'opnieuw' });
    expect(patches[1].body.leads[0].velden.bezoeken[1]).toMatchObject({ resultaat: 'offerte' });
    await verwachtFout(consoleFouten, '/api/sales', 409);
  });

  test('een afgewerkte of onbekende lead opent geen venster; de notitie is beperkt tot 1000 tekens', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: [bevestigd('l1', 'Verhaegen'), klaar('l2', 'Maes', 'verkocht', '2026-10-01')] });
    expect(await openResultaat(page, 'l2')).toBeNull();
    expect(await openResultaat(page, 'bestaat-niet')).toBeNull();
    await expect(venster(page)).toHaveCount(0);
    await openResultaat(page, 'l1');
    await expect(venster(page).getByLabel('Notitie')).toHaveAttribute('maxlength', '1000');
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
  });

  test('alleen-lezen weergave (verkoper met "alle sales" bekijkt een collega): geen venster', async ({ page, verzoeken }) => {
    const ik = { ...SALES_GEBRUIKER, magAlleSales: true };
    await startSalesApp(page, { gebruiker: ik, blobs: { 'sales/u-bea': { versie: 1, leads: [bevestigd('l1', 'Verhaegen')], blokken: [], grafstenen: [] } } });
    await lijst(page).locator('.sales-verkoper-keuze').selectOption('u-bea');
    await expect(lijst(page).locator('.sales-kaart', { hasText: 'Verhaegen' })).toBeVisible();
    expect(await openResultaat(page, 'l1')).toBeNull();
    await expect(venster(page)).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH')).toEqual([]);
  });
});

test.describe('sales: Afgewerkt', () => {
  const leads = () => [
    klaar('a1', 'Offerte-klant', 'offerte', '2026-10-02', 'Offerte verstuurd'),
    klaar('a2', 'Verkocht-klant', 'verkocht', '2026-09-20', 'Twee palen'),
    klaar('a3', 'Interesseloos', 'geen-interesse', '2026-08-01'),
    klaar('a4', 'Oude-klant', 'verkocht', '2025-06-01', 'Lang geleden'),
    bevestigd('b1', 'Nog-bezig'),
  ];

  test('rijen nieuwste eerst; filter op resultaat en periode; een afgewerkte lead opent het detail', async ({ page }) => {
    await startSalesApp(page, { leads: leads() });
    await page.getByRole('tab', { name: 'Afgewerkt', exact: true }).click();
    const rijen = afgewerkt(page).locator('.sales-afgewerkt-rij');
    await expect(rijen).toHaveCount(4);
    await expect(rijen.nth(0)).toContainText('Offerte-klant');
    await expect(rijen.nth(1)).toContainText('Verkocht-klant');
    await expect(rijen.nth(3)).toContainText('Oude-klant');
    await expect(afgewerkt(page)).not.toContainText('Nog-bezig');

    await afgewerkt(page).getByLabel('Resultaat').selectOption('offerte');
    await expect(rijen).toHaveCount(1);
    await expect(rijen.first()).toContainText('Offerte verstuurd');
    await expect(rijen.first()).toContainText('vr 2 okt');

    await afgewerkt(page).getByLabel('Resultaat').selectOption('');
    await afgewerkt(page).getByLabel('Periode').selectOption('30d');
    await expect(rijen).toHaveCount(2);                         // 2 okt en 20 sep (VASTE_NU 5 okt): 1 aug en 2025 vallen af
    await afgewerkt(page).getByLabel('Resultaat').selectOption('verkocht');
    await expect(rijen).toHaveCount(1);
    await expect(rijen.first()).toContainText('Verkocht-klant');
    await afgewerkt(page).getByLabel('Resultaat').selectOption('geen-interesse');
    await expect(rijen).toHaveCount(0);
    await expect(afgewerkt(page)).toContainText('Geen afgewerkte leads voor deze keuze.');

    await afgewerkt(page).getByLabel('Resultaat').selectOption('');
    await afgewerkt(page).getByLabel('Periode').selectOption('alles');
    await rijen.first().click();
    await expect(venster(page)).toBeVisible();
    await expect(venster(page).locator('.sales-historiek')).toContainText('Offerte');
  });

  test('"Terug naar te plannen" in het detail haalt de lead uit Afgewerkt', async ({ page }) => {
    await startSalesApp(page, { leads: leads() });
    await page.getByRole('tab', { name: 'Afgewerkt', exact: true }).click();
    await rij(page, 'Verkocht-klant').click();
    await venster(page).getByRole('button', { name: 'Terug naar te plannen' }).click();
    await expect(venster(page)).toHaveCount(0);
    await expect(rij(page, 'Verkocht-klant')).toHaveCount(0);
    await expect(afgewerkt(page).locator('.sales-afgewerkt-rij')).toHaveCount(3);
  });

  test('geen horizontale scroll op telefoonbreedte, ook met lange namen en notities', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const lang = 'Ditiseenheellangenotitiezonderspatiesdieopeensmalschermnietmagoverlopen'.repeat(2);
    await startSalesApp(page, { leads: [klaar('a1', 'Ditiseenheellangeachternaamzonderspaties'.repeat(2), 'verkocht', '2026-10-02', lang)] });
    await page.getByRole('tab', { name: 'Afgewerkt', exact: true }).click();
    await expect(afgewerkt(page).locator('.sales-afgewerkt-rij')).toHaveCount(1);
    const overloop = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overloop).toBeLessThanOrEqual(0);
  });
});
