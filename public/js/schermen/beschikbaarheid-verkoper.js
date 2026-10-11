// schermen/beschikbaarheid-verkoper.js — afwezigheden van een VERKOPER in Beheer → Beschikbaarheden. Een verkoper heeft geen Zoho-naam en geen
// plek in /api/availability: zijn afwezigheid is een blok (soort 'verlof') in zijn eigen sales-agenda, via de bestaande /api/sales?gebruiker=<id>
// (enkel de beheerder mag dat; de server beslist). Eigen, kleine toestand per verkoper (versie + blokken): de sales-schermen (sales-data.js) en
// hun toestand blijven buiten beeld. Geen DOM, geen toasts: de oproeper toont de melding.
// Alle functies geven { ok:true } of { ok:false, reden: 'netwerk'|'http'|'conflict'|'opslag', status?, fout? }.
import { apiVerzoek } from '../kern/api.js';

const stand = new Map(); // verkoperId -> { versie, blokken }

const isBlob = (d) => d !== null && typeof d === 'object' && typeof d.versie === 'number' && Array.isArray(d.blokken);
const pad = (id) => '/api/sales?gebruiker=' + encodeURIComponent(id);
const fout = (r) => ({ ok: false, reden: r.status === 503 && r.data?.code === 'opslag-storing' ? 'opslag' : 'http', status: r.status, ...(typeof r.data?.error === 'string' ? { fout: r.data.error } : {}) });

/** De laatst geladen blokken van deze verkoper, of null (nog niet geladen). */
export function verkoperBlokken(id) { return stand.get(id)?.blokken ?? null; }

/** Voor een gebruikerswissel en voor tests. */
export function wisVerkoperStand() { stand.clear(); }

export async function laadVerkoperBlokken(id) {
  let r;
  try { r = await apiVerzoek(pad(id)); } catch { return { ok: false, reden: 'netwerk' }; }
  if (!r.ok) return fout(r);
  if (!isBlob(r.data)) return { ok: false, reden: 'http', status: r.status };
  stand.set(id, { versie: r.data.versie, blokken: r.data.blokken });
  return { ok: true };
}

// PATCH met de versie van onze stand; bij een 409 de verse serverstand overnemen en EENMAAL opnieuw (`maakPatch(blokken)` rekent de patch
// op de actuele blokken uit; null = er is niets meer te doen, bv. de te verwijderen blokken zijn intussen weg).
async function wijzigBlokken(id, maakPatch) {
  if (!stand.has(id)) { const g = await laadVerkoperBlokken(id); if (!g.ok) return g; }
  for (let poging = 0; poging < 2; poging++) {
    const huidig = stand.get(id);
    const patch = maakPatch(huidig.blokken);
    if (patch === null) return { ok: true };
    let r;
    try { r = await apiVerzoek(pad(id), { methode: 'PATCH', body: { blokken: patch, versie: huidig.versie } }); } catch { return { ok: false, reden: 'netwerk' }; }
    if (r.ok) {
      if (!isBlob(r.data)) return fout(r);
      stand.set(id, { versie: r.data.versie, blokken: r.data.blokken });
      return { ok: true };
    }
    if (r.status !== 409 || !isBlob(r.data?.data)) return fout(r);
    stand.set(id, { versie: r.data.data.versie, blokken: r.data.data.blokken }); // de serverstand is de waarheid
  }
  return { ok: false, reden: 'conflict', status: 409 };
}

/** Voegt de blokken (al gevalideerd, zonder id) toe aan de agenda van deze verkoper. */
export function voegVerkoperBlokkenToe(id, blokken) {
  return wijzigBlokken(id, () => ({ toevoegen: blokken }));
}

/** Verwijdert de blokken met deze ids uit de agenda van deze verkoper (ids die al weg zijn tellen als gelukt). */
export function verwijderVerkoperBlokken(id, ids) {
  return wijzigBlokken(id, (blokken) => {
    const aanwezig = ids.filter(x => blokken.some(b => b.id === x));
    return aanwezig.length ? { verwijder: aanwezig } : null;
  });
}
