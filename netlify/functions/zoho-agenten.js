// /api/zoho-agenten — GET (enkel beheerder, enkel lezen): de actieve agenten van Zoho Desk, voor de keuzelijst "Zoho-naam" in
// Beheer, Gebruikers.
//   200 { agenten: [{ naam }] }   enkel de weergavenaam, zoals de ticketlijst die als assignee toont (netlify/lib/zoho-agenten.js)
//   503 { error, code: 'zoho-storing' }   Zoho niet bereikbaar: het scherm valt terug op een vrij tekstveld
// De lijst wordt 10 minuten in het geheugen van de instantie onthouden (een fout nooit). Een testverzoek (X-Blitz-Test) roept
// Zoho NOOIT aan en krijgt een vaste nep-lijst.
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { isTestVerzoek } from '../lib/testmodus.js';
import { maakZoho } from '../lib/zoho.js';
import { haalActieveAgentNamen } from '../lib/zoho-agenten.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));
const BEWAAR_MS = 10 * 60 * 1000;
const NEP_NAMEN = ['Roel', 'Sven Peeters', 'Tim'];
const ZOHO_STORING = { error: 'Zoho is tijdelijk niet bereikbaar.', code: 'zoho-storing' };

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function maakHandler({ zoho = maakZoho({ tokenFoutMetData: false }), nu = () => Date.now(), auth } = {}) {
  let bewaard = null; // { tot, namen }
  const kern = async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (isTestVerzoek(req)) return json(200, { agenten: NEP_NAMEN.map(naam => ({ naam })) });
    try {
      if (!bewaard || nu() >= bewaard.tot) {
        bewaard = { tot: nu() + BEWAAR_MS, namen: await haalActieveAgentNamen(zoho) };
      }
      return json(200, { agenten: bewaard.namen.map(naam => ({ naam })) });
    } catch (e) {
      bewaard = null;
      console.error('zoho-agenten: ophalen mislukt (' + (e?.name || 'Error') + ')'); // geen Zoho-details in het log of antwoord
      return json(503, ZOHO_STORING);
    }
  };
  return beveiligV2('zoho-agenten', kern, auth ? { auth } : undefined);
}

export default maakHandler();

export const config = { path: '/api/zoho-agenten' };
