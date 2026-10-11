// Extra acties op het rapportarchief (rapport-archief.js blijft dun): de zware rapportinhoud
// ophalen (GET ?inhoud=<id>) en een mislukt rapport opnieuw laten versturen (POST { opnieuw }).
// Beide geven { status, body, ... } terug; de functie zet dat om naar een Response.

import { isGeldigId, leesInhoud } from './rapport-inhoud.js';
import { wijzigLijst, zetOpnieuw } from './rapportlijst.js';

const NIET_BEREIKBAAR = { error: 'Rapportarchief tijdelijk niet bereikbaar, probeer opnieuw.' };

export async function haalRapportInhoud(store, id) {
  if (!isGeldigId(id)) return { status: 400, body: { error: 'Ongeldig id' } };
  try {
    const inhoud = await leesInhoud(store, id);
    if (!inhoud || typeof inhoud.html !== 'string') {
      return { status: 404, body: { error: 'Rapportinhoud niet gevonden' } };
    }
    return { status: 200, body: { id, html: inhoud.html } };
  } catch {
    return { status: 503, body: NIET_BEREIKBAAR };
  }
}

// `startNodig` is true als de achtergrondtaak gestart moet worden (rapport stond op mislukt).
export async function verwerkOpnieuw({ store, id, nu = new Date() }) {
  if (!isGeldigId(id)) return { status: 400, body: { error: 'Ongeldig id' }, startNodig: false };
  try {
    let gevonden = false;
    let gezet = false;
    let info = null; // ticketnummer en technieker voor het activiteitenlog
    const res = await wijzigLijst(store, ({ rapports }) => {
      const uit = zetOpnieuw(rapports, id, nu);
      gevonden = uit.gevonden;
      gezet = uit.zetten;
      const e = rapports.find(r => r.id === id);
      info = e ? { ticketNummer: e.ticketNumber ?? e.ticketId ?? null, technieker: e.technieker ?? null } : null;
      if (!uit.zetten) return null;
      return { rapports: uit.rapports, controle: terug => terug.find(r => r.id === id)?.verwerking?.status === 'wacht' };
    });
    if (!res.ok) return { status: 503, body: NIET_BEREIKBAAR, startNodig: false };
    if (!gevonden) return { status: 404, body: { error: 'Rapport niet gevonden' }, startNodig: false };
    if (!gezet) return { status: 200, body: { ok: true, ongewijzigd: true }, startNodig: false };
    return { status: 200, body: { ok: true, versie: res.versie }, startNodig: true, info };
  } catch (err) {
    console.error('[rapport-archief] opnieuw versturen mislukt:', err?.message || err);
    return { status: 503, body: NIET_BEREIKBAAR, startNodig: false };
  }
}
