import test from 'node:test';
import assert from 'node:assert/strict';
import { normSerie, laadRapporten, vlakRapport, zoekRapporten, telRapporten, paalHistoriek } from '../netlify/lib/mcp-data.js';

const rap = (id, o = {}, rd = {}) => ({
  id, datum: '2026-03-01', technieker: 'Jan', ticketNumber: 'T' + id, klant: 'Klant BV', adres: 'Straat 1',
  interventieType: 'Interventie', servicetype: 'Herstelling', hersteld: 'ja', nieuwInter: 'nee', geannuleerd: false,
  rapportData: { serienummer: '2201-AB', probleem: 'Laadt niet', acties: 'Reset', oorzaakStoring: ['Component defect'], onderdelen: [], ...rd },
  ...o,
});

function nepStore(blobs) {
  return { async get(k) { return blobs[k] ?? null; } };
}

test('normSerie normaliseert', () => {
  assert.equal(normSerie(' 2201-ab '), '2201-AB');
  assert.equal(normSerie('22 01 - ab'), '2201-AB');
  assert.equal(normSerie(null), '');
});

test('zoeken op serienummer met afwijkende schrijfwijze', () => {
  const r = zoekRapporten([rap('1'), rap('2', {}, { serienummer: '9999' })], { serienummer: ' 2201-ab ' }, {});
  assert.deepEqual(r.resultaten.map(x => x.id), ['1']);
});

const bron = () => nepStore({
  rapportlijst: { versie: 1, rapports: [rap('a'), rap('b', { geannuleerd: true }), rap('c', { verwerking: { status: 'geannuleerd' } })] },
  'rapportlijst-archief-2025': { versie: 1, rapports: [rap('a', { datum: '2025-05-05' }), rap('d', { datum: '2025-06-06' })] },
  'rapportlijst-archief-2024': { versie: 1, rapports: [rap('z', { datum: '2024-01-01' })] },
});
const ids = r => r.rapporten.map(x => x.id).sort();
const nu = new Date('2026-11-10');

test('laadRapporten: archief + actief, ontdubbeld, geannuleerd eruit', async () => {
  const r = await laadRapporten(bron(), { van: '2025-01-01', tot: '2026-12-31' }, { nu });
  assert.deepEqual(ids(r), ['a', 'd']);
  assert.deepEqual(r.ontbrekendeJaren, []);
});

test('laadRapporten: enkel van, enkel tot, geen periode nemen archieven mee', async () => {
  assert.deepEqual(ids(await laadRapporten(bron(), { van: '2025-01-01' }, { nu })), ['a', 'd']);
  assert.deepEqual(ids(await laadRapporten(bron(), { tot: '2025-12-31' }, { nu })), ['a', 'd', 'z']);
  assert.deepEqual(ids(await laadRapporten(bron(), {}, { nu })), ['a', 'd', 'z']);
});

test('laadRapporten: vroegste jaar uit store.list', async () => {
  const store = { ...bron(), async list() { return { blobs: [{ key: 'rapportlijst-archief-2022' }] }; } };
  const blobs = { rapportlijst: { rapports: [] }, 'rapportlijst-archief-2022': { rapports: [rap('o', { datum: '2022-02-02' })] } };
  store.get = async k => blobs[k] ?? null;
  assert.deepEqual(ids(await laadRapporten(store, {}, { nu })), ['o']);
});

test('laadRapporten meldt onleesbare archiefjaren', async () => {
  const b = bron();
  const get = b.get;
  b.get = async (k, o) => { if (k.endsWith('2025')) throw new Error('stuk'); return get(k, o); };
  const r = await laadRapporten(b, { van: '2024-01-01', tot: '2025-12-31' }, { nu });
  assert.deepEqual(r.ontbrekendeJaren, [2025]);
  assert.deepEqual(ids(r), ['a', 'z']);
});

test('tellen per oorzaak telt beide', () => {
  const r = telRapporten([rap('1', {}, { oorzaakStoring: ['Component defect', 'Installatiefout'] })], { groepeer: 'oorzaak' });
  assert.deepEqual(r.groepen.map(g => g.sleutel).sort(), ['Component defect', 'Installatiefout']);
  assert.ok(r.groepen.every(g => g.aantal === 1));
  assert.equal(r.totaalRapporten, 1);
});

test('ontbrekende oorzaak -> (onbekend)', () => {
  const r = telRapporten([rap('1', {}, { oorzaakStoring: undefined })], { groepeer: 'oorzaak' });
  assert.deepEqual(r.groepen, [{ sleutel: '(onbekend)', aantal: 1 }]);
});

test('minimum op serienummer', () => {
  const lijst = [rap('1'), rap('2'), rap('3', {}, { serienummer: '2201-ab ' }), rap('4', {}, { serienummer: 'X1' })];
  const r = telRapporten(lijst, { groepeer: 'serienummer', minimum: 3 });
  assert.deepEqual(r.groepen, [{ sleutel: '2201-AB', aantal: 3 }]);
});

test('afkappen op 200', () => {
  const lijst = Array.from({ length: 250 }, (_, i) => rap(String(i)));
  const r = zoekRapporten(lijst, {}, {});
  assert.equal(r.resultaten.length, 200);
  assert.equal(r.afgekapt, true);
  assert.equal(r.totaal, 250);
});

test('filters: periode, oorzaak, tekst, hersteld, technieker', () => {
  const lijst = [rap('1'), rap('2', { datum: '2026-05-01', technieker: 'Piet', hersteld: 'nee' }, { oorzaakStoring: ['Installatiefout'], probleem: 'Kapotte KABEL' })];
  assert.deepEqual(zoekRapporten(lijst, { van: '2026-04-01' }, {}).resultaten.map(x => x.id), ['2']);
  assert.deepEqual(zoekRapporten(lijst, { tot: '2026-04-01' }, {}).resultaten.map(x => x.id), ['1']);
  assert.deepEqual(zoekRapporten(lijst, { oorzaak: 'installatiefout' }, {}).resultaten.map(x => x.id), ['2']);
  assert.deepEqual(zoekRapporten(lijst, { tekst: 'kabel' }, {}).resultaten.map(x => x.id), ['2']);
  assert.deepEqual(zoekRapporten(lijst, { hersteld: 'nee' }, {}).resultaten.map(x => x.id), ['2']);
  assert.deepEqual(zoekRapporten(lijst, { technieker: 'jan' }, {}).resultaten.map(x => x.id), ['1']);
});

test('tellen per maand en onbekend', () => {
  const r = telRapporten([rap('1'), rap('2', { datum: '2026-04-02' }), rap('3', { klant: '' })], { groepeer: 'maand' });
  assert.deepEqual(r.groepen, [{ sleutel: '2026-03', aantal: 2 }, { sleutel: '2026-04', aantal: 1 }]);
  assert.equal(telRapporten([rap('3', { klant: '' })], { groepeer: 'klant' }).groepen[0].sleutel, '(onbekend)');
});

test('paalHistoriek oud naar nieuw met oorzaken', () => {
  const lijst = [rap('2', { datum: '2026-05-01' }), rap('1'), rap('3', {}, { serienummer: 'ANDER' })];
  const h = paalHistoriek(lijst, ' 2201-ab');
  assert.equal(h.serienummer, '2201-AB');
  assert.deepEqual(h.bezoeken.map(b => b.id), ['1', '2']);
  assert.deepEqual(h.oorzaken, [{ sleutel: 'Component defect', aantal: 2 }]);
});

test('vlakRapport optionele velden enkel indien aanwezig', () => {
  const v = vlakRapport(rap('1'));
  assert.equal('probleemtype' in v, false);
  assert.equal(v.serienummer, '2201-AB');
  const w = vlakRapport(rap('1', { probleemtype: 'Hardware', garantieStatus: 'Binnen garantie' }));
  assert.equal(w.probleemtype, 'Hardware');
  assert.equal(w.garantieStatus, 'Binnen garantie');
});

test('zoeken en tellen op probleemtype en garantieStatus; oude rapporten -> (onbekend)', () => {
  const lijst = [
    rap('1', { probleemtype: 'Laadt niet', garantieStatus: 'Binnen garantie' }),
    rap('2', { probleemtype: 'laadt niet', garantieStatus: 'Buiten garantie' }),
    rap('3', { probleemtype: 'Display' }),
    rap('4'),
  ];
  assert.deepEqual(zoekRapporten(lijst, { probleemtype: 'LAADT NIET' }).resultaten.map(x => x.id).sort(), ['1', '2']);
  assert.deepEqual(zoekRapporten(lijst, { garantieStatus: 'binnen garantie' }).resultaten.map(x => x.id), ['1']);
  const p = telRapporten(lijst, { groepeer: 'probleemtype' });
  assert.deepEqual(p.groepen, [{ sleutel: '(onbekend)', aantal: 1 }, { sleutel: 'Display', aantal: 1 }, { sleutel: 'Laadt niet', aantal: 1 }, { sleutel: 'laadt niet', aantal: 1 }]);
  const g = telRapporten(lijst, { groepeer: 'garantieStatus' });
  assert.deepEqual(g.groepen, [{ sleutel: '(onbekend)', aantal: 2 }, { sleutel: 'Binnen garantie', aantal: 1 }, { sleutel: 'Buiten garantie', aantal: 1 }]);
});

test('technieker: na filterRapportenVoor telt en historiek enkel eigen rapporten', async () => {
  const { filterRapportenVoor } = await import('../netlify/lib/eigen.js');
  const lijst = [rap('1', { ingediendDoor: 'u1', technieker: 'Jan' }), rap('2', { ingediendDoor: 'u2', technieker: 'Piet' })];
  const eigen = filterRapportenVoor({ id: 'u1', rol: 'technieker', naam: 'Jan' }, lijst);
  assert.equal(telRapporten(eigen, { groepeer: 'serienummer' }).groepen[0].aantal, 1);
  assert.equal(paalHistoriek(eigen, '2201-AB').bezoeken.length, 1);
});
