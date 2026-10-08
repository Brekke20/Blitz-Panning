import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SALES_RESULTATEN, bezoekenVanLead, berekenSales } from '../netlify/lib/dashboard/sales.js';

const NU = '2026-10-10T12:00:00.000Z';
const bezoek = (datum, resultaat, op = `${datum}T10:00:00.000Z`) => ({ datum, resultaat, op });
const lead = (extra = {}) => ({ id: `l${Math.random()}`, status: 'afgewerkt', bezoeken: [], geimporteerdOp: '2026-09-01T08:00:00.000Z', ...extra });
const bevatNaN = v => (typeof v === 'number' ? Number.isNaN(v) : v && typeof v === 'object' ? Object.values(v).some(bevatNaN) : false);
const periode = { van: '2026-10-01', tot: '2026-10-09', nu: NU };
const dagenGeleden = n => new Date(new Date(NU).getTime() - n * 86400000).toISOString();

test('vaste volgorde van resultaten = kleurslots', () => {
  assert.deepEqual(SALES_RESULTATEN, ['offerte', 'verkocht', 'geen-interesse', 'opnieuw']);
});

test('bezoekenVanLead: slotresultaat telt niet dubbel als bezoeken het al bevat', () => {
  const op = '2026-10-06T14:00:00.000Z';
  const dubbel = lead({ bezoeken: [bezoek('2026-10-06', 'verkocht', op)], resultaat: { soort: 'verkocht', op } });
  assert.deepEqual(bezoekenVanLead(dubbel), [{ datum: '2026-10-06', resultaat: 'verkocht', op }]);
  const enkelSlot = lead({ resultaat: { soort: 'offerte', op: '2026-10-07T22:30:00.000Z' } });
  assert.deepEqual(bezoekenVanLead(enkelSlot), [{ datum: '2026-10-08', resultaat: 'offerte', op: '2026-10-07T22:30:00.000Z' }]);
  assert.deepEqual(bezoekenVanLead(lead()), []);
  assert.deepEqual(bezoekenVanLead({}), []);
});

test('bezoekenVanLead: onbekend resultaat valt weg', () => {
  assert.deepEqual(bezoekenVanLead(lead({ bezoeken: [bezoek('2026-10-06', 'iets-anders')] })), []);
});

test('bezoeken buiten de periode tellen niet; week = maandag', () => {
  const s = berekenSales({
    ...periode,
    salesBlobs: [{ verkoper: 'Sofie', leads: [lead({ bezoeken: [
      bezoek('2026-09-30', 'offerte'), bezoek('2026-10-01', 'offerte'), bezoek('2026-10-04', 'verkocht'), // zondag
      bezoek('2026-10-05', 'verkocht'), bezoek('2026-10-09', 'opnieuw'), bezoek('2026-10-10', 'offerte'),
    ] })] }],
  });
  assert.deepEqual(s.perWeek.weken, ['2026-09-28', '2026-10-05']);
  assert.deepEqual(s.perWeek.verkopers, ['Sofie']);
  assert.deepEqual(s.perWeek.waarden, { Sofie: { '2026-09-28': 2, '2026-10-05': 2 } });
  assert.equal(s.resultaten.totaal, 4);
  assert.equal(s.dekking.bezoeken, 4);
});

test('slotresultaat dat enkel in lead.resultaat staat telt wel mee, zonder dubbele telling', () => {
  const op = '2026-10-06T14:00:00.000Z';
  const s = berekenSales({
    ...periode,
    salesBlobs: [{ verkoper: 'Sofie', leads: [
      lead({ bezoeken: [bezoek('2026-10-06', 'verkocht', op)], resultaat: { soort: 'verkocht', op } }),
      lead({ resultaat: { soort: 'offerte', op: '2026-10-07T10:00:00.000Z' } }),
    ] }],
  });
  assert.equal(s.resultaten.totaal, 2);
  assert.deepEqual(s.resultaten.perSoort.map(r => [r.soort, r.n]), [['offerte', 1], ['verkocht', 1], ['geen-interesse', 0], ['opnieuw', 0]]);
});

test('resultaten.perSoort heeft altijd vier rijen in vaste volgorde met percentage', () => {
  const s = berekenSales({
    ...periode,
    salesBlobs: [{ verkoper: 'Sofie', leads: [lead({ bezoeken: [bezoek('2026-10-02', 'offerte'), bezoek('2026-10-03', 'offerte'), bezoek('2026-10-04', 'opnieuw'), bezoek('2026-10-05', 'verkocht')] })] }],
  });
  assert.deepEqual(s.resultaten.perSoort, [
    { soort: 'offerte', n: 2, pct: 50 }, { soort: 'verkocht', n: 1, pct: 25 },
    { soort: 'geen-interesse', n: 0, pct: 0 }, { soort: 'opnieuw', n: 1, pct: 25 },
  ]);
});

test('[RF1] geen sales-blobs: alles nul en lege lijsten, geen NaN', () => {
  const s = berekenSales({ ...periode, salesBlobs: [] });
  assert.deepEqual(s.perWeek, { weken: [], verkopers: [], waarden: {} });
  assert.equal(s.resultaten.totaal, 0);
  assert.deepEqual(s.resultaten.perSoort.map(r => [r.soort, r.n, r.pct]), SALES_RESULTATEN.map(x => [x, 0, 0]));
  assert.deepEqual(s.wachtend, {
    n: 0, zonderDatum: 0, gemDagen: 0, oudsteDagen: 0, buckets: [{ label: '<7d', n: 0 }, { label: '7–14d', n: 0 }, { label: '14–30d', n: 0 }, { label: '>30d', n: 0 }], perVerkoper: [],
  });
  assert.deepEqual(s.dekking, { verkopers: 0, bezoeken: 0 });
  assert.equal(bevatNaN(s), false);
});

test('wachtend: te-plannen vanaf import, 10 dagen valt in 7–14d', () => {
  const s = berekenSales({
    ...periode,
    salesBlobs: [{ verkoper: 'Sofie', leads: [
      lead({ status: 'te-plannen', geimporteerdOp: dagenGeleden(10) }),
      lead({ status: 'voorgesteld', geimporteerdOp: dagenGeleden(40) }),
      lead({ status: 'afgewerkt', geimporteerdOp: dagenGeleden(40) }),
    ] }],
  });
  assert.equal(s.wachtend.n, 1);
  assert.equal(s.wachtend.gemDagen, 10);
  assert.equal(s.wachtend.oudsteDagen, 10);
  assert.deepEqual(s.wachtend.buckets, [{ label: '<7d', n: 0 }, { label: '7–14d', n: 1 }, { label: '14–30d', n: 0 }, { label: '>30d', n: 0 }]);
  assert.deepEqual(s.wachtend.perVerkoper, [{ verkoper: 'Sofie', n: 1 }]);
});

test('wachtend: een recent bezoek (opnieuw langsgaan) zet de wachttijd opnieuw in gang', () => {
  const s = berekenSales({
    ...periode,
    salesBlobs: [{ verkoper: 'Sofie', leads: [
      lead({ status: 'te-plannen', geimporteerdOp: dagenGeleden(60), bezoeken: [bezoek('2026-10-07', 'opnieuw', dagenGeleden(3))] }),
      lead({ status: 'te-plannen', geimporteerdOp: dagenGeleden(35) }),
    ] }, { verkoper: 'Jan', leads: [lead({ status: 'te-plannen', geimporteerdOp: dagenGeleden(20) })] }],
  });
  assert.equal(s.wachtend.n, 3);
  assert.equal(s.wachtend.oudsteDagen, 35);
  assert.equal(s.wachtend.gemDagen, 19.3);
  assert.deepEqual(s.wachtend.buckets.map(b => b.n), [1, 0, 1, 1]);
  assert.deepEqual(s.wachtend.perVerkoper, [{ verkoper: 'Sofie', n: 2 }, { verkoper: 'Jan', n: 1 }]);
});

test('[RF4] verkopersnaam met markup blijft ruwe tekst in de data', () => {
  const s = berekenSales({ ...periode, salesBlobs: [{ verkoper: '<b>Eva</b>', leads: [lead({ bezoeken: [bezoek('2026-10-05', 'offerte')] })] }] });
  assert.deepEqual(s.perWeek.verkopers, ['<b>Eva</b>']);
  assert.equal(s.perWeek.waarden['<b>Eva</b>']['2026-10-05'], 1);
  assert.equal(s.dekking.verkopers, 1);
});

test('week-reeks is aaneensluitend over de periode, ook met een lege week', () => {
  const s = berekenSales({
    van: '2026-09-14', tot: '2026-10-09', nu: NU,
    salesBlobs: [{ verkoper: 'Sofie', leads: [lead({ bezoeken: [bezoek('2026-09-15', 'offerte'), bezoek('2026-10-08', 'verkocht')] })] }],
  });
  assert.deepEqual(s.perWeek.weken, ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
});

test('[fix] wachtend: lead zonder enig tijdstip telt in zonderDatum, niet als 0 of 1970', () => {
  const s = berekenSales({
    ...periode,
    salesBlobs: [{ verkoper: 'Sofie', leads: [
      lead({ status: 'te-plannen', geimporteerdOp: null }),
      lead({ status: 'te-plannen', geimporteerdOp: '' }),
      lead({ status: 'te-plannen', geimporteerdOp: dagenGeleden(10) }),
    ] }],
  });
  assert.equal(s.wachtend.n, 3);
  assert.equal(s.wachtend.zonderDatum, 2);
  assert.equal(s.wachtend.gemDagen, 10);
  assert.equal(s.wachtend.oudsteDagen, 10);
  assert.deepEqual(s.wachtend.buckets.map(b => b.n), [0, 1, 0, 0]);
  assert.deepEqual(s.wachtend.perVerkoper, [{ verkoper: 'Sofie', n: 3 }]);
});

test('[fix] slotresultaat dat milliseconden afwijkt van het bezoek telt toch eenmaal', () => {
  const lead1 = lead({ bezoeken: [bezoek('2026-10-06', 'verkocht', '2026-10-06T14:00:00.000Z')], resultaat: { soort: 'verkocht', op: '2026-10-06T14:00:00.012Z' } });
  assert.equal(bezoekenVanLead(lead1).length, 1);
  // zelfde soort op dezelfde Brusselse dag, andere tijd: ook eenmaal
  const lead2 = lead({ bezoeken: [bezoek('2026-10-06', 'offerte', '2026-10-06T08:00:00.000Z')], resultaat: { soort: 'offerte', op: '2026-10-06T15:00:00.000Z' } });
  assert.equal(bezoekenVanLead(lead2).length, 1);
  // binnen 5 minuten over middernacht heen: ook eenmaal
  const lead3 = lead({ bezoeken: [bezoek('2026-10-06', 'offerte', '2026-10-06T21:59:00.000Z')], resultaat: { soort: 'offerte', op: '2026-10-06T22:01:00.000Z' } });
  assert.equal(bezoekenVanLead(lead3).length, 1);
  // ander resultaat of andere dag: wel apart
  const lead4 = lead({ bezoeken: [bezoek('2026-10-06', 'opnieuw', '2026-10-06T08:00:00.000Z')], resultaat: { soort: 'verkocht', op: '2026-10-06T08:00:00.012Z' } });
  assert.equal(bezoekenVanLead(lead4).length, 2);
  const lead5 = lead({ bezoeken: [bezoek('2026-10-05', 'opnieuw', '2026-10-05T08:00:00.000Z')], resultaat: { soort: 'opnieuw', op: '2026-10-07T08:00:00.000Z' } });
  assert.equal(bezoekenVanLead(lead5).length, 2);
});

test('[fix] verkoper met de naam __proto__ vervuilt niets', () => {
  const s = berekenSales({ ...periode, salesBlobs: [{ verkoper: '__proto__', leads: [lead({ bezoeken: [bezoek('2026-10-05', 'offerte')] })] }] });
  assert.deepEqual(Object.keys(s.perWeek.waarden), ['__proto__']);
  assert.equal(Object.getPrototypeOf(s.perWeek.waarden), Object.prototype);
  assert.equal({}.offerte, undefined);
});
