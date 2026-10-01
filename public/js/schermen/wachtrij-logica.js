// schermen/wachtrij-logica.js — pure logica van de wachtrij: zoeken, sorteren en scoren (geen DOM, geen toestand).
import { localISO } from '../kern/tijd.js';

export const PRIO_WEIGHT = { high: 1, medium: 3, low: 6 };

// Hoofdletter- en accentongevoelig
export function wqNorm(x) {
  return String(x == null ? '' : x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
export function wqZoekTekst(t) {
  return wqNorm([t.number, t.subject, t.account, t.naamEindklant, t.contact, t.regio, t.address, t.assignee].join(' '));
}

// Zoekwoorden uit een zoektekst: genormaliseerd, leidende '#' weggelaten.
export function zoekWoorden(zoek) {
  return wqNorm(zoek).split(/\s+/).map(w => w.replace(/^#+/, '')).filter(Boolean);
}

// Zoeken: alle woorden moeten voorkomen. Zonder woorden komt de invoer ongewijzigd terug (zelfde array).
export function filterOpZoek(tickets, zoek) {
  const woorden = zoekWoorden(zoek);
  return woorden.length
    ? tickets.filter(t => { const h = wqZoekTekst(t); return woorden.every(w => h.includes(w)); })
    : tickets;
}

// `vandaag`: 'YYYY-MM-DD'
export function isOverdue(t, vandaag) {
  return t.interventieDatum && localISO(new Date(t.interventieDatum)) < vandaag;
}

export function urgencyFactor(t, nu) {
  if (!t.interventieDatum) return 1.0;
  const today0 = new Date(nu); today0.setHours(0,0,0,0);
  const due    = new Date(t.interventieDatum); due.setHours(0,0,0,0);
  return Math.max(0.1, Math.min(1.0, (due - today0) / 86400000 / 7));
}
export function queueScore(t, nu) {
  const pw = PRIO_WEIGHT[(t.priority||'').toLowerCase()] ?? 9;
  return pw * urgencyFactor(t, nu);
}

// Sorteert een kopie van `tickets`. modus: 'standaard' | 'oudst' | 'nieuwst' | 'interventie'.
// Ontbrekende of ongeldige datums komen achteraan. `vandaag` ('YYYY-MM-DD') en `nu` (Date) zijn parameters.
export function sorteerWachtrij(tickets, modus, { vandaag, nu }) {
  const lijst = [...tickets];
  const tijd = (x) => { const n = Date.parse(x); return isNaN(n) ? null : n; };
  if (modus === 'oudst' || modus === 'nieuwst') {
    const r = modus === 'oudst' ? 1 : -1;
    lijst.sort((a, b) => {
      const ta = tijd(a.createdTime), tb = tijd(b.createdTime);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return (ta - tb) * r;
    });
  } else if (modus === 'interventie') {
    lijst.sort((a, b) => {
      const ta = tijd(a.interventieDatum), tb = tijd(b.interventieDatum);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return ta - tb;
    });
  } else {
    // Sortering: 1) overdue eerst  2) queueScore (prio × urgentie — zelfde formule als autoPlan)
    lijst.sort((a, b) => {
      const aOd = isOverdue(a, vandaag) ? 0 : 1, bOd = isOverdue(b, vandaag) ? 0 : 1;
      if (aOd !== bOd) return aOd - bOd;
      return queueScore(a, nu) - queueScore(b, nu);
    });
  }
  return lijst;
}
