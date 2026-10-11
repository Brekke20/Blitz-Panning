import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeek, haversine } from '../public/js/planner.js';

// Herverdeling: een lege dag wordt "geopend" door de lead met de hoogste voorrang. Ligt die ver van de rest, dan blijven twee leads die
// samen wél een dag kunnen vullen liggen terwijl de dag nog plaats heeft. Het brein probeert dan een andere starter.
// Verzonnen leads op gemeente-middelpunten (publieke coördinaten, geen persoonsgegevens); reistijd = haversine x 1,3 aan 80 km/u.
const reistijd = async (van, naar) =>
  new Map(naar.map(n => [n.id, haversine(van.lat, van.lon, n.lat, n.lon) * 1.3 / 80 * 60]));

const KINROOI = { lat: 51.14, lon: 5.74 };
const ROTSELAAR = { lat: 50.95, lon: 4.72 };
const SINT_TRUIDEN = { lat: 50.82, lon: 5.19 };
const HASSELT = { lat: 50.93, lon: 5.34 };
const WILLEBROEK = { lat: 51.06, lon: 4.36 };

const lead = (id, nr, priority, plaats, extra = {}) => ({ id, number: String(nr), priority, interventieDatum: null, duurMin: 60, ...plaats, ...extra });
const DO = '2026-10-15', VR = '2026-10-16';
const maak = (kandidaten, extra = {}) => ({
  kandidaten, dagen: [DO], extraVoor: {}, bestaandPerDag: {}, eigenAfspraken: {}, blokkeringen: {}, klant: {},
  instellingen: { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 4, maxReistijdMin: 45 },
  depot: null, vandaag: '2026-10-12', reistijden: reistijd, ...extra,
});
const ids = u => u.geplaatst.map(g => g.ticketId).sort();

test('sanity: de reistijden van het scenario (Kinrooi ligt > 45 min van beide, de twee anderen liggen binnen 45 min van elkaar)', async () => {
  const min = (a, b) => haversine(a.lat, a.lon, b.lat, b.lon) * 1.3 / 80 * 60;
  assert.ok(min(KINROOI, ROTSELAAR) > 45);
  assert.ok(min(KINROOI, SINT_TRUIDEN) > 45);
  assert.ok(min(ROTSELAAR, SINT_TRUIDEN) < 45);
});

test('herverdeling: de verre starter laat twee leads liggen die samen een dag vullen → beide dag-leads worden geplaatst', async () => {
  const u = await planWeek(maak([
    lead('kinrooi', 1, 'High', KINROOI), lead('rotselaar', 2, 'Medium', ROTSELAAR), lead('truiden', 3, 'Medium', SINT_TRUIDEN),
  ]));
  assert.deepEqual(ids(u), ['rotselaar', 'truiden']);
  // Kinrooi past er niet meer bij en faalde enkel op afstand: 'te-ver' (niet het misleidende 'geen-plaats').
  assert.deepEqual(u.nietGepland, [{ ticketId: 'kinrooi', reden: 'te-ver' }]);
});

test('herverdeling: de verre lead gaat naar een andere dag als daar plaats is (alles geplaatst)', async () => {
  const u = await planWeek(maak([
    lead('kinrooi', 1, 'High', KINROOI), lead('rotselaar', 2, 'Medium', ROTSELAAR), lead('truiden', 3, 'Medium', SINT_TRUIDEN),
  ], { dagen: [DO, VR], instellingen: { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 2, maxReistijdMin: 45 } }));
  assert.equal(u.geplaatst.length, 3);
  assert.deepEqual(u.nietGepland, []);
  const dagVan = id => u.geplaatst.find(g => g.ticketId === id).datum;
  assert.equal(dagVan('rotselaar'), dagVan('truiden')); // de twee die bij elkaar horen staan samen
  assert.notEqual(dagVan('kinrooi'), dagVan('rotselaar'));
});

test('herverdeling: vaste (bevestigde) bezoeken verschuiven nooit', async () => {
  const bestaand = { [VR]: [{ id: 'vast', uur: '09:00', duurMin: 60, ...WILLEBROEK }] };
  const u = await planWeek(maak([
    lead('kinrooi', 1, 'High', KINROOI), lead('rotselaar', 2, 'Medium', ROTSELAAR), lead('truiden', 3, 'Medium', SINT_TRUIDEN),
    lead('hasselt', 4, 'Low', HASSELT),
  ], { dagen: [DO, VR], bestaandPerDag: bestaand }));
  assert.ok(!u.geplaatst.some(g => g.ticketId === 'vast'));        // het vaste bezoek is geen kandidaat en blijft buiten het resultaat
  assert.ok(u.geplaatst.every(g => g.datum === DO || g.datum === VR));
  // Op vrijdag staat het vaste bezoek (Willebroek) om 09:00; niets mag er overheen of voor/na ontsporen.
  for (const g of u.geplaatst.filter(g => g.datum === VR)) assert.notEqual(g.verwachteAankomst, '09:00');
});

test('herverdeling: geen verbetering mogelijk → resultaat blijft zoals het was (geen extra wijziging)', async () => {
  // Twee leads die ver uit elkaar liggen en maar één dag: één past, de andere blijft 'te-ver'.
  const u = await planWeek(maak([lead('kinrooi', 1, 'High', KINROOI), lead('rotselaar', 2, 'Medium', ROTSELAAR)]));
  assert.deepEqual(ids(u), ['kinrooi']);
  assert.deepEqual(u.nietGepland, [{ ticketId: 'rotselaar', reden: 'te-ver' }]);
});

test('herverdeling: de reistijd-functie wordt niet onnodig vaak aangeroepen', async () => {
  let n = 0;
  const geteld = async (van, naar, t) => { n++; return reistijd(van, naar, t); };
  await planWeek(maak([
    lead('kinrooi', 1, 'High', KINROOI), lead('rotselaar', 2, 'Medium', ROTSELAAR), lead('truiden', 3, 'Medium', SINT_TRUIDEN),
  ], { reistijden: geteld }));
  assert.ok(n < 40, `te veel aanroepen: ${n}`);
});

test('herverdeling: een lead met veel hogere voorrang blijft geplaatst; twee lage verdringen hem niet (herverdeling niet overgenomen)', async () => {
  // Kinrooi: High + al 3 weken in planning (voorrang 4,5). De twee anderen: Low (1 + 1 = 2) — samen minder dan Kinrooi.
  const u = await planWeek(maak([
    lead('kinrooi', 1, 'High', KINROOI, { inPlanningSinds: '2026-09-21' }),
    lead('rotselaar', 2, 'Low', ROTSELAAR), lead('truiden', 3, 'Low', SINT_TRUIDEN),
  ]));
  assert.deepEqual(ids(u), ['kinrooi']);
  assert.deepEqual(u.nietGepland.map(n => n.ticketId).sort(), ['rotselaar', 'truiden']);
});

test('reden: faalt een lead op een dag MET plaats enkel op afstand, dan blijft het "te-ver", ook al zat een andere dag eerder vol', async () => {
  // Maandag: twee dringende leads bij Willebroek vullen de dag (max 2). Donderdag: Kinrooi (dringend, lang in planning) opent de dag;
  // Rotselaar en Sint-Truiden liggen te ver van Kinrooi en mogen hem niet verdringen (voorrang). Donderdag had nog plaats.
  const MA = '2026-10-12';
  const u = await planWeek(maak([
    lead('w1', 1, 'High', WILLEBROEK, { inPlanningSinds: '2026-09-01' }), lead('w2', 2, 'High', WILLEBROEK, { inPlanningSinds: '2026-09-01' }),
    lead('kinrooi', 3, 'High', KINROOI, { inPlanningSinds: '2026-09-21' }),
    lead('rotselaar', 4, 'Low', ROTSELAAR), lead('truiden', 5, 'Low', SINT_TRUIDEN),
  ], { dagen: [MA, DO], instellingen: { vanTijd: '08:00', laatsteStart: '16:00', maxPerDag: 2, maxReistijdMin: 45 } }));
  assert.deepEqual(ids(u), ['kinrooi', 'w1', 'w2']);
  assert.deepEqual(u.nietGepland.map(n => n.reden), ['te-ver', 'te-ver']);
});
