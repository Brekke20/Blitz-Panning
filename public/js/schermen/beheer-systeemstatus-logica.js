// schermen/beheer-systeemstatus-logica.js — pure logica van de knop "Opnieuw versturen" (Task 11b): de uitkomst per serverantwoord.
// Geen DOM, geen window. Invoer: het resultaat van beheerVerzoek ({ ok, status, data, netwerk }).

export const OPNIEUW_BEVESTIGING = Object.freeze({
  titel: 'Rapport opnieuw versturen?',
  tekst: 'Dit rapport opnieuw naar Zoho sturen?',
  bevestigLabel: 'Opnieuw versturen',
});

// -> { soort, toast, knopBruikbaar, rijOpnieuw }
//   rijOpnieuw: de rij toont "opnieuw in behandeling" (de server heeft het rapport weer op 'wacht' staan of het stond er al).
//   knopBruikbaar: na een mislukking mag de beheerder het opnieuw proberen.
export function opnieuwUitkomst(r) {
  if (r?.ok) {
    if (r.data?.ongewijzigd === true) {
      return { soort: 'ongewijzigd', toast: 'Dit rapport staat al in de wachtrij of is al verwerkt.', knopBruikbaar: false, rijOpnieuw: true };
    }
    return { soort: 'gelukt', toast: 'Rapport staat opnieuw in de wachtrij', knopBruikbaar: false, rijOpnieuw: true };
  }
  if (r?.netwerk) {
    return { soort: 'netwerk', toast: 'Geen verbinding met de server. Probeer het opnieuw.', knopBruikbaar: true, rijOpnieuw: false };
  }
  if (r?.status === 503) {
    return { soort: 'storing', toast: 'De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.', knopBruikbaar: true, rijOpnieuw: false };
  }
  const melding = typeof r?.data?.error === 'string' && r.data.error && !/^HTTP \d{3}$/.test(r.data.error) ? r.data.error : null;
  const status = r?.status ?? 0;
  return {
    soort: status >= 400 && status < 500 ? 'geweigerd' : 'fout',
    toast: melding ?? `Opnieuw versturen is mislukt (HTTP ${status}).`,
    knopBruikbaar: true,
    rijOpnieuw: false,
  };
}
