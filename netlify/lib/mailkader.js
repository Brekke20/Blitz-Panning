// Het gedeelde kader van de klantmails (Blitz-huisstijl: kop met bliksem, groene balk, voet met contactgegevens).
// `mailKader(inhoud)` krijgt enkel de HTML BINNEN de inhoudscel; zo gebruiken de annulatiemail, de geen-reactie-mail en de herinnering
// precies dezelfde omlijsting. Pure functie, geen netwerk. (De voorstelmail in propose.js heeft nog zijn eigen, door een goudkopie
// bewaakte kader; hij is hier bewust niet naartoe verhuisd.)

const BOLT = `<svg width="20" height="30" viewBox="0 0 20 30" xmlns="http://www.w3.org/2000/svg">` +
  `<line x1="15" y1="2" x2="3" y2="16" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/>` +
  `<line x1="17" y1="14" x2="5" y2="28" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/>` +
  `</svg>`;

export function mailKader(inhoud) {
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
      <td style="padding-right:12px;vertical-align:middle">${BOLT}</td>
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
${inhoud}
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
