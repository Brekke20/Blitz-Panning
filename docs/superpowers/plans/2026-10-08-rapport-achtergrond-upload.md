# Rapport-upload op de achtergrond — Implementatieplan (v1.10.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De technieker drukt "Verzenden" en de telefoon doet nog maar één korte overdracht; PDF-maken en Zoho-upload gebeuren op de server (Netlify Background Function met vangnet), ook bij vergrendeld scherm.

**Architecture:** Nieuwe functie `POST /api/rapport-ontvangen` schrijft de rapport-HTML als apart blob `rapport-inhoud/<id>` en een lichte entry (met `verwerking`-status) in `rapportlijst`, en start `rapport-verwerk-background` (PDF + Zoho via de bestaande, naar `netlify/lib/` uitgetrokken upload-logica met het bestaande idempotentie-register). Een Scheduled Function `rapport-vangnet` (elke 5 min) herstart blijvers en migreert oude entries. De client verstuurt via één gedeeld klassiek script (`public/js/outbox-verzend.js`) dat zowel de pagina als de service worker (Background Sync, Android) gebruiken. Alle serverlogica zit in kleine pure modules onder `netlify/lib/` met dunne functies in `netlify/functions/`; alle nieuwe clientcode in aparte modules onder `public/js/`.

**Tech Stack:** Netlify Functions v2 (`export default`, ES modules) + Netlify Blobs 8.2.0 (`blitz-data`, `consistency: 'strong'`), vanilla-JS-PWA (ES modules + 1 klassiek script), IndexedDB, Service Worker Background Sync, tests met ingebouwde `node --test` (Node 24, geen nieuwe dependencies).

**Spec:** `docs/superpowers/specs/2026-10-08-rapport-achtergrond-upload-design.md` (lezen vóór je begint; dit plan werkt die uit en wijkt op de punten onder "Afwijkingen van de spec" bewust af).

**Bronnen Netlify (docs.netlify.com, geraadpleegd 2026-10-08):** Background Functions: bestandsnaam met suffix `-background` (of `config.background`), retourneert direct 202, tot 15 min, beschikbaar op Free/Personal/Pro, bij fout 2 automatische retries (na 1 en 2 min), zelfde v2-syntax (`export default async (req)`). Scheduled Functions: schedule in `netlify.toml` (`[functions."naam"] schedule = "..."`) of inline `config.schedule`, UTC, **limiet 30 s**, lopen enkel op gepubliceerde productie-deploys, niet per URL aan te roepen.

## Global Constraints

- **Branch/versie (CLAUDE.md, branchbeleid):** dit is een bugfix voor `main` → tak `fix/upload-achtergrond` vanaf `main`, worktree `.claude/worktrees/upload-achtergrond`. Release = PATCH **1.10.2**. **Nooit pushen, taggen of mergen** (dat doet de opzichter na akkoord van Brent). Werk enkel in die worktree, nooit in `.claude/worktrees/planner-brein`.
- **Opdrachtgever-eis (bindend): geen nieuwe logica in `public/index.html`** (op main al ~7300 regels). Nieuwe clientcode = aparte modules onder `public/js/`; nieuwe serverlogica = kleine modules onder `netlify/lib/` met dunne functies in `netlify/functions/`; één verantwoordelijkheid per bestand. Toegestaan in `index.html`: enkel `<script>`-tags voor de nieuwe bestanden en het 1-op-1 vervangen van `r.rapportData?._html` door een aanroep van `haalRapportHtml(r)` op twee plaatsen (Task 10).
- **Testmodus:** lokaal altijd via `http://localhost:3333/?test` (zonder `?test` gaan er ECHTE Zoho/TomTom-calls uit). Elke nieuwe functie gebruikt `isTestVerzoek`/`winkelNaam` (+ `zorgVoorTestkopie` waar de bestaande functies dat doen) uit `netlify/lib/testmodus.js`; in testmodus nooit Zoho, nooit Chromium.
- **Lokale server met Blobs:** `node blobs-local-bootstrap.mjs` (start `dev-server.mjs` op poort 3333 met Blobs-emulatie). Gewoon `node dev-server.mjs` heeft geen Blobs en geeft 500.
- **XSS:** alle vrije tekst in HTML via `escHtml` (bestaand patroon, globale functie uit `index.html`; ook in attributen).
- **Idempotentie hergebruiken, niet herschrijven:** `verzendId = id` en het register `rapport-verzend-status` uit `rapport.js` blijven de bron van waarheid tegen dubbele PDF's.
- **Compatibiliteit overgang:** `POST /api/rapport` en `POST /api/rapport-archief` (oude vorm, incl. `rapportData._html`) blijven ongewijzigd werken voor oude app-versies in een SW-cache.
- **Stijl:** Nederlands in UI-teksten/commentaar; codeidentifiers zoals in de codebase. Tests: `node --test tests/*.test.mjs` (baseline: 47 tests groen), `node:test` + `node:assert/strict`, nep-store/nep-fetch zoals in `tests/annulatie.test.mjs` (`maakHandler({ getStore, fetch })`-patroon voor functies).
- **Commits:** klein en per taak, conventionele prefix (`fix(upload): …`, `test(upload): …`), elke commit eindigt met de regel `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Waarden uit de spec (verbatim):** `verwerking.status ∈ 'wacht'|'bezig'|'in-zoho'|'mislukt'|'lokaal'|'geannuleerd'|'onbekend'`; herhaalschema 5 min, 15 min, 30 min, 1 u, 2 u → daarna `mislukt`; vangnet: elke 5 min, `bezig` > 20 min = vastgelopen, max. 5 starts per run, max. 20 migraties per run; versie-retry max. 3; Background Sync-tag `rapport-outbox`; Background Function-naam `rapport-verwerk-background`; melding: "Rapport #1234 kon niet naar Zoho. Je hoeft niets opnieuw in te vullen; kantoor is verwittigd."; stap-label "Wordt verstuurd…"; badges *In verwerking*, *In Zoho*, *Mislukt* (rood, `laatsteFout` als tooltip, knop **Opnieuw versturen**), *Lokaal*.
- **Opruimen:** na elke taak die een server startte: poort 3333 vrijgeven (skill `opruimen-na-werk`); `.blobs-local-test/` en `.env.local` zijn gitignored en worden nooit gecommit.

## Afwijkingen van de spec (technisch niet haalbaar of niet kloppend)

1. **"Optimistische locking met versie-check" kan niet atomair**: `@netlify/blobs@8.2.0` heeft geen conditionele writes (zie commentaar in `rapport.js`). In plaats daarvan: read-modify-write + read-back-controle met max. 3 pogingen (`wijzigLijst`, Task 1) — hetzelfde patroon als `markeerUpgeload` in `rapport.js`. Restrisico (gelijktijdige schrijver ná onze controle) bestaat al vandaag en wordt voor de status gedekt door het register + vangnet.
2. **Herhaalschema vs. "5 pogingen"**: de spec zegt zowel "5× opnieuw over ~4 uur" (5+15+30+60+120 = 230 min = **5 herhalingen = 6 pogingen**) als "na de 5e mislukte poging `mislukt`". Plan volgt het schema: `MAX_POGINGEN = 6` (1 eerste + 5 herhalingen).
3. **Service worker deelt code als klassiek script, niet als ES-module**: module-service-workers zijn niet overal ondersteund; een registratie als `{type:'module'}` kan SW-registratie breken op Firefox/Safari. `public/js/outbox-verzend.js` is daarom een klassiek script (UMD-stijl: zet `globalThis.outboxVerzend`, en `module.exports` voor de tests), geladen met `importScripts` (SW) en `<script src>` (pagina).
4. **Testmodus schakelt de outbox nu volledig uit** (`TEST_MODE` → niets naar de server). De spec-test "volledige flow in testmodus" kan dus enkel met een nieuwe opt-in `?test&upload` (`TEST_UPLOAD`): dan loopt de echte outbox → `/api/rapport-ontvangen` tegen de **testopslag** (header `X-Blitz-Test`, ook vanuit de service worker via `item.testModus`), zonder Zoho/Chromium. Zonder `&upload` verandert testmodus niet.
5. **`/.netlify/functions/…` bestaat niet in `dev-server.mjs`** en `Request`-URL's daar missen de poort → kleine dev-server-aanpassing (Task 4) zodat `-background` lokaal gesimuleerd wordt.
6. **Scheduled Function-config in `netlify.toml`** (zoals de spec's Release-sectie zegt) i.p.v. inline `config.schedule` — vermijdt een `@netlify/functions`-dependency.
7. **`send-rapport.js` blijft ongewijzigd**: de client haalt de HTML (indien nodig via `GET /api/rapport-archief?inhoud=<id>`) en stuurt die zoals nu mee.
8. **Request-limiet 6 MB** voor Netlify-functies: `rapport-ontvangen` weigert `html` > 5 500 000 tekens met 413 en een duidelijke melding (zie Task 4/7). Dat is niet slechter dan nu (`/api/rapport` had dezelfde limiet).
9. **Testtickets** (`t1`, `p1`, `g1`…) zijn geen cijfers: in testmodus wordt de `ticketId`-cijfercontrole overgeslagen; het ticket `p2` laat de test-upload bewust falen (om `mislukt` te kunnen testen, met `maxPogingen: 1`).
10. **Te verifiëren, niet in scope:** `rapport.js` is een v1-handler zonder `connectLambda(event)`; of het idempotentie-register op productie überhaupt schrijft is onbewezen (fouten worden stil ingeslikt). De nieuwe flow gebruikt het register vanuit een v2-functie (Blobs-context automatisch). Opzichter beslist of `rapport.js` later `connectLambda` krijgt.

## Review Focus

De vijf invoer-/foutklassen die de spec impliceert maar waar geen "gewone" taak-test vanzelf op uitkomt; elke regel heeft een test in de genoemde taak.

1. **Zelfde `id` tweemaal gepost** (antwoord gemist, of pagina + service worker tegelijk): één entry, één PDF, een al `in-zoho`-entry wordt niet teruggezet, antwoord blijft `ok`. → Task 4 (`rapport-ontvangst.test.mjs`).
2. **Oud IndexedDB-item van vóór de update** (`archived: true`, `zohoUploaded: false`, `archiveBody.rapportData._html` gevuld): gaat via `rapport-ontvangen`, zonder `_html`/handtekeningen in `archiveBody`, niets gaat verloren. → Task 7 (`outbox-verzend.test.mjs`).
3. **Oude `rapportlijst`-entries zonder `verwerking` en/of met inline `_html`**: weergave als `in-zoho`/`geannuleerd`/`onbekend`, Openen-knop blijft werken, het vangnet start ze nooit voor Zoho maar migreert hun HTML. → Task 1, 6, 10.
4. **Te grote rapporten (veel foto's) of 413 van het netwerk**: duidelijke Nederlandse foutmelding in de balk, item blijft bewaard, geen crash. → Task 4 (413) + Task 7 (foutvertaling).
5. **HTML/aanhalingstekens in vrije tekst** (`laatsteFout`, `ticketNumber`, `klant` in badge, tooltip en melding): altijd ge-escaped. → Task 10.

---

### Task 0: Worktree en baseline

**Files:** geen codewijzigingen.

**Interfaces:**
- Produces: worktree `C:/Users/BRENT/OneDrive - Hertsens Transport (Walding)/Claude-Projects/blitz-planning/.claude/worktrees/upload-achtergrond` op tak `fix/upload-achtergrond` (vanaf `main`, HEAD `2cd3479` of nieuwer), met `node_modules` en `.env.local`.

- [ ] **Step 1: Worktree aanmaken (skill `superpowers:using-git-worktrees`)**

```bash
cd "<repo-root>" && git worktree add .claude/worktrees/upload-achtergrond -b fix/upload-achtergrond main
```
Verwacht: `git -C .claude/worktrees/upload-achtergrond branch --show-current` → `fix/upload-achtergrond`. (`.claude/worktrees/` staat al in `.git/info/exclude`.) Vanaf nu: elke Bash-call met `cd "<worktree-pad>" && …` en verifieer de branch vóór elke commit (bekende valkuil: subagents die in de main-checkout committen).

- [ ] **Step 2: Dependencies en lokale config**

`npm ci` in de worktree; kopieer `.env.local` uit de main-checkout naar de worktree (niet tonen, niet committen).

- [ ] **Step 3: Baseline**

Run: `node --test tests/*.test.mjs` → Expected: `pass 47`, `fail 0`. Controleer dat poort 3333 vrij is (`netstat -ano | findstr :3333` leeg); zo niet, meld aan de opzichter (een andere worktree draait mogelijk een server) en stop die niet zelf.

---

### Task 1: `netlify/lib/rapportlijst.js` — gedeelde lijstlogica + `rapport-archief.js` erop

**Files:**
- Create: `netlify/lib/rapportlijst.js`
- Modify: `netlify/functions/rapport-archief.js` (POST-pad gebruikt de lib; gedrag identiek)
- Test: `tests/rapportlijst.test.mjs`

**Interfaces:**
- Produces (alles `export`):
  - `LIJST_KEY = 'rapportlijst'`, `MAX_RAPPORTEN = 500`, `LEGE_LIJST = { versie: 0, rapports: [] }`
  - `bepaalDedupVelden(bestaandeEntry, zelfdeItem, body)` — **verplaatst, ongewijzigd** uit `rapport-archief.js` (blijft ook daar her-geëxporteerd).
  - `stripZwareVelden(rapportData: object|null): object|null` — kopie zonder `_html`, `handtekeningTech`, `handtekeningKlant`.
  - `bouwEntry(body, { nu = new Date(), licht = false } = {}): object` — de entry-opbouw uit de huidige POST (id/datum/aangemaakt/…/`geannuleerd:false`); `licht: true` past `stripZwareVelden` toe op `rapportData`.
  - `voegToeOfWerkBij(rapports: object[], entry: object, body: object): { rapports: object[], vervangenId: string|null }` — dedup op `ticketId`+`datum` (enkel als `ticketId` gevuld), `zelfdeItem`/`bepaalDedupVelden`, bij dedup `{...oud, ...entry}` (id van de nieuwe), anders `[entry, ...rapports]`, afgekapt op `MAX_RAPPORTEN`. `vervangenId` = id van de vervangen entry **als dat id verschilt**, anders `null`.
  - `effectieveStatus(entry): 'wacht'|'bezig'|'in-zoho'|'mislukt'|'lokaal'|'geannuleerd'|'onbekend'` — `entry.verwerking?.status` of `zohoUploaded ? 'in-zoho' : (geannuleerd ? 'geannuleerd' : 'onbekend')`.
  - `wijzigLijst(store, mutatie, { pogingen = 3 } = {}): Promise<{ ok: true, versie: number, ongewijzigd?: true, resultaat?: any } | { ok: false }>` — `mutatie({ versie, rapports })` geeft `null` (niets te doen) of `{ rapports, controle(rapports): boolean, resultaat? }`. Leest, schrijft `{ versie: versie+1, rapports }`, leest terug en roept `controle`; bij mislukte controle opnieuw vanaf het lezen, tot `pogingen`. Een fout bij het lezen/schrijven wordt doorgegooid.
- Consumes: niets (pure + `store.get/setJSON`).

- [ ] **Step 1: Failing tests** (`tests/rapportlijst.test.mjs`, nep-store zoals `voorstelregister.test.mjs`, uitgebreid met een optie om een gelijktijdige schrijver te simuleren)

Test-namen en kernassertions:
  - `bepaalDedupVelden: al geüploade entry kan niet alsnog geannuleerd worden` → `bepaalDedupVelden({zohoUploaded:true}, true, {geannuleerd:true})` = `{ zohoUploaded:true, geannuleerd:false }` (gedrag-bevriezing van de bestaande functie).
  - `stripZwareVelden verwijdert _html en beide handtekeningen, laat de rest staan; null blijft null`.
  - `bouwEntry licht: rapportData zonder _html/handtekeningen; niet-licht: _html blijft` (legacy POST houdt `_html`).
  - `voegToeOfWerkBij: dedup op ticketId+datum behoudt het nieuwe id en geeft vervangenId = oud id`; `zelfde id → vervangenId null`; `lege ticketId dedupt nooit`; `lijst wordt op 500 afgekapt`.
  - `effectieveStatus: oude entry zonder verwerking` — `{zohoUploaded:true}`→`'in-zoho'`, `{geannuleerd:true}`→`'geannuleerd'`, `{}`→`'onbekend'`; `{verwerking:{status:'mislukt'}}`→`'mislukt'`. *(Review Focus 3)*
  - `wijzigLijst schrijft en verhoogt versie`; `wijzigLijst: mutatie null → ongewijzigd, geen write`; `wijzigLijst herhaalt als een gelijktijdige schrijver overschrijft` (nep-store die na de 1e `setJSON` de blob terugzet zonder onze wijziging; verwacht `ok:true` bij 2e poging); `wijzigLijst geeft ok:false na 3 mislukte controles`.

- [ ] **Step 2: Run** `node --test tests/rapportlijst.test.mjs` → Expected: FAIL (module bestaat niet).
- [ ] **Step 3: Implementeer `netlify/lib/rapportlijst.js`** volgens de Interfaces; verplaats de entry-opbouw/dedup-code uit de POST-handler van `rapport-archief.js` 1-op-1 (zelfde veldnamen/defaults, o.a. `interventieType` default `'Interventie'`, `nieuwInter`/`hersteld` `'ja'|'nee'`).
- [ ] **Step 4: Maak `rapport-archief.js` dun** — POST gebruikt `bouwEntry(body)` + `voegToeOfWerkBij`; behoudt de eigen `versie`-check (409), `503`, response `{ ok, id, versie }`; `export { bepaalDedupVelden }` blijft. GET/DELETE ongewijzigd (behalve `LIJST_KEY`/`LEGE_LIJST`-import).
- [ ] **Step 5: Run** `node --test tests/*.test.mjs` → Expected: alles PASS (47 + nieuwe).
- [ ] **Step 6: Commit** `refactor(upload): gedeelde rapportlijst-logica naar netlify/lib/rapportlijst.js`

---

### Task 2: `rapport.js` uittrekken naar herbruikbare lib (gedrag ongewijzigd)

**Files:**
- Create: `netlify/lib/rapport-register.js`, `netlify/lib/rapport-zoho.js`, `netlify/lib/rapport-upload.js`
- Modify: `netlify/functions/rapport.js` (wordt een dunne v1-handler)
- Test: `tests/rapport-register.test.mjs`, `tests/rapport-upload.test.mjs`

**Interfaces:**
- Produces:
  - `rapport-register.js` (verplaatst uit `rapport.js`, ongewijzigde signaturen en gedrag): `REGISTER_KEY`, `IN_FLIGHT_TIMEOUT_MS`, `normaliseerVerzendId`, `isAlVerzonden`, `pasRegisterMarkeringToe`, `heeftActieveReservering`, `pasReserveringToe`, `wisReservering`, `pasMarkeringToe`, `leesRegister(store)`.
  - `rapport-zoho.js` (importeert `@sparticuz/chromium-min`/`puppeteer-core`; **enkel hier**): `maakPdf(html: string): Promise<Buffer>` (Chromium starten, request-interceptie die alles behalve `data:`/`about:blank` blokkeert, `setContent` met `waitUntil:'load'`, `page.pdf` met exact de huidige opties/footer; browser in `finally` sluiten) en `uploadPdfNaarZoho({ pdfBuffer, ticketId, filename }): Promise<string|undefined>` (token + orgId + multipart upload; geeft `uploadData.id`; gooit `Error(JSON.stringify(uploadData))` bij `!ok`). `getAccessToken`/`getOrgId`/`CHROMIUM_URL` verhuizen hierheen.
  - `rapport-upload.js`: `maakUploader({ maakPdf, uploadPdfNaarZoho }): (args) => Promise<…>` waarbij `args = { html, ticketId, filename, verzendId: string|null, store: Store|null }` en het resultaat `{ attachmentId, alUploaded?: true } | { inProgress: true }` is; gooit bij fouten (na best-effort reservering wissen). Volgorde exact als de huidige handler: register-check (al `done` → `{attachmentId, alUploaded:true}`), reservering (actieve → `{inProgress:true}`), PDF, Zoho, register-markering `done` (best-effort, nooit gooien). `store === null` of falende store → "doorgaan" zoals nu. Daarnaast `markeerLijstUpgeload(store, verzendId, attachmentId): Promise<void>` (de `rapportlijst`-label-write met 3× read-back-retry uit `markeerUpgeload` stap 2; best-effort).
- Consumes: niets uit eerdere taken.

- [ ] **Step 1: Karakteriseringstests tégen de huidige `rapport.js`** (importeren de bestaande exports uit `../netlify/functions/rapport.js`; die import start geen browser): `tests/rapport-register.test.mjs` met `normaliseerVerzendId('abc')`→`null`, `normaliseerVerzendId('0b6c1f2e-1111-4222-8333-444455556666')` blijft; `isAlVerzonden` geeft entry enkel bij `done:true`; `pasRegisterMarkeringToe` null bij al-done; `heeftActieveReservering` binnen/buiten 3 min en bij corrupte datum; `pasReserveringToe` null bij actieve reservering; `wisReservering` null zonder reservering; `pasMarkeringToe` null als entry al correct, anders zet `zohoUploaded:true, zohoAttachmentId, geannuleerd:false`.
- [ ] **Step 2: Run** → Expected: PASS (bevriest het gedrag vóór de verhuizing).
- [ ] **Step 3: Verplaats** de register-/lijst-pure-functies naar `rapport-register.js`; pas de import in de test aan naar `../netlify/lib/rapport-register.js`. Run → PASS.
- [ ] **Step 4: Failing tests voor `rapport-upload.js`** (`tests/rapport-upload.test.mjs`, nep-store + nep-`maakPdf`/`uploadPdfNaarZoho` die aanroepen tellen):
  - `nieuwe upload: PDF + Zoho één keer, register krijgt done:true met attachmentId`
  - `tweede aanroep met zelfde verzendId: geen PDF/Zoho, alUploaded:true met dezelfde attachmentId`
  - `actieve reservering van een andere poging → { inProgress:true }, geen PDF`
  - `Zoho-fout: gooit, reservering is gewist (volgende poging mag direct)`
  - `store null: upload gaat gewoon door zonder register`
  - `markeerLijstUpgeload zet zohoUploaded/zohoAttachmentId op de entry met dat id; geen match = geen write`
- [ ] **Step 5: Run** → FAIL. **Step 6: Implementeer** `rapport-zoho.js` (verbatim verplaatsen) en `rapport-upload.js` (logica uit handler/`checkAlUpgeload`/`reserveerOfWeiger`/`wisReserveringBestEffort`/`markeerUpgeload`, maar met `store` als parameter i.p.v. `getStore(winkelNaam(event))`). Run → PASS.
- [ ] **Step 7: `rapport.js` wordt dun**: validatie (`html`/`ticketId` verplicht, cijfers, `normaliseerVerzendId`), testmodus-vroege-return (`nepZohoAntwoord`), `store` via `getStore({name: winkelNaam(event), consistency:'strong'})` **in eigen try → null bij fout**, `uploadRapport(...)` met `maakUploader({ maakPdf, uploadPdfNaarZoho })`, mapping naar exact dezelfde HTTP-antwoorden als nu (200 `{success, attachmentId[, alreadyUploaded:true]}`; 409 `{error:'Upload van dit rapport is al bezig', inProgress:true}`; 500 `{error}`), daarna `markeerLijstUpgeload` best-effort in try/catch. Geen enkele response-vorm mag veranderen (oude app-versies).
- [ ] **Step 8: Run** `node --test tests/*.test.mjs` → PASS. Verifieer lokaal in testmodus: `curl -s -X POST localhost:3333/api/rapport -H "X-Blitz-Test: 1" -d '{"html":"<p>x</p>","ticketId":"123"}'` (server via `node blobs-local-bootstrap.mjs`) → `{"ok":true,"test":true,"success":true,"attachmentId":"test-bijlage"}`.
- [ ] **Step 9: Commit** `refactor(upload): upload-logica uit rapport.js naar netlify/lib (gedrag ongewijzigd)`

---

### Task 3: Statusmachine en `rapport-verwerk-background`

**Files:**
- Create: `netlify/lib/rapport-inhoud.js`, `netlify/lib/rapport-verwerking.js`, `netlify/lib/rapport-testupload.js`, `netlify/lib/rapport-verwerker.js`, `netlify/functions/rapport-verwerk-background.js`
- Test: `tests/rapport-verwerking.test.mjs`

**Interfaces:**
- Consumes: `wijzigLijst`, `effectieveStatus`, `LIJST_KEY` (Task 1); `maakUploader` (Task 2).
- Produces:
  - `rapport-inhoud.js`: `INHOUD_PREFIX = 'rapport-inhoud/'`, `UUID_RE`, `isGeldigId(id): boolean`, `schrijfInhoud(store, { id, html, ticketId, filename, isLocal }, nu = new Date()): Promise<void>` (blob `{ id, html, ticketId, filename, isLocal, aangemaakt }`), `leesInhoud(store, id): Promise<object|null>`, `verwijderInhoud(store, id): Promise<void>` (best-effort, slikt fouten).
  - `rapport-verwerking.js`: `HERHAALSCHEMA_MIN = [5, 15, 30, 60, 120]`, `MAX_POGINGEN = 6`, `VASTGELOPEN_NA_MIN = 20`, `EINDSTATUSSEN = ['in-zoho','lokaal','geannuleerd']`, `nieuweVerwerking(status, nu): Verwerking`, `naFout(verwerking, fout: string, nu, maxPogingen = MAX_POGINGEN): Verwerking` (pogingen+1; `< maxPogingen` → `wacht` + `volgendePoging = nu + HERHAALSCHEMA_MIN[pogingen-1] min`; anders `mislukt`, `volgendePoging: null`; `laatsteFout` gezet), `isVastgelopen(entry, nu): boolean`, `moetStarten(entry, nu): boolean`, `verwerkRapport(id, { store, upload, nu = () => new Date(), maxPogingen }): Promise<{ resultaat: 'niet-gevonden'|'overgeslagen'|'al-bezig'|'in-zoho'|'wacht'|'mislukt' }>` met `upload({ html, ticketId, filename, verzendId }) → Promise<{attachmentId}|{inProgress:true}>`. `Verwerking = { status, pogingen, volgendePoging: string|null, laatsteFout: string|null, bijgewerkt: string }` (ISO-datums).
  - `rapport-testupload.js`: `TEST_MISLUKT_TICKETID = 'p2'`, `testUpload({ ticketId }): Promise<{ attachmentId: 'test-bijlage' }>` — gooit `Error('Testfout: Zoho onbereikbaar')` als `ticketId === TEST_MISLUKT_TICKETID`.
  - `rapport-verwerker.js` (enige plek die Chromium/Zoho-wiring kent; wordt niet door unit-tests geïmporteerd): `maakVerwerker({ store, testModus }): { upload, maxPogingen }` — testmodus → `{ upload: testUpload, maxPogingen: 1 }`; anders `upload = ({html,ticketId,filename,verzendId}) => uploadRapport({ …, store })` met `maakUploader({ maakPdf, uploadPdfNaarZoho })`, `maxPogingen: MAX_POGINGEN`. Gebruikt door de background-functie (Task 3) en het vangnet (Task 6).
  - Functie `rapport-verwerk-background.js`: `export default async (req)` (v2; de bestandsnaam maakt er een Background Function van — geen `config.path`). Body `{ id }`; ongeldig id → return zonder werk.

`verwerkRapport`-flow: lees lijst → entry zoeken (`niet-gevonden`); status ∉ `wacht|bezig` → `overgeslagen`; inhoud lezen (ontbreekt → `naFout('Rapportinhoud ontbreekt')`); status `bezig` zetten (via `wijzigLijst`; `pogingen` ongewijzigd); `upload(...)`; `inProgress` → `al-bezig` (niets wijzigen); succes → `verwerking = {status:'in-zoho', …}` + `zohoUploaded:true`, `zohoAttachmentId`, `geannuleerd:false`; fout → `naFout`. Slaagt een `wijzigLijst` niet (`ok:false`) → gooi `Error` (Netlify's automatische retry + register maken dat veilig).

- [ ] **Step 1: Failing tests** (`tests/rapport-verwerking.test.mjs`, nep-store + nep-`upload`):
  - schema: `naFout` na poging 1 → `wacht`, `volgendePoging` = nu+5 min; poging 2 → +15; 3 → +30; 4 → +60; 5 → +120; poging 6 → `mislukt`, `volgendePoging === null`, `laatsteFout` gezet; met `maxPogingen: 1` → direct `mislukt`.
  - `moetStarten`: `wacht` met verstreken `volgendePoging` → true; `wacht` met toekomstige → false; `bezig` bijgewerkt 21 min geleden → true; 5 min geleden → false; entry **zonder `verwerking`** → false; `in-zoho`/`mislukt`/`lokaal` → false. *(Review Focus 3)*
  - `verwerkRapport` succes → entry `in-zoho`, `zohoUploaded:true`, `zohoAttachmentId` gezet; `upload` kreeg `verzendId === id`.
  - fout → `wacht`, `pogingen:1`, `laatsteFout` bevat de foutmelding; zesde fout → `mislukt`.
  - `in-zoho` entry → `overgeslagen`, `upload` niet aangeroepen; onbekend id → `niet-gevonden`; `upload` → `{inProgress:true}` → `al-bezig`, status blijft `bezig`.
  - ontbrekende inhoudsblob → `wacht` met `laatsteFout` "Rapportinhoud ontbreekt".
  - `testUpload` slaagt voor `'1001'`, gooit voor `'p2'`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implementeer** de drie lib-modules.
- [ ] **Step 4: Implementeer `rapport-verwerker.js` en `rapport-verwerk-background.js`** (dun): `store = getStore({ name: winkelNaam(req), consistency: 'strong' })`, `const { upload, maxPogingen } = maakVerwerker({ store, testModus: isTestVerzoek(req) })`, dan `verwerkRapport(id, { store, upload, maxPogingen })`. Testmodus heeft geen `zorgVoorTestkopie`-aanroep nodig (de inhoud is zojuist door `rapport-ontvangen` in de testopslag gezet).
- [ ] **Step 5: Run** `node --test tests/*.test.mjs` → PASS.
- [ ] **Step 6: Commit** `feat(upload): statusmachine en achtergrondverwerking van rapporten`

---

### Task 4: `POST /api/rapport-ontvangen` + dev-server-ondersteuning

**Files:**
- Create: `netlify/lib/rapport-ontvangst.js`, `netlify/lib/rapport-achtergrond.js`, `netlify/functions/rapport-ontvangen.js`
- Modify: `netlify/lib/rapport-inhoud.js` (+`valideerOntvangst`), `netlify/lib/testmodus.js` (`NIET_KOPIEREN` + `/^rapport-inhoud\//`), `netlify.toml` (`[functions.rapport-ontvangen] timeout = 26`), `dev-server.mjs`
- Test: `tests/rapport-ontvangst.test.mjs`

**Interfaces:**
- Consumes: `bouwEntry`, `voegToeOfWerkBij`, `wijzigLijst`, `effectieveStatus` (Task 1); `schrijfInhoud`, `verwijderInhoud`, `isGeldigId` (Task 3); `nieuweVerwerking` (Task 3).
- Produces:
  - `rapport-inhoud.js`: `MAX_HTML_TEKENS = 5_500_000`; `valideerOntvangst(body, { testModus = false } = {}): { ok: true, waarden: { id, archiveBody, html, ticketId, filename, isLocal } } | { ok: false, status: 400|413, fout: string }`. Regels: `id` UUID; `html` niet-lege string, anders 400; `html.length > MAX_HTML_TEKENS` → 413 met fout `"Rapport is te groot om te versturen (te veel foto's)."`; `archiveBody` object; `ticketId` = enkel cijfers, of leeg als `isLocal`, of (testmodus) willekeurig niet-leeg; `filename` default `'service-rapport.pdf'`.
  - `rapport-ontvangst.js`: `verwerkOntvangst({ store, body, nu = new Date(), testModus = false }): Promise<{ status: number, body: object, startNodig: boolean }>`. Succes: `{ status: 200, body: { ok: true, id }, startNodig }`; `startNodig` = entry staat op `wacht` (niet voor `lokaal`, `in-zoho`, `bezig`, `mislukt`). Fouten: validatie-status uit `valideerOntvangst`; Blobs-fout of `wijzigLijst → ok:false` → `503 { error: 'Rapportarchief tijdelijk niet bereikbaar, probeer opnieuw.' }`.
  - `rapport-achtergrond.js`: `startAchtergrondtaak({ origin, id, testModus = false, fetch: doFetch = globalThis.fetch, timeoutMs = 5000 }): Promise<boolean>` — `POST {origin}/.netlify/functions/rapport-verwerk-background` met `{ id }`, header `X-Blitz-Test: 1` bij testmodus; `true` bij 2xx; slikt alle fouten (→ `false`; het vangnet vangt het op).
  - Functie `rapport-ontvangen.js`: `export function maakHandler({ getStore, fetch })`, default = `maakHandler({ getStore, fetch: globalThis.fetch })`, `config = { path: '/api/rapport-ontvangen' }`; OPTIONS 204, niet-POST 405, CORS-header `*` zoals `rapport-verzonden.js`; `isTestVerzoek` → testopslag + `zorgVoorTestkopie`; na succes met `startNodig` → `await startAchtergrondtaak({ origin: new URL(req.url).origin, id, testModus })`; antwoord `200 { ok: true, id }`.

Flow `verwerkOntvangst`: valideren → `schrijfInhoud` (eigen key, eerst) → `wijzigLijst`: bestaat entry met hetzelfde `id` → `null` (ongewijzigd; `startNodig = effectieveStatus === 'wacht'`) anders nieuwe `bouwEntry(archiveBody + {id, ticketId}, {licht:true})` met `verwerking: nieuweVerwerking(isLocal ? 'lokaal' : 'wacht', nu)`, `inhoudBeschikbaar: true`, `zohoUploaded:false`, via `voegToeOfWerkBij`; `controle` = entry met dat id aanwezig; na succes `verwijderInhoud(vervangenId)` als die bestaat.

- [ ] **Step 1: Failing tests** (`tests/rapport-ontvangst.test.mjs`, nep-store/nep-fetch):
  - `nieuw rapport: inhoudsblob geschreven, lichte entry zonder _html/handtekeningen, status wacht, inhoudBeschikbaar true, startNodig true`
  - `lokaal rapport (isLocal, ticketId leeg): status lokaal, startNodig false`
  - **`zelfde id twee keer: één entry, tweede antwoord ok, status ongewijzigd`**; **`entry is al in-zoho: tweede POST laat in-zoho staan, startNodig false`**; `entry is wacht: tweede POST → startNodig true, nog steeds één entry` *(Review Focus 1)*
  - `dedup met ander id (zelfde ticket+datum): entry krijgt nieuw id, oude inhoudsblob verwijderd`
  - `html > 5 500 000 tekens → 413 met "te groot"-tekst, geen blob, geen entry` *(Review Focus 4)*
  - `ongeldig id (geen UUID) → 400`; `ticketId "abc" → 400`; `ticketId "t1" in testmodus → toegelaten`; `html ontbreekt → 400`
  - `store.get gooit → 503`
  - `startAchtergrondtaak`: roept de juiste URL + body aan, zet `X-Blitz-Test` in testmodus, geeft `false` (zonder te gooien) bij fetch-fout
  - `maakHandler`: POST → 200 en nep-fetch ontving één aanroep naar `/.netlify/functions/rapport-verwerk-background`; tweede POST met zelfde id nadat entry `in-zoho` is → geen tweede aanroep.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implementeer** de modules + functie; voeg `/^rapport-inhoud\//` toe aan `NIET_KOPIEREN` in `testmodus.js`; `netlify.toml` timeout.
- [ ] **Step 4: `dev-server.mjs` aanpassen** (kleine, afgebakende wijziging): (a) route `/.netlify/functions/<naam>` → dezelfde `callFunction`; (b) eindigt `<naam>` op `-background`: antwoord meteen `202` met lege body en voer de functie asynchroon uit (fouten loggen met `console.error('[BACKGROUND]', …)`); (c) de `Request`-URL gebruikt `req.headers.host` i.p.v. `http://localhost` zodat `new URL(req.url).origin` de poort bevat. Bestaande `/api/*`-routing blijft identiek.
- [ ] **Step 5: Run** `node --test tests/*.test.mjs` → PASS.
- [ ] **Step 6: Lokale rooktest** (`node blobs-local-bootstrap.mjs`, `X-Blitz-Test: 1` op elke curl):
  `ID=$(node -e "console.log(crypto.randomUUID())")`, POST `/api/rapport-ontvangen` met `{"id":"$ID","ticketId":"g1","filename":"t.pdf","isLocal":false,"html":"<p>x</p>","archiveBody":{"datum":"2026-10-08","technieker":"Tim","ticketId":"g1","ticketNumber":"1006","klant":"K","rapportData":{"_html":"<p>x</p>"}}}` → `{"ok":true,"id":"…"}`; na ±1 s `GET /api/rapport-archief` → entry met `verwerking.status === "in-zoho"`, `zohoUploaded:true`, **geen `_html`**; dezelfde POST nogmaals → nog steeds `ok`, nog één entry. Idem met `"ticketId":"p2"` → `verwerking.status === "mislukt"` (testmodus `maxPogingen: 1`), `laatsteFout` = "Testfout: Zoho onbereikbaar". Stop de server (opruimen).
- [ ] **Step 7: Commit** `feat(upload): /api/rapport-ontvangen met achtergrondtaak (lokaal gesimuleerd in dev-server)`

---

### Task 5: Archief-uitbreidingen — inhoud ophalen en "Opnieuw versturen"

**Files:**
- Modify: `netlify/functions/rapport-archief.js` (GET `?inhoud=<id>`; POST `{ opnieuw: <id> }`), `netlify/lib/rapportlijst.js` (+`zetOpnieuw`)
- Test: `tests/rapportlijst.test.mjs` (uitbreiden), `tests/rapport-ontvangst.test.mjs` (uitbreiden)

**Interfaces:**
- Consumes: `leesInhoud`, `isGeldigId` (Task 3); `startAchtergrondtaak` (Task 4); `wijzigLijst` (Task 1).
- Produces:
  - `rapportlijst.js`: `zetOpnieuw(rapports, id, nu = new Date()): { rapports, gevonden: boolean, zetten: boolean }` — enkel een entry met `effectieveStatus === 'mislukt'` wordt `verwerking = { status:'wacht', pogingen:0, volgendePoging:null, laatsteFout:null, bijgewerkt: nu }`; andere statussen onaangeroerd (`zetten:false`).
  - `GET /api/rapport-archief?inhoud=<id>` → `200 { id, html }`; ongeldig id → 400; ontbrekend → 404 `{ error: 'Rapportinhoud niet gevonden' }`. Bestaande GET (lijst, `?id=`) ongewijzigd.
  - `POST /api/rapport-archief` met `{ opnieuw: <id> }` (vóór de legacy-entry-opbouw afgehandeld): `wijzigLijst` + `zetOpnieuw`; niet gevonden → 404, niet-`mislukt` → `200 { ok:true, ongewijzigd:true }`, anders `startAchtergrondtaak` en `200 { ok:true, versie }`.

- [ ] **Step 1: Failing tests:** `zetOpnieuw: mislukt → wacht met pogingen 0 en laatsteFout null`; `zetOpnieuw: in-zoho blijft staan (zetten false)`; `zetOpnieuw: onbekend id → gevonden false`; (handler-niveau, via een kleine `maakHandler`-vorm of rechtstreeks de lib) `inhoud ophalen: bestaand id → html; onbekend → 404; ongeldig id → 400`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implementeer** (houd `rapport-archief.js` dun; de GET-inhoud/opnieuw-logica leeft in de lib). Testmodus: dezelfde `winkelNaam`/`zorgVoorTestkopie` als de rest van het bestand; `startAchtergrondtaak` krijgt `testModus: isTestVerzoek(req)`.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` → PASS. Rooktest lokaal (testmodus): rapport met ticketId `p2` → `mislukt`; `POST {"opnieuw":"<id>"}` → na ±1 s weer `mislukt` met `pogingen` opnieuw 1 (testmodus-limiet); `GET ?inhoud=<id>` → `{id, html:"<p>x</p>"}`.
- [ ] **Step 5: Commit** `feat(upload): rapportinhoud ophalen en mislukt rapport opnieuw versturen`

---

### Task 6: Vangnet (Scheduled Function) + migratie van oude entries

**Files:**
- Create: `netlify/lib/rapport-vangnet-logica.js`, `netlify/lib/rapport-vangnet-run.js`, `netlify/functions/rapport-vangnet.js`
- Modify: `netlify.toml`
- Test: `tests/rapport-vangnet.test.mjs`

**Interfaces:**
- Consumes: `moetStarten` (Task 3), `schrijfInhoud`/`leesInhoud` (Task 3), `wijzigLijst`/`stripZwareVelden` (Task 1), `startAchtergrondtaak` (Task 4), `verwerkRapport` (Task 3).
- Produces:
  - `rapport-vangnet-logica.js` (puur): `MAX_START_PER_RUN = 5`, `MAX_MIGRATIE_PER_RUN = 20`, `kiesTeStarten(rapports, nu, max = MAX_START_PER_RUN): string[]` (ids van entries met `moetStarten`, oudste eerst), `kiesTeMigreren(rapports, max = MAX_MIGRATIE_PER_RUN): object[]` (entries met niet-lege string `rapportData._html`), `maakMigratie(entry, nu): { inhoud: { id, html, ticketId, filename, isLocal }, lichteEntry }` (filename `rapport-${ticketNumber || ticketId}-${datum || 'onbekend'}.pdf`, `isLocal: false`; `lichteEntry` = `rapportData` zonder zware velden + `inhoudBeschikbaar: true`; **geen `verwerking` toevoegen** — oude entries blijven "oud").
  - `rapport-vangnet-run.js`: `voerVangnetUit({ store, start, verwerk, nu = new Date(), zelfVerwerken = false, tijdsbudgetMs = 20000 }): Promise<{ gestart: string[], gemigreerd: number }>`. Start-deel: per id `start(id)`; met `zelfVerwerken` enkel de eerste en `verwerk(id)` (terugvaloptie als Background Functions op het abonnement ontbreken). Migratie-deel: per entry eerst `schrijfInhoud` (overslaan als de blob al bestaat), daarna **één** `wijzigLijst` die de lichte versies in de lijst zet (`controle`: geen van die entries heeft nog `_html`); stopt zodra `tijdsbudgetMs` verstreken is (de functie heeft 30 s).
  - Functie `rapport-vangnet.js`: `export default async (req)`; `winkelNaam(req)` (lokaal testbaar met `?test`-header); `origin = process.env.URL || 'https://blitz-planning.netlify.app'`, in testmodus `new URL(req.url).origin`; `zelfVerwerken = process.env.BLITZ_VANGNET_ZELF === '1'` (zet Brent/opzichter alleen als de live-proef toont dat Background Functions niet draaien); `verwerk = id => verwerkRapport(id, { store, ...maakVerwerker({ store, testModus }) })` (factory uit Task 3).
  - `netlify.toml`: `[functions.rapport-vangnet]` + `schedule = "*/5 * * * *"`.

- [ ] **Step 1: Failing tests** (`tests/rapport-vangnet.test.mjs`):
  - `kiesTeStarten: respecteert max 5 en volgorde; negeert entries zonder verwerking, in-zoho, mislukt` *(Review Focus 3)*
  - `kiesTeStarten: bezig > 20 min wordt opnieuw gestart, bezig < 20 min niet`
  - `kiesTeMigreren: enkel entries met inline _html, max 20`
  - `maakMigratie: html naar inhoud, lichte entry zonder _html/handtekeningen met inhoudBeschikbaar true, zonder verwerking-veld`
  - `voerVangnetUit: migreert 20 van 25 per run; tweede run de resterende 5; inhoudsblobs bestaan; lijst bevat geen _html meer; entries blijven in dezelfde volgorde en behouden alle andere velden (zohoUploaded, verzondenKlant…)`
  - `voerVangnetUit: migratie slaat een entry over waarvan de blob al bestaat zonder ze te herschrijven`
  - `voerVangnetUit: zelfVerwerken → verwerk() voor precies 1 rapport, start() nooit`
  - `voerVangnetUit: tijdsbudget 0 → geen migraties`
- [ ] **Step 2: Run** → FAIL. **Step 3: Implementeer** + `netlify.toml`.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` → PASS. Rooktest lokaal: `curl -X POST localhost:3333/api/rapport-vangnet -H "X-Blitz-Test: 1"` (de dev-server roept de default-export aan) → JSON/200 en in de testopslag staan oude entries met `_html` na een paar runs zonder `_html`. (Op productie is de functie niet per URL aan te roepen; de eerste echte run controleert de opzichter in het Netlify-dashboard, "Run now".)
- [ ] **Step 5: Commit** `feat(upload): vangnet (elke 5 min) en migratie van oude rapport-HTML`

---

### Task 7: Gedeeld klassiek script `public/js/outbox-verzend.js`

**Files:**
- Create: `public/js/outbox-verzend.js`
- Test: `tests/outbox-verzend.test.mjs` (importeert `import verzend from '../public/js/outbox-verzend.js'` — het bestand heeft geen `import/export`, Node 24 behandelt het als CommonJS en `module.exports` is de default)

**Interfaces:**
- Produces: object `outboxVerzend` (UMD: `globalThis.outboxVerzend = api` én `module.exports = api` als `module` bestaat), géén DOM- of `window`-gebruik, werkt in pagina en service worker:
  - `OUTBOX_DB_NAME = 'blitz-rapport-outbox'`, `OUTBOX_DB_VERSION = 1`, `OUTBOX_STORE = 'items'` (zelfde waarden als nu — bestaande IndexedDB blijft geldig)
  - `openDb(): Promise<IDBDatabase>`, `getAll(): Promise<object[]>`, `put(item): Promise<void>`, `remove(id): Promise<void>`
  - `nextAction(item): 'ontvangen' | 'done'` — `'done'` enkel bij `item.ontvangen === true`; alles anders (ook oude items `archived:true, zohoUploaded:false`) → `'ontvangen'`
  - `bouwOntvangenBody(item): { id, archiveBody, html, ticketId, filename, isLocal }` — `archiveBody` = `item.archiveBody` met `rapportData` via dezelfde strip als de server (zonder `_html`, `handtekeningTech`, `handtekeningKlant`); `html = item.html`; `ticketId = item.ticket.id`; `filename = item.ticket.filename`; `isLocal = !!item.isLocal`; muteert `item` niet
  - `vertaalFout({ status, data, netwerkFout?, timeout? }): string` — 413 → `"Rapport is te groot om te versturen (te veel foto's). Meld dit aan de planner."`; 400/overige → `data.error` of `"Server (<status>)"`; timeout → `"Geen antwoord van de server (time-out)"`; netwerkfout → `"Geen verbinding"`
  - `verzendItem(item, { fetch, signal, timeoutMs = 60000 }): Promise<{ ok: true } | { ok: false, fout: string, status: number, afgebroken?: true }>` — `POST /api/rapport-ontvangen` (JSON, `Content-Type`), header `X-Blitz-Test: 1` als `item.testModus`; `ok` enkel bij HTTP 200 met `data.ok === true`
  - `metSlot(id, fn): Promise<{ uitgevoerd: boolean, waarde?: any }>` — Web Locks (`navigator.locks.request('blitz-outbox-' + id, { ifAvailable: true }, …)`); lock bezet → `{ uitgevoerd: false }`; geen Web Locks beschikbaar → gewoon uitvoeren (server is idempotent)
  - `verzendAlles({ fetch, opslag = { getAll, remove, put }, slot = metSlot }): Promise<{ verstuurd: number, mislukt: number }>` — per item `slot` → `verzendItem` → bij `ok` `opslag.remove(id)`, anders `mislukt++` en `lastError`/`attempts` bijwerken via `opslag.put`; gooit **niet** (de service worker beslist zelf)

- [ ] **Step 1: Failing tests:**
  - **`bouwOntvangenBody: oud item (archived:true, zohoUploaded:false, rapportData._html gevuld) → body zonder _html en zonder handtekeningen, html = item.html, item onveranderd`** *(Review Focus 2)*
  - `nextAction: nieuw item → ontvangen; oud archived/zohoUploaded item → ontvangen; ontvangen:true → done`
  - `verzendItem: 200 {ok:true} → ok; juiste URL, methode POST, body = bouwOntvangenBody; geen test-header; testModus-item → X-Blitz-Test: 1`
  - **`verzendItem: 413 → fout met "te groot"; 400 met data.error → die tekst; 503 → "Server (503)"`** *(Review Focus 4)*
  - `verzendItem: fetch gooit → "Geen verbinding"; timeout (nep-fetch die op de signal wacht, timeoutMs 10) → time-out-tekst; externe signal geaborteerd → afgebroken:true`
  - `metSlot: lock bezet → uitgevoerd false; zonder navigator.locks → uitgevoerd true` (globalThis.navigator-stub)
  - `verzendAlles: twee items, één ok één 500 → item 1 verwijderd, item 2 blijft met lastError en attempts+1; verstuurd 1, mislukt 1; slot bezet → item overgeslagen en niet geteld als mislukt`
- [ ] **Step 2: Run** `node --test tests/outbox-verzend.test.mjs` → FAIL. **Step 3: Implementeer** het bestand; IndexedDB-functies zijn 1-op-1 de huidige `outboxOpenDb/outboxAdd/outboxGetAll/outboxRemove` (niet getest in Node; gedekt in Task 8/11).
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` → PASS.
- [ ] **Step 5: Commit** `feat(upload): gedeeld verzendscript voor pagina en service worker`

---

### Task 8: `outbox.js` en wizard op één stap + `?test&upload`

**Files:**
- Create: `public/js/test-upload.js`
- Modify: `public/js/outbox.js`, `public/js/rapport-wizard.js` (`printRapport`, ~r.1340-1420), `public/index.html` (**enkel** `<script src="/js/outbox-verzend.js"></script>` vóór de module-scripts en `<script type="module" src="/js/test-upload.js">`), `public/sw.js` (alleen `SHELL` uitbreiden met `/js/outbox-verzend.js` en `/js/test-upload.js`)
- Test: handmatig in de browser (hieronder); de logica zit in Task 7.

**Interfaces:**
- Consumes: `outboxVerzend` (Task 7, via `globalThis.outboxVerzend`).
- Produces: `test-upload.js`: `export const TEST_UPLOAD = new URLSearchParams(location.search).has('test') && new URLSearchParams(location.search).has('upload')`. Item-vorm (nieuw): `{ id, html, isLocal, ontvangen: false, attempts: 0, lastError: null, createdAt, testModus: TEST_MODE, ticket: { id, number, filename }, archiveBody }` (géén `archived`/`zohoUploaded` meer). `outbox.js` houdt zijn bestaande exports en `window`-bridges (`outboxAdd`, `outboxGetAll`, `outboxRemove`, `outboxPut`, `nextOutboxAction`, `attemptOutboxItem`, `runOutboxItem`, `flushOutbox`, `refreshOutboxCache`, `renderOutboxBanner`, `outboxCancelItem`, `outboxRetryNow`, `outboxStepLabel`, `logOutboxFailure`) maar delegeert opslag en verzending aan `outboxVerzend`.

- [ ] **Step 1: `outbox.js` ombouwen:**
  - `outboxOpenDb/outboxAdd/outboxGetAll/outboxRemove/outboxPut` → dunne wrappers rond `outboxVerzend.openDb/put/getAll/remove`; constanten uit `outboxVerzend`.
  - `nextOutboxAction = outboxVerzend.nextAction`.
  - `attemptOutboxItem(item)`: testmodus-guard wordt `if (TEST_MODE && !TEST_UPLOAD)` (zelfde "Testmodus — niet verzonden"-gedrag als nu); anders `outboxVerzend.metSlot(item.id, () => outboxVerzend.verzendItem(item, { fetch: window.fetch.bind(window), signal }))` met de bestaande `AbortController`-registratie (`_outboxAbortControllers`) voor annuleren; `uitgevoerd:false` → `return item` (andere context verstuurt); `ok` → `outboxRemove(item.id)`; anders `logOutboxFailure(item, 'ontvangen', fout)` (backoff, `/api/client-log`, zoals nu). Verwijder de stappen archive/check-zoho/confirm, `logOutboxWait`, de 409-tak en de `_archiefVersie`-bijwerking.
  - `outboxStepLabel(item)` → `'Wordt verstuurd…'`. `menselijkeOutboxFout` blijft (vangt de bestaande ticket-meldingen).
  - `outboxCancelItem(id)`: confirm-tekst `'Dit rapport gaat volledig verloren — het is nog niet naar de server verstuurd. Doorgaan?'`; geen archief-POST meer; wel eerst de lopende poging aborten en afwachten (bestaande logica), dan verwijderen. De oude tekst over "blijft bewaard in het archief" vervalt.
- [ ] **Step 2: `printRapport` in `rapport-wizard.js`:** `if (TEST_MODE && !TEST_UPLOAD)` i.p.v. `if (TEST_MODE)`; nieuw item-schema (zie Interfaces, incl. `testModus: TEST_MODE`); in `archiveBody.rapportData` **geen `_html` meer** en `handtekeningTech`/`handtekeningKlant` mee uitsluiten (`({ fotos, handtekeningTech, handtekeningKlant, ...rest }) => rest`); toasts: klaar → `'✓ Rapport verstuurd — het wordt op de achtergrond naar Zoho gestuurd'` (lokaal: `'✓ Rapport opgeslagen in archief — geen Zoho-ticket gekoppeld'`), `timeout`-toast ongewijzigd. Het resultaat `'done'` wordt herkend als het item niet meer in IndexedDB staat (na succes verwijdert `attemptOutboxItem` het); gebruik `nextOutboxAction(result) === 'done' || result.ontvangen === true` na zetten van `item.ontvangen = true` vóór verwijderen in `attemptOutboxItem`.
- [ ] **Step 3: Verifieer in de browser** (`node blobs-local-bootstrap.mjs`, `http://localhost:3333/?test&upload`): rapport voor ticket 1006 invullen en verzenden → balk toont kort "Wordt verstuurd…" en verdwijnt; Rapporten-tab → ↺ Herladen toont het rapport (nog zonder badge — Task 10); `GET /api/rapport-archief` (testheader via curl) bevat de entry met `verwerking.status = "in-zoho"` en zonder `_html`. Console zonder fouten. Zonder `&upload` (`?test`) gedrag als vóór deze taak (niets verzonden, afdrukvoorbeeld). Netwerk uit in DevTools → item blijft met "Geen verbinding" in de balk; netwerk aan → "Opnieuw proberen" verstuurt het.
- [ ] **Step 4: Commit** `feat(upload): outbox verstuurt in één stap naar /api/rapport-ontvangen`

---

### Task 9: Android Background Sync in de service worker

**Files:**
- Create: `public/js/outbox-sync.js`
- Modify: `public/sw.js`, `public/js/rapport-wizard.js` (één aanroep na `outboxAdd`), `public/index.html` (enkel `<script type="module" src="/js/outbox-sync.js">`)
- Test: handmatig (browser/DevTools), logica gedekt door `verzendAlles` (Task 7).

**Interfaces:**
- Consumes: `outboxVerzend.verzendAlles` (Task 7).
- Produces: `outbox-sync.js`: `export async function registreerAchtergrondVerzending(): Promise<boolean>` — `const reg = await navigator.serviceWorker.ready; if (!('sync' in reg)) return false; await reg.sync.register('rapport-outbox'); return true`; alle fouten ingeslikt (→ `false`); bridge `window.registreerAchtergrondVerzending`. `sw.js`: `sync`-event voor tag `rapport-outbox`.

- [ ] **Step 1: `sw.js`:** bovenaan `try { importScripts('/js/outbox-verzend.js'); } catch (e) { /* offline install-race: SW blijft werken zonder sync */ }`; `SHELL` uitbreiden met `/js/outbox-sync.js`; `self.addEventListener('sync', e => { if (e.tag === 'rapport-outbox' && self.outboxVerzend) e.waitUntil(self.outboxVerzend.verzendAlles({ fetch: self.fetch.bind(self) }).then(r => { if (r.mislukt) throw new Error('Rapporten niet verstuurd'); })); })` — gooien zorgt dat de browser later opnieuw probeert. Vervang het oude commentaarblok over "bewust geen Background Sync" door een uitleg van de nieuwe werking (Android: ja; iOS/Safari: ontbreekt `sync`, dus hervatten bij openen). `CACHE_NAME` **niet** hier ophogen (Task 12).
- [ ] **Step 2: Wizard:** na `await outboxAdd(item)` → `window.registreerAchtergrondVerzending?.();` (niet afgewacht). Ook in `outboxRetryNow` (Task 8-bestand) na het zetten van een nieuwe poging: zelfde aanroep.
- [ ] **Step 3: Verifieer** (Chrome, `http://localhost:3333/?test&upload`, DevTools → Application → Service Workers): netwerk uit → rapport verzenden → item blijft in de balk, DevTools → Background Services → Background Sync toont een geregistreerde `rapport-outbox`; netwerk aan zónder de pagina te herladen of aan te raken (of met het tabblad naar de achtergrond) → de SW verstuurt: het item verdwijnt uit IndexedDB (Application → IndexedDB → `blitz-rapport-outbox`) en het rapport staat in de testopslag. In DevTools "Sync" knop (tag `rapport-outbox`) werkt als handmatige trigger. Geen dubbel rapport als pagina én SW gelijktijdig sturen (Web Lock) — controleer `GET /api/rapport-archief`: één entry.
- [ ] **Step 4: Commit** `feat(upload): Background Sync in de service worker (Android)`

---

### Task 10: Rapporten-tab — badges, opnieuw versturen, melding, inhoud ophalen

**Files:**
- Create: `public/js/rapport-inhoud.js`, `public/js/rapport-status.js`
- Modify: `public/js/rapport-archief.js` (`renderRapportArchief`, `herOpenRapport`, `laadRapportArchief`), `public/index.html` (**enkel** 4 `<script type="module">`-tags en de twee 1-op-1 vervangingen in `voorbeeldRapport`/`verstuurRapport`: `const html = r.rapportData?._html;` → `const html = await haalRapportHtml(r);`), `public/sw.js` (`SHELL` + beide bestanden)
- Test: `tests/rapport-status.test.mjs`, `tests/rapport-inhoud.test.mjs`

**Interfaces:**
- Consumes: server `GET /api/rapport-archief?inhoud=<id>` en `POST /api/rapport-archief {opnieuw}` (Task 5).
- Produces:
  - `rapport-inhoud.js`: `heeftRapportInhoud(r): boolean` (`!!r?.rapportData?._html || r?.inhoudBeschikbaar === true`), `haalRapportHtml(r, { fetch = globalThis.fetch } = {}): Promise<string|null>` (inline `_html` eerst; anders `GET ?inhoud=<id>`; resultaat in een `Map` per id gecached; fouten/404 → `null`); `window.haalRapportHtml`, `window.heeftRapportInhoud` (bridge; `window`-gebruik achter `typeof window !== 'undefined'` zodat Node-tests het bestand kunnen importeren).
  - `rapport-status.js`: `effectieveStatus(r)` (zelfde mapping als de server), `statusBadgeHtml(r): string` (*In verwerking* voor `wacht`/`bezig`, *In Zoho*, *Mislukt* — rood, `title` = `escHtml(laatsteFout)`, *Lokaal*; `geannuleerd`/`onbekend` → `''`), `opnieuwKnopHtml(r): string` (enkel bij `mislukt`; `data-rapport-id`, klasse `btn-opnieuw-rapport`), `opnieuwVersturen(id): Promise<{ ok: boolean, fout?: string }>`, `misluktMeldingTekst(r): string` (exact de spec-tekst met `#<ticketNumber>`), `teMeldenMislukt(rapporten, { technieker, gezien }): object[]` (status `mislukt`, `r.technieker` gelijk aan `technieker` — hoofdletter- en spatie-ongevoelig —, id niet in `gezien: Set`), `toonMisluktMeldingen(rapporten)` (rol `technieker` én `activeAssigneeFilter !== 'all'`; "gezien" in `localStorage['blitz_mislukt_gezien']` als JSON-array van ids, alles in try/catch; één `toast(...)` per laad, meerdere rapporten samengevat; testmodus overgeslagen). HTML-opbouw gebruikt de globale `escHtml`.
- Aanpassingen `rapport-archief.js`: badge + knop in de kaart (naast bestaande `inWachtrij`), `Openen`/`Verstuur rapport` conditioneel op `heeftRapportInhoud(r)` i.p.v. `rd._html`, click-handler voor `.btn-opnieuw-rapport` (data-attribuutpatroon, **geen inline onclick**) → `opnieuwVersturen` → `laadRapportArchief()`; `herOpenRapport(idx)` wordt `async`: **`window.open('', '_blank')` blijft synchroon als eerste actie** (pop-upblokkering), daarna `await haalRapportHtml(r)`; `null` → venster sluiten + `toast('Geen opgeslagen HTML beschikbaar')`; `laadRapportArchief` roept na een geslaagde lading `toonMisluktMeldingen(_rapportArchief)` aan (één keer per paginasessie).

- [ ] **Step 1: Failing tests** (`tests/rapport-status.test.mjs`, `globalThis.escHtml` in de test gedefinieerd; `tests/rapport-inhoud.test.mjs` met nep-fetch):
  - `effectieveStatus` mapt oude entries (`zohoUploaded`→in-zoho, `geannuleerd`, onbekend) *(Review Focus 3)*
  - `statusBadgeHtml`: tekst per status; `mislukt` bevat de rode stijl/klasse en `title`; `onbekend`/`geannuleerd` → `''`
  - **`laatsteFout = '"><img src=x onerror=alert(1)>'` komt ge-escaped in het title-attribuut (geen `<img`, geen losse `"`)`; `ticketNumber '<b>1</b>'` in `misluktMeldingTekst`-gebruik wordt ge-escaped bij weergave** *(Review Focus 5)*
  - `opnieuwKnopHtml`: enkel bij `mislukt`; `data-rapport-id` ge-escaped
  - `teMeldenMislukt`: negeert andere technieker, al geziene ids en niet-mislukte; `misluktMeldingTekst` = `"Rapport #1234 kon niet naar Zoho. Je hoeft niets opnieuw in te vullen; kantoor is verwittigd."`
  - `heeftRapportInhoud`: inline `_html` → true; `inhoudBeschikbaar:true` → true; geen van beide → false
  - `haalRapportHtml`: inline `_html` → geen fetch; anders één `GET /api/rapport-archief?inhoud=<id>`, tweede aanroep komt uit de cache; 404 → `null`; fetch gooit → `null`
- [ ] **Step 2: Run** → FAIL. **Step 3: Implementeer** beide modules; pas `rapport-archief.js` en de twee `index.html`-plekken aan; voeg de bestanden toe aan `SHELL`.
- [ ] **Step 4: Run** `node --test tests/*.test.mjs` → PASS.
- [ ] **Step 5: Verifieer in de browser** (`?test&upload`): Rapporten-tab toont *In Zoho* op een geslaagd testrapport; een rapport voor ticket `p2` (of een curl-POST met `ticketId:"p2"`) toont rood *Mislukt* met tooltip "Testfout: Zoho onbereikbaar" en de knop **Opnieuw versturen** (klik → blijft `Mislukt` in testmodus, `pogingen` opnieuw 1); bij heropenen van de app (rol technieker, filter op de betreffende persoon) verschijnt de melding één keer. 📄 Openen op een gemigreerd/nieuw rapport opent het rapport (HTML via `?inhoud=`), ook zonder `_html` in de lijst; ✉️ Verstuur rapport geeft het voorbeeldvenster. `git diff public/index.html` toont enkel de script-tags en de twee 1-regel-vervangingen.
- [ ] **Step 6: Commit** `feat(upload): rapportstatus, opnieuw versturen en melding in het Rapporten-tabblad`

---

### Task 11: Lokale end-to-end verificatie (testmodus) en opruimen

**Files:** geen nieuwe productiecode; fouten die hier opduiken worden in de taak hersteld waar ze ontstonden (extra commit `fix(upload): …`).

**Interfaces:** consumeert alles; produceert een korte verificatienota in het verslag van de executor (geen bestand).

- [ ] **Step 1: Volledige flow** (`node blobs-local-bootstrap.mjs`, `?test&upload`): rapport verzenden → *In Zoho* binnen enkele seconden; Netwerk-uit tijdens verzenden → blijft in balk → netwerk aan → verstuurd; tabblad naar achtergrond bij verzenden → rapport komt aan (SW of volgende poging).
- [ ] **Step 2: Oude IndexedDB-items** (Review Focus 2): zet in DevTools → Application → IndexedDB → `blitz-rapport-outbox` → `items` handmatig een item van vóór de update (`archived:true, zohoUploaded:false`, `archiveBody.rapportData._html` gevuld, `testModus:true`, geldige UUID als `id`) → pagina herladen → item gaat via `rapport-ontvangen`, verdwijnt uit de balk, rapport staat éénmaal in de lijst, zonder `_html`.
- [ ] **Step 3: Oude app-versie** (compat): `curl` met testheader: oude vorm `POST /api/rapport-archief` (met `rapportData._html`) + `POST /api/rapport` + bevestigings-POST (`zohoUploaded:true`) blijven werken; entry heeft `_html`, badge *In Zoho*; `POST /api/rapport-vangnet` (testheader) migreert het naar `rapport-inhoud/<id>` en 📄 Openen werkt daarna nog.
- [ ] **Step 4: Mislukt-pad:** ticket `p2` → *Mislukt* + melding + **Opnieuw versturen**; ticket met een HTML > 5 500 000 tekens (curl) → 413 met "te groot"-tekst; item in de balk toont de vertaalde fout.
- [ ] **Step 5: Zonder `&upload`** (`?test`): geen enkel verzoek naar `/api/rapport-ontvangen` (Network-tab), afdrukvoorbeeld werkt als vroeger. Zonder `?test` **niet** uitvoeren.
- [ ] **Step 6: Alles groen:** `node --test tests/*.test.mjs`; browserconsole zonder fouten; `git status` toont enkel bedoelde bestanden (`.blobs-local-test/` en `.env.local` genegeerd).
- [ ] **Step 7: Opruimen** (skill `opruimen-na-werk`): dev-server/blobs-bootstrap stoppen, poort 3333 vrij, achtergebleven node/chrome-processen stoppen.

---

### Task 12: Release-voorbereiding v1.10.2 (niet pushen)

**Files:**
- Modify: `package.json` (`"version": "1.10.2"`), `package-lock.json` (de twee `"version": "1.10.1"`-regels bovenaan), `CHANGELOG.md`, `public/sw.js` (`CACHE_NAME`: `blitz-planning-v25` → `blitz-planning-v26`)

- [ ] **Step 1:** `CHANGELOG.md` — nieuwe sectie `## [1.10.2] — <datum van afronden>` boven `[1.10.1]` (en `[Unreleased]` leeg laten) met onder **Fixed**: rapporten uploaden nu op de server in plaats van op de telefoon (werkt bij vergrendeld scherm; Android via Background Sync, iOS bij heropenen); het rapport gaat in één korte overdracht en wordt niet meer dubbel verstuurd; rapportlijst wordt licht (HTML en foto's apart bewaard, oude rapporten worden automatisch verhuisd); status per rapport (*In verwerking / In Zoho / Mislukt / Lokaal*) met knop **Opnieuw versturen** en een melding aan de technieker bij een definitieve fout; automatisch opnieuw proberen (5 min → 2 u) met vangnet elke 5 minuten. Onder **Changed**: Annuleren kan enkel zolang het rapport nog niet naar de server verstuurd is.
- [ ] **Step 2:** versies en `CACHE_NAME` ophogen; controleer dat `SHELL` in `sw.js` alle nieuwe clientbestanden bevat (`/js/outbox-verzend.js`, `/js/outbox-sync.js`, `/js/test-upload.js`, `/js/rapport-inhoud.js`, `/js/rapport-status.js`) en dat elk bestand effectief bestaat (anders faalt `cache.addAll` en installeert de SW niet).
- [ ] **Step 3: Eindcontrole:** `node --test tests/*.test.mjs` groen; `git diff main --stat` bevat geen `.env*`/`.blobs-local-test`; `git log main..fix/upload-achtergrond` toont de taakcommits.
- [ ] **Step 4: Commit** `chore: v1.10.2 — rapport-upload op de achtergrond`. **Niet taggen, niet pushen, niet mergen.** Overdracht aan de opzichter, die dit nog doet na akkoord van Brent:
  1. `git tag v1.10.2` op de deploy-commit, push naar `main` (alleen na akkoord Brent; pre-push-hook niet omzeilen);
  2. in het Netlify-dashboard controleren dat `rapport-verwerk-background` als *Background* en `rapport-vangnet` als *Scheduled* (`*/5 * * * *`) verschijnen;
  3. **live-proef met Brent** op een testticket (zonder `?test`): rapport verzenden, scherm meteen vergrendelen, nakijken dat de PDF in Zoho staat en het rapport op *In Zoho* komt; staat het na ±10 min op *In verwerking*, dan werken Background Functions niet → zet env-var `BLITZ_VANGNET_ZELF=1` (terugvaloptie, max. 1 rapport per 5 min);
  4. daarna `git merge main` in `.claude/worktrees/planner-brein` en noteren in de ledger van de refactor (conflicten in `outbox.js`/`rapport-wizard.js`/`rapport-archief.js` vanwege de `public/js/kern/…`-structuur).
