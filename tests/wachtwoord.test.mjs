import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_LENGTE, MAX_LENGTE, beleidsFout, hashWachtwoord, verifieerWachtwoord,
  SCHIJN_HASH, genereerWachtwoord, genereerHerstelcodes, normaliseerHerstelcode,
} from '../netlify/lib/wachtwoord.js';

test('hash en verifieer: juist wachtwoord true, fout wachtwoord false', async () => {
  const h = await hashWachtwoord('correct paard batterij');
  assert.equal(await verifieerWachtwoord('correct paard batterij', h), true);
  assert.equal(await verifieerWachtwoord('fout paard batterij', h), false);
});

test('twee hashes van hetzelfde wachtwoord verschillen (eigen salt)', async () => {
  const a = await hashWachtwoord('hetzelfde-wachtwoord');
  const b = await hashWachtwoord('hetzelfde-wachtwoord');
  assert.notEqual(a, b);
});

test('hashstring heeft het vaste formaat', async () => {
  const h = await hashWachtwoord('formaat-test-123');
  assert.ok(h.startsWith('scrypt$16384$8$1$'));
  assert.equal(h.split('$').length, 6);
});

test('verifieerWachtwoord gooit nooit bij kapotte invoer', async () => {
  assert.equal(await verifieerWachtwoord('x', 'rommel'), false);
  assert.equal(await verifieerWachtwoord('x', undefined), false);
  assert.equal(await verifieerWachtwoord('x', null), false);
  assert.equal(await verifieerWachtwoord('x', ''), false);
  assert.equal(await verifieerWachtwoord('x', 'scrypt$16384$8$1$AAAA$BBBB'), false);
  assert.equal(await verifieerWachtwoord('x', 'scrypt$abc$8$1$AAAA$BBBB'), false);
  assert.equal(await verifieerWachtwoord(undefined, SCHIJN_HASH), false);
});

test('verifieerWachtwoord weigert absurde kostparameters', async () => {
  const h = await hashWachtwoord('parameter-test-1');
  const delen = h.split('$');
  delen[1] = '1073741824';
  assert.equal(await verifieerWachtwoord('parameter-test-1', delen.join('$')), false);
});

test('beleidsFout: lengte en alleen-spaties', () => {
  assert.equal(MIN_LENGTE, 10);
  assert.equal(MAX_LENGTE, 200);
  assert.equal(typeof beleidsFout('kort'), 'string');
  assert.equal(beleidsFout('a'.repeat(10)), null);
  assert.equal(beleidsFout('a'.repeat(200)), null);
  assert.equal(typeof beleidsFout('a'.repeat(201)), 'string');
  assert.equal(typeof beleidsFout('          '), 'string');
  assert.equal(typeof beleidsFout(undefined), 'string');
  assert.equal(typeof beleidsFout(12345678901), 'string');
});

test('SCHIJN_HASH is een geldige hash die geen echt wachtwoord oplevert', async () => {
  assert.ok(SCHIJN_HASH.startsWith('scrypt$16384$8$1$'));
  assert.equal(await verifieerWachtwoord('welk-wachtwoord-dan-ook', SCHIJN_HASH), false);
});

test('genereerWachtwoord: 12 tekens, zonder dubbelzinnige tekens, voldoet aan beleid', () => {
  for (let i = 0; i < 50; i++) {
    const w = genereerWachtwoord();
    assert.equal(w.length, 12);
    assert.ok(!/[0O1lI]/.test(w), w);
    assert.equal(beleidsFout(w), null);
  }
  assert.notEqual(genereerWachtwoord(), genereerWachtwoord());
});

test('genereerHerstelcodes: 10 unieke codes in het juiste formaat', () => {
  const codes = genereerHerstelcodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.equal(genereerHerstelcodes(3).length, 3);
});

test('normaliseerHerstelcode: hoofdletters, spaties en streepje', () => {
  assert.equal(normaliseerHerstelcode(' 7k4m 2qxp '), '7K4M-2QXP');
  assert.equal(normaliseerHerstelcode('7k4m-2qxp'), '7K4M-2QXP');
  assert.equal(normaliseerHerstelcode('7K4M2QXP'), '7K4M-2QXP');
  assert.equal(normaliseerHerstelcode(undefined), '');
});
