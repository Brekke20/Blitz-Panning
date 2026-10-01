// Karakterisering van annuleer en confirm-afspraak (etappe 6, taak 5).
// Aanvulling op tests/annulatie.test.mjs: elke test controleert de VOLLEDIGE lijst uitgaande
// aanroepen (methode, url, headers, body) en het volledige antwoord. Een onbekende URL geeft
// stil 404 {}. Nooit echte netwerkaanroepen of mails.
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, zetEnv } from './nep-fetch.mjs';
import { maakHandler } from '../netlify/functions/annuleer.js';
import { REDENEN, bouwAnnulatieMail, bouwAnnulatieNotitie } from '../netlify/lib/annulatie.js';
import { tekenLink, bevestigingsNotitie } from '../netlify/lib/bevestigingslink.js';

const NU = Date.parse('2026-10-01T10:00:00.000Z');
const TIJDSTIP_NU = '01/10/2026 12:00';           // tijdstipNu() in annuleer, Brusselse tijd
const DESK = 'https://desk.zoho.eu/api/v1';
const TOKEN_CALL = {
  method: 'POST',
  url: 'https://accounts.zoho.eu/oauth/v2/token',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'refresh_token=RT&client_id=CID&client_secret=SEC&grant_type=refresh_token',
};
const ORG_CALL = { method: 'GET', url: `${DESK}/organizations`, headers: { Authorization: 'Zoho-oauthtoken TOK' }, body: undefined };
const JSON_HEADERS = { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1', 'Content-Type': 'application/json' };
const getTicket = id => ({ method: 'GET', url: `${DESK}/tickets/${id}`, headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' }, body: undefined });
const patch = (id, body) => ({ method: 'PATCH', url: `${DESK}/tickets/${id}`, headers: JSON_HEADERS, body: JSON.stringify(body) });
const comment = (id, content) => ({ method: 'POST', url: `${DESK}/tickets/${id}/comments`, headers: JSON_HEADERS, body: JSON.stringify({ content, isPublic: false }) });
const sendReply = (id, to, content, fromEmailAddress = 'service@blitz.test') => ({
  method: 'POST', url: `${DESK}/tickets/${id}/sendReply`, headers: JSON_HEADERS,
  body: JSON.stringify({ channel: 'EMAIL', contentType: 'html', content, fromEmailAddress, to }),
});

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const uit = calls => calls.map(c => ({ method: c.method, url: c.url, headers: c.headers, body: c.body }));

let herstelEnv;
test.beforeEach(() => {
  herstelEnv = zetEnv({
    ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC',
    ZOHO_FROM_EMAIL: 'service@blitz.test', CONFIRM_LINK_SECRET: 'geheim-voor-test',
    NETLIFY_BLOBS_CONTEXT: undefined,
  });
  mock.timers.enable({ apis: ['Date'], now: NU });
});
test.afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  herstelEnv();
});

// =================================================================== annuleer ====
function maakWinkels(initieel = {}) {
  const winkels = {};
  const get = naam => {
    if (!winkels[naam]) winkels[naam] = new Map(Object.entries(initieel[naam] || {}));
    return winkels[naam];
  };
  const getStore = ({ name }) => {
    const m = get(name);
    return {
      async get(k, opt) {
        if (!m.has(k)) return null;
        const v = m.get(k);
        return opt?.type === 'json' ? JSON.parse(v) : v;
      },
      async set(k, v) { m.set(k, v); },
      async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
      async delete(k) { m.delete(k); },
      async list() { return { blobs: [...m.keys()].map(key => ({ key })) }; },
    };
  };
  return { getStore, get };
}
const REG = JSON.stringify({ versie: 3, status: { 555: { klant: 'x', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14' }, 777: { klant: 'y' } } });
const registerVan = w => JSON.parse(w.get('blitz-data').get('voorstel-status'));

const CORS_ANN = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Blitz-Test',
  'content-type': 'application/json',
};
const CF = { cf_interventie_datm: '2026-10-14T06:30:00.000Z', cf_e_mail_eindklant: 'klant@x.be', cf_e_mail_installateur: 'inst@x.be' };
const TICKET = (over = {}) => ({
  status: 'Wachten op bevestiging planning',
  cf: CF,
  contact: { email: 'contact@x.be', firstName: 'An', lastName: 'Peeters' },
  ...over,
});

const annReq = (body, headers = {}) => new Request('http://x/api/annuleer', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const antwoord = async res => ({
  status: res.status,
  headers: Object.fromEntries(res.headers.entries()),
  tekst: await res.text(),
});
const antwoordJson = async res => {
  const a = await antwoord(res);
  return { status: a.status, headers: a.headers, body: JSON.parse(a.tekst) };
};

// Standaardrouter: ticket 555 + welslagende sendReply/PATCH/comments; `over` past onderdelen aan.
function annRouter({ ticket = TICKET(), ticketRes, patchRes, replyRes, commentRes, emailRes } = {}) {
  return (url, opts = {}) => {
    const m = opts.method || 'GET';
    if (url.endsWith('/tickets/555') && m === 'GET') return ticketRes ? ticketRes() : json(ticket);
    if (url.endsWith('/tickets/555') && m === 'PATCH') return patchRes ? patchRes() : json({});
    if (url.endsWith('/sendReply')) return replyRes ? replyRes(opts) : json({});
    if (url.endsWith('/comments')) return commentRes ? commentRes() : json({});
    if (url.includes('/emailAddresses')) return emailRes ? emailRes() : undefined;
    return undefined;
  };
}

async function draaiAnn(req, { router, winkels = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } }), handler } = {}) {
  const { fn, calls } = maakNepFetch(router || annRouter());
  const h = maakHandler({ getStore: winkels.getStore, fetch: fn });
  const res = await metGlobaleFetch(async () => { throw new Error('globale fetch verboden'); }, () => (handler || h)(req));
  return { res, calls: uit(calls), winkels, h, fn };
}

test('annuleer: OPTIONS, GET en 405 hebben de volledige CORS-set (ook met Content-Type), zonder aanvragen', async () => {
  let r = await draaiAnn(new Request('http://x/api/annuleer', { method: 'OPTIONS' }));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(await antwoord(r.res), { status: 204, headers: CORS_ANN, tekst: '' });

  r = await draaiAnn(new Request('http://x/api/annuleer'));
  assert.deepEqual(r.calls, []);
  const a = await antwoordJson(r.res);
  assert.equal(a.status, 200);
  assert.deepEqual(a.headers, CORS_ANN);
  assert.deepEqual(a.body, { redenen: REDENEN.map(({ code, label }) => ({ code, label })) });

  r = await draaiAnn(new Request('http://x/api/annuleer', { method: 'DELETE' }));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(await antwoord(r.res), { status: 405, headers: CORS_ANN, tekst: 'Method Not Allowed' });
});

test('annuleer: sleutelvolgorde van de CORS-headers', async () => {
  const r = await draaiAnn(new Request('http://x/api/annuleer'));
  assert.deepEqual([...r.res.headers.keys()], [
    'access-control-allow-headers', 'access-control-allow-methods', 'access-control-allow-origin', 'content-type',
  ]);
});

test('annuleer: ongeldige JSON, geen object en validatiefouten geven 400 zonder aanvragen', async () => {
  for (const [req, fout] of [
    [annReq('{kapot'), 'Ongeldige JSON'],
    [annReq('null'), 'Ongeldige JSON'],
    [annReq('5'), 'Ongeldige JSON'],
    [annReq({ ticketId: 'x', reden: 'weer', mailKlant: false }), 'ticketId (numeriek) is verplicht'],
    [annReq({ ticketId: '555', reden: 'nope', mailKlant: false }), 'Onbekende reden'],
    [annReq({ ticketId: '555', reden: 'weer', mailKlant: 'ja' }), 'mailKlant (boolean) is verplicht'],
    [annReq({ ticketId: '555', reden: 'andere', toelichting: '', mailKlant: false }), 'Toelichting is verplicht bij reden "Andere"'],
  ]) {
    const r = await draaiAnn(req);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(await antwoordJson(r.res), { status: 400, headers: CORS_ANN, body: { error: fout } });
  }
});

test('annuleer: mailvoorbeeld geeft volledige html en doet nooit een aanvraag; validatie vooraf', async () => {
  let r = await draaiAnn(annReq({ voorbeeld: true, naam: ' An ', datum: '2026-10-14', tijdslot: '08:30–11:30', uur: '09:00', reden: 'weer', toelichting: 'x' }));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(await antwoordJson(r.res), {
    status: 200, headers: CORS_ANN,
    body: { html: bouwAnnulatieMail({ naam: 'An', datum: '2026-10-14', tijdslot: '08:30–11:30', uur: '09:00', reden: 'weer', toelichting: 'x' }) },
  });

  r = await draaiAnn(annReq({ voorbeeld: true, reden: 'weer' }));
  assert.deepEqual(await antwoordJson(r.res), {
    status: 200, headers: CORS_ANN, body: { html: bouwAnnulatieMail({ naam: '', datum: null, tijdslot: '', uur: '', reden: 'weer', toelichting: '' }) },
  });

  r = await draaiAnn(annReq({ voorbeeld: true, reden: 'weer', datum: '14-10-2026' }));
  assert.deepEqual(await antwoordJson(r.res), { status: 400, headers: CORS_ANN, body: { error: 'datum moet YYYY-MM-DD zijn' } });
  r = await draaiAnn(annReq({ voorbeeld: true, reden: 'x' }));
  assert.deepEqual(await antwoordJson(r.res), { status: 400, headers: CORS_ANN, body: { error: 'Onbekende reden' } });
  assert.deepEqual(r.calls, []);
});

test('annuleer: testmodus doet nul aanvragen, wist enkel de teststore en geeft het nep-antwoord', async () => {
  const w = maakWinkels({
    'blitz-data': { 'voorstel-status': REG },
    'blitz-data-test': { 'voorstel-status': REG, _testkopie: '{}' },
  });
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true, door: 'Brent' }, { 'X-Blitz-Test': '1' }), { winkels: w });
  assert.deepEqual(r.calls, []);
  assert.deepEqual(await antwoordJson(r.res), {
    status: 200, headers: CORS_ANN,
    body: { ok: true, test: true, ticketId: '555', emailSent: { contact: true, klant: false, installateur: false }, fouten: [] },
  });
  assert.equal(JSON.parse(w.get('blitz-data-test').get('voorstel-status')).status['555'], undefined);
  assert.deepEqual(registerVan(w).status['555'], { klant: 'x', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14' });

  // validatie komt vóór de testmodus-tak
  const bad = await draaiAnn(annReq({ ticketId: 'p/1', reden: 'weer', mailKlant: false }, { 'X-Blitz-Test': '1' }), { winkels: w });
  assert.deepEqual(bad.calls, []);
  assert.equal(bad.res.status, 400);
});

test('annuleer: volledige reeks met mail naar contact, klant en installateur (token, org, ticket, sendReply x3, PATCH, notitie)', async () => {
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'onderdelen', toelichting: '', mailKlant: true, door: 'Brent' }));
  const mail = bouwAnnulatieMail({ naam: 'An Peeters', datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, reden: 'onderdelen', toelichting: '' });
  const notitie = bouwAnnulatieNotitie({
    datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, door: 'Brent', tijdstip: TIJDSTIP_NU,
    redenLabel: 'Onderdelen niet op tijd geleverd', toelichting: '', mailKlant: true,
    gemaild: ['contact@x.be', 'klant@x.be', 'inst@x.be'],
  });
  assert.equal(notitie, 'Afspraak van 14/10/2026 08:30–11:30 geannuleerd via Blitz Planning door Brent op 01/10/2026 12:00. Reden: Onderdelen niet op tijd geleverd. Klant verwittigd per mail: ja (contact@x.be, klant@x.be, inst@x.be).');
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, getTicket('555'),
    sendReply('555', 'contact@x.be', mail),
    sendReply('555', 'klant@x.be', mail),
    sendReply('555', 'inst@x.be', mail),
    patch('555', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }),
    comment('555', notitie),
  ]);
  assert.deepEqual(await antwoordJson(r.res), {
    status: 200, headers: CORS_ANN,
    body: { ok: true, emailSent: { contact: true, klant: true, installateur: true }, fouten: [] },
  });
  assert.equal(registerVan(r.winkels).status['555'], undefined);
  assert.ok(registerVan(r.winkels).status['777']);
});

test('annuleer: sleutelvolgorde van de uitgaande Zoho-headers', async () => {
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true }));
  assert.deepEqual(Object.keys(r.calls[0].headers), ['Content-Type']);
  assert.deepEqual(Object.keys(r.calls[1].headers), ['Authorization']);
  assert.deepEqual(Object.keys(r.calls[2].headers), ['Authorization', 'orgId']);
  assert.deepEqual(Object.keys(r.calls[3].headers), ['Authorization', 'orgId', 'Content-Type']);   // sendReply
  assert.deepEqual(Object.keys(JSON.parse(r.calls[3].body)), ['channel', 'contentType', 'content', 'fromEmailAddress', 'to']);
  const pat = r.calls.find(c => c.method === 'PATCH');
  assert.deepEqual(Object.keys(pat.headers), ['Authorization', 'orgId', 'Content-Type']);
  const com = r.calls.find(c => c.url.endsWith('/comments'));
  assert.deepEqual(Object.keys(com.headers), ['Authorization', 'orgId', 'Content-Type']);
  assert.deepEqual(Object.keys(JSON.parse(com.body)), ['content', 'isPublic']);
});

test('annuleer: dubbele adressen (hoofdletterongevoelig) krijgen één mail; naam uit de body wint', async () => {
  const router = annRouter({ ticket: TICKET({ contact: { email: 'KLANT@x.be', firstName: 'An', lastName: 'Peeters' }, cf: { ...CF, cf_e_mail_installateur: 'Klant@X.be' } }) });
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true, naam: '  Familie Jansen  ' }), { router });
  const mail = bouwAnnulatieMail({ naam: 'Familie Jansen', datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, reden: 'weer', toelichting: '' });
  const notitie = bouwAnnulatieNotitie({
    datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, door: '', tijdstip: TIJDSTIP_NU,
    redenLabel: 'Weersomstandigheden', toelichting: '', mailKlant: true, gemaild: ['KLANT@x.be'],
  });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, getTicket('555'),
    sendReply('555', 'KLANT@x.be', mail),
    patch('555', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }),
    comment('555', notitie),
  ]);
  assert.deepEqual((await antwoordJson(r.res)).body, { ok: true, emailSent: { contact: true, klant: false, installateur: false }, fouten: [] });
});

test('annuleer: tijdslot uit het register geldt enkel voor dezelfde datum; anders het uur uit Zoho', async () => {
  const reg = JSON.stringify({ versie: 1, status: { 555: { tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-15' } } });
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true, door: 'B' }),
    { winkels: maakWinkels({ 'blitz-data': { 'voorstel-status': reg } }), router: annRouter({ ticket: TICKET({ cf: { ...CF, cf_e_mail_installateur: '' } }) }) });
  const mail = bouwAnnulatieMail({ naam: 'An Peeters', datum: '2026-10-14', tijdslot: null, uur: '08:30', reden: 'weer', toelichting: '' });
  assert.match(mail, /\(om 08:30\)/);
  assert.equal(r.calls[3].body, sendReply('555', 'contact@x.be', mail).body);
  assert.equal(r.calls[4].body, sendReply('555', 'klant@x.be', mail).body);
});

test('annuleer: mailKlant:false doet geen sendReply; notitie zegt "nee"', async () => {
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: 'iets', mailKlant: false, door: 'Brent' }));
  const notitie = bouwAnnulatieNotitie({
    datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, door: 'Brent', tijdstip: TIJDSTIP_NU,
    redenLabel: 'Weersomstandigheden', toelichting: 'iets', mailKlant: false, gemaild: [],
  });
  assert.match(notitie, /Toelichting: iets\. Klant verwittigd per mail: nee\.$/);
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, getTicket('555'),
    patch('555', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }),
    comment('555', notitie),
  ]);
  assert.deepEqual((await antwoordJson(r.res)).body, { ok: true, emailSent: { contact: false, klant: false, installateur: false }, fouten: [] });
});

test('annuleer: zonder ontvangers geen mail, wel PATCH en notitie ("nee")', async () => {
  const router = annRouter({ ticket: TICKET({ contact: {}, cf: { cf_interventie_datm: CF.cf_interventie_datm } }) });
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true }), { router });
  const notitie = bouwAnnulatieNotitie({
    datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, door: '', tijdstip: TIJDSTIP_NU,
    redenLabel: 'Weersomstandigheden', toelichting: '', mailKlant: true, gemaild: [],
  });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, getTicket('555'),
    patch('555', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }),
    comment('555', notitie),
  ]);
  assert.equal(r.res.status, 200);
});

test('annuleer: sendReply-fout komt in fouten, de andere ontvangers en de PATCH gaan door; "Empty Recipients" is stil', async () => {
  let n = 0;
  const router = annRouter({
    replyRes: () => {
      n += 1;
      if (n === 1) return json({ errorCode: 'X' }, 500);
      return json({ errorCode: 'UNPROCESSABLE_ENTITY', message: 'Empty Recipients' }, 422);
    },
  });
  const spy = mock.method(console, 'error', () => {});
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true, door: 'B' }), { router });
  const mail = bouwAnnulatieMail({ naam: 'An Peeters', datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, reden: 'weer', toelichting: '' });
  const notitie = bouwAnnulatieNotitie({
    datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, door: 'B', tijdstip: TIJDSTIP_NU,
    redenLabel: 'Weersomstandigheden', toelichting: '', mailKlant: true, gemaild: [],
  });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, getTicket('555'),
    sendReply('555', 'contact@x.be', mail), sendReply('555', 'klant@x.be', mail), sendReply('555', 'inst@x.be', mail),
    patch('555', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }),
    comment('555', notitie),
  ]);
  assert.deepEqual(await antwoordJson(r.res), {
    status: 200, headers: CORS_ANN,
    body: {
      ok: true, emailSent: { contact: false, klant: false, installateur: false },
      fouten: [{ doelgroep: 'contact', fout: 'Zoho sendReply fout (500) naar contact: {"errorCode":"X"}' }],
    },
  });
  assert.equal(spy.mock.calls.length, 1);
  assert.deepEqual(spy.mock.calls[0].arguments, ['Versturen naar contact mislukt:', 'Zoho sendReply fout (500) naar contact: {"errorCode":"X"}']);
});

test('annuleer: sendReply met netwerkfout of lege/niet-JSON body', async () => {
  let n = 0;
  const router = annRouter({
    replyRes: () => {
      n += 1;
      if (n === 1) throw new Error('netwerk');
      if (n === 2) return new Response('', { status: 200 });
      return new Response('geen json', { status: 200 });
    },
  });
  mock.method(console, 'error', () => {});
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true }), { router });
  assert.equal(r.calls.filter(c => c.url.endsWith('/sendReply')).length, 3);
  assert.deepEqual((await antwoordJson(r.res)).body, {
    ok: true, emailSent: { contact: false, klant: true, installateur: true }, fouten: [{ doelgroep: 'contact', fout: 'netwerk' }],
  });
});

test('annuleer: zonder ZOHO_FROM_EMAIL wordt het from-adres opgezocht (emailAddresses?limit=50)', async () => {
  const restore = zetEnv({ ZOHO_FROM_EMAIL: undefined });
  try {
    const router = annRouter({ ticket: TICKET({ cf: { cf_interventie_datm: CF.cf_interventie_datm } }), emailRes: () => json({ data: [{ emailAddress: 'geen-adres' }, { emailAddress: 'desk@blitz.test' }, { emailAddress: 'ander@blitz.test' }] }) });
    const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true, door: 'B' }), { router });
    const mail = bouwAnnulatieMail({ naam: 'An Peeters', datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, reden: 'weer', toelichting: '' });
    const notitie = bouwAnnulatieNotitie({
      datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, door: 'B', tijdstip: TIJDSTIP_NU,
      redenLabel: 'Weersomstandigheden', toelichting: '', mailKlant: true, gemaild: ['contact@x.be'],
    });
    assert.deepEqual(r.calls, [
      TOKEN_CALL, ORG_CALL, getTicket('555'),
      { method: 'GET', url: `${DESK}/emailAddresses?limit=50`, headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' }, body: undefined },
      sendReply('555', 'contact@x.be', mail, 'desk@blitz.test'),
      patch('555', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }),
      comment('555', notitie),
    ]);
    assert.deepEqual((await antwoordJson(r.res)).body, { ok: true, emailSent: { contact: true, klant: false, installateur: false }, fouten: [] });
    assert.deepEqual(Object.keys(r.calls[3].headers), ['Authorization', 'orgId']);
  } finally { restore(); }
});

test('annuleer: from-adres niet te bepalen geeft per ontvanger een fout; PATCH en notitie gaan door', async () => {
  const restore = zetEnv({ ZOHO_FROM_EMAIL: undefined });
  const spy = mock.method(console, 'error', () => {});
  try {
    const router = annRouter({ emailRes: () => json({ data: [{ emailAddress: 'zonder-apestaart' }] }) });
    const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true, door: 'B' }), { router });
    const fout = 'Geen from-emailadres gevonden in Zoho (stel ZOHO_FROM_EMAIL in)';
    const notitie = bouwAnnulatieNotitie({
      datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, door: 'B', tijdstip: TIJDSTIP_NU,
      redenLabel: 'Weersomstandigheden', toelichting: '', mailKlant: true, gemaild: [],
    });
    assert.deepEqual(r.calls, [
      TOKEN_CALL, ORG_CALL, getTicket('555'),
      { method: 'GET', url: `${DESK}/emailAddresses?limit=50`, headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' }, body: undefined },
      patch('555', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }),
      comment('555', notitie),
    ]);
    assert.deepEqual((await antwoordJson(r.res)).body, {
      ok: true, emailSent: { contact: false, klant: false, installateur: false },
      fouten: [{ doelgroep: 'contact', fout }, { doelgroep: 'klant', fout }, { doelgroep: 'installateur', fout }],
    });
    assert.deepEqual(spy.mock.calls[0].arguments, ['From-adres bepalen mislukt:', fout]);
  } finally { restore(); }
});

test('annuleer: PATCH-fout geeft 502 met emailSent en fouten; geen notitie, register intact', async () => {
  const spy = mock.method(console, 'error', () => {});
  const router = annRouter({ patchRes: () => new Response('boem', { status: 500 }) });
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true }), { router });
  const mail = bouwAnnulatieMail({ naam: 'An Peeters', datum: '2026-10-14', tijdslot: '08:30–11:30', uur: null, reden: 'weer', toelichting: '' });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, getTicket('555'),
    sendReply('555', 'contact@x.be', mail), sendReply('555', 'klant@x.be', mail), sendReply('555', 'inst@x.be', mail),
    patch('555', { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }),
  ]);
  assert.deepEqual(await antwoordJson(r.res), {
    status: 502, headers: CORS_ANN,
    body: { error: 'Zoho PATCH fout (500)', emailSent: { contact: true, klant: true, installateur: true }, fouten: [] },
  });
  assert.ok(registerVan(r.winkels).status['555']);
  assert.deepEqual(spy.mock.calls[0].arguments, ['Zoho PATCH fout (500):', 'boem']);
});

test('annuleer: ticket-GET 404 en 500', async () => {
  let r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true }),
    { router: annRouter({ ticketRes: () => json({}, 404) }) });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555')]);
  assert.deepEqual(await antwoordJson(r.res), { status: 404, headers: CORS_ANN, body: { error: 'Ticket niet gevonden' } });

  r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true }),
    { router: annRouter({ ticketRes: () => new Response('<html>', { status: 500 }) }) });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555')]);
  assert.deepEqual(await antwoordJson(r.res), { status: 502, headers: CORS_ANN, body: { error: 'Zoho ticket ophalen mislukt' } });
  assert.ok(registerVan(r.winkels).status['555']);
});

test('annuleer: ticket zonder gepland-status + mailKlant:true geeft 409 zonder mail, PATCH of notitie', async () => {
  for (const status of ['Wachten op planning', undefined]) {
    const ticket = TICKET();
    if (status === undefined) delete ticket.status; else ticket.status = status;
    const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true }), { router: annRouter({ ticket }) });
    assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555')]);
    assert.deepEqual(await antwoordJson(r.res), {
      status: 409, headers: CORS_ANN,
      body: {
        error: 'Afspraak is niet (meer) gepland in Zoho — klant niet gemaild. Kies "Nee, ik verwittig zelf" om enkel de vergrendeling op te ruimen.',
        emailSent: { contact: false, klant: false, installateur: false },
        nietGepland: true,
      },
    });
    assert.ok(registerVan(r.winkels).status['555']);
  }
});

test('annuleer: ticket zonder gepland-status + mailKlant:false ruimt op (notitie, register gewist)', async () => {
  const ticket = TICKET({ status: 'Open' });
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'andere', toelichting: 'Test <b>&</b>', mailKlant: false, door: 'Br<i>' }), { router: annRouter({ ticket }) });
  const tekst = 'Vergrendeling opgeruimd via Blitz Planning door Br&lt;i&gt; op 01/10/2026 12:00. Ticket stond al op Open. Reden: Andere — Test &lt;b&gt;&amp;&lt;/b&gt;.';
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555'), comment('555', tekst)]);
  assert.deepEqual(await antwoordJson(r.res), {
    status: 200, headers: CORS_ANN, body: { ok: true, emailSent: { contact: false, klant: false, installateur: false }, fouten: [], opgeruimd: true },
  });
  assert.equal(registerVan(r.winkels).status['555'], undefined);
});

test('annuleer: opruimen zonder status en zonder door gebruikt "onbekend"; registerfout geeft waarschuwing', async () => {
  const ticket = TICKET();
  delete ticket.status;
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const basis = w.getStore;
  const spy = mock.method(console, 'error', () => {});
  const winkels = { ...w, getStore: o => ({ ...basis(o), async setJSON() { throw new Error('blob stuk'); } }) };
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false }), { router: annRouter({ ticket }), winkels });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, getTicket('555'),
    comment('555', 'Vergrendeling opgeruimd via Blitz Planning op 01/10/2026 12:00. Ticket stond al op onbekend. Reden: Weersomstandigheden.'),
  ]);
  assert.deepEqual(await antwoordJson(r.res), {
    status: 200, headers: CORS_ANN,
    body: {
      ok: true, emailSent: { contact: false, klant: false, installateur: false }, fouten: [], opgeruimd: true,
      waarschuwing: 'Vergrendeling opruimen: het voorstel-register kon niet bijgewerkt worden. Herlaad de planner.',
    },
  });
  assert.deepEqual(spy.mock.calls[0].arguments, ['Register wissen mislukt bij opruimen:', 'blob stuk']);
});

test('annuleer: registerfout na geslaagde annulatie geeft 200 met waarschuwing en volledige reeks', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const basis = w.getStore;
  const spy = mock.method(console, 'error', () => {});
  const winkels = { ...w, getStore: o => ({ ...basis(o), async setJSON() { throw new Error('blob stuk'); } }) };
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false, door: 'B' }), { winkels });
  assert.equal(r.calls.length, 5);
  assert.deepEqual(await antwoordJson(r.res), {
    status: 200, headers: CORS_ANN,
    body: {
      ok: true, emailSent: { contact: false, klant: false, installateur: false }, fouten: [],
      waarschuwing: 'Afspraak geannuleerd in Zoho, maar het voorstel-register kon niet bijgewerkt worden. Herlaad de planner.',
    },
  });
  assert.deepEqual(spy.mock.calls[0].arguments, ['Register wissen mislukt na geslaagde annulatie:', 'blob stuk']);
});

test('annuleer: leesfout op het register geeft een leeg register (geen log); uur uit Zoho in plaats van tijdslot', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const basis = w.getStore;
  const spy = mock.method(console, 'error', () => {});
  const winkels = { ...w, getStore: o => { const s = basis(o); return { ...s, async get(k, opt) { if (opt?.type === 'json') throw new Error('lees stuk'); return s.get(k, opt); } }; } };
  const r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false }), { winkels });
  // leesRegister vangt de fout zelf (leeg register): geen gelogde fout, geen tijdslot -> uur
  assert.equal(r.res.status, 200);
  assert.match(JSON.parse(r.calls[4].body).content, /Afspraak van 14\/10\/2026 08:30 geannuleerd/);
  assert.equal(spy.mock.calls.length, 0);
});

test('annuleer: comment-fout (niet-ok of netwerk) wordt enkel gelogd; antwoord blijft 200', async () => {
  const spy = mock.method(console, 'error', () => {});
  let r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false }),
    { router: annRouter({ commentRes: () => new Response('nee', { status: 500 }) }) });
  assert.equal(r.res.status, 200);
  assert.deepEqual(spy.mock.calls[0].arguments, ['Zoho ticket-comment mislukt:', 500, 'nee']);

  r = await draaiAnn(annReq({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false }),
    { router: annRouter({ commentRes: () => { throw new Error('netwerk'); } }) });
  assert.equal(r.res.status, 200);
  assert.deepEqual(spy.mock.calls[1].arguments, ['Zoho ticket-comment mislukt:', 'netwerk']);
});

test('annuleer: tokenfout geeft 500 zonder data in de tekst; org-fout en netwerkfouten idem', async () => {
  const spy = mock.method(console, 'error', () => {});
  const body = { ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true };

  let r = await draaiAnn(annReq(body), { router: url => url.includes('oauth/v2/token') ? json({ error: 'invalid_code' }) : undefined });
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(await antwoordJson(r.res), { status: 500, headers: CORS_ANN, body: { error: 'Token refresh mislukt' } });

  r = await draaiAnn(annReq(body), { router: url => url.endsWith('/organizations') ? json({ data: [] }) : undefined });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(await antwoordJson(r.res), { status: 500, headers: CORS_ANN, body: { error: 'Zoho org ID niet gevonden' } });

  r = await draaiAnn(annReq(body), { router: url => { if (url.includes('oauth/v2/token')) throw new Error('netwerk'); } });
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(await antwoordJson(r.res), { status: 500, headers: CORS_ANN, body: { error: 'netwerk' } });

  r = await draaiAnn(annReq(body), { router: url => { if (url.endsWith('/organizations')) throw new Error('netwerk org'); } });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(await antwoordJson(r.res), { status: 500, headers: CORS_ANN, body: { error: 'netwerk org' } });

  r = await draaiAnn(annReq(body), { router: annRouter({ ticketRes: () => { throw new Error('netwerk ticket'); } }) });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555')]);
  assert.deepEqual(await antwoordJson(r.res), { status: 500, headers: CORS_ANN, body: { error: 'netwerk ticket' } });

  r = await draaiAnn(annReq(body), { router: annRouter({ patchRes: () => { throw new Error('netwerk patch'); } }) });
  assert.deepEqual(await antwoordJson(r.res), { status: 500, headers: CORS_ANN, body: { error: 'netwerk patch' } });
  assert.ok(spy.mock.calls.length >= 6);
});

test('annuleer: tokencache per handlerinstantie (55 minuten), org-id wordt telkens opnieuw opgevraagd', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const { fn, calls } = maakNepFetch(annRouter());
  const h = maakHandler({ getStore: w.getStore, fetch: fn });
  const body = { ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false };
  await h(annReq(body));
  await h(annReq(body));
  const nu = uit(calls);
  assert.equal(nu.filter(c => c.url.includes('oauth/v2/token')).length, 1);
  assert.equal(nu.filter(c => c.url.endsWith('/organizations')).length, 2);
  mock.timers.setTime(NU + 56 * 60 * 1000);
  await h(annReq(body));
  assert.equal(uit(calls).filter(c => c.url.includes('oauth/v2/token')).length, 2);
});

// ============================================================ confirm-afspraak ====
const BASIS = 'https://blitz-planning.netlify.app';
const EXP = String(Math.floor(NU / 1000) + 3600);
const DATUM = '2026-10-14';
const CORS_CF = (origin = BASIS) => ({
  'access-control-allow-origin': origin,
  'content-type': 'text/html; charset=utf-8',
  vary: 'Origin',
});
const linkParams = (over = {}) => {
  const p = { ticketId: '555', date: DATUM, exp: EXP, d: 'klant', ...over };
  if (over.sig === undefined) p.sig = tekenLink(p.ticketId, p.date, p.exp, p.d || undefined);
  return p;
};
const getReq = (params, headers = {}) =>
  new Request(`http://localhost/api/confirm-afspraak?${new URLSearchParams(params)}`, { headers });
const postReq = (params, headers = {}) =>
  new Request('http://localhost/api/confirm-afspraak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(params).toString(),
  });

async function draaiCf(req, router) {
  const { fn, calls } = maakNepFetch(router);
  const mod = await laadVers('confirm-afspraak');
  const res = await metGlobaleFetch(fn, () => mod.default(req));
  return { res, calls: uit(calls), mod };
}
const cfRouter = ({ ticket = { status: 'Wachten op bevestiging planning', cf: { cf_interventie_datm: '2026-10-14T06:30:00.000Z', cf_e_mail_eindklant: 'klant@x.be', cf_e_mail_installateur: 'inst@x.be' }, contact: { email: 'contact@x.be' } },
  ticketRes, patchRes, commentRes } = {}) => (url, opts = {}) => {
  const m = opts.method || 'GET';
  if (url.endsWith('/tickets/555') && m === 'GET') return ticketRes ? ticketRes() : json(ticket);
  if (url.endsWith('/tickets/555') && m === 'PATCH') return patchRes ? patchRes() : json({});
  if (url.endsWith('/comments')) return commentRes ? commentRes() : json({});
  return undefined;
};
const pagina = (title, message, ok) => ({ title, message, ok });
const leesPagina = tekst => ({
  title: /<title>(.*)<\/title>/.exec(tekst)?.[1],
  h1: /<h1>(.*)<\/h1>/.exec(tekst)?.[1],
  message: /<p>(.*)<\/p>/.exec(tekst)?.[1],
  icoon: /<div class="icon">(.*)<\/div>/.exec(tekst)?.[1],
});
const ONGELDIG = 'Deze bevestigingslink is niet (meer) geldig. Neem contact op met Blitz Power als u de afspraak alsnog wil bevestigen.';
const FOUT = 'De afspraak kon niet bevestigd worden. Neem contact op met Blitz Power.';
const verwachtPagina = (title, message, ok) => ({ title, h1: title, message, icoon: ok ? '✅' : '⚠️' });
const TIJDSTIP_BEVESTIGD = new Date(NU).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' });

test('confirm-afspraak: tijdstip in de notitie (Brussel, nl-BE) is vastgepind', () => {
  assert.equal(TIJDSTIP_BEVESTIGD, '1/10/2026, 12:00:00');
});

test('confirm-afspraak: CORS-origin-whitelist met Vary; onbekende origin valt terug op de eerste', async () => {
  for (const [origin, verwacht] of [
    ['http://localhost:8888', 'http://localhost:8888'],
    ['https://blitz-planning.netlify.app', BASIS],
    ['https://kwaad.example', BASIS],
    [undefined, BASIS],
  ]) {
    const kop = origin ? { origin } : {};
    const r = await draaiCf(new Request('http://localhost/api/confirm-afspraak', { method: 'OPTIONS', headers: kop }));
    assert.deepEqual(r.calls, []);
    assert.equal(r.res.status, 204);
    assert.deepEqual(Object.fromEntries(r.res.headers.entries()), CORS_CF(verwacht));
    assert.equal(await r.res.text(), '');
  }
  const r = await draaiCf(new Request('http://localhost/api/confirm-afspraak', { method: 'OPTIONS' }));
  assert.deepEqual([...r.res.headers.keys()], ['access-control-allow-origin', 'content-type', 'vary']);
});

test('confirm-afspraak: GET met geldige link toont de pagina zonder enige aanvraag', async () => {
  const p = linkParams();
  const r = await draaiCf(getReq(p, { origin: 'http://localhost:8888' }), cfRouter());
  assert.deepEqual(r.calls, []);
  assert.equal(r.res.status, 200);
  assert.deepEqual(Object.fromEntries(r.res.headers.entries()), CORS_CF('http://localhost:8888'));
  const tekst = await r.res.text();
  assert.deepEqual(leesPagina(tekst), verwachtPagina('Afspraak bevestigen', 'Klik hieronder om deze afspraak te bevestigen.', true));
  assert.ok(tekst.includes(`<form method="POST" action="/api/confirm-afspraak">`));
  for (const [naam, waarde] of Object.entries(p)) assert.ok(tekst.includes(`<input type="hidden" name="${naam}" value="${waarde}">`), naam);
  assert.ok(tekst.includes('✅ Ja, ik bevestig deze afspraak'));
});

test('confirm-afspraak: GET met oude link (zonder d) laat het d-veld weg', async () => {
  const p = linkParams({ d: '' });
  delete p.d;
  p.sig = tekenLink('555', DATUM, EXP);
  const r = await draaiCf(getReq(p), cfRouter());
  assert.deepEqual(r.calls, []);
  assert.equal(r.res.status, 200);
  assert.ok(!(await r.res.text()).includes('name="d"'));
});

test('confirm-afspraak: ongeldige of verlopen link geeft 400 en nul aanvragen (GET en POST)', async () => {
  const geldig = linkParams();
  const gevallen = {
    'verkeerde handtekening': { ...geldig, sig: 'f'.repeat(64) },
    'handtekening ontbreekt': { ...geldig, sig: '' },
    'verlopen': linkParams({ exp: String(Math.floor(NU / 1000) - 1) }),
    'datum aangepast': { ...geldig, date: '2026-10-15' },
    'doelgroep aangepast': { ...geldig, d: 'installateur' },
    'onbekende doelgroep': { ...geldig, d: 'baas' },
    'ticketId niet numeriek': linkParams({ ticketId: '5a5' }),
    'ticketId ontbreekt': { ...geldig, ticketId: '' },
    'exp geen getal': { ...geldig, exp: 'abc' },
  };
  for (const [naam, p] of Object.entries(gevallen)) {
    for (const req of [getReq(p), postReq(p)]) {
      const r = await draaiCf(req, cfRouter());
      assert.deepEqual(r.calls, [], naam);
      assert.equal(r.res.status, 400, naam);
      assert.deepEqual(Object.fromEntries(r.res.headers.entries()), CORS_CF(), naam);
      assert.deepEqual(leesPagina(await r.res.text()), verwachtPagina('Link ongeldig of verlopen', ONGELDIG, false), naam);
    }
  }
});

test('confirm-afspraak: zonder CONFIRM_LINK_SECRET is elke link ongeldig (400, nul aanvragen)', async () => {
  const p = linkParams();
  const restore = zetEnv({ CONFIRM_LINK_SECRET: undefined });
  try {
    const r = await draaiCf(postReq(p), cfRouter());
    assert.deepEqual(r.calls, []);
    assert.equal(r.res.status, 400);
  } finally { restore(); }
});

test('confirm-afspraak: misvormde POST-body geeft 400 en nul aanvragen; fout wordt gelogd', async () => {
  const spy = mock.method(console, 'error', () => {});
  const r = await draaiCf(new Request('http://localhost/api/confirm-afspraak', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}',
  }), cfRouter());
  assert.deepEqual(r.calls, []);
  assert.equal(r.res.status, 400);
  assert.deepEqual(Object.fromEntries(r.res.headers.entries()), CORS_CF());
  assert.deepEqual(leesPagina(await r.res.text()), verwachtPagina('Link ongeldig of verlopen', ONGELDIG, false));
  assert.equal(spy.mock.calls[0].arguments[0], 'confirm-afspraak: ongeldige POST-body:');
});

test('confirm-afspraak: andere methode met geldige link geeft 405 als tekst', async () => {
  const p = linkParams();
  const r = await draaiCf(new Request(`http://localhost/api/confirm-afspraak?${new URLSearchParams(p)}`, { method: 'PUT' }), cfRouter());
  assert.deepEqual(r.calls, []);
  assert.equal(r.res.status, 405);
  assert.deepEqual(Object.fromEntries(r.res.headers.entries()), CORS_CF());
  assert.equal(await r.res.text(), 'Method Not Allowed');
});

test('confirm-afspraak: POST bevestigt (token, org, ticket-GET, PATCH, notitie); Blobs falen zonder omgeving, antwoord blijft 200', async () => {
  const spy = mock.method(console, 'error', () => {});
  const r = await draaiCf(postReq(linkParams(), { 'x-nf-client-connection-ip': '203.0.113.9', origin: 'http://localhost:8888' }), cfRouter());
  const notitie = bevestigingsNotitie({ date: DATUM, doelgroep: 'klant', email: 'klant@x.be', tijdstip: TIJDSTIP_BEVESTIGD, ip: '203.0.113.9' });
  assert.equal(notitie, 'Afspraak bevestigd voor 2026-10-14 door klant (klant@x.be) via bevestigingslink op 1/10/2026, 12:00:00 (Europe/Brussels). IP-adres: 203.0.113.9.');
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, getTicket('555'),
    patch('555', { status: 'Geplande support' }),
    comment('555', notitie),
  ]);
  assert.equal(r.res.status, 200);
  assert.deepEqual(Object.fromEntries(r.res.headers.entries()), CORS_CF('http://localhost:8888'));
  assert.deepEqual(leesPagina(await r.res.text()), verwachtPagina('Afspraak bevestigd', 'Bedankt! Uw afspraak is bevestigd. We zien u graag op de voorgestelde datum.', true));
  assert.equal(spy.mock.calls.length, 1);
  assert.equal(spy.mock.calls[0].arguments[0], 'confirm-afspraak: register bijwerken mislukt:');
});

test('confirm-afspraak: sleutelvolgorde van de uitgaande Zoho-headers', async () => {
  mock.method(console, 'error', () => {});
  const r = await draaiCf(postReq(linkParams()), cfRouter());
  assert.deepEqual(Object.keys(r.calls[0].headers), ['Content-Type']);
  assert.deepEqual(Object.keys(r.calls[1].headers), ['Authorization']);
  assert.deepEqual(Object.keys(r.calls[2].headers), ['Authorization', 'orgId']);
  assert.deepEqual(Object.keys(r.calls[3].headers), ['Authorization', 'orgId', 'Content-Type']);
  assert.deepEqual(Object.keys(r.calls[4].headers), ['Authorization', 'orgId', 'Content-Type']);
  assert.deepEqual(Object.keys(JSON.parse(r.calls[4].body)), ['content', 'isPublic']);
});

test('confirm-afspraak: doelgroepen contact en installateur, oude link en onbekend IP in de notitie', async () => {
  mock.method(console, 'error', () => {});
  const gevallen = [
    [linkParams({ d: 'contact' }), 'contact', 'contact@x.be', { 'x-forwarded-for': '198.51.100.7' }, '198.51.100.7'],
    [linkParams({ d: 'installateur' }), 'installateur', 'inst@x.be', {}, 'onbekend'],
  ];
  for (const [p, doelgroep, email, kop, ip] of gevallen) {
    const r = await draaiCf(postReq(p, kop), cfRouter());
    assert.equal(r.res.status, 200);
    assert.deepEqual(r.calls[4], comment('555', bevestigingsNotitie({ date: DATUM, doelgroep, email, tijdstip: TIJDSTIP_BEVESTIGD, ip })));
  }
  const oud = { ticketId: '555', date: DATUM, exp: EXP, sig: tekenLink('555', DATUM, EXP) };
  const r = await draaiCf(postReq(oud), cfRouter());
  assert.equal(r.res.status, 200);
  assert.deepEqual(r.calls[4], comment('555', bevestigingsNotitie({ date: DATUM, doelgroep: null, email: '', tijdstip: TIJDSTIP_BEVESTIGD, ip: 'onbekend' })));
  assert.match(JSON.parse(r.calls[4].body).content, /onbekende ontvanger \(oude link\)/);
});

test('confirm-afspraak: verkeerde status of datum geeft 409 zonder PATCH', async () => {
  const cf = { cf_interventie_datm: '2026-10-14T06:30:00.000Z' };
  for (const ticket of [
    { status: 'Geplande support', cf },
    { cf },
    { status: 'Wachten op bevestiging planning', cf: { cf_interventie_datm: '2026-10-15T06:30:00.000Z' } },
    { status: 'Wachten op bevestiging planning' },
  ]) {
    const r = await draaiCf(postReq(linkParams()), cfRouter({ ticket }));
    assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555')]);
    assert.equal(r.res.status, 409);
    assert.deepEqual(Object.fromEntries(r.res.headers.entries()), CORS_CF());
    assert.deepEqual(leesPagina(await r.res.text()), verwachtPagina('Afspraak niet meer actueel', 'Deze afspraak is al bevestigd of niet meer actueel. Neem contact op met Blitz Power als u vragen heeft.', false));
  }
});

test('confirm-afspraak: mislukte of falende status-check blokkeert niet; notitie zonder e-mailadres', async () => {
  const spy = mock.method(console, 'error', () => {});
  for (const ticketRes of [() => new Response('boem', { status: 500 }), () => { throw new Error('netwerk'); }]) {
    spy.mock.resetCalls();
    const r = await draaiCf(postReq(linkParams()), cfRouter({ ticketRes }));
    assert.deepEqual(r.calls, [
      TOKEN_CALL, ORG_CALL, getTicket('555'),
      patch('555', { status: 'Geplande support' }),
      comment('555', bevestigingsNotitie({ date: DATUM, doelgroep: 'klant', email: '', tijdstip: TIJDSTIP_BEVESTIGD, ip: 'onbekend' })),
    ]);
    assert.equal(r.res.status, 200);
  }
  assert.equal(spy.mock.calls[0].arguments[0], 'Ticket-status ophalen mislukt (confirm-afspraak):');
});

test('confirm-afspraak: PATCH-fout geeft 502 zonder notitie', async () => {
  const spy = mock.method(console, 'error', () => {});
  const r = await draaiCf(postReq(linkParams()), cfRouter({ patchRes: () => new Response('boem', { status: 500 }) }));
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555'), patch('555', { status: 'Geplande support' })]);
  assert.equal(r.res.status, 502);
  assert.deepEqual(Object.fromEntries(r.res.headers.entries()), CORS_CF());
  assert.deepEqual(leesPagina(await r.res.text()), verwachtPagina('Er ging iets mis', FOUT, false));
  assert.deepEqual(spy.mock.calls[0].arguments, ['Zoho PATCH mislukt (confirm-afspraak):', 500, 'boem']);
});

test('confirm-afspraak: tokenfout (mét data in de interne fout), org-fout en netwerkfouten geven 500', async () => {
  const spy = mock.method(console, 'error', () => {});
  let r = await draaiCf(postReq(linkParams()), url => url.includes('oauth/v2/token') ? json({ error: 'invalid_code' }) : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.equal(r.res.status, 500);
  assert.deepEqual(leesPagina(await r.res.text()), verwachtPagina('Er ging iets mis', FOUT, false));
  assert.equal(spy.mock.calls[0].arguments[0], 'confirm-afspraak fout:');
  assert.equal(spy.mock.calls[0].arguments[1].message, 'Token refresh mislukt: {"error":"invalid_code"}');

  r = await draaiCf(postReq(linkParams()), url => url.endsWith('/organizations') ? json({}) : undefined);
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.equal(r.res.status, 500);
  assert.equal(spy.mock.calls[1].arguments[1].message, 'Zoho org ID niet gevonden');

  r = await draaiCf(postReq(linkParams()), url => { if (url.includes('oauth/v2/token')) throw new Error('netwerk'); });
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.equal(r.res.status, 500);
  assert.equal(spy.mock.calls[2].arguments[1].message, 'netwerk');

  r = await draaiCf(postReq(linkParams()), cfRouter({ patchRes: () => { throw new Error('netwerk patch'); } }));
  assert.equal(r.calls.length, 4);
  assert.equal(r.res.status, 500);
  assert.equal(spy.mock.calls[3].arguments[1].message, 'netwerk patch');
});

test('confirm-afspraak: falende notitie (niet-ok of netwerk) wordt enkel gelogd; antwoord blijft 200', async () => {
  const spy = mock.method(console, 'error', () => {});
  let r = await draaiCf(postReq(linkParams()), cfRouter({ commentRes: () => new Response('nee', { status: 500 }) }));
  assert.equal(r.res.status, 200);
  assert.deepEqual(spy.mock.calls[0].arguments, ['Zoho ticket-comment mislukt:', 500, 'nee']);
  assert.equal(spy.mock.calls[1].arguments[0], 'confirm-afspraak: register bijwerken mislukt:');

  spy.mock.resetCalls();
  r = await draaiCf(postReq(linkParams()), cfRouter({ commentRes: () => { throw new Error('netwerk'); } }));
  assert.equal(r.res.status, 200);
  assert.equal(spy.mock.calls[0].arguments[0], 'Zoho ticket-comment mislukt (exception):');
  assert.equal(spy.mock.calls[0].arguments[1].message, 'netwerk');
});

test('confirm-afspraak: tokencache leeft in de module (één tokenaanvraag bij twee bevestigingen), org-id telkens opnieuw', async () => {
  mock.method(console, 'error', () => {});
  const { fn, calls } = maakNepFetch(cfRouter());
  const mod = await laadVers('confirm-afspraak');
  await metGlobaleFetch(fn, async () => {
    await mod.default(postReq(linkParams()));
    await mod.default(postReq(linkParams()));
  });
  const nu = uit(calls);
  assert.equal(nu.filter(c => c.url.includes('oauth/v2/token')).length, 1);
  assert.equal(nu.filter(c => c.url.endsWith('/organizations')).length, 2);
  mock.timers.setTime(NU + 56 * 60 * 1000);
  // de link is na 56 minuten nog geldig (verloopt na 60)
  await metGlobaleFetch(fn, () => mod.default(postReq(linkParams())));
  assert.equal(uit(calls).filter(c => c.url.includes('oauth/v2/token')).length, 2);
});
