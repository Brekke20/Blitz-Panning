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
