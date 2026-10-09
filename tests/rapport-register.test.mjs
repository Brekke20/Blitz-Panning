import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGISTER_KEY, IN_FLIGHT_TIMEOUT_MS, normaliseerVerzendId, isAlVerzonden,
  pasRegisterMarkeringToe, heeftActieveReservering, pasReserveringToe, wisReservering,
  pasMarkeringToe, leesRegister,
} from '../netlify/lib/rapport-register.js';

const ID = '0b6c1f2e-1111-4222-8333-444455556666';
const NU = Date.parse('2026-10-08T10:00:00.000Z');

test('normaliseerVerzendId: ongeldig → null, UUID blijft', () => {
  assert.equal(normaliseerVerzendId('abc'), null);
  assert.equal(normaliseerVerzendId(42), null);
  assert.equal(normaliseerVerzendId(ID), ID);
});

test('isAlVerzonden: enkel entry bij done:true', () => {
  assert.equal(isAlVerzonden(null, {}), null);
  assert.equal(isAlVerzonden(ID, { [ID]: { done: false } }), null);
  assert.equal(isAlVerzonden(ID, {}), null);
  const e = { done: true, zohoAttachmentId: 'A1' };
  assert.equal(isAlVerzonden(ID, { [ID]: e }), e);
});

test('pasRegisterMarkeringToe: null bij al-done, anders done-entry', () => {
  assert.equal(pasRegisterMarkeringToe({ [ID]: { done: true } }, ID, 'A1', NU), null);
  assert.equal(pasRegisterMarkeringToe({}, null, 'A1', NU), null);
  const r = pasRegisterMarkeringToe({}, ID, 'A1', NU);
  assert.deepEqual(r[ID], { verzendId: ID, zohoAttachmentId: 'A1', done: true, uploadInFlightSince: null, bijgewerkt: NU });
});

test('heeftActieveReservering: binnen/buiten 3 min en corrupte datum', () => {
  assert.equal(IN_FLIGHT_TIMEOUT_MS, 180000);
  const sinds = new Date(NU - 60_000).toISOString();
  assert.equal(heeftActieveReservering({ uploadInFlightSince: sinds }, NU), true);
  const oud = new Date(NU - 4 * 60_000).toISOString();
  assert.equal(heeftActieveReservering({ uploadInFlightSince: oud }, NU), false);
  assert.equal(heeftActieveReservering({ uploadInFlightSince: 'rommel' }, NU), false);
  assert.equal(heeftActieveReservering({}, NU), false);
  assert.equal(heeftActieveReservering(undefined, NU), false);
});

test('pasReserveringToe: null bij actieve reservering, anders zet reservering', () => {
  const actief = { [ID]: { uploadInFlightSince: new Date(NU - 1000).toISOString() } };
  assert.equal(pasReserveringToe(actief, ID, NU), null);
  assert.equal(pasReserveringToe({}, null, NU), null);
  const r = pasReserveringToe({}, ID, NU);
  assert.equal(r[ID].uploadInFlightSince, new Date(NU).toISOString());
  assert.equal(r[ID].verzendId, ID);
});

test('wisReservering: null zonder reservering, anders leeg', () => {
  assert.equal(wisReservering({}, ID), null);
  assert.equal(wisReservering({ [ID]: { uploadInFlightSince: null } }, ID), null);
  const r = wisReservering({ [ID]: { verzendId: ID, uploadInFlightSince: 'x' } }, ID);
  assert.equal(r[ID].uploadInFlightSince, null);
});

test('pasMarkeringToe: null als entry al correct of geen match, anders label gezet', () => {
  const al = [{ id: ID, zohoUploaded: true, zohoAttachmentId: 'A1', geannuleerd: false }];
  assert.equal(pasMarkeringToe(al, ID, 'A1'), null);
  assert.equal(pasMarkeringToe(al, 'andere', 'A1'), null);
  assert.equal(pasMarkeringToe(al, null, 'A1'), null);
  const r = pasMarkeringToe([{ id: ID, geannuleerd: true }], ID, 'A9');
  assert.equal(r[0].zohoUploaded, true);
  assert.equal(r[0].zohoAttachmentId, 'A9');
  assert.equal(r[0].geannuleerd, false);
});

test('leesRegister: lege store geeft leeg register; REGISTER_KEY ongewijzigd', async () => {
  assert.equal(REGISTER_KEY, 'rapport-verzend-status');
  const leeg = { async get() { return null; } };
  assert.deepEqual(await leesRegister(leeg), { versie: 0, entries: {} });
  const vol = { async get(k, o) { assert.equal(k, REGISTER_KEY); assert.equal(o.type, 'json'); return { versie: 2, entries: {} }; } };
  assert.deepEqual(await leesRegister(vol), { versie: 2, entries: {} });
});
