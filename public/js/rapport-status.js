// public/js/rapport-status.js
// Verwerkingsstatus van rapporten in het Rapporten-tabblad: badges, "Opnieuw versturen" en
// de eenmalige melding aan de technieker als een rapport definitief niet naar Zoho kon.
// escHtml (kern/ui.js) op alle vrije tekst, ook in attributen.
import { escHtml, toast } from './kern/ui.js';
import { TEST_MODE } from './kern/omgeving.js';
import { toestand } from './kern/toestand.js';
import { TEST_UPLOAD } from './test-upload.js';

const GEZIEN_KEY = 'blitz_mislukt_gezien';

// Zelfde mapping als de server (netlify/lib/rapportlijst.js effectieveStatus).
export function effectieveStatus(r) {
  return r?.verwerking?.status
    ?? (r?.zohoUploaded ? 'in-zoho' : (r?.geannuleerd ? 'geannuleerd' : 'onbekend'));
}

const BADGE_STIJL = 'font-size:0.68rem;padding:1px 6px;border-radius:20px;font-weight:600;';

export function statusBadgeHtml(r) {
  const status = effectieveStatus(r);
  switch (status) {
    case 'wacht':
    case 'bezig':
      return `<span class="rapport-status rapport-status-bezig" style="${BADGE_STIJL}background:var(--surface3);color:var(--muted)">⏳ In verwerking</span>`;
    case 'in-zoho':
      return `<span class="rapport-status rapport-status-zoho" style="${BADGE_STIJL}background:var(--accent-dim);color:var(--accent-ink)">✓ In Zoho</span>`;
    case 'mislukt': {
      const fout = r?.verwerking?.laatsteFout;
      const title = fout ? ` title="${escHtml(fout)}"` : '';
      return `<span class="rapport-status rapport-status-mislukt" style="${BADGE_STIJL}border:1px solid var(--red);color:var(--red)"${title}>✕ Mislukt</span>`;
    }
    case 'lokaal':
      return `<span class="rapport-status rapport-status-lokaal" style="${BADGE_STIJL}background:var(--surface3);color:var(--muted)">Lokaal</span>`;
    default: // 'geannuleerd' (toont al "Niet verzonden") en 'onbekend'
      return '';
  }
}

export function opnieuwKnopHtml(r) {
  if (effectieveStatus(r) !== 'mislukt' || !r?.id) return '';
  return `<button class="cal-btn btn-opnieuw-rapport" data-rapport-id="${escHtml(r.id)}">↻ Opnieuw versturen</button>`;
}

// POST { opnieuw: id }. `ongewijzigd` (rapport was intussen niet meer mislukt) telt ook als ok.
export async function opnieuwVersturen(id, { fetch = globalThis.fetch } = {}) {
  try {
    const res = await fetch('/api/rapport-archief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opnieuw: id }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* geen JSON-body */ }
    if (!res.ok) return { ok: false, fout: data?.error || `Fout ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, fout: err?.message || 'Geen verbinding' };
  }
}

export function misluktMeldingTekst(r) {
  return `Rapport #${r?.ticketNumber ?? ''} kon niet naar Zoho. Je hoeft niets opnieuw in te vullen; kantoor is verwittigd.`;
}

const norm = s => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// Mislukte rapporten van deze technieker die nog niet gemeld zijn.
export function teMeldenMislukt(rapporten, { technieker, gezien } = {}) {
  const wie = norm(technieker);
  if (!wie || !Array.isArray(rapporten)) return [];
  return rapporten.filter(r =>
    effectieveStatus(r) === 'mislukt' &&
    norm(r.technieker) === wie &&
    !(gezien && gezien.has(r.id)));
}

function leesGezien() {
  try {
    const v = JSON.parse(localStorage.getItem(GEZIEN_KEY) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch { return new Set(); }
}
function bewaarGezien(set) {
  try { localStorage.setItem(GEZIEN_KEY, JSON.stringify([...set])); } catch { /* geen opslag */ }
}

let _gemeld = false; // één melding per paginasessie

// Toont (hoogstens) één toast per paginasessie voor mislukte rapporten van de technieker die
// op dit toestel is ingesteld. Enkel voor rol technieker met een persoon gekozen.
export function toonMisluktMeldingen(rapporten) {
  try {
    if (_gemeld) return;
    if (window.apparaat?.rol !== 'technieker') return;
    const persoon = toestand.get('activeAssigneeFilter');
    if (!persoon || persoon === 'all') return;
    if (TEST_MODE && !TEST_UPLOAD) return; // gewone testmodus: demodata, geen echte meldingen
    _gemeld = true;
    const gezien = leesGezien();
    const nieuw = teMeldenMislukt(rapporten, { technieker: persoon, gezien });
    if (!nieuw.length) return;
    const tekst = nieuw.length === 1
      ? misluktMeldingTekst(nieuw[0])
      : `${nieuw.length} rapporten konden niet naar Zoho (${nieuw.map(r => '#' + r.ticketNumber).join(', ')}). Je hoeft niets opnieuw in te vullen; kantoor is verwittigd.`;
    toast('⚠ ' + tekst, 12000);
    nieuw.forEach(r => gezien.add(r.id));
    bewaarGezien(gezien);
  } catch { /* een melding mag de app nooit breken */ }
}
