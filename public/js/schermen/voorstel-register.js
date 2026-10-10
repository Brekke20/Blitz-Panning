// schermen/voorstel-register.js — het voorstelregister bewaren na een verstuurd voorstel (B1, kleine fouten).
// Het register zegt per ticket wie een voorstelmail kreeg (de ✓ en 🔒 in de planning). Na een verstuurde mail mag dat niet verloren
// gaan door een versieconflict (409) omdat een collega tegelijk iets bewaarde. Daarom: poging 1 met de bekende versie; bij een 409 de
// stand herladen en poging 2 met de nieuwe versie; bij een tweede 409 (of een mislukte herlaad) poging 3 ZONDER versie. Dat is veilig:
// `reset: true` vervangt enkel de entry van dit ticket, een wijziging van een ander ticket gaat niet verloren. Elke andere fout
// (5xx, netwerk, onleesbaar antwoord) stopt meteen. Nooit meer dan 3 POSTs. Puur: geen toast, geen DOM.
import { apiVerzoek } from '../kern/api.js';

const DOELGROEPEN = ['contact', 'klant', 'installateur'];

// De lokale entry zoals de server ze maakt: { [doelgroep]: tijdstip, … [, tijdslot, tijdslotDatum] }.
export function registerEntry({ doelgroepen, tijdstip, tijdslot, tijdslotDatum }) {
  const entry = {};
  for (const d of doelgroepen) entry[d] = tijdstip;
  if (tijdslot) { entry.tijdslot = tijdslot; entry.tijdslotDatum = tijdslotDatum; }
  return entry;
}

// Doelgroepen (volgorde contact, klant, installateur) waarvan het ticket-adres hoofdletterongevoelig in `adressen` zit; een adres dat
// al bij een eerdere doelgroep telde, telt niet nogmaals (zoals openProposal en de server ontdubbelen).
export function doelgroepenVoorAdressen(ticket, adressen) {
  const gezocht = new Set((adressen || []).filter(Boolean).map(a => String(a).toLowerCase()));
  const gezien = new Set();
  const uit = [];
  const adresVan = { contact: ticket?.email, klant: ticket?.emailEindklant, installateur: ticket?.emailInstallateur };
  for (const d of DOELGROEPEN) {
    const a = adresVan[d] ? String(adresVan[d]).toLowerCase() : '';
    if (!a || !gezocht.has(a) || gezien.has(a)) continue;
    gezien.add(a);
    uit.push(d);
  }
  return uit;
}

export async function bewaarVoorstelRegister({ ticketId, doelgroepen, tijdstip, tijdslot, tijdslotDatum, leesVersie, herlaad }) {
  const poging = async (metVersie) => {
    // Sleutelvolgorde vast: ticketId, doelgroepen, tijdstip, reset, [versie], [tijdslot, tijdslotDatum].
    const body = { ticketId, doelgroepen, tijdstip, reset: true };
    if (metVersie) body.versie = leesVersie();
    if (tijdslot) { body.tijdslot = tijdslot; body.tijdslotDatum = tijdslotDatum; }
    return apiVerzoek('/api/voorstel-status', { methode: 'POST', body });
  };
  const uitkomst = (r) => {
    if (r.ok && !r.data?.error) return { ok: true, versie: typeof r.data?.versie === 'number' ? r.data.versie : null };
    return { ok: false, reden: 'http', status: r.status };
  };
  try {
    let r = await poging(true);
    if (r.status !== 409) return uitkomst(r);
    // 409: de stand herladen en met de nieuwe versie nog eens
    let herladen = false;
    try { herladen = !!(await herlaad()); } catch { herladen = false; }
    if (herladen) {
      r = await poging(true);
      if (r.status !== 409) return uitkomst(r);
    }
    // tweede 409 of herlaad mislukt: zonder versiecontrole (reset vervangt enkel de entry van dit ticket)
    return uitkomst(await poging(false));
  } catch {
    return { ok: false, reden: 'netwerk' };
  }
}
