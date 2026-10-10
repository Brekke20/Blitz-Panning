import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, zetEnv } from './nep-fetch.mjs';
import { maakZoho, leesJsonVeilig, ZOHO_ACCOUNTS, ZOHO_DESK, globaleFetch } from '../netlify/lib/zoho.js';

const ENV = { ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'CS' };
const tokenCalls = c => c.filter(x => x.url === ZOHO_ACCOUNTS);

test('constanten', () => {
  assert.equal(ZOHO_ACCOUNTS, 'https://accounts.zoho.eu/oauth/v2/token');
  assert.equal(ZOHO_DESK, 'https://desk.zoho.eu/api/v1');
});

test('haalToken: exact een POST met vier velden in volgorde', async () => {
  const herstel = zetEnv(ENV);
  try {
    const { fn, calls } = maakNepFetch();
    const z = maakZoho({ fetch: fn });
    assert.equal(await z.haalToken(), 'TOK');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      url: ZOHO_ACCOUNTS,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'refresh_token=RT&client_id=CID&client_secret=CS&grant_type=refresh_token',
    });
  } finally { herstel(); }
});

test('haalToken: env wordt bij de aanroep gelezen', async () => {
  const { fn, calls } = maakNepFetch();
  const z = maakZoho({ fetch: fn });
  const herstel = zetEnv({ ...ENV, ZOHO_CLIENT_ID: 'LATER' });
  try {
    await z.haalToken();
    assert.match(calls[0].body, /client_id=LATER/);
  } finally { herstel(); }
});

test('haalToken: cache 55 minuten in de instantie', async () => {
  const herstel = zetEnv(ENV);
  try {
    const { fn, calls } = maakNepFetch();
    let t = 1_000_000;
    const z = maakZoho({ fetch: fn, nu: () => t });
    await z.haalToken();
    t += 55 * 60 * 1000 - 1;
    await z.haalToken();
    assert.equal(tokenCalls(calls).length, 1);
    t += 1;
    await z.haalToken();
    assert.equal(tokenCalls(calls).length, 2);
  } finally { herstel(); }
});

test('twee instanties halen elk een eigen token (geen module-state)', async () => {
  const herstel = zetEnv(ENV);
  try {
    const { fn, calls } = maakNepFetch();
    await maakZoho({ fetch: fn }).haalToken();
    await maakZoho({ fetch: fn }).haalToken();
    assert.equal(tokenCalls(calls).length, 2);
  } finally { herstel(); }
});

test('haalToken: fout met en zonder data', async () => {
  const herstel = zetEnv(ENV);
  try {
    const router = u => u === ZOHO_ACCOUNTS ? new Response(JSON.stringify({ error: 'invalid_code' })) : undefined;
    const a = maakNepFetch(router);
    await assert.rejects(maakZoho({ fetch: a.fn }).haalToken(),
      { message: 'Token refresh mislukt: {"error":"invalid_code"}' });
    const b = maakNepFetch(router);
    await assert.rejects(maakZoho({ fetch: b.fn, tokenFoutMetData: false }).haalToken(),
      { message: 'Token refresh mislukt' });
  } finally { herstel(); }
});

test('haalOrgId: GET met enkel Authorization, niet gecachet', async () => {
  const { fn, calls } = maakNepFetch();
  const z = maakZoho({ fetch: fn });
  assert.equal(await z.haalOrgId('TOK'), 'ORG1');
  assert.equal(await z.haalOrgId('TOK'), 'ORG1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, ZOHO_DESK + '/organizations');
  assert.equal(calls[0].method, 'GET');
  assert.deepEqual(calls[0].headers, { Authorization: 'Zoho-oauthtoken TOK' });
  assert.equal(calls[0].body, undefined);
});

test('haalOrgId: geen opties.method meegegeven', async () => {
  const opties = [];
  const z = maakZoho({ fetch: async (u, o) => { opties.push(o); return new Response('{"data":[{"id":"X"}]}'); } });
  await z.haalOrgId('T');
  assert.deepEqual(Object.keys(opties[0]), ['headers']);
  assert.deepEqual(Object.keys(opties[0].headers), ['Authorization']);
});

test('haalOrgId: fouttekst uit orgFoutTekst', async () => {
  const leeg = maakNepFetch(u => u.endsWith('/organizations') ? new Response('{"data":[]}') : undefined);
  await assert.rejects(maakZoho({ fetch: leeg.fn }).haalOrgId('T'), { message: 'Zoho org ID niet gevonden' });
  await assert.rejects(maakZoho({ fetch: leeg.fn, orgFoutTekst: 'Could not find Zoho Desk org ID' }).haalOrgId('T'),
    { message: 'Could not find Zoho Desk org ID' });
});

test('haalToegang: token dan org', async () => {
  const herstel = zetEnv(ENV);
  try {
    const { fn, calls } = maakNepFetch();
    const r = await maakZoho({ fetch: fn }).haalToegang();
    assert.deepEqual(r, { token: 'TOK', orgId: 'ORG1' });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, ZOHO_ACCOUNTS);
    assert.equal(calls[1].url, ZOHO_DESK + '/organizations');
  } finally { herstel(); }
});

test('headers: sleutelvolgorde en voorwaarden', () => {
  const z = maakZoho({ fetch: () => {} });
  assert.deepEqual(Object.entries(z.headers('T')), [['Authorization', 'Zoho-oauthtoken T']]);
  assert.deepEqual(Object.entries(z.headers('T', 'O')),
    [['Authorization', 'Zoho-oauthtoken T'], ['orgId', 'O']]);
  assert.deepEqual(Object.entries(z.headers('T', 'O', { json: true })),
    [['Authorization', 'Zoho-oauthtoken T'], ['orgId', 'O'], ['Content-Type', 'application/json']]);
  assert.deepEqual(Object.entries(z.headers('T', undefined, { json: true })),
    [['Authorization', 'Zoho-oauthtoken T'], ['Content-Type', 'application/json']]);
});

test('verzoek: PATCH met json', async () => {
  const { fn, calls } = maakNepFetch(() => new Response('{}'));
  const z = maakZoho({ fetch: fn });
  const res = await z.verzoek('/tickets/1', { token: 'T', orgId: 'O', methode: 'PATCH', json: { a: 1 } });
  assert.ok(res instanceof Response);
  assert.deepEqual(calls[0], {
    url: ZOHO_DESK + '/tickets/1', method: 'PATCH',
    headers: { Authorization: 'Zoho-oauthtoken T', orgId: 'O', 'Content-Type': 'application/json' },
    body: '{"a":1}',
  });
  assert.deepEqual(Object.keys(calls[0].headers), ['Authorization', 'orgId', 'Content-Type']);
});

test('verzoek: zonder methode geen method-sleutel in de opties', async () => {
  const opties = [];
  const z = maakZoho({ fetch: async (u, o) => { opties.push(o); return new Response('{}'); } });
  await z.verzoek('/tickets', { token: 'T', orgId: 'O' });
  assert.equal('method' in opties[0], false);
  assert.equal('body' in opties[0], false);
  assert.deepEqual(opties[0].headers, { Authorization: 'Zoho-oauthtoken T', orgId: 'O' });
});

test('verzoek: FormData zonder Content-Type', async () => {
  const { fn, calls } = maakNepFetch(() => new Response('{}'));
  const z = maakZoho({ fetch: fn });
  const fd = new FormData();
  fd.append('file', new Blob(['abc'], { type: 'application/pdf' }), 'a.pdf');
  await z.verzoek('/tickets/1/attachments', { token: 'T', orgId: 'O', methode: 'POST', body: fd });
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].headers, { Authorization: 'Zoho-oauthtoken T', orgId: 'O' });
  assert.deepEqual(calls[0].body, [['file', 'a.pdf', 'application/pdf', 3]]);
});

test('verzoek: extra headers worden toegevoegd', async () => {
  const { fn, calls } = maakNepFetch(() => new Response('{}'));
  await maakZoho({ fetch: fn }).verzoek('/x', { token: 'T', orgId: 'O', headers: { 'X-Extra': '1' } });
  assert.equal(calls[0].headers['X-Extra'], '1');
  assert.equal(calls[0].headers.Authorization, 'Zoho-oauthtoken T');
});

test('verzoek: zonder orgId geen orgId-header', async () => {
  const { fn, calls } = maakNepFetch(() => new Response('{}'));
  await maakZoho({ fetch: fn }).verzoek('/x', { token: 'T' });
  assert.deepEqual(calls[0].headers, { Authorization: 'Zoho-oauthtoken T' });
});

test('leesJsonVeilig', async () => {
  assert.deepEqual(await leesJsonVeilig(new Response('')), {});
  assert.deepEqual(await leesJsonVeilig(new Response('<html>')), {});
  assert.deepEqual(await leesJsonVeilig(new Response('{"a":1}')), { a: 1 });
});

test('globaleFetch lost globalThis.fetch bij elke aanroep op', async () => {
  const oud = globalThis.fetch;
  globalThis.fetch = async () => 'NEP';
  try { assert.equal(await globaleFetch('x'), 'NEP'); }
  finally { globalThis.fetch = oud; }
});
