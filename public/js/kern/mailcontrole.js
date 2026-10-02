// kern/mailcontrole.js — na een onzeker resultaat (time-out, netwerkfout, 502/503/504) van een verzending naar de klant
// nagaan of de mail al weg is (etappe 7, Q1). Puur: geen toast, geen DOM. De schermen tonen de tekst.
// ENKEL LEZEN: één GET naar /api/mail-check (de server leest de uitgaande threads van het ticket in Zoho). Deze module
// verstuurt niets en start nooit zelf een nieuwe verzending; wat de gebruiker daarna doet, blijft zijn keuze.
// Elke uitkomst die niet zeker is (controle faalt, antwoord onleesbaar of onvolledig, mail maar deels weg) is 'onbekend'.
import { apiVerzoek } from './api.js';

export const TEKST_NIET_VERZONDEN = 'Mail is niet verzonden — je kan veilig opnieuw versturen';
export const TEKST_ONZEKER = 'De klant kan al gemaild zijn — kijk dit na in Zoho voor je opnieuw verstuurt';

const GELDIG_UUR = (iso) => typeof iso === 'string' && !Number.isNaN(Date.parse(iso));

// hh:mm in Brusselse tijd (de tijd die de gebruiker ook in Zoho ziet).
export function uurBrussel(iso) {
  return new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(iso)).replace(/^24:/, '00:');
}

// Zet het antwoord van /api/mail-check om in { uitkomst: 'verzonden' | 'niet-verzonden' | 'onbekend', verzonden: [{ aan, tijdstip }] }.
// `verwacht` = de adressen waarvan de oproeper weet dat ze de mail moesten krijgen (kan leeg zijn).
export function beoordeelAntwoord(data, verwacht = []) {
  const onbekend = { uitkomst: 'onbekend', verzonden: [] };
  if (!data || typeof data !== 'object' || data.ok !== true || typeof data.verzonden !== 'boolean' || typeof data.twijfel !== 'boolean') return onbekend;
  // twijfel: er is een uitgaande mail die niet te plaatsen was (onleesbaar adres, draft- of mislukte status): nooit "niet verzonden" melden.
  const adressen = verwacht.map(a => String(a).toLowerCase());
  if (adressen.length) {
    const o = data.ontvangers;
    if (!o || typeof o !== 'object') return onbekend;
    const vonden = [];
    for (const a of adressen) {
      const e = o[a];
      if (!e || typeof e.verzonden !== 'boolean') return onbekend;
      if (e.verzonden) {
        if (!GELDIG_UUR(e.tijdstip)) return onbekend;
        vonden.push({ aan: a, tijdstip: e.tijdstip });
      }
    }
    if (vonden.length === adressen.length) return { uitkomst: 'verzonden', verzonden: vonden };
    if (vonden.length === 0) return data.twijfel ? onbekend : { uitkomst: 'niet-verzonden', verzonden: [] };
    return onbekend; // maar een deel van de ontvangers kreeg de mail: geen zekere uitspraak
  }
  if (!data.verzonden) return data.twijfel ? onbekend : { uitkomst: 'niet-verzonden', verzonden: [] };
  const lijst = (Array.isArray(data.uitgaand) ? data.uitgaand : [])
    .filter(u => u && GELDIG_UUR(u.tijdstip))
    .map(u => ({ aan: typeof u.aan === 'string' ? u.aan : '', tijdstip: u.tijdstip }));
  if (lijst.length) return { uitkomst: 'verzonden', verzonden: lijst };
  return GELDIG_UUR(data.tijdstip) ? { uitkomst: 'verzonden', verzonden: [{ aan: '', tijdstip: data.tijdstip }] } : onbekend;
}

// Gooit nooit: elke fout (netwerk, time-out, 4xx/5xx, onleesbaar antwoord) is 'onbekend'.
export async function controleerMail({ ticketId, sinds, verwacht = [] }) {
  try {
    const params = new URLSearchParams({ ticketId: String(ticketId), sinds });
    if (verwacht.length) params.set('ontvangers', verwacht.join(','));
    const r = await apiVerzoek('/api/mail-check?' + params);
    return r.ok ? beoordeelAntwoord(r.data, verwacht) : { uitkomst: 'onbekend', verzonden: [] };
  } catch {
    return { uitkomst: 'onbekend', verzonden: [] };
  }
}

// De tekst die de gebruiker ziet bij een uitkomst (de drie teksten die Brent goedkeurde).
export function mailControleTekst({ uitkomst, verzonden }) {
  if (uitkomst === 'verzonden') {
    return verzonden.map(v => `Mail is verzonden om ${uurBrussel(v.tijdstip)}${v.aan ? ` (${v.aan})` : ''}`).join('; ');
  }
  return uitkomst === 'niet-verzonden' ? TEKST_NIET_VERZONDEN : TEKST_ONZEKER;
}
