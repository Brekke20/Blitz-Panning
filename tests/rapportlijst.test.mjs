import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIJST_KEY, MAX_RAPPORTEN, LEGE_LIJST,
  bepaalDedupVelden, stripZwareVelden, bouwEntry, voegToeOfWerkBij,
  effectieveStatus, wijzigLijst, zetOpnieuw,
} from '../netlify/lib/rapportlijst.js';

// Nep-store; `naSchrijven(aantalWrites, map)` laat een gelijktijdige schrijver simuleren.
function nepStore({ naSchrijven } = {}) {
  const m = new Map();
  let writes = 0;
  return {
    m,
    get writes() { return writes; },
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) {
      m.set(k, JSON.stringify(v));
      writes++;
      if (naSchrijven) naSchrijven(writes, m);
    },
  };
}

test('constanten', () => {
  assert.equal(LIJST_KEY, 'rapportlijst');
  assert.equal(MAX_RAPPORTEN, 500);
  assert.deepEqual(LEGE_LIJST, { versie: 0, rapports: [] });
});

test('bepaalDedupVelden: al geüploade entry kan niet alsnog geannuleerd worden', () => {
  assert.deepEqual(
    bepaalDedupVelden({ zohoUploaded: true }, true, { geannuleerd: true }),
    { zohoUploaded: true, geannuleerd: false },
  );
});

test('stripZwareVelden verwijdert _html en beide handtekeningen, laat de rest staan; null blijft null', () => {
  const r = stripZwareVelden({ _html: '<p/>', handtekeningTech: 'a', handtekeningKlant: 'b', probleem: 'x' });
  assert.deepEqual(r, { probleem: 'x' });
  assert.equal(stripZwareVelden(null), null);
});

test('stripZwareVelden verwijdert ook oude inline fotos (fotos)', () => {
  const r = stripZwareVelden({ fotos: ['data:image/jpeg;base64,AAA'], probleem: 'x' });
  assert.deepEqual(r, { probleem: 'x' });
});

test('bouwEntry licht: rapportData zonder _html/handtekeningen; niet-licht: _html blijft', () => {
  const body = { id: 'a', ticketId: '1', rapportData: { _html: '<p/>', handtekeningTech: 'a', handtekeningKlant: 'b', probleem: 'x' } };
  const licht = bouwEntry(body, { licht: true });
  assert.deepEqual(licht.rapportData, { probleem: 'x' });
  const vol = bouwEntry(body);
  assert.equal(vol.rapportData._html, '<p/>');
  assert.equal(vol.geannuleerd, false);
  assert.equal(vol.interventieType, 'Interventie');
  assert.equal(vol.nieuwInter, 'nee');
  assert.equal(bouwEntry({ nieuwInter: 'ja', hersteld: 'ja' }).hersteld, 'ja');
  assert.equal(bouwEntry({ id: 'a' }, { nu: new Date('2026-01-02T03:04:05.000Z') }).aangemaakt, '2026-01-02T03:04:05.000Z');
});

test('voegToeOfWerkBij: dedup op ticketId+datum behoudt het nieuwe id en geeft vervangenId = oud id', () => {
  const oud = bouwEntry({ id: 'oud', ticketId: '5', datum: '2026-10-08', klant: 'A' });
  const nieuw = bouwEntry({ id: 'nieuw', ticketId: '5', datum: '2026-10-08', klant: 'B' });
  const r = voegToeOfWerkBij([oud], nieuw, { id: 'nieuw' });
  assert.equal(r.rapports.length, 1);
  assert.equal(r.rapports[0].id, 'nieuw');
  assert.equal(r.rapports[0].klant, 'B');
  assert.equal(r.vervangenId, 'oud');
});

test('voegToeOfWerkBij: zelfde id → vervangenId null; zohoUploaded wordt overgenomen', () => {
  const oud = { ...bouwEntry({ id: 'x', ticketId: '5', datum: 'd' }), zohoUploaded: true };
  const nieuw = bouwEntry({ id: 'x', ticketId: '5', datum: 'd' });
  const r = voegToeOfWerkBij([oud], nieuw, { id: 'x' });
  assert.equal(r.vervangenId, null);
  assert.equal(r.rapports[0].zohoUploaded, true);
});

test('voegToeOfWerkBij: lege ticketId dedupt nooit', () => {
  const a = bouwEntry({ id: 'a', datum: 'd' });
  const b = bouwEntry({ id: 'b', datum: 'd' });
  const r = voegToeOfWerkBij([a], b, { id: 'b' });
  assert.deepEqual(r.rapports.map(x => x.id), ['b', 'a']);
  assert.equal(r.vervangenId, null);
});

test('voegToeOfWerkBij: lijst wordt op 500 afgekapt', () => {
  const lijst = Array.from({ length: 500 }, (_, i) => bouwEntry({ id: 'r' + i, ticketId: 't' + i, datum: 'd' }));
  const r = voegToeOfWerkBij(lijst, bouwEntry({ id: 'nieuw', ticketId: 'n', datum: 'd' }), { id: 'nieuw' });
  assert.equal(r.rapports.length, 500);
  assert.equal(r.rapports[0].id, 'nieuw');
  assert.equal(r.rapports[499].id, 'r498');
});

test('effectieveStatus: oude entry zonder verwerking', () => {
  assert.equal(effectieveStatus({ zohoUploaded: true }), 'in-zoho');
  assert.equal(effectieveStatus({ geannuleerd: true }), 'geannuleerd');
  assert.equal(effectieveStatus({}), 'onbekend');
  assert.equal(effectieveStatus({ verwerking: { status: 'mislukt' } }), 'mislukt');
});

test('wijzigLijst schrijft en verhoogt versie', async () => {
  const s = nepStore();
  const r = await wijzigLijst(s, ({ versie, rapports }) => ({
    rapports: [{ id: 'a' }, ...rapports],
    controle: rl => rl.some(x => x.id === 'a'),
    resultaat: 'klaar',
  }));
  assert.deepEqual(r, { ok: true, versie: 1, resultaat: 'klaar' });
  assert.deepEqual(await s.get(LIJST_KEY), { versie: 1, rapports: [{ id: 'a' }] });
});

test('wijzigLijst: mutatie null → ongewijzigd, geen write', async () => {
  const s = nepStore();
  const r = await wijzigLijst(s, () => null);
  assert.deepEqual(r, { ok: true, versie: 0, ongewijzigd: true });
  assert.equal(s.writes, 0);
});

test('wijzigLijst herhaalt als een gelijktijdige schrijver overschrijft', async () => {
  const s = nepStore({ naSchrijven: (n, m) => { if (n === 1) m.set(LIJST_KEY, JSON.stringify({ versie: 1, rapports: [{ id: 'ander' }] })); } });
  let aanroepen = 0;
  const r = await wijzigLijst(s, ({ rapports }) => {
    aanroepen++;
    return { rapports: [{ id: 'a' }, ...rapports], controle: rl => rl.some(x => x.id === 'a') };
  });
  assert.equal(r.ok, true);
  assert.equal(aanroepen, 2);
  assert.deepEqual((await s.get(LIJST_KEY)).rapports.map(x => x.id), ['a', 'ander']);
});

test('wijzigLijst geeft ok:false na 3 mislukte controles', async () => {
  const s = nepStore({ naSchrijven: (n, m) => { m.set(LIJST_KEY, JSON.stringify({ versie: n, rapports: [] })); } });
  let aanroepen = 0;
  const r = await wijzigLijst(s, () => { aanroepen++; return { rapports: [{ id: 'a' }], controle: rl => rl.length === 1 }; });
  assert.deepEqual(r, { ok: false });
  assert.equal(aanroepen, 3);
});

test('wijzigLijst gooit leesfouten door', async () => {
  const s = { async get() { throw new Error('blobs weg'); }, async setJSON() {} };
  await assert.rejects(() => wijzigLijst(s, () => null), /blobs weg/);
});

// ---- zetOpnieuw ------------------------------------------------------------
test('zetOpnieuw: mislukt → wacht met pogingen 0 en laatsteFout null', () => {
  const nu = new Date('2026-10-08T12:00:00Z');
  const rapports = [
    { id: 'a', verwerking: { status: 'mislukt', pogingen: 6, volgendePoging: null, laatsteFout: 'zoho 500', bijgewerkt: 'x' } },
    { id: 'b', verwerking: { status: 'mislukt' } },
  ];
  const uit = zetOpnieuw(rapports, 'a', nu);
  assert.equal(uit.gevonden, true);
  assert.equal(uit.zetten, true);
  assert.deepEqual(uit.rapports[0].verwerking, {
    status: 'wacht', pogingen: 0, volgendePoging: null, laatsteFout: null, bijgewerkt: nu.toISOString(),
  });
  assert.equal(uit.rapports[1], rapports[1]);
  assert.equal(rapports[0].verwerking.status, 'mislukt'); // invoer niet gemuteerd
});

test('zetOpnieuw: in-zoho blijft staan (zetten false)', () => {
  const rapports = [{ id: 'a', zohoUploaded: true, verwerking: { status: 'in-zoho' } }];
  const uit = zetOpnieuw(rapports, 'a');
  assert.equal(uit.gevonden, true);
  assert.equal(uit.zetten, false);
  assert.deepEqual(uit.rapports, rapports);
});

test('zetOpnieuw: onbekend id → gevonden false', () => {
  const uit = zetOpnieuw([{ id: 'a', verwerking: { status: 'mislukt' } }], 'zzz');
  assert.deepEqual([uit.gevonden, uit.zetten], [false, false]);
});
