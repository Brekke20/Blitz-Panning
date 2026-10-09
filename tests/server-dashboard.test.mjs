// tests/server-dashboard.test.mjs — /api/dashboard en /api/dashboard-instellingen (enkel beheerder)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { maakHandler } from '../netlify/functions/dashboard.js';
import { maakHandler as maakInstellingenHandler } from '../netlify/functions/dashboard-instellingen.js';
import { leesRapportenVoorDashboard } from '../netlify/lib/dashboard-bronnen.js';
import { rolIsToegelaten } from '../netlify/lib/rechten.js';
import { STANDAARD_GRENZEN } from '../public/js/kern/dashboard-grenzen.js';
import { maakAuth } from '../netlify/lib/auth.js';
import { ondertekenToken } from '../netlify/lib/sessie-token.js';
import { metRol, metGeenSessie } from './auth-hulp.mjs';

const NU = Date.parse('2026-10-08T10:00:00.000Z');

const entry = (id, datum, extra = {}) => ({
  id, datum, aangemaakt: `${datum}T12:00:00.000Z`, technieker: 'Tim', ticketId: `T-${id}`, interventieType: 'Interventie',
  hersteld: 'ja', nieuwInter: 'nee', servicetype: '2e-lijn', verwerking: { status: 'in-zoho' },
  rapportData: { type: 'CHARX', start: '09:00', stop: '10:00', onderdelen: [], oorzaakStoring: [] }, ...extra,
});
const lijst = rapports => ({ versie: 1, rapports });
const annulatie = (op, details = 'Klant belde af') => ({ op, gebruikerId: 'u-bea', naam: 'Bea', actie: 'annulatie', onderwerp: 'T-1', details });

// Een store die voor sleutels die op `patroon` passen (get én list) gooit.
function kapot(store, patroon) {
  const f = k => { if (patroon.test(k)) throw new Error('opslag stuk'); };
  return {
    ...store,
    get: async (k, o) => { f(k); return store.get(k, o); },
    list: async (o = {}) => { f(o.prefix ?? ''); return store.list(o); },
  };
}

function opzet(begin = {}, { echtOmhul = s => s } = {}) {
  const echt = maakNepStore(begin);
  const test = maakNepStore({});
  const getStore = o => (o.name === 'blitz-data' ? echtOmhul(echt) : test);
  return {
    echt, test, getStore,
    h: maakHandler({ getStore, nu: () => NU }),
    hi: maakInstellingenHandler({ getStore }),
  };
}

const get = (zoek = '', headers = {}) => new Request(`http://localhost/api/dashboard${zoek}`, { method: 'GET', headers: { 'x-blitz': '1', ...headers } });
const lees = async (h, zoek, rol = 'beheerder', headers) => {
  const res = await metRol(rol, () => h(get(zoek, headers)));
  return { status: res.status, body: await res.json() };
};
const GOED = '?van=2026-10-01&tot=2026-10-08';

// ---------------- rechten ----------------
test('rechtenrijen: dashboard enkel beheerder, instellingen GET en PUT enkel beheerder', () => {
  assert.equal(rolIsToegelaten('dashboard', 'GET', 'beheerder'), true);
  for (const rol of ['planner', 'technieker', 'sales']) {
    assert.equal(rolIsToegelaten('dashboard', 'GET', rol), false, rol);
    assert.equal(rolIsToegelaten('dashboard-instellingen', 'PUT', rol), false, rol);
  }
  assert.equal(rolIsToegelaten('dashboard-instellingen', 'PUT', 'beheerder'), true);
  assert.equal(rolIsToegelaten('dashboard-instellingen', 'GET', 'beheerder'), true);
});

test('zonder sessie: 401', async () => {
  const { h, hi } = opzet();
  const res = await metGeenSessie(() => h(get(GOED)));
  assert.equal(res.status, 401);
  const res2 = await metGeenSessie(() => hi(new Request('http://localhost/api/dashboard-instellingen', { headers: { 'x-blitz': '1' } })));
  assert.equal(res2.status, 401);
});

test('planner, technieker en sales: 403 zonder cijfers in de body', async () => {
  const { h, hi } = opzet({ rapportlijst: lijst([entry('a', '2026-10-02')]) });
  for (const rol of ['planner', 'technieker', 'sales']) {
    const { status, body } = await lees(h, GOED, rol);
    assert.equal(status, 403, rol);
    assert.equal(body.kern, undefined, rol);
    assert.equal(body.dekking, undefined, rol);
    const res = await metRol(rol, () => hi(new Request('http://localhost/api/dashboard-instellingen', { headers: { 'x-blitz': '1' } })));
    assert.equal(res.status, 403, `instellingen ${rol}`);
  }
});

// ---------------- dashboard ----------------
test('beheerder: 200 met kern, tijd, kwaliteit, onderdelen, klant, sales en dekking.fouten', async () => {
  const { h } = opzet({ rapportlijst: lijst([entry('a', '2026-10-02'), entry('b', '2026-10-03')]) });
  const { status, body } = await lees(h, GOED);
  assert.equal(status, 200);
  for (const blok of ['kern', 'tijd', 'kwaliteit', 'onderdelen', 'klant', 'sales', 'dekking', 'filters', 'opties']) assert.ok(body[blok], blok);
  assert.equal(body.kern.huidig.interventies.n, 2);
  assert.deepEqual(body.dekking.fouten, []);
  assert.deepEqual(body.bronnen, { actief: 2, archief: 0, archiefJaren: ['2026'], activiteitAfgekapt: false });
  assert.equal(body.gegenereerd, new Date(NU).toISOString());
});

test('filters en herhaal komen aan in het antwoord', async () => {
  const { h } = opzet({ rapportlijst: lijst([entry('a', '2026-10-02'), entry('b', '2026-10-03', { technieker: 'Jan' })]) });
  const { body } = await lees(h, `${GOED}&technieker=Tim&herhaal=45`);
  assert.equal(body.kern.huidig.interventies.n, 1);
  assert.equal(body.filters.technieker, 'Tim');
  assert.equal(body.filters.herhaalDagen, 45);
  assert.equal((await lees(h, `${GOED}&herhaal=abc`)).body.filters.herhaalDagen, 30);
});

test('zonder van en tot: de laatste 30 dagen tot vandaag', async () => {
  const { h } = opzet();
  const { status, body } = await lees(h, '');
  assert.equal(status, 200);
  assert.deepEqual(body.periode, { van: '2026-09-09', tot: '2026-10-08' });
});

test('ongeldige invoer geeft 400: maand 13, van na tot, 801 dagen, niet-datum', async () => {
  const { h } = opzet();
  for (const zoek of ['?van=2026-13-01&tot=2026-10-08', '?van=2026-10-09&tot=2026-10-08', '?van=2024-01-01&tot=2026-10-08',
    '?van=morgen&tot=2026-10-08', '?van=2026-10-01&tot=2026-02-30']) {
    const { status, body } = await lees(h, zoek);
    assert.equal(status, 400, zoek);
    assert.equal(body.kern, undefined, zoek);
  }
  assert.equal((await lees(h, '?van=2024-07-30&tot=2026-10-07')).status, 200); // precies 800 dagen
});

test('OPTIONS: 204', async () => {
  const { h } = opzet();
  const res = await metRol('beheerder', () => h(new Request('http://localhost/api/dashboard', { method: 'OPTIONS' })));
  assert.equal(res.status, 204);
});

test('een falende nevenbron (log) geeft 200 met dekking.fouten, de rest werkt', async () => {
  const { h } = opzet({ rapportlijst: lijst([entry('a', '2026-10-02')]) }, { echtOmhul: s => kapot(s, /^activiteit\//) });
  const { status, body } = await lees(h, GOED);
  assert.equal(status, 200);
  assert.deepEqual(body.dekking.fouten, ['activiteit']);
  assert.equal(body.kern.huidig.interventies.n, 1);
  assert.equal(body.klant.annulaties.beschikbaar, false);
});

test('een falende hoofdbron (rapportlijst) geeft 503 opslag-storing', async () => {
  const { h } = opzet({}, { echtOmhul: s => kapot(s, /^rapportlijst$/) });
  const { status, body } = await lees(h, GOED);
  assert.equal(status, 503);
  assert.equal(body.code, 'opslag-storing');
  assert.equal(body.kern, undefined);
});

// ---------------- annulaties uit het log ----------------
test('annulaties: de opruim-variant ("..., opgeruimd") telt niet mee; vanaf = oudste logregel', async () => {
  const { h } = opzet({
    'activiteit/2026-09': { versie: 1, items: [annulatie('2026-09-01T08:00:00.000Z')] },
    'activiteit/2026-10': { versie: 2, items: [
      annulatie('2026-10-02T09:00:00.000Z'),
      annulatie('2026-10-03T09:00:00.000Z', 'Klant belde af, opgeruimd'),
      { ...annulatie('2026-10-04T09:00:00.000Z'), actie: 'login' },
    ] },
  });
  const { body } = await lees(h, GOED);
  assert.equal(body.klant.annulaties.aantal, 1);
  assert.equal(body.klant.annulaties.vanaf, '2026-09-01');
  assert.equal(body.bronnen.activiteitAfgekapt, false);
});

test('annulaties: meer dan 1000 in het venster geeft bronnen.activiteitAfgekapt = true', async () => {
  const items = Array.from({ length: 1001 }, (_, i) => annulatie(new Date(Date.parse('2026-10-01T00:00:00Z') + i * 60000).toISOString()));
  const { h } = opzet({ 'activiteit/2026-10': { versie: 1, items } });
  const { status, body } = await lees(h, GOED);
  assert.equal(status, 200);
  assert.equal(body.bronnen.activiteitAfgekapt, true);
  assert.equal(body.klant.annulaties.aantal, 1000);
});

test('testmodus: log blijft leeg (ook al staat er een log in de echte opslag) en de teststore wordt gebruikt', async () => {
  const { h, test } = opzet({
    'activiteit/2026-10': { versie: 1, items: [annulatie('2026-10-02T09:00:00.000Z')] },
    rapportlijst: lijst([entry('a', '2026-10-02')]),
    'sales/test-sales': { versie: 1, leads: [{ id: 'l1', bezoeken: [{ datum: '2026-10-03', resultaat: 'offerte', op: '2026-10-03T08:00:00.000Z' }] }] },
  });
  const { status, body } = await lees(h, GOED, 'beheerder', { 'x-blitz-test': '1' });
  assert.equal(status, 200);
  assert.equal(body.klant.annulaties.aantal, 0);
  assert.equal(body.klant.annulaties.vanaf, null);
  assert.equal(body.kern.huidig.interventies.n, 1);          // uit de teststore (eenmalige kopie)
  assert.deepEqual(body.sales.perWeek.verkopers, ['Test Verkoper']);
  assert.ok(test._data.has('rapportlijst'));
});

// ---------------- sales ----------------
test('sales: verkoper = salesNaam of naam, gedeactiveerd telt mee, ontbrekende blob = leeg, geen leadgegevens in het antwoord', async () => {
  const bezoek = { datum: '2026-10-03', resultaat: 'verkocht', op: '2026-10-03T08:00:00.000Z' };
  const { h } = opzet({
    gebruikers: { versie: 1, gebruikers: [
      { id: 'u-s1', naam: 'Sara Peeters', rol: 'sales', salesNaam: 'Sara', actief: true },
      { id: 'u-s2', naam: 'Piet Janssens', rol: 'sales', actief: false },
      { id: 'u-s3', naam: 'Zonder Blob', rol: 'sales', actief: true },
      { id: 'u-p', naam: 'Planner', rol: 'planner', actief: true },
    ] },
    'sales/u-s1': { versie: 1, leads: [{ id: 'l1', bedrijf: 'Geheim BV', bezoeken: [bezoek] }] },
    'sales/u-s2': { versie: 1, leads: [{ id: 'l2', bedrijf: 'Ook Geheim', bezoeken: [bezoek, bezoek] }] },
    'sales/u-p': { versie: 1, leads: [{ id: 'l3', bezoeken: [bezoek] }] },
  });
  const { body } = await lees(h, GOED);
  assert.deepEqual([...body.sales.perWeek.verkopers].sort(), ['Piet Janssens', 'Sara']);
  assert.equal(body.sales.resultaten.totaal, 3); // 1 van Sara + 2 van de gedeactiveerde Piet; de planner telt niet
  assert.equal(body.sales.dekking.verkopers, 3);
  assert.ok(!/Geheim/.test(JSON.stringify(body)));
});

// ---------------- rapportlijst + archief ([RF6]) ----------------
const archiefEntry = (id, datum, extra = {}) => entry(id, datum, { rapportData: { type: 'CHARX', start: '09:00', stop: '10:00' }, ...extra });

test('archief wordt overgeslagen als de actieve lijst de hele periode dekt', async () => {
  let gelezen = false;
  const basis = maakNepStore({
    rapportlijst: lijst([entry('a', '2026-01-05'), entry('b', '2026-10-02')]),
    'rapportlijst-archief-2026': lijst([archiefEntry('z', '2026-02-02')]),
  });
  const store = { ...basis, get: async (k, o) => { if (k.startsWith('rapportlijst-archief-')) gelezen = true; return basis.get(k, o); } };
  const r = await leesRapportenVoorDashboard(store, { vanDatum: '2026-01-10', totDatum: '2026-10-08' });
  assert.equal(gelezen, false);
  assert.deepEqual(r.bronnen, { actief: 2, archief: 0, archiefJaren: [] });
});

test('archief: ontdubbeld op id en ticket+datum (actieve lijst wint), gesorteerd, jaar onbekend nooit gelezen', async () => {
  const gelezen = [];
  const basis = maakNepStore({
    rapportlijst: lijst([entry('a', '2026-03-01'), entry('k', '2026-03-02', { ticketId: 'TK' })]),
    'rapportlijst-archief-2025': lijst([archiefEntry('o2', '2025-11-02'), archiefEntry('o1', '2025-11-02'), archiefEntry('a', '2025-12-01')]),
    'rapportlijst-archief-2026': lijst([archiefEntry('n', '2026-01-04'), archiefEntry('dubbel', '2026-03-02', { ticketId: 'TK' }), archiefEntry('n', '2026-01-04')]),
    'rapportlijst-archief-onbekend': lijst([archiefEntry('x', '2026-02-02')]),
  });
  const store = { ...basis, get: async (k, o) => { gelezen.push(k); return basis.get(k, o); } };
  const r = await leesRapportenVoorDashboard(store, { vanDatum: '2025-11-01', totDatum: '2026-10-08' });
  assert.deepEqual(r.rapporten.map(e => e.id), ['o1', 'o2', 'n', 'a', 'k']);
  assert.deepEqual(r.bronnen, { actief: 2, archief: 3, archiefJaren: ['2025', '2026'] });
  assert.ok(!gelezen.includes('rapportlijst-archief-onbekend'));
  assert.deepEqual(r.fouten, []);
});

test('een rapport in lijst en archief telt één keer (via het volledige antwoord)', async () => {
  const { h } = opzet({
    rapportlijst: lijst([entry('a', '2026-10-02')]),
    'rapportlijst-archief-2026': lijst([entry('a', '2026-10-02'), entry('b', '2026-04-02')]),
  });
  const { body } = await lees(h, '?van=2026-01-01&tot=2026-10-08');
  assert.equal(body.kern.huidig.interventies.n, 2);
  assert.equal(body.bronnen.archief, 1);
});

test('een archiefjaar dat gooit geeft 200 met dekking.fouten en de overige rapporten', async () => {
  const { h } = opzet({
    rapportlijst: lijst([entry('a', '2026-10-02')]),
    'rapportlijst-archief-2025': lijst([entry('o', '2025-12-02')]),
    'rapportlijst-archief-2026': lijst([entry('b', '2026-04-02')]),
  }, { echtOmhul: s => kapot(s, /^rapportlijst-archief-2025$/) });
  const { status, body } = await lees(h, '?van=2025-11-01&tot=2026-10-08');
  assert.equal(status, 200);
  assert.deepEqual(body.dekking.fouten, ['archief-2025']);
  assert.equal(body.kern.huidig.interventies.n, 2);
});

test('[RF6] 500 lichte entries plus twee jaar-archieven van 3000: snel en een antwoord < 200 kB', async () => {
  const typen = 12;
  const maak = (i, jaar) => entry(`${jaar}-${i}`, new Date(Date.UTC(jaar, 0, 1) + (i % 360) * 86400000).toISOString().slice(0, 10), {
    technieker: ['Tim', 'Jan', 'Bea', 'Els', 'Ruben', 'Lotte'][i % 6], ticketId: `T${jaar}-${i}`,
    rapportData: { type: `Type ${i % typen}`, start: '09:00', stop: '10:15', oorzaakStoring: [`Oorzaak ${i % 25}`], serienummer: `SN-${i % 700}`, onderdelen: [] },
  });
  const actief = Array.from({ length: 500 }, (_, i) => maak(i, 2026));
  const arch = jaar => lijst(Array.from({ length: 3000 }, (_, i) => maak(i, jaar)));
  const { h } = opzet({ rapportlijst: lijst(actief), 'rapportlijst-archief-2024': arch(2024), 'rapportlijst-archief-2025': arch(2025) });
  const start = Date.now();
  const res = await metRol('beheerder', () => h(get('?van=2025-01-01&tot=2026-10-07')));
  const tekst = await res.text();
  assert.equal(res.status, 200);
  assert.ok(Date.now() - start < 2000, `${Date.now() - start} ms`);
  assert.ok(tekst.length < 200000, `${tekst.length} bytes`);
  const body = JSON.parse(tekst);
  assert.equal(body.bronnen.archief, 6000);
  assert.deepEqual(body.bronnen.archiefJaren, ['2022', '2023', '2024', '2025', '2026']); // vorigeVan - 90 dagen
});

// ---------------- instellingen ----------------
const URL_I = 'http://localhost/api/dashboard-instellingen';
const geefI = (hi, init = {}, rol = 'beheerder') => metRol(rol, () => hi(new Request(URL_I, init)));
const put = (body, headers = { 'x-blitz': '1' }) => ({ method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const grenzen = () => ({ ...structuredClone(STANDAARD_GRENZEN), opTijd: { groen: 95, oranje: 80, richting: 'hoog' } });

test('instellingen: GET zonder blob geeft de standaardgrenzen op versie 0; OPTIONS 204', async () => {
  const { hi } = opzet();
  const res = await geefI(hi, { headers: { 'x-blitz': '1' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { versie: 0, grenzen: STANDAARD_GRENZEN });
  assert.equal((await geefI(hi, { method: 'OPTIONS' })).status, 204);
});

test('instellingen: PUT bewaart, verhoogt de versie en GET geeft het terug', async () => {
  const { hi, echt } = opzet();
  const res = await geefI(hi, put({ grenzen: grenzen(), versie: 0 }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { versie: 1 });
  assert.equal(JSON.parse(echt._data.get('dashboard-instellingen')).grenzen.opTijd.groen, 95);
  const terug = await (await geefI(hi, { headers: { 'x-blitz': '1' } })).json();
  assert.equal(terug.versie, 1);
  assert.equal(terug.grenzen.opTijd.groen, 95);
});

test('instellingen: PUT zonder X-Blitz is 403 csrf (wrapper, echte sessiecontrole), niets bewaard; met X-Blitz 200', async () => {
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers: [{ id: 'u-bea', email: 'bea@blitz.test', naam: 'Bea', rol: 'beheerder', actief: true, sessieVersie: 4 }] } });
  const getStore = () => echt;
  const geheim = 'testgeheim-testgeheim';
  const auth = maakAuth({ getStore, env: { SESSIE_GEHEIM: geheim }, nu: () => NU });
  const hi = maakInstellingenHandler({ getStore, auth });
  const cookie = `blitz_sessie=${ondertekenToken({ uid: 'u-bea', sv: 4, exp: Math.floor(NU / 1000) + 3600 }, geheim)}`;
  const nieuw = extra => new Request(URL_I, { ...put({ grenzen: grenzen(), versie: 0 }, { cookie, ...extra }) });
  const r = await hi(nieuw({}));
  assert.equal(r.status, 403);
  assert.equal((await r.json()).code, 'csrf');
  assert.equal(echt._schrijfacties.length, 0);
  assert.equal((await hi(nieuw({ 'x-blitz': '1' }))).status, 200);
});

test('instellingen: planner mag niet bewaren (403)', async () => {
  const { hi, echt } = opzet();
  const res = await geefI(hi, put({ grenzen: grenzen(), versie: 0 }), 'planner');
  assert.equal(res.status, 403);
  assert.equal(echt._schrijfacties.length, 0);
});

test('instellingen: ongeldige grenzen of versie geven 400', async () => {
  const { hi, echt } = opzet();
  const slecht = grenzen();
  slecht.opTijd = { groen: 50, oranje: 80, richting: 'hoog' }; // hoog is goed: groen < oranje
  assert.equal((await geefI(hi, put({ grenzen: slecht, versie: 0 }))).status, 400);
  assert.equal((await geefI(hi, put({ grenzen: 'x', versie: 0 }))).status, 400);
  assert.equal((await geefI(hi, put({ grenzen: grenzen(), versie: 'nul' }))).status, 400);
  assert.equal((await geefI(hi, { method: 'PUT', headers: { 'x-blitz': '1' }, body: 'geen json' })).status, 400);
  assert.equal(echt._schrijfacties.length, 0);
});

test('instellingen: oude versie geeft 409 met de serverstand in data (voor bewaarMetVersie)', async () => {
  const { hi } = opzet({ 'dashboard-instellingen': { versie: 3, grenzen: grenzen() } });
  const res = await geefI(hi, put({ grenzen: STANDAARD_GRENZEN, versie: 2 }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.serverVersie, 3);
  assert.equal(body.data.versie, 3);
  assert.equal(body.data.grenzen.opTijd.groen, 95);
  assert.ok(body.error);
});

test('instellingen: falende opslag geeft 503 opslag-storing', async () => {
  const { hi } = opzet({}, { echtOmhul: s => kapot(s, /^dashboard-instellingen$/) });
  const res = await geefI(hi, { headers: { 'x-blitz': '1' } });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, 'opslag-storing');
});
