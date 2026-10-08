// Rol, tabs en gebruikersmenu (logins T15): de app past zich na de login aan de rol van de gebruiker aan.
// De loginrol komt uit de auth-ik-stub (startApp({ loginRol })); de oude toestelrol (blitz_rol) is daarvan los.
import { test, expect, startApp, opslagStub } from './helpers.mjs';

const tab = (page, naam) => page.getByRole('tab', { name: naam });
const zichtbareTabs = (page) => page.locator('.tabs-inner .tab:visible');
const RAPPORT = { id: 'r1', ticketId: 't1', ticketNumber: '1001', datum: '2026-10-05', technieker: 'Tim', rapportData: { _html: '<p>Rapport</p>' } };

test.describe('tabs per rol', () => {
  test('beheerder ziet 7 tabs, met Beheer', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder' });
    await expect(zichtbareTabs(page)).toHaveCount(7);
    for (const naam of ['Wachtrij', 'Kalender', 'Route', 'Ingepland', 'Inventaris', 'Rapporten', 'Beheer']) await expect(tab(page, naam)).toBeVisible();
    await expect(page.locator('#view-beheer')).toHaveAttribute('role', 'tabpanel');
    await expect(page.locator('#tab-beheer')).toHaveAttribute('data-actie', 'hoofdtab');
  });

  test('planner ziet 6 tabs, zonder Beheer', async ({ page }) => {
    await startApp(page, { loginRol: 'planner' });
    await expect(zichtbareTabs(page)).toHaveCount(6);
    await expect(tab(page, 'Beheer')).toHaveCount(0);
    await expect(page.locator('#tab-beheer')).toHaveCount(0);
  });

  test('technieker ziet Kalender, Ingepland, Inventaris en Rapporten, geen Wachtrij of Route', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker' });
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'technieker');
    await expect(zichtbareTabs(page)).toHaveCount(4);
    for (const naam of ['Kalender', 'Ingepland', 'Inventaris', 'Rapporten']) await expect(tab(page, naam)).toBeVisible();
    for (const naam of ['Wachtrij', 'Route', 'Beheer']) await expect(tab(page, naam)).toHaveCount(0);
    // De verborgen tabs zijn ook voor schermlezers weg (hidden + aria-hidden), niet enkel onzichtbaar.
    await expect(page.locator('#tab-tickets')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#tab-planning')).toHaveAttribute('aria-hidden', 'true');
  });

  test('technieker op een computer met blitz_rol "coordinator": toch de beperkte rol, coördinatorknoppen verborgen', async ({ page }) => {
    await startApp(page, { rol: 'coordinator', loginRol: 'technieker' });
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'technieker');
    await expect(tab(page, 'Kalender')).toBeVisible();
    await tab(page, 'Kalender').click();
    await expect(page.getByRole('button', { name: '⚡ Plan deze week' })).toHaveCount(0);
    await expect(page.locator('#btn-autoplan')).toBeHidden();
    // Ook een latere toestelrolkeuze (Instellingen, Dit toestel) kan dit niet ongedaan maken.
    await page.evaluate(() => window.zetRol('coordinator'));
    await expect(page.locator('html')).toHaveAttribute('data-rol', 'technieker');
  });

  test.describe('tablet', () => {
    test.use({ hasTouch: true });

    test('technieker krijgt geen tablet-rolvraag', async ({ page }) => {
      await startApp(page, { rol: null, loginRol: 'technieker', viewport: { width: 820, height: 1180 } });
      await expect(page.locator('html')).toHaveAttribute('data-rol', 'technieker');
      await expect(page.getByRole('alertdialog', { name: 'Wie gebruikt deze tablet?' })).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('blitz_rol'))).toBeNull();
    });
  });

  test('de technieker opent Rapporten en ziet enkel wat de server teruggeeft (zijn eigen rapporten)', async ({ page }) => {
    await startApp(page, {
      loginRol: 'technieker',
      overschrijf: { 'rapport-archief': opslagStub({ versie: 4, rapports: [RAPPORT] }, 'rapports') },
    });
    await tab(page, 'Rapporten').click();
    await expect(page.locator('#view-rapporten')).toHaveClass(/active/);
    await expect(page.getByRole('button', { name: '📄 Openen' })).toHaveCount(1);
    await expect(page.locator('#rapp-archief-body')).toContainText('1001');
  });

  test('technieker start met blitz_active_person = zijn eigen zohoNaam; een bewuste keuze blijft', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', technieker: 'all' });
    expect(await page.evaluate(() => localStorage.getItem('blitz_active_person'))).toBe('Tim');
    await expect(page.locator('#person-name-hdr')).toHaveText('Tim');
  });

  test('technieker met een eerder gekozen collega blijft op die collega', async ({ page }) => {
    await startApp(page, { loginRol: 'technieker', technieker: 'Roel' });
    expect(await page.evaluate(() => localStorage.getItem('blitz_active_person'))).toBe('Roel');
  });
});

test.describe('sales', () => {
  test('toont de plaatshouder en roept geen enkele planning-API aan', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'sales', loginGebruiker: { naam: 'Test Verkoper' } });
    await expect(page.getByRole('heading', { name: 'Het sales-gedeelte volgt' })).toBeVisible();
    await expect(zichtbareTabs(page)).toHaveCount(0);
    await expect(page.locator('#view-tickets')).toBeHidden();
    // Het gebruikersmenu is er wel (uitloggen moet kunnen).
    await expect(page.locator('#gebruiker-sel .gebruiker-btn')).toBeVisible();
    // Genoeg tijd laten verstrijken zodat een opstart die toch zou lopen zijn verzoeken heeft gedaan.
    await page.clock.runFor(10000);
    await page.evaluate(() => Promise.resolve());
    expect(verzoeken.alle.filter(r => r.pad !== '/api/auth-ik')).toEqual([]);
    expect(verzoeken.van('/api/tickets')).toEqual([]);
  });
});

test.describe('gebruikersmenu', () => {
  test('toont de naam als tekst (geen HTML), de rol en de beheerderslink', async ({ page }) => {
    await startApp(page, { loginRol: 'beheerder', loginGebruiker: { naam: '<b>x</b> Jansen' } });
    const knop = page.locator('.gebruiker-btn');
    await expect(knop).toHaveAttribute('aria-expanded', 'false');
    await knop.click();
    await expect(knop).toHaveAttribute('aria-expanded', 'true');
    const menu = page.locator('.gebruiker-menu');
    await expect(menu.locator('.gm-naam')).toHaveText('<b>x</b> Jansen');
    await expect(menu.locator('.gm-rol')).toHaveText('Beheerder');
    await expect(menu.locator('b')).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Wachtwoord wijzigen' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Beheer' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Uitloggen' })).toBeVisible();
  });

  test('een planner krijgt geen Beheer-link', async ({ page }) => {
    await startApp(page, { loginRol: 'planner' });
    await page.locator('.gebruiker-btn').click();
    await expect(page.locator('.gebruiker-menu').getByRole('menuitem', { name: 'Uitloggen' })).toBeVisible();
    await expect(page.locator('.gebruiker-menu').getByRole('menuitem', { name: 'Beheer' })).toHaveCount(0);
  });

  test('Escape en een klik buiten het menu sluiten het', async ({ page }) => {
    await startApp(page, { loginRol: 'planner' });
    const knop = page.locator('.gebruiker-btn');
    await knop.click();
    await expect(page.locator('.gebruiker-menu')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.gebruiker-menu')).not.toHaveClass(/open/);
    await expect(knop).toBeFocused();
    await knop.click();
    await page.locator('#hoofdinhoud').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.gebruiker-menu')).not.toHaveClass(/open/);
  });

  test('Wachtwoord wijzigen opent het wijzigscherm met Annuleren', async ({ page }) => {
    await startApp(page, { loginRol: 'planner' });
    await page.locator('.gebruiker-btn').click();
    await page.getByRole('menuitem', { name: 'Wachtwoord wijzigen' }).click();
    const overlay = page.locator('#login-overlay');
    await expect(overlay.getByRole('heading', { name: 'Wachtwoord wijzigen' })).toBeVisible();
    await overlay.getByRole('button', { name: 'Annuleren' }).click();
    await expect(overlay).toHaveCount(0);
  });

  test('Uitloggen roept auth-uitloggen aan en herlaadt de pagina (daarna het loginscherm)', async ({ page, verzoeken }) => {
    let uitgelogd = false;
    const ingelogd = { gebruiker: { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder' }, rechten: { beheer: true, plannen: true, alleSales: true }, moetWachtwoordWijzigen: false, lokaleDev: false };
    await startApp(page, {
      loginRol: 'beheerder',
      overschrijf: {
        'auth-ik': () => (uitgelogd ? { status: 401, json: { error: 'Niet ingelogd', code: 'niet-ingelogd', setupNodig: false } } : { status: 200, json: ingelogd }),
        'auth-uitloggen': () => { uitgelogd = true; return { status: 200, json: { ok: true } }; },
      },
    });
    await page.locator('.gebruiker-btn').click();
    await page.getByRole('menuitem', { name: 'Uitloggen' }).click();
    await expect(page.locator('#login-overlay').getByRole('heading', { name: 'Inloggen' })).toBeVisible();
    expect(verzoeken.van('/api/auth-uitloggen', 'POST')).toHaveLength(1);
    expect(verzoeken.van('/api/auth-ik', 'GET').length).toBeGreaterThanOrEqual(2);
  });
});
