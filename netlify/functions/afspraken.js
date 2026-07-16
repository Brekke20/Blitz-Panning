// /api/afspraken
// GET  → volledige lijst van lokale afspraken (publiek)
// PUT  → lijst opslaan (open, geen auth vereist)

import { getStore } from '@netlify/blobs';

const BLOB_KEY    = 'afspraken';
const ALLOWED_ORIGINS = [
  'https://blitz-power.netlify.app',
  'http://localhost:8888',
];

const EMPTY = { versie: 0, afspraken: [] };

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default async (req, context) => {
  const hdrs = corsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: hdrs });
  }

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
        headers: { ...hdrs, 'Content-Type': 'application/json', 'X-Source': 'fallback' },
      });
    }
  }

  // ── PUT ───────────────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); }
    catch {
      return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    const { versie, afspraken } = body;
    if (!Array.isArray(afspraken)) {
      return new Response(JSON.stringify({ error: 'afspraken moet een array zijn' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    // Optimistic locking
    let current = EMPTY;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch { /* eerste write */ }

    if (versie !== current.versie) {
      return new Response(JSON.stringify({
        error: 'Versiematch mislukt',
        serverVersie: current.versie,
        data: current,
      }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }

    // Valideer en schoon op
    const cleaned = afspraken.map(a => ({
      id:       String(a.id || crypto.randomUUID()),
      titel:    String(a.titel || ''),
      datum:    String(a.datum || ''),
      uur:      String(a.uur   || ''),
      einduur:  String(a.einduur || ''),
      type:     String(a.type  || 'Overige'),
      persoon:  a.persoon ? String(a.persoon) : null,
      notitie:  String(a.notitie || ''),
      telefoon: String(a.telefoon || ''),
      email:    String(a.email || ''),
      bron:     a.bron === 'import' ? 'import' : 'manueel',
      origResp: a.origResp ? String(a.origResp) : null,
    })).filter(a => a.datum.match(/^\d{4}-\d{2}-\d{2}$/));

    const nieuw = { versie: current.versie + 1, bijgewerkt: new Date().toISOString(), afspraken: cleaned };
    await store.setJSON(BLOB_KEY, nieuw);

    return new Response(JSON.stringify(nieuw), {
      status: 200,
      headers: { ...hdrs, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405, headers: hdrs });
};

export const config = { path: '/api/afspraken' };
