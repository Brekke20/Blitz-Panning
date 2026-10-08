// public/js/rapport-inhoud.js
// Rapport-HTML ophalen voor het Rapporten-tabblad. Nieuwe archief-entries bewaren de HTML niet
// meer in de lijst (rapportData._html) maar apart in de inhoud-opslag; de lijst heeft dan
// `inhoudBeschikbaar: true` en de HTML komt via GET /api/rapport-archief?inhoud=<id>.
// Oude entries (nog niet gemigreerd) hebben de HTML nog inline.

// Heeft dit rapport HTML die we kunnen tonen/versturen (inline of op te halen)?
export function heeftRapportInhoud(r) {
  return !!r?.rapportData?._html || r?.inhoudBeschikbaar === true;
}

const _cache = new Map(); // id -> html (enkel geslaagde ophalingen)

export function wisInhoudCache() { _cache.clear(); }

// Inline `_html` eerst (geen netwerk); anders één GET per id, daarna uit de cache.
// Fouten, 404 of een onverwacht antwoord geven null (de aanroeper toont dan een melding).
export async function haalRapportHtml(r, { fetch = globalThis.fetch } = {}) {
  const inline = r?.rapportData?._html;
  if (inline) return inline;
  const id = r?.id;
  if (!id) return null;
  if (_cache.has(id)) return _cache.get(id);
  try {
    const res = await fetch(`/api/rapport-archief?inhoud=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data?.html !== 'string' || !data.html) return null;
    _cache.set(id, data.html);
    return data.html;
  } catch {
    return null;
  }
}

// Bridge voor de klassieke script in index.html (voorbeeldRapport/verstuurRapport).
if (typeof window !== 'undefined') {
  window.haalRapportHtml = haalRapportHtml;
  window.heeftRapportInhoud = heeftRapportInhoud;
}
