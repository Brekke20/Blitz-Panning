import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bouwEntry, voegToeOfWerkBij, MAX_RAPPORTEN } from '../netlify/lib/rapportlijst.js';
import {
  ARCHIEF_PREFIX, archiefSleutel, archiveerAfgevallen, archiefJaren, leesArchieven,
} from '../netlify/lib/rapport-jaararchief.js';
import { verwerkOntvangst } from '../netlify/lib/rapport-ontvangst.js';
import { verwerkRapport } from '../netlify/lib/rapport-verwerking.js';
import { schrijfInhoud } from '../netlify/lib/rapport-inhoud.js';

// Nep-store; `verliesEerste(sleutel)` laat de eerste schrijfactie voor die sleutel stil verloren
// gaan, `faalOp(sleutel)` laat get/setJSON voor die sleutel gooien.
function nepStore({ verliesEerste, faalOp, naSchrijf, delFaalt } = {}) {
  const m = new Map();
  const verloren = new Set();
  let writes = 0;
  return {
    m,
    async get(k, opt) {
      if (faalOp?.(k)) throw new Error('lees-fout ' + k);
      if (!m.has(k)) return null;
      const v = m.get(k);
      return opt?.type === 'json' ? JSON.parse(v) : v;
    },
    async set(k, v) { m.set(k, v); },
    async setJSON(k, v) {
      if (faalOp?.(k)) throw new Error('schrijf-fout ' + k);
      if (verliesEerste?.(k) && !verloren.has(k)) { verloren.add(k); return; }
      m.set(k, JSON.stringify(v));
      naSchrijf?.(k, m, ++writes);
    },
    async delete(k) { if (delFaalt) throw new Error('delete-fout'); m.delete(k); },
  };
}
const archief = (store, jaar) => JSON.parse(store.m.get(ARCHIEF_PREFIX + jaar) ?? 'null');
const ent = (id, datum, extra = {}) => ({ id, datum, aangemaakt: '2026-01-01T00:00:00.000Z', ticketId: 't' + id, ...extra });

test('ARCHIEF_PREFIX', () => assert.equal(ARCHIEF_PREFIX, 'rapportlijst-archief-'));

test('voegToeOfWerkBij: afgevallen = de oudste entry bij 500 + 1 nieuwe', () => {
  const lijst = Array.from({ length: 500 }, (_, i) => bouwEntry({ id: 'r' + i, ticketId: 't' + i, datum: 'd' }));
  const r = voegToeOfWerkBij(lijst, bouwEntry({ id: 'nieuw', ticketId: 'n', datum: 'd' }), { id: 'nieuw' });
  assert.equal(r.rapports.length, 500);
  assert.equal(r.afgevallen.length, 1);
  assert.equal(r.afgevallen[0].id, 'r499');
});

test('voegToeOfWerkBij: afgevallen leeg bij minder dan 500; lijst van 501 geeft 1 afgevallen', () => {
  const kort = [bouwEntry({ id: 'a', ticketId: 'x', datum: 'd' })];
  assert.deepEqual(voegToeOfWerkBij(kort, bouwEntry({ id: 'b', ticketId: 'y', datum: 'd' }), { id: 'b' }).afgevallen, []);
  const lijst501 = Array.from({ length: MAX_RAPPORTEN + 1 }, (_, i) => bouwEntry({ id: 'r' + i, ticketId: 't' + i, datum: 'd' }));
  const r = voegToeOfWerkBij(lijst501, bouwEntry({ id: 'r3', ticketId: 't3', datum: 'd' }), { id: 'r3' });
  assert.equal(r.rapports.length, 500);
  assert.deepEqual(r.afgevallen.map(e => e.id), ['r500']);
});

test('archiefSleutel: jaar uit datum, dan aangemaakt, anders onbekend', () => {
  assert.equal(archiefSleutel({ datum: '2026-03-04' }), 'rapportlijst-archief-2026');
  assert.equal(archiefSleutel({ datum: '', aangemaakt: '2025-12-31T23:00:00.000Z' }), 'rapportlijst-archief-2025');
  assert.equal(archiefSleutel({ aangemaakt: '2024-05-01T00:00:00Z' }), 'rapportlijst-archief-2024');
  assert.equal(archiefSleutel({ datum: 'kapot' }), 'rapportlijst-archief-onbekend');
  assert.equal(archiefSleutel({}), 'rapportlijst-archief-onbekend');
});

test('archiveerAfgevallen: groepeert per jaar naar twee blobs', async () => {
  const store = nepStore();
  const r = await archiveerAfgevallen(store, [ent('a', '2025-12-30'), ent('b', '2026-01-02'), ent('c', '2025-06-01')]);
  assert.deepEqual(r, { ok: true, aantal: 3 });
  assert.deepEqual(archief(store, '2025').rapports.map(e => e.id), ['a', 'c']);
  assert.deepEqual(archief(store, '2026').rapports.map(e => e.id), ['b']);
  assert.equal(archief(store, '2025').versie, 1);
});

test('archiveerAfgevallen: idempotent en laat bestaande entries ongewijzigd', async () => {
  const store = nepStore();
  await archiveerAfgevallen(store, [ent('a', '2026-01-02', { klant: 'Oud' })]);
  const voor = archief(store, '2026').rapports[0];
  const r = await archiveerAfgevallen(store, [ent('a', '2026-01-02', { klant: 'Nieuw' }), ent('b', '2026-01-03')]);
  assert.deepEqual(r, { ok: true, aantal: 1 });
  const na = archief(store, '2026');
  assert.deepEqual(na.rapports.map(e => e.id), ['a', 'b']);
  assert.deepEqual(na.rapports[0], voor);
  assert.equal(na.versie, 2);
  // volledig reeds aanwezig: geen schrijfactie, versie blijft
  assert.deepEqual(await archiveerAfgevallen(store, [ent('a', '2026-01-02')]), { ok: true, aantal: 0 });
  assert.equal(archief(store, '2026').versie, 2);
  assert.deepEqual(await archiveerAfgevallen(store, []), { ok: true, aantal: 0 });
});

test('archiveerAfgevallen: zware rapportData wordt licht opgeslagen', async () => {
  const store = nepStore();
  await archiveerAfgevallen(store, [ent('a', '2026-01-02', {
    rapportData: { _html: '<p>x</p>', fotos: ['data:...'], handtekeningTech: 'x', handtekeningKlant: 'y', probleem: 'p' },
  })]);
  assert.deepEqual(archief(store, '2026').rapports[0].rapportData, { probleem: 'p' });
});

test('archiveerAfgevallen: verloren eerste schrijfactie (read-back mismatch) slaagt bij poging 2', async () => {
  const store = nepStore({ verliesEerste: k => k === ARCHIEF_PREFIX + '2026' });
  const r = await archiveerAfgevallen(store, [ent('a', '2026-01-02')]);
  assert.deepEqual(r, { ok: true, aantal: 1 });
  assert.deepEqual(archief(store, '2026').rapports.map(e => e.id), ['a']);
});

test('archiveerAfgevallen: altijd falende store geeft ok:false zonder te gooien (met ids gelogd)', async () => {
  const store = nepStore({ faalOp: () => true });
  const fouten = [];
  const orig = console.error; console.error = (...a) => fouten.push(a.join(' '));
  try {
    const r = await archiveerAfgevallen(store, [ent('verloren-id', '2026-01-02')]);
    assert.equal(r.ok, false);
  } finally { console.error = orig; }
  assert.ok(fouten.some(f => f.includes('verloren-id')));
});

test('archiveerAfgevallen: een falend jaar blokkeert de andere jaren niet', async () => {
  const store = nepStore({ faalOp: k => k === ARCHIEF_PREFIX + '2025' });
  const orig = console.error; console.error = () => {};
  let r;
  try { r = await archiveerAfgevallen(store, [ent('a', '2025-01-01'), ent('b', '2026-01-01')]); }
  finally { console.error = orig; }
  assert.equal(r.ok, false);
  assert.deepEqual(archief(store, '2026').rapports.map(e => e.id), ['b']);
});

test('archiefJaren: alle jaren van vanDatum t/m totDatum', () => {
  assert.deepEqual(archiefJaren('2025-11-20', '2026-02-01'), ['2025', '2026']);
  assert.deepEqual(archiefJaren('2026-01-01', '2026-12-31'), ['2026']);
  assert.deepEqual(archiefJaren('2024-05-01', '2026-01-01'), ['2024', '2025', '2026']);
  assert.deepEqual(archiefJaren('2026-05-01', '2025-01-01'), []);
});

test('leesArchieven: ontbrekend archief = leeg, falend jaar in fouten, de rest werkt', async () => {
  const store = nepStore({ faalOp: k => k === ARCHIEF_PREFIX + '2025' });
  store.m.set(ARCHIEF_PREFIX + '2026', JSON.stringify({ versie: 1, rapports: [ent('b', '2026-01-01')] }));
  const r = await leesArchieven(store, ['2025', '2026', '2027']);
  assert.deepEqual(r.fouten, ['2025']);
  assert.deepEqual(r.rapports.map(e => e.id), ['b']);
});

// ---- integratie ------------------------------------------------------------
const ID_NIEUW = '11111111-1111-4111-8111-111111111111';
const NU = new Date('2026-10-08T10:00:00Z');
const volleLijst = () => ({
  versie: 7,
  rapports: Array.from({ length: 500 }, (_, i) => ent('oud-' + String(499 - i).padStart(3, '0'), '2025-03-01', { ticketId: 'tt' + i })),
});
const ontvangstBody = () => ({
  id: ID_NIEUW, ticketId: '555', filename: 't.pdf', isLocal: false, html: '<p>x</p>',
  archiveBody: { datum: '2026-10-08', technieker: 'Tim', ticketId: '555', rapportData: { probleem: 'p' } },
});

test('verwerkOntvangst met volle lijst: 200 en de oudste entry staat daarna in het jaar-archief', async () => {
  const store = nepStore();
  store.m.set('rapportlijst', JSON.stringify(volleLijst()));
  const r = await verwerkOntvangst({ store, body: ontvangstBody(), nu: NU });
  assert.equal(r.status, 200);
  const lijst = JSON.parse(store.m.get('rapportlijst')).rapports;
  assert.equal(lijst.length, 500);
  assert.equal(lijst[0].id, ID_NIEUW);
  assert.deepEqual(archief(store, '2025').rapports.map(e => e.id), ['oud-000']);
});

test('verwerkOntvangst: een falend archief geeft nog steeds 200', async () => {
  const store = nepStore({ faalOp: k => k.startsWith(ARCHIEF_PREFIX) });
  store.m.set('rapportlijst', JSON.stringify(volleLijst()));
  const orig = console.error; console.error = () => {};
  let r;
  try { r = await verwerkOntvangst({ store, body: ontvangstBody(), nu: NU }); }
  finally { console.error = orig; }
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(store.m.get('rapportlijst')).rapports[0].id, ID_NIEUW);
});

test('verwerkOntvangst met lijst onder 500: geen archiefblob', async () => {
  const store = nepStore();
  const r = await verwerkOntvangst({ store, body: ontvangstBody(), nu: NU });
  assert.equal(r.status, 200);
  assert.ok(![...store.m.keys()].some(k => k.startsWith(ARCHIEF_PREFIX)));
});

test('herstelEntry (via verwerkRapport) laat de lijst niet kleiner worden', async () => {
  const store = nepStore();
  store.m.set('rapportlijst', JSON.stringify(volleLijst()));
  const verloren = { ...ent(ID_NIEUW, '2026-10-08', { ticketId: '555' }), verwerking: { status: 'wacht', pogingen: 0, volgendePoging: null, laatsteFout: null, bijgewerkt: NU.toISOString() } };
  await schrijfInhoud(store, { id: ID_NIEUW, html: '<p>x</p>', ticketId: '555', filename: 't.pdf', isLocal: false, entry: verloren }, NU);
  await verwerkRapport(ID_NIEUW, { store, upload: async () => ({ attachmentId: 'a' }), nu: () => NU });
  const lijst = JSON.parse(store.m.get('rapportlijst')).rapports;
  assert.equal(lijst.length, 501);
  assert.equal(lijst[0].id, ID_NIEUW);
  assert.equal(lijst[0].zohoUploaded, true);
});

test('archiveerAfgevallen: een corrupte archiefblob wordt nooit overschreven (ok:false, ids gelogd)', async () => {
  for (const corrupt of ['{"versie":3}', '{"versie":3,"rapports":"kapot"}', '"tekst"', '42']) {
    const store = nepStore();
    store.m.set(ARCHIEF_PREFIX + '2026', corrupt);
    const fouten = [];
    const orig = console.error; console.error = (...a) => fouten.push(a.join(' '));
    let r;
    try { r = await archiveerAfgevallen(store, [ent('nieuw-id', '2026-02-02')]); }
    finally { console.error = orig; }
    assert.equal(r.ok, false, corrupt);
    assert.equal(store.m.get(ARCHIEF_PREFIX + '2026'), corrupt, 'blob onaangeroerd');
    assert.ok(fouten.some(f => f.includes('nieuw-id')));
  }
});

test('leesArchieven: een corrupte archiefblob komt in fouten', async () => {
  const store = nepStore();
  store.m.set(ARCHIEF_PREFIX + '2025', '{"versie":1}');
  store.m.set(ARCHIEF_PREFIX + '2026', JSON.stringify({ versie: 1, rapports: [ent('b', '2026-01-01')] }));
  const r = await leesArchieven(store, ['2025', '2026']);
  assert.deepEqual(r.fouten, ['2025']);
  assert.deepEqual(r.rapports.map(e => e.id), ['b']);
});

test('verwerkOntvangst: vervangen inhoud + falende delete verliest de archivering niet en geeft 200', async () => {
  const store = nepStore({ delFaalt: true });
  const lijst = volleLijst();
  lijst.rapports.unshift(ent('al-ouder-id', '2026-10-08', { ticketId: '555' })); // 501, dedup op ticket+datum
  store.m.set('rapportlijst', JSON.stringify(lijst));
  const r = await verwerkOntvangst({ store, body: ontvangstBody(), nu: NU });
  assert.equal(r.status, 200);
  assert.deepEqual(archief(store, '2025').rapports.map(e => e.id), ['oud-000']);
});

test('verwerkOntvangst: bij een wijzigLijst-herhaling wordt de afgevallen van de LAATSTE uitvoering gearchiveerd', async () => {
  // Na de eerste lijstschrijfactie vervangt een "gelijktijdige schrijver" de lijst door een andere volle lijst
  // (zonder ons id): de read-back mislukt, poging 2 werkt op die lijst met een andere oudste entry.
  let overschreven = false;
  const store = nepStore({
    naSchrijf: (k, m) => {
      if (k !== 'rapportlijst' || overschreven) return;
      overschreven = true;
      m.set('rapportlijst', JSON.stringify({
        versie: 50,
        rapports: Array.from({ length: 500 }, (_, i) => ent('conc-' + String(499 - i).padStart(3, '0'), '2025-04-01', { ticketId: 'cc' + i })),
      }));
    },
  });
  store.m.set('rapportlijst', JSON.stringify(volleLijst()));
  const r = await verwerkOntvangst({ store, body: ontvangstBody(), nu: NU });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(store.m.get('rapportlijst')).rapports[0].id, ID_NIEUW);
  assert.deepEqual(archief(store, '2025').rapports.map(e => e.id), ['conc-000']);
});

test('archiveerAfgevallen: gelijktijdige aanroepen in dezelfde instantie verliezen niets (serieel)', async () => {
  const store = nepStore();
  const traag = store.get.bind(store);
  store.get = async (k, o) => { const v = await traag(k, o); await new Promise(r => setTimeout(r, 5)); return v; };
  const res = await Promise.all(['a', 'b', 'c', 'd'].map(id => archiveerAfgevallen(store, [ent(id, '2026-01-02')])));
  assert.ok(res.every(r => r.ok));
  assert.deepEqual(archief(store, '2026').rapports.map(e => e.id).sort(), ['a', 'b', 'c', 'd']);
  assert.equal(archief(store, '2026').versie, 4);
});
