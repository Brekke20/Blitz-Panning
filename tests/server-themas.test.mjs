// tests/server-themas.test.mjs — /api/themas (themapakketten: zaaien, upload, aan/uit) + netlify/lib/themas.js
// Nooit echte Zoho/TomTom/mail en nooit echte Blobs: een in-geheugen store; de auth wordt per test gezet (metRol) of geïnjecteerd (maakAuth).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { maakHandler, MAX_BODY } from '../netlify/functions/themas.js';
import { INDEX_SLEUTEL, pakketSleutel, pakketHash, zaai, leesIndex, openbareLijst } from '../netlify/lib/themas.js';
import { VOORGELADEN } from '../netlify/themas/pakketten.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { maakAuth } from '../netlify/lib/auth.js';
import { metRol, metGeenSessie } from './auth-hulp.mjs';
import { wisTestopslag } from '../netlify/lib/testmodus.js';

const echteWinkel = 'blitz-data';
const NU_15_OKT = Date.parse('2026-10-15T10:00:00.000Z');
const NU_25_NOV = Date.parse('2026-11-25T10:00:00.000Z');
const NU_15_FEB = Date.parse('2027-02-15T10:00:00.000Z');

function opzet({ nu = NU_15_OKT, voorgeladen } = {}) {
  const echt = maakNepStore({});
  const test = maakNepStore({});
  const getStore = (o) => (o.name === echteWinkel ? echt : test);
  const h = maakHandler({ getStore, nu: () => nu, ...(voorgeladen ? { voorgeladen } : {}) });
  return { echt, test, h };
}
const req = (methode, { body, headers = {}, ruw, query = '' } = {}) => new Request('http://localhost/api/themas' + query, {
  method: methode,
  headers: { 'content-type': 'application/json', 'x-blitz': '1', ...headers },
  body: ruw ?? (body === undefined ? undefined : JSON.stringify(body)),
});
const get = (query = '', o = {}) => req('GET', { query, ...o });
const post = (body, o = {}) => req('POST', { body, ...o });
const patch = (body, o = {}) => req('PATCH', { body, ...o });
const als = (rol, h, r) => metRol(rol, () => h(r));
const beheer = (h, r) => als('beheerder', h, r);

const kloon = (o) => JSON.parse(JSON.stringify(o));
const pakketVan = (id) => kloon(VOORGELADEN.find((p) => p.id === id));
// Een geldig nieuw pakket: kerst met een andere id, naam en periode.
function nieuwPakket(id = 'lente') {
  const p = pakketVan('kerst');
  p.id = id;
  p.naam = 'Lente';
  p.periode = { van: { maand: 3, dag: 20 }, tot: { maand: 4, dag: 5 } };
  return p;
}
const index = (store) => JSON.parse(store._data.get(INDEX_SLEUTEL));
const logItems = (store) => [...store._data.entries()].filter(([k]) => k.startsWith('activiteit/')).flatMap(([, w]) => JSON.parse(w).items);

// ---- rechten en toegang ----

test('rechtenrij: GET voor alle vier de rollen, POST en PATCH enkel de beheerder, niets anders', () => {
  assert.deepEqual([...RECHTEN.themas.GET].sort(), ['beheerder', 'planner', 'sales', 'technieker']);
  assert.deepEqual([...RECHTEN.themas.POST], ['beheerder']);
  assert.deepEqual([...RECHTEN.themas.PATCH], ['beheerder']);
  assert.equal(RECHTEN.themas.PUT, undefined);
  assert.equal(RECHTEN.themas.DELETE, undefined);
});

test('zonder sessie: 401, en de functie raakt de opslag niet aan', async () => {
  const { h, echt, test } = opzet();
  const r = await metGeenSessie(() => h(get()));
  assert.equal(r.status, 401);
  assert.equal(echt._schrijfacties.length + test._schrijfacties.length, 0);
});

test('GET mag voor alle vier de rollen', async () => {
  const { h } = opzet();
  for (const rol of ['beheerder', 'planner', 'technieker', 'sales']) assert.equal((await als(rol, h, get())).status, 200, rol);
});

test('POST en PATCH als planner, technieker of sales: 403, en er wordt niets geschreven', async () => {
  const { h, echt } = opzet();
  await als('beheerder', h, get()); // zaaien
  const voor = echt._schrijfacties.length;
  for (const rol of ['planner', 'technieker', 'sales']) {
    assert.equal((await als(rol, h, post(nieuwPakket()))).status, 403, `POST ${rol}`);
    assert.equal((await als(rol, h, patch({ id: 'halloween', aan: false, versie: 1 }))).status, 403, `PATCH ${rol}`);
  }
  assert.equal(echt._schrijfacties.length, voor);
});

test('PUT en DELETE: 405', async () => {
  const { h } = opzet();
  assert.equal((await beheer(h, req('PUT', { body: {} }))).status, 405);
  assert.equal((await beheer(h, req('DELETE'))).status, 405);
});

test('schrijven zonder X-Blitz: 1 wordt geweigerd (csrf), met de header lukt het (echte auth-controle, testrol in lokale dev)', async () => {
  const echt = maakNepStore({});
  const auth = maakAuth({ env: { BLITZ_LOKALE_DEV: '1' } });
  const h = maakHandler({ getStore: () => echt, nu: () => NU_15_OKT, auth });
  const koppen = { 'x-blitz-test': '1', 'x-blitz-test-rol': 'beheerder' };
  const zonder = await h(new Request('http://localhost/api/themas', { method: 'POST', headers: { 'content-type': 'application/json', ...koppen }, body: JSON.stringify(nieuwPakket()) }));
  assert.equal(zonder.status, 403);
  assert.equal((await zonder.json()).code, 'csrf');
  assert.equal(echt._schrijfacties.length, 0);
  const met = await h(new Request('http://localhost/api/themas', { method: 'POST', headers: { 'content-type': 'application/json', 'x-blitz': '1', ...koppen }, body: JSON.stringify(nieuwPakket()) }));
  assert.equal(met.status, 200);
});

test('een testverzoek (X-Blitz-Test) gebruikt de teststore voor de thema\'s, nooit de echte', async () => {
  const { h, echt, test } = opzet();
  await als('planner', h, get('', { headers: { 'x-blitz-test': '1' } }));
  assert.equal(echt._schrijfacties.length, 0);
  assert.ok(test._data.has(INDEX_SLEUTEL));
});

// ---- zaaien en lezen ----

test('eerste GET op een lege store zaait halloween en kerst met aan: true', async () => {
  const { h, echt } = opzet();
  const r = await als('planner', h, get());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.themas.map((t) => [t.id, t.aan]), [['halloween', true], ['kerst', true]]);
  assert.equal(typeof j.versie, 'number');
  assert.deepEqual(index(echt).gezaaid.sort(), ['halloween', 'kerst']);
  assert.deepEqual(JSON.parse(echt._data.get(pakketSleutel('kerst'))), pakketVan('kerst'));
  const t = j.themas.find((x) => x.id === 'halloween');
  assert.equal(t.naam, 'Halloween');
  assert.deepEqual(t.periode, pakketVan('halloween').periode);
  assert.equal(t.periodeOverride, null);
  assert.equal(t.pakketHash, pakketHash(pakketVan('halloween')));
});

test('de publieke lijst bevat geen uploadgegevens (geuploadDoor, geuploadOp)', async () => {
  const { h } = opzet();
  await beheer(h, post(nieuwPakket()));
  const tekst = JSON.stringify(await (await als('technieker', h, get())).json());
  assert.ok(!tekst.includes('geuploadDoor') && !tekst.includes('geuploadOp'));
  assert.ok(!tekst.includes('test-beheerder'));
});

test('uit blijft uit: PATCH aan:false, daarna een nieuwe GET zet halloween niet opnieuw aan; een tweede GET zaait niets opnieuw', async () => {
  const { h, echt } = opzet();
  const eerste = await (await als('planner', h, get())).json();
  const p = await beheer(h, patch({ id: 'halloween', aan: false, versie: eerste.versie }));
  assert.equal(p.status, 200);
  const na = await (await als('planner', h, get())).json();
  assert.equal(na.themas.find((t) => t.id === 'halloween').aan, false);
  const gezaaid = index(echt).gezaaid.slice();
  const schrijvenVoor = echt._schrijfacties.length;
  await als('planner', h, get());
  assert.deepEqual(index(echt).gezaaid, gezaaid);
  assert.equal(echt._schrijfacties.length, schrijvenVoor, 'een tweede GET schrijft niets');
});

test('GET op 15 oktober geeft het pakket van halloween, niet dat van kerst; op 25 november ook kerst (binnen 14 dagen van 7 december)', async () => {
  const okt = opzet({ nu: NU_15_OKT });
  const a = await (await als('planner', okt.h, get())).json();
  assert.ok(a.pakketten.halloween);
  assert.ok(!('kerst' in a.pakketten));
  assert.deepEqual(a.pakketten.halloween, pakketVan('halloween'));
  const nov = opzet({ nu: NU_25_NOV });
  const b = await (await als('planner', nov.h, get())).json();
  assert.ok(b.pakketten.kerst);
  assert.ok(!('halloween' in b.pakketten));
  const feb = opzet({ nu: NU_15_FEB });
  assert.deepEqual((await (await als('planner', feb.h, get())).json()).pakketten, {});
});

test('de pakketten van een thema dat uit staat zitten er ook bij (de client beslist met aan)', async () => {
  const { h } = opzet();
  const j0 = await (await als('planner', h, get())).json();
  await beheer(h, patch({ id: 'halloween', aan: false, versie: j0.versie }));
  const j = await (await als('planner', h, get())).json();
  assert.equal(j.themas.find((t) => t.id === 'halloween').aan, false);
  assert.ok(j.pakketten.halloween);
});

test('een override telt mee voor wat actief of nabij is: een periode-override rond 15 februari brengt kerst in de lijst', async () => {
  const { h } = opzet({ nu: NU_15_FEB });
  const j0 = await (await als('planner', h, get())).json();
  const periode = { van: { maand: 2, dag: 10 }, tot: { maand: 2, dag: 20 } };
  assert.equal((await beheer(h, patch({ id: 'kerst', periode, versie: j0.versie }))).status, 200);
  const j = await (await als('planner', h, get())).json();
  assert.ok(j.pakketten.kerst);
  assert.deepEqual(j.themas.find((t) => t.id === 'kerst').periodeOverride, periode);
});

test('GET ?id=kerst geeft het pakket; ?id=bestaatniet geeft 404; een pad-achtige id geeft 404', async () => {
  const { h } = opzet();
  const r = await als('technieker', h, get('?id=kerst'));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), pakketVan('kerst'));
  assert.equal((await als('technieker', h, get('?id=bestaatniet'))).status, 404);
  assert.equal((await als('technieker', h, get('?id=../index'))).status, 404);
  assert.equal((await als('technieker', h, get('?id=__proto__'))).status, 404);
});

test('zaai: enkel id\'s die nog niet in gezaaid staan; een tweede aanroep doet niets', async () => {
  const store = maakNepStore({});
  await zaai(store);
  const na1 = store._schrijfacties.length;
  await zaai(store);
  assert.equal(store._schrijfacties.length, na1);
  const i = await leesIndex(store);
  assert.deepEqual(i.gezaaid.sort(), ['halloween', 'kerst']);
  assert.equal(i.versie, 1);
  // een nieuw voorgeladen pakket komt er later bij, de bestaande blijven zoals ze zijn
  const extra = nieuwPakket('zomer');
  await zaai(store, [...VOORGELADEN, extra]);
  const i2 = await leesIndex(store);
  assert.deepEqual(i2.themas.map((t) => t.id), ['halloween', 'kerst', 'zomer']);
  assert.equal(i2.themas.find((t) => t.id === 'zomer').aan, true);
});

test('een zaaifout (schrijven mislukt) breekt de GET niet: lege lijst, 200', async () => {
  const basis = maakNepStore({});
  const kapot = { ...basis, async setJSON() { throw new Error('geheim detail'); }, async set() { throw new Error('geheim detail'); } };
  const h = maakHandler({ getStore: () => kapot, nu: () => NU_15_OKT });
  const r = await metRol('planner', () => h(get()));
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).themas, []);
});

test('een leesfout van de opslag geeft 503 zonder details; alleen het fouttype wordt gelogd', async () => {
  const getStore = () => ({ get: async () => { throw new Error('geheim detail'); }, setJSON: async () => { throw new Error('geheim'); } });
  const h = maakHandler({ getStore, nu: () => NU_15_OKT });
  const fouten = [];
  const orig = console.error;
  console.error = (...a) => fouten.push(a.join(' '));
  try {
    for (const r of [await metRol('planner', () => h(get())), await metRol('beheerder', () => h(post(nieuwPakket()))), await metRol('beheerder', () => h(patch({ id: 'kerst', aan: false, versie: 1 })))]) {
      assert.equal(r.status, 503);
      const j = await r.json();
      assert.ok(!JSON.stringify(j).includes('geheim'));
      assert.equal(j.code, 'opslag-storing');
    }
  } finally { console.error = orig; }
  assert.ok(fouten.length > 0);
  assert.ok(fouten.every((f) => !f.includes('geheim')), fouten.join('|'));
});

// ---- upload ----

test('POST geldig nieuw pakket: 200, nieuw: true, pakket en index bewaard, activiteit thema-upload', async () => {
  const { h, echt } = opzet();
  const r = await beheer(h, post(nieuwPakket()));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.nieuw, true);
  assert.equal(j.themas.find((t) => t.id === 'lente').aan, true);
  assert.deepEqual(JSON.parse(echt._data.get(pakketSleutel('lente'))), nieuwPakket());
  const item = index(echt).themas.find((t) => t.id === 'lente');
  assert.equal(item.geuploadDoor, 'test-beheerder');
  assert.equal(item.geuploadOp, new Date(NU_15_OKT).toISOString());
  assert.equal(item.pakketHash, pakketHash(JSON.parse(echt._data.get(pakketSleutel('lente')))), 'de hash is die van het bewaarde (gevalideerde) pakket');
  const log = logItems(echt).filter((l) => l.actie === 'thema-upload');
  assert.equal(log.length, 1);
  assert.equal(log[0].onderwerp, 'lente');
  assert.deepEqual(JSON.parse(log[0].details), { id: 'lente', nieuw: true });
  assert.equal(log[0].gebruikerId, 'test-beheerder');
});

test('POST nieuwe versie van halloween: aan en periodeOverride blijven; het id blijft gezaaid (een latere zaai overschrijft de upload niet)', async () => {
  const { h, echt } = opzet();
  const j0 = await (await als('planner', h, get())).json();
  const periode = { van: { maand: 10, dag: 15 }, tot: { maand: 11, dag: 2 } };
  await beheer(h, patch({ id: 'halloween', aan: false, periode, versie: j0.versie }));
  const nieuwer = pakketVan('halloween');
  nieuwer.versie = '2027-01-01';
  nieuwer.naam = 'Halloween 2';
  const r = await beheer(h, post(nieuwer));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).nieuw, false);
  const t = index(echt).themas.find((x) => x.id === 'halloween');
  assert.equal(t.aan, false);
  assert.deepEqual(t.periodeOverride, periode);
  assert.equal(t.naam, 'Halloween 2');
  assert.deepEqual(JSON.parse(echt._data.get(pakketSleutel('halloween'))), nieuwer);
  assert.ok(index(echt).gezaaid.includes('halloween'));
  await als('planner', h, get());
  assert.deepEqual(JSON.parse(echt._data.get(pakketSleutel('halloween'))), nieuwer, 'de upload blijft staan');
  const log = logItems(echt).filter((l) => l.actie === 'thema-upload');
  assert.deepEqual(JSON.parse(log.at(-1).details), { id: 'halloween', nieuw: false });
});

test('POST op een lege store met het id van een voorgeladen pakket: de upload blijft bij een latere zaai staan, halloween wordt wel gezaaid', async () => {
  const { h, echt } = opzet();
  const eigen = pakketVan('kerst');
  eigen.naam = 'Mijn kerst';
  assert.equal((await beheer(h, post(eigen))).status, 200); // POST zaait zelf niet: de index bestaat dan nog niet
  await als('planner', h, get());
  assert.equal(index(echt).themas.find((t) => t.id === 'kerst').naam, 'Mijn kerst');
  assert.equal(JSON.parse(echt._data.get(pakketSleutel('kerst'))).naam, 'Mijn kerst');
  assert.ok(index(echt).themas.some((t) => t.id === 'halloween'));
});

test('POST ongeldig: 422 met { fouten: [{ veld, fout }] } en niets bewaard', async () => {
  const { h, echt } = opzet();
  const slecht = nieuwPakket();
  slecht.periode = { van: { maand: 2, dag: 30 }, tot: { maand: 3, dag: 1 } };
  delete slecht.kleuren;
  const r = await beheer(h, post(slecht));
  assert.equal(r.status, 422);
  const j = await r.json();
  assert.ok(Array.isArray(j.fouten) && j.fouten.length >= 2);
  assert.ok(j.fouten.every((f) => typeof f.veld === 'string' && typeof f.fout === 'string'));
  assert.ok(!echt._data.has(pakketSleutel('lente')));
  assert.equal(logItems(echt).length, 0);
  for (const body of [[], 5, 'x', null]) assert.equal((await beheer(h, post(body))).status, 422, JSON.stringify(body));
});

test('POST: een pakket boven 512 kB wordt door de validator geweigerd op de echte bytes van de tekst (422), ook als de client niets meegeeft', async () => {
  const { h } = opzet();
  const p = nieuwPakket();
  p.naam = 'x'.repeat(525000); // blijft onder MAX_BODY (614400) maar boven 512 kB (524288)
  const r = await beheer(h, post(p));
  assert.equal(r.status, 422);
  assert.ok((await r.json()).fouten.some((f) => f.veld === 'pakket'));
});

test('POST: een body boven MAX_BODY geeft 413, ook zonder content-length-kop en ook als het pakket klein lijkt in tekens', async () => {
  const { h, echt } = opzet();
  assert.equal(MAX_BODY, 614400);
  const groot = JSON.stringify({ ...nieuwPakket(), vul: 'x'.repeat(MAX_BODY) });
  const zonderLengte = new Request('http://localhost/api/themas', { method: 'POST', headers: { 'x-blitz': '1' }, body: new Blob([groot]).stream(), duplex: 'half' });
  assert.equal(zonderLengte.headers.get('content-length'), null);
  assert.equal((await beheer(h, zonderLengte)).status, 413);
  assert.equal((await beheer(h, post(undefined, { ruw: groot }))).status, 413);
  // meerbyte-tekens: weinig tekens, maar meer bytes dan MAX_BODY
  const meerbyte = '"' + '€'.repeat(Math.ceil(MAX_BODY / 3) + 10) + '"';
  assert.ok(meerbyte.length < MAX_BODY && Buffer.byteLength(meerbyte) > MAX_BODY);
  const stroom = new Request('http://localhost/api/themas', { method: 'POST', headers: { 'x-blitz': '1' }, body: new Blob([meerbyte]).stream(), duplex: 'half' });
  assert.equal((await beheer(h, stroom)).status, 413);
  assert.ok(!echt._data.has(pakketSleutel('lente')));
});

test('POST onleesbare JSON: 400', async () => {
  const { h } = opzet();
  assert.equal((await beheer(h, post(undefined, { ruw: '{kapot' }))).status, 400);
  assert.equal((await beheer(h, post(undefined, { ruw: '' }))).status, 400);
});

// ---- wijzigen ----

test('PATCH aan: zet een thema uit en weer aan; versie loopt op; activiteit thema-wijzig met details', async () => {
  const { h, echt } = opzet();
  const j0 = await (await als('planner', h, get())).json();
  const r1 = await beheer(h, patch({ id: 'kerst', aan: false, versie: j0.versie }));
  assert.equal(r1.status, 200);
  const k1 = await r1.json();
  assert.equal(k1.versie, j0.versie + 1);
  assert.equal(k1.themas.find((t) => t.id === 'kerst').aan, false);
  const r2 = await beheer(h, patch({ id: 'kerst', aan: true, versie: k1.versie }));
  assert.equal((await r2.json()).themas.find((t) => t.id === 'kerst').aan, true);
  const log = logItems(echt).filter((l) => l.actie === 'thema-wijzig');
  assert.equal(log.length, 2);
  assert.equal(log[0].onderwerp, 'kerst');
  assert.deepEqual(JSON.parse(log[0].details), { id: 'kerst', aan: false });
});

test('PATCH met een verouderde versie: 409 met serverVersie, niets gewijzigd en niets gelogd', async () => {
  const { h, echt } = opzet();
  const j0 = await (await als('planner', h, get())).json();
  await beheer(h, patch({ id: 'kerst', aan: false, versie: j0.versie }));
  const r = await beheer(h, patch({ id: 'halloween', aan: false, versie: j0.versie }));
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.serverVersie, j0.versie + 1);
  assert.ok(typeof j.error === 'string');
  assert.equal(index(echt).themas.find((t) => t.id === 'halloween').aan, true);
  assert.equal(logItems(echt).filter((l) => l.actie === 'thema-wijzig').length, 1);
});

test('PATCH periode: een geldige override wordt bewaard en periode: null wist hem', async () => {
  const { h, echt } = opzet();
  const j0 = await (await als('planner', h, get())).json();
  const periode = { basis: 'pasen', van: -3, tot: 2 };
  const r1 = await beheer(h, patch({ id: 'halloween', periode, versie: j0.versie }));
  assert.equal(r1.status, 200);
  assert.deepEqual(index(echt).themas.find((t) => t.id === 'halloween').periodeOverride, periode);
  const r2 = await beheer(h, patch({ id: 'halloween', periode: null, versie: (await r1.json()).versie }));
  assert.equal(r2.status, 200);
  assert.equal(index(echt).themas.find((t) => t.id === 'halloween').periodeOverride, null);
  assert.deepEqual(index(echt).themas.find((t) => t.id === 'halloween').periode, pakketVan('halloween').periode, 'de periode van het pakket blijft');
  const log = logItems(echt).filter((l) => l.actie === 'thema-wijzig').map((l) => JSON.parse(l.details));
  assert.deepEqual(log[0], { id: 'halloween', periode });
  assert.deepEqual(log[1], { id: 'halloween', periode: null });
});

test('PATCH met een ongeldige periode, aan of versie: 422; onbekend id: 404; niets te wijzigen: 422', async () => {
  const { h, echt } = opzet();
  const j0 = await (await als('planner', h, get())).json();
  const v = j0.versie;
  const schrijvenVoor = echt._schrijfacties.length;
  const slecht = [
    { id: 'kerst', periode: { van: { maand: 2, dag: 30 }, tot: { maand: 3, dag: 1 } }, versie: v },
    { id: 'kerst', periode: { basis: 'pasen', van: 5, tot: 1 }, versie: v },
    { id: 'kerst', periode: 'nu', versie: v },
    { id: 'kerst', aan: 'ja', versie: v },
    { id: 'kerst', aan: false },
    { id: 'kerst', aan: false, versie: '1' },
    { id: 'kerst', versie: v },
    { aan: false, versie: v },
  ];
  for (const body of slecht) {
    const r = await beheer(h, patch(body));
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.ok(Array.isArray((await r.json()).fouten));
  }
  assert.equal((await beheer(h, patch({ id: 'bestaatniet', aan: false, versie: v }))).status, 404);
  assert.equal((await beheer(h, patch({ id: '__proto__', aan: false, versie: v }))).status, 422, 'een ongeldige id is een fout van de aanvraag');
  assert.equal(echt._schrijfacties.length, schrijvenVoor);
  assert.equal(logItems(echt).length, 0);
});

test('PATCH: onleesbare JSON of een niet-object: 400', async () => {
  const { h } = opzet();
  assert.equal((await beheer(h, patch(undefined, { ruw: '{kapot' }))).status, 400);
  for (const body of [[], 'x', 5, null]) assert.equal((await beheer(h, patch(body))).status, 400, JSON.stringify(body));
});

test('openbareLijst: de lijst toont de effectieve gegevens zonder uploadvelden en met enkel de nabije pakketten', async () => {
  const store = maakNepStore({});
  const idx = await zaai(store);
  const lijst = await openbareLijst(idx, new Date(NU_25_NOV), store);
  assert.deepEqual(Object.keys(lijst).sort(), ['pakketten', 'themas', 'versie']);
  assert.deepEqual(Object.keys(lijst.themas[0]).sort(), ['aan', 'id', 'naam', 'pakketHash', 'periode', 'periodeOverride']);
  assert.deepEqual(Object.keys(lijst.pakketten), ['kerst']);
});

// ---- fix ronde 1 ----

test('testmodus: een upload in de echte store is zichtbaar in een GET in testmodus op een verse teststore (de kopie loopt vóór het zaaien)', async () => {
  const echt = maakNepStore({});
  const test = maakNepStore({});
  const getStore = (o) => (o.name === echteWinkel ? echt : test);
  await wisTestopslag(getStore); // de kopievlag is per proces: terug naar "nog niet gekopieerd"
  const h = maakHandler({ getStore, nu: () => NU_15_OKT });
  const j0 = await (await als('planner', h, get())).json();
  await beheer(h, post(nieuwPakket()));
  await beheer(h, patch({ id: 'halloween', aan: false, versie: j0.versie + 1 }));
  await wisTestopslag(getStore); // verse teststore
  assert.equal(test._data.size, 0);
  const r = await als('planner', h, get('', { headers: { 'x-blitz-test': '1' } }));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.themas.some((t) => t.id === 'lente'), 'de upload staat in de testmodus');
  assert.equal(j.themas.find((t) => t.id === 'halloween').aan, false, 'ook de aan/uit-stand is mee');
  assert.deepEqual(index(test).gezaaid.sort(), ['halloween', 'kerst']);
  assert.ok(test._data.has(pakketSleutel('lente')));
});

test('één kapotte indexregel haalt de lijst niet neer: de gezonde thema’s blijven, de kapotte wordt overgeslagen en enkel het type gemeld', async () => {
  const { h, echt } = opzet();
  await als('planner', h, get()); // zaaien
  const i = index(echt);
  i.themas.push({ id: 'kapot', naam: 'Kapot', aan: true, pakketHash: 'x' }); // geen periode
  i.themas.push({ id: 'kapot2', naam: 'Kapot 2', aan: true, periode: { van: { maand: 'x', dag: 1 }, tot: { maand: 3, dag: 1 } }, pakketHash: 'y' });
  i.themas.push({ id: 'kapot3', naam: 'Kapot 3', aan: true, periode: 5, pakketHash: 'z' });
  echt._data.set(INDEX_SLEUTEL, JSON.stringify(i));
  const fouten = [];
  const orig = console.error;
  console.error = (...a) => fouten.push(a.join(' '));
  let r;
  try { r = await als('technieker', h, get()); } finally { console.error = orig; }
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.themas.map((t) => t.id), ['halloween', 'kerst']);
  assert.ok(j.pakketten.halloween);
  assert.ok(fouten.length >= 3 && fouten.every((f) => /overgeslagen/.test(f) && !f.includes('Kapot')), fouten.join('|'));
});

test('422: een pakket met 30.000 onbekende sleutels geeft hoogstens 50 + 1 foutregels, met veldnamen van hoogstens 120 tekens', async () => {
  const { h } = opzet();
  const p = nieuwPakket();
  for (let n = 0; n < 30000; n++) p['o' + n + 'x'.repeat(n % 100 === 0 ? 200 : 0)] = 1;
  assert.ok(Buffer.byteLength(JSON.stringify(p)) < 524288, 'onder de 512 kB, zodat de validator de sleutels zelf telt');
  const r = await beheer(h, post(p));
  assert.equal(r.status, 422);
  const { fouten } = await r.json();
  assert.equal(fouten.length, 51);
  assert.ok(fouten.every((f) => f.veld.length <= 120));
  assert.match(fouten[50].fout, /^en 29950 andere fouten$/);
  assert.equal(fouten[50].veld, 'pakket');
});
