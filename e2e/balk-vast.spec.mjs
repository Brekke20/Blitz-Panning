import { test, expect, startApp } from './helpers.mjs';

// Bugfix v2.5.1 (Brent, 2026-10-28): "de balk bovenaan staat niet vast, als je naar boven scrolt dan scrolt deze even mee."
// Gemeten in Chromium (Playwright): met muiswiel staat de top van .topbar-sticky en van de sticky werkbalk op elk frame op dezelfde plek, ook bij een scroll
// ver voorbij de bovenrand; de bug is dus niet te zien aan getBoundingClientRect. Het enige dat een vaste balk laat meebewegen is het elastische overscroll-effect van de
// browser (de hele pagina veert mee als je voorbij de bovenkant trekt; vaste en sticky delen veren dan mee). Dat staat nu uit: overscroll-behavior-y: none op html en body.
// Twee soorten controle: (1) het mechanisme (de berekende overscroll-behavior-y), zodat het niet ongemerkt terugkomt; (2) per animatieframe over een scroll
// naar beneden, naar boven en over de top heen: de top van de kop en van de werkbalk blijft binnen 0,5 px gelijk. Een echte iOS-bounce of een precisietouchpad
// is in Playwright niet na te bootsen; (1) dekt dat.

const MATEN = [
  { naam: 'pc 1366×768', viewport: { width: 1366, height: 768 } },
  { naam: 'tablet rechtop 768×1024', viewport: { width: 768, height: 1024 } },
  { naam: 'tablet liggend 1024×768', viewport: { width: 1024, height: 768 } },
  { naam: 'gsm 375×812', viewport: { width: 375, height: 812 }, gsm: true },
];

async function open(browser, page, m) {
  if (!m.gsm) { await startApp(page, { viewport: m.viewport }); return { page, sluit: async () => {} }; }
  const context = await browser.newContext({ viewport: m.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'nl-BE', timezoneId: 'Europe/Brussels', serviceWorkers: 'block' });
  const p = await context.newPage();
  await startApp(p, {});
  return { page: p, sluit: () => context.close() };
}

for (const m of MATEN) {
  test(`bovenbalk en werkbalk staan vast bij scrollen, ${m.naam}`, async ({ browser, page }) => {
    const { page: p, sluit } = await open(browser, page, m);
    try {
      // Het mechanisme: geen elastische overscroll op de pagina zelf.
      const os = await p.evaluate(() => ({ html: getComputedStyle(document.documentElement).overscrollBehaviorY, body: getComputedStyle(document.body).overscrollBehaviorY }));
      expect(os, 'overscroll-behavior-y op html en body').toEqual({ html: 'none', body: 'none' });

      await p.getByRole('tab', { name: /^Wachtrij/ }).click();
      await p.evaluate(() => {
        const d = document.createElement('div'); d.style.cssText = 'height:5000px;background:#c00';
        document.querySelector('#view-tickets .lijst-balk').parentElement.appendChild(d);
        window.__log = []; window.__op = true;
        const f = () => {
          window.__log.push([window.scrollY, document.querySelector('.topbar-sticky').getBoundingClientRect().top, document.querySelector('#view-tickets .lijst-balk').getBoundingClientRect().top]);
          if (window.__op) requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
      await p.mouse.move(m.viewport.width / 2, m.viewport.height / 2);
      for (let i = 0; i < 10; i++) await p.mouse.wheel(0, 300);   // naar beneden
      for (let i = 0; i < 14; i++) await p.mouse.wheel(0, -300);  // naar boven en ruim over de top heen
      await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const log = await p.evaluate(() => { window.__op = false; return window.__log; });
      expect(Math.max(...log.map((l) => l[0])), 'de pagina scrolt echt').toBeGreaterThan(1000);
      expect(log[log.length - 1][0], 'en komt weer bovenaan').toBeLessThanOrEqual(1);
      const kop = log.map((l) => l[1]), balk = log.map((l) => l[2]);
      expect(Math.max(...kop) - Math.min(...kop), 'top van .topbar-sticky over alle frames').toBeLessThanOrEqual(0.5);
      expect(Math.max(...balk) - Math.min(...balk), 'top van de sticky werkbalk over alle frames').toBeLessThanOrEqual(0.5);
    } finally { await sluit(); }
  });
}
