// tests/server-spel.test.mjs — /api/spel (Blitz Run: voortgang per account) + netlify/lib/spel.js
// Nooit echte Zoho/TomTom/mail: de functie raakt enkel Blobs aan. Hangt niet af van specifieke skin-ids, enkel van standaardSkin();
// de themaskins komen uit de themas-store (injecteerbare `themaBron`; de echte bron staat in de tests onderaan).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { maakHandler } from '../netlify/functions/spel.js';
import { leesSpel, bewaarSpel, valideerInzending, voortgangVan, spelSleutel } from '../netlify/lib/spel.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { metRol, metGeenSessie } from './auth-hulp.mjs';
import { SKINS, standaardSkin } from '../public/js/spel/skins.js';
import { MAX_SCORE } from '../public/js/spel/spel-regels.js';
import { zaai, leesIndex, wijzigThema, INDEX_SLEUTEL } from '../netlify/lib/themas.js';

const NU0 = Date.parse('2026-10-31T10:00:00.000Z');
const NU_15_OKT = Date.parse('2026-10-15T10:00:00.000Z');
const NU_15_NOV = Date.parse('2026-11-15T10:00:00.000Z');
const NU_15_DEC = Date.parse('2026-12-15T10:00:00.000Z');
const echteWinkel = 'blitz-data';

// De bron van de themaskins die de handler gebruikt; standaard twee bekende themaskins (halloween, kerst) en geen enkel actief thema.
const THEMA_SKINS = [{ id: 'halloween', naam: 'Spookpaal', soort: 'thema' }, { id: 'kerst', naam: 'Kerstpaal', soort: 'thema' }];
const bronMet = (actieveThemaIds = [], skins = THEMA_SKINS) => async () => ({ skins, actieveThemaIds });

function opzet({ actieveThemaIds = [], skins = THEMA_SKINS } = {}) {
  const echt = maakNepStore({});
  const test = maakNepStore({});
  const getStore = (o) => (o.name === echteWinkel ? echt : test);
  const datums = [];
  const h = maakHandler({
    getStore, nu: () => NU0,
    // standaard: geen actief thema (de echte themas-store staat in de tests onderaan)
    themaBron: async (_store, d) => { datums.push(d); return { skins, actieveThemaIds }; },
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
const themaSkin = THEMA_SKINS[0];

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

// Bewust gewijzigd (final-review I3): een vergrendelde skin weigerde vroeger de HELE inzending (400, score verloren).
// Nu telt de score altijd; enkel de skin-keuze wordt genegeerd en het antwoord meldt `skinGeweigerd`.
test('een vergrendelde gekozen skin weigert de score niet: score bewaard, skin genegeerd, skinGeweigerd; ontgrendeld wordt bewaard', { skip: !goud }, async () => {
  const { h } = opzet();
  const nee = await metRol('planner', () => h(post({ score: 5, gekozenSkin: goud.id })));
  assert.equal(nee.status, 200);
  const dat = await nee.json();
  assert.equal(dat.skinGeweigerd, true);
  assert.equal(dat.besteScore, 5);
  assert.notEqual(dat.gekozenSkin, goud.id);
  const stand = await (await metRol('planner', () => h(get()))).json();
  assert.equal(stand.besteScore, 5, 'de score is bewaard');
  assert.ok(!('skinGeweigerd' in stand));
  const ja = await metRol('planner', () => h(post({ score: goud.drempel, gekozenSkin: goud.id })));
  assert.equal(ja.status, 200);
  const jaDat = await ja.json();
  assert.equal(jaDat.gekozenSkin, goud.id);
  assert.ok(!('skinGeweigerd' in jaDat));
  assert.equal((await (await metRol('planner', () => h(get()))).json()).gekozenSkin, goud.id);
});

test('een ontgrendelde skin blijft ontgrendeld en blijft kiesbaar, ook met een latere lage score', { skip: !goud }, async () => {
  const { h } = opzet();
  await metRol('planner', () => h(post({ score: goud.drempel })));
  const r = await metRol('planner', () => h(post({ score: 1, gekozenSkin: goud.id })));
  assert.equal(r.status, 200);
});

test('een onbekende skin-id weigert de score niet: 200, score bewaard, skin genegeerd (skinGeweigerd)', async () => {
  const { h } = opzet();
  for (const gekozenSkin of ['bestaat-niet', 5, null, {}]) {
    const r = await metRol('planner', () => h(post({ score: 7, gekozenSkin })));
    assert.equal(r.status, 200, JSON.stringify(gekozenSkin));
    const dat = await r.json();
    assert.equal(dat.skinGeweigerd, true);
    assert.equal(dat.besteScore, 7);
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

test('themaBron: krijgt de store en de serverdatum (YYYY-MM-DD, Brussel)', async () => {
  const { h, datums } = opzet();
  await metRol('planner', () => h(get()));
  assert.deepEqual(datums, ['2026-10-31']);
});

test('een themaskin is enkel ontgrendeld als zijn thema op de serverdatum actief is (en blijft daarna ontgrendeld)', async () => {
  const zonder = opzet();
  const r0 = await (await metRol('planner', () => zonder.h(get()))).json();
  assert.ok(!r0.ontgrendeld.includes(themaSkin.id));
  const geweigerd = await metRol('planner', () => zonder.h(post({ score: 1, gekozenSkin: themaSkin.id })));
  assert.equal(geweigerd.status, 200, 'de score telt altijd');
  const gw = await geweigerd.json();
  assert.equal(gw.skinGeweigerd, true);
  assert.equal(gw.besteScore, 1);
  assert.ok(!gw.ontgrendeld.includes(themaSkin.id));

  const echt = maakNepStore({});
  const nepStore = () => echt;
  const actief = maakHandler({ getStore: nepStore, nu: () => NU0, themaBron: bronMet([themaSkin.id]) });
  const uit = maakHandler({ getStore: nepStore, nu: () => NU0, themaBron: bronMet([]) });
  const r1 = await metRol('planner', () => actief(post({ score: 1, gekozenSkin: themaSkin.id })));
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).gekozenSkin, themaSkin.id);
  const later = await (await metRol('planner', () => uit(get()))).json();
  assert.ok(later.ontgrendeld.includes(themaSkin.id), 'eenmaal ontgrendeld blijft ontgrendeld');
  assert.equal(later.gekozenSkin, themaSkin.id);
});

test('een themaskin die bij een GET nieuw open is, wordt meteen bewaard en blijft na het thema', async () => {
  const echt = maakNepStore({});
  const actief = maakHandler({ getStore: () => echt, nu: () => NU0, themaBron: bronMet([themaSkin.id]) });
  const j = await (await metRol('planner', () => actief(get()))).json();
  assert.ok(j.ontgrendeld.includes(themaSkin.id));
  assert.equal(echt._schrijfacties.length, 1);
  assert.ok(JSON.parse(echt._data.get(spelSleutel('test-planner'))).ontgrendeld.includes(themaSkin.id));
  const uit = maakHandler({ getStore: () => echt, nu: () => NU0, themaBron: bronMet([]) });
  assert.ok((await (await metRol('planner', () => uit(get()))).json()).ontgrendeld.includes(themaSkin.id));
});

test('een GET die de themaskin niet kan bewaren, antwoordt toch 200', async () => {
  const echt = maakNepStore({});
  const store = { get: (...a) => echt.get(...a), setJSON: async () => { throw new Error('schrijffout'); } };
  const h = maakHandler({ getStore: () => store, nu: () => NU0, themaBron: bronMet([themaSkin.id]) });
  const r = await metRol('planner', () => h(get()));
  assert.equal(r.status, 200);
  assert.ok((await r.json()).ontgrendeld.includes(themaSkin.id));
});

// Ruling 2 (taak 8): een geldig thema-id in `ontgrendeld` dat de server nu niet kent (bv. de themas-store is leeg of onleesbaar) wordt
// nooit weggegooid: enkel een skin kiezen die de server niet kent, wordt geweigerd.
test('een bewaard thema-id dat de server nu niet kent, blijft in het record (GET en POST), maar kiezen kan niet', async () => {
  const echt = maakNepStore({ [spelSleutel('test-planner')]: { besteScore: 10, schaal: 2, ontgrendeld: ['blitz', 'halloween', 'rommel!'], gekozenSkin: 'blitz' } });
  const h = maakHandler({ getStore: () => echt, nu: () => NU0, themaBron: bronMet([], []) });
  const stand = await (await metRol('planner', () => h(get()))).json();
  assert.ok(stand.ontgrendeld.includes('halloween'), 'het id blijft in het antwoord');
  assert.ok(!stand.ontgrendeld.includes('rommel!'), 'rommel valt wel weg');
  assert.equal(echt._schrijfacties.length, 0, 'een GET schrijft niets');
  const kies = await metRol('planner', () => h(post({ score: 99, gekozenSkin: 'halloween' })));
  assert.equal(kies.status, 200);
  const k = await kies.json();
  assert.equal(k.skinGeweigerd, true, 'de server kan deze skin niet tekenen: kiezen wordt geweigerd');
  assert.equal(k.gekozenSkin, 'blitz');
  assert.equal(k.besteScore, 99);
  const bewaard = JSON.parse(echt._data.get(spelSleutel('test-planner')));
  assert.ok(bewaard.ontgrendeld.includes('halloween'), 'ook na een POST staat het id nog in het bewaarde record');
  assert.ok(!bewaard.ontgrendeld.includes('rommel!'));
});

test('een themaBron die gooit of onzin teruggeeft telt als geen themas (de score en het record blijven werken)', async () => {
  const echt = maakNepStore({ [spelSleutel('test-planner')]: { besteScore: 5, schaal: 2, ontgrendeld: ['blitz', 'kerst'], gekozenSkin: 'blitz' } });
  for (const themaBron of [async () => { throw new Error('x'); }, async () => 'ja', async () => null, async () => ({ skins: 'x', actieveThemaIds: 5 })]) {
    const h = maakHandler({ getStore: () => echt, nu: () => NU0, themaBron });
    const r = await metRol('planner', () => h(get()));
    assert.equal(r.status, 200);
    assert.ok((await r.json()).ontgrendeld.includes('kerst'), 'een bewaard thema-id blijft');
    assert.equal((await metRol('planner', () => h(post({ score: 7 })))).status, 200);
  }
  assert.ok(JSON.parse(echt._data.get(spelSleutel('test-planner'))).ontgrendeld.includes('kerst'));
});

// ---- de echte bron: themas/index + zaaien (de pakketten staan in dezelfde store) ----
test('migratie: een record van v2.2.0 met halloween ontgrendeld en gekozen blijft in november geldig (de skin-id is het thema-id)', async () => {
  const echt = maakNepStore({ [spelSleutel('test-planner')]: { besteScore: 400, schaal: 2, ontgrendeld: ['blitz', 'halloween'], gekozenSkin: 'halloween' } });
  const hNov = maakHandler({ getStore: () => echt, nu: () => NU_15_NOV });
  const stand = await (await metRol('planner', () => hNov(get()))).json();
  assert.ok(stand.ontgrendeld.includes('halloween'));
  assert.equal(stand.gekozenSkin, 'halloween');
  assert.equal(stand.besteScore, 400);
  // een nieuwe inzending behoudt het ook
  const na = await (await metRol('planner', () => hNov(post({ score: 450, gekozenSkin: 'halloween' })))).json();
  assert.equal(na.gekozenSkin, 'halloween');
  assert.ok(!('skinGeweigerd' in na));
  assert.ok(JSON.parse(echt._data.get(spelSleutel('test-planner'))).ontgrendeld.includes('halloween'));
  // in november is kerst nog niet open
  assert.ok(!stand.ontgrendeld.includes('kerst'));
});

test('echte themas-store: op 15 oktober krijgt de speler de Halloween-skin en wordt hij bewaard; op 15 november niet nieuw, maar eenmaal bewaard blijft hij', async () => {
  const echt = maakNepStore({});
  const hOkt = maakHandler({ getStore: () => echt, nu: () => NU_15_OKT });
  const hNov = maakHandler({ getStore: () => echt, nu: () => NU_15_NOV });
  const vers = maakNepStore({});
  const hNovVers = maakHandler({ getStore: () => vers, nu: () => NU_15_NOV });
  assert.ok(!(await (await metRol('planner', () => hNovVers(get()))).json()).ontgrendeld.includes('halloween'), 'in november niet nieuw');
  const okt = await (await metRol('planner', () => hOkt(get()))).json();
  assert.ok(okt.ontgrendeld.includes('halloween'));
  assert.ok(JSON.parse(echt._data.get(spelSleutel('test-planner'))).ontgrendeld.includes('halloween'), 'bewaard');
  assert.ok((await (await metRol('planner', () => hNov(get()))).json()).ontgrendeld.includes('halloween'), 'blijft in november');
});

test('echte themas-store: de eerste lezing zaait de voorgeladen themas (één keer); een volgend verzoek schrijft daarvoor niets meer', async () => {
  const echt = maakNepStore({});
  const h = maakHandler({ getStore: () => echt, nu: () => NU_15_NOV });
  await metRol('planner', () => h(get()));
  const index = await leesIndex(echt);
  assert.ok(index.themas.some((t) => t.id === 'halloween') && index.themas.some((t) => t.id === 'kerst'));
  const schrijfActies = echt._schrijfacties.length;
  assert.ok(schrijfActies > 0);
  await metRol('planner', () => h(get()));
  assert.equal(echt._schrijfacties.length, schrijfActies, 'niets meer gezaaid');
});

test('echte themas-store: een thema dat op 15 oktober uit staat, ontgrendelt niet nieuw (maar wie het al had, houdt het)', async () => {
  const echt = maakNepStore({});
  await zaai(echt);
  const index = await leesIndex(echt);
  const uit = await wijzigThema(echt, { id: 'halloween', aan: false, versie: index.versie });
  assert.equal(uit.ok, true);
  const h = maakHandler({ getStore: () => echt, nu: () => NU_15_OKT });
  const nieuw = await (await metRol('planner', () => h(get()))).json();
  assert.ok(!nieuw.ontgrendeld.includes('halloween'), 'uitgezet: niet nieuw ontgrendeld');
  const poging = await (await metRol('planner', () => h(post({ score: 1, gekozenSkin: 'halloween' })))).json();
  assert.equal(poging.skinGeweigerd, true);
  // een speler die hem al had
  echt._data.set(spelSleutel('test-technieker'), JSON.stringify({ besteScore: 1, schaal: 2, ontgrendeld: ['blitz', 'halloween'], gekozenSkin: 'halloween' }));
  const had = await (await metRol('technieker', () => h(get()))).json();
  assert.ok(had.ontgrendeld.includes('halloween'));
  assert.equal(had.gekozenSkin, 'halloween');
});

test('echte themas-store: een periode-override telt (halloween naar december verschoven: niet open op 15 oktober, wel op 15 december)', async () => {
  const echt = maakNepStore({});
  await zaai(echt);
  const index = await leesIndex(echt);
  const r = await wijzigThema(echt, { id: 'halloween', periode: { van: { maand: 12, dag: 10 }, tot: { maand: 12, dag: 20 } }, versie: index.versie });
  assert.equal(r.ok, true);
  const okt = maakHandler({ getStore: () => echt, nu: () => NU_15_OKT });
  const dec = maakHandler({ getStore: () => echt, nu: () => NU_15_DEC });
  assert.ok(!(await (await metRol('planner', () => okt(get()))).json()).ontgrendeld.includes('halloween'));
  assert.ok((await (await metRol('planner', () => dec(get()))).json()).ontgrendeld.includes('halloween'));
});

test('echte themas-store: POST met gekozenSkin kerst in december (kerst aan) wordt bewaard', async () => {
  const echt = maakNepStore({});
  const h = maakHandler({ getStore: () => echt, nu: () => NU_15_DEC });
  const r = await (await metRol('planner', () => h(post({ score: 3, gekozenSkin: 'kerst' })))).json();
  assert.equal(r.gekozenSkin, 'kerst');
  assert.ok(r.ontgrendeld.includes('kerst'));
  assert.ok(!('skinGeweigerd' in r));
  assert.equal(JSON.parse(echt._data.get(spelSleutel('test-planner'))).gekozenSkin, 'kerst');
  assert.equal((await (await metRol('planner', () => h(get()))).json()).gekozenSkin, 'kerst');
});

test('echte themas-store: een thema-skin dat geen thema is (onbekend id) wordt geweigerd; een kapotte indexregel verstoort niets', async () => {
  const echt = maakNepStore({});
  await zaai(echt);
  const index = await leesIndex(echt);
  index.themas.push({ id: 'kapot', naam: 'Kapot', aan: true, periode: { van: 'x', tot: 'y' }, periodeOverride: null, pakketHash: 'h' });
  echt._data.set(INDEX_SLEUTEL, JSON.stringify(index));
  const h = maakHandler({ getStore: () => echt, nu: () => NU_15_OKT });
  const r = await metRol('planner', () => h(post({ score: 2, gekozenSkin: 'bestaat-niet' })));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.skinGeweigerd, true);
  assert.ok(j.ontgrendeld.includes('halloween'), 'de gezonde indexregels werken gewoon');
});

test('een inzending boven 2 kB (content-length) wordt geweigerd met 413 en schrijft niets', async () => {
  const { h, echt, test } = opzet();
  const r = await metRol('planner', () => h(post({ score: 1, vul: 'x'.repeat(3000) })));
  assert.equal(r.status, 413);
  assert.equal(echt._schrijfacties.length + test._schrijfacties.length, 0);
  assert.equal((await metRol('planner', () => h(post({ score: 1 })))).status, 200);
});

// ---- lib ----
test('lib: valideerInzending', () => {
  assert.deepEqual(valideerInzending({ score: 10 }), { score: 10, gekozenSkin: undefined });
  // met een lijst skins (de basis plus de themaskins die de server kent): een themaskin is een geldige keuze, een onbekende niet
  assert.deepEqual(valideerInzending({ score: 10, gekozenSkin: 'kerst' }, THEMA_SKINS), { score: 10, gekozenSkin: 'kerst' });
  assert.deepEqual(valideerInzending({ score: 10, gekozenSkin: 'kerst' }), { score: 10, gekozenSkin: undefined, skinGeweigerd: true }, 'zonder lijst kent de server enkel de basis');
  assert.ok(valideerInzending({ score: -1 }).fout);
  assert.ok(valideerInzending(null).fout);
  // Onbekende skin: geen fout (de score telt), de skin wordt genegeerd (I3).
  assert.deepEqual(valideerInzending({ score: 1, gekozenSkin: 'nietbestaand' }), { score: 1, gekozenSkin: undefined, skinGeweigerd: true });
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

test('schaal 2: een record van v2.1.0 (zonder schaal) wordt gedeeld door 4, de skins blijven, en het nieuwe record draagt schaal 2', async () => {
  const { echt, h } = opzet();
  echt._data.set(spelSleutel('test-planner'), JSON.stringify({ besteScore: 2001, ontgrendeld: [standaardSkin(), 'olijf', 'nachtblauw', 'bordeaux'], gekozenSkin: 'bordeaux' }));
  const gelezen = await (await metRol('planner', () => h(get()))).json();
  assert.equal(gelezen.besteScore, 500);
  assert.ok(gelezen.ontgrendeld.includes('bordeaux') && gelezen.ontgrendeld.includes('nachtblauw'), 'eerder ontgrendeld blijft');
  assert.equal(gelezen.gekozenSkin, 'bordeaux');
  const na = await (await metRol('planner', () => h(post({ score: 100 })))).json();
  assert.equal(na.besteScore, 500, 'omgerekend, niet het oude getal');
  const opgeslagen = JSON.parse(echt._data.get(spelSleutel('test-planner')));
  assert.equal(opgeslagen.schaal, 2);
  assert.equal(opgeslagen.besteScore, 500);
  // Een tweede lezing deelt NIET nogmaals.
  assert.equal((await (await metRol('planner', () => h(get()))).json()).besteScore, 500);
});

test('schaal 2: een nieuw record zonder eerdere data krijgt schaal 2 en de score blijft zoals ingezonden', async () => {
  const { echt, h } = opzet();
  await metRol('planner', () => h(post({ score: 777 })));
  const opgeslagen = JSON.parse(echt._data.get(spelSleutel('test-planner')));
  assert.equal(opgeslagen.schaal, 2);
  assert.equal(opgeslagen.besteScore, 777);
});
