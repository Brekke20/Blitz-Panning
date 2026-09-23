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

// Zelfde store als rapport-archief.js ('blitz-data'), maar met een APARTE key voor de
// idempotentie-/reserveringsadministratie (zie I1 in de fix-wave, 2026-09-23): `rapportlijst` is
// de gedeelde archieflijst waarin ook rapport-archief.js/rapport-verzonden.js schrijven (nieuwe
// rapporten, annuleren, verzonden-tijdstip, dedup...) -- een ongelockte read-modify-write van
// deze functie daarop zou een gelijktijdig archief-schrijf van een collega kunnen overschrijven
// (klassieke RMW-race op een gedeelde blob). Reservering + de definitieve "al geüpload"-markering
// leven daarom in een eigen key (REGISTER_KEY) binnen dezelfde store -- geen contention meer met
// rapportlijst voor die administratie. Enkel de allerlaatste, best-effort label-write
// (zohoUploaded/zohoAttachmentId/geannuleerd, puur voor de weergave in het Rapporten-tabblad)
// gebeurt nog EENMALIG op rapportlijst zelf, ná een geslaagde upload (zie markeerUpgeload
// hieronder) -- dat blijft de enige ongelockte write van deze functie op die gedeelde blob.
const BLOB_KEY      = 'rapportlijst';
const REGISTER_KEY  = 'rapport-verzend-status';
// Begrenzing van het register: voorkomt onbeperkte groei (elk verzonden rapport ooit) op een
// blob die bij elke upload gelezen/geschreven wordt. 1000 entries is ruim boven het aantal
// rapporten dat realistisch tegelijk "recent" is; oudste entries (op `bijgewerkt`) worden geruimd.
const MAX_REGISTER_ENTRIES = 1000;

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

// ── Register (rapport-verzend-status) ─────────────────────────────────────────────────────────
// Vorm: { versie, entries: { [verzendId]: { verzendId, zohoAttachmentId, done,
// uploadInFlightSince, bijgewerkt } } } -- een object-map (i.p.v. array, zoals rapportlijst) voor
// O(1)-opzoeking per verzendId; `bijgewerkt` (ms sinds epoch) laat begrensRegister() de oudste
// entries ruimen zodra de grens overschreden wordt.

function begrensRegister(entries) {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_REGISTER_ENTRIES) return entries;
  const oudsteEerst   = keys.sort((a, b) => (entries[a]?.bijgewerkt || 0) - (entries[b]?.bijgewerkt || 0));
  const teVerwijderen = oudsteEerst.slice(0, keys.length - MAX_REGISTER_ENTRIES);
  const begrensd = { ...entries };
  for (const k of teVerwijderen) delete begrensd[k];
  return begrensd;
}

// Bepaalt of een verzendId al een succesvolle Zoho-upload heeft. Retourneert de bestaande
// entry (met o.a. zohoAttachmentId) bij een match, anders null -- geen match is normaal
// (nieuw item) en blokkeert de upload niet.
export function isAlVerzonden(verzendId, entries) {
  if (!verzendId) return null;
  const entry = entries?.[verzendId];
  return entry?.done === true ? entry : null;
}

// Bepaalt HOE het register bijgewerkt moet worden na een geslaagde upload. Retourneert null als
// er niets te doen is (geen verzendId, of de entry staat al op done -- kan gebeuren bij een retry
// op een transiënte fout, zie markeerUpgeload hieronder: dat is GEEN 409/versie-conflict, want
// deze store/key kent geen conditional writes, zie M11).
export function pasRegisterMarkeringToe(entries, verzendId, attachmentId, nu = Date.now()) {
  if (!verzendId) return null;
  if (entries?.[verzendId]?.done === true) return null;
  const updated = { ...(entries || {}) };
  updated[verzendId] = { verzendId, zohoAttachmentId: attachmentId, done: true, uploadInFlightSince: null, bijgewerkt: nu };
  return begrensRegister(updated);
}

// ── Vroege in-flight-reservering (NIET atomair) ───────────────────────────────────────────────
// Oorspronkelijk uit T20/Fix-ronde 2: de review vroeg om een atomaire reservering via conditional
// writes (`onlyIfMatch` op `store.setJSON`). Die primitive bestaat niet in het geïnstalleerde
// `@netlify/blobs@8.2.0` (zie task-20-report.md, Fix-ronde 1, voor de volledige onderbouwing:
// `set`/`setJSON` accepteren enkel `{ metadata }`, geen conditioneel-schrijf-argument, geen
// `modified`-resultaat). Controller-beslissing: geen SDK-upgrade in deze release -- dit is dus
// een BEST-EFFORT mitigatie, geen harde garantie. Twee aanvragen voor hetzelfde verzendId die de
// registerblob binnen enkele tientallen milliseconden van elkaar lezen, zien allebei "nog geen
// actieve reservering" en schrijven beide een reservering (laatste schrijver wint, zonder
// foutmelding) -- maar het venster waarin dat kan gebeuren is nu de GET→SET-latentie van déze
// functie alleen (~100ms), niet meer de volledige PDF-generatie+Zoho-upload-duur (typisch enkele
// seconden tot een kleine minuut). Vervolgstap (niet in deze release): @netlify/blobs upgraden
// naar een versie met `onlyIfMatch`/conditionele writes en dit alsnog echt atomair maken.
const IN_FLIGHT_TIMEOUT_MS = 3 * 60 * 1000; // 3 minuten

// Pure functie -- bepaalt of een register-entry een nog-actieve in-flight-reservering heeft.
export function heeftActieveReservering(entry, nu = Date.now()) {
  if (!entry?.uploadInFlightSince) return false;
  const sinds = Date.parse(entry.uploadInFlightSince);
  if (Number.isNaN(sinds)) return false; // corrupte/onverwachte waarde -- geen blocker, behandel als "geen reservering"
  return (nu - sinds) < IN_FLIGHT_TIMEOUT_MS;
}

// Pure functie -- bepaalt HOE het register bijgewerkt moet worden om een in-flight-reservering
// te zetten. Retourneert null als er niets te doen is: geen verzendId, of een reeds actieve
// reservering (die de caller normaliter al via heeftActieveReservering() heeft afgevangen).
export function pasReserveringToe(entries, verzendId, nu = Date.now()) {
  if (!verzendId) return null;
  const bestaand = entries?.[verzendId];
  if (heeftActieveReservering(bestaand, nu)) return null;
  const updated = { ...(entries || {}) };
  updated[verzendId] = { ...(bestaand || {}), verzendId, uploadInFlightSince: new Date(nu).toISOString(), bijgewerkt: nu };
  return begrensRegister(updated);
}

// Pure functie -- wist een in-flight-reservering (best-effort na een mislukte poging, zodat een
// retry niet nodeloos tot 3 minuten moet wachten op zijn eigen vorige, mislukte reservering).
// Retourneert null als er niets te wissen valt (geen match, of al leeg).
export function wisReservering(entries, verzendId) {
  if (!verzendId) return null;
  const bestaand = entries?.[verzendId];
  if (!bestaand?.uploadInFlightSince) return null;
  const updated = { ...(entries || {}) };
  updated[verzendId] = { ...bestaand, uploadInFlightSince: null, bijgewerkt: Date.now() };
  return updated;
}

// ── rapportlijst: de ENE resterende best-effort write op de gedeelde archieflijst ───────────────
// Bepaalt HOE de rapports-array bijgewerkt moet worden na een geslaagde upload, puur voor
// label-consistentie in het Rapporten-tabblad (de idempotentie zelf steunt volledig op het
// register hierboven). Retourneert null als er niets te doen is: geen bijhorende archief-entry
// (defensief -- zou niet mogen gebeuren gezien de vaste volgorde archive→upload), of de entry
// staat al correct (geen nutteloze write/versie-increment).
export function pasMarkeringToe(rapporten, verzendId, attachmentId) {
  if (!verzendId) return null;
  const idx = (rapporten || []).findIndex(r => r.id === verzendId);
  if (idx < 0) return null;
  const bestaand = rapporten[idx];
  if (bestaand.zohoUploaded === true && bestaand.zohoAttachmentId === attachmentId && bestaand.geannuleerd === false) {
    return null; // al correct -- niets te doen
  }
  const updated = [...rapporten];
  updated[idx] = { ...updated[idx], zohoUploaded: true, zohoAttachmentId: attachmentId, geannuleerd: false };
  return updated;
}

async function leesRegister(store) {
  return (await store.get(REGISTER_KEY, { type: 'json' })) || { versie: 0, entries: {} };
}

// Best-effort: een falende check laat de upload gewoon normaal doorgaan (zoals vóór deze taak) --
// geen enkele idempotentie-check mag de kernflow (PDF genereren + uploaden) blokkeren.
async function checkAlUpgeload(verzendId) {
  if (!verzendId) return null;
  try {
    const store = getStore({ name: 'blitz-data', consistency: 'strong' });
    const data  = await leesRegister(store);
    return isAlVerzonden(verzendId, data.entries);
  } catch { return null; }
}

// (I1) Best-effort: probeert een in-flight-reservering te zetten in het REGISTER (niet meer op
// rapportlijst). Retourneert 'in-progress' als een ANDERE, nog-actieve poging deze al gezet heeft
// (caller moet dan een 409 teruggeven), 'gereserveerd' bij succes, of 'doorgaan' in elk ander
// geval (geen verzendId, of de check/schrijf zelf faalde) -- in dat laatste geval gaat de upload
// gewoon normaal door, precies zoals zonder reservering. Niet atomair, zie IN_FLIGHT_TIMEOUT_MS
// hierboven.
async function reserveerOfWeiger(verzendId) {
  if (!verzendId) return 'doorgaan';
  try {
    const store = getStore({ name: 'blitz-data', consistency: 'strong' });
    const data  = await leesRegister(store);
    if (heeftActieveReservering(data.entries?.[verzendId])) return 'in-progress';
    const updated = pasReserveringToe(data.entries, verzendId);
    if (!updated) return 'doorgaan'; // defensief -- pasReserveringToe faalt enkel bij ontbrekend verzendId
    await store.setJSON(REGISTER_KEY, { versie: data.versie + 1, entries: updated });
    return 'gereserveerd';
  } catch {
    return 'doorgaan'; // best-effort -- een falende reservering mag de upload niet blokkeren
  }
}

// (I1) Best-effort: wist een eerder gezette in-flight-reservering in het REGISTER ná een
// mislukte poging (Puppeteer-fout, Zoho-fout, ...), zodat een volgende retry niet nodeloos tot
// 3 minuten moet wachten op zijn eigen vorige, mislukte reservering. Faalt dit zelf, dan blijft
// de reservering gewoon staan tot ze na 3 minuten vanzelf als verlopen behandeld wordt
// (heeftActieveReservering) -- geen blijvend geblokkeerde staat.
async function wisReserveringBestEffort(verzendId) {
  if (!verzendId) return;
  try {
    const store = getStore({ name: 'blitz-data', consistency: 'strong' });
    const data  = await leesRegister(store);
    const updated = wisReservering(data.entries, verzendId);
    if (!updated) return;
    await store.setJSON(REGISTER_KEY, { versie: data.versie + 1, entries: updated });
  } catch { /* best-effort, zie hierboven */ }
}

// (C1) getStore() zit hier -- net als in elke andere functie hierboven -- BINNEN elke eigen try.
// Vóór deze fix stond de allereerste getStore()-aanroep in deze functie NIET in een try: als
// getStore() zelf gooide (deze functie is de enige v1-stijl handler(event) die @netlify/blobs
// gebruikt, en de blobs-context in de Lambda-compat-runtime is onbewezen), eindigde een
// GESLAAGDE Zoho-upload alsnog als HTTP 500 -- de client retryt, en zonder de idempotentie/
// reservering (die op dat moment ook niet correct opgeruimd was) leidt dat tot een tweede PDF op
// hetzelfde ticket: exact de bug die T20 moest oplossen. Beide stappen hieronder (register-write
// en rapportlijst-write) zitten daarom nu allebei in hun eigen buitenste try/catch, en de AANROEP
// van markeerUpgeload() in de handler zit óók nog eens in een try/catch (defense in depth) --
// zie de call site verderop in dit bestand.
//
// (M11) Deze functie kent GEEN 409/versie-conflict: er is geen conditional write op deze store/
// key (zie IN_FLIGHT_TIMEOUT_MS-commentaar hierboven), dus er kan hier ook geen 409 optreden. De
// retries hieronder dekken enkel transiënte fouten (netwerk, tijdelijke Blobs-hik) en een
// gelijktijdige schrijf van een ANDERE aanvraag (last-write-wins, stil, geen foutcode) -- vandaar
// de post-write read-back die dat laatste geval alsnog detecteert en opnieuw probeert.
async function markeerUpgeload(verzendId, attachmentId) {
  if (!verzendId) return;

  // 1) Register: definitieve idempotentie-markering (done:true). Dit is de bron van waarheid
  //    voor checkAlUpgeload()/reserveerOfWeiger() bij een volgende poging voor ditzelfde
  //    verzendId.
  try {
    const store    = getStore({ name: 'blitz-data', consistency: 'strong' });
    const data     = await leesRegister(store);
    const updated  = pasRegisterMarkeringToe(data.entries, verzendId, attachmentId);
    if (updated) await store.setJSON(REGISTER_KEY, { versie: data.versie + 1, entries: updated });
  } catch { /* best-effort -- mag de respons nooit blokkeren, zie C1 hierboven */ }

  // 2) rapportlijst: de ENE resterende best-effort write op de gedeelde archieflijst (I1) --
  //    ongelockt (geen conditional write beschikbaar), dus read-merge-write MET een post-write
  //    read-back: als de verificatie na het schrijven faalt (een collega schreef er intussen
  //    overheen -- bv. een eigen nieuw archief-item of een cancel-POST), wordt de merge tot 3x
  //    herhaald vóór we opgeven.
  try {
    const store = getStore({ name: 'blitz-data', consistency: 'strong' });
    for (let poging = 0; poging < 3; poging++) {
      try {
        const data    = (await store.get(BLOB_KEY, { type: 'json' })) || { versie: 0, rapports: [] };
        const updated = pasMarkeringToe(data.rapports, verzendId, attachmentId);
        if (!updated) return; // geen match, of de entry staat al correct -- niets te doen
        await store.setJSON(BLOB_KEY, { versie: data.versie + 1, rapports: updated });
        const verify = await store.get(BLOB_KEY, { type: 'json' }).catch(() => null);
        const verifyEntry = verify?.rapports?.find(r => r.id === verzendId);
        if (verifyEntry?.zohoUploaded === true && verifyEntry.zohoAttachmentId === attachmentId && verifyEntry.geannuleerd === false) {
          return; // bevestigd via read-back
        }
        // Niet bevestigd -- een gelijktijdige schrijver overschreef onze write; volgende poging
        // leest de nieuwste versie opnieuw en mergt opnieuw.
      } catch { /* conflict of tijdelijke fout -- volgende poging */ }
    }
  } catch { /* getStore() zelf faalde -- best-effort, zie C1 hierboven */ }
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
  // (Fix-ronde 2, punt 2) Buiten de try gedeclareerd (net als `browser`), zodat de catch
  // hieronder er ook bij kan om een eventuele in-flight-reservering na een mislukte poging op
  // te ruimen.
  let verzendId;
  let reserveringGezet = false;
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
    verzendId = normaliseerVerzendId(rawVerzendId);

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

    // (Fix-ronde 2, punt 2) Vroege in-flight-reservering -- VÓÓR Puppeteer/de Zoho-upload (het
    // dure, meerdere-seconden-durende deel), zodat een gelijktijdige tweede aanvraag voor
    // hetzelfde verzendId al vroeg met een 409 kan afgewezen worden i.p.v. zelf ook nog eens een
    // volledige PDF te genereren en te uploaden. Best-effort/niet-atomair, zie het commentaarblok
    // bij IN_FLIGHT_TIMEOUT_MS hierboven.
    const reservering = await reserveerOfWeiger(verzendId);
    if (reservering === 'in-progress') {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'Upload van dit rapport is al bezig', inProgress: true }),
      };
    }
    reserveringGezet = reservering === 'gereserveerd';

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

    // Best-effort, mag de respons niet blokkeren/vertragen. (C1) markeerUpgeload() vangt intern
    // al elke fout op (register + rapportlijst zitten allebei in hun eigen try/catch), maar deze
    // buitenste try/catch is defense-in-depth: een GESLAAGDE upload mag NOOIT alsnog als 500
    // eindigen door iets dat hierna misloopt.
    try {
      await markeerUpgeload(verzendId, uploadData.id);
    } catch { /* zie hierboven -- de respons hieronder blijft altijd 200 na een geslaagde upload */ }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, attachmentId: uploadData.id }),
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    // (Fix-ronde 2, punt 2) Alleen opruimen als DEZE aanroep de reservering zette -- staat er een
    // reservering van een ANDERE, nog lopende poging (bv. 'in-progress' hierboven al afgehandeld,
    // of 'doorgaan' omdat de check zelf faalde), dan raken we die hier niet aan.
    if (reserveringGezet) await wisReserveringBestEffort(verzendId);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
