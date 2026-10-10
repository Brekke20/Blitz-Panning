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
    instellingen: { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 3, maxReistijdMin: 45 },
    depot: { lat: 51.17, lon: 4.33 },
    vandaag: '2026-10-05',
    reistijden: nepReistijden,
    ...extra,
  };
}

const datumsVan = (uitkomst, id) => uitkomst.geplaatst.filter(g => g.ticketId === id).map(g => g.datum);

// ---- tests -----------------------------------------------------------------
test('huidig: vult dagen chronologisch en respecteert maxPerDag', async () => {
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

// gewijzigd door R8: de rit depot → eerste stop telt nu mee in de klok (was 08:00 voor de eerste stop van elke dag);
// volgorde en dagen zijn ongewijzigd, enkel de aankomsttijden schuiven op.
const SNAPSHOT = [
  { ticketId: 't7', datum: '2026-10-05', verwachteAankomst: '08:06' },
  { ticketId: 't1', datum: '2026-10-05', verwachteAankomst: '10:10' },
  { ticketId: 't2', datum: '2026-10-05', verwachteAankomst: '12:16' },
  { ticketId: 't4', datum: '2026-10-06', verwachteAankomst: '08:55' },
  { ticketId: 't3', datum: '2026-10-06', verwachteAankomst: '10:58' },
  { ticketId: 't8', datum: '2026-10-06', verwachteAankomst: '13:01' },
  { ticketId: 't5', datum: '2026-10-07', verwachteAankomst: '09:38' },
  { ticketId: 't6', datum: '2026-10-07', verwachteAankomst: '11:43' },
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
    bestaandPerDag: BESTAAND,
    ...extra,
  });
}
const ids = u => u.geplaatst.map(g => g.ticketId);

test('huidig: te verre kandidaat wordt niet geseed of gevuld na bestaande stop, nabije wel', async () => {
  const u = await planWeek(maakEenDag([VER, NABIJ]));
  assert.deepEqual(ids(u), ['nabij']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]); // gewijzigd door R6: enkel door de afstandsregel geweigerd, geen lege dag → 'te-ver' (was 'geen-plaats')
});

// gewijzigd door R6: een lege Map (uitval) is niet langer fail-open; de 45-min-regel werkt op de schatting km x 1,3
// (Antwerpen -> Hasselt is ~98 geschatte minuten) en er komt een waarschuwing 'reistijd-geschat'.
test('huidig: lege reistijden-Map (fout) → schatting, verre kandidaat wordt geweigerd', async () => {
  const alleen = await planWeek(maakEenDag([VER], { reistijden: async () => new Map() }));
  assert.deepEqual(ids(alleen), []);
  assert.deepEqual(alleen.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]);
  assert.deepEqual(alleen.waarschuwingen, []); // gewijzigd door eindreview: 'reistijd-geschat' enkel voor geplaatste tickets (was ['ver'])
  const u = await planWeek(maakEenDag([VER, NABIJ], { reistijden: async () => new Map() }));
  assert.deepEqual(ids(u), ['nabij']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]);
});

// gewijzigd door R6: een null-cel is niet langer fail-open maar wordt de schatting (waarschuwing 'reistijd-geschat').
test('huidig: null-cel voor de verre kandidaat → schatting, verre kandidaat wordt geweigerd', async () => {
  const reistijden = async (van, naar) => new Map(naar.map(n => [n.id, n.id === 'ver' ? null : 3]));
  const alleen = await planWeek(maakEenDag([VER], { reistijden }));
  assert.deepEqual(ids(alleen), []);
  const u = await planWeek(maakEenDag([VER, NABIJ], { reistijden }));
  assert.deepEqual(ids(u), ['nabij']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]);
  assert.deepEqual(u.waarschuwingen, []); // gewijzigd door eindreview: 'ver' werd niet geplaatst, 'nabij' had een echte reistijd (was ['ver'])
});

test('huidig: fill-lus slaat te verre kandidaat over ten voordele van de volgende binnen 45 min', async () => {
  // Lege dag => seed vrijgesteld (seed = beste score t.o.v. depot). Daarna in de fill-lus
  // sorteert VER (High) vóór FILL (Low), maar VER ligt > 45 min => FILL wordt gekozen.
  const SEED = { id: 'seed', number: '203', priority: 'High', interventieDatum: null, lat: 51.17, lon: 4.33, duurMin: 120 };
  const FILL = { id: 'fill', number: '204', priority: 'Low', interventieDatum: null, lat: 51.35, lon: 4.40, duurMin: 120 }; // ~26 min
  const u = await planWeek(maakEenDag([VER, FILL, SEED], { bestaandPerDag: {} }));
  assert.deepEqual(ids(u), ['seed', 'fill']);
  // gewijzigd door at-plan: de dag had nog plaats (2 van 3) en VER faalde enkel op afstand, dus 'te-ver' (was het misleidende 'geen-plaats').
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]);
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
  kandidaten, dagen: ['2026-10-05'],
  instellingen: { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 1, maxReistijdMin: 45 }, // gewijzigd door R8: maxPerDag telt tickets i.p.v. capPerDag-slots
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
  const u = await planWeek(maakEenDag([laagNabij, hoogVer, middelNabij], { instellingen: { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 2, maxReistijdMin: 45 } })); // gewijzigd door R8: maxPerDag telt ook de bestaande stop
  assert.deepEqual(ids(u), ['nabij']);
});

// ---- R8: tijdlijn per dag ----------------------------------------------------
const EEN = '2026-10-05';
const inst = (extra = {}) => ({ vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 10, maxReistijdMin: 45, ...extra });
const opDepot = { lat: 51.17, lon: 4.33 };
const kand = (id, nr, extra = {}) => ({ ...basisK, id, number: String(nr), priority: 'Medium', lat: 51.17, lon: 4.33, ...extra });
const min = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const geenReis = async () => new Map();
const tijdlijn = (kandidaten, extra = {}) => maakInvoer({
  kandidaten, dagen: [EEN], depot: opDepot, reistijden: geenReis, instellingen: inst(), ...extra,
});

test('tijdlijn: eigen afspraak 10:00–12:00 → geen ticket overlapt, klok springt erover', async () => {
  const ks = [kand('a', 1), kand('b', 2), kand('c', 3), kand('d', 4)];
  const u = await planWeek(tijdlijn(ks, { eigenAfspraken: { [EEN]: [{ uur: '10:00', duurMin: 120, lat: null, lon: null }] } }));
  assert.ok(u.geplaatst.length >= 2);
  for (const g of u.geplaatst) {
    const s = min(g.verwachteAankomst), e = s + 120;
    assert.ok(e <= min('10:00') || s >= min('12:00'), `overlap op ${g.verwachteAankomst}`);
  }
  assert.ok(u.geplaatst.some(g => g.verwachteAankomst === '12:00'));
});

test('tijdlijn: geen verwachteAankomst na 16:00', async () => {
  const ks = Array.from({ length: 12 }, (_, i) => kand('k' + i, i + 1, { duurMin: 60 }));
  const u = await planWeek(tijdlijn(ks));
  assert.ok(u.geplaatst.length > 0);
  for (const g of u.geplaatst) assert.ok(min(g.verwachteAankomst) <= min('16:00'), g.verwachteAankomst);
  assert.equal(u.geplaatst.length, 9); // 08:00 t/m 16:00
});

test('tijdlijn: instellingen zonder laatsteStart gebruikt 16:00', async () => {
  const ks = Array.from({ length: 12 }, (_, i) => kand('k' + i, i + 1, { duurMin: 60 }));
  const { laatsteStart, ...zonder } = inst();
  const u = await planWeek(tijdlijn(ks, { instellingen: zonder }));
  const laatste = Math.max(...u.geplaatst.map(g => min(g.verwachteAankomst)));
  assert.equal(laatste, min('16:00'));
  assert.equal(u.geplaatst.length, 9);
});

test('tijdlijn: voorkeursuur 16:30 wordt toch geplaatst op 16:30', async () => {
  const u = await planWeek(tijdlijn([kand('v', 1)], { klant: { v: { voorkeurTijd: '16:30' } } }));
  assert.deepEqual(u.geplaatst, [{ ticketId: 'v', datum: EEN, verwachteAankomst: '16:30' }]);
});

test('tijdlijn: voorkeursuur 07:00 vóór vanTijd wordt geplaatst indien vrij', async () => {
  const u = await planWeek(tijdlijn([kand('v', 1)], { klant: { v: { voorkeurTijd: '07:00' } } }));
  assert.deepEqual(u.geplaatst, [{ ticketId: 'v', datum: EEN, verwachteAankomst: '07:00' }]);
});

test('tijdlijn: blokkering 08:00–17:00 → niets op die dag, tickets naar volgende dag, planWeek eindigt', async () => {
  const D2 = '2026-10-06';
  const u = await planWeek(tijdlijn([kand('a', 1), kand('b', 2)], {
    dagen: [EEN, D2], blokkeringen: { [EEN]: [{ van: '08:00', tot: '17:00' }] },
  }));
  assert.equal(u.geplaatst.length, 2);
  assert.ok(u.geplaatst.every(g => g.datum === D2));
  assert.deepEqual(u.nietGepland, []);
});

test('tijdlijn: dag volledig bezet door eigen afspraken → niets geplaatst, geen oneindige lus', async () => {
  const u = await planWeek(tijdlijn([kand('a', 1)], {
    eigenAfspraken: { [EEN]: [{ uur: '08:00', duurMin: 240, lat: null, lon: null }, { uur: '12:00', duurMin: 300, lat: null, lon: null }] },
  }));
  assert.deepEqual(u.geplaatst, []);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'a', reden: 'geen-plaats' }]);
});

test('tijdlijn: dag volledig bezet door blokkering → reden geen-plaats', async () => {
  const u = await planWeek(tijdlijn([kand('a', 1)], { blokkeringen: { [EEN]: [{ van: '08:00', tot: '17:00' }] } }));
  assert.deepEqual(u.nietGepland, [{ ticketId: 'a', reden: 'geen-plaats' }]);
});

test('tijdlijn: maxPerDag 2 met 1 bestaande → hoogstens 1 nieuw', async () => {
  const u = await planWeek(tijdlijn([kand('a', 1), kand('b', 2), kand('c', 3)], {
    instellingen: inst({ maxPerDag: 2 }),
    bestaandPerDag: { [EEN]: [{ id: 'x', uur: '08:00', duurMin: 60, lat: null, lon: null }] },
  }));
  assert.equal(u.geplaatst.length, 1);
});

test('tijdlijn: rit depot→eerste stop telt mee in verwachteAankomst', async () => {
  const dertig = async (van, naar) => new Map(naar.map(n => [n.id, 30]));
  const u = await planWeek(tijdlijn([kand('a', 1, { lat: 51.4, lon: 4.6 })], { reistijden: dertig }));
  assert.equal(u.geplaatst[0].verwachteAankomst, '08:30');
});

test('tijdlijn: bestaande stop zonder uur staat vooraan en neemt tijd in', async () => {
  const u = await planWeek(tijdlijn([kand('a', 1)], {
    bestaandPerDag: { [EEN]: [{ id: 'x', uur: null, duurMin: 120, lat: null, lon: null }] },
  }));
  assert.equal(u.geplaatst[0].verwachteAankomst, '10:00');
});

test('reden: ticket met voorkeurTijd dat elke dag botst → vast-uur-botst', async () => {
  const D2 = '2026-10-06';
  const u = await planWeek(tijdlijn([kand('v', 1)], {
    dagen: [EEN, D2], klant: { v: { voorkeurTijd: '10:00' } },
    bestaandPerDag: {
      [EEN]: [{ id: 'x', uur: '09:30', duurMin: 120, lat: null, lon: null }],
      [D2]: [{ id: 'y', uur: '10:00', duurMin: 60, lat: null, lon: null }],
    },
  }));
  assert.deepEqual(u.geplaatst, []);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'v', reden: 'vast-uur-botst' }]);
});

test('reden: alle dagen klant-geblokkeerd → klant-geblokkeerd', async () => {
  const u = await planWeek(tijdlijn([kand('g', 1)], { klant: { g: { geblokkeerd: [EEN] } } }));
  assert.deepEqual(u.nietGepland, [{ ticketId: 'g', reden: 'klant-geblokkeerd' }]);
});

test('reden: week vol → geen-plaats', async () => {
  const u = await planWeek(tijdlijn([kand('a', 1), kand('b', 2)], { instellingen: inst({ maxPerDag: 1 }) }));
  assert.deepEqual(u.nietGepland, [{ ticketId: 'b', reden: 'geen-plaats' }]);
});

test('reden: geblokkeerd op maandag, rest van de week vol → geen-plaats', async () => {
  const vol = { van: '08:00', tot: '17:00' };
  const u = await planWeek(tijdlijn([kand('a', 1)], {
    dagen: DAGEN, klant: { a: { geblokkeerd: [DAGEN[0]] } },
    blokkeringen: Object.fromEntries(DAGEN.slice(1).map(d => [d, [vol]])),
  }));
  assert.deepEqual(u.nietGepland, [{ ticketId: 'a', reden: 'geen-plaats' }]);
});

test('reden: geblokkeerd op alle dagen → klant-geblokkeerd', async () => {
  const u = await planWeek(tijdlijn([kand('a', 1)], { dagen: DAGEN, klant: { a: { geblokkeerd: DAGEN } } }));
  assert.deepEqual(u.nietGepland, [{ ticketId: 'a', reden: 'klant-geblokkeerd' }]);
});

// gewijzigd door R6: kandidaten zonder coordinaten worden nooit geplaatst ('adres-niet-gevonden'); geen crash met depot null.
test('geen coords: depot null en kandidaten zonder coördinaten → geen crash, niets geplaatst, adres-niet-gevonden', async () => {
  const ks = [kand('a', 1, { lat: null, lon: null }), kand('b', 2, { lat: null, lon: null }), kand('c', 3, { lat: null, lon: null })];
  const u = await planWeek(tijdlijn(ks, { depot: null }));
  assert.deepEqual(u.geplaatst, []);
  assert.deepEqual(u.nietGepland.map(n => n.reden), ['adres-niet-gevonden', 'adres-niet-gevonden', 'adres-niet-gevonden']);
});

// ---- R6: afstandsregel, aanvullen, geheugen, schatting ------------------------
const ANT = { lat: 51.2, lon: 4.4 };
const vast = (tabel, std = 3) => async (van, naar) => new Map(naar.map(n => [n.id, tabel[n.id] ?? std]));
const bestaandAnt = (extra = {}) => ({ [EEN]: [{ id: 'x', uur: '08:00', duurMin: 60, ...ANT, ...extra }] });
const mk = (id, nr, extra = {}) => ({ ...basisK, id, number: String(nr), priority: 'Medium', ...ANT, duurMin: 60, ...extra });

test('afstand: twee Hoog-tickets 150 km uit elkaar komen op verschillende dagen', async () => {
  const a = mk('a', 1, { priority: 'High' });
  const b = mk('b', 2, { priority: 'High', lat: 49.85, lon: 4.4 });
  const u = await planWeek(maakInvoer({ kandidaten: [a, b], dagen: ['2026-10-05', '2026-10-06'] }));
  assert.equal(datumsVan(u, 'a')[0], '2026-10-05');
  assert.equal(datumsVan(u, 'b')[0], '2026-10-06');
});

test('afstand: dag met bestaande stop → nieuw ticket op 60 min komt er niet bij, op 30 min wel', async () => {
  const ins = { kandidaten: [mk('n', 1)], dagen: [EEN], bestaandPerDag: bestaandAnt() };
  const ver = await planWeek(maakInvoer({ ...ins, reistijden: vast({ n: 60 }) }));
  assert.deepEqual(ver.geplaatst, []);
  assert.deepEqual(ver.nietGepland, [{ ticketId: 'n', reden: 'te-ver' }]);
  const dicht = await planWeek(maakInvoer({ ...ins, reistijden: vast({ n: 30 }) }));
  assert.deepEqual(ids(dicht), ['n']);
});

test('afstand: starter alleen op lege dag', async () => {
  // dag 1 heeft een bestaande stop in Antwerpen, dag 2 is leeg: het verre Hoog-ticket (hoogste voorrang) mag enkel op dag 2
  const hoogVer = mk('ver', 1, { priority: 'High', lat: 50.93, lon: 5.34 });
  const laagNabij = mk('nabij', 2, { priority: 'Low' });
  const u = await planWeek(maakInvoer({
    kandidaten: [hoogVer, laagNabij], dagen: ['2026-10-05', '2026-10-06'], bestaandPerDag: bestaandAnt(),
    instellingen: inst(),
  }));
  assert.deepEqual(datumsVan(u, 'nabij'), ['2026-10-05']);
  assert.deepEqual(datumsVan(u, 'ver'), ['2026-10-06']);
});

test('aanvullen: Hoog op 40 min wint van Laag op 15 min (40/3 < 15/1)', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('hoog', 1, { priority: 'High' }), mk('laag', 2, { priority: 'Low' })], dagen: [EEN],
    bestaandPerDag: bestaandAnt(), instellingen: inst({ maxPerDag: 2 }), reistijden: vast({ hoog: 40, laag: 15 }),
  }));
  assert.deepEqual(ids(u), ['hoog']);
});

test('aanvullen: Laag op 10 min wint van Hoog op 44 min (10/1 < 44/3)', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('hoog', 1, { priority: 'High' }), mk('laag', 2, { priority: 'Low' })], dagen: [EEN],
    bestaandPerDag: bestaandAnt(), instellingen: inst({ maxPerDag: 2 }), reistijden: vast({ hoog: 44, laag: 10 }),
  }));
  assert.deepEqual(ids(u), ['laag']);
});

test('uitval: reistijden geeft null → 45-min-regel werkt op schatting en waarschuwing reistijd-geschat', async () => {
  const nul = async (van, naar) => new Map(naar.map(n => [n.id, null]));
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('dicht', 1), mk('ver', 2, { lat: 50.93, lon: 5.34 })], dagen: [EEN],
    bestaandPerDag: bestaandAnt(), reistijden: nul,
  }));
  assert.deepEqual(ids(u), ['dicht']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]);
  const w = u.waarschuwingen.find(x => x.soort === 'reistijd-geschat');
  assert.deepEqual(w?.ticketIds, ['dicht']); // gewijzigd door eindreview: enkel geplaatste tickets (was: ook 'ver')
});

test('uitval: reistijden die gooit → schatting i.p.v. crash', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('ver', 1, { lat: 50.93, lon: 5.34 })], dagen: [EEN],
    bestaandPerDag: bestaandAnt(), reistijden: async () => { throw new Error('netwerk'); },
  }));
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]);
});

test('geheugen: zelfde paar wordt niet twee keer opgevraagd', async () => {
  const gezien = new Map();
  const spion = async (van, naar, iso) => {
    for (const n of naar) {
      const k = `${van.lat},${van.lon}|${n.id}|${iso}`;
      gezien.set(k, (gezien.get(k) || 0) + 1);
    }
    return new Map(naar.map(n => [n.id, 5]));
  };
  const ks = Array.from({ length: 6 }, (_, i) => mk('k' + i, i + 1, { priority: i % 2 ? 'High' : 'Low', lat: 51.2 + i * 0.01 }));
  const u = await planWeek(maakInvoer({ kandidaten: ks, dagen: DAGEN.slice(0, 2), reistijden: spion, instellingen: inst({ maxPerDag: 3 }) }));
  assert.ok(u.geplaatst.length >= 4);
  assert.ok(gezien.size > 0);
  for (const [k, n] of gezien) assert.equal(n, 1, `dubbel opgevraagd: ${k}`);
});

test('geen coords: kandidaat zonder lat → adres-niet-gevonden, rest gewoon gepland', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('a', 1), mk('zonder', 2, { lat: null, lon: null }), mk('c', 3)], dagen: [EEN],
  }));
  assert.deepEqual(ids(u).sort(), ['a', 'c']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'zonder', reden: 'adres-niet-gevonden' }]);
});

test('locatie-onbekend: laatste bestaande stop zonder coords → waarschuwing, anker = eerdere stop met coords', async () => {
  const bestaand = { [EEN]: [
    { id: 'a', uur: '08:00', duurMin: 60, ...ANT },
    { id: 'b', uur: '09:00', duurMin: 60, lat: null, lon: null },
  ] };
  // Reistijd wordt gemeten vanaf 'a' (het anker): dicht = 10, ver = 90
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('dicht', 1), mk('ver', 2)], dagen: [EEN], bestaandPerDag: bestaand,
    instellingen: inst({ maxPerDag: 4 }),
    reistijden: async (van, naar) => {
      assert.deepEqual({ lat: van.lat, lon: van.lon }, ANT);
      return new Map(naar.map(n => [n.id, n.id === 'dicht' ? 10 : 90]));
    },
  }));
  assert.deepEqual(ids(u), ['dicht']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]);
  assert.deepEqual(u.waarschuwingen, [{ soort: 'locatie-onbekend', ticketIds: ['b'] }]);
});

test('locatie-onbekend: enkel stops zonder coords → dag geldt als leeg (starter zonder afstandscontrole)', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('ver', 1, { lat: 50.93, lon: 5.34 })], dagen: [EEN],
    bestaandPerDag: { [EEN]: [{ id: 'b', uur: '08:00', duurMin: 60, lat: null, lon: null }] },
    reistijden: vast({ ver: 99 }),
  }));
  assert.deepEqual(ids(u), ['ver']);
  assert.deepEqual(u.waarschuwingen.filter(w => w.soort === 'locatie-onbekend'), []);
});

test('voorkeursuur: 45-min-regel vanaf de stop net vóór het uur', async () => {
  const ins = { dagen: [EEN], bestaandPerDag: bestaandAnt(), klant: { v: { voorkeurTijd: '12:00' } } };
  const dicht = await planWeek(maakInvoer({ ...ins, kandidaten: [mk('v', 1)], reistijden: vast({ v: 30 }) }));
  assert.deepEqual(dicht.geplaatst, [{ ticketId: 'v', datum: EEN, verwachteAankomst: '12:00' }]);
  const ver = await planWeek(maakInvoer({ ...ins, kandidaten: [mk('v', 1)], reistijden: vast({ v: 60 }) }));
  assert.deepEqual(ver.geplaatst, []);
  assert.deepEqual(ver.nietGepland, [{ ticketId: 'v', reden: 'te-ver' }]);
});

test('reden: enkel te ver voor elke niet-lege dag en geen lege dag meer → te-ver', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('ver', 1, { lat: 50.93, lon: 5.34 })], dagen: ['2026-10-05', '2026-10-06'],
    bestaandPerDag: { '2026-10-05': bestaandAnt()[EEN], '2026-10-06': [{ id: 'y', uur: '08:00', duurMin: 60, ...ANT }] },
    reistijden: vast({ ver: 90 }),
  }));
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]);
});

// gewijzigd door at-plan: dag 2 zat niet vol (1 van 2) en 'ver' faalde enkel op afstand t.o.v. de starter → 'te-ver' (was 'geen-plaats').
// 'geen-plaats' blijft voor een lead die kans kreeg op een lege dag die daarna wél vol zat (zie de test 'reden: week vol').
test('reden: te ver op dag 1 en afstand tot de starter op lege dag 2 (dag niet vol) → te-ver', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('hoog', 1, { priority: 'High', lat: 50.93, lon: 5.34 }), mk('ver', 2, { lat: 50.93, lon: 5.34, priority: 'Low' })],
    dagen: ['2026-10-05', '2026-10-06'], bestaandPerDag: bestaandAnt(),
    instellingen: inst({ maxPerDag: 2 }), reistijden: vast({ hoog: 90, ver: 90 }),
  }));
  assert.deepEqual(datumsVan(u, 'hoog'), ['2026-10-06']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'ver', reden: 'te-ver' }]);
});

// ---- R7: voorkeursdag eerst, botsingen ---------------------------------------
test('voorkeursdag: ticket krijgt zijn dag ook als nabije tickets meer zouden passen', async () => {
  const voorkeur = mk('v', 1, { priority: 'Low', lat: 51.3, lon: 4.5 });
  const nabij = [mk('n1', 2, { priority: 'High' }), mk('n2', 3, { priority: 'High' })];
  const u = await planWeek(maakInvoer({
    kandidaten: [...nabij, voorkeur], dagen: [EEN, '2026-10-06'], instellingen: inst({ maxPerDag: 2 }),
    klant: { v: { voorkeur: EEN } }, reistijden: vast({}, 5),
  }));
  assert.deepEqual(datumsVan(u, 'v'), [EEN]);
  assert.equal(u.geplaatst.filter(g => g.datum === EEN).length, 2);
  assert.equal(u.geplaatst.filter(g => g.datum === EEN && g.ticketId.startsWith('n')).length, 1);
  assert.equal(u.geplaatst.filter(g => g.datum === '2026-10-06').length, 1); // de andere nabije schuift door
});

test('voorkeursdag: twee voorkeuren 150 km uit elkaar → hoogste voorrang geplaatst, andere voorkeursdag-afstand', async () => {
  const hoog = mk('hoog', 1, { priority: 'High' });
  const laag = mk('laag', 2, { priority: 'Low', lat: 49.85, lon: 4.4 });
  const u = await planWeek(maakInvoer({
    kandidaten: [laag, hoog], dagen: [EEN, '2026-10-06'],
    klant: { hoog: { voorkeur: EEN }, laag: { voorkeur: EEN } },
  }));
  assert.deepEqual(datumsVan(u, 'hoog'), [EEN]);
  assert.deepEqual(datumsVan(u, 'laag'), []);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'laag', reden: 'voorkeursdag-afstand' }]);
});

test('voorkeursdag: dag vol door blokkering → voorkeursdag-vol', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('v', 1)], dagen: [EEN, '2026-10-06'],
    blokkeringen: { [EEN]: [{ van: '08:00', tot: '17:00' }] },
    klant: { v: { voorkeur: EEN } },
  }));
  assert.deepEqual(u.geplaatst, []);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'v', reden: 'voorkeursdag-vol' }]);
});

test('voorkeursdag: dag vol door maxPerDag → voorkeursdag-vol, en niet op een andere dag', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('a', 1, { priority: 'High' }), mk('b', 2, { priority: 'Low' })], dagen: [EEN, '2026-10-06'],
    instellingen: inst({ maxPerDag: 1 }), klant: { a: { voorkeur: EEN }, b: { voorkeur: EEN } }, reistijden: vast({}, 5),
  }));
  assert.deepEqual(datumsVan(u, 'a'), [EEN]);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'b', reden: 'voorkeursdag-vol' }]);
});

test('voorkeursdag: voorkeursdag op feestdag (niet in dagen) → gewone kandidaat', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('v', 1)], dagen: [EEN, '2026-10-06'], klant: { v: { voorkeur: '2026-10-07' } },
  }));
  assert.deepEqual(datumsVan(u, 'v'), [EEN]);
});

test('voorkeursdag + voorkeursuur: geplaatst op die dag en dat uur; botsing → voorkeursdag-vol; te ver → voorkeursdag-afstand', async () => {
  const ok = await planWeek(maakInvoer({
    kandidaten: [mk('v', 1)], dagen: [EEN, '2026-10-06'], klant: { v: { voorkeur: '2026-10-06', voorkeurTijd: '10:00' } },
  }));
  assert.deepEqual(ok.geplaatst, [{ ticketId: 'v', datum: '2026-10-06', verwachteAankomst: '10:00' }]);
  const botst = await planWeek(maakInvoer({
    kandidaten: [mk('v', 1)], dagen: [EEN, '2026-10-06'], klant: { v: { voorkeur: EEN, voorkeurTijd: '10:00' } },
    bestaandPerDag: { [EEN]: [{ id: 'x', uur: '09:30', duurMin: 120, ...ANT }] },
  }));
  assert.deepEqual(botst.nietGepland, [{ ticketId: 'v', reden: 'voorkeursdag-vol' }]);
  const ver = await planWeek(maakInvoer({
    kandidaten: [mk('v', 1)], dagen: [EEN], klant: { v: { voorkeur: EEN, voorkeurTijd: '12:00' } },
    bestaandPerDag: bestaandAnt(), reistijden: vast({ v: 60 }),
  }));
  assert.deepEqual(ver.nietGepland, [{ ticketId: 'v', reden: 'voorkeursdag-afstand' }]);
});

// ---- R7 fix: voorkeursuur-only tickets zijn gewone kandidaten (R3, spec 3.5) --------
test('voorkeursuur-only: Laag ticket ver weg met uur neemt de lege dag niet af van de Hoog-starter', async () => {
  const hoog = mk('hoog', 1, { priority: 'High' });
  const laag = mk('laag', 2, { priority: 'Low', lat: 50.93, lon: 5.34 });
  const u = await planWeek(maakInvoer({
    kandidaten: [laag, hoog], dagen: [EEN, '2026-10-06'], instellingen: inst({ maxPerDag: 1 }),
    klant: { laag: { voorkeurTijd: '12:00' } }, reistijden: vast({ laag: 90 }, 5),
  }));
  assert.deepEqual(datumsVan(u, 'hoog'), [EEN]);
  assert.deepEqual(u.geplaatst.find(g => g.ticketId === 'laag'), { ticketId: 'laag', datum: '2026-10-06', verwachteAankomst: '12:00' });
});

test('voorkeursuur-only neemt de maxPerDag-plek van een voorkeursdag-ticket niet in', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('w', 1, { priority: 'High' }), mk('v', 2, { priority: 'Low' })], dagen: [EEN],
    instellingen: inst({ maxPerDag: 1 }), klant: { v: { voorkeur: EEN }, w: { voorkeurTijd: '12:00' } }, reistijden: vast({}, 5),
  }));
  assert.deepEqual(ids(u), ['v']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'w', reden: 'geen-plaats' }]);
});

test('voorkeursuur-only als vulling: exact op zijn uur, vrije tickets overlappen er niet mee', async () => {
  const ks = [mk('u', 9, { priority: 'High' }), ...['f1', 'f2', 'f3'].map((id, i) => mk(id, i + 1, { priority: i ? 'Low' : 'High', duurMin: 90 }))];
  const u = await planWeek(maakInvoer({
    kandidaten: ks, dagen: [EEN], instellingen: inst(), klant: { u: { voorkeurTijd: '10:00' } }, reistijden: vast({}, 5),
  }));
  const min = h => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
  assert.equal(u.geplaatst.find(g => g.ticketId === 'u').verwachteAankomst, '10:00');
  const iv = u.geplaatst.map(g => [min(g.verwachteAankomst), min(g.verwachteAankomst) + ks.find(k => k.id === g.ticketId).duurMin]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < iv.length; i++) assert.ok(iv[i][0] >= iv[i - 1][1], JSON.stringify(iv));
  assert.equal(u.geplaatst.length, 4);
});

// ---- eindreview: vooruitcontrole t.o.v. de VOLGENDE stop met locatie ----------------
// Depot Kruibeke, kandidaten in Antwerpen, vaste stop later op de dag in Hasselt (~98 geschatte min).
const HAS = { lat: 50.93, lon: 5.34 };
const BIJ_HAS = { lat: 50.95, lon: 5.30 }; // ~3 km van Hasselt
const aankMin = g => min(g.verwachteAankomst);
// Controleert voor elk geplaatst ticket de rit naar de volgende stop met locatie (bestaand of geplaatst):
// hoogstens maxMin en op tijd (aankomst + duur + rit <= start volgende). Rit = hemelsbreed x 1,3 (zoals nepReistijden).
function controleerVooruit(u, kandidaten, vaste, maxMin = 45) {
  const stops = [
    ...vaste.map(v => ({ id: v.id, s: min(v.uur), lat: v.lat, lon: v.lon })),
    ...u.geplaatst.map(g => {
      const k = kandidaten.find(x => x.id === g.ticketId);
      return { id: k.id, s: aankMin(g), e: aankMin(g) + k.duurMin, lat: k.lat, lon: k.lon };
    }),
  ].sort((a, b) => a.s - b.s);
  for (const g of u.geplaatst) {
    const k = stops.find(x => x.id === g.ticketId);
    const volgende = stops.find(x => x.s >= k.e && x.lat);
    if (!volgende) continue;
    const rit = haversine(k.lat, k.lon, volgende.lat, volgende.lon) * 1.3;
    assert.ok(rit <= maxMin, `${k.id} → ${volgende.id}: ${Math.round(rit)} min rijden`);
    assert.ok(k.e + rit <= volgende.s + 0.5, `${k.id} komt te laat op ${volgende.id}`);
  }
}

test('bestaande 13:00-stop ver weg → geen ochtendticket dat de technieker te laat of >45 min weg maakt', async () => {
  const vaste = [{ id: 'x', uur: '13:00', duurMin: 60, ...HAS }];
  const ks = [mk('a1', 1, { duurMin: 120 }), mk('a2', 2, { duurMin: 120 }), mk('h1', 3, { priority: 'Low', ...BIJ_HAS, duurMin: 60 })];
  const u = await planWeek(maakInvoer({ kandidaten: ks, dagen: [EEN], bestaandPerDag: { [EEN]: vaste }, instellingen: inst() }));
  assert.ok(!ids(u).includes('a1') && !ids(u).includes('a2'), JSON.stringify(u.geplaatst));
  assert.ok(ids(u).includes('h1'), 'ticket vlak bij Hasselt past wel');
  controleerVooruit(u, ks, vaste);
  assert.deepEqual(u.nietGepland.map(n => n.reden), ['te-ver', 'te-ver']);
});

test('vooruitcontrole: vrij ticket moet op tijd bij de volgende vaste stop zijn, anders na die stop', async () => {
  const vaste = { [EEN]: [{ id: 'x', uur: '13:00', duurMin: 60, ...ANT }] };
  const opTijd = await planWeek(maakInvoer({ kandidaten: [mk('a', 1, { duurMin: 240 })], dagen: [EEN], bestaandPerDag: vaste, instellingen: inst(), reistijden: vast({}, 30) }));
  assert.deepEqual(opTijd.geplaatst, [{ ticketId: 'a', datum: EEN, verwachteAankomst: '08:30' }]); // 12:30 + 30 = 13:00: net op tijd
  const teLaat = await planWeek(maakInvoer({ kandidaten: [mk('a', 1, { duurMin: 250 })], dagen: [EEN], bestaandPerDag: vaste, instellingen: inst(), reistijden: vast({}, 30) }));
  assert.deepEqual(teLaat.geplaatst, [{ ticketId: 'a', datum: EEN, verwachteAankomst: '14:30' }]); // 12:40 + 30 > 13:00 → na de stop
});

for (const uur of ['12:00', '14:00']) {
  test(`voorkeursuur-starter ver weg (${uur}) → de rest van de dag blijft binnen 45 min ervan`, async () => {
    const ks = [
      mk('u', 1, { priority: 'High', ...HAS, duurMin: 120 }),
      mk('a1', 2, { priority: 'Low', duurMin: 60 }), mk('a2', 3, { priority: 'Low', duurMin: 60 }),
      mk('h1', 4, { priority: 'Low', ...BIJ_HAS, duurMin: 60 }),
    ];
    const u = await planWeek(maakInvoer({ kandidaten: ks, dagen: [EEN], klant: { u: { voorkeurTijd: uur } }, instellingen: inst() }));
    assert.equal(u.geplaatst.find(g => g.ticketId === 'u')?.verwachteAankomst, uur);
    assert.ok(!ids(u).includes('a1') && !ids(u).includes('a2'), JSON.stringify(u.geplaatst));
    assert.ok(ids(u).includes('h1'));
    controleerVooruit(u, ks, []);
  });
}

test('vooruitcontrole in probeerUur: voorkeursuur-ticket vóór een verre vaste stop → te-ver', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('v', 1, { duurMin: 60 })], dagen: [EEN], klant: { v: { voorkeurTijd: '10:00' } },
    bestaandPerDag: { [EEN]: [{ id: 'x', uur: '13:00', duurMin: 60, ...HAS }] }, instellingen: inst(),
  }));
  assert.deepEqual(u.geplaatst, []);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'v', reden: 'te-ver' }]);
});

test('vooruitcontrole in probeerUur: voorkeursuur-ticket dat de volgende vaste stop niet op tijd haalt → vast-uur-botst', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('v', 1, { duurMin: 120 })], dagen: [EEN], klant: { v: { voorkeurTijd: '11:00' } },
    bestaandPerDag: { [EEN]: [{ id: 'x', uur: '13:00', duurMin: 60, ...ANT }] }, instellingen: inst(), reistijden: vast({}, 30),
  }));
  assert.deepEqual(u.geplaatst, []);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'v', reden: 'vast-uur-botst' }]);
});

test('reistijd-geschat enkel voor tickets die effectief geplaatst werden', async () => {
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('dicht', 1), mk('ver', 2, HAS)], dagen: [EEN], bestaandPerDag: bestaandAnt(), reistijden: async () => new Map(),
  }));
  assert.deepEqual(ids(u), ['dicht']);
  assert.deepEqual(u.waarschuwingen, [{ soort: 'reistijd-geschat', ticketIds: ['dicht'] }]);
});

test('keten: bestaande stop zonder uur die over een blok springt, rekent de rit opnieuw vanaf de positie', async () => {
  // depot → x: 30 min → 08:30 botst met eigen afspraak 08:15–09:00 (zonder locatie) → klok 09:00, rit 30 → x 09:30–10:30
  const u = await planWeek(maakInvoer({
    kandidaten: [mk('a', 1, { duurMin: 60 })], dagen: [EEN], instellingen: inst(), reistijden: vast({}, 30),
    bestaandPerDag: { [EEN]: [{ id: 'x', uur: null, duurMin: 60, ...ANT }] },
    eigenAfspraken: { [EEN]: [{ uur: '08:15', duurMin: 45, lat: null, lon: null }] },
  }));
  assert.deepEqual(u.geplaatst, [{ ticketId: 'a', datum: EEN, verwachteAankomst: '11:00' }]);
});

test('reisMarge: de klok loopt met marge, de maxReistijd-grens blijft op de reistijd zelf', async () => {
  const zonder = await planWeek(maakInvoer());
  const met = await planWeek(maakInvoer({ reisMarge: min => min + 10 }));
  // Geen marge (technieker) = ongewijzigd; met marge komt de eerste aankomst precies 10 min later.
  const uur = u => Number(u.slice(0, 2)) * 60 + Number(u.slice(3));
  const eerste = u => u.geplaatst[0];
  assert.equal(eerste(met).ticketId, eerste(zonder).ticketId);
  assert.equal(uur(eerste(met).verwachteAankomst) - uur(eerste(zonder).verwachteAankomst), 10);
  // Een rit van 40 min (grens 45) blijft toegelaten, ook al is de marge-rit 50 min.
  const stopA = { id: 'a', number: '1', priority: 'Medium', interventieDatum: null, lat: 51.0, lon: 4.0, duurMin: 60 };
  const stopB = { id: 'b', number: '2', priority: 'Medium', interventieDatum: null, lat: 51.3, lon: 4.0, duurMin: 60 };
  const vast = async (van, naar) => new Map(naar.map(n => [n.id, n.id === 'b' ? 40 : 10]));
  const u = await planWeek(maakInvoer({ kandidaten: [stopA, stopB], reistijden: vast, reisMarge: min => min + 10 }));
  assert.equal(u.geplaatst.length, 2);
});
