# Voorstel + rapport versturen naar klant en installateur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Het bestaande afspraaksvoorstel automatisch naar alle gekende adressen (klant + installateur) laten versturen i.p.v. één handmatig ingevuld adres, en een nieuwe, manuele "verstuur rapport"-actie toevoegen op het Rapporten-tabblad — met de "verzonden"-status voortaan centraal (niet lokaal) opgeslagen.

**Architecture:** Twee nieuwe kleine Netlify Blobs-functies houden "verzonden"-tijdstippen bij (los van Zoho). `propose.js` wordt herwerkt zodat de server zelf, rechtstreeks uit Zoho, de ontvangers bepaalt i.p.v. een client-aangeleverd adres te valideren. Een nieuwe `send-rapport.js`-functie hergebruikt exact hetzelfde patroon (PDF genereren via puppeteer, uploaden naar Zoho, `sendReply` per ontvanger) voor het rapport. De frontend verliest het handmatige e-mailveld en de `localStorage`-gebaseerde "verzonden"-tracking.

**Tech Stack:** Vanilla JS (geen build-stap), Netlify Functions (classic + v2-stijl, Netlify Blobs), Zoho Desk API (`sendReply`, `/uploads`), puppeteer-core + `@sparticuz/chromium-min`. Geen testframework — verificatie via `node dev-server.mjs` (poort 3333) en live browserverificatie, **met een harde regel voor dit plan**: geen enkele taak mag een echte e-mail naar een echt klant-/installateuradres versturen tijdens het testen (zie Global Constraints).

## Global Constraints

- **Nooit een echte e-mail versturen tijdens het testen.** `propose.js` en `send-rapport.js` hebben geen `TEST_MODE`-concept (dat bestaat enkel in de frontend) — een aanroep van deze functies tegen een echt ticket verstuurt een échte e-mail naar een échte klant/installateur via Zoho. Elke taak die deze functies test, gebruikt daarom een lokaal Node-scriptje dat `global.fetch` vervangt door een neppe versie (die doet alsof ze Zoho is) vóór de functie aangeroepen wordt — nooit een aanroep die effectief `desk.zoho.eu` bereikt. Exacte test-scripts staan in elke betrokken taak hieronder.
- Versturen blijft altijd een expliciete knop-klik — nooit automatisch getriggerd.
- Bij versturen: naar **alle** gekende adressen (klant + installateur), niet een keuze.
- "Verzonden"-status wordt centraal opgeslagen (Netlify Blobs) — nooit in `localStorage`.
- De bestaande `recipientEmail`-whitelist-validatie in `propose.js` en de `proposalSentTickets`/`localStorage`-aanpak in `index.html` worden volledig verwijderd, niet als dode code ernaast gelaten.
- Geen wijziging aan `netlify/functions/rapport-archief.js`'s bestaande POST/GET/DELETE-logica.

---

## Task 1: Nieuw ticketveld `emailInstallateur`

**Spec:** `docs/superpowers/specs/2026-07-30-verzenden-naar-klant-en-installateur-design.md`, sectie 1.

**Files:**
- Modify: `netlify/functions/tickets.js:146`

**Interfaces:**
- Produces: `ticket.emailInstallateur: string` (nieuw veld op elk ticket-object dat `/api/tickets` teruggeeft) — gebruikt door Task 6 (frontend voorstel-modal).

- [ ] **Step 1: Lees de huidige code ter controle**

Bevestig dat `netlify/functions/tickets.js` rond regel 142-149 nog overeenkomt met:
```js
        naamEindklant:     cf.cf_naam_eindklant       || '',
        emailEindklant:    cf.cf_e_mail_eindklant     || '',
        telefoonEindklant: cf.cf_telefoon_eindklant   || '',
        serienummer:       cf.cf_serienummer          || '',
        partner:           cf.cf_partner_installateur || '',
        probleemtype:      cf.cf_probleemtype         || '',
        regio:             (cf.cf_regio && cf.cf_regio !== '-Geen-') ? cf.cf_regio : '',
        interventieDatum:  cf.cf_interventie_datm || null,
```
Als de inhoud afwijkt, zoek op `cf.cf_partner_installateur`.

- [ ] **Step 2: Voeg het nieuwe veld toe**

Vervang:
```js
        partner:           cf.cf_partner_installateur || '',
```
door:
```js
        partner:           cf.cf_partner_installateur || '',
        emailInstallateur: cf.cf_e_mail_installateur   || '',
```

- [ ] **Step 3: Verifieer**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Roep in de browserconsole `fetch('/api/tickets').then(r=>r.json()).then(console.log)` aan (dit gaat in test-modus tegen de echte Zoho-API, enkel lezen — geen schrijfactie, dus veilig). Bevestig dat minstens één ticket-object het veld `emailInstallateur` bevat (leeg of gevuld, afhankelijk van of dat ticket het Zoho-veld heeft ingevuld).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/tickets.js
git commit -m "feat: emailInstallateur-veld toevoegen aan ticketgegevens"
```

---

## Task 2: Nieuw endpoint `netlify/functions/voorstel-status.js`

**Spec:** sectie 3.

**Files:**
- Create: `netlify/functions/voorstel-status.js`

**Interfaces:**
- Produces: `GET /api/voorstel-status` → `{versie, status: {[ticketId]: {klant: ISOdatum|null, installateur: ISOdatum|null}}}`; `POST /api/voorstel-status` body `{ticketId, doelgroep: 'klant'|'installateur', tijdstip: ISOdatum, versie?}` → `{ok: true, versie}` of `409` bij conflict.

- [ ] **Step 1: Bestand aanmaken**

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

- [ ] **Step 2: Verifieer**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. In de browserconsole:
```js
fetch('/api/voorstel-status').then(r=>r.json()).then(console.log); // verwacht: {versie:0, status:{}}
fetch('/api/voorstel-status', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ticketId:'test123', doelgroep:'klant', tijdstip:new Date().toISOString()})}).then(r=>r.json()).then(console.log); // verwacht: {ok:true, versie:1}
fetch('/api/voorstel-status').then(r=>r.json()).then(console.log); // verwacht: {versie:1, status:{test123:{klant:'...'}}}
```
Test ook het conflictpad: roep de POST twee keer na elkaar aan met dezelfde (verouderde) `versie:0` — de tweede aanroep moet `409` teruggeven.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/voorstel-status.js
git commit -m "feat: nieuw /api/voorstel-status-endpoint voor centrale verzonden-status"
```

---

## Task 3: Nieuw endpoint `netlify/functions/rapport-verzonden.js`

**Spec:** sectie 4.

**Files:**
- Create: `netlify/functions/rapport-verzonden.js`

**Interfaces:**
- Consumes: leest/schrijft dezelfde Netlify Blobs-key (`rapportlijst`, store `blitz-data`) als het al-bestaande `netlify/functions/rapport-archief.js` — wijzigt dat bestand zelf niet.
- Produces: `POST /api/rapport-verzonden` body `{id, doelgroep: 'klant'|'installateur', tijdstip: ISOdatum, versie?}` → `{ok: true, versie}`, `404` als het rapport niet bestaat, `409` bij versie-conflict.

- [ ] **Step 1: Bestand aanmaken**

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

- [ ] **Step 2: Verifieer**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. In de browserconsole:
```js
// Haal een bestaand (of pas via de UI een test-rapport archiveer) rapport-id op:
fetch('/api/rapport-archief').then(r=>r.json()).then(d => { window.__testRapportId = d.rapports[0]?.id; console.log(window.__testRapportId); });
```
Als er een archief-item bestaat:
```js
fetch('/api/rapport-verzonden', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id: window.__testRapportId, doelgroep:'klant', tijdstip:new Date().toISOString()})}).then(r=>r.json()).then(console.log); // verwacht: {ok:true, versie:N}
fetch('/api/rapport-archief').then(r=>r.json()).then(d => console.log(d.rapports.find(r=>r.id===window.__testRapportId))); // verwacht: verzondenKlant is nu gezet, ALLE andere velden van dat item zijn ongewijzigd (vergelijk met de originele waarden)
```
Test ook: een `id` die niet bestaat → `404`.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/rapport-verzonden.js
git commit -m "feat: nieuw /api/rapport-verzonden-endpoint voor gerichte statusupdate"
```

---

## Task 4: `propose.js` herwerken — server bepaalt zelf de ontvangers

**Spec:** sectie 2.

**Files:**
- Modify: `netlify/functions/propose.js`

**Interfaces:**
- Consumes: niets nieuws (leest rechtstreeks van Zoho, zoals vandaag al).
- Produces: `POST /api/propose` (bestaande route) — **gewijzigde request-body** (verliest `recipientEmail`) en **gewijzigde response-body**: `{success, ticketId, interventieDatum, appointmentTime, emailSent: {klant: bool, installateur: bool}, ontvangers: string[]}` (was: `{success, ticketId, interventieDatum, appointmentTime, emailSent: bool}`). Task 6 (frontend) consumeert deze nieuwe vorm.

- [ ] **Step 1: Lees het volledige bestand ter controle**

Bevestig dat `netlify/functions/propose.js` (331 regels) nog de structuur heeft zoals hieronder beschreven — zoek op `if (recipientEmail) {` (rond regel 193) voor het whitelist-blok, en op `// 1. E-mail via sendReply EERST` (rond regel 243) voor het verzendblok.

- [ ] **Step 2: Whitelist-validatie vervangen door zelf-bepaalde ontvangers**

Zoek het blok (huidige regels ~191-214):
```js
    // Haal het ticket op en controleer dat recipientEmail bij dit ticket hoort —
    // voorkomt dat dit endpoint als open mail-relay naar een willekeurig adres misbruikt wordt.
    if (recipientEmail) {
      const ticketRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
      });
      const ticketData = await ticketRes.json().catch(() => ({}));
      if (!ticketRes.ok) {
        return {
          statusCode: 404, headers,
          body: JSON.stringify({ error: 'Ticket niet gevonden' }),
        };
      }
      const cf = ticketData.cf || {};
      const geldigeAdressen = [
        ticketData.email, ticketData.contact?.email, ticketData.contact?.emailId, cf.cf_e_mail_eindklant,
      ].filter(Boolean).map(e => e.toLowerCase());
      if (!geldigeAdressen.includes(String(recipientEmail).toLowerCase())) {
        return {
          statusCode: 400, headers,
          body: JSON.stringify({ error: 'recipientEmail komt niet overeen met een geregistreerd adres op dit ticket' }),
        };
      }
    }
```
Vervang volledig door:
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
Ook bovenaan de destructuring-regel (huidige regel ~172-173):
```js
    const { ticketId, date, time, recipientEmail, recipientName, subject, serienummer, utcInterventieDatum } =
      JSON.parse(event.body || '{}');
```
wordt:
```js
    const { ticketId, date, time, recipientName, subject, serienummer, utcInterventieDatum } =
      JSON.parse(event.body || '{}');
```
(`recipientEmail` volledig weg uit de destructuring — het bestaat nergens meer in dit bestand.)

- [ ] **Step 3: Verzendblok vervangen door een lus over `ontvangers`**

Zoek het blok (huidige regels ~243-294):
```js
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
```
Vervang volledig door:
```js
    // 1. E-mail via sendReply EERST (anders overschrijft Zoho de status terug naar "Wachten op klant").
    // 1 aparte sendReply-aanroep per ontvanger (klant en/of installateur) -- elk met zijn eigen
    // upload van de service-voorwaarden-PDF, zodat elke afzonderlijke mail zijn eigen geldige
    // bijlage-verwijzing heeft.
    const emailSent = { klant: false, installateur: false };
    for (const { doelgroep, email } of ontvangers) {
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
          to:               email,
          attachmentIds:    [attachmentId],
        }),
      });

      const replyText = await replyRes.text();
      let replyData = {};
      if (replyText) try { replyData = JSON.parse(replyText); } catch (_) {}
      if (!replyRes.ok) {
        const isEmptyRecipients = JSON.stringify(replyData).includes('Empty Recipients');
        if (!isEmptyRecipients) {
          throw new Error(`Zoho sendReply fout (${replyRes.status}) naar ${doelgroep}: ${JSON.stringify(replyData)}`);
        }
        // soft fail: emailSent[doelgroep] blijft false, ga door met een eventuele volgende ontvanger
      } else {
        emailSent[doelgroep] = true;
      }
    }
```

- [ ] **Step 4: Return-waarde uitbreiden**

Zoek (huidige regels ~319-323):
```js
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ticketId, interventieDatum, appointmentTime, emailSent }),
    };
```
wordt:
```js
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, ticketId, interventieDatum, appointmentTime, emailSent, ontvangers: ontvangers.map(o => o.doelgroep) }),
    };
```

- [ ] **Step 5: Verifieer ZONDER een echte e-mail te versturen**

**Belangrijk:** dit vraagt een lokaal test-scriptje dat Zoho namaakt — nooit rechtstreeks tegen een echt ticket testen, dat verstuurt een echte e-mail. Maak (niet committen) `scratchpad-test-propose.mjs` naast `netlify/functions/propose.js` (of in je scratchpad-map):
```js
// Tijdelijk test-scriptje -- NIET committen. Simuleert Zoho volledig via een neppe
// global.fetch, zodat propose.js getest kan worden zonder ooit desk.zoho.eu te bereiken.
process.env.ZOHO_REFRESH_TOKEN = 'fake';
process.env.ZOHO_CLIENT_ID = 'fake';
process.env.ZOHO_CLIENT_SECRET = 'fake';
process.env.ZOHO_FROM_EMAIL = 'test@blitzpower.com';

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('accounts.zoho.eu')) {
    return { ok: true, json: async () => ({ access_token: 'fake-token' }) };
  }
  if (u.includes('/organizations')) {
    return { ok: true, json: async () => ({ data: [{ id: 'org1' }] }) };
  }
  if (u.match(/\/tickets\/\d+$/) && !opts) {
    // GET ticket
    return { ok: true, json: async () => ({
      email: null, contact: null,
      cf: { cf_e_mail_eindklant: 'klant@test.be', cf_e_mail_installateur: 'installateur@test.be' },
    }) };
  }
  if (u.includes('/uploads')) {
    return { ok: true, json: async () => ({ id: 'upload123' }) };
  }
  if (u.includes('/sendReply')) {
    console.log('  -> sendReply zou gaan naar:', JSON.parse(opts.body).to);
    return { ok: true, text: async () => '{}' };
  }
  if (u.match(/\/tickets\/\d+$/) && opts?.method === 'PATCH') {
    return { ok: true, text: async () => '{}' };
  }
  throw new Error('Onverwachte fetch-aanroep in test: ' + u);
};

const { handler } = await import('./netlify/functions/propose.js');
const result = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({ ticketId: '123456', date: '2026-08-05', time: '10:00', recipientName: 'Test Klant', subject: 'Test' }),
});
console.log('Status:', result.statusCode);
console.log('Body:', result.body);
global.fetch = realFetch;
```
Run: `node scratchpad-test-propose.mjs`
Verwacht:
- 2x een regel `-> sendReply zou gaan naar: klant@test.be` en `-> sendReply zou gaan naar: installateur@test.be` (bevestigt dat de lus over beide ontvangers loopt).
- `Status: 200`
- `Body` bevat `"emailSent":{"klant":true,"installateur":true}` en `"ontvangers":["klant","installateur"]`.

Test ook het geval waarbij de neppe ticket-respons enkel `cf_e_mail_eindklant` bevat (geen `cf_e_mail_installateur`) — verwacht dan `"emailSent":{"klant":true,"installateur":false}` en `"ontvangers":["klant"]`, en dat er maar 1x een `sendReply zou gaan naar`-regel verschijnt.

Verwijder het scriptje na gebruik (`rm scratchpad-test-propose.mjs`) — het hoort niet in de commit.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/propose.js
git commit -m "feat: propose.js verstuurt naar alle gekende adressen (klant + installateur)"
```

---

## Task 5: Nieuw endpoint `netlify/functions/send-rapport.js`

**Spec:** sectie 5.

**Files:**
- Create: `netlify/functions/send-rapport.js`
- Reference (lees, wijzig niet): `netlify/functions/rapport.js` (voor de exacte `getAccessToken`/`getOrgId`-functiebodies)

**Interfaces:**
- Produces: `POST /api/send-rapport` body `{ticketId, html, ticketNumber?}` → `{success: true, emailSent: {klant: bool, installateur: bool}}`, `400` bij ontbrekende velden of geen enkel gekend adres, `404` als het ticket niet bestaat.

- [ ] **Step 1: Lees `netlify/functions/rapport.js` volledig**

Dit bestand bevat de exacte `getAccessToken`/`getOrgId`-functies en de puppeteer/chromium-PDF-generatie die je in deze taak hergebruikt (letterlijk overnemen, niet parafraseren).

- [ ] **Step 2: Bestand aanmaken**

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
```

- [ ] **Step 3: Verifieer ZONDER een echte e-mail te versturen**

Zelfde aanpak als Task 4: een lokaal, niet-gecommit test-scriptje dat `global.fetch` vervangt. De puppeteer/chromium-stap zelf mag écht draaien (dat raakt geen Zoho, enkel lokaal een PDF genereren) — enkel de Zoho-aanroepen (`accounts.zoho.eu`, `/organizations`, `/tickets/:id` GET, `/uploads`, `/sendReply`) worden nagemaakt, exact zoals in Task 4's scriptje (hergebruik dat patroon, met `import('./netlify/functions/send-rapport.js')` i.p.v. `propose.js`, en een `event.body` van `{ticketId:'123456', html:'<html><body>Test rapport</body></html>', ticketNumber:'9999'}`).

Verwacht: 2x `sendReply zou gaan naar: ...` (klant + installateur), `Status: 200`, body bevat `"emailSent":{"klant":true,"installateur":true}`. Test ook het geval "geen enkel adres gekend" (neppe ticket-respons zonder `cf_e_mail_eindklant`/`cf_e_mail_installateur`) → verwacht `400` met `"Geen gekend e-mailadres..."`.

Verwijder het scriptje na gebruik.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/send-rapport.js
git commit -m "feat: nieuw /api/send-rapport-endpoint voor rapport-verzending"
```

---

## Task 6: Frontend — voorstel-modal zonder handmatig e-mailveld

**Spec:** sectie 6.

**Files:**
- Modify: `public/index.html:1614` (modal-HTML)
- Modify: `public/index.html:4722-4745` (`openProposal`)
- Modify: `public/index.html:4747-4795` (`updateProposalPreview`)
- Modify: `public/index.html:4802-4878` (`sendProposal`)
- Modify: `public/index.html:1698` (`proposalSentTickets`-declaratie, verwijderen)
- Modify: elke plek die `proposalSentTickets` leest (route-lijst "verzonden"-badge)

**Interfaces:**
- Consumes: `ticket.emailEindklant`/`ticket.email`/`ticket.emailInstallateur` (Task 1), `GET/POST /api/voorstel-status` (Task 2), de nieuwe `/api/propose`-respons-vorm (Task 4: `emailSent: {klant, installateur}`, geen `recipientEmail` meer in de request).
- Produces: module-scope `voorstelStatus` object (`{[ticketId]: {klant: ISOdatum|null, installateur: ISOdatum|null}}`), eager geladen bij app-start, vervangt `proposalSentTickets` overal.

- [ ] **Step 1: Lees de huidige code op alle bovenstaande plekken ter controle**

Bevestig de exacte huidige inhoud (zoek op de functienamen/id's hierboven) vóór je bewerkt — dit bestand is al vaak gewijzigd vandaag, regelnummers kunnen licht verschoven zijn t.o.v. wat hier staat; gebruik de functienamen als anker, niet blindelings de regelnummers.

- [ ] **Step 2: `proposalSentTickets` vervangen door `voorstelStatus`**

Zoek:
```js
let proposalSentTickets = new Set(JSON.parse(localStorage.getItem('blitz_proposal_sent') || '[]'));
```
Vervang door:
```js
// Centraal (niet-lokaal) bijgehouden "voorstel verzonden"-status, eager geladen bij
// app-start (zie loadVoorstelStatus()) -- vervangt de vorige localStorage-aanpak volledig.
let voorstelStatus = {};
let _voorstelStatusVersie = 0;
async function loadVoorstelStatus() {
  try {
    const res  = await fetch('/api/voorstel-status');
    const data = await res.json();
    voorstelStatus       = data.status  || {};
    _voorstelStatusVersie = data.versie || 0;
  } catch (err) {
    console.warn('Voorstel-status laden mislukt:', err);
  }
}
```
Zoek de plek waar de app bij opstart data begint te laden (zoek naar een bestaande vergelijkbare eager-load-aanroep, bv. waar `loadAvailability()`/klantbeschikbaarheid geladen wordt bij initialisatie) en voeg daar `loadVoorstelStatus();` aan toe (fire-and-forget, zelfde patroon als de buren-aanroepen daar).

- [ ] **Step 3: Modal-HTML — invoerveld naar alleen-lezen weergave**

Zoek:
```html
        <input class="set-input" id="proposal-email" type="email" placeholder="klant@bedrijf.be" oninput="updateProposalPreview()" />
```
Vervang door:
```html
        <div class="set-input" id="proposal-email" style="min-height:auto"></div>
```
(Zelfde `id` behouden zodat bestaande CSS-selectors blijven werken; wordt nu met `.textContent` gevuld i.p.v. `.value`.)

- [ ] **Step 4: `openProposal()` — ontvangers berekenen i.p.v. een adres vooraf in te vullen**

Zoek:
```js
  const email = activeTicket.emailEindklant || activeTicket.email || '';
  document.getElementById('proposal-email').value = email;
```
Vervang door:
```js
  const ontvangers = [
    activeTicket.emailEindklant || activeTicket.email || null,
    activeTicket.emailInstallateur || null,
  ].filter(Boolean);
  document.getElementById('proposal-email').textContent = ontvangers.length
    ? `Wordt verstuurd naar: ${ontvangers.join(', ')}`
    : 'Geen gekend e-mailadres — ticket wordt bijgewerkt maar er wordt geen mail verstuurd.';
```

- [ ] **Step 5: `updateProposalPreview()` — geen adresveld meer uitlezen**

Lees de huidige functie-body. Zoek elke regel die `document.getElementById('proposal-email').value` leest (voor de "geen e-mail"-waarschuwing `#proposal-no-email`) en vervang die controle door te kijken of `openProposal()`'s berekende ontvangerslijst leeg is — het eenvoudigste is een module-scope variabele `_proposalOntvangers` te zetten in `openProposal()` (naast de `textContent`-toewijzing uit Step 4: `_proposalOntvangers = ontvangers;`) en die in `updateProposalPreview()` te gebruiken i.p.v. het (niet meer bestaande) input-veld:
```js
document.getElementById('proposal-no-email').style.display = _proposalOntvangers.length ? 'none' : '';
```

- [ ] **Step 6: `sendProposal()` — `recipientEmail` weglaten, nieuwe response-vorm verwerken**

Zoek:
```js
  const recipientEmail = document.getElementById('proposal-email').value.trim();
```
Verwijder deze regel volledig (niet meer nodig).

Zoek de `fetch('/api/propose', ...)`-aanroep (het `body`-object) en verwijder `recipientEmail,` uit de meegestuurde velden.

Zoek het TEST_MODE-blok:
```js
  if (TEST_MODE) {
    await new Promise(r => setTimeout(r, 600));
    proposalSentTickets.add(ticketId);
    localStorage.setItem('blitz_proposal_sent', JSON.stringify([...proposalSentTickets]));
    activeTicket.status = 'Wachten op bevestiging planning';
    allTickets = allTickets.filter(t => t.id !== ticketId);
    if (!allPending.find(t => t.id === ticketId)) allPending.push(activeTicket);
    document.getElementById('proposal-overlay').classList.remove('open');
    btn.disabled = false; btn.textContent = '✉️ Verstuur voorstel';
    renderTickets(); renderKalender(); renderRouteList(date); updateRouteBtns(date);
    toast(`🧪 Testmodus — ${recipientEmail ? 'voorstel verstuurd (demo)' : 'status bijgewerkt (geen e-mail)'}`, 3500);
    return;
  }
```
Vervang door:
```js
  if (TEST_MODE) {
    await new Promise(r => setTimeout(r, 600));
    activeTicket.status = 'Wachten op bevestiging planning';
    allTickets = allTickets.filter(t => t.id !== ticketId);
    if (!allPending.find(t => t.id === ticketId)) allPending.push(activeTicket);
    document.getElementById('proposal-overlay').classList.remove('open');
    btn.disabled = false; btn.textContent = '✉️ Verstuur voorstel';
    renderTickets(); renderKalender(); renderRouteList(date); updateRouteBtns(date);
    toast(`🧪 Testmodus — ${_proposalOntvangers.length ? 'voorstel verstuurd (demo)' : 'status bijgewerkt (geen e-mail)'}`, 3500);
    return;
  }
```
Zoek in het echte (niet-TEST_MODE) pad:
```js
    proposalSentTickets.add(ticketId);
    localStorage.setItem('blitz_proposal_sent', JSON.stringify([...proposalSentTickets]));
    activeTicket.status           = 'Wachten op bevestiging planning';
```
Vervang door:
```js
    for (const doelgroep of ['klant', 'installateur']) {
      if (!data.emailSent?.[doelgroep]) continue;
      const tijdstip = new Date().toISOString();
      fetch('/api/voorstel-status', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticketId, doelgroep, tijdstip, versie: _voorstelStatusVersie }),
      }).then(r => r.json()).then(d => {
        if (typeof d.versie === 'number') _voorstelStatusVersie = d.versie;
        if (!voorstelStatus[ticketId]) voorstelStatus[ticketId] = {};
        voorstelStatus[ticketId][doelgroep] = tijdstip;
      }).catch(err => console.warn('Voorstel-status opslaan mislukt:', err));
    }
    activeTicket.status           = 'Wachten op bevestiging planning';
```
Zoek de toast-boodschap aan het einde:
```js
    const msg = data.emailSent
      ? `✓ Voorstel verstuurd naar ${recipientEmail}`
      : recipientEmail
        ? '✓ Ticket bijgewerkt — e-mail kon niet verstuurd worden via Zoho'
        : '✓ Status bijgewerkt (geen e-mailadres)';
```
Vervang door:
```js
    const gelukt = (data.ontvangers || []).filter(d => data.emailSent?.[d]);
    const msg = gelukt.length
      ? `✓ Voorstel verstuurd naar ${gelukt.join(' en ')}`
      : (data.ontvangers || []).length
        ? '✓ Ticket bijgewerkt — e-mail kon niet verstuurd worden via Zoho'
        : '✓ Status bijgewerkt (geen e-mailadres)';
```

- [ ] **Step 7: "Verzonden"-badge in de route-lijst bijwerken**

Zoek `proposalSentTickets.has(item.ticket.id)` (in `renderRouteList()`, de `stop-proposal-sent`-div). Vervang door een check tegen `voorstelStatus`:
```js
${(voorstelStatus[item.ticket.id]?.klant || voorstelStatus[item.ticket.id]?.installateur) ? '<div class="stop-proposal-sent">✉️ Voorstel verstuurd</div>' : ''}
```

- [ ] **Step 8: Defensieve controle**

```bash
grep -n "proposalSentTickets\|blitz_proposal_sent" public/index.html
```
Verwacht: **geen output** (0 matches) — de oude aanpak is volledig weg, nergens nog een verwijzing naar over.

- [ ] **Step 9: Verifieer in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Open een ticket-detail met een geplande datum, klik "📨 Voorstel" → bevestig dat het modal een leesbare "Wordt verstuurd naar: ..."-tekst toont (of de "geen adres"-waarschuwing als het testticket geen e-mailadressen heeft) i.p.v. een invoerveld. Klik "Verstuur voorstel" (in `?test`-modus, geen echte e-mail) → bevestig dat de toast een zinvolle boodschap toont en er geen consolefouten zijn.

- [ ] **Step 10: Commit**

```bash
git add public/index.html
git commit -m "feat: voorstel verstuurt automatisch naar alle gekende adressen"
```

---

## Task 7: Frontend — verzendknoppen op het Rapporten-tabblad

**Spec:** sectie 7.

**Files:**
- Modify: `public/index.html:6349-6366` (`renderRapportArchief()`'s kaart-template)
- Add: nieuwe functie `verstuurRapport(rapportId, doelgroep)` (naast `renderRapportArchief`/`herOpenRapport`)

**Interfaces:**
- Consumes: `POST /api/send-rapport` (Task 5), `POST /api/rapport-verzonden` (Task 3), bestaande module-scope `_rapportArchief`/`_archiefVersie`.

- [ ] **Step 1: Lees de huidige `renderRapportArchief()`-kaart-template ter controle**

Bevestig dat de knoppenrij nog overeenkomt met:
```js
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">
          ${rd._html ? `<button class="cal-btn" onclick="herOpenRapport(${i})">📄 Openen</button>` : ''}
          ${rapportId ? `<button class="cal-btn btn-verwijder-rapport" style="color:var(--red);border-color:var(--red)" data-rapport-id="${escHtml(rapportId)}" data-ticket-ref="${escHtml(r.ticketNumber||r.ticketId||'?')}" data-datum="${escHtml(datumStr)}">🗑 Verwijderen</button>` : ''}
        </div>
```

- [ ] **Step 2: Verzendknoppen toevoegen**

Vervang door:
```js
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">
          ${rd._html ? `<button class="cal-btn" onclick="herOpenRapport(${i})">📄 Openen</button>` : ''}
          ${(rapportId && rd._html && r.ticketId) ? `<button class="cal-btn" onclick="verstuurRapport('${escHtml(rapportId)}', 'klant')" title="${r.verzondenKlant ? 'Al verzonden op ' + escHtml(fmtDate(r.verzondenKlant)) + ' — opnieuw versturen?' : ''}">${r.verzondenKlant ? '✅ Verzonden naar klant' : '✉️ Verstuur naar klant'}</button>` : ''}
          ${(rapportId && rd._html && r.ticketId) ? `<button class="cal-btn" onclick="verstuurRapport('${escHtml(rapportId)}', 'installateur')" title="${r.verzondenInstallateur ? 'Al verzonden op ' + escHtml(fmtDate(r.verzondenInstallateur)) + ' — opnieuw versturen?' : ''}">${r.verzondenInstallateur ? '✅ Verzonden naar installateur' : '✉️ Verstuur naar installateur'}</button>` : ''}
          ${rapportId ? `<button class="cal-btn btn-verwijder-rapport" style="color:var(--red);border-color:var(--red)" data-rapport-id="${escHtml(rapportId)}" data-ticket-ref="${escHtml(r.ticketNumber||r.ticketId||'?')}" data-datum="${escHtml(datumStr)}">🗑 Verwijderen</button>` : ''}
        </div>
```

- [ ] **Step 3: `verstuurRapport()`-functie toevoegen**

Voeg toe, direct na `renderRapportArchief()`'s sluitende `}`:
```js
async function verstuurRapport(rapportId, doelgroep) {
  const r = _rapportArchief.find(x => x.id === rapportId);
  if (!r) return toast('⚠️ Rapport niet gevonden');
  if (!r.ticketId) return toast('⚠️ Geen ticket gekoppeld aan dit rapport');
  const html = r.rapportData?._html;
  if (!html) return toast('⚠️ Geen opgeslagen rapport-inhoud om te versturen');

  const label = doelgroep === 'klant' ? 'klant' : 'installateur';
  toast(`📤 Rapport versturen naar ${label}...`, 6000);
  try {
    const res  = await fetch('/api/send-rapport', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketId: r.ticketId, html, ticketNumber: r.ticketNumber }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    if (!data.emailSent?.[doelgroep]) {
      toast(`⚠️ Rapport kon niet verstuurd worden naar ${label} (geen adres of Zoho-fout)`, 4500);
      return;
    }
    const tijdstip = new Date().toISOString();
    const statusRes = await fetch('/api/rapport-verzonden', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: rapportId, doelgroep, tijdstip, versie: _archiefVersie }),
    });
    const statusData = await statusRes.json();
    if (typeof statusData.versie === 'number') _archiefVersie = statusData.versie;
    const veld = doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
    r[veld] = tijdstip;
    renderRapportArchief();
    toast(`✓ Rapport verstuurd naar ${label}`, 3500);
  } catch (err) {
    toast('❌ ' + err.message, 5000);
  }
}
```

- [ ] **Step 4: Verifieer in de browser (fetch-stub, geen echte e-mail)**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`, ga naar het Rapporten-tabblad. Als er een gearchiveerd rapport met `ticketId` en opgeslagen `rapportData._html` bestaat, stub `window.fetch` tijdelijk in de console zodat `/api/send-rapport` en `/api/rapport-verzonden` een nepresultaat teruggeven zonder Zoho/echte e-mail te raken:
```js
const realFetch3 = window.fetch;
window.fetch = (url, opts) => {
  if (String(url).startsWith('/api/send-rapport')) return Promise.resolve({ json: async () => ({ success: true, emailSent: { klant: true, installateur: false } }) });
  if (String(url).startsWith('/api/rapport-verzonden')) return Promise.resolve({ json: async () => ({ ok: true, versie: 1 }) });
  return realFetch3(url, opts);
};
```
Klik "✉️ Verstuur naar klant" → bevestig dat de toast "✓ Rapport verstuurd naar klant" toont, de knop verandert naar "✅ Verzonden naar klant", en er geen consolefouten zijn. Herstel `window.fetch` erna.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: rapport-versturen naar klant/installateur op het Rapporten-tabblad"
```

---

## Eindcontrole (na alle taken)

- [ ] **Volledige regressietest in de browser**, via `node dev-server.mjs` met `?test`: open Kalender, Wachtrij, Route, Rapporten-tabbladen (geen consolefouten), open een ticket-detail en bevestig dat het voorstel-modal correct opent zonder een input-veld voor e-mail.
- [ ] **Bevestig nogmaals expliciet** dat geen enkele taak ooit een echte Zoho-aanroep (`sendReply`, `/uploads`, `/tickets/:id` PATCH) heeft gedaan tegen een echt ticket tijdens deze hele implementatieronde.
- [ ] **Live verificatie door de sessie-orchestrator** in een echte browser vóór er iets naar Brent teruggekoppeld wordt — conform de bestaande sessieafspraak. Gezien de gevoeligheid (echte e-mails), vraag Brent expliciet om een eerste écht end-to-end-verstuurtest zelf uit te voeren (met een ticket/adres dat hij zelf controleert) vóór dit als volledig werkend bevestigd wordt — de geautomatiseerde verificatie in dit plan test bewust nooit tegen de echte Zoho `sendReply`.
