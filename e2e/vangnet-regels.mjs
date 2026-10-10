// Puur regelbestand voor de productiemodus-e2e (etappe 5a, D4-D6): welk verzoek mag er tijdens een
// test de browser uit? Geen Playwright-import, zodat het met `node --test` te toetsen is.
// Principe: een lijst van toegestane bestemmingen (geen lijst van verboden), plus een tweede,
// aparte lijst bekende Zoho/TomTom/mail-patronen die enkel de reden in het foutbericht verduidelijkt.

// Hoofdletterongevoelig, op de hostnaam. Dient de reden ("extern systeem") en als extra slot voor
// de zelftest; de toelating zelf hangt er niet van af.
export const ZOHO_TOMTOM_MAIL_PATRONEN = /zoho|tomtom|smtp|mail\.|mailgun|sendgrid|office365|outlook|gmail/i;

// De statische server van de e2e-suite (e2e/statische-server.mjs). Exact host + poort.
const EIGEN_HOSTS = new Set(['127.0.0.1:3338', 'localhost:3338']);
// Enkel lezen, enkel scripts/stijlen (index.html laadt hier zijn bibliotheken vandaan).
const CDN_HOSTS = new Set(['cdnjs.cloudflare.com', 'cdn.jsdelivr.net']);
const LEES_METHODES = new Set(['GET', 'HEAD']);

export function isToegestaan({ url, methode }) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, reden: `ongeldige URL: ${url}` }; }
  const m = String(methode || 'GET').toUpperCase();
  // Verlaten de browser niet.
  if (u.protocol === 'about:' || u.protocol === 'data:' || u.protocol === 'blob:') return { ok: true, reden: 'lokaal protocol' };
  if (u.protocol === 'http:' && EIGEN_HOSTS.has(u.host)) return { ok: true, reden: 'statische testserver' };
  if (u.protocol === 'https:' && CDN_HOSTS.has(u.host)) {
    return LEES_METHODES.has(m)
      ? { ok: true, reden: 'CDN (enkel lezen)' }
      : { ok: false, reden: `${m} naar CDN ${u.host}: enkel GET/HEAD` };
  }
  if (ZOHO_TOMTOM_MAIL_PATRONEN.test(u.hostname)) {
    return { ok: false, reden: `Zoho/TomTom/mail-host geweigerd: ${u.host}` };
  }
  return { ok: false, reden: `host niet toegestaan: ${u.protocol}//${u.host}` };
}
