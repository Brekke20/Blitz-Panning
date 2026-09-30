import test from 'node:test';
import assert from 'node:assert/strict';
import { TRAJECT, berekenSinds, volgendePaginaNodig, leesRegister, schrijfRegister } from '../netlify/lib/planningsinds.js';

const ev = (eventTime, van, naar) => ({
  eventName: 'TicketUpdated',
  eventTime,
  eventInfo: [{ propertyName: 'Status', propertyValue: { previousValue: van, updatedValue: naar, type: 'Text' }, propertyType: 'ValueTransition' }],
});

test('berekenSinds: patroon ticket 3638', () => {
  const events = [
    ev('2026-09-30T13:33:36.000Z', 'Wachten op planning', 'Wachten op bevestiging planning'),
    ev('2026-09-29T08:13:43.000Z', 'Wachten op klant', 'Wachten op planning'),
    ev('2026-09-29T08:13:31.000Z', 'Open', 'Wachten op klant'),
    ev('2026-09-26T09:49:42.000Z', 'Gesloten', 'Open'),
  ];
  assert.equal(berekenSinds(events, '2026-06-29T17:07:44.000Z'), '2026-09-29T08:13:43.000Z');
});

test('berekenSinds: nooit uit traject -> createdTime', () => {
  const events = [ev('2026-09-02T10:00:00.000Z', 'Wachten op planning', 'Geplande service')];
  assert.equal(berekenSinds(events, '2026-06-29T17:07:44.000Z'), '2026-06-29T17:07:44.000Z');
  assert.equal(berekenSinds([], '2026-06-29T17:07:44.000Z'), '2026-06-29T17:07:44.000Z');
  assert.equal(berekenSinds([], undefined), null);
});

test('berekenSinds: terugkeer na Wachten op klant -> laatste instap', () => {
  const events = [
    ev('2026-09-20T10:00:00.000Z', 'Wachten op klant', 'Wachten op planning'),
    ev('2026-09-10T10:00:00.000Z', 'Wachten op planning', 'Wachten op klant'),
    ev('2026-09-01T10:00:00.000Z', 'Open', 'Wachten op planning'),
  ];
  assert.equal(berekenSinds(events, '2026-06-01T00:00:00.000Z'), '2026-09-20T10:00:00.000Z');
});

test('berekenSinds: bevestiging -> terug naar te plannen telt door', () => {
  const events = [
    ev('2026-09-25T10:00:00.000Z', 'Wachten op bevestiging planning', 'Wachten op planning'),
    ev('2026-09-22T10:00:00.000Z', 'Wachten op planning', 'Wachten op bevestiging planning'),
    ev('2026-09-15T10:00:00.000Z', 'Open', 'Wachten op planning'),
  ];
  assert.equal(berekenSinds(events, '2026-06-01T00:00:00.000Z'), '2026-09-15T10:00:00.000Z');
});

test('berekenSinds: items zonder Status-transitie worden genegeerd', () => {
  const ander = { eventName: 'TicketUpdated', eventTime: '2026-09-28T00:00:00.000Z',
    eventInfo: [{ propertyName: 'Priority', propertyValue: { previousValue: 'Low', updatedValue: 'High' } }] };
  const events = [ander, { eventTime: 'x' }, ev('2026-09-15T10:00:00.000Z', 'Open', 'Wachten op planning')];
  assert.equal(berekenSinds(events, '2026-06-01T00:00:00.000Z'), '2026-09-15T10:00:00.000Z');
});

test('TRAJECT bevat de vijf statussen', () => {
  assert.equal(TRAJECT.length, 5);
  assert.ok(TRAJECT.includes('Wachten op planning'));
});

test('volgendePaginaNodig: 50 events zonder verlaat-event -> true', () => {
  const events = Array.from({ length: 50 }, () =>
    ev('2026-09-10T10:00:00.000Z', 'Wachten op planning', 'Wachten op bevestiging planning'));
  assert.equal(volgendePaginaNodig(events, 50), true);
});

test('volgendePaginaNodig: verlaat-event gevonden of minder dan een volle pagina -> false', () => {
  const events = Array.from({ length: 50 }, () => ev('2026-09-10T10:00:00.000Z', 'Wachten op planning', 'Geplande service'));
  events[10] = ev('2026-09-01T10:00:00.000Z', 'Open', 'Wachten op planning');
  assert.equal(volgendePaginaNodig(events, 50), false);
  const kort = Array.from({ length: 3 }, () => ev('2026-09-10T10:00:00.000Z', 'Wachten op planning', 'Geplande service'));
  assert.equal(volgendePaginaNodig(kort, 50), false);
});

function nepStore(init = {}) {
  const data = { ...init };
  return {
    data,
    async get(k) { return k in data ? data[k] : null; },
    async setJSON(k, v) { data[k] = JSON.parse(JSON.stringify(v)); },
  };
}

test('leesRegister: kapotte blob -> {}', async () => {
  const kapot = { async get() { throw new Error('kapot'); } };
  assert.deepEqual(await leesRegister(kapot), {});
  assert.deepEqual(await leesRegister(nepStore()), {});
  assert.deepEqual(await leesRegister(nepStore({ 'planning-sinds': 'onzin' })), {});
});

test('schrijfRegister / leesRegister: rondreis op sleutel planning-sinds', async () => {
  const store = nepStore();
  await schrijfRegister(store, { 3638: { sinds: '2026-09-29T08:13:43.000Z' } });
  assert.ok('planning-sinds' in store.data);
  assert.deepEqual(await leesRegister(store), { 3638: { sinds: '2026-09-29T08:13:43.000Z' } });
});

// ---- handler ---------------------------------------------------------------
import { maakHandler } from '../netlify/functions/planning-sinds.js';

function nepWinkel(initieel = {}, { faalLezen = false, faalSchrijven = false } = {}) {
  const m = new Map(Object.entries(initieel).map(([k, v]) => [k, JSON.stringify(v)]));
  const schrijf = [];
  return {
    m, schrijf,
    getStore: () => ({
      async get(k, opt) {
        if (faalLezen) throw new Error('blobs stuk');
        if (!m.has(k)) return null;
        return opt?.type === 'json' ? JSON.parse(m.get(k)) : m.get(k);
      },
      async setJSON(k, v) {
        if (faalSchrijven) throw new Error('blobs stuk');
        schrijf.push(k); m.set(k, JSON.stringify(v));
      },
    }),
  };
}

function nepFetch({ faalVoor = [] } = {}) {
  const calls = [];
  const fn = async (url) => {
    url = String(url);
    calls.push(url);
    const res = (status, obj) => new Response(JSON.stringify(obj), { status });
    if (url.includes('accounts.zoho')) return res(200, { access_token: 'tok' });
    if (url.endsWith('/organizations')) return res(200, { data: [{ id: 'org1' }] });
    const h = url.match(/\/tickets\/(\d+)\/History/);
    if (h) {
      if (faalVoor.includes(h[1])) return res(500, {});
      return res(200, { data: [ev('2026-09-29T08:13:43.000Z', 'Wachten op klant', 'Wachten op planning')] });
    }
    const t = url.match(/\/tickets\/(\d+)$/);
    if (t) return res(200, { createdTime: '2026-06-29T17:07:44.000Z' });
    return res(404, {});
  };
  fn.calls = calls;
  return fn;
}

const post = (body, headers = {}) => new Request('http://localhost/api/planning-sinds', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('handler: bestaand register-entry -> geen Zoho-aanroep', async () => {
  const s = nepWinkel({ 'planning-sinds': { 11: { sinds: '2026-09-01T00:00:00.000Z' } } });
  const f = nepFetch();
  const r = await maakHandler({ getStore: s.getStore, fetch: f })(post({ opzoeken: ['11'], actief: ['11'] }));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).sinds, { 11: '2026-09-01T00:00:00.000Z' });
  assert.equal(f.calls.length, 0);
  assert.equal(s.schrijf.length, 0);
});

test('handler: 25 nieuwe -> 20 opgezocht, 5 null', async () => {
  const s = nepWinkel();
  const f = nepFetch();
  const ids = Array.from({ length: 25 }, (_, i) => String(100 + i));
  const r = await maakHandler({ getStore: s.getStore, fetch: f })(post({ opzoeken: ids, actief: ids }));
  const { sinds } = await r.json();
  assert.equal(Object.values(sinds).filter(v => v).length, 20);
  assert.equal(Object.values(sinds).filter(v => v === null).length, 5);
  assert.equal(Object.keys(JSON.parse(s.m.get('planning-sinds'))).length, 20);
  assert.equal(f.calls.filter(u => u.includes('/History')).length, 20);
});

test('handler: entry buiten actief wordt verwijderd', async () => {
  const s = nepWinkel({ 'planning-sinds': { 11: { sinds: 'a' }, 12: { sinds: 'b' } } });
  const f = nepFetch();
  const r = await maakHandler({ getStore: s.getStore, fetch: f })(post({ opzoeken: [], actief: ['11'] }));
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(s.m.get('planning-sinds')), { 11: { sinds: 'a' } });
});

test('handler: Zoho-fout bij één ticket -> dat ticket null, rest ok, status 200', async () => {
  const s = nepWinkel();
  const f = nepFetch({ faalVoor: ['2'] });
  const r = await maakHandler({ getStore: s.getStore, fetch: f })(post({ opzoeken: ['1', '2', '3'], actief: ['1', '2', '3'] }));
  assert.equal(r.status, 200);
  const { sinds } = await r.json();
  assert.equal(sinds[2], null);
  assert.equal(sinds[1], '2026-09-29T08:13:43.000Z');
  assert.equal(sinds[3], '2026-09-29T08:13:43.000Z');
  assert.deepEqual(Object.keys(JSON.parse(s.m.get('planning-sinds'))).sort(), ['1', '3']);
});

test('handler: Blobs-fout -> toch 200 met gekende waarden', async () => {
  const s = nepWinkel({}, { faalLezen: true, faalSchrijven: true });
  const f = nepFetch();
  const r = await maakHandler({ getStore: s.getStore, fetch: f })(post({ opzoeken: ['1'], actief: ['1'] }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).sinds[1], '2026-09-29T08:13:43.000Z');
});

test('handler: getStore gooit -> toch 200', async () => {
  const f = nepFetch();
  const r = await maakHandler({ getStore: () => { throw new Error('geen blobs'); }, fetch: f })(post({ opzoeken: ['1'], actief: ['1'] }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).sinds[1], '2026-09-29T08:13:43.000Z');
});

test('handler: nooit-verlaten ticket -> createdTime via GET /tickets/id', async () => {
  const f = nepFetch();
  const orig = f;
  const fn = async (url, o) => {
    if (/\/History/.test(String(url))) { orig.calls.push(String(url)); return new Response(JSON.stringify({ data: [] }), { status: 200 }); }
    return orig(url, o);
  };
  fn.calls = orig.calls;
  const r = await maakHandler({ getStore: nepWinkel().getStore, fetch: fn })(post({ opzoeken: ['5'], actief: ['5'] }));
  assert.equal((await r.json()).sinds[5], '2026-06-29T17:07:44.000Z');
  assert.ok(fn.calls.some(u => /\/tickets\/5$/.test(u)));
});

test('handler: testverzoek -> {sinds:{}} zonder fetch', async () => {
  const s = nepWinkel();
  const f = nepFetch();
  const r = await maakHandler({ getStore: s.getStore, fetch: f })(post({ opzoeken: ['1'], actief: ['1'] }, { 'X-Blitz-Test': '1' }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { sinds: {} });
  assert.equal(f.calls.length, 0);
});

test('handler: GET -> 405', async () => {
  const r = await maakHandler({ getStore: nepWinkel().getStore, fetch: nepFetch() })(new Request('http://localhost/api/planning-sinds'));
  assert.equal(r.status, 405);
});
