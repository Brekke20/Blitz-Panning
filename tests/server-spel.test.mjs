// tests/server-spel.test.mjs — /api/spel (Blitz Run: voortgang per account) + netlify/lib/spel.js
// Nooit echte Zoho/TomTom/mail: de functie raakt enkel Blobs aan. Hangt niet af van specifieke skin-ids, enkel van standaardSkin().
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { maakHandler } from '../netlify/functions/spel.js';
import { leesSpel, bewaarSpel, valideerInzending, voortgangVan, spelSleutel } from '../netlify/lib/spel.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { metRol, metGeenSessie } from './auth-hulp.mjs';
import { SKINS, standaardSkin } from '../public/js/spel/skins.js';
import { MAX_SCORE } from '../public/js/spel/spel-regels.js';

const NU0 = Date.parse('2026-10-31T10:00:00.000Z');
const NU_15_OKT = Date.parse('2026-10-15T10:00:00.000Z');
const NU_15_NOV = Date.parse('2026-11-15T10:00:00.000Z');
const echteWinkel = 'blitz-data';

function opzet({ evenementen } = {}) {
  const echt = maakNepStore({});
  const test = maakNepStore({});
  const getStore = (o) => (o.name === echteWinkel ? echt : test);
  const datums = [];
  const h = maakHandler({
    getStore, nu: () => NU0,
    actieveEvenementen: (d) => { datums.push(d); return evenementen ?? []; }, // standaard: geen events (de echte kalender staat in de tests hieronder)
  });
  return { echt, test, h, datums };
}
const req = (methode, { body, headers = {}, ruw } = {}) => new Request('http://localhost/api/spel', {
  method: methode,
  headers: { 'content-type': 'application/json', 'x-blitz': '1', ...headers },
  body: ruw ?? (body === undefined ? undefined : JSON.stringify(body)),
});
const post = (body, o = {}) => req('POST', { body, ...o });
const get = (o = {}) => req('GET', o);
const goud = SKINS.find(s => s.soort === 'goud' && typeof s.drempel === 'number');
const eventSkin = SKINS.find(s => s.soort === 'event');

test('rechtenrij: GET en POST voor alle vier de rollen, niets anders', () => {
  const alle = ['beheerder', 'planner', 'sales', 'technieker'];
  assert.deepEqual([...RECHTEN.spel.GET].sort(), alle);
  assert.deepEqual([...RECHTEN.spel.POST].sort(), alle);
  assert.equal(RECHTEN.spel.PUT, undefined);
  assert.equal(RECHTEN.spel.DELETE, undefined);
});

test('zonder sessie: 401, en de functie raakt de opslag niet aan', async () => {
  const { h, echt, test } = opzet();
  const r = await metGeenSessie(() => h(get()));
  assert.equal(r.status, 401);
  assert.equal(echt._schrijfacties.length + test._schrijfacties.length, 0);
});

test('GET zonder record: de beginstand (basis ontgrendeld, score 0, standaardskin gekozen); elke rol mag', async () => {
  const { h } = opzet();
  for (const rol of ['beheerder', 'planner', 'technieker', 'sales']) {
    const r = await metRol(rol, () => h(get()));
    assert.equal(r.status, 200, rol);
    const j = await r.json();
    assert.equal(j.besteScore, 0);
    assert.equal(j.gekozenSkin, standaardSkin());
    assert.ok(j.ontgrendeld.includes(standaardSkin()));
  }
});

test('POST bewaart de score; een lagere score verlaagt hem niet (hoogste blijft)', async () => {
  const { h } = opzet();
  assert.equal((await (await metRol('planner', () => h(post({ score: 120 })))).json()).besteScore, 120);
  assert.equal((await (await metRol('planner', () => h(post({ score: 40 })))).json()).besteScore, 120);
  assert.equal((await (await metRol('planner', () => h(post({ score: 300 })))).json()).besteScore, 300);
  assert.equal((await (await metRol('planner', () => h(get()))).json()).besteScore, 300);
});

test('het record is per gebruiker: een andere rol/gebruiker ziet de score van een ander niet', async () => {
  const { h, echt } = opzet();
  await metRol('planner', () => h(post({ score: 500 })));
  assert.equal((await (await metRol('technieker', () => h(get()))).json()).besteScore, 0);
  assert.deepEqual([...echt._data.keys()], [spelSleutel('test-planner')]);
});

test('een id of gebruiker in het verzoek verandert niets: altijd het eigen record', async () => {
  const { h, echt } = opzet();
  await metRol('technieker', () => h(post({ score: 70, gebruiker: 'test-beheerder', id: 'test-beheerder' })));
  assert.deepEqual([...echt._data.keys()], [spelSleutel('test-technieker')]);
});

test('score-skins worden server-side ontgrendeld op de drempel (en niet eerder)', { skip: !goud }, async () => {
  const { h } = opzet();
  const onder = await (await metRol('planner', () => h(post({ score: goud.drempel - 1 })))).json();
  assert.ok(!onder.ontgrendeld.includes(goud.id));
  const op = await (await metRol('planner', () => h(post({ score: goud.drempel })))).json();
  assert.ok(op.ontgrendeld.includes(goud.id));
});

test('een gekozen skin moet ontgrendeld zijn: vergrendeld geeft 400 en verandert niets; ontgrendeld wordt bewaard', { skip: !goud }, async () => {
  const { h } = opzet();
  const nee = await metRol('planner', () => h(post({ score: 5, gekozenSkin: goud.id })));
  assert.equal(nee.status, 400);
  assert.match((await nee.json()).error, /ontgrendeld/);
  assert.equal((await (await metRol('planner', () => h(get()))).json()).besteScore, 0, 'een geweigerde inzending schrijft niets');
  const ja = await metRol('planner', () => h(post({ score: goud.drempel, gekozenSkin: goud.id })));
  assert.equal(ja.status, 200);
  assert.equal((await ja.json()).gekozenSkin, goud.id);
  assert.equal((await (await metRol('planner', () => h(get()))).json()).gekozenSkin, goud.id);
});

test('een ontgrendelde skin blijft ontgrendeld en blijft kiesbaar, ook met een latere lage score', { skip: !goud }, async () => {
  const { h } = opzet();
  await metRol('planner', () => h(post({ score: goud.drempel })));
  const r = await metRol('planner', () => h(post({ score: 1, gekozenSkin: goud.id })));
  assert.equal(r.status, 200);
});

test('een onbekende skin-id: 400', async () => {
  const { h } = opzet();
  for (const gekozenSkin of ['bestaat-niet', 5, null, {}]) {
    assert.equal((await metRol('planner', () => h(post({ score: 1, gekozenSkin })))).status, 400, JSON.stringify(gekozenSkin));
  }
});

test('validatie van de score: een getal 0..MAX_SCORE; anders 400 met een Nederlandse tekst', async () => {
  const { h, test } = opzet();
  for (const score of [-1, MAX_SCORE + 1, NaN, Infinity, '50', null, undefined, {}, [], true, 1e12]) {
    const r = await metRol('planner', () => h(post({ score })));
    assert.equal(r.status, 400, String(score));
    assert.match((await r.json()).error, /score/i);
  }
  assert.equal(test._schrijfacties.length, 0);
  assert.equal((await metRol('planner', () => h(post({ score: 0 })))).status, 200);
  assert.equal((await metRol('planner', () => h(post({ score: MAX_SCORE })))).status, 200);
  assert.equal((await (await metRol('planner', () => h(post({ score: 12.9 })))).json()).besteScore, MAX_SCORE, 'een lagere score blijft onder het record');
});

test('een kommagetal wordt naar beneden afgerond', async () => {
  const { h } = opzet();
  assert.equal((await (await metRol('planner', () => h(post({ score: 12.9 })))).json()).besteScore, 12);
});

test('ongeldige JSON en een niet-object: 400', async () => {
  const { h } = opzet();
  assert.equal((await metRol('planner', () => h(post(undefined, { ruw: '{kapot' })))).status, 400);
  for (const body of [[], 'x', 5, null]) {
    assert.equal((await metRol('planner', () => h(post(body)))).status, 400, JSON.stringify(body));
  }
});

test('niet-toegelaten methoden: 405 (PUT, DELETE)', async () => {
  const { h } = opzet();
  assert.equal((await metRol('planner', () => h(req('PUT', { body: { score: 1 } })))).status, 405);
  assert.equal((await metRol('planner', () => h(req('DELETE')))).status, 405);
});

test('een testverzoek (X-Blitz-Test) gebruikt de teststore, nooit de echte', async () => {
  const { h, echt, test } = opzet();
  await metRol('planner', () => h(post({ score: 5 }, { headers: { 'x-blitz-test': '1' } })));
  assert.equal(echt._schrijfacties.length, 0);
  assert.equal(test._schrijfacties.length, 1);
});

test('een Blobs-storing geeft 503 zonder details', async () => {
  const getStore = () => ({ get: async () => { throw new Error('geheim detail'); }, setJSON: async () => { throw new Error('geheim'); } });
  const h = maakHandler({ getStore, nu: () => NU0 });
  const r = await metRol('planner', () => h(get()));
  assert.equal(r.status, 503);
  assert.ok(!JSON.stringify(await r.json()).includes('geheim'));
});

test('events: een injecteerbare functie krijgt de serverdatum (YYYY-MM-DD, Brussel)', async () => {
  const { h, datums } = opzet({ evenementen: [] });
  await metRol('planner', () => h(get()));
  assert.deepEqual(datums, ['2026-10-31']);
});

test('een event-skin is enkel ontgrendeld als het event op de serverdatum actief is (en blijft daarna ontgrendeld)', { skip: !eventSkin }, async () => {
  const zonder = opzet();
  const r0 = await (await metRol('planner', () => zonder.h(get()))).json();
  assert.ok(!r0.ontgrendeld.includes(eventSkin.id));
  assert.equal((await metRol('planner', () => zonder.h(post({ score: 1, gekozenSkin: eventSkin.id })))).status, 400);

  const echt = maakNepStore({});
  const nepStore = () => echt;
  const actief = maakHandler({ getStore: nepStore, nu: () => NU0, actieveEvenementen: () => [{ id: eventSkin.eventId }] });
  const uit = maakHandler({ getStore: nepStore, nu: () => NU0 });
  const r1 = await metRol('planner', () => actief(post({ score: 1, gekozenSkin: eventSkin.id })));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).gekozenSkin, eventSkin.id);
  const later = await (await metRol('planner', () => uit(get()))).json();
  assert.ok(later.ontgrendeld.includes(eventSkin.id), 'eenmaal ontgrendeld blijft ontgrendeld');
});

test('een event-skin die bij een GET nieuw open is, wordt meteen bewaard en blijft na het event', { skip: !eventSkin }, async () => {
  const echt = maakNepStore({});
  const actief = maakHandler({ getStore: () => echt, nu: () => NU0, actieveEvenementen: () => [{ id: eventSkin.eventId }] });
  const j = await (await metRol('planner', () => actief(get()))).json();
  assert.ok(j.ontgrendeld.includes(eventSkin.id));
  assert.equal(echt._schrijfacties.length, 1);
  assert.ok(JSON.parse(echt._data.get(spelSleutel('test-planner'))).ontgrendeld.includes(eventSkin.id));
  const uit = maakHandler({ getStore: () => echt, nu: () => NU0, actieveEvenementen: () => [] });
  assert.ok((await (await metRol('planner', () => uit(get()))).json()).ontgrendeld.includes(eventSkin.id));
});

test('een GET die de event-skin niet kan bewaren, antwoordt toch 200', { skip: !eventSkin }, async () => {
  const echt = maakNepStore({});
  const store = { get: (...a) => echt.get(...a), setJSON: async () => { throw new Error('schrijffout'); } };
  const h = maakHandler({ getStore: () => store, nu: () => NU0, actieveEvenementen: () => [{ id: eventSkin.eventId }] });
  const r = await metRol('planner', () => h(get()));
  assert.equal(r.status, 200);
  assert.ok((await r.json()).ontgrendeld.includes(eventSkin.id));
});

test('echte kalender: op 15 oktober krijgt de speler de Halloween-skin en wordt hij bewaard; op 15 november niet nieuw, maar eenmaal bewaard blijft hij', async () => {
  const halloween = SKINS.find(s => s.eventId === 'halloween');
  const echt = maakNepStore({});
  const hOkt = maakHandler({ getStore: () => echt, nu: () => NU_15_OKT });
  const hNov = maakHandler({ getStore: () => echt, nu: () => NU_15_NOV });
  const vers = maakNepStore({});
  const hNovVers = maakHandler({ getStore: () => vers, nu: () => NU_15_NOV });
  assert.ok(!(await (await metRol('planner', () => hNovVers(get()))).json()).ontgrendeld.includes(halloween.id), 'in november niet nieuw');
  assert.equal(vers._schrijfacties.length, 0);
  const okt = await (await metRol('planner', () => hOkt(get()))).json();
  assert.ok(okt.ontgrendeld.includes(halloween.id));
  assert.ok(JSON.parse(echt._data.get(spelSleutel('test-planner'))).ontgrendeld.includes(halloween.id), 'bewaard');
  assert.ok((await (await metRol('planner', () => hNov(get()))).json()).ontgrendeld.includes(halloween.id), 'blijft in november');
});

test('een inzending boven 2 kB (content-length) wordt geweigerd met 413 en schrijft niets', async () => {
  const { h, echt, test } = opzet();
  const r = await metRol('planner', () => h(post({ score: 1, vul: 'x'.repeat(3000) })));
  assert.equal(r.status, 413);
  assert.equal(echt._schrijfacties.length + test._schrijfacties.length, 0);
  assert.equal((await metRol('planner', () => h(post({ score: 1 })))).status, 200);
});

test('een actieveEvenementen die gooit of onzin teruggeeft telt als geen events', async () => {
  const echt = maakNepStore({});
  for (const f of [() => { throw new Error('x'); }, () => 'ja', () => null]) {
    const h = maakHandler({ getStore: () => echt, nu: () => NU0, actieveEvenementen: f });
    assert.equal((await metRol('planner', () => h(get()))).status, 200);
  }
});

// ---- lib ----
test('lib: valideerInzending', () => {
  assert.deepEqual(valideerInzending({ score: 10 }), { score: 10, gekozenSkin: undefined });
  assert.ok(valideerInzending({ score: -1 }).fout);
  assert.ok(valideerInzending(null).fout);
  assert.ok(valideerInzending({ score: 1, gekozenSkin: 'nietbestaand' }).fout);
});

test('lib: een beschadigd record geeft de beginstand in plaats van een fout', async () => {
  const store = maakNepStore({ [spelSleutel('u1')]: { besteScore: 'veel', ontgrendeld: 'alles', gekozenSkin: 5 } });
  const v = await leesSpel(store, 'u1');
  assert.deepEqual(v, voortgangVan(null));
});

test('lib: ongeldige gebruikers-id wordt geweigerd (geen sleutelinjectie)', async () => {
  const store = maakNepStore({});
  for (const id of ['', '../x', 'a/b', undefined, '__proto__']) {
    await assert.rejects(() => leesSpel(store, id));
    await assert.rejects(() => bewaarSpel(store, id, { score: 1 }));
  }
});

test('lib: gelijktijdige inzendingen van één gebruiker verliezen de hoogste score niet', async () => {
  const store = maakNepStore({});
  await Promise.all([10, 90, 40, 70].map(score => bewaarSpel(store, 'u1', { score })));
  assert.equal((await leesSpel(store, 'u1')).besteScore, 90);
});
