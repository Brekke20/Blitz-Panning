// /api/voorstel-status
// Centraal (niet-lokaal) register van wanneer een afspraaksvoorstel verstuurd is per
// ticket/doelgroep. Los van Zoho -- puur voor de "verzonden"-vinkjes in de UI.
// Sinds v1.4.0 ook: het tijdslot dat effectief naar de klant gemaild is (`tijdslot`, bv.
// "08:30–11:30") + de datum waarvoor het gold (`tijdslotDatum`), zodat de technieker exact
// hetzelfde blok ziet als de klant, ongeacht latere wijzigingen aan de slot-instelling.
// Sinds v1.10.0: POST aanvaardt `doelgroepen[]` (atomisch) + `reset`, DELETE wist een ticket.
// Structuur: { versie, status: { [ticketId]: { contact?, klant?, installateur?, tijdslot?, tijdslotDatum?, bevestigd? } } }
import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { leesRegister, schrijfVoorstel, wisVoorstel } from '../lib/voorstelregister.js';

const DOELGROEPEN = ['contact', 'klant', 'installateur'];

export default async (req, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const store = getStore({ name: winkelNaam(req), consistency: 'strong' });

  if (isTestVerzoek(req)) await zorgVoorTestkopie(getStore);

  if (req.method === 'GET') {
    return new Response(JSON.stringify(await leesRegister(store)), { status: 200, headers });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers }); }
    const { ticketId, tijdstip } = body;
    const doelgroepen = Array.isArray(body.doelgroepen) ? body.doelgroepen : [body.doelgroep];
    if (!ticketId || !tijdstip || !doelgroepen.length || !doelgroepen.every(d => DOELGROEPEN.includes(d))) {
      return new Response(JSON.stringify({ error: 'ticketId, doelgroep(en) (contact|klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
    }
    const r = await schrijfVoorstel(store, {
      ticketId, doelgroepen, tijdstip,
      tijdslot: body.tijdslot, tijdslotDatum: body.tijdslotDatum,
      reset: body.reset === true,
      versie: typeof body.versie === 'number' ? body.versie : undefined,
    });
    if (r.conflict) {
      return new Response(JSON.stringify({ error: 'Register ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: r.serverVersie }), { status: 409, headers });
    }
    return new Response(JSON.stringify({ ok: true, versie: r.versie }), { status: 200, headers });
  }

  if (req.method === 'DELETE') {
    const ticketId = new URL(req.url).searchParams.get('ticketId') || '';
    if (!/^\d+$/.test(ticketId)) {
      return new Response(JSON.stringify({ error: 'ticketId (numeriek) is verplicht' }), { status: 400, headers });
    }
    const r = await wisVoorstel(store, ticketId);
    return new Response(JSON.stringify({ ok: true, versie: r.versie }), { status: 200, headers });
  }

  return new Response('Method Not Allowed', { status: 405, headers });
};

export const config = { path: '/api/voorstel-status' };
