// /api/plan-datum
// Stelt de geplande datum/tijd in op een Zoho-ticket (geen e-mail).
// POST body: { ticketId, utcInterventieDatum }   (volledige ISO-string in UTC)
// Schrijft naar het cf_interventie_datm custom field (niet Zoho's dueDate).

import { isTestVerzoek, nepZohoAntwoord } from '../lib/testmodus.js';
import { maakZoho } from '../lib/zoho.js';
import { maakCors, v2Json, v2Methode } from '../lib/http.js';
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { logVoorVerzoek } from '../lib/activiteit.js';
import { eisEigenTicket } from '../lib/eigen-ticket.js';
import { datumInBrussel } from '../lib/bevestigingslink.js';

// Instantie op moduleniveau: de tokencache (55 min) leeft zolang de functie warm is.
const zoho = maakZoho();

const CORS = maakCors({ methoden: 'POST, OPTIONS', headers: 'Content-Type' });

const kern = async (req, context, gebruiker, haalStore = getStore) => {
  const methode = v2Methode(req, ['POST'], CORS);
  if (methode) return methode;

  let body;
  try { body = await req.json(); }
  catch { return v2Json(400, { error: 'Ongeldige JSON' }, CORS); }

  const { ticketId, utcInterventieDatum } = body;
  if (!ticketId || !utcInterventieDatum) {
    return v2Json(400, { error: 'ticketId en utcInterventieDatum zijn verplicht' }, CORS);
  }
  if (!/^\d+$/.test(String(ticketId))) {
    return v2Json(400, { error: 'Ongeldig ticketId' }, CORS);
  }

  // Testmodus: nooit naar Zoho schrijven, meteen nep-succes
  if (isTestVerzoek(req)) {
    return v2Json(200, nepZohoAntwoord({ interventieDatum: utcInterventieDatum }), CORS);
  }

  try {
    const { token, orgId } = await zoho.haalToegang();

    // Een technieker met "Mag zelf plannen" wijzigt enkel de datum/tijd van zijn eigen tickets.
    const eis = await eisEigenTicket({ gebruiker, ticketId, zoho, toegang: { token, orgId } });
    if (!eis.ok) return v2Json(eis.status, eis.body, CORS);

    const patchRes = await zoho.verzoek(`/tickets/${ticketId}`, {
      token, orgId, methode: 'PATCH', json: { cf: { cf_interventie_datm: utcInterventieDatum } },
    });
    if (!patchRes.ok) {
      const txt = await patchRes.text();
      throw new Error(`Zoho PATCH fout (${patchRes.status}): ${txt}`);
    }

    await logVoorVerzoek(req, gebruiker, {
      actie: 'plannen', onderwerp: String(ticketId), details: datumInBrussel(utcInterventieDatum) ?? String(utcInterventieDatum).slice(0, 10),
    }, { getStore: haalStore });
    return v2Json(200, { ok: true, interventieDatum: utcInterventieDatum }, CORS);
  } catch (err) {
    return v2Json(500, { error: err.message }, CORS);
  }
};

// getStore is een testnaad (enkel voor de activiteitenlog).
export const maakHandler = ({ getStore: haalStore } = {}) =>
  beveiligV2('plan-datum', (req, context, gebruiker) => kern(req, context, gebruiker, haalStore));

export default maakHandler();

export const config = { path: '/api/plan-datum' };
