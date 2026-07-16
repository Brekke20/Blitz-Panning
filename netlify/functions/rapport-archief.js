// /api/rapport-archief
// GET  → lijst van gearchiveerde rapports (publiek)
// POST → nieuw rapport archiveren (open, geen auth)

import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'rapportlijst';
const ALLOWED_ORIGINS = [
  'https://blitz-power.netlify.app',
  'http://localhost:8888',
];
const EMPTY = { versie: 0, rapports: [] };

function corsHeaders(req) {
  const origin  = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default async (req, context) => {
  const hdrs  = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const raw = await store.get(BLOB_KEY, { type: 'json' });
      return new Response(JSON.stringify(raw ?? EMPTY), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify(EMPTY), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' } }); }

    let current = EMPTY;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch {}

    const entry = {
      id:              String(body.id || crypto.randomUUID()),
      datum:           String(body.datum           || ''),
      aangemaakt:      new Date().toISOString(),
      technieker:      String(body.technieker       || ''),
      ticketId:        String(body.ticketId         || ''),
      ticketNumber:    String(body.ticketNumber     || ''),
      klant:           String(body.klant            || ''),
      adres:           String(body.adres            || ''),
      nieuwInter:      body.nieuwInter === 'ja' ? 'ja' : 'nee',
      hersteld:        body.hersteld   === 'ja' ? 'ja' : 'nee',
      servicetype:     String(body.servicetype      || ''),
      facturatie:      String(body.facturatie       || ''),
      totaalOnderdelen: parseFloat(body.totaalOnderdelen) || 0,
      // Bewaar het volledige R-object om rapport te kunnen hergeneren
      rapportData:     body.rapportData || null,
    };

    const nieuw = {
      versie:   current.versie + 1,
      rapports: [entry, ...current.rapports].slice(0, 500), // max 500 bewaren
    };
    await store.setJSON(BLOB_KEY, nieuw);

    return new Response(JSON.stringify({ ok: true, id: entry.id }), {
      status: 200,
      headers: { ...hdrs, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405, headers: hdrs });
};

export const config = { path: '/api/rapport-archief' };
