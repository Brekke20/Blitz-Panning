import { test, expect } from './helpers.mjs';
import { startSalesApp, verwachtFout, BEHEERDER } from './sales-hulp.mjs';

// Route en kaart van de verkoper (Task 18). De stubs zijn de echte server-handlers; VASTE_NU = ma 5 okt 2026, 09:00 (de gekozen dag).
// De kaart is echt Leaflet (CDN); de tegels zijn gestubd door startApp. Alle namen zijn verzonnen.
const DAG = '2026-10-05';
const VOLGENDE_DAG = '2026-10-06';
const route = (page) => page.locator('#view-sales-route');
const rijen = (page) => route(page).locator('.sales-route-lijst > .sales-route-rij:not(.sales-route-depot)');
const markers = (page) => page.locator('#sales-kaart .leaflet-marker-icon');
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const naarRoute = async (page) => { await tab(page, 'Route').click(); await expect(route(page)).toHaveClass(/active/); };
const handtekening = (page) => route(page).locator('.sales-route-wortel').getAttribute('data-handtekening');

const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'adres' }, status: 'te-plannen', bezoeken: [], duurMin: 30,
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
const plan = (id, naam, start, extra = {}) => {
  const { datum = DAG, vast = false, ...rest } = extra;
  return lead(id, naam, { status: vast ? 'bevestigd' : 'voorgesteld', planning: { datum, start, vast }, ...rest });
};
// Drie bezoeken op ma 5 okt, bewust niet op volgorde in de lijst; Maes staat enkel op de postcode ("ongeveer").
const DRIE = () => [
  plan('l2', 'Maes', '11:00', { vast: true, locatie: { lat: 50.95, lon: 5.4, bron: 'postcode' } }),
  plan('l1', 'Verhaegen', '09:00', { locatie: { lat: 50.93, lon: 5.34, bron: 'adres' } }),
  plan('l3', 'Peeters', '10:00', { locatie: { lat: 50.97, lon: 5.45, bron: 'adres' } }),
  lead('l4', 'Teplannen'),
];
// Het depot staat in de geocache van het toestel (zoals na een eerdere route), zodat het niet van TomTom komt.
const metDepot = (page, adres = 'Depotstraat 1, 3500 Hasselt', lat = 50.93, lon = 5.34) => page.addInitScript(({ adres, lat, lon }) => {
  if (window !== window.top) return;
  localStorage.setItem('blitz_geocache', JSON.stringify({ [adres.toLowerCase()]: { lat, lon, t: Date.now() } }));
}, { adres, lat, lon });
const DEPOT_INSTELLING = { startlocatie: 'Depotstraat 1, 3500 Hasselt', vanTijd: '08:00', totTijd: '17:00' };

test.describe('sales: route en kaart', () => {
  test('dag met 3 bezoeken: lijst op uur, kaart met 3 markers waarvan 1 "ongeveer", samenvatting, geen /api/route in testmodus', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: DRIE() });
    await naarRoute(page);
    await expect(rijen(page)).toHaveCount(3);
    await expect(rijen(page).locator('.sales-route-naam')).toHaveText(['Test Verhaegen', 'Test Peeters', 'Test Maes']);
    await expect(rijen(page).locator('.sales-route-uur')).toHaveText(['09:00 · 30 min', '10:00 · 30 min', '11:00 · 30 min']);
    await expect(rijen(page).locator('.sales-route-nr')).toHaveText(['1', '2', '3']);
    // enkel de rij met een postcode-locatie is "ongeveer"
    await expect(route(page).locator('.sales-route-ongeveer')).toHaveCount(1);
    await expect(rijen(page).nth(2).locator('.sales-route-ongeveer')).toContainText('ongeveer — enkel postcode');
    // kaart: 3 markers, 1 met de klasse sales-marker-ongeveer (het depot is geen marker)
    await expect(markers(page)).toHaveCount(3);
    await expect(page.locator('#sales-kaart .sales-marker-ongeveer')).toHaveCount(1);
    await expect(page.locator('#sales-kaart .sales-marker-ongeveer')).toHaveText('3');
    await expect(route(page).locator('.sales-route-samenvatting')).toContainText('3 bezoeken');
    await expect(route(page).locator('.sales-route-samenvatting')).toContainText('1 ongeveer');
    // ritten tussen de bezoeken zijn geschat in testmodus; de toast meldt het
    await expect(rijen(page).nth(1).locator('.sales-route-rit')).toContainText('rit ca.');
    await expect(page.locator('#toast')).toContainText('Rit geschat');
    expect(verzoeken.van('/api/route')).toEqual([]);
    expect(await handtekening(page)).toContain('l1@');
    // de wachtende lead (Teplannen) staat er niet bij
    await expect(route(page)).not.toContainText('Teplannen');
  });

  test('de popup van een "ongeveer"-marker zegt "ongeveer — enkel postcode"; een exacte marker niet', async ({ page }) => {
    await startSalesApp(page, { leads: DRIE() });
    await naarRoute(page);
    await expect(markers(page)).toHaveCount(3);
    await page.locator('#sales-kaart .sales-marker-ongeveer').click();
    await expect(page.locator('#sales-kaart .leaflet-popup-content')).toContainText('3. Test Maes');
    await expect(page.locator('#sales-kaart .leaflet-popup-content')).toContainText('ongeveer — enkel postcode');
    await page.locator('#sales-kaart .leaflet-popup-close-button').click();
    await expect(page.locator('#sales-kaart .leaflet-popup')).toHaveCount(0);
    await page.locator('#sales-kaart .leaflet-marker-icon:not(.sales-marker-ongeveer)').first().click();
    await expect(page.locator('#sales-kaart .leaflet-popup-content')).toContainText('Test Verhaegen');
    await expect(page.locator('#sales-kaart .leaflet-popup-content')).not.toContainText('ongeveer');
  });

  test('een dag zonder bezoeken toont de lege tekst en geen kaart; ‹ en › wisselen van dag', async ({ page }) => {
    await startSalesApp(page, { leads: [plan('l1', 'Verhaegen', '09:00', { datum: VOLGENDE_DAG })] });
    await naarRoute(page);
    await expect(route(page).getByText('Geen bezoeken op deze dag')).toBeVisible();
    await expect(page.locator('#sales-kaart')).toBeHidden();
    await expect(route(page).locator('.sales-route-datum')).toHaveText('ma 5 okt');
    await route(page).getByRole('button', { name: 'Volgende dag' }).click();
    await expect(route(page).locator('.sales-route-datum')).toHaveText('di 6 okt');
    await expect(rijen(page)).toHaveCount(1);
    await expect(markers(page)).toHaveCount(1);
    await expect(route(page).locator('.sales-route-samenvatting')).toContainText('1 bezoek');
    await expect(route(page).getByText('Geen bezoeken op deze dag')).toBeHidden();
    await route(page).getByRole('button', { name: 'Vorige dag' }).click();
    await expect(route(page).getByText('Geen bezoeken op deze dag')).toBeVisible();
    await expect(page.locator('#sales-kaart')).toBeHidden();
    // en weer terug: de kaart is opnieuw opgemeten en toont zijn marker
    await route(page).getByRole('button', { name: 'Volgende dag' }).click();
    await expect(markers(page)).toHaveCount(1);
    await expect(page.locator('#sales-kaart')).toBeVisible();
    // de datumkiezer werkt ook
    await route(page).getByLabel('Kies een dag').fill(DAG);
    await expect(route(page).getByText('Geen bezoeken op deze dag')).toBeVisible();
  });

  test('een bezoek dat het vorige niet haalt toont "⚠ haalt het volgende bezoek niet (+N min)" bij het vorige bezoek', async ({ page }) => {
    await startSalesApp(page, {
      leads: [
        plan('l1', 'Verhaegen', '09:00', { locatie: { lat: 50.93, lon: 5.34, bron: 'adres' } }),
        // ~100 km verder, maar al 5 minuten na het einde van het vorige bezoek
        plan('l3', 'Peeters', '09:35', { locatie: { lat: 51.22, lon: 4.4, bron: 'adres' } }),
        plan('l5', 'Janssens', '15:00', { locatie: { lat: 51.2, lon: 4.45, bron: 'adres' } }),
      ],
    });
    await naarRoute(page);
    await expect(rijen(page)).toHaveCount(3);
    await expect(rijen(page).nth(0).locator('.sales-route-waarschuwing')).toHaveText(/^⚠ haalt het volgende bezoek niet \(\+\d+ min\)$/);
    await expect(rijen(page).nth(1).locator('.sales-route-waarschuwing')).toHaveCount(0);
    await expect(rijen(page).nth(2).locator('.sales-route-waarschuwing')).toHaveCount(0);
    await expect(rijen(page).nth(1)).toHaveClass(/sales-route-laat/);
  });

  test('het eerste bezoek wordt gecontroleerd vanaf het vertrek uit het depot (begin van de werkdag)', async ({ page }) => {
    await metDepot(page);
    // depot (Hasselt) -> Antwerpse kant: ~1u55; werkdag begint om 08:00, het bezoek is er om 08:10
    await startSalesApp(page, { instellingen: DEPOT_INSTELLING, leads: [plan('l1', 'Claes', '08:10', { locatie: { lat: 51.22, lon: 4.4, bron: 'adres' } })] });
    await naarRoute(page);
    await expect(rijen(page)).toHaveCount(1);
    const depotRij = route(page).locator('.sales-route-depot');
    await expect(depotRij).toContainText('Vertrek: Depotstraat 1, 3500 Hasselt');
    await expect(depotRij.locator('.sales-route-waarschuwing')).toHaveText(/^⚠ haalt het volgende bezoek niet \(\+\d+ min\)$/);
    await expect(rijen(page).first()).toHaveClass(/sales-route-laat/);
  });

  test('een haalbaar eerste bezoek (met depot) geeft geen waarschuwing en de rit staat bij het bezoek', async ({ page }) => {
    await metDepot(page);
    await startSalesApp(page, { instellingen: DEPOT_INSTELLING, leads: [plan('l1', 'Claes', '11:00', { locatie: { lat: 51.22, lon: 4.4, bron: 'adres' } })] });
    await naarRoute(page);
    await expect(rijen(page)).toHaveCount(1);
    await expect(rijen(page).first().locator('.sales-route-rit')).toContainText('rit ca.');
    await expect(route(page).locator('.sales-route-waarschuwing')).toHaveCount(0);
    await expect(route(page).locator('.sales-route-samenvatting')).toContainText('rijden (geschat)');
  });

  test('zonder startadres: geen vertrekrij, een melding en geen valse waarschuwing', async ({ page }) => {
    await startSalesApp(page, { leads: DRIE() });
    await naarRoute(page);
    await expect(route(page).locator('.sales-route-lijstvak .sales-route-nota')).toContainText('Geen startlocatie ingesteld');
    await expect(route(page).locator('.sales-route-depot')).toHaveCount(0);
    await expect(route(page).locator('.sales-route-waarschuwing')).toHaveCount(0);
  });

  test('een adres invullen (postcode -> volledig adres) herberekent de route: melding "Route herberekend" en een andere handtekening', async ({ page, verzoeken }) => {
    await startSalesApp(page, { leads: DRIE() });
    await naarRoute(page);
    await expect(markers(page)).toHaveCount(3);
    await expect(page.locator('#sales-kaart .sales-marker-ongeveer')).toHaveCount(1);
    await expect(route(page).locator('.sales-route-melding')).toBeHidden();
    const voor = await handtekening(page);
    expect(voor).toBeTruthy();

    await page.evaluate(() => import('/js/schermen/sales-detail.js').then(m => m.openLeadDetail('l2')));
    const venster = page.locator('.sales-overlay.open');
    await venster.getByLabel('Straat').fill('Dorpsstraat');
    await venster.getByLabel('Huisnummer').fill('12');
    await venster.getByRole('button', { name: 'Opslaan' }).click();
    await expect(venster).toHaveCount(0);
    expect(verzoeken.van('/api/sales', 'PATCH').length).toBeGreaterThanOrEqual(1);

    await expect(route(page).locator('.sales-route-melding')).toHaveText('Route herberekend');
    await expect.poll(() => handtekening(page)).not.toBe(voor);
    // het bezoek staat nu op zijn echte adres: niet meer "ongeveer", wel nog 3 markers
    await expect(route(page).locator('.sales-route-ongeveer')).toHaveCount(0);
    await expect(page.locator('#sales-kaart .sales-marker-ongeveer')).toHaveCount(0);
    await expect(markers(page)).toHaveCount(3);
    expect(verzoeken.van('/api/route')).toEqual([]);
  });

  test('een lead zonder locatie staat in de lijst maar niet op de kaart; de rit eromheen is onbekend (geen waarschuwing)', async ({ page }) => {
    await startSalesApp(page, {
      leads: [
        plan('l1', 'Verhaegen', '09:00'),
        plan('l2', 'Zonderadres', '09:35', { locatie: null, postcode: null, gemeente: null }),
        plan('l3', 'Peeters', '10:10', { locatie: { lat: 51.22, lon: 4.4, bron: 'adres' } }),
      ],
    });
    await naarRoute(page);
    await expect(rijen(page)).toHaveCount(3);
    await expect(markers(page)).toHaveCount(2);
    await expect(rijen(page).nth(1).locator('.sales-route-geenloc')).toContainText('geen locatie');
    await expect(route(page).locator('.sales-route-waarschuwing')).toHaveCount(0);
  });

  test('een klik op een bezoek opent het detail; de knop Resultaat opent het resultaatvenster', async ({ page }) => {
    await startSalesApp(page, { leads: DRIE() });
    await naarRoute(page);
    await expect(rijen(page)).toHaveCount(3);
    await rijen(page).first().locator('.sales-route-naam').click();
    const venster = page.locator('.sales-overlay.open');
    await expect(venster.locator('.mhdr-title')).toHaveText('Test Verhaegen');
    await venster.getByRole('button', { name: 'Sluiten' }).first().click();
    await expect(venster).toHaveCount(0);
    await rijen(page).nth(1).getByRole('button', { name: /Resultaat/ }).click();
    await expect(page.locator('.sales-overlay.open .mhdr-title')).toHaveText('Resultaat — Test Peeters');
  });

  test('leadgegevens worden nooit als HTML getoond (lijst en popup)', async ({ page }) => {
    await startSalesApp(page, { leads: [plan('l1', '<img src=x onerror="window.__pwned=1">', '09:00')] });
    await naarRoute(page);
    await expect(rijen(page)).toHaveCount(1);
    await expect(rijen(page).first().locator('.sales-route-naam')).toContainText('<img src=x onerror="window.__pwned=1">');
    await expect(route(page).locator('.sales-route-lijst img')).toHaveCount(0);
    await expect(markers(page)).toHaveCount(1);
    await markers(page).first().click();
    await expect(page.locator('#sales-kaart .leaflet-popup-content')).toContainText('<img src=x');
    await expect(page.locator('#sales-kaart .leaflet-popup-content img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test('telefoonbreedte: geen horizontale scroll met lange namen en een lang startadres', async ({ page }) => {
    await metDepot(page, 'Een-heel-lange-straatnaam-zonder-spaties-en-zonder-einde 1, 3500 Hasselt');
    await page.setViewportSize({ width: 375, height: 700 });
    await startSalesApp(page, {
      instellingen: { ...DEPOT_INSTELLING, startlocatie: 'Een-heel-lange-straatnaam-zonder-spaties-en-zonder-einde 1, 3500 Hasselt' },
      leads: [
        plan('l1', 'Verhaegen-met-een-heel-lange-familienaam-zonder-spaties-erin', '09:00'),
        plan('l2', 'Peeters', '09:35', { locatie: { lat: 51.22, lon: 4.4, bron: 'postcode' }, gemeente: 'Een-lange-gemeentenaam-zonder-spaties-voor-de-test' }),
      ],
    });
    await naarRoute(page);
    await expect(rijen(page)).toHaveCount(2);
    await expect(markers(page)).toHaveCount(2);
    const overloop = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overloop).toBeLessThanOrEqual(0);
    const kaartBreedte = await page.locator('#sales-kaart').evaluate((e) => e.getBoundingClientRect().width);
    expect(kaartBreedte).toBeLessThanOrEqual(375);
  });
});

// Buiten de testmodus (de pagina opnieuw laden zonder ?test): de echte /api/route-aanvraag; de stubs van de sales-server blijven testmodus.
test.describe('sales: route buiten de testmodus', () => {
  const routeStub = (legs, uitvoer = {}) => async ({ body }) => ({
    status: 200,
    json: { legs: legs.slice(0, body.waypoints.length - 1), polyline: body.waypoints.map((w) => [w.lat, w.lon]), ...uitvoer },
  });
  const LEADS = () => [
    plan('l1', 'Verhaegen', '09:00', { datum: VOLGENDE_DAG, locatie: { lat: 50.93, lon: 5.34, bron: 'adres' } }),
    plan('l3', 'Peeters', '10:00', { datum: VOLGENDE_DAG, locatie: { lat: 50.97, lon: 5.45, bron: 'adres' } }),
  ];
  const startLive = async (page, routeAntwoord) => {
    await metDepot(page);
    await startSalesApp(page, { instellingen: DEPOT_INSTELLING, leads: LEADS(), overschrijf: { route: routeAntwoord } });
    await page.goto('/'); // zonder ?test
    await expect(tab(page, 'Te plannen')).toBeVisible();
    expect(await page.evaluate(() => new URLSearchParams(location.search).has('test'))).toBe(false);
    await naarRoute(page);
    await route(page).getByRole('button', { name: 'Volgende dag' }).click();
    await expect(rijen(page)).toHaveCount(2);
  };

  test('POST /api/route met depot + bezoeken en departAt; de ritten van TomTom worden gebruikt en de keten gecontroleerd', async ({ page, verzoeken }) => {
    // depot -> 1: 10 min; 1 -> 2: 75 min (bezoek 1 eindigt 09:30, bezoek 2 begint 10:00 -> +45 min te laat)
    await startLive(page, routeStub([{ travelTimeSeconds: 600, distanceMeters: 9000 }, { travelTimeSeconds: 4500, distanceMeters: 70000 }]));
    await expect(rijen(page).nth(0).locator('.sales-route-waarschuwing')).toHaveText('⚠ haalt het volgende bezoek niet (+45 min)');
    await expect(rijen(page).nth(0).locator('.sales-route-rit')).toHaveText('rit 10min · 9 km');
    await expect(rijen(page).nth(1).locator('.sales-route-rit')).toHaveText('rit 1u 15min · 70 km');
    await expect(route(page).locator('.sales-route-samenvatting')).toContainText('79 km');
    await expect(route(page).locator('.sales-route-samenvatting')).not.toContainText('geschat');
    const oproepen = verzoeken.van('/api/route', 'POST');
    expect(oproepen).toHaveLength(1);
    expect(oproepen[0].body.waypoints).toEqual([{ lat: 50.93, lon: 5.34 }, { lat: 50.93, lon: 5.34 }, { lat: 50.97, lon: 5.45 }]);
    expect(oproepen[0].body.departAt).toBe(new Date(`${VOLGENDE_DAG}T08:00:00`).toISOString()); // vertrek = begin van de werkdag
    await expect(markers(page)).toHaveCount(2);
  });

  test('een mislukte route-aanvraag valt terug op geschatte ritten met de toast "Rit geschat"', async ({ page, verzoeken, consoleFouten }) => {
    await startLive(page, async () => ({ status: 500, json: { error: 'TomTom stuk' } }));
    await expect(page.locator('#toast')).toContainText('Rit geschat');
    await expect(rijen(page).nth(1).locator('.sales-route-rit')).toContainText('rit ca.');
    await expect(route(page).locator('.sales-route-samenvatting')).toContainText('(geschat)');
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);
    await verwachtFout(consoleFouten, '/api/route', 500);
  });
});

// De beheerder ziet het scherm als subtab van de ene tab "Sales" (de kaart is dan een eigen instantie naast de technieker-kaart).
test.describe('sales: route in het scherm van de beheerder', () => {
  test('subtab Route: lijst en kaart voor de gekozen verkoper, één sales-kaart, de technieker-kaart blijft ongemoeid', async ({ page }) => {
    await startSalesApp(page, {
      gebruiker: BEHEERDER,
      blobs: { 'sales/u-bea': { versie: 1, gebruikerId: 'u-bea', leads: DRIE(), blokken: [], grafstenen: [] } },
    });
    await tab(page, 'Sales').click();
    await page.locator('#sales-subtab-sales-route').click();
    await expect(route(page)).toBeVisible();
    await expect(rijen(page)).toHaveCount(3);
    await expect(markers(page)).toHaveCount(3);
    await expect(page.locator('#sales-kaart.leaflet-container')).toHaveCount(1);
    await expect(page.locator('#map .sales-marker')).toHaveCount(0);
    // heen en weer tussen subtabs: nog steeds één kaart, geen dubbele lijst
    await page.locator('#sales-subtab-sales-lijst').click();
    await page.locator('#sales-subtab-sales-route').click();
    await expect(rijen(page)).toHaveCount(3);
    await expect(markers(page)).toHaveCount(3);
    await expect(page.locator('#sales-kaart.leaflet-container')).toHaveCount(1);
    const afmeting = await page.locator('#sales-kaart').evaluate((e) => ({ b: e.clientWidth, h: e.clientHeight }));
    expect(afmeting.b).toBeGreaterThan(100);
    expect(afmeting.h).toBeGreaterThan(100);
  });
});
