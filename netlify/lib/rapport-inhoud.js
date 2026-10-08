// Zware rapportinhoud (HTML + metadata voor de PDF) buiten de rapportlijst, als aparte blob per
// rapport: 'rapport-inhoud/<id>'. Zo blijft de lijst klein en kan de achtergrondverwerking de
// inhoud opvragen op id.

export const INHOUD_PREFIX = 'rapport-inhoud/';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isGeldigId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

export async function schrijfInhoud(store, { id, html, ticketId, filename, isLocal }, nu = new Date()) {
  await store.setJSON(INHOUD_PREFIX + id, {
    id, html, ticketId, filename, isLocal, aangemaakt: nu.toISOString(),
  });
}

export async function leesInhoud(store, id) {
  return (await store.get(INHOUD_PREFIX + id, { type: 'json' })) ?? null;
}

// Best-effort: een mislukte opruiming mag nooit iets laten falen.
export async function verwijderInhoud(store, id) {
  try { await store.delete(INHOUD_PREFIX + id); } catch { /* best-effort */ }
}
