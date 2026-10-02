import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voegSamenKb, kbStand, verouderdeKbIds } from '../public/js/schermen/klantbeschikbaarheid-logica.js';

test('voegSamenKb: serverwijziging van een ander ticket blijft', () => {
  const server = { A: { notitie: 'server A' }, B: { notitie: 'server B' } };
  const merged = voegSamenKb(server, { A: { notitie: 'lokaal A' } }, new Set());
  assert.deepEqual(merged.B, { notitie: 'server B' });
});

test('voegSamenKb: eigen wijziging wint op hetzelfde id', () => {
  const merged = voegSamenKb({ A: { notitie: 'server' } }, { A: { notitie: 'lokaal' } }, new Set());
  assert.equal(merged.A.notitie, 'lokaal');
});

test('voegSamenKb: lokaal verwijderd blijft verwijderd, ook als de server het ticket nog heeft', () => {
  const merged = voegSamenKb({ A: { notitie: 'server' }, B: { notitie: 'b' } }, {}, new Set(['A']));
  assert.deepEqual(Object.keys(merged), ['B']);
});

test('voegSamenKb: lege of ontbrekende server-stand, en de invoer wordt niet gemuteerd', () => {
  const server = { A: 1 };
  assert.deepEqual(voegSamenKb(null, { X: 1 }, new Set()), { X: 1 });
  voegSamenKb(server, { B: 2 }, new Set(['A']));
  assert.deepEqual(server, { A: 1 });
});

const concept = { voorkeur: '2026-10-05', voorkeurTijd: '09:00', geblokkeerd: ['2026-10-07', '2026-10-06'], duur: 120, notitie: 'x' };

test('kbStand: volgorde van geblokkeerde datums telt niet, de invoer wordt niet gesorteerd', () => {
  const omgekeerd = { ...concept, geblokkeerd: ['2026-10-06', '2026-10-07'] };
  assert.equal(kbStand(concept, 120), kbStand(omgekeerd, 120));
  assert.deepEqual(concept.geblokkeerd, ['2026-10-07', '2026-10-06']);
});

test('kbStand: duur null telt als de standaardduur; een andere duur of notitie is dirty', () => {
  assert.equal(kbStand({ ...concept, duur: null }, 120), kbStand(concept, 120));
  assert.notEqual(kbStand({ ...concept, duur: 90 }, 120), kbStand(concept, 120));
  assert.notEqual(kbStand({ ...concept, notitie: 'y' }, 120), kbStand(concept, 120));
  assert.equal(kbStand(concept, 120), '["2026-10-05","09:00",["2026-10-06","2026-10-07"],120,"x"]');
});

test('verouderdeKbIds: enkel niet-levende entries ouder dan 90 dagen; zonder datum telt als oud', () => {
  const nu = Date.UTC(2026, 9, 1);
  const dag = 24 * 60 * 60 * 1000;
  const items = {
    oudDood: { bijgewerkt: new Date(nu - 91 * dag).toISOString() },
    oudLevend: { bijgewerkt: new Date(nu - 200 * dag).toISOString() },
    jongDood: { bijgewerkt: new Date(nu - 89 * dag).toISOString() },
    zonderDatum: {},
  };
  assert.deepEqual(verouderdeKbIds(items, new Set(['oudLevend']), nu), ['oudDood', 'zonderDatum']);
});
