const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';
let cachedToken = null, tokenExpiry = 0;
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const params = new URLSearchParams({ refresh_token: process.env.ZOHO_REFRESH_TOKEN, client_id: process.env.ZOHO_CLIENT_ID, client_secret: process.env.ZOHO_CLIENT_SECRET, grant_type: 'refresh_token' });
  const res = await fetch(ZOHO_ACCOUNTS, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh mislukt');
  cachedToken = data.access_token; tokenExpiry = Date.now() + 55*60*1000;
  return cachedToken;
}
export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const token = await getAccessToken();
    const orgRes = await fetch(`${ZOHO_DESK}/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
    const { data: orgs } = await orgRes.json();
    const orgId = orgs?.[0]?.id;
    const r = await fetch(`${ZOHO_DESK}/agents?limit=50`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId } });
    const d = await r.json();
    return { statusCode: 200, headers, body: JSON.stringify({ agents: d.data?.map(a => ({ id: a.id, name: a.name || a.fullName, email: a.emailId || a.email })), raw_keys: d.data?.[0] ? Object.keys(d.data[0]) : [], error: d.errorCode }, null, 2) };
  } catch(e) { return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }; }
}
