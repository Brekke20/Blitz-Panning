process.env.TZ = 'Europe/Brussels';
// v2.1.6 (klantmelding): "+" en "+ Voeg toe aan planning" zetten #3979 (Oostduinkerke) op vr 16 okt naast #3894 (Meise, vast 14:45),
// 90 min rijden uit elkaar. Nu toetst "+" elke dag met de regels van het brein (planner.js toetsDag/eersteHaalbareDag) en zoekt
// capaciteit.js zoekHaalbareDag de eerste dag die past. Nooit echte TomTom: reistijden komen uit een vaste functie of een nep-fetch.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { toetsDag, eersteHaalbareDag, haversine } from '../public/js/planner.js';
import { vrijeDagenVanaf, plusRedenTekst, zoekHaalbareDag, initCapaciteit, PLUS_MAX_MATRIX } from '../public/js/schermen/capaciteit.js';
import { toestand } from '../public/js/kern/toestand.js';
import { zetFetch } from '../public/js/kern/api.js';

// Plaatsen (lat/lon): de startlocatie bij Kruibeke, de twee tickets van de melding, en een stop vlak bij Meise.
const KRUIBEKE = { lat: 51.17, lon: 4.31 };
const OOSTDUINKERKE = { lat: 51.115, lon: 2.68 };
const MEISE = { lat: 50.94, lon: 4.33 };
const VILVOORDE = { lat: 50.93, lon: 4.43 };

// Deterministische reistijd: 0,77 min per km in vogelvlucht (Oostduinkerke-Meise is zo ongeveer 90 min, zoals de Route-tab toonde).
const minuten = (a, b) => haversine(a.lat, a.lon, b.lat, b.lon) * 0.77;
function maakReistijden(override = () => null) {
  const opvragingen = [];
  const reistijden = async (van, naar) => {
    opvragingen.push({ van, naar: naar.map(n => n.id) });
    return new Map(naar.map(n => [n.id, override(van, n) ?? minuten(van, n)]));
  };
  return { reistijden, opvragingen };
}

const INST = { vanTijd: '12:00', laatsteStart: '16:00', maxPerDag: 4, maxReistijdMin: 45 };
const DAG = '2026-10-16'; // vrijdag
const basis = (extra = {}) => ({
  kandidaat: { id: '3979', ...OOSTDUINKERKE, duurMin: 60 },
  bestaandPerDag: {}, eigenAfspraken: {}, blokkeringen: {}, klant: {},
  instellingen: INST, depot: KRUIBEKE, vandaag: '2026-10-15', ...extra,
});
const meiseOm1445 = { [DAG]: [{ id: '3894', uur: '14:45', duurMin: 60, ...MEISE }] };

test('toetsDag: Oostduinkerke op een dag met Meise vast om 14:45 wordt geweigerd (te ver)', async () => {
  const { reistijden, opvragingen } = maakReistijden();
  const uit = await toetsDag(basis({ bestaandPerDag: meiseOm1445, reistijden }), DAG);
  assert.deepEqual(uit, { ok: false, reden: 'te-ver' });
  // De voorfilter in vogelvlucht (meer dan 45 min aan 120 km/u) weigert de dag zonder één reistijdopvraging.
  assert.equal(opvragingen.length, 0);
});

test('toetsDag: ook zonder voorfilter weigert het brein de dag als de echte rit naar de vaste stop te lang is', async () => {
  // Kandidaat op ~25 km van Meise (de voorfilter laat hem door), maar de matrix zegt 90 min (bv. file of omweg).
  const dichtbij = { lat: 50.80, lon: 4.05 };
  const { reistijden, opvragingen } = maakReistijden((van, n) => (n.id === '3979' && van.lat === MEISE.lat ? 90 : null));
  const uit = await toetsDag(basis({ kandidaat: { id: '3979', ...dichtbij, duurMin: 60 }, bestaandPerDag: meiseOm1445, reistijden }), DAG);
  assert.equal(uit.ok, false);
  assert.equal(uit.reden, 'te-ver');
  assert.ok(opvragingen.length >= 1);
});

test('toetsDag: op een lege dag mag het ticket (starter, geen afstandsregel)', async () => {
  const { reistijden } = maakReistijden();
  const uit = await toetsDag(basis({ reistijden }), DAG);
  assert.equal(uit.ok, true);
  assert.equal(uit.geschat, false);
});

test('toetsDag: naast een stop op minder dan 45 min mag het ticket', async () => {
  const { reistijden } = maakReistijden();
  const uit = await toetsDag(basis({ kandidaat: { id: 'n', ...VILVOORDE, duurMin: 60 }, bestaandPerDag: meiseOm1445, reistijden }), DAG);
  assert.equal(uit.ok, true);
  assert.ok(minuten(VILVOORDE, MEISE) < 45);
});

test('toetsDag: vóór een vaste stop die het ticket niet meer op tijd haalt, wordt geweigerd (ook binnen 45 min)', async () => {
  // Depot -> kandidaat 20 min, kandidaat -> vaste stop 40 min (onder de 45). Aankomst 12:20, klaar 13:20, bij de vaste stop om 14:00.
  const K = { id: 'k', lat: 51.0, lon: 4.0, duurMin: 60 };
  const X = { id: 'x', lat: 51.3, lon: 4.0 };
  const vast = { 'k|depot': 20, 'k|x': 40 };
  const override = (van, n) => (n.id === 'k' ? (van.lat === X.lat ? vast['k|x'] : vast['k|depot']) : null);
  const inst = { ...INST, laatsteStart: '13:00' };
  const te = { [DAG]: [{ ...X, uur: '13:45', duurMin: 60 }] };   // 13:20 + 40 = 14:00 > 13:45: niet op tijd, en na de stop is het te laat
  const ok = { [DAG]: [{ ...X, uur: '14:15', duurMin: 60 }] };   // 14:00 <= 14:15: haalbaar
  const a = await toetsDag(basis({ kandidaat: K, instellingen: inst, bestaandPerDag: te, reistijden: maakReistijden(override).reistijden }), DAG);
  assert.equal(a.ok, false);
  const b = await toetsDag(basis({ kandidaat: K, instellingen: inst, bestaandPerDag: ok, reistijden: maakReistijden(override).reistijden }), DAG);
  assert.equal(b.ok, true);
  assert.equal(b.verwachteAankomst, '12:20');
});

test('toetsDag: een klantblokkering, een volle dag en een ticket zonder coördinaten kosten geen reistijdopvraging', async () => {
  const { reistijden, opvragingen } = maakReistijden();
  assert.deepEqual(await toetsDag(basis({ klant: { 3979: { geblokkeerd: [DAG] } }, reistijden }), DAG), { ok: false, reden: 'klant-geblokkeerd' });
  assert.deepEqual(await toetsDag(basis({ instellingen: { ...INST, maxPerDag: 1 }, bestaandPerDag: { [DAG]: [{ id: 'y', uur: null, duurMin: 60 }] }, reistijden }), DAG), { ok: false, reden: 'geen-plaats' });
  assert.deepEqual(await toetsDag(basis({ kandidaat: { id: 'z', duurMin: 60 }, reistijden }), DAG), { ok: false, reden: 'adres-niet-gevonden' });
  assert.equal(opvragingen.length, 0);
});

test('eersteHaalbareDag: slaat de onmogelijke dag over en stopt bij de eerste dag die past', async () => {
  const { reistijden } = maakReistijden();
  const dagen = ['2026-10-16', '2026-10-19', '2026-10-20'];
  const uit = await eersteHaalbareDag(basis({ bestaandPerDag: meiseOm1445, reistijden }), { dagen });
  assert.equal(uit.datum, '2026-10-19');
});

test('eersteHaalbareDag: geen enkele dag past = redenen per dag; moetStoppen breekt af', async () => {
  const { reistijden } = maakReistijden();
  const per = { '2026-10-16': meiseOm1445[DAG], '2026-10-19': meiseOm1445[DAG] };
  const uit = await eersteHaalbareDag(basis({ bestaandPerDag: per, reistijden }), { dagen: Object.keys(per) });
  assert.deepEqual(uit, { datum: null, redenen: [{ dag: '2026-10-16', reden: 'te-ver' }, { dag: '2026-10-19', reden: 'te-ver' }] });
  const af = await eersteHaalbareDag(basis({ reistijden }), { dagen: ['2026-10-19'], moetStoppen: () => true });
  assert.equal(af.afgebroken, true);
});

test('vrijeDagenVanaf: begint op een latere voorkeursdatum, slaat volle dagen en het weekend over, begrensd op `aantal`', () => {
  const nu = new Date(2026, 9, 15, 10, 0);
  const werkdagen = [1, 2, 3, 4, 5];
  assert.deepEqual(vrijeDagenVanaf('2026-10-15', { nu, werkdagen, heeftPlaats: () => true, aantal: 3 }), ['2026-10-15', '2026-10-16', '2026-10-19']);
  assert.deepEqual(vrijeDagenVanaf('2026-10-15', { nu, werkdagen, heeftPlaats: d => d !== '2026-10-23', voorkeur: '2026-10-23', aantal: 2 }), ['2026-10-26', '2026-10-27']);
  assert.deepEqual(vrijeDagenVanaf('2026-10-15', { nu, werkdagen, heeftPlaats: () => false, aantal: 5 }), []);
});

test('plusRedenTekst: de toast noemt de afstandsgrens en de periode', () => {
  assert.equal(plusRedenTekst([{ dag: DAG, reden: 'te-ver' }], { maxReistijdMin: 45, weken: 3 }),
    'Geen geschikte dag gevonden in de komende 3 weken: te ver van de andere afspraken (max. 45 min rijden)');
  assert.equal(plusRedenTekst([{ dag: DAG, reden: 'te-ver' }, { dag: '2026-10-19', reden: 'geen-plaats' }], { maxReistijdMin: 30, weken: 1 }),
    'Geen geschikte dag gevonden in de komende week: te ver van de andere afspraken (max. 30 min rijden), of geen vrije plaats die op tijd te halen is');
});

// ── zoekHaalbareDag: de toestandslezer met een nep-fetch voor /api/matrix ──
const werk = (a, b) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); return (h2 * 60 + m2) - (h1 * 60 + m1); };
const ticket = (id, nummer, plaats, extra = {}) => ({ id, number: nummer, assignee: 'Brent', status: 'Service in te plannen', address: 'Adres ' + nummer, hasAddress: true, _lat: plaats.lat, _lon: plaats.lon, ...extra });
function zaai({ planning = {}, kb = {}, allTickets }) {
  toestand.set('settings', { startlocatie: '', duurMinuten: 60, maxPerDag: 4, vanTijd: '12:00', totTijd: '17:00', laatsteStart: '16:00', werkdagen: [1, 2, 3, 4, 5], maxReistijdMin: 45 });
  toestand.set('activeAssigneeFilter', 'Brent');
  toestand.set('planning', planning);
  toestand.set('localEvents', []);
  toestand.set('avExceptions', []);
  toestand.set('allTickets', allTickets);
  initCapaciteit({ duurVoor: () => 60, werktijdMin: werk, kbPreferredTime: id => kb[id]?.voorkeurTijd || null, kbPreferred: id => kb[id]?.voorkeur || null, kbFor: id => kb[id] || null });
}
function nepMatrix({ status = 200, minutenVoor = (o, d) => minuten(o, d) } = {}) {
  const verzoeken = [];
  zetFetch(async (pad, init) => {
    const body = JSON.parse(init.body);
    verzoeken.push({ pad, body });
    if (pad !== '/api/matrix') throw new Error('onverwacht pad ' + pad);
    const data = status === 200
      ? { results: body.destinations.map(d => ({ travelTimeSeconds: Math.round(minutenVoor(body.origin, d) * 60) })) }
      : { error: 'TomTom Matrix-fout' };
    return { ok: status === 200, status, json: async () => data };
  });
  return verzoeken;
}
const meiseStop = ticket('3894', '3894', MEISE, { status: 'Wachten op bevestiging planning' });

test('zoekHaalbareDag: de melding van de klant - vr 16 okt (Meise 14:45) wordt overgeslagen, het wordt ma 19 okt', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 15, 17, 0).getTime() }); // do 15 okt na laatsteStart: vandaag past niet
  const verzoeken = nepMatrix();
  try {
    zaai({ planning: { '2026-10-16': [{ ticket: meiseStop, address: meiseStop.address, uur: '14:45' }] }, allTickets: [ticket('3979', '3979', OOSTDUINKERKE)] });
    assert.deepEqual(await zoekHaalbareDag('3979'), { status: 'ok', datum: '2026-10-19' });
    assert.ok(verzoeken.length <= PLUS_MAX_MATRIX);
  } finally { mock.timers.reset(); zetFetch(null); }
});

test('zoekHaalbareDag: geen dag past binnen de horizon = status geen, met de afstandsreden', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 15, 17, 0).getTime() });
  nepMatrix();
  try {
    // Elke werkdag van de komende 60 dagen heeft Meise om 14:45.
    const planning = {};
    for (let d = new Date(2026, 9, 16, 12); d < new Date(2026, 11, 20); d.setDate(d.getDate() + 1)) {
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      planning[s] = [{ ticket: meiseStop, address: meiseStop.address, uur: '14:45' }];
    }
    zaai({ planning, allTickets: [ticket('3979', '3979', OOSTDUINKERKE)] });
    const uit = await zoekHaalbareDag('3979');
    assert.equal(uit.status, 'geen');
    assert.equal(uit.tekst, 'Geen geschikte dag gevonden in de komende 3 weken: te ver van de andere afspraken (max. 45 min rijden)');
  } finally { mock.timers.reset(); zetFetch(null); }
});

test('zoekHaalbareDag: de voorkeursdatum van de klant blijft het vertrekpunt', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 15, 9, 0).getTime() });
  nepMatrix();
  try {
    const kb = { '3979': { voorkeur: '2026-10-23', voorkeurTijd: null, geblokkeerd: [] } };
    zaai({ kb, allTickets: [ticket('3979', '3979', OOSTDUINKERKE)] });
    assert.deepEqual(await zoekHaalbareDag('3979'), { status: 'ok', datum: '2026-10-23' });
  } finally { mock.timers.reset(); zetFetch(null); }
});

test('zoekHaalbareDag: faalt de matrix, dan is het resultaat onzeker (geen stille terugval op de oude regel)', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 15, 17, 0).getTime() });
  // Vilvoorde ligt vlak bij Meise: de voorfilter laat de dag door, dus het brein vraagt reistijden op.
  const verzoeken = nepMatrix({ status: 500 });
  try {
    zaai({ planning: { '2026-10-16': [{ ticket: meiseStop, address: meiseStop.address, uur: '14:45' }] }, allTickets: [ticket('v', '4000', VILVOORDE)] });
    const uit = await zoekHaalbareDag('v');
    assert.equal(uit.status, 'onzeker');
    assert.match(uit.tekst, /De reistijd kon niet gecontroleerd worden/);
    assert.equal(verzoeken.length, 1); // na de eerste fout stopt de zoektocht
  } finally { mock.timers.reset(); zetFetch(null); }
});

test('zoekHaalbareDag: een adres dat niet gevonden wordt is onzeker; een ticket zonder adres volgt de vrije-plek-regel', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 15, 9, 0).getTime() });
  nepMatrix();
  try {
    // Geen startlocatie in de instellingen: er wordt niet gegeocodeerd, het adres blijft zonder coördinaten.
    zaai({ allTickets: [ticket('x', '5000', { lat: null, lon: null })] });
    assert.equal((await zoekHaalbareDag('x')).status, 'onzeker');
    // Zonder adres is er geen reistijd om te toetsen: de eerste dag met een vrije plek (zoals vóór v2.1.6).
    zaai({ allTickets: [ticket('y', '5001', { lat: null, lon: null }, { hasAddress: false, address: '' })] });
    assert.deepEqual(await zoekHaalbareDag('y'), { status: 'ok', datum: '2026-10-15' });
  } finally { mock.timers.reset(); zetFetch(null); }
});
