// schermen/sales-route-logica.js — de dagroute van de verkoper: stops, geschatte ritten en tijdcontrole (puur, geen DOM).
import { isVast } from '../sales/lead-regels.js';
import { plaatsLabel } from '../sales/adres.js';
import { haversine } from '../planner.js';
import { timeStrToMin } from '../kern/tijd.js';
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
