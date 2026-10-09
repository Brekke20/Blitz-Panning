// Beheerpagina en tab Gebruikers (logins T17): lijst, nieuwe gebruiker met eenmalig startwachtwoord/herstelcodes, bewerken,
// blokkeren (bevestiging, 409 van de server), wachtwoord resetten, overal uitloggen, eigen herstelcodes, XSS en gsm-weergave.
// De stub `gebruikers` is stateful en bevat enkel verzonnen gegevens.
import { test, expect, startApp, authIkStub } from './helpers.mjs';

const json = (status, obj) => ({ status, json: obj });
const START_WW = 'Start-Qx7-uniek-4821';
const codesVoor = (n = 10) => Array.from({ length: n }, (_, i) => `CODE${String(i + 1).padStart(2, '0')}-ZQXW`);
const EIGEN_WW = 'mijn-eigen-wachtwoord';

const BEGIN = () => [
  { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder', actief: true, laatsteLogin: '2026-10-05T06:30:00.000Z', aangemaakt: '2026-09-01T08:00:00.000Z', moetWachtwoordWijzigen: false },
  { id: 'u-p1', email: 'piet@test.be', naam: 'Piet Planner', rol: 'planner', actief: true, laatsteLogin: null, aangemaakt: '2026-09-02T08:00:00.000Z', moetWachtwoordWijzigen: true },
  { id: 'u-t1', email: 'tim@test.be', naam: 'Tim Techniek', rol: 'technieker', zohoNaam: 'Tim', actief: true, laatsteLogin: '2026-10-04T10:00:00.000Z', aangemaakt: '2026-09-03T08:00:00.000Z', moetWachtwoordWijzigen: false },
  { id: 'u-x1', email: 'oud@test.be', naam: 'Aaron Oud', rol: 'planner', actief: false, laatsteLogin: null, aangemaakt: '2026-09-04T08:00:00.000Z', moetWachtwoordWijzigen: false },
];

// Stateful nep van /api/gebruikers. `weiger` = (body) => antwoord | undefined laat een test een eigen fout afdwingen.
function gebruikersStub({ begin = BEGIN(), weiger } = {}) {
  let lijst = structuredClone(begin);
  let volgnummer = 0;
  return ({ methode, body }) => {
    if (methode === 'GET') return json(200, { gebruikers: structuredClone(lijst) });
    const eigen = weiger?.(methode, body);
    if (eigen) return eigen;
    if (methode === 'PATCH') {
      const i = lijst.findIndex(g => g.id === body.id);
      if (i < 0) return json(404, { error: 'Gebruiker niet gevonden.' });
      const { id, ...rest } = body;
      lijst[i] = { ...lijst[i], ...rest };
      return json(200, { gebruiker: lijst[i] });
    }
    switch (body?.actie) {
      case 'maak': {
        const { actie, ...velden } = body;
        const nieuw = { id: `u-n${++volgnummer}`, actief: true, laatsteLogin: null, aangemaakt: '2026-10-05T07:00:00.000Z', moetWachtwoordWijzigen: true, ...velden };
        lijst = [...lijst, nieuw];
        return json(201, { gebruiker: nieuw, startWachtwoord: START_WW, ...(nieuw.rol === 'beheerder' ? { herstelcodes: codesVoor() } : {}) });
      }
      case 'reset-wachtwoord': return json(200, { startWachtwoord: START_WW });
      case 'uitloggen-overal': return json(200, { ok: true });
      case 'nieuwe-herstelcodes':
        return body.wachtwoord === EIGEN_WW ? json(200, { herstelcodes: codesVoor() }) : json(400, { error: 'Het wachtwoord is onjuist.' });
      default: return json(400, { error: 'Onbekende actie.' });
    }
  };
}

// De 4xx is hier bedoeld: de browser meldt hem als HTTP-fout en als consolefout (twee meldingen); die halen we weg.
async function verwachtFout(consoleFouten, status) {
  const isDeze = (f) => f.includes('/api/gebruikers') && f.includes(String(status));
  await expect.poll(() => consoleFouten.filter(isDeze).length).toBe(2);
  for (const f of consoleFouten.filter(isDeze)) consoleFouten.splice(consoleFouten.indexOf(f), 1);
}

async function openGebruikers(page, opties = {}) {
  const { overschrijf, ...app } = opties.app ?? {};
  await startApp(page, { ...app, overschrijf: { gebruikers: gebruikersStub(opties.stub), ...overschrijf } });
  await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Gebruikers', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.bg-tabel')).toBeVisible();
}

const rij = (page, id) => page.locator(`tr[data-id="${id}"]`);
const venster = (page, naam) => page.getByRole('dialog', { name: naam });
const bevestiging = (page, naam) => page.getByRole('alertdialog', { name: naam });
const toastEl = (page) => page.locator('#toast');

async function nietInPagina(page, ...teksten) {
  const inhoud = await page.content();
  const opslag = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]));
  for (const t of teksten) {
    expect(inhoud, `"${t}" staat nog in de pagina`).not.toContain(t);
    expect(opslag, `"${t}" staat in de opslag`).not.toContain(t);
  }
}

test.describe('beheerpagina: tabbalk', () => {
  test('toont de tab Gebruikers met de juiste rollen en een toegankelijke tabbalk', async ({ page }) => {
    await openGebruikers(page);
    const balk = page.getByRole('tablist', { name: 'Beheer' });
    await expect(balk).toBeVisible();
    const tab = page.getByRole('tab', { name: 'Gebruikers', exact: true });
    await expect(tab).toHaveAttribute('tabindex', '0');
    await expect(tab).toHaveAttribute('aria-controls', 'beheer-paneel');
    const paneel = page.locator('#beheer-paneel');
    await expect(paneel).toHaveAttribute('role', 'tabpanel');
    await expect(paneel).toHaveAttribute('aria-labelledby', 'beheer-tab-gebruikers');
  });

  test('pijltjestoetsen, Home en End wisselen van tab; de keuze blijft in sessionStorage', async ({ page }) => {
    await openGebruikers(page);
    await page.evaluate(async () => {
      const m = await import('/js/schermen/beheer.js');
      m.registreerBeheerTab({ id: 'proef', label: 'Proef', render: async (c) => { c.textContent = 'Proefinhoud'; } });
      await m.openBeheer(document.getElementById('view-beheer'));
    });
    const gebruikers = page.getByRole('tab', { name: 'Gebruikers', exact: true });
    const proef = page.getByRole('tab', { name: 'Proef', exact: true });
    await expect(gebruikers).toHaveAttribute('aria-selected', 'true'); // opnieuw openen: de bewaarde keuze
    await gebruikers.focus();
    // Sinds T18 staan er vier tabs vóór Proef (Gebruikers, Instellingen, Activiteitenlog, Systeemstatus): End springt er in één keer heen,
    // zonder de tussenliggende tabs te openen (die roepen eigen API's aan die dit spec niet stubt).
    await page.keyboard.press('End');
    await expect(proef).toHaveAttribute('aria-selected', 'true');
    await expect(proef).toBeFocused();
    await expect(proef).toHaveAttribute('tabindex', '0');
    await expect(gebruikers).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('#beheer-paneel')).toHaveText('Proefinhoud');
    expect(await page.evaluate(() => sessionStorage.getItem('blitz_beheer_tab'))).toBe('proef');
    await page.keyboard.press('ArrowRight'); // wrap
    await expect(gebruikers).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.bg-tabel')).toBeVisible();
    await page.keyboard.press('End');
    await expect(proef).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(gebruikers).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // wrap naar achteren
    await expect(proef).toBeFocused();
    // Opnieuw openen onthoudt de gekozen tab.
    await page.evaluate(async () => (await import('/js/schermen/beheer.js')).openBeheer(document.getElementById('view-beheer')));
    await expect(proef).toHaveAttribute('aria-selected', 'true');
  });

  test('een planner heeft geen Beheer-tab en roept /api/gebruikers nooit aan', async ({ page, verzoeken }) => {
    await startApp(page, { loginRol: 'planner' });
    await expect(page.getByRole('tab', { name: 'Beheer', exact: true })).toHaveCount(0);
    await expect(page.locator('#view-beheer')).toHaveCount(0);
    expect(verzoeken.van('/api/gebruikers')).toEqual([]);
  });
});

test.describe('tab Gebruikers: lijst', () => {
  test('toont naam, e-mail, rol, status en laatste login; actief eerst, dan op naam', async ({ page }) => {
    await openGebruikers(page);
    const rijen = page.locator('.bg-tabel tbody tr');
    await expect(rijen).toHaveCount(4);
    await expect(rijen.nth(0)).toContainText('Piet Planner'); // actief, alfabetisch: Piet < Test < Tim
    await expect(rijen.nth(1)).toContainText('Test Beheerder (jij)');
    await expect(rijen.nth(2)).toContainText('Tim Techniek');
    await expect(rijen.nth(3)).toContainText('Aaron Oud');
    const test = rij(page, 'u-test');
    await expect(test).toContainText('b@test.be');
    await expect(test).toContainText('Beheerder');
    await expect(test).toContainText('Actief');
    await expect(test).toContainText('05/10/2026 08:30'); // 06:30 UTC = 08:30 Brussel
    await expect(rij(page, 'u-p1')).toContainText('Nooit');
    await expect(rij(page, 'u-p1')).toContainText('Moet het wachtwoord nog wijzigen');
    await expect(rij(page, 'u-t1')).toContainText('Zoho: Tim');
    await expect(rij(page, 'u-x1')).toContainText('Geblokkeerd');
    await expect(rij(page, 'u-x1').getByRole('button', { name: 'Deblokkeren' })).toBeVisible();
  });

  test('een servergebruiker met HTML in de naam verschijnt als tekst; er loopt geen script', async ({ page }) => {
    const gevaar = '<img src=x onerror=window.__xss=1>';
    const begin = BEGIN();
    begin[1].naam = gevaar;
    begin[1].email = '"><svg onload=window.__xss=2>@test.be';
    begin[2].zohoNaam = '<b>vet</b>';
    await openGebruikers(page, { stub: { begin } });
    await expect(rij(page, 'u-p1')).toContainText(gevaar);
    await expect(page.locator('.bg-tabel img, .bg-tabel svg, .bg-tabel b')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // Ook in het bewerkvenster en de bevestiging blijft het tekst.
    await rij(page, 'u-p1').getByRole('button', { name: 'Bewerken' }).click();
    await expect(venster(page, 'Gebruiker bewerken').getByLabel('Naam', { exact: true })).toHaveValue(gevaar);
    await venster(page, 'Gebruiker bewerken').getByRole('button', { name: 'Annuleren' }).click();
    await rij(page, 'u-p1').getByRole('button', { name: 'Blokkeren' }).click();
    await expect(bevestiging(page, 'Gebruiker blokkeren?')).toContainText(gevaar);
    await bevestiging(page, 'Gebruiker blokkeren?').getByRole('button', { name: 'Terug' }).click();
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});

test.describe('tab Gebruikers: nieuwe gebruiker', () => {
  test('technieker: Zoho-naam uit de lijst, POST maak, startwachtwoord één keer en daarna nergens meer', async ({ page, verzoeken }) => {
    await openGebruikers(page);
    await page.getByRole('button', { name: 'Nieuwe gebruiker' }).click();
    const dlg = venster(page, 'Nieuwe gebruiker');
    await dlg.getByLabel('E-mailadres').fill('Roel.Nieuw@Test.be');
    await dlg.getByLabel('Naam', { exact: true }).fill('Roel Nieuw');
    await dlg.getByLabel('Rol', { exact: true }).selectOption('technieker');
    const opties = await dlg.locator('#bg-zoho-opties option').evaluateAll(els => els.map(e => e.value));
    expect(opties).toEqual(expect.arrayContaining(['Roel', 'Tim']));
    await dlg.getByLabel('Zoho-naam').fill('Roel');
    await dlg.getByRole('button', { name: 'Aanmaken' }).click();

    const post = verzoeken.van('/api/gebruikers', 'POST');
    expect(post).toHaveLength(1);
    expect(post[0].body).toEqual({ actie: 'maak', email: 'roel.nieuw@test.be', naam: 'Roel Nieuw', rol: 'technieker', zohoNaam: 'Roel' });
    expect(post[0].headers['content-type']).toBe('application/json');

    const geheim = venster(page, 'Gebruiker aangemaakt');
    await expect(geheim.locator('[data-geheim="ww"]')).toHaveText(START_WW);
    await expect(geheim.locator('[data-geheim="codes"]')).toHaveCount(0); // geen herstelcodes voor een technieker
    await expect(geheim.getByRole('button', { name: 'Sluiten' })).toHaveCount(0); // dwingend: enkel de eigen knop
    await page.keyboard.press('Escape');
    await expect(geheim).toBeVisible();
    await geheim.getByRole('button', { name: 'Ik heb het genoteerd' }).click();
    await expect(geheim).toHaveCount(0);
    await expect(rij(page, 'u-n1')).toContainText('Roel Nieuw'); // de lijst is ververst
    await expect(rij(page, 'u-n1')).toContainText('Zoho: Roel');
    await nietInPagina(page, START_WW);
  });

  test('beheerder: toont naast het startwachtwoord ook 10 herstelcodes, eenmalig', async ({ page }) => {
    await openGebruikers(page);
    await page.getByRole('button', { name: 'Nieuwe gebruiker' }).click();
    const dlg = venster(page, 'Nieuwe gebruiker');
    await dlg.getByLabel('E-mailadres').fill('bea@test.be');
    await dlg.getByLabel('Naam', { exact: true }).fill('Bea Beheer');
    await dlg.getByLabel('Rol', { exact: true }).selectOption('beheerder');
    await dlg.getByRole('button', { name: 'Aanmaken' }).click();
    const geheim = venster(page, 'Gebruiker aangemaakt');
    await expect(geheim.locator('[data-geheim="ww"]')).toHaveText(START_WW);
    const codes = geheim.locator('[data-geheim="codes"]');
    await expect(codes).toContainText('CODE01-ZQXW');
    await expect(codes).toContainText('CODE10-ZQXW');
    expect((await codes.textContent()).split('\n')).toHaveLength(10);
    await geheim.getByRole('button', { name: 'Ik heb het genoteerd' }).click();
    await expect(geheim).toHaveCount(0);
    await nietInPagina(page, START_WW, 'CODE01-ZQXW', 'CODE10-ZQXW');
  });

  test('planner: geen herstelcodes; sales: eigen velden en het vinkje', async ({ page, verzoeken }) => {
    await openGebruikers(page);
    await page.getByRole('button', { name: 'Nieuwe gebruiker' }).click();
    let dlg = venster(page, 'Nieuwe gebruiker');
    await dlg.getByLabel('E-mailadres').fill('pia@test.be');
    await dlg.getByLabel('Naam', { exact: true }).fill('Pia Plan');
    await expect(dlg.getByLabel('Zoho-naam')).toBeHidden();
    await expect(dlg.getByLabel('Naam in export')).toBeHidden();
    await dlg.getByRole('button', { name: 'Aanmaken' }).click(); // planner is de standaardrol
    let geheim = venster(page, 'Gebruiker aangemaakt');
    await expect(geheim.locator('[data-geheim="ww"]')).toHaveText(START_WW);
    await expect(geheim.locator('[data-geheim="codes"]')).toHaveCount(0);
    await geheim.getByRole('button', { name: 'Ik heb het genoteerd' }).click();
    expect(verzoeken.van('/api/gebruikers', 'POST')[0].body).toEqual({ actie: 'maak', email: 'pia@test.be', naam: 'Pia Plan', rol: 'planner' });

    await page.getByRole('button', { name: 'Nieuwe gebruiker' }).click();
    dlg = venster(page, 'Nieuwe gebruiker');
    await dlg.getByLabel('E-mailadres').fill('eva@test.be');
    await dlg.getByLabel('Naam', { exact: true }).fill('Eva Verkoop');
    await dlg.getByLabel('Rol', { exact: true }).selectOption('sales');
    await expect(dlg.getByLabel('Zoho-naam')).toBeHidden();
    await dlg.getByLabel('Naam in export').fill('Eva V.');
    await dlg.getByLabel('Mag alle sales zien').check();
    await dlg.getByRole('button', { name: 'Aanmaken' }).click();
    geheim = venster(page, 'Gebruiker aangemaakt');
    await geheim.getByRole('button', { name: 'Ik heb het genoteerd' }).click();
    expect(verzoeken.van('/api/gebruikers', 'POST')[1].body).toEqual({
      actie: 'maak', email: 'eva@test.be', naam: 'Eva Verkoop', rol: 'sales', salesNaam: 'Eva V.', magAlleSales: true,
    });
  });

  test('technieker zonder Zoho-naam: melding in het venster, geen verzoek; Escape sluit het formulier', async ({ page, verzoeken }) => {
    await openGebruikers(page);
    await page.getByRole('button', { name: 'Nieuwe gebruiker' }).click();
    const dlg = venster(page, 'Nieuwe gebruiker');
    await dlg.getByLabel('E-mailadres').fill('tom@test.be');
    await dlg.getByLabel('Naam', { exact: true }).fill('Tom');
    await dlg.getByLabel('Rol', { exact: true }).selectOption('technieker');
    await dlg.getByRole('button', { name: 'Aanmaken' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Een technieker heeft een Zoho-naam nodig.');
    expect(verzoeken.van('/api/gebruikers', 'POST')).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nieuwe gebruiker' })).toBeFocused();
  });

  test('een e-mailadres dat al bestaat (409): de servertekst staat in het venster en het formulier blijft open', async ({ page, consoleFouten }) => {
    const weiger = (methode, body) => (body?.actie === 'maak' ? json(409, { error: 'Er bestaat al een gebruiker met dit e-mailadres.' }) : undefined);
    await openGebruikers(page, { stub: { weiger } });
    await page.getByRole('button', { name: 'Nieuwe gebruiker' }).click();
    const dlg = venster(page, 'Nieuwe gebruiker');
    await dlg.getByLabel('E-mailadres').fill('piet@test.be');
    await dlg.getByLabel('Naam', { exact: true }).fill('Dubbel');
    await dlg.getByRole('button', { name: 'Aanmaken' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Er bestaat al een gebruiker met dit e-mailadres.');
    await verwachtFout(consoleFouten, 409);
  });
});

test.describe('tab Gebruikers: bewerken, blokkeren, resetten', () => {
  test('bewerken: PATCH met enkel de velden van de rol; bij promotie tot beheerder verschijnen de herstelcodes eenmalig', async ({ page, verzoeken }) => {
    const weiger = (methode, body) => (methode === 'PATCH' && body.rol === 'beheerder'
      ? json(200, { gebruiker: { id: body.id, naam: body.naam, rol: 'beheerder', email: 'piet@test.be', actief: true }, herstelcodes: codesVoor() }) : undefined);
    await openGebruikers(page, { stub: { weiger } });
    await rij(page, 'u-t1').getByRole('button', { name: 'Bewerken' }).click();
    let dlg = venster(page, 'Gebruiker bewerken');
    await expect(dlg).toContainText('tim@test.be'); // het e-mailadres is niet wijzigbaar
    await expect(dlg.getByLabel('Zoho-naam')).toHaveValue('Tim');
    await dlg.getByLabel('Naam', { exact: true }).fill('Tim Nieuw');
    await dlg.getByRole('button', { name: 'Opslaan' }).click();
    await expect(toastEl(page)).toHaveText('Tim Nieuw is bijgewerkt.');
    expect(verzoeken.van('/api/gebruikers', 'PATCH')[0].body).toEqual({ id: 'u-t1', naam: 'Tim Nieuw', rol: 'technieker', zohoNaam: 'Tim' });
    await expect(rij(page, 'u-t1')).toContainText('Tim Nieuw');

    await rij(page, 'u-p1').getByRole('button', { name: 'Bewerken' }).click();
    dlg = venster(page, 'Gebruiker bewerken');
    await dlg.getByLabel('Rol', { exact: true }).selectOption('beheerder');
    await dlg.getByRole('button', { name: 'Opslaan' }).click();
    const geheim = venster(page, 'Nieuwe beheerder');
    await expect(geheim.locator('[data-geheim="codes"]')).toContainText('CODE05-ZQXW');
    await expect(geheim.locator('[data-geheim="ww"]')).toHaveCount(0);
    await geheim.getByRole('button', { name: 'Ik heb het genoteerd' }).click();
    await nietInPagina(page, 'CODE05-ZQXW');
  });

  test('blokkeren vraagt bevestiging: Terug doet niets, Blokkeren stuurt PATCH actief:false; deblokkeren kan meteen', async ({ page, verzoeken }) => {
    await openGebruikers(page);
    await rij(page, 'u-p1').getByRole('button', { name: 'Blokkeren' }).click();
    const bev = bevestiging(page, 'Gebruiker blokkeren?');
    await expect(bev).toContainText('Piet Planner');
    await bev.getByRole('button', { name: 'Terug' }).click();
    expect(verzoeken.van('/api/gebruikers', 'PATCH')).toEqual([]);
    await rij(page, 'u-p1').getByRole('button', { name: 'Blokkeren' }).click();
    await bevestiging(page, 'Gebruiker blokkeren?').getByRole('button', { name: 'Blokkeren' }).click();
    await expect(toastEl(page)).toHaveText('Piet Planner is geblokkeerd.');
    expect(verzoeken.van('/api/gebruikers', 'PATCH').map(r => r.body)).toEqual([{ id: 'u-p1', actief: false }]);
    await expect(rij(page, 'u-p1')).toContainText('Geblokkeerd');
    await expect(page.locator('.bg-tabel tbody tr').last()).toContainText('Piet Planner'); // inactief zakt naar onder (Aaron < Piet)
    // Deblokkeren: geen bevestiging.
    await rij(page, 'u-x1').getByRole('button', { name: 'Deblokkeren' }).click();
    await expect(toastEl(page)).toHaveText('Aaron Oud is gedeblokkeerd.');
    expect(verzoeken.van('/api/gebruikers', 'PATCH').map(r => r.body)).toEqual([{ id: 'u-p1', actief: false }, { id: 'u-x1', actief: true }]);
    await expect(rij(page, 'u-x1')).toContainText('Actief');
  });

  test('blokkeren geeft 409 van de server: de servertekst staat in een toast en de lijst blijft kloppen', async ({ page, consoleFouten }) => {
    const tekst = 'Dit is de enige actieve beheerder: die kan niet geblokkeerd of van rol veranderd worden.';
    const begin = BEGIN();
    begin.push({ id: 'u-b2', email: 'bea@test.be', naam: 'Bea Beheerder', rol: 'beheerder', actief: true, laatsteLogin: null });
    const weiger = (methode, body) => (methode === 'PATCH' && body.id === 'u-b2' ? json(409, { error: tekst }) : undefined);
    await openGebruikers(page, { stub: { begin, weiger } });
    await rij(page, 'u-b2').getByRole('button', { name: 'Blokkeren' }).click();
    await bevestiging(page, 'Gebruiker blokkeren?').getByRole('button', { name: 'Blokkeren' }).click();
    await expect(toastEl(page)).toHaveText(tekst);
    await expect(rij(page, 'u-b2')).toContainText('Actief');
    await verwachtFout(consoleFouten, 409);
  });

  test('de enige actieve beheerder kan niet geblokkeerd worden: knop is "disabled" met uitleg, geen bevestiging, geen verzoek', async ({ page, verzoeken }) => {
    await openGebruikers(page);
    const knop = rij(page, 'u-test').getByRole('button', { name: 'Blokkeren' });
    await expect(knop).toHaveAttribute('aria-disabled', 'true');
    await knop.click({ force: true }); // aria-disabled (geen disabled): blijft focusbaar en legt uit waarom het niet kan
    await expect(toastEl(page)).toContainText('enige actieve beheerder');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(verzoeken.van('/api/gebruikers', 'PATCH')).toEqual([]);
    // Ook de rol van die beheerder is niet te wijzigen.
    await rij(page, 'u-test').getByRole('button', { name: 'Bewerken' }).click();
    await expect(venster(page, 'Gebruiker bewerken').getByLabel('Rol', { exact: true })).toBeDisabled();
  });

  test('startwachtwoord opnieuw instellen: bevestiging, POST, nieuw wachtwoord één keer', async ({ page, verzoeken }) => {
    await openGebruikers(page);
    await rij(page, 'u-t1').getByRole('button', { name: 'Startwachtwoord opnieuw instellen' }).click();
    const bev = bevestiging(page, 'Startwachtwoord opnieuw instellen?');
    await bev.getByRole('button', { name: 'Terug' }).click();
    expect(verzoeken.van('/api/gebruikers', 'POST')).toEqual([]);
    await rij(page, 'u-t1').getByRole('button', { name: 'Startwachtwoord opnieuw instellen' }).click();
    await bevestiging(page, 'Startwachtwoord opnieuw instellen?').getByRole('button', { name: 'Opnieuw instellen' }).click();
    const geheim = venster(page, 'Nieuw startwachtwoord');
    await expect(geheim.locator('[data-geheim="ww"]')).toHaveText(START_WW);
    expect(verzoeken.van('/api/gebruikers', 'POST')[0].body).toEqual({ actie: 'reset-wachtwoord', id: 'u-t1' });
    await geheim.getByRole('button', { name: 'Ik heb het genoteerd' }).click();
    await nietInPagina(page, START_WW);
  });

  test('overal uitloggen stuurt POST uitloggen-overal en meldt het in een toast', async ({ page, verzoeken }) => {
    await openGebruikers(page);
    await rij(page, 'u-t1').getByRole('button', { name: 'Overal uitloggen' }).click();
    await expect(toastEl(page)).toHaveText('Tim Techniek is overal uitgelogd.');
    expect(verzoeken.van('/api/gebruikers', 'POST')[0].body).toEqual({ actie: 'uitloggen-overal', id: 'u-t1' });
  });
});

test.describe('tab Gebruikers: eigen account, focus en herlogin', () => {
  test('overal uitloggen van het eigen account vraagt eerst bevestiging', async ({ page, verzoeken }) => {
    await openGebruikers(page);
    await rij(page, 'u-test').getByRole('button', { name: 'Overal uitloggen' }).click();
    const bev = bevestiging(page, 'Overal uitloggen?');
    await expect(bev).toContainText('Je wordt ook op dit toestel uitgelogd. Doorgaan?');
    await bev.getByRole('button', { name: 'Terug' }).click();
    expect(verzoeken.van('/api/gebruikers', 'POST')).toEqual([]);
    await rij(page, 'u-test').getByRole('button', { name: 'Overal uitloggen' }).click();
    await bevestiging(page, 'Overal uitloggen?').getByRole('button', { name: 'Uitloggen' }).click();
    await expect(toastEl(page)).toHaveText('Test Beheerder is overal uitgelogd.');
    expect(verzoeken.van('/api/gebruikers', 'POST')[0].body).toEqual({ actie: 'uitloggen-overal', id: 'u-test' });
    await expect(rij(page, 'u-test').getByRole('button', { name: 'Overal uitloggen' })).toBeFocused();
  });

  test('de focus keert terug naar de knop na blokkeren en na het sluiten van het nieuwe-startwachtwoordvenster', async ({ page }) => {
    await openGebruikers(page);
    await rij(page, 'u-t1').getByRole('button', { name: 'Blokkeren' }).click();
    await bevestiging(page, 'Gebruiker blokkeren?').getByRole('button', { name: 'Blokkeren' }).click();
    await expect(rij(page, 'u-t1')).toContainText('Geblokkeerd');
    await expect(rij(page, 'u-t1').getByRole('button', { name: 'Deblokkeren' })).toBeFocused(); // de knop wisselde van functie, de focus volgt
    await rij(page, 'u-t1').getByRole('button', { name: 'Startwachtwoord opnieuw instellen' }).click();
    await bevestiging(page, 'Startwachtwoord opnieuw instellen?').getByRole('button', { name: 'Opnieuw instellen' }).click();
    const geheim = venster(page, 'Nieuw startwachtwoord');
    await expect(geheim).toBeVisible();
    await geheim.getByRole('button', { name: 'Ik heb het genoteerd' }).click();
    await expect(rij(page, 'u-t1').getByRole('button', { name: 'Startwachtwoord opnieuw instellen' })).toBeFocused();
  });

  test('sessie verloopt terwijl een formulier openstaat: het herlogin-scherm werkt met het toetsenbord (Tab en Enter) en het verzoek wordt herhaald', async ({ page, verzoeken, consoleFouten }) => {
    const staat = { verlopen: false, geweigerd: false };
    const ingelogd = authIkStub('beheerder');
    const weiger = (methode, body) => {
      if (body?.actie === 'maak' && !staat.geweigerd) {
        staat.geweigerd = true; staat.verlopen = true;
        return json(401, { error: 'Niet ingelogd', code: 'niet-ingelogd' });
      }
      return undefined;
    };
    await openGebruikers(page, {
      stub: { weiger },
      app: { overschrijf: {
        'auth-ik': (z) => (staat.verlopen ? json(401, { error: 'Niet ingelogd', code: 'niet-ingelogd' }) : ingelogd(z)),
        'auth-login': () => { staat.verlopen = false; return json(200, { ok: true }); },
      } },
    });
    await page.getByRole('button', { name: 'Nieuwe gebruiker' }).click();
    const dlg = venster(page, 'Nieuwe gebruiker');
    await dlg.getByLabel('E-mailadres').fill('nieuw@test.be');
    await dlg.getByLabel('Naam', { exact: true }).fill('Nieuw Persoon');
    await dlg.getByRole('button', { name: 'Aanmaken' }).click();

    const login = page.locator('#login-overlay');
    await expect(login.getByRole('heading', { name: 'Inloggen' })).toBeVisible();
    await expect(login.getByLabel('E-mailadres')).toBeFocused();
    await page.keyboard.type('b@test.be');
    await page.keyboard.press('Tab');
    await expect(login.getByLabel('Wachtwoord', { exact: true })).toBeFocused(); // de val van het beheervenster kaapt Tab niet
    await page.keyboard.type('een-lang-wachtwoord');
    await page.keyboard.press('Enter');
    await expect(login).toHaveCount(0);
    // Het verzoek is herhaald en geslaagd: het geheimenvenster staat er.
    await expect(venster(page, 'Gebruiker aangemaakt').locator('[data-geheim="ww"]')).toHaveText(START_WW);
    expect(verzoeken.van('/api/gebruikers', 'POST')).toHaveLength(2);
    await verwachtFout(consoleFouten, 401);
  });
});

test.describe('tab Gebruikers: eigen herstelcodes', () => {
  test('vraagt het eigen wachtwoord; een fout wachtwoord blijft in het venster; de codes staan één keer in beeld', async ({ page, verzoeken, consoleFouten }) => {
    await openGebruikers(page);
    await page.getByRole('button', { name: 'Nieuwe herstelcodes maken' }).click();
    const dlg = venster(page, 'Nieuwe herstelcodes maken');
    const ww = dlg.getByLabel('Je wachtwoord');
    await expect(ww).toHaveAttribute('type', 'password');
    await dlg.getByRole('button', { name: 'Codes maken' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Vul je wachtwoord in.');
    expect(verzoeken.van('/api/gebruikers', 'POST')).toEqual([]);

    await ww.fill('fout-wachtwoord');
    await dlg.getByRole('button', { name: 'Codes maken' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Het wachtwoord is onjuist.');
    await expect(ww).toHaveValue('');
    await verwachtFout(consoleFouten, 400);

    await ww.fill(EIGEN_WW);
    await dlg.getByRole('button', { name: 'Codes maken' }).click();
    const geheim = venster(page, 'Nieuwe herstelcodes');
    await expect(geheim.locator('[data-geheim="codes"]')).toContainText('CODE10-ZQXW');
    expect(verzoeken.van('/api/gebruikers', 'POST').map(r => r.body)).toEqual([
      { actie: 'nieuwe-herstelcodes', wachtwoord: 'fout-wachtwoord' }, { actie: 'nieuwe-herstelcodes', wachtwoord: EIGEN_WW },
    ]);
    await geheim.getByRole('button', { name: 'Ik heb het genoteerd' }).click();
    await nietInPagina(page, 'CODE01-ZQXW', 'CODE10-ZQXW', EIGEN_WW);
  });
});

test.describe('tab Gebruikers: gsm', () => {
  test('375 px: kaartenlijst zonder horizontale paginascroll; op desktop een gewone tabel', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openGebruikers(page, { app: { viewport: { width: 375, height: 812 } } });
    const rijStijl = await page.locator('.bg-tabel tbody tr').first().evaluate(el => getComputedStyle(el).display);
    expect(rijStijl).toBe('block');
    // Niets binnen de beheerpagina steekt buiten het scherm (de kop van de app zelf, buiten deze view, is niet van deze taak).
    // De tabbalk scrolt bewust binnen zichzelf (vier tabs passen niet naast elkaar op 375 px): zijn tabs vallen buiten deze controle.
    const buiten = await page.locator('#view-beheer *').evaluateAll(els => els.filter(el => !el.closest('.beheer-tabs') && el.getBoundingClientRect().right > window.innerWidth + 0.5).map(el => el.className));
    expect(buiten).toEqual([]);
    expect(await page.locator('.beheer-tabs').evaluate(el => el.getBoundingClientRect().right <= window.innerWidth + 0.5)).toBe(true); // de balk zelf past
    expect(await page.locator('#view-beheer').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator('.bg-tabel td[data-label="Laatste login"]').first()).toBeVisible();
    // Een venster past ook.
    await page.getByRole('button', { name: 'Nieuwe gebruiker' }).click();
    const dlgBreedte = await venster(page, 'Nieuwe gebruiker').evaluate(el => el.offsetWidth); // layoutbreedte: de opkomende animatie (schaal) verandert getBoundingClientRect
    expect(dlgBreedte).toBeLessThanOrEqual(375);
  });

  test('375 px: de hele pagina is niet breder dan het scherm, op het hoofdscherm (Wachtrij) en in Beheer', async ({ page }) => {
    await startApp(page, { viewport: { width: 375, height: 812 }, overschrijf: { gebruikers: gebruikersStub() } });
    const breedte = () => page.evaluate(() => ({ breedte: document.documentElement.scrollWidth, venster: window.innerWidth }));
    const hoofd = await breedte();
    expect(hoofd.breedte).toBeLessThanOrEqual(hoofd.venster);
    await page.getByRole('tab', { name: 'Beheer', exact: true }).click();
    await expect(page.locator('.bg-tabel')).toBeVisible();
    const beheer = await breedte();
    expect(beheer.breedte).toBeLessThanOrEqual(beheer.venster);
  });

  test('desktop: tabelrijen', async ({ page }) => {
    await openGebruikers(page);
    expect(await page.locator('.bg-tabel tbody tr').first().evaluate(el => getComputedStyle(el).display)).toBe('table-row');
  });
});
