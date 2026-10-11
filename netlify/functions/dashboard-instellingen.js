// /api/dashboard-instellingen — kleurgrenzen van de ringen in het performance-dashboard (enkel beheerder).
//   GET -> { versie, grenzen }   (zonder opgeslagen waarde: de standaardgrenzen, versie 0)
//   PUT { grenzen, versie } -> { versie } | 400 (ongeldige grenzen of versie) | 409 (oude versie)
// 409-antwoord: { error, serverVersie, data: { versie, grenzen } }, zodat bewaarMetVersie (kern/api.js) kan samenvoegen.
// Een falende opslag geeft 503 opslag-storing, nooit een 500.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { OPSLAG_STORING } from '../lib/auth-antwoord.js';
import { isTestVerzoek, winkelNaam, zorgVoorTestkopie } from '../lib/testmodus.js';
import { leesGrenzen, schrijfGrenzen } from '../lib/dashboard-bronnen.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, PUT, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function maakHandler({ getStore: haalStore, auth } = {}) {
  const kern = async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    let body = null;
    if (req.method === 'PUT') {
      body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Ongeldige JSON.' });
      if (!Number.isInteger(body.versie) || body.versie < 0) return json(400, { error: 'versie moet een geheel getal zijn.' });
    }
    try {
      if (isTestVerzoek(req)) await zorgVoorTestkopie(haalStore);
      const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });
      if (req.method === 'GET') return json(200, await leesGrenzen(store));
      const r = await schrijfGrenzen(store, body.grenzen, body.versie);
      if (r.ok) return json(200, { versie: r.versie });
      if (r.status === 409) return json(409, { error: 'Versiematch mislukt', serverVersie: r.data.versie, data: r.data });
      return json(400, { error: r.fout });
    } catch (e) {
      console.error('dashboard-instellingen: opslag mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('dashboard-instellingen', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/dashboard-instellingen' };
