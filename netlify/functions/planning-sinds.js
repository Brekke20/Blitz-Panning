// /api/planning-sinds
//   POST { opzoeken: [ticketId], actief: [ticketId] } -> { sinds: { [id]: ISO|null } }
// Sinds wanneer zit een ticket in het planningstraject? Afgeleid uit de Zoho-statusgeschiedenis
// (enkel lezen), bewaard in een register in Blobs zodat elk ticket maar één keer wordt opgezocht.
// Testmodus (X-Blitz-Test: 1): nooit Zoho, antwoord { sinds: {} }.
import { getStore } from '@netlify/blobs';
import { isTestVerzoek, winkelNaam } from '../lib/testmodus.js';
import { berekenSinds, volgendePaginaNodig, leesRegister, schrijfRegister } from '../lib/planningsinds.js';
import { maakZoho } from '../lib/zoho.js';
import { maakCors, v2Json, v2Methode } from '../lib/http.js';
const PAGINA_GROOTTE = 50;
const MAX_PAGINAS    = 4;
const MAX_NIEUW      = 20;
const BATCH          = 5;

const CORS = maakCors({
  methoden: 'POST, OPTIONS',
  headers: 'Content-Type, X-Blitz-Test',
  inhoudType: 'application/json',
});

const ticketIds = v => (Array.isArray(v) ? v : []).map(String).filter(id => /^\d+$/.test(id));

export function maakHandler({ getStore: haalStore, fetch: doFetch }) {
  // Tokencache per handler-instantie (niet op moduleniveau: geen lekken tussen tests).
  const zoho = maakZoho({ fetch: doFetch, tokenFoutMetData: false });

  // Zoekt één ticket op; gooit bij elke Zoho-fout.
  async function zoekSinds(id, { token, orgId }) {
    let events = [];
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const from = 1 + pagina * PAGINA_GROOTTE;
      const res = await zoho.verzoek(
        `/tickets/${id}/History?fieldName=status&limit=${PAGINA_GROOTTE}&from=${from}`, { token, orgId });
      if (!res.ok) throw new Error(`Zoho history ${res.status}`);
      // 204 / lege body = geen (verdere) history.
      const tekst = await res.text();
      const data = tekst ? JSON.parse(tekst) : {};
      const blok = Array.isArray(data.data) ? data.data : [];
      events = events.concat(blok);
      if (!volgendePaginaNodig(blok, PAGINA_GROOTTE)) break;
    }
    // createdTime enkel ophalen als het nodig is (geen verlaat-event gevonden).
    let sinds = berekenSinds(events, null);
    if (!sinds) {
      const res = await zoho.verzoek(`/tickets/${id}`, { token, orgId });
      if (!res.ok) throw new Error(`Zoho ticket ${res.status}`);
      const t = await res.json();
      sinds = berekenSinds(events, t.createdTime);
    }
    return sinds || null;
  }

  return async (req) => {
    const methode = v2Methode(req, ['POST'], CORS);
    if (methode) return methode;

    let body;
    try { body = await req.json(); } catch { return v2Json(400, { error: 'Ongeldige JSON' }, CORS); }
    if (!body || typeof body !== 'object') return v2Json(400, { error: 'Ongeldige JSON' }, CORS);

    if (isTestVerzoek(req)) return v2Json(200, { sinds: {} }, CORS);

    const opzoeken = [...new Set(ticketIds(body.opzoeken))];
    const actiefGegeven = Array.isArray(body.actief);
    const actief = new Set(ticketIds(body.actief));

    let store = null;
    let register = {};
    try {
      store = haalStore({ name: winkelNaam(req), consistency: 'strong' });
      register = await leesRegister(store);
    } catch (e) {
      console.error('planning-sinds: register lezen mislukt:', e?.message || e);
    }

    const sinds = {};
    const nieuw = [];
    for (const id of opzoeken) {
      if (register[id]?.sinds) sinds[id] = register[id].sinds;
      else nieuw.push(id);
    }
    const teDoen = nieuw.slice(0, MAX_NIEUW);
    for (const id of nieuw.slice(MAX_NIEUW)) sinds[id] = null;

    let gewijzigd = false;

    if (teDoen.length) {
      try {
        const toegang = await zoho.haalToegang();

        for (let i = 0; i < teDoen.length; i += BATCH) {
          const batch = teDoen.slice(i, i + BATCH);
          const uitkomsten = await Promise.all(batch.map(async id => {
            try { return await zoekSinds(id, toegang); }
            catch (e) { console.error(`planning-sinds: ticket ${id} mislukt:`, e?.message || e); return null; }
          }));
          batch.forEach((id, k) => {
            sinds[id] = uitkomsten[k];
            if (uitkomsten[k]) { register[id] = { sinds: uitkomsten[k] }; gewijzigd = true; }
          });
        }
      } catch (e) {
        // Token/org-fout: alle nog niet bepaalde opzoekingen worden null.
        console.error('planning-sinds: Zoho niet bereikbaar:', e?.message || e);
        for (const id of teDoen) if (!(id in sinds)) sinds[id] = null;
      }
    }

    // Entries van tickets die niet meer actief zijn opruimen.
    if (actiefGegeven) {
      for (const id of Object.keys(register)) {
        if (!actief.has(id)) { delete register[id]; gewijzigd = true; }
      }
    }

    if (gewijzigd && store) {
      try { await schrijfRegister(store, register); }
      catch (e) { console.error('planning-sinds: register schrijven mislukt:', e?.message || e); }
    }

    return v2Json(200, { sinds }, CORS);
  };
}

export default maakHandler({ getStore, fetch: globalThis.fetch });

export const config = { path: '/api/planning-sinds' };
