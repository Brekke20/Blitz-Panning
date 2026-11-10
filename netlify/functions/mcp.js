// /api/mcp — MCP-leesconnector voor Claude (stateless Streamable HTTP, JSON-RPC, enkel JSON-antwoorden, geen SDK).
//   POST  één bericht of een batch-array; antwoord application/json, of 202 zonder body als er niets te antwoorden is.
//   GET   405 (geen SSE-stroom: de server stuurt nooit zelf berichten). OPTIONS 204 (CORS voor claude.ai/claude.com).
// Rij 'open' in rechten.js: de sessiecookie speelt hier geen rol. Eigen controle: Bearer-access-token via vereisMcpGebruiker
// (netlify/lib/mcp-toegang.js: actieve gebruiker, zelfde sessieVersie als bij de toestemming). Zonder geldige token: 401 met
// WWW-Authenticate naar de metadata (netlify/functions/mcp-oauth.js), vóór de body gelezen wordt.
// De gereedschappen en de rechten per rol staan in netlify/lib/mcp-protocol.js. Geen sessie-ID, geen activiteitenlog per oproep
// (het koppelen zelf staat al in het log; laatstGebruikt houdt vereisMcpGebruiker bij via markeerGebruikt).
import { getStore } from '@netlify/blobs';
import { vereisMcpGebruiker } from '../lib/mcp-toegang.js';
import { behandelRpc } from '../lib/mcp-protocol.js';
import { metLeesCache } from '../lib/mcp-data.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';

const MAX_BODY = 64 * 1024;
const MAX_BATCH = 5; // elk rapportgereedschap kan alle jaararchieven lezen: een batch klein houden (en de lezingen delen, metLeesCache)
const CORS_ORIGINS = new Set(['https://claude.ai', 'https://claude.com']);

function cors(req) {
  const origin = req.headers.get('origin');
  return {
    ...maakCors({
      methoden: 'POST, OPTIONS',
      headers: 'Authorization, Content-Type, Accept, Mcp-Protocol-Version',
      origin: CORS_ORIGINS.has(origin) ? origin : 'https://claude.ai',
    }),
    'Access-Control-Expose-Headers': 'WWW-Authenticate',
    Vary: 'Origin',
  };
}

function json(status, obj, kop) {
  return new Response(JSON.stringify(obj), { status, headers: { ...kop, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
const rpcFout = (code, message) => ({ jsonrpc: '2.0', id: null, error: { code, message } });

// Body lezen met een harde grens op de gelezen bytes (niet enkel Content-Length). null = te groot.
async function leesBody(req) {
  const cl = Number(req.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > MAX_BODY) return null;
  if (!req.body) return '';
  const lezer = req.body.getReader();
  const delen = [];
  let totaal = 0;
  for (;;) {
    const { done, value } = await lezer.read();
    if (done) break;
    totaal += value.byteLength;
    if (totaal > MAX_BODY) { try { await lezer.cancel(); } catch { /* negeren */ } return null; }
    delen.push(Buffer.from(value));
  }
  return Buffer.concat(delen).toString('utf8');
}

export function maakHandler({ getStore: haalStore = getStore, nu = () => Date.now(), vereis = vereisMcpGebruiker } = {}) {
  return async (req) => {
    const kop = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: kop });
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, { ...kop, Allow: 'POST, OPTIONS' });

    try {
      const tijd = nu();
      const auth = await vereis(req, { getStore: haalStore, nu: tijd });
      if (!auth || auth.ok !== true || !auth.gebruiker) {
        const origin = new URL(req.url).origin;
        return json(401, { error: 'invalid_token' }, {
          ...kop, 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        });
      }

      const tekst = await leesBody(req);
      if (tekst === null) return json(413, rpcFout(-32600, 'Request too large'), kop);
      let body;
      try { body = JSON.parse(tekst); } catch { return json(400, rpcFout(-32700, 'Parse error'), kop); }

      const store = await haalStore({ name: 'blitz-data', consistency: 'strong' });
      // Per verzoek een eigen leescache: een batch leest de rapportlijst en de jaararchieven één keer.
      const context = { gebruiker: auth.gebruiker, bronnen: { store: metLeesCache(store), nu: new Date(tijd) } };

      if (Array.isArray(body)) {
        if (body.length === 0 || body.length > MAX_BATCH) return json(400, rpcFout(-32600, 'Invalid Request'), kop);
        const antwoorden = [];
        for (const bericht of body) {
          const r = await behandelRpc(bericht, context);
          if (r) antwoorden.push(r);
        }
        return antwoorden.length ? json(200, antwoorden, kop) : new Response(null, { status: 202, headers: kop });
      }
      const r = await behandelRpc(body, context);
      return r ? json(200, r, kop) : new Response(null, { status: 202, headers: kop });
    } catch (e) {
      // Enkel het fouttype loggen: een Blobs-fout kan details bevatten.
      console.error('mcp: fout (' + (e?.name || 'Error') + ')');
      return json(500, rpcFout(-32603, 'Internal error'), kop);
    }
  };
}

export default beveiligV2('mcp', maakHandler({ getStore }));

export const config = { path: '/api/mcp' };
