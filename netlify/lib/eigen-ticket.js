// "Mag zelf plannen": een technieker met dat vinkje plant enkel zijn EIGEN tickets. De rechtentabel (planEigen) laat hem door de
// wrapper; elke planningsfunctie roept hier eisEigenTicket aan voor het ticket waarop ze schrijft. Zoho is de bron van waarheid voor
// wie een ticket toegewezen is (assigneeId -> agent), want de aanvraag van de browser draagt geen technieker en is niet te vertrouwen.
// Fail-closed: kan het niet geverifieerd worden, dan gaat het niet door (503 bij een Zoho-storing, anders 403).
import { isEigenNaam } from './eigen.js';
import { agentNaam } from './zoho-agenten.js';

const NIET_EIGEN = { error: 'Je mag enkel je eigen tickets plannen.', code: 'geen-recht' };
const ZOHO_STORING = { error: 'Zoho is tijdelijk niet bereikbaar.', code: 'zoho-storing' };

const weiger = (status, body) => ({ ok: false, status, body });

// -> { ok: true } | { ok: false, status, body }
//   gebruiker : de ingelogde gebruiker (wrapper)
//   ticketId  : numeriek Zoho-ticket-id
//   zoho      : maakZoho()-instantie; toegang (optioneel): { token, orgId } die de aanroeper al heeft; ticket (optioneel): het al
//               opgehaalde Zoho-ticket (propose en annuleer halen het toch op)
// Niet-technieker (beheerder, planner): altijd ok, geen Zoho-aanroep.
export async function eisEigenTicket({ gebruiker, ticketId, zoho, toegang, ticket }) {
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
    if (!res.ok) return weiger(503, ZOHO_STORING);
    const naam = agentNaam(await res.json().catch(() => null));
    return isEigenNaam(gebruiker, naam) ? { ok: true } : weiger(403, NIET_EIGEN);
  } catch (e) {
    console.error('eisEigenTicket: Zoho niet bereikbaar (' + (e?.name || 'Error') + ')');
    return weiger(503, ZOHO_STORING);
  }
}
