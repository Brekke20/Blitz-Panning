// Navigatie-time-out (etappe 7, Q5/N21): standaard 4000 ms (Brent, 2026-10-02); met ?navTimeout=<ms> (enkel de tests) kan dat anders (0 = uit). De netwerk-eerst
// SW na die tijd de app uit de cache wanneer het netwerk hangt of traag is. Echte tijd (het gaat om de timer in de SW, niet om een
// Playwright-klok). De SW draait via het meet-omhulsel van sw-hulp.mjs, dat enkel de tijd tot elk navigatie-antwoord noteert.
import { test, expect } from '../sw-hulp.mjs';

test('Traag netwerk met navTimeout=500: de navigatie krijgt de app uit de cache binnen 4 s, terwijl het netwerk hangt', async ({ sw }) => {
  await sw.start();
  await sw.registreerSwMetNavTimeout(500);
  sw.hangVoor('/'); // het netwerk (zoals de SW het ziet) antwoordt nooit op de navigatie naar de startpagina
  const pagina = await sw.startNavigatie();
  const antwoord = await sw.navigatieAntwoord(4000);
  expect(antwoord, 'de SW antwoordde binnen 4 s').not.toBeNull();
  expect(antwoord.fout).toBeUndefined();
  expect(antwoord.ms, 'ongeveer de navigatie-time-out, niet de duur van het netwerk').toBeGreaterThanOrEqual(400);
  expect(antwoord.ms).toBeLessThan(3000);
  // Daarna loopt het netwerk door en draait de app in het nieuwe tabblad.
  await sw.herstel();
  await expect(pagina.locator('#cnt-tickets')).toBeAttached({ timeout: 15000 });
  expect(await pagina.evaluate(() => typeof L)).toBe('object');
});

test('Traag netwerk met navTimeout=0 (uit): de navigatie volgt het netwerk en wacht tot het antwoordt', async ({ sw }) => {
  await sw.start();
  await sw.registreerSwMetNavTimeout(0); // W5-fix (Q5): expliciet uit, want de standaard is nu 4000 ms
  sw.vertraag('/', 6000);
  const pagina = await sw.startNavigatie();
  expect(await sw.navigatieAntwoord(4500), 'binnen 4,5 s is er nog geen antwoord (geen time-out)').toBeNull();
  const antwoord = await sw.navigatieAntwoord(10000);
  expect(antwoord, 'het antwoord komt met het netwerk').not.toBeNull();
  expect(antwoord.ms).toBeGreaterThanOrEqual(5800);
  await expect(pagina.locator('#cnt-tickets')).toBeAttached({ timeout: 15000 });
});

test('Traag netwerk zonder queryparameter (standaard 4000 ms): na 4 s start de app uit de bewaarde kopie, ook al antwoordt het netwerk pas na 6 s', async ({ sw }) => {
  await sw.start();
  await sw.registreerSwMetNavTimeout(); // geen ?navTimeout=: de standaard van sw.js (Q5: 4000)
  sw.vertraag('/', 6000);
  const pagina = await sw.startNavigatie();
  const antwoord = await sw.navigatieAntwoord(5500);
  expect(antwoord, 'de SW antwoordde vóór het netwerk (6 s)').not.toBeNull();
  expect(antwoord.fout).toBeUndefined();
  expect(antwoord.ms, 'ongeveer 4 s: de standaard-time-out').toBeGreaterThanOrEqual(3800);
  expect(antwoord.ms).toBeLessThan(5500);
  await expect(pagina.locator('#cnt-tickets')).toBeAttached({ timeout: 15000 });
  expect(await pagina.evaluate(() => typeof L)).toBe('object');
});
