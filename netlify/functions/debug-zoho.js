// Tijdelijk debug endpoint — eenmalig gebruiken om Zoho email-config te inspecteren
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
  if (!data.access_token) throw new Error('Token mislukt: ' + JSON.stringify(data));
  return data.access_token;
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  try {
    const accessToken = await getAccessToken();
    const orgRes  = await fetch(`${ZOHO_DESK}/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const orgData = await orgRes.json();
    const orgId   = orgData.data?.[0]?.id;

    // Departments ophalen
    const deptRes  = await fetch(`${ZOHO_DESK}/departments`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId } });
    const deptData = await deptRes.json();

    // EmailAddresses ophalen
    const emailRes  = await fetch(`${ZOHO_DESK}/emailAddresses`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId } });
    const emailData = await emailRes.json();

    // Ticket departmentId ophalen
    const ticketRes  = await fetch(`${ZOHO_DESK}/tickets/157486000010733050`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId } });
    const ticketData = await ticketRes.json();

    // Patch testticket channel naar EMAIL
    const patchRes = await fetch(`${ZOHO_DESK}/tickets/157486000010733050`, {
      method: 'PATCH',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'EMAIL' }),
    });
    const patchData = await patchRes.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ patchStatus: patchRes.status, patchData }, null, 2),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
