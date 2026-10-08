// De loginschermen (logins T14), nu gekoppeld aan de opstart (T15): de app start pas na een geslaagde login.
// auth-ik geeft 401 tot de login-, setup-, herstel- of wachtwoordstub geslaagd is; daarna de ingelogde beheerder.
import { test, expect, startApp, authIkStub } from './helpers.mjs';

const OK = { status: 200, json: { ok: true } };
const WW = 'een-lang-wachtwoord';

// Stubs voor de login: `ingelogd` wordt gezet door de stub die slaagt. `extra` voegt/overschrijft stubs.
function loginStubs({ setupNodig = false, extra = {} } = {}) {
  const staat = { ingelogd: false };
  const ingelogd = authIkStub('beheerder');
  const slaag = (antwoord = OK) => () => { staat.ingelogd = true; return antwoord; };
  return {
    staat,
    stubs: {
      'auth-ik': (z) => (staat.ingelogd ? ingelogd(z) : { status: 401, json: { error: 'Niet ingelogd', code: 'niet-ingelogd', setupNodig } }),
      'auth-login': slaag(),
      'auth-setup': slaag({ status: 200, json: { ok: true, herstelcodes: ['AAAA-1111', 'BBBB-2222'] } }),
      'auth-herstel': slaag(),
      'auth-wachtwoord': slaag(),
      ...extra,
    },
    slaag,
  };
}

const overlay = (page) => page.locator('#login-overlay');
const kop = (page, naam) => overlay(page).getByRole('heading', { name: naam });
const veld = (page, label) => overlay(page).getByLabel(label);
const foutmelding = (page) => overlay(page).locator('[data-fout]');

async function openUitgelogd(page, opties) {
  const l = loginStubs(opties);
  await startApp(page, { overschrijf: l.stubs, wachtOpApp: false });
  return l;
}
async function vulInlog(page, email = 'b@test.be', ww = WW) {
  await veld(page, 'E-mailadres').fill(email);
  await veld(page, 'Wachtwoord').fill(ww);
}
const appGestart = (page) => expect(page.locator('#cnt-tickets')).toHaveText('3');

test.describe('inloggen', () => {
  test('de overlay staat vóór de login, de app start pas erna (#cnt-tickets gevuld, geen datagebruik eerder)', async ({ page, verzoeken }) => {
    await openUitgelogd(page);
    await expect(kop(page, 'Inloggen')).toBeVisible();
    await expect(overlay(page)).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#cnt-tickets')).toHaveText('0');
    expect(verzoeken.alle.filter(r => r.pad !== '/api/auth-ik')).toEqual([]);

    await vulInlog(page);
    await overlay(page).getByRole('button', { name: 'Inloggen', exact: true }).click();
    await expect(overlay(page)).toHaveCount(0);
    await appGestart(page);
    const login = verzoeken.van('/api/auth-login', 'POST');
    expect(login).toHaveLength(1);
    expect(login[0].body).toEqual({ email: 'b@test.be', wachtwoord: WW });
  });

  test('toegankelijkheid: de overlay is genoemd naar de kop van het huidige scherm (aria-labelledby)', async ({ page }) => {
    await openUitgelogd(page);
    const id = await overlay(page).getAttribute('aria-labelledby');
    expect(id).toBeTruthy();
    expect(await overlay(page).getAttribute('aria-label')).toBeNull();
    await expect(page.locator(`#${id}`)).toHaveText('Inloggen');
    await overlay(page).getByRole('button', { name: 'Wachtwoord vergeten (beheerder)' }).click();
    await expect(kop(page, 'Wachtwoord vergeten (beheerder)')).toBeVisible();
    await expect(page.locator(`#${id}`)).toHaveText('Wachtwoord vergeten (beheerder)');
    await expect(overlay(page)).toHaveAccessibleName('Wachtwoord vergeten (beheerder)');
  });

  test('een foute login toont de vaste foutmelding en het formulier blijft', async ({ page }) => {
    const { stubs } = loginStubs({ extra: { 'auth-login': () => ({ status: 401, json: { error: 'onbekend adres' } }) } });
    await startApp(page, { overschrijf: stubs, wachtOpApp: false });
    await vulInlog(page, 'x@test.be', 'fout-wachtwoord');
    await overlay(page).getByRole('button', { name: 'Inloggen', exact: true }).click();
    await expect(foutmelding(page)).toHaveText('Onjuist e-mailadres of wachtwoord');
    await expect(veld(page, 'E-mailadres')).toHaveValue('x@test.be');
    await expect(overlay(page)).toBeVisible();
    await expect(page.locator('#cnt-tickets')).toHaveText('0');
  });

  test('Enter in het wachtwoordveld verstuurt het formulier', async ({ page, verzoeken }) => {
    await openUitgelogd(page);
    await vulInlog(page);
    await veld(page, 'Wachtwoord').press('Enter');
    await expect(overlay(page)).toHaveCount(0);
    expect(verzoeken.van('/api/auth-login', 'POST')).toHaveLength(1);
    await appGestart(page);
  });

  test('de loginlaag is niet te sluiten met Escape, en de achtergrond is onbereikbaar (inert)', async ({ page }) => {
    await openUitgelogd(page);
    await page.keyboard.press('Escape');
    await expect(overlay(page)).toBeVisible();
    await expect(page.locator('main#hoofdinhoud')).toHaveJSProperty('inert', true);
  });

  test('vrije tekst uit een antwoord verschijnt als tekst (geen HTML)', async ({ page }) => {
    const { stubs } = loginStubs({ extra: { 'auth-login': () => ({ status: 400, json: { error: 'Ongeldig <b>veld</b>' } }) } });
    await startApp(page, { overschrijf: stubs, wachtOpApp: false });
    await vulInlog(page);
    await overlay(page).getByRole('button', { name: 'Inloggen', exact: true }).click();
    await expect(foutmelding(page)).toHaveText('Ongeldig <b>veld</b>');
    await expect(overlay(page).locator('b')).toHaveCount(0);
  });

  test('een vergrendeling (429) toont het uur, zonder iets over het account te verraden', async ({ page }) => {
    const { stubs } = loginStubs({ extra: { 'auth-login': () => ({ status: 429, json: { opnieuwOp: '2026-10-05T08:30:00.000Z' } }) } });
    await startApp(page, { overschrijf: stubs, wachtOpApp: false });
    await vulInlog(page);
    await veld(page, 'Wachtwoord').press('Enter');
    await expect(foutmelding(page)).toHaveText('Te veel pogingen. Probeer opnieuw om 10:30.');
  });

  test('tijdens een lopend verzoek staan alle knoppen uit en tonen Enter of klikken niets dubbel', async ({ page, verzoeken }) => {
    let open;
    const poort = new Promise((r) => { open = r; });
    const l = loginStubs();
    l.stubs['auth-login'] = async () => { await poort; l.staat.ingelogd = true; return OK; };
    await startApp(page, { overschrijf: l.stubs, wachtOpApp: false });
    await vulInlog(page);
    await veld(page, 'Wachtwoord').press('Enter');
    await expect(overlay(page).getByRole('button', { name: 'Inloggen', exact: true })).toBeDisabled();
    await expect(overlay(page).getByRole('button', { name: 'Wachtwoord vergeten (beheerder)' })).toBeDisabled();
    await veld(page, 'Wachtwoord').press('Enter'); // tweede Enter: geen tweede verzoek
    open();
    await expect(overlay(page)).toHaveCount(0);
    expect(verzoeken.van('/api/auth-login', 'POST')).toHaveLength(1);
    await appGestart(page);
  });
});

test.describe('beheerder instellen (setup)', () => {
  test('setupNodig toont "Beheerder instellen"; na succes de herstelcodes (als tekst), daarna start de app', async ({ page, verzoeken }) => {
    const { stubs } = loginStubs({ setupNodig: true, extra: {} });
    const gewoon = stubs['auth-setup'];
    stubs['auth-setup'] = (z) => { gewoon(z); return { status: 200, json: { ok: true, herstelcodes: ['AAAA-1111', '<b>X</b>-3333'] } }; };
    await startApp(page, { overschrijf: stubs, wachtOpApp: false });
    await expect(kop(page, 'Beheerder instellen')).toBeVisible();

    await veld(page, 'Setupcode').fill('geheime-code');
    await veld(page, 'E-mailadres').fill('baas@test.be');
    await veld(page, 'Naam').fill('Baas');
    await veld(page, /^Wachtwoord \(/).fill(WW);
    await veld(page, 'Herhaal wachtwoord').fill(WW);
    await overlay(page).getByRole('button', { name: 'Beheerder aanmaken' }).click();

    await expect(kop(page, 'Bewaar je herstelcodes')).toBeVisible();
    await expect(overlay(page).locator('[data-codes]')).toContainText('AAAA-1111');
    await expect(overlay(page).locator('[data-codes]')).toContainText('<b>X</b>-3333');
    await expect(overlay(page).locator('b')).toHaveCount(0);
    // De codes zijn één keer te zien: nergens in opslag.
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain('AAAA-1111');
    expect(verzoeken.van('/api/auth-setup', 'POST')[0].body).toEqual({ setupCode: 'geheime-code', email: 'baas@test.be', naam: 'Baas', wachtwoord: WW });

    await expect(page.locator('#cnt-tickets')).toHaveText('0');
    await overlay(page).getByRole('button', { name: 'Ik heb ze bewaard' }).click();
    await expect(overlay(page)).toHaveCount(0);
    await appGestart(page);
  });

  test('het setupcode-veld wordt niet als wachtwoord bewaard (tekstveld, one-time-code)', async ({ page }) => {
    await startApp(page, { overschrijf: loginStubs({ setupNodig: true }).stubs, wachtOpApp: false });
    const code = veld(page, 'Setupcode');
    await expect(code).toHaveAttribute('type', 'text');
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  });
});

test.describe('wachtwoord wijzigen na login', () => {
  test('moetWachtwoordWijzigen toont eerst het wijzigscherm, zonder Annuleren', async ({ page, verzoeken }) => {
    const l = loginStubs();
    l.stubs['auth-login'] = () => ({ status: 200, json: { ok: true, moetWachtwoordWijzigen: true } });
    await startApp(page, { overschrijf: l.stubs, wachtOpApp: false });
    await vulInlog(page, 'b@test.be', 'tijdelijk-wachtwoord');
    await veld(page, 'Wachtwoord').press('Enter');

    await expect(kop(page, 'Wachtwoord wijzigen')).toBeVisible();
    await expect(overlay(page).getByRole('button', { name: 'Annuleren' })).toHaveCount(0);
    await expect(page.locator('#cnt-tickets')).toHaveText('0');
    await veld(page, 'Huidig wachtwoord').fill('tijdelijk-wachtwoord');
    await veld(page, /^Nieuw wachtwoord/).fill(WW);
    await veld(page, 'Herhaal nieuw wachtwoord').fill(WW);
    await overlay(page).getByRole('button', { name: 'Wachtwoord wijzigen' }).click();

    await expect(overlay(page)).toHaveCount(0);
    await appGestart(page);
    expect(verzoeken.van('/api/auth-wachtwoord', 'POST')[0].body).toEqual({ huidig: 'tijdelijk-wachtwoord', nieuw: WW });
  });
});

test.describe('wachtwoord vergeten (beheerder)', () => {
  async function naarHerstel(page, opties) {
    const l = await openUitgelogd(page, opties);
    await overlay(page).getByRole('button', { name: 'Wachtwoord vergeten (beheerder)' }).click();
    await expect(kop(page, 'Wachtwoord vergeten (beheerder)')).toBeVisible();
    return l;
  }
  async function vulHerstel(page, bewijs, { nieuw = WW, herhaal = WW } = {}) {
    await veld(page, 'E-mailadres').fill('baas@test.be');
    await veld(page, 'Herstelcode of noodsleutel').fill(bewijs);
    await veld(page, /^Nieuw wachtwoord/).fill(nieuw);
    await veld(page, 'Herhaal nieuw wachtwoord').fill(herhaal);
  }

  test('de link toont het herstelscherm; "Terug naar inloggen" gaat terug', async ({ page }) => {
    await naarHerstel(page);
    await overlay(page).getByRole('button', { name: 'Terug naar inloggen' }).click();
    await expect(kop(page, 'Inloggen')).toBeVisible();
  });

  test('het bewijsveld is geen wachtwoordveld: tekstveld, one-time-code, tekens verborgen met CSS', async ({ page }) => {
    await naarHerstel(page);
    const bewijs = veld(page, 'Herstelcode of noodsleutel');
    await expect(bewijs).toHaveAttribute('type', 'text');
    await expect(bewijs).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(bewijs).toHaveClass(/login-geheim/);
    await expect(overlay(page).locator('input[type="password"]')).toHaveCount(2); // enkel de twee nieuwe-wachtwoordvelden
  });

  for (const [soort, bewijs] of [['een herstelcode', 'ABCD-EFGH-1234'], ['de noodsleutel', 'noodsleutel-uit-netlify']]) {
    test(`herstel met ${soort}: het verzoek draagt bewijs en nieuwWachtwoord, de overlay verdwijnt en de app start`, async ({ page, verzoeken }) => {
      await naarHerstel(page);
      await vulHerstel(page, bewijs);
      await overlay(page).getByRole('button', { name: 'Wachtwoord herstellen' }).click();
      await expect(overlay(page)).toHaveCount(0);
      await appGestart(page);
      const verzoek = verzoeken.van('/api/auth-herstel', 'POST');
      expect(verzoek).toHaveLength(1);
      expect(verzoek[0].body).toEqual({ email: 'baas@test.be', bewijs, nieuwWachtwoord: WW });
    });
  }

  test('een 401 geeft een generieke foutmelding en het formulier blijft', async ({ page }) => {
    await naarHerstel(page, { extra: { 'auth-herstel': () => ({ status: 401, json: { error: 'code verlopen' } }) } });
    await vulHerstel(page, 'FOUT');
    await overlay(page).getByRole('button', { name: 'Wachtwoord herstellen' }).click();
    await expect(foutmelding(page)).toHaveText('Onjuiste herstelgegevens');
    await expect(veld(page, 'Herstelcode of noodsleutel')).toHaveValue('FOUT');
    await expect(overlay(page)).toBeVisible();
  });

  test('een afwijkende herhaling geeft een foutmelding zonder verzoek', async ({ page, verzoeken }) => {
    await naarHerstel(page);
    await vulHerstel(page, 'ABCD', { herhaal: WW + 'x' });
    await overlay(page).getByRole('button', { name: 'Wachtwoord herstellen' }).click();
    await expect(foutmelding(page)).toHaveText('De twee wachtwoorden zijn niet gelijk.');
    expect(verzoeken.van('/api/auth-herstel', 'POST')).toEqual([]);
  });
});
