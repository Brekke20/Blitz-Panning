// /api/inventaris
// GET   → volledige inventarisstaat (wagenvoorraad per technieker + volledige log, altijd
//         genormaliseerd + max. 3 maanden log-historiek)
// POST  → mutatie (technieker vult wagenvoorraad bij, corrigeert, en/of dempt de
//         lage-voorraadmelding voor een materiaal) of verbruik (automatische aftrek bij een
//         afgerond rapport) — beide muteren wagenvoorraad + loggen een regel (behalve een
//         zuivere demp-wijziging, die niet gelogd wordt)
// PATCH → een 'aanvulling'-logregel op status 'verwerkt' zetten (supervisor heeft ze in AFAS geboekt)
import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'inventaris';
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];
const RETENTIE_MAANDEN = 3;

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

// Oude opslag had per materiaal enkel een getal (aantal); nieuwe opslag heeft {aantal, gedempt}.
// Bestaande, nog niet aangeraakte data blijft in de oude vorm tot ze opnieuw geschreven wordt --
// elk antwoord aan de frontend normaliseert daarom altijd naar de nieuwe vorm, zodat de
// frontend nooit met de oude vorm rekening moet houden.
function normStock(val) {
  if (val == null) return { aantal: 0, gedempt: false };
  if (typeof val === 'number') return { aantal: val, gedempt: false };
  return { aantal: val.aantal || 0, gedempt: !!val.gedempt };
}

function normalizeWagenvoorraad(wv) {
  const out = {};
  for (const [tech, stock] of Object.entries(wv || {})) {
    out[tech] = {};
    for (const [id, val] of Object.entries(stock || {})) {
      out[tech][id] = normStock(val);
    }
  }
  return out;
}

function toResponse(data) {
  return { ...data, wagenvoorraad: normalizeWagenvoorraad(data.wagenvoorraad) };
}

// Log-historiek wordt beperkt tot RETENTIE_MAANDEN, om de opslag niet onbeperkt te laten
// aangroeien. Bewuste keuze: dit bumpt de 'versie' niet -- het is opschoning, geen inhoudelijke
// wijziging waarop een client optimistic-lock zou moeten conflicteren op.
function pruneOldLog(log) {
  const grens = new Date();
  grens.setMonth(grens.getMonth() - RETENTIE_MAANDEN);
  const grensISO = grens.toISOString();
  return (log || []).filter(e => e.datum >= grensISO);
}

async function pruneAndGet(store) {
  let current;
  try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
  catch { return { current: null, error: true }; }

  // Enkel in-memory prunen -- NIET meteen terugschrijven. Een write hier, buiten elke
  // optimistic-lock om, kan een gelijktijdige, versie-bumpende POST/PATCH-write overschrijven
  // (lost update, zie eindreview 2026-08-21). De geprunede staat wordt wél degelijk serverside
  // gepersisteerd, maar pas bij de volgende echte mutatie: POST/PATCH bouwen hun 'nieuw'-object
  // toch al op uit deze geprunede current.log, en schrijven het via hun eigen, veilige,
  // versie-gecontroleerde store.setJSON-aanroep.
  current = { ...current, log: pruneOldLog(current.log) };
  return { current, error: false };
}

export default async (req) => {
  const hdrs = corsHeaders(req);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { current, error } = await pruneAndGet(store);
    if (error) return json(toResponse(EMPTY), 200, { ...hdrs, 'X-Source': 'fallback' });
    return json(toResponse(current), 200, hdrs);
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
      const heeftAantal  = it.aantal  !== undefined;
      const heeftGedempt = it.gedempt !== undefined;
      if (!heeftAantal && !heeftGedempt) return json({ error: `item voor ${it.materiaalId} heeft aantal of gedempt nodig` }, 400, hdrs);
      if (heeftAantal && (typeof it.aantal !== 'number' || !Number.isFinite(it.aantal) || it.aantal === 0)) {
        return json({ error: `ongeldig aantal voor ${it.materiaalId}` }, 400, hdrs);
      }
      if (heeftGedempt && typeof it.gedempt !== 'boolean') return json({ error: `ongeldige gedempt-waarde voor ${it.materiaalId}` }, 400, hdrs);
      if (heeftGedempt && actie !== 'mutatie') return json({ error: 'gedempt kan enkel bij actie mutatie' }, 400, hdrs);
    }

    const { current, error } = await pruneAndGet(store);
    if (error) return json({ error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }, 503, hdrs);

    if (versie !== current.versie) {
      return json({ error: 'Inventaris ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie, data: toResponse(current) }, 409, hdrs);
    }

    const wagenvoorraad = { ...current.wagenvoorraad };
    const stock = { ...(wagenvoorraad[technieker] || {}) };
    const nieuweLogRegels = [];
    const nu = new Date().toISOString();

    for (const it of items) {
      const bestaand = normStock(stock[it.materiaalId]);
      let nieuweAantal  = bestaand.aantal;
      let nieuweGedempt = bestaand.gedempt;

      if (it.aantal !== undefined) {
        // verbruik: 'aantal' is de gebruikte hoeveelheid (positief) -> wagenvoorraad daalt.
        // mutatie: 'aantal' is al signed (positief = aanvulling, negatief = correctie).
        const rawDelta = actie === 'verbruik' ? -Math.abs(it.aantal) : it.aantal;
        // Nooit onder 0 -- ook niet als een verlopen/racende client een te grote aftrek stuurt.
        // De gelogde 'aantal' is de ECHT toegepaste verandering (na klemmen), niet de
        // gevraagde -- zo blijft de log een waarheidsgetrouwe weergave van de voorraad.
        nieuweAantal = Math.max(0, bestaand.aantal + rawDelta);
        const toegepasteDelta = nieuweAantal - bestaand.aantal;

        if (toegepasteDelta !== 0) {
          const type   = actie === 'verbruik' ? 'verbruik' : (toegepasteDelta > 0 ? 'aanvulling' : 'correctie');
          const status = type === 'aanvulling' ? 'nieuw' : null;
          nieuweLogRegels.push({
            id: crypto.randomUUID(),
            technieker,
            materiaalId:   it.materiaalId,
            materiaalNaam: it.materiaalNaam,
            aantal: toegepasteDelta,
            datum: nu,
            type,
            status,
          });
        }
      }
      if (it.gedempt !== undefined) nieuweGedempt = it.gedempt;

      stock[it.materiaalId] = { aantal: nieuweAantal, gedempt: nieuweGedempt };
    }

    wagenvoorraad[technieker] = stock;

    const nieuw = {
      versie: current.versie + 1,
      wagenvoorraad,
      log: [...current.log, ...nieuweLogRegels],
    };

    try {
      await store.setJSON(BLOB_KEY, nieuw);
      return json(toResponse(nieuw), 200, hdrs);
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

    const { current, error } = await pruneAndGet(store);
    if (error) return json({ error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }, 503, hdrs);

    if (versie !== current.versie) {
      return json({ error: 'Inventaris ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie, data: toResponse(current) }, 409, hdrs);
    }

    const idx = current.log.findIndex(e => e.id === id);
    if (idx < 0) return json({ error: 'Logregel niet gevonden' }, 404, hdrs);
    if (current.log[idx].type !== 'aanvulling') return json({ error: 'Enkel aanvullingen kunnen als verwerkt gemarkeerd worden' }, 400, hdrs);

    const log = [...current.log];
    log[idx] = { ...log[idx], status: 'verwerkt' };

    const nieuw = { versie: current.versie + 1, wagenvoorraad: current.wagenvoorraad, log };

    try {
      await store.setJSON(BLOB_KEY, nieuw);
      return json(toResponse(nieuw), 200, hdrs);
    } catch (err) {
      return json({ error: 'Opslaan mislukt: ' + err.message }, 500, hdrs);
    }
  }

  return json({ error: 'Method not allowed' }, 405, hdrs);
};

export const config = { path: '/api/inventaris' };
