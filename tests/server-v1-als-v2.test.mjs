// Regressie: de v1-functies (event-handler, Lambda-compat) kregen via connectLambda wel een Blobs-context, maar zonder
// uncachedEdgeURL: elke getStore({ consistency: 'strong' }) faalde, de login zag dat als opslagstoring en iedere
// ingelogde gebruiker kreeg 503 'opslag-storing'. Oplossing: alle v1-functies draaien als v2 via de adapter
// (netlify/lib/v2-adapter.js), want enkel een v2-functie krijgt de volledige Blobs-omgeving.
// Nooit echte netwerkaanroepen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { maakNepStore } from './nep-blobs.mjs';
import { maakAuth } from '../netlify/lib/auth.js';
import { beveiligV1 } from '../netlify/lib/beveiligd.js';
import { alsV2, requestNaarEvent, resultaatNaarResponse } from '../netlify/lib/v2-adapter.js';
import { ondertekenToken, COOKIE_NAAM } from '../netlify/lib/sessie-token.js';

const GEHEIM = 'testgeheim-testgeheim';
const NU = Date.parse('2026-10-10T10:00:00.000Z');
const BASIS = 'https://blitz.example';

// ---- requestNaarEvent ----
test('adapter: GET met query geeft httpMethod, kleine-letter-koppen, query (laatste wint) en geen body', async () => {
  const ev = await requestNaarEvent(new Request(`${BASIS}/api/route?a=1&b=x%20y&a=2`, {
    headers: { 'Content-Type': 'application/json', Cookie: 'c=1', 'X-Blitz': '1' },
  }));
  assert.equal(ev.httpMethod, 'GET');
  assert.equal(ev.headers['content-type'], 'application/json');
  assert.equal(ev.headers.cookie, 'c=1');
  assert.equal(ev.headers['x-blitz'], '1');
  assert.equal(Object.keys(ev.headers).every(k => k === k.toLowerCase()), true);
  assert.deepEqual(ev.queryStringParameters, { a: '2', b: 'x y' });
  assert.deepEqual(ev.multiValueQueryStringParameters, { a: ['1', '2'], b: ['x y'] });
  assert.equal(ev.path, '/api/route');
  assert.equal(ev.rawUrl, `${BASIS}/api/route?a=1&b=x%20y&a=2`);
  assert.equal(ev.body, null);
  assert.equal(ev.isBase64Encoded, false);
});

test('adapter: zonder query zijn de query-objecten leeg (geen null)', async () => {
  const ev = await requestNaarEvent(new Request(`${BASIS}/api/setup`));
  assert.deepEqual(ev.queryStringParameters, {});
  assert.deepEqual(ev.multiValueQueryStringParameters, {});
});

for (const methode of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`adapter: ${methode} geeft de body als tekst, nooit base64`, async () => {
    const tekst = JSON.stringify({ naam: 'Zoë', n: 1 });
    const ev = await requestNaarEvent(new Request(`${BASIS}/api/plan`, { method: methode, body: tekst }));
    assert.equal(ev.httpMethod, methode);
    assert.equal(ev.body, tekst);
    assert.equal(ev.isBase64Encoded, false);
  });
}

test('adapter: lege body wordt null; OPTIONS en HEAD hebben geen body', async () => {
  assert.equal((await requestNaarEvent(new Request(`${BASIS}/api/plan`, { method: 'POST', body: '' }))).body, null);
  assert.equal((await requestNaarEvent(new Request(`${BASIS}/api/plan`, { method: 'OPTIONS' }))).httpMethod, 'OPTIONS');
  assert.equal((await requestNaarEvent(new Request(`${BASIS}/api/plan`, { method: 'HEAD' }))).body, null);
});

// ---- resultaatNaarResponse ----
test('adapter: statuscode, koppen en body van het v1-resultaat komen in de Response', async () => {
  const res = resultaatNaarResponse({ statusCode: 201, headers: { 'Content-Type': 'application/json', 'X-Een': '1' }, body: '{"ok":true}' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('x-een'), '1');
  assert.equal(await res.text(), '{"ok":true}');
});

test('adapter: meerdere Set-Cookie-koppen blijven gescheiden (headers-array en multiValueHeaders)', () => {
  const a = resultaatNaarResponse({ statusCode: 200, headers: { 'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'] }, body: '' });
  assert.deepEqual(a.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
  const b = resultaatNaarResponse({ statusCode: 200, headers: { 'X-Een': '1' }, multiValueHeaders: { 'Set-Cookie': ['a=1', 'b=2'], 'x-een': ['dubbel'] }, body: 'x' });
  assert.deepEqual(b.headers.getSetCookie(), ['a=1', 'b=2']);
  assert.equal(b.headers.get('x-een'), '1'); // al aanwezig in `headers`: niet verdubbeld
});

test('adapter: 204 zonder body en een ontbrekende body geven een Response zonder body', async () => {
  const r204 = resultaatNaarResponse({ statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
  assert.equal(r204.status, 204);
  assert.equal(r204.body, null);
  assert.equal(r204.headers.get('access-control-allow-origin'), '*');
  assert.equal(resultaatNaarResponse({ statusCode: 204, body: 'ongewenst' }).status, 204);
  assert.equal(await resultaatNaarResponse({ statusCode: 200 }).text(), '');
});

test('adapter: isBase64Encoded op het resultaat decodeert de body naar bytes', async () => {
  const res = resultaatNaarResponse({ statusCode: 200, isBase64Encoded: true, body: Buffer.from('PDF-inhoud').toString('base64') });
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'PDF-inhoud');
});

test('adapter: een ongeldig resultaat (geen statusCode) wordt een nette 500', async () => {
  for (const slecht of [undefined, null, {}, { statusCode: 'x' }, { statusCode: 99 }, 'tekst']) {
    const res = resultaatNaarResponse(slecht);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Ongeldig antwoord van de functie' });
  }
});

// ---- alsV2 ----
test('alsV2: geeft het event aan de v1-handler, het resultaat als Response, en bewaart .v1', async () => {
  let gezien;
  const v1 = async (event, context) => { gezien = { event, context }; return { statusCode: 202, headers: { 'X-Test': 'ja' }, body: 'ok' }; };
  const v2 = alsV2(v1);
  assert.equal(v2.v1, v1);
  const ctx = { geo: 'x' };
  const res = await v2(new Request(`${BASIS}/api/x?q=1`, { method: 'POST', body: 'tekst', headers: { 'X-Blitz': '1' } }), ctx);
  assert.equal(res.status, 202);
  assert.equal(res.headers.get('x-test'), 'ja');
  assert.equal(await res.text(), 'ok');
  assert.equal(gezien.context, ctx);
  assert.equal(gezien.event.httpMethod, 'POST');
  assert.equal(gezien.event.body, 'tekst');
  assert.equal(gezien.event.headers['x-blitz'], '1');
  assert.equal(gezien.event.queryStringParameters.q, '1');
});

test('alsV2: weigert iets dat geen functie is', () => {
  assert.throws(() => alsV2(undefined), /functie/);
});

// ---- end-to-end: Request -> adapter -> wrapper (echte login, strong consistency) -> kern -> Response ----
const gebruiker = extra => ({
  id: 'u-brent', email: 'brent@blitz.test', naam: 'Brent', rol: 'technieker', zohoNaam: 'Brent Calaerts',
  actief: true, sessieVersie: 1, ...extra,
});

function opzet(g) {
  const store = maakNepStore({ gebruikers: { versie: 1, gebruikers: [g] } });
  const opties = [];
  const getStore = o => { opties.push(o); return store; };
  const auth = maakAuth({ getStore, env: { SESSIE_GEHEIM: GEHEIM }, nu: () => NU });
  const aanroepen = [];
  const handler = alsV2(beveiligV1('tickets', async (event, context, gebr) => {
    aanroepen.push({ event, gebr });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: '{"tickets":[]}' };
  }, { auth }));
  return { handler, aanroepen, opties };
}

const aanvraag = ({ uid = 'u-brent', methode = 'GET', cookie = true } = {}) => {
  const token = ondertekenToken({ uid, sv: 1, exp: Math.floor(NU / 1000) + 3600 }, GEHEIM);
  return new Request(`${BASIS}/api/tickets`, { method: methode, headers: cookie ? { cookie: `${COOKIE_NAAM}=${token}` } : {} });
};

test('end-to-end: ingelogde gebruiker krijgt 200, de login leest de gebruikers met consistency strong', async () => {
  const { handler, aanroepen, opties } = opzet(gebruiker({}));
  const res = await handler(aanvraag(), {});
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), { tickets: [] });
  assert.equal(aanroepen.length, 1);
  assert.equal(aanroepen[0].gebr.rol, 'technieker');
  assert.equal(aanroepen[0].event.httpMethod, 'GET');
  assert.ok(opties.some(o => o.consistency === 'strong'), 'strong consistency gevraagd');
});

test('end-to-end: zonder sessiecookie 401, de kern wordt niet aangeroepen', async () => {
  const { handler, aanroepen } = opzet(gebruiker({}));
  const res = await handler(aanvraag({ cookie: false }), {});
  assert.equal(res.status, 401);
  assert.equal(aanroepen.length, 0);
});

test('end-to-end: OPTIONS wordt door de wrapper beantwoord (204, CORS) en bereikt de kern niet', async () => {
  const { handler, aanroepen } = opzet(gebruiker({}));
  const res = await handler(aanvraag({ methode: 'OPTIONS', cookie: false }), {});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(aanroepen.length, 0);
});

test('end-to-end: een storing in de opslag blijft een 503 opslag-storing (fail-closed), zonder lek', async () => {
  const auth = maakAuth({ getStore: () => { throw new Error('geheim detail'); }, env: { SESSIE_GEHEIM: GEHEIM }, nu: () => NU });
  const handler = alsV2(beveiligV1('tickets', async () => ({ statusCode: 200, body: '{}' }), { auth }));
  const errorOrig = console.error;
  console.error = () => {};
  try {
    const res = await handler(aanvraag(), {});
    assert.equal(res.status, 503);
    const tekst = await res.text();
    assert.equal(JSON.parse(tekst).code, 'opslag-storing');
    assert.ok(!tekst.includes('geheim detail'));
  } finally { console.error = errorOrig; }
});

// ---- bewaking: geen v1-export meer in functies die Blobs raken ----
test('geen enkele functie in netlify/functions exporteert nog een v1-handler, behalve planning-export (raakt geen Blobs)', () => {
  const map = join(import.meta.dirname, '..', 'netlify', 'functions');
  const v1 = readdirSync(map, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.js'))
    .filter(d => /^export\s+(const\s+handler\b|async\s+function\s+handler\b|function\s+handler\b)/m.test(readFileSync(join(map, d.name), 'utf8')))
    .map(d => d.name);
  assert.deepEqual(v1, ['planning-export.js']);
  assert.ok(!/getStore|@netlify\/blobs/.test(readFileSync(join(map, 'planning-export.js'), 'utf8')), 'planning-export raakt geen Blobs');
});

test('de elf omgezette functies exporteren een v2-default met .v1 en geen handler meer', async () => {
  for (const naam of ['tickets', 'route', 'plan', 'propose', 'comment', 'rapport', 'send-rapport', 'optimize', 'matrix', 'drukte', 'setup']) {
    const mod = await import(`../netlify/functions/${naam}.js`);
    assert.equal(typeof mod.default, 'function', naam);
    assert.equal(typeof mod.default.v1, 'function', naam);
    assert.equal(mod.handler, undefined, naam);
  }
});
