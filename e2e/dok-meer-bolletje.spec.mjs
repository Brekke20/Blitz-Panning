import { test, expect, startApp, kiesHoofdtab } from './helpers.mjs';

// Open dag, taak 18 (Brent, 2026-10-28): heeft een tabblad achter "Meer" een zichtbare teller, dan krijgt de knop "Meer" een bolletje:
// rood bij voorraad die op is (badge--op), oranje bij bijna op (badge--bijna), anders de gewone tellerkleur. Het bolletje volgt live mee.
// Achter Meer staat Inventaris enkel als Route in het dok meedoet: een smal computervenster of een met de hand gekozen tablet. Op een echte gsm
// (en dus ook een staande tablet op automatisch) staat Inventaris zelf in het dok, met de eigen teller.

const SMAL_VENSTER = { width: 375, height: 812 }; // computerweergave in een smal venster: nav 'dok', Route zichtbaar
const GSM = { width: 375, height: 812 };
const TABLET = { width: 768, height: 1024 };
const PC = { width: 1366, height: 768 };

const zetWeergave = (page, w) => page.addInitScript((x) => { if (window === window.top) localStorage.setItem('blitz_weergave', x); }, w);
const OP = { Tim: { 'meter-sdm54-m': { aantal: 1, gedempt: false, drempel: 2 }, 'meter-sdm72d-m': { aantal: 0, gedempt: false, drempel: 0 } } };
const BIJNA = { Tim: { 'meter-sdm54-m': { aantal: 1, gedempt: false, drempel: 2 } } };
const OK = { Tim: { 'meter-sdm54-m': { aantal: 5, gedempt: false, drempel: 2 } } };
const meer = (page) => page.locator('.dok-meer');
const bolletje = (page) => page.locator('.dok-meer .dok-meer-bolletje');
const kleurVan = (page, v) => page.evaluate((naam) => {
  const probe = document.createElement('i'); probe.style.color = `var(${naam})`; document.body.append(probe);
  const c = getComputedStyle(probe).color; probe.remove(); return c;
}, v);
const bolKleur = (page) => bolletje(page).evaluate(el => getComputedStyle(el).backgroundColor);

// Een veranderlijke voorraad: de test past hem aan en laat de app opnieuw lezen (via de tab Inventaris, die hij zelf vernieuwt).
function stelIn(start, log = []) {
  const stand = { wagenvoorraad: start, log };
  const stub = () => ({ status: 200, json: { versie: 3, wagenvoorraad: stand.wagenvoorraad, log: stand.log } });
  return { stand, stub };
}

test.describe('bolletje op "Meer"', () => {
  test('rood bij voorraad die op is; verdwijnt als de voorraad is aangevuld', async ({ page }) => {
    const { stand, stub } = stelIn(OP);
    await zetWeergave(page, 'computer');
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: SMAL_VENSTER, overschrijf: { inventaris: stub } });
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'dok');
    await expect(meer(page)).toBeVisible();
    // Inventaris staat nu achter Meer, met een rode teller
    await expect(page.locator('#tab-inventaris')).toHaveClass(/tab--in-meer/);
    await expect(page.locator('#cnt-inventaris')).toHaveClass(/badge--op/);
    await expect(bolletje(page)).toBeVisible();
    await expect(bolletje(page)).toHaveAttribute('data-kleur', 'op');
    expect(await bolKleur(page)).toBe(await kleurVan(page, '--red'));
    await expect(meer(page)).toHaveAttribute('aria-label', 'Meer, voorraad op');
    await expect(page.getByRole('button', { name: 'Meer, voorraad op' })).toBeVisible();
    // het bolletje heeft geen cijfer en is voor hulpmiddelen verborgen (de label staat op de knop)
    await expect(bolletje(page)).toHaveText('');
    await expect(bolletje(page)).toHaveAttribute('aria-hidden', 'true');

    // aanvullen: Inventaris lezen vernieuwt de teller, het bolletje volgt
    stand.wagenvoorraad = OK;
    await kiesHoofdtab(page, /Inventaris/);
    await expect(page.locator('#cnt-inventaris')).toBeHidden();
    await expect(bolletje(page)).toBeHidden();
    await expect(meer(page)).not.toHaveAttribute('aria-label', /.+/);
    await expect(meer(page)).toHaveClass(/\bactief\b/);
  });

  test('oranje bij bijna op, en rood zodra er ook iets op is', async ({ page }) => {
    const { stand, stub } = stelIn(BIJNA);
    await zetWeergave(page, 'computer');
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: SMAL_VENSTER, overschrijf: { inventaris: stub } });
    await expect(page.locator('#cnt-inventaris')).toHaveClass(/badge--bijna/);
    await expect(bolletje(page)).toHaveAttribute('data-kleur', 'bijna');
    expect(await bolKleur(page)).toBe(await kleurVan(page, '--orange'));
    await expect(meer(page)).toHaveAttribute('aria-label', 'Meer, voorraad bijna op');

    stand.wagenvoorraad = OP;
    await kiesHoofdtab(page, /Inventaris/);
    await expect(bolletje(page)).toHaveAttribute('data-kleur', 'op');
    await expect(meer(page)).toHaveAttribute('aria-label', 'Meer, voorraad op');
  });

  test('een gewone teller (openstaande aanvullingen) geeft het bolletje in de tellerkleur', async ({ page }) => {
    const log = [{ id: 'a1', type: 'aanvulling', status: 'nieuw', technieker: 'Tim', datum: '2026-10-08T08:00:00Z', onderdelen: {} }];
    await zetWeergave(page, 'computer');
    await startApp(page, { loginRol: 'beheerder', technieker: 'all', viewport: SMAL_VENSTER, overschrijf: { inventaris: stelIn({}, log).stub } });
    await expect(page.locator('#cnt-inventaris')).toHaveText('1');
    await expect(page.locator('#cnt-inventaris')).not.toHaveClass(/badge--(op|bijna)/);
    await expect(bolletje(page)).toHaveAttribute('data-kleur', 'gewoon');
    expect(await bolKleur(page)).toBe(await kleurVan(page, '--green')); // taak 19: de gewone kleur is --green (een thema zet --accent op een eigen kleur)
    await expect(meer(page)).toHaveAttribute('aria-label', 'Meer, nieuwe meldingen');
  });

  test('geen tellers achter Meer: geen bolletje (gsm: Inventaris staat zelf in het dok)', async ({ page }) => {
    await zetWeergave(page, 'gsm');
    await startApp(page, { loginRol: 'planner', technieker: 'Tim', viewport: GSM, overschrijf: { inventaris: stelIn(OP).stub } });
    await expect(meer(page)).toBeVisible();
    await expect(page.locator('#tab-inventaris')).not.toHaveClass(/tab--in-meer/);
    await expect(page.locator('#cnt-inventaris')).toHaveClass(/badge--op/); // de teller staat op de tabknop zelf, zoals voorheen
    await expect(bolletje(page)).toBeHidden();
    await expect(meer(page)).not.toHaveAttribute('aria-label', /.+/);
  });

  test('een nul-teller achter Meer geeft geen bolletje', async ({ page }) => {
    await zetWeergave(page, 'computer');
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: SMAL_VENSTER, overschrijf: { inventaris: stelIn({}).stub } });
    await expect(page.locator('#tab-inventaris')).toHaveClass(/tab--in-meer/);
    await expect(bolletje(page)).toBeHidden();
  });

  test('volgt live mee: een tellerwijziging, een breedtewissel en terug naar de pc', async ({ page }) => {
    await zetWeergave(page, 'computer');
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: PC, overschrijf: { inventaris: stelIn(OP).stub } });
    // pc: geen Meer en geen zichtbaar bolletje, de zijkolom is ongewijzigd
    await expect(meer(page)).toBeHidden();
    await expect(bolletje(page)).toBeHidden();
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'kolom');
    await expect(page.locator('.tab--in-meer')).toHaveCount(0);
    await expect(page.locator('#cnt-inventaris')).toBeVisible();

    await page.setViewportSize(SMAL_VENSTER);
    await expect(bolletje(page)).toBeVisible();
    await expect(bolletje(page)).toHaveAttribute('data-kleur', 'op');

    // een tellerwijziging achter Meer (klasse en tekst, zoals updateInventarisBadge ze zet) verkleurt het bolletje
    await page.evaluate(() => { const el = document.getElementById('cnt-inventaris'); el.classList.remove('badge--op'); el.classList.add('badge--bijna'); el.textContent = '1'; });
    await expect(bolletje(page)).toHaveAttribute('data-kleur', 'bijna');
    await page.evaluate(() => { document.getElementById('cnt-inventaris').style.display = 'none'; });
    await expect(bolletje(page)).toBeHidden();
    await page.evaluate(() => { document.getElementById('cnt-inventaris').style.display = ''; });
    await expect(bolletje(page)).toBeVisible();

    await page.setViewportSize(PC);
    await expect(meer(page)).toBeHidden();
    await expect(bolletje(page)).toBeHidden();
    await expect(page.locator('.tab--in-meer')).toHaveCount(0);
  });

  test('het bolletje zit rechtsboven aan het icoon en blijft binnen de knop; Meer opent nog altijd het blad', async ({ page }) => {
    await zetWeergave(page, 'computer');
    await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: SMAL_VENSTER, overschrijf: { inventaris: stelIn(OP).stub } });
    const maat = await page.evaluate(() => {
      const k = document.querySelector('.dok-meer').getBoundingClientRect();
      const b = document.querySelector('.dok-meer-bolletje').getBoundingClientRect();
      const i = document.querySelector('.dok-meer .tab-icoon').getBoundingClientRect();
      return { k, b, i, schuif: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(maat.b.left).toBeGreaterThanOrEqual(maat.k.left);
    expect(maat.b.right).toBeLessThanOrEqual(maat.k.right);
    expect(maat.b.top).toBeGreaterThanOrEqual(maat.k.top);
    expect(maat.b.width).toBeLessThanOrEqual(12);
    expect(maat.b.left).toBeGreaterThanOrEqual(maat.i.left + maat.i.width / 2); // rechtsboven aan het icoon
    expect(maat.schuif).toBeLessThanOrEqual(0);
    await meer(page).click();
    await expect(page.locator('.dok-meer-overlay')).toHaveClass(/open/);
    await expect(page.locator('.dok-meer-blad .badge')).toHaveText('2'); // het cijfer blijft in het blad
  });

  test.describe('staande tablet (met de hand gekozen: Route doet mee)', () => {
    test.use({ viewport: TABLET, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('ook op een tablet rechtop: rood bolletje op Meer', async ({ page }) => {
      await zetWeergave(page, 'tablet');
      await startApp(page, { loginRol: 'beheerder', technieker: 'Tim', viewport: TABLET, overschrijf: { inventaris: stelIn(OP).stub } });
      await expect(page.locator('html')).toHaveAttribute('data-indeling', 'tablet-staand');
      await expect(page.locator('html')).toHaveAttribute('data-nav', 'dok');
      await expect(meer(page)).toBeVisible();
      await expect(bolletje(page)).toHaveAttribute('data-kleur', 'op');
      await expect(meer(page)).toHaveAttribute('aria-label', 'Meer, voorraad op');
    });
  });
});
