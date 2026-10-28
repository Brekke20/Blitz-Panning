import { test, expect, startApp } from './helpers.mjs';
import { startSalesApp } from './sales-hulp.mjs';

// Open dag, taak 5: dezelfde tabbalk (.tabs > .tabs-inner[role=tablist] > .tab) is op `breed` een zwevende glazen zijkolom links
// en op `smal`/`tablet-staand` een zwevend glazen dok onderaan; elke tab heeft een icoon (kern/tab-iconen.js). Enkel opmaak: de tabs per
// rol blijven dezelfde. --dok-h (sticky-offset.js) is de ruimte die het dok onderaan inneemt, 0 op `breed`.

const PC = { width: 1366, height: 768 };
const GSM = { width: 375, height: 812 };

const zetWeergave = (page, weergave) => page.addInitScript((w) => {
  if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
  localStorage.setItem('blitz_weergave', w);
}, weergave);

const dokH = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dok-h')));
const zichtbareTabIds = (page) => page.locator('.tabs-inner .tab:visible').evaluateAll(els => els.map(e => e.id));

async function verwachtZijkolom(page, { hoogte }) {
  await expect(page.locator('html')).toHaveAttribute('data-indeling', 'breed');
  const kolom = await page.locator('.tabs').boundingBox();
  expect(kolom.x).toBeLessThan(20);
  expect(kolom.width).toBeGreaterThanOrEqual(220);
  expect(kolom.width).toBeLessThanOrEqual(236);
  expect(kolom.height).toBeGreaterThan(hoogte - 168);
  // de inhoud staat rechts van de kolom, niet eronder
  const view = await page.locator('.view.active').boundingBox();
  expect(view.x).toBeGreaterThanOrEqual(250);
  await expect(page.locator('.zijkolom-logo')).toBeVisible();
  return kolom;
}

async function verwachtDok(page, { hoogte }) {
  const dok = await page.locator('.tabs').boundingBox();
  expect(dok.y + dok.height).toBeGreaterThan(hoogte - 40);
  expect(dok.y + dok.height).toBeLessThanOrEqual(hoogte);
  expect(dok.x).toBeGreaterThanOrEqual(8);
  expect(dok.height).toBeLessThan(100);
  await expect(page.locator('.zijkolom-logo')).toBeHidden();
  return dok;
}

test('pc: zijkolom links', async ({ page }) => {
  await startApp(page, { viewport: PC });
  const kolom = await verwachtZijkolom(page, { hoogte: PC.height });
  expect(kolom.height).toBeGreaterThan(600);
  expect(await dokH(page)).toBe(0);
  const tabs = page.locator('.tabs-inner .tab:visible');
  expect(await tabs.count()).toBeGreaterThan(4);
  for (const t of await tabs.all()) {
    await expect(t.locator('svg.tab-icoon')).toHaveCount(1);
    await expect(t.locator('svg.tab-icoon')).toHaveAttribute('aria-hidden', 'true');
    const b = await t.boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(kolom.x); // de tabs staan onder elkaar in de kolom
    expect(b.x + b.width).toBeLessThanOrEqual(kolom.x + kolom.width + 0.5);
  }
  // de tekst (en de toegankelijke naam) van een tab is ongewijzigd: het icoon is decoratief
  await expect(page.locator('#tab-kalender')).toHaveText('Kalender');
  await expect(page.getByRole('tab', { name: 'Kalender', exact: true })).toHaveCount(1);
  // de persoonkiezer staat onderaan in de kolom, over de volle breedte, en zijn menu opent volledig zichtbaar
  const kiezer = await page.locator('#person-sel').boundingBox();
  expect(kiezer.x).toBeGreaterThanOrEqual(kolom.x);
  expect(kiezer.x + kiezer.width).toBeLessThanOrEqual(kolom.x + kolom.width + 0.5);
  expect(kiezer.width).toBeGreaterThan(kolom.width - 40);
  expect(kiezer.y + kiezer.height).toBeGreaterThan(kolom.y + kolom.height - 40);
  expect(kiezer.y + kiezer.height).toBeLessThanOrEqual(kolom.y + kolom.height);
  const laatsteTab = await tabs.last().boundingBox();
  expect(laatsteTab.y + laatsteTab.height).toBeLessThanOrEqual(kiezer.y);
  await page.locator('#person-btn').click();
  await expect(page.locator('#person-menu')).toHaveClass(/open/);
  const menu = await page.locator('#person-menu').boundingBox();
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(PC.height);
  expect(menu.x + menu.width).toBeLessThanOrEqual(PC.width);
  expect(menu.x).toBeGreaterThanOrEqual(kolom.x + kolom.width); // naast de kolom, niet over de tabs
  // een klik op een andere tab werkt nog (het menu bedekt de kolom niet)
  await page.locator('#tab-gepland').click();
  await expect(page.locator('#tab-gepland')).toHaveAttribute('aria-selected', 'true');
});

test('gsm: dok onderaan', async ({ page }) => {
  await zetWeergave(page, 'gsm');
  await startApp(page, { loginRol: 'technieker', viewport: GSM });
  await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
  const dok = await verwachtDok(page, { hoogte: GSM.height });
  expect(await dokH(page)).toBeGreaterThan(40);
  for (const t of await page.locator('.tabs-inner .tab:visible').all()) {
    await expect(t.locator('svg.tab-icoon')).toHaveCount(1);
    const icoon = await t.locator('svg.tab-icoon').boundingBox();
    const tekstY = await t.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); const rs = [...r.getClientRects()]; return Math.max(...rs.map(x => x.top)); });
    expect(tekstY).toBeGreaterThan(icoon.y + icoon.height - 2); // icoon boven de naam
  }
  // de kop bevat enkel de kop: --topbar-h telt het dok niet mee
  const kop = await page.locator('.topbar-sticky').boundingBox();
  expect(kop.height).toBeLessThan(80);
  // Kalender helemaal naar beneden: het laatste item staat boven het dok, niet eronder
  await page.locator('#tab-kalender').click();
  await expect(page.locator('#view-kalender')).toHaveClass(/active/);
  // De dagen worden een tik na de tabwissel getekend (en de gsm-kalender springt dan naar vandaag): pas daarna naar beneden scrollen, anders scrolt de test op een lege pagina.
  await expect(page.locator('#view-kalender .day-col').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const onderkant = await page.evaluate(() => {
    const items = [...document.querySelectorAll('#view-kalender .day-col, #view-kalender .cal-ticket, #view-kalender .cal-local-event')]
      .filter(el => el.offsetParent !== null);
    return Math.max(...items.map(el => el.getBoundingClientRect().bottom));
  });
  const dokNa = await page.locator('.tabs').boundingBox();
  expect(Math.abs(dokNa.y - dok.y)).toBeLessThan(1); // het dok blijft staan
  expect(onderkant).toBeLessThanOrEqual(dokNa.y);
  // geen horizontaal scrollen van de pagina
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('tablet staand: dok', async ({ page }) => {
  await zetWeergave(page, 'tablet');
  await startApp(page, { viewport: { width: 768, height: 1024 } });
  await expect(page.locator('html')).toHaveAttribute('data-indeling', 'tablet-staand');
  await verwachtDok(page, { hoogte: 1024 });
  expect(await dokH(page)).toBeGreaterThan(40);
  // de inhoud begint links (geen zijkolom-ruimte)
  expect((await page.locator('.view.active').boundingBox()).x).toBeLessThan(20);
  // Route vult het scherm boven het dok: de pagina scrolt niet en de kaart ligt niet onder het dok
  await page.locator('#tab-planning').click();
  await expect(page.locator('#view-planning')).toHaveClass(/active/);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await page.evaluate(() => ({
    pagina: document.documentElement.scrollHeight, scherm: window.innerHeight,
    view: document.getElementById('view-planning').getBoundingClientRect().bottom,
    dok: document.querySelector('.tabs').getBoundingClientRect().top,
  }));
  expect(m.pagina).toBeLessThanOrEqual(m.scherm + 1);
  expect(m.view).toBeLessThanOrEqual(m.dok);
});

test('tablet liggend: zijkolom', async ({ page }) => {
  await zetWeergave(page, 'tablet');
  await startApp(page, { viewport: { width: 1024, height: 768 } });
  await verwachtZijkolom(page, { hoogte: 768 });
  expect(await dokH(page)).toBe(0);
});

test('wisselen zonder herladen (Review Focus 2)', async ({ page }) => {
  await startApp(page, { viewport: PC });
  await verwachtZijkolom(page, { hoogte: PC.height });
  await page.setViewportSize(GSM);
  await page.evaluate(() => window.zetWeergave('gsm'));
  await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
  await expect.poll(() => dokH(page)).toBeGreaterThan(40);
  await verwachtDok(page, { hoogte: GSM.height });
  expect((await page.locator('.view.active').boundingBox()).x).toBeLessThan(20);
  // de ruimte onderaan volgt --dok-h: niets van de inhoud kan onder het dok blijven
  const ruimte = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('hoofdinhoud')).paddingBottom));
  expect(ruimte).toBeGreaterThanOrEqual(await dokH(page));

  await page.setViewportSize(PC);
  await page.evaluate(() => window.zetWeergave('computer'));
  await expect(page.locator('html')).toHaveAttribute('data-indeling', 'breed');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dok-h').trim())).toBe('0px');
  await verwachtZijkolom(page, { hoogte: PC.height });
});

// Taak 8a (Ruling 12): de navigatievorm hangt niet enkel aan het toestel. Een computervenster smaller dan 768 px krijgt het dok
// (data-nav="dok"), terwijl de indeling `breed` blijft (Route en de andere schermen hangen daaraan).
test('smal computervenster: dok onderaan, geen zijkolom (Ruling 12)', async ({ page }) => {
  await zetWeergave(page, 'computer');
  await startApp(page, { viewport: GSM });
  await expect(page.locator('html')).toHaveAttribute('data-indeling', 'breed');
  await expect(page.locator('html')).toHaveAttribute('data-nav', 'dok');
  await verwachtDok(page, { hoogte: GSM.height });
  await expect.poll(() => dokH(page)).toBeGreaterThan(40);
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingLeft))).toBe(0);
  expect((await page.locator('.view.active').boundingBox()).x).toBeLessThan(20);
  // de kop is die van het dok: logo zichtbaar, geen paginakop; de tabbalk is horizontaal
  await expect(page.locator('header .logo-icon')).toBeVisible();
  await expect(page.locator('.paginakop')).toBeHidden();
  await expect(page.locator('.tabs-inner')).not.toHaveAttribute('aria-orientation', 'vertical');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('breder en smaller venster wisselt kolom en dok zonder weergavewissel (Ruling 12)', async ({ page }) => {
  await zetWeergave(page, 'computer');
  await startApp(page, { viewport: PC });
  await expect(page.locator('html')).toHaveAttribute('data-nav', 'kolom');
  await expect(page.locator('.tabs-inner')).toHaveAttribute('aria-orientation', 'vertical');
  await page.setViewportSize({ width: 700, height: 768 });
  await expect(page.locator('html')).toHaveAttribute('data-nav', 'dok');
  await expect(page.locator('html')).toHaveAttribute('data-indeling', 'breed');
  await expect.poll(() => dokH(page)).toBeGreaterThan(40);
  await verwachtDok(page, { hoogte: 768 });
  await expect(page.locator('.tabs-inner')).not.toHaveAttribute('aria-orientation', 'vertical');
  await page.setViewportSize(PC);
  await expect(page.locator('html')).toHaveAttribute('data-nav', 'kolom');
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dok-h').trim())).toBe('0px');
  await verwachtZijkolom(page, { hoogte: PC.height });
  await expect(page.locator('.tabs-inner')).toHaveAttribute('aria-orientation', 'vertical');
});

test.describe('elke rol ziet dezelfde tabbladen als voorheen', () => {
  // De lijsten uit schermen/rol-schil.js (registreerTabs) en sales-registratie.js (SALES_TABS), in die volgorde; een computer toont ze allemaal.
  const TECHNIEK = ['tab-tickets', 'tab-kalender', 'tab-planning', 'tab-gepland', 'tab-inventaris', 'tab-rapporten', 'tab-beheer'];
  for (const loginRol of ['beheerder', 'planner']) {
    test(loginRol, async ({ page }) => {
      await startApp(page, { viewport: PC, loginRol });
      expect(await zichtbareTabIds(page)).toEqual(TECHNIEK);
    });
  }
  test('technieker', async ({ page }) => {
    await startApp(page, { viewport: PC, loginRol: 'technieker' });
    expect(await zichtbareTabIds(page)).toEqual(['tab-kalender', 'tab-gepland', 'tab-inventaris', 'tab-rapporten']);
  });
  test('sales', async ({ page }) => {
    await startSalesApp(page, { viewport: PC });
    await expect(page.locator('.tabs-inner .tab:visible')).toHaveCount(4);
    expect(await zichtbareTabIds(page)).toEqual(['tab-sales-lijst', 'tab-sales-kalender', 'tab-sales-route', 'tab-sales-afgewerkt']);
    for (const t of await page.locator('.tabs-inner .tab:visible').all()) await expect(t.locator('svg.tab-icoon')).toHaveCount(1);
  });
});
