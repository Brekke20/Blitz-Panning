// /api/rapport-archief
// GET  → lijst van gearchiveerde rapports (publiek)
// POST → nieuw rapport archiveren (open, geen auth)

import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'rapportlijst';
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];
const EMPTY = { versie: 0, rapports: [] };

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

export default async (req, context) => {
  const hdrs  = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id');
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
      prioriteit:      String(body.prioriteit       || ''),
      interventieType: String(body.interventieType  || 'Interventie'),
      totaalOnderdelen: parseFloat(body.totaalOnderdelen) || 0,
      // Bewaar het volledige R-object om rapport te kunnen hergeneren
      rapportData:     body.rapportData || null,
    };

    // Dedup: als er al een rapport bestaat voor hetzelfde ticket op dezelfde datum,
    // update die entry i.p.v. een duplicaat te prependen (1 ticket = 1 interventie).
    const dupIdx = current.rapports.findIndex(
      r => r.ticketId === entry.ticketId && r.datum === entry.datum && entry.ticketId
    );

    // zohoUploaded: enkel overerven van de bestaande entry als dit hetzelfde
    // wachtrij-item is dat zichzelf opnieuw bevestigt (zelfde id) — bv. na een
    // mislukte confirm-call. Botst een ANDER item via dedup (zelfde ticket+datum,
    // maar een nieuw, later aangemaakt rapport dezelfde dag), dan begint dat item
    // altijd met zohoUploaded:false, zodat het zelf een verse PDF naar Zoho stuurt
    // i.p.v. stil te veronderstellen dat het al gebeurd is.
    if (dupIdx >= 0) {
      const zelfdeItem = entry.id === current.rapports[dupIdx].id;
      entry.zohoUploaded = body.zohoUploaded === true || (zelfdeItem && current.rapports[dupIdx].zohoUploaded === true);
    } else {
      entry.zohoUploaded = body.zohoUploaded === true;
    }

    let updatedList;
    if (dupIdx >= 0) {
      updatedList = [...current.rapports];
      // Bewust het id van de HUIDIGE POST behouden (entry.id, want entry wordt als
      // laatste gespreid) en NIET dat van de oude entry: het antwoord hieronder
      // rapporteert entry.id, en de client zoekt dit rapport later terug via
      // GET ?id=<dat id> (check-zoho-voorcontrole in de outbox). Zou het opgeslagen
      // id afwijken van het gerapporteerde, dan vindt die lookup niets en valt de
      // dubbele-Zoho-upload-bescherming stil weg voor dat wachtrij-item.
      updatedList[dupIdx] = { ...updatedList[dupIdx], ...entry };
    } else {
      updatedList = [entry, ...current.rapports];
    }

    const nieuw = {
      versie:   current.versie + 1,
      rapports: updatedList.slice(0, 500), // max 500 bewaren
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
    return new Response(JSON.stringify({ ok: true, versie: nieuweVersie }), { status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' } });
  }

  return new Response('Method Not Allowed', { status: 405, headers: hdrs });
};

export const config = { path: '/api/rapport-archief' };
