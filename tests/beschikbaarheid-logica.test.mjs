process.env.TZ = 'Europe/Brussels';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWorkday, groupExceptionsForDisplay, valideerNieuweBlokkering } from '../public/js/schermen/beschikbaarheid-logica.js';

const MA_VR = [1, 2, 3, 4, 5];

test('bewaking: tijdzone is Europe/Brussels', () => {
  assert.equal(new Date(2026, 6, 1, 12).getTimezoneOffset(), -120);
});

test('nextWorkday: gewone werkdag geeft de volgende dag', () => {
  assert.equal(nextWorkday('2026-10-06', MA_VR), '2026-10-07'); // di -> wo
});

test('nextWorkday: vrijdag, zaterdag en zondag geven maandag', () => {
  assert.equal(nextWorkday('2026-10-09', MA_VR), '2026-10-12'); // vr
  assert.equal(nextWorkday('2026-10-10', MA_VR), '2026-10-12'); // za
  assert.equal(nextWorkday('2026-10-11', MA_VR), '2026-10-12'); // zo
});

test('nextWorkday: overgang naar wintertijd (zo 25 okt 2026) en zomertijd (zo 29 mrt 2026)', () => {
  assert.equal(nextWorkday('2026-10-23', MA_VR), '2026-10-26'); // vr voor de wintertijd
  assert.equal(nextWorkday('2026-10-25', MA_VR), '2026-10-26'); // de dag van de overgang zelf
  assert.equal(nextWorkday('2026-03-27', MA_VR), '2026-03-30');
  assert.equal(nextWorkday('2026-03-29', MA_VR), '2026-03-30');
});

test('nextWorkday: volgt de ingestelde werkdagen (donderdag vrij -> vrijdag)', () => {
  assert.equal(nextWorkday('2026-10-07', [1, 2, 3, 5]), '2026-10-09'); // wo -> vr
});

const BLOK = (o) => ({ id: 'x', scope: 'global', person: null, kind: 'fullday', from: null, to: null, reason: '', ...o });

test('groupExceptionsForDisplay: lege lijst geeft geen groepen', () => {
  assert.deepEqual(groupExceptionsForDisplay([], MA_VR), []);
});

test('groupExceptionsForDisplay: aaneensluitende werkdagen, weekend ertussen breekt niet', () => {
  const lijst = [BLOK({ id: 'a', date: '2026-10-09', reason: 'Verlof' }), BLOK({ id: 'b', date: '2026-10-12', reason: 'Verlof' })];
  const g = groupExceptionsForDisplay(lijst, MA_VR);
  assert.equal(g.length, 1);
  assert.equal(g[0].startDate, '2026-10-09');
  assert.equal(g[0].endDate, '2026-10-12');
  assert.deepEqual(g[0].items.map(e => e.id), ['a', 'b']);
});

test('groupExceptionsForDisplay: een gewone werkdag ertussen breekt de groep', () => {
  const lijst = [BLOK({ id: 'a', date: '2026-10-12', reason: 'Verlof' }), BLOK({ id: 'b', date: '2026-10-14', reason: 'Verlof' })];
  assert.equal(groupExceptionsForDisplay(lijst, MA_VR).length, 2);
});

test('groupExceptionsForDisplay: andere persoon, scope of reden breekt de groep', () => {
  const basis = BLOK({ id: 'a', date: '2026-10-06', reason: 'Verlof', scope: 'person', person: 'Tim' });
  assert.equal(groupExceptionsForDisplay([basis, BLOK({ ...basis, id: 'b', date: '2026-10-07', person: 'Roel' })], MA_VR).length, 2);
  assert.equal(groupExceptionsForDisplay([basis, BLOK({ ...basis, id: 'b', date: '2026-10-07', scope: 'global', person: null })], MA_VR).length, 2);
  assert.equal(groupExceptionsForDisplay([basis, BLOK({ ...basis, id: 'b', date: '2026-10-07', reason: 'Dokter' })], MA_VR).length, 2);
  assert.equal(groupExceptionsForDisplay([basis, BLOK({ ...basis, id: 'b', date: '2026-10-07' })], MA_VR).length, 1);
});

test('groupExceptionsForDisplay: tijdvakken worden nooit samengevoegd', () => {
  const r = (id, date) => BLOK({ id, date, kind: 'range', from: '09:00', to: '10:00', reason: 'Dokter' });
  const g = groupExceptionsForDisplay([r('a', '2026-10-19'), r('b', '2026-10-20')], MA_VR);
  assert.equal(g.length, 2);
  assert.deepEqual(g.map(x => x.items.length), [1, 1]);
});

test('groupExceptionsForDisplay: een hele dag direct na een tijdvak (of omgekeerd) blijft apart', () => {
  const lijst = [BLOK({ id: 'a', date: '2026-10-19', kind: 'range', from: '09:00', to: '10:00' }), BLOK({ id: 'b', date: '2026-10-20' })];
  assert.equal(groupExceptionsForDisplay(lijst, MA_VR).length, 2);
  assert.equal(groupExceptionsForDisplay([lijst[1], BLOK({ id: 'c', date: '2026-10-21', kind: 'range', from: '09:00', to: '10:00' })], MA_VR).length, 2);
});

test('groupExceptionsForDisplay: de groep draagt soort, scope, persoon en reden van de eerste regel; de invoer blijft ongemuteerd', () => {
  const e = BLOK({ id: 'a', date: '2026-10-06', reason: 'R', scope: 'person', person: 'Tim' });
  const lijst = [e];
  const g = groupExceptionsForDisplay(lijst, MA_VR);
  assert.deepEqual(g[0], { kind: 'fullday', scope: 'person', person: 'Tim', reason: 'R', startDate: '2026-10-06', endDate: '2026-10-06', items: [e] });
  assert.deepEqual(lijst, [e]);
});

// W5-bugfix: lege werkdagen mogen nooit een oneindige lus geven. Een synchrone lus laat zich niet
// door een test-timeout onderbreken, dus draaien deze proeven in een apart proces met harde timeout.
import { spawnSync } from 'node:child_process';
const LOGICA_URL = new URL('../public/js/schermen/beschikbaarheid-logica.js', import.meta.url).href;
function inProces(code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `process.env.TZ='Europe/Brussels'; import(${JSON.stringify(LOGICA_URL)}).then(m => { ${code} });`],
    { timeout: 3000, encoding: 'utf8' });
  assert.equal(r.error, undefined, 'proces liep vast of faalde: ' + (r.error && r.error.message));
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('nextWorkday: geen enkele werkdag -> null (geen oneindige lus)', () => {
  assert.deepEqual(inProces(`console.log(JSON.stringify(m.nextWorkday('2026-10-06', [])))`), null);
});

test('groupExceptionsForDisplay: lege werkdagen voegt niets samen, rijen blijven apart', () => {
  const lijst = [
    { kind: 'fullday', scope: 'all', person: 'A', reason: 'verlof', date: '2026-10-06' },
    { kind: 'fullday', scope: 'all', person: 'A', reason: 'verlof', date: '2026-10-07' },
    { kind: 'fullday', scope: 'all', person: 'A', reason: 'verlof', date: '2026-10-08' }
  ];
  const g = inProces(`console.log(JSON.stringify(m.groupExceptionsForDisplay(${JSON.stringify(lijst)}, [])))`);
  assert.equal(g.length, 3);
  assert.deepEqual(g.map(x => x.startDate), ['2026-10-06', '2026-10-07', '2026-10-08']);
});

test('nextWorkday: jaargrens, 31 dec -> eerstvolgende werkdag in januari', () => {
  assert.equal(nextWorkday('2026-12-31', MA_VR), '2027-01-01'); // do -> vr
  assert.equal(nextWorkday('2027-12-31', MA_VR), '2028-01-03'); // vr -> ma
  assert.equal(nextWorkday('2025-12-31', [1, 2, 3, 4, 5]), '2026-01-01');
});

test('valideerNieuweBlokkering: de vier weigeringen met exacte tekst en in de vastgelegde volgorde', () => {
  // 1. eindtijd voor begintijd gaat voor een lege datum
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'range', meerdaags: false, datum: '', datumTot: '', van: '10:00', tot: '09:00' }),
    { ok: false, melding: '⚠ Eindtijd moet na begintijd liggen' });
  // 2. lege datum
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '', datumTot: '', van: null, tot: null }),
    { ok: false, melding: '⚠ Kies een datum' });
  // 3. meerdaags zonder einddatum
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '2026-10-13', datumTot: '', van: null, tot: null }),
    { ok: false, melding: '⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit' });
  // 4. einddatum voor startdatum
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '2026-10-14', datumTot: '2026-10-13', van: null, tot: null }),
    { ok: false, melding: '⚠ Einddatum moet na startdatum liggen' });
});

test('valideerNieuweBlokkering: geldig: hele dag, tijdvak, periode', () => {
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: false, datum: '2026-10-13', datumTot: null, van: null, tot: null }), { ok: true });
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'range', meerdaags: false, datum: '2026-10-13', datumTot: null, van: '09:00', tot: '12:00' }), { ok: true });
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '2026-10-13', datumTot: '2026-10-13', van: null, tot: null }), { ok: true });
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: true, datum: '2026-10-13', datumTot: '2026-10-16', van: null, tot: null }), { ok: true });
});

test('valideerNieuweBlokkering: lege datum bij een tijdvak wordt ook geweigerd', () => {
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'range', meerdaags: false, datum: '', datumTot: null, van: '09:00', tot: '12:00' }),
    { ok: false, melding: '⚠ Kies een datum' });
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: false, datum: null, datumTot: null, van: null, tot: null }),
    { ok: false, melding: '⚠ Kies een datum' });
});

test('valideerNieuweBlokkering: meerdaags uitgevinkt met lege datumTot is geldig', () => {
  assert.deepEqual(valideerNieuweBlokkering({ kind: 'fullday', meerdaags: false, datum: '2026-10-13', datumTot: '', van: null, tot: null }), { ok: true });
});
