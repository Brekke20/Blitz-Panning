# MCP-leesconnector voor Claude — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude (app, gsm, Claude Code) kan na aanmelden met de gewone Blitz-login rapporten, oorzaken, serienummers, open tickets en planning **lezen** en tellen, binnen de rechten van die gebruiker.

**Architecture:** Eén MCP-endpoint (`/api/mcp`, Streamable HTTP, stateless JSON-RPC, zonder SDK-afhankelijkheid) plus een minimale OAuth 2.1-autorisatieserver in Netlify-functies (metadata, dynamische clientregistratie, authorize met toestemmingsscherm, token met PKCE en refresh). Toegangen worden gehasht in Blobs bewaard en bij elk verzoek getoetst tegen het gebruikersrecord (actief, `sessieVersie`, rol). De gereedschappen zijn pure functies over bestaande Blobs-data.

**Tech Stack:** Netlify Functions V2 (ES modules), `@netlify/blobs` store `blitz-data` (`consistency: 'strong'`), Node `crypto`, `node --test`, Playwright.

**Spec:** `docs/specs/2026-11-10-mcp-claude-lezen.md`

## Global Constraints

- Enkel lezen: `tools/call` voert nooit een schrijvende actie op bestaande data uit; enkel OAuth-eigen blobs (`mcp-*`) worden geschreven.
- Login = bestaande Blitz-login (`auth-login`, sessiecookie `blitz_sessie`). Claude ziet nooit het wachtwoord.
- Access token 1 uur; refresh token **30 dagen**; daarna opnieuw "Toestaan".
- Toegang ongeldig zodra gebruiker `actief !== true` of `sessieVersie` verschilt van die bij toestemming.
- Rechten volgen de rol: technieker ziet enkel eigen rapporten (`filterRapportenVoor` uit `netlify/lib/eigen.js`); planner/beheerder alles wat ze nu zien; `sales` krijgt geen gereedschappen (lege `tools/list`).
- Klantgegevens (naam, adres, telefoon) worden **niet** afgeschermd.
- Elke nieuwe functie: rij in `netlify/lib/rechten.js` + `beveiligV2`-wrapper (`tests/rechten.test.mjs`).
- Toegestane redirect-URI's bij registratie: `https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`, en `http://localhost:<poort>/…` / `http://127.0.0.1:<poort>/…` (Claude Code). Alles anders: weigeren.
- Werktak vanaf `main` in `.claude/worktrees/`; geen versie/`CACHE_NAME`-bump in de werktak; regel onder `## [Unreleased]` in `CHANGELOG.md`.
- Nieuw laadbaar bestand onder `public/js/` → in `SHELL` van `public/sw.js` (zelfde commit).
- Max 200 resultaten per gereedschap-antwoord; bij afkapping veld `afgekapt: true` en `totaal`.

## Review Focus

1. **Gestolen/oude token na wachtwoordwijziging of deactivatie** → moet meteen 401 geven (test in Task 2).
2. **Technieker vraagt tellingen over alle palen** → telling enkel over eigen rapporten, nooit lekken via `rapporten_tellen` of `paal_historiek` (test in Task 4).
3. **Authorization code hergebruikt of PKCE-verifier fout** → `invalid_grant`, code is na één poging weg (test in Task 3).
4. **Serienummer met spaties/hoofdletters** (`" 2201-ab "` vs `"2201-AB"`) → zelfde paal (test in Task 4).
5. **Rapporten uit vorige jaren** (overloop `rapportlijst-archief-<jaar>`) → zitten mee in zoeken/tellen als de periode ze dekt, geen dubbels met de actieve lijst (test in Task 4).

---

## Bestandsstructuur

| Bestand | Verantwoordelijkheid |
|---|---|
| `netlify/lib/mcp-oauth.js` | Pure OAuth-logica: clientregistratie valideren, codes/tokens maken, hashen, PKCE-check, opslag in blobs `mcp-clients`, `mcp-codes`, `mcp-toegangen` |
| `netlify/lib/mcp-toegang.js` | `vereisMcpGebruiker(req, {getStore, nu})`: Bearer-token → gebruiker (of weigering) |
| `netlify/lib/mcp-data.js` | Pure functies: rapporten samenvoegen/zoeken/tellen/historiek, tickets en planning omvormen |
| `netlify/lib/mcp-protocol.js` | JSON-RPC-afhandeling: `initialize`, `ping`, `tools/list`, `tools/call`, notificaties |
| `netlify/functions/mcp.js` | Endpoint `/api/mcp` |
| `netlify/functions/mcp-oauth.js` | Endpoints `/.well-known/*`, `/api/mcp-oauth/register|authorize|token` |
| `netlify/functions/mcp-toegangen.js` | Lijst/intrekken van koppelingen (beheer + eigen) |
| `public/js/schermen/beheer-claude.js` | Blok "Gekoppelde Claude-toegangen" in beheer |
| tests | `tests/mcp-oauth.test.mjs`, `tests/mcp-toegang.test.mjs`, `tests/mcp-data.test.mjs`, `tests/mcp-protocol.test.mjs`, `e2e/beheer-claude.spec.mjs` |

---

### Task 1: OAuth-kern (registratie, code, token, PKCE)

**Files:**
- Create: `netlify/lib/mcp-oauth.js`
- Test: `tests/mcp-oauth.test.mjs` (gebruik `tests/nep-blobs.mjs`)

**Interfaces:**
- Produces:
  - `registreerClient(store, { redirect_uris, client_name }) -> Promise<{ client_id, redirect_uris, client_name } | { fout: 'invalid_redirect_uri' }>`
  - `maakCode(store, { clientId, redirectUri, codeChallenge, uid, sessieVersie }, nu) -> Promise<string>` (geldig 60 s, eenmalig)
  - `wisselCode(store, { code, clientId, redirectUri, codeVerifier }, nu) -> Promise<{ access_token, refresh_token, expires_in: 3600, token_type: 'Bearer' } | { fout: 'invalid_grant' }>`
  - `ververs(store, { refreshToken, clientId }, nu) -> Promise<zelfde vorm | { fout: 'invalid_grant' }>` (roteert refresh token)
  - `zoekToegang(store, accessToken, nu) -> Promise<{ id, uid, sessieVersie, clientId, clientNaam, aangemaakt, laatstGebruikt } | null>`
  - `lijstToegangen(store) -> Promise<Toegang[]>`, `trekIn(store, toegangId) -> Promise<boolean>`
  - Constanten `ACCESS_TTL_S = 3600`, `REFRESH_TTL_S = 30*24*3600`, `CODE_TTL_S = 60`.
- Tokens: 32 random bytes base64url; opgeslagen enkel als SHA-256-hash. PKCE: enkel `S256`.

- [ ] **Step 1: Schrijf falende tests**
  - `registreerClient` aanvaardt `https://claude.ai/api/mcp/auth_callback` en `http://localhost:33418/callback`; weigert `https://evil.example/cb` en `http://claude.ai/...` (`fout: 'invalid_redirect_uri'`).
  - `maakCode` → `wisselCode` met juiste verifier geeft `access_token`, `refresh_token`, `expires_in === 3600`.
  - Zelfde code tweede keer → `{ fout: 'invalid_grant' }`; fout verifier → `invalid_grant` én code is daarna weg; code na 61 s → `invalid_grant`; andere `redirectUri` → `invalid_grant`.
  - `zoekToegang` met access token na 3601 s → `null`; `ververs` geeft nieuw paar, oude refresh werkt daarna niet meer; refresh na 30 dagen + 1 s → `invalid_grant`.
  - Opslag bevat geen ruwe tokens (`JSON.stringify(blob)` bevat de token-string niet).
  - `trekIn` → `zoekToegang` geeft `null` en `ververs` faalt.
- [ ] **Step 2: Run** `node --test tests/mcp-oauth.test.mjs` → FAIL (module ontbreekt)
- [ ] **Step 3: Implementeer** `netlify/lib/mcp-oauth.js` (blobs via `wijzig`-patroon met versie/pogingen zoals `netlify/lib/blob-wijzig.js`).
- [ ] **Step 4: Run** `node --test tests/mcp-oauth.test.mjs` → PASS
- [ ] **Step 5: Commit** `feat(mcp): OAuth-kern met PKCE, gehashte tokens en intrekken`

### Task 2: Token → gebruiker

**Files:**
- Create: `netlify/lib/mcp-toegang.js`
- Test: `tests/mcp-toegang.test.mjs`

**Interfaces:**
- Consumes: `zoekToegang` (Task 1), `leesGebruikers`, `publiek` uit `netlify/lib/gebruikers.js`.
- Produces: `vereisMcpGebruiker(req, { getStore, nu }) -> Promise<{ ok: true, gebruiker, toegangId } | { ok: false, status: 401, code: 'invalid_token' }>`. Werkt `laatstGebruikt` bij (hoogstens 1× per 5 min).

- [ ] **Step 1: Falende tests**: geen/fout `Authorization` → 401; geldige token + actieve gebruiker → `ok` met `gebruiker.rol`; gebruiker `actief:false` → 401; `sessieVersie` verhoogd (wachtwoordwijziging) → 401; rol niet in `ROLLEN` → 401.
- [ ] **Step 2: Run** `node --test tests/mcp-toegang.test.mjs` → FAIL
- [ ] **Step 3: Implementeer.** Controleer eerst in `netlify/functions/auth-wachtwoord.js` dat een wachtwoordwijziging `sessieVersie` ophoogt; zo niet, faalt de test van Review Focus 1 → meld dit aan de opzichter i.p.v. het gedrag van de login te wijzigen.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(mcp): toegangstoken naar gebruiker met actief- en sessieversiecontrole`

### Task 3: OAuth-endpoints + toestemmingsscherm

**Files:**
- Create: `netlify/functions/mcp-oauth.js`
- Modify: `netlify/lib/rechten.js` (rij `'mcp-oauth': { '*': 'open' }` met commentaar: eigen controles, sessiecookie bij authorize)
- Test: `tests/mcp-oauth-endpoints.test.mjs`

**Interfaces:**
- Consumes: Task 1; `vereisGebruiker` uit `netlify/lib/auth.js` (sessiecookie) voor authorize; `logActiviteit`.
- `export const config = { path: ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp', '/.well-known/oauth-authorization-server', '/api/mcp-oauth/*'] }`
- Routes:
  - `GET /.well-known/oauth-protected-resource` → `{ resource: <origin>/api/mcp, authorization_servers: [<origin>] }`
  - `GET /.well-known/oauth-authorization-server` → `issuer`, `authorization_endpoint: /api/mcp-oauth/authorize`, `token_endpoint: /api/mcp-oauth/token`, `registration_endpoint: /api/mcp-oauth/register`, `response_types_supported: ['code']`, `grant_types_supported: ['authorization_code','refresh_token']`, `code_challenge_methods_supported: ['S256']`, `token_endpoint_auth_methods_supported: ['none']`, `scopes_supported: ['lezen']`.
  - `POST /register` → 201 met client, of 400 `invalid_redirect_uri`.
  - `GET /authorize` (params `client_id, redirect_uri, code_challenge, code_challenge_method=S256, state, response_type=code`): ongeldige client/redirect → 400-pagina (nooit redirect). Niet ingelogd → HTML met loginformulier dat via `fetch('/api/auth-login', {headers:{'X-Blitz':'1'}})` aanmeldt en herlaadt. `moetWachtwoordWijzigen` → melding "Wijzig eerst je wachtwoord in de tool". Ingelogd → toestemmingspagina: *"Claude toegang geven om te lezen? Claude kan planning, tickets en rapporten lezen die jij ({naam}) mag zien. Claude kan niets wijzigen."* met knoppen **Toestaan** / **Weigeren**. Formulier bevat een HMAC-ondertekend `consent`-veld (`SESSIE_GEHEIM`, bevat uid + alle params + vervaltijd 10 min) tegen CSRF.
  - `POST /authorize`: controleer sessie + `consent`-handtekening; Weigeren → redirect `redirect_uri?error=access_denied&state=`; Toestaan → `maakCode` → redirect `redirect_uri?code=…&state=…`; `logActiviteit('claude-gekoppeld')`.
  - `POST /token` (form-urlencoded): `grant_type=authorization_code` of `refresh_token`; fouten als `{ error: 'invalid_grant' }` 400.
- Pagina's in Blitz-huisstijl (eenvoudige inline CSS, licht/donker via `prefers-color-scheme`), Nederlands.

- [ ] **Step 1: Falende tests** (handler met nep-blobs + vaste gebruiker): metadata-velden exact zoals hierboven; authorize zonder sessie toont loginformulier (status 200, bevat `auth-login`); authorize met onbekende `redirect_uri` → 400 en geen `Location`; POST Toestaan met vervalste `consent` → 403; geldige → 302 met `code` en zelfde `state`; Weigeren → `error=access_denied`; volledige flow register→authorize→token levert bruikbare access token (`zoekToegang` ≠ null).
- [ ] **Step 2: Run** `node --test tests/mcp-oauth-endpoints.test.mjs` → FAIL
- [ ] **Step 3: Implementeer** + rij in `rechten.js`; check of `netlify.toml`-redirect `/api/*` niet botst met `config.path` (functie-paden winnen; voeg test toe in `tests/netlify-toml.test.mjs` als die redirects vastpint).
- [ ] **Step 4: Run** `node --test` (volledig) → PASS
- [ ] **Step 5: Commit** `feat(mcp): OAuth-endpoints met Blitz-login en toestemmingsscherm`

### Task 4: Data-functies (zoeken, tellen, historiek)

**Files:**
- Create: `netlify/lib/mcp-data.js`
- Test: `tests/mcp-data.test.mjs`

**Interfaces:**
- Consumes: `filterRapportenVoor` (`netlify/lib/eigen.js`), `leesArchieven`, `archiefJaren` (`netlify/lib/rapport-jaararchief.js`), `LIJST_KEY` (`netlify/lib/rapportlijst.js`), `effectieveStatus`.
- Produces:
  - `normSerie(s: string) -> string` (trim, hoofdletters, interne spaties weg)
  - `laadRapporten(store, { van, tot }) -> Promise<Entry[]>` (actief + jaararchieven van de periode, ontdubbeld op `id`, geannuleerde eruit)
  - `vlakRapport(entry) -> { id, datum, technieker, ticketNumber, klant, adres, interventieType, servicetype, serienummer, oorzaken: string[], probleem, acties, hersteld, nieuwInter, onderdelen, probleemtype?, garantieStatus? }`
  - `zoekRapporten(rapporten, { van, tot, serienummer, ticketNumber, technieker, oorzaak, interventieType, hersteld, tekst }, { limiet = 200 }) -> { resultaten, totaal, afgekapt }` (tekst = hoofdletterongevoelig in probleem/acties/klant/adres)
  - `telRapporten(rapporten, { groepeer: 'oorzaak'|'serienummer'|'technieker'|'maand'|'klant'|'interventieType', minimum = 1, ...filters }) -> { groepen: [{ sleutel, aantal }], totaalRapporten }` (aflopend; bij `oorzaak` telt een rapport met 2 oorzaken in beide groepen; ontbrekende waarde → sleutel `'(onbekend)'`)
  - `paalHistoriek(rapporten, serienummer) -> { serienummer, bezoeken: vlakRapport[] (oud→nieuw), oorzaken: {sleutel, aantal}[] }`
- Rechten worden **vóór** deze functies toegepast (Task 5), deze functies zijn rol-blind.

- [ ] **Step 1: Falende tests**: `normSerie(' 2201-ab ') === '2201-AB'`; zoeken op serienummer met afwijkende schrijfwijze vindt het rapport; `laadRapporten` met periode 2025-2026 haalt jaararchief 2025 + actief en ontdubbelt hetzelfde `id`; telling per oorzaak met rapport `oorzaakStoring: ['Component defect','Installatiefout']` geeft beide +1; `minimum: 3` op serienummer geeft enkel palen met ≥3 bezoeken; 250 treffers → 200 resultaten, `afgekapt: true`, `totaal: 250`; rapport zonder `oorzaakStoring` telt onder `'(onbekend)'`.
- [ ] **Step 2: Run** `node --test tests/mcp-data.test.mjs` → FAIL
- [ ] **Step 3: Implementeer**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(mcp): zoek-, tel- en historiekfuncties over rapporten`

### Task 5: MCP-protocol + endpoint `/api/mcp`

**Files:**
- Create: `netlify/lib/mcp-protocol.js`, `netlify/functions/mcp.js`
- Modify: `netlify/lib/rechten.js` (rij `'mcp': { '*': 'open' }` + commentaar: eigen Bearer-controle via `mcp-toegang.js`)
- Test: `tests/mcp-protocol.test.mjs`

**Interfaces:**
- Consumes: Task 2, Task 4; tickets-momentopname (`SNAPSHOT_SLEUTEL`, `geldigeSnapshot`), `leesRegister` (`voorstelregister.js`), blob `afspraken`.
- Produces: `behandelRpc(bericht, { gebruiker, bronnen }) -> Promise<object | null>` (null = notificatie → HTTP 202).
- Protocol: `initialize` antwoordt met de `protocolVersion` van de client indien `'2025-06-18'` of `'2025-03-26'`, anders `'2025-06-18'`; `capabilities: { tools: {} }`; `serverInfo: { name: 'blitz-planning', version: <package.json version> }`; `instructions` (NL, kort: wat de data is, dat oorzaken uit een vaste lijst komen, probleem/acties vrije tekst zijn). `GET /api/mcp` → 405. Geen sessie-ID (stateless). Batch-arrays → elk element apart.
- Zonder geldige token: 401 + `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`.
- Gereedschappen (alle `annotations: { readOnlyHint: true }`), beschikbaar per rol:

| Naam | Rollen | Invoer | Bron |
|---|---|---|---|
| `rapporten_zoeken` | beheerder, planner, technieker | filters Task 4 | `zoekRapporten` |
| `rapport_lezen` | idem | `{ id }` | `vlakRapport` |
| `rapporten_tellen` | idem | `{ groepeer, minimum?, …filters }` | `telRapporten` |
| `paal_historiek` | idem | `{ serienummer }` | `paalHistoriek` |
| `tickets_open` | beheerder, planner, technieker | `{ serienummer?, status?, tekst? }` | tickets-momentopname (velden van `mapTicket`); technieker: zelfde filter als `GET /api/tickets` hem geeft (lees `netlify/functions/tickets.js` en hergebruik die filter) |
| `planning_lezen` | beheerder, planner, technieker | `{ van, tot, technieker? }` | voorstelregister + afspraken; technieker enkel eigen naam (`isEigenNaam`) |

- Technieker: rapporten eerst door `filterRapportenVoor(gebruiker, …)`, dán zoeken/tellen. `sales`: `tools/list` geeft `[]`, `tools/call` → fout `-32601`.
- Fouten in een gereedschap → `result: { isError: true, content: [{type:'text', text:'…'}] }`; onbekende methode → JSON-RPC `-32601`; ongeldige JSON → `-32700`.
- Resultaat: `content: [{ type: 'text', text: JSON.stringify(data) }]` plus `structuredContent: data`.

- [ ] **Step 1: Falende tests**: initialize-antwoord; `tools/list` voor planner = 6 namen, voor sales = `[]`; technieker `rapporten_tellen` groepeer serienummer telt enkel eigen rapporten (fixture: 3 eigen + 5 van collega op zelfde paal → aantal 3); `rapport_lezen` met id van collega voor technieker → `isError`; notificatie `notifications/initialized` → 202 zonder body; geen token → 401 met `WWW-Authenticate` die `resource_metadata` bevat; `tools/call` doet geen enkele `set` op de nep-store behalve `mcp-toegangen` (spy).
- [ ] **Step 2: Run** `node --test tests/mcp-protocol.test.mjs` → FAIL
- [ ] **Step 3: Implementeer**; voeg `[functions.mcp] timeout = 26` toe aan `netlify.toml`.
- [ ] **Step 4: Run** `node --test` → PASS
- [ ] **Step 5: Commit** `feat(mcp): MCP-endpoint met zes leesgereedschappen volgens rol`

### Task 6: Koppelingen beheren (API + beheerscherm)

**Files:**
- Create: `netlify/functions/mcp-toegangen.js`, `public/js/schermen/beheer-claude.js`, `e2e/beheer-claude.spec.mjs`
- Modify: `netlify/lib/rechten.js` (`'mcp-toegangen': { GET: ALLE, DELETE: ALLE }`), beheerscherm-module die blokken laadt (volg patroon van bestaande beheerblokken, zie `.claude/rules/schermen.md`), `public/sw.js` (`SHELL`), `CHANGELOG.md` (`## [Unreleased]`: *Added — Claude-connector (enkel lezen) met aanmelden via Blitz-login*)
- Test: `tests/mcp-toegangen.test.mjs`

**Interfaces:**
- Consumes: `lijstToegangen`, `trekIn` (Task 1).
- `GET /api/mcp-toegangen` → beheerder: alle (`{ id, uid, gebruikerNaam, clientNaam, aangemaakt, laatstGebruikt }`), anderen: enkel eigen. `DELETE /api/mcp-toegangen?id=` → beheerder: elke, anderen: enkel eigen (anders 403). `logActiviteit('claude-ingetrokken')`.
- UI: blok "Gekoppelde Claude-toegangen" — tabel (gebruiker, gekoppeld op, laatst gebruikt) met knop **Intrekken** (`data-actie`), lege toestand "Nog niemand heeft Claude gekoppeld." Plus korte uitleg met het connector-adres `<origin>/api/mcp` en een kopieerknop.

- [ ] **Step 1: Falende tests**: technieker ziet enkel eigen koppeling; technieker DELETE van andermans → 403; beheerder DELETE → daarna `zoekToegang` null. E2e (gestubde `/api/mcp-toegangen`): blok toont rij, klik Intrekken stuurt DELETE met juiste id en rij verdwijnt; lege toestand.
- [ ] **Step 2: Run** `node --test tests/mcp-toegangen.test.mjs` en `npx playwright test e2e/beheer-claude.spec.mjs --project=chromium` → FAIL
- [ ] **Step 3: Implementeer**
- [ ] **Step 4: Run** `node --test` en `npx playwright test --project=chromium --workers=2 --grep-invert @contrast --shard=K/4` (K=1..4, na elkaar) → PASS
- [ ] **Step 5: Commit** `feat(mcp): beheerblok gekoppelde Claude-toegangen met intrekken`

### Task 7 (optioneel, na akkoord Brent): probleemtype + garantiestatus meebewaren

**Files:**
- Modify: `netlify/lib/rapportlijst.js` (`bouwEntry`: top-level `probleemtype`, `garantieStatus` uit body, strings ≤ 100 tekens), `public/js/rapport-wizard.js` (archief-POST-body: `probleemtype: _wizTicket?.probleemtype ?? ''`, `garantieStatus: _wizTicket?.garantieStatus ?? ''`), `netlify/lib/mcp-data.js` (`vlakRapport` + `groepeer: 'probleemtype'`)
- Test: uitbreiding `tests/rapportlijst*.test.mjs` en `tests/mcp-data.test.mjs`

- [ ] **Step 1: Falende tests**: `bouwEntry` neemt beide velden over en kapt op 100; ontbrekend → `''`; `telRapporten({groepeer:'probleemtype'})` werkt, oude rapporten → `'(onbekend)'`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implementeer**
- [ ] **Step 4: Run** `node --test` + `npx playwright test e2e/ --grep rapport --project=chromium` → PASS
- [ ] **Step 5: Commit** `feat(rapport): probleemtype en garantiestatus mee in archief`

### Task 8: Handmatige eindcontrole (na deploy-preview, niet op main)

- [ ] Netlify deploy-preview van de werktak; in Claude Code: `claude mcp add --transport http blitz <preview-url>/api/mcp` → aanmelden → "Toestaan" → vraag "top 5 oorzaken laatste 3 maanden" geeft antwoord.
- [ ] In claude.ai: Instellingen → Connectors → eigen connector met `<preview-url>/api/mcp` → zelfde test.
- [ ] Met een technieker-testaccount: telling bevat enkel eigen rapporten.
- [ ] Intrekken in beheer → volgende vraag in Claude geeft aanmeldvraag.
