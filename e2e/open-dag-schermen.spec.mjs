import { test, expect, startApp, authIkStub } from './helpers.mjs';
import { startSalesApp } from './sales-hulp.mjs';

// Open dag-stijl, taak 8b: de overige schermen en vensters. Vensters zijn sterk gedekt glas (28 px), de offline- en outbox-balk blijven
// effen, het inlogscherm is een glazen kaart op de hemel, het dok (gsm) bedekt nooit de knoppen van een venster.

const PC = { width: 1366, height: 768 };
const GSM = { width: 375, height: 812 };

const zetWeergave = (page, weergave) => page.addInitScript((w) => {
  if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
  localStorage.setItem('blitz_weergave', w);
}, weergave);

test.describe('overige schermen en vensters (Open dag)', () => {
  test('venster bedekt door niets op gsm (Review Focus 4)', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { viewport: GSM });
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'dok');
    await page.locator('#tab-gepland').click();
    await expect(page.locator('#view-gepland')).toHaveClass(/active/);
    // Ingepland kan op een rustige week leeg zijn: dan opent een ticket uit de Wachtrij hetzelfde detailvenster.
    const kaart = page.locator('#view-gepland .ticket');
    if (await kaart.count() === 0) {
      await page.locator('#tab-tickets').click();
      await page.locator('#view-tickets .ticket').first().click();
    } else {
      await kaart.first().click();
    }
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
    // de knoppenrij van het ticketdetail is .mftr (er bestaat geen .mfoot)
    const knoppen = page.locator('#det-overlay .mftr button:visible');
    expect(await knoppen.count()).toBeGreaterThan(0);
    // scroll de rij in beeld (het venster scrolt zelf) en meet de laatste knop
    const laatste = knoppen.last();
    await laatste.scrollIntoViewIfNeeded();
    const doos = await laatste.boundingBox();
    expect(doos.y + doos.height).toBeLessThanOrEqual(GSM.height);
    const treft = await laatste.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === el || el.contains(top);
    });
    expect(treft).toBe(true);
    // het dok ligt onder het venster (z-index), nooit erover
    const dokBoven = await page.evaluate(() => {
      const r = document.querySelector('.tabs').getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top?.closest('.tabs');
    });
    expect(dokBoven).toBe(false);
  });

  test('vensters zijn glas: 28 px, doorzichtig en vervaagd', async ({ page }) => {
    await startApp(page, { viewport: PC });
    await page.locator('#view-tickets .ticket').first().click();
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
    const stijl = await page.locator('#det-overlay .modal').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderRadius, filter: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor };
    });
    expect(stijl.radius).toBe('28px');
    expect(stijl.filter).toContain('blur(');
    // halfdoorschijnend: een alfakanaal onder 1 (rgba(...) met alfa)
    expect(stijl.bg).toMatch(/^rgba\(/);
  });

  test('het ticketdetail gloeit langs de rand in de kleur van het ticket', async ({ page }) => {
    await startApp(page, { viewport: PC });
    const kaart = page.locator('#view-tickets .ticket[data-urgentie]').first();
    await expect(kaart).toBeVisible();
    const urgentie = await kaart.getAttribute('data-urgentie');
    await kaart.click();
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
    const modal = page.locator('#det-overlay .modal');
    await expect(modal).toHaveAttribute('data-urgentie', urgentie);
    const stijl = await modal.evaluate((el) => {
      const cs = getComputedStyle(el);
      const kleur = { rood: 'var(--red)', oranje: 'var(--orange)', groen: 'var(--green)' }[el.dataset.urgentie];
      const proef = document.createElement('i'); proef.style.color = kleur; document.body.appendChild(proef);
      const verwacht = getComputedStyle(proef).color; proef.remove();
      return { rand: cs.borderTopColor, schaduw: cs.boxShadow, verwacht };
    });
    // de rand is een mengsel van de statuskleur (geen grijze glasrand) en de schaduwlijst bevat een schijn
    expect(stijl.rand).not.toBe('rgba(255, 255, 255, 0.14)');
    expect(stijl.schaduw).not.toBe('none');
    expect(stijl.schaduw.match(/inset/g).length).toBeGreaterThanOrEqual(2); // de lichtrand én de schijn naar binnen
  });

  test('inlogscherm op de hemel: één glazen kaart', async ({ page }) => {
    const staat = { ingelogd: false };
    const ingelogd = authIkStub('beheerder');
    await startApp(page, {
      viewport: PC,
      wachtOpApp: false,
      overschrijf: { 'auth-ik': (z) => (staat.ingelogd ? ingelogd(z) : { status: 401, json: { error: 'Niet ingelogd', code: 'niet-ingelogd', setupNodig: false } }) },
    });
    await expect(page.locator('#login-overlay')).toBeVisible();
    await expect(page.locator('#hemel')).toBeVisible();
    const kaart = await page.locator('#login-overlay .login-kaart').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { filter: cs.backdropFilter || cs.webkitBackdropFilter, radius: cs.borderRadius };
    });
    expect(kaart.filter).toContain('blur(');
    expect(kaart.radius).toBe('28px');
  });

  // WCAG-contrast uit twee berekende kleuren; een doorzichtige voorgrond/achtergrond wordt over `onder` gelegd.
  const CONTRAST = `(() => {
    const lees = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/)[1].split(',').map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    const meng = (v, o) => ({ r: v.r * v.a + o.r * (1 - v.a), g: v.g * v.a + o.g * (1 - v.a), b: v.b * v.a + o.b * (1 - v.a), a: 1 });
    const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    return (tekst, achtergrond, onder) => { const bg = meng(lees(achtergrond), onder); const fg = meng(lees(tekst), bg); const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
  })()`;
  for (const thema of ['dark', 'light']) {
    test(`de offline- en outbox-balk blijven effen en leesbaar (${thema}): geen glas, contrast >= 4,5:1`, async ({ page }) => {
      await page.addInitScript((t) => { if (window === window.top) localStorage.setItem('blitz_theme', t); }, thema);
      await startApp(page, { viewport: PC });
      await expect(page.locator('html')).toHaveAttribute('data-theme', thema);
      const meting = await page.evaluate((src) => {
        const contrast = eval(src);
        const offline = document.getElementById('offline-banner'); offline.style.display = 'flex';
        offline.textContent = 'Geen verbinding';
        const outbox = document.getElementById('outbox-banner'); outbox.style.display = 'flex';
        outbox.innerHTML = '<div class="outbox-item"><span class="outbox-item-tnum">#1001</span><span class="outbox-item-step">Verzenden</span><span class="outbox-item-attempts">poging 2</span>'
          + '<span class="outbox-item-error">Geen verbinding met de server</span><button class="outbox-item-btn">Opnieuw proberen</button><button class="outbox-item-btn outbox-item-btn-cancel">Annuleren</button></div>';
        const kleur = (el, eigenschap) => getComputedStyle(el)[eigenschap];
        const zwart = { r: 0, g: 0, b: 0, a: 1 };
        const rij = (balk, el) => {
          const bg = kleur(balk, 'backgroundColor');
          // een knop ligt (halfdoorschijnend) over de balk: eerst de balk effen, dan de knop erover
          const knop = el.matches('button') ? kleur(el, 'backgroundColor') : null;
          const grondRgb = bg;
          let ratio;
          if (knop) {
            const m = (c) => c.match(/rgba?\(([^)]+)\)/)[1].split(',').map(Number);
            const [br, bgc, bb] = m(grondRgb); const [kr, kg, kb, ka = 1] = m(knop);
            const eff = `rgb(${kr * ka + br * (1 - ka)}, ${kg * ka + bgc * (1 - ka)}, ${kb * ka + bb * (1 - ka)})`;
            ratio = contrast(kleur(el, 'color'), eff, zwart);
          } else ratio = contrast(kleur(el, 'color'), grondRgb, zwart);
          return { ratio, bg };
        };
        return {
          offline: { ...rij(offline, offline), filter: kleur(offline, 'backdropFilter') },
          outbox: {
            filter: kleur(outbox, 'backdropFilter'), bg: kleur(outbox, 'backgroundColor'),
            tekst: rij(outbox, outbox.querySelector('.outbox-item-tnum')).ratio,
            stap: rij(outbox, outbox.querySelector('.outbox-item-step')).ratio,
            fout: rij(outbox, outbox.querySelector('.outbox-item-error')).ratio,
            knop: rij(outbox, outbox.querySelector('.outbox-item-btn:not(.outbox-item-btn-cancel)')).ratio,
            annuleer: rij(outbox, outbox.querySelector('.outbox-item-btn-cancel')).ratio,
          },
        };
      }, CONTRAST);
      for (const balk of [meting.offline, meting.outbox]) {
        expect(balk.filter === 'none' || balk.filter === '').toBe(true); // geen glas
        expect(balk.bg).toMatch(/^rgb\(/); // effen: geen alfakanaal
      }
      console.log(thema, JSON.stringify({ offline: meting.offline.ratio.toFixed(2), outbox: Object.fromEntries(Object.entries(meting.outbox).filter(([k]) => !['filter', 'bg'].includes(k)).map(([k, v]) => [k, v.toFixed(2)])) }));
      expect(meting.offline.ratio).toBeGreaterThanOrEqual(4.5);
      for (const k of ['tekst', 'stap', 'fout', 'knop', 'annuleer']) expect(meting.outbox[k], `outbox ${k}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('de Leaflet-kaart blijft ondoorzichtig', async ({ page }) => {
    await startApp(page, { viewport: PC });
    await page.locator('#tab-planning').click();
    await expect(page.locator('#map-wrap')).toBeVisible();
    const kaart = await page.locator('#map').evaluate((el) => {
      const cs = getComputedStyle(el);
      return { filter: cs.backdropFilter, op: cs.opacity };
    });
    expect(kaart.op).toBe('1');
    expect(kaart.filter === 'none' || kaart.filter === '').toBe(true);
  });

  test('data-nav staat al bij de eerste verf (vóór de modules)', async ({ page }) => {
    await page.setViewportSize(GSM);
    await zetWeergave(page, 'gsm');
    // het inline hoofdscript en apparaat.js lopen vóór de modules: lees het attribuut op het eerste moment dat de body bestaat
    await page.addInitScript(() => {
      const w = () => { window.__navEerst = document.documentElement.getAttribute('data-nav'); };
      new MutationObserver((_, o) => { if (document.body) { w(); o.disconnect(); } }).observe(document, { childList: true, subtree: true });
    });
    await startApp(page, { viewport: GSM });
    expect(await page.evaluate(() => window.__navEerst)).toBe('dok');
  });

  test('kalenderweek in een smal computervenster: de pagina scrolt niet horizontaal', async ({ page }) => {
    await zetWeergave(page, 'computer');
    await startApp(page, { viewport: GSM });
    await page.locator('#tab-kalender').click();
    await expect(page.locator('#view-kalender')).toHaveClass(/active/);
    const breedtes = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, venster: document.documentElement.clientWidth }));
    expect(breedtes.doc).toBeLessThanOrEqual(breedtes.venster);
  });

  test('.kal-lbl-vandaag schemert niet door het inlogscherm', async ({ page }) => {
    await startApp(page, { viewport: PC });
    // simuleer: de labelknop toont "↺ Vandaag" en er staat een login-overlay
    const zichtbaar = await page.evaluate(() => {
      const lbl = document.querySelector('.kal-week-label');
      lbl.classList.add('niet-vandaag');
      const o = document.createElement('div'); o.id = 'login-overlay'; document.body.prepend(o);
      return getComputedStyle(document.querySelector('.kal-lbl-vandaag')).visibility;
    });
    expect(zichtbaar).toBe('hidden');
  });

  test('sales-route in een smal computervenster: de route vult het scherm boven het dok', async ({ page }) => {
    await startSalesApp(page, { leads: [] , viewport: { width: 720, height: 800 } });
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'dok');
    await expect(page.locator('html')).toHaveAttribute('data-indeling', 'breed');
    await page.getByRole('tab', { name: 'Route', exact: true }).click();
    await expect(page.locator('#view-sales-route')).toHaveClass(/active/);
    const [route, dok] = await page.evaluate(() => [
      document.querySelector('#view-sales-route').getBoundingClientRect().bottom,
      document.querySelector('.tabs').getBoundingClientRect().top,
    ]);
    expect(route).toBeLessThanOrEqual(dok + 1);
  });
});
