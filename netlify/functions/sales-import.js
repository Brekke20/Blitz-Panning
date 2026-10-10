// /api/sales-import — POST [?gebruiker=<id>] { export: <object> }: het exportbestand van de verkoper importeren in het EIGEN blob.
//   200 { versie, samenvatting, export, open } | 400 { error } | 403 | 404 | 413 (body > 3 MB) | 503 opslag-storing
// Rollen sales en beheerder (rechtenrij); de wrapper doet de login en de X-Blitz-controle. Een verkoper importeert (en voegt leads toe)
// enkel in het EIGEN blob (een ander ?gebruiker= -> 403). De beheerder mag ENKEL een manuele lead toevoegen (bron 'manueel', "+ Lead"),
// voor de verkoper in ?gebruiker= (een actieve gebruiker met rol sales; anders 404 of 403 geblokkeerd); een echt exportbestand -> 403.
// Antwoorden bevatten nooit `grafstenen`; in logs en consolefouten staan enkel fouttypes, nooit persoonsgegevens.
import { randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { beveiligV2 } from '../lib/beveiligd.js';
import { maakCors } from '../lib/http.js';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { logVoorVerzoek } from '../lib/activiteit.js';
import { OPSLAG_STORING, authStore } from '../lib/auth-antwoord.js';
import { leesGebruikers } from '../lib/gebruikers.js';
import { bepaalDoel } from '../lib/sales-toegang.js';
import { MANUEEL } from '../../public/js/sales/manueel.js';
import { importeerExport } from '../lib/sales-import-server.js';

const GEEN_RECHT = Object.freeze({ error: 'Je hebt hier geen toegang toe.', code: 'geen-recht' });
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
      // Eerst de aangekondigde grootte (goedkoop, vóór het lezen); de controle op de gelezen tekst blijft gelden (header kan ontbreken of liegen).
      const aangekondigd = Number(req.headers.get('content-length'));
      if (Number.isFinite(aangekondigd) && aangekondigd > MAX_BODY_BYTES) return json(413, { error: 'Het bestand is groter dan 2 MB' });
      let tekst;
      try { tekst = await req.text(); } catch { return json(400, { error: 'Ongeldige JSON' }); }
      if (Buffer.byteLength(tekst, 'utf8') > MAX_BODY_BYTES) return json(413, { error: 'Het bestand is groter dan 2 MB' });
      let body;
      try { body = JSON.parse(tekst); } catch { return json(400, { error: 'Ongeldige JSON' }); }

      const testVerzoek = isTestVerzoek(req);
      if (testVerzoek) await zorgVoorTestkopie(haalStore);
      // De beheerder voegt enkel een manuele lead toe (geen exportbestand); wie het doel mag zijn, bepaalt dezelfde regel als in /api/sales.
      if (gebruiker.rol === 'beheerder' && body?.export?.bron !== MANUEEL) return json(403, GEEN_RECHT);
      const aStore = await authStore(haalStore); // echte store: enkel voor de gebruikerslijst
      const gevraagdId = new URL(req.url).searchParams.get('gebruiker');
      const toegang = await bepaalDoel({
        gebruiker, gevraagdId, schrijven: true, testVerzoek, leesGebruikers: () => leesGebruikers(aStore),
      });
      if (!toegang.ok) return json(toegang.status, { error: toegang.fout, ...(toegang.code ? { code: toegang.code } : {}) });
      const store = await haalStore({ name: winkelNaam(req), consistency: 'strong' });
      const uitkomst = await importeerExport({
        store, doelId: toegang.doelId, voorVerkoper: toegang.doelId !== gebruiker.id, body, nu, nieuwId,
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
