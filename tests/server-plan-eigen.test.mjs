// tests/server-plan-eigen.test.mjs — "Mag zelf plannen": een technieker met het vinkje plant, plant uit, stuurt voorstellen en annuleert
// enkel voor zijn EIGEN tickets (Zoho beslist wie een ticket toegewezen is). Zonder het vinkje blijft alles geweigerd; beheerder en
// planner veranderen niet. Nooit echt Zoho of Blobs: nep-fetch en nep-stores.
process.env.TZ = 'Europe/Brussels';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { maakNepFetch, metGlobaleFetch, laadVers, v1Event, zetEnv } from './nep-fetch.mjs';
import { maakNepStore } from './nep-blobs.mjs';
import { metRol } from './auth-hulp.mjs';
import { maakAuth } from '../netlify/lib/auth.js';
import { TESTGEBRUIKERS } from '../netlify/lib/lokale-dev.js';
import { maakZoho } from '../netlify/lib/zoho.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const UTC = '2026-10-14T07:00:00.000Z';
const TIM = { zohoNaam: 'Tim Janssens', magZelfPlannen: true };
const AGENTEN = { A1: { id: 'A1', name: 'Tim Janssens' }, A2: { id: 'A2', name: 'Roel Peeters' } };
// 11 = van Tim, 12 = van Roel, 13 = niemand toegewezen
const TICKETS = {
  11: { assigneeId: 'A1', status: 'Wachten op bevestiging planning', cf: { cf_e_mail_eindklant: 'klant@x.be' }, contact: { email: 'c@x.be' } },
  12: { assigneeId: 'A2', status: 'Wachten op bevestiging planning', cf: { cf_e_mail_eindklant: 'klant@x.be' }, contact: { email: 'c@x.be' } },
  13: { status: 'Service in te plannen', cf: {} },
};

let herstelEnv;
test.beforeEach(() => {
  herstelEnv = zetEnv({ ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC', ZOHO_FROM_EMAIL: 'service@blitz.test', CONFIRM_LINK_SECRET: 'geheim-geheim-geheim', URL: 'https://app.test' });
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T10:00:00.000Z') });
  mock.method(console, 'error', () => {});
});
test.afterEach(() => { mock.timers.reset(); mock.restoreAll(); herstelEnv(); });

// Router: tickets, agenten en schrijfacties (PATCH/sendReply/uploads/comments); `stuk` laat de Zoho-leesacties falen.
function router({ stuk = false } = {}) {
  return (url, opts = {}) => {
    const m = opts.method || 'GET';
    const t = url.match(/\/tickets\/(\d+)$/);
    if (t && m === 'GET') return stuk ? json({}, 500) : (TICKETS[t[1]] ? json(TICKETS[t[1]]) : json({}, 404));
    if (t && m === 'PATCH') return json({});
    const a = url.match(/\/agents\/(\w+)$/);
    if (a) return stuk ? json({}, 500) : (AGENTEN[a[1]] ? json(AGENTEN[a[1]]) : json({}, 404));
    if (url.endsWith('/uploads')) return json({ id: 'ATT1' });
    if (url.endsWith('/sendReply')) return json({});
    if (url.endsWith('/comments')) return json({});
    return undefined;
  };
}
const schrijvend = calls => calls.filter(c => c.method !== 'GET' && !c.url.includes('oauth'));
const kopTest = { 'x-blitz-test': '1' };

// ---------------------------------------------------------------- plan (v1)
async function plan(rolWerk, body, { stuk, headers } = {}) {
  const { fn, calls } = maakNepFetch(router({ stuk }));
  const mod = await laadVers('plan');
  const res = await metGlobaleFetch(fn, () => rolWerk(() => mod.maakHandler({ getStore: () => maakNepStore() })(v1Event('POST', body, headers))));
  return { status: res.statusCode, body: JSON.parse(res.body), calls };
}
const PLAN = { ticketId: '11', date: '2026-10-14', utcInterventieDatum: UTC };
const metTim = (extra = {}) => werk => metRol('technieker', werk, { ...TIM, ...extra });

test('plan: technieker met het vinkje plant en haalt uit de planning zijn eigen ticket', async () => {
  const r = await plan(metTim(), PLAN);
  assert.equal(r.status, 200);
  const w = schrijvend(r.calls);
  assert.equal(w.length, 1);
  assert.equal(w[0].method, 'PATCH');
  assert.ok(w[0].url.endsWith('/tickets/11'));
  const uit = await plan(metTim(), { ticketId: '11', date: null });
  assert.equal(uit.status, 200);
  assert.equal(schrijvend(uit.calls).length, 1);
});

test('plan: het ticket van een collega of van niemand wordt geweigerd (403) zonder dat er iets naar Zoho gaat', async () => {
  for (const id of ['12', '13']) {
    const r = await plan(metTim(), { ...PLAN, ticketId: id });
    assert.equal(r.status, 403, id);
    assert.equal(r.body.code, 'geen-recht');
    assert.deepEqual(schrijvend(r.calls), [], id);
  }
});

test('plan: zonder vinkje (ontbreekt, false, niet-boolean) 403 van de wrapper en Zoho wordt niet aangeroepen', async () => {
  for (const extra of [{ magZelfPlannen: undefined }, { magZelfPlannen: false }, { magZelfPlannen: 'ja' }]) {
    const r = await plan(metTim(extra), PLAN);
    assert.equal(r.status, 403, JSON.stringify(extra));
    assert.deepEqual(r.calls, [], JSON.stringify(extra));
  }
});

test('plan: Zoho-storing bij het nakijken is 503 zoho-storing en er wordt niets geschreven', async () => {
  const r = await plan(metTim(), PLAN, { stuk: true });
  assert.equal(r.status, 503);
  assert.equal(r.body.code, 'zoho-storing');
  assert.deepEqual(schrijvend(r.calls), []);
});

test('plan: een testverzoek raakt Zoho nooit, ook niet voor het ticket van een collega (er wordt niets echts geschreven)', async () => {
  const r = await plan(metTim(), { ...PLAN, ticketId: '12' }, { headers: kopTest });
  assert.equal(r.status, 200);
  assert.equal(r.body.test, true);
  assert.deepEqual(r.calls, []);
});

test('plan: beheerder en planner plannen elk ticket, ook dat van een collega, zonder extra Zoho-leesactie', async () => {
  for (const rol of ['beheerder', 'planner']) {
    const r = await plan(werk => metRol(rol, werk), { ...PLAN, ticketId: '12' });
    assert.equal(r.status, 200, rol);
    assert.equal(r.calls.filter(c => c.url.includes('/agents/') || (c.method === 'GET' && c.url.includes('/tickets/'))).length, 0, rol);
    assert.equal(schrijvend(r.calls).length, 1, rol);
  }
});

test('plan: sales en een technieker zonder zohoNaam blijven geweigerd', async () => {
  assert.equal((await plan(werk => metRol('sales', werk, {}), PLAN)).status, 403);
  assert.equal((await plan(werk => metRol('technieker', werk, { magZelfPlannen: true, zohoNaam: '' }), PLAN)).status, 403);
});

// ---------------------------------------------------------------- plan-datum (v2)
async function planDatum(rolWerk, body, { stuk, headers = {} } = {}) {
  const { fn, calls } = maakNepFetch(router({ stuk }));
  const mod = await laadVers('plan-datum');
  const req = new Request('http://localhost/api/plan-datum', { method: 'POST', headers, body: JSON.stringify(body) });
  const res = await metGlobaleFetch(fn, () => rolWerk(() => mod.maakHandler({ getStore: () => maakNepStore() })(req, {})));
  return { status: res.status, body: await res.json(), calls };
}
const DATUM = { ticketId: '11', utcInterventieDatum: UTC };

test('plan-datum: eigen ticket ja, collega-ticket nee (403, geen PATCH), zonder vinkje nee, testverzoek nooit Zoho', async () => {
  const eigen = await planDatum(metTim(), DATUM);
  assert.equal(eigen.status, 200);
  assert.equal(schrijvend(eigen.calls).length, 1);
  const collega = await planDatum(metTim(), { ...DATUM, ticketId: '12' });
  assert.equal(collega.status, 403);
  assert.equal(collega.body.code, 'geen-recht');
  assert.deepEqual(schrijvend(collega.calls), []);
  const zonder = await planDatum(metTim({ magZelfPlannen: false }), DATUM);
  assert.equal(zonder.status, 403);
  assert.deepEqual(zonder.calls, []);
  const test = await planDatum(metTim(), { ...DATUM, ticketId: '12' }, { headers: kopTest });
  assert.equal(test.status, 200);
  assert.deepEqual(test.calls, []);
  const planner = await planDatum(werk => metRol('planner', werk), { ...DATUM, ticketId: '12' });
  assert.equal(planner.status, 200);
});

// ---------------------------------------------------------------- propose (v1)
async function propose(rolWerk, ticketId, { stuk, headers } = {}) {
  const { fn, calls } = maakNepFetch(router({ stuk }));
  const mod = await laadVers('propose');
  const body = { ticketId, date: '2026-10-14', time: '09:00', recipientName: 'Jan', subject: 'Laadpaal', utcInterventieDatum: UTC };
  const res = await metGlobaleFetch(fn, () => rolWerk(() => mod.maakHandler({ getStore: () => maakNepStore() })(v1Event('POST', body, headers))));
  return { status: res.statusCode, body: JSON.parse(res.body), calls };
}
const mails = calls => calls.filter(c => c.url.endsWith('/sendReply'));

test('propose: eigen ticket krijgt zijn voorstelmail, het ticket van een collega niet (403, geen mail, geen PATCH)', async () => {
  const eigen = await propose(metTim(), '11');
  assert.equal(eigen.status, 200);
  assert.ok(mails(eigen.calls).length >= 1);
  assert.equal(schrijvend(eigen.calls).filter(c => c.method === 'PATCH').length, 1);
  const collega = await propose(metTim(), '12');
  assert.equal(collega.status, 403);
  assert.equal(collega.body.code, 'geen-recht');
  assert.deepEqual(schrijvend(collega.calls), []); // geen upload, geen mail, geen PATCH
  const niemand = await propose(metTim(), '13');
  assert.equal(niemand.status, 403);
  assert.deepEqual(schrijvend(niemand.calls), []);
});

test('propose: zonder vinkje 403 zonder Zoho; testverzoek raakt Zoho nooit; planner stuurt gewoon voor elk ticket', async () => {
  const zonder = await propose(metTim({ magZelfPlannen: false }), '11');
  assert.equal(zonder.status, 403);
  assert.deepEqual(zonder.calls, []);
  const test = await propose(metTim(), '12', { headers: kopTest });
  assert.equal(test.status, 200);
  assert.deepEqual(test.calls, []);
  const planner = await propose(werk => metRol('planner', werk), '12');
  assert.equal(planner.status, 200);
  assert.ok(mails(planner.calls).length >= 1);
});

// ---------------------------------------------------------------- annuleer
test('annuleer: eigen afspraak ja (mail en PATCH), collega nee (403, niets verzonden of gewijzigd), zonder vinkje nee', async () => {
  const { maakHandler } = await laadVers('annuleer');
  async function draai(gebruiker, ticketId, headers = {}) {
    const { fn, calls } = maakNepFetch(router());
    const handler = maakHandler({ getStore: () => maakNepStore(), fetch: fn });
    const req = new Request('http://localhost/api/annuleer', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ticketId, reden: 'weer', toelichting: '', mailKlant: false, door: 'Tim' }),
    });
    const res = await handler(req, {}, gebruiker);
    return { status: res.status, body: await res.json(), calls };
  }
  const tim = { id: 'u-tim', rol: 'technieker', ...TIM };
  const eigen = await draai(tim, '11');
  assert.equal(eigen.status, 200);
  assert.ok(schrijvend(eigen.calls).some(c => c.method === 'PATCH'));
  const collega = await draai(tim, '12');
  assert.equal(collega.status, 403);
  assert.equal(collega.body.code, 'geen-recht');
  assert.deepEqual(schrijvend(collega.calls), []);
  const zonder = await draai({ ...tim, magZelfPlannen: false }, '11');
  assert.equal(zonder.status, 403);
  assert.deepEqual(schrijvend(zonder.calls), []);
  const planner = await draai({ id: 'u-p', rol: 'planner' }, '12');
  assert.equal(planner.status, 200);
  assert.equal((await draai(tim, '12', kopTest)).status, 200); // testverzoek: nep-antwoord, nooit Zoho
});

// ---------------------------------------------------------------- voorstel-status en klantbeschikbaarheid
const authVoor = (rol, extra = {}) => maakAuth({ vasteGebruiker: { ...TESTGEBRUIKERS[`test-${rol}`], ...extra }, env: {} });
const nepZoho = (opties) => { const { fn, calls } = maakNepFetch(router(opties)); return { zoho: maakZoho({ fetch: fn, env: { ZOHO_REFRESH_TOKEN: 'RT', ZOHO_CLIENT_ID: 'CID', ZOHO_CLIENT_SECRET: 'SEC' } }), calls }; };

test('voorstel-status: de technieker met het vinkje registreert en wist enkel voor eigen tickets; lezen blijft voor elke technieker', async () => {
  const { maakHandler } = await laadVers('voorstel-status');
  const store = maakNepStore();
  const { zoho, calls } = nepZoho();
  const handler = (rol, extra) => maakHandler({ getStore: () => store, zoho, auth: authVoor(rol, extra) });
  const post = (ticketId, headers = {}) => new Request('http://localhost/api/voorstel-status', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ ticketId, doelgroep: 'klant', tijdstip: UTC }),
  });
  const del = (ticketId) => new Request(`http://localhost/api/voorstel-status?ticketId=${ticketId}`, { method: 'DELETE' });
  const tim = handler('technieker', TIM);
  assert.equal((await tim(post('11'), {})).status, 200);
  assert.equal((await tim(post('12'), {})).status, 403);
  assert.equal((await tim(post('abc'), {})).status, 400); // geen numeriek id: niet te toetsen
  assert.equal((await tim(del('12'), {})).status, 403);
  assert.equal((await tim(del('11'), {})).status, 200);
  const register = await (await handler('planner')(new Request('http://localhost/api/voorstel-status'), {})).json();
  assert.deepEqual(Object.keys(register.status ?? {}), []); // het voorstel van 11 is gewist en dat van 12 kwam er nooit in
  // zonder vinkje: wrapper 403, lezen mag
  assert.equal((await handler('technieker', { ...TIM, magZelfPlannen: false })(post('11'), {})).status, 403);
  assert.equal((await handler('technieker', { ...TIM, magZelfPlannen: false })(new Request('http://localhost/api/voorstel-status'), {})).status, 200);
  // testverzoek: geen Zoho
  const voor = calls.length;
  assert.equal((await tim(post('t1', kopTest), {})).status, 200);
  assert.equal(calls.length, voor);
  // planner: elk ticket, geen Zoho-leesactie
  const nPlanner = calls.length;
  assert.equal((await handler('planner')(post('12'), {})).status, 200);
  assert.equal(calls.length, nPlanner);
});

test('klantbeschikbaarheid: de technieker met het vinkje wijzigt enkel de gegevens van zijn eigen tickets', async () => {
  const { maakHandler } = await laadVers('klantbeschikbaarheid');
  const store = maakNepStore({ klantbeschikbaarheid: { versie: 4, items: { 12: { voorkeur: '2026-10-20', voorkeurTijd: null, geblokkeerd: [], notitie: 'collega', bijgewerkt: '2026-10-01T08:00:00.000Z' } } } });
  const { zoho } = nepZoho();
  const handler = (rol, extra) => maakHandler({ getStore: () => store, zoho, auth: authVoor(rol, extra) });
  const put = (versie, items, headers = {}) => new Request('http://localhost/api/klantbeschikbaarheid', {
    method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ versie, items }),
  });
  const collegaItem = { voorkeur: '2026-10-20', notitie: 'collega', bijgewerkt: '2026-10-01T08:00:00.000Z' };
  const tim = handler('technieker', TIM);
  // een nieuw eigen item, het item van de collega ongewijzigd meegestuurd (ook met een ander tijdstip): toegelaten
  const eigen = await tim(put(4, { 11: { voorkeur: '2026-10-21', notitie: 'mijn klant' }, 12: { ...collegaItem, bijgewerkt: 'ander' } }), {});
  assert.equal(eigen.status, 200);
  const opgeslagen = await store.get('klantbeschikbaarheid', { type: 'json' });
  assert.equal(opgeslagen.versie, 5);
  assert.equal(opgeslagen.items[11].notitie, 'mijn klant');
  assert.equal(opgeslagen.items[12].notitie, 'collega');
  // het item van de collega wijzigen of laten verdwijnen: 403 en niets bewaard
  const wijzig = await tim(put(5, { 11: { voorkeur: '2026-10-21', notitie: 'mijn klant' }, 12: { ...collegaItem, notitie: 'GEKAAPT' } }), {});
  assert.equal(wijzig.status, 403);
  const wis = await tim(put(5, { 11: { voorkeur: '2026-10-21', notitie: 'mijn klant' } }), {});
  assert.equal(wis.status, 403);
  const nieuweCollega = await tim(put(5, { 11: { voorkeur: '2026-10-21', notitie: 'mijn klant' }, 12: collegaItem, 13: { notitie: 'x' } }), {});
  assert.equal(nieuweCollega.status, 403); // 13 heeft niemand toegewezen
  const nu = await store.get('klantbeschikbaarheid', { type: 'json' });
  assert.equal(nu.versie, 5);
  assert.equal(nu.items[12].notitie, 'collega');
  // zonder vinkje: wrapper 403; lezen mag
  assert.equal((await handler('technieker', { ...TIM, magZelfPlannen: false })(put(5, {}), {})).status, 403);
  assert.equal((await handler('technieker', { ...TIM, magZelfPlannen: false })(new Request('http://localhost/api/klantbeschikbaarheid'), {})).status, 200);
  // planner: alles
  assert.equal((await handler('planner')(put(5, { 12: { ...collegaItem, notitie: 'door planner' } }), {})).status, 200);
});
