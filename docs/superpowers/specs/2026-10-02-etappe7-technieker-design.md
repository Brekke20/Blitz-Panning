# Etappe 7 — Technieker: laadsnelheid, service worker en slechte verbinding — design

Datum: 2026-10-02 · Opdrachtgever: Brent Calaerts · Tak: `refactor` (worktree `.claude/worktrees/planner-brein`) · Basis: HEAD c37c92e, baseline 745 unit + 412 e2e groen.
Roadmap: `docs/superpowers/specs/2026-10-01-refactor-roadmap-design.md` §4 rij 7 (rulings W1–W12). Voorgaande etappes: 2, 3, 4, 5a, 5b, 6 klaar.

## 1. Doel en afbakening

Etappe 7 is de etappe "beter voor de technieker" (roadmap §1 doel 3): snelheid en betrouwbaarheid op gsm en tablet, ook met een slechte verbinding. Drie onderdelen uit de roadmap:

1. **Laadsnelheid**: modules pas laden als nodig, waar dat het gedrag identiek houdt.
2. **Service worker**: caching van de modules (en wat er nog ontbreekt).
3. **Slechte verbinding**: een duidelijke melding en geen half-opgeslagen toestand.

Daarnaast, als overdracht uit etappe 3 en 5: toegankelijkheid (focus na Escape in 4 dialogen) en het slepen dat door een achtergrondrender wordt afgebroken.

**Buiten scope**:
- De rapportwizard (W11, D19): geen enkele wijziging in `rapport-wizard.js`. Wat daar wel pijn doet bij een slechte verbinding staat in §7 als vraag voor Brent.
- `outbox.js` en `/api/rapport*` (W11): ongewijzigd; ze hebben al timeouts, backoff en een IndexedDB-wachtrij (T20).
- Alles wat voor de gebruiker iets nieuws toont, of wat na een klantmail gebeurt: §7 (vragen), niet beslist.
- `CACHE_NAME`, versienummer en `package.json`: niet op `refactor` (CLAUDE.md "Branchbeleid"); zie N4 en N5.
- Een bouwstap, bundler of framework (W1).
- Een extern netwerk-hulpprogramma of Workbox (geen nieuwe dependency, W4).

## 2. Uitgangspunten (geverifieerd in de code en met proeven, 2026-10-02)

### 2.1 De modulegraaf (gemeten met een scan van de `import`-regels vanaf de scripttags van `index.html`)

| Feit | Waarde |
|---|---|
| Modules in de graaf | **46** `.js`-bestanden onder `public/js/` (13 entry's in `index.html`: `apparaat.js` klassiek, de rest `type="module"`) |
| Totaal | **623 969 bytes** ruw, **204 147 bytes** gzip (CSS: 5 bestanden, 107 KB ruw, 22,7 KB gzip; `index.html` 38 KB ruw, 8,4 KB gzip) |
| Diepte | de langste importketen is **10 niveaus**: `app.js > fotos.js > rapport-wizard.js > ticketdetail.js > kalender.js > route.js > route-kaart.js > ui.js > verklikker.js > omgeving.js`. Een module wordt pas opgehaald nadat zijn ouder geparsed is: bij 300 ms heen-en-terug is dat ± 3 s alleen aan ontdekking |
| Wie importeert wat | `brug.js` importeert 25 modules (alle schermen, `prijzen.js`, `rapport-archief.js`); `app.js` importeert 37. Vrijwel de hele graaf is dus **statisch** en eager; `window.kern.<scherm>` (door e2e en `window-namen.test.mjs` gebruikt) bestaat omdat `brug.js` ze importeert |
| Grootste bestanden (ruw / gzip) | `rapport-wizard.js` 80 860 / 22 188 · `route.js` 50 556 / 16 473 · `app.js` 49 262 / 14 513 · `kalender.js` 44 670 / 13 795 · `beschikbaarheid.js` 27 079 / 6 665 · `outbox.js` 23 937 / 8 158 · `planacties.js` 23 015 / 7 037 · `inventaris.js` 22 933 / 7 348 · `route-kaart.js` 22 613 / 8 036 · `planner.js` 22 264 / 7 283 · `prijzen.js` 19 682 / 5 392 · `excel-export.js` 8 772 / 3 281 |
| Importeurs van de lazy-kandidaten | `rapport-wizard.js` ← `fotos.js` (cyclus), `app.js` · `excel-export.js` ← enkel `app.js` · `inventaris.js` ← enkel `app.js` · `prijzen.js` ← `brug.js`, `inventaris.js`, `app.js` |

### 2.2 De externe scripts (klassiek, synchroon, onderaan `index.html`; gemeten met `curl`)

| Bibliotheek | Ruw | Over de draad (gzip) | Gebruik |
|---|---|---|---|
| Leaflet 1.9.4 (js + css, cdnjs) | 147 171 + 10 879 | 42 440 + 2 622 | `initMap()` bij de opstart (`app.js`), enkel het Route-tabblad toont de kaart |
| signature_pad 4.1.7 (cdnjs) | 11 374 | 3 772 | enkel in de wizard, gelezen als `window.SignaturePad` op het moment van gebruik |
| **ExcelJS 4.4.0 (jsdelivr)** | **947 702** | **257 676** | enkel `exportTicketLog()` (📊 Excel export); `new ExcelJS.Workbook()` staat in de `try` van die functie |

### 2.3 De service worker (`public/sw.js`, `CACHE_NAME` v25)

- `install`: `caches.open(CACHE_NAME).addAll(SHELL)`; SHELL telt 55 bestanden (alle modules, CSS, `index.html`, `manifest.json`). Faalt één bestand (404), dan faalt de hele installatie. Niets toetst dat SHELL klopt met wat op schijf staat.
- `activate`: alle caches met een andere naam weg; `skipWaiting` en `clients.claim`.
- `fetch`: `/api/` niet afgehandeld; al het andere `fetch(e.request).catch(() => caches.match(e.request))`: **netwerk eerst, zonder timeout**; de cache is een momentopname van de installatie (wordt nooit ververst bij succes).
- Gevolgen, gemeten of afgeleid uit de code:
  1. **Geen time-out**: bij een trage of hangende verbinding wacht de pagina op het netwerk terwijl de volledige app al in de cache staat.
  2. **De externe scripts en stijlen staan niet in de cache** (Leaflet, signature_pad, ExcelJS, Leaflet-css, Google Fonts): offline of met een hangende CDN ontbreken ze. De opstartcode vangt een falende kaart al op (`initMap` in `try/catch`, bugronde 2026-09-22 item G).
  3. `caches.match(e.request)` houdt rekening met de querystring: `/?x=1` offline vindt geen `/`.
  4. `serviceWorker.register('/sw.js')` zonder `updateViaCache`.

### 2.4 Proeven (Playwright 1.63 + Chromium, wegwerpscripts buiten de repo)

| Proef | Uitkomst |
|---|---|
| Een hangende CDN-host blokkeert de app | **Bevestigd.** Met `cdn.jsdelivr.net` (ExcelJS) of `cdnjs.cloudflare.com` (Leaflet) die nooit antwoordt, start de app niet binnen 8 s (`window.kern` bestaat niet); met snelle CDN's na 359 ms. Reden: klassieke scripts blokkeren de parser; module-scripts lopen pas erna. Dit is dé "slechte verbinding"-valkuil bij de opstart. |
| Service worker onder Playwright (`serviceWorkers: 'allow'`) | Werkt: registratie, `ready`, `controller` na herladen, 55 bestanden in `blitz-planning-v25`. |
| Ziet `context.route` de verzoeken **van de service worker zelf**? | **Ja.** `request.serviceWorker()` is gevuld; 126 van de 200 verzoeken in de proef kwamen van de SW. De bestaande vangnetroutes (alle op `context`) bewaken dus ook de SW. |
| `/api`-verzoeken met een controlerende SW | Komen van de pagina (`serviceWorker()` is `null`), want de SW handelt `/api/` niet af; ze lopen door de `/api`-stubs. |
| Offline herladen (`context.setOffline(true)`) | De app start uit de cache (6 tabs, offline-balk zichtbaar, 0 serververzoeken). |
| `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE …"` als Chromium-argument | Werkt: een directe fetch naar een niet-uitgesloten host faalt op DNS-niveau, ook voor de SW (browser-breed). Dit is een vierde slot onder de route-sloten. |
| Een nooit-antwoordende route (`hangen`) en `route.abort()` | Werken met `page.clock`; beëindigen netjes bij het sluiten van de context. |

### 2.5 Schrijfpaden: inventaris van het huidige gedrag bij een slechte verbinding

Alle `fetch`-aanroepen in `public/js` (46). Er is **nergens een client-timeout** behalve in `outbox.js` (`fetchWithTimeout`, 30–120 s, eigen `AbortController`). Offline geeft `fetch` meteen een `TypeError: Failed to fetch`; een hangende verbinding wacht onbeperkt (de browser geeft pas na minuten op).

| Pad | Aanroeper | Doet | Huidig gedrag bij fout/hang | Risico op half-opgeslagen toestand |
|---|---|---|---|---|
| `POST /api/plan` | `planacties.addTicketToDate`, `removeTicketFromDate`; `ticketdetail.saveReschedule` | Zoho-status en -datum | optimistisch bijgewerkt, bij een fout teruggedraaid; toast "Bijwerken in Zoho mislukt (Detail: Failed to fetch)". **Hang: `inFlightTickets` blijft gezet, de kaart blijft "bezig", het ticket is niet meer te bedienen.** | **H2** (hang) en **H3** (antwoord kwijt na een geslaagde schrijf) |
| `POST /api/plan-datum` | `route.applyRouteOrder` (lus per stop), `ticketdetail.saveToewijzen` | Zoho-datum | lus stopt bij de eerste fout, toast "Volgorde bewaren mislukt voor #n", dan `loadTickets` | **H4** (k van n opgeslagen) |
| `POST /api/propose` | `voorstel.sendProposal` | Zoho + **klantmail** + PDF | fout: toast; `res.json()` leest een 502-HTML als "HTTP 502" (5b). Geen waarschuwing "klant kan al gemaild zijn" (bij annuleren wel) | **H7**: mail weg, antwoord kwijt, de technieker probeert opnieuw: dubbele klantmail. **Vraag Q1.** |
| `POST`/`DELETE /api/voorstel-status` | `voorstel.sendProposal` (na `propose`) | Blobs-register (🔒, tijdslot) | fire-and-forget, fout enkel `console.warn` (reeds gepind 5a (b)) | register niet geschreven terwijl de mail weg is |
| `POST /api/annuleer` | `annuleren.verstuurAnnulatie` | Zoho + klantmail | `busy`-vlag sluit het venster en zet "Terug" uit; foutmelding noemt "De klant kan al gemaild zijn" bij `mailKlant` + 5xx/netwerkfout. **Hang: venster blijft vergrendeld op "Bezig…" tot herladen.** | **H6** (vergrendeling); de mailwaarschuwing bestaat al |
| `POST /api/send-rapport` (voorbeeld en echt) | `rapport-verzenden` | klantmail | fout: toast "✕ <detail>"; knop blijft uitgeschakeld (gepind 5b (1)) | H7-variant; **Vraag Q1** |
| `POST /api/rapport-verzonden` | `rapport-verzenden` | Blobs-vlag per doelgroep | fout: "NIET opnieuw versturen, herlaad eerst" (bestaat) | gedekt door bestaande tekst |
| `POST /api/comment` | `syncOplossingNaarZoho` | oplossingstekst naar Zoho | toast "kon niet automatisch bijgewerkt worden"; geen herpoging | zichtbaar, gedocumenteerd |
| `PUT /api/availability` | `beschikbaarheid.saveAvailability` (6 aanroepers) | blokkeringen (Blobs, versie) | optimistisch, rollback bij `false`, toast "Opslaan is niet gelukt". 409: server-stand overgenomen + toast | **H5**: antwoord kwijt na een geslaagde schrijf → rollback lokaal, server heeft het; verschijnt later bij de volgende 409 |
| `PUT /api/afspraken`, `PUT /api/klantbeschikbaarheid` | `kern.api.bewaarMetVersie` (`saveAfspraken`, `saveKlantBeschikbaarheid`) | eigen afspraken, klantbeschikbaarheid | rollback bij `reden: 'netwerk'`/`'http'`; 409-samenvoegen met één retry | **H5** idem |
| `PUT /api/fotos` | `fotos.persistFotoChange` | foto's per ticket (versie) | toast "Foto opslaan mislukt: …"; 409 → herladen | grote upload: een te korte timeout zou een langzame maar vorderende upload afbreken (N6: 60 s) |
| `GET /api/fotos` | `fotos.loadFotos`, **wizard bij het openen** | foto's lezen | bij fout `{ versie: 0, fotos: [] }` **stil**; de wizard opent zonder foto's | **H8**, Vraag Q3 (wizard: D19) |
| `POST /api/optimize`, `/api/route` | wizard (aanrijtijd, bij openen), route, planacties | TomTom (lezen) | wizard: `await` zonder timeout vóór het openen; bij een fout stil `aanrijtijd = 0` | **H8**, Vraag Q3 |
| `POST /api/inventaris` (`mutatie`, `verbruik`), `PATCH` | `inventaris.js` | wagenvoorraad (versie) | mutatie: toast, bewerkmodus blijft; `registreerVerbruik` na een rapport: enkel `console.warn` | verbruik stil niet afgetrokken; **Vraag Q4**. Mutatie beschermd door de versie (een herhaling na een verloren antwoord geeft 409, geen dubbele aftrek) |
| `PUT /api/prijzen` | `prijzen.prijsOpslaan` | prijslijst (versie) | toast, knop terug aan | geen (versie) |
| `POST /api/rapport-archief`, `/api/rapport` (+ GET) | `outbox.js` | rapport archiveren en PDF naar Zoho | IndexedDB-wachtrij, timeouts 30–120 s, backoff 10/30/90 s, hervat bij `online`, `visibilitychange` en app-start | **geen**: bestaand ontwerp (T20), onaangeroerd |
| `POST /api/planning-sinds`, `GET /api/tickets` e.a. | `app.js` | lezen | `loadTickets` past **eerst de lokale cache toe** en haalt dan op | **H1**, zie hieronder |
| lokaal (localStorage/IndexedDB): instellingen, aankomsttijden, wizardconcept, outbox | diverse | — | geen netwerk | geen |

### 2.6 De half-opgeslagen-scenario's (concreet)

- **H1: verouderde cache bij elke verversing.** `loadTickets()` past bij élke aanroep (opstart, 5-minuten-poll, "Vernieuwen", na een mislukte volgorde-opslag) eerst `blitz_tickets_cache` toe, en haalt daarna pas op. De cache is enkel van de laatste *geslaagde lading* en dus ouder dan elke lokale wijziging sinds toen. Scenario: de technieker plant ticket X in (Zoho gelukt), de poll valt in een tunnel: X springt terug naar de wachtrij en verdwijnt uit de route (`_applyTicketsData` verwijdert planning van tickets die "terug in de wachtrij" staan), terwijl Zoho het als gepland heeft. Hij plant X opnieuw. Bij een trage maar geslaagde lading knippert dezelfde verkeerde stand.
- **H2: een hangend `fetch` houdt de bediening vast.** Plan/uitplannen: `inFlightTickets` blijft gezet; annuleervenster: vergrendeld op "Bezig…"; rapport versturen: knop blijft uit.
- **H3: onzekere uitkomst.** Antwoord kwijt (verbinding valt weg, of 502/504 van de gateway na een geslaagde schrijf): de optimistische update wordt teruggedraaid, maar Zoho heeft de wijziging. De scherm toont een toestand die niet klopt tot de eerstvolgende geslaagde lading, die door H1 bovendien eerst nog de oude cache toepast.
- **H4: volgorde bewaren.** `applyRouteOrder` post per stop `plan-datum`. Faalt stop k, dan staan k−1 stops in Zoho op hun nieuwe uur, de lokale objecten zijn voor alle stops gemuteerd, en de herlading erna (`loadTickets`) past eerst de oude cache toe en kan zelf falen.
- **H5: spookschrijf.** Een PUT met versie N lukt op de server maar het antwoord komt niet aan. De client draait terug en houdt versie N; de volgende schrijf geeft 409 en haalt het "weggerolde" item uit de server-stand terug, met de melding "Iemand anders wijzigde dit net".
- **H6: vergrendelde dialogen** (zie H2).
- **H7: dubbele klantmail** na een verloren antwoord bij `propose` of `send-rapport`. Klantgericht: Q1.
- **H8: stille leegte bij het openen van de wizard** (foto's, aanrijtijd). Wizard: Q3.

## 3. Eisen en rulings (N1–N22)

Elke ruling is door Claude goedgekeurd per W4 (alleen herschikking of onzichtbaar), tenzij ze naar §7 verwijst.

| # | Onderwerp | Ruling |
|---|---|---|
| N1 | Opstartvolgorde | `index.html` krijgt `<link rel="modulepreload">` voor alle 46 modules (in volgorde van de graaf) en `<link rel="preconnect">` voor `cdnjs.cloudflare.com` en `cdn.jsdelivr.net`. De diepte 10 wordt 1. Geen gedragswijziging: modulepreload haalt enkel eerder op. Een node-test leidt de lijst af uit de importgraaf en faalt bij een ontbrekende of overbodige tag (net als SHELL, N16). |
| N2 | Lazy loading, per kandidaat | Zie tabel §4. Samengevat: **enkel ExcelJS (de bibliotheek) en `excel-export.js`** worden lazy. Wizard, inventaris, prijzen, Leaflet, signature_pad en de schermmodules blijven eager, elk met de reden in §4. |
| N3 | Service worker-strategie | `public/sw-strategie.js` (puur, UMD, `node --test`-baar met nep-`caches`/-`fetch`/-klok) + dunne `sw.js`. Kern: (a) CDN-bibliotheken vastgepind op versie in de cache (`cache-first`, voorgeladen bij `install` met `allSettled` zodat een CDN-storing de installatie niet breekt); (b) Google Fonts `stale-while-revalidate` in een tweede cache `blitz-extern-v1`; (c) shell: netwerk eerst met **optionele** navigatie-time-out (standaard UIT tot Brent antwoordt op Q5) en bij terugval op de cache de héle laad uit dezelfde momentopname (`cacheModus`, 60 s); (d) navigatie-terugval op `/index.html` ongeacht de querystring; (e) de momentopname wordt **niet** ververst bij succes (consistentie van de modulegraaf: een gemengde set oude en nieuwe modules kan een ontbrekende export geven); (f) `/api/` en alles behalve GET blijft ongemoeid; (g) `register('/sw.js', { updateViaCache: 'none' })`. |
| N4 | SW testen zonder `CACHE_NAME`-bump | Elke SW-test draait in een verse browsercontext (nieuw profiel, geen oude SW of cache), die de huidige `sw.js` met de huidige naam v25 installeert: een bump is voor de tests niet nodig. De zuivere logica heeft unit-tests (N3). Het **update-pad** (oude SW → nieuwe SW) wordt getest met een bevroren kopie van de huidige hoofd-SW (`e2e/fixtures/sw-v25-main.js`): de test serveert eerst die, laadt dan de echte `sw.js` en toetst dat de nieuwe SW het overneemt, dat een nieuw SHELL-bestand in de cache staat en dat `caches.keys()` precies de verwachte namen bevat. Dezelfde test blijft na de bump van etappe 9 gelden (N5). |
| N5 | Release-checklist (etappe 9, niet nu) | **"CACHE_NAME-bump + SW-updatepad"**, met: (1) `CACHE_NAME` ophogen (v25 → eerstvolgende), `EXTERN_CACHE` niet; (2) SHELL-test groen (N16); (3) `navTimeoutMs`-standaard conform het antwoord op Q5; (4) `sw-update.spec.mjs` groen na de bump (oude cachenaam weg); (5) handmatige controle in een echte browser met een v25-installatie: één herlading toont de nieuwe versie, `skipWaiting`/`clients.claim` werken; (6) `sw.js` en `sw-strategie.js` niet lang laten cachen door Netlify (de standaard `max-age=0, must-revalidate` volstaat; controleren); (7) geen hotfix op `main` die JS wijzigt zonder ook de SHELL-test te draaien. |
| N6 | Time-outs op elke `/api`-aanroep | Nieuw `public/js/kern/netwerk.js`: `installeerFetchTimeout(doel, opties)` omhult `fetch` voor same-origin `/api/`-verzoeken met een `AbortController` en `setTimeout` (nep-klok-vriendelijk). Standaard **20 s** (de functies zonder eigen limiet hebben 10 s); **35 s** voor `propose`, `send-rapport`, `annuleer`, `rapport`, `planning-sinds`, `planning-export` (server: 26 s); **60 s** voor `PUT /api/fotos` (grote upload). Een aanroep die zelf een `signal` meegeeft (de outbox) blijft onaangeroerd. Geïnstalleerd vanuit `kern/brug.js` (de enige `window`-aanraker), buitenste laag boven de `?test`-header-patch. De fout is een `DOMException` met naam `TimeoutError`. Dit sluit H2/H6 zonder één aanroeper te wijzigen (ook de wizard, die niet aangeraakt mag worden). De timer loopt tot de antwoordkop; een stilvallende bodylezing blijft buiten beschouwing. |
| N7 | Onzekere uitkomst: terugdraaien én synchroniseren | `kern/api.js` krijgt `leesFout(err)` → `{ soort, onzeker, status? }`: `onzeker` is waar bij `TimeoutError`/`AbortError`, een `TypeError` (netwerk) en "HTTP 502/503/504". Na het bestaande terugdraaien starten `addTicketToDate`, `removeTicketFromDate`, `saveReschedule`, `saveToewijzen` en de `plan-datum`-lus van `applyRouteOrder` bij `onzeker` één **samengevoegde** herlading (`loadTickets({ stil: true, zonderCache: true })`, alleen als er geen ticket meer "in flight" is en de route niet bezig is, zoals de poll). `saveAvailability`, `saveAfspraken` en `saveKlantBeschikbaarheid` herladen hun eigen lader (`zonderCache`) na het terugdraaien van de aanroeper. Teksten van de foutmeldingen blijven ongewijzigd (N17). `propose`, `send-rapport` en `annuleer` krijgen **geen** nieuwe afhandeling (Q1). |
| N8 | Geen verouderde cache bij verversen | `loadTickets` past `blitz_tickets_cache` alleen toe bij de **eerste** lading na het openen van de app (offline starten blijft werken); poll, "Vernieuwen", herladen na een fout en de resync van N7 gebruiken de cache niet. Idem de lezers van afspraken, beschikbaarheid en klantbeschikbaarheid met `zonderCache`. Sluit H1. |
| N9 | Wat N6 niet oplost | Na een time-out toont de bestaande foutafhandeling van de aanroeper wat ze nu al toont (met het detail van de nieuwe `TimeoutError`). Geen nieuwe meldingen: Q2. |
| N10 | Klantmailpaden | `propose`, `send-rapport`, `annuleer`: enkel N6 (de hang eindigt). Geen waarschuwingen, geen herpogingen, geen wachtrij (Q1). |
| N11 | Focus na Escape | Sluit de 4 gepinde gevallen in `e2e/vensters.spec.mjs` (voorstel, lokale afspraak-detail, prijsbeheer, planningsresultaat) als W5-bugfix: `registreerVenster` krijgt een optionele `terugFocus: () => HTMLElement | null` en een generieke "erfenis" van de opener van een stil gesloten venster dat net daarvoor sloot (detail → voorstel, instellingen → prijsbeheer, ≤ 500 ms). Lokale afspraakkaarten worden toetsenbord-activeerbaar via `kern.ui.maakActiveerbaar` (zoals de ticketkaarten), de planningsknop is de terugkeerplek van het resultaatvenster. Puur toegankelijkheid, geen datarisico. De vier `huidig: true`-vlaggen verdwijnen. |
| N12 | Slepen afgebroken door een achtergrondrender | **Documenteren, niet oplossen.** Reden: bij een ververste lijst hangt de `opVolgorde`-sluiting aan het `allStops` van de oude render; uitstellen en daarna toepassen zou `applyRouteOrder` (die `plan-datum` naar Zoho post, W11) laten werken op verouderde objecten, en de render ervoor kan precies *omdat* de gegevens veranderden. Het afbreken is schoon (`sorteer.vernietig()` ruimt het sleepelement op, er gaat niets naar Zoho) en zeldzaam (de poll draait elke 5 min en hertekent alleen bij gewijzigde gegevens). T1 pint dat gedrag in een test (geen `plan-datum`, lijst en kaart consistent); CLAUDE.md krijgt het onder "Gedocumenteerd restant". |
| N13 | Testhulp voor verbindingsproblemen | `helpers.mjs` (`stubExtern`): een handlerantwoord `{ afbreken: 'failed' }` (route.abort) of `{ hangen: true }` (nooit antwoorden); `productie-hulp.mjs`: `zohoStubs.zetAntwoord(naam, …)` accepteert ze, plus `verwachtNetwerkFout(verzoeken, [{ pad }])` (zoals `verwachtHttpFout`: enkel dat pad is toegelaten als `requestfailed`, en de test faalt als het uitblijft). Tests laten timeouts lopen met `page.clock.runFor`. Geen `waitForTimeout` (guard). |
| N14 | SW-testproject | Aparte Playwright-project `sw` (`testMatch: 'sw/**/*.spec.mjs'`; het project `chromium` krijgt `testIgnore: 'sw/**'`). Fixture `e2e/sw-hulp.mjs` breidt `productie-hulp.mjs` uit met `serviceWorkers: 'allow'` (enkel dit bestand mag dat). Bereik: zelfde host-allowlist (`isToegestaan`: `localhost:3338` en de twee CDN-hosts, enkel GET/HEAD), alle `/api` gestubd met catch-all 599, de statische server heeft geen backend, **`?test` verboden** (guard), WebSocket-slot, en extra: Chromium-argument `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE cdnjs.cloudflare.com, EXCLUDE cdn.jsdelivr.net"` (fonts en tegels zijn gestubd) zodat niets de machine verlaat, ook niet via de SW. Een eigen waarnemer-route (`route.fallback`) legt `request.serviceWorker()` per verzoek vast: een test faalt als een `/api`-verzoek of een niet-GET van de SW komt, of als de SW een andere bestemming bereikt dan eigen host, de twee CDN's en de fonthosts. Verkeersregels (`hangVoor`, `vertraag`) zitten in de fixture; specs registreren zelf geen routes. |
| N15 | Importguard uitgebreid | `tests/e2e-import-guard.test.mjs`: `e2e/sw/` en `e2e/sw-hulp.mjs` krijgen dezelfde regels als de productiebestanden (geen `?test`, geen eigen routes, geen netwerkmodules, geen `fetch(`, geen `waitForTimeout`, importeren enkel de fixture), met twee uitzonderingen: het woord `serviceWorkers` en `setOffline` mogen enkel in `e2e/sw-hulp.mjs`. De guard krijgt eigen zelftests (RED eerst) voor de nieuwe klasse. |
| N16 | Consistentietests | `tests/sw-schil.test.mjs`: (a) elke `SHELL`-regel bestaat op schijf; (b) elk `.js`/`.css`-bestand onder `public/js`, `public/css` staat in SHELL; (c) de CDN-lijst van de SW is gelijk aan de externe `<script src>`/`<link href>` van `index.html` (zelfde versie-URL's, ExcelJS uitgezonderd omdat die lazy is: de URL staat dan als constante in `excel-export.js` en wordt daar vergeleken); (d) de `modulepreload`-tags zijn gelijk aan de importgraaf (N1). |
| N17 | Foutteksten | `leesFout` geeft per soort een `tekst`; het voorlopige voorstel staat in §7 (Q2). **Tot Brent antwoordt tonen alle meldingen exact de huidige tekst** (met `err.message` als detail); een apart, laatste taakonderdeel (T8) zet de teksten om als hij akkoord is. |
| N18 | Wizard (D19) | Ongewijzigd. De drie bevindingen (foto's laden, aanrijtijd 0, voorraadaftrek) staan als vragen in §7. De time-outs van N6 gelden wel voor de aanroepen die de wizard doet (centraal, geen wizardregel). |
| N19 | `CACHE_NAME`, versie, `SHELL` | `CACHE_NAME` en `package.json` ongewijzigd. Elk nieuw bestand onder `public/` dat de app laadt (`js/kern/netwerk.js`) komt in dezelfde commit in `SHELL`; `sw-strategie.js` wordt via `importScripts` geladen en hoort niet in SHELL (de browser bewaart het bij de SW). |
| N20 | Excel-export: bewijs | Karakterisering vóór de wijziging (T1): e2e `productie/excel-export.spec.mjs` met het rapportarchief uit `zohoStubs({ rapporten })`: klik "📊 Excel export", `download`-gebeurtenis, bestandsnaam `TicketLog_<van>_<tot>.xlsx`, het bestand is een geldige zip (`PK`) en bevat `xl/worksheets/sheet1.xml` met de verwachte rijen. Na T3 blijft dezelfde test groen en een tweede test bewijst dat zonder klik ExcelJS niet geladen wordt (geen verzoek naar jsdelivr). |
| N21 | Offline-start | SW-spec: na één online bezoek start de app offline uit de cache (tabs, offline-balk, Leaflet beschikbaar uit de extern-cache, geen verzoek naar de eigen server). |
| N22 | Meting | `scripts/meet-laden.mjs` (buiten de suites; eigen mini-server met lege stubs en `--host-resolver-rules`) meet verzoeken, bytes en tijd tot `window.kern` + `#cnt-tickets` onder drie profielen (geen vertraging, 150 ms en 400 ms per verzoek; koud en warm). Eerste meting vóór de wijzigingen (T1), tweede na T3/T4 (T9); beide in het ledger. |

## 4. Lazy loading: besluit per kandidaat

Criterium: alleen als het gedrag identiek blijft, het geen wizard-wijziging boven D19 vraagt, en de winst meetbaar is.

| Kandidaat | Grootte (ruw / gzip) | Besluit | Reden |
|---|---|---|---|
| **ExcelJS (CDN)** | 947 702 / 257 676 | **Lazy: ja** (N2, T3) | Wordt enkel bij 📊 Excel export gebruikt, maar blokkeert nu elke opstart (proef: hangende jsdelivr = app start niet) en kost 258 KB over de draad en ~950 KB parse op elke koude start. Het script wordt bij de eerste export als `<script>` ingevoegd (zelfde vastgepinde URL, zelfde SW-cache); faalt het laden, dan loopt het bestaande `catch` van `exportTicketLog` ("✕ Export mislukt: …"). Offline werkt de export na één bezoek via de SW-cache. |
| **`excel-export.js`** | 8 772 / 3 281 | **Lazy: ja** (T3) | Enkel `app.js` importeert het, enkel de actie `rapport-export` gebruikt het; `app.js` doet `import()` bij de klik. Geen `window`-naam, geen `kern.*`-namespace, niet in `brug.js`. `rapport-archief.js` (waar het van afhangt) blijft eager. |
| `rapport-wizard.js` (+ `wizard.css`) | 80 860 / 22 188 (+ 16 033 / 3 101) | **Nee** | (1) De cyclus `fotos.js` ↔ `rapport-wizard.js` (`_fotoState`, `zetFotoState`) houdt de wizard statisch in de graaf zolang `fotos.js` eager is (`brug.js`, `app.js`); loskoppelen vraagt een wijziging van de wizard-imports en -exports (buiten D19, 5b bewust gelaten). (2) De module registreert bij evaluatie luisteraars (`visibilitychange`, `pagehide`, `input` op `#wiz-body`), de `window.wiz*`-brug en het conceptherstel; uitstellen verandert wanneer een concept bewaard wordt. (3) Winst na SW-cache enkel parse-tijd (22 KB gzip van 204 KB, 11 %); T1 meet die op een 4×-vertraagde CPU, en pas bij > 150 ms komt dit besluit terug op tafel (bij Brent, met wizard-wijziging). |
| `inventaris.js` | 22 933 / 7 348 | **Nee** | `loadInventaris()` en het badge-getal draaien bij de opstart; polling en `registreerVerbruik` (door de wizard gelezen als `window.registreerVerbruik`) hangen eraan. |
| `prijzen.js` | 19 682 / 5 392 | **Nee** | `loadPrijzen()` bij de opstart vult de prijscache die de wizard offline gebruikt; `brug.js` en `inventaris.js` importeren het. |
| Leaflet (CDN, js + css) | 147 171 + 10 879 / 42 440 + 2 622 | **Nee, wel in de SW-cache** | `initMap()` draait bij de opstart en e2e/`kern.route` tellen kaartelementen direct na de start; lazy tekenen verschuift dat. Het hangrisico bij een koude eerste start blijft (gedocumenteerd); herhaalde starts lopen via de SW-cache (N3). |
| signature_pad (CDN) | 11 374 / 3 772 | **Nee, wel in de SW-cache** | 3,7 KB; enkel te verplaatsen met een wizard-wijziging of `async` (de wizard leest `window.SignaturePad` bij gebruik, maar de winst is verwaarloosbaar). |
| Schermmodules (route, kalender, beschikbaarheid, voorstel, annuleren, …) | 5–50 KB elk | **Nee** | Ze registreren hun `init…(afh)`, vensters en delegatie bij `DOMContentLoaded` en staan als `window.kern.<scherm>` in `brug.js` (e2e en `window-namen.test.mjs`). Lazy vraagt proxies of een ander initcontract: gedragsrisico zonder winst zodra modulepreload (N1) de ontdekkingsketen en de SW de draad wegneemt. |

## 5. Risico's en vangnetten

| Risico | Vangnet |
|---|---|
| Een global `fetch`-omhulsel raakt alle 46 aanroepen (ook de wizard) | Eén klein, unit-getest bestand; same-origin `/api/` enkel; een meegegeven `signal` blijft; tijden ruim boven de serverlimieten; in e2e alle productietests ongewijzigd groen; T2 bewijst per stub dat zonder timeout niets verandert. |
| Een te korte time-out breekt een langzame, vorderende upload af | `PUT /api/fotos` 60 s; de outbox gebruikt zijn eigen signal (30–120 s). Q2/Q5 geven Brent de knop voor de getallen. |
| N7 herlaadt tickets midden in een andere actie | Alleen zonder ticket in flight en zonder `routeOrderBezig` (zelfde regel als de poll, I4); samengevoegd (één herlading per reeks, ook voor "Plan deze week"). |
| SW-terugval geeft een gemengde of verouderde app | Momentopname zonder verversing bij succes; `cacheModus` laadt de rest van die laad uit dezelfde set; standaard UIT (Q5); de bump bij de release ververst de set. |
| De SW-tests raken per ongeluk een echte host | Zes sloten (N14): host-allowlist, `/api`-stubs met 599, statische server zonder backend, geen `?test`, WebSocket-slot, `--host-resolver-rules`; plus de waarnemer die SW-verzoeken telt. De guard (N15) dwingt het af en heeft zelftests. |
| `focus`-fix verandert iets in de focusval of het Tab-gedrag | De bestaande `vensters.spec.mjs` (14 vensters) blijft groen; enkel de vier `huidig`-pins draaien om. |
| Wijziging in W11-paden (`planacties`, `ticketdetail`, `route`) | Per wijziging: diff `-w --color-moved` in de commitbody, productietests ongewijzigd groen, nieuwe tests per scenario met de payload-asserties van 5a. |

## 6. Succescriteria

- `index.html` bevat de modulepreload-tags en geen ExcelJS-script; `excel-export.js` is lazy; de Excel-export-test (N20) is groen vóór en na.
- `kern/netwerk.js` bestaat, is geïnstalleerd in `brug.js`, en elke gestubde `/api`-aanroep in een e2e die hangt, eindigt met een fout na de tijdlimiet; geen enkele bestaande productietest is gewijzigd.
- De scenario's H1–H5 en H6 (vergrendeling) hebben elk een test die rood was vóór en groen na; H7/H8 staan als vraag.
- `public/sw.js` is dun, `public/sw-strategie.js` heeft unit-tests (cache-eerst, SWR, time-out, `cacheModus`, install met `allSettled`, activate) en `tests/sw-schil.test.mjs` is groen; `CACHE_NAME` is nog v25.
- Het project `sw` bestaat en slaagt (installatie, offline-start, hangende navigatie met `?navTimeout`, SW raakt `/api` nooit, update-pad); `chromium` draait het niet; guard-zelftests groen.
- De vier `huidig: true`-vlaggen in `vensters.spec.mjs` zijn weg en hun verwachtingen zijn omgedraaid.
- Het slepen-door-render-gedrag is gepind en gedocumenteerd.
- Meetrapport voor/na in het ledger; `node --test` en `npx playwright test` (project `chromium` en `sw`) groen met de aantallen in het ledger.

## 7. Vragen voor Brent (niet beslist; standaard = huidige gedrag)

De taken werken met de huidige tekst/het huidige gedrag tot je antwoordt; T8 verwerkt je antwoorden.

1. **Klantmail bij een onzekere uitkomst (Q1).** Bij een voorstel (`propose`) of een rapport (`send-rapport`) dat faalt door een time-out, netwerkfout of 502/504 kan de klant de mail al ontvangen hebben; de technieker probeert dan opnieuw en de klant krijgt hem twee keer. Bij annuleren staat al: "De klant kan al gemaild zijn — controleer in Zoho vóór je opnieuw probeert." Wil je dezelfde zin bij voorstel en rapport (voorstel van tekst: "De klant kan de mail al ontvangen hebben — controleer in Zoho vóór je opnieuw probeert.")?
2. **Foutteksten en een hint bij een trage verbinding (Q2).** Nu eindigen foutmeldingen op een technisch Engels detail ("Failed to fetch"). Voorstel: "Geen verbinding" (offline), "Verbinding te traag, geen antwoord binnen N seconden" (time-out) en bij de Excel-export "Excel-onderdeel kon niet geladen worden — probeer opnieuw met verbinding". Wil je deze teksten, en wil je naast de bestaande Offline-balk ook een melding "Trage verbinding" na een time-out? (Dat is een nieuw scherm-element.)
3. **De wizard en een slechte verbinding (Q3).** Twee dingen gebeuren stil bij het openen van een rapport zonder verbinding: de foto's die al bij het ticket staan worden niet geladen (de wizard toont "nog geen foto's"), en de aanrijtijd wordt 0. Wil je dat de wizard hier een waarschuwing toont? Dat vraagt een wijziging in `rapport-wizard.js` buiten D19 (W11).
4. **Wagenvoorraad na een rapport (Q4).** Als de voorraadaftrek na het verzenden van een rapport mislukt, merkt niemand het: het rapport is weg maar de voorraad is niet verminderd. Wil je een melding, of een herpoging?
5. **Starten uit de bewaarde kopie bij een trage verbinding (Q5).** Met een time-out van 4 seconden op de eerste pagina start de app uit de bewaarde kopie in plaats van te blijven wachten. Die kopie kan één release oud zijn. Akkoord, en is 4 seconden goed? (Standaard: uit; aanbeveling: aan.)

Reeds gepind in 5a/5b en hier niet opnieuw beslist: (a) `propose` 502 → technische tekst (opgelost in 5b), (b) tweede 409 van `voorstel-status` schrijft het register niet, (c) `propose` 500 na het verzenden, (d) annuleer 502 na de mail laat het ticket gepland, de verzendknop blijft uit na een 500/502.
