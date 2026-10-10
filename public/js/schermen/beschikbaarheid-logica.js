// schermen/beschikbaarheid-logica.js — pure delen van de blokkeringen (etappe 5b, D18): volgende werkdag en weergave-groepering.
// De code is letterlijk uit index.html verhuisd; enkel `werkdagen` (vroeger `settings.werkdagen`) is nu een parameter.
// Geen DOM, geen toestand.

// Volgende werkdag na `dateStr` ('YYYY-MM-DD'); `werkdagen` = lijst getDay()-nummers (zo = 0).
// Is er geen enkele werkdag aangevinkt, dan bestaat er geen volgende werkdag: null (anders oneindige lus).
export function nextWorkday(dateStr, werkdagen) {
  if (![0, 1, 2, 3, 4, 5, 6].some(dag => werkdagen.includes(dag))) return null;
  const d = new Date(dateStr + 'T12:00:00');
  do { d.setDate(d.getDate() + 1); } while (!werkdagen.includes(d.getDay()));
  return d.toISOString().split('T')[0];
}

// Groepeert opeenvolgende 'hele dag'-uitzondering-rijen met dezelfde persoon/scope/reden tot één
// weergave-periode (bv. "17 aug – 21 aug 2026"), zodat een meerdaags verlof niet als N losse
// regels verschijnt. Zuiver een WEERGAVE-groepering: de onderliggende data blijft N losse
// avExceptions-records (nodig voor capacityForDay() in schermen/capaciteit.js en de kalender-dagblokkering, die per dag
// werken) -- verwijderen van een periode verwijdert wel alle onderliggende records ineens, zie
// avRemoveExceptionGroup(). Rijen worden enkel samengevoegd als ze ook echt op elkaar aansluiten
// (via nextWorkday) -- anders zou bv. verlof op 24-26 aug gevolgd door los verlof op
// 28 aug (met een gewone werkdag ertussen) foutief tonen als "24 aug – 28 aug".
export function groupExceptionsForDisplay(sortedList, werkdagen) {
  const groups = [];
  sortedList.forEach(e => {
    const last = groups[groups.length - 1];
    // Geen werkdagen -> nextWorkday geeft null -> niets sluit aan, elke rij blijft apart.
    const volgende = last ? nextWorkday(last.endDate, werkdagen) : null;
    const aaneensluitend = last && volgende !== null && volgende === e.date;
    if (last && aaneensluitend && e.kind === 'fullday' && last.kind === 'fullday' &&
        last.scope === e.scope && last.person === e.person && last.reason === e.reason) {
      last.items.push(e);
      last.endDate = e.date;
    } else {
      groups.push({ kind: e.kind, scope: e.scope, person: e.person, reason: e.reason,
                     startDate: e.date, endDate: e.date, items: [e] });
    }
  });
  return groups;
}

// Controle van een nieuw blokkeringsformulier (B8), gedeeld door het venster en de tab "Beschikbaarheden". Volgorde van de controles:
// eindtijd na begintijd, datum ingevuld, einddatum ingevuld (periode), einddatum niet voor startdatum.
// De melding "geen werkdagen in deze periode" blijft in de uitbreidingslus (die heeft `werkdagen` nodig).
export function valideerNieuweBlokkering({ kind, meerdaags, datum, datumTot, van, tot }) {
  if (kind === 'range' && van >= tot) return { ok: false, melding: '⚠ Eindtijd moet na begintijd liggen' };
  if (!datum) return { ok: false, melding: '⚠ Kies een datum' };
  if (kind === 'fullday' && meerdaags) {
    if (!datumTot) return { ok: false, melding: '⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit' };
    if (datumTot < datum) return { ok: false, melding: '⚠ Einddatum moet na startdatum liggen' };
  }
  return { ok: true };
}
