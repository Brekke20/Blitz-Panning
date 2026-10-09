// /api/client-log
// GET  → volledige lijst van client-side fouten (enkel voor handmatige inspectie)
// POST → nieuwe foutregel toevoegen (open, geen auth) — puur diagnostisch,
//         dit endpoint mag zelf nooit een reden zijn om een rapport te blokkeren.

import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { beveiligV2 } from '../lib/beveiligd.js';

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

const kern = async (req, context, gebruiker) => {
  const hdrs = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: winkelNaam(req), consistency: 'strong' });

  if (isTestVerzoek(req)) await zorgVoorTestkopie(getStore);

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
    // Publiek, ongeauthenticeerd endpoint: bodies groter dan 4 KB weigeren (header én werkelijke lengte).
    const MAX_BODY = 4096;
    const jsonHdr = { ...hdrs, 'Content-Type': 'application/json' };
    if (parseInt(req.headers.get('content-length') || '0', 10) > MAX_BODY) {
      return new Response(JSON.stringify({ error: 'Te groot' }), { status: 413, headers: jsonHdr });
    }
    let body;
    try {
      const tekst = await req.text();
      if (tekst.length > MAX_BODY) {
        return new Response(JSON.stringify({ error: 'Te groot' }), { status: 413, headers: jsonHdr });
      }
      body = JSON.parse(tekst);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('geen object');
    }
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
      ticketId:     String(body.ticketId     || '').slice(0, 100),
      ticketNumber: String(body.ticketNumber || '').slice(0, 100),
      stap:         String(body.stap         || '').slice(0, 100),
      fout:         String(body.fout         || '').slice(0, 500),
      poging:       parseInt(body.poging) || 1,
    };

    // TIJDELIJK scrollsprong-verklikker — verwijderen na analyse: enkel whitelisted velden, types afgedwongen.
    if (body.soort === 'scrollsprong') {
      const tekst = (v, max) => String(v ?? '').slice(0, max);
      const getal = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
      const recent = (Array.isArray(body.recent) ? body.recent : []).slice(0, 20).map(r => ({
        t: getal(r && (r.t ?? r.vooraf_ms)), wat: tekst(r && r.wat, 40),
      }));
      entry.soort = 'scrollsprong';
      entry.details = JSON.stringify({
        soort: 'scrollsprong', tab: tekst(body.tab, 40), van: getal(body.van), naar: getal(body.naar),
        indeling: tekst(body.indeling, 20), rol: tekst(body.rol, 20), recent, stack: tekst(body.stack, 800),
      });
    }

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

export default beveiligV2('client-log', kern);

export const config = { path: '/api/client-log' };
