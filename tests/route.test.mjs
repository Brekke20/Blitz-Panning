// tests/route.test.mjs — legsVoorDag/aankomstenVoorDag/aankomstTijdenVoorDag uit schermen/route.js.
// route.js raakt `document` enkel binnen functies; hier staat een bodemloze document-stub (elk element accepteert
// alles) zodat calculateRoute() en de hertekening kunnen draaien. De routetoestand is module-privé: de enige weg
// om er een route in te krijgen is calculateRoute() zelf, met een nep-fetch voor /api/route (geen netwerk).
process.env.TZ = 'Europe/Brussels';
import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { zetFetch } from '../public/js/kern/api.js';
import { toestand } from '../public/js/kern/toestand.js';

// Timers (toast) mogen de testrun niet vasthouden.
const echteSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = echteSetTimeout(fn, ms, ...a); t.unref?.(); return t; };

const DATUM = '2026-10-05';
const ANDERE = '2026-10-06';

function leeg() {
  const opslag = new Map();
  const kinderen = new Map();
  return new Proxy(function () {}, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return () => '';
      if (opslag.has(k)) return opslag.get(k);
      if (!kinderen.has(k)) kinderen.set(k, leeg());
      return kinderen.get(k);
    },
    set(_, k, v) { opslag.set(k, v); return true; },
    apply() { return leeg(); },
  });
}
const elementen = new Map();
const datumVeld = { value: DATUM };
globalThis.document = {
  activeElement: null,
  getElementById(id) {
    if (id === 'plan-date') return datumVeld;
    if (!elementen.has(id)) elementen.set(id, leeg());
    return elementen.get(id);
  },
  createElement() { return leeg(); },
};
globalThis.window ??= {}; // sorteer.js zet window.maakSorteerbaar bij het laden

const route = await import('../public/js/schermen/route.js');
after(() => zetFetch(null));

const ticket = (id, extra = {}) => ({ ticket: { id, number: id, subject: 'S' + id, status: 'Open', hasAddress: true }, address: 'Straat ' + id, _lat: 51, _lon: 4, ...extra });
route.initRoute({
  duurVoor: () => 60,
  werktijdMin: () => 60,
  kbPreferredTime: () => null,
  geocacheLookup: () => ({ lat: 50, lon: 3 }), // vertrekpunt gekend: geen geocode-aanvraag
  geocacheStore: () => {},
  tijdslotLabelVoor: () => '',
  bevestigdLabel: () => null,
  telNummer: () => '',
  meervoud: (n, e, m) => `${n} ${n === 1 ? e : m}`,
  aankomstVoor: () => undefined,
});
toestand.set('settings', { vanTijd: '08:00', startlocatie: 'Start', drukteKleuring: false, werkdagen: [1, 2, 3, 4, 5] });
toestand.set('planning', { [DATUM]: [ticket('a'), ticket('b')] });

const LEGS = [
  { travelTimeSeconds: 10 * 60, distanceMeters: 5000 },
  { travelTimeSeconds: 20 * 60, distanceMeters: 8000 },
];

test('zonder berekende route: geen legs en 30 min terugval', () => {
  assert.equal(route.legsVoorDag(DATUM), null);
  const { arrivalTimes } = route.aankomstenVoorDag(DATUM);
  assert.deepEqual(arrivalTimes, [8 * 60 + 30, 8 * 60 + 30 + 60 + 30]);
});

test('na calculateRoute: legs enkel voor die dag, aankomsttijden rekenen met de echte reistijden', async () => {
  zetFetch(async (pad) => {
    assert.equal(pad, '/api/route');
    return { ok: true, status: 200, json: async () => ({
      legs: LEGS, polyline: [[51, 4], [51.1, 4.1]], totalDistanceMeters: 13000,
      totalTravelTimeSeconds: 1800, totalTrafficDelaySeconds: 0, arrivalTime: null,
    }) };
  });
  await route.calculateRoute();

  assert.equal(route.legsVoorDag(DATUM), LEGS);
  assert.equal(route.legsVoorDag(ANDERE), null); // routeData hoort bij een andere dag
  assert.equal(route.routeActueelVoor(DATUM), true);
  assert.equal(route.routeActueelVoor(ANDERE), false);
  assert.ok(route.renderTelling() >= 1, 'calculateRoute hertekent de lijst (renderteller, R10)');

  assert.deepEqual(route.aankomstenVoorDag(DATUM).arrivalTimes, [8 * 60 + 10, 8 * 60 + 10 + 60 + 20]);
  assert.deepEqual(route.aankomstTijdenVoorDag(DATUM), { a: 490, b: 570 });
  assert.deepEqual(route.aankomstTijdenVoorDag(ANDERE), {}); // geen stops die dag
});

test('aankomstenVoorDag: de allStops-parameter vervangt de stops van de dag en legs volgen de datum', () => {
  const eigen = [{ kind: 'ticket', item: ticket('z'), uur: undefined }];
  // Datum van de route: de legs tellen mee (eerste leg = 10 min).
  assert.deepEqual(route.aankomstenVoorDag(DATUM, eigen).arrivalTimes, [8 * 60 + 10]);
  // Andere datum: geen legs, dus de 30 min terugval -- zelfde allStops.
  assert.deepEqual(route.aankomstenVoorDag(ANDERE, eigen).arrivalTimes, [8 * 60 + 30]);
  // Een vastgezet uur in de meegegeven stops springt naar dat uur.
  const vast = [{ kind: 'ticket', item: ticket('z', { uur: '09:00' }), uur: '09:00' }];
  assert.deepEqual(route.aankomstenVoorDag(DATUM, vast).arrivalTimes, [9 * 60]);
});
