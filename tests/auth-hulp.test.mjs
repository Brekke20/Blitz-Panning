// tests/auth-hulp.test.mjs — de testhulp tests/auth-hulp.mjs zelf
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { vereisGebruiker } from '../netlify/lib/auth.js';
import { metRol, metGeenSessie, zetStandaard } from './auth-hulp.mjs';

const req = (headers = {}, methode = 'GET') => ({ httpMethod: methode, headers });

test('metRol: vereisGebruiker ziet de rol en na afloop is de vorige instelling hersteld', async () => {
  const binnen = await metRol('planner', () => vereisGebruiker(req()));
  assert.equal(binnen.ok, true);
  assert.equal(binnen.gebruiker.rol, 'planner');
  const erna = await vereisGebruiker(req());
  assert.deepEqual([erna.ok, erna.status, erna.code], [false, 401, 'niet-ingelogd']);
});

test('metRol herstelt ook als werk gooit, en geeft de fout door', async () => {
  await assert.rejects(metRol('beheerder', () => { throw new Error('boem'); }), /boem/);
  assert.equal((await vereisGebruiker(req())).status, 401);
});

test('metRol: nestbaar, de buitenste instelling komt terug', async () => {
  await metRol('beheerder', async () => {
    await metRol('planner', async () => assert.equal((await vereisGebruiker(req())).gebruiker.rol, 'planner'));
    assert.equal((await vereisGebruiker(req())).gebruiker.rol, 'beheerder');
  });
});

test('metRol: technieker heeft standaard zohoNaam Tim, met optie Roel', async () => {
  assert.equal((await metRol('technieker', () => vereisGebruiker(req()))).gebruiker.zohoNaam, 'Tim');
  assert.equal((await metRol('technieker', () => vereisGebruiker(req()), { zohoNaam: 'Roel' })).gebruiker.zohoNaam, 'Roel');
});

test('metRol: sales heeft salesNaam Test Verkoper en magAlleSales volgt de optie', async () => {
  const standaard = (await metRol('sales', () => vereisGebruiker(req()))).gebruiker;
  assert.equal(standaard.salesNaam, 'Test Verkoper');
  assert.equal(standaard.magAlleSales, false);
  assert.equal((await metRol('sales', () => vereisGebruiker(req()), { magAlleSales: true })).gebruiker.magAlleSales, true);
});

test('metRol: houdt de rollencontrole, geeft de waarde van werk terug en weigert een onbekende rol', async () => {
  const r = await metRol('planner', () => vereisGebruiker(req(), { rollen: ['beheerder'] }));
  assert.deepEqual([r.status, r.code], [403, 'geen-recht']);
  assert.equal(await metRol('planner', async () => 42), 42);
  await assert.rejects(metRol('root', async () => 1), /rol/i);
});

test('metGeenSessie: echte cookiecontrole zonder cookie geeft 401 niet-ingelogd, ook binnen metRol', async () => {
  const r = await metGeenSessie(() => vereisGebruiker(req()));
  assert.deepEqual([r.ok, r.status, r.code], [false, 401, 'niet-ingelogd']);
  await metRol('beheerder', async () => {
    const binnen = await metGeenSessie(() => vereisGebruiker(req()));
    assert.equal(binnen.status, 401);
    assert.equal((await vereisGebruiker(req())).gebruiker.rol, 'beheerder');
  });
});

test('zetStandaard: metRol en metGeenSessie herstellen na afloop de standaard', async () => {
  zetStandaard({ vasteGebruiker: { id: 'std', email: '', naam: 'Std', rol: 'beheerder' } });
  try {
    assert.equal((await vereisGebruiker(req())).gebruiker.id, 'std');
    await metRol('planner', async () => assert.equal((await vereisGebruiker(req())).gebruiker.rol, 'planner'));
    assert.equal((await vereisGebruiker(req())).gebruiker.id, 'std');
    await metGeenSessie(async () => assert.equal((await vereisGebruiker(req())).status, 401));
    assert.equal((await vereisGebruiker(req())).gebruiker.id, 'std');
  } finally { zetStandaard(null); }
  assert.equal((await vereisGebruiker(req())).status, 401);
});
