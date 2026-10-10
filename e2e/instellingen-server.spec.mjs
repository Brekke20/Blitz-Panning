import { test, expect, startApp } from './helpers.mjs';

// Instellingen van de server (logins T16): de server is de bron, localStorage blijft de synchrone cache.
// De stub bootst GET /api/instellingen?overzicht=1 en PUT /api/instellingen na. Testklok: maandag 5 okt 2026.

const leesOpslag = (page, sleutel) => page.evaluate((k) => localStorage.getItem(k), sleutel);
const leesJson = async (page, sleutel) => JSON.parse(await leesOpslag(page, sleutel));
const toastTekst = (page) => page.locator('#toast');
const venster = (page) => page.getByRole('dialog', { name: '⚙️ Instellingen' });

async function openInstellingen(page) {
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  await expect(venster(page)).toBeVisible();
  return venster(page);
}

const SERVER = { startlocatie: 'Teststraat 1', duurMinuten: 90, maxPerDag: 5, vanTijd: '08:00', totTijd: '17:00', laatsteStart: '15:30', werkdagen: [1, 2, 3, 4, 5], maxReistijdMin: 40, tijdslotMinuten: 180, routeKleur: '#f59e0b', drukteKleuring: true };
const TECHNIEKERS = { Tim: { gebruikerId: 'u-tim', instellingen: null }, Roel: { gebruikerId: 'u-roel', instellingen: null } };

// Stub: eigen id 'u-test'; `eigen` = de serverwaarde van de ingelogde gebruiker; `put(body)` mag een eigen antwoord geven.
function instellingenStub({ eigen = null, techniekers = {}, put = () => ({ status: 200, json: { versie: 2 } }) } = {}) {
  return ({ methode, body }) => (methode === 'PUT'
    ? put(body)
    : { status: 200, json: { eigen: { gebruikerId: 'u-test', versie: 1, instellingen: eigen }, techniekers } });
}
const puts = (verzoeken) => verzoeken.van('/api/instellingen', 'PUT');
// Een bewust beantwoorde 403 geeft de browser als consolefout; die hoort bij de foutenpadtest.
const negeer403 = (consoleFouten) => { for (let i = consoleFouten.length - 1; i >= 0; i--) if (/(400|403).*\/api\/instellingen/.test(consoleFouten[i])) consoleFouten.splice(i, 1); };

test.describe('instellingen van de server', () => {
  test('het venster toont de serverwaarden; opslaan doet een PUT met de nieuwe waarde', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'planner', overschrijf: { instellingen: instellingenStub({ eigen: SERVER }) } }); // werkvelden bewerken: planner (UI/UX P1-3)
    expect(verzoeken.van('/api/instellingen', 'GET')).toHaveLength(1);
    expect(puts(verzoeken)).toHaveLength(0); // de server heeft een waarde: niets te migreren

    // De serverwaarde staat al in de cache (zonder dat er eerst iets bewaard werd) en laatste start is de globale waarde.
    expect((await leesJson(page, 'blitz_settings')).startlocatie).toBe('Teststraat 1');
    expect(await leesOpslag(page, 'blitz_laatste_start')).toBe('15:30');
    expect(await leesOpslag(page, 'blitz_instellingen_eigenaar')).toBe('u-test');

    const modal = await openInstellingen(page);
    await expect(modal.locator('#set-start')).toHaveValue('Teststraat 1');
    await expect(modal.locator('#set-duration')).toHaveValue('90');
    await expect(modal.locator('#set-laatste-start')).toHaveValue('15:30');

    await modal.locator('#set-start').fill('Nieuwstraat 2');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor alle technici');
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    const put = puts(verzoeken)[0];
    expect(put.body.gebruiker).toBeUndefined(); // eigen instellingen: zonder doel
    expect(put.body.instellingen).toMatchObject({ startlocatie: 'Nieuwstraat 2', duurMinuten: 90, laatsteStart: '15:30' });
    expect((await leesJson(page, 'blitz_settings')).startlocatie).toBe('Nieuwstraat 2');
  });

  test('een bestaande lokale waarde zonder serverwaarde gaat eenmalig omhoog (overgang)', async ({ page, verzoeken }) => {
    await page.addInitScript(() => { if (window === window.top && !localStorage.getItem('blitz_settings')) localStorage.setItem('blitz_settings', JSON.stringify({ startlocatie: 'Oude lokale straat', duurMinuten: 75 })); });
    await startApp(page, { overschrijf: { instellingen: instellingenStub({ eigen: null }) } });
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    expect(puts(verzoeken)[0].body.instellingen).toMatchObject({ startlocatie: 'Oude lokale straat', duurMinuten: 75 });
    expect((await leesJson(page, 'blitz_settings')).startlocatie).toBe('Oude lokale straat');
  });

  test('planner met Tim gekozen: de PUT draagt het gebruikerId van Tim, geen foutmelding en de waarde staat lokaal', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'planner', technieker: 'Tim', overschrijf: { instellingen: instellingenStub({ eigen: null, techniekers: TECHNIEKERS }) } });
    const modal = await openInstellingen(page);
    await expect(modal.locator('#set-person-label')).toHaveText('Instellingen voor: Tim');
    await modal.locator('#set-start').fill('Timstraat 3');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('✓ Instellingen opgeslagen voor Tim');
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    const put = puts(verzoeken)[0];
    expect(put.body.gebruiker).toBe('u-tim');
    expect(put.body.instellingen.startlocatie).toBe('Timstraat 3');
    expect(put.body.instellingen.laatsteStart).toBeUndefined(); // globale toestelinstelling hoort niet bij Tim
    // Geen foutmelding verschenen (de toast blijft de succesmelding).
    await page.waitForTimeout(300);
    await expect(toastTekst(page)).not.toContainText('Je mag de instellingen');
    expect((await leesJson(page, 'blitz_settings_Tim')).startlocatie).toBe('Timstraat 3');
  });

  test('een 403 geen-recht op de PUT: toast "lokaal bewaard" en de waarde staat toch in localStorage', async ({ page, verzoeken, consoleFouten }) => {
    const weiger = (body) => (body.gebruiker && body.gebruiker !== 'u-test'
      ? { status: 403, json: { error: 'Je hebt hier geen toegang toe.', code: 'geen-recht' } }
      : { status: 200, json: { versie: 2 } });
    await startApp(page, { loginRol: 'planner', technieker: 'Tim', overschrijf: { instellingen: instellingenStub({ eigen: null, techniekers: TECHNIEKERS, put: weiger }) } });
    const modal = await openInstellingen(page);
    await modal.locator('#set-start').fill('Timstraat 9');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('Je mag de instellingen van deze persoon niet wijzigen; lokaal bewaard.');
    expect(puts(verzoeken)).toHaveLength(1);
    expect((await leesJson(page, 'blitz_settings_Tim')).startlocatie).toBe('Timstraat 9');
    expect(await leesOpslag(page, 'blitz_instellingen_vuil')).toBeNull(); // geen-recht is geen netwerkprobleem
    negeer403(consoleFouten);
  });

  test('uitloggen wist de lokale instellingen (en de marker)', async ({ page }) => {
    let uitgelogd = false;
    const ingelogd = { gebruiker: { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder' }, rechten: { beheer: true, plannen: true, alleSales: true }, moetWachtwoordWijzigen: false, lokaleDev: false };
    await startApp(page, {
      overschrijf: {
        instellingen: instellingenStub({ eigen: SERVER }),
        'auth-ik': () => (uitgelogd ? { status: 401, json: { error: 'Niet ingelogd', code: 'niet-ingelogd', setupNodig: false } } : { status: 200, json: ingelogd }),
        'auth-uitloggen': () => { uitgelogd = true; return { status: 200, json: { ok: true } }; },
      },
    });
    expect(await leesOpslag(page, 'blitz_settings')).not.toBeNull();
    expect(await leesOpslag(page, 'blitz_laatste_start')).toBe('15:30');
    await page.locator('.gebruiker-btn').click();
    await page.getByRole('menuitem', { name: 'Uitloggen' }).click();
    await expect(page.locator('#login-overlay').getByRole('heading', { name: 'Inloggen' })).toBeVisible();
    expect(await leesOpslag(page, 'blitz_settings')).toBeNull();
    expect(await leesOpslag(page, 'blitz_laatste_start')).toBeNull();
    expect(await leesOpslag(page, 'blitz_instellingen_eigenaar')).toBeNull();
  });

  // Merge-review I2: de server vervangt het hele record van een technieker; wat het formulier niet toont (laatsteStart, bezoekDuurMin) mag nooit verdwijnen.
  test('planner bewaart in ⚙ voor Tim: de PUT bevat ook zijn laatsteStart en bezoekDuurMin van de server (geen veldverlies)', async ({ page, verzoeken }) => {
    const timServer = { ...SERVER, laatsteStart: '14:45', bezoekDuurMin: 50, kaartStijl: 'satelliet' };
    const techniekers = { Tim: { gebruikerId: 'u-tim', instellingen: timServer }, Roel: { gebruikerId: 'u-roel', instellingen: null } };
    await startApp(page, { loginRol: 'planner', technieker: 'Tim', overschrijf: { instellingen: instellingenStub({ eigen: null, techniekers }) } });
    const modal = await openInstellingen(page);
    await expect(modal.locator('#set-person-label')).toHaveText('Instellingen voor: Tim');
    await modal.locator('#set-routekleur').fill('#336699');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect.poll(() => puts(verzoeken).length).toBe(1);
    const body = puts(verzoeken)[0].body;
    expect(body.gebruiker).toBe('u-tim');
    expect(body.instellingen).toMatchObject({ routeKleur: '#336699', laatsteStart: '14:45', bezoekDuurMin: 50, kaartStijl: 'satelliet', startlocatie: 'Teststraat 1' });
    // Het serverrecord werd vlak vóór het schrijven opnieuw opgehaald (overzicht), niet uit de lokale kopie gehaald.
    expect(verzoeken.van('/api/instellingen', 'GET').length).toBeGreaterThanOrEqual(2);
  });

  test('een door de server geweigerde waarde (400): toast "niet geldig, enkel lokaal bewaard" en geen vuil-markering', async ({ page, consoleFouten }) => {
    const weiger = () => ({ status: 400, json: { error: '⚠ Duur is ongeldig' } });
    await startApp(page, { loginRol: 'planner', overschrijf: { instellingen: instellingenStub({ eigen: SERVER, put: weiger }) } });
    const modal = await openInstellingen(page);
    await modal.locator('#set-start').fill('Ongeldigstraat 1');
    await modal.getByRole('button', { name: 'Opslaan', exact: true }).click();
    await expect(toastTekst(page)).toHaveText('De instellingen zijn niet geldig en werden enkel lokaal bewaard.');
    expect((await leesJson(page, 'blitz_settings')).startlocatie).toBe('Ongeldigstraat 1');
    expect(await leesOpslag(page, 'blitz_instellingen_vuil')).toBeNull();
    negeer403(consoleFouten);
  });

  test('uitloggen met instellingen die nog niet naar de server gingen: waarschuwing; Terug blijft ingelogd, Toch afmelden meldt af', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: { instellingen: instellingenStub({ eigen: SERVER }) } });
    await page.evaluate(() => localStorage.setItem('blitz_instellingen_vuil', JSON.stringify({ all: true })));
    await page.locator('.gebruiker-btn').click();
    await page.getByRole('menuitem', { name: 'Uitloggen' }).click();
    const dialoog = page.getByRole('alertdialog');
    await expect(dialoog).toContainText('Er zijn instellingen die nog niet naar de server gingen. Als je nu afmeldt, gaan ze verloren. Toch afmelden?');
    await dialoog.getByRole('button', { name: 'Terug' }).click();
    await expect(dialoog).toHaveCount(0);
    expect(verzoeken.van('/api/auth-uitloggen', 'POST')).toHaveLength(0);
    expect(await leesOpslag(page, 'blitz_settings')).not.toBeNull(); // nog ingelogd, niets gewist

    await page.locator('.gebruiker-btn').click();
    await page.getByRole('menuitem', { name: 'Uitloggen' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Toch afmelden' }).click();
    await expect.poll(() => verzoeken.van('/api/auth-uitloggen', 'POST').length).toBe(1);
  });

  test('uitloggen zonder niet-opgeslagen instellingen: geen waarschuwing', async ({ page, verzoeken }) => {
    await startApp(page, { overschrijf: { instellingen: instellingenStub({ eigen: SERVER }) } });
    await page.locator('.gebruiker-btn').click();
    await page.getByRole('menuitem', { name: 'Uitloggen' }).click();
    await expect.poll(() => verzoeken.van('/api/auth-uitloggen', 'POST').length).toBe(1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});

// Acceptatietest S4: enkel kijken naar een collega schrijft nooit instellingen (de kaartlaag-wissel bij een persoonswissel bewaarde ze).
test.describe('persoon wisselen schrijft geen instellingen', () => {
  test('technieker kijkt naar een collega: geen PUT en geen toast', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'technieker', overschrijf: { instellingen: instellingenStub({ eigen: SERVER, techniekers: TECHNIEKERS, put: () => ({ status: 403, json: { error: 'Je hebt hier geen toegang toe.', code: 'geen-recht' } }) }) } });
    await page.locator('#person-btn').click();
    await page.locator('#person-menu').getByRole('button', { name: /Roel/ }).click();
    await expect(page.locator('#person-name-hdr')).toHaveText('Roel');
    await page.waitForTimeout(500);
    expect(puts(verzoeken)).toHaveLength(0);
    await expect(toastTekst(page)).not.toContainText('Je mag de instellingen');
    expect(await page.evaluate(() => localStorage.getItem('blitz_instellingen_vuil'))).toBeNull();
  });
});
