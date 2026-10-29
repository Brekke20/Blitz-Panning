// Vroege opstartverzoeken (O1): index.html start `/api/auth-ik` (en met een bewaarde sessie `/api/instellingen?overzicht=1`) vóór de modules
// laden. Deze specs bewijzen het gedrag (aantallen, tijdstip) en de bewaking: het vroege overzicht komt nooit onder een andere gebruiker
// terecht (gedeelde tablet), een verlopen sessie of een niet-2xx antwoord valt terug op het gewone verzoek, en een offline start geeft geen
// "Uncaught (in promise)". Productiemodus (zonder testmodus), volledig gestubd; geen echte server, Zoho of persoonsgegevens.
import { test, expect, startAppProductie, verwachtSchrijven, verwachtHttpFout, verwachtNetwerkFout, OPSTART_SCHRIJVEN } from '../productie-hulp.mjs';

const GEBRUIKER_TEST = { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder' };
const GEBRUIKER_B = { id: 'u-b', email: 'b2@test.be', naam: 'Gebruiker B', rol: 'beheerder' };
const WW = 'een-lang-wachtwoord';
const A_WAARDEN = { startlocatie: 'Straat van A 1', duurMinuten: 90 };
const B_WAARDEN = { startlocatie: 'Straat van B 2', duurMinuten: 75 };

// Het bewaarde sessierecord (kern/sessie.js leesCache): enkel zo start index.html het vroege instellingenverzoek.
const bewaarSessie = (page, gebruiker) => page.addInitScript((g) => {
  if (window !== window.top) return; // sandbox-iframes hebben geen localStorage
  if (localStorage.getItem('blitz_sessie_cache') === null) localStorage.setItem('blitz_sessie_cache', JSON.stringify(g));
}, gebruiker);

const authIkOk = (gebruiker) => ({
  status: 200,
  json: { gebruiker, rechten: { beheer: true, plannen: true, alleSales: true }, moetWachtwoordWijzigen: false, lokaleDev: false },
});
const authIk401 = { status: 401, json: { error: 'Niet ingelogd', code: 'niet-ingelogd', setupNodig: false } };
const overzicht = (gebruikerId, instellingen) => ({ status: 200, json: { eigen: { gebruikerId, versie: 1, instellingen }, techniekers: {} } });
// Een instellingenstub die per GET het volgende antwoord uit de rij geeft (het laatste blijft gelden); PUT slaagt neutraal.
const instellingenRij = (...antwoorden) => {
  const rij = [...antwoorden];
  return ({ methode }) => (methode === 'PUT' ? { status: 200, json: { versie: 2 } } : (rij.length > 1 ? rij.shift() : rij[0]));
};
// Een auth-ik die 401 geeft tot de login-stub slaagde; daarna de opgegeven gebruiker.
function loginStubs(naInlog) {
  const staat = { ingelogd: false };
  return {
    staat,
    overschrijf: {
      'auth-ik': () => (staat.ingelogd ? authIkOk(naInlog) : authIk401),
      'auth-login': () => { staat.ingelogd = true; return { status: 200, json: { ok: true } }; },
    },
  };
}

const overlay = (page) => page.locator('#login-overlay');
async function logIn(page, email) {
  await overlay(page).getByLabel('E-mailadres', { exact: true }).fill(email);
  await overlay(page).getByLabel('Wachtwoord', { exact: true }).fill(WW);
  await overlay(page).getByRole('button', { name: 'Inloggen', exact: true }).click();
  await expect(overlay(page)).toHaveCount(0);
}
const lees = (page, sleutel) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), sleutel);
const leesTekst = (page, sleutel) => page.evaluate((k) => localStorage.getItem(k), sleutel);
const aantal = (verzoeken, pad, methode = 'GET') => verzoeken.van(pad, methode).length;
const wachtOpWachtrij = (page) => expect(page.locator('#cnt-tickets')).toHaveText('3');

test.describe('vroege start (O1)', () => {
  test('met een bewaarde sessie: precies één auth-ik en één instellingenoverzicht, beide gestart vóór DOMContentLoaded; het vroege overzicht wordt gebruikt', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    await bewaarSessie(page, GEBRUIKER_TEST);
    // De echte klok: de nepklok van de fixture vervangt ook performance.getEntriesByType (Resource en Navigation Timing).
    await startAppProductie(page, { klok: false, overschrijf: { instellingen: instellingenRij(overzicht('u-test', A_WAARDEN)) } });
    expect(aantal(verzoeken, '/api/auth-ik')).toBe(1);
    expect(aantal(verzoeken, '/api/instellingen')).toBe(1);
    expect((await lees(page, 'blitz_settings')).startlocatie).toBe('Straat van A 1'); // het vroege antwoord is verwerkt
    const tijden = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const start = (pad) => performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === pad).map((e) => e.startTime);
      return { dcl: nav.domContentLoadedEventStart, auth: start('/api/auth-ik'), instellingen: start('/api/instellingen'), vroeg: window.__blitzVroeg ? { authIk: window.__blitzVroeg.authIk, instellingen: window.__blitzVroeg.instellingen } : null };
    });
    expect(tijden.auth).toHaveLength(1);
    expect(tijden.instellingen).toHaveLength(1);
    expect(tijden.auth[0], 'auth-ik start vóór DOMContentLoaded').toBeLessThan(tijden.dcl);
    expect(tijden.instellingen[0], 'instellingen start vóór DOMContentLoaded').toBeLessThan(tijden.dcl);
    expect(tijden.vroeg, 'de beloftes zijn genomen (hoogstens één keer)').toEqual({ authIk: null, instellingen: null });
  });

  test('zonder bewaarde sessie (ingelogd): enkel auth-ik start vroeg; het overzicht volgt gewoon één keer na de login-controle', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    await startAppProductie(page, { overschrijf: { instellingen: instellingenRij(overzicht('u-test', A_WAARDEN)) } });
    expect(aantal(verzoeken, '/api/auth-ik')).toBe(1);
    expect(aantal(verzoeken, '/api/instellingen')).toBe(1);
    expect(await page.evaluate(() => window.__blitzVroeg.instellingen), 'geen zinloos vroeg verzoek zonder sessie').toBeNull();
    expect((await lees(page, 'blitz_settings')).startlocatie).toBe('Straat van A 1');
  });

  test('zonder bewaarde sessie (niet ingelogd): geen vroeg instellingenverzoek, inlogscherm; na inloggen precies één vers auth-ik en één instellingenoverzicht', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/auth-login']);
    verwachtHttpFout(verzoeken, [{ pad: '/api/auth-ik', status: 401 }]);
    const l = loginStubs(GEBRUIKER_B);
    await startAppProductie(page, { wachtOpApp: false, overschrijf: { ...l.overschrijf, instellingen: instellingenRij(overzicht('u-b', B_WAARDEN)) } });
    await expect(overlay(page)).toBeVisible();
    expect(aantal(verzoeken, '/api/instellingen'), 'geen instellingenverzoek vóór de login').toBe(0);
    expect(aantal(verzoeken, '/api/auth-ik')).toBe(1);
    await logIn(page, 'b2@test.be');
    await wachtOpWachtrij(page);
    expect(aantal(verzoeken, '/api/auth-ik'), 'één 401 en één vers verzoek na de login').toBe(2);
    expect(aantal(verzoeken, '/api/instellingen')).toBe(1);
    expect((await lees(page, 'blitz_settings')).startlocatie).toBe('Straat van B 2');
  });

  test('bewaarde sessie van A, auth-ik 401, vroeg overzicht van A (200): na inloggen als ANDERE gebruiker B krijgt B enkel de eigen instellingen', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/auth-login']);
    verwachtHttpFout(verzoeken, [{ pad: '/api/auth-ik', status: 401 }]);
    await bewaarSessie(page, { id: 'u-a', email: 'a@test.be', naam: 'Gebruiker A', rol: 'beheerder' });
    const l = loginStubs(GEBRUIKER_B);
    // De eerste GET (het vroege verzoek, nog met de cookie van A) geeft A's overzicht; elke volgende GET het overzicht van B.
    await startAppProductie(page, { wachtOpApp: false, overschrijf: { ...l.overschrijf, instellingen: instellingenRij(overzicht('u-a', A_WAARDEN), overzicht('u-b', B_WAARDEN)) } });
    await expect(overlay(page)).toBeVisible();
    expect(aantal(verzoeken, '/api/instellingen'), 'het vroege verzoek is gestart (bewaarde sessie)').toBe(1);
    await logIn(page, 'b2@test.be');
    await wachtOpWachtrij(page);
    expect(aantal(verzoeken, '/api/instellingen'), 'een vers overzicht na de login: het vroege is weggegooid').toBe(2);
    expect(await leesTekst(page, 'blitz_instellingen_eigenaar')).toBe('u-b');
    expect((await lees(page, 'blitz_settings')).startlocatie).toBe('Straat van B 2');
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('Straat van A');
  });

  test('bewaarde sessie van B, auth-ik 401, vroeg overzicht van B (200, oude waarden): na inloggen als B telt enkel het verse overzicht (het inlogscherm schakelt het vroege uit)', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/auth-login']);
    verwachtHttpFout(verzoeken, [{ pad: '/api/auth-ik', status: 401 }]);
    await bewaarSessie(page, GEBRUIKER_B);
    const l = loginStubs(GEBRUIKER_B);
    // Zelfde gebruikerId in beide antwoorden: enkel de "geen inlogscherm ertussen"-bewaking (rol-schil: vroegToegestaan) houdt het oude overzicht tegen.
    await startAppProductie(page, { wachtOpApp: false, overschrijf: { ...l.overschrijf, instellingen: instellingenRij(overzicht('u-b', A_WAARDEN), overzicht('u-b', B_WAARDEN)) } });
    await expect(overlay(page)).toBeVisible();
    expect(aantal(verzoeken, '/api/instellingen'), 'het vroege verzoek is gestart (bewaarde sessie)').toBe(1);
    await logIn(page, 'b2@test.be');
    await wachtOpWachtrij(page);
    expect(aantal(verzoeken, '/api/instellingen'), 'een vers overzicht na de login').toBe(2);
    expect((await lees(page, 'blitz_settings')).startlocatie).toBe('Straat van B 2');
  });

  test('verlopen sessie (auth-ik én vroeg overzicht 401): inlogscherm, daarna een vers overzicht', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, [...OPSTART_SCHRIJVEN, '/api/auth-login']);
    verwachtHttpFout(verzoeken, [{ pad: '/api/auth-ik', status: 401 }, { pad: '/api/instellingen', status: 401 }]);
    await bewaarSessie(page, GEBRUIKER_B);
    const l = loginStubs(GEBRUIKER_B);
    await startAppProductie(page, {
      wachtOpApp: false,
      overschrijf: { ...l.overschrijf, instellingen: ({ methode }) => (methode === 'PUT' ? { status: 200, json: { versie: 2 } } : (l.staat.ingelogd ? overzicht('u-b', B_WAARDEN) : { status: 401, json: { code: 'niet-ingelogd' } })) },
    });
    await expect(overlay(page)).toBeVisible();
    await logIn(page, 'b2@test.be');
    await wachtOpWachtrij(page);
    expect(aantal(verzoeken, '/api/instellingen')).toBe(2); // het vroege 401-verzoek en één vers verzoek
    expect(aantal(verzoeken, '/api/auth-ik')).toBe(2);
    expect((await lees(page, 'blitz_settings')).startlocatie).toBe('Straat van B 2');
  });

  test('vroeg overzicht met een fout (500): genegeerd, de gewone aanroep levert de instellingen', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    verwachtHttpFout(verzoeken, [{ pad: '/api/instellingen', status: 500 }]);
    await bewaarSessie(page, GEBRUIKER_TEST);
    await startAppProductie(page, { overschrijf: { instellingen: instellingenRij({ status: 500, json: { error: 'stuk' } }, overzicht('u-test', B_WAARDEN)) } });
    expect(aantal(verzoeken, '/api/instellingen')).toBe(2);
    expect(aantal(verzoeken, '/api/auth-ik')).toBe(1);
    expect((await lees(page, 'blitz_settings')).startlocatie).toBe('Straat van B 2');
  });

  test('vroeg overzicht van een ander gebruikerId terwijl auth-ik wel slaagt: genegeerd, de gewone aanroep levert de eigen instellingen', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    await bewaarSessie(page, GEBRUIKER_TEST);
    await startAppProductie(page, { overschrijf: { instellingen: instellingenRij(overzicht('u-vreemd', A_WAARDEN), overzicht('u-test', B_WAARDEN)) } });
    expect(aantal(verzoeken, '/api/instellingen')).toBe(2);
    expect((await lees(page, 'blitz_settings')).startlocatie).toBe('Straat van B 2');
    expect(await leesTekst(page, 'blitz_instellingen_eigenaar')).toBe('u-test');
  });

  test('offline start met bewaarde sessie: de vroege verzoeken falen stil (geen Uncaught), de app start uit de bewaarde sessie', async ({ page, verzoeken }) => {
    verwachtSchrijven(verzoeken, OPSTART_SCHRIJVEN);
    // Elke poging naar auth-ik en instellingen (het vroege verzoek en de gewone aanroep) wordt afgebroken zoals zonder netwerk.
    verwachtNetwerkFout(verzoeken, [{ pad: '/api/auth-ik', methode: 'GET' }, { pad: '/api/instellingen', methode: 'GET' }, { pad: '/api/instellingen', methode: 'GET' }]);
    await bewaarSessie(page, GEBRUIKER_TEST);
    await startAppProductie(page, { overschrijf: { 'auth-ik': () => ({ afbreken: 'failed' }), instellingen: () => ({ afbreken: 'failed' }) } });
    expect(aantal(verzoeken, '/api/auth-ik')).toBe(1);
    expect(aantal(verzoeken, '/api/instellingen')).toBe(2);
    await expect(page.locator('#login-overlay')).toHaveCount(0);
  });
});
