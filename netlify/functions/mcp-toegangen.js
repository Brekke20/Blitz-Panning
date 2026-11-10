// /api/mcp-toegangen — gekoppelde Claude-toegangen (MCP-leesconnector) bekijken en intrekken.
//   GET     200 { toegangen: [{ id, uid, gebruikerNaam, clientNaam, aangemaakt, laatstGebruikt }] }, nieuwste eerst.
//           Beheerder: alle koppelingen; ieder ander: enkel de eigen.
//   DELETE ?id=  200 { ok: true } | 400 (geen id) | 403 (andermans koppeling, niet-beheerder) | 404 (bestaat niet)
//           Intrekken maakt access- en refresh-token meteen waardeloos (trekIn, netlify/lib/mcp-oauth.js) en logt 'claude-ingetrokken'.
// Rechten: alle rollen (rechten.js); de eigenaarscontrole staat hier. DELETE is een schrijfactie: de wrapper eist de X-Blitz-kop.
// Uitgevoerd op de echte opslag (zoals mcp-oauth); nooit de testkopie, want de koppelingen leven op de echte gegevens.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { OPSLAG_STORING } from '../lib/auth-antwoord.js';
import { lijstToegangen, trekIn } from '../lib/mcp-oauth.js';
import { leesGebruikers } from '../lib/gebruikers.js';
import { logActiviteit } from '../lib/activiteit.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, DELETE, OPTIONS', headers: 'Content-Type, X-Blitz', inhoudType: 'application/json',
}));
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function maakHandler({ getStore: haalStore, nu = () => Date.now(), auth } = {}) {
  const kern = async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const isBeheerder = gebruiker.rol === 'beheerder';
    try {
      const store = haalStore({ name: 'blitz-data', consistency: 'strong' });
      const alle = await lijstToegangen(store);
      if (req.method === 'GET') {
        const namen = new Map((await leesGebruikers(store)).map(g => [g.id, g.naam]));
        const toegangen = alle
          .filter(t => isBeheerder || t.uid === gebruiker.id)
          .sort((a, b) => b.aangemaakt - a.aangemaakt)
          .map(t => ({
            id: t.id, uid: t.uid, gebruikerNaam: namen.get(t.uid) || 'Onbekende gebruiker',
            clientNaam: t.clientNaam, aangemaakt: t.aangemaakt, laatstGebruikt: t.laatstGebruikt,
          }));
        return json(200, { toegangen });
      }
      const id = new URL(req.url).searchParams.get('id');
      if (!id) return json(400, { error: 'Geef het id van de koppeling op.' });
      const doel = alle.find(t => t.id === id);
      if (!doel) return json(404, { error: 'Deze koppeling bestaat niet (meer).' });
      if (!isBeheerder && doel.uid !== gebruiker.id) return json(403, { error: 'Je mag enkel je eigen koppeling intrekken.' });
      if (!(await trekIn(store, id))) return json(404, { error: 'Deze koppeling bestaat niet (meer).' });
      // Trekt de beheerder andermans koppeling in, dan staat in de details van wie ze was.
      const eigenaar = doel.uid === gebruiker.id ? null : (await leesGebruikers(store)).find(g => g.id === doel.uid)?.naam ?? doel.uid;
      await logActiviteit(store, { gebruiker, actie: 'claude-ingetrokken', onderwerp: doel.clientNaam || null, details: eigenaar ? `Koppeling van ${eigenaar}` : null }, { nu });
      return json(200, { ok: true });
    } catch (e) {
      console.error('mcp-toegangen: opslag mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('mcp-toegangen', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/mcp-toegangen' };
