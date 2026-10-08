// tests/activiteit.test.mjs — netlify/lib/activiteit.js
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { maakNepStore } from './nep-blobs.mjs';
import { logActiviteit, logVoorVerzoek, leesActiviteit, ruimActiviteitOp } from '../netlify/lib/activiteit.js';

const NU = Date.parse('2026-10-08T08:00:00Z');
const g = { id: 'u-1', naam: 'Tim', email: 'tim@blitz.be', wachtwoordHash: 'geheim' };

test('logActiviteit schrijft in activiteit/<maand> en voegt toe', async () => {
  const s = maakNepStore();
  await logActiviteit(s, { gebruiker: g, actie: 'login' }, { nu: () => NU });
  await logActiviteit(s, { gebruiker: g, actie: 'gebruiker-aangemaakt', onderwerp: 'u-2', details: 'rol planner' }, { nu: () => NU + 1000 });
  const blob = await s.get('activiteit/2026-10', { type: 'json' });
  assert.equal(blob.items.length, 2);
  assert.deepEqual(blob.items[0], { op: '2026-10-08T08:00:00.000Z', gebruikerId: 'u-1', naam: 'Tim', actie: 'login', onderwerp: null, details: null });
  assert.equal(blob.items[1].onderwerp, 'u-2');
  assert.equal(blob.items[1].details, 'rol planner');
  assert.ok(!JSON.stringify(blob).includes('geheim'), 'enkel id en naam van de gebruiker');
  assert.equal(blob.versie, 2);
});

test('logActiviteit snijdt details af op 500 tekens en accepteert de systeem-gebruiker', async () => {
  const s = maakNepStore();
  await logActiviteit(s, { gebruiker: { id: 'systeem', naam: 'Systeem' }, actie: 'x', details: 'a'.repeat(900) }, { nu: () => NU });
  const it = (await s.get('activiteit/2026-10', { type: 'json' })).items[0];
  assert.equal(it.details.length, 500);
  assert.equal(it.gebruikerId, 'systeem');
});

test('logActiviteit gooit niet bij een falende store', async () => {
  const stuk = { async get() { throw new Error('stuk'); }, async setJSON() { throw new Error('stuk'); }, async set() { throw new Error('stuk'); } };
  await assert.doesNotReject(() => logActiviteit(stuk, { gebruiker: g, actie: 'login' }));
  await assert.doesNotReject(() => logActiviteit(null, { gebruiker: g, actie: 'login' }));
});

test('logActiviteit: gelijktijdige items gaan niet verloren', async () => {
  const s = maakNepStore();
  await Promise.all([1, 2, 3].map(i => logActiviteit(s, { gebruiker: g, actie: `a${i}` }, { nu: () => NU + i })));
  assert.equal((await s.get('activiteit/2026-10', { type: 'json' })).items.length, 3);
});

test('logVoorVerzoek slaat testverzoeken over en gooit niet als getStore gooit', async () => {
  const s = maakNepStore();
  const getStore = ({ name }) => { assert.equal(name, 'blitz-data'); return s; };
  await logVoorVerzoek({ headers: { 'X-Blitz-Test': '1' } }, g, { actie: 'login' }, { getStore });
  assert.equal(s._data.size, 0);
  await logVoorVerzoek({ headers: new Headers({ 'x-blitz-test': '1' }) }, g, { actie: 'login' }, { getStore });
  assert.equal(s._data.size, 0);
  await logVoorVerzoek({ headers: {} }, g, { actie: 'login', onderwerp: 'o' }, { getStore, nu: () => NU });
  assert.equal((await s.get('activiteit/2026-10', { type: 'json' })).items[0].onderwerp, 'o');
  await assert.doesNotReject(() => logVoorVerzoek({ headers: {} }, g, { actie: 'x' }, { getStore: () => { throw new Error('geen store'); } }));
});

async function gevuldeStore() {
  const s = maakNepStore();
  const l = (gebruiker, actie, nu) => logActiviteit(s, { gebruiker, actie }, { nu: () => nu });
  const tim = { id: 'u-1', naam: 'Tim' }, an = { id: 'u-2', naam: 'An' };
  await l(tim, 'login', Date.parse('2026-09-30T10:00:00Z'));
  await l(an, 'login', Date.parse('2026-09-30T11:00:00Z'));
  await l(tim, 'wijzig', Date.parse('2026-10-02T10:00:00Z'));
  await l(an, 'login', Date.parse('2026-10-03T10:00:00Z'));
  return s;
}

test('leesActiviteit: nieuwste eerst, filters over twee maand-blobs', async () => {
  const s = await gevuldeStore();
  const alles = await leesActiviteit(s, {});
  assert.deepEqual(alles.map(i => i.op), ['2026-10-03T10:00:00.000Z', '2026-10-02T10:00:00.000Z', '2026-09-30T11:00:00.000Z', '2026-09-30T10:00:00.000Z']);
  assert.equal((await leesActiviteit(s, { gebruikerId: 'u-2' })).length, 2);
  assert.equal((await leesActiviteit(s, { actie: 'wijzig' })).length, 1);
  const periode = await leesActiviteit(s, { van: '2026-09-30T10:30:00Z', tot: '2026-10-02T23:59:59Z' });
  assert.deepEqual(periode.map(i => i.actie), ['wijzig', 'login']);
  assert.equal((await leesActiviteit(s, { van: '2026-10-01T00:00:00Z' })).length, 2);
  assert.deepEqual(await leesActiviteit(maakNepStore(), {}), []);
});

test('leesActiviteit: maximaal 1000 items', async () => {
  const items = Array.from({ length: 1200 }, (_, i) => ({ op: new Date(NU + i * 1000).toISOString(), gebruikerId: 'u', naam: 'n', actie: 'a', onderwerp: null, details: null }));
  const s = maakNepStore({ 'activiteit/2026-10': { versie: 1, items } });
  const r = await leesActiviteit(s, {});
  assert.equal(r.length, 1000);
  assert.equal(r[0].op, items[1199].op);
});

test('ruimActiviteitOp verwijdert alles ouder dan 12 maanden', async () => {
  const s = maakNepStore({ 'activiteit/2025-09': { items: [] }, 'activiteit/2025-10': { items: [] }, 'activiteit/2026-10': { items: [] }, gebruikers: {} });
  const weg = await ruimActiviteitOp(s, { nu: Date.parse('2026-10-08T00:00:00Z') });
  assert.deepEqual(weg, ['activiteit/2025-09']);
  assert.ok(!s._data.has('activiteit/2025-09'));
  assert.ok(s._data.has('activiteit/2025-10') && s._data.has('gebruikers'));
  assert.deepEqual(await ruimActiviteitOp(s, { nu: Date.parse('2026-10-08T00:00:00Z'), maanden: 1 }), ['activiteit/2025-10']);
});
