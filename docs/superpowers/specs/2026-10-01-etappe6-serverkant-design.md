# Etappe 6 — Serverkant (`netlify/lib/zoho.js` + `http.js`) — design

Datum: 2026-10-01 · Opdrachtgever: Brent Calaerts · Tak: `refactor` · Basis: roadmap `2026-10-01-refactor-roadmap-design.md` (W1–W12, §3 Serverkant), 200 unit-tests groen

## 1. Doel

De tien gedupliceerde Zoho-blokken (token, org-id, headers) en de ~14 inline CORS-/antwoordblokken in `netlify/functions/` vervangen door twee gedeelde modules:

- `netlify/lib/zoho.js`: token vernieuwen, org-id opzoeken, verzoek-headers en een verzoek-helper.
- `netlify/lib/http.js`: CORS-sets, JSON-antwoorden, methodecontrole en OPTIONS, voor v1- en v2-handlers.

Het enige resultaat is **minder duplicatie met identiek gedrag** (W5). Het Zoho-verkeer is het gevoeligste verkeer van de app (statussen, datums, mails naar klanten, W11) en de e2e-suite stubt `/api/*` volledig, dus ze beschermt de serverkant **niet**. Daarom geldt per functie: **eerst karakteriseringstests op de HUIDIGE code, pas daarna migreren, met dezelfde tests ongewijzigd groen.**

Buiten scope: gedrag wijzigen, nieuwe endpoints, v1/v2-stijl wijzigen, de upgrade van `@netlify/blobs`, de frontend, `rapport.js` (Z3).

## 2. Uitgangspunten (geverifieerd in de code, 2026-10-01)

### 2.1 Inventaris Zoho-kopieën

Tien functies hebben een eigen `getAccessToken` (zelfde env-variabelen en accounts-URL): `plan`, `plan-datum`, `comment`, `tickets`, `planning-sinds`, `annuleer`, `confirm-afspraak`, `propose`, `send-rapport`, `rapport`. De org-id-opzoeking (`GET /organizations`, `data[0].id`, **elke aanroep opnieuw, niet gecachet**) staat er ook tien keer, maar de teksten verschillen:

| Onderdeel | Variant A | Variant B |
|---|---|---|
| Fout bij token | `'Token refresh mislukt: ' + JSON.stringify(data)` (8 functies) | `'Token refresh mislukt'` zonder data (`annuleer`, `planning-sinds`) |
| Fout bij org-id | `'Zoho org ID niet gevonden'` (8) | `comment`: `'Could not find Zoho Desk org ID'`; `tickets`: `'Zoho Desk org ID niet gevonden'` |
| Tokencache (55 min) | op moduleniveau (8) | per handler-instantie via `maakHandler` (`annuleer`, `planning-sinds`) |

Die foutteksten bereiken de browser via `{ error: err.message }`, dus ze zijn onderdeel van het gedrag (Z4).

### 2.2 Inventaris CORS en antwoorden

| Functie | Stijl | Headers | OPTIONS | Methodecontrole |
|---|---|---|---|---|
| `plan`, `comment`, `propose`, `send-rapport`, `rapport`, `matrix` | v1 | `{ACAO:'*', Content-Type:json}` | 204 | niet-POST → 405 JSON `{error:'Method not allowed'}` |
| `route`, `optimize`, `drukte` | v1 | idem | 204 | **geen** |
| `tickets` | v1 | idem | **geen** | **geen** |
| `planning-export` | v1 | idem | 204 | niet-GET → 405 JSON, daarna 401 |
| `plan-datum` | v2 | `{ACAO, Methods:'POST, OPTIONS', Headers:'Content-Type'}`, `Content-Type` pas per antwoord | 204 | 405 **tekst** `'Method Not Allowed'` |
| `annuleer` | v2 | `{ACAO, Methods:'GET, POST, OPTIONS', Headers:'Content-Type, X-Blitz-Test', Content-Type}`, ook op 204 en 405-tekst | 204 | GET apart, rest 405 tekst |
| `planning-sinds` | v2 | idem, `Methods:'POST, OPTIONS'` | 204 | 405 tekst |
| `confirm-afspraak` | v2 | **origin-whitelist** + `Vary: Origin`, antwoord is HTML | 204 | GET/POST, rest 405 tekst |

### 2.3 Bereikbaarheid voor unit-tests (feasibility, verplicht)

- Alle Zoho- en TomTom-aanroepen in de v1-handlers en in de v2-handlers met moduleniveau-cache gebruiken het **kale** `fetch`. Een vrije identifier wordt bij elke aanroep opgelost op `globalThis.fetch`, dus een test kan `globalThis.fetch` vervangen. **Gecontroleerd met een proef**: `plan.js` twee keer geïmporteerd als `plan.js?v=1` en `?v=2`, met een nep-`fetch`: elke verse import doet opnieuw een tokenaanvraag (cache op moduleniveau is dus per import vers). Daarmee zijn de **huidige** handlers testbaar zónder wijziging.
- `annuleer` en `planning-sinds` hebben al `maakHandler({getStore, fetch})`; `annuleer` heeft al endpointtests (`tests/annulatie.test.mjs`), maar die leggen headers en Authorization **niet** vast. `planning-sinds` heeft enkel libtests.
- `send-rapport` en `rapport` importeren `puppeteer-core` en `@sparticuz/chromium-min` op het hoogste niveau (laden lukt in node, gecontroleerd). Alles **vóór** `chromium.executablePath` is bereikbaar. Het verzendpad **erna** (upload, `sendReply`, PATCH `Gesloten - ov`, de mails naar klanten) is **onbereikbaar** zonder naad voor het PDF-maken. `send-rapport` krijgt daarom één kleine naad (Z9). `rapport` is bovendien Blobs-zwaar (`checkAlUpgeload`, reservering) en blijft ongemoeid (Z3).
- `confirm-afspraak` gebruikt `getStore` rechtstreeks, maar enkel in een `try/catch` na de Zoho-verwerking: zonder Blobs-omgeving faalt dat, wordt gelogd en blijft het antwoord 200. Dat is testbaar (en wordt vastgelegd), een nep-store is niet nodig.
- `propose` leest `assets/service-voorwaarden.pdf` met `fs` (bestaat in de repo) en gebruikt `Date.now()` en `process.env.URL`/`CONFIRM_LINK_SECRET` voor de link: tijd bevriezen met `mock.timers` en env zetten volstaat.

Conclusie: **geen enkele functie heeft een nieuwe naad nodig om te karakteriseren, behalve `send-rapport` (PDF-naad)**. `rapport.js` valt buiten de etappe.

## 3. Rulings

| # | Onderwerp | Beslissing | Reden |
|---|---|---|---|
| Z1 | Scope | Negen Zoho-functies (`plan`, `plan-datum`, `comment`, `tickets`, `planning-sinds`, `annuleer`, `confirm-afspraak`, `propose`, `send-rapport`), vier TomTom-functies (`route`, `matrix`, `optimize`, `drukte`) en `planning-export` (enkel `http.js`). **Niet**: `rapport` (Z3), `setup` (eenmalige grant-code-uitwisseling, ander verzoek, geen cache), en de Blobs-only functies (`afspraken`, `availability`, `client-log`, `fotos`, `inventaris`, `klantbeschikbaarheid`, `prijzen`, `rapport-archief`, `rapport-verzonden`, `voorstel-status`, `testdata`): geen Zoho of TomTom, en hun origin-whitelist-`corsHeaders` (8 kopieën) is een apart backlog-item. | Roadmap §3 vraagt Zoho en `http.js`; proportioneel houden. |
| Z2 | Testconventie (de gekozen "naad") | **Geen nieuwe handler-naad voor de Zoho/TomTom-functies.** Libs krijgen een injecteerbare `fetch` (`maakZoho({fetch})`); handlers geven `globaleFetch` door, een lazy `(...a) => globalThis.fetch(...a)`. Handlertests vervangen `globalThis.fetch` (helper `metGlobaleFetch`) en importeren de functie vers (`laadVers`, query `?v=n`). Bestaande `maakHandler({getStore, fetch})` blijft en geeft `fetch: doFetch` door aan `maakZoho`. | Dezelfde testbestanden draaien vóór en ná de migratie **ongewijzigd**: dat is het bewijs van identiek gedrag. Geen wijziging aan wat Netlify ziet (`handler`/`default`-export). Per-import verse tokencache. Een `let doFetch`-setter zou een testhaak in productiecode zetten die niets oplevert. |
| Z3 | `rapport.js` | Blijft volledig ongemoeid, inclusief zijn eigen `getAccessToken`/`getOrgId`. Wordt de enige resterende kopie, met een commentaarregel die naar `zoho.js` verwijst. | Chromium en Blobs-register zijn onbereikbaar zonder naden; de rapportwizard is W11-gevoelig; winst (2 kopieën) weegt niet op tegen risico. Roadmap-richtlijn: "ongemoeid tenzij triviaal veilig". |
| Z4 | Foutteksten | Het verzoek-helper-gedeelte van `zoho.js` levert **headers + URL + de ruwe `Response`**. Foutteksten per aanroep (`Zoho fout (…)`, `Zoho PATCH fout (…)`, `sendReply fout …`) blijven bij de aanroeper. Teksten die wél gedeeld zijn, worden opties: `tokenFoutMetData` (default `true`) en `orgFoutTekst` (default `'Zoho org ID niet gevonden'`). `leesJsonVeilig(res)` vervangt enkel plekken waar de bestaande code letterlijk hetzelfde doet (tekst → `JSON.parse` → `{}` bij leeg of ongeldig: `plan`, `propose`, `send-rapport`, `tickets`). | De foutteksten bereiken de browser (toast). Eén gelijkgetrokken tekst is een zichtbare gedragswijziging (W5). |
| Z5 | Stijl | v1 blijft v1, v2 blijft v2; de export-vorm (`export async function handler` / `export default`) en `export const config` blijven. | Opdracht. |
| Z6 | Tokencache en org | Token: 55 minuten, **in de `maakZoho`-instantie** (nooit in module-scope van `zoho.js`): een handler maakt zijn instantie één keer op moduleniveau (v1 en v2 zonder `maakHandler`) of binnen `maakHandler` (zoals nu). Org-id: **niet** gecachet, elke aanroep van `haalOrgId` doet de aanvraag, zoals nu. Env-variabelen worden **bij elke aanroep** gelezen (`env.ZOHO_REFRESH_TOKEN`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`), niet bij het laden. | Identiek aan nu; tests kunnen env wisselen. Geen extra cross-invocation-cache (opdracht). |
| Z7 | `http.js` | CORS-sets worden **letterlijk** zoals nu vastgelegd (bevroren constanten of `maakCors({...})` met dezelfde sleutelvolgorde). Er komt **geen** nieuwe 405 of OPTIONS-afhandeling bij functies die die nu niet hebben (`route`, `optimize`, `drukte`, `tickets`). `v1Methode`/`v2Methode` zijn optioneel aan te roepen. `plan-datum` houdt zijn 405-**tekst**, `annuleer`/`planning-sinds` houden `Content-Type` op 204 en 405. | W5/W11. |
| Z8 | Volgorde per functie | (a) karakteriseringstests op de huidige code, groen, eigen commit `test(server): …`; (b) migratie, **dezelfde tests ongewijzigd groen**, commit `refactor(server): …`. Verwachtingen worden uit de code gelezen én bevestigd door een run; nooit blind uit een run overgenomen. Een test mag pas aangepast worden na een uitdrukkelijke Ruling (vermeld in de commit). | W11. |
| Z9 | `send-rapport` PDF-naad | De PDF-opbouw (`chromium.executablePath` t/m `browser.close()`) verhuist letterlijk naar `async function standaardPdf(html)`, en de handler krijgt `export function maakHandler({ fetch = globaleFetch, maakPdf = standaardPdf } = {})` met `export const handler = maakHandler()`. Dit is de **enige** codewijziging vóór de karakterisering, in een eigen commit, controleerbaar in de diff (alleen verplaatsing) en gedekt door tests van de bereikbare paden. Het `browser`-opruimen in de `catch` blijft werken doordat `standaardPdf` zijn browser zelf sluit bij een fout. | Zonder deze naad zijn upload, `sendReply` en de status-PATCH onbereikbaar voor tests. |
| Z10 | `confirm-afspraak` | Houdt zijn eigen origin-whitelist-`corsHeaders` en HTML-antwoorden (niet in `http.js`); enkel de Zoho-onderdelen gaan naar `zoho.js`. De Blobs-registratie wordt niet gefaket (faalt zonder omgeving, wordt gelogd, antwoord 200: vastgelegd in een test). | Eigen CORS-model; publiek endpoint; minimaal aanraken. |
| Z11 | Gevonden eigenaardigheden, bewust **niet** aangepast | (1) token-foutdata in 8 van 10 functies, niet in 2; (2) `tickets` heeft geen OPTIONS; (3) `route`/`optimize`/`drukte` hebben geen methodecontrole; (4) `plan-datum` antwoordt 405 als tekst, de v1-functies als JSON; (5) `comment` heeft Engelse validatie-/orgfouten, `plan` Nederlandse. Gelogd in de CHANGELOG-sectie van de refactor-tak als "bekend, ongewijzigd". | W11: Zoho-verkeer identiek. |
| Z12 | Geen echte verbindingen | De testhelper vervangt `globalThis.fetch` standaard door een functie die gooit; elke test levert zijn eigen nep. Geen echte Zoho-, TomTom- of mailaanroepen. | W11, roadmap §5. |
| Z13 | Versie en CHANGELOG | Geen versienummer of tag. Eén regel onder "Changed" in de refactor-tak-sectie van `CHANGELOG.md` (laatste taak). | W5. |
| Z14 | Review | Taak-review sonnet; etappe-eindreview **sonnet** (roadmap §5: enkel etappe 2 en 9 opus). De reviewer krijgt de bytevergelijkings-checklist van het plan (Review Focus). | W12. |

## 4. Ontwerp

### 4.1 `netlify/lib/zoho.js`

```js
export const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
export const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';
export const globaleFetch  = (...args) => globalThis.fetch(...args);

export function maakZoho({ fetch = globaleFetch, env = process.env, nu = () => Date.now(),
                           tokenFoutMetData = true, orgFoutTekst = 'Zoho org ID niet gevonden' } = {})
  // -> { haalToken, haalOrgId, haalToegang, headers, verzoek }
export async function leesJsonVeilig(res)   // {} bij lege of ongeldige body
```

- `haalToken()`: exact het huidige verzoek: `POST ZOHO_ACCOUNTS`, header `Content-Type: application/x-www-form-urlencoded`, body `URLSearchParams` met `refresh_token`, `client_id`, `client_secret`, `grant_type: 'refresh_token'` in die volgorde; `res.json()`; gooit bij ontbrekend `access_token`; cache `nu() + 55*60*1000`.
- `haalOrgId(token)`: `GET ZOHO_DESK/organizations` met enkel `{ headers: { Authorization } }`; `data?.[0]?.id`; gooit `orgFoutTekst`.
- `haalToegang()`: `{ token, orgId }`, in volgorde token → org.
- `headers(token, orgId, { json = false })`: `{ Authorization: 'Zoho-oauthtoken <token>', orgId (enkel als gegeven), 'Content-Type': 'application/json' (enkel bij json) }` in die sleutelvolgorde.
- `verzoek(pad, { token, orgId, methode, json, body, headers })`: `fetch(ZOHO_DESK + pad, opties)`. `method` staat enkel in de opties als `methode` gegeven is (huidige GET-aanroepen hebben geen `method`); `json` wordt `JSON.stringify` en zet `Content-Type`; `body` (bv. `FormData`) wordt doorgegeven **zonder** `Content-Type`. Geeft de ruwe `Response`.

### 4.2 `netlify/lib/http.js`

```js
export function maakCors({ methoden, headers, inhoudType, origin = '*' } = {})  // sleutelvolgorde: ACAO, Methods, Headers, Content-Type
export const CORS_V1 = Object.freeze({ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' });
export function v1Json(statusCode, obj, headers)        // { statusCode, headers, body: JSON.stringify(obj) }
export function v1Opties(headers)                       // { statusCode: 204, headers }  (geen body-sleutel)
export function v1Methode(event, toegestaan, headers)   // null | v1Opties | 405 JSON {error:'Method not allowed'}
export function v2Json(status, obj, cors)               // new Response(JSON, { status, headers: { ...cors, 'Content-Type': 'application/json' } })
export function v2Opties(cors)                          // new Response(null, { status: 204, headers: cors })
export function v2Methode(req, toegestaan, cors)        // null | v2Opties | 405 tekst 'Method Not Allowed'
```

`v1Methode`: `OPTIONS` → `v1Opties`; niet in `toegestaan` → 405; anders `null`. Functies zonder huidige controle roepen enkel `v1Opties` aan (of niets). `CORS_V1` wordt nooit gemuteerd.

### 4.3 Testhelper `tests/nep-fetch.mjs` (geen `*.test.mjs`, dus geen eigen testbestand)

`maakNepFetch(router)` → `{ fn, calls }` waarbij `calls[i] = { url, method, headers, body }` (body genormaliseerd: tekst, `URLSearchParams` als tekst, `FormData` als `[[naam, bestandsnaam, type, grootte]]`); standaardantwoorden voor token (`access_token: 'TOK'`) en `/organizations` (`data:[{id:'ORG1'}]`); `metGlobaleFetch(fn, werk)`; `laadVers(naam)`; `v1Event(methode, body, headers)`; `zetEnv(obj)` met herstel.

## 5. Risico's

| Risico | Vangnet |
|---|---|
| Authorization-formaat of `orgId`-header verschuift | Karakteriseringstests leggen **elk** uitgaand verzoek volledig vast (URL, methode, headers, body) vóór de migratie. |
| CORS-verschillen tussen functies worden gelijkgetrokken | Tests leggen `Object.fromEntries(headers)` (v2) en het headers-object (v1) volledig vast, ook op 204 en 405. |
| Testmodus-tak raakt toch Zoho | Per Zoho-functie een test met `X-Blitz-Test: 1` die `calls.length === 0` eist; validatie-volgorde vastgelegd. |
| Foutstatus/-tekst verschuift | Tests voor token-, org-, 404-, 502- en 500-paden met exacte `error`-tekst. |
| Mails/verzendpad onbereikbaar | `send-rapport` PDF-naad (Z9); `propose` met bevroren tijd en echte PDF. |
| Lib-state lekt tussen handlers | Cache enkel in de `maakZoho`-instantie; test in taak 1 bewijst dat twee instanties elk een token halen. |
