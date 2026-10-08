# Sales-planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elke verkoper krijgt een eigen planner: leads uit een JSON-export samenvoegen, een postcode of adres per lead bijhouden, door het bestaande planner-brein laten inplannen ("voorgesteld"), een vast uur kunnen vastleggen, bevestigen en een resultaat ingeven, zonder Zoho, stock of mails.

**Architecture:** Pure domeinlogica staat in `public/js/sales/` en wordt door client én server gebruikt (de server importeert ze relatief, zodat herkenning/validatie maar één bron heeft). Een dunne adapter zet leads om naar kandidaten van `planWeek` (`public/js/planner.js`, ongewijzigd). De sales-schermen zijn **aparte, kleinere schermen** die enkel de pure kalender-/route-helpers en CSS-klassen van de technieker-schermen hergebruiken (motivering onder "Keuze gegevensbron-laag"). Server: dunne functies in `netlify/functions/` met alle logica in `netlify/lib/sales-*.js`; één blob `sales/<gebruikerId>` per verkoper.

**Tech Stack:** vanilla ES-modules zonder bouwstap, `node --test` (Node 24), `@playwright/test` 1.63, Netlify Functions v2 + Blobs (`blitz-data`, `consistency: 'strong'`), TomTom (server-side), Leaflet (global `L`, al geladen).

**Spec:** `docs/superpowers/specs/2026-10-08-sales-planner-design.md`. Bindend koppelvlak: `docs/superpowers/plans/2026-10-08-koppelvlakken.md` (de logins-code bestaat nog niet; dit plan gebruikt de namen en signaturen er letterlijk uit). Verder gelezen: `2026-10-08-logins-beheer-design.md`, `2026-09-30-planner-brein-design.md`, `CLAUDE.md` (branchbeleid).

## Global Constraints

- **Takken (CLAUDE.md, koppelvlakken):** uitvoering in worktree `.claude/worktrees/refactor-sales`, tak `refactor-sales` vanaf `refactor` **na de merge van logins**. Nooit mergen of pushen naar `main`; nooit `--no-verify`; de pre-push-hook blokkeert refactor → main. Geen versie-ophoging, geen `CACHE_NAME`-wijziging, geen `package.json`-wijziging. Wijzigingen komen in `CHANGELOG.md` onder "Refactor-tak — nog niet uitgebracht" (laatste taak). Niet mergen.
- **Structuur (bindend, opdrachtgever):** in `public/index.html` en `public/js/app.js` komt **niets** bij behalve één minimale import/registratie-regel (hier: 1 `modulepreload`-regel in `index.html`, 2 regels in `app.js`). Nieuwe logica in kleine, gerichte modules: `public/js/sales/` (pure logica: import, herkenning, regels, adapter), `public/js/schermen/sales-*.js` (scherm) met `sales-*-logica.js` apart (zoals `kalender.js`/`kalender-logica.js`), server in `netlify/lib/sales-*.js` met dunne functies in `netlify/functions/`. Eén verantwoordelijkheid per bestand.
- **Technieker-gedrag ongewijzigd:** `kalender.js` en `route-kaart.js` mogen enkel het sleutelwoord `export` erbij krijgen (Task 13); `git diff -w` van die twee bestanden toont niets anders. Alle bestaande unit- en e2e-suites blijven ongewijzigd groen.
- **Koppelvlakken zijn bindend:** niet stil afwijken; een fout of gat wordt gemeld in de ledger/terugmelding (zie "Aannames en gaten").
- Spec-waarden: max. **500 leads** per bestand; bestand max. **2 MB**; afgewerkte bezoeken **12 maanden** bewaard, dan dagelijks automatisch gewist (ook uit `bezoeken`); ongedaan maken na verwijderen **5 s**; standaard bezoekduur `instellingen.bezoekDuurMin ?? 60`; `priority` voor elke lead `'medium'`; `inPlanningSinds` = `lead.geimporteerdOp`; een gsm met **minder dan 9 cijfers** (zoals `+32000000`) telt niet voor herkenning; herkenning = e-mail (lowercase, getrimd), anders gsm (enkel cijfers, `32` genormaliseerd).
- **Manueel vast uur (Brent):** de verkoper legt bij elke lead dag + uur vast, ook als die nog niet ingepland was; het brein plant daarrond en verschuift zo'n lead **nooit** (ook niet buiten werkuren of op een volle dag).
- **Testmodus (`?test`, `X-Blitz-Test: 1`):** nooit echte TomTom-, Zoho- of mailaanroepen. Server: `winkelNaam(req)` en `zorgVoorTestkopie(getStore)` uit `netlify/lib/testmodus.js`; geocoding geeft in testmodus deterministische nepcoördinaten zonder `fetch`. Client: `TEST_MODE` uit `kern/omgeving.js`; geen `/api/matrix`, `/api/route` of `/api/optimize` in testmodus.
- **Privacy/XSS:** leads zijn persoonsgegevens: elke weergave via `escHtml` (`kern/ui.js`) of `textContent`; het activiteitenlog bevat nooit namen, gsm of e-mail (enkel lead-id en aantallen); testfixtures bevatten uitsluitend verzonnen gegevens (bv. "Marie Janssens", "Tom Peeters", verantwoordelijke "Test Verkoper").
- Geen nieuwe npm-dependencies. Nederlandse namen en commentaar. Elk nieuw laadbaar bestand onder `public/js/` of `public/css/` komt in dezelfde commit in `SHELL` van `public/sw.js`.
- Tests: `node --test` (stijl `tests/planner.test.mjs`: `import test from 'node:test'`, `assert/strict`, `process.env.TZ = 'Europe/Brussels'` waar datums meespelen); e2e `npx playwright test` (project `chromium`, stijl `e2e/plan-week.spec.mjs`, vaste klok `VASTE_NU` = maandag 2026-10-05 09:00), geen `waitForTimeout`. Lokale verificatie: `http://localhost:3333/?test`.
- Shellcommando's altijd als `cd "<worktree>" && …`; vóór elke commit `git branch --show-current` == `refactor-sales`; `.claude/launch.json` nooit stagen; commit-trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Na elke taak: skill `opruimen-na-werk` (achtergebleven processen stoppen).

## Review Focus

De spec zwijgt over deze invoer; elke regel heeft een test in de genoemde taak.

1. **Lead zonder e-mail én zonder bruikbare gsm** (placeholder `+32000000`): zou bij elke herimport opnieuw als "nieuw" binnenkomen. Verwacht: één fallback-sleutel `naam+voornaam+postcode`; twee verschillende mensen met dezelfde placeholder-gsm worden nooit samengevoegd (Task 2).
2. **Hostile of kapotte exportbestanden:** HTML/script in naam of adres, >500 leads, >2 MB, geen JSON, `leads` geen array, lege lijst, leads die geen object zijn, extreem lange velden. Verwacht: duidelijke Nederlandse fout of overslaan, nooit een crash of ongeëscapete weergave (Task 1, 14).
3. **Postcode niet te vinden of TomTom valt uit:** `locatie` blijft `null`, het brein geeft reden `adres-niet-gevonden`, import en detail blijven werken en er wordt niets gecachet als "niet gevonden" (Task 4, 6, 11).
4. **Verwijderen tijdens het 5 s-venster en twee toestellen:** pagina sluiten of tweede toestel met oudere versie. Verwacht: een uitgestelde verwijdering gaat bij `pagehide` alsnog weg, een 409 herprobeert eenmaal op de verse stand en verliest geen wijziging (Task 10, 11).
5. **Vast uur dat botst of buiten de uren valt** (07:00, 18:30, feestdag, over een blok heen, twee vaste uren over elkaar): het brein verschuift het nooit; de detailpagina waarschuwt bij botsing en laat bevestigen; "Plan deze week" opnieuw geeft dezelfde vaste uren terug (Task 4, 8, 14, 17).

## Keuze gegevensbron-laag (tickets ↔ sales)

**Onderzoek (code van 2026-10-08):**
- `schermen/kalender.js` leest rechtstreeks `toestand.get('planning' | 'localEvents' | 'avExceptions' | 'allPending' | 'settings' | 'activeAssigneeFilter')`, bouwt kaartjes uit `stop.ticket.*` (`buildTicketCard`, regel 73), hangt aan 16 afhankelijkheden uit `initKalender(afh)` die allemaal ticket/Zoho-gedrag zijn (`bevestigUitplannen`, `openDetail`, `herOpenRapport`, `tijdslotLabelVoor`, …) en aan vaste DOM-id's uit `index.html:173-199` (`#week-grid`, `#kal-label`, `#btn-autoplan`, …).
- `schermen/route.js` en `route-kaart.js` zijn **singletons**: module-private `routeData`/`currentRouteDate`, één Leaflet-kaart op `#map`, lijst op `#route-list`, datum op `#plan-date`, vergrendeling via voorstelstatus/Zoho, en `applyRouteOrder` schrijft naar Zoho. De beheerder krijgt zowel ticket- als sales-schermen in één pagina: hergebruik van dezelfde DOM-id's zou botsen.
- Wél ticketvrij en direct bruikbaar: `schermen/kalender-logica.js` (`timelineTopHeight`, `bepaalLanes`, `zichtbareDagen`, `maandRaster`, `isBuitenWerkuren`, constanten), `kern/tijd.js`, `kern/ui.js`, `kern/api.js`, `kern/feestdagen.js`, `planner.js`/`planner-tijdlijn.js`, en de CSS-klassen `.day-col`, `.tl-wrap`, `.tl-block`, `.tl-hour-line`, `.tl-gutter`.

**Keuze: aparte, kleinere sales-schermen** (`sales-kalender.js`, `sales-route.js`, `sales-kaart.js`) die deze helpers en klassen hergebruiken. Een gegevensbron-laag *binnen* kalender/route zou ~25 plekken in twee bestanden van 800–900 regels moeten raken en elk daarvan kan het technieker-gedrag breken; de aparte schermen raken die bestanden niet. Minimale wijziging aan bestaande bestanden: `export` voor `computeTimelineRange`, `appendOffhoursBands`, `renderTimelineGutter` in `kalender.js` en `KAART_LAGEN` in `route-kaart.js` (zelfde uur-as en kaartlagen, geen gedragswijziging).

**De laag zelf (exacte interface), `schermen/sales-data.js` is de énige bron van de sales-schermen; `kern/toestand.js` en tickets komen er nooit in:**

```js
salesToestand() -> { gebruikerId: string|null, versie: number, leads: Lead[], blokken: Blok[], instellingen: Instellingen|null, gekozenDatum: 'YYYY-MM-DD', uitgesteld: Set<string> /* lead-id's in het 5 s-venster */ }
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
| `netlify/lib/sales-geocode.js`, `sales-postcode.js`, `sales-locatie.js` | TomTom + postcodecache + locatie bepalen |
| `netlify/lib/sales-opslag.js`, `sales-wijzig.js` | blob `sales/<id>` met versie; patch toepassen |
| `netlify/lib/sales-toegang.js`, `sales-acties.js`, `sales-import-server.js`, `sales-opruimen.js` | server-logica per actie |
| `netlify/functions/sales.js`, `sales-import.js`, `postcode.js`, `sales-opruimen.js` | dunne functies |
| `public/js/schermen/sales-data.js` | client-gegevenslaag (zie boven) |
| `public/js/schermen/sales-schil.js`, `sales-venster.js`, `sales-verkoper.js`, `sales-registratie.js` | view-container, modaal venster, verkoperkeuze, tabregistratie |
| `public/js/schermen/sales-lijst(-logica).js`, `sales-detail(-logica).js`, `sales-resultaat.js` | Te plannen, detail, resultaat, Afgewerkt |
| `public/js/schermen/sales-kalender(-logica).js`, `sales-blok.js`, `sales-bezoek.js` | kalender, blokken, bezoekacties |
| `public/js/schermen/sales-plan(-logica).js` | "Plan deze week" (schil rond de adapter) |
| `public/js/schermen/sales-route(-logica).js`, `sales-kaart.js` | route en kaart |
| `public/css/sales.css` | stijlen (`sales-`-prefix, tinten) |
| `tests/sales-*.test.mjs`, `tests/server-sales*.test.mjs`, `tests/geheugen-store.mjs`, `e2e/sales-*.spec.mjs`, `e2e/sales-hulp.mjs`, `e2e/fixtures/sales-export.json` | tests |

## API-contract (nieuw)

- `GET /api/sales[?gebruiker=<id>]` → `200 { gebruikerId, versie, leads, blokken }`.
- `PATCH /api/sales[?gebruiker=<id>]` body `{ versie, leads?: [{ id, velden }], blokken?: { toevoegen?: [Blok zonder id], wijzig?: [{ id, velden }], verwijder?: [id] }, aanvullen?: true }` → `200 { gebruikerId, versie, leads, blokken, open }` | `400 { error, fouten }` | `409 { error: 'Versiematch mislukt', serverVersie, data }` (zoals `afspraken.js`). `open` = aantal leads met postcode maar nog zonder `locatie`.
- `DELETE /api/sales?lead=<id>[&gebruiker=<id>]` → `200 { versie }` | `404`.
- `POST /api/sales-import` body `{ export: <object> }` (enkel eigen blob) → `200 { versie, samenvatting: { nieuw, alAanwezig, adresNakijken, overgeslagen }, export: { verantwoordelijke, geexporteerdOp, aantal, statussen }, open }` | `400 { error }`.
- `GET /api/postcode?pc=3640` → `200 { pc, lat, lon, gemeente }` | `400` | `404`.
- Rollen: `sales` en `beheerder` (import: enkel `sales`); schrijvende aanroepen met `schrijven: true` (header `X-Blitz`). Activiteitenlog: `'sales-import'`, `'sales-lead-verwijderd'`, `'sales-resultaat'`.

## Aannames en gaten in het koppelvlakdocument

1. `registreerTabs(rol, tabs)`: het document zegt niet of een tweede aanroep voor dezelfde rol **aanvult** of vervangt, noch wie de view-container aanmaakt/activeert (`laad()` krijgt geen container). Aanname: aanvullen; `laad()` zorgt zelf voor `<div class="view" id="view-<tab.id>">` in `#hoofdinhoud` (`sales-schil.js`) en de navigatie zet `.active` zoals `setTab`. Task 12 controleert dit tegen de gemergde `kern/navigatie.js` en past enkel de adapter in `sales-registratie.js` aan.
2. Antwoordvorm van `GET /api/instellingen` (aanname `{ instellingen, versie }`, de client leest `data.instellingen ?? data`), `GET /api/auth-ik` en `GET /api/gebruikers?rol=sales` staat niet in het document; Task 12 leest de gemergde code.
3. `logActiviteit({ gebruiker, … })`: vorm van `gebruiker` voor systeemacties (opruiming) ontbreekt; aanname `{ id: 'systeem', naam: 'Systeem (opruiming)' }`.
4. In testmodus bevat het blob `gebruikers` de testgebruikers niet: `sales-toegang.js` aanvaardt daarom `test-sales` zonder opzoeking (aanname id = `test-sales`).
5. Het document zegt niet hoe e2e de rol kiest; Task 12/19 volgen de helper die het logins-plan in `e2e/helpers.mjs` toevoegde.
6. Server importeert pure modules uit `../../public/js/sales/` (geen precedent in de repo). Lokaal werkt dat (dev-server en `node --test`); het bundelen door Netlify (esbuild volgt relatieve imports) moet bij de eerste deploy-preview bevestigd worden. Terugval: de vier modules kopiëren naar `netlify/lib/` met een test die de twee bronnen vergelijkt.

---

## Task 0: Worktree

**Files:** geen.

- [ ] **Step 1:** Vanuit elke worktree: `git worktree add "C:/Users/BRENT/OneDrive - Hertsens Transport (Walding)/Claude-Projects/blitz-planning/.claude/worktrees/refactor-sales" -b refactor-sales refactor`. Is logins al op `refactor` gemerged, dan bevat de tak die code; zo niet, dan mogen Task 1–10 alvast starten en wordt vóór Task 11 `git merge refactor` uitgevoerd.
- [ ] **Step 2:** In de nieuwe worktree: `npm ci` (geen nieuwe dependencies), `git branch --show-current` == `refactor-sales`.
- [ ] **Step 3:** Baseline vastleggen in de ledger (`.superpowers/sdd/2026-10-08-sales-planner/progress.md`, niet in git): `node --test` en `npx playwright test --project=chromium` (aantal groen).
- [ ] **Step 4 (preflight, vóór Task 11):** controleer dat bestaan: `netlify/lib/auth.js` (`vereisGebruiker`, `weigeringV2`), `netlify/lib/activiteit.js`, `netlify/lib/gebruikers.js`, `kern/sessie.js`, `kern/navigatie.js`. Ontbreekt er één: stop en meld het.

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
`adresSoort`: `'volledig'` als `lead.straat` en `lead.locatie?.bron === 'adres'`; `'nakijken'` als `lead.adresTekst`, of `lead.straat` zonder adres-locatie, of geen `lead.postcode`; anders `'postcode'`.

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

## Task 2: Herkenning en samenvoegen **[los van logins]**

**Files:**
- Create: `public/js/sales/herkenning.js`
- Test: `tests/sales-herkenning.test.mjs`

**Interfaces:**
- Consumes: `normaliseerEmail`, `normaliseerGsm` (Task 1), `adresSoort` (Task 1).
- Produces:
```js
export function herkenningssleutels(lead) // -> string[]: 'e:<email>', 'g:<32…>' ; enkel als beide ontbreken: 'n:<voornaam>|<naam>|<postcode>' (lowercase)
export function voegSamen(bestaande /*Lead[]*/, nieuwe /*ImportLead[]*/, { nu /*ISO*/, nieuwId /*() => string*/, bronExport /*{ verantwoordelijke, geexporteerdOp }*/ })
  // -> { leads: Lead[], toegevoegd: Lead[], samenvatting: { nieuw, alAanwezig, adresNakijken } }   (muteert de invoer niet)
```
Nieuwe `Lead`: `{ id, voornaam, naam, gsm, email, postcode, gemeente, straat, huisnr, adresTekst, locatie: null, status: 'te-plannen', bezoeken: [], geimporteerdOp: nu, bronExport }` (spec-datamodel; `notitie`/`duurMin`/`planning`/`resultaat` ontbreken tot ze ingevuld worden).
Bestaande lead blijft ongewijzigd, behalve: lege contactvelden (`voornaam`, `naam`, `gsm`, `email`) worden aangevuld; heeft de bestaande lead enkel een postcode en brengt de import een volledig adres, dan wordt het adres bijgewerkt (`straat`, `huisnr`, `gemeente`, `locatie: null` zodat de server opnieuw geocodeert). Planning, status, notitie, duur, resultaat en bezoeken blijven altijd.

- [ ] **Step 1: Write the failing tests:**
  - zelfde e-mail met andere hoofdletters/spaties → "al aanwezig"; zelfde gsm in andere schrijfwijze (`+32 478 12 34 56` vs `0478123456`) → al aanwezig; twee leads met placeholder-gsm `+32000000` en verschillende naam/e-mail → **twee** nieuwe (Review Focus 1); twee leads zonder e-mail en zonder bruikbare gsm met gelijke naam+voornaam+postcode → tweede is al aanwezig, andere postcode → nieuw; dubbele lead binnen hetzelfde bestand → één nieuw.
  - samenvoegen behoudt `planning`, `status:'bevestigd'`, `notitie`, `duurMin`, `resultaat`, `bezoeken` van de bestaande lead; vult lege `gsm` aan; postcode-only → volledig adres upgrade zet `locatie:null`; een bestaand volledig adres wordt nooit door een postcode overschreven.
  - lead die niet meer in de export staat blijft staan; invoer-arrays onveranderd (diepe gelijkheid vóór/na).
  - samenvatting `{ nieuw:2, alAanwezig:1, adresNakijken:1 }` telt "nakijken" enkel onder de nieuwe; `bronExport` en `geimporteerdOp` staan op nieuwe leads.
  - een eerder verwijderde lead (niet meer in `bestaande`) komt bij herimport opnieuw als nieuw binnen (vastgelegd gedrag, zie open punt 2).
- [ ] **Step 2: Run** `node --test tests/sales-herkenning.test.mjs` → FAIL.
- [ ] **Step 3: Implement** met een `Map<sleutel, lead>` over de bestaande leads (O(n)); sleutels van een nieuwe lead worden na toevoegen in de map gezet (dubbels in het bestand).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): herkenning en samenvoegen van leads`.

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
export const WIJZIGBARE_VELDEN = ['notitie','duurMin','straat','huisnr','postcode','gemeente','adresTekst','status','planning','resultaat','bezoeken'];
export function isVast(lead)                       // planning?.vast === true || status === 'bevestigd'
export function zetVastUur(lead, { datum, start }) // -> Lead: planning {datum,start,vast:true}, status 'bevestigd'
export function bevestig(lead)                     // voorgesteld -> bevestigd, planning.vast = true
export function terugNaarTePlannen(lead)           // planning verwijderd, status 'te-plannen'
export function geefResultaat(lead, { soort, notitie, nu })
  // soort 'opnieuw': bezoeken + { datum, resultaat:'opnieuw', notitie?, op }, status 'te-plannen', planning weg
  // 'offerte'|'verkocht'|'geen-interesse': idem + resultaat { soort, notitie?, op }, status 'afgewerkt', planning weg; bezoek.datum = planning.datum ?? dag van nu
export function valideerLead(lead)                 // -> string[] (invarianten: voorgesteld/bevestigd => planning {datum 'YYYY-MM-DD', start 'HH:MM'}; bevestigd => vast true; te-plannen => geen planning; afgewerkt => resultaat, geen planning; postcode /^\d{4}$/; duurMin ≥ 15 of afwezig)
export function pasLeadToe(lead, velden)           // -> { lead, adresGewijzigd: boolean, fouten: string[] }  (onbekend veld, bv. 'locatie' of 'email', => fout 'Veld niet toegelaten: x'; adresvelden gewijzigd => locatie: null)
// blok-regels.js
export const BLOK_SOORTEN = ['verlof','kantoor','afspraak'];
export function isHeleDag(blok)                    // start '00:00' en eind '23:59' of '24:00'
export function valideerBlok(blok)                 // -> { fout } | { blok }  (datum, 'HH:MM', start < eind, soort, omschrijving ≤ 200 tekens)
// toegang.js
export function magLezen(gebruiker, doelId)        // sales: eigen, of ander bij magAlleSales; beheerder: iedereen
export function magSchrijven(gebruiker, doelId)    // sales: enkel eigen; beheerder: iedereen
export function kanVerkoperKiezen(gebruiker)       // beheerder of sales met magAlleSales
```
Toelaatbare statusovergangen in `pasLeadToe` (bron → doel): `te-plannen → voorgesteld|bevestigd|afgewerkt`, `voorgesteld → te-plannen|bevestigd|afgewerkt`, `bevestigd → te-plannen|afgewerkt`, `afgewerkt → te-plannen` (verkeerde klik herstellen); anders fout.

- [ ] **Step 1: Write the failing tests:** per functie het genoemde gedrag; `geefResultaat('opnieuw')` behoudt eerdere `bezoeken` en voegt er één toe, `resultaat` van een eerdere afronding wordt gewist; ongeldig `soort` gooit; `zetVastUur` met datum `'2026-13-40'` of uur `'25:00'` geeft een fout via `valideerLead`; `pasLeadToe({ locatie:… })`, `{ email:… }`, `{ id:… }` geven een fout en laten de lead ongewijzigd; adresvelden wijzigen zet `locatie:null` en `adresGewijzigd:true`, enkel `notitie` wijzigen niet; `valideerBlok` weigert eind ≤ start, soort `'vakantie'`, datum `'2026-02-30'`; `isHeleDag` voor `'00:00'`–`'23:59'` en `'24:00'`; toegang: sales A → B zonder vinkje: lezen `false`; met `magAlleSales`: lezen `true`, schrijven `false`; beheerder: beide `true`; `kanVerkoperKiezen` voor planner/technieker `false`.
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
  // instellingen: { vanTijd, laatsteStart, maxPerDag, maxReistijdMin, werkdagen, bezoekDuurMin? }; feestdag: (datum) => string|null
  // -> { invoer /* voor planWeek */, vrijgegeven: string[] /* lead-id's */ }
export function verwerkUitkomst({ uitkomst, leads, vrijgegeven })
  // -> { wijzigingen: [{ id, velden }], geplaatst: number, nietGepland: [{ leadId, reden }], waarschuwingen }
export function maakReistijdenAdapter({ apiVerzoek, testModus })
  // -> async (van, naar, vertrekIso) => Map<id, minuten|null>; gooit nooit; testModus: haversine × 1,3 zonder aanroep
```
Regels: kandidaten = leads met `status === 'te-plannen'` die niet `isVast` zijn, plus `voorgesteld`-leads met `planning.datum` binnen `weekStart..weekStart+6` én ≥ `vandaag` (die staan in `vrijgegeven` en mogen herschikt worden). `bestaandPerDag[datum]` = alle leads met `isVast(lead)` en `planning` op een dag in de planningsdagen: `{ id, uur: planning.start, duurMin, lat, lon }`. `dagen` via `bouwDagen({ weekStart, vandaag, werkdagen, uitgesloten, voorkeuren: [] })`; `uitgesloten(d)` = `feestdag(d)` of een blok met `isHeleDag` op `d`. Blokken met `lat` en `lon` → `eigenAfspraken[datum]` (`{ uur: start, duurMin: eind − start, lat, lon }`), de rest → `blokkeringen[datum]` (`{ van: start, tot: eind }`). `klant: {}`. `verwerkUitkomst`: geplaatst → `{ id, velden: { status:'voorgesteld', planning:{ datum, start: verwachteAankomst, vast:false } } }`; een vrijgegeven lead die niet opnieuw geplaatst werd → `{ status:'te-plannen', planning:null }`; een vaste lead komt **nooit** in `wijzigingen` voor.

- [ ] **Step 1: Write the failing tests** (verzonnen coördinaten rond Hasselt/Genk/Antwerpen; `nepReistijden` = haversine × 1,3 zoals `tests/planner.test.mjs`):
  - `leadNaarKandidaat`: `duurMin` = `lead.duurMin` → `standaardDuurMin` → 60; `locatie:null` → `lat:null, lon:null`; `inPlanningSinds` = `geimporteerdOp`.
  - `bouwPlanInvoer` met leads A (te-plannen), B (voorgesteld deze week), C (bevestigd dinsdag 10:00), D (`planning.vast:true`, status `te-plannen`), E (afgewerkt), F (voorgesteld volgende week), G (voorgesteld op een dag vóór `vandaag`): kandidaten `[A, B]`, `vrijgegeven == ['B']`, `bestaandPerDag['2026-10-06']` bevat C met `uur:'10:00'`, D staat op zijn dag, E/F/G nergens.
  - blokken: hele-dag verlof haalt de dag uit `invoer.dagen`; bereikblok `13:00–14:00` → `blokkeringen`; blok met `lat/lon` → `eigenAfspraken`; feestdag valt weg uit `dagen`.
  - **Integratie met de echte `planWeek`:** vaste lead 10:00–11:00 op dinsdag + 6 kandidaten → de vaste lead komt niet in `geplaatst`, geen geplaatste kandidaat overlapt 10:00–11:00, `verwerkUitkomst(...).wijzigingen` bevat de vaste lead niet. Herhaal met vast uur `07:00` en `18:30` (buiten werkuren/na laatste start): blijft vast en de kandidaten plannen eromheen. Pas de wijzigingen toe en plan opnieuw → de vaste uren zijn identiek.
  - lead zonder `locatie` → in `nietGepland` met reden `'adres-niet-gevonden'`; vrijgegeven lead zonder plaats → `{ status:'te-plannen', planning:null }`; waarschuwingen van het brein worden doorgegeven.
  - `maakReistijdenAdapter`: `testModus:true` roept `apiVerzoek` nooit aan en geeft haversine × 1,3; anders `/api/matrix` met `{ origin, destinations, departAt }` en seconden → minuten; `!ok` of een gooiende `apiVerzoek` → alle waarden `null` zonder te gooien.
- [ ] **Step 2: Run** `node --test tests/sales-planner-adapter.test.mjs` → FAIL.
- [ ] **Step 3: Implement** de vier functies; geen DOM, geen globals. De adapter roept `planWeek` zelf niet aan (dat doet Task 17).
- [ ] **Step 4: Run** → PASS; draai ook `node --test tests/planner.test.mjs tests/planner-werkuren.test.mjs` (onaangeroerd groen).
- [ ] **Step 5: Commit** `feat(sales): planner-adapter van leads naar kandidaten`.

---

## Task 5: Opruimregel (12 maanden) **[los van logins]**

**Files:**
- Create: `netlify/lib/sales-opruimen.js` (alleen de pure regel in deze taak; `ruimAllesOp` volgt in Task 12)
- Test: `tests/sales-opruimen.test.mjs`

**Interfaces:**
- Produces:
```js
export const BEWAAR_MAANDEN = 12;
export function laatsteBezoekDatum(lead) // -> 'YYYY-MM-DD' | null: max van bezoeken[].datum en resultaat.op (dag); anders geimporteerdOp (dag)
export function ruimOp(data /*{ leads, blokken }*/, nu /*ISO*/) // -> { data, gewist: string[] /* lead-id's */ }
```
Een lead wordt gewist als `status === 'afgewerkt'` én het laatste bezoek **meer dan** 12 kalendermaanden voor `nu` ligt (de lead verdwijnt volledig, dus ook zijn `bezoeken`).

- [ ] **Step 1: Write the failing tests:** afgewerkt met laatste bezoek 12 maanden en 1 dag geleden → gewist; precies 12 maanden (zelfde dag) → blijft; afgewerkt met recent bezoek maar oud eerste bezoek → blijft; `te-plannen`-lead met enkel oude `bezoeken` (opnieuw langsgaan) → blijft; `resultaat.op` nieuwer dan `bezoeken` telt mee; schrikkeldag `2026-02-28` vs `2025-02-28`; lege data; invoer niet gemuteerd; `blokken` ongewijzigd.
- [ ] **Step 2: Run** `node --test tests/sales-opruimen.test.mjs` → FAIL.
- [ ] **Step 3: Implement** met `Date.UTC`-berekening (`setUTCMonth(-12)` op `nu`, vergelijken op `'YYYY-MM-DD'`-strings).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): opruimregel voor afgewerkte leads na 12 maanden`.

---

## Task 6: Geocoding, postcodecache en locatie **[los van logins]**

**Files:**
- Create: `netlify/lib/sales-geocode.js`, `netlify/lib/sales-postcode.js`, `netlify/lib/sales-locatie.js`
- Test: `tests/server-sales-geocode.test.mjs`, `tests/server-sales-locatie.test.mjs`, `tests/geheugen-store.mjs` (testhulp, geen eigen test)

**Interfaces:**
- Consumes: `adresTekstVoorGeocoding` (Task 1), `maakNepFetch` (`tests/nep-fetch.mjs`).
- Produces:
```js
// tests/geheugen-store.mjs
export function maakGeheugenStore(initieel = {}) // -> store met get(k,{type:'json'}), set, setJSON, delete, list() (stijl maakWinkels in tests/server-annuleer-confirm.test.mjs)
// sales-geocode.js
export async function geocodeAdres(adres, { fetch, sleutel, testModus, wacht }) // -> { lat, lon } | null; gooit nooit; 429: 3 pogingen met backoff (`wacht(ms)`)
export async function geocodePostcode(pc, { fetch, sleutel, testModus, wacht }) // -> { lat, lon, gemeente } | null
// sales-postcode.js
export const isPostcode = pc => /^\d{4}$/.test(pc);
export async function zoekPostcode(store, pc, deps) // -> { lat, lon, gemeente } | null; leest/schrijft blob 'postcode-cache' ({ [pc]: { lat, lon, gemeente } }); 'niet gevonden' wordt NIET gecachet
export async function zoekPostcodes(store, lijst, { nu, maxTijdMs = 15000, parallel = 5, ...deps }) // -> { gevonden: { [pc]: {…} }, open: string[] }; één cache-write per aanroep
// sales-locatie.js
export async function bepaalLocatie(lead, { store, ...deps }) // -> { lat, lon, bron:'adres'|'postcode' } | null  (volledig adres -> geocodeAdres; mislukt of postcode-only -> zoekPostcode; niets -> null)
export async function vulLocatiesAan(leads, { store, nu, maxTijdMs, ...deps }) // -> { leads, open: number }  (leads met postcode zonder locatie; vult ook lead.gemeente aan als die leeg is)
```
TomTom: adres via `https://api.tomtom.com/search/2/geocode/<encodeURIComponent(adres)>.json?key=<sleutel>&countrySet=BE&limit=1`; postcode via `https://api.tomtom.com/search/2/structuredGeocode.json?key=<sleutel>&countryCode=BE&postalCode=<pc>&limit=1`, gemeente = `results[0].address.municipality`. Testmodus: deterministische nepcoördinaten in de Belgische bounding box uit een hash van de invoer, `fetch` wordt nooit aangeroepen.

- [ ] **Step 1: Write the failing tests** (nep-fetch; nooit het netwerk):
  - `geocodeAdres`: URL bevat de geëncodeerde tekst, `countrySet=BE` en de sleutel → `{ lat, lon }`; geen resultaten → `null`; netwerkfout → `null`; 429 daarna 200 → resultaat na 2 pogingen; `testModus` → deterministisch (tweemaal hetzelfde) en `fetch` 0×.
  - `geocodePostcode`: URL bevat `postalCode=3640` en `countryCode=BE`, gemeente uit het antwoord.
  - `zoekPostcode`: cache-hit → 0 fetches; miss → 1 fetch + blob `postcode-cache` bevat de postcode; `'36'`/`'abcd'` → `null` zonder fetch; niet gevonden → `null` en **niet** in de cache (Review Focus 3).
  - `zoekPostcodes`: 12 unieke postcodes met `parallel:5` → nooit meer dan 5 gelijktijdig; `maxTijdMs` bereikt (klok via `nu`) → de rest in `open`; één cache-write.
  - `bepaalLocatie`: volledig adres → `bron:'adres'`; geocode faalt → terugval op het postcode-middelpunt (`bron:'postcode'`); enkel postcode → `bron:'postcode'`; zonder postcode → `null`.
  - `vulLocatiesAan`: leads met `locatie` blijven; `open` telt wat het budget niet haalde of niet gevonden werd.
- [ ] **Step 2: Run** `node --test tests/server-sales-geocode.test.mjs tests/server-sales-locatie.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** `sleutel` is een parameter (`process.env.TOMTOM_API_KEY` leest alleen de functie). Backoff zoals `optimize.js` (`attempt * 400`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): geocoding, postcodecache en locatiebepaling`.

---

## Task 7: Opslag en wijzigingen **[los van logins]**

**Files:**
- Create: `netlify/lib/sales-opslag.js`, `netlify/lib/sales-wijzig.js`
- Test: `tests/server-sales-opslag.test.mjs`

**Interfaces:**
- Consumes: `pasLeadToe`, `valideerLead` (Task 3), `valideerBlok` (Task 3), `maakGeheugenStore` (Task 6).
- Produces:
```js
// sales-opslag.js
export const salesSleutel = gebruikerId => `sales/${gebruikerId}`;
export async function leesSales(store, gebruikerId) // -> { versie, leads, blokken } ({ versie:0, leads:[], blokken:[] } als leeg)
export async function schrijfSales(store, gebruikerId, data, verwachteVersie) // -> { ok:true, data: {…, versie: verwacht+1, bijgewerkt} } | { ok:false, conflict:true, data: huidige }
// sales-wijzig.js
export function pasWijzigingToe(data, body, { nu, nieuwBlokId }) // body = { leads?, blokken? } -> { data, adresGewijzigd: string[], resultaten: [{ leadId, soort }], fouten: string[] }; bij elke fout blijft `data` ongewijzigd (alles of niets)
```

- [ ] **Step 1: Write the failing tests:** leeg blob; schrijven met juiste versie → `versie + 1`; foute versie → `conflict` met de huidige data; sleutel is `sales/<id>`; `pasWijzigingToe`: lead-velden toegepast via `pasLeadToe`; onbekende lead-id → fout; een fout in één van twee leads → niets toegepast; adreswijziging geeft de lead-id in `adresGewijzigd`; een patch die `resultaat` nieuw zet geeft `{ leadId, soort }` in `resultaten`; blokken toevoegen krijgt `nieuwBlokId()`, wijzigen en verwijderen werken, ongeldig blok (Task 3) → fout; ongeldige statusovergang → fout.
- [ ] **Step 2: Run** `node --test tests/server-sales-opslag.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** Versiecontrole in dezelfde stijl als `netlify/functions/afspraken.js` (lezen, vergelijken, `setJSON`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): opslag per verkoper en wijzigingen toepassen`.

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
export function kaartInfo(lead)                                      // -> { titel:'Marie Janssens', plaats, adresLabel:'enkel postcode'|'volledig adres'|'adres nakijken', vastUur: 'ma 12 okt 10:00'|null, telHref:'tel:…'|null, mailHref:'mailto:…'|null, status }
export function afgewerktRijen(leads, { resultaat = '', periode = 'alles', nu })  // periode '30d'|'3m'|'12m'|'alles'; -> [{ leadId, naam, datum, soort, label, notitie }] nieuwste eerst (laatste bezoek)
// sales-detail-logica.js
export function valideerDetail(invoer)                               // { straat, huisnr, postcode, gemeente, notitie, duurMin } -> { fout } | { velden }
export function valideerVastUur({ datum, start, vandaag })           // -> { fout } | { ok: true }
export function vindBotsingen({ leads, blokken, datum, start, duurMin, exceptId, standaardDuurMin }) // -> [{ soort:'lead'|'blok', omschrijving, start, eind }]
```
Teksten: postcode fout `'Postcode bestaat uit 4 cijfers'`; straat zonder huisnr (of omgekeerd) `'Vul straat én huisnummer in'`; duur `'Minimale bezoekduur is 15 minuten'`; vast uur in het verleden `'Kies een datum vanaf vandaag'`; uur `'Geef het uur als UU:MM'`. Lege `duurMin` → `null` (standaard van de verkoper). `telHref` enkel bij ≥ 9 cijfers (placeholder-gsm geeft `null`).

- [ ] **Step 1: Write the failing tests:** per functie het genoemde gedrag, onder meer: zoeken `'kin 36'` vindt een lead uit Kinrooi (3640); gebied `'36'`; `groepeerLijst` sorteert wachttijd-eerst en laat `afgewerkt` weg; `kaartInfo` voor placeholder-gsm → `telHref:null`; `afgewerktRijen` met periode `'30d'` en vaste `nu`; `valideerDetail` alle foutteksten + geldige invoer → `velden` (lege `duurMin` → `null`); `vindBotsingen` vindt een overlappende vaste lead én een blok, negeert `exceptId` en niet-vaste (voorgesteld) leads.
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
export async function laadSales({ gebruikerId } = {})      // GET /api/sales[?gebruiker=] -> zet toestand; gooit niet (zet { fout } terug via return { ok:false, status })
export async function laadInstellingen({ gebruikerId } = {}) // GET /api/instellingen[?gebruiker=] -> instellingen ({ instellingen, versie } of kaal object) in de toestand
export async function wijzig(patch /*{ leads?, blokken?, aanvullen? }*/) // PATCH met toestand.versie; 409 -> server-stand overnemen en EENMAAL opnieuw sturen; -> { ok, reden?: 'conflict'|'http'|'netwerk', fouten? }
export async function importeer(exportObject)               // POST /api/sales-import -> { ok, samenvatting?, export?, fout? }; herlaadt daarna de toestand
export function verwijderMetOngedaan(leadId, { wacht = 5000, setTimeoutFn, clearTimeoutFn } = {}) // lead meteen uit de weergave (toestand.uitgesteld), na `wacht` ms DELETE; -> { ongedaan() }
export function spoelUitgesteld({ keepalive = true } = {})   // verstuurt openstaande verwijderingen meteen (voor 'pagehide')
export function gekozenDatum(), zetGekozenDatum(iso)
```
Een 404 op DELETE telt als geslaagd. Een mislukte DELETE zet de lead terug in de weergave en geeft `{ ok:false }` aan de oproeper via `onSalesWijziging`.

- [ ] **Step 1: Write the failing tests** (`zetFetch` met een nep die de verzoeken opneemt; vaste timers via `mock.timers`):
  - `laadSales` zonder/met `gebruikerId` roept de juiste URL aan en vult `leads`, `blokken`, `versie`.
  - `wijzig`: stuurt `{ versie, … }`; bij `409` met `data` wordt de server-stand overgenomen en de patch **eenmaal** opnieuw gestuurd met de nieuwe versie (veld-patches per lead-id gaan niet verloren); tweede 409 → `{ ok:false, reden:'conflict' }`; `400` met `fouten` → doorgegeven; netwerkfout → `reden:'netwerk'` (Review Focus 4).
  - `verwijderMetOngedaan`: na 4 999 ms nog geen DELETE; `ongedaan()` vóór 5 000 ms → nooit een DELETE en de lead is terug in `uitgesteld`-vrije weergave; na 5 000 ms → precies één `DELETE /api/sales?lead=<id>`; `spoelUitgesteld()` verstuurt openstaande deletes onmiddellijk met `keepalive`; mislukte DELETE → lead terug zichtbaar.
  - `onSalesWijziging` meldt af correct.
- [ ] **Step 2: Run** `node --test tests/sales-data.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** Module-privé toestand en abonneelijst (eigen, klein; **geen** sleutels toevoegen aan `kern/toestand.js`). Geen import van `kern/sessie.js` (maakt de laag in node testbaar).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(sales): client-gegevenslaag met versiecontrole en uitgestelde verwijdering`.

---

## Task 11: Server — toegang, acties en functies `sales` en `postcode`

**Voorwaarde:** logins gemerged (Task 0 preflight).

**Files:**
- Create: `netlify/lib/sales-toegang.js`, `netlify/lib/sales-acties.js`, `netlify/functions/sales.js`, `netlify/functions/postcode.js`
- Modify: `netlify.toml` (`[functions.sales]` en `[functions.sales-import]` met `timeout = 26`)
- Test: `tests/server-sales.test.mjs`

**Interfaces:**
- Consumes: `vereisGebruiker`, `weigeringV2` (`netlify/lib/auth.js`), `logActiviteit` (`netlify/lib/activiteit.js`), `leesGebruikers` (`netlify/lib/gebruikers.js`), `magLezen`/`magSchrijven` (Task 3), `leesSales`/`schrijfSales`/`pasWijzigingToe` (Task 7), `bepaalLocatie`/`vulLocatiesAan`/`zoekPostcode` (Task 6), `winkelNaam`/`isTestVerzoek`/`zorgVoorTestkopie`.
- Produces:
```js
// sales-toegang.js
export async function bepaalDoel({ gebruiker, gevraagdId, schrijven, leesGebruikers, testModus }) // -> { ok:true, doelId } | { ok:false, status:403|404, fout }
  // sales: eigen id; ander id enkel lezen bij magAlleSales; beheerder: elk id van een gebruiker met rol 'sales' (404 anders); in testModus is 'test-sales' altijd geldig
// sales-acties.js (alle drie -> { status, json })
export async function haalSales({ store, doelId })
export async function wijzigSales({ store, doelId, gebruiker, body, nu, deps, log })
export async function verwijderLead({ store, doelId, gebruiker, leadId, nu, log })
// functions/sales.js en postcode.js
export function maakHandler({ getStore, fetch, nu = () => Date.now(), vereis = vereisGebruiker, log = logActiviteit, sleutel = () => process.env.TOMTOM_API_KEY }) // -> async (req) => Response
export default maakHandler({ getStore, fetch: globalThis.fetch });
export const config = { path: '/api/sales' }; // resp. '/api/postcode'
```
`wijzigSales`: `body.versie` verplicht (anders 400 `'versie ontbreekt'`); foute versie → `409` zoals `afspraken.js`; na `pasWijzigingToe` krijgt elke lead in `adresGewijzigd` een nieuwe `locatie` via `bepaalLocatie`; `aanvullen:true` roept `vulLocatiesAan`; antwoord bevat `open`. Elk nieuw `resultaat` → `log(store, { gebruiker, actie:'sales-resultaat', onderwerp: leadId, details:{ soort } })`; `verwijderLead` → `'sales-lead-verwijderd'` met `onderwerp: leadId` (nooit namen).

- [ ] **Step 1: Write the failing tests** (`maakGeheugenStore`, nep-fetch, `vereis` die een vaste gebruiker teruggeeft, `log` die opneemt; vaste klok):
  - **Toegang:** sales A leest zichzelf → 200 leeg blob; A met `?gebruiker=B` → 403; A met `magAlleSales` leest B → 200 maar PATCH/DELETE op B → 403; beheerder leest en schrijft B; beheerder met id van een niet-verkoper → 404; `vereis` weigert → het antwoord van `weigeringV2` wordt doorgegeven (401/403); PATCH zonder `schrijven`-controle (geen `X-Blitz`) wordt door `vereis` geweigerd; een technieker/planner → 403.
  - **PATCH:** zonder `versie` → 400; verkeerde versie → 409 met `data`; geldige lead-patch → versie +1, antwoord bevat de volledige blob; adreswijziging naar volledig adres roept `geocodeAdres` (nep) en zet `locatie.bron:'adres'`; geocode faalt → `locatie.bron:'postcode'` (adres wordt "nakijken", geen crash); postcode niet te vinden → `locatie:null`; `aanvullen:true` vult locaties aan en geeft `open`; resultaat → `log` met `actie:'sales-resultaat'`, `onderwerp = leadId`, `details` zonder namen/gsm/e-mail.
  - **DELETE:** verwijdert, `log` `'sales-lead-verwijderd'`; onbekend id → 404; blob van verkoper B blijft onaangeroerd.
  - **Testmodus:** header `X-Blitz-Test: 1` → store `blitz-data-test`, `fetch` 0× aangeroepen.
  - **postcode:** `?pc=3640` → 200 met `{ pc, lat, lon, gemeente }`; `?pc=36` → 400; onbekend → 404; vereist rol sales of beheerder.
- [ ] **Step 2: Run** `node --test tests/server-sales.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** Functies blijven dun: CORS via `maakCors({ methoden, headers:'Content-Type, X-Blitz, X-Blitz-Test, X-Blitz-Test-Rol', inhoudType:'application/json' })`, auth → `bepaalDoel` → actie → `v2Json`. `getStore` binnen een `try` (patroon `tickets.js`).
- [ ] **Step 4: Run** → PASS; `node --test tests/server-http.test.mjs` onaangeroerd groen.
- [ ] **Step 5: Commit** `feat(sales): endpoints /api/sales en /api/postcode`.

---

## Task 12: Server — import, geplande opruiming; navigatie-controle

**Files:**
- Create: `netlify/lib/sales-import-server.js`, `netlify/functions/sales-import.js`, `netlify/functions/sales-opruimen.js`
- Modify: `netlify/lib/sales-opruimen.js` (voeg `ruimAllesOp`)
- Test: `tests/server-sales-import.test.mjs`, `tests/server-sales-opruimen.test.mjs`

**Interfaces:**
- Consumes: `leesExport` (Task 1), `voegSamen` (Task 2), `vulLocatiesAan` (Task 6), `leesSales`/`schrijfSales` (Task 7), `ruimOp` (Task 5), `vereisGebruiker({ rollen:['sales'], schrijven:true })`, `logActiviteit`, `leesGebruikers`.
- Produces:
```js
// sales-import-server.js
export async function importeerExport({ store, doelId, gebruiker, body, nu, nieuwId, deps, log }) // -> { status, json } (contract: "API-contract")
// sales-opruimen.js (uitbreiding)
export async function ruimAllesOp({ store, nu, leesGebruikers, log }) // -> { gewist: number }; per verkoper-blob ruimOp, schrijft enkel bij wijziging; log 'sales-lead-verwijderd' met gebruiker { id:'systeem', naam:'Systeem (opruiming)' }, details { aantal }
// functions/sales-import.js: maakHandler({ getStore, fetch, nu, vereis, log, sleutel }); config { path: '/api/sales-import' }
// functions/sales-opruimen.js: export default async () => …; export const config = { schedule: '@daily' }; (geen path)
```
`importeerExport`: parseert `body.export` met `leesExport` (400 `{ error }` bij `ok:false`), voegt samen met de huidige blob, bepaalt locaties (budget 15 s) en schrijft **één keer**; logt `'sales-import'` met `details:{ nieuw, alAanwezig, adresNakijken }`; antwoord volgens het contract. Twee importen na elkaar met hetzelfde bestand → tweede geeft `nieuw: 0` (idempotent; twee toestellen).

- [ ] **Step 1: Write the failing tests:** import van de fixture (verzonnen, 6 leads) → samenvatting klopt, blob bevat de leads met `locatie` (testmodus-geocoding), `log` aangeroepen zonder persoonsgegevens; tweede import identiek → `nieuw:0`; export van een andere verantwoordelijke wordt door de server **niet** geblokkeerd (de waarschuwing is een client-vraag) maar staat in `export.verantwoordelijke`; kapotte export → 400 met de tekst uit Task 1; > 500 leads → 400; beheerder/technieker → 403 (`vereis`); TomTom valt uit (nep-fetch gooit) → import slaagt, `open` = aantal leads zonder locatie; `ruimAllesOp` wist enkel afgewerkte leads > 12 maanden bij alle verkopers, schrijft niets bij geen wijziging, logt één regel per verkoper met `details:{ aantal }`.
- [ ] **Step 2: Run** beide testbestanden → FAIL.
- [ ] **Step 3: Implement.** Functies dun, logica in lib.
- [ ] **Step 4: Run** → PASS; daarna `node --test` volledig (geen regressie).
- [ ] **Step 5 (navigatie-controle):** lees `kern/navigatie.js`, `kern/sessie.js`, `app.js` en `e2e/helpers.mjs` zoals logins ze opleverde. Leg in de ledger vast: (a) semantiek van `registreerTabs` (aanvullen?), (b) wie de view-container activeert, (c) antwoordvormen van `/api/auth-ik`, `/api/instellingen`, `/api/gebruikers`, (d) hoe e2e de rol kiest. Wijkt dit af van "Aannames en gaten": pas enkel `sales-registratie.js` (Task 13) en de e2e-hulp (Task 13) aan, en meld het.
- [ ] **Step 6: Commit** `feat(sales): import-endpoint en dagelijkse opruiming`.

---

## Task 13: Schil, venster, verkoperkeuze en tabregistratie

**Files:**
- Create: `public/js/schermen/sales-schil.js`, `public/js/schermen/sales-venster.js`, `public/js/schermen/sales-verkoper.js`, `public/js/schermen/sales-registratie.js`, `public/css/sales.css`, `e2e/sales-hulp.mjs`, `e2e/fixtures/sales-export.json`, `e2e/sales-schil.spec.mjs`
- Modify: `public/js/app.js` (2 regels), `public/index.html` (1 `modulepreload`-regel), `public/js/schermen/kalender.js` (+`export` op 3 functies), `public/js/schermen/route-kaart.js` (+`export` op `KAART_LAGEN`), `public/sw.js` (`SHELL`)
- Test: `tests/sales-registratie.test.mjs`, `e2e/sales-schil.spec.mjs`

**Interfaces:**
- Consumes: `registreerTabs` (koppelvlak), `huidigeGebruiker`/`heeftRol` (`kern/sessie.js`), `kanVerkoperKiezen`/`magSchrijven` (Task 3), `laadSales` (Task 10), `registreerVenster` (`venster.js`), `escHtml`, `registreerActies`.
- Produces:
```js
// sales-registratie.js
export const SALES_TABS = [ { id:'sales-lijst', label:'Te plannen', module:'./sales-lijst.js' }, { id:'sales-kalender', label:'Kalender', module:'./sales-kalender.js' }, { id:'sales-route', label:'Route', module:'./sales-route.js' }, { id:'sales-afgewerkt', label:'Afgewerkt', module:'./sales-afgewerkt.js' } ];
export function registreerSalesTabs(registreerTabs) // registreerTabs('sales', tabs) en registreerTabs('beheerder', tabs met label 'Sales: <label>'); laad: () => import(module).then(m => m.toon(zorgVoorView(id)))
// sales-schil.js
export function zorgVoorView(id)        // -> HTMLElement: <div class="view" id="view-<id>"> in #hoofdinhoud (eenmalig) en laadt /css/sales.css (eenmalig)
export function toonFout(view, tekst)
// sales-venster.js
export function openSalesVenster({ titel, bouw /*(body, sluit) => void*/, breed = false }) // -> { sluit() }; overlay + modal (klassen .overlay/.modal), geregistreerd bij registreerVenster, focus terug bij sluiten
// sales-verkoper.js
export async function renderVerkoperBalk(container, { onWijzig }) // toont keuzelijst (alleen als kanVerkoperKiezen), laadt /api/gebruikers?rol=sales, bewaart keuze in localStorage 'blitz_sales_verkoper'; roept onWijzig(gebruikerId, schrijfbaar)
export function schrijfbaarNu()          // magSchrijven(huidigeGebruiker(), salesToestand().gebruikerId)
```
Elke `toon(view)` van een scherm: verkoperbalk renderen → `laadSales` + `laadInstellingen` → scherm tekenen; `onSalesWijziging` hertekent. Alle id's en klassen in de sales-views dragen het voorvoegsel `sales-` (de beheerder heeft ook de ticket-schermen op dezelfde pagina). Een `app.js`-wijziging is exact: `import { registreerSalesTabs } from './schermen/sales-registratie.js';` en `registreerSalesTabs(registreerTabs);` direct naast waar logins `registreerTabs` voor de andere rollen aanroept (en een `import { registreerTabs }` indien app.js die nog niet importeert).

- [ ] **Step 1: Write the failing tests:** `tests/sales-registratie.test.mjs`: `registreerSalesTabs(spion)` roept `registreerTabs('sales', …)` met id's in de volgorde `['sales-lijst','sales-kalender','sales-route','sales-afgewerkt']` en `registreerTabs('beheerder', …)` met labels die met `'Sales: '` beginnen; elk tab heeft een functie `laad`. `e2e/sales-schil.spec.mjs` (stijl `e2e/plan-week.spec.mjs`, hulp `startSalesApp` uit `e2e/sales-hulp.mjs`): als sales-gebruiker staan precies de vier tabs "Te plannen · Kalender · Route · Afgewerkt" in de tabbalk, geen ticket-tabs; de tab "Te plannen" toont de lege toestand "Nog geen leads. Laad een export." zonder consolefouten.
- [ ] **Step 2:** Maak `e2e/sales-hulp.mjs`: `salesStubs({ gebruiker, leads? , blokken? })` → handlerkaart voor `sales`, `sales-import`, `postcode`, `instellingen`, `gebruikers` (en wat `startApp` na de logins-merge nog verplicht) die de **echte** `maakHandler`s uit `netlify/functions/` gebruikt met een in-memory store (`tests/geheugen-store.mjs`), een `vereis` die `gebruiker` teruggeeft en de header `X-Blitz-Test: 1`; `startSalesApp(page, { gebruiker, overschrijf })` (zelfde opzet als `startApp` maar wacht op de tab "Te plannen" i.p.v. `#cnt-tickets`; rol kiezen zoals vastgelegd in Task 12 stap 5). Maak `e2e/fixtures/sales-export.json`: verantwoordelijke `"Test Verkoper"`, 8 verzonnen leads (postcode-only 3640/3500/2440/3600/3550; één `"Dorpsstraat 12, 3640 Kinrooi"`; één `"bij de molen"`; één met placeholder-gsm `+32000000`; één e-mail met hoofdletters die dubbel voorkomt). Run `npx playwright test e2e/sales-schil.spec.mjs` → FAIL.
- [ ] **Step 3: Implement** de vier modules, `sales.css` (voorvoegsel `sales-`, tinten `.sales-voorgesteld` lichter dan `.sales-bevestigd`, gestippeld `sales-marker-ongeveer`; hergebruik tokens uit `base.css`), de regels in `app.js`/`index.html`, en de `export`-sleutelwoorden. Voeg de nieuwe bestanden van deze taak (modules, `sales.css`) toe aan `SHELL` in `public/sw.js`; elke volgende taak doet dat voor zijn eigen bestanden.
- [ ] **Step 4: Run** `node --test tests/sales-registratie.test.mjs tests/sw-schil.test.mjs tests/sw-strategie.test.mjs tests/window-namen.test.mjs`, `npx playwright test e2e/sales-schil.spec.mjs` en de bestaande kalender-/route-specs (`e2e/kalender*.spec.mjs e2e/route*.spec.mjs`) → PASS. `git diff -w -- public/js/schermen/kalender.js public/js/schermen/route-kaart.js` toont alleen `export`.
- [ ] **Step 5: Commit** `feat(sales): schil, tabregistratie en verkoperkeuze`.

---

## Task 14: Scherm "Te plannen" met import, verwijderen en detail

**Files:**
- Create: `public/js/schermen/sales-lijst.js`, `public/js/schermen/sales-detail.js`, `e2e/sales-import.spec.mjs`
- Modify: `public/sw.js` (`SHELL`)
- Test: `e2e/sales-import.spec.mjs`

**Interfaces:**
- Consumes: Task 8 (logica), Task 10 (`importeer`, `wijzig`, `verwijderMetOngedaan`, `spoelUitgesteld`), Task 13 (`openSalesVenster`, `zorgVoorView`), `leesExport`/`zelfdeNaam` (Task 1), `zetVastUur`/`terugNaarTePlannen` (Task 3), `appConfirm` (`app-dialog.js`), `toast`.
- Produces: `export async function toon(view)` (Te plannen) en `export function openLeadDetail(leadId)` (door Task 16 hergebruikt).

Gedrag: knop **Export laden** (bestandskiezer `.json`; bestand > 2 MB → fout zonder lezen) → `leesExport` → andere `verantwoordelijke` dan `salesNaam` van de getoonde verkoper → `appConfirm` "Deze export is van X. Toch inladen?" vóór er iets bewaard wordt → `importeer` → toast "12 nieuw, 7 al aanwezig, 1 adres nakijken" met daaronder de exportgegevens (`aantal`, `statussen`) → bij `open > 0` herhaald `wijzig({ aanvullen:true })` (max. 10×). Kaartjes uit `kaartInfo`, gegroepeerd "Nog in te plannen" / "Ingepland"; zoekveld en postcodegebied-filter; **✕** → `appConfirm`, daarna 5 s "Ongedaan maken"-balk (`verwijderMetOngedaan`); `pagehide` → `spoelUitgesteld()`. Detail (`sales-detail.js`): straat, huisnr, postcode, gemeente, notitie, bezoekduur, historiek `bezoeken` (alleen lezen), **Vast uur afspreken** (datum + uur; `valideerVastUur`; botsing → `appConfirm` met `vindBotsingen`; daarna `zetVastUur`), **Terug naar te plannen**; opgeslagen adreswijziging → toast "Adres opgeslagen"; wijzigt een voorgesteld/bevestigd bezoek van postcode naar volledig adres, dan toast "Adres bijgewerkt — de route van die dag is herberekend. Plan de week opnieuw om de uren te herschikken." Alleen-lezen modus (`schrijfbaarNu() === false`): geen ✕, geen invoer, geen knoppen.

- [ ] **Step 1: Write the failing e2e** (`e2e/sales-import.spec.mjs`): (a) export laden (fixture) → samenvatting "N nieuw, 0 al aanwezig, 1 adres nakijken", kaartjes met labels "enkel postcode" / "volledig adres" / "adres nakijken", geen `/api/matrix`/`/api/route`; dezelfde export nogmaals → "0 nieuw, N al aanwezig"; (b) export van "Andere Verkoper" → bevestigingsvenster, **Terug** bewaart niets (`verzoeken.van('/api/sales-import')` leeg); (c) kapotte JSON en een naam `<img src=x onerror=…>` → foutmelding resp. letterlijke tekst op het kaartje (geen `img` in de DOM); (d) ✕ → bevestigen → "Ongedaan maken" binnen 5 s herstelt de lead (geen DELETE), laten verlopen met `page.clock.runFor(5000)` stuurt precies één DELETE; (e) detail: straat + huisnr invullen → label wordt "volledig adres"; (f) **Vast uur afspreken** (dinsdag 10:00) → lead verhuist naar "Ingepland" met chip; botsing met een bestaand vast uur → bevestigingsvraag. Run → FAIL.
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
- Consumes: Task 9 (`bouwKalenderItems`, `maandChips`, `tintVan`), uit `kalender-logica.js`: `timelineTopHeight`, `bepaalLanes`, `zichtbareDagen`, `maandRaster`, `TIMELINE_PX_PER_MIN`; uit `kalender.js` (nu geëxporteerd, Task 13): `computeTimelineRange`, `appendOffhoursBands`, `renderTimelineGutter`; `valideerBlok` (Task 3); `bevestig`, `terugNaarTePlannen` (Task 3); `openResultaat` (Task 15); `openLeadDetail` (Task 14); `getHolidayName`.
- Produces: `export async function toon(view)` (Kalender), `export function openBlokVenster({ datum? })`, `export function openBezoekActies(leadId)` (bellen `tel:`, navigeren, **Bevestigen**, **Terug naar te plannen**, **Resultaat**; een blok: verwijderen).

Gedrag: week- en maandweergave met ‹ › en "Vandaag" op `sales-data.gekozenDatum`; breed = tijdlijn met dezelfde uur-as en laan-indeling als de technieker-kalender, smal (`window.apparaat.indeling === 'smal'`) = gestapelde kaartjes per dag; voorgesteld lichter dan bevestigd; blokken (verlof/kantoor/afspraak) als gearceerd blok; knoppen **⚡ Plan deze week** (Task 17) en **➕ Blok** (datum, van/tot of "Hele dag", soort, omschrijving); navigeren via `geo:`/Google Maps zoals `navigate()` in `app.js` (eigen kleine functie, geen import uit `app.js`); alleen-lezen modus verbergt schrijfknoppen.

- [ ] **Step 1: Write the failing e2e:** met stub-leads (één voorgesteld, één bevestigd, één blok) tonen de dagkolommen de bezoeken met de juiste tint-klasse; klik op een voorgesteld bezoek → **Bevestigen** → blok wordt vol (`PATCH`, status `bevestigd`, `planning.vast:true`); **Terug naar te plannen** → bezoek weg, lead staat in Te plannen; blok toevoegen "Verlof" hele dag dinsdag → 🔒-blok zichtbaar; hele-dag-blok verwijderen; maandweergave toont chips; viewport `mobile` toont de gestapelde lijst. De technieker-kalender-specs blijven groen. Run → FAIL.
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

Stappen: instellingen van de **getoonde** verkoper (centraal, via `laadInstellingen`), depot = geocode van `instellingen.startlocatie` (cache `geocacheLookup` → `/api/optimize` zoals `autoPlan`; in testmodus enkel de cache, anders `null`), `bouwPlanInvoer` met `feestdag: getHolidayName`, `planWeek`, `verwerkUitkomst`, **één** `wijzig({ leads: wijzigingen })`, resultaatvenster met redenen (`redenTekst`) en waarschuwingen. Geen Zoho-aanroepen, geen mails. Voorbij week → melding zoals `autoPlan`; geen te plannen leads → toast "Geen leads om in te plannen".

- [ ] **Step 1: Write the failing e2e:** (a) "Plan deze week" met 8 te-plannen leads → resultaatvenster "Ingepland (n)", leads hebben status voorgesteld in de kalender, `PATCH /api/sales` precies één keer, geen `/api/matrix`/`/api/route`/`/api/propose`; (b) een vast uur (dinsdag 10:00) blijft na "Plan deze week" én na een tweede keer **ongewijzigd** en er staat geen ander bezoek overlappend; (c) een lead zonder locatie (adres "bij de molen") komt onder "Niet ingepland" met "Adres niet gevonden"; (d) een bevestigd bezoek wordt nooit herschikt, een voorgesteld bezoek wel (opnieuw plannen na toevoegen van een verlofblok op zijn dag verplaatst hem of zet hem terug naar te plannen met reden in het venster); (e) een verkoper met `magAlleSales` die een andere verkoper bekijkt, ziet de knop niet (alleen-lezen). Run → FAIL.
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

- [ ] **Step 1: Write the failing tests:** e2e: (a) rol sales ziet enkel de vier sales-tabs, `#view-tickets` is niet actief en er zijn geen verzoeken naar `/api/tickets`, `/api/inventaris`, `/api/rapport-archief`; (b) verkoper A met `magAlleSales:false`: geen verkoperkeuzelijst, `GET /api/sales?gebruiker=B` geeft 403 (de stub gebruikt de echte handler); (c) `magAlleSales:true`: keuzelijst met B, het scherm toont B's leads **alleen-lezen** (geen ✕, geen Export laden, geen Plan deze week); (d) rol beheerder: tabs "Sales: Te plannen …", keuzelijst, mag schrijven; (e) rol technieker/planner: geen sales-tabs. Unit: uitbreiding van `tests/server-sales.test.mjs` met de volledige matrix (rol × lezen/schrijven × eigen/ander) uit Task 3/11 als één tabelgedreven test.
- [ ] **Step 2: Run** → FAIL waar gedrag ontbreekt; corrigeer in de betreffende schermmodule (geen nieuwe bestanden).
- [ ] **Step 3: Run** `npx playwright test e2e/sales-rollen.spec.mjs --repeat-each=3` en `node --test tests/server-sales.test.mjs` → PASS.
- [ ] **Step 4: Commit** `test(sales): rollen en isolatie tussen verkopers`.

---

## Task 20: Afronding

**Files:**
- Modify: `CHANGELOG.md` (onder "Refactor-tak — nog niet uitgebracht", sectie **Added**), ledger.

- [ ] **Step 1:** Voeg bij **Added** één blok "Sales-planner" toe: wat een verkoper kan (export laden en samenvoegen, postcode of volledig adres, Plan deze week via het planner-brein, vast uur, voorgesteld/bevestigd, resultaat, Afgewerkt, 12 maanden bewaren), de nieuwe endpoints (`/api/sales`, `/api/sales-import`, `/api/postcode`, dagelijkse opruiming) en dat er geen Zoho, stock of mails bij komt. Geen versie-ophoging.
- [ ] **Step 2: Volledige verificatie:** `node --test` (aantal ≥ baseline uit Task 0 + nieuwe tests, alles groen), `npx playwright test --project=chromium` (idem), `git diff refactor..HEAD --stat -- public/index.html public/js/app.js public/js/schermen/kalender.js public/js/schermen/route-kaart.js` toont enkel de afgesproken regels.
- [ ] **Step 3:** Skill `opruimen-na-werk` (processen stoppen), `git status` schoon (behalve `.claude/launch.json`).
- [ ] **Step 4: Commit** `docs: changelog sales-planner (refactor-tak)`. Niet mergen; terugmelding aan Brent met de open punten hieronder.

---

## Open punten voor Brent (zonder blokkade)

1. **Aanname koppelvlak:** zie "Aannames en gaten" (navigatie, antwoordvormen, testmodus-gebruikers).
2. **Verwijderde lead keert terug** als hij nog in een volgende export staat (er is bewust geen "verwijderd"-geheugen, vanwege "verwijderen = echt weg"). Wil Brent dat een weggeklikte lead niet terugkomt, dan is een lijst van gehashte herkenningssleutels nodig.
3. **Fallback-herkenning** op naam+voornaam+postcode voor leads zonder e-mail én bruikbare gsm is een uitbreiding op de spec (anders dubbels bij elke import).
4. **"Te plannen" toont ook ingeplande leads** (aparte groep "Ingepland"); letterlijk enkel "te plannen" tonen kan door de groep te verbergen.
5. **Herberekening na adreswijziging** = route en rittijden worden vernieuwd en conflicten gemeld; de uren worden pas verschoven bij een nieuwe "Plan deze week" (verschuiven op eigen houtje kan een bezoek ongevraagd wijzigen).
6. **Blokken hebben in deze versie geen adres** (enkel tijdvak); het datamodel (`lat`/`lon`) en de adapter ondersteunen het al.
7. **Verkoper verwijderd of geblokkeerd:** zijn leads blijven tot de 12-maandenregel of een beheerder ze verwijdert.
8. **TomTom-parameters** (`structuredGeocode`) zijn volgens de documentatie gekozen maar nooit tegen de echte dienst getest; eerste echte oproep door Brent controleren.

## Dekking van de spec

Doel/beslissingen → Task 1–4, 14–17; exportformaat en inlezen → Task 1, 14; herkenning/samenvoegen → Task 2, 12; datamodel en locking → Task 3, 7, 11; serverfuncties → Task 11, 12; schermen Te plannen/Kalender/Route/Afgewerkt/Resultaat → Task 14–18; plannen en adapter → Task 4, 17; manueel vast uur → Task 4, 14, 17; privacy (login, echt verwijderen, 12 maanden) → Task 5, 10–12, 19; activiteitenlog → Task 11, 12; gegevensbron-laag → "Keuze gegevensbron-laag", Task 10, 13; testen → in elke taak plus Task 19, 20.
