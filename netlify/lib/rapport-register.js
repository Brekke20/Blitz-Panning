// Idempotentie-register van de rapport-upload (blob 'rapport-verzend-status' in 'blitz-data') en
// de pure helpers eromheen. Verhuisd uit netlify/functions/rapport.js (gedrag ongewijzigd) zodat
// ook de achtergrondfunctie ze kan gebruiken. Geen Chromium/Puppeteer-import hier.
//
// Zelfde store als rapport-archief.js ('blitz-data'), maar met een APARTE key voor de
// idempotentie-/reserveringsadministratie (zie I1 in de fix-wave, 2026-09-23): `rapportlijst` is
// de gedeelde archieflijst waarin ook rapport-archief.js/rapport-verzonden.js schrijven -- een
// ongelockte read-modify-write daarop zou een gelijktijdig archief-schrijf van een collega kunnen
// overschrijven. Reservering + de definitieve "al geüpload"-markering leven daarom in een eigen
// key (REGISTER_KEY) binnen dezelfde store.
export const REGISTER_KEY  = 'rapport-verzend-status';
// Begrenzing van het register: voorkomt onbeperkte groei (elk verzonden rapport ooit) op een
// blob die bij elke upload gelezen/geschreven wordt. 1000 entries is ruim boven het aantal
// rapporten dat realistisch tegelijk "recent" is; oudste entries (op `bijgewerkt`) worden geruimd.
const MAX_REGISTER_ENTRIES = 1000;

// ── Pure logica (geen I/O) -- apart van de Blobs-aanroepen zodat dit zonder Netlify Blobs-
// emulatie met een klein Node-scriptje te verifiëren is (zie Global Constraints, "lokaal 500"). ──

// (Fix-ronde 1, punt 3) verzendId is client-gestuurde input (JSON body) en komt uiteindelijk in
// een Blobs-key-lookup terecht -- valideer het formaat (UUID-achtig) vóór gebruik. Een ongeldige
// waarde wordt gewoon genegeerd (behandeld als "geen verzendId"), niet als fout: de idempotentie
// is een bonus bovenop de kernflow, geen vereiste ervoor.
export function normaliseerVerzendId(verzendId) {
  if (typeof verzendId !== 'string') return null;
  return /^[A-Za-z0-9-]{8,64}$/.test(verzendId) ? verzendId : null;
}

// ── Register (rapport-verzend-status) ─────────────────────────────────────────────────────────
// Vorm: { versie, entries: { [verzendId]: { verzendId, zohoAttachmentId, done,
// uploadInFlightSince, bijgewerkt } } } -- een object-map (i.p.v. array, zoals rapportlijst) voor
// O(1)-opzoeking per verzendId; `bijgewerkt` (ms sinds epoch) laat begrensRegister() de oudste
// entries ruimen zodra de grens overschreden wordt.

function begrensRegister(entries) {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_REGISTER_ENTRIES) return entries;
  const oudsteEerst   = keys.sort((a, b) => (entries[a]?.bijgewerkt || 0) - (entries[b]?.bijgewerkt || 0));
  const teVerwijderen = oudsteEerst.slice(0, keys.length - MAX_REGISTER_ENTRIES);
  const begrensd = { ...entries };
  for (const k of teVerwijderen) delete begrensd[k];
  return begrensd;
}

// Bepaalt of een verzendId al een succesvolle Zoho-upload heeft. Retourneert de bestaande
// entry (met o.a. zohoAttachmentId) bij een match, anders null -- geen match is normaal
// (nieuw item) en blokkeert de upload niet.
export function isAlVerzonden(verzendId, entries) {
  if (!verzendId) return null;
  const entry = entries?.[verzendId];
  return entry?.done === true ? entry : null;
}

// Bepaalt HOE het register bijgewerkt moet worden na een geslaagde upload. Retourneert null als
// er niets te doen is (geen verzendId, of de entry staat al op done -- kan gebeuren bij een retry
// op een transiënte fout, zie markeerUpgeload hieronder: dat is GEEN 409/versie-conflict, want
// deze store/key kent geen conditional writes, zie M11).
export function pasRegisterMarkeringToe(entries, verzendId, attachmentId, nu = Date.now()) {
  if (!verzendId) return null;
  if (entries?.[verzendId]?.done === true) return null;
  const updated = { ...(entries || {}) };
  updated[verzendId] = { verzendId, zohoAttachmentId: attachmentId, done: true, uploadInFlightSince: null, bijgewerkt: nu };
  return begrensRegister(updated);
}

// ── Vroege in-flight-reservering (NIET atomair) ───────────────────────────────────────────────
// Oorspronkelijk uit T20/Fix-ronde 2: de review vroeg om een atomaire reservering via conditional
// writes (`onlyIfMatch` op `store.setJSON`). Die primitive bestaat niet in het geïnstalleerde
// `@netlify/blobs@8.2.0` (zie task-20-report.md, Fix-ronde 1, voor de volledige onderbouwing:
// `set`/`setJSON` accepteren enkel `{ metadata }`, geen conditioneel-schrijf-argument, geen
// `modified`-resultaat). Controller-beslissing: geen SDK-upgrade in deze release -- dit is dus
// een BEST-EFFORT mitigatie, geen harde garantie. Twee aanvragen voor hetzelfde verzendId die de
// registerblob binnen enkele tientallen milliseconden van elkaar lezen, zien allebei "nog geen
// actieve reservering" en schrijven beide een reservering (laatste schrijver wint, zonder
// foutmelding) -- maar het venster waarin dat kan gebeuren is nu de GET→SET-latentie van déze
// functie alleen (~100ms), niet meer de volledige PDF-generatie+Zoho-upload-duur (typisch enkele
// seconden tot een kleine minuut). Vervolgstap (niet in deze release): @netlify/blobs upgraden
// naar een versie met `onlyIfMatch`/conditionele writes en dit alsnog echt atomair maken.
export const IN_FLIGHT_TIMEOUT_MS = 3 * 60 * 1000; // 3 minuten

// Pure functie -- bepaalt of een register-entry een nog-actieve in-flight-reservering heeft.
export function heeftActieveReservering(entry, nu = Date.now()) {
  if (!entry?.uploadInFlightSince) return false;
  const sinds = Date.parse(entry.uploadInFlightSince);
  if (Number.isNaN(sinds)) return false; // corrupte/onverwachte waarde -- geen blocker, behandel als "geen reservering"
  return (nu - sinds) < IN_FLIGHT_TIMEOUT_MS;
}

// Pure functie -- bepaalt HOE het register bijgewerkt moet worden om een in-flight-reservering
// te zetten. Retourneert null als er niets te doen is: geen verzendId, of een reeds actieve
// reservering (die de caller normaliter al via heeftActieveReservering() heeft afgevangen).
export function pasReserveringToe(entries, verzendId, nu = Date.now()) {
  if (!verzendId) return null;
  const bestaand = entries?.[verzendId];
  if (heeftActieveReservering(bestaand, nu)) return null;
  const updated = { ...(entries || {}) };
  updated[verzendId] = { ...(bestaand || {}), verzendId, uploadInFlightSince: new Date(nu).toISOString(), bijgewerkt: nu };
  return begrensRegister(updated);
}

// Pure functie -- wist een in-flight-reservering (best-effort na een mislukte poging, zodat een
// retry niet nodeloos tot 3 minuten moet wachten op zijn eigen vorige, mislukte reservering).
// Retourneert null als er niets te wissen valt (geen match, of al leeg).
export function wisReservering(entries, verzendId) {
  if (!verzendId) return null;
  const bestaand = entries?.[verzendId];
  if (!bestaand?.uploadInFlightSince) return null;
  const updated = { ...(entries || {}) };
  updated[verzendId] = { ...bestaand, uploadInFlightSince: null, bijgewerkt: Date.now() };
  return updated;
}

// ── rapportlijst: de ENE resterende best-effort write op de gedeelde archieflijst ───────────────
// Bepaalt HOE de rapports-array bijgewerkt moet worden na een geslaagde upload, puur voor
// label-consistentie in het Rapporten-tabblad (de idempotentie zelf steunt volledig op het
// register hierboven). Retourneert null als er niets te doen is: geen bijhorende archief-entry
// (defensief -- zou niet mogen gebeuren gezien de vaste volgorde archive→upload), of de entry
// staat al correct (geen nutteloze write/versie-increment).
export function pasMarkeringToe(rapporten, verzendId, attachmentId) {
  if (!verzendId) return null;
  const idx = (rapporten || []).findIndex(r => r.id === verzendId);
  if (idx < 0) return null;
  const bestaand = rapporten[idx];
  if (bestaand.zohoUploaded === true && bestaand.zohoAttachmentId === attachmentId && bestaand.geannuleerd === false) {
    return null; // al correct -- niets te doen
  }
  const updated = [...rapporten];
  updated[idx] = { ...updated[idx], zohoUploaded: true, zohoAttachmentId: attachmentId, geannuleerd: false };
  return updated;
}

export async function leesRegister(store) {
  return (await store.get(REGISTER_KEY, { type: 'json' })) || { versie: 0, entries: {} };
}
