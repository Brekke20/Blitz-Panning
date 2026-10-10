// PDF genereren (Chromium via puppeteer-core) en uploaden naar Zoho Desk. Verhuisd uit
// netlify/functions/rapport.js (gedrag ongewijzigd). ENKEL dit bestand importeert
// @sparticuz/chromium-min en puppeteer-core, zodat de rest (register, uploader) zonder
// browser testbaar blijft.

import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';

// Chromium release URL — moet overeenkomen met @sparticuz/chromium-min versie
const CHROMIUM_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.0/chromium-v131.0.0-pack.tar';

let cachedToken = null;
let tokenExpiry  = 0;

// Bewust nog een eigen kopie (refactor etappe 6, Z3): Chromium en het Blobs-register zijn zonder naden onbereikbaar voor tests. Zie netlify/lib/zoho.js.
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

// Zet rapport-HTML om naar een PDF-Buffer. De browser wordt altijd gesloten (finally).
export async function maakPdf(html) {
  let browser;
  try {
    const executablePath = await chromium.executablePath(CHROMIUM_URL);
    browser = await puppeteer.launch({
      args:            chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless:        chromium.headless,
    });

    const page = await browser.newPage();
    // De rapport-HTML is volledig zelfvoorzienend (foto's als base64 data:-URLs) en
    // heeft dus nooit netwerktoegang nodig — alles behalve data:/about:blank blokkeren
    // sluit het SSRF-risico (interne endpoints/metadata uitlezen) volledig af.
    await page.setRequestInterception(true);
    page.on('request', req => {
      const reqUrl = req.url();
      if (reqUrl.startsWith('data:') || reqUrl.startsWith('about:blank')) {
        req.continue();
      } else {
        req.abort();
      }
    });
    // 'load' (niet 'domcontentloaded'): page.pdf() moet de base64-foto's en handtekeningen
    // gedecodeerd én gelayoutet hebben, en dat garandeert alleen het load-event. De geblokte
    // requests hierboven kunnen dit niet ophouden — een abort settelt onmiddellijk — en alle
    // resources zijn data:-URLs zonder netwerk-roundtrip, dus dit blijft even snel.
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format:             'A4',
      printBackground:    true,
      displayHeaderFooter: true,
      headerTemplate:      '<span></span>',
      footerTemplate: `
        <div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:Arial,Helvetica,sans-serif">
          Pagina <span class="pageNumber"></span> van <span class="totalPages"></span>
        </div>`,
      margin: { top: '0mm', bottom: '12mm', left: '0mm', right: '0mm' },
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Uploadt de PDF als bijlage op het Zoho-ticket. Geeft het attachment-id terug (of undefined
// als Zoho er geen meegaf); gooit Error(JSON.stringify(uploadData)) bij een niet-ok antwoord.
export async function uploadPdfNaarZoho({ pdfBuffer, ticketId, filename }) {
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
  return uploadData.id;
}
