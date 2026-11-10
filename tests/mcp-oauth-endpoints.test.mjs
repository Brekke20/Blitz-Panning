// tests/mcp-oauth-endpoints.test.mjs — netlify/functions/mcp-oauth.js (Task 3 MCP-leesconnector):
// metadata, registratie, authorize (login, toestemming, ondertekend consent-veld) en token.
// Echte sessiecontrole (maakAuth + ondertekend cookie) op een nep-store: geen Blobs, geen netwerk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { maakNepStore } from './nep-blobs.mjs';
import { maakAuth } from '../netlify/lib/auth.js';
import { ondertekenToken } from '../netlify/lib/sessie-token.js';
import { zoekToegang } from '../netlify/lib/mcp-oauth.js';
import { maakHandler, config } from '../netlify/functions/mcp-oauth.js';

const GEHEIM = 'test-sessiegeheim-voor-mcp-oauth';
const T0 = 1_800_000_000_000;
const ORIGIN = 'https://blitz.voorbeeld.be';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'verifier-'.repeat(6);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

const rec = (extra = {}) => ({
  id: 'u1', email: 'an@blitz.be', naam: 'An <b>Peeters</b>', rol: 'planner', actief: true, sessieVersie: 3, wachtwoordHash: 'x', ...extra,
});

function opzet({ gebruikers = [rec()], env = { SESSIE_GEHEIM: GEHEIM } } = {}) {
  const store = maakNepStore({ gebruikers: { versie: 1, gebruikers } });
  const klok = { nu: T0 };
  const nu = () => klok.nu;
  const getStore = async () => store;
  const auth = maakAuth({ getStore, env, nu });
  const h = maakHandler({ getStore, env, nu, auth });
  const cookie = (uid = 'u1', sv = 3) => `blitz_sessie=${ondertekenToken({ uid, sv, exp: Math.floor(T0 / 1000) + 30 * 24 * 3600 }, GEHEIM)}`;
  return { store, klok, h, cookie };
}

const url = (pad, params) => `${ORIGIN}${pad}${params ? '?' + new URLSearchParams(params) : ''}`;
const get = (h, pad, params, headers = {}) => h(new Request(url(pad, params), { headers }), {});
const postJson = (h, pad, body, headers = {}) => h(new Request(url(pad), {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
}), {});
const postForm = (h, pad, velden, headers = {}) => h(new Request(url(pad), {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(velden).toString(),
}), {});

async function registreer(h, redirect_uris = [REDIRECT], client_name = 'Claude') {
  const r = await postJson(h, '/api/mcp-oauth/register', { redirect_uris, client_name });
  assert.equal(r.status, 201);
  return r.json();
}
const authParams = (clientId, extra = {}) => ({
  response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE,
  code_challenge_method: 'S256', state: 'st-123', ...extra,
});
const consentUit = html => /name="consent" value="([^"]+)"/.exec(html)?.[1];

async function toestemmingsPagina(o, clientId, extra) {
  const r = await get(o.h, '/api/mcp-oauth/authorize', authParams(clientId, extra), { cookie: o.cookie() });
  assert.equal(r.status, 200);
  const html = await r.text();
  return { r, html, consent: consentUit(html) };
}

// ---- config ----
test('config.path: exact de vier paden uit het plan', () => {
  assert.deepEqual(config.path, [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/api/mcp',
    '/.well-known/oauth-authorization-server',
    '/api/mcp-oauth/*',
  ]);
});

// ---- metadata ----
test('protected-resource-metadata (beide paden): resource en authorization_servers op de origin van het verzoek', async () => {
  const { h } = opzet();
  for (const pad of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp']) {
    const r = await get(h, pad);
    assert.equal(r.status, 200, pad);
    assert.deepEqual(await r.json(), { resource: `${ORIGIN}/api/mcp`, authorization_servers: [ORIGIN] });
  }
});

test('authorization-server-metadata: alle velden exact', async () => {
  const { h } = opzet();
  const r = await get(h, '/.well-known/oauth-authorization-server');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    issuer: ORIGIN,
    authorization_endpoint: `${ORIGIN}/api/mcp-oauth/authorize`,
    token_endpoint: `${ORIGIN}/api/mcp-oauth/token`,
    registration_endpoint: `${ORIGIN}/api/mcp-oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['lezen'],
  });
});

test('OPTIONS op elk pad (ook zonder subpad) geeft 204; onbekend pad 404', async () => {
  const { h } = opzet();
  for (const pad of ['/api/mcp-oauth', '/api/mcp-oauth/token', '/.well-known/oauth-authorization-server']) {
    const r = await h(new Request(url(pad), { method: 'OPTIONS' }), {});
    assert.equal(r.status, 204, pad);
  }
  assert.equal((await get(h, '/api/mcp-oauth/bestaat-niet')).status, 404);
});

// ---- registratie ----
test('register: geldige client geeft 201 met client_id; ongeldige redirect 400 invalid_redirect_uri', async () => {
  const { h, store } = opzet();
  const c = await registreer(h);
  assert.match(c.client_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(c.redirect_uris, [REDIRECT]);
  assert.equal(c.token_endpoint_auth_method, 'none');
  assert.ok(await store.get(`mcp-client-${c.client_id}`, { type: 'json' }));
  const r = await postJson(h, '/api/mcp-oauth/register', { redirect_uris: ['https://evil.example/cb'] });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'invalid_redirect_uri');
});

test('register: meer dan 5 redirect_uris, body boven 10 KB of geen JSON geeft 400 en bewaart niets', async () => {
  const { h, store } = opzet();
  const zes = Array.from({ length: 6 }, (_, i) => `http://localhost:${3000 + i}/cb`);
  assert.equal((await postJson(h, '/api/mcp-oauth/register', { redirect_uris: zes })).status, 400);
  const groot = await postJson(h, '/api/mcp-oauth/register', { redirect_uris: [REDIRECT], client_name: 'x'.repeat(11 * 1024) });
  assert.equal(groot.status, 400);
  assert.equal((await postJson(h, '/api/mcp-oauth/register', '{niet json')).status, 400);
  assert.equal((await get(h, '/api/mcp-oauth/register')).status, 405);
  assert.equal((await store.list({ prefix: 'mcp-client-' })).blobs.length, 0);
});

// ---- authorize GET ----
test('authorize zonder sessie: loginformulier (200) dat via /api/auth-login met X-Blitz aanmeldt; anti-framing en no-store', async () => {
  const { h } = opzet();
  const c = await registreer(h);
  const r = await get(h, '/api/mcp-oauth/authorize', authParams(c.client_id));
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('/api/auth-login'));
  assert.ok(html.includes('X-Blitz'));
  // zonder JS nooit een GET met het wachtwoord in de URL
  assert.ok(html.includes('<form id="login" method="post">'));
  assert.ok(!html.includes('name="consent"'));
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-type'), /text\/html/);
});

test('authorize met onbekende redirect_uri of client: 400-pagina, nooit een Location', async () => {
  const { h, cookie } = opzet();
  const c = await registreer(h);
  const gevallen = [
    authParams(c.client_id, { redirect_uri: 'https://claude.ai/api/mcp/auth_callback/' }),
    authParams(c.client_id, { redirect_uri: 'http://localhost:8080/cb' }),
    authParams('00000000-0000-4000-8000-000000000000'),
    authParams('../gebruikers'),
    authParams(''),
  ];
  for (const p of gevallen) {
    const r = await get(h, '/api/mcp-oauth/authorize', p, { cookie: cookie() });
    assert.equal(r.status, 400, JSON.stringify(p));
    assert.equal(r.headers.get('location'), null);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  }
});

test('authorize met fout response_type, PKCE-methode of code_challenge: 400 zonder redirect', async () => {
  const { h, cookie } = opzet();
  const c = await registreer(h);
  const gevallen = [
    { response_type: 'token' }, { response_type: undefined }, { code_challenge_method: 'plain' }, { code_challenge_method: undefined },
    { code_challenge: '' }, { code_challenge: 'kort' }, { code_challenge: 'a'.repeat(129) }, { code_challenge: '+'.repeat(43) },
    { redirect_uri: '' },
  ];
  for (const extra of gevallen) {
    const p = authParams(c.client_id, extra);
    for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
    const r = await get(h, '/api/mcp-oauth/authorize', p, { cookie: cookie() });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.headers.get('location'), null);
  }
});

test('authorize ingelogd: toestemmingspagina met naam (ge-escaped), Toestaan/Weigeren en ondertekend consent-veld', async () => {
  const o = opzet();
  const c = await registreer(o.h, [REDIRECT], 'Claude <script>alert(1)</script>');
  const { r, html, consent } = await toestemmingsPagina(o, c.client_id, { state: '"><script>x()</script>' });
  assert.ok(html.includes('Claude toegang geven om te lezen?'));
  assert.ok(html.includes('Claude kan niets wijzigen.'));
  assert.ok(html.includes('An &lt;b&gt;Peeters&lt;/b&gt;'));
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<script>x()'));
  assert.ok(!html.includes('<b>Peeters'));
  assert.ok(html.includes('Toestaan') && html.includes('Weigeren'));
  assert.ok(consent && consent.length > 20);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('authorize met moetWachtwoordWijzigen: melding, geen consent-veld', async () => {
  const o = opzet({ gebruikers: [rec({ moetWachtwoordWijzigen: true })] });
  const c = await registreer(o.h);
  const r = await get(o.h, '/api/mcp-oauth/authorize', authParams(c.client_id), { cookie: o.cookie() });
  const html = await r.text();
  assert.ok(html.includes('Wijzig eerst je wachtwoord in de tool'));
  assert.ok(!html.includes('name="consent"'));
});

test('authorize zonder SESSIE_GEHEIM: 500-pagina, nooit een consent-veld', async () => {
  const o = opzet({ env: {} });
  const c = await registreer(o.h);
  const r = await get(o.h, '/api/mcp-oauth/authorize', authParams(c.client_id), { cookie: o.cookie() });
  assert.equal(r.status, 500);
  assert.ok(!(await r.text()).includes('name="consent"'));
});

// ---- authorize POST ----
test('POST authorize Toestaan met geldig consent: 302 naar redirect_uri met code en dezelfde state; activiteit gelogd', async () => {
  const o = opzet();
  const c = await registreer(o.h);
  const { consent } = await toestemmingsPagina(o, c.client_id);
  const r = await postForm(o.h, '/api/mcp-oauth/authorize', { consent, keuze: 'toestaan' }, { cookie: o.cookie() });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(`${loc.origin}${loc.pathname}`, REDIRECT);
  assert.ok(loc.searchParams.get('code'));
  assert.equal(loc.searchParams.get('state'), 'st-123');
  const maand = await o.store.get(`activiteit/${new Date(T0).toISOString().slice(0, 7)}`, { type: 'json' });
  assert.equal(maand.items.at(-1).actie, 'claude-gekoppeld');
  assert.equal(maand.items.at(-1).gebruikerId, 'u1');
});

test('POST authorize Weigeren: 302 met error=access_denied en state, geen code', async () => {
  const o = opzet();
  const c = await registreer(o.h);
  const { consent } = await toestemmingsPagina(o, c.client_id);
  const r = await postForm(o.h, '/api/mcp-oauth/authorize', { consent, keuze: 'weigeren' }, { cookie: o.cookie() });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.searchParams.get('error'), 'access_denied');
  assert.equal(loc.searchParams.get('state'), 'st-123');
  assert.equal(loc.searchParams.get('code'), null);
  assert.equal((await o.store.list({ prefix: 'mcp-code-' })).blobs.length, 0);
});

test('POST authorize: vervalst, gewijzigd, verlopen, andere gebruiker of geen sessie -> 403 zonder redirect en zonder code', async () => {
  const o = opzet({ gebruikers: [rec(), rec({ id: 'u2', email: 'b@blitz.be', naam: 'Bart', sessieVersie: 1 })] });
  const c = await registreer(o.h);
  const { consent } = await toestemmingsPagina(o, c.client_id);
  const [payload, sig] = consent.split('.');
  const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert.equal(p.r, REDIRECT); // het payload draagt de redirect_uri in veld r
  // domeinscheiding: de handtekening is NIET de HMAC van het sessietoken-formaat (zelfde SESSIE_GEHEIM)
  assert.notEqual(sig, createHmac('sha256', GEHEIM).update(payload).digest('base64url'));
  const gewijzigd = Buffer.from(JSON.stringify({ ...p, r: 'http://localhost:9999/cb' })).toString('base64url') + '.' + sig;
  const gevallen = [
    [{ consent: 'vervalst.handtekening', keuze: 'toestaan' }, o.cookie()],
    [{ consent: payload + '.' + 'A'.repeat(sig.length), keuze: 'toestaan' }, o.cookie()],
    [{ consent: gewijzigd, keuze: 'toestaan' }, o.cookie()],
    [{ keuze: 'toestaan' }, o.cookie()],
    [{ consent, keuze: 'toestaan' }, o.cookie('u2', 1)], // andere gebruiker
    [{ consent, keuze: 'toestaan' }, undefined],          // geen sessie
    [{ consent, keuze: 'iets' }, o.cookie()],             // onbekende keuze
  ];
  for (const [velden, ck] of gevallen) {
    const r = await postForm(o.h, '/api/mcp-oauth/authorize', velden, ck ? { cookie: ck } : {});
    assert.equal(r.status, 403, JSON.stringify(velden));
    assert.equal(r.headers.get('location'), null);
  }
  // verlopen: meer dan 10 minuten later
  o.klok.nu = T0 + 10 * 60 * 1000 + 1;
  const r = await postForm(o.h, '/api/mcp-oauth/authorize', { consent, keuze: 'toestaan' }, { cookie: o.cookie() });
  assert.equal(r.status, 403);
  assert.equal((await o.store.list({ prefix: 'mcp-code-' })).blobs.length, 0);
});

test('POST authorize: het consent-veld is geen geldig sessiecookie (domeinscheiding van de HMAC)', async () => {
  const o = opzet();
  const c = await registreer(o.h);
  const { consent } = await toestemmingsPagina(o, c.client_id);
  const r = await get(o.h, '/api/mcp-oauth/authorize', authParams(c.client_id), { cookie: `blitz_sessie=${consent}` });
  const html = await r.text();
  assert.ok(html.includes('/api/auth-login'), 'consent-veld als cookie mag niet als ingelogd tellen');
  assert.ok(!html.includes('name="consent"'));
});

test('POST authorize: wachtwoord gewijzigd (sessieVersie verhoogd) na het tonen van de pagina -> 403', async () => {
  const o = opzet();
  const c = await registreer(o.h);
  const { consent } = await toestemmingsPagina(o, c.client_id);
  const b = await o.store.get('gebruikers', { type: 'json' });
  b.gebruikers[0].sessieVersie = 4;
  await o.store.setJSON('gebruikers', b);
  const r = await postForm(o.h, '/api/mcp-oauth/authorize', { consent, keuze: 'toestaan' }, { cookie: o.cookie('u1', 4) });
  assert.equal(r.status, 403);
});

// ---- volledige flow + token ----
async function codeVia(o, clientId) {
  const { consent } = await toestemmingsPagina(o, clientId);
  const r = await postForm(o.h, '/api/mcp-oauth/authorize', { consent, keuze: 'toestaan' }, { cookie: o.cookie() });
  return new URL(r.headers.get('location')).searchParams.get('code');
}

test('volledige flow register -> authorize -> token (form-urlencoded) geeft een bruikbare access token; no-store en CORS voor claude.ai', async () => {
  const o = opzet();
  const c = await registreer(o.h);
  const code = await codeVia(o, c.client_id);
  const r = await postForm(o.h, '/api/mcp-oauth/token', {
    grant_type: 'authorization_code', code, client_id: c.client_id, redirect_uri: REDIRECT, code_verifier: VERIFIER,
  }, { origin: 'https://claude.ai' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://claude.ai');
  const t = await r.json();
  assert.equal(t.token_type, 'Bearer');
  assert.equal(t.expires_in, 3600);
  const toegang = await zoekToegang(o.store, t.access_token, T0 + 1000);
  assert.notEqual(toegang, null);
  assert.equal(toegang.uid, 'u1');
  assert.equal(toegang.sessieVersie, 3);
  assert.equal(toegang.clientId, c.client_id);

  // refresh, nu als JSON
  const v = await postJson(o.h, '/api/mcp-oauth/token', { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: c.client_id });
  assert.equal(v.status, 200);
  const t2 = await v.json();
  assert.ok(t2.access_token && t2.access_token !== t.access_token);
  // hetzelfde refresh token een tweede keer: invalid_grant
  const v2 = await postJson(o.h, '/api/mcp-oauth/token', { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: c.client_id });
  assert.equal(v2.status, 400);
  assert.deepEqual(await v2.json(), { error: 'invalid_grant' });
});

test('token: hergebruikte code en foute PKCE-verifier geven invalid_grant; de code is na één poging weg', async () => {
  const o = opzet();
  const c = await registreer(o.h);
  const wissel = (code, verifier = VERIFIER) => postForm(o.h, '/api/mcp-oauth/token', {
    grant_type: 'authorization_code', code, client_id: c.client_id, redirect_uri: REDIRECT, code_verifier: verifier,
  });
  const code1 = await codeVia(o, c.client_id);
  assert.equal((await wissel(code1)).status, 200);
  const herhaal = await wissel(code1);
  assert.equal(herhaal.status, 400);
  assert.deepEqual(await herhaal.json(), { error: 'invalid_grant' });
  assert.equal(herhaal.headers.get('cache-control'), 'no-store');

  const code2 = await codeVia(o, c.client_id);
  const fout = await wissel(code2, 'verkeerde-verifier-'.repeat(3));
  assert.equal(fout.status, 400);
  assert.deepEqual(await fout.json(), { error: 'invalid_grant' });
  assert.equal((await wissel(code2)).status, 400, 'code moet na de mislukte poging weg zijn');
});

test('token: onbekend grant_type 400 unsupported_grant_type; ontbrekende velden 400 invalid_request; GET 405; te grote body 400', async () => {
  const o = opzet();
  const r = await postForm(o.h, '/api/mcp-oauth/token', { grant_type: 'password', username: 'a', password: 'b' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'unsupported_grant_type');
  const r2 = await postForm(o.h, '/api/mcp-oauth/token', { grant_type: 'authorization_code', code: 'x' });
  assert.equal(r2.status, 400);
  assert.equal((await r2.json()).error, 'invalid_request');
  assert.equal((await get(o.h, '/api/mcp-oauth/token')).status, 405);
  const r3 = await postForm(o.h, '/api/mcp-oauth/token', { grant_type: 'refresh_token', refresh_token: 'x'.repeat(11 * 1024), client_id: 'c' });
  assert.equal(r3.status, 400);
});
