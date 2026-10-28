import { test, expect, startApp, kiesHoofdtab } from './helpers.mjs';
import { seed, voegStopsToe } from './kalender-hulp.mjs';

// Taak 17: de kalender op een gsm (dagen onder elkaar) springt bij het openen naar vandaag en het huidige uur.
// Klok: vrijdag 9 okt 2026, 10:30 (Europe/Brussels). DUMMY_DATA zet #1004 op woensdag 7 okt en #1006 op vrijdag 9 okt.
const VRIJDAG = '2026-10-09T10:30:00+02:00';
const GSM = { width: 375, height: 812 };

const zetWeergave = (page, weergave) => page.addInitScript((w) => {
  if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
  localStorage.setItem('blitz_weergave', w);
}, weergave);

const open = async (page, viewport, weergave) => {
  await zetWeergave(page, weergave);
  await startApp(page, { viewport, nu: VRIJDAG, wachtOpApp: false, overschrijf: seed() });
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await expect(page.locator('#view-kalender')).toHaveClass(/active/);
  await expect(page.locator('.day-col[data-date="2026-10-09"]')).toBeVisible();
};

// Wat bovenaan vastzit (kalenderkop) en onderaan (dok) valt niet in "zichtbaar".
const zichtbaarGebied = (page) => page.evaluate(() => {
  const kop = document.querySelector('#view-kalender .kal-header').getBoundingClientRect();
  const dok = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dok-h')) || 0;
  return { boven: kop.bottom, onder: window.innerHeight - dok };
});
// Een tik van de event loop: de sprong van de lijstweergave volgt één tik na de render (na de scrollherstelling van metBehoudScroll).
const eenTik = (page) => page.evaluate(() => new Promise((klaar) => setTimeout(klaar, 50)));
// Wacht tot de pagina stilstaat (de sprong en de herhaalsprong na late gegevens zijn klaar): twee metingen na elkaar gelijk.
const rustigeScroll = (page) => expect.poll(async () => { const a = await page.evaluate(() => window.scrollY); await eenTik(page); return a === await page.evaluate(() => window.scrollY); }).toBe(true);
const rect = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });

async function verwachtVandaagInBeeld(page) {
  const kolom = page.locator('.day-col[data-date="2026-10-09"]');
  const marker = kolom.locator('.kal-nu-marker');
  await expect(marker).toHaveText(/^nu 10:3\d$/);
  await expect.poll(async () => {
    const g = await zichtbaarGebied(page);
    const [k, m] = [await rect(kolom.locator('.day-hdr')), await rect(marker)];
    return { kopOk: k.top >= g.boven - 1 && k.bottom <= g.onder, markerOk: m.top >= g.boven - 1 && m.bottom <= g.onder };
  }).toEqual({ kopOk: true, markerOk: true });
}

test.describe('kalender op een gsm: spring naar vandaag en het huidige uur', () => {
  test('bij het openen van de tab staan de kolom van vandaag en de nu-regel in beeld (vrijdag)', async ({ page }) => {
    await open(page, GSM, 'gsm');
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(100); // echt gescrold: maandag tot donderdag staan erboven
    await verwachtVandaagInBeeld(page);
    await expect(page.locator('.tl-wrap')).toHaveCount(0);
  });

  test('een gewone her-render (toestandswijziging) zet een handmatige scroll niet terug', async ({ page }) => {
    await open(page, GSM, 'gsm');
    await verwachtVandaagInBeeld(page);
    const voor = await page.evaluate(() => window.scrollY);
    await page.mouse.move(180, 400);
    await page.mouse.wheel(0, -350);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(voor - 100);
    const na = await page.evaluate(() => window.scrollY);
    const teller = await page.evaluate(() => kern.kalender.renderTelling());
    await page.evaluate(() => kern.toestand.raak('localEvents')); // zoals een poll die nieuwe gegevens binnenbrengt
    await expect.poll(() => page.evaluate(() => kern.kalender.renderTelling())).toBeGreaterThan(teller);
    await eenTik(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(na);
  });

  test('gegevens die na de sprong binnenkomen (kaartjes boven vandaag) schuiven vandaag niet uit beeld, zolang de gebruiker niet zelf scrolde', async ({ page }) => {
    await open(page, GSM, 'gsm');
    await verwachtVandaagInBeeld(page);
    const stops = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].flatMap((datum, i) => [1, 2, 3].map((n) => ({ id: `late${i}${n}`, nummer: `90${i}${n}`, datum, uur: `0${7 + n}:00` })));
    await voegStopsToe(page, stops);
    await expect(page.locator('.day-col[data-date="2026-10-05"] .cal-ticket')).toHaveCount(3);
    await verwachtVandaagInBeeld(page);
  });

  test('een andere week of een gekozen dag: spring naar die dag; vandaag-knop brengt terug naar nu', async ({ page }) => {
    await open(page, GSM, 'gsm');
    await page.getByRole('button', { name: 'Volgende periode' }).first().click();
    const kolom = page.locator('.day-col[data-date="2026-10-16"]');
    await expect(kolom).toBeVisible();
    await expect.poll(async () => {
      const g = await zichtbaarGebied(page);
      const k = await rect(kolom.locator('.day-hdr'));
      return k.top >= g.boven - 1 && k.top < g.onder - 40;
    }).toBe(true);
    await expect(page.locator('.kal-nu-marker')).toHaveCount(0);
    await page.locator('#kal-label').click();
    await verwachtVandaagInBeeld(page);
  });

  test('wisselen van tabblad en terug springt opnieuw naar nu', async ({ page }) => {
    await open(page, GSM, 'gsm');
    await verwachtVandaagInBeeld(page);
    await page.getByRole('tab', { name: /Wachtrij/ }).click();
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await verwachtVandaagInBeeld(page);
  });
});

// Na de sprong schuift tekst van de dagen erboven onder de kop en de kalenderbalk door. Eén laag glas liet die als vage schim doorschijnen (de titel onder het
// logo, de rand van de kaart onder de werkbalk). Meting: de beeldpunten van kop plus kalenderbalk met en zonder de inhoud van de week (die onzichtbaar gezet).
// Taak 17 loste dit op met een tweede glaslaag (grootste verschil 10 donker en 3 licht op 255); v2.5.1 haalt die laag weg (het glas is te dicht, Brent) en
// vervangt hem door een sterkere vervaging (--blur-balk). De grens is daarmee bewust veranderd van "onzichtbaar" naar "niet leesbaar": er mag een zachte
// vlek doorschemeren, maar geen scherpe tekst of rand. Twee metingen op het verschilbeeld (met min zonder inhoud): `max` (hoe sterk, op 255) en `scherp`
// (het grootste verschil tussen twee naburige beeldpunten: een leesbare letter of rand geeft er tientallen, een uitgesmeerde vlek enkele).
// Gemeten (gsm 375, met de vervaging van de balken): donker max 20 en scherp 19, licht 14 en 14. Zonder vervaging (blur 0): donker 132 en 124, licht 68 en 62
// (dan is de tekst leesbaar). De grenzen liggen er ruim tussen, dichter bij het gemeten resultaat dan bij het leesbare.
for (const [thema, grensMax, grensScherp] of [['dark', 30, 26], ['light', 22, 20]]) {
  test(`na de sprong is de inhoud onder de kop en de kalenderbalk niet leesbaar (${thema})`, async ({ page }) => {
    await page.addInitScript((t) => { if (window === window.top) localStorage.setItem('blitz_theme', t); }, thema);
    await open(page, GSM, 'gsm');
    await expect(page.locator('html')).toHaveAttribute('data-theme', thema);
    await expect(page.locator('#kal-pending-pill')).toBeVisible(); // de gegevens zijn binnen: de kalenderbalk groeit nog met de pil "zonder datum"
    await verwachtVandaagInBeeld(page);
    await rustigeScroll(page);
    const kop = await page.evaluate(() => Math.round(document.querySelector('#view-kalender .kal-header').getBoundingClientRect().bottom));
    const clip = { x: 0, y: 0, width: GSM.width, height: kop };
    const met = (await page.screenshot({ clip })).toString('base64');
    await page.addStyleTag({ content: '#week-grid, #week-grid * { visibility: hidden !important; }' });
    const zonder = (await page.screenshot({ clip })).toString('base64');
    const { max, scherp } = await page.evaluate(async ([a, b]) => {
      const lees = async (s) => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob()); const c = new OffscreenCanvas(bm.width, bm.height); c.getContext('2d').drawImage(bm, 0, 0); const d = c.getContext('2d').getImageData(0, 0, bm.width, bm.height); return { d: d.data, w: bm.width, h: bm.height }; };
      const [p, q] = [await lees(a), await lees(b)];
      const w = p.w, h = p.h;
      const v = new Float32Array(w * h); // verschil per beeldpunt: het grootste van r, g en b
      let m = 0;
      for (let i = 0; i < w * h; i++) {
        const j = i * 4;
        v[i] = Math.max(Math.abs(p.d[j] - q.d[j]), Math.abs(p.d[j + 1] - q.d[j + 1]), Math.abs(p.d[j + 2] - q.d[j + 2]));
        m = Math.max(m, v[i]);
      }
      let s = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x + 1 < w) s = Math.max(s, Math.abs(v[i] - v[i + 1]));
        if (y + 1 < h) s = Math.max(s, Math.abs(v[i] - v[i + w]));
      }
      return { max: m, scherp: s };
    }, [met, zonder]);
    expect(max, 'sterkte van wat doorschemert').toBeLessThanOrEqual(grensMax);
    expect(scherp, 'scherpte van wat doorschemert (een leesbare letter of rand geeft tientallen)').toBeLessThanOrEqual(grensScherp);
  });
}
