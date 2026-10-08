// Sales-planner: regels voor een blok (verlof, kantoor, afspraak) in de agenda van een verkoper (pure logica).
import { isGeldigeDatum, isGeldigUur } from './lead-regels.js';

export const BLOK_SOORTEN = ['verlof', 'kantoor', 'afspraak'];
const MAX_OMSCHRIJVING = 200;

/** Een blok van 00:00 tot 23:59 (of 24:00) is een hele dag. */
export function isHeleDag(blok) {
  return blok?.start === '00:00' && (blok.eind === '23:59' || blok.eind === '24:00');
}

const naarMin = (u) => Number(u.slice(0, 2)) * 60 + Number(u.slice(3));
const isUur = (u) => isGeldigUur(u) || u === '24:00'; // '24:00' enkel als einde van de dag

/** -> { fout } of { blok } (een kopie). */
export function valideerBlok(blok) {
  if (!blok || typeof blok !== 'object') return { fout: 'Blok ontbreekt' };
  if (!isGeldigeDatum(blok.datum)) return { fout: 'Ongeldige datum' };
  if (!isGeldigUur(blok.start) || !isUur(blok.eind)) return { fout: 'Ongeldig uur (HH:MM)' };
  if (naarMin(blok.start) >= naarMin(blok.eind)) return { fout: 'Het einde moet na het begin liggen' };
  if (!BLOK_SOORTEN.includes(blok.soort)) return { fout: 'Onbekende soort blok' };
  if (blok.omschrijving != null && (typeof blok.omschrijving !== 'string' || blok.omschrijving.length > MAX_OMSCHRIJVING)) {
    return { fout: `Omschrijving is te lang (max. ${MAX_OMSCHRIJVING} tekens)` };
  }
  return { blok: { ...blok } };
}
