// Karakterisering van plan, plan-datum en comment (etappe 6, taak 4).
// Elke test controleert de VOLLEDIGE lijst uitgaande aanroepen en het volledige antwoord
// (een onbekende URL geeft stil 404 {}). Nooit echte netwerkaanroepen.
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, v1Event, zetEnv } from './nep-fetch.mjs';

const NU = Date.parse('2026-10-01T10:00:00.000Z');
const CORS_V1 = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
// plan-datum (v2): basisset zonder Content-Type, JSON-antwoorden krijgen hem erbij.
const CORS_V2_BASIS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};
const CORS_V2_JSON = { ...CORS_V2_BASIS, 'content-type': 'application/json' };
const DESK = 'https://desk.zoho.eu/api/v1';
const TOKEN_CALL = {
  method: 'POST',
  url: 'https://accounts.zoho.eu/oauth/v2/token',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'refresh_token=RT&client_id=CID&client_secret=SEC&grant_type=refresh_token',
};
const ORG_CALL = { method: 'GET', url: `${DESK}/organizations`, headers: { Authorization: 'Zoho-oauthtoken TOK' }, body: undefined };
const PATCH_HEADERS = { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1', 'Content-Type': 'application/json' };
const patch = (id, body) => ({ method: 'PATCH', url: `${DESK}/tickets/${id}`, headers: PATCH_HEADERS, body: JSON.stringify(body) });

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const uit = calls => calls.map(c => ({ method: c.method, url: c.url, headers: c.headers, body: c.body }));
const ontleed = res => ({ status: res.statusCode, headers: { ...res.headers }, body: JSON.parse(res.body) });
const NETWERKFOUT = () => { throw new Error('netwerk'); };
const SLEUTELS_PATCH = ['Authorization', 'orgId', 'Content-Type'];

let herstelEnv;
test.beforeEach(() => {
  herstelEnv = zetEnv({ ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC' });
  mock.timers.enable({ apis: ['Date'], now: NU });
});
test.afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  herstelEnv();
});

// ---------- gedeelde drivers ----------
async function draaiV1(naam, event, router) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers(naam);
  const res = await metGlobaleFetch(fn, () => mod.handler(event));
  return { res, calls: uit(calls), mod, fn };
}

async function draaiV2(req, router) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers('plan-datum');
  const res = await metGlobaleFetch(fn, () => mod.default(req, {}));
  return { res, calls: uit(calls), mod, fn };
}
const v2Antwoord = async res => ({
  status: res.status,
  headers: Object.fromEntries(res.headers.entries()),
  tekst: await res.text(),
});
const v2Json = async res => {
  const a = await v2Antwoord(res);
  return { status: a.status, headers: a.headers, body: JSON.parse(a.tekst) };
};
const DATUM_REQ = (body, { methode = 'POST', headers = {} } = {}) =>
  new Request('http://localhost/api/plan-datum', {
    method: methode,
    headers,
    body: methode === 'GET' || methode === 'OPTIONS' || methode === 'DELETE'
      ? undefined
      : (typeof body === 'string' ? body : JSON.stringify(body)),
  });

const UTC = '2026-06-22T22:00:00.000Z';

// ======================= plan =======================
const planEvent = (body, headers) => v1Event('POST', body, headers);

test('plan: OPTIONS geeft 204 met de v1-headers, zonder aanvragen', async () => {
  const { res, calls } = await draaiV1('plan', v1Event('OPTIONS'));
  assert.deepEqual(calls, []);
  assert.deepEqual({ status: res.statusCode, headers: res.headers, body: res.body }, { status: 204, headers: CORS_V1, body: undefined });
});

test('plan: verkeerde methode geeft JSON-405', async () => {
  const { res, calls } = await draaiV1('plan', v1Event('GET'));
  assert.deepEqual(calls, []);
  assert.deepEqual(ontleed(res), { status: 405, headers: CORS_V1, body: { error: 'Method not allowed' } });
});

test('plan: validatiefouten (400) zonder aanvragen', async () => {
  for (const [body, fout] of [
    [{}, 'ticketId verplicht'],
    [{ date: '2026-06-23' }, 'ticketId verplicht'],
    [{ ticketId: 'abc', date: '2026-06-23' }, 'Ongeldig ticketId'],
    [{ ticketId: '12a' }, 'Ongeldig ticketId'],
  ]) {
    const { res, calls } = await draaiV1('plan', planEvent(body));
    assert.deepEqual(calls, []);
    assert.deepEqual(ontleed(res), { status: 400, headers: CORS_V1, body: { error: fout } });
  }
  // lege body = {}
  const { res, calls } = await draaiV1('plan', { httpMethod: 'POST', headers: {} });
  assert.deepEqual(calls, []);
  assert.deepEqual(ontleed(res), { status: 400, headers: CORS_V1, body: { error: 'ticketId verplicht' } });
});

test('plan: ongeldige JSON geeft 500 met de parserfout', async () => {
  const { res, calls } = await draaiV1('plan', planEvent('{kapot'));
  assert.deepEqual(calls, []);
  const r = ontleed(res);
  assert.equal(r.status, 500);
  assert.deepEqual(r.headers, CORS_V1);
  assert.match(r.body.error, /JSON/);
});

test('plan: testmodus doet nul aanvragen en geeft nep-succes (na validatie)', async () => {
  const kop = { 'X-Blitz-Test': '1' };
  let r = await draaiV1('plan', planEvent({ ticketId: '123', date: '2026-06-23', utcInterventieDatum: UTC }, kop));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(ontleed(r.res), { status: 200, headers: CORS_V1, body: { ok: true, test: true, success: true, ticketId: '123', date: '2026-06-23' } });

  r = await draaiV1('plan', planEvent({ ticketId: 123 }, kop));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(ontleed(r.res), { status: 200, headers: CORS_V1, body: { ok: true, test: true, success: true, ticketId: 123, date: null } });

  // validatie komt vóór de testmodus-tak
  r = await draaiV1('plan', planEvent({ ticketId: 'x' }, kop));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(ontleed(r.res), { status: 400, headers: CORS_V1, body: { error: 'Ongeldig ticketId' } });
});

test('plan: inplannen met utcInterventieDatum, volledige aanroepenreeks', async () => {
  const { res, calls } = await draaiV1('plan', planEvent({ ticketId: '123', date: '2026-06-23', utcInterventieDatum: UTC }),
    url => url.endsWith('/tickets/123') ? json({ id: '123' }) : undefined);
  assert.deepEqual(calls, [
    TOKEN_CALL, ORG_CALL,
    patch('123', { status: 'Wachten op bevestiging planning', cf: { cf_interventie_datm: UTC } }),
  ]);
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS_V1, body: { success: true, ticketId: '123', date: '2026-06-23' } });
});

test('plan: sleutelvolgorde van de uitgaande Zoho-headers', async () => {
  const { calls } = await draaiV1('plan', planEvent({ ticketId: '123', date: '2026-06-23', utcInterventieDatum: UTC }),
    url => url.endsWith('/tickets/123') ? json({}) : undefined);
  assert.deepEqual(Object.keys(calls[1].headers), ['Authorization']);
  assert.deepEqual(Object.keys(calls[2].headers), SLEUTELS_PATCH);
});

test('plan: zonder utcInterventieDatum valt de datum terug op T00:00:00.000Z', async () => {
  const { res, calls } = await draaiV1('plan', planEvent({ ticketId: 123, date: '2026-06-23' }),
    url => url.endsWith('/tickets/123') ? json({}) : undefined);
  assert.deepEqual(calls, [
    TOKEN_CALL, ORG_CALL,
    patch(123, { status: 'Wachten op bevestiging planning', cf: { cf_interventie_datm: '2026-06-23T00:00:00.000Z' } }),
  ]);
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS_V1, body: { success: true, ticketId: 123, date: '2026-06-23' } });
});

test('plan: zonder datum gaat het ticket terug naar Wachten op planning', async () => {
  for (const body of [{ ticketId: '123', date: null }, { ticketId: '123' }, { ticketId: '123', date: '', utcInterventieDatum: UTC }]) {
    const { res, calls } = await draaiV1('plan', planEvent(body), url => url.endsWith('/tickets/123') ? json({}) : undefined);
    assert.deepEqual(calls, [
      TOKEN_CALL, ORG_CALL,
      patch('123', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }),
    ]);
    assert.deepEqual(ontleed(res), { status: 200, headers: CORS_V1, body: { success: true, ticketId: '123', date: null } });
  }
});

test('plan: lege PATCH-body (204 of leeg 200) en niet-JSON 200 zijn succes', async () => {
  for (const antwoord of [() => new Response(null, { status: 204 }), () => new Response('', { status: 200 }), () => new Response('geen json', { status: 200 })]) {
    const { res, calls } = await draaiV1('plan', planEvent({ ticketId: '123', date: null }),
      url => url.endsWith('/tickets/123') ? antwoord() : undefined);
    assert.equal(calls.length, 3);
    assert.deepEqual(ontleed(res), { status: 200, headers: CORS_V1, body: { success: true, ticketId: '123', date: null } });
  }
});

test('plan: PATCH-fout geeft 500 met status en geparste body; niet-JSON foutbody wordt {}', async () => {
  let r = await draaiV1('plan', planEvent({ ticketId: '123', date: null }),
    url => url.endsWith('/tickets/123') ? json({ errorCode: 'X', message: 'nee' }, 422) : undefined);
  assert.equal(r.calls.length, 3);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Zoho fout (422): {"errorCode":"X","message":"nee"}' } });

  r = await draaiV1('plan', planEvent({ ticketId: '123', date: null }),
    url => url.endsWith('/tickets/123') ? new Response('<html>boem</html>', { status: 502 }) : undefined);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Zoho fout (502): {}' } });

  r = await draaiV1('plan', planEvent({ ticketId: '123', date: null }),
    url => url.endsWith('/tickets/123') ? new Response(null, { status: 500 }) : undefined);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Zoho fout (500): {}' } });
});

test('plan: tokenfout, org zonder id en netwerkfouten', async () => {
  let r = await draaiV1('plan', planEvent({ ticketId: '123', date: null }),
    url => url.includes('oauth/v2/token') ? json({ error: 'invalid_code' }) : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Token refresh mislukt: {"error":"invalid_code"}' } });

  r = await draaiV1('plan', planEvent({ ticketId: '123', date: null }),
    url => url.endsWith('/organizations') ? json({ data: [] }) : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Zoho org ID niet gevonden' } });

  r = await draaiV1('plan', planEvent({ ticketId: '123', date: null }),
    url => url.includes('oauth/v2/token') ? NETWERKFOUT() : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'netwerk' } });

  r = await draaiV1('plan', planEvent({ ticketId: '123', date: null }),
    url => url.endsWith('/organizations') ? NETWERKFOUT() : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'netwerk' } });

  r = await draaiV1('plan', planEvent({ ticketId: '123', date: null }),
    url => url.endsWith('/tickets/123') ? NETWERKFOUT() : undefined);
  assert.equal(r.calls.length, 3);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'netwerk' } });
});

test('plan: token wordt binnen één geladen module hergebruikt, het org-id niet; na 55 minuten komt een nieuw token', async () => {
  const { fn, calls } = maakNepFetch(url => url.endsWith('/tickets/123') ? json({}) : undefined);
  const mod = await laadVers('plan');
  await metGlobaleFetch(fn, async () => {
    await mod.handler(planEvent({ ticketId: '123', date: null }));
    await mod.handler(planEvent({ ticketId: '123', date: null }));
    mock.timers.tick(54 * 60 * 1000);
    await mod.handler(planEvent({ ticketId: '123', date: null }));
    mock.timers.tick(2 * 60 * 1000);
    await mod.handler(planEvent({ ticketId: '123', date: null }));
  });
  const P = patch('123', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } });
  assert.deepEqual(uit(calls), [
    TOKEN_CALL, ORG_CALL, P,
    ORG_CALL, P,
    ORG_CALL, P,
    TOKEN_CALL, ORG_CALL, P,
  ]);
});

// ======================= plan-datum =======================
test('plan-datum: OPTIONS geeft 204 met de basisset, zonder Content-Type', async () => {
  const { res, calls } = await draaiV2(DATUM_REQ(undefined, { methode: 'OPTIONS' }));
  assert.deepEqual(calls, []);
  assert.deepEqual(await v2Antwoord(res), { status: 204, headers: CORS_V2_BASIS, tekst: '' });
});

test('plan-datum: verkeerde methode geeft 405 als tekst met de basisset', async () => {
  for (const methode of ['GET', 'PUT', 'DELETE']) {
    const { res, calls } = await draaiV2(DATUM_REQ('x', { methode }));
    assert.deepEqual(calls, []);
    const a = await v2Antwoord(res);
    assert.equal(a.status, 405);
    assert.equal(a.tekst, 'Method Not Allowed');
    // Response met stringbody voegt zelf text/plain toe
    assert.deepEqual(a.headers, { ...CORS_V2_BASIS, 'content-type': 'text/plain;charset=UTF-8' });
  }
});

test('plan-datum: validatiefouten (400) zonder aanvragen', async () => {
  for (const [body, fout] of [
    ['{kapot', 'Ongeldige JSON'],
    ['', 'Ongeldige JSON'],
    [{}, 'ticketId en utcInterventieDatum zijn verplicht'],
    [{ ticketId: '123' }, 'ticketId en utcInterventieDatum zijn verplicht'],
    [{ utcInterventieDatum: UTC }, 'ticketId en utcInterventieDatum zijn verplicht'],
    [{ ticketId: 'abc', utcInterventieDatum: UTC }, 'Ongeldig ticketId'],
  ]) {
    const { res, calls } = await draaiV2(DATUM_REQ(body));
    assert.deepEqual(calls, []);
    assert.deepEqual(await v2Json(res), { status: 400, headers: CORS_V2_JSON, body: { error: fout } });
  }
});

test('plan-datum: testmodus doet nul aanvragen en geeft nep-succes (na validatie)', async () => {
  const kop = { 'X-Blitz-Test': '1' };
  let r = await draaiV2(DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC }, { headers: kop }));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(await v2Json(r.res), { status: 200, headers: CORS_V2_JSON, body: { ok: true, test: true, interventieDatum: UTC } });

  r = await draaiV2(DATUM_REQ({ ticketId: 'x', utcInterventieDatum: UTC }, { headers: kop }));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(await v2Json(r.res), { status: 400, headers: CORS_V2_JSON, body: { error: 'Ongeldig ticketId' } });
});

test('plan-datum: succes, volledige aanroepenreeks en antwoord', async () => {
  const { res, calls } = await draaiV2(DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC }),
    url => url.endsWith('/tickets/123') ? json({ id: '123' }) : undefined);
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, patch('123', { cf: { cf_interventie_datm: UTC } })]);
  assert.deepEqual(await v2Json(res), { status: 200, headers: CORS_V2_JSON, body: { ok: true, interventieDatum: UTC } });
});

test('plan-datum: sleutelvolgorde van de uitgaande Zoho-headers', async () => {
  const { calls } = await draaiV2(DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC }),
    url => url.endsWith('/tickets/123') ? json({}) : undefined);
  assert.deepEqual(Object.keys(calls[1].headers), ['Authorization']);
  assert.deepEqual(Object.keys(calls[2].headers), SLEUTELS_PATCH);
});

test('plan-datum: een lege of niet-JSON 200-body bij PATCH blijft succes (body wordt niet gelezen)', async () => {
  for (const antwoord of [() => new Response(null, { status: 204 }), () => new Response('geen json', { status: 200 })]) {
    const { res } = await draaiV2(DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC }),
      url => url.endsWith('/tickets/123') ? antwoord() : undefined);
    assert.deepEqual(await v2Json(res), { status: 200, headers: CORS_V2_JSON, body: { ok: true, interventieDatum: UTC } });
  }
});

test('plan-datum: PATCH-fout geeft 500 met de ruwe tekst, ook niet-JSON en leeg', async () => {
  let r = await draaiV2(DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC }),
    url => url.endsWith('/tickets/123') ? new Response('ruwe fout <b>', { status: 422 }) : undefined);
  assert.equal(r.calls.length, 3);
  assert.deepEqual(await v2Json(r.res), { status: 500, headers: CORS_V2_JSON, body: { error: 'Zoho PATCH fout (422): ruwe fout <b>' } });

  r = await draaiV2(DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC }),
    url => url.endsWith('/tickets/123') ? json({ message: 'nee' }, 400) : undefined);
  assert.deepEqual(await v2Json(r.res), { status: 500, headers: CORS_V2_JSON, body: { error: 'Zoho PATCH fout (400): {"message":"nee"}' } });

  r = await draaiV2(DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC }),
    url => url.endsWith('/tickets/123') ? new Response(null, { status: 500 }) : undefined);
  assert.deepEqual(await v2Json(r.res), { status: 500, headers: CORS_V2_JSON, body: { error: 'Zoho PATCH fout (500): ' } });
});

test('plan-datum: tokenfout, org zonder id en netwerkfouten', async () => {
  const req = () => DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC });
  const fout = (status, error) => ({ status, headers: CORS_V2_JSON, body: { error } });
  let r = await draaiV2(req(), url => url.includes('oauth/v2/token') ? json({ error: 'invalid_code' }) : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(await v2Json(r.res), fout(500, 'Token refresh mislukt: {"error":"invalid_code"}'));

  r = await draaiV2(req(), url => url.endsWith('/organizations') ? json({ data: [] }) : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(await v2Json(r.res), fout(500, 'Zoho org ID niet gevonden'));

  r = await draaiV2(req(), url => url.includes('oauth/v2/token') ? NETWERKFOUT() : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(await v2Json(r.res), fout(500, 'netwerk'));

  r = await draaiV2(req(), url => url.endsWith('/organizations') ? NETWERKFOUT() : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(await v2Json(r.res), fout(500, 'netwerk'));

  r = await draaiV2(req(), url => url.endsWith('/tickets/123') ? NETWERKFOUT() : undefined);
  assert.equal(r.calls.length, 3);
  assert.deepEqual(await v2Json(r.res), fout(500, 'netwerk'));
});

test('plan-datum: token wordt binnen één geladen module hergebruikt, het org-id niet', async () => {
  const { fn, calls } = maakNepFetch(url => url.endsWith('/tickets/123') ? json({}) : undefined);
  const mod = await laadVers('plan-datum');
  await metGlobaleFetch(fn, async () => {
    await mod.default(DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC }), {});
    await mod.default(DATUM_REQ({ ticketId: '123', utcInterventieDatum: UTC }), {});
  });
  const P = patch('123', { cf: { cf_interventie_datm: UTC } });
  assert.deepEqual(uit(calls), [TOKEN_CALL, ORG_CALL, P, ORG_CALL, P]);
});

test('plan-datum: config-pad blijft /api/plan-datum', async () => {
  const mod = await laadVers('plan-datum');
  assert.deepEqual(mod.config, { path: '/api/plan-datum' });
});

// ======================= comment =======================
const commentEvent = (body, headers) => v1Event('POST', body, headers);

test('comment: OPTIONS geeft 204 met de v1-headers, zonder aanvragen', async () => {
  const { res, calls } = await draaiV1('comment', v1Event('OPTIONS'));
  assert.deepEqual(calls, []);
  assert.deepEqual({ status: res.statusCode, headers: res.headers, body: res.body }, { status: 204, headers: CORS_V1, body: undefined });
});

test('comment: verkeerde methode geeft JSON-405', async () => {
  const { res, calls } = await draaiV1('comment', v1Event('GET'));
  assert.deepEqual(calls, []);
  assert.deepEqual(ontleed(res), { status: 405, headers: CORS_V1, body: { error: 'Method not allowed' } });
});

test('comment: validatiefouten (400) zonder aanvragen', async () => {
  for (const [body, fout] of [
    [{}, 'ticketId and content required'],
    [{ ticketId: '123' }, 'ticketId and content required'],
    [{ ticketId: '123', content: '   ' }, 'ticketId and content required'],
    [{ content: 'tekst' }, 'ticketId and content required'],
    [{ ticketId: 'abc', content: 'tekst' }, 'Invalid ticketId'],
  ]) {
    const { res, calls } = await draaiV1('comment', commentEvent(body));
    assert.deepEqual(calls, []);
    assert.deepEqual(ontleed(res), { status: 400, headers: CORS_V1, body: { error: fout } });
  }
  const { res, calls } = await draaiV1('comment', { httpMethod: 'POST', headers: {} });
  assert.deepEqual(calls, []);
  assert.deepEqual(ontleed(res), { status: 400, headers: CORS_V1, body: { error: 'ticketId and content required' } });
});

test('comment: ongeldige JSON geeft 500 met de parserfout', async () => {
  const { res, calls } = await draaiV1('comment', commentEvent('{kapot'));
  assert.deepEqual(calls, []);
  const r = ontleed(res);
  assert.equal(r.status, 500);
  assert.deepEqual(r.headers, CORS_V1);
  assert.match(r.body.error, /JSON/);
});

test('comment: testmodus doet nul aanvragen en geeft nep-succes (na validatie)', async () => {
  const kop = { 'X-Blitz-Test': '1' };
  let r = await draaiV1('comment', commentEvent({ ticketId: '123', content: 'tekst' }, kop));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(ontleed(r.res), { status: 200, headers: CORS_V1, body: { ok: true, test: true, success: true } });

  r = await draaiV1('comment', commentEvent({ ticketId: 'x', content: 'tekst' }, kop));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(ontleed(r.res), { status: 400, headers: CORS_V1, body: { error: 'Invalid ticketId' } });
});

test('comment: succes met getrimde tekst, volledige aanroepenreeks', async () => {
  const { res, calls } = await draaiV1('comment', commentEvent({ ticketId: '123', content: '  Opgelost "ok"\n ' }),
    url => url.endsWith('/tickets/123') ? json({ id: '123' }) : undefined);
  assert.deepEqual(calls, [TOKEN_CALL, ORG_CALL, patch('123', { resolution: 'Opgelost "ok"' })]);
  assert.deepEqual(Object.keys(calls[1].headers), ['Authorization']);
  assert.deepEqual(Object.keys(calls[2].headers), SLEUTELS_PATCH);
  assert.deepEqual(ontleed(res), { status: 200, headers: CORS_V1, body: { success: true } });
});

test('comment: PATCH-fout geeft 500 met status en gestringifyde body (Z11 bugfix, W5)', async () => {
  const r = await draaiV1('comment', commentEvent({ ticketId: '123', content: 'x' }),
    url => url.endsWith('/tickets/123') ? json({ errorCode: 'X', message: 'nee' }, 422) : undefined);
  assert.equal(r.calls.length, 3);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Zoho fout (422): {"errorCode":"X","message":"nee"}' } });
});

// Z11 bugfix (W5): lege of niet-JSON PATCH-body is geen fout meer; succes volgt res.ok.
test('comment: lege PATCH-body (204 of leeg 200) geeft succes', async () => {
  for (const antwoord of [() => new Response(null, { status: 204 }), () => new Response('', { status: 200 })]) {
    const r = await draaiV1('comment', commentEvent({ ticketId: '123', content: 'x' }),
      url => url.endsWith('/tickets/123') ? antwoord() : undefined);
    assert.equal(r.calls.length, 3);
    assert.deepEqual(ontleed(r.res), { status: 200, headers: CORS_V1, body: { success: true } });
  }
});

// Z11 bugfix (W5): een 502 met HTML-body blijft een fout; de losse parse levert {}, de tekst noemt de status.
test('comment: 502 met HTML-body geeft 500 met tekst Zoho fout (502): {}', async () => {
  const r = await draaiV1('comment', commentEvent({ ticketId: '123', content: 'x' }),
    url => url.endsWith('/tickets/123') ? new Response('<html>', { status: 502 }) : undefined);
  assert.equal(r.calls.length, 3);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Zoho fout (502): {}' } });
});

test('comment: 400 met JSON-foutbody noemt status en body', async () => {
  const r = await draaiV1('comment', commentEvent({ ticketId: '123', content: 'x' }),
    url => url.endsWith('/tickets/123') ? json({ errorCode: 'X' }, 400) : undefined);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Zoho fout (400): {"errorCode":"X"}' } });
});

test('comment: tokenfout, org zonder id (Engelse tekst) en netwerkfouten', async () => {
  const ev = () => commentEvent({ ticketId: '123', content: 'x' });
  let r = await draaiV1('comment', ev(), url => url.includes('oauth/v2/token') ? json({ error: 'invalid_code' }) : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Token refresh mislukt: {"error":"invalid_code"}' } });

  r = await draaiV1('comment', ev(), url => url.endsWith('/organizations') ? json({ data: [] }) : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'Could not find Zoho Desk org ID' } });

  r = await draaiV1('comment', ev(), url => url.includes('oauth/v2/token') ? NETWERKFOUT() : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'netwerk' } });

  r = await draaiV1('comment', ev(), url => url.endsWith('/organizations') ? NETWERKFOUT() : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'netwerk' } });

  r = await draaiV1('comment', ev(), url => url.endsWith('/tickets/123') ? NETWERKFOUT() : undefined);
  assert.equal(r.calls.length, 3);
  assert.deepEqual(ontleed(r.res), { status: 500, headers: CORS_V1, body: { error: 'netwerk' } });
});

test('comment: token wordt binnen één geladen module hergebruikt, het org-id niet', async () => {
  const { fn, calls } = maakNepFetch(url => url.endsWith('/tickets/123') ? json({}) : undefined);
  const mod = await laadVers('comment');
  await metGlobaleFetch(fn, async () => {
    await mod.handler(commentEvent({ ticketId: '123', content: 'x' }));
    await mod.handler(commentEvent({ ticketId: '123', content: 'x' }));
  });
  const P = patch('123', { resolution: 'x' });
  assert.deepEqual(uit(calls), [TOKEN_CALL, ORG_CALL, P, ORG_CALL, P]);
});
