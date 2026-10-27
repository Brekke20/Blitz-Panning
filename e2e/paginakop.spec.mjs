import { test, expect, startApp, snelTikken } from './helpers.mjs';
import { startSalesApp } from './sales-hulp.mjs';

// Open dag, taak 7: op `breed` is de kop een paginakop (grote titel van het actieve tabblad + een samenvatting met cijfers die het scherm al
// heeft; het logo staat in de zijkolom); op een gsm blijft de kop logo + alle knoppen op één regel, ook op 360 px (niets verdwijnt, de
// pagina scrolt nooit horizontaal). Plus: de tabnavigatie is op `breed` verticaal (pijl omhoog/omlaag) en het verborgen spel opent op pc
// via het logo in de zijkolom.

const PC = { width: 1280, height: 800 };

const zetWeergave = (page, weergave) => page.addInitScript((w) => {
  if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
  localStorage.setItem('blitz_weergave', w);
}, weergave);

const titel = (page) => page.locator('#paginatitel');
const sub = (page) => page.locator('#paginasub');

test.describe('paginakop', () => {
  test('pc: titel en samenvatting', async ({ page }) => {
    await startApp(page, { viewport: PC });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'breed');
    await expect(page.locator('.paginakop')).toBeVisible();
    await expect(page.locator('header .logo')).toBeHidden(); // het logo staat in de zijkolom
    await expect(titel(page)).toHaveText('Wachtrij');
    await expect(sub(page)).toHaveText(/^\d+ tickets? wacht(en)? op een datum/);
    await page.locator('#tab-kalender').click();
    await expect(titel(page)).toHaveText('Kalender');
    await expect(sub(page)).toHaveText(/^Week \d+ · /);
    // Route heeft geen samenvatting: enkel de titel
    await page.locator('#tab-planning').click();
    await expect(titel(page)).toHaveText('Route');
    await expect(sub(page)).toHaveText('');
    await page.locator('#tab-gepland').click();
    await expect(titel(page)).toHaveText('Ingepland');
    await expect(sub(page)).toHaveText(/^(\d+ afspraak|\d+ afspraken|Geen afspraken) deze week/);
    await page.locator('#tab-inventaris').click();
    await expect(titel(page)).toHaveText('Inventaris');
    await expect(sub(page)).toHaveText(/(onder (hun|zijn) meldgrens|^Alles boven de meldgrens)$/);
    // de knoppen staan rechts in de kop, als ronde knoppen
    const kop = await page.locator('header').boundingBox();
    const instel = await page.locator('header [data-actie="instellingen"]').boundingBox();
    expect(instel.x).toBeGreaterThan(kop.x + kop.width / 2);
    await expect(page.locator('header [data-actie="instellingen"]')).toHaveCSS('border-radius', '50%');
  });

  test('pc: de samenvatting volgt de wachtrij (een ticket minder)', async ({ page }) => {
    await startApp(page, { viewport: PC });
    const voor = Number((await sub(page).textContent()).match(/^\d+/)[0]);
    expect(voor).toBeGreaterThan(1);
    await page.evaluate(() => {
      const t = window.kern.toestand;
      t.set('allTickets', t.get('allTickets').slice(1));
    });
    await expect(sub(page)).toHaveText(new RegExp(`^${voor - 1} tickets? wacht(en)? op een datum`));
  });

  test('pc: Leads (sales) toont het aantal open leads', async ({ page }) => {
    const lead = (id) => ({
      id, voornaam: 'Test', naam: 'Klant ' + id, gsm: null, email: null, postcode: '3500', gemeente: 'Hasselt', straat: null, huisnr: null, adresTekst: null,
      locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, status: 'te-plannen', bezoeken: [],
      geimporteerdOp: '2026-10-01T08:00:00.000Z', bronExport: { verantwoordelijke: 'Test Verkoper', geexporteerdOp: null },
    });
    await startSalesApp(page, { leads: [lead('a'), lead('b'), lead('c')], blokken: [], viewport: PC });
    await expect(titel(page)).toHaveText('Leads');
    await expect(sub(page)).toHaveText('3 open leads');
    await page.locator('#tab-sales-kalender').click();
    await expect(titel(page)).toHaveText('Kalender');
    await expect(sub(page)).toHaveText('');
  });

  test('gsm 360 px: alles in de kop zichtbaar, geen horizontaal scrollen', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { viewport: { width: 360, height: 780 } });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
    await expect(page.locator('.paginakop')).toBeHidden();
    const knoppen = ['#person-btn', 'header [data-actie="vernieuw"]', 'header [data-actie="thema"]', 'header [data-actie="instellingen"]', '.gebruiker-btn', 'header .logo-icon', '#test-badge'];
    for (const sel of knoppen) {
      const el = page.locator(sel);
      await expect(el, sel).toBeVisible();
      const b = await el.boundingBox();
      expect(b.x, `${sel} begint binnen het scherm`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${sel} eindigt binnen het scherm`).toBeLessThanOrEqual(360);
    }
    // de knoppen overlappen elkaar niet
    const vakken = await Promise.all(knoppen.slice(0, 5).map(s => page.locator(s).boundingBox()));
    for (let i = 1; i < vakken.length; i++) expect(vakken[i].x, `knop ${i} na knop ${i - 1}`).toBeGreaterThanOrEqual(vakken[i - 1].x + vakken[i - 1].width - 0.5);
    // het logo en de TEST-badge (klein boven het logo) schuiven niet onder de persoonkiezer
    const icoon = await page.locator('header .logo-icon').boundingBox();
    const badge = await page.locator('#test-badge').boundingBox();
    expect(icoon.x + icoon.width, 'logo vóór de persoonkiezer').toBeLessThanOrEqual(vakken[0].x + 0.5);
    expect(badge.x + badge.width, 'TEST-badge vóór de persoonkiezer').toBeLessThanOrEqual(vakken[0].x + 0.5);
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBeLessThanOrEqual(360);
    const kop = await page.locator('header').boundingBox();
    expect(kop.height, 'de kop is één regel').toBeLessThan(70);
  });

  test('gsm 360 px met aanraking (44 px-knoppen): nog steeds één regel zonder horizontaal scrollen', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
    const page = await context.newPage();
    try {
      await startApp(page);
      await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
      // een lange naam in de persoonkiezer (die krimpt tot zijn maximum)
      await page.evaluate(() => { document.getElementById('person-name-hdr').textContent = 'Christophe Vandenberghe'; });
      const vakken = [];
      for (const sel of ['header .logo-icon', '#person-btn', 'header [data-actie="vernieuw"]', 'header [data-actie="thema"]', 'header [data-actie="instellingen"]', '.gebruiker-btn']) {
        const b = await page.locator(sel).boundingBox();
        expect(b, sel).not.toBeNull();
        expect(b.x, `${sel} begint binnen het scherm`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${sel} eindigt binnen het scherm`).toBeLessThanOrEqual(360);
        if (vakken.length) expect(b.x, `${sel} overlapt het vorige niet`).toBeGreaterThanOrEqual(vakken.at(-1).x + vakken.at(-1).width - 0.5);
        vakken.push(b);
      }
      // de TEST-badge wijkt als laatste: klein boven het logo, niet ernaast (en nooit over de persoonkiezer)
      const icoon = vakken[0];
      const badge = await page.locator('#test-badge').boundingBox();
      expect(badge.x + badge.width).toBeLessThanOrEqual(vakken[1].x + 0.5);
      expect(badge.y + badge.height, 'de badge staat boven het logo').toBeLessThanOrEqual(icoon.y + icoon.height / 2);
      expect(icoon.width, 'het logo-icoon wordt niet samengedrukt').toBeGreaterThanOrEqual(28);
      expect(await page.evaluate(() => document.scrollingElement.scrollWidth)).toBeLessThanOrEqual(360);
      expect((await page.locator('header').boundingBox()).height).toBeLessThan(70);
    } finally { await context.close(); }
  });

  // Review Focus 3. De chromium-fixture laat setOffline toe (Ruling 2), maar de app volgt `navigator.onLine` pas bij een online/offline-gebeurtenis
  // en een echte offline-stand laat ook de stubs falen; daarom tonen we de balk zoals e2e/sticky-balken.spec.mjs: display flex.
  test('offline-balk zichtbaar (Review Focus 3): op pc naast de zijkolom, op gsm onder de kop en niets onder het dok', async ({ page }) => {
    await startApp(page, { viewport: PC });
    const toonBalken = () => page.evaluate(() => {
      document.getElementById('offline-banner').style.display = 'flex';
      const o = document.getElementById('outbox-banner'); o.style.display = 'flex'; o.textContent = 'Rapport #1 wacht op verzending';
    });
    await toonBalken();
    const pcBalk = await page.locator('#offline-banner').boundingBox();
    expect(pcBalk.x, 'de balk begint na de zijkolom').toBeGreaterThanOrEqual(250);
    const pcKop = await page.locator('header').boundingBox();
    expect(pcBalk.y).toBeGreaterThanOrEqual(pcKop.y + pcKop.height - 0.5);
    expect((await page.locator('#outbox-banner').boundingBox()).x).toBeGreaterThanOrEqual(250);

    // gsm
    await page.evaluate(() => window.zetWeergave('gsm'));
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'smal');
    await toonBalken();
    const kop = await page.locator('header').boundingBox();
    const balk = await page.locator('#offline-banner').boundingBox();
    expect(balk.y, 'de offline-balk staat onder de kop').toBeGreaterThanOrEqual(kop.y + kop.height - 0.5);
    expect(balk.x).toBeLessThan(1);
    // een lange wachtrij: na helemaal naar onder scrollen staat de laatste kaart boven het dok
    await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const laatste = await page.locator('#ticket-list .ticket').last().boundingBox();
    const dok = await page.locator('.tabs').boundingBox();
    expect(laatste.y + laatste.height, 'de laatste kaart eindigt boven het dok').toBeLessThanOrEqual(dok.y + 0.5);
    // en de balk blijft (sticky) onder de kop
    const balkNa = await page.locator('#offline-banner').boundingBox();
    expect(balkNa.y).toBeGreaterThanOrEqual(kop.y + kop.height - 0.5);
  });
});

test.describe('tabnavigatie op breed (Ruling 11)', () => {
  test('pc: aria-orientation vertical, pijl omlaag/omhoog verplaatst de focus; links/rechts blijven werken', async ({ page }) => {
    await startApp(page, { viewport: PC });
    await expect(page.locator('.tabs-inner')).toHaveAttribute('aria-orientation', 'vertical');
    await page.locator('#tab-tickets').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#tab-kalender')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-planning')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#tab-kalender')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#tab-tickets')).toBeFocused();
    await page.keyboard.press('ArrowUp'); // rond: naar de laatste
    await expect(page.locator('.tabs-inner .tab:visible').last()).toBeFocused();
  });

  test('gsm: geen aria-orientation, pijl omlaag doet niets; wisselen naar pc zet hem terug', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { viewport: { width: 375, height: 812 } });
    await expect(page.locator('.tabs-inner')).not.toHaveAttribute('aria-orientation', /.*/);
    await page.locator('#tab-tickets').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#tab-tickets')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-kalender')).toBeFocused();
    await page.evaluate(() => window.zetWeergave('computer'));
    await page.setViewportSize(PC);
    await expect(page.locator('.tabs-inner')).toHaveAttribute('aria-orientation', 'vertical');
  });
});

test.describe('verborgen spel via het logo (Ruling 10)', () => {
  test('pc: 5× tikken op het logo in de zijkolom opent Blitz Run', async ({ page }) => {
    await startApp(page, { viewport: PC });
    await expect(page.locator('header .logo-icon')).toBeHidden();
    await snelTikken(page, page.locator('.zijkolom-logo-icoon'));
    await expect(page.locator('#spel-overlay')).toHaveClass(/open/);
  });

  test('gsm: 5× tikken op het logo in de kop opent Blitz Run', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { viewport: { width: 375, height: 812 } });
    await expect(page.locator('.zijkolom-logo-icoon')).toBeHidden();
    await snelTikken(page, page.locator('header .logo-icon'));
    await expect(page.locator('#spel-overlay')).toHaveClass(/open/);
  });
});
