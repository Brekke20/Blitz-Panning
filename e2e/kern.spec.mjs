import { test, expect, startApp } from './helpers.mjs';

test.describe('kern: ui-delegatie', () => {
  test('vernieuwen-knop toont testmodus-toast na startup', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const toast = page.locator('#toast');
    // Wacht tot startup-toast verdwenen is (tot 8s, startup toast is 4s)
    await expect(toast).not.toHaveClass(/show/, { timeout: 8000 });

    // Klik vernieuwen
    await page.locator('button[data-actie="vernieuw"]').click();

    // Toast moet verschijnen met "Testmodus"
    await expect(toast).toHaveClass(/show/);
    await expect(toast).toContainText('Testmodus actief');

    // Ticket-teller moet nog 3 zijn (Testmodus laadt niet echt)
    await expect(page.locator('#cnt-tickets')).toContainText('3');
  });

  test('persoonmenu opent en sluit via delegatie', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const personBtn = page.locator('#person-btn');
    const personMenu = page.locator('#person-menu');

    // Menu gesloten
    await expect(personMenu).not.toHaveClass(/open/);

    // Klik button → open
    await personBtn.click();
    await expect(personMenu).toHaveClass(/open/);

    // Klik button → dicht
    await personBtn.click();
    await expect(personMenu).not.toHaveClass(/open/);
  });

  test('persoonmenu sluit bij klik buiten', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const personBtn = page.locator('#person-btn');
    const personMenu = page.locator('#person-menu');

    // Open menu
    await personBtn.click();
    await expect(personMenu).toHaveClass(/open/);

    // Klik ergens neutraal (op de main content area)
    await page.locator('main').click();

    // Menu moet dicht zijn
    await expect(personMenu).not.toHaveClass(/open/);
  });

  test('instellingen opent instellingenvenster', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    // Klik op instellingen-knop
    await page.locator('button[data-actie="instellingen"]').click();

    // Controleer dat het instellingenvenster opent
    const instellingenDlg = page.getByRole('dialog', { name: /Instellingen|Voorkeuren/ });
    await expect(instellingenDlg).toBeVisible();
  });

  test('kalender-navigatie: › navigeert, ‹ terug, vandaag herstelt', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    // Zorg dat kalender tab zichtbaar is
    await page.getByRole('tab', { name: 'Kalender' }).click();

    const kalLabel = page.locator('#kal-label');
    await expect(kalLabel).toBeVisible();

    // Onthoud de originele tekst
    const originalText = await kalLabel.textContent();

    // Stap 1: Navigeer weg met › (twee keer)
    await expect(page.getByRole('button', { name: 'Volgende periode' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Volgende periode' }).first().click();
    await expect(kalLabel).not.toHaveText(originalText);

    await page.getByRole('button', { name: 'Volgende periode' }).first().click();
    await expect(kalLabel).not.toHaveText(originalText);

    // Stap 2: Klik "Naar vandaag" en controleer origineel hersteld
    await page.locator('button[data-actie="kal-vandaag"]').click();
    await expect(kalLabel).toHaveText(originalText);

    // Stap 3: Navigeer weg met › en terug met ‹
    await page.getByRole('button', { name: 'Volgende periode' }).first().click();
    await expect(kalLabel).not.toHaveText(originalText);

    await page.getByRole('button', { name: 'Vorige periode' }).first().click();
    await expect(kalLabel).toHaveText(originalText);
  });

  test('thema-wissel werkt', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });

    const html = page.locator('html');
    const originalTheme = await html.getAttribute('data-theme');

    // Klik thema-wissel
    await page.locator('button[data-actie="thema"]').click();

    // Theme moet veranderd zijn
    const newTheme = await html.getAttribute('data-theme');
    expect(newTheme).not.toBe(originalTheme);

    // Klik nog een keer terug
    await page.locator('button[data-actie="thema"]').click();

    const restoredTheme = await html.getAttribute('data-theme');
    expect(restoredTheme).toBe(originalTheme);
  });
});

// ── kern: renders ─────────────────────────────────────────────────────────────
// Telt hoe vaak de vier hoofdschermen hertekend worden. De aantallen leggen het gedrag vast: de
// koppeling aan de toestand (koppelRenders) mag ze niet verhogen. Een renderlus zou bovendien
// 'toestand: renderlus afgebroken' op de console zetten, wat de vangnetcontrole laat falen.
const RENDERS = ['renderKalender', 'renderTickets', 'renderGepland', 'renderRouteList'];

async function installeerTellers(page) {
  await page.evaluate((namen) => {
    window.__n = {};
    for (const naam of namen) {
      const oud = window[naam];
      window.__n[naam] = 0;
      window[naam] = (...a) => { window.__n[naam]++; return oud(...a); };
    }
  }, RENDERS);
}
const nulTellers = (page) => page.evaluate(() => { for (const k of Object.keys(window.__n)) window.__n[k] = 0; });
const tellers = (page) => page.evaluate(() => ({ ...window.__n }));

test.describe('kern: renders', () => {
  test('technieker wisselen: elke hoofdrender precies 1 keer', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await installeerTellers(page);
    await page.locator('#person-btn').click();
    await page.locator('#person-menu .pm-item', { hasText: 'Tim' }).click();
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    await expect.poll(() => tellers(page)).toEqual({ renderKalender: 1, renderTickets: 1, renderGepland: 1, renderRouteList: 1 });
    // Blijft stabiel: geen late extra renders.
    await page.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 100)));
    expect(await tellers(page)).toEqual({ renderKalender: 1, renderTickets: 1, renderGepland: 1, renderRouteList: 1 });
  });

  test('Vernieuwen: elke hoofdrender precies 1 keer', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await installeerTellers(page);
    await page.locator('button[data-actie="vernieuw"]').click();
    await expect(page.locator('#toast')).toContainText('Testmodus actief');
    await expect.poll(() => tellers(page)).toEqual({ renderKalender: 1, renderTickets: 1, renderGepland: 1, renderRouteList: 1 });
    await page.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 100)));
    expect(await tellers(page)).toEqual({ renderKalender: 1, renderTickets: 1, renderGepland: 1, renderRouteList: 1 });
  });

  test('eigen afspraak toevoegen: kalender 1 keer, wachtrij niet', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    await page.getByRole('tab', { name: 'Kalender' }).click();
    await installeerTellers(page);
    await page.getByRole('button', { name: '➕ Afspraak' }).click();
    const modal = page.locator('#manueel-overlay');
    await expect(modal).toHaveClass(/open/);
    await modal.getByLabel('Titel *').fill('Teltest');
    await modal.getByLabel('Datum *').fill('2026-10-06');
    await modal.getByLabel('Van *').fill('10:00');
    await modal.getByLabel('Tot *').fill('11:00');
    await nulTellers(page);
    await modal.getByRole('button', { name: 'Opslaan' }).click();
    await expect(page.locator('#toast')).toContainText('Afspraak opgeslagen');
    expect(await tellers(page)).toEqual({ renderKalender: 1, renderTickets: 0, renderGepland: 0, renderRouteList: 0 });
  });

  test('onbekende opgeslagen technieker valt terug op Alle zonder renderlus', async ({ page }) => {
    // Tellers vóór het opstarten van de app: DOMContentLoaded-luisteraar van de test loopt vóór die van de app.
    await page.addInitScript(({ namen }) => {
      if (window !== window.top) return;
      try { localStorage.setItem('blitz_active_person', 'Onbekend'); } catch {}
      window.__n = {};
      document.addEventListener('DOMContentLoaded', () => {
        for (const naam of namen) {
          const oud = window[naam];
          window.__n[naam] = 0;
          window[naam] = (...a) => { window.__n[naam]++; return oud(...a); };
        }
      });
    }, { namen: RENDERS });
    await startApp(page, { rol: 'coordinator', technieker: 'all' });
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    await expect(page.locator('#person-name-hdr')).toHaveText('Alle');
    expect(await page.evaluate(() => localStorage.getItem('blitz_active_person'))).toBe('all');
    expect(await page.evaluate(() => window.activeAssigneeFilter)).toBe('all');
    await page.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 150)));
    // Opstart: precies één render per scherm door de dataload (één ronde, ondanks de filterreset);
    // kalender: dataload + afspraken + beschikbaarheid + apparaat/rol (4). Een tweede ronde door de reset verhoogt dit.
    const t = await tellers(page);
    expect(t.renderTickets).toBe(1);
    expect(t.renderGepland).toBe(1);
    expect(t.renderRouteList).toBe(1);
    expect(t.renderKalender).toBe(4);
  });

  test('laatste wachtrij-ticket van een technieker inplannen laat diens filter staan', async ({ page }) => {
    await startApp(page, { rol: 'coordinator', technieker: 'Roel' }); // Roel heeft precies 1 wachtrij-ticket (t3)
    await expect(page.locator('#person-name-hdr')).toHaveText('Roel');
    await page.evaluate(() => addTicketToDate('t3', '2026-10-06'));
    await expect(page.locator('#cnt-tickets')).toHaveText('0');
    await page.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 100)));
    await expect(page.locator('#person-name-hdr')).toHaveText('Roel');
    expect(await page.evaluate(() => localStorage.getItem('blitz_active_person'))).toBe('Roel');
    expect(await page.evaluate(() => window.activeAssigneeFilter)).toBe('Roel');
  });

  test('inplannen en terugzetten: geen verouderd scherm, renders blijven eindig', async ({ page }) => {
    await startApp(page, { rol: 'coordinator' });
    const id = await page.evaluate(() => allTickets[0].id);
    await installeerTellers(page);

    await page.evaluate(([id]) => addTicketToDate(id, '2026-10-06'), [id]);
    await expect(page.locator('#cnt-tickets')).toHaveText('2');
    await expect(page.locator('#ticket-list .ticket')).toHaveCount(2);
    // wachtrij en kalender: optimistische render + render na de toewijzing; route: alleen na de toewijzing
    await expect.poll(() => tellers(page)).toEqual({ renderKalender: 2, renderTickets: 2, renderGepland: 0, renderRouteList: 1 });

    await nulTellers(page);
    await page.evaluate(([id]) => removeTicketFromDate(id, '2026-10-06'), [id]);
    await expect(page.locator('#cnt-tickets')).toHaveText('3');
    await expect(page.locator('#ticket-list .ticket')).toHaveCount(3);
    await page.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 100)));
    // zoals voorheen 2x wachtrij/kalender en 1x ingepland; de route krijgt na de optimistische render nu ook
    // de render van het abonnement (allTickets/allPending/allGepland wijzigden): 2 i.p.v. 1
    expect(await tellers(page)).toEqual({ renderKalender: 2, renderTickets: 2, renderGepland: 1, renderRouteList: 2 });
  });
});
