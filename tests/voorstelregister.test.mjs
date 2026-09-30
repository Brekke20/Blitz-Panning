import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leesRegister, schrijfVoorstel, wisVoorstel, markeerBevestigd } from '../netlify/lib/voorstelregister.js';

function nepStore() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
  };
}

test('schrijft meerdere doelgroepen in één keer', async () => {
  const s = nepStore();
  const r = await schrijfVoorstel(s, { ticketId: '1', doelgroepen: ['klant', 'installateur'], tijdstip: 'T1' });
  assert.deepEqual(r, { ok: true, versie: 1 });
  const reg = await leesRegister(s);
  assert.equal(reg.versie, 1);
  assert.equal(reg.status['1'].klant, 'T1');
  assert.equal(reg.status['1'].installateur, 'T1');
});

test('versieconflict geeft conflict', async () => {
  const s = nepStore();
  await schrijfVoorstel(s, { ticketId: '1', doelgroepen: ['klant'], tijdstip: 'T1' });
  const r = await schrijfVoorstel(s, { ticketId: '1', doelgroepen: ['klant'], tijdstip: 'T2', versie: 0 });
  assert.deepEqual(r, { conflict: true, serverVersie: 1 });
  assert.equal((await leesRegister(s)).status['1'].klant, 'T1');
});

test('reset wist oude doelgroep, tijdslot en bevestigd', async () => {
  const s = nepStore();
  await schrijfVoorstel(s, { ticketId: '1', doelgroepen: ['klant'], tijdstip: 'T1', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14' });
  await markeerBevestigd(s, '1', { door: 'klant', tijdstip: 'TB' });
  await schrijfVoorstel(s, { ticketId: '1', doelgroepen: ['installateur'], tijdstip: 'T2', reset: true });
  assert.deepEqual((await leesRegister(s)).status['1'], { installateur: 'T2' });
});

test('zonder reset blijven bestaande velden', async () => {
  const s = nepStore();
  await schrijfVoorstel(s, { ticketId: '1', doelgroepen: ['klant'], tijdstip: 'T1', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14' });
  await schrijfVoorstel(s, { ticketId: '1', doelgroepen: ['contact'], tijdstip: 'T2' });
  const e = (await leesRegister(s)).status['1'];
  assert.equal(e.klant, 'T1');
  assert.equal(e.contact, 'T2');
  assert.equal(e.tijdslot, '08:30–11:30');
});

test('ongeldig tijdslot wordt genegeerd', async () => {
  const s = nepStore();
  await schrijfVoorstel(s, { ticketId: '1', doelgroepen: ['klant'], tijdstip: 'T1', tijdslot: 'xx', tijdslotDatum: '2026-10-14' });
  await schrijfVoorstel(s, { ticketId: '2', doelgroepen: ['klant'], tijdstip: 'T1', tijdslot: '08:30–11:30', tijdslotDatum: 'nope' });
  const reg = await leesRegister(s);
  assert.equal(reg.status['1'].tijdslot, undefined);
  assert.equal(reg.status['2'].tijdslot, undefined);
  assert.equal(reg.status['2'].tijdslotDatum, undefined);
});

test('wisVoorstel verwijdert entry en verhoogt versie, ook als entry niet bestaat', async () => {
  const s = nepStore();
  await schrijfVoorstel(s, { ticketId: '1', doelgroepen: ['klant'], tijdstip: 'T1' });
  assert.deepEqual(await wisVoorstel(s, '1'), { versie: 2 });
  assert.equal((await leesRegister(s)).status['1'], undefined);
  assert.deepEqual(await wisVoorstel(s, '999'), { versie: 3 });
});

test('markeerBevestigd bewaart door en tijdstip, ook met door:null', async () => {
  const s = nepStore();
  await markeerBevestigd(s, '5', { door: 'klant', tijdstip: 'TB' });
  assert.deepEqual((await leesRegister(s)).status['5'].bevestigd, { door: 'klant', tijdstip: 'TB' });
  const r = await markeerBevestigd(s, '5', { door: null, tijdstip: 'TC' });
  assert.equal(r.versie, 2);
  assert.deepEqual((await leesRegister(s)).status['5'].bevestigd, { door: null, tijdstip: 'TC' });
});
