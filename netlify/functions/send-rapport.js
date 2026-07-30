// /api/send-rapport
// Genereert een PDF van een al-gearchiveerd service rapport (uit de opgeslagen HTML) en
// verstuurt die naar klant en/of installateur (wie een e-mailadres heeft), via Zoho Desk
// sendReply -- zelfde aanpak als propose.js. Manuele, bewuste actie vanuit het
// Rapporten-tabblad, nooit automatisch.
// POST body: { ticketId, html, ticketNumber }

import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';
const CHROMIUM_URL  = 'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

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
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh mislukt: ' + JSON.stringify(data));
  cachedToken = data.access_token;
  tokenExpiry  = Date.now() + 55 * 60 * 1000;
  return cachedToken;
}

async function getOrgId(token) {
  const res  = await fetch(`${ZOHO_DESK}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const data = await res.json();
  const orgId = data.data?.[0]?.id;
  if (!orgId) throw new Error('Zoho org ID niet gevonden');
  return orgId;
}

function buildRapportEmailHtml({ ticketNumber }) {
  const bolt = `<svg width="20" height="30" viewBox="0 0 20 30" xmlns="http://www.w3.org/2000/svg"><line x1="15" y1="2" x2="3" y2="16" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/><line x1="17" y1="14" x2="5" y2="28" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/></svg>`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:32px 0"><tr><td>
  <table width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10)">
    <tr><td style="background:#181e24;padding:26px 32px">${bolt}<span style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:4px;color:#00dfa3;margin-left:12px">BLITZ</span></td></tr>
    <tr><td style="background:#00dfa3;height:3px;font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:32px 36px">
      <p style="margin:0 0 16px;font-size:15px;color:#181e24">Beste,</p>
      <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.65">In bijlage vindt u het service rapport${ticketNumber ? ` voor ticket #${ticketNumber}` : ''}.</p>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65">Met vriendelijke groeten,<br><strong style="color:#181e24">Team Blitz Power &mdash; Service &amp; Support</strong></p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let browser;
  try {
    const { ticketId, html, ticketNumber } = JSON.parse(event.body || '{}');
    if (!ticketId || !html) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId en html zijn verplicht' }) };
    if (!/^\d+$/.test(String(ticketId))) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig ticketId' }) };

    const token = await getAccessToken();
    const orgId = await getOrgId(token);

    const ticketRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId } });
    const ticketData = await ticketRes.json().catch(() => ({}));
    if (!ticketRes.ok) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Ticket niet gevonden' }) };
    const cf = ticketData.cf || {};
    const klantEmail        = ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId || cf.cf_e_mail_eindklant || '';
    const installateurEmail = cf.cf_e_mail_installateur || '';
    const ontvangers = [
      klantEmail        ? { doelgroep: 'klant',        email: klantEmail }        : null,
      installateurEmail ? { doelgroep: 'installateur', email: installateurEmail } : null,
    ].filter(Boolean);
    if (!ontvangers.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Geen gekend e-mailadres (klant of installateur) op dit ticket' }) };

    const executablePath = await chromium.executablePath(CHROMIUM_URL);
    browser = await puppeteer.launch({ args: chromium.args, defaultViewport: chromium.defaultViewport, executablePath, headless: chromium.headless });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => { const u = req.url(); if (u.startsWith('data:') || u.startsWith('about:blank')) req.continue(); else req.abort(); });
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0mm', bottom: '12mm', left: '0mm', right: '0mm' } });
    await browser.close(); browser = null;

    let fromEmailAddress = process.env.ZOHO_FROM_EMAIL || null;
    if (!fromEmailAddress) {
      const emailRes = await fetch(`${ZOHO_DESK}/emailAddresses?limit=50`, { headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId } });
      const emailData = await emailRes.json();
      fromEmailAddress = (emailData?.data || []).find(a => a.emailAddress?.includes('@'))?.emailAddress || null;
      if (!fromEmailAddress) throw new Error('Geen from-emailadres gevonden in Zoho. Stel ZOHO_FROM_EMAIL in als Netlify env-var.');
    }

    const emailSent = { klant: false, installateur: false };
    for (const { doelgroep, email } of ontvangers) {
      const formData = new FormData();
      formData.append('file', new Blob([pdfBuffer], { type: 'application/pdf' }), `service-rapport-${ticketNumber || ticketId}.pdf`);
      const uploadRes = await fetch(`${ZOHO_DESK}/uploads`, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId }, body: formData });
      const uploadData = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok) throw new Error(`Zoho attachment-upload fout (${uploadRes.status}) voor ${doelgroep}: ${JSON.stringify(uploadData)}`);

      const replyRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/sendReply`, {
        method: 'POST',
        headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: 'EMAIL', contentType: 'html', content: buildRapportEmailHtml({ ticketNumber }),
          fromEmailAddress, to: email, attachmentIds: [uploadData.id],
        }),
      });
      const replyText = await replyRes.text();
      let replyData = {};
      if (replyText) try { replyData = JSON.parse(replyText); } catch (_) {}
      if (!replyRes.ok) {
        if (!JSON.stringify(replyData).includes('Empty Recipients')) {
          throw new Error(`Zoho sendReply fout (${replyRes.status}) naar ${doelgroep}: ${JSON.stringify(replyData)}`);
        }
      } else {
        emailSent[doelgroep] = true;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, emailSent }) };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
