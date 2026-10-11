import { test, expect, startApp } from './helpers.mjs';
import { startSalesApp } from './sales-hulp.mjs';
import { maakRouteMetStops, zetStartTijd } from './route-hulp.mjs';

// De indeling van de twee route-schermen (technieker #view-planning, verkoper #view-sales-route): een smalle lijstkolom links met eigen
// scroll, de kaart rechts die blijft staan, afgeronde hoeken, en op een telefoon alles onder elkaar zonder horizontaal scrollen.
// VASTE_NU = ma 5 okt 2026, 09:00.
const DAG = '2026-10-05';
// Route bestaat niet op een gsm (kop B); de gestapelde indeling (kaart en lijst onder elkaar) is die van een tablet rechtop (apparaat.js: blitz_weergave 'tablet' en h >= b).
const SCHERM = { breed: { width: 1280, height: 800 }, tabletStaand: { width: 800, height: 1280 } };
const alsTablet = (page) => page.addInitScript(() => { if (window === window.top) localStorage.setItem('blitz_weergave', 'tablet'); });

const bezoek = (i) => ({
  id: `l${i}`, voornaam: 'Test', naam: `Klant${i}`, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93 + i * 0.005, lon: 5.34 + i * 0.005, bron: 'adres' }, status: 'voorgesteld', bezoeken: [], duurMin: 30,
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null },
  planning: { datum: DAG, start: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, vast: false },
});
const TIEN = () => Array.from({ length: 10 }, (_, i) => bezoek(i));

const naarSalesRoute = async (page, viewport) => {
  await startSalesApp(page, { leads: TIEN(), viewport });
  await page.getByRole('tab', { name: 'Route', exact: true }).click();
  await expect(page.locator('#view-sales-route')).toHaveClass(/active/);
  await expect(page.locator('#view-sales-route .sales-route-rij:not(.sales-route-depot)')).toHaveCount(10);
  await expect(page.locator('#sales-kaart .leaflet-marker-icon')).toHaveCount(10);
};
const naarTechniekerRoute = async (page, viewport) => {
  await zetStartTijd(page, '10:00');
  await startApp(page, { technieker: 'Tim', viewport });
  await maakRouteMetStops(page);
  // Genoeg stops om te kunnen scrollen: de lijst krijgt extra kaartjes (enkel de indeling wordt getest, geen gegevens).
  await page.evaluate(() => {
    const lijst = document.querySelector('#route-list');
    for (let i = 0; i < 12; i++) { const d = document.createElement('div'); d.className = 'stop'; d.style.minHeight = '120px'; d.textContent = `extra ${i}`; lijst.append(d); }
  });
};

const SCHERMEN = [
  { naam: 'technieker', open: naarTechniekerRoute, lijst: '#route-list', kaart: '#map-wrap', kaartInhoud: '#map' },
  { naam: 'verkoper', open: naarSalesRoute, lijst: '#view-sales-route .sales-route-lijstvak', kaart: '#view-sales-route .sales-route-kaartvak', kaartInhoud: '#sales-kaart' },
];

const doos = (page, kies) => page.locator(kies).evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, b: r.width, h: r.height, onder: r.bottom }; });

test.describe('route-indeling: brede indeling (1280x800)', () => {
  for (const sch of SCHERMEN) {
    test(`${sch.naam}: de lijst scrollt in zijn eigen kolom, de kaart en de pagina blijven staan`, async ({ page }) => {
      await sch.open(page, SCHERM.breed);
      const voor = await doos(page, sch.kaart);
      const scroll = await page.locator(sch.lijst).evaluate((e) => { e.scrollTop = 400; return { top: e.scrollTop, hoog: e.scrollHeight, zicht: e.clientHeight }; });
      expect(scroll.hoog).toBeGreaterThan(scroll.zicht); // de lijst is langer dan de kolom
      expect(scroll.top).toBeGreaterThan(0);
      const na = await doos(page, sch.kaart);
      expect(na.y).toBe(voor.y);
      expect(na.x).toBe(voor.x);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const pagina = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
      expect(pagina).toBeLessThanOrEqual(0); // de pagina zelf scrolt niet
    });

    test(`${sch.naam}: de kaart heeft afgeronde hoeken en vult de rest tot onderaan het venster`, async ({ page }) => {
      await sch.open(page, SCHERM.breed);
      const radius = await page.locator(sch.kaart).evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius));
      expect(radius).toBeGreaterThan(0);
      const lijst = await doos(page, sch.lijst);
      const kaart = await doos(page, sch.kaart);
      expect(kaart.x).toBeGreaterThanOrEqual(lijst.x + lijst.b - 1); // de kaart staat rechts van de lijst
      expect(kaart.b).toBeGreaterThan(lijst.b * 2);
      expect(kaart.onder).toBeGreaterThan(SCHERM.breed.height - 80); // tot (vlak boven) de onderrand; ruimte voor de samenvatting
      expect(kaart.onder).toBeLessThanOrEqual(SCHERM.breed.height);
      const inhoud = await doos(page, sch.kaartInhoud);
      expect(inhoud.h).toBeGreaterThan(300);
    });
  }

  test('de lijstkolom van de verkoper is even breed als die van de technieker (±10 px)', async ({ page }) => {
    await naarTechniekerRoute(page, SCHERM.breed);
    const technieker = (await doos(page, '#route-list')).b;
    const tweede = await page.context().newPage();
    await naarSalesRoute(tweede, SCHERM.breed);
    const verkoper = (await doos(tweede, '#view-sales-route .sales-route-lijstvak')).b;
    expect(Math.abs(verkoper - technieker)).toBeLessThanOrEqual(10);
  });

  test('verkoper: de stopkaarten zijn compact (kleine titel, labels op één regel, kleine knop Resultaat)', async ({ page }) => {
    await naarSalesRoute(page, SCHERM.breed);
    const rij = page.locator('#view-sales-route .sales-route-rij:not(.sales-route-depot):not(:has(.sales-route-waarschuwing))').first();
    const m = await rij.evaluate((e) => ({
      h: e.getBoundingClientRect().height,
      titel: parseFloat(getComputedStyle(e.querySelector('.sales-route-naam')).fontSize),
      knop: e.querySelector('.sales-route-resultaat').getBoundingClientRect().height,
    }));
    expect(m.h).toBeLessThan(110);
    const waarschuwing = await page.locator('#view-sales-route .sales-route-waarschuwing').first().evaluate((e) => e.getBoundingClientRect().height).catch(() => 0);
    expect(waarschuwing).toBeLessThanOrEqual(26); // de waarschuwing is één compacte regel
    expect(m.titel).toBeLessThanOrEqual(14);
    expect(m.knop).toBeLessThanOrEqual(32);
  });

  test('verkoper: het venster verkleinen laat de kaart haar grootte aanpassen', async ({ page }) => {
    await naarSalesRoute(page, SCHERM.breed);
    const voor = await page.locator('#sales-kaart').evaluate((e) => ({ b: e.clientWidth, leaflet: e.querySelector('.leaflet-pane').getBoundingClientRect().width }));
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(() => page.locator('#sales-kaart').evaluate((e) => e.clientWidth)).toBeLessThan(voor.b);
    const tegels = await page.locator('#sales-kaart').evaluate((e) => e.querySelector('.leaflet-map-pane') != null);
    expect(tegels).toBe(true);
  });
});

test.describe('route-indeling: tablet rechtop (800x1280)', () => {
  for (const sch of SCHERMEN) {
    test(`${sch.naam}: kaart en lijst staan onder elkaar en er is geen horizontaal scrollen`, async ({ page }) => {
      await alsTablet(page);
      await sch.open(page, SCHERM.tabletStaand);
      await expect(page.locator('html')).toHaveAttribute('data-indeling', 'tablet-staand');
      const lijst = await doos(page, sch.lijst);
      const kaart = await doos(page, sch.kaart);
      // gestapeld: dezelfde linkerrand (± de marge van de kaart) en geen naast-elkaar-indeling
      expect(Math.abs(kaart.y - lijst.y)).toBeGreaterThan(50);
      expect(lijst.b).toBeGreaterThan(300);
      expect(kaart.b).toBeGreaterThan(300);
      const overloop = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overloop).toBeLessThanOrEqual(0);
    });
  }
});
