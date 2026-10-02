// schermen/ticketdetail-logica.js — pure logica voor ticketdetail en voorstel (geen window/document).
// Letterlijk overgenomen uit index.html; globals zijn parameters geworden.
import { timeStrToMin, minToTimeStr } from '../kern/tijd.js';

// Tijdslot rond een schatting. `settings` is een parameter (vroeger de global `settings`).
export function tijdslotVoor(minuten, slotMinuten, settings = {}) {
  const slot     = slotMinuten || settings.tijdslotMinuten || 180;
  const dagStart = timeStrToMin(settings.vanTijd || '08:00');
  const dagEind  = timeStrToMin(settings.totTijd || '17:00');
  let start = Math.floor((minuten - 30) / 30) * 30;
  start = Math.max(dagStart, start);
  let eind = start + slot;
  if (eind > dagEind) { eind = dagEind; start = Math.max(dagStart, eind - slot); }
  if (minuten < start || minuten >= eind) {
    start = Math.max(0, Math.floor((minuten - 30) / 30) * 30);
    eind  = start + slot;
  }
  return { startMin: start, endMin: eind, label: `${minToTimeStr(start)}–${minToTimeStr(eind)}` };
}

export function roundToNextQuarterStr(timeStr) {
  const [hRaw, mRaw] = (timeStr || '09:00').split(':').map(Number);
  const h = Number.isFinite(hRaw) ? hRaw : 9;
  const m = Number.isFinite(mRaw) ? mRaw : 0;
  const raw = Math.ceil(m / 15) * 15;
  const totalMin = (h * 60 + raw) % (24 * 60); // uur-overloop wrapt naar 00:xx i.p.v. "24:00"
  const outH = Math.floor(totalMin / 60);
  const outM = totalMin % 60;
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
}

// Onderwerp zonder doorstuur-/antwoordprefixen en zonder "Nieuw contactbericht van ..."; anders neutrale fallback.
export function cleanTicketSubject(raw) {
  let s = String(raw || '').trim();
  const prefixRe = /^(fw|fwd|re|aw|wg|tr)\s*:\s*/i;
  let prev;
  do { prev = s; s = s.replace(prefixRe, '').trim(); } while (s !== prev);
  if (/^nieuw contactbericht van\b/i.test(s)) s = '';
  return s || 'uw laadstation';
}

export function joinNL(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' en ' + items[items.length - 1];
}

// Enkelvoud/meervoud bij een telzin: meervoud(2, 'ticket', 'tickets') → '2 tickets'
export function meervoud(n, e, m) { return `${n} ${n === 1 ? e : m}`; }

// Nummer voor een tel:-link: "(0)" in Belgische notatie ("+32 (0)9 …") wordt weggelaten, daarna enkel cijfers en "+".
export function telNummer(tel) { return tel ? String(tel).replace(/\(0\)/g, '').replace(/[^\d+]/g, '') : ''; }

// Ontdubbelde (hoofdletterongevoelige) lijst e-mailadressen: contact, eindklant, installateur.
export function voorstelOntvangers(ticket) {
  const seenEmails = new Set();
  return [ticket.email || null, ticket.emailEindklant || null, ticket.emailInstallateur || null]
    .filter(email => {
      if (!email) return false;
      const key = email.toLowerCase();
      if (seenEmails.has(key)) return false;
      seenEmails.add(key);
      return true;
    });
}

// Label voor bevestiging — toont via welke ontvanger een afspraak bevestigd werd.
export function bevestigdLabel(vs) {
  if (!vs?.bevestigd) return null;
  const { door } = vs.bevestigd;
  const doorNaam = door ? { contact: 'contactpersoon', klant: 'klant', installateur: 'installateur' }[door] : null;
  return doorNaam ? `✓ Bevestigd door ${doorNaam}` : '✓ Bevestigd';
}

// Staat er een lopend voorstel? `voorstelStatus` is een parameter (vroeger de global).
export function heeftLopendVoorstel(t, voorstelStatus = {}) {
  if (!t) return false;
  const vs = voorstelStatus[t.id];
  const GEPLAND = ['Wachten op bevestiging planning', 'Geplande service', 'Geplande support'];
  if (vs && (vs.contact || vs.klant || vs.installateur || vs.bevestigd) && GEPLAND.includes(t.status)) return true;
  return ['Geplande service', 'Geplande support'].includes(t.status);
}
