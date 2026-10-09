// Karakterisering van propose (etappe 6, taak 6). W11-gevoelig: verstuurt klantmails en schrijft
// de Zoho-status. Elke test controleert de VOLLEDIGE lijst uitgaande aanroepen (methode, url,
// headers, body) en het volledige antwoord. De mail-HTML staat als '<mail>' in die lijst en wordt apart
// gecontroleerd: één goudkopie (tests/fixtures/propose-mail-contact.html) plus letterlijke fragmenten.
// Nooit echte netwerkaanroepen of mails.
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { maakNepFetch, metGlobaleFetch, laadVers, v1Event, zetEnv } from './nep-fetch.mjs';
import { maakNepStore } from './nep-blobs.mjs';

const NU = Date.parse('2026-10-01T10:00:00.000Z');
const EXP = Math.floor(NU / 1000) + 14 * 24 * 60 * 60;
const SECRET = 'geheim-voor-test';
const BASIS = 'https://blitz.test';
const DESK = 'https://desk.zoho.eu/api/v1';
const PDF_NAAM = 'Service Voorwaarden Blitz Power.pdf';
const PDF_GROOTTE = fs.statSync(new URL('../netlify/functions/assets/service-voorwaarden.pdf', import.meta.url)).size;
const FROM = 'service@blitz.test';

const TOKEN_CALL = {
  method: 'POST',
  url: 'https://accounts.zoho.eu/oauth/v2/token',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'refresh_token=RT&client_id=CID&client_secret=SEC&grant_type=refresh_token',
};
const ORG_CALL = { method: 'GET', url: `${DESK}/organizations`, headers: { Authorization: 'Zoho-oauthtoken TOK' }, body: undefined };
const TICKET_CALL = { method: 'GET', url: `${DESK}/tickets/555`, headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' }, body: undefined };
const JSON_HEADERS = { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1', 'Content-Type': 'application/json' };
const uploadCall = () => ({
  method: 'POST', url: `${DESK}/uploads`,
  headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' },
  body: [['file', PDF_NAAM, 'application/pdf', PDF_GROOTTE]],
});
const replyCall = (to, attId, from = FROM) => ({
  method: 'POST', url: `${DESK}/tickets/555/sendReply`, headers: JSON_HEADERS,
  body: JSON.stringify({ channel: 'EMAIL', contentType: 'html', content: '<mail>', fromEmailAddress: from, to, attachmentIds: [attId] }),
});
const patchCall = (utc = '2026-10-14T07:15:00.000Z') => ({
  method: 'PATCH', url: `${DESK}/tickets/555`, headers: JSON_HEADERS,
  body: JSON.stringify({ status: 'Wachten op bevestiging planning', cf: { cf_interventie_datm: utc } }),
});
const EMAILS_CALL = { method: 'GET', url: `${DESK}/emailAddresses?limit=50`, headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' }, body: undefined };

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const uit = calls => calls.map(c => ({ method: c.method, url: c.url, headers: c.headers, body: c.body }));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
const kort = calls => calls.map(c => c.method + ' ' + c.url.replace(DESK, ''));

// ---- letterlijke verwachtingen voor de mail (geen kopie van het sjabloon) ----
// Links zijn gegenereerd door de code van VOOR de migratie (b516635) met secret 'geheim-voor-test',
// URL https://blitz.test en de bevroren klok (exp = 2026-10-15T10:00:00Z).
const LINKS = {
  contact: 'https://blitz.test/api/confirm-afspraak?ticketId=555&date=2026-10-14&exp=1792058400&d=contact&sig=337de2d3e8b9ae058dc60a8b78366314ed9a16b5c6287e7ae609565cd4cb6071',
  klant: 'https://blitz.test/api/confirm-afspraak?ticketId=555&date=2026-10-14&exp=1792058400&d=klant&sig=68dc3651be680c086647e8557a4e9500f8075312df64c3c94a899c19d1391a89',
  installateur: 'https://blitz.test/api/confirm-afspraak?ticketId=555&date=2026-10-14&exp=1792058400&d=installateur&sig=eb1d6ebe450e1072ad247cf558486c412bb78147816166071f16646723d6a265',
};
const GOUD = fs.readFileSync(new URL('./fixtures/propose-mail-contact.html', import.meta.url), 'utf8')
  .split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)); // autocrlf-veilig

// Controleert de letterlijke inhoudsfragmenten van één mail.
function controleerMail(mail, { naam = 'Jan Peeters', tijdslot = '09:00–12:00', serienummer = 'SN123', link, datum = 'woensdag 14 oktober 2026' } = {}) {
  assert.ok(mail.includes(`Geachte ${naam},`), 'aanhef met naam');
  assert.ok(mail.includes(datum), 'datum');
  assert.ok(mail.includes(`tussen <strong>${tijdslot}</strong> uur`), 'tijdslot');
  if (serienummer) assert.ok(mail.includes(`Serienummer: ${serienummer}</div>`), 'serienummer');
  else assert.ok(!mail.includes('Serienummer'), 'geen serienummer');
  assert.ok(mail.includes('Team Blitz Power &mdash; Service &amp; Support'), 'afzender');
  assert.ok(mail.includes('+32 3 36 16 404') && mail.includes('www.blitzpower.com'), 'footer');
  if (link) {
    assert.ok(mail.includes(`<a href="${link}"`), 'bevestigingslink');
    assert.ok(mail.includes('✅ Bevestig deze afspraak'), 'knop');
    assert.ok(mail.includes('Klik op de knop hierboven'), 'tekst bij knop');
  } else {
    assert.ok(!mail.includes('Bevestig deze afspraak') && !mail.includes('/api/confirm-afspraak'), 'geen knop');
    assert.ok(mail.includes('Gelieve deze afspraak te bevestigen door op deze e-mail te antwoorden.'), 'tekst zonder knop');
  }
}

const BODY = {
  ticketId: '555', date: '2026-10-14', time: '09:10', recipientName: 'Jan Peeters',
  subject: 'FW: Laadpaal defect', serienummer: 'SN123',
  utcInterventieDatum: '2026-10-14T07:15:00.000Z', appointmentWindow: '09:00–12:00',
};
const TICKET3 = {
  contact: { email: 'contact@x.be' },
  cf: { cf_e_mail_eindklant: 'klant@x.be', cf_e_mail_installateur: 'inst@x.be' },
};

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
let fouten;
test.beforeEach(() => {
  herstelEnv = zetEnv({
    ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC',
    ZOHO_FROM_EMAIL: FROM, CONFIRM_LINK_SECRET: SECRET, URL: BASIS,
  });
  mock.timers.enable({ apis: ['Date'], now: NU });
  fouten = mock.method(console, 'error', () => {});
});
test.afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  herstelEnv();
});

async function draai(event, opts = {}) {
  const { fn, calls } = maakNepFetch(opts.router || maakRouter(opts));
  const mod = await laadVers('propose');
  const res = await metGlobaleFetch(fn, () => mod.maakHandler({ getStore: () => maakNepStore() })(event)); // T12: de activiteitenlog gaat naar een nep-store
  // De mail-HTML gaat naar r.mails; in r.calls staat daar '<mail>' (de rest van het verzoek blijft exact).
  const mails = [];
  const uitgaand = uit(calls).map(c => {
    if (!c.url.endsWith('/sendReply')) return c;
    const b = JSON.parse(c.body);
    mails.push(b.content);
    return { ...c, body: JSON.stringify({ ...b, content: '<mail>' }) };
  });
  return { res, calls: uitgaand, mails, mod, fn };
}
const post = (body, headers) => v1Event('POST', body, headers);
const antw = res => ({ statusCode: res.statusCode, headers: res.headers, body: JSON.parse(res.body) });

const OK = (over = {}) => ({
  success: true, ticketId: '555', interventieDatum: '2026-10-14T07:15:00.000Z', appointmentTime: '09:15',
  emailSent: { contact: true, klant: true, installateur: true }, fouten: [],
  ontvangers: ['contact', 'klant', 'installateur'], ...over,
});
const ok200 = over => ({ statusCode: 200, headers: CORS, body: JSON.stringify(OK(over)) });

// ================================================================ methoden en validatie ====
test('propose: OPTIONS en 405 (JSON) zonder aanvragen', async () => {
  let r = await draai(v1Event('OPTIONS'));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.res, { statusCode: 204, headers: CORS });

  r = await draai(v1Event('GET'));
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.res, { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) });
});

test('propose: 400 bij ontbrekend ticketId of date, ongeldig ticketId; lege body; geen aanvragen', async () => {
  for (const [body, fout] of [
    [{ date: '2026-10-14' }, 'ticketId en date zijn verplicht'],
    [{ ticketId: '555' }, 'ticketId en date zijn verplicht'],
    [undefined, 'ticketId en date zijn verplicht'],
    [{ ticketId: '55x', date: '2026-10-14' }, 'Ongeldig ticketId'],
    [{ ticketId: '../5', date: '2026-10-14' }, 'Ongeldig ticketId'],
  ]) {
    const r = await draai(post(body));
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.res, { statusCode: 400, headers: CORS, body: JSON.stringify({ error: fout }) });
  }
});

test('propose: ongeldige JSON in de body geeft 500 met de parsefout, zonder aanvragen', async () => {
  const r = await draai(post('{kapot'));
  assert.deepEqual(r.calls, []);
  const a = antw(r.res);
  assert.equal(a.statusCode, 500);
  assert.match(a.body.error, /JSON/);
});

// ====================================================================== testmodus ====
test('propose: testmodus doet nul aanvragen; tijd naar volgend kwartier; interventieDatum-terugval', async () => {
  const kop = { 'X-Blitz-Test': '1' };
  const geval = [
    [{ ticketId: '555', date: '2026-10-14', time: '09:10', utcInterventieDatum: '2026-10-14T07:15:00.000Z' }, '2026-10-14T07:15:00.000Z', '09:15'],
    [{ ticketId: '555', date: '2026-10-14', time: '09:10' }, '2026-10-14T09:15:00.000Z', '09:15'],
    [{ ticketId: '555', date: '2026-10-14' }, '2026-10-14T09:00:00.000Z', '09:00'],
    [{ ticketId: '555', date: '2026-10-14', time: '23:50' }, '2026-10-14T00:00:00.000Z', '00:00'],
    [{ ticketId: '555', date: '2026-10-14', time: '10:00' }, '2026-10-14T10:00:00.000Z', '10:00'],
    [{ ticketId: '555', date: '2026-10-14', time: 'xx:yy' }, '2026-10-14T09:00:00.000Z', '09:00'],
  ];
  for (const [body, interventieDatum, appointmentTime] of geval) {
    const r = await draai(post(body, kop));
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.res, {
      statusCode: 200, headers: CORS,
      body: JSON.stringify({
        ok: true, test: true, success: true, ticketId: '555', interventieDatum, appointmentTime,
        emailSent: { contact: true, klant: false, installateur: false }, fouten: [], ontvangers: ['contact'],
      }),
    });
  }
  // headernaam hoofdletterongevoelig
  const r = await draai(post(BODY, { 'x-blitz-test': '1' }));
  assert.deepEqual(r.calls, []);
  assert.equal(JSON.parse(r.res.body).test, true);
});

test('propose: testmodus valideert eerst (400 vóór de testmodus-tak)', async () => {
  const r = await draai(post({ date: '2026-10-14' }, { 'X-Blitz-Test': '1' }));
  assert.deepEqual(r.calls, []);
  assert.equal(r.res.statusCode, 400);
});

// ================================================================= echt pad: ontvangers ====
test('propose: drie verschillende ontvangers: per ontvanger upload dan sendReply, daarna één PATCH', async () => {
  const r = await draai(post(BODY));
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(), replyCall('contact@x.be', 'ATT1'),
    uploadCall(), replyCall('klant@x.be', 'ATT2'),
    uploadCall(), replyCall('inst@x.be', 'ATT3'),
    patchCall(),
  ]);
  assert.deepEqual(r.res, ok200());
  assert.equal(r.mails.length, 3);
  controleerMail(r.mails[0], { link: LINKS.contact });
  controleerMail(r.mails[1], { link: LINKS.klant });
  controleerMail(r.mails[2], { link: LINKS.installateur });
  // projectregel: sendReply vóór de status-PATCH
  const idxPatch = r.calls.findIndex(c => c.method === 'PATCH');
  const idxLaatsteReply = r.calls.map(c => c.url.endsWith('/sendReply')).lastIndexOf(true);
  assert.ok(idxLaatsteReply < idxPatch);
  assert.equal(idxPatch, r.calls.length - 1);
  assert.deepEqual(fouten.mock.calls, []);
});

test('propose: standaardmail voor contact is byte-identiek aan de goudkopie (gegenereerd door de code van vóór de migratie)', async () => {
  const r = await draai(post(BODY), { ticket: { contact: { email: 'contact@x.be' } } });
  assert.equal(r.mails.length, 1);
  assert.equal(r.mails[0], GOUD);
  controleerMail(GOUD, { link: LINKS.contact });
});

test('propose: zonder appointmentWindow toont de mail de afgeronde tijd; lege naam wordt "klant"; HTML wordt ge-escaped', async () => {
  const body = { ticketId: '555', date: '2026-10-14', time: '09:10', subject: 'Laad <b>paal</b> "X" & Y' };
  const r = await draai(post(body), { ticket: { contact: { email: 'contact@x.be' } } });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(),
    replyCall('contact@x.be', 'ATT1'),
    patchCall('2026-10-14T09:15:00.000Z'),
  ]);
  const inhoud = r.mails[0];
  controleerMail(inhoud, { naam: 'klant', tijdslot: '09:15', serienummer: '', link: LINKS.contact });
  assert.ok(inhoud.includes('Laad &lt;b&gt;paal&lt;/b&gt; &quot;X&quot; &amp; Y'));
  assert.ok(!inhoud.includes('<b>paal</b>'));
  assert.equal(r.res.statusCode, 200);
});

test('propose: onderwerp wordt opgekuist (FW:/RE:, contactbericht, leeg)', async () => {
  const geval = [
    ['RE: FW: Fwd: Storing', 'Storing'],
    ['Nieuw contactbericht van Jan', 'uw laadstation'],
    ['', 'uw laadstation'],
    [undefined, 'uw laadstation'],
  ];
  for (const [subject, verwacht] of geval) {
    const r = await draai(post({ ...BODY, subject }), { ticket: { contact: { email: 'c@x.be' } } });
    assert.ok(r.mails[0].includes(`Wij plannen een servicebezoek voor: <strong style="color:#181e24">${verwacht}</strong>.`));
    controleerMail(r.mails[0], { link: LINKS.contact });
  }
});

test('propose: contact gelijk aan klant (hoofdletterongevoelig) wordt ontdubbeld; contact.emailId en ticket.email als terugval', async () => {
  const r = await draai(post(BODY), { ticket: {
    contact: { email: 'Klant@X.be' },
    cf: { cf_e_mail_eindklant: 'klant@x.be', cf_e_mail_installateur: 'inst@x.be' },
  } });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(), replyCall('Klant@X.be', 'ATT1'),
    uploadCall(), replyCall('inst@x.be', 'ATT2'),
    patchCall(),
  ]);
  assert.deepEqual(r.res, ok200({
    emailSent: { contact: true, klant: false, installateur: true }, ontvangers: ['contact', 'installateur'],
  }));
  controleerMail(r.mails[0], { link: LINKS.contact });
  controleerMail(r.mails[1], { link: LINKS.installateur });

  let r2 = await draai(post(BODY), { ticket: { contact: { emailId: 'id@x.be' } } });
  assert.equal(JSON.parse(r2.calls[4].body).to, 'id@x.be');
  r2 = await draai(post(BODY), { ticket: { email: 'top@x.be' } });
  assert.equal(JSON.parse(r2.calls[4].body).to, 'top@x.be');
  assert.deepEqual(JSON.parse(r2.res.body).ontvangers, ['contact']);
});

test('propose: installateur gelijk aan klant telt als één ontvanger (klant behouden)', async () => {
  const r = await draai(post(BODY), { ticket: {
    cf: { cf_e_mail_eindklant: 'zelfde@x.be', cf_e_mail_installateur: 'ZELFDE@x.be' },
  } });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(), replyCall('zelfde@x.be', 'ATT1'),
    patchCall(),
  ]);
  assert.deepEqual(r.res, ok200({
    emailSent: { contact: false, klant: true, installateur: false }, ontvangers: ['klant'],
  }));
  controleerMail(r.mails[0], { link: LINKS.klant });
});

test('propose: alleen contact', async () => {
  const r = await draai(post(BODY), { ticket: { contact: { email: 'contact@x.be' }, cf: {} } });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(), replyCall('contact@x.be', 'ATT1'),
    patchCall(),
  ]);
  assert.deepEqual(r.res, ok200({
    emailSent: { contact: true, klant: false, installateur: false }, ontvangers: ['contact'],
  }));
  assert.equal(r.mails[0], GOUD);
});

test('propose: alleen klant en installateur, zonder contact', async () => {
  const r = await draai(post(BODY), { ticket: { cf: { cf_e_mail_eindklant: 'klant@x.be', cf_e_mail_installateur: 'inst@x.be' } } });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(), replyCall('klant@x.be', 'ATT1'),
    uploadCall(), replyCall('inst@x.be', 'ATT2'),
    patchCall(),
  ]);
  assert.deepEqual(r.res, ok200({
    emailSent: { contact: false, klant: true, installateur: true }, ontvangers: ['klant', 'installateur'],
  }));
  controleerMail(r.mails[0], { link: LINKS.klant });
  controleerMail(r.mails[1], { link: LINKS.installateur });
});

test('propose: geen enkele ontvanger: enkel de PATCH, geen mail', async () => {
  const r = await draai(post(BODY), { ticket: {} });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, TICKET_CALL, patchCall()]);
  assert.deepEqual(r.res, ok200({
    emailSent: { contact: false, klant: false, installateur: false }, ontvangers: [],
  }));
});

// ================================================================ from-adres ====
test('propose: zonder ZOHO_FROM_EMAIL volgt emailAddresses?limit=50 en gebruikt het eerste geldige adres', async () => {
  const herstel = zetEnv({ ZOHO_FROM_EMAIL: undefined });
  try {
    const r = await draai(post(BODY), {
      ticket: { contact: { email: 'contact@x.be' } },
      emailRes: () => json({ data: [{ emailAddress: 'geen-adres' }, {}, { emailAddress: 'support@blitz.test' }, { emailAddress: 'ander@blitz.test' }] }),
    });
    assert.deepEqual(r.calls, [
      TOKEN_CALL, ORG_CALL, TICKET_CALL, EMAILS_CALL,
      uploadCall(), replyCall('contact@x.be', 'ATT1', 'support@blitz.test'),
      patchCall(),
    ]);
    assert.deepEqual(r.res, ok200({
      emailSent: { contact: true, klant: false, installateur: false }, ontvangers: ['contact'],
    }));
    assert.equal(r.mails[0], GOUD);
  } finally { herstel(); }
});

test('propose: zonder ZOHO_FROM_EMAIL en zonder adres: 500 met de bestaande tekst, geen mail, geen PATCH', async () => {
  const herstel = zetEnv({ ZOHO_FROM_EMAIL: undefined });
  const tekst = n => `Geen from-emailadres gevonden in Zoho (${n} adressen opgehaald). Stel ZOHO_FROM_EMAIL in als Netlify env-var om dit te omzeilen.`;
  try {
    for (const [emailRes, n] of [
      [() => json({ data: [{ emailAddress: 'zonder-at' }] }), 1],
      [() => json({}), 0],
      [() => json({ data: [] }), 0],
      [undefined, 0],   // nep-404 met {}
    ]) {
      const r = await draai(post(BODY), { emailRes });
      assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, TICKET_CALL, EMAILS_CALL]);
      assert.deepEqual(r.res, { statusCode: 500, headers: CORS, body: JSON.stringify({ error: tekst(n) }) });
    }
  } finally { herstel(); }
});

// ======================================================= zachte en harde mailfouten ====
test('propose: "Empty Recipients" is een zachte fout: emailSent false, PATCH gebeurt toch', async () => {
  const r = await draai(post(BODY), {
    ticket: { contact: { email: 'contact@x.be' } },
    replyRes: () => json({ errorCode: 'UNPROCESSABLE_ENTITY', message: 'Empty Recipients' }, 422),
  });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(), replyCall('contact@x.be', 'ATT1'),
    patchCall(),
  ]);
  assert.deepEqual(r.res, ok200({
    emailSent: { contact: false, klant: false, installateur: false }, fouten: [], ontvangers: ['contact'],
  }));
});

test('propose: harde sendReply-fout bij ontvanger 2 komt in fouten; ontvanger 1 en 3 en de PATCH gebeuren toch', async () => {
  const foutBody = { errorCode: 'X', message: 'kapot' };
  const r = await draai(post(BODY), {
    replyRes: n => n === 2 ? json(foutBody, 500) : json({}),
  });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(), replyCall('contact@x.be', 'ATT1'),
    uploadCall(), replyCall('klant@x.be', 'ATT2'),
    uploadCall(), replyCall('inst@x.be', 'ATT3'),
    patchCall(),
  ]);
  const fout = `Zoho sendReply fout (500) naar klant: ${JSON.stringify(foutBody)}`;
  assert.deepEqual(r.res, ok200({
    emailSent: { contact: true, klant: false, installateur: true },
    fouten: [{ doelgroep: 'klant', fout }],
  }));
  assert.deepEqual(fouten.mock.calls.map(c => c.arguments), [['Versturen naar klant mislukt:', fout]]);
});

test('propose: sendReply-fout met lege of niet-JSON body geeft {} in de foutmelding', async () => {
  const een = { contact: { email: 'c@x.be' } };
  let r = await draai(post(BODY), { ticket: een, replyRes: () => new Response('', { status: 503 }) });
  assert.deepEqual(JSON.parse(r.res.body).fouten, [{ doelgroep: 'contact', fout: 'Zoho sendReply fout (503) naar contact: {}' }]);
  r = await draai(post(BODY), { ticket: een, replyRes: () => new Response('<html>nee</html>', { status: 502 }) });
  assert.deepEqual(JSON.parse(r.res.body).fouten, [{ doelgroep: 'contact', fout: 'Zoho sendReply fout (502) naar contact: {}' }]);
  // lege 200-body telt als succes
  r = await draai(post(BODY), { ticket: een, replyRes: () => new Response('', { status: 200 }) });
  assert.deepEqual(JSON.parse(r.res.body).emailSent, { contact: true, klant: false, installateur: false });
});

test('propose: sendReply-antwoord met JSON null als body telt als succes (huidig gedrag)', async () => {
  const r = await draai(post(BODY), { ticket: { contact: { email: 'c@x.be' } }, replyRes: () => new Response('null', { status: 200 }) });
  assert.deepEqual(JSON.parse(r.res.body).emailSent, { contact: true, klant: false, installateur: false });
  assert.deepEqual(JSON.parse(r.res.body).fouten, []);
  // en bij een foutstatus: JSON.stringify(null) = "null" in de melding
  const f = await draai(post(BODY), { ticket: { contact: { email: 'c@x.be' } }, replyRes: () => new Response('null', { status: 500 }) });
  assert.deepEqual(JSON.parse(f.res.body).fouten, [{ doelgroep: 'contact', fout: 'Zoho sendReply fout (500) naar contact: null' }]);
});

test('propose: mislukte upload slaat sendReply voor die ontvanger over; volgende ontvanger en PATCH gaan door', async () => {
  const r = await draai(post(BODY), {
    ticket: { contact: { email: 'contact@x.be' }, cf: { cf_e_mail_eindklant: 'klant@x.be' } },
    uploadRes: n => n === 1 ? json({ message: 'te groot' }, 400) : json({ id: 'ATT2' }),
  });
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, TICKET_CALL,
    uploadCall(),
    uploadCall(), replyCall('klant@x.be', 'ATT2'),
    patchCall(),
  ]);
  assert.deepEqual(r.res, ok200({
    emailSent: { contact: false, klant: true, installateur: false },
    fouten: [{ doelgroep: 'contact', fout: `Zoho attachment-upload fout (400): ${JSON.stringify({ message: 'te groot' })}` }],
    ontvangers: ['contact', 'klant'],
  }));
});

test('propose: netwerkfout bij sendReply komt in fouten; PATCH gebeurt toch', async () => {
  const r = await draai(post(BODY), { router: (url, opts = {}) => {
    if (url.endsWith('/tickets/555') && !opts.method) return json({ contact: { email: 'contact@x.be' } });
    if (url.endsWith('/uploads')) return json({ id: 'ATT1' });
    if (url.endsWith('/sendReply')) throw new Error('netwerk weg');
    if (opts.method === 'PATCH') return json({});
    return undefined;
  } });
  assert.equal(r.calls.at(-1).method, 'PATCH');
  assert.deepEqual(r.res, ok200({
    emailSent: { contact: false, klant: false, installateur: false },
    fouten: [{ doelgroep: 'contact', fout: 'netwerk weg' }], ontvangers: ['contact'],
  }));
});

// ========================================================================= PATCH ====
test('propose: PATCH-fout geeft 500 "Zoho PATCH fout (<status>): {…}" en meldt welke mails vertrokken zijn', async () => {
  const foutBody = { errorCode: 'INVALID_DATA', message: 'slecht' };
  let r = await draai(post(BODY), {
    ticket: { contact: { email: 'contact@x.be' } },
    patchRes: () => json(foutBody, 422),
  });
  assert.deepEqual(kort(r.calls), [
    'POST https://accounts.zoho.eu/oauth/v2/token', 'GET /organizations', 'GET /tickets/555',
    'POST /uploads', 'POST /tickets/555/sendReply', 'PATCH /tickets/555',
  ]);
  // B2: de mail is weg, enkel de ticket-update faalde: de body noemt welke mails vertrokken zijn (sleutelvolgorde vast).
  assert.deepEqual(r.res, { statusCode: 500, headers: CORS,
    body: JSON.stringify({
      error: `Zoho PATCH fout (422): ${JSON.stringify(foutBody)}`,
      emailSent: { contact: true, klant: false, installateur: false }, fouten: [], ontvangers: ['contact'],
    }) });

  r = await draai(post(BODY), { ticket: {}, patchRes: () => new Response('', { status: 500 }) });
  assert.equal(JSON.parse(r.res.body).error, 'Zoho PATCH fout (500): {}');
  r = await draai(post(BODY), { ticket: {}, patchRes: () => new Response('geen json', { status: 400 }) });
  assert.equal(JSON.parse(r.res.body).error, 'Zoho PATCH fout (400): {}');
  // lege 204 is geslaagd
  r = await draai(post(BODY), { ticket: {}, patchRes: () => new Response(null, { status: 204 }) });
  assert.equal(r.res.statusCode, 200);
});

test('propose: PATCH-fout zonder enige geslaagde mail (geen ontvangers): zelfde velden met alles false en ontvangers []', async () => {
  const r = await draai(post(BODY), { ticket: {}, patchRes: () => json({ message: 'kapot' }, 500) });
  assert.equal(r.res.statusCode, 500);
  assert.deepEqual(r.res, { statusCode: 500, headers: CORS,
    body: JSON.stringify({
      error: `Zoho PATCH fout (500): ${JSON.stringify({ message: 'kapot' })}`,
      emailSent: { contact: false, klant: false, installateur: false }, fouten: [], ontvangers: [],
    }) });
});

test('propose: PATCH-fout nadat één van twee ontvangers faalde: emailSent en fouten geven beide kanten weer', async () => {
  const r = await draai(post(BODY), {
    ticket: { contact: { email: 'contact@x.be' }, cf: { cf_e_mail_eindklant: 'klant@x.be' } },
    uploadRes: n => n === 1 ? json({ message: 'te groot' }, 400) : json({ id: 'ATT2' }),
    patchRes: () => json({ message: 'kapot' }, 500),
  });
  assert.deepEqual(r.res, { statusCode: 500, headers: CORS,
    body: JSON.stringify({
      error: `Zoho PATCH fout (500): ${JSON.stringify({ message: 'kapot' })}`,
      emailSent: { contact: false, klant: true, installateur: false },
      fouten: [{ doelgroep: 'contact', fout: `Zoho attachment-upload fout (400): ${JSON.stringify({ message: 'te groot' })}` }],
      ontvangers: ['contact', 'klant'],
    }) });
});

test('propose: een netwerkfout (exception) bij de PATCH meldt ook welke mails vertrokken zijn', async () => {
  const r = await draai(post(BODY), { ticket: { contact: { email: 'contact@x.be' } }, patchRes: () => { throw new Error('netwerk weg'); } });
  assert.deepEqual(JSON.parse(r.res.body), {
    error: 'netwerk weg', emailSent: { contact: true, klant: false, installateur: false }, fouten: [], ontvangers: ['contact'],
  });
  assert.equal(r.res.statusCode, 500);
});

// ================================================================ token, org, ticket ====
test('propose: ticket niet gevonden geeft 404; geen mail en geen PATCH', async () => {
  for (const status of [404, 500]) {
    const r = await draai(post(BODY), { ticketRes: () => json({ message: 'nee' }, status) });
    assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, TICKET_CALL]);
    assert.deepEqual(r.res, { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Ticket niet gevonden' }) });
  }
  // ticketantwoord ok maar geen JSON: lege ticketdata, geen ontvangers
  const r = await draai(post(BODY), { ticketRes: () => new Response('geen json', { status: 200 }) });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, TICKET_CALL, patchCall()]);
  assert.equal(r.res.statusCode, 200);
});

test('propose: tokenfout geeft 500 mét data in de tekst; org-fout 500 met vaste tekst', async () => {
  let r = await draai(post(BODY), {
    router: url => url.includes('oauth/v2/token') ? json({ error: 'invalid_code' }) : undefined,
  });
  assert.deepEqual(r.calls, [TOKEN_CALL]);
  assert.deepEqual(r.res, { statusCode: 500, headers: CORS,
    body: JSON.stringify({ error: 'Token refresh mislukt: {"error":"invalid_code"}' }) });

  r = await draai(post(BODY), {
    router: url => url.endsWith('/organizations') ? json({ data: [] }) : undefined,
  });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL]);
  assert.deepEqual(r.res, { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Zoho org ID niet gevonden' }) });

  r = await draai(post(BODY), {
    router: url => url.endsWith('/organizations') ? json({}) : undefined,
  });
  assert.equal(JSON.parse(r.res.body).error, 'Zoho org ID niet gevonden');
});

test('propose: netwerkfout bij token of ticket geeft 500 met de foutmelding', async () => {
  let r = await draai(post(BODY), { router: url => { if (url.includes('oauth')) throw new Error('geen verbinding'); } });
  assert.deepEqual(r.res, { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'geen verbinding' }) });
  r = await draai(post(BODY), { router: url => { if (url.endsWith('/tickets/555')) throw new Error('ticket weg'); } });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, TICKET_CALL]);
  assert.deepEqual(r.res, { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ticket weg' }) });
});

test('propose: tokencache binnen dezelfde module: tweede aanroep vraagt geen nieuw token (org-id wel opnieuw)', async () => {
  const { fn, calls } = maakNepFetch(maakRouter({ ticket: {} }));
  const mod = await laadVers('propose');
  await metGlobaleFetch(fn, async () => { const h = mod.maakHandler({ getStore: () => maakNepStore() }); await h(post(BODY)); await h(post(BODY)); });
  assert.deepEqual(kort(uit(calls)), [
    'POST https://accounts.zoho.eu/oauth/v2/token', 'GET /organizations', 'GET /tickets/555', 'PATCH /tickets/555',
    'GET /organizations', 'GET /tickets/555', 'PATCH /tickets/555',
  ]);
});

// ============================================================== bevestigingslink-varianten ====
test('propose: zonder CONFIRM_LINK_SECRET geen bevestigingsknop, rest ongewijzigd; fout wordt gelogd', async () => {
  const herstel = zetEnv({ CONFIRM_LINK_SECRET: undefined });
  try {
    const r = await draai(post(BODY), { ticket: { contact: { email: 'contact@x.be' }, cf: { cf_e_mail_eindklant: 'klant@x.be' } } });
    assert.deepEqual(r.calls, [
      TOKEN_CALL, ORG_CALL, TICKET_CALL,
      uploadCall(), replyCall('contact@x.be', 'ATT1'),
      uploadCall(), replyCall('klant@x.be', 'ATT2'),
      patchCall(),
    ]);
    assert.equal(r.mails.length, 2);
    controleerMail(r.mails[0], {});
    controleerMail(r.mails[1], {});
    assert.deepEqual(r.res, ok200({
      emailSent: { contact: true, klant: true, installateur: false }, ontvangers: ['contact', 'klant'],
    }));
    assert.deepEqual(fouten.mock.calls.map(c => c.arguments), [
      ['Bevestigingslink niet gegenereerd:', 'CONFIRM_LINK_SECRET niet geconfigureerd'],
      ['Bevestigingslink niet gegenereerd:', 'CONFIRM_LINK_SECRET niet geconfigureerd'],
    ]);
  } finally { herstel(); }
});

test('propose: zonder URL valt de linkbasis terug op http://localhost:8888', async () => {
  const herstel = zetEnv({ URL: undefined });
  try {
    const r = await draai(post(BODY), { ticket: { contact: { email: 'contact@x.be' } } });
    assert.deepEqual(r.calls, [
      TOKEN_CALL, ORG_CALL, TICKET_CALL,
      uploadCall(), replyCall('contact@x.be', 'ATT1'),
      patchCall(),
    ]);
    controleerMail(r.mails[0], { link: LINKS.contact.replace('https://blitz.test', 'http://localhost:8888') });
    assert.ok(r.mails[0].includes('<a href="http://localhost:8888/api/confirm-afspraak?ticketId=555&date=2026-10-14&exp=1792058400&d=contact&sig=337de2d3e8b9ae058dc60a8b78366314ed9a16b5c6287e7ae609565cd4cb6071"'));
  } finally { herstel(); }
});

// ======================================================================== headers ====
test('propose: sleutelvolgorde van de uitgaande headers', async () => {
  const r = await draai(post(BODY), { ticket: { contact: { email: 'contact@x.be' } } });
  assert.deepEqual(Object.keys(r.calls[0].headers), ['Content-Type']);                           // token
  assert.deepEqual(Object.keys(r.calls[1].headers), ['Authorization']);                          // org
  assert.deepEqual(Object.keys(r.calls[2].headers), ['Authorization', 'orgId']);                 // ticket-GET
  assert.deepEqual(Object.keys(r.calls[3].headers), ['Authorization', 'orgId']);                 // upload, geen Content-Type
  assert.deepEqual(Object.keys(r.calls[4].headers), ['Authorization', 'orgId', 'Content-Type']); // sendReply
  assert.deepEqual(Object.keys(r.calls[5].headers), ['Authorization', 'orgId', 'Content-Type']); // PATCH
});
