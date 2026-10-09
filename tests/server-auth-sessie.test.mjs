// tests/server-auth-sessie.test.mjs — auth-login, auth-uitloggen, auth-ik, auth-wachtwoord
import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { hashWachtwoord, verifieerWachtwoord } from '../netlify/lib/wachtwoord.js';
import { ondertekenToken, controleerToken, SESSIE_LEVENSDUUR_S } from '../netlify/lib/sessie-token.js';
import { maakAuth } from '../netlify/lib/auth.js';
import { maakHandler as maakLogin } from '../netlify/functions/auth-login.js';
import { maakHandler as maakUitloggen } from '../netlify/functions/auth-uitloggen.js';
import { maakHandler as maakIk } from '../netlify/functions/auth-ik.js';
import { maakHandler as maakWachtwoord } from '../netlify/functions/auth-wachtwoord.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { maskeerEmail } from '../netlify/lib/login-poging.js';

const GEHEIM = 'testgeheim-testgeheim';
const WW = 'JuistWachtwoord1';
const NIEUW = 'NieuwWachtwoord99';
const NU0 = Date.parse('2026-10-08T10:00:00.000Z');
const MIN = 60 * 1000;

let hash;
before(async () => { hash = await hashWachtwoord(WW); });

const gebruikersLijst = () => [
  { id: 'u-jan', email: 'jan@blitz.test', naam: 'Jan', rol: 'planner', actief: true, sessieVersie: 1, wachtwoordHash: hash, herstelcodes: ['x'], aangemaakt: '2026-01-01T00:00:00.000Z' },
  { id: 'u-bea', email: 'bea@blitz.test', naam: 'Bea', rol: 'beheerder', actief: true, sessieVersie: 4, wachtwoordHash: hash },
  { id: 'u-blok', email: 'blok@blitz.test', naam: 'Blok', rol: 'planner', actief: false, sessieVersie: 1, wachtwoordHash: hash },
  { id: 'u-nieuw', email: 'nieuw@blitz.test', naam: 'Nieuw', rol: 'technieker', zohoNaam: 'Tim', actief: true, sessieVersie: 1, wachtwoordHash: hash, moetWachtwoordWijzigen: true },
];

function opzet({ gebruikers = gebruikersLijst(), env = {} } = {}) {
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers } });
  const test = maakNepStore({});
  const aanroepen = [];
  const klok = { ms: NU0 };
  const getStore = opties => { aanroepen.push(opties); return opties.name === 'blitz-data' ? echt : test; };
  const omgeving = { SESSIE_GEHEIM: GEHEIM, ...env };
  const nu = () => klok.ms;
  const auth = maakAuth({ getStore, env: omgeving, nu });
  const scrypt = { aantal: 0 };
  const verifieer = async (w, h) => { scrypt.aantal++; return verifieerWachtwoord(w, h); };
  const deps = { getStore, env: omgeving, nu, verifieer };
  return {
    echt, test, aanroepen, klok, omgeving, auth, scrypt,
    login: maakLogin(deps),
    uitloggen: maakUitloggen(deps),
    ik: maakIk({ ...deps, auth }),
    wachtwoord: maakWachtwoord({ ...deps, auth }),
  };
}

const post = (pad, body, headers = {}) => new Request(`http://localhost/api/${pad}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-blitz': '1', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const get = (pad, headers = {}) => new Request(`http://localhost/api/${pad}`, { method: 'GET', headers });
const loginReq = (email, wachtwoord, headers) => post('auth-login', { email, wachtwoord }, headers);

const cookieWaarde = res => {
  const c = res.headers.get('set-cookie');
  if (!c) return null;
  return /blitz_sessie=([^;]*)/.exec(c)?.[1] ?? null;
};
const metCookie = (token, extra = {}) => ({ cookie: `blitz_sessie=${token}`, ...extra });
const tokenVoor = (uid, sv, exp, geheim = GEHEIM) => ondertekenToken({ uid, sv, exp }, geheim);
const nuS = () => Math.floor(NU0 / 1000);

async function activiteit(echt) {
  const blob = await echt.get('activiteit/2026-10', { type: 'json' });
  return blob?.items ?? [];
}

// ---- auth-login ----
test('login: juist -> 200 + cookie die controleerToken aanvaardt (uid/sv), publieke gebruiker', async () => {
  const o = opzet();
  const res = await o.login(loginReq('jan@blitz.test', WW));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.gebruiker.id, 'u-jan');
  assert.equal(body.moetWachtwoordWijzigen, false);
  const json = JSON.stringify(body);
  for (const verboden of ['Hash', 'herstelcodes', 'sessieVersie']) assert.ok(!json.includes(verboden), verboden);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  const claims = controleerToken(cookieWaarde(res), GEHEIM, nuS());
  assert.equal(claims.uid, 'u-jan');
  assert.equal(claims.sv, 1);
  assert.equal(claims.exp, nuS() + SESSIE_LEVENSDUUR_S);
});

test('login: e-mail wordt genormaliseerd (spaties, hoofdletters)', async () => {
  const o = opzet();
  const res = await o.login(loginReq('  Jan@Blitz.TEST ', WW));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).gebruiker.email, 'jan@blitz.test');
});

test('login: moetWachtwoordWijzigen wordt doorgegeven', async () => {
  const o = opzet();
  const res = await o.login(loginReq('nieuw@blitz.test', WW));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).moetWachtwoordWijzigen, true);
});

test('login: fout wachtwoord, onbekend adres en geblokkeerde gebruiker geven byte-identieke 401', async () => {
  const o = opzet();
  const a = await o.login(loginReq('jan@blitz.test', 'verkeerd-wachtwoord'));
  const b = await o.login(loginReq('bestaat-niet@blitz.test', WW));
  const c = await o.login(loginReq('blok@blitz.test', WW)); // juist wachtwoord, maar geblokkeerd
  for (const r of [a, b, c]) assert.equal(r.status, 401);
  const ta = await a.text(), tb = await b.text(), tc = await c.text();
  assert.equal(ta, JSON.stringify({ error: 'Onjuist e-mailadres of wachtwoord' }));
  assert.equal(tb, ta);
  assert.equal(tc, ta);
  for (const r of [a, b, c]) assert.equal(r.headers.get('set-cookie'), null);
});

test('login: onbekend adres draait toch een scrypt-verificatie (uniforme tijd)', async () => {
  const o = opzet();
  const t0 = performance.now();
  await o.login(loginReq('bestaat-niet@blitz.test', WW));
  const duur = performance.now() - t0;
  assert.ok(duur > 5, `schijn-verificatie lijkt overgeslagen (${duur.toFixed(1)} ms)`);
});

test('login: 5 pogingen echt gecontroleerd; na 5 fouten is de 6e (zelfs juist) 429 zonder scrypt, opnieuwOp = nu + 15 min; erna weer mogelijk', async () => {
  const o = opzet();
  for (let i = 0; i < 5; i++) {
    const r = await o.login(loginReq('jan@blitz.test', 'fout-' + i));
    assert.equal(r.status, 401, `poging ${i + 1}`);
  }
  assert.equal(o.scrypt.aantal, 5);
  const vast = await o.login(loginReq('jan@blitz.test', WW));
  assert.equal(vast.status, 429);
  assert.equal(o.scrypt.aantal, 5, 'vergrendelde poging mag geen scrypt draaien');
  const body = await vast.json();
  assert.equal(body.opnieuwOp, new Date(NU0 + 15 * MIN).toISOString());
  assert.ok(body.error);
  assert.equal(vast.headers.get('set-cookie'), null);
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 429);
  assert.equal(o.scrypt.aantal, 5);

  o.klok.ms = NU0 + 15 * MIN + 1000;
  const weer = await o.login(loginReq('jan@blitz.test', WW));
  assert.equal(weer.status, 200);
});

test('login: 4 fouten + een juiste 5e poging -> 200 en de teller is gewist', async () => {
  const o = opzet();
  for (let i = 0; i < 4; i++) assert.equal((await o.login(loginReq('jan@blitz.test', 'fout-' + i))).status, 401);
  const res = await o.login(loginReq('jan@blitz.test', WW));
  assert.equal(res.status, 200);
  assert.ok(cookieWaarde(res));
  assert.deepEqual((await o.echt.get('login-pogingen', { type: 'json' })).login, {});
  // geen vergrendeling meer: weer 4 fouten + 1 juiste lukt
  for (let i = 0; i < 4; i++) assert.equal((await o.login(loginReq('jan@blitz.test', 'fout-' + i))).status, 401);
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 200);
  assert.equal((await activiteit(o.echt)).filter(i => i.actie === 'login-mislukt-reeks').length, 0);
});

test('login: vergrendeling verraadt niet of het adres bestaat (zelfde 429-vorm)', async () => {
  const o = opzet();
  const vorm = async email => {
    for (let i = 0; i < 5; i++) await o.login(loginReq(email, 'fout-' + i));
    const r = await o.login(loginReq(email, WW));
    return { status: r.status, body: await r.json() };
  };
  const bekend = await vorm('jan@blitz.test');
  const onbekend = await vorm('niemand@blitz.test');
  assert.deepEqual(bekend, onbekend);
  assert.equal(bekend.status, 429);
});

test('login: een juist wachtwoord na de reservering wist de teller', async () => {
  const o = opzet();
  for (let i = 0; i < 3; i++) await o.login(loginReq('jan@blitz.test', 'fout-' + i));
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 200);
  const staat = await o.echt.get('login-pogingen', { type: 'json' });
  assert.deepEqual(staat.login, {});
  // na het wissen opnieuw 3 fouten toegelaten zonder vergrendeling
  for (let i = 0; i < 3; i++) assert.equal((await o.login(loginReq('jan@blitz.test', 'fout-' + i))).status, 401);
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 200);
});

test('login: een mislukte poging wordt niet dubbel geteld', async () => {
  const o = opzet();
  await o.login(loginReq('jan@blitz.test', 'fout'));
  const staat = await o.echt.get('login-pogingen', { type: 'json' });
  assert.deepEqual(Object.values(staat.login).map(e => e.p.length), [1]);
});

test('login: parallelle stoot foute pogingen laat nooit meer dan de limiet door naar scrypt', async () => {
  const o = opzet();
  const resultaten = await Promise.all(Array.from({ length: 25 }, (_, i) => o.login(loginReq('jan@blitz.test', 'fout-' + i))));
  assert.ok(resultaten.every(r => r.status === 401 || r.status === 429));
  assert.ok(o.scrypt.aantal <= 5, `scrypt liep ${o.scrypt.aantal}x`);
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 429);
});

test('login: mislukte opslag van de pogingenteller telt als vergrendeld (fail closed), zonder scrypt', async () => {
  const o = opzet();
  const origineel = o.echt.setJSON.bind(o.echt);
  o.echt.setJSON = async (key, obj) => {
    if (key === 'login-pogingen') throw new Error('storing');
    return origineel(key, obj);
  };
  const res = await o.login(loginReq('jan@blitz.test', 'fout'));
  assert.equal(res.status, 429);
  assert.ok((await res.json()).opnieuwOp);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(o.scrypt.aantal, 0);
  // ook een juist wachtwoord komt er dan niet door
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 429);
  assert.equal(o.scrypt.aantal, 0);
});

test('login: schrijft login-laatst en laat de blob gebruikers ongemoeid', async () => {
  const o = opzet();
  await o.login(loginReq('jan@blitz.test', WW));
  const laatst = await o.echt.get('login-laatst', { type: 'json' });
  assert.equal(laatst['u-jan'], new Date(NU0).toISOString());
  assert.equal(o.echt._schrijfacties.filter(s => s.key === 'gebruikers').length, 0);
});

test('login: activiteit bevat login en login-mislukt-reeks (bekend adres: de gebruiker zelf, geen onderwerp)', async () => {
  const o = opzet();
  await o.login(loginReq('jan@blitz.test', WW));
  for (let i = 0; i < 5; i++) await o.login(loginReq('bea@blitz.test', 'fout-' + i));
  const items = await activiteit(o.echt);
  const login = items.filter(i => i.actie === 'login');
  assert.equal(login.length, 1);
  assert.equal(login[0].gebruikerId, 'u-jan');
  const reeks = items.filter(i => i.actie === 'login-mislukt-reeks');
  assert.equal(reeks.length, 1);
  assert.equal(reeks[0].gebruikerId, 'u-bea');
  assert.equal(reeks[0].onderwerp, null);
  assert.ok(!JSON.stringify(reeks[0]).includes('bea@blitz.test'));
});

test('login: onbekend adres in login-mislukt-reeks: Systeem met gemaskeerd adres', async () => {
  const o = opzet();
  for (let i = 0; i < 5; i++) await o.login(loginReq('Niemand@Blitz.test', 'fout-' + i));
  const reeks = (await activiteit(o.echt)).filter(i => i.actie === 'login-mislukt-reeks');
  assert.equal(reeks.length, 1);
  assert.equal(reeks[0].gebruikerId, 'systeem');
  assert.equal(reeks[0].naam, 'Systeem');
  assert.equal(reeks[0].onderwerp, 'n***@blitz.test');
  assert.ok(!JSON.stringify(reeks[0]).toLowerCase().includes('niemand'));
});

test('maskeerEmail: eerste teken + *** + @domein; zonder @ eerste teken + ***', () => {
  assert.equal(maskeerEmail('jan@blitz.be'), 'j***@blitz.be');
  assert.equal(maskeerEmail('zonder-apenstaart'), 'z***');
  assert.equal(maskeerEmail(''), '***');
});

test('login: zonder X-Blitz: 1 -> 403 met algemene tekst (geen cookie, geen scrypt, geen pogingtelling)', async () => {
  const o = opzet();
  const res = await o.login(new Request('http://localhost/api/auth-login', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ email: 'jan@blitz.test', wachtwoord: WW }),
  }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Verzoek geweigerd.', code: 'csrf' });
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(o.scrypt.aantal, 0);
  assert.equal(o.echt._data.has('login-pogingen'), false);
});

test('login: gebruiker met onbekende rol -> dezelfde 401 (geen cookie)', async () => {
  const lijst = gebruikersLijst();
  lijst[0].rol = 'superadmin';
  const o = opzet({ gebruikers: lijst });
  const res = await o.login(loginReq('jan@blitz.test', WW));
  assert.equal(res.status, 401);
  assert.equal(await res.text(), JSON.stringify({ error: 'Onjuist e-mailadres of wachtwoord' }));
  assert.equal(res.headers.get('set-cookie'), null);
});

test('login: met X-Blitz-Test gebruikt toch de echte store blitz-data (strong)', async () => {
  const o = opzet();
  const res = await o.login(loginReq('jan@blitz.test', WW, { 'x-blitz-test': '1' }));
  assert.equal(res.status, 200);
  assert.ok(o.aanroepen.length > 0);
  for (const opties of o.aanroepen) {
    assert.equal(opties.name, 'blitz-data');
    assert.equal(opties.consistency, 'strong');
  }
  assert.ok((await activiteit(o.echt)).some(i => i.actie === 'login'));
});

test('login: geen JSON of ontbrekende velden -> 400; GET -> 405; OPTIONS -> 204', async () => {
  const o = opzet();
  assert.equal((await o.login(post('auth-login', 'geen json{'))).status, 400);
  assert.equal((await o.login(post('auth-login', { email: 'a@b.be' }))).status, 400);
  assert.equal((await o.login(post('auth-login', { email: 5, wachtwoord: 'x' }))).status, 400);
  assert.equal((await o.login(post('auth-login', '[]'))).status, 400);
  assert.equal((await o.login(get('auth-login'))).status, 405);
  assert.equal((await o.login(new Request('http://localhost/api/auth-login', { method: 'OPTIONS' }))).status, 204);
});

test('login: zonder SESSIE_GEHEIM geen sessie (500, geen cookie)', async () => {
  const o = opzet({ env: { SESSIE_GEHEIM: '' } });
  const res = await o.login(loginReq('jan@blitz.test', WW));
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('login: te lang wachtwoord (> 200) -> gewone 401', async () => {
  const o = opzet();
  const res = await o.login(loginReq('jan@blitz.test', 'x'.repeat(5000)));
  assert.equal(res.status, 401);
});

test('login: opslagstoring bij het lezen -> 503 (geen 401, geen cookie)', async () => {
  const o = opzet();
  o.echt.get = async () => { throw new Error('storing'); };
  const res = await o.login(loginReq('jan@blitz.test', WW));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('login: lokale dev laat Secure weg', async () => {
  const o = opzet({ env: { BLITZ_LOKALE_DEV: '1' } });
  const res = await o.login(loginReq('jan@blitz.test', WW));
  assert.equal(res.status, 200);
  assert.ok(!/Secure/.test(res.headers.get('set-cookie')));
});

// ---- auth-uitloggen ----
test('uitloggen: cookie gewist (Max-Age=0), logt uitloggen bij geldige sessie', async () => {
  const o = opzet();
  const token = tokenVoor('u-jan', 1, nuS() + 1000);
  const res = await o.uitloggen(post('auth-uitloggen', {}, metCookie(token)));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  const items = await activiteit(o.echt);
  assert.equal(items.filter(i => i.actie === 'uitloggen').length, 1);
  assert.equal(items.find(i => i.actie === 'uitloggen').gebruikerId, 'u-jan');
});

test('uitloggen: zonder sessie of met rommelcookie ook 200 en niets gelogd', async () => {
  const o = opzet();
  const a = await o.uitloggen(post('auth-uitloggen', {}));
  const b = await o.uitloggen(post('auth-uitloggen', {}, metCookie('rommel')));
  for (const r of [a, b]) {
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  }
  assert.equal((await activiteit(o.echt)).length, 0);
});

test('uitloggen: zonder X-Blitz: 1 -> 403 en de cookie blijft staan', async () => {
  const o = opzet();
  const token = tokenVoor('u-jan', 1, nuS() + 1000);
  const res = await o.uitloggen(new Request('http://localhost/api/auth-uitloggen', {
    method: 'POST', headers: { 'content-type': 'text/plain', ...metCookie(token) }, body: '{}',
  }));
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'Verzoek geweigerd.', code: 'csrf' });
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal((await activiteit(o.echt)).length, 0);
});

test('uitloggen: GET -> 405', async () => {
  const o = opzet();
  assert.equal((await o.uitloggen(get('auth-uitloggen'))).status, 405);
});

// ---- auth-ik ----
test('auth-ik: met cookie -> gebruiker zonder hashes, rechten en lokaleDev', async () => {
  const o = opzet();
  const token = tokenVoor('u-bea', 4, nuS() + 20 * 86400);
  const res = await o.ik(get('auth-ik', metCookie(token)));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.gebruiker.id, 'u-bea');
  assert.deepEqual(body.rechten, { beheer: true, plannen: true, alleSales: true });
  assert.equal(body.moetWachtwoordWijzigen, false);
  assert.equal(body.lokaleDev, false);
  const json = JSON.stringify(body);
  for (const verboden of ['Hash', 'herstelcodes', 'sessieVersie']) assert.ok(!json.includes(verboden), verboden);
});

test('auth-ik: lokaleDev volgt de omgeving', async () => {
  const o = opzet({ env: { BLITZ_LOKALE_DEV: '1' } });
  const token = tokenVoor('u-jan', 1, nuS() + 20 * 86400);
  const res = await o.ik(get('auth-ik', metCookie(token)));
  assert.equal((await res.json()).lokaleDev, true);
});

test('auth-ik: cookie die over 10 dagen verloopt wordt verlengd; over 20 dagen niet', async () => {
  const o = opzet();
  const kort = await o.ik(get('auth-ik', metCookie(tokenVoor('u-jan', 1, nuS() + 10 * 86400))));
  assert.equal(kort.status, 200);
  const nieuw = cookieWaarde(kort);
  assert.ok(nieuw);
  const claims = controleerToken(nieuw, GEHEIM, nuS());
  assert.equal(claims.uid, 'u-jan');
  assert.equal(claims.sv, 1);
  assert.equal(claims.exp, nuS() + SESSIE_LEVENSDUUR_S);
  const lang = await o.ik(get('auth-ik', metCookie(tokenVoor('u-jan', 1, nuS() + 20 * 86400))));
  assert.equal(lang.status, 200);
  assert.equal(lang.headers.get('set-cookie'), null);
});

test('auth-ik: zonder cookie, 0 gebruikers en BEHEER_SETUP_CODE -> 401 met setupNodig true', async () => {
  const o = opzet({ gebruikers: [], env: { BEHEER_SETUP_CODE: 'code-123' } });
  const res = await o.ik(get('auth-ik'));
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.code, 'niet-ingelogd');
  assert.equal(body.setupNodig, true);
  assert.ok(body.error);
});

test('auth-ik: setupNodig is false met gebruikers of zonder BEHEER_SETUP_CODE', async () => {
  const a = opzet({ env: { BEHEER_SETUP_CODE: 'code-123' } });
  assert.equal((await (await a.ik(get('auth-ik'))).json()).setupNodig, false);
  const b = opzet({ gebruikers: [] });
  const rb = await b.ik(get('auth-ik'));
  assert.equal(rb.status, 401);
  assert.equal((await rb.json()).setupNodig, false);
});

test('auth-ik: gebruiker met moetWachtwoordWijzigen krijgt 200 (niet 403) via wrapper en rij', async () => {
  assert.equal(RECHTEN['auth-ik'].ookBijWijzigen, true);
  const o = opzet();
  const token = tokenVoor('u-nieuw', 1, nuS() + 20 * 86400);
  const res = await o.ik(get('auth-ik', metCookie(token)));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).moetWachtwoordWijzigen, true);
});

test('auth-ik: Blobs-fout na de geslaagde wrappercontrole -> 503 opslag-storing (geen 500, geen 401)', async () => {
  const o = opzet();
  const oorspronkelijk = o.echt.get.bind(o.echt);
  let leesbeurten = 0;
  o.echt.get = async (key, opties) => {
    if (key === 'gebruikers' && ++leesbeurten >= 2) throw new Error('Blobs onbereikbaar (geheim detail)');
    return oorspronkelijk(key, opties);
  };
  const token = tokenVoor('u-jan', 1, nuS() + 20 * 86400);
  const res = await o.ik(get('auth-ik', metCookie(token)));
  assert.equal(leesbeurten, 2, 'de wrapper las eenmaal, de kern een tweede keer');
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'opslag-storing');
  assert.ok(!JSON.stringify(body).includes('geheim detail'));
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('auth-ik: ongeldig token, geblokkeerde gebruiker of verouderde sessieVersie -> 401', async () => {
  const o = opzet();
  for (const t of ['rommel', tokenVoor('u-blok', 1, nuS() + 1000), tokenVoor('u-jan', 99, nuS() + 1000)]) {
    assert.equal((await o.ik(get('auth-ik', metCookie(t)))).status, 401);
  }
});

test('auth-ik: opslagstoring -> 503 blijft 503', async () => {
  const o = opzet();
  o.echt.get = async () => { throw new Error('storing'); };
  const res = await o.ik(get('auth-ik', metCookie(tokenVoor('u-jan', 1, nuS() + 1000))));
  assert.equal(res.status, 503);
});

test('auth-ik: POST -> 405', async () => {
  const o = opzet();
  assert.equal((await o.ik(post('auth-ik', {}, { 'x-blitz': '1', ...metCookie(tokenVoor('u-jan', 1, nuS() + 1000)) }))).status, 405);
});

// ---- auth-wachtwoord ----
const wwReq = (token, body, extra = {}) => post('auth-wachtwoord', body, { 'x-blitz': '1', ...metCookie(token), ...extra });

test('wachtwoord: juist huidig + geldig nieuw -> 200, verse cookie (sv+1), oud token ongeldig, inloggen met nieuw lukt', async () => {
  const o = opzet();
  const oud = tokenVoor('u-jan', 1, nuS() + 20 * 86400);
  const res = await o.wachtwoord(wwReq(oud, { huidig: WW, nieuw: NIEUW }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const nieuwToken = cookieWaarde(res);
  assert.ok(nieuwToken);
  assert.notEqual(nieuwToken, oud);
  const claims = controleerToken(nieuwToken, GEHEIM, nuS());
  assert.equal(claims.uid, 'u-jan');
  assert.equal(claims.sv, 2);
  // oud token wordt door vereisGebruiker geweigerd, nieuw aanvaard
  const verzoek = t => ({ httpMethod: 'GET', headers: metCookie(t) });
  assert.equal((await o.auth.vereisGebruiker(verzoek(oud))).status, 401);
  assert.equal((await o.auth.vereisGebruiker(verzoek(nieuwToken))).ok, true);
  assert.equal((await o.login(loginReq('jan@blitz.test', NIEUW))).status, 200);
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 401);
  const items = await activiteit(o.echt);
  assert.equal(items.filter(i => i.actie === 'wachtwoord-gewijzigd').length, 1);
});

test('wachtwoord: andere velden van de gebruiker blijven behouden', async () => {
  const o = opzet();
  await o.wachtwoord(wwReq(tokenVoor('u-jan', 1, nuS() + 1000), { huidig: WW, nieuw: NIEUW }));
  const lijst = (await o.echt.get('gebruikers', { type: 'json' })).gebruikers;
  const jan = lijst.find(g => g.id === 'u-jan');
  assert.deepEqual(jan.herstelcodes, ['x']);
  assert.equal(jan.rol, 'planner');
  assert.equal(lijst.length, 4);
});

test('wachtwoord: fout huidig -> 400 (niet 401) en telt als mislukte poging; na 5 fouten 429 zonder scrypt en gelogd', async () => {
  const o = opzet();
  const t = tokenVoor('u-jan', 1, nuS() + 1000);
  const res = await o.wachtwoord(wwReq(t, { huidig: 'fout-fout-fout', nieuw: NIEUW }));
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('set-cookie'), null);
  const staat = await o.echt.get('login-pogingen', { type: 'json' });
  const vermeldingen = Object.values(staat.login);
  assert.equal(vermeldingen.length, 1);
  assert.equal(vermeldingen[0].p.length, 1); // niet dubbel geteld
  // 4 extra fouten -> 5 echte pogingen (de 5e vergrendelt); de 6e (zelfs juiste) is 429 zonder scrypt
  for (let i = 0; i < 4; i++) assert.equal((await o.wachtwoord(wwReq(t, { huidig: 'fout-' + i + '-fout', nieuw: NIEUW }))).status, 400);
  assert.equal(o.scrypt.aantal, 5);
  const vast = await o.wachtwoord(wwReq(t, { huidig: WW, nieuw: NIEUW }));
  assert.equal(vast.status, 429);
  assert.equal(o.scrypt.aantal, 5);
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 429);
  const reeks = (await activiteit(o.echt)).filter(i => i.actie === 'login-mislukt-reeks');
  assert.equal(reeks.length, 1);
  assert.equal(reeks[0].gebruikerId, 'u-jan');
  assert.equal(reeks[0].onderwerp, null);
});

test('wachtwoord: 4 fouten + een juiste 5e poging -> 200 en de teller is gewist', async () => {
  const o = opzet();
  const t = tokenVoor('u-jan', 1, nuS() + 1000);
  for (let i = 0; i < 4; i++) assert.equal((await o.wachtwoord(wwReq(t, { huidig: 'fout-' + i + '-fout', nieuw: NIEUW }))).status, 400);
  assert.equal((await o.wachtwoord(wwReq(t, { huidig: WW, nieuw: NIEUW }))).status, 200);
  assert.deepEqual((await o.echt.get('login-pogingen', { type: 'json' })).login, {});
});

test('wachtwoord: parallelle stoot foute pogingen laat nooit meer dan de limiet door naar scrypt', async () => {
  const o = opzet();
  const t = tokenVoor('u-jan', 1, nuS() + 1000);
  const res = await Promise.all(Array.from({ length: 25 }, (_, i) => o.wachtwoord(wwReq(t, { huidig: 'fout-' + i + '-fout', nieuw: NIEUW }))));
  assert.ok(res.every(r => r.status === 400 || r.status === 429));
  assert.ok(o.scrypt.aantal <= 5, `scrypt liep ${o.scrypt.aantal}x`);
});

test('wachtwoord: schrijffout op de pogingenteller -> 429 zonder scrypt', async () => {
  const o = opzet();
  const t = tokenVoor('u-jan', 1, nuS() + 1000);
  const origineel = o.echt.setJSON.bind(o.echt);
  o.echt.setJSON = async (key, obj) => {
    if (key === 'login-pogingen') throw new Error('storing');
    return origineel(key, obj);
  };
  const res = await o.wachtwoord(wwReq(t, { huidig: WW, nieuw: NIEUW }));
  assert.equal(res.status, 429);
  assert.equal(o.scrypt.aantal, 0);
});

test('wachtwoord: een geslaagde wijziging wist de teller', async () => {
  const o = opzet();
  const t = tokenVoor('u-jan', 1, nuS() + 1000);
  await o.wachtwoord(wwReq(t, { huidig: 'fout-fout-fout', nieuw: NIEUW }));
  assert.equal((await o.wachtwoord(wwReq(t, { huidig: WW, nieuw: NIEUW }))).status, 200);
  assert.deepEqual((await o.echt.get('login-pogingen', { type: 'json' })).login, {});
});

test('wachtwoord: beleidsfout (9 tekens) en nieuw === huidig -> 400', async () => {
  const o = opzet();
  const t = tokenVoor('u-jan', 1, nuS() + 1000);
  const kort = await o.wachtwoord(wwReq(t, { huidig: WW, nieuw: '123456789' }));
  assert.equal(kort.status, 400);
  assert.ok((await kort.json()).error);
  const gelijk = await o.wachtwoord(wwReq(t, { huidig: WW, nieuw: WW }));
  assert.equal(gelijk.status, 400);
  const lijst = (await o.echt.get('gebruikers', { type: 'json' })).gebruikers;
  assert.equal(lijst.find(g => g.id === 'u-jan').sessieVersie, 1);
});

test('wachtwoord: ontbrekende of niet-tekstvelden en ongeldige JSON -> 400', async () => {
  const o = opzet();
  const t = tokenVoor('u-jan', 1, nuS() + 1000);
  assert.equal((await o.wachtwoord(wwReq(t, { huidig: WW }))).status, 400);
  assert.equal((await o.wachtwoord(wwReq(t, { huidig: 1, nieuw: 2 }))).status, 400);
  assert.equal((await o.wachtwoord(wwReq(t, 'geen json'))).status, 400);
});

test('wachtwoord: zonder X-Blitz -> 403 csrf; zonder sessie -> 401 (kern niet bereikt)', async () => {
  const o = opzet();
  const t = tokenVoor('u-jan', 1, nuS() + 1000);
  const zonderCsrf = await o.wachtwoord(new Request('http://localhost/api/auth-wachtwoord', {
    method: 'POST', headers: { 'content-type': 'application/json', ...metCookie(t) }, body: JSON.stringify({ huidig: WW, nieuw: NIEUW }),
  }));
  assert.equal(zonderCsrf.status, 403);
  const zonderSessie = await o.wachtwoord(post('auth-wachtwoord', { huidig: WW, nieuw: NIEUW }, { 'x-blitz': '1' }));
  assert.equal(zonderSessie.status, 401);
});

test('wachtwoord: gebruiker met moetWachtwoordWijzigen kan wijzigen (geen 403) en daarna normaal verder', async () => {
  assert.equal(RECHTEN['auth-wachtwoord'].ookBijWijzigen, true);
  const o = opzet();
  const t = tokenVoor('u-nieuw', 1, nuS() + 1000);
  // andere beveiligde functie geeft vooraf 403 wachtwoord-wijzigen
  const voor = await o.auth.vereisGebruiker({ httpMethod: 'GET', headers: metCookie(t) }, {});
  assert.equal(voor.code, 'wachtwoord-wijzigen');
  const res = await o.wachtwoord(wwReq(t, { huidig: WW, nieuw: NIEUW }));
  assert.equal(res.status, 200);
  const nieuwToken = cookieWaarde(res);
  const na = await o.auth.vereisGebruiker({ httpMethod: 'GET', headers: metCookie(nieuwToken) }, {});
  assert.equal(na.ok, true);
  const ik = await o.ik(get('auth-ik', metCookie(nieuwToken)));
  assert.equal((await ik.json()).moetWachtwoordWijzigen, false);
});

test('wachtwoord: opslagfout bij het schrijven van de gebruikers -> geen wijziging', async () => {
  const o = opzet();
  const t = tokenVoor('u-jan', 1, nuS() + 1000);
  const origineel = o.echt.setJSON.bind(o.echt);
  o.echt.setJSON = async (key, obj) => {
    if (key === 'gebruikers') throw new Error('storing');
    return origineel(key, obj);
  };
  const res = await o.wachtwoord(wwReq(t, { huidig: WW, nieuw: NIEUW }));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('wachtwoord: rijen in RECHTEN', () => {
  assert.deepEqual(RECHTEN['auth-login'], { '*': 'open' });
  assert.deepEqual(RECHTEN['auth-uitloggen'], { '*': 'open' });
  assert.deepEqual([...RECHTEN['auth-ik'].GET].sort(), ['beheerder', 'planner', 'sales', 'technieker']);
  assert.deepEqual([...RECHTEN['auth-wachtwoord'].POST].sort(), ['beheerder', 'planner', 'sales', 'technieker']);
});
