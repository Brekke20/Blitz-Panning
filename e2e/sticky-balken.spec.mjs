import { test, expect, startApp } from './helpers.mjs';
import { startSalesApp, BEHEERDER } from './sales-hulp.mjs';

// v2.0.1: elke sticky balk onder de tabbladen plakt vlak onder kop + tabbalk (+ zichtbare meldingsbalken), bij elke scrollstand.
// Aanleiding: bij een lange Wachtrij liep een strook tussen tabbalk en balk waarin de kaarten doorschoven. Oorzaak: `html, body { height: 100% }`
// maakte de body tot een sticky-bakje ter grootte van het scherm; de kop (.topbar-sticky) schoof na verloop met de body-onderrand weg terwijl de
// balken in de tabbladen (met een eigen, langer bakje) bleven plakken. Zie public/js/sticky-offset.js (--sticky-top) en base.css.
// Een tab zonder sticky balk (Inventaris, Beheer, Afgewerkt) staat hier niet in; de bronscan in tests/sticky-balken-css.test.mjs bewaakt vaste top-waarden.
const DESKTOP = { width: 1280, height: 800 };
const GSM = { width: 375, height: 812 };

// Een echte gsm (aanraken): de kop is dan hoger (tabs 44 px) en de indeling 'smal'.
async function gsmPagina(browser) {
  const context = await browser.newContext({ viewport: GSM, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
  return { context, page: await context.newPage() };
}

const lead = (id, naam) => ({
  id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
  locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
  geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null },
});
const LEADS = Array.from({ length: 12 }, (_, i) => lead('l' + i, 'Klant' + i));

// De tabs met een sticky balk. `vast`: de tab vult zijn scherm zelf (Route): de pagina scrolt niet, de balk staat gewoon bovenaan.
const TECHNIEKER_TABS = [
  { tab: /^Wachtrij/, balk: '#view-tickets .lijst-balk' },
  { tab: /^Kalender$/, balk: '#view-kalender .kal-header' },
  { tab: /^Route$/, balk: '#view-planning .route-balk', vast: true },
  { tab: /^Ingepland/, balk: '#view-gepland .gep-week' },
  { tab: /^Rapporten$/, balk: '#view-rapporten .rapp-balk' },
];
const SALES_TABS = [
  { tab: /^Leads$/, balk: '#view-sales-lijst .lijst-balk' },
  { tab: /^Kalender$/, balk: '#view-sales-kalender .kal-header' },
  { tab: /^Route$/, balk: '#view-sales-route .route-balk', vast: true },
];
const zonder = (tabs, ...res) => tabs.filter(t => !res.some(re => String(t.tab) === String(re)));

const ROLLEN = [
  { naam: 'beheerder (werkruimte techniek)', tabs: TECHNIEKER_TABS, start: (page, viewport) => startApp(page, { viewport }) },
  { naam: 'technieker', tabs: zonder(TECHNIEKER_TABS, /^Wachtrij/, /^Route$/), start: (page, viewport) => startApp(page, { viewport, loginRol: 'technieker' }) },
  { naam: 'beheerder (werkruimte sales)', tabs: SALES_TABS, start: (page, viewport) => startSalesApp(page, { gebruiker: BEHEERDER, leads: LEADS, blokken: [], viewport }) },
  { naam: 'verkoper', tabs: SALES_TABS, start: (page, viewport) => startSalesApp(page, { leads: LEADS, blokken: [], viewport }) },
];

// Onderkant van kop + tabbalk + elke zichtbare meldingsbalk, en wat er op het punt net onder de tabbalk (en net onder de balk) zichtbaar is.
function meet(balkSel) {
  const balk = document.querySelector(balkSel);
  const kop = document.querySelector('.topbar-sticky').getBoundingClientRect();
  const banners = ['offline-banner', 'outbox-banner'].map(id => document.getElementById(id)).filter(el => el && getComputedStyle(el).display !== 'none');
  const verwachteTop = Math.max(kop.bottom, ...banners.map(el => el.getBoundingClientRect().bottom));
  const b = balk.getBoundingClientRect();
  const x = Math.round(window.innerWidth / 2);
  const dekt = (y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'niets';
    if (el.closest('.topbar-sticky, #offline-banner, #outbox-banner')) return 'kop';
    return balk.contains(el) ? 'balk' : (el.className || el.tagName);
  };
  return {
    kopOnder: kop.bottom, verwachteTop, balkTop: b.top, balkOnder: b.bottom, scrollY: window.scrollY,
    var: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top')),
    direktOnderTabbalk: dekt(kop.bottom + 1), opBalk: dekt(Math.min(window.innerHeight - 1, b.top + 2)),
    kopTop: kop.top, paginaHoogte: document.documentElement.scrollHeight, schermHoogte: window.innerHeight,
  };
}

async function controleer(page, label, balkSel, scrollY) {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const m = await page.evaluate(meet, balkSel);
  const wat = `${label} @scroll ${scrollY} (werkelijk ${m.scrollY})`;
  expect(m.kopTop, `${wat}: de kop blijft bovenaan staan`).toBeCloseTo(0, 0);
  expect(Math.abs(m.balkTop - m.verwachteTop), `${wat}: balk.top ${m.balkTop} moet gelijk zijn aan de onderkant van kop en meldingsbalken ${m.verwachteTop}`).toBeLessThanOrEqual(1);
  expect(Math.abs(m.var - m.verwachteTop), `${wat}: --sticky-top ${m.var} volgt de echte onderkant ${m.verwachteTop}`).toBeLessThanOrEqual(1);
  expect(m.direktOnderTabbalk, `${wat}: net onder de tabbalk staat de kop, een meldingsbalk of de balk, nooit inhoud ertussen`).toMatch(/^(kop|balk)$/);
  expect(m.opBalk, `${wat}: de balk ligt bovenaan`).toBe('balk');
  return m;
}

const bannersH = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--banners-h')));

async function doeTabs(page, rol, { gsm }) {
  for (const { tab, balk, vast } of rol.tabs) {
    let tabKnop = page.getByRole('tab', { name: tab });
    // Open dag (taak 6, aangepast in taak 7): op een gsm met meer dan 5 tabs staan de overige achter "Meer" (de echte tab is dan verborgen
    // en het blad klikt hem door). Enkel de weg naar de tab verandert; wat er gemeten wordt, blijft gelijk.
    if (gsm && !(await tabKnop.isVisible()) && (await page.locator('.dok-meer').isVisible())) {
      await page.locator('.dok-meer').click();
      const inMeer = page.locator('.dok-meer-blad .dok-meer-item', { hasText: tab });
      if (await inMeer.count()) tabKnop = inMeer; else await page.keyboard.press('Escape');
    }
    if (!(await tabKnop.isVisible())) { expect(vast && gsm, `de tab ${tab} ontbreekt onverwacht`).toBe(true); continue; } // Route bestaat niet op een gsm
    const label = `${rol.naam}, ${tab}, ${gsm ? 'gsm 375' : 'computer 1280'}`;
    await tabKnop.click();
    await expect(page.locator(balk)).toHaveCount(1);
    await expect(page.locator(balk)).toBeVisible();
    if (!vast) {
      // genoeg inhoud om ver te scrollen, in dezelfde ouder als de balk (zoals de echte kaarten/rijen)
      await page.evaluate((sel) => {
        const d = document.createElement('div');
        d.id = 'zz-vuller'; d.textContent = 'inhoud'; d.style.cssText = 'height:4000px;background:#c00;color:#fff';
        document.querySelector(sel).parentElement.appendChild(d);
      }, balk);
    }
    for (const y of vast ? [0] : [0, 600, 1800]) {
      const m = await controleer(page, label, balk, y);
      if (!vast && y > 0) expect(m.scrollY, `${label}: de pagina scrolt echt`).toBeGreaterThan(y - 5);
      if (vast) expect(m.paginaHoogte, `${label}: de Route-tab vult het scherm, de pagina scrolt niet`).toBeLessThanOrEqual(m.schermHoogte + 1);
    }
    // Offline-balk en outbox-balk zichtbaar: de balk plakt eronder en bedekt ze niet.
    await page.evaluate(() => {
      document.getElementById('offline-banner').style.display = 'flex';
      const o = document.getElementById('outbox-banner'); o.style.display = 'flex'; o.textContent = 'Rapport #1 wacht op verzending';
    });
    await expect.poll(() => bannersH(page), { message: `${label}: --banners-h volgt de zichtbare balken` }).toBeGreaterThan(20);
    for (const y of vast ? [0] : [0, 1800]) await controleer(page, label + ' met meldingsbalken', balk, y);
    await page.evaluate(() => { for (const id of ['offline-banner', 'outbox-banner']) document.getElementById(id).style.display = ''; });
    await expect.poll(() => bannersH(page)).toBe(0);
    await page.evaluate(() => { document.getElementById('zz-vuller')?.remove(); window.scrollTo(0, 0); });
  }
}

for (const rol of ROLLEN) {
  test(`sticky balken, ${rol.naam}, computer 1280×800`, async ({ page }) => {
    await rol.start(page, DESKTOP);
    await doeTabs(page, rol, { gsm: false });
  });
  test(`sticky balken, ${rol.naam}, gsm 375×812`, async ({ browser }) => {
    const { context, page } = await gsmPagina(browser);
    try {
      await rol.start(page, undefined);
      await doeTabs(page, rol, { gsm: true });
    } finally { await context.close(); }
  });
}

test('sticky balken: Wachtrij op 1870 breed met een lange lijst', async ({ page }) => {
  await startApp(page, { viewport: { width: 1870, height: 900 } });
  await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'height:5000px;background:#c00'; document.getElementById('view-tickets').appendChild(d); });
  await controleer(page, 'Wachtrij 1870', '#view-tickets .lijst-balk', 2500);
});
