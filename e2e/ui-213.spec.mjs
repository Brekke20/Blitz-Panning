import { test, expect, startApp } from './helpers.mjs';
import { seed } from './kalender-hulp.mjs';

// v2.1.3: vier gemelde UI-problemen. (1) het spelkaartje onder de balken, (2) het spel op een gsm schermvullend en overal tikbaar,
// (3) de ronde "+"-knoppen zijn echte cirkels, (4) rapportvoorbeeld en handtekening vullen de tablet.
// Schermafbeeldingen enkel als SCHERM_MAP is gezet (voor het overdrachtsverslag).

const MAP = process.env.SCHERM_MAP;
const foto = async (page, naam) => { if (MAP) await page.screenshot({ path: `${MAP}/${naam}.png` }); };

const TABLET = { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const GSM = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const overlay = (page) => page.locator('#spel-overlay');
async function openSpel(page) {
  for (let i = 0; i < 5; i++) await page.locator('.logo-icon').click();
  await expect(overlay(page)).toHaveClass(/open/);
  await expect(overlay(page)).toHaveAttribute('data-status', 'start');
}
const balkOnder = (page) => page.locator('.topbar-sticky').evaluate((e) => e.getBoundingClientRect().bottom);
const kaartBoven = (page) => page.locator('#spel-overlay .spel-kaart').evaluate((e) => e.getBoundingClientRect().top);

async function kaartOnderBalken(page) {
  expect(await kaartBoven(page)).toBeGreaterThanOrEqual((await balkOnder(page)) - 0.5);
  const kop = await page.locator('#spel-overlay .spel-kop h2').boundingBox();
  expect(kop.y).toBeGreaterThanOrEqual((await balkOnder(page)) - 0.5);
}

test.describe('v2.1.3 spel: kaart onder de balken', () => {
  test.describe('met aanraking', () => {
    test.use(GSM);
    test('gsm staand en liggend', async ({ page }) => {
      await startApp(page, { viewport: GSM.viewport });
      await openSpel(page);
      await kaartOnderBalken(page);
      await page.setViewportSize({ width: 812, height: 375 });
      await kaartOnderBalken(page);
    });
  });
  test('desktop, ook bij weinig hoogte, scrollen en verkleinen', async ({ page }) => {
    await startApp(page, { viewport: { width: 1280, height: 800 } });
    await openSpel(page);
    await kaartOnderBalken(page);
    await foto(page, 'v213-spel-desktop');
    await page.setViewportSize({ width: 1280, height: 380 }); // kaart hoger dan het overlay: bovenkant moet bereikbaar blijven
    await page.evaluate(() => window.scrollTo(0, 200));
    await kaartOnderBalken(page);
    await page.setViewportSize({ width: 900, height: 700 });
    await kaartOnderBalken(page);
  });
  test('tablet liggend en staand', async ({ page }) => {
    await startApp(page, { viewport: TABLET.viewport });
    await openSpel(page);
    await kaartOnderBalken(page);
    await page.setViewportSize({ width: 768, height: 1024 });
    await kaartOnderBalken(page);
  });
});

test.describe('v2.1.3 spel op een gsm', () => {
  test.use(GSM);

  test('canvas vult de breedte, scherp (apparaatpixels) en het hele overlay is tikbaar', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
    const doos = await page.locator('#spel-overlay canvas').boundingBox();
    expect(doos.width).toBeGreaterThanOrEqual(375 * 0.9);
    const pixels = await page.locator('#spel-overlay canvas').evaluate((c) => ({ b: c.width, h: c.height }));
    expect(pixels.b).toBeGreaterThanOrEqual(Math.round(doos.width * 2) - 2); // dpr 2
    expect(pixels.b / pixels.h).toBeCloseTo(3, 1); // wereld ongewijzigd (600 x 200)
    await expect(overlay(page).locator('.spel-draai')).toBeVisible(); // draai-hint in staande stand
    await foto(page, 'v213-spel-gsm');
    await page.setViewportSize({ width: 812, height: 375 });
    const liggend = await page.locator('#spel-overlay canvas').boundingBox();
    expect(liggend.width).toBeGreaterThan(doos.width);
    expect(await kaartBoven(page)).toBeGreaterThanOrEqual((await balkOnder(page)) - 0.5);
    await foto(page, 'v213-spel-gsm-liggend');
  });

  // Het deel van het canvas waar de paal staat (zonder sterren en grond): verandert bij springen (paal weg) en bukken (paal lager).
  const paalHandtekening = (page, y0, y1) => page.locator('#spel-overlay canvas').evaluate((c, [a, b]) => {
    const k = c.width / 600;
    const d = c.getContext('2d').getImageData(Math.round(58 * k), Math.round(a * k), Math.round(14 * k), Math.round((b - a) * k)).data;
    let som = 0; for (let i = 0; i < d.length; i += 4) som += d[i] + d[i + 1] * 3 + d[i + 2] * 7;
    return som;
  }, [y0, y1]);

  // v2.1.4: de halve-scherm-tikvlakken zijn vervangen door twee grote knoppen (zie ook e2e/spel-214.spec.mjs).
  test('tijdens het spel zijn info en keuze weg en staan de knoppen Bukken en Springen onderaan', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
    await overlay(page).locator('[data-actie="spel-start"]').click();
    await expect(overlay(page)).toHaveAttribute('data-status', 'bezig');
    await expect(overlay(page).locator('.spel-skins')).toBeHidden();
    await expect(overlay(page).locator('.spel-hint')).toBeHidden();
    await expect(overlay(page).locator('.spel-knop--bukken')).toBeVisible();
    await expect(overlay(page).locator('.spel-knop--springen')).toBeVisible();
    const o = await overlay(page).boundingBox();
    expect(o.height).toBeGreaterThan(812 * 0.7); // schermvullend onder de balken
    await foto(page, 'v213-spel-gsm-bezig');
  });
});

test.describe('v2.1.3 ronde plusknoppen', () => {
  for (const [naam, cfg] of [['tablet', TABLET], ['gsm', GSM]]) {
    test.describe(naam, () => {
    test.use(cfg);
    test(`wachtrij op ${naam}: de + is een cirkel van minstens 44 px`, async ({ page }) => {
      await startApp(page, { viewport: cfg.viewport });
      const knoppen = page.locator('#ticket-list .btn-add');
      await expect(knoppen.first()).toBeVisible();
      const n = await knoppen.count();
      for (let i = 0; i < n; i++) {
        const b = await knoppen.nth(i).boundingBox();
        expect(Math.abs(b.width - b.height), `knop ${i}`).toBeLessThan(0.6);
        expect(b.width).toBeGreaterThanOrEqual(43.5);
      }
      await foto(page, `v213-wachtrij-${naam}`);
    });
    });
  }
});

test.describe('v2.1.3 rapport: voorbeeld en handtekening op tablet', () => {
  async function naarHandtekening(page, viewport) {
    await startApp(page, { viewport, overschrijf: seed() });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await page.locator('.day-col[data-date="2026-10-07"]').getByRole('button', { name: 'Open ticket #1004' }).click();
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
    await page.locator('#d-btn-rapport').click();
    await expect(page.locator('#rapport-wizard')).toHaveClass(/open/);
    await page.evaluate(() => window.wizGaNaar('sig-klant'));
    await expect(page.locator('#sig-klant-canvas')).toBeVisible();
    await page.waitForFunction(() => document.getElementById('sig-klant-canvas').width > 300);
  }
  for (const [naam, viewport, minFrame, minSig] of [
    ['tablet liggend', { width: 1024, height: 768 }, 260, 280],
    ['tablet staand', { width: 768, height: 1024 }, 400, 280],
  ]) {
    test.describe(naam, () => {
      test.use({ ...TABLET, viewport });
      test(`voorbeeld en handtekening zijn groot, en een streek landt op de juiste plek (${naam})`, async ({ page }) => {
        await naarHandtekening(page, viewport);
        await foto(page, naam === 'tablet liggend' ? 'v213-rapport-tablet' : 'v213-rapport-tablet-staand');
        const frame = await page.locator('#rapport-preview-frame').boundingBox();
        const sig = await page.locator('#sig-klant-wrap').boundingBox();
        expect(frame.height).toBeGreaterThanOrEqual(minFrame - 1); // marge voor afronding (259.99998 bij 260)
        expect(sig.height).toBeGreaterThanOrEqual(minSig - 1);
        expect(sig.width).toBeGreaterThanOrEqual(viewport.width - 60);
        const px = await page.locator('#sig-klant-canvas').evaluate((c) => ({ b: c.width, cb: c.clientWidth }));
        expect(px.b).toBeGreaterThanOrEqual(px.cb * 2 - 2); // dpr 2
        // Een streek: het donkere pixel staat op de overeenkomstige plek van het tekenvlak.
        const x = sig.x + sig.width * 0.5, y = sig.y + sig.height * 0.5;
        await page.mouse.move(x - 40, y); await page.mouse.down(); await page.mouse.move(x, y + 10, { steps: 6 }); await page.mouse.move(x + 40, y, { steps: 6 }); await page.mouse.up();
        const donker = await page.locator('#sig-klant-canvas').evaluate((c, [fx, fy]) => {
          const k = c.width / c.clientWidth; const d = c.getContext('2d').getImageData(Math.round((fx - 4) * k), Math.round((fy - 4) * k), Math.round(8 * k), Math.round(14 * k)).data;
          let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 120) n++; return n;
        }, [sig.width * 0.5, sig.height * 0.5 + 5]);
        expect(donker).toBeGreaterThan(0);
      });
    });
  }
});
