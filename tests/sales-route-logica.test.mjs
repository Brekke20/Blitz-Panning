import test from 'node:test';
import assert from 'node:assert/strict';
import { bouwRouteStops, schatLegs, controleerKeten, routeHandtekening } from '../public/js/schermen/sales-route-logica.js';
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
