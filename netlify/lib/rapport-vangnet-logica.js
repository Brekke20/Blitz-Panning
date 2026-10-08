// Pure keuzelogica voor het vangnet (scheduled function rapport-vangnet): welke rapporten opnieuw
// gestart moeten worden en welke oude entries (met inline HTML) naar een inhoudsblob migreren.

import { moetStarten } from './rapport-verwerking.js';
import { stripZwareVelden } from './rapportlijst.js';

export const MAX_START_PER_RUN = 5;
export const MAX_MIGRATIE_PER_RUN = 20;

// Ids van entries die (opnieuw) gestart moeten worden, oudste eerst. De lijst staat nieuwste
// eerst, dus we lopen van achteren naar voren.
export function kiesTeStarten(rapports, nu, max = MAX_START_PER_RUN) {
  const ids = [];
  for (let i = rapports.length - 1; i >= 0 && ids.length < max; i--) {
    if (moetStarten(rapports[i], nu)) ids.push(rapports[i].id);
  }
  return ids;
}

export const heeftInlineHtml = entry =>
  typeof entry?.rapportData?._html === 'string' && entry.rapportData._html !== '';

// Entries die nog inline HTML in de lijst hebben (nieuwste eerst, zoals in de lijst).
export function kiesTeMigreren(rapports, max = MAX_MIGRATIE_PER_RUN) {
  return rapports.filter(heeftInlineHtml).slice(0, max);
}

// De inhoud voor de blob en de lichte lijst-entry. Bewust GEEN `verwerking`-veld: oude entries
// blijven "oud" (effectieveStatus leidt de status af uit zohoUploaded/geannuleerd), zodat het
// vangnet ze nooit opnieuw naar Zoho stuurt.
export function maakMigratie(entry, nu = new Date()) { // eslint-disable-line no-unused-vars
  const rd = entry.rapportData;
  return {
    inhoud: {
      id: entry.id,
      html: rd._html,
      ticketId: entry.ticketId,
      filename: `rapport-${entry.ticketNumber || entry.ticketId}-${entry.datum || 'onbekend'}.pdf`,
      isLocal: false,
    },
    lichteEntry: { ...entry, rapportData: stripZwareVelden(rd), inhoudBeschikbaar: true },
  };
}
