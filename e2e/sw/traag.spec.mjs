// Navigatie-time-out (etappe 7, Q5/N21): standaard UIT (volgt het netwerk); met ?navTimeout=<ms> (enkel de tests) levert de netwerk-eerst
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

test('Traag netwerk zonder navTimeout (standaard 0): de navigatie volgt het netwerk en wacht tot het antwoordt', async ({ sw }) => {
  await sw.start();
  await sw.registreerSwMetNavTimeout(); // geen ?navTimeout=: de standaard van sw.js
  sw.vertraag('/', 3000);
  const pagina = await sw.startNavigatie();
  expect(await sw.navigatieAntwoord(2000), 'binnen 2 s is er nog geen antwoord (geen time-out)').toBeNull();
  const antwoord = await sw.navigatieAntwoord(10000);
  expect(antwoord, 'het antwoord komt met het netwerk').not.toBeNull();
  expect(antwoord.ms).toBeGreaterThanOrEqual(2800);
  await expect(pagina.locator('#cnt-tickets')).toBeAttached({ timeout: 15000 });
});
