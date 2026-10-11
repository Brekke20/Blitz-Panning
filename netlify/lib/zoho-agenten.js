// Zoho-agenten: de naam van een agent zoals de ticketlijst die toont (assignee), en de lijst actieve agenten voor Beheer.
// De naam moet letterlijk overeenkomen met `assignee` van /api/tickets (anders klopt de koppeling met een account niet):
// tickets.js gebruikt dezelfde agentNaam.

export const agentNaam = (a) => String(a?.name || `${a?.firstName || ''} ${a?.lastName || ''}`).trim();

const PAGINA = 100;
const MAX_PAGINAS = 5; // 500 agenten is ruim genoeg; een vangnet tegen een eindeloze lus

// De namen (ontdubbeld, gesorteerd, zonder lege) van alle actieve agenten. Gooit bij een Zoho-fout (de aanroeper maakt er een 503 van).
export async function haalActieveAgentNamen(zoho) {
  const { token, orgId } = await zoho.haalToegang();
  const namen = new Set();
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const res = await zoho.verzoek(`/agents?status=ACTIVE&limit=${PAGINA}&from=${pagina * PAGINA}`, { token, orgId });
    if (!res.ok) throw new Error(`Zoho agents mislukt (${res.status})`);
    const data = await res.json();
    const lijst = Array.isArray(data?.data) ? data.data : [];
    for (const a of lijst) {
      const naam = agentNaam(a);
      if (naam) namen.add(naam);
    }
    if (lijst.length < PAGINA) break;
  }
  return [...namen].sort((a, b) => a.localeCompare(b, 'nl', { sensitivity: 'base' }));
}

// Vaste nep-lijst voor testverzoeken (X-Blitz-Test): Zoho wordt dan NOOIT aangeroepen. Zelfde lijst voor Beheer en het dashboard.
export const NEP_AGENT_NAMEN = Object.freeze(['Roel', 'Sven Peeters', 'Tim']);

const BEWAAR_MS = 10 * 60 * 1000;

// De lijst actieve agent-namen met een geheugencache (standaard 10 minuten) per instantie; een fout wordt nooit onthouden en gooit
// door. Gedeeld door /api/zoho-agenten en het dashboard, zodat het dashboard geen extra Zoho-aanroepen per verzoek doet.
export function maakAgentenCache({ zoho, nu = () => Date.now(), bewaarMs = BEWAAR_MS, haal = haalActieveAgentNamen } = {}) {
  let bewaard = null; // { tot, namen }
  return async function agentNamen() {
    if (!bewaard || nu() >= bewaard.tot) {
      try { bewaard = { tot: nu() + bewaarMs, namen: await haal(zoho) }; } catch (e) { bewaard = null; throw e; }
    }
    return bewaard.namen;
  };
}
