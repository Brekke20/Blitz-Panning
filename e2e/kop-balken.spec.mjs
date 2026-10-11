import { test, expect, startApp } from './helpers.mjs';
import { startSalesApp, SALES_GEBRUIKER, kiesVerkoper } from './sales-hulp.mjs';

// Kop B, taak 5: kalender- en lijstbalken in dezelfde vorm (technieker en sales) en het gsm-dagoverzicht van de verkoper (Bellen, Navigeer,
// Resultaat, nu-lijn, afgewerkt, buiten werkuren). Klok: maandag 5 okt 2026 09:00 (Europe/Brussels).
const DAG = '2026-10-05';
const kal = (page) => page.locator('#view-sales-kalender');
const dag = (page, iso) => kal(page).locator(`.day-col[data-date="${iso}"]`);
const tab = (page, naam) => page.getByRole('tab', { name: naam, exact: true });
const venster = (page) => page.locator('.sales-overlay.open');
const TIM = { zohoNaam: 'Tim', magZelfPlannen: true };

const lead = (id, naam, extra = {}) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null }, ...extra,
});
const bevestigd = (id, naam, datum, start, extra = {}) => lead(id, naam, { status: 'bevestigd', planning: { datum, start, vast: true }, ...extra });
const afgewerkt = (id, naam, datum, op) => lead(id, naam, { status: 'afgewerkt', resultaat: { soort: 'offerte', op }, bezoeken: [{ datum, resultaat: 'offerte', op }] });

// Een echte gsm (aanraken, 375 px): de indeling is 'smal' en de aanraakmaten gelden.
async function gsmPagina(browser) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
  return { context, page: await context.newPage() };
}

test.describe('gsm-dagoverzicht van de verkoper (Kalender)', () => {
  test('kaartje met Bellen, Navigeer en Resultaat (vandaag), nu-lijn tussen de bezoeken, afgewerkt als grijs kaartje, buiten werkuren', async ({ browser }) => {
    const { context, page } = await gsmPagina(browser);
    try {
      await startSalesApp(page, {
        leads: [
          bevestigd('b1', 'Vroeg', DAG, '07:00', { gsm: '32470112233', straat: 'Teststraat', huisnr: '5' }),
          bevestigd('b2', 'Later', DAG, '14:00', { gsm: '32470112244', straat: 'Teststraat', huisnr: '7' }),
          bevestigd('b3', 'Morgen', '2026-10-06', '10:00', { gsm: '32470112255', straat: 'Teststraat', huisnr: '9' }),
          afgewerkt('a1', 'Klaar', DAG, '2026-10-05T08:15:00+02:00'),
        ],
        blokken: [],
      });
      await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
      await tab(page, 'Kalender').click();
      const maandag = dag(page, DAG);
      await expect(maandag.locator('.sales-kal-kaart')).toHaveCount(3);
      // volgorde op uur: 07:00 (vroeg, buiten werkuren), 08:15 (afgewerkt), nu-lijn (09:xx), 14:00
      expect(await maandag.locator('.day-body > *').evaluateAll((els) => els.map((e) => (e.classList.contains('kal-nu-marker') ? 'nu' : e.dataset.sortkey)))).toEqual(['07:00', '08:15', 'nu', '14:00']);
      await expect(maandag.locator('.kal-nu-marker')).toHaveText(/^nu 09:\d\d$/);
      // Vroeg: Bellen, Navigeer en Resultaat + de badge
      const vroeg = maandag.locator('.sales-kal-kaart', { hasText: 'Test Vroeg' });
      await expect(vroeg.locator('a[href="tel:+32470112233"]')).toBeVisible();
      await expect(vroeg.getByRole('button', { name: '🧭 Navigeer' })).toBeVisible();
      await expect(vroeg.getByRole('button', { name: /Resultaat/ })).toBeVisible();
      await expect(vroeg.locator('.badge-buitenuren')).toHaveText('buiten werkuren');
      await expect(maandag.locator('.sales-kal-kaart', { hasText: 'Test Later' }).locator('.badge-buitenuren')).toHaveCount(0);
      // Afgewerkt: grijs, met het resultaat, zonder knoppen
      const klaar = maandag.locator('.sales-afgewerkt-kaart');
      await expect(klaar).toContainText('Test Klaar');
      await expect(klaar).toContainText('08:15');
      await expect(klaar).toContainText('✓ Afgewerkt · Offerte');
      await expect(klaar.locator('button, a')).toHaveCount(0);
      // Morgen: nog geen Resultaat (het bezoek moet nog plaatsvinden), wel Bellen en Navigeer
      const morgen = dag(page, '2026-10-06').locator('.sales-kal-kaart', { hasText: 'Test Morgen' });
      await expect(morgen.getByRole('button', { name: '🧭 Navigeer' })).toBeVisible();
      await expect(morgen.getByRole('button', { name: /Resultaat/ })).toHaveCount(0);
      // Resultaat ingeven vanaf het kaartje: het venster Resultaat opent (niet het bezoekvenster)
      await vroeg.getByRole('button', { name: /Resultaat/ }).click();
      await expect(venster(page)).toContainText('Resultaat — Test Vroeg');
    } finally { await context.close(); }
  });

  test('op een breed scherm blijft een afgewerkt bezoek uit de agenda (tijdlijn)', async ({ page }) => {
    await startSalesApp(page, { leads: [afgewerkt('a1', 'Klaar', DAG, '2026-10-05T08:15:00+02:00')], blokken: [], viewport: { width: 1280, height: 800 } });
    await tab(page, 'Kalender').click();
    await expect(dag(page, DAG)).toBeVisible();
    await expect(kal(page).locator('.sales-afgewerkt-kaart')).toHaveCount(0);
    await expect(kal(page).getByText('Test Klaar')).toHaveCount(0);
  });

  test('een andere verkoper bekijken (alleen lezen): geen Resultaat op het kaartje', async ({ browser }) => {
    const { context, page } = await gsmPagina(browser);
    try {
      const gebruiker = { ...SALES_GEBRUIKER, magAlleSales: true };
      await startSalesApp(page, { gebruiker, blobs: { 'sales/u-bea': { versie: 1, leads: [bevestigd('b1', 'Beaklant', DAG, '10:00', { gsm: '32470112233' })], blokken: [], grafstenen: [] } } });
      await tab(page, 'Kalender').click();
      await kiesVerkoper(page, 'u-bea');
      const kaart = dag(page, DAG).locator('.sales-kal-kaart', { hasText: 'Test Beaklant' });
      await expect(kaart.locator('a[href="tel:+32470112233"]')).toBeVisible();
      await expect(kaart.getByRole('button', { name: /Resultaat/ })).toHaveCount(0);
    } finally { await context.close(); }
  });
});

test.describe('kalenderbalken: technieker en sales in dezelfde vorm', () => {
  test('technieker met vinkje op een gsm: de kalenderkop is één regel met "⚡ Plan" (volledige naam als toegankelijke naam en hulptekst)', async ({ browser }) => {
    const { context, page } = await gsmPagina(browser);
    try {
      await startApp(page, { loginRol: 'technieker', loginGebruiker: TIM, technieker: 'Tim' });
      await tab(page, 'Kalender').click();
      const kop = page.locator('#view-kalender .kal-header');
      await expect(kop).toBeVisible();
      await page.addStyleTag({ content: '#kal-pending-pill { display: none !important; }' }); // de pil "zonder datum" is er enkel met tickets zonder datum; de kop zelf is hier het onderwerp
      const plan = page.getByRole('button', { name: '⚡ Plan deze week' });
      await expect(plan).toBeVisible();
      expect(await plan.evaluate((e) => e.innerText.trim())).toBe('⚡ Plan'); // zichtbare tekst (de rest staat in een verborgen span)
      await expect(plan).toHaveAttribute('title', 'Plan deze week');
      expect((await kop.boundingBox()).height).toBeLessThanOrEqual(62); // één regel (aanraakmaat 44 + opvulling)
      const [navG, toggle, p] = await Promise.all([kop.locator('.kal-nav-group').boundingBox(), kop.locator('.kal-view-toggle').boundingBox(), plan.boundingBox()]);
      expect(Math.abs(navG.y - p.y)).toBeLessThan(20);
      expect(Math.abs(toggle.y - p.y)).toBeLessThan(20);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    } finally { await context.close(); }
  });

  test('de planner op een computer ziet nog de volledige tekst "⚡ Plan deze week"', async ({ page }) => {
    await startApp(page);
    await tab(page, 'Kalender').click();
    await expect(page.locator('#btn-autoplan')).toHaveText('⚡ Plan deze week');
  });

  test('verkoper: dezelfde .kal-header als de technieker, over de volle breedte; op een gsm ‹ periode › · Week|Maand op regel 1 en ⚡ Plan · ➕ Blok op regel 2', async ({ browser, page }) => {
    await startSalesApp(page, { leads: [], blokken: [], viewport: { width: 1280, height: 800 } });
    await tab(page, 'Kalender').click();
    const breed = kal(page).locator('.kal-header');
    await expect(breed).toBeVisible();
    const b = await breed.boundingBox();
    expect(b.x).toBe(0);
    expect(b.width).toBe(1280);
    expect(b.height).toBeLessThanOrEqual(60); // één regel op een computer

    const { context, page: gsm } = await gsmPagina(browser);
    try {
      await startSalesApp(gsm, { leads: [], blokken: [] });
      await tab(gsm, 'Kalender').click();
      const kop = kal(gsm).locator('.kal-header');
      await expect(kop).toBeVisible();
      const plan = kop.getByRole('button', { name: '⚡ Plan deze week' });
      const blok = kop.getByRole('button', { name: '➕ Blok' });
      expect(await plan.evaluate((e) => e.innerText.trim())).toBe('⚡ Plan'); // gsm: enkel "⚡ Plan"
      const [navG, toggle, pl, bl] = await Promise.all([kop.locator('.kal-nav-group').boundingBox(), kop.locator('.kal-view-toggle').boundingBox(), plan.boundingBox(), blok.boundingBox()]);
      expect(Math.abs(navG.y - toggle.y)).toBeLessThan(20);   // regel 1
      expect(pl.y).toBeGreaterThan(navG.y + navG.height - 1);  // regel 2
      expect(Math.abs(pl.y - bl.y)).toBeLessThan(5);           // Plan en Blok naast elkaar
      expect(await gsm.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    } finally { await context.close(); }
  });
});

test.describe('lijstbalken: Wachtrij en Leads', () => {
  test('Wachtrij: zoeken, sorteren en teller staan op één vaste balk onder de tabs, buiten de lijst', async ({ page }) => {
    await startApp(page, { viewport: { width: 1280, height: 800 } });
    const balk = page.locator('#view-tickets .lijst-balk');
    await expect(balk).toHaveCount(1);
    await expect(page.locator('#ticket-list .lijst-balk')).toHaveCount(0);
    const b = await balk.boundingBox();
    const [z, s, t] = await Promise.all([page.locator('#wq-zoek').boundingBox(), page.locator('#wq-sorteer').boundingBox(), page.locator('#wq-teller').boundingBox()]);
    expect(b.width).toBe(1280);
    for (const d of [z, s, t]) expect(Math.abs((d.y + d.height / 2) - (b.y + b.height / 2))).toBeLessThan(6); // één regel
    expect(t.x).toBeGreaterThan(s.x + s.width - 1); // de teller rechts
    // plakt onder de kop van de app als de pagina scrolt
    const top = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')));
    await page.evaluate(() => window.scrollTo(0, 400));
    const na = await balk.boundingBox();
    expect(Math.abs(na.y - top)).toBeLessThanOrEqual(1);
  });

  test('Leads: + Lead, Export laden, zoeken en gebied op één balk over de volle breedte', async ({ page }) => {
    await startSalesApp(page, { leads: [lead('t1', 'Tegelaar')], blokken: [], viewport: { width: 1280, height: 800 } });
    const balk = page.locator('#view-sales-lijst .lijst-balk');
    await expect(balk).toHaveCount(1);
    const b = await balk.boundingBox();
    expect(b.width).toBe(1280);
    const delen = [balk.getByRole('button', { name: '+ Lead' }), balk.getByRole('button', { name: 'Export laden' }), balk.getByRole('searchbox', { name: 'Zoeken' }), balk.getByLabel('Postcodegebied')];
    for (const d of delen) {
      const doos = await d.boundingBox();
      expect(doos.y).toBeGreaterThanOrEqual(b.y);
      expect(doos.y + doos.height).toBeLessThanOrEqual(b.y + b.height + 1);
    }
    expect(b.height).toBeLessThanOrEqual(56);
  });

  test('Leads op een gsm: de balk past zonder horizontaal scrollen', async ({ browser }) => {
    const { context, page } = await gsmPagina(browser);
    try {
      await startSalesApp(page, { leads: [lead('t1', 'Tegelaar')], blokken: [] });
      await expect(page.locator('#view-sales-lijst .lijst-balk')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    } finally { await context.close(); }
  });
});
