import test from 'node:test';
import assert from 'node:assert/strict';
import { verwerkOntvangst } from '../netlify/lib/rapport-ontvangst.js';
import { startAchtergrondtaak } from '../netlify/lib/rapport-achtergrond.js';
import { MAX_HTML_TEKENS } from '../netlify/lib/rapport-inhoud.js';
import { maakHandler } from '../netlify/functions/rapport-ontvangen.js';

// ---- nep-store -------------------------------------------------------------
function maakWinkels() {
  const winkels = {};
  const get = naam => (winkels[naam] ??= new Map());
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
const lijstVan = m => JSON.parse(m.get('rapportlijst') ?? '{"rapports":[]}').rapports;
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const NU = new Date('2026-10-08T10:00:00Z');

function body(over = {}) {
  return {
    id: ID_A, ticketId: '555', filename: 't.pdf', isLocal: false, html: '<p>x</p>',
    archiveBody: {
      datum: '2026-10-08', technieker: 'Tim', ticketId: '555', ticketNumber: '1006', klant: 'K',
      rapportData: { _html: '<p>x</p>', handtekeningTech: 'data:...', handtekeningKlant: 'data:...', probleem: 'p' },
    },
    ...over,
  };
}
const maakStore = () => { const w = maakWinkels(); return { store: w.getStore({ name: 'blitz-data' }), m: w.get('blitz-data') }; };

test('nieuw rapport: inhoudsblob geschreven, lichte entry zonder _html/handtekeningen, status wacht, startNodig true', async () => {
  const { store, m } = maakStore();
  const r = await verwerkOntvangst({ store, body: body(), nu: NU });
  assert.deepEqual([r.status, r.body, r.startNodig], [200, { ok: true, id: ID_A }, true]);
  const blob = JSON.parse(m.get('rapport-inhoud/' + ID_A));
  assert.equal(blob.html, '<p>x</p>');
  assert.equal(blob.ticketId, '555');
  const lijst = lijstVan(m);
  assert.equal(lijst.length, 1);
  const e = lijst[0];
  assert.equal(e.id, ID_A);
  assert.equal(e.verwerking.status, 'wacht');
  assert.equal(e.inhoudBeschikbaar, true);
  assert.equal(e.zohoUploaded, false);
  assert.equal(e.rapportData._html, undefined);
  assert.equal(e.rapportData.handtekeningTech, undefined);
  assert.equal(e.rapportData.probleem, 'p');
});

test('lokaal rapport (isLocal, ticketId leeg): status lokaal, startNodig false', async () => {
  const { store, m } = maakStore();
  const r = await verwerkOntvangst({ store, body: body({ isLocal: true, ticketId: '' }), nu: NU });
  assert.equal(r.status, 200);
  assert.equal(r.startNodig, false);
  assert.equal(lijstVan(m)[0].verwerking.status, 'lokaal');
});

test('zelfde id twee keer: één entry, tweede antwoord ok, status ongewijzigd', async () => {
  const { store, m } = maakStore();
  await verwerkOntvangst({ store, body: body(), nu: NU });
  const voor = JSON.stringify(lijstVan(m)[0]);
  const r = await verwerkOntvangst({ store, body: body(), nu: new Date('2026-10-08T11:00:00Z') });
  assert.deepEqual([r.status, r.body], [200, { ok: true, id: ID_A }]);
  assert.equal(lijstVan(m).length, 1);
  assert.equal(JSON.stringify(lijstVan(m)[0]), voor);
});

test('entry is al in-zoho: tweede POST laat in-zoho staan, startNodig false', async () => {
  const { store, m } = maakStore();
  await verwerkOntvangst({ store, body: body(), nu: NU });
  const l = JSON.parse(m.get('rapportlijst'));
  l.rapports[0].verwerking.status = 'in-zoho';
  l.rapports[0].zohoUploaded = true;
  m.set('rapportlijst', JSON.stringify(l));
  const r = await verwerkOntvangst({ store, body: body(), nu: NU });
  assert.equal(r.status, 200);
  assert.equal(r.startNodig, false);
  assert.equal(lijstVan(m).length, 1);
  assert.equal(lijstVan(m)[0].verwerking.status, 'in-zoho');
  assert.equal(lijstVan(m)[0].zohoUploaded, true);
});

test('entry is wacht: tweede POST geeft startNodig true, nog steeds één entry', async () => {
  const { store, m } = maakStore();
  await verwerkOntvangst({ store, body: body(), nu: NU });
  const r = await verwerkOntvangst({ store, body: body(), nu: NU });
  assert.equal(r.startNodig, true);
  assert.equal(lijstVan(m).length, 1);
});

test('entry is bezig of mislukt: tweede POST geeft startNodig false', async () => {
  for (const status of ['bezig', 'mislukt']) {
    const { store, m } = maakStore();
    await verwerkOntvangst({ store, body: body(), nu: NU });
    const l = JSON.parse(m.get('rapportlijst'));
    l.rapports[0].verwerking.status = status;
    m.set('rapportlijst', JSON.stringify(l));
    const r = await verwerkOntvangst({ store, body: body(), nu: NU });
    assert.equal(r.startNodig, false, status);
    assert.equal(lijstVan(m)[0].verwerking.status, status);
  }
});

test('dedup met ander id (zelfde ticket+datum): entry krijgt nieuw id, oude inhoudsblob verwijderd', async () => {
  const { store, m } = maakStore();
  await verwerkOntvangst({ store, body: body(), nu: NU });
  assert.ok(m.has('rapport-inhoud/' + ID_A));
  const r = await verwerkOntvangst({ store, body: body({ id: ID_B }), nu: NU });
  assert.equal(r.status, 200);
  assert.equal(lijstVan(m).length, 1);
  assert.equal(lijstVan(m)[0].id, ID_B);
  assert.ok(m.has('rapport-inhoud/' + ID_B));
  assert.equal(m.has('rapport-inhoud/' + ID_A), false);
});

test('html > 5 500 000 tekens: 413 met "te groot"-tekst, geen blob, geen entry', async () => {
  const { store, m } = maakStore();
  const r = await verwerkOntvangst({ store, body: body({ html: 'x'.repeat(MAX_HTML_TEKENS + 1) }), nu: NU });
  assert.equal(MAX_HTML_TEKENS, 5_500_000);
  assert.equal(r.status, 413);
  assert.match(r.body.error, /te groot/);
  assert.equal(r.startNodig, false);
  assert.equal(m.size, 0);
});

test('validatie: ongeldig id, ticketId "abc", html ontbreekt geven 400; "t1" in testmodus toegelaten', async () => {
  const { store, m } = maakStore();
  assert.equal((await verwerkOntvangst({ store, body: body({ id: 'geen-uuid' }), nu: NU })).status, 400);
  assert.equal((await verwerkOntvangst({ store, body: body({ ticketId: 'abc' }), nu: NU })).status, 400);
  assert.equal((await verwerkOntvangst({ store, body: body({ html: undefined }), nu: NU })).status, 400);
  assert.equal((await verwerkOntvangst({ store, body: body({ html: '' }), nu: NU })).status, 400);
  assert.equal((await verwerkOntvangst({ store, body: body({ archiveBody: null }), nu: NU })).status, 400);
  assert.equal((await verwerkOntvangst({ store, body: body({ ticketId: '' }), nu: NU })).status, 400); // leeg zonder isLocal
  assert.equal(m.size, 0);
  const r = await verwerkOntvangst({ store, body: body({ ticketId: 't1' }), nu: NU, testModus: true });
  assert.equal(r.status, 200);
});

test('filename krijgt een standaardwaarde', async () => {
  const { store, m } = maakStore();
  await verwerkOntvangst({ store, body: body({ filename: undefined }), nu: NU });
  assert.equal(JSON.parse(m.get('rapport-inhoud/' + ID_A)).filename, 'service-rapport.pdf');
});

test('store.get gooit: 503', async () => {
  const { store } = maakStore();
  const kapot = { ...store, async get() { throw new Error('blobs weg'); } };
  const r = await verwerkOntvangst({ store: kapot, body: body(), nu: NU });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /tijdelijk niet bereikbaar/);
  assert.equal(r.startNodig, false);
});

// ---- startAchtergrondtaak --------------------------------------------------
test('startAchtergrondtaak: juiste URL + body, geen testheader buiten testmodus', async () => {
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, opts }); return new Response(null, { status: 202 }); };
  const ok = await startAchtergrondtaak({ origin: 'https://x.netlify.app', id: ID_A, fetch });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.netlify.app/.netlify/functions/rapport-verwerk-background');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { id: ID_A });
  assert.equal(new Headers(calls[0].opts.headers).get('x-blitz-test'), null);
});

test('startAchtergrondtaak: zet X-Blitz-Test in testmodus', async () => {
  const calls = [];
  const fetch = async (url, opts) => { calls.push(opts); return new Response(null, { status: 202 }); };
  await startAchtergrondtaak({ origin: 'http://localhost:3333', id: ID_A, testModus: true, fetch });
  assert.equal(new Headers(calls[0].headers).get('x-blitz-test'), '1');
});

test('startAchtergrondtaak: false (zonder te gooien) bij fetch-fout of niet-2xx', async () => {
  const gooit = async () => { throw new Error('netwerk'); };
  assert.equal(await startAchtergrondtaak({ origin: 'http://x', id: ID_A, fetch: gooit }), false);
  const fout = async () => new Response('nee', { status: 500 });
  assert.equal(await startAchtergrondtaak({ origin: 'http://x', id: ID_A, fetch: fout }), false);
});

// ---- maakHandler -----------------------------------------------------------
function postReq(b, { test = false, methode = 'POST' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (test) headers['X-Blitz-Test'] = '1';
  return new Request('https://blitz.example/api/rapport-ontvangen', {
    method: methode, headers, body: methode === 'POST' ? JSON.stringify(b) : undefined,
  });
}

test('maakHandler: POST geeft 200 en één aanroep naar de achtergrondtaak; na in-zoho geen tweede', async () => {
  const w = maakWinkels();
  const calls = [];
  const fetch = async (url, opts) => { calls.push({ url, opts }); return new Response(null, { status: 202 }); };
  const handler = maakHandler({ getStore: w.getStore, fetch });
  const res = await handler(postReq(body()));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, id: ID_A });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://blitz.example/.netlify/functions/rapport-verwerk-background');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { id: ID_A });
  assert.equal(new Headers(calls[0].opts.headers).get('x-blitz-test'), null);

  const m = w.get('blitz-data');
  const l = JSON.parse(m.get('rapportlijst'));
  l.rapports[0].verwerking.status = 'in-zoho';
  m.set('rapportlijst', JSON.stringify(l));
  const res2 = await handler(postReq(body()));
  assert.equal(res2.status, 200);
  assert.equal(calls.length, 1);
});

test('maakHandler: testverzoek gebruikt de testopslag en geeft X-Blitz-Test door aan de achtergrondtaak', async () => {
  const w = maakWinkels();
  const calls = [];
  const fetch = async (url, opts) => { calls.push(opts); return new Response(null, { status: 202 }); };
  const handler = maakHandler({ getStore: w.getStore, fetch });
  const res = await handler(postReq(body({ ticketId: 'g1' }), { test: true }));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].headers).get('x-blitz-test'), '1');
  assert.ok(w.get('blitz-data-test').has('rapport-inhoud/' + ID_A));
  assert.equal(w.get('blitz-data').has('rapport-inhoud/' + ID_A), false);
});

test('maakHandler: fout bij starten achtergrondtaak blijft 200 (vangnet); OPTIONS 204; GET 405; ongeldige JSON 400', async () => {
  const w = maakWinkels();
  const handler = maakHandler({ getStore: w.getStore, fetch: async () => { throw new Error('weg'); } });
  assert.equal((await handler(postReq(body()))).status, 200);
  assert.equal((await handler(postReq(null, { methode: 'OPTIONS' }))).status, 204);
  assert.equal((await handler(new Request('https://blitz.example/api/rapport-ontvangen'))).status, 405);
  const kapot = new Request('https://blitz.example/api/rapport-ontvangen', { method: 'POST', body: '{nee' });
  assert.equal((await handler(kapot)).status, 400);
});
