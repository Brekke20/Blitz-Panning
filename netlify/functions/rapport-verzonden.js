// /api/rapport-verzonden
// Zet verzondenKlant/verzondenInstallateur op een bestaand rapport-archief-item, zonder
// de rest van dat item (o.a. de mogelijk grote rapportData._html) opnieuw te versturen.
import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { isEigenRapport } from '../lib/eigen.js';

export function maakHandler({ getStore: haalStore = getStore } = {}) {
  const kern = async (req, context, gebruiker) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers });

    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers }); }
    const { id, doelgroep, tijdstip } = body;
    if (!id || !['contact', 'klant', 'installateur'].includes(doelgroep) || !tijdstip) {
      return new Response(JSON.stringify({ error: 'id, doelgroep (contact|klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
    }

    const store = haalStore({ name: winkelNaam(req), consistency: 'strong' });

    if (isTestVerzoek(req)) await zorgVoorTestkopie(haalStore);
    const current = (await store.get('rapportlijst', { type: 'json' }).catch(() => null)) || { versie: 0, rapports: [] };
    if (typeof body.versie === 'number' && body.versie !== current.versie) {
      return new Response(JSON.stringify({ error: 'Rapportarchief ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie }), { status: 409, headers });
    }
    const idx = current.rapports.findIndex(r => r.id === id);
    if (idx < 0) return new Response(JSON.stringify({ error: 'Rapport niet gevonden' }), { status: 404, headers });
    // Een technieker markeert enkel zijn eigen rapporten als verzonden.
    if (gebruiker?.rol === 'technieker' && !isEigenRapport(gebruiker, current.rapports[idx])) {
      return new Response(JSON.stringify({ error: 'Je kan enkel je eigen rapporten bijwerken.', code: 'geen-recht' }), { status: 403, headers });
    }

    const veld = doelgroep === 'contact' ? 'verzondenContact' : doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
    const updated = [...current.rapports];
    updated[idx] = { ...updated[idx], [veld]: tijdstip };

    const nieuw = { versie: current.versie + 1, rapports: updated };
    await store.setJSON('rapportlijst', nieuw);
    return new Response(JSON.stringify({ ok: true, versie: nieuw.versie }), { status: 200, headers });
  };

  return beveiligV2('rapport-verzonden', kern);
}

export default maakHandler();

export const config = { path: '/api/rapport-verzonden' };
