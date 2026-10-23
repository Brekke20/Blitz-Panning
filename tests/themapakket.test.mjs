// tests/themapakket.test.mjs — kern/themapakket.js: periodes (vast, over de jaarwissel, beweeglijk rond Pasen), actief thema en overlapregel.
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  belgischeDag, periodeVoorJaar, effectievePeriode, isActief, periodeLengte,
  actiefThema, actieveThemas, volgendThema, vensterTekst,
} from '../public/js/kern/themapakket.js';

const P_HALLOWEEN = { van: { maand: 10, dag: 1 }, tot: { maand: 10, dag: 31 } };
const P_KERST = { van: { maand: 12, dag: 1 }, tot: { maand: 1, dag: 6 } };
const P_SINT = { van: { maand: 12, dag: 1 }, tot: { maand: 12, dag: 6 } };
const P_ZOMER = { van: { maand: 7, dag: 1 }, tot: { maand: 8, dag: 31 } };
const P_FEESTDAG = { van: { maand: 7, dag: 19 }, tot: { maand: 7, dag: 21 } };
const P_PASEN = { basis: 'pasen', van: -7, tot: 1 };
const P_CARNAVAL = { basis: 'pasen', van: -52, tot: -46 };

const th = (id, periode, extra = {}) => ({ id, aan: true, periode, ...extra });

test('belgischeDag: de Belgische kalenderdag, ook als de UTC-dag verschilt', () => {
  assert.deepEqual(belgischeDag(new Date('2026-10-31T23:30:00Z')), { jaar: 2026, maand: 11, dag: 1 });
  assert.throws(() => belgischeDag(new Date('nope')), RangeError);
});

// Opgegaan uit tests/evenementen.test.mjs (taak 8: kern/evenementen.js is vervallen, de kalender is nu themapakket.js).
test('tijdzone: de Belgische dag telt, niet de UTC-dag (zomertijd en wintertijd), ook in de nacht van de klokwissel', () => {
  const t = th('halloween', P_HALLOWEEN);
  // 1 oktober 00:00 Brussel = 30 sept 22:00 UTC (CEST)
  assert.equal(isActief(t, new Date('2026-09-30T21:59:59Z')), false);
  assert.equal(isActief(t, new Date('2026-09-30T22:00:00Z')), true);
  // De klok gaat op 25 oktober terug: 31 oktober 23:59:59 Brussel = 22:59:59 UTC (CET), 1 november 00:00 = 23:00 UTC
  assert.equal(isActief(t, new Date('2026-10-31T22:59:59Z')), true);
  assert.equal(isActief(t, new Date('2026-10-31T23:00:00Z')), false);
  assert.equal(isActief(t, new Date('2026-10-25T00:30:00Z')), true);
});

test('de proces-tijdzone speelt geen rol en een schrikkeldag werkt', () => {
  assert.deepEqual(belgischeDag(new Date('2026-07-01T22:30:00Z')), { jaar: 2026, maand: 7, dag: 2 });
  const feb = th('x', { van: { maand: 2, dag: 28 }, tot: { maand: 3, dag: 1 } });
  assert.equal(isActief(feb, new Date('2028-02-29T12:00:00+01:00')), true);
  assert.equal(isActief(feb, new Date('2026-03-02T12:00:00+01:00')), false);
});

test('Kerst (1 december tot 6 januari) werkt over de jaarwissel', () => {
  const t = th('kerst', P_KERST);
  for (const d of ['2026-12-01T12:00:00+01:00', '2026-12-31T23:59:00+01:00', '2027-01-01T00:00:00+01:00', '2027-01-06T23:59:59+01:00']) assert.equal(isActief(t, new Date(d)), true, d);
  for (const d of ['2026-11-30T23:59:59+01:00', '2027-01-07T00:00:00+01:00', '2026-06-15T12:00:00+02:00']) assert.equal(isActief(t, new Date(d)), false, d);
});

test('isActief: vaste periode, randen inclusief (Belgische dag)', () => {
  const t = th('halloween', P_HALLOWEEN);
  assert.equal(isActief(t, new Date('2026-09-30T23:59:00+02:00')), false);
  assert.equal(isActief(t, new Date('2026-10-01T00:00:00+02:00')), true);
  assert.equal(isActief(t, new Date('2026-10-31T23:59:00+01:00')), true);
  assert.equal(isActief(t, new Date('2026-11-01T00:00:00+01:00')), false);
});

test('isActief: een thema dat uit staat is nooit actief', () => {
  assert.equal(isActief({ ...th('halloween', P_HALLOWEEN), aan: false }, new Date('2026-10-15T12:00:00+02:00')), false);
});

test('isActief: periode over de jaarwissel loopt door in het nieuwe jaar', () => {
  const t = th('kerst', { van: { maand: 12, dag: 7 }, tot: { maand: 1, dag: 6 } });
  assert.equal(isActief(t, new Date('2026-12-06T12:00:00+01:00')), false);
  assert.equal(isActief(t, new Date('2026-12-07T12:00:00+01:00')), true);
  assert.equal(isActief(t, new Date('2026-12-31T12:00:00+01:00')), true);
  assert.equal(isActief(t, new Date('2027-01-01T12:00:00+01:00')), true);
  assert.equal(isActief(t, new Date('2027-01-06T23:59:00+01:00')), true);
  assert.equal(isActief(t, new Date('2027-01-07T00:00:00+01:00')), false);
});

test('periodeVoorJaar: vaste periode en over de jaarwissel', () => {
  assert.deepEqual(periodeVoorJaar(P_HALLOWEEN, 2026), { start: '2026-10-01', einde: '2026-10-31' });
  assert.deepEqual(periodeVoorJaar(P_KERST, 2026), { start: '2026-12-01', einde: '2027-01-06' });
});

test('periodeVoorJaar: beweeglijk rond Pasen', () => {
  assert.deepEqual(periodeVoorJaar(P_PASEN, 2026), { start: '2026-03-29', einde: '2026-04-06' });
  assert.deepEqual(periodeVoorJaar(P_PASEN, 2027), { start: '2027-03-21', einde: '2027-03-29' });
  assert.deepEqual(periodeVoorJaar(P_PASEN, 2028), { start: '2028-04-09', einde: '2028-04-17' });
});

test('periodeVoorJaar: carnaval eindigt op Aswoensdag (Pasen min 46 dagen)', () => {
  assert.deepEqual(periodeVoorJaar(P_CARNAVAL, 2026), { start: '2026-02-12', einde: '2026-02-18' });
});

test('isActief: een beweeglijk thema volgt het jaar', () => {
  const t = th('pasen', P_PASEN);
  assert.equal(isActief(t, new Date('2026-03-28T12:00:00+01:00')), false);
  assert.equal(isActief(t, new Date('2026-03-29T12:00:00+02:00')), true);
  assert.equal(isActief(t, new Date('2026-04-06T12:00:00+02:00')), true);
  assert.equal(isActief(t, new Date('2026-04-07T12:00:00+02:00')), false);
  assert.equal(isActief(t, new Date('2027-03-21T12:00:00+01:00')), true);
});

test('effectievePeriode: periodeOverride gaat voor, null geeft de periode van het pakket', () => {
  const eigen = { van: { maand: 12, dag: 7 }, tot: { maand: 12, dag: 31 } };
  assert.equal(effectievePeriode({ periode: P_KERST, periodeOverride: eigen }), eigen);
  assert.equal(effectievePeriode({ periode: P_KERST, periodeOverride: null }), P_KERST);
  assert.equal(effectievePeriode({ periode: P_KERST }), P_KERST);
});

test('isActief gebruikt de override', () => {
  const t = th('kerst', P_KERST, { periodeOverride: { van: { maand: 12, dag: 7 }, tot: { maand: 12, dag: 31 } } });
  assert.equal(isActief(t, new Date('2026-12-03T12:00:00+01:00')), false);
  assert.equal(isActief(t, new Date('2026-12-07T12:00:00+01:00')), true);
  assert.equal(isActief(t, new Date('2027-01-02T12:00:00+01:00')), false);
  assert.equal(isActief({ ...t, periodeOverride: null }, new Date('2027-01-02T12:00:00+01:00')), true);
});

test('periodeLengte telt de dagen inclusief', () => {
  assert.equal(periodeLengte(P_HALLOWEEN, 2026), 31);
  assert.equal(periodeLengte(P_KERST, 2026), 37);
  assert.equal(periodeLengte(P_PASEN, 2026), 9);
  assert.equal(periodeLengte(P_FEESTDAG, 2026), 3);
});

test('actiefThema: het kortste venster wint (sinterklaas boven kerst)', () => {
  const lijst = [th('kerst', P_KERST), th('sinterklaas', P_SINT)];
  assert.equal(actiefThema(new Date('2026-12-03T12:00:00+01:00'), lijst).id, 'sinterklaas');
  assert.equal(actiefThema(new Date('2026-12-10T12:00:00+01:00'), lijst).id, 'kerst');
  assert.equal(actiefThema(new Date('2027-01-03T12:00:00+01:00'), lijst).id, 'kerst');
});

test('actiefThema: nationale feestdag wint van de zomer', () => {
  const lijst = [th('zomer', P_ZOMER), th('feestdag', P_FEESTDAG)];
  assert.equal(actiefThema(new Date('2026-07-20T12:00:00+02:00'), lijst).id, 'feestdag');
  assert.equal(actiefThema(new Date('2026-07-22T12:00:00+02:00'), lijst).id, 'zomer');
});

test('actiefThema: bij gelijke lengte wint de latere start, daarna de alfabetische id', () => {
  const a = th('a', { van: { maand: 5, dag: 1 }, tot: { maand: 5, dag: 10 } });
  const b = th('b', { van: { maand: 5, dag: 5 }, tot: { maand: 5, dag: 14 } });
  const d = new Date('2026-05-07T12:00:00+02:00');
  assert.equal(actiefThema(d, [a, b]).id, 'b');
  assert.equal(actiefThema(d, [b, a]).id, 'b');
  const x = th('x', P_FEESTDAG), y = th('y', P_FEESTDAG);
  assert.equal(actiefThema(new Date('2026-07-20T12:00:00+02:00'), [y, x]).id, 'x');
});

test('actiefThema: geen actief thema geeft null; een uitgezet thema telt niet', () => {
  assert.equal(actiefThema(new Date('2026-05-07T12:00:00+02:00'), [th('halloween', P_HALLOWEEN)]), null);
  assert.equal(actiefThema(new Date('2026-10-15T12:00:00+02:00'), [{ ...th('halloween', P_HALLOWEEN), aan: false }]), null);
  assert.equal(actiefThema(new Date('2026-10-15T12:00:00+02:00'), []), null);
});

test('actiefThema: de lengte van het venster rond de jaarwissel telt mee', () => {
  // kerst (1 dec - 6 jan, 37 dagen) en nieuwjaar (1-2 jan): op 2 januari wint het kortste
  const lijst = [th('kerst', P_KERST), th('nieuwjaar', { van: { maand: 1, dag: 1 }, tot: { maand: 1, dag: 2 } })];
  assert.equal(actiefThema(new Date('2027-01-02T12:00:00+01:00'), lijst).id, 'nieuwjaar');
  assert.equal(actiefThema(new Date('2027-01-04T12:00:00+01:00'), lijst).id, 'kerst');
});

test('actieveThemas: alle actieve thema\'s, in de volgorde van de lijst', () => {
  const lijst = [th('kerst', P_KERST), th('halloween', P_HALLOWEEN), th('sinterklaas', P_SINT), { ...th('uit', P_SINT), aan: false }];
  assert.deepEqual(actieveThemas(new Date('2026-12-03T12:00:00+01:00'), lijst).map(t => t.id), ['kerst', 'sinterklaas']);
  assert.deepEqual(actieveThemas(new Date('2026-05-03T12:00:00+02:00'), lijst), []);
});

test('volgendThema: eerstvolgende start van een thema dat aan staat', () => {
  const kerst = th('kerst', P_KERST, { periodeOverride: { van: { maand: 12, dag: 7 }, tot: { maand: 12, dag: 31 } } });
  const lijst = [th('halloween', P_HALLOWEEN), kerst];
  const r = volgendThema(new Date('2026-11-02T12:00:00+01:00'), lijst);
  assert.equal(r.thema.id, 'kerst');
  assert.equal(r.start, '2026-12-07');
});

test('volgendThema: een uitgezet thema telt niet; na de laatste start komt het volgende jaar', () => {
  const lijst = [{ ...th('kerst', P_KERST), aan: false }, th('halloween', P_HALLOWEEN)];
  const r = volgendThema(new Date('2026-11-02T12:00:00+01:00'), lijst);
  assert.equal(r.thema.id, 'halloween');
  assert.equal(r.start, '2027-10-01');
  assert.equal(volgendThema(new Date('2026-11-02T12:00:00+01:00'), [{ ...th('kerst', P_KERST), aan: false }]), null);
  assert.equal(volgendThema(new Date('2026-11-02T12:00:00+01:00'), []), null);
});

test('volgendThema: een thema dat vandaag start telt niet, een beweeglijk thema volgt het jaar', () => {
  const r = volgendThema(new Date('2026-10-01T12:00:00+02:00'), [th('halloween', P_HALLOWEEN)]);
  assert.equal(r.start, '2027-10-01');
  const p = volgendThema(new Date('2026-04-10T12:00:00+02:00'), [th('pasen', P_PASEN)]);
  assert.equal(p.start, '2027-03-21');
});

test('vensterTekst: vast, over de jaarwissel en beweeglijk', () => {
  assert.equal(vensterTekst(P_HALLOWEEN, 2026), '1 tot 31 oktober');
  assert.equal(vensterTekst(P_KERST, 2026), '1 december tot 6 januari');
  assert.equal(vensterTekst(P_PASEN, 2026), '29 maart tot 6 april 2026');
});
