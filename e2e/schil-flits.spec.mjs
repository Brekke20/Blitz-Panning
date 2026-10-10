import { test, expect, startApp } from './helpers.mjs';
import { startSalesApp, SALES_GEBRUIKER } from './sales-hulp.mjs';

// De rolgebonden schil mag niet kort zichtbaar zijn voor een rol die hem niet krijgt (acceptatietest: een verkoper zag even de tabs
// Wachtrij/Kalender/Route/Ingepland/Inventaris/Rapporten, "Planning: Alle" en "Laden..."). Een waarnemer in de pagina bemonstert bij elke DOM-wijziging
// en elk beeldframe vanaf de eerste parse welke van die elementen zichtbaar zijn (visibility:hidden en display:none tellen als onzichtbaar).
const ELEMENTEN = {
  Wachtrij: '#tab-tickets', Route: '#tab-planning', Ingepland: '#tab-gepland', Inventaris: '#tab-inventaris', Rapporten: '#tab-rapporten',
  'Planning: Alle': '#person-sel', Vernieuwen: '[data-actie="vernieuw"]', Instellingen: '[data-actie="instellingen"]', 'Laden...': '#empty-tickets',
};

async function zetWaarnemer(page) {
  await page.addInitScript((elementen) => {
    if (window !== window.top) return;
    window.__gezien = [];
    const meet = () => {
      for (const [naam, sel] of Object.entries(elementen)) {
        const el = document.querySelector(sel);
        if (el && el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true }) && !window.__gezien.includes(naam)) window.__gezien.push(naam);
      }
    };
    new MutationObserver(meet).observe(document, { subtree: true, childList: true, attributes: true });
    const lus = () => { meet(); requestAnimationFrame(lus); };
    requestAnimationFrame(lus);
    document.addEventListener('readystatechange', meet);
    document.addEventListener('DOMContentLoaded', meet);
  }, ELEMENTEN);
}
const gezien = (page) => page.evaluate(() => window.__gezien);

test.describe('schil: geen flits van een andere rol tijdens de start', () => {
  test('verkoper: tijdens de hele start is geen enkel ticket-element zichtbaar, daarna wel de sales-tabs', async ({ page }) => {
    await zetWaarnemer(page);
    await startSalesApp(page);
    await expect(page.locator('html')).not.toHaveAttribute('data-schil', 'laden');
    await expect(page.locator('.tabs-inner .tab:visible')).toHaveText(['Leads', 'Kalender', 'Route', 'Afgewerkt']);
    await page.clock.runFor(2000);
    expect(await gezien(page)).toEqual([]);
  });

  test('technieker: de tabs Wachtrij en Route zijn nooit zichtbaar geweest; de eigen tabs wel', async ({ page }) => {
    await zetWaarnemer(page);
    await startApp(page, { loginRol: 'technieker', technieker: 'Tim' });
    await expect(page.locator('html')).not.toHaveAttribute('data-schil', 'laden');
    await expect(page.locator('#tab-kalender')).toBeVisible();
    const gezienLijst = await gezien(page);
    expect(gezienLijst).not.toContain('Wachtrij');
    expect(gezienLijst).not.toContain('Route');
  });

  test('beheerder en planner: de schil verschijnt wel (tabs, persoonkeuze) na de start', async ({ page }) => {
    await startApp(page);
    await expect(page.locator('html')).not.toHaveAttribute('data-schil', 'laden');
    await expect(page.locator('#tab-tickets')).toBeVisible();
    await expect(page.locator('#person-sel')).toBeVisible();
  });

  test('geen sessie: de pagina blijft niet verborgen achter een leeg scherm (login-overlay zichtbaar of schil vrijgegeven)', async ({ page }) => {
    await startApp(page, { wachtOpApp: false, overschrijf: { 'auth-ik': () => ({ status: 401, json: { error: 'Niet ingelogd.', code: 'niet-ingelogd' } }) } });
    await expect(page.locator('#login-overlay')).toBeVisible();
  });
});
