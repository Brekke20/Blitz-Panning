// Tijdelijke diagnostics — toont ruwe Zoho ticket statussen
const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';

async function getAccessToken() {
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type:    'refresh_token',
  });
  const res  = await fetch(ZOHO_ACCOUNTS, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh mislukt: ' + JSON.stringify(data));
  return data.access_token;
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const token = await getAccessToken();

    const orgRes  = await fetch(`${ZOHO_DESK}/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const orgData = await orgRes.json();
    const orgId   = orgData.data?.[0]?.id;
    if (!orgId) throw new Error('Geen orgId: ' + JSON.stringify(orgData));

    // Eerste pagina tickets, geen filter
    const tickRes  = await fetch(`${ZOHO_DESK}/tickets?limit=50&from=0`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId } });
    const tickData = await tickRes.json();
    const statuses = [...new Set((tickData.data || []).map(t => t.status))];
    const sample   = (tickData.data || []).slice(0, 5).map(t => ({ id: t.id, status: t.status, subject: t.subject?.slice(0, 40) }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ orgId, totalFetched: (tickData.data || []).length, uniqueStatuses: statuses, sample, zohoError: tickData.errorCode }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
