// /api/comment
// Updates the "resolution" field on a Zoho Desk ticket.
// POST body: { ticketId, content }

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK = 'https://desk.zoho.eu/api/v1';

async function getAccessToken() {
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(ZOHO_ACCOUNTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  return data.access_token;
}

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { ticketId, content } = JSON.parse(event.body || '{}');
    if (!ticketId || !content?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId and content required' }) };
    }

    const accessToken = await getAccessToken();

    const orgRes = await fetch(`${ZOHO_DESK}/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const orgData = await orgRes.json();
    const orgId = orgData.data?.[0]?.id;
    if (!orgId) throw new Error('Could not find Zoho Desk org ID');

    // PATCH the resolution field on the ticket
    const patchRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ resolution: content.trim() }),
    });

    const patchData = await patchRes.json();
    if (!patchRes.ok) throw new Error(JSON.stringify(patchData));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
