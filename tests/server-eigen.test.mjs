// tests/server-eigen.test.mjs — een technieker schrijft enkel zijn EIGEN afspraken/verlof, wagenvoorraad en rapporten
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { metRol } from './auth-hulp.mjs';
import { maakHandler as maakAfspraken } from '../netlify/functions/afspraken.js';
import { maakHandler as maakAvailability } from '../netlify/functions/availability.js';
import { maakHandler as maakInventaris } from '../netlify/functions/inventaris.js';
import { maakHandler as maakArchief } from '../netlify/functions/rapport-archief.js';
import { maakHandler as maakVerzonden } from '../netlify/functions/rapport-verzonden.js';

const tim = werk => metRol('technieker', werk, { zohoNaam: 'Tim' });
const planner = werk => metRol('planner', werk);

const req = (pad, methode, body, zoek = '') => new Request(`http://localhost/api/${pad}${zoek}`, {
  method: methode,
  headers: { 'content-type': 'application/json', 'x-blitz': '1' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const blob = (store, sleutel) => store.get(sleutel, { type: 'json' });
const GEEN_RECHT = 'geen-recht';

async function weigert(r) {
  assert.equal(r.status, 403);
  const j = await r.json();
  assert.equal(j.code, GEEN_RECHT);
  assert.equal(typeof j.error, 'string');
}

// ---------------- afspraken ----------------
const afspraak = (id, persoon, extra = {}) => ({ id, titel: `T-${id}`, datum: '2026-10-09', uur: '09:00', persoon, ...extra });
const opzetAfspraken = () => {
  const store = maakNepStore({ afspraken: { versie: 3, afspraken: [
    // oude vorm: zonder alle velden; de opschoning mag dit niet als wijziging laten tellen
    { id: 'a-tim', titel: 'Tim 1', datum: '2026-10-09', persoon: 'Tim' },
    { id: 'a-roel', titel: 'Roel 1', datum: '2026-10-09', persoon: 'Roel' },
    { id: 'a-glob', titel: 'Globaal', datum: '2026-10-10', persoon: null },
  ] } });
  return { store, h: maakAfspraken({ getStore: () => store }) };
};
const put = (afspraken, versie = 3) => req('afspraken', 'PUT', { versie, afspraken });
const huidigeAfspraken = store => blob(store, 'afspraken').then(b => b.afspraken);

test('afspraken: technieker bewaart zijn eigen nieuwe afspraak en laat de rest ongemoeid', async () => {
  const { store, h } = opzetAfspraken();
  const lijst = await huidigeAfspraken(store);
  const r = await tim(() => h(put([...lijst, afspraak('a-nieuw', 'tim ')])));
  assert.equal(r.status, 200);
  assert.equal((await huidigeAfspraken(store)).length, 4);
});

test('afspraken: technieker kan een eigen afspraak wijzigen en verwijderen', async () => {
  const { store, h } = opzetAfspraken();
  const lijst = await huidigeAfspraken(store);
  const wijzig = lijst.map(a => (a.id === 'a-tim' ? { ...a, titel: 'Aangepast' } : a));
  assert.equal((await tim(() => h(put(wijzig)))).status, 200);
  const zonderTim = (await huidigeAfspraken(store)).filter(a => a.id !== 'a-tim');
  assert.equal((await tim(() => h(put(zonderTim, 4)))).status, 200);
  assert.deepEqual((await huidigeAfspraken(store)).map(a => a.id), ['a-roel', 'a-glob']);
});

test('afspraken: collega-afspraak toevoegen, wijzigen of stilletjes verwijderen geeft 403 en laat de blob staan', async () => {
  const { store, h } = opzetAfspraken();
  const voor = JSON.stringify(await blob(store, 'afspraken'));
  const lijst = await huidigeAfspraken(store);
  await weigert(await tim(() => h(put([...lijst, afspraak('a-nep', 'Roel')]))));
  await weigert(await tim(() => h(put(lijst.map(a => (a.id === 'a-roel' ? { ...a, titel: 'Gekaapt' } : a))))));
  await weigert(await tim(() => h(put(lijst.filter(a => a.id !== 'a-roel')))));
  // eigen wijziging met ondertussen een verdwenen collega-afspraak
  await weigert(await tim(() => h(put(lijst.filter(a => a.id !== 'a-roel').map(a => (a.id === 'a-tim' ? { ...a, titel: 'X' } : a))))));
  // globale afspraak (persoon null) en afspraak zonder persoon
  await weigert(await tim(() => h(put(lijst.map(a => (a.id === 'a-glob' ? { ...a, titel: 'X' } : a))))));
  await weigert(await tim(() => h(put([...lijst, afspraak('a-niemand', null)]))));
  assert.equal(JSON.stringify(await blob(store, 'afspraken')), voor);
});

test('afspraken: planner mag alles', async () => {
  const { store, h } = opzetAfspraken();
  const lijst = await huidigeAfspraken(store);
  const r = await planner(() => h(put([...lijst.filter(a => a.id !== 'a-roel'), afspraak('a-nep', 'Roel')])));
  assert.equal(r.status, 200);
});

// ---------------- availability ----------------
const verlof = (id, scope, person, extra = {}) => ({ id, scope, person, date: '2026-10-12', kind: 'fullday', reason: '', ...extra });
const opzetAvailability = () => {
  const store = maakNepStore({ availability: { versie: 2, exceptions: [
    { id: 'v-tim', scope: 'person', person: 'Tim', date: '2026-10-12', kind: 'fullday', from: null, to: null, reason: '' },
    { id: 'v-roel', scope: 'person', person: 'Roel', date: '2026-10-13', kind: 'range', from: '09:00', to: '12:00', reason: 'tandarts' },
    { id: 'v-glob', scope: 'global', person: null, date: '2026-10-14', kind: 'fullday', from: null, to: null, reason: 'feestdag' },
  ] } });
  return { store, h: maakAvailability({ getStore: () => store }) };
};
const putA = (exceptions, versie = 2) => req('availability', 'PUT', { versie, exceptions });
const huidigeVerlof = store => blob(store, 'availability').then(b => b.exceptions);

test('availability: technieker beheert zijn eigen verlof', async () => {
  const { store, h } = opzetAvailability();
  const lijst = await huidigeVerlof(store);
  assert.equal((await tim(() => h(putA([...lijst, verlof('v-nieuw', 'person', 'Tim', { date: '2026-10-20' })])))).status, 200);
  const zonder = (await huidigeVerlof(store)).filter(e => e.id !== 'v-tim');
  assert.equal((await tim(() => h(putA(zonder, 3)))).status, 200);
});

test('availability: verlof van een collega, globale blokkade of verlof zonder naam geeft 403', async () => {
  const { store, h } = opzetAvailability();
  const voor = JSON.stringify(await blob(store, 'availability'));
  const lijst = await huidigeVerlof(store);
  await weigert(await tim(() => h(putA([...lijst, verlof('v-x', 'person', 'Roel')]))));
  await weigert(await tim(() => h(putA([...lijst, verlof('v-g', 'global', null)]))));
  await weigert(await tim(() => h(putA([...lijst, verlof('v-l', 'person', '')]))));
  await weigert(await tim(() => h(putA(lijst.filter(e => e.id !== 'v-roel')))));
  await weigert(await tim(() => h(putA(lijst.filter(e => e.id !== 'v-glob')))));
  await weigert(await tim(() => h(putA(lijst.map(e => (e.id === 'v-roel' ? { ...e, reason: 'x' } : e))))));
  assert.equal(JSON.stringify(await blob(store, 'availability')), voor);
});

test('availability: planner mag een globale blokkade toevoegen', async () => {
  const { store, h } = opzetAvailability();
  const lijst = await huidigeVerlof(store);
  assert.equal((await planner(() => h(putA([...lijst, verlof('v-g', 'global', null)])))).status, 200);
});

// ---------------- inventaris ----------------
const mutatie = (technieker, versie = 0) => req('inventaris', 'POST', {
  versie, technieker, actie: 'mutatie', items: [{ materiaalId: 'm1', materiaalNaam: 'Kabel', aantal: 2 }],
});

test('inventaris: POST voor een andere of lege technieker geeft 403, voor jezelf 200', async () => {
  const store = maakNepStore({});
  const h = maakInventaris({ getStore: () => store });
  await weigert(await tim(() => h(mutatie('Roel'))));
  await weigert(await tim(() => h(mutatie(''))));
  await weigert(await tim(() => h(req('inventaris', 'POST', { versie: 0, actie: 'mutatie', items: [] }))));
  assert.equal(await blob(store, 'inventaris'), null);
  const ok = await tim(() => h(mutatie('Tim')));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).wagenvoorraad.Tim.m1.aantal, 2);
});

test('inventaris: planner boekt voor een willekeurige technieker', async () => {
  const store = maakNepStore({});
  const h = maakInventaris({ getStore: () => store });
  assert.equal((await planner(() => h(mutatie('Roel')))).status, 200);
});

// ---------------- rapport-archief ----------------
const rapport = (id, technieker, extra = {}) => ({
  id, datum: '2026-10-08', aangemaakt: '2026-10-08T08:00:00.000Z', technieker, ticketId: `T${id}`, ticketNumber: `${id}`,
  klant: 'K', adres: 'A', nieuwInter: 'nee', hersteld: 'nee', servicetype: '', facturatie: '', prioriteit: '',
  interventieType: 'Interventie', totaalOnderdelen: 0, rapportData: null, geannuleerd: false, ...extra,
});
const opzetArchief = () => {
  const store = maakNepStore({ rapportlijst: { versie: 5, rapports: [rapport('r-tim', 'Tim'), rapport('r-roel', 'Roel'), rapport('r-leeg', '')] } });
  return { store, h: maakArchief({ getStore: () => store }) };
};
const lijstRapporten = store => blob(store, 'rapportlijst').then(b => b.rapports);
const post = body => req('rapport-archief', 'POST', { versie: 5, ...body });

test('rapport-archief GET: technieker ziet enkel eigen rapporten; planner alles', async () => {
  const { h } = opzetArchief();
  const eigen = await (await tim(() => h(req('rapport-archief', 'GET')))).json();
  assert.deepEqual(eigen.rapports.map(r => r.id), ['r-tim']);
  const alles = await (await planner(() => h(req('rapport-archief', 'GET')))).json();
  assert.equal(alles.rapports.length, 3);
});

test('rapport-archief GET ?id=: rapport van een collega geeft rapport null, eigen rapport komt terug', async () => {
  const { h } = opzetArchief();
  const collega = await (await tim(() => h(req('rapport-archief', 'GET', undefined, '?id=r-roel')))).json();
  assert.equal(collega.rapport, null);
  const eigen = await (await tim(() => h(req('rapport-archief', 'GET', undefined, '?id=r-tim')))).json();
  assert.equal(eigen.rapport.id, 'r-tim');
  const pl = await (await planner(() => h(req('rapport-archief', 'GET', undefined, '?id=r-roel')))).json();
  assert.equal(pl.rapport.id, 'r-roel');
});

test('rapport-archief POST: technieker archiveert enkel voor zichzelf (ook met andere hoofdletters)', async () => {
  const { store, h } = opzetArchief();
  const voor = JSON.stringify(await blob(store, 'rapportlijst'));
  await weigert(await tim(() => h(post({ id: 'n1', technieker: 'Roel', ticketId: 'X1', datum: '2026-10-08' }))));
  await weigert(await tim(() => h(post({ id: 'n2', technieker: '', ticketId: 'X2', datum: '2026-10-08' }))));
  await weigert(await tim(() => h(post({ id: 'n3', ticketId: 'X3', datum: '2026-10-08' }))));
  assert.equal(JSON.stringify(await blob(store, 'rapportlijst')), voor);
  const ok = await tim(() => h(post({ id: 'n4', technieker: 'tim', ticketId: 'X4', datum: '2026-10-08' })));
  assert.equal(ok.status, 200);
  assert.equal((await lijstRapporten(store)).length, 4);
});

test('rapport-archief POST: zelfde ticket+datum als een collega overschrijft het rapport van de collega niet maar komt erbij', async () => {
  const { store, h } = opzetArchief();
  // zelfde ticket+datum als Roels rapport (r-roel: ticketId 'Tr-roel')
  const r = await tim(() => h(post({ id: 'n5', technieker: 'Tim', ticketId: 'Tr-roel', datum: '2026-10-08', klant: 'Tims versie' })));
  assert.equal(r.status, 200);
  const lijst = await lijstRapporten(store);
  assert.equal(lijst.length, 4);
  const roel = lijst.find(x => x.id === 'r-roel');
  assert.equal(roel.technieker, 'Roel');
  assert.equal(roel.klant, 'K');
  const nieuw = lijst.find(x => x.id === 'n5');
  assert.equal(nieuw.technieker, 'Tim');
  assert.equal(nieuw.klant, 'Tims versie');
});

test('rapport-archief POST: planner dedupt wel op het rapport van een collega (ongewijzigd gedrag)', async () => {
  const { store, h } = opzetArchief();
  const r = await planner(() => h(post({ id: 'n7', technieker: 'Roel', ticketId: 'Tr-roel', datum: '2026-10-08', klant: 'Planner' })));
  assert.equal(r.status, 200);
  const lijst = await lijstRapporten(store);
  assert.equal(lijst.length, 3);
  assert.equal(lijst.find(x => x.id === 'n7').klant, 'Planner');
});

test('rapport-archief POST: gelijk id als een collega geeft 403 en laat de blob staan', async () => {
  const { store, h } = opzetArchief();
  const voor = JSON.stringify(await blob(store, 'rapportlijst'));
  await weigert(await tim(() => h(post({ id: 'r-roel', technieker: 'Tim', ticketId: 'ander', datum: '2026-10-08' }))));
  // gecombineerd: eigen entry via ticket+datum als dedup-doel, maar het id van een collega
  await weigert(await tim(() => h(post({ id: 'r-roel', technieker: 'Tim', ticketId: 'Tr-tim', datum: '2026-10-08' }))));
  // collega-ticket+datum (geen dedup voor Tim) met het id van die collega
  await weigert(await tim(() => h(post({ id: 'r-roel', technieker: 'Tim', ticketId: 'Tr-roel', datum: '2026-10-08' }))));
  assert.equal(JSON.stringify(await blob(store, 'rapportlijst')), voor);
});

test('rapport-archief DELETE: bij een dubbel id moeten alle rapporten met dat id eigen zijn', async () => {
  const store = maakNepStore({ rapportlijst: { versie: 5, rapports: [rapport('dubbel', 'Tim'), rapport('dubbel', 'Roel', { ticketId: 'ander' })] } });
  const h = maakArchief({ getStore: () => store });
  await weigert(await tim(() => h(req('rapport-archief', 'DELETE', { id: 'dubbel', versie: 5 }))));
  assert.equal((await lijstRapporten(store)).length, 2);
  assert.equal((await planner(() => h(req('rapport-archief', 'DELETE', { id: 'dubbel', versie: 5 })))).status, 200);
});

test('rapport-archief POST: eigen rapport via ticket+datum bijwerken mag', async () => {
  const { store, h } = opzetArchief();
  const r = await tim(() => h(post({ id: 'r-tim', technieker: 'Tim', ticketId: 'Tr-tim', datum: '2026-10-08', klant: 'Nieuw' })));
  assert.equal(r.status, 200);
  const lijst = await lijstRapporten(store);
  assert.equal(lijst.length, 3);
  assert.equal(lijst.find(x => x.id === 'r-tim').klant, 'Nieuw');
});

test('rapport-archief POST: planner archiveert voor een andere technieker', async () => {
  const { store, h } = opzetArchief();
  const r = await planner(() => h(post({ id: 'n6', technieker: 'Roel', ticketId: 'X6', datum: '2026-10-08' })));
  assert.equal(r.status, 200);
  assert.equal((await lijstRapporten(store)).length, 4);
});

test('rapport-archief DELETE: technieker verwijdert enkel eigen rapporten', async () => {
  const { store, h } = opzetArchief();
  const del = (id, versie) => req('rapport-archief', 'DELETE', { id, versie });
  await weigert(await tim(() => h(del('r-roel', 5))));
  await weigert(await tim(() => h(del('r-leeg', 5))));
  assert.equal((await lijstRapporten(store)).length, 3);
  assert.equal((await tim(() => h(del('r-tim', 5)))).status, 200);
  assert.deepEqual((await lijstRapporten(store)).map(r => r.id), ['r-roel', 'r-leeg']);
  assert.equal((await planner(() => h(del('r-roel', 6)))).status, 200);
});

// ---------------- rapport-verzonden ----------------
test('rapport-verzonden: technieker markeert enkel eigen rapporten', async () => {
  const { store } = opzetArchief();
  const h = maakVerzonden({ getStore: () => store });
  const verzonden = id => req('rapport-verzonden', 'POST', { id, doelgroep: 'klant', tijdstip: '2026-10-08T10:00:00.000Z' });
  await weigert(await tim(() => h(verzonden('r-roel'))));
  assert.equal((await lijstRapporten(store)).find(r => r.id === 'r-roel').verzondenKlant, undefined);
  assert.equal((await tim(() => h(verzonden('r-tim')))).status, 200);
  assert.ok((await lijstRapporten(store)).find(r => r.id === 'r-tim').verzondenKlant);
  assert.equal((await planner(() => h(verzonden('r-roel')))).status, 200);
});
