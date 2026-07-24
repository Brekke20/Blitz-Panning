// /api/fotos
// GET  ?ticketId=<id> → foto's voor één ticket
// PUT  → foto's opslaan voor één ticket (open, geen auth)
// Structuur per ticket (eigen blob-key, NIET gedeeld met andere tickets —
// foto-payloads zijn te groot om samen met alle tickets in één blob te bewaren):
//   { versie, fotos: [ { id, dataUrl, caption, tijdstip } ] }

import { getStore } from '@netlify/blobs';

const ALLOWED_ORIGINS = [
  'https://blitz-power.netlify.app',
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];
const EMPTY        = { versie: 0, fotos: [] };
const MAX_FOTOS     = 30;
const MAX_CAPTION   = 200;

function corsHeaders(req) {
  const origin  = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function blobKey(ticketId) { return `foto-${ticketId}`; }

export default async (req) => {
  const hdrs  = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });
  const url   = new URL(req.url);

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const ticketId = url.searchParams.get('ticketId');
    if (!ticketId) {
      return new Response(JSON.stringify({ error: 'ticketId is verplicht' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
    try {
      const raw = await store.get(blobKey(ticketId), { type: 'json' });
      return new Response(JSON.stringify(raw ?? EMPTY), {
        status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify(EMPTY), {
        status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── PUT ───────────────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); }
    catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' } }); }

    const { ticketId, versie, fotos } = body;
    if (!ticketId || typeof ticketId !== 'string') {
      return new Response(JSON.stringify({ error: 'ticketId is verplicht' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
    if (!Array.isArray(fotos)) {
      return new Response(JSON.stringify({ error: 'fotos moet een array zijn' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
    if (fotos.length > MAX_FOTOS) {
      return new Response(JSON.stringify({ error: `Maximaal ${MAX_FOTOS} foto's per ticket` }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    // Optimistic locking
    let current = EMPTY;
    try { current = (await store.get(blobKey(ticketId), { type: 'json' })) ?? EMPTY; }
    catch {}

    if (versie !== current.versie) {
      return new Response(JSON.stringify({
        error: 'Versiematch mislukt', serverVersie: current.versie, data: current,
      }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }

    // Valideer en schoon elke foto op
    const cleaned = [];
    for (const f of fotos) {
      if (!f || typeof f.dataUrl !== 'string' || !f.dataUrl.startsWith('data:image/')) continue;
      cleaned.push({
        id:       String(f.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
        dataUrl:  f.dataUrl,
        caption:  String(f.caption || '').slice(0, MAX_CAPTION),
        tijdstip: f.tijdstip || new Date().toISOString(),
      });
    }

    const nieuw = { versie: current.versie + 1, fotos: cleaned };
    await store.setJSON(blobKey(ticketId), nieuw);

    return new Response(JSON.stringify(nieuw), {
      status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405, headers: hdrs });
};

export const config = { path: '/api/fotos' };
