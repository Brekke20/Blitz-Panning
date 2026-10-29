// Momentopname van de Zoho-tickets (netlify/lib/tickets-snapshot.js): versheid, stale-markering, werkuren (met zomer- en
// wintertijd), stampedebeveiliging en terugvallen. Volledig met een nep-store en een nep-"live ophalen": geen Zoho, geen Blobs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maakNepStore } from './nep-blobs.mjs';
import {
  SNAPSHOT_SLEUTEL, VEROUDERD_SLEUTEL, BEZIG_SLEUTEL, VERS_MS, BEZIG_TTL_MS, MAX_TERUGVAL_MS, FORCEER_MIN_MS,
  isAuthFout, inWerkuren, isVers, moetVoorladen, markeerVerouderd, leverTickets, voorlaad,
} from '../netlify/lib/tickets-snapshot.js';

const NU = Date.parse('2026-10-28T10:00:00.000Z'); // woensdag 11:00 Brusselse tijd (CET)
const MIN = 60 * 1000;
const T = (id, status = 'Geplande service') => ({ id, status });
const LIJSTEN = { tickets: [T('1', 'Service in te plannen')], pendingTickets: [], plannedTickets: [T('3')] };
const NIEUW = { tickets: [T('9', 'Service in te plannen')], pendingTickets: [T('8', 'Wachten op bevestiging planning')], plannedTickets: [] };

// dekt = het id van de marker die de lading al meenam (null: er was geen marker)
const snap = (op, lijsten = LIJSTEN, dekt = null) => ({ v: 1, op, dekt, klaar: op + 4000, ...lijsten });
const M = (id, op = NU) => ({ id, op }); // een stale-marker
const markerNu = o => JSON.parse(o.store._data.get(VEROUDERD_SLEUTEL));

// Klok die enkel verspringt als de test (of een nep-wacht) dat zegt.
function klok(begin = NU) {
  const k = { t: begin, nu: () => k.t };
  return k;
}

function opstelling({ snapshot, marker, bezig, begin = NU } = {}) {
  const store = maakNepStore();
  if (snapshot) store._data.set(SNAPSHOT_SLEUTEL, JSON.stringify(snapshot));
  if (marker) store._data.set(VEROUDERD_SLEUTEL, JSON.stringify(marker));
  if (bezig) store._data.set(BEZIG_SLEUTEL, JSON.stringify(bezig));
  const k = klok(begin);
  const logs = [];
  let live = 0;
  const haalLive = async () => { live++; return structuredClone(NIEUW); };
  const gelezen = () => JSON.parse(store._data.get(SNAPSHOT_SLEUTEL) ?? 'null');
  return { store, k, logs, haalStore: async () => store, haalLive, aantalLive: () => live, gelezen,
    log: (...a) => logs.push(a.join(' ')) };
}
const levering = (o, extra = {}) => leverTickets({
  haalStore: o.haalStore, haalLive: extra.haalLive ?? o.haalLive, nu: o.k.nu, log: o.log,
  wacht: extra.wacht ?? (async ms => { o.k.t += ms; }), ...extra,
});

// ---------------- werkuren (Europe/Brussels, zomer- en wintertijd) ----------------
test('inWerkuren: ma-vr 07:00 tot 19:00 Brusselse tijd, wintertijd', () => {
  // dinsdag 3 november 2026 = CET (UTC+1)
  assert.equal(inWerkuren(Date.parse('2026-11-03T05:59:59Z')), false); // 06:59:59
  assert.equal(inWerkuren(Date.parse('2026-11-03T06:00:00Z')), true);  // 07:00
  assert.equal(inWerkuren(Date.parse('2026-11-03T17:59:59Z')), true);  // 18:59:59
  assert.equal(inWerkuren(Date.parse('2026-11-03T18:00:00Z')), false); // 19:00
});

test('inWerkuren: zomertijd (CEST, UTC+2) schuift de UTC-grenzen een uur op', () => {
  // dinsdag 23 juni 2026
  assert.equal(inWerkuren(Date.parse('2026-06-23T04:59:59Z')), false); // 06:59:59
  assert.equal(inWerkuren(Date.parse('2026-06-23T05:00:00Z')), true);  // 07:00
  assert.equal(inWerkuren(Date.parse('2026-06-23T16:59:59Z')), true);  // 18:59:59
  assert.equal(inWerkuren(Date.parse('2026-06-23T17:00:00Z')), false); // 19:00
});

test('inWerkuren: de maandag na de overgang naar zomertijd (zondag 29 maart 2026) en naar wintertijd (zondag 25 oktober 2026)', () => {
  assert.equal(inWerkuren(Date.parse('2026-03-30T04:59:59Z')), false); // maandag 06:59:59 CEST
  assert.equal(inWerkuren(Date.parse('2026-03-30T05:00:00Z')), true);  // 07:00 CEST (niet 06:00 UTC)
  assert.equal(inWerkuren(Date.parse('2026-10-26T05:59:59Z')), false); // maandag 06:59:59 CET
  assert.equal(inWerkuren(Date.parse('2026-10-26T06:00:00Z')), true);  // 07:00 CET
  assert.equal(inWerkuren(Date.parse('2026-10-26T17:59:59Z')), true);
  assert.equal(inWerkuren(Date.parse('2026-10-26T18:00:00Z')), false);
});

test('inWerkuren: vrijdag nog wel, zaterdag en zondag nooit; ook niet op de overgangsdag zelf', () => {
  assert.equal(inWerkuren(Date.parse('2026-10-23T10:00:00Z')), true);  // vrijdag
  assert.equal(inWerkuren(Date.parse('2026-10-24T10:00:00Z')), false); // zaterdag
  assert.equal(inWerkuren(Date.parse('2026-10-25T10:00:00Z')), false); // zondag (overgangsdag)
  assert.equal(inWerkuren(Date.parse('2026-03-29T10:00:00Z')), false); // zondag (overgangsdag)
  // middernachtgrens: vrijdag 23:30 UTC is in Brussel al zaterdag
  assert.equal(inWerkuren(Date.parse('2026-11-06T23:30:00Z')), false); // vrijdag 23:30 UTC = zaterdag 00:30 CET
});

test('inWerkuren: ongeldige invoer is nooit werkuren', () => {
  for (const x of [NaN, undefined, null, 'x']) assert.equal(inWerkuren(x), false);
});

// ---------------- versheid ----------------
test('isVers: jonger dan 5 minuten en niet gemarkeerd', () => {
  assert.equal(isVers({ snapshot: snap(NU - 60000), marker: null, nu: NU }), true);
  assert.equal(isVers({ snapshot: snap(NU - VERS_MS + 1), marker: null, nu: NU }), true);
  assert.equal(isVers({ snapshot: snap(NU - VERS_MS), marker: null, nu: NU }), false);
});

test('isVers: onvers zodra de marker een andere is dan die de lading al dekte; dezelfde marker blijft vers', () => {
  const s0 = snap(NU - 60000); // dekt: geen marker gelezen
  assert.equal(isVers({ snapshot: s0, marker: null, nu: NU }), true);
  assert.equal(isVers({ snapshot: s0, marker: M('m1'), nu: NU }), false); // er is nu een marker die de lading niet kende
  const gedekt = snap(NU - 60000, LIJSTEN, 'm1');
  assert.equal(isVers({ snapshot: gedekt, marker: M('m1'), nu: NU }), true); // dezelfde marker: gedekt
  assert.equal(isVers({ snapshot: gedekt, marker: M('m2'), nu: NU }), false); // een latere schrijfactie: niet gedekt
});

test('isVers: een marker die TERUGvalt (trage schrijfactie landt als laatste: lagere op) of dezelfde op heeft maskeert niets', () => {
  const gedekt = snap(NU - 60000, LIJSTEN, 'h'); // de lading las marker h (op 2000)
  assert.equal(isVers({ snapshot: gedekt, marker: { id: 'r', op: 1500 }, nu: NU }), false); // r overschreef h met een lagere op
  assert.equal(isVers({ snapshot: gedekt, marker: { id: 'x', op: 2000 }, nu: NU }), false); // zelfde op, ander id
  assert.equal(isVers({ snapshot: gedekt, marker: { id: 'h', op: 2000 }, nu: NU }), true);
});

test('isVers: een oude marker zonder id (alleen op) telt via zijn op en dekt niets als de lading hem niet kende', () => {
  assert.equal(isVers({ snapshot: snap(NU - 1000), marker: { op: 5 }, nu: NU }), false);
  assert.equal(isVers({ snapshot: snap(NU - 1000, LIJSTEN, 'op:5'), marker: { op: 5 }, nu: NU }), true);
});

test('isVers: een kapotte of ontbrekende momentopname is nooit vers', () => {
  for (const s of [null, undefined, {}, { op: NU }, { op: NU, tickets: [] }, { ...snap(NU), tickets: 'x' }, { ...snap(NU), op: 'nu' }]) {
    assert.equal(isVers({ snapshot: s, marker: null, nu: NU }), false, JSON.stringify(s));
  }
});

test('isVers: een momentopname uit de toekomst (klokverschil) telt als vers tot 5 minuten na nu, nooit langer', () => {
  assert.equal(isVers({ snapshot: snap(NU + 1000), marker: null, nu: NU }), true);
  assert.equal(isVers({ snapshot: snap(NU + 10 * MIN), marker: null, nu: NU }), false);
});

// ---------------- moetVoorladen (de beslissing van de geplande functie) ----------------
test('moetVoorladen: zonder momentopname altijd', () => {
  assert.equal(moetVoorladen({ nu: NU, snapshot: null, marker: null }).ja, true);
  assert.equal(moetVoorladen({ nu: Date.parse('2026-10-31T10:00:00Z'), snapshot: null, marker: null }).ja, true); // zaterdag
});

test('moetVoorladen: in werkuren vanaf 90 s oud, ook als de planner net draaide', () => {
  assert.equal(moetVoorladen({ nu: NU, snapshot: snap(NU - 89 * 1000), marker: null }).ja, false);
  assert.equal(moetVoorladen({ nu: NU, snapshot: snap(NU - 90 * 1000), marker: null }).ja, true);
  assert.equal(moetVoorladen({ nu: NU, snapshot: snap(NU - 130 * 1000), marker: null }).ja, true);
});

test('moetVoorladen: buiten werkuren pas na 14 minuten (de planner tikt elke 2 minuten: dat geeft ongeveer elke 15 minuten)', () => {
  const nacht = Date.parse('2026-10-28T21:00:00Z'); // woensdag 22:00 Brussel
  assert.equal(moetVoorladen({ nu: nacht, snapshot: snap(nacht - 13 * MIN), marker: null }).ja, false);
  assert.equal(moetVoorladen({ nu: nacht, snapshot: snap(nacht - 14 * MIN), marker: null }).ja, true);
  const zaterdag = Date.parse('2026-10-31T12:00:00Z');
  assert.equal(moetVoorladen({ nu: zaterdag, snapshot: snap(zaterdag - 10 * MIN), marker: null }).ja, false);
  assert.equal(moetVoorladen({ nu: zaterdag, snapshot: snap(zaterdag - 15 * MIN), marker: null }).ja, true);
});

test('moetVoorladen: een stale-marker die de momentopname niet dekt dwingt een verversing af, ook buiten werkuren', () => {
  const nacht = Date.parse('2026-10-28T21:00:00Z');
  assert.equal(moetVoorladen({ nu: nacht, snapshot: snap(nacht - 2 * MIN), marker: M('m1', nacht - MIN) }).ja, true);
  assert.equal(moetVoorladen({ nu: nacht, snapshot: snap(nacht - 2 * MIN, LIJSTEN, 'm1'), marker: M('m1', nacht - MIN) }).ja, false);
});

// ---------------- markeerVerouderd ----------------
test('markeerVerouderd: elke markering geeft een NIEUW id (ook in dezelfde ms of met een achterlopende klok) en een op die nooit terugvalt', async () => {
  const store = maakNepStore();
  const ids = new Set();
  const lees = () => JSON.parse(store._data.get(VEROUDERD_SLEUTEL));
  await markeerVerouderd({ store, nu: () => 5000 });
  assert.equal(lees().op, 5000); ids.add(lees().id);
  await markeerVerouderd({ store, nu: () => 5000 }); // zelfde ms
  assert.ok(lees().op > 5000); ids.add(lees().id);
  const na = lees().op;
  await markeerVerouderd({ store, nu: () => 3000 }); // klok loopt achter
  assert.ok(lees().op > na); ids.add(lees().id);
  await markeerVerouderd({ store, nu: () => 90000 });
  assert.equal(lees().op, 90000); ids.add(lees().id);
  assert.equal(ids.size, 4);
  for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/);
});

test('markeerVerouderd: een store die gooit geeft false en gooit zelf nooit (een Blobs-storing mag een planning niet laten mislukken)', async () => {
  const kapot = { get: async () => { throw new Error('x'); }, setJSON: async () => { throw new Error('x'); } };
  assert.equal(await markeerVerouderd({ store: kapot, nu: () => 1 }), false);
  assert.equal(await markeerVerouderd({ haalStore: async () => { throw new Error('geen blobs'); }, nu: () => 1 }), false);
});

// ---------------- leverTickets: de normale paden ----------------
test('leverTickets: een verse momentopname wordt geserveerd zonder Zoho, met leeftijd', async () => {
  const o = opstelling({ snapshot: snap(NU - 60000) });
  const r = await levering(o);
  assert.deepEqual(r.body, LIJSTEN);
  assert.equal(r.bron, 'snapshot');
  assert.equal(r.leeftijdMs, 60000);
  assert.equal(r.verouderd, false);
  assert.equal(o.aantalLive(), 0);
  assert.deepEqual(o.store._schrijfacties, []); // enkel lezen
});

test('leverTickets: het antwoord bevat enkel de drie lijsten (geen bewaarvelden van de momentopname)', async () => {
  const o = opstelling({ snapshot: snap(NU - 1000) });
  const r = await levering(o);
  assert.deepEqual(Object.keys(r.body).sort(), ['pendingTickets', 'plannedTickets', 'tickets']);
});

test('leverTickets: te oude momentopname -> live ophalen, snapshot herschreven (start als tijdstip), lock vrijgegeven', async () => {
  const o = opstelling({ snapshot: snap(NU - 6 * MIN) });
  const r = await levering(o);
  assert.deepEqual(r.body, NIEUW);
  assert.equal(r.bron, 'live');
  assert.equal(r.leeftijdMs, 0);
  assert.equal(o.aantalLive(), 1);
  const opgeslagen = o.gelezen();
  assert.equal(opgeslagen.op, NU);
  assert.deepEqual({ tickets: opgeslagen.tickets, pendingTickets: opgeslagen.pendingTickets, plannedTickets: opgeslagen.plannedTickets }, NIEUW);
  assert.equal(o.store._data.has(BEZIG_SLEUTEL), false);
});

test('leverTickets: geen momentopname -> live ophalen en bewaren', async () => {
  const o = opstelling();
  const r = await levering(o);
  assert.equal(r.bron, 'live');
  assert.deepEqual(o.gelezen().tickets, NIEUW.tickets);
});

test('leverTickets: na een schrijfactie (marker) haalt de eerstvolgende aanvraag live op en daarna is de momentopname meteen weer vers (één lading per planning)', async () => {
  const o = opstelling({ snapshot: snap(NU - 60000) });
  await markeerVerouderd({ store: o.store, nu: o.k.nu }); // marker op NU
  o.k.t = NU + 100; // de client vraagt meteen na de planning opnieuw
  const eerste = await levering(o);
  assert.equal(eerste.bron, 'live');
  assert.equal(o.gelezen().dekt, markerNu(o).id);
  o.k.t += 100;
  const tweede = await levering(o); // een collega, kort daarna
  assert.equal(tweede.bron, 'snapshot');
  assert.deepEqual(tweede.body, NIEUW);
  assert.equal(o.aantalLive(), 1);
});

test('leverTickets: een schrijfactie TIJDENS een lading wordt nooit weggemaskeerd: de lading dekt de nieuwe marker niet, de volgende aanvraag laadt opnieuw', async () => {
  const o = opstelling({ snapshot: snap(NU - 6 * MIN) });
  const eerste = await levering(o, { haalLive: async () => {
    o.k.t += 3000;
    await markeerVerouderd({ store: o.store, nu: o.k.nu }); // iemand plant terwijl wij laden
    return structuredClone(NIEUW);
  } });
  assert.equal(eerste.bron, 'live');
  assert.equal(o.gelezen().dekt, null); // gelezen voor de lading: er was toen nog geen marker
  o.k.t += 100;
  assert.equal((await levering(o)).bron, 'live'); // de momentopname bevat de planning mogelijk niet: opnieuw laden
  o.k.t += 100;
  assert.equal((await levering(o)).bron, 'snapshot'); // en die lading las de marker al
  assert.equal(o.aantalLive(), 1);
});

test('leverTickets: een momentopname geschreven NA de marker blijft vers (de planner ververste al)', async () => {
  const o = opstelling({ snapshot: snap(NU - 10000, LIJSTEN, 'm1'), marker: M('m1', NU - 60000) });
  const r = await levering(o);
  assert.equal(r.bron, 'snapshot');
});

// ---------------- leverTickets: Blobs of Zoho stuk ----------------
test('leverTickets: Blobs onbereikbaar (getStore gooit) -> gewoon live, nooit een fout', async () => {
  const o = opstelling();
  const r = await levering(o, { haalStore: async () => { throw new Error('MissingBlobsEnvironmentError'); } });
  assert.equal(r.bron, 'live');
  assert.deepEqual(r.body, NIEUW);
});

test('leverTickets: lezen uit Blobs gooit -> live; schrijven gooit -> antwoord blijft gewoon het live resultaat', async () => {
  const o = opstelling({ snapshot: snap(NU - 1000) });
  const kapotLezen = { ...o.store, get: async () => { throw new Error('lees kapot'); } };
  const r1 = await levering(o, { haalStore: async () => kapotLezen });
  assert.equal(r1.bron, 'live');
  const o2 = opstelling({ snapshot: snap(NU - 6 * MIN) });
  const kapotSchrijven = { ...o2.store, setJSON: async () => { throw new Error('schrijf kapot'); }, set: async () => { throw new Error('x'); } };
  const r2 = await levering(o2, { haalStore: async () => kapotSchrijven });
  assert.equal(r2.bron, 'live');
  assert.deepEqual(r2.body, NIEUW);
});

test('leverTickets: een corrupte momentopname (geen JSON of verkeerde vorm) wordt genegeerd', async () => {
  const o = opstelling();
  o.store._data.set(SNAPSHOT_SLEUTEL, '{kapot');
  assert.equal((await levering(o)).bron, 'live');
  const o2 = opstelling({ snapshot: { v: 1, op: NU, tickets: 'x' } });
  assert.equal((await levering(o2)).bron, 'live');
});

test('leverTickets: Zoho faalt maar er is een oude momentopname -> die wordt geserveerd, als verouderd gemarkeerd en gelogd', async () => {
  const o = opstelling({ snapshot: snap(NU - 20 * MIN) });
  const r = await levering(o, { haalLive: async () => { throw new Error('Zoho tickets-ophalen mislukt (500): {}'); } });
  assert.equal(r.bron, 'snapshot');
  assert.equal(r.verouderd, true); // enkel hier: Zoho faalde
  assert.equal(r.leeftijdMs, 20 * MIN);
  assert.deepEqual(r.body, LIJSTEN);
  assert.ok(o.logs.some(l => l.includes('Zoho tickets-ophalen mislukt')), o.logs.join('|'));
  assert.equal(o.store._data.has(BEZIG_SLEUTEL), false); // lock toch vrijgegeven
  assert.equal(o.gelezen().op, NU - 20 * MIN); // oude snapshot blijft staan
});

test('leverTickets: Zoho faalt en er is geen momentopname -> de fout gaat naar de aanroeper (zoals voorheen een 500)', async () => {
  const o = opstelling();
  await assert.rejects(levering(o, { haalLive: async () => { throw new Error('netwerk'); } }), /netwerk/);
  assert.equal(o.store._data.has(BEZIG_SLEUTEL), false);
});

// ---------------- leverTickets: stampede ----------------
test('leverTickets: een lopende verversing (lock) en een enkel door ouderdom onvers geworden snapshot -> oude snapshot meteen zonder Zoho; NIET als "Zoho onbereikbaar" gemarkeerd', async () => {
  const o = opstelling({ snapshot: snap(NU - 6 * MIN), bezig: { id: 'ander', op: NU - 2000 } });
  const r = await levering(o);
  assert.equal(r.bron, 'snapshot');
  assert.equal(r.verouderd, false); // verouderd betekent enkel: Zoho faalde (de client toont daarvoor een balk)
  assert.equal(o.aantalLive(), 0);
});

test('leverTickets: lopende verversing en een snapshot die onvers is door een schrijfactie -> wacht op de nieuwe en serveert die (geen tweede Zoho-lading)', async () => {
  const o = opstelling({ snapshot: snap(NU - 60000), marker: M('m1', NU - 5000), bezig: { id: 'ander', op: NU - 3000, dekt: 'm1' } });
  let gewacht = 0;
  const wacht = async ms => {
    o.k.t += ms; gewacht++;
    if (gewacht === 2) { // de andere lading is klaar
      o.store._data.set(SNAPSHOT_SLEUTEL, JSON.stringify(snap(NU - 700, NIEUW, 'm1'))); // de andere lading las de marker al
      o.store._data.delete(BEZIG_SLEUTEL);
    }
  };
  const r = await levering(o, { wacht });
  assert.equal(r.bron, 'snapshot');
  assert.deepEqual(r.body, NIEUW);
  assert.equal(r.verouderd, false);
  assert.equal(o.aantalLive(), 0);
});

test('leverTickets: de wacht heeft een plafond; daarna haalt deze aanvraag zelf live op', async () => {
  const o = opstelling({ snapshot: snap(NU - 60000), marker: M('m1', NU - 1000), bezig: { id: 'ander', op: NU, dekt: 'm1' } });
  let wachten = 0;
  const wacht = async ms => { o.k.t += ms; wachten++; o.store._data.set(BEZIG_SLEUTEL, JSON.stringify({ id: 'ander', op: o.k.t, dekt: 'm1' })); };
  const r = await levering(o, { wacht });
  assert.equal(r.bron, 'live');
  assert.ok(wachten >= 1 && wachten <= 30, `wachten=${wachten}`);
  assert.ok(o.k.t - NU <= 7000, `gewacht ${o.k.t - NU} ms`);
  assert.equal(o.aantalLive(), 1);
});

test('leverTickets: de andere verversing is klaar maar de nieuwe momentopname is nog niet vers genoeg -> zelf live (en niet eindeloos wachten)', async () => {
  const o = opstelling({ snapshot: snap(NU - 60000), marker: M('m1', NU - 1000), bezig: { id: 'ander', op: NU, dekt: 'm1' } });
  const wacht = async ms => { o.k.t += ms; o.store._data.delete(BEZIG_SLEUTEL); };
  const r = await levering(o, { wacht });
  assert.equal(r.bron, 'live');
  assert.equal(o.aantalLive(), 1);
});

test('leverTickets: een verlopen lock (ouder dan de TTL) wordt genegeerd', async () => {
  const o = opstelling({ snapshot: snap(NU - 6 * MIN), bezig: { id: 'ander', op: NU - BEZIG_TTL_MS - 1 } });
  const r = await levering(o);
  assert.equal(r.bron, 'live');
  assert.equal(o.aantalLive(), 1);
});

test('leverTickets: tijdens de lading wordt de lock gezet en erna vrijgegeven; een andere aanvraag ziet dan de lock', async () => {
  const o = opstelling({ snapshot: snap(NU - 6 * MIN) });
  let tijdensLading = null;
  await levering(o, { haalLive: async () => { tijdensLading = o.store._data.get(BEZIG_SLEUTEL); return structuredClone(NIEUW); } });
  assert.ok(tijdensLading, 'lock was niet gezet');
  assert.equal(typeof JSON.parse(tijdensLading).id, 'string');
  assert.equal(o.store._data.has(BEZIG_SLEUTEL), false);
});

test('leverTickets: een lading die later klaar is dan een nieuwere momentopname overschrijft die niet', async () => {
  const o = opstelling({ snapshot: snap(NU - 6 * MIN) });
  const nieuwere = snap(NU + 3000, { tickets: [T('77')], pendingTickets: [], plannedTickets: [] });
  const r = await levering(o, { haalLive: async () => { o.store._data.set(SNAPSHOT_SLEUTEL, JSON.stringify(nieuwere)); return structuredClone(NIEUW); } });
  assert.equal(r.bron, 'live'); // de aanvrager krijgt zijn eigen verse lading
  assert.deepEqual(o.gelezen(), nieuwere); // maar de bewaarde, nieuwere momentopname blijft staan
});

// ---------------- voorlaad (de geplande functie) ----------------
const voorladen = (o, extra = {}) => voorlaad({ haalStore: o.haalStore, haalLive: o.haalLive, nu: o.k.nu, log: o.log, ...extra });

test('voorlaad: ververst een oude momentopname in werkuren en geeft aantallen terug, nooit ticketgegevens', async () => {
  const o = opstelling({ snapshot: snap(NU - 130 * 1000) });
  const r = await voorladen(o);
  assert.deepEqual(r, { resultaat: 'ververst', tickets: 1, wachtend: 1, gepland: 0 });
  assert.equal(o.gelezen().op, NU);
  assert.equal(o.store._data.has(BEZIG_SLEUTEL), false);
  assert.ok(!JSON.stringify(r).includes('"9"'));
});

test('voorlaad: een verse momentopname (of een die een gebruiker net ververste) geeft geen Zoho-aanroep', async () => {
  const o = opstelling({ snapshot: snap(NU - 30 * 1000) });
  const r = await voorladen(o);
  assert.deepEqual(r, { resultaat: 'overgeslagen', reden: 'vers' });
  assert.equal(o.aantalLive(), 0);
});

test('voorlaad: buiten werkuren overgeslagen tot 14 minuten', async () => {
  const nacht = Date.parse('2026-10-28T21:00:00Z');
  const o = opstelling({ snapshot: snap(nacht - 10 * MIN), begin: nacht });
  assert.deepEqual(await voorladen(o), { resultaat: 'overgeslagen', reden: 'vers' });
  o.k.t = nacht + 5 * MIN;
  assert.equal((await voorladen(o)).resultaat, 'ververst');
});

test('voorlaad: een lopende verversing (lock) wordt niet dubbel gedaan', async () => {
  const o = opstelling({ snapshot: snap(NU - 10 * MIN), bezig: { id: 'gebruiker', op: NU - 1000 } });
  assert.deepEqual(await voorladen(o), { resultaat: 'overgeslagen', reden: 'bezig' });
  assert.equal(o.aantalLive(), 0);
});

test('voorlaad: Zoho faalt -> resultaat mislukt (zonder foutdetails), de oude momentopname blijft, de lock is vrij', async () => {
  const o = opstelling({ snapshot: snap(NU - 10 * MIN) });
  const r = await voorladen(o, { haalLive: async () => { throw new Error('Zoho ticketdetail 5 mislukt (500): {"x":"geheim"}'); } });
  assert.deepEqual(r, { resultaat: 'mislukt' });
  assert.equal(o.gelezen().op, NU - 10 * MIN);
  assert.equal(o.store._data.has(BEZIG_SLEUTEL), false);
  assert.ok(o.logs.length >= 1);
});

test('voorlaad: Blobs onbereikbaar -> mislukt zonder te gooien', async () => {
  const o = opstelling();
  const r = await voorladen(o, { haalStore: async () => { throw new Error('geen blobs'); } });
  assert.deepEqual(r, { resultaat: 'mislukt' });
  assert.equal(o.aantalLive(), 0); // zonder opslag heeft voorladen geen zin: geen Zoho-krediet verspillen
});

// ---------------- C1: leeftijdsgrens en authenticatiefouten ----------------
test('terugval: precies onder de grens (60 min) wordt de oude momentopname geserveerd, op of boven de grens gaat de Zoho-fout door (de client toont zijn gewone fout)', async () => {
  const fout = async () => { throw new Error('Zoho tickets-ophalen mislukt (500): {}'); };
  const o1 = opstelling({ snapshot: snap(NU - MAX_TERUGVAL_MS + 1000) });
  assert.equal((await levering(o1, { haalLive: fout })).verouderd, true);
  const o2 = opstelling({ snapshot: snap(NU - MAX_TERUGVAL_MS) });
  await assert.rejects(levering(o2, { haalLive: fout }), /Zoho tickets-ophalen mislukt \(500\)/);
  const o3 = opstelling({ snapshot: snap(NU - 3 * 24 * 60 * MIN) });
  await assert.rejects(levering(o3, { haalLive: fout }), /mislukt/);
});

test('terugval: een authenticatiefout van Zoho wordt NOOIT gemaskeerd, ook niet met een verse of jonge momentopname (de melding "Sessie met Zoho verlopen" moet blijven werken)', async () => {
  const fouten = [
    'Token refresh mislukt: {"error":"invalid_code"}',
    'Token refresh mislukt',
    'Zoho tickets-ophalen mislukt (401): {"errorCode":"INVALID_OAUTH"}',
    'Zoho tickets-ophalen mislukt (403): {}',
    'Zoho ticketdetail 7 mislukt (401): {}',
    'Zoho Desk org ID niet gevonden',
    'invalid_token',
  ];
  for (const tekst of fouten) {
    // jonge momentopname, onvers door een schrijfactie, zodat er live geladen wordt
    const o = opstelling({ snapshot: snap(NU - 60000), marker: M('m1', NU - 5000) });
    await assert.rejects(levering(o, { haalLive: async () => { throw new Error(tekst); } }), e => e.message === tekst, tekst);
    assert.equal(o.store._data.has(BEZIG_SLEUTEL), false);
  }
});

test('isAuthFout: herkent token-, 401- en 403-fouten, geen gewone serverfouten en geen toevallige cijfers in een ticket-id', () => {
  for (const t of ['Token refresh mislukt: {}', 'Zoho tickets-ophalen mislukt (401): {}', 'Zoho ticketdetail 9 mislukt (403): {}', 'invalid_token', 'Unauthorized', 'Zoho Desk org ID niet gevonden']) {
    assert.equal(isAuthFout(new Error(t)), true, t);
  }
  for (const t of ['Zoho tickets-ophalen mislukt (500): {}', 'Zoho ticketdetail 4011 mislukt (500): {}', 'netwerk', 'Zoho reageert niet binnen 12 s']) {
    assert.equal(isAuthFout(new Error(t)), false, t);
  }
  assert.equal(isAuthFout(null), false);
});

// ---------------- M4: Zoho blijft hangen ----------------
test('hangende Zoho: na de time-out valt de aanvraag terug op de momentopname (binnen de grens) en geeft anders een duidelijke fout', async () => {
  const hangt = () => new Promise(() => {});
  const o = opstelling({ snapshot: snap(NU - 10 * MIN) });
  const r = await levering(o, { haalLive: hangt, liveTimeoutMs: 20 });
  assert.equal(r.bron, 'snapshot');
  assert.equal(r.verouderd, true);
  assert.equal(o.store._data.has(BEZIG_SLEUTEL), false);
  const o2 = opstelling();
  await assert.rejects(levering(o2, { haalLive: hangt, liveTimeoutMs: 20 }), /reageert niet/);
  const o3 = opstelling({ snapshot: snap(NU - 2 * MAX_TERUGVAL_MS) });
  await assert.rejects(levering(o3, { haalLive: hangt, liveTimeoutMs: 20 }), /reageert niet/);
});

test('een snelle Zoho-lading wordt door de time-out niet gehinderd (en de timer blijft niet hangen)', async () => {
  const o = opstelling();
  const r = await levering(o, { liveTimeoutMs: 5000 });
  assert.equal(r.bron, 'live');
});

// ---------------- I2: Vernieuwen (?vers=1) ----------------
test('forceren: een momentopname jonger dan 30 s wordt gewoon geserveerd (rem: hoogstens één geforceerde lading per 30 s voor alle gebruikers)', async () => {
  const o = opstelling({ snapshot: snap(NU - FORCEER_MIN_MS + 1000) });
  const r = await levering(o, { forceer: true });
  assert.equal(r.bron, 'snapshot');
  assert.equal(r.verouderd, false);
  assert.equal(o.aantalLive(), 0);
});

test('forceren: vanaf 30 s oud (ook al is de momentopname nog "vers") komt er een echte Zoho-lading en wordt de momentopname herschreven', async () => {
  const o = opstelling({ snapshot: snap(NU - FORCEER_MIN_MS) });
  const r = await levering(o, { forceer: true });
  assert.equal(r.bron, 'live');
  assert.deepEqual(r.body, NIEUW);
  assert.equal(o.gelezen().op, NU);
  // direct erna forceert een volgende gebruiker niet opnieuw: hij krijgt de net geschreven momentopname
  o.k.t += 5000;
  const tweede = await levering(o, { forceer: true });
  assert.equal(tweede.bron, 'snapshot');
  assert.equal(o.aantalLive(), 1);
});

test('forceren: een door een schrijfactie onvers geworden momentopname wordt altijd live ververst, ook binnen 30 s', async () => {
  const o = opstelling({ snapshot: snap(NU - 5000), marker: M('m1', NU - 1000) });
  assert.equal((await levering(o, { forceer: true })).bron, 'live');
});

test('forceren: zonder forceer-vlag verandert er niets (vers = geserveerd)', async () => {
  const o = opstelling({ snapshot: snap(NU - 2 * MIN) });
  assert.equal((await levering(o)).bron, 'snapshot');
});

test('forceren: faalt Zoho dan geldt dezelfde terugval en dezelfde auth-regel', async () => {
  const o = opstelling({ snapshot: snap(NU - 3 * MIN) });
  const r = await levering(o, { forceer: true, haalLive: async () => { throw new Error('Zoho tickets-ophalen mislukt (502): {}'); } });
  assert.equal(r.verouderd, true);
  const o2 = opstelling({ snapshot: snap(NU - 3 * MIN) });
  await assert.rejects(levering(o2, { forceer: true, haalLive: async () => { throw new Error('Zoho tickets-ophalen mislukt (401): {}'); } }), /401/);
});

// ---------------- M1: het slot houdt verliezers tegen ----------------
// Een store waarvan het slot door een "andere aanvraag" overschreven wordt zodra wij het schrijven (wij verliezen de race).
function storeMetSlotVerlies(o) {
  const echt = o.store.setJSON.bind(o.store);
  o.store.setJSON = async (sleutel, waarde) => {
    await echt(sleutel, waarde);
    if (sleutel === BEZIG_SLEUTEL && waarde.id !== 'ander') await echt(BEZIG_SLEUTEL, { id: 'ander', op: o.k.t, dekt: waarde.dekt });
  };
}

test('M1 voorlaad: wie het slot verliest laadt niet (de planner laadt nooit dubbel)', async () => {
  const o = opstelling({ snapshot: snap(NU - 10 * MIN) });
  storeMetSlotVerlies(o);
  const r = await voorlaad({ haalStore: o.haalStore, haalLive: o.haalLive, nu: o.k.nu, log: o.log });
  assert.deepEqual(r, { resultaat: 'overgeslagen', reden: 'bezig' });
  assert.equal(o.aantalLive(), 0);
});

test('M1 leverTickets: een slotverliezer met een bestaande (enkel te oude) momentopname serveert die, zonder dubbele Zoho-lading', async () => {
  const o = opstelling({ snapshot: snap(NU - 6 * MIN) });
  storeMetSlotVerlies(o);
  const r = await levering(o);
  assert.equal(r.bron, 'snapshot');
  assert.equal(r.verouderd, false);
  assert.equal(o.aantalLive(), 0);
});

test('M1 leverTickets: een slotverliezer zonder bruikbare momentopname wacht op de winnaar en serveert diens resultaat', async () => {
  const o = opstelling();
  storeMetSlotVerlies(o);
  let stappen = 0;
  const wacht = async ms => {
    o.k.t += ms; stappen++;
    if (stappen === 1) { o.store._data.set(SNAPSHOT_SLEUTEL, JSON.stringify(snap(o.k.t, NIEUW))); o.store._data.delete(BEZIG_SLEUTEL); }
  };
  const r = await levering(o, { wacht });
  assert.equal(r.bron, 'snapshot');
  assert.deepEqual(r.body, NIEUW);
  assert.equal(o.aantalLive(), 0);
});

test('M1 leverTickets: de winnaar komt niet meer en het slot blijft hangen -> na de wachttijd laadt de verliezer toch zelf (nooit zonder tickets)', async () => {
  const o = opstelling();
  storeMetSlotVerlies(o);
  const wacht = async ms => { o.k.t += ms; o.store._data.set(BEZIG_SLEUTEL, JSON.stringify({ id: 'ander', op: o.k.t, dekt: null })); };
  const r = await levering(o, { wacht });
  assert.equal(r.bron, 'live');
  assert.equal(o.aantalLive(), 1);
});

test('M1: een kapotte schrijfactie op het slot (Blobs-storing) telt niet als verloren race: er wordt gewoon geladen', async () => {
  const o = opstelling({ snapshot: snap(NU - 6 * MIN) });
  const echt = o.store.setJSON.bind(o.store);
  o.store.setJSON = async (sleutel, w) => { if (sleutel === BEZIG_SLEUTEL) throw new Error('storing'); return echt(sleutel, w); };
  const r = await levering(o);
  assert.equal(r.bron, 'live');
  const o2 = opstelling({ snapshot: snap(NU - 10 * MIN) });
  const echt2 = o2.store.setJSON.bind(o2.store);
  o2.store.setJSON = async (sleutel, w) => { if (sleutel === BEZIG_SLEUTEL) throw new Error('storing'); return echt2(sleutel, w); };
  const v = await voorlaad({ haalStore: o2.haalStore, haalLive: o2.haalLive, nu: o2.k.nu, log: o2.log });
  assert.equal(v.resultaat, 'ververst');
});

test('M1: de levensduur van het slot dekt een trage lading (minstens 30 s)', () => {
  assert.ok(BEZIG_TTL_MS >= 30000);
});

// ---------------- M5: niet wachten op een lading die onze wijziging niet bevat ----------------
test('M5: een lopende lading die vóór onze schrijfactie begon (slot dekt de huidige marker niet) wordt niet afgewacht: meteen zelf laden', async () => {
  const o = opstelling({ snapshot: snap(NU - 60000), marker: M('nieuw', NU - 1000), bezig: { id: 'ander', op: NU - 2000, dekt: 'oud' } });
  let gewacht = 0;
  const r = await levering(o, { wacht: async ms => { gewacht++; o.k.t += ms; } });
  assert.equal(r.bron, 'live');
  assert.equal(gewacht, 0);
});
