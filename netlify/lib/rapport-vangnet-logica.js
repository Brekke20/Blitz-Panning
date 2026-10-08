// Pure keuzelogica voor het vangnet (scheduled function rapport-vangnet): welke rapporten opnieuw
// gestart moeten worden en welke oude entries (met inline HTML of foto's) naar een inhoudsblob migreren.

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

// Oude entries kunnen ook nog inline foto's (base64) in rapportData.fotos hebben.
export const heeftInlineFotos = entry => Array.isArray(entry?.rapportData?.fotos) && entry.rapportData.fotos.length > 0;

export const heeftZwareInhoud = entry => heeftInlineHtml(entry) || heeftInlineFotos(entry);

// Entries met inline HTML of foto's in de lijst (nieuwste eerst, zoals in de lijst).
export function kiesTeMigreren(rapports, max = MAX_MIGRATIE_PER_RUN) {
  return rapports.filter(heeftZwareInhoud).slice(0, max);
}

// De inhoud voor de blob en de lichte lijst-entry. Bewust GEEN `verwerking`-veld: oude entries
// blijven "oud" (effectieveStatus leidt de status af uit zohoUploaded/geannuleerd), zodat het
// vangnet ze nooit opnieuw naar Zoho stuurt.
// Een entry met enkel inline fotos (geen _html) krijgt geen inhoudsblob (`inhoud: null`): de entry
// wordt enkel gestript.
export function maakMigratie(entry, nu = new Date()) { // eslint-disable-line no-unused-vars
  const rd = entry.rapportData;
  if (!heeftInlineHtml(entry)) {
    return { inhoud: null, lichteEntry: { ...entry, rapportData: stripZwareVelden(rd) } };
  }
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
