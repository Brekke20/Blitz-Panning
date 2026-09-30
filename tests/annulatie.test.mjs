import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REDENEN, valideerAnnulatie, bouwAnnulatieMail, bouwAnnulatieNotitie,
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

function maakFetch({ patchStatus = 200, cf = { cf_interventie_datm: '2026-10-14T06:30:00.000Z', cf_e_mail_eindklant: 'klant@x.be' }, contactEmail = 'contact@x.be' } = {}) {
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
    if (url.includes('/tickets/555')) return res(200, { cf, contact: { email: contactEmail, firstName: 'An', lastName: 'Peeters' } });
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
test('REDENEN: zes redenen, andere zonder klantzin', () => {
  assert.equal(REDENEN.length, 6);
  assert.equal(REDENEN.find(r => r.code === 'andere').klantzin, null);
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
  assert.equal(j.redenen.length, 6);
  assert.equal(j.redenen[0].klantzin, undefined);
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
