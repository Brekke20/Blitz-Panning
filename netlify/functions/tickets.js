// /api/tickets
// Fetches open tickets assigned to the current user from Zoho Desk.
// Refreshes the access token automatically using the stored refresh token.

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
  if (!data.access_token) throw new Error('Failed to refresh access token: ' + JSON.stringify(data));
  return data.access_token;
}

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const accessToken = await getAccessToken();

    // Get org ID first
    const orgRes = await fetch(`${ZOHO_DESK}/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const orgData = await orgRes.json();
    const orgId = orgData.data?.[0]?.id;
    if (!orgId) throw new Error('Could not find Zoho Desk org ID');

    // Fetch tickets - no status/assignee filter so we get everything visible to this user
    const params = new URLSearchParams({
      limit: '100',
      fields: 'id,ticketNumber,subject,status,priority,contact,account,description,createdTime,dueDate,cf',
    });

    const ticketsRes = await fetch(`${ZOHO_DESK}/tickets?${params}`, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        orgId,
      },
    });
    const ticketsData = await ticketsRes.json();

    // Extract tickets with address info
    const tickets = (ticketsData.data || []).map(ticket => ({
      id: ticket.id,
      number: ticket.ticketNumber,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      contact: ticket.contact?.fullName || '',
      account: ticket.account?.accountName || '',
      // Address may be in custom fields or account address
      address: ticket.cf?.cf_address || ticket.cf?.cf_locatie || ticket.cf?.cf_site_address || '',
      description: ticket.description || '',
      createdTime: ticket.createdTime,
      dueDate: ticket.dueDate,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ tickets, orgId }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
