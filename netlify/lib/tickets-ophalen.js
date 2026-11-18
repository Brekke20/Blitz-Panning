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

// Ticketlijst: hoogstens 31 pagina's van 100 (Zoho's lijst telde er 911 op 2026-11-18); na pagina 0 drie tegelijk.
const MAX_PAGINAS = 31;
const PARALLEL    = 3;

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

  // Stap 1: de VOLLEDIGE ticketlijst ophalen, tot de laatste (kortere) pagina.
  // Paginering zonder statusType filter (Zoho filtert custom statuses er anders uit); de zoek-API mag de token niet.
  // Nooit vroeg stoppen op "pagina's zonder relevante tickets": Zoho sorteert op klantactiviteit, dus een gepland
  // ticket waar lang niets op gebeurde zakt diep weg (#3586 stond op plaats ±492 en viel zo uit de planning).
  // Pagina 0 eerst, daarna PARALLEL pagina's tegelijk; een kortere pagina is de laatste.
  const haalPagina = async from => {
    const res  = await zoho.verzoek(`/tickets?limit=100&from=${from}`, { token, orgId });
    if (!res.ok) {
      const errBody = await leesJsonVeilig(res);
      throw new Error(`Zoho tickets-ophalen mislukt (${res.status}): ${JSON.stringify(errBody)}`);
    }
    const data = await leesJsonVeilig(res);
    return data.data || [];
  };
  let allRaw = await haalPagina(0);
  let laatsteVol = allRaw.length >= 100;
  for (let from = 100; laatsteVol && from < MAX_PAGINAS * 100; from += PARALLEL * 100) {
    const vanaf = Array.from({ length: PARALLEL }, (_, i) => from + i * 100).filter(f => f < MAX_PAGINAS * 100);
    const paginas = await Promise.all(vanaf.map(haalPagina));
    for (const page of paginas) {
      if (!laatsteVol) break; // na een kortere pagina is de rest leeg
      allRaw = allRaw.concat(page);
      laatsteVol = page.length >= 100;
    }
  }
  if (laatsteVol) {
    console.warn(`tickets-ophalen: grens van ${MAX_PAGINAS * 100} tickets bereikt; tickets verder in de Zoho-lijst ontbreken mogelijk`);
  }

  // Stap 2: filteren op relevante statussen, ontdubbeld (de grens tussen pagina 0 en 1 overlapt in Zoho met één ticket)
  const relevantIds = [...new Set(allRaw
    .filter(t => RELEVANT.includes(t.status))
    .map(t => t.id))];

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
