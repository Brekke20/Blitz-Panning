// schermen/sales-route-optimaliseer.js — "⚡ Optimaliseer" en "✕ Leeg" van de Route-tab van de verkoper (puur, geen DOM, geen netwerk).
//
// Optimaliseer herordent de verschuifbare bezoeken van één dag voor de kortste route. Een vast bezoek (isVast: bevestigd of vastgezet uur) blijft op zijn
// uur staan; de andere krijgen nieuwe starttijden in de nieuwe volgorde, vanaf de werkdagstart (vanuit het startadres), met de reistijden en dezelfde
// veiligheidsmarge als "Plan deze week" (ritMetMarge). De keuze voor een eigen, kleine zoekfunctie in plaats van /api/optimize of het planner-brein:
//  - /api/optimize vraagt adressen en geocodeert die opnieuw (traag, kan mislukken), terwijl een lead zijn coördinaten al heeft;
//  - planWeek plant een héle week en verplaatst bezoeken over dagen, terwijl hier enkel de volgorde binnen één dag mag veranderen;
//  - een dag heeft hooguit enkele bezoeken: de beste volgorde is exact te berekenen (tot 8 bezoeken alle volgordes; daarboven dichtstbijzijnde buur + 2-opt).
// De reistijden komen van buitenaf (`rit`, de matrix van /api/matrix zoals bij het planner-brein); ontbreekt een waarde, dan geldt de schatting van de route.
import { haversine } from '../planner.js';
import { timeStrToMin, minToTimeStr } from '../kern/tijd.js';
import { ritMetMarge } from '../sales/planner-adapter.js';
import { isVast } from '../sales/lead-regels.js';

export const DEPOT_ID = '__depot__';
const WEGFACTOR = 1.3;
const SNELHEID_KMH = 50;
const BRUTE_KRACHT_MAX = 8;
const AFRONDEN_MIN = 5;

const heeft = (p) => p != null && p.lat != null && p.lon != null;
const naarBoven = (min) => Math.ceil(min / AFRONDEN_MIN) * AFRONDEN_MIN;

/** Reistijd in minuten tussen twee knopen ({ id, locatie }); een onbekende locatie telt als 0, een ontbrekende matrixwaarde als schatting. */
function maakRitMin(rit) {
  return (a, b) => {
    if (!a || !b || !heeft(a.locatie) || !heeft(b.locatie)) return 0;
    const v = rit?.(a.id, b.id);
    if (Number.isFinite(v) && v >= 0) return v;
    return (haversine(a.locatie.lat, a.locatie.lon, b.locatie.lat, b.locatie.lon) * WEGFACTOR / SNELHEID_KMH) * 60;
  };
}

/**
 * De kortste open route (geen terugkeer) langs `items`, beginnend bij `start` (de kosten vanaf `start` tellen mee; zonder start is het beginpunt vrij).
 * Alle volgordes tot BRUTE_KRACHT_MAX items, daarboven dichtstbijzijnde buur vanaf elk beginpunt plus 2-opt. Bij gelijke kosten blijft de oorspronkelijke volgorde.
 */
export function kortsteVolgorde(items, start, ritMin) {
  const n = items.length;
  if (n < 2) return items.slice();
  const kost = (rij) => {
    let t = 0;
    let vorige = start;
    for (const it of rij) { t += vorige ? ritMin(vorige, it) : 0; vorige = it; }
    return t;
  };
  if (n <= BRUTE_KRACHT_MAX) {
    let beste = items.slice();
    let besteKost = kost(beste);
    const rij = [];
    const gebruikt = new Array(n).fill(false);
    const zoek = (lopend, vorige) => {
      if (lopend >= besteKost) return; // snoeien; gelijke kosten verbeteren niet (eerste, dus oorspronkelijkste, volgorde wint)
      if (rij.length === n) { beste = rij.slice(); besteKost = lopend; return; }
      for (let i = 0; i < n; i++) {
        if (gebruikt[i]) continue;
        gebruikt[i] = true; rij.push(items[i]);
        zoek(lopend + (vorige ? ritMin(vorige, items[i]) : 0), items[i]);
        rij.pop(); gebruikt[i] = false;
      }
    };
    zoek(0, start);
    return beste;
  }
  let beste = null;
  let besteKost = Infinity;
  const beginpunten = start ? [null] : items.map((_, i) => i);
  for (const b of beginpunten) {
    const rest = items.slice();
    const rij = [];
    let vorige = start;
    if (b != null) { rij.push(rest.splice(b, 1)[0]); vorige = rij[0]; }
    while (rest.length) {
      let k = 0;
      for (let i = 1; i < rest.length; i++) if (ritMin(vorige, rest[i]) < ritMin(vorige, rest[k])) k = i;
      vorige = rest.splice(k, 1)[0];
      rij.push(vorige);
    }
    let verbeterd = true;
    while (verbeterd) {
      verbeterd = false;
      for (let i = 0; i < rij.length - 1; i++) {
        for (let j = i + 1; j < rij.length; j++) {
          const kandidaat = rij.slice(0, i).concat(rij.slice(i, j + 1).reverse(), rij.slice(j + 1));
          if (kost(kandidaat) < kost(rij) - 1e-9) { rij.splice(0, rij.length, ...kandidaat); verbeterd = true; }
        }
      }
    }
    const k = kost(rij);
    if (k < besteKost - 1e-9) { besteKost = k; beste = rij; }
  }
  return beste;
}

/**
 * Herordent de verschuifbare bezoeken van een dag.
 *  - stops: RouteStop[] van `bouwRouteStops` (nr, leadId, startMin, duurMin, vast, locatie)
 *  - depot: { lat, lon } | null; rit(vanId, naarId) -> minuten | null (id's zijn leadId's, het depot is DEPOT_ID)
 *  - vanTijd / laatsteStart: 'HH:MM' uit de instellingen van de verkoper; reisMarge(min) -> min (standaard ritMetMarge van "Plan deze week")
 * -> { ok: true, volgorde: [{ leadId, start, vast, verschoven }], wijzigingen: [{ leadId, start }], volgordeGewijzigd, rijtijdVoor, rijtijdNa }
 *  | { ok: false, reden: 'te-weinig' | 'te-laat', laatsteStart?, leadId? }
 * `wijzigingen` bevat enkel de bezoeken waarvan het uur verandert; een vast bezoek komt er nooit in voor.
 */
export function optimaliseerDag({ stops, depot = null, rit = null, vanTijd = '08:00', laatsteStart = null, reisMarge = ritMetMarge }) {
  const alle = (stops ?? []).map((s) => ({ ...s, id: s.leadId, locatie: heeft(s.locatie) ? s.locatie : null }));
  const verschuifbaar = alle.filter((s) => !s.vast);
  if (verschuifbaar.length < 2) return { ok: false, reden: 'te-weinig' };
  const ankers = alle.filter((s) => s.vast).sort((a, b) => a.startMin - b.startMin);
  const ritMin = maakRitMin(rit);
  const depotKnoop = heeft(depot) ? { id: DEPOT_ID, locatie: { lat: depot.lat, lon: depot.lon } } : null;
  const marge = (a, b) => (a && b && heeft(a.locatie) && heeft(b.locatie) ? reisMarge(ritMin(a, b)) : 0);

  // 1. De kortste volgorde van de bezoeken met een locatie; die zonder locatie komen achteraan (er is niets om op te rekenen).
  const metLocatie = verschuifbaar.filter((s) => s.locatie);
  const zonderLocatie = verschuifbaar.filter((s) => !s.locatie);
  const orde = kortsteVolgorde(metLocatie, depotKnoop, ritMin).concat(zonderLocatie);

  // 2. Starttijden: de bezoeken één voor één, de vaste bezoeken blijven staan en gaan voor als het volgende bezoek er niet meer voor past.
  const werkStart = timeStrToMin(vanTijd || '08:00');
  let klok = werkStart;
  let positie = depotKnoop;
  let volgendAnker = 0;
  const uitkomst = [];
  const plaatsAnker = () => {
    const a = ankers[volgendAnker++];
    uitkomst.push({ leadId: a.leadId, startMin: a.startMin, vast: true });
    klok = Math.max(klok, a.startMin + (a.duurMin ?? 0));
    positie = a;
  };
  for (const s of orde) {
    for (;;) {
      const start = naarBoven(klok + marge(positie, s));
      const a = ankers[volgendAnker];
      if (!a || start + (s.duurMin ?? 0) + marge(s, a) <= a.startMin) { uitkomst.push({ leadId: s.leadId, startMin: start, vast: false }); klok = start + (s.duurMin ?? 0); positie = s; break; }
      plaatsAnker();
    }
  }
  while (volgendAnker < ankers.length) plaatsAnker();

  // 3. Een verschuifbaar bezoek dat na het laatste startuur zou beginnen past niet in de werkdag: niets doen.
  const grens = laatsteStart ? timeStrToMin(laatsteStart) : null;
  if (grens != null) {
    const laat = uitkomst.find((u) => !u.vast && u.startMin > grens);
    if (laat) return { ok: false, reden: 'te-laat', laatsteStart, leadId: laat.leadId };
  }

  // 4. Het resultaat: wat er verandert en de rijtijd (zonder marge) voor en na, over de hele dag vanaf het startadres.
  const oud = new Map(alle.map((s) => [s.leadId, s]));
  const perId = new Map(alle.map((s) => [s.leadId, s]));
  const volgorde = uitkomst.map((u) => ({ leadId: u.leadId, start: minToTimeStr(u.startMin), vast: u.vast, verschoven: !u.vast && u.startMin !== oud.get(u.leadId).startMin }));
  const wijzigingen = volgorde.filter((v) => v.verschoven).map((v) => ({ leadId: v.leadId, start: v.start }));
  const rijtijd = (ids) => { let t = 0; let vorige = depotKnoop; for (const id of ids) { const k = perId.get(id); t += vorige ? ritMin(vorige, k) : 0; vorige = k; } return t; };
  const voor = alle.slice().sort((a, b) => a.startMin - b.startMin).map((s) => s.leadId);
  const na = uitkomst.map((u) => u.leadId);
  return {
    ok: true,
    volgorde,
    wijzigingen,
    volgordeGewijzigd: voor.some((id, i) => id !== na[i]),
    rijtijdVoor: Math.round(rijtijd(voor)),
    rijtijdNa: Math.round(rijtijd(na)),
  };
}

/**
 * Welke bezoeken van een dag gaan bij "✕ Leeg" terug naar "Nog in te plannen"? Alleen de niet-vaste voorgestelde bezoeken; een bevestigd of vastgezet
 * bezoek blijft staan (dat zet de verkoper afzonderlijk terug). Dezelfde bezoeken als op de Route-tab (voorgesteld of bevestigd, met uur, op die dag).
 * -> { vrij: [leadId], vast: aantal }
 */
export function kiesLeegTeMaken(leads, datum) {
  const opDag = (leads ?? []).filter((l) => (l.status === 'voorgesteld' || l.status === 'bevestigd') && l.planning?.datum === datum && l.planning.start);
  const vrij = opDag.filter((l) => !isVast(l)).map((l) => l.id);
  return { vrij, vast: opDag.length - vrij.length };
}
