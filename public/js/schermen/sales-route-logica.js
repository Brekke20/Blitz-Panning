// schermen/sales-route-logica.js — de dagroute van de verkoper: stops, geschatte ritten en tijdcontrole (puur, geen DOM).
import { isVast } from '../sales/lead-regels.js';
import { plaatsLabel } from '../sales/adres.js';
import { haversine } from '../planner.js';
import { timeStrToMin, minToTimeStr } from '../kern/tijd.js';
import { naamVan } from './sales-tekst.js';

const STANDAARD_DUUR_MIN = 60;
const WEGFACTOR = 1.3;     // hemelsbreed -> wegafstand
const SNELHEID_KMH = 50;

/**
 * Stops van één dag (voorgesteld en bevestigd), op uur gesorteerd, nr vanaf 1.
 * `ongeveer`: de locatie komt van de postcode (geen exact adres). `locatie` is null zonder coordinaten.
 */
export function bouwRouteStops(leads, datum, { standaardDuurMin = STANDAARD_DUUR_MIN } = {}) {
  return (leads ?? [])
    .filter((l) => (l.status === 'voorgesteld' || l.status === 'bevestigd') && l.planning?.datum === datum && l.planning.start)
    .map((l) => ({ l, startMin: timeStrToMin(l.planning.start) }))
    .sort((a, b) => a.startMin - b.startMin)
    .map(({ l, startMin }, i) => {
      const heeftLocatie = l.locatie?.lat != null && l.locatie?.lon != null;
      return {
        nr: i + 1, leadId: l.id, naam: naamVan(l), plaats: plaatsLabel(l), start: l.planning.start, startMin,
        duurMin: l.duurMin ?? standaardDuurMin, vast: isVast(l),
        locatie: heeftLocatie ? { lat: l.locatie.lat, lon: l.locatie.lon } : null,
        ongeveer: heeftLocatie && l.locatie.bron === 'postcode',
      };
    });
}

/**
 * De regel van één dag in de weekstrook bovenaan de Route-tab (zelfde vorm als die van de technieker): het aantal bezoeken en of ze bevestigd zijn.
 * Een voorgesteld bezoek moet de verkoper nog bevestigen; een bevestigd of vast bezoek staat vast.
 * -> { klasse: 'leeg' | 'nodig' | 'klaar', status, aantal, aria }
 */
export function weekDagInfo(leads, datum) {
  const stops = bouwRouteStops(leads, datum);
  const n = stops.length;
  const aantal = n === 1 ? '1 bezoek' : `${n} bezoeken`;
  if (!n) return { klasse: 'leeg', status: '—', aantal, aria: `${aantal}, niets gepland` };
  const open = stops.filter((x) => !x.vast).length;
  if (open) return { klasse: 'nodig', status: '☎ bevestigen', aantal, aria: `${aantal}, ${open} te bevestigen` };
  return { klasse: 'klaar', status: '✓ bevestigd', aantal, aria: `${aantal}, alle bezoeken bevestigd` };
}

/** Geschatte ritten tussen opeenvolgende punten (haversine x 1,3 km aan 50 km/u): n-1 legs, zonder coordinaten null. */
export function schatLegs(punten) {
  const legs = [];
  for (let i = 1; i < (punten ?? []).length; i++) {
    const a = punten[i - 1], b = punten[i];
    if ([a?.lat, a?.lon, b?.lat, b?.lon].some((x) => x == null)) {
      legs.push({ travelTimeSeconds: null, distanceMeters: null });
      continue;
    }
    const km = haversine(a.lat, a.lon, b.lat, b.lon) * WEGFACTOR;
    legs.push({ travelTimeSeconds: Math.round((km / SNELHEID_KMH) * 3600), distanceMeters: Math.round(km * 1000) });
  }
  return legs;
}

/**
 * Welke stops halen hun uur niet? `legsMin[i]` = rit naar stop i in minuten (eerste = depot -> stop 1).
 * Stop 1 telt vanaf `depotVertrekMin`, de andere vanaf het einde van de vorige stop (volgens plan, dus een vertraging werkt niet door).
 * Onbekende ritten (null) en een onbekend vertrek worden niet gecontroleerd. -> [{ leadId, laatMin }]
 */
export function controleerKeten(stops, legsMin, depotVertrekMin) {
  const gemist = [];
  (stops ?? []).forEach((s, i) => {
    const rit = legsMin?.[i];
    const vorigEinde = i === 0 ? depotVertrekMin : stops[i - 1].startMin + (stops[i - 1].duurMin ?? 0);
    if (rit == null || vorigEinde == null) return;
    const laatMin = Math.round(vorigEinde + rit - s.startMin);
    if (laatMin >= 1) gemist.push({ leadId: s.leadId, laatMin });
  });
  return gemist;
}

const coord = (p) => (p ? `${Number(p.lat).toFixed(5)},${Number(p.lon).toFixed(5)}` : '-');

/** Herkenningstekst van een route: verandert bij een andere volgorde, andere leads of andere coordinaten (verouderde route). */
export function routeHandtekening(depot, stops) {
  return `${coord(depot)}|${(stops ?? []).map((s) => `${s.leadId}@${coord(s.locatie)}`).join('>')}`;
}

// ---- de route zelf: wegpunten, ritten per stop en de berekening (Task 18) ----

const heeft = (p) => p != null && p.lat != null && p.lon != null;

/**
 * De punten die naar /api/route gaan: het depot (indien er een is) en elke stop met een locatie, in volgorde.
 * `bij[k]` = index van de stop waar punt k bij hoort (-1 = depot).
 */
export function wegpunten(depot, stops) {
  const punten = [];
  const bij = [];
  if (heeft(depot)) { punten.push({ lat: depot.lat, lon: depot.lon }); bij.push(-1); }
  (stops ?? []).forEach((s, i) => {
    if (!heeft(s.locatie)) return;
    punten.push({ lat: s.locatie.lat, lon: s.locatie.lon });
    bij.push(i);
  });
  return { punten, bij };
}

const ONBEKEND = Object.freeze({ ritSec: null, afstandM: null });

/**
 * Van de benen tussen opeenvolgende wegpunten naar de rit VOOR elke stop (index = stop): [{ ritSec, afstandM }].
 * Een rit is enkel bekend als het vorige wegpunt de stop ervoor (of het depot voor stop 1) is: over een stop zonder locatie
 * heen zou de rit een samenvoeging van twee ritten zijn, dus null (geen valse waarschuwing).
 */
export function ritPerStop(depot, stops, legs) {
  const { bij } = wegpunten(depot, stops);
  return (stops ?? []).map((_, i) => {
    const k = bij.indexOf(i);
    if (k < 1) return { ...ONBEKEND };
    const vorige = bij[k - 1];
    const aansluitend = vorige === i - 1 || (i === 0 && vorige === -1);
    const leg = legs?.[k - 1];
    if (!aansluitend || leg?.travelTimeSeconds == null) return { ...ONBEKEND };
    return { ritSec: leg.travelTimeSeconds, afstandM: leg.distanceMeters ?? null };
  });
}

/** ISO-tijdstip (UTC) van `datum` + `minuten` lokale tijd, enkel als dat nog in de toekomst ligt (TomTom weigert het verleden); anders undefined. */
export function vertrekIso(datum, minuten, nu = new Date()) {
  if (minuten == null || !/^\d{4}-\d{2}-\d{2}$/.test(datum ?? '')) return undefined;
  const d = new Date(`${datum}T${minToTimeStr(minuten)}:00`);
  return !isNaN(d) && d.getTime() > nu.getTime() ? d.toISOString() : undefined;
}

/**
 * De route van een dag. Testmodus of een mislukte aanvraag (status, netwerk, onverwacht antwoord): geschatte benen uit `schatLegs`
 * (`geschat: true`, bij een fout `reden: 'fout'`). -> { legs: [{ ritSec, afstandM }] per stop, polyline, geschat, reden?, totaalSec, totaalMeter, data }
 * `data` = het ruwe antwoord van /api/route (legs met verkeersgegevens, sections, departAtUsed, ...) voor de drukte- en werken-kleuring van de kaart (zelfde
 * tekening als de route van de technieker); null bij een schatting of als de routelijn van TomTom ontbrak (dan is de lijn een eigen, rechte verbinding).
 * `vertrekMin` = vertrek uit het depot in minuten (voor `departAt`); zonder depot telt het eerste bezoek.
 */
export async function berekenRoute({ depot, stops, datum, vertrekMin, apiVerzoek, testModus, nu = new Date() }) {
  const { punten } = wegpunten(depot, stops);
  const totalen = (legs) => ({
    totaalSec: legs.reduce((t, l) => t + (l.ritSec ?? 0), 0),
    totaalMeter: legs.reduce((t, l) => t + (l.afstandM ?? 0), 0),
  });
  const schat = (reden) => {
    const ruw = schatLegs(punten);
    const legs = ritPerStop(depot, stops, ruw);
    return { legs, polyline: punten.map((p) => [p.lat, p.lon]), geschat: true, ...(reden ? { reden } : {}), ...totalen(legs), data: null };
  };
  if (punten.length < 2) return { legs: ritPerStop(depot, stops, []), polyline: [], geschat: false, totaalSec: 0, totaalMeter: 0, data: null };
  if (testModus) return schat('test');
  try {
    const eerste = (stops ?? []).find((s) => heeft(s.locatie));
    const departAt = vertrekIso(datum, heeft(depot) ? vertrekMin : eerste?.startMin, nu);
    const r = await apiVerzoek('/api/route', { methode: 'POST', body: { waypoints: punten, ...(departAt ? { departAt } : {}) } });
    const ruw = r?.data?.legs;
    if (!r?.ok || !Array.isArray(ruw) || ruw.length !== punten.length - 1) return schat('fout');
    const legs = ritPerStop(depot, stops, ruw);
    const heeftLijn = Array.isArray(r.data.polyline) && r.data.polyline.length >= 2;
    const polyline = heeftLijn ? r.data.polyline : punten.map((p) => [p.lat, p.lon]);
    return { legs, polyline, geschat: false, ...totalen(legs), data: heeftLijn ? r.data : null };
  } catch {
    return schat('fout');
  }
}
