// Gedeelde onderdelen van de voorstelmail en de herinneringsmail: de twee keuzeknoppen ("Bevestig deze afspraak" en "Deze datum lukt
// niet") en de zin eronder. propose.js (het voorstel) en lib/herinnering.js (de herinnering 3 dagen vooraf) gebruiken dezelfde code,
// zodat de knoppen nooit uit elkaar lopen. Pure functies, geen netwerk.

export const BEVESTIG_KNOP_TEKST = '✅ Bevestig deze afspraak';
export const NEE_KNOP_TEKST = 'Deze datum lukt niet';

// Dezelfde getekende URL met `keuze=nee`: dat zet de bevestigingspagina enkel vooraf op "Deze datum lukt niet" (de handtekening
// verandert niet, `keuze` zit er niet in en heeft geen ander effect; zie confirm-afspraak.js).
export function maakNeeUrl(confirmUrl) {
  return confirmUrl ? `${confirmUrl}&keuze=nee` : null;
}

// De twee knoppen onder de afspraakbox. Zonder bevestigingslink (bv. CONFIRM_LINK_SECRET niet gezet) geen enkele knop.
export function bevestigKnoppenHtml(confirmUrl) {
  if (!confirmUrl) return '';
  return `<div style="text-align:center;margin:18px 0">
      <a href="${confirmUrl}" style="display:inline-block;background:#00dfa3;color:#181e24;
        text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:6px">
        ${BEVESTIG_KNOP_TEKST}
      </a>
    </div>
    <div style="text-align:center;margin:0 0 18px">
      <a href="${maakNeeUrl(confirmUrl)}" style="display:inline-block;color:#3a3a3a;
        text-decoration:none;font-weight:600;font-size:13px;padding:10px 24px;border-radius:6px;border:1px solid #c9d0d8">
        ${NEE_KNOP_TEKST}
      </a>
    </div>`;
}

// De zin onder de knoppen (enkel met bevestigingslink).
export const KEUZE_TEKST = `Klik op de knop hierboven en bevestig op de volgende pagina om deze afspraak vast te leggen. Lukt de datum niet? Kies dan "${NEE_KNOP_TEKST}" of antwoord gewoon op deze e-mail.`;

// Kuist een ruwe (vaak doorgestuurde-mail-)ticket-titel op tot een klantvriendelijke omschrijving: strip herhaalde forward-/antwoordprefixen
// (FW:/Fwd:/RE:/AW:/WG:/TR:, ook genest) en de automatische titel "Nieuw contactbericht van ..."; blijft er niets over, dan 'uw laadstation'.
// Verhuisd uit propose.js (gedrag ongewijzigd) zodat de herinnering dezelfde omschrijving gebruikt. Idempotent. Gedupliceerd in
// public/js/schermen/ticketdetail-logica.js (client en server delen geen module).
export function cleanTicketSubject(raw) {
  let s = String(raw || '').trim();
  const prefixRe = /^(fw|fwd|re|aw|wg|tr)\s*:\s*/i;
  let prev;
  do { prev = s; s = s.replace(prefixRe, '').trim(); } while (s !== prev);
  if (/^nieuw contactbericht van\b/i.test(s)) s = '';
  return s || 'uw laadstation';
}
