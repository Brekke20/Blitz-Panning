// tests/evenementen.test.mjs — kern/evenementen.js: de kalender van feestelijke evenementen (grenzen, tijdzone, jaarwissel).
process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENEMENTEN, MAX_SPINNEN, belgischeDag, isActief, actiefEvenement, volgendEvenement, vensterTekst, actieveEvenementen } from '../public/js/kern/evenementen.js';

const hal = EVENEMENTEN.find(e => e.id === 'halloween');
const kerst = EVENEMENTEN.find(e => e.id === 'kerst');

test('Halloween loopt van 1 tot en met 31 oktober, de randen inclusief', () => {
  assert.equal(isActief(hal, new Date('2026-09-30T12:00:00+02:00')), false);
  assert.equal(isActief(hal, new Date('2026-10-01T00:00:00+02:00')), true);
  assert.equal(isActief(hal, new Date('2026-10-15T12:00:00+02:00')), true);
  assert.equal(isActief(hal, new Date('2026-10-31T23:59:59+01:00')), true);
  assert.equal(isActief(hal, new Date('2026-11-01T00:00:00+01:00')), false);
});

test('tijdzone: de Belgische dag telt, niet de UTC-dag (zomertijd en wintertijd)', () => {
  // 1 oktober 00:00 Brussel = 30 sept 22:00 UTC (CEST)
  assert.equal(isActief(hal, new Date('2026-09-30T21:59:59Z')), false);
  assert.equal(isActief(hal, new Date('2026-09-30T22:00:00Z')), true);
  // De klok gaat op 25 oktober terug: 31 oktober 23:59:59 Brussel = 22:59:59 UTC (CET), 1 november 00:00 = 23:00 UTC
  assert.equal(isActief(hal, new Date('2026-10-31T22:59:59Z')), true);
  assert.equal(isActief(hal, new Date('2026-10-31T23:00:00Z')), false);
  // De nacht van de overgang zelf blijft binnen het venster
  assert.equal(isActief(hal, new Date('2026-10-25T00:30:00Z')), true);
});

test('de proces-tijdzone speelt geen rol', () => {
  assert.deepEqual(belgischeDag(new Date('2026-10-31T23:30:00Z')), { jaar: 2026, maand: 11, dag: 1 });
  assert.deepEqual(belgischeDag(new Date('2026-07-01T22:30:00Z')), { jaar: 2026, maand: 7, dag: 2 });
});

test('Kerst (1 december tot 6 januari) werkt over de jaarwissel', () => {
  for (const d of ['2026-12-01T12:00:00+01:00', '2026-12-31T23:59:00+01:00', '2027-01-01T00:00:00+01:00', '2027-01-06T23:59:59+01:00']) assert.equal(isActief(kerst, new Date(d)), true, d);
  for (const d of ['2026-11-30T23:59:59+01:00', '2027-01-07T00:00:00+01:00', '2026-06-15T12:00:00+02:00']) assert.equal(isActief(kerst, new Date(d)), false, d);
});

test('actiefEvenement: het eerste in lijstvolgorde, of null', () => {
  assert.equal(actiefEvenement(new Date('2026-10-12T10:00:00+02:00')).id, 'halloween');
  assert.equal(actiefEvenement(new Date('2026-12-24T10:00:00+01:00')).id, 'kerst');
  assert.equal(actiefEvenement(new Date('2026-05-05T10:00:00+02:00')), null);
  const lijst = [{ id: 'a', van: { maand: 5, dag: 1 }, tot: { maand: 5, dag: 31 } }, { id: 'b', van: { maand: 5, dag: 10 }, tot: { maand: 5, dag: 20 } }];
  assert.equal(actiefEvenement(new Date('2026-05-15T12:00:00+02:00'), lijst).id, 'a');
});

test('schrikkeldag en ongeldige datum', () => {
  const feb = { id: 'x', van: { maand: 2, dag: 28 }, tot: { maand: 3, dag: 1 } };
  assert.equal(isActief(feb, new Date('2028-02-29T12:00:00+01:00')), true);
  assert.throws(() => belgischeDag(new Date('nope')), RangeError);
});

test('volgendEvenement: enkel evenementen met thema, eerstvolgende start', () => {
  assert.equal(volgendEvenement(new Date('2026-06-01T12:00:00+02:00')).id, 'halloween');
  assert.equal(volgendEvenement(new Date('2026-11-05T12:00:00+01:00')).id, 'halloween'); // Kerst heeft geen thema; volgend jaar
  assert.equal(volgendEvenement(new Date('2026-10-01T12:00:00+02:00')).id, 'halloween'); // de start is vandaag: volgend jaar, geen crash
});

test('de lijst is geldig: unieke ids, geldige data, spelSkin voorbereid, spinnengrens', () => {
  assert.equal(new Set(EVENEMENTEN.map(e => e.id)).size, EVENEMENTEN.length);
  for (const e of EVENEMENTEN) {
    for (const md of [e.van, e.tot]) { assert.ok(md.maand >= 1 && md.maand <= 12); assert.ok(md.dag >= 1 && md.dag <= 31); }
    assert.ok('spelSkin' in e, `${e.id} mist spelSkin`);
    assert.ok(e.thema === null || typeof e.thema === 'string');
  }
  assert.ok(MAX_SPINNEN <= 3);
});

test('vensterTekst', () => {
  assert.equal(vensterTekst(hal), '1 tot 31 oktober');
  assert.equal(vensterTekst(kerst), '1 december tot 6 januari');
});

test('actieveEvenementen: alle lopende evenementen met spelSkin, in lijstvolgorde', () => {
  assert.deepEqual(actieveEvenementen(new Date('2026-10-12T10:00:00+02:00')), [{ id: 'halloween', naam: 'Halloween', spelSkin: 'halloween' }]);
  assert.deepEqual(actieveEvenementen(new Date('2026-12-24T10:00:00+01:00')), [{ id: 'kerst', naam: 'Kerst', spelSkin: null }]);
  assert.deepEqual(actieveEvenementen(new Date('2026-05-05T10:00:00+02:00')), []);
  const lijst = [{ id: 'a', naam: 'A', van: { maand: 5, dag: 1 }, tot: { maand: 5, dag: 31 } }, { id: 'b', naam: 'B', van: { maand: 5, dag: 10 }, tot: { maand: 5, dag: 20 }, spelSkin: 's' }];
  assert.deepEqual(actieveEvenementen(new Date('2026-05-15T12:00:00+02:00'), lijst).map(e => [e.id, e.spelSkin]), [['a', null], ['b', 's']]);
});
