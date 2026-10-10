// Planningsinds: sinds wanneer zit een ticket in het planningstraject (R4, R9).
// Pure logica op de Zoho-statusgeschiedenis en op een meegegeven store,
// zodat het testbaar is met een nep-store. Register: { [ticketId]: { sinds } }.

const SLEUTEL = 'planning-sinds';

export const TRAJECT = [
  'Service in te plannen',
  'Wachten op planning',
  'Wachten op bevestiging planning',
  'Geplande service',
  'Geplande support',
];

// Status-transitie van een history-item, of null als het item er geen heeft.
function statusOvergang(event) {
  const info = Array.isArray(event?.eventInfo) ? event.eventInfo : [];
  const s = info.find(i => i && i.propertyName === 'Status' && i.propertyValue);
  return s ? s.propertyValue : null;
}

// Eerste (nieuwste) event waarvan previousValue buiten het traject valt, of null.
function verlaatEvent(statusEvents) {
  for (const e of Array.isArray(statusEvents) ? statusEvents : []) {
    const pv = statusOvergang(e);
    if (!pv) continue;
    if (!TRAJECT.includes(pv.previousValue)) return e;
  }
  return null;
}

// statusEvents: nieuwste eerst. Geeft ISO-string, of null zonder createdTime.
export function berekenSinds(statusEvents, createdTime) {
  const e = verlaatEvent(statusEvents);
  if (e && e.eventTime) return e.eventTime;
  return createdTime || null;
}

// Meer history nodig? Geen verlaat-event gevonden en de pagina was vol.
export function volgendePaginaNodig(statusEvents, paginaGrootte) {
  const lijst = Array.isArray(statusEvents) ? statusEvents : [];
  return !verlaatEvent(lijst) && lijst.length === paginaGrootte;
}

export async function leesRegister(store) {
  const data = await Promise.resolve()
    .then(() => store.get(SLEUTEL, { type: 'json' }))
    .catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data;
}

export async function schrijfRegister(store, register) {
  await store.setJSON(SLEUTEL, register);
}
