// /api/plan-datum
// Stelt de geplande datum/tijd in op een Zoho-ticket (geen e-mail).
// POST body: { ticketId, utcDueDate }   (utcDueDate = volledige ISO-string in UTC)
// Zet status op "Wachten op bevestiging planning" als die nog niet zo staat.

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
  const res  = await fetch(ZOHO_ACCOUNTS, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh mislukt: ' + JSON.stringify(data));
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

export default async (req, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST')   return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

  const { ticketId, utcDueDate } = body;
  if (!ticketId || !utcDueDate) {
    return new Response(JSON.stringify({ error: 'ticketId en utcDueDate zijn verplicht' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const accessToken = await getAccessToken();
    const orgRes  = await fetch(`${ZOHO_DESK}/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
    const orgData = await orgRes.json();
    const orgId   = orgData.data?.[0]?.id;
    if (!orgId) throw new Error('Zoho org ID niet gevonden');

    const patchRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
      method:  'PATCH',
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ dueDate: utcDueDate }),
    });
    if (!patchRes.ok) {
      const txt = await patchRes.text();
      throw new Error(`Zoho PATCH fout (${patchRes.status}): ${txt}`);
    }

    return new Response(JSON.stringify({ ok: true, dueDate: utcDueDate }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

export const config = { path: '/api/plan-datum' };
