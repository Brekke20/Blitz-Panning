# Etappe 6 — Serverkant (`zoho.js` + `http.js`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `netlify/lib/zoho.js` en `netlify/lib/http.js` bouwen en negen Zoho-functies, vier TomTom-functies en `planning-export` er één voor één op overzetten, met **byte-identieke** uitgaande verzoeken en identieke antwoorden naar de browser.

**Architecture:**
- Per functie eerst karakteriseringstests op de HUIDIGE code (nep-`fetch` die elk uitgaand verzoek volledig opneemt), dan migreren met dezelfde tests ongewijzigd groen.
- Geen nieuwe handler-naad: testen vervangen `globalThis.fetch` en importeren de functie vers (`?v=n`). Enige uitzondering: `send-rapport` krijgt een PDF-naad (Z9).
- `rapport.js` en `setup.js` blijven ongemoeid.

**Tech Stack:** Node ES-modules, `node --test` (Node 24), nep-`fetch`; de bestaande Playwright-suite blijft ongewijzigd.

**Spec:** `docs/superpowers/specs/2026-10-01-etappe6-serverkant-design.md`. Lees §2 (inventaris en bereikbaarheid) en §3 (rulings Z1–Z14) vóór Taak 1.

## Global Constraints

- Werk in de worktree `.claude/worktrees/planner-brein` (tak `refactor`). Prefix elke shell-opdracht met `cd "<worktree>" &&` en controleer vóór elke commit `git branch --show-current` = `refactor`. Nooit committen in de main-checkout. Niet pushen.
- **Gedrag identiek (W5, W11).** Per gemigreerde functie: dezelfde uitgaande verzoeken (URL, methode, headers inclusief `Authorization: Zoho-oauthtoken <token>` en `orgId`, body), dezelfde statuscodes, JSON-vorm, CORS-headers en `error`-teksten. Gevonden eigenaardigheden (spec Z11) worden **niet** gecorrigeerd.
- **Karakterisering eerst (Z8).** Een testbestand mag na zijn eerste commit niet meer inhoudelijk wijzigen tijdens de migratie. Groeit de test (extra scenario), dan enkel toevoegen. Verwachtingen uit de code lezen én met een run bevestigen.
- Nooit echte Zoho-, TomTom- of mailaanroepen: de helper zet `globalThis.fetch` standaard op een functie die gooit (Z12).
- Tests: `node --test` (zonder pad; nooit `node --test tests/`) en `npx playwright test` (ongewijzigd groen; de e2e stubt `/api/*` en raakt de serverkant niet). Nieuwe tests in `tests/server-*.test.mjs`; helper `tests/nep-fetch.mjs`. Bevries tijd met `mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-01T10:00:00.000Z') })` waar `Date.now()`/`new Date()` meespeelt, en zet `process.env.TZ = 'Europe/Brussels'` bovenaan.
- v1/v2-stijl en export-vorm (`handler`, `default`, `config`) blijven. Geen wijziging aan `netlify.toml`, `package.json` (geen `"type": "module"`, geen versie) of `public/`.
- Eén dev-/testserverproces: stop enkel je eigen PID.
- Namen en commentaar in het Nederlands. Commit-trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ledger: `.superpowers/sdd/2026-10-01-etappe6-serverkant/`. Brief en diff als bestand naar subagents; terugmelding maximaal 15 regels.
- Modelkeuze per taak staat bij de taak (W12). Eindreview van de etappe: **sonnet**.

## Review Focus

1. **Authorization-/header-drift**: exact `Authorization: Zoho-oauthtoken ${token}`; de sleutel heet `orgId` (hoofdletter I); `Content-Type: application/json` enkel bij een JSON-body; geen `Content-Type` bij `FormData`-uploads; org-aanvraag enkel met `Authorization`; token-aanvraag met de vier velden in dezelfde volgorde. Vergelijk met de opgenomen `calls` in de karakteriseringstests.
2. **CORS-verschillen tussen functies**: v2-sets (`plan-datum` zonder `Content-Type` in de basisset, `annuleer`/`planning-sinds` mét, ook op 204 en 405-tekst), `confirm-afspraak` met origin-whitelist en `Vary`, v1-sets zonder `Methods`; geen nieuwe OPTIONS/405 bij `route`, `optimize`, `drukte`, `tickets`; 405 als tekst (v2) versus JSON (v1).
3. **Foutstatussen en -teksten**: `Token refresh mislukt` met of zonder data (twee varianten), org-fouttekst per functie (`comment` Engels, `tickets` met "Desk"), 404 `Ticket niet gevonden`, 502 bij `annuleer`/`confirm-afspraak`, 409-paden, `{ error: err.message }` bij 500.
4. **Testmodus-takken**: elke Zoho-functie doet in testmodus nul `fetch`-aanroepen, en de validatie-volgorde (vóór of na de testmodus-tak) is ongewijzigd; `winkelNaam`/`zorgVoorTestkopie` blijven op dezelfde plaats in `annuleer` en `planning-sinds`.
5. **Env-variabelen en cache**: `ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_FROM_EMAIL`, `TOMTOM_API_KEY`, `URL`, `CONFIRM_LINK_SECRET`; gelezen bij elke aanroep; tokencache 55 minuten in de `maakZoho`-instantie (niet in module-scope van `zoho.js`); org-id niet gecachet; `tokenFoutMetData:false` en `orgFoutTekst` correct per functie doorgegeven.

---

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `netlify/lib/zoho.js` (nieuw, Taak 1) | token, org-id, headers, verzoek, `leesJsonVeilig`, `globaleFetch` |
| `netlify/lib/http.js` (nieuw, Taak 1) | CORS-sets en v1/v2-antwoord-, OPTIONS- en methodehulpen |
| `tests/nep-fetch.mjs` (nieuw, Taak 1) | helper: nep-fetch met opname, `laadVers`, `metGlobaleFetch`, `v1Event`, `zetEnv` |
| `tests/server-zoho.test.mjs`, `server-http.test.mjs` (nieuw, Taak 1) | libtests |
| `tests/server-tomtom.test.mjs` (Taak 2) | route, matrix, optimize, drukte |
| `tests/server-tickets.test.mjs` (Taak 3) | tickets, planning-sinds, planning-export |
| `tests/server-plan.test.mjs` (Taak 4) | plan, plan-datum, comment |
| `tests/server-annuleer-confirm.test.mjs` (Taak 5) | annuleer, confirm-afspraak |
| `tests/server-propose.test.mjs` (Taak 6) | propose |
| `tests/server-send-rapport.test.mjs` (Taak 7) | send-rapport |
| `netlify/functions/{route,matrix,optimize,drukte,tickets,planning-sinds,planning-export,plan,plan-datum,comment,annuleer,confirm-afspraak,propose,send-rapport}.js` | migreren |
| `netlify/functions/rapport.js` | enkel een commentaarregel (Taak 8) |
| `CHANGELOG.md`, `CLAUDE.md` | Taak 8 |

## Interfaces (eindtoestand, gedeeld door alle taken)

```js
// netlify/lib/zoho.js
export const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
export const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';
export const globaleFetch  = (...args) => globalThis.fetch(...args);
export function maakZoho({ fetch = globaleFetch, env = process.env, nu = () => Date.now(),
                           tokenFoutMetData = true, orgFoutTekst = 'Zoho org ID niet gevonden' } = {}) -> {
  haalToken(): Promise<string>,
  haalOrgId(token): Promise<string>,
  haalToegang(): Promise<{ token, orgId }>,
  headers(token, orgId?, { json = false } = {}): object,
  verzoek(pad, { token, orgId, methode, json, body, headers } = {}): Promise<Response>,
}
export async function leesJsonVeilig(res): Promise<object>   // {} bij lege of ongeldige body

// netlify/lib/http.js
export function maakCors({ methoden, headers, inhoudType, origin = '*' } = {}): object
export const CORS_V1   // { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } (bevroren)
export function v1Json(statusCode, obj, headers)
export function v1Opties(headers)
export function v1Methode(event, toegestaan, headers)
export function v2Json(status, obj, cors)
export function v2Opties(cors)
export function v2Methode(req, toegestaan, cors)

// tests/nep-fetch.mjs
export function maakNepFetch(router = () => undefined) -> { fn, calls }
  // calls[i] = { url, method, headers, body };  router(url, opts) mag een Response teruggeven; token en /organizations hebben standaardantwoorden
export async function metGlobaleFetch(fn, werk)   // zet en herstelt globalThis.fetch
export async function laadVers(naam)              // import('../netlify/functions/<naam>?v=<teller>')
export function v1Event(methode, body, headers = {})
export function zetEnv(obj) -> herstel()
export function normaliseerBody(body)             // string | URLSearchParams | FormData
```

---

### Task 1: `zoho.js`, `http.js` en de testhelper

**Aanbevolen model:** sonnet (nieuwe lib met precieze byte-regels; test-zwaar)

**Files:**
- Maak: `netlify/lib/zoho.js`, `netlify/lib/http.js`, `tests/nep-fetch.mjs`, `tests/server-zoho.test.mjs`, `tests/server-http.test.mjs`

- [ ] **Step 1: `tests/nep-fetch.mjs`** volgens Interfaces. `maakNepFetch` neemt `{ url: String(url), method: opts.method || 'GET', headers: { ...opts.headers }, body: normaliseerBody(opts.body) }` op; standaardantwoorden: URL met `oauth/v2/token` → `{ access_token: 'TOK' }`, `/organizations` → `{ data: [{ id: 'ORG1' }] }`, anders de router, anders 404 `{}`. `metGlobaleFetch` herstelt in `finally`. Importeer `laadVers` met `pathToFileURL`.
- [ ] **Step 2: Schrijf `tests/server-zoho.test.mjs` (falend).** Gevallen: `haalToken` doet exact één `POST` naar `ZOHO_ACCOUNTS` met header `Content-Type: application/x-www-form-urlencoded` en body `refresh_token=…&client_id=…&client_secret=…&grant_type=refresh_token` (env via `zetEnv`, gelezen bij de aanroep); tweede aanroep binnen 55 minuten doet geen aanvraag; na 55 minuten (via `nu`) wel; **twee instanties halen elk een eigen token** (geen module-state); ontbrekend `access_token`: fouttekst met data (`tokenFoutMetData: true`) en zonder (`false`); `haalOrgId` doet `GET …/organizations` met enkel `{ headers: { Authorization: 'Zoho-oauthtoken TOK' } }` (geen `method`-sleutel), niet gecachet (twee aanroepen = twee aanvragen), fouttekst uit `orgFoutTekst`; `headers()` sleutelvolgorde en voorwaarden (`orgId` enkel indien gegeven, `Content-Type` enkel bij `json`); `verzoek` met `methode: 'PATCH', json: {…}` (body = `JSON.stringify`, headers `Authorization, orgId, Content-Type`), zonder `methode` (geen `method` in de opties), met `body: FormData` (geen `Content-Type`); `leesJsonVeilig` bij lege body, ongeldige JSON, geldige JSON.
- [ ] **Step 3: Schrijf `tests/server-http.test.mjs` (falend).** `CORS_V1` is bevroren en gelijk aan de letterlijke set; `maakCors` sleutelvolgorde en optionele delen, ook de drie bestaande v2-sets exact (zie spec §2.2: `plan-datum`, `annuleer`, `planning-sinds`); `v1Json`/`v1Opties` (geen `body`-sleutel); `v1Methode` (OPTIONS → 204, POST toegestaan → `null`, GET → 405 `{"error":"Method not allowed"}`); `v2Json` (status, `Content-Type` toegevoegd, bestaande `Content-Type` niet verdubbeld), `v2Opties` (204, geen body), `v2Methode` (405-tekst `Method Not Allowed` met de CORS-headers).
- [ ] **Step 4: Run** `node --test` en bevestig dat de nieuwe tests falen om de juiste reden.
- [ ] **Step 5: Implementeer `zoho.js` en `http.js`** volgens spec §4.1 en §4.2 en Interfaces. Lees de huidige `getAccessToken` in `plan.js` en neem de volgorde van de velden en de teksten letterlijk over.
- [ ] **Step 6: Run** `node --test`: alles groen (200 bestaande + nieuwe). Run `npx playwright test`: ongewijzigd groen.
- [ ] **Step 7: Commit** `feat(server): zoho.js en http.js met testhelper (etappe 6, taak 1)`.

---

### Task 2: TomTom-functies (`route`, `matrix`, `optimize`, `drukte`) — enkel `http.js`

**Aanbevolen model:** sonnet (veel testscenario's; migratie is mechanisch maar moet bewezen worden)

**Files:**
- Maak: `tests/server-tomtom.test.mjs`
- Wijzig: `netlify/functions/route.js`, `matrix.js`, `optimize.js`, `drukte.js`

**Interfaces:** `CORS_V1`, `v1Json`, `v1Opties`, `v1Methode` uit `http.js`. Geen Zoho. `TOMTOM_API_KEY` blijft `process.env.TOMTOM_API_KEY` bij elke aanroep.

- [ ] **Step 1: Karakteriseringstests op de ONGEWIJZIGDE code.** Per functie, met `TOMTOM_API_KEY='KEY'`, `metGlobaleFetch`, `laadVers`:
  - `route`: OPTIONS → 204 met `CORS_V1`; **GET zonder body → 400** `Need at least 2 waypoints` (geen 405: er is geen methodecontrole); succes: exacte URL (`…/calculateRoute/<lat,lon:lat,lon>/json?key=KEY&travelMode=car&traffic=true&routeType=fastest&computeTravelTimeFor=all&sectionType=traffic&report=effectiveSettings`), met geldige toekomstige `departAt` (tijd bevriezen) komt `&departAt=<encodeURIComponent>` erbij, met ongeldige of verleden `departAt` niet en is `departAtUsed` `null`; volledige antwoordvorm (legs, sections, polyline); 429 dan 200: twee identieke aanvragen en daarna succes (echte backoff van 400 ms); geen route → 500 `No route returned from TomTom`.
  - `matrix`: OPTIONS; GET → 405 JSON `Method not allowed`; 400 `origin en destinations zijn verplicht`; succes: `POST https://api.tomtom.com/routing/matrix/2?key=KEY`, headers `{ 'Content-Type': 'application/json' }`, exacte body (`departAt: 'any'` als niet gegeven, `traffic: 'historical'`, `travelMode: 'car'`); terugmappen op `destinationIndex` inclusief een ontbrekende cel → `null`; `!res.ok` → 500 met `error.description` of `TomTom Matrix-fout (<status>)`.
  - `optimize`: OPTIONS; 400 `Missing origin or stops`; geocode-URL exact (`…/search/2/geocode/<encodeURIComponent>.json?key=KEY&countrySet=BE,NL,LU,FR,DE`); vertrekpunt onvindbaar → het bestaande 400-pad; één onvindbare stop blijft tolerant; waypoint-optimalisatie `POST …/routing/waypointoptimization/1?key=KEY` met exacte body (`options.departAt` is `new Date().toISOString()`: tijd bevriezen); de twee `geocodeOnly`-terugvalpaden (niet-ok antwoord, ongeldige permutatie); succesvorm `{ optimizedOrder, locations, rawResponse }`.
  - `drukte`: OPTIONS; 400 bij ongeldige polyline; 400 `departAt moet in de toekomst liggen`; 2-punts-polyline: eerst `POST` met `supportingPoints`, bij weigering (400) daarna `GET` op dezelfde URL, `aantalAanvragen` klopt en `reconstructie` is `false`; succesvorm van `segmenten`.
  Lees voor elke verwachting eerst de code. Bevestig groen op de ongewijzigde code.
- [ ] **Step 2: Commit** `test(server): karakterisering route, matrix, optimize, drukte`.
- [ ] **Step 3: Migreer** (Z7): in elk bestand `const headers = {…}` → `const headers = CORS_V1`; `if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers }` → `return v1Opties(headers)`; bij `matrix` het OPTIONS+405-blok → `const gate = v1Methode(event, ['POST'], headers); if (gate) return gate;`; elke `return { statusCode: S, headers, body: JSON.stringify(X) }` → `return v1Json(S, X, headers)`. **Voeg nergens een 405 of OPTIONS toe** bij `route`, `optimize`, `drukte`. De TomTom-retrylogica, URL's en `sleep` blijven letterlijk staan.
- [ ] **Step 4: Run dezelfde tests ongewijzigd groen**, daarna `node --test` en `npx playwright test` volledig groen.
- [ ] **Step 5: Commit** `refactor(server): TomTom-functies op http.js (etappe 6, taak 2)`.

---

### Task 3: Zoho lezen — `tickets`, `planning-sinds`, en `planning-export` (enkel `http.js`)

**Aanbevolen model:** sonnet (paginering, batches, twee varianten foutteksten)

**Files:**
- Maak: `tests/server-tickets.test.mjs`
- Wijzig: `netlify/functions/tickets.js`, `planning-sinds.js`, `planning-export.js`

**Interfaces:** `maakZoho` en `leesJsonVeilig` uit `zoho.js`. `tickets`: `maakZoho({ orgFoutTekst: 'Zoho Desk org ID niet gevonden' })`, instantie op moduleniveau. `planning-sinds`: `maakZoho({ fetch: doFetch, tokenFoutMetData: false })` binnen `maakHandler` (cache blijft per handler-instantie). `planning-export`: `CORS_V1`, `v1Opties`, `v1Json`.

- [ ] **Step 1: Karakteriseringstests op de ONGEWIJZIGDE code.**
  - `tickets` (v1, **geen** OPTIONS, **geen** methodecontrole): volledige reeks aanvragen in volgorde: token, `/organizations`, `agents?limit=50` met headers `{ Authorization, orgId }`, `tickets?limit=100&from=0`, daarna `tickets/<id>` per relevant ticket in batches van vijf; vroege stop na twee lege relevante pagina's; `mapTicket`-vorm (inclusief `regio` met `-Geen-`); pagina-fout → 500 `Zoho tickets-ophalen mislukt (<status>): {…}`; ticketdetail-fout; token-fout met data; org-fout `Zoho Desk org ID niet gevonden`; antwoordheaders `CORS_V1`; een `OPTIONS`-event wordt **niet** speciaal behandeld (loopt gewoon door naar Zoho: vastleggen).
  - `planning-sinds` (via `maakHandler({ getStore: nepStore, fetch })`, v2): OPTIONS 204 (met `Content-Type` in de headers), GET → 405 tekst, ongeldige JSON → 400, testmodus → 200 `{ sinds: {} }` met nul aanvragen, historie-aanvraag exact (`tickets/<id>/History?fieldName=status&limit=50&from=1`, headers `{ Authorization, orgId }`), `tickets/<id>` voor `createdTime` enkel als nodig, token-fout → alle `sinds` `null` (en `Token refresh mislukt` zonder data in de log), register-schrijven met nep-store.
  - `planning-export`: OPTIONS, niet-GET → 405 JSON, geen sleutel → 401, juiste `Bearer` met `PLANNING_EXPORT_API_KEY`: de drie aanvragen naar `<basis>/api/tickets`, `/api/klantbeschikbaarheid`, `/api/afspraken` (basis uit `host`, `http` bij `localhost`), antwoordvorm en sortering, fout → 500.
  Bevestig groen op de ongewijzigde code.
- [ ] **Step 2: Commit** `test(server): karakterisering tickets, planning-sinds, planning-export`.
- [ ] **Step 3: Migreer.** `tickets`: token/org/`safeJson` en de vier `Zoho-oauthtoken`-headers via `maakZoho`/`leesJsonVeilig` (`zoho.verzoek('/agents?limit=50', { token, orgId })` enzovoort; **de URL-strings en volgorde blijven gelijk**); `headers = CORS_V1`; geen OPTIONS toevoegen. `planning-sinds`: `getAccessToken`/org-blok vervangen door `zoho.haalToegang()` binnen dezelfde `try`; de `headers`-variabele voor `zoekSinds` wordt `zoho.headers(token, orgId)`; eigen `CORS`/`json`-helpers blijven (v2 met `Content-Type` op alles) tenzij `maakCors`/`v2Json` **exact** dezelfde uitvoer geven (de test beslist). `planning-export`: enkel `http.js`.
- [ ] **Step 4: Run dezelfde tests ongewijzigd groen**, daarna `node --test` en `npx playwright test` volledig groen.
- [ ] **Step 5: Commit** `refactor(server): tickets, planning-sinds, planning-export op zoho.js/http.js (etappe 6, taak 3)`.

---

### Task 4: Zoho schrijven, klein — `plan`, `plan-datum`, `comment`

**Aanbevolen model:** sonnet (statusschrijvers, W11; drie fouttekstvarianten)

**Files:**
- Maak: `tests/server-plan.test.mjs`
- Wijzig: `netlify/functions/plan.js`, `plan-datum.js`, `comment.js`

**Interfaces:** `plan`: `maakZoho()` (moduleniveau), `CORS_V1`, `v1Json`, `v1Methode`. `comment`: idem met `orgFoutTekst: 'Could not find Zoho Desk org ID'`. `plan-datum` (v2): `maakZoho()`, `maakCors({ methoden: 'POST, OPTIONS', headers: 'Content-Type' })`, `v2Json`, `v2Opties`, `v2Methode`.

- [ ] **Step 1: Karakteriseringstests op de ONGEWIJZIGDE code.** Per functie: OPTIONS (204 en headers), verkeerde methode (JSON-405 bij `plan`/`comment`, **tekst**-405 bij `plan-datum`), validatiefouten met exacte teksten (`plan`: `ticketId verplicht`, `Ongeldig ticketId`; `comment`: `ticketId and content required`, `Invalid ticketId`; `plan-datum`: `Ongeldige JSON`, `ticketId en utcInterventieDatum zijn verplicht`, `Ongeldig ticketId`), **testmodus met nul aanvragen** en exact antwoord (`{ok:true,test:true,success:true,ticketId,date}`, enz.), en het echte pad met alle aanvragen volledig opgenomen:
  - `plan` met datum: token, org, `PATCH …/tickets/<id>` met headers `{ Authorization, orgId, 'Content-Type' }` en body `{"status":"Wachten op bevestiging planning","cf":{"cf_interventie_datm":"<utc>"}}` (en de `T00:00:00.000Z`-terugval zonder `utcInterventieDatum`); zonder datum: `{"status":"Wachten op planning","cf":{"cf_interventie_datm":""}}`; lege PATCH-body (204) is succes; PATCH-fout → 500 `Zoho fout (<status>): {…}`.
  - `plan-datum`: PATCH-body `{"cf":{"cf_interventie_datm":"<utc>"}}`; fout → 500 `Zoho PATCH fout (<status>): <ruwe tekst>`; antwoord `{ok:true,interventieDatum}`.
  - `comment`: PATCH-body `{"resolution":"<getrimde tekst>"}`; fout → 500 met `JSON.stringify(patchData)`; antwoord `{success:true}`.
  - Voor alle drie: token-fout met data (`Token refresh mislukt: {…}`), org zonder id (eigen fouttekst per functie), en dat een tweede aanroep binnen dezelfde import het token hergebruikt (nul extra tokenaanvragen) terwijl het org-id opnieuw wordt opgehaald.
  Bevestig groen op de ongewijzigde code.
- [ ] **Step 2: Commit** `test(server): karakterisering plan, plan-datum, comment`.
- [ ] **Step 3: Migreer** de drie bestanden: eigen `getAccessToken`, `cachedToken`, `tokenExpiry`, `ZOHO_*`-constanten en het inline org-blok weg; `const zoho = maakZoho(…)` op moduleniveau; `const { token, orgId } = await zoho.haalToegang()`; PATCH via `zoho.verzoek('/tickets/<id>', { token, orgId, methode: 'PATCH', json: patch })`. Foutteksten en `patchData`-lezing blijven letterlijk bij de handler (`leesJsonVeilig` enkel bij `plan`, waar het exact dezelfde lenient-parse is). CORS en antwoorden via `http.js` (bij `plan-datum` beslist de test of `maakCors` exact dezelfde headers geeft).
- [ ] **Step 4: Run dezelfde tests ongewijzigd groen**, daarna `node --test` en `npx playwright test` volledig groen.
- [ ] **Step 5: Commit** `refactor(server): plan, plan-datum, comment op zoho.js/http.js (etappe 6, taak 4)`.

---

### Task 5: `annuleer` en `confirm-afspraak`

**Aanbevolen model:** sonnet (klantmails, HTML-antwoorden, bestaande testdekking uitbreiden)

**Files:**
- Maak: `tests/server-annuleer-confirm.test.mjs`
- Wijzig: `netlify/functions/annuleer.js`, `confirm-afspraak.js`

**Interfaces:** `annuleer`: binnen `maakHandler`: `const zoho = maakZoho({ fetch: doFetch, tokenFoutMetData: false })`; `CORS`/`json` via `maakCors({ methoden: 'GET, POST, OPTIONS', headers: 'Content-Type, X-Blitz-Test', inhoudType: 'application/json' })` en `v2Json`/`v2Opties`, **enkel als de test dezelfde headers bevestigt**. `confirm-afspraak`: `maakZoho()` op moduleniveau; eigen `corsHeaders`/`htmlPage` blijven (Z10).

- [ ] **Step 1: Karakteriseringstests op de ONGEWIJZIGDE code.** Bestaande `tests/annulatie.test.mjs` blijft staan; dit bestand voegt **volledige opname** toe.
  - `annuleer` (met `maakHandler({ getStore: nepWinkels, fetch })`, `ZOHO_FROM_EMAIL` gezet): volledige headers van OPTIONS, GET en 405-tekst (met `Content-Type` en `X-Blitz-Test`); echt pad `mailKlant: true` met klant- en installateursadres: volgorde van aanvragen (token, org, ticket-GET, per ontvanger `sendReply` met exacte body en `Authorization`/`orgId`/`Content-Type`, dan PATCH `{status:'Wachten op planning',cf:{cf_interventie_datm:''}}`, dan `comments` met `{content,isPublic:false}`); 404/502/409-paden met exacte antwoorden; PATCH-fout → 502 `Zoho PATCH fout (<status>)`; token-fout → 500 `Token refresh mislukt` (zonder data); org-fout. Tijd bevriezen (de notitie bevat `tijdstipNu()`).
  - `confirm-afspraak` (met `laadVers`, `CONFIRM_LINK_SECRET` gezet, geldige link via `tekenLink`, `delete process.env.NETLIFY_BLOBS_CONTEXT`): CORS-origin-whitelist (`Origin` bekend en onbekend) met `Vary`; GET toont de pagina zonder enige aanvraag; POST-formulier met geldige handtekening: aanvragen in volgorde (token, org, ticket-GET `{Authorization, orgId}`, PATCH `{"status":"Geplande support"}` met `Content-Type`, `comments`); 409 bij verkeerde status of datum; 502 bij PATCH-fout; 500 bij token-fout; ongeldige link → 400 en nul aanvragen; Blobs-registratie faalt zonder omgeving: antwoord blijft 200 en `console.error` is aangeroepen; HTML-antwoorden bevatten de bestaande titels.
  Bevestig groen op de ongewijzigde code.
- [ ] **Step 2: Commit** `test(server): karakterisering annuleer en confirm-afspraak`.
- [ ] **Step 3: Migreer.** `annuleer`: eigen `getAccessToken` en de inline org-opzoeking weg (`zoho.haalToegang()` binnen dezelfde `try`), `addZohoComment` en alle `Authorization`-literals via `zoho.verzoek`/`zoho.headers`. `confirm-afspraak`: eigen `getAccessToken` en `getOrgId` weg, `addZohoComment` en de twee ticket-aanvragen via `zoho`. `corsHeaders` en HTML blijven. De volgorde van aanvragen, de lenient `.catch(() => '')`-teksten en de 409/502/500-takken blijven letterlijk.
- [ ] **Step 4: Run dezelfde tests ongewijzigd groen** (inclusief `tests/annulatie.test.mjs`), daarna `node --test` en `npx playwright test` volledig groen.
- [ ] **Step 5: Commit** `refactor(server): annuleer en confirm-afspraak op zoho.js (etappe 6, taak 5)`.

---

### Task 6: `propose` (mails naar klant en installateur)

**Aanbevolen model:** sonnet (gevoeligste pad: statusschrijf én klantmail; grootste bestand)

**Files:**
- Maak: `tests/server-propose.test.mjs`
- Wijzig: `netlify/functions/propose.js`

**Interfaces:** `maakZoho()` op moduleniveau; `CORS_V1`, `v1Json`, `v1Methode`. `uploadTermsAttachment(accessToken, orgId)` blijft een lokale functie, maar zijn aanvraag (`POST /uploads`, `FormData`, headers `{ Authorization, orgId }` zonder `Content-Type`) loopt via `zoho.verzoek('/uploads', { token, orgId, methode: 'POST', body: formData })`.

- [ ] **Step 1: Karakteriseringstests op de ONGEWIJZIGDE code.** Zet `CONFIRM_LINK_SECRET`, `URL`, `TZ=Europe/Brussels`, bevries de tijd (de link-`exp` en de datumopmaak hangen eraan), gebruik de echte `assets/service-voorwaarden.pdf` (de upload wordt genormaliseerd naar `[['file','Service Voorwaarden Blitz Power.pdf','application/pdf', <grootte>]]`). Scenario's:
  - OPTIONS, 405 JSON, 400 (`ticketId en date zijn verplicht`, `Ongeldig ticketId`), **testmodus met nul aanvragen** en exact antwoord (`appointmentTime` afgerond naar het volgende kwartier, `interventieDatum`-terugval).
  - Echt pad met `ZOHO_FROM_EMAIL` gezet: volgorde token, org, ticket-GET, dan **per ontvanger** upload gevolgd door `sendReply` met exacte body (`channel`, `contentType`, `content` = volledige mail-HTML met de bevestigingslink, `fromEmailAddress`, `to`, `attachmentIds`), daarna één PATCH `{"status":"Wachten op bevestiging planning","cf":{"cf_interventie_datm":"<utc>"}}` met headers `{ Authorization, orgId, 'Content-Type' }`. Ontvangers ontdubbeld op adres (contact = klant), alleen contact, alle drie.
  - Zonder `ZOHO_FROM_EMAIL`: extra `GET …/emailAddresses?limit=50`; geen adres → 500 met de bestaande tekst.
  - Ticket niet gevonden → 404 `Ticket niet gevonden`; `Empty Recipients` is een zachte fout (`emailSent` blijft `false`, PATCH gebeurt toch); harde `sendReply`-fout bij ontvanger 2 komt in `fouten` terecht en de PATCH gebeurt toch; PATCH-fout → 500 `Zoho PATCH fout (<status>): {…}`; token-fout met data; org-fout.
  - Zonder `CONFIRM_LINK_SECRET`: mail zonder bevestigingsknop, rest ongewijzigd.
  Bevestig groen op de ongewijzigde code.
- [ ] **Step 2: Commit** `test(server): karakterisering propose`.
- [ ] **Step 3: Migreer**: `getAccessToken` en `ZOHO_*` weg; org-blok → `zoho.haalToegang()` (vervangt de token-aanroep én de org-aanvraag op dezelfde plaats in de `try`, vóór de ticket-GET); alle `Authorization`-literals via `zoho.verzoek`/`zoho.headers`; `patchText`-parse → `leesJsonVeilig` (letterlijk dezelfde lenient-parse; `sendReply`-parse idem). `buildEmailHtml`, `roundToNextQuarter`, ontvangersopbouw, link-aanmaak en de `catch`/`fouten`-logica blijven **ongemoeid**.
- [ ] **Step 4: Run dezelfde tests ongewijzigd groen**, daarna `node --test` en `npx playwright test` volledig groen.
- [ ] **Step 5: Commit** `refactor(server): propose op zoho.js/http.js (etappe 6, taak 6)`.

---

### Task 7: `send-rapport` (PDF-naad, dan karakterisering, dan migratie)

**Aanbevolen model:** sonnet (naad plus mailpad; geen haiku)

**Files:**
- Maak: `tests/server-send-rapport.test.mjs`
- Wijzig: `netlify/functions/send-rapport.js`

**Interfaces:** `export function maakHandler({ fetch = globaleFetch, maakPdf = standaardPdf } = {})`, `export const handler = maakHandler()`. `async function standaardPdf(html)` geeft de `pdfBuffer` terug. Daarna `maakZoho({ fetch })` binnen `maakHandler`.

- [ ] **Step 1: Naad (Z9), geen gedragswijziging.** Verplaats het blok `chromium.executablePath(…)` t/m `await browser.close(); browser = null;` **letterlijk** naar `standaardPdf(html)` (met zijn eigen `try/finally` die de browser sluit bij een fout), laat de handler `const pdfBuffer = await maakPdf(html)` aanroepen, verwijder `browser` uit de handler-`catch`, en wikkel de handler in `maakHandler`. Imports van `puppeteer-core` en `chromium` blijven bovenaan. Run `node --test` en `npx playwright test`; commit apart: `refactor(server): send-rapport PDF-naad (geen gedragswijziging)`. In de commit-boodschap staat dat de diff enkel verplaatsing is.
- [ ] **Step 2: Karakteriseringstests** (met `maakHandler({ fetch, maakPdf: async () => Buffer.from('PDF') })`, `ZOHO_FROM_EMAIL` gezet): OPTIONS, 405 JSON, 400 (`ticketId en html zijn verplicht`, `Ongeldig ticketId`); testmodus (preview en echt) met nul aanvragen en exact antwoord; `preview: true` echte opzoeking (token, org, ticket-GET) zonder uploads of `sendReply`, met `buildRapportEmailHtml`-uitvoer per ontvanger; ticket niet gevonden → 404; geen e-mailadres → 400 met exacte tekst; **verzendpad**: per ontvanger `POST /uploads` (genormaliseerde `FormData`: bestandsnaam `service-rapport-<ticketNumber|ticketId>.pdf`, headers `{ Authorization, orgId }`), `sendReply` met exacte body (`attachmentIds: [<upload-id>]`), daarna PATCH `{"status":"Gesloten - ov"}` met `Content-Type` enkel als minstens één mail verstuurd is; `Empty Recipients` is zacht; PDF-fout (`maakPdf` gooit) → 500 met die tekst; PATCH-fout → 200 met `statusFout`; zonder `ZOHO_FROM_EMAIL` extra `emailAddresses`-aanvraag en bestaande fouttekst; token- en org-fout.
- [ ] **Step 3: Run groen** op de code mét naad en commit `test(server): karakterisering send-rapport`.
- [ ] **Step 4: Migreer**: `getAccessToken`, `getOrgId` en `ZOHO_*` weg (`zoho.haalToegang()` op de plaats van de twee aanroepen), alle `Authorization`-literals via `zoho.verzoek`/`zoho.headers`, `CORS_V1`/`v1Json`/`v1Methode`; `leesJsonVeilig` voor de `replyText`- en `patchText`-parses. `buildRapportEmailHtml` ongemoeid.
- [ ] **Step 5: Run dezelfde tests ongewijzigd groen**, daarna `node --test` en `npx playwright test` volledig groen.
- [ ] **Step 6: Commit** `refactor(server): send-rapport op zoho.js/http.js (etappe 6, taak 7)`.

---

### Task 8: Afronding, documentatie en etappe-controle

**Aanbevolen model:** haiku (mechanisch met volledige instructie; de reviewer-subagent van de etappe draait daarna op sonnet)

**Files:**
- Wijzig: `netlify/functions/rapport.js` (enkel commentaar), `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Controle op resterende kopieën.** Run `grep -n "ZOHO_ACCOUNTS\|getAccessToken\|Zoho-oauthtoken" netlify/functions/*.js`. Verwacht: enkel `rapport.js` (bewust, Z3) en `setup.js` (eigen grant-code-uitwisseling). Elke andere treffer is een gemiste migratie: meld ze en pas niets aan zonder terugkoppeling.
- [ ] **Step 2: `rapport.js`.** Voeg boven `getAccessToken` één commentaarregel toe: `// Bewust nog een eigen kopie (etappe 6, Z3): Chromium en het Blobs-register zijn zonder naden onbereikbaar voor tests. Zie netlify/lib/zoho.js.` Geen andere wijziging.
- [ ] **Step 3: `CHANGELOG.md`.** Onder de sectie "Refactor-tak — nog niet uitgebracht" één regel onder **Changed**: interne serverstructuur vernieuwd (gedeelde `zoho.js` en `http.js`, 13 functies overgezet, identiek gedrag, nieuwe tests). Eén regel onder een kopje "Bekend, ongewijzigd" met de vijf eigenaardigheden van spec Z11.
- [ ] **Step 4: `CLAUDE.md`.** Korte sectie "Serverkant": gebruik `netlify/lib/zoho.js` en `http.js` voor elke nieuwe Zoho- of TomTom-functie; testconventie (`tests/nep-fetch.mjs`, `laadVers`, `metGlobaleFetch`, karakterisering eerst); `rapport.js` en `setup.js` zijn de uitzonderingen. Verhoog het aantal unit-tests in "Tests" naar het werkelijke aantal.
- [ ] **Step 5: Volledige controle.** `node --test` (zonder pad) groen, `npx playwright test` groen, `git status` schoon, `git branch --show-current` = `refactor`.
- [ ] **Step 6: Commit** `docs(server): etappe 6 afgerond, changelog en conventies`. Daarna etappe-eindreview (sonnet) met de Review Focus en `git diff f346f71..HEAD -- netlify tests` als bestand.
