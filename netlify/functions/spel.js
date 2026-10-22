// /api/spel — de voortgang van het verborgen spel "Blitz Run", gebonden aan het ACCOUNT (blob `spel/<gebruikers-id>`, store van het verzoek).
//   GET                         -> 200 { besteScore, ontgrendeld: string[], gekozenSkin }  (het eigen record, aangevuld met wat nu ontgrendeld is)
//   POST { score, gekozenSkin? } -> 200 { besteScore, ontgrendeld, gekozenSkin }; de server bewaart de hoogste score, ontgrendelt score-skins
//        volgens dezelfde drempels als de client en themaskins enkel als hun thema (uit `themas/index`) op de serverdatum actief is.
//        400: onleesbare JSON of een score buiten 0..MAX_SCORE. Een onbekende of vergrendelde skin weigert de score NOOIT: de skin-keuze wordt genegeerd
//        en het antwoord bevat dan `skinGeweigerd: true`.
// Enkel het EIGEN record: de sleutel komt altijd uit de sessie (gebruiker.id), nooit uit het verzoek. Geen Zoho, geen TomTom, geen mail.
// `themaBron(store, datum)` -> Promise<{ skins, actieveThemaIds }> is injecteerbaar; de standaard (`leesThemaBron` in netlify/lib/spel.js) leest
// de themas-index uit dezelfde store en zaait de voorgeladen themas als dat nog niet gebeurde (datum = serverdatum in Europe/Brussels).
// Een themaskin die bij een GET nieuw open is, wordt meteen bewaard (best-effort). Een mislukte bron telt als "geen themas": de score blijft werken.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { winkelNaam } from '../lib/testmodus.js';
import { OPSLAG_STORING } from '../lib/auth-antwoord.js';
import { leesSpel, bewaarSpel, valideerInzending, leesThemaBron, normaliseerBron, LEGE_BRON } from '../lib/spel.js';
import { datumBrussel } from '../../public/js/spel/spel-regels.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, POST, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export const MAX_BODY = 2048; // een inzending is een paar tientallen bytes; alles boven 2 kB is geen spel

export function maakHandler({ getStore: haalStore, nu = () => Date.now(), auth, themaBron = leesThemaBron } = {}) {
  // De themas voor dit verzoek (de datum is die van Brussel, YYYY-MM-DD). Faalt de bron, dan telt dit verzoek als "geen themas":
  // een bewaarde themaskin blijft in het record (zie netlify/lib/spel.js), enkel nieuwe themaskins gaan dan niet open.
  const bronNu = async (store) => {
    try { return normaliseerBron(await themaBron(store, datumBrussel(nu()))); } catch (e) {
      console.error('spel: themas niet gelezen (' + (e?.name || 'Error') + ')');
      return LEGE_BRON;
    }
  };

  const kern = async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const store = await haalStore({ name: winkelNaam(req), consistency: 'strong' });
      if (req.method === 'GET') return json(200, await leesSpel(store, gebruiker.id, await bronNu(store)));
      const lengte = Number(req.headers.get('content-length') || 0);
      if (lengte > MAX_BODY) return json(413, { error: 'Verzoek te groot.' });
      let body;
      let tekst = '';
      try { tekst = await req.text(); } catch { return json(400, { error: 'Ongeldige JSON' }); }
      if (tekst.length > MAX_BODY) return json(413, { error: 'Verzoek te groot.' }); // ook zonder content-length-kop
      try { body = JSON.parse(tekst); } catch { return json(400, { error: 'Ongeldige JSON' }); }
      const bron = await bronNu(store);
      const inzending = valideerInzending(body, bron.skins);
      if (inzending.fout) return json(400, { error: inzending.fout });
      const r = await bewaarSpel(store, gebruiker.id, inzending, { bron, nu });
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
