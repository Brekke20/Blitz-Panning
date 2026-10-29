# Optimalisatie snelheid en stabiliteit (nacht 28-29 oktober 2026)

Tak `optimalisatie-2.5.1` (= v2.5.1, `3029140`; harnassen en baseline in `a392044`, `05ee140`). Geen versie- of `CACHE_NAME`-ophoging
in deze taken (dat gebeurt bij de release). Planner: statische analyse, de baseline in
`docs/optimalisatie/meting-baseline-{laden,snelheid,interactie,stabiliteit}.json` en drie korte sondes (sectie 1e).

Regels voor elke implementeerder:
- Lees eerst `CLAUDE.md` (tests, service worker, `afh`/`strengeAfh`, karakteriseringstests, OneDrive-`ENOENT`).
- `node --test` zonder pad (nooit `node --test tests/`). E2E enkel gericht (`npx playwright test <specs> --workers=2`); de volledige
  suite draait de opzichter één keer op het einde. Nooit twee volledige Playwright-runs tegelijk (trage pc, zie J6/F7).
- Een karakteriseringstest wijzig je enkel bewust, met een commentaarregel waarom.
- Geen nieuw bestand onder `public/js/`. Lukt het echt niet anders: in dezelfde commit in `SHELL` van `public/sw.js` en (statische import)
  in de modulepreload-lijst van `index.html` (`tests/sw-schil.test.mjs`). Nieuwe testbestanden vallen daar niet onder.
- Geen zichtbare wijziging behalve wat hieronder "zichtbaar" heet; geen gewijzigde bedrijfslogica (Zoho-statussen, mails, rechten).
- Meten tegen de baseline in DEZELFDE sessie (de cijfers schommelen per sessie): maak de basis met
  `git archive 3029140 public | tar -x -C C:/tmp/blitz-basis` (of gebruik `C:\Users\BRENT\blitz-baseline-2.5.1\public`) en draai met
  `--voor=<basis>` (meet-laden, meet-snelheid, meet-interactie wisselen dan af). De baselinecijfers hieronder zijn de referentie; een
  criterium "≤ X" geldt voor de mediaan van de na-variant in een voor/na-run. Ruim daarna `chrome-headless-shell`/`node`-processen op.

---

## 1. Het huidige beeld (met bewijs)

### 1a. Baseline (mediaan, 5 runs)

| Meting | Desktop | Telefoon (375x812, 4x CPU, gsm) |
|---|---|---|
| Tab Kalender, eerste / herhaald bezoek | 100 / 43 ms | **1267 / 466 ms** |
| Tab Ingepland, eerste / herhaald | 51 / 53 ms | **630 / 563 ms** |
| Tab Wachtrij, herhaald (hertekent NIET bij openen) | 37 ms | 152 ms |
| Tab Rapporten, eerste / herhaald | 28 / 24 ms | 242 / 158 ms |
| Week: naar lege week / terug naar volle week | 16 / 26 ms | 119 / **335 ms** |
| Ticketdetail uit Wachtrij / uit Kalender | 53 / 38 ms | 110 / 222 ms |
| Langste lange taak; som lange taken (sessie) | 81 ms; 148 ms | **914 ms; 7107 ms (50 taken)** |
| Geheugen na laden -> na sessie | 3,4 -> 4,0 MB | 3,4 -> 3,7 MB |
| Consolefouten van de app | 0 | 0 |
| Eerste ticket zichtbaar (`?test`, met vaste 400 ms wachttijd in `app.js:605`) | - | 2956 ms |
| Scrollen, beelden in 3 s (180 = vlot): wachtrij / kalender / ingepland | - | **119 / 98 / 165** |

| meet-laden (desktop, HTTP/1.1, geen CPU-vertraging) | koud | warm | warm + SW |
|---|---|---|---|
| server 0 ms: klaar / verzoeken | 678 ms / 142 | 526 ms / 142 | 445 ms / 155 |
| server 150 ms: klaar / verzoeken | **4295 ms** / 142 | **3849 ms** / 142 | **3854 ms** / 142 |
| `rapport-wizard.js` parse + evaluatie (4x CPU) | 9 ms | | |

Stabiliteit: 8 kernspecs x2 = 254/254 groen. **Geheugen is geen probleem** (geen lek). **De wizard lazy laden levert niets** (9 ms).

### 1b. Opstart: waar de tijd gaat (sonde, koud, 150 ms per verzoek)

- Alle 114 modules worden tussen 217 en 237 ms na de start gevraagd: de modulegraaf is dankzij modulepreload al **plat** (diepte 1).
  `DOMContentLoaded` valt pas op 3536 ms: het harnas spreekt HTTP/1.1 (6 verbindingen per host), dus ~137 verzoeken x 150 ms / 6.
  Op Netlify (HTTP/2) lopen die verzoeken parallel; het aantal verzoeken verlagen kan enkel door te bundelen (geen buildstap: "Niet nu").
- Daarna een **seriële staart van ~730 ms**: `auth-ik` op 3547 ms -> `instellingen?overzicht=1` op 3734 ms -> `tickets` (+8 andere) op
  3898 ms -> klaar op 4268 ms. Bewijs in de code: `rol-schil.js:140-161` (`laadSessie` -> `synchroniseerInstellingen` -> `opstart`),
  `kern/sessie.js:123-209`, `kern/instellingen-sync.js:199-217`, `app.js:587-649`. Die drie verzoeken hangen enkel van de cookie af en
  kunnen al starten terwijl de modules laden.
- **Elke start vraagt een kaarttegel** (`server.arcgisonline.com/.../tile/8/85/131` op 3899 ms), ook op de gsm waar Route niet bestaat:
  `initMap()` in `opstart` (`app.js:324`) maakt meteen een Leaflet-kaart met tegellaag (`route-kaart.js:315-324`).
- Warm + SW is bij een trage server niet sneller dan warm (3854 tegen 3849 ms): de SW is netwerk-eerst (besluit van Brent, zie "Niet nu").

### 1c. Telefoon: tabwissels en weekwissel (sonde met Performance-trace)

- `.view { display: none }` (`css/app.css:129`): een verborgen tabblad heeft geen lay-out. Daarom bouwt `setTab` Kalender en Ingepland
  bij ELK bezoek volledig opnieuw op (`app.js:942-943`, `kalender.js:51`), ook als er niets veranderde. Herhaald bezoek: Kalender
  466 ms, Ingepland 563 ms; de Wachtrij, die bij openen niet hertekent, kost 152 ms: dat is de bodem van een tabwissel.
- `koppelRenders` (`app.js:742-768`) hertekent bij elke gegevenswijziging alle schermen, ook verborgen; `e2e/kern.spec.mjs:173` legt
  die aantallen vast.
- **Eerste Kalenderbezoek (1267 ms, de lange taak van 914 ms)**: één volledige lay-out van het document met ~1000 objecten kost daar
  818 ms; dezelfde lay-out kost bij latere bezoeken 13-189 ms. Het is een eenmalige kost (waarschijnlijk het eerste lettertype/emoji-
  terugval in deze headless omgeving). `dok-meer.js:105` (`offsetParent`) dwingt die lay-out af, maar is niet de oorzaak: de lay-out
  verplaatsen (proef met `checkVisibility()` en met `requestAnimationFrame`) gaf 1377 en 1374 ms. Geen taak; zie "Niet nu".
- Polling (`app.js:814-828`, elke 5 min) en terugkeer naar de app (`app.js:884-891`) passen tickets ALTIJD opnieuw toe (`app.js:626`).
- `kern/opslag.js:35-44`: `geocacheLookup` doet bij elke opzoeking `JSON.parse` van de hele geocache (tot 500 adressen); per gepland
  ticket in `applyTicketsData` (`app.js:544`). In de harnassen is de geocache leeg, op een echt toestel niet.

### 1d. Scrollen: het glas van de lijstkaarten (sonde, zelfde sessie, 3 runs)

Elke lijstkaart heeft `backdrop-filter: blur(var(--blur)) saturate(180%)` (`css/app.css:176-185`; op de gsm `--blur` 10 px,
`base.css:184`). Proef met `scripts/meet-snelheid.mjs --css=...` waarbij de kaarten enkel `saturate(180%)` houden (geen vervaging):

| beelden in 3 s | huidig (zelfde sessie) | kaarten zonder vervaging |
|---|---|---|
| Wachtrij | 123 (101-130) | **180** (172-182) |
| Kalender | 96 (84-100) | **119** (114-122) |
| Ingepland | 153 (138-160) | **180** (170-181) |

De vervaging van de kaarten kost dus een derde van de beelden in de Wachtrij. Achter een lijstkaart ligt enkel de hemel: zachte
CSS-verlopen (`css/hemel.css:9-10`), behalve 's nachts (kleine sterren, `hemel.css:16`) en bij een thema met achtergrondbeeld
(`data-event-achtergrond="ja"`). Een vervaging van een zacht verloop is vrijwel gelijk aan het verloop zelf. Het eerder afgesproken
terugvalpad uit het snelheidsrapport van v2.5.0 was al: "eerst minder vervaging, daarna geen backdrop-filter op de lijstkaarten"
(`docs/superpowers/specs/assets/2026-10-27-open-dag-snelheid.md`, Besluit).

### 1e. Server en stabiliteit

- `netlify/functions/tickets.js`: `/agents` wacht vóór de paginering (`:25`, het commentaar zegt "parallel"); pagina's na elkaar
  (`:43-60`); daarna per relevant ticket een detailverzoek in **lock-step batches van 5** (`:68-83`). Geen `[functions.tickets]` in
  `netlify.toml` (andere zware functies: 26 s). Niet zichtbaar in de harnassen (die stubben `/api`).
- `public/js/rapport-archief.js:30-51`: geen `res.ok`-controle; een 5xx/503 zonder `rapports` maakt de lijst leeg en zet `_archiefVersie`
  op 0 (`:40-41`); die versie gebruikt het rapportverzenden (`schermen/rapport-verzenden.js:186, 278`). Offline vervangt een foutregel de
  getoonde lijst. Elk openen van Rapporten (`app.js:944`) hertekent archief EN kalender, ook bij hetzelfde antwoord.

---

## 2. Taken (in volgorde van waarde)

| Golf | Parallel (geen gedeelde bestanden) |
|---|---|
| 1 | O1 (index.html, kern/api, sessie, instellingen-sync), O2 (css/app.css + spec), O6 (rapport-archief.js) |
| 2 | O3 (app.js, kalender.js, ingepland.js), O5 (server), O7 (kern/opslag.js) |
| 3 | O4 (index.html, app.js, kern/opslag.js; na O1, O3, O7), O8 (route-kaart.js) |

---

### O1 — Opstartverzoeken (auth-ik, instellingen) al starten terwijl de modules laden

- **Probleem + bewijs**: 1b. De seriële staart na `DOMContentLoaded` is ~730 ms bij 150 ms per verzoek; `auth-ik` en `instellingen`
  zijn daar ~350 ms van.
- **Wijziging**:
  1. `public/index.html`: een klein inline `<script>` in de `<head>` (na het themascript, vóór de stijlbladen) dat, enkel BUITEN `?test`
     (`new URLSearchParams(location.search).has('test')`), meteen `fetch('/api/auth-ik')` en `fetch('/api/instellingen?overzicht=1')`
     start en de beloftes bewaart in één globale (bv. `window.__blitzVroeg = { authIk, instellingen, t }`). Elk met dezelfde tijdlimiet als
     `kern/netwerk.js` (`AbortController`, 20 s, reden `new DOMException('Time-out na 20 s', 'TimeoutError')`). Op elke bewaarde belofte
     meteen een lege `.catch(() => {})` op een aftakking (anders "Uncaught (in promise)" bij een offline start en falen de consolewachters).
  2. `public/js/kern/api.js`: `neemVroeg(sleutel)` geeft de belofte één keer terug (daarna `null`) en markeert een `TypeError` met
     `vanFetch = true` (zoals `merk` in `kern/netwerk.js`). Splits `apiVerzoek` in "haal" en "lees" (bv. `leesApiAntwoord(res)`), zodat
     een vroeg antwoord exact hetzelfde `{ ok, status, data }` / `ApiFout` geeft.
  3. `public/js/kern/sessie.js` `haalAuthIk`: in de EERSTE ronde van `laad()` het vroege antwoord gebruiken, anders `fetch` zoals nu. Alle
     uitkomsten (`ok`, `401`, `storing`, `serverfout`, `netwerk`) blijven gelijk; latere rondes (na het inlogscherm) halen vers op. `ms`
     wordt kleiner, dus de instellingensync krijgt meer budget: bewust, noteer het in het commentaar.
  4. `public/js/kern/instellingen-sync.js`: het vroege overzicht enkel gebruiken als het 2xx was; bij 401/403/503 of een fout negeren en de
     gewone `apiJson`-aanroep doen (de 401/503-afhandeling van `installeerApiBeveiliging` blijft dan exact zoals nu).
  - Het vroege verzoek gaat niet door `installeerApiBeveiliging`; `X-Blitz` is enkel voor schrijven (`kern/api.js:146`), een GET zonder kop
    is identiek. Lees EERST (5 min) `tests/window-namen.test.mjs` en kies de vorm van de globale die die test aanvaardt (bv. een
    definitie in `index.html` die de test meeneemt, of een lezing via `globalThis` op één plek in `kern/api.js`); de test niet verzwakken.
- **Verwachte winst**: meet-laden bij 150 ms: klaar -200 tot -350 ms in alle profielen; bij 0 ms gelijk. Op een gsm met zwakke
  verbinding en HTTP/2: één tot twee rondreizen minder vóór de (bewaarde) tickets verschijnen.
- **Risico**: inlog- en wachtwoordpad, offline start, dubbele verzoeken bij een fout in de consumptie. Oude `index.html` zonder script ->
  `neemVroeg` geeft `null` (gedrag zoals nu).
- **Zichtbaar**: nee.
- **Acceptatie** (baseline in haakjes):
  - `meet-laden --voor=<basis> --runs=5 --vertraging=0,150`: klaar bij 150 ms koud ≤ 4095 ms (4295), warm ≤ 3649 ms (3849),
    warm+SW ≤ 3654 ms (3854); bij 0 ms niet meer dan 5 % boven de basis (678 / 526 / 445); verzoeken gelijk (142 / 142 / 155 en 142).
  - Nieuwe `e2e/productie/vroege-start.spec.mjs` (fixture `productie-hulp.mjs`): precies één `GET /api/auth-ik` en één
    `GET /api/instellingen?overzicht=1` bij de start (tellen, geen Set); `auth-ik` start vóór `DOMContentLoaded` (Resource Timing);
    met auth-ik 401 verschijnt het inlogscherm en na inloggen volgt een vers `auth-ik`; 0 consolefouten.
  - Node-tests: `neemVroeg` (één keer), `haalAuthIk` en `synchroniseerInstellingen` met een vroeg antwoord voor elke uitkomst
    (`tests/api.test.mjs`, `tests/sessie.test.mjs`, `tests/instellingen-sync.test.mjs`).
- **Tests draaien**: `node --test`; `npx playwright test e2e/inloggen.spec.mjs e2e/laden-en-rol.spec.mjs e2e/opstart-terugval.spec.mjs e2e/instellingen-server.spec.mjs e2e/productie/opstart.spec.mjs e2e/productie/vroege-start.spec.mjs e2e/productie/verbinding.spec.mjs`; `npx playwright test --project=sw`.
- **Bestanden**: `public/index.html`, `public/js/kern/api.js`, `public/js/kern/sessie.js`, `public/js/kern/instellingen-sync.js`, tests.
- **Afhankelijkheden**: geen. O4 bouwt erop verder.
- **Kritisch pad**: ja (auth, opstart) -> **opus-review**.

---

### O2 — Lijstkaarten op de gsm zonder vervaging waar dat niets verandert aan het beeld

- **Probleem + bewijs**: 1d. Zonder de vervaging van de kaarten: Wachtrij 123 -> 180 beelden, Ingepland 153 -> 180, Kalender 96 -> 119
  (zelfde sessie). De vervaging van een zacht hemelverloop is vrijwel onzichtbaar.
- **Wijziging** (`public/css/app.css`, één regel na `:176-185`): op `html[data-apparaat="gsm"]`, NIET bij `data-hemel="nacht"` (sterren) en
  NIET tijdens een actief thema (`html:not([data-event])`: elk thema, ook zonder achtergrondbeeld, zet vormen in `#event-achter-laag`
  ACHTER de inhoud, die zonder vervaging scherp door een kaart van 0,40 dekking zouden schijnen), krijgen de lijstkaarten
  `:is(.ticket, .cal-ticket, .cal-local-event, .stop, .inv-row, .sales-kaart, .sales-afgewerkt-rij, .sales-afgewerkt-kaart)`
  `backdrop-filter: saturate(180%)` (met `-webkit-`-variant): de verzadiging en dus de kleur blijven, enkel de vervaging valt weg.
  Glastokens (`--glas`, `--blur`, `VERWACHT_GLAS` in `e2e/contrast-meting.mjs`), dok, kop, sticky balken (`--blur-balk`) en vensters
  blijven ongemoeid. Respecteer de containing-block-regel (niets op `.topbar-sticky`, `header`, `nav`).
- **Verwachte winst**: scrollen op de gsm: Wachtrij +40-50 % beelden, Ingepland +10-15 %, Kalender +20 %. (Headless zonder grafische
  kaart: de verhouding is een aanwijzing, niet de absolute telefoonwaarde; op goedkope Android-toestellen is vervaging per kaart de
  bekende scrollrem.)
- **Risico**: een zichtbaar verschil waar wel detail achter een kaart ligt (daarom nacht en elk thema uitgesloten; op de pc en
  tablet verandert niets, daar liggen o.a. de uurlijnen van de tijdlijn achter de kaarten). Prijs van "pixel-gelijk": tijdens een
  themaweek en 's nachts geen scrollwinst op de gsm.
- **Zichtbaar**: **nee, mits het pixelcriterium hieronder slaagt**. Het raakt wel de glasregel van de stijl Open dag: vermeld het in het
  rapport voor Brent (het past in het afgesproken terugvalpad).
- **Acceptatie**:
  - `meet-snelheid --voor=<basis> --runs=5`: beelden Wachtrij ≥ 160 (119), Ingepland ≥ 172 (165), Kalender ≥ 108 (98); eerste ticket niet
    meer dan 5 % hoger dan de basis (2956); lange taken 0.
  - Nieuwe pixeltest `e2e/kaarten-glas-gsm.spec.mjs`, getagd `@contrast` (echte pixels, zoals `e2e/hemel-contrast.spec.mjs`): gsm, donker en
    licht, hemel ochtend/middag/avond: schermafdruk van een Wachtrijkaart en een Ingeplandkaart met en zonder de nieuwe regel (de
    oude toestand via een ingevoegde stijl); per kanaal hoogstens 3/255 verschil op minstens 99,5 % van de pixels binnen de kaart.
    Plus: bij `nacht`, bij een thema ZONDER achtergrondbeeld en bij een thema met achtergrond bevat de computed `backdrop-filter` van een
    kaart nog `blur(`; op pc en tablet ook.
  - De bestaande contrastproeven slagen: `npx playwright test e2e/versiering.spec.mjs e2e/hemel-contrast.spec.mjs --grep @contrast --workers=1`.
- **Tests draaien**: hierboven, plus `npx playwright test e2e/glas-kaarten.spec.mjs e2e/open-dag-schermen.spec.mjs e2e/ronde-hoeken.spec.mjs e2e/kaarten-glas-gsm.spec.mjs`.
- **Bestanden**: `public/css/app.css`, `e2e/kaarten-glas-gsm.spec.mjs` (nieuw).
- **Afhankelijkheden**: geen.
- **Kritisch pad**: nee (gewone review; wel de contrastproeven).

---

### O3 — Kalender en Ingepland: bij openen niet opnieuw opbouwen als er niets veranderde

- **Probleem + bewijs**: 1c. Herhaald bezoek op de telefoon: Kalender 466 ms, Ingepland 563 ms; de bodem van een tabwissel zonder
  heropbouw is ~152 ms (Wachtrij).
- **Wijziging (stap A, verplicht)**:
  1. `public/js/schermen/kalender.js`: onthoud na elke `renderKalender` of de render ZICHTBAAR gebeurde (`#view-kalender` actief) en een
     sleutel: dag van vandaag (`localISO(new Date())`), `kalView`, `window.apparaat.indeling`, `gekozenDatum`, `activeAssigneeFilter`.
     Export `markeerVerouderd()`. `activeerKalender()` hertekent enkel als de vorige render onzichtbaar was, als er `markeerVerouderd()`
     kwam of als de sleutel verschilt; `kalAutoScroll(true)` blijft altijd lopen.
  2. `public/js/schermen/ingepland.js`: hetzelfde patroon, export `activeerGepland()`.
  3. `public/js/app.js`: in `koppelRenders` één extra abonnement op ALLE sleutels (`SLEUTELS` uit `kern/toestand.js`) dat beide
     `markeerVerouderd()` aanroept: de kalender is niet op `planning`, `klantBeschikbaarheid`, `voorstelStatus` of `settings` geabonneerd,
     maar toont ze wel (nu verbergt de heropbouw bij elk bezoek dat). Ook op `versiering-gewijzigd` beide markeren. In `setTab`
     `ingepland.activeerGepland()` in plaats van `renderGepland()`.
  - Directe `renderKalender()`-aanroepen (15 plaatsen, o.a. `rapport-archief.js`, `voorstel.js`, `instellingen`) blijven tekenen; een
    render terwijl het tabblad verborgen is telt vanzelf als "verouderd" (punt 1), dus de hoogtes zijn altijd van een zichtbare render.
- **Stap B (optioneel, aparte commit, enkel na meting van stap A)**: Ingepland niet tekenen zolang het verborgen is (in `koppelRenders`:
  zichtbaar -> `renderGepland`, anders `markeerVerouderd`). `#cnt-gepland` (gefilterd, `ingepland.js:111`) dan apart en altijd bijwerken
  (anders toont het bolletje het ongefilterde aantal uit `app.js:552`). `e2e/kern.spec.mjs:173` bewust aanpassen met commentaar. Enkel
  houden als "week: terug naar de volle week" op de telefoon ≤ 285 ms (335) en de gerichte e2e groen is; anders terugdraaien.
- **Verwachte winst**: telefoon herhaald bezoek Kalender ~466 -> 200-300 ms, Ingepland ~563 -> 200-350 ms. Eerste bezoek blijft (de start
  tekent verborgen).
- **Risico**: een scherm dat verouderd blijft omdat een invoer niet als "verouderd" telt (daarom het abonnement op alle sleutels en de dag
  in de sleutel).
- **Zichtbaar**: nee.
- **Acceptatie**:
  - `meet-interactie --voor=<basis> --runs=5`: telefoon "tab kalender: herhaald bezoek" ≤ 350 ms (466; streefdoel 325, de afgedwongen
    lay-outs van `kalLijstScroll` en `dok-meer.js:105` blijven), "tab gepland: herhaald bezoek" ≤ 420 ms (563; streefdoel 395); desktop niet hoger dan 43 / 53 ms + 10 %; geen ander cijfer meer dan 10 % hoger; 0 consolefouten.
  - Nieuwe `e2e/tab-hertekenen.spec.mjs` (`?test`): Kalender -> Wachtrij -> Kalender zonder wijziging: `kern.kalender.renderTelling()` +0;
    `kern.toestand.raak('planning')` (en apart `'klantBeschikbaarheid'`) terwijl Wachtrij open is -> bij terugkeer +1; nieuwe dag
    (`page.clock`) -> +1; weergave gsm <-> computer -> +1; idem voor Ingepland (`kern.ingepland.renderTelling()`); na een week- of
    filterwissel klopt de inhoud.
- **Tests draaien**: `node --test`; `npx playwright test e2e/kern.spec.mjs e2e/kalender.spec.mjs e2e/kalender-gsm-vandaag.spec.mjs e2e/kalender-indelingen.spec.mjs e2e/gedeelde-week.spec.mjs e2e/instellingen-toestel.spec.mjs e2e/tab-bolletjes.spec.mjs e2e/paginakop.spec.mjs e2e/weekend.spec.mjs e2e/app-schil.spec.mjs e2e/tab-hertekenen.spec.mjs`.
- **Bestanden**: `public/js/app.js` (koppelRenders, setTab), `public/js/schermen/kalender.js`, `public/js/schermen/ingepland.js`,
  `e2e/tab-hertekenen.spec.mjs`; stap B ook `e2e/kern.spec.mjs`.
- **Afhankelijkheden**: geen; deelt `app.js` met O4 (O4 erna).
- **Kritisch pad**: nee.

---

### O4 — Tickets al ophalen bij de start, en een identiek poll-antwoord niet opnieuw tekenen

- **Probleem + bewijs**: 1b (tickets is de laatste schakel van de staart) en 1c (elke poll en terugkeer bouwt alles opnieuw op).
- **Wijziging**:
  1. Vroeg ophalen: breid het inline script van O1 uit met `fetch('/api/tickets')`, enkel als niet `?test`, er een bewaarde sessie is
     (`localStorage.blitz_sessie_cache`, geldige JSON met `id`) en die rol niet `sales` is (sales roept `/api/tickets` nooit aan). Bewaar
     `id` en tijdstip. In `loadTickets` (`app.js:587`) neemt enkel de EERSTE lading het vroege antwoord, en alleen als het hooguit 60 s oud
     is, het `id` gelijk is aan `huidigeGebruiker().id` en de status niet 401/403/503 is; anders `fetch` zoals nu. Een 5xx (Zoho) wordt
     wel gebruikt (zelfde foutmelding, geen tweede Zoho-aanroep).
  2. Identiek antwoord overslaan: lees als tekst (`res.text()` -> `JSON.parse`, foutafhandeling ongewijzigd). Nieuwe optie `magOverslaan`,
     ENKEL door de poll (`app.js:822`) en `verversNaTerugkeer` (`app.js:889`). Overslaan als: niet `TEST_MODE`, niet de eerste lading, tekst
     gelijk aan die van de laatste toepassing, `_lokaleWijziging` ongewijzigd sinds die toepassing, zelfde dag. Bij overslaan wel
     `_laatsteToegepast`, `_lastTicketLoad`, `laadPlanningSinds()`, de lege-tekst en de melding zoals nu. "Vernieuwen", resyncs en de eerste
     lading tekenen altijd. De beslissing als pure functie in `kern/opslag.js` (bv. `magToepassingOverslaan({...})`), getest met `node --test`.
- **Verwachte winst**: meet-laden koud (geen bewaarde tickets): tickets lopen parallel met de modules, dus de hele staart van 1b valt weg;
  warm met bewaarde kopie: "klaar" ongewijzigd, verse gegevens vroeger. Poll: bij ongewijzigde gegevens geen hertekening meer (geen schok of
  scrollsprong elke 5 minuten op een tablet die de hele dag openstaat).
- **Risico**: dubbele `/api/tickets` (dubbele Zoho-last); te ruime overslaanregel. Zoho-last per start blijft één aanroep.
- **Zichtbaar**: nee.
- **Acceptatie**:
  - `meet-laden --voor=<basis> --vertraging=0,150 --runs=5` (O1 + O4 samen): koud bij 150 ms ≤ 3900 ms (4295); warm en warm+SW minstens zo
    goed als na O1; bij 0 ms ≤ 712 / 552 / 467 ms (+5 %); verzoeken gelijk (142 / 142 / 155).
  - Uitbreiding `e2e/productie/vroege-start.spec.mjs`: precies één `GET /api/tickets` bij de start; met een bewaarde sales-sessie of zonder
    bewaarde sessie geen vroeg verzoek; met `page.clock` 5,5 min verder en een identieke stub: tweede `GET /api/tickets`, maar
    `kern.wachtrij/kalender/ingepland/route.renderTelling()` +0; gewijzigde stub: +1; "Vernieuwen" met identieke stub: +1; na middernacht
    met identieke stub: +1.
  - Node-test voor `magToepassingOverslaan` (elke voorwaarde).
- **Tests draaien**: `node --test`; `npx playwright test e2e/kern.spec.mjs e2e/planning-sync.spec.mjs e2e/productie/opstart.spec.mjs e2e/productie/planning-sync.spec.mjs e2e/productie/planning.spec.mjs e2e/productie/verbinding.spec.mjs e2e/productie/vroege-start.spec.mjs e2e/sales-schil.spec.mjs e2e/werkruimte.spec.mjs e2e/opstart-terugval.spec.mjs`; `npx playwright test --project=sw`.
- **Bestanden**: `public/index.html`, `public/js/app.js`, `public/js/kern/opslag.js`, tests.
- **Afhankelijkheden**: na O1 (script, `neemVroeg`), O3 (`app.js`) en O7 (`kern/opslag.js`).
- **Kritisch pad**: ja (gegevensstroom, Zoho-last) -> **opus-review**.

---

### O5 — `/api/tickets` op de server: agents parallel, detailverzoeken in een glijdend venster van 5

- **Probleem + bewijs**: 1e. Lock-step batches laten 4 verbindingen wachten op het traagste verzoek van elke batch; geen eigen time-out.
- **Wijziging** (`netlify/functions/tickets.js`, `netlify.toml`):
  1. `/agents?limit=50` en de eerste pagina tegelijk starten (in die volgorde, zodat de aanroepvolgorde in de tests gelijk blijft); de
     foutsemantiek blijft (een falende agents-JSON laat de assignee leeg, een netwerkfout geeft 500).
  2. Detailverzoeken met een glijdend venster: nooit meer dan 5 tegelijk (de bewuste rate-limit-grens), maar zodra er één klaar is start het
     volgende. Uitvoer in `relevantIds`-volgorde. Na de eerste fout geen nieuwe verzoeken meer en 500 met dezelfde boodschap als nu.
  3. `[functions.tickets] timeout = 26` (zoals de andere zware functies).
  - Geen hogere gelijktijdigheid, geen andere velden of statussen, geen cache.
- **Verwachte winst**: niet meetbaar in de harnassen. Schatting: detailfase 20-35 % korter (bij 50 tickets en 200-600 ms per Zoho-verzoek
  ~1-2 s), plus één Zoho-rondreis voor `/agents`. Na de release controleren in de Netlify-logs (duur van `tickets`). Stabiliteit: geen
  afbreking op de standaardlimiet zolang de functie onder 26 s blijft.
- **Risico**: Zoho rate limiting (ongewijzigd: max. 5 tegelijk, zelfde aantal verzoeken); verschoven volgorde of foutsemantiek.
- **Zichtbaar**: nee.
- **Acceptatie** (`tests/server-tickets.test.mjs`):
  - Alle bestaande tickets-tests slagen ONGEWIJZIGD ("volledige aanroepenreeks", "batches van vijf" met `max === 5`, "ticketdetail-fout").
  - Nieuw: agents en pagina 0 zijn beide verstuurd vóór een van beide antwoordt.
  - Nieuw (deterministisch, zonder tijdmeting): 12 relevante tickets; het eerste detailverzoek hangt tot een testsignaal; de verzoeken voor
    ticket 6 tot 11 worden verstuurd TERWIJL het eerste nog hangt (lock-step zou dat niet doen); nooit meer dan 5 tegelijk; uitvoer in
    `relevantIds`-volgorde.
  - Nieuw: na de eerste detailfout worden geen nieuwe detailverzoeken gestart.
  - `netlify.toml` bevat `[functions.tickets]` met `timeout = 26` (node-test die het bestand leest).
- **Tests draaien**: `node --test`.
- **Bestanden**: `netlify/functions/tickets.js`, `netlify.toml`, `tests/server-tickets.test.mjs`.
- **Afhankelijkheden**: geen.
- **Kritisch pad**: ja (Zoho) -> **opus-review**.

---

### O6 — Rapportarchief: robuust laden en niet dubbel hertekenen

- **Probleem + bewijs**: 1e (`rapport-archief.js:30-51`); telefoon herhaald bezoek Rapporten 158 ms (desktop 24 ms).
- **Wijziging** (`public/js/rapport-archief.js`, `laadRapportArchief`):
  1. `res.ok` controleren en `Array.isArray(data.rapports)` eisen, anders is het een fout. Ook een fout: een antwoord met een `versie`
     LAGER dan de gekende `_archiefVersie` (de server geeft bij een Blobs-fout 200 met de lege lijst `{ versie: 0, rapports: [] }`,
     `netlify/functions/rapport-archief.js:89-94`; zonder deze regel wist juist die storing de lijst en de versie). De versie stijgt enkel
     (`netlify/lib/rapportlijst.js:112`, jaararchief `:75`); controleer dat bij het bouwen en log zo'n antwoord met `console.warn`. De
     serverterugval zelf (200 i.p.v. 503) blijft voor een volgende ronde: hij is vastgelegd in de bestaande servertests.
     Bij een fout `_rapportArchief` en `_archiefVersie`
     NIET aanraken; stond er al een lijst, dan blijft die staan met `toast('✕ Rapporten vernieuwen mislukt: ' + foutTekst(err))`; stond er
     nog niets, dan de huidige foutregel. `meldRenderFout` enkel voor echte renderfouten.
  2. Antwoord als tekst lezen; is het gelijk aan de laatste geslaagde lading en staat de lijst al getekend, dan `renderRapportArchief()` en
     `renderKalender()` overslaan. De eerste lading tekent altijd; `toonMisluktMeldingen` zoals nu.
- **Verwachte winst**: telefoon "tab rapporten: herhaald bezoek" lager; een storing of offline-moment wist archief en versie niet meer.
- **Risico**: enkel byte-gelijke antwoorden worden overgeslagen; foutgedrag verandert zichtbaar.
- **Zichtbaar**: **ja**, klein: bij een fout blijft de lijst staan met een melding in plaats van een foutregel.
- **Acceptatie**:
  - `meet-interactie --voor=<basis> --profiel=telefoon --runs=5`: "tab rapporten: herhaald bezoek" ≤ 126 ms (158); desktop niet boven
    24 ms + 10 %; 0 consolefouten.
  - Nieuwe `e2e/rapporten-laden.spec.mjs` (`?test`): tweede keer Rapporten met identieke stub -> `kern.kalender.renderTelling()` +0, zelfde
    rijen; stub 500 en 503 `{ error, code }` en een 200 met `{ versie: 0, rapports: [] }` na een lading met versie > 0 -> rijen blijven,
    melding zichtbaar, `kern.rapportArchief.versie()` ongewijzigd; afgebroken
    verzoek -> idem; eerste lading faalt -> foutregel zoals nu.
- **Tests draaien**: `node --test`; `npx playwright test e2e/rapporten-null-records.spec.mjs e2e/rapport-verzenden.spec.mjs e2e/rapporten-laden.spec.mjs e2e/productie/rapport.spec.mjs e2e/kalender.spec.mjs`.
- **Bestanden**: `public/js/rapport-archief.js`, `e2e/rapporten-laden.spec.mjs`.
- **Afhankelijkheden**: geen.
- **Kritisch pad**: raakt de versie van het rapportverzenden -> **opus-review** (licht).

---

### O7 — Geocache één keer inlezen in plaats van bij elke opzoeking

- **Probleem + bewijs**: 1c (`kern/opslag.js:35-44`, `app.js:544`).
- **Wijziging**: in `kern/opslag.js` de geparste cache in het geheugen houden; `geocacheStore` werkt geheugen en opslag samen bij; een
  `storage`-gebeurtenis voor `blitz_geocache` (andere tab) laat het geheugen vallen (luisteraar enkel als `globalThis.addEventListener`
  bestaat, zodat de module puur blijft). TTL (90 dagen) en maximum (500) ongewijzigd; een opslagfout blijft "geen treffer".
- **Verwachte winst**: met een volle geocache van N tot 0-1 keer `JSON.parse` per lading. Niet zichtbaar in de harnassen (lege geocache);
  aantoonbaar met een node-test.
- **Risico**: laag.
- **Zichtbaar**: nee.
- **Acceptatie**: `tests/opslag.test.mjs`: nep-`localStorage` die `getItem` telt, cache van 500 adressen: 100 opzoekingen -> hoogstens 1
  `getItem`; na `geocacheStore` de nieuwe waarde; na een `storage`-gebeurtenis opnieuw gelezen; TTL en maximum zoals nu. Daarnaast mag
  `meet-snelheid` "eerste ticket" niet boven 2956 ms + 5 % uitkomen.
- **Tests draaien**: `node --test`; `npx playwright test e2e/route.spec.mjs e2e/route-tijden.spec.mjs e2e/plan-week.spec.mjs`.
- **Bestanden**: `public/js/kern/opslag.js`, `tests/opslag.test.mjs`.
- **Afhankelijkheden**: geen (vóór O4).
- **Kritisch pad**: nee.

---

### O8 — De routekaart pas maken als Route voor het eerst opengaat

- **Probleem + bewijs**: 1b. Elke start vraagt een kaarttegel aan `server.arcgisonline.com` en maakt een Leaflet-kaart, ook op de gsm
  waar Route niet bestaat (`app.js:324`, `route-kaart.js:315-324`). Op een zwakke verbinding: een extra DNS/TLS en ~20 kB tijdens de start.
- **Wijziging** (enkel `public/js/schermen/route-kaart.js`): `initMap()` controleert nog meteen of `L` bestaat (zodat de foutafhandeling in
  `app.js:324-334` blijft werken) en bewaart de instellingen, maar maakt de kaart pas in een interne `zorgVoorKaart()` zodra `#map`
  zichtbaar is (eerste aanroep van `updateKaart`, `wisKaart`, `zoomOpGekendeStops`, `invalideerKaartGrootte` of `vernieuw...` terwijl de
  container breedte heeft). Tekenopdrachten zonder kaart worden bewaard (de laatste) en na het maken afgespeeld. `applyKaartStijl` en de
  andere functies beschermen zich al tegen `!leafletMap`. De salesskaart (`sales-kaart.js`) en Leaflet zelf blijven ongewijzigd.
- **Verwachte winst**: één verzoek minder per start (142 -> 141) en geen kaartopbouw bij de start (gsm: nooit meer).
- **Risico**: een Route-tab die bij het eerste openen geen markers of route toont (vandaar het afspelen); de kaarttellers die de e2e lezen.
- **Zichtbaar**: nee.
- **Acceptatie**:
  - `meet-laden --voor=<basis> --vertraging=0 --runs=5`: verzoeken koud 141 (142), klaar niet hoger dan 678 ms + 5 %.
  - Nieuwe e2e in `e2e/route-kaart.spec.mjs` of apart: geen verzoek naar `server.arcgisonline.com` en geen `.leaflet-container` vóór Route
    geopend is; na openen zijn markers, route en kaartstijl er zoals nu (`kern.route`-tellers); de gsm-start doet geen tegelverzoek.
- **Tests draaien**: `node --test`; `npx playwright test e2e/route-kaart.spec.mjs e2e/route.spec.mjs e2e/route-indeling.spec.mjs e2e/route-gsm.spec.mjs e2e/route-tijden.spec.mjs e2e/route-weekstrook.spec.mjs e2e/kaartstijl-eigen.spec.mjs e2e/route-slepen-render.spec.mjs e2e/sales-route-kaart.spec.mjs`; `npx playwright test e2e/sw/offline.spec.mjs --project=sw`.
- **Bestanden**: `public/js/schermen/route-kaart.js`, e2e.
- **Afhankelijkheden**: geen (golf 3 enkel voor de spreiding).
- **Kritisch pad**: nee.

---

## 3. Niet nu (met reden)

1. **Service worker: schil uit de cache (cache-first / stale-while-revalidate) in plaats van netwerk-eerst.** De grootste winst voor een
   warme start op een zwakke verbinding (warm+SW 3854 ms is nu even traag als warm 3849 ms bij 150 ms), maar het verandert het besluit van
   Brent (netwerk-eerst, `NAV_TIMEOUT_MS` 4 s, 2026-10-02) en het updategedrag (een fix komt een start later aan). **Vraag voor Brent.**
2. **Vervaging van de kaarten ook 's nachts, tijdens een thema, op pc/tablet, of van de sticky balken (`--blur-balk`) aanpassen.**
   Daar is het verschil zichtbaar; Brent besliste over glas en leesbaarheid. O2 doet enkel het pixel-gelijke deel. **Vraag voor Brent** als
   een echte telefoon na O2 nog traag scrolt.
3. **Verborgen tabbladen hun lay-out laten houden (`content-visibility: hidden` in plaats van `display: none` op `.view`).** Mogelijk de
   bodem van elke tabwissel (152 ms) fors lager, maar het raakt hoogtemetingen (`kalender.js`), sticky offsets, scrollherstel en de
   zichtbaarheidslogica van ~1400 e2e-tests. Eerst een proef in een volgende ronde.
4. **Eerste Kalenderbezoek (914 ms).** Eén eenmalige volledige lay-out (818 ms voor ~1000 objecten; later 13-189 ms); het verplaatsen van
   de afgedwongen lay-out (`dok-meer.js:105`) hielp niet (gemeten). Eerst op een echt toestel kijken of het daar ook bestaat.
5. **Rapportwizard lazy laden.** 9 ms parse (baseline); 7 importeurs, ~30 `window`-namen en een `pagehide`-luisteraar.
6. **Leaflet en signature_pad lazy laden.** `signature_pad` blijft nodig zonder wachten (`rapport-wizard.js:1053`); de koude start is zeldzaam.
   O8 neemt het nuttige deel (geen kaart en tegel bij de start).
7. **Bundelen of minder modules/stijlbladen.** De graaf is al plat; enkel het aantal verzoeken telt, en dat vraagt een buildstap (projectkeuze).
8. **Alle verborgen tabbladen niet meer tekenen (`koppelRenders` algemeen).** Breekt `e2e/kern.spec.mjs` en een onbekend aantal specs die de
   DOM van een verborgen tabblad lezen; O3 stap B is de smalle variant.
9. **Zoho-lijst met `fields=`/`include=` (geen detailverzoek per ticket) of een cache per ticket op `modifiedTime`.** Vraagt een live
   controle van de Zoho-antwoorden.
10. **Meer dan 5 Zoho-verzoeken tegelijk of pagina's en details door elkaar.** Rate-limits onbekend; karakteriseringstests zouden schuiven.
11. **Een verdwenen ticket (404 tussen lijst en detail) overslaan.** Robuuster, maar verandert de uitkomst: **vraag voor Brent**.
12. **Rapportarchief kleiner maken (zware velden uit de lijst, `?versie=`).** Eerst de echte blob meten met `scripts/meet-rapportlijst.mjs`.
13. **Opstartverzoeken herordenen, lettertypen zelf hosten.** Op localhost niet meetbaar / enkel koude start.
14. **Scrollsprong-verklikker verwijderen, auth-cache, `themapakket-validatie.js` lazy.** Geen meetbare winst / auth-pad / veiligheidspoort.
15. **Geheugen.** Geen groei van betekenis (0,3-0,5 MB per sessie), geen lek gevonden.

---

## 4. Risico's voor de release

- **SHELL-regel**: geen taak voegt een bestand onder `public/js/` toe. Gebeurt het toch: `SHELL` in `public/sw.js` en (statische import)
  de modulepreload-lijst, in dezelfde commit (`tests/sw-schil.test.mjs` bewaakt beide richtingen).
- **`index.html` en `css/app.css` veranderen**: bij de release `CACHE_NAME` ophogen (verplicht). Mengvormen blijven veilig: oude
  `index.html` zonder script -> `neemVroeg` geeft `null`; nieuwe `index.html` met oude modules (enkel via de cachemodus van de SW, die mengen
  verhindert) -> vroege verzoeken één keer ongebruikt, zonder consolefout.
- **`tests/sw-schil.test.mjs`** pint de kop (preloads na de stijlbladen, enkel nodige preconnects): het inline script verandert daar niets aan.
- **Productietests en sw-project** draaien zonder `?test`: daar lopen de vroege verzoeken echt; `opstart.spec.mjs` vergelijkt een Set, de
  nieuwe spec telt exact.
- **Zoho-last** blijft per start één `/api/tickets` met hetzelfde aantal detailverzoeken (max. 5 tegelijk); na de release de duur van
  `tickets` in de Netlify-logs vergelijken.
- **Glas (O2)**: draai bij de release de `@contrast`-proeven apart (CLAUDE.md) en bekijk op een echte gsm overdag en 's nachts de Wachtrij.
- **Live-controle na de release** (toevoegen aan de release-checklist): op een echte gsm met zwakke verbinding de start, het scrollen en het
  openen van Kalender/Ingepland; in DevTools nagaan dat `auth-ik`, `instellingen` en `tickets` elk één keer gevraagd worden en dat er bij de
  start geen kaarttegel komt.

## 5. Eindmeting (opzichter)

`meet-laden --vertraging=0,150`, `meet-snelheid` (telefoon) en `meet-interactie` (beide profielen), elk `--voor=<basis> --runs=5`, naar
`docs/optimalisatie/meting-na-*.json`. Een cijfer dat 10 % of meer slechter is dan de basis: terugdraaien of verklaren.

Wat welk harnas kan zien (anders leest de eindmeting als een misser):
- O1 en O4 lopen bewust NIET in `?test`; `meet-snelheid` en `meet-interactie` draaien in `?test` en bewegen daar dus niet: enkel `meet-laden`
  (productiemodus) toont hun winst. O4's polldeel is enkel met de e2e-test aantoonbaar (de sessie bevat geen poll).
- O5 (server) en O7 (geocache leeg in de harnassen) zijn enkel met `node --test` aantoonbaar; O5 achteraf in de Netlify-logs.
- O2 toont zich in `meet-snelheid` (beelden); O3 en O6 in `meet-interactie` (telefoon); O8 in `meet-laden` (verzoeken).
- Headless Chromium heeft geen grafische kaart: de scrollverhouding is een aanwijzing, geen telefoonwaarde.
