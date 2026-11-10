// tests/mcp-toegangen.test.mjs — /api/mcp-toegangen (Task 6 MCP-leesconnector): gekoppelde Claude-toegangen bekijken en intrekken.
// Beheerder: alle koppelingen (met gebruikersnaam), elke intrekken. Anderen: enkel de eigen (andermans intrekken = 403).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepStore } from './nep-blobs.mjs';
import { metRol, zetStandaard } from './auth-hulp.mjs';
import { zoekToegang } from '../netlify/lib/mcp-oauth.js';
import { leesActiviteit } from '../netlify/lib/activiteit.js';
import { maakAuth } from '../netlify/lib/auth.js';
import { ondertekenToken } from '../netlify/lib/sessie-token.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { maakHandler, config } from '../netlify/functions/mcp-toegangen.js';

const T0 = 1_800_000_000_000;
const TECH = 'test-technieker';
const PLANNER = 'test-planner';

function opzet() {
  const store = maakNepStore({
    gebruikers: { versie: 1, gebruikers: [
      { id: TECH, naam: 'Tim <b>Techniek</b>', rol: 'technieker', actief: true },
      { id: PLANNER, naam: 'Pia Planner', rol: 'planner', actief: true },
    ] },
    'mcp-toegang-ta': { id: 'ta', uid: TECH, sessieVersie: 1, clientId: 'c1', clientNaam: 'Claude', aangemaakt: T0 - 5000 },
    'mcp-toegang-tb': { id: 'tb', uid: PLANNER, sessieVersie: 1, clientId: 'c2', clientNaam: 'Claude Code', aangemaakt: T0 - 9000 },
    'mcp-toegang-tc': { id: 'tc', uid: 'weg', sessieVersie: 1, clientId: 'c3', clientNaam: 'Claude', aangemaakt: T0 - 1000 },
    'mcp-gebruikt-ta': { laatstGebruikt: T0 - 100 },
  });
  const h = maakHandler({ getStore: () => store, nu: () => T0 });
  return { store, h };
}
const url = (zoek = '') => `https://blitz.voorbeeld.be/api/mcp-toegangen${zoek}`;
const get = h => h(new Request(url()), {});
const del = (h, id) => h(new Request(url(id === undefined ? '' : `?id=${id}`), { method: 'DELETE', headers: { 'X-Blitz': '1' } }), {});

before(() => zetStandaard(null));
after(() => zetStandaard(null));

test('config en rechtenrij: pad /api/mcp-toegangen, GET en DELETE voor alle rollen', () => {
  assert.equal(config.path, '/api/mcp-toegangen');
  assert.deepEqual(Object.keys(RECHTEN['mcp-toegangen']).sort(), ['DELETE', 'GET']);
  assert.deepEqual([...RECHTEN['mcp-toegangen'].GET].sort(), ['beheerder', 'planner', 'sales', 'technieker']);
  assert.deepEqual([...RECHTEN['mcp-toegangen'].DELETE].sort(), ['beheerder', 'planner', 'sales', 'technieker']);
});

test('technieker ziet enkel de eigen koppeling, met naam, zonder uid-lekken van anderen', async () => {
  const { h } = opzet();
  const r = await metRol('technieker', () => get(h));
  assert.equal(r.status, 200);
  const { toegangen } = await r.json();
  assert.deepEqual(toegangen, [{ id: 'ta', uid: TECH, gebruikerNaam: 'Tim <b>Techniek</b>', clientNaam: 'Claude', aangemaakt: T0 - 5000, laatstGebruikt: T0 - 100 }]);
});

test('beheerder ziet alle koppelingen, nieuwste eerst; onbekende gebruiker krijgt een nette naam', async () => {
  const { h } = opzet();
  const r = await metRol('beheerder', () => get(h));
  const { toegangen } = await r.json();
  assert.deepEqual(toegangen.map(t => t.id), ['tc', 'ta', 'tb']);
  assert.equal(toegangen[0].gebruikerNaam, 'Onbekende gebruiker');
  assert.equal(toegangen[2].gebruikerNaam, 'Pia Planner');
  assert.equal(JSON.stringify(toegangen).includes('sessieVersie'), false);
  assert.equal(JSON.stringify(toegangen).includes('clientId'), false);
});

test('technieker kan andermans koppeling niet intrekken: 403 en de toegang blijft bestaan', async () => {
  const { h, store } = opzet();
  const r = await metRol('technieker', () => del(h, 'tb'));
  assert.equal(r.status, 403);
  assert.ok(await store.get('mcp-toegang-tb', { type: 'json' }));
});

test('technieker trekt de eigen koppeling in: 200, toegang weg, activiteit gelogd', async () => {
  const { h, store } = opzet();
  const r = await metRol('technieker', () => del(h, 'ta'));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(await store.get('mcp-toegang-ta', { type: 'json' }), null);
  const log = await leesActiviteit(store, {});
  assert.ok(log.some(i => i.actie === "claude-ingetrokken" && i.gebruikerId === TECH));
});

test('beheerder trekt elke koppeling in: daarna vindt zoekToegang niets meer', async () => {
  const { h, store } = opzet();
  const { registreerClient, maakCode, wisselCode } = await import('../netlify/lib/mcp-oauth.js');
  const client = await registreerClient(store, { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude' });
  const { createHash } = await import('node:crypto');
  const verifier = 'v'.repeat(50);
  const code = await maakCode(store, {
    clientId: client.client_id, redirectUri: 'https://claude.ai/api/mcp/auth_callback',
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'), uid: TECH, sessieVersie: 1,
  }, T0);
  const tok = await wisselCode(store, { code, clientId: client.client_id, redirectUri: 'https://claude.ai/api/mcp/auth_callback', codeVerifier: verifier }, T0);
  const toegang = await zoekToegang(store, tok.access_token, T0);
  assert.ok(toegang);
  const r = await metRol('beheerder', () => del(h, toegang.id));
  assert.equal(r.status, 200);
  assert.equal(await zoekToegang(store, tok.access_token, T0), null);
});

test('onbekend of ontbrekend id: 404 resp. 400', async () => {
  const { h } = opzet();
  assert.equal((await metRol('beheerder', () => del(h, 'bestaat-niet'))).status, 404);
  assert.equal((await metRol('beheerder', () => del(h))).status, 400);
});

test('technieker met onbekend id krijgt 404 (niets te lekken)', async () => {
  const { h } = opzet();
  const r = await metRol('technieker', () => del(h, 'bestaat-niet'));
  assert.equal(r.status, 404);
});

test('DELETE zonder X-Blitz-kop: 403 (CSRF) en de toegang blijft; met de kop lukt het (echte beveiligV2 + sessiecontrole)', async () => {
  const GEHEIM = 'testgeheim-testgeheim';
  const store = maakNepStore({
    gebruikers: { versie: 1, gebruikers: [{ id: 'u-tim', naam: 'Tim', rol: 'technieker', actief: true, sessieVersie: 1 }] },
    'mcp-toegang-ta': { id: 'ta', uid: 'u-tim', sessieVersie: 1, clientId: 'c1', clientNaam: 'Claude', aangemaakt: T0 - 5000 },
  });
  const getStore = () => store;
  const auth = maakAuth({ getStore, env: { SESSIE_GEHEIM: GEHEIM }, nu: () => T0 });
  const h = maakHandler({ getStore, nu: () => T0, auth });
  const cookie = `blitz_sessie=${ondertekenToken({ uid: 'u-tim', sv: 1, exp: Math.floor(T0 / 1000) + 3600 }, GEHEIM)}`;
  const zonder = await h(new Request(url('?id=ta'), { method: 'DELETE', headers: { cookie } }), {});
  assert.equal(zonder.status, 403);
  assert.ok(await store.get('mcp-toegang-ta', { type: 'json' }));
  const met = await h(new Request(url('?id=ta'), { method: 'DELETE', headers: { cookie, 'X-Blitz': '1' } }), {});
  assert.equal(met.status, 200);
  assert.equal(await store.get('mcp-toegang-ta', { type: 'json' }), null);
});
