import test from 'node:test';
import assert from 'node:assert/strict';
import { bouwRouteStops, afgewerktOpDag, schatLegs, controleerKeten, routeHandtekening, wegpunten, ritPerStop, vertrekIso, berekenRoute } from '../public/js/schermen/sales-route-logica.js';
import { haversine } from '../public/js/planner.js';

const DAG = '2026-10-12';
const lead = (id, status, start, extra = {}) => ({
  id, voornaam: 'Marie', naam: 'Janssens ' + id, postcode: '3500', gemeente: 'Hasselt', status,
  planning: { datum: DAG, start, vast: status === 'bevestigd' },
  locatie: { lat: 50.93, lon: 5.34, bron: 'adres' }, ...extra,
});

test('bouwRouteStops: op uur gesorteerd, nr vanaf 1, enkel voorgesteld/bevestigd van die dag', () => {
  const leads = [
    lead('laat', 'bevestigd', '14:00'),
    lead('vroeg', 'voorgesteld', '09:00'),
    lead('anders', 'voorgesteld', '09:00', { planning: { datum: '2026-10-13', start: '09:00', vast: false } }),
    { id: 'tp', status: 'te-plannen', voornaam: 'Els', naam: 'Maes' },
  ];
  const stops = bouwRouteStops(leads, DAG);
  assert.deepEqual(stops.map((s) => [s.nr, s.leadId, s.start]), [[1, 'vroeg', '09:00'], [2, 'laat', '14:00']]);
  assert.equal(stops[0].naam, 'Marie Janssens vroeg');
  assert.equal(stops[0].plaats, 'Hasselt (3500)');
  assert.equal(stops[0].vast, false);
  assert.equal(stops[1].vast, true);
  assert.equal(stops[0].startMin, 540);
});

test('bouwRouteStops: ongeveer bij postcode-locatie, locatie null zonder locatie', () => {
  const leads = [
    lead('exact', 'voorgesteld', '09:00'),
    lead('pc', 'voorgesteld', '10:00', { locatie: { lat: 50.9, lon: 5.3, bron: 'postcode' } }),
    lead('geen', 'voorgesteld', '11:00', { locatie: null }),
    lead('ontbreekt', 'voorgesteld', '12:00', { locatie: undefined }),
  ];
  const [exact, pc, geen, ontbreekt] = bouwRouteStops(leads, DAG);
  assert.deepEqual(exact.locatie, { lat: 50.93, lon: 5.34 });
  assert.equal(exact.ongeveer, false);
  assert.deepEqual(pc.locatie, { lat: 50.9, lon: 5.3 });
  assert.equal(pc.ongeveer, true);
  assert.equal(geen.locatie, null);
  assert.equal(geen.ongeveer, false);
  assert.equal(ontbreekt.locatie, null);
});

test('bouwRouteStops: duur uit duurMin of de standaard', () => {
  const stops = bouwRouteStops([lead('a', 'voorgesteld', '09:00', { duurMin: 90 }), lead('b', 'voorgesteld', '12:00')], DAG, { standaardDuurMin: 45 });
  assert.deepEqual(stops.map((s) => s.duurMin), [90, 45]);
  assert.equal(bouwRouteStops([lead('c', 'voorgesteld', '09:00')], DAG)[0].duurMin, 60);
});

test('bouwRouteStops: lege of ontbrekende lijst', () => {
  assert.deepEqual(bouwRouteStops([], DAG), []);
  assert.deepEqual(bouwRouteStops(undefined, DAG), []);
});

test('schatLegs: n-1 legs met haversine x 1,3 km aan 50 km/u', () => {
  const punten = [{ lat: 50.93, lon: 5.34 }, { lat: 50.96, lon: 5.50 }, { lat: 51.22, lon: 4.40 }];
  const legs = schatLegs(punten);
  assert.equal(legs.length, 2);
  const km = haversine(50.93, 5.34, 50.96, 5.50) * 1.3;
  assert.equal(legs[0].distanceMeters, Math.round(km * 1000));
  assert.equal(legs[0].travelTimeSeconds, Math.round((km / 50) * 3600));
  assert.deepEqual(schatLegs([punten[0]]), []);
  assert.deepEqual(schatLegs([]), []);
});

test('schatLegs: een punt zonder coordinaten geeft een leg zonder waarden', () => {
  const legs = schatLegs([{ lat: 50.93, lon: 5.34 }, { lat: null, lon: null }]);
  assert.deepEqual(legs, [{ travelTimeSeconds: null, distanceMeters: null }]);
});

// Stops met uur en duur; de rit naar stop i staat in legsMin[i] (eerste = depot -> stop 1).
const stop = (leadId, start, duurMin = 60) => {
  const [h, m] = start.split(':').map(Number);
  return { leadId, start, startMin: h * 60 + m, duurMin };
};

test('controleerKeten: vlagt een stop die 12 min te laat is', () => {
  const stops = [stop('a', '09:00'), stop('b', '10:10')]; // a eindigt 10:00, rit 22 min -> 10:22 i.p.v. 10:10
  const r = controleerKeten(stops, [20, 22], 8 * 60 + 30);
  assert.deepEqual(r, [{ leadId: 'b', laatMin: 12 }]);
});

test('controleerKeten: een haalbare keten geeft niets', () => {
  const stops = [stop('a', '09:00'), stop('b', '10:30')];
  assert.deepEqual(controleerKeten(stops, [20, 22], 8 * 60 + 30), []);
});

test('controleerKeten: de eerste afspraak telt vanaf het vertrek uit het depot', () => {
  const stops = [stop('a', '09:00')];
  assert.deepEqual(controleerKeten(stops, [45], 8 * 60 + 30), [{ leadId: 'a', laatMin: 15 }]);
  assert.deepEqual(controleerKeten(stops, [30], 8 * 60 + 30), []);
});

test('controleerKeten: onbekende rit of onbekend vertrek wordt niet gecontroleerd', () => {
  const stops = [stop('a', '09:00'), stop('b', '10:00')];
  assert.deepEqual(controleerKeten(stops, [null, null], 8 * 60 + 30), []);
  // Zonder depotvertrek wordt enkel de rit tussen de stops nagekeken (a eindigt 10:00, rit 5 min naar b om 10:00).
  assert.deepEqual(controleerKeten(stops, [600, 5], null), [{ leadId: 'b', laatMin: 5 }]);
  assert.deepEqual(controleerKeten([], [], 480), []);
});

// ---- routeHandtekening ----
const DEPOT = { lat: 50.93, lon: 5.34 };
const metLoc = (leadId, lat, lon) => ({ leadId, locatie: { lat, lon } });

test('routeHandtekening: verandert bij andere volgorde, ids of coordinaten', () => {
  const a = metLoc('a', 50.96, 5.5), b = metLoc('b', 51.22, 4.4);
  const basis = routeHandtekening(DEPOT, [a, b]);
  assert.equal(typeof basis, 'string');
  assert.equal(routeHandtekening(DEPOT, [a, b]), basis);
  assert.notEqual(routeHandtekening(DEPOT, [b, a]), basis);
  assert.notEqual(routeHandtekening(DEPOT, [a, metLoc('c', 51.22, 4.4)]), basis);
  assert.notEqual(routeHandtekening(DEPOT, [a, metLoc('b', 51.22, 4.41)]), basis);
  assert.notEqual(routeHandtekening({ lat: 50.9, lon: 5.34 }, [a, b]), basis);
  assert.notEqual(routeHandtekening(DEPOT, [a]), basis);
});

test('routeHandtekening: zonder depot of locatie crasht niet', () => {
  assert.equal(typeof routeHandtekening(null, [{ leadId: 'a', locatie: null }]), 'string');
  assert.notEqual(routeHandtekening(null, [{ leadId: 'a', locatie: null }]), routeHandtekening(null, [{ leadId: 'b', locatie: null }]));
});

// ---- wegpunten / ritPerStop / vertrekIso / berekenRoute (Task 18) ----
const stopL = (leadId, lat, lon, extra = {}) => ({ leadId, start: '09:00', startMin: 540, duurMin: 60, locatie: lat == null ? null : { lat, lon }, ...extra });

test('wegpunten: depot eerst, stops zonder locatie vallen weg, `bij` wijst terug naar de stop (depot = -1)', () => {
  const stops = [stopL('a', 50.96, 5.5), stopL('b', null, null), stopL('c', 51.22, 4.4)];
  const w = wegpunten(DEPOT, stops);
  assert.deepEqual(w.punten, [DEPOT, { lat: 50.96, lon: 5.5 }, { lat: 51.22, lon: 4.4 }]);
  assert.deepEqual(w.bij, [-1, 0, 2]);
  assert.deepEqual(wegpunten(null, stops).bij, [0, 2]);
  assert.deepEqual(wegpunten(null, []), { punten: [], bij: [] });
});

test('ritPerStop: de rit naar elke stop; over een stop zonder locatie heen is de rit onbekend (null)', () => {
  const stops = [stopL('a', 50.96, 5.5), stopL('b', null, null), stopL('c', 51.22, 4.4)];
  const legs = [{ travelTimeSeconds: 600, distanceMeters: 9000 }, { travelTimeSeconds: 1800, distanceMeters: 40000 }];
  const r = ritPerStop(DEPOT, stops, legs);
  assert.deepEqual(r, [{ ritSec: 600, afstandM: 9000 }, { ritSec: null, afstandM: null }, { ritSec: null, afstandM: null }]);
  const alles = ritPerStop(DEPOT, [stopL('a', 50.96, 5.5), stopL('c', 51.22, 4.4)], legs);
  assert.deepEqual(alles.map((x) => x.ritSec), [600, 1800]);
});

test('ritPerStop: zonder depot heeft de eerste stop geen rit', () => {
  const r = ritPerStop(null, [stopL('a', 50.96, 5.5), stopL('c', 51.22, 4.4)], [{ travelTimeSeconds: 1800, distanceMeters: 40000 }]);
  assert.deepEqual(r, [{ ritSec: null, afstandM: null }, { ritSec: 1800, afstandM: 40000 }]);
});

test('vertrekIso: enkel een tijdstip in de toekomst (lokale tijd), anders undefined', () => {
  const nu = new Date('2026-10-05T09:00:00+02:00');
  assert.equal(vertrekIso('2026-10-12', 8 * 60 + 30, nu), new Date('2026-10-12T08:30:00').toISOString());
  assert.equal(vertrekIso('2026-10-05', 8 * 60, nu), undefined);
  assert.equal(vertrekIso('2026-10-12', null, nu), undefined);
  assert.equal(vertrekIso('nietiso', 480, nu), undefined);
});

test('berekenRoute testmodus: geschat zonder netwerk, polyline door de punten, ritten per stop', async () => {
  let aangeroepen = 0;
  const stops = [stopL('a', 50.96, 5.5), stopL('c', 51.22, 4.4)];
  const r = await berekenRoute({ depot: DEPOT, stops, datum: DAG, vertrekMin: 510, testModus: true, apiVerzoek: async () => { aangeroepen++; } });
  assert.equal(aangeroepen, 0);
  assert.equal(r.geschat, true);
  assert.equal(r.legs.length, 2);
  assert.ok(r.legs.every((l) => l.ritSec > 0 && l.afstandM > 0));
  assert.deepEqual(r.polyline, [[50.93, 5.34], [50.96, 5.5], [51.22, 4.4]]);
  assert.equal(r.totaalSec, r.legs[0].ritSec + r.legs[1].ritSec);
});

test('berekenRoute: POST /api/route met waypoints en departAt; de legs van TomTom worden gebruikt', async () => {
  const oproepen = [];
  const stops = [stopL('a', 50.96, 5.5), stopL('c', 51.22, 4.4)];
  const apiVerzoek = async (pad, opties) => {
    oproepen.push({ pad, opties });
    return { ok: true, status: 200, data: { legs: [{ travelTimeSeconds: 700, distanceMeters: 8000 }, { travelTimeSeconds: 2000, distanceMeters: 90000 }], polyline: [[1, 1], [2, 2]] } };
  };
  const nu = new Date('2026-10-05T09:00:00+02:00');
  const r = await berekenRoute({ depot: DEPOT, stops, datum: DAG, vertrekMin: 510, testModus: false, apiVerzoek, nu });
  assert.equal(oproepen.length, 1);
  assert.equal(oproepen[0].pad, '/api/route');
  assert.equal(oproepen[0].opties.methode, 'POST');
  assert.deepEqual(oproepen[0].opties.body.waypoints, [DEPOT, { lat: 50.96, lon: 5.5 }, { lat: 51.22, lon: 4.4 }]);
  assert.equal(oproepen[0].opties.body.departAt, vertrekIso(DAG, 510, nu));
  assert.equal(r.geschat, false);
  assert.deepEqual(r.legs, [{ ritSec: 700, afstandM: 8000 }, { ritSec: 2000, afstandM: 90000 }]);
  assert.deepEqual(r.polyline, [[1, 1], [2, 2]]);
  assert.equal(r.totaalSec, 2700);
  assert.equal(r.totaalMeter, 98000);
  // het ruwe antwoord blijft bewaard: de kaart kleurt er de drukte en de wegenwerken mee in (zoals bij de technieker)
  assert.equal(r.data.polyline.length, 2);
  assert.equal(r.data.legs.length, 2);
});

test('berekenRoute: zonder routelijn van TomTom is er geen `data` (de kaart tekent dan rechte lijnen); een schatting heeft ook geen data', async () => {
  const stops = [stopL('a', 50.96, 5.5)];
  const zonderLijn = async () => ({ ok: true, status: 200, data: { legs: [{ travelTimeSeconds: 700, distanceMeters: 8000 }] } });
  const r = await berekenRoute({ depot: DEPOT, stops, datum: DAG, vertrekMin: 510, testModus: false, apiVerzoek: zonderLijn });
  assert.equal(r.geschat, false);
  assert.equal(r.data, null);
  assert.deepEqual(r.polyline, [[50.93, 5.34], [50.96, 5.5]]);
  const geschat = await berekenRoute({ depot: DEPOT, stops, datum: DAG, vertrekMin: 510, testModus: true, apiVerzoek: zonderLijn });
  assert.equal(geschat.data, null);
});

test('berekenRoute: een fout (status, netwerk of rare legs) valt terug op de schatting', async () => {
  const stops = [stopL('a', 50.96, 5.5), stopL('c', 51.22, 4.4)];
  const gevallen = [
    async () => ({ ok: false, status: 500, data: { error: 'x' } }),
    async () => { throw new TypeError('netwerk'); },
    async () => ({ ok: true, status: 200, data: { legs: [{ travelTimeSeconds: 5, distanceMeters: 5 }] } }),
    async () => ({ ok: true, status: 200, data: null }),
  ];
  for (const apiVerzoek of gevallen) {
    const r = await berekenRoute({ depot: DEPOT, stops, datum: DAG, vertrekMin: 510, testModus: false, apiVerzoek });
    assert.equal(r.geschat, true);
    assert.equal(r.legs.length, 2);
    assert.ok(r.legs.every((l) => l.ritSec > 0));
  }
});

test('berekenRoute: minder dan twee punten geeft geen verzoek en lege ritten', async () => {
  let n = 0;
  const apiVerzoek = async () => { n++; };
  const r = await berekenRoute({ depot: null, stops: [stopL('a', 50.96, 5.5)], datum: DAG, vertrekMin: null, testModus: false, apiVerzoek });
  assert.equal(n, 0);
  assert.deepEqual(r.legs, [{ ritSec: null, afstandM: null }]);
  assert.deepEqual(r.polyline, []);
  assert.equal(r.totaalSec, 0);
  const leeg = await berekenRoute({ depot: DEPOT, stops: [], datum: DAG, vertrekMin: 480, testModus: false, apiVerzoek });
  assert.deepEqual(leeg.legs, []);
});

test('berekenRoute: een stop zonder locatie blijft zonder rit, de rest wordt wel berekend', async () => {
  const stops = [stopL('a', 50.96, 5.5), stopL('b', null, null)];
  const r = await berekenRoute({ depot: DEPOT, stops, datum: DAG, vertrekMin: 480, testModus: true, apiVerzoek: async () => {} });
  assert.equal(r.legs.length, 2);
  assert.ok(r.legs[0].ritSec > 0);
  assert.equal(r.legs[1].ritSec, null);
});

test('afgewerktOpDag: telt afgewerkte leads met een bezoek op die dag; "opnieuw" en andere dagen niet', () => {
  const klaar = (id, datum, resultaat = 'verkocht', status = 'afgewerkt') => ({ id, status, bezoeken: [{ datum, resultaat, op: '2026-10-12T10:00:00.000Z' }] });
  const leads = [klaar('a', DAG), klaar('b', DAG, 'offerte'), klaar('c', '2026-10-13'), klaar('d', DAG, 'opnieuw', 'te-plannen'), { id: 'e', status: 'voorgesteld' }];
  assert.equal(afgewerktOpDag(leads, DAG), 2);
  assert.equal(afgewerktOpDag(leads, '2026-10-13'), 1);
  assert.equal(afgewerktOpDag(undefined, DAG), 0);
});
