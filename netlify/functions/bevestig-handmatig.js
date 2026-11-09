// /api/bevestig-handmatig
//   POST { ticketId } -> de planner registreert dat de klant PER MAIL bevestigd heeft (de klant antwoordde op de voorstelmail in plaats
//   van op de knop te klikken). Controleert dat het ticket in Zoho nog op 'Wachten op bevestiging planning' staat, zet het op
//   'Geplande support' (dezelfde overgang als de bevestigingslink in confirm-afspraak.js; het ticket moet ook een afspraakdatum hebben), schrijft een interne notitie
//   ("Bevestigd per mail, geregistreerd door <planner>"), markeert het voorstelregister (`bevestigd: { door: 'mail', tijdstip, wie }`)
//   en logt de actie. Antwoord: { ok, status: 'Geplande support' } (200), 409 als de status intussen anders is, 502 bij een Zoho-fout.
// De naam van de planner komt uit de sessie, nooit uit het verzoek. Een technieker met "Mag zelf plannen" bevestigt enkel zijn eigen
// tickets (eisEigenTicket). Testmodus (X-Blitz-Test: 1): nooit Zoho; enkel het register in de teststore.
// De ticket-momentopname wordt als verouderd gemarkeerd door metTicketsVerouderd (binnen de beveiliging).
import { getStore } from '@netlify/blobs';
import { isTestVerzoek, winkelNaam, nepZohoAntwoord, zorgVoorTestkopie } from '../lib/testmodus.js';
import { markeerBevestigd } from '../lib/voorstelregister.js';
import { handmatigeBevestigingsNotitie, tijdstipNuBrussel, datumInBrussel } from '../lib/bevestigingslink.js';
import { maakZoho } from '../lib/zoho.js';
import { eisEigenTicket } from '../lib/eigen-ticket.js';
import { maakCors, v2Json, v2Opties } from '../lib/http.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { metTicketsVerouderd } from '../lib/tickets-snapshot.js';
import { logVoorVerzoek } from '../lib/activiteit.js';

const STATUS_PENDING = 'Wachten op bevestiging planning';
const STATUS_BEVESTIGD = 'Geplande support';

const CORS = maakCors({ methoden: 'POST, OPTIONS', headers: 'Content-Type, X-Blitz-Test', inhoudType: 'application/json' });
const json = (status, obj) => v2Json(status, obj, CORS);

export function maakHandler({ getStore: haalStore, fetch: doFetch }) {
  // Tokencache per handler-instantie (niet op moduleniveau: geen lekken tussen tests).
  const zoho = maakZoho({ fetch: doFetch, tokenFoutMetData: false });

  async function addZohoComment(ticketId, accessToken, orgId, content) {
    // Enkel loggen bij een fout: de bevestiging zelf is op dit punt al gelukt.
    try {
      const res = await zoho.verzoek(`/tickets/${ticketId}/comments`, {
        token: accessToken, orgId, methode: 'POST', json: { content, isPublic: false },
      });
      if (!res.ok) console.error('Zoho ticket-comment mislukt:', res.status, await res.text().catch(() => ''));
    } catch (e) {
      console.error('Zoho ticket-comment mislukt:', e?.message || e);
    }
  }

  return async (req, _context, gebruiker) => {
    if (req.method === 'OPTIONS') return v2Opties(CORS);
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });

    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Ongeldige JSON' }); }
    if (!body || typeof body !== 'object') return json(400, { error: 'Ongeldige JSON' });

    const test = isTestVerzoek(req);
    // Buiten testmodus is ticketId strikt numeriek; enkel in testmodus (voorbeeldtickets als "p1") volstaat een korte veilige id.
    const idOk = test ? /^[A-Za-z0-9_-]{1,20}$/ : /^\d+$/;
    if (!idOk.test(String(body.ticketId ?? ''))) return json(400, { error: 'ticketId (numeriek) is verplicht' });
    const ticketId = String(body.ticketId);
    const naam = typeof gebruiker?.naam === 'string' ? gebruiker.naam.trim().slice(0, 100) : '';
    const tijdstip = new Date().toISOString();

    if (test) {
      await zorgVoorTestkopie(haalStore);
      const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });
      await markeerBevestigd(store, ticketId, { door: 'mail', tijdstip, wie: naam });
      return json(200, nepZohoAntwoord({ ok: true, status: STATUS_BEVESTIGD }));
    }

    try {
      const { token: accessToken, orgId } = await zoho.haalToegang();

      const ticketRes = await zoho.verzoek(`/tickets/${ticketId}`, { token: accessToken, orgId });
      const ticketData = await ticketRes.json().catch(() => ({}));
      if (ticketRes.status === 404) return json(404, { error: 'Ticket niet gevonden' });
      if (!ticketRes.ok) return json(502, { error: 'Zoho ticket ophalen mislukt' });
      // Een technieker met "Mag zelf plannen" bevestigt enkel zijn eigen tickets (vóór er iets verandert).
      const eis = await eisEigenTicket({ gebruiker, ticketId, zoho, toegang: { token: accessToken, orgId }, ticket: ticketData });
      if (!eis.ok) return json(eis.status, eis.body);

      // Enkel een ticket dat nog op de klant wacht: een ander ticket (al bevestigd, verplaatst, geannuleerd) blijft ongemoeid.
      if (ticketData.status !== STATUS_PENDING) {
        return json(409, {
          error: `Dit ticket staat niet (meer) op "${STATUS_PENDING}" in Zoho (status: ${ticketData.status || 'onbekend'}). Herlaad de planner.`,
          zohoStatus: ticketData.status || null,
        });
      }

      // Een afspraak zonder datum is niets om te bevestigen (en een 'Geplande support' zonder datum is een toestand die kalender en Ingepland niet
      // verwachten); de bevestigingslink eist ook een datum die klopt.
      if (!datumInBrussel(ticketData.cf?.cf_interventie_datm)) {
        return json(409, {
          error: 'Dit ticket heeft geen afspraakdatum in Zoho: er is niets te bevestigen. Plan het eerst in of herlaad de planner.',
          zohoStatus: ticketData.status || null,
        });
      }

      const patchRes = await zoho.verzoek(`/tickets/${ticketId}`, {
        token: accessToken, orgId, methode: 'PATCH', json: { status: STATUS_BEVESTIGD },
      });
      if (!patchRes.ok) {
        const t = await patchRes.text().catch(() => '');
        console.error(`Zoho PATCH fout (${patchRes.status}):`, t);
        return json(502, { error: `Zoho PATCH fout (${patchRes.status})` });
      }

      await addZohoComment(ticketId, accessToken, orgId, handmatigeBevestigingsNotitie({ naam, tijdstip: tijdstipNuBrussel() }));
      await logVoorVerzoek(req, gebruiker, { actie: 'bevestigd-per-mail', onderwerp: ticketId, details: null }, { getStore: haalStore });

      try {
        const store = haalStore({ name: 'blitz-data', consistency: 'strong' });
        await markeerBevestigd(store, ticketId, { door: 'mail', tijdstip, wie: naam });
      } catch (e) {
        console.error('Register bijwerken mislukt na bevestiging per mail:', e?.message || e);
        return json(200, {
          ok: true, status: STATUS_BEVESTIGD,
          waarschuwing: 'Bevestigd in Zoho, maar het voorstel-register kon niet bijgewerkt worden. Herlaad de planner.',
        });
      }

      return json(200, { ok: true, status: STATUS_BEVESTIGD });
    } catch (err) {
      console.error('bevestig-handmatig fout:', err);
      return json(500, { error: err.message });
    }
  };
}

// Na elke wijzigende aanroep (ook een mislukte: er kan al iets in Zoho staan) markeert metTicketsVerouderd de ticket-momentopname als verouderd.
export default beveiligV2('bevestig-handmatig', metTicketsVerouderd(maakHandler({ getStore, fetch: globalThis.fetch })));

export const config = { path: '/api/bevestig-handmatig' };
