// De volledige ticketlading uit Zoho Desk (agents, lijstpagina's, detail per relevant ticket) en de vorm van het antwoord.
// Verhuisd uit netlify/functions/tickets.js (gedrag ongewijzigd): zowel /api/tickets (bij een verouderde of ontbrekende
// momentopname) als de geplande voorlading (tickets-vooraf.js) draaien exact deze code.
//
// Statussen:
//   Service in te plannen           → moet nog ingepland worden
//   Wachten op bevestiging planning → op kalender gezet, wacht op klantbevestiging
//   Geplande service                → klant bevestigd, definitief
import { leesJsonVeilig } from './zoho.js';
import { agentNaam } from './zoho-agenten.js';

// Beide naamsets ondersteunen (Zoho gebruikt soms oude, soms nieuwe namen)
const STATUS_TE_PLANNEN = ['Service in te plannen', 'Wachten op planning'];
const STATUS_PENDING    = ['Wachten op bevestiging planning'];
const STATUS_GEPLAND    = ['Geplande service', 'Geplande support'];
const RELEVANT = [...STATUS_TE_PLANNEN, ...STATUS_PENDING, ...STATUS_GEPLAND];

const mapTicket = agentMap => t => {
  const cf      = t.cf || {};
  const address = cf.cf_adres
               || cf.cf_adres_eindklant
               || Object.entries(cf).find(([k, v]) => k.includes('adres') && v)?.[1]
               || '';
  return {
    id:                t.id,
    number:            t.ticketNumber,
    subject:           t.subject   || '',
    status:            t.status    || '',
    priority:          t.priority  || '',
    assignee:          agentMap[t.assigneeId] || '',
    contact:           t.contact?.name || t.contact?.fullName
                       || (t.contact?.firstName ? `${t.contact.firstName} ${t.contact.lastName || ''}`.trim() : '')
                       || '',
    email:             t.contact?.email  || t.contact?.emailId || t.email  || '',
    phone:             t.contact?.phone  || t.contact?.mobile  || t.phone  || '',
    account:           t.account?.name || t.account?.accountName || '',
    address,
    hasAddress:        !!address,
    naamEindklant:     cf.cf_naam_eindklant       || '',
    emailEindklant:    cf.cf_e_mail_eindklant     || '',
    telefoonEindklant: cf.cf_telefoon_eindklant   || '',
    serienummer:       cf.cf_serienummer          || '',
    partner:           cf.cf_partner_installateur || '',
    emailInstallateur: cf.cf_e_mail_installateur   || '',
    probleemtype:      cf.cf_probleemtype         || '',
    regio:             (cf.cf_regio && cf.cf_regio !== '-Geen-') ? cf.cf_regio : '',
    interventieDatum:  cf.cf_interventie_datm || null,
    garantieStatus:             cf.cf_garantie_status               || '',
    installateurAlLangsGeweest: cf.cf_installateur_al_langs_geweest || '',
    createdTime:       t.createdTime || null,
  };
};

// Gooit bij elke Zoho-fout (zelfde foutteksten als voorheen); de aanroeper beslist wat er dan gebeurt.
// Geeft { tickets, pendingTickets, plannedTickets }: ongefilterd, voor alle rollen dezelfde inhoud.
export async function haalTickets(zoho) {
  const { token, orgId } = await zoho.haalToegang();

  // Agents ophalen voor naam-lookup
  const agentsRes = await zoho.verzoek('/agents?limit=50', { token, orgId });
  const agentsData = await agentsRes.json();
  const agentMap = {};
  for (const a of agentsData.data || []) {
    agentMap[a.id] = agentNaam(a);
  }

  // Stap 1: alle tickets ophalen via paginering (max 6 pagina's = 600 tickets)
  // Paginering zonder statusType filter (Zoho filtert custom statuses er anders uit)
  // Zodra een pagina 0 relevante tickets oplevert EN de vorige pagina ook 0 had, stoppen we vroeg.
  let allRaw = [];
  let emptyRelevantPages = 0;
  for (let from = 0; from < 600; from += 100) {
    const res  = await zoho.verzoek(`/tickets?limit=100&from=${from}`, { token, orgId });
    if (!res.ok) {
      const errBody = await leesJsonVeilig(res);
      throw new Error(`Zoho tickets-ophalen mislukt (${res.status}): ${JSON.stringify(errBody)}`);
    }
    const data = await leesJsonVeilig(res);
    const page = data.data || [];
    const relevantOnPage = page.filter(t => RELEVANT.includes(t.status)).length;
    allRaw = allRaw.concat(page);
    if (page.length < 100) break; // laatste pagina
    if (relevantOnPage === 0) {
      emptyRelevantPages++;
      if (emptyRelevantPages >= 2) break; // 2 lege pagina's op rij → stoppen
    } else {
      emptyRelevantPages = 0;
    }
  }

  // Stap 2: filteren op relevante statussen
  const relevantIds = allRaw
    .filter(t => RELEVANT.includes(t.status))
    .map(t => t.id);

  // Stap 3: individueel ophalen voor cf custom fields (in batches van 5 om rate limiting te vermijden)
  const detailed = [];
  for (let i = 0; i < relevantIds.length; i += 5) {
    const batch = relevantIds.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async id => {
        const res = await zoho.verzoek(`/tickets/${id}`, { token, orgId });
        if (!res.ok) {
          const errBody = await leesJsonVeilig(res);
          throw new Error(`Zoho ticketdetail ${id} mislukt (${res.status}): ${JSON.stringify(errBody)}`);
        }
        return leesJsonVeilig(res);
      })
    );
    detailed.push(...results);
  }

  const map = mapTicket(agentMap);
  return {
    tickets:        detailed.filter(t => STATUS_TE_PLANNEN.includes(t.status)).map(map),
    pendingTickets: detailed.filter(t => STATUS_PENDING.includes(t.status)).map(map),
    plannedTickets: detailed.filter(t => STATUS_GEPLAND.includes(t.status)).map(map),
  };
}
