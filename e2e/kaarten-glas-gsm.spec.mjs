import { test, expect, startApp } from './helpers.mjs';
import { seed, voegStopsToe } from './kalender-hulp.mjs';
import { leesPng, wachtOpFrames, wachtOpNavigatie, leesPakket, themaStub } from './contrast-meting.mjs';

// Optimalisatie O2: op de gsm hebben de lijstkaarten geen vervaging meer (enkel saturate), behalve 's nachts en tijdens een thema.
// Twee soorten proef:
//  1. Pixels (@contrast, echte schermafdrukken zoals e2e/hemel-contrast.spec.mjs): overdag (ochtend, middag, avond) × donker en licht ziet
//     een Wachtrijkaart, een Ingeplandkaart en een Kalenderkaart (lijstweergave, vandaag, met de nu-lijn) er met de nieuwe regel hetzelfde
//     uit als met de oude toestand (een ingevoegde stijl met blur + saturate): per kanaal hoogstens 3/255 verschil op minstens 99,5 % van
//     de pixels van de kaart.
//  2. Berekende stijl: bij nacht, bij een thema ZONDER en MET achtergrond, en op pc en tablet liggend bevat `backdrop-filter` nog `blur(`.
// Klok: vrijdag 9 okt 2026, 10:30 (DUMMY_DATA: #1006 staat op vrijdag 9 okt, #1004 op woensdag 7 okt).
const VRIJDAG = '2026-10-09T10:30:00+02:00';
const GSM = { width: 375, height: 812 };
const AAN = '?test&versiering=aan';
const KAARTEN = '.ticket, .cal-ticket, .cal-local-event, .stop, .inv-row, .sales-kaart, .sales-afgewerkt-rij, .sales-afgewerkt-kaart';

const zetToestel = (page, modus, gsm = true) => page.addInitScript(([g, m]) => {
  if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
  if (g) localStorage.setItem('blitz_weergave', 'gsm');
  if (m) localStorage.setItem('blitz_theme', m);
}, [gsm, modus]);
const stil = (page) => page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
const filterVan = (loc) => loc.evaluate((el) => { const cs = getComputedStyle(el); return cs.backdropFilter || cs.webkitBackdropFilter || 'none'; });

// De hemel staat direct op <html data-hemel> (de klok is hier niet nodig); een minuutcontrole van de app kan hem terugzetten.
async function zetHemel(page, hemel, modus) {
  await page.evaluate(([h, m]) => { document.documentElement.setAttribute('data-hemel', h); if (m) document.documentElement.setAttribute('data-theme', m); }, [hemel, modus]);
  await expect(page.locator('html')).toHaveAttribute('data-hemel', hemel);
  await wachtOpFrames(page, 2);
}

// Opent de Kalender en zet twee geplande tickets op vandaag (10:00 en 11:30; de nu-lijn van 10:3x ligt ertussen). Geeft de eerste kalenderkaart.
async function openKalenderMetKaarten(page) {
  await page.locator('#tab-kalender').click();
  await expect(page.locator('#view-kalender')).toHaveClass(/active/);
  await voegStopsToe(page, [{ id: 'o2-a', nummer: 9001, datum: '2026-10-09', uur: '10:00' }, { id: 'o2-b', nummer: 9002, datum: '2026-10-09', uur: '11:30' }]);
  return page.locator('#view-kalender .cal-ticket').first();
}

// De oude toestand: dezelfde kaarten met blur + saturate, bovenop de nieuwe regel (daarom !important).
const OUD = `html[data-apparaat="gsm"] :is(${KAARTEN}) { -webkit-backdrop-filter: blur(var(--blur)) saturate(180%) !important; backdrop-filter: blur(var(--blur)) saturate(180%) !important; }`;

// Verschil per kanaal tussen twee schermafdrukken: aandeel pixels met een verschil boven 3/255 en het grootste verschil.
function vergelijk(a, b) {
  const [x, y] = [leesPng(a), leesPng(b)];
  expect([x.breed, x.hoog], 'de twee schermafdrukken hebben dezelfde afmeting').toEqual([y.breed, y.hoog]);
  let slecht = 0, grootste = 0;
  for (let j = 0; j < x.hoog; j++) for (let i = 0; i < x.breed; i++) {
    const [p, q] = [x.kleur(i, j), y.kleur(i, j)];
    const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
    if (d > 3) slecht++;
    if (d > grootste) grootste = d;
  }
  return { aandeelSlecht: slecht / (x.breed * x.hoog), grootste, pixels: x.breed * x.hoog };
}

async function metEnZonder(page, kaart, label) {
  await kaart.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await wachtOpFrames(page, 3);
  const nieuwFilter = await filterVan(kaart);
  expect(nieuwFilter, `${label}: geen vervaging meer`).not.toContain('blur(');
  expect(nieuwFilter, `${label}: de verzadiging blijft`).toContain('saturate(');
  const nieuw = await kaart.screenshot({ animations: 'disabled' });
  const stijl = await page.addStyleTag({ content: OUD });
  await wachtOpFrames(page, 3);
  expect(await filterVan(kaart), `${label}: de oude toestand heeft de vervaging`).toContain('blur(');
  const oud = await kaart.screenshot({ animations: 'disabled' });
  await stijl.evaluate((el) => el.remove());
  const r = vergelijk(nieuw, oud);
  test.info().annotations.push({ type: `pixelverschil ${label}`, description: `${(r.aandeelSlecht * 100).toFixed(3)} % boven 3/255, grootste ${r.grootste}/255 (${r.pixels} px)` });
  console.log(`pixelverschil ${label}: ${(r.aandeelSlecht * 100).toFixed(3)} % boven 3/255, grootste ${r.grootste}/255 (${r.pixels} px)`);
  expect(r.aandeelSlecht, `${label}: aandeel pixels met meer dan 3/255 verschil`).toBeLessThanOrEqual(0.005);
}

test.describe('lijstkaarten op de gsm: zonder vervaging hetzelfde beeld', () => {
  for (const modus of ['dark', 'light']) {
    for (const hemel of ['ochtend', 'middag', 'avond']) {
      test(`@contrast ${hemel} ${modus}: Wachtrij-, Ingepland- en Kalenderkaart zien er zonder vervaging gelijk uit (hoogstens 3/255 op 99,5 % van de pixels)`, async ({ page }) => {
        test.setTimeout(120000);
        await zetToestel(page, modus);
        await startApp(page, { viewport: GSM, nu: VRIJDAG, wachtOpApp: false, overschrijf: seed() });
        await stil(page);
        await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'gsm');
        await wachtOpNavigatie(page);

        await page.locator('#tab-tickets').click();
        await zetHemel(page, hemel, modus);
        const ticket = page.locator('#view-tickets .ticket').first();
        await expect(ticket).toBeVisible();
        await metEnZonder(page, ticket, `${hemel} ${modus} wachtrij`);
        await expect(page.locator('html')).toHaveAttribute('data-hemel', hemel);

        // Kalender in de gsm-lijstweergave: de kolom van vandaag (met de nu-lijn), de kaart vlak bij die lijn
        await page.locator('#tab-kalender').click();
        await zetHemel(page, hemel, modus);
        const vandaag = page.locator('.day-col[data-date="2026-10-09"]');
        await expect(vandaag).toBeVisible();
        await expect(page.locator('.tl-wrap')).toHaveCount(0);
        await openKalenderMetKaarten(page);
        await expect(vandaag.locator('.kal-nu-marker')).toHaveText(/^nu 10:3\d$/);
        const kalkaarten = page.locator('#view-kalender .cal-ticket');
        await expect(kalkaarten.first()).toBeVisible();
        for (let i = 0; i < Math.min(await kalkaarten.count(), 4); i++) await metEnZonder(page, kalkaarten.nth(i), `${hemel} ${modus} kalender ${i + 1}`);
        await expect(page.locator('html')).toHaveAttribute('data-hemel', hemel);

        // Ingepland als laatste: de sprong naar een andere week (gep-spring) verschuift de gedeelde datum van de kalender
        await page.locator('#tab-gepland').click();
        await zetHemel(page, hemel, modus);
        await page.locator('[data-actie="gep-spring"]').click(); // met deze klok staat het enige geplande ticket in de week van 13 okt
        const gepland = page.locator('#gep-body .ticket').first();
        await expect(gepland).toBeVisible();
        await metEnZonder(page, gepland, `${hemel} ${modus} ingepland`);
        await expect(page.locator('html')).toHaveAttribute('data-hemel', hemel);
      });
    }
  }
});

test.describe('lijstkaarten behouden de vervaging waar er wel detail achter ligt', () => {
  test('gsm, nacht: wachtrij-, ingepland- en kalenderkaarten blijven vervaagd (de sterren liggen erachter)', async ({ page }) => {
    await zetToestel(page, 'dark');
    await startApp(page, { viewport: GSM, nu: VRIJDAG, wachtOpApp: false, overschrijf: seed() });
    await wachtOpNavigatie(page);
    for (const [tab, sel] of [['tickets', '#view-tickets .ticket'], ['kalender', '#view-kalender .cal-ticket'], ['gepland', '#gep-body .ticket']]) {
      await page.locator(`#tab-${tab}`).click();
      if (tab === 'kalender') await openKalenderMetKaarten(page);
      if (tab === 'gepland') await page.locator('[data-actie="gep-spring"]').click();
      await zetHemel(page, 'nacht', 'dark');
      const kaart = page.locator(sel).first();
      await expect(kaart).toBeVisible();
      expect(await filterVan(kaart), `nacht ${tab}`).toContain('blur(');
    }
  });

  test('gsm, nacht in licht: ook dan blijft de vervaging', async ({ page }) => {
    await zetToestel(page, 'light');
    await startApp(page, { viewport: GSM, nu: VRIJDAG, wachtOpApp: false, overschrijf: seed() });
    await wachtOpNavigatie(page);
    await zetHemel(page, 'nacht', 'light');
    const kaart = page.locator('#view-tickets .ticket').first();
    await expect(kaart).toBeVisible();
    expect(await filterVan(kaart)).toContain('blur(');
  });

  test('gsm, overdag zonder thema: wel zonder vervaging (de proef zelf, tegen een vals-negatief hierboven)', async ({ page }) => {
    await zetToestel(page, 'dark');
    await startApp(page, { viewport: GSM, nu: VRIJDAG, wachtOpApp: false, overschrijf: seed() });
    await zetHemel(page, 'middag', 'dark');
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
    const kaart = page.locator('#view-tickets .ticket').first();
    await expect(kaart).toBeVisible();
    expect(await filterVan(kaart)).not.toContain('blur(');
  });

  for (const [naam, maakPakket] of [
    ['met achtergrondbeeld', (p) => p],
    ['zonder achtergrondbeeld', (p) => { const k = structuredClone(p); delete k.achtergrond; return k; }],
  ]) {
    for (const hemel of ['middag', 'nacht']) {
      test(`gsm, thema ${naam}, hemel ${hemel}: de kaarten blijven vervaagd`, async ({ page }) => {
        const p = maakPakket(leesPakket('halloween'));
        await zetToestel(page, 'dark');
        await startApp(page, { query: AAN, viewport: GSM, nu: VRIJDAG, wachtOpApp: false, overschrijf: { ...seed(), themas: themaStub(p) } });
        await expect(page.locator('html')).toHaveAttribute('data-event', 'halloween');
        if (naam.startsWith('met')) await expect(page.locator('html')).toHaveAttribute('data-event-achtergrond', 'ja');
        else await expect(page.locator('html')).not.toHaveAttribute('data-event-achtergrond', /.+/);
        await zetHemel(page, hemel, 'dark');
        const kaart = page.locator('#view-tickets .ticket').first();
        await expect(kaart).toBeVisible();
        expect(await filterVan(kaart)).toContain('blur(');
        const kal = await openKalenderMetKaarten(page);
        await expect(kal).toBeVisible();
        expect(await filterVan(kal)).toContain('blur(');
      });
    }
  }
});

// Op pc en tablet liggend verandert niets (daar liggen o.a. de uurlijnen van de tijdlijn achter de kaarten).
for (const [naam, viewport, opties] of [
  ['pc 1366x768', { width: 1366, height: 768 }, {}],
  ['tablet liggend 1024x768', { width: 1024, height: 768 }, { isMobile: true, hasTouch: true }],
]) {
  test.describe(`lijstkaarten op ${naam}`, () => {
    test.use({ viewport, ...opties });
    test('overdag: wachtrij- en kalenderkaarten blijven vervaagd', async ({ page }) => {
      await zetToestel(page, 'dark', false);
      await startApp(page, { viewport, nu: VRIJDAG, wachtOpApp: false, overschrijf: seed() });
      await expect(page.locator('html')).not.toHaveAttribute('data-apparaat', 'gsm');
      await zetHemel(page, 'middag', 'dark');
      const kaart = page.locator('#view-tickets .ticket').first();
      await expect(kaart).toBeVisible();
      expect(await filterVan(kaart)).toContain('blur(');
      const kal = await openKalenderMetKaarten(page);
      await expect(kal).toBeVisible();
      expect(await filterVan(kal)).toContain('blur(');
    });
  });
}
