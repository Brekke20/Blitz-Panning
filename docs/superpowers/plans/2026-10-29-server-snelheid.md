# Server-snelheid: minder wachten op gegevens (29 oktober 2026)

Tak `server-snelheid` (bevat O1, O2, O3 en O6 van `2026-10-29-optimalisatie.md`; nog niet live). O5 staat er NIET op:
`netlify/functions/tickets.js` haalt de details nog in lock-step batches op. Geen versie- of `CACHE_NAME`-ophoging in de taken
(dat gebeurt bij de release). Planner: statische analyse van de code, de live metingen
(`docs/server-snelheid/metingen-live-2026-10-29.md`) en de Zoho Desk API-documentatie (samengevat door een aparte onderzoeker, niets
tegen Zoho aangeroepen). Bouwt verder op `2026-10-29-optimalisatie.md` (1e, O4, O5) en de review ervan
(`2026-10-29-optimalisatie-review.md`).

**De klacht van Brent:** "Een tab laadt wel oké, maar we moeten wachten tot alles erop staat." Dat is wachten op de server, niet op het
scherm. Twee bronnen: `/api/tickets` (p50 6,0 s, p90 7,8 s, p99 10,6 s) en een bodem van ongeveer 1 s op ELKE functie, ook de
eenvoudigste.

Regels voor elke implementeerder (zoals in het optimalisatieplan):
- Lees eerst `CLAUDE.md` (tests, service worker, `afh`/`strengeAfh`, karakteriseringstests, OneDrive-`ENOENT`).
- `node --test` zonder pad (nooit `node --test tests/`). E2E enkel gericht (`npx playwright test <specs> --workers=2`); de volledige suite
  draait de opzichter één keer op het einde. Nooit twee volledige Playwright-runs tegelijk.
- Een karakteriseringstest wijzig je enkel bewust, met een commentaarregel waarom.
- Nooit echte Zoho-, TomTom- of mailaanroepen in tests (`tests/nep-fetch.mjs`). De Zoho-proef (S4) is GEEN test en draait enkel na een
  uitdrukkelijk ja van Brent.
- Nooit meer dan 5 Zoho-verzoeken tegelijk (de editie van de Zoho-portal en dus de gelijktijdigheidslimiet is onbekend, zie 1f).
- Geen nieuw bestand onder `public/js/` zonder `SHELL` in `public/sw.js` en de modulepreload-lijst in dezelfde commit
  (`tests/sw-schil.test.mjs`). Nieuwe bestanden onder `netlify/lib/`, `tests/` en `scripts/` vallen daar niet onder.
- Zoho-last per lading gelijk of lager. Elke taak meldt het aantal Zoho-aanroepen per `/api/tickets` vóór en na.

---

## 1. Het huidige beeld (met bewijs)

### 1a. Live cijfers (24 u productie, `metingen-live-2026-10-29.md`)

| Functie | n | p50 | p90 | p99 | Opmerking |
|---|---|---|---|---|---|
| tickets | 75 | **5,98 s** | **7,78 s** | **10,64 s** | de lange wachttijd |
| dashboard | 4 | 2,75 s | | | Beheer → Performance |
| auth-ik | 29 | 1,07 s | 2,62 s | 6,16 s | houdt de hele schil verborgen (1b) |
| instellingen | 38 | 1,02 s | 1,24 s | 6,34 s | idem |
| themas | 70 | 1,10 s | 1,52 s | 5,66 s | |
| prijzen, availability, klantbeschikbaarheid, rapport-archief, route | 9-35 | 0,98-1,06 s | 1,10-1,42 s | 1,23-1,42 s | één Blobs-lezing en weinig rekenwerk, toch 1 s |

Duur = duur van het edge-verzoek (inclusief netwerk tussen edge en functie en een eventuele koude start). Er staat geen tijdmeting in de
functies: wat binnen die 1 s auth, Blobs, Zoho of netwerk is, weet niemand. n = 75 tickets-aanroepen per dag: ongeveer één per 8 minuten
over een werkdag. Dat is weinig verkeer; het telt mee bij elk voorstel met een cache in het functiegeheugen (zie 1e).

### 1b. De opstart: de seriële kop

1. Inline script (O1, `public/index.html:72-99`): `auth-ik` en (met bewaarde sessie) `instellingen?overzicht=1` starten al terwijl de
   modules laden. Nog niet live.
2. `startNaInlog` (`public/js/schermen/rol-schil.js:140-161`): `await laadSessie()` (auth-ik; met bewaarde sessie hoogstens
   `KORTE_LIMIET_MS` = 5 s, `kern/sessie.js:148`), dan `await synchroniseerInstellingen` (budget tot `SYNC_BUDGET_MS` = 7 s,
   `kern/instellingen-sync.js:33`), pas daarna `geefSchilVrij()` en `opstart()`.
3. Zolang staat `<html data-schil="laden">` (`index.html:2`): tabs, persoonskiezer en `#hoofdinhoud` zijn `visibility: hidden`
   (`css/app.css:1204-1205`). **De gebruiker ziet enkel logo en hemel**, ook als er een bewaarde ticketkopie is.
4. `opstart()` (`public/js/app.js:335-349`) start dan alles tegelijk: `prijzen`, `availability`, `inventaris`, `afspraken`,
   `klantbeschikbaarheid`, `voorstel-status`, `tickets`, `rapport-archief` (+ `themas` na de start, `app.js:1034-1037`). Dat deel is al
   parallel. Na een geslaagde ticketlading volgt nog `POST /api/planning-sinds` (`app.js:480-496`, vuur-en-vergeet).
5. `loadTickets` (`app.js:587-649`): eerst de bewaarde kopie `blitz_tickets_cache` (`:596-599`, zonder leeftijd), daarna `fetch('/api/tickets')`
   (`:608`), bewaren (`:625`) en toepassen (`:626`). Zonder kopie: kaartenskelet in de Wachtrij na 150 ms (`:600-601`, `:647`).

Met O1 live wordt stap 2 ongeveer `max(auth-ik, instellingen)` ≈ 1,1 s (p50) in plaats van de som; de tickets starten dus pas ~1-1,5 s na
het openen (gsm) en duren dan nog 6 s.

### 1c. Per tab: welke verzoeken, en wat de gebruiker ondertussen ziet

| Tab | Verzoeken bij openen | Serieel / parallel | Wat de gebruiker ziet tijdens het wachten | Bewijs |
|---|---|---|---|---|
| Opstart (alle rollen) | auth-ik, instellingen | na elkaar (O1: tegelijk) | logo en hemel, geen tabs | `rol-schil.js:140-161`, `app.css:1204` |
| Wachtrij | geen (gegevens van de opstart) | - | bewaarde kopie; zonder kopie kaartenskelet na 150 ms | `app.js:596-601` |
| Kalender | geen (abonnementen) | - | bewaarde kopie; zonder kopie een leeg weekraster met "—" per dag en een capaciteitskop "0/x": **leest als "niets gepland"** | `app.js:761`, `kalender.js:618-626` |
| Ingepland | geen | - | zonder kopie **"Geen geplande service deze week"** vóór de gegevens er zijn | `app.js:762`, `ingepland.js:126-128` |
| Route | `optimize` (enkel bij ontbrekende coördinaten) → `route` (TomTom) | na elkaar, noodzakelijk (route heeft coördinaten nodig) | lijst uit het geheugen, melding "Route berekenen..."; zonder tickets **"Voeg tickets of installaties toe via de Kalender"** | `app.js:936-943`, `route.js:244`, `:459`, `:470`, `:505` |
| Ingepland/Kalender/Route na een poll | tickets elke 5 min, bij terugkeer na 60 s | - | oude gegevens, daarna stil vervangen | `app.js:818-832`, `:887-895` |
| Rapporten | `rapport-archief` bij de opstart EN bij elk openen | - | eerste keer platte tekst "Laden…"; daarna blijft de lijst staan tijdens het verversen | `app.js:348`, `:948`, `rapport-archief.js:55-59`, `index.html:404` |
| Inventaris | `inventaris` bij elk openen + elke 30 s (supervisor) | - | "Laden..." tot de eerste tekening; daarna blijft de lijst staan | `app.js:949-956`, `:101-114`, `inventaris.js:34-48`, `index.html:411` |
| Beheer → Gebruikers, Activiteit, Systeemstatus, Thema's | één of twee verzoeken | Activiteit: `gebruikers` en `activiteit` parallel | paneel- en tabskelet na 150 ms | `beheer.js:118`, `beheer-gebruikers.js:458`, `beheer-activiteit.js:26,76` |
| Beheer → Instellingen | `gebruikers`, DAARNA `instellingen?gebruiker=` | **na elkaar** (2 × ~1 s) | formulierskelet, daarna de tekst "Laden…" | `beheer-instellingen.js:30`, `:111-112`, `:208` |
| Beheer → Performance | `laadCss()`, daarna `dashboard` ∥ `dashboard-instellingen` | css eerst, dan parallel; `dashboard` zelf 2,75 s | tegelskelet | `beheer-performance.js:57`, `:142-144`, `:252` |
| Sales (Leads, Kalender, Route, Afgewerkt) | `sales` (+ instellingen) | - | skelet per scherm | `sales-schil.js:100-105` |

Conclusie: de tabs zelf wachten zelden op meer dan één verzoek na elkaar. Het wachten zit in (1) `tickets` (6 s, alle planningsschermen),
(2) de 1 s-bodem die elke tab met een eigen verzoek één keer betaalt (Rapporten, Inventaris, Beheer; bij Beheer → Instellingen twee keer),
en (3) de verborgen schil bij de start. Waar er geen kopie is, tonen Kalender, Ingepland en Route bovendien een **lege staat die op "niets
te doen" lijkt** terwijl de gegevens nog onderweg zijn.

### 1d. `/api/tickets` op de server

`netlify/functions/tickets.js` (achter `alsV2(beveiligV1('tickets', kern))`, `:139`):

| Stap | Code | Zoho-aanroepen | Serieel? |
|---|---|---|---|
| sessie: gebruikerslijst uit Blobs (strong) | `netlify/lib/auth.js:90-101` via `beveiligd.js:51-62` | 0 | ja |
| token (cache 55 min in de warme instantie) | `netlify/lib/zoho.js:22-44` | 0 of 1 (koude instantie: POST naar accounts.zoho.eu) | ja |
| org-id: **bij elke aanroep opnieuw** | `zoho.js:46-60`; vastgelegd in `tests/server-tickets.test.mjs:303` | 1 | ja |
| `/agents?limit=50`, vóór de paginering (het commentaar zegt "parallel") | `tickets.js:24-30` | 1 | ja |
| pagina's `/tickets?limit=100&from=` zonder statusfilter, stop na 2 pagina's zonder relevant ticket, max 6 | `tickets.js:38-60` | 1-6 | ja |
| per relevant ticket `/tickets/{id}` (enkel voor de custom fields), lock-step batches van 5 | `tickets.js:68-83` | N | per batch |

Het antwoord hangt NIET van de gebruiker af (`kern` gebruikt `gebruiker` niet; rechtenrij `tickets: { '*': INTERN }`,
`netlify/lib/rechten.js:29`): elke planner, beheerder of technieker krijgt dezelfde lijst. Belangrijk voor O4 (sectie 2, C3).

Ruwe schatting (te bevestigen met S1): bij ~0,3-0,4 s per Zoho-rondreis vanuit de functie en N ≈ 40 relevante tickets: org + agents + ~3
pagina's + 8 batches ≈ 13 seriële rondes ≈ 4,5-5 s, plus auth en overhead ≈ 6 s. De detailfase is dan het grootste deel. N en de duur per
Zoho-aanroep zijn **niet gemeten**.

Time-outs: geen `[functions.tickets]` in `netlify.toml` (standaardlimiet); de client breekt `/api/tickets` af na 20 s
(`public/js/kern/netwerk.js:3-4`, niet in de lange klasse). De goedgekeurde O5 zet `timeout = 26`: dan loopt de functie in de band 20-26 s
door voor een client die al weg is (Zoho-aanroepen voor niets). Dit plan kiest **20** (S2).

### 1e. De bodem van ~1 s op elke functie

Elke beveiligde functie: `alsV2` (`netlify/lib/v2-adapter.js:174-181`, in-proces, verwaarloosbaar) → `beslis` (`beveiligd.js:34-76`) →
`vereisGebruiker` → `getStore({ name: 'blitz-data', consistency: 'strong' })` + `leesGebruikers` (`auth.js:92-93`) → de functie zelf, die
meestal nog één strong Blobs-lezing doet (bv. `prijzen.js`). `auth-ik` leest de gebruikerslijst **twee keer** (wrapper + `auth-ik.js:24`),
en auth-ik staat op het kritieke pad van de start (1b).

Hypotheses (geen enkele bewezen):
- **H1 strong Blobs-lezingen zijn traag** (strong gaat langs de oorsprong, niet langs de edge-cache): twee na elkaar per verzoek.
- **H2 functieregio**: standaard draaien Netlify-functies in de VS; de gebruikers zitten in België en Zoho Desk in de EU
  (`desk.zoho.eu`, `zoho.js:7`). Elke rondreis edge→functie en functie→Zoho kost dan transatlantische latentie. De ligging van de
  Blobs-opslag is onbekend: een regiowissel kan Zoho sneller en Blobs trager maken.
- **H3 koude starten**: de p99-uitschieters van 5-6 s (auth-ik, instellingen, themas) passen daarbij; de strakke p50-p75 (bv. prijzen 1,03 /
  1,08 s) eerder niet. Bij ~75 tickets-aanroepen per dag is de tickets-instantie vaak koud (dan ook een nieuwe Zoho-token).
- **H4 de v2-adapter**: zet enkel objecten om, geen I/O. Onwaarschijnlijk; S1 bevestigt het (kern ≈ totaal).

### 1f. Zoho Desk API: wat de documentatie zegt (onderzoeker, niets aangeroepen) en wat dat betekent

| Feit uit de documentatie | Gevolg voor dit plan |
|---|---|
| `GET /tickets?fields=`: systeem- en custom fields (niet meerregelig), max 30 velden, maar **de hele waarde max 100 tekens**; een melding van HTTP 500 met `fields` | **Dood als bron van de custom fields**: `mapTicket` (`tickets.js:85-119`) leest 13 `cf_*`-velden (plus een terugval op elk veld met "adres"); hun namen samen zijn ver boven 100 tekens. Enkel nog bruikbaar voor een kort veld zoals `modifiedTime` (te testen, S4). |
| `GET /tickets?include=`: contacts, products, assignee (`firstName, lastName, id, email`), departments, isRead, team; geen `cf` in het voorbeeld | `include=assignee` kan `/agents` vervangen **enkel als** `agentNaam(a)` (`netlify/lib/zoho-agenten.js:5`: eerst `a.name`, anders voor- + achternaam) voor elke agent gelijk is aan voor- + achternaam; anders verschuift `assignee` en klopt de koppeling met de accounts (`zohoNaam`) niet meer. Te testen (S4). |
| `GET /tickets?status=`: komma-gescheiden, max 100 tekens; niet gezegd dat custom statussen werken; geen `statusType` | De vijf namen uit `tickets.js:33-35` met komma's zijn **107 tekens**. Past enkel zonder de oude namen ('Wachten op planning', 'Geplande support') of in twee aanroepen. `tickets.js:39` zegt al dat een statusfilter vroeger custom statussen wegfilterde. Te testen (S4). |
| `GET /tickets/search`: `status` "inclusief custom status", `cf` + contact + assignee per record, limit 100, tot 5000 resultaten, `sortBy=modifiedTime`, `modifiedTimeRange` | Eén of twee zoekaanroepen kunnen alle detailverzoeken vervangen. **Maar: zoekindex met vertraging** ("newly added resources may require some time", mogelijk minuten). |
| `modifiedTime` staat NIET in het lijstvoorbeeld van `/tickets`, wel in `/tickets/{id}` en search | Een cache "enkel gewijzigde tickets opnieuw ophalen" kan niet op de lijst alleen steunen, tenzij `fields=modifiedTime` werkt (S4). |
| Geen bulk-ophaling per id | Detailverzoeken blijven 1 per ticket zolang er geen andere bron is. |
| Limieten: geen per-minuutlimiet; dagelijks krediet (bv. Standard 50 000 + 250/gebruiker, Professional 75 000 + 500/gebruiker); **gelijktijdigheid** Free 5, Express/Standard 10, Professional 15, Enterprise 25; `TOO_MANY_REQUESTS`; lijst/zoek 3 krediet, ophalen per id 1 | Gelijktijdigheid blijft 5 tot de editie bekend is (vraag aan Brent, of afleiden uit `X-Rate-Limit-*`-koppen in S1). Krediet is GEEN probleem: 75 ladingen × (agents 3 + org + ~3 pagina's × 3 + N ≈ 40) ≈ 4 000 per dag, ruim onder elke pool. |

---

## 2. Taken

Elke taak: probleem + bewijs, wijziging, verwachte winst (eerlijk), risico, zichtbaar, acceptatie, bestanden, afhankelijkheden, review.

### S1 — Meten: `Server-Timing`-kop en één meetregel per verzoek (geen gedragswijziging)

- **Probleem + bewijs**: 1e. We kennen enkel de edge-duur; de opsplitsing binnen een functie bestaat niet
  (`metingen-live-2026-10-29.md`, "Wat niet gemeten kon worden"). Zonder die opsplitsing is elke ingreep op de 1 s-bodem gokken.
- **Wijziging**:
  1. Nieuw `netlify/lib/meting.js`: `maakMeting({ nu = () => performance.now() })` met `meet(naam, fn)` (async, telt ook bij een
     uitzondering), `tel(naam, ms)` (som en aantal), `kop()` → bv.
     `auth;dur=412, blobs-auth;dur=398, kern;dur=5480, zoho;dur=5210;desc="n=14 max=5", zoho-token;dur=0, koud;dur=0, totaal;dur=5901`, en
     `huidigeMeting()` via `AsyncLocalStorage` (`node:async_hooks`), zodat dieper gelegen code (auth, Zoho) zonder extra parameters kan
     meten. `koud`: een vlag op moduleniveau; bij de eerste aanroep van de instantie `koud;dur=<process.uptime() in ms>`, daarna `0`.
  2. `netlify/lib/beveiligd.js` (`beveiligV1`, `beveiligV2`, `:78-100`): `auth` rond `beslis`, `kern` rond de handler, `totaal` rond alles;
     de kop op het antwoord (V1: een kopie van `headers`; V2: `res.headers.set` in `try/catch`, een onveranderlijk antwoord krijgt geen kop).
     Ook op een weigering (401/403/503) en op OPTIONS.
  3. Eén logregel per verzoek: `console.log('[meting] ' + JSON.stringify({ f, m, s, auth, blobsAuth, kern, zoho, zn, zohoToken, koud,
     regio, zohoRest }))` met `regio = process.env.AWS_REGION ?? 'onbekend'` en `zohoRest` = de laatst geziene
     `X-Rate-Limit-Remaining-v3` (+ `-Request-Weight-v3`). **Geen** gebruikers-id, e-mail, cookie, querystring of ticketgegevens.
  4. `netlify/lib/auth.js:91-93`: `blobs-auth` rond `getStore` + `leesGebruikers` (via `huidigeMeting()`; zonder meting een no-op).
  5. `netlify/lib/zoho.js`: in `verzoek`, `haalToken` en `haalOrgId` de tijd tot de antwoordkop optellen bij `zoho` (en apart `zoho-token`),
     met het aantal en de hoogste gelijktijdigheid; koppen enkel lezen.
  6. **Enkel actief in een Netlify-runtime** (`heeftNetlifyRuntime(process.env)`, `netlify/lib/lokale-dev.js`) of via een testseam
     `zetMetingVoorTests(true)` die gooit in een Netlify-runtime (zoals `zetKernSpyVoorTests`, `beveiligd.js:21-24`). Reden: minstens tien
     testbestanden vergelijken de VOLLEDIGE set antwoordkoppen (o.a. `tests/server-annuleer-confirm.test.mjs:626`,
     `tests/server-mail-check.test.mjs:142`, `tests/server-http.test.mjs:70`); zo blijven alle karakteriseringstests ongewijzigd en is
     "geen gedragswijziging" aantoonbaar.
  - Functies zonder wrapper ('open'-rijen, `auth-login`, `auth-uitloggen`, geplande functies) vallen buiten deze stap.
  - Blobs-lezingen IN een functie worden niet apart gemeten: voor een functie zonder Zoho is `kern` ≈ haar eigen Blobs-tijd. Dat volstaat
    om H1 te beslissen; een omhulsel rond `getStore` in elke functie is te veel werk voor wat het oplevert.
- **Hoe de meting de hypotheses beslist** (na 1-2 werkdagen, p50/p90 per onderdeel uit de logregels, alleen-lezen via Netlify observability):

  | Wat S1 toont | Conclusie | Volgende stap |
  |---|---|---|
  | `totaal` ≪ edge-duur (bv. 150 ms tegen 1000 ms) en `koud` zelden | de tijd zit buiten de code: netwerk edge ↔ functieregio | R1 (regio) |
  | `blobs-auth` groot (≥ 300 ms) en `kern` van prijzen/instellingen even groot | H1: strong Blobs-lezingen | A1b/A1c |
  | uitschieters vallen samen met `koud > 0` | H3: koude starten | T1 (token), regio |
  | `zoho` / `n` per aanroep ≥ 300 ms | H2 voor Zoho (VS → EU) en/of Zoho zelf | R1, en Z1/Z2 (minder aanroepen) |
  | `kern` ≈ `totaal` − `auth` | H4 valt weg | - |

- **Verwachte winst**: geen, op zich. Het is het bewijs voor alle volgende stappen.
- **Risico**: de wrapper zit voor elke beveiligde functie. Een fout in de meetcode mag nooit het antwoord veranderen: alles in
  `try/catch`, een meetfout geeft gewoon geen kop. Een `AsyncLocalStorage`-context per verzoek (geen gedeelde toestand tussen verzoeken).
  Logvolume: één korte regel per verzoek (~1000 per dag).
- **Zichtbaar**: nee.
- **Acceptatie** (`node --test`, deterministisch):
  - `tests/meting.test.mjs`: `kop()` met een nepklok (vaste reeks waarden) geeft exact de verwachte tekst; `koud` enkel bij de eerste
    aanroep; een gooiende `nu` of een gooiende meetfunctie laat het resultaat ongemoeid.
  - Wrapper met de seam aan: de kop staat op 200, 401, 403, 503 en OPTIONS, met `auth`, `kern` (niet bij een weigering) en `totaal`; met de
    seam uit is de koppenset byte-gelijk aan nu (alle bestaande tests ongewijzigd groen = het bewijs).
  - `tickets` met `maakNepFetch` en de seam aan: `zoho;...desc="n=<k>"` met k = exact het aantal nep-fetch-aanroepen naar Zoho; de
    logregel bevat de e-mail en het id van de testgebruiker NIET (string-scan).
  - Een V2-antwoord met onveranderlijke koppen (bv. `Response.error()`) geeft geen uitzondering.
  - Volledige `node --test` groen, geen gewijzigde karakteriseringstest.
- **Tests draaien**: `node --test`.
- **Bestanden**: `netlify/lib/meting.js` (nieuw), `netlify/lib/beveiligd.js`, `netlify/lib/auth.js`, `netlify/lib/zoho.js`,
  `tests/meting.test.mjs` (nieuw), uitbreiding van `tests/server-beveiliging.test.mjs` en `tests/server-tickets.test.mjs`.
- **Afhankelijkheden**: geen. Alle serverstappen van fase 1b en 2 meten hiermee.
- **Kritisch pad**: ja (beveiligingswrapper van elke functie) → **opus-review**.
- **Na de release**: in Chrome DevTools → Network → een `/api/...`-verzoek → Timing: "Server Timing" staat er; in de Netlify-logs de
  `[meting]`-regels. Strip Netlify de kop onderweg, dan volstaan de logregels.

---

### S2 — O5 zoals goedgekeurd: agents en pagina 0 tegelijk, glijdend venster van 5, time-out 20 s

- **Probleem + bewijs**: 1d (`tickets.js:24-30`, `:68-83`). Ongewijzigd uit O5 van het optimalisatieplan.
- **Wijziging**: precies O5 met de bindende wijzigingen van de review (`2026-10-29-optimalisatie-review.md`, O5):
  1. `/agents?limit=50` en pagina 0 tegelijk starten (in die volgorde), maar agents (inclusief `.json()`) eerst verwerken zoals nu:
     de foutvolgorde blijft exact (agents-fout vóór paginafout; een agents-antwoord dat geen JSON is geeft 500 zoals nu).
  2. Detailverzoeken in een glijdend venster: nooit meer dan 5 tegelijk; uitvoer in `relevantIds`-volgorde; na de eerste fout geen nieuwe
     verzoeken en dezelfde 500-boodschap.
  3. Geen onafgehandelde rejections (lege `catch`-aftakking op pagina 0 en op nog lopende details).
  4. **Afwijking van O5**: `[functions.tickets] timeout = 20` in plaats van 26, gelijk aan de clientlimiet (`kern/netwerk.js:3`): boven
     20 s leest niemand het antwoord nog, dus Zoho-werk in de band 20-26 s is verspild. De opus-reviewer beslist tussen 20 en 26 (met 26
     zou `tickets` in de lange klasse van `kern/netwerk.js:4` moeten, wat een clientwijziging is).
- **Verwachte winst**: schatting 0,8-1,5 s (detailfase 20-35 % korter, plus één rondreis voor agents). Echte winst: S1 vóór/na.
- **Risico**: Zoho-limieten ongewijzigd (max 5 tegelijk, zelfde aantal verzoeken); volgorde- of foutsemantiek.
- **Zichtbaar**: nee.
- **Acceptatie**: zoals O5 in de review: bestaande `tests/server-tickets.test.mjs` ONGEWIJZIGD groen ("volledige aanroepenreeks", "batches
  van vijf" `max === 5`, "ticketdetail-fout ... alle batchaanvragen zijn al verstuurd"); nieuw: agents en pagina 0 beide verstuurd vóór een
  antwoord; 12 relevante tickets met een hangend eerste detail → ticket 6-11 worden verstuurd terwijl het eerste hangt, nooit > 5 tegelijk,
  uitvoer in volgorde; na de eerste detailfout geen nieuwe verzoeken; `process.on('unhandledRejection')` telt 0; een node-test leest
  `netlify.toml` en vindt `[functions.tickets]` met `timeout = 20`.
- **Tests draaien**: `node --test`.
- **Bestanden**: `netlify/functions/tickets.js`, `netlify.toml`, `tests/server-tickets.test.mjs`.
- **Afhankelijkheden**: liefst na S1 in productie (dan is de winst meetbaar); technisch onafhankelijk.
- **Kritisch pad**: ja (Zoho) → **opus-review**.

---

### S3 — Het Zoho org-id bewaren in de warme instantie

- **Probleem + bewijs**: `haalToegang` (`zoho.js:56-60`) vraagt bij ELKE aanroep `/organizations` op, na het token en vóór alles anders:
  één extra seriële Zoho-rondreis in elke Zoho-functie (tickets, plan, plan-datum, propose, annuleer, mail-check, ...). Bewust zo gelaten
  bij de migratie ("het org-id wordt niet gecachet", `zoho.js:3`) en vastgelegd in `tests/server-tickets.test.mjs:303`.
- **Wijziging**: in `maakZoho` het org-id naast het token bewaren (zelfde levensduur, 55 min, opnieuw opgehaald bij een nieuw token). Een
  mislukte org-aanvraag wordt niet bewaard. Geen omgevingsvariabele (dat zou een instelling bij Brent vragen).
- **Verwachte winst**: één Zoho-rondreis per warme aanroep (schatting 0,2-0,5 s; S1 toont `zoho` en `n`). Bij een koude instantie niets.
- **Risico**: laag (het org-id van een Zoho-portal verandert niet). Karakteriseringstests die de aanroepenreeks over twee aanroepen in één
  geladen module vastleggen, schuiven: enkel die bewust aanpassen, met commentaar.
- **Zichtbaar**: nee.
- **Acceptatie**: `tests/server-tickets.test.mjs:303` aangepast ("token EN org-id hergebruikt binnen één geladen module"), met commentaar;
  nieuw: na 55 min (nepklok) beide opnieuw; een org-fout wordt niet onthouden (volgende aanroep vraagt opnieuw); alle andere
  `tests/server-*.test.mjs` groen (grep naar `/organizations` in de tests en elke getroffen reeks bewust bijwerken).
- **Tests draaien**: `node --test`.
- **Bestanden**: `netlify/lib/zoho.js`, getroffen `tests/server-*.test.mjs`.
- **Afhankelijkheden**: geen; samen met S2 in fase 1b.
- **Kritisch pad**: raakt alle Zoho-functies → **opus-review (licht)**, samen met S2.

---

### S4 — Zoho-proef: alleen lezen, na een ja van Brent

- **Probleem**: elke grote winst op `tickets` (Z1, Z2, Z3) hangt af van gedrag dat de documentatie niet zeker zegt (1f).
- **Wijziging**: een los script `scripts/zoho-proef.mjs` (NIET `*.test.mjs`, dus nooit door `node --test` opgepikt; buiten `e2e/`). Het
  draait enkel met de vlag `--ik-heb-toestemming` en de Zoho-gegevens in de omgeving, op Brents pc of door een agent met zijn uitdrukkelijke
  ja. Harde poort: het omhulsel rond `fetch` weigert alles behalve GET naar `desk.zoho.eu` en de ene token-POST naar `accounts.zoho.eu`;
  max 5 tegelijk; een plafond van 150 aanroepen per run (≈ 400 krediet). **De uitvoer bevat enkel aantallen, veldnamen, ja/nee en tijden,
  nooit waarden** (de tickets bevatten klantgegevens).

  | Vraag | Aanroep (enkel GET) | Beslist |
  |---|---|---|
  | V1 welke sleutels geeft de lijst met `include=contacts,assignee`: `cf`? `modifiedTime`? e-mail/telefoon van het contact? | `/tickets?limit=100&include=contacts,assignee` | Z2-A, Z3 |
  | V2 werkt `status=` met custom statussen, en geeft het dezelfde ids als de huidige paginering + filter? | `/tickets?status=<3 huidige namen>` (≤ 100 tekens) | Z1 |
  | V3 komen de oude namen ('Wachten op planning', 'Geplande support') nog voor? | uit de gewone paginering, enkel tellen | Z1 (één of twee aanroepen) |
  | V4 geeft search per relevant ticket exact dezelfde `mapTicket`-uitkomst als het detail? (verschillen per veldnaam tellen) | `/tickets/search?status=...&limit=100` + de details | Z2-B |
  | V5 is `agentNaam(agent)` voor elke agent gelijk aan voor- + achternaam? | `/agents?limit=100` | Z3 |
  | V6 werkt `fields=modifiedTime,status` op de lijst (kort genoeg), of geeft het de gemelde 500? | `/tickets?limit=100&fields=modifiedTime,status` | Z2-A |
  | V7 zoekindex-vertraging, passief: hoe vaak en hoe lang verschilt de status in search van die in de lijst/het detail? | V4 elke 15 min over een werkdag (~40 runs) | Z2-B |
  | V8 verandert `modifiedTime` als enkel een custom field wijzigt (bv. interventiedatum na een planning)? passief tussen twee runs | detail-snapshots | Z2-A |
  | V9 waarden van `X-Rate-Limit-*` → editie en gelijktijdigheid | alle aanroepen | gelijktijdigheid > 5? |
- **Verwachte winst**: geen op zich; beslist fase 2.
- **Risico**: echte productiegegevens lezen (enkel GET, geen waarden in de uitvoer); krediet (begrensd); een vergissing in de poort (daarom
  een node-test op de poort).
- **Zichtbaar**: nee.
- **Acceptatie**: `tests/zoho-proef-poort.test.mjs`: het omhulsel weigert POST/PATCH/PUT/DELETE naar Desk, elke andere host, en een
  aanroep boven het plafond; de uitvoerfunctie geeft voor een nepticket met waarden enkel sleutels/aantallen terug (string-scan op de
  waarden). Het script zelf draait nooit in een test.
- **Bestanden**: `scripts/zoho-proef.mjs` (nieuw), `tests/zoho-proef-poort.test.mjs` (nieuw); de uitkomst in
  `docs/server-snelheid/zoho-proef-<datum>.md` (enkel aantallen).
- **Afhankelijkheden**: geen code; **een ja van Brent** vóór het draaien.
- **Kritisch pad**: de poort → **opus-review (licht)**.

---

### L1 — Laadskelet in Kalender, Ingepland en Route zolang de tickets nog onbekend zijn

Zie sectie 3 voor de inventaris en het patroon. **Zichtbaar: ja.** Waarde: geen echte snelheidswinst, wel geen misleidende lege staat meer
("niets gepland") op een start zonder bewaarde kopie (eerste gebruik, andere gebruiker op een gedeeld toestel na `claimToestel`, na
afmelden).

- **Wijziging**:
  1. `public/js/app.js`: een module-variabele `_ticketsStand` (`'onbekend'` → `'bekend'` na het toepassen van de kopie (`:598`) of een
     geslaagde lading (`:626`); `'mislukt'` na een mislukte eerste lading zonder kopie) en `_ticketsLaadStart` (tijdstip van de eerste
     lading). Via `afh` naar `kalender`, `ingepland` en `route` als `ticketsBekend()` en `skeletVertragingMs()` (=
     `max(0, 150 − (nu − _ticketsLaadStart))`). GEEN nieuwe `toestand`-sleutel: `SLEUTELS` (`kern/toestand.js:13`) wordt in O3 en in
     `e2e/tab-hertekenen.spec.mjs` in een lus gebruikt. Bij de overgang naar `'mislukt'` (geen toestandswijziging) roept `app.js`
     `kalender.markeerVerouderd()`, `ingepland.markeerVerouderd()` en de render van het zichtbare scherm aan.
  2. `schermen/kalender.js:626`: zolang `!afh.ticketsBekend()` krijgt elke dagkolom 1-2 skeletkaartjes (`bouwSkelet('kaarten', { aantal: 1 })`
     uit `kern/skelet.js:60`) in plaats van "—", en de capaciteitskop toont geen "0/x". `schermen/ingepland.js:128`: kaartenskelet in plaats
     van "Geen geplande service deze week". `schermen/route.js:244`: kaartenskelet in de lijst in plaats van "Voeg tickets ... toe" (de kaart
     blijft).
  3. De 150 ms zonder timer: deze schermen tekenen vanuit abonnementen (geen haakjes rond een verzoek), dus de vertraging zit in CSS: een
     klasse `.skelet--laat { opacity: 0; animation: skelet-verschijn 0s linear var(--skelet-vertraging, 150ms) forwards; }` in
     `css/base.css` (bij `:316-354`), met `--skelet-vertraging` per render uit `skeletVertragingMs()`. Zo begint een hertekening tijdens
     het laden (afspraken of beschikbaarheid komen binnen) de 150 ms niet opnieuw en flikkert het skelet niet.
  4. Toegankelijkheid: de lijstcontainer `aria-busy="true"` zolang het skelet staat; het skelet `aria-hidden` (zoals `kern/skelet.js:65`);
     één `.sr-only` "Laden…" met `role="status"` per scherm (niet per dagkolom). Reduced motion: bestaande regel `base.css:352-354`; het
     verschijnen is een stap in dekking, geen beweging.
  5. Geen lay-outsprong: de skeletkaart in een dagkolom heeft de hoogte van een echte `.cal-ticket`; in Ingepland en Route nakijken dat
     `.skelet-kaarten` (`base.css:334`, raster met kolommen van 240 px) dezelfde breedte en marges heeft als de echte lijst, anders een
     variantklasse.
- **Verwachte winst**: perceptie; enkel op starts zonder bewaarde kopie.
- **Risico**: specs die vroeg de lege teksten lezen; render-tellers (O3-markering bij de mislukt-overgang); `strengeAfh` (nieuwe
  `afh`-sleutels: elke `init…`-aanroep en elke test die een `afh` bouwt).
- **Acceptatie**:
  - Uitbreiding `e2e/skelet.spec.mjs` (`?test`; `loadTickets` wacht daar 400 ms): Kalender, Ingepland en Route tonen na 150 ms een
    `aria-hidden` skelet met `aria-busy` op de container en nooit "—", "Geen geplande service deze week" of "Voeg tickets ..."; daarna de
    echte inhoud zonder skelet en zonder `aria-busy`; met een bewaarde kopie (productiefixture) nooit een skelet; bij een poll nooit; een
    mislukte eerste lading (stub 500) → skelet weg, lege staat + bestaande foutmelding; `reducedMotion: 'reduce'` → geen animatie.
  - Lay-out: `boundingBox` van de balk boven de lijst ongewijzigd tussen skelet en inhoud; de eerste echte kaart begint op dezelfde y als
    het eerste skeletkaartje (± 2 px).
  - Bestaande specs groen: `e2e/kalender.spec.mjs:554,563`, `e2e/weekend.spec.mjs:65`, `e2e/route.spec.mjs:419,431` (zij wachten met
    `toHaveText`/`toBeVisible` en zien na de data de lege tekst), `e2e/tab-hertekenen.spec.mjs`, `e2e/kern.spec.mjs:173` (render-aantallen),
    `e2e/schil-flits.spec.mjs`, `e2e/wachtrij.spec.mjs:272`.
  - `@contrast`: `e2e/hemel-contrast.spec.mjs:241,243` (Route en Inventaris tellen tekstelementen met een `minimum`) moeten op de gegevens
    wachten, niet op het skelet; de releaserun `--grep @contrast --workers=1` (CLAUDE.md) draait mee omdat `css/base.css` wijzigt.
- **Tests draaien**: `node --test` (o.a. `tests/skelet.test.mjs`); `npx playwright test e2e/skelet.spec.mjs e2e/kalender.spec.mjs e2e/weekend.spec.mjs e2e/route.spec.mjs e2e/tab-hertekenen.spec.mjs e2e/kern.spec.mjs e2e/schil-flits.spec.mjs e2e/wachtrij.spec.mjs e2e/kalender-gsm-vandaag.spec.mjs e2e/kalender-indelingen.spec.mjs e2e/productie/opstart.spec.mjs`; @contrast apart.
- **Bestanden**: `public/js/app.js`, `public/js/schermen/kalender.js`, `public/js/schermen/ingepland.js`, `public/js/schermen/route.js`,
  `public/css/base.css`, e2e.
- **Afhankelijkheden**: na O3 (staat al op de tak; zelfde bestanden).
- **Kritisch pad**: Kalender is de standaardtab van de technieker → **opus-review**.

### L2 — Rapporten en Inventaris: skelet in plaats van "Laden…"

- **Probleem + bewijs**: `rapport-archief.js:59` en `index.html:404` (platte tekst "Laden…"), `index.html:411` ("Laden..." tot de
  eerste tekening van de inventaris).
- **Wijziging**: `laadRapportArchief` gebruikt `toonSkelet(body, { vorm: 'rijen', isLeeg: () => toondeLaden, verberg: [laadtekst] })`
  (zelfde patroon als `app.js:601`); een verversing met bestaande lijst blijft zonder skelet (`rapport-archief.js:55-58`). Inventaris: bij de
  eerste lading zonder kopie (`inventaris.js:35-36`) een `rijen`-skelet in `#inventaris-body`, nooit over een getekende voorraad.
- **Verwachte winst**: perceptie, enkel bij een eerste bezoek binnen ~1 s na de start of zonder kopie.
- **Risico**: laag; `meldLaadFout` steunt op `toondeLaden` (`rapport-archief.js:36-38`): ongewijzigd laten.
- **Zichtbaar**: ja.
- **Acceptatie**: `e2e/skelet.spec.mjs`: trage stub → skelet na 150 ms, `aria-busy`, daarna rijen; snelle stub → nooit een skelet; tweede
  bezoek met lijst → geen skelet; fout bij de eerste lading → de bestaande foutregel. Bestaand groen: `e2e/rapporten-laden.spec.mjs`,
  `e2e/rapporten-null-records.spec.mjs`, `e2e/rapport-verzenden.spec.mjs`, de inventaris-specs.
- **Bestanden**: `public/js/rapport-archief.js`, `public/js/inventaris.js`, `public/index.html` (enkel als de beginwaarde verandert), e2e.
- **Afhankelijkheden**: geen. **Kritisch pad**: nee (gewone review).

### L3 — "Bijwerken…" op de knop ↺ terwijl verse tickets over een bewaarde kopie komen (optioneel, Brent beslist)

- **Probleem**: met een bewaarde kopie staat er meteen iets, maar niets zegt dat de verse gegevens nog onderweg zijn (tot 6-10 s); de
  enige aanwijzing is de melding op het einde (`app.js:632`). Precies "wachten tot alles erop staat" zonder te weten wanneer dat is.
- **Wijziging**: `loadTickets` zet bij een niet-stille lading `aria-busy="true"` en een klasse `bezig` op `[data-actie="vernieuw"]`
  (`index.html:268`) en haalt ze weg in de `finally` (`app.js:646-648`); `title` "Bijwerken…". CSS: langzaam draaien; bij reduced motion
  enkel een gedempte kleur.
- **Verwachte winst**: perceptie. **Zichtbaar**: ja. **Risico**: laag (containing-block-regel: geen `transform` op de kop zelf, enkel op
  het icoon).
- **Acceptatie**: e2e: knop `aria-busy` tijdens een vertraagde stub, weg na antwoord en na fout; een stille lading (terugkeer, `stil: true`)
  zet hem niet.
- **Bestanden**: `public/js/app.js`, `public/css/app.css`, e2e. **Afhankelijkheden**: geen. **Kritisch pad**: nee.

### C1 — Beheer: verzoeken niet na elkaar

- **Probleem + bewijs**: Beheer → Instellingen vraagt de gebruikerslijst en pas DAARNA de instellingen van de eigen gebruiker
  (`beheer-instellingen.js:30` → `:208` → `:112`): 2 × ~1 s. Performance laadt eerst zijn stijlblad en pas dan de gegevens
  (`beheer-performance.js:57` → `:252`).
- **Wijziging**: in `render` van Instellingen meteen `beheerVerzoek('/api/instellingen?gebruiker=' + eigenId)` starten (eigen id uit
  `huidigeGebruiker()`), tegelijk met de lijst; de eerste `laad()` gebruikt die belofte als de gekozen gebruiker de eigen is, anders een
  gewone aanroep (een onnodig GET-verzoek is onschadelijk). Performance: `laadCss()` en de gegevens tegelijk starten, tekenen na beide.
- **Verwachte winst**: Instellingen ~1 s sneller (één bodem minder); Performance de laadtijd van het stijlblad (klein).
- **Risico**: laag; de volgnummerbescherming (`beheer-instellingen.js:108-115`) blijft.
- **Zichtbaar**: nee (sneller).
- **Acceptatie**: e2e met vertraagde stubs: beide verzoeken vertrekken vóór een antwoord (tijdstempels van `page.on('request')`); een andere
  gekozen gebruiker (sessionStorage `blitz_beheer_instellingen_persoon`) krijgt zijn eigen instellingen; bestaand groen:
  `e2e/skelet.spec.mjs` ("Instellingen: het paneel is leeg tot de gebruikerslijst er is"), de beheer-instellingen- en performance-specs.
- **Bestanden**: `public/js/schermen/beheer-instellingen.js`, `public/js/schermen/beheer-performance.js`, e2e.
- **Afhankelijkheden**: geen. **Kritisch pad**: nee.

### A1a — auth-ik leest de gebruikerslijst één keer in plaats van twee keer

- **Probleem + bewijs**: de wrapper leest de lijst (`auth.js:92-93`), daarna `auth-ik.js:24` opnieuw, enkel voor
  `moetWachtwoordWijzigen`. auth-ik staat op het kritieke pad van elke start (1b).
- **Wijziging**: `vereisGebruiker` geeft intern ook `moetWachtwoordWijzigen` mee (niet in `publiek(record)`: geen hash, geen
  `sessieVersie`); `beveiligV2` geeft het als derde argument door of via een vierde argument `{ moetWachtwoordWijzigen }`; `auth-ik` leest de
  lijst niet meer opnieuw. De 503-tak van `auth-ik.js:25-27` vervalt enkel als hij onbereikbaar wordt; anders blijft hij.
- **Verwachte winst**: één strong Blobs-lezing op auth-ik (S1 toont `blobs-auth`; schatting 0,1-0,4 s), op het kritieke pad van de start.
- **Risico**: auth-pad. **Zichtbaar**: nee.
- **Acceptatie**: `tests/server-auth-sessie.test.mjs` en `tests/auth.test.mjs` groen; nieuw: een telling op de nep-Blobs (`tests/nep-blobs.mjs`)
  geeft precies één `get('gebruikers')` per auth-ik; `moetWachtwoordWijzigen: true` komt nog juist door; het antwoord bevat geen extra velden.
- **Bestanden**: `netlify/lib/auth.js`, `netlify/lib/beveiligd.js`, `netlify/functions/auth-ik.js`, tests.
- **Afhankelijkheden**: liefst na S1 (meetbaar). **Kritisch pad**: ja (auth) → **opus-review**.

---

### Fase 2 (na de productiecijfers van S1 en de uitkomst van S4)

#### Z1 — Statusfilter op de lijst (enkel als S4-V2 slaagt)

- **Probleem**: tot 6 pagina's zonder filter, ook gesloten tickets (`tickets.js:38-60`), na elkaar.
- **Wijziging**: `/tickets?status=<namen>&limit=100&from=` in plaats van de ongefilterde paginering. Met de oude namen (V3: komen ze nog
  voor?) zijn het 107 tekens > 100: dan twee aanroepen tegelijk (te plannen + pending/gepland) of de oude namen schrappen (Brent beslist).
- **Verwachte winst**: (pagina's − 1) seriële Zoho-rondreizen; S1 toont hoeveel pagina's er nu zijn (`n`).
- **Risico**: een custom status die het filter stil weglaat (daarom V2: exact dezelfde ids). **Zichtbaar**: nee.
- **Acceptatie**: karakteriseringstests bewust aangepast; nieuw: de statusparameter is ≤ 100 tekens (test op de opgebouwde URL);
  dezelfde uitvoer als de huidige filter op een nep-dataset.
- **Kritisch pad**: ja (Zoho) → **opus-review**.

#### Z2 — Geen detailverzoek meer per ticket (de grote winst; variant volgens S4)

Rangschikking volgens waarde en risico; maar één variant wordt gebouwd.

- **Z2-A: cache van de details op `modifiedTime`** (enkel als V6 en V8 slagen: de lijst geeft `modifiedTime` en die verandert ook bij een
  wijziging van enkel een custom field). De lijst (realtime, geen zoekindex) geeft ids, status en `modifiedTime`; details enkel voor
  tickets waarvan `modifiedTime` verschilt van de cache. **Waar**: één blob (`tickets-details`, enkel de velden van `mapTicket`, dus
  dezelfde gegevens als `blitz_tickets_cache` op elk toestel), niet in het functiegeheugen: bij ~75 aanroepen per dag en één verzoek per
  instantie tegelijk is de instantie meestal koud en zou een geheugencache bijna nooit raken. **Correctheid**: een regel wordt enkel
  gebruikt als zijn `modifiedTime` exact gelijk is aan die van de lijst; twee gelijktijdige ladingen schrijven "laatste wint", wat veilig
  is omdat elke regel zichzelf valideert. Onze eigen schrijfacties (plan, plan-datum, propose, annuleer) veranderen `modifiedTime` en
  invalideren dus vanzelf (V8 bevestigt dat ook voor die paden). Faalt V8 (een custom field verandert zonder nieuwe `modifiedTime`): **niet
  bouwen**, want dan toont de app een oud adres of een oude interventiedatum.
  Winst: na de eerste lading enkel details van gewijzigde tickets (meestal 0-3): tickets p50 schatting 6 s → 1,5-2,5 s (met S2/S3).
- **Z2-B: hybride lijst + search** (als Z2-A niet kan en V4 slaagt). De lijst blijft de bron van ids en status (realtime); één of twee
  search-aanroepen leveren de custom fields; een detailverzoek enkel voor ids die search mist of waarvan de status in search verschilt
  van de lijst. Restrisico door de indexvertraging (V7): een custom field dat wijzigt ZONDER statuswissel (bv. de interventiedatum na
  `plan-datum`) kan in search tot minuten oud zijn. Tegenmaatregel: onze schrijffuncties (plan, plan-datum, propose, annuleer,
  confirm-afspraak) zetten het ticket-id met tijdstip in een klein register in Blobs; `tickets` haalt die ids 15 min lang altijd via het
  detail. Wijzigingen die iemand rechtstreeks in Zoho doet, blijven tot de indexvertraging oud: **Brent beslist** of dat aanvaardbaar is.
  Winst: vergelijkbaar met Z2-A.
- **Z2-C: niets van beide**: de details blijven (met S2). Geen verdere servertaak op tickets.
- Search als ENIGE bron (zonder de lijst): **niet doen** (sectie 5).
- **Zichtbaar**: nee. **Acceptatie**: node-tests met nep-Zoho: dezelfde `{ tickets, pendingTickets, plannedTickets }` als nu voor dezelfde
  dataset (gouden uitvoer); Z2-A: gewijzigde `modifiedTime` → precies dat ene detail; Z2-B: status verschilt → detail; register-id → detail;
  nooit > 5 tegelijk; het aantal Zoho-aanroepen per lading in de test vastgelegd (en ≤ nu). Na de release: S1-`n` en de duur.
- **Bestanden**: `netlify/functions/tickets.js`, (Z2-B) de schrijffuncties en een kleine lib, tests.
- **Kritisch pad**: ja → **opus-review**.

#### Z3 — `include=assignee` in plaats van `/agents` (enkel als S4-V5 slaagt)

- Eén Zoho-aanroep minder (na S2 loopt hij parallel, dus vooral krediet en een verbinding). Klein; enkel samen met Z1/Z2.

#### A1b / A1c — De gebruikerslijst sneller lezen (enkel als S1 H1 bevestigt)

- **A1b: korte geheugencache van de gebruikerslijst** (≤ 10 s, enkel voor lezende verzoeken, ongeldig gemaakt bij een eigen schrijfactie).
  Regel: een cachetreffer telt enkel als record gevonden, `actief`, `sessieVersie === claims.sv` en rol toegestaan; bij elke afwijking
  opnieuw strong lezen. Zo kan de cache enkel ten onrechte TOELATEN, nooit ten onrechte weigeren (een nieuwe gebruiker, een nieuw
  wachtwoord met `sessieVersie + 1` of een nieuwe cookie leest strong). Veiligheid: gewoon afmelden verhoogt `sessieVersie` NIET
  (`auth-uitloggen.js` wist enkel de cookie), dus daar verandert niets; wel vertraagt blokkeren, rolwijziging, wachtwoordreset door de
  beheerder en "overal uitloggen" (`netlify/lib/gebruikers.js:137`, `netlify/functions/gebruikers.js:164`, `:185`) tot 10 s per warme
  instantie. **Maar de verwachte winst is klein**: elke functie is een eigen instantie die één verzoek tegelijk behandelt; de start roept
  negen VERSCHILLENDE functies één keer aan en de poll komt om de 5 min. Een cache van 10 s raakt dan bijna nooit. Enkel bouwen als S1
  toont dat dezelfde functie vaak binnen enkele seconden herhaald wordt.
- **A1c: `consistency: 'eventual'` voor de lezing in de auth, met strong als terugval bij elke afwijking** (zelfde regel als A1b). Een
  eventual-lezing komt uit de edge-cache, dus vermoedelijk snel en ook bij een koude instantie. Prijs: een blokkering of rolverlaging werkt
  pas na de verspreiding (Netlify: tot ~60 s), ongecontroleerd. **Brent beslist** welk venster aanvaardbaar is; schrijvende verzoeken blijven
  strong. → **opus-review** (beveiliging).
- Winst: onbekend tot gemeten; als H1 klopt tot ~0,3-0,5 s op ELK verzoek.

#### R1 — Functieregio (instelling van Brent, geen code)

- Als S1 toont dat de tijd buiten de code zit (`totaal` ≪ edge-duur) of dat elke Zoho-aanroep traag is: Brent zet in Netlify (Site
  configuration → Build & deploy → Functions → regio) een EU-regio (bv. Frankfurt), als zijn abonnement dat toelaat, en er volgt een
  nieuwe deploy. Daarna S1 vóór/na vergelijken, vooral `blobs-auth`: ligt de Blobs-opslag in de VS, dan kan die trager worden. Volledig
  omkeerbaar.

#### C3 — Tickets vroeger starten (O4 deel 1, opnieuw bekeken: precies één Zoho-lading per start)

- **Probleem**: `/api/tickets` start pas na modules + auth-ik + instellingensync (1b), ~1-1,5 s na het openen op een gsm.
- **Twee varianten** (bouw er één, na O1 in productie gemeten, zoals de review vroeg):
  - **C3a** in `startNaInlog` (`rol-schil.js:140-161`), meteen na een geslaagd `laadSessie`, vóór de instellingensync; niet voor `sales`.
    `loadTickets` neemt bij zijn EERSTE aanroep die belofte (één keer). Winst: enkel de duur van de sync (met O1 vaak klein, 0-0,5 s).
    Risico op een dubbele Zoho-lading: vrijwel nul (zelfde cookie, gebruiker gekend).
  - **C3b** in het inline script van O1 (`index.html:72-99`), enkel met een bewaarde sessie waarvan de rol niet `sales` is. Winst: ~1-1,5 s
    (de modules en auth-ik lopen dan parallel met tickets). Waarom dat nu veiliger is dan in de review: het antwoord hangt niet van de
    gebruiker af (1d), dus een andere gebruiker na een inlogscherm is geen probleem; een 401/403 (verlopen sessie, verplichte
    wachtwoordwijziging: de rechtenrij heeft geen `ookBijWijzigen`) raakt Zoho niet en wordt weggegooid (dan een gewone aanvraag na de
    login). Elke andere uitkomst (200, 5xx, netwerkfout) wordt precies één keer gebruikt, ook als ze laat komt. Een dubbele lading blijft
    enkel mogelijk bij een herlading van de pagina (zoals vandaag).
- **Acceptatie**: `e2e/productie/vroege-start.spec.mjs` telt precies één `GET /api/tickets` per start in elk scenario: gewone start,
  auth-ik 401 → inloggen, bewaarde `sales`-sessie (nul vroege), vroege 500 (fout getoond, geen tweede aanvraag), vroege netwerkfout,
  wachtwoordwijziging verplicht; 0 consolefouten; `npx playwright test --project=sw` (offline start zonder "Uncaught").
- **Zichtbaar**: nee. **Kritisch pad**: ja (gegevensstroom, Zoho-last) → **opus-review**.

#### T1 — Zoho-token over koude starten heen bewaren (enkel als S1 vaak `koud` en een grote `zoho-token` toont)

- Een koude instantie vraagt een nieuw token (POST accounts.zoho.eu). Bewaren in Blobs (versleuteld met een geheim uit de omgeving) spaart
  die rondreis en vermindert het aantal tokenaanvragen (Zoho begrenst tokenaanvragen per refresh-token; nakijken). Raakt een geheim:
  **opus-review**.

#### K1 — Kortere wachttijd op auth-ik bij een bewaarde sessie (na O1 in productie)

- `KORTE_LIMIET_MS` = 5 s (`kern/sessie.js:148`): bij een trage auth-ik (p90 2,6 s, p99 6,2 s) ziet de gebruiker tot 5 s enkel logo en
  hemel. Een kortere limiet (bv. 2 s) start vaker uit de cache, met de bestaande late afhandeling (`verwerkLaat`) als auth-ik later
  401 geeft. Brent beslist (een late 401 toont het inlogscherm midden in het werk).

---

## 3. Laadskeletten (extra vraag van Brent)

"Bij Beheer hebben we denk ik een laadanimatie; misschien moeten we ook een loading skelet toevoegen op andere pagina's." Klopt: de
"laadanimatie" in Beheer is het skelet met glans van `kern/skelet.js` (stijl `css/base.css:316-354`). Het bestaat al op meer plaatsen.

### 3a. Wat de gebruiker vandaag ziet tijdens het laden

| Scherm | Vandaag | Goed? | Bewijs |
|---|---|---|---|
| Start (alle rollen) | logo en hemel, schil verborgen tot auth-ik + sync | geen skelet; zie K1 | `index.html:2`, `app.css:1204`, `rol-schil.js:140-161` |
| Wachtrij | kaartenskelet na 150 ms, enkel zonder tickets; "Laden..." verborgen | ja | `app.js:600-601`, `:647`, `index.html:319` |
| Kalender | weekraster met "—" per dag en "0/x" in de kop | **nee**: te vroege lege staat | `kalender.js:618-626` |
| Ingepland | "Geen geplande service deze week" | **nee**: te vroege lege staat | `ingepland.js:126-128` |
| Route | "Voeg tickets of installaties toe via de Kalender"; daarna "Route berekenen..." | **nee** (lege staat); de berekening heeft een melding | `route.js:244`, `:459` |
| Rapporten | platte tekst "Laden…" (eerste keer) | matig | `rapport-archief.js:59`, `index.html:404` |
| Inventaris | platte tekst "Laden..." (eerste keer) | matig | `index.html:411` |
| Beheer (alle tabs) | paneelskelet + tabskelet na 150 ms | ja | `beheer.js:16`, `:118`; `beheer-gebruikers.js:458`; `beheer-activiteit.js:76`; `beheer-performance.js:142`; `beheer-systeemstatus.js:115`; `beheer-themas.js:95` |
| Beheer → Instellingen, tweede verzoek | tekst "Laden…" onder een al getekend formulier | aanvaardbaar (C1 maakt het korter) | `beheer-instellingen.js:111` |
| Sales (4 schermen) | skelet per scherm | ja | `sales-schil.js:100-105` |
| Verse tickets over een bewaarde kopie | niets, tot de melding op het einde | **nee**: niemand weet dat er nog iets komt | `app.js:632`; zie L3 |

### 3b. Het patroon (één regel voor alle schermen)

1. **Hergebruik** `kern/skelet.js` (`toonSkelet` voor schermen met een eigen verzoek; `bouwSkelet` voor schermen die vanuit abonnementen
   tekenen) en de bestaande vormen `kaarten`, `rijen`, `route`. Geen nieuwe module (dus geen `SHELL`-wijziging).
2. **150 ms**: `toonSkelet` heeft de timer al (`skelet.js:17`, `:114`); voor schermen zonder verzoekhaakjes de CSS-vertraging
   `.skelet--laat` met `--skelet-vertraging` (L1, punt 3), zodat een snelle lading niet flitst en een hertekening tijdens het laden niet
   opnieuw begint.
3. **Nooit over getoonde gegevens**: enkel bij `ticketsBekend() === false` (geen kopie, nog geen geslaagde lading) of een leeg vak
   (`isLeeg`). Een poll, een terugkeer of "Vernieuwen" toont nooit een skelet; daarvoor is L3.
4. **Toegankelijkheid**: `aria-busy="true"` op de container, het skelet `aria-hidden`, één `.sr-only` "Laden…" met `role="status"`
   (zoals `skelet.js:93-96`); reduced motion zonder glans (`base.css:352-354`).
5. **Geen lay-outsprong**: skeletblokken met de maat van de echte kaart; e2e meet de positie van balk en eerste kaart.
6. **Fout**: het skelet maakt altijd plaats (zoals `app.js:647`), daarna de bestaande lege staat en foutmelding.

### 3c. Rangschikking (eerlijk)

Laadskeletten maken niets sneller. Hun waarde: de gebruiker ziet dat er iets komt in plaats van een scherm dat "niets gepland" zegt. Dat
telt vooral op een start zonder bewaarde kopie (eerste gebruik, gedeeld toestel na een andere gebruiker, na afmelden) en bij een eerste
bezoek aan Rapporten/Inventaris kort na de start. Op het dagelijkse toestel met een kopie verandert er weinig; daar helpt L3 meer. Volgorde
binnen deze groep: L1 (misleidende lege staten weg) > L3 (weten dat er nog iets komt) > L2 (platte tekst → skelet).

### 3d. Getroffen tests

`tests/skelet.test.mjs`; `e2e/skelet.spec.mjs` (uitbreiden); `e2e/kalender.spec.mjs:554,563`; `e2e/weekend.spec.mjs:65`;
`e2e/route.spec.mjs:419,431`; `e2e/schil-flits.spec.mjs` (bemonstert "Laden..."); `e2e/wachtrij.spec.mjs:272`; `e2e/kern.spec.mjs:173` en
`e2e/tab-hertekenen.spec.mjs` (render-aantallen); `e2e/rapporten-laden.spec.mjs`; `@contrast`: `e2e/hemel-contrast.spec.mjs:241,243`
(Route en Inventaris tellen tekst; moeten op de gegevens wachten) en `e2e/versiering.spec.mjs` (de lege teksten van een thema via
`eventTekst`); de schermafdrukken van `scripts/maak-schermafdrukken.mjs` (opnieuw maken als ze bij de release horen).

---

## 4. Volgorde in fasen

| Fase | Wat | Release | Waarom zo |
|---|---|---|---|
| **1a** | **S1** (meten); **L1**, **L2**, **C1** (client, los van de cijfers); **L3** als Brent ja zegt | release A (kan samen met O1/O2/O3/O6 die al op de tak staan) | S1 eerst alleen op de server, zodat de cijfers van fase 1b een vóór-meting hebben |
| **1a, parallel** | **S4** Zoho-proef (geen release), enkel na een ja van Brent | - | beslist fase 2; passieve meting (V7, V8) vraagt een werkdag |
| **1b** (1-2 werkdagen na A) | **S2** (O5 + time-out 20), **S3** (org-id), **A1a** (auth-ik één lezing) | release B (enkel server; geen `public/`) | elk afzonderlijk zichtbaar in S1 (`zoho n`, `blobs-auth`) |
| **2** (na S1-cijfers en S4) | Z1 / Z2 (variant volgens S4) / Z3; A1b of A1c of R1 volgens de beslistabel van S1; C3 (na O1 in productie); T1; K1 | per stuk | enkel wat de cijfers rechtvaardigen |

Opus-review: S1, S2+S3, S4 (poort), L1, A1a, Z1, Z2, A1c, C3, T1. Gewone review: L2, L3, C1, Z3.

Parallel bouwen (geen gedeelde bestanden): S1 (`netlify/lib/beveiligd.js`, `auth.js`, `zoho.js`, `meting.js`) ∥ L1 (`app.js`, `kalender.js`,
`ingepland.js`, `route.js`, `base.css`) ∥ L2 (`rapport-archief.js`, `inventaris.js`) ∥ C1 (`beheer-instellingen.js`,
`beheer-performance.js`). L3 raakt `app.js` (na L1). S2, S3 en A1a raken `zoho.js`/`auth.js`/`beveiligd.js`: na S1, onderling S3 → S2 →
A1a of in één worktree.

---

## 5. Niet doen (met reden)

1. **Search als enige bron van de tickets.** De zoekindex loopt achter ("may require some time"); na een eigen planactie haalt de app meteen
   opnieuw op (`planResync`) en zou dan het ticket in de oude status terugzetten (terug in de Wachtrij, uit de planning gehaald door
   `applyTicketsData`, `app.js:516-530`). Enkel hybride (Z2-B).
2. **`fields=` voor de custom fields.** 100 tekens voor de hele lijst veldnamen; `mapTicket` heeft er 13 `cf_*` nodig (plus de adres-terugval). Enkel een kort veld
   zoals `modifiedTime` (V6).
3. **Meer dan 5 Zoho-verzoeken tegelijk.** De gelijktijdigheidslimiet hangt af van de editie (Free 5); zonder bevestiging van Brent of uit
   de `X-Rate-Limit`-koppen (V9) niet.
4. **Een geheugencache van de gebruikerslijst "omdat het kan".** Bij dit verkeer (elke functie een eigen instantie, één verzoek tegelijk,
   weinig herhaling binnen seconden) raakt hij bijna nooit, en hij vertraagt blokkeren en rolwijzigingen. Enkel A1b als S1 het tegendeel
   toont.
5. **Blobs overal op `eventual`.** Functies met optimistic locking (`bewaarMetVersie`) lezen na hun eigen schrijfactie; een oudere lezing
   geeft valse 409's of verdwenen wijzigingen. Enkel de auth-lezing met strong-terugval (A1c), en enkel na S1.
6. **Een serverkopie van de ticketlijst die meteen geantwoord wordt (stale-while-revalidate op de server).** Netlify kan na het antwoord
   niet verder verversen; een Blobs-kopie met levensduur moet bij ELKE schrijfactie (plan, plan-datum, propose, annuleer, confirm-afspraak)
   ongeldig gemaakt worden en "Vernieuwen" en de resync moeten erlangs, anders toont de app oude gegevens net na een eigen wijziging. De
   bestaande clientkopie (`blitz_tickets_cache`, `app.js:596-599`) geeft op het dagelijkse toestel al een directe weergave. Mogelijk later,
   als stabiliteitsstap: de laatste goede lijst teruggeven met `stale: true` als Zoho faalt, en de client past die toe als kopie
   (`reconcile: false`). Niet in dit plan.
7. **Een cache van details zonder bewezen `modifiedTime`-gedrag** (V6 en V8). Dan tonen Kalender en Route een oud adres of een oude datum.
8. **De schil tonen vóór auth-ik.** De verborgen schil voorkomt dat een verkoper even de plannerschil ziet (`e2e/schil-flits.spec.mjs`);
   K1 (kortere limiet) is de veilige knop.
9. **Functies "warm houden" met een geplande ping.** Elke functie is een eigen instantie; een ping houdt enkel zichzelf warm en kost
   aanroepen. Koude starten pakken we (indien nodig) met T1 en de regio aan.
10. **De clientlimiet van 20 s verlengen.** Langer wachten maakt het niet sneller; met S2 en Z2 komt `tickets` ver onder 20 s.
11. **Een skelet over getoonde gegevens of bij elke poll.** Dat geeft de flits die het skelet net moet vermijden; L3 dekt het verversen.
12. **Edge Functions (Deno) in de EU voor tickets.** Herschrijven van de Zoho-laag en de auth naar een andere runtime; R1 is de goedkope
    variant van hetzelfde idee.

---

## 6. Risico's voor de release

- **CACHE_NAME-regel** (`CLAUDE.md`, "Versioning"): elke release die iets onder `public/` wijzigt, hoogt `CACHE_NAME` in `public/sw.js` op
  (`tests/sw-schil.test.mjs` pint de waarde). Release A doet dat (L1, L2, C1, L3 en de O-taken van de tak); release B (S2, S3, A1a) raakt
  `public/` niet. Geen nieuw bestand onder `public/js/` gepland; gebeurt het toch: `SHELL` + modulepreload in dezelfde commit.
- **`css/base.css` wijzigt (L1)**: de `@contrast`-proeven apart draaien (`npx playwright test e2e/versiering.spec.mjs e2e/hemel-contrast.spec.mjs --grep @contrast --workers=1`).
- **Beveiligingswrapper (S1, A1a)**: elke beveiligde functie loopt erdoor. De meting mag nooit een antwoord veranderen (seam-test, alle
  karakteriseringstests ongewijzigd). Na de release in de Netlify-logs: geen nieuwe 500's, en de `[meting]`-regels bevatten geen
  persoonsgegevens.
- **Zoho**: limieten van 100 tekens (`fields`, `status`), gelijktijdigheid 5, krediet (ruim, 1f). Na elke Zoho-release: geen
  `TOO_MANY_REQUESTS`/429 in de logs, `zoho n` per lading gelijk of lager, duur van `tickets` p50/p90 vóór/na.
- **Time-out 20 s (S2)**: een lading die vandaag na 20-26 s zou lukken, faalt voortaan op de server in plaats van in de client; voor de
  gebruiker gelijk (de client brak al af na 20 s).
- **Geen servercache zonder invalidatie bij schrijven** (sectie 5, punten 6 en 7).
- **Regio (R1)**: verandert de latentie van ALLE functies, ook Blobs; meten vóór/na, terugzetten kan.
- **Productietests en het `sw`-project** draaien zonder `?test`: daar lopen de vroege verzoeken (O1, C3) echt; specs tellen exact.

---

## 7. Open vragen voor Brent

1. **Zoho-proef (S4)**: mag er een script draaien dat enkel LEEST in Zoho Desk (geen enkele wijziging, max ~150 aanroepen per run, en
   voor de passieve meting een werkdag lang elke 15 min), en wie draait het (jij op je pc, of een agent met jouw toestemming)?
2. **Zoho-editie**: welke editie heeft de Blitz-portal (Free, Express, Standard, Professional, Enterprise)? Dat bepaalt hoeveel verzoeken
   tegelijk mogen.
3. **Oude statusnamen**: worden 'Wachten op planning' en 'Geplande support' nog gebruikt, of mogen ze uit de lijst?
4. **Netlify**: welk abonnement, en mag de functieregio naar de EU als de meting dat aanraadt (jij zet dat in Netlify)?
5. **Blokkeren en rollen (enkel als A1c nodig blijkt)**: is het aanvaardbaar dat een blokkering of rolwijziging tot ~60 s nodig heeft om
   overal te gelden, in ruil voor ~0,3-0,5 s sneller op elk verzoek?
6. **Search (enkel als Z2-B nodig blijkt)**: is het aanvaardbaar dat een wijziging die iemand rechtstreeks in Zoho doet (bv. een adres)
   enkele minuten later in de app verschijnt? Wijzigingen vanuit de app zelf blijven direct.
7. **Laadskeletten**: akkoord met skeletten in Kalender, Ingepland, Route, Rapporten en Inventaris (zichtbaar), en met de draaiende ↺
   "Bijwerken…" (L3)?
8. **Kortere wachttijd bij de start (K1)**: liever sneller starten met de kans dat later toch het inlogscherm verschijnt, of zoals nu tot 5 s
   wachten?

---

## 8. Na de release meten

- Release A: 1-2 werkdagen `[meting]`-regels verzamelen (alleen lezen via Netlify observability); per functie p50/p90 van `auth`,
  `blobs-auth`, `kern`, `zoho` (+ `n`), `koud`, `totaal`, naast de edge-duur. Beslistabel van S1 invullen in
  `docs/server-snelheid/metingen-na-S1-<datum>.md`.
- Release B: dezelfde tabel; `tickets` p50 vóór/na (verwachting met S2+S3: 6,0 → ~4,5-5 s; onbekend tot gemeten), `zoho n` gelijk of lager.
- Op een echte gsm: Kalender zonder bewaarde kopie (andere gebruiker op een testtoestel) toont een skelet en geen "—"; de ↺ draait tijdens
  het verversen.
