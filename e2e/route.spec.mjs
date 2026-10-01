import { test, expect, startApp } from './helpers.mjs';

// Werkdag start om 10:00 (instelling van Tim). VASTE_NU is maandag 5 okt 09:00, dus de vertrektijd van
// de route (10:00) ligt in de toekomst: de app stuurt dan een departAt mee en vraagt ook het
// drukte-detail op. Alleen in het hoofdvenster en alleen als er nog niets staat (zoals plan-week.spec).
async function zetStartTijd(page, vanTijd) {
  await page.addInitScript((v) => {
    if (window !== window.top) return;
    if (localStorage.getItem('blitz_settings_Tim') === null) localStorage.setItem('blitz_settings_Tim', JSON.stringify({ vanTijd: v }));
  }, vanTijd);
}

// Uitgangstoestand: Tim, "Plan deze week" zet #1001 en #1002 op maandag 5 okt (VASTE_NU), nog zonder
// tijdstip. Vanuit de Kalender-kolom van die dag openen we de Route-tab. Dit werkt in testmodus zonder
// extra data en geeft twee vrije, versleepbare stops (beide van Tim, geen anker).
async function maakRouteMetStops(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
  const resultaat = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
  await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
  await resultaat.getByRole('button', { name: 'Sluiten' }).click();
  await expect(resultaat).toBeHidden();
  const maandag = page.locator('.day-col').filter({ hasText: '#1001' });
  await expect(maandag).toHaveCount(1);
  await maandag.getByRole('button', { name: 'Route berekenen' }).click();
  await expect(page.locator('#view-planning')).toBeVisible();
  await expect(page.getByTestId('route-datum')).toHaveValue('2026-10-05');
  await expect(page.getByTestId('route-aantal-stops')).toHaveText('2');
  // Het openen van de Route-tab berekent de route meteen; wacht tot beide stops een tijd tonen.
  await expect(page.getByTestId('route-stop-tijd')).toHaveCount(2);
}

const stopNummers = (page) => page.getByTestId('route-stop-nummer').allTextContents();
const stopTijden = async (page) => {
  // Eén aankomsttijd per stop: de ⏱-regel van elke kaart.
  const tijden = await page.getByTestId('route-stop').evaluateAll(els =>
    els.map(e => e.querySelector('[data-testid="route-stop-tijd"]')?.textContent.trim() ?? null));
  return tijden.map(t => t && t.replace('⏱ ', ''));
};
const minuten = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

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
});
