// Tijdelijk: toont raw Zoho ticket list response met en zonder assignee=all
const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';

let cachedToken = null, tokenExpiry = 0;
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const params = new URLSearchParams({ refresh_token: process.env.ZOHO_REFRESH_TOKEN, client_id: process.env.ZOHO_CLIENT_ID, client_secret: process.env.ZOHO_CLIENT_SECRET, grant_type: 'refresh_token' });
  const res  = await fetch(ZOHO_ACCOUNTS, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh mislukt');
  cachedToken = data.access_token; tokenExpiry = Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const token = await getAccessToken();
    const orgRes = await fetch(`${ZOHO_DESK}/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const orgData = await orgRes.json();
    const orgId = orgData.data?.[0]?.id;

    const RELEVANT = ['Service in te plannen', 'Wachten op planning', 'Wachten op bevestiging planning', 'Geplande service', 'Geplande support'];

    // Haal eerste 100 tickets op
    const res = await fetch(`${ZOHO_DESK}/tickets?limit=100&from=0`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId } });
    const data = await res.json();
    const all = data.data || [];

    const statusTypeMap = {};
    const statusCounts = {};
    for (const t of all) {
      if (!statusTypeMap[t.status]) statusTypeMap[t.status] = t.statusType;
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    }

    // Test: hoeveel matchen de RELEVANT filter exact?
    const relevantTickets = all.filter(t => RELEVANT.includes(t.status));
    const relevantDetails = relevantTickets.map(t => ({
      id: t.id,
      status: t.status,
      statusLen: t.status?.length,
      statusHex: [...(t.status || '')].map(c => c.charCodeAt(0).toString(16)).join(' '),
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ orgId, total: all.length, statusTypeMap, statusCounts, relevantCount: relevantTickets.length, relevantDetails }, null, 2)
    };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
}
