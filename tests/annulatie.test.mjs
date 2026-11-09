import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDENEN, valideerAnnulatie, bouwAnnulatieMail, bouwAnnulatieNotitie,
  bouwGeenReactieMail, bouwGeenReactieNotitie, statusNaAnnulatie,
} from '../netlify/lib/annulatie.js';
import { maakHandler } from '../netlify/functions/annuleer.js';

// ---- nep-store -------------------------------------------------------------
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
  return { getStore, winkels, get };
}

const REG = JSON.stringify({ versie: 3, status: { 555: { klant: 'x', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14' }, 777: { klant: 'y' } } });

function maakFetch({ patchStatus = 200, cf = { cf_interventie_datm: '2026-10-14T06:30:00.000Z', cf_e_mail_eindklant: 'klant@x.be' }, contactEmail = 'contact@x.be', status = 'Wachten op bevestiging planning' } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url: String(url), method, body: opts.body });
    const res = (status, obj) => new Response(JSON.stringify(obj), { status });
    url = String(url);
    if (url.includes('oauth/v2/token')) return res(200, { access_token: 'tok' });
    if (url.endsWith('/organizations')) return res(200, { data: [{ id: 'org1' }] });
    if (url.includes('/sendReply')) return res(200, {});
    if (url.includes('/comments')) return res(200, {});
    if (url.includes('/tickets/555') && method === 'PATCH') return res(patchStatus, {});
    if (url.includes('/tickets/555')) return res(200, { status, cf, contact: { email: contactEmail, firstName: 'An', lastName: 'Peeters' } });
    return res(404, {});
  };
  return { fn, calls };
}

const post = (body, headers = {}) => new Request('http://x/api/annuleer', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

process.env.ZOHO_FROM_EMAIL = 'service@blitz.test';

// ---- valideerAnnulatie -----------------------------------------------------
test('valideerAnnulatie: ok-geval', () => {
  const r = valideerAnnulatie({ ticketId: 555, reden: 'weer', toelichting: '  ', mailKlant: true, door: ' Brent ' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.waarde, { ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true, door: 'Brent' });
});
test('valideerAnnulatie: andere zonder toelichting', () => {
  assert.equal(valideerAnnulatie({ ticketId: '1', reden: 'andere', toelichting: ' ', mailKlant: false }).ok, false);
});
test('valideerAnnulatie: toelichting 1001 tekens', () => {
  assert.equal(valideerAnnulatie({ ticketId: '1', reden: 'andere', toelichting: 'a'.repeat(1001), mailKlant: false }).ok, false);
  assert.equal(valideerAnnulatie({ ticketId: '1', reden: 'andere', toelichting: 'a'.repeat(1000), mailKlant: false }).ok, true);
});
test('valideerAnnulatie: onbekende reden en ongeldig ticketId', () => {
  assert.equal(valideerAnnulatie({ ticketId: '1', reden: 'x', mailKlant: false }).ok, false);
  assert.equal(valideerAnnulatie({ ticketId: '12a', reden: 'weer', mailKlant: false }).ok, false);
});
test('valideerAnnulatie: mailKlant moet boolean zijn; door max 60', () => {
  assert.equal(valideerAnnulatie({ ticketId: '1', reden: 'weer', mailKlant: 'ja' }).ok, false);
  assert.equal(valideerAnnulatie({ ticketId: '1', reden: 'weer', mailKlant: true, door: 'a'.repeat(61) }).ok, false);
});

// ---- mail ------------------------------------------------------------------
test('bouwAnnulatieMail: klantzin onderdelen, datum, afsluiter', () => {
  const h = bouwAnnulatieMail({ naam: 'An', datum: '2026-10-14', tijdslot: '08:30–11:30', reden: 'onderdelen', toelichting: '' });
  assert.match(h, /De nodige onderdelen zijn niet op tijd bij ons geleverd\./);
  assert.match(h, /woensdag 14 oktober 2026/);
  assert.match(h, /\(08:30–11:30\)/);
  assert.match(h, /Het serviceteam van Blitz Power/);
  assert.match(h, /Beste An,/);
});
test('bouwAnnulatieMail: uur zonder tijdslot, en fallback', () => {
  assert.match(bouwAnnulatieMail({ naam: 'An', datum: '2026-10-14', uur: '08:30', reden: 'weer' }), /\(om 08:30\)/);
  assert.match(bouwAnnulatieMail({ naam: 'An', datum: '2026-10-14', reden: 'weer' }), /\(tijdstip nog te bevestigen\)/);
});
test('bouwAnnulatieMail: toelichting enkel bij andere, geescaped', () => {
  const a = bouwAnnulatieMail({ naam: 'An', datum: '2026-10-14', reden: 'andere', toelichting: 'Staking <b>bij</b> ons' });
  assert.match(a, /Staking &lt;b&gt;bij&lt;\/b&gt; ons/);
  const w = bouwAnnulatieMail({ naam: 'An', datum: '2026-10-14', reden: 'weer', toelichting: 'GEHEIMETOELICHTING' });
  assert.ok(!w.includes('GEHEIMETOELICHTING'));
  assert.match(w, /De weersomstandigheden laten niet toe/);
});
test('bouwAnnulatieMail: naam wordt geescaped', () => {
  const h = bouwAnnulatieMail({ naam: '<script>alert(1)</script>', datum: '2026-10-14', reden: 'weer' });
  assert.ok(!h.includes('<script>'));
  assert.match(h, /&lt;script&gt;/);
});
test('REDENEN: zeven redenen (met "Geen reactie van de klant"), andere zonder klantzin, andere blijft laatste', () => {
  assert.equal(REDENEN.length, 7);
  assert.equal(REDENEN.find(r => r.code === 'andere').klantzin, null);
  assert.equal(REDENEN.at(-1).code, 'andere');
  assert.equal(REDENEN.find(r => r.code === 'geenreactie').label, 'Geen reactie van de klant');
});

// ---- geen reactie van de klant ---------------------------------------------
test('statusNaAnnulatie: geenreactie sluit het ticket (Gesloten - ov), elke andere reden zet het terug op Wachten op planning', () => {
  assert.equal(statusNaAnnulatie('geenreactie'), 'Gesloten - ov');
  for (const r of REDENEN.filter(x => x.code !== 'geenreactie')) assert.equal(statusNaAnnulatie(r.code), 'Wachten op planning', r.code);
});

test('bouwGeenReactieMail: afspraak vervalt, GEEN belofte van een nieuw voorstel, antwoorden op de mail heropent het ticket', () => {
  const h = bouwGeenReactieMail({ naam: 'An', datum: '2026-10-14', tijdslot: '08:30–11:30' });
  assert.match(h, /Beste An,/);
  assert.match(h, /woensdag 14 oktober 2026/);
  assert.match(h, /\(08:30–11:30\)/);
  assert.match(h, /geen bevestiging/);
  assert.match(h, /antwoord .{0,15}op deze e-?mail/i);
  assert.match(h, /heropend/);
  assert.match(h, /Het serviceteam van Blitz Power/);
  // Geen enkele belofte dat Blitz zelf een nieuwe datum of een nieuw voorstel doet (dat staat in de standaard annulatiemail).
  assert.doesNotMatch(h, /nieuwe datum/i);
  assert.doesNotMatch(h, /nemen .{0,40}contact/i);
  assert.doesNotMatch(h, /Helaas moeten we/);
  assert.match(h, /doen (zelf )?geen nieuw voorstel/i);
});

test('bouwGeenReactieMail: uur zonder tijdslot, fallback zonder datum, naam geescaped', () => {
  assert.match(bouwGeenReactieMail({ naam: 'An', datum: '2026-10-14', uur: '08:30' }), /\(om 08:30\)/);
  assert.match(bouwGeenReactieMail({ naam: 'An' }), /\(tijdstip nog te bevestigen\)/);
  const h = bouwGeenReactieMail({ naam: '<script>x</script>', datum: '2026-10-14' });
  assert.ok(!h.includes('<script>'));
  assert.match(h, /&lt;script&gt;/);
});

test('bouwAnnulatieMail met reden geenreactie geeft het geen-reactie-sjabloon (nooit "null" of de standaardtekst)', () => {
  const h = bouwAnnulatieMail({ naam: 'An', datum: '2026-10-14', tijdslot: '08:30–11:30', reden: 'geenreactie', toelichting: '' });
  assert.equal(h, bouwGeenReactieMail({ naam: 'An', datum: '2026-10-14', tijdslot: '08:30–11:30' }));
  assert.ok(!h.includes('null'));
});

test('bouwGeenReactieNotitie: vervallen en gesloten, met en zonder mail, toelichting en geescaped', () => {
  const basis = { datum: '2026-10-14', tijdslot: '08:30–11:30', door: 'Brent', tijdstip: '30/09/2026 15:12', toelichting: '', mailKlant: true, gemaild: ['a@x.be'] };
  const m = bouwGeenReactieNotitie(basis);
  assert.match(m, /Afspraak van 14\/10\/2026 08:30–11:30 vervallen: geen reactie van de klant/);
  assert.match(m, /via Blitz Planning door Brent op 30\/09\/2026 15:12/);
  assert.match(m, /Gesloten - ov/);
  assert.match(m, /Klant verwittigd per mail: ja \(a@x\.be\)/);
  const z = bouwGeenReactieNotitie({ ...basis, door: '', mailKlant: false, gemaild: [], toelichting: '<b>x</b>' });
  assert.match(z, /via Blitz Planning op 30\/09\/2026 15:12/);
  assert.match(z, /Toelichting: &lt;b&gt;x&lt;\/b&gt;\./);
  assert.match(z, /Klant verwittigd per mail: nee/);
});

// ---- notitie ---------------------------------------------------------------
test('bouwAnnulatieNotitie: met en zonder door', () => {
  const basis = { datum: '2026-10-14', tijdslot: '08:30–11:30', tijdstip: '30/09/2026 15:12', redenLabel: 'Onderdelen niet op tijd geleverd', toelichting: '', mailKlant: true, gemaild: ['a@x.be', 'b@x.be'] };
  const m = bouwAnnulatieNotitie({ ...basis, door: 'Brent' });
  assert.match(m, /Afspraak van 14\/10\/2026 08:30–11:30 geannuleerd via Blitz Planning door Brent op 30\/09\/2026 15:12\./);
  assert.match(m, /Reden: Onderdelen niet op tijd geleverd\./);
  assert.match(m, /Klant verwittigd per mail: ja \(a@x\.be, b@x\.be\)/);
  const z = bouwAnnulatieNotitie({ ...basis, door: '', mailKlant: false, gemaild: [], toelichting: 'iets' });
  assert.match(z, /geannuleerd via Blitz Planning op 30\/09\/2026 15:12/);
  assert.ok(!z.includes(' door '));
  assert.match(z, /Toelichting: iets\./);
  assert.match(z, /Klant verwittigd per mail: nee/);
});

// ---- endpoint --------------------------------------------------------------
test('endpoint GET: redenenlijst zonder Zoho', async () => {
  const { getStore } = maakWinkels();
  const { fn, calls } = maakFetch();
  const h = maakHandler({ getStore, fetch: fn });
  const r = await h(new Request('http://x/api/annuleer'));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.redenen.length, 7);
  assert.equal(j.redenen[0].klantzin, undefined);
  assert.ok(j.redenen.some(r => r.code === 'geenreactie' && r.label === 'Geen reactie van de klant'));
  assert.equal(calls.length, 0);
});

test('endpoint voorbeeld: geen Zoho, ook niet in echte modus; valideert en escapet', async () => {
  const { getStore } = maakWinkels();
  const { fn, calls } = maakFetch();
  const h = maakHandler({ getStore, fetch: fn });
  const r = await h(post({ voorbeeld: true, naam: '<i>x</i>', datum: '2026-10-14', reden: 'andere', toelichting: '<b>t</b>' }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(!j.html.includes('<i>x</i>') && !j.html.includes('<b>t</b>'));
  assert.equal(calls.length, 0);
  const bad = await h(post({ voorbeeld: true, datum: '2026-10-14', reden: 'andere', toelichting: 'a'.repeat(1001) }));
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
});

test('endpoint testmodus: nul fetch, teststore gewist, echte store intact', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG }, 'blitz-data-test': { 'voorstel-status': REG, _testkopie: '{}' } });
  const { fn, calls } = maakFetch();
  const origFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('netwerk verboden'); };
  try {
    const h = maakHandler({ getStore: w.getStore, fetch: fn });
    const r = await h(post({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true, door: 'Brent' }, { 'X-Blitz-Test': '1' }));
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.test, true);
    assert.equal(j.emailSent.contact, true);
    assert.equal(calls.length, 0);
    assert.equal(JSON.parse(w.get('blitz-data-test').get('voorstel-status')).status['555'], undefined);
    assert.ok(JSON.parse(w.get('blitz-data').get('voorstel-status')).status['555']);
  } finally { globalThis.fetch = origFetch; }
});

test('endpoint echt, mailKlant:false: geen sendReply, wel PATCH + notitie + register gewist', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const { fn, calls } = maakFetch();
  const h = maakHandler({ getStore: w.getStore, fetch: fn });
  const r = await h(post({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false, door: 'Brent' }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.ok(!calls.some(c => c.url.includes('/sendReply')));
  const patch = calls.find(c => c.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.body), { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } });
  const com = calls.find(c => c.url.includes('/comments'));
  assert.ok(com);
  const c = JSON.parse(com.body);
  assert.equal(c.isPublic, false);
  assert.match(c.content, /08:30–11:30/);
  assert.equal(JSON.parse(w.get('blitz-data').get('voorstel-status')).status['555'], undefined);
  assert.ok(JSON.parse(w.get('blitz-data').get('voorstel-status')).status['777']);
});

test('endpoint echt, mailKlant:true: sendReply per uniek adres vóór de PATCH', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const { fn, calls } = maakFetch({ contactEmail: 'KLANT@x.be' }); // zelfde adres als klant -> 1 ontvanger
  const h = maakHandler({ getStore: w.getStore, fetch: fn });
  const r = await h(post({ ticketId: '555', reden: 'onderdelen', toelichting: '', mailKlant: true, door: '' }));
  const j = await r.json();
  assert.equal(r.status, 200);
  const replies = calls.filter(c => c.url.includes('/sendReply'));
  assert.equal(replies.length, 1);
  assert.match(JSON.parse(replies[0].body).content, /De nodige onderdelen/);
  assert.ok(calls.indexOf(replies[0]) < calls.findIndex(c => c.method === 'PATCH'));
  assert.equal(j.emailSent.contact, true);
});

test('endpoint echt, PATCH-fout: 502 en register niet gewist', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const { fn } = maakFetch({ patchStatus: 500 });
  const h = maakHandler({ getStore: w.getStore, fetch: fn });
  const r = await h(post({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false }));
  assert.equal(r.status, 502);
  assert.ok(JSON.parse(w.get('blitz-data').get('voorstel-status')).status['555']);
});

test('endpoint: validatiefout geeft 400', async () => {
  const { getStore } = maakWinkels();
  const { fn, calls } = maakFetch();
  const h = maakHandler({ getStore, fetch: fn });
  const r = await h(post({ ticketId: '555', reden: 'andere', toelichting: '', mailKlant: false }));
  assert.equal(r.status, 400);
  assert.equal(calls.length, 0);
});

test('bouwAnnulatieMail: zonder datum en tijdslot', () => {
  assert.match(bouwAnnulatieMail({ naam: 'An', reden: 'weer' }), /uw afspraak \(tijdstip nog te bevestigen\) annuleren/);
});

test('endpoint echt: registerfout na geslaagde PATCH geeft 200 met waarschuwing', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const basis = w.getStore;
  const getStore = o => ({ ...basis(o), async setJSON() { throw new Error('blob stuk'); } });
  const { fn, calls } = maakFetch();
  const h = maakHandler({ getStore, fetch: fn });
  const r = await h(post({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.match(j.waarschuwing, /register/);
  assert.ok(calls.some(c => c.method === 'PATCH'));
});

test('endpoint echt: ticket-GET 500 geeft 502, 404 geeft 404', async () => {
  for (const [st, verwacht] of [[500, 502], [404, 404]]) {
    const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
    const { fn } = maakFetch();
    const f = async (url, o = {}) => (String(url).includes('/tickets/555') && !o.method ? new Response('{}', { status: st }) : fn(url, o));
    const r = await maakHandler({ getStore: w.getStore, fetch: f })(post({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false }));
    assert.equal(r.status, verwacht);
  }
});

test('ticketId p1: testmodus geeft 200 test:true, echt geeft 400 zonder fetch', async () => {
  const body = { ticketId: 'p1', reden: 'weer', toelichting: '', mailKlant: false };
  const w = maakWinkels();
  const { fn, calls } = maakFetch();
  const h = maakHandler({ getStore: w.getStore, fetch: fn });
  const t = await h(post(body, { 'X-Blitz-Test': '1' }));
  assert.equal(t.status, 200);
  assert.equal((await t.json()).test, true);
  const e = await h(post(body));
  assert.equal(e.status, 400);
  assert.equal(calls.length, 0);
  assert.equal(valideerAnnulatie({ ...body, ticketId: 'p1/../x' }, { test: true }).ok, false);
  assert.equal(valideerAnnulatie(body).ok, false);
});

test('endpoint echt: status Wachten op planning + mailKlant:true -> 409, geen mail/PATCH, register intact', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const { fn, calls } = maakFetch({ status: 'Wachten op planning' });
  const r = await maakHandler({ getStore: w.getStore, fetch: fn })(post({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: true }));
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.nietGepland, true);
  assert.deepEqual(j.emailSent, { contact: false, klant: false, installateur: false });
  assert.equal(calls.filter(c => c.url.includes('/sendReply')).length, 0);
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
  assert.equal(calls.filter(c => c.url.includes('/comments')).length, 0);
  assert.ok(JSON.parse(w.get('blitz-data').get('voorstel-status')).status['555']);
});

test('endpoint echt: status Wachten op planning + mailKlant:false -> 200 opgeruimd, geen PATCH, register gewist', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const { fn, calls } = maakFetch({ status: 'Wachten op planning' });
  const r = await maakHandler({ getStore: w.getStore, fetch: fn })(post({ ticketId: '555', reden: 'weer', toelichting: '', mailKlant: false, door: 'Brent' }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.opgeruimd, true);
  assert.equal(j.ok, true);
  assert.deepEqual(j.fouten, []);
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
  assert.equal(calls.filter(c => c.url.includes('/sendReply')).length, 0);
  const nota = calls.find(c => c.url.includes('/comments'));
  assert.match(JSON.parse(nota.body).content, /Vergrendeling opgeruimd.*Wachten op planning/);
  assert.equal(JSON.parse(w.get('blitz-data').get('voorstel-status')).status['555'], undefined);
});

// ---- endpoint: geen reactie van de klant -------------------------------------
test('endpoint voorbeeld geenreactie: geen Zoho, html is het geen-reactie-sjabloon', async () => {
  const { getStore } = maakWinkels();
  const { fn, calls } = maakFetch();
  const h = maakHandler({ getStore, fetch: fn });
  const r = await h(post({ voorbeeld: true, naam: 'An', datum: '2026-10-14', tijdslot: '08:30–11:30', reden: 'geenreactie' }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.html, bouwGeenReactieMail({ naam: 'An', datum: '2026-10-14', tijdslot: '08:30–11:30' }));
  assert.equal(calls.length, 0);
});

test('endpoint echt geenreactie: eigen sjabloon via sendReply, DAARNA PATCH naar Gesloten - ov (datum gewist), antwoord geeft de status', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const { fn, calls } = maakFetch();
  const r = await maakHandler({ getStore: w.getStore, fetch: fn })(post({ ticketId: '555', reden: 'geenreactie', toelichting: '', mailKlant: true, door: 'Brent' }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(j.status, 'Gesloten - ov');
  const replies = calls.filter(c => c.url.includes('/sendReply'));
  assert.equal(replies.length, 2); // contact + klant
  for (const rep of replies) assert.equal(JSON.parse(rep.body).content, bouwGeenReactieMail({ naam: 'An Peeters', datum: '2026-10-14', tijdslot: '08:30–11:30' }));
  const patchIdx = calls.findIndex(c => c.method === 'PATCH');
  assert.ok(patchIdx > calls.indexOf(replies.at(-1)), 'PATCH komt na de laatste sendReply');
  assert.deepEqual(JSON.parse(calls[patchIdx].body), { status: 'Gesloten - ov', cf: { cf_interventie_datm: '' } });
  assert.equal(JSON.parse(w.get('blitz-data').get('voorstel-status')).status['555'], undefined);
});

test('endpoint echt geenreactie met mailKlant:false: geen sendReply, wel PATCH Gesloten - ov', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const { fn, calls } = maakFetch();
  const r = await maakHandler({ getStore: w.getStore, fetch: fn })(post({ ticketId: '555', reden: 'geenreactie', toelichting: '', mailKlant: false, door: 'Brent' }));
  assert.equal(r.status, 200);
  assert.equal(calls.filter(c => c.url.includes('/sendReply')).length, 0);
  assert.deepEqual(JSON.parse(calls.find(c => c.method === 'PATCH').body), { status: 'Gesloten - ov', cf: { cf_interventie_datm: '' } });
});

test('endpoint testmodus geenreactie: nul fetch en het nep-antwoord geeft Gesloten - ov', async () => {
  const w = maakWinkels({ 'blitz-data-test': { _testkopie: '{}' } });
  const { fn, calls } = maakFetch();
  const r = await maakHandler({ getStore: w.getStore, fetch: fn })(post({ ticketId: '555', reden: 'geenreactie', toelichting: '', mailKlant: true }, { 'X-Blitz-Test': '1' }));
  const j = await r.json();
  assert.equal(j.test, true);
  assert.equal(j.status, 'Gesloten - ov');
  assert.equal(calls.length, 0);
});

test('endpoint geenreactie op een ticket dat niet gepland staat: opruimen zonder PATCH en zonder status in het antwoord', async () => {
  const w = maakWinkels({ 'blitz-data': { 'voorstel-status': REG } });
  const { fn, calls } = maakFetch({ status: 'Wachten op planning' });
  const r = await maakHandler({ getStore: w.getStore, fetch: fn })(post({ ticketId: '555', reden: 'geenreactie', toelichting: '', mailKlant: false, door: 'Brent' }));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.opgeruimd, true);
  assert.equal(j.status, undefined);
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
});
