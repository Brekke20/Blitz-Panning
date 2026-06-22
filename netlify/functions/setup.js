// /api/setup?code=GRANT_CODE
// Exchanges a Zoho Self Client grant code for a refresh token.
// Run this ONCE after deploying. Store the returned refresh_token as ZOHO_REFRESH_TOKEN env var.

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const code = event.queryStringParameters?.code;
  if (!code) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing ?code= parameter' }),
    };
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET not set in Netlify env vars' }),
    };
  }

  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: 'https://desk.zoho.com',
    scope: 'Desk.tickets.READ,Desk.contacts.READ,Desk.basic.READ,Desk.accounts.READ',
  });

  const response = await fetch('https://accounts.zoho.eu/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const data = await response.json();

  if (data.error) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: data.error, detail: data }),
    };
  }

  // Return only what's needed — never log the full token in prod
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      message: 'Success! Copy the refresh_token below and add it as ZOHO_REFRESH_TOKEN in Netlify env vars.',
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    }),
  };
}
