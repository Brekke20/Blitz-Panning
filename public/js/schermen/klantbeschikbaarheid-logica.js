// schermen/klantbeschikbaarheid-logica.js — pure berekeningen van klantbeschikbaarheid (etappe 5b). Geen DOM, geen toestand.
// De 409-samenvoeging, de dirty-vergelijking van het concept en de GC-selectie zijn letterlijk uit index.html gehaald.

// Samenvoegen bij een 409: server-stand nemen, enkel de lokale tickets erover leggen (eigen wijziging wint op hetzelfde id).
// Een lokaal verwijderde entry mag niet terugkomen uit de server-stand (bugronde 2026-09-22, item B).
export function voegSamenKb(server, lokaal, lokaalVerwijderd) {
  const merged = { ...(server || {}) };
  Object.assign(merged, lokaal);
  for (const id of lokaalVerwijderd) delete merged[id];
  return merged;
}

// Handtekening van het concept: gelijk aan de bewaarde stand = niet dirty. Een duur van null telt als de standaardduur.
export function kbStand(draft, standaardDuur) {
  return JSON.stringify([draft.voorkeur, draft.voorkeurTijd, [...draft.geblokkeerd].sort(),
    draft.duur == null ? standaardDuur : draft.duur, draft.notitie]);
}

// GC: ids van entries die niet meer in een levende set zitten én >90 dagen geleden bijgewerkt zijn.
export function verouderdeKbIds(items, liveIds, nu = Date.now()) {
  const cutoff = nu - 90 * 24 * 60 * 60 * 1000;
  const ids = [];
  for (const id of Object.keys(items)) {
    if (liveIds.has(id)) continue;
    const ts = new Date(items[id]?.bijgewerkt || 0).getTime();
    if (ts < cutoff) ids.push(id);
  }
  return ids;
}
