# Voorstel + service rapport versturen naar klant én installateur

**Datum:** 2026-07-30
**Status:** Approved, ready for implementation plan

## Aanleiding

Vandaag kan een afspraaksvoorstel enkel naar 1 handmatig ingevuld/aangepast e-mailadres verstuurd worden, en er bestaat nog geen manier om een service rapport te versturen. Brent wil beide kunnen versturen naar **alle gekende partijen** (klant én installateur, wie een adres heeft), als **bewuste, manuele actie** (nooit automatisch), met een **centraal (niet lokaal) bijgehouden "verzonden"-status**.

## Beslissingen uit het gesprek met Brent

- Versturen blijft altijd een expliciete knop-klik — nooit automatisch.
- Bij het versturen: naar **alle** partijen met een gekend e-mailadres (klant én/of installateur) — geen keuze meer nodig, geen handmatig in te typen adres.
- Het installateur-e-mailadres komt uit een **al bestaand** Zoho-veld: `cf_e_mail_installateur` (Brent bevestigde dit terwijl we het aan het uitzoeken waren).
- "Verzonden"-status wordt **overal centraal** opgeslagen (niet in `localStorage`) — dit geldt zowel voor het (al bestaande) voorstel als het (nieuwe) rapport.
- Rapport-versturen gebeurt via een knop **per rapport, op het Rapporten-tabblad** — niet vanuit de Kalender/ticket-detail.

## Scope

- `netlify/functions/tickets.js` — nieuw veld `emailInstallateur`.
- `netlify/functions/propose.js` — herwerkt: server bepaalt zelf de ontvangers (niet langer een client-aangeleverd, gevalideerd adres), verstuurt naar alle gekende adressen.
- Nieuw: `netlify/functions/voorstel-status.js` — klein, centraal "verzonden"-register voor het voorstel (Netlify Blobs, los van Zoho).
- Nieuw: `netlify/functions/send-rapport.js` — genereert een PDF van een gearchiveerd rapport en verstuurt die naar alle gekende adressen, zelfde stramien als het voorstel.
- Nieuw: `netlify/functions/rapport-verzonden.js` — zet de "verzonden"-tijdstippen op een bestaand rapport-archief-item, zonder de rest van dat item te moeten meesturen (de bestaande `rapport-archief.js`-POST vereist vandaag altijd het volledige item — dat blijft ongewijzigd, dit is een aparte, kleine, veilige aanvulling).
- `public/index.html` — voorstel-modal (adresveld → alleen-lezen weergave van ontvangers), Rapporten-tabblad (verzendknoppen + vinkjes per rapport).

## 1. Nieuw ticketveld: `emailInstallateur`

**`netlify/functions/tickets.js`**, naast het bestaande `partner`-veld (installateur-*naam*, niet e-mail):
```js
partner:           cf.cf_partner_installateur || '',
```
wordt:
```js
partner:           cf.cf_partner_installateur || '',
emailInstallateur: cf.cf_e_mail_installateur   || '',
```

## 2. `propose.js` — server bepaalt zelf de ontvangers

**Weg**: de hele `if (recipientEmail) { ...whitelist-check... }`-blok (huidige regels 191-214) — die bestaat enkel om een *client-aangeleverd* adres te valideren. Dat is niet meer nodig zodra de server zelf, rechtstreeks uit Zoho, bepaalt wie de ontvangers zijn — dat is bovendien veiliger (geen enkel extern adres kan ooit nog meegegeven worden).

**Nieuw**, meteen na het ophalen van `orgId`:
```js
// Ticket ophalen om zelf de geldige e-mailadressen te bepalen -- niet langer een
// client-aangeleverd adres vertrouwen/valideren, de server kent nu zelf de bron van
// waarheid (voorkomt bovendien elk misbruik als open mail-relay).
const ticketRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
  headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
});
const ticketData = await ticketRes.json().catch(() => ({}));
if (!ticketRes.ok) {
  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Ticket niet gevonden' }) };
}
const cf = ticketData.cf || {};
const klantEmail        = ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId || cf.cf_e_mail_eindklant || '';
const installateurEmail = cf.cf_e_mail_installateur || '';

const ontvangers = [
  klantEmail        ? { doelgroep: 'klant',        email: klantEmail }        : null,
  installateurEmail ? { doelgroep: 'installateur', email: installateurEmail } : null,
].filter(Boolean);
```

**Verzend-blok** (huidige regels 243-294, `if (recipientEmail) { ... }`) wordt een lus over `ontvangers`, elke ontvanger krijgt zijn eigen `sendReply`-aanroep (en dus ook zijn eigen upload van de service-voorwaarden-PDF — die upload is goedkoop en de eenvoudigste, veiligste manier om zeker te zijn dat elke afzonderlijke e-mail zijn eigen geldige bijlage-verwijzing heeft):
```js
const emailSent = { klant: false, installateur: false };
for (const { doelgroep, email } of ontvangers) {
  const dateObj       = new Date(`${date}T12:00:00`);
  const formattedDate = dateObj.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const emailHtml = buildEmailHtml({
    recipientName: recipientName || '', subject: subject || 'Servicebezoek',
    formattedDate, appointmentTime, serienummer: serienummer || '',
  });
  const attachmentId = await uploadTermsAttachment(accessToken, orgId);
  const replyRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/sendReply`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'EMAIL', contentType: 'html', content: emailHtml, fromEmailAddress, to: email, attachmentIds: [attachmentId] }),
  });
  const replyText = await replyRes.text();
  let replyData = {};
  if (replyText) try { replyData = JSON.parse(replyText); } catch (_) {}
  if (!replyRes.ok) {
    const isEmptyRecipients = JSON.stringify(replyData).includes('Empty Recipients');
    if (!isEmptyRecipients) throw new Error(`Zoho sendReply fout (${replyRes.status}) naar ${doelgroep}: ${JSON.stringify(replyData)}`);
    // soft-fail: emailSent[doelgroep] blijft false, verder gaan met eventuele volgende ontvanger
  } else {
    emailSent[doelgroep] = true;
  }
}
```
De PATCH-stap erna (status + `cf_interventie_datm`) blijft **ongewijzigd** en gebeurt altijd, ongeacht hoeveel/welke e-mails lukten — zelfde volgorde-reden als vandaag al gedocumenteerd (Zoho zet de status anders terug op "Wachten op klant").

**Return-waarde** (huidige `{success, ticketId, interventieDatum, appointmentTime, emailSent}`) wordt:
```js
return {
  statusCode: 200, headers,
  body: JSON.stringify({ success: true, ticketId, interventieDatum, appointmentTime, emailSent, ontvangers: ontvangers.map(o => o.doelgroep) }),
};
```

**Request body** die de frontend verstuurt verliest `recipientEmail` (niet meer nodig/gebruikt) — de rest (`ticketId, date, time, utcInterventieDatum, recipientName, subject, serienummer`) blijft ongewijzigd.

## 3. Nieuw: `netlify/functions/voorstel-status.js`

Klein, op zichzelf staand register — Netlify Blobs, store `blitz-data`, key `voorstel-status`. Vorm: `{ versie: number, status: { [ticketId]: { klant: ISOdatum|null, installateur: ISOdatum|null } } }`.

```js
// /api/voorstel-status
// Centraal (niet-lokaal) register van wanneer een afspraaksvoorstel verstuurd is per
// ticket/doelgroep. Los van Zoho -- puur voor de "verzonden"-vinkjes in de UI.
import { getStore } from '@netlify/blobs';

const EMPTY = { versie: 0, status: {} };

export default async (req, context) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  if (req.method === 'GET') {
    const data = await store.get('voorstel-status', { type: 'json' }).catch(() => null);
    return new Response(JSON.stringify(data || EMPTY), { status: 200, headers });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers }); }
    const { ticketId, doelgroep, tijdstip } = body;
    if (!ticketId || !['klant', 'installateur'].includes(doelgroep) || !tijdstip) {
      return new Response(JSON.stringify({ error: 'ticketId, doelgroep (klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
    }
    const current = (await store.get('voorstel-status', { type: 'json' }).catch(() => null)) || EMPTY;
    if (typeof body.versie === 'number' && body.versie !== current.versie) {
      return new Response(JSON.stringify({ error: 'Register ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie }), { status: 409, headers });
    }
    const nieuw = {
      versie: current.versie + 1,
      status: { ...current.status, [ticketId]: { ...current.status[ticketId], [doelgroep]: tijdstip } },
    };
    await store.setJSON('voorstel-status', nieuw);
    return new Response(JSON.stringify({ ok: true, versie: nieuw.versie }), { status: 200, headers });
  }

  return new Response('Method Not Allowed', { status: 405, headers });
};

export const config = { path: '/api/voorstel-status' };
```

**Frontend**: bij app-start eager laden (zelfde patroon als `avExceptions`/`klantBeschikbaarheid`) in een module-scope `voorstelStatus`-object. Na een geslaagde `sendProposal()` (per doelgroep die effectief lukte, `data.emailSent.klant`/`data.emailSent.installateur`), een POST doen per gelukte doelgroep. **Vervangt** de huidige `proposalSentTickets`/`localStorage.getItem('blitz_proposal_sent')`-aanpak volledig — die code verdwijnt.

## 4. Nieuw: `netlify/functions/rapport-verzonden.js`

Zet enkel de "verzonden"-tijdstippen op een **bestaand** item in de al-bestaande `rapportlijst`-blob, zonder de rest van dat item opnieuw te moeten meesturen (de bestaande `rapport-archief.js`-POST bouwt bij elke aanroep een volledig nieuw item op basis van de meegestuurde velden — ongeschikt om enkel 2 velden te wijzigen zonder per ongeluk de rest te resetten). Dit bestand **wijzigt `rapport-archief.js` niet** — puur additief, leest/schrijft dezelfde blob-key (`rapportlijst`).

```js
// /api/rapport-verzonden
// Zet verzondenKlant/verzondenInstallateur op een bestaand rapport-archief-item, zonder
// de rest van dat item (o.a. de mogelijk grote rapportData._html) opnieuw te versturen.
import { getStore } from '@netlify/blobs';

export default async (req, context) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers }); }
  const { id, doelgroep, tijdstip } = body;
  if (!id || !['klant', 'installateur'].includes(doelgroep) || !tijdstip) {
    return new Response(JSON.stringify({ error: 'id, doelgroep (klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
  }

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });
  const current = (await store.get('rapportlijst', { type: 'json' }).catch(() => null)) || { versie: 0, rapports: [] };
  if (typeof body.versie === 'number' && body.versie !== current.versie) {
    return new Response(JSON.stringify({ error: 'Rapportarchief ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie }), { status: 409, headers });
  }
  const idx = current.rapports.findIndex(r => r.id === id);
  if (idx < 0) return new Response(JSON.stringify({ error: 'Rapport niet gevonden' }), { status: 404, headers });

  const veld = doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
  const updated = [...current.rapports];
  updated[idx] = { ...updated[idx], [veld]: tijdstip };

  const nieuw = { versie: current.versie + 1, rapports: updated };
  await store.setJSON('rapportlijst', nieuw);
  return new Response(JSON.stringify({ ok: true, versie: nieuw.versie }), { status: 200, headers });
};

export const config = { path: '/api/rapport-verzonden' };
```

## 5. Nieuw: `netlify/functions/send-rapport.js`

Zelfde stramien als `propose.js`: PDF genereren (hergebruikt de puppeteer/chromium-aanpak van `rapport.js`, uit de al-opgeslagen `rapportData._html`), uploaden via Zoho's `/uploads`, versturen naar alle gekende adressen via `sendReply`.

```js
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

let cachedToken = null, tokenExpiry = 0;
async function getAccessToken() { /* identiek aan rapport.js/propose.js */ }
async function getOrgId(token)  { /* identiek aan rapport.js */ }

function buildRapportEmailHtml({ ticketNumber }) {
  // Eenvoudige, merkconsistente e-mail (zelfde header/bolt-stijl als buildEmailHtml in
  // propose.js) -- kort bericht, het rapport zelf zit als PDF-bijlage.
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

    // Ontvangers bepalen -- identiek aan propose.js.
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

    // PDF genereren -- identieke aanpak als rapport.js.
    const executablePath = await chromium.executablePath(CHROMIUM_URL);
    browser = await puppeteer.launch({ args: chromium.args, defaultViewport: chromium.defaultViewport, executablePath, headless: chromium.headless });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', req => { const u = req.url(); if (u.startsWith('data:') || u.startsWith('about:blank')) req.continue(); else req.abort(); });
    await page.setContent(html, { waitUntil: 'load' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0mm', bottom: '12mm', left: '0mm', right: '0mm' } });
    await browser.close(); browser = null;

    // Vanaf hier per ontvanger: eigen upload + eigen sendReply (zelfde reden als propose.js).
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
```
(`getAccessToken`/`getOrgId` zijn woordelijk dezelfde functies als in `rapport.js` — gewoon overnemen, dit project deelt vandaag ook al geen code tussen losse Netlify-functions.)

## 6. Frontend: voorstel-modal

**`#proposal-email`** (huidig `<input type="email">`, enige ontvangerveld) wordt een **alleen-lezen weergave** van de berekende ontvangers, opgebouwd in `openProposal()` uit `activeTicket.emailEindklant||activeTicket.email` en `activeTicket.emailInstallateur`:
```js
const ontvangers = [
  activeTicket.emailEindklant || activeTicket.email || null,
  activeTicket.emailInstallateur || null,
].filter(Boolean);
document.getElementById('proposal-email').textContent = ontvangers.length
  ? `Wordt verstuurd naar: ${ontvangers.join(', ')}`
  : 'Geen gekend e-mailadres — ticket wordt bijgewerkt maar er wordt geen mail verstuurd.';
```
(Het element verandert van `<input>` naar een `<div>`/`<span>` in de modal-HTML — geen invoer meer nodig.) `updateProposalPreview()` en `sendProposal()` verliezen elke referentie aan een handmatig ingevuld e-mailadres; `sendProposal()`'s request body naar `/api/propose` laat `recipientEmail` weg.

**Na een geslaagde send**, per doelgroep in `data.emailSent` die `true` is, een POST naar `/api/voorstel-status` (zie sectie 3) i.p.v. de huidige `localStorage`-update.

**Weergave van het vinkje** (route-lijst, huidig `proposalSentTickets.has(item.ticket.id)`) wordt een check tegen het bij app-start geladen `voorstelStatus`-object: `voorstelStatus[item.ticket.id]?.klant || voorstelStatus[item.ticket.id]?.installateur` (getoond, eventueel met welke doelgroep(en) al bevestigd zijn).

## 7. Frontend: Rapporten-tabblad

**`renderRapportArchief()`**'s knoppenrij (huidig `📄 Openen` + `🗑 Verwijderen`) krijgt 2 extra knoppen, enkel actief als het rapport een `ticketId` heeft (nodig om het bijbehorende ticket/adressen op te zoeken) én `rd._html` bestaat (nodig om een PDF te genereren):
```html
<button class="cal-btn" onclick="verstuurRapport('${escHtml(rapportId)}', 'klant')" title="${r.verzondenKlant ? 'Al verzonden op ' + escHtml(fmtDate(r.verzondenKlant)) + ' — opnieuw versturen?' : ''}">
  ${r.verzondenKlant ? '✅ Verzonden naar klant' : '✉️ Verstuur naar klant'}
</button>
<button class="cal-btn" onclick="verstuurRapport('${escHtml(rapportId)}', 'installateur')" title="${r.verzondenInstallateur ? 'Al verzonden op ' + escHtml(fmtDate(r.verzondenInstallateur)) + ' — opnieuw versturen?' : ''}">
  ${r.verzondenInstallateur ? '✅ Verzonden naar installateur' : '✉️ Verstuur naar installateur'}
</button>
```
Beide knoppen blijven altijd klikbaar (ook na verzending) — een hernieuwde klik verstuurt gewoon opnieuw (bv. als de klant de eerste mail kwijt is); de `title`-tooltip toont wanneer het voordien al verzonden werd. `verzondenKlant`/`verzondenInstallateur` staan rechtstreeks op het archief-item zelf (niet genest in `rapportData`) — zie sectie 4.

Een nieuwe `verstuurRapport(rapportId, doelgroep)`-functie: zoekt het archief-item op (`_rapportArchief.find(r => r.id === rapportId)`), roept `/api/send-rapport` aan met `{ticketId: r.ticketId, html: r.rapportData._html, ticketNumber: r.ticketNumber}`, en bevestigt bij succes (`data.emailSent[doelgroep] === true`) met een POST naar `/api/rapport-verzonden` (`{id: rapportId, versie: _archiefVersie, doelgroep, tijdstip: new Date().toISOString()}`), werkt daarna `_rapportArchief` lokaal bij (zet `verzondenKlant`/`verzondenInstallateur` op het item) en herrendert de lijst. Als `data.emailSent[doelgroep] === false` (bv. "Empty Recipients"): toast met duidelijke foutmelding, geen `/api/rapport-verzonden`-aanroep (enkel effectief verzonden mails worden als "verzonden" gemarkeerd).

**Knoppen apart per doelgroep** (i.p.v. 1 gezamenlijke knop) zodat je kan zien/kiezen of je bv. enkel naar de installateur nog een keer wil versturen zonder de klant opnieuw te mailen — consistent met hoe elk los "verzonden"-vinkje al werkt.

## Edge cases

- **Geen enkel adres gekend** (`ontvangers` leeg): `propose.js` stuurt dan gewoon geen enkele mail (identiek aan het bestaande "geen e-mailadres"-pad, enkel de PATCH gebeurt nog); `send-rapport.js` geeft een duidelijke `400`-fout terug ("Geen gekend e-mailadres") — de frontend toont dit als toast, geen van beide verzendknoppen wordt als "verzonden" gemarkeerd.
- **Eén van de twee e-mails lukt, de andere niet** (bv. Zoho "Empty Recipients" voor één specifiek adres): elke doelgroep krijgt zijn eigen, onafhankelijke `emailSent`-status en dus zijn eigen "verzonden"-registratie — een mislukte installateur-mail blokkeert de geslaagde klant-mail niet, en omgekeerd.
- **Rapport zonder `ticketId`** (bv. een handmatig aangemaakt rapport zonder Zoho-ticket): de verzendknoppen worden niet getoond — er is dan geen ticket om e-mailadressen van op te zoeken.
- **Optimistische-locking-conflict** (`409`) bij `/api/voorstel-status` of `/api/rapport-verzonden`: dezelfde foutafhandeling als de bestaande `rapport-archief.js`/`afspraken.js`-patronen — een duidelijke toast, geen stille dataverlies.

## Niet in scope

- Geen wijziging aan `rapport-archief.js`'s bestaande POST/GET/DELETE-logica — de nieuwe `rapport-verzonden.js` is bewust een aparte, kleine, additieve functie op dezelfde blob-key, om niets aan de al-werkende archiveerflow te riskeren.
- Geen hertekening van de PDF-inhoud van het voorstel of het rapport zelf (behalve de al aparte "Kostenoverzicht"-wijziging van hiervoor) — enkel wie de e-mail ontvangt en waar dat bijgehouden wordt, verandert.
- Geen wijziging aan hoe/wanneer een rapport gearchiveerd wordt — enkel het achteraf versturen ervan is nieuw.
