// /api/rapport-ontvangen — snelle, idempotente ontvangst van een service-rapport. Slaat de inhoud
// en een lichte lijst-entry op en start daarna de Background Function die de PDF maakt en naar
// Zoho uploadt. Logica: netlify/lib/rapport-ontvangst.js en rapport-achtergrond.js.
// Achter de rechtentabel (beveiligV2): beheerder, planner en technieker. Een rapport wordt nooit geweigerd omwille van de
// naam erop (vrij tekstveld): het wordt aanvaard met ingediendDoor, en bij een andere naam dan de indiener in het
// activiteitenlog gezet (rapport-verstuurd + andereNaam), zodat de coordinator het ziet.
import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { verwerkOntvangst } from '../lib/rapport-ontvangst.js';
import { startAchtergrondtaak } from '../lib/rapport-achtergrond.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { logVoorVerzoek } from '../lib/activiteit.js';
import { isEigenNaam } from '../lib/eigen.js';

export function maakHandler({ getStore: haalStore, fetch: doFetch }) {
  const kern = async (req, context, gebruiker) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers });

    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers });
    }

    const testModus = isTestVerzoek(req);
    const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });
    if (testModus) await zorgVoorTestkopie(haalStore);

    const res = await verwerkOntvangst({ store, body, testModus, gebruiker });
    const logOpties = { getStore: haalStore };
    if (res.status === 200 && res.nieuw && gebruiker?.rol === 'technieker' && !isEigenNaam(gebruiker, body?.archiveBody?.technieker)) {
      await logVoorVerzoek(req, gebruiker, {
        actie: 'rapport-verstuurd', onderwerp: String(body?.ticketId ?? ''),
        details: { andereNaam: true, naamInRapport: String(body?.archiveBody?.technieker ?? '').slice(0, 100) },
      }, logOpties);
    } else if (res.status === 403) {
      await logVoorVerzoek(req, gebruiker, {
        actie: 'rapport-geweigerd', onderwerp: String(body?.ticketId ?? ''), details: { id: String(body?.id ?? '').slice(0, 60), reden: 'id-van-ander' },
      }, logOpties);
    }
    if (res.startNodig) {
      await startAchtergrondtaak({ origin: new URL(req.url).origin, id: res.body.id, testModus, fetch: doFetch });
    }
    return new Response(JSON.stringify(res.body), { status: res.status, headers });
  };
  return beveiligV2('rapport-ontvangen', kern);
}

export default maakHandler({ getStore, fetch: globalThis.fetch });

export const config = { path: '/api/rapport-ontvangen' };
