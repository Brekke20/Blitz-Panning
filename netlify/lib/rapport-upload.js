// Uploadlogica voor een service-rapport: idempotentie-register + reservering rond PDF-generatie
// en Zoho-upload. Verhuisd uit netlify/functions/rapport.js (gedrag ongewijzigd) zodat de
// achtergrondfunctie dezelfde logica gebruikt. Geen directe afhankelijkheid van Chromium/Zoho:
// maakPdf en uploadPdfNaarZoho worden geïnjecteerd (zie rapport-zoho.js), en de store is een
// parameter (null = geen register, upload gaat gewoon door).
//
// Alles rond het register is best-effort: een falende store mag de upload (PDF + Zoho) nooit
// blokkeren of een GESLAAGDE upload alsnog laten mislukken (C1, zie rapport-register.js).
// Niet atomair -- zie het commentaar bij IN_FLIGHT_TIMEOUT_MS in rapport-register.js.

import {
  REGISTER_KEY, leesRegister, isAlVerzonden, heeftActieveReservering, pasReserveringToe,
  wisReservering, pasRegisterMarkeringToe, pasMarkeringToe,
} from './rapport-register.js';
import { LIJST_KEY } from './rapportlijst.js';

// Was dit verzendId al eerder succesvol geüpload? Geeft de register-entry of null (ook bij een
// falende check -- dan gewoon normaal doorgaan).
async function checkAlUpgeload(store, verzendId) {
  if (!verzendId || !store) return null;
  try {
    const data = await leesRegister(store);
    return isAlVerzonden(verzendId, data.entries);
  } catch { return null; }
}

// Probeert een in-flight-reservering te zetten. 'in-progress' als een ANDERE, nog-actieve poging
// ze al zette, 'gereserveerd' bij succes, 'doorgaan' in elk ander geval (geen verzendId/store,
// of de check/schrijf faalde).
async function reserveerOfWeiger(store, verzendId) {
  if (!verzendId || !store) return 'doorgaan';
  try {
    const data = await leesRegister(store);
    if (heeftActieveReservering(data.entries?.[verzendId])) return 'in-progress';
    const updated = pasReserveringToe(data.entries, verzendId);
    if (!updated) return 'doorgaan'; // defensief -- pasReserveringToe faalt enkel bij ontbrekend verzendId
    await store.setJSON(REGISTER_KEY, { versie: data.versie + 1, entries: updated });
    return 'gereserveerd';
  } catch {
    return 'doorgaan'; // best-effort -- een falende reservering mag de upload niet blokkeren
  }
}

// Wist een eerder gezette reservering na een mislukte poging, zodat een retry niet tot 3 minuten
// op zijn eigen vorige reservering moet wachten. Faalt dit, dan verloopt ze vanzelf.
async function wisReserveringBestEffort(store, verzendId) {
  if (!verzendId || !store) return;
  try {
    const data = await leesRegister(store);
    const updated = wisReservering(data.entries, verzendId);
    if (!updated) return;
    await store.setJSON(REGISTER_KEY, { versie: data.versie + 1, entries: updated });
  } catch { /* best-effort */ }
}

// Definitieve idempotentie-markering (done:true) in het register. Best-effort, gooit nooit.
async function markeerRegisterDone(store, verzendId, attachmentId) {
  if (!verzendId || !store) return;
  try {
    const data    = await leesRegister(store);
    const updated = pasRegisterMarkeringToe(data.entries, verzendId, attachmentId);
    if (updated) await store.setJSON(REGISTER_KEY, { versie: data.versie + 1, entries: updated });
  } catch { /* best-effort -- mag een geslaagde upload nooit laten falen */ }
}

// Geeft een uploader terug: ({ html, ticketId, filename, verzendId, store }) =>
//   { attachmentId, alUploaded?: true } | { inProgress: true }; gooit bij een fout in PDF/Zoho
// (na best-effort wissen van de eigen reservering).
export function maakUploader({ maakPdf, uploadPdfNaarZoho }) {
  return async function uploadRapport({ html, ticketId, filename, verzendId, store }) {
    // Idempotentie (T20): al eerder gelukt maar het antwoord haalde de client niet?
    const alGedaan = await checkAlUpgeload(store, verzendId);
    if (alGedaan) return { attachmentId: alGedaan.zohoAttachmentId || null, alUploaded: true };

    // Vroege in-flight-reservering, VÓÓR het dure deel (PDF + Zoho).
    const reservering = await reserveerOfWeiger(store, verzendId);
    if (reservering === 'in-progress') return { inProgress: true };
    const reserveringGezet = reservering === 'gereserveerd';

    try {
      const pdfBuffer    = await maakPdf(html);
      const attachmentId = await uploadPdfNaarZoho({ pdfBuffer, ticketId, filename });
      await markeerRegisterDone(store, verzendId, attachmentId);
      return { attachmentId };
    } catch (err) {
      // Alleen opruimen als DEZE aanroep de reservering zette.
      if (reserveringGezet) await wisReserveringBestEffort(store, verzendId);
      throw err;
    }
  };
}

// Label-write op de gedeelde archieflijst (zohoUploaded/zohoAttachmentId/geannuleerd:false), puur
// voor de weergave in het Rapporten-tabblad. Ongelockt (geen conditional write beschikbaar):
// read-merge-write MET read-back, tot 3 pogingen. Best-effort, gooit nooit.
export async function markeerLijstUpgeload(store, verzendId, attachmentId) {
  if (!verzendId || !store) return;
  try {
    for (let poging = 0; poging < 3; poging++) {
      try {
        const data    = (await store.get(LIJST_KEY, { type: 'json' })) || { versie: 0, rapports: [] };
        const updated = pasMarkeringToe(data.rapports, verzendId, attachmentId);
        if (!updated) return; // geen match, of de entry staat al correct -- niets te doen
        await store.setJSON(LIJST_KEY, { versie: data.versie + 1, rapports: updated });
        const verify = await store.get(LIJST_KEY, { type: 'json' }).catch(() => null);
        const verifyEntry = verify?.rapports?.find(r => r.id === verzendId);
        if (verifyEntry?.zohoUploaded === true && verifyEntry.zohoAttachmentId === attachmentId && verifyEntry.geannuleerd === false) {
          return; // bevestigd via read-back
        }
        // Niet bevestigd -- een gelijktijdige schrijver overschreef onze write; volgende poging.
      } catch { /* conflict of tijdelijke fout -- volgende poging */ }
    }
  } catch { /* best-effort */ }
}
