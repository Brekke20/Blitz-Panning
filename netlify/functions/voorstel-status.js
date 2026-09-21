// /api/voorstel-status
// Centraal (niet-lokaal) register van wanneer een afspraaksvoorstel verstuurd is per
// ticket/doelgroep. Los van Zoho -- puur voor de "verzonden"-vinkjes in de UI.
// Sinds v1.4.0 ook: het tijdslot dat effectief naar de klant gemaild is (`tijdslot`, bv.
// "08:30–11:30") + de datum waarvoor het gold (`tijdslotDatum`), zodat de technieker exact
// hetzelfde blok ziet als de klant, ongeacht latere wijzigingen aan de slot-instelling.
// Structuur: { versie, status: { [ticketId]: { contact?, klant?, installateur?, tijdslot?, tijdslotDatum? } } }
import { getStore } from '@netlify/blobs';

const EMPTY = { versie: 0, status: {} };
const TIJDSLOT_RE = /^([01]\d|2[0-3]):[0-5]\d–([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE     = /^\d{4}-\d{2}-\d{2}$/;

export default async (req, context) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  if (req.method === 'GET') {
    const data = await store.get('voorstel-status', { type: 'json' }).catch(() => null);
    return new Response(JSON.stringify(data || EMPTY), { status: 200, headers });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers }); }
    const { ticketId, doelgroep, tijdstip } = body;
    if (!ticketId || !['contact', 'klant', 'installateur'].includes(doelgroep) || !tijdstip) {
      return new Response(JSON.stringify({ error: 'ticketId, doelgroep (contact|klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
    }
    const current = (await store.get('voorstel-status', { type: 'json' }).catch(() => null)) || EMPTY;
    if (typeof body.versie === 'number' && body.versie !== current.versie) {
      return new Response(JSON.stringify({ error: 'Register ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie }), { status: 409, headers });
    }
    // Optioneel: gemaild tijdslot + bijhorende datum (enkel opslaan als beide geldig zijn).
    const slotExtra = (typeof body.tijdslot === 'string' && TIJDSLOT_RE.test(body.tijdslot)
                       && typeof body.tijdslotDatum === 'string' && DATE_RE.test(body.tijdslotDatum))
      ? { tijdslot: body.tijdslot, tijdslotDatum: body.tijdslotDatum }
      : {};
    const nieuw = {
      versie: current.versie + 1,
      status: { ...current.status, [ticketId]: { ...current.status[ticketId], [doelgroep]: tijdstip, ...slotExtra } },
    };
    await store.setJSON('voorstel-status', nieuw);
    return new Response(JSON.stringify({ ok: true, versie: nieuw.versie }), { status: 200, headers });
  }

  return new Response('Method Not Allowed', { status: 405, headers });
};

export const config = { path: '/api/voorstel-status' };
