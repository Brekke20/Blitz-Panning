// /api/rapport-archief
// GET  → lijst van gearchiveerde rapports (publiek); ?id=<id> één rapport; ?inhoud=<id> de HTML
// POST → nieuw rapport archiveren (open, geen auth); { opnieuw: <id> } = mislukt rapport opnieuw versturen

import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import {
  LIJST_KEY as BLOB_KEY, LEGE_LIJST as EMPTY,
  bepaalDedupVelden, bouwEntry, voegToeOfWerkBij,
} from '../lib/rapportlijst.js';
import { haalRapportInhoud, verwerkOpnieuw } from '../lib/rapport-archief-acties.js';
import { startAchtergrondtaak } from '../lib/rapport-achtergrond.js';
import { isGeldigId, vergeetEntry } from '../lib/rapport-inhoud.js';

const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];

function corsHeaders(req) {
  const origin  = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

// bepaalDedupVelden woont in ../lib/rapportlijst.js; hier her-geëxporteerd voor bestaande tests/imports.
export { bepaalDedupVelden };

export default async (req, context) => {
  const hdrs  = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: winkelNaam(req), consistency: 'strong' });

  if (isTestVerzoek(req)) await zorgVoorTestkopie(getStore);

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const params = new URL(req.url).searchParams;
    if (params.has('inhoud')) {
      const uit = await haalRapportInhoud(store, params.get('inhoud'));
      return new Response(JSON.stringify(uit.body), {
        status: uit.status,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
    const id = params.get('id');
    try {
      const raw = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY;
      if (id) {
        const rapport = raw.rapports.find(r => r.id === id) || null;
        return new Response(JSON.stringify({ versie: raw.versie, rapport }), {
          status: 200,
          headers: { ...hdrs, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(raw), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    } catch {
      const fallback = id ? { versie: EMPTY.versie, rapport: null } : EMPTY;
      return new Response(JSON.stringify(fallback), {
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

    // "Opnieuw versturen" van een mislukt rapport (vóór de legacy-entry-opbouw afgehandeld).
    if (body && body.opnieuw !== undefined) {
      const uit = await verwerkOpnieuw({ store, id: body.opnieuw });
      if (uit.startNodig) {
        await startAchtergrondtaak({ origin: new URL(req.url).origin, id: body.opnieuw, testModus: isTestVerzoek(req) });
      }
      return new Response(JSON.stringify(uit.body), {
        status: uit.status,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    let current;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch {
      return new Response(JSON.stringify({ error: 'Rapportarchief tijdelijk niet bereikbaar, probeer opnieuw.' }), {
        status: 503, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    if (typeof body.versie === 'number' && body.versie !== current.versie) {
      return new Response(JSON.stringify({
        error: 'Rapportarchief werd ondertussen gewijzigd door iemand anders. Herlaad en probeer opnieuw.',
        serverVersie: current.versie,
      }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }

    const entry = bouwEntry(body);
    const { rapports: updatedList } = voegToeOfWerkBij(current.rapports, entry, body);

    const nieuw = {
      versie:   current.versie + 1,
      rapports: updatedList, // voegToeOfWerkBij kapt af op MAX_RAPPORTEN
    };
    await store.setJSON(BLOB_KEY, nieuw);

    return new Response(JSON.stringify({ ok: true, id: entry.id, versie: nieuw.versie }), {
      status: 200,
      headers: { ...hdrs, 'Content-Type': 'application/json' },
    });
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    let body;
    try { body = await req.json(); }
    catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' } }); }

    const { id } = body;
    if (!id) return new Response(JSON.stringify({ error: 'id vereist' }), { status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' } });

    let current;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch {
      return new Response(JSON.stringify({ error: 'Rapportarchief tijdelijk niet bereikbaar, probeer opnieuw.' }), {
        status: 503, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    if (typeof body.versie === 'number' && body.versie !== current.versie) {
      return new Response(JSON.stringify({
        error: 'Rapportarchief werd ondertussen gewijzigd door iemand anders. Herlaad en probeer opnieuw.',
        serverVersie: current.versie,
      }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }

    const filtered = current.rapports.filter(r => r.id !== id);
    if (filtered.length === current.rapports.length) {
      return new Response(JSON.stringify({ error: 'Rapport niet gevonden' }), { status: 404, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }

    const nieuweVersie = current.versie + 1;
    await store.setJSON(BLOB_KEY, { versie: nieuweVersie, rapports: filtered });
    if (isGeldigId(id)) await vergeetEntry(store, id); // best-effort: voorkomt dat verwerkRapport het rapport terugzet
    return new Response(JSON.stringify({ ok: true, versie: nieuweVersie }), { status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' } });
  }

  return new Response('Method Not Allowed', { status: 405, headers: hdrs });
};

export const config = { path: '/api/rapport-archief' };
