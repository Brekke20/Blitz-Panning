// Meldgrens van de wagenvoorraad (v2.4.0, spec docs/superpowers/specs/2026-10-27-voorraad-meldgrens-design.md). Puur.
// Een voorraadregel is { aantal, gedempt, drempel }: drempel = melden bij aantal <= drempel, null = geen melding.
// Dezelfde normalisatie als de server (normStock in netlify/functions/inventaris.js): de client leest ook nog oude caches.

export const MAX_DREMPEL = 999;
const MAX_NAMEN = 3;

export function voorraadRegel(val) {
  if (val == null) return { aantal: 0, gedempt: true, drempel: null };
  if (typeof val === 'number') return { aantal: val, gedempt: false, drempel: 0 };
  const drempel = val.drempel !== undefined ? val.drempel : (val.gedempt ? null : 0);
  return { aantal: val.aantal || 0, gedempt: drempel === null, drempel };
}

// 'uit' (geen melding), 'op' (niets meer), 'bijna' (aantal <= drempel) of 'ok'.
export function voorraadStatus({ aantal, drempel }) {
  if (drempel === null || drempel === undefined) return 'uit';
  if ((aantal || 0) <= 0) return 'op';
  return aantal <= drempel ? 'bijna' : 'ok';
}

// Producten van de catalogus die melden ('op' eerst, daarna 'bijna'; binnen elk op naam). `ids` beperkt tot die materialen.
export function lageItems(stock, onderdelen, ids = null) {
  const filter = ids ? new Set(ids) : null;
  const uit = [];
  for (const o of onderdelen || []) {
    if (filter && !filter.has(o.id)) continue;
    const r = voorraadRegel((stock || {})[o.id]);
    const status = voorraadStatus(r);
    if (status === 'op' || status === 'bijna') uit.push({ id: o.id, naam: o.naam, aantal: r.aantal, drempel: r.drempel, status });
  }
  return uit.sort((a, b) => (a.status === b.status ? a.naam.localeCompare(b.naam) : a.status === 'op' ? -1 : 1));
}

// "Energiemeter - Eastron SDM54-M (nog 1), Kabel 5G6 (op) en 2 andere"
export function meldTekst(items) {
  const deel = i => `${i.naam} (${i.status === 'op' ? 'op' : 'nog ' + i.aantal})`;
  const getoond = items.slice(0, MAX_NAMEN).map(deel);
  const rest = items.length - getoond.length;
  if (rest > 0) return `${getoond.join(', ')} en ${rest} ${rest === 1 ? 'ander' : 'andere'}`;
  if (getoond.length <= 1) return getoond.join('');
  return `${getoond.slice(0, -1).join(', ')} en ${getoond[getoond.length - 1]}`;
}

// Opstartmelding: "⚠ Check je voorraad: 2 producten bijna op of op" (null als er niets meldt).
export function startTekst(items) {
  if (!items.length) return null;
  const op = items.filter(i => i.status === 'op').length;
  const bijna = items.length - op;
  const soort = op && bijna ? 'bijna op of op' : op ? 'op' : 'bijna op';
  return `⚠ Check je voorraad: ${items.length} ${items.length === 1 ? 'product' : 'producten'} ${soort}`;
}
