// kern/feestdagen.js — Belgische wettelijke feestdagen (puur, geen DOM/window).
// Letterlijk uit het klassieke script van index.html (etappe 5b, taak 8); enkel `export` en de import van `localISO`.
import { localISO } from './tijd.js';

export function easterDate(year) {
  // Meeus/Jones/Butcher algoritme
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
export function getBelgianHolidays(year) {
  const e = easterDate(year);
  const d = (base, n) => { const r = new Date(base); r.setDate(r.getDate() + n); return localISO(r); };
  const f = (m, day) => `${year}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return {
    [f(1,  1)]: 'Nieuwjaar',
    [d(e, 1)]:  'Paasmaandag',
    [f(5,  1)]: 'Dag van de Arbeid',
    [d(e,39)]:  'Hemelvaartsdag',
    [d(e,50)]:  'Pinkstermaandag',
    [f(7, 21)]: 'Nationale Feestdag',
    [f(8, 15)]: 'O.L.V. Hemelvaart',
    [f(11, 1)]: 'Allerheiligen',
    [f(11,11)]: 'Wapenstilstand',
    [f(12,25)]: 'Kerstmis',
  };
}
const _holidayCache = {};
export function getHolidayName(dateStr) {
  const year = parseInt(dateStr.slice(0, 4));
  if (!_holidayCache[year]) _holidayCache[year] = getBelgianHolidays(year);
  return _holidayCache[year][dateStr] || null;
}
