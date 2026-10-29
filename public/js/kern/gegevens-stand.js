// kern/gegevens-stand.js — de balk "Gegevens van HH:MM — Zoho even niet bereikbaar" (zuiver, geen DOM).
// /api/tickets zet bij een terugval op een oude momentopname (Zoho faalde of antwoordde niet) de kop `X-Blitz-Verouderd: 1`, met in
// `X-Blitz-Leeftijd` de leeftijd van die momentopname in hele seconden (relatief, dus los van het klokverschil tussen toestel en server).
// Een gewone momentopname of een live lading heeft die kop nooit: dan hoort er geen balk te staan.

// headers: een Headers-achtig object (get). Geeft { tekst } voor de balk, of null als er niets te tonen valt.
export function verouderdVanKoppen(headers, nu = Date.now()) {
  const vlag = headers?.get?.('X-Blitz-Verouderd');
  if (vlag !== '1') return null;
  const ruw = headers.get('X-Blitz-Leeftijd');
  const leeftijd = ruw === null || ruw === '' ? NaN : Number(ruw); // een ontbrekende kop is geen 0 seconden
  return { tekst: verouderdTekst(Number.isFinite(leeftijd) && leeftijd >= 0 ? leeftijd : null, nu) };
}

// leeftijdS: seconden, of null als de leeftijd onbekend is (dan zonder tijdstip).
export function verouderdTekst(leeftijdS, nu = Date.now()) {
  if (leeftijdS === null || !Number.isFinite(leeftijdS)) return 'Gegevens niet actueel — Zoho even niet bereikbaar';
  const tijd = new Date(nu - leeftijdS * 1000).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `Gegevens van ${tijd} — Zoho even niet bereikbaar`;
}
