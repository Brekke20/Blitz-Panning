import fs from 'node:fs';
import zlib from 'node:zlib';
import { test, expect, startApp } from './helpers.mjs';
import { startSalesApp } from './sales-hulp.mjs';

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

  test('glas is algemeen: glasrand en lichtrand uit de tokens, een verlopen ticket gloeit rood, geen tekstschaduw en geen linkerbalk meer', async ({ page }) => {
    // Open dag (v2.5.0): glas is algemeen, waarden uit base.css (was: themaglas variant B met een eigen rand, lichtrand en tekstschaduw)
    await startApp(page, { query: AAN });
    await expect(page.locator('html')).toHaveAttribute('data-event-achtergrond', 'ja');
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    // Een gewone rij zonder urgentie toont de glasrand zelf; het verlopen ticket de gloed
    await page.evaluate(() => { const n = document.createElement('div'); n.className = 'inv-row'; n.id = 'proef-rij'; n.textContent = 'gewoon'; document.getElementById('view-inventaris').appendChild(n); });
    const lees = () => page.evaluate(() => {
      const kaart = document.querySelector('#view-tickets .ticket.overdue');
      const cs = getComputedStyle(kaart);
      const gewoon = getComputedStyle(document.getElementById('proef-rij'));
      return { gloedRand: cs.borderTopColor, breedte: cs.borderTopWidth, tekst: cs.textShadow, balk: getComputedStyle(kaart, '::before').content, rand: gewoon.borderTopColor, randLinks: gewoon.borderLeftColor, lichtrand: gewoon.boxShadow };
    });
    const donker = await lees();
    expect(donker.rand).toBe('rgba(255, 255, 255, 0.14)'); // --glas-rand (donker)
    expect(donker.randLinks).toBe('rgba(255, 255, 255, 0.14)');
    expect(donker.breedte).toBe('1px');
    expect(donker.lichtrand).toContain('rgba(255, 255, 255, 0.16) 0px 1px 0px 0px inset'); // --glas-licht (donker)
    expect(donker.gloedRand).toMatch(/^color\(srgb 1 0\.35\d* 0\.32\d* \/ 0\.55\)$/); // --red aan 55 %: de gloed langs de omtrek
    expect(donker.tekst).toBe('none');
    expect(donker.balk).toBe('none');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    const licht = await lees();
    expect(licht.rand).toBe('rgba(255, 255, 255, 0.85)'); // --glas-rand (licht)
    expect(licht.lichtrand).toContain('rgba(255, 255, 255, 0.95) 0px 1px 0px 0px inset');
    // Zonder thema met achtergrond precies hetzelfde glas (het is niet meer themaspecifiek)
    await page.evaluate(() => document.documentElement.removeAttribute('data-event-achtergrond'));
    expect(await lees()).toEqual(licht);
  });

  test('statuskleuren blijven tijdens een thema: de gloed van een verlopen ticket en de labels "Verlopen" en "Hoog" houden de gewone --red, in donker en licht', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(page.locator('html')).toHaveAttribute('data-event-achtergrond', 'ja');
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    const verlopen = page.locator('#view-tickets .ticket.overdue').first();
    await expect(verlopen).toBeVisible();
    await expect(page.locator('#view-tickets .prtag.high').first()).toBeVisible();
    const lees = () => page.evaluate(() => {
      const kaart = document.querySelector('#view-tickets .ticket.overdue');
      const stag = kaart.querySelector('.stag:not(.pending):not(.confirmed)');
      const hoog = document.querySelector('#view-tickets .prtag.high');
      const kleur = (el, pseudo) => getComputedStyle(el, pseudo).color;
      // Open dag (v2.5.0): de rode balk is een gloed geworden; --gloed-kleur van de kaart is de gewone --red
      return { gloed: getComputedStyle(kaart).getPropertyValue('--gloed-kleur').trim(), verlopen: kleur(stag), hoog: kleur(hoog) };
    });
    for (const [thema, rood, hex] of [['dark', 'rgb(255, 90, 82)', '#ff5a52'], ['light', 'rgb(200, 30, 30)', '#c81e1e']]) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), thema);
      const metThema = await lees();
      expect(metThema, `${thema}: gewone --red`).toEqual({ gloed: hex, verlopen: rood, hoog: rood });
      // Zonder het thema met achtergrond precies dezelfde kleuren
      await page.evaluate(() => document.documentElement.removeAttribute('data-event-achtergrond'));
      expect(await lees(), `${thema}: zelfde kleuren zonder thema`).toEqual(metThema);
      await page.evaluate(() => document.documentElement.setAttribute('data-event-achtergrond', 'ja'));
    }
  });

  test('toestandskleuren blijven onder het glas: lage voorraad en vandaag in de maandweergave', async ({ page }) => {
    await startApp(page, { query: AAN });
    await expect(page.locator('html')).toHaveAttribute('data-event-achtergrond', 'ja');
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
    // Lage voorraad: een rij met .inv-low (de echte rijen vragen een voorraad; hier een rij met dezelfde klassen in de lijst)
    const rij = await page.evaluate(() => {
      const r = document.createElement('div'); r.className = 'inv-row inv-low'; r.textContent = 'proef';
      document.getElementById('view-inventaris').appendChild(r);
      const n = document.createElement('div'); n.className = 'inv-row'; n.textContent = 'gewoon';
      document.getElementById('view-inventaris').appendChild(n);
      const cs = (el) => getComputedStyle(el);
      return { laag: cs(r).backgroundImage, gewoon: cs(n).backgroundImage, blur: cs(r).backdropFilter, randLaag: cs(r).borderTopColor, randGewoon: cs(n).borderTopColor };
    });
    // Open dag (v2.5.0): lage voorraad gloeit rood (een tint van --red linksboven en een rode rand aan 55 %); een gewone rij blijft glas
    expect(rij.laag).toMatch(/^linear-gradient\(135deg, color\(srgb 1 0\.35\d* 0\.32\d* \/ 0\.1\)/);
    expect(rij.gewoon).toBe('none');
    expect(rij.blur).toContain('blur(');
    // De glasrand wint niet van de rode rand van lage voorraad
    expect(rij.randGewoon).toBe('rgba(255, 255, 255, 0.14)');
    expect(rij.randLaag).toMatch(/^color\(srgb 1 0\.35\d* 0\.32\d* \/ 0\.55\)$/);
    // Vandaag in de maandweergave behoudt zijn tint; de andere maand blijft gedimd
    await page.locator('#tab-kalender').click();
    await page.getByRole('button', { name: 'Maand', exact: true }).click();
    const vandaag = page.locator('.month-cell.today-cell');
    await expect(vandaag).toHaveCount(1);
    expect(await vandaag.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 223, 163, 0.04)');
    expect(await page.locator('.month-cell:not(.today-cell):not(.other-month)').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const ander = page.locator('.month-cell.other-month').first();
    if (await ander.count()) expect(await ander.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
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

// Glas en contrast, voor ELK voorgeladen thema (taak 9d, keuze opdrachtgever 2026-10-23: variant B, helder glas: 60 % kaartkleur,
// 6 px vervaging). ELKE tekstkleur op een kaart (gewone en secundaire tekst, de rode "Geen adres bekend", de tijd en de naam op een
// kalenderkaart) haalt 4,5:1 over wat ECHT achter het glas ligt. Zo gemeten (beslissingen controller 2026-10-23; de vroegere
// formule "kaart over de lichtste kleur van de hele scène" faalt bij 60 % op de maan of de zon, ook waar er nooit een kaart ligt):
//   1. de kaarten en de voorste laag (#event-laag, die ligt VOOR de kaarten) worden verborgen (visibility: hidden, de opmaak blijft)
//      en de pagina wordt gefotografeerd: wat overblijft is precies de achtergrond achter elke kaart (scène, achterste laag,
//      paginakleur en tinten van de dagvakken);
//   2. per kaart het gemiddelde van die foto in het kaartvlak (de vervaging middelt), met de kaartkleur aan de glas-alpha erover;
//   3. per kaart de helderste EN de donkerste 6x6-blok ERGENS in het kaartvak, na een vervaging zoals blur(6px) (gaussisch,
//      sigma 6 px, in sRGB), met de kaartkleur erover: niet enkel onder de tekst van vandaag, want een afspraak op een ander uur of
//      een lange titel kan tekst op elke plek van de kaart leggen (Halloween: een kalenderkaart op 1024 breed ligt deels over de maan).
// Elke tekstkleur moet 4,5:1 halen tegen alle drie. Chips met een eigen achtergrond (labels) tellen niet mee: hun tekst staat op hun
// eigen vlak. De tekstschaduw telt niet mee (extra marge). Gemeten op de ticketkaarten (wachtrij) en de kalenderkaarten
// (.cal-ticket, weekweergave), in donker en licht, op 1366x768, 1024x768, 375x812 en 768x1024, en voor elke kaart ook met de
// muis erboven (hover-kaartkleur). Het pakket komt uit netlify/themas met een periode over
// de testklok (5 okt 2026). Faalt een thema: de tekstkleuren op de kaarten aanpassen (de scène blijft), nooit de drempel of een
// alpha per thema.
const PAKKET_IDS = ['halloween', 'kerst', 'nieuwjaar', 'valentijn', 'carnaval', 'pasen', 'zomer', 'nationale-feestdag', 'sinterklaas'];
// liggend (computer, tablet) en staand (gsm, tablet): staand snijdt de scène tot kijkvensterStaand, waar de maan achter de kaarten valt
const VENSTERS = [{ width: 1366, height: 768 }, { width: 1024, height: 768 }, { width: 375, height: 812 }, { width: 768, height: 1024 }];
const leesPakket = (id) => JSON.parse(fs.readFileSync(new URL(`../netlify/themas/${id}.blitzthema.json`, import.meta.url), 'utf8'));
function themaStub(p) {
  const periodeOverride = { van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 } };
  return ({ query }) => {
    if (query.get('id') !== null) return { status: 200, json: structuredClone(p) };
    return {
      status: 200,
      json: { versie: 1, themas: [{ id: p.id, naam: p.naam, aan: true, periode: p.periode, periodeOverride, pakketHash: `e2e-${p.id}` }], pakketten: { [p.id]: structuredClone(p) } },
    };
  };
}

// PNG lezen zoals Chromium het aflevert (8 bit, RGB of RGBA, zonder interlace), met node:zlib: geen extra pakket nodig.
function leesPng(buf) {
  let p = 8, breed = 0, hoog = 0, kleurType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      breed = data.readUInt32BE(0); hoog = data.readUInt32BE(4); kleurType = data[9];
      if (data[8] !== 8 || data[12] !== 0 || (kleurType !== 2 && kleurType !== 6)) throw new Error(`PNG-vorm niet ondersteund (diepte ${data[8]}, type ${kleurType}, interlace ${data[12]})`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = kleurType === 6 ? 4 : 3, rij = breed * bpp, ruw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(hoog * rij);
  for (let y = 0; y < hoog; y++) {
    const f = ruw[y * (rij + 1)], bron = y * (rij + 1) + 1, doel = y * rij;
    for (let x = 0; x < rij; x++) {
      const a = x >= bpp ? px[doel + x - bpp] : 0, b = y > 0 ? px[doel - rij + x] : 0, c = x >= bpp && y > 0 ? px[doel - rij + x - bpp] : 0;
      let v = ruw[bron + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : (pb <= pc ? b : c); }
      px[doel + x] = v & 255;
    }
  }
  return { breed, hoog, kleur: (x, y) => { const i = (y * breed + x) * bpp; return [px[i], px[i + 1], px[i + 2]]; } };
}

// Vervaging zoals backdrop-filter: blur(6px) (gaussisch, sigma 6 px, straal 3 sigma) van een uitsnede plus 18 px rand; buiten de
// foto telt de dichtstbijzijnde pixel. Geeft een lezer (x, y) -> [r, g, b] op paginacoördinaten binnen de uitsnede.
function vervaag(beeld, vak, sigma = 6) {
  const s = Math.ceil(3 * sigma), kern = [];
  for (let i = -s; i <= s; i++) kern.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const som = kern.reduce((a, b) => a + b);
  const klem = (v, max) => Math.min(max - 1, Math.max(0, v));
  const x0 = Math.floor(vak.x) - s, y0 = Math.floor(vak.y) - s, b = Math.ceil(vak.w) + 2 * s, h = Math.ceil(vak.h) + 2 * s;
  const bron = new Float32Array(b * h * 3), hor = new Float32Array(b * h * 3), uit = new Float32Array(b * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) bron.set(beeld.kleur(klem(x0 + x, beeld.breed), klem(y0 + y, beeld.hoog)), (y * b + x) * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) for (let k = 0; k < 3; k++) {
    let t = 0; for (let i = -s; i <= s; i++) t += kern[i + s] * bron[(y * b + Math.min(b - 1, Math.max(0, x + i))) * 3 + k];
    hor[(y * b + x) * 3 + k] = t / som;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) for (let k = 0; k < 3; k++) {
    let t = 0; for (let i = -s; i <= s; i++) t += kern[i + s] * hor[(Math.min(h - 1, Math.max(0, y + i)) * b + x) * 3 + k];
    uit[(y * b + x) * 3 + k] = t / som;
  }
  return (x, y) => { const i = ((y - y0) * b + (x - x0)) * 3; return [uit[i], uit[i + 1], uit[i + 2]]; };
}

const meng = (boven, onder) => [0, 1, 2].map((i) => boven[i] * boven[3] + onder[i] * (1 - boven[3]));
const lum = (c) => { const k = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; };
const contrast = (a, b) => { const [h, d] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (d + 0.05); };

// Helderste en donkerste 6x6-blok (gemiddelde, stap 2 px) van de vervaagde achtergrond binnen een vak.
function uitersteBlokken(lees, vak) {
  let helder = null, donker = null;
  const x1 = Math.floor(vak.x + vak.w) - 6, y1 = Math.floor(vak.y + vak.h) - 6;
  for (let y = Math.ceil(vak.y); y <= Math.max(Math.ceil(vak.y), y1); y += 2) for (let x = Math.ceil(vak.x); x <= Math.max(Math.ceil(vak.x), x1); x += 2) {
    const t = [0, 0, 0];
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) { const c = lees(x + dx, y + dy); t[0] += c[0]; t[1] += c[1]; t[2] += c[2]; }
    const g = t.map((v) => v / 36);
    if (!helder || lum(g) > lum(helder)) helder = g;
    if (!donker || lum(g) < lum(donker)) donker = g;
  }
  return { helder, donker };
}

// Meet per kaart in het huidige venster: de kaartkleur (rgba), de vervaging, het kaartvak, de teksten (zonder eigen achtergrond)
// en of de kaart volledig zichtbaar is (de hoeken en het midden raken de kaart zelf, niet een vaste balk).
async function meetKaarten(page, sel) {
  return page.locator(sel).evaluateAll((lijst) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const rgba = (kleur) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = kleur; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const vakVan = (r) => ({ x: r.left, y: r.top, w: r.width, h: r.height });
    return lijst.map((el, nr) => {
      const cs = getComputedStyle(el), r = el.getBoundingClientRect();
      const punten = [[r.left + 3, r.top + 3], [r.right - 3, r.top + 3], [r.left + 3, r.bottom - 3], [r.right - 3, r.bottom - 3], [r.left + r.width / 2, r.top + r.height / 2]];
      const zichtbaar = r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth
        && punten.every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
      const geraakt = punten.map(([x, y]) => document.elementFromPoint(x, y)).filter((g) => !el.contains(g)).map((g) => `${g?.tagName}.${g?.className}`);
      const teksten = [...el.querySelectorAll('*')]
        .filter((t) => [...t.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        .filter((t) => { let x = t; while (x && x !== el) { if (rgba(getComputedStyle(x).backgroundColor)[3] > 0) return false; x = x.parentElement; } return true; })
        .map((t) => ({ sel: t.className, kleur: rgba(getComputedStyle(t).color) }));
      return { nr, naam: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 30), kaart: rgba(cs.backgroundColor), blur: cs.backdropFilter, vak: vakVan(r), zichtbaar, geraakt, teksten };
    });
  });
}

// Foto van enkel de achtergrond: de kaarten en de voorste laag verborgen (visibility: de opmaak blijft), animaties stil.
async function fotoAchtergrond(page, sel) {
  const stijl = await page.addStyleTag({ content: `${sel}, #event-laag { visibility: hidden !important; }` });
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  await stijl.evaluate((el) => el.remove());
  const beeld = leesPng(png);
  expect(beeld.breed, 'de foto is op schaal 1').toBe(await page.evaluate(() => innerWidth));
  return beeld;
}

// Wacht tot het kaartvak (getBoundingClientRect) over twee opeenvolgende animatieframes gelijk blijft (scrollen en lay-out zijn dan klaar).
async function wachtOpStilstand(page, locator) {
  await locator.evaluate((el) => new Promise((klaar) => {
    const vorm = () => { const r = el.getBoundingClientRect(); return `${r.left},${r.top},${r.width},${r.height}`; };
    let vorige = vorm(), gelijk = 0, frames = 0;
    const stap = () => {
      const nu = vorm();
      gelijk = nu === vorige ? gelijk + 1 : 0;
      vorige = nu;
      if (gelijk >= 2 || ++frames > 120) klaar(); else requestAnimationFrame(stap);
    };
    requestAnimationFrame(stap);
  }));
}

// Alle kaarten van `sel` meten: één foto voor de kaarten die al volledig zichtbaar zijn, daarna de rest één voor één in beeld
// geschoven. Per kaart en tekst: het slechtste contrast tegen het gemiddelde en tegen de helderste en donkerste vlek.
// De glaswaarden zoals base.css ze nu voor dit toestel en thema geeft (--glas, --glas-hover, --blur op <html>).
async function leesGlasTokens(page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const alpha = (v) => { const m = v.match(/rgba?\(([^)]*)\)/)[1].split(',').map((x) => parseFloat(x)); return m.length > 3 ? m[3] : 1; };
    return { alpha: alpha(cs.getPropertyValue('--glas')), alphaHover: alpha(cs.getPropertyValue('--glas-hover')), blur: cs.getPropertyValue('--blur').trim() };
  });
}

async function controleerKaarten(page, sel, label, slechtste) {
  const glas = await leesGlasTokens(page);
  const gedaan = new Set();
  let aantal = 0;
  for (let ronde = 0; ronde < 40; ronde++) {
    let kaarten = await meetKaarten(page, sel);
    aantal = kaarten.length;
    expect(aantal, `${label}: kaarten`).toBeGreaterThan(0);
    const open = kaarten.filter((k) => !gedaan.has(k.nr));
    if (!open.length) break;
    if (!open.some((k) => k.zichtbaar)) {
      // Na het scrollen wachten tot het kaartvak over twee animatieframes niet meer verschuift, daarna meten; zichtbaar? Eén keer opnieuw
      for (let poging = 0; poging < 2; poging++) {
        await page.locator(sel).nth(open[0].nr).evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
        await wachtOpStilstand(page, page.locator(sel).nth(open[0].nr));
        kaarten = await meetKaarten(page, sel);
        if (kaarten.some((k) => !gedaan.has(k.nr) && k.zichtbaar)) break;
      }
    }
    const nu = kaarten.filter((k) => !gedaan.has(k.nr) && k.zichtbaar);
    expect(nu.length, `${label}: kaart ${open[0].naam} komt volledig in beeld (vak ${JSON.stringify(kaarten[open[0].nr].vak)}, geraakt ${kaarten[open[0].nr].geraakt})`).toBeGreaterThan(0);
    const beeld = await fotoAchtergrond(page, sel);
    for (const k of nu) {
      gedaan.add(k.nr);
      // Open dag (v2.5.0): glas is algemeen, waarden uit base.css (--glas en --blur van dit toestel en thema; de kaart zelf is
      // --glas, bij hover --glas-hover)
      expect(k.kaart[3], `${label} ${k.naam}`).toBeCloseTo(glas.alpha, 2);
      expect(k.blur).toContain(`blur(${glas.blur})`);
      expect(k.teksten.length).toBeGreaterThanOrEqual(2);
      const t0 = [0, 0, 0];
      let n = 0;
      for (let y = Math.ceil(k.vak.y); y < Math.floor(k.vak.y + k.vak.h); y++) for (let x = Math.ceil(k.vak.x); x < Math.floor(k.vak.x + k.vak.w); x++) {
        const c = beeld.kleur(x, y); t0[0] += c[0]; t0[1] += c[1]; t0[2] += c[2]; n++;
      }
      const gemiddeld = t0.map((v) => v / n);
      const lees = vervaag(beeld, k.vak);
      // de uiterste vlek ERGENS in de kaart: een andere afspraak of een lange titel kan tekst op elke plek van de kaart leggen
      const vlek = uitersteBlokken(lees, k.vak);
      // Ook met de muis erboven (hover: bv. --surface2, of de rodere kaart van een verlopen ticket): elke kaart, dezelfde vlekken
      await page.mouse.move(k.vak.x + k.vak.w / 2, k.vak.y + k.vak.h / 2);
      const zweef = (await meetKaarten(page, sel))[k.nr];
      await page.mouse.move(0, 0);
      expect(zweef.kaart[3], `${label} ${k.naam} (hover)`).toBeCloseTo(glas.alphaHover, 2);
      for (const [stand, kaart, teksten] of [['', k.kaart, k.teksten], [' (hover)', zweef.kaart, zweef.teksten]]) {
        for (const t of teksten) {
          for (const [soort, onder] of [['gemiddelde', gemiddeld], ['helderste vlek', vlek.helder], ['donkerste vlek', vlek.donker]]) {
            const c = contrast(t.kleur, meng(kaart, onder));
            const waar = `${label}${stand} ${k.naam} .${t.sel} rgb(${t.kleur.slice(0, 3)}) over ${soort} rgb(${onder.map(Math.round)})`;
            if (c < slechtste.waarde) Object.assign(slechtste, { waarde: c, waar });
            const v = label.split(' ')[2];
            slechtste.perVenster[v] = Math.min(slechtste.perVenster[v] ?? Infinity, c);
            expect(c, waar).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  }
  expect(gedaan.size, `${label}: alle kaarten gemeten`).toBe(aantal);
}

test.describe('helder glas en contrast per thema', () => {
  for (const id of PAKKET_IDS) {
    test(`@contrast ${id}: ticket- en kalenderkaarten zijn glas en elke tekst houdt 4,5:1 over de echte achtergrond, in donker en licht, liggend en staand, ook bij hover`, async ({ page }) => {
      test.setTimeout(300000);
      const p = leesPakket(id);
      await startApp(page, { query: AAN, overschrijf: { themas: themaStub(p) } });
      await expect(page.locator('html')).toHaveAttribute('data-event', id);
      await expect(page.locator('html')).toHaveAttribute('data-event-achtergrond', 'ja');
      // Geen overgangen tijdens het meten (een kaart kleurt anders 0,15 s lang van donker naar licht, in echte tijd)
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
      await expect(page.locator('#view-tickets .taddr.miss')).toHaveCount(1);
      const slechtste = { waarde: Infinity, waar: '', perVenster: {} };
      for (const [tab, sel] of [['#tab-tickets', '#view-tickets .ticket'], ['#tab-kalender', '#view-kalender .cal-ticket']]) {
        await page.locator(tab).click();
        await page.mouse.move(0, 0); // geen hover op een kaart
        await expect(page.locator(sel).first()).toBeVisible();
        for (const venster of VENSTERS) {
          await page.setViewportSize(venster);
          for (const thema of ['dark', 'light']) {
            await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), thema);
            // de lichte achtergrond staat aan de dekking van het pakket
            if (thema === 'light') await expect(page.locator('#event-achtergrond')).toHaveCSS('opacity', String(p.achtergrond.dekkingLicht));
            await controleerKaarten(page, sel, `${id} ${thema} ${venster.width}x${venster.height} ${tab.slice(5)}`, slechtste);
          }
        }
      }
      const tekst = `${slechtste.waarde.toFixed(2)}:1 (${slechtste.waar}); per venster ${Object.entries(slechtste.perVenster).map(([v, c]) => `${v} ${c.toFixed(2)}`).join(', ')}`;
      test.info().annotations.push({ type: 'slechtste contrast', description: tekst });
      console.log(`slechtste contrast ${id}: ${tekst}`);
    });
  }
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
    // Open dag (v2.5.0): glas is algemeen; op een telefoon minder vervaging (10 px, --blur in base.css; taak 10 mag dit terugnemen)
    expect(await page.locator('#view-tickets .ticket').first().evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur(10px)');
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
    // Open dag (v2.5.0): de body is altijd doorzichtig (de hemel erachter); "weer gewoon gevuld" is nu: de hemel staat terug
    // (#hemel zichtbaar) en <html> heeft de effen achtergrondkleur
    await expect(page.locator('#hemel')).not.toHaveCSS('display', 'none');
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
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

// Fix-ronde 1: ook de sales-schermen volgen "achtergrond altijd zichtbaar": de kolommen en de routelijst zijn doorzichtig, de kaarten glas.
test.describe('sales tijdens een thema met achtergrond', () => {
  const lead = (id, naam) => ({
    id, voornaam: 'Test', naam, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
    locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
    geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null },
  });
  test('kolommen en routelijst doorzichtig, leadkaarten mat glas', async ({ page }) => {
    await startSalesApp(page, { leads: [lead('a', 'Een'), lead('b', 'Twee')], query: AAN });
    await expect(page.locator('html')).toHaveAttribute('data-event-achtergrond', 'ja');
    const kolom = page.locator('#view-sales-lijst .sales-kolom').first();
    await expect(kolom).toBeVisible();
    expect(await kolom.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const kaart = page.locator('#view-sales-lijst .sales-kaart').first();
    await expect(kaart).toBeVisible();
    expect(await kaart.evaluate((el) => getComputedStyle(el).backdropFilter)).toContain('blur(');
    // De routelijst (sales-route.js bouwt ze pas met een depot en een dag): dezelfde klasse, los in het scherm gezet, zonder thema
    // effen (de regel van app.css) en met thema doorzichtig.
    const achtergrondVan = () => page.evaluate(() => {
      const el = document.createElement('div'); el.className = 'sales-route-lijstvak';
      document.getElementById('view-sales-lijst').appendChild(el);
      const kleur = getComputedStyle(el).backgroundColor; el.remove(); return kleur;
    });
    expect(await achtergrondVan()).toBe('rgba(0, 0, 0, 0)');
    await page.evaluate(() => document.documentElement.removeAttribute('data-event-achtergrond'));
    expect(await achtergrondVan()).not.toBe('rgba(0, 0, 0, 0)');
  });
});

// Taak 6b: "Bewegende beelden tijdens een thema" (persoonlijke instelling `bewegingUit`, bewaard bij het account).
// Staat ze aan (bewegingUit: true), dan blijven achtergrond en hoeken staan, maar er is niets dat beweegt.
test.describe('bewegende beelden uit (per gebruiker)', () => {
  const eigenStub = (instellingen) => ({ methode }) => (methode === 'PUT'
    ? { status: 200, json: { versie: 2 } }
    : { status: 200, json: { eigen: { gebruikerId: 'u-test', versie: 1, instellingen }, techniekers: {} } });
  const venster = (page) => page.getByRole('dialog', { name: /⚙️ Instellingen/ });
  const SCHAKELAAR = 'Bewegende beelden tijdens een thema';

  test('met bewegingUit in het serverrecord: geen bewegende figuren, wel de achtergrond en de hoeken', async ({ page }) => {
    await startApp(page, { query: AAN, overschrijf: { instellingen: eigenStub({ bewegingUit: true }) } });
    await expect(page.locator('html')).toHaveAttribute('data-event', 'halloween');
    await expect(achterLaag(page).locator('.ev-hoek')).toHaveCount(4);
    await expect(page.locator('#event-achtergrond')).toHaveCount(1);
    await expect(beide(page, '.ev-beweeg')).toHaveCount(0);
    expect(await laag(page).locator('.ev-kruip, .ev-vlieg, .ev-val, .ev-stijg, .ev-pluim').count()).toBe(0);
    // Precies wat een sober toestel toont: de achtergrond en de hoekbeelden, geen hangende figuren en geen mist (ruling 1)
    expect(await beide(page, '.ev-hang, .ev-mist, .ev-beeld-spin').count()).toBe(0);
    expect(await achterLaag(page).locator('*').evaluateAll((els) => els.filter((e) => !e.closest('.ev-hoek')).length)).toBe(0);
    expect(await laag(page).locator('*').count()).toBe(0);
    // geen enkele animatie in de lagen
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.effect?.target?.closest?.('#event-laag, #event-achter-laag')).length)).toBe(0);
  });

  test('zonder de instelling beweegt het wel (standaard)', async ({ page }) => {
    await startApp(page, { query: AAN, overschrijf: { instellingen: eigenStub({ duurMinuten: 90 }) } });
    await expect(laag(page).locator('.ev-kruip, .ev-vlieg').first()).toBeAttached();
  });

  // Brent 2026-10-27: de schakelaar staat voor iedereen onder "Dit toestel", naast "Feestelijke versiering", en bewaart meteen.
  const naarDitToestel = async (page) => {
    await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
    const modal = venster(page);
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Dit toestel', exact: true }).click();
    await expect(modal.locator('#set-tab-toestel')).toBeVisible();
    return modal;
  };

  test('de schakelaar staat onder "Dit toestel" (niet in Algemeen), naast de versiering', async ({ page }) => {
    await startApp(page, { query: AAN });
    await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
    const modal = venster(page);
    await expect(modal.locator('#set-tab-algemeen')).toBeVisible();
    await expect(modal.getByLabel(SCHAKELAAR)).toBeHidden();
    await expect(modal.locator('#set-tab-algemeen #set-beweging')).toHaveCount(0);
    await modal.getByRole('button', { name: 'Dit toestel', exact: true }).click();
    await expect(modal.getByLabel(SCHAKELAAR)).toBeVisible();
    await expect(modal.getByLabel('Versiering tonen tijdens feestperiodes')).toBeVisible();
    // volgorde: eerst de versiering (per toestel), dan de beweging (per account)
    expect(await page.evaluate(() => {
      const v = document.getElementById('set-versiering-blok'), b = document.getElementById('set-beweging-blok');
      return v.parentElement.id === 'set-tab-toestel' && v.nextElementSibling === b;
    })).toBe(true);
  });

  test('de schakelaar bewaart meteen (geen Opslaan) en de versiering past zich aan, zonder herladen', async ({ page, verzoeken }) => {
    await startApp(page, { query: AAN });
    await expect(laag(page).locator('.ev-kruip, .ev-vlieg').first()).toBeAttached();
    const modal = await naarDitToestel(page);
    const schakelaar = modal.getByLabel(SCHAKELAAR);
    await expect(schakelaar).toBeChecked(); // standaard bewegen de beelden
    await expect(modal).toContainText('Zet uit als de bewegende figuren je storen; de achtergrond blijft.');
    await expect(modal.getByRole('button', { name: 'Opslaan', exact: true })).toBeHidden();
    await schakelaar.uncheck();
    await expect(beide(page, '.ev-beweeg')).toHaveCount(0);
    await expect(achterLaag(page).locator('.ev-hoek')).toHaveCount(4);
    await expect(page.locator('#event-achtergrond')).toHaveCount(1);
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(1);
    const put = verzoeken.van('/api/instellingen', 'PUT')[0].body;
    expect(put.gebruiker).toBeUndefined(); // het eigen record
    expect(put.instellingen.bewegingUit).toBe(true);
    // Sluiten en heropenen: de keuze staat er nog; weer aan zet de beweging meteen terug
    await expect(modal.locator('#set-sluit-btn')).toHaveText('Sluiten');
    await modal.locator('#set-sluit-btn').click();
    await expect(modal).toBeHidden();
    const opnieuw = await naarDitToestel(page);
    await expect(opnieuw.getByLabel(SCHAKELAAR)).not.toBeChecked();
    await opnieuw.getByLabel(SCHAKELAAR).check();
    await expect(laag(page).locator('.ev-kruip, .ev-vlieg').first()).toBeAttached();
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(2);
    expect(verzoeken.van('/api/instellingen', 'PUT')[1].body.instellingen.bewegingUit).toBeUndefined();
  });

  test('Opslaan in Algemeen na de schakelaar houdt de keuze (overschrijft ze niet)', async ({ page, verzoeken }) => {
    await startApp(page, { query: AAN });
    const modal = await naarDitToestel(page);
    await modal.getByLabel(SCHAKELAAR).uncheck();
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(1);
    await modal.getByRole('button', { name: 'Algemeen', exact: true }).click();
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(2);
    expect(verzoeken.van('/api/instellingen', 'PUT')[1].body.instellingen.bewegingUit).toBe(true);
    await expect(beide(page, '.ev-beweeg')).toHaveCount(0);
  });

  test('de schakelaar "Feestelijke versiering" (uit, per toestel) gaat voor bewegingUit', async ({ page }) => {
    await startApp(page, { query: AAN, overschrijf: { instellingen: eigenStub({ bewegingUit: true }) } });
    await expect(achterLaag(page).locator('.ev-hoek')).toHaveCount(4);
    await page.evaluate(() => localStorage.setItem('blitz_versiering', 'uit'));
    await page.reload();
    await expect(page.locator('#cnt-tickets')).toBeVisible();
    await expect(laag(page)).toHaveCount(0);
    await expect(achterLaag(page)).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
  });

  // Ruling 2: een technieker in de beperkte weergave (enkel "Dit toestel") schakelt de beweging ook uit, in zijn EIGEN account.
  test('technieker in de beperkte weergave: dezelfde schakelaar onder "Dit toestel", bewaard bij zijn eigen account', async ({ page, verzoeken }) => {
    await startApp(page, { query: AAN, loginRol: 'technieker', loginGebruiker: { zohoNaam: 'Tim' }, technieker: 'Tim' });
    await expect(laag(page).locator('.ev-kruip, .ev-vlieg').first()).toBeAttached();
    await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
    const modal = venster(page);
    await expect(modal.locator('#set-tab-toestel')).toBeVisible();
    await expect(modal.locator('#set-tab-algemeen')).toBeHidden();
    const schakelaar = modal.getByLabel(SCHAKELAAR);
    await expect(schakelaar).toBeVisible();
    await expect(schakelaar).toBeChecked();
    await expect(modal).toContainText('Zet uit als de bewegende figuren je storen; de achtergrond blijft.');
    await schakelaar.uncheck(); // geen Opslaan op dit tabblad: de keuze wordt meteen bewaard
    await expect(beide(page, '.ev-beweeg')).toHaveCount(0);
    await expect(achterLaag(page).locator('.ev-hoek')).toHaveCount(4);
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(1);
    const put = verzoeken.van('/api/instellingen', 'PUT')[0].body;
    expect(put.gebruiker).toBeUndefined(); // het eigen record, geen id van iemand anders
    expect(put.instellingen.bewegingUit).toBe(true);
    // Weer aan: het veld verdwijnt (standaard) en de beelden bewegen opnieuw
    await schakelaar.check();
    await expect(laag(page).locator('.ev-kruip, .ev-vlieg').first()).toBeAttached();
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(2);
    expect(verzoeken.van('/api/instellingen', 'PUT')[1].body.instellingen.bewegingUit).toBeUndefined();
  });
});
