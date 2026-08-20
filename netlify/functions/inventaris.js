// /api/inventaris
// GET   → volledige inventarisstaat (wagenvoorraad per technieker + volledige log)
// POST  → mutatie (technieker vult wagenvoorraad bij of corrigeert) of verbruik (automatische
//         aftrek bij een afgerond rapport) — beide muteren wagenvoorraad + loggen een regel
// PATCH → een 'aanvulling'-logregel op status 'verwerkt' zetten (supervisor heeft ze in AFAS geboekt)
import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'inventaris';
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];

const EMPTY = { versie: 0, wagenvoorraad: {}, log: [] };

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(data, status, hdrs) {
  return new Response(JSON.stringify(data), { status, headers: { ...hdrs, 'Content-Type': 'application/json' } });
}

export default async (req) => {
  const hdrs = corsHeaders(req);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const data = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY;
      return json(data, 200, hdrs);
    } catch {
      return json(EMPTY, 200, { ...hdrs, 'X-Source': 'fallback' });
    }
  }

  // ── POST (mutatie of verbruik) ──────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Ongeldige JSON' }, 400, hdrs); }

    const { versie, technieker, actie, items } = body;

    if (typeof versie !== 'number') return json({ error: 'versie is verplicht en moet een getal zijn' }, 400, hdrs);
    if (!technieker || typeof technieker !== 'string') return json({ error: 'technieker is verplicht' }, 400, hdrs);
    if (actie !== 'mutatie' && actie !== 'verbruik') return json({ error: "actie moet 'mutatie' of 'verbruik' zijn" }, 400, hdrs);
    if (!Array.isArray(items) || !items.length) return json({ error: 'items moet een niet-lege array zijn' }, 400, hdrs);
    for (const it of items) {
      if (!it.materiaalId || typeof it.materiaalId !== 'string') return json({ error: 'elk item heeft een materiaalId nodig' }, 400, hdrs);
      if (!it.materiaalNaam || typeof it.materiaalNaam !== 'string') return json({ error: 'elk item heeft een materiaalNaam nodig' }, 400, hdrs);
      if (typeof it.aantal !== 'number' || !Number.isFinite(it.aantal) || it.aantal === 0) return json({ error: `ongeldig aantal voor ${it.materiaalId}` }, 400, hdrs);
    }

    let current;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch { return json({ error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }, 503, hdrs); }

    if (versie !== current.versie) {
      return json({ error: 'Inventaris ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie, data: current }, 409, hdrs);
    }

    const wagenvoorraad = { ...current.wagenvoorraad };
    const stock = { ...(wagenvoorraad[technieker] || {}) };
    const nieuweLogRegels = [];
    const nu = new Date().toISOString();

    for (const it of items) {
      // verbruik: 'aantal' is de gebruikte hoeveelheid (positief) -> wagenvoorraad daalt.
      // mutatie: 'aantal' is al signed (positief = aanvulling, negatief = correctie).
      const delta = actie === 'verbruik' ? -Math.abs(it.aantal) : it.aantal;
      stock[it.materiaalId] = (stock[it.materiaalId] || 0) + delta;

      const type   = actie === 'verbruik' ? 'verbruik' : (delta > 0 ? 'aanvulling' : 'correctie');
      const status = type === 'aanvulling' ? 'nieuw' : null;

      nieuweLogRegels.push({
        id: crypto.randomUUID(),
        technieker,
        materiaalId:   it.materiaalId,
        materiaalNaam: it.materiaalNaam,
        aantal: delta,
        datum: nu,
        type,
        status,
      });
    }

    wagenvoorraad[technieker] = stock;

    const nieuw = {
      versie: current.versie + 1,
      wagenvoorraad,
      log: [...current.log, ...nieuweLogRegels],
    };

    try {
      await store.setJSON(BLOB_KEY, nieuw);
      return json(nieuw, 200, hdrs);
    } catch (err) {
      return json({ error: 'Opslaan mislukt: ' + err.message }, 500, hdrs);
    }
  }

  // ── PATCH (logregel als verwerkt markeren) ──────────────────────────────────
  if (req.method === 'PATCH') {
    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Ongeldige JSON' }, 400, hdrs); }

    const { versie, id } = body;
    if (typeof versie !== 'number') return json({ error: 'versie is verplicht en moet een getal zijn' }, 400, hdrs);
    if (!id || typeof id !== 'string') return json({ error: 'id is verplicht' }, 400, hdrs);

    let current;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch { return json({ error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }, 503, hdrs); }

    if (versie !== current.versie) {
      return json({ error: 'Inventaris ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie, data: current }, 409, hdrs);
    }

    const idx = current.log.findIndex(e => e.id === id);
    if (idx < 0) return json({ error: 'Logregel niet gevonden' }, 404, hdrs);
    if (current.log[idx].type !== 'aanvulling') return json({ error: 'Enkel aanvullingen kunnen als verwerkt gemarkeerd worden' }, 400, hdrs);

    const log = [...current.log];
    log[idx] = { ...log[idx], status: 'verwerkt' };

    const nieuw = { versie: current.versie + 1, wagenvoorraad: current.wagenvoorraad, log };

    try {
      await store.setJSON(BLOB_KEY, nieuw);
      return json(nieuw, 200, hdrs);
    } catch (err) {
      return json({ error: 'Opslaan mislukt: ' + err.message }, 500, hdrs);
    }
  }

  return json({ error: 'Method not allowed' }, 405, hdrs);
};

export const config = { path: '/api/inventaris' };
