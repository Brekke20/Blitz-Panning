// tests/vergrendeling.test.mjs — netlify/lib/vergrendeling.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { isVergrendeld, registreerMislukt, wisPogingen, leesPogingen, schrijfPogingen, wijzigPogingen } from '../netlify/lib/vergrendeling.js';

const T0 = Date.parse('2026-10-08T08:00:00Z');
const MIN = 60000;
const leeg = () => ({ login: {}, herstel: {} });

function faal(staat, soort, sleutel, aantal, start = T0, stap = 1000) {
  let laatste;
  for (let i = 0; i < aantal; i++) { laatste = registreerMislukt(staat, soort, sleutel, start + i * stap); staat = laatste.staat; }
  return { staat, laatste };
}

test('login: na 4 pogingen vrij, na de 5e vergrendeld tot nu + 15 min', () => {
  let r = faal(leeg(), 'login', 'a@b.be', 4);
  assert.equal(isVergrendeld(r.staat, 'login', 'a@b.be', T0 + 5000).vergrendeld, false);
  assert.equal(r.laatste.vergrendeldNu, false);
  const vijfde = T0 + 4000;
  r = faal(r.staat, 'login', 'a@b.be', 1, vijfde);
  assert.equal(r.laatste.vergrendeldNu, true);
  const v = isVergrendeld(r.staat, 'login', 'a@b.be', vijfde + 1000);
  assert.equal(v.vergrendeld, true);
  assert.equal(v.tot, vijfde + 15 * MIN);
  assert.equal(isVergrendeld(r.staat, 'login', 'a@b.be', vijfde + 15 * MIN).vergrendeld, false);
});

test('pogingen ouder dan 15 min tellen niet mee', () => {
  let r = faal(leeg(), 'login', 'a@b.be', 4);
  r = faal(r.staat, 'login', 'a@b.be', 1, T0 + 16 * MIN);
  assert.equal(r.laatste.vergrendeldNu, false);
  assert.equal(isVergrendeld(r.staat, 'login', 'a@b.be', T0 + 16 * MIN).vergrendeld, false);
});

test('na wisPogingen weer vrij', () => {
  const r = faal(leeg(), 'login', 'a@b.be', 5);
  assert.equal(isVergrendeld(r.staat, 'login', 'a@b.be', T0 + 6000).vergrendeld, true);
  const gewist = wisPogingen(r.staat, 'login', 'a@b.be');
  assert.equal(isVergrendeld(gewist, 'login', 'a@b.be', T0 + 6000).vergrendeld, false);
  assert.equal(isVergrendeld(wisPogingen(leeg(), 'login', 'x'), 'login', 'x', T0).vergrendeld, false);
});

test('herstel vergrendelt 1 uur, soorten zijn onafhankelijk', () => {
  const r = faal(leeg(), 'herstel', 'a@b.be', 5);
  const nu = T0 + 5000;
  assert.equal(isVergrendeld(r.staat, 'herstel', 'a@b.be', nu).tot, T0 + 4000 + 60 * MIN);
  assert.equal(isVergrendeld(r.staat, 'herstel', 'a@b.be', T0 + 4000 + 59 * MIN).vergrendeld, true);
  assert.equal(isVergrendeld(r.staat, 'login', 'a@b.be', nu).vergrendeld, false);
});

test('sleutel is niet hoofdlettergevoelig; onbekend adres gedraagt zich identiek', () => {
  const r = faal(leeg(), 'login', 'Onbekend@Nergens.be', 5);
  assert.equal(isVergrendeld(r.staat, 'login', ' onbekend@nergens.be ', T0 + 6000).vergrendeld, true);
  assert.equal(isVergrendeld(r.staat, 'login', 'ander@nergens.be', T0 + 6000).vergrendeld, false);
});

test('de staat wordt opgeschoond en bevat geen e-mailadressen in klare tekst', () => {
  let r = faal(leeg(), 'login', 'a@b.be', 2);
  r = faal(r.staat, 'login', 'c@d.be', 1, T0 + 20 * MIN);
  assert.equal(Object.keys(r.staat.login).length, 1, 'de oude vermelding van a@b.be is weg');
  assert.ok(!JSON.stringify(r.staat).includes('@'));
  // een verlopen vergrendeling wordt ook weggeruimd
  let v = faal(leeg(), 'login', 'a@b.be', 5);
  v = faal(v.staat, 'login', 'z@z.be', 1, T0 + 16 * MIN);
  assert.equal(Object.keys(v.staat.login).length, 1);
});

test('registreerMislukt muteert de ingevoerde staat niet; ongeldige invoer gooit niet', () => {
  const s = leeg();
  registreerMislukt(s, 'login', 'a', T0);
  assert.deepEqual(s, leeg());
  assert.equal(isVergrendeld(undefined, 'login', 'a', T0).vergrendeld, false);
  assert.equal(isVergrendeld({}, 'login', 'a', T0).vergrendeld, false);
  assert.doesNotThrow(() => registreerMislukt({}, 'login', 'a', T0));
  assert.throws(() => registreerMislukt(leeg(), 'onzin', 'a', T0));
});

test('een mislukte poging tijdens een lopende vergrendeling verlengt die niet', () => {
  const r = faal(leeg(), 'login', 'a@b.be', 5);
  const tot = isVergrendeld(r.staat, 'login', 'a@b.be', T0 + 5000).tot;
  const extra = registreerMislukt(r.staat, 'login', 'a@b.be', T0 + 6000);
  assert.equal(extra.vergrendeldNu, false);
  assert.equal(isVergrendeld(extra.staat, 'login', 'a@b.be', T0 + 7000).tot, tot);
});

test('het aantal bijgehouden sleutels is begrensd', () => {
  let staat = leeg();
  for (let i = 0; i < 1200; i++) staat = registreerMislukt(staat, 'login', `x${i}@y.be`, T0 + i).staat;
  assert.ok(Object.keys(staat.login).length <= 1000);
});

test('blob-wrappers: leesPogingen, schrijfPogingen, wijzigPogingen', async () => {
  const s = maakNepStore();
  assert.deepEqual(await leesPogingen(s), leeg());
  const { staat } = registreerMislukt(leeg(), 'login', 'a', T0);
  await schrijfPogingen(s, staat);
  assert.deepEqual(await leesPogingen(s), { versie: 1, ...staat });
  // gelijktijdige registraties voor verschillende sleutels gaan niet verloren
  await Promise.all(['b', 'c'].map(k => wijzigPogingen(s, st => registreerMislukt(st, 'login', k, T0 + 1000).staat)));
  assert.equal(Object.keys((await leesPogingen(s)).login).length, 3);
  assert.ok(s._schrijfacties.every(a => a.key === 'login-pogingen'));
});
