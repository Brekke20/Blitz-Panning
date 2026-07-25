// /api/propose
// Verstuurt een afspraakvoorstel naar de klant via Zoho Desk sendReply.
// POST body:
//   { ticketId, date, time, recipientEmail, recipientName, subject, serienummer }
//   time wordt afgerond naar het volgende kwartier.
// Bij recipientEmail wordt ook de service-voorwaarden-PDF als bijlage meegestuurd.

import fs   from 'node:fs';
import path from 'node:path';
import url  from 'node:url';

// Netlify bundelt deze ESM-syntax functie naar CommonJS voor de echte
// productie-runtime — daar bestaat al een werkende __dirname (CJS-stijl),
// en import.meta.url is onbetrouwbaar ("path" argument must be of type
// string, Received undefined"). Lokaal (dev-server.mjs) draait dit
// bestand als echte ESM, waar __dirname niet bestaat maar import.meta.url
// wel werkt. `typeof __dirname` is veilig op een niet-gedeclareerde naam
// (geeft "undefined" terug, gooit geen ReferenceError) — vandaar deze
// fallback die in beide omgevingen werkt.
const functionDir = typeof __dirname !== 'undefined'
  ? __dirname
  : path.dirname(url.fileURLToPath(import.meta.url));
const TERMS_PDF_PATH = path.join(functionDir, 'assets', 'service-voorwaarden.pdf');
const TERMS_PDF_DISPLAY_NAME = 'Service Voorwaarden Blitz Power.pdf';

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

async function uploadTermsAttachment(accessToken, orgId) {
  const fileBuffer = fs.readFileSync(TERMS_PDF_PATH);
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), TERMS_PDF_DISPLAY_NAME);

  // Zoho's generieke /uploads-endpoint (Desk.basic.CREATE-scope) — NIET
  // /tickets/{id}/attachments (dat is voor ticket-bijlagen zoals rapport.js
  // gebruikt, en die attachmentIds neemt sendReply niet mee in de mail,
  // ongeacht isPublic — live getest en bevestigd via een echte testmail).
  const uploadRes = await fetch(`${ZOHO_DESK}/uploads`, {
    method:  'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
    body:    formData,
  });
  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) throw new Error(`Zoho attachment-upload fout (${uploadRes.status}): ${JSON.stringify(uploadData)}`);
  return uploadData.id;
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
      Gelieve deze afspraak te bevestigen door op deze e-mail te antwoorden. Komt het voorgestelde tijdstip u
      niet uit? Laat het ons dan ook weten, zodat we samen een alternatief zoeken. In bijlage vindt u onze
      service voorwaarden — door de afspraak te bevestigen gaat u hiermee akkoord.
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
    const { ticketId, date, time, recipientEmail, recipientName, subject, serienummer, utcInterventieDatum } =
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
    // Gebruik utcInterventieDatum van de client (browser kent de lokale
    // tijdzone en rekent DST-correct om naar UTC). Fallback moet geldige
    // ISO8601 zijn (met .000Z) voor het cf_interventie_datm custom field.
    const interventieDatum = utcInterventieDatum || `${date}T${appointmentTime}:00.000Z`;

    // Haal het from-adres op uit de Zoho e-mailconfiguratie.
    // Voorkeur: ZOHO_FROM_EMAIL env-var (zet dit in Netlify UI → Site settings → Environment variables).
    let fromEmailAddress = process.env.ZOHO_FROM_EMAIL || null;
    if (!fromEmailAddress) {
      // Fallback: haal alle adressen op en kies het eerste geverifieerde/actieve support-adres.
      const emailRes = await fetch(`${ZOHO_DESK}/emailAddresses?limit=50`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
      });
      const emailData = await emailRes.json();
      const addresses = emailData?.data || [];
      const candidate = addresses.find(a => a.emailAddress && a.emailAddress.includes('@'));
      fromEmailAddress = candidate?.emailAddress || null;
      if (!fromEmailAddress) {
        throw new Error(
          `Geen from-emailadres gevonden in Zoho (${addresses.length} adressen opgehaald). ` +
          `Stel ZOHO_FROM_EMAIL in als Netlify env-var om dit te omzeilen.`
        );
      }
    }

    // 1. E-mail via sendReply EERST (anders overschrijft Zoho de status terug naar "Wachten op klant")
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

      // Service-voorwaarden-PDF als bijlage: eerst uploaden via /uploads,
      // dan de resulterende id meegeven aan sendReply.
      const attachmentId = await uploadTermsAttachment(accessToken, orgId);

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
          attachmentIds:    [attachmentId],
        }),
      });

      const replyText = await replyRes.text();
      let replyData = {};
      if (replyText) try { replyData = JSON.parse(replyText); } catch (_) {}
      if (!replyRes.ok) {
        // "Empty Recipients" = ticket heeft geen inbound email thread (bv. Phone-ticket).
        const isEmptyRecipients = JSON.stringify(replyData).includes('Empty Recipients');
        if (isEmptyRecipients) {
          emailSent = false; // soft fail: email niet verstuurd maar verder gaan
        } else {
          throw new Error(`Zoho sendReply fout (${replyRes.status}): ${JSON.stringify(replyData)}`);
        }
      } else {
        emailSent = true;
      }
    }

    // 2. Ticket PATCH NA sendReply: status → Wachten op bevestiging planning + interventieDatum
    // Volgorde is belangrijk: Zoho zet status automatisch op "Wachten op klant" na sendReply,
    // dus de PATCH moet daarna komen om de juiste status te garanderen.
    const patchRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
      method:  'PATCH',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'Wachten op bevestiging planning',
        cf:     { cf_interventie_datm: interventieDatum },
      }),
    });

    const patchText = await patchRes.text();
    let patchData = {};
    if (patchText) try { patchData = JSON.parse(patchText); } catch (_) {}
    if (!patchRes.ok) {
      throw new Error(`Zoho PATCH fout (${patchRes.status}): ${JSON.stringify(patchData)}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ticketId, interventieDatum, appointmentTime, emailSent }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
