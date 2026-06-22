// /api/tickets
// Haalt tickets op uit Zoho Desk op basis van status.
// Te plannen:  Wachten op planning / Wachten op bevestiging planning
// Gepland:     Geplande support

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK = 'https://desk.zoho.eu/api/v1';

// Token cache — blijft geldig binnen dezelfde warm Lambda instance
let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type:    'refresh_token',
  });
  const res = await fetch(ZOHO_ACCOUNTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh mislukt: ' + JSON.stringify(data));
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 55 * 60 * 1000; // 55 minuten
  return cachedToken;
}

function buildAddress(obj) {
  if (!obj) return '';
  const parts = [obj.street, obj.city, obj.zip, obj.country].filter(Boolean);
  return parts.join(', ');
}

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const accessToken = await getAccessToken();

    const orgRes = await fetch(`${ZOHO_DESK}/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const orgData = await orgRes.json();
    const orgId = orgData.data?.[0]?.id;
    if (!orgId) throw new Error('Zoho Desk org ID niet gevonden');

    const params = new URLSearchParams({ limit: '100' });
    const res = await fetch(`${ZOHO_DESK}/tickets?${params}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
    });
    const raw = await res.json();
    const all = raw.data || [];

    const mapTicket = t => {
      // Adres: eerst contact, dan account, dan custom fields als fallback
      const contactAddr = buildAddress(t.contact);
      const accountAddr = buildAddress(t.account);
      const cf = t.cf || {};
      const cfAddr = cf.cf_adres || cf.cf_adres1 || cf.cf_adres_eindklant || cf.cf_address
                  || cf.cf_locatie || cf.cf_site_address || cf.cf_installatieadres
                  // Zoho genereert soms een hash-suffix op de veldnaam
                  || Object.entries(cf).find(([k]) => k.toLowerCase().includes('adres'))?.[1]
                  || '';
      const address = contactAddr || accountAddr || cfAddr;

      return {
        id:          t.id,
        number:      t.ticketNumber,
        subject:     t.subject || '',
        status:      t.status || '',
        priority:    t.priority || '',
        contact:     t.contact?.fullName || '',
        email:       t.contact?.email || '',
        phone:       t.contact?.phone || t.contact?.mobile || '',
        account:     t.account?.accountName || '',
        address,
        hasAddress:  !!address,
        dueDate:     t.dueDate || null,
        createdTime: t.createdTime || null,
        _cf:         t.cf || {},  // tijdelijk: voor debuggen van veldnamen
      };
    };

    const TO_PLAN = ['Wachten op planning', 'Wachten op bevestiging planning'];
    const tickets        = all.filter(t => TO_PLAN.includes(t.status)).map(mapTicket);
    const plannedTickets = all.filter(t => t.status === 'Geplande support').map(mapTicket);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ tickets, plannedTickets }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
