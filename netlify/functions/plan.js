// /api/plan
// Zet een ticket op de planning (status + interventieDatum) of haal het eraf.
// POST body:
//   { ticketId: "...", date: "2026-06-23", utcInterventieDatum: "..." }   → Wachten op bevestiging planning
//   { ticketId: "...", date: null }                                       → Service in te plannen

import { isTestVerzoek, nepZohoAntwoord } from '../lib/testmodus.js';
import { maakZoho, leesJsonVeilig } from '../lib/zoho.js';
import { CORS_V1, v1Json, v1Methode } from '../lib/http.js';
import { beveiligV1 } from '../lib/beveiligd.js';

// Instantie op moduleniveau: de tokencache (55 min) leeft zolang de functie warm is.
const zoho = maakZoho();

async function kern(event, context, gebruiker) {
  const methode = v1Methode(event, ['POST'], CORS_V1);
  if (methode) return methode;

  try {
    const { ticketId, date, utcInterventieDatum } = JSON.parse(event.body || '{}');
    if (!ticketId) {
      return v1Json(400, { error: 'ticketId verplicht' }, CORS_V1);
    }
    if (!/^\d+$/.test(String(ticketId))) {
      return v1Json(400, { error: 'Ongeldig ticketId' }, CORS_V1);
    }

    // Testmodus: nooit naar Zoho schrijven, meteen nep-succes
    if (isTestVerzoek(event)) {
      return v1Json(200, nepZohoAntwoord({ success: true, ticketId, date: date || null }), CORS_V1);
    }

    const { token, orgId } = await zoho.haalToegang();

    // Bepaal patch body
    let patch;
    if (date) {
      // Inplannen: Zoho custom Date/Time-velden verwachten geldige ISO8601
      // (bv. "2025-12-01T10:00:00.000Z"), genest onder "cf". utcInterventieDatum
      // komt van de client als DST-correcte UTC-omzetting van lokale middernacht
      // (new Date(`${date}T00:00:00`).toISOString()).
      patch = {
        status: 'Wachten op bevestiging planning',
        cf:     { cf_interventie_datm: utcInterventieDatum || `${date}T00:00:00.000Z` },
      };
    } else {
      // Uit planning halen → terug naar "Wachten op planning" (werkelijke Zoho statusnaam)
      patch = {
        status: 'Wachten op planning',
        cf:     { cf_interventie_datm: '' },
      };
    }

    const patchRes = await zoho.verzoek(`/tickets/${ticketId}`, { token, orgId, methode: 'PATCH', json: patch });

    // Zoho geeft soms een lege body terug (204 of leeg 200) — veilig parsen
    const patchData = await leesJsonVeilig(patchRes);

    if (!patchRes.ok) {
      throw new Error(`Zoho fout (${patchRes.status}): ${JSON.stringify(patchData)}`);
    }

    return v1Json(200, { success: true, ticketId, date: date || null }, CORS_V1);
  } catch (err) {
    return v1Json(500, { error: err.message }, CORS_V1);
  }
}

export const handler = beveiligV1('plan', kern);
