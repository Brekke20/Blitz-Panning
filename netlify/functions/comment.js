// /api/comment
// Updates the "resolution" field on a Zoho Desk ticket.
// POST body: { ticketId, content }

import { isTestVerzoek, nepZohoAntwoord } from '../lib/testmodus.js';
import { maakZoho, leesJsonVeilig } from '../lib/zoho.js';
import { CORS_V1, v1Json, v1Methode } from '../lib/http.js';

// Instantie op moduleniveau: de tokencache (55 min) leeft zolang de functie warm is.
const zoho = maakZoho({ orgFoutTekst: 'Could not find Zoho Desk org ID' });

export async function handler(event) {
  const methode = v1Methode(event, ['POST'], CORS_V1);
  if (methode) return methode;

  try {
    const { ticketId, content } = JSON.parse(event.body || '{}');
    if (!ticketId || !content?.trim()) {
      return v1Json(400, { error: 'ticketId and content required' }, CORS_V1);
    }
    if (!/^\d+$/.test(String(ticketId))) {
      return v1Json(400, { error: 'Invalid ticketId' }, CORS_V1);
    }

    // Testmodus: nooit naar Zoho schrijven, meteen nep-succes
    if (isTestVerzoek(event)) {
      return v1Json(200, nepZohoAntwoord({ success: true }), CORS_V1);
    }

    const { token, orgId } = await zoho.haalToegang();

    // PATCH the resolution field on the ticket
    const patchRes = await zoho.verzoek(`/tickets/${ticketId}`, {
      token, orgId, methode: 'PATCH', json: { resolution: content.trim() },
    });

    // Zoho geeft soms een lege body terug (204 of leeg 200): veilig parsen, succes volgt res.ok
    const patchData = await leesJsonVeilig(patchRes);
    if (!patchRes.ok) throw new Error(`Zoho fout (${patchRes.status}): ${JSON.stringify(patchData)}`);

    return v1Json(200, { success: true }, CORS_V1);
  } catch (err) {
    return v1Json(500, { error: err.message }, CORS_V1);
  }
}
