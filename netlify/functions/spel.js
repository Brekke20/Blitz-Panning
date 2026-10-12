// /api/spel — de voortgang van het verborgen spel "Blitz Run", gebonden aan het ACCOUNT (blob `spel/<gebruikers-id>`, store van het verzoek).
//   GET                         -> 200 { besteScore, ontgrendeld: string[], gekozenSkin }  (het eigen record, aangevuld met wat nu ontgrendeld is)
//   POST { score, gekozenSkin? } -> 200 { besteScore, ontgrendeld, gekozenSkin }; de server bewaart de hoogste score, ontgrendelt score-skins
//        volgens dezelfde drempels als de client en event-skins enkel als dat event op de serverdatum actief is.
//        400: onleesbare JSON, een score buiten 0..MAX_SCORE, een onbekende of nog vergrendelde skin.
// Enkel het EIGEN record: de sleutel komt altijd uit de sessie (gebruiker.id), nooit uit het verzoek. Geen Zoho, geen TomTom, geen mail.
// `actieveEvenementen(datum)` -> [{ id, spelSkin? }] is injecteerbaar: de standaard geeft geen enkel event. Na het samenvoegen met
// feat/event-ui-halloween wordt hier `actieveEvenementen` uit public/js/kern/evenementen.js ingevuld (zie de aanduiding hieronder).
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { winkelNaam } from '../lib/testmodus.js';
import { OPSLAG_STORING } from '../lib/auth-antwoord.js';
import { leesSpel, bewaarSpel, valideerInzending } from '../lib/spel.js';
import { datumBrussel } from '../../public/js/spel/spel-regels.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, POST, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

// AANSLUITING NA DE MERGE met feat/event-ui-halloween: vervang de standaard door
//   import { actieveEvenementen } from '../../public/js/kern/evenementen.js';   en   maakHandler({ getStore, actieveEvenementen })
const GEEN_EVENEMENTEN = () => [];

export function maakHandler({ getStore: haalStore, nu = () => Date.now(), auth, actieveEvenementen = GEEN_EVENEMENTEN } = {}) {
  const evenementenNu = () => {
    try { const lijst = actieveEvenementen(datumBrussel(nu())); return Array.isArray(lijst) ? lijst : []; } catch { return []; }
  };

  const kern = async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const store = await haalStore({ name: winkelNaam(req), consistency: 'strong' });
      if (req.method === 'GET') return json(200, await leesSpel(store, gebruiker.id, evenementenNu()));
      let body;
      try { body = await req.json(); } catch { return json(400, { error: 'Ongeldige JSON' }); }
      const inzending = valideerInzending(body);
      if (inzending.fout) return json(400, { error: inzending.fout });
      const r = await bewaarSpel(store, gebruiker.id, inzending, { evenementen: evenementenNu(), nu });
      if (!r.ok) return json(400, { error: r.fout });
      return json(200, r.voortgang);
    } catch (e) {
      // Alleen het fouttype loggen: een Blobs-fout kan details bevatten. Fail closed.
      console.error('spel: opslag mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('spel', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/spel' };
