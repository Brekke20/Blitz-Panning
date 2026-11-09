// Annuleren van een afspraak: vaste redenen, validatie, klantmail (HTML) en interne notitie.
// Pure logica, geen netwerk; gebruikt door netlify/functions/annuleer.js.
import { mailKader } from './mailkader.js';

// `geenreactie` ("Geen reactie van de klant") is de enige reden die het ticket SLUIT (Zoho-status 'Gesloten - ov') in plaats van
// terug te zetten op 'Wachten op planning', met een eigen mail (bouwGeenReactieMail) zonder klantzin. 'andere' blijft de laatste.
export const REDENEN = [
  { code: 'ziek',       label: 'Technieker ziek of onbeschikbaar',  klantzin: 'Onze technieker is onverwacht niet beschikbaar.' },
  { code: 'onderdelen', label: 'Onderdelen niet op tijd geleverd',  klantzin: 'De nodige onderdelen zijn niet op tijd bij ons geleverd.' },
  { code: 'klant',      label: 'Klant vroeg om te verzetten',       klantzin: 'Zoals met u besproken, verplaatsen we deze afspraak.' },
  { code: 'weer',       label: 'Weersomstandigheden',               klantzin: 'De weersomstandigheden laten niet toe om de werken veilig uit te voeren.' },
  { code: 'fout',       label: 'Dubbele of foute planning',         klantzin: 'Door een fout in onze planning kan deze afspraak niet doorgaan.' },
  { code: 'geenreactie', label: 'Geen reactie van de klant',        klantzin: null },
  { code: 'andere',     label: 'Andere',                            klantzin: null },
];

export const STATUS_NA_GEEN_REACTIE = 'Gesloten - ov';
export const STATUS_NA_ANNULATIE = 'Wachten op planning';

// De Zoho-status waarop het ticket na de annulatie komt te staan.
export function statusNaAnnulatie(reden) {
  return reden === 'geenreactie' ? STATUS_NA_GEEN_REACTIE : STATUS_NA_ANNULATIE;
}

export const MAX_TOELICHTING = 1000;
export const MAX_DOOR = 60;

export function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Valideert enkel reden + toelichting (gedeeld door echte annulatie en mailvoorbeeld).
export function valideerRedenToelichting(body) {
  const b = body || {};
  const r = REDENEN.find(x => x.code === b.reden);
  if (!r) return { ok: false, fout: 'Onbekende reden' };
  if (b.toelichting != null && typeof b.toelichting !== 'string') return { ok: false, fout: 'Ongeldige toelichting' };
  const toelichting = (b.toelichting || '').trim();
  if (toelichting.length > MAX_TOELICHTING) return { ok: false, fout: `Toelichting mag maximaal ${MAX_TOELICHTING} tekens zijn` };
  if (r.code === 'andere' && !toelichting) return { ok: false, fout: 'Toelichting is verplicht bij reden "Andere"' };
  return { ok: true, waarde: { reden: r.code, toelichting } };
}

// Buiten testmodus is ticketId strikt numeriek; enkel in testmodus (voorbeeldtickets als "p1")
// volstaat een korte veilige id.
export function valideerAnnulatie(body, { test = false } = {}) {
  const b = body || {};
  const idOk = test ? /^[A-Za-z0-9_-]{1,20}$/ : /^\d+$/;
  if (!idOk.test(String(b.ticketId ?? ''))) return { ok: false, fout: 'ticketId (numeriek) is verplicht' };
  const rt = valideerRedenToelichting(b);
  if (!rt.ok) return rt;
  if (typeof b.mailKlant !== 'boolean') return { ok: false, fout: 'mailKlant (boolean) is verplicht' };
  if (b.door != null && typeof b.door !== 'string') return { ok: false, fout: 'Ongeldige waarde voor door' };
  const door = (b.door || '').trim();
  if (door.length > MAX_DOOR) return { ok: false, fout: `door mag maximaal ${MAX_DOOR} tekens zijn` };
  return {
    ok: true,
    waarde: { ticketId: String(b.ticketId), reden: rt.waarde.reden, toelichting: rt.waarde.toelichting, mailKlant: b.mailKlant, door },
  };
}

function tijdDeel(tijdslot, uur) {
  if (tijdslot) return `(${escHtml(tijdslot)})`;
  if (uur) return `(om ${escHtml(uur)})`;
  return '(tijdstip nog te bevestigen)';
}

// "uw afspraak van <datum> (tijdslot)"-fragment, gedeeld door de annulatiemail en de geen-reactie-mail. `voorAfspraak` is de tekst vóór
// "van <datum>" (bv. 'uw afspraak'); zonder geldige datum volgt de neutrale tekst.
function afspraakFragment(voorAfspraak, { datum, tijdslot, uur }) {
  if (datum && /^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    const d = new Date(`${datum}T12:00:00Z`).toLocaleDateString('nl-BE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels',
    });
    return `${voorAfspraak} van <strong style="color:#181e24">${escHtml(d)}</strong> ${tijdDeel(tijdslot, uur)}`;
  }
  return `${voorAfspraak} (tijdstip nog te bevestigen)`;
}

export function bouwAnnulatieMail({ naam, datum, tijdslot, uur, reden, toelichting }) {
  // Geen reactie van de klant: eigen sjabloon (geen klantzin, geen belofte van een nieuw voorstel).
  if (reden === 'geenreactie') return bouwGeenReactieMail({ naam, datum, tijdslot, uur });

  const r = REDENEN.find(x => x.code === reden);
  const redenzin = r ? (r.code === 'andere' ? escHtml((toelichting || '').trim()) : r.klantzin) : '';
  const afspraak = afspraakFragment('uw afspraak', { datum, tijdslot, uur });

  return mailKader(`    <p style="margin:0 0 16px;font-size:15px;color:#181e24">Beste ${escHtml(naam) || 'klant'},</p>
    <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.65">
      Helaas moeten we ${afspraak} annuleren. ${redenzin}
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.65">
      Onze excuses voor het ongemak. We nemen zo snel mogelijk contact met u op om een nieuwe datum af te spreken.
    </p>
    <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65">
      Met vriendelijke groeten,<br>
      <strong style="color:#181e24">Het serviceteam van Blitz Power</strong>
    </p>`);
}

// Mail bij "Geen reactie van de klant": het voorgestelde tijdstip is nooit bevestigd, dus de afspraak vervalt en het ticket sluit.
// Bewust GEEN belofte van een nieuw voorstel of van contact door Blitz: wie toch een afspraak wil, antwoordt op deze mail
// (Zoho heropent het ticket bij een klantantwoord).
export function bouwGeenReactieMail({ naam, datum, tijdslot, uur }) {
  const afspraak = afspraakFragment('de voorgestelde afspraak', { datum, tijdslot, uur });
  return mailKader(`    <p style="margin:0 0 16px;font-size:15px;color:#181e24">Beste ${escHtml(naam) || 'klant'},</p>
    <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.65">
      Voor ${afspraak} kregen we geen bevestiging. Daarom vervalt deze afspraak en sluiten we uw ticket.
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.65">
      We doen zelf geen nieuw voorstel. Heeft u toch nog een afspraak nodig? Antwoord dan gewoon op deze e-mail: uw ticket wordt dan heropend.
    </p>
    <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65">
      Met vriendelijke groeten,<br>
      <strong style="color:#181e24">Het serviceteam van Blitz Power</strong>
    </p>`);
}

// `datum` YYYY-MM-DD; `tijdstip` is een kant-en-klare tekst (bv. "30/09/2026 15:12").
// De notitie wordt als HTML-comment verstuurd (Zoho default), dus ingevoegde tekst is geescaped.
export function bouwAnnulatieNotitie({ datum, tijdslot, uur, door, tijdstip, redenLabel, toelichting, mailKlant, gemaild }) {
  let wanneer = 'onbekende datum';
  if (datum && /^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    const [j, m, d] = datum.split('-');
    wanneer = `${d}/${m}/${j}`;
    if (tijdslot) wanneer += ` ${tijdslot}`;
    else if (uur) wanneer += ` ${uur}`;
  }
  const wie = door ? `via Blitz Planning door ${door}` : 'via Blitz Planning';
  let s = `Afspraak van ${wanneer} geannuleerd ${wie} op ${tijdstip}. Reden: ${redenLabel}.`;
  if (toelichting) s += ` Toelichting: ${toelichting}.`;
  const lijst = Array.isArray(gemaild) ? gemaild : [];
  if (mailKlant && lijst.length) s += ` Klant verwittigd per mail: ja (${lijst.join(', ')}).`;
  else s += ' Klant verwittigd per mail: nee.';
  return escHtml(s);
}

// Interne notitie bij "Geen reactie van de klant" (zelfde invoer als bouwAnnulatieNotitie, zonder reden: die is hier altijd dezelfde).
export function bouwGeenReactieNotitie({ datum, tijdslot, uur, door, tijdstip, toelichting, mailKlant, gemaild }) {
  let wanneer = 'onbekende datum';
  if (datum && /^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    const [j, m, d] = datum.split('-');
    wanneer = `${d}/${m}/${j}`;
    if (tijdslot) wanneer += ` ${tijdslot}`;
    else if (uur) wanneer += ` ${uur}`;
  }
  const wie = door ? `via Blitz Planning door ${door}` : 'via Blitz Planning';
  let s = `Afspraak van ${wanneer} vervallen: geen reactie van de klant. Ticket gesloten (${STATUS_NA_GEEN_REACTIE}) ${wie} op ${tijdstip}.`;
  if (toelichting) s += ` Toelichting: ${toelichting}.`;
  const lijst = Array.isArray(gemaild) ? gemaild : [];
  if (mailKlant && lijst.length) s += ` Klant verwittigd per mail: ja (${lijst.join(', ')}).`;
  else s += ' Klant verwittigd per mail: nee.';
  return escHtml(s);
}
