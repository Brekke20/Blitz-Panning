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

const BLOK_LABEL = { verlof: 'Verlof', kantoor: 'Kantoor', afspraak: 'Afspraak' };

/** Tekst van een blok: de omschrijving, anders de soort ('Verlof'). */
export function blokTitel(blok) {
  return blok?.omschrijving || BLOK_LABEL[blok?.soort] || 'Blok';
}

export const OPSLAG_TEKST = 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.';

/** Begrijpelijke tekst voor een mislukte schrijfactie (resultaat van `wijzig`/`importeer`: { ok:false, reden, fout? }). */
export function foutTekst(r) {
  switch (r?.reden) {
    case 'opslag': return OPSLAG_TEKST;
    case 'netwerk': return 'Geen verbinding met de server. Probeer het opnieuw.';
    case 'conflict': return 'Deze gegevens zijn intussen gewijzigd. Bekijk de nieuwe stand en probeer het opnieuw.';
    case 'vervallen': return 'Deze lead bestaat niet meer.';
    default: return typeof r?.fout === 'string' && r.fout !== '' ? r.fout : 'Opslaan is mislukt. Probeer het opnieuw.';
  }
}
