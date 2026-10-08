// tests/server-instellingen.test.mjs — /api/instellingen (instellingen per gebruiker op de server)
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { maakHandler } from '../netlify/functions/instellingen.js';
import {
  schoonInstellingen, leesInstellingen, bewaarInstellingen, overzichtVoor,
} from '../netlify/lib/instellingen.js';
import { RECHTEN } from '../netlify/lib/rechten.js';
import { metRol } from './auth-hulp.mjs';

const NU0 = Date.parse('2026-10-08T10:00:00.000Z');

const lijst = () => [
  { id: 'u-bea', email: 'bea@blitz.test', naam: 'Bea', rol: 'beheerder', actief: true },
  { id: 'u-jan', email: 'jan@blitz.test', naam: 'Jan', rol: 'planner', actief: true },
  { id: 'u-pia', email: 'pia@blitz.test', naam: 'Pia', rol: 'planner', zohoNaam: 'Pia Z', actief: true },
  { id: 'u-tim', email: 'tim@blitz.test', naam: 'Tim', rol: 'technieker', zohoNaam: 'Tim Z', actief: true },
  { id: 'u-tom', email: 'tom@blitz.test', naam: 'Tom', rol: 'technieker', zohoNaam: 'Tom Z', actief: true },
  { id: 'u-weg', email: 'weg@blitz.test', naam: 'Weg', rol: 'technieker', zohoNaam: 'Weg Z', actief: false },
  { id: 'u-zon', email: 'zon@blitz.test', naam: 'Zonder', rol: 'technieker', actief: true },
  { id: 'u-sal', email: 'sal@blitz.test', naam: 'Sal', rol: 'sales', salesNaam: 'Sal V', magAlleSales: false, actief: true },
  { id: 'u-sam', email: 'sam@blitz.test', naam: 'Sam', rol: 'sales', salesNaam: 'Sam V', magAlleSales: true, actief: true },
];

function opzet({ begin = {} } = {}) {
  const echt = maakNepStore({ gebruikers: { versie: 1, gebruikers: lijst() }, ...begin });
  const test = maakNepStore({});
  const getStore = opties => (opties.name === 'blitz-data' ? echt : test);
  return { echt, test, h: maakHandler({ getStore, nu: () => NU0 }) };
}

const geldig = (extra = {}) => ({ startlocatie: 'Gent', duurMinuten: 90, maxPerDag: 5, werkdagen: [1, 2, 3], ...extra });
const req = (methode, { body, zoek = '', headers = {} } = {}) => new Request(`http://localhost/api/instellingen${zoek}`, {
  method: methode,
  headers: { 'content-type': 'application/json', 'x-blitz': '1', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const put = (body, opties = {}) => req('PUT', { body, ...opties });
const get = (zoek = '', opties = {}) => req('GET', { zoek, ...opties });
const blob = async store => store.get('instellingen', { type: 'json' });
const activiteit = async echt => (await echt.get('activiteit/2026-10', { type: 'json' }))?.items ?? [];

// ---------------- rechtenrij ----------------
test('rechtenrij: GET en PUT voor alle vier de rollen, geen DELETE', () => {
  const alle = ['beheerder', 'planner', 'technieker', 'sales'];
  assert.deepEqual([...RECHTEN.instellingen.GET].sort(), [...alle].sort());
  assert.deepEqual([...RECHTEN.instellingen.PUT].sort(), [...alle].sort());
  assert.equal(RECHTEN.instellingen.DELETE, undefined);
});

// ---------------- schoonInstellingen ----------------
test('schoonInstellingen: weigeringen met Nederlandse tekst', () => {
  for (const [veld, waarde, delen] of [
    ['duurMinuten', 10, 'duur'],
    ['werkdagen', [], 'werkdag'],
    ['routeKleur', 'rood', 'kleur'],
    ['maxPerDag', 0, 'dag'],
    ['tijdslotMinuten', 30, 'Tijdslot'],
    ['maxReistijdMin', -1, 'reistijd'],
    ['bezoekDuurMin', 4, 'Bezoek'],
    ['bezoekDuurMin', 481, 'Bezoek'],
  ]) {
    const r = schoonInstellingen({ [veld]: waarde });
    assert.equal(typeof r.fout, 'string', veld);
    assert.match(r.fout, new RegExp(delen, 'i'), veld);
    assert.equal(r.waarden, undefined, veld);
  }
  assert.ok(schoonInstellingen({ duurMinuten: 'veel' }).fout);
  assert.ok(schoonInstellingen({ vanTijd: '8u' }).fout);
  assert.ok(schoonInstellingen({ vanTijd: '17:00', totTijd: '08:00' }).fout);
  assert.ok(schoonInstellingen({ vanTijd: '08:00', totTijd: '17:00', laatsteStart: '18:00' }).fout);
  assert.ok(schoonInstellingen({ werkdagen: [1, 9] }).fout);
  assert.ok(schoonInstellingen({ drukteKleuring: 'ja' }).fout);
  assert.ok(schoonInstellingen(null).fout);
  assert.ok(schoonInstellingen([]).fout);
});

test('schoonInstellingen: laat onbekende velden weg en geeft de geldige velden door (ook bezoekDuurMin)', () => {
  const r = schoonInstellingen({
    startlocatie: '  Gent  ', duurMinuten: 120, maxPerDag: 4, vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00',
    werkdagen: [1, 2, 3, 4, 5], maxReistijdMin: 0, tijdslotMinuten: 180, kaartStijl: 'standaard', routeKleur: '#F59E0B',
    drukteKleuring: false, bezoekDuurMin: 60, sessieVersie: 9, rol: 'beheerder',
  });
  assert.equal(r.fout, undefined);
  assert.deepEqual(r.waarden, {
    startlocatie: 'Gent', duurMinuten: 120, maxPerDag: 4, vanTijd: '08:00', totTijd: '17:00', laatsteStart: '16:00',
    werkdagen: [1, 2, 3, 4, 5], maxReistijdMin: 0, tijdslotMinuten: 180, kaartStijl: 'standaard', routeKleur: '#F59E0B',
    drukteKleuring: false, bezoekDuurMin: 60,
  });
  assert.deepEqual(schoonInstellingen({}).waarden, {});
});

// ---------------- lib ----------------
test('lib: leesInstellingen zonder blob geeft null; bewaarInstellingen voegt per gebruiker samen', async () => {
  const s = maakNepStore({});
  assert.equal(await leesInstellingen(s, 'u-a'), null);
  const r1 = await bewaarInstellingen(s, 'u-a', { duurMinuten: 60 });
  const r2 = await bewaarInstellingen(s, 'u-b', { duurMinuten: 90 });
  assert.ok(r2.versie > r1.versie);
  assert.deepEqual(await leesInstellingen(s, 'u-a'), { duurMinuten: 60 });
  assert.deepEqual(await leesInstellingen(s, 'u-b'), { duurMinuten: 90 });
});

test('lib: gelijktijdige schrijfacties van meerdere gebruikers verliezen elkaar niet (B3)', async () => {
  const s = maakNepStore({});
  await Promise.all(['u-a', 'u-b', 'u-c', 'u-d'].map((id, i) => bewaarInstellingen(s, id, { duurMinuten: 60 + i })));
  const b = await blob(s);
  assert.deepEqual(Object.keys(b.perGebruiker).sort(), ['u-a', 'u-b', 'u-c', 'u-d']);
});

test('lib: bewaarInstellingen faalt gesloten als de terugleescontrole blijft mislukken', async () => {
  const s = maakNepStore({});
  const oorspronkelijk = s.get.bind(s);
  let n = 0;
  s.get = async (k, o) => (k === 'instellingen' && ++n % 2 === 0 ? { versie: 99, perGebruiker: {} } : oorspronkelijk(k, o));
  await assert.rejects(() => bewaarInstellingen(s, 'u-a', { duurMinuten: 60 }));
});

// ---------------- GET eigen ----------------
test('GET eigen zonder blob: instellingen null; PUT eigen dan GET geeft dezelfde instellingen terug', async () => {
  const { h } = opzet();
  const r0 = await metRol('planner', () => h(get()));
  assert.equal(r0.status, 200);
  const j0 = await r0.json();
  assert.equal(j0.instellingen, null);
  const body = { ...geldig(), onbekend: 'weg' };
  const rp = await metRol('planner', () => h(put({ instellingen: body })));
  assert.equal(rp.status, 200);
  const { versie } = await rp.json();
  assert.equal(typeof versie, 'number');
  const j1 = await (await metRol('planner', () => h(get()))).json();
  assert.deepEqual(j1.instellingen, geldig());
  assert.equal(j1.versie, versie);
});

// ---------------- PUT validatie ----------------
test('PUT met ongeldige invoer: 400 met de fouttekst en niets geschreven', async () => {
  const { h, echt } = opzet();
  const fout = schoonInstellingen({ duurMinuten: 10 }).fout;
  const r = await metRol('planner', () => h(put({ instellingen: { duurMinuten: 10 } })));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, fout);
  assert.equal(await blob(echt), null);
  for (const body of [{}, { instellingen: 'x' }, { instellingen: [] }, { instellingen: geldig(), gebruiker: 5 }]) {
    assert.equal((await metRol('planner', () => h(put(body)))).status, 400, JSON.stringify(body));
  }
});

// ---------------- PUT voor een ander ----------------
test('planner PUT voor een technieker: 200, blob-sleutel van die technieker, precies een logregel zonder waarden', async () => {
  const { h, echt } = opzet();
  const r = await metRol('planner', () => h(put({ gebruiker: 'u-tim', instellingen: geldig() })));
  assert.equal(r.status, 200);
  const b = await blob(echt);
  assert.deepEqual(Object.keys(b.perGebruiker), ['u-tim']);
  const log = await activiteit(echt);
  assert.equal(log.length, 1);
  assert.equal(log[0].actie, 'instellingen-gewijzigd');
  assert.equal(log[0].onderwerp, 'u-tim');
  assert.equal(log[0].gebruikerId, 'test-planner');
  for (const veld of ['startlocatie', 'duurMinuten', 'maxPerDag', 'werkdagen']) assert.ok(log[0].details.includes(veld), veld);
  assert.ok(!log[0].details.includes('Gent'));
  assert.ok(!log[0].details.includes('90'));
  // tweede schrijfactie met een gewijzigd veld: enkel dat veld in de details
  await metRol('planner', () => h(put({ gebruiker: 'u-tim', instellingen: geldig({ maxPerDag: 6 }) })));
  const log2 = await activiteit(echt);
  assert.equal(log2.length, 2);
  assert.equal(log2[1].details, 'maxPerDag');
});

test('planner PUT voor een andere planner, een beheerder of een sales: 403; onbekend id: 404', async () => {
  const { h, echt } = opzet();
  for (const doel of ['u-pia', 'u-bea', 'u-sal']) {
    assert.equal((await metRol('planner', () => h(put({ gebruiker: doel, instellingen: geldig() })))).status, 403, doel);
  }
  assert.equal((await metRol('planner', () => h(put({ gebruiker: 'u-bestaatniet', instellingen: geldig() })))).status, 404);
  assert.equal(await blob(echt), null);
  assert.deepEqual(await activiteit(echt), []);
});

test('technieker en sales PUT voor een ander: 403, ook voor een onbekend id (geen lek)', async () => {
  const { h, echt } = opzet();
  for (const rol of ['technieker', 'sales']) {
    for (const doel of ['u-tom', 'u-bea', 'u-bestaatniet']) {
      assert.equal((await metRol(rol, () => h(put({ gebruiker: doel, instellingen: geldig() })))).status, 403, `${rol} -> ${doel}`);
    }
  }
  assert.equal(await blob(echt), null);
});

test('beheerder PUT voor iedereen: 200 met een activiteitregel; onbekend id: 404', async () => {
  const { h, echt } = opzet();
  for (const doel of ['u-tim', 'u-jan', 'u-sal', 'u-bea']) {
    assert.equal((await metRol('beheerder', () => h(put({ gebruiker: doel, instellingen: geldig() })))).status, 200, doel);
  }
  assert.equal((await metRol('beheerder', () => h(put({ gebruiker: 'u-niet', instellingen: geldig() })))).status, 404);
  const log = await activiteit(echt);
  assert.equal(log.length, 4);
  assert.ok(log.every(l => l.actie === 'instellingen-gewijzigd' && l.gebruikerId === 'test-beheerder'));
});

test('een PUT voor jezelf logt niets (ook met gebruiker = eigen id)', async () => {
  const { h, echt } = opzet();
  assert.equal((await metRol('planner', () => h(put({ instellingen: geldig() })))).status, 200);
  assert.equal((await metRol('planner', () => h(put({ gebruiker: 'test-planner', instellingen: geldig() })))).status, 200);
  assert.equal((await metRol('technieker', () => h(put({ instellingen: geldig() })))).status, 200);
  assert.deepEqual(await activiteit(echt), []);
});

test('schrijven voor een technieker wijzigt de sleutel van die technieker en niet de eigen', async () => {
  const { h, echt } = opzet();
  await metRol('planner', () => h(put({ instellingen: geldig({ maxPerDag: 2 }) })));
  await metRol('planner', () => h(put({ gebruiker: 'u-tim', instellingen: geldig({ maxPerDag: 7 }) })));
  const b = await blob(echt);
  assert.equal(b.perGebruiker['test-planner'].maxPerDag, 2);
  assert.equal(b.perGebruiker['u-tim'].maxPerDag, 7);
});

test('testverzoeken: testgebruiker schrijft in blitz-data-test, geen logregel, gebruikers komen uit de echte store', async () => {
  const { h, echt, test } = opzet();
  const headers = { 'x-blitz-test': '1' };
  assert.equal((await metRol('planner', () => h(put({ instellingen: geldig() }, { headers })))).status, 200);
  assert.equal((await metRol('planner', () => h(put({ gebruiker: 'u-tim', instellingen: geldig() }, { headers })))).status, 200);
  assert.equal(await blob(echt), null);
  assert.deepEqual(Object.keys((await blob(test)).perGebruiker).sort(), ['test-planner', 'u-tim']);
  assert.deepEqual(await activiteit(echt), []);
  const j = await (await metRol('planner', () => h(get('', { headers })))).json();
  assert.equal(j.instellingen.maxPerDag, 5);
});

// ---------------- GET ?gebruiker= ----------------
test('GET ?gebruiker=: technieker en planner voor een collega 403, eigen id mag; beheerder voor iedereen, onbekend 404', async () => {
  const { h } = opzet({ begin: { instellingen: { versie: 3, perGebruiker: { 'u-tim': { duurMinuten: 77 } } } } });
  assert.equal((await metRol('technieker', () => h(get('?gebruiker=u-tim')))).status, 403);
  assert.equal((await metRol('technieker', () => h(get('?gebruiker=test-technieker')))).status, 200);
  assert.equal((await metRol('planner', () => h(get('?gebruiker=u-tim')))).status, 403);
  const rb = await metRol('beheerder', () => h(get('?gebruiker=u-tim')));
  assert.equal(rb.status, 200);
  assert.deepEqual(await rb.json(), { versie: 3, instellingen: { duurMinuten: 77 } });
  assert.equal((await metRol('beheerder', () => h(get('?gebruiker=u-niet')))).status, 404);
  assert.equal((await (await metRol('beheerder', () => h(get('?gebruiker=u-jan')))).json()).instellingen, null);
});

test('GET ?gebruiker=: sales met magAlleSales leest een andere sales, nooit een technieker; zonder magAlleSales 403', async () => {
  const { h } = opzet({ begin: { instellingen: { versie: 1, perGebruiker: { 'u-sal': { maxPerDag: 3 }, 'u-tim': { maxPerDag: 9 } } } } });
  const r = await metRol('sales', () => h(get('?gebruiker=u-sal')), { magAlleSales: true });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).instellingen.maxPerDag, 3);
  assert.equal((await metRol('sales', () => h(get('?gebruiker=u-tim')), { magAlleSales: true })).status, 403);
  assert.equal((await metRol('sales', () => h(get('?gebruiker=u-bestaatniet')), { magAlleSales: true })).status, 403);
  assert.equal((await metRol('sales', () => h(get('?gebruiker=u-sal')), { magAlleSales: false })).status, 403);
});

// ---------------- overzicht ----------------
test('overzicht voor planner: eigen + enkel actieve techniekers met zohoNaam, nooit planners of beheerders', async () => {
  const { h } = opzet({ begin: { instellingen: { versie: 4, perGebruiker: {
    'test-planner': { maxPerDag: 1 }, 'u-tim': { maxPerDag: 2 }, 'u-weg': { maxPerDag: 3 }, 'u-jan': { maxPerDag: 4 }, 'u-bea': { maxPerDag: 5 },
  } } } });
  const r = await metRol('planner', () => h(get('?overzicht=1')));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.eigen, { gebruikerId: 'test-planner', versie: 4, instellingen: { maxPerDag: 1 } });
  assert.deepEqual(Object.keys(j.techniekers).sort(), ['Tim Z', 'Tom Z']);
  assert.deepEqual(j.techniekers['Tim Z'], { gebruikerId: 'u-tim', instellingen: { maxPerDag: 2 } });
  assert.deepEqual(j.techniekers['Tom Z'], { gebruikerId: 'u-tom', instellingen: null });
  const tekst = JSON.stringify(j);
  for (const verboden of ['u-jan', 'u-bea', 'u-pia', 'Pia', 'Bea', 'u-weg', 'u-zon', 'u-sal']) assert.ok(!tekst.includes(verboden), verboden);
  // beheerder en technieker zien hetzelfde soort overzicht
  for (const rol of ['beheerder', 'technieker']) {
    const jr = await (await metRol(rol, () => h(get('?overzicht=1')))).json();
    assert.deepEqual(Object.keys(jr.techniekers).sort(), ['Tim Z', 'Tom Z'], rol);
  }
});

test('overzicht voor sales: enkel eigen', async () => {
  const { h } = opzet();
  const r = await metRol('sales', () => h(get('?overzicht=1')));
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(Object.keys(j), ['eigen']);
  assert.equal(j.eigen.gebruikerId, 'test-sales');
  assert.equal(j.eigen.instellingen, null);
});

test('overzichtVoor: gebruikt de gebruikersstore voor de lijst en de verzoekstore voor de instellingen', async () => {
  const instellingenStore = maakNepStore({ instellingen: { versie: 2, perGebruiker: { 'u-tom': { maxPerDag: 8 } } } });
  const authStore = maakNepStore({ gebruikers: { versie: 1, gebruikers: lijst() } });
  const o = await overzichtVoor(instellingenStore, authStore, { id: 'u-jan', rol: 'planner' });
  assert.equal(o.techniekers['Tom Z'].instellingen.maxPerDag, 8);
  assert.equal(o.eigen.gebruikerId, 'u-jan');
});

// ---------------- overig ----------------
test('opslagstoring: PUT geeft 503 en logt niet; methode zonder regel geeft 405', async () => {
  const { echt, h } = opzet();
  const oorspronkelijk = echt.get.bind(echt);
  let n = 0;
  echt.get = async (k, o) => (k === 'instellingen' && ++n % 2 === 0 ? { versie: 99, perGebruiker: {} } : oorspronkelijk(k, o));
  const r = await metRol('beheerder', () => h(put({ gebruiker: 'u-tim', instellingen: geldig() })));
  assert.equal(r.status, 503);
  assert.deepEqual(await activiteit(echt), []);
  const del = await metRol('beheerder', () => h(req('DELETE')));
  assert.equal(del.status, 405);
});
