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
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakZoho } from '../lib/zoho.js';
import { eisEigenTicket } from '../lib/eigen-ticket.js';
import { isDeepStrictEqual } from 'node:util';

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

// De klantbeschikbaarheid van een ticket zonder het tijdstip van de laatste wijziging (om te zien of er echt iets veranderde).
const zonderTijd = (e) => { if (!e) return undefined; const { bijgewerkt: _b, ...rest } = e; return rest; };

// De opschoning van één entry (null = lege entry: wordt niet bewaard).
function schoonEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
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
  if (!voorkeurClean && !voorkeurTijd && !geblokkeerd.length && !notitie && !duurOverride) return null;
  return {
    voorkeur:     voorkeurClean,
    voorkeurTijd,
    geblokkeerd,
    notitie,
    ...(duurOverride ? { duurOverride } : {}),
    bijgewerkt:   entry.bijgewerkt || new Date().toISOString(),
  };
}

// Een technieker met "Mag zelf plannen" wijzigt enkel de klantbeschikbaarheid van zijn eigen tickets. Per ticket waarvan de inhoud
// verandert of verdwijnt beslist Zoho (eisEigenTicket); bewaard wordt wat hij mag. Een wijziging van een collega (of een niet te
// toetsen id) wordt GENEGEERD: de huidige entry blijft staan en de rest van zijn bewaring slaagt gewoon (de client ruimt bij elke
// start verouderde entries van gesloten tickets en collega's op, dat mag zijn bewaring nooit doen mislukken). Een entry van een ticket
// dat in Zoho niet meer bestaat mag hij enkel laten verdwijnen, nooit wijzigen. Kan Zoho het niet beantwoorden: 503 (er wordt niets bewaard).
const MAX_TOETSEN = 10; // gewijzigde tickets die per bewaring bij Zoho gecontroleerd worden (wijzigingen eerst, dan verwijderingen)
const TOETS_PARALLEL = 5;
async function beperkTotEigen({ gebruiker, zoho, huidigeItems, cleaned }) {
  const huidigSchoon = {};
  for (const [id, e] of Object.entries(huidigeItems)) { const sch = schoonEntry(e); if (sch) huidigSchoon[id] = sch; }
  const gewijzigd = [...new Set([...Object.keys(cleaned), ...Object.keys(huidigSchoon)])]
    .filter(id => !isDeepStrictEqual(zonderTijd(cleaned[id]), zonderTijd(huidigSchoon[id])));
  const teToetsen = [...gewijzigd.filter(id => cleaned[id]), ...gewijzigd.filter(id => !cleaned[id])].slice(0, MAX_TOETSEN);
  const uitslag = new Map(); // id -> 'ja' | 'weg' | 'nee'
  let storing = null;
  for (let i = 0; i < teToetsen.length; i += TOETS_PARALLEL) {
    const groep = teToetsen.slice(i, i + TOETS_PARALLEL);
    const antwoorden = await Promise.all(groep.map(async (id) => {
      if (!/^\d+$/.test(id)) return [id, { ok: false, status: 403 }];
      return [id, await eisEigenTicket({ gebruiker, ticketId: id, zoho })];
    }));
    for (const [id, eis] of antwoorden) {
      if (eis.ok) uitslag.set(id, 'ja');
      else if (eis.status === 404) uitslag.set(id, 'weg');
      else if (eis.status === 503) storing = eis;
      else uitslag.set(id, 'nee');
    }
  }
  if (storing) return { storing };
  const items = {};
  const genegeerd = [];
  for (const id of new Set([...Object.keys(huidigeItems), ...Object.keys(cleaned)])) {
    if (!gewijzigd.includes(id)) { if (huidigeItems[id]) items[id] = huidigeItems[id]; continue; } // ongewijzigd: de bestaande entry blijft zoals ze is
    const u = uitslag.get(id);
    if (u === 'ja' || (u === 'weg' && !cleaned[id])) { if (cleaned[id]) items[id] = cleaned[id]; continue; }
    if (huidigeItems[id]) items[id] = huidigeItems[id];
    genegeerd.push(id);
  }
  return { items, genegeerd };
}

// `getStore` en `zoho` zijn testnaden; `auth` vervangt de standaardcontrole van de wrapper.
export function maakHandler({ getStore: haalStore = getStore, zoho = maakZoho({ tokenFoutMetData: false }), auth } = {}) {
  const kern = async (req, context, gebruiker) => {
    const hdrs  = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

    const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });

    if (isTestVerzoek(req)) await zorgVoorTestkopie(haalStore);

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
        const schoon = schoonEntry(entry);
        if (schoon) cleaned[ticketId] = schoon;
      }

      // Een technieker met "Mag zelf plannen" (zie beperkTotEigen); een testverzoek raakt enkel de testopslag.
      let teBewaren = cleaned;
      let genegeerd = null;
      if (gebruiker?.rol === 'technieker' && !isTestVerzoek(req)) {
        const huidigeItems = current.items && typeof current.items === 'object' ? current.items : {};
        const r = await beperkTotEigen({ gebruiker, zoho, huidigeItems, cleaned });
        if (r.storing) {
          return new Response(JSON.stringify(r.storing.body), { status: r.storing.status, headers: { ...hdrs, 'Content-Type': 'application/json' } });
        }
        teBewaren = r.items;
        genegeerd = r.genegeerd;
      }

      const nieuw = { versie: current.versie + 1, bijgewerkt: new Date().toISOString(), items: teBewaren };
      await store.setJSON(BLOB_KEY, nieuw);

      return new Response(JSON.stringify(genegeerd && genegeerd.length ? { ...nieuw, genegeerd } : nieuw), {
        status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    return new Response('Method Not Allowed', { status: 405, headers: hdrs });
  };

return beveiligV2('klantbeschikbaarheid', kern, auth ? { auth } : undefined);
}

export default maakHandler();

export const config = { path: '/api/klantbeschikbaarheid' };
