// /api/confirm-afspraak
// Publieke, token-gevalideerde bevestigingslink uit de voorstelmail (Blok 1A). Geen login/auth
// zoals de rest van deze app — geldigheid wordt bewezen door een HMAC-ondertekende token in de
// URL (ticketId + vervaldatum + signature), niet door een sessie/wachtwoord.
//
// Bewust TWEE stappen (zie het amendement bovenaan Task 1 in het plan):
//   GET  -> toont een pagina met een "Ja, ik bevestig"-knop, GEEN side-effects (veilig voor
//           e-mail-scanners die links automatisch openen/pre-fetchen, bv. Microsoft Safe Links).
//   POST -> enkel bereikbaar door een echte klik op die knop (een <form>, geen link) -- voert
//           de eigenlijke bevestiging uit: Zoho-status wijzigen + IP/tijdstip als interne notitie
//           op het ticket vastleggen.

import crypto from 'node:crypto';

const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
  };
}

// ── Zoho Desk (letterlijk gekopieerd uit propose.js — dit project deelt geen module
// tussen netlify/functions/*.js-bestanden, elke functie dupliceert dit patroon zelf) ──────────
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

async function getOrgId(accessToken) {
  // propose.js haalt de org-id inline op (geen aparte functienaam in dat bestand, zie
  // regels 185-190) -- hier als kleine lokale helper met dezelfde exacte fetch/headers,
  // zodat de aanroep in het POST-pad hieronder leesbaar blijft.
  const orgRes  = await fetch(`${ZOHO_DESK}/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const orgData = await orgRes.json();
  const orgId   = orgData.data?.[0]?.id;
  if (!orgId) throw new Error('Zoho org ID niet gevonden');
  return orgId;
}

// ── HMAC-token ────────────────────────────────────────────────────────────────────────────────
// Fix 4 (finale review): de datum zit nu in het ondertekende bericht (`${ticketId}.${date}.${exp}`)
// zodat de audit-notitie hieronder kan tonen vóór welke datum bevestigd werd, en een re-send van
// een voorstel voor een andere datum geen verwarrende/dubbelzinnige notities meer oplevert. Dit
// MOET exact dezelfde string samenstellen als propose.js's signConfirmToken(), anders faalt elke
// verificatie van een nieuw gegenereerde link.
function sign(ticketId, date, exp) {
  const secret = process.env.CONFIRM_LINK_SECRET;
  if (!secret) throw new Error('CONFIRM_LINK_SECRET niet geconfigureerd');
  return crypto.createHmac('sha256', secret).update(`${ticketId}.${date}.${exp}`).digest('hex');
}

export function signConfirmToken(ticketId, date, expiresAtEpochSeconds) {
  return sign(ticketId, date, expiresAtEpochSeconds);
}

function verify(ticketId, date, exp, sig) {
  if (!ticketId || !date || !exp || !sig) return false;
  // Defense-in-depth (Fix 4, finale review): confirm-afspraak.js vertrouwde tot nu toe blind op
  // propose.js's validatie van ticketId. Dit endpoint is publiek/ongeauthenticeerd, dus hier
  // opnieuw controleren dat ticketId een zuiver numeriek Zoho-ticket-id is (sluit ook elke
  // theoretische dubbelzinnigheid tussen veldcombinaties in de delimiter-loze signature uit).
  if (!/^\d+$/.test(ticketId)) return false;
  if (Date.now() / 1000 > Number(exp)) return false; // verlopen
  const expected = sign(ticketId, date, exp);
  // timingSafeEqual vereist gelijke lengte — ongelijke lengte betekent sowieso ongeldig
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── HTML ──────────────────────────────────────────────────────────────────────────────────────
function htmlPage({ title, message, ok, confirmForm }) {
  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;margin:0;padding:40px 16px;display:flex;justify-content:center}
  .card{max-width:420px;background:#fff;border-radius:8px;padding:32px 28px;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
  h1{font-size:18px;color:#181e24;margin:0 0 12px}
  p{font-size:14px;color:#3a3a3a;line-height:1.5;margin:0 0 18px}
  .icon{font-size:40px;margin-bottom:12px}
  .confirm-btn{display:inline-block;background:#00dfa3;color:#181e24;text-decoration:none;
    font-weight:700;font-size:14px;padding:12px 28px;border-radius:6px;border:none;cursor:pointer}
</style></head>
<body><div class="card">
  <div class="icon">${ok ? '✅' : '⚠️'}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  ${confirmForm || ''}
</div></body></html>`;
}

function confirmFormHtml(ticketId, date, exp, sig) {
  return `<form method="POST" action="/api/confirm-afspraak">
    <input type="hidden" name="ticketId" value="${ticketId}">
    <input type="hidden" name="date" value="${date}">
    <input type="hidden" name="exp" value="${exp}">
    <input type="hidden" name="sig" value="${sig}">
    <button type="submit" class="confirm-btn">✅ Ja, ik bevestig deze afspraak</button>
  </form>`;
}

async function addZohoComment(ticketId, accessToken, orgId, content) {
  // Interne notitie op het ticket (isPublic:false -- niet zichtbaar voor de klant, enkel intern).
  // Pad/body-formaat geverifieerd tegen Zoho Desk's officiële API-documentatie
  // (desk.zoho.com/DeskAPIDocument#TicketsComments#TicketsComments_Createticketcomment):
  // POST /tickets/{ticketId}/comments, headers Authorization + orgId (zelfde patroon als
  // overal elders in dit project), body { content, isPublic } (contentType optioneel,
  // default 'html' -- onze content is platte tekst zonder opmaak, dus dat is onschadelijk).
  // Bewust een eigen try/catch: de status-PATCH (het functioneel belangrijkste deel, en de
  // bron van waarheid voor "is de afspraak bevestigd") is op dit punt al gelukt. Een fout
  // HIER -- of dat nu een niet-ok response is, of de fetch zelf die throwt (netwerkblip, DNS,
  // timeout) -- mag de klant nooit een "Er ging iets mis"-pagina tonen voor iets dat in
  // werkelijkheid wel gelukt is. Deze functie mag dus nooit méér doen dan loggen.
  try {
    const res = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content, isPublic: false }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error('Zoho ticket-comment mislukt:', res.status, errBody);
    }
  } catch (e) {
    console.error('Zoho ticket-comment mislukt (exception):', e);
  }
}

function clientIp(req) {
  // Netlify Functions zetten het echte client-IP in deze header (niet 'x-forwarded-for', dat
  // kan door de klant zelf vervalst worden op sommige platformen) -- dit moet na een echte
  // deploy nogmaals bevestigd worden tegen Netlify's actuele documentatie vóór het als
  // bewijswaardig wordt beschouwd (zie taakrapport). Lokaal via `node dev-server.mjs` zal deze
  // header ontbreken/leeg zijn -- dat is verwacht, geen bug, zie Step 5 van het plan.
  return req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'onbekend';
}

export default async (req) => {
  const headers = { ...corsHeaders(req), 'Content-Type': 'text/html; charset=utf-8' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  let ticketId, date, exp, sig;
  if (req.method === 'POST') {
    // req.formData() kan throwen op een misvormde/corrupte body (verkeerde Content-Type,
    // afgebroken multipart-boundary, ...). Dit is een publiek, ongeauthenticeerd endpoint dat
    // ook door bots/scanners met willekeurige request-bodies bereikt kan worden -- niet enkel
    // door de echte knop -- dus dit moet even netjes afgehandeld worden als een ongeldige
    // signature, niet als een onafgehandelde exception die Netlify's generieke platform-
    // foutpagina toont.
    try {
      const form = await req.formData();
      ticketId = form.get('ticketId') || '';
      date = form.get('date') || '';
      exp = form.get('exp') || '';
      sig = form.get('sig') || '';
    } catch (e) {
      console.error('confirm-afspraak: ongeldige POST-body:', e);
      return new Response(htmlPage({
        title: 'Link ongeldig of verlopen',
        message: 'Deze bevestigingslink is niet (meer) geldig. Neem contact op met Blitz Power als u de afspraak alsnog wil bevestigen.',
        ok: false,
      }), { status: 400, headers });
    }
  } else {
    const url = new URL(req.url);
    ticketId = url.searchParams.get('ticketId') || '';
    date = url.searchParams.get('date') || '';
    exp = url.searchParams.get('exp') || '';
    sig = url.searchParams.get('sig') || '';
  }

  if (!verify(ticketId, date, exp, sig)) {
    return new Response(htmlPage({
      title: 'Link ongeldig of verlopen',
      message: 'Deze bevestigingslink is niet (meer) geldig. Neem contact op met Blitz Power als u de afspraak alsnog wil bevestigen.',
      ok: false,
    }), { status: 400, headers });
  }

  if (req.method === 'GET') {
    // Enkel de bevestigingspagina tonen -- GEEN side-effects, veilig voor e-mail-scanners.
    return new Response(htmlPage({
      title: 'Afspraak bevestigen',
      message: 'Klik hieronder om deze afspraak te bevestigen.',
      ok: true,
      confirmForm: confirmFormHtml(ticketId, date, exp, sig),
    }), { status: 200, headers });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers });
  }

  // Vanaf hier: enkel bereikbaar via de POST die de "Ja, ik bevestig"-knop verstuurt.
  try {
    const accessToken = await getAccessToken();
    const orgId = await getOrgId(accessToken);

    // Fix 4, deel B (finale review): status van het ticket controleren vóór de PATCH. Een
    // ondertekende link blijft 14 dagen geldig, ongeacht wat er intussen met het ticket gebeurd
    // is -- een klant kan een oude mail terugvinden en een voorstel bevestigen dat al bevestigd
    // is, of dat intussen verplaatst/geannuleerd/anders afgehandeld werd. Enkel de PATCH
    // uitvoeren als de status nog exact 'Wachten op bevestiging planning' is.
    // Als de status-check zelf faalt (netwerk/Zoho-uitval): NIET blokkeren op deze extra
    // afhankelijkheid -- terugvallen op het oude gedrag (gewoon de PATCH proberen), zodat een
    // tijdelijke Zoho-hik een verder legitieme bevestiging niet in de weg staat.
    let currentStatus = null;
    let statusCheckFailed = false;
    try {
      const statusRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
      });
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        currentStatus = statusData.status || null;
      } else {
        statusCheckFailed = true;
      }
    } catch (e) {
      console.error('Ticket-status ophalen mislukt (confirm-afspraak):', e);
      statusCheckFailed = true;
    }

    if (!statusCheckFailed && currentStatus !== 'Wachten op bevestiging planning') {
      // Verwacht, geldig scenario (dubbele klik, verouderde link, ticket al elders afgehandeld)
      // -- geen system failure, dus geen 500 en geen "Er ging iets mis"-pagina.
      return new Response(htmlPage({
        title: 'Afspraak niet meer actueel',
        message: 'Deze afspraak is al bevestigd of niet meer actueel. Neem contact op met Blitz Power als u vragen heeft.',
        ok: false,
      }), { status: 409, headers });
    }

    const patchRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'Geplande support' }),
    });
    if (!patchRes.ok) {
      const errBody = await patchRes.text().catch(() => '');
      console.error('Zoho PATCH mislukt (confirm-afspraak):', patchRes.status, errBody);
      return new Response(htmlPage({
        title: 'Er ging iets mis',
        message: 'De afspraak kon niet bevestigd worden. Neem contact op met Blitz Power.',
        ok: false,
      }), { status: 502, headers });
    }

    const ip = clientIp(req);
    const timestamp = new Date().toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' });
    await addZohoComment(ticketId, accessToken, orgId,
      `Afspraak bevestigd voor ${date} door klant via bevestigingslink op ${timestamp} (Europe/Brussels). IP-adres: ${ip}.`);
  } catch (e) {
    console.error('confirm-afspraak fout:', e);
    return new Response(htmlPage({
      title: 'Er ging iets mis',
      message: 'De afspraak kon niet bevestigd worden. Neem contact op met Blitz Power.',
      ok: false,
    }), { status: 500, headers });
  }

  return new Response(htmlPage({
    title: 'Afspraak bevestigd',
    message: 'Bedankt! Uw afspraak is bevestigd. We zien u graag op de voorgestelde datum.',
    ok: true,
  }), { status: 200, headers });
};

export const config = { path: '/api/confirm-afspraak' };
