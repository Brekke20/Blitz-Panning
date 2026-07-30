// /api/rapport-verzonden
// Zet verzondenKlant/verzondenInstallateur op een bestaand rapport-archief-item, zonder
// de rest van dat item (o.a. de mogelijk grote rapportData._html) opnieuw te versturen.
import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers }); }
  const { id, doelgroep, tijdstip } = body;
  if (!id || !['klant', 'installateur'].includes(doelgroep) || !tijdstip) {
    return new Response(JSON.stringify({ error: 'id, doelgroep (klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
  }

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });
  const current = (await store.get('rapportlijst', { type: 'json' }).catch(() => null)) || { versie: 0, rapports: [] };
  if (typeof body.versie === 'number' && body.versie !== current.versie) {
    return new Response(JSON.stringify({ error: 'Rapportarchief ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie }), { status: 409, headers });
  }
  const idx = current.rapports.findIndex(r => r.id === id);
  if (idx < 0) return new Response(JSON.stringify({ error: 'Rapport niet gevonden' }), { status: 404, headers });

  const veld = doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
  const updated = [...current.rapports];
  updated[idx] = { ...updated[idx], [veld]: tijdstip };

  const nieuw = { versie: current.versie + 1, rapports: updated };
  await store.setJSON('rapportlijst', nieuw);
  return new Response(JSON.stringify({ ok: true, versie: nieuw.versie }), { status: 200, headers });
};

export const config = { path: '/api/rapport-verzonden' };
