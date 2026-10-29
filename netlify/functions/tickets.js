// /api/tickets
// Haalt tickets op uit Zoho Desk op basis van status (zie netlify/lib/tickets-ophalen.js).

import { maakZoho } from '../lib/zoho.js';
import { haalTickets } from '../lib/tickets-ophalen.js';
import { CORS_V1 } from '../lib/http.js';
import { beveiligV1 } from '../lib/beveiligd.js';
import { alsV2 } from '../lib/v2-adapter.js';

// Instantie op moduleniveau: de tokencache (55 min) leeft zolang de functie warm is.
const zoho = maakZoho({ orgFoutTekst: 'Zoho Desk org ID niet gevonden' });

async function kern(event, context, gebruiker) {
  const headers = { ...CORS_V1 };

  try {
    const body = await haalTickets(zoho);
    return { statusCode: 200, headers, body: JSON.stringify(body) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}

export default alsV2(beveiligV1('tickets', kern));
