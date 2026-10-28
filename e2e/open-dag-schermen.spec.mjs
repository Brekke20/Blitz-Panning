import { test, expect, startApp, authIkStub } from './helpers.mjs';
import { startSalesApp } from './sales-hulp.mjs';
import { leesPakket, themaStub } from './contrast-meting.mjs';

// Open dag-stijl, taak 8b: de overige schermen en vensters. Vensters zijn sterk gedekt glas (28 px), de offline- en outbox-balk blijven
// effen, het inlogscherm is een glazen kaart op de hemel, het dok (gsm) bedekt nooit de knoppen van een venster.

const PC = { width: 1366, height: 768 };
const GSM = { width: 375, height: 812 };
const HULP_MARGE = 1.03, SORTEER_MARGE = 1.10; // zie de toelichting bij de meting van de wachtrij-balk

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
  // De meting zelf: offline- en outbox-balk vullen en per tekst het contrast tegen de echte achtergrond rekenen.
  const meetBalken = (page) => page.evaluate((src) => {
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
  const controleerBalken = (meting, label) => {
    for (const balk of [meting.offline, meting.outbox]) {
      expect(balk.filter === 'none' || balk.filter === '').toBe(true); // geen glas
      expect(balk.bg).toMatch(/^rgb\(/); // effen: geen alfakanaal
    }
    console.log(label, JSON.stringify({ offline: meting.offline.ratio.toFixed(2), outbox: Object.fromEntries(Object.entries(meting.outbox).filter(([k]) => !['filter', 'bg'].includes(k)).map(([k, v]) => [k, v.toFixed(2)])) }));
    expect(meting.offline.ratio, `offline ${label}`).toBeGreaterThanOrEqual(4.5);
    for (const k of ['tekst', 'stap', 'fout', 'knop', 'annuleer']) expect(meting.outbox[k], `outbox ${k} ${label}`).toBeGreaterThanOrEqual(4.5);
  };
  for (const thema of ['dark', 'light']) {
    test(`de offline- en outbox-balk blijven effen en leesbaar (${thema}): geen glas, contrast >= 4,5:1`, async ({ page }) => {
      await page.addInitScript((t) => { if (window === window.top) localStorage.setItem('blitz_theme', t); }, thema);
      await startApp(page, { viewport: PC });
      await expect(page.locator('html')).toHaveAttribute('data-theme', thema);
      controleerBalken(await meetBalken(page), thema);
    });
  }
  // Eindreview F1: een themapakket overschrijft --accent en --on-accent; de balk staat los van het accent (vast Blitz-groen met --on-groen).
  for (const id of ['sinterklaas', 'carnaval', 'kerst', 'nationale-feestdag', 'halloween']) {
    for (const thema of ['dark', 'light']) {
      test(`outbox-balk in thema ${id} (${thema}): fout en knoppen houden 4,5:1`, async ({ page }) => {
        // tijdens een thema geldt de eigen sleutel van het thema (blitz_theme blijft onaangeroerd), zie versiering.spec.mjs
        await page.addInitScript(([sleutel, t]) => { if (window === window.top) localStorage.setItem(sleutel, t); }, [`blitz_theme_${id}_2026`, thema]);
        await startApp(page, { viewport: PC, query: '?test&versiering=aan', overschrijf: { themas: themaStub(leesPakket(id)) } });
        await expect(page.locator('html')).toHaveAttribute('data-theme', thema);
        await expect(page.locator('html')).toHaveAttribute('data-event', id);
        controleerBalken(await meetBalken(page), `${id} ${thema}`);
      });
    }
  }

  // Eindreview F3: een 401 midden in de sessie legt het loginscherm over een open venster; dat venster (en de wizard, een dialoog, het spel)
  // mag niet door de doorzichtige loginlaag heen te zien zijn.
  test('loginlaag over een open venster: venster, wizard, dialoog en spel zijn verborgen', async ({ page }) => {
    await startApp(page, { viewport: PC });
    await page.locator('#view-tickets .ticket').first().click();
    await expect(page.locator('#det-overlay')).toHaveClass(/open/);
    await page.evaluate(() => {
      // een open wizard, dialoog en spel nabootsen: enkel de zichtbaarheid telt
      for (const [id, klasse] of [['rapport-wizard', 'open'], ['spel-overlay', 'open']]) {
        const el = document.getElementById(id) || Object.assign(document.createElement('div'), { id });
        el.classList.add(klasse); el.style.display = 'flex'; if (!el.parentNode) document.body.appendChild(el);
      }
      const d = document.createElement('div'); d.className = 'overlay open app-dialog-overlay'; d.id = 'proef-dialoog'; document.body.appendChild(d);
      import('/js/schermen/inloggen.js').then((m) => { m.toonInloggen(); });
    });
    await expect(page.locator('#login-overlay')).toBeVisible();
    for (const sel of ['#det-overlay', '#rapport-wizard', '#spel-overlay', '#proef-dialoog']) {
      expect(await page.locator(sel).evaluate((el) => getComputedStyle(el).visibility), sel).toBe('hidden');
    }
    await expect(page.locator('#login-overlay .login-kaart')).toBeVisible();
  });

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
  // Taak 14 (vraag van Brent, 2026-10-28): op een gsm kapte de bovenste balk van de Wachtrij de hulptekst van het zoekvak en het
  // sorteerlabel af. Nu staat het zoekvak op een eigen rij; de sorteerkeuze en het aantal staan daaronder.
  for (const [breedte, hoogte] of [[375, 812], [360, 780]]) {
    for (const modus of ['gsm-weergave', 'smal-venster']) {
      test(`wachtrij-balk leesbaar op ${breedte} px (${modus})`, async ({ page }) => {
        if (modus === 'gsm-weergave') await zetWeergave(page, 'gsm');
        await startApp(page, { viewport: { width: breedte, height: hoogte } });
        await expect(page.locator('html')).toHaveAttribute('data-nav', 'dok');
        if (modus === 'gsm-weergave') await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'gsm');
        const m = await page.evaluate(async () => {
          await document.fonts.ready; // geen meting vóór de lettertypen klaar zijn
          const meet = (tekst, cs) => {
            const c = document.createElement('canvas').getContext('2d');
            c.font = cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            return c.measureText(tekst).width;
          };
          const inhoud = (el, cs) => el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const zoek = document.getElementById('wq-zoek');
          const zcs = getComputedStyle(zoek);
          const sel = document.getElementById('wq-sorteer');
          const scs = getComputedStyle(sel);
          const opties = [...sel.options].map((o) => ({ tekst: o.textContent, breedte: meet(o.textContent, scs) }));
          const teller = document.getElementById('wq-teller');
          const tr = teller.getBoundingClientRect();
          const zr = zoek.getBoundingClientRect(), sr = sel.getBoundingClientRect();
          return {
            hulp: { tekst: zoek.placeholder, breedte: meet(zoek.placeholder, zcs), ruimte: inhoud(zoek, zcs), fs: parseFloat(zcs.fontSize) },
            sel: { opties, ruimte: inhoud(sel, scs), fs: parseFloat(scs.fontSize), padR: parseFloat(scs.paddingRight) },
            tellerTekst: teller.textContent.trim(), tellerZichtbaar: tr.width > 0 && tr.height > 0 && tr.right <= window.innerWidth && tr.left >= 0,
            zoekBoven: zr.bottom <= sr.top + 1, zoekVol: zr.width,
            tellerOpRijVanSelect: Math.abs((tr.top + tr.height / 2) - (sr.top + sr.height / 2)) < 6,
            doc: document.documentElement.scrollWidth, venster: window.innerWidth,
          };
        });
        // hulptekst volledig, en het woord "onderwerp" blijft erin
        expect(m.hulp.tekst).toContain('onderwerp');
        expect(m.hulp.fs).toBeGreaterThanOrEqual(16);
        // Veiligheidsmarge: startApp stubt Google Fonts leeg, dus hier meet de test met het terugvallettertype (system-ui), niet met Figtree.
        // Eenmalig gemeten met het echte Figtree (taak 14, fix 1; zie task-14-report.md): hulptekst 305,7 px tegen 306,7 px terugval (verhouding
        // 0,997) en sorteerlabels tot 1,044 keer de terugvalbreedte. Daarom: hulptekst met 3 % marge (echte Figtree kan 3 % breder zijn dan nu
        // gemeten en past nog), sorteerlabels met 10 % marge (ruim boven 1,044, en ze hebben veel ruimte).
        expect(m.hulp.breedte * HULP_MARGE, `hulptekst "${m.hulp.tekst}" past niet (met ${Math.round((HULP_MARGE - 1) * 100)} % marge) in het zoekvak`).toBeLessThanOrEqual(m.hulp.ruimte);
        // elke sorteeroptie past volledig wanneer ze gekozen is (in de ruimte naast de pijl)
        expect(m.sel.fs).toBeGreaterThanOrEqual(16);
        for (const o of m.sel.opties) expect(o.breedte * SORTEER_MARGE, `sorteerlabel "${o.tekst}" past niet (met ${Math.round((SORTEER_MARGE - 1) * 100)} % marge)`).toBeLessThanOrEqual(m.sel.ruimte);
        // zoekvak op een eigen rij boven de sorteerkeuze; aantal blijft zichtbaar, naast de sorteerkeuze
        expect(m.zoekBoven).toBe(true);
        expect(m.zoekVol).toBeGreaterThan(breedte * 0.8);
        expect(m.tellerTekst).toMatch(/\d/);
        expect(m.tellerZichtbaar).toBe(true);
        expect(m.tellerOpRijVanSelect).toBe(true);
        expect(m.doc).toBeLessThanOrEqual(m.venster);
      });
    }
  }

  test('wachtrij-balk op tablet 768x1024: zoeken, sorteren en aantal blijven op één rij, zoals voor taak 14', async ({ page }) => {
    await zetWeergave(page, 'tablet');
    await startApp(page, { viewport: { width: 768, height: 1024 } });
    await expect(page.locator('html')).toHaveAttribute('data-apparaat', 'tablet');
    const [z, s, t] = await Promise.all([page.locator('#wq-zoek').boundingBox(), page.locator('#wq-sorteer').boundingBox(), page.locator('#wq-teller').boundingBox()]);
    for (const d of [s, t]) expect(Math.abs((d.y + d.height / 2) - (z.y + z.height / 2))).toBeLessThan(6);
    expect(s.x).toBeGreaterThan(z.x + z.width - 1);
    expect(t.x).toBeGreaterThan(s.x + s.width - 1);
    // het zoekvak is geen volle rij en behoudt hoogte, lettergrootte en de zijmarge van de balk (max(14px, (100% - 740px) / 2 + 14px) = 28px op 768 px)
    expect(z.width).toBeLessThan(768 * 0.8);
    const cs = await page.evaluate(() => {
      const zc = getComputedStyle(document.getElementById('wq-zoek')), sc = getComputedStyle(document.getElementById('wq-sorteer')), bc = getComputedStyle(document.querySelector('#view-tickets .wq-toolbar'));
      return { h: parseFloat(zc.height), fs: zc.fontSize, padZ: zc.paddingLeft, sfs: sc.fontSize, padB: bc.paddingLeft };
    });
    expect(cs).toEqual({ h: 36, fs: '14px', padZ: '16px', sfs: '14px', padB: '28px' });
  });

  test('wachtrij-balk op pc 1366x768: zoeken, sorteren en aantal blijven op één rij', async ({ page }) => {
    await startApp(page, { viewport: PC });
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'kolom');
    const [z, s, t] = await Promise.all([page.locator('#wq-zoek').boundingBox(), page.locator('#wq-sorteer').boundingBox(), page.locator('#wq-teller').boundingBox()]);
    for (const d of [s, t]) expect(Math.abs((d.y + d.height / 2) - (z.y + z.height / 2))).toBeLessThan(6);
    expect(s.x).toBeGreaterThan(z.x + z.width - 1);
    expect(t.x).toBeGreaterThan(s.x + s.width - 1);
    // het zoekvak behoudt zijn pc-hoogte en lettergrootte
    const cs = await page.locator('#wq-zoek').evaluate((el) => { const c = getComputedStyle(el); return { h: el.getBoundingClientRect().height, fs: c.fontSize }; });
    expect(cs.h).toBe(36);
    expect(cs.fs).toBe('14px');
  });
});
