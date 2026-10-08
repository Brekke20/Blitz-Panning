// /api/rapport-ontvangen — snelle, idempotente ontvangst van een service-rapport. Slaat de inhoud
// en een lichte lijst-entry op en start daarna de Background Function die de PDF maakt en naar
// Zoho uploadt. Logica: netlify/lib/rapport-ontvangst.js en rapport-achtergrond.js.
import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { verwerkOntvangst } from '../lib/rapport-ontvangst.js';
import { startAchtergrondtaak } from '../lib/rapport-achtergrond.js';

export function maakHandler({ getStore: haalStore, fetch: doFetch }) {
  return async (req) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers });

    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers });
    }

    const testModus = isTestVerzoek(req);
    const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });
    if (testModus) await zorgVoorTestkopie(haalStore);

    const res = await verwerkOntvangst({ store, body, testModus });
    if (res.startNodig) {
      await startAchtergrondtaak({ origin: new URL(req.url).origin, id: res.body.id, testModus, fetch: doFetch });
    }
    return new Response(JSON.stringify(res.body), { status: res.status, headers });
  };
}

export default maakHandler({ getStore, fetch: globalThis.fetch });

export const config = { path: '/api/rapport-ontvangen' };
