// kern/selecties.js — pure afleidingen op basis van de technieker-filter (geen globale toestand)
// Bevat: isAlle, persoonOfNull, ticketsVanTechnieker, planItemsVanTechnieker, eigenAfsprakenVoor, blokkeringenVoor, stopsVoorDag

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
// ({ kind: 'ticket'|'local', item, uur }, gesorteerd op uur, geen uur = achteraan).
// De wrapper-objecten zijn vers (`uur` is een snapshot), `item` blijft hetzelfde object als in planning/localEvents:
// applyRouteOrder() muteert dat rechtstreeks.
export function stopsVoorDag({ planning, localEvents }, filter, date) {
  const stops = planItemsVanTechnieker((planning || {})[date], filter);
  const localForDate = eigenAfsprakenVoor(localEvents, date, filter, { alleenMetLocatie: true });
  const allStops = [
    ...stops.map(s => ({ kind: 'ticket', item: s, uur: s.uur })),
    ...localForDate.map(e => ({ kind: 'local', item: e, uur: e.uur })),
  ].sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'));
  return { stops, localForDate, allStops };
}
