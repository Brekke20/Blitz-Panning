import { test, expect, standaardStub } from './helpers.mjs';
import { startSalesApp, verwachtFout, BEHEERDER } from './sales-hulp.mjs';

// De route van de verkoper met dezelfde kaart als de technieker (Brent, proefperiode): de TomTom-lijn in de routekleur met de drukte-kleuring
// (per wegvak voor een toekomstige dag), wegenwerken, wegafsluiting met waarschuwing en de legende. Gemeten tegen de route-kaart-spec van de technieker
// (e2e/route-kaart.spec.mjs). Standaard buiten de testmodus (de pagina opnieuw laden zonder ?test); de testmodus doet hetzelfde (de klant keek in de demo
// en wilde de kleurlijnen daar ook zien: laatste test). De stubs van /api/route en /api/drukte komen uit helpers.mjs, nooit echt TomTom. De dag is dinsdag 6 okt (vertrek 08:00 ligt na VASTE_NU, dus een toekomstig departAt).
const DAG = '2026-10-06';
const route = (page) => page.locator('#view-sales-route');
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const rijen = (page) => route(page).locator('.sales-route-lijst > .sales-route-rij:not(.sales-route-depot)');

const AMBER = '#f59e0b';
const ZWAAR = '#ef4444';
const WEGWERK = '#a855f7';
const WEGSLUITING = '#7f1d1d';

const lead = (id, naam, start, lat, lon) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat, lon, bron: 'adres' }, status: 'voorgesteld', bezoeken: [], duurMin: 30, planning: { datum: DAG, start, vast: false },
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null },
});
const LEADS = () => [lead('l1', 'Verhaegen', '09:00', 50.95, 5.4), lead('l3', 'Peeters', '10:00', 50.97, 5.45)];
const DEPOT = 'Depotstraat 1, 3500 Hasselt';
const INSTELLING = { startlocatie: DEPOT, vanTijd: '08:00', totTijd: '17:00' };

const meetKaart = (page) => page.evaluate(() => ({
  markers: [...document.querySelectorAll('#sales-kaart .leaflet-marker-icon')].map((m) => m.textContent.trim()),
  paden: [...document.querySelectorAll('#sales-kaart .leaflet-overlay-pane path')].map((p) => ({
    stroke: p.getAttribute('stroke'), lineCap: p.getAttribute('stroke-linecap'), streep: p.getAttribute('stroke-dasharray'),
  })),
  legendes: document.querySelectorAll('#sales-kaart .route-legende').length,
}));
const metStroke = (kaart, kleur) => kaart.paden.filter((p) => p.stroke === kleur).length;
const metLineCap = (kaart, kap) => kaart.paden.filter((p) => p.lineCap === kap).length;

const rust = (page) => page.evaluate(() => new Promise((klaar) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const kanaal = new MessageChannel();
    kanaal.port1.onmessage = () => klaar(true);
    kanaal.port2.postMessage(0);
  }));
}));

const routeMet = (pas) => {
  const normaal = standaardStub('route');
  return (verzoek) => { const r = normaal(verzoek); pas(r.json, verzoek.body); return r; };
};
const segment = (startIndex, endIndex, historicSeconds, noTrafficSeconds) =>
  ({ startIndex, endIndex, historicSeconds, noTrafficSeconds, betrouwbaar: true, vertrekOffsetSeconds: startIndex * 600 });
const drukteMetSegmenten = (segmenten) => () => ({
  status: 200,
  json: { segmenten, departAtUsed: null, aantalAanvragen: segmenten.length, aantalWaypoints: 3, reconstructie: true, onbetrouwbaar: 0 },
});
const drukteRoodDanNormaal = drukteMetSegmenten([segment(0, 1, 1500, 1000), segment(1, 2, 1000, 1000)]);
// Een polyline met 2 eigen punten per rit (vier punten voor de twee ritten) en een historische reistijd 2x de vrije doorstroming.
const routeMetDrukkeRitten = routeMet((json) => {
  json.polyline = [[50.93, 5.34], [50.94, 5.37], [50.95, 5.4], [50.97, 5.45]];
  json.legs.forEach((l) => { l.historicTrafficTravelTimeSeconds = 2 * l.noTrafficTravelTimeSeconds; });
  json.totalHistoricTrafficTravelTimeSeconds = 2 * json.totalNoTrafficTravelTimeSeconds; // de stub telt de totalen vóór deze aanpassing op
});
// De sectie ligt enkel op een route met drie wegpunten (depot en twee bezoeken); een route naar één bezoek is vrij.
const routeMetSection = (sec) => routeMet((json, body) => { if ((body?.waypoints ?? []).length >= 3) json.sections = [sec]; });

/** Opent de Route-tab op dinsdag 6 okt (buiten de testmodus) en wacht op de route en, als dat gevraagd wordt, op het drukte-detail. */
async function bouwRoute(page, { overschrijf, instellingen = INSTELLING, leads = LEADS(), metDrukte = true, testModus = false } = {}) {
  await page.addInitScript(({ adres }) => {
    if (window !== window.top) return;
    localStorage.setItem('blitz_geocache', JSON.stringify({ [adres.toLowerCase()]: { lat: 50.93, lon: 5.34, t: Date.now() } }));
  }, { adres: DEPOT });
  await startSalesApp(page, { instellingen, leads, overschrijf });
  if (!testModus) await page.goto('/'); // zonder ?test
  await expect(tab(page, 'Leads')).toBeVisible();
  expect(await page.evaluate(() => new URLSearchParams(location.search).has('test'))).toBe(testModus);
  await tab(page, 'Route').click();
  await expect(route(page)).toHaveClass(/active/);
  const routeAntwoord = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/route');
  const drukte = metDrukte ? page.waitForResponse((r) => new URL(r.url()).pathname === '/api/drukte') : null;
  await route(page).getByLabel('Kies een dag').fill('2026-10-06'); // volgende dag (via het datumveld)
  await expect(rijen(page)).toHaveCount(2);
  await routeAntwoord;
  if (drukte) await drukte;
  await rust(page);
}

test.describe('sales: kaart met drukte en wegenwerken (zoals de technieker)', () => {
  test('standaardroute: twee markers, de lijn in de routekleur (amber) en de legende met alle klassen; één /api/drukte-aanvraag', async ({ page, verzoeken }) => {
    await bouwRoute(page);
    const kaart = await meetKaart(page);
    expect(kaart.markers).toEqual(['1', '2']);
    expect(kaart.paden.filter((p) => p.stroke === AMBER)).toEqual([{ stroke: AMBER, lineCap: 'round', streep: null }]); // volop, niet gestippeld (geen schatting)
    expect(kaart.legendes).toBe(1);
    const legende = page.locator('#sales-kaart .route-legende');
    for (const tekst of ['lichte vertraging', 'matige vertraging', 'zware vertraging', 'zware file', 'wegenwerken', 'wegafsluiting']) await expect(legende).toContainText(tekst);
    await expect(route(page).locator('.sales-route-wegafsluiting')).toBeHidden();
    const aanvragen = verzoeken.van('/api/drukte', 'POST');
    expect(aanvragen).toHaveLength(1);
    expect(aanvragen[0].body.segmentMeters).toBe(1500);
    expect(aanvragen[0].body.departAt).toBe(new Date(`${DAG}T08:00:00`).toISOString());
    expect(aanvragen[0].body.polyline).toHaveLength(3); // depot + twee bezoeken: de lijn van TomTom
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);
    await expect(route(page).locator('.sales-route-samenvatting')).not.toContainText('vertraging');
  });

  test('drukteKleuring uit (instelling): geen legende en geen drukte-aanvraag, de lijn blijft', async ({ page, verzoeken }) => {
    await bouwRoute(page, { instellingen: { ...INSTELLING, drukteKleuring: false }, metDrukte: false });
    const kaart = await meetKaart(page);
    expect(kaart.markers).toEqual(['1', '2']);
    expect(metStroke(kaart, AMBER)).toBe(1);
    expect(kaart.legendes).toBe(0);
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);
    expect(verzoeken.van('/api/drukte')).toEqual([]);
  });

  test('de routekleur uit de instellingen van de verkoper kleurt de lijn', async ({ page }) => {
    await bouwRoute(page, { instellingen: { ...INSTELLING, routeKleur: '#3366ff' } });
    const kaart = await meetKaart(page);
    expect(metStroke(kaart, '#3366ff')).toBe(1);
    expect(metStroke(kaart, AMBER)).toBe(0);
  });

  test('drukte-segmenten: een rood stuk met een overgang naar de routekleur', async ({ page }) => {
    await bouwRoute(page, { overschrijf: { drukte: drukteRoodDanNormaal } });
    const kaart = await meetKaart(page);
    expect(metStroke(kaart, ZWAAR)).toBe(1);
    expect(metLineCap(kaart, 'butt')).toBeGreaterThanOrEqual(2); // de overgang: korte stukjes met platte uiteinden
    const overgang = kaart.paden.filter((p) => p.lineCap === 'butt').map((p) => p.stroke);
    expect(overgang[0]).not.toBe(overgang.at(-1)); // van rood naar de routekleur
    expect(overgang.at(-1)).toMatch(/^#f[5-9a-f][9a-f][0-9a-f]{3}$/i); // bijna amber
    expect(kaart.legendes).toBe(1);
  });

  test('drukte-segmenten zonder vertraging: geen extra paden, wel een legende', async ({ page }) => {
    await bouwRoute(page, { overschrijf: { drukte: drukteMetSegmenten([segment(0, 1, 1000, 1000), segment(1, 2, 1000, 1000)]) } });
    const kaart = await meetKaart(page);
    expect(metStroke(kaart, AMBER)).toBe(1);
    expect(metLineCap(kaart, 'butt')).toBe(0);
    expect(metStroke(kaart, ZWAAR)).toBe(0);
    expect(kaart.legendes).toBe(1);
  });

  test('leg-vangnet zonder drukte-detail: een rood pad per rit, en de vertraging staat in de samenvatting', async ({ page }) => {
    await bouwRoute(page, { overschrijf: { route: routeMetDrukkeRitten } });
    const kaart = await meetKaart(page);
    expect(metStroke(kaart, ZWAAR)).toBe(2);
    expect(kaart.legendes).toBe(1);
    // 2 ritten van 20 min met een historische reistijd van 40 min: verwacht +40 min (toekomstige dag: geen live vertraging)
    await expect(route(page).locator('.sales-route-samenvatting')).toContainText('vertraging +40min (verwacht)');
  });

  test('live vertraging komt in de samenvatting', async ({ page }) => {
    await bouwRoute(page, { overschrijf: { route: routeMet((json) => { json.totalTrafficDelaySeconds = 900; }) } });
    await expect(route(page).locator('.sales-route-samenvatting')).toContainText('vertraging +15min');
    await expect(route(page).locator('.sales-route-samenvatting')).not.toContainText('(verwacht)');
  });

  test('wegafsluiting: waarschuwing boven de lijst, één toast en een donkerrood pad', async ({ page }) => {
    await bouwRoute(page, { overschrijf: { route: routeMetSection({ startPointIndex: 0, endPointIndex: 2, simpleCategory: 'ROAD_CLOSURE', delayInSeconds: 0 }) } });
    const kaart = await meetKaart(page);
    await expect(route(page).locator('.sales-route-wegafsluiting')).toHaveText('⚠ wegafsluiting op de route');
    await expect(route(page).locator('.sales-route-wegafsluiting')).toHaveAttribute('role', 'alert');
    await expect(page.locator('#toast')).toContainText('Wegafsluiting op de route — controleer de bereikbaarheid van het adres');
    expect(metStroke(kaart, WEGSLUITING)).toBe(1);
    expect(metStroke(kaart, ZWAAR)).toBe(0);
    expect(kaart.legendes).toBe(1);
  });

  test('wegenwerken: een paars gestippeld pad, geen waarschuwing voor een afsluiting', async ({ page }) => {
    await bouwRoute(page, { overschrijf: { route: routeMetSection({ startPointIndex: 0, endPointIndex: 2, simpleCategory: 'ROAD_WORK', delayInSeconds: 120 }) } });
    const kaart = await meetKaart(page);
    expect(kaart.paden.filter((p) => p.stroke === WEGWERK)).toEqual([{ stroke: WEGWERK, lineCap: 'round', streep: '8 6' }]);
    await expect(route(page).locator('.sales-route-wegafsluiting')).toBeHidden();
    expect(kaart.legendes).toBe(1);
  });

  test('een andere dag zonder afsluiting: de waarschuwing verdwijnt weer; terug naar de dag: opnieuw, zonder dubbele legende', async ({ page }) => {
    const leads = [...LEADS(), { ...lead('l9', 'Janssens', '11:00', 50.96, 5.43), planning: { datum: '2026-10-07', start: '11:00', vast: false } }];
    await bouwRoute(page, { leads, overschrijf: { route: routeMetSection({ startPointIndex: 0, endPointIndex: 2, simpleCategory: 'ROAD_CLOSURE', delayInSeconds: 0 }) } });
    await expect(route(page).locator('.sales-route-wegafsluiting')).toBeVisible();
    await route(page).getByLabel('Kies een dag').fill('2026-10-07'); // volgende dag (via het datumveld)
    await expect(rijen(page)).toHaveCount(1);
    await expect(route(page).locator('.sales-route-wegafsluiting')).toBeHidden(); // één bezoek: geen route, dus geen afsluiting
    await route(page).getByLabel('Kies een dag').fill('2026-10-06'); // vorige dag (via het datumveld)
    await expect(rijen(page)).toHaveCount(2);
    await expect(route(page).locator('.sales-route-wegafsluiting')).toBeVisible();
    await rust(page);
    expect((await meetKaart(page)).legendes).toBe(1);
  });

  test('hertekenen laat niets stapelen: na een tabwissel zijn markers, paden en legende even talrijk', async ({ page }) => {
    await bouwRoute(page, { overschrijf: { drukte: drukteRoodDanNormaal } });
    const eerste = await meetKaart(page);
    expect(eerste.paden.length).toBeGreaterThanOrEqual(3);
    // naar een andere tab en terug: het scherm tekent opnieuw
    await tab(page, 'Kalender').click();
    await tab(page, 'Route').click();
    await expect(rijen(page)).toHaveCount(2);
    await rust(page);
    expect(await meetKaart(page)).toEqual(eerste);
  });

  test('de drukte-aanvraag mislukt (500): de kaart houdt de lijn en het leg-vangnet, de pagina blijft werken', async ({ page, consoleFouten }) => {
    await bouwRoute(page, { overschrijf: { route: routeMetDrukkeRitten, drukte: () => ({ status: 500, json: { error: 'drukte stuk' } }) } });
    const kaart = await meetKaart(page);
    expect(kaart.markers).toEqual(['1', '2']);
    expect(metStroke(kaart, ZWAAR)).toBe(2);
    expect(kaart.legendes).toBe(1);
    await verwachtFout(consoleFouten, '/api/drukte', 500);
  });

  test('de legende past op telefoonbreedte en veroorzaakt geen horizontale scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await bouwRoute(page);
    expect((await meetKaart(page)).legendes).toBe(1);
    const m = await page.evaluate(() => ({
      overloop: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      kaart: document.getElementById('sales-kaart').getBoundingClientRect().width,
      legende: document.querySelector('#sales-kaart .route-legende').getBoundingClientRect().width,
    }));
    expect(m.overloop).toBeLessThanOrEqual(0);
    expect(m.kaart).toBeLessThanOrEqual(375);
    expect(m.legende).toBeLessThan(m.kaart);
  });

  test('in testmodus (?test) net zo: /api/route en /api/drukte worden aangeroepen en de kaart toont de kleurlijnen en de legende', async ({ page, verzoeken }) => {
    await bouwRoute(page, { testModus: true, overschrijf: { route: routeMetDrukkeRitten } });
    const kaart = await meetKaart(page);
    expect(kaart.markers).toEqual(['1', '2']);
    expect(metStroke(kaart, AMBER)).toBe(1);
    expect(metStroke(kaart, ZWAAR)).toBe(2);
    expect(kaart.paden.filter((p) => p.streep === '6 8')).toEqual([]); // geen gestippelde schatting
    expect(kaart.legendes).toBe(1);
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);
    expect(verzoeken.van('/api/drukte', 'POST')).toHaveLength(1);
    await expect(page.locator('#toast')).not.toContainText('Rit geschat');
  });

  test('als /api/route in testmodus mislukt: gestippelde rechte lijn in de routekleur, "Rit geschat", geen legende', async ({ page, consoleFouten }) => {
    await bouwRoute(page, { testModus: true, metDrukte: false, overschrijf: { route: () => ({ status: 500, json: { error: 'TomTom stuk' } }) } });
    await expect(page.locator('#toast')).toContainText('Rit geschat');
    await expect.poll(async () => (await meetKaart(page)).paden.filter((p) => p.stroke === AMBER && p.streep === '6 8').length).toBe(1);
    expect((await meetKaart(page)).legendes).toBe(0);
    await verwachtFout(consoleFouten, '/api/route', 500);
  });
});

test.describe('sales: kaart met drukte in het scherm van de beheerder', () => {
  test('subtab Route: legende en gekleurde lijn op de sales-kaart; de kaart van de technieker blijft ongemoeid', async ({ page }) => {
    await page.addInitScript(({ adres }) => {
      if (window !== window.top) return;
      localStorage.setItem('blitz_geocache', JSON.stringify({ [adres.toLowerCase()]: { lat: 50.93, lon: 5.34, t: Date.now() } }));
    }, { adres: DEPOT });
    await startSalesApp(page, {
      gebruiker: BEHEERDER,
      blobs: { 'sales/u-bea': { versie: 1, gebruikerId: 'u-bea', leads: LEADS(), blokken: [], grafstenen: [] }, instellingen: { versie: 1, perGebruiker: { 'u-bea': INSTELLING } } },
      overschrijf: { route: routeMetDrukkeRitten },
    });
    await page.goto('/');
    await expect(tab(page, 'Sales')).toBeVisible();
    await tab(page, 'Sales').click();
    await page.locator('#sales-subtab-sales-route').click();
    await route(page).getByLabel('Kies een dag').fill('2026-10-06'); // volgende dag (via het datumveld)
    await expect(rijen(page)).toHaveCount(2);
    await expect.poll(async () => metStroke(await meetKaart(page), ZWAAR)).toBe(2);
    expect((await meetKaart(page)).legendes).toBe(1);
    await expect(page.locator('#map .route-legende')).toHaveCount(0);
    await expect(page.locator('#sales-kaart.leaflet-container')).toHaveCount(1);
  });
});
