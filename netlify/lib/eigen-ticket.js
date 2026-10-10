// "Mag zelf plannen": een technieker met dat vinkje plant enkel zijn EIGEN tickets. De rechtentabel (planEigen) laat hem door de
// wrapper; elke planningsfunctie roept hier eisEigenTicket aan voor het ticket waarop ze schrijft. Zoho is de bron van waarheid voor
// wie een ticket toegewezen is (assigneeId -> agent), want de aanvraag van de browser draagt geen technieker en is niet te vertrouwen.
// Fail-closed: kan het niet geverifieerd worden, dan gaat het niet door (503 bij een Zoho-storing, anders 403).
import { isEigenNaam } from './eigen.js';
import { agentNaam } from './zoho-agenten.js';

const NIET_EIGEN = { error: 'Je mag enkel je eigen tickets plannen.', code: 'geen-recht' };
const ZOHO_STORING = { error: 'Zoho is tijdelijk niet bereikbaar.', code: 'zoho-storing' };

const weiger = (status, body) => ({ ok: false, status, body });

// De Zoho-statussen van de planningsflow (dezelfde als in tickets.js). Een technieker met "Mag zelf plannen" plant enkel tickets die al in die flow
// zitten: een gesloten of afgewerkt ticket heropenen kan hij niet (een planner wel, zoals altijd).
export const STATUS_TE_PLANNEN = ['Service in te plannen', 'Wachten op planning'];
export const STATUS_PENDING = ['Wachten op bevestiging planning'];
export const STATUS_GEPLAND = ['Geplande service', 'Geplande support'];
const NIET_PLANBAAR = { error: 'Dit ticket staat niet (meer) in de planning (status in Zoho). Vraag de planner.', code: 'ticket-status' };

// -> { ok: true } | { ok: false, status, body }
//   gebruiker : de ingelogde gebruiker (wrapper)
//   ticketId  : numeriek Zoho-ticket-id
//   statussen : (optioneel) toegelaten Zoho-statussen van het ticket vóór de actie; een ander of onbekend ticket geeft 409 `ticket-status`
//   zoho      : maakZoho()-instantie; toegang (optioneel): { token, orgId } die de aanroeper al heeft; ticket (optioneel): het al
//               opgehaalde Zoho-ticket (propose en annuleer halen het toch op)
// Niet-technieker (beheerder, planner): altijd ok, geen Zoho-aanroep.
export async function eisEigenTicket({ gebruiker, ticketId, zoho, toegang, ticket, statussen }) {
  if (gebruiker?.rol !== 'technieker') return { ok: true };
  if (gebruiker.magZelfPlannen !== true || typeof gebruiker.zohoNaam !== 'string' || gebruiker.zohoNaam.trim() === '') {
    return weiger(403, NIET_EIGEN);
  }
  try {
    const { token, orgId } = toegang ?? await zoho.haalToegang();
    let t = ticket;
    if (!t) {
      const res = await zoho.verzoek(`/tickets/${encodeURIComponent(ticketId)}`, { token, orgId });
      if (res.status === 404) return weiger(404, { error: 'Ticket niet gevonden' });
      if (!res.ok) return weiger(503, ZOHO_STORING);
      t = await res.json().catch(() => null);
    }
    const agentId = t?.assigneeId;
    if (typeof agentId !== 'string' && typeof agentId !== 'number') return weiger(403, NIET_EIGEN); // niemand toegewezen: niet van hem
    const res = await zoho.verzoek(`/agents/${encodeURIComponent(agentId)}`, { token, orgId });
    if (res.status === 404) return weiger(403, NIET_EIGEN); // een niet (meer) bestaande agent: het ticket is niet van hem
    if (!res.ok) return weiger(503, ZOHO_STORING);
    const naam = agentNaam(await res.json().catch(() => null));
    if (!isEigenNaam(gebruiker, naam)) return weiger(403, NIET_EIGEN);
    if (Array.isArray(statussen) && !statussen.includes(t?.status)) return weiger(409, NIET_PLANBAAR);
    return { ok: true };
  } catch (e) {
    console.error('eisEigenTicket: Zoho niet bereikbaar (' + (e?.name || 'Error') + ')');
    return weiger(503, ZOHO_STORING);
  }
}
