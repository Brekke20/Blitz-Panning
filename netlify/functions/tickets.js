// /api/tickets
// Haalt tickets op uit Zoho Desk op basis van status.
//
// Statussen:
//   Service in te plannen           → moet nog ingepland worden
//   Wachten op bevestiging planning → op kalender gezet, wacht op klantbevestiging
//   Geplande service                → klant bevestigd, definitief

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';

let cachedToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type:    'refresh_token',
  });
  const res  = await fetch(ZOHO_ACCOUNTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh mislukt: ' + JSON.stringify(data));
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  try {
    const accessToken = await getAccessToken();

    const orgRes  = await fetch(`${ZOHO_DESK}/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const orgData = await orgRes.json();
    const orgId   = orgData.data?.[0]?.id;
    if (!orgId) throw new Error('Zoho Desk org ID niet gevonden');

    // Stap 1: per status ophalen (voorkomt dat tickets buiten de top-100 gemist worden)
    const RELEVANT = [
      'Service in te plannen',
      'Wachten op bevestiging planning',
      'Geplande service',
    ];

    const listsPerStatus = await Promise.all(
      RELEVANT.map(status =>
        fetch(`${ZOHO_DESK}/tickets?limit=100&status=${encodeURIComponent(status)}`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
        }).then(r => r.json())
      )
    );

    const relevantIds = listsPerStatus
      .flatMap(d => d.data || [])
      .map(t => t.id)
      // dedupliceer (voor het geval een ticket in meerdere resultaten zit)
      .filter((id, i, arr) => arr.indexOf(id) === i);

    // Stap 2: individueel ophalen voor cf custom fields
    const detailed = await Promise.all(
      relevantIds.map(id =>
        fetch(`${ZOHO_DESK}/tickets/${id}`, {
          headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
        }).then(r => r.json())
      )
    );

    const mapTicket = t => {
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
        assignee:          t.assignee?.fullName || t.assignee?.name || '',
        contact:           t.contact?.fullName  || '',
        email:             t.contact?.email     || t.email  || '',
        phone:             t.contact?.phone     || t.contact?.mobile || t.phone || '',
        account:           t.account?.accountName || '',
        address,
        hasAddress:        !!address,
        naamEindklant:     cf.cf_naam_eindklant       || '',
        emailEindklant:    cf.cf_e_mail_eindklant     || '',
        telefoonEindklant: cf.cf_telefoon_eindklant   || '',
        serienummer:       cf.cf_serienummer          || '',
        partner:           cf.cf_partner_installateur || '',
        probleemtype:      cf.cf_probleemtype         || '',
        regio:             cf.cf_regio                || '',
        dueDate:           t.dueDate     || null,
        createdTime:       t.createdTime || null,
      };
    };

    const tickets        = detailed.filter(t => t.status === 'Service in te plannen').map(mapTicket);
    const pendingTickets = detailed.filter(t => t.status === 'Wachten op bevestiging planning').map(mapTicket);
    const plannedTickets = detailed.filter(t => t.status === 'Geplande service').map(mapTicket);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ tickets, pendingTickets, plannedTickets }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
