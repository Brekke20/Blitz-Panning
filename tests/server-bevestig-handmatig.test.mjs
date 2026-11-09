// tests/server-bevestig-handmatig.test.mjs — /api/bevestig-handmatig: de planner registreert dat de klant PER MAIL bevestigd heeft
// (Zoho-status 'Geplande support', register `bevestigd: { door: 'mail' }`, interne notitie). Elke test controleert de VOLLEDIGE lijst
// uitgaande aanroepen. Nooit echt Zoho of Blobs: nep-fetch en nep-stores.
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, zetEnv } from './nep-fetch.mjs';
import { maakNepStore } from './nep-blobs.mjs';
import { handmatigeBevestigingsNotitie } from '../netlify/lib/bevestigingslink.js';

const NU = Date.parse('2026-10-01T10:00:00.000Z');
const TIJDSTIP_NU = '01/10/2026 12:00'; // Brusselse tijd
const DESK = 'https://desk.zoho.eu/api/v1';
const TOKEN_CALL = {
  method: 'POST', url: 'https://accounts.zoho.eu/oauth/v2/token',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'refresh_token=RT&client_id=CID&client_secret=SEC&grant_type=refresh_token',
};
const ORG_CALL = { method: 'GET', url: `${DESK}/organizations`, headers: { Authorization: 'Zoho-oauthtoken TOK' }, body: undefined };
const JSON_HEADERS = { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1', 'Content-Type': 'application/json' };
const getTicket = id => ({ method: 'GET', url: `${DESK}/tickets/${id}`, headers: { Authorization: 'Zoho-oauthtoken TOK', orgId: 'ORG1' }, body: undefined });
const patch = (id, body) => ({ method: 'PATCH', url: `${DESK}/tickets/${id}`, headers: JSON_HEADERS, body: JSON.stringify(body) });
const comment = (id, content) => ({ method: 'POST', url: `${DESK}/tickets/${id}/comments`, headers: JSON_HEADERS, body: JSON.stringify({ content, isPublic: false }) });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const uit = calls => calls.map(c => ({ method: c.method, url: c.url, headers: c.headers, body: c.body }));

const PLANNER = { id: 'u-planner', rol: 'planner', naam: 'Petra <Planner>' };
const TICKET = (over = {}) => ({ status: 'Wachten op bevestiging planning', cf: { cf_interventie_datm: '2026-10-14T06:30:00.000Z' }, contact: { email: 'c@x.be' }, ...over });

let herstelEnv; let fouten;
test.beforeEach(() => {
  herstelEnv = zetEnv({ ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC', NETLIFY_BLOBS_CONTEXT: undefined });
  mock.timers.enable({ apis: ['Date'], now: NU });
  fouten = mock.method(console, 'error', () => {});
});
test.afterEach(() => { mock.timers.reset(); mock.restoreAll(); herstelEnv(); });

const MAAND_LOG = 'activiteit/2026-10';
const post = (body, headers = {}) => new Request('http://localhost/api/bevestig-handmatig', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const router = ({ ticket = TICKET(), ticketRes, patchRes, commentRes } = {}) => (url, opts = {}) => {
  const m = opts.method || 'GET';
  if (url.endsWith('/tickets/555') && m === 'GET') return ticketRes ? ticketRes() : json(ticket);
  if (url.endsWith('/tickets/555') && m === 'PATCH') return patchRes ? patchRes() : json({});
  if (url.endsWith('/comments')) return commentRes ? commentRes() : json({});
  return undefined;
};
async function draai(req, { gebruiker = PLANNER, opties = {}, store = maakNepStore(), testStore = maakNepStore(), getStore } = {}) {
  const { fn, calls } = maakNepFetch(router(opties));
  const mod = await laadVers('bevestig-handmatig');
  const haalStore = getStore || (({ name }) => (name === 'blitz-data' ? store : testStore));
  const res = await metGlobaleFetch(async () => { throw new Error('globale fetch verboden'); }, () => mod.maakHandler({ getStore: haalStore, fetch: fn })(req, {}, gebruiker));
  const tekst = await res.text();
  let antwoord;
  try { antwoord = tekst ? JSON.parse(tekst) : undefined; } catch { antwoord = tekst; } // een 405 is gewone tekst
  return { status: res.status, body: antwoord, calls: uit(calls), store, testStore };
}
const register = (store, id = '555') => JSON.parse(store._data.get('voorstel-status') || '{"status":{}}').status[id];

test('bevestig-handmatig: de notitie zegt wie het registreerde, geëscaped', () => {
  assert.equal(handmatigeBevestigingsNotitie({ naam: 'Petra <Planner>', tijdstip: '01/10/2026 12:00' }),
    'Bevestigd per mail, geregistreerd door Petra &lt;Planner&gt; via Blitz Planning op 01/10/2026 12:00.');
  assert.equal(handmatigeBevestigingsNotitie({ naam: '', tijdstip: 'T' }), 'Bevestigd per mail, geregistreerd door onbekend via Blitz Planning op T.');
});

test('bevestig-handmatig: status Wachten op bevestiging planning wordt Geplande support; notitie, register (door mail, wie) en activiteitenlog', async () => {
  const r = await draai(post({ ticketId: '555' }));
  assert.deepEqual(r.calls, [
    TOKEN_CALL, ORG_CALL, getTicket('555'),
    patch('555', { status: 'Geplande support' }),
    comment('555', handmatigeBevestigingsNotitie({ naam: PLANNER.naam, tijdstip: TIJDSTIP_NU })),
  ]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, status: 'Geplande support' });
  assert.deepEqual(register(r.store), { bevestigd: { door: 'mail', tijdstip: new Date(NU).toISOString(), wie: PLANNER.naam } });
  const log = JSON.parse(r.store._data.get(MAAND_LOG)).items;
  assert.deepEqual(log.map(i => [i.actie, i.onderwerp, i.naam]), [['bevestigd-per-mail', '555', PLANNER.naam]]);
  assert.equal(fouten.mock.calls.length, 0);
});

test('bevestig-handmatig: de naam komt uit de sessie, nooit uit het verzoek', async () => {
  const r = await draai(post({ ticketId: '555', door: 'Een Ander', naam: 'Een Ander' }));
  assert.equal(register(r.store).bevestigd.wie, PLANNER.naam);
  assert.ok(!JSON.stringify(r.calls).includes('Een Ander'));
});

test('bevestig-handmatig: een bestaand voorstel in het register blijft staan naast bevestigd', async () => {
  const store = maakNepStore({ 'voorstel-status': { versie: 4, status: { 555: { klant: 'T1', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14' }, 777: { klant: 'Y' } } } });
  const r = await draai(post({ ticketId: '555' }), { store });
  assert.equal(r.status, 200);
  assert.deepEqual(register(store), { klant: 'T1', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14', bevestigd: { door: 'mail', tijdstip: new Date(NU).toISOString(), wie: PLANNER.naam } });
  assert.deepEqual(register(store, '777'), { klant: 'Y' });
});

test('bevestig-handmatig: een ticket dat niet meer op Wachten op bevestiging planning staat geeft 409 zonder PATCH, notitie of registerwijziging', async () => {
  for (const status of ['Geplande support', 'Wachten op planning', 'Gesloten - ov', undefined]) {
    const r = await draai(post({ ticketId: '555' }), { opties: { ticket: TICKET({ status }) } });
    assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555')], String(status));
    assert.equal(r.status, 409);
    assert.match(r.body.error, /Wachten op bevestiging planning/);
    assert.equal(r.body.ok, undefined);
    assert.equal(register(r.store), undefined);
  }
});

test('bevestig-handmatig: een ticket op wachten zonder afspraakdatum geeft 409 (niets te bevestigen), zonder PATCH, notitie of registerwijziging', async () => {
  for (const cf of [{}, { cf_interventie_datm: '' }, { cf_interventie_datm: null }, { cf_interventie_datm: 'kapot' }]) {
    const r = await draai(post({ ticketId: '555' }), { opties: { ticket: TICKET({ cf }) } });
    assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555')], JSON.stringify(cf));
    assert.equal(r.status, 409);
    assert.match(r.body.error, /geen afspraakdatum/);
    assert.equal(register(r.store), undefined);
  }
  const zonderCf = await draai(post({ ticketId: '555' }), { opties: { ticket: { status: 'Wachten op bevestiging planning' } } });
  assert.equal(zonderCf.status, 409);
});

test('bevestig-handmatig: PATCH-fout geeft 502 zonder notitie of registerwijziging', async () => {
  const r = await draai(post({ ticketId: '555' }), { opties: { patchRes: () => new Response('boem', { status: 500 }) } });
  assert.deepEqual(r.calls, [TOKEN_CALL, ORG_CALL, getTicket('555'), patch('555', { status: 'Geplande support' })]);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Zoho PATCH fout \(500\)/);
  assert.equal(register(r.store), undefined);
});

test('bevestig-handmatig: ticket 404 en 500 bij het ophalen', async () => {
  const nietGevonden = await draai(post({ ticketId: '555' }), { opties: { ticketRes: () => json({}, 404) } });
  assert.equal(nietGevonden.status, 404);
  const stuk = await draai(post({ ticketId: '555' }), { opties: { ticketRes: () => json({}, 500) } });
  assert.equal(stuk.status, 502);
  assert.deepEqual(stuk.calls.filter(c => c.method === 'PATCH'), []);
});

test('bevestig-handmatig: een falende notitie of registerfout laat de bevestiging staan (200, waarschuwing bij het register)', async () => {
  const notitie = await draai(post({ ticketId: '555' }), { opties: { commentRes: () => new Response('nee', { status: 500 }) } });
  assert.equal(notitie.status, 200);
  assert.deepEqual(notitie.body, { ok: true, status: 'Geplande support' });
  const kapot = { ...maakNepStore(), async setJSON() { throw new Error('blob stuk'); } };
  const reg = await draai(post({ ticketId: '555' }), { getStore: () => kapot });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.ok, true);
  assert.equal(reg.body.status, 'Geplande support');
  assert.match(reg.body.waarschuwing, /register/i);
});

test('bevestig-handmatig: validatie (ongeldige JSON, geen of niet-numeriek ticketId) geeft 400 zonder aanroepen; andere methode 405', async () => {
  for (const body of ['{kapot', '[]', { }, { ticketId: 'abc' }, { ticketId: '12/../3' }, { ticketId: 555.5 }]) {
    const r = await draai(post(body));
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.calls, []);
  }
  const get = await draai(new Request('http://localhost/api/bevestig-handmatig', { method: 'GET' }));
  assert.equal(get.status, 405);
  assert.deepEqual(get.calls, []);
});

test('bevestig-handmatig: OPTIONS beantwoordt de CORS-voorcontrole zonder aanroepen', async () => {
  const r = await draai(new Request('http://localhost/api/bevestig-handmatig', { method: 'OPTIONS' }));
  assert.equal(r.status, 204);
  assert.deepEqual(r.calls, []);
});

test('bevestig-handmatig: testmodus doet nooit Zoho, schrijft enkel de teststore (ook met een korte test-id) en geeft het nep-antwoord', async () => {
  const testStore = maakNepStore({ _testkopie: '{}' });
  const r = await draai(post({ ticketId: 'p1' }, { 'X-Blitz-Test': '1' }), { testStore });
  assert.deepEqual(r.calls, []);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, test: true, status: 'Geplande support' });
  assert.equal(register(testStore, 'p1').bevestigd.door, 'mail');
  assert.equal(register(r.store, 'p1'), undefined);
  assert.equal(r.store._data.has(MAAND_LOG), false, 'een testverzoek logt niets');
  // Buiten testmodus is een niet-numeriek id verboden.
  const echt = await draai(post({ ticketId: 'p1' }));
  assert.equal(echt.status, 400);
});

// "Mag zelf plannen": een technieker bevestigt enkel zijn eigen tickets (de rechtentabel laat hem door, de functie toetst het ticket).
test('bevestig-handmatig: een technieker met "Mag zelf plannen" bevestigt enkel een eigen ticket; collega of zonder vinkje: 403 zonder wijziging', async () => {
  const TIM = { id: 'u-tim', rol: 'technieker', naam: 'Tim Janssens', zohoNaam: 'Tim Janssens', magZelfPlannen: true };
  const AGENTEN = { A1: { id: 'A1', name: 'Tim Janssens' }, A2: { id: 'A2', name: 'Roel Peeters' } };
  const metAgenten = (assigneeId) => ({
    ticket: TICKET({ assigneeId }),
  });
  async function alsTim(gebruiker, assigneeId) {
    const { fn, calls } = maakNepFetch((url, opts = {}) => {
      const a = url.match(/\/agents\/(\w+)$/);
      if (a) return AGENTEN[a[1]] ? json(AGENTEN[a[1]]) : json({}, 404);
      return router(metAgenten(assigneeId))(url, opts);
    });
    const mod = await laadVers('bevestig-handmatig');
    const store = maakNepStore();
    const res = await metGlobaleFetch(fn, () => mod.maakHandler({ getStore: () => store, fetch: fn })(post({ ticketId: '555' }), {}, gebruiker));
    return { status: res.status, calls: uit(calls), store };
  }
  const eigen = await alsTim(TIM, 'A1');
  assert.equal(eigen.status, 200);
  assert.ok(eigen.calls.some(c => c.method === 'PATCH'));
  const collega = await alsTim(TIM, 'A2');
  assert.equal(collega.status, 403);
  assert.deepEqual(collega.calls.filter(c => c.method !== 'GET' && !c.url.includes('oauth')), []);
  assert.equal(register(collega.store), undefined);
  const zonder = await alsTim({ ...TIM, magZelfPlannen: false }, 'A1');
  assert.equal(zonder.status, 403);
});
