// Opstart met een bewaarde sessie (eindreview I1/I2): een onbruikbaar antwoord van /api/auth-ik (5xx, captive portal met HTML)
// stopt de app niet en een trage server houdt de opstart niet langer dan ~5 s op.
import { test, expect, startApp, authIkStub } from './helpers.mjs';

const ANTWOORDEN = {
  '500': { status: 500, json: { error: 'interne fout' } },
  '502': { status: 502, raw: '<html><body>Bad gateway</body></html>' },
  '504': { status: 504, raw: '' },
  '503 opslag-storing': { status: 503, json: { code: 'opslag-storing', error: 'later' } },
  '200 met HTML (captive portal)': { status: 200, raw: '<html><body>Log in op de wifi</body></html>' },
};
const sessieCache = (page) => page.evaluate(() => localStorage.getItem('blitz_sessie_cache'));

// Start de app normaal (de sessie komt in de cache), wijzigt daarna het gedrag van auth-ik en laadt de pagina opnieuw.
async function startDaarnaStoring(page, antwoord) {
  const staat = { modus: 'ok' };
  const ok = authIkStub('beheerder');
  await startApp(page, { overschrijf: { 'auth-ik': (z) => (staat.modus === 'ok' ? ok(z) : antwoord) } });
  expect(await sessieCache(page)).toContain('u-test');
  staat.modus = 'stuk';
  return staat;
}

test.describe('opstart bij een onbruikbaar auth-ik-antwoord', () => {
  for (const [naam, antwoord] of Object.entries(ANTWOORDEN)) {
    test(`${naam} met bewaarde sessie: de app start uit de cache, geen inlogscherm en geen foutmelding`, async ({ page, consoleFouten }) => {
      await startDaarnaStoring(page, antwoord);
      await page.reload();
      await expect(page.locator('#cnt-tickets')).toHaveText('3');
      await expect(page.locator('#login-overlay')).toHaveCount(0);
      await expect(page.getByText('Inloggen is niet gelukt')).toHaveCount(0);
      expect(await sessieCache(page)).toContain('u-test'); // de cache blijft staan
      // De browser meldt de 5xx zelf als consolefout: bewust uitgelokt, dus hier verwacht en gewist voor het algemene vangnet.
      expect(consoleFouten.every(f => /auth-ik/.test(f)), consoleFouten.join('\n')).toBe(true);
      consoleFouten.length = 0;
    });
  }
});

test('traag auth-ik (hangt) met bewaarde sessie: de planning staat binnen ~6 s op het scherm (5 s limiet, daarna cache)', async ({ page }) => {
  await startDaarnaStoring(page, { hangen: true });
  const t0 = Date.now();
  await page.reload();
  await expect(page.locator('#cnt-tickets')).toHaveText('3', { timeout: 9000 });
  const duur = Date.now() - t0;
  expect(duur, `opstart duurde ${duur} ms`).toBeLessThan(8500);
  expect(duur, 'de korte limiet wacht echt tot ~5 s (geen te vroege terugval)').toBeGreaterThan(4000);
  await expect(page.locator('#login-overlay')).toHaveCount(0);
});

test('traag auth-ik dat later 401 geeft: de app startte al uit de cache en het inlogscherm opent daarna', async ({ page, consoleFouten }) => {
  const staat = { modus: 'ok', loslaten: null };
  const ok = authIkStub('beheerder');
  let hangend = null;
  await startApp(page, {
    overschrijf: {
      'auth-ik': async (z) => {
        if (staat.modus === 'ok') return ok(z);
        if (staat.modus === 'traag') {
          staat.modus = 'verlopen';
          await new Promise((r) => { hangend = r; staat.loslaten = r; });
        }
        return { status: 401, json: { error: 'Niet ingelogd', code: 'niet-ingelogd', setupNodig: false } };
      },
    },
  });
  staat.modus = 'traag';
  await page.reload();
  await expect(page.locator('#cnt-tickets')).toHaveText('3', { timeout: 9000 });
  await expect(page.locator('#login-overlay')).toHaveCount(0);
  await expect.poll(() => hangend !== null).toBe(true);
  hangend();
  await expect(page.locator('#login-overlay').getByRole('heading', { name: 'Inloggen' })).toBeVisible();
  consoleFouten.length = 0; // de 401 op auth-ik is bewust
});
