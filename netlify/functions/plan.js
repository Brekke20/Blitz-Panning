// /api/plan
// Zet een ticket op de planning (status + dueDate) of haal het eraf.
// POST body:
//   { ticketId: "...", date: "2026-06-23" }   → Wachten op bevestiging planning
//   { ticketId: "...", date: null }            → Service in te plannen

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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { ticketId, date } = JSON.parse(event.body || '{}');
    if (!ticketId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId verplicht' }) };
    }

    const accessToken = await getAccessToken();

    // Org ID ophalen
    const orgRes  = await fetch(`${ZOHO_DESK}/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const orgData = await orgRes.json();
    const orgId   = orgData.data?.[0]?.id;
    if (!orgId) throw new Error('Zoho org ID niet gevonden');

    // Bepaal patch body
    let patch;
    if (date) {
      // Inplannen: ISO datetime die Zoho verwacht
      patch = {
        status:  'Wachten op bevestiging planning',
        dueDate: `${date}T00:00:00.000Z`,
      };
    } else {
      // Uit planning halen → terug naar "Wachten op planning" (werkelijke Zoho statusnaam)
      patch = {
        status:  'Wachten op planning',
        dueDate: '',
      };
    }

    const patchRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
      method:  'PATCH',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    });

    // Zoho geeft soms een lege body terug (204 of leeg 200) — veilig parsen
    let patchData = {};
    const rawBody = await patchRes.text();
    if (rawBody) {
      try { patchData = JSON.parse(rawBody); } catch (_) { /* lege of non-JSON body */ }
    }

    if (!patchRes.ok) {
      throw new Error(`Zoho fout (${patchRes.status}): ${JSON.stringify(patchData)}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ticketId, date: date || null }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
