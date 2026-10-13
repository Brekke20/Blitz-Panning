import { test, expect, startApp } from './helpers.mjs';

// v2.1.4 Blitz Run: (1) de kaart staat gecentreerd en groot, (2) enkel het logo-icoon opent het spel, 5 snelle tikken (elk binnen 600 ms),
// met een telmelding na de 3e en 4e tik, (3) op aanraking twee grote knoppen (Bukken links, ingehouden; Springen rechts).
// Schermafbeeldingen enkel als SCHERM_MAP is gezet (voor het overdrachtsverslag).

const MAP = process.env.SCHERM_MAP;
const foto = async (page, naam) => { if (MAP) await page.screenshot({ path: `${MAP}/${naam}.png` }); };

const logo = (page) => page.locator('.logo-icon');
const overlay = (page) => page.locator('#spel-overlay');
const toast = (page) => page.locator('#spel-tik-toast');
const tikken = async (page, n) => { for (let i = 0; i < n; i++) await logo(page).click(); };
const AAN = '?test&versiering=aan';

async function openSpel(page) {
  await tikken(page, 5);
  await expect(overlay(page)).toHaveClass(/open/);
  await expect(overlay(page)).toHaveAttribute('data-status', 'start');
}

test.describe('v2.1.4 indeling op een computer', () => {
  for (const [b, h] of [[1873, 890], [1366, 768], [1024, 768]]) {
    test(`${b}x${h}: kaart gecentreerd, kop zichtbaar, canvas breed, geen horizontale scroll`, async ({ page }) => {
      await startApp(page, { viewport: { width: b, height: h }, query: AAN });
      await openSpel(page);
      const meet = await page.evaluate(() => {
        const o = document.getElementById('spel-overlay').getBoundingClientRect();
        const k = document.querySelector('#spel-overlay .spel-kaart');
        const kr = k.getBoundingClientRect();
        const kop = document.querySelector('#spel-overlay .spel-kop').getBoundingClientRect();
        const c = document.querySelector('#spel-overlay canvas').getBoundingClientRect();
        const stijl = getComputedStyle(k);
        const binnen = kr.width - parseFloat(stijl.paddingLeft) - parseFloat(stijl.paddingRight) - parseFloat(stijl.borderLeftWidth) - parseFloat(stijl.borderRightWidth);
        const el = document.documentElement;
        return {
          dx: (kr.left + kr.width / 2) - (o.left + o.width / 2), dy: (kr.top + kr.height / 2) - (o.top + o.height / 2),
          kopBoven: kop.top - o.top, kopOnder: o.bottom - kop.bottom, kopBreed: kop.width, canvasBreed: c.width, binnen, kaartBreed: kr.width,
          scroll: el.scrollWidth - el.clientWidth, canvasHoog: c.height,
        };
      });
      expect(Math.abs(meet.dx)).toBeLessThanOrEqual(4);
      expect(Math.abs(meet.dy)).toBeLessThanOrEqual(4);
      expect(meet.kopBoven).toBeGreaterThanOrEqual(0);
      expect(meet.kopOnder).toBeGreaterThan(0);
      await expect(page.locator('#spel-overlay .spel-kop h2')).toBeVisible();
      await expect(overlay(page).getByRole('button', { name: 'Sluiten' })).toBeVisible();
      expect(meet.canvasBreed).toBeGreaterThanOrEqual(meet.binnen * 0.85);
      expect(meet.canvasBreed / meet.canvasHoog).toBeCloseTo(3, 1);
      expect(meet.scroll).toBeLessThanOrEqual(0);
      if (b >= 1366) expect(meet.kaartBreed).toBeGreaterThan(b * 0.9 > 1280 ? 1200 : b * 0.9);
      if (b === 1873) await foto(page, 'v214-spel-1873');
      if (b === 1366) await foto(page, 'v214-spel-1366');
    });
  }

  test('weinig hoogte: kop en canvas blijven staan, enkel de skinkeuze scrolt in de kaart', async ({ page }) => {
    await startApp(page, { viewport: { width: 1280, height: 420 }, query: AAN });
    await openSpel(page);
    const r = await page.evaluate(() => {
      const o = document.getElementById('spel-overlay').getBoundingClientRect();
      const kop = document.querySelector('#spel-overlay .spel-kop').getBoundingClientRect();
      const kaart = document.querySelector('#spel-overlay .spel-kaart').getBoundingClientRect();
      return { kopBoven: kop.top - o.top, kaartOnder: o.bottom - kaart.bottom, kaartBoven: kaart.top - o.top };
    });
    expect(r.kopBoven).toBeGreaterThanOrEqual(0);
    expect(r.kaartBoven).toBeGreaterThanOrEqual(0);
    expect(r.kaartOnder).toBeGreaterThanOrEqual(0);
    await expect(page.locator('#spel-overlay .spel-kop h2')).toBeVisible();
  });

  test('op een computer zijn de aanraakknoppen verborgen, ook tijdens het spel', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    await openSpel(page);
    await page.keyboard.press('Space');
    await expect(overlay(page)).toHaveAttribute('data-status', 'bezig');
    await expect(overlay(page).locator('.spel-knop--bukken')).toBeHidden();
    await expect(overlay(page).locator('.spel-knop--springen')).toBeHidden();
  });
});

test.describe('v2.1.4 activatie via het logo', () => {
  test('vijf snelle tikken openen het spel', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
  });

  test('vijf trage tikken (700 ms ertussen) openen niets en de teller begint steeds opnieuw', async ({ page }) => {
    await startApp(page);
    for (let i = 0; i < 6; i++) { await logo(page).click(); await page.clock.runFor(700); }
    await expect(overlay(page)).toHaveCount(0);
  });

  test('tikken op de tekst "Blitz Planning" telt niet mee', async ({ page }) => {
    await startApp(page);
    for (let i = 0; i < 6; i++) await page.locator('.logo-text').click();
    await expect(overlay(page)).toHaveCount(0);
    await expect(toast(page)).toHaveCount(0);
    // Een gemengde reeks (3 op het logo, 2 op de tekst) telt ook niet.
    await tikken(page, 3);
    for (let i = 0; i < 2; i++) await page.locator('.logo-text').click();
    await expect(overlay(page)).toHaveCount(0);
  });

  test('melding na de 3e en 4e tik, weg bij de 5e; ze verdwijnt na ongeveer 1,5 s', async ({ page }) => {
    await startApp(page);
    await tikken(page, 2);
    await expect(toast(page)).toHaveCount(0);
    await logo(page).click();
    await expect(toast(page)).toHaveClass(/show/);
    await expect(toast(page)).toHaveText('Nog 2 keer tikken om Blitz Run te openen');
    await foto(page, 'v214-toast');
    await logo(page).click();
    await expect(toast(page)).toHaveText('Nog 1 keer tikken om Blitz Run te openen');
    await logo(page).click();
    await expect(overlay(page)).toHaveClass(/open/);
    await expect(toast(page)).not.toHaveClass(/show/);
    // Los van het openen: de melding verdwijnt vanzelf.
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveClass(/open/);
    await tikken(page, 3);
    await expect(toast(page)).toHaveClass(/show/);
    await page.clock.runFor(1600);
    await expect(toast(page)).not.toHaveClass(/show/);
  });

  test('een trage tik zet de teller terug en verbergt de melding', async ({ page }) => {
    await startApp(page);
    await tikken(page, 3);
    await expect(toast(page)).toHaveClass(/show/);
    await page.clock.runFor(700);
    await logo(page).click();
    await expect(toast(page)).not.toHaveClass(/show/);
    await logo(page).click();
    await logo(page).click(); // pas de 3e na de reset
    await expect(toast(page)).toHaveClass(/show/);
    await expect(overlay(page)).toHaveCount(0);
  });

  test('vijf snelle tikken terwijl het spel open staat sluiten het, zonder melding', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
    await page.clock.runFor(700);
    await tikken(page, 3);
    await expect(toast(page)).not.toHaveClass(/show/);
    await tikken(page, 2);
    await expect(overlay(page)).not.toHaveClass(/open/);
  });
});

const GSM = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

test.describe('v2.1.4 spel op aanraking: twee knoppen', () => {
  test.use(GSM);

  // Het deel van het canvas waar de paal staat: verandert bij springen (paal weg) en bukken (paal lager).
  const paalHandtekening = (page, y0, y1) => page.locator('#spel-overlay canvas').evaluate((c, [a, b]) => {
    const k = c.width / 600;
    const d = c.getContext('2d').getImageData(Math.round(58 * k), Math.round(a * k), Math.round(14 * k), Math.round((b - a) * k)).data;
    let som = 0; for (let i = 0; i < d.length; i += 4) som += d[i] + d[i + 1] * 3 + d[i + 2] * 7;
    return som;
  }, [y0, y1]);

  async function start(page) {
    await startApp(page, { viewport: GSM.viewport });
    await openSpel(page);
    await expect(overlay(page).locator('.spel-aanraakhint')).toBeVisible();
    await overlay(page).locator('[data-actie="spel-start"]').click();
    await expect(overlay(page)).toHaveAttribute('data-status', 'bezig');
  }
  const opties = (doos, id) => ({ clientX: doos.x + doos.width / 2, clientY: doos.y + doos.height / 2, pointerId: id, pointerType: 'touch', isPrimary: id === 7 });

  test('de knoppen staan links en rechts onderaan en zijn minstens 72 px', async ({ page }) => {
    await start(page);
    const bukken = await overlay(page).locator('.spel-knop--bukken').boundingBox();
    const springen = await overlay(page).locator('.spel-knop--springen').boundingBox();
    for (const k of [bukken, springen]) { expect(k.width).toBeGreaterThanOrEqual(72); expect(k.height).toBeGreaterThanOrEqual(72); }
    expect(bukken.x + bukken.width / 2).toBeLessThan(375 / 2);
    expect(springen.x + springen.width / 2).toBeGreaterThan(375 / 2);
    expect(bukken.y + bukken.height).toBeGreaterThan(812 - 40);
    expect(springen.y + springen.height).toBeLessThanOrEqual(812);
    await expect(overlay(page).locator('.spel-knop--bukken')).toContainText('Bukken');
    await expect(overlay(page).locator('.spel-knop--springen')).toContainText('Springen');
    await foto(page, 'v214-spel-gsm');
  });

  test('Springen springt', async ({ page }) => {
    await start(page);
    await page.clock.runFor(100);
    const staand = await paalHandtekening(page, 120, 166);
    const knop = await overlay(page).locator('.spel-knop--springen').boundingBox();
    await page.touchscreen.tap(knop.x + knop.width / 2, knop.y + knop.height / 2);
    await page.clock.runFor(130);
    expect(await paalHandtekening(page, 120, 166)).not.toBe(staand);
  });

  test('Bukken ingehouden bukt, loslaten staat op; meerdere vingers tegelijk werken', async ({ page }) => {
    await start(page);
    await page.clock.runFor(100);
    const stond = await paalHandtekening(page, 120, 134);
    const bukken = overlay(page).locator('.spel-knop--bukken');
    const springen = overlay(page).locator('.spel-knop--springen');
    const bDoos = await bukken.boundingBox();
    await bukken.dispatchEvent('pointerdown', opties(bDoos, 7));
    await expect(bukken).toHaveClass(/is-ingedrukt/);
    await page.clock.runFor(100);
    expect(await paalHandtekening(page, 120, 134)).not.toBe(stond);
    // tweede vinger op Springen terwijl Bukken ingehouden blijft: Bukken blijft ingedrukt
    const sDoos = await springen.boundingBox();
    await springen.dispatchEvent('pointerdown', opties(sDoos, 8));
    await springen.dispatchEvent('pointerup', opties(sDoos, 8));
    await expect(bukken).toHaveClass(/is-ingedrukt/);
    await bukken.dispatchEvent('pointerup', opties(bDoos, 7));
    await expect(bukken).not.toHaveClass(/is-ingedrukt/);
    await page.clock.runFor(700);
    if (await overlay(page).getAttribute('data-status') === 'bezig') {
      await expect.poll(() => paalHandtekening(page, 120, 134)).toBe(stond); // weer rechtop
    }
  });

  test('een tik of een ingehouden vinger midden op het scherm bukt nooit', async ({ page }) => {
    await start(page);
    await page.clock.runFor(100);
    const stond = await paalHandtekening(page, 120, 134);
    const o = await overlay(page).boundingBox();
    // ingehouden vinger in het midden en onderaan (tussen de knoppen), buiten het canvas
    for (const f of [0.5, 0.75, 0.92]) {
      const opt = { clientX: 187, clientY: o.y + o.height * f, pointerId: 9, pointerType: 'touch', isPrimary: true };
      await overlay(page).dispatchEvent('pointerdown', opt);
      await page.clock.runFor(100);
      expect(await paalHandtekening(page, 120, 134)).toBe(stond);
      await overlay(page).dispatchEvent('pointerup', opt);
    }
    await page.touchscreen.tap(187, o.y + o.height * 0.5);
    await page.clock.runFor(60);
    expect(await paalHandtekening(page, 120, 134)).toBe(stond);
  });

  test('een tik op het canvas springt als extra', async ({ page }) => {
    await start(page);
    await page.clock.runFor(100);
    const staand = await paalHandtekening(page, 120, 166);
    const c = await page.locator('#spel-overlay canvas').boundingBox();
    await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height * 0.7);
    await page.clock.runFor(130);
    expect(await paalHandtekening(page, 120, 166)).not.toBe(staand);
  });
});
