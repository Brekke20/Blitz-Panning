import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { maakNepStore } from './nep-blobs.mjs';
import { registreerClient, maakCode, wisselCode } from '../netlify/lib/mcp-oauth.js';
import { vereisMcpGebruiker } from '../netlify/lib/mcp-toegang.js';

const T0 = 1_800_000_000_000;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(50);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const gebruikerRec = (extra = {}) => ({
  id: 'u1', email: 'a@b.be', naam: 'An', rol: 'planner', actief: true, sessieVersie: 3,
  wachtwoordHash: 'geheim', herstelcodes: ['x'], ...extra,
});

async function opzet(gebruiker = gebruikerRec()) {
  const store = maakNepStore({ gebruikers: { versie: 1, gebruikers: gebruiker ? [gebruiker] : [] } });
  const c = await registreerClient(store, { redirect_uris: [REDIRECT], client_name: 'Claude' });
  const code = await maakCode(store, { clientId: c.client_id, redirectUri: REDIRECT, codeChallenge: CHALLENGE, uid: 'u1', sessieVersie: 3 }, T0);
  const tokens = await wisselCode(store, { code, clientId: c.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER }, T0 + 1000);
  const opties = { getStore: async () => store, nu: T0 + 2000 };
  const req = (token = tokens.access_token) => ({ headers: { authorization: `Bearer ${token}` } });
  return { store, tokens, opties, req };
}
const wijzig = async (store, patch) => {
  const b = await store.get('gebruikers', { type: 'json' });
  b.gebruikers[0] = { ...b.gebruikers[0], ...patch };
  await store.setJSON('gebruikers', b);
};
const WEIGER = { ok: false, status: 401, code: 'invalid_token' };

test('geldige token + actieve gebruiker -> ok, publiek profiel, toegangId', async () => {
  const { opties, req } = await opzet();
  const r = await vereisMcpGebruiker(req(), opties);
  assert.equal(r.ok, true);
  assert.equal(r.gebruiker.rol, 'planner');
  assert.equal(r.gebruiker.id, 'u1');
  assert.equal(r.gebruiker.wachtwoordHash, undefined);
  assert.equal(r.gebruiker.sessieVersie, undefined);
  assert.ok(r.toegangId);
});

test('werkt met v2-Request (Headers) en hoofdletterloze Bearer-schemanaam', async () => {
  const { opties, tokens } = await opzet();
  const r = await vereisMcpGebruiker(new Request('https://x.test/', { headers: { Authorization: `bearer ${tokens.access_token}` } }), opties);
  assert.equal(r.ok, true);
});

test('geen of foute Authorization -> 401', async () => {
  const { opties, tokens } = await opzet();
  for (const h of [undefined, '', 'Bearer', 'Bearer ', 'Basic abc', tokens.access_token, 'Bearer onbekend']) {
    const req = { headers: h === undefined ? {} : { authorization: h } };
    assert.deepEqual(await vereisMcpGebruiker(req, opties), WEIGER, String(h));
  }
  assert.deepEqual(await vereisMcpGebruiker({}, opties), WEIGER);
  assert.deepEqual(await vereisMcpGebruiker(null, opties), WEIGER);
});

test('gebruiker actief:false -> 401', async () => {
  const { store, opties, req } = await opzet();
  await wijzig(store, { actief: false });
  assert.deepEqual(await vereisMcpGebruiker(req(), opties), WEIGER);
});

test('actief niet letterlijk true -> 401', async () => {
  const { store, opties, req } = await opzet();
  await wijzig(store, { actief: 'true' });
  assert.deepEqual(await vereisMcpGebruiker(req(), opties), WEIGER);
});

test('sessieVersie verhoogd (wachtwoordwijziging) -> 401', async () => {
  const { store, opties, req } = await opzet();
  await wijzig(store, { sessieVersie: 4 });
  assert.deepEqual(await vereisMcpGebruiker(req(), opties), WEIGER);
});

test('rol niet in ROLLEN -> 401', async () => {
  const { store, opties, req } = await opzet();
  await wijzig(store, { rol: 'koning' });
  assert.deepEqual(await vereisMcpGebruiker(req(), opties), WEIGER);
});

test('gebruiker verwijderd -> 401', async () => {
  const { opties, req } = await opzet(null);
  assert.deepEqual(await vereisMcpGebruiker(req(), opties), WEIGER);
});

test('moetWachtwoordWijzigen -> 401', async () => {
  const { store, opties, req } = await opzet();
  await wijzig(store, { moetWachtwoordWijzigen: true });
  assert.deepEqual(await vereisMcpGebruiker(req(), opties), WEIGER);
});

test('verlopen access token -> 401', async () => {
  const { opties, req } = await opzet();
  assert.deepEqual(await vereisMcpGebruiker(req(), { ...opties, nu: T0 + 2 * 3600 * 1000 }), WEIGER);
});

test('ingetrokken toegang -> 401', async () => {
  const { store, opties, req } = await opzet();
  for (const k of store._data.keys()) if (k.startsWith('mcp-toegang-')) store._data.delete(k);
  assert.deepEqual(await vereisMcpGebruiker(req(), opties), WEIGER);
});

test('opslagfout -> 401 (fail-closed), nooit een uitzondering', async () => {
  const { req } = await opzet();
  const stil = console.error; console.error = () => {};
  try {
    assert.deepEqual(await vereisMcpGebruiker(req(), { getStore: async () => { throw new Error('boem'); }, nu: T0 }), WEIGER);
  } finally { console.error = stil; }
});
