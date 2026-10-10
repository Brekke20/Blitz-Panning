// tests/server-upload-beveiliging.test.mjs — de uploadfuncties achter de rechtentabel (logins T17b)
// rapport-ontvangen (sessie + eigen rapporten), rapport-verwerk-background (interne sleutel, geen sessie),
// rapport-vangnet (geplande functie), en de eigen-regels op ?inhoud en { opnieuw } van rapport-archief.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { metRol, metGeenSessie } from './auth-hulp.mjs';
import { metGlobaleFetch } from './nep-fetch.mjs';
import { RECHTEN, rolIsToegelaten } from '../netlify/lib/rechten.js';
import { isEigenRapport } from '../netlify/lib/eigen.js';
import { maakInternToken, controleerInternToken, INTERN_KOP } from '../netlify/lib/intern-token.js';
import { startAchtergrondtaak } from '../netlify/lib/rapport-achtergrond.js';
import { maakHandler as maakOntvangen } from '../netlify/functions/rapport-ontvangen.js';
import { maakHandler as maakArchief } from '../netlify/functions/rapport-archief.js';
import achtergrond from '../netlify/functions/rapport-verwerk-background.js';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const tim = werk => metRol('technieker', werk, { zohoNaam: 'Tim' });

const post = (body, headers = { 'x-blitz': '1' }) => new Request('http://localhost/api/rapport-ontvangen', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const ontvangstBody = (id, technieker, extra = {}) => ({
  id, ticketId: '555', filename: 't.pdf', isLocal: false, html: '<p>x</p>',
  archiveBody: { datum: '2026-10-08', technieker, ticketId: '555', ticketNumber: '1006', klant: 'K', rapportData: { probleem: 'p' } },
  ...extra,
});
const lijst = store => JSON.parse(store._data.get('rapportlijst') ?? '{"rapports":[]}').rapports;
const opzet = (begin = {}) => {
  const store = maakNepStore(begin);
  const aanroepen = [];
  const h = maakOntvangen({ getStore: () => store, fetch: async (url, opts) => { aanroepen.push({ url, opts }); return new Response(null, { status: 202 }); } });
  return { store, h, aanroepen };
};
const entry = (id, technieker, extra = {}) => ({ id, datum: '2026-10-08', technieker, ticketId: 'T' + id, klant: 'K', rapportData: {}, ...extra });

// ---------------- rechtentabel ----------------
test('rechten: rapport-ontvangen = POST voor B/P/T, nooit sales; de achtergrond- en vangnetfunctie zijn open (eigen controle)', () => {
  for (const rol of ['beheerder', 'planner', 'technieker']) assert.equal(rolIsToegelaten('rapport-ontvangen', 'POST', rol), true, rol);
  assert.equal(rolIsToegelaten('rapport-ontvangen', 'POST', 'sales'), false);
  assert.equal(rolIsToegelaten('rapport-ontvangen', 'GET', 'beheerder'), false);
  assert.deepEqual(RECHTEN['rapport-verwerk-background'], { '*': 'open' });
  assert.deepEqual(RECHTEN['rapport-vangnet'], { '*': 'open' });
});

// ---------------- rapport-ontvangen ----------------
test('rapport-ontvangen: zonder sessie 401, niets bewaard en geen achtergrondtaak', async () => {
  const { store, h, aanroepen } = opzet();
  const r = await metGeenSessie(() => h(post(ontvangstBody(ID_A, 'Tim'))));
  assert.equal(r.status, 401);
  assert.equal(store._schrijfacties.length, 0);
  assert.equal(aanroepen.length, 0);
});

test('rapport-ontvangen: sales 403; planner, beheerder en technieker (eigen naam) 200', async () => {
  const { h } = opzet();
  assert.equal((await metRol('sales', () => h(post(ontvangstBody(ID_A, 'Tim'))))).status, 403);
  assert.equal((await metRol('planner', () => h(post(ontvangstBody(ID_A, 'Tim'))))).status, 200);
  assert.equal((await metRol('beheerder', () => h(post(ontvangstBody(ID_B, 'Roel'))))).status, 200);
  const t = opzet();
  assert.equal((await tim(() => t.h(post(ontvangstBody(ID_A, 'tim'))))).status, 200); // naam hoofdletterongevoelig
});

const activiteit = store => [...store._data.keys()].filter(k => k.startsWith('activiteit/')).flatMap(k => JSON.parse(store._data.get(k)).items);

test('rapport-ontvangen: overname (Tim verstuurt een rapport op naam van Roel) wordt aanvaard, met ingediendDoor, en gelogd met andereNaam', async () => {
  const { store, h, aanroepen } = opzet();
  const r = await tim(() => h(post(ontvangstBody(ID_A, 'Roel'))));
  assert.equal(r.status, 200);
  const e = lijst(store)[0];
  assert.equal(e.technieker, 'Roel');
  assert.equal(e.ingediendDoor, 'test-technieker');
  assert.equal(e.ingediendDoorNaam, 'Test Technieker');
  assert.equal(aanroepen.length, 1, 'het rapport gaat gewoon naar Zoho');
  const log = activiteit(store);
  assert.equal(log.length, 1);
  assert.equal(log[0].actie, 'rapport-verstuurd');
  assert.equal(log[0].gebruikerId, 'test-technieker');
  assert.equal(log[0].onderwerp, '555');
  assert.deepEqual(JSON.parse(log[0].details), { andereNaam: true, naamInRapport: 'Roel' });
  // een herhaalde POST (zelfde id) logt niet nog eens
  assert.equal((await tim(() => h(post(ontvangstBody(ID_A, 'Roel'))))).status, 200);
  assert.equal(activiteit(store).length, 1);
});

test('rapport-ontvangen: meerdere techniekers, typfout of lege naam worden aanvaard (Tim ziet het rapport als eigen via ingediendDoor)', async () => {
  for (const [i, naam] of ['Tim en Jan', 'Tm', ''].entries()) {
    const id = '3333333' + i + '-3333-4333-8333-333333333333';
    const { store, h } = opzet();
    const r = await tim(() => h(post(ontvangstBody(id, naam, { ticketId: '77' + i }))));
    assert.equal(r.status, 200, 'naam: "' + naam + '"');
    const e = lijst(store)[0];
    assert.equal(isEigenRapport({ rol: 'technieker', id: 'test-technieker', zohoNaam: 'Tim' }, e), true);
    // via de archieflijst ziet Tim het ook
    const a = maakArchief({ getStore: () => store });
    const lijstRes = await tim(() => a(req('GET')));
    assert.equal((await lijstRes.json()).rapports.length, 1);
  }
});

test('rapport-ontvangen: een eigen naam logt niets extra (geen andereNaam)', async () => {
  const { store, h } = opzet();
  assert.equal((await tim(() => h(post(ontvangstBody(ID_A, 'Tim'))))).status, 200);
  assert.equal(activiteit(store).length, 0);
});

test('eigen rapport: ingediendDoor OF naam; oude entries zonder ingediendDoor enkel de naamregel; collega en sales nooit', () => {
  const tim = { rol: 'technieker', id: 'u-tim', zohoNaam: 'Tim' };
  assert.equal(isEigenRapport(tim, { technieker: 'Roel', ingediendDoor: 'u-tim' }), true);
  assert.equal(isEigenRapport(tim, { technieker: 'tim' }), true);              // legacy: naam, ook andere hoofdletters
  assert.equal(isEigenRapport(tim, { technieker: 'Roel' }), false);            // legacy van een collega
  assert.equal(isEigenRapport(tim, { technieker: 'Roel', ingediendDoor: 'u-roel' }), false);
  assert.equal(isEigenRapport({ rol: 'technieker', id: 'u-roel', zohoNaam: 'Roel' }, { technieker: 'Roel', ingediendDoor: 'u-tim' }), true); // de genoemde collega ziet het ook
  assert.equal(isEigenRapport({ rol: 'technieker', id: '', zohoNaam: 'Tim' }, { technieker: 'Roel', ingediendDoor: '' }), false);
  assert.equal(isEigenRapport({ rol: 'planner', id: 'p' }, { technieker: 'x' }), true);
  assert.equal(isEigenRapport({ rol: 'sales', id: 's' }, { technieker: 'x', ingediendDoor: 's' }), false);
});

test('rapport-ontvangen: technieker overschrijft de inhoud of het rapport van een collega met hetzelfde id nooit', async () => {
  const roel = entry(ID_A, 'Roel', { verwerking: { status: 'wacht' } });
  const { store, h, aanroepen } = opzet({
    rapportlijst: { versie: 3, rapports: [roel] },
    ['rapport-inhoud/' + ID_A]: { html: '<p>van Roel</p>', ticketId: 'T' + ID_A },
  });
  const r = await tim(() => h(post(ontvangstBody(ID_A, 'Tim'))));
  assert.equal(r.status, 403);
  assert.equal(JSON.parse(store._data.get('rapport-inhoud/' + ID_A)).html, '<p>van Roel</p>');
  assert.deepEqual(lijst(store).map(x => x.technieker), ['Roel']);
  assert.equal(store._schrijfacties.filter(s => !s.key.startsWith('activiteit/')).length, 0, 'enkel het activiteitenlog is geschreven');
  assert.equal(aanroepen.length, 0);
  assert.deepEqual(activiteit(store).map(a => a.actie), ['rapport-geweigerd'], 'de coordinator ziet de weigering');
});

test('M4: dezelfde geweigerde id door dezelfde gebruiker logt maar één keer rapport-geweigerd (outbox-herhaling); een ander id wel', async () => {
  const roel = entry(ID_A, 'Roel', { verwerking: { status: 'wacht' } });
  const roel2 = entry(ID_B, 'Roel', { ticketId: '556', verwerking: { status: 'wacht' } });
  const { store, h } = opzet({ rapportlijst: { versie: 3, rapports: [roel, roel2] } });
  for (let i = 0; i < 4; i++) assert.equal((await tim(() => h(post(ontvangstBody(ID_A, 'Tim'))))).status, 403);
  assert.equal(activiteit(store).filter(a => a.actie === 'rapport-geweigerd').length, 1, 'vier pogingen, één regel');
  assert.equal((await tim(() => h(post(ontvangstBody(ID_B, 'Tim'))))).status, 403);
  assert.equal(activiteit(store).filter(a => a.actie === 'rapport-geweigerd').length, 2, 'ander id: nieuwe regel');
});

test('rapport-ontvangen: technieker dedupt enkel op zijn eigen entry (zelfde ticket+datum als een collega komt erbij)', async () => {
  const roel = entry(ID_B, 'Roel', { ticketId: '555', verwerking: { status: 'wacht' } });
  const { store, h } = opzet({ rapportlijst: { versie: 3, rapports: [roel] } });
  const r = await tim(() => h(post(ontvangstBody(ID_A, 'Tim'))));
  assert.equal(r.status, 200);
  assert.deepEqual(lijst(store).map(x => [x.id, x.technieker]).sort(), [[ID_A, 'Tim'], [ID_B, 'Roel']]);
  assert.ok(store._data.has('rapport-inhoud/' + ID_A));
});

test('rapport-ontvangen: de planner dedupt wel op het rapport van een collega (ongewijzigd gedrag)', async () => {
  const roel = entry(ID_B, 'Roel', { ticketId: '555', verwerking: { status: 'wacht' } });
  const { store, h } = opzet({ rapportlijst: { versie: 3, rapports: [roel] } });
  const r = await metRol('planner', () => h(post(ontvangstBody(ID_A, 'Tim'))));
  assert.equal(r.status, 200);
  assert.deepEqual(lijst(store).map(x => x.id), [ID_A]);
});

// ---------------- rapport-verwerk-background ----------------
test('interne sleutel: gebonden aan het id, hangt af van SESSIE_GEHEIM, zonder geheim nooit geldig', () => {
  const env = { SESSIE_GEHEIM: 'geheim-1' };
  const token = maakInternToken(ID_A, env);
  assert.match(token, /^[0-9a-f]{64}$/);
  const req = t => new Request('http://x/.netlify/functions/rapport-verwerk-background', { method: 'POST', headers: t ? { [INTERN_KOP]: t } : {} });
  assert.equal(controleerInternToken(req(token), ID_A, env), true);
  assert.equal(controleerInternToken(req(token), ID_B, env), false, 'sleutel voor een ander id');
  assert.equal(controleerInternToken(req(), ID_A, env), false, 'geen sleutel');
  assert.equal(controleerInternToken(req('x'.repeat(64)), ID_A, env), false, 'verkeerde sleutel');
  assert.equal(controleerInternToken(req(token), ID_A, { SESSIE_GEHEIM: 'ander' }), false, 'ander geheim');
  assert.equal(maakInternToken(ID_A, {}), null);
  assert.equal(maakInternToken(ID_A, { SESSIE_GEHEIM: '' }), null);
  assert.equal(controleerInternToken(req(token), ID_A, {}), false, 'zonder geheim nooit geldig');
});

test('startAchtergrondtaak: draagt de interne sleutel voor dit id; zonder geheim geen sleutel', async () => {
  const calls = [];
  const fetch = async (url, opts) => { calls.push(opts); return new Response(null, { status: 202 }); };
  await startAchtergrondtaak({ origin: 'http://x', id: ID_A, fetch, env: { SESSIE_GEHEIM: 'g' } });
  assert.equal(new Headers(calls[0].headers).get(INTERN_KOP.toLowerCase()), maakInternToken(ID_A, { SESSIE_GEHEIM: 'g' }));
  const stil = console.error; console.error = () => {};
  try { await startAchtergrondtaak({ origin: 'http://x', id: ID_A, fetch, env: {} }); } finally { console.error = stil; }
  assert.equal(new Headers(calls[1].headers).get(INTERN_KOP.toLowerCase()), null);
});

test('rapport-verwerk-background: een anonieme aanroep zonder (geldige) sleutel doet niets (202, geen opslag)', async () => {
  const stil = console.error; console.error = () => {};
  const voor = process.env.SESSIE_GEHEIM;
  process.env.SESSIE_GEHEIM = 'test-geheim';
  try {
    for (const headers of [{}, { [INTERN_KOP]: 'x'.repeat(64) }, { [INTERN_KOP]: maakInternToken(ID_B, { SESSIE_GEHEIM: 'test-geheim' }) }]) {
      const res = await achtergrond(new Request('http://localhost/.netlify/functions/rapport-verwerk-background', {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ id: ID_A }),
      }));
      assert.equal(res.status, 202);
    }
  } finally {
    console.error = stil;
    if (voor === undefined) delete process.env.SESSIE_GEHEIM; else process.env.SESSIE_GEHEIM = voor;
  }
});

// ---------------- rapport-archief: ?inhoud en { opnieuw } ----------------
const archief = (begin) => {
  const store = maakNepStore(begin);
  return { store, h: maakArchief({ getStore: () => store }) };
};
const req = (methode, body, zoek = '') => new Request('http://localhost/api/rapport-archief' + zoek, {
  method: methode, headers: { 'content-type': 'application/json', 'x-blitz': '1' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const mislukt = { status: 'mislukt', pogingen: 6, volgendePoging: null, laatsteFout: 'x', bijgewerkt: '2026-10-08T10:00:00.000Z' };
const begin = () => ({
  rapportlijst: { versie: 1, rapports: [entry(ID_A, 'Tim', { verwerking: mislukt }), entry(ID_B, 'Roel', { verwerking: mislukt })] },
  ['rapport-inhoud/' + ID_A]: { html: '<p>Tim</p>', ticketId: 'x' },
  ['rapport-inhoud/' + ID_B]: { html: '<p>Roel</p>', ticketId: 'y' },
});

test('rapport-archief GET ?inhoud: technieker leest enkel de inhoud van zijn eigen rapport; planner alle', async () => {
  const { h } = archief(begin());
  const eigen = await tim(() => h(req('GET', undefined, '?inhoud=' + ID_A)));
  assert.equal(eigen.status, 200);
  assert.equal((await eigen.json()).html, '<p>Tim</p>');
  const collega = await tim(() => h(req('GET', undefined, '?inhoud=' + ID_B)));
  assert.equal(collega.status, 404);
  const pl = await metRol('planner', () => h(req('GET', undefined, '?inhoud=' + ID_B)));
  assert.equal(pl.status, 200);
});

test('rapport-archief POST { opnieuw }: technieker enkel op zijn eigen rapport (collega: 403, niets gewijzigd, geen taak)', async () => {
  const { store, h } = archief(begin());
  const r = await tim(() => h(req('POST', { opnieuw: ID_B })));
  assert.equal(r.status, 403);
  assert.equal(lijst(store).find(x => x.id === ID_B).verwerking.status, 'mislukt');
  assert.equal(store._schrijfacties.length, 0);
});

// ---------------- Task 11b: beheerder verstuurt een mislukt rapport opnieuw, met een regel in het activiteitenlog ----------------
const activiteitLog = store => [...store._data].filter(([k]) => k.startsWith('activiteit/')).flatMap(([, w]) => JSON.parse(w).items);

test('rapport-archief POST { opnieuw }: de beheerder mag het (200), de achtergrondtaak start eenmalig en het log krijgt rapport-opnieuw', async () => {
  const { store, h } = archief(begin());
  const stuurde = [];
  const nep = async (url, opts) => { stuurde.push({ url: String(url), id: JSON.parse(opts.body).id }); return new Response(null, { status: 202 }); };
  const r = await metGlobaleFetch(nep, () => metRol('beheerder', () => h(req('POST', { opnieuw: ID_B }))));
  assert.equal(r.status, 200);
  assert.equal(lijst(store).find(x => x.id === ID_B).verwerking.status, 'wacht');
  assert.deepEqual(stuurde.map(s => s.id), [ID_B]);
  const log = activiteitLog(store);
  assert.deepEqual(log.map(i => i.actie), ['rapport-opnieuw']);
  assert.match(log[0].details, new RegExp(ID_B));

  // Dubbele aanvraag: rapport staat al op 'wacht': ongewijzigd, geen tweede taak en geen tweede logregel.
  const r2 = await metGlobaleFetch(nep, () => metRol('beheerder', () => h(req('POST', { opnieuw: ID_B }))));
  assert.deepEqual([r2.status, (await r2.json()).ongewijzigd], [200, true]);
  assert.equal(stuurde.length, 1);
  assert.equal(activiteitLog(store).length, 1);
});

test('rapport-archief POST { opnieuw }: een testverzoek logt niets; een geweigerde (collega) aanvraag logt niets', async () => {
  const { store, h } = archief(begin());
  const nep = async () => new Response(null, { status: 202 });
  const testReq = new Request('http://localhost/api/rapport-archief', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-blitz': '1', 'x-blitz-test': '1' }, body: JSON.stringify({ opnieuw: ID_A }),
  });
  await metGlobaleFetch(nep, () => metRol('beheerder', () => h(testReq)));
  assert.equal(activiteitLog(store).length, 0);
  assert.equal((await tim(() => h(req('POST', { opnieuw: ID_B })))).status, 403);
  assert.equal(activiteitLog(store).length, 0);
});
