// tests/server-auth-herstel.test.mjs — auth-setup (eerste beheerder), auth-herstel (code of noodsleutel), herstel.js
import { test, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { maakNepStore } from './nep-blobs.mjs';
import { hashWachtwoord, verifieerWachtwoord, SCHIJN_HASH } from '../netlify/lib/wachtwoord.js';
import { controleerToken } from '../netlify/lib/sessie-token.js';
import { maakAuth } from '../netlify/lib/auth.js';
import { maakHandler as maakSetup } from '../netlify/functions/auth-setup.js';
import { maakHandler as maakHerstel } from '../netlify/functions/auth-herstel.js';
import { maakHandler as maakLogin } from '../netlify/functions/auth-login.js';
import { maakHandler as maakIk } from '../netlify/functions/auth-ik.js';
import { maakHerstelcodes, gebruikHerstelcode, controleerNoodsleutel } from '../netlify/lib/herstel.js';
import { RECHTEN } from '../netlify/lib/rechten.js';

const GEHEIM = 'testgeheim-testgeheim';
const SETUP = 'setup-code-123';
const NOOD = 'noodsleutel-' + 'x'.repeat(24); // 36 tekens
const WW = 'JuistWachtwoord1';
const NIEUW = 'NieuwWachtwoord99';
const NU0 = Date.parse('2026-10-08T10:00:00.000Z');
const MIN = 60 * 1000;
const CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;

let wwHash;
let codeSet; // { codes, hashes } voor beheerder Bea
before(async () => {
  wwHash = await hashWachtwoord(WW);
  codeSet = await maakHerstelcodes();
});

const gebruikersLijst = () => [
  { id: 'u-bea', email: 'bea@blitz.test', naam: 'Bea', rol: 'beheerder', actief: true, sessieVersie: 4, wachtwoordHash: wwHash, herstelcodes: [...codeSet.hashes] },
  { id: 'u-jan', email: 'jan@blitz.test', naam: 'Jan', rol: 'planner', actief: true, sessieVersie: 1, wachtwoordHash: wwHash, herstelcodes: [...codeSet.hashes] },
  { id: 'u-blok', email: 'blok@blitz.test', naam: 'Blok', rol: 'beheerder', actief: false, sessieVersie: 1, wachtwoordHash: wwHash, herstelcodes: [...codeSet.hashes] },
];

function opzet({ gebruikers = gebruikersLijst(), env = {} } = {}) {
  const begin = gebruikers ? { gebruikers: { versie: 1, gebruikers } } : {};
  const echt = maakNepStore(begin);
  const test = maakNepStore({});
  const klok = { ms: NU0 };
  const getStore = opties => (opties.name === 'blitz-data' ? echt : test);
  const omgeving = { SESSIE_GEHEIM: GEHEIM, BEHEER_SETUP_CODE: SETUP, ...env };
  const nu = () => klok.ms;
  const auth = maakAuth({ getStore, env: omgeving, nu });
  const deps = { getStore, env: omgeving, nu };
  return {
    echt, test, klok, omgeving, auth,
    setup: maakSetup(deps),
    herstel: maakHerstel(deps),
    login: maakLogin(deps),
    ik: maakIk({ ...deps, auth }),
  };
}

const post = (pad, body, headers = {}) => new Request(`http://localhost/api/${pad}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-blitz': '1', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const get = (pad, headers = {}) => new Request(`http://localhost/api/${pad}`, { method: 'GET', headers });
const setupReq = (o = {}, headers) => post('auth-setup', {
  setupCode: SETUP, email: 'Eerste@Blitz.test', naam: 'Eerste', wachtwoord: WW, ...o,
}, headers);
const herstelReq = (email, bewijs, nieuwWachtwoord = NIEUW, headers) => post('auth-herstel', { email, bewijs, nieuwWachtwoord }, headers);
const loginReq = (email, wachtwoord) => post('auth-login', { email, wachtwoord });

const cookieWaarde = res => /blitz_sessie=([^;]*)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;
const nuS = () => Math.floor(NU0 / 1000);
const activiteit = async echt => (await echt.get('activiteit/2026-10', { type: 'json' }))?.items ?? [];
const sha = t => createHash('sha256').update(t).digest('hex');

// ---------------- herstel.js ----------------
test('maakHerstelcodes: 10 unieke codes XXXX-XXXX, hashes (scrypt) die de codes verifiëren en de platte code niet bevatten', async () => {
  const { codes, hashes } = codeSet;
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  assert.equal(hashes.length, 10);
  for (const c of codes) assert.match(c, CODE_RE);
  for (let i = 0; i < 10; i++) {
    assert.ok(!hashes[i].includes(codes[i]));
    assert.equal(await verifieerWachtwoord(codes[i], hashes[i]), true);
  }
});

test('gebruikHerstelcode: juiste code (kleine letters, spaties) -> ok, resterend zonder de gebruikte hash', async () => {
  const b = { herstelcodes: codeSet.hashes };
  const r = await gebruikHerstelcode(b, ' ' + codeSet.codes[3].toLowerCase().replace('-', ' ') + ' ');
  assert.equal(r.ok, true);
  assert.equal(r.resterend.length, 9);
  assert.ok(!r.resterend.includes(codeSet.hashes[3]));
  assert.equal(r.gebruikt, codeSet.hashes[3]);
});

test('gebruikHerstelcode: foute code, geen codes, kapotte invoer -> { ok:false } en gooit nooit', async () => {
  assert.equal((await gebruikHerstelcode({ herstelcodes: codeSet.hashes }, 'AAAA-AAAA')).ok, false);
  assert.equal((await gebruikHerstelcode({}, codeSet.codes[0])).ok, false);
  assert.equal((await gebruikHerstelcode({ herstelcodes: [] }, codeSet.codes[0])).ok, false);
  assert.equal((await gebruikHerstelcode(null, codeSet.codes[0])).ok, false);
  assert.equal((await gebruikHerstelcode({ herstelcodes: codeSet.hashes }, undefined)).ok, false);
  assert.equal((await gebruikHerstelcode({ herstelcodes: codeSet.hashes }, { a: 1 })).ok, false);
  assert.equal((await gebruikHerstelcode({ herstelcodes: [SCHIJN_HASH, 'rommel', 5] }, 'AAAA-AAAA')).ok, false);
});

test('controleerNoodsleutel: 31 tekens nooit, 32+ juist ok met hash, fout/ontbrekend niet, al gebruikte hash niet', async () => {
  const store = maakNepStore({});
  const kort = 'k'.repeat(31);
  assert.equal((await controleerNoodsleutel(kort, { BEHEER_HERSTELSLEUTEL: kort }, store)).ok, false);
  assert.equal((await controleerNoodsleutel(NOOD, {}, store)).ok, false);
  assert.equal((await controleerNoodsleutel(NOOD, { BEHEER_HERSTELSLEUTEL: '' }, store)).ok, false);
  assert.equal((await controleerNoodsleutel('fout' + NOOD, { BEHEER_HERSTELSLEUTEL: NOOD }, store)).ok, false);
  assert.equal((await controleerNoodsleutel(undefined, { BEHEER_HERSTELSLEUTEL: NOOD }, store)).ok, false);
  const ok = await controleerNoodsleutel(NOOD, { BEHEER_HERSTELSLEUTEL: NOOD }, store);
  assert.deepEqual(ok, { ok: true, hash: sha(NOOD) });
  await store.setJSON('herstel-noodroute', { hash: sha(NOOD) });
  assert.equal((await controleerNoodsleutel(NOOD, { BEHEER_HERSTELSLEUTEL: NOOD }, store)).ok, false);
  // een nieuwe sleutel (andere hash in de blob) werkt wel weer
  const nieuw = 'andere-sleutel-' + 'y'.repeat(20);
  assert.equal((await controleerNoodsleutel(nieuw, { BEHEER_HERSTELSLEUTEL: nieuw }, store)).ok, true);
});

// ---------------- rechten ----------------
test('rechten: auth-setup en auth-herstel zijn open', () => {
  assert.deepEqual(RECHTEN['auth-setup'], { '*': 'open' });
  assert.deepEqual(RECHTEN['auth-herstel'], { '*': 'open' });
});

// ---------------- auth-setup ----------------
test('setup: juiste code -> 200, 10 codes, enkel hashes bewaard, cookie geldig, activiteit, echte store', async () => {
  const o = opzet({ gebruikers: null });
  const res = await o.setup(setupReq({}, { 'x-blitz-test': '1' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.gebruiker.email, 'eerste@blitz.test');
  assert.equal(body.gebruiker.rol, 'beheerder');
  assert.equal(body.herstelcodes.length, 10);
  for (const c of body.herstelcodes) assert.match(c, CODE_RE);
  const json = JSON.stringify(body);
  for (const verboden of ['Hash', 'sessieVersie']) assert.ok(!json.includes(verboden), verboden);

  const blob = await o.echt.get('gebruikers', { type: 'json' });
  assert.equal(blob.gebruikers.length, 1);
  const rec = blob.gebruikers[0];
  assert.equal(rec.actief, true);
  assert.equal(rec.moetWachtwoordWijzigen, false);
  assert.equal(rec.herstelcodes.length, 10);
  const ruw = JSON.stringify(blob);
  for (const c of body.herstelcodes) assert.ok(!ruw.includes(c), 'platte code in blob');
  assert.ok(!ruw.includes(WW));
  assert.equal(await verifieerWachtwoord(WW, rec.wachtwoordHash), true);
  assert.equal(await verifieerWachtwoord(body.herstelcodes[0], rec.herstelcodes[0]), true);
  assert.equal(o.test._data.size, 0, 'niets in de teststore');

  const claims = controleerToken(cookieWaarde(res), GEHEIM, nuS());
  assert.equal(claims.uid, rec.id);
  assert.equal(claims.sv, rec.sessieVersie);
  const set = res.headers.get('set-cookie');
  assert.match(set, /HttpOnly/);
  assert.match(set, /Secure/);

  const items = await activiteit(o.echt);
  assert.equal(items.filter(i => i.actie === 'gebruiker-aangemaakt').length, 1);
  assert.equal(items.find(i => i.actie === 'gebruiker-aangemaakt').gebruikerId, rec.id);
});

test('setup: de cookie geeft toegang (auth-ik) en daarna toont auth-ik zonder sessie setupNodig:false', async () => {
  const o = opzet({ gebruikers: null });
  const vooraf = await o.ik(get('auth-ik'));
  assert.equal(vooraf.status, 401);
  assert.equal((await vooraf.json()).setupNodig, true);

  const res = await o.setup(setupReq());
  const ik = await o.ik(get('auth-ik', { cookie: `blitz_sessie=${cookieWaarde(res)}` }));
  assert.equal(ik.status, 200);
  assert.equal((await ik.json()).gebruiker.rol, 'beheerder');
  const zonder = await o.ik(get('auth-ik'));
  assert.equal(zonder.status, 401);
  assert.equal((await zonder.json()).setupNodig, false);
});

test('setup: de nieuwe beheerder kan inloggen met het gekozen wachtwoord', async () => {
  const o = opzet({ gebruikers: null });
  await o.setup(setupReq());
  assert.equal((await o.login(loginReq('eerste@blitz.test', WW))).status, 200);
});

test('setup: foute code -> 403, niets aangemaakt', async () => {
  const o = opzet({ gebruikers: null });
  const res = await o.setup(setupReq({ setupCode: 'fout' }));
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(await o.echt.get('gebruikers', { type: 'json' }), null);
});

test('setup: variabele ontbreekt of is leeg -> 403, ook met lege of ontbrekende setupCode', async () => {
  for (const env of [{ BEHEER_SETUP_CODE: undefined }, { BEHEER_SETUP_CODE: '' }]) {
    const o = opzet({ gebruikers: null, env });
    for (const code of ['', undefined, 'iets', SETUP]) {
      const res = await o.setup(setupReq({ setupCode: code }));
      assert.equal(res.status, 403, JSON.stringify({ env, code }));
    }
    assert.equal(await o.echt.get('gebruikers', { type: 'json' }), null);
  }
});

test('setup: tweede aanroep -> 409, ook met de juiste code; bestaande gebruikers blijven ongemoeid', async () => {
  const o = opzet({ gebruikers: null });
  assert.equal((await o.setup(setupReq())).status, 200);
  const na1 = await o.echt.get('gebruikers', { type: 'json' });
  const res = await o.setup(setupReq({ email: 'tweede@blitz.test' }));
  assert.equal(res.status, 409);
  assert.equal(res.headers.get('set-cookie'), null);
  assert.deepEqual(await o.echt.get('gebruikers', { type: 'json' }), na1);
  // ook als er al een gebruiker was (niet via setup aangemaakt)
  const o2 = opzet();
  assert.equal((await o2.setup(setupReq())).status, 409);
});

test('setup: twee gelijktijdige aanroepen -> precies één slaagt, de andere krijgt 409, één gebruiker', async () => {
  const o = opzet({ gebruikers: null });
  const [a, b] = await Promise.all([
    o.setup(setupReq({ email: 'a@blitz.test' })),
    o.setup(setupReq({ email: 'b@blitz.test' })),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const blob = await o.echt.get('gebruikers', { type: 'json' });
  assert.equal(blob.gebruikers.length, 1);
});

test('setup: wachtwoord te kort -> 400; ongeldig e-mailadres/naam -> 400; ongeldige JSON -> 400', async () => {
  const o = opzet({ gebruikers: null });
  assert.equal((await o.setup(setupReq({ wachtwoord: 'kort' }))).status, 400);
  assert.equal((await o.setup(setupReq({ email: 'geen-adres' }))).status, 400);
  assert.equal((await o.setup(setupReq({ naam: '  ' }))).status, 400);
  assert.equal((await o.setup(setupReq({ wachtwoord: 12345678901 }))).status, 400);
  assert.equal((await o.setup(post('auth-setup', 'geen json'))).status, 400);
  assert.equal(await o.echt.get('gebruikers', { type: 'json' }), null);
});

test('setup: zonder X-Blitz 403 csrf; GET 405; OPTIONS 204; zonder SESSIE_GEHEIM 500 zonder iets aan te maken', async () => {
  const o = opzet({ gebruikers: null });
  const zonder = new Request('http://localhost/api/auth-setup', { method: 'POST', body: JSON.stringify({ setupCode: SETUP }) });
  const r = await o.setup(zonder);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'csrf');
  assert.equal((await o.setup(get('auth-setup'))).status, 405);
  assert.equal((await o.setup(new Request('http://localhost/api/auth-setup', { method: 'OPTIONS' }))).status, 204);
  const o2 = opzet({ gebruikers: null, env: { SESSIE_GEHEIM: '' } });
  assert.equal((await o2.setup(setupReq())).status, 500);
  assert.equal(await o2.echt.get('gebruikers', { type: 'json' }), null);
});

test('setup: 5 foute codes vergrendelen het setupscherm (429), ook voor de juiste code; daarna weer mogelijk', async () => {
  const o = opzet({ gebruikers: null });
  for (let i = 0; i < 5; i++) assert.equal((await o.setup(setupReq({ setupCode: 'fout' + i }))).status, 403);
  const vast = await o.setup(setupReq());
  assert.equal(vast.status, 429);
  assert.equal(await o.echt.get('gebruikers', { type: 'json' }), null);
  o.klok.ms = NU0 + 61 * MIN;
  assert.equal((await o.setup(setupReq())).status, 200);
});

test('setup: opslag onbereikbaar -> geen account, 429 (teller niet te bewaren = vergrendeld) of 503', async () => {
  const o = opzet({ gebruikers: null });
  const stuk = { ...o.echt, get: async () => { throw new Error('weg'); } };
  const handler = maakSetup({ getStore: () => stuk, env: o.omgeving, nu: () => NU0 });
  assert.ok([429, 503].includes((await handler(setupReq())).status));
  assert.equal(await o.echt.get('gebruikers', { type: 'json' }), null);
});

// ---------------- auth-herstel met herstelcode ----------------
test('herstel: juiste code -> nieuw wachtwoord werkt, oud niet, oud token 401, cookie met sv+1, moetWachtwoordWijzigen false', async () => {
  const o = opzet();
  const oudToken = (await import('../netlify/lib/sessie-token.js')).ondertekenToken({ uid: 'u-bea', sv: 4, exp: nuS() + 1000 }, GEHEIM);
  assert.equal((await o.ik(get('auth-ik', { cookie: `blitz_sessie=${oudToken}` }))).status, 200);

  const res = await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0]));
  assert.equal(res.status, 200);
  const claims = controleerToken(cookieWaarde(res), GEHEIM, nuS());
  assert.equal(claims.uid, 'u-bea');
  assert.equal(claims.sv, 5);
  const body = await res.json();
  assert.equal(body.gebruiker.id, 'u-bea');
  assert.ok(!JSON.stringify(body).includes('Hash'));

  assert.equal((await o.login(loginReq('bea@blitz.test', NIEUW))).status, 200);
  assert.equal((await o.login(loginReq('bea@blitz.test', WW))).status, 401);
  assert.equal((await o.ik(get('auth-ik', { cookie: `blitz_sessie=${oudToken}` }))).status, 401);
  const rec = (await o.echt.get('gebruikers', { type: 'json' })).gebruikers.find(g => g.id === 'u-bea');
  assert.equal(rec.moetWachtwoordWijzigen, false);
  assert.equal(rec.sessieVersie, 5);
  assert.equal(rec.herstelcodes.length, 9);
  assert.ok(!rec.herstelcodes.includes(codeSet.hashes[0]));
});

test('herstel: dezelfde code een tweede keer -> 401; een andere code uit de set werkt nog', async () => {
  const o = opzet();
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0]))).status, 200);
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0], 'NogEenWachtwoord1'))).status, 401);
  assert.equal((await o.login(loginReq('bea@blitz.test', NIEUW))).status, 200); // niet overschreven
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[1], 'DerdeWachtwoord12'))).status, 200);
  assert.equal((await o.login(loginReq('bea@blitz.test', 'DerdeWachtwoord12'))).status, 200);
});

test('herstel: code in kleine letters, zonder streepje en met spaties wordt aanvaard', async () => {
  const o = opzet();
  const ruw = ' ' + codeSet.codes[2].toLowerCase().replace('-', ' ') + ' ';
  assert.equal((await o.herstel(herstelReq('  Bea@Blitz.TEST ', ruw))).status, 200);
});

test('herstel: foute code, onbekend adres, planner en geblokkeerde beheerder geven byte-identieke 401', async () => {
  const o = opzet();
  const a = await o.herstel(herstelReq('bea@blitz.test', 'AAAA-AAAA'));
  const b = await o.herstel(herstelReq('bestaat-niet@blitz.test', codeSet.codes[0]));
  const c = await o.herstel(herstelReq('jan@blitz.test', codeSet.codes[0]));
  const d = await o.herstel(herstelReq('blok@blitz.test', codeSet.codes[0]));
  for (const r of [a, b, c, d]) {
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('set-cookie'), null);
  }
  const ta = await a.text();
  for (const r of [b, c, d]) assert.equal(await r.text(), ta);
  // niets gewijzigd
  const blob = await o.echt.get('gebruikers', { type: 'json' });
  assert.deepEqual(blob.gebruikers, gebruikersLijst());
});

test('herstel: 5 foute pogingen -> 429 gedurende 1 uur (ook voor de juiste code); daarna weer mogelijk', async () => {
  const o = opzet();
  for (let i = 0; i < 5; i++) assert.equal((await o.herstel(herstelReq('bea@blitz.test', 'FOUT-000' + i))).status, 401);
  const vast = await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0]));
  assert.equal(vast.status, 429);
  assert.equal((await vast.json()).opnieuwOp, new Date(NU0 + 60 * MIN).toISOString());
  o.klok.ms = NU0 + 59 * MIN;
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0]))).status, 429);
  o.klok.ms = NU0 + 61 * MIN;
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0]))).status, 200);
});

test('herstel: 5 pogingen op een niet-bestaand adres vergrendelen ook (zelfde 429-vorm als bij een bestaand adres)', async () => {
  const o = opzet();
  const vorm = async email => {
    for (let i = 0; i < 5; i++) await o.herstel(herstelReq(email, 'FOUT-000' + i));
    const r = await o.herstel(herstelReq(email, codeSet.codes[0]));
    return { status: r.status, body: await r.json() };
  };
  const bekend = await vorm('bea@blitz.test');
  const onbekend = await vorm('niemand@blitz.test');
  assert.deepEqual(bekend, onbekend);
  assert.equal(bekend.status, 429);
});

test('herstel: de 5e (juiste) poging slaagt nog; een geslaagd herstel wist de herstel- en logintellers', async () => {
  const o = opzet();
  for (let i = 0; i < 4; i++) await o.herstel(herstelReq('bea@blitz.test', 'FOUT-000' + i));
  await o.login(loginReq('bea@blitz.test', 'fout')); // een loginfout
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0]))).status, 200);
  const staat = await o.echt.get('login-pogingen', { type: 'json' });
  assert.deepEqual(staat.herstel, {});
  assert.deepEqual(staat.login, {});
});

test('herstel: 5 fouten loggen één keer een gemaskeerde reeks; geslaagd herstel logt herstel met details code', async () => {
  const o = opzet();
  for (let i = 0; i < 5; i++) await o.herstel(herstelReq('niemand@blitz.test', 'FOUT-000' + i));
  let items = await activiteit(o.echt);
  const reeks = items.filter(i => i.actie === 'herstel-mislukt-reeks');
  assert.equal(reeks.length, 1);
  assert.equal(reeks[0].onderwerp, 'n***@blitz.test');
  assert.ok(!JSON.stringify(items).includes('niemand@'));

  await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0]));
  items = await activiteit(o.echt);
  const h = items.find(i => i.actie === 'herstel');
  assert.equal(h.gebruikerId, 'u-bea');
  assert.equal(h.details, 'code');
});

test('herstel: nieuw wachtwoord moet aan het beleid voldoen (400, code niet verbruikt, poging niet geteld)', async () => {
  const o = opzet();
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0], 'kort'))).status, 400);
  assert.equal((await o.herstel(post('auth-herstel', { email: 'bea@blitz.test', bewijs: 'x' }))).status, 400);
  assert.equal((await o.herstel(post('auth-herstel', 'geen json'))).status, 400);
  const rec = (await o.echt.get('gebruikers', { type: 'json' })).gebruikers.find(g => g.id === 'u-bea');
  assert.equal(rec.herstelcodes.length, 10);
  assert.equal(await o.echt.get('login-pogingen', { type: 'json' }), null);
});

test('herstel: zonder X-Blitz 403 csrf; GET 405; OPTIONS 204; zonder SESSIE_GEHEIM 500', async () => {
  const o = opzet();
  const zonder = new Request('http://localhost/api/auth-herstel', { method: 'POST', body: '{}' });
  const r = await o.herstel(zonder);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'csrf');
  assert.equal((await o.herstel(get('auth-herstel'))).status, 405);
  assert.equal((await o.herstel(new Request('http://localhost/api/auth-herstel', { method: 'OPTIONS' }))).status, 204);
  const o2 = opzet({ env: { SESSIE_GEHEIM: '' } });
  assert.equal((await o2.herstel(herstelReq('bea@blitz.test', codeSet.codes[0]))).status, 500);
});

test('herstel: twee gelijktijdige herstellen met dezelfde code -> enkel één slaagt', async () => {
  const o = opzet();
  const [a, b] = await Promise.all([
    o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0], 'EersteWachtwoord1')),
    o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0], 'TweedeWachtwoord1')),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 401]);
});

test('herstel: opslag onbereikbaar -> 503, niets gewijzigd', async () => {
  const o = opzet();
  const stuk = { ...o.echt, get: async () => { throw new Error('weg'); } };
  const handler = maakHerstel({ getStore: () => stuk, env: o.omgeving, nu: () => NU0 });
  assert.equal((await handler(herstelReq('bea@blitz.test', codeSet.codes[0]))).status, 503);
});

test('herstel: gebruikt altijd de echte store, ook bij een testverzoek', async () => {
  const o = opzet();
  const res = await o.herstel(herstelReq('bea@blitz.test', codeSet.codes[0], NIEUW, { 'x-blitz-test': '1' }));
  assert.equal(res.status, 200);
  assert.equal(o.test._data.size, 0);
});

// ---------------- auth-herstel met noodsleutel ----------------
test('noodsleutel: 31 tekens in de omgeving wordt nooit aanvaard', async () => {
  const kort = 'k'.repeat(31);
  const o = opzet({ env: { BEHEER_HERSTELSLEUTEL: kort } });
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', kort))).status, 401);
  assert.equal(await o.echt.get('herstel-noodroute', { type: 'json' }), null);
});

test('noodsleutel: 32+ tekens juist -> 200, nieuw wachtwoord, hash in herstel-noodroute, log noodsleutel, codes onaangeroerd', async () => {
  const o = opzet({ env: { BEHEER_HERSTELSLEUTEL: NOOD } });
  const res = await o.herstel(herstelReq('bea@blitz.test', NOOD));
  assert.equal(res.status, 200);
  assert.equal(controleerToken(cookieWaarde(res), GEHEIM, nuS()).sv, 5);
  assert.equal((await o.login(loginReq('bea@blitz.test', NIEUW))).status, 200);
  const blob = await o.echt.get('herstel-noodroute', { type: 'json' });
  assert.equal(blob.hash, sha(NOOD));
  assert.ok(!JSON.stringify(blob).includes(NOOD));
  const rec = (await o.echt.get('gebruikers', { type: 'json' })).gebruikers.find(g => g.id === 'u-bea');
  assert.equal(rec.herstelcodes.length, 10);
  assert.equal((await activiteit(o.echt)).find(i => i.actie === 'herstel').details, 'noodsleutel');
});

test('noodsleutel: dezelfde sleutel een tweede keer -> 401, ook als de variabele blijft staan', async () => {
  const o = opzet({ env: { BEHEER_HERSTELSLEUTEL: NOOD } });
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', NOOD))).status, 200);
  const tweede = await o.herstel(herstelReq('bea@blitz.test', NOOD, 'AnderWachtwoord123'));
  assert.equal(tweede.status, 401);
  assert.equal((await o.login(loginReq('bea@blitz.test', NIEUW))).status, 200);
});

test('noodsleutel: twee gelijktijdige aanroepen -> enkel één slaagt', async () => {
  const o = opzet({ env: { BEHEER_HERSTELSLEUTEL: NOOD } });
  const [a, b] = await Promise.all([
    o.herstel(herstelReq('bea@blitz.test', NOOD, 'EersteWachtwoord1')),
    o.herstel(herstelReq('bea@blitz.test', NOOD, 'TweedeWachtwoord1')),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 401]);
});

test('noodsleutel: zonder variabele -> 401', async () => {
  const o = opzet();
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', NOOD))).status, 401);
  const o2 = opzet({ env: { BEHEER_HERSTELSLEUTEL: '' } });
  assert.equal((await o2.herstel(herstelReq('bea@blitz.test', NOOD))).status, 401);
});

test('noodsleutel: juiste sleutel met het adres van een planner, onbekend of geblokkeerd adres -> 401 (zelfde body, sleutel niet verbrand)', async () => {
  const o = opzet({ env: { BEHEER_HERSTELSLEUTEL: NOOD } });
  const verwacht = await (await o.herstel(herstelReq('bea@blitz.test', 'AAAA-AAAA'))).text();
  for (const email of ['jan@blitz.test', 'niemand@blitz.test', 'blok@blitz.test']) {
    const r = await o.herstel(herstelReq(email, NOOD));
    assert.equal(r.status, 401, email);
    assert.equal(await r.text(), verwacht);
  }
  assert.equal(await o.echt.get('herstel-noodroute', { type: 'json' }), null);
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', NOOD))).status, 200);
});

test('noodsleutel: foute sleutel telt mee voor de vergrendeling (5 -> 429)', async () => {
  const o = opzet({ env: { BEHEER_HERSTELSLEUTEL: NOOD } });
  const fout = 'f'.repeat(40);
  for (let i = 0; i < 5; i++) assert.equal((await o.herstel(herstelReq('bea@blitz.test', fout))).status, 401);
  assert.equal((await o.herstel(herstelReq('bea@blitz.test', NOOD))).status, 429);
});

// ---------------- hardening uit de Taak 6-review ----------------
test('setup: een correcte setupcode wist de teller meteen; validatiefouten erna branden het slot niet', async () => {
  const o = opzet({ gebruikers: null });
  for (let i = 0; i < 4; i++) assert.equal((await o.setup(setupReq({ setupCode: 'fout' + i }))).status, 403);
  // juiste code, ongeldige naam: 400, maar de code is bewezen -> teller gewist
  assert.equal((await o.setup(setupReq({ naam: '' }))).status, 400);
  const staat = await o.echt.get('login-pogingen', { type: 'json' });
  assert.deepEqual(staat.herstel, {});
  // zonder de fix stond de teller nu op 5 (vergrendeld); nu mag de volgende gewoon slagen
  assert.equal((await o.setup(setupReq())).status, 200);
});

test('herstel: een e-mail zonder @ krijgt de generieke 401 vóór er een poging gereserveerd wordt (botst niet met setup:globaal)', async () => {
  const o = opzet({ gebruikers: null });
  for (let i = 0; i < 6; i++) {
    const r = await o.herstel(herstelReq('setup:globaal', 'FOUT-000' + i));
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'Onjuiste herstelgegevens' });
  }
  assert.equal(await o.echt.get('login-pogingen', { type: 'json' }), null); // geen enkele poging bewaard
  assert.equal((await o.setup(setupReq())).status, 200); // het setupscherm is niet vergrendeld
});
