import { test, expect, startApp } from './helpers.mjs';

// Feestelijke versiering (Halloween, v2.1.0): decoratielagen, de schakelaar in "Dit toestel" en de uitzonderingen.
// In ?test staat de versiering uit; deze specs dwingen ze af met ?test&versiering=aan (die vlag telt enkel in testmodus).
// Testklok: maandag 5 okt 2026 (binnen het Halloween-venster); "buiten het venster" gebruikt 15 sept.
// Sinds taak 6 (thema's als pakket) komt Halloween uit het themapakket (stub /api/themas in helpers.mjs, hetzelfde bestand dat de
// server zaait). Dezelfde verwachtingen als v2.2.0, met de nieuwe generieke namen: de webben zijn `.ev-hoek` (lb/rb/lo/ro), de spinnen
// `.ev-beeld-spin`, de vleermuis `.ev-vlieg`. Besluit Brent (2026-10-22): stilstaande delen (hoek, hangen, mist) staan in
// #event-achter-laag ACHTER de inhoud, bewegende (kruipen, vliegen, vallen, opstijgen, vuurwerk) in #event-laag ervoor.
// Het thema verschijnt pas na het antwoord van /api/themas (de cache is in een verse test leeg): waar v2.2.0 meteen las, wacht de
// test nu met expect.poll.
const AAN = '?test&versiering=aan';
const laag = (page) => page.locator('#event-laag');
const achterLaag = (page) => page.locator('#event-achter-laag');
const beide = (page, sel) => page.locator(`#event-laag ${sel}, #event-achter-laag ${sel}`);

// Ligt `deco` voor of achter het element `doel`? De lagen zijn nooit klikbaar (pointer-events: none), dus maakt de test één decoratie
// tijdelijk raakbaar, legt ze over het midden van het doel en vraagt de browser wat er op die plek bovenaan ligt.
async function bovenaanOpDoel(page, decoSel, doelSel) {
  return page.evaluate(({ decoSel, doelSel }) => {
    const deco = document.querySelector(decoSel);
    const doel = document.querySelector(doelSel);
    const r = doel.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const laagEl = deco.closest('#event-laag, #event-achter-laag');
    const oud = { laag: laagEl.getAttribute('style'), deco: deco.getAttribute('style') };
    laagEl.style.setProperty('pointer-events', 'auto', 'important');
    deco.style.setProperty('pointer-events', 'auto', 'important');
    deco.style.setProperty('position', 'fixed', 'important');
    deco.style.setProperty('left', (x - 30) + 'px', 'important');
    deco.style.setProperty('top', (y - 30) + 'px', 'important');
    deco.style.setProperty('right', 'auto', 'important');
    deco.style.setProperty('bottom', 'auto', 'important');
    deco.style.setProperty('width', '60px', 'important');
    deco.style.setProperty('height', '60px', 'important');
    deco.style.setProperty('transform', 'none', 'important');
    deco.style.setProperty('opacity', '1', 'important');
    deco.style.setProperty('animation', 'none', 'important');
    const geraakt = document.elementFromPoint(x, y);
    const uit = geraakt?.closest('#event-laag, #event-achter-laag') ? 'deco' : (doel.contains(geraakt) ? 'doel' : 'iets anders');
    laagEl.setAttribute('style', oud.laag ?? ''); deco.setAttribute('style', oud.deco ?? '');
    return uit;
  }, { decoSel, doelSel });
}

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
    await expect(achterLaag(page)).toHaveCount(1);
    for (const l of [laag(page), achterLaag(page)]) {
      await expect(l).toHaveAttribute('aria-hidden', 'true');
      await expect(l).toHaveCSS('pointer-events', 'none');
      expect(await l.locator('a, button, input, [tabindex]').count()).toBe(0);
    }
    await expect(page.locator('html')).toHaveAttribute('data-event', 'halloween');
    // Bewegende delen op de computer: hoogstens 3 spinnen (2 hangend achter de inhoud, 1 kruipend ervoor)
    await expect(beide(page, '.ev-beeld-spin')).toHaveCount(3);
    await expect(achterLaag(page).locator('.ev-hang .ev-beeld-spin')).toHaveCount(2);
    await expect(laag(page).locator('.ev-kruip.ev-beeld-spin')).toHaveCount(1);
    // Het midden van een knop onder de laag: het element op die plek is de knop zelf, en de klik werkt
    const doel = page.locator('#tab-kalender');
    const box = await doel.boundingBox();
    const bovenaan = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#event-laag') !== null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(bovenaan).toBe(false);
    await doel.click();
    await expect(doel).toHaveAttribute('aria-selected', 'true');
    // Ook onder de webhoeken is niets van de laag te raken
    const wortel = await page.evaluate(() => {
      const r = document.querySelector('#event-achter-laag .ev-hoek-lb').getBoundingClientRect();
      return document.elementFromPoint(r.left + 10, r.top + 10)?.closest('#event-laag, #event-achter-laag') !== null;
    });
    expect(wortel).toBe(false);
  });

  test('v2.1.1: de webben en spinnen beginnen onder de vaste balk van elk tabblad, niet erachter', async ({ page }) => {
    await startApp(page, { query: AAN });
    const check = async (balk) => {
      await expect.poll(async () => page.evaluate((sel) => {
        const b = document.querySelector(sel).getBoundingClientRect().bottom;
        const web = document.querySelector('#event-achter-laag .ev-hoek-lb').getBoundingClientRect().top;
        const hang = document.querySelector('#event-achter-laag .ev-hang')?.getBoundingClientRect().top ?? b;
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
      const web = document.querySelector('#event-achter-laag .ev-hoek-lb').getBoundingClientRect().top;
      return Math.abs(web - balk) <= 2;
    })).toBe(true);
  });

  test('v2.1.2: de vleermuis vliegt telkens een andere golvende baan en vlucht weg van de muis', async ({ page }) => {
    await startApp(page, { query: AAN });
    const vl = page.locator('#event-laag .ev-vlieg');
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

  test('stilstaande versiering ligt achter de knoppen, bewegende ervoor (besluit Brent 2026-10-22)', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(achterLaag(page).locator('.ev-hoek')).toHaveCount(4);
    // de lagen per beweging: hoek, hangen en mist achter; kruipen en vliegen ervoor
    expect(await achterLaag(page).locator('.ev-hoek, .ev-hang, .ev-mist').count()).toBe(7);
    expect(await achterLaag(page).locator('.ev-kruip, .ev-vlieg, .ev-val, .ev-stijg, .ev-pluim').count()).toBe(0);
    expect(await laag(page).locator('.ev-kruip, .ev-vlieg').count()).toBe(2);
    expect(await laag(page).locator('.ev-hoek, .ev-hang, .ev-mist').count()).toBe(0);
    const knop = '#view-tickets .ticket .btn-add';
    await expect(page.locator(knop).first()).toBeVisible();
    // Een web en een hangende spin, over de "+"-knop van het eerste ticket gelegd: de knop ligt bovenaan
    expect(await bovenaanOpDoel(page, '#event-achter-laag .ev-hoek-lb', knop)).toBe('doel');
    expect(await bovenaanOpDoel(page, '#event-achter-laag .ev-hang', knop)).toBe('doel');
    // Ook boven "Plan deze week" in de kalender
    await page.locator('#tab-kalender').click();
    const plan = page.getByRole('button', { name: /Plan deze week/ });
    await expect(plan).toBeVisible();
    await plan.evaluate((el) => el.setAttribute('data-e2e-doel', '1'));
    expect(await bovenaanOpDoel(page, '#event-achter-laag .ev-hoek-rb', '[data-e2e-doel]')).toBe('doel');
    // Een bewegend deel ligt vóór de inhoud (en is enkel daarom nooit klikbaar: pointer-events none)
    await page.locator('#tab-tickets').click();
    expect(await bovenaanOpDoel(page, '#event-laag .ev-kruip', '#view-tickets .ticket .tsub')).toBe('deco');
  });

  test('ticketkaarten zijn mat glas en de tekst houdt een contrast van minstens 4,5:1, in donker en licht', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(page.locator('html')).toHaveAttribute('data-event-achtergrond', 'ja');
    // Geen overgangen tijdens het meten (een kaart kleurt anders 0,15 s lang van donker naar licht, in echte tijd)
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    for (const thema of ['dark', 'light']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), thema);
      for (const sel of ['#view-tickets .ticket.overdue', '#view-tickets .ticket:not(.overdue)']) {
        const kaart = page.locator(sel).first();
        await expect(kaart).toBeVisible();
        const m = await kaart.evaluate((el) => {
          // Kleur lezen als [r, g, b, a] (0-255, a 0-1) via een canvas: werkt voor rgb(), rgba() en color(srgb ...).
          const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
          const rgba = (kleur) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = kleur; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
          const cs = getComputedStyle(el);
          const root = getComputedStyle(document.documentElement);
          const teksten = ['.tnum', '.tsub', '.taddr.ok', '.tmeta'].map((t) => el.querySelector(t)).filter(Boolean).map((t) => getComputedStyle(t).color);
          return {
            achter: getComputedStyle(el).backgroundColor, kaart: rgba(cs.backgroundColor), blur: cs.backdropFilter,
            primair: rgba(root.getPropertyValue('--text').trim()), teksten: teksten.map(rgba), bg: rgba(root.getPropertyValue('--bg').trim()),
            licht: document.documentElement.getAttribute('data-theme') === 'light',
          };
        });
        // half doorschijnend (glas), met vervaging
        expect(m.kaart[3], `${thema} ${sel} ${m.achter}`).toBeGreaterThan(0.6);
        expect(m.kaart[3]).toBeLessThan(0.92);
        expect(m.blur).toContain('blur(12px)');
        // Contrast: de kaart samengesteld over wat erachter kan liggen. Donker: de paginakleur en de lichtste delen van de nachtlucht
        // en de heuvels van de scène; licht: de paginakleur en de donkerste scènekleur aan 20 % dekking. De gewone tekst moet het
        // ook over volledig wit (donker) of zwart (licht) halen.
        const meng = (boven, onder) => [0, 1, 2].map((i) => boven[i] * boven[3] + onder[i] * (1 - boven[3]));
        const lum = (c) => { const k = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
        const contrast = (a, b) => { const [h, d] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (d + 0.05); };
        const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(1);
        const achtergronden = m.licht
          ? [m.bg, meng([...hex('#07070f').slice(0, 3), 0.2], m.bg).concat(1)]
          : [m.bg, hex('#352552'), hex('#211d46')];
        for (const onder of achtergronden) {
          const vlak = meng(m.kaart, onder);
          for (const tekst of [m.primair, ...m.teksten]) expect(contrast(tekst, vlak), `${thema} ${sel}`).toBeGreaterThanOrEqual(4.5);
        }
        const uiterst = meng(m.kaart, m.licht ? [0, 0, 0] : [255, 255, 255]);
        expect(contrast(m.primair, uiterst), `${thema} ${sel} uiterst`).toBeGreaterThanOrEqual(4.5);
      }
    }
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
    await expect(achterLaag(page)).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(laag(page)).toBeAttached();
    await expect(achterLaag(page)).toBeVisible();
    // De achter-laag ligt onder de inhoud (en boven de scène, die vóór haar in de body staat)
    expect(await achterLaag(page).evaluate(el => getComputedStyle(el).zIndex)).toBe('-1');
    expect(await page.evaluate(() => {
      const a = document.getElementById('event-achtergrond'), b = document.getElementById('event-achter-laag');
      return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    // Geen decoratie in een iframe-document (de rapportvoorbeeld-iframe laadt geen app-CSS of -script)
    expect(await page.evaluate(() => [...document.querySelectorAll('iframe')].filter(f => f.contentDocument?.getElementById('event-laag')).length)).toBe(0);
  });

  test('het pompoenaccent staat op het scherm en de laag werkt ook in licht thema', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(laag(page)).toBeAttached();
    const donker = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(donker).toBe('#f97316');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(laag(page)).toBeAttached();
    // v2.2.0 las --ev-spin (#2b2b2b); nu staat de lichte kleur in het pakket (vulLicht) en kleurt ze de spin zelf
    await expect(achterLaag(page).locator('.ev-hang .ev-beeld-spin ellipse').first()).toHaveCSS('fill', 'rgb(43, 43, 43)');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())).toBe('#c2570c');
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
    await expect(achterLaag(page).locator('.ev-hoek')).toHaveCount(4);
    await expect(beide(page, '.ev-beweeg')).toHaveCount(0);
  });

  test('een verborgen tab pauzeert de animaties', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(achterLaag(page).locator('.ev-hang').first()).toBeAttached();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(laag(page)).toHaveClass(/ev-gepauzeerd/);
    await expect(achterLaag(page)).toHaveClass(/ev-gepauzeerd/);
    await expect(achterLaag(page).locator('.ev-hang').first()).toHaveCSS('animation-play-state', 'paused');
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
    await expect(achterLaag(page).locator('.ev-hoek')).toHaveCount(4);
    await expect(beide(page, '.ev-beweeg')).toHaveCount(0);
    await expect(beide(page, '.ev-beeld-spin')).toHaveCount(0);
    await expect(laag(page)).toHaveCSS('pointer-events', 'none');
    await expect(achterLaag(page)).toHaveCSS('pointer-events', 'none');
    await expect(page.locator('html')).toHaveAttribute('data-event-sober', 'ja');
    // Alle animaties in de lagen: geen enkele loopt
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.closest?.('#event-laag, #event-achter-laag')).length)).toBe(0);
    // Sober: minder vervaging achter de glazen kaarten
    await expect(page.locator('#view-tickets .ticket').first()).toHaveCSS('backdrop-filter', 'blur(6px)');
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
    // vogelverschrikkers: v2.2.0 tekende ze met <use>; het pakket schrijft ze uit als groepen (<use> en href bestaan niet meer)
    expect(await achter(page).locator('use, [href]').count()).toBe(0);
    expect(await achter(page).locator('svg > g').count()).toBeGreaterThanOrEqual(4);
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
    await expect.poll(() => themaVan(page)).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('blitz_theme'))).toBe('light');
  });

  test('wisselen tijdens het evenement bewaart in blitz_theme_halloween_<jaar>, niet in blitz_theme; blijft na herladen', async ({ page }) => {
    await zetLicht(page);
    await startApp(page, { query: AAN });
    await expect.poll(() => themaVan(page)).toBe('dark');
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
    await expect(laag(page)).toHaveCount(1);
    await wissel(page).click();
    expect(await themaVan(page)).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('blitz_theme'))).toBe('dark');
  });

  test('met de versiering uit geldt het eigen opgeslagen (lichte) thema weer', async ({ page }) => {
    await zetLicht(page);
    await startApp(page, { query: AAN });
    await expect.poll(() => themaVan(page)).toBe('dark');
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

// Taak 6: de eerste schermopbouw kent het thema al uit het kleine record blitz_thema_actief (bijgehouden door schermen/themas-bron.js),
// nog vóór de modules en vóór /api/themas antwoordt (hier antwoordt het nooit). De test leest <html> op het moment dat de parser bij
// het eerste stijlblad komt: de inline scripts erboven hebben dan gelopen, de modules nog niet. Een kapot record breekt niets.
test.describe('eerste schermopbouw uit blitz_thema_actief', () => {
  const RECORD = {
    id: 'halloween', tot: '2026-10-31', voorkeurThema: 'donker',
    kleuren: { donker: { accent: '#f97316', accentHover: '#fb8a3c' }, licht: { accent: '#c2570c', accentHover: '#fb8a3c' } },
  };
  async function eersteStaat(page, record) {
    await page.addInitScript((w) => {
      if (window !== window.top) return;
      localStorage.setItem('blitz_thema_actief', w);
      new MutationObserver((_, o) => {
        if (window.__naInline || !document.querySelector('link[href="/css/base.css"]')) return;
        const h = document.documentElement;
        window.__naInline = {
          event: h.getAttribute('data-event'), theme: h.getAttribute('data-theme'), kleuren: h.getAttribute('data-ev-kleuren'),
          accent: h.style.getPropertyValue('--ev-accent'), modules: !!window.kern,
        };
        o.disconnect();
      }).observe(document, { childList: true, subtree: true });
    }, record);
    let gevraagd = 0;
    await startApp(page, { query: AAN, overschrijf: { themas: () => { gevraagd += 1; return { hangen: true }; } } });
    expect(gevraagd).toBeGreaterThan(0); // de lading loopt, maar antwoordt nooit
    return page.evaluate(() => window.__naInline);
  }

  test('data-event, accentkleur en donker thema staan er vóór de modules en vóór /api/themas', async ({ page }) => {
    await zetLicht(page);
    expect(await eersteStaat(page, JSON.stringify(RECORD))).toEqual({
      event: 'halloween', theme: 'dark', kleuren: 'accent accentHover', accent: '#f97316', modules: false,
    });
  });

  for (const [naam, waarde] of [
    ['kapotte JSON', '{kapot'],
    ['verlopen record', JSON.stringify({ ...RECORD, tot: '2026-09-30' })],
    ['vreemde id', JSON.stringify({ ...RECORD, id: '<script>' })],
  ]) {
    test(`een ${naam} doet niets en breekt de start niet`, async ({ page }) => {
      expect(await eersteStaat(page, waarde)).toEqual({ event: null, theme: 'dark', kleuren: null, accent: '', modules: false });
    });
  }

  test('een record met een ongeldige kleur zet die kleur niet', async ({ page }) => {
    const r = { ...RECORD, kleuren: { donker: { accent: 'red;background:url(x)', accentHover: '#fb8a3c' } } };
    expect(await eersteStaat(page, JSON.stringify(r))).toEqual({ event: 'halloween', theme: 'dark', kleuren: 'accentHover', accent: '', modules: false });
  });
});
