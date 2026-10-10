// tests/server-gebruikers.test.mjs — /api/gebruikers (beheer van gebruikers, enkel beheerder; sales-overzicht)
import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { hashWachtwoord } from '../netlify/lib/wachtwoord.js';
import { ondertekenToken } from '../netlify/lib/sessie-token.js';
import { maakAuth } from '../netlify/lib/auth.js';
import { maakHandler as maakGebruikers } from '../netlify/functions/gebruikers.js';
import { maakHandler as maakLogin } from '../netlify/functions/auth-login.js';
import { maakHandler as maakHerstel } from '../netlify/functions/auth-herstel.js';
import { maakHerstelcodes } from '../netlify/lib/herstel.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { metRol, metGeenSessie } from './auth-hulp.mjs';

const GEHEIM = 'testgeheim-testgeheim';
const WW = 'JuistWachtwoord1';
const NU0 = Date.parse('2026-10-08T10:00:00.000Z');
const CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

let hash, codeSet;
before(async () => {
  hash = await hashWachtwoord(WW);
  codeSet = await maakHerstelcodes();
});

const lijst = () => [
  { id: 'u-bea', email: 'bea@blitz.test', naam: 'Bea', rol: 'beheerder', actief: true, sessieVersie: 4, wachtwoordHash: hash, herstelcodes: [...codeSet.hashes], aangemaakt: '2026-01-01T00:00:00.000Z' },
  { id: 'u-jan', email: 'jan@blitz.test', naam: 'Jan', rol: 'planner', actief: true, sessieVersie: 1, wachtwoordHash: hash, aangemaakt: '2026-01-02T00:00:00.000Z' },
  { id: 'u-tim', email: 'tim@blitz.test', naam: 'Tim', rol: 'technieker', zohoNaam: 'Tim Z', actief: true, sessieVersie: 1, wachtwoordHash: hash },
  { id: 'u-sal', email: 'sal@blitz.test', naam: 'Sal', rol: 'sales', salesNaam: 'Sal V', magAlleSales: false, actief: true, sessieVersie: 1, wachtwoordHash: hash },
  { id: 'u-sam', email: 'sam@blitz.test', naam: 'Sam', rol: 'sales', salesNaam: 'Sam V', magAlleSales: true, actief: true, sessieVersie: 1, wachtwoordHash: hash },
  { id: 'u-uit', email: 'uit@blitz.test', naam: 'Uit', rol: 'sales', salesNaam: 'Uit V', magAlleSales: false, actief: false, sessieVersie: 1, wachtwoordHash: hash },
];

function opzet({ gebruikers = lijst(), extra = {} } = {}) {
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers }, ...extra });
  const test = maakNepStore({});
  const getStore = opties => (opties.name === 'blitz-data' ? echt : test);
  const env = { SESSIE_GEHEIM: GEHEIM };
  const nu = () => NU0;
  const auth = maakAuth({ getStore, env, nu });
  const deps = { getStore, env, nu };
  return {
    echt, test, auth,
    gebruikers: maakGebruikers({ ...deps, auth }),
    login: maakLogin(deps),
    herstel: maakHerstel(deps),
  };
}

const token = (uid, sv) => ondertekenToken({ uid, sv, exp: Math.floor(NU0 / 1000) + 3600 }, GEHEIM);
const als = (uid, sv, extra = {}) => ({ cookie: `blitz_sessie=${token(uid, sv)}`, ...extra });
const BEA = () => als('u-bea', 4);
const req = (methode, body, headers = BEA(), zoek = '') => new Request(`http://localhost/api/gebruikers${zoek}`, {
  method: methode,
  headers: { 'content-type': 'application/json', 'x-blitz': '1', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const get = (headers = BEA(), zoek = '') => req('GET', undefined, headers, zoek);
const maak = (extra = {}, headers) => req('POST', { actie: 'maak', email: 'nieuw@blitz.test', naam: 'Nieuw', rol: 'planner', ...extra }, headers);
const loginReq = (email, wachtwoord) => new Request('http://localhost/api/auth-login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-blitz': '1' }, body: JSON.stringify({ email, wachtwoord }),
});
const herstelReq = (email, bewijs) => new Request('http://localhost/api/auth-herstel', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-blitz': '1' },
  body: JSON.stringify({ email, bewijs, nieuwWachtwoord: 'NieuwWachtwoord99' }),
});
const opgeslagen = async echt => (await echt.get('gebruikers', { type: 'json' })).gebruikers;
const record = async (echt, id) => (await opgeslagen(echt)).find(g => g.id === id);
const activiteit = async echt => (await echt.get('activiteit/2026-10', { type: 'json' }))?.items ?? [];
const verboden = json => ['wachtwoordHash', 'scrypt$', 'herstelcodes', 'sessieVersie'].filter(v => json.includes(v));

// ---------------- rechten ----------------
test('rechtenrij: GET beheerder + planner (beperkt) + sales, POST/PATCH enkel beheerder, geen DELETE', () => {
  assert.deepEqual([...RECHTEN.gebruikers.GET], ['beheerder', 'planner', 'sales']);
  assert.deepEqual([...RECHTEN.gebruikers.POST], ['beheerder']);
  assert.deepEqual([...RECHTEN.gebruikers.PATCH], ['beheerder']);
  assert.equal(RECHTEN.gebruikers.DELETE, undefined);
});

test('zonder sessie: 401; planner, technieker en sales (via metRol): 403 op POST en PATCH; technieker ook op GET', async () => {
  const o = opzet();
  const h = maakGebruikers({ getStore: () => o.echt, env: { SESSIE_GEHEIM: GEHEIM }, nu: () => NU0 });
  assert.equal((await metGeenSessie(() => h(get({})))).status, 401);
  for (const rol of ['planner', 'technieker']) {
    if (rol === 'technieker') assert.equal((await metRol(rol, () => h(get({})))).status, 403, `${rol} GET`);
    assert.equal((await metRol(rol, () => h(maak({}, {})))).status, 403, `${rol} POST`);
    assert.equal((await metRol(rol, () => h(req('PATCH', { id: 'u-jan', naam: 'X' }, {})))).status, 403, `${rol} PATCH`);
  }
  assert.equal((await metRol('sales', () => h(maak({}, {})))).status, 403);
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
});

test('planner en technieker met een echte sessie: 403 op POST/PATCH (en de technieker ook op GET)', async () => {
  const o = opzet();
  assert.equal((await o.gebruikers(get(als('u-tim', 1)))).status, 403);
  for (const [uid, headers] of [['u-jan', als('u-jan', 1)], ['u-tim', als('u-tim', 1)]]) {
    assert.equal((await o.gebruikers(maak({}, headers))).status, 403, uid);
    assert.equal((await o.gebruikers(req('PATCH', { id: 'u-bea', actief: false }, headers))).status, 403, uid);
  }
  assert.equal((await record(o.echt, 'u-bea')).actief, true);
});

test('schrijven zonder X-Blitz: 403 csrf; DELETE: 405; OPTIONS: 204', async () => {
  const o = opzet();
  const r = await o.gebruikers(new Request('http://localhost/api/gebruikers', {
    method: 'POST', headers: { cookie: BEA().cookie }, body: JSON.stringify({ actie: 'maak' }),
  }));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'csrf');
  assert.equal((await o.gebruikers(req('DELETE', { id: 'u-jan' }))).status, 405);
  assert.equal((await o.gebruikers(new Request('http://localhost/api/gebruikers', { method: 'OPTIONS' }))).status, 204);
});

// ---------------- lijst ----------------
test('GET (beheerder): alle gebruikers als beheerweergave met laatsteLogin uit login-laatst, zonder hashes of codes', async () => {
  const o = opzet({ extra: { 'login-laatst': { 'u-jan': '2026-10-07T08:00:00.000Z' } } });
  const res = await o.gebruikers(get());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const tekst = await res.text();
  assert.deepEqual(verboden(tekst), []);
  const { gebruikers } = JSON.parse(tekst);
  assert.equal(gebruikers.length, lijst().length);
  const jan = gebruikers.find(g => g.id === 'u-jan');
  assert.equal(jan.laatsteLogin, '2026-10-07T08:00:00.000Z');
  assert.equal(jan.actief, true);
  assert.equal(gebruikers.find(g => g.id === 'u-bea').laatsteLogin, null);
  assert.equal(gebruikers.find(g => g.id === 'u-uit').actief, false);
});

test('GET ?rol=sales: beheerder en sales met magAlleSales krijgen enkel (actieve) verkopers, zonder hashes', async () => {
  const o = opzet();
  for (const headers of [BEA(), als('u-sam', 1)]) {
    const res = await o.gebruikers(get(headers, '?rol=sales'));
    assert.equal(res.status, 200);
    const tekst = await res.text();
    assert.deepEqual(verboden(tekst), []);
    const { gebruikers } = JSON.parse(tekst);
    assert.deepEqual(gebruikers.map(g => g.id).sort(), ['u-sal', 'u-sam']);
    assert.ok(gebruikers.every(g => g.rol === 'sales'));
    assert.ok(!('actief' in gebruikers[0]) && !('laatsteLogin' in gebruikers[0]));
  }
});

test('I3: GET ?rol=sales&geblokkeerd=1: enkel de beheerder krijgt ook de geblokkeerde verkopers (met actief); sales met magAlleSales blijft bij de actieve', async () => {
  const o = opzet();
  const res = await o.gebruikers(get(BEA(), '?rol=sales&geblokkeerd=1'));
  assert.equal(res.status, 200);
  const tekst = await res.text();
  assert.deepEqual(verboden(tekst), []);
  const { gebruikers } = JSON.parse(tekst);
  assert.deepEqual(gebruikers.map(g => [g.id, g.actief]).sort(), [['u-sal', true], ['u-sam', true], ['u-uit', false]]);
  const alsSales = JSON.parse(await (await o.gebruikers(get(als('u-sam', 1), '?rol=sales&geblokkeerd=1'))).text()).gebruikers;
  assert.deepEqual(alsSales.map(g => g.id).sort(), ['u-sal', 'u-sam']);
  assert.ok(alsSales.every(g => !('actief' in g)));
  // M3: een sales manager krijgt geen e-mailadressen of vinkjes; de beheerder wel het volledige record
  const tekstSales = JSON.stringify(alsSales);
  for (const v of ['@blitz.test', 'email', 'magAlleSales']) assert.ok(!tekstSales.includes(v), v);
  assert.deepEqual(alsSales.find(g => g.id === 'u-sal'), { id: 'u-sal', naam: 'Sal', rol: 'sales', salesNaam: 'Sal V' });
  const alsBeheerder = JSON.parse(await (await o.gebruikers(get(BEA(), '?rol=sales'))).text()).gebruikers;
  assert.equal(alsBeheerder.find(g => g.id === 'u-sal').email, 'sal@blitz.test');
});

test('GET: sales zonder magAlleSales (ook zonder ?rol) en andere rol-waarden krijgen 403', async () => {
  const o = opzet();
  assert.equal((await o.gebruikers(get(als('u-sal', 1), '?rol=sales'))).status, 403);
  assert.equal((await o.gebruikers(get(als('u-sal', 1)))).status, 403);
  assert.equal((await o.gebruikers(get(als('u-sam', 1), '?rol=planner'))).status, 403);
  assert.equal((await o.gebruikers(get(BEA(), '?rol=planner'))).status, 403);
  assert.equal((await o.gebruikers(get(BEA(), '?rol=sales&x=1'))).status, 200);
});

// ---------------- maken ----------------
test('maak: technieker zonder zohoNaam -> 400; met -> 201 zonder hash, startWachtwoord van 12 tekens, moetWachtwoordWijzigen', async () => {
  const o = opzet();
  const zonder = await o.gebruikers(maak({ rol: 'technieker' }));
  assert.equal(zonder.status, 400);
  assert.ok((await zonder.json()).error);
  const res = await o.gebruikers(maak({ rol: 'technieker', zohoNaam: 'Piet Z', email: 'Piet@Blitz.test' }));
  assert.equal(res.status, 201);
  const tekst = await res.text();
  const body = JSON.parse(tekst);
  assert.equal(body.startWachtwoord.length, 12);
  assert.equal(body.gebruiker.email, 'piet@blitz.test');
  assert.equal(body.gebruiker.zohoNaam, 'Piet Z');
  assert.equal(body.gebruiker.moetWachtwoordWijzigen, true);
  assert.equal(body.gebruiker.actief, true);
  assert.equal(body.herstelcodes, undefined);
  assert.deepEqual(verboden(tekst), []);
  assert.equal(tekst.split(body.startWachtwoord).length, 2); // het startwachtwoord staat precies één keer in het antwoord
  const bewaard = await record(o.echt, body.gebruiker.id);
  assert.equal(bewaard.moetWachtwoordWijzigen, true);
  assert.equal(bewaard.sessieVersie, 1);
  assert.ok(bewaard.wachtwoordHash.startsWith('scrypt$'));
  assert.ok(!JSON.stringify(bewaard).includes(body.startWachtwoord));
});

test('maak: eigen startWachtwoord wordt gebruikt (beleid: minstens 10 tekens); de nieuwe gebruiker kan ermee inloggen en moet wijzigen', async () => {
  const o = opzet();
  const kort = await o.gebruikers(maak({ startWachtwoord: 'kort' }));
  assert.equal(kort.status, 400);
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
  const res = await o.gebruikers(maak({ startWachtwoord: 'EigenStart-1234' }));
  assert.equal(res.status, 201);
  assert.equal((await res.json()).startWachtwoord, 'EigenStart-1234');
  const l = await o.login(loginReq('nieuw@blitz.test', 'EigenStart-1234'));
  assert.equal(l.status, 200);
  assert.equal((await l.json()).moetWachtwoordWijzigen, true);
});

test('maak: dubbel adres (andere hoofdletters) -> 409 en niets extra bewaard', async () => {
  const o = opzet();
  const res = await o.gebruikers(maak({ email: 'JAN@Blitz.TEST' }));
  assert.equal(res.status, 409);
  assert.ok((await res.json()).error);
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
});

test('maak: ongeldige invoer (rol, e-mail, ontbrekende velden, naam > 100 tekens, geen JSON, onbekende actie) -> 400', async () => {
  const o = opzet();
  for (const extra of [{ rol: 'god' }, { email: 'geenmail' }, { naam: '' }, { naam: 'x'.repeat(101) }, { rol: 'sales' }]) {
    assert.equal((await o.gebruikers(maak(extra))).status, 400, JSON.stringify(extra));
  }
  const kapot = new Request('http://localhost/api/gebruikers', { method: 'POST', headers: { ...BEA(), 'x-blitz': '1' }, body: '{kapot' });
  assert.equal((await o.gebruikers(kapot)).status, 400);
  assert.equal((await o.gebruikers(req('POST', { actie: 'wis-alles' }))).status, 400);
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
});

test('maak: een naam met HTML wordt bewaard zoals gegeven (de client escaped)', async () => {
  const o = opzet();
  const naam = '<img src=x onerror=alert(1)>';
  const res = await o.gebruikers(maak({ naam }));
  assert.equal(res.status, 201);
  assert.equal((await res.json()).gebruiker.naam, naam);
});

test('maak: sales met salesNaam; magAlleSales enkel als echt true', async () => {
  const o = opzet();
  const res = await o.gebruikers(maak({ rol: 'sales', salesNaam: 'Nieuw V', magAlleSales: 'ja' }));
  assert.equal(res.status, 201);
  const { gebruiker } = await res.json();
  assert.equal(gebruiker.salesNaam, 'Nieuw V');
  assert.equal(gebruiker.magAlleSales, false);
});

test('maak: beheerder krijgt 10 herstelcodes (XXXX-XXXX) enkel nu; in de blob enkel hashes; een code werkt bij auth-herstel', async () => {
  const o = opzet();
  const res = await o.gebruikers(maak({ rol: 'beheerder', email: 'tweede@blitz.test' }));
  assert.equal(res.status, 201);
  const body = JSON.parse(await res.text());
  assert.equal(body.herstelcodes.length, 10);
  assert.equal(new Set(body.herstelcodes).size, 10);
  for (const c of body.herstelcodes) assert.match(c, CODE_RE);
  assert.equal('herstelcodes' in body.gebruiker, false);
  const bewaard = await record(o.echt, body.gebruiker.id);
  assert.equal(bewaard.herstelcodes.length, 10);
  const blobTekst = JSON.stringify(bewaard);
  for (const c of body.herstelcodes) assert.ok(!blobTekst.includes(c));
  assert.ok(bewaard.herstelcodes.every(h => h.startsWith('scrypt$')));
  assert.equal((await o.herstel(herstelReq('tweede@blitz.test', body.herstelcodes[3]))).status, 200);
  // een planner krijgt er geen
  const p = await (await o.gebruikers(maak({ rol: 'planner', email: 'p2@blitz.test' }))).json();
  assert.equal(p.herstelcodes, undefined);
  assert.equal((await record(o.echt, p.gebruiker.id)).herstelcodes, undefined);
  // en een lijst toont ze nooit
  assert.deepEqual(verboden(await (await o.gebruikers(get())).text()), []);
});

// ---------------- wijzigen / blokkeren ----------------
test('PATCH: blokkeren -> de oude token geeft 401, de gebruiker kan niet meer inloggen, log gebruiker-geblokkeerd', async () => {
  const o = opzet();
  const oud = als('u-jan', 1);
  assert.equal((await o.auth.vereisGebruiker(get(oud), { rollen: ['planner'] })).ok, true);
  const res = await o.gebruikers(req('PATCH', { id: 'u-jan', actief: false }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).gebruiker.actief, false);
  const daarna = await o.auth.vereisGebruiker(get(oud), { rollen: ['planner'] });
  assert.equal(daarna.ok, false);
  assert.equal(daarna.status, 401);
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 401);
  assert.equal((await record(o.echt, 'u-jan')).sessieVersie, 2);
  const log = (await activiteit(o.echt)).filter(a => a.actie === 'gebruiker-geblokkeerd');
  assert.equal(log.length, 1);
  assert.equal(log[0].onderwerp, 'u-jan');
  assert.equal(log[0].naam, 'Bea');
});

test('PATCH: rolwijziging verhoogt sessieVersie; naamwijziging en heractivatie niet; elke wijziging logt gebruiker-gewijzigd', async () => {
  const o = opzet();
  const naam = await o.gebruikers(req('PATCH', { id: 'u-jan', naam: '  Jan Peeters ' }));
  assert.equal((await naam.json()).gebruiker.naam, 'Jan Peeters');
  assert.equal((await record(o.echt, 'u-jan')).sessieVersie, 1);
  const rol = await o.gebruikers(req('PATCH', { id: 'u-jan', rol: 'technieker', zohoNaam: 'Jan Z' }));
  assert.equal(rol.status, 200);
  const jan = await record(o.echt, 'u-jan');
  assert.equal(jan.sessieVersie, 2);
  assert.equal(jan.rol, 'technieker');
  assert.equal(jan.zohoNaam, 'Jan Z');
  const terug = await o.gebruikers(req('PATCH', { id: 'u-uit', actief: true }));
  assert.equal((await terug.json()).gebruiker.actief, true);
  assert.equal((await record(o.echt, 'u-uit')).sessieVersie, 1);
  const acties = (await activiteit(o.echt)).map(a => a.actie);
  assert.deepEqual(acties, ['gebruiker-gewijzigd', 'gebruiker-gewijzigd', 'gebruiker-gewijzigd']);
});

test('PATCH: ongeldige invoer -> 400, onbekend id -> 404, niets bewaard', async () => {
  const o = opzet();
  const voor = JSON.stringify(await opgeslagen(o.echt));
  for (const body of [{ id: 'u-jan', rol: 'technieker' }, { id: 'u-jan', rol: 'god' }, { id: 'u-jan', naam: '' },
    { id: 'u-jan', naam: 'x'.repeat(101) }, { id: 'u-jan', actief: 'nee' }, { naam: 'X' }, { id: 'u-sal', salesNaam: '' }]) {
    assert.equal((await o.gebruikers(req('PATCH', body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await o.gebruikers(req('PATCH', { id: 'u-bestaat-niet', naam: 'X' }))).status, 404);
  assert.equal(JSON.stringify(await opgeslagen(o.echt)), voor);
});

test('PATCH: velden die bij de rol horen worden opgeruimd (technieker -> planner behoudt zohoNaam, technieker -> sales verliest ze)', async () => {
  const o = opzet();
  assert.equal((await o.gebruikers(req('PATCH', { id: 'u-tim', rol: 'planner' }))).status, 200);
  const tim = await record(o.echt, 'u-tim');
  assert.equal(tim.zohoNaam, 'Tim Z'); // elk account behalve sales mag een Zoho-naam hebben: de koppeling blijft bij een rolwijziging
  assert.equal(tim.rol, 'planner');
  assert.equal((await o.gebruikers(req('PATCH', { id: 'u-tim', rol: 'sales', salesNaam: 'Tim V' }))).status, 200);
  assert.equal((await record(o.echt, 'u-tim')).zohoNaam, undefined);
});

test('PATCH: e-mail, wachtwoordHash, sessieVersie en herstelcodes uit de body worden genegeerd', async () => {
  const o = opzet();
  const res = await o.gebruikers(req('PATCH', { id: 'u-jan', naam: 'Jan 2', email: 'hacker@x.be', wachtwoordHash: 'x', sessieVersie: 99, herstelcodes: ['a'] }));
  assert.equal(res.status, 200);
  const jan = await record(o.echt, 'u-jan');
  assert.equal(jan.email, 'jan@blitz.test');
  assert.equal(jan.wachtwoordHash, hash);
  assert.equal(jan.sessieVersie, 1);
  assert.equal(jan.herstelcodes, undefined);
});

test('laatste actieve beheerder: blokkeren en degraderen -> 409; met een tweede actieve beheerder toegelaten', async () => {
  const o = opzet();
  const blok = await o.gebruikers(req('PATCH', { id: 'u-bea', actief: false }));
  assert.equal(blok.status, 409);
  assert.ok((await blok.json()).error);
  assert.equal((await o.gebruikers(req('PATCH', { id: 'u-bea', rol: 'planner' }))).status, 409);
  assert.equal((await o.gebruikers(req('PATCH', { id: 'u-bea', naam: 'Bea 2' }))).status, 200);
  const bea = await record(o.echt, 'u-bea');
  assert.equal(bea.actief, true);
  assert.equal(bea.rol, 'beheerder');
  assert.equal(bea.sessieVersie, 4);
  // tweede beheerder: nu mag Bea gedegradeerd worden
  const tweede = await (await o.gebruikers(maak({ rol: 'beheerder', email: 'tweede@blitz.test' }))).json();
  const blob = await o.echt.get('gebruikers', { type: 'json' });
  blob.gebruikers.find(g => g.id === tweede.gebruiker.id).moetWachtwoordWijzigen = false; // startwachtwoord al gewijzigd
  await o.echt.setJSON('gebruikers', blob);
  assert.equal((await o.gebruikers(req('PATCH', { id: 'u-bea', rol: 'planner' }))).status, 200);
  // en nu is de tweede de laatste: die is beschermd
  const alsTweede = als(tweede.gebruiker.id, 1);
  assert.equal((await o.gebruikers(req('PATCH', { id: tweede.gebruiker.id, actief: false }, alsTweede))).status, 409);
});

test('een geblokkeerde tweede beheerder telt niet mee als vervanger', async () => {
  const o = opzet({ gebruikers: [...lijst(), { id: 'u-b2', email: 'b2@blitz.test', naam: 'B2', rol: 'beheerder', actief: false, sessieVersie: 1, wachtwoordHash: hash }] });
  assert.equal((await o.gebruikers(req('PATCH', { id: 'u-bea', actief: false }))).status, 409);
});

test('promotie tot beheerder geeft 10 herstelcodes terug (enkel nu); degradatie verwijdert de bewaarde hashes', async () => {
  const o = opzet();
  const res = await o.gebruikers(req('PATCH', { id: 'u-jan', rol: 'beheerder' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.herstelcodes.length, 10);
  for (const c of body.herstelcodes) assert.match(c, CODE_RE);
  const jan = await record(o.echt, 'u-jan');
  assert.equal(jan.herstelcodes.length, 10);
  assert.equal(jan.sessieVersie, 2);
  assert.deepEqual(verboden(JSON.stringify(body.gebruiker)), []);
  const terug = await o.gebruikers(req('PATCH', { id: 'u-jan', rol: 'planner' }));
  assert.equal((await terug.json()).herstelcodes, undefined);
  assert.equal((await record(o.echt, 'u-jan')).herstelcodes, undefined);
  // een gewone PATCH op een beheerder geeft geen nieuwe codes
  const gewoon = await (await o.gebruikers(req('PATCH', { id: 'u-bea', naam: 'Bea 3' }))).json();
  assert.equal(gewoon.herstelcodes, undefined);
});

test('gelijktijdig PATCH (blokkeren) en auth-login van dezelfde gebruiker: eindigt met actief:false (login schrijft enkel login-laatst)', async () => {
  const o = opzet();
  const [patch, login] = await Promise.all([
    o.gebruikers(req('PATCH', { id: 'u-jan', actief: false })),
    o.login(loginReq('jan@blitz.test', WW)),
  ]);
  assert.equal(patch.status, 200);
  assert.ok([200, 401].includes(login.status));
  assert.equal((await record(o.echt, 'u-jan')).actief, false);
});

test('opslag: een schrijfactie die niet blijft staan (terugleescontrole mislukt) geeft 503 { code: opslag-storing } en geen log', async () => {
  const o = opzet();
  // de schrijfactie op `gebruikers` gaat verloren (iemand anders overschrijft): de terugleescontrole faalt telkens
  const stuk = { ...o.echt, setJSON: async (k, v) => (k === 'gebruikers' ? undefined : o.echt.setJSON(k, v)) };
  const env = { SESSIE_GEHEIM: GEHEIM };
  const auth = maakAuth({ getStore: () => o.echt, env, nu: () => NU0 });
  const h = maakGebruikers({ getStore: () => stuk, env, nu: () => NU0, auth });
  for (const verzoek of [
    req('PATCH', { id: 'u-jan', naam: 'Nieuw' }),
    maak({}),
    req('POST', { actie: 'reset-wachtwoord', id: 'u-jan' }),
    req('POST', { actie: 'uitloggen-overal', id: 'u-jan' }),
  ]) {
    const res = await h(verzoek);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, 'opslag-storing');
  }
  assert.equal((await record(o.echt, 'u-jan')).naam, 'Jan');
  assert.deepEqual(await activiteit(o.echt), []);
});

test('maak: mislukt de eerste terugleescontrole en draait de callback opnieuw met onze gebruiker al in de lijst, dan blijft het 201 met eenmalig wachtwoord en codes (geen 409)', async () => {
  const o = opzet();
  let verouderd = false;
  let eenmaal = true;
  // de eerste terugleesactie na het schrijven ziet nog de oude blob (iemand anders overschreef kort)
  const stuk = {
    ...o.echt,
    setJSON: async (k, v) => {
      const oud = k === 'gebruikers' && eenmaal ? await o.echt.get(k, { type: 'json' }) : null;
      await o.echt.setJSON(k, v);
      if (oud) { verouderd = oud; eenmaal = false; }
    },
    get: async (k, opt) => {
      if (k === 'gebruikers' && verouderd) { const w = verouderd; verouderd = false; return w; }
      return o.echt.get(k, opt);
    },
  };
  const env = { SESSIE_GEHEIM: GEHEIM };
  const auth = maakAuth({ getStore: () => o.echt, env, nu: () => NU0 });
  const h = maakGebruikers({ getStore: () => stuk, env, nu: () => NU0, auth });
  const res = await h(maak({ rol: 'beheerder', email: 'retry@blitz.test' }));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.startWachtwoord.length, 12);
  assert.equal(body.herstelcodes.length, 10);
  const alle = (await opgeslagen(o.echt)).filter(g => g.email === 'retry@blitz.test');
  assert.equal(alle.length, 1);
  assert.equal(alle[0].id, body.gebruiker.id);
  assert.equal((await o.login(loginReq('retry@blitz.test', body.startWachtwoord))).status, 200);
});

test('gelijktijdig twee PATCH-verzoeken die twee beheerders tegen elkaar blokkeren/degraderen: één 200, één 409, één actieve beheerder blijft', async () => {
  const o = opzet({ gebruikers: [
    ...lijst(),
    { id: 'u-b2', email: 'b2@blitz.test', naam: 'B2', rol: 'beheerder', actief: true, sessieVersie: 1, wachtwoordHash: hash },
  ] });
  const [a, b] = await Promise.all([
    o.gebruikers(req('PATCH', { id: 'u-b2', actief: false }, BEA())),
    o.gebruikers(req('PATCH', { id: 'u-bea', rol: 'planner' }, als('u-b2', 1))),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const actieveBeheerders = (await opgeslagen(o.echt)).filter(g => g.rol === 'beheerder' && g.actief === true);
  assert.equal(actieveBeheerders.length, 1);
});

test('PATCH zonder echte wijziging (verkoper zonder magAlleSales-veld, zelfde naam) logt niets en schrijft niets', async () => {
  const gebruikers = lijst().map(g => (g.id === 'u-sal' ? (({ magAlleSales, ...rest }) => rest)(g) : g));
  const o = opzet({ gebruikers });
  const voor = JSON.stringify(await opgeslagen(o.echt));
  const res = await o.gebruikers(req('PATCH', { id: 'u-sal', naam: 'Sal', magAlleSales: false }));
  assert.equal(res.status, 200);
  assert.deepEqual(await activiteit(o.echt), []);
  assert.equal(JSON.stringify(await opgeslagen(o.echt)), voor);
});

// ---------------- reset / uitloggen ----------------
test('reset-wachtwoord: enkel het nieuwe startwachtwoord werkt, verplichte wijziging, sessieVersie + 1, één logregel', async () => {
  const o = opzet();
  const res = await o.gebruikers(req('POST', { actie: 'reset-wachtwoord', id: 'u-jan' }));
  assert.equal(res.status, 200);
  const tekst = await res.text();
  const { startWachtwoord } = JSON.parse(tekst);
  assert.equal(startWachtwoord.length, 12);
  assert.deepEqual(verboden(tekst), []);
  const jan = await record(o.echt, 'u-jan');
  assert.equal(jan.moetWachtwoordWijzigen, true);
  assert.equal(jan.sessieVersie, 2);
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 401);
  const l = await o.login(loginReq('jan@blitz.test', startWachtwoord));
  assert.equal(l.status, 200);
  assert.equal((await l.json()).moetWachtwoordWijzigen, true);
  assert.equal((await o.auth.vereisGebruiker(get(als('u-jan', 1)), { rollen: ['planner'] })).status, 401); // oude token
  const log = (await activiteit(o.echt)).filter(a => a.actie === 'wachtwoord-gereset');
  assert.equal(log.length, 1);
  assert.equal(log[0].onderwerp, 'u-jan');
  assert.equal(log[0].naam, 'Bea');
  assert.ok(!JSON.stringify(await activiteit(o.echt)).includes(startWachtwoord));
});

test('reset-wachtwoord: eigen startWachtwoord (beleid), onbekend id -> 404, geen id -> 400, een vergrendelde gebruiker kan weer proberen', async () => {
  const o = opzet();
  assert.equal((await o.gebruikers(req('POST', { actie: 'reset-wachtwoord', id: 'u-jan', startWachtwoord: 'kort' }))).status, 400);
  assert.equal((await o.gebruikers(req('POST', { actie: 'reset-wachtwoord', id: 'nergens' }))).status, 404);
  assert.equal((await o.gebruikers(req('POST', { actie: 'reset-wachtwoord' }))).status, 400);
  for (let i = 0; i < 5; i++) await o.login(loginReq('jan@blitz.test', 'fout' + i));
  assert.equal((await o.login(loginReq('jan@blitz.test', WW))).status, 429);
  const res = await o.gebruikers(req('POST', { actie: 'reset-wachtwoord', id: 'u-jan', startWachtwoord: 'NieuwStart-1234' }));
  assert.equal(res.status, 200);
  assert.equal((await o.login(loginReq('jan@blitz.test', 'NieuwStart-1234'))).status, 200);
});

test('uitloggen-overal: sessieVersie + 1, oude token 401, precies één gebruiker-gewijzigd met details overal-uitgelogd', async () => {
  const o = opzet();
  const res = await o.gebruikers(req('POST', { actie: 'uitloggen-overal', id: 'u-tim' }));
  assert.equal(res.status, 200);
  assert.equal((await record(o.echt, 'u-tim')).sessieVersie, 2);
  assert.equal((await o.auth.vereisGebruiker(get(als('u-tim', 1)), { rollen: ['technieker'] })).status, 401);
  const log = await activiteit(o.echt);
  assert.equal(log.length, 1);
  assert.equal(log[0].actie, 'gebruiker-gewijzigd');
  assert.equal(log[0].onderwerp, 'u-tim');
  assert.equal(log[0].details, 'overal-uitgelogd');
  assert.equal((await o.gebruikers(req('POST', { actie: 'uitloggen-overal', id: 'nergens' }))).status, 404);
});

test('maak logt precies één gebruiker-aangemaakt (onderwerp = id van de nieuwe gebruiker), zonder hashes', async () => {
  const o = opzet();
  const { gebruiker } = await (await o.gebruikers(maak({}))).json();
  const log = await activiteit(o.echt);
  assert.equal(log.length, 1);
  assert.equal(log[0].actie, 'gebruiker-aangemaakt');
  assert.equal(log[0].onderwerp, gebruiker.id);
  assert.equal(log[0].naam, 'Bea');
  assert.ok(!JSON.stringify(log).includes('scrypt$'));
});

test('testverzoek (X-Blitz-Test): gebruikers staan toch in de echte store, niet in de teststore', async () => {
  const o = opzet();
  const res = await o.gebruikers(maak({ email: 'x@blitz.test', naam: 'X' }, { ...BEA(), 'x-blitz-test': '1' }));
  assert.equal(res.status, 201);
  assert.equal((await opgeslagen(o.echt)).length, lijst().length + 1);
  assert.equal(await o.test.get('gebruikers', { type: 'json' }), null);
});

// ---------------- nieuwe herstelcodes ----------------
test('nieuwe-herstelcodes: eigen wachtwoord vereist; juist -> 10 nieuwe codes, oude ongeldig; fout -> 400 en oude blijven', async () => {
  const o = opzet();
  const oud = [...(await record(o.echt, 'u-bea')).herstelcodes];
  const fout = await o.gebruikers(req('POST', { actie: 'nieuwe-herstelcodes', wachtwoord: 'FoutWachtwoord1' }));
  assert.equal(fout.status, 400);
  assert.deepEqual((await record(o.echt, 'u-bea')).herstelcodes, oud);
  assert.equal((await o.gebruikers(req('POST', { actie: 'nieuwe-herstelcodes' }))).status, 400);
  const res = await o.gebruikers(req('POST', { actie: 'nieuwe-herstelcodes', wachtwoord: WW }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.herstelcodes.length, 10);
  for (const c of body.herstelcodes) assert.match(c, CODE_RE);
  const nieuw = (await record(o.echt, 'u-bea')).herstelcodes;
  assert.equal(nieuw.length, 10);
  assert.ok(nieuw.every(h => !oud.includes(h) && h.startsWith('scrypt$')));
  assert.ok(!JSON.stringify(nieuw).includes(body.herstelcodes[0]));
  // een oude code werkt niet meer, een nieuwe wel
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0]))).status, 401);
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', body.herstelcodes[0]))).status, 200);
});

test('nieuwe-herstelcodes: alleen voor een beheerdersaccount met eigen id; een foute poging telt mee voor de vergrendeling', async () => {
  const o = opzet();
  for (let i = 0; i < 5; i++) {
    assert.equal((await o.gebruikers(req('POST', { actie: 'nieuwe-herstelcodes', wachtwoord: 'Fout' + i + 'Wachtwoord' }))).status, 400);
  }
  assert.equal((await o.gebruikers(req('POST', { actie: 'nieuwe-herstelcodes', wachtwoord: WW }))).status, 429);
});

// ---------------- Zoho-naam op elk account ----------------
test('maak: een planner en een beheerder mogen een zohoNaam hebben; sales krijgt er nooit een', async () => {
  const o = opzet();
  const planner = await o.gebruikers(maak({ rol: 'planner', zohoNaam: ' Pia Z ', email: 'pia@blitz.test' }));
  assert.equal(planner.status, 201);
  assert.equal((await planner.json()).gebruiker.zohoNaam, 'Pia Z');
  const beheerder = await o.gebruikers(maak({ rol: 'beheerder', zohoNaam: 'Bert Z', email: 'bert@blitz.test' }));
  assert.equal(beheerder.status, 201);
  assert.equal((await beheerder.json()).gebruiker.zohoNaam, 'Bert Z');
  const sales = await o.gebruikers(maak({ rol: 'sales', salesNaam: 'S V', zohoNaam: 'Sven Z', email: 'sven@blitz.test' }));
  assert.equal(sales.status, 201);
  assert.equal((await sales.json()).gebruiker.zohoNaam, undefined);
  const zonder = await o.gebruikers(maak({ rol: 'planner', email: 'zonder@blitz.test' }));
  assert.equal(zonder.status, 201);
});

test('maak: een zohoNaam die al bij een ander account hoort wordt geweigerd (409), ook met andere hoofdletters en spaties', async () => {
  const o = opzet();
  const voor = (await opgeslagen(o.echt)).length;
  const res = await o.gebruikers(maak({ rol: 'technieker', zohoNaam: ' tim   z ', email: 'dubbel@blitz.test' }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Tim/);
  const planner = await o.gebruikers(maak({ rol: 'planner', zohoNaam: 'TIM Z', email: 'dubbel2@blitz.test' }));
  assert.equal(planner.status, 409);
  assert.equal((await opgeslagen(o.echt)).length, voor);
});

test('PATCH: een zohoNaam toevoegen aan een planner, wijzigen of wissen; een naam van een ander account geeft 409', async () => {
  const o = opzet();
  const toevoegen = await o.gebruikers(req('PATCH', { id: 'u-jan', zohoNaam: 'Jan Z' }));
  assert.equal(toevoegen.status, 200);
  assert.equal((await toevoegen.json()).gebruiker.zohoNaam, 'Jan Z');
  assert.equal((await record(o.echt, 'u-jan')).sessieVersie, 1); // geen uitlog voor een naamkoppeling
  const bezet = await o.gebruikers(req('PATCH', { id: 'u-jan', zohoNaam: 'tim z' }));
  assert.equal(bezet.status, 409);
  assert.equal((await record(o.echt, 'u-jan')).zohoNaam, 'Jan Z');
  const bezet2 = await o.gebruikers(req('PATCH', { id: 'u-bea', zohoNaam: 'Jan  Z' }));
  assert.equal(bezet2.status, 409);
  const eigen = await o.gebruikers(req('PATCH', { id: 'u-jan', zohoNaam: 'jan z' })); // eigen naam, andere schrijfwijze: toegestaan
  assert.equal(eigen.status, 200);
  const wissen = await o.gebruikers(req('PATCH', { id: 'u-jan', zohoNaam: '' }));
  assert.equal(wissen.status, 200);
  assert.equal((await record(o.echt, 'u-jan')).zohoNaam, undefined);
  const acties = (await activiteit(o.echt)).map(a => `${a.actie}:${a.details}`);
  assert.ok(acties.every(a => a.startsWith('gebruiker-gewijzigd:')), acties.join('|'));
});

test('PATCH: een technieker wijzigt van rol met behoud van zijn zohoNaam (planner mag er een hebben); naar sales verdwijnt ze', async () => {
  const o = opzet();
  const planner = await o.gebruikers(req('PATCH', { id: 'u-tim', rol: 'planner', zohoNaam: 'Tim Z' }));
  assert.equal(planner.status, 200);
  assert.equal((await record(o.echt, 'u-tim')).zohoNaam, 'Tim Z');
  const sales = await o.gebruikers(req('PATCH', { id: 'u-tim', rol: 'sales', salesNaam: 'Tim V' }));
  assert.equal(sales.status, 200);
  assert.equal((await record(o.echt, 'u-tim')).zohoNaam, undefined);
});

test('PATCH: een bestaande dubbele zohoNaam (van vroeger) blokkeert andere wijzigingen niet', async () => {
  const gebruikers = lijst();
  gebruikers.push({ id: 'u-tim2', email: 'tim2@blitz.test', naam: 'Tim 2', rol: 'technieker', zohoNaam: 'Tim Z', actief: true, sessieVersie: 1, wachtwoordHash: hash });
  const o = opzet({ gebruikers });
  const res = await o.gebruikers(req('PATCH', { id: 'u-tim2', naam: 'Tim Twee' }));
  assert.equal(res.status, 200);
});

// ---------------- magZelfPlannen ----------------
test('maak: technieker met magZelfPlannen true wordt zo bewaard; zonder het vinkje is het false; een planner krijgt het veld nooit', async () => {
  const o = opzet();
  const met = await o.gebruikers(maak({ rol: 'technieker', zohoNaam: 'Kim Z', email: 'kim@blitz.test', magZelfPlannen: true }));
  assert.equal(met.status, 201);
  const kim = await met.json();
  assert.equal(kim.gebruiker.magZelfPlannen, true);
  assert.equal((await record(o.echt, kim.gebruiker.id)).magZelfPlannen, true);
  const zonder = await o.gebruikers(maak({ rol: 'technieker', zohoNaam: 'Lou Z', email: 'lou@blitz.test' }));
  assert.equal((await zonder.json()).gebruiker.magZelfPlannen, false);
  const planner = await o.gebruikers(maak({ rol: 'planner', email: 'p2@blitz.test', magZelfPlannen: true }));
  assert.equal((await planner.json()).gebruiker.magZelfPlannen, undefined);
});

test('PATCH: magZelfPlannen aan/uit door de beheerder, gelogd als gebruiker-gewijzigd, zonder uitlog; een niet-boolean geeft 400', async () => {
  const o = opzet();
  const aan = await o.gebruikers(req('PATCH', { id: 'u-tim', magZelfPlannen: true }));
  assert.equal(aan.status, 200);
  assert.equal((await aan.json()).gebruiker.magZelfPlannen, true);
  assert.equal((await record(o.echt, 'u-tim')).sessieVersie, 1);
  const uit = await o.gebruikers(req('PATCH', { id: 'u-tim', magZelfPlannen: false }));
  assert.equal((await uit.json()).gebruiker.magZelfPlannen, false);
  const log = (await activiteit(o.echt)).filter(a => a.actie === 'gebruiker-gewijzigd');
  assert.deepEqual(log.map(a => a.details), ['magZelfPlannen', 'magZelfPlannen']);
  assert.deepEqual(log.map(a => a.onderwerp), ['u-tim', 'u-tim']);
  assert.equal((await o.gebruikers(req('PATCH', { id: 'u-tim', magZelfPlannen: 'ja' }))).status, 400);
  // een planner heeft geen techniekersvinkje: het gewoon niet bewaren
  const planner = await o.gebruikers(req('PATCH', { id: 'u-jan', magZelfPlannen: true }));
  assert.equal(planner.status, 200);
  assert.equal((await record(o.echt, 'u-jan')).magZelfPlannen, undefined);
});

test('magZelfPlannen wijzigen kan enkel de beheerder: planner, technieker en sales krijgen 403 en er verandert niets', async () => {
  const o = opzet();
  for (const [uid, sv] of [['u-jan', 1], ['u-tim', 1], ['u-sal', 1]]) {
    const res = await o.gebruikers(req('PATCH', { id: 'u-tim', magZelfPlannen: true }, als(uid, sv)));
    assert.equal(res.status, 403, uid);
  }
  assert.equal((await record(o.echt, 'u-tim')).magZelfPlannen, undefined);
});

test('een technieker met magZelfPlannen: de rol wijzigen naar planner of sales laat het vinkje verdwijnen', async () => {
  const gebruikers = lijst();
  gebruikers[2] = { ...gebruikers[2], magZelfPlannen: true };
  const o = opzet({ gebruikers });
  assert.equal((await o.gebruikers(req('PATCH', { id: 'u-tim', rol: 'planner' }))).status, 200);
  assert.equal((await record(o.echt, 'u-tim')).magZelfPlannen, undefined);
});

// ---------------- planner en sales manager: beperkte lijst voor Beheer, Instellingen ----------------
const meer = () => [...lijst(),
  { id: 'u-weg', email: 'weg@blitz.test', naam: 'Weg', rol: 'technieker', zohoNaam: 'Weg Z', actief: false, sessieVersie: 1, wachtwoordHash: hash, moetWachtwoordWijzigen: true },
  { id: 'u-pia', email: 'pia@blitz.test', naam: 'Pia', rol: 'planner', actief: true, sessieVersie: 1, wachtwoordHash: hash }];

test('GET door een planner: enkel techniekers en de planner zelf, enkel id/naam/rol/zohoNaam/actief; geen e-mail, beheerder, sales of inloggegevens', async () => {
  const o = opzet({ gebruikers: meer() });
  const r = await o.gebruikers(get(als('u-jan', 1)));
  assert.equal(r.status, 200);
  const tekst = await r.text();
  assert.deepEqual(JSON.parse(tekst).gebruikers, [
    { id: 'u-tim', naam: 'Tim', rol: 'technieker', actief: true, zohoNaam: 'Tim Z' },
    { id: 'u-weg', naam: 'Weg', rol: 'technieker', actief: false, zohoNaam: 'Weg Z' },
    { id: 'u-jan', naam: 'Jan', rol: 'planner', actief: true },
  ]);
  for (const v of ['@blitz.test', 'email', 'Bea', 'Sal', 'Sam', 'Pia', 'laatsteLogin', 'aangemaakt', 'moetWachtwoordWijzigen', ...verboden(tekst)]) assert.ok(!tekst.includes(v), v);
});

test('GET door een sales manager: enkel verkopers (id, naam, rol, actief), ook geblokkeerde; geen e-mail, techniekers, planners of beheerders', async () => {
  const o = opzet({ gebruikers: meer() });
  const r = await o.gebruikers(get(als('u-sam', 1)));
  assert.equal(r.status, 200);
  const tekst = await r.text();
  assert.deepEqual(JSON.parse(tekst).gebruikers, [
    { id: 'u-sal', naam: 'Sal', rol: 'sales', actief: true },
    { id: 'u-sam', naam: 'Sam', rol: 'sales', actief: true },
    { id: 'u-uit', naam: 'Uit', rol: 'sales', actief: false },
  ]);
  for (const v of ['@blitz.test', 'email', 'salesNaam', 'magAlleSales', 'Bea', 'Jan', 'Tim', 'Pia', ...verboden(tekst)]) assert.ok(!tekst.includes(v), v);
});

test('GET door een planner met ?rol=...: 403 (de sales-lijst blijft voor beheerder en sales manager)', async () => {
  const o = opzet();
  for (const zoek of ['?rol=sales', '?rol=sales&geblokkeerd=1', '?rol=technieker', '?rol=planner', '?rol=sales&rol=technieker']) {
    assert.equal((await o.gebruikers(get(als('u-jan', 1), zoek))).status, 403, zoek);
  }
});

test('planner en sales manager mogen niets schrijven op /api/gebruikers: POST (alle acties) en PATCH geven 403 en wijzigen niets', async () => {
  const o = opzet();
  for (const headers of [als('u-jan', 1), als('u-sam', 1)]) {
    for (const body of [{ actie: 'maak', email: 'x@blitz.test', naam: 'X', rol: 'planner' }, { actie: 'reset-wachtwoord', id: 'u-tim' }, { actie: 'uitloggen-overal', id: 'u-tim' }, { actie: 'verwijder', id: 'u-uit' }]) {
      assert.equal((await o.gebruikers(req('POST', body, headers))).status, 403, body.actie);
    }
    assert.equal((await o.gebruikers(req('PATCH', { id: 'u-tim', rol: 'beheerder' }, headers))).status, 403);
  }
  assert.equal((await opgeslagen(o.echt)).length, lijst().length);
});
