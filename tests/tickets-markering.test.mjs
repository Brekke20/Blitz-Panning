// Stale-markering van de ticket-momentopname door elke functie die een ticket in Zoho wijzigt, en de integratie van
// /api/tickets en tickets-vooraf met de momentopname. Nep-fetch en nep-store: nooit Zoho of Blobs.
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { maakNepFetch, metGlobaleFetch, laadVers, v1Event, zetEnv } from './nep-fetch.mjs';
import { metRol, metGeenSessie } from './auth-hulp.mjs';
import { maakNepStore } from './nep-blobs.mjs';
import { zetMetingVoorTests } from '../netlify/lib/meting.js';
import {
  SNAPSHOT_SLEUTEL, VEROUDERD_SLEUTEL, BEZIG_SLEUTEL, metTicketsVerouderd, zetStoreVoorTests,
} from '../netlify/lib/tickets-snapshot.js';

const NU = Date.parse('2026-10-28T10:00:00.000Z'); // woensdag 11:00 Brussel
const DESK = 'https://desk.zoho.eu/api/v1';
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const marker = store => (store._data.has(VEROUDERD_SLEUTEL) ? JSON.parse(store._data.get(VEROUDERD_SLEUTEL)).op : null);

let herstelEnv; let store;
test.beforeEach(() => {
  herstelEnv = zetEnv({ ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC' });
  mock.timers.enable({ apis: ['Date'], now: NU });
  store = maakNepStore();
  zetStoreVoorTests(store);
});
test.afterEach(() => {
  zetStoreVoorTests(null);
  zetMetingVoorTests(null);
  mock.timers.reset();
  mock.restoreAll();
  herstelEnv();
});

// ---------- de wrapper zelf ----------
test('metTicketsVerouderd: markeert na een wijzigende aanroep, ook als de kern gooit (de fout blijft dezelfde)', async () => {
  const ok = metTicketsVerouderd(async () => 'klaar');
  assert.equal(await ok({ httpMethod: 'POST', headers: {} }), 'klaar');
  assert.equal(marker(store), NU);
  store._data.delete(VEROUDERD_SLEUTEL);
  const stuk = metTicketsVerouderd(async () => { throw new Error('halverwege stuk'); });
  await assert.rejects(stuk({ httpMethod: 'PATCH', headers: {} }), /halverwege stuk/);
  assert.equal(marker(store), NU);
});

test('metTicketsVerouderd: Request (v2) en event (v1) worden allebei herkend; lezen en OPTIONS markeren niet', async () => {
  const w = metTicketsVerouderd(async () => 'x');
  await w(new Request('http://l/api/plan-datum', { method: 'POST', body: '{}' }));
  assert.equal(marker(store), NU);
  store._data.delete(VEROUDERD_SLEUTEL);
  for (const m of ['GET', 'HEAD', 'OPTIONS']) {
    await w({ httpMethod: m, headers: {} });
    await w(new Request('http://l/x', { method: m }));
  }
  assert.equal(marker(store), null);
});

test('metTicketsVerouderd: een testverzoek (X-Blitz-Test: 1) schrijft nooit naar Zoho en markeert dus niet', async () => {
  const w = metTicketsVerouderd(async () => 'x');
  await w({ httpMethod: 'POST', headers: { 'X-Blitz-Test': '1' } });
  await w(new Request('http://l/x', { method: 'POST', body: '{}', headers: { 'X-Blitz-Test': '1' } }));
  assert.equal(marker(store), null);
});

test('metTicketsVerouderd: een kapotte opslag verandert het antwoord of de fout van de functie niet', async () => {
  zetStoreVoorTests({ get: async () => { throw new Error('blobs'); }, setJSON: async () => { throw new Error('blobs'); } });
  const w = metTicketsVerouderd(async () => 'gewoon antwoord');
  assert.equal(await w({ httpMethod: 'POST', headers: {} }), 'gewoon antwoord');
});

// ---------- de functies zelf (achter de echte wrapper en rechtentabel) ----------
async function draaiPlan(werk, body = { ticketId: '123', date: '2026-06-23' }, headers = {}) {
  const { fn } = maakNepFetch(url => (url.endsWith('/tickets/123') ? json({ id: '123' }) : undefined));
  const mod = await laadVers('plan');
  return metGlobaleFetch(fn, () => werk(() => mod.handler(v1Event('POST', body, headers))));
}

test('plan: een geslaagde planning markeert de momentopname', async () => {
  const res = await draaiPlan(w => metRol('planner', w));
  assert.equal(res.statusCode, 200);
  assert.equal(marker(store), NU);
});

test('plan: een weigering (niet ingelogd, verkeerde rol) bereikt de kern niet en markeert dus niets', async () => {
  assert.equal((await draaiPlan(w => metGeenSessie(w))).statusCode, 401);
  assert.equal((await draaiPlan(w => metRol('sales', w))).statusCode, 403);
  assert.equal(marker(store), null);
});

test('plan: een testverzoek markeert niets', async () => {
  const res = await draaiPlan(w => metRol('planner', w), { ticketId: '123', date: '2026-06-23' }, { 'X-Blitz-Test': '1' });
  assert.equal(res.statusCode, 200);
  assert.equal(marker(store), null);
});

test('plan-datum en comment markeren ook (elk achter hun eigen wrapper)', async () => {
  const { fn } = maakNepFetch(url => (url.endsWith('/tickets/123') ? json({ id: '123' }) : undefined));
  const comment = await laadVers('comment');
  const r1 = await metGlobaleFetch(fn, () => metRol('planner', () => comment.handler(v1Event('POST', { ticketId: '123', content: 'tekst' }))));
  assert.equal(r1.statusCode, 200);
  assert.equal(marker(store), NU);
  store._data.delete(VEROUDERD_SLEUTEL);
  const datum = await laadVers('plan-datum');
  const req = new Request('http://localhost/api/plan-datum', { method: 'POST', body: JSON.stringify({ ticketId: '123', utcInterventieDatum: '2026-06-22T22:00:00.000Z' }) });
  const r2 = await metGlobaleFetch(fn, () => metRol('planner', () => datum.default(req, {})));
  assert.equal(r2.status, 200);
  assert.equal(marker(store), NU);
});

// Elke functie die een ticket in Zoho wijzigt moet de momentopname verouderen. Een nieuwe schrijvende Zoho-functie zonder
// markering zou stilletjes een oud scherm tonen: deze lijst dwingt het af (voeg een nieuwe functie toe aan MARKEREN of motiveer).
const MARKEREN = ['plan', 'plan-datum', 'propose', 'annuleer', 'comment', 'send-rapport'];
const lees = pad => readFileSync(new URL(pad, import.meta.url), 'utf8');

test('elke functie die een ticket in Zoho wijzigt gebruikt de stale-markering, binnen de beveiliging', () => {
  for (const naam of MARKEREN) {
    const bron = lees(`../netlify/functions/${naam}.js`);
    assert.match(bron, /metTicketsVerouderd\(/, `${naam}: metTicketsVerouderd ontbreekt`);
    // BINNEN de wrapper: een geweigerde aanroep mag nooit markeren
    assert.match(bron, /beveilig(V1|V2)\([^\n]*metTicketsVerouderd\(/, `${naam}: markering staat niet binnen beveiligV1/V2`);
  }
  const confirm = lees('../netlify/functions/confirm-afspraak.js');
  assert.match(confirm, /markeerVerouderd\(/);
  // De markering komt na de geslaagde PATCH (een ongeldige link mag ze niet afdwingen)
  assert.ok(confirm.indexOf("status: 'Geplande support'") < confirm.indexOf('markeerVerouderd('));
});

test('geen enkele functie schrijft naar Zoho Desk zonder markering (nieuwe schrijvers vallen hier op)', () => {
  // Alles wat via zoho.verzoek met een methode (PATCH/POST/PUT/DELETE) naar Zoho Desk schrijft. De uploads in rapport-zoho.js
  // (bijlage-PDF via de achtergrondverwerking) veranderen het ticket niet in de lijst en staan buiten deze lijst: bewust.
  const gevonden = readdirSync(new URL('../netlify/functions/', import.meta.url))
    .filter(f => f.endsWith('.js'))
    .filter(f => /zoho\.verzoek\([\s\S]{0,200}?methode:\s*'(POST|PATCH|PUT|DELETE)'/.test(lees(`../netlify/functions/${f}`)))
    .map(f => f.replace(/\.js$/, ''))
    .sort();
  assert.deepEqual(gevonden, [...MARKEREN, 'confirm-afspraak'].sort());
});

// ---------- /api/tickets met een momentopname ----------
const LIJSTEN = {
  tickets: [{ id: '1', number: '101', status: 'Service in te plannen' }],
  pendingTickets: [], plannedTickets: [{ id: '3', number: '103', status: 'Geplande service' }],
};
const zetSnapshot = (op, lijsten = LIJSTEN) => store._data.set(SNAPSHOT_SLEUTEL, JSON.stringify({ v: 1, op, klaar: op + 1, ...lijsten }));

async function tickets(werk, { haalLive, wacht } = {}) {
  const mod = await laadVers('tickets');
  const h = mod.maakHandler({ haalStore: async () => store, haalLive, wacht });
  return werk(() => h(v1Event('GET')));
}

test('tickets: een verse momentopname gaat naar de client zonder één Zoho-aanroep; de body is exact de drie lijsten', async () => {
  zetSnapshot(NU - 60000);
  let live = 0;
  const res = await tickets(w => metRol('planner', w), { haalLive: async () => { live++; return {}; } });
  assert.equal(live, 0);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), LIJSTEN);
  assert.equal(res.headers['X-Blitz-Bron'], 'snapshot');
  assert.equal(res.headers['X-Blitz-Leeftijd'], '60');
  assert.equal(res.headers['X-Blitz-Verouderd'], undefined);
});

test('tickets: dezelfde momentopname geeft beheerder, planner en technieker exact dezelfde body (geen rol-afhankelijke vorm)', async () => {
  zetSnapshot(NU - 1000);
  const bodies = [];
  for (const rol of ['beheerder', 'planner', 'technieker']) {
    const res = await tickets(w => metRol(rol, w, { zohoNaam: 'Tim' }), { haalLive: async () => { throw new Error('niet nodig'); } });
    assert.equal(res.statusCode, 200, rol);
    bodies.push(res.body);
  }
  assert.equal(new Set(bodies).size, 1);
});

test('tickets: de rechten van de wrapper gelden ook voor de momentopname (niet ingelogd 401, sales 403: nooit ticketgegevens)', async () => {
  zetSnapshot(NU - 1000);
  const haalLive = async () => { throw new Error('niet nodig'); };
  const anoniem = await tickets(w => metGeenSessie(w), { haalLive });
  assert.equal(anoniem.statusCode, 401);
  const sales = await tickets(w => metRol('sales', w), { haalLive });
  assert.equal(sales.statusCode, 403);
  for (const r of [anoniem, sales]) assert.ok(!r.body.includes('101') && !r.body.includes('Service in te plannen'), r.body);
});

test('tickets: een onverse momentopname geeft een live lading en herschrijft de momentopname; de body is dan dezelfde vorm', async () => {
  zetSnapshot(NU - 10 * 60000);
  const NIEUW = { tickets: [], pendingTickets: [{ id: '8' }], plannedTickets: [] };
  const res = await tickets(w => metRol('planner', w), { haalLive: async () => structuredClone(NIEUW) });
  assert.deepEqual(JSON.parse(res.body), NIEUW);
  assert.equal(res.headers['X-Blitz-Bron'], undefined); // live: geen extra kop
  assert.deepEqual(JSON.parse(store._data.get(SNAPSHOT_SLEUTEL)).pendingTickets, [{ id: '8' }]);
  assert.equal(store._data.has(BEZIG_SLEUTEL), false);
});

test('tickets: Zoho faalt maar er is een (oude) momentopname -> 200 met X-Blitz-Verouderd; zonder momentopname blijft het een 500 met de fouttekst', async () => {
  zetSnapshot(NU - 30 * 60000);
  const log = mock.method(console, 'error', () => {});
  const res = await tickets(w => metRol('planner', w), { haalLive: async () => { throw new Error('Zoho tickets-ophalen mislukt (500): {}'); } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), LIJSTEN);
  assert.equal(res.headers['X-Blitz-Verouderd'], '1');
  assert.ok(log.mock.calls.some(c => String(c.arguments[0]).includes('oude momentopname')));

  store._data.delete(SNAPSHOT_SLEUTEL);
  const stuk = await tickets(w => metRol('planner', w), { haalLive: async () => { throw new Error('Zoho tickets-ophalen mislukt (500): {}'); } });
  assert.equal(stuk.statusCode, 500);
  assert.deepEqual(JSON.parse(stuk.body), { error: 'Zoho tickets-ophalen mislukt (500): {}' });
});

test('tickets: na een planning (marker) haalt de eerstvolgende aanvraag live op, ook al is de momentopname jong', async () => {
  zetSnapshot(NU - 1000);
  store._data.set(VEROUDERD_SLEUTEL, JSON.stringify({ op: NU - 500 }));
  let live = 0;
  const res = await tickets(w => metRol('planner', w), { haalLive: async () => { live++; return structuredClone(LIJSTEN); } });
  assert.equal(live, 1);
  assert.equal(res.statusCode, 200);
});

test('tickets: [meting] krijgt bron en leeftijd (snapshot en live), zonder ticketgegevens, en de Server-Timing-kop behoudt zijn vorm', async () => {
  zetMetingVoorTests(true);
  const regels = [];
  const oud = console.log;
  console.log = (...a) => regels.push(a.join(' '));
  let r1; let r2;
  try {
    zetSnapshot(NU - 90000);
    r1 = await tickets(w => metRol('planner', w), { haalLive: async () => structuredClone(LIJSTEN) });
    store._data.delete(SNAPSHOT_SLEUTEL);
    r2 = await tickets(w => metRol('planner', w), { haalLive: async () => structuredClone(LIJSTEN) });
  } finally { console.log = oud; }
  const logs = regels.filter(l => l.startsWith('[meting] ')).map(l => JSON.parse(l.slice(9)));
  assert.equal(logs.length, 2);
  assert.deepEqual([logs[0].bron, logs[0].snapshotMs], ['snapshot', 90000]);
  assert.deepEqual([logs[1].bron, logs[1].snapshotMs], ['live', 0]);
  assert.ok(!regels.join('\n').includes('101'));
  assert.match(r1.headers['Server-Timing'], /^auth;dur=\d+, kern;dur=\d+, koud;dur=\d+, totaal;dur=\d+$/);
  assert.ok(r2.headers['Server-Timing']);
});

// ---------- tickets-vooraf (de geplande functie) ----------
test('tickets-vooraf: ververst via de gedeelde ticketlading, antwoordt enkel met aantallen, schema elke 2 minuten', async () => {
  const mod = await laadVers('tickets-vooraf');
  assert.equal(mod.config.schedule, '*/2 * * * *');
  const log = mock.method(console, 'log', () => {});
  const h = mod.maakHandler({ haalStore: async () => store, haalLive: async () => structuredClone(LIJSTEN) });
  const res = await h();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { resultaat: 'ververst', tickets: 1, wachtend: 0, gepland: 1 });
  assert.equal(JSON.parse(store._data.get(SNAPSHOT_SLEUTEL)).op, NU);
  assert.ok(log.mock.calls.every(c => !String(c.arguments[0]).includes('101')));
  // direct erna: vers, dus geen tweede lading
  const tweede = await mod.maakHandler({ haalStore: async () => store, haalLive: async () => { throw new Error('mag niet'); } })();
  assert.deepEqual(await tweede.json(), { resultaat: 'overgeslagen', reden: 'vers' });
});

test('tickets-vooraf: een Zoho-fout geeft 500 zonder foutdetails en laat de oude momentopname staan', async () => {
  zetSnapshot(NU - 10 * 60000);
  mock.method(console, 'error', () => {});
  const mod = await laadVers('tickets-vooraf');
  const res = await mod.maakHandler({ haalStore: async () => store, haalLive: async () => { throw new Error('Zoho ticketdetail 5 mislukt (500): {"geheim":1}'); } })();
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { resultaat: 'mislukt' });
  assert.equal(JSON.parse(store._data.get(SNAPSHOT_SLEUTEL)).op, NU - 10 * 60000);
});

test('tickets-vooraf: de echte lading gebruikt dezelfde Zoho-aanroepen als /api/tickets en cachet het org-id', async () => {
  const { fn, calls } = maakNepFetch(url => {
    if (url.endsWith('/agents?limit=50')) return json({ data: [] });
    if (url.includes('/tickets?limit=100&from=0')) return json({ data: [{ id: '5', status: 'Geplande service' }] });
    if (url.endsWith('/tickets/5')) return json({ id: '5', ticketNumber: '105', status: 'Geplande service' });
    return undefined;
  });
  const mod = await laadVers('tickets-vooraf');
  const h = mod.maakHandler({ haalStore: async () => store });
  mock.method(console, 'log', () => {});
  await metGlobaleFetch(fn, () => h());
  assert.deepEqual(calls.map(c => c.url.replace(DESK, '')), [
    'https://accounts.zoho.eu/oauth/v2/token', '/organizations', '/agents?limit=50', '/tickets?limit=100&from=0', '/tickets/5',
  ]);
  mock.timers.setTime(NU + 3 * 60000);
  await metGlobaleFetch(fn, () => h());
  assert.equal(calls.filter(c => c.url.endsWith('/organizations')).length, 1);
  assert.equal(calls.filter(c => c.url.includes('oauth')).length, 1);
});
