// /api/systeemstatus — GET (enkel beheerder):
//   { zoho: { ok, fout?, test?, tijdstip }, foutenlog: [{ tijdstip, ticketId, stap, fout }] (laatste 20),
//     rapporten: { mislukt: [{ id, ticketNumber, technieker, datum, laatsteFout }] } }
// Foutenlog en rapportlijst komen uit de store van het verzoek; een testverzoek roept Zoho NOOIT aan.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { maakZoho } from '../lib/zoho.js';
import { verzamelStatus } from '../lib/systeemstatus.js';
import { OPSLAG_STORING } from '../lib/auth-antwoord.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { ...CORS, 'Cache-Control': 'no-store' },
});

export function maakHandler({
  getStore: haalStore, nu = () => Date.now(), maakZoho: nieuweZoho = () => maakZoho({ tokenFoutMetData: false }), auth,
} = {}) {
  const kern = async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const test = isTestVerzoek(req);
      if (test) await zorgVoorTestkopie(haalStore);
      const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });
      return json(200, await verzamelStatus({ store, zoho: test ? null : nieuweZoho(), test, nu }));
    } catch (e) {
      console.error('systeemstatus: samenstellen mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('systeemstatus', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/systeemstatus' };
