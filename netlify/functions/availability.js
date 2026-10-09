// /api/availability
// GET  → volledige beschikbaarheidslijst (publiek)
// PUT  → uitzonderingen opslaan (open, geen auth vereist)

import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { eigenWijzigingen } from '../lib/eigen.js';

const BLOB_KEY    = 'availability';
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];

const EMPTY = { versie: 0, exceptions: [] };

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

const GEEN_RECHT = { error: 'Je kan enkel je eigen verlof en afwezigheden wijzigen.', code: 'geen-recht' };

// Dezelfde opschoning voor wat de client stuurt en voor wat al bewaard is (vergelijking "eigen"-regels).
const schoonUitzondering = e => ({
  id:     String(e.id || crypto.randomUUID()),
  scope:  e.scope === 'global' ? 'global' : 'person',
  person: e.scope === 'global' ? null : String(e.person || ''),
  date:   String(e.date || ''),
  kind:   e.kind === 'range' ? 'range' : 'fullday',
  from:   e.kind === 'range' ? String(e.from || '00:00') : null,
  to:     e.kind === 'range' ? String(e.to || '23:59')   : null,
  reason: String(e.reason || ''),
});
const heeftDatum = e => e.date.match(/^\d{4}-\d{2}-\d{2}$/);

export function maakHandler({ getStore: haalStore = getStore } = {}) {
  const kern = async (req, context, gebruiker) => {
    const hdrs = corsHeaders(req);

    // Preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: hdrs });
    }

    const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });

    if (isTestVerzoek(req)) await zorgVoorTestkopie(haalStore);

    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      try {
        const raw = await store.get(BLOB_KEY, { type: 'json' });
        const data = raw ?? EMPTY;
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { ...hdrs, 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify(EMPTY), {
          status: 200,
          headers: { ...hdrs, 'Content-Type': 'application/json', 'X-Source': 'fallback' },
        });
      }
    }

    // ── PUT ───────────────────────────────────────────────────────────────────
    if (req.method === 'PUT') {
      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), {
          status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
        });
      }

      const { versie, exceptions } = body;

      if (!Array.isArray(exceptions)) {
        return new Response(JSON.stringify({ error: 'exceptions moet een array zijn' }), {
          status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
        });
      }

      // Lees huidige versie voor optimistic locking
      let current = EMPTY;
      try {
        current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY;
      } catch { /* eerste write */ }

      if (versie !== current.versie) {
        return new Response(JSON.stringify({
          error: 'Versiematch mislukt',
          serverVersie: current.versie,
          data: current,
        }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
      }

      // Valideer en schoon exceptions op
      const cleaned = exceptions.map(schoonUitzondering).filter(heeftDatum);

      // Een technieker mag enkel zijn eigen verlof toevoegen, wijzigen of verwijderen (nooit globale blokkades).
      if (gebruiker?.rol === 'technieker') {
        const oud = (current.exceptions ?? []).filter(e => e && typeof e === 'object').map(schoonUitzondering).filter(heeftDatum);
        const r = eigenWijzigingen(oud, cleaned, { eigenaar: e => (e.scope === 'person' ? e.person : null), gebruiker });
        if (!r.ok) {
          return new Response(JSON.stringify({ ...GEEN_RECHT, reden: r.reden }), {
            status: 403, headers: { ...hdrs, 'Content-Type': 'application/json' },
          });
        }
      }

      const nieuw = {
        versie:     current.versie + 1,
        bijgewerkt: new Date().toISOString(),
        exceptions: cleaned,
      };

      await store.setJSON(BLOB_KEY, nieuw);

      return new Response(JSON.stringify(nieuw), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method Not Allowed', { status: 405, headers: hdrs });
  };

  return beveiligV2('availability', kern);
}

export default maakHandler();

export const config = { path: '/api/availability' };
