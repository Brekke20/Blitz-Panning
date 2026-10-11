// /api/sales — het verkoperblob `sales/<gebruikerId>` (leads + planningsblokken).
//   GET [?gebruiker=<id>]                -> 200 { gebruikerId, versie, leads, blokken, open }
//   PATCH [?gebruiker=<id>] { versie, leads?, blokken?, aanvullen? } -> 200 { ...blob, open } | 400 | 409 { serverVersie, data } | 503
//   DELETE ?lead=<id>[&gebruiker=<id>]   -> 200 { versie } | 404 (lead onbekend)
// Toegang: elke verkoper beheert zijn eigen leads; de beheerder elke verkoper; een verkoper met magAlleSales mag andere
// VERKOPERS lezen (nooit schrijven). Zie netlify/lib/sales-toegang.js. Rechtenrij: beheerder en sales; de wrapper doet de login
// en de X-Blitz-controle. De gebruikerslijst komt uit de echte store, de blobs uit de store van het verzoek (testmodus).
// Antwoorden bevatten nooit `grafstenen`; in logs en consolefouten staan enkel id's en fouttypes, nooit namen.
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { leesGebruikers } from '../lib/gebruikers.js';
import { logVoorVerzoek } from '../lib/activiteit.js';
import { authStore, OPSLAG_STORING } from '../lib/auth-antwoord.js';
import { bepaalDoel } from '../lib/sales-toegang.js';
import { haalSales, wijzigSales, verwijderLead } from '../lib/sales-acties.js';

const CORS = Object.freeze(maakCors({
  methoden: 'GET, PATCH, DELETE, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function maakHandler({
  getStore: haalStore, fetch = globalThis.fetch, nu = () => Date.now(),
  sleutel = () => process.env.TOMTOM_API_KEY, geheim = () => process.env.SESSIE_GEHEIM, auth,
} = {}) {
  const kern = async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      const testVerzoek = isTestVerzoek(req);
      if (testVerzoek) await zorgVoorTestkopie(haalStore);
      const aStore = await authStore(haalStore); // echte store: enkel voor de gebruikerslijst
      const store = await haalStore({ name: winkelNaam(req), consistency: 'strong' });
      const params = new URL(req.url).searchParams;
      const schrijven = req.method !== 'GET';

      const toegang = await bepaalDoel({
        gebruiker, gevraagdId: params.get('gebruiker'), schrijven, testVerzoek, leesGebruikers: () => leesGebruikers(aStore),
      });
      if (!toegang.ok) return json(toegang.status, { error: toegang.fout, ...(toegang.code ? { code: toegang.code } : {}) });
      const { doelId } = toegang;
      const log = d => logVoorVerzoek(req, gebruiker, d, { getStore: haalStore, nu });

      let uitkomst;
      if (req.method === 'GET') {
        uitkomst = await haalSales({ store, doelId });
      } else if (req.method === 'PATCH') {
        let body;
        try { body = await req.json(); } catch { return json(400, { error: 'Ongeldige JSON' }); }
        uitkomst = await wijzigSales({ store, doelId, body, nu, deps: { fetch, sleutel: sleutel(), testModus: testVerzoek }, log });
      } else {
        const leadId = params.get('lead');
        if (!leadId) return json(400, { error: 'lead ontbreekt' });
        uitkomst = await verwijderLead({ store, doelId, leadId, nu, geheim, log });
      }
      return json(uitkomst.status, uitkomst.json);
    } catch (e) {
      // Alleen het fouttype loggen: een Blobs-fout kan details bevatten. Fail closed.
      console.error('sales: opslag mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('sales', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/sales' };
