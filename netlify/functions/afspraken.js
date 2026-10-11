// /api/afspraken
// GET  → volledige lijst van lokale afspraken (publiek)
// PUT  → lijst opslaan (open, geen auth vereist)

import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { eigenWijzigingen } from '../lib/eigen.js';

const BLOB_KEY    = 'afspraken';
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
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

const GEEN_RECHT = { error: 'Je kan enkel je eigen afspraken wijzigen.', code: 'geen-recht' };

// Dezelfde opschoning voor wat de client stuurt en voor wat al bewaard is (vergelijking "eigen"-regels).
const schoonAfspraak = a => ({
  id:       String(a.id || crypto.randomUUID()),
  titel:    String(a.titel || ''),
  datum:    String(a.datum || ''),
  uur:      String(a.uur   || ''),
  einduur:  String(a.einduur || ''),
  type:     String(a.type  || 'Overige'),
  persoon:  a.persoon ? String(a.persoon) : null,
  adres:    String(a.adres || ''),
  notitie:  String(a.notitie || ''),
  telefoon: String(a.telefoon || ''),
  email:    String(a.email || ''),
  bron:     a.bron === 'import' ? 'import' : 'manueel',
  origResp: a.origResp ? String(a.origResp) : null,
});
const heeftDatum = a => a.datum.match(/^\d{4}-\d{2}-\d{2}$/);

export function maakHandler({ getStore: haalStore = getStore } = {}) {
  const kern = async (req, context, gebruiker) => {
    const hdrs = corsHeaders(req);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: hdrs });
    }

    const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });

    if (isTestVerzoek(req)) await zorgVoorTestkopie(haalStore);

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
      const cleaned = afspraken.map(schoonAfspraak).filter(heeftDatum);

      // Een technieker mag enkel zijn eigen afspraken toevoegen, wijzigen of verwijderen.
      if (gebruiker?.rol === 'technieker') {
        const oud = (current.afspraken ?? []).filter(a => a && typeof a === 'object').map(schoonAfspraak).filter(heeftDatum);
        const r = eigenWijzigingen(oud, cleaned, { eigenaar: a => a.persoon, gebruiker });
        if (!r.ok) {
          return new Response(JSON.stringify({ ...GEEN_RECHT, reden: r.reden }), {
            status: 403, headers: { ...hdrs, 'Content-Type': 'application/json' },
          });
        }
      }

      const nieuw = { versie: current.versie + 1, bijgewerkt: new Date().toISOString(), afspraken: cleaned };
      await store.setJSON(BLOB_KEY, nieuw);

      return new Response(JSON.stringify(nieuw), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method Not Allowed', { status: 405, headers: hdrs });
  };

  return beveiligV2('afspraken', kern);
}

export default maakHandler();

export const config = { path: '/api/afspraken' };
