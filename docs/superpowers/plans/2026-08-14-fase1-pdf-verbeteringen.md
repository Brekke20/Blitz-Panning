# Fase 1: PDF-verbeteringen (bevestigingsknop, beschikbaarheden-tab, kalender-tijdlijn+tijdsloten, caching) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementeer de 6 PDF-checklist-punten uit Fase 1, gegroepeerd in 4 blokken: (1A)
bevestigingsknop in de voorstelmail, (1B) een aparte "Beschikbaarheden"-tab onder Instellingen,
(1C) een echte kalender-tijdlijn voor desktop + "tijdsloten" i.p.v. exacte tijdstippen, (1D)
cache-first opstart voor tickets/beschikbaarheid/afspraken. In tegenstelling tot Fase 0 is dit
GEEN pure refactor — elk blok voegt echt nieuw gedrag toe.

**Architecture:** Bouwt bovenop Fase 0's modulestructuur (`public/js/*.js`, `public/css/*.css`,
`public/index.html` als restbestand voor kalender/planning/tickets/instellingen/UI-chrome).
Kalender/planning/instellingen-code blijft in `public/index.html` (was niet onderdeel van Fase
0's 5 geëxtraheerde domeinen). Nieuwe backend-functionaliteit volgt het bestaande
`netlify/functions/*.js`-patroon (publieke, ongeauthenticeerde functies met CORS-allowlist, zie
Task 1). Geen build-stap, geen bundler, geen testframework — verificatie via `node dev-server.mjs`
+ live browsertest, zoals de rest van dit project.

**Tech Stack:** Vanille JS, browser-native (geen nieuwe dependencies nodig — Node's ingebouwde
`crypto`-module volstaat voor Task 1's HMAC-ondertekening).

**Spec:** `docs/superpowers/specs/2026-08-13-roadmap-inventaris-en-verbeteringen-design.md`
(Fase 1-secties, "Blok 1A" t/m "Blok 1D")

## Global Constraints

- **Dit is GEEN pure-verplaatsingsplan zoals Fase 0.** Elk blok voegt bewust nieuw gedrag toe.
  Waar dit plan een bestaand patroon hergebruikt (bv. `renderBlockModal()`'s formulier-logica,
  `propose.js`'s PATCH-patroon), moet de bestaande functie **ongewijzigd blijven werken** voor
  zijn huidige aanroeppad — nieuwe functionaliteit komt ernaast, niet in de plaats van.
- **`computeArrivalTimes()` (index.html) blijft intern exacte minuten berekenen — nooit
  wijzigen.** Tijdsloten (Task 9) zijn uitsluitend een weergave-laag erbovenop. Als een taak
  verleid wordt om `computeArrivalTimes()` zelf aan te passen om sloten te retourneren: stop en
  meld dit — de route-optimalisatie en de Zoho `interventieDatum`/`appointmentTime`-opslag blijven
  op de exacte tijd gebaseerd, enkel de WEERGAVE aan klant/technieker verandert.
- **Geen enkele wijziging aan `public/js/*.js` (Fase 0's geëxtraheerde modules) in dit hele
  plan.** Alle taken hieronder raken uitsluitend `public/index.html`, `public/css/app.css`, en
  `netlify/functions/*.js`. Als een taak toch een van de 5 modules lijkt te moeten aanraken: stop
  en meld dit — dat wijst op een verkeerde aanname over waar iets leeft.
- **Elke taak eindigt met een volledige live-regressietest** van zowel de nieuwe functionaliteit
  als de bestaande flow die hij hergebruikt (bv. Task 4 test ook dat het bestaande
  per-dag-blokkeer-modal nog werkt, niet enkel de nieuwe tab) — dit project heeft geen
  automatische testsuite.
- **Windowbridge-conventie geldt NIET voor dit plan** — alle nieuwe JS in `public/index.html`
  blijft in het hoofdscript (`<script defer>`, een klassiek niet-module-script), dus elke nieuwe
  top-level `function` wordt automatisch een impliciete `window`-global, precies zoals alle
  bestaande kalender/instellingen-code vandaag al werkt. Er is geen nieuw bestand nodig, dus geen
  bridging nodig. **Uitzondering:** als een taak toch een nieuw `public/js/`-bestand aanmaakt
  (geen enkele taak hieronder doet dit, maar mocht dit tijdens uitvoering nodig blijken): dan
  geldt Fase 0's windowbridge-conventie alsnog — grep zowel `public/index.html` als `public/js/`
  (niet enkel het eerste — dat was precies de fout die Fase 0's finale review vond).
- **Nieuwe environment-variabele nodig voor Task 1** (`CONFIRM_LINK_SECRET`) — kan pas écht getest
  worden op een omgeving waar die variabele gezet is. Lokaal (`node dev-server.mjs`) volstaat een
  ontwikkel-placeholder in `.env.local`; **zet de echte variabele nooit zelf op Netlify** — dat
  blijft, net als elke push/deploy, iets waar Brent expliciet voor moet tekenen.

---

## Blok 1A — Bevestigingsknop in de voorstelmail

### Task 1: HMAC-ondertekende bevestigingslink + nieuwe `confirm-afspraak.js`-functie (met expliciete tweede bevestigingsstap + IP/tijdstip-logging)

**Amendement (2026-08-14, na overleg met Brent — juridische/technische afweging vóór de bouw):**
een link die BIJ HET OPENEN meteen bevestigt (een kale `GET` met side-effects) is riskant: veel
zakelijke mailservers/beveiligingsfilters (bv. Microsoft Defender for Office 365 "Safe Links")
**openen automatisch elke link in een binnenkomende e-mail om hem te scannen op phishing/malware**
— vóór de klant de mail zelf ooit geopend heeft. Met een directe GET-bevestiging zou zo'n
automatische scan de afspraak per ongeluk kunnen bevestigen zonder dat de klant ooit zelf geklikt
heeft — zowel een technisch lek als het zwakste mogelijke bewijspunt in een eventueel geschil
("ik heb nooit bevestigd, dat deed mijn mailserver"). **Daarom, gewijzigd t.o.v. de oorspronkelijke
opzet: de `GET` toont enkel een pagina met een echte "Ja, ik bevestig deze afspraak"-knop (een
HTML-`<form method="POST">`, geen JavaScript-afhankelijkheid, geen side-effects) — pas de
`POST` die de klant zelf via die knop verstuurt, voert de eigenlijke bevestiging uit** (Zoho-status
wijzigen + IP-adres/tijdstip vastleggen als interne notitie op het ticket, zie Step 4).
**Brent heeft dit expliciet gevraagd na een uitleg over de juridische/technische risico's van een
directe GET-bevestiging — dit is geen eigen aanname, maar een bevestigde ontwerpkeuze.**
Brent bespreekt de juridische geldigheid van deze bevestigingsmethode zelf nog met een
jurist/boekhouder — dit plan bouwt de technisch meest verdedigbare variant (expliciete
menselijke actie, IP+tijdstip vastgelegd), maar de uiteindelijke juridische beoordeling is aan hem.

**Files:**
- Create: `netlify/functions/confirm-afspraak.js`
- Modify: `.env.local.example` (nieuwe env-var toevoegen)
- Modify: `netlify.toml` (nieuwe `[functions.confirm-afspraak]`-sectie, optioneel timeout)

**Interfaces:**
- Produces: `signConfirmToken(ticketId, expiresAtEpochSeconds)` / `verifyConfirmToken(ticketId, expiresAtEpochSeconds, signature)` — gebruikt door Task 2 (die de link opbouwt bij het versturen van een voorstel).
- Consumes: niets van eerdere taken.

- [ ] **Step 1: Lees de bestaande PATCH-, comment-, en CORS-patronen ter controle**

Bevestig met een `Read` van `netlify/functions/propose.js` (regels 316-327) het exacte
PATCH-patroon (`Authorization: Zoho-oauthtoken <token>`, `orgId`-header, body
`{ status, cf: {...} }`). Bevestig met een `Read` van `netlify/functions/fotos.js` het exacte
publieke-functie-patroon: `export default async (req) => {...}`, een `ALLOWED_ORIGINS`-array +
`corsHeaders(req)`-helper, en `export const config = { path: '/api/...' };` onderaan het bestand
(in tegenstelling tot `propose.js`, dat de oudere CommonJS `exports.handler`-stijl gebruikt en op
de `netlify.toml` `/api/*`-redirect leunt — de nieuwe functie volgt het `fotos.js`-patroon, niet
het `propose.js`-patroon). **Bevestig ook met Zoho Desk's officiële REST API-documentatie
(desk.zoho.com/DeskAPIDocument — een ticket-comment toevoegen is een publiek, stabiel
Zoho-endpoint) het exacte pad en body-formaat voor `POST /tickets/{ticketId}/comments`** —
dit project gebruikt dat endpoint nergens vandaag (enkel `resolution`-veld-PATCHes in
`comment.js`, dat is iets anders), dus dit is nieuw en moet tegen Zoho's eigen documentatie
geverifieerd worden, niet enkel tegen deze planningstekst.

- [ ] **Step 2: `netlify/functions/confirm-afspraak.js` aanmaken**

```js
// netlify/functions/confirm-afspraak.js
// Publieke, token-gevalideerde bevestigingslink uit de voorstelmail (Blok 1A). Geen login/auth
// zoals de rest van deze app — geldigheid wordt bewezen door een HMAC-ondertekende token in de
// URL (ticketId + vervaldatum + signature), niet door een sessie/wachtwoord.
//
// Bewust TWEE stappen (zie het amendement bovenaan Task 1 in het plan):
//   GET  -> toont een pagina met een "Ja, ik bevestig"-knop, GEEN side-effects (veilig voor
//           e-mail-scanners die links automatisch openen/pre-fetchen).
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

function sign(ticketId, exp) {
  const secret = process.env.CONFIRM_LINK_SECRET;
  if (!secret) throw new Error('CONFIRM_LINK_SECRET niet geconfigureerd');
  return crypto.createHmac('sha256', secret).update(`${ticketId}.${exp}`).digest('hex');
}

export function signConfirmToken(ticketId, expiresAtEpochSeconds) {
  return sign(ticketId, expiresAtEpochSeconds);
}

function verify(ticketId, exp, sig) {
  if (!ticketId || !exp || !sig) return false;
  if (Date.now() / 1000 > Number(exp)) return false; // verlopen
  const expected = sign(ticketId, exp);
  // timingSafeEqual vereist gelijke lengte — ongelijke lengte betekent sowieso ongeldig
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

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

function confirmFormHtml(ticketId, exp, sig) {
  return `<form method="POST" action="/api/confirm-afspraak">
    <input type="hidden" name="ticketId" value="${ticketId}">
    <input type="hidden" name="exp" value="${exp}">
    <input type="hidden" name="sig" value="${sig}">
    <button type="submit" class="confirm-btn">✅ Ja, ik bevestig deze afspraak</button>
  </form>`;
}

async function addZohoComment(ticketId, accessToken, orgId, content) {
  // Interne notitie op het ticket (isPublic:false -- niet zichtbaar voor de klant, enkel intern).
  // Bevestig het exacte pad/body-formaat tegen Zoho Desk's officiële API-documentatie (zie
  // Step 1) vóór je dit als correct aanneemt.
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
    // Bewust NIET de hele bevestiging laten falen als enkel de comment mislukt -- de
    // status-PATCH (het functioneel belangrijkste deel) gebeurt apart en eerst. Wel loggen
    // zodat dit zichtbaar is in de Netlify function-logs.
  }
}

function clientIp(req) {
  // Netlify Functions zetten het echte client-IP in deze header (niet 'x-forwarded-for', dat
  // kan door de klant zelf vervalst worden op sommige platformen) -- BEVESTIG dit exact tegen
  // Netlify's actuele documentatie vóór je dit vertrouwt voor een bewijsdoeleinde, en test het
  // live op een echte deploy (lokaal via `node dev-server.mjs` zal deze header ontbreken/leeg
  // zijn -- dat is verwacht, geen bug, zie Step 5).
  return req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for') || 'onbekend';
}

export default async (req) => {
  const headers = { ...corsHeaders(req), 'Content-Type': 'text/html; charset=utf-8' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  let ticketId, exp, sig;
  if (req.method === 'POST') {
    const form = await req.formData();
    ticketId = form.get('ticketId') || '';
    exp = form.get('exp') || '';
    sig = form.get('sig') || '';
  } else {
    const url = new URL(req.url);
    ticketId = url.searchParams.get('ticketId') || '';
    exp = url.searchParams.get('exp') || '';
    sig = url.searchParams.get('sig') || '';
  }

  if (!verify(ticketId, exp, sig)) {
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
      confirmForm: confirmFormHtml(ticketId, exp, sig),
    }), { status: 200, headers });
  }

  // Vanaf hier: enkel bereikbaar via de POST die de "Ja, ik bevestig"-knop verstuurt.
  try {
    const accessToken = await getAccessToken();
    const orgId = await getOrgId(accessToken);
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
      `Afspraak bevestigd door klant via bevestigingslink op ${timestamp} (Europe/Brussels). IP-adres: ${ip}.`);
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
```

**Let op — `ZOHO_DESK`/`getAccessToken`/`getOrgId` bestaan nog niet in dit nieuwe bestand.**
`propose.js` definieert deze zelf bovenaan het bestand (module-level `cachedToken`/`tokenExpiry`,
`getAccessToken()` op regels 33-51, een aparte org-id-fetch rond regel 185-190, en de
`ZOHO_DESK`-constante). Dit project heeft geen gedeelde/`_lib`-module tussen functies (elke
`netlify/functions/*.js` dupliceert dit patroon zelf — bv. ook `plan.js`/`rapport.js` doen dit
onafhankelijk van elkaar). **Kopieer dus `ZOHO_DESK`, `getAccessToken()`, en de org-id-ophaling
letterlijk over uit `propose.js` naar `confirm-afspraak.js`** (zelfde patroon als de rest van dit
project — geen nieuwe gedeelde module introduceren, dat zou een precedent doorbreken zonder dat
dit gevraagd is). Vervang de placeholder-aanroepen `getAccessToken()`/`getOrgId(accessToken)`
hierboven door de letterlijk gekopieerde functies (pas de naam van de org-id-functie aan naar wat
die in `propose.js` echt heet, bevestig dit eerst met `grep -n "orgId" netlify/functions/propose.js`).

- [ ] **Step 3: Env-var toevoegen**

`.env.local.example` (root) uitbreiden met een nieuwe regel, zelfde stijl als de bestaande
`PLANNING_EXPORT_API_KEY` (een zelf-gegenereerde sleutel, geen Zoho/TomTom-credential):

```
CONFIRM_LINK_SECRET=jouw-eigen-gegenereerde-sleutel-hier
```

Zet in je eigen `.env.local` (niet gecommit) een willekeurige testwaarde voor lokale ontwikkeling,
bv. via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. **Zet de
echte productiewaarde niet zelf in de Netlify UI** — dat is, net als pushen/deployen, iets waar
Brent voor moet tekenen; meld dit gewoon als een openstaand actiepunt in je taakrapport.

- [ ] **Step 4: `netlify.toml` uitbreiden**

Voeg, naar analogie van de bestaande `[functions.propose]`/`[functions.rapport]`-blokken, toe:

```toml
[functions.confirm-afspraak]
  timeout = 15
```

- [ ] **Step 5: Verifieer live**

Start `node dev-server.mjs`. Zet in je lokale `.env.local` een test-`CONFIRM_LINK_SECRET`. Test
via een klein Node-scriptje (of `node -e`) dat `signConfirmToken('t1', Math.floor(Date.now()/1000)+3600)`
een hex-string teruggeeft. Test de GET: `http://localhost:3333/api/confirm-afspraak?ticketId=t1&exp=<toekomstig>&sig=<juiste-signature>`
moet een 200 met de "Ja, ik bevestig"-knop-pagina teruggeven, **zonder dat er een Zoho-PATCH
gebeurt** (bevestig dit expliciet — bv. door tijdelijk een `console.log`/breakpoint te zetten in
het POST-pad en te controleren dat die NIET geraakt wordt bij een GET). Test daarna de POST (via
de knop zelf in de browser, of een curl/fetch met dezelfde form-velden): bevestig dat de
Zoho-PATCH nu wél gebeurt (zal lokaal falen zonder geldige Zoho-credentials in `.env.local` —
bevestig in dat geval een 500/502 met de "Er ging iets mis"-pagina, geen crash/onafgehandelde
exception). Test apart, met een verkeerde `sig` of een `exp` in het verleden, dat je de 400
"Link ongeldig of verlopen"-pagina krijgt (zowel op GET als POST). **`clientIp(req)` zal lokaal
`'onbekend'` teruggeven** (de `x-nf-client-connection-ip`-header bestaat enkel op een echte
Netlify-deploy) — dit is verwacht voor de lokale test; de echte IP-vastlegging kan pas na een
echte deploy grondig geverifieerd worden (meld dit als een openstaand na-deploy-controlepunt in
je taakrapport). Dit is voldoende dekking voor dit geïsoleerde taakonderdeel; de volledige
end-to-end-flow (inclusief een echte Zoho-PATCH + comment) wordt in Task 3 getest.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/confirm-afspraak.js .env.local.example netlify.toml
git commit -m "feat: bevestigingslink-endpoint (HMAC-token, tweestaps GET+POST, IP/tijdstip-logging) voor voorstelmail"
```

---

### Task 2: Bevestigingsknop toevoegen aan `buildEmailHtml()` + link genereren bij versturen

**Files:**
- Modify: `netlify/functions/propose.js`

**Interfaces:**
- Consumes: `signConfirmToken` (Task 1) — let op: dit is een `export`ed function in
  `confirm-afspraak.js`, maar Netlify Functions worden elk apart/geïsoleerd gebundeld — een
  `import` tussen twee function-bestanden werkt op Netlify niet gegarandeerd zoals lokale
  Node-code (elke function draait in zijn eigen bundle/lambda). **Dupliceer daarom `sign()`/
  `signConfirmToken()` (de kleine HMAC-functie, niet de hele request-handler) letterlijk in
  `propose.js`**, zelfde functie-inhoud als Task 1's `sign()`, i.p.v. te importeren — consistent
  met hoe dit project al kleine helpers dupliceert tussen function-bestanden in plaats van een
  gedeelde module te introduceren (zie Task 1's `ZOHO_DESK`/`getAccessToken`-duplicatie-precedent).

- [ ] **Step 1: Lees de huidige `buildEmailHtml()` en het verzendpad ter controle**

Bevestig met `Read` van `netlify/functions/propose.js` regels 87-163 (`buildEmailHtml()`) en
259-311 (de `sendReply`-lus die de functie per ontvanger aanroept) dat de structuur nog exact
overeenkomt met wat hieronder aangenomen wordt. Let vooral op regel 154-155 (het bestaande
`<a href="...">`-linkpatroon in de footer — dat is de stijl die de nieuwe knop moet volgen) en
regel 134 (de regel die de exacte tijd toont — blijft in dit blok ongewijzigd; Task 9 verandert
dat pas naar een tijdslot).

- [ ] **Step 2: HMAC-helper toevoegen aan `propose.js`**

Voeg bovenaan `propose.js` (na de bestaande `require`/`import`-regels) toe:

```js
const crypto = require('crypto'); // of `import crypto from 'node:crypto'` — volg de bestaande
                                    // module-stijl van dit specifieke bestand (CommonJS vs ESM),
                                    // bevestig met de eerste regels van propose.js welke van de
                                    // twee dit bestand al gebruikt vóór je dit toevoegt.

function signConfirmToken(ticketId, expiresAtEpochSeconds) {
  const secret = process.env.CONFIRM_LINK_SECRET;
  if (!secret) throw new Error('CONFIRM_LINK_SECRET niet geconfigureerd');
  return crypto.createHmac('sha256', secret).update(`${ticketId}.${expiresAtEpochSeconds}`).digest('hex');
}
```

- [ ] **Step 3: Bevestigingslink opbouwen en doorgeven aan `buildEmailHtml()`**

In de handler, vóór de `sendReply`-lus (rond regel 259), bouw de link:

```js
const CONFIRM_LINK_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 dagen geldig
const confirmExp = Math.floor(Date.now() / 1000) + CONFIRM_LINK_TTL_SECONDS;
const confirmSig = signConfirmToken(ticketId, confirmExp);
const confirmUrl = `${process.env.URL || 'https://blitz-planning.netlify.app'}/api/confirm-afspraak`
  + `?ticketId=${encodeURIComponent(ticketId)}&exp=${confirmExp}&sig=${confirmSig}`;
```

**Let op `process.env.URL`:** Netlify zet deze env-var automatisch op elke deploy (de site's eigen
basis-URL) — geen nieuwe configuratie nodig, enkel bevestigen dat dit klopt via Netlify's eigen
documentatie-conventie (dit project gebruikt dit vandaag nergens expliciet, maar het is een
standaard Netlify-runtime-variabele, geen aanname die je zelf hoeft te verifiëren met een lokale
grep). Lokaal (`node dev-server.mjs`) zal `process.env.URL` niet gezet zijn — de fallback
`'https://blitz-planning.netlify.app'` is dan verkeerd voor een lokale testlink (die zou naar
productie wijzen i.p.v. `localhost:3333`); voor Step 5's lokale test, hardcode tijdelijk
`http://localhost:3333` als je dit end-to-end wil doorklikken, en zet dit terug vóór je commit —
of, beter: gebruik `process.env.URL || 'http://localhost:8888'` (poort 8888, Netlify's eigen
`netlify dev`-poort per `netlify.toml`'s `[dev] port = 8888`) als lokale fallback, wat voor beide
omgevingen een zinvolle default is zonder dat je iets moet terugzetten.

Geef `confirmUrl` mee aan `buildEmailHtml(...)` (in de aanroep rond regel 266-272, als extra veld
in het argument-object).

- [ ] **Step 4: Knop toevoegen aan `buildEmailHtml()`**

Wijzig de functiesignatuur (regel 87) om `confirmUrl` te ontvangen:

```js
function buildEmailHtml({ recipientName, subject, formattedDate, appointmentTime, serienummer, confirmUrl }) {
```

Voeg, na de bestaande "Afspraakbox" (rond regel 137, vóór de alinea die uitlegt hoe je kan
bevestigen door te antwoorden) een knop toe, in dezelfde inline-stijl als de rest van de e-mail:

```html
<div style="text-align:center;margin:18px 0">
  <a href="${confirmUrl}" style="display:inline-block;background:#00dfa3;color:#181e24;
    text-decoration:none;font-weight:700;font-size:14px;padding:12px 28px;border-radius:6px">
    ✅ Bevestig deze afspraak
  </a>
</div>
```

Laat de bestaande tekst "Gelieve deze afspraak te bevestigen door op deze e-mail te
antwoorden…" (rond regel 139-143) ongewijzigd staan — de knop is een snellere ALTERNATIEVE weg,
geen vervanging; pas de tekst wel licht aan zodat hij niet tegenstrijdig klinkt, bv.:
"Klik op de knop hierboven en bevestig op de volgende pagina om deze afspraak vast te leggen, of
antwoord op deze e-mail. Komt het voorgestelde tijdstip u niet uit? Laat het ons dan weten via een
antwoord op deze e-mail, zodat we samen een alternatief zoeken." **Let op de exacte formulering
"klik... en bevestig op de volgende pagina"** — de knop zelf bevestigt niet meteen (zie Task 1's
amendement: de link opent een tussenpagina met een eigen "Ja, ik bevestig"-knop); de e-mailtekst
mag niet suggereren dat de klik zelf al de bevestiging is, dat zou zowel verwarrend zijn als de
bewijswaarde van de expliciete tweede stap ondermijnen.

- [ ] **Step 5: Verifieer live**

Start `node dev-server.mjs`, gebruik de bestaande `?test`-testmodus of een echte
`POST /api/propose`-aanroep (via de UI: open een ticket, klik "📨 Voorstel", verstuur). Bevestig:
de gegenereerde e-mail-HTML (te zien via de lokale dev-server console-log of, als er geen echte
Zoho-mailversturing lokaal werkt, door `buildEmailHtml(...)` direct aan te roepen met testdata in
een Node-REPL) bevat de nieuwe knop met een geldige, ondertekende `confirmUrl`. Klik de link
(lokaal, via de fallback-poort uit Step 3): bevestig dat je op de tussenpagina met de "Ja, ik
bevestig"-knop landt (GEEN meteen-bevestigen), klik die knop, en bevestig dat de eigenlijke
bevestiging (met IP/tijdstip-notitie) dan pas gebeurt, zoals in Task 1 getest. **Bevestig ook dat
het bestaande "antwoorden op de mail"-pad (de status-PATCH naar
`'Wachten op bevestiging planning'`, regel 316-327) volledig ongewijzigd blijft werken** — dat
pad hoort dit blok niet te raken.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/propose.js
git commit -m "feat: bevestigingsknop in voorstelmail (Blok 1A)"
```

---

### Task 3: Volledige live-regressietest van Blok 1A

**Files:** geen (test-only taak)

- [ ] **Step 1: Volledige flow doorlopen**

Start `node dev-server.mjs`. Doorloop: open een ticket in de Wachtrij → "📨 Voorstel" → verstuur
een voorstel → bevestig dat de status-PATCH (`'Wachten op bevestiging planning'`) nog steeds
correct gebeurt (ongewijzigd bestaand gedrag) → haal de gegenereerde bevestigingslink op (uit de
dev-server-log of door `buildEmailHtml`/`signConfirmToken` direct te testen) → open de link (GET):
bevestig dat dit ENKEL de tussenpagina met de "Ja, ik bevestig"-knop toont en dat er geen
Zoho-PATCH gebeurt op dit punt (test dit expliciet, bv. door de Zoho-credentials tijdelijk
onjuist te zetten en te bevestigen dat de GET alsnog gewoon de tussenpagina toont in plaats van
een fout — het foutpad hoort pas bij de POST te horen) → klik de "Ja, ik bevestig"-knop (de POST):
bevestig dat de statuspagina "Afspraak bevestigd" nu pas toont en dat (indien geldige lokale
Zoho-credentials beschikbaar zijn) de Zoho-status effectief naar `'Geplande support'` verandert
mét een interne notitie op het ticket (IP + tijdstip). Test ook het foutpad: een verlopen of
onjuist ondertekende link → "Link ongeldig of verlopen"-pagina op zowel GET als POST, geen crash.

- [ ] **Step 2: Commit (indien fixes nodig waren tijdens deze test)**

Enkel als deze taak effectief iets moest herstellen — anders geen aparte commit nodig, dit is een
verificatietaak.

---

## Blok 1B — Beschikbaarheden-tab onder Instellingen

### Task 4: Tabs toevoegen aan Instellingen-modal + Beschikbaarheden-tab-inhoud

**Files:**
- Modify: `public/index.html` (Instellingen-modal-markup + nieuwe JS-functies)
- Modify: `public/css/app.css` (nieuwe sub-tab-styling binnen de modal)

**Interfaces:**
- Consumes: `avExceptions[]`, `saveAvailability()`, `avRemoveException()` (bestaand,
  ongewijzigd), en het bestaande `.av-*`-CSS-klassenpatroon (`public/css/app.css:516-535`).
- Produces: `setSettingsTab(tab)`, `renderBeschikbaarhedenTab()`, `avAddExceptionFromSettings()` —
  geen van deze wordt door andere taken in dit plan gebruikt (Blok 1B is losstaand).

- [ ] **Step 1: Lees de huidige Instellingen-modal en het blokkeer-modal-patroon ter controle**

Bevestig met `Read` van `public/index.html` regels 182-225 (Instellingen-modal, huidige platte
`.mhdr`/`.mbody`/`.mftr`-structuur, geen tabs) en regels 2079-2282 (`openBlockModal`,
`renderBlockModal`, `avSetKind`/`avSetScope`/`avSetMultiDay`, `avAddException`,
`avRemoveException`) dat de structuur nog overeenkomt. **Dit bestaande per-dag-blokkeer-modal
(`#block-overlay`/`#block-modal`) mag NIET aangepast worden — het blijft exact zoals het is,
bereikbaar via de kalender-dag-knop.** Deze taak bouwt een NIEUWE, aparte tab binnen de
Instellingen-modal die dezelfde onderliggende data (`avExceptions`) en opslagfunctie
(`saveAvailability()`) hergebruikt, met eigen render-/toevoeg-functies (niet
`renderBlockModal()`/`avAddException()` zelf hergebruiken — die zijn gekoppeld aan één
vooraf-gekozen dag via de module-level `_avFormDate`-variabelen; de nieuwe tab toont ALLE
uitzonderingen en heeft een expliciete datumkeuze, dus verdient eigen state-variabelen om
interferentie met het bestaande modal te vermijden).

- [ ] **Step 2: Tabs toevoegen aan de Instellingen-modal-markup**

Vervang de huidige Instellingen-modal (`public/index.html:182-225`) door:

```html
<!-- Instellingen modal -->
<div class="overlay" id="set-overlay" onclick="closeSettings(event)">
  <div class="modal" id="set-modal">
    <div class="mhdr">
      <div class="mhdr-title">⚙️ Instellingen</div>
      <div class="mhdr-num" id="set-person-label" style="font-size:0.78rem;color:var(--accent);margin-top:2px"></div>
    </div>
    <div class="set-subtabs">
      <button class="set-subtab active" id="set-subtab-algemeen" onclick="setSettingsTab('algemeen')">Algemeen</button>
      <button class="set-subtab" id="set-subtab-beschikbaarheden" onclick="setSettingsTab('beschikbaarheden')">Beschikbaarheden</button>
    </div>
    <div class="mbody" id="set-tab-algemeen">
      <div class="set-field">
        <label class="set-label">Startlocatie</label>
        <input class="set-input" id="set-start" type="text" placeholder="bv. Heirbaan 9, 9150 Kruibeke" />
      </div>
      <div class="set-field">
        <label class="set-label">Tijd per interventie (minuten)</label>
        <input class="set-input" id="set-duration" type="number" min="15" max="480" step="15" />
      </div>
      <div class="set-field">
        <label class="set-label">Max interventies per dag</label>
        <input class="set-input" id="set-max" type="number" min="1" max="20" />
      </div>
      <div class="set-field">
        <label class="set-label">Max. reistijd tussen interventies (minuten)</label>
        <input class="set-input" id="set-maxreistijd" type="number" min="0" max="240" step="5" />
      </div>
      <div class="set-field">
        <label class="set-label">Werkuren</label>
        <div class="set-row">
          <input class="set-input" id="set-van" type="time" />
          <span style="color:var(--muted);font-size:0.83rem;flex-shrink:0">tot</span>
          <input class="set-input" id="set-tot" type="time" />
        </div>
      </div>
      <div class="set-field">
        <label class="set-label">Werkdagen</label>
        <div class="days-grid" id="days-grid"></div>
      </div>
    </div>
    <div class="mbody" id="set-tab-beschikbaarheden" style="display:none">
      <!-- Ingevuld door renderBeschikbaarhedenTab() -->
    </div>
    <div class="mftr">
      <button class="btn-cancel" onclick="openPrijsBeheer()" title="Beheer productprijzen">💰 Prijzen</button>
      <button class="btn-cancel" onclick="closeSettings()">Annuleren</button>
      <button class="btn-save" id="set-save-btn" onclick="saveSettings()">Opslaan</button>
    </div>
  </div>
</div>
```

**Let op:** `set-save-btn` kreeg een `id` (ontbrak voordien) — nodig omdat Step 3 de knop verbergt
op de Beschikbaarheden-tab (die tab heeft zijn eigen "➕ Toevoegen"-knop per uitzondering, net als
het bestaande blokkeer-modal, geen aparte "Opslaan"-actie).

- [ ] **Step 3: `setSettingsTab()` toevoegen**

Voeg toe (bv. vlak vóór `openSettings()`, rond regel 3373):

```js
let _settingsActiveTab = 'algemeen';

function setSettingsTab(tab) {
  _settingsActiveTab = tab;
  document.getElementById('set-subtab-algemeen').classList.toggle('active', tab === 'algemeen');
  document.getElementById('set-subtab-beschikbaarheden').classList.toggle('active', tab === 'beschikbaarheden');
  document.getElementById('set-tab-algemeen').style.display = tab === 'algemeen' ? '' : 'none';
  document.getElementById('set-tab-beschikbaarheden').style.display = tab === 'beschikbaarheden' ? '' : 'none';
  document.getElementById('set-save-btn').style.display = tab === 'algemeen' ? '' : 'none';
  if (tab === 'beschikbaarheden') renderBeschikbaarhedenTab();
}
```

Wijzig `openSettings()` (rond regel 3373-3396) zodat hij bij het openen altijd terugvalt op de
"algemeen"-tab (`setSettingsTab('algemeen')` als eerste regel in de functie) — voorkomt dat de
modal ooit op de verkeerde tab geopend wordt na een vorige sessie.

- [ ] **Step 4: `renderBeschikbaarhedenTab()` + eigen toevoeg-state**

Voeg toe (na `setSettingsTab`):

```js
let _bavFormDate  = new Date().toISOString().split('T')[0];
let _bavFormDateTot = null;
let _bavFormMultiDay = false;
let _bavFormKind  = 'fullday';
let _bavFormScope = activeAssigneeFilter !== 'all' ? 'person' : 'global';

function renderBeschikbaarhedenTab() {
  const body = document.getElementById('set-tab-beschikbaarheden');
  if (!body) return;

  const today = new Date().toISOString().split('T')[0];
  const upcoming = avExceptions
    .filter(e => e.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const existingHtml = upcoming.length === 0
    ? `<div class="av-empty">Geen geplande beschikbaarheids-uitzonderingen.</div>`
    : upcoming.map(e => {
        const whoLabel = e.scope === 'global' ? 'Iedereen' : (e.person || '?');
        const kindLabel = e.kind === 'fullday' ? '🔒 Hele dag' : `⏱ ${e.from}–${e.to}`;
        const dateLabel = new Date(e.date + 'T12:00:00').toLocaleDateString('nl-BE', { day:'numeric', month:'short', year:'numeric' });
        const reasonPart = e.reason ? ` — ${escHtml(e.reason)}` : '';
        return `<div class="av-item">
          <span class="av-item-label">${escHtml(dateLabel)} · ${kindLabel}${reasonPart} <span class="av-item-who">(${escHtml(whoLabel)})</span></span>
          <button class="av-item-del" data-exception-id="${escHtml(e.id)}" title="Verwijderen">✕</button>
        </div>`;
      }).join('');

  const myPerson = activeAssigneeFilter === 'all' ? null : activeAssigneeFilter;
  const defaultVan = settings.vanTijd || '08:00';
  const defaultTot = settings.totTijd || '17:00';
  const scopeOptions = myPerson
    ? `<button class="av-radio-btn ${_bavFormScope === 'person' ? 'active' : ''}" onclick="bavSetScope('person')">👤 ${escHtml(myPerson.split(' ')[0])}</button>
       <button class="av-radio-btn ${_bavFormScope === 'global' ? 'active' : ''}" onclick="bavSetScope('global')">👥 Iedereen</button>`
    : `<button class="av-radio-btn active" disabled>👥 Iedereen</button>`;

  body.innerHTML = `
    <div class="av-section-title">Geplande uitzonderingen</div>
    <div class="av-existing">${existingHtml}</div>
    <div class="av-form">
      <div>
        <div class="av-section-title">Datum</div>
        <input type="date" class="av-time-input" id="bav-date" value="${_bavFormDate}" onchange="_bavFormDate=this.value" />
      </div>
      <div>
        <div class="av-section-title">Type</div>
        <div class="av-radio-group">
          <button class="av-radio-btn ${_bavFormKind === 'fullday' ? 'active' : ''}" onclick="bavSetKind('fullday')">🔒 Hele dag</button>
          <button class="av-radio-btn ${_bavFormKind === 'range'   ? 'active' : ''}" onclick="bavSetKind('range')">⏱ Tijdvak</button>
        </div>
      </div>
      ${_bavFormKind === 'fullday' ? `
      <div>
        <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer">
          <input type="checkbox" id="bav-multiday" onchange="bavSetMultiDay(this.checked)" ${_bavFormMultiDay ? 'checked' : ''} />
          Meerdere werkdagen (verlof)
        </label>
        ${_bavFormMultiDay ? `
        <div class="av-time-row" style="gap:8px;margin-top:8px">
          <span style="font-size:0.8rem;color:var(--muted)">Tot</span>
          <input type="date" class="av-time-input" id="bav-date-tot" value="${_bavFormDateTot || ''}" onchange="_bavFormDateTot=this.value" />
        </div>` : ''}
      </div>` : `
      <div>
        <div class="av-section-title">Tijdvak</div>
        <div class="av-time-row">
          <span style="font-size:0.8rem;color:var(--muted)">Van</span>
          <input class="av-time-input" id="bav-van" type="time" value="${defaultVan}" />
          <span style="font-size:0.8rem;color:var(--muted)">Tot</span>
          <input class="av-time-input" id="bav-tot" type="time" value="${defaultTot}" />
        </div>
      </div>`}
      <div>
        <div class="av-section-title">Voor</div>
        <div class="av-radio-group">${scopeOptions}</div>
      </div>
      <div>
        <div class="av-section-title">Reden <span style="font-weight:400;text-transform:none;letter-spacing:0">(optioneel)</span></div>
        <input class="av-reden-input" id="bav-reden" type="text" placeholder="bv. Verlof, dokter, opleiding…" />
      </div>
      <button class="av-add-btn" onclick="avAddExceptionFromSettings()">➕ Toevoegen</button>
    </div>`;

  body.querySelectorAll('.av-item-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      await avRemoveException(btn.dataset.exceptionId || '');
      renderBeschikbaarhedenTab();
    });
  });
}

function bavSetKind(kind) {
  _bavFormKind = kind;
  if (kind !== 'fullday') _bavFormMultiDay = false;
  renderBeschikbaarhedenTab();
}

function bavSetScope(scope) {
  _bavFormScope = scope;
  renderBeschikbaarhedenTab();
}

function bavSetMultiDay(checked) {
  _bavFormMultiDay = checked;
  if (!checked) _bavFormDateTot = null;
  renderBeschikbaarhedenTab();
}
```

**Let op:** `avRemoveException()` roept zelf al `renderKalender()` op na een succesvolle
verwijdering (bestaand gedrag, `public/index.html:2283-2294`) — het extra
`renderBeschikbaarhedenTab()`-aanroep hierboven ververst enkel de nieuwe tab-lijst zelf, die
`avRemoveException` niet kent.

- [ ] **Step 5: `avAddExceptionFromSettings()` toevoegen**

Deze functie is een aangepaste kopie van het bestaande `avAddException()`
(`public/index.html:2201-2281`) die de `_bav*`-state-variabelen gebruikt i.p.v. `_avForm*`, en
`renderBeschikbaarhedenTab()` i.p.v. `renderBlockModal()` als re-render-doel na een wijziging:

```js
async function avAddExceptionFromSettings() {
  const myPerson = activeAssigneeFilter === 'all' ? null : activeAssigneeFilter;
  const scope    = (myPerson && _bavFormScope === 'person') ? 'person' : 'global';
  const from     = _bavFormKind === 'range' ? (document.getElementById('bav-van')?.value || settings.vanTijd) : null;
  const to       = _bavFormKind === 'range' ? (document.getElementById('bav-tot')?.value || settings.totTijd) : null;
  const reason   = document.getElementById('bav-reden')?.value?.trim() || '';

  if (_bavFormKind === 'range' && from >= to) {
    toast('⚠ Eindtijd moet na begintijd liggen', 2500);
    return;
  }

  if (_bavFormKind === 'fullday' && _bavFormMultiDay && _bavFormDateTot) {
    const vanDate = new Date(_bavFormDate    + 'T12:00:00');
    const totDate = new Date(_bavFormDateTot + 'T12:00:00');
    if (totDate < vanDate) {
      toast('⚠ Einddatum moet na startdatum liggen', 2500);
      return;
    }
    const newExceptions = [];
    const cur = new Date(vanDate);
    while (cur <= totDate) {
      if (settings.werkdagen.includes(cur.getDay())) {
        newExceptions.push({
          id: crypto.randomUUID(), scope, person: scope === 'person' ? myPerson : null,
          date: cur.toISOString().split('T')[0], kind: 'fullday', from: null, to: null, reason,
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    if (!newExceptions.length) {
      toast('⚠ Geen werkdagen in de geselecteerde periode', 2500);
      return;
    }
    avExceptions.push(...newExceptions);
    _bavFormMultiDay = false;
    _bavFormDateTot  = null;
    renderBeschikbaarhedenTab();
    renderKalender();
    const ok = await saveAvailability();
    if (!ok) {
      const ids = new Set(newExceptions.map(e => e.id));
      avExceptions = avExceptions.filter(e => !ids.has(e.id));
      renderBeschikbaarhedenTab();
      renderKalender();
    }
    return;
  }

  const ex = {
    id: crypto.randomUUID(), scope, person: scope === 'person' ? myPerson : null,
    date: _bavFormDate, kind: _bavFormKind, from, to, reason,
  };
  avExceptions.push(ex);
  renderBeschikbaarhedenTab();
  renderKalender();
  const ok = await saveAvailability();
  if (!ok) {
    avExceptions = avExceptions.filter(e => e.id !== ex.id);
    renderBeschikbaarhedenTab();
    renderKalender();
  }
}
```

- [ ] **Step 6: CSS voor de sub-tabs**

Voeg toe aan `public/css/app.css` (bij de bestaande Instellingen/`.set-*`-sectie, rond regel 681):

```css
.set-subtabs { display:flex; gap:4px; padding:0 16px; border-bottom:1px solid var(--border); }
.set-subtab {
  background:none; border:none; padding:10px 14px; font-size:0.85rem; color:var(--muted);
  cursor:pointer; border-bottom:2px solid transparent; font-weight:600;
}
.set-subtab.active { color:var(--accent); border-bottom-color:var(--accent); }
.set-subtab:hover { color:var(--text); }
```

- [ ] **Step 7: Verifieer live in de browser**

Start `node dev-server.mjs`. Open Instellingen: bevestig dat de "Algemeen"-tab er ongewijzigd
uitziet en nog steeds normaal opslaat (bestaand gedrag, niet aangeraakt). Klik "Beschikbaarheden":
bevestig dat de lijst van geplande uitzonderingen toont, dat een nieuwe "Hele dag"- en
"Tijdvak"-uitzondering toegevoegd kan worden (met een expliciete datumkeuze, niet gekoppeld aan
een vooraf-aangeklikte kalenderdag), dat "meerdere werkdagen" nog steeds correct meerdere
exceptions aanmaakt, en dat verwijderen werkt. **Bevestig ook dat het BESTAANDE
per-dag-blokkeer-modal (klik op een kalenderdag → "⏱ Beschikbaar"-knop) nog exact hetzelfde werkt
als vóór deze taak** — dit is de belangrijkste regressiecheck, aangezien beide paden dezelfde
onderliggende data delen. Test in zowel licht- als donker-thema.

- [ ] **Step 8: Commit**

```bash
git add public/index.html public/css/app.css
git commit -m "feat: Beschikbaarheden-tab onder Instellingen (Blok 1B)"
```

---

### Task 5: Volledige live-regressietest van Blok 1B

**Files:** geen (test-only taak)

- [ ] **Step 1: Beide paden na elkaar testen**

In dezelfde sessie: voeg een uitzondering toe via de nieuwe Beschikbaarheden-tab, bevestig dat hij
zichtbaar wordt in de kalender (dag-header-label/knop, zoals vandaag al werkt). Voeg daarna een
uitzondering toe via het bestaande per-dag-blokkeer-modal, bevestig dat BEIDE nu correct in de
Beschikbaarheden-tab-lijst verschijnen (herlaad de tab). Verwijder er één via elk pad, bevestig
consistentie.

- [ ] **Step 2: Commit (enkel als fixes nodig waren)**

---

## Blok 1C — Kalender-tijdlijn (desktop) + Tijdsloten

### Task 6: `settings.tijdslotMinuten` + `tijdslotVoor()`-helper

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Produces: `settings.tijdslotMinuten` (nieuw instelling-veld), `tijdslotVoor(minuten, slotMinuten)`
  — gebruikt door Task 9 (voorstel-mail/preview, technieker-kaart, maandweergave) en optioneel
  Task 7 (tijdlijn-weergave zelf, als de technieker-kaart daar ook het slot toont i.p.v. de
  exacte tijd — zie Task 9's afweging).
- Consumes: `settings.vanTijd` (bestaand, `public/index.html:631`).

- [ ] **Step 1: `DEFAULT_SETTINGS` en het Instellingen-formulier uitbreiden**

`public/index.html:629-632` (of de exacte huidige regels, bevestig met `grep -n "DEFAULT_SETTINGS"
public/index.html`) — voeg een nieuw veld toe aan het `DEFAULT_SETTINGS`-object:

```js
tijdslotMinuten: 180, // 3 uur — configureerbaar tijdvak i.p.v. exact tijdstip (Blok 1C)
```

Voeg in de Instellingen "Algemeen"-tab (`public/index.html`, in `#set-tab-algemeen`, ná het
"Werkuren"-veld) een nieuw invoerveld toe:

```html
<div class="set-field">
  <label class="set-label">Tijdslot-grootte voor klant/technieker (minuten)</label>
  <input class="set-input" id="set-tijdslot" type="number" min="60" max="360" step="30" />
</div>
```

Werk `openSettings()` (regel ~3373-3396) bij om `document.getElementById('set-tijdslot').value =
settings.tijdslotMinuten;` te lezen, en `saveSettings()` (regel ~3403-3427) om
`settings.tijdslotMinuten = parseInt(document.getElementById('set-tijdslot').value, 10) ||
DEFAULT_SETTINGS.tijdslotMinuten;` te schrijven — zelfde patroon als de bestaande
`set-duration`/`set-max`-velden ernaast, bevestig de exacte bestaande schrijfwijze met `Read`
vóór je dit toevoegt.

- [ ] **Step 2: `tijdslotVoor()` toevoegen**

Voeg toe (bv. vlak bij `computeArrivalTimes()`, rond regel 3541, als een kleine, pure helper
ernaast — raakt `computeArrivalTimes()` zelf niet aan):

```js
// Vertaalt een exact tijdstip (minuten sinds middernacht) naar een configureerbaar tijdslot,
// uitgelijnd op settings.vanTijd zodat sloten er "netjes" uitzien (bv. 08:00–11:00, 11:00–14:00
// i.p.v. willekeurige offsets). computeArrivalTimes() zelf blijft ongewijzigd exacte minuten
// berekenen — dit is uitsluitend een weergave-laag (zie Global Constraints).
function tijdslotVoor(minuten, slotMinuten) {
  const slot = slotMinuten || settings.tijdslotMinuten || 180;
  const [vanH, vanM] = (settings.vanTijd || '08:00').split(':').map(Number);
  const dagStart = vanH * 60 + vanM;
  const offset = Math.max(0, minuten - dagStart);
  const slotIndex = Math.floor(offset / slot);
  const slotStartMin = dagStart + slotIndex * slot;
  const slotEndMin = slotStartMin + slot;
  return {
    startMin: slotStartMin,
    endMin: slotEndMin,
    label: `${minToTimeStr(slotStartMin)}–${minToTimeStr(slotEndMin)}`,
  };
}
```

**Let op:** `minToTimeStr()` bestaat al (gebruikt door `openProposal()`, zie Blok 1A/Task 2's
context) — bevestig met `grep -n "function minToTimeStr" public/index.html` de exacte locatie en
signatuur vóór je dit gebruikt.

- [ ] **Step 3: Verifieer met een klein Node-scriptje of browserconsole**

`tijdslotVoor(9*60+15, 180)` met `settings.vanTijd = '08:00'` moet `{ startMin: 480, endMin: 660,
label: '08:00–11:00' }` geven (09:15 valt in het eerste 3-uur-blok vanaf 08:00). `tijdslotVoor(13*60,
180)` moet het tweede blok geven: `{ startMin: 660, endMin: 840, label: '11:00–14:00' }`. Test dit
via de browserconsole met `window.tijdslotVoor(...)` (impliciete global, geen bridge nodig).

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: tijdslotMinuten-instelling + tijdslotVoor()-helper (Blok 1C, voorbereiding)"
```

---

### Task 7: `renderDayTimeline()` + responsieve vertakking in `renderKalender()`

**Files:**
- Modify: `public/index.html`
- Modify: `public/css/app.css`

**Interfaces:**
- Consumes: `duurVoor(ticketId)` (bestaand, `public/index.html:606-609`), `settings.vanTijd`/
  `settings.totTijd` (bestaand).
- Produces: `renderDayTimeline(dateStr, dayStops, dayEvents, dayReports)` — gebruikt door Task 8
  (geblokkeerde segmenten) en Task 9 (tijdsloten op de technieker-kaart).

- [ ] **Step 1: Lees de huidige week-view-rendering ter controle**

Bevestig met `Read` van `public/index.html` rond regel 1158-1310 (`renderKalender()`, week-view-tak,
regels 1201-1205 voor de `month`-vertakking, 1273-1284 voor de huidige sortering/kaartopbouw) dat
de structuur nog overeenkomt. Bevestig ook `public/css/app.css:805` (`.desktop-only { display:
none !important }` binnen `@media (max-width: 1023px)`) als het bestaande responsive-omslagpunt
dat deze taak moet overnemen (`window.innerWidth >= 1024` als desktop-conditie).

- [ ] **Step 2: `renderDayTimeline()` toevoegen**

Voeg toe, vlak vóór `renderKalender()`:

```js
// Tekent één dag als een echte tijdlijn (uur-as, blokken proportioneel aan duur) — enkel voor
// desktop/web (zie renderKalender()'s responsieve vertakking in Step 3). Mobiel behoudt de
// bestaande gestapelde-kaartjeslijst volledig ongewijzigd.
const TIMELINE_PX_PER_MIN = 1.2;
const TIMELINE_MIN_BLOCK_PX = 26;

function timelineTopHeight(startMin, endMin, dagStartMin) {
  const top = Math.max(0, (startMin - dagStartMin) * TIMELINE_PX_PER_MIN);
  const height = Math.max(TIMELINE_MIN_BLOCK_PX, (endMin - startMin) * TIMELINE_PX_PER_MIN);
  return { top, height };
}

function renderDayTimeline(dateStr, dayStops, dayEvents, dayReports) {
  const [vanH, vanM] = (settings.vanTijd || '08:00').split(':').map(Number);
  const [totH, totM] = (settings.totTijd || '17:00').split(':').map(Number);
  const dagStartMin = vanH * 60 + vanM;
  const dagEindMin  = totH * 60 + totM;
  const totalHeight = Math.max(TIMELINE_MIN_BLOCK_PX, (dagEindMin - dagStartMin) * TIMELINE_PX_PER_MIN);

  const hourLines = [];
  for (let h = vanH; h <= totH; h++) {
    const top = (h * 60 - dagStartMin) * TIMELINE_PX_PER_MIN;
    hourLines.push(`<div class="tl-hour-line" style="top:${top}px"><span class="tl-hour-label">${String(h).padStart(2,'0')}:00</span></div>`);
  }

  const blocks = [];
  dayStops.forEach(stop => {
    if (!stop.uur) return; // geen tijdstip toegekend — blijft ongepositioneerd, zie Let op hieronder
    const [h, m] = stop.uur.split(':').map(Number);
    const startMin = h * 60 + m;
    const duur = duurVoor(stop.ticket.id);
    const endMin = startMin + duur;
    const { top, height } = timelineTopHeight(startMin, endMin, dagStartMin);
    blocks.push(`<div class="tl-block tl-ticket" style="top:${top}px;height:${height}px" data-ticket-id="${escHtml(stop.ticket.id)}">
      ${buildTicketCard(stop, dateStr)}
    </div>`);
  });
  dayEvents.forEach(ev => {
    if (!ev.uur) return;
    const [h, m] = ev.uur.split(':').map(Number);
    const startMin = h * 60 + m;
    let endMin = startMin + (settings.tijdslotMinuten || 180) / 3; // fallback: 1u als geen einduur
    if (ev.einduur) {
      const [eh, em] = ev.einduur.split(':').map(Number);
      endMin = eh * 60 + em;
    }
    const { top, height } = timelineTopHeight(startMin, endMin, dagStartMin);
    blocks.push(`<div class="tl-block tl-event" style="top:${top}px;height:${height}px">${buildLocalEventCard(ev)}</div>`);
  });

  // Rapporten (afgeronde bezoeken) blijven, net als vandaag, gewoon in de lijst ONDER de
  // tijdlijn getekend — ze hebben geen "gepland tijdstip" om te positioneren (rapportData.start
  // is de WERKELIJKE starttijd achteraf, geen planningstijd), dus geen zinvolle positie op de
  // vooruit-geplande-tijdlijn. Consistente behandeling met hoe niet-gepositioneerde tickets
  // hieronder ook als losse rij getoond worden.
  const ongepositioneerd = [
    ...dayStops.filter(s => !s.uur).map(s => buildTicketCard(s, dateStr)),
    ...dayReports.map(r => buildReportCard(r)),
  ];

  return `
    <div class="tl-wrap" style="height:${totalHeight}px">
      ${hourLines.join('')}
      ${blocks.join('')}
    </div>
    ${ongepositioneerd.length ? `<div class="tl-ongepositioneerd">${ongepositioneerd.join('')}</div>` : ''}
  `;
}
```

**Let op:** deze functie neemt bewust NIET de geblokkeerde/verlof-segmenten mee — dat is Task 8,
die deze functie in een aparte stap uitbreidt (zie die taak) om de diff behapbaar te houden. Bouw
en test Task 7 eerst zonder die segmenten, precies zoals de bestaande gestapelde-lijst ze vandaag
ook niet als segment toont (enkel als dag-header-label) — dus geen regressie t.o.v. vandaag als
Task 8 nog niet is uitgevoerd.

- [ ] **Step 3: Responsieve vertakking in `renderKalender()`**

Zoek de exacte plek waar de huidige week-view zijn kaartjeslijst opbouwt (regels ~1273-1284,
bevestig met `Read`). Wijzig dit naar:

```js
const isDesktopTijdlijn = window.innerWidth >= 1024;
if (isDesktopTijdlijn) {
  dayBodyEl.innerHTML = renderDayTimeline(dateStr, dayStops, dayEvents, dayReports);
} else {
  // Bestaande gestapelde-kaartjeslijst-logica — VOLLEDIG ONGEWIJZIGD, letterlijk hetzelfde
  // codeblok dat hier al stond vóór deze taak (regels 1273-1284 uit de oude telling).
  const timeline = [
    ...dayStops.map(stop => ({ kind: 'ticket', sortKey: stop.uur || '99:99', stop })),
    ...dayEvents.map(ev   => ({ kind: 'event',  sortKey: ev.uur   || '99:99', ev })),
    ...dayReports.map(r    => ({ kind: 'report', sortKey: r.rapportData?.start || '99:99', report: r })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  // ... (rest van de bestaande opbouw-logica, ongewijzigd overnemen)
}
```

Vervang `dayBodyEl` door de exacte bestaande variabelenaam die naar het `.day-body`-element
verwijst op deze plek in de code (bevestig de naam via de `Read` uit Step 1 — schrijf niet
blindelings "dayBodyEl" als de bestaande code een andere naam gebruikt).

- [ ] **Step 4: CSS voor de tijdlijn**

Voeg toe aan `public/css/app.css`:

```css
.tl-wrap { position:relative; margin:0 -6px; }
.tl-hour-line {
  position:absolute; left:0; right:0; border-top:1px dashed var(--border); height:0;
}
.tl-hour-label {
  position:absolute; left:0; top:-9px; font-size:0.68rem; color:var(--muted);
  background:var(--surface2); padding:0 4px;
}
.tl-block {
  position:absolute; left:34px; right:6px; overflow:hidden; border-radius:var(--r);
}
.tl-block .cal-card { height:100%; margin:0; }
.tl-ongepositioneerd { margin-top:8px; padding-top:8px; border-top:1px dashed var(--border); }

@media (max-width: 1023px) {
  /* Tijdlijn wordt sowieso nooit gerenderd onder 1024px (zie de JS-vertakking), maar voor de
     zeldzame situatie van een venster-resize zonder herlaad: verberg 'm defensief. */
  .tl-wrap, .tl-ongepositioneerd { display: none; }
}
```

- [ ] **Step 5: Verifieer live in de browser**

Start `node dev-server.mjs`, open de Kalender-tab op een breed (desktop) venster: bevestig dat elke
dag nu een echte tijdlijn toont met een uur-as en proportioneel geplaatste blokken (test met
tickets op verschillende uren en duren). Verklein het venster onder 1024px (of gebruik
`resize_window` met een mobiel-preset): bevestig dat de bestaande gestapelde-kaartjeslijst
terugkomt, ONGEWIJZIGD t.o.v. vóór deze taak. Test beide thema's. Test de maandweergave apart:
bevestig dat die volledig ongewijzigd blijft (dit blok raakt enkel de week-view).

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/css/app.css
git commit -m "feat: kalender-dagtijdlijn voor desktop (Blok 1C, zonder geblokkeerde segmenten)"
```

---

### Task 8: Geblokkeerde/verlof-segmenten als gepositioneerd blok in de tijdlijn

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `avExceptions[]` (bestaand), `renderDayTimeline()` (Task 7 — deze taak breidt hem uit).

- [ ] **Step 1: Lees hoe `capacityForDay()` `range`-exceptions vandaag al verwerkt**

Bevestig met `Read` van `public/index.html` rond regel 2299-2329 (`capacityForDay()`,
`blockedMin`-berekening uit `e.from`/`e.to`) het exacte patroon voor het omzetten van een
`range`-exception naar minuten — dit is dezelfde berekening die Step 2 hieronder nodig heeft voor
positionering.

- [ ] **Step 2: `renderDayTimeline()` uitbreiden met geblokkeerde segmenten**

Voeg, binnen `renderDayTimeline()` (Task 7), vóór de `return`, toe:

```js
  const myPerson = activeAssigneeFilter === 'all' ? null : activeAssigneeFilter;
  const dayExceptions = avExceptions.filter(e =>
    e.date === dateStr && (e.scope === 'global' || (myPerson && e.person === myPerson))
  );
  dayExceptions.forEach(e => {
    if (e.kind === 'fullday') return; // hele dag blijft de bestaande kolom-brede stripe (blocked-day-klasse), geen los blok nodig
    const [fromH, fromM] = e.from.split(':').map(Number);
    const [toH, toM]     = e.to.split(':').map(Number);
    const startMin = fromH * 60 + fromM;
    const endMin   = toH * 60 + toM;
    const { top, height } = timelineTopHeight(startMin, endMin, dagStartMin);
    const reasonPart = e.reason ? `: ${escHtml(e.reason)}` : '';
    blocks.push(`<div class="tl-block tl-blocked" style="top:${top}px;height:${height}px" title="Niet beschikbaar${reasonPart}">
      🔒 ${e.from}–${e.to}${reasonPart}
    </div>`);
  });
```

(Voeg dit tussen de bestaande `dayEvents.forEach(...)`-blok en de `return`-instructie uit Task 7.)

- [ ] **Step 3: CSS voor het geblokkeerde segment**

Voeg toe aan `public/css/app.css`:

```css
.tl-blocked {
  background:repeating-linear-gradient(45deg, rgba(255,90,90,0.15), rgba(255,90,90,0.15) 6px, rgba(255,90,90,0.25) 6px, rgba(255,90,90,0.25) 12px);
  border:1px solid rgba(255,90,90,0.4); font-size:0.75rem; color:var(--text); padding:4px 6px;
  z-index:0; /* onder de ticket/event-blokken, die zelf geen z-index zetten en dus op 'auto'
                (effectief boven deze regel) renderen door DOM-volgorde — ticket/event-blokken
                worden in renderDayTimeline() NA de geblokkeerde segmenten toegevoegd */
}
```

**Let op:** bevestig dat de volgorde in `renderDayTimeline()` klopt zodat `.tl-blocked`-elementen
vóór de ticket/event-blokken in de HTML staan (zodat ze er visueel onder liggen zonder een
expliciete hogere `z-index` op de andere blokken nodig te hebben) — in de code-volgorde hierboven
(Step 2 ná Task 7's `dayEvents.forEach`, vóór de `return`) staan ze NA de tickets/events in de
DOM, wat ze er dus BOVEN zou tekenen. Herschik de `blocks.push(...)`-aanroepen zodat de
`dayExceptions.forEach(...)`-blok als EERSTE in `blocks` pusht (verplaats dit codeblok naar vóór
`dayStops.forEach(...)` in Task 7's functie), zodat DOM-volgorde en visuele laag-volgorde
overeenkomen.

- [ ] **Step 4: Verifieer live in de browser**

Voeg via de nieuwe Beschikbaarheden-tab (Task 4) of het bestaande blokkeer-modal een
"Tijdvak"-uitzondering toe voor een dag deze week (bv. 09:00-12:00, "Dokter"). Bevestig in de
desktop-tijdlijn: een gestreept, roodachtig blok verschijnt correct gepositioneerd tussen 09:00 en
12:00, tickets ernaast/errond blijven normaal zichtbaar. Bevestig dat een "Hele dag"-uitzondering
nog steeds de bestaande kolom-brede stripe geeft (ongewijzigd, geen los blok — zoals Step 2's
`if (e.kind === 'fullday') return;` bedoelt).

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/css/app.css
git commit -m "feat: geblokkeerde/verlof-segmenten als gepositioneerd blok in de tijdlijn (Blok 1C)"
```

---

### Task 9: Tijdsloten doorvoeren naar voorstel-mail, technieker-kaart, maandweergave

**Files:**
- Modify: `public/index.html` (`openProposal`, `updateProposalPreview`, de `/api/propose`-aanroep,
  `buildTicketCard`, `renderMonthView`)
- Modify: `netlify/functions/propose.js` (`buildEmailHtml()`)

**Interfaces:**
- Consumes: `tijdslotVoor()` (Task 6), `computeArrivalTimes()` (bestaand, blijft ONGEWIJZIGD).

- [ ] **Step 1: Lees de huidige voorstel-preview en verzend-aanroep ter controle**

Bevestig met `Read` van `public/index.html` regels 3586-3667 (`openProposal`,
`updateProposalPreview`) en 3712-3724 (de `fetch('/api/propose', ...)`-aanroep) dat de structuur
nog overeenkomt. Bevestig met `Read` van `netlify/functions/propose.js` regels 87, 134, 220-225
(`buildEmailHtml`-signatuur, de weergaveregel, en hoe `appointmentTime`/`interventieDatum` bepaald
worden). **Cruciaal:** `appointmentTime` bepaalt ook `interventieDatum` (het echte, exacte
Zoho-scheduling-veld, regel 225) — dat mag NIET wijzigen. Enkel de WEERGAVE in de e-mail (regel
134) verandert naar een tijdslot; de exacte tijd blijft intern volledig behouden en opgeslagen.

- [ ] **Step 2: Tijdslot berekenen in `updateProposalPreview()` en meesturen**

Wijzig `updateProposalPreview()` (regel ~3623-3667): waar vandaag `apptTime` berekend wordt (regel
3627: `const apptTime = rawTime ? roundToNextQuarterStr(rawTime) : '—';`), voeg ernaast toe:

```js
const apptMin = rawTime ? (() => { const [h,m]=roundToNextQuarterStr(rawTime).split(':').map(Number); return h*60+m; })() : null;
const apptWindow = apptMin !== null ? tijdslotVoor(apptMin).label : '—';
```

Wijzig de weergaveregel in de HTML-preview (regel 3657: `<div ...>om <strong>${apptTime}</strong>
uur</div>`) naar:

```html
<div style="font-size:12px;color:#3a3a3a">tussen <strong>${apptWindow}</strong> uur</div>
```

- [ ] **Step 3: Tijdslot meesturen naar `/api/propose`**

Wijzig de `fetch('/api/propose', ...)`-aanroep (regel 3712-3724) om `appointmentWindow:
apptWindow` toe te voegen aan de `body`:

```js
body: JSON.stringify({
  ticketId, date, time: rawTime, utcInterventieDatum,
  recipientName: activeTicket.naamEindklant || activeTicket.contact || '',
  subject:       activeTicket.subject || '',
  serienummer:   activeTicket.serienummer || '',
  appointmentWindow: apptWindow,
}),
```

(`apptWindow` moet hier bereikbaar zijn — bevestig dat het in dezelfde functie-scope berekend
wordt als deze `fetch`-aanroep, of bereken het hier opnieuw via dezelfde
`document.getElementById('proposal-time').value`-uitlezing als Step 2 gebruikt, als het een
andere functie is. Bevestig de exacte functie-grens met de `Read` uit Step 1.)

- [ ] **Step 4: `propose.js` — `appointmentWindow` doorgeven aan `buildEmailHtml()`**

In de handler, waar `appointmentWindow` uit de request-body gelezen wordt (destructureer hem
samen met `ticketId`/`date`/`time` rond regel 195-220), geef hem mee aan de `buildEmailHtml(...)`-
aanroep (rond regel 266-272) als extra veld. **`appointmentTime`/`interventieDatum` blijven
ongewijzigd berekend en opgeslagen (regels 221-225) — enkel `appointmentWindow` is nieuw en
uitsluitend voor weergave.**

Wijzig `buildEmailHtml()`'s signatuur (regel 87) en weergaveregel (regel 134):

```js
function buildEmailHtml({ recipientName, subject, formattedDate, appointmentTime, appointmentWindow, serienummer, confirmUrl }) {
  // ...
  // regel 134, was: <div ...>om <strong>${appointmentTime}</strong> uur</div>
  // wordt:
  <div style="font-size:16px;color:#3a3a3a">tussen <strong>${escHtml(appointmentWindow || appointmentTime)}</strong> uur</div>
```

**Correctie (na Task 9-review, 2026-08-14): `escHtml()` is verplicht rond deze interpolatie.**
Deze code-sample miste oorspronkelijk `escHtml()`, in tegenstelling tot elk ander
gebruiker-aangeleverd veld in dezelfde functie (`recipientName`/`subject`/`serienummer` worden
wél al ge-escaped). `appointmentWindow` komt rechtstreeks uit de POST-body van een
ongeauthenticeerd endpoint (`/api/propose` heeft geen enkele auth-check), zonder
formaatvalidatie — zonder `escHtml()` is dit een HTML-injectie/phishing-vector in een
transactionele e-mail die naar echte klant-/installateur-adressen verstuurd wordt via Zoho
`sendReply`. Gebruik in de praktijk levert de UI altijd een veilig, intern geformatteerd label,
dus dit was latent (niet via de app zelf uitbuitbaar), maar wel een reëel nieuw aanvalsoppervlak
dat gefixt moest worden. De `|| appointmentTime`-fallback (dekt het geval dat een oudere/andere
aanroeper `appointmentWindow` niet meestuurt) blijft ongewijzigd, enkel binnen `escHtml(...)`.

- [ ] **Step 5: Technieker-kaart in de tijdlijn**

Wijzig `buildTicketCard()` (`public/index.html:1083-1111`) zodat de kaart, naast de bestaande
exacte tijd (`stop.uur`), ook het tijdslot toont als primair label — bv. wijzig regel 1094 van:

```js
${stop.uur ? `<div class="cal-meta" ...>🕐 ${stop.uur}</div>` : ''}
```

naar:

```js
${stop.uur ? (() => {
  const [h, m] = stop.uur.split(':').map(Number);
  const win = tijdslotVoor(h * 60 + m).label;
  return `<div class="cal-meta" ...>🕐 ${win} <span style="opacity:0.65;font-size:0.85em">(gepland ${stop.uur})</span></div>`;
})() : ''}
```

**Ontwerpkeuze, expliciet voor de reviewer:** de spec zegt dat de technieker-kaart "geraakt"
wordt door tijdsloten, maar niet dat de exacte tijd voor de technieker verborgen moet worden — in
tegenstelling tot de klant (die de exacte tijd nooit ziet), heeft de technieker zelf baat bij
beide: het tijdslot als primair, herkenbaar label (consistent met wat de klant ziet), en de
exacte geplande tijd als kleiner detail ernaast (nuttig voor zijn eigen planning-efficiëntie).
Als Brent dit anders wil (bv. de technieker toont ENKEL het tijdslot, geen exacte tijd), is dat
een eenregelige aanpassing — meld deze keuze in je taakrapport zodat ze expliciet bevestigd kan
worden.

- [ ] **Step 6: Maandweergave-labels**

Bevestig met `Read` van `public/index.html` rond regel 1374-1388 (`renderMonthView()`'s
chip-opbouw) de exacte huidige structuur (vandaag toont een chip enkel `#ticketnummer subject`,
geen tijd). Voeg het tijdslot toe aan de chip-tekst voor tickets met een `uur`:

```js
// in de chip-opbouw voor een ticket-stop, voeg het tijdslot toe als het stop.uur heeft:
const winLabel = stop.uur ? tijdslotVoor((() => { const [h,m]=stop.uur.split(':').map(Number); return h*60+m; })()).label + ' · ' : '';
// gebruik winLabel als prefix in de chip-tekst, bv. `${winLabel}#${stop.ticket.number} ${stop.ticket.subject}`
```

Pas de exacte plek/variabelenamen aan naar wat de `Read` hierboven bevestigt — dit is een
kleine, geïsoleerde toevoeging aan een bestaande template-string, geen herstructurering.

- [ ] **Step 7: Verifieer live in de browser**

Doorloop een volledig voorstel: open een ticket → "📨 Voorstel" → bevestig dat de preview nu
"tussen HH:MM–HH:MM uur" toont i.p.v. een exact tijdstip → verstuur (of bevestig via de
dev-server-log/een directe `buildEmailHtml()`-test) dat de verstuurde e-mail hetzelfde tijdslot
toont. Bevestig dat `interventieDatum`/de Zoho-opslag nog steeds de EXACTE tijd gebruikt (niet het
tijdslot) — dit is de belangrijkste regressiecheck van deze taak. Bevestig in de kalendertijdlijn
(desktop) dat de technieker-kaart nu het tijdslot + exacte tijd toont. Bevestig in de
maandweergave dat chips nu een tijdslot-label tonen.

- [ ] **Step 8: Commit**

```bash
git add public/index.html netlify/functions/propose.js
git commit -m "feat: tijdsloten doorvoeren naar voorstel-mail, technieker-kaart, maandweergave (Blok 1C)"
```

---

### Task 10: Volledige live-regressietest van Blok 1C

**Files:** geen (test-only taak)

- [ ] **Step 1: Desktop + mobiel + beide thema's**

Doorloop op een breed venster: kalender-week-view toont de tijdlijn correct voor meerdere dagen
met verschillende bezetting (leeg, 1 ticket, meerdere overlappende tickets, een geblokkeerd
tijdvak, een lokale afspraak met `einduur`). Verklein naar mobiel-breedte: bevestig de bestaande
gestapelde lijst, volledig ongewijzigd. Test beide thema's op beide breedtes. Doorloop een
volledig voorstel tot verzending, bevestig het tijdslot overal consistent getoond wordt en de
onderliggende exacte tijd/`computeArrivalTimes()`/route-optimalisatie ongewijzigd blijft werken
(bv. door de bestaande route-berekening/"Route berekenen"-knop nog eens te testen).

- [ ] **Step 2: Commit (enkel als fixes nodig waren)**

---

## Blok 1D — Lokale caching (stale-while-revalidate)

### Task 11: Generieke cache-first-helper

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Produces: `loadFromCache(key)`, `saveToCache(key, data)` — gebruikt door Task 12.

- [ ] **Step 1: Toevoegen**

Voeg toe, ergens vóór de eerste loader-functie (bv. vlak vóór `loadTickets()`, rond regel 738):

```js
// Generieke cache-first-helpers (Blok 1D). Elke loader die dit gebruikt: leest eerst synchroon
// uit localStorage en past dat toe (render meteen "wat lokaal bekend is"), start dan de echte
// fetch op de achtergrond, en werkt bij zodra die binnenkomt ("stale-while-revalidate"). Dit is
// een BEWUSTE gedragswijziging t.o.v. vandaag (waar deze 3 loaders bij een fetch-fout terugvallen
// naar een LEGE staat) — bij een fetch-fout blijft nu de laatst gekende cache staan i.p.v. leeg te
// worden, wat een verbetering is, geen toevallige bijwerking (zie Task 12's Let op).
function loadFromCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* quota vol o.i.d. — cache is best-effort */ }
}
```

- [ ] **Step 2: Verifieer**

Via de browserconsole: `saveToCache('test_key', { a: 1 })`, dan `loadFromCache('test_key')` moet
`{ a: 1 }` teruggeven. `loadFromCache('niet-bestaande-key')` moet `null` geven, geen fout.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: generieke cache-first-helper (Blok 1D, voorbereiding)"
```

---

### Task 12: Cache-first toepassen op `loadTickets`/`loadAvailability`/`loadAfspraken`/`loadKlantBeschikbaarheid`

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `loadFromCache`/`saveToCache` (Task 11).

- [ ] **Step 1: Lees alle 4 loaders exact ter controle**

Bevestig met `Read`: `loadTickets()` (regels 738-815, incl. de `TEST_MODE`-tak op 742-744),
`loadAvailability()` (2029-2042), `loadAfspraken()` (1462-1475), `loadKlantBeschikbaarheid()`
(1508-1520). Voor elk: bevestig welke globale variabelen hij vult en welke render-aanroepen hij na
het vullen doet (`loadAvailability`/`loadAfspraken` roepen `renderKalender()` vandaag zelfs op het
foutpad aan — `loadKlantBeschikbaarheid` roept helemaal niets aan).

- [ ] **Step 2: `loadAvailability()` herschrijven**

```js
async function loadAvailability() {
  if (!TEST_MODE) {
    const cached = loadFromCache('blitz_availability_cache');
    if (cached) {
      avExceptions = cached.exceptions || [];
      avVersie     = cached.versie || 0;
      renderKalender();
    }
  }
  try {
    const res  = await fetch(AV_API);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    avExceptions = data.exceptions || [];
    avVersie     = data.versie || 0;
    if (!TEST_MODE) saveToCache('blitz_availability_cache', { exceptions: avExceptions, versie: avVersie });
  } catch (e) {
    console.warn('Beschikbaarheid laden mislukt:', e);
    // Let op: bewuste gedragswijziging — bij een fout NIET meer terugvallen naar een lege staat
    // als er al cache-data toegepast werd hierboven; enkel als er ook geen cache was, resetten we
    // (zelfde als het pre-Blok-1D-gedrag in dat specifieke geval).
    if (TEST_MODE || !loadFromCache('blitz_availability_cache')) {
      avExceptions = [];
      avVersie = 0;
    }
  }
  renderKalender();
}
```

- [ ] **Step 3: Zelfde patroon voor `loadAfspraken()` en `loadKlantBeschikbaarheid()`**

Herhaal exact hetzelfde patroon (cache lezen+toepassen+renderen als niet `TEST_MODE`, dan fetch,
op succes cachen+opnieuw toepassen, op fout enkel resetten als er ook geen cache was) voor:
- `loadAfspraken()`: cache-key `'blitz_afspraken_cache'`, vult `localEvents`/`localEventsVersie`,
  roept `renderKalender()` aan (zelfde als `loadAvailability`).
- `loadKlantBeschikbaarheid()`: cache-key `'blitz_klantbeschikbaarheid_cache'`, vult
  `klantBeschikbaarheid`/`kbVersie`. **Deze loader roept vandaag GEEN render-functie aan na het
  laden** (bestaand gedrag, bevestigd in Step 1) — voeg er ook geen aan toe voor de
  cache-toepassing, blijf consistent met het bestaande niet-renderende gedrag; de data wordt
  toch pas gebruikt wanneer iets anders (bv. ticket-detail) opent.

- [ ] **Step 4: `loadTickets()` — cache toevoegen zonder de `TEST_MODE`-dummy-data-tak te raken**

`loadTickets()` heeft al een `TEST_MODE`-tak (regel 742-744, dummy data, 400ms vertraging) — raak
die niet aan. Voeg cache-first enkel toe aan het NIET-test-mode-pad:

```js
async function loadTickets() {
  if (!TEST_MODE) {
    const cached = loadFromCache('blitz_tickets_cache');
    if (cached) {
      applyTicketsData(cached); // zie Step 5 — bestaande apply-logica geëxtraheerd in een functie
    }
  }
  // ... bestaande fetch/TEST_MODE-vertakking (regels 742-754 uit de oude telling) ...
  // na een succesvolle fetch (niet-TEST_MODE pad): saveToCache('blitz_tickets_cache', data);
  // roep dan applyTicketsData(data, { reconcile: true }) aan i.p.v. de bestaande inline logica
  // te herhalen — reconcile:true zorgt dat reconcilePlanning()/gcKlantBeschikbaarheid() enkel
  // op verse fetch-data draaien, nooit op de cache-toepassing hierboven (zie Step 5).
}
```

- [ ] **Step 5: `applyTicketsData(data)` extraheren**

`loadTickets()`'s bestaande logica die `allTickets`/`allPending`/`allGepland`/`planning` vult en
de render-aanroepen doet (regels 752-799 uit de oude telling: `buildPersonSelector()`,
`renderTickets()`, `renderKalender()`, `renderGepland()`, `renderRouteList(...)`,
`updateRouteBtns(...)`, de count-updates, `_lastTicketLoad = Date.now()`) moet uit `loadTickets()`
geknipt worden naar een aparte functie `applyTicketsData(data)`, zodat zowel het cache-toepas-pad
(Step 4) als het fetch-succes-pad dezelfde functie aanroepen i.p.v. logica te dupliceren. **Let
op:** `reconcilePlanning(liveIds)`/`gcKlantBeschikbaarheid(liveIds)` (regels 793-797) zijn bedoeld
om VERSE ticket-ID's te vergelijken met lokale planning-state — roep deze twee NIET aan vanuit het
cache-toepas-pad (enkel vanuit het echte fetch-succes-pad), anders zou verouderde cache-data
planning-entries kunnen opschonen die intussen (in de echte, huidige data) nog wel bestaan. Geef
`applyTicketsData` daarom een tweede parameter `{ reconcile = false } = {}` en roep
`reconcilePlanning`/`gcKlantBeschikbaarheid` enkel aan als `reconcile` `true` is (enkel vanuit het
fetch-succes-pad, niet vanuit het cache-toepas-pad).

- [ ] **Step 6: Verifieer live in de browser**

Start `node dev-server.mjs` (niet-`?test`-modus, zodat de cache-paden echt lopen). Laad de pagina
een eerste keer (geen cache): bevestig dat alles normaal laadt en de cache-keys nu gevuld zijn
(DevTools → Application → Local Storage). Herlaad de pagina: bevestig dat de UI VRIJWEL
onmiddellijk de vorige data toont (vóór de fetch klaar is — dit is met het blote oog moeilijk te
zien bij een snelle lokale server, dus bevestig het via de Network-tab: de render gebeurt niet pas
na de `/api/tickets`-respons), en dat hij daarna correct bijwerkt zodra de echte data binnenkomt.
Simuleer een netwerkfout (DevTools → Network → Offline, dan herlaad): bevestig dat de laatst
gekende cache-data blijft staan i.p.v. dat de UI leeg wordt (de bewuste gedragsverbetering uit
Step 2's "Let op"). Bevestig dat `?test`-modus volledig ongewijzigd blijft werken (dummy data,
geen caching-interferentie).

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: cache-first stale-while-revalidate voor tickets/beschikbaarheid/afspraken/klantbeschikbaarheid (Blok 1D)"
```

---

### Task 13: Volledige live-regressietest van Blok 1D

**Files:** geen (test-only taak)

- [ ] **Step 1: Cache-hit, cache-miss, offline-fallback, TEST_MODE**

Test alle 4 scenario's expliciet na elkaar in dezelfde sessie: (a) eerste bezoek zonder cache
(`localStorage.clear()` eerst), (b) tweede bezoek met cache aanwezig, (c) offline/netwerkfout met
cache aanwezig (moet laatst-gekende data tonen, niet leeg), (d) `?test`-modus (moet ongewijzigd
dummy-data tonen, geen cache-gerelateerd gedrag zichtbaar). Bevestig voor elk scenario dat de
juiste render-aanroepen gebeuren (kalender, tickets-lijst, route-lijst) zonder console-fouten.

- [ ] **Step 2: Commit (enkel als fixes nodig waren)**

---

## Eindcontrole (na alle 13 taken)

- [ ] Doorloop, in dezelfde sessie na elkaar: een voorstel versturen + bevestigen via de nieuwe
  knop (Blok 1A), een beschikbaarheid toevoegen via de nieuwe tab (Blok 1B) en bevestig dat hij in
  de tijdlijn verschijnt (Blok 1C), een volledige paginalaad met en zonder cache (Blok 1D) —
  bevestig dat geen van deze features elkaar stoort.
- [ ] `public/index.html`'s regelaantal mag licht gegroeid zijn (nieuwe functionaliteit, geen
  refactor) — dit is verwacht, geen regressie.
- [ ] Overweeg, net als bij Fase 0, een versiebump volgens de semver-afspraak (`CLAUDE.md`
  "Versioning & changelog") — dit is een MINOR-release (nieuwe, backward-compatible
  functionaliteit), dus `v1.1.0`. Dit gebeurt als aparte, expliciete stap bij het afronden van de
  branch, niet per taak.
