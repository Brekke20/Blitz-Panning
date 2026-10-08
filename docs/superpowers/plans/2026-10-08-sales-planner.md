# Sales-planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elke verkoper krijgt een eigen planner: leads uit een JSON-export samenvoegen, een postcode of adres per lead bijhouden, door het bestaande planner-brein laten inplannen ("voorgesteld"), een vast uur kunnen vastleggen, bevestigen en een resultaat ingeven, zonder Zoho, stock of mails.

**Architecture:** Pure domeinlogica staat in `public/js/sales/` en wordt door client én server gebruikt (de server importeert ze relatief, zodat herkenning/validatie maar één bron heeft). Een dunne adapter zet leads om naar kandidaten van `planWeek` (`public/js/planner.js`, ongewijzigd). De sales-schermen zijn **aparte, kleinere schermen** die enkel de pure kalender-/route-helpers en CSS-klassen van de technieker-schermen hergebruiken (motivering onder "Keuze gegevensbron-laag"). Server: dunne functies in `netlify/functions/` (ingehangen met `beveiligV2`, rij in `netlify/lib/rechten.js`) met alle logica in `netlify/lib/sales-*.js`; één blob `sales/<gebruikerId>` per verkoper (leads, blokken en grafstenen), elke lees-wijzig-schrijf-actie via `wijzigBlob` achter een serieel per blob.

**Tech Stack:** vanilla ES-modules zonder bouwstap, `node --test` (Node 24), `@playwright/test` 1.63, Netlify Functions v2 + Blobs (`blitz-data`, `consistency: 'strong'`), TomTom (server-side), Leaflet (global `L`, al geladen).

**Spec:** `docs/superpowers/specs/2026-10-08-sales-planner-design.md`. Bindend koppelvlak: `docs/superpowers/plans/2026-10-08-koppelvlakken.md`, sectie "Aanvullingen" gaat voor de oudere tekst. Dit plan is op 2026-10-08 (preflight-scan, ledger) getoetst aan de echte logins-code in `refactor-logins` (`netlify/lib/{auth,beveiligd,rechten,activiteit,gebruikers,instellingen,serieel,blob-wijzig,auth-antwoord,lokale-dev}.js`) en aan het logins-plan (sectie "Koppelvlak: uitbreidingen en bevindingen"); de client-modules `kern/sessie.js`, `kern/navigatie.js` en `schermen/rol-schil.js` bestaan nog niet en worden met de namen uit dat plan gebruikt (Task 12 stap 5 controleert ze tegen de gemergde code). Verder gelezen: `2026-10-08-logins-beheer-design.md`, `2026-09-30-planner-brein-design.md`, `CLAUDE.md` (branchbeleid).

## Beslissingen van de klant na de spec (Brent, 2026-10-08) — gaan voor de spec

- **(a) Weggeklikte lead die terugkomt:** een met ✕ verwijderde lead die in een latere export weer voorkomt, komt terug **mét label "eerder verwijderd"**; de verkoper beslist (behouden of opnieuw ✕). Daarvoor bewaart de server bij elke verwijdering een **grafsteen** `{ h: string[], op: ISO }` in het verkoperblob: enkel SHA-256-hashes van de genormaliseerde herkenningssleutels (e-mail, gsm, of naam+voornaam+postcode) — **nooit een naam, e-mail of gsm in leesbare vorm** — 12 maanden bewaard, dan door de dagelijkse opruiming gewist. Grafstenen verlaten de server nooit (geen enkel antwoord bevat ze). De spec-regel "verwijderen = echt weg" blijft gelden voor alle persoonsgegevens; enkel de hash blijft als geheugen.
- **(b) Vast uur voor elke lead:** de verkoper kan voor élke lead (ook nog niet ingepland) dag + uur vastleggen; het brein plant eromheen en verschuift het nooit (Task 3 `zetVastUur`, Task 4 adapter, Task 14 detail, Task 16 "Uur wijzigen", Task 17 e2e).
- **(c) Afgewerkte leads 12 maanden bewaard** (Task 5), daarna gewist.

## Global Constraints

- **Takken (CLAUDE.md, koppelvlakken):** uitvoering in worktree `.claude/worktrees/refactor-sales`, tak `refactor-sales` vanaf `refactor` (bevat al de upload-fix v1.10.2/v1.10.3); de taken zonder login-afhankelijkheid starten vóór de merge van logins, de rest erna (Task 0). Nooit mergen of pushen naar `main`; nooit `--no-verify`; de pre-push-hook blokkeert refactor → main. Geen versie-ophoging, geen `CACHE_NAME`-wijziging, geen `package.json`-wijziging. Wijzigingen komen in `CHANGELOG.md` onder "Refactor-tak — nog niet uitgebracht" (laatste taak). Niet mergen.
- **Structuur (bindend, opdrachtgever):** in `public/index.html` en `public/js/app.js` komt **niets** bij behalve één minimale registratie-regel: `app.js` blijft zelfs helemaal onaangeroerd (koppelvlak E1: het registratiepunt per deelproject is `schermen/rol-schil.js`, +2 regels) en `index.html` krijgt 1 `modulepreload`-regel. Nieuwe logica in kleine, gerichte modules: `public/js/sales/` (pure logica: import, herkenning, regels, adapter), `public/js/schermen/sales-*.js` (scherm) met `sales-*-logica.js` apart (zoals `kalender.js`/`kalender-logica.js`), server in `netlify/lib/sales-*.js` met dunne functies in `netlify/functions/`. Eén verantwoordelijkheid per bestand. **`public/js/app.js` blijft onaangeroerd** (koppelvlak E1: het registratiepunt per deelproject is `schermen/rol-schil.js`).
- **Toegelaten wijzigingen aan bestaande bestanden (volledige lijst):** `public/js/schermen/rol-schil.js` (+2 regels: import en aanroep van `registreerSalesRol`; de placeholder-start voor sales van logins wordt vervangen), `public/index.html` (+1 `modulepreload` voor `schermen/sales-registratie.js`), `public/js/schermen/kalender.js` (+`export` op 3 functies), `public/js/schermen/route-kaart.js` (+`export` op `KAART_LAGEN`), `public/sw.js` (`SHELL`), `netlify/lib/rechten.js` (4 rijen), `netlify/lib/testmodus.js` (+`/^sales\//` in `NIET_KOPIEREN`), `netlify.toml` (2 timeouts), `CHANGELOG.md`, `docs/bugs-en-open-punten.md`.
- **Technieker-gedrag ongewijzigd:** `kalender.js` en `route-kaart.js` mogen enkel het sleutelwoord `export` erbij krijgen (Task 13); `git diff -w` van die twee bestanden toont niets anders. Alle bestaande unit- en e2e-suites blijven ongewijzigd groen.
- **Koppelvlakken zijn bindend:** niet stil afwijken; een fout of gat wordt gemeld in de ledger/terugmelding (zie "Koppelvlak: vastgesteld tegen de logins-code").
- **Server (bindend, uit logins):** elke functie `export default maakHandler({ getStore })` met `beveiligV2('<naam>', kern)` (kern = `async (req, context, gebruiker)`, optioneel `{ auth }` als testseam) en een rij in `netlify/lib/rechten.js`; X-Blitz-controle doet de wrapper (elke niet-GET-methode); OPTIONS beantwoordt de kern zelf (204). `@netlify/blobs` 8.2 kent geen voorwaardelijke schrijfacties: **elke lees-wijzig-schrijf-actie** (sales-blob, postcode-cache) loopt via `wijzigBlob` (`netlify/lib/blob-wijzig.js`) binnen een serieel per blob (`maakSerieel`, `netlify/lib/serieel.js`) en **faalt gesloten**: `ok:false` of een Blobs-fout geeft `503 OPSLAG_STORING` (`netlify/lib/auth-antwoord.js`: `{ error, code:'opslag-storing' }`), nooit stil doorgaan. Enige bewuste uitzondering: de postcode-cache (afleidbaar, geen gebruikersdata) logt een mislukte schrijfactie en geeft het opgezochte resultaat toch terug. Op de client betekent 503 `opslag-storing` "straks opnieuw proberen", **niet** uitloggen. Authenticatiegegevens en `activiteit/*` staan altijd in de ECHTE store (`authStore(getStore)`), ook bij een testverzoek; het sales-blob volgt de testmodus (`winkelNaam(req)`).
- Spec-waarden: max. **500 leads** per bestand; bestand max. **2 MB**; afgewerkte bezoeken en grafstenen **12 maanden** bewaard, dan dagelijks automatisch gewist (ook uit `bezoeken`); ongedaan maken na verwijderen **5 s**; standaard bezoekduur `instellingen.bezoekDuurMin ?? 60`; `priority` voor elke lead `'medium'`; `inPlanningSinds` = `lead.geimporteerdOp`; een gsm met **minder dan 9 cijfers** (zoals `+32000000`) telt niet voor herkenning; herkenning = e-mail (lowercase, getrimd), anders gsm (enkel cijfers, `32` genormaliseerd).
- **Manueel vast uur (Brent):** de verkoper legt bij elke lead dag + uur vast, ook als die nog niet ingepland was; het brein plant daarrond en verschuift zo'n lead **nooit** (ook niet buiten werkuren of op een volle dag). Dit geldt end-to-end: domeinregel (Task 3), adapter (Task 4), detail en kalender (Task 14, 16), e2e (Task 17).
- **Testmodus (`?test`, `X-Blitz-Test: 1`):** nooit echte TomTom-, Zoho- of mailaanroepen. Server: `winkelNaam(req)`, `isTestVerzoek(req)` en `zorgVoorTestkopie(getStore)` uit `netlify/lib/testmodus.js` (het blob `sales/<id>` komt NIET in de testkopie, zie Task 11); de testrol (`X-Blitz-Test-Rol: sales` -> `TESTGEBRUIKERS['test-sales']`, id `test-sales`, salesNaam `Test Verkoper`, `magAlleSales:false`) werkt enkel in lokale dev (`BLITZ_LOKALE_DEV=1`); geocoding geeft in testmodus deterministische nepcoördinaten zonder `fetch`. Client: `TEST_MODE` uit `kern/omgeving.js`; geen `/api/matrix`, `/api/route` of `/api/optimize` in testmodus.
- **Privacy/XSS:** leads zijn persoonsgegevens: elke weergave via `escHtml` (`kern/ui.js`) of `textContent`; het activiteitenlog bevat nooit namen, gsm of e-mail (enkel lead-id en aantallen); grafstenen bevatten enkel hashes en worden nooit naar de client gestuurd (`naarClient()` in Task 7); testfixtures bevatten uitsluitend verzonnen gegevens (bv. "Marie Janssens", "Tom Peeters", verantwoordelijke "Test Verkoper").
- Geen nieuwe npm-dependencies. Nederlandse namen en commentaar. Elk nieuw laadbaar bestand onder `public/js/` of `public/css/` komt in dezelfde commit in `SHELL` van `public/sw.js`.
- Tests: testhulpen uit logins: `tests/nep-blobs.mjs` (`maakNepStore`), `tests/auth-hulp.mjs` (`metRol(rol, werk, { magAlleSales })`, `metGeenSessie`), `tests/nep-fetch.mjs`; handlers worden met `maakHandler({ getStore, nu, auth? })` gebouwd. `node --test` (stijl `tests/planner.test.mjs`: `import test from 'node:test'`, `assert/strict`, `process.env.TZ = 'Europe/Brussels'` waar datums meespelen); e2e `npx playwright test` (project `chromium`, stijl `e2e/plan-week.spec.mjs`, vaste klok `VASTE_NU` = maandag 2026-10-05 09:00), geen `waitForTimeout`. Lokale verificatie: `http://localhost:3333/?test`.
- Shellcommando's altijd als `cd "<worktree>" && …`; vóór elke commit `git branch --show-current` == `refactor-sales`; `.claude/launch.json` nooit stagen; commit-trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Na elke taak: skill `opruimen-na-werk` (achtergebleven processen stoppen).

## Review Focus

De spec zwijgt over deze invoer; elke regel heeft een test in de genoemde taak.

1. **Lead zonder e-mail én zonder bruikbare gsm** (placeholder `+32000000`): zou bij elke herimport opnieuw als "nieuw" binnenkomen. Verwacht: één fallback-sleutel `naam+voornaam+postcode`; twee verschillende mensen met dezelfde placeholder-gsm worden nooit samengevoegd (Task 2).
2. **Hostile of kapotte exportbestanden:** HTML/script in naam of adres, >500 leads, >2 MB, geen JSON, `leads` geen array, lege lijst, leads die geen object zijn, extreem lange velden. Verwacht: duidelijke Nederlandse fout of overslaan, nooit een crash of ongeëscapete weergave (Task 1, 14).
3. **Postcode niet te vinden of TomTom valt uit:** `locatie` blijft `null`, het brein geeft reden `adres-niet-gevonden`, import en detail blijven werken en er wordt niets gecachet als "niet gevonden" (Task 4, 6b, 11).
4. **Verwijderen tijdens het 5 s-venster en twee toestellen:** pagina sluiten of tweede toestel met oudere versie. Verwacht: een uitgestelde verwijdering gaat bij `pagehide` alsnog weg, een 409 herprobeert eenmaal op de verse stand en verliest geen wijziging (Task 10, 11).
5. **Vast uur dat botst of buiten de uren valt** (07:00, 18:30, feestdag, over een blok heen, twee vaste uren over elkaar): het brein verschuift het nooit; de detailpagina waarschuwt bij botsing en laat bevestigen; "Plan deze week" opnieuw geeft dezelfde vaste uren terug, ook voor een lead die vóór het vastleggen nog niet ingepland was (Task 3, 4, 8, 14, 16, 17).
6. **Weggeklikte lead keert terug** (besluit a): zelfde e-mail/gsm in een latere export geeft een nieuwe lead mét label "eerder verwijderd" (ook als alleen de gsm of alleen de e-mail nog overeenkomt); de grafsteen bevat geen leesbare persoonsgegevens, komt in geen enkel antwoord voor en verdwijnt na 12 maanden of zodra de lead behouden wordt (Task 2, 5, 7, 11, 12, 14).
7. **Gelijktijdige schrijfacties en opslagstoring:** twee gelijktijdige PATCH/DELETE/import-aanroepen op hetzelfde blob verliezen elkaars wijziging niet (serieel + `wijzigBlob`); een Blobs-fout of `ok:false` geeft 503 `opslag-storing` zonder gedeeltelijke schrijfactie en de client blijft ingelogd (Task 7, 10, 11, 12).

## Keuze gegevensbron-laag (tickets ↔ sales)

**Onderzoek (code van 2026-10-08):**
- `schermen/kalender.js` leest rechtstreeks `toestand.get('planning' | 'localEvents' | 'avExceptions' | 'allPending' | 'settings' | 'activeAssigneeFilter')`, bouwt kaartjes uit `stop.ticket.*` (`buildTicketCard`, regel 73), hangt aan 16 afhankelijkheden uit `initKalender(afh)` die allemaal ticket/Zoho-gedrag zijn (`bevestigUitplannen`, `openDetail`, `herOpenRapport`, `tijdslotLabelVoor`, …) en aan vaste DOM-id's uit `index.html:173-199` (`#week-grid`, `#kal-label`, `#btn-autoplan`, …).
- `schermen/route.js` en `route-kaart.js` zijn **singletons**: module-private `routeData`/`currentRouteDate`, één Leaflet-kaart op `#map`, lijst op `#route-list`, datum op `#plan-date`, vergrendeling via voorstelstatus/Zoho, en `applyRouteOrder` schrijft naar Zoho. De beheerder krijgt zowel ticket- als sales-schermen in één pagina: hergebruik van dezelfde DOM-id's zou botsen.
- Wél ticketvrij en direct bruikbaar: `schermen/kalender-logica.js` (`timelineTopHeight`, `bepaalLanes`, `zichtbareDagen`, `maandRaster`, `isBuitenWerkuren`, constanten), `kern/tijd.js`, `kern/ui.js`, `kern/api.js`, `kern/feestdagen.js`, `planner.js`/`planner-tijdlijn.js`, en de CSS-klassen `.day-col`, `.tl-wrap`, `.tl-block`, `.tl-hour-line`, `.tl-gutter`.

**Keuze: aparte, kleinere sales-schermen** (`sales-kalender.js`, `sales-route.js`, `sales-kaart.js`) die deze helpers en klassen hergebruiken. Een gegevensbron-laag *binnen* kalender/route zou ~25 plekken in twee bestanden van 800–900 regels moeten raken en elk daarvan kan het technieker-gedrag breken; de aparte schermen raken die bestanden niet. Minimale wijziging aan bestaande bestanden: `export` voor `computeTimelineRange`, `appendOffhoursBands`, `renderTimelineGutter` in `kalender.js` en `KAART_LAGEN` in `route-kaart.js` (zelfde uur-as en kaartlagen, geen gedragswijziging).

**De laag zelf (exacte interface), `schermen/sales-data.js` is de énige bron van de sales-schermen; `kern/toestand.js` en tickets komen er nooit in:**

```js
salesToestand() -> { gebruikerId: string|null, versie: number, leads: Lead[], blokken: Blok[], instellingen: Instellingen /* nooit null: { ...SALES_STANDAARD, ...bewaarde } */, gekozenDatum: 'YYYY-MM-DD', uitgesteld: Set<string> /* lead-id's in het 5 s-venster */ }
onSalesWijziging(fn: () => void) -> afmelden: () => void
// KalenderItem (sales-kalender-logica.js): zelfde vorm als bouwTijdlijnItems-uitvoer, zodat bepaalLanes ongewijzigd werkt
{ type: 'bezoek'|'blok', id, startMin, endMin, tint?: 'voorgesteld'|'bevestigd', lead?, blok?, lane?, laneCount? }
// RouteStop (sales-route-logica.js)
{ nr: number, leadId, start: 'HH:MM', duurMin, naam, plaats, locatie: {lat, lon, bron}|null, ongeveer: boolean /* bron === 'postcode' */ }
```

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `public/js/sales/adres.js` | adres ontleden, `adresSoort`, geocodeertekst |
| `public/js/sales/import.js` | export lezen/valideren, gsm/e-mail normaliseren |
| `public/js/sales/herkenning.js` | herkenningssleutels, samenvoegen |
| `public/js/sales/lead-regels.js` | statusovergangen, resultaat, validatie, `pasLeadToe` |
| `public/js/sales/blok-regels.js` | blok valideren, hele dag |
| `public/js/sales/toegang.js` | wie mag welke verkoper lezen/schrijven (client + server) |
| `public/js/sales/planner-adapter.js` | leads/blokken → invoer van `planWeek`, uitkomst → wijzigingen, reistijden-adapter |
| `netlify/lib/sales-geocode.js` | TomTom-geocoding (adres, postcode), testmodus-nepcoördinaten |
| `netlify/lib/sales-postcode.js`, `sales-locatie.js` | postcodecache (`wijzigBlob`) + locatie bepalen |
| `netlify/lib/sales-opslag.js`, `sales-wijzig.js` | blob `sales/<id>` lezen/muteren (`muteerSales`: serieel + `wijzigBlob` + versiecontrole), `naarClient`; patch toepassen |
| `netlify/lib/sales-grafsteen.js`, `sales-locaties-bewaren.js` | grafstenen (hash) maken/opzoeken; locaties buiten het slot bepalen en gericht bewaren |
| `netlify/lib/sales-toegang.js`, `sales-acties.js`, `sales-import-server.js`, `sales-opruimen.js` | server-logica per actie |
| `netlify/functions/sales.js`, `sales-import.js`, `postcode.js`, `sales-opruimen.js` | dunne functies |
| `public/js/schermen/sales-data.js` | client-gegevenslaag (zie boven) |
| `public/js/schermen/sales-schil.js`, `sales-venster.js`, `sales-verkoper.js`, `sales-registratie.js`, `sales-start.js` | view ophalen, modaal venster, verkoperkeuze, tabregistratie (statisch via `rol-schil.js`, geen eigen statische imports), start voor rol sales (lazy) |
| `public/js/schermen/sales-lijst(-logica).js`, `sales-detail(-logica).js`, `sales-resultaat.js` | Te plannen, detail, resultaat, Afgewerkt |
| `public/js/schermen/sales-kalender(-logica).js`, `sales-blok.js`, `sales-bezoek.js` | kalender, blokken, bezoekacties |
| `public/js/schermen/sales-plan(-logica).js` | "Plan deze week" (schil rond de adapter) |
| `public/js/schermen/sales-route(-logica).js`, `sales-kaart.js` | route en kaart |
| `public/css/sales.css` | stijlen (`sales-`-prefix, tinten) |
| `tests/sales-*.test.mjs`, `tests/server-sales*.test.mjs`, `tests/nep-blobs.mjs` (uit logins, Task 0 stap 5), `e2e/sales-*.spec.mjs`, `e2e/sales-hulp.mjs`, `e2e/fixtures/sales-export.json` | tests |

## API-contract (nieuw)

- Alle antwoorden: nooit `grafstenen`; bij een opslagstoring `503 { error, code:'opslag-storing' }`; weigeringen (401/403) door de wrapper `{ error, code }`.
- `GET /api/sales[?gebruiker=<id>]` → `200 { gebruikerId, versie, leads, blokken }`.
- `PATCH /api/sales[?gebruiker=<id>]` body `{ versie, leads?: [{ id, velden }], blokken?: { toevoegen?: [Blok zonder id], wijzig?: [{ id, velden }], verwijder?: [id] }, aanvullen?: true }` → `200 { gebruikerId, versie, leads, blokken, open }` | `400 { error, fouten }` | `409 { error: 'Versiematch mislukt', serverVersie, data }` (zoals `afspraken.js`). `open` = aantal leads met postcode maar nog zonder `locatie`.
- `DELETE /api/sales?lead=<id>[&gebruiker=<id>]` → `200 { versie }` | `404`. Maakt een grafsteen van de lead (enkel hashes) en verwijdert de lead.
- `POST /api/sales-import` body `{ export: <object> }` (enkel eigen blob) → `200 { versie, samenvatting: { nieuw, alAanwezig, adresNakijken, eerderVerwijderd /* deel van nieuw */, overgeslagen }, export: { verantwoordelijke, geexporteerdOp, aantal, statussen }, open }` | `400 { error }`.
- `GET /api/postcode?pc=3640` → `200 { pc, lat, lon, gemeente }` | `400` | `404`.
- Rechten (rijen in `netlify/lib/rechten.js`): `'sales': { GET, PATCH, DELETE: BEHEER_SALES }`, `'sales-import': { POST: ['sales'] }`, `'postcode': { GET: BEHEER_SALES }`, `'sales-opruimen': { '*': 'open' }` (geplande functie, idempotent, zoals `activiteit-opruimen`). Wie welke verkoper mag lezen/schrijven staat in `toegang.js` en wordt in de functie afgedwongen. Activiteitenlog (acties uit het koppelvlak): `'sales-import'`, `'sales-lead-verwijderd'`, `'sales-resultaat'`; de opruiming logt als `{ id:'systeem', naam:'Systeem' }`.

## Koppelvlak: vastgesteld tegen de logins-code (preflight 2026-10-08)

Wat dit plan eerst moest aannemen, is nu vastgesteld in `refactor-logins` (server) of in het logins-plan (client); Task 12 stap 5 controleert de client-delen opnieuw tegen de gemergde code.

1. `registreerTabs(rol, tabs)` **voegt toe** (zelfde id vervangt); `registreerStart(rol, fn)`/`startVoorRol(rol)` per rol; `laadTab(id)` roept `laad()` van de tab van de huidige rol aan, bij **elke** tabwissel. De knop `#tab-<id>` en de view `#view-<id>` (`.view`, `role="tabpanel"`) maakt `pasRolToe` in `rol-schil.js`; `setTab` (app.js) activeert ze. Voor rol `sales` draait `opstart()` niet (de tab-klik, thema en testbadge worden dan niet gekoppeld): `sales-start.js` doet dat (Task 13).
2. `GET /api/instellingen` → `{ versie, instellingen: Instellingen | null }`; `GET /api/auth-ik` → `{ gebruiker, rechten: { beheer, plannen, alleSales }, moetWachtwoordWijzigen, lokaleDev }`; `GET /api/gebruikers?rol=sales` → `{ gebruikers: PubliekeGebruiker[] }` (enkel actieve verkopers, voor beheerder en sales met `magAlleSales`). `PubliekeGebruiker` = `{ id, email, naam, rol, zohoNaam?, salesNaam?, magAlleSales? }`.
3. Systeemacties in het activiteitenlog: `{ id:'systeem', naam:'Systeem' }`; verzoeken loggen via `logVoorVerzoek(req, gebruiker, { actie, onderwerp, details }, { getStore, nu })` (slaat testverzoeken over, schrijft naar de echte store); losse acties via `logActiviteit(store, { gebruiker, actie, onderwerp, details }, { nu })`.
4. In lokale dev + testverzoek bepaalt `X-Blitz-Test-Rol` de gebruiker (`TESTGEBRUIKERS['test-sales']`, id `test-sales`); die staat niet in het blob `gebruikers`. `bepaalDoel` aanvaardt `test-sales` daarom zonder opzoeking, **enkel** als `isTestVerzoek(req)`.
5. E2E: `startApp(page, { loginRol, … })` (logins Task 13 stap 4) bepaalt de rol van de `auth-ik`-stub; de rolwisselaar bewaart `blitz_test_rol`. `salesStubs` zet een eigen `auth-ik`-stub met `salesNaam` en `magAlleSales` via `overschrijf`.
6. De server importeert pure modules uit `public/js/` al elders (`netlify/lib/instellingen.js` → `public/js/kern/instellingen-regels.js`): precedent bestaat en werkt lokaal en onder `node --test`. Het bundelen door Netlify (esbuild volgt relatieve imports) wordt bij de eerste deploy-preview bevestigd; terugval: de betrokken modules kopiëren naar `netlify/lib/` met een pariteitstest (zoals `tests/instellingen-regels-parity.test.mjs`).
7. **Sales-instellingen:** een verkoper heeft geen eigen instellingenscherm (dat hoort bij `opstart()`); startlocatie, werkuren en `bezoekDuurMin` stelt de beheerder in (Beheer > Instellingen, logins Task 17). Zonder bewaarde instellingen gelden de standaardwaarden uit Task 10 en is er geen depot (Task 17 meldt dat).

---

## Task 0: Worktree, vroege kopie en preflight

**Files:** `netlify/lib/blob-wijzig.js`, `netlify/lib/serieel.js`, `tests/nep-blobs.mjs` (byte-identieke kopie uit `refactor-logins`, stap 5).

- [ ] **Step 1 (gedaan 2026-10-08):** de worktree bestaat: `.claude/worktrees/refactor-sales`, tak `refactor-sales` vanaf `refactor` (bevat de upload-fix v1.10.2 + v1.10.3, merge-commit `c803a73`). Is logins al op `refactor` gemerged, dan bevat de tak die code (stap 5 vervalt); zo niet, dan starten de taken zonder login-afhankelijkheid (Task 1–5, 6, 6b, 7–10; zie de markeringen) en wordt vóór Task 11 `git merge refactor` uitgevoerd.
- [ ] **Step 2:** `npm ci` (geen nieuwe dependencies), `git branch --show-current` == `refactor-sales`.
- [ ] **Step 3:** Baseline vastleggen in de ledger (`.superpowers/sdd/2026-10-08-sales-planner/progress.md`, niet in git): `node --test` en `npx playwright test --project=chromium` (aantal groen).
- [ ] **Step 4 (preflight, vóór Task 11):** controleer dat bestaan op `refactor` (gemergde logins): `netlify/lib/beveiligd.js` (`beveiligV2`), `rechten.js` (`RECHTEN`, `BEHEER_SALES`), `auth.js` (`maakAuth`, `zetAuthVoorTests`), `auth-antwoord.js` (`authStore`, `OPSLAG_STORING`), `activiteit.js` (`logActiviteit`, `logVoorVerzoek`), `gebruikers.js` (`leesGebruikers`), `blob-wijzig.js`, `serieel.js`, `lokale-dev.js`, `tests/auth-hulp.mjs`, `tests/nep-blobs.mjs`, en client `kern/sessie.js` (`huidigeGebruiker`, `heeftRol`, `huidigeRechten`), `kern/navigatie.js` (`registreerTabs`, `registreerStart`, `laadTab`), `schermen/rol-schil.js`, `schermen/beheer-tabs.js`. Ontbreekt er één of wijkt een signatuur af: stop en meld het.
- [ ] **Step 5 (vroege kopie, enkel als logins nog niet gemerged is; ruling R1 van de opzichter):** `git checkout refactor-logins -- netlify/lib/blob-wijzig.js netlify/lib/serieel.js tests/nep-blobs.mjs`, controleer `git diff refactor-logins -- <die drie bestanden>` is leeg, commit `chore(sales): blob-wijzig, serieel en nep-blobs vooraf overgenomen uit logins (byte-identiek)`. Bij de latere merge van logins: ontstaat er een conflict op een van deze bestanden, neem dan de versie van logins. Geen enkele andere logins-code wordt gekopieerd. Wordt R1 afgewezen, dan wachten Task 6b en Task 7 op de logins-merge.

---

## Task 1: Adres ontleden en export lezen **[los van logins]**

**Files:**
- Create: `public/js/sales/adres.js`, `public/js/sales/import.js`
- Test: `tests/sales-adres.test.mjs`, `tests/sales-import.test.mjs`

**Interfaces:**
- Produces:
```js
// adres.js
export function ontleedAdres(tekst) // -> { soort:'postcode', postcode, gemeente? } | { soort:'adres', straat, huisnr, postcode, gemeente } | { soort:'nakijken', adresTekst }
export function adresSoort(lead)    // -> 'postcode'|'volledig'|'nakijken'
export function adresTekstVoorGeocoding(lead) // -> 'Straat 12, 3640 Gemeente' | null (zonder straat+huisnr+postcode)
export function plaatsLabel(lead)   // -> 'Kinrooi (3640)' | '3640' | ''
// import.js
export const MAX_LEADS = 500, MAX_BYTES = 2 * 1024 * 1024;
export function normaliseerEmail(x) // -> lowercase getrimd | null (geen '@')
export function normaliseerGsm(x)   // -> '32478123456' | null (minder dan 9 cijfers)
export function zelfdeNaam(a, b)    // hoofdletter- en spatie-ongevoelig
export function leesExport(invoer)  // string | object -> { ok:true, verantwoordelijke, geexporteerdOp, statussen:string[], aantal:number|null, overgeslagen:number, leads: ImportLead[] } | { ok:false, fout:string }
// ImportLead = { voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, adresTekst }  (ontbrekend = null; e-mail lowercase; gsm zoals aangeleverd, getrimd)
```
`adresSoort`: `'volledig'` als `lead.straat` en `lead.locatie?.bron === 'adres'`; `'nakijken'` als `lead.adresTekst`, of `lead.straat` zonder adres-locatie, of geen `lead.postcode`; anders `'postcode'`. De importsamenvatting (Task 2) telt "adres nakijken" op parseniveau (soort `'nakijken'`); een volledig adres waarvan de geocoding later mislukt (bron `'postcode'`) toont daarna wel het label "adres nakijken" maar zit niet in die telling.

- [ ] **Step 1: Write the failing tests** (verzonnen data):
  - `ontleedAdres('3640')` en `' 3640 '` → `{ soort:'postcode', postcode:'3640' }`; `'3500 Hasselt'` → postcode + gemeente `'Hasselt'`.
  - `'Dorpsstraat 12, 3640 Kinrooi'` → `{ soort:'adres', straat:'Dorpsstraat', huisnr:'12', postcode:'3640', gemeente:'Kinrooi' }`; `'Kerkstraat 5 bus 2, 3500 Hasselt'` → `huisnr:'5 bus 2'`; `'Rue de Namur 5A, 5000 Namur'` → `huisnr:'5A'`.
  - `'bij de molen'`, `''`, `null`, `'12345'`, `'123'` → `{ soort:'nakijken', adresTekst:… }` (leeg/`null` → `''`).
  - `adresSoort` voor de drie soorten plus "straat zonder adres-locatie" → `'nakijken'`; `adresTekstVoorGeocoding` → `'Dorpsstraat 12, 3640 Kinrooi'`, `null` bij postcode-only.
  - `normaliseerGsm`: `'+32 478 12 34 56'`, `'0478/12.34.56'`, `'0032478123456'` → `'32478123456'`; `'+32000000'`, `''`, `null` → `null`. `normaliseerEmail(' Marie@Voorbeeld.BE ')` → `'marie@voorbeeld.be'`, `'geen-mail'` → `null`.
  - `leesExport` met het voorbeeldformaat `{ geexporteerdOp, verantwoordelijke:'Test Verkoper', statussen:[…], aantal:3, leads:[…] }` (3 leads: postcode-only; volledig adres; placeholder-gsm `+32000000` en e-mail met hoofdletters) → `ok:true`, 3 leads. Als JSON-string werkt ook. Fouten (exacte teksten): geen JSON → `'Het bestand is geen geldige JSON'`; `leads` geen array → `'Geen geldige export: "leads" ontbreekt'`; 501 leads → `'Maximaal 500 leads per bestand'`; string > 2 MB → `'Het bestand is groter dan 2 MB'`. Een lead die geen object is, of zonder naam, voornaam, e-mail én gsm → telt in `overgeslagen`. Velden worden op 200 tekens afgekapt; `'<img src=x onerror=alert(1)>'` als naam blijft letterlijke tekst (geen interpretatie). Lege `leads: []` → `ok:true`, 0 leads.
- [ ] **Step 2: Run** `node --test tests/sales-adres.test.mjs tests/sales-import.test.mjs` → FAIL (module ontbreekt).
- [ ] **Step 3: Implement** de signaturen hierboven. Ontleden: eerst `^\d{4}$`, dan `^(\d{4})\s+(.+)$`, dan `^(.+?)\s+(\d+\s*[A-Za-z]?(?:\s*(?:bus|/)\s*\w+)?)\s*,\s*(\d{4})\s+(.+)$`, anders nakijken. Bytes via `new TextEncoder().encode(tekst).length`.
- [ ] **Step 4: Run** dezelfde tests → PASS.
- [ ] **Step 5: Commit** `feat(sales): adres ontleden en export lezen`.

---

## Task 2: Herkenning, samenvoegen en grafstenen **[los van logins]**

**Files:**
- Create: `public/js/sales/herkenning.js`
- Test: `tests/sales-herkenning.test.mjs`

**Interfaces:**
- Consumes: `normaliseerEmail`, `normaliseerGsm` (Task 1), `adresSoort` (Task 1).
- Produces:
```js
export function herkenningssleutels(lead) // -> string[]: 'e:<email>', 'g:<32…>' ; enkel als beide ontbreken: 'n:<voornaam>|<naam>|<postcode>' (lowercase)
export function voegSamen(bestaande /*Lead[]*/, nieuwe /*ImportLead[]*/, { nu /*ISO*/, nieuwId /*() => string*/, bronExport /*{ verantwoordelijke, geexporteerdOp }*/, grafstenen = [] /*[{ h: string[], op }]*/, hash = null /*(sleutel) => string; zonder hash worden grafstenen genegeerd*/ })
  // -> { leads: Lead[], toegevoegd: Lead[], samenvatting: { nieuw, alAanwezig, adresNakijken, eerderVerwijderd /* deel van nieuw */ }, grafstenen /* de ingevoerde, zonder de verbruikte */ }   (muteert de invoer niet)
```
Nieuwe `Lead`: `{ id, voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, adresTekst, locatie: null, status: 'te-plannen', bezoeken: [], geimporteerdOp: nu, bronExport }` (spec-datamodel; `notitie`/`duurMin`/`planning`/`resultaat` ontbreken tot ze ingevuld worden). Een nieuwe lead waarvan minstens één `hash(sleutel)` in een grafsteen staat, krijgt bovendien `eerderVerwijderd: { op: <grafsteen.op> }` (besluit a); die grafsteen wordt verbruikt (staat niet in de uitvoer-`grafstenen`, de lead is er nu zelf). Is er géén overeenkomst, dan blijft de grafsteen staan.
Bestaande lead blijft ongewijzigd, behalve: lege contactvelden (`voornaam`, `naam`, `gsm`, `email`) worden aangevuld; heeft de bestaande lead enkel een postcode en brengt de import een volledig adres, dan wordt het adres bijgewerkt (`straat`, `huisnr`, `gemeente`, `locatie: null` zodat de server opnieuw geocodeert). Planning, status, notitie, duur, resultaat, bezoeken en een eventueel `eerderVerwijderd`-label blijven altijd. Een grafsteen wordt enkel geraadpleegd voor leads die anders **nieuw** zouden zijn.

- [ ] **Step 1: Write the failing tests:**
  - zelfde e-mail met andere hoofdletters/spaties → "al aanwezig"; zelfde gsm in andere schrijfwijze (`+32 478 12 34 56` vs `0478123456`) → al aanwezig; twee leads met placeholder-gsm `+32000000` en verschillende naam/e-mail → **twee** nieuwe (Review Focus 1); twee leads zonder e-mail en zonder bruikbare gsm met gelijke naam+voornaam+postcode → tweede is al aanwezig, andere postcode → nieuw; dubbele lead binnen hetzelfde bestand → één nieuw.
  - samenvoegen behoudt `planning`, `status:'bevestigd'`, `notitie`, `duurMin`, `resultaat`, `bezoeken` van de bestaande lead; vult lege `gsm` aan; postcode-only → volledig adres upgrade zet `locatie:null`; een bestaand volledig adres wordt nooit door een postcode overschreven.
  - lead die niet meer in de export staat blijft staan; invoer-arrays (ook `grafstenen`) onveranderd (diepe gelijkheid vóór/na).
  - samenvatting `{ nieuw:2, alAanwezig:1, adresNakijken:1, eerderVerwijderd:0 }` telt "nakijken" enkel onder de nieuwe; `bronExport` en `geimporteerdOp` staan op nieuwe leads.
  - **Grafstenen (besluit a):** met `hash = s => 'H' + s` en een grafsteen `{ h:['He:marie@voorbeeld.be'], op:'2026-09-01T10:00:00.000Z' }` komt een lead met dat e-mailadres (andere hoofdletters) als nieuw binnen met `eerderVerwijderd:{ op }`, `samenvatting.eerderVerwijderd:1`, en de grafsteen staat niet meer in de uitvoer; een lead die enkel nog op gsm overeenkomt krijgt het label ook; een grafsteen met meerdere hashes (e-mail + gsm) wordt door één treffer verbruikt; een lead zonder overeenkomst blijft zonder label en de grafsteen blijft; een lead die al in `bestaande` staat wordt "al aanwezig" (geen label, grafsteen blijft); zonder `hash` of zonder grafstenen verandert er niets; een grafsteen-hash van een lead zonder e-mail/gsm gebruikt de `n:`-sleutel; het label bevat nooit meer dan `{ op }` (geen sleutel of persoonsgegevens).
- [ ] **Step 2: Run** `node --test tests/sales-herkenning.test.mjs` → FAIL.
- [ ] **Step 3: Implement** met een `Map<sleutel, lead>` over de bestaande leads (O(n)); sleutels van een nieuwe lead worden na toevoegen in de map gezet (dubbels in het bestand); grafstenen in een `Map<hash, index>`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): herkenning, samenvoegen en grafstenen van leads`.

---

## Task 3: Domeinregels: lead, blok, toegang **[los van logins]**

**Files:**
- Create: `public/js/sales/lead-regels.js`, `public/js/sales/blok-regels.js`, `public/js/sales/toegang.js`
- Test: `tests/sales-lead-regels.test.mjs`, `tests/sales-blok-regels.test.mjs`, `tests/sales-toegang.test.mjs`

**Interfaces:**
- Consumes: `adresSoort` (Task 1).
- Produces:
```js
// lead-regels.js
export const STATUSSEN = ['te-plannen','voorgesteld','bevestigd','afgewerkt'];
export const RESULTAAT_LABEL = { offerte:'Offerte', verkocht:'Verkocht', 'geen-interesse':'Geen interesse', opnieuw:'Opnieuw langsgaan' };
export const WIJZIGBARE_VELDEN = ['notitie','duurMin','straat','huisnr','postcode','gemeente','adresTekst','status','planning','resultaat','bezoeken','eerderVerwijderd'];
export function isVast(lead)                       // planning?.vast === true || status === 'bevestigd'
export function zetVastUur(lead, { datum, start }) // -> Lead: planning {datum,start,vast:true}, status 'bevestigd'; vanuit élke status behalve 'afgewerkt' (gooit), dus ook voor een nog niet ingeplande lead (besluit b) en om een bevestigd uur te wijzigen
export function bevestig(lead)                     // voorgesteld -> bevestigd, planning.vast = true
export function terugNaarTePlannen(lead)           // planning verwijderd, status 'te-plannen'
export function geefResultaat(lead, { soort, notitie, nu })
  // soort 'opnieuw': bezoeken + { datum, resultaat:'opnieuw', notitie?, op }, status 'te-plannen', planning weg
  // 'offerte'|'verkocht'|'geen-interesse': idem + resultaat { soort, notitie?, op }, status 'afgewerkt', planning weg; bezoek.datum = planning.datum ?? dag van nu
export function valideerLead(lead)                 // -> string[] (invarianten: voorgesteld/bevestigd => planning {datum 'YYYY-MM-DD', start 'HH:MM'}; voorgesteld => vast false; bevestigd => vast true; te-plannen => geen planning; afgewerkt => resultaat, geen planning; postcode /^\d{4}$/; duurMin ≥ 15 of afwezig; eerderVerwijderd afwezig of { op })
export function pasLeadToe(lead, velden)           // -> { lead, adresGewijzigd: boolean, fouten: string[] }  (onbekend veld, bv. 'locatie' of 'email', => fout 'Veld niet toegelaten: x'; adresvelden gewijzigd => locatie: null; `eerderVerwijderd` mag enkel op `null` gezet worden ("Label wissen"), anders fout)
// blok-regels.js
export const BLOK_SOORTEN = ['verlof','kantoor','afspraak'];
export function isHeleDag(blok)                    // start '00:00' en eind '23:59' of '24:00'
export function valideerBlok(blok)                 // -> { fout } | { blok }  (datum, 'HH:MM', start < eind, soort, omschrijving ≤ 200 tekens)
// toegang.js
export function magLezen(gebruiker, doelId)        // sales: eigen, of ander bij magAlleSales; beheerder: iedereen
export function magSchrijven(gebruiker, doelId)    // sales: enkel eigen; beheerder: iedereen
export function kanVerkoperKiezen(gebruiker)       // beheerder of sales met magAlleSales (zelfde regel als `huidigeRechten().alleSales`; de server gebruikt deze functie, de UI mag `huidigeRechten()` gebruiken)
```
Toelaatbare statusovergangen in `pasLeadToe` (bron → doel; dezelfde status is altijd toegelaten, bv. een bevestigd uur opnieuw vastleggen): `te-plannen → voorgesteld|bevestigd|afgewerkt`, `voorgesteld → te-plannen|bevestigd|afgewerkt`, `bevestigd → te-plannen|afgewerkt`, `afgewerkt → te-plannen` (verkeerde klik herstellen); anders fout.

- [ ] **Step 1: Write the failing tests:** per functie het genoemde gedrag; `geefResultaat('opnieuw')` behoudt eerdere `bezoeken` en voegt er één toe, `resultaat` van een eerdere afronding wordt gewist; ongeldig `soort` gooit; `zetVastUur` met datum `'2026-13-40'` of uur `'25:00'` geeft een fout via `valideerLead`; `zetVastUur` op een `te-plannen`-lead (zonder planning), op een `voorgesteld`- en op een al `bevestigd` bezoek (nieuw uur) geeft telkens `bevestigd` + `vast:true`, op een `afgewerkt`-lead gooit het; `pasLeadToe({ eerderVerwijderd:null })` wist het label, `{ eerderVerwijderd:{ op:'…' } }` en `{ eerderVerwijderd:true }` geven een fout; `pasLeadToe({ locatie:… })`, `{ email:… }`, `{ id:… }` geven een fout en laten de lead ongewijzigd; adresvelden wijzigen zet `locatie:null` en `adresGewijzigd:true`, enkel `notitie` wijzigen niet; `valideerBlok` weigert eind ≤ start, soort `'vakantie'`, datum `'2026-02-30'`; `isHeleDag` voor `'00:00'`–`'23:59'` en `'24:00'`; toegang: sales A → B zonder vinkje: lezen `false`; met `magAlleSales`: lezen `true`, schrijven `false`; beheerder: beide `true`; `kanVerkoperKiezen` voor planner/technieker `false`.
- [ ] **Step 2: Run** de drie bestanden → FAIL.
- [ ] **Step 3: Implement.** Alle functies zuiver (geven nieuwe objecten, muteren niet); datumvalidatie via `new Date(`${d}T00:00:00Z`)` round-trip.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): domeinregels voor lead, blok en toegang`.

---

## Task 4: Planner-adapter **[los van logins]**

**Files:**
- Create: `public/js/sales/planner-adapter.js`
- Test: `tests/sales-planner-adapter.test.mjs`

**Interfaces:**
- Consumes: `planWeek`, `bouwDagen`, `haversine` uit `public/js/planner.js` (ongewijzigd); `isVast` (Task 3), `isHeleDag` (Task 3).
- Produces:
```js
export const STANDAARD_BEZOEKDUUR_MIN = 60;
export function leadNaarKandidaat(lead, { standaardDuurMin = 60 })
  // -> { id: lead.id, number: lead.id, priority: 'medium', interventieDatum: null, inPlanningSinds: lead.geimporteerdOp, lat, lon /* locatie of null */, duurMin: lead.duurMin ?? standaardDuurMin }
export function bouwPlanInvoer({ leads, blokken, instellingen, weekStart, vandaag, depot, reistijden, feestdag })
  // weekStart/vandaag: ISO 'YYYY-MM-DD' (de aanroeper zet `weekStartVan(...)` om met `localISO`); instellingen: { vanTijd, laatsteStart, maxPerDag, maxReistijdMin, werkdagen, bezoekDuurMin? }, ontbrekende of `null`-instellingen/-velden krijgen standaardwaarden (werkdagen [1,2,3,4,5], vanTijd '08:00', laatsteStart '16:00'; `maxPerDag`/`maxReistijdMin` ontbreken = geen limiet) zodat `bouwDagen` nooit crasht; feestdag: (datum) => string|null
  // -> { invoer /* voor planWeek */, vrijgegeven: string[] /* lead-id's */ }
export function verwerkUitkomst({ uitkomst, leads, vrijgegeven })
  // -> { wijzigingen: [{ id, velden }], geplaatst: number, nietGepland: [{ leadId, reden }], waarschuwingen }
export function maakReistijdenAdapter({ apiVerzoek, testModus })
  // -> async (van, naar, vertrekIso) => Map<id, minuten|null>; gooit nooit; testModus: haversine × 1,3 zonder aanroep
```
Regels: kandidaten = leads met `status === 'te-plannen'` die niet `isVast` zijn, plus `voorgesteld`-leads met `planning.datum` binnen `weekStart..weekStart+6` én ≥ `vandaag` (die staan in `vrijgegeven` en mogen herschikt worden). `bestaandPerDag[datum]` = alle leads met `isVast(lead)` en `planning` op een dag in de planningsdagen: `{ id, uur: planning.start, duurMin, lat, lon }`. `dagen` via `bouwDagen({ weekStart, vandaag, werkdagen, uitgesloten, voorkeuren: [] })`; `uitgesloten(d)` = `feestdag(d)` of een blok met `isHeleDag` op `d`. Blokken met `lat` en `lon` → `eigenAfspraken[datum]` (`{ uur: start, duurMin: eind − start, lat, lon }`), de rest → `blokkeringen[datum]` (`{ van: start, tot: eind }`). `klant: {}`. `verwerkUitkomst`: geplaatst → `{ id, velden: { status:'voorgesteld', planning:{ datum, start: verwachteAankomst, vast:false } } }`; een vrijgegeven lead die niet opnieuw geplaatst werd → `{ status:'te-plannen', planning:null }`; een vaste lead komt **nooit** in `wijzigingen` voor.

- [ ] **Step 1: Write the failing tests** (verzonnen coördinaten rond Hasselt/Genk/Antwerpen; `nepReistijden` = haversine × 1,3 zoals `tests/planner.test.mjs`):
  - `leadNaarKandidaat`: `duurMin` = `lead.duurMin` → `standaardDuurMin` → 60; `locatie:null` → `lat:null, lon:null`; `inPlanningSinds` = `geimporteerdOp`.
  - `bouwPlanInvoer` met leads A (te-plannen), B (voorgesteld deze week), C (bevestigd dinsdag 10:00), D (status `voorgesteld` maar `planning.vast:true`: corrupte data die de adapter defensief als vast behandelt), E (afgewerkt), F (voorgesteld volgende week), G (voorgesteld op een dag vóór `vandaag`), H (status `te-plannen`, vast uur gezet via `zetVastUur` op een dag deze week: dus `bevestigd`, nooit kandidaat): kandidaten `[A, B]`, `vrijgegeven == ['B']`, `bestaandPerDag['2026-10-06']` bevat C met `uur:'10:00'`, D en H staan op hun dag, E/F/G nergens. Zonder `instellingen.werkdagen` (of met `instellingen: null`) gebruikt de adapter ma–vr en crasht niet.
  - blokken: hele-dag verlof haalt de dag uit `invoer.dagen`; bereikblok `13:00–14:00` → `blokkeringen`; blok met `lat/lon` → `eigenAfspraken`; feestdag valt weg uit `dagen`.
  - **Integratie met de echte `planWeek`:** vaste lead 10:00–11:00 op dinsdag + 6 kandidaten → de vaste lead komt niet in `geplaatst`, geen geplaatste kandidaat overlapt 10:00–11:00, `verwerkUitkomst(...).wijzigingen` bevat de vaste lead niet. Herhaal met vast uur `07:00` en `18:30` (buiten werkuren/na laatste start): blijft vast en de kandidaten plannen eromheen. Pas de wijzigingen toe en plan opnieuw → de vaste uren zijn identiek.
  - vast uur (besluit b) op een dag die het brein niet plant (feestdag, hele-dag-verlof, weekend, andere week) belemmert niets en staat nergens in `invoer`; vast uur op een planningsdag zonder ander bezoek: de kandidaten plannen op de overige dagen en rond dat uur.
  - lead zonder `locatie` → in `nietGepland` met reden `'adres-niet-gevonden'`; vrijgegeven lead zonder plaats → `{ status:'te-plannen', planning:null }`; waarschuwingen van het brein worden doorgegeven.
  - `maakReistijdenAdapter`: `testModus:true` roept `apiVerzoek` nooit aan en geeft haversine × 1,3; anders `/api/matrix` met `{ origin, destinations, departAt }` en seconden → minuten; `!ok` of een gooiende `apiVerzoek` → alle waarden `null` zonder te gooien.
- [ ] **Step 2: Run** `node --test tests/sales-planner-adapter.test.mjs` → FAIL.
- [ ] **Step 3: Implement** de vier functies; geen DOM, geen globals. De adapter roept `planWeek` zelf niet aan (dat doet Task 17).
- [ ] **Step 4: Run** → PASS; draai ook `node --test tests/planner.test.mjs tests/planner-werkuren.test.mjs` (onaangeroerd groen).
- [ ] **Step 5: Commit** `feat(sales): planner-adapter van leads naar kandidaten`.

---

## Task 5: Opruimregel (12 maanden, leads en grafstenen) **[los van logins]**

**Files:**
- Create: `netlify/lib/sales-opruimen.js` (alleen de pure regel in deze taak; `ruimAllesOp` volgt in Task 12)
- Test: `tests/sales-opruimen.test.mjs`

**Interfaces:**
- Produces:
```js
export const BEWAAR_MAANDEN = 12;
export function laatsteBezoekDatum(lead) // -> 'YYYY-MM-DD' | null: max van bezoeken[].datum en resultaat.op (dag); anders geimporteerdOp (dag)
export function ruimOp(data /*{ leads, blokken, grafstenen? }*/, nu /*ISO*/) // -> { data, gewist: string[] /* lead-id's */, grafstenenGewist: number }
```
Een lead wordt gewist als `status === 'afgewerkt'` én het laatste bezoek **meer dan** 12 kalendermaanden voor `nu` ligt (de lead verdwijnt volledig, dus ook zijn `bezoeken`). Een grafsteen (`{ h, op }`) wordt gewist als `op` meer dan 12 kalendermaanden voor `nu` ligt; een ontbrekende `grafstenen` telt als `[]`.

- [ ] **Step 1: Write the failing tests:** afgewerkt met laatste bezoek 12 maanden en 1 dag geleden → gewist; precies 12 maanden (zelfde dag) → blijft; afgewerkt met recent bezoek maar oud eerste bezoek → blijft; `te-plannen`-lead met enkel oude `bezoeken` (opnieuw langsgaan) → blijft; `resultaat.op` nieuwer dan `bezoeken` telt mee; schrikkeldag `2026-02-28` vs `2025-02-28`; lege data; invoer niet gemuteerd; `blokken` ongewijzigd; grafstenen: `op` 12 maanden en 1 dag geleden → gewist, precies 12 maanden → blijft, `grafstenenGewist` klopt, data zonder `grafstenen` geeft `grafstenen: []` en `grafstenenGewist: 0`.
- [ ] **Step 2: Run** `node --test tests/sales-opruimen.test.mjs` → FAIL.
- [ ] **Step 3: Implement** met `Date.UTC`-berekening (`setUTCMonth(-12)` op `nu`, vergelijken op `'YYYY-MM-DD'`-strings).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): opruimregel voor afgewerkte leads en grafstenen na 12 maanden`.

---

## Task 6: Geocoding via TomTom **[los van logins]**

**Files:**
- Create: `netlify/lib/sales-geocode.js`
- Test: `tests/server-sales-geocode.test.mjs`

**Interfaces:**
- Consumes: `maakNepFetch` (`tests/nep-fetch.mjs`).
- Produces:
```js
// sales-geocode.js
export async function geocodeAdres(adres, { fetch, sleutel, testModus, wacht }) // -> { lat, lon } | null; gooit nooit; 429: 3 pogingen met backoff (`wacht(ms)`)
export async function geocodePostcode(pc, { fetch, sleutel, testModus, wacht }) // -> { lat, lon, gemeente } | null
```
TomTom: adres via `https://api.tomtom.com/search/2/geocode/<encodeURIComponent(adres)>.json?key=<sleutel>&countrySet=BE&limit=1`; postcode via `https://api.tomtom.com/search/2/structuredGeocode.json?key=<sleutel>&countryCode=BE&postalCode=<pc>&limit=1`, gemeente = `results[0].address.municipality`. Testmodus: deterministische nepcoördinaten in de Belgische bounding box uit een hash van de invoer, `fetch` wordt nooit aangeroepen. De sleutel is een parameter (de handlers lezen `process.env.TOMTOM_API_KEY` zelf, zoals `matrix.js`/`drukte.js`).

- [ ] **Step 1: Write the failing tests** (nep-fetch; nooit het netwerk):
  - `geocodeAdres`: URL bevat de geëncodeerde tekst, `countrySet=BE` en de sleutel → `{ lat, lon }`; geen resultaten → `null`; netwerkfout → `null`; 429 daarna 200 → resultaat na 2 pogingen; `testModus` → deterministisch (tweemaal hetzelfde) en `fetch` 0×; een ontbrekende sleutel (buiten testmodus) → `null` zonder `fetch`.
  - `geocodePostcode`: URL bevat `postalCode=3640` en `countryCode=BE`, gemeente uit het antwoord; geen resultaat → `null`.
- [ ] **Step 2: Run** `node --test tests/server-sales-geocode.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** Backoff zoals `optimize.js` (`attempt * 400`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): TomTom-geocoding voor adres en postcode`.

---

## Task 6b: Postcodecache en locatie **[los van logins, mits Task 0 stap 5]**

**Files:**
- Create: `netlify/lib/sales-postcode.js`, `netlify/lib/sales-locatie.js`
- Test: `tests/server-sales-postcode.test.mjs`, `tests/server-sales-locatie.test.mjs`

**Interfaces:**
- Consumes: `geocodeAdres`, `geocodePostcode` (Task 6), `adresTekstVoorGeocoding` (Task 1), `wijzigBlob` (`netlify/lib/blob-wijzig.js`), `maakSerieel` (`netlify/lib/serieel.js`), `maakNepStore` (`tests/nep-blobs.mjs`), `maakNepFetch`.
- Produces:
```js
// sales-postcode.js
export const isPostcode = pc => /^\d{4}$/.test(pc);
export async function zoekPostcode(store, pc, deps) // -> { lat, lon, gemeente } | null; leest blob 'postcode-cache' ({ [pc]: { lat, lon, gemeente } }); 'niet gevonden' wordt NIET gecachet
export async function zoekPostcodes(store, lijst, { nu, maxTijdMs = 15000, parallel = 5, ...deps }) // -> { gevonden: { [pc]: {…} }, open: string[] }; één schrijfactie per aanroep
// sales-locatie.js
export async function bepaalLocatie(lead, { store, ...deps }) // -> { lat, lon, bron:'adres'|'postcode' } | null  (volledig adres -> geocodeAdres; mislukt of postcode-only -> zoekPostcode; niets -> null)
export async function vulLocatiesAan(leads, { store, nu, maxTijdMs, ...deps }) // -> { leads, open: number }  (leads met postcode zonder locatie; vult ook lead.gemeente aan als die leeg is; muteert de invoer niet)
```
Schrijven naar de cache: één `wijzigBlob(store, 'postcode-cache', { leeg: {}, wijzig: cache => (nieuwe ingangen ? { ...cache, ...nieuw } : null) })` binnen een module-eigen `maakSerieel()`-keten (de cache wordt dus altijd op de verse stand samengevoegd, nooit vervangen). `ok:false` of een fout bij het schrijven is hier **best-effort**: `console.error` met enkel het fouttype, het opgezochte resultaat wordt toch teruggegeven (de cache is afleidbaar en bevat geen gebruikersdata; de enige bewuste uitzondering op "fail closed").

- [ ] **Step 1: Write the failing tests** (`maakNepStore`, nep-fetch; nooit het netwerk):
  - `zoekPostcode`: cache-hit → 0 fetches; miss → 1 fetch + blob `postcode-cache` bevat de postcode; `'36'`/`'abcd'` → `null` zonder fetch; niet gevonden → `null` en **niet** in de cache (Review Focus 3).
  - `zoekPostcodes`: 12 unieke postcodes met `parallel:5` → nooit meer dan 5 gelijktijdig; `maxTijdMs` bereikt (klok via `nu`) → de rest in `open`; één schrijfactie (`store._schrijfacties`); twee gelijktijdige aanroepen met verschillende postcodes → de cache bevat daarna **beide** reeksen (geen verloren update); een store waarvan de schrijfactie ongemerkt verloren gaat (terugleesvervalsing, `ok:false`) → het resultaat wordt toch teruggegeven en `console.error` is aangeroepen (mock), geen exception.
  - `bepaalLocatie`: volledig adres → `bron:'adres'`; geocode faalt → terugval op het postcode-middelpunt (`bron:'postcode'`); enkel postcode → `bron:'postcode'`; zonder postcode → `null`.
  - `vulLocatiesAan`: leads met `locatie` blijven; `open` telt wat het budget niet haalde of niet gevonden werd; invoer niet gemuteerd.
- [ ] **Step 2: Run** `node --test tests/server-sales-postcode.test.mjs tests/server-sales-locatie.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): postcodecache en locatiebepaling`.

---

## Task 7: Opslag, wijzigingen en grafstenen **[los van logins, mits Task 0 stap 5]**

**Files:**
- Create: `netlify/lib/sales-opslag.js`, `netlify/lib/sales-wijzig.js`, `netlify/lib/sales-grafsteen.js`, `netlify/lib/sales-locaties-bewaren.js`
- Test: `tests/server-sales-opslag.test.mjs`, `tests/server-sales-grafsteen.test.mjs`

**Interfaces:**
- Consumes: `pasLeadToe`, `valideerLead`, `valideerBlok` (Task 3), `herkenningssleutels` (Task 2), `vulLocatiesAan` (Task 6b), `wijzigBlob`, `maakSerieel`, `maakNepStore`.
- Produces:
```js
// sales-opslag.js
export const salesSleutel = gebruikerId => `sales/${gebruikerId}`;
export const leegSales = () => ({ versie: 0, leads: [], blokken: [], grafstenen: [] });
export async function leesSales(store, gebruikerId)   // -> { versie, leads, blokken, grafstenen } (ontbrekende velden aangevuld; leeg als er geen blob is); enkel lezen, geen slot
export function naarClient(data, gebruikerId)         // -> { gebruikerId, versie, leads, blokken }  (diepe kopie, `grafstenen` weggelaten; voor ELK antwoord)
export async function muteerSales(store, gebruikerId, { verwachteVersie, wijzig })
  // wijzig(data /*verse kopie van de huidige blob*/) -> { data: nieuweData, extra? } | { fouten: string[] } | null (niets doen)
  // -> { status:'ok', data /* de geschreven blob, versie +1 */, extra } | { status:'ongewijzigd', data }
  //  | { status:'conflict', data /* huidige blob */ }    (verwachteVersie opgegeven en ≠ huidige versie, ook na een herhaling van wijzigBlob)
  //  | { status:'ongeldig', fouten }                     (niets geschreven)
  //  | { status:'storing' }                              (wijzigBlob `ok:false` of de store gooit: fail closed)
// sales-wijzig.js
export function pasWijzigingToe(data, body, { nu, nieuwBlokId }) // body = { leads?, blokken? } -> { data, adresGewijzigd: string[], resultaten: [{ leadId, soort }], fouten: string[] }; bij elke fout blijft `data` ongewijzigd (alles of niets)
// sales-grafsteen.js (server; node:crypto)
export function hashSleutel(sleutel, gebruikerId)     // -> 32 hex-tekens: SHA-256 van `blitz-sales|<gebruikerId>|<sleutel>`
export const hashVoor = gebruikerId => sleutel => hashSleutel(sleutel, gebruikerId)   // wat `voegSamen` (Task 2) als `hash` krijgt
export function maakGrafsteen(lead, { gebruikerId, nu }) // -> { h: string[], op: ISO } | null (null als de lead geen enkele herkenningssleutel heeft)
export function voegGrafsteenToe(grafstenen, grafsteen)  // overlappende hash: samenvoegen (h-vereniging, nieuwste `op`); anders toevoegen
// sales-locaties-bewaren.js
export async function bewaarLocaties({ store, doelId, nu, deps, maxTijdMs = 15000 }) // -> { status:'ok', data, open } | { status:'storing' }
```
Seriële keten: één `maakSerieel()` **per blobsleutel** (`Map<sleutel, serieel>` in `sales-opslag.js`), zodat gelijktijdige verzoeken op hetzelfde verkoperblob elkaar niet overschrijven; tussen instanties blijft enkel de terugleescontrole van `wijzigBlob`. `muteerSales` houdt de uitkomst in een closure die bij **elke** aanroep van de `wijzig`-callback (ook bij een herhaling door `wijzigBlob`) opnieuw begint. `wijzigBlob` verhoogt `versie` zelf.
`bewaarLocaties` (netwerk buiten het slot): leest het blob (zonder slot), bepaalt via `vulLocatiesAan` de locaties van leads zonder `locatie`, en schrijft die daarna met een gerichte tweede `muteerSales` (zonder `verwachteVersie`) die per lead enkel `locatie` (en een lege `gemeente`) zet als de lead nog zonder locatie is **én** straat, huisnr en postcode nog gelijk zijn aan wat geocodeerd werd (een tussentijdse adreswijziging wint dus). Geen enkele lead krijgt een andere wijziging.
`pasWijzigingToe` valideert de vorm van de body: `leads` en `blokken.*` zijn arrays met hoogstens 500 items, ids zijn niet-lege tekst; anders `fouten`. `resultaten` bevat één item per **nieuw toegevoegd bezoek** in `bezoeken` (dat dekt ook 'opnieuw'), met `soort = bezoek.resultaat`.

- [ ] **Step 1: Write the failing tests:**
  - **Opslag:** leeg blob → `leegSales()`; `leesSales` vult ontbrekende velden aan (oud blob zonder `grafstenen`); `naarClient` bevat geen `grafstenen` en deelt geen referenties; sleutel is `sales/<id>` en twee verkopers raken elkaar niet; `muteerSales` met `verwachteVersie:0` op een leeg blob → `ok`, `versie 1`; foute versie → `conflict` met de huidige blob en **geen** schrijfactie (`store._schrijfacties`); `wijzig` geeft `null` → `ongewijzigd` zonder schrijfactie; `{ fouten }` → `ongeldig` zonder schrijfactie; `store.setJSON` gooit → `storing`; een store waarvan `get` na `setJSON` een oudere stand teruggeeft (3×) → `storing`; **twee gelijktijdige `muteerSales`-aanroepen** op hetzelfde blob (`Promise.all`) zijn beide toegepast (`versie 2`, beide wijzigingen aanwezig); een tweede aanroep met een `verwachteVersie` van vóór de eerste krijgt `conflict` (Review Focus 7).
  - **Wijzigen:** lead-velden toegepast via `pasLeadToe`; onbekende lead-id → fout; een fout in één van twee leads → niets toegepast; adreswijziging geeft de lead-id in `adresGewijzigd`; `geefResultaat('opnieuw')` én `geefResultaat('verkocht')` geven elk precies één item in `resultaten` met de juiste `soort`; blokken toevoegen krijgt `nieuwBlokId()`, wijzigen en verwijderen werken, ongeldig blok (Task 3) → fout; ongeldige statusovergang → fout; 501 items of een id die geen tekst is → fout.
  - **Grafstenen:** `maakGrafsteen` van een lead met e-mail en gsm bevat twee hashes, `JSON.stringify(grafsteen)` bevat geen naam, geen `@` en geen gsm-cijfers; dezelfde lead bij een andere verkoper → andere hashes; een lead met enkel naam+voornaam+postcode → één hash (`n:`-sleutel); een lead zonder naam/e-mail/gsm → `null`; `voegGrafsteenToe` voegt samen bij overlappende hash en voegt anders toe; `hashVoor` samen met `voegSamen` (Task 2): een eerder verwijderde lead wordt herkend.
  - **bewaarLocaties:** een lead zonder locatie krijgt er na afloop een (nep-geocoding), leads met locatie blijven onaangeroerd; wijzigt het adres tijdens het geocoderen (blob tussendoor aangepast) dan blijft `locatie:null`; `open` telt de niet-gevonden leads; store-storing → `{ status:'storing' }`.
- [ ] **Step 2: Run** `node --test tests/server-sales-opslag.test.mjs tests/server-sales-grafsteen.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): opslag per verkoper, wijzigingen en grafstenen`.

---

## Task 8: UI-logica Te plannen, Afgewerkt en Detail **[los van logins]**

**Files:**
- Create: `public/js/schermen/sales-lijst-logica.js`, `public/js/schermen/sales-detail-logica.js`
- Test: `tests/sales-lijst-logica.test.mjs`, `tests/sales-detail-logica.test.mjs`

**Interfaces:**
- Consumes: `adresSoort`, `plaatsLabel` (Task 1), `isVast`, `RESULTAAT_LABEL` (Task 3).
- Produces:
```js
// sales-lijst-logica.js
export function filterLeads(leads, { zoek = '', gebied = '' })      // alle woorden moeten voorkomen in voornaam/naam/gemeente/postcode (hoofdletterongevoelig); gebied = eerste 2 cijfers postcode
export function postcodegebieden(leads)                              // -> [{ gebied:'36', aantal }] gesorteerd
export function groepeerLijst(leads)                                 // -> { tePlannen: Lead[] (oudste geimporteerdOp eerst), ingepland: Lead[] (voorgesteld+bevestigd op datum, start) }  (afgewerkt valt weg)
export function kaartInfo(lead)                                      // -> { titel:'Marie Janssens', plaats, adresLabel:'enkel postcode'|'volledig adres'|'adres nakijken', vastUur: 'ma 12 okt 10:00'|null, telHref:'tel:…'|null, mailHref:'mailto:…'|null, status, eerderVerwijderd: boolean /* label "eerder verwijderd" (besluit a) */ }
export function afgewerktRijen(leads, { resultaat = '', periode = 'alles', nu })  // periode '30d'|'3m'|'12m'|'alles'; -> [{ leadId, naam, datum, soort, label, notitie }] nieuwste eerst (laatste bezoek)
// sales-detail-logica.js
export function valideerDetail(invoer)                               // { straat, huisnr, postcode, gemeente, notitie, duurMin } -> { fout } | { velden }
export function valideerVastUur({ datum, start, vandaag })           // -> { fout } | { ok: true }
export function vindBotsingen({ leads, blokken, datum, start, duurMin, exceptId, standaardDuurMin }) // -> [{ soort:'lead'|'blok', omschrijving, start, eind }]
```
Teksten: postcode fout `'Postcode bestaat uit 4 cijfers'`; straat zonder huisnr (of omgekeerd) `'Vul straat én huisnummer in'`; duur `'Minimale bezoekduur is 15 minuten'`; vast uur in het verleden `'Kies een datum vanaf vandaag'`; uur `'Geef het uur als UU:MM'`. Lege `duurMin` → `null` (standaard van de verkoper). `telHref` enkel bij ≥ 9 cijfers (placeholder-gsm geeft `null`).

- [ ] **Step 1: Write the failing tests:** per functie het genoemde gedrag, onder meer: zoeken `'kin 36'` vindt een lead uit Kinrooi (3640); gebied `'36'`; `groepeerLijst` sorteert wachttijd-eerst en laat `afgewerkt` weg; `kaartInfo` voor placeholder-gsm → `telHref:null`, voor een lead met `eerderVerwijderd:{ op }` → `eerderVerwijderd:true` (anders `false`); `afgewerktRijen` met periode `'30d'` en vaste `nu`; `valideerDetail` alle foutteksten + geldige invoer → `velden` (lege `duurMin` → `null`); `vindBotsingen` vindt een overlappende vaste lead én een blok, negeert `exceptId` en niet-vaste (voorgesteld) leads.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (puur, geen DOM). Datumlabel via `fmtDateShort`-stijl in lokale tijd (`kern/tijd.js`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): logica voor lijst, afgewerkt en detail`.

---

## Task 9: UI-logica Kalender, Plan en Route **[los van logins]**

**Files:**
- Create: `public/js/schermen/sales-kalender-logica.js`, `public/js/schermen/sales-plan-logica.js`, `public/js/schermen/sales-route-logica.js`
- Test: `tests/sales-kalender-logica.test.mjs`, `tests/sales-plan-logica.test.mjs`, `tests/sales-route-logica.test.mjs`

**Interfaces:**
- Consumes: `bepaalLanes`, `maandRaster` (bestaand, `kalender-logica.js`), `isVast` (Task 3), `haversine` (`planner.js`), `timeStrToMin` (`kern/tijd.js`).
- Produces:
```js
// sales-kalender-logica.js
export function bouwKalenderItems({ leads, blokken, datum, standaardDuurMin }) // -> KalenderItem[] (enkel voorgesteld|bevestigd met planning.datum === datum, plus blokken van die dag; hele-dag blok 0..1440; bezoek: einde = start + (duurMin ?? standaard))
export function maandChips({ leads, blokken, datum })                           // -> { [iso]: [{ label, tint }] }
export function tintVan(lead)                                                   // 'bevestigd' bij isVast, anders 'voorgesteld'
// sales-plan-logica.js
export function redenTekst(reden, { maxReistijdMin = 45, laatsteStart = '16:00' }) // gewone taal per reden van het brein ('geen-plaats','te-ver','klant-geblokkeerd','voorkeursdag-afstand','voorkeursdag-vol','vast-uur-botst','adres-niet-gevonden'; onbekend -> 'Geen plaats meer deze week')
export function bouwResultaatRegels({ overzicht /*uit verwerkUitkomst*/, leads }) // -> { ingepland:[{ naam, datumLabel, start }], nietIngepland:[{ naam, tekst }], waarschuwingen:[tekst] }  ('reistijd-geschat' en 'locatie-onbekend' als in planacties.js)
export function weekStartVan(gekozenIso)                                         // maandag van die week als Date (lokaal)
// sales-route-logica.js
export function bouwRouteStops(leads, datum)                                     // -> RouteStop[] gesorteerd op start (voorgesteld|bevestigd van die dag), nr vanaf 1, ongeveer = locatie.bron === 'postcode'
export function schatLegs(punten /*[{lat,lon}]*/)                                // -> [{ travelTimeSeconds, distanceMeters }] (haversine × 1,3 km, 50 km/u)
export function controleerKeten(stops, legsMin /* minuten per rit, eerste = depot -> stop 1 */, depotVertrekMin) // -> [{ leadId, laatMin }] voor elke stop die de eerste afspraak of de vorige stop + rit niet haalt
export function routeHandtekening(depot, stops)                                  // string: verandert bij andere volgorde, ids of coördinaten (verouderde route herkennen)
```

- [ ] **Step 1: Write the failing tests:** `bouwKalenderItems` laat `te-plannen`/`afgewerkt` en andere dagen weg, geeft tint `voorgesteld` vs `bevestigd`, eindtijd uit `duurMin` of standaard, hele-dag verlof als 0..1440, en de uitvoer gaat ongewijzigd door `bepaalLanes` (twee overlappende items → `laneCount: 2`); `maandChips` groepeert per datum; `redenTekst` voor elke reden (`'te-ver'` noemt `45 min`); `bouwResultaatRegels` met één geplaatst, één niet-geplaatst en een `reistijd-geschat`-waarschuwing; `weekStartVan('2026-10-08')` → maandag 2026-10-05; `bouwRouteStops` sorteert op uur, markeert `ongeveer` bij postcode-locatie en `locatie:null` zonder locatie; `controleerKeten` vlagt een stop die 12 min te laat is en laat een haalbare keten leeg; `routeHandtekening` verschilt bij gewisselde volgorde en bij één andere coördinaat; `schatLegs` geeft n−1 legs.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** (puur).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): logica voor kalender, plan en route`.

---

## Task 10: Client-gegevenslaag **[los van logins]**

**Files:**
- Create: `public/js/schermen/sales-data.js`
- Test: `tests/sales-data.test.mjs`

**Interfaces:**
- Consumes: `apiVerzoek`, `zetFetch` (`kern/api.js`, bestaand), `localISO` (`kern/tijd.js`). De laag past geen domeinregels toe: ze stuurt enkel `velden`.
- Produces: `salesToestand`, `onSalesWijziging` (zie "Keuze gegevensbron-laag") en
```js
export async function laadSales({ gebruikerId } = {})      // GET /api/sales[?gebruiker=] -> zet toestand; gooit niet (return { ok:false, status, opslag?: true } bij een fout; opslag:true bij 503 code 'opslag-storing' = later opnieuw proberen, niet uitloggen)
export const SALES_STANDAARD = { vanTijd:'08:00', totTijd:'17:00', laatsteStart:'16:00', werkdagen:[1,2,3,4,5], bezoekDuurMin:60 };
export async function laadInstellingen({ gebruikerId } = {}) // GET /api/instellingen[?gebruiker=] -> antwoord { versie, instellingen: Instellingen|null }; de toestand krijgt { ...SALES_STANDAARD, ...instellingen } (nooit null; zonder `startlocatie` is er geen depot)
export async function wijzig(patch /*{ leads?, blokken?, aanvullen? }*/) // PATCH met toestand.versie; 409 -> server-stand overnemen en EENMAAL opnieuw sturen; -> { ok, reden?: 'conflict'|'http'|'netwerk'|'opslag', fouten? }  (opslag = 503 'opslag-storing': geen herlogin, de oproeper toont "De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw." en de lokale stand blijft ongewijzigd)
export async function importeer(exportObject)               // POST /api/sales-import -> { ok, samenvatting?, export?, fout? }; herlaadt daarna de toestand
export function verwijderMetOngedaan(leadId, { wacht = 5000, setTimeoutFn, clearTimeoutFn } = {}) // lead meteen uit de weergave (toestand.uitgesteld), na `wacht` ms DELETE; -> { ongedaan() }
export function spoelUitgesteld({ keepalive = true } = {})   // verstuurt openstaande verwijderingen meteen (voor 'pagehide')
export function gekozenDatum(), zetGekozenDatum(iso)
```
Een 404 op DELETE telt als geslaagd. Een mislukte DELETE zet de lead terug in de weergave en geeft `{ ok:false }` aan de oproeper via `onSalesWijziging`.

- [ ] **Step 1: Write the failing tests** (`zetFetch` met een nep die de verzoeken opneemt; vaste timers via `mock.timers`):
  - `laadSales` zonder/met `gebruikerId` roept de juiste URL aan en vult `leads`, `blokken`, `versie`; 503 met `code:'opslag-storing'` → `{ ok:false, status:503, opslag:true }` en de bestaande toestand blijft staan.
  - `laadInstellingen`: antwoord `{ versie:3, instellingen:null }` → toestand = `SALES_STANDAARD` (nooit `null`); `{ instellingen:{ vanTijd:'09:00', startlocatie:'Hasselt', bezoekDuurMin:45 } }` → samengevoegd met de standaardwaarden (werkdagen ma–vr blijven); met `gebruikerId` → `?gebruiker=<id>`.
  - `wijzig`: stuurt `{ versie, … }`; bij `409` met `data` wordt de server-stand overgenomen en de patch **eenmaal** opnieuw gestuurd met de nieuwe versie (veld-patches per lead-id gaan niet verloren); tweede 409 → `{ ok:false, reden:'conflict' }`; `400` met `fouten` → doorgegeven; netwerkfout → `reden:'netwerk'`; `503` `opslag-storing` → `reden:'opslag'` zonder tweede poging (Review Focus 4, 7).
  - `verwijderMetOngedaan`: na 4 999 ms nog geen DELETE; `ongedaan()` vóór 5 000 ms → nooit een DELETE en de lead is terug in `uitgesteld`-vrije weergave; na 5 000 ms → precies één `DELETE /api/sales?lead=<id>`; `spoelUitgesteld()` verstuurt openstaande deletes onmiddellijk met `keepalive`; mislukte DELETE → lead terug zichtbaar.
  - `onSalesWijziging` meldt af correct.
- [ ] **Step 2: Run** `node --test tests/sales-data.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** Module-privé toestand en abonneelijst (eigen, klein; **geen** sleutels toevoegen aan `kern/toestand.js`). Geen import van `kern/sessie.js` (maakt de laag in node testbaar). Een 401 handelt de fetch-omhulling van logins (`installeerApiBeveiliging`: opnieuw inloggen en het verzoek één keer herhalen) af; deze laag doet er niets mee.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): client-gegevenslaag met versiecontrole en uitgestelde verwijdering`.

---

## Task 11: Server — toegang, acties en functies `sales` en `postcode`

**Voorwaarde:** logins gemerged (Task 0 preflight).

**Files:**
- Create: `netlify/lib/sales-toegang.js`, `netlify/lib/sales-acties.js`, `netlify/functions/sales.js`, `netlify/functions/postcode.js`
- Modify: `netlify/lib/rechten.js` (rijen `'sales': { GET: BEHEER_SALES, PATCH: BEHEER_SALES, DELETE: BEHEER_SALES }` en `'postcode': { GET: BEHEER_SALES }`), `netlify/lib/testmodus.js` (`/^sales\//` in `NIET_KOPIEREN`: een testverzoek mag nooit echte leads naar `blitz-data-test` kopiëren), `netlify.toml` (`[functions.sales]` met `timeout = 26`)
- Test: `tests/server-sales.test.mjs`

**Interfaces:**
- Consumes: `beveiligV2` (`netlify/lib/beveiligd.js`), `authStore`, `OPSLAG_STORING` (`netlify/lib/auth-antwoord.js`), `logVoorVerzoek` (`netlify/lib/activiteit.js`), `leesGebruikers` (`netlify/lib/gebruikers.js`), `maakCors` (`netlify/lib/http.js`), `winkelNaam`/`isTestVerzoek`/`zorgVoorTestkopie` (`netlify/lib/testmodus.js`), `magLezen`/`magSchrijven` (Task 3), `leesSales`/`muteerSales`/`naarClient`/`pasWijzigingToe`/`maakGrafsteen`/`voegGrafsteenToe`/`bewaarLocaties` (Task 7), `zoekPostcode` (Task 6b), `geocodePostcode` (Task 6).
- Produces:
```js
// sales-toegang.js
export async function bepaalDoel({ gebruiker, gevraagdId, schrijven, leesGebruikers /* () => Promise<Gebruiker[]> */, testVerzoek }) // -> { ok:true, doelId } | { ok:false, status:403|404, fout }
  // sales: eigen id (ook als gevraagdId gelijk is); een ander id enkel om te lezen, enkel met magAlleSales en enkel naar een gebruiker met rol 'sales' (anders 403, ook bij een onbekend id: geen lek, zoals instellingen.js);
  // beheerder: elk id van een gebruiker met rol 'sales' (404 anders), lezen én schrijven; 'test-sales' is altijd geldig als testVerzoek; andere rollen: 403
// sales-acties.js (alle drie -> { status, json }; `log({ actie, onderwerp, details })` is een closure rond `logVoorVerzoek`)
export async function haalSales({ store, doelId })
export async function wijzigSales({ store, doelId, gebruiker, body, nu, deps, log })
export async function verwijderLead({ store, doelId, gebruiker, leadId, nu, log })
// functions/sales.js en postcode.js
export function maakHandler({ getStore: haalStore, fetch = globalThis.fetch, nu = () => Date.now(), sleutel = () => process.env.TOMTOM_API_KEY, auth }) // -> async (req, context) => Response, ingehangen met beveiligV2('sales' | 'postcode', kern, auth ? { auth } : undefined)
export default maakHandler({ getStore });
export const config = { path: '/api/sales' }; // resp. '/api/postcode'
```
Kern van elke functie (patroon `netlify/functions/instellingen.js`): `OPTIONS` → 204 met CORS (de rij heeft geen `*`, dus de wrapper laat OPTIONS door); CORS `maakCors({ methoden:'GET, PATCH, DELETE, OPTIONS', headers:'Content-Type, X-Blitz, X-Blitz-Test', inhoudType:'application/json' })`; `if (isTestVerzoek(req)) await zorgVoorTestkopie(haalStore)`; `aStore = await authStore(haalStore)` (echte store, voor de gebruikerslijst), `store = await haalStore({ name: winkelNaam(req), consistency:'strong' })`; alles in een `try`: bij een fout `console.error` met enkel het fouttype en `503 OPSLAG_STORING`. De X-Blitz-controle doet de wrapper. Elk antwoord: `Cache-Control: no-store`, nooit `grafstenen` (`naarClient`).
`wijzigSales`: `body.versie` verplicht (anders 400 `'versie ontbreekt'`); één `muteerSales(store, doelId, { verwachteVersie: body.versie, wijzig })` met `pasWijzigingToe` (`status:'conflict'` → `409 { error:'Versiematch mislukt', serverVersie, data: naarClient(data) }`; `'ongeldig'` → `400 { error, fouten }`; `'storing'` → 503). Is er daarna een adreswijziging of staat `aanvullen:true`: `bewaarLocaties` (geocoding buiten het slot; een adres dat niet gevonden wordt valt terug op het postcode-middelpunt, `bron:'postcode'`, en het kaartje toont "adres nakijken"). Antwoord `200 { ...naarClient(data), open }`. Elk nieuw bezoek in `resultaten` → `log({ actie:'sales-resultaat', onderwerp: leadId, details:{ soort } })`.
`verwijderLead`: `muteerSales` zonder versiecontrole: lead niet gevonden → 404; anders lead eruit en `voegGrafsteenToe(grafstenen, maakGrafsteen(lead, { gebruikerId: doelId, nu }))` (besluit a) → `200 { versie }`, `log({ actie:'sales-lead-verwijderd', onderwerp: leadId })` (nooit namen).
`postcode.js`: `GET ?pc=3640` → `zoekPostcode` → `200 { pc, lat, lon, gemeente }`; ongeldige `pc` → 400; niet gevonden → 404; in testmodus nepcoördinaten zonder `fetch` en cache in de teststore.

- [ ] **Step 1: Write the failing tests** (`maakNepStore` voor de echte én de teststore, nep-fetch, vaste klok; rol via `metRol(rol, werk, { magAlleSales })` uit `tests/auth-hulp.mjs`; verzoeken met `x-blitz: 1`; het activiteitenlog lees je uit `activiteit/<YYYY-MM>` in de echte store):
  - **Toegang (matrix, tabelgedreven):** sales A leest zichzelf → 200 leeg blob; A met `?gebruiker=B` → 403; A met `magAlleSales` leest B → 200 maar PATCH/DELETE op B → 403; A met `magAlleSales` leest een niet-verkoper of onbekend id → 403; beheerder leest en schrijft B; beheerder met het id van een niet-verkoper of onbekend id → 404; planner/technieker → 403 `geen-recht` zonder dat de kern draait; geen sessie → 401 (`metGeenSessie`); **PATCH zonder `X-Blitz`** → 403 `code:'csrf'` (via het testrol-pad: `process.env.BLITZ_LOKALE_DEV='1'`, headers `x-blitz-test: 1` en `x-blitz-test-rol: sales`; `metRol` slaat de CSRF-controle over en kan dit niet testen); `OPTIONS` → 204.
  - **PATCH:** zonder `versie` → 400; verkeerde versie → 409 met `data` (zonder `grafstenen`); geldige lead-patch → versie +1, antwoord bevat de volledige blob; adreswijziging naar volledig adres roept `geocodeAdres` (nep) en zet `locatie.bron:'adres'`; geocode faalt → `locatie.bron:'postcode'` (geen crash); postcode niet te vinden → `locatie:null`; `aanvullen:true` vult locaties aan en geeft `open`; resultaat `'verkocht'` én `'opnieuw'` → elk één logregel `actie:'sales-resultaat'`, `onderwerp = leadId`, `details` zonder namen/gsm/e-mail; ongeldige patch → 400 met `fouten` en het blob is onaangeroerd; **twee gelijktijdige PATCH'es** op hetzelfde blob (twee leads, `Promise.all`, beide met de huidige versie): de eerste slaagt, de tweede krijgt 409 en na een nieuwe poging met de verse versie zijn beide wijzigingen aanwezig (Review Focus 7).
  - **Opslagstoring:** een store waarvan `setJSON` gooit of waarvan het teruglezen afwijkt → 503 met `code:'opslag-storing'` (geen 401/403, geen gedeeltelijke schrijfactie) voor GET, PATCH, DELETE en postcode.
  - **DELETE:** verwijdert, logregel `'sales-lead-verwijderd'` met enkel het lead-id; het blob bevat een grafsteen met hashes en **geen** naam/e-mail/gsm; het antwoord (en elke volgende GET) bevat geen `grafstenen`; onbekend id → 404; blob van verkoper B blijft onaangeroerd.
  - **Testmodus:** header `X-Blitz-Test: 1` → store `blitz-data-test`, `fetch` 0× aangeroepen, geen activiteitenlog; een echt blob `sales/u-x` in de echte store wordt door `zorgVoorTestkopie` **niet** naar de teststore gekopieerd; `?gebruiker=test-sales` is enkel geldig bij een testverzoek.
  - **postcode:** `?pc=3640` → 200 met `{ pc, lat, lon, gemeente }`; `?pc=36` → 400; onbekend → 404; planner/technieker → 403.
- [ ] **Step 2: Run** `node --test tests/server-sales.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** Functies blijven dun (logica in `netlify/lib`); geen eigen auth, geen `process.env`-lezing buiten `sleutel()`.
- [ ] **Step 4: Run** → PASS; daarna `node --test tests/server-http.test.mjs tests/rechten.test.mjs tests/testmodus-auth.test.mjs` onaangeroerd groen (de nieuwe rijen zijn aanwezig).
- [ ] **Step 5: Commit** `feat(sales): endpoints /api/sales en /api/postcode`.

---

## Task 12: Server — import, geplande opruiming; navigatie-controle

**Files:**
- Create: `netlify/lib/sales-import-server.js`, `netlify/functions/sales-import.js`, `netlify/functions/sales-opruimen.js`
- Modify: `netlify/lib/sales-opruimen.js` (voeg `ruimAllesOp`), `netlify/lib/rechten.js` (rijen `'sales-import': { POST: <enkel 'sales'> }` en `'sales-opruimen': { '*': 'open' }`: geplande functie, idempotent, wist enkel wat al ouder dan 12 maanden is, zoals `activiteit-opruimen`), `netlify.toml` (`[functions.sales-import]` met `timeout = 26`)
- Test: `tests/server-sales-import.test.mjs`, `tests/server-sales-opruimen.test.mjs`

**Interfaces:**
- Consumes: `leesExport` (Task 1), `voegSamen` (Task 2), `hashVoor` (Task 7), `muteerSales`/`naarClient`/`bewaarLocaties` (Task 7), `ruimOp` (Task 5), `beveiligV2`, `logVoorVerzoek`, `logActiviteit`, `authStore`.
- Produces:
```js
// sales-import-server.js
export async function importeerExport({ store, doelId, gebruiker, body, nu, nieuwId, deps, log }) // -> { status, json } (contract: "API-contract")
// sales-opruimen.js (uitbreiding)
export async function ruimAllesOp({ store, nu }) // -> { gewist: number, grafstenenGewist: number }; loopt over `store.list({ prefix:'sales/' })` (dus ook blobs van geblokkeerde of verwijderde verkopers), per blob `muteerSales` met `ruimOp`, schrijft enkel bij wijziging; per blob met gewiste leads één regel `logActiviteit(store, { gebruiker: { id:'systeem', naam:'Systeem' }, actie:'sales-lead-verwijderd', onderwerp: <verkoperId>, details:{ aantal } }, { nu })`
// functions/sales-import.js: maakHandler({ getStore, fetch, nu, sleutel, auth }) met beveiligV2('sales-import', …); config { path: '/api/sales-import' }
// functions/sales-opruimen.js: export default async () => …; export const config = { schedule: '@daily' }; (geen path; patroon `activiteit-opruimen.js`)
```
`importeerExport`: parseert `body.export` met `leesExport` (400 `{ error }` bij `ok:false`; de handler weigert een body groter dan 3 MB met 413 `'Het bestand is groter dan 2 MB'`), voegt samen binnen één `muteerSales` (zonder versiecontrole: de samenvoeging gebeurt altijd op de verse stand; `voegSamen` krijgt `grafstenen` en `hash: hashVoor(doelId)`; levert de samenvoeging niets nieuws op, dan `null` en dus geen schrijfactie), schrijft daarna de locaties via `bewaarLocaties` (budget 15 s; **twee** schrijfacties: leads, dan locaties) en logt `'sales-import'` met `details:{ nieuw, alAanwezig, adresNakijken, eerderVerwijderd }` (enkel aantallen); antwoord volgens het contract. Twee importen na elkaar met hetzelfde bestand → tweede geeft `nieuw: 0` (idempotent; twee toestellen). Alleen de rol `sales` mag importeren en altijd in het eigen blob (`doelId = gebruiker.id`; geen `?gebruiker`).

- [ ] **Step 1: Write the failing tests:** import van de fixture (verzonnen, 6 leads) → samenvatting klopt, blob bevat de leads met `locatie` (testmodus-geocoding), activiteitenlog zonder persoonsgegevens; tweede import identiek → `nieuw:0` én de blobversie blijft gelijk; **twee gelijktijdige imports** van hetzelfde bestand (`Promise.all`) → samen precies N leads, geen dubbels (Review Focus 7); **grafsteen (besluit a):** een lead verwijderen (`verwijderLead`, Task 11) en dezelfde export opnieuw importeren → samenvatting `eerderVerwijderd:1`, de lead staat er weer mét `eerderVerwijderd:{ op }`, de grafsteen is verbruikt (blob), een derde import geeft `nieuw:0`; een lead die nog op gsm of enkel op e-mail overeenkomt krijgt het label ook; het antwoord bevat nergens `grafstenen`; een export van een andere verantwoordelijke wordt door de server **niet** geblokkeerd (de waarschuwing is een client-vraag) maar staat in `export.verantwoordelijke`; kapotte export → 400 met de tekst uit Task 1; > 500 leads → 400; body > 3 MB → 413; beheerder/planner/technieker → 403 (`metRol`); TomTom valt uit (nep-fetch gooit) → import slaagt, `open` = aantal leads zonder locatie; opslagstoring → 503 `opslag-storing` zonder gedeeltelijke import; `ruimAllesOp` wist enkel afgewerkte leads > 12 maanden en grafstenen > 12 maanden bij alle `sales/*`-blobs (ook van een verkoper die niet meer in `gebruikers` staat), schrijft niets bij geen wijziging, logt één regel per verkoper met `details:{ aantal }` en gebruiker `{ id:'systeem', naam:'Systeem' }`; `tests/rechten.test.mjs` blijft groen.
- [ ] **Step 2: Run** beide testbestanden → FAIL.
- [ ] **Step 3: Implement.** Functies dun, logica in lib.
- [ ] **Step 4: Run** → PASS; daarna `node --test` volledig (geen regressie).
- [ ] **Step 5 (navigatie-controle, enkel verifiëren):** lees `kern/navigatie.js`, `kern/sessie.js`, `schermen/rol-schil.js`, `schermen/beheer-tabs.js` en `e2e/helpers.mjs` zoals logins ze opleverde en toets aan "Koppelvlak: vastgesteld tegen de logins-code" (punt 1, 2, 5). Leg afwijkingen vast in de ledger; pas dan enkel `sales-registratie.js`, `sales-start.js` (Task 13) en de e2e-hulp aan en meld het. Bevestig bij `registreerStart('sales', …)` dat een tweede registratie de eerste vervangt (zo niet: de placeholder-regel in `rol-schil.js` weghalen, Task 13).
- [ ] **Step 6: Commit** `feat(sales): import-endpoint en dagelijkse opruiming`.

---

## Task 13: Schil, venster, verkoperkeuze, tabregistratie en start voor rol sales

**Files:**
- Create: `public/js/schermen/sales-schil.js`, `public/js/schermen/sales-venster.js`, `public/js/schermen/sales-verkoper.js`, `public/js/schermen/sales-registratie.js`, `public/js/schermen/sales-start.js`, `public/css/sales.css`, `e2e/sales-hulp.mjs`, `e2e/fixtures/sales-export.json`, `e2e/sales-schil.spec.mjs`
- Modify: `public/js/schermen/rol-schil.js` (2 regels: import + aanroep `registreerSalesRol`, op de plek waar logins de tabs/start per rol registreert; de placeholder-start voor sales vervalt), `public/index.html` (1 `modulepreload`-regel voor `schermen/sales-registratie.js`, want `rol-schil.js` importeert die statisch), `public/js/schermen/kalender.js` (+`export` op 3 functies), `public/js/schermen/route-kaart.js` (+`export` op `KAART_LAGEN`), `public/sw.js` (`SHELL`). **`public/js/app.js` blijft onaangeroerd.**
- Test: `tests/sales-registratie.test.mjs`, `e2e/sales-schil.spec.mjs`

**Interfaces:**
- Consumes: `registreerTabs`, `registreerStart`, `tabsVoorRol`, `laadTab` (`kern/navigatie.js`, logins E1), `huidigeGebruiker`/`heeftRol`/`huidigeRechten` (`kern/sessie.js`, logins E5), `magSchrijven` (Task 3), `laadSales`/`laadInstellingen` (Task 10), `registreerVenster` (`venster.js`), `escHtml`, `registreerActies` (`kern/ui.js`), `TEST_MODE`.
- Produces:
```js
// sales-registratie.js — GEEN statische imports (alles lazy): de modulepreload-graaf is enkel dit bestand
const laadScherm = (id, importeer) => async () => { const [{ zorgVoorView }, m] = await Promise.all([import('./sales-schil.js'), importeer()]); return m.toon(zorgVoorView(id)); };
export const SALES_TABS = [ { id:'sales-lijst', label:'Te plannen', laad: laadScherm('sales-lijst', () => import('./sales-lijst.js')) }, { id:'sales-kalender', label:'Kalender', laad: laadScherm('sales-kalender', () => import('./sales-kalender.js')) }, { id:'sales-route', label:'Route', laad: laadScherm('sales-route', () => import('./sales-route.js')) }, { id:'sales-afgewerkt', label:'Afgewerkt', laad: laadScherm('sales-afgewerkt', () => import('./sales-afgewerkt.js')) } ];
export function registreerSalesRol({ registreerTabs, registreerStart }) // registreerTabs('sales', SALES_TABS); registreerTabs('beheerder', SALES_TABS met label 'Sales: <label>'); registreerStart('sales', () => import('./sales-start.js').then(m => m.start()))
// sales-schil.js
export function zorgVoorView(id)        // -> HTMLElement: de bestaande <div class="view" id="view-<id>"> (die maakt `pasRolToe` van logins, samen met de knop #tab-<id>); ontbreekt hij, dan wordt hij in <main> gemaakt; laadt /css/sales.css eenmalig
export function toonFout(view, tekst)
// sales-start.js (lazy; vervangt voor rol sales de gewone `opstart()` van app.js, die ~15 endpoints aanroept die voor sales 403 geven)
export function start()                 // koppelt de `hoofdtab`-klik op `.tabs-inner` (zelfde DOM-contract als `setTab` in app.js: .tab/.view `.active`, aria-selected, tabIndex, scrollTo(0,0)) en roept daarna `laadTab(id)`; koppelt `thema`; toont `#test-badge` bij TEST_MODE; verbergt de koptknoppen die enkel na `opstart()` werken (data-actie `vernieuw`, `persoon-menu`, `instellingen`) als `pasRolToe` dat niet al deed; activeert de eerste tab van `tabsVoorRol('sales')`
// sales-venster.js
export function openSalesVenster({ titel, bouw /*(body, sluit) => void*/, breed = false }) // -> { sluit() }; overlay + modal (klassen .overlay/.modal), geregistreerd bij registreerVenster, focus terug bij sluiten
// sales-verkoper.js
export async function renderVerkoperBalk(container, { onWijzig }) // toont keuzelijst enkel als `huidigeRechten().alleSales` (beheerder of sales met magAlleSales); laadt `GET /api/gebruikers?rol=sales` -> `data.gebruikers` (enkel actieve verkopers); bewaart de keuze in localStorage 'blitz_sales_verkoper' (in try/catch); roept onWijzig(gebruikerId, schrijfbaar)
export function getoondeVerkoper()      // -> { id, naam, salesNaam }  (eigen: uit huidigeGebruiker(); anders uit de gebruikerslijst)
export function schrijfbaarNu()         // magSchrijven(huidigeGebruiker(), salesToestand().gebruikerId)
export function kanImporteren()         // heeftRol('sales') en de getoonde verkoper is de ingelogde gebruiker zelf (beheerder en alleen-lezen: false)
```
Elke `toon(view)` van een scherm: verkoperbalk renderen → `laadSales` + `laadInstellingen` → scherm tekenen; `onSalesWijziging` hertekent. `laad()` wordt door `laadTab` bij **elke** tabwissel aangeroepen: `toon` moet idempotent zijn (één `onSalesWijziging`-abonnement per view, geen dubbele luisteraars). Een 503 `opslag-storing` van `laadSales` toont "De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw." met een knop **Opnieuw**, zonder uit te loggen. Alle id's en klassen in de sales-views dragen het voorvoegsel `sales-` (de beheerder heeft ook de ticket-schermen op dezelfde pagina). De `rol-schil.js`-wijziging is exact: `import { registreerSalesRol } from './sales-registratie.js';` en `registreerSalesRol({ registreerTabs, registreerStart });` (beide functies importeert `rol-schil.js` al uit `../kern/navigatie.js`); `registreerTabs('sales', [])` van logins blijft staan (tabs voegen toe).

- [ ] **Step 1: Write the failing tests:** `tests/sales-registratie.test.mjs`: `registreerSalesRol(spionen)` roept `registreerTabs('sales', …)` met id's in de volgorde `['sales-lijst','sales-kalender','sales-route','sales-afgewerkt']` en `registreerTabs('beheerder', …)` met labels die met `'Sales: '` beginnen; elk tab heeft een functie `laad`; `registreerStart` wordt met `'sales'` en een functie aangeroepen; het bronbestand `sales-registratie.js` bevat geen statische `import … from`-regel (bewaakt de modulepreload-graaf). `e2e/sales-schil.spec.mjs` (stijl `e2e/plan-week.spec.mjs`, hulp `startSalesApp` uit `e2e/sales-hulp.mjs`): als sales-gebruiker staan precies de vier tabs "Te plannen · Kalender · Route · Afgewerkt" in de tabbalk, geen ticket-tabs, geen verzoek naar een pad uit `VERBODEN_PADEN`; de tab "Te plannen" toont de lege toestand "Nog geen leads. Laad een export." zonder consolefouten; een klik op "Kalender" activeert `#view-sales-kalender` (bewijst dat `sales-start.js` de tab-klik koppelt); zonder bewaarde instellingen (`instellingen: null`) werkt alles met de standaardwaarden; een 503 `opslag-storing` op `GET /api/sales` toont de melding met **Opnieuw** en het loginscherm verschijnt niet.
- [ ] **Step 2:** Maak `e2e/sales-hulp.mjs`: `salesStubs({ gebruiker, leads?, blokken?, instellingen? })` → handlerkaart voor `sales`, `sales-import`, `postcode`, `instellingen`, `gebruikers` die de **echte** `maakHandler`s uit `netlify/functions/` gebruikt met een in-memory store (`tests/nep-blobs.mjs`), `auth: maakAuth({ vasteGebruiker: gebruiker })` (testseam van logins; slaat de CSRF-controle over) en de header `X-Blitz-Test: 1`; `startSalesApp(page, { gebruiker, overschrijf })` = `startApp(page, { loginRol: 'sales', overschrijf: { 'auth-ik': <{ gebruiker, rechten: { beheer:false, plannen:false, alleSales: gebruiker.magAlleSales === true }, moetWachtwoordWijzigen:false, lokaleDev:false }>, ...salesStubs(…), ...overschrijf } })` (opzet van `startApp` zoals logins die opleverde, Task 12 stap 5) en wacht op de tab "Te plannen" i.p.v. `#cnt-tickets`. Maak `e2e/fixtures/sales-export.json`: verantwoordelijke `"Test Verkoper"`, 8 verzonnen leads (postcode-only 3640/3500/2440/3600/3550; één `"Dorpsstraat 12, 3640 Kinrooi"`; één `"bij de molen"`; één met placeholder-gsm `+32000000`; één e-mail met hoofdletters die dubbel voorkomt). Run `npx playwright test e2e/sales-schil.spec.mjs` → FAIL.
- [ ] **Step 3: Implement** de vijf modules, `sales.css` (voorvoegsel `sales-`, tinten `.sales-voorgesteld` lichter dan `.sales-bevestigd`, gestippeld `sales-marker-ongeveer`; hergebruik tokens uit `base.css`), de regels in `rol-schil.js`/`index.html` en de `export`-sleutelwoorden. Voeg de nieuwe bestanden van deze taak (modules, `sales.css`) toe aan `SHELL` in `public/sw.js`; elke volgende taak doet dat voor zijn eigen bestanden.
- [ ] **Step 4: Run** `node --test tests/sales-registratie.test.mjs tests/sw-schil.test.mjs tests/sw-strategie.test.mjs tests/window-namen.test.mjs`, `npx playwright test e2e/sales-schil.spec.mjs` en de bestaande kalender-/route-specs (`e2e/kalender*.spec.mjs e2e/route*.spec.mjs`) en rol-specs van logins → PASS. `git diff -w -- public/js/schermen/kalender.js public/js/schermen/route-kaart.js` toont alleen `export`; `git diff refactor..HEAD --stat -- public/js/app.js` is leeg.
- [ ] **Step 5: Commit** `feat(sales): schil, tabregistratie, start en verkoperkeuze`.

---

## Task 14: Scherm "Te plannen" met import, verwijderen en detail

**Files:**
- Create: `public/js/schermen/sales-lijst.js`, `public/js/schermen/sales-detail.js`, `e2e/sales-import.spec.mjs`
- Modify: `public/sw.js` (`SHELL`)
- Test: `e2e/sales-import.spec.mjs`

**Interfaces:**
- Consumes: Task 8 (logica), Task 10 (`importeer`, `wijzig`, `verwijderMetOngedaan`, `spoelUitgesteld`), Task 13 (`openSalesVenster`, `kanImporteren`, `getoondeVerkoper`, `schrijfbaarNu`), `leesExport`/`zelfdeNaam` (Task 1), `zetVastUur`/`terugNaarTePlannen` (Task 3), `appConfirm` (`app-dialog.js`), `toast`.
- Produces: `export async function toon(view)` (Te plannen) en `export function openLeadDetail(leadId, { focus } = {})` (door Task 16 hergebruikt; `focus:'vast-uur'` opent het venster met de sectie **Vast uur afspreken** in beeld).

Gedrag: knop **Export laden** (enkel zichtbaar als `kanImporteren()`: de beheerder en de alleen-lezen-weergave van een andere verkoper krijgen hem niet, de server weigert het ook; bestandskiezer `.json`; bestand > 2 MB → fout zonder lezen) → `leesExport` → andere `verantwoordelijke` dan `getoondeVerkoper().salesNaam` (vergeleken met `zelfdeNaam`) → `appConfirm` "Deze export is van X. Toch inladen?" vóór er iets bewaard wordt → `importeer` → toast "12 nieuw (waarvan 2 eerder verwijderd), 7 al aanwezig, 1 adres nakijken" (het stuk tussen haakjes enkel bij `eerderVerwijderd > 0`) met daaronder de exportgegevens (`aantal`, `statussen`) → bij `open > 0` herhaald `wijzig({ aanvullen:true })` (max. 10×). Kaartjes uit `kaartInfo` (met het label **eerder verwijderd** als `eerderVerwijderd`: de verkoper beslist; in het detail de knop **Label wissen** = `wijzig({ leads:[{ id, velden:{ eerderVerwijderd:null } }] })`; ✕ maakt een nieuwe grafsteen), gegroepeerd "Nog in te plannen" / "Ingepland"; zoekveld en postcodegebied-filter; **✕** → `appConfirm`, daarna 5 s "Ongedaan maken"-balk (`verwijderMetOngedaan`); `pagehide` → `spoelUitgesteld()`. Detail (`sales-detail.js`): straat, huisnr, postcode, gemeente, notitie, bezoekduur, historiek `bezoeken` (alleen lezen), **Vast uur afspreken** (besluit b: voor élke lead die niet afgewerkt is, ook als hij nog niet ingepland was, en ook om een al vastgelegd uur te wijzigen; datum + uur; `valideerVastUur`; botsing → `appConfirm` met `vindBotsingen`; daarna `zetVastUur`; PATCH met `status:'bevestigd'` en `planning:{ datum, start, vast:true }`), **Terug naar te plannen**; opgeslagen adreswijziging → toast "Adres opgeslagen"; wijzigt een voorgesteld/bevestigd bezoek van postcode naar volledig adres, dan toast "Adres bijgewerkt — de route van die dag is herberekend. Plan de week opnieuw om de uren te herschikken." Alleen-lezen modus (`schrijfbaarNu() === false`): geen ✕, geen invoer, geen knoppen. Een mislukte `wijzig` met `reden:'opslag'` toont "De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw." en laat het kaartje/venster open.

- [ ] **Step 1: Write the failing e2e** (`e2e/sales-import.spec.mjs`): (a) export laden (fixture) → samenvatting "N nieuw, 0 al aanwezig, 1 adres nakijken" (zonder het deel "eerder verwijderd"), kaartjes met labels "enkel postcode" / "volledig adres" / "adres nakijken", geen `/api/matrix`/`/api/route`; dezelfde export nogmaals → "0 nieuw, N al aanwezig"; (b) export van "Andere Verkoper" → bevestigingsvenster, **Terug** bewaart niets (`verzoeken.van('/api/sales-import')` leeg); (c) kapotte JSON en een naam `<img src=x onerror=…>` → foutmelding resp. letterlijke tekst op het kaartje (geen `img` in de DOM); (d) ✕ → bevestigen → "Ongedaan maken" binnen 5 s herstelt de lead (geen DELETE), laten verlopen met `page.clock.runFor(5000)` stuurt precies één DELETE; (e) detail: straat + huisnr invullen → label wordt "volledig adres"; (f) **Vast uur afspreken** (dinsdag 10:00) op een lead die nog niet ingepland was → lead verhuist naar "Ingepland" met chip; opnieuw openen en een ander uur kiezen wijzigt het; botsing met een bestaand vast uur → bevestigingsvraag; (g) **eerder verwijderd:** een lead ✕ en na 5 s weg (DELETE), daarna dezelfde export opnieuw laden → toast met "1 eerder verwijderd", het kaartje draagt het label, **Label wissen** verwijdert het label (PATCH `eerderVerwijderd:null`); het label bevat nergens naam of e-mail van een andere lead; (h) een `503` `opslag-storing` op PATCH toont de opslagmelding en het loginscherm verschijnt niet; (i) als beheerder staat er geen knop **Export laden**. Run → FAIL.
- [ ] **Step 2:** Implementeer de twee modules; alle tekst via `escHtml`/`textContent`; knoppen via `registreerActies` met `data-actie`-namen `sales-…`; kaartjes toetsenbord-bedienbaar (`maakActiveerbaar`).
- [ ] **Step 3: Run** `npx playwright test e2e/sales-import.spec.mjs --repeat-each=3` → PASS; `node --test` (SHELL-tests) groen.
- [ ] **Step 4: Verifieer in de browser** op `http://localhost:3333/?test` met de rolwisselaar → sales: export laden, ✕ en detail (screenshot).
- [ ] **Step 5: Commit** `feat(sales): scherm Te plannen met import, verwijderen en detail`.

---

## Task 15: Resultaat en Afgewerkt

**Files:**
- Create: `public/js/schermen/sales-resultaat.js`, `public/js/schermen/sales-afgewerkt.js`, `e2e/sales-resultaat.spec.mjs`
- Modify: `public/sw.js` (`SHELL`)
- Test: `e2e/sales-resultaat.spec.mjs`

**Interfaces:**
- Consumes: `geefResultaat`, `RESULTAAT_LABEL` (Task 3), `afgewerktRijen` (Task 8), `wijzig` (Task 10), `openSalesVenster` (Task 13).
- Produces: `export function openResultaat(leadId)` (vier grote knoppen + notitie; `'opnieuw'` → `status 'te-plannen'`, `planning` gewist, bezoek in `bezoeken`; de andere drie → `afgewerkt`), `export async function toon(view)` (Afgewerkt: filter resultaat en periode, rijen met resultaat, datum, notitie).

- [ ] **Step 1: Write the failing e2e:** een bevestigd bezoek → **Resultaat** → "Verkocht" + notitie → verdwijnt uit kalender/Te plannen en staat in Afgewerkt met datum en notitie; "Opnieuw langsgaan" → lead terug in "Nog in te plannen", historiek toont het bezoek; filter op "Offerte" en periode "Laatste 30 dagen"; het resultaat roept `PATCH /api/sales` aan (en niet vaker dan één keer bij dubbelklik: knoppen zijn tijdens de aanvraag uitgeschakeld). Run → FAIL.
- [ ] **Step 2:** Implementeer; de PATCH bevat enkel `velden` uit `geefResultaat` (server logt `'sales-resultaat'`).
- [ ] **Step 3: Run** `npx playwright test e2e/sales-resultaat.spec.mjs --repeat-each=3` → PASS.
- [ ] **Step 4: Commit** `feat(sales): resultaat ingeven en scherm Afgewerkt`.

---

## Task 16: Kalender, blokken en bezoekacties

**Files:**
- Create: `public/js/schermen/sales-kalender.js`, `public/js/schermen/sales-blok.js`, `public/js/schermen/sales-bezoek.js`, `e2e/sales-kalender.spec.mjs`
- Modify: `public/sw.js` (`SHELL`)
- Test: `e2e/sales-kalender.spec.mjs`

**Interfaces:**
- Consumes: Task 9 (`bouwKalenderItems`, `maandChips`, `tintVan`), uit `kalender-logica.js`: `timelineTopHeight`, `bepaalLanes`, `zichtbareDagen`, `maandRaster`, `TIMELINE_PX_PER_MIN`; uit `kalender.js` (nu geëxporteerd, Task 13): `computeTimelineRange`, `appendOffhoursBands`, `renderTimelineGutter`; `valideerBlok` (Task 3); `bevestig`, `terugNaarTePlannen` (Task 3); `openResultaat` (Task 15); `openLeadDetail(leadId, { focus })` (Task 14); `getHolidayName`.
- Produces: `export async function toon(view)` (Kalender), `export function openBlokVenster({ datum? })`, `export function openBezoekActies(leadId)` (bellen `tel:`, navigeren, **Bevestigen**, **Uur wijzigen** (= `openLeadDetail(leadId, { focus:'vast-uur' })`, besluit b: dag + uur van elk bezoek handmatig vastleggen of verleggen), **Terug naar te plannen**, **Resultaat**; een blok: verwijderen).

Gedrag: week- en maandweergave met ‹ › en "Vandaag" op `sales-data.gekozenDatum`; breed = tijdlijn met dezelfde uur-as en laan-indeling als de technieker-kalender, smal (`window.apparaat.indeling === 'smal'`) = gestapelde kaartjes per dag; voorgesteld lichter dan bevestigd; blokken (verlof/kantoor/afspraak) als gearceerd blok; knoppen **⚡ Plan deze week** (Task 17) en **➕ Blok** (datum, van/tot of "Hele dag", soort, omschrijving); navigeren via `geo:`/Google Maps zoals `navigate()` in `app.js` (eigen kleine functie, geen import uit `app.js`); alleen-lezen modus verbergt schrijfknoppen.

- [ ] **Step 1: Write the failing e2e:** met stub-leads (één voorgesteld, één bevestigd, één blok) tonen de dagkolommen de bezoeken met de juiste tint-klasse; klik op een voorgesteld bezoek → **Bevestigen** → blok wordt vol (`PATCH`, status `bevestigd`, `planning.vast:true`); **Uur wijzigen** op een bevestigd bezoek opent het detail bij "Vast uur afspreken" en een nieuw uur verplaatst het bezoek naar die dag/dat uur (nog steeds bevestigd); **Terug naar te plannen** → bezoek weg, lead staat in Te plannen; blok toevoegen "Verlof" hele dag dinsdag → 🔒-blok zichtbaar; hele-dag-blok verwijderen; maandweergave toont chips; viewport `mobile` toont de gestapelde lijst. De technieker-kalender-specs blijven groen. Run → FAIL.
- [ ] **Step 2:** Implementeer de drie modules (DOM-nodes met `addEventListener`/`textContent`, zoals `kalender.js`).
- [ ] **Step 3: Run** `npx playwright test e2e/sales-kalender.spec.mjs e2e/kalender.spec.mjs e2e/kalender-indelingen.spec.mjs --repeat-each=2` → PASS.
- [ ] **Step 4: Commit** `feat(sales): kalender, blokken en bezoekacties`.

---

## Task 17: "Plan deze week"

**Files:**
- Create: `public/js/schermen/sales-plan.js`, `e2e/sales-plannen.spec.mjs`
- Modify: `public/sw.js` (`SHELL`)
- Test: `e2e/sales-plannen.spec.mjs`

**Interfaces:**
- Consumes: `bouwPlanInvoer`, `verwerkUitkomst`, `maakReistijdenAdapter` (Task 4), `planWeek` (`public/js/planner.js`), `bouwResultaatRegels`, `weekStartVan` (Task 9), `wijzig`/`laadInstellingen` (Task 10), `getHolidayName`, `geocacheLookup`/`geocacheStore` (`kern/opslag.js`), `apiVerzoek`, `TEST_MODE`.
- Produces: `export async function planDezeWeek()` (aangeroepen door de knop in Task 16) en `export function toonPlanResultaat(regels)` (venster "Planningsresultaat").

Stappen: instellingen van de **getoonde** verkoper (centraal, via `laadInstellingen`; nooit `null`, zie `SALES_STANDAARD`), depot = geocode van `instellingen.startlocatie` (cache `geocacheLookup` → `/api/optimize` zoals `autoPlan`; in testmodus enkel de cache, anders `null`; zonder `startlocatie` is het depot `null` en meldt de toast "Geen startlocatie ingesteld: de ritten starten bij het eerste bezoek. De beheerder stelt die in."), `weekStart = localISO(weekStartVan(gekozenDatum()))` en `vandaag = localISO(nu)` (ISO-strings, zoals `bouwDagen` ze verwacht), `bouwPlanInvoer` met `feestdag: getHolidayName`, `planWeek`, `verwerkUitkomst`, **één** `wijzig({ leads: wijzigingen })` (`reden:'conflict'` → toast "Planning niet bewaard: de gegevens waren intussen gewijzigd. Plan opnieuw."; `reden:'opslag'` → de opslagmelding; in beide gevallen blijven de leads ongewijzigd), resultaatvenster met redenen (`redenTekst`) en waarschuwingen. Geen Zoho-aanroepen, geen mails. Voorbij week → melding zoals `autoPlan`; geen te plannen leads → toast "Geen leads om in te plannen".

- [ ] **Step 1: Write the failing e2e:** (a) "Plan deze week" met 8 te-plannen leads → resultaatvenster "Ingepland (n)", leads hebben status voorgesteld in de kalender, `PATCH /api/sales` precies één keer, geen `/api/matrix`/`/api/route`/`/api/propose`; (b) **vast uur (besluit b):** een lead die nog `te-plannen` was krijgt via het detail een vast uur (dinsdag 10:00); na "Plan deze week" én na een tweede keer blijft dat uur **ongewijzigd**, staat er geen ander bezoek overlappend en komt die lead niet in het resultaatvenster voor; hetzelfde voor een vast uur buiten de werkuren (07:00) en op een dag die al vol zit; een vast uur op een feestdag of in een andere week belemmert het plannen niet; (c) een lead zonder locatie (adres "bij de molen") komt onder "Niet ingepland" met "Adres niet gevonden"; (d) een bevestigd bezoek wordt nooit herschikt, een voorgesteld bezoek wel (opnieuw plannen na toevoegen van een verlofblok op zijn dag verplaatst hem of zet hem terug naar te plannen met reden in het venster); (e) een verkoper met `magAlleSales` die een andere verkoper bekijkt, ziet de knop niet (alleen-lezen); (f) zonder bewaarde instellingen (`instellingen: null`) plant hij op ma–vr 08:00–17:00 en toont de toast over de ontbrekende startlocatie. Run → FAIL.
- [ ] **Step 2:** Implementeer.
- [ ] **Step 3: Run** `npx playwright test e2e/sales-plannen.spec.mjs --repeat-each=3` en `node --test tests/sales-planner-adapter.test.mjs tests/planner.test.mjs` → PASS.
- [ ] **Step 4: Commit** `feat(sales): Plan deze week via het planner-brein`.

---

## Task 18: Route en kaart

**Files:**
- Create: `public/js/schermen/sales-route.js`, `public/js/schermen/sales-kaart.js`, `e2e/sales-route.spec.mjs`
- Modify: `public/sw.js` (`SHELL`)
- Test: `e2e/sales-route.spec.mjs`

**Interfaces:**
- Consumes: Task 9 (`bouwRouteStops`, `schatLegs`, `controleerKeten`, `routeHandtekening`), `KAART_LAGEN` (`route-kaart.js`, Task 13), `fmtSec`/`localISO`/`verschuifDatum` (`kern/tijd.js`), `apiVerzoek`, `TEST_MODE`.
- Produces:
```js
// sales-kaart.js
export function maakSalesKaart(containerEl) // -> { toon({ depot, stops: RouteStop[], polyline? }), invalideer(), vernietig() }  (eigen Leaflet-instantie op #sales-kaart; nummermarkers; ongeveer-stops gestippeld + popup "ongeveer — enkel postcode"; geen drukte-kleuring)
// sales-route.js
export async function toon(view)           // dagkiezer (‹ › + datum), lijst, kaart, samenvatting
```
Gedrag: stops van `gekozenDatum` op uur (geen slepen; de uren staan vast), per stop naam, plaats, uur, rit vanaf vorige stop; waarschuwing "⚠ haalt het volgende bezoek niet (+12 min)" via `controleerKeten`; route via `POST /api/route` met `{ waypoints, departAt }` (depot + stops met locatie), **in testmodus of bij een fout** de geschatte benen uit `schatLegs` (toast "Rit geschat"); de route wordt automatisch herberekend wanneer `routeHandtekening` verandert (bv. na een adres dat van postcode naar volledig adres ging), met een melding "Route herberekend". Zonder stops: "Geen bezoeken op deze dag".

- [ ] **Step 1: Write the failing e2e:** dag met 3 bezoeken (één postcode-only) → lijst in uurvolgorde, kaart met 3 markers waarvan 1 met klasse `sales-marker-ongeveer`; samenvatting toont aantal stops; testmodus roept `/api/route` niet aan; een adres invullen op een lead van die dag (postcode → volledig) → "Route herberekend" en de handtekening verandert; een bezoek dat de vorige niet haalt toont de waarschuwing; dag zonder bezoeken toont de lege tekst. Run → FAIL.
- [ ] **Step 2:** Implementeer; `L` enkel binnen functies (nooit op moduleniveau).
- [ ] **Step 3: Run** `npx playwright test e2e/sales-route.spec.mjs e2e/route-kaart.spec.mjs e2e/route.spec.mjs` → PASS (technieker-Route ongewijzigd).
- [ ] **Step 4: Commit** `feat(sales): route en kaart voor bezoeken`.

---

## Task 19: Rollen en isolatie

**Files:**
- Create: `e2e/sales-rollen.spec.mjs`
- Test: `e2e/sales-rollen.spec.mjs`, `tests/server-sales.test.mjs` (uitbreiden)

- [ ] **Step 1: Write the failing tests:** e2e: (a) rol sales ziet enkel de vier sales-tabs, `#view-tickets` is niet actief en er zijn geen verzoeken naar `/api/tickets`, `/api/inventaris`, `/api/rapport-archief`; (b) verkoper A met `magAlleSales:false`: geen verkoperkeuzelijst, `GET /api/sales?gebruiker=B` geeft 403 (de stub gebruikt de echte handler); (c) `magAlleSales:true`: keuzelijst met B, het scherm toont B's leads **alleen-lezen** (geen ✕, geen Export laden, geen Plan deze week); (d) rol beheerder: tabs "Sales: Te plannen …", keuzelijst, mag schrijven maar heeft geen knop **Export laden**; (e) rol technieker/planner: geen sales-tabs en `GET /api/sales` geeft 403 (`geen-recht`). Unit: uitbreiding van `tests/server-sales.test.mjs` met de volledige matrix (rol beheerder/planner/technieker/sales × methode GET/PATCH/DELETE × eigen/ander × met/zonder `magAlleSales`, plus `sales-import` enkel sales en `postcode`) als één tabelgedreven test via `metRol`, en een test dat **geen enkel antwoord** (GET, PATCH, 409, DELETE, import) `grafstenen` bevat.
- [ ] **Step 2: Run** → FAIL waar gedrag ontbreekt; corrigeer in de betreffende schermmodule (geen nieuwe bestanden).
- [ ] **Step 3: Run** `npx playwright test e2e/sales-rollen.spec.mjs --repeat-each=3` en `node --test tests/server-sales.test.mjs` → PASS.
- [ ] **Step 4: Commit** `test(sales): rollen en isolatie tussen verkopers`.

---

## Task 20: Afronding

**Files:**
- Modify: `CHANGELOG.md` (onder "Refactor-tak — nog niet uitgebracht", sectie **Added**), ledger.

- [ ] **Step 1:** Voeg bij **Added** één blok "Sales-planner" toe: wat een verkoper kan (export laden en samenvoegen, postcode of volledig adres, Plan deze week via het planner-brein, vast uur, voorgesteld/bevestigd, resultaat, Afgewerkt, 12 maanden bewaren), de nieuwe endpoints (`/api/sales`, `/api/sales-import`, `/api/postcode`, dagelijkse opruiming) en dat er geen Zoho, stock of mails bij komt. Geen versie-ophoging.
- [ ] **Step 2: Volledige verificatie:** `node --test` (aantal ≥ baseline uit Task 0 + nieuwe tests, alles groen), `npx playwright test --project=chromium` (idem), `git diff refactor..HEAD --stat -- public/index.html public/js/app.js public/js/schermen/rol-schil.js public/js/schermen/kalender.js public/js/schermen/route-kaart.js netlify/lib/rechten.js netlify/lib/testmodus.js` toont enkel de afgesproken regels (`app.js` ongewijzigd; `rol-schil.js` +2 regels; `index.html` +1 regel; 4 rijen in `rechten.js`; 1 regel in `testmodus.js`).
- [ ] **Step 3:** Voeg de open punten hieronder toe aan `docs/bugs-en-open-punten.md` (projectafspraak: nieuwe open punten meteen daar bijschrijven). Skill `opruimen-na-werk` (processen stoppen), `git status` schoon (behalve `.claude/launch.json`).
- [ ] **Step 4: Commit** `docs: changelog sales-planner (refactor-tak)`. Niet mergen; terugmelding aan Brent met de open punten hieronder.

---

## Open punten voor Brent (zonder blokkade)

1. **Koppelvlak:** vastgesteld tegen de logins-code, zie "Koppelvlak: vastgesteld tegen de logins-code"; de client-delen worden bij Task 12 stap 5 opnieuw getoetst.
2. **Weggeklikte lead die terugkomt (besloten, besluit a):** hij komt terug mét label "eerder verwijderd"; de verkoper beslist. Bewaard wordt enkel een SHA-256-hash (per verkoper, zonder geheim) 12 maanden: dat is pseudonimisering, geen versleuteling. Wil Brent dit strenger, dan kan de hash een HMAC met een serversleutel worden (dan werkt een sleutelwissel de grafstenen kwijt).
3. **Fallback-herkenning** op naam+voornaam+postcode voor leads zonder e-mail én bruikbare gsm is een uitbreiding op de spec (anders dubbels bij elke import).
4. **"Te plannen" toont ook ingeplande leads** (aparte groep "Ingepland"); letterlijk enkel "te plannen" tonen kan door de groep te verbergen.
5. **Herberekening na adreswijziging** = route en rittijden worden vernieuwd en conflicten gemeld; de uren worden pas verschoven bij een nieuwe "Plan deze week" (verschuiven op eigen houtje kan een bezoek ongevraagd wijzigen). Dit is zachter dan de spec-regel "uren van die dag herberekend".
6. **Blokken hebben in deze versie geen adres** (enkel tijdvak); het datamodel (`lat`/`lon`) en de adapter ondersteunen het al.
7. **Verkoper geblokkeerd of van rol veranderd:** zijn blob blijft bestaan (de dagelijkse opruiming loopt over alle `sales/*`-blobs en wist enkel afgewerkte leads en grafstenen na 12 maanden); lopende leads blijven staan. De keuzelijst toont enkel actieve verkopers, dus een beheerder kan die blob niet meer openen tot de gebruiker weer actief is.
8. **TomTom-parameters** (`structuredGeocode`) zijn volgens de documentatie gekozen maar nooit tegen de echte dienst getest; eerste echte oproep door Brent controleren.
9. **Sales-instellingen:** een verkoper heeft geen eigen instellingenscherm; startlocatie, werkuren en bezoekduur stelt de beheerder in (Beheer > Instellingen). Zonder instellingen gelden de standaardwaarden (ma–vr 08:00–17:00, laatste start 16:00, bezoek 60 min, geen depot).
10. **Postcodecache:** een mislukte cache-schrijfactie wordt enkel gelogd (afleidbare data), de enige plek die niet "fail closed" is.

## Dekking van de spec

Doel/beslissingen → Task 1–4, 14–17; exportformaat en inlezen → Task 1, 14; herkenning/samenvoegen → Task 2, 12; datamodel en locking → Task 3, 7, 11; serverfuncties → Task 11, 12; schermen Te plannen/Kalender/Route/Afgewerkt/Resultaat → Task 14–18; plannen en adapter → Task 4, 17; manueel vast uur → Task 3, 4, 14, 16, 17; terugkerende weggeklikte lead (besluit a) → Task 2, 5, 7, 8, 11, 12, 14; bewaartermijn (besluit c) → Task 5, 12; privacy (login, echt verwijderen, 12 maanden) → Task 5, 10–12, 19; activiteitenlog → Task 11, 12; gegevensbron-laag → "Keuze gegevensbron-laag", Task 10, 13; testen → in elke taak plus Task 19, 20.
