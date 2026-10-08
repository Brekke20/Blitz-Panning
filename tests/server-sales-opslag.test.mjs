import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepStore } from './nep-blobs.mjs';
import { maakNepFetch } from './nep-fetch.mjs';
import { salesSleutel, leegSales, leesSales, naarClient, muteerSales } from '../netlify/lib/sales-opslag.js';
import { pasWijzigingToe } from '../netlify/lib/sales-wijzig.js';
import { bewaarLocaties } from '../netlify/lib/sales-locaties-bewaren.js';
import { geefResultaat, zetVastUur, WIJZIGBARE_VELDEN } from '../public/js/sales/lead-regels.js';

process.env.TZ = 'Europe/Brussels';
const NU = '2026-10-09T09:00:00.000Z';
const lead = (id, extra = {}) => ({
  id, voornaam: 'Marie', naam: 'Janssens', email: `${id}@voorbeeld.test`, postcode: '3640', gemeente: 'Kinrooi',
  locatie: null, status: 'te-plannen', bezoeken: [], geimporteerdOp: '2026-10-01T08:00:00.000Z', ...extra,
});
const blob = (leads = [], extra = {}) => ({ versie: 3, leads, blokken: [], grafstenen: [], ...extra });
const opties = () => { let n = 0; return { nu: NU, nieuwBlokId: () => 'b' + (++n) }; };
// Velden die een client stuurt na geefResultaat: enkel de wijzigbare velden, ontbrekende planning/resultaat als null.
const veldenNa = (nieuw) => {
  const v = {};
  for (const k of WIJZIGBARE_VELDEN) if (k in nieuw) v[k] = nieuw[k];
  if (!('planning' in v)) v.planning = null;
  if (!('resultaat' in v)) v.resultaat = null;
  return v;
};
const lees = (store, id = 'u1') => JSON.parse(store._data.get(`sales/${id}`));

// ---------- opslag ----------

test('sleutel en leeg blob', async () => {
  assert.equal(salesSleutel('u1'), 'sales/u1');
  const store = maakNepStore();
  assert.deepEqual(await leesSales(store, 'u1'), leegSales());
  assert.deepEqual(leegSales(), { versie: 0, leads: [], blokken: [], grafstenen: [] });
});

test('leesSales vult ontbrekende velden aan (oud blob zonder grafstenen)', async () => {
  const store = maakNepStore({ 'sales/u1': { versie: 4, leads: [lead('a')] } });
  const d = await leesSales(store, 'u1');
  assert.equal(d.versie, 4);
  assert.deepEqual(d.blokken, []);
  assert.deepEqual(d.grafstenen, []);
  assert.equal(d.leads.length, 1);
});

test('naarClient: geen grafstenen, diepe kopie, gebruikerId erbij', () => {
  const data = blob([lead('a')], { grafstenen: [{ h: ['x'], op: NU }], blokken: [{ id: 'b1' }] });
  const c = naarClient(data, 'u1');
  assert.deepEqual(Object.keys(c).sort(), ['blokken', 'gebruikerId', 'leads', 'versie']);
  assert.equal(c.gebruikerId, 'u1');
  assert.ok(!JSON.stringify(c).includes('grafstenen'));
  assert.notEqual(c.leads, data.leads);
  assert.notEqual(c.leads[0], data.leads[0]);
  assert.notEqual(c.blokken[0], data.blokken[0]);
  c.leads[0].naam = 'X';
  assert.equal(data.leads[0].naam, 'Janssens');
});

test('twee verkopers raken elkaar niet', async () => {
  const store = maakNepStore();
  await muteerSales(store, 'u1', { wijzig: d => ({ data: { ...d, leads: [lead('a')] } }) });
  await muteerSales(store, 'u2', { wijzig: d => ({ data: { ...d, leads: [lead('b')] } }) });
  assert.deepEqual((await leesSales(store, 'u1')).leads.map(l => l.id), ['a']);
  assert.deepEqual((await leesSales(store, 'u2')).leads.map(l => l.id), ['b']);
  assert.ok(store._data.has('sales/u1') && store._data.has('sales/u2'));
});

test('muteerSales: verwachteVersie 0 op een leeg blob -> ok, versie 1, extra doorgegeven', async () => {
  const store = maakNepStore();
  const r = await muteerSales(store, 'u1', { verwachteVersie: 0, wijzig: d => ({ data: { ...d, leads: [lead('a')] }, extra: { n: 1 } }) });
  assert.equal(r.status, 'ok');
  assert.equal(r.data.versie, 1);
  assert.deepEqual(r.extra, { n: 1 });
  assert.equal((await leesSales(store, 'u1')).versie, 1);
});

test('muteerSales: oud blob zonder versie krijgt versie 1', async () => {
  const store = maakNepStore({ 'sales/u1': { leads: [lead('a')] } });
  const r = await muteerSales(store, 'u1', { wijzig: d => ({ data: { ...d, blokken: [{ id: 'b1' }] } }) });
  assert.equal(r.status, 'ok');
  assert.equal(r.data.versie, 1);
  assert.deepEqual(r.data.grafstenen, []);
});

test('muteerSales: foute versie -> conflict met de huidige blob, geen schrijfactie, wijzig niet aangeroepen', async () => {
  const store = maakNepStore({ 'sales/u1': blob([lead('a')]) });
  let aangeroepen = false;
  const r = await muteerSales(store, 'u1', { verwachteVersie: 2, wijzig: d => { aangeroepen = true; return { data: d }; } });
  assert.equal(r.status, 'conflict');
  assert.equal(r.data.versie, 3);
  assert.equal(r.data.leads[0].id, 'a');
  assert.deepEqual(store._schrijfacties, []);
  assert.equal(aangeroepen, false);
});

test('muteerSales: wijzig geeft null -> ongewijzigd; { fouten } -> ongeldig; beide zonder schrijfactie', async () => {
  const store = maakNepStore({ 'sales/u1': blob([lead('a')]) });
  const a = await muteerSales(store, 'u1', { wijzig: () => null });
  assert.equal(a.status, 'ongewijzigd');
  assert.equal(a.data.versie, 3);
  const b = await muteerSales(store, 'u1', { wijzig: () => ({ fouten: ['stuk'] }) });
  assert.equal(b.status, 'ongeldig');
  assert.deepEqual(b.fouten, ['stuk']);
  assert.deepEqual(store._schrijfacties, []);
});

test('muteerSales: wijzig krijgt een verse kopie (muteren raakt de opgeslagen blob niet)', async () => {
  const store = maakNepStore({ 'sales/u1': blob([lead('a')]) });
  await muteerSales(store, 'u1', { wijzig: d => { d.leads[0].naam = 'X'; return null; } });
  assert.equal((await leesSales(store, 'u1')).leads[0].naam, 'Janssens');
});

test('muteerSales: setJSON gooit -> storing', async () => {
  const store = maakNepStore();
  store.setJSON = async () => { throw new Error('blobs stuk'); };
  assert.deepEqual(await muteerSales(store, 'u1', { wijzig: d => ({ data: d }) }), { status: 'storing' });
});

test('muteerSales: get gooit -> storing', async () => {
  const store = maakNepStore();
  store.get = async () => { throw new Error('blobs stuk'); };
  assert.deepEqual(await muteerSales(store, 'u1', { wijzig: d => ({ data: d }) }), { status: 'storing' });
});

test('muteerSales: een store die na setJSON een oudere stand teruggeeft (3x) -> storing', async () => {
  const store = maakNepStore({ 'sales/u1': blob([lead('a')]) });
  const oud = JSON.stringify(blob([lead('a')]));
  store.setJSON = async () => {};          // schrijfactie "slaagt" maar verdwijnt
  store.get = async () => JSON.parse(oud);
  assert.deepEqual(await muteerSales(store, 'u1', { wijzig: d => ({ data: { ...d, blokken: [{ id: 'b1' }] } }) }), { status: 'storing' });
});

test('muteerSales: een fout in de wijzig-callback zelf wordt niet als opslagstoring verbloemd', async () => {
  const store = maakNepStore();
  await assert.rejects(muteerSales(store, 'u1', { wijzig: () => { throw new TypeError('bug'); } }), /bug/);
});

test('muteerSales: twee gelijktijdige aanroepen zijn beide toegepast (versie 2)', async () => {
  const store = maakNepStore();
  const voeg = id => muteerSales(store, 'u1', { wijzig: d => ({ data: { ...d, leads: [...d.leads, lead(id)] } }) });
  const [r1, r2] = await Promise.all([voeg('a'), voeg('b')]);
  assert.equal(r1.status, 'ok');
  assert.equal(r2.status, 'ok');
  const d = await leesSales(store, 'u1');
  assert.equal(d.versie, 2);
  assert.deepEqual(d.leads.map(l => l.id).sort(), ['a', 'b']);
});

test('muteerSales: tweede gelijktijdige aanroep met versie van vóór de eerste krijgt conflict', async () => {
  const store = maakNepStore();
  const voeg = id => muteerSales(store, 'u1', { verwachteVersie: 0, wijzig: d => ({ data: { ...d, leads: [...d.leads, lead(id)] } }) });
  const [r1, r2] = await Promise.all([voeg('a'), voeg('b')]);
  assert.equal(r1.status, 'ok');
  assert.equal(r2.status, 'conflict');
  assert.equal(r2.data.versie, 1);
  assert.deepEqual((await leesSales(store, 'u1')).leads.map(l => l.id), ['a']);
});

// ---------- wijzigen ----------

test('lead-velden toegepast via pasLeadToe; invoer niet gemuteerd', () => {
  const data = blob([lead('a')]);
  const kopie = structuredClone(data);
  const r = pasWijzigingToe(data, { leads: [{ id: 'a', velden: { notitie: 'bellen na 17u', duurMin: 90 } }] }, opties());
  assert.deepEqual(r.fouten, []);
  assert.equal(r.data.leads[0].notitie, 'bellen na 17u');
  assert.equal(r.data.leads[0].duurMin, 90);
  assert.deepEqual(data, kopie);
  assert.deepEqual(r.adresGewijzigd, []);
  assert.deepEqual(r.resultaten, []);
});

test('onbekende lead-id -> fout; fout in één van twee leads -> niets toegepast', () => {
  const data = blob([lead('a'), lead('b')]);
  assert.ok(pasWijzigingToe(data, { leads: [{ id: 'zzz', velden: { notitie: 'x' } }] }, opties()).fouten.length > 0);
  const r = pasWijzigingToe(data, { leads: [{ id: 'a', velden: { notitie: 'ok' } }, { id: 'b', velden: { status: 'afgewerkt' } }] }, opties());
  assert.ok(r.fouten.length > 0);
  assert.deepEqual(r.data, data);
  assert.deepEqual(r.resultaten, []);
  assert.deepEqual(r.adresGewijzigd, []);
});

test('niet-wijzigbare velden (id, locatie, server-vlaggen) worden geweigerd', () => {
  const data = blob([lead('a')]);
  for (const velden of [{ id: 'q' }, { locatie: { lat: 1, lon: 1 } }, { adresTeGeocoderen: true }, { adresPogingen: 0 }, { grafstenen: [] }]) {
    assert.ok(pasWijzigingToe(data, { leads: [{ id: 'a', velden }] }, opties()).fouten.length > 0, JSON.stringify(velden));
  }
});

test('adreswijziging: lead-id in adresGewijzigd, locatie null, server-vlaggen gewist; zonder adreswijziging blijven ze', () => {
  const data = blob([lead('a', { straat: 'Dorpsstraat', huisnr: '12', locatie: { lat: 1, lon: 2, bron: 'postcode' }, adresTeGeocoderen: true, adresPogingen: 2 })]);
  const geen = pasWijzigingToe(data, { leads: [{ id: 'a', velden: { notitie: 'x' } }] }, opties());
  assert.equal(geen.data.leads[0].adresTeGeocoderen, true);
  assert.equal(geen.data.leads[0].adresPogingen, 2);
  assert.deepEqual(geen.data.leads[0].locatie, { lat: 1, lon: 2, bron: 'postcode' });
  const r = pasWijzigingToe(data, { leads: [{ id: 'a', velden: { huisnr: '14' } }] }, opties());
  assert.deepEqual(r.fouten, []);
  assert.deepEqual(r.adresGewijzigd, ['a']);
  assert.equal(r.data.leads[0].locatie, null);
  assert.ok(!('adresTeGeocoderen' in r.data.leads[0]));
  assert.ok(!('adresPogingen' in r.data.leads[0]));
});

test('duurMin buiten 15-480 of geen geheel getal -> fout; grenzen toegelaten', () => {
  const data = blob([lead('a')]);
  for (const duurMin of [14, 481, 100000, 1e9, 'lang', 30.5, NaN]) {
    assert.ok(pasWijzigingToe(data, { leads: [{ id: 'a', velden: { duurMin } }] }, opties()).fouten.length > 0, String(duurMin));
  }
  for (const duurMin of [15, 480, null]) {
    assert.deepEqual(pasWijzigingToe(data, { leads: [{ id: 'a', velden: { duurMin } }] }, opties()).fouten, [], String(duurMin));
  }
});

test('geefResultaat(opnieuw) en geefResultaat(verkocht): elk precies één resultaat met de juiste soort', () => {
  const basis = lead('a', { status: 'bevestigd', planning: { datum: '2026-10-12', start: '10:00', vast: true } });
  for (const soort of ['opnieuw', 'verkocht', 'offerte', 'geen-interesse']) {
    const data = blob([basis]);
    const nieuw = geefResultaat(basis, { soort, notitie: 'prima gesprek', nu: new Date('2026-10-12T12:00:00Z') });
    const r = pasWijzigingToe(data, { leads: [{ id: 'a', velden: veldenNa(nieuw) }] }, opties());
    assert.deepEqual(r.fouten, [], soort);
    assert.deepEqual(r.resultaten, [{ leadId: 'a', soort }]);
    assert.equal(r.data.leads[0].bezoeken.length, 1);
    assert.equal(r.data.leads[0].status, soort === 'opnieuw' ? 'te-plannen' : 'afgewerkt');
  }
});

test('resultaat: laatste bezoek en lead.resultaat hebben EXACT dezelfde op (de serverklok), ISO-string', () => {
  const basis = lead('a', { status: 'bevestigd', planning: { datum: '2026-10-12', start: '10:00', vast: true } });
  const nieuw = geefResultaat(basis, { soort: 'verkocht', notitie: 'x', nu: new Date('2020-01-01T00:00:00Z') }); // client-op wordt genegeerd
  const r = pasWijzigingToe(blob([basis]), { leads: [{ id: 'a', velden: veldenNa(nieuw) }] }, opties());
  const l = r.data.leads[0];
  assert.equal(l.resultaat.op, NU);
  assert.equal(l.bezoeken.at(-1).op, NU);
  assert.equal(l.resultaat.soort, 'verkocht');
  assert.equal(l.resultaat.notitie, 'x');
  assert.equal(typeof l.resultaat.op, 'string');
});

test('bezoeken: bestaande historiek mag niet herschreven, ingekort of vervangen worden', () => {
  const oud = [{ datum: '2026-10-01', resultaat: 'opnieuw', op: '2026-10-01T10:00:00.000Z' }];
  const data = blob([lead('a', { bezoeken: oud })]);
  const nieuwBezoek = { datum: '2026-10-05', resultaat: 'opnieuw', op: '2026-10-05T10:00:00.000Z' };
  const slecht = [
    [],                                                                        // wissen
    [{ ...oud[0], resultaat: 'verkocht' }],                                    // herschrijven
    [{ ...oud[0], notitie: 'achteraf toegevoegd' }],
    [nieuwBezoek, oud[0]],                                                     // herordenen
    [oud[0], nieuwBezoek, { ...nieuwBezoek, op: '2026-10-06T10:00:00.000Z' }], // twee tegelijk
    null, 'bezoek',
  ];
  for (const bezoeken of slecht) {
    const r = pasWijzigingToe(data, { leads: [{ id: 'a', velden: { bezoeken } }] }, opties());
    assert.ok(r.fouten.length > 0, JSON.stringify(bezoeken));
    assert.deepEqual(r.data, data);
  }
  // ongewijzigd opnieuw sturen mag (zelfde inhoud, andere sleutelvolgorde)
  const ok = pasWijzigingToe(data, { leads: [{ id: 'a', velden: { bezoeken: [{ op: oud[0].op, resultaat: 'opnieuw', datum: '2026-10-01' }] } }] }, opties());
  assert.deepEqual(ok.fouten, []);
  assert.deepEqual(ok.resultaten, []);
});

test('een bezoek toevoegen vraagt een passende uitkomst; resultaat kan niet los gezet worden', () => {
  const basis = lead('a', { status: 'bevestigd', planning: { datum: '2026-10-12', start: '10:00', vast: true } });
  const bezoek = { datum: '2026-10-12', resultaat: 'verkocht', op: 'x' };
  // bezoek 'verkocht' maar lead blijft bevestigd
  assert.ok(pasWijzigingToe(blob([basis]), { leads: [{ id: 'a', velden: { bezoeken: [bezoek] } }] }, opties()).fouten.length > 0);
  // bezoek 'verkocht' maar status wordt te-plannen
  assert.ok(pasWijzigingToe(blob([basis]), { leads: [{ id: 'a', velden: { bezoeken: [bezoek], status: 'te-plannen', planning: null } }] }, opties()).fouten.length > 0);
  // bezoek 'opnieuw' maar lead wordt afgewerkt
  const opnieuw = { datum: '2026-10-12', resultaat: 'opnieuw', op: 'x' };
  assert.ok(pasWijzigingToe(blob([basis]), { leads: [{ id: 'a', velden: { bezoeken: [opnieuw], status: 'afgewerkt', planning: null, resultaat: { soort: 'verkocht', op: 'x' } } }] }, opties()).fouten.length > 0);
  // resultaat zonder nieuw bezoek
  assert.ok(pasWijzigingToe(blob([basis]), { leads: [{ id: 'a', velden: { status: 'afgewerkt', planning: null, resultaat: { soort: 'verkocht', op: 'x' } } }] }, opties()).fouten.length > 0);
  // resultaat van een al afgewerkte lead herschrijven
  const klaar = lead('c', { status: 'afgewerkt', resultaat: { soort: 'offerte', op: '2026-10-01T10:00:00.000Z' }, bezoeken: [{ datum: '2026-10-01', resultaat: 'offerte', op: '2026-10-01T10:00:00.000Z' }] });
  assert.ok(pasWijzigingToe(blob([klaar]), { leads: [{ id: 'c', velden: { resultaat: { soort: 'verkocht', op: '2026-10-01T10:00:00.000Z' } } }] }, opties()).fouten.length > 0);
  // een bezoek toevoegen aan een al afgewerkte lead kan niet
  const extra = { datum: '2026-10-09', resultaat: 'opnieuw', op: 'x' };
  assert.ok(pasWijzigingToe(blob([klaar]), { leads: [{ id: 'c', velden: { bezoeken: [...klaar.bezoeken, extra], status: 'te-plannen', resultaat: null } }] }, opties()).fouten.length > 0);
});

test('terug naar te-plannen (resultaat vervalt) en vast uur zetten via pasLeadToe blijven werken', () => {
  const klaar = lead('c', { status: 'afgewerkt', resultaat: { soort: 'offerte', op: '2026-10-01T10:00:00.000Z' }, bezoeken: [{ datum: '2026-10-01', resultaat: 'offerte', op: '2026-10-01T10:00:00.000Z' }] });
  const terug = pasWijzigingToe(blob([klaar]), { leads: [{ id: 'c', velden: { status: 'te-plannen', resultaat: null } }] }, opties());
  assert.deepEqual(terug.fouten, []);
  assert.ok(!('resultaat' in terug.data.leads[0]));
  assert.equal(terug.data.leads[0].bezoeken.length, 1);
  const vast = zetVastUur(lead('d'), { datum: '2026-10-13', start: '09:30' });
  const r = pasWijzigingToe(blob([lead('d')]), { leads: [{ id: 'd', velden: { status: vast.status, planning: vast.planning } }] }, opties());
  assert.deepEqual(r.fouten, []);
  assert.equal(r.data.leads[0].planning.vast, true);
});

test('blokken toevoegen krijgt nieuwBlokId(), wijzigen en verwijderen werken', () => {
  const o = opties();
  let r = pasWijzigingToe(blob(), { blokken: { toevoegen: [{ datum: '2026-10-13', start: '00:00', eind: '23:59', soort: 'verlof', omschrijving: 'vakantie', id: 'hacker' }] } }, o);
  assert.deepEqual(r.fouten, []);
  assert.equal(r.data.blokken.length, 1);
  assert.equal(r.data.blokken[0].id, 'b1');
  r = pasWijzigingToe(r.data, { blokken: { wijzig: [{ id: 'b1', velden: { omschrijving: 'kantoor', soort: 'kantoor' } }] } }, o);
  assert.deepEqual(r.fouten, []);
  assert.equal(r.data.blokken[0].omschrijving, 'kantoor');
  assert.equal(r.data.blokken[0].datum, '2026-10-13');
  r = pasWijzigingToe(r.data, { blokken: { verwijder: ['b1'] } }, o);
  assert.deepEqual(r.fouten, []);
  assert.deepEqual(r.data.blokken, []);
});

test('blokken: ongeldig blok, onbekend id, id wijzigen of vreemde velden -> fout, niets toegepast', () => {
  const data = blob([lead('a')], { blokken: [{ id: 'b1', datum: '2026-10-13', start: '09:00', eind: '10:00', soort: 'kantoor' }] });
  const o = opties();
  const slecht = [
    { toevoegen: [{ datum: '2026-13-40', start: '09:00', eind: '10:00', soort: 'kantoor' }] },
    { toevoegen: [{ datum: '2026-10-13', start: '10:00', eind: '09:00', soort: 'kantoor' }] },
    { toevoegen: [{ datum: '2026-10-13', start: '09:00', eind: '10:00', soort: 'kantoor', lat: 'x', lon: 5 }] },
    { wijzig: [{ id: 'bestaat-niet', velden: { omschrijving: 'x' } }] },
    { wijzig: [{ id: 'b1', velden: { id: 'b9' } }] },
    { wijzig: [{ id: 'b1', velden: { start: '11:00' } }] },       // start >= eind
    { verwijder: ['bestaat-niet'] },
  ];
  for (const blokken of slecht) {
    const r = pasWijzigingToe(data, { leads: [{ id: 'a', velden: { notitie: 'x' } }], blokken }, o);
    assert.ok(r.fouten.length > 0, JSON.stringify(blokken));
    assert.deepEqual(r.data, data);
  }
});

test('blokken: enkel bekende velden worden bewaard (geen ballast), lat/lon mag', () => {
  const r = pasWijzigingToe(blob(), { blokken: { toevoegen: [{ datum: '2026-10-13', start: '09:00', eind: '10:00', soort: 'afspraak', lat: 51.1, lon: 5.2, ballast: 'x'.repeat(1000) }] } }, opties());
  assert.deepEqual(r.fouten, []);
  assert.ok(!('ballast' in r.data.blokken[0]));
  assert.equal(r.data.blokken[0].lat, 51.1);
});

test('ongeldige statusovergang -> fout', () => {
  const basis = lead('a', { status: 'afgewerkt', resultaat: { soort: 'offerte', op: '2026-10-01T10:00:00.000Z' } });
  const r = pasWijzigingToe(blob([basis]), { leads: [{ id: 'a', velden: { status: 'voorgesteld', planning: { datum: '2026-10-12', start: '10:00' } } }] }, opties());
  assert.ok(r.fouten.some(f => /Statusovergang/.test(f)));
});

test('vorm van de body: >500 items, id geen tekst, geen object -> fout', () => {
  const data = blob([lead('a')]);
  const o = opties();
  const veel = Array.from({ length: 501 }, (_, i) => ({ id: 'a', velden: { notitie: String(i) } }));
  assert.ok(pasWijzigingToe(data, { leads: veel }, o).fouten.length > 0);
  assert.deepEqual(pasWijzigingToe(data, { leads: veel.slice(0, 500) }, o).fouten, []);
  for (const id of [1, null, '', {}, ['a']]) {
    assert.ok(pasWijzigingToe(data, { leads: [{ id, velden: { notitie: 'x' } }] }, o).fouten.length > 0, JSON.stringify(id));
  }
  assert.ok(pasWijzigingToe(data, { leads: 'a' }, o).fouten.length > 0);
  assert.ok(pasWijzigingToe(data, { leads: [{ id: 'a', velden: 'x' }] }, o).fouten.length > 0);
  assert.ok(pasWijzigingToe(data, { leads: [{ id: 'a', velden: [] }] }, o).fouten.length > 0);
  assert.ok(pasWijzigingToe(data, { blokken: [] }, o).fouten.length > 0);
  assert.ok(pasWijzigingToe(data, { blokken: { toevoegen: Array.from({ length: 501 }, () => ({})) } }, o).fouten.length > 0);
  assert.ok(pasWijzigingToe(data, { blokken: { verwijder: [7] } }, o).fouten.length > 0);
  assert.ok(pasWijzigingToe(data, null, o).fouten.length > 0);
  assert.deepEqual(pasWijzigingToe(data, {}, o).fouten, []);
});

// ---------- bewaarLocaties ----------

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const router = (opZet = () => {}) => url => {
  opZet(url);
  if (url.includes('/geocode/')) return json({ results: [{ position: { lat: 51.5, lon: 5.5 } }] });
  if (url.includes('structuredGeocode')) {
    const pc = /postalCode=(\d+)/.exec(url)[1];
    return json({ results: [{ position: { lat: 50.5, lon: 4.5 }, address: { postalCode: pc, municipality: 'Gemeente ' + pc } }] });
  }
  return undefined;
};
const geoDeps = (fn) => ({ fetch: fn, sleutel: 'NEP', testModus: false, wacht: async () => {} });

test('bewaarLocaties: lead zonder locatie krijgt er een, leads met locatie blijven onaangeroerd', async () => {
  const bestaand = lead('a', { locatie: { lat: 1, lon: 2, bron: 'adres' }, huisnr: '1' });
  const store = maakNepStore({ 'sales/u1': blob([bestaand, lead('b', { gemeente: '' }), lead('c', { straat: 'Dorpsstraat', huisnr: '12' })]) });
  const { fn } = maakNepFetch(router());
  const r = await bewaarLocaties({ store, doelId: 'u1', nu: NU, deps: geoDeps(fn) });
  assert.equal(r.status, 'ok');
  assert.equal(r.open, 0);
  assert.equal(r.data.versie, 4);
  const [a, b, c] = r.data.leads;
  assert.deepEqual(a, bestaand);
  assert.deepEqual(b.locatie, { lat: 50.5, lon: 4.5, bron: 'postcode' });
  assert.equal(b.gemeente, 'Gemeente 3640', 'lege gemeente aangevuld');
  assert.deepEqual(c.locatie, { lat: 51.5, lon: 5.5, bron: 'adres' });
  assert.equal(c.gemeente, 'Kinrooi', 'bestaande gemeente blijft');
  assert.deepEqual(lees(store).leads[1].locatie, b.locatie);
});

test('bewaarLocaties: niets te doen -> ok zonder schrijfactie op het verkoperblob', async () => {
  const store = maakNepStore({ 'sales/u1': blob([lead('a', { locatie: { lat: 1, lon: 2, bron: 'postcode' } })]) });
  const { fn } = maakNepFetch(router());
  const r = await bewaarLocaties({ store, doelId: 'u1', nu: NU, deps: geoDeps(fn) });
  assert.equal(r.status, 'ok');
  assert.equal(r.open, 0);
  assert.equal(r.data.versie, 3);
  assert.ok(!store._schrijfacties.some(s => s.key === 'sales/u1'));
});

test('bewaarLocaties: adres wijzigt tijdens het geocoderen -> locatie blijft null, geen andere wijziging', async () => {
  const store = maakNepStore({ 'sales/u1': blob([lead('a', { straat: 'Dorpsstraat', huisnr: '12' }), lead('b')]) });
  let gewijzigd = false;
  const { fn } = maakNepFetch(router(url => {
    if (url.includes('/geocode/') && !gewijzigd) {
      gewijzigd = true; // de verkoper past het huisnummer aan terwijl wij geocoderen
      const d = lees(store);
      d.leads[0].huisnr = '14'; d.leads[0].notitie = 'tussendoor'; d.versie++;
      store._data.set('sales/u1', JSON.stringify(d));
    }
  }));
  const r = await bewaarLocaties({ store, doelId: 'u1', nu: NU, deps: geoDeps(fn) });
  assert.equal(r.status, 'ok');
  const [a, b] = r.data.leads;
  assert.equal(a.locatie, null);
  assert.equal(a.huisnr, '14');
  assert.equal(a.notitie, 'tussendoor', 'tussentijdse wijziging blijft behouden');
  assert.deepEqual(b.locatie, { lat: 50.5, lon: 4.5, bron: 'postcode' });
  assert.equal(r.open, 1, 'de aangepaste lead telt nog als open');
});

test('bewaarLocaties: server-vlaggen (adresTeGeocoderen/adresPogingen) uit vulLocatiesAan blijven bewaard', async () => {
  const store = maakNepStore({ 'sales/u1': blob([lead('a', { straat: 'Dorpsstraat', huisnr: '12' })]) });
  // adres-geocoding geeft een tijdelijke fout (429): postcode-locatie + vlag + teller
  const { fn } = maakNepFetch(url => {
    if (url.includes('/geocode/')) return json({}, 429);
    return router()(url);
  });
  const r = await bewaarLocaties({ store, doelId: 'u1', nu: NU, deps: geoDeps(fn) });
  assert.equal(r.status, 'ok');
  assert.equal(r.data.leads[0].adresTeGeocoderen, true);
  assert.equal(r.data.leads[0].adresPogingen, 1);
  assert.deepEqual(r.data.leads[0].locatie, { lat: 50.5, lon: 4.5, bron: 'postcode' });
  assert.equal(r.open, 1, 'openstaande adres-upgrade telt als open');
  // een volgende ronde met werkende geocoding upgradet en wist de vlaggen
  const { fn: fn2 } = maakNepFetch(router());
  const r2 = await bewaarLocaties({ store, doelId: 'u1', nu: NU, deps: geoDeps(fn2) });
  assert.deepEqual(r2.data.leads[0].locatie, { lat: 51.5, lon: 5.5, bron: 'adres' });
  assert.ok(!('adresTeGeocoderen' in r2.data.leads[0]));
  assert.ok(!('adresPogingen' in r2.data.leads[0]));
  assert.equal(r2.open, 0);
});

test('bewaarLocaties: niet gevonden leads tellen mee in open', async () => {
  const store = maakNepStore({ 'sales/u1': blob([lead('a'), lead('b', { postcode: '3500' })]) });
  const { fn } = maakNepFetch(url => (url.includes('postalCode=3500') ? json({ results: [] }) : router()(url)));
  const r = await bewaarLocaties({ store, doelId: 'u1', nu: NU, deps: geoDeps(fn) });
  assert.equal(r.status, 'ok');
  assert.equal(r.open, 1);
  assert.ok(r.data.leads[0].locatie);
  assert.equal(r.data.leads[1].locatie, null);
});

test('bewaarLocaties: store-storing -> { status: storing }', async () => {
  const store = maakNepStore({ 'sales/u1': blob([lead('a')]) });
  const { fn } = maakNepFetch(router());
  store.setJSON = async () => { throw new Error('blobs stuk'); };
  assert.deepEqual(await bewaarLocaties({ store, doelId: 'u1', nu: NU, deps: geoDeps(fn) }), { status: 'storing' });
  const kapot = maakNepStore();
  kapot.get = async () => { throw new Error('blobs stuk'); };
  assert.deepEqual(await bewaarLocaties({ store: kapot, doelId: 'u1', nu: NU, deps: geoDeps(fn) }), { status: 'storing' });
});

// ---------- fixronde review ----------

test('muteerSales: een callback zonder data ({} of enkel { extra }) schrijft nooit en maakt het blob niet leeg', async () => {
  for (const uitvoer of [{}, { extra: { n: 1 } }, { data: null }, { data: 'x' }, { data: [] }]) {
    const store = maakNepStore({ 'sales/u1': blob([lead('a')]) });
    const r = await muteerSales(store, 'u1', { wijzig: () => uitvoer });
    assert.equal(r.status, 'ongewijzigd', JSON.stringify(uitvoer));
    assert.deepEqual(store._schrijfacties, []);
    assert.equal(lees(store).leads.length, 1);
    assert.equal(lees(store).versie, 3);
  }
});

test('wijzigLead: een lead zonder bezoeken-lijst telt als lege historiek (resultaat vastleggen werkt)', () => {
  const basis = lead('a', { status: 'bevestigd', planning: { datum: '2026-10-12', start: '10:00', vast: true } });
  delete basis.bezoeken;
  const bezoek = { datum: '2026-10-12', resultaat: 'verkocht', op: 'x' };
  const r = pasWijzigingToe(blob([basis]), { leads: [{ id: 'a', velden: { bezoeken: [bezoek], status: 'afgewerkt', planning: null, resultaat: { soort: 'verkocht', op: 'x' } } }] }, opties());
  assert.deepEqual(r.fouten, []);
  assert.equal(r.data.leads[0].bezoeken.length, 1);
  assert.deepEqual(r.resultaten, [{ leadId: 'a', soort: 'verkocht' }]);
  // een leeg bezoeken-veld op zo'n lead is gewoon "geen wijziging"
  assert.deepEqual(pasWijzigingToe(blob([basis]), { leads: [{ id: 'a', velden: { bezoeken: [] } }] }, opties()).fouten, []);
});
