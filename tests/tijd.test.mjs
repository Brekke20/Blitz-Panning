process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localISO, todayISO, getWeekStart, timeStrToMin, minToTimeStr,
  extractLocalHour, fmtDate, fmtDateShort, fmtSec,
} from '../public/js/kern/tijd.js';

test('bewaking: tijdzone is Europe/Brussels (zomer = UTC+2)', () => {
  assert.equal(new Date(2026, 6, 1, 12).getTimezoneOffset(), -120);
});

test('localISO geeft de lokale dag', () => {
  assert.equal(localISO(new Date(2026, 2, 29, 0, 30)), '2026-03-29');
  assert.equal(localISO(new Date(2026, 9, 25, 2, 30)), '2026-10-25');
  assert.equal(localISO(new Date(2026, 0, 1)), '2026-01-01');
  // lokale 00:30 in de zomer is nog gisteren in UTC, maar de lokale dag telt
  const d = new Date(2026, 6, 15, 0, 30);
  assert.equal(d.toISOString().slice(0, 10), '2026-07-14');
  assert.equal(localISO(d), '2026-07-15');
});

test('todayISO = localISO(nu)', () => {
  const nu = new Date(2026, 6, 15, 0, 30);
  assert.equal(todayISO(nu), '2026-07-15');
  assert.equal(todayISO(), localISO(new Date()));
});

test('getWeekStart: maandag 00:00 lokaal, ook over de zomertijdgrens', () => {
  const d = getWeekStart(new Date(2026, 2, 25), 1);
  assert.equal(localISO(d), '2026-03-30');
  assert.equal(d.getDay(), 1);
  assert.deepEqual([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()], [0, 0, 0, 0]);
  // zondag 2026-10-04 met offset 0 -> voorgaande maandag 2026-09-28
  assert.equal(localISO(getWeekStart(new Date(2026, 9, 4, 15), 0)), '2026-09-28');
});

test('timeStrToMin / minToTimeStr', () => {
  assert.equal(timeStrToMin('08:30'), 510);
  assert.equal(minToTimeStr(510), '08:30');
  assert.equal(minToTimeStr(1500), '01:00');
  assert.equal(minToTimeStr(undefined), '00:00');
});

test('extractLocalHour', () => {
  assert.equal(extractLocalHour(null), null);
  assert.equal(extractLocalHour(''), null);
  assert.equal(extractLocalHour('2026-10-05T07:30:00+02:00'), '07:30');
  assert.equal(extractLocalHour('2026-10-05T22:00:00.000Z'), null);
  assert.equal(extractLocalHour('2026-10-05T00:00:00.000Z'), null);
  assert.equal(extractLocalHour('2026-10-05T09:15:00.000Z'), '11:15');
  assert.equal(extractLocalHour('2026-11-05T09:15:00.000Z'), '10:15');
});

test('fmtDate / fmtDateShort / fmtSec', () => {
  assert.match(fmtDate('2026-10-05T12:00:00'), /2026/);
  assert.match(fmtDate('2026-10-05T12:00:00'), /okt/i);
  assert.match(fmtDateShort('2026-10-05'), /5/);
  assert.match(fmtDateShort(new Date(2026, 9, 5)), /okt/i);
  assert.equal(fmtSec(3660), '1u 1min');
  assert.equal(fmtSec(300), '5min');
});

// ── Gedeelde gekozen datum (Brent-verzoek, proefperiode) ──
import { verschuifDatum, weekVerschil, volgendeWerkdagVan } from '../public/js/kern/tijd.js';

test('verschuifDatum: dagen, weken en jaargrens', () => {
  assert.equal(verschuifDatum('2026-10-05', { dagen: 7 }), '2026-10-12');
  assert.equal(verschuifDatum('2026-10-05', { dagen: -7 }), '2026-09-28');
  assert.equal(verschuifDatum('2026-12-30', { dagen: 3 }), '2027-01-02');
});

test('verschuifDatum: maanden begrenzen de dag tot de doelmaand', () => {
  assert.equal(verschuifDatum('2026-01-31', { maanden: 1 }), '2026-02-28');
  assert.equal(verschuifDatum('2026-03-31', { maanden: -1 }), '2026-02-28');
  assert.equal(verschuifDatum('2026-12-15', { maanden: 1 }), '2027-01-15');
});

test('verschuifDatum: over de zomertijdwissel blijft de dag juist', () => {
  assert.equal(verschuifDatum('2026-10-24', { dagen: 2 }), '2026-10-26');
  assert.equal(verschuifDatum('2026-03-28', { dagen: 2 }), '2026-03-30');
});

test('weekVerschil: aantal weken t.o.v. de week van vandaag (maandag-zondag)', () => {
  assert.equal(weekVerschil('2026-10-05', '2026-10-05'), 0);
  assert.equal(weekVerschil('2026-10-11', '2026-10-05'), 0); // zondag hoort bij dezelfde week
  assert.equal(weekVerschil('2026-10-12', '2026-10-05'), 1);
  assert.equal(weekVerschil('2026-09-28', '2026-10-05'), -1);
  assert.equal(weekVerschil('2026-10-26', '2026-10-24'), 1); // over de zomertijdwissel (25 okt)
});

test('volgendeWerkdagVan: slaat het weekend over, beide richtingen', () => {
  const wd = [1, 2, 3, 4, 5];
  assert.equal(volgendeWerkdagVan('2026-10-09', wd, 1), '2026-10-12');  // vrijdag -> maandag
  assert.equal(volgendeWerkdagVan('2026-10-12', wd, -1), '2026-10-09'); // maandag -> vrijdag
  assert.equal(volgendeWerkdagVan('2026-10-05', wd, 1), '2026-10-06');
  assert.equal(volgendeWerkdagVan('2026-10-05', [], 1), '2026-10-06');
});
