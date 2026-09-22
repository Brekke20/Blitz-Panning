// /api/rapport
// Genereert PDF van service rapport HTML en uploadt naar Zoho Desk als bijlage.
// POST body: { html: string, ticketId: string, filename: string, verzendId: string }
//
// (T20) verzendId is het stabiele item.id van het outbox-item (public/js/rapport-wizard.js,
// crypto.randomUUID() bij aanmaak) -- dient hier als idempotentiesleutel tegen een dubbele
// PDF-bijlage op hetzelfde Zoho-ticket wanneer een eerdere upload wél server-side lukte, maar
// het antwoord de client nooit bereikte (zie docs/reviews/2026-09-22-outbox-onderzoek.md).

import chromium from '@sparticuz/chromium-min';
import puppeteer from 'puppeteer-core';
import { getStore } from '@netlify/blobs';

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';

// Zelfde store/key als rapport-archief.js -- bewust hergebruikt, geen aparte blob-key: de
// 'archive'-stap die outbox.js altijd vóór deze upload-stap uitvoert heeft op dit punt al een
// entry met dit id aangemaakt in 'rapportlijst'.
const BLOB_KEY = 'rapportlijst';

// ── Pure logica (geen I/O) -- apart van de Blobs-aanroepen zodat dit zonder Netlify Blobs-
// emulatie met een klein Node-scriptje te verifiëren is (zie Global Constraints, "lokaal 500"). ──

// (Fix-ronde 1, punt 3) verzendId is client-gestuurde input (JSON body) en komt uiteindelijk in
// een Blobs-key-lookup terecht -- valideer het formaat (UUID-achtig) vóór gebruik. Een ongeldige
// waarde wordt gewoon genegeerd (behandeld als "geen verzendId"), niet als fout: de idempotentie
// is een bonus bovenop de kernflow, geen vereiste ervoor.
export function normaliseerVerzendId(verzendId) {
  if (typeof verzendId !== 'string') return null;
  return /^[A-Za-z0-9-]{8,64}$/.test(verzendId) ? verzendId : null;
}

// Bepaalt of een verzendId al een succesvolle Zoho-upload heeft. Retourneert de bestaande
// entry (met o.a. zohoAttachmentId) bij een match, anders null -- geen match is normaal
// (nieuw item, of item zonder rapports-array-entry) en blokkeert de upload niet.
export function isAlVerzonden(verzendId, rapporten) {
  if (!verzendId) return null;
  const entry = (rapporten || []).find(r => r.id === verzendId);
  return entry?.zohoUploaded === true ? entry : null;
}

// Bepaalt HOE de rapports-array bijgewerkt moet worden na een geslaagde upload. Retourneert
// null als er niets te doen is (geen bijhorende archief-entry gevonden, of al gemarkeerd --
// dat laatste kan gebeuren bij een retry-poging op een 409/versie-conflict), anders het nieuwe
// array (onveranderd op de bijgewerkte index na).
//
// (Fix-ronde 1, punt 1a) Zet ook geannuleerd:false. Zonder deze regel kon een cancel-POST
// (outboxCancelItem, public/js/outbox.js) die vlak vóór een tóch-nog-gelukte upload werd
// verstuurd (geannuleerd:true, zohoUploaded:false) blijvend "❌ Niet verzonden (geannuleerd)"
// tonen voor een rapport dat wél op het Zoho-ticket staat -- een geslaagde upload is per
// definitie niet geannuleerd, ongeacht wat een racende cancel-call ervoor schreef. Dit dekt de
// volgorde "cancel eerst, upload-bevestiging erna" (het scenario uit de review); de omgekeerde
// volgorde wordt afgedekt door dezelfde bescherming in het dedup-blok van rapport-archief.js.
export function pasMarkeringToe(rapporten, verzendId, attachmentId) {
  if (!verzendId) return null;
  const idx = (rapporten || []).findIndex(r => r.id === verzendId);
  if (idx < 0) return null;
  if (rapporten[idx].zohoUploaded === true) return null;
  const updated = [...rapporten];
  updated[idx] = { ...updated[idx], zohoUploaded: true, zohoAttachmentId: attachmentId, geannuleerd: false };
  return updated;
}

// Best-effort: een falende check laat de upload gewoon normaal doorgaan (zoals vóór deze taak) --
// geen enkele idempotentie-check mag de kernflow (PDF genereren + uploaden) blokkeren.
async function checkAlUpgeload(verzendId) {
  if (!verzendId) return null;
  try {
    const store = getStore({ name: 'blitz-data', consistency: 'strong' });
    const data  = await store.get(BLOB_KEY, { type: 'json' });
    return isAlVerzonden(verzendId, data?.rapports);
  } catch { return null; }
}

// Best-effort met een paar retries op een 409/versie-conflict (strong consistency, zelfde
// patroon als rapport-archief.js) -- lukt dit uiteindelijk niet, dan blijft de client-side
// confirm-call (outbox.js, bestaande 'zoho-confirm'-stap) als terugvalnet bestaan.
async function markeerUpgeload(verzendId, attachmentId) {
  if (!verzendId) return;
  const store = getStore({ name: 'blitz-data', consistency: 'strong' });
  for (let poging = 0; poging < 3; poging++) {
    try {
      const data    = (await store.get(BLOB_KEY, { type: 'json' })) || { versie: 0, rapports: [] };
      const updated = pasMarkeringToe(data.rapports, verzendId, attachmentId);
      if (!updated) return; // geen match, of al gemarkeerd -- niets te doen
      await store.setJSON(BLOB_KEY, { versie: data.versie + 1, rapports: updated });
      return;
    } catch { /* conflict of tijdelijke fout -- volgende poging leest de nieuwste versie opnieuw */ }
  }
}

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
    const { html, ticketId, filename = 'service-rapport.pdf', verzendId: rawVerzendId } = JSON.parse(event.body || '{}');
    if (!html || !ticketId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'html en ticketId zijn verplicht' }) };
    }
    if (!/^\d+$/.test(String(ticketId))) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig ticketId' }) };
    }
    // (Fix-ronde 1, punt 3) Een ongeldig-gevormd verzendId wordt genegeerd i.p.v. de aanvraag te
    // weigeren -- de idempotentie is een bonus, geen vereiste voor het kernpad.
    const verzendId = normaliseerVerzendId(rawVerzendId);

    // (T20) Idempotentie: was dit verzendId al eerder succesvol geüpload (server-side gelukt,
    // maar het antwoord bereikte de client toen nooit)? Dan niet nogmaals genereren/uploaden --
    // gewoon hetzelfde resultaat teruggeven. Geen match/falende check → gewoon normaal doorgaan.
    const alGedaan = await checkAlUpgeload(verzendId);
    if (alGedaan) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, attachmentId: alGedaan.zohoAttachmentId || null, alreadyUploaded: true }),
      };
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
    const pdfBuffer = await page.pdf({
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

    // Best-effort, mag de respons niet blokkeren/vertragen -- zie markeerUpgeload hierboven.
    await markeerUpgeload(verzendId, uploadData.id);

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
