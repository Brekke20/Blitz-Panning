import { test, expect, startApp } from './helpers.mjs';
import { zetStartTijd, maakRouteMetStops, stopNummers } from './route-hulp.mjs';

// Etappe 7, taak 1 (pin P6): een render van de route midden in een sleepbeweging annuleert die beweging.
// route.js vernietigt de sorteer-instantie bij elke renderRouteList (`sorteer?.vernietig()`), dus een
// planningswijziging tijdens het slepen (poll, andere tab) laat de stop terugspringen. Gedocumenteerd, niet gefixt
// (spec N12: applyRouteOrder werkt op verouderde objecten, W11); deze test blijft dus staan.
test.describe('route slepen en render', () => {
  test('een render midden in een drag annuleert de beweging: geen sleepresten, zelfde volgorde', async ({ page }) => {
    await zetStartTijd(page, '10:00');
    await startApp(page, { technieker: 'Tim' });
    await maakRouteMetStops(page);
    const voor = await stopNummers(page);
    expect(voor).toEqual(['#1001', '#1002']);

    const bron = page.getByTestId('route-stop').filter({ hasText: '#1001' }).locator('.stop-top');
    const doel = page.getByTestId('route-stop').filter({ hasText: '#1002' });
    const b = await bron.boundingBox();
    const d = await doel.boundingBox();
    const x = b.x + b.width / 2;
    const y0 = b.y + b.height / 2;
    await page.mouse.move(x, y0);
    await page.mouse.down();
    await page.mouse.move(x, y0 + 20); // voorbij de drempel van 4 px: de drag is actief
    await expect(page.locator('.sorteer-actief')).toHaveCount(1);
    await expect(page.locator('.sorteer-placeholder')).toHaveCount(1);
    await page.mouse.move(x, d.y + d.height - 4); // ver genoeg om de volgorde te wijzigen als de drag standhield

    // Midden in de drag: een planningswijziging (zoals de poll) hertekent de route.
    const rendersVoor = await page.evaluate(() => kern.route.renderTelling());
    await page.evaluate(() => kern.toestand.raak('planning'));
    await expect.poll(() => page.evaluate(() => kern.route.renderTelling())).toBeGreaterThan(rendersVoor);

    // De hertekening heeft de sorteer-instantie vernietigd: de sleepresten zijn weg.
    await expect(page.locator('.sorteer-actief')).toHaveCount(0);
    await expect(page.locator('.sorteer-placeholder')).toHaveCount(0);
    await page.mouse.up();

    // HUIDIG GEDRAG (bug?) (N12, blijft): de loslating doet niets meer; geen herordening.
    await expect(page.locator('.sorteer-actief')).toHaveCount(0);
    await expect(page.locator('.sorteer-placeholder')).toHaveCount(0);
    expect(await stopNummers(page)).toEqual(voor);
    // (Geen controle op /api/plan-datum: in ?test slaat route.js die POST sowieso over; de echte bewering is de ongewijzigde volgorde.)
  });
});
