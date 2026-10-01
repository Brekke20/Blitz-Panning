import { test, expect, startApp, standaardStub, VASTE_NU } from './helpers.mjs';
import { zetStartTijd, maakRouteMetStops, stopNummers, stopTijden, minuten } from './route-hulp.mjs';

// Sleep de stop met nummer `van` boven de stop met nummer `naar`, met kleine muisstappen
// (sorteer.js: muis begint na 4 px; het doel is "vóór het eerste item waarvan het midden onder de muis ligt").
async function sleepBoven(page, van, naar) {
  const bron = page.getByTestId('route-stop').filter({ hasText: van }).locator('.stop-top');
  const doel = page.getByTestId('route-stop').filter({ hasText: naar });
  const b = await bron.boundingBox();
  const d = await doel.boundingBox();
  const x = b.x + b.width / 2;
  const y0 = b.y + b.height / 2;
  const y1 = d.y + 4; // net onder de bovenrand van het doel: boven zijn midden
  await page.mouse.move(x, y0);
  await page.mouse.down();
  const stappen = 12;
  for (let i = 1; i <= stappen; i++) await page.mouse.move(x, y0 + ((y1 - y0) * i) / stappen);
  await page.mouse.up();
}

test.describe('route', () => {
  test('route berekenen toont tijden per stop', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
    const resultaat = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
    await resultaat.getByRole('button', { name: 'Sluiten' }).click();
    // Voor het openen van de Route-tab is er nog geen route aangevraagd.
    expect(verzoeken.van('/api/route')).toEqual([]);
    await page.locator('.day-col').filter({ hasText: '#1001' }).getByRole('button', { name: 'Route berekenen' }).click();

    // (De toast 'Route berekend ✓' wordt meteen door 'Drukte laden...' vervangen: niet bruikbaar.)
    await expect(page.getByTestId('route-stop-tijd')).toHaveCount(2);
    expect(await stopNummers(page)).toEqual(['#1001', '#1002']);

    // Eerst geocodeert de app vertrekpunt en stops via /api/optimize (de stub geeft vaste coordinaten,
    // zie fixtures/optimize.json: vertrek + elke stop een stukje verder, in invoervolgorde).
    const geocode = verzoeken.van('/api/optimize', 'POST');
    expect(geocode).toHaveLength(1);
    expect(geocode[0].body.stops).toEqual(['Antwerpseweg 50, 2440 Geel', 'Kuringersteenweg 12, 3500 Hasselt']);

    // Route-aanvraag: vertrekpunt + de stops in volgorde #1001, #1002,
    // met vertrektijd 5 okt 10:00 Brussel = 08:00 UTC.
    const route = verzoeken.van('/api/route', 'POST');
    expect(route).toHaveLength(1);
    expect(route[0].body.waypoints).toEqual([
      { lat: 51.1, lon: 4.9 },
      { lat: 51.12, lon: 4.93 },
      { lat: 51.14, lon: 4.96 },
    ]);
    expect(route[0].body.departAt).toBe('2026-10-05T08:00:00.000Z');

    // Elke stop toont een aankomsttijd; eerste = 10:00 + 20 min rit, tweede = + duur eerste stop + 20 min rit.
    await expect(page.getByTestId('route-stop-tijd')).toHaveCount(2);
    const tijden = await stopTijden(page);
    expect(tijden).toEqual(['10:20', '12:40']);
    // Tussenrit (20 min uit route.json), samenvatting.
    await expect(page.getByText('🚗 20 min · 20.0 km')).toBeVisible();
    await expect(page.getByTestId('route-afstand')).toHaveText('40 km');
    await expect(page.getByTestId('route-aantal-stops')).toHaveText('2');

    // Drukte-detail volgt voor de toekomstige vertrektijd, met dezelfde route als polyline.
    await expect.poll(() => verzoeken.van('/api/drukte', 'POST').length).toBe(1);
    const drukte = verzoeken.van('/api/drukte', 'POST')[0];
    expect(drukte.body.departAt).toBe('2026-10-05T08:00:00.000Z');
    expect(drukte.body.polyline).toEqual([[51.1, 4.9], [51.12, 4.93], [51.14, 4.96]]);

    // "Bereken tijden" rekent in de huidige volgorde opnieuw: tweede aanvraag, zelfde uitkomst.
    await page.getByRole('button', { name: 'Bereken tijden' }).click();
    await expect.poll(() => verzoeken.van('/api/route', 'POST').length).toBe(2);
    expect(await stopTijden(page)).toEqual(['10:20', '12:40']);
  });

  test('stops slepen wijzigt de volgorde en de tijden', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    expect(await stopNummers(page)).toEqual(['#1001', '#1002']);
    const routeVoor = verzoeken.van('/api/route', 'POST').length;

    await sleepBoven(page, '#1002', '#1001');

    await expect(page.getByText('✓ Volgorde en tijdstippen bijgewerkt')).toBeVisible();
    await expect.poll(() => stopNummers(page)).toEqual(['#1002', '#1001']);
    // Na het slepen is de route in de nieuwe volgorde opnieuw berekend (extra aanvraag), met #1002 eerst.
    expect(verzoeken.van('/api/route', 'POST').length).toBeGreaterThan(routeVoor);
    // Tijden zijn opnieuw berekend en nu bewaard: eerste stop vroeger dan tweede.
    const na = await stopTijden(page);
    for (const t of na) expect(t).toMatch(/^\d{2}:\d{2}$/);
    expect(minuten(na[0])).toBeLessThan(minuten(na[1]));
    // De laatste route-aanvraag volgt de nieuwe volgorde: #1002 (locations[2]) eerst, dan #1001 (locations[1]).
    const laatste = verzoeken.van('/api/route', 'POST').at(-1);
    expect(laatste.body.waypoints.slice(1)).toEqual([{ lat: 51.14, lon: 4.96 }, { lat: 51.12, lon: 4.93 }]);
    // Gemeten: de aankomsttijden zijn nu afgerond op een kwartier en bewaard (voordien 10:20 en 12:40).
    expect(na).toEqual(['10:30', '12:45']);
    // Alle stops hebben nu een tijdstip: de balk 'zonder tijdstip' is weg.
    await expect(page.getByRole('button', { name: 'Tijden vastleggen' })).toHaveCount(0);
    // Testmodus: niets naar Zoho; de vergrendelstatus is wel (vers) opgehaald.
    expect(verzoeken.van('/api/plan-datum')).toEqual([]);
    expect(verzoeken.van('/api/voorstel-status', 'GET').length).toBeGreaterThanOrEqual(1);
  });

  test('Tijden vastleggen bewaart de tijden', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);

    await expect(page.getByText('⏱ 2 tickets zonder tijdstip')).toBeVisible();
    await page.getByRole('button', { name: 'Tijden vastleggen' }).click();

    await expect(page.getByText('✓ Volgorde en tijdstippen bijgewerkt')).toBeVisible();
    // Volgorde ongewijzigd; de balk is weg (beide stops hebben nu een tijdstip) en de tijden zijn vastgezet.
    await expect(page.getByRole('button', { name: 'Tijden vastleggen' })).toHaveCount(0);
    await expect(page.getByText(/zonder tijdstip/)).toHaveCount(0);
    expect(await stopNummers(page)).toEqual(['#1001', '#1002']);
    const vast = await stopTijden(page);
    expect(vast).toEqual(['10:30', '12:45']);

    // 'Bij herladen van de route-tab': wissel naar Kalender en terug; de tijden staan er nog.
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.getByRole('tab', { name: 'Route' }).click();
    await expect(page.getByTestId('route-stop-tijd')).toHaveCount(2);
    expect(await stopNummers(page)).toEqual(['#1001', '#1002']);
    expect(await stopTijden(page)).toEqual(vast);
    await expect(page.getByRole('button', { name: 'Tijden vastleggen' })).toHaveCount(0);

    // Testmodus: de app slaat Zoho over (TEST_MODE); wel is de vergrendelstatus vers opgehaald.
    expect(verzoeken.van('/api/plan-datum')).toEqual([]);
    expect(verzoeken.van('/api/voorstel-status', 'GET').length).toBeGreaterThanOrEqual(1);
  });

  test('optimaliseren zet de stops in de volgorde van de optimizer', async ({ page, verzoeken }) => {
    // Optimizer-stub: geeft de twee stops in omgekeerde volgorde terug (optimizedOrder [1, 0]); de
    // geocode-aanroepen met een enkele stop (vertrekpunt) krijgen de gewone vaste coordinaten.
    const optimizeOmgekeerd = ({ body }) => {
      const stops = body?.stops || [];
      const locations = [{ lat: 51.1, lon: 4.9 }, ...stops.map((_, i) => ({ lat: +(51.1 + (i + 1) * 0.02).toFixed(5), lon: +(4.9 + (i + 1) * 0.03).toFixed(5) }))];
      return { status: 200, json: { locations, optimizedOrder: stops.map((_, i) => i).reverse() } };
    };
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim', overschrijf: { optimize: optimizeOmgekeerd } });
    await maakRouteMetStops(page);
    expect(await stopNummers(page)).toEqual(['#1001', '#1002']);
    const optimizeVoor = verzoeken.van('/api/optimize', 'POST').length;

    await page.getByRole('button', { name: '⚡ Optimaliseer' }).click();

    await expect(page.getByText('✓ Volgorde en tijdstippen bijgewerkt')).toBeVisible();
    await expect.poll(() => stopNummers(page)).toEqual(['#1002', '#1001']);
    // De optimizer is aangeroepen met beide adressen (in de volgorde van de lijst) vanaf het vertrekpunt.
    const optimize = verzoeken.van('/api/optimize', 'POST').slice(optimizeVoor).filter(r => r.body.stops.length === 2);
    expect(optimize).toHaveLength(1);
    expect(optimize[0].body.stops).toEqual(['Antwerpseweg 50, 2440 Geel', 'Kuringersteenweg 12, 3500 Hasselt']);
    // Daarna is de route in de nieuwe volgorde berekend: waypoints volgen de optimizer-locaties
    // (locations[2] voor #1002 eerst, dan locations[1] voor #1001).
    const route = verzoeken.van('/api/route', 'POST').at(-1);
    expect(route.body.waypoints.slice(1)).toEqual([{ lat: 51.14, lon: 4.96 }, { lat: 51.12, lon: 4.93 }]);
    const tijden = await stopTijden(page);
    expect(minuten(tijden[0])).toBeLessThan(minuten(tijden[1]));
    expect(tijden).toEqual(['10:30', '12:45']);
    await expect(page.getByRole('button', { name: 'Tijden vastleggen' })).toHaveCount(0);
    expect(verzoeken.van('/api/plan-datum')).toEqual([]);
  });

  test('weekstrook: stops en tijdstatus van de dag', async ({ page }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);

    // Maandag (5 okt) is geselecteerd: 2 stops, nog zonder tijdstip.
    const maandag = page.getByRole('button', { name: /^MA 5:/ });
    await expect(maandag).toHaveAttribute('aria-pressed', 'true');
    await expect(maandag).toContainText('2 stops');
    await expect(maandag).toContainText('⏱ nodig');
    // Positief tegenstuk: een lege werkdag (dinsdag) toont 0 stops en geen tijdstatus.
    const dinsdag = page.getByRole('button', { name: /^DI 6:/ });
    await expect(dinsdag).toHaveAttribute('aria-pressed', 'false');
    await expect(dinsdag).toContainText('0 stops');

    await page.getByRole('button', { name: 'Tijden vastleggen' }).click();
    await expect(page.getByText('✓ Volgorde en tijdstippen bijgewerkt')).toBeVisible();
    await expect(maandag).toContainText('2 stops');
    await expect(maandag).toContainText('✓ tijden');
    await expect(maandag).not.toContainText('⏱ nodig');
  });

  test('een stop uit de planning halen maakt de route verouderd', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    await expect(page.getByTestId('route-afstand')).toHaveText('40 km');
    const hint = page.getByText('De route is verouderd en van de kaart gehaald');
    await expect(hint).toHaveCount(0);

    await page.getByTestId('route-stop').filter({ hasText: '#1002' }).getByRole('button', { name: '✕ Uit planning halen' }).click();
    const bevestig = page.getByRole('alertdialog', { name: 'Ticket #1002 uit de planning halen?' });
    await expect(bevestig).toBeVisible();
    await bevestig.getByRole('button', { name: 'Uit planning halen' }).click();

    // Gemeten: één stop over, de hint staat er, de samenvatting is leeg (—) en de tijden zijn weg;
    // er is geen nieuwe routeaanvraag (geen automatische TomTom-aanroep) en geen plan-oproep (testmodus).
    await expect(page.getByTestId('route-stop')).toHaveCount(1);
    expect(await stopNummers(page)).toEqual(['#1001']);
    await expect(hint).toBeVisible();
    await expect(page.getByTestId('route-afstand')).toHaveText('—');
    await expect(page.getByTestId('route-aantal-stops')).toHaveText('1');
    await expect(page.getByTestId('route-stop-tijd')).toHaveCount(0);
    await expect(page.locator('#s-time')).toHaveText('—');
    await expect(page.locator('#s-eta')).toHaveText('—');
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);
    expect(verzoeken.van('/api/plan')).toEqual([]);

    // "Bereken tijden" tekent de route opnieuw en haalt de hint weg.
    await page.getByRole('button', { name: 'Bereken tijden' }).click();
    await expect(page.getByTestId('route-stop-tijd')).toHaveCount(1);
    await expect(hint).toHaveCount(0);
    await expect(page.getByTestId('route-afstand')).toHaveText('20 km');
  });

  // BUGFIX (etappe 3, R6): localEvents zit nu in het route-abonnement. Voorheen bleef de route-lijst na een nieuwe
  // eigen afspraak ongewijzigd (2 stops, oude tijden, geen hint) tot "Bereken tijden". Nu hertekent de lijst
  // meteen (ook op de achtergrond): de oude route is verouderd, en bij het openen van de Route-tab rekent de app
  // zelf opnieuw (setTab: geen actuele route voor de dag) met precies één extra /api/route-aanvraag.
  const nieuweAfspraak = () => ({ id: 'e-route-1', titel: 'Installatie Test', datum: '2026-10-05', uur: '14:00', einduur: '15:00',
    type: 'Installatie', persoon: 'Tim', adres: 'Grote Markt 1, 2000 Antwerpen', notitie: '', telefoon: '', email: '', bron: 'manueel', origResp: null });

  test('BUGFIX (etappe 3, R6): een nieuwe eigen afspraak met adres: de Route-tab toont ze meteen en rekent vanzelf opnieuw', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    expect(await stopTijden(page)).toEqual(['10:20', '12:40']);
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);

    await page.getByRole('tab', { name: 'Kalender' }).click();
    // In-page toewijzing aan de globale accessor (zoals loadAfspraken/saveAfspraken doen): geen kalender-klikpad nodig.
    await page.evaluate((e) => { localEvents = [...localEvents, e]; }, nieuweAfspraak());
    await page.getByRole('tab', { name: 'Route' }).click();

    await expect(page.getByTestId('route-stop')).toHaveCount(3);
    await expect(page.getByTestId('route-stop').first()).toContainText('Installatie — Installatie Test');
    await expect(page.getByTestId('route-stop').first()).toContainText('Grote Markt 1, 2000 Antwerpen');
    // Gemeten: de afspraak toont zijn eigen tijdslot (🗓); de tickets rekenen daarna: 14:00 + 60 min + 20 min rit = 15:20.
    await expect.poll(() => stopTijden(page)).toEqual(['🗓 14:00–15:00', '15:20', '17:40']);
    // Vers berekend: geen "verouderd"-hint, precies één extra routeaanvraag (de automatische bij het openen van de tab).
    await expect(page.getByText('De route is verouderd en van de kaart gehaald')).toHaveCount(0);
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(2);
  });

  test('BUGFIX (etappe 3, R6): een nieuwe eigen afspraak terwijl de Route-tab openstaat: stop erbij, route verouderd, geen aanvraag', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);

    await page.evaluate((e) => { localEvents = [...localEvents, e]; }, nieuweAfspraak());

    // De afspraak staat er meteen; de oude route is van de kaart gehaald (hint, tijden en afstand weg);
    // er volgt geen automatische TomTom-aanroep.
    await expect(page.getByTestId('route-stop')).toHaveCount(3);
    await expect(page.getByText('Installatie — Installatie Test')).toHaveCount(1);
    await expect(page.getByText('De route is verouderd en van de kaart gehaald')).toBeVisible();
    await expect(page.getByTestId('route-afstand')).toHaveText('—');
    // Gemeten: enkel de afspraak toont nog zijn eigen tijdslot; de twee tickets hebben geen berekende tijd meer.
    expect(await stopTijden(page)).toEqual(['🗓 14:00–15:00', null, null]);
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);

    // "Bereken tijden" tekent opnieuw: hint weg, precies één extra aanvraag.
    await page.getByRole('button', { name: 'Bereken tijden' }).click();
    await expect.poll(() => stopTijden(page)).toEqual(['🗓 14:00–15:00', '15:20', '17:40']);
    await expect(page.getByText('De route is verouderd en van de kaart gehaald')).toHaveCount(0);
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(2);
  });

  test('dag met meerdere technici: niet versleepbaar, niet optimaliseerbaar, tijden niet vast te leggen', async ({ page }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);

    // #1002 aan een andere technieker geven (in-place, zoals een Zoho-herlading) en naar "Alle technici"
    // wisselen: de filterwissel hertekent de route-lijst.
    await page.evaluate(() => { planning['2026-10-05'][1].ticket.assignee = 'Sam'; });
    await page.locator('#person-btn').click();
    await page.getByRole('button', { name: /Alle technici/ }).click();
    await expect(page.getByTestId('route-aantal-stops')).toHaveText('2');
    await expect(page.getByTestId('route-stop')).toHaveCount(2);

    // Gemeten: geen kaartje is versleepbaar (data-sleepbaar ontbreekt) en de kaartjes dragen de uitleg als title.
    await expect(page.locator('[data-testid="route-stop"][data-sleepbaar]')).toHaveCount(0);
    await expect(page.getByTestId('route-stop').first()).toHaveAttribute('title', 'Kies eerst een technieker om de volgorde aan te passen');
    // Tijden vastleggen staat er wel (stops zonder tijdstip) maar is uitgeschakeld.
    await expect(page.getByText('⏱ 2 tickets zonder tijdstip')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tijden vastleggen' })).toBeDisabled();
    // Optimaliseren geeft een toast en doet niets.
    await page.getByRole('button', { name: '⚡ Optimaliseer' }).click();
    await expect(page.getByText('⚠ Kies eerst een technieker — de dag bevat stops van meerdere technici')).toBeVisible();

    // Positief tegenstuk: met één technieker (Tim) zijn de kaartjes weer versleepbaar.
    await page.locator('#person-btn').click();
    await page.getByRole('button', { name: /Tim/ }).first().click();
    await expect(page.getByTestId('route-stop')).toHaveCount(1);
    await expect(page.locator('[data-testid="route-stop"][data-sleepbaar]')).toHaveCount(1);
  });

  test('mislukte routeberekening bij Tijden vastleggen: volgorde en tijden niet bewaard', async ({ page, consoleFouten }) => {
    // Eerste aanroep normaal (openen van de Route-tab), daarna een serverfout.
    const normaal = standaardStub('route');
    let aanroepen = 0;
    const route = (verzoek) => (++aanroepen === 1 ? normaal(verzoek) : { status: 502, json: { error: 'x' } });
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim', overschrijf: { route } });
    await maakRouteMetStops(page);
    expect(await stopTijden(page)).toEqual(['10:20', '12:40']);

    await page.getByRole('button', { name: 'Tijden vastleggen' }).click();

    await expect(page.getByText('✕ Route kon niet berekend worden — volgorde niet bewaard')).toBeVisible();
    // Gemeten: de balk en de knop staan er nog (de tijden zijn niet vastgelegd), de volgorde is ongewijzigd
    // en de berekende aankomsttijden zijn weg (routeData is leeg na de mislukte aanvraag); "Bereken tijden"
    // is de weg terug.
    await expect(page.getByText('⏱ 2 tickets zonder tijdstip')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tijden vastleggen' })).toBeEnabled();
    await expect(page.getByText('✓ Volgorde en tijdstippen bijgewerkt')).toHaveCount(0);
    await expect(page.getByTestId('route-stop')).toHaveCount(2);
    expect(await stopNummers(page)).toEqual(['#1001', '#1002']);
    await expect(page.getByTestId('route-stop-tijd')).toHaveCount(0);
    expect(aanroepen).toBeGreaterThanOrEqual(2);

    // De 502 is hier bedoeld: de browser meldt hem als consolefout en als HTTP 502 voor /api/route.
    const verwacht = consoleFouten.filter(f => /\/api\/route/.test(f) || /status of 502/.test(f));
    expect(verwacht.length).toBeGreaterThanOrEqual(1);
    for (const f of verwacht) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  });

  test('vergrendelstatus niet geladen bij Tijden vastleggen: volgorde niet bewaard', async ({ page, consoleFouten }) => {
    // Eerste GET (app-start) normaal, daarna een serverfout.
    const normaal = standaardStub('voorstel-status');
    let gets = 0;
    const voorstelStatus = (verzoek) => (verzoek.methode === 'GET' && ++gets > 1 ? { status: 500, json: { error: 'x' } } : normaal(verzoek));
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim', overschrijf: { 'voorstel-status': voorstelStatus } });
    await maakRouteMetStops(page);

    await page.getByRole('button', { name: 'Tijden vastleggen' }).click();

    await expect(page.getByText('✕ Vergrendelstatus kon niet geladen worden — volgorde niet bewaard')).toBeVisible();
    await expect(page.getByText('⏱ 2 tickets zonder tijdstip')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tijden vastleggen' })).toBeEnabled();
    await expect(page.getByText('✓ Volgorde en tijdstippen bijgewerkt')).toHaveCount(0);
    expect(await stopTijden(page)).toEqual(['10:20', '12:40']);

    const verwacht = consoleFouten.filter(f => /voorstel-status/.test(f) || /status of 500/.test(f));
    expect(verwacht.length).toBeGreaterThanOrEqual(1);
    for (const f of verwacht) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  });

  test('vergrendelstatus niet geladen bij slepen: volgorde niet bewaard', async ({ page, consoleFouten }) => {
    const normaal = standaardStub('voorstel-status');
    let gets = 0;
    const voorstelStatus = (verzoek) => (verzoek.methode === 'GET' && ++gets > 1 ? { status: 500, json: { error: 'x' } } : normaal(verzoek));
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim', overschrijf: { 'voorstel-status': voorstelStatus } });
    await maakRouteMetStops(page);

    await sleepBoven(page, '#1002', '#1001');

    await expect(page.getByText('✕ Vergrendelstatus kon niet geladen worden — volgorde niet bewaard')).toBeVisible();
    // Gemeten: de lijst blijft in de oorspronkelijke volgorde en de tijden zijn niet bewaard.
    expect(await stopNummers(page)).toEqual(['#1001', '#1002']);
    await expect(page.getByText('✓ Volgorde en tijdstippen bijgewerkt')).toHaveCount(0);
    expect(await stopTijden(page)).toEqual(['10:20', '12:40']);

    const verwacht = consoleFouten.filter(f => /voorstel-status/.test(f) || /status of 500/.test(f));
    expect(verwacht.length).toBeGreaterThanOrEqual(1);
    for (const f of verwacht) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  });

  test('kaartknoppen: Aankomst registreren en Rapport openen', async ({ page }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    const eerste = page.getByTestId('route-stop').first();
    await expect(eerste).toContainText('#1001');
    await expect(page.getByText(/Aangekomen/)).toHaveCount(0);

    // Vaste klok, zodat het geregistreerde uur exact is.
    await page.clock.setFixedTime(new Date(VASTE_NU));
    await eerste.getByRole('button', { name: '⏱️ Aankomst' }).click();
    await expect(page.getByText('⏱ Aankomst geregistreerd: 09:00')).toBeVisible();
    await expect(page.getByTestId('route-stop').first()).toContainText('✓ Aangekomen 09:00');
    // Alleen de eerste stop is geregistreerd.
    await expect(page.getByText(/Aangekomen/)).toHaveCount(1);
    const bewaard = await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_arrivals')));
    expect(bewaard).toEqual({ '2026-10-05__t1': '09:00' });

    // Rapport: de wizard opent; sluiten zonder iets te doen (bevestigt het native "Rapport sluiten?"-venster).
    await page.getByTestId('route-stop').first().getByRole('button', { name: '📋 Rapport' }).click();
    const wizard = page.getByRole('dialog', { name: '📋 Service Rapport' });
    await expect(wizard).toHaveClass(/open/);
    await expect(wizard.locator('#wiz-step-label')).toHaveText('1 / 9 — Algemeen');
    page.once('dialog', d => d.accept());
    await wizard.getByRole('button', { name: 'Sluiten' }).click();
    await expect(wizard).toBeHidden();
  });
  // Etappe 3 Taak 7 (R9): de knoppen "✕ Leeg" en de datumkiezer hangen aan data-actie/change-luisteraar i.p.v. inline handlers.
  test('✕ Leeg: na bevestigen verdwijnen beide stops', async ({ page }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    page.once('dialog', d => d.accept());
    await page.getByRole('button', { name: '✕ Leeg' }).click();
    await expect(page.getByTestId('route-stop')).toHaveCount(0);
    await expect(page.getByText('Voeg tickets of installaties toe via de Kalender')).toBeVisible();
  });

  test('datumkiezer: andere dag toont zijn lijst, de gekozen dag met stops rekent na 300 ms een route', async ({ page, verzoeken }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);

    // Lege dag: lijst van die dag, geen routeaanvraag.
    await page.getByTestId('route-datum').fill('2026-10-06');
    await expect(page.getByTestId('route-stop')).toHaveCount(0);
    await expect(page.getByText('Voeg tickets of installaties toe via de Kalender')).toBeVisible();
    await page.clock.runFor(300);
    // Wacht op een settled state voordat je de aanvragen telt: fetch is asynchron.
    await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
    await expect.poll(() => verzoeken.van('/api/route', 'POST').length).toBe(1);

    // Terug naar de dag met stops: lijst komt terug en na 300 ms volgt een extra routeaanvraag.
    await page.getByTestId('route-datum').fill('2026-10-05');
    await expect(page.getByTestId('route-stop')).toHaveCount(2);
    await page.clock.runFor(300);
    // Wacht op een settled state voordat je de aanvragen telt: fetch is asynchron.
    await page.evaluate(() => new Promise(r => setTimeout(r, 0)));
    await expect.poll(() => verzoeken.van('/api/route', 'POST').length).toBe(2);
  });
});
