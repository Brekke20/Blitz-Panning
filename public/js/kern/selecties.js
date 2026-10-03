// kern/selecties.js — pure afleidingen op basis van de technieker-filter (geen globale toestand)
// Bevat: isAlle, persoonOfNull, ticketsVanTechnieker, planItemsVanTechnieker, eigenAfsprakenVoor, blokkeringenVoor, stopsVoorDag
import { leggDagUit } from '../planner-tijdlijn.js';

export function isAlle(filter) {
  return filter === 'all';
}

export function persoonOfNull(filter) {
  return filter === 'all' ? null : filter;
}

// Tickets (allTickets, allGepland, ...) van één technieker; 'all' = iedereen. Geeft altijd een nieuwe array.
export function ticketsVanTechnieker(tickets, filter) {
  return (tickets || []).filter(t => filter === 'all' || t.assignee === filter);
}

// Plan-items ({ ticket, uur, ... }, bv. planning[datum]) van één technieker. Nieuwe array, zelfde items.
export function planItemsVanTechnieker(items, filter) {
  return (items || []).filter(p => filter === 'all' || p.ticket.assignee === filter);
}

// Eigen (lokale) afspraken van een datum voor een technieker: afspraken zonder persoon blijven altijd staan.
// `alleenMetLocatie`: enkel afspraken met adres of notitie (zoals de Route-tab).
export function eigenAfsprakenVoor(events, datum, filter, { alleenMetLocatie = false } = {}) {
  return (events || []).filter(e =>
    e.datum === datum &&
    (!alleenMetLocatie || (e.adres || e.notitie)) &&
    (filter === 'all' || !e.persoon || e.persoon === filter)
  );
}

// Blokkeringen (avExceptions-records) van een datum die gelden voor een technieker: globale blokkeringen en die van
// deze persoon (filter 'all' = enkel de globale). `soort` (optioneel): 'fullday' of 'range'; zonder soort alle soorten.
export function blokkeringenVoor(avExceptions, datum, filter, soort) {
  const persoon = persoonOfNull(filter);
  return (avExceptions || []).filter(e =>
    e.date === datum &&
    (soort === undefined || e.kind === soort) &&
    (e.scope === 'global' || (persoon && e.person === persoon))
  );
}

// Gedeelde opbouw van de stops van één dag (Route-tab, ticketdetail): `stops`, `localForDate` en `allStops`
// ({ kind: 'ticket'|'local', item, uur }).
// De wrapper-objecten zijn vers (`uur` is een snapshot), `item` blijft hetzelfde object als in planning/localEvents:
// applyRouteOrder() muteert dat rechtstreeks.
// Volgorde van allStops:
//  - zonder `opties`: op uur, geen uur = achteraan (oud gedrag, enkel nog voor aanroepers zonder instellingen);
//  - met `opties` ({ vanTijd, laatsteStart, duurVoor(ticketId), werktijdMin(uur, einduur) }): op de tijd die de gedeelde
//    plaatsingsregel (planner-tijdlijn.js) aan elke stop geeft. Stops zonder uur komen dus in de gaten tussen de vaste uren
//    (zoals "+" en het planner-brein ze plaatsen) en niet automatisch achteraan. Brent-besluit (proefperiode).
export function stopsVoorDag({ planning, localEvents }, filter, date, opties = null) {
  const stops = planItemsVanTechnieker((planning || {})[date], filter);
  const localForDate = eigenAfsprakenVoor(localEvents, date, filter, { alleenMetLocatie: true });
  const allStops = [
    ...stops.map(s => ({ kind: 'ticket', item: s, uur: s.uur })),
    ...localForDate.map(e => ({ kind: 'local', item: e, uur: e.uur })),
  ];
  if (!opties) {
    allStops.sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'));
  } else {
    const sleutel = e => (e.kind === 'ticket' ? 't' : 'l') + (e.kind === 'ticket' ? e.item.ticket.id : e.item.id);
    const items = allStops.map(e => ({
      id: sleutel(e), uur: e.uur || null, soort: 'stop', ticket: e.kind === 'ticket',
      duurMin: e.kind === 'ticket'
        ? (opties.duurVoor(e.item.ticket.id) || 60)
        : ((e.item.uur && e.item.einduur ? opties.werktijdMin(e.item.uur, e.item.einduur) : 0) || 60),
    }));
    const { plaatsingen } = leggDagUit({ items, vanTijd: opties.vanTijd, laatsteStart: opties.laatsteStart });
    const rang = new Map(plaatsingen.map((p, i) => [p.id, i]));
    allStops.sort((a, b) => rang.get(sleutel(a)) - rang.get(sleutel(b)));
  }
  return { stops, localForDate, allStops };
}
