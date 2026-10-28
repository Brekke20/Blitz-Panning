import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// Open dag-stijl, taak 3: elke kaart is glas met een gloed langs de omtrek in de kleur van de urgentie.
// Klok: maandag 5 okt 2026 09:00; DUMMY_DATA: #1001 (hoog, verlopen), #1002 (middel), #1003 (laag), #1004 (wacht op bevestiging, wo 7 okt).

// De vervaging van een kaart per toestel staat op één plek, zodat een latere terugval (gsm zonder backdrop-filter, taak 10) één aanpassing is.
const VERWACHT_BLUR_PC = 'blur(28px)';
const VERWACHT_BLUR_GSM = 'blur(10px)';
const verwachtBlurOpGsm = (waarde) => expect(waarde).toContain(VERWACHT_BLUR_GSM);

const zetGsm = (page) => page.addInitScript(() => {
  if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
  localStorage.setItem('blitz_weergave', 'gsm');
});
const rand = (loc) => loc.evaluate((el) => getComputedStyle(el).borderTopColor);
// [r, g, b, alpha] op 0-255, ook voor de moderne notatie 'color(srgb 1 0.35 0.32 / 0.55)' die color-mix teruggeeft
const kleurDelen = (css) => {
  const d = css.match(/[\d.]+/g).map(Number);
  return css.startsWith('color(srgb') ? [d[0] * 255, d[1] * 255, d[2] * 255, d[3] ?? 1] : d.slice(0, 4);
};
const isRoodachtig = ([r, g, b]) => r > g && r > b;
const isOranjeachtig = ([r, g, b]) => r > b && g > b && r >= g; // oranje: rood het sterkst, groen middel, blauw laag
const ticket = (page, nr) => page.locator('#view-tickets .ticket', { hasText: `#${nr}` });

test.describe('glazen kaarten', () => {
  test('kaarten zijn glas op pc', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    const kaart = page.locator('#view-tickets .ticket').first();
    await expect(kaart).toBeVisible();
    const stijl = await kaart.evaluate((el) => { const cs = getComputedStyle(el); return { filter: cs.backdropFilter, radius: cs.borderTopLeftRadius, rand: cs.borderTopWidth }; });
    expect(stijl.filter).toContain(VERWACHT_BLUR_PC);
    expect(stijl.radius).toBe('22px');
    expect(stijl.rand).toBe('1px');
  });

  test('gsm: minder vervaging', async ({ page }) => {
    await zetGsm(page);
    await startApp(page, { viewport: { width: 375, height: 812 } });
    await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'gsm');
    const kaart = page.locator('#view-tickets .ticket').first();
    await expect(kaart).toBeVisible();
    verwachtBlurOpGsm(await kaart.evaluate((el) => getComputedStyle(el).backdropFilter));
  });

  // Eindreview F2: op gsm geen schermbrede of geneste vervaging op de wizard en de vaste kop/voet van een venster (dat is de zwaarste
  // laag op een telefoon); de laag is dan bijna effen, zodat de pagina eronder niet doorschemert. Op pc blijft het glas.
  for (const modus of ['dark', 'light']) {
    test(`gsm (${modus}): wizard en vensterkop/-voet zonder backdrop-filter, bijna effen`, async ({ page }) => {
      await page.addInitScript((t) => { if (window === window.top) { localStorage.setItem('blitz_weergave', 'gsm'); localStorage.setItem('blitz_theme', t); } }, modus);
      await startApp(page, { viewport: { width: 375, height: 812 } });
      await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'gsm');
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      const meting = await page.evaluate(() => {
        const lees = (el) => {
          const cs = getComputedStyle(el);
          const m = cs.backgroundColor.match(/rgba?\(([^)]*)\)/)[1].split(',').map(parseFloat);
          return { filter: cs.backdropFilter || cs.webkitBackdropFilter || 'none', alpha: m.length > 3 ? m[3] : 1 };
        };
        return {
          wizard: lees(document.getElementById('rapport-wizard')),
          kop: lees(document.querySelector('#det-overlay .mhdr')),
          voet: lees(document.querySelector('#det-overlay .mftr')),
        };
      });
      for (const [naam, m] of Object.entries(meting)) {
        expect(m.filter, `${naam} backdrop-filter`).toBe('none');
        expect(m.alpha, `${naam} dekking`).toBeGreaterThanOrEqual(0.97);
      }
    });
  }

  test('pc: de wizard en de vensterkop houden hun glas', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    const f = await page.evaluate(() => ['#rapport-wizard', '#det-overlay .mhdr', '#det-overlay .mftr'].map((s) => { const cs = getComputedStyle(document.querySelector(s)); return cs.backdropFilter || cs.webkitBackdropFilter; }));
    for (const x of f) expect(x).toContain('blur(');
  });

  // Eindreview F8: "verminderde transparantie" (prefers-reduced-transparency: reduce) geeft effen kaarten zonder backdrop-filter.
  // Playwright kent deze mediafunctie niet; ze wordt via het DevTools-protocol (Emulation.setEmulatedMedia) aangezet.
  for (const modus of ['dark', 'light']) {
    test(`verminderde transparantie (${modus}): kaarten zijn bijna effen en hebben geen backdrop-filter`, async ({ page }) => {
      await page.addInitScript((t) => { if (window === window.top) localStorage.setItem('blitz_theme', t); }, modus);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
      await startApp(page, { viewport: { width: 1366, height: 768 } });
      await expect(page.locator('html')).toHaveAttribute('data-theme', modus);
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches), 'mediafunctie actief').toBe(true);
      const kaart = page.locator('#view-tickets .ticket').first();
      await expect(kaart).toBeVisible();
      const m = await kaart.evaluate((el) => {
        const cs = getComputedStyle(el);
        const d = cs.backgroundColor.match(/rgba?\(([^)]*)\)/)[1].split(',').map(parseFloat);
        return { filter: cs.backdropFilter || cs.webkitBackdropFilter || 'none', alpha: d.length > 3 ? d[3] : 1 };
      });
      expect(m.filter).toBe('none');
      expect(m.alpha).toBeGreaterThanOrEqual(0.94);
    });
  }

  const maat = (loc) => loc.evaluate((el) => { const cs = getComputedStyle(el); return [cs.paddingTop, cs.paddingLeft, cs.marginBottom, cs.borderTopLeftRadius]; });

  test('dichtheid op breed: 15/18 en 10 px ertussen', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'breed');
    expect(await maat(page.locator('#view-tickets .ticket').first())).toEqual(['15px', '18px', '10px', '22px']);
  });

  test('dichtheid op smal: 18/20, 12 px ertussen en hoeken van 26 px', async ({ page }) => {
    await zetGsm(page);
    await startApp(page, { viewport: { width: 375, height: 812 } });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
    expect(await maat(page.locator('#view-tickets .ticket').first())).toEqual(['18px', '20px', '12px', '26px']);
  });

  test('verlopen ticket gloeit rood, een ticket met lage prioriteit groen', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    const verlopen = page.locator('#view-tickets .ticket.overdue').first();
    const laag = ticket(page, 1003);
    await expect(verlopen).toBeVisible();
    await expect(laag).toBeVisible();
    const rood = kleurDelen(await rand(verlopen));
    const groen = kleurDelen(await rand(laag));
    expect(await rand(verlopen)).not.toBe(await rand(laag));
    expect(isRoodachtig(rood), `rand van het verlopen ticket ${rood}`).toBe(true);
    expect(groen[1], `rand van het lage ticket ${groen}`).toBeGreaterThan(groen[0]); // groen: G > R
    // de gloed zelf: een schaduw rond en in de kaart
    expect(await verlopen.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/inset/);
    // geen linkerbalk meer
    expect(await verlopen.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
  });

  test('prioriteit middel gloeit oranje; het label Verlopen houdt de statuskleur', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    const middel = ticket(page, 1002);
    await expect(middel).toBeVisible();
    const oranje = kleurDelen(await rand(middel));
    expect(isOranjeachtig(oranje), `rand van het middel-ticket ${oranje}`).toBe(true);
    const label = page.locator('#view-tickets .ticket.overdue .stag').first();
    // de statuskleur zelf: --red (#ff5a52 in donker), niet door het kaartglas overschreven
    expect(await label.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 90, 82)');
  });

  test('afspraak in de kalender gloeit volgens status (wacht op bevestiging = oranje)', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 }, overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    const wacht = page.locator('#view-kalender .cal-ticket.pending').first();
    const bevestigd = page.locator('#view-kalender .cal-ticket.confirmed').first();
    await expect(wacht).toBeVisible();
    await expect(bevestigd).toBeVisible();
    const oranje = kleurDelen(await rand(wacht));
    const groen = kleurDelen(await rand(bevestigd));
    expect(isOranjeachtig(oranje), `wacht op bevestiging: ${oranje}`).toBe(true);
    expect(groen[1], `bevestigd: ${groen}`).toBeGreaterThan(groen[0]);
    expect(await wacht.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('16px');
  });

  test('de rand blijft gekleurd bij hover (enkel de achtergrond vervaagt) en de kaart verschuift niet', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    const verlopen = page.locator('#view-tickets .ticket.overdue').first();
    await expect(verlopen).toBeVisible();
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    const meet = () => verlopen.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, t: getComputedStyle(el).transform, top: el.getBoundingClientRect().top, rand: getComputedStyle(el).borderTopColor }));
    const voor = await meet();
    await verlopen.hover();
    const na = await meet();
    expect(na.bg).not.toBe(voor.bg);
    expect(na.t).toBe(voor.t);
    expect(na.top).toBe(voor.top);
    expect(isRoodachtig(kleurDelen(na.rand))).toBe(true);
  });
});
