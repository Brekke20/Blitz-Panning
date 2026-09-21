// /api/klantbeschikbaarheid
// GET → volledige map van klant-beschikbaarheid per ticket-id
// PUT → opslaan (open, geen auth)
// Structuur: { versie, bijgewerkt, items: { [ticketId]: {
//   voorkeur      : 'YYYY-MM-DD' | null   — voorkeursdatum van de klant
//   voorkeurTijd  : 'HH:MM'     | null   — voorkeursuur (los van of samen met de datum)
//   geblokkeerd   : ['YYYY-MM-DD', ...]  — dagen waarop de klant NIET kan
//   notitie       : string
//   duurOverride  : number | undefined   — afwijkende interventieduur in minuten
//   bijgewerkt    : ISO-timestamp
// } } }

import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'klantbeschikbaarheid';
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];
const EMPTY = { versie: 0, items: {} };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

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
      const voorkeur     = (entry.voorkeur && DATE_RE.test(entry.voorkeur)) ? entry.voorkeur : null;
      const voorkeurTijd = (typeof entry.voorkeurTijd === 'string' && TIME_RE.test(entry.voorkeurTijd)) ? entry.voorkeurTijd : null;
      const geblokkeerd = [...new Set(
        (Array.isArray(entry.geblokkeerd) ? entry.geblokkeerd : [])
          .filter(d => DATE_RE.test(d))
      )].sort();
      const notitie = String(entry.notitie || '').slice(0, 500);
      // duurOverride: positief geheel aantal minuten, anders weglaten. Werd voorheen NOOIT
      // gepersisteerd (gekend euvel, zie planning-export.js) — vanaf nu wel.
      // M11 (eindreview v1.4.0): eerst een typeof-guard vóór Number.isInteger() -- Number(x)
      // coerceert bv. `true` naar 1 en `"120"` naar 120, waardoor een onbedoeld/foutief
      // getypeerde waarde uit de request-body alsnog als geldige duur werd aanvaard.
      const duurOverride = (typeof entry.duurOverride === 'number'
        && Number.isInteger(entry.duurOverride) && entry.duurOverride > 0 && entry.duurOverride <= 1440)
        ? entry.duurOverride : undefined;
      // Voorkeur mag niet ook geblokkeerd zijn
      const voorkeurClean = (voorkeur && geblokkeerd.includes(voorkeur)) ? null : voorkeur;
      // Sla lege entries niet op
      if (!voorkeurClean && !voorkeurTijd && !geblokkeerd.length && !notitie && !duurOverride) continue;
      cleaned[ticketId] = {
        voorkeur:     voorkeurClean,
        voorkeurTijd,
        geblokkeerd,
        notitie,
        ...(duurOverride ? { duurOverride } : {}),
        bijgewerkt:   entry.bijgewerkt || new Date().toISOString(),
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
