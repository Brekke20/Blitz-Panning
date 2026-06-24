// /api/debug-ticket?id=TICKET_ID
// Tijdelijk: toont raw Zoho response voor één ticket

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
  const res  = await fetch(ZOHO_ACCOUNTS, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh mislukt');
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const ticketId = event.queryStringParameters?.id;
    if (!ticketId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id param verplicht' }) };

    const accessToken = await getAccessToken();
    const orgRes  = await fetch(`${ZOHO_DESK}/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const orgData = await orgRes.json();
    const orgId   = orgData.data?.[0]?.id;

    const ticketRes  = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
    });
    const ticketData = await ticketRes.json();

    // Volledige raw response — enkel voor lokaal debuggen
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(ticketData, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
