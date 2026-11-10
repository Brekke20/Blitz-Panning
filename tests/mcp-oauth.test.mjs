import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { maakNepStore } from './nep-blobs.mjs';
import {
  registreerClient, maakCode, wisselCode, ververs, zoekToegang, markeerGebruikt, lijstToegangen, trekIn,
  ACCESS_TTL_S, REFRESH_TTL_S, CODE_TTL_S,
} from '../netlify/lib/mcp-oauth.js';

// `nu` is in milliseconden (zoals Date.now()).
const T0 = 1_800_000_000_000;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(50);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

const GEBRUIKER = { id: 'u1', email: 'a@b.be', naam: 'An', rol: 'planner', actief: true, sessieVersie: 3, wachtwoordHash: 'x' };
const wijzigGebruiker = async (store, patch) => {
  const b = await store.get('gebruikers', { type: 'json' });
  b.gebruikers[0] = { ...b.gebruikers[0], ...patch };
  await store.setJSON('gebruikers', b);
};

async function opzet() {
  const store = maakNepStore({ gebruikers: { versie: 1, gebruikers: [GEBRUIKER] } });
  const c = await registreerClient(store, { redirect_uris: [REDIRECT], client_name: 'Claude' });
  const code = await maakCode(store, { clientId: c.client_id, redirectUri: REDIRECT, codeChallenge: CHALLENGE, uid: 'u1', sessieVersie: 3 }, T0);
  return { store, c, code };
}
const ruil = (store, c, code, extra = {}, nu = T0 + 1000) =>
  wisselCode(store, { code, clientId: c.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, ...extra }, nu);

test('constanten', () => {
  assert.equal(ACCESS_TTL_S, 3600);
  assert.equal(REFRESH_TTL_S, 30 * 24 * 3600);
  assert.equal(CODE_TTL_S, 60);
});

test('registreerClient aanvaardt toegestane redirect-URIs', async () => {
  const store = maakNepStore();
  const r = await registreerClient(store, { redirect_uris: [REDIRECT, 'http://localhost:33418/callback', 'http://127.0.0.1:5000/cb', 'https://claude.com/api/mcp/auth_callback'], client_name: 'X' });
  assert.ok(r.client_id);
  assert.equal(r.client_name, 'X');
  assert.equal(r.redirect_uris.length, 4);
});

test('registreerClient weigert vreemde of onveilige redirect-URIs', async () => {
  for (const u of ['https://evil.example/cb', 'http://claude.ai/api/mcp/auth_callback', 'https://claude.ai/andere', 'http://localhost/cb', 'https://localhost:3000/cb', 'http://localhost.evil.com:3000/cb', 'javascript:alert(1)', 'niet een url']) {
    const r = await registreerClient(maakNepStore(), { redirect_uris: [REDIRECT, u], client_name: 'X' });
    assert.deepEqual(r, { fout: 'invalid_redirect_uri' }, u);
  }
  assert.deepEqual(await registreerClient(maakNepStore(), { redirect_uris: [] }), { fout: 'invalid_redirect_uri' });
  assert.deepEqual(await registreerClient(maakNepStore(), {}), { fout: 'invalid_redirect_uri' });
});

test('code wisselen met juiste verifier geeft tokens', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code);
  assert.equal(t.expires_in, 3600);
  assert.equal(t.token_type, 'Bearer');
  assert.ok(t.access_token && t.refresh_token);
  const toegang = await zoekToegang(store, t.access_token, T0 + 2000);
  assert.equal(toegang.uid, 'u1');
  assert.equal(toegang.sessieVersie, 3);
  assert.equal(toegang.clientId, c.client_id);
  assert.equal(toegang.clientNaam, 'Claude');
});

test('code is eenmalig', async () => {
  const { store, c, code } = await opzet();
  assert.ok((await ruil(store, c, code)).access_token);
  assert.deepEqual(await ruil(store, c, code), { fout: 'invalid_grant' });
});

test('foute verifier: invalid_grant en code is weg', async () => {
  const { store, c, code } = await opzet();
  assert.deepEqual(await ruil(store, c, code, { codeVerifier: 'x'.repeat(50) }), { fout: 'invalid_grant' });
  assert.deepEqual(await ruil(store, c, code), { fout: 'invalid_grant' });
});

test('code na 61 s, andere redirectUri of andere client: invalid_grant', async () => {
  let o = await opzet();
  assert.deepEqual(await ruil(o.store, o.c, o.code, {}, T0 + 61_000), { fout: 'invalid_grant' });
  o = await opzet();
  assert.deepEqual(await ruil(o.store, o.c, o.code, { redirectUri: 'https://claude.com/api/mcp/auth_callback' }), { fout: 'invalid_grant' });
  o = await opzet();
  assert.deepEqual(await ruil(o.store, o.c, o.code, { clientId: 'anders' }), { fout: 'invalid_grant' });
  o = await opzet();
  assert.ok((await ruil(o.store, o.c, o.code, {}, T0 + 60_000)).access_token);
});

test('enkel S256: een gewone challenge werkt niet', async () => {
  const store = maakNepStore();
  const code = await maakCode(store, { clientId: 'c', redirectUri: REDIRECT, codeChallenge: VERIFIER, uid: 'u1', sessieVersie: 1 }, T0);
  assert.deepEqual(await wisselCode(store, { code, clientId: 'c', redirectUri: REDIRECT, codeVerifier: VERIFIER }, T0), { fout: 'invalid_grant' });
});

test('access token verloopt na 3600 s', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  assert.ok(await zoekToegang(store, t.access_token, T0 + 3600_000));
  assert.equal(await zoekToegang(store, t.access_token, T0 + 3601_000), null);
  assert.equal(await zoekToegang(store, 'onbekend', T0), null);
});

test('ververs roteert; oud refresh werkt niet meer', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  const n = await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 4000_000);
  assert.ok(n.access_token && n.refresh_token);
  assert.notEqual(n.refresh_token, t.refresh_token);
  assert.equal(n.expires_in, 3600);
  assert.deepEqual(await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 4000_000), { fout: 'invalid_grant' });
  assert.ok(await zoekToegang(store, n.access_token, T0 + 4000_000));
  assert.equal((await lijstToegangen(store)).length, 1);
});

test('ververs met andere client faalt', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  assert.deepEqual(await ververs(store, { refreshToken: t.refresh_token, clientId: 'anders' }, T0), { fout: 'invalid_grant' });
});

test('refresh na 30 dagen + 1 s: invalid_grant', async () => {
  const dag30 = 30 * 24 * 3600 * 1000;
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  assert.deepEqual(await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + dag30 + 1000), { fout: 'invalid_grant' });
  const o = await opzet();
  const t2 = await ruil(o.store, o.c, o.code, {}, T0);
  assert.ok((await ververs(o.store, { refreshToken: t2.refresh_token, clientId: o.c.client_id }, T0 + dag30)).access_token);
});

test('opslag bevat geen ruwe tokens', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code);
  const n = await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 2000);
  const alles = JSON.stringify([...store._data.entries()]);
  for (const geheim of [t.access_token, t.refresh_token, n.access_token, n.refresh_token, code, VERIFIER]) assert.ok(!alles.includes(geheim));
});

test('trekIn maakt toegang en refresh ongeldig', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code);
  const [toegang] = await lijstToegangen(store);
  assert.equal(toegang.uid, 'u1');
  assert.equal(await trekIn(store, toegang.id), true);
  assert.equal(await zoekToegang(store, t.access_token, T0 + 2000), null);
  assert.deepEqual(await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 2000), { fout: 'invalid_grant' });
  assert.equal((await lijstToegangen(store)).length, 0);
  assert.equal(await trekIn(store, toegang.id), false);
});

test('laatstGebruikt staat in een aparte blob en wordt hoogstens per 5 min bijgewerkt (markeerGebruikt)', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  const [toegangId] = (await lijstToegangen(store)).map(x => x.id);
  const toegangSleutel = `mcp-toegang-${toegangId}`;
  const voor = store._data.get(toegangSleutel);
  const gebruik = async (nu) => { const x = await zoekToegang(store, t.access_token, nu); await markeerGebruikt(store, x, nu); return x; };
  const a = await gebruik(T0 + 5000);
  assert.equal(a.aangemaakt, T0);
  assert.equal(a.laatstGebruikt, T0);
  assert.ok(!store._schrijfacties.some(w => w.key.startsWith('mcp-gebruikt-')), 'binnen 5 min niet schrijven');
  const b = await gebruik(T0 + 301_000);
  assert.equal(b.laatstGebruikt, T0);
  assert.equal((await lijstToegangen(store))[0].laatstGebruikt, T0 + 301_000);
  const c2 = await gebruik(T0 + 400_000);
  assert.equal(c2.laatstGebruikt, T0 + 301_000);
  assert.equal(store._data.get(toegangSleutel), voor, 'toegangrecord blijft ongewijzigd');
  assert.equal(store._schrijfacties.filter(w => w.key === toegangSleutel).length, 1);
});

test('zoekToegang zelf schrijft nooit laatstGebruikt (dat gebeurt pas na de gebruikerscontrole)', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  assert.ok(await zoekToegang(store, t.access_token, T0 + 400_000));
  assert.ok(!store._schrijfacties.some(w => w.key.startsWith('mcp-gebruikt-')));
});

// Hulp: de store roept `na` eenmalig aan nadat de toegang gelezen is (simuleert een gelijktijdige intrekking).
function metHaak(store, na) {
  const get = store.get.bind(store);
  let gedaan = false;
  store.get = async (key, o) => {
    const r = await get(key, o);
    if (!gedaan && key.startsWith('mcp-toegang-') && r) { gedaan = true; await na(); }
    return r;
  };
  return store;
}

test('intrekken tijdens ververs wordt niet ongedaan gemaakt', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  const [toegang] = await lijstToegangen(store);
  metHaak(store, () => trekIn(store, toegang.id));
  const n = await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 1000);
  assert.deepEqual(n, { fout: 'invalid_grant' });
  assert.equal((await lijstToegangen(store)).length, 0);
  assert.equal(store._data.has(`mcp-toegang-${toegang.id}`), false);
  assert.equal(await zoekToegang(store, t.access_token, T0 + 1000), null);
  assert.ok(![...store._data.keys()].some(k => k.startsWith('mcp-acc-') || k.startsWith('mcp-ref-')), 'geen losse tokens');
});

test('intrekken tijdens zoekToegang + markeerGebruikt laat geen spookvermelding achter', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  const [toegang] = await lijstToegangen(store);
  metHaak(store, () => trekIn(store, toegang.id));
  const x = await zoekToegang(store, t.access_token, T0 + 400_000);
  await markeerGebruikt(store, x, T0 + 400_000);
  assert.equal((await lijstToegangen(store)).length, 0);
  assert.equal(store._data.has(`mcp-gebruikt-${toegang.id}`), false);
  assert.equal(await zoekToegang(store, t.access_token, T0 + 400_000), null);
});

// ---- I1: absolute vervaltijd 30 dagen na de toestemming ----
const DAG = 24 * 3600 * 1000;

test('absolute vervaltijd: ververs dag 29 lukt, ververs dag 31 -> invalid_grant en de toegang is weg', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  const [toegang] = await lijstToegangen(store);
  const n = await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 29 * DAG);
  assert.ok(n.access_token, 'dag 29 lukt');
  // het nieuwe refresh token vervalt op aangemaakt + 30 dagen, niet op dag 29 + 30 dagen
  const ref = [...store._data.keys()].find(k => k.startsWith('mcp-ref-'));
  assert.equal(JSON.parse(store._data.get(ref)).verlooptOp, T0 + 30 * DAG);
  assert.deepEqual(await ververs(store, { refreshToken: n.refresh_token, clientId: c.client_id }, T0 + 31 * DAG), { fout: 'invalid_grant' });
  assert.equal(store._data.has(`mcp-toegang-${toegang.id}`), false, 'toegangsrecord opgeruimd');
  assert.equal((await lijstToegangen(store)).length, 0);
});

test('absolute vervaltijd: een access token van vlak voor dag 30 werkt niet meer na dag 30, en de toegang wordt opgeruimd', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  const [toegang] = await lijstToegangen(store);
  const n = await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 30 * DAG - 10 * 60 * 1000);
  assert.ok(await zoekToegang(store, n.access_token, T0 + 30 * DAG - 1000), 'vlak voor dag 30 nog geldig');
  assert.equal(await zoekToegang(store, n.access_token, T0 + 30 * DAG + 1000), null, 'na dag 30 weg, al is het access token zelf pas 10 min oud');
  assert.equal(store._data.has(`mcp-toegang-${toegang.id}`), false);
});

// ---- I2: gebruikerscontrole bij verversen ----
for (const [naam, patch] of [
  ['wachtwoordwijziging (sessieVersie + 1)', { sessieVersie: 4 }],
  ['deactivatie', { actief: false }],
  ['moetWachtwoordWijzigen', { moetWachtwoordWijzigen: true }],
  ['ongeldige rol', { rol: 'koning' }],
]) {
  test(`ververs na ${naam}: invalid_grant en de toegang is ingetrokken`, async () => {
    const { store, c, code } = await opzet();
    const t = await ruil(store, c, code, {}, T0);
    const [toegang] = await lijstToegangen(store);
    await wijzigGebruiker(store, patch);
    assert.deepEqual(await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 4000_000), { fout: 'invalid_grant' });
    assert.equal(store._data.has(`mcp-toegang-${toegang.id}`), false);
    assert.equal((await lijstToegangen(store)).length, 0);
    assert.ok(![...store._data.keys()].some(k => k.startsWith('mcp-acc-') || k.startsWith('mcp-ref-')), 'geen nieuwe tokens');
  });
}

test('ververs voor een verwijderde gebruiker: invalid_grant en de toegang is ingetrokken', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  await store.setJSON('gebruikers', { versie: 2, gebruikers: [] });
  assert.deepEqual(await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 1000), { fout: 'invalid_grant' });
  assert.equal((await lijstToegangen(store)).length, 0);
});

test('ververs: een opslagfout bij het lezen van de gebruikers verbruikt niets (gooit, wordt 500); daarna werkt hetzelfde token', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  const get = store.get.bind(store);
  store.get = async (key, o) => { if (key === 'gebruikers') throw new Error('blobs hapert'); return get(key, o); };
  await assert.rejects(ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 1000));
  store.get = get;
  assert.equal((await lijstToegangen(store)).length, 1, 'toegang blijft bestaan');
  assert.ok(await zoekToegang(store, t.access_token, T0 + 1000), 'oud access token nog geldig');
  assert.ok((await ververs(store, { refreshToken: t.refresh_token, clientId: c.client_id }, T0 + 2000)).access_token, 'zelfde refresh token werkt na herstel');
});

test('ververs met andere client trekt de toegang niet in', async () => {
  const { store, c, code } = await opzet();
  const t = await ruil(store, c, code, {}, T0);
  assert.deepEqual(await ververs(store, { refreshToken: t.refresh_token, clientId: 'anders' }, T0), { fout: 'invalid_grant' });
  assert.equal((await lijstToegangen(store)).length, 1);
});

// ---- M5: code_verifier volgens RFC 7636 (43-128 tekens uit [A-Za-z0-9-._~]) ----
test('code_verifier van 42 of 129 tekens of met een ongeldig teken: invalid_grant, ook als de challenge erbij past; code is weg', async () => {
  for (const verifier of ['a'.repeat(42), 'a'.repeat(129), 'a'.repeat(42) + ' ', 'a'.repeat(42) + '+', 'a'.repeat(42) + 'é']) {
    const store = maakNepStore();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await maakCode(store, { clientId: 'c', redirectUri: REDIRECT, codeChallenge: challenge, uid: 'u1', sessieVersie: 1 }, T0);
    assert.deepEqual(await wisselCode(store, { code, clientId: 'c', redirectUri: REDIRECT, codeVerifier: verifier }, T0), { fout: 'invalid_grant' }, JSON.stringify(verifier));
    assert.equal((await store.list({ prefix: 'mcp-code-' })).blobs.length, 0);
  }
});

test('code_verifier van exact 43 en 128 tekens met alle toegestane tekens werkt', async () => {
  const basis = 'ABCxyz019-._~';
  for (const len of [43, 128]) {
    const verifier = basis.repeat(20).slice(0, len);
    const store = maakNepStore();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await maakCode(store, { clientId: 'c', redirectUri: REDIRECT, codeChallenge: challenge, uid: 'u1', sessieVersie: 1 }, T0);
    assert.ok((await wisselCode(store, { code, clientId: 'c', redirectUri: REDIRECT, codeVerifier: verifier }, T0)).access_token, String(len));
  }
});
