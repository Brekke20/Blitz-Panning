import { test, expect, startApp } from './helpers.mjs';

// Feestelijke versiering (Halloween, v2.1.0): decoratielaag #event-laag, de schakelaar in "Dit toestel" en de uitzonderingen.
// In ?test staat de versiering uit; deze specs dwingen ze af met ?test&versiering=aan (die vlag telt enkel in testmodus).
// Testklok: maandag 5 okt 2026 (binnen het Halloween-venster); "buiten het venster" gebruikt 15 sept.
const AAN = '?test&versiering=aan';
const laag = (page) => page.locator('#event-laag');

async function openToestel(page) {
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '⚙️ Instellingen' });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Dit toestel', exact: true }).click();
  await expect(modal.locator('#set-tab-toestel')).toBeVisible();
  return modal;
}

test.describe('versiering op de computer', () => {
  test('met het thema aan bestaat de laag: aria-hidden, niet klikbaar, geen focus, en klikken gaan er dwars door', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(laag(page)).toHaveCount(1);
    await expect(laag(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-event', 'halloween');
    await expect(laag(page)).toHaveCSS('pointer-events', 'none');
    expect(await laag(page).locator('a, button, input, [tabindex]').count()).toBe(0);
    // Bewegende delen op de computer: hoogstens 3 spinnen
    await expect(laag(page).locator('.ev-spin')).toHaveCount(3);
    // Het midden van een knop onder de laag: het element op die plek is de knop zelf, en de klik werkt
    const doel = page.locator('#tab-kalender');
    const box = await doel.boundingBox();
    const bovenaan = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#event-laag') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(bovenaan).toBe(false);
    await doel.click();
    await expect(doel).toHaveAttribute('aria-selected', 'true');
    // Ook onder de webhoeken is niets van de laag te raken
    const wortel = await page.evaluate(() => {
      const r = document.querySelector('#event-laag .ev-web-tl').getBoundingClientRect();
      return document.elementFromPoint(r.left + 10, r.top + 10)?.closest('#event-laag') !== null;
    });
    expect(wortel).toBe(false);
  });

  test('v2.1.1: de webben en spinnen beginnen onder de vaste balk van elk tabblad, niet erachter', async ({ page }) => {
    await startApp(page, { query: AAN });
    const check = async (balk) => {
      await expect.poll(async () => page.evaluate((sel) => {
        const b = document.querySelector(sel).getBoundingClientRect().bottom;
        const web = document.querySelector('#event-laag .ev-web-tl').getBoundingClientRect().top;
        const hang = document.querySelector('#event-laag .ev-hang')?.getBoundingClientRect().top ?? b;
        return web >= b - 1 && hang >= b - 40; // de hangende spin zakt op en neer (tot 36 px omhoog)
      }, balk)).toBe(true);
    };
    await check('#view-tickets .lijst-balk');
    await page.locator('#tab-planning').click();
    await check('#view-planning .route-balk');
  });

  test('v2.1.2: in de kalender begint de versiering onder de werkbalk, niet onder de hoge dagkoppen (midden in het rooster)', async ({ page }) => {
    await startApp(page, { query: AAN });
    await page.locator('#tab-kalender').click();
    await expect.poll(() => page.evaluate(() => {
      const balk = document.querySelector('#view-kalender .kal-header').getBoundingClientRect().bottom;
      const web = document.querySelector('#event-laag .ev-web-tl').getBoundingClientRect().top;
      return Math.abs(web - balk) <= 2;
    })).toBe(true);
  });

  test('v2.1.2: de vleermuis vliegt telkens een andere golvende baan en vlucht weg van de muis', async ({ page }) => {
    await startApp(page, { query: AAN });
    const vl = page.locator('#ev-vleermuis');
    await expect(vl).toHaveCount(1);
    const pos = () => vl.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, o: Number(getComputedStyle(el).opacity) }; });
    // De eerste vlucht start na 4 tot 12 s: stap tot ze in beeld is (en niet al voorbij)
    for (let i = 0; i < 60 && !((await pos()).o > 0 && (await pos()).x > 50); i++) await page.clock.runFor(250);
    expect((await pos()).o).toBeGreaterThan(0);
    const ys = [];
    for (let i = 0; i < 6; i++) { await page.clock.runFor(300); ys.push((await pos()).y); }
    expect(new Set(ys.map(Math.round)).size).toBeGreaterThan(2); // geen rechte lijn
    // Muis vlak bij de vleermuis: ze wijkt uit (de afstand groeit)
    const p = await pos();
    await page.mouse.move(p.x + 17, p.y + 30);
    const d0 = Math.hypot(p.x + 17 - (p.x + 17), p.y + 11 - (p.y + 30));
    await page.clock.runFor(400);
    const q = await pos();
    expect(Math.hypot(q.x + 17 - (p.x + 17), q.y + 11 - (p.y + 30))).toBeGreaterThan(d0);
  });

  test('v2.1.2: een verlopen ticketkaart is ondoorzichtig, zodat de achtergrondscène er niet door schijnt', async ({ page }) => {
    await startApp(page, { query: AAN });
    const kaart = page.locator('.ticket.overdue').first();
    await expect(kaart).toBeVisible();
    const kleur = await kaart.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(kleur.startsWith('rgba') ? Number(kleur.split(',')[3].replace(')', '')) : 1).toBe(1);
  });

  test('de laag staat onder vensters, is verborgen in print en raakt de rapportvoorbeeld-iframe niet', async ({ page }) => {
    await startApp(page, { query: AAN });
    // Boven de inhoud, onder de topbalk en onder elke sticky balk (z 20 tot 30), en onder vensters
    const z = await laag(page).evaluate(el => Number(getComputedStyle(el).zIndex));
    const topbar = await page.locator('.topbar-sticky').evaluate(el => Number(getComputedStyle(el).zIndex));
    expect(z).toBeGreaterThan(5);
    expect(z).toBeLessThan(20);
    expect(z).toBeLessThan(topbar);
    await page.emulateMedia({ media: 'print' });
    await expect(laag(page)).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(laag(page)).toBeAttached();
    // Geen decoratie in een iframe-document (de rapportvoorbeeld-iframe laadt geen app-CSS of -script)
    expect(await page.evaluate(() => [...document.querySelectorAll('iframe')].filter(f => f.contentDocument?.getElementById('event-laag')).length)).toBe(0);
  });

  test('het pompoenaccent staat op het scherm en de laag werkt ook in licht thema', async ({ page }) => {
    await startApp(page, { query: AAN });
    const donker = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(donker).toBe('#f97316');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(laag(page)).toBeAttached();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#event-laag')).getPropertyValue('--ev-spin').trim())).toBe('#2b2b2b');
  });

  test('de schakelaar in Dit toestel zet de versiering uit en de keuze blijft na herladen', async ({ page }) => {
    await startApp(page, { query: AAN });
    const modal = await openToestel(page);
    const vink = modal.getByLabel('Versiering tonen tijdens feestperiodes');
    await expect(vink).toBeChecked();
    await expect(modal.locator('#set-versiering-uitleg')).toContainText('Halloween');
    await vink.uncheck();
    await expect(laag(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
    expect(await page.evaluate(() => localStorage.getItem('blitz_versiering'))).toBe('uit');
    await page.reload();
    await expect(page.locator('#cnt-tickets')).toBeVisible();
    await expect(laag(page)).toHaveCount(0);
    const modal2 = await openToestel(page);
    await expect(modal2.getByLabel('Versiering tonen tijdens feestperiodes')).not.toBeChecked();
    await modal2.getByLabel('Versiering tonen tijdens feestperiodes').check();
    await expect(laag(page)).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem('blitz_versiering'))).toBeNull();
    // De lege-tekst volgt het thema meteen (geen nieuwe render door de gebruiker nodig)
    await expect(page.locator('html')).toHaveAttribute('data-event', 'halloween');
  });

  test('met prefers-reduced-motion bestaan er geen bewegende delen', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startApp(page, { query: AAN });
    await expect(laag(page)).toHaveCount(1);
    await expect(laag(page).locator('.ev-web')).toHaveCount(4);
    await expect(laag(page).locator('.ev-beweeg')).toHaveCount(0);
  });

  test('een verborgen tab pauzeert de animaties', async ({ page }) => {
    await startApp(page, { query: AAN });
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(laag(page)).toHaveClass(/ev-gepauzeerd/);
    await expect(laag(page).locator('.ev-hang').first()).toHaveCSS('animation-play-state', 'paused');
  });
});

test.describe('geen versiering', () => {
  test('na middernacht op 31 oktober verdwijnt de versiering vanzelf (minuutcontrole)', async ({ page }) => {
    await startApp(page, { query: AAN, nu: '2026-10-31T23:58:30+01:00' });
    await expect(laag(page)).toHaveCount(1);
    await page.clock.fastForward(60000); // 23:59:30: nog binnen het venster
    await expect(laag(page)).toHaveCount(1);
    await page.clock.fastForward(90000); // 00:01:00 op 1 november (springt; elke timer vuurt hoogstens eenmaal)
    await expect(laag(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
  });


  test('buiten het evenementvenster (15 september) is er niets, ook met de vlag', async ({ page }) => {
    await startApp(page, { query: AAN, nu: '2026-09-15T09:00:00+02:00' });
    await expect(laag(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
  });

  test('in ?test zonder de vlag is er niets, ook midden in oktober', async ({ page }) => {
    await startApp(page);
    await expect(laag(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
    // De vlag hoort bij testmodus: een gewone querystring met enkel de vlag verandert niets aan de uitzondering ?test
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#00dfa3');
  });
});

test.describe('versiering op een telefoon (aanraak, smal)', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('enkel statische webben: geen spinnen, vleermuis of mist, en de laag blokkeert niets', async ({ page }) => {
    await startApp(page, { query: AAN, viewport: { width: 375, height: 812 } });
    await expect(laag(page)).toHaveCount(1);
    await expect(laag(page).locator('.ev-web')).toHaveCount(4);
    await expect(laag(page).locator('.ev-beweeg')).toHaveCount(0);
    await expect(laag(page).locator('.ev-spin')).toHaveCount(0);
    await expect(laag(page)).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('html')).toHaveAttribute('data-event-sober', 'ja');
    // Alle animaties in de laag: geen enkele loopt
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.closest?.('#event-laag')).length)).toBe(0);
  });
});

// v2.1.2: achtergrondscène (#event-achtergrond) en donker thema als standaard tijdens het evenement
const achter = (page) => page.locator('#event-achtergrond');
const themaVan = (page) => page.locator('html').getAttribute('data-theme');
const zetLicht = (page) => page.addInitScript(() => { if (window === window.top && localStorage.getItem('blitz_theme') === null) localStorage.setItem('blitz_theme', 'light'); });
const wissel = (page) => page.getByRole('button', { name: 'Wissel licht/donker' });

test.describe('achtergrondscène en thema tijdens het evenement', () => {
  test('de scène bestaat: aria-hidden, niet klikbaar, vast achter alles, één inline SVG zonder netwerk', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(achter(page)).toHaveCount(1);
    await expect(achter(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(achter(page)).toHaveCSS('pointer-events', 'none');
    await expect(achter(page)).toHaveCSS('position', 'fixed');
    await expect(achter(page)).toHaveCSS('z-index', '-1');
    await expect(achter(page).locator('svg')).toHaveCount(1);
    expect(await achter(page).locator('image, [src]').count()).toBe(0);
    // De body is doorzichtig zodat de scène zichtbaar is
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await achter(page).locator('use').count()).toBeGreaterThanOrEqual(2); // vogelverschrikkers
  });

  test('de scène ligt achter de inhoud: een kaart is het element op zijn plek', async ({ page }) => {
    await startApp(page, { query: AAN });
    const kaart = page.locator('#view-tickets .ticket').first();
    await expect(kaart).toBeVisible();
    const box = await kaart.boundingBox();
    const geraakt = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return { inScene: !!el?.closest('#event-achtergrond'), inKaart: !!el?.closest('.ticket') }; }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(geraakt).toEqual({ inScene: false, inKaart: true });
    expect(await kaart.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('in print is de scène verborgen', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(achter(page)).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(achter(page)).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(achter(page)).toBeVisible();
  });

  test('met de schakelaar uit is de scène weg en is de body weer gewoon gevuld', async ({ page }) => {
    await startApp(page, { query: AAN });
    const modal = await openToestel(page);
    await modal.getByLabel('Versiering tonen tijdens feestperiodes').uncheck();
    await expect(achter(page)).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('na het einde van het evenement verdwijnt de scène (minuutcontrole)', async ({ page }) => {
    await startApp(page, { query: AAN, nu: '2026-10-31T23:58:30+01:00' });
    await expect(achter(page)).toHaveCount(1);
    await page.clock.fastForward(150000);
    await expect(achter(page)).toHaveCount(0);
  });

  test('een toestel dat licht bewaard heeft, ziet tijdens het evenement donker, en blitz_theme blijft onaangeroerd', async ({ page }) => {
    await zetLicht(page);
    await startApp(page, { query: AAN });
    expect(await themaVan(page)).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('blitz_theme'))).toBe('light');
  });

  test('wisselen tijdens het evenement bewaart in blitz_theme_halloween_<jaar>, niet in blitz_theme; blijft na herladen', async ({ page }) => {
    await zetLicht(page);
    await startApp(page, { query: AAN });
    await wissel(page).click();
    expect(await themaVan(page)).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('blitz_theme_halloween_2026'))).toBe('light');
    await page.reload();
    await expect(page.locator('#cnt-tickets')).toBeVisible();
    expect(await themaVan(page)).toBe('light');
    await wissel(page).click();
    expect(await themaVan(page)).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('blitz_theme_halloween_2026'))).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('blitz_theme'))).toBe('light');
  });

  test('een donker toestel dat tijdens het evenement licht kiest, wijzigt blitz_theme niet', async ({ page }) => {
    await startApp(page, { query: AAN });
    await wissel(page).click();
    expect(await themaVan(page)).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('blitz_theme'))).toBe('dark');
  });

  test('met de versiering uit geldt het eigen opgeslagen (lichte) thema weer', async ({ page }) => {
    await zetLicht(page);
    await startApp(page, { query: AAN });
    expect(await themaVan(page)).toBe('dark');
    const modal = await openToestel(page);
    await modal.getByLabel('Versiering tonen tijdens feestperiodes').uncheck();
    await expect.poll(() => themaVan(page)).toBe('light');
    await modal.getByLabel('Versiering tonen tijdens feestperiodes').check();
    await expect.poll(() => themaVan(page)).toBe('dark');
  });

  test('buiten het evenement geldt het opgeslagen lichte thema, ook met de vlag', async ({ page }) => {
    await zetLicht(page);
    await startApp(page, { query: AAN, nu: '2026-09-15T09:00:00+02:00' });
    expect(await themaVan(page)).toBe('light');
    await expect(achter(page)).toHaveCount(0);
  });

  test('in ?test zonder de vlag geldt het opgeslagen lichte thema, ook in oktober', async ({ page }) => {
    await zetLicht(page);
    await startApp(page);
    expect(await themaVan(page)).toBe('light');
  });
});

test.describe('achtergrondscène op een telefoon', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test('de scène staat er ook, toont het rechterdeel en blokkeert niets', async ({ page }) => {
    await startApp(page, { query: AAN, viewport: { width: 375, height: 812 } });
    await expect(achter(page)).toHaveCount(1);
    await expect(achter(page).locator('svg')).toHaveAttribute('preserveAspectRatio', 'xMaxYMax slice');
    await expect(achter(page)).toHaveCSS('pointer-events', 'none');
  });
});
