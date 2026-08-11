// /api/client-log
// GET  → volledige lijst van client-side fouten (enkel voor handmatige inspectie)
// POST → nieuwe foutregel toevoegen (open, geen auth) — puur diagnostisch,
//         dit endpoint mag zelf nooit een reden zijn om een rapport te blokkeren.

import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'foutenlog';
const MAX_ENTRIES = 500;
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];
const EMPTY = { fouten: [] };

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
  const hdrs = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

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

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' } }); }

    let current;
    let readSucceeded = false;
    try {
      current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY;
      readSucceeded = true;
    }
    catch { current = EMPTY; }

    const entry = {
      tijdstip:     new Date().toISOString(),
      ticketId:     String(body.ticketId     || ''),
      ticketNumber: String(body.ticketNumber || ''),
      stap:         String(body.stap         || ''),
      fout:         String(body.fout         || '').slice(0, 500),
      poging:       parseInt(body.poging) || 1,
    };

    // Only write if the read succeeded; if read failed, skip write to avoid data loss
    if (readSucceeded) {
      const nieuw = { fouten: [entry, ...current.fouten].slice(0, MAX_ENTRIES) };
      try { await store.setJSON(BLOB_KEY, nieuw); }
      catch { /* diagnostisch, best-effort — falen hier mag genegeerd worden */ }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...hdrs, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405, headers: hdrs });
};

export const config = { path: '/api/client-log' };
