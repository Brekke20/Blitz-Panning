// Opruimregel (eindreview I3, besluit Brent 2026-10-09): 12 maanden na de LAATSTE ACTIVITEIT voor elke lead, ook niet afgewerkte; blokken en
// grafstenen ouder dan 12 maanden. Verzonnen gegevens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BEWAAR_MAANDEN, laatsteActiviteitDatum, ruimOp } from '../netlify/lib/sales-opruimen.js';

const NU = '2026-10-09T03:00:00.000Z'; // grens: 2025-10-09 (strikt ervoor vervalt)
const lead = (id, extra = {}) => ({
  id, naam: 'Janssens', status: 'afgewerkt', geimporteerdOp: '2024-01-01T08:00:00.000Z', bezoeken: [], ...extra,
});
const bezoek = (datum, extra = {}) => ({ datum, resultaat: 'offerte', op: datum + 'T10:00:00.000Z', ...extra });

test('constante', () => assert.equal(BEWAAR_MAANDEN, 12));

test('laatsteActiviteitDatum: de laatste van import, wijziging, eerder verwijderd, resultaat en bezoeken (op en datum)', () => {
  assert.equal(laatsteActiviteitDatum(lead('a', { bezoeken: [bezoek('2025-03-01'), bezoek('2025-05-02')] }), NU), '2025-05-02');
  assert.equal(laatsteActiviteitDatum(lead('a', {
    bezoeken: [bezoek('2025-03-01')], resultaat: { soort: 'offerte', op: '2025-08-09T12:00:00.000Z' },
  }), NU), '2025-08-09');
  assert.equal(laatsteActiviteitDatum(lead('a'), NU), '2024-01-01');
  assert.equal(laatsteActiviteitDatum(lead('a', { gewijzigdOp: '2026-02-03T09:00:00.000Z' }), NU), '2026-02-03');
  assert.equal(laatsteActiviteitDatum(lead('a', { eerderVerwijderd: { op: '2025-12-24T09:00:00.000Z' } }), NU), '2025-12-24');
  assert.equal(laatsteActiviteitDatum(lead('a', { bezoeken: [{ datum: '2025-01-01', resultaat: 'opnieuw', op: '2025-06-06T08:00:00.000Z' }] }), NU), '2025-06-06');
  assert.equal(laatsteActiviteitDatum({ id: 'x' }, NU), null);
  assert.equal(laatsteActiviteitDatum(null, NU), null);
});

test('een bezoekdatum in de toekomst stelt het wissen niet uit (telt hoogstens tot vandaag)', () => {
  const l = lead('a', { status: 'te-plannen', geimporteerdOp: '2024-01-01T08:00:00.000Z', bezoeken: [{ datum: '2099-01-01', resultaat: 'opnieuw', op: '2024-02-01T08:00:00.000Z' }] });
  assert.equal(laatsteActiviteitDatum(l, NU), '2026-10-09');
  assert.equal(laatsteActiviteitDatum(l), '2099-01-01'); // zonder `nu` geen begrenzing (enkel intern gebruik)
});

test('afgewerkt, laatste activiteit 12 maanden en 1 dag geleden: gewist; precies 12 maanden: blijft', () => {
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

test('I3: elke lead vervalt na 12 maanden zonder activiteit, ook te-plannen, voorgesteld en bevestigd uit het verleden', () => {
  const oudPlanning = { datum: '2025-01-15', start: '10:00' };
  const data = { leads: [
    lead('tp', { status: 'te-plannen', bezoeken: [bezoek('2024-02-01', { resultaat: 'opnieuw' })] }),
    lead('tp-nooit', { status: 'te-plannen' }),                                                                  // nooit bezocht, import van 2024
    lead('vg', { status: 'voorgesteld', planning: { ...oudPlanning, vast: false } }),
    lead('bv', { status: 'bevestigd', planning: { ...oudPlanning, vast: true } }),
    lead('tp-vers', { status: 'te-plannen', geimporteerdOp: '2026-09-01T08:00:00.000Z' }),                     // recent geimporteerd
  ], blokken: [] };
  const r = ruimOp(data, NU);
  assert.deepEqual(r.gewist.sort(), ['bv', 'tp', 'tp-nooit', 'vg']);
  assert.deepEqual(r.data.leads.map(l => l.id), ['tp-vers']);
});

test('I3: een wijziging (gewijzigdOp) of een nieuwe import van dezelfde lead telt als activiteit', () => {
  const data = { leads: [
    lead('gewijzigd', { status: 'te-plannen', gewijzigdOp: '2026-03-01T08:00:00.000Z' }),
    lead('niet', { status: 'te-plannen' }),
  ], blokken: [] };
  assert.deepEqual(ruimOp(data, NU).gewist, ['niet']);
});

test('I3: een lead met een voorgestelde of bevestigde afspraak van vandaag of later wordt nooit gewist', () => {
  const data = { leads: [
    lead('morgen', { status: 'bevestigd', planning: { datum: '2026-10-10', start: '10:00', vast: true } }),
    lead('vandaag', { status: 'voorgesteld', planning: { datum: '2026-10-09', start: '10:00', vast: false } }),
    lead('gisteren', { status: 'voorgesteld', planning: { datum: '2026-10-08', start: '10:00', vast: false } }),
  ], blokken: [] };
  assert.deepEqual(ruimOp(data, NU).gewist, ['gisteren']);
});

test('een lead zonder enige datum wordt nooit gewist', () => {
  const data = { leads: [{ id: 'x', status: 'te-plannen' }], blokken: [] };
  assert.deepEqual(ruimOp(data, NU).gewist, []);
});

test('I3: blokken ouder dan 12 maanden vervallen (op hun datum), precies 12 maanden en recentere blijven; telling klopt', () => {
  const data = { leads: [], blokken: [
    { id: 'b1', datum: '2025-10-08', start: '09:00', eind: '10:00', soort: 'afspraak', omschrijving: 'afspraak bij Peeters' },
    { id: 'b2', datum: '2025-10-09', start: '09:00', eind: '10:00', soort: 'afspraak' },
    { id: 'b3', datum: '2026-11-01', start: '09:00', eind: '10:00', soort: 'verlof' },
    { id: 'b4', datum: '2024-01-01', start: '00:00', eind: '23:59', soort: 'verlof' },
  ] };
  const r = ruimOp(data, NU);
  assert.equal(r.blokkenGewist, 2);
  assert.deepEqual(r.data.blokken.map(b => b.id), ['b2', 'b3']);
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
  assert.deepEqual(r, { data: { leads: [], blokken: [], grafstenen: [] }, gewist: [], blokkenGewist: 0, grafstenenGewist: 0 });
  const r2 = ruimOp({}, NU);
  assert.deepEqual(r2.data.leads, []);
  assert.deepEqual(r2.data.blokken, []);
  assert.deepEqual(r2.data.grafstenen, []);
});

test('invoer niet gemuteerd, recente blokken en leads onveranderd bewaard', () => {
  const data = {
    leads: [lead('oud', { bezoeken: [bezoek('2024-02-01')] }), lead('ok', { status: 'te-plannen', geimporteerdOp: '2026-08-01T08:00:00.000Z' })],
    blokken: [{ id: 'b1', datum: '2024-01-01' }, { id: 'b2', datum: '2026-10-01' }],
    grafstenen: [{ h: 'aa', op: '2024-01-01T00:00:00.000Z' }],
  };
  const kopie = structuredClone(data);
  const r = ruimOp(data, NU);
  assert.deepEqual(data, kopie);
  assert.deepEqual(r.data.blokken, [kopie.blokken[1]]);
  assert.deepEqual(r.data.leads, [kopie.leads[1]]);
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
  const r = ruimOp({ leads: [lead('a', { status: 'te-plannen', geimporteerdOp: '2026-09-01T08:00:00.000Z' })], blokken: [] }, NU);
  assert.deepEqual(r.data.grafstenen, []);
  assert.equal(r.grafstenenGewist, 0);
});

test('andere sleutels in data blijven behouden (versie)', () => {
  const r = ruimOp({ versie: 7, leads: [], blokken: [] }, NU);
  assert.equal(r.data.versie, 7);
});
