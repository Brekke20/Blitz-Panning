import test from 'node:test';
import assert from 'node:assert/strict';
import { maakUploader, markeerLijstUpgeload } from '../netlify/lib/rapport-upload.js';
import { REGISTER_KEY } from '../netlify/lib/rapport-register.js';
import { LIJST_KEY } from '../netlify/lib/rapportlijst.js';

const ID = '0b6c1f2e-1111-4222-8333-444455556666';

function maakStore(initieel = {}) {
  const m = new Map(Object.entries(initieel).map(([k, v]) => [k, JSON.stringify(v)]));
  const writes = [];
  return {
    m, writes,
    async get(k, opt) { if (!m.has(k)) return null; const v = m.get(k); return opt?.type === 'json' ? JSON.parse(v) : v; },
    async setJSON(k, v) { writes.push(k); m.set(k, JSON.stringify(v)); },
  };
}
const lees = (store, k) => JSON.parse(store.m.get(k));

function maakNepjes({ zohoFout = false } = {}) {
  const calls = { pdf: 0, zoho: 0, zohoArgs: null };
  return {
    calls,
    maakPdf: async html => { calls.pdf++; calls.html = html; return Buffer.from('PDF'); },
    uploadPdfNaarZoho: async args => {
      calls.zoho++; calls.zohoArgs = args;
      if (zohoFout) throw new Error('{"errorCode":"X"}');
      return 'ATT-1';
    },
  };
}
const ARGS = { html: '<p>x</p>', ticketId: '123', filename: 'r.pdf' };

test('nieuwe upload: PDF + Zoho één keer, register krijgt done:true met attachmentId', async () => {
  const store = maakStore();
  const n = maakNepjes();
  const upload = maakUploader(n);
  const res = await upload({ ...ARGS, verzendId: ID, store });
  assert.deepEqual(res, { attachmentId: 'ATT-1' });
  assert.equal(n.calls.pdf, 1);
  assert.equal(n.calls.zoho, 1);
  assert.deepEqual(n.calls.zohoArgs.ticketId, '123');
  assert.equal(n.calls.zohoArgs.filename, 'r.pdf');
  assert.equal(n.calls.zohoArgs.pdfBuffer.toString(), 'PDF');
  const reg = lees(store, REGISTER_KEY);
  assert.equal(reg.entries[ID].done, true);
  assert.equal(reg.entries[ID].zohoAttachmentId, 'ATT-1');
  assert.equal(reg.entries[ID].uploadInFlightSince, null);
});

test('tweede aanroep met zelfde verzendId: geen PDF/Zoho, alUploaded:true met dezelfde attachmentId', async () => {
  const store = maakStore();
  const n = maakNepjes();
  const upload = maakUploader(n);
  await upload({ ...ARGS, verzendId: ID, store });
  const res = await upload({ ...ARGS, verzendId: ID, store });
  assert.deepEqual(res, { attachmentId: 'ATT-1', alUploaded: true });
  assert.equal(n.calls.pdf, 1);
  assert.equal(n.calls.zoho, 1);
});

test('actieve reservering van een andere poging → { inProgress:true }, geen PDF', async () => {
  const store = maakStore({ [REGISTER_KEY]: { versie: 1, entries: { [ID]: { verzendId: ID, uploadInFlightSince: new Date().toISOString() } } } });
  const n = maakNepjes();
  const res = await maakUploader(n)({ ...ARGS, verzendId: ID, store });
  assert.deepEqual(res, { inProgress: true });
  assert.equal(n.calls.pdf, 0);
  assert.equal(n.calls.zoho, 0);
});

test('Zoho-fout: gooit, reservering is gewist (volgende poging mag direct)', async () => {
  const store = maakStore();
  const n = maakNepjes({ zohoFout: true });
  const upload = maakUploader(n);
  await assert.rejects(() => upload({ ...ARGS, verzendId: ID, store }), /errorCode/);
  const reg = lees(store, REGISTER_KEY);
  assert.equal(reg.entries[ID].uploadInFlightSince, null);
  assert.notEqual(reg.entries[ID].done, true);
  // volgende poging mag direct door (geen inProgress)
  const n2 = maakNepjes();
  assert.deepEqual(await maakUploader(n2)({ ...ARGS, verzendId: ID, store }), { attachmentId: 'ATT-1' });
});

test('PDF-fout: gooit ook, reservering gewist', async () => {
  const store = maakStore();
  const upload = maakUploader({ maakPdf: async () => { throw new Error('chromium kapot'); }, uploadPdfNaarZoho: async () => 'x' });
  await assert.rejects(() => upload({ ...ARGS, verzendId: ID, store }), /chromium kapot/);
  assert.equal(lees(store, REGISTER_KEY).entries[ID].uploadInFlightSince, null);
});

test('store null: upload gaat gewoon door zonder register', async () => {
  const n = maakNepjes();
  const res = await maakUploader(n)({ ...ARGS, verzendId: ID, store: null });
  assert.deepEqual(res, { attachmentId: 'ATT-1' });
  assert.equal(n.calls.zoho, 1);
});

test('geen verzendId: geen register-I/O, upload gaat door', async () => {
  const store = maakStore();
  const n = maakNepjes();
  const res = await maakUploader(n)({ ...ARGS, verzendId: null, store });
  assert.deepEqual(res, { attachmentId: 'ATT-1' });
  assert.equal(store.writes.length, 0);
});

test('falende store: upload gaat gewoon door en gooit niet', async () => {
  const kapot = { async get() { throw new Error('blobs down'); }, async setJSON() { throw new Error('blobs down'); } };
  const n = maakNepjes();
  const res = await maakUploader(n)({ ...ARGS, verzendId: ID, store: kapot });
  assert.deepEqual(res, { attachmentId: 'ATT-1' });
  assert.equal(n.calls.zoho, 1);
});

test('markeerLijstUpgeload zet zohoUploaded/zohoAttachmentId op de entry met dat id; geen match = geen write', async () => {
  const store = maakStore({ [LIJST_KEY]: { versie: 4, rapports: [{ id: ID, geannuleerd: false }, { id: 'ander' }] } });
  await markeerLijstUpgeload(store, ID, 'ATT-9');
  const lijst = lees(store, LIJST_KEY);
  assert.equal(lijst.versie, 5);
  assert.equal(lijst.rapports[0].zohoUploaded, true);
  assert.equal(lijst.rapports[0].zohoAttachmentId, 'ATT-9');
  assert.equal(lijst.rapports[1].zohoUploaded, undefined);

  const store2 = maakStore({ [LIJST_KEY]: { versie: 1, rapports: [{ id: 'ander' }] } });
  await markeerLijstUpgeload(store2, ID, 'ATT-9');
  assert.equal(store2.writes.length, 0);
});

test('markeerLijstUpgeload: geen verzendId/store of falende store gooit nooit', async () => {
  await markeerLijstUpgeload(null, ID, 'A');
  await markeerLijstUpgeload(maakStore(), null, 'A');
  await markeerLijstUpgeload({ async get() { throw new Error('x'); } }, ID, 'A');
});

test('markeerLijstUpgeload: herhaalt (max 3x) als een gelijktijdige schrijver overschrijft', async () => {
  const store = maakStore({ [LIJST_KEY]: { versie: 1, rapports: [{ id: ID }] } });
  let n = 0;
  const origSet = store.setJSON.bind(store);
  // eerste write wordt meteen overschreven door een "collega" (label weg)
  store.setJSON = async (k, v) => {
    n++;
    await origSet(k, v);
    if (n === 1) await origSet(k, { versie: v.versie + 1, rapports: [{ id: ID }, { id: 'nieuw' }] });
  };
  await markeerLijstUpgeload(store, ID, 'ATT-2');
  const lijst = lees(store, LIJST_KEY);
  assert.equal(n, 2);
  assert.equal(lijst.rapports.find(r => r.id === ID).zohoAttachmentId, 'ATT-2');
  assert.ok(lijst.rapports.find(r => r.id === 'nieuw'));
});
