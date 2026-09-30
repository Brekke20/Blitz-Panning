// Voorstelregister (blob `voorstel-status`): pure logica op een meegegeven store,
// zodat het testbaar is met een nep-store.
// Structuur: { versie, status: { [ticketId]: { contact?, klant?, installateur?, tijdslot?, tijdslotDatum?, bevestigd?: {door, tijdstip} } } }

const SLEUTEL = 'voorstel-status';
const TIJDSLOT_RE = /^([01]\d|2[0-3]):[0-5]\d–([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function leesRegister(store) {
  const data = await store.get(SLEUTEL, { type: 'json' }).catch(() => null);
  if (!data || typeof data !== 'object') return { versie: 0, status: {} };
  return { versie: typeof data.versie === 'number' ? data.versie : 0, status: data.status || {} };
}

export async function schrijfVoorstel(store, { ticketId, doelgroepen, tijdstip, tijdslot, tijdslotDatum, reset = false, versie } = {}) {
  const current = await leesRegister(store);
  if (typeof versie === 'number' && versie !== current.versie) {
    return { conflict: true, serverVersie: current.versie };
  }
  const slotExtra = (typeof tijdslot === 'string' && TIJDSLOT_RE.test(tijdslot)
                     && typeof tijdslotDatum === 'string' && DATE_RE.test(tijdslotDatum))
    ? { tijdslot, tijdslotDatum }
    : {};
  const basis = reset ? {} : { ...(current.status[ticketId] || {}) };
  const entry = { ...basis };
  for (const d of doelgroepen) entry[d] = tijdstip;
  Object.assign(entry, slotExtra);
  const nieuw = { versie: current.versie + 1, status: { ...current.status, [ticketId]: entry } };
  await store.setJSON(SLEUTEL, nieuw);
  return { ok: true, versie: nieuw.versie };
}

export async function wisVoorstel(store, ticketId) {
  const current = await leesRegister(store);
  const status = { ...current.status };
  delete status[ticketId];
  const nieuw = { versie: current.versie + 1, status };
  await store.setJSON(SLEUTEL, nieuw);
  return { versie: nieuw.versie };
}

export async function markeerBevestigd(store, ticketId, { door, tijdstip }) {
  const current = await leesRegister(store);
  const entry = { ...(current.status[ticketId] || {}), bevestigd: { door: door ?? null, tijdstip } };
  const nieuw = { versie: current.versie + 1, status: { ...current.status, [ticketId]: entry } };
  await store.setJSON(SLEUTEL, nieuw);
  return { versie: nieuw.versie };
}
