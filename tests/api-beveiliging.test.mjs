import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installeerApiBeveiliging } from '../public/js/kern/api.js';

// Nep-doel met nep-fetch: antwoorden in volgorde (of een functie van de index); onthoudt de aanroepen.
function antwoord(status, json) {
  return new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
}
function opstellen(antwoorden = [], opties = {}) {
  const aanroepen = [];
  const doel = { location: { href: 'https://app.test/', origin: 'https://app.test' } };
  doel.fetch = async (invoer, init) => {
    aanroepen.push({ invoer, init });
    const a = typeof antwoorden === 'function' ? antwoorden(aanroepen.length - 1) : antwoorden[aanroepen.length - 1];
    return a ?? antwoord(200, { ok: true });
  };
  const oorspronkelijk = doel.fetch;
  let herloginAantal = 0;
  const herlogin = async () => { herloginAantal++; if (opties.herlogin) await opties.herlogin(); };
  const herstel = installeerApiBeveiliging(doel, { herlogin, testRol: opties.testRol, bijStoring: opties.bijStoring });
  return { doel, aanroepen, herstel, oorspronkelijk, herlogin: () => herloginAantal };
}
const kop = (a, naam) => new Headers(a.init?.headers).get(naam);

test('schrijvende methoden krijgen X-Blitz: 1, lezende niet', async () => {
  const { doel, aanroepen } = opstellen();
  await doel.fetch('/api/plan', { method: 'POST', body: '{}' });
  await doel.fetch('/api/x', { method: 'PUT', body: '{}' });
  await doel.fetch('/api/x', { method: 'PATCH', body: '{}' });
  await doel.fetch('/api/x', { method: 'delete' });
  for (const a of aanroepen) assert.equal(kop(a, 'X-Blitz'), '1');
  await doel.fetch('/api/tickets');
  await doel.fetch('/api/tickets', { method: 'GET' });
  await doel.fetch('/api/tickets', { method: 'HEAD' });
  await doel.fetch('/api/tickets', { method: 'OPTIONS' });
  for (const a of aanroepen.slice(4)) assert.equal(kop(a, 'X-Blitz'), null);
});

test('bestaande headers blijven bij het toevoegen van X-Blitz (object, Headers en Request)', async () => {
  const { doel, aanroepen } = opstellen();
  await doel.fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Blitz-Test': '1' }, body: '{}' });
  assert.equal(kop(aanroepen[0], 'Content-Type'), 'application/json');
  assert.equal(kop(aanroepen[0], 'X-Blitz-Test'), '1');
  await doel.fetch('/api/plan', { method: 'POST', headers: new Headers({ A: 'b' }), body: '{}' });
  assert.equal(kop(aanroepen[1], 'A'), 'b');
  assert.equal(kop(aanroepen[1], 'X-Blitz'), '1');
  await doel.fetch(new Request('https://app.test/api/plan', { method: 'POST', headers: { 'X-Eigen': 'ja' }, body: '{}' }));
  assert.equal(kop(aanroepen[2], 'X-Eigen'), 'ja');
  assert.equal(kop(aanroepen[2], 'X-Blitz'), '1');
});

test('extern adres, data: en niet-/api/ blijven onaangeroerd (zelfde init-object)', async () => {
  const { doel, aanroepen } = opstellen();
  for (const u of ['https://cdn.jsdelivr.net/npm/exceljs.js', 'data:text/plain,hi', 'https://andere.test/api/plan', '/js/app.js']) {
    const init = { method: 'POST', body: 'x' };
    await doel.fetch(u, init);
    assert.equal(aanroepen.at(-1).invoer, u);
    assert.equal(aanroepen.at(-1).init, init, u);
  }
});

test('testRol: tekst wordt X-Blitz-Test-Rol (ook bij GET), null of ontbrekend niet', async () => {
  const { doel, aanroepen } = opstellen([], { testRol: () => 'planner' });
  await doel.fetch('/api/tickets');
  await doel.fetch('/api/plan', { method: 'POST', body: '{}' });
  assert.equal(kop(aanroepen[0], 'X-Blitz-Test-Rol'), 'planner');
  assert.equal(kop(aanroepen[1], 'X-Blitz-Test-Rol'), 'planner');
  const z = opstellen([], { testRol: () => null });
  await z.doel.fetch('/api/tickets');
  assert.equal(kop(z.aanroepen[0], 'X-Blitz-Test-Rol'), null);
  const zonder = opstellen();
  await zonder.doel.fetch('/api/tickets');
  assert.equal(kop(zonder.aanroepen[0], 'X-Blitz-Test-Rol'), null);
});

test('401 op een gewone functie: herlogin één keer en het verzoek wordt herhaald; het tweede antwoord komt terug', async () => {
  const { doel, aanroepen, herlogin } = opstellen([antwoord(401, { code: 'niet-ingelogd' }), antwoord(200, { data: 1 })]);
  const r = await doel.fetch('/api/plan', { method: 'POST', body: '{"a":1}' });
  assert.equal(herlogin(), 1);
  assert.equal(aanroepen.length, 2);
  assert.equal(aanroepen[1].init.body, '{"a":1}');
  assert.equal(kop(aanroepen[1], 'X-Blitz'), '1');
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { data: 1 });
});

test('een tweede 401 wordt doorgegeven, geen derde poging', async () => {
  const { doel, aanroepen, herlogin } = opstellen([antwoord(401, { code: 'niet-ingelogd' }), antwoord(401, { code: 'niet-ingelogd' })]);
  const r = await doel.fetch('/api/tickets');
  assert.equal(r.status, 401);
  assert.equal(aanroepen.length, 2);
  assert.equal(herlogin(), 1);
});

test('401 op /api/auth-* triggert herlogin niet (ook niet 403 wachtwoord-wijzigen)', async () => {
  const { doel, aanroepen, herlogin } = opstellen([antwoord(401, { code: 'niet-ingelogd' }), antwoord(401, {}), antwoord(403, { code: 'wachtwoord-wijzigen' })]);
  assert.equal((await doel.fetch('/api/auth-login', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await doel.fetch('/api/auth-ik')).status, 401);
  assert.equal((await doel.fetch('/api/auth-wachtwoord', { method: 'POST', body: '{}' })).status, 403);
  assert.equal(herlogin(), 0);
  assert.equal(aanroepen.length, 3);
});

test('403 wachtwoord-wijzigen triggert herlogin en herhaling; 403 geen-recht en csrf niet', async () => {
  const a = opstellen([antwoord(403, { code: 'wachtwoord-wijzigen' }), antwoord(200, {})]);
  assert.equal((await a.doel.fetch('/api/tickets')).status, 200);
  assert.equal(a.herlogin(), 1);
  assert.equal(a.aanroepen.length, 2);
  for (const code of ['geen-recht', 'csrf']) {
    const b = opstellen([antwoord(403, { code })]);
    const r = await b.doel.fetch('/api/tickets');
    assert.equal(r.status, 403);
    assert.equal(b.herlogin(), 0);
    assert.equal(b.aanroepen.length, 1);
    assert.equal((await r.json()).code, code, 'body blijft leesbaar');
  }
});

test('drie gelijktijdige 401s: herlogin drie keer aangeroepen, alle drie herhaald', async () => {
  const { doel, aanroepen, herlogin } = opstellen((i) => (i < 3 ? antwoord(401, {}) : antwoord(200, { i })));
  const rs = await Promise.all([doel.fetch('/api/a'), doel.fetch('/api/b'), doel.fetch('/api/c')]);
  assert.equal(herlogin(), 3);
  assert.equal(aanroepen.length, 6);
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200]);
});

test('een eigen signal blijft gerespecteerd, ook bij de herhaling', async () => {
  const { doel, aanroepen } = opstellen([antwoord(401, {}), antwoord(200, {})]);
  const c = new AbortController();
  await doel.fetch('/api/tickets', { signal: c.signal });
  assert.equal(aanroepen[0].init.signal, c.signal);
  assert.equal(aanroepen[1].init.signal, c.signal);
});

test('de body van een niet-herhaald antwoord blijft leesbaar voor de aanroeper (clone)', async () => {
  const { doel } = opstellen([antwoord(403, { code: 'wachtwoord-wijzigen', error: 'x' }), antwoord(500, { error: 'stuk' })]);
  const r = await doel.fetch('/api/tickets');
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'stuk' });
  const b = opstellen([antwoord(403, { code: 'geen-recht', error: 'nee' })]);
  const r2 = await b.doel.fetch('/api/tickets');
  assert.deepEqual(await r2.json(), { code: 'geen-recht', error: 'nee' });
});

test('een Request-invoer of een stroom-body wordt niet herhaald (401 doorgegeven, herlogin wel gestart)', async () => {
  const a = opstellen([antwoord(401, {})]);
  const r = await a.doel.fetch(new Request('https://app.test/api/plan', { method: 'POST', body: '{}' }));
  assert.equal(r.status, 401);
  assert.equal(a.aanroepen.length, 1);
  assert.equal(a.herlogin(), 1);
  const b = opstellen([antwoord(401, {})]);
  const r2 = await b.doel.fetch('/api/fotos', { method: 'PUT', body: new ReadableStream(), duplex: 'half' });
  assert.equal(r2.status, 401);
  assert.equal(b.aanroepen.length, 1);
});

test('herlogin die faalt: het oorspronkelijke 401-antwoord wordt doorgegeven', async () => {
  const { doel, aanroepen } = opstellen([antwoord(401, { code: 'niet-ingelogd' })], { herlogin: async () => { throw new Error('geen ui'); } });
  const r = await doel.fetch('/api/tickets');
  assert.equal(r.status, 401);
  assert.equal(aanroepen.length, 1);
});

test('503 opslag-storing: bijStoring aangeroepen, geen herlogin, antwoord en body bruikbaar', async () => {
  let gemeld = 0;
  const { doel, herlogin } = opstellen([antwoord(503, { code: 'opslag-storing', error: 'later' })], { bijStoring: () => { gemeld++; } });
  const r = await doel.fetch('/api/tickets');
  assert.equal(r.status, 503);
  assert.equal(gemeld, 1);
  assert.equal(herlogin(), 0);
  assert.equal((await r.json()).code, 'opslag-storing');
  const { doel: d2 } = opstellen([antwoord(503, { error: 'ander' })], { bijStoring: () => { gemeld++; } });
  await d2.fetch('/api/tickets');
  assert.equal(gemeld, 1, 'een 503 zonder code opslag-storing meldt niets');
});

test('de herstelfunctie zet de oorspronkelijke fetch terug', () => {
  const { doel, herstel, oorspronkelijk } = opstellen();
  assert.notEqual(doel.fetch, oorspronkelijk);
  herstel();
  assert.equal(doel.fetch, oorspronkelijk);
});
