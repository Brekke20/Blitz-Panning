import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { test, expect, startApp, snelTikken, metStilstaandeKlok, spelLogo } from './helpers.mjs';
import { WERELD, SPELER } from '../public/js/spel/spel-logica.js';
import { startSalesApp, SALES_GEBRUIKER, BEHEERDER } from './sales-hulp.mjs';

const THEMAS_MAP = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'netlify', 'themas');
const pakket = (id) => JSON.parse(fs.readFileSync(path.join(THEMAS_MAP, `${id}.blitzthema.json`), 'utf8'));

// Een /api/themas-stub met Halloween (loopt: de app-klok staat op 5 oktober) en Kerst (ver weg: niet in `pakketten`, enkel via ?id=).
// `opgehaald` onthoudt elke ?id=-aanvraag.
function themasMetKerst() {
  const h = pakket('halloween');
  const k = pakket('kerst');
  const opgehaald = [];
  const rij = (p) => ({ id: p.id, naam: p.naam, aan: true, periode: p.periode, periodeOverride: null, pakketHash: `e2e-${p.id}` });
  const stub = ({ query }) => {
    const id = query.get('id');
    if (id !== null) {
      opgehaald.push(id);
      return { status: 200, json: structuredClone(id === 'kerst' ? k : id === 'halloween' ? h : {}) };
    }
    return { status: 200, json: { versie: 1, themas: [rij(h), rij(k)], pakketten: { halloween: structuredClone(h) } } };
  };
  stub.opgehaald = opgehaald;
  return stub;
}

// Blitz Run (verborgen spel): 5× snel tikken op het logo-icoon opent het overlay, 5× tikken / ✕ / Escape sluit het, het toetsenbord
// speelt, en het spel verstuurt nooit iets buiten /api/spel. In ?test; de klok is een nepklok (page.clock).

const titel = (page) => spelLogo(page); // Open dag (taak 7): op `breed` het logo in de zijkolom (kop-logo verborgen), zie helpers.mjs
const overlay = (page) => page.locator('#spel-overlay');
const tikVijf = (page) => snelTikken(page, titel(page)); // stilstaande nepklok tijdens het tikken (zie helpers.mjs)
const status = (page) => overlay(page).getAttribute('data-status');
const score = async (page) => Number((await overlay(page).getAttribute('data-score')) ?? 0);
const canvasBeeld = (page) => page.locator('#spel-overlay canvas').evaluate((c) => c.toDataURL());

async function openSpel(page) {
  await tikVijf(page);
  await expect(overlay(page)).toHaveClass(/open/);
  await expect(overlay(page)).toHaveAttribute('data-status', 'start');
}

test.describe('Blitz Run', () => {
  test('vier tikken openen niets, vijf wel; het logo doet verder niets en het spel wordt pas dan geladen', async ({ page, verzoeken }) => {
    await startApp(page);
    const modules = [];
    page.on('request', (r) => { if (r.url().includes('/js/spel/spel-ui.js')) modules.push(r.url()); });
    await metStilstaandeKlok(page, async () => { // de vijfde tik telt mee, ook al kijken we tussendoor
      for (let i = 0; i < 4; i++) await titel(page).click();
      await expect(overlay(page)).toHaveCount(0);
      expect(modules).toEqual([]);
      await titel(page).click();
      await expect(overlay(page)).toHaveClass(/open/);
    });
    expect(modules).toHaveLength(1);
    expect(verzoeken.onverwacht).toEqual([]);
  });

  test('niet snel genoeg tikken opent niets', async ({ page }) => {
    await startApp(page);
    for (let i = 0; i < 5; i++) { await titel(page).click(); await page.clock.runFor(700); }
    await expect(overlay(page)).toHaveCount(0);
  });

  test('sluiten kan met vijf tikken op het logo, met ✕ en met Escape; opnieuw openen werkt telkens', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
    await tikVijf(page); // de kop met het logo blijft boven het overlay bereikbaar
    await expect(overlay(page)).not.toHaveClass(/open/);
    await openSpel(page);
    await page.getByRole('button', { name: 'Sluiten' }).filter({ has: page.locator(':scope') }).first().click({ trial: true }).catch(() => {});
    await overlay(page).getByRole('button', { name: 'Sluiten' }).click();
    await expect(overlay(page)).not.toHaveClass(/open/);
    await openSpel(page);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveClass(/open/);
  });

  test('startscherm: beste score en een skinkeuze; een vergrendelde skin toont zijn voorwaarde en kan niet gekozen worden', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
    await expect(overlay(page).locator('.spel-beste')).toHaveText('Beste score: 0');
    const knoppen = overlay(page).locator('.spel-skin');
    expect(await knoppen.count()).toBeGreaterThan(0);
    await expect(overlay(page).locator('.spel-skin[aria-pressed="true"]')).toHaveCount(1);
    const vergrendeld = overlay(page).locator('.spel-skin[disabled]');
    expect(await vergrendeld.count()).toBeGreaterThan(0);
    await expect(vergrendeld.first().locator('small')).toHaveText(/^(vanaf \d+ punten|.+-thema)$/);
  });

  test('themaskins uit de pakketten: elk thema uit de index staat vergrendeld in de keuzerij als "<Naam>-thema"; het pakket van een ver thema wordt eenmalig opgehaald', async ({ page, verzoeken }) => {
    const themas = themasMetKerst();
    await startApp(page, { overschrijf: { themas } });
    await openSpel(page);
    const kerst = overlay(page).locator('.spel-skin[data-skin="kerst"]');
    await expect(kerst).toBeDisabled();
    await expect(kerst.locator('small')).toHaveText('Kerst-thema');
    await expect(kerst).toHaveAttribute('data-soort', 'thema');
    const halloween = overlay(page).locator('.spel-skin[data-skin="halloween"]');
    await expect(halloween).toBeDisabled(); // de stub ontgrendelt niets: ook een lopend thema is vergrendeld
    await expect(halloween.locator('small')).toHaveText('Halloween-thema');
    await expect(kerst.locator('span')).toHaveText('Kerstpaal');
    expect(themas.opgehaald).toEqual(['kerst']);
    // Het spel sluiten en opnieuw openen haalt niets opnieuw op, en het spel schreef niets buiten /api/spel.
    await page.keyboard.press('Escape');
    await openSpel(page);
    expect(themas.opgehaald).toEqual(['kerst']);
    expect(verzoeken.alle.filter(r => r.methode !== 'GET' && r.pad !== '/api/spel')).toEqual([]);
  });

  test('een ontgrendelde themaskin is kiesbaar en tekent zijn extra (de heksenhoed staat boven de paal)', async ({ page }) => {
    let voortgang = { besteScore: 0, ontgrendeld: ['blitz', 'halloween'], gekozenSkin: 'halloween' };
    const spel = ({ methode, body }) => {
      if (methode === 'POST') voortgang = { ...voortgang, besteScore: Math.max(voortgang.besteScore, body?.score ?? 0), gekozenSkin: body?.gekozenSkin ?? voortgang.gekozenSkin };
      return { status: 200, json: voortgang };
    };
    await startApp(page, { overschrijf: { themas: themasMetKerst(), spel } });
    await openSpel(page);
    const halloween = overlay(page).locator('.spel-skin[data-skin="halloween"]');
    await expect(halloween).toBeEnabled();
    await expect(halloween).toHaveAttribute('aria-pressed', 'true');
    await expect(halloween.locator('small')).toHaveText('gekozen');
    // Midden boven de paal: de oranje band van de hoed (#ff7a00). In de beginstand staat de paal stil op de grond.
    const pixel = (px, py) => overlay(page).locator('canvas').evaluate((c, [x, y]) => {
      const schaal = c.width / 600;
      return Array.from(c.getContext('2d').getImageData(Math.round(x * schaal), Math.round(y * schaal), 1, 1).data);
    }, [px, py]);
    const top = WERELD.grondY - SPELER.staan.h;
    await expect.poll(() => pixel(SPELER.x + SPELER.staan.b / 2, top - 0.09 * SPELER.staan.h)).toEqual([255, 122, 0, 255]);
    // Met de standaardskin staat daar enkel nachthemel.
    await overlay(page).locator('.spel-skin[data-skin="blitz"]').click();
    await expect.poll(async () => (await pixel(SPELER.x + SPELER.staan.b / 2, top - 0.09 * SPELER.staan.h)).join(',')).not.toBe('255,122,0,255');
  });

  test('het toetsenbord speelt: spatie start, de score loopt en het canvas verandert; zonder te springen is het spel uit', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
    const voor = await canvasBeeld(page);
    await page.keyboard.press('Space');
    await expect(overlay(page)).toHaveAttribute('data-status', 'bezig');
    await page.clock.runFor(1000);
    await page.clock.runFor(1000);
    const midden = await canvasBeeld(page);
    expect(midden).not.toBe(voor);
    expect(await score(page)).toBeGreaterThan(0);
    // Springen en bukken (ingehouden) breken het spel niet.
    await page.keyboard.press('ArrowUp');
    await page.clock.runFor(300);
    await page.keyboard.down('ArrowDown');
    await page.clock.runFor(300);
    await page.keyboard.up('ArrowDown');
    expect(await canvasBeeld(page)).not.toBe(midden);
    // Zonder in te grijpen botst de zuil op de eerste jerrycan: eindscherm met "Opnieuw".
    await expect.poll(async () => { await page.clock.runFor(1000); return status(page); }, { timeout: 15000, intervals: [20] }).toBe('af');
    await expect(overlay(page).locator('[data-actie="spel-start"]')).toHaveText('Opnieuw');
    // Spatie start opnieuw.
    await page.keyboard.press('Space');
    await expect(overlay(page)).toHaveAttribute('data-status', 'bezig');
  });

  test('de score van een spelletje gaat naar /api/spel (en enkel daar); het startscherm toont daarna de beste score', async ({ page, verzoeken }) => {
    await startApp(page);
    const voor = verzoeken.alle.length;
    await openSpel(page);
    await page.keyboard.press('Space');
    await expect.poll(async () => { await page.clock.runFor(1000); return status(page); }, { timeout: 15000, intervals: [20] }).toBe('af');
    await expect.poll(() => verzoeken.van('/api/spel', 'POST').length).toBe(1);
    const post = verzoeken.van('/api/spel', 'POST')[0];
    expect(post.body.score).toBeGreaterThan(0);
    expect(typeof post.body.gekozenSkin).toBe('string');
    await expect(overlay(page).locator('.spel-beste')).toHaveText(`Beste score: ${post.body.score}`);
    // Alles wat het spel verstuurde, ging naar /api/spel; geen enkel schrijfverzoek elders.
    const nieuw = verzoeken.alle.slice(voor);
    expect(nieuw.length).toBeGreaterThan(0);
    expect(nieuw.filter(r => r.pad !== '/api/spel').map(r => `${r.methode} ${r.pad}`).filter(x => !x.startsWith('GET '))).toEqual([]);
    expect([...new Set(nieuw.filter(r => r.methode !== 'GET').map(r => r.pad))]).toEqual(['/api/spel']);
  });

  test('sluiten stopt het spel: de score loopt niet meer door en er wordt niets meer verstuurd', async ({ page, verzoeken }) => {
    await startApp(page);
    await openSpel(page);
    await page.keyboard.press('Space');
    await page.clock.runFor(500);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveClass(/open/);
    const s = await score(page);
    const aantal = verzoeken.alle.length;
    await page.clock.runFor(10000);
    expect(await score(page)).toBe(s);
    expect(verzoeken.alle.length).toBe(aantal);
    expect(verzoeken.van('/api/spel', 'POST')).toHaveLength(0);
    // Toetsen doen buiten het overlay niets met het spel.
    await page.keyboard.press('Space');
    expect(await score(page)).toBe(s);
  });

  test('een verborgen tab pauzeert het spel; "Verder" gaat door', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
    await page.keyboard.press('Space');
    await page.clock.runFor(300);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(overlay(page)).toHaveAttribute('data-status', 'pauze');
    const s = await score(page);
    await page.clock.runFor(3000);
    expect(await score(page)).toBe(s);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
    await overlay(page).locator('[data-actie="spel-start"]').click();
    await expect(overlay(page)).toHaveAttribute('data-status', 'bezig');
    await page.clock.runFor(500);
    expect(await score(page)).toBeGreaterThan(s);
  });

  test('muis op het canvas: een klik springt; ingedrukt houden onderaan bukt niet (geen fout, spel loopt door)', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
    await page.keyboard.press('Space');
    await page.clock.runFor(200);
    const doos = await page.locator('#spel-overlay canvas').boundingBox();
    const voor = await canvasBeeld(page);
    await page.mouse.click(doos.x + doos.width / 2, doos.y + doos.height * 0.2);
    await page.clock.runFor(150);
    const gesprongen = await canvasBeeld(page);
    expect(gesprongen).not.toBe(voor);
    await page.mouse.move(doos.x + doos.width / 2, doos.y + doos.height * 0.8);
    await page.mouse.down();
    await page.clock.runFor(150);
    await page.mouse.up();
    await expect(overlay(page)).toHaveAttribute('data-status', 'bezig');
  });

  test('prefers-reduced-motion: het spel blijft speelbaar', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startApp(page);
    await openSpel(page);
    await page.keyboard.press('Space');
    await page.clock.runFor(1000);
    expect(await score(page)).toBeGreaterThan(0);
  });

  // Een verkoper start niet via `opstart()` maar via `sales-start.js` (rol-schil.js): het spel moet daar ook open kunnen.
  for (const [naam, gebruiker] of [['een verkoper', SALES_GEBRUIKER], ['een sales manager', { ...SALES_GEBRUIKER, magAlleSales: true }]]) {
    test(`${naam} opent het spel met vijf tikken en sluit het weer; elke tik telt één keer`, async ({ page, verzoeken }) => {
      await startSalesApp(page, { gebruiker });
      await openSpel(page);
      await tikVijf(page); // sluiten met vijf tikken: een dubbele luisteraar zou het overlay in dezelfde tik weer sluiten
      await expect(overlay(page)).not.toHaveClass(/open/);
      await openSpel(page);
      await page.keyboard.press('Escape');
      await expect(overlay(page)).not.toHaveClass(/open/);
      expect(verzoeken.onverwacht).toEqual([]);
    });
  }

  test('een beheerder die naar de verkopersweergave wisselt, krijgt het spel niet dubbel (vijf tikken openen het)', async ({ page }) => {
    await startSalesApp(page, { gebruiker: BEHEERDER });
    await openSpel(page);
  });
});
