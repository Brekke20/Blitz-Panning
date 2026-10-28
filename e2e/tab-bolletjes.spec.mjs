import { test, expect, startApp } from './helpers.mjs';

// Open dag, taak 19 (Brent, 2026-10-28): de tellers van de tabbladen tonen geen cijfer meer maar een bolletje, overal (zijkolom, dok en het
// blad "Meer"). Rood bij voorraad die op is (badge--op), oranje bij bijna op (badge--bijna), anders het groen van het accent (--green: een thema zet --accent op een eigen kleur). Het cijfer blijft in de DOM
// (textContent) en voor schermlezers staat het in de aria-label van de tab. Een teller van 0 of een verborgen teller geeft geen bolletje.

const PC = { width: 1366, height: 768 };
const GSM = { width: 375, height: 812 };
const SMAL_VENSTER = { width: 375, height: 812 }; // computerweergave in een smal venster: nav 'dok', Inventaris achter Meer

const zetWeergave = (page, w) => page.addInitScript((x) => { if (window === window.top) localStorage.setItem('blitz_weergave', x); }, w);
const OP = { Tim: { 'meter-sdm54-m': { aantal: 1, gedempt: false, drempel: 2 }, 'meter-sdm72d-m': { aantal: 0, gedempt: false, drempel: 0 } } };
const BIJNA = { Tim: { 'meter-sdm54-m': { aantal: 1, gedempt: false, drempel: 2 } } };
const voorraad = (wagenvoorraad) => () => ({ status: 200, json: { versie: 3, wagenvoorraad, log: [] } });

const kleurVan = (page, v) => page.evaluate((naam) => {
  const probe = document.createElement('i'); probe.style.color = `var(${naam})`; document.body.append(probe);
  const c = getComputedStyle(probe).color; probe.remove(); return c;
}, v);

// Alles wat een bolletje moet zijn: maat, vorm, kleur en de zichtbaarheid van het cijfer.
const meet = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const tekst = document.createRange(); tekst.selectNodeContents(el);
  const kleur = cs.color; // transparant = onzichtbaar cijfer
  return {
    w: r.width, h: r.height, display: cs.display, bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius),
    tekstBreedte: tekst.getBoundingClientRect().width,
    tekstTransparant: kleur === 'rgba(0, 0, 0, 0)' || kleur === 'transparent',
    fontSize: cs.fontSize, inhoud: el.textContent.trim(),
  };
});
const isBolletje = (m) => {
  expect(m.w, 'breed').toBeGreaterThan(0);
  expect(m.w).toBeLessThanOrEqual(10);
  expect(Math.abs(m.w - m.h), 'rond: breedte gelijk aan hoogte').toBeLessThan(0.5);
  expect(m.radius).toBeGreaterThanOrEqual(m.w / 2);
  expect(m.tekstBreedte === 0 || m.tekstTransparant, 'geen zichtbaar cijfer').toBe(true);
};

test.describe('tellers van de tabbladen zijn een bolletje zonder cijfer', () => {
  test('pc (zijkolom): Wachtrij en Ingepland tonen een groen bolletje; het cijfer blijft in de DOM', async ({ page }) => {
    await startApp(page, { loginRol: 'planner', technieker: 'Tim', viewport: PC });
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'kolom');
    for (const id of ['cnt-tickets', 'cnt-gepland']) {
      const el = page.locator('#' + id);
      await expect(el).toBeVisible();
      const m = await meet(el);
      isBolletje(m);
      expect(m.inhoud).toMatch(/^[1-9]\d*$/);
      expect(m.bg).toBe(await kleurVan(page, '--green'));
    }
    // het bolletje staat rechts in de tab (zijkolom), binnen de tab
    const pos = await page.evaluate(() => {
      const t = document.getElementById('tab-tickets').getBoundingClientRect();
      const b = document.getElementById('cnt-tickets').getBoundingClientRect();
      return { tr: t.right, br: b.right, tl: t.left, bl: b.left };
    });
    expect(pos.br).toBeLessThanOrEqual(pos.tr);
    expect(pos.bl).toBeGreaterThan(pos.tl + 60);
  });

  test('pc: rood bij voorraad die op is, oranje bij bijna op, ook op het actieve tabblad', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: PC, overschrijf: { inventaris: voorraad(OP) } });
    const el = page.locator('#cnt-inventaris');
    await expect(el).toHaveClass(/badge--op/);
    isBolletje(await meet(el));
    expect((await meet(el)).bg).toBe(await kleurVan(page, '--red'));
    // op het actieve tabblad blijft het bolletje goed te zien (taak 9 gaf het een donker chipje; nu is het een gewoon rood bolletje)
    await page.locator('#tab-inventaris').click();
    await expect(page.locator('#tab-inventaris')).toHaveClass(/active/);
    const actief = await meet(el);
    isBolletje(actief);
    expect(actief.bg).toBe(await kleurVan(page, '--red'));

    await page.locator('#tab-tickets').click();
    await page.evaluate(() => { const e = document.getElementById('cnt-inventaris'); e.classList.remove('badge--op'); e.classList.add('badge--bijna'); e.textContent = '1'; });
    expect((await meet(el)).bg).toBe(await kleurVan(page, '--orange'));
  });

  test('gsm (dok): bolletje rechtsboven aan het icoon, zelfde maat en kleuren', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { loginRol: 'planner', technieker: 'Tim', viewport: GSM, overschrijf: { inventaris: voorraad(BIJNA) } });
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'dok');
    const tickets = page.locator('#cnt-tickets');
    isBolletje(await meet(tickets));
    expect((await meet(tickets)).bg).toBe(await kleurVan(page, '--green'));
    const inv = page.locator('#cnt-inventaris');
    await expect(inv).toHaveClass(/badge--bijna/);
    isBolletje(await meet(inv));
    expect((await meet(inv)).bg).toBe(await kleurVan(page, '--orange'));
    const pos = await page.evaluate(() => {
      const t = document.getElementById('tab-tickets').getBoundingClientRect();
      const b = document.getElementById('cnt-tickets').getBoundingClientRect();
      const i = document.querySelector('#tab-tickets .tab-icoon').getBoundingClientRect();
      return { t, b, i };
    });
    expect(pos.b.left).toBeGreaterThanOrEqual(pos.t.left);
    expect(pos.b.right).toBeLessThanOrEqual(pos.t.right);
    expect(pos.b.top).toBeGreaterThanOrEqual(pos.t.top);
    expect(pos.b.left).toBeGreaterThanOrEqual(pos.i.left + pos.i.width / 2);
  });

  test('"Meer" en de tabbladen hebben hetzelfde bolletje; in het blad ook', async ({ page }) => {
    await zetWeergave(page, 'computer');
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: SMAL_VENSTER, overschrijf: { inventaris: voorraad(OP) } });
    await expect(page.locator('#tab-inventaris')).toHaveClass(/tab--in-meer/);
    const meer = await meet(page.locator('.dok-meer .dok-meer-bolletje'));
    const tab = await meet(page.locator('#cnt-tickets'));
    isBolletje(meer);
    isBolletje(tab);
    expect(meer.w).toBe(tab.w);
    expect(meer.h).toBe(tab.h);
    expect(meer.radius).toBe(tab.radius);
    expect(meer.bg).toBe(await kleurVan(page, '--red'));
    // positie: Meer en een gewone dok-tab hangen het bolletje op dezelfde plek aan het icoon
    const plek = await page.evaluate(() => {
      const rel = (b, k) => ({ x: b.left - (k.left + k.width / 2), y: b.top - k.top }); // t.o.v. het midden van de knop (waar het icoon staat)
      const mk = document.querySelector('.dok-meer').getBoundingClientRect();
      const mb = document.querySelector('.dok-meer-bolletje').getBoundingClientRect();
      const tk = document.getElementById('tab-tickets').getBoundingClientRect();
      const tb = document.getElementById('cnt-tickets').getBoundingClientRect();
      return { meer: rel(mb, mk), tab: rel(tb, tk) };
    });
    expect(plek.meer.y).toBeCloseTo(plek.tab.y, 0);
    expect(plek.meer.x).toBeCloseTo(plek.tab.x, 0);

    await page.locator('.dok-meer').click();
    const inBlad = page.locator('.dok-meer-blad .badge');
    await expect(inBlad).toHaveCount(1);
    isBolletje(await meet(inBlad));
    expect((await meet(inBlad)).bg).toBe(await kleurVan(page, '--red'));
    await expect(inBlad).toHaveText('2'); // het cijfer blijft in de DOM
  });

  test('een teller van 0 of een verborgen teller geeft geen bolletje', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: PC, overschrijf: { inventaris: voorraad({}) } });
    await expect(page.locator('#cnt-inventaris')).toBeHidden(); // verborgen teller (display:none, zoals voorheen)
    await expect(page.locator('#cnt-tickets')).toBeVisible();
    // de teller springt naar 0: het bolletje verdwijnt, het cijfer blijft in de DOM; weer groter dan 0: het bolletje komt terug
    await page.evaluate(() => { document.getElementById('cnt-gepland').textContent = '0'; });
    await expect(page.locator('#cnt-gepland')).toBeHidden();
    await expect(page.locator('#cnt-gepland')).toHaveText('0');
    await page.evaluate(() => { document.getElementById('cnt-gepland').textContent = '4'; });
    await expect(page.locator('#cnt-gepland')).toBeVisible();
    isBolletje(await meet(page.locator('#cnt-gepland')));
  });

  test('schermlezers: de tab zegt wat het bolletje betekent (aria-label), en een nul laat de gewone naam staan', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: PC, overschrijf: { inventaris: voorraad(OP) } });
    await expect(page.locator('#tab-inventaris')).toHaveAttribute('aria-label', 'Inventaris, voorraad op');
    const n = await page.locator('#cnt-tickets').textContent();
    await expect(page.locator('#tab-tickets')).toHaveAttribute('aria-label', `Wachtrij, ${n} nieuw`);
    await page.evaluate(() => {
      const e = document.getElementById('cnt-inventaris'); e.classList.remove('badge--op'); e.classList.add('badge--bijna');
      document.getElementById('cnt-tickets').textContent = '0';
    });
    await expect(page.locator('#tab-inventaris')).toHaveAttribute('aria-label', 'Inventaris, voorraad bijna op');
    await expect(page.locator('#tab-tickets')).not.toHaveAttribute('aria-label', /.+/);
  });
});
