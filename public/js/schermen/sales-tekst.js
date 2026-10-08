// schermen/sales-tekst.js — kleine tekstvormers die de sales-schermlogica deelt (puur, geen DOM).
import { fmtDateShort } from '../kern/tijd.js';

const WEEKDAG = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

/** 'Marie Janssens' (voornaam + naam, wat er is) of 'Onbekende lead'. */
export function naamVan(lead) {
  return [lead?.voornaam, lead?.naam].filter(Boolean).join(' ') || 'Onbekende lead';
}

/** 'ma 12 okt' voor 'YYYY-MM-DD' (lokale tijd, op de middag zodat DST nooit een dag verschuift). */
export function dagLabel(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (isNaN(d)) return '';
  return `${WEEKDAG[d.getDay()]} ${fmtDateShort(d).replace(/\.$/, '')}`;
}
