// /api/mail-check
//   GET ?ticketId=<numeriek>&verlopenMs=<0..900000>[&ontvangers=a@x.be,b@y.be]
//     -> { ok, verzonden, twijfel, tijdstip, uitgaand: [{ aan, tijdstip }], ontvangers? }
// Is er op dit ticket in de laatste `verlopenMs` milliseconden (sinds de start van de verzending) al een uitgaande e-mail verstuurd?
// De client stuurt enkel de verstreken tijd; de server rekent `sinds = nu - verlopenMs` met zijn eigen klok (geen klokafhankelijkheid van het toestel). Voor de controle na een onzeker resultaat
// (time-out, netwerkfout of 502/503/504) van /api/propose, /api/send-rapport en /api/annuleer (etappe 7, Q1).
// ENKEL LEZEN: één GET op Zoho Desk /tickets/{id}/threads (met paginering), nooit sendReply, PATCH of een andere schrijfactie.
// Geen Zoho-gegevens in het antwoord buiten adres en tijdstip. Testmodus (X-Blitz-Test: 1): nooit Zoho.
import { isTestVerzoek, nepZohoAntwoord } from '../lib/testmodus.js';
import { maakZoho, leesJsonVeilig } from '../lib/zoho.js';
import { maakCors, v2Json, v2Methode } from '../lib/http.js';
import { GELDIG_ADRES_RE, MAX_VERLOPEN_MS, KLOKMARGE_MS, BREDE_KLOKMARGE_MS, uitgaandeMails, beoordeel } from '../lib/mailcontrole.js';
import { beveiligV2 } from '../lib/beveiligd.js';

const PAGINA_GROOTTE = 100;
const MAX_PAGINAS    = 5;
const MAX_ONTVANGERS = 10;

const CORS = maakCors({ methoden: 'GET, OPTIONS', headers: 'Content-Type, X-Blitz-Test', inhoudType: 'application/json' });
const json = (status, obj) => v2Json(status, obj, CORS);

export function maakHandler({ fetch: doFetch, nu = () => Date.now() }) {
  // Tokencache per handler-instantie (niet op moduleniveau: geen lekken tussen tests).
  const zoho = maakZoho({ fetch: doFetch, tokenFoutMetData: false });

  return async (req) => {
    const methode = v2Methode(req, ['GET'], CORS);
    if (methode) return methode;

    const params = new URL(req.url).searchParams;
    const ticketId = params.get('ticketId') || '';
    if (!/^\d+$/.test(ticketId)) return json(400, { error: 'ticketId (numeriek) is verplicht' });
    const verlopenTekst = params.get('verlopenMs') || '';
    const verlopenMs = /^\d{1,7}$/.test(verlopenTekst) ? Number(verlopenTekst) : NaN;
    if (Number.isNaN(verlopenMs) || verlopenMs > MAX_VERLOPEN_MS) {
      return json(400, { error: `verlopenMs (geheel getal van 0 tot ${MAX_VERLOPEN_MS}) is verplicht` });
    }
    const sindsMs = nu() - verlopenMs; // serverklok
    const lijst = (params.get('ontvangers') || '').split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
    if (lijst.length > MAX_ONTVANGERS || !lijst.every(a => GELDIG_ADRES_RE.test(a))) {
      return json(400, { error: `ontvangers moet een lijst van maximaal ${MAX_ONTVANGERS} e-mailadressen zijn` });
    }
    const verwacht = [...new Set(lijst)];

    if (isTestVerzoek(req)) {
      return json(200, nepZohoAntwoord({ verzonden: false, twijfel: false, tijdstip: null, uitgaand: [] }));
    }

    try {
      const { token, orgId } = await zoho.haalToegang();
      const threads = [];
      let volledig = false;
      let beoordeeld = null;
      let uitgaand = [];
      const opties = verwacht.length ? { marge: KLOKMARGE_MS, verwachtAdressen: true } : { marge: BREDE_KLOKMARGE_MS };
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        const from = 1 + pagina * PAGINA_GROOTTE;
        const res = await zoho.verzoek(`/tickets/${ticketId}/threads?from=${from}&limit=${PAGINA_GROOTTE}`, { token, orgId });
        if (res.status === 404) return json(404, { error: 'Ticket niet gevonden' });
        // 204 / lege body = geen (verdere) threads.
        if (!res.ok) return json(502, { error: `Zoho threads ophalen mislukt (${res.status})` });
        const data = await leesJsonVeilig(res);
        const blok = Array.isArray(data.data) ? data.data : [];
        threads.push(...blok);
        const gelezen = uitgaandeMails(threads, sindsMs, opties);
        uitgaand = gelezen.uitgaand;
        beoordeeld = beoordeel(uitgaand, verwacht, gelezen.twijfel);
        if (blok.length < PAGINA_GROOTTE) { volledig = true; break; }
        if (beoordeeld.verzonden) break; // een gevonden mail blijft gevonden, ook zonder de rest te lezen
      }
      // Niet alle pagina's gelezen en nog niets (volledigs) gevonden: geen uitspraak mogelijk.
      if (!volledig && !beoordeeld.verzonden) {
        return json(502, { error: 'Te veel threads om te controleren' });
      }
      return json(200, { ok: true, ...beoordeeld, uitgaand });
    } catch (err) {
      console.error('mail-check fout:', err);
      return json(500, { error: err.message });
    }
  };
}

export default beveiligV2('mail-check', maakHandler({ fetch: globalThis.fetch }));

export const config = { path: '/api/mail-check' };
