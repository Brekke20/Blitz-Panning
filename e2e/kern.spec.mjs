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

// ── kern: api-payloads ────────────────────────────────────────────────────────
// Legt de volledige request (methode, body, Content-Type, testheader) vast van de /api-aanroepen die via
// kern/api.js lopen. Eerst op de oude fetch-code geschreven, daarna blijft de test ongewijzigd groen.
// Niet gedekt (bewust): /api/planning-sinds, want laadPlanningSinds() doet niets in testmodus (?test).
const JSON_CT = 'application/json';

async function planWeek(page) {
  await page.getByRole('tab', { name: 'Kalender' }).click();
  await page.getByRole('button', { name: '⚡ Plan deze week' }).click();
  const resultaat = page.getByRole('dialog', { name: '⚡ Planningsresultaat' });
  await expect(resultaat.getByText('Ingepland (2)', { exact: true })).toBeVisible();
  await resultaat.getByRole('button', { name: 'Sluiten' }).click();
  await expect(resultaat).toBeHidden();
}

async function openRouteVanMaandag(page) {
  await planWeek(page);
  const maandag = page.locator('.day-col').filter({ hasText: '#1001' });
  await expect(maandag).toHaveCount(1);
  await maandag.getByRole('button', { name: 'Route berekenen' }).click();
  await expect(page.getByTestId('route-stop-tijd')).toHaveCount(2);
}

test.describe('kern: api-payloads', () => {
  test('laad-verzoeken zijn GET zonder body en zonder Content-Type, met de testheader', async ({ page, verzoeken }) => {
    await startApp(page, { rol: 'coordinator' });
    for (const pad of ['/api/voorstel-status', '/api/afspraken', '/api/availability', '/api/klantbeschikbaarheid']) {
      const r = verzoeken.van(pad, 'GET');
      expect(r.length, pad).toBeGreaterThanOrEqual(1);
      expect(r[0], pad).toEqual({ methode: 'GET', pad, body: null, headers: { 'content-type': null, 'x-blitz-test': '1' } });
    }
  });

  test('beschikbaarheid bewaren: PUT met versie en exceptions', async ({ page, verzoeken }) => {
    await startApp(page, { rol: 'coordinator' });
    const ex = { id: 'ex-1', scope: 'all', person: null, date: '2026-10-09', kind: 'full', from: null, to: null, reason: 'Test' };
    const ok = await page.evaluate(async (e) => { avExceptions = [e]; return saveAvailability(); }, ex);
    expect(ok).toBe(true);
    const puts = verzoeken.van('/api/availability', 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ versie: 0, exceptions: [ex] });
    expect(puts[0].headers).toEqual({ 'content-type': JSON_CT, 'x-blitz-test': '1' });
    expect(await page.evaluate(() => avVersie)).toBe(1);
  });

  test('plan deze week: matrix-verzoek volledig', async ({ page, verzoeken }) => {
    await startApp(page, { technieker: 'Tim' });
    await planWeek(page);
    const matrix = verzoeken.van('/api/matrix', 'POST');
    expect(matrix.length).toBeGreaterThanOrEqual(1);
    expect(matrix[0]).toEqual({
      methode: 'POST', pad: '/api/matrix',
      body: {
        origin: { lat: 51.162, lon: 4.989 },
        destinations: [{ lat: 50.9307, lon: 5.3325 }],
        departAt: '2026-10-05T08:00:00.000Z',
      },
      headers: { 'content-type': JSON_CT, 'x-blitz-test': '1' },
    });
  });

  test('route: optimize, route en drukte volledig', async ({ page, verzoeken }) => {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      if (localStorage.getItem('blitz_settings_Tim') === null) localStorage.setItem('blitz_settings_Tim', JSON.stringify({ vanTijd: '10:00' }));
    });
    await startApp(page, { technieker: 'Tim' });
    await openRouteVanMaandag(page);
    await expect.poll(() => verzoeken.van('/api/drukte', 'POST').length).toBe(1);
    const headers = { 'content-type': JSON_CT, 'x-blitz-test': '1' };
    const OPTIMIZE = {
      methode: 'POST', pad: '/api/optimize', headers,
      body: { origin: 'Heirbaan 9, 9150 Kruibeke', stops: ['Antwerpseweg 50, 2440 Geel', 'Kuringersteenweg 12, 3500 Hasselt'] },
    };
    // calculateRoute: geocoderen, route en drukte-detail
    expect(verzoeken.van('/api/optimize', 'POST')).toEqual([OPTIMIZE]);
    expect(verzoeken.van('/api/route', 'POST')).toEqual([{
      methode: 'POST', pad: '/api/route', headers,
      body: { waypoints: [{ lat: 51.1, lon: 4.9 }, { lat: 51.12, lon: 4.93 }, { lat: 51.14, lon: 4.96 }], departAt: '2026-10-05T08:00:00.000Z' },
    }]);
    expect(verzoeken.van('/api/drukte', 'POST')).toEqual([{
      methode: 'POST', pad: '/api/drukte', headers,
      body: { polyline: [[51.1, 4.9], [51.12, 4.93], [51.14, 4.96]], departAt: '2026-10-05T08:00:00.000Z', segmentMeters: 1500 },
    }]);
    // optimizeRoute (knop ⚡ Optimaliseer): zelfde optimize-verzoek
    await page.getByRole('button', { name: '⚡ Optimaliseer' }).click();
    await expect.poll(() => verzoeken.van('/api/optimize', 'POST').length).toBe(2);
    expect(verzoeken.van('/api/optimize', 'POST')[1]).toEqual(OPTIMIZE);
  });

  test('route: serverfout met onleesbaar antwoord toont "HTTP <status>"', async ({ page, consoleFouten }) => {
    await page.addInitScript(() => {
      if (window !== window.top) return;
      if (localStorage.getItem('blitz_settings_Tim') === null) localStorage.setItem('blitz_settings_Tim', JSON.stringify({ vanTijd: '10:00' }));
    });
    await startApp(page, {
      technieker: 'Tim',
      overschrijf: { route: () => ({ status: 502, raw: '<html>Bad Gateway</html>' }) },
    });
    await planWeek(page);
    await page.locator('.day-col').filter({ hasText: '#1001' }).getByRole('button', { name: 'Route berekenen' }).click();
    await expect(page.getByText('✕ Route: HTTP 502')).toBeVisible();
    // De 502 is hier bedoeld: de browser meldt hem als HTTP 502 en als consolefout; precies die twee halen we weg.
    const isDeze = (f) => f.includes('/api/route') && /502/.test(f);
    await expect.poll(() => consoleFouten.filter(isDeze).length).toBe(2);
    for (const f of consoleFouten.filter(isDeze)) consoleFouten.splice(consoleFouten.indexOf(f), 1);
  });
});
