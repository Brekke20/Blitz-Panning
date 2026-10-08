// Zware rapportinhoud (HTML + metadata voor de PDF) buiten de rapportlijst, als aparte blob per
// rapport: 'rapport-inhoud/<id>'. Zo blijft de lijst klein en kan de achtergrondverwerking de
// inhoud opvragen op id.

export const INHOUD_PREFIX = 'rapport-inhoud/';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGeldigId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

// `entry` (optioneel): de lichte lijst-entry die verwerkOntvangst in de rapportlijst zet. Zo kan
// verwerkRapport een entry terugzetten die door een gelijktijdige schrijver uit de lijst verdween.
export async function schrijfInhoud(store, { id, html, ticketId, filename, isLocal, entry }, nu = new Date()) {
  const inhoud = { id, html, ticketId, filename, isLocal, aangemaakt: nu.toISOString() };
  if (entry) inhoud.entry = entry;
  await store.setJSON(INHOUD_PREFIX + id, inhoud);
}

export async function leesInhoud(store, id) {
  return (await store.get(INHOUD_PREFIX + id, { type: 'json' })) ?? null;
}

// Best-effort: een mislukte opruiming mag nooit iets laten falen.
export async function verwijderInhoud(store, id) {
  try { await store.delete(INHOUD_PREFIX + id); } catch { /* best-effort */ }
}

// Na het verwijderen van een rapport uit de lijst: haal de bewaarde lijst-entry uit de inhoudsblob,
// zodat verwerkRapport het rapport niet terugzet (herstelEntry). De html blijft staan.
// Best-effort: faalt nooit.
export async function vergeetEntry(store, id) {
  try {
    const inhoud = await leesInhoud(store, id);
    if (!inhoud || !('entry' in inhoud)) return;
    const { entry, ...rest } = inhoud; // eslint-disable-line no-unused-vars
    await store.setJSON(INHOUD_PREFIX + id, rest);
  } catch { /* best-effort */ }
}

// Netlify-functies weigeren requests > 6 MB; houd marge voor de rest van de body.
export const MAX_HTML_TEKENS = 5_500_000;

// Valideert de body van POST /api/rapport-ontvangen. Geeft de waarden voor schrijfInhoud en de
// lijst-entry terug, of { ok:false, status, fout }. Testtickets (t1, p2, ...) zijn geen cijfers:
// in testmodus wordt de ticketId-cijfercontrole overgeslagen.
export function valideerOntvangst(body, { testModus = false } = {}) {
  const fout = (status, tekst) => ({ ok: false, status, fout: tekst });
  if (!body || typeof body !== 'object') return fout(400, 'Ongeldige body');
  const { id, html, archiveBody } = body;
  if (!isGeldigId(id)) return fout(400, 'Ongeldig id');
  if (typeof html !== 'string' || !html) return fout(400, 'html ontbreekt');
  if (html.length > MAX_HTML_TEKENS) return fout(413, "Rapport is te groot om te versturen (te veel foto's).");
  if (!archiveBody || typeof archiveBody !== 'object' || Array.isArray(archiveBody)) return fout(400, 'archiveBody ontbreekt');

  const isLocal = body.isLocal === true;
  const ticketId = body.ticketId == null ? '' : String(body.ticketId);
  const ticketOk = /^\d+$/.test(ticketId) || (isLocal && ticketId === '') || (testModus && ticketId !== '');
  if (!ticketOk) return fout(400, 'Ongeldig ticketId');

  const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'service-rapport.pdf';
  return { ok: true, waarden: { id, archiveBody, html, ticketId, filename, isLocal } };
}
