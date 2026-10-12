import { test, expect, startApp } from './helpers.mjs';

// Blitz Run (verborgen spel): 5× snel tikken op de titel opent het overlay, 5× tikken / ✕ / Escape sluit het, het toetsenbord
// speelt, en het spel verstuurt nooit iets buiten /api/spel. In ?test; de klok is een nepklok (page.clock).

const titel = (page) => page.locator('.logo');
const overlay = (page) => page.locator('#spel-overlay');
const tikVijf = async (page) => { for (let i = 0; i < 5; i++) await titel(page).click(); };
const status = (page) => overlay(page).getAttribute('data-status');
const score = async (page) => Number((await overlay(page).getAttribute('data-score')) ?? 0);
const canvasBeeld = (page) => page.locator('#spel-overlay canvas').evaluate((c) => c.toDataURL());

async function openSpel(page) {
  await tikVijf(page);
  await expect(overlay(page)).toHaveClass(/open/);
  await expect(overlay(page)).toHaveAttribute('data-status', 'start');
}

test.describe('Blitz Run', () => {
  test('vier tikken openen niets, vijf wel; de titel doet verder niets en het spel wordt pas dan geladen', async ({ page, verzoeken }) => {
    await startApp(page);
    const modules = [];
    page.on('request', (r) => { if (r.url().includes('/js/spel/spel-ui.js')) modules.push(r.url()); });
    for (let i = 0; i < 4; i++) await titel(page).click();
    await expect(overlay(page)).toHaveCount(0);
    expect(modules).toEqual([]);
    await titel(page).click();
    await expect(overlay(page)).toHaveClass(/open/);
    expect(modules).toHaveLength(1);
    expect(verzoeken.onverwacht).toEqual([]);
  });

  test('niet snel genoeg tikken opent niets', async ({ page }) => {
    await startApp(page);
    for (let i = 0; i < 5; i++) { await titel(page).click(); await page.clock.runFor(1000); }
    await expect(overlay(page)).toHaveCount(0);
  });

  test('sluiten kan met vijf tikken op de titel, met ✕ en met Escape; opnieuw openen werkt telkens', async ({ page }) => {
    await startApp(page);
    await openSpel(page);
    await tikVijf(page); // de kop met de titel blijft boven het overlay bereikbaar
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
    await expect(vergrendeld.first().locator('small')).toHaveText(/^(vanaf \d+ punten|.+-event)$/);
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

  test('aanraking: tik op de bovenste helft springt, ingehouden onderste helft bukt (geen fout, spel loopt door)', async ({ page }) => {
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
});
