// Annuleren van een afspraak: vaste redenen, validatie, klantmail (HTML) en interne notitie.
// Pure logica, geen netwerk; gebruikt door netlify/functions/annuleer.js.

export const REDENEN = [
  { code: 'ziek',       label: 'Technieker ziek of onbeschikbaar',  klantzin: 'Onze technieker is onverwacht niet beschikbaar.' },
  { code: 'onderdelen', label: 'Onderdelen niet op tijd geleverd',  klantzin: 'De nodige onderdelen zijn niet op tijd bij ons geleverd.' },
  { code: 'klant',      label: 'Klant vroeg om te verzetten',       klantzin: 'Zoals met u besproken, verplaatsen we deze afspraak.' },
  { code: 'weer',       label: 'Weersomstandigheden',               klantzin: 'De weersomstandigheden laten niet toe om de werken veilig uit te voeren.' },
  { code: 'fout',       label: 'Dubbele of foute planning',         klantzin: 'Door een fout in onze planning kan deze afspraak niet doorgaan.' },
  { code: 'andere',     label: 'Andere',                            klantzin: null },
];

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

export function bouwAnnulatieMail({ naam, datum, tijdslot, uur, reden, toelichting }) {
  const bolt = `<svg width="20" height="30" viewBox="0 0 20 30" xmlns="http://www.w3.org/2000/svg">` +
    `<line x1="15" y1="2" x2="3" y2="16" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/>` +
    `<line x1="17" y1="14" x2="5" y2="28" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/>` +
    `</svg>`;

  const r = REDENEN.find(x => x.code === reden);
  const redenzin = r ? (r.code === 'andere' ? escHtml((toelichting || '').trim()) : r.klantzin) : '';

  let afspraak = 'uw afspraak (tijdstip nog te bevestigen)';
  if (datum && /^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    const d = new Date(`${datum}T12:00:00Z`).toLocaleDateString('nl-BE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels',
    });
    afspraak = `uw afspraak van <strong style="color:#181e24">${escHtml(d)}</strong> ${tijdDeel(tijdslot, uur)}`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:32px 0">
<tr><td>
<table width="600" align="center" cellpadding="0" cellspacing="0"
  style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10)">

  <!-- Header -->
  <tr><td style="background:#181e24;padding:26px 32px">
    <table cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding-right:12px;vertical-align:middle">${bolt}</td>
      <td style="vertical-align:middle">
        <span style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:4px;color:#00dfa3">BLITZ</span>
        <span style="display:block;font-size:9px;color:#5a6472;letter-spacing:3px;margin-top:1px">POWER</span>
      </td>
    </tr>
    </table>
  </td></tr>

  <!-- Accent bar -->
  <tr><td style="background:#00dfa3;height:3px;font-size:0;line-height:0">&nbsp;</td></tr>

  <!-- Body -->
  <tr><td style="padding:32px 36px 24px">
    <p style="margin:0 0 16px;font-size:15px;color:#181e24">Beste ${escHtml(naam) || 'klant'},</p>
    <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.65">
      Helaas moeten we ${afspraak} annuleren. ${redenzin}
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.65">
      Onze excuses voor het ongemak. We nemen zo snel mogelijk contact met u op om een nieuwe datum af te spreken.
    </p>
    <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65">
      Met vriendelijke groeten,<br>
      <strong style="color:#181e24">Het serviceteam van Blitz Power</strong>
    </p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f7f7f7;border-top:1px solid #e8e8e8;padding:18px 36px">
    <p style="margin:0;font-size:11px;color:#8a9aaa;line-height:2">
      <strong style="color:#3a3a3a">Blitz Power BV</strong><br>
      Tel: <a href="tel:+3233616404" style="color:#8a9aaa;text-decoration:none">+32 3 36 16 404</a> (Service &amp; Support)<br>
      <a href="https://blitzpower.com" style="color:#00dfa3;text-decoration:none">www.blitzpower.com</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
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
