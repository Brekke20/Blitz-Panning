import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HERHAALSCHEMA_MIN, MAX_POGINGEN, VASTGELOPEN_NA_MIN, EINDSTATUSSEN,
  nieuweVerwerking, naFout, isVastgelopen, moetStarten, verwerkRapport,
} from '../netlify/lib/rapport-verwerking.js';
import {
  INHOUD_PREFIX, isGeldigId, schrijfInhoud, leesInhoud, verwijderInhoud,
} from '../netlify/lib/rapport-inhoud.js';
import { TEST_MISLUKT_TICKETID, testUpload } from '../netlify/lib/rapport-testupload.js';
import { LIJST_KEY } from '../netlify/lib/rapportlijst.js';

const MIN = 60_000;
const NU = new Date('2026-10-08T10:00:00.000Z');
const plus = (d, min) => new Date(d.getTime() + min * MIN);

function nepStore() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
  };
}

const ID = '11111111-2222-4333-8444-555555555555';

async function opzet({ status = 'wacht', pogingen = 0, metInhoud = true, extra = {} } = {}) {
  const store = nepStore();
  const entry = {
    id: ID, ticketId: '1001', datum: '2026-10-08',
    verwerking: { ...nieuweVerwerking(status, NU), pogingen },
    ...extra,
  };
  await store.setJSON(LIJST_KEY, { versie: 1, rapports: [entry] });
  if (metInhoud) await schrijfInhoud(store, { id: ID, html: '<p>x</p>', ticketId: '1001', filename: 'r.pdf', isLocal: false }, NU);
  return store;
}
const entryVan = async store => (await store.get(LIJST_KEY)).rapports[0];

test('constanten', () => {
  assert.deepEqual(HERHAALSCHEMA_MIN, [5, 15, 30, 60, 120]);
  assert.equal(MAX_POGINGEN, 6);
  assert.equal(VASTGELOPEN_NA_MIN, 20);
  assert.deepEqual(EINDSTATUSSEN, ['in-zoho', 'lokaal', 'geannuleerd']);
});

test('nieuweVerwerking', () => {
  assert.deepEqual(nieuweVerwerking('wacht', NU), {
    status: 'wacht', pogingen: 0, volgendePoging: null, laatsteFout: null, bijgewerkt: NU.toISOString(),
  });
});

test('naFout: herhaalschema 5/15/30/60/120 min, zesde poging wordt mislukt', () => {
  let v = nieuweVerwerking('bezig', NU);
  for (const min of HERHAALSCHEMA_MIN) {
    v = naFout(v, 'kapot', NU);
    assert.equal(v.status, 'wacht');
    assert.equal(v.volgendePoging, plus(NU, min).toISOString());
    assert.equal(v.laatsteFout, 'kapot');
  }
  assert.equal(v.pogingen, 5);
  v = naFout(v, 'weer kapot', NU);
  assert.equal(v.status, 'mislukt');
  assert.equal(v.pogingen, 6);
  assert.equal(v.volgendePoging, null);
  assert.equal(v.laatsteFout, 'weer kapot');
  assert.equal(v.bijgewerkt, NU.toISOString());
});

test('naFout met maxPogingen 1 wordt direct mislukt', () => {
  const v = naFout(nieuweVerwerking('bezig', NU), 'x', NU, 1);
  assert.equal(v.status, 'mislukt');
  assert.equal(v.volgendePoging, null);
});

test('moetStarten en isVastgelopen', () => {
  const wacht = (volgendePoging) => ({ verwerking: { status: 'wacht', pogingen: 1, volgendePoging, bijgewerkt: NU.toISOString() } });
  assert.equal(moetStarten(wacht(plus(NU, -1).toISOString()), NU), true);
  assert.equal(moetStarten(wacht(plus(NU, 5).toISOString()), NU), false);
  assert.equal(moetStarten(wacht(null), NU), true);
  const bezig = min => ({ verwerking: { status: 'bezig', pogingen: 0, volgendePoging: null, bijgewerkt: plus(NU, -min).toISOString() } });
  assert.equal(moetStarten(bezig(21), NU), true);
  assert.equal(moetStarten(bezig(5), NU), false);
  assert.equal(isVastgelopen(bezig(21), NU), true);
  assert.equal(isVastgelopen(bezig(5), NU), false);
  assert.equal(isVastgelopen(wacht(null), NU), false);
  // oude entry zonder verwerking: nooit starten (geen nieuwe-flow-rapport)
  assert.equal(moetStarten({ id: 'x', zohoUploaded: false }, NU), false);
  for (const status of ['in-zoho', 'mislukt', 'lokaal']) {
    assert.equal(moetStarten({ verwerking: { status, bijgewerkt: plus(NU, -999).toISOString(), volgendePoging: plus(NU, -999).toISOString() } }, NU), false);
  }
});

test('rapport-inhoud: schrijven, lezen, verwijderen, id-validatie', async () => {
  const store = nepStore();
  assert.equal(INHOUD_PREFIX, 'rapport-inhoud/');
  assert.equal(isGeldigId(ID), true);
  assert.equal(isGeldigId('../x'), false);
  assert.equal(isGeldigId(''), false);
  assert.equal(isGeldigId(undefined), false);
  await schrijfInhoud(store, { id: ID, html: '<b/>', ticketId: '5', filename: 'f.pdf', isLocal: true }, NU);
  assert.ok(store.m.has(INHOUD_PREFIX + ID));
  assert.deepEqual(await leesInhoud(store, ID), {
    id: ID, html: '<b/>', ticketId: '5', filename: 'f.pdf', isLocal: true, aangemaakt: NU.toISOString(),
  });
  await verwijderInhoud(store, ID);
  assert.equal(await leesInhoud(store, ID), null);
  // best-effort: slikt fouten
  await verwijderInhoud({ delete: async () => { throw new Error('x'); } }, ID);
});

test('verwerkRapport succes: in-zoho, upload kreeg verzendId gelijk aan id', async () => {
  const store = await opzet();
  let kreeg;
  const upload = async a => { kreeg = a; return { attachmentId: 'att-9' }; };
  const r = await verwerkRapport(ID, { store, upload, nu: () => NU });
  assert.deepEqual(r, { resultaat: 'in-zoho' });
  assert.deepEqual(kreeg, { html: '<p>x</p>', ticketId: '1001', filename: 'r.pdf', verzendId: ID });
  const e = await entryVan(store);
  assert.equal(e.verwerking.status, 'in-zoho');
  assert.equal(e.zohoUploaded, true);
  assert.equal(e.zohoAttachmentId, 'att-9');
  assert.equal(e.geannuleerd, false);
  assert.equal(e.verwerking.laatsteFout, null);
});

test('verwerkRapport fout: wacht met pogingen 1; zesde fout wordt mislukt', async () => {
  const store = await opzet();
  const upload = async () => { throw new Error('Zoho 500'); };
  const r = await verwerkRapport(ID, { store, upload, nu: () => NU });
  assert.deepEqual(r, { resultaat: 'wacht' });
  let e = await entryVan(store);
  assert.equal(e.verwerking.status, 'wacht');
  assert.equal(e.verwerking.pogingen, 1);
  assert.match(e.verwerking.laatsteFout, /Zoho 500/);
  assert.equal(e.verwerking.volgendePoging, plus(NU, 5).toISOString());

  const store6 = await opzet({ pogingen: 5 });
  const r6 = await verwerkRapport(ID, { store: store6, upload, nu: () => NU });
  assert.deepEqual(r6, { resultaat: 'mislukt' });
  e = await entryVan(store6);
  assert.equal(e.verwerking.status, 'mislukt');
  assert.equal(e.verwerking.volgendePoging, null);
});

test('verwerkRapport met maxPogingen 1 is meteen mislukt', async () => {
  const store = await opzet();
  const r = await verwerkRapport(ID, { store, upload: async () => { throw new Error('x'); }, nu: () => NU, maxPogingen: 1 });
  assert.deepEqual(r, { resultaat: 'mislukt' });
});

test('verwerkRapport: eindstatus wordt overgeslagen zonder upload; onbekend id is niet-gevonden', async () => {
  const store = await opzet({ status: 'in-zoho' });
  let aangeroepen = false;
  const upload = async () => { aangeroepen = true; return { attachmentId: 'a' }; };
  assert.deepEqual(await verwerkRapport(ID, { store, upload }), { resultaat: 'overgeslagen' });
  assert.equal(aangeroepen, false);
  assert.deepEqual(await verwerkRapport('bestaat-niet', { store, upload }), { resultaat: 'niet-gevonden' });
  assert.equal(aangeroepen, false);
});

test('verwerkRapport: inProgress geeft al-bezig, status blijft bezig', async () => {
  const store = await opzet();
  const r = await verwerkRapport(ID, { store, upload: async () => ({ inProgress: true }), nu: () => NU });
  assert.deepEqual(r, { resultaat: 'al-bezig' });
  const e = await entryVan(store);
  assert.equal(e.verwerking.status, 'bezig');
  assert.equal(e.verwerking.pogingen, 0);
});

test('verwerkRapport: ontbrekende inhoud geeft wacht met "Rapportinhoud ontbreekt"', async () => {
  const store = await opzet({ metInhoud: false });
  let aangeroepen = false;
  const r = await verwerkRapport(ID, { store, upload: async () => { aangeroepen = true; return {}; }, nu: () => NU });
  assert.deepEqual(r, { resultaat: 'wacht' });
  assert.equal(aangeroepen, false);
  const e = await entryVan(store);
  assert.equal(e.verwerking.status, 'wacht');
  assert.equal(e.verwerking.laatsteFout, 'Rapportinhoud ontbreekt');
});

test('verwerkRapport: mislukte lijst-write (ok:false) gooit een fout', async () => {
  const store = await opzet();
  // schrijver die elke write meteen ongedaan maakt: de read-back-controle faalt altijd
  const origineel = await store.get(LIJST_KEY);
  store.setJSON = async (k, v) => { store.m.set(k, JSON.stringify(k === LIJST_KEY ? origineel : v)); };
  await assert.rejects(() => verwerkRapport(ID, { store, upload: async () => ({ attachmentId: 'a' }), nu: () => NU }));
});

test('testUpload: slaagt voor 1001, faalt voor p2', async () => {
  assert.equal(TEST_MISLUKT_TICKETID, 'p2');
  assert.deepEqual(await testUpload({ ticketId: '1001' }), { attachmentId: 'test-bijlage' });
  await assert.rejects(() => testUpload({ ticketId: 'p2' }), /Testfout: Zoho onbereikbaar/);
});
