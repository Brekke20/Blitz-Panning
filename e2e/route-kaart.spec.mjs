import { test, expect, startApp, standaardStub } from './helpers.mjs';
import { zetStartTijd, zetInstellingenTim, maakRouteMetStops } from './route-hulp.mjs';

// Karakterisering (etappe 3, taak 1) van de Route-kaart: markers, routelijn, drukte-kleuring, legende,
// wegafsluiting en kaartstijl. Tellen via de DOM van Leaflet: markers `.leaflet-marker-icon`, paden
// `#map .leaflet-overlay-pane path` (attributen `stroke` en `stroke-linecap`), `.route-legende`, `#s-warn`.
// Alle aantallen zijn gemeten op de code van vóór de verhuizing naar route-kaart.js.
//
// Uitgangspunt: Tim, vanTijd 10:00 (toekomstig t.o.v. VASTE_NU, dus de app vraagt ook /api/drukte), de
// standaard route-stub (3 waypoints = polyline van 3 punten, 2 ritten) en een lege drukte-stub.

const ROUTEKLEUR = '#f59e0b'; // settings.routeKleur (standaard)
const WEGSLUITING_KLEUR = '#7f1d1d';
const ZWAAR = '#ef4444'; // drukte-magnitude 3 (verhouding >= 1,25)

const meetKaart = (page) => page.evaluate(() => ({
  markers: [...document.querySelectorAll('#map .leaflet-marker-icon')].map(m => m.textContent.trim()),
  paden: [...document.querySelectorAll('#map .leaflet-overlay-pane path')].map(p => ({
    stroke: p.getAttribute('stroke'), lineCap: p.getAttribute('stroke-linecap'),
  })),
  legendes: document.querySelectorAll('.route-legende').length,
  waarschuwing: document.getElementById('s-warn').textContent,
}));
const metStroke = (kaart, kleur) => kaart.paden.filter(p => p.stroke === kleur).length;
const metLineCap = (kaart, kap) => kaart.paden.filter(p => p.lineCap === kap).length;

// Wacht tot de pagina rustig is: twee animatieframes en daarna een macrotaak (zie ook kern.spec.mjs).
const rust = (page) => page.evaluate(() => new Promise((klaar) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const kanaal = new MessageChannel();
    kanaal.port1.onmessage = () => klaar(true);
    kanaal.port2.postMessage(0);
  }));
}));

const drukteAntwoord = (page) => page.waitForResponse(r => new URL(r.url()).pathname === '/api/drukte');

// Route-stub: de standaard-uitkomst, aangepast door `pas`.
const routeMet = (pas) => {
  const normaal = standaardStub('route');
  return (verzoek) => { const r = normaal(verzoek); pas(r.json); return r; };
};

// Drukte-stub met twee aansluitende segmenten (punten 0-1 en 1-2 van de polyline).
const segment = (startIndex, endIndex, historicSeconds, noTrafficSeconds) =>
  ({ startIndex, endIndex, historicSeconds, noTrafficSeconds, betrouwbaar: true, vertrekOffsetSeconds: startIndex * 600 });
const drukteMetSegmenten = (segmenten) => () => ({
  status: 200,
  json: { segmenten, departAtUsed: null, aantalAanvragen: segmenten.length, aantalWaypoints: 3, reconstructie: true, onbetrouwbaar: 0 },
});
// Eerste segment 1,5x (zwaar, rood), tweede 1,0x (geen vertraging): daartussen een overgang.
const drukteRoodDanNormaal = drukteMetSegmenten([segment(0, 1, 1500, 1000), segment(1, 2, 1000, 1000)]);

// Een route waarvan de polyline per rit 2 eigen punten heeft (de app snijdt per rit `pointCount` punten uit
// de polyline, opeenvolgend), met een historische reistijd 2x de vrije doorstroming.
const routeMetDrukkeRitten = routeMet((json) => {
  json.polyline = [[51.1, 4.9], [51.12, 4.93], [51.121, 4.931], [51.14, 4.96]];
  json.legs.forEach(l => { l.historicTrafficTravelTimeSeconds = 2 * l.noTrafficTravelTimeSeconds; });
});
const routeMetWegafsluiting = routeMet((json) => {
  json.sections = [{ startPointIndex: 0, endPointIndex: 2, simpleCategory: 'ROAD_CLOSURE', delayInSeconds: 0 }];
});

// Opent de Route-tab met 2 stops, wacht op de eerste tekening (en op het drukte-detail als dat wordt opgevraagd).
async function bouwRoute(page, { overschrijf, instellingen = { vanTijd: '10:00' }, metDrukte = true } = {}) {
  await zetInstellingenTim(page, instellingen);
  await startApp(page, { technieker: 'Tim', overschrijf });
  const drukte = metDrukte ? drukteAntwoord(page) : null;
  await maakRouteMetStops(page);
  if (drukte) await drukte;
  await rust(page);
}

test.describe('route-kaart', () => {
  test('standaardroute: twee genummerde markers, één routelijn en de legende', async ({ page, verzoeken }) => {
    await bouwRoute(page);
    const kaart = await meetKaart(page);
    // Nummering volgt de lijst ernaast.
    expect(kaart.markers).toEqual(['1', '2']);
    // Eén pad: de routelijn in de routekleur (ronde uiteinden), geen drukte-kleuring.
    expect(kaart.paden).toEqual([{ stroke: ROUTEKLEUR, lineCap: 'round' }]);
    // drukteKleuring staat standaard aan: de legende staat er, precies één keer, en noemt de klassen.
    expect(kaart.legendes).toBe(1);
    await expect(page.locator('.route-legende')).toContainText('lichte vertraging');
    await expect(page.locator('.route-legende')).toContainText('wegafsluiting');
    // Geen wegafsluiting-waarschuwing.
    expect(kaart.waarschuwing).toBe('');
    expect(verzoeken.van('/api/drukte', 'POST')).toHaveLength(1);
  });

  test('drukteKleuring uit: geen legende en geen drukte-aanvraag', async ({ page, verzoeken }) => {
    await bouwRoute(page, { instellingen: { vanTijd: '10:00', drukteKleuring: false }, metDrukte: false });
    const kaart = await meetKaart(page);
    // Positief tegenstuk: de route is wel getekend (markers en routelijn), alleen de legende ontbreekt.
    expect(kaart.markers).toEqual(['1', '2']);
    expect(kaart.paden).toEqual([{ stroke: ROUTEKLEUR, lineCap: 'round' }]);
    expect(kaart.legendes).toBe(0);
    await expect(page.locator('.route-legende')).toHaveCount(0);
    expect(verzoeken.van('/api/route', 'POST')).toHaveLength(1);
    expect(verzoeken.van('/api/drukte')).toEqual([]);
  });

  test('drukte-segmenten: een rood stuk met een overgang naar de routekleur', async ({ page }) => {
    await bouwRoute(page, { overschrijf: { drukte: drukteRoodDanNormaal } });
    const kaart = await meetKaart(page);
    expect(kaart.markers).toEqual(['1', '2']);
    // Gemeten: de routelijn, één rood segment (verhouding 1,5 >= 1,25) en 15 korte overgangsstukjes met platte
    // uiteinden (lineCap butt) = 17 paden. Het tweede segment (verhouding 1,0) is zelf niet getekend.
    expect(kaart.paden).toHaveLength(17);
    expect(kaart.paden[0]).toEqual({ stroke: ROUTEKLEUR, lineCap: 'round' });
    expect(metStroke(kaart, ZWAAR)).toBe(1);
    expect(metLineCap(kaart, 'butt')).toBe(15);
    // Gemeten: het eerste stukje van de overgang is bijna rood, het laatste bijna de routekleur.
    const overgang = kaart.paden.filter(p => p.lineCap === 'butt').map(p => p.stroke);
    expect(overgang[0]).toBe('#ef4742');
    expect(overgang.at(-1)).toBe('#f59b0d');
    expect(kaart.legendes).toBe(1);
  });

  test('drukte-segmenten zonder vertraging: geen extra paden, wel een legende', async ({ page }) => {
    // Positief tegenstuk van het vorige scenario: twee rustige segmenten (verhouding 1,0) geven geen kleur
    // en geen overgang (gelijke kleur aan beide kanten).
    await bouwRoute(page, { overschrijf: { drukte: drukteMetSegmenten([segment(0, 1, 1000, 1000), segment(1, 2, 1000, 1000)]) } });
    const kaart = await meetKaart(page);
    expect(kaart.paden).toEqual([{ stroke: ROUTEKLEUR, lineCap: 'round' }]);
    expect(kaart.legendes).toBe(1);
  });

  test('leg-vangnet: een gekleurd pad per rit zonder drukte-detail', async ({ page, verzoeken }) => {
    await bouwRoute(page, { overschrijf: { route: routeMetDrukkeRitten } });
    const kaart = await meetKaart(page);
    // Gemeten: de routelijn plus één rood pad per rit (2 ritten, verhouding 2,0), want het drukte-detail is leeg.
    expect(kaart.paden).toHaveLength(3);
    expect(kaart.paden[0]).toEqual({ stroke: ROUTEKLEUR, lineCap: 'round' });
    expect(metStroke(kaart, ZWAAR)).toBe(2);
    expect(metLineCap(kaart, 'butt')).toBe(0);
    expect(kaart.legendes).toBe(1);
    expect(verzoeken.van('/api/drukte', 'POST')).toHaveLength(1);
  });

  test('wegafsluiting: waarschuwing en donkerrood pad', async ({ page }) => {
    await bouwRoute(page, { overschrijf: { route: routeMetWegafsluiting } });
    const kaart = await meetKaart(page);
    await expect(page.locator('#s-warn')).toHaveText('⚠ wegafsluiting op de route');
    expect(kaart.waarschuwing).toBe('⚠ wegafsluiting op de route');
    // Gemeten: de routelijn plus één pad in de afsluitingskleur (eigen stijl, geen drukte-kleur).
    expect(kaart.paden).toHaveLength(2);
    expect(kaart.paden[0]).toEqual({ stroke: ROUTEKLEUR, lineCap: 'round' });
    expect(metStroke(kaart, WEGSLUITING_KLEUR)).toBe(1);
    expect(metStroke(kaart, ZWAAR)).toBe(0);
    expect(kaart.legendes).toBe(1);
    // Positief tegenstuk: de standaardroute heeft geen waarschuwing (zie het eerste scenario).
  });

  // Hertekenen mag niets laten stapelen: na "Bereken tijden" nogmaals en na Kalender -> Route zijn markers,
  // paden en legende even talrijk als na de eerste tekening.
  const SCENARIOS = [
    { naam: 'standaardroute', opties: {} },
    { naam: 'drukte-segmenten met overgang', opties: { overschrijf: { drukte: drukteRoodDanNormaal } } },
    { naam: 'leg-vangnet', opties: { overschrijf: { route: routeMetDrukkeRitten } } },
    { naam: 'wegafsluiting', opties: { overschrijf: { route: routeMetWegafsluiting } } },
    { naam: 'drukteKleuring uit', opties: { instellingen: { vanTijd: '10:00', drukteKleuring: false }, metDrukte: false } },
  ];
  for (const { naam, opties } of SCENARIOS) {
    test(`geen duplicaten bij hertekenen: ${naam}`, async ({ page, verzoeken }) => {
      await bouwRoute(page, opties);
      const eerste = await meetKaart(page);
      // De eerste tekening is niet leeg (anders zou "even talrijk" niets bewijzen).
      expect(eerste.markers).toEqual(['1', '2']);
      expect(eerste.paden.length).toBeGreaterThanOrEqual(1);

      // "Bereken tijden" nogmaals: nieuwe route (en nieuw drukte-detail) over dezelfde stops.
      const routesVoor = verzoeken.van('/api/route', 'POST').length;
      const drukte = opties.metDrukte === false ? null : drukteAntwoord(page);
      await page.getByRole('button', { name: 'Bereken tijden' }).click();
      if (drukte) await drukte;
      await expect.poll(() => verzoeken.van('/api/route', 'POST').length).toBe(routesVoor + 1);
      await rust(page);
      expect(await meetKaart(page)).toEqual(eerste);

      // Kalender en terug: de route staat al in het geheugen, de kaart blijft zoals hij was.
      await page.getByRole('tab', { name: 'Kalender' }).click();
      await page.getByRole('tab', { name: 'Route' }).click();
      await expect(page.locator('#view-planning')).toBeVisible();
      await rust(page);
      expect(await meetKaart(page)).toEqual(eerste);
      expect(verzoeken.van('/api/route', 'POST')).toHaveLength(routesVoor + 1);
    });
  }

  test('kaartstijl kiezen: de actieve laag wisselt en de keuze wordt bewaard', async ({ page }) => {
    await bouwRoute(page);
    const standaard = page.locator('.leaflet-control-layers').getByRole('radio', { name: 'Standaard' });
    const osm = page.locator('.leaflet-control-layers').getByRole('radio', { name: 'OpenStreetMap' });
    await expect(standaard).toBeChecked();
    await expect(osm).not.toBeChecked();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('blitz_settings_Tim')).kaartStijl)).toBeUndefined();

    await osm.check();

    await expect(osm).toBeChecked();
    await expect(standaard).not.toBeChecked();
    // Gemeten: de testmodus bewaart de keuze per persoon in de instellingen (sleutel 'osm').
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('blitz_settings_Tim')).kaartStijl)).toBe('osm');
    // De route blijft getekend.
    expect((await meetKaart(page)).markers).toEqual(['1', '2']);
  });
});
