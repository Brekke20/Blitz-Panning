import { test, expect, startApp } from './helpers.mjs';

// Bugfix v2.5.1 (Brent, 2026-10-28): op de gsm licht een knop in het dok (de balk onderaan) bij een tik eerst vierkant op en neemt pas daarna de
// ronde vorm van de actieve pil aan. Oorzaak: de standaardmarkering van de browser bij een tik (-webkit-tap-highlight-color, een vierkante
// vlek over de knop) stond nergens uit, en de ronde pil kwam pas na de overgang van --duur (0,28 s) van background-color. Oplossing:
// de tikmarkering is transparant op alle knoppen van het dok (de tab, "Meer" en de items in het blad), en tijdens de tik (:active) staat de
// ronde pil er meteen (zonder overgang). Het toetsenbord houdt zijn ring via :focus-visible, met dezelfde ronding.

const GSM = { width: 375, height: 812 };
const TRANSPARANT = /^rgba\(0, 0, 0, 0\)$|^transparent$/;

// Zet een pseudo-staat (active/focus) vast via het DevTools-protocol en lees dan de berekende stijl van de knop.
async function metStaat(page, selector, staten, lees) {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: staten });
    return await page.evaluate(lees, selector);
  } finally { await cdp.detach(); }
}
const leesStijl = (selector) => {
  const el = document.querySelector(selector); const cs = getComputedStyle(el);
  return {
    tap: cs.getPropertyValue('-webkit-tap-highlight-color'), radius: parseFloat(cs.borderTopLeftRadius), bg: cs.backgroundColor,
    overgang: cs.transitionDuration, uitlijning: cs.outlineStyle,
  };
};

test.describe('dok op de gsm: geen vierkante tikmarkering', () => {
  test.beforeEach(async ({ page }) => {
    await startApp(page, { loginRol: 'planner', technieker: 'Tim', viewport: GSM });
    await expect(page.locator('html')).toHaveAttribute('data-nav', 'dok');
  });

  test('de tab, "Meer" en de items in het blad hebben een transparante tikmarkering', async ({ page }) => {
    const tab = page.locator('.tabs .tab:visible').first();
    await expect(tab).toBeVisible();
    expect(await tab.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-tap-highlight-color'))).toMatch(TRANSPARANT);
    await expect(page.locator('.dok-meer')).toBeVisible();
    expect(await page.locator('.dok-meer').evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-tap-highlight-color'))).toMatch(TRANSPARANT);
    await page.locator('.dok-meer').click();
    const item = page.locator('.dok-meer-item').first();
    await expect(item).toBeVisible();
    expect(await item.evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-tap-highlight-color'))).toMatch(TRANSPARANT);
  });

  test('tijdens de tik (:active) is de ronding er al en staat de pil er zonder overgang', async ({ page }) => {
    for (const sel of ['.tabs .tab:not(.tab--in-meer):not(.active)', '.dok-meer:not(.actief)']) {
      const el = page.locator(sel).first();
      await expect(el).toBeVisible();
      const rustig = await el.evaluate((e) => parseFloat(getComputedStyle(e).borderTopLeftRadius));
      const ingedrukt = await metStaat(page, sel, ['active'], leesStijl);
      expect(ingedrukt.radius, `${sel}: ronding tijdens :active`).toBe(rustig);
      expect(ingedrukt.radius, `${sel}: echt rond`).toBeGreaterThanOrEqual(16);
      expect(ingedrukt.bg, `${sel}: de pil staat er meteen (geen transparante start)`).not.toMatch(TRANSPARANT);
      expect(ingedrukt.overgang, `${sel}: geen overgang van de achtergrond tijdens :active`).toMatch(/^0s(, 0s)*$/);
    }
    await page.locator('.dok-meer').click();
    const item = await metStaat(page, '.dok-meer-item:not(.actief)', ['active'], leesStijl);
    expect(item.radius).toBeGreaterThanOrEqual(16);
    expect(item.bg).not.toMatch(TRANSPARANT);
    expect(item.overgang).toMatch(/^0s(, 0s)*$/);
  });

  test('toetsenbordfocus (:focus-visible) houdt een zichtbare, ronde ring', async ({ page }) => {
    const tab = page.locator('.tabs .tab:visible').first();
    await tab.focus();
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    const m = await tab.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { focusVisible: el.matches(':focus-visible'), stijl: cs.outlineStyle, breedte: parseFloat(cs.outlineWidth), radius: parseFloat(cs.borderTopLeftRadius) };
    });
    expect(m.focusVisible).toBe(true);
    expect(m.stijl).not.toBe('none');
    expect(m.breedte).toBeGreaterThan(0);
    expect(m.radius).toBeGreaterThanOrEqual(16);
  });
});
