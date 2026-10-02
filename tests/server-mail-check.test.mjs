// /api/mail-check (etappe 7, Q1): enkel lezen. Elke test controleert de VOLLEDIGE lijst uitgaande aanroepen:
// token, organizations en GET /tickets/{id}/threads, nooit een schrijfactie. Nooit echte netwerkaanroepen of mails.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, zetEnv } from './nep-fetch.mjs';
import { maakHandler } from '../netlify/functions/mail-check.js';
import { adressenUit, isUitgaandeMail, heeftVerzondenStatus, uitgaandeMails, beoordeel, KLOKMARGE_MS } from '../netlify/lib/mailcontrole.js';

const DESK = 'https://desk.zoho.eu/api/v1';
const SINDS = '2026-10-02T10:00:00.000Z';
const TOKEN_CALL = {
  method: 'POST', url: 'https://accounts.zoho.eu/oauth/v2/token',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'refresh_token=RT&client_id=CID&client_secret=SEC&grant_type=refresh_token',
};
const ORG_CALL = { method: 'GET', url: `${DESK}/organizations`, headers: { Authorization: 'Zoho-oauthtoken TOK' }, body: undefined };
const threadsCall = (id, from = 1) => ({
  method: 'GET', url: `${DESK}/tickets/${id}/threads?from=${from}&limit=100`,
  headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' }, body: undefined,
});
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Blitz-Test',
  'content-type': 'application/json',
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const uit = calls => calls.map(c => ({ method: c.method, url: c.url, headers: c.headers, body: c.body }));
const thread = (over = {}) => ({ id: 't', channel: 'EMAIL', direction: 'out', visibility: 'public', createdTime: '2026-10-02T10:00:30.000Z', to: 'luc@test.be', ...over });
const req = (zoek = {}, opties = {}) => {
  const q = new URLSearchParams({ ticketId: '555', sinds: SINDS });
  for (const [k, v] of Object.entries(zoek)) { if (v === undefined) q.delete(k); else q.set(k, v); }
  return new Request('http://x/api/mail-check?' + q, opties);
};
const antwoordJson = async res => ({ status: res.status, headers: Object.fromEntries(res.headers.entries()), body: JSON.parse(await res.text()) });

async function draai(request, router) {
  const { fn, calls } = maakNepFetch(router);
  const h = maakHandler({ fetch: fn });
  const res = await metGlobaleFetch(async () => { throw new Error('globale fetch verboden'); }, () => h(request));
  return { res, calls: uit(calls) };
}
// Verwachte lijst: token, organizations en één GET per gelezen pagina.
const verwacht = (paginas = 1) => [TOKEN_CALL, ORG_CALL, ...Array.from({ length: paginas }, (_, i) => threadsCall('555', 1 + i * 100))];
const metThreads = (...paginas) => { let n = 0; return url => (url.includes('/threads') ? json({ data: paginas[n++] ?? [] }) : undefined); };

let herstelEnv;
test.beforeEach(() => { herstelEnv = zetEnv({ ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC' }); });
test.afterEach(() => { mock.restoreAll(); herstelEnv(); });

// ------------------------------------------------------------------ zuivere hulp ----
test('adressenUit: haalt adressen uit een to-veld (naam, komma, hoofdletters, dubbels)', () => {
  assert.deepEqual(adressenUit('Luc W <Luc@Test.be>, an@y.be; LUC@test.be'), ['luc@test.be', 'an@y.be']);
  assert.deepEqual(adressenUit(undefined), []);
  assert.deepEqual(adressenUit('geen adres'), []);
});

test('isUitgaandeMail: enkel uitgaand + EMAIL + niet privé + vanaf sinds min de klokmarge', () => {
  const s = Date.parse(SINDS);
  assert.equal(isUitgaandeMail(thread(), s), true);
  assert.equal(isUitgaandeMail(thread({ direction: 'in' }), s), false);
  assert.equal(isUitgaandeMail(thread({ channel: 'WEB' }), s), false);
  assert.equal(isUitgaandeMail(thread({ channel: 'email' }), s), true);
  assert.equal(isUitgaandeMail(thread({ visibility: 'private' }), s), false);
  assert.equal(isUitgaandeMail(thread({ createdTime: new Date(s - KLOKMARGE_MS).toISOString() }), s), true);
  assert.equal(isUitgaandeMail(thread({ createdTime: new Date(s - KLOKMARGE_MS - 1).toISOString() }), s), false);
  assert.equal(isUitgaandeMail(thread({ createdTime: 'nonsens' }), s), false);
  assert.equal(isUitgaandeMail(null, s), false);
});

test('uitgaandeMails en beoordeel: vroegste tijdstip per adres; alle verwachte adressen nodig', () => {
  const s = Date.parse(SINDS);
  const { uitgaand: u, twijfel } = uitgaandeMails([
    thread({ to: 'luc@test.be', createdTime: '2026-10-02T10:02:00.000Z' }),
    thread({ to: 'Luc@test.be', createdTime: '2026-10-02T10:01:00.000Z' }),
    thread({ to: 'an@y.be, bob@z.be', createdTime: '2026-10-02T10:03:00.000Z' }),
  ], s);
  assert.equal(twijfel, false);
  assert.deepEqual(u, [
    { aan: 'luc@test.be', tijdstip: '2026-10-02T10:01:00.000Z' },
    { aan: 'an@y.be', tijdstip: '2026-10-02T10:03:00.000Z' },
    { aan: 'bob@z.be', tijdstip: '2026-10-02T10:03:00.000Z' },
  ]);
  assert.deepEqual(beoordeel([]), { verzonden: false, twijfel: false, tijdstip: null });
  assert.deepEqual(beoordeel(u), { verzonden: true, twijfel: false, tijdstip: '2026-10-02T10:01:00.000Z' });
  assert.deepEqual(beoordeel(u, ['luc@test.be', 'an@y.be']), {
    verzonden: true, twijfel: false, tijdstip: '2026-10-02T10:01:00.000Z',
    ontvangers: { 'luc@test.be': { verzonden: true, tijdstip: '2026-10-02T10:01:00.000Z' }, 'an@y.be': { verzonden: true, tijdstip: '2026-10-02T10:03:00.000Z' } },
  });
  assert.deepEqual(beoordeel(u, ['luc@test.be', 'niet@daar.be']), {
    verzonden: false, twijfel: false, tijdstip: '2026-10-02T10:01:00.000Z',
    ontvangers: { 'luc@test.be': { verzonden: true, tijdstip: '2026-10-02T10:01:00.000Z' }, 'niet@daar.be': { verzonden: false, tijdstip: null } },
  });
  // brede controle: een thread zonder leesbaar adres telt mee als "er is een mail"
  const breed = uitgaandeMails([thread({ to: undefined })], s, { marge: 0 });
  assert.equal(beoordeel(breed.uitgaand, [], breed.twijfel).verzonden, true);
});

test('twijfel: onleesbaar adres bij verwachte ontvangers en een draft- of mislukte status tellen niet mee en maken "niet verzonden" onzeker', () => {
  const s = Date.parse(SINDS);
  // Met verwachte adressen kan een mail zonder leesbaar `to` (ontbrekend, array, object) niet aan een ontvanger toegewezen worden.
  for (const to of [undefined, ['luc@test.be'], { email: 'luc@test.be' }, 'geen adres']) {
    const g = uitgaandeMails([thread({ to })], s, { verwachtAdressen: true });
    assert.deepEqual(g, { uitgaand: [], twijfel: true }, JSON.stringify(to));
    assert.deepEqual(beoordeel(g.uitgaand, ['luc@test.be'], g.twijfel), {
      verzonden: false, twijfel: true, tijdstip: null, ontvangers: { 'luc@test.be': { verzonden: false, tijdstip: null } },
    });
  }
  // Is er daarnaast al een zekere mail naar alle adressen, dan blijft het "verzonden" (geen twijfel meer van belang).
  const g = uitgaandeMails([thread({ to: undefined }), thread({ to: 'luc@test.be' })], s, { verwachtAdressen: true });
  assert.deepEqual(beoordeel(g.uitgaand, ['luc@test.be'], g.twijfel).verzonden, true);
  assert.equal(beoordeel(g.uitgaand, ['luc@test.be'], g.twijfel).twijfel, false);
  // Status: ontbrekend of herkenbaar verzonden telt; DRAFT, FAILED, PENDING en onbekend niet.
  for (const status of [undefined, null, '', 'SUCCESS', 'sent', 'Delivered']) assert.equal(heeftVerzondenStatus({ status }), true, String(status));
  for (const status of ['DRAFT', 'FAILED', 'PENDING', 'iets-anders']) {
    assert.equal(heeftVerzondenStatus({ status }), false, status);
    assert.deepEqual(uitgaandeMails([thread({ status })], s), { uitgaand: [], twijfel: true }, status);
  }
  // Een niet-uitgaande of te oude thread geeft nooit twijfel.
  assert.deepEqual(uitgaandeMails([thread({ status: 'FAILED', direction: 'in' }), thread({ status: 'FAILED', createdTime: '2026-10-02T09:00:00.000Z' })], s), { uitgaand: [], twijfel: false });
});

test('marge: de brede controle telt enkel threads vanaf sinds, de controle per adres telt ook de klokmarge mee', () => {
  const s = Date.parse(SINDS);
  const net = thread({ createdTime: new Date(s - 60 * 1000).toISOString() }); // een minuut vóór sinds
  assert.equal(uitgaandeMails([net], s, { marge: 0 }).uitgaand.length, 0);
  assert.equal(uitgaandeMails([net], s, { marge: KLOKMARGE_MS, verwachtAdressen: true }).uitgaand.length, 1);
  assert.equal(uitgaandeMails([thread({ createdTime: SINDS })], s, { marge: 0 }).uitgaand.length, 1); // precies sinds telt wel
});

// ------------------------------------------------------------------ handler ----
test('mail-check: OPTIONS en niet-GET hebben de CORS-set en doen geen aanroepen', async () => {
  let r = await draai(new Request('http://x/api/mail-check', { method: 'OPTIONS' }));
  assert.deepEqual(r.calls, []);
  assert.equal(r.res.status, 204);
  assert.deepEqual(Object.fromEntries(r.res.headers.entries()), CORS);
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    r = await draai(req({}, { method: m, body: m === 'DELETE' ? undefined : '{}' }));
    assert.deepEqual(r.calls, [], m);
    assert.equal(r.res.status, 405, m);
    assert.equal(await r.res.text(), 'Method Not Allowed');
  }
});

test('mail-check: ongeldige invoer geeft 400 zonder aanroepen', async () => {
  const gevallen = [
    [{ ticketId: undefined }, 'ticketId (numeriek) is verplicht'],
    [{ ticketId: '55a' }, 'ticketId (numeriek) is verplicht'],
    [{ ticketId: '../comments' }, 'ticketId (numeriek) is verplicht'],
    [{ sinds: undefined }, 'sinds (ISO-tijdstip) is verplicht'],
    [{ sinds: 'gisteren' }, 'sinds (ISO-tijdstip) is verplicht'],
    [{ ontvangers: 'geen-adres' }, 'ontvangers moet een lijst van maximaal 10 e-mailadressen zijn'],
    [{ ontvangers: Array.from({ length: 11 }, (_, i) => `a${i}@x.be`).join(',') }, 'ontvangers moet een lijst van maximaal 10 e-mailadressen zijn'],
  ];
  for (const [zoek, fout] of gevallen) {
    const r = await draai(req(zoek));
    assert.deepEqual(r.calls, [], JSON.stringify(zoek));
    assert.deepEqual(await antwoordJson(r.res), { status: 400, headers: CORS, body: { error: fout } });
  }
});

test('mail-check: testmodus raakt Zoho nooit', async () => {
  const r = await draai(req({}, { headers: { 'X-Blitz-Test': '1' } }));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(await antwoordJson(r.res), { status: 200, headers: CORS, body: { ok: true, test: true, verzonden: false, twijfel: false, tijdstip: null, uitgaand: [] } });
});

test('mail-check: verzonden: enkel token, organizations en één GET op threads (nooit een schrijfactie)', async () => {
  const r = await draai(req(), metThreads([
    thread({ direction: 'in', to: undefined, createdTime: '2026-10-02T10:00:10.000Z' }),
    thread({ createdTime: '2026-10-02T10:01:00.000Z' }),
  ]));
  assert.deepEqual(r.calls, verwacht(1));
  assert.deepEqual(await antwoordJson(r.res), {
    status: 200, headers: CORS,
    body: { ok: true, verzonden: true, twijfel: false, tijdstip: '2026-10-02T10:01:00.000Z', uitgaand: [{ aan: 'luc@test.be', tijdstip: '2026-10-02T10:01:00.000Z' }] },
  });
});

test('mail-check: niet verzonden bij oudere mails, inkomende threads, ander kanaal en privé-notities', async () => {
  const r = await draai(req(), metThreads([
    thread({ createdTime: '2026-10-02T09:50:00.000Z' }),
    thread({ direction: 'in' }),
    thread({ channel: 'WEB' }),
    thread({ visibility: 'private' }),
  ]));
  assert.deepEqual(r.calls, verwacht(1));
  assert.deepEqual(await antwoordJson(r.res), { status: 200, headers: CORS, body: { ok: true, verzonden: false, twijfel: false, tijdstip: null, uitgaand: [] } });
});

test('mail-check: 204 zonder body (nog geen threads) is niet verzonden', async () => {
  const r = await draai(req(), url => (url.includes('/threads') ? new Response(null, { status: 204 }) : undefined));
  assert.deepEqual(r.calls, verwacht(1));
  assert.deepEqual((await antwoordJson(r.res)).body, { ok: true, verzonden: false, twijfel: false, tijdstip: null, uitgaand: [] });
});

test('mail-check: ontvangers: per adres, en enkel verzonden als álle adressen een mail kregen', async () => {
  const threads = [thread({ to: 'luc@test.be', createdTime: '2026-10-02T10:01:00.000Z' }), thread({ to: 'An@Y.be', createdTime: '2026-10-02T10:02:00.000Z' })];
  let r = await draai(req({ ontvangers: 'LUC@test.be, an@y.be' }), metThreads(threads));
  assert.deepEqual(r.calls, verwacht(1));
  assert.deepEqual((await antwoordJson(r.res)).body, {
    ok: true, verzonden: true, twijfel: false, tijdstip: '2026-10-02T10:01:00.000Z',
    ontvangers: { 'luc@test.be': { verzonden: true, tijdstip: '2026-10-02T10:01:00.000Z' }, 'an@y.be': { verzonden: true, tijdstip: '2026-10-02T10:02:00.000Z' } },
    uitgaand: [{ aan: 'luc@test.be', tijdstip: '2026-10-02T10:01:00.000Z' }, { aan: 'an@y.be', tijdstip: '2026-10-02T10:02:00.000Z' }],
  });
  r = await draai(req({ ontvangers: 'luc@test.be,bob@z.be' }), metThreads(threads));
  const b = (await antwoordJson(r.res)).body;
  assert.equal(b.verzonden, false);
  assert.deepEqual(b.ontvangers['bob@z.be'], { verzonden: false, tijdstip: null });
  assert.deepEqual(b.ontvangers['luc@test.be'], { verzonden: true, tijdstip: '2026-10-02T10:01:00.000Z' });
});

test('mail-check: pagineert (from=1, 101, ...) tot een kortere pagina en leest enkel', async () => {
  const vol = Array.from({ length: 100 }, (_, i) => thread({ id: 'o' + i, direction: 'in' }));
  const r = await draai(req(), metThreads(vol, [thread({ createdTime: '2026-10-02T10:05:00.000Z' })]));
  assert.deepEqual(r.calls, verwacht(2));
  assert.deepEqual(r.calls.slice(2).map(c => c.url), [`${DESK}/tickets/555/threads?from=1&limit=100`, `${DESK}/tickets/555/threads?from=101&limit=100`]);
  assert.deepEqual((await antwoordJson(r.res)).body, { ok: true, verzonden: true, twijfel: false, tijdstip: '2026-10-02T10:05:00.000Z', uitgaand: [{ aan: 'luc@test.be', tijdstip: '2026-10-02T10:05:00.000Z' }] });
});

test('mail-check: een gevonden mail stopt het pagineren; te veel threads zonder resultaat geeft 502', async () => {
  const vol = n => Array.from({ length: 100 }, (_, i) => thread({ id: `${n}-${i}`, direction: 'in' }));
  let r = await draai(req(), metThreads([...vol('a').slice(1), thread()], vol('b')));
  assert.deepEqual(r.calls, verwacht(1));
  assert.equal((await antwoordJson(r.res)).body.verzonden, true);

  r = await draai(req(), metThreads(vol('a'), vol('b'), vol('c'), vol('d'), vol('e'), vol('f')));
  assert.deepEqual(r.calls, verwacht(5));
  assert.deepEqual(await antwoordJson(r.res), { status: 502, headers: CORS, body: { error: 'Te veel threads om te controleren' } });
});

test('mail-check: foutpaden (404, 5xx van Zoho, token, organizations, netwerk) geven nooit "niet verzonden"', async () => {
  let r = await draai(req(), url => (url.includes('/threads') ? json({ errorCode: 'X' }, 404) : undefined));
  assert.deepEqual(r.calls, verwacht(1));
  assert.deepEqual(await antwoordJson(r.res), { status: 404, headers: CORS, body: { error: 'Ticket niet gevonden' } });

  r = await draai(req(), url => (url.includes('/threads') ? json({}, 503) : undefined));
  assert.deepEqual(r.calls, verwacht(1));
  assert.deepEqual(await antwoordJson(r.res), { status: 502, headers: CORS, body: { error: 'Zoho threads ophalen mislukt (503)' } });

  const stil = mock.method(console, 'error', () => {});
  r = await draai(req(), url => (url.includes('oauth') ? json({ error: 'invalid_code' }) : undefined));
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(await antwoordJson(r.res), { status: 500, headers: CORS, body: { error: 'Token refresh mislukt' } });

  r = await draai(req(), url => (url.endsWith('/organizations') ? json({ data: [] }) : undefined));
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.equal((await antwoordJson(r.res)).status, 500);

  r = await draai(req(), url => { if (url.includes('/threads')) throw new TypeError('fetch failed'); });
  assert.deepEqual(r.calls, verwacht(1));
  assert.deepEqual(await antwoordJson(r.res), { status: 500, headers: CORS, body: { error: 'fetch failed' } });
  assert.equal(stil.mock.callCount(), 3);
});

test('mail-check: onleesbaar `to` met ontvangers geeft twijfel (nooit "niet verzonden"); draft-status ook; de brede controle gebruikt geen marge', async () => {
  let r = await draai(req({ ontvangers: 'luc@test.be' }), metThreads([thread({ to: undefined })]));
  assert.deepEqual(r.calls, verwacht(1));
  assert.deepEqual((await antwoordJson(r.res)).body, {
    ok: true, verzonden: false, twijfel: true, tijdstip: null, uitgaand: [], ontvangers: { 'luc@test.be': { verzonden: false, tijdstip: null } },
  });
  r = await draai(req(), metThreads([thread({ status: 'FAILED' })]));
  assert.deepEqual((await antwoordJson(r.res)).body, { ok: true, verzonden: false, twijfel: true, tijdstip: null, uitgaand: [] });
  // één minuut vóór sinds: telt in de brede controle niet, in de controle per adres wel (klokmarge)
  const net = thread({ createdTime: '2026-10-02T09:59:00.000Z' });
  r = await draai(req(), metThreads([net]));
  assert.deepEqual((await antwoordJson(r.res)).body, { ok: true, verzonden: false, twijfel: false, tijdstip: null, uitgaand: [] });
  r = await draai(req({ ontvangers: 'luc@test.be' }), metThreads([net]));
  assert.equal((await antwoordJson(r.res)).body.verzonden, true);
});

test('mail-check: sinds moet een volledig ISO-tijdstip met zone zijn ("2020", een kale datum of een rommeltekst geven 400)', async () => {
  for (const sinds of ['2020', '2026-10-02', '2026-10-02T10:00', '1', '2026-10-02 10:00:00', 'nu', '2026-10-02T10:00:00']) {
    const r = await draai(req({ sinds }));
    assert.deepEqual(r.calls, [], sinds);
    assert.equal(r.res.status, 400, sinds);
  }
  for (const sinds of ['2026-10-02T10:00:00Z', '2026-10-02T10:00:00.123Z', '2026-10-02T12:00:00+02:00', '2026-10-02T10:00Z']) {
    const r = await draai(req({ sinds }), metThreads([]));
    assert.equal(r.res.status, 200, sinds);
  }
});

test('mail-check: paginacap met ontvangers die maar deels gevonden zijn geeft 502 (geen uitspraak over de rest)', async () => {
  const vol = n => Array.from({ length: 100 }, (_, i) => thread({ id: `${n}-${i}`, direction: 'in' }));
  const eerste = [...vol('a').slice(1), thread({ to: 'luc@test.be' })];
  const r = await draai(req({ ontvangers: 'luc@test.be,an@y.be' }), metThreads(eerste, vol('b'), vol('c'), vol('d'), vol('e'), vol('f')));
  assert.deepEqual(r.calls, verwacht(5));
  assert.deepEqual(await antwoordJson(r.res), { status: 502, headers: CORS, body: { error: 'Te veel threads om te controleren' } });
});

test('mail-check: de tokencache leeft in de handler-instantie en elke aanroep is een GET (of het token)', async () => {
  const { fn, calls } = maakNepFetch(metThreads([], []));
  const h = maakHandler({ fetch: fn });
  await metGlobaleFetch(async () => { throw new Error('globale fetch verboden'); }, async () => { await h(req()); await h(req()); });
  assert.deepEqual(uit(calls).map(c => c.url.replace(DESK, '')), [
    'https://accounts.zoho.eu/oauth/v2/token', '/organizations', '/tickets/555/threads?from=1&limit=100',
    '/organizations', '/tickets/555/threads?from=1&limit=100',
  ]);
  assert.ok(calls.every(c => c.method === 'GET' || c.url.includes('oauth')));
});
