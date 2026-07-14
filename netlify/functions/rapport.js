// /api/rapport
// Genereert PDF van service rapport HTML en uploadt naar Zoho Desk als bijlage.
// POST body: { html: string, ticketId: string, filename: string }

import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';

// Chromium release URL — moet overeenkomen met @sparticuz/chromium-min versie
const CHROMIUM_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

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

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let browser;
  try {
    const { html, ticketId, filename = 'service-rapport.pdf' } = JSON.parse(event.body || '{}');
    if (!html || !ticketId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'html en ticketId zijn verplicht' }) };
    }

    // ── 1. PDF genereren ──────────────────────────────────────────────────────
    const executablePath = await chromium.executablePath(CHROMIUM_URL);
    browser = await puppeteer.launch({
      args:            chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless:        chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format:          'A4',
      printBackground: true,
    });
    await browser.close();
    browser = null;

    // ── 2. Upload naar Zoho Desk ──────────────────────────────────────────────
    const token = await getAccessToken();
    const orgId = await getOrgId(token);

    // Node 18+ heeft native FormData en Blob
    const formData = new FormData();
    formData.append(
      'file',
      new Blob([pdfBuffer], { type: 'application/pdf' }),
      filename,
    );

    const uploadRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/attachments`, {
      method:  'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        orgId,
        // Content-Type wordt automatisch gezet door FormData (incl. boundary)
      },
      body: formData,
    });

    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok) throw new Error(JSON.stringify(uploadData));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, attachmentId: uploadData.id }),
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
