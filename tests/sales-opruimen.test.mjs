import test from 'node:test';
import assert from 'node:assert/strict';
import { BEWAAR_MAANDEN, laatsteBezoekDatum, ruimOp } from '../netlify/lib/sales-opruimen.js';

const NU = '2026-10-09T03:00:00.000Z';
const lead = (id, extra = {}) => ({
  id, naam: 'Janssens', status: 'afgewerkt', geimporteerdOp: '2024-01-01T08:00:00.000Z', bezoeken: [], ...extra,
});
const bezoek = (datum, extra = {}) => ({ datum, resultaat: 'offerte', op: datum + 'T10:00:00.000Z', ...extra });

test('constante', () => assert.equal(BEWAAR_MAANDEN, 12));

test('laatsteBezoekDatum: max van bezoeken en resultaat.op, anders geimporteerdOp', () => {
  assert.equal(laatsteBezoekDatum(lead('a', { bezoeken: [bezoek('2025-03-01'), bezoek('2025-05-02')] })), '2025-05-02');
  assert.equal(laatsteBezoekDatum(lead('a', {
    bezoeken: [bezoek('2025-03-01')], resultaat: { soort: 'offerte', op: '2025-08-09T12:00:00.000Z' },
  })), '2025-08-09');
  assert.equal(laatsteBezoekDatum(lead('a')), '2024-01-01');
  assert.equal(laatsteBezoekDatum({ id: 'x' }), null);
  assert.equal(laatsteBezoekDatum(null), null);
});

test('afgewerkt, laatste bezoek 12 maanden en 1 dag geleden: gewist; precies 12 maanden: blijft', () => {
  const data = { leads: [
    lead('oud', { bezoeken: [bezoek('2025-10-08')] }),
    lead('grens', { bezoeken: [bezoek('2025-10-09')] }),
  ], blokken: [] };
  const r = ruimOp(data, NU);
  assert.deepEqual(r.gewist, ['oud']);
  assert.deepEqual(r.data.leads.map(l => l.id), ['grens']);
});

test('afgewerkt met recent bezoek maar oud eerste bezoek blijft', () => {
  const data = { leads: [lead('a', { bezoeken: [bezoek('2024-02-01'), bezoek('2026-09-01')] })], blokken: [] };
  assert.deepEqual(ruimOp(data, NU).gewist, []);
});

test('te-plannen lead met enkel oude bezoeken blijft', () => {
  const data = { leads: [lead('a', { status: 'te-plannen', bezoeken: [bezoek('2024-02-01', { resultaat: 'opnieuw' })] })], blokken: [] };
  const r = ruimOp(data, NU);
  assert.deepEqual(r.gewist, []);
  assert.equal(r.data.leads.length, 1);
});

test('resultaat.op nieuwer dan bezoeken telt mee', () => {
  const data = { leads: [lead('a', {
    bezoeken: [bezoek('2024-02-01')], resultaat: { soort: 'offerte', op: '2026-06-01T09:00:00.000Z' },
  })], blokken: [] };
  assert.deepEqual(ruimOp(data, NU).gewist, []);
});

test('zonder bezoeken telt geimporteerdOp', () => {
  const data = { leads: [lead('oud'), lead('nieuw', { geimporteerdOp: '2026-09-01T08:00:00.000Z' })], blokken: [] };
  assert.deepEqual(ruimOp(data, NU).gewist, ['oud']);
});

test('schrikkeldag en maandeinde: 2026-02-28 versus 2025-02-28', () => {
  const nu = '2026-02-28T10:00:00.000Z';
  const data = { leads: [
    lead('een-dag-te-oud', { bezoeken: [bezoek('2025-02-27')] }),
    lead('precies', { bezoeken: [bezoek('2025-02-28')] }),
  ], blokken: [] };
  const r = ruimOp(data, nu);
  assert.deepEqual(r.gewist, ['een-dag-te-oud']);
  // nu op een schrikkeldag: 29 feb 2028 -> grens 28 feb 2027 (dag begrensd op maandeinde)
  const r2 = ruimOp({ leads: [lead('a', { bezoeken: [bezoek('2027-02-28')] }), lead('b', { bezoeken: [bezoek('2027-02-27')] })], blokken: [] }, '2028-02-29T10:00:00.000Z');
  assert.deepEqual(r2.gewist, ['b']);
});

test('lege data en ontbrekende lijsten', () => {
  const r = ruimOp({ leads: [], blokken: [] }, NU);
  assert.deepEqual(r, { data: { leads: [], blokken: [], grafstenen: [] }, gewist: [], grafstenenGewist: 0 });
  const r2 = ruimOp({}, NU);
  assert.deepEqual(r2.data.leads, []);
  assert.deepEqual(r2.data.grafstenen, []);
});

test('invoer niet gemuteerd, blokken ongewijzigd', () => {
  const data = {
    leads: [lead('oud', { bezoeken: [bezoek('2024-02-01')] }), lead('ok', { status: 'te-plannen' })],
    blokken: [{ id: 'b1', datum: '2024-01-01' }],
    grafstenen: [{ h: 'aa', op: '2024-01-01T00:00:00.000Z' }],
  };
  const kopie = structuredClone(data);
  const r = ruimOp(data, NU);
  assert.deepEqual(data, kopie);
  assert.deepEqual(r.data.blokken, kopie.blokken);
  assert.equal(r.data.leads.length, 1);
});

test('grafstenen: 12 maanden en 1 dag gewist, precies 12 maanden blijft, telling klopt', () => {
  const data = { leads: [], blokken: [], grafstenen: [
    { h: 'a', op: '2025-10-08T23:59:00.000Z' },
    { h: 'b', op: '2025-10-09T00:00:00.000Z' },
    { h: 'c', op: '2026-10-01T00:00:00.000Z' },
    { h: 'd', op: '2024-01-01T00:00:00.000Z' },
  ] };
  const r = ruimOp(data, NU);
  assert.equal(r.grafstenenGewist, 2);
  assert.deepEqual(r.data.grafstenen.map(g => g.h), ['b', 'c']);
});

test('ontbrekende grafstenen geeft [] en 0', () => {
  const r = ruimOp({ leads: [lead('a', { status: 'te-plannen' })], blokken: [] }, NU);
  assert.deepEqual(r.data.grafstenen, []);
  assert.equal(r.grafstenenGewist, 0);
});

test('andere sleutels in data blijven behouden (versie)', () => {
  const r = ruimOp({ versie: 7, leads: [], blokken: [] }, NU);
  assert.equal(r.data.versie, 7);
});
