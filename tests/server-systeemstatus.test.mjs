// tests/server-systeemstatus.test.mjs — /api/systeemstatus (enkel beheerder) en netlify/lib/systeemstatus.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { maakNepFetch } from './nep-fetch.mjs';
import { maakZoho } from '../netlify/lib/zoho.js';
import { verzamelStatus } from '../netlify/lib/systeemstatus.js';
import { maakHandler } from '../netlify/functions/systeemstatus.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { metRol } from './auth-hulp.mjs';

const NU0 = Date.parse('2026-10-08T10:00:00.000Z');
const ENV = { ZOHO_REFRESH_TOKEN: 'GEHEIM-refresh', ZOHO_CLIENT_ID: 'id-1', ZOHO_CLIENT_SECRET: 'GEHEIM-secret' };
const nu = () => NU0;

const nepZoho = router => {
  const f = maakNepFetch(router);
  return { f, zoho: maakZoho({ fetch: f.fn, env: ENV, nu }) };
};
const tokenFout = () => new Response(
  JSON.stringify({ error: 'invalid_code', refresh_token: 'GEHEIM-refresh', client_secret: 'GEHEIM-secret' }),
  { status: 400, headers: { 'Content-Type': 'application/json' } },
);

const foutregel = (i, extra = {}) => ({
  tijdstip: new Date(NU0 - i * 60000).toISOString(), ticketId: `t${i}`, ticketNumber: `N${i}`, stap: 'upload', fout: `fout ${i}`, poging: 2, ...extra,
});

const rapport = (id, verwerking, extra = {}) => ({
  id, datum: '2026-10-07', technieker: 'Tim Z', ticketId: `t-${id}`, ticketNumber: `N-${id}`, klant: 'Klant', rapportData: { groot: 'x'.repeat(50) },
  ...(verwerking ? { verwerking } : {}), ...extra,
});

// ---------------- rechtenrij ----------------
test('rechtenrij: systeemstatus enkel beheerder (GET)', () => {
  assert.deepEqual([...RECHTEN.systeemstatus.GET], ['beheerder']);
  assert.equal(RECHTEN.systeemstatus['*'], undefined);
});

// ---------------- verzamelStatus ----------------
test('Zoho-token lukt: ok:true met tijdstip, geen fout', async () => {
  const { zoho } = nepZoho();
  const s = await verzamelStatus({ store: maakNepStore({}), zoho, test: false, nu });
  assert.deepEqual(s.zoho, { ok: true, tijdstip: '2026-10-08T10:00:00.000Z' });
});

test('Zoho-token mislukt (400): ok:false, korte fout zonder geheimen', async () => {
  const { zoho } = nepZoho(url => (url.includes('oauth/v2/token') ? tokenFout() : undefined));
  const s = await verzamelStatus({ store: maakNepStore({}), zoho, test: false, nu });
  assert.equal(s.zoho.ok, false);
  assert.equal(s.zoho.tijdstip, '2026-10-08T10:00:00.000Z');
  assert.equal(typeof s.zoho.fout, 'string');
  assert.ok(s.zoho.fout.length > 0 && s.zoho.fout.length <= 200);
  const alles = JSON.stringify(s);
  for (const geheim of ['refresh_token', 'client_secret', 'GEHEIM', 'access_token', 'invalid_code']) assert.ok(!alles.includes(geheim), geheim);
});

test('Zoho onbereikbaar (fetch gooit): ok:false zonder de ruwe foutmelding', async () => {
  const { zoho } = nepZoho(() => { throw new Error('connect ECONNREFUSED https://accounts.zoho.eu/?client_secret=GEHEIM-secret'); });
  const s = await verzamelStatus({ store: maakNepStore({}), zoho, test: false, nu });
  assert.equal(s.zoho.ok, false);
  assert.ok(!JSON.stringify(s).includes('GEHEIM'));
  assert.ok(!JSON.stringify(s).includes('client_secret'));
});

test('testverzoek: geen Zoho-aanroep, { ok:true, test:true, tijdstip }', async () => {
  const { f, zoho } = nepZoho();
  const s = await verzamelStatus({ store: maakNepStore({}), zoho, test: true, nu });
  assert.deepEqual(s.zoho, { ok: true, test: true, tijdstip: '2026-10-08T10:00:00.000Z' });
  assert.equal(f.calls.length, 0);
});

test('foutenlog: 25 regels geven de laatste 20 terug, enkel de vier velden', async () => {
  const { zoho } = nepZoho();
  const fouten = Array.from({ length: 25 }, (_, i) => foutregel(i)); // nieuwste eerst (zoals client-log schrijft)
  const store = maakNepStore({ foutenlog: { fouten } });
  const s = await verzamelStatus({ store, zoho, test: false, nu });
  assert.equal(s.foutenlog.length, 20);
  assert.deepEqual(Object.keys(s.foutenlog[0]).sort(), ['fout', 'stap', 'ticketId', 'tijdstip']);
  assert.equal(s.foutenlog[0].ticketId, 't0');
  assert.equal(s.foutenlog[19].ticketId, 't19');
});

test('foutenlog ontbreekt of is kapot: lege lijst', async () => {
  const { zoho } = nepZoho();
  const leeg = await verzamelStatus({ store: maakNepStore({}), zoho, test: false, nu });
  assert.deepEqual(leeg.foutenlog, []);
  const kapot = { async get() { throw new Error('boem'); } };
  const s = await verzamelStatus({ store: kapot, zoho, test: false, nu });
  assert.deepEqual(s.foutenlog, []);
  assert.deepEqual(s.rapporten, { mislukt: [] });
});

test('rapporten: enkel entries met verwerking.status mislukt, met vijf velden', async () => {
  const { zoho } = nepZoho();
  const lijst = { versie: 4, rapports: [
    rapport('a', { status: 'mislukt', pogingen: 5, volgendePoging: null, laatsteFout: 'Zoho 500', bijgewerkt: '2026-10-07T08:00:00.000Z' }),
    rapport('b', { status: 'in-zoho', pogingen: 1, volgendePoging: null, laatsteFout: null, bijgewerkt: '2026-10-07T08:00:00.000Z' }),
    rapport('c'), // oude entry zonder verwerking
    rapport('d', { status: 'wacht', pogingen: 0, volgendePoging: null, laatsteFout: null, bijgewerkt: '2026-10-07T08:00:00.000Z' }),
    rapport('e', { status: 'mislukt', pogingen: 3, volgendePoging: null, laatsteFout: null, bijgewerkt: '2026-10-07T09:00:00.000Z' }),
  ] };
  const s = await verzamelStatus({ store: maakNepStore({ rapportlijst: lijst }), zoho, test: false, nu });
  assert.deepEqual(s.rapporten.mislukt, [
    { id: 'a', ticketNumber: 'N-a', technieker: 'Tim Z', datum: '2026-10-07', laatsteFout: 'Zoho 500' },
    { id: 'e', ticketNumber: 'N-e', technieker: 'Tim Z', datum: '2026-10-07', laatsteFout: null },
  ]);
});

test('rapporten: lijst zonder enig verwerking-veld (oude vorm) of zonder blob: leeg', async () => {
  const { zoho } = nepZoho();
  const oud = { versie: 1, rapports: [rapport('x'), rapport('y')] };
  assert.deepEqual((await verzamelStatus({ store: maakNepStore({ rapportlijst: oud }), zoho, test: false, nu })).rapporten, { mislukt: [] });
  assert.deepEqual((await verzamelStatus({ store: maakNepStore({}), zoho, test: false, nu })).rapporten, { mislukt: [] });
});

// ---------------- functie ----------------
function opzet({ router, begin = {} } = {}) {
  const echt = maakNepStore({});
  const test = maakNepStore(begin);
  const getStore = opties => (opties.name === 'blitz-data' ? echt : test);
  const f = maakNepFetch(router);
  const h = maakHandler({
    getStore, nu,
    maakZoho: () => maakZoho({ fetch: f.fn, env: ENV, nu }),
  });
  return { echt, test, f, h };
}
const get = (headers = {}) => new Request('http://localhost/api/systeemstatus', { method: 'GET', headers: { 'x-blitz': '1', ...headers } });

test('functie: planner, technieker en sales krijgen 403', async () => {
  const { h, f } = opzet();
  for (const rol of ['planner', 'technieker', 'sales']) {
    const res = await metRol(rol, () => h(get()));
    assert.equal(res.status, 403, rol);
    assert.equal((await res.json()).code, 'geen-recht', rol);
  }
  assert.equal(f.calls.length, 0);
});

test('functie: beheerder krijgt de status, Zoho wordt gecontroleerd', async () => {
  const { h, f } = opzet();
  const res = await metRol('beheerder', () => h(get()));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.zoho, { ok: true, tijdstip: '2026-10-08T10:00:00.000Z' });
  assert.deepEqual(body.foutenlog, []);
  assert.deepEqual(body.rapporten, { mislukt: [] });
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.includes('oauth/v2/token'));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('functie: testverzoek doet geen uitgaande fetch en leest de teststore', async () => {
  const begin = { foutenlog: { fouten: [foutregel(1)] } };
  const { h, f } = opzet({ begin });
  const res = await metRol('beheerder', () => h(get({ 'x-blitz-test': '1' })));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.zoho, { ok: true, test: true, tijdstip: '2026-10-08T10:00:00.000Z' });
  assert.equal(body.foutenlog.length, 1);
  assert.equal(f.calls.length, 0);
});

test('functie: antwoord bevat nooit tokens of geheimen, ook niet bij een Zoho-fout', async () => {
  const { h } = opzet({ router: url => (url.includes('oauth/v2/token') ? tokenFout() : undefined) });
  const res = await metRol('beheerder', () => h(get()));
  const tekst = await res.text();
  assert.equal(res.status, 200);
  for (const geheim of ['refresh_token', 'client_secret', 'GEHEIM', 'access_token']) assert.ok(!tekst.includes(geheim), geheim);
  assert.equal(JSON.parse(tekst).zoho.ok, false);
});
