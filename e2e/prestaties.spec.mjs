import { test, expect, startApp } from './helpers.mjs';

// v2.1.3 (prestaties): geen requestAnimationFrame-lus die blijft draaien als er niets beweegt.
// - Blitz Run: na het sluiten draait er geen lus meer en blijven er geen toetsluisteraars achter (ook na 5 keer openen en sluiten).
// - Versiering op aanraak/tablet: geen enkele lus.
// - Versiering op de computer: doorlopend, een timer-lus van ~30 beelden per seconde (geen rAF-lus); rust bij een open spel of verborgen tab.
// De klok is de nepklok van startApp (page.clock): die vervangt ook requestAnimationFrame, dus tellen we op de nepversie,
// die we na het laden omwikkelen (een kale `requestAnimationFrame(...)` in de app zoekt de naam bij elke oproep opnieuw op).

const telRaf = (page) => page.evaluate(() => {
  if (window.__rafTeller) { window.__rafTeller.n = 0; return; }
  const teller = { n: 0 };
  window.__rafTeller = teller;
  const origineel = window.requestAnimationFrame;
  window.requestAnimationFrame = (f) => { teller.n++; return origineel.call(window, f); };
});
const rafAantal = (page) => page.evaluate(() => window.__rafTeller.n);

// Houdt de toetsluisteraars op document en window bij (vóór het laden, zodat ook die van de app meetellen).
const volgLuisteraars = (page) => page.addInitScript(() => {
  // Per doel en type de set van functies (zoals de browser: dezelfde functie twee keer toevoegen telt één keer; de vang-vlag negeren we).
  const sets = new Map();
  const set = (doel, type) => {
    const k = (doel === document ? 'document:' : 'window:') + type;
    if (!sets.has(k)) sets.set(k, new Set());
    return sets.get(k);
  };
  const telt = (doel, type) => (doel === document || doel === window) && type.startsWith('key');
  const toe = EventTarget.prototype.addEventListener, weg = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, f, o) {
    if (telt(this, type)) set(this, type).add(f);
    return toe.call(this, type, f, o);
  };
  EventTarget.prototype.removeEventListener = function (type, f, o) {
    if (telt(this, type)) set(this, type).delete(f);
    return weg.call(this, type, f, o);
  };
  window.__toetsLuisteraars = () => [...sets.values()].reduce((s, v) => s + v.size, 0);
});

const titel = (page) => page.locator('.logo-icon');
const overlay = (page) => page.locator('#spel-overlay');
const tikVijf = async (page) => { for (let i = 0; i < 5; i++) await titel(page).click(); };

test.describe('Blitz Run laat niets achter', () => {
  test('na 5 keer openen, spelen en sluiten draait er geen lus meer en zijn de toetsluisteraars weg', async ({ page }) => {
    await volgLuisteraars(page);
    await startApp(page);
    const voor = await page.evaluate(() => window.__toetsLuisteraars());
    await telRaf(page);
    for (let i = 0; i < 5; i++) {
      await tikVijf(page);
      await expect(overlay(page)).toHaveClass(/open/);
      await page.keyboard.press('Space');
      await expect(overlay(page)).toHaveAttribute('data-status', 'bezig');
      await page.clock.runFor(500);
      if (i % 2) await page.keyboard.press('Escape');
      else await overlay(page).getByRole('button', { name: 'Sluiten' }).click();
      await expect(overlay(page)).not.toHaveClass(/open/);
    }
    expect(await rafAantal(page)).toBeGreaterThan(50); // het spel liep echt
    await telRaf(page);
    await page.clock.runFor(5000);
    expect(await rafAantal(page)).toBe(0);
    expect(await page.evaluate(() => window.__toetsLuisteraars())).toBe(voor);
  });

  test('een spel dat afgelopen is, laat ook geen lus achter', async ({ page }) => {
    let open = 0; // lopende /api/spel-verzoeken: de test eindigt pas als ze klaar zijn (anders breekt het sluiten van de pagina ze af)
    const isSpel = (r) => r.url().endsWith('/api/spel');
    page.on('request', (r) => { if (isSpel(r)) open++; });
    page.on('requestfinished', (r) => { if (isSpel(r)) open--; });
    page.on('requestfailed', (r) => { if (isSpel(r)) open--; });
    await startApp(page);
    await tikVijf(page);
    await expect(overlay(page)).toHaveAttribute('data-status', 'start');
    const bewaard = page.waitForResponse((r) => isSpel(r) && r.request().method() === 'POST');
    await page.keyboard.press('Space');
    await expect(overlay(page)).toHaveAttribute('data-status', 'bezig');
    await page.clock.runFor(30000); // zonder springen botst de paal vroeg of laat
    await expect(overlay(page)).toHaveAttribute('data-status', 'af');
    await bewaard; // de score is bewaard (anders breekt het einde van de test dat verzoek af)
    await telRaf(page);
    await page.clock.runFor(3000);
    expect(await rafAantal(page)).toBe(0);
    await expect.poll(() => open).toBe(0);
  });
});

test.describe('versiering op een tablet (aanraak)', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });

  test('geen enkele animatielus en geen lopende animaties', async ({ page }) => {
    await startApp(page, { query: '?test&versiering=aan', viewport: { width: 1024, height: 768 } });
    await expect(page.locator('html')).toHaveAttribute('data-event-sober', 'ja');
    await expect(page.locator('#event-achtergrond')).toHaveCount(1);
    await page.clock.runFor(2000); // de metingen bij de start (planMeting) zijn voorbij
    await telRaf(page);
    await page.clock.runFor(60000);
    // Hoogstens de losse meting van de minuutklok (planMeting, één beeld per minuut), geen lus
    expect(await rafAantal(page)).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target?.closest?.('#event-laag, #event-achtergrond')).length)).toBe(0);
  });
});

test.describe('versiering op de computer', () => {
  // De timer-lus (setTimeout ~33 ms) vraagt geen requestAnimationFrame: hoogstens ~35 beelden-oproepen per seconde, zonder rustpauzes.
  const telTimers = (page) => page.evaluate(() => {
    if (window.__timerTeller) { window.__timerTeller.n = 0; return; }
    const teller = { n: 0 };
    window.__timerTeller = teller;
    const origineel = window.setTimeout;
    window.setTimeout = (f, ms, ...a) => { teller.n++; return origineel.call(window, f, ms, ...a); };
  });
  const timerAantal = (page) => page.evaluate(() => window.__timerTeller.n);
  const kruiperX = (page) => page.locator('#ev-kruiper').evaluate((el) => el.style.transform);

  test('beweegt doorlopend, hoogstens ~35 beeld-oproepen per seconde, zonder rustpauze', async ({ page }) => {
    await startApp(page, { query: '?test&versiering=aan' });
    await expect(page.locator('#ev-kruiper')).toHaveCount(1);
    await page.clock.runFor(1000);
    await telRaf(page);
    await telTimers(page);
    await page.clock.runFor(5000);
    expect(await rafAantal(page)).toBe(0); // geen rAF-lus meer
    const perSeconde = (await timerAantal(page)) / 5;
    expect(perSeconde).toBeGreaterThan(20);
    expect(perSeconde).toBeLessThanOrEqual(35);
    // Doorlopend: ook na 45 seconden (de oude rustpauze begon na 20 s) beweegt de spin nog
    await page.clock.runFor(45000);
    const voor = await kruiperX(page);
    await page.clock.runFor(2000);
    expect(await kruiperX(page)).not.toBe(voor);
    await expect(page.locator('#event-laag')).not.toHaveClass(/ev-gepauzeerd/);
    // De CSS-animaties lopen in stappen
    await expect(page.locator('#event-laag .ev-hang').first()).toHaveCSS('animation-timing-function', /steps/);
    await expect(page.locator('#event-laag .ev-mist')).toHaveCSS('animation-timing-function', /steps/);
  });

  test('zolang Blitz Run open staat, rust de versiering; daarna beweegt ze weer', async ({ page }) => {
    await startApp(page, { query: '?test&versiering=aan' });
    await page.clock.runFor(1000);
    await tikVijf(page);
    await expect(overlay(page)).toHaveClass(/open/);
    await page.clock.runFor(1000);
    await expect(page.locator('#event-laag')).toHaveClass(/ev-gepauzeerd/);
    const stil = await kruiperX(page);
    await page.clock.runFor(3000);
    expect(await kruiperX(page)).toBe(stil);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).not.toHaveClass(/open/);
    await page.clock.runFor(2000);
    await expect(page.locator('#event-laag')).not.toHaveClass(/ev-gepauzeerd/);
    expect(await kruiperX(page)).not.toBe(stil);
  });

  test('een verborgen tab laat de versiering rusten', async ({ page }) => {
    await startApp(page, { query: '?test&versiering=aan' });
    await page.clock.runFor(1000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('#event-laag')).toHaveClass(/ev-gepauzeerd/);
    const stil = await kruiperX(page);
    await page.clock.runFor(3000);
    expect(await kruiperX(page)).toBe(stil);
  });
});
