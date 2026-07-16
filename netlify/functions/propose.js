// /api/propose
// Verstuurt een afspraakvoorstel naar de klant via Zoho Desk sendReply.
// POST body:
//   { ticketId, date, time, recipientEmail, recipientName, subject, serienummer }
//   time wordt afgerond naar het volgende kwartier.

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';

let cachedToken = null;
let tokenExpiry  = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const params = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN,
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    grant_type:    'refresh_token',
  });
  const res  = await fetch(ZOHO_ACCOUNTS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh mislukt: ' + JSON.stringify(data));
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

function roundToNextQuarter(timeStr) {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  const raw = Math.ceil(m / 15) * 15;
  if (raw >= 60) return `${String(h + 1).padStart(2, '0')}:00`;
  return `${String(h).padStart(2, '0')}:${String(raw).padStart(2, '0')}`;
}

function buildEmailHtml({ recipientName, subject, formattedDate, appointmentTime, serienummer }) {
  // SVG: 2 diagonale afgeronde lijnen in Blitz-brandkleur #00dfa3
  const bolt = `<svg width="20" height="30" viewBox="0 0 20 30" xmlns="http://www.w3.org/2000/svg">` +
    `<line x1="15" y1="2" x2="3" y2="16" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/>` +
    `<line x1="17" y1="14" x2="5" y2="28" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/>` +
    `</svg>`;

  const serial = serienummer
    ? `<div style="font-size:12px;color:#8a9aaa;margin-top:10px;border-top:1px solid #e8e8e8;padding-top:10px">Serienummer: ${serienummer}</div>`
    : '';

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
    <p style="margin:0 0 16px;font-size:15px;color:#181e24">Geachte ${recipientName || 'klant'},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#3a3a3a;line-height:1.65">
      Wij plannen een servicebezoek voor: <strong style="color:#181e24">${subject}</strong>.
    </p>

    <!-- Afspraakbox -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px">
    <tr><td style="background:#f7f7f7;border-left:4px solid #00dfa3;border-radius:0 4px 4px 0;padding:18px 22px">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#8a9aaa;margin-bottom:8px">Voorgestelde afspraak</div>
      <div style="font-size:22px;font-weight:700;color:#181e24;margin-bottom:4px">${formattedDate}</div>
      <div style="font-size:16px;color:#3a3a3a">om <strong>${appointmentTime}</strong> uur</div>
      ${serial}
    </td></tr>
    </table>

    <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.65">
      Kan dit tijdstip u niet schikken? Beantwoord dan deze e-mail en wij zoeken samen naar een alternatief.
    </p>
    <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65">
      Met vriendelijke groeten,<br>
      <strong style="color:#181e24">Team Blitz Power &mdash; Service &amp; Support</strong>
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

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { ticketId, date, time, recipientEmail, recipientName, subject, serienummer, utcDueDate } =
      JSON.parse(event.body || '{}');

    if (!ticketId || !date) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId en date zijn verplicht' }) };
    }

    const accessToken = await getAccessToken();

    const orgRes  = await fetch(`${ZOHO_DESK}/organizations`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const orgData = await orgRes.json();
    const orgId   = orgData.data?.[0]?.id;
    if (!orgId) throw new Error('Zoho org ID niet gevonden');

    // Tijd afronden naar volgend kwartier
    const appointmentTime = roundToNextQuarter(time || '09:00');
    // Gebruik utcDueDate van de client (browser kent de lokale tijdzone).
    // Fallback: sla op zonder Z-suffix zodat Zoho het als lokale tijd leest
    // ipv als UTC (vermijdt 2u verschuiving in CEST).
    const dueDate = utcDueDate || `${date}T${appointmentTime}:00`;

    // 1. Ticket PATCH: status → Wachten op bevestiging planning + dueDate met tijd
    const patchRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
      method:  'PATCH',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status:  'Wachten op bevestiging planning',
        dueDate,
      }),
    });

    const patchText = await patchRes.text();
    let patchData = {};
    if (patchText) try { patchData = JSON.parse(patchText); } catch (_) {}
    if (!patchRes.ok) {
      throw new Error(`Zoho PATCH fout (${patchRes.status}): ${JSON.stringify(patchData)}`);
    }

    // Haal het from-adres op uit de Zoho e-mailconfiguratie
    let fromEmailAddress = process.env.ZOHO_FROM_EMAIL || null;
    if (!fromEmailAddress) {
      const emailRes = await fetch(`${ZOHO_DESK}/emailAddresses?limit=1`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
      });
      const emailData = await emailRes.json();
      fromEmailAddress = emailData?.data?.[0]?.emailAddress || null;
    }
    if (!fromEmailAddress) throw new Error('Geen from-emailadres gevonden in Zoho configuratie');

    // 2. E-mail via sendReply (alleen als er een e-mailadres is)
    let emailSent = false;
    if (recipientEmail) {
      const dateObj       = new Date(`${date}T12:00:00`);
      const formattedDate = dateObj.toLocaleDateString('nl-BE', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });

      const emailHtml = buildEmailHtml({
        recipientName: recipientName || '',
        subject:       subject || 'Servicebezoek',
        formattedDate,
        appointmentTime,
        serienummer:   serienummer || '',
      });

      const replyRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/sendReply`, {
        method:  'POST',
        headers: {
          Authorization:  `Zoho-oauthtoken ${accessToken}`,
          orgId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel:          'EMAIL',
          contentType:      'html',
          content:          emailHtml,
          fromEmailAddress,
          to:               recipientEmail,
        }),
      });

      const replyText = await replyRes.text();
      let replyData = {};
      if (replyText) try { replyData = JSON.parse(replyText); } catch (_) {}
      if (!replyRes.ok) {
        // "Empty Recipients" = ticket heeft geen inbound email thread (bv. Phone-ticket).
        // PATCH is al geslaagd; email sturen is niet mogelijk zonder bestaande email-thread.
        const isEmptyRecipients = JSON.stringify(replyData).includes('Empty Recipients');
        if (isEmptyRecipients) {
          emailSent = false; // soft fail: ticket bijgewerkt, email niet verstuurd
        } else {
          throw new Error(`Zoho sendReply fout (${replyRes.status}): ${JSON.stringify(replyData)}`);
        }
      } else {
        emailSent = true;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ticketId, dueDate, appointmentTime, emailSent }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
