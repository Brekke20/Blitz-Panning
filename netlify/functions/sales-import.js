// /api/sales-import — POST { export: <object> }: het exportbestand van de verkoper importeren in het EIGEN blob.
//   200 { versie, samenvatting, export, open } | 400 { error } | 413 (body > 3 MB) | 503 opslag-storing
// Enkel de rol sales (rechtenrij); de wrapper doet de login en de X-Blitz-controle. Nooit een ?gebruiker= (altijd het eigen blob).
// Antwoorden bevatten nooit `grafstenen`; in logs en consolefouten staan enkel fouttypes, nooit persoonsgegevens.
import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { logVoorVerzoek } from '../lib/activiteit.js';
import { OPSLAG_STORING } from '../lib/auth-antwoord.js';
import { importeerExport } from '../lib/sales-import-server.js';

const MAX_BODY_BYTES = 3 * 1024 * 1024; // het bestand zelf mag 2 MB zijn; de rest is de omhulling { export: ... }

const CORS = Object.freeze(maakCors({
  methoden: 'POST, OPTIONS', headers: 'Content-Type, X-Blitz, X-Blitz-Test', inhoudType: 'application/json',
}));

const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });

export function maakHandler({
  getStore: haalStore, fetch = globalThis.fetch, nu = () => Date.now(),
  sleutel = () => process.env.TOMTOM_API_KEY, geheim = () => process.env.SESSIE_GEHEIM, auth, nieuwId = () => randomUUID(),
} = {}) {
  const kern = async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      let tekst;
      try { tekst = await req.text(); } catch { return json(400, { error: 'Ongeldige JSON' }); }
      if (Buffer.byteLength(tekst, 'utf8') > MAX_BODY_BYTES) return json(413, { error: 'Het bestand is groter dan 2 MB' });
      let body;
      try { body = JSON.parse(tekst); } catch { return json(400, { error: 'Ongeldige JSON' }); }

      const testVerzoek = isTestVerzoek(req);
      if (testVerzoek) await zorgVoorTestkopie(haalStore);
      const store = await haalStore({ name: winkelNaam(req), consistency: 'strong' });
      const uitkomst = await importeerExport({
        store, doelId: gebruiker.id, body, nu, nieuwId,
        deps: { fetch, sleutel: sleutel(), testModus: testVerzoek, geheim },
        log: d => logVoorVerzoek(req, gebruiker, d, { getStore: haalStore, nu }),
      });
      return json(uitkomst.status, uitkomst.json);
    } catch (e) {
      // Alleen het fouttype loggen: een Blobs-fout kan details bevatten. Fail closed.
      console.error('sales-import: opslag mislukt (' + (e?.name || 'Error') + ')');
      return json(503, OPSLAG_STORING);
    }
  };
  return beveiligV2('sales-import', kern, auth ? { auth } : undefined);
}

export default maakHandler({ getStore });

export const config = { path: '/api/sales-import' };
