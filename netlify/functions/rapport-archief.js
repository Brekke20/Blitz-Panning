// /api/rapport-archief
// GET  → lijst van gearchiveerde rapports (publiek); ?id=<id> één rapport; ?inhoud=<id> de HTML
// POST → nieuw rapport archiveren; { opnieuw: <id> } = mislukt rapport opnieuw versturen
// Achter de rechtentabel (beveiligV2): een technieker ziet/wijzigt enkel zijn eigen rapporten.

import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import {
  LIJST_KEY as BLOB_KEY, LEGE_LIJST as EMPTY,
  bepaalDedupVelden, bouwEntry, voegToeOfWerkBij,
} from '../lib/rapportlijst.js';
import { haalRapportInhoud, verwerkOpnieuw } from '../lib/rapport-archief-acties.js';
import { startAchtergrondtaak } from '../lib/rapport-achtergrond.js';
import { isGeldigId, vergeetEntry } from '../lib/rapport-inhoud.js';
import { archiveerAfgevallen } from '../lib/rapport-jaararchief.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { isEigenNaam, isEigenRapport, filterRapportenVoor } from '../lib/eigen.js';
import { logVoorVerzoek } from '../lib/activiteit.js';

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

// Hoort het rapport met dit id bij deze (technieker-)gebruiker? Onbekend id = nee.
async function isEigenRapportId(store, id, gebruiker) {
  try {
    const lijst = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY;
    const treffers = lijst.rapports.filter(r => r.id === id);
    return treffers.length > 0 && treffers.every(r => isEigenRapport(gebruiker, r));
  } catch { return false; }
}

const GEEN_RECHT = { error: 'Je kan enkel je eigen rapporten wijzigen.', code: 'geen-recht' };

export function maakHandler({ getStore: haalStore = getStore } = {}) {
  const kern = async (req, context, gebruiker) => {
    const hdrs  = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

    const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });

    if (isTestVerzoek(req)) await zorgVoorTestkopie(haalStore);

    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const params = new URL(req.url).searchParams;
      if (params.has('inhoud')) {
        // Een technieker leest enkel de inhoud van zijn eigen rapporten (een collega's rapport bestaat voor hem niet).
        if (gebruiker?.rol === 'technieker' && !(await isEigenRapportId(store, params.get('inhoud'), gebruiker))) {
          return new Response(JSON.stringify({ error: 'Rapportinhoud niet gevonden' }), { status: 404, headers: { ...hdrs, 'Content-Type': 'application/json' } });
        }
        const uit = await haalRapportInhoud(store, params.get('inhoud'));
        return new Response(JSON.stringify(uit.body), {
          status: uit.status,
          headers: { ...hdrs, 'Content-Type': 'application/json' },
        });
      }
      const id = params.get('id');
      try {
        const opgeslagen = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY;
        // Een technieker ziet enkel zijn eigen rapporten (een rapport van een collega bestaat voor hem niet).
        const raw = { ...opgeslagen, rapports: filterRapportenVoor(gebruiker, opgeslagen.rapports) };
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
        if (gebruiker?.rol === 'technieker' && !(await isEigenRapportId(store, body.opnieuw, gebruiker))) {
          return new Response(JSON.stringify(GEEN_RECHT), { status: 403, headers: { ...hdrs, 'Content-Type': 'application/json' } });
        }
        const uit = await verwerkOpnieuw({ store, id: body.opnieuw });
        if (uit.startNodig) {
          await startAchtergrondtaak({ origin: new URL(req.url).origin, id: body.opnieuw, testModus: isTestVerzoek(req) });
        }
        return new Response(JSON.stringify(uit.body), {
          status: uit.status,
          headers: { ...hdrs, 'Content-Type': 'application/json' },
        });
      }

      // Een technieker archiveert enkel rapporten op zijn eigen naam.
      if (gebruiker?.rol === 'technieker' && !isEigenNaam(gebruiker, body?.technieker)) {
        return new Response(JSON.stringify(GEEN_RECHT), { status: 403, headers: { ...hdrs, 'Content-Type': 'application/json' } });
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

      // Een technieker dedupt enkel op zijn EIGEN entry: staat het rapport voor dit ticket+datum op naam van een collega,
      // dan blijft dat onaangeroerd en komt het zijne als nieuwe entry erbij (beide rapporten blijven bewaard).
      const eigenDedup = r => gebruiker?.rol !== 'technieker' || isEigenRapport(gebruiker, r);
      // Een technieker mag nooit een rapport van een collega verbergen of overschrijven via een gelijk id: elk ANDER
      // rapport dan het dedup-doel met dit id moet van hem zijn.
      if (gebruiker?.rol === 'technieker') {
        const dupIdx = entry.ticketId
          ? current.rapports.findIndex(r => r.ticketId === entry.ticketId && r.datum === entry.datum && eigenDedup(r))
          : -1;
        const botsing = current.rapports.some((r, i) => i !== dupIdx && r.id === entry.id && !isEigenRapport(gebruiker, r));
        if (botsing) {
          return new Response(JSON.stringify(GEEN_RECHT), { status: 403, headers: { ...hdrs, 'Content-Type': 'application/json' } });
        }
      }
      const { rapports: updatedList, afgevallen } = voegToeOfWerkBij(current.rapports, entry, body, { eigenFilter: eigenDedup });

      const nieuw = {
        versie:   current.versie + 1,
        rapports: updatedList, // voegToeOfWerkBij kapt af op MAX_RAPPORTEN
      };
      await store.setJSON(BLOB_KEY, nieuw);
      // Best-effort jaar-archief voor de entries die door de afkapping uit de lijst vallen (nooit een fout voor de POST).
      if (afgevallen.length) {
        try { await archiveerAfgevallen(store, afgevallen); }
        catch (err) { console.error('[rapport-archief] jaar-archief mislukt:', err?.message || err); }
      }

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

      // Een technieker verwijdert enkel zijn eigen rapporten: ALLE rapporten met dit id moeten van hem zijn.
      if (gebruiker?.rol === 'technieker') {
        if (current.rapports.some(r => r.id === id && !isEigenRapport(gebruiker, r))) {
          return new Response(JSON.stringify(GEEN_RECHT), { status: 403, headers: { ...hdrs, 'Content-Type': 'application/json' } });
        }
      }

      const filtered = current.rapports.filter(r => r.id !== id);
      if (filtered.length === current.rapports.length) {
        return new Response(JSON.stringify({ error: 'Rapport niet gevonden' }), { status: 404, headers: { ...hdrs, 'Content-Type': 'application/json' } });
      }

      const nieuweVersie = current.versie + 1;
      await store.setJSON(BLOB_KEY, { versie: nieuweVersie, rapports: filtered });
      if (isGeldigId(id)) await vergeetEntry(store, id); // best-effort: voorkomt dat verwerkRapport het rapport terugzet
      // Elke verwijdering is zichtbaar in het activiteitenlog (eindreview I4): ook de technieker mag zijn eigen rapport verwijderen.
      const weg = current.rapports.filter(r => r.id === id);
      await logVoorVerzoek(req, gebruiker, {
        actie: 'rapport-verwijderd',
        onderwerp: String(weg[0]?.ticketNumber || weg[0]?.ticketId || id).slice(0, 60),
        details: { id: String(id).slice(0, 60), technieker: String(weg[0]?.technieker ?? '').slice(0, 100), klant: String(weg[0]?.klant ?? '').slice(0, 100) },
      }, { getStore: haalStore });
      return new Response(JSON.stringify({ ok: true, versie: nieuweVersie }), { status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }

    return new Response('Method Not Allowed', { status: 405, headers: hdrs });
  };

  return beveiligV2('rapport-archief', kern);
}

export default maakHandler();

export const config = { path: '/api/rapport-archief' };
