// v2.1.6 (tablet): de app toonde "Versie 2.1.5" maar de rapportwizard had de chips van Oorzaak storing (v2.1.3) niet. Oorzaak: de
// service worker bewaart een momentopname van de release van zijn installatie; liep die achter op de server (een nieuwe release, nog
// geen nieuwe SW geïnstalleerd) en haperde het netwerk bij één module, dan kreeg een pagina die van het NETWERK kwam die ene module uit
// de oude momentopname. Nieuwe index.html en versie.js, oude rapport-wizard.js: een gemengde app zonder foutmelding. De bescherming
// per client bestond (I3) maar las de client-id's van het Request in plaats van het FetchEvent en werkte dus nooit.
// Hier: de cache is "de vorige release" (index.html en rapport-wizard.js gemerkt) en het netwerk faalt enkel voor rapport-wizard.js.
import { test, expect, CACHE_NAME, verwachtNetwerkFout } from '../sw-hulp.mjs';

const WIZARD = '/js/rapport-wizard.js';

test('Een netwerkpagina krijgt nooit een module uit een cache van een andere release (geen versiemengeling)', async ({ page, sw, verzoeken }) => {
  await sw.start();
  await page.evaluate(async (naam) => {
    const c = await caches.open(naam);
    for (const p of ['/', '/index.html']) {
      const r = await c.match(p);
      await c.put(p, new Response((await r.text()) + '\n<!-- vorige release -->\n', { headers: r.headers }));
    }
    const w = await c.match('/js/rapport-wizard.js');
    await c.put('/js/rapport-wizard.js', new Response((await w.text()) + '\nwindow.__wizardUitOudeCache = true;\n', { headers: w.headers }));
  }, CACHE_NAME);

  // Per lading faalt rapport-wizard.js twee keer (het verzoek van de SW en dat van de pagina); de pagina laadt twee keer (opstartherstel).
  verwachtNetwerkFout(verzoeken, Array.from({ length: 4 }, () => ({ pad: WIZARD, methode: 'GET' })));
  let ladingen = 0;
  page.on('load', () => { ladingen++; });
  sw.breekAf(WIZARD);
  await page.reload();
  await expect(page.locator('#app-versie')).toHaveText(/^Versie \d+\.\d+\.\d+/);
  // Zonder de fix start de app met de oude wizard (de vlag staat dan op true). Met de fix faalt de module en herlaadt de pagina één keer
  // (opstartherstel); daarna blijft ze staan tot het netwerk terug is: nooit een gemengde app.
  await expect.poll(() => page.evaluate(() => window.__wizardUitOudeCache === true || !!sessionStorage.getItem('blitz_opstartherstel')).catch(() => false), { timeout: 15000 }).toBe(true);
  expect(await page.evaluate(() => window.__wizardUitOudeCache === true).catch(() => false), 'oude rapport-wizard.js in een netwerkpagina').toBe(false);
  await expect.poll(() => ladingen, { timeout: 15000 }).toBe(2); // de herlading van het opstartherstel
  await expect(page.locator('#app-versie')).toHaveText(/^Versie /);
  expect(await page.evaluate(() => window.__wizardUitOudeCache === true)).toBe(false);

  // Het netwerk is terug: de volgende start is volledig de nieuwe release.
  await sw.herstel();
  await page.reload();
  await expect(page.locator('#cnt-tickets')).toHaveText(/\d+/);
  expect(await page.evaluate(() => [typeof window.wizOorzaakGroep, window.__wizardUitOudeCache === true])).toEqual(['function', false]);
});
