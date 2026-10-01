// Karakterisering van send-rapport (etappe 6, taak 7). W11-gevoelig: verstuurt het servicerapport als
// PDF-bijlage naar klanten en zet het ticket op 'Gesloten - ov'. Elke test controleert de VOLLEDIGE lijst
// uitgaande aanroepen (methode, url, headers, body) en het volledige antwoord. De PDF komt van een
// nep-maakPdf (nooit Chromium). De mail-HTML staat als '<mail>' in de aanroepenlijst en wordt apart
// gecontroleerd: één goudkopie (tests/fixtures/send-rapport-mail-contact.html, gegenereerd met de code van
// vóór de naad, ee90007) plus letterlijke fragmenten. Nooit echte netwerkaanroepen of mails.
process.env.TZ = 'Europe/Brussels';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { maakNepFetch, laadVers, v1Event, zetEnv } from './nep-fetch.mjs';

const DESK = 'https://desk.zoho.eu/api/v1';
const FROM = 'service@blitz.test';
const PDF = Buffer.from('PDF');
const HTML = '<html><body>rapport</body></html>';

const TOKEN_CALL = {
  method: 'POST',
  url: 'https://accounts.zoho.eu/oauth/v2/token',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'refresh_token=RT&client_id=CID&client_secret=SEC&grant_type=refresh_token',
};
const ORG_CALL = { method: 'GET', url: `${DESK}/organizations`, headers: { Authorization: 'Zoho-oauthtoken TOK' }, body: undefined };
const TICKET_CALL = { method: 'GET', url: `${DESK}/tickets/555`, headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' }, body: undefined };
const EMAILS_CALL = { method: 'GET', url: `${DESK}/emailAddresses?limit=50`, headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' }, body: undefined };
const JSON_HEADERS = { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1', 'Content-Type': 'application/json' };
const uploadCall = (naam = 'service-rapport-12345.pdf') => ({
  method: 'POST', url: `${DESK}/uploads`,
  headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' },
  body: [['file', naam, 'application/pdf', 3]],
});
const replyCall = (to, attId, from = FROM) => ({
  method: 'POST', url: `${DESK}/tickets/555/sendReply`, headers: JSON_HEADERS,
  body: JSON.stringify({ channel: 'EMAIL', contentType: 'html', content: '<mail>', fromEmailAddress: from, to, attachmentIds: [attId] }),
});
const PATCH_CALL = { method: 'PATCH', url: `${DESK}/tickets/555`, headers: JSON_HEADERS, body: '{"status":"Gesloten - ov"}' };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const uit = calls => calls.map(c => ({ method: c.method, url: c.url, headers: c.headers, body: c.body }));
const kort = calls => calls.map(c => c.method + ' ' + c.url.replace(DESK, '').replace('https://accounts.zoho.eu/oauth/v2/token', 'TOKEN'));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

// Goudkopie: mail voor naam 'Testcontact' en ticketNumber '12345'.
const GOUD = fs.readFileSync(new URL('./fixtures/send-rapport-mail-contact.html', import.meta.url), 'utf8')
  .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)); // autocrlf-veilig

const BODY = { ticketId: '555', html: HTML, ticketNumber: '12345' };
const TICKET3 = {
  contact: { email: 'contact@x.be', name: 'Testcontact' },
  cf: {
    cf_e_mail_eindklant: 'klant@x.be', cf_naam_eindklant: 'Klant Eindklant',
    cf_e_mail_installateur: 'inst@x.be', cf_partner_installateur: 'Installateur BV',
  },
};
const EEN = { contact: { email: 'a@x.be' } }; // ticket met één ontvanger

// Router: ticket 555 + welslagende upload/sendReply/PATCH; per onderdeel aan te passen.
function maakRouter({ ticket = TICKET3, ticketRes, uploadRes, replyRes, patchRes, emailRes } = {}) {
  let up = 0; let rep = 0;
  return (url, opts = {}) => {
    const m = opts.method || 'GET';
    if (url.endsWith('/tickets/555') && m === 'GET') return ticketRes ? ticketRes() : json(ticket);
    if (url.endsWith('/tickets/555') && m === 'PATCH') return patchRes ? patchRes() : json({});
    if (url.endsWith('/uploads')) { up++; return uploadRes ? uploadRes(up, opts) : json({ id: `ATT${up}` }); }
    if (url.endsWith('/sendReply')) { rep++; return replyRes ? replyRes(rep, opts) : json({}); }
    if (url.includes('/emailAddresses')) return emailRes ? emailRes() : undefined;
    return undefined;
  };
}

let herstelEnv;
test.beforeEach(() => {
  herstelEnv = zetEnv({
    ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC', ZOHO_FROM_EMAIL: FROM,
  });
});
test.afterEach(() => { herstelEnv(); });

// Draait de handler met nep-fetch en nep-maakPdf; vangt console.error op.
async function draai(event, opts = {}) {
  const { fn, calls } = maakNepFetch(opts.router || maakRouter(opts));
  const pdfAanroepen = [];
  const maakPdf = opts.maakPdf || (async (html) => { pdfAanroepen.push(html); return PDF; });
  const mod = await laadVers('send-rapport');
  const gelogd = [];
  const oud = console.error;
  console.error = (...a) => gelogd.push(a.map(String).join(' '));
  let res;
  try { res = await mod.maakHandler({ fetch: fn, maakPdf })(event); }
  finally { console.error = oud; }
  // De mail-HTML gaat naar r.mails; in r.calls staat daar '<mail>' (de rest van het verzoek blijft exact).
  const mails = [];
  const uitgaand = uit(calls).map(c => {
    if (!c.url.endsWith('/sendReply')) return c;
    const b = JSON.parse(c.body);
    mails.push(b.content);
    return { ...c, body: JSON.stringify({ ...b, content: '<mail>' }) };
  });
  return { res, calls: uitgaand, ruweCalls: calls, mails, pdfAanroepen, gelogd, mod };
}
const post = (body, headers) => v1Event('POST', body, headers);
const antw = res => ({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(res.body) });
const OK = (over = {}) => ({
  success: true, emailSent: { contact: true, klant: true, installateur: true }, fouten: [],
  statusUpdated: true, statusFout: null, ...over,
});
const ENKEL_CONTACT = { contact: true, klant: false, installateur: false };
const NIEMAND = { contact: false, klant: false, installateur: false };
const BASIS_CALLS = [TOKEN_CALL, ORG_CALL, TICKET_CALL];
const GEEN_ADRES = { error: 'Geen gekend e-mailadres (klant of installateur) op dit ticket' };

// ---- niet-Zoho-paden ----
test('OPTIONS: 204 met CORS-headers, zonder aanroepen', async () => {
  const r = await draai(v1Event('OPTIONS'));
  assert.deepEqual(r.res, { statusCode: 204, headers: CORS });
  assert.deepEqual(Object.keys(r.res.headers), ['Access-Control-Allow-Origin', 'Content-Type']);
  assert.deepEqual(r.calls, []);
});

test('GET: 405 JSON, zonder aanroepen', async () => {
  const r = await draai(v1Event('GET'));
  assert.deepEqual(antw(r.res), { statusCode: 405, headers: CORS, body: { error: 'Method not allowed' } });
  assert.deepEqual(r.calls, []);
});

test('validatie: ontbrekende ticketId of html -> 400', async () => {
  for (const body of [{}, { html: HTML }, { ticketId: '555' }, { ticketId: '555', html: '' }]) {
    const r = await draai(post(body));
    assert.deepEqual(antw(r.res), { statusCode: 400, headers: CORS, body: { error: 'ticketId en html zijn verplicht' } });
    assert.deepEqual(r.calls, []);
  }
  const leeg = await draai({ httpMethod: 'POST', headers: {} });
  assert.deepEqual(antw(leeg.res), { statusCode: 400, headers: CORS, body: { error: 'ticketId en html zijn verplicht' } });
});

test('validatie: ticketId moet uit cijfers bestaan -> 400', async () => {
  for (const ticketId of ['12a', '../x', '1 2', 'abc']) {
    const r = await draai(post({ ticketId, html: HTML }));
    assert.deepEqual(antw(r.res), { statusCode: 400, headers: CORS, body: { error: 'Ongeldig ticketId' } });
    assert.deepEqual(r.calls, []);
  }
  // numeriek ticketId wordt als tekst gecontroleerd en doorgegeven
  const r = await draai(post({ ticketId: 555, html: HTML, preview: true }));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.calls[2].url, `${DESK}/tickets/555`);
});

test('validatie komt vóór de testmodus-tak', async () => {
  const r = await draai(post({ ticketId: 'x', html: HTML }, { 'x-blitz-test': '1' }));
  assert.deepEqual(antw(r.res), { statusCode: 400, headers: CORS, body: { error: 'Ongeldig ticketId' } });
  assert.deepEqual(r.calls, []);
});

test('ongeldige JSON-body -> 500 met de parse-fout, zonder aanroepen', async () => {
  const r = await draai({ httpMethod: 'POST', headers: {}, body: '{kapot' });
  assert.equal(r.res.statusCode, 500);
  assert.deepEqual(r.res.headers, CORS);
  assert.match(JSON.parse(r.res.body).error, /JSON/);
  assert.deepEqual(r.calls, []);
});

// ---- testmodus ----
test('testmodus echte verzending: nul aanroepen, exact nep-antwoord', async () => {
  const r = await draai(post(BODY, { 'X-Blitz-Test': '1' }));
  assert.deepEqual(antw(r.res), {
    statusCode: 200, headers: CORS,
    body: {
      ok: true, test: true, success: true, emailSent: { contact: true, klant: false, installateur: false },
      fouten: [], statusUpdated: true, statusFout: null,
    },
  });
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.pdfAanroepen, []);
});

test('testmodus voorbeeld: één testontvanger, mail gelijk aan de goudkopie, nul aanroepen', async () => {
  const r = await draai(post({ ...BODY, preview: true }, { 'x-blitz-test': '1' }));
  const b = JSON.parse(r.res.body);
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(r.res.headers, CORS);
  assert.deepEqual(Object.keys(b), ['ok', 'test', 'preview', 'ontvangers']);
  assert.equal(b.ok, true); assert.equal(b.test, true); assert.equal(b.preview, true);
  assert.equal(b.ontvangers.length, 1);
  const o = b.ontvangers[0];
  assert.deepEqual(Object.keys(o), ['doelgroep', 'naam', 'email', 'html']);
  assert.deepEqual({ ...o, html: undefined }, { doelgroep: 'contact', naam: 'Testcontact', email: 'test@example.invalid', html: undefined });
  assert.equal(o.html, GOUD);
  assert.deepEqual(r.calls, []);
});

test('testmodus zonder ticketNumber: geen ticketverwijzing in de mail', async () => {
  const r = await draai(post({ ticketId: '555', html: HTML, preview: true }, { 'x-blitz-test': '1' }));
  const mail = JSON.parse(r.res.body).ontvangers[0].html;
  assert.ok(mail.includes('In bijlage vindt u het service rapport.</p>'));
  assert.ok(!mail.includes('voor ticket'));
});

// ---- mail-inhoud: letterlijke fragmenten ----
function controleerMail(mail, { aanhef, ticket }) {
  assert.ok(mail.startsWith('<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif">'));
  assert.ok(mail.includes(`<p style="margin:0 0 16px;font-size:15px;color:#181e24">${aanhef},</p>`), 'aanhef');
  assert.ok(mail.includes(ticket
    ? `In bijlage vindt u het service rapport voor ticket #${ticket}.</p>`
    : 'In bijlage vindt u het service rapport.</p>'), 'ticketverwijzing');
  assert.ok(mail.includes('Team Blitz Power &mdash; Service &amp; Support'), 'afzender');
  assert.ok(mail.includes('letter-spacing:4px;color:#00dfa3;margin-left:12px">BLITZ</span>'), 'logo');
}

test('verzendpad: mail per ontvanger met naam-aanhef, ticketnummer en escaping', async () => {
  const ticket = {
    contact: { email: 'contact@x.be', name: 'Testcontact' },
    cf: { cf_e_mail_eindklant: 'klant@x.be', cf_naam_eindklant: 'A<b>&"C', cf_e_mail_installateur: 'inst@x.be' },
  };
  const r = await draai(post(BODY), { ticket });
  assert.equal(r.mails.length, 3);
  assert.equal(r.mails[0], GOUD);
  controleerMail(r.mails[0], { aanhef: 'Geachte Testcontact', ticket: '12345' });
  controleerMail(r.mails[1], { aanhef: 'Geachte A&lt;b&gt;&amp;&quot;C', ticket: '12345' });
  controleerMail(r.mails[2], { aanhef: 'Beste', ticket: '12345' });
});

test('verzendpad zonder ticketNumber: mail zonder ticketverwijzing', async () => {
  const r = await draai(post({ ticketId: '555', html: HTML }));
  controleerMail(r.mails[0], { aanhef: 'Geachte Testcontact', ticket: null });
});

// ---- voorbeeldmodus (echte opzoeking) ----
test('preview: token, org, ticket-GET; geen PDF, upload of sendReply; mail per ontvanger', async () => {
  const r = await draai(post({ ...BODY, preview: true }));
  assert.deepEqual(r.calls, BASIS_CALLS);
  assert.deepEqual(r.pdfAanroepen, []);
  const b = JSON.parse(r.res.body);
  assert.equal(r.res.statusCode, 200);
  assert.deepEqual(r.res.headers, CORS);
  assert.deepEqual(Object.keys(b), ['preview', 'ontvangers']);
  assert.equal(b.preview, true);
  assert.deepEqual(b.ontvangers.map(o => [o.doelgroep, o.naam, o.email]), [
    ['contact', 'Testcontact', 'contact@x.be'],
    ['klant', 'Klant Eindklant', 'klant@x.be'],
    ['installateur', 'Installateur BV', 'inst@x.be'],
  ]);
  assert.deepEqual(Object.keys(b.ontvangers[0]), ['doelgroep', 'naam', 'email', 'html']);
  assert.equal(b.ontvangers[0].html, GOUD);
  controleerMail(b.ontvangers[1].html, { aanhef: 'Geachte Klant Eindklant', ticket: '12345' });
  controleerMail(b.ontvangers[2].html, { aanhef: 'Geachte Installateur BV', ticket: '12345' });
});

test('ontvangers: dubbele adressen (hoofdletterongevoelig) en lege adressen vallen weg', async () => {
  const ticket = {
    contact: { email: 'Info@X.be' },
    cf: { cf_e_mail_eindklant: 'info@x.be', cf_e_mail_installateur: 'inst@x.be' },
  };
  const r = await draai(post({ ...BODY, preview: true }), { ticket });
  const b = JSON.parse(r.res.body);
  assert.deepEqual(b.ontvangers.map(o => [o.doelgroep, o.naam, o.email]), [
    ['contact', '', 'Info@X.be'],
    ['installateur', '', 'inst@x.be'],
  ]);
});

test('contactgegevens: emailId, ticket-e-mail en naamvarianten', async () => {
  const lees = async ticket => JSON.parse((await draai(post({ ...BODY, preview: true }), { ticket })).res.body).ontvangers;
  assert.deepEqual((await lees({ contact: { emailId: 'a@x.be', fullName: 'Vol Naam' } })).map(o => [o.naam, o.email]), [['Vol Naam', 'a@x.be']]);
  assert.deepEqual((await lees({ email: 'b@x.be', contact: { firstName: 'Jan', lastName: 'Peeters' } })).map(o => [o.naam, o.email]), [['Jan Peeters', 'b@x.be']]);
  assert.deepEqual((await lees({ email: 'c@x.be', contact: { firstName: 'Jan' } })).map(o => [o.naam, o.email]), [['Jan', 'c@x.be']]);
  assert.deepEqual((await lees({ email: 'd@x.be' })).map(o => [o.naam, o.email]), [['', 'd@x.be']]);
});

test('ticket niet gevonden -> 404, geen verdere aanroepen', async () => {
  for (const status of [404, 500]) {
    const r = await draai(post(BODY), { ticketRes: () => json({ errorCode: 'X' }, status) });
    assert.deepEqual(antw(r.res), { statusCode: 404, headers: CORS, body: { error: 'Ticket niet gevonden' } });
    assert.deepEqual(r.calls, BASIS_CALLS);
    assert.deepEqual(r.pdfAanroepen, []);
  }
});

test('ticket-antwoord zonder JSON (ok): geen ontvangers -> 400', async () => {
  const r = await draai(post(BODY), { ticketRes: () => new Response('geen json', { status: 200 }) });
  assert.deepEqual(antw(r.res), { statusCode: 400, headers: CORS, body: GEEN_ADRES });
});

test('geen e-mailadres op het ticket -> 400 met exacte tekst, ook bij preview', async () => {
  for (const preview of [false, true]) {
    const r = await draai(post({ ...BODY, preview }), { ticket: { contact: {}, cf: {} } });
    assert.deepEqual(antw(r.res), { statusCode: 400, headers: CORS, body: GEEN_ADRES });
    assert.deepEqual(r.calls, BASIS_CALLS);
    assert.deepEqual(r.pdfAanroepen, []);
  }
});

// ---- verzendpad ----
test('verzending naar drie ontvangers: volledige aanroepenlijst, volgorde en antwoord', async () => {
  const r = await draai(post(BODY));
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(), replyCall('contact@x.be', 'ATT1'),
    uploadCall(), replyCall('klant@x.be', 'ATT2'),
    uploadCall(), replyCall('inst@x.be', 'ATT3'),
    PATCH_CALL,
  ]);
  // Projectregel: sendReply vóór de status-PATCH; de huidige volgorde is upload -> sendReply per ontvanger, dan PATCH.
  assert.deepEqual(kort(r.ruweCalls), [
    'POST TOKEN', 'GET /organizations', 'GET /tickets/555',
    'POST /uploads', 'POST /tickets/555/sendReply',
    'POST /uploads', 'POST /tickets/555/sendReply',
    'POST /uploads', 'POST /tickets/555/sendReply',
    'PATCH /tickets/555',
  ]);
  assert.deepEqual(antw(r.res), { statusCode: 200, headers: CORS, body: OK() });
  assert.deepEqual(r.pdfAanroepen, [HTML]); // één keer, met de html uit het verzoek
  assert.equal(r.mails[0], GOUD);
});

test('headers en JSON-sleutels: volgorde per soort aanroep', async () => {
  const r = await draai(post(BODY));
  const c = r.ruweCalls;
  assert.deepEqual(Object.keys(c[0].headers), ['Content-Type']);
  assert.deepEqual(Object.keys(c[1].headers), ['Authorization']);
  assert.deepEqual(Object.keys(c[2].headers), ['Authorization', 'orgId']);
  assert.deepEqual(Object.keys(c[3].headers), ['Authorization', 'orgId']); // upload: geen Content-Type
  assert.deepEqual(Object.keys(c[4].headers), ['Authorization', 'orgId', 'Content-Type']);
  assert.deepEqual(Object.keys(c.at(-1).headers), ['Authorization', 'orgId', 'Content-Type']);
  assert.deepEqual(Object.keys(JSON.parse(c[4].body)),
    ['channel', 'contentType', 'content', 'fromEmailAddress', 'to', 'attachmentIds']);
  assert.deepEqual(Object.keys(JSON.parse(c.at(-1).body)), ['status']);
  assert.deepEqual(Object.keys(JSON.parse(r.res.body)), ['success', 'emailSent', 'fouten', 'statusUpdated', 'statusFout']);
});

test('bestandsnaam valt terug op het ticketId zonder ticketNumber', async () => {
  const r = await draai(post({ ticketId: '555', html: HTML }), { ticket: EEN });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall('service-rapport-555.pdf'), replyCall('a@x.be', 'ATT1'),
    PATCH_CALL,
  ]);
  assert.deepEqual(antw(r.res).body, OK({ emailSent: ENKEL_CONTACT }));
});

test('de upload-id van elke ontvanger gaat in zijn eigen sendReply', async () => {
  const r = await draai(post(BODY), { uploadRes: n => json({ id: `ID-${n}` }) });
  const ids = r.calls.filter(c => c.url.endsWith('/sendReply')).map(c => JSON.parse(c.body).attachmentIds);
  assert.deepEqual(ids, [['ID-1'], ['ID-2'], ['ID-3']]);
});

test('geen duplicaatbeveiliging: een tweede aanroep verstuurt opnieuw (token uit cache, org opnieuw)', async () => {
  const { fn, calls } = maakNepFetch(maakRouter({ ticket: EEN }));
  const mod = await laadVers('send-rapport');
  const h = mod.maakHandler({ fetch: fn, maakPdf: async () => PDF });
  const a = await h(post(BODY));
  const b = await h(post(BODY));
  assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
  assert.deepEqual(kort(calls), [
    'POST TOKEN', 'GET /organizations', 'GET /tickets/555',
    'POST /uploads', 'POST /tickets/555/sendReply', 'PATCH /tickets/555',
    'GET /organizations', 'GET /tickets/555',
    'POST /uploads', 'POST /tickets/555/sendReply', 'PATCH /tickets/555',
  ]);
});

test('Empty Recipients is zacht: geen fout, geen emailSent, geen PATCH als niets verstuurd is', async () => {
  const r = await draai(post(BODY), {
    ticket: EEN,
    replyRes: () => json({ message: 'Empty Recipients found' }, 422),
  });
  assert.deepEqual(kort(r.ruweCalls).slice(3), ['POST /uploads', 'POST /tickets/555/sendReply']);
  assert.deepEqual(antw(r.res), {
    statusCode: 200, headers: CORS,
    body: OK({ emailSent: NIEMAND, statusUpdated: false }),
  });
  assert.deepEqual(r.gelogd, []);
});

test('Empty Recipients bij één ontvanger: de andere mails en de PATCH gaan door', async () => {
  const r = await draai(post(BODY), {
    replyRes: n => n === 2 ? json({ message: 'Empty Recipients' }, 400) : json({}),
  });
  assert.deepEqual(antw(r.res).body, OK({ emailSent: { contact: true, klant: false, installateur: true } }));
  assert.equal(r.calls.at(-1).method, 'PATCH');
});

test('upload-fout: foutmelding per ontvanger, geen sendReply voor hem, de rest gaat door', async () => {
  const r = await draai(post(BODY), {
    uploadRes: n => n === 1 ? json({ errorCode: 'BAD' }, 500) : json({ id: `ATT${n}` }),
  });
  assert.deepEqual(kort(r.ruweCalls).slice(3), [
    'POST /uploads',
    'POST /uploads', 'POST /tickets/555/sendReply',
    'POST /uploads', 'POST /tickets/555/sendReply',
    'PATCH /tickets/555',
  ]);
  const melding = 'Zoho attachment-upload fout (500) voor contact: {"errorCode":"BAD"}';
  assert.deepEqual(antw(r.res).body, OK({
    emailSent: { contact: false, klant: true, installateur: true },
    fouten: [{ doelgroep: 'contact', fout: melding }],
  }));
  assert.deepEqual(r.gelogd, ['Versturen naar contact mislukt: ' + melding]);
});

test('upload-antwoord zonder JSON-body: foutmelding met {}', async () => {
  const r = await draai(post(BODY), {
    ticket: EEN,
    uploadRes: () => new Response('boem', { status: 502 }),
  });
  assert.deepEqual(antw(r.res).body, OK({
    emailSent: NIEMAND, statusUpdated: false,
    fouten: [{ doelgroep: 'contact', fout: 'Zoho attachment-upload fout (502) voor contact: {}' }],
  }));
});

test('sendReply-fout: foutmelding per ontvanger, geen PATCH als niemand ontving', async () => {
  const r = await draai(post(BODY), {
    ticket: EEN,
    replyRes: () => json({ errorCode: 'NOPE' }, 400),
  });
  assert.deepEqual(kort(r.ruweCalls).slice(3), ['POST /uploads', 'POST /tickets/555/sendReply']);
  assert.deepEqual(antw(r.res), {
    statusCode: 200, headers: CORS,
    body: OK({
      emailSent: NIEMAND, statusUpdated: false,
      fouten: [{ doelgroep: 'contact', fout: 'Zoho sendReply fout (400) naar contact: {"errorCode":"NOPE"}' }],
    }),
  });
});

test('sendReply-fout zonder JSON-body of met lege body: {} in de melding', async () => {
  for (const rep of [() => new Response('geen json', { status: 500 }), () => new Response('', { status: 500 })]) {
    const r = await draai(post(BODY), { ticket: EEN, replyRes: rep });
    assert.deepEqual(antw(r.res).body.fouten, [{ doelgroep: 'contact', fout: 'Zoho sendReply fout (500) naar contact: {}' }]);
  }
});

test('sendReply-succes met lege of niet-JSON-body telt als verstuurd', async () => {
  for (const rep of [() => new Response('', { status: 200 }), () => new Response('ok', { status: 200 })]) {
    const r = await draai(post(BODY), { ticket: EEN, replyRes: rep });
    assert.deepEqual(antw(r.res).body, OK({ emailSent: ENKEL_CONTACT }));
  }
});

test('netwerkfout bij één ontvanger wordt opgevangen, de rest gaat door', async () => {
  const router = maakRouter();
  let uploads = 0;
  const r = await draai(post(BODY), {
    router: (url, opts) => {
      if (url.endsWith('/uploads') && ++uploads === 2) throw new Error('socket hang up');
      return router(url, opts);
    },
  });
  assert.deepEqual(antw(r.res).body, OK({
    emailSent: { contact: true, klant: false, installateur: true },
    fouten: [{ doelgroep: 'klant', fout: 'socket hang up' }],
  }));
});

test('PATCH-fout: 200 met statusFout, mails blijven gemeld', async () => {
  const r = await draai(post(BODY), {
    ticket: EEN,
    patchRes: () => json({ errorCode: 'FORBIDDEN' }, 403),
  });
  assert.equal(r.calls.at(-1).method, 'PATCH');
  const melding = 'Zoho PATCH fout (403): {"errorCode":"FORBIDDEN"}';
  assert.deepEqual(antw(r.res), {
    statusCode: 200, headers: CORS,
    body: OK({ emailSent: ENKEL_CONTACT, statusUpdated: false, statusFout: melding }),
  });
  assert.deepEqual(r.gelogd, ['Ticketstatus naar Gesloten - ov zetten mislukt: ' + melding]);
});

test('PATCH-fout zonder JSON-body en PATCH-netwerkfout', async () => {
  const a = await draai(post(BODY), { ticket: EEN, patchRes: () => new Response('boem', { status: 500 }) });
  assert.equal(antw(a.res).body.statusFout, 'Zoho PATCH fout (500): {}');
  const router = maakRouter({ ticket: EEN });
  const b = await draai(post(BODY), {
    router: (url, opts = {}) => { if (opts.method === 'PATCH') throw new Error('timeout'); return router(url, opts); },
  });
  assert.deepEqual(antw(b.res).body, OK({ emailSent: ENKEL_CONTACT, statusUpdated: false, statusFout: 'timeout' }));
});

test('PATCH-succes met lege antwoord-body telt als gelukt', async () => {
  const r = await draai(post(BODY), { ticket: EEN, patchRes: () => new Response('', { status: 200 }) });
  assert.equal(antw(r.res).body.statusUpdated, true);
});

// ---- PDF ----
test('PDF-fout -> 500 met die tekst; daarna geen upload, sendReply of PATCH', async () => {
  const r = await draai(post(BODY), { maakPdf: async () => { throw new Error('Chromium kapot'); } });
  assert.deepEqual(antw(r.res), { statusCode: 500, headers: CORS, body: { error: 'Chromium kapot' } });
  assert.deepEqual(r.calls, BASIS_CALLS);
});

// ---- from-adres ----
test('zonder ZOHO_FROM_EMAIL: emailAddresses-aanvraag voor de eerste upload, eerste geldige adres', async () => {
  const herstel = zetEnv({ ZOHO_FROM_EMAIL: undefined });
  try {
    const r = await draai(post(BODY), {
      ticket: EEN,
      emailRes: () => json({ data: [{ emailAddress: 'geen-adres' }, { emailAddress: 'van@blitz.be' }, { emailAddress: 'ander@blitz.be' }] }),
    });
    assert.deepEqual(r.calls, [
      TOKEN_CALL, ORG_CALL, TICKET_CALL, EMAILS_CALL,
      uploadCall(), replyCall('a@x.be', 'ATT1', 'van@blitz.be'),
      PATCH_CALL,
    ]);
    assert.deepEqual(antw(r.res).body, OK({ emailSent: ENKEL_CONTACT }));
  } finally { herstel(); }
});

test('zonder ZOHO_FROM_EMAIL en zonder geldig adres -> 500 met bestaande tekst, geen upload', async () => {
  const herstel = zetEnv({ ZOHO_FROM_EMAIL: undefined });
  try {
    for (const emailRes of [() => json({ data: [{ emailAddress: 'geen-adres' }] }), () => json({}), () => json({ data: [] })]) {
      const r = await draai(post(BODY), { emailRes });
      assert.deepEqual(antw(r.res), {
        statusCode: 500, headers: CORS,
        body: { error: 'Geen from-emailadres gevonden in Zoho. Stel ZOHO_FROM_EMAIL in als Netlify env-var.' },
      });
      assert.deepEqual(r.calls, [...BASIS_CALLS, EMAILS_CALL]);
    }
  } finally { herstel(); }
});

test('emailAddresses-antwoord zonder JSON -> 500 met de parse-fout', async () => {
  const herstel = zetEnv({ ZOHO_FROM_EMAIL: undefined });
  try {
    const r = await draai(post(BODY), { emailRes: () => new Response('geen json', { status: 200 }) });
    assert.equal(r.res.statusCode, 500);
    assert.match(JSON.parse(r.res.body).error, /JSON/);
  } finally { herstel(); }
});

// ---- token, org en netwerk ----
test('tokenfout met data -> 500 met de volledige Zoho-data, geen verdere aanroepen', async () => {
  const r = await draai(post(BODY), { router: url => url.includes('oauth') ? json({ error: 'invalid_code' }) : undefined });
  assert.deepEqual(antw(r.res), { statusCode: 500, headers: CORS, body: { error: 'Token refresh mislukt: {"error":"invalid_code"}' } });
  assert.deepEqual(r.calls, [TOKEN_CALL]);
});

test('token-antwoord zonder JSON -> 500 met de parse-fout', async () => {
  const r = await draai(post(BODY), { router: url => url.includes('oauth') ? new Response('geen json', { status: 502 }) : undefined });
  assert.equal(r.res.statusCode, 500);
  assert.match(JSON.parse(r.res.body).error, /JSON/);
  assert.deepEqual(r.calls, [TOKEN_CALL]);
});

test('organisatiefout -> 500 met exacte tekst, geen ticket-GET', async () => {
  for (const org of [() => json({ data: [] }), () => json({})]) {
    const r = await draai(post(BODY), { router: url => url.endsWith('/organizations') ? org() : undefined });
    assert.deepEqual(antw(r.res), { statusCode: 500, headers: CORS, body: { error: 'Zoho org ID niet gevonden' } });
    assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  }
});

test('netwerkfout bij token en ticket-GET -> 500 met de foutmelding', async () => {
  const a = await draai(post(BODY), { router: url => { if (url.includes('oauth')) throw new Error('ENOTFOUND'); } });
  assert.deepEqual(antw(a.res), { statusCode: 500, headers: CORS, body: { error: 'ENOTFOUND' } });
  const router = maakRouter();
  const b = await draai(post(BODY), { router: (url, o = {}) => { if (url.endsWith('/tickets/555')) throw new Error('ECONNRESET'); return router(url, o); } });
  assert.deepEqual(antw(b.res), { statusCode: 500, headers: CORS, body: { error: 'ECONNRESET' } });
  assert.deepEqual(b.calls, BASIS_CALLS);
});

test('de omgevingsvariabelen komen letterlijk in de token-aanvraag', async () => {
  const herstel = zetEnv({ ZOHO_REFRESH_TOKEN: 'r/t', ZOHO_CLIENT_ID: 'c id', ZOHO_CLIENT_SECRET: 's&s' });
  try {
    const r = await draai(post({ ...BODY, preview: true }));
    assert.equal(r.calls[0].body, 'refresh_token=r%2Ft&client_id=c+id&client_secret=s%26s&grant_type=refresh_token');
  } finally { herstel(); }
});
