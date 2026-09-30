import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeek, haversine, bouwDagen, voorrang } from '../public/js/planner.js';

// ---- hulpfuncties ----------------------------------------------------------
const nepReistijden = async (van, naar) =>
  new Map(naar.map(n => [n.id, haversine(van.lat, van.lon, n.lat, n.lon) * 1.3]));

const DAGEN = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];

// Verzonnen coordinaten rond Antwerpen / Gent / Hasselt
const KANDIDATEN = [
  { id: 't1', number: '101', priority: 'High',   interventieDatum: '2026-10-08', lat: 51.22, lon: 4.40, duurMin: 120 },
  { id: 't2', number: '102', priority: 'Medium', interventieDatum: null,         lat: 51.25, lon: 4.45, duurMin: 120 },
  { id: 't3', number: '103', priority: 'Low',    interventieDatum: '2026-10-20', lat: 51.05, lon: 3.72, duurMin: 120 },
  { id: 't4', number: '104', priority: 'High',   interventieDatum: null,         lat: 51.06, lon: 3.75, duurMin: 120 },
  { id: 't5', number: '105', priority: 'Medium', interventieDatum: '2026-10-12', lat: 50.93, lon: 5.34, duurMin: 120 },
  { id: 't6', number: '106', priority: 'Low',    interventieDatum: null,         lat: 50.95, lon: 5.30, duurMin: 120 },
  { id: 't7', number: '107', priority: 'High',   interventieDatum: '2026-10-06', lat: 51.20, lon: 4.38, duurMin: 120 },
  { id: 't8', number: '108', priority: null,     interventieDatum: null,         lat: 51.03, lon: 3.70, duurMin: 120 },
];

function maakInvoer(extra = {}) {
  return {
    kandidaten: KANDIDATEN.map(k => ({ ...k })),
    dagen: DAGEN,
    extraVoor: {},
    bestaandPerDag: {},
    eigenAfspraken: {},
    blokkeringen: {},
    klant: {},
    instellingen: { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 3, maxReistijdMin: 45, duurMinuten: 120 },
    depot: { lat: 51.17, lon: 4.33 },
    vandaag: '2026-10-05',
    reistijden: nepReistijden,
    capPerDag: Object.fromEntries(DAGEN.map(d => [d, 3])),
    ...extra,
  };
}

const datumsVan = (uitkomst, id) => uitkomst.geplaatst.filter(g => g.ticketId === id).map(g => g.datum);

// ---- tests -----------------------------------------------------------------
test('huidig: vult dagen chronologisch en respecteert capPerDag', async () => {
  const u = await planWeek(maakInvoer());
  const perDag = {};
  for (const g of u.geplaatst) perDag[g.datum] = (perDag[g.datum] || 0) + 1;
  for (const aantal of Object.values(perDag)) assert.ok(aantal <= 3);
  assert.equal(u.geplaatst.length + u.nietGepland.length, KANDIDATEN.length);
  const datums = u.geplaatst.map(g => g.datum);
  assert.deepEqual(datums, [...datums].sort());
  assert.ok(u.nietGepland.every(n => n.reden === 'geen-plaats'));
  assert.deepEqual(u.waarschuwingen, []);
});

test('huidig: voorkeursdag-ticket enkel op zijn dag', async () => {
  const u = await planWeek(maakInvoer({ klant: { t5: { voorkeur: '2026-10-07' } } }));
  assert.deepEqual(datumsVan(u, 't5'), ['2026-10-07']);
});

test('huidig: klant-geblokkeerde dag wordt overgeslagen', async () => {
  const basis = await planWeek(maakInvoer());
  const dag = basis.geplaatst.find(g => g.ticketId === 't1').datum;
  const u = await planWeek(maakInvoer({ klant: { t1: { geblokkeerd: [dag] } } }));
  assert.ok(!datumsVan(u, 't1').includes(dag));
});

test('huidig: vast uur botst met bestaande stop', async () => {
  const u = await planWeek(maakInvoer({
    klant: { t2: { voorkeurTijd: '10:00' } },
    bestaandPerDag: { '2026-10-05': [{ id: 'x', uur: '09:30', duurMin: 120, lat: 51.2, lon: 4.4 }] },
  }));
  assert.ok(!datumsVan(u, 't2').includes('2026-10-05'));
});

test('huidig: snapshot', async () => {
  const u = await planWeek(maakInvoer());
  assert.deepEqual(u.geplaatst, SNAPSHOT);
});

const SNAPSHOT = [
  { ticketId: 't7', datum: '2026-10-05', verwachteAankomst: '08:00' },
  { ticketId: 't1', datum: '2026-10-05', verwachteAankomst: '10:03' },
  { ticketId: 't2', datum: '2026-10-05', verwachteAankomst: '12:10' },
  { ticketId: 't4', datum: '2026-10-06', verwachteAankomst: '08:00' },
  { ticketId: 't3', datum: '2026-10-06', verwachteAankomst: '10:03' },
  { ticketId: 't8', datum: '2026-10-06', verwachteAankomst: '12:07' },
  { ticketId: 't5', datum: '2026-10-07', verwachteAankomst: '08:00' },
  { ticketId: 't6', datum: '2026-10-07', verwachteAankomst: '10:05' },
];

// ---- max-reistijd-pad (karakterisatie) -------------------------------------
// Bestaande stop met coords op 1 dag => seedExempt=false, dus de 45-min-check geldt al voor de seed.
const VER = { id: 'ver', number: '201', priority: 'High', interventieDatum: null, lat: 50.93, lon: 5.34, duurMin: 120 }; // Hasselt, ~90 min
const NABIJ = { id: 'nabij', number: '202', priority: 'Low', interventieDatum: null, lat: 51.22, lon: 4.40, duurMin: 120 }; // ~3 min
const BESTAAND = { '2026-10-05': [{ id: 'x', uur: '08:00', duurMin: 120, lat: 51.2, lon: 4.4 }] };

function maakEenDag(kandidaten, extra = {}) {
  return maakInvoer({
    kandidaten: kandidaten.map(k => ({ ...k })),
    dagen: ['2026-10-05'],
    capPerDag: { '2026-10-05': 3 },
    bestaandPerDag: BESTAAND,
    ...extra,
  });
}
const ids = u => u.geplaatst.map(g => g.ticketId);

test('huidig: te verre kandidaat wordt niet geseed of gevuld na bestaande stop, nabije wel', async () => {
  const u = await planWeek(maakEenDag([VER, NABIJ]));
  assert.deepEqual(ids(u), ['nabij']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'geen-plaats' }]);
});

test('huidig: lege reistijden-Map (fout) is fail-open, verre kandidaat wordt aanvaard', async () => {
  // als seed (enige kandidaat): zonder fail-open zou VER (~90 min) geweigerd worden
  const alleen = await planWeek(maakEenDag([VER], { reistijden: async () => new Map() }));
  assert.deepEqual(ids(alleen), ['ver']);
  // gewijzigd door R3: seed = VER (High, hoogste voorrang) en wordt fail-open aanvaard; NABIJ volgt in de fill-lus
  const u = await planWeek(maakEenDag([VER, NABIJ], { reistijden: async () => new Map() }));
  assert.deepEqual(ids(u), ['ver', 'nabij']);
  assert.deepEqual(u.nietGepland, []);
});

test('huidig: null-cel voor de verre kandidaat is fail-open, verre kandidaat wordt aanvaard', async () => {
  const reistijden = async (van, naar) => new Map(naar.map(n => [n.id, n.id === 'ver' ? null : 3]));
  const alleen = await planWeek(maakEenDag([VER], { reistijden }));
  assert.deepEqual(ids(alleen), ['ver']);
  // gewijzigd door R3: seed = VER (High, hoogste voorrang), null-cel is fail-open; NABIJ volgt in de fill-lus
  const u = await planWeek(maakEenDag([VER, NABIJ], { reistijden }));
  assert.deepEqual(ids(u), ['ver', 'nabij']);
  assert.deepEqual(u.nietGepland, []);
});

test('huidig: fill-lus slaat te verre kandidaat over ten voordele van de volgende binnen 45 min', async () => {
  // Lege dag => seed vrijgesteld (seed = beste score t.o.v. depot). Daarna in de fill-lus
  // sorteert VER (High) vóór FILL (Low), maar VER ligt > 45 min => FILL wordt gekozen.
  const SEED = { id: 'seed', number: '203', priority: 'High', interventieDatum: null, lat: 51.17, lon: 4.33, duurMin: 120 };
  const FILL = { id: 'fill', number: '204', priority: 'Low', interventieDatum: null, lat: 51.35, lon: 4.40, duurMin: 120 }; // ~26 min
  const u = await planWeek(maakEenDag([VER, FILL, SEED], { bestaandPerDag: {} }));
  assert.deepEqual(ids(u), ['seed', 'fill']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'geen-plaats' }]);
});

// ---- R2: bouwDagen / reikwijdte --------------------------------------------
const WERKDAGEN = [1, 2, 3, 4, 5];

test('bouwDagen: enkel bekeken week vanaf vandaag', () => {
  const r = bouwDagen({ weekStart: '2026-10-05', vandaag: '2026-10-07', werkdagen: WERKDAGEN, uitgesloten: () => false, voorkeuren: [] });
  assert.deepEqual(r.dagen, ['2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(r.extraVoor, {});
});

test('bouwDagen: voorkeursdatum over 3 weken komt erbij als extra dag voor enkel dat ticket', () => {
  const r = bouwDagen({
    weekStart: '2026-10-05', vandaag: '2026-10-05', werkdagen: WERKDAGEN, uitgesloten: () => false,
    voorkeuren: [{ ticketId: 't5', datum: '2026-10-26' }, { ticketId: 't6', datum: '2026-10-07' }, { ticketId: 't7', datum: '2026-10-25' }],
  });
  assert.deepEqual(r.dagen, [...DAGEN, '2026-10-26']); // zondag 25/10 is geen werkdag
  assert.deepEqual(r.extraVoor, { '2026-10-26': ['t5'] });
});

test('bouwDagen: uitgesloten dag valt weg', () => {
  const r = bouwDagen({
    weekStart: '2026-10-05', vandaag: '2026-10-05', werkdagen: WERKDAGEN,
    uitgesloten: d => d === '2026-10-06' || d === '2026-10-26',
    voorkeuren: [{ ticketId: 't5', datum: '2026-10-26' }],
  });
  assert.deepEqual(r.dagen, ['2026-10-05', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(r.extraVoor, {});
});

test('planWeek: op extra dag enkel het voorkeursticket', async () => {
  const EXTRA = '2026-10-26';
  const { dagen, extraVoor } = bouwDagen({
    weekStart: '2026-10-05', vandaag: '2026-10-05', werkdagen: WERKDAGEN, uitgesloten: () => false,
    voorkeuren: [{ ticketId: 't5', datum: EXTRA }],
  });
  const u = await planWeek(maakInvoer({
    dagen, extraVoor,
    klant: { t5: { voorkeur: EXTRA } },
    capPerDag: Object.fromEntries(dagen.map(d => [d, 3])),
  }));
  assert.deepEqual(datumsVan(u, 't5'), [EXTRA]);
  assert.deepEqual(u.geplaatst.filter(g => g.datum === EXTRA).map(g => g.ticketId), ['t5']);
});

// ---- R3: voorrangsscore en starter ------------------------------------------
const V = '2026-10-05';
const vr = (priority, sinds = null, interventieDatum = null) => voorrang({ priority, inPlanningSinds: sinds, interventieDatum }, V);

test('voorrang: High nieuw = 3, Medium nieuw = 2, Low nieuw = 1, leeg = 1', () => {
  assert.equal(vr('High'), 3);
  assert.equal(vr('medium'), 2);
  assert.equal(vr('Low'), 1);
  assert.equal(vr(null), 1);
  assert.equal(vr('iets anders'), 1);
});

test('voorrang: Low 21 dagen = 2.5; Low 60 dagen = 2.5 (plafond)', () => {
  assert.equal(vr('Low', '2026-09-14T08:00:00Z'), 2.5);
  assert.equal(vr('Low', '2026-08-06T08:00:00Z'), 2.5);
});

test('voorrang: Low 7 dagen = 1.5', () => {
  assert.equal(vr('Low', '2026-09-28T08:00:00Z'), 1.5);
});

test('voorrang: achterstallige interventieDatum = prio + 1.5', () => {
  assert.equal(vr('Medium', null, '2026-10-04'), 3.5);
  assert.equal(vr('Medium', null, '2026-10-05'), 2); // vandaag is nog niet achterstallig
});

test('voorrang: inPlanningSinds null = geen bonus', () => {
  assert.equal(vr('High', null), 3);
});

const dagEen = kandidaten => maakInvoer({
  kandidaten, dagen: ['2026-10-05'], capPerDag: { '2026-10-05': 1 },
});
const basisK = { interventieDatum: null, lat: 51.2, lon: 4.4, duurMin: 120, inPlanningSinds: null };

test('starter: Laag-ticket van 21 dagen wint van nieuw Middel, verliest van nieuw Hoog', async () => {
  const laag = { ...basisK, id: 'laag', number: '1', priority: 'Low', inPlanningSinds: '2026-09-14T08:00:00Z' };
  const middel = { ...basisK, id: 'middel', number: '2', priority: 'Medium' };
  const hoog = { ...basisK, id: 'hoog', number: '3', priority: 'High' };
  assert.deepEqual(ids(await planWeek(dagEen([middel, laag]))), ['laag']);
  assert.deepEqual(ids(await planWeek(dagEen([laag, middel, hoog]))), ['hoog']);
});

test('starter: gelijke voorrang => kortste reistijd vanaf depot, dan laagste ticketnummer', async () => {
  const ver = { ...basisK, id: 'ver', number: '1', priority: 'High', lat: 51.4, lon: 4.6 };
  const nabij = { ...basisK, id: 'nabij', number: '9', priority: 'High', lat: 51.18, lon: 4.34 };
  assert.deepEqual(ids(await planWeek(dagEen([ver, nabij]))), ['nabij']);
  const a = { ...basisK, id: 'a', number: '20', priority: 'High' };
  const b = { ...basisK, id: 'b', number: '3', priority: 'High' };
  assert.deepEqual(ids(await planWeek(dagEen([a, b]))), ['b']);
});

test('starter: tie-break valt terug op hemelsbreed als reistijden ontbreken', async () => {
  const ver = { ...basisK, id: 'ver', number: '1', priority: 'High', lat: 51.4, lon: 4.6 };
  const nabij = { ...basisK, id: 'nabij', number: '9', priority: 'High', lat: 51.18, lon: 4.34 };
  const u = await planWeek({ ...dagEen([ver, nabij]), reistijden: async () => new Map() });
  assert.deepEqual(ids(u), ['nabij']);
});

test('starter: met bestaande stop wint hoogste voorrang die binnen max-reistijd valt', async () => {
  const hoogVer = { ...VER, priority: 'High' };
  const middelNabij = { ...NABIJ, priority: 'Medium' };
  const laagNabij = { ...NABIJ, id: 'laagnabij', number: '203', priority: 'Low' };
  const u = await planWeek(maakEenDag([laagNabij, hoogVer, middelNabij], { capPerDag: { '2026-10-05': 1 } }));
  assert.deepEqual(ids(u), ['nabij']);
});
