// Beheer per rol: de beheerder ziet alle subtabs; de planner en de sales manager (sales + "Sales manager"-vinkje) zien enkel
// Instellingen en Performance. De planner ziet in Performance enkel het techniekers-deel, de sales manager enkel het sales-deel.
// Instellingen en gebruikers draaien tegen de ECHTE server-handlers (e2e/sales-hulp.mjs: een 403 komt van de echte rechtenregels);
// het dashboard is een stub op basis van e2e/fixtures/dashboard.json, in de vorm die de server per rol teruggeeft
// (de server-tests in tests/server-dashboard.test.mjs controleren die vorm). Alle gegevens zijn verzonnen.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { test, expect, startApp, opslagStub } from './helpers.mjs';
import { startSalesApp, maakSalesBackend, authIkVoor, verwachtFout, SALES_GEBRUIKER, BEHEERDER } from './sales-hulp.mjs';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';

const MAP = path.dirname(url.fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(fs.readFileSync(path.join(MAP, 'fixtures', 'dashboard.json'), 'utf8'));
const json = (status, obj) => ({ status, json: obj });

const PLANNER = Object.freeze({ id: 'u-test', email: 'p@test.be', naam: 'Test Planner', rol: 'planner', actief: true });
const ANDERE = Object.freeze([
  { id: 'u-tim', email: 'tim@test.be', naam: 'Tim Techniek', rol: 'technieker', zohoNaam: 'Tim', actief: true },
  { id: 'u-roel', email: 'roel@test.be', naam: 'Roel Techniek', rol: 'technieker', zohoNaam: 'Roel', actief: true },
  { id: 'u-pia', email: 'pia@test.be', naam: 'Pia Planner', rol: 'planner', actief: true },
  { id: 'u-bea', email: 'bea@test.be', naam: 'Bea Verkoper', rol: 'sales', salesNaam: 'Bea V.', magAlleSales: false, actief: true },
  { id: 'u-carl', email: 'carl@test.be', naam: 'Carl Verkoper', rol: 'sales', salesNaam: 'Carl V.', magAlleSales: false, actief: true },
  { id: 'u-chef', email: 'chef@test.be', naam: 'Chef Beheer', rol: 'beheerder', actief: true },
]);
const MANAGER = Object.freeze({ ...SALES_GEBRUIKER, magAlleSales: true });

// Het dashboardantwoord zoals de server het per rol geeft (planner: zonder sales; sales manager: enkel sales).
const dashboardVoor = (rol) => () => {
  const d = structuredClone(FIXTURE);
  if (rol === 'planner') {
    delete d.sales; delete d.dekking.sales; d.deel = 'techniekers';
  }
  if (rol === 'sales') {
    return json(200, { versie: d.versie, gegenereerd: d.gegenereerd, periode: d.periode, vorige: d.vorige, deel: 'sales', filters: { van: d.filters.van, tot: d.filters.tot }, sales: d.sales, dekking: { sales: d.dekking.sales, fouten: [] } });
  }
  return json(200, d);
};
const grenzenStub = () => opslagStub({ versie: 1, grenzen: structuredClone(STANDAARD_GRENZEN) }, 'grenzen');

const subtabs = (page) => page.locator('.beheer-tabs [role="tab"]');
const kopjes = (page) => page.locator('.dash-blok-kop');
const openBeheer = async (page) => { await page.getByRole('tab', { name: 'Beheer', exact: true }).click(); await expect(page.locator('.beheer-tabs')).toBeVisible(); };

async function startPlanner(page, extra = {}) {
  const backend = maakSalesBackend({ gebruiker: PLANNER, verkopers: ANDERE });
  await startApp(page, {
    loginRol: 'planner',
    overschrijf: { 'auth-ik': authIkVoor(PLANNER), ...backend.stubs, dashboard: dashboardVoor('planner'), 'dashboard-instellingen': grenzenStub(), ...extra },
  });
  return backend;
}

test.describe('Beheer: planner', () => {
  test('ziet Beheer met precies twee subtabs, Instellingen en Performance; de rest is er niet', async ({ page, verzoeken }) => {
    await startPlanner(page);
    await openBeheer(page);
    await expect(subtabs(page)).toHaveText(['Instellingen', 'Performance']);
    for (const naam of ['Gebruikers', 'Activiteitenlog', 'Systeemstatus']) await expect(page.getByRole('tab', { name: naam, exact: true })).toHaveCount(0);
    // geen enkel verzoek naar de beheerdersonderdelen
    for (const pad of ['/api/activiteit', '/api/systeemstatus', '/api/zoho-agenten', '/api/client-log']) expect(verzoeken.van(pad), pad).toEqual([]);
    expect(verzoeken.van('/api/gebruikers', 'POST')).toEqual([]);
  });

  test('Instellingen: enkel techniekers en hijzelf in de lijst (geen beheerder, sales of andere planner); de instelling van een technieker aanpassen bewaart die voor hem', async ({ page, verzoeken }) => {
    const backend = await startPlanner(page);
    await openBeheer(page);
    await expect(page.getByRole('tab', { name: 'Instellingen', exact: true })).toHaveAttribute('aria-selected', 'true');
    const kies = page.getByLabel('Gebruiker', { exact: true });
    const opties = await kies.locator('option').allTextContents();
    expect(opties.sort()).toEqual(['Roel Techniek (Technieker)', 'Test Planner (Planner)', 'Tim Techniek (Technieker)'].sort());
    const tekst = JSON.stringify(opties);
    for (const verboden of ['Chef', 'Bea', 'Carl', 'Pia']) expect(tekst).not.toContain(verboden);
    // het antwoord van /api/gebruikers bevat geen e-mailadres
    const lijst = verzoeken.van('/api/gebruikers', 'GET')[0];
    expect(lijst).toBeTruthy();
    const antwoord = await page.evaluate(async () => (await fetch('/api/gebruikers', { headers: { 'x-blitz-test': '1' } })).text());
    expect(antwoord).not.toContain('@');
    expect(antwoord).not.toContain('email');

    await kies.selectOption('u-tim');
    await expect(page.locator('#bi-max')).toBeEnabled();
    await page.locator('#bi-max').fill('7');
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen voor Tim Techniek');
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(1);
    const put = verzoeken.van('/api/instellingen', 'PUT')[0].body;
    expect(put.gebruiker).toBe('u-tim');
    expect(put.instellingen.maxPerDag).toBe(7);
    const bewaard = await backend.test.get('instellingen', { type: 'json' });
    expect(bewaard.perGebruiker['u-tim'].maxPerDag).toBe(7);
    expect(Object.keys(bewaard.perGebruiker)).toEqual(['u-tim']);
  });

  test('de server weigert een planner die de instellingen van een verkoper, beheerder of andere planner leest of bewaart (403)', async ({ page, consoleFouten }) => {
    await startPlanner(page);
    await openBeheer(page);
    const resultaten = await page.evaluate(async () => {
      const uit = {};
      for (const id of ['u-bea', 'u-chef', 'u-pia']) {
        const lees = await fetch(`/api/instellingen?gebruiker=${id}`, { headers: { 'x-blitz-test': '1' } });
        const schrijf = await fetch('/api/instellingen', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-blitz': '1', 'x-blitz-test': '1' }, body: JSON.stringify({ gebruiker: id, instellingen: { maxPerDag: 3 } }) });
        uit[id] = [lees.status, schrijf.status];
      }
      return uit;
    });
    expect(resultaten).toEqual({ 'u-bea': [403, 403], 'u-chef': [403, 403], 'u-pia': [403, 403] });
    await verwachtFout(consoleFouten, '/api/instellingen', 403, 6); // de bedoelde 403's zijn geen echte fouten
  });

  test('Performance: enkel het techniekers-deel (zes tegels, vier blokken, geen Sales), geen kleurgrenzen-paneel en niets schrijfbaars', async ({ page, verzoeken }) => {
    await startPlanner(page);
    await openBeheer(page);
    await page.getByRole('tab', { name: 'Performance', exact: true }).click();
    await expect(page.locator('.dash')).toBeVisible();
    await expect(page.locator('.tegels > .tegel')).toHaveCount(6);
    expect(await kopjes(page).allTextContents()).toEqual(['Tijd & stiptheid', 'Kwaliteit', 'Onderdelen', 'Klant & planning']);
    await expect(page.locator('.dash-blok--sales')).toHaveCount(0);
    await expect(page.locator('.dash-instellingen')).toHaveCount(0);
    await expect(page.locator('.dash-filters [data-arg="technieker"]')).toBeVisible();
    expect(verzoeken.van('/api/dashboard', 'GET').length).toBeGreaterThanOrEqual(1);
    expect(verzoeken.van('/api/dashboard-instellingen', 'PUT')).toEqual([]);
  });

  test('een opgeslagen keuze voor een verboden subtab (Gebruikers) landt op Instellingen', async ({ page }) => {
    await page.addInitScript(() => { if (window === window.top) sessionStorage.setItem('blitz_beheer_tab', 'gebruikers'); });
    await startPlanner(page);
    await openBeheer(page);
    await expect(page.getByRole('tab', { name: 'Instellingen', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Gebruikers', exact: true })).toHaveCount(0);
  });

  test('de laatst gekozen subtab (Performance) wordt onthouden bij het opnieuw openen van Beheer', async ({ page }) => {
    await startPlanner(page);
    await openBeheer(page);
    await page.getByRole('tab', { name: 'Performance', exact: true }).click();
    await expect(page.locator('.dash')).toBeVisible();
    await page.getByRole('tab', { name: 'Kalender', exact: true }).click();
    await openBeheer(page);
    await expect(page.getByRole('tab', { name: 'Performance', exact: true })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('Beheer: sales manager', () => {
  async function startManager(page, extra = {}) {
    return startSalesApp(page, {
      gebruiker: MANAGER, verkopers: [...ANDERE],
      overschrijf: { dashboard: dashboardVoor('sales'), ...extra },
    });
  }

  test('ziet naast Leads, Kalender, Route en Afgewerkt de tab Beheer, met precies Instellingen en Performance', async ({ page }) => {
    await startManager(page);
    await expect(page.locator('.tabs-inner .tab:visible')).toHaveText(['Leads', 'Kalender', 'Route', 'Afgewerkt', 'Beheer']);
    await openBeheer(page);
    await expect(subtabs(page)).toHaveText(['Instellingen', 'Performance']);
  });

  test('een gewone verkoper (zonder het vinkje Sales manager) heeft geen Beheer', async ({ page }) => {
    await startSalesApp(page, { verkopers: [...ANDERE] });
    await expect(page.locator('.tabs-inner .tab:visible')).toHaveText(['Leads', 'Kalender', 'Route', 'Afgewerkt']);
    await expect(page.locator('#tab-beheer')).toHaveCount(0);
  });

  test('Instellingen: enkel verkopers in de lijst (geen technieker, planner of beheerder) en een verkoper aanpassen bewaart die', async ({ page, verzoeken }) => {
    const backend = await startManager(page);
    await openBeheer(page);
    const kies = page.getByLabel('Gebruiker', { exact: true });
    const opties = await kies.locator('option').allTextContents();
    expect(opties.sort()).toEqual(['Bea Verkoper (Sales)', 'Carl Verkoper (Sales)', 'Test Verkoper (Sales)'].sort());
    for (const verboden of ['Tim', 'Roel', 'Pia', 'Chef']) expect(JSON.stringify(opties)).not.toContain(verboden);
    const antwoord = await page.evaluate(async () => (await fetch('/api/gebruikers', { headers: { 'x-blitz-test': '1' } })).text());
    expect(antwoord).not.toContain('@');

    await kies.selectOption('u-bea');
    await page.locator('#bi-bezoek').fill('45');
    await page.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Instellingen opgeslagen voor Bea Verkoper');
    await expect.poll(() => verzoeken.van('/api/instellingen', 'PUT').length).toBe(1);
    expect(verzoeken.van('/api/instellingen', 'PUT')[0].body.gebruiker).toBe('u-bea');
    const bewaard = await backend.test.get('instellingen', { type: 'json' });
    expect(bewaard.perGebruiker['u-bea'].bezoekDuurMin).toBe(45);
  });

  test('de server weigert een sales manager de instellingen van een technieker, planner of beheerder (403)', async ({ page, consoleFouten }) => {
    await startManager(page);
    await openBeheer(page);
    const resultaten = await page.evaluate(async () => {
      const uit = {};
      for (const id of ['u-tim', 'u-pia', 'u-chef']) {
        const lees = await fetch(`/api/instellingen?gebruiker=${id}`, { headers: { 'x-blitz-test': '1' } });
        const schrijf = await fetch('/api/instellingen', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-blitz': '1', 'x-blitz-test': '1' }, body: JSON.stringify({ gebruiker: id, instellingen: { maxPerDag: 3 } }) });
        uit[id] = [lees.status, schrijf.status];
      }
      return uit;
    });
    expect(resultaten).toEqual({ 'u-tim': [403, 403], 'u-pia': [403, 403], 'u-chef': [403, 403] });
    await verwachtFout(consoleFouten, '/api/instellingen', 403, 6);
  });

  test('Performance: enkel het sales-deel (geen tegels, geen technieker-, type- of herhaalfilter) en geen verzoek naar de kleurgrenzen', async ({ page, verzoeken }) => {
    await startManager(page);
    await openBeheer(page);
    await page.getByRole('tab', { name: 'Performance', exact: true }).click();
    await expect(page.locator('.dash')).toBeVisible();
    expect(await kopjes(page).allTextContents()).toEqual(['Sales']);
    await expect(page.locator('.tegels')).toHaveCount(0);
    await expect(page.locator('.dash-blok--sales .donut')).toBeVisible();
    await expect(page.locator('.dash-filters [data-arg="technieker"]')).toHaveCount(0);
    await expect(page.locator('.dash-filters [data-arg="type"]')).toHaveCount(0);
    await expect(page.locator('.dash-filters [data-arg="herhaalDagen"]')).toHaveCount(0);
    await expect(page.locator('.dash-filters [data-arg="van"]')).toBeVisible(); // wel de periode
    await expect(page.getByRole('button', { name: 'Deze maand', exact: true })).toBeVisible();
    await expect(page.locator('.dash-instellingen')).toHaveCount(0);
    expect(verzoeken.van('/api/dashboard-instellingen')).toEqual([]);
  });
});

test.describe('Beheer: beheerder (ongewijzigd)', () => {
  test('ziet alle vijf de subtabs en in Performance alle vijf de blokken, de tegels en het kleurgrenzen-paneel', async ({ page }) => {
    const backend = maakSalesBackend({ gebruiker: BEHEERDER, verkopers: ANDERE });
    await startApp(page, {
      loginRol: 'beheerder',
      overschrijf: {
        'auth-ik': authIkVoor(BEHEERDER), ...backend.stubs, dashboard: dashboardVoor('beheerder'), 'dashboard-instellingen': grenzenStub(),
        activiteit: () => json(200, { items: [], gebruikers: [] }), systeemstatus: () => json(200, { zoho: { ok: true, tijdstip: '2026-10-08T10:00:00.000Z' }, foutenlog: [], rapporten: { mislukt: [] } }),
      },
    });
    await openBeheer(page);
    await expect(subtabs(page)).toHaveText(['Gebruikers', 'Instellingen', 'Activiteitenlog', 'Systeemstatus', 'Performance']);
    await page.getByRole('tab', { name: 'Performance', exact: true }).click();
    await expect(page.locator('.dash')).toBeVisible();
    await expect(page.locator('.tegels > .tegel')).toHaveCount(6);
    expect(await kopjes(page).allTextContents()).toEqual(['Tijd & stiptheid', 'Kwaliteit', 'Onderdelen', 'Klant & planning', 'Sales']);
    await expect(page.locator('.dash-instellingen')).toBeVisible();
  });
});
