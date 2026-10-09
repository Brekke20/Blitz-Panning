// tests/server-sales.test.mjs — /api/sales en /api/postcode (Task 11): toegang, acties, testmodus, opslagstoring.
// Nep-stores voor de echte (`blitz-data`) en de teststore, nep-fetch, vaste klok; rol via metRol / metGeenSessie.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { maakNepFetch } from './nep-fetch.mjs';
import { metRol, metGeenSessie } from './auth-hulp.mjs';
import { maakHandler } from '../netlify/functions/sales.js';
import { maakHandler as maakPostcodeHandler } from '../netlify/functions/postcode.js';
import { bepaalDoel } from '../netlify/lib/sales-toegang.js';
import { hashSleutel } from '../netlify/lib/sales-grafsteen.js';
import { maakAuth } from '../netlify/lib/auth.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { geefResultaat, WIJZIGBARE_VELDEN } from '../public/js/sales/lead-regels.js';

process.env.TZ = 'Europe/Brussels';
const NU0 = Date.parse('2026-10-08T10:00:00.000Z');
const NU_ISO = new Date(NU0).toISOString();
const GEHEIM = 'test-geheim-0123456789';
const EIGEN = 'test-sales'; // het id van de testrol 'sales' (metRol)

const gebruikers = () => [
  { id: 'u-bea', email: 'bea@blitz.test', naam: 'Bea', rol: 'beheerder', actief: true },
  { id: 'u-tim', email: 'tim@blitz.test', naam: 'Tim', rol: 'technieker', zohoNaam: 'Tim Z', actief: true },
  { id: 'u-sal', email: 'sal@blitz.test', naam: 'Sal', rol: 'sales', salesNaam: 'Sal V', magAlleSales: false, actief: true },
  { id: 'u-sam', email: 'sam@blitz.test', naam: 'Sam', rol: 'sales', salesNaam: 'Sam V', magAlleSales: true, actief: true },
];
const lead = (id, extra = {}) => ({
  id, voornaam: 'Marie', naam: 'Janssens', email: `${id}@voorbeeld.test`, postcode: '3640', gemeente: 'Kinrooi',
  locatie: { lat: 51, lon: 5, bron: 'postcode' }, status: 'te-plannen', bezoeken: [], geimporteerdOp: '2026-10-01T08:00:00.000Z', ...extra,
});
const blob = (leads = [], extra = {}) => ({ versie: 3, leads, blokken: [], grafstenen: [], ...extra });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
// adres-URL -> adrespunt (lat 51.5), postcode-URL -> middelpunt (lat 50.5); met opties: niets gevonden
const router = ({ adresFaalt = false, postcodeFaalt = false } = {}) => url => {
  if (url.includes('/geocode/')) return adresFaalt ? json({ results: [] }) : json({ results: [{ position: { lat: 51.5, lon: 5.5 } }] });
  if (url.includes('structuredGeocode')) {
    if (postcodeFaalt) return json({ results: [] });
    const pc = /postalCode=(\d+)/.exec(url)[1];
    return json({ results: [{ position: { lat: 50.5, lon: 4.5 }, address: { postalCode: pc, municipality: 'Gemeente ' + pc } }] });
  }
  return undefined;
};

function opzet({ begin = {}, testBegin = {}, fetchOpties, geheim = () => GEHEIM, wrap, auth } = {}) {
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers: gebruikers() }, ...begin });
  const test = maakNepStore(testBegin);
  const { fn, calls } = maakNepFetch(router(fetchOpties));
  const gets = [];
  const getStore = opties => { gets.push(opties.name); return (wrap ?? (s => s))(opties.name === 'blitz-data' ? echt : test, opties.name); };
  const h = maakHandler({ getStore, fetch: fn, nu: () => NU0, sleutel: () => 'NEP', geheim, ...(auth ? { auth } : {}) });
  return { echt, test, h, calls, gets };
}

const req = (methode, { body, zoek = '', headers = {}, pad = 'sales' } = {}) => new Request(`http://localhost/api/${pad}${zoek}`, {
  method: methode,
  headers: { 'content-type': 'application/json', 'x-blitz': '1', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const get = (zoek = '', o = {}) => req('GET', { zoek, ...o });
const patch = (body, o = {}) => req('PATCH', { body, ...o });
const del = (zoek, o = {}) => req('DELETE', { zoek, ...o });
const lees = async res => ({ status: res.status, body: res.status === 204 ? undefined : await res.json(), headers: res.headers });
const rauw = (store, id) => store._data.get(`sales/${id}`);
const blobVan = (store, id) => JSON.parse(rauw(store, id));
const logItems = echt => JSON.parse(echt._data.get('activiteit/2026-10') ?? '{"items":[]}').items;
// Velden die een client stuurt na geefResultaat (enkel de wijzigbare velden; planning/resultaat als null als ze ontbreken).
const veldenNa = nieuw => {
  const v = {};
  for (const k of WIJZIGBARE_VELDEN) if (k in nieuw) v[k] = nieuw[k];
  if (!('planning' in v)) v.planning = null;
  if (!('resultaat' in v)) v.resultaat = null;
  return v;
};
const bevestigd = (id, extra = {}) => lead(id, { status: 'bevestigd', planning: { datum: '2026-10-12', start: '10:00', vast: true }, ...extra });

// ---------------- rechtenrijen ----------------
test('rechtenrijen: sales (GET/PATCH/DELETE) en postcode (GET) voor beheerder en sales', () => {
  for (const m of ['GET', 'PATCH', 'DELETE']) assert.deepEqual([...RECHTEN.sales[m]].sort(), ['beheerder', 'sales'], m);
  assert.deepEqual([...RECHTEN.postcode.GET].sort(), ['beheerder', 'sales']);
  assert.equal(RECHTEN.sales.PUT, undefined);
  assert.equal(RECHTEN.postcode.POST, undefined);
});

// ---------------- bepaalDoel (puur) ----------------
const SALES_A = { id: 'u-sal', rol: 'sales', magAlleSales: false };
const SALES_ALLE = { id: 'u-sam', rol: 'sales', magAlleSales: true };
const BEHEER = { id: 'u-bea', rol: 'beheerder' };
const lijst = async () => gebruikers();
const doel = (gebruiker, gevraagdId, extra = {}) => bepaalDoel({ gebruiker, gevraagdId, schrijven: false, leesGebruikers: lijst, testVerzoek: false, ...extra });

for (const [naam, gebruiker, gevraagdId, extra, verwacht] of [
  ['sales: eigen blob zonder id', SALES_A, null, {}, { ok: true, doelId: 'u-sal' }],
  ['sales: eigen blob met eigen id (ook schrijven)', SALES_A, 'u-sal', { schrijven: true }, { ok: true, doelId: 'u-sal' }],
  ['sales: lege id telt als eigen', SALES_A, '', {}, { ok: true, doelId: 'u-sal' }],
  ['sales zonder magAlleSales: ander id -> 403', SALES_A, 'u-sam', {}, { ok: false, status: 403 }],
  ['sales met magAlleSales: leest een andere verkoper', SALES_ALLE, 'u-sal', {}, { ok: true, doelId: 'u-sal' }],
  ['sales met magAlleSales: schrijven bij een ander -> 403', SALES_ALLE, 'u-sal', { schrijven: true }, { ok: false, status: 403 }],
  ['sales met magAlleSales: beheerder als doel -> 403', SALES_ALLE, 'u-bea', {}, { ok: false, status: 403 }],
  ['sales met magAlleSales: technieker als doel -> 403', SALES_ALLE, 'u-tim', {}, { ok: false, status: 403 }],
  ['sales met magAlleSales: onbekend id -> 403 (geen lek)', SALES_ALLE, 'bestaat-niet', {}, { ok: false, status: 403 }],
  ['beheerder: elke verkoper lezen', BEHEER, 'u-sal', {}, { ok: true, doelId: 'u-sal' }],
  ['beheerder: elke verkoper schrijven', BEHEER, 'u-sam', { schrijven: true }, { ok: true, doelId: 'u-sam' }],
  ['beheerder: niet-verkoper -> 404', BEHEER, 'u-tim', {}, { ok: false, status: 404 }],
  ['beheerder: zichzelf (geen verkoper) -> 404', BEHEER, 'u-bea', {}, { ok: false, status: 404 }],
  ['beheerder: zonder id -> 404', BEHEER, null, {}, { ok: false, status: 404 }],
  ['beheerder: onbekend id -> 404', BEHEER, 'bestaat-niet', {}, { ok: false, status: 404 }],
  ['beheerder: test-sales zonder testverzoek -> 404', BEHEER, 'test-sales', {}, { ok: false, status: 404 }],
  ['beheerder: test-sales mét testverzoek (lezen en schrijven)', BEHEER, 'test-sales', { testVerzoek: true, schrijven: true }, { ok: true, doelId: 'test-sales' }],
  ['planner -> 403', { id: 'u-p', rol: 'planner' }, 'u-sal', {}, { ok: false, status: 403 }],
  ['technieker -> 403', { id: 'u-tim', rol: 'technieker' }, null, {}, { ok: false, status: 403 }],
  ['geen gebruiker -> 403', null, null, {}, { ok: false, status: 403 }],
]) {
  test(`bepaalDoel: ${naam}`, async () => {
    const r = await doel(gebruiker, gevraagdId, extra);
    assert.equal(r.ok, verwacht.ok);
    if (verwacht.ok) assert.equal(r.doelId, verwacht.doelId);
    else {
      assert.equal(r.status, verwacht.status);
      assert.equal(typeof r.fout, 'string');
    }
  });
}

test('bepaalDoel: een onbekend id geeft hetzelfde antwoord als een niet-verkoper (geen lek) en zoekt niet voor het eigen id', async () => {
  let opzoekingen = 0;
  const leesGebruikers = async () => { opzoekingen++; return gebruikers(); };
  const eigen = await bepaalDoel({ gebruiker: SALES_A, gevraagdId: 'u-sal', schrijven: true, leesGebruikers, testVerzoek: false });
  assert.equal(eigen.ok, true);
  assert.equal(opzoekingen, 0);
  const a = await bepaalDoel({ gebruiker: SALES_ALLE, gevraagdId: 'u-tim', schrijven: false, leesGebruikers, testVerzoek: false });
  const b = await bepaalDoel({ gebruiker: SALES_ALLE, gevraagdId: 'nergens', schrijven: false, leesGebruikers, testVerzoek: false });
  assert.deepEqual(a, b);
});

// ---------------- toegang via de functie (matrix) ----------------
const SEED = () => ({
  [`sales/${EIGEN}`]: blob([lead('a'), lead('b')]),
  'sales/u-sam': blob([lead('s1')], { versie: 7 }),
  'sales/u-sal': blob([lead('t1')], { versie: 2 }),
});
const velden = { notitie: 'bellen na 17u' };
const patchA = (versie = 3, extra = {}) => ({ versie, leads: [{ id: 'a', velden }], ...extra });

for (const [naam, rol, opties, methode, zoek, body, status] of [
  ['sales leest zichzelf', 'sales', {}, 'GET', '', undefined, 200],
  ['sales leest zichzelf met eigen id', 'sales', {}, 'GET', `?gebruiker=${EIGEN}`, undefined, 200],
  ['sales leest een ander -> 403', 'sales', {}, 'GET', '?gebruiker=u-sam', undefined, 403],
  ['sales schrijft een ander -> 403', 'sales', {}, 'PATCH', '?gebruiker=u-sam', patchA(7), 403],
  ['sales verwijdert bij een ander -> 403', 'sales', {}, 'DELETE', '?lead=s1&gebruiker=u-sam', undefined, 403],
  ['sales+alle leest een verkoper', 'sales', { magAlleSales: true }, 'GET', '?gebruiker=u-sam', undefined, 200],
  ['sales+alle PATCH bij een andere -> 403', 'sales', { magAlleSales: true }, 'PATCH', '?gebruiker=u-sam', patchA(7), 403],
  ['sales+alle DELETE bij een andere -> 403', 'sales', { magAlleSales: true }, 'DELETE', '?lead=s1&gebruiker=u-sam', undefined, 403],
  ['sales+alle leest een beheerder -> 403', 'sales', { magAlleSales: true }, 'GET', '?gebruiker=u-bea', undefined, 403],
  ['sales+alle leest een technieker -> 403', 'sales', { magAlleSales: true }, 'GET', '?gebruiker=u-tim', undefined, 403],
  ['sales+alle leest een onbekend id -> 403', 'sales', { magAlleSales: true }, 'GET', '?gebruiker=niemand', undefined, 403],
  ['sales+alle schrijft zijn eigen blob', 'sales', { magAlleSales: true }, 'PATCH', '', patchA(3), 200],
  ['beheerder leest een verkoper', 'beheerder', {}, 'GET', '?gebruiker=u-sam', undefined, 200],
  ['beheerder schrijft een verkoper', 'beheerder', {}, 'PATCH', '?gebruiker=u-sam', { versie: 7, leads: [{ id: 's1', velden }] }, 200],
  ['beheerder verwijdert bij een verkoper', 'beheerder', {}, 'DELETE', '?lead=s1&gebruiker=u-sam', undefined, 200],
  ['beheerder leest een technieker -> 404', 'beheerder', {}, 'GET', '?gebruiker=u-tim', undefined, 404],
  ['beheerder schrijft een beheerder -> 404', 'beheerder', {}, 'PATCH', '?gebruiker=u-bea', patchA(0), 404],
  ['beheerder leest een onbekend id -> 404', 'beheerder', {}, 'GET', '?gebruiker=niemand', undefined, 404],
  ['beheerder zonder ?gebruiker -> 404', 'beheerder', {}, 'GET', '', undefined, 404],
]) {
  test(`toegang: ${naam}`, async () => {
    const { h, echt } = opzet({ begin: SEED() });
    const voor = new Map([...echt._data].filter(([k]) => k.startsWith('sales/')));
    const r = await metRol(rol, async () => lees(await h(req(methode, { zoek, body }))), opties);
    assert.equal(r.status, status);
    if (status === 403) assert.equal(r.body.code, 'geen-recht');
    if (status >= 400) {
      for (const [k, w] of voor) assert.equal(echt._data.get(k), w, `${k} onaangeroerd`); // geen enkele schrijfactie bij een weigering
    }
  });
}

test('toegang: planner en technieker -> 403 geen-recht van de wrapper; de kern draait niet (geen store aangeraakt)', async () => {
  for (const rol of ['planner', 'technieker']) {
    for (const [methode, zoek, body] of [['GET', '', undefined], ['PATCH', '', patchA()], ['DELETE', '?lead=a', undefined]]) {
      const { h, gets } = opzet({ begin: SEED() });
      const r = await metRol(rol, async () => lees(await h(req(methode, { zoek, body }))));
      assert.equal(r.status, 403, `${rol} ${methode}`);
      assert.equal(r.body.code, 'geen-recht');
      assert.deepEqual(gets, [], `${rol} ${methode}: geen store`);
    }
  }
});

test('toegang: zonder sessie -> 401 niet-ingelogd', async () => {
  const { h, gets } = opzet({ begin: SEED() });
  const r = await metGeenSessie(async () => lees(await h(get())));
  assert.equal(r.status, 401);
  assert.equal(r.body.code, 'niet-ingelogd');
  assert.deepEqual(gets, []);
});

test('toegang: PATCH zonder X-Blitz -> 403 csrf (testrol-pad); mét X-Blitz gaat hij door', async () => {
  const auth = maakAuth({ getStore: () => { throw new Error('geen store nodig'); }, env: { BLITZ_LOKALE_DEV: '1' } });
  const testKoppen = { 'x-blitz-test': '1', 'x-blitz-test-rol': 'sales' };
  const { h, test: teststore } = opzet({ auth, testBegin: { [`sales/${EIGEN}`]: blob([lead('a')]) } });
  const zonder = new Request('http://localhost/api/sales', {
    method: 'PATCH', headers: { 'content-type': 'application/json', ...testKoppen }, body: JSON.stringify(patchA()),
  });
  const r = await lees(await h(zonder));
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'csrf');
  assert.equal(blobVan(teststore, EIGEN).versie, 3);
  const met = await lees(await h(patch(patchA(), { headers: testKoppen })));
  assert.equal(met.status, 200);
});

test('OPTIONS -> 204 met CORS, zonder login en zonder store', async () => {
  const { h, gets } = opzet();
  const res = await metGeenSessie(async () => h(new Request('http://localhost/api/sales', { method: 'OPTIONS' })));
  assert.equal(res.status, 204);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /PATCH/);
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /DELETE/);
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /X-Blitz-Test/);
  assert.deepEqual(gets, []);
});

// ---------------- GET ----------------
test('GET: eigen leeg blob -> 200 { gebruikerId, versie:0, leads:[], blokken:[], open:0 }, no-store, nooit grafstenen', async () => {
  const { h } = opzet();
  const r = await metRol('sales', async () => lees(await h(get())));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { gebruikerId: EIGEN, versie: 0, leads: [], blokken: [], open: 0 });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('GET: bestaand blob; grafstenen nooit in het antwoord; open telt leads zonder locatie', async () => {
  const begin = { [`sales/${EIGEN}`]: blob([lead('a'), lead('b', { locatie: null })], { grafstenen: [{ h: ['x'], op: NU_ISO }] }) };
  const { h } = opzet({ begin });
  const r = await metRol('sales', async () => lees(await h(get())));
  assert.equal(r.body.versie, 3);
  assert.equal(r.body.leads.length, 2);
  assert.equal(r.body.open, 1);
  assert.ok(!JSON.stringify(r.body).includes('grafstenen'));
});

// ---------------- PATCH ----------------
test('PATCH: zonder versie -> 400 "versie ontbreekt"', async () => {
  const { h, echt } = opzet({ begin: SEED() });
  const voor = rauw(echt, EIGEN);
  const r = await metRol('sales', async () => lees(await h(patch({ leads: [{ id: 'a', velden }] }))));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'versie ontbreekt');
  assert.equal(rauw(echt, EIGEN), voor);
});

test('PATCH: ongeldige JSON -> 400', async () => {
  const { h } = opzet({ begin: SEED() });
  const r = await metRol('sales', async () => lees(await h(new Request('http://localhost/api/sales', {
    method: 'PATCH', headers: { 'x-blitz': '1' }, body: '{kapot',
  }))));
  assert.equal(r.status, 400);
});

test('PATCH: verkeerde versie -> 409 met serverVersie en data (volledige blob, zonder grafstenen)', async () => {
  const begin = { [`sales/${EIGEN}`]: blob([lead('a')], { grafstenen: [{ h: ['x'], op: NU_ISO }] }) };
  const { h, echt } = opzet({ begin });
  const voor = rauw(echt, EIGEN);
  const r = await metRol('sales', async () => lees(await h(patch(patchA(1)))));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'Versiematch mislukt');
  assert.equal(r.body.serverVersie, 3);
  assert.equal(r.body.data.versie, 3);
  assert.equal(r.body.data.leads.length, 1);
  assert.deepEqual(r.body.data.blokken, []);
  assert.ok(!JSON.stringify(r.body).includes('grafstenen'));
  assert.equal(rauw(echt, EIGEN), voor);
});

test('PATCH: geldige lead-patch -> versie +1 en het volledige blob in het antwoord', async () => {
  const { h, echt } = opzet({ begin: SEED() });
  const r = await metRol('sales', async () => lees(await h(patch(patchA()))));
  assert.equal(r.status, 200);
  assert.equal(r.body.versie, 4);
  assert.equal(r.body.gebruikerId, EIGEN);
  assert.equal(r.body.leads.length, 2);
  assert.equal(r.body.leads.find(l => l.id === 'a').notitie, 'bellen na 17u');
  assert.equal(typeof r.body.open, 'number');
  assert.ok(!('grafstenen' in r.body));
  assert.equal(blobVan(echt, EIGEN).versie, 4);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('PATCH: blok toevoegen krijgt een server-id', async () => {
  const { h } = opzet({ begin: SEED() });
  const r = await metRol('sales', async () => lees(await h(patch({
    versie: 3, blokken: { toevoegen: [{ datum: '2026-10-12', start: '13:00', eind: '14:00', soort: 'verlof', omschrijving: 'tandarts' }] },
  }))));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.blokken.length, 1);
  assert.match(r.body.blokken[0].id, /^b-/);
});

test('PATCH: ongeldige patch -> 400 met fouten; het blob blijft onaangeroerd', async () => {
  const { h, echt } = opzet({ begin: SEED() });
  const voor = rauw(echt, EIGEN);
  const r = await metRol('sales', async () => lees(await h(patch({ versie: 3, leads: [{ id: 'a', velden: { status: 'afgewerkt' } }, { id: 'nergens', velden }] }))));
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.body.fouten) && r.body.fouten.length >= 1);
  assert.equal(rauw(echt, EIGEN), voor);
});

test('PATCH: lege patch schrijft niets (geen versieverhoging)', async () => {
  const { h, echt } = opzet({ begin: SEED() });
  const voor = rauw(echt, EIGEN);
  const r = await metRol('sales', async () => lees(await h(patch({ versie: 3 }))));
  assert.equal(r.status, 200);
  assert.equal(r.body.versie, 3);
  assert.equal(rauw(echt, EIGEN), voor);
});

test('PATCH: adreswijziging -> geocodeAdres, locatie.bron "adres"', async () => {
  const begin = { [`sales/${EIGEN}`]: blob([lead('a', { straat: 'Dorpsstraat', huisnr: '12' })]) };
  const { h, echt, calls } = opzet({ begin });
  const r = await metRol('sales', async () => lees(await h(patch({ versie: 3, leads: [{ id: 'a', velden: { huisnr: '14' } }] }))));
  assert.equal(r.status, 200);
  const l = r.body.leads[0];
  assert.deepEqual(l.locatie, { lat: 51.5, lon: 5.5, bron: 'adres' });
  assert.ok(calls.some(c => c.url.includes('/geocode/') && decodeURIComponent(c.url).includes('Dorpsstraat 14')), 'adres gegeocodeerd');
  assert.equal(r.body.open, 0);
  assert.equal(blobVan(echt, EIGEN).leads[0].locatie.bron, 'adres');
  assert.equal(r.body.versie, 5); // wijziging (4) + locatie (5)
});

test('PATCH: geocoding van het adres faalt -> terugval op het postcode-middelpunt (bron "postcode"), geen crash', async () => {
  const begin = { [`sales/${EIGEN}`]: blob([lead('a', { straat: 'Dorpsstraat', huisnr: '12' })]) };
  const { h } = opzet({ begin, fetchOpties: { adresFaalt: true } });
  const r = await metRol('sales', async () => lees(await h(patch({ versie: 3, leads: [{ id: 'a', velden: { huisnr: '14' } }] }))));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.leads[0].locatie, { lat: 50.5, lon: 4.5, bron: 'postcode' });
});

test('PATCH: postcode niet te vinden -> locatie null, lead telt als open', async () => {
  const begin = { [`sales/${EIGEN}`]: blob([lead('a', { straat: 'Dorpsstraat', huisnr: '12' })]) };
  const { h } = opzet({ begin, fetchOpties: { adresFaalt: true, postcodeFaalt: true } });
  const r = await metRol('sales', async () => lees(await h(patch({ versie: 3, leads: [{ id: 'a', velden: { huisnr: '14' } }] }))));
  assert.equal(r.status, 200);
  assert.equal(r.body.leads[0].locatie, null);
  assert.equal(r.body.open, 1);
});

test('PATCH: aanvullen:true vult ontbrekende locaties aan en geeft het aantal open', async () => {
  const begin = { [`sales/${EIGEN}`]: blob([lead('a', { locatie: null }), lead('b', { locatie: null, postcode: '3500' })]) };
  const { h, echt } = opzet({ begin });
  const r = await metRol('sales', async () => lees(await h(patch({ versie: 3, aanvullen: true }))));
  assert.equal(r.status, 200);
  assert.equal(r.body.open, 0);
  assert.ok(r.body.leads.every(l => l.locatie && l.locatie.bron === 'postcode'));
  assert.equal(blobVan(echt, EIGEN).versie, 4);
});

test('PATCH: aanvullen:true zonder werk schrijft niets', async () => {
  const { h, echt } = opzet({ begin: SEED() });
  const voor = rauw(echt, EIGEN);
  const r = await metRol('sales', async () => lees(await h(patch({ versie: 3, aanvullen: true }))));
  assert.equal(r.status, 200);
  assert.equal(r.body.open, 0);
  assert.equal(rauw(echt, EIGEN), voor);
});

test('PATCH: resultaat verkocht én opnieuw -> elk één logregel sales-resultaat zonder persoonsgegevens', async () => {
  const begin = { [`sales/${EIGEN}`]: blob([bevestigd('a'), bevestigd('b', { naam: 'Geheimnaam', gsm: '0471234567' })]) };
  const { h, echt } = opzet({ begin });
  const nieuwA = geefResultaat(bevestigd('a'), { soort: 'verkocht', notitie: 'prima', nu: new Date(NU0) });
  const r1 = await metRol('sales', async () => lees(await h(patch({ versie: 3, leads: [{ id: 'a', velden: veldenNa(nieuwA) }] }))));
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const nieuwB = geefResultaat(bevestigd('b', { naam: 'Geheimnaam', gsm: '0471234567' }), { soort: 'opnieuw', nu: new Date(NU0) });
  const r2 = await metRol('sales', async () => lees(await h(patch({ versie: 4, leads: [{ id: 'b', velden: veldenNa(nieuwB) }] }))));
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const items = logItems(echt).filter(i => i.actie === 'sales-resultaat');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => [i.onderwerp, i.details]), [['a', '{"soort":"verkocht"}'], ['b', '{"soort":"opnieuw"}']]);
  assert.ok(items.every(i => i.gebruikerId === EIGEN && i.op === NU_ISO));
  const tekst = JSON.stringify(logItems(echt));
  for (const verboden of ['Janssens', 'Geheimnaam', '0471234567', 'voorbeeld.test', 'prima']) assert.ok(!tekst.includes(verboden), verboden);
});

test('PATCH: een mislukte patch logt niets; een patch zonder resultaat ook niet', async () => {
  const { h, echt } = opzet({ begin: SEED() });
  await metRol('sales', async () => h(patch(patchA(1))));      // 409
  await metRol('sales', async () => h(patch(patchA())));       // 200, notitie
  assert.deepEqual(logItems(echt), []);
});

test('PATCH door de beheerder voor een verkoper: de actor staat in het log, het doel is de blob van de verkoper', async () => {
  const begin = { 'sales/u-sam': blob([bevestigd('s1')], { versie: 7 }) };
  const { h, echt } = opzet({ begin });
  const nieuw = geefResultaat(bevestigd('s1'), { soort: 'offerte', nu: new Date(NU0) });
  const r = await lees(await h(patch({ versie: 7, leads: [{ id: 's1', velden: veldenNa(nieuw) }] }, { zoek: '?gebruiker=u-sam' })));
  assert.equal(r.status, 200);
  assert.equal(r.body.gebruikerId, 'u-sam');
  assert.equal(blobVan(echt, 'u-sam').versie, 8);
  const [item] = logItems(echt);
  assert.equal(item.gebruikerId, 'test-beheerder');
  assert.equal(item.onderwerp, 's1');
});

test('PATCH: twee gelijktijdige verzoeken met dezelfde versie -> één 200, één 409; na een nieuwe poging staan beide wijzigingen er', async () => {
  const { h, echt } = opzet({ begin: SEED() });
  const stuur = (id, notitie, versie) => h(patch({ versie, leads: [{ id, velden: { notitie } }] })).then(lees);
  // (metRol niet per verzoek: gelijktijdige metRol-aanroepen herstellen de basisinstelling in de verkeerde volgorde)
  const [r1, r2] = await metRol('sales', async () => Promise.all([stuur('a', 'eerste', 3), stuur('b', 'tweede', 3)]));
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  const verliezer = r1.status === 409 ? ['a', 'eerste', r1] : ['b', 'tweede', r2];
  assert.equal(verliezer[2].body.data.versie, 4);
  const opnieuw = await metRol('sales', () => stuur(verliezer[0], verliezer[1], verliezer[2].body.serverVersie));
  assert.equal(opnieuw.status, 200);
  const eind = blobVan(echt, EIGEN);
  assert.equal(eind.versie, 5);
  assert.equal(eind.leads.find(l => l.id === 'a').notitie, 'eerste');
  assert.equal(eind.leads.find(l => l.id === 'b').notitie, 'tweede');
});

// ---------------- opslagstoring ----------------
// Enkel de `sales/`-sleutels zijn kapot: de gebruikerslijst (auth) blijft leesbaar, zodat het onderscheid 401/403 <-> 503 klopt.
const kapotLezen = s => ({ ...s, get: async (k, o) => { if (k.startsWith('sales/')) throw new Error('blobs onbereikbaar'); return s.get(k, o); } });
const kapotSchrijven = s => ({ ...s, setJSON: async k => { if (k.startsWith('sales/')) throw new Error('blobs onbereikbaar'); throw new Error('onverwacht'); } });
const afwijkendTeruglezen = s => ({
  ...s,
  get: async (k, o) => {
    const w = await s.get(k, o);
    return k.startsWith('sales/') && w && s._schrijfacties.some(a => a.key === k) ? { ...w, versie: w.versie - 1, leads: [lead('a'), ...w.leads.filter(l => l.id !== 'a')] } : w;
  },
});

function verwachtStoring(r, naam) {
  assert.equal(r.status, 503, naam);
  assert.equal(r.body.code, 'opslag-storing', naam);
  assert.equal(typeof r.body.error, 'string');
}

test('opslagstoring: GET, PATCH en DELETE geven 503 opslag-storing (geen 401/403, geen gedeeltelijke schrijfactie)', async () => {
  const gevallen = [
    ['GET lezen kapot', kapotLezen, get()],
    ['PATCH lezen kapot', kapotLezen, patch(patchA())],
    ['DELETE lezen kapot', kapotLezen, del('?lead=a')],
    ['PATCH schrijven kapot', kapotSchrijven, patch(patchA())],
    ['DELETE schrijven kapot', kapotSchrijven, del('?lead=a')],
    ['PATCH teruglezen wijkt af', afwijkendTeruglezen, patch(patchA())],
    ['DELETE teruglezen wijkt af', afwijkendTeruglezen, del('?lead=a')],
  ];
  for (const [naam, wrap, verzoek] of gevallen) {
    const { h, echt } = opzet({ begin: SEED(), wrap: (s, n) => (n === 'blitz-data' ? wrap(s) : s) });
    const r = await metRol('sales', async () => lees(await h(verzoek)));
    verwachtStoring(r, naam);
  }
});

test('opslagstoring: een geweigerde schrijfactie laat het blob ongewijzigd (PATCH en DELETE)', async () => {
  for (const verzoek of [patch(patchA()), del('?lead=a')]) {
    const { h, echt } = opzet({ begin: SEED(), wrap: (s, n) => (n === 'blitz-data' ? kapotSchrijven(s) : s) });
    const voor = rauw(echt, EIGEN);
    verwachtStoring(await metRol('sales', async () => lees(await h(verzoek))), 'schrijven');
    assert.equal(rauw(echt, EIGEN), voor);
  }
});

test('opslagstoring: getStore zelf faalt (ook voor de beheerder en de gebruikerslijst) -> 503; de fout-log bevat enkel het fouttype', async () => {
  const gelogd = [];
  const oud = console.error;
  console.error = (...a) => gelogd.push(a.join(' '));
  try {
    const h = maakHandler({ getStore: () => { throw new TypeError('geheime-details https://x.test?key=abc'); }, fetch: async () => json({}), nu: () => NU0 });
    verwachtStoring(await lees(await h(get('?gebruiker=u-sam'))), 'beheerder');
    verwachtStoring(await metRol('sales', async () => lees(await h(get()))), 'sales');
  } finally {
    console.error = oud;
  }
  assert.ok(gelogd.length >= 1);
  assert.ok(gelogd.every(t => t.includes('TypeError') && !t.includes('geheime-details') && !t.includes('abc')), gelogd.join('|'));
});

// ---------------- DELETE ----------------
const verwijderLeads = () => ({
  [`sales/${EIGEN}`]: blob([
    lead('a', { voornaam: 'Wim', naam: 'Verwijderd', email: 'Weg@Voorbeeld.test', gsm: '0471234567' }),
    lead('b', { voornaam: 'Eva', naam: 'Blijver', email: 'blijf@voorbeeld.test' }),
  ]),
  'sales/u-sam': blob([lead('s1', { naam: 'Samnaam' })], { versie: 7 }),
});

test('DELETE: verwijdert de lead, versie +1, antwoord { versie }, logregel met enkel het lead-id', async () => {
  const { h, echt } = opzet({ begin: verwijderLeads() });
  const r = await metRol('sales', async () => lees(await h(del('?lead=a', { headers: { 'x-blitz': '1' } }))));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { versie: 4 });
  assert.deepEqual(blobVan(echt, EIGEN).leads.map(l => l.id), ['b']);
  const items = logItems(echt);
  assert.equal(items.length, 1);
  assert.equal(items[0].actie, 'sales-lead-verwijderd');
  assert.equal(items[0].onderwerp, 'a');
  assert.equal(items[0].details, null);
  assert.equal(items[0].gebruikerId, EIGEN);
  const tekst = JSON.stringify(items);
  for (const verboden of ['Verwijderd', 'Wim', 'Weg@', 'weg@', '0471234567']) assert.ok(!tekst.includes(verboden), verboden);
});

test('DELETE: grafsteen met HMAC-hashes en geen naam, e-mail of gsm; het blob van een andere verkoper blijft onaangeroerd', async () => {
  const { h, echt } = opzet({ begin: verwijderLeads() });
  const sam = rauw(echt, 'u-sam');
  await metRol('sales', async () => h(del('?lead=a')));
  const data = blobVan(echt, EIGEN);
  assert.equal(data.grafstenen.length, 1);
  const verwacht = ['e:weg@voorbeeld.test', 'g:0471234567'].map(s => hashSleutel(s, EIGEN, GEHEIM));
  assert.ok(data.grafstenen[0].h.length >= 1);
  assert.ok(data.grafstenen[0].h.includes(hashSleutel('e:weg@voorbeeld.test', EIGEN, GEHEIM)), 'e-mailhash aanwezig');
  assert.ok(data.grafstenen[0].h.every(x => /^[0-9a-f]{32}$/.test(x)));
  assert.ok(verwacht.length === 2);
  assert.equal(data.grafstenen[0].op, NU_ISO);
  const rauwBlob = rauw(echt, EIGEN).toLowerCase();
  for (const verboden of ['verwijderd', 'weg@voorbeeld', '0471234567', '"wim"']) assert.ok(!rauwBlob.includes(verboden), verboden);
  assert.equal(rauw(echt, 'u-sam'), sam);
});

test('DELETE: zonder SESSIE_GEHEIM wordt de lead toch verwijderd, zonder grafsteen', async () => {
  const { h, echt } = opzet({ begin: verwijderLeads(), geheim: () => undefined });
  const r = await metRol('sales', async () => lees(await h(del('?lead=a'))));
  assert.equal(r.status, 200);
  const data = blobVan(echt, EIGEN);
  assert.deepEqual(data.leads.map(l => l.id), ['b']);
  assert.deepEqual(data.grafstenen, []);
});

test('DELETE: het antwoord en elke volgende GET bevatten geen grafstenen', async () => {
  const { h } = opzet({ begin: verwijderLeads() });
  const r = await metRol('sales', async () => lees(await h(del('?lead=a'))));
  assert.ok(!JSON.stringify(r.body).includes('grafstenen'));
  const g = await metRol('sales', async () => lees(await h(get())));
  assert.ok(!JSON.stringify(g.body).includes('grafstenen'));
});

test('DELETE: onbekend lead-id -> 404 en het blob blijft onaangeroerd; zonder lead-parameter -> 400', async () => {
  const { h, echt } = opzet({ begin: verwijderLeads() });
  const voor = rauw(echt, EIGEN);
  assert.equal((await metRol('sales', async () => lees(await h(del('?lead=bestaat-niet'))))).status, 404);
  assert.equal((await metRol('sales', async () => lees(await h(del(''))))).status, 400);
  assert.equal((await metRol('sales', async () => lees(await h(del('?lead='))))).status, 400);
  assert.equal(rauw(echt, EIGEN), voor);
  assert.deepEqual(logItems(echt), []);
});

test('DELETE: de beheerder verwijdert in het blob van de gekozen verkoper', async () => {
  const { h, echt } = opzet({ begin: verwijderLeads() });
  const r = await lees(await h(del('?lead=s1&gebruiker=u-sam')));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { versie: 8 });
  assert.deepEqual(blobVan(echt, 'u-sam').leads, []);
  assert.equal(blobVan(echt, 'u-sam').grafstenen.length, 1);
  assert.equal(blobVan(echt, EIGEN).versie, 3);
});

// ---------------- testmodus ----------------
test('testmodus: een GET leest de teststore en nooit de echte blobs sales/<id>', async () => {
  // (Het niet-kopiëren zelf staat in tests/testmodus-auth.test.mjs: de kopie draait maar één keer per proces.)
  const { h, echt, test: teststore } = opzet({ begin: { ...SEED(), afspraken: { lijst: [1] } } });
  const r = await lees(await h(get('?gebruiker=test-sales', { headers: { 'x-blitz-test': '1' } })));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.leads, []);
  assert.ok(![...teststore._data.keys()].some(k => k === 'sales/u-sam' || k === 'sales/u-sal'));
  assert.ok(echt._data.has('sales/u-sam'));
});

test('testmodus: X-Blitz-Test -> teststore, fetch 0x, geen activiteitenlog; test-sales enkel geldig bij een testverzoek', async () => {
  const testBegin = { 'sales/test-sales': blob([bevestigd('a', { locatie: null }), lead('b', { locatie: null, straat: 'Dorpsstraat', huisnr: '1' })]) };
  const { h, echt, test: teststore, calls } = opzet({ testBegin });
  const nieuw = geefResultaat(bevestigd('a', { locatie: null }), { soort: 'verkocht', nu: new Date(NU0) });
  const k = { 'x-blitz-test': '1' };
  const r = await lees(await h(patch({ versie: 3, aanvullen: true, leads: [{ id: 'a', velden: veldenNa(nieuw) }] }, { zoek: '?gebruiker=test-sales', headers: k })));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(calls.length, 0, 'geen TomTom-aanroep');
  assert.ok(r.body.leads.every(l => l.locatie && Number.isFinite(l.locatie.lat)), 'nepcoördinaten');
  assert.equal(r.body.open, 0);
  assert.equal(blobVan(teststore, 'test-sales').versie, 5);
  assert.deepEqual(logItems(echt), []);
  assert.ok(![...echt._data.keys()].some(x => x.startsWith('activiteit/')));
  assert.ok(![...echt._data.keys()].some(x => x.includes('test-sales')));
  // zonder testverzoek bestaat test-sales niet voor de beheerder
  const zonder = await lees(await h(get('?gebruiker=test-sales')));
  assert.equal(zonder.status, 404);
});

// ---------------- postcode ----------------
const postcodeOpzet = (o = {}) => {
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers: gebruikers() } });
  const test = maakNepStore();
  const { fn, calls } = maakNepFetch(router(o.fetchOpties));
  const gets = [];
  const getStore = opties => { gets.push(opties.name); if (o.kapot) throw new Error('weg'); return opties.name === 'blitz-data' ? echt : test; };
  return { echt, test, calls, gets, h: maakPostcodeHandler({ getStore, fetch: fn, nu: () => NU0, sleutel: () => 'NEP' }) };
};
const pc = (zoek, o = {}) => req('GET', { pad: 'postcode', zoek, ...o });

test('postcode: ?pc=3640 -> 200 { pc, lat, lon, gemeente }; tweede keer uit de cache', async () => {
  const { h, calls, echt } = postcodeOpzet();
  const r = await metRol('sales', async () => lees(await h(pc('?pc=3640'))));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { pc: '3640', lat: 50.5, lon: 4.5, gemeente: 'Gemeente 3640' });
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  const tweede = await lees(await h(pc('?pc=3640'))); // beheerder
  assert.equal(tweede.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(echt._data.has('postcode-cache'));
});

test('postcode: ongeldige pc -> 400 (zonder fetch); onbekende -> 404', async () => {
  const { h, calls } = postcodeOpzet();
  for (const zoek of ['?pc=36', '', '?pc=abcd', '?pc=36400', '?pc=0999']) {
    assert.equal((await metRol('sales', async () => lees(await h(pc(zoek))))).status, 400, zoek);
  }
  assert.equal(calls.length, 0);
  const geen = postcodeOpzet({ fetchOpties: { postcodeFaalt: true } });
  assert.equal((await metRol('sales', async () => lees(await geen.h(pc('?pc=3640'))))).status, 404);
});

test('postcode: planner en technieker -> 403 zonder store; zonder sessie 401; OPTIONS 204', async () => {
  for (const rol of ['planner', 'technieker']) {
    const { h, gets } = postcodeOpzet();
    const r = await metRol(rol, async () => lees(await h(pc('?pc=3640'))));
    assert.equal(r.status, 403, rol);
    assert.equal(r.body.code, 'geen-recht');
    assert.deepEqual(gets, []);
  }
  const { h } = postcodeOpzet();
  assert.equal((await metGeenSessie(async () => lees(await h(pc('?pc=3640'))))).status, 401);
  const o = await metGeenSessie(async () => h(new Request('http://localhost/api/postcode', { method: 'OPTIONS' })));
  assert.equal(o.status, 204);
});

test('postcode: testmodus -> nepcoördinaten zonder fetch', async () => {
  const { h, calls } = postcodeOpzet();
  const r = await metRol('sales', async () => lees(await h(pc('?pc=3640', { headers: { 'x-blitz-test': '1' } }))));
  assert.equal(r.status, 200);
  assert.equal(r.body.pc, '3640');
  assert.ok(Number.isFinite(r.body.lat) && Number.isFinite(r.body.lon));
  assert.equal(r.body.gemeente, 'Testgemeente');
  assert.equal(calls.length, 0);
});

test('postcode: opslag onbereikbaar -> 503 opslag-storing', async () => {
  const { h } = postcodeOpzet({ kapot: true });
  verwachtStoring(await metRol('sales', async () => lees(await h(pc('?pc=3640')))), 'postcode');
});
