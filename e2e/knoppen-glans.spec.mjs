import { test, expect, startApp } from './helpers.mjs';

// Open dag-stijl, taak 4: knoppen vervagen met glans. Bij hover vervaagt een lichtvlek in (::before) en niets beweegt of schaalt.

const glansOpacity = (loc) => loc.evaluate((el) => getComputedStyle(el, '::before').opacity);
const transform = (loc) => loc.evaluate((el) => getComputedStyle(el).transform);

test.describe('knoppen met glans', () => {
  test('de vernieuwknop in de kop: glans bij hover, geen transform', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    const knop = page.locator('.hbtn[data-actie="vernieuw"]');
    await expect(knop).toBeVisible();
    await page.mouse.move(0, 0);
    expect(await glansOpacity(knop)).toBe('0');
    await knop.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.hbtn[data-actie="vernieuw"]'), '::before').opacity === '1');
    expect(await transform(knop)).toBe('none');
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.hbtn[data-actie="vernieuw"]'), '::before').opacity === '0');
  });

  test('de primaire knop in het ticketdetail: glans bij hover, geen transform', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    await page.locator('#view-tickets .ticket').first().click();
    const knop = page.locator('#d-plan-btn');
    await expect(knop).toBeVisible();
    await page.mouse.move(0, 0);
    expect(await glansOpacity(knop)).toBe('0');
    await knop.hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#d-plan-btn'), '::before').opacity === '1');
    expect(await transform(knop)).toBe('none');
    // de gedeelde stijl: gradiënt, pil, donkere tekst
    const stijl = await knop.evaluate((el) => { const cs = getComputedStyle(el); return { beeld: cs.backgroundImage, radius: cs.borderTopLeftRadius, pos: cs.position, overflow: cs.overflow }; });
    expect(stijl.beeld).toContain('linear-gradient');
    expect(stijl.pos).toBe('relative');
    expect(stijl.overflow).toBe('hidden');
    expect(parseFloat(stijl.radius)).toBeGreaterThan(50);
  });

  test('een secundaire knop vervaagt zijn achtergrond en beweegt niet', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    await page.evaluate(() => {
      const k = document.createElement('button');
      k.className = 'btn btn--secondary'; k.id = 'glans-sec'; k.textContent = 'Secundair';
      k.style.cssText = 'position:fixed;top:200px;left:300px;z-index:9999';
      document.body.appendChild(k);
    });
    const knop = page.locator('#glans-sec');
    await page.mouse.move(0, 0);
    const voor = await knop.evaluate((el) => getComputedStyle(el).backgroundColor);
    const doos = await knop.boundingBox();
    await knop.hover();
    await page.waitForFunction((oud) => {
      const nu = getComputedStyle(document.querySelector('#glans-sec')).backgroundColor;
      return nu !== oud && !document.getAnimations().some((a) => a.effect?.target?.id === 'glans-sec' && a.playState === 'running');
    }, voor);
    expect(await transform(knop)).toBe('none');
    const na = await knop.boundingBox();
    expect(na.y).toBe(doos.y);
    expect(na.width).toBe(doos.width);
  });

  test('een uitgeschakelde knop krijgt geen glans', async ({ page }) => {
    await startApp(page, { viewport: { width: 1366, height: 768 } });
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.className = 'btn btn--primary'; b.id = 'glans-uit'; b.disabled = true; b.textContent = 'Uit';
      b.style.cssText = 'position:fixed;top:200px;left:300px;z-index:9999';
      document.body.appendChild(b);
    });
    const knop = page.locator('#glans-uit');
    await knop.hover({ force: true });
    // kort wachten op een eventuele (onterechte) overgang: de glans blijft 0
    await page.waitForTimeout(500);
    expect(await glansOpacity(knop)).toBe('0');
  });
});
