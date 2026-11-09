import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leesRegister, schrijfVoorstel, wisVoorstel, markeerBevestigd, markeerAfgewezen, markeerHerinnering } from '../netlify/lib/voorstelregister.js';

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

test('markeerAfgewezen vervangt de entry door enkel { afgewezen } (geen voorstel-vergrendeling meer), met opmerking', async () => {
  const s = nepStore();
  await schrijfVoorstel(s, { ticketId: '7', doelgroepen: ['klant', 'contact'], tijdstip: 'T1', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14' });
  const r = await markeerAfgewezen(s, '7', { door: 'klant', tijdstip: 'TA', opmerking: 'Liever na 20 oktober' });
  assert.equal(r.versie, 2);
  assert.deepEqual((await leesRegister(s)).status['7'], { afgewezen: { door: 'klant', tijdstip: 'TA', opmerking: 'Liever na 20 oktober' } });
});

test('markeerAfgewezen: zonder opmerking blijft het veld weg, door mag null zijn, andere tickets blijven', async () => {
  const s = nepStore();
  await schrijfVoorstel(s, { ticketId: '8', doelgroepen: ['klant'], tijdstip: 'T1' });
  await markeerAfgewezen(s, '7', { door: null, tijdstip: 'TA', opmerking: '' });
  const reg = await leesRegister(s);
  assert.deepEqual(reg.status['7'], { afgewezen: { door: null, tijdstip: 'TA' } });
  assert.equal(reg.status['8'].klant, 'T1');
});

test('een volgend voorstel (reset) wist de afwijzing; zonder reset blijft ze staan', async () => {
  const s = nepStore();
  await markeerAfgewezen(s, '7', { door: 'klant', tijdstip: 'TA', opmerking: 'x' });
  await schrijfVoorstel(s, { ticketId: '7', doelgroepen: ['klant'], tijdstip: 'T2', reset: true });
  assert.deepEqual((await leesRegister(s)).status['7'], { klant: 'T2' });
  await markeerAfgewezen(s, '7', { door: 'klant', tijdstip: 'TA', opmerking: 'x' });
  await schrijfVoorstel(s, { ticketId: '7', doelgroepen: ['contact'], tijdstip: 'T3' });
  assert.ok((await leesRegister(s)).status['7'].afgewezen);
});

test('markeerBevestigd bewaart bij een bevestiging per mail ook wie het registreerde (enkel als `wie` is meegegeven)', async () => {
  const s = nepStore();
  await markeerBevestigd(s, '6', { door: 'mail', tijdstip: 'TM', wie: 'Petra Planner' });
  assert.deepEqual((await leesRegister(s)).status['6'].bevestigd, { door: 'mail', tijdstip: 'TM', wie: 'Petra Planner' });
  await markeerBevestigd(s, '6', { door: 'mail', tijdstip: 'TN', wie: '' });
  assert.deepEqual((await leesRegister(s)).status['6'].bevestigd, { door: 'mail', tijdstip: 'TN' });
});

test('markeerHerinnering bewaart datum en tijdstip naast het voorstel (met overgeslagen enkel als meegegeven)', async () => {
  const s = nepStore();
  await schrijfVoorstel(s, { ticketId: '9', doelgroepen: ['klant'], tijdstip: 'T1', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14' });
  const r = await markeerHerinnering(s, '9', { datum: '2026-10-14', tijdstip: 'TH' });
  assert.equal(r.versie, 2);
  assert.deepEqual((await leesRegister(s)).status['9'], { klant: 'T1', tijdslot: '08:30–11:30', tijdslotDatum: '2026-10-14', herinnering: { datum: '2026-10-14', tijdstip: 'TH' } });
  await markeerHerinnering(s, '9', { datum: '2026-10-14', tijdstip: 'TH2', overgeslagen: 'mailantwoord' });
  assert.deepEqual((await leesRegister(s)).status['9'].herinnering, { datum: '2026-10-14', tijdstip: 'TH2', overgeslagen: 'mailantwoord' });
});

test('een volgend voorstel (reset) wist zowel de afwijzing als de herinnering; zonder reset blijft de herinnering', async () => {
  const s = nepStore();
  await schrijfVoorstel(s, { ticketId: '9', doelgroepen: ['klant'], tijdstip: 'T1' });
  await markeerHerinnering(s, '9', { datum: '2026-10-14', tijdstip: 'TH' });
  await markeerAfgewezen(s, '8', { door: 'klant', tijdstip: 'TA', opmerking: 'x' });
  await schrijfVoorstel(s, { ticketId: '9', doelgroepen: ['contact'], tijdstip: 'T2' });
  assert.ok((await leesRegister(s)).status['9'].herinnering);
  await schrijfVoorstel(s, { ticketId: '9', doelgroepen: ['contact'], tijdstip: 'T3', reset: true });
  await schrijfVoorstel(s, { ticketId: '8', doelgroepen: ['klant'], tijdstip: 'T3', reset: true });
  const reg = await leesRegister(s);
  assert.deepEqual(reg.status['9'], { contact: 'T3' });
  assert.deepEqual(reg.status['8'], { klant: 'T3' });
});
