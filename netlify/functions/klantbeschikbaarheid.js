// /api/klantbeschikbaarheid
// GET → volledige map van klant-beschikbaarheid per ticket-id
// PUT → opslaan (open, geen auth)
// Structuur: { versie, bijgewerkt, items: { [ticketId]: { voorkeur, geblokkeerd, notitie, bijgewerkt } } }

import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'klantbeschikbaarheid';
const ALLOWED_ORIGINS = [
  'https://blitz-power.netlify.app',
  'http://localhost:8888',
];
const EMPTY = { versie: 0, items: {} };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

export default async (req) => {
  const hdrs  = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const raw = await store.get(BLOB_KEY, { type: 'json' });
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

    const { versie, items } = body;
    if (!items || typeof items !== 'object' || Array.isArray(items)) {
      return new Response(JSON.stringify({ error: 'items moet een object zijn' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    // Optimistic locking
    let current = EMPTY;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch {}

    if (versie !== current.versie) {
      return new Response(JSON.stringify({
        error: 'Versiematch mislukt', serverVersie: current.versie, data: current,
      }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }

    // Valideer en schoon op per ticket-entry
    const cleaned = {};
    for (const [ticketId, entry] of Object.entries(items)) {
      if (!ticketId || typeof ticketId !== 'string') continue;
      const voorkeur   = (entry.voorkeur && DATE_RE.test(entry.voorkeur)) ? entry.voorkeur : null;
      const geblokkeerd = [...new Set(
        (Array.isArray(entry.geblokkeerd) ? entry.geblokkeerd : [])
          .filter(d => DATE_RE.test(d))
      )].sort();
      const notitie = String(entry.notitie || '').slice(0, 500);
      // Voorkeur mag niet ook geblokkeerd zijn
      const voorkeurClean = (voorkeur && geblokkeerd.includes(voorkeur)) ? null : voorkeur;
      // Sla lege entries niet op
      if (!voorkeurClean && !geblokkeerd.length && !notitie) continue;
      cleaned[ticketId] = {
        voorkeur:    voorkeurClean,
        geblokkeerd,
        notitie,
        bijgewerkt:  entry.bijgewerkt || new Date().toISOString(),
      };
    }

    const nieuw = { versie: current.versie + 1, bijgewerkt: new Date().toISOString(), items: cleaned };
    await store.setJSON(BLOB_KEY, nieuw);

    return new Response(JSON.stringify(nieuw), {
      status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405, headers: hdrs });
};

export const config = { path: '/api/klantbeschikbaarheid' };
