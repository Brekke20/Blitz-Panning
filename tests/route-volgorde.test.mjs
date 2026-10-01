// tests/route-volgorde.test.mjs — applyRouteOrder (slepen/optimaliseren/"Tijden vastleggen") uit schermen/route.js.
// W11: het persist-blok (stap 4) schrijft ticketuren naar Zoho via /api/plan-datum en is in ?test niet bereikbaar.
// Dit bestand bewijst dat het verhuisde blok exact dezelfde verzoeken bouwt als de oude inline code in index.html
// (hieronder letterlijk bewaard als `oudPersistBlok`). Nooit een echte netwerkaanroep: fetch is overal een nep.
process.env.TZ = 'Europe/Brussels';
import { test, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { zetFetch } from '../public/js/kern/api.js';
import { toestand } from '../public/js/kern/toestand.js';
import { extractLocalHour } from '../public/js/kern/tijd.js';

const echteSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = echteSetTimeout(fn, ms, ...a); t.unref?.(); return t; };

const DATUM = '2026-10-05';

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
const echteGlobaleFetch = globalThis.fetch;
after(() => { zetFetch(null); globalThis.fetch = echteGlobaleFetch; });

let testModus = false;
let loadTicketsAantal = 0;
let voorstelStatusOk = true;
const roundToNextQuarterStr = (timeStr) => {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  const totalMin = (h * 60 + Math.ceil(m / 15) * 15) % (24 * 60);
  return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
};
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
  loadVoorstelStatus: async () => voorstelStatusOk,
  loadTickets: async () => { loadTicketsAantal++; },
  roundToNextQuarterStr,
  renderKalender: () => {},
  testModus: () => testModus,
});

const ticket = (id, interventieDatum = null) => ({
  ticket: { id, number: id, subject: 'S' + id, status: 'Open', hasAddress: true, interventieDatum },
  address: 'Straat ' + id, _lat: 51, _lon: 4,
});
const LEGS = [
  { travelTimeSeconds: 10 * 60, distanceMeters: 5000 },
  { travelTimeSeconds: 20 * 60, distanceMeters: 8000 },
];
function zetScenario() {
  // a staat al op zijn uiteindelijke tijdstip (09:30) en wordt dus niet opnieuw gepost.
  const a = ticket('1001', new Date(`${DATUM}T09:30:00`).toISOString());
  const b = ticket('1002');
  toestand.set('settings', { vanTijd: '08:00', totTijd: '17:00', startlocatie: 'Start', drukteKleuring: false, werkdagen: [1, 2, 3, 4, 5] });
  toestand.set('voorstelStatus', {});
  toestand.set('localEvents', []);
  toestand.set('activeAssigneeFilter', 'all');
  toestand.set('planning', { [DATUM]: [a, b] });
  zetFetch(async (pad) => {
    assert.equal(pad, '/api/route');
    return { ok: true, status: 200, json: async () => ({
      legs: LEGS, polyline: [[51, 4], [51.1, 4.1]], totalDistanceMeters: 13000,
      totalTravelTimeSeconds: 1800, totalTrafficDelaySeconds: 0, arrivalTime: null,
    }) };
  });
  return { a, b };
}
// Gevraagde volgorde: b vóór a.
const gevraagd = () => route.stopsVoorDag(DATUM).allStops.slice().reverse();

// De oude inline stap 4 uit index.html (applyRouteOrder vóór etappe 3), met TEST_MODE als parameter en de
// toen globale `isStopAnchored`/`loadTickets`/`toast` als argumenten. Verder letterlijk.
async function oudPersistBlok({ TEST_MODE, stops, date, isStopAnchored, loadTickets, toast, fetch }) {
  if (!TEST_MODE) {
    for (const item of stops) {
      if (isStopAnchored(item)) continue;
      const huidigUur = extractLocalHour(item.ticket.interventieDatum);
      if (item.uur === huidigUur) continue;
      const utcInterventieDatum = new Date(`${date}T${item.uur}:00`).toISOString();
      try {
        const res  = await fetch('/api/plan-datum', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ticketId: item.ticket.id, utcInterventieDatum }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Onbekende fout');
        item.ticket.interventieDatum = utcInterventieDatum;
      } catch (err) {
        toast('✕ Volgorde bewaren mislukt voor #' + item.ticket.number, 5000);
        await loadTickets();
        return;
      }
    }
  }
}
function opnemendeFetch(antwoord = { ok: true }) {
  const log = [];
  const fn = async (url, opties) => {
    log.push({ url, method: opties?.method, headers: opties?.headers, body: opties?.body });
    return { json: async () => antwoord };
  };
  return { fn, log };
}

test('applyRouteOrder persisteert met exact dezelfde /api/plan-datum-verzoeken als de oude inline code', async () => {
  testModus = false;
  const { a, b } = zetScenario();
  const echt = opnemendeFetch();
  globalThis.fetch = echt.fn;
  await route.applyRouteOrder(DATUM, gevraagd());

  // b: 08:10 aankomst -> 08:15, 60 min -> 09:15, +20 min rit -> 09:30 voor a (de klok rekent met de ongeronde 08:10).
  assert.equal(b.uur, '08:15');
  assert.equal(a.uur, '09:30');
  assert.deepEqual(echt.log, [{
    url: '/api/plan-datum',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId: '1002', utcInterventieDatum: '2026-10-05T06:15:00.000Z' }),
  }]);
  assert.equal(b.ticket.interventieDatum, '2026-10-05T06:15:00.000Z');

  // Referentie: de oude code op dezelfde invoer (uren zoals zojuist toegekend, oorspronkelijke interventieDatum).
  const a2 = ticket('1001', new Date(`${DATUM}T09:30:00`).toISOString()); a2.uur = a.uur;
  const b2 = ticket('1002'); b2.uur = b.uur;
  const oud = opnemendeFetch();
  await oudPersistBlok({
    TEST_MODE: false, stops: [a2, b2], date: DATUM, isStopAnchored: () => false,
    loadTickets: async () => {}, toast: () => {}, fetch: oud.fn,
  });
  assert.deepEqual(echt.log, oud.log);
  assert.equal(loadTicketsAantal, 0);
});

test('applyRouteOrder in testmodus: geen enkel /api/plan-datum-verzoek', async () => {
  testModus = true;
  zetScenario();
  const echt = opnemendeFetch();
  globalThis.fetch = echt.fn;
  await route.applyRouteOrder(DATUM, gevraagd());
  assert.deepEqual(echt.log, []);
  testModus = false;
});

test('applyRouteOrder: mislukt Zoho-antwoord geeft loadTickets en laat de vlag los (finally)', async () => {
  testModus = false;
  const { b } = zetScenario();
  const echt = opnemendeFetch({ ok: false, error: 'nee' });
  globalThis.fetch = echt.fn;
  loadTicketsAantal = 0;
  await route.applyRouteOrder(DATUM, gevraagd());
  assert.equal(echt.log.length, 1);
  assert.equal(loadTicketsAantal, 1);
  assert.equal(b.ticket.interventieDatum, null); // niet als bewaard gemarkeerd
  assert.equal(route.routeOrderBezig(), false);
});

test('routeOrderBezig is true tijdens applyRouteOrder en false erna, ook bij een vroege return', async () => {
  testModus = true;
  zetScenario();
  voorstelStatusOk = false; // vroege return na het zetten van de vlag
  const p = route.applyRouteOrder(DATUM, gevraagd());
  const tijdens = route.routeOrderBezig();
  await p;
  voorstelStatusOk = true;
  assert.equal(tijdens, true);
  assert.equal(route.routeOrderBezig(), false);
  testModus = false;
});

// ── Fix-ronde 1: vergrendelde stops en afbreken na een mislukte POST ─────────────────────────────────────────
// Toasts opvangen: toast() schrijft in het element #toast.
const toasts = [];
elementen.set('toast', { classList: { add() {}, remove() {} }, set textContent(v) { toasts.push(String(v)); } });
const isAnker = (item) => {
  const vs = toestand.get('voorstelStatus')[item.ticket.id];
  return !!(vs?.contact || vs?.klant || vs?.installateur || vs?.bevestigd);
};
function zetScenarioMet(items, voorstelStatus = {}) {
  toestand.set('settings', { vanTijd: '08:00', totTijd: '17:00', startlocatie: 'Start', drukteKleuring: false, werkdagen: [1, 2, 3, 4, 5] });
  toestand.set('voorstelStatus', voorstelStatus);
  toestand.set('localEvents', []);
  toestand.set('activeAssigneeFilter', 'all');
  toestand.set('planning', { [DATUM]: items });
  zetFetch(async () => ({ ok: true, status: 200, json: async () => ({
    legs: items.map(() => ({ travelTimeSeconds: 10 * 60, distanceMeters: 5000 })),
    polyline: [[51, 4], [51.1, 4.1]], totalDistanceMeters: 13000,
    totalTravelTimeSeconds: 1800, totalTrafficDelaySeconds: 0, arrivalTime: null,
  }) }));
  toasts.length = 0;
  loadTicketsAantal = 0;
}
const alsEntries = (items) => items.map(item => ({ kind: 'ticket', item, uur: item.uur }));
const klaarVoorOud = (items) => items.map(i => {
  const k = ticket(i.ticket.id, i.ticket.interventieDatum); k.uur = i.uur; return k;
});

test('applyRouteOrder: een vergrendelde stop wordt nooit gepost, ook al verschilt zijn uur van interventieDatum (oud = nieuw)', async () => {
  testModus = false;
  const b = ticket('1002');
  const c = ticket('1003', new Date(`${DATUM}T10:00:00`).toISOString()); c.uur = '11:00'; // vergrendeld, uur != interventieDatum
  const d = ticket('1004');
  const oorspronkelijk = klaarVoorOud([b, c, d]);
  zetScenarioMet([b, c, d], { '1003': { contact: true } });
  const echt = opnemendeFetch();
  globalThis.fetch = echt.fn;
  await route.applyRouteOrder(DATUM, alsEntries([b, c, d]));

  assert.equal(c.uur, '11:00'); // anker blijft staan
  assert.deepEqual(echt.log.map(r => JSON.parse(r.body).ticketId), ['1002', '1004']);
  assert.ok(!echt.log.some(r => r.body.includes('1003')), 'vergrendelde stop mag niet gepost worden');

  oorspronkelijk[0].uur = b.uur; oorspronkelijk[1].uur = c.uur; oorspronkelijk[2].uur = d.uur;
  const oud = opnemendeFetch();
  await oudPersistBlok({
    TEST_MODE: false, stops: oorspronkelijk, date: DATUM,
    isStopAnchored: isAnker, loadTickets: async () => {}, toast: () => {}, fetch: oud.fn,
  });
  assert.deepEqual(echt.log, oud.log);
});

for (const [naam, faal] of [['antwoord ok:false', 'antwoord'], ['fetch gooit', 'gooit']]) {
  test(`applyRouteOrder: bij een mislukte eerste POST (${naam}) stopt het persisteren (oud = nieuw)`, async () => {
    testModus = false;
    const b = ticket('1002'), d = ticket('1004');
    zetScenarioMet([b, d]);
    const maakFout = () => {
      const log = [];
      const fn = async (url, opties) => {
        log.push({ url, method: opties?.method, headers: opties?.headers, body: opties?.body });
        if (faal === 'gooit') throw new Error('netwerk');
        return { json: async () => ({ ok: false, error: 'nee' }) };
      };
      return { fn, log };
    };
    const echt = maakFout();
    globalThis.fetch = echt.fn;
    await route.applyRouteOrder(DATUM, alsEntries([b, d]));

    assert.equal(echt.log.length, 1, 'de tweede stop mag niet meer gepost worden');
    assert.ok(toasts.includes('✕ Volgorde bewaren mislukt voor #1002'), `toasts: ${toasts.join(' | ')}`);
    assert.ok(!toasts.some(t => t.includes('Volgorde en tijdstippen bijgewerkt')));
    assert.equal(loadTicketsAantal, 1);
    assert.equal(b.ticket.interventieDatum, null);
    assert.equal(d.ticket.interventieDatum, null);

    const oudStops = klaarVoorOud([b, d]);
    const oudToasts = []; let oudLoad = 0;
    const oud = maakFout();
    await oudPersistBlok({
      TEST_MODE: false, stops: oudStops, date: DATUM, isStopAnchored: isAnker,
      loadTickets: async () => { oudLoad++; }, toast: (t) => oudToasts.push(t), fetch: oud.fn,
    });
    assert.deepEqual(echt.log, oud.log);
    assert.deepEqual(oudToasts, ['✕ Volgorde bewaren mislukt voor #1002']);
    assert.equal(oudLoad, 1);
    assert.equal(oudStops[1].ticket.interventieDatum, null);
  });
}
