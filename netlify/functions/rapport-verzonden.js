// /api/rapport-verzonden
// Zet verzondenKlant/verzondenInstallateur op een bestaand rapport-archief-item, zonder
// de rest van dat item (o.a. de mogelijk grote rapportData._html) opnieuw te versturen.
import { getStore } from '@netlify/blobs';
import { winkelNaam, isTestVerzoek, zorgVoorTestkopie } from '../lib/testmodus.js';
import { beveiligV2 } from '../lib/beveiligd.js';
import { isEigenRapport } from '../lib/eigen.js';
import { wijzigLijst } from '../lib/rapportlijst.js';

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
    // Bugfix 2026-11-12: geen versiecontrole meer. De achtergrondverwerking van een net bewaard rapport hoogt de versie op;
    // een 409 liet de al verstuurde mail dan "niet verzonden" lijken (tablet: #3746, #3998). Eén veld op één item zetten is
    // idempotent; wijzigLijst leest vers en controleert na het schrijven dat het vinkje bleef staan (gelijktijdige schrijver).
    const veld = doelgroep === 'contact' ? 'verzondenContact' : doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
    let weigering = null;
    const res = await wijzigLijst(store, ({ rapports }) => {
      weigering = null;
      const idx = rapports.findIndex(r => r.id === id);
      if (idx < 0) { weigering = 'niet-gevonden'; return null; }
      // Een technieker markeert enkel zijn eigen rapporten als verzonden.
      if (gebruiker?.rol === 'technieker' && !isEigenRapport(gebruiker, rapports[idx])) { weigering = 'geen-recht'; return null; }
      const lijst = [...rapports];
      lijst[idx] = { ...lijst[idx], [veld]: tijdstip };
      return { rapports: lijst, controle: terug => terug.find(r => r.id === id)?.[veld] === tijdstip };
    });
    if (weigering === 'niet-gevonden') return new Response(JSON.stringify({ error: 'Rapport niet gevonden' }), { status: 404, headers });
    if (weigering === 'geen-recht') {
      return new Response(JSON.stringify({ error: 'Je kan enkel je eigen rapporten bijwerken.', code: 'geen-recht' }), { status: 403, headers });
    }
    if (!res.ok) return new Response(JSON.stringify({ error: 'Rapportarchief kon niet bijgewerkt worden, probeer opnieuw' }), { status: 409, headers });
    return new Response(JSON.stringify({ ok: true, versie: res.versie }), { status: 200, headers });
  };

  return beveiligV2('rapport-verzonden', kern);
}

export default maakHandler();

export const config = { path: '/api/rapport-verzonden' };
