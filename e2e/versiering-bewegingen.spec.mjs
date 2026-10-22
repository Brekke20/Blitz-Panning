import { test, expect, startApp, snelTikken } from './helpers.mjs';
import { valideerPakket, PLAFONDS } from '../public/js/kern/themapakket-validatie.js';

// Versiering per beweging (taak 6, spec thema's als pakket §3.3): één stubpakket per soort beweging via /api/themas.
// Telt de elementen per beweging (nooit boven PLAFONDS), controleert de laag (voor of achter de inhoud), sober op een gsm, een
// uitgezet thema en dat er nooit code in de lagen belandt (geen <script>, <foreignObject> of on*-attribuut).
// Testklok: maandag 5 okt 2026; elk proefpakket loopt van 1 tot 31 oktober.
const AAN = '?test&versiering=aan';

const BOL = { viewBox: '0 0 10 10', delen: [{ soort: 'circle', cx: 5, cy: 5, r: 4, vul: '#e11d48', vulLicht: '#9f1239' }] };
function pakket(id, versiering, extra = {}) {
  return {
    formaat: 1, id, naam: `Proef ${id}`, versie: 'e2e',
    periode: { van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 } },
    kleuren: { donker: { accent: '#e11d48' } },
    vormen: { bol: BOL },
    versiering,
    spelskin: { naam: 'Proefpaal', behuizing: '#2a1840', faceplate: '#ff7a00', bliksem: '#ffe9c2' },
    ...extra,
  };
}
// De stub van /api/themas met één pakket (zelfde vorm als het antwoord van de server).
function themasStub(p, { aan = true } = {}) {
  const r = valideerPakket(p);
  if (!r.ok) throw new Error(`proefpakket ${p.id} is ongeldig: ${JSON.stringify(r.fouten)}`);
  return ({ query }) => {
    if (query.get('id') !== null) return { status: 200, json: p };
    return {
      status: 200,
      json: { versie: 1, themas: [{ id: p.id, naam: p.naam, aan, periode: p.periode, periodeOverride: null, pakketHash: `e2e-${p.id}` }], pakketten: { [p.id]: p } },
    };
  };
}
const start = (page, p, opties = {}) => startApp(page, { query: AAN, overschrijf: { themas: themasStub(p, opties) }, ...opties.app });

const voor = (page, sel) => page.locator(`#event-laag ${sel}`);
const achter = (page, sel) => page.locator(`#event-achter-laag ${sel}`);

// Nooit code of een klikbaar element in de versiering.
async function geenCode(page) {
  const fout = await page.evaluate(() => {
    const lagen = ['#event-laag', '#event-achter-laag', '#event-achtergrond'].map((s) => document.querySelector(s)).filter(Boolean);
    const uit = [];
    for (const l of lagen) {
      if (l.querySelector('script, foreignObject, foreignobject, iframe, object, embed, use, a, button, input')) uit.push(`${l.id}: verboden element`);
      for (const el of [l, ...l.querySelectorAll('*')]) {
        for (const a of el.attributes) if (/^on/i.test(a.name) || /href$/i.test(a.name)) uit.push(`${l.id}: ${el.tagName}.${a.name}`);
      }
    }
    return uit;
  });
  expect(fout).toEqual([]);
}

test.describe('versiering per beweging (computer)', () => {
  test('vallen: 12 beelden vóór de inhoud, nooit meer dan het plafond', async ({ page }) => {
    await start(page, pakket('proef-vallen', [{ beweging: 'vallen', beeld: 'bol', aantal: 12, wiebel: 0.6 }]));
    await expect(page.locator('html')).toHaveAttribute('data-event', 'proef-vallen');
    await expect(voor(page, '.ev-val')).toHaveCount(12);
    expect(await voor(page, '.ev-val').count()).toBeLessThanOrEqual(PLAFONDS.vallen);
    await expect(voor(page, '.ev-val .ev-beeld-bol')).toHaveCount(12);
    await expect(achter(page, '.ev-val')).toHaveCount(0);
    // CSS-animatie in stappen
    expect(await voor(page, '.ev-val').first().evaluate((el) => getComputedStyle(el).animationTimingFunction)).toMatch(/^steps\(/);
    // zonder achtergrond geen glas en geen doorzichtige inhoudsvlakken
    await expect(page.locator('html')).not.toHaveAttribute('data-event-achtergrond', /.+/);
    await expect(page.locator('#event-achtergrond')).toHaveCount(0);
    await geenCode(page);
  });

  test('opstijgen: 8 beelden vóór de inhoud', async ({ page }) => {
    await start(page, pakket('proef-stijgen', [{ beweging: 'opstijgen', beeld: 'bol', aantal: 8 }]));
    await expect(voor(page, '.ev-stijg')).toHaveCount(8);
    expect(await voor(page, '.ev-stijg').count()).toBeLessThanOrEqual(PLAFONDS.opstijgen);
    await geenCode(page);
  });

  test('vuurwerk: hoogstens één pluim tegelijk, en er komt er een binnen 14 s', async ({ page }) => {
    await start(page, pakket('proef-vuurwerk', [{ beweging: 'vuurwerk', frequentie: 1 }]));
    await expect(page.locator('#event-laag')).toHaveCount(1);
    let gezien = 0;
    for (let i = 0; i < 40; i++) {
      await page.clock.runFor(500);
      const n = await voor(page, '.ev-pluim').count();
      expect(n).toBeLessThanOrEqual(PLAFONDS.vuurwerk);
      if (n) gezien += 1;
    }
    expect(gezien).toBeGreaterThan(0);
    await geenCode(page);
  });

  test('hoek: 4 beelden achter de inhoud, rechtop of naar de hoek gespiegeld', async ({ page }) => {
    await start(page, pakket('proef-hoek', [{ beweging: 'hoek', beeld: 'bol', hoeken: ['lb', 'rb', 'lo', 'ro'], richting: 'naarHoek' }]));
    await expect(achter(page, '.ev-hoek')).toHaveCount(4);
    await expect(voor(page, '.ev-hoek')).toHaveCount(0);
    expect(await achter(page, '.ev-hoek-ro').evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(-1, 0, 0, -1, 0, 0)');
    expect(await achter(page, '.ev-hoek-lb').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    await geenCode(page);
  });

  test('hoek rechtop: geen spiegeling in een hoek', async ({ page }) => {
    await start(page, pakket('proef-rechtop', [{ beweging: 'hoek', beeld: 'bol', hoeken: ['ro'] }]));
    await expect(achter(page, '.ev-hoek-ro')).toHaveCount(1);
    expect(await achter(page, '.ev-hoek-ro').evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  });

  test('alle bewegingen samen: plafonds per soort en het totaal van 16 bewegende', async ({ page }) => {
    await start(page, pakket('proef-alles', [
      { beweging: 'hoek', beeld: 'bol', hoeken: ['lb', 'rb'] },
      { beweging: 'hangen', beeld: 'bol', aantal: 2 },
      { beweging: 'kruipen', beeld: 'bol', aantal: 1 },
      { beweging: 'vliegen', beeld: 'bol', aantal: 2 },
      { beweging: 'vallen', beeld: 'bol', aantal: 6 },
      { beweging: 'opstijgen', beeld: 'bol', aantal: 3 },
      { beweging: 'vuurwerk' },
      { beweging: 'mist' },
    ]));
    await expect(achter(page, '.ev-hoek')).toHaveCount(2);
    await expect(achter(page, '.ev-hang')).toHaveCount(2);
    await expect(achter(page, '.ev-mist')).toHaveCount(1);
    await expect(voor(page, '.ev-kruip')).toHaveCount(1);
    await expect(voor(page, '.ev-vlieg')).toHaveCount(2);
    await expect(voor(page, '.ev-val')).toHaveCount(6);
    await expect(voor(page, '.ev-stijg')).toHaveCount(3);
    const bewegend = await page.locator('#event-laag .ev-beweeg:not(.ev-pluim), #event-achter-laag .ev-beweeg').count();
    expect(bewegend).toBeLessThanOrEqual(16);
    await geenCode(page);
  });

  test('een rasterbeeld wordt een <img> met de data-URI, zonder netwerk', async ({ page }) => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await start(page, pakket('proef-png', [{ beweging: 'hoek', beeld: 'stip', hoeken: ['lb'] }], { beelden: { stip: PNG } }));
    const img = achter(page, 'img.ev-hoek-lb');
    await expect(img).toHaveCount(1);
    expect(await img.getAttribute('src')).toBe(PNG);
    expect(await img.getAttribute('alt')).toBe('');
    await geenCode(page);
  });

  // Fix-ronde 1: een thema met enkel CSS-animaties (geen rekenende delen) rust ook tijdens Blitz Run, en beweegt daarna weer.
  test('enkel vallen (CSS): staat stil zolang Blitz Run open staat', async ({ page }) => {
    await start(page, pakket('proef-spel', [{ beweging: 'vallen', beeld: 'bol', aantal: 4 }]));
    await expect(voor(page, '.ev-val')).toHaveCount(4);
    await page.clock.runFor(1000);
    await snelTikken(page, page.locator('.logo-icon'));
    await expect(page.locator('#spel-overlay')).toHaveClass(/open/);
    await page.clock.runFor(1000);
    await expect(page.locator('#event-laag')).toHaveClass(/ev-gepauzeerd/);
    await expect(page.locator('#event-achter-laag')).toHaveClass(/ev-gepauzeerd/);
    await expect(voor(page, '.ev-val').first()).toHaveCSS('animation-play-state', 'paused');
    await page.keyboard.press('Escape');
    await expect(page.locator('#spel-overlay')).not.toHaveClass(/open/);
    await page.clock.runFor(1000);
    await expect(page.locator('#event-laag')).not.toHaveClass(/ev-gepauzeerd/);
    await expect(voor(page, '.ev-val').first()).toHaveCSS('animation-play-state', 'running');
  });

  test('een thema dat de beheerder uitzette, toont niets', async ({ page }) => {
    await start(page, pakket('proef-uit', [{ beweging: 'vallen', beeld: 'bol', aantal: 3 }]), { aan: false });
    await page.clock.runFor(1000);
    await expect(page.locator('#event-laag')).toHaveCount(0);
    await expect(page.locator('#event-achter-laag')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
  });

  test('de lege teksten komen uit het pakket (altijd als platte tekst)', async ({ page }) => {
    const p = pakket('proef-tekst', [{ beweging: 'mist' }], { teksten: { wachtrijLeeg: 'Niets te doen', ingeplandLeeg: '<b>Rustige</b> week' } });
    await start(page, p);
    await expect(page.locator('html')).toHaveAttribute('data-event', 'proef-tekst');
    // Ingepland: twee weken verder is er niets gepland
    await page.locator('#tab-gepland').click();
    await page.getByRole('button', { name: 'Volgende periode' }).click();
    await page.getByRole('button', { name: 'Volgende periode' }).click();
    const leeg = page.locator('#view-gepland .empty');
    await expect(leeg).toHaveText('<b>Rustige</b> week');
    // en de HTML in een tekst wordt nooit als HTML gelezen
    expect(await page.locator('#view-gepland .empty b').count()).toBe(0);
  });
});

test.describe('versiering per beweging op een gsm (sober)', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('enkel hoekbeelden en achtergrond; niets dat beweegt', async ({ page }) => {
    const SCENE = { viewBox: '0 0 100 50', delen: [{ soort: 'rect', x: 0, y: 0, width: 100, height: 50, vul: '#101030' }] };
    await start(page, pakket('proef-gsm', [
      { beweging: 'hoek', beeld: 'bol', hoeken: ['lb', 'rb'] },
      { beweging: 'hangen', beeld: 'bol', aantal: 2 },
      { beweging: 'vallen', beeld: 'bol', aantal: 10 },
      { beweging: 'vliegen', beeld: 'bol', aantal: 1 },
      { beweging: 'vuurwerk' },
      { beweging: 'mist' },
    ], { vormen: { bol: BOL, scene: SCENE }, achtergrond: { vorm: 'scene' } }), { app: { viewport: { width: 375, height: 812 } } });
    await expect(page.locator('html')).toHaveAttribute('data-event-sober', 'ja');
    await expect(achter(page, '.ev-hoek')).toHaveCount(2);
    await expect(page.locator('#event-achtergrond svg')).toHaveCount(1);
    await expect(page.locator('#event-laag .ev-beweeg, #event-achter-laag .ev-beweeg')).toHaveCount(0);
    await page.clock.runFor(16000);
    await expect(voor(page, '.ev-pluim')).toHaveCount(0);
    await geenCode(page);
  });
});

// Fix-ronde 1: een toestel dat de app dagen vooraan houdt, haalt de themas opnieuw op zodra de laatste lading meer dan 30 minuten
// oud is (in de minuutcontrole), zodat een thema dat de beheerder uitzet ook daar verdwijnt.
test('de minuutcontrole haalt de themas opnieuw op na 30 minuten, niet eerder', async ({ page }) => {
  let aan = true;
  let opgehaald = 0;
  const p = pakket('proef-minuut', [{ beweging: 'hoek', beeld: 'bol', hoeken: ['lb'] }]);
  const stub = ({ query }) => {
    if (query.get('id') !== null) return { status: 200, json: p };
    opgehaald += 1;
    return { status: 200, json: { versie: opgehaald, themas: [{ id: p.id, naam: p.naam, aan, periode: p.periode, periodeOverride: null, pakketHash: 'e2e' }], pakketten: aan ? { [p.id]: p } : {} } };
  };
  await startApp(page, { query: AAN, overschrijf: { themas: stub } });
  await expect(page.locator('html')).toHaveAttribute('data-event', 'proef-minuut');
  expect(opgehaald).toBe(1);
  aan = false; // de beheerder zet het thema uit
  await page.clock.fastForward(20 * 60000);
  await page.clock.runFor(61000);
  expect(opgehaald).toBe(1); // na ruim 21 minuten nog geen nieuwe lading
  await page.clock.fastForward(10 * 60000);
  await page.clock.runFor(61000);
  await expect.poll(() => opgehaald).toBe(2);
  await expect(page.locator('html')).not.toHaveAttribute('data-event', /.+/);
  await expect(page.locator('#event-achter-laag')).toHaveCount(0);
});
