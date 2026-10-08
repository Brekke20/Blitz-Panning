import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeek, haversine } from '../public/js/planner.js';
import { zetVastUur, isVast } from '../public/js/sales/lead-regels.js';
import {
  STANDAARD_BEZOEKDUUR_MIN, leadNaarKandidaat, bouwPlanInvoer, verwerkUitkomst, maakReistijdenAdapter,
} from '../public/js/sales/planner-adapter.js';

// ---- hulpfuncties (verzonnen leads en coordinaten rond Hasselt / Genk / Antwerpen) ----
const nepReistijden = async (van, naar) =>
  new Map(naar.map(n => [n.id, haversine(van.lat, van.lon, n.lat, n.lon) * 1.3]));

const WEEK = '2026-10-05';    // maandag
const VANDAAG = '2026-10-06'; // dinsdag: de dinsdag is de eerste planningsdag
const DEPOT = { lat: 50.93, lon: 5.34 };
const INSTELLINGEN = { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 3, maxReistijdMin: 45, werkdagen: [1, 2, 3, 4, 5] };

const PLAATSEN = [
  { lat: 50.93, lon: 5.34 }, { lat: 50.96, lon: 5.50 }, { lat: 50.99, lon: 5.45 },
  { lat: 51.22, lon: 4.40 }, { lat: 51.20, lon: 4.45 }, { lat: 50.90, lon: 5.30 },
];
const lead = (id, extra = {}) => ({
  id, voornaam: 'Test', naam: 'Persoon ' + id, postcode: '3500', gemeente: 'Hasselt',
  status: 'te-plannen', geimporteerdOp: '2026-09-28T08:00:00.000Z', locatie: { lat: 50.93, lon: 5.34, bron: 'postcode' }, ...extra,
});
const voorgesteld = (id, datum, start = '09:00', extra = {}) =>
  lead(id, { status: 'voorgesteld', planning: { datum, start, vast: false }, ...extra });

const invoerVan = (leads, extra = {}) => bouwPlanInvoer({
  leads, blokken: [], instellingen: INSTELLINGEN, weekStart: WEEK, vandaag: VANDAAG, depot: DEPOT,
  reistijden: nepReistijden, feestdag: () => null, ...extra,
});

// ---- leadNaarKandidaat ----
test('leadNaarKandidaat: duur, locatie en wachttijd', () => {
  const l = lead('a', { duurMin: 90 });
  assert.deepEqual(leadNaarKandidaat(l, { standaardDuurMin: 45 }), {
    id: 'a', number: 'a', priority: 'medium', interventieDatum: null,
    inPlanningSinds: '2026-09-28T08:00:00.000Z', lat: 50.93, lon: 5.34, duurMin: 90,
  });
  assert.equal(leadNaarKandidaat(lead('b'), { standaardDuurMin: 45 }).duurMin, 45);
  assert.equal(leadNaarKandidaat(lead('b'), {}).duurMin, STANDAARD_BEZOEKDUUR_MIN);
  assert.equal(STANDAARD_BEZOEKDUUR_MIN, 60);
  const zonder = leadNaarKandidaat(lead('c', { locatie: null }), { standaardDuurMin: 60 });
  assert.equal(zonder.lat, null);
  assert.equal(zonder.lon, null);
});

// ---- bouwPlanInvoer: selectie ----
function mengeling() {
  return [
    lead('A'),
    voorgesteld('B', '2026-10-07'),
    lead('C', { status: 'bevestigd', planning: { datum: '2026-10-06', start: '10:00', vast: true } }),
    voorgesteld('D', '2026-10-08', '11:00', { planning: { datum: '2026-10-08', start: '11:00', vast: true } }), // corrupt: defensief vast
    lead('E', { status: 'afgewerkt', resultaat: { soort: 'verkocht', op: '2026-10-06T10:00:00.000Z' } }),
    voorgesteld('F', '2026-10-13'),
    voorgesteld('G', '2026-10-05'),
    zetVastUur(lead('H'), { datum: '2026-10-09', start: '14:00' }),
  ];
}

test('bouwPlanInvoer: kandidaten, vrijgegeven en bestaande bezoeken', () => {
  const { invoer, vrijgegeven } = invoerVan(mengeling());
  assert.deepEqual(invoer.kandidaten.map(k => k.id), ['A', 'B']);
  assert.deepEqual(vrijgegeven, ['B']);
  assert.deepEqual(invoer.dagen, ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(invoer.bestaandPerDag['2026-10-06'], [{ id: 'C', uur: '10:00', duurMin: 60, lat: 50.93, lon: 5.34 }]);
  assert.deepEqual(invoer.bestaandPerDag['2026-10-08'].map(b => b.id), ['D']);
  assert.deepEqual(invoer.bestaandPerDag['2026-10-09'].map(b => [b.id, b.uur]), [['H', '14:00']]);
  const overal = Object.values(invoer.bestaandPerDag).flat().map(b => b.id);
  for (const id of ['A', 'B', 'E', 'F', 'G']) assert.ok(!overal.includes(id), `${id} hoort niet bij de vaste bezoeken`);
  assert.deepEqual(invoer.klant, {});
  assert.equal(invoer.vandaag, VANDAAG);
  assert.deepEqual(invoer.depot, DEPOT);
  assert.equal(invoer.reistijden, nepReistijden);
  assert.equal(invoer.instellingen.maxPerDag, 3);
  assert.equal(invoer.instellingen.maxReistijdMin, 45);
});

test('bouwPlanInvoer: bezoekDuurMin uit de instellingen en eigen duur van de lead', () => {
  const { invoer } = invoerVan(
    [lead('A'), lead('C', { status: 'bevestigd', planning: { datum: '2026-10-06', start: '10:00', vast: true }, duurMin: 30 }),
      lead('D', { status: 'bevestigd', planning: { datum: '2026-10-06', start: '12:00', vast: true } })],
    { instellingen: { ...INSTELLINGEN, bezoekDuurMin: 75 } },
  );
  assert.equal(invoer.kandidaten[0].duurMin, 75);
  assert.deepEqual(invoer.bestaandPerDag['2026-10-06'].map(b => b.duurMin), [30, 75]);
});

test('bouwPlanInvoer: ontbrekende of null-instellingen krijgen standaardwaarden', async () => {
  for (const instellingen of [undefined, null, {}, { werkdagen: null, vanTijd: null, laatsteStart: null, maxPerDag: null, maxReistijdMin: null }]) {
    const { invoer } = invoerVan([lead('A'), lead('B', { locatie: { lat: 50.96, lon: 5.50 } })], { instellingen });
    assert.deepEqual(invoer.dagen, ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']); // ma-vr vanaf vandaag
    assert.equal(invoer.instellingen.vanTijd, '08:00');
    assert.equal(invoer.instellingen.laatsteStart, '16:00');
    const uitkomst = await planWeek(invoer); // crasht niet; zonder limieten past alles
    assert.equal(uitkomst.geplaatst.length, 2);
  }
});

// ---- blokken ----
test('bouwPlanInvoer: blokken en feestdagen', () => {
  const blokken = [
    { id: 'b1', datum: '2026-10-07', start: '00:00', eind: '23:59', soort: 'verlof' },
    { id: 'b2', datum: '2026-10-06', start: '13:00', eind: '14:00', soort: 'kantoor' },
    { id: 'b3', datum: '2026-10-08', start: '15:00', eind: '16:30', soort: 'afspraak', lat: 51.2, lon: 4.4 },
    { id: 'b4', datum: '2026-10-09', start: '00:00', eind: '24:00', soort: 'verlof' },
  ];
  const { invoer } = invoerVan([lead('A')], { blokken, feestdag: d => (d === '2026-10-08' ? 'Feestdag' : null) });
  assert.deepEqual(invoer.dagen, ['2026-10-06']); // 07 en 09 verlof, 08 feestdag
  assert.deepEqual(invoer.blokkeringen['2026-10-06'], [{ van: '13:00', tot: '14:00' }]);
  assert.deepEqual(invoer.eigenAfspraken['2026-10-08'], [{ uur: '15:00', duurMin: 90, lat: 51.2, lon: 4.4 }]);
  assert.equal(invoer.blokkeringen['2026-10-07'], undefined);
});

// ---- integratie met de echte planWeek: vaste bezoeken blijven ----
const KANDIDATEN = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].map((id, i) => lead(id, { locatie: { ...PLAATSEN[i], bron: 'postcode' } }));
const naarMin = u => Number(u.slice(0, 2)) * 60 + Number(u.slice(3));
const overlapt = (g, van, tot, duur = 60) => naarMin(g.verwachteAankomst) < naarMin(tot) && naarMin(van) < naarMin(g.verwachteAankomst) + duur;
const pas = (leads, wijzigingen) => leads.map(l => {
  const w = wijzigingen.find(x => x.id === l.id);
  if (!w) return l;
  const nieuw = { ...l, ...w.velden };
  if (nieuw.planning == null) delete nieuw.planning;
  return nieuw;
});

test('integratie: het brein plant rond een vast uur en verplaatst het nooit', async () => {
  // Controle: zonder vaste lead plant het brein dinsdag wel iets rond 10:00 (anders bewijst de test niets).
  const controle = await planWeek(invoerVan(KANDIDATEN).invoer);
  assert.ok(controle.geplaatst.some(g => g.datum === '2026-10-06' && overlapt(g, '10:00', '11:00')), 'controle: 10:00 is normaal bezet');

  for (const uur of ['10:00', '07:00', '18:30']) {
    const vast = zetVastUur(lead('V', { locatie: { lat: 50.95, lon: 5.4, bron: 'postcode' } }), { datum: '2026-10-06', start: uur });
    const leads = [vast, ...KANDIDATEN];
    const { invoer, vrijgegeven } = invoerVan(leads);
    assert.deepEqual(vrijgegeven, []);
    const uitkomst = await planWeek(invoer);
    assert.ok(!uitkomst.geplaatst.some(g => g.ticketId === 'V'), `${uur}: vaste lead niet geplaatst`);
    assert.ok(!uitkomst.nietGepland.some(n => n.ticketId === 'V'));
    const tot = `${String(Math.floor((naarMin(uur) + 60) / 60)).padStart(2, '0')}:${String((naarMin(uur) + 60) % 60).padStart(2, '0')}`;
    assert.ok(!uitkomst.geplaatst.some(g => g.datum === '2026-10-06' && overlapt(g, uur, tot)), `${uur}: geen overlap`);
    assert.ok(uitkomst.geplaatst.length >= 4, `${uur}: de kandidaten plannen eromheen`);
    const { wijzigingen, geplaatst } = verwerkUitkomst({ uitkomst, leads, vrijgegeven });
    assert.ok(!wijzigingen.some(w => w.id === 'V'), `${uur}: geen wijziging voor de vaste lead`);
    assert.equal(geplaatst, uitkomst.geplaatst.length);

    // wijzigingen toepassen en opnieuw plannen: het vaste uur blijft identiek
    const nieuweLeads = pas(leads, wijzigingen);
    const na = nieuweLeads.find(l => l.id === 'V');
    assert.deepEqual(na.planning, { datum: '2026-10-06', start: uur, vast: true });
    assert.equal(na.status, 'bevestigd');
    const tweede = bouwPlanInvoer({ leads: nieuweLeads, blokken: [], instellingen: INSTELLINGEN, weekStart: WEEK, vandaag: VANDAAG, depot: DEPOT, reistijden: nepReistijden, feestdag: () => null });
    assert.deepEqual(tweede.invoer.bestaandPerDag['2026-10-06'].map(b => [b.id, b.uur]), [['V', uur]]);
    const uitkomst2 = await planWeek(tweede.invoer);
    assert.ok(!uitkomst2.geplaatst.some(g => g.ticketId === 'V'));
    assert.ok(!uitkomst2.geplaatst.some(g => g.datum === '2026-10-06' && overlapt(g, uur, tot)));
    assert.ok(!verwerkUitkomst({ uitkomst: uitkomst2, leads: nieuweLeads, vrijgegeven: tweede.vrijgegeven }).wijzigingen.some(w => w.id === 'V'));
  }
});

test('vast uur op een dag die het brein niet plant, belemmert niets en staat nergens in de invoer', () => {
  const vastOp = (datum) => zetVastUur(lead('V'), { datum, start: '10:00' });
  const gevallen = [
    ['feestdag', '2026-10-07', { feestdag: d => (d === '2026-10-07' ? 'Feest' : null) }],
    ['hele-dag-verlof', '2026-10-07', { blokken: [{ id: 'b', datum: '2026-10-07', start: '00:00', eind: '23:59', soort: 'verlof' }] }],
    ['weekend', '2026-10-10', {}],
    ['andere week', '2026-10-14', {}],
  ];
  for (const [naam, datum, extra] of gevallen) {
    const { invoer } = invoerVan([vastOp(datum), lead('A')], extra);
    assert.deepEqual(Object.values(invoer.bestaandPerDag).flat(), [], naam);
    assert.deepEqual(invoer.kandidaten.map(k => k.id), ['A'], naam);
    assert.ok(!invoer.dagen.includes(datum), naam);
  }
});

test('vast uur op een planningsdag: de kandidaten plannen op de overige dagen en rond dat uur', async () => {
  const vast = zetVastUur(lead('V'), { datum: '2026-10-06', start: '09:00' });
  const { invoer } = invoerVan([vast, ...KANDIDATEN]);
  assert.deepEqual(invoer.bestaandPerDag['2026-10-06'].map(b => b.id), ['V']);
  const uitkomst = await planWeek(invoer);
  const dagen = new Set(uitkomst.geplaatst.map(g => g.datum));
  assert.ok(dagen.size > 1, 'ook op andere dagen');
  assert.ok(!uitkomst.geplaatst.some(g => g.datum === '2026-10-06' && overlapt(g, '09:00', '10:00')));
});

// ---- verwerkUitkomst ----
test('verwerkUitkomst: geplaatst, vrijgegeven zonder plaats en nietGepland', async () => {
  const leads = [
    lead('A'),
    lead('Z', { locatie: null }),
    voorgesteld('B', '2026-10-07'),
    voorgesteld('Y', '2026-10-08', '09:00', { locatie: null }),
  ];
  const { invoer, vrijgegeven } = invoerVan(leads);
  assert.deepEqual(vrijgegeven, ['B', 'Y']);
  const uitkomst = await planWeek(invoer);
  const r = verwerkUitkomst({ uitkomst, leads, vrijgegeven });
  const perId = Object.fromEntries(r.wijzigingen.map(w => [w.id, w.velden]));
  for (const id of ['A', 'B']) {
    const g = uitkomst.geplaatst.find(x => x.ticketId === id);
    assert.deepEqual(perId[id], { status: 'voorgesteld', planning: { datum: g.datum, start: g.verwachteAankomst, vast: false } });
  }
  assert.deepEqual(perId.Y, { status: 'te-plannen', planning: null }); // vrijgegeven maar zonder plaats
  assert.equal(perId.Z, undefined); // al te-plannen en niet geplaatst: geen wijziging
  assert.equal(r.geplaatst, 2);
  assert.deepEqual(r.nietGepland.map(n => [n.leadId, n.reden]).sort(), [['Y', 'adres-niet-gevonden'], ['Z', 'adres-niet-gevonden']]);
  assert.deepEqual(r.waarschuwingen, uitkomst.waarschuwingen);
});

test('verwerkUitkomst: een vaste lead komt nooit in wijzigingen, ook niet als de uitkomst hem noemt', () => {
  const leads = [zetVastUur(lead('V'), { datum: '2026-10-06', start: '10:00' }), lead('A')];
  const uitkomst = {
    geplaatst: [{ ticketId: 'V', datum: '2026-10-07', verwachteAankomst: '09:00' }, { ticketId: 'A', datum: '2026-10-07', verwachteAankomst: '10:00' }],
    nietGepland: [], waarschuwingen: [{ soort: 'reistijd-geschat', ticketIds: ['A'] }],
  };
  const r = verwerkUitkomst({ uitkomst, leads, vrijgegeven: ['V'] });
  assert.deepEqual(r.wijzigingen.map(w => w.id), ['A']);
  assert.equal(r.geplaatst, 1);
  assert.deepEqual(r.waarschuwingen, uitkomst.waarschuwingen);
  assert.ok(isVast(leads[0]));
});

// ---- maakReistijdenAdapter ----
const van = { lat: 50.93, lon: 5.34 };
const naar = [{ id: 'a', lat: 50.96, lon: 5.50 }, { id: 'b', lat: 51.22, lon: 4.40 }];

test('maakReistijdenAdapter: testmodus gebruikt haversine x 1,3 zonder aanroep', async () => {
  let aanroepen = 0;
  const adapter = maakReistijdenAdapter({ apiVerzoek: async () => { aanroepen++; return { ok: true, data: {} }; }, testModus: true });
  const m = await adapter(van, naar, '2026-10-06T08:00:00.000Z');
  assert.equal(aanroepen, 0);
  assert.equal(m.get('a'), haversine(van.lat, van.lon, 50.96, 5.50) * 1.3);
  assert.equal(m.get('b'), haversine(van.lat, van.lon, 51.22, 4.40) * 1.3);
});

test('maakReistijdenAdapter: /api/matrix, seconden worden minuten', async () => {
  let gezien;
  const adapter = maakReistijdenAdapter({
    apiVerzoek: async (url, opties) => { gezien = { url, opties }; return { ok: true, data: { results: [{ travelTimeSeconds: 600 }, { travelTimeSeconds: 5400 }] } }; },
    testModus: false,
  });
  const m = await adapter(van, naar, '2026-10-06T08:00:00.000Z');
  assert.equal(gezien.url, '/api/matrix');
  assert.equal(gezien.opties.methode, 'POST');
  assert.deepEqual(gezien.opties.body, {
    origin: { lat: 50.93, lon: 5.34 },
    destinations: [{ lat: 50.96, lon: 5.50 }, { lat: 51.22, lon: 4.40 }],
    departAt: '2026-10-06T08:00:00.000Z',
  });
  assert.equal(m.get('a'), 10);
  assert.equal(m.get('b'), 90);
});

test('maakReistijdenAdapter: een fout geeft overal null en gooit nooit', async () => {
  const gevallen = [
    async () => ({ ok: false, status: 503, data: { error: 'storing' } }),
    async () => { throw new Error('netwerk'); },
    async () => ({ ok: true, data: { results: [{ travelTimeSeconds: 600 }] } }), // tweede cel ontbreekt
  ];
  const verwacht = [[null, null], [null, null], [10, null]];
  for (const [i, apiVerzoek] of gevallen.entries()) {
    const m = await maakReistijdenAdapter({ apiVerzoek, testModus: false })(van, naar, '2026-10-06T08:00:00.000Z');
    assert.deepEqual([m.get('a'), m.get('b')], verwacht[i]);
  }
});
