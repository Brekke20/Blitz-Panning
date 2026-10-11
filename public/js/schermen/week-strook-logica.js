// schermen/week-strook-logica.js — de dagen van de weekstrook bovenaan de Route-tab (puur, geen DOM). Gedeeld door de route van de technieker
// (route.js) en die van de verkoper (sales-route.js).
import { localISO } from '../kern/tijd.js';

export const WEEKSTROOK_DAG = Object.freeze(['ZO', 'MA', 'DI', 'WO', 'DO', 'VR', 'ZA']);
const STANDAARD_WERKDAGEN = [1, 2, 3, 4, 5];

export function isoNaarDatum(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }

/** 'YYYY-MM-DD' + n dagen (lokaal), als 'YYYY-MM-DD'. */
export function weekstrookVerschuif(iso, dagen) {
  const d = isoNaarDatum(iso);
  d.setDate(d.getDate() + dagen);
  return localISO(d);
}

/**
 * De week (ma..zo) van `datum` ('YYYY-MM-DD'): de maandag en de werkdagen (Date-objecten, op volgorde). `werkdagen` = getDay()-nummers (0 = zondag);
 * zonder lijst geldt maandag tot vrijdag. Een zondag hoort bij de week ervoor.
 */
export function weekstrookDagen(datum, werkdagen) {
  const d0 = isoNaarDatum(datum);
  const maandag = new Date(d0);
  maandag.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));
  const gewerkt = werkdagen || STANDAARD_WERKDAGEN;
  const dagen = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(maandag);
    d.setDate(maandag.getDate() + i);
    if (gewerkt.includes(d.getDay())) dagen.push(d);
  }
  return { maandag, dagen };
}
