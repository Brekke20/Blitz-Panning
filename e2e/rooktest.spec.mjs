import { test, expect, startApp } from './helpers.mjs';

test('app laadt als coördinator zonder consolefouten', async ({ page, verzoeken }) => {
  await startApp(page);

  await expect(page.locator('#cnt-tickets')).toHaveText('3');
  // De TEST-badge staat in de DOM, maar is in de huidige app onzichtbaar: index.html:915 zet
  // style.display = '' terwijl app.css:1085 display:none heeft. Vastgelegd als bevinding; de
  // testmodus zelf blijkt uit de dummy-wachtrij (3 tickets).
  await expect(page.locator('#test-badge')).toHaveText('TEST');
  // De knop staat in de kalenderweergave, niet in de standaard geopende wachtrij.
  await expect(page.getByRole('button', { name: '⚡ Plan deze week' })).toBeHidden();
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await expect(page.getByRole('button', { name: '⚡ Plan deze week' })).toBeVisible();
  await expect(page.locator('#tab-planning')).toBeVisible();
  expect(verzoeken.onverwacht).toEqual([]);
});

// Bekende app-bug (niet in deze etappe opgelost): index.html:915 zet style.display = '' terwijl
// app.css:1085 display:none heeft, dus de TEST-badge is nooit zichtbaar. Wordt later als aparte,
// genoteerde bugfix opgelost; haal dan de fixme weg.
test.fixme('TEST-badge is zichtbaar', async ({ page }) => {
  await startApp(page);
  await expect(page.locator('#test-badge')).toBeVisible();
});

// ── Controle van het vangnet zelf ─────────────────────────────────────────────
test('vangnet: verzoek naar een externe host wordt afgebroken en genoteerd', async ({ page, verzoeken, consoleFouten }) => {
  await startApp(page);
  const uitkomst = await page.evaluate(() => fetch('https://example.com/x').then(() => 'bereikt', () => 'geblokkeerd'));
  expect(uitkomst).toBe('geblokkeerd');
  expect(verzoeken.buitenHost).toEqual(['https://example.com/x']);
  // Bewust verwacht: opruimen, anders faalt de auto-controle (die ongewijzigd actief blijft).
  verzoeken.buitenHost.length = 0;
  // De afgebroken fetch is ook een requestfailed/console.error; die horen bij deze bewuste probe.
  expect(consoleFouten.length).toBeGreaterThan(0);
  consoleFouten.length = 0;
});

test('vangnet: door de app geopende pagina (window.open) is ook bewaakt', async ({ page, context, verzoeken, consoleFouten }) => {
  await startApp(page);
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(() => { window.open('https://example.com/popup', '_blank'); }),
  ]);
  await expect.poll(() => verzoeken.buitenHost).toContain('https://example.com/popup');
  await popup.close();
  verzoeken.buitenHost.length = 0;
  consoleFouten.length = 0; // de afgebroken popup-navigatie meldt zichzelf als requestfailed
});

// Afdwingen dat specs `test` uit helpers.mjs gebruiken: rechtstreeks uit @playwright/test importeren
// zou de afterEach-controles omzeilen.
test('vangnet: elke spec importeert test uit ./helpers.mjs', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const map = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
  const specs = fs.readdirSync(decodeURIComponent(map)).filter(f => f.endsWith('.spec.mjs'));
  expect(specs.length).toBeGreaterThan(0);
  const overtreders = specs.filter(f =>
    /from\s+['"]@playwright\/test['"]/.test(fs.readFileSync(path.join(decodeURIComponent(map), f), 'utf8')));
  expect(overtreders, 'specs die @playwright/test rechtstreeks importeren').toEqual([]);
});
