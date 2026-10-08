// /api/activiteit — activiteitenlog lezen (enkel beheerder).
//   GET ?van=<YYYY-MM-DD>&tot=<YYYY-MM-DD>&gebruiker=<id>&actie=<naam>
//     -> { items: Activiteit[], gebruikers: [{ id, naam }] }
// Nieuwste eerst, maximaal 1000. `van` en `tot` zijn hele dagen (UTC, grenzen inbegrepen); `van` na `tot` geeft een
// lege lijst; een ongeldige datum geeft 400. `gebruikers` komt uit de log zelf (binnen het datumbereik, vóór de
// gebruiker- en actiefilter) zodat de filterlijst volledig blijft. Het log staat altijd in de ECHTE store.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { leesActiviteit } from '../lib/activiteit.js';
import { authStore, OPSLAG_STORING } from '../lib/auth-antwoord.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));
const DATUM_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TEKST = 100;

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status, headers: { ...CORS, 'Cache-Control': 'no-store' },
});

// 'YYYY-MM-DD' (echte kalenderdag) -> ms van het begin (of einde) van die dag in UTC; anders null.
function dagMs(tekst, einde) {
  const m = DATUM_RE.exec(tekst);
  if (!m) return null;
  const [jaar, maand, dag] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const begin = Date.UTC(jaar, maand - 1, dag);
  const d = new Date(begin);
  if (d.getUTCFullYear() !== jaar || d.getUTCMonth() !== maand - 1 || d.getUTCDate() !== dag) return null;
  return einde ? begin + 86400000 - 1 : begin;
}

function leesTekst(params, naam) {
  const w = params.get(naam);
  return w === null || w === '' ? undefined : w.slice(0, MAX_TEKST);
}

function gebruikersUit(items) {
  const gezien = new Map(); // nieuwste eerst: de eerste naam per id is de recentste
  for (const it of items) {
    if (typeof it?.gebruikerId === 'string' && it.gebruikerId && !gezien.has(it.gebruikerId)) {
      gezien.set(it.gebruikerId, { id: it.gebruikerId, naam: typeof it.naam === 'string' ? it.naam : it.gebruikerId });
    }
  }
  return [...gezien.values()];
}

export function maakHandler({ getStore: haalStore, auth } = {}) {
  const kern = async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const params = new URL(req.url).searchParams;
    const vanTekst = leesTekst(params, 'van'), totTekst = leesTekst(params, 'tot');
    const van = vanTekst === undefined ? undefined : dagMs(vanTekst, false);
    const tot = totTekst === undefined ? undefined : dagMs(totTekst, true);
    if (van === null || tot === null) return json(400, { error: 'Ongeldige datum: gebruik het formaat JJJJ-MM-DD.' });
    const gebruikerId = leesTekst(params, 'gebruiker');
    const actie = leesTekst(params, 'actie');

    try {
      const store = authStore(haalStore);
      const bereik = { van, tot };
      const gefilterd = gebruikerId !== undefined || actie !== undefined;
      const items = await leesActiviteit(store, { ...bereik, gebruikerId, actie });
      const basis = gefilterd ? await leesActiviteit(store, bereik) : items;
      return json(200, { items, gebruikers: gebruikersUit(basis) });
    } catch (e) {
      console.error('activiteit: lezen mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('activiteit', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/activiteit' };
