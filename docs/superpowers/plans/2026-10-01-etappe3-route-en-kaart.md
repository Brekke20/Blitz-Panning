# Etappe 3 — Route en kaart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De Route-tab (lijst, weekstrook, tijden, slepen, optimaliseren, tijden vastleggen, kaart, drukte) verhuist naar `public/js/schermen/` (`route-tijden.js` puur, `route-kaart.js`, `route.js`), met één aankomsttijd-berekening en een toestandsabonnement dat ook `planning` dekt, zonder zichtbare gedragswijziging.

**Architecture:**
- `route-tijden.js` is puur (unit-getest); `route-kaart.js` en `route.js` raken DOM/`L` enkel bij een oproep, nooit op moduleniveau. Alleen `kern/brug.js` wijst `window`-namen toe (`window.kern.route` + oude namen in het `LEGACY-BRUG`-blok).
- Afhankelijkheden uit het klassieke script (andere schermen) worden via `initRoute(afh)`/`initKaart(afh)` aangereikt; instellingen en gegevens komen uit `kern.toestand`.
- Routeschermtoestand (`routeData`, `currentRouteDate`, …) blijft privé in de modules, niet in de store.

**Tech Stack:** vanilla ES-modules zonder bouwstap, `node --test`, `@playwright/test` (bestaand), Leaflet 1.9.4 (CDN, bestaand).

**Spec:** `docs/superpowers/specs/2026-10-01-etappe3-route-en-kaart-design.md`. Lees §2 (feiten) en §3 (rulings R1–R16) vóór Taak 1. Bij elke taak staat een feasibility-regel: de e2e-/unit-weg waarlangs de taak bewijsbaar is.

## Global Constraints

- Werk in de worktree `.claude/worktrees/planner-brein` (tak `refactor`). Prefix elke shell-opdracht met `cd "<worktree>" &&` en controleer vóór elke commit `git branch --show-current` = `refactor`. Nooit committen in de main-checkout. Niet pushen.
- Zichtbaar gedrag identiek (W5). Een gevonden bug: eigen test + "Fixed"-regel in `CHANGELOG.md` (Taak 8), en vermeld in de commit.
- Nooit echte Zoho-, TomTom- of mail-aanroepen. Zoho-paden (W11): de `/api/plan-datum`-code in `applyRouteOrder` blijft byte-voor-byte, enkel `TEST_MODE` → `afh.testModus()` (R7).
- `rapport-wizard.js`, `planner.js`, `sorteer.js` en de andere bestaande modules worden niet gewijzigd (behalve wat een taak uitdrukkelijk noemt).
- Klassieke code op het hoogste niveau mag `window.kern`, accessors of verhuisde functies niet gebruiken (K3). Per verhuizing: `grep -nE "^(let|const|var) .*<naam>"` en controleer gebruik buiten function-bodies.
- Geen nieuwe `window.<naam> =`-toewijzing buiten `kern/brug.js`: `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` moet leeg zijn.
- Tests: `npx playwright test` en `node --test` (zonder pad; nooit `node --test tests/`). Nieuwe unit-tests in `tests/*.test.mjs`; nieuwe e2e in `e2e/*.spec.mjs` die `test`/`expect` uit `./helpers.mjs` importeren; geen `waitForTimeout`, geen screenshots. Gemeten waarden mogen in een test staan mits met commentaar "Gemeten" (zoals `e2e/route.spec.mjs`).
- Eén dev-/testserverproces: stop enkel je eigen PID.
- `public/sw.js`: nieuw bestand erbij in `SHELL` in dezelfde commit; `CACHE_NAME`, `package.json`-versie en tags onaangeroerd (R13).
- Namen en commentaar in het Nederlands. Houd `sjLog(...)`-regels aan (K16). Verhuis commentaar mee met de code.
- Commit-trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ledger: `.superpowers/sdd/2026-10-01-etappe3-route-en-kaart/`. Brief en diff als bestand naar subagents; terugmelding maximaal 15 regels.
- Modelkeuze per taak staat bij de taak (W12). Eindreview van de etappe: sonnet (R15).

## Review Focus

1. **`planning`-schrijfplaatsen en `raak`**: `grep -nE "planning\[[^]]*\] *=[^=]|delete planning|planning\[[^]]*\]\.(push|splice|sort|unshift|pop|shift)" public/index.html` (en in `public/js/`) tegen `grep -n "raak('planning')"`: elk schrijfblok heeft `raak('planning')` in dezelfde commit als het abonnement (Taak 3); geen handmatige `renderRouteList` meer direct na zo'n schrijf, behalve in de Zoho-gebonden blokken uit R7.
2. **Verouderde route-lijst na slepen/optimaliseren/wijziging**: `applyRouteOrder`, `optimizeRoute` (ook het "optimalisatie niet beschikbaar"-pad) en "Tijden vastleggen" hertekenen lijst, kaart en knoppen; de "verouderd"-hint en het wissen van de kaart na het weghalen van een stop blijven werken; de renderteller (R10) stijgt nergens.
3. **Aankomsttijd-afwijking**: route-lijst, "📨 Voorstel" op de kaart en in het detail, en het vooraf invullen bij "Toewijzen" geven exact dezelfde minuten als vóór de etappe (Taak 1-tests ongewijzigd groen); `berekenAankomsten` is letterlijk de oude body; er is geen tweede berekening meer (`grep -n "arrivalTimes" public/` toont enkel de gedeelde paden).
4. **Sleepstatus verloren door hertekenen**: één `maakSorteerbaar`-instantie per render, de vorige eerst vernietigd; geen extra renders tijdens een sleepactie; `_routeOrderBezig`-semantiek (poll slaat over tijdens `applyRouteOrder`) behouden.
5. **Kaart: dubbele markers/lijnen of een lekkende legende bij hertekenen**: `updateKaart` wist laag en legende eerst; markers, paden en `.route-legende` blijven na herhaald renderen even talrijk (Taak 1-test, Taak 4); `initKaart` draait één keer; geen `L`-gebruik op moduleniveau.

---

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `public/js/schermen/route-tijden.js` (nieuw, Taak 2) | pure berekeningen (tijden, ankers, handtekening, dagklok) |
| `public/js/schermen/route-kaart.js` (nieuw, Taak 4) | Leaflet-kaart, drukte-tekening, legende |
| `public/js/schermen/route.js` (nieuw, Taken 5–6) | routescherm: lijst, weekstrook, berekenen, slepen, optimaliseren, vastleggen |
| `tests/route-tijden.test.mjs` (nieuw, Taak 2) | unit-tests pure laag, plus `drukteMagnitude` (Taak 4) |
| `e2e/route.spec.mjs` (uitgebreid, Taak 1), `e2e/route-kaart.spec.mjs`, `e2e/route-tijden.spec.mjs` (nieuw, Taak 1) | karakterisering route, kaart, getoonde tijden |
| `e2e/kern.spec.mjs` | renderteller via `kern.route.renderTelling` (Taak 5), tellingen bij Taak 3 |
| `public/js/kern/brug.js` | importeert de schermmodules, `window.kern.route`, legacy-namen |
| `public/index.html` | route-code verdwijnt; abonnementen, `raak('planning')`, dunne oproepen |
| `public/sw.js` | `SHELL` uitgebreid |
| `CHANGELOG.md`, `CLAUDE.md` | Taak 8 |

## Interfaces (eindtoestand, gedeeld door alle taken)

```js
// schermen/route-tijden.js (puur)
export function berekenAankomsten(allStops, legs, { vanTijd, duurVoor, werktijdMin }) // -> { arrivalTimes, legIdx }
export function aankomstPerTicket(allStops, arrivalTimes)                              // -> { [ticketId]: min }
export function fmtTijd(totalMin)
export function dagHeeftEenTechnieker(stops)
export function buitenDagklok(minutenRuw, uurStr, totTijd)
export function mergeMetAnkers(geoptimaliseerd, ankers, { vanTijd, duurVoor, werktijdMin })
export function routeHandtekening(stops, eigenAfspraken)
export function stopZonderTijdstip(p, isAnker)
export function drukteMagnitude(ratio)                                                 // verhuist in Taak 4

// schermen/route-kaart.js
export function initKaart({ instellingen, bewaarKaartStijl, standaardRouteKleur })
export function initMap(), applyKaartStijl(), heeftKaart(), invalideerKaartGrootte()
export function updateKaart({ date, allStops, routeData, currentRouteDate })
export function wisKaart(), zoomOpGekendeStops(date, stops, localForDate, routeActueel), herstelWegafsluitingToast()

// schermen/route.js
export function initRoute(afh)    // afh: zie spec §2 + testModus; registreert acties en de datum-change-luisteraar
export function renderRouteList(date), updateRouteBtns(date), onDateChange(val), clearDay()
export async function calculateRoute(), optimizeRoute(), applyRouteOrder(date, entries)
export function aankomstTijdenVoorDag(date)       // = legacy computeArrivalTimes
export function routeActueelVoor(date), routeOrderBezig(), vernieuwKaart(), renderTelling()
```

---

### Task 1: Karakteriseringstests (geen productiecode)

**Aanbevolen model:** sonnet (test-zwaar, meet gedrag zoals het nu is)

**Feasibility:** alles in `?test` met de bestaande stubs en `overschrijf`-hooks (`route`, `drukte`, `optimize`, `voorstel-status`); Leaflet laadt echt (CDN), tegels zijn gestubd. Niet bereikbaar en dus **niet** in deze taak: `/api/plan-datum`, de ticketpoll, Navigeer, "te veel stops" (R12).

**Files:**
- Wijzig: `e2e/route.spec.mjs`
- Maak: `e2e/route-kaart.spec.mjs`, `e2e/route-tijden.spec.mjs`

Alle tests slagen op de **huidige** code. Waar de verwachting een gemeten waarde is, draai eerst, noteer het resultaat in de test met commentaar "Gemeten". Hergebruik `maakRouteMetStops`, `zetStartTijd`, `stopTijden` (kopieer of exporteer naar een gedeeld hulpbestand `e2e/route-hulp.mjs` als drie bestanden ze nodig hebben).

- [ ] **Step 1: Getoonde aankomsttijden (`route-tijden.spec.mjs`).** Vier verbruikers van de berekening:
  1. Route-lijst: bestaat al (`10:20`, `12:40`; na vastleggen `10:30`, `12:45`). Voeg toe: een stop met een vast tijdstip (voorkeursuur of vergrendeld, kies wat in de testdata kan) springt naar dat uur en de volgende rekent daarvandaan.
  2. "📨 Voorstel" op de ticketkaart in de route-lijst: klik op de eerste en tweede kaart; `#proposal-time` heeft de naar het volgende kwartier afgeronde aankomst (verwacht 10:30 en 12:45 bij 10:20/12:40). Annuleer het venster telkens (nooit versturen).
  3. "📨 Voorstel" in het ticketdetail (kalender → ticket #1001 openen): `#proposal-time` **met** een berekende route voor die dag en **zonder** (de 30-min-terugval, `legs = null`). Meet beide.
  4. "📅 Toewijzen" in de wachtrij (`toggleAssignRow`): `assign-time-<id>` voor een datum met en zonder berekende route (kies een ticket dat in de wachtrij blijft na "Plan deze week"; gebruik de datum van maandag 5 oktober).
- [ ] **Step 2: Route-gedrag (`route.spec.mjs`).**
  1. **Verouderd na weghalen**: na een berekende route een stop via "✕ Uit planning halen" verwijderen (bevestigingsvenster: gebruik de dialoogknop); verwacht: één stop in de lijst, de hint "De route is verouderd en van de kaart gehaald" zichtbaar, samenvatting `—`, geen `Tijden vastleggen`-balk-fout.
  2. **Eigen afspraak met adres**: voeg een eigen afspraak met adres toe voor 5 oktober (`page.evaluate(() => { localEvents = [...localEvents, {…}] })`; gebruik de velden die `eigenAfsprakenVoor` leest: `datum`, `uur`, `adres`, `titel`, `type`, `persoon`), ga van Kalender naar Route en noteer of de lijst de afspraak toont of veroudert. **Leg dit gemeten gedrag vast**; Taak 3 beslist op basis hiervan of `localEvents` in het route-abonnement komt (R6). Schrijf het resultaat in de ledger.
  3. **Meerdere technici**: plan de week voor Tim, zet daarna in-place `planning['2026-10-05'][1].ticket.assignee = 'Sam'` en roep `renderRouteList('2026-10-05')` op via `page.evaluate` (zonder technieker-filter dat anders wordt, of kies filter "Iedereen"). Verwacht: `⚡ Optimaliseer` geeft de toast "⚠ Kies eerst een technieker — de dag bevat stops van meerdere technici", de kaartjes dragen geen `data-sleepbaar`, "Tijden vastleggen" is uitgeschakeld.
  4. **Mislukte route bij vastleggen**: `overschrijf.route` als stateful stub (eerste aanroep normaal via de standaard-uitkomst, daarna `{ status: 502, json: { error: 'x' } }`); klik "Tijden vastleggen": toast "✕ Route kon niet berekend worden — volgorde niet bewaard", de balk "zonder tijdstip" en de knop staan er nog, de tijden zijn niet vastgelegd.
  5. **Vergrendelstatus niet geladen**: `overschrijf['voorstel-status']` die na de eerste GET een 500 geeft; slepen of "Tijden vastleggen" → toast "✕ Vergrendelstatus kon niet geladen worden — volgorde niet bewaard".
  6. **Kaartknoppen op de ticketkaart** (nodig voor Taak 7): "⏱️ Aankomst" (toast "⏱ Aankomst geregistreerd: HH:MM" met de vaste klok, daarna "✓ Aangekomen HH:MM" op de kaart, `localStorage.blitz_arrivals` bevat de sleutel `2026-10-05__<id>`), "📋 Rapport" (wizard-dialoog "📋 Service Rapport" opent; sluiten zonder iets te doen), "📨 Voorstel" (zie Step 1.2). "✕ Uit planning halen" is gedekt door Step 2.1.
  7. **Weekstrook**: de dagknop van maandag toont "2 stops" en "⏱ nodig", na "Tijden vastleggen" "✓ tijden" (controleer of dit al ergens gedekt is; zo ja, niet dupliceren).
- [ ] **Step 3: Kaart (`route-kaart.spec.mjs`).** Tellen via DOM: markers `.leaflet-marker-icon`, paden `#map .leaflet-overlay-pane path`, `stroke`-attribuut, `.route-legende`, `#s-warn`.
  1. Standaardroute: 2 markers (nummering `1`, `2` in de div-icons), 1 pad (routelijn, kleur `settings.routeKleur` = `#f59e0b`), legende aanwezig (drukteKleuring staat standaard aan).
  2. `drukteKleuring` uit (via `blitz_settings_Tim` in `localStorage`, zoals `zetStartTijd`): geen `.route-legende`.
  3. Drukte-segmenten: `overschrijf.drukte` met `segmenten` (`startIndex`/`endIndex`, `historicSeconds`, `noTrafficSeconds`, `betrouwbaar: true`, `vertrekOffsetSeconds`) zodat de verhouding ≥ 1,25 geeft; verwacht: een pad met stroke `#ef4444`. Een tweede segment met verhouding 1,0 geeft een overgang (korte stukjes met `lineCap butt`). Leg het gemeten aantal paden vast.
  4. Leg-vangnet: `overschrijf.route` met `legs` met `historicTrafficTravelTimeSeconds` ≫ `noTrafficTravelTimeSeconds`: een gekleurd pad per rit zonder drukte-detail.
  5. Wegafsluiting: `overschrijf.route` met `sections: [{ startPointIndex: 0, endPointIndex: 2, simpleCategory: 'ROAD_CLOSURE', delayInSeconds: 0 }]`: `#s-warn` bevat "⚠ wegafsluiting op de route".
  6. **Geen duplicaten**: na elke scenario's eerste render, "Bereken tijden" nogmaals en wissel Kalender → Route: markers, paden en `.route-legende` blijven even talrijk.
  7. **Kaartstijl**: kies in `.leaflet-control-layers` "OpenStreetMap"; `localStorage.blitz_settings_Tim` bevat `kaartStijl: 'osm'` (controleer eerst of de testmodus het bewaart; zo niet, beperk tot de zichtbare actieve laag).
- [ ] **Step 4: Run.** `npx playwright test` en `node --test`: alles groen, geen productiecode gewijzigd (`git diff --stat` toont enkel `e2e/`).
- [ ] **Step 5: Commit** `test(route): karakterisering route, kaart en getoonde aankomsttijden (etappe 3)`. Noteer in de body het gemeten resultaat van Step 2.2 (verouderd of vers) en de gemeten tijden.

---

### Task 2: `route-tijden.js` — pure laag en één aankomsttijd-berekening

**Aanbevolen model:** sonnet (pure logica letterlijk overnemen, unit-tests schrijven, wrapper-omzetting)

**Feasibility:** unit (`node --test`), plus de e2e van Taak 1 als bewijs dat de getoonde tijden gelijk blijven. De differentiële vergelijking draait eenmalig lokaal.

**Files:**
- Maak: `public/js/schermen/route-tijden.js`, `tests/route-tijden.test.mjs`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`

- [ ] **Step 1: Inventaris.** Noteer de huidige regels van `berekenAankomsten`, `fmtTime` (binnen `renderRouteList`), `computeArrivalTimes`, `dagHeeftEenTechnieker`, `mergeMetAnkers`, `routeHandtekening`, `stopZonderTijdstip`, de `buitenDagklok`-closure in `applyRouteOrder`. Noteer alle oproepers (`grep -n`).
- [ ] **Step 2: Module schrijven** door de bodies **letterlijk** over te nemen (kopiëren), met `settings.vanTijd` → `vanTijd`-parameter (met hetzelfde `|| '08:00'`), `duurVoor`/`calcWerktijdMin` → `duurVoor`/`werktijdMin`, `timeStrToMin` uit `../kern/tijd.js`. `aankomstPerTicket` vervangt de lus uit `computeArrivalTimes`; `buitenDagklok(minutenRuw, uurStr, totTijd)` bevat `dagKlokLimiet = timeStrToMin(totTijd || '17:00') + 120`. `routeHandtekening(stops, eigenAfspraken)` krijgt de al gefilterde lijsten.
- [ ] **Step 3: Unit-tests** (`tests/route-tijden.test.mjs`, `process.env.TZ = 'Europe/Brussels'` bovenaan). Handberekende cases:
  - `berekenAankomsten`: zonder legs (30-min-terugval): twee tickets, `vanTijd '08:00'`, duur 120 → `[510, 660]`... reken zelf na; met legs (1200 s) en een niet-geocodeerde stop ertussen (legIdx-mapping: stop zonder `_lat` krijgt geen leg en schuift de volgende niet op); vast uur springt (`uur: '13:00'`) en volgende rekent vanaf dat uur + duur; lokale afspraak met `uur`/`einduur` gebruikt `werktijdMin`, zonder einduur 60; `duurVoor` geeft 0/`undefined` → 60.
  - `aankomstPerTicket`: enkel `kind === 'ticket'`, sleutel = `item.ticket.id`.
  - `fmtTijd(1500)` = `'01:00'`, `fmtTijd(510)` = `'08:30'`.
  - `dagHeeftEenTechnieker`: leeg, één, twee technici, leeg `assignee` telt als eigen groep.
  - `buitenDagklok`: `1440` → true; `'00:00'` → true; `totTijd '17:00'`, `'19:00'` → false, `'19:15'` → true.
  - `mergeMetAnkers`: anker op 10:00 komt vóór het eerste vrije ticket als de klok het al bijna haalt; resterende ankers achteraan; anker zonder uur achteraan; resultaat bevat de originele `item`-objecten.
  - `routeHandtekening`: volgorde-onafhankelijk (`t1|t2|l5`), gesorteerd.
  - `stopZonderTijdstip`: uur gezet → false; anker → false.
- [ ] **Step 4: Differentiële vergelijking (eenmalig, niet committen).** Schrijf in de scratchpad een script dat de oude `berekenAankomsten`-tekst uit `git show HEAD:public/index.html` haalt (regex op `function berekenAankomsten` tot de sluitende `}` op kolom 0), met stubs voor `settings`, `timeStrToMin`, `duurVoor`, `calcWerktijdMin`, en hem naast de nieuwe functie laat lopen op ≥ 300 willekeurige invoeren (verschillende `legs`, `uur`, `_lat`, kind). Resultaat moet identiek zijn. Noteer "differentieel: N invoeren, 0 verschillen" in de commitbody.
- [ ] **Step 5: Brug en `index.html`.** `brug.js`: `import * as routeTijden from '../schermen/route-tijden.js'; window.kern.route = { ...routeTijden };` (Taken 4–6 breiden uit). In `index.html`: verwijder de oude `berekenAankomsten`, `dagHeeftEenTechnieker`, `mergeMetAnkers`, `routeHandtekening`, `stopZonderTijdstip`, `fmtTime`; vervang de oproepen door `kern.route.<naam>(…, { vanTijd: settings.vanTijd, duurVoor, werktijdMin: calcWerktijdMin })`. Voeg in `index.html` twee kleine hulpfuncties toe (verhuizen in Taak 5): `legsVoorDag(date)` (`routeData?.legs && currentRouteDate === date ? routeData.legs : null`) en `aankomstenVoorDag(date)` (`stopsVoorDag(date).allStops` + `berekenAankomsten`). `renderRouteList`, `computeArrivalTimes` en `applyRouteOrder` gebruiken die. `computeArrivalTimes(date)` blijft als naam bestaan (andere oproepers, inline `onclick`) en wordt `aankomstPerTicket(...)` rond `aankomstenVoorDag`. `grep -nE "^(let|const|var) .*(berekenAankomsten|mergeMetAnkers)"` moet leeg zijn (K3).
- [ ] **Step 6: `sw.js`**: voeg `/js/schermen/route-tijden.js` toe aan `SHELL`.
- [ ] **Step 7: Run.** `node --test` (476 + nieuwe), `npx playwright test` (alles van Taak 1 ongewijzigd groen; getoonde tijden identiek).
- [ ] **Step 8: Commit** `refactor(route): route-tijden.js — één aankomsttijd-berekening (etappe 3)`.

---

### Task 3: `planning` abonneren — inventaris, `raak('planning')`, route-abonnement en restpunten

**Aanbevolen model:** sonnet (verspreide mutaties en render-semantiek; foutgevoelig)

**Feasibility:** bereikbaar in `?test`: laden (`_applyTicketsData`), "Plan deze week" (`addTicketToDate`-pad 1622/1642), "✕ Uit planning halen" (1701), toewijzen (6889), datum wijzigen (5483), annuleren/verzetten (6448: lokale tak). **Niet bereikbaar**: rollbacks na een mislukte Zoho-aanroep (1667, 1730), het succespad van `sendProposal` (6614), en vermoedelijk `reconcilePlanning` (2936). Op die plaatsen komt `raak('planning')` zonder test en blijven handmatige renders staan (R7, R12e).

**Files:** Wijzig: `public/index.html`, `e2e/kern.spec.mjs`

- [ ] **Step 1: Inventaris (expliciet, in de ledger en de commitbody).** Draai `grep -nE "planning\[[^]]*\] *=[^=]|delete planning|planning\[[^]]*\]\.(push|splice|sort|unshift|pop|shift)" public/index.html public/js/*.js` en maak een tabel: regel, functie, reikbaar in `?test` ja/nee, en welke handmatige `renderRouteList`/`updateRouteBtns` er direct op volgt. Verwacht de 10 blokken uit de spec (±26 regels): `_applyTicketsData`, de toevoegfunctie (1622/1642), de rollback (1667), `removeTicketFromDate` (1701), de rollback daarvan (1730), `reconcilePlanning` (2936), datum wijzigen (5483), annuleer/verzet-lokale tak (6448), `sendProposal` (6614), `saveToewijzen` (6889). Controleer of `planner.js` of een andere module `planning` muteert (grep; verwacht: nee).
- [ ] **Step 2: `raak('planning')`.** Eén aanroep na elk schrijfblok (niet na elke regel). Binnen `_applyTicketsData` valt het binnen de bestaande `transactie`. Taken die meerdere dagen in een lus schrijven (reconcile, `_applyTicketsData`) krijgen één `raak` na de lus.
- [ ] **Step 3: Abonnement.** In `koppelRenders`: breid het route-abonnement uit met `'planning'`. Voeg `'localEvents'` toe **alleen** als Taak 1 (Step 2.2) toonde dat de lijst nu veroudert na een nieuwe eigen afspraak; in dat geval is dit een bugfix: zet de test om naar het correcte gedrag (lijst toont de afspraak, of de hint "verouderd") en noteer een "Fixed"-regel voor Taak 8. Blijkt de lijst nu al vers, dan blijft `localEvents` weg.
- [ ] **Step 4: Handmatige renders opruimen.** Verwijder `renderRouteList(...)` en `updateRouteBtns(...)` direct na een schrijf op `planning` in de reikbare blokken; laat ze in de Zoho-gebonden blokken staan (R7). Verwijder nooit een render van `renderKalender`/`renderTickets`/`renderGepland` (etappe 4). `renderRouteList` eindigt zelf met `updateRouteBtns`; laat die dubbele oproep in `koppelRenders` staan (geen gedragsrisico).
- [ ] **Step 5: Restpunten (R16).** (a) Verwijder de verweesde commentaarregels over `planning` rond `index.html:692-693` (de twee commentaarregels `// planning: {…}` en `// Zoho is bron van waarheid…` direct boven `let routeData`; behoud wat nog klopt in één regel boven de `STATE`-kop). (b) `eigenAfspraken[dStr]` in `autoPlan` (~3758): `kern.selecties.eigenAfsprakenVoor(localEvents, dStr, activeAssigneeFilter).filter(e => e.uur)` in plaats van de eigen filter; het `.map(...)` blijft gelijk. Gedrag identiek (zelfde predicaat: `datum`, `!persoon || persoon === filter`, `uur`).
- [ ] **Step 6: Renderteller.** Draai `e2e/kern.spec.mjs`; verwacht dat de `renderRouteList`-tellingen gelijk blijven of dalen waar `planning` + `allTickets` in één flush samenkomen. Werk een dalende waarde enkel bewust bij met een commentaarregel waarom; een stijgende waarde is een fout in de abonnementen (los dat op). Voeg één test toe die bewijst dat het abonnement werkt: zet via de UI een ticket in de planning (of "✕ Uit planning halen") en controleer dat de route-lijst zonder handmatige oproep bijgewerkt is, met `renderRouteList`-delta 1.
- [ ] **Step 7: Controle.** `grep -n "planning\[" public/index.html` en de inventaris: elk blok heeft `raak('planning')`. `node --test` en `npx playwright test` groen.
- [ ] **Step 8: Commit** `refactor(route): planning in het route-abonnement, raak() op alle schrijfplaatsen (etappe 3)`. De commitbody bevat de inventaris-tabel en de lijst Zoho-gebonden blokken (zonder test).

---

### Task 4: `route-kaart.js` — Leaflet en drukte

**Aanbevolen model:** sonnet (veel code verplaatsen met behoud van gedrag; `L`-semantiek)

**Feasibility:** Leaflet laadt in e2e; markers, paden, kleuren en legende zijn waarneembaar (Taak 1, Step 3). `drukteMagnitude` is puur en krijgt een unit-test. Onbereikbaar: niets nieuws.

**Files:**
- Maak: `public/js/schermen/route-kaart.js`
- Wijzig: `public/js/schermen/route-tijden.js` (`drukteMagnitude`), `tests/route-tijden.test.mjs`, `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`

- [ ] **Step 1: Inventaris.** Noteer: `KAART_LAGEN`, `kaartBaseLayers`, `routeLegendeControl`, `DRUKTE_*`/`WEGWERK_*`/`WEGSLUITING_*`/`CAT_LABEL`-constanten, `drukteMagnitude`, `tekenWerkOfSluitingSectie`, `tekenDrukteOvergangen`, `initMap`, `applyKaartStijl`, `updateMap`, `fitBoundsToKnownStops`, `wegafsluitingToastGetoond`, en de lezers van `leafletMap`/`routeLayer` buiten het blok (`setTab` 5264, `wisRouteWeergave` 4153). `DEFAULT_SETTINGS.routeKleur` (in `updateMap`) wordt de parameter `standaardRouteKleur`; `settings` wordt `instellingen()`; `savePersonSettings(activeAssigneeFilter)` wordt `bewaarKaartStijl(sleutel)` (zet `settings.kaartStijl` en bewaart, zoals nu in `initMap`).
- [ ] **Step 2: `drukteMagnitude` → `route-tijden.js`** (puur) met unit-test: `1.25` → 3, `1.10` → 2, `1.03` → 1, `1.02` → 0, rand `1.2499` → 2.
- [ ] **Step 3: `route-kaart.js` schrijven** door de code **letterlijk** te verhuizen, met module-privé `leafletMap`, `routeLayer`, `kaartBaseLayers`, `routeLegendeControl`, `wegafsluitingToastGetoond`. `updateKaart({ date, allStops, routeData, currentRouteDate })` is de oude `updateMap(date)` (de oproeper levert `allStops`); `routeData.drukteOvergangAantal` blijft daar geschreven. `wisKaart()` is het kaartdeel van `wisRouteWeergave` (laag leegmaken, legende weg). `toast`/`escHtml` uit `../kern/ui.js`. Geen `L`-gebruik op moduleniveau (`KAART_LAGEN` gebruikt enkel strings).
- [ ] **Step 4: Brug.** `brug.js`: `window.kern.route` uitbreiden met de kaart-exports; LEGACY-namen `initMap`, `applyKaartStijl`. In `index.html`: dunne `updateMap(date)`-wrapper (`kern.route.updateKaart({ date, allStops: stopsVoorDag(date).allStops, routeData, currentRouteDate })`) zolang de routetoestand nog klassiek is (verdwijnt in Taak 5); `initKaart({...})` aan het begin van `DOMContentLoaded`, vóór de `initMap()`-oproep (943); `setTab`: `kern.route.invalideerKaartGrootte()`; `wisRouteWeergave`: `kern.route.wisKaart()`; `fitBoundsToKnownStops` → `kern.route.zoomOpGekendeStops(...)`. Verwijder de verhuisde `let leafletMap, routeLayer` en de constanten uit `index.html`.
- [ ] **Step 5: `sw.js`**: `/js/schermen/route-kaart.js` in `SHELL`.
- [ ] **Step 6: Run.** `node --test` en `npx playwright test`: de kaarttests van Taak 1 (markers, paden, kleuren, legende, wegafsluiting, geen duplicaten, kaartstijl) ongewijzigd groen. `grep -n "leafletMap\|routeLayer" public/index.html` toont niets meer.
- [ ] **Step 7: Commit** `refactor(route): route-kaart.js — Leaflet en drukte-tekening verhuisd (etappe 3)`.

---

### Task 5: `route.js` deel 1 — toestand, lijst, weekstrook, berekenen

**Aanbevolen model:** sonnet (grootste verhuizing; routetoestand uit globals halen)

**Feasibility:** `renderRouteList`, de weekstrook, `calculateRoute`, `laadDrukteDetail`, `onDateChange`, `clearDay` en `updateRouteBtns` zijn volledig in `?test` met de stubs bereikbaar en gedekt door `route.spec.mjs`/Taak 1. `routeOrderBezig()` (poll) is niet bereikbaar (R12b): enkel de accessor verhuist.

**Files:**
- Maak: `public/js/schermen/route.js`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`, `e2e/kern.spec.mjs`

- [ ] **Step 1: Inventaris.** Noteer alle lezers/schrijvers van `routeData`, `currentRouteDate`, `routeVerouderdDatum`, `dagBerekenTimer`, `_routeOrderBezig`, `window._routeSorteer`, `arrivalData`. `arrivalData` (localStorage `blitz_arrivals`) blijft in `index.html` (`registerArrival`, etappe 5); `route.js` leest het via `afh.aankomstVoor(key)`.
- [ ] **Step 2: `initRoute(afh)`.** `afh`: `duurVoor`, `werktijdMin`, `kbPreferredTime`, `geocacheLookup`, `geocacheStore`, `loadVoorstelStatus`, `loadTickets`, `heeftLopendVoorstel`, `removeTicketFromDate`, `tijdslotLabelVoor`, `bevestigdLabel`, `telNummer`, `meervoud`, `aankomstVoor`, `openProposal`, `registerArrival`, `openRapport`, `bevestigUitplannen`, `openLocalEventDetail`, `navigate`, `testModus`. Roep `initRoute({...})` aan het begin van de `DOMContentLoaded`-handler (vóór `koppelRenders()`). Geen kale globals in `route.js` buiten `document`, `localStorage`, `confirm`, `L` (via kaart), `console`.
- [ ] **Step 3: Verhuis** (letterlijk, met commentaar): `isStopLocked`, `isStopAnchored`, `legsVoorDag`, `aankomstenVoorDag`, `weekstrook*`/`renderWeekstrook`, `wisRouteWeergave` (routetoestand wissen + `wisKaart()`), `renderRouteList`, `updateRouteBtns`, `onDateChange`, `clearDay`, `calculateRoute`, `laadDrukteDetail`, en `aankomstTijdenVoorDag(date)` (de oude `computeArrivalTimes`). `settings`, `planning`, `localEvents`, `voorstelStatus`, `activeAssigneeFilter` komen uit `toestand.get(...)`; `stopsVoorDag` uit `kern/selecties.js` met die waarden. `renderRouteList` verhoogt een moduleteller; exporteer `renderTelling()` (R10). De sorteer-instantie wordt module-privé (importeer `maakSorteerbaar` uit `../sorteer.js`; nergens meer `window._routeSorteer`).
- [ ] **Step 4: Nog klassiek (Taak 6)**: `applyRouteOrder`, `optimizeRoute`, `mergeMetAnkers`-oproep blijven in `index.html` en gebruiken `kern.route.*`-exports (`renderRouteList`, `calculateRoute`, `routeActueelVoor`, …). Voeg daarvoor exports toe: `routeActueelVoor(date)`, `zetRouteLegs`-achtige toegang is **niet** toegestaan; `applyRouteOrder` heeft `routeData` nodig, dus exporteer `routeStand()` → `{ routeData, currentRouteDate }` (alleen-lezen, tijdelijk, verdwijnt in Taak 6) en `wisRouteData()` voor `routeData = null`.
- [ ] **Step 5: Brug.** `window.kern.route` uitbreiden; LEGACY-namen `renderRouteList`, `updateRouteBtns`, `onDateChange`, `calculateRoute`, `clearDay`, `computeArrivalTimes` (= `aankomstTijdenVoorDag`). Lezers buiten het blok: `setTab` → `kern.route.routeActueelVoor(date)`; instellingen opslaan → `kern.route.vernieuwKaart()`; `startTicketPolling` blijft voorlopig `_routeOrderBezig` lezen (Taak 6). Verwijder de verhuisde `let routeData, currentRouteDate`, `routeVerouderdDatum`, `dagBerekenTimer` uit `index.html` (K3-grep).
- [ ] **Step 6: `e2e/kern.spec.mjs`.** `RENDERS`: laat `renderRouteList` uit de `window`-omwikkeling en lees die teller uit `kern.route.renderTelling()` (de andere drie blijven omwikkeld). Controleer dat alle bestaande tellingen gelijk blijven (of zoals in Taak 3 vastgelegd).
- [ ] **Step 7: `sw.js`**: `/js/schermen/route.js` in `SHELL`.
- [ ] **Step 8: Run.** `node --test`, `npx playwright test`; `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` leeg.
- [ ] **Step 9: Commit** `refactor(route): route.js — lijst, weekstrook en berekenen verhuisd (etappe 3)`.

---

### Task 6: `route.js` deel 2 — slepen, optimaliseren, tijden vastleggen

**Aanbevolen model:** sonnet (Zoho-gebonden code letterlijk verhuizen, `finally`-semantiek)

**Feasibility:** `applyRouteOrder` (stappen 1–3 en 5), `optimizeRoute` en `mergeMetAnkers`-gebruik zijn in `?test` bereikbaar (Taak 1 en `route.spec.mjs`: slepen, vastleggen, optimaliseren, mislukte route, vergrendelstatus). **Stap 4 (`/api/plan-datum`) is niet bereikbaar** (`!TEST_MODE`): letterlijk verhuizen, geen test (R7, R12a); controle via byte-vergelijking.

**Files:** Wijzig: `public/js/schermen/route.js`, `public/js/kern/brug.js`, `public/index.html`

- [ ] **Step 1: Byte-referentie.** Kopieer vóór het verhuizen het blok `if (!TEST_MODE) { for (const item of stops) { … } }` van `applyRouteOrder` naar een scratch-bestand (niet committen).
- [ ] **Step 2: Verhuis** `applyRouteOrder`, `optimizeRoute` (met de `kern.api.apiVerzoek`-oproep zoals nu) en de interne `origineleUren`/`restoreOrigineleUren`/`abortDagklok`-logica; `mergeMetAnkers`, `dagHeeftEenTechnieker`, `buitenDagklok` komen uit `route-tijden.js`. De `_routeOrderBezig`-vlag wordt module-privé met de `try/finally` ongewijzigd; `routeOrderBezig()` is de accessor. In stap 4: enkel `TEST_MODE` → `afh.testModus()`; verder identiek (`fetch('/api/plan-datum', …)`, headers, body, `item.ticket.interventieDatum = …`, toast, `await loadTickets()` via `afh.loadTickets`).
- [ ] **Step 3: Brug en `index.html`.** LEGACY: `optimizeRoute`. `startTicketPolling`: `if (kern.route.routeOrderBezig()) return;`. Verwijder `routeStand()`/`wisRouteData()` uit Taak 5 (nu overbodig) en de verhuisde functies en `let _routeOrderBezig` uit `index.html`. Controleer met grep dat `applyRouteOrder`, `optimizeRoute`, `mergeMetAnkers` niet meer in `index.html` voorkomen behalve als oproep via de brug (`optimizeRoute` inline `onclick`, Taak 7).
- [ ] **Step 4: Byte-vergelijking.** Vergelijk het scratch-blok met het nieuwe blok in `route.js` (`diff`, genormaliseerde witruimte): enkel de `TEST_MODE`-regel en `loadTickets()`-verwijzing verschillen. Noteer het resultaat in de commitbody.
- [ ] **Step 5: Run.** `node --test`, `npx playwright test` (slepen, vastleggen, optimaliseren, mislukte route, vergrendelstatus, meerdere technici: ongewijzigd groen; `verzoeken.van('/api/plan-datum')` leeg; geen consolefouten). Controleer in `e2e/kern.spec.mjs` dat de renderteller niet steeg.
- [ ] **Step 6: Commit** `refactor(route): route.js — slepen, optimaliseren en tijden vastleggen verhuisd (etappe 3)`. De body noemt: het niet-asserteerbare `/api/plan-datum`-pad (R7) en de poll (R12b).

---

### Task 7: `data-actie`-delegatie voor de knoppen van dit scherm

**Aanbevolen model:** haiku (mechanisch met volledige instructie; de tests staan er al uit Taak 1; bij mislukken één tier hoger = sonnet)

**Feasibility:** de knoppen "⚡ Optimaliseer", "Bereken tijden", "✕ Leeg" en de datumkiezer zijn in `route.spec.mjs` bereikbaar (Optimaliseer en Bereken zijn gedekt; **"✕ Leeg" en de datumkiezer krijgen in deze taak eerst een test**); de vier kaartjesknoppen zijn gedekt door Taak 1 (Step 2.6 en 2.1). Niet geasserteerd: Navigeer (R12c).

**Files:** Wijzig: `public/index.html`, `public/js/schermen/route.js`, `e2e/route.spec.mjs`

- [ ] **Step 1: Test eerst.** In `route.spec.mjs`: (a) "✕ Leeg" met de bevestigingsdialoog (`confirm` via `page.on('dialog')`): beide stops verdwijnen, lijst toont "Voeg tickets of installaties toe via de Kalender"; (b) de datumkiezer: `fill` een andere datum en controleer dat de lijst van die dag verschijnt en na 300 ms (op de gestubde klok: `page.clock.runFor(300)`) een route wordt aangevraagd (extra `/api/route`-verzoek bij een dag met stops; kies terug naar 2026-10-05).
- [ ] **Step 2: Statische knoppen.** In `index.html`: `onclick="optimizeRoute()"` → `data-actie="route-optimaliseer"`, `onclick="calculateRoute()"` → `data-actie="route-bereken"`, `onclick="clearDay()"` → `data-actie="route-leeg"`; `onchange="onDateChange(this.value)"` weg. Raak geen andere attributen aan (id's, `disabled`, titels, `data-testid`).
- [ ] **Step 3: Ticketkaartjes.** In de `renderRouteList`-template: `.stop` krijgt `data-ticket-id`, `data-datum` en, enkel bij een ticketstop, `data-aankomst` (aankomstminuten of leeg); de vier `onclick`-attributen worden `data-actie="route-voorstel|route-aankomst|route-rapport|route-uitplannen"` (bij een lokale afspraak: `route-aankomst` met `data-ticket-id="<ev.id>"`). Alle waarden via `escHtml`.
- [ ] **Step 4: Handlers.** In `initRoute`: `registreerActies(document.body, { 'route-optimaliseer': () => optimizeRoute(), 'route-bereken': () => calculateRoute(), 'route-leeg': () => clearDay(), 'route-voorstel': el => { const s = el.closest('.stop').dataset; afh.openProposal(s.ticketId, s.datum, s.aankomst === '' ? null : Number(s.aankomst)); }, 'route-aankomst': el => …afh.registerArrival(id, datum), 'route-rapport': …, 'route-uitplannen': … })` en `document.getElementById('plan-date').addEventListener('change', e => onDateChange(e.target.value))`. `openProposal(…, null)` blijft `null` (niet `NaN`/`0`).
- [ ] **Step 5: Opruimen.** Verwijder de legacy-namen die niets meer kaal oproept (`optimizeRoute`, `clearDay`, `onDateChange`): `grep -nE "\b(optimizeRoute|clearDay|onDateChange)\(" public/index.html` moet leeg zijn. `calculateRoute`, `renderRouteList`, `updateRouteBtns`, `updateMap`/`vernieuwKaart`, `computeArrivalTimes` blijven in de brug (andere schermen, etappe 4/5).
- [ ] **Step 6: Run.** `node --test`, `npx playwright test`: alle route-tests, inclusief de kaartjesknoppen, groen.
- [ ] **Step 7: Commit** `refactor(route): data-actie-delegatie voor de route-knoppen (etappe 3)`.

---

### Task 8: Afronding — docs, audits en eindcontrole

**Aanbevolen model:** haiku (mechanisch; commando's en verwachte uitkomsten staan hieronder; geen code schrijven)

**Feasibility:** enkel grep- en testcommando's; geen nieuwe paden.

**Files:** Wijzig: `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Audits (resultaat in de ledger).**
  - `grep -nE "^(let|const|var) .*(routeData|currentRouteDate|leafletMap|routeLayer|routeVerouderdDatum|_routeOrderBezig|kaartBaseLayers)" public/index.html` → leeg.
  - `grep -nE "function (renderRouteList|applyRouteOrder|optimizeRoute|calculateRoute|updateMap|berekenAankomsten|computeArrivalTimes|mergeMetAnkers|initMap|laadDrukteDetail)" public/index.html` → leeg.
  - `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` → leeg.
  - `grep -n "arrivalTimes\|berekenAankomsten" public/index.html` → enkel gedeelde paden via `kern.route`.
  - `planning`-inventaris tegen `raak('planning')` (Review Focus 1): elk schrijfblok gedekt.
  - `git diff main..HEAD --stat -- public/sw.js` en `grep -n "CACHE_NAME" public/sw.js`: `SHELL` bevat `/js/schermen/route-tijden.js`, `route-kaart.js`, `route.js`; `CACHE_NAME` ongewijzigd (`blitz-planning-v25`).
- [ ] **Step 2: `CHANGELOG.md`** onder "Refactor-tak — nog niet uitgebracht": **Changed**: "Route-tab en kaart staan in eigen modules (`public/js/schermen/`); één gedeelde aankomsttijd-berekening voor route, voorstel en toewijzen; de route-lijst hertekent nu automatisch bij elke wijziging in de planning." Plus een **Fixed**-regel voor elke bug die in de ledger staat (bv. een verouderde lijst na een nieuwe eigen afspraak, als Taak 1/3 dat toonde).
- [ ] **Step 3: `CLAUDE.md`** korte sectie "Schermen (`public/js/schermen/`)" onder "Kern": de drie bestanden en hun rol; `initRoute(afh)`/`initKaart(afh)` in `DOMContentLoaded`; routetoestand is module-privé, niet in de store; nieuwe schermen volgen dit patroon; `kern.route.renderTelling` voor de e2e-teller.
- [ ] **Step 4: Run.** `node --test` en `npx playwright test` groen; noteer de aantallen in de ledger.
- [ ] **Step 5: Commit** `docs(route): changelog en conventies voor etappe 3`.

---

## Na de taken

Etappe-eindreview (sonnet, R15) met het volledige diff-pakket van `index.html` en de drie modules, gericht op de vijf punten van de Review Focus. Daarna `git merge main` vanuit de refactor-worktree (branchbeleid) en een volledige testrun. Restpunten voor etappe 4/5 (de legacy-namen `renderRouteList`, `updateRouteBtns`, `calculateRoute`, `vernieuwKaart`, `computeArrivalTimes`; de Zoho-gebonden `planning`-blokken met overbodige handmatige renders; `registerArrival`/`arrivalData`) komen in de ledger.
