# Etappe 3 — Route en kaart (`public/js/schermen/`) — design

Datum: 2026-10-01 · Opdrachtgever: Brent Calaerts · Tak: `refactor` · Basis: roadmap `2026-10-01-refactor-roadmap-design.md` (W1–W12), fundament etappe 2 (`kern/`), vangnet: 64 e2e + 476 unit

## 1. Doel

De Route-tab (lijst, weekstrook, tijden, slepen, optimaliseren, "Tijden vastleggen", kaart en drukte) verhuist uit `public/index.html` naar eigen ES-modules onder `public/js/schermen/`, op de fundamenten van `kern/`. Daarbij:

- komt er **één** aankomsttijd-berekening (backlog-item uit de roadmap: `berekenAankomsten` en `computeArrivalTimes` worden één);
- wordt de route-lijst door een toestandsabonnement hertekend, ook voor `planning` (carry-over etappe 2), zodat "vergeten te hertekenen" niet meer kan;
- is de pure logica (tijden, samenvoegen met ankers, handtekening, dagklok) unit-getest.

Zichtbaar gedrag blijft **identiek** (W5). Elke taak laat de app volledig werkend; na elke taak zijn `npx playwright test` (64 + nieuwe) en `node --test` (476 + nieuwe) groen.

Buiten scope: kalender en wachtrij (etappe 4), ticketdetail, voorstel en dialogen (etappe 5; ze blijven de route-functies oproepen via de brug), de Zoho-schrijfpaden zelf (W11), een herontwerp van de kaart.

## 2. Uitgangspunten (geverifieerd in de code, 2026-10-01)

| Feit | Gevolg |
|---|---|
| Het route-blok in `index.html` loopt van `onDateChange` (~3985) tot `updateMap` (~5212): `renderRouteList`, `renderWeekstrook`, `applyRouteOrder`, `mergeMetAnkers`, `optimizeRoute`, `calculateRoute`, `laadDrukteDetail`, Leaflet-constanten en -tekenfuncties, `initMap`, `applyKaartStijl`. Daarnaast `computeArrivalTimes` (~6056). | Het blok is aaneengesloten en goed afgebakend; het kan in drie bestanden. |
| Routeschermtoestand zijn klassieke `let`'s: `routeData`, `currentRouteDate` (694), `leafletMap`, `routeLayer` (695), `routeLegendeControl`, `kaartBaseLayers`, `routeVerouderdDatum`, `dagBerekenTimer`, `wegafsluitingToastGetoond`, `_routeOrderBezig` (730), plus `window._routeSorteer`. | K4 (etappe 2) houdt ze bewust buiten de store. Ze worden module-privé (R4). |
| Lezers buiten het blok: `setTab` (5264, 5269: `leafletMap?.invalidateSize`, `routeData`/`currentRouteDate`), instellingen opslaan (5923: `routeData && currentRouteDate → updateMap`), de ticketpoll (2963: `_routeOrderBezig`), `initMap()` in `DOMContentLoaded` (943), `applyKaartStijl()` (1389, 1444), het ticketdetail en `toggleAssignRow` (`computeArrivalTimes`, 224 en 6854), en ~12 plaatsen die `renderRouteList(...)`/`updateRouteBtns(...)` rechtstreeks oproepen. | Blijven via de `LEGACY-BRUG` werken tot etappe 4/5 (R3). |
| `computeArrivalTimes(date)` is al een dunne laag boven `berekenAankomsten(allStops, legs)`. De echte dubbeling is de herhaalde keuze "legs van de route of `null`" (`routeData?.legs && currentRouteDate === date`) in `renderRouteList` en `computeArrivalTimes`, en de aparte `fmtTime`. `applyRouteOrder` roept `berekenAankomsten` met verse stops en `routeData.legs`. Verbruikers van het resultaat: route-lijst (⏱-regel), route-kaart-knop "📨 Voorstel" (`arrivalMin`), ticketdetail-knop "📨 Voorstel", en het vooraf invullen van het tijdstip in "Toewijzen" (`toggleAssignRow`). De kalender gebruikt geen van beide (grep). | R5: één pure berekening plus één keuzehulp voor `legs`. |
| `planning` zit in de store maar **niet** in een abonnement. Er zijn 10 schrijfblokken (±26 regels) met in-place mutatie (`planning[d] = …`, `push`, `splice`, `delete planning[d]`); een toewijzing aan `planning` zelf komt niet voor. De route-lijst wordt nu na elke schrijf handmatig hertekend. | R6: inventaris als expliciete stap, in dezelfde commit als het abonnement. |
| `calcWerktijdMin` komt uit `rapport-wizard.js`; `duurVoor`, `kbPreferredTime`, `geocacheLookup/Store`, `loadVoorstelStatus`, `loadTickets`, `heeftLopendVoorstel`, `removeTicketFromDate`, `tijdslotLabelVoor`, `bevestigdLabel`, `telNummer`, `meervoud`, `openProposal`, `registerArrival`, `openRapport`, `bevestigUitplannen`, `openLocalEventDetail`, `navigate`, `savePersonSettings` staan in `index.html` (of de wizard) en horen bij andere schermen. | Nieuwe modules krijgen ze expliciet aangereikt (R3), geen kale globals. |
| Leaflet (`L`) is een klassiek CDN-script (cdnjs) en dus een echte global; in e2e laadt het echt, tegels zijn gestubd. De kaart-DOM is waarneembaar: `.leaflet-marker-icon`, `.leaflet-overlay-pane path` (stroke-kleur), `.route-legende`. | Kaart is via DOM te karakteriseren, zonder Leaflet te mocken (R8). |
| `e2e/kern.spec.mjs` telt hertekeningen door `window.renderRouteList` te omwikkelen. Zodra de functie in een module staat, omzeilen interne oproepen die omwikkeling. | R10: een teller in `route.js`. |
| `maakSorteerbaar` is een named export van `sorteer.js` (dat ook `window.maakSorteerbaar` zet). | `route.js` importeert hem rechtstreeks; `sorteer.js` blijft ongewijzigd. |

## 3. Rulings

| # | Onderwerp | Beslissing | Reden |
|---|---|---|---|
| R1 | Aanpak | Incrementeel, van blad naar kern: eerst vangnet-tests, dan de pure laag, dan het abonnement op `planning`, dan de kaart, dan het scherm (in twee stukken), dan de knop-delegatie. Elke taak één commit die groen eindigt. Geen taak verplaatst code én wijzigt gedrag. | W1, W5 |
| R2 | Bestanden | `schermen/route-tijden.js` (puur, importeerbaar in `node --test`, geen `window`/DOM): `berekenAankomsten`, `aankomstPerTicket`, `fmtTijd`, `mergeMetAnkers`, `dagHeeftEenTechnieker`, `buitenDagklok`, `routeHandtekening`, `stopZonderTijdstip`. `schermen/route-kaart.js` (Leaflet + DOM): kaartlagen, `initKaart`, `applyKaartStijl`, `updateKaart`, drukte-tekenfuncties, legende, `fitBoundsToKnownStops`. `schermen/route.js` (DOM): routetoestand, `renderRouteList`, weekstrook, `calculateRoute`, `laadDrukteDetail`, `applyRouteOrder`, `optimizeRoute`, `onDateChange`, `clearDay`, `updateRouteBtns`, `initRoute(afh)`. Alleen `route-tijden.js` wordt unit-getest; de andere twee raken DOM of `L` pas bij een oproep (nooit op moduleniveau) en worden door e2e gedekt. | W1, roadmap §3 |
| R3 | Brug | Nieuwe modules wijzen **geen** `window`-namen toe. `kern/brug.js` importeert ze en zet `window.kern.route = { …exports }` en, in het `LEGACY-BRUG`-blok, de oude namen die nog kaal worden opgeroepen: `renderRouteList`, `updateRouteBtns`, `onDateChange`, `optimizeRoute`, `calculateRoute`, `clearDay`, `updateMap`, `computeArrivalTimes`, `initMap`, `applyKaartStijl`. Dat blok verdwijnt in etappe 5. `window._routeSorteer` verdwijnt (module-privé). | Etappe 2, K2 |
| R4 | Routetoestand | Blijft **buiten** de store (bevestigt K4): `routeData`, `currentRouteDate`, `routeVerouderdDatum`, `dagBerekenTimer`, `routeOrderBezig` en de sorteer-instantie zijn privé in `route.js`; kaartstaat (`leafletMap`, `routeLayer`, legende, `wegafsluitingToastGetoond`) is privé in `route-kaart.js`. Externe lezers gebruiken exports: `routeActueelVoor(date)` (waar `routeData?.polyline?.length && currentRouteDate === date`), `routeOrderBezig()`, `vernieuwKaart()` (vervangt `if (routeData && currentRouteDate) updateMap(currentRouteDate)`), `invalideerKaartGrootte()`. | Niemand anders abonneert zich erop; een store-sleutel zou renders op de verkeerde momenten uitlokken. |
| R5 | Eén aankomsttijd-berekening | `berekenAankomsten(allStops, legs, { vanTijd, duurVoor, werktijdMin })` in `route-tijden.js` is dé berekening (letterlijk de huidige body; `settings.vanTijd`, `duurVoor`, `calcWerktijdMin` worden parameters). `aankomstPerTicket(allStops, arrivalTimes)` vervangt de lus in `computeArrivalTimes`. In `route.js` komt één `legsVoorDag(date)` (de keuze "route-legs of `null`") en één `aankomstenVoorDag(date)`; `renderRouteList`, de legacy-naam `computeArrivalTimes` en `applyRouteOrder` gebruiken die. `fmtTime` in `renderRouteList` wordt `fmtTijd`. **Resultaten blijven exact gelijk**: eerst e2e-karakterisering van alle getoonde tijden (taak 1), dan unit-tests plus een eenmalige differentiële vergelijking met de oude functie (taak 2). | Carry-over 4, backlog |
| R6 | `planning` abonneren | Het route-abonnement in `koppelRenders` wordt `['planning', 'allTickets', 'allPending', 'allGepland', 'activeAssigneeFilter']`, plus `'localEvents'` **als** de karakteriseringstest van taak 1 toont dat de lijst nu veroudert na een nieuwe eigen afspraak (de route leest ze via `stopsVoorDag`/`routeHandtekening`); blijkt ze nu al vers, dan blijft `localEvents` weg. Alle 10 schrijfblokken op `planning` krijgen `kern.toestand.raak('planning')` in **dezelfde commit** (inventaris-stap, grep-controle). Handmatige `renderRouteList`/`updateRouteBtns` direct na zo'n schrijf verdwijnen, behalve in blokken die enkel buiten testmodus draaien (hieronder). `voorstelStatus` en `klantBeschikbaarheid` blijven zonder abonnement (K6): hun schrijfplaatsen zijn Zoho-paden of etappe 5. `renderKalender()` e.d. blijven handmatig (etappe 4). | Carry-over 1, K6 |
| R7 | Zoho-pad (W11) | `applyRouteOrder` stap 4 (`/api/plan-datum`, enkel `!TEST_MODE`) verhuist **ongewijzigd** (zelfde `fetch`, headers, body, foutafhandeling); enige aanpassing: `TEST_MODE` wordt `afh.testModus()`. Niet naar `api.js` (K10: geen assertie mogelijk). Een byte-vergelijking van dat blok staat in de review. In de Zoho-gebonden blokken van de `planning`-inventaris (de rollback na een mislukte annulering/toewijzing, de succespaden van `sendProposal`) komt wel `raak('planning')`, maar blijven de bestaande handmatige renders staan (dubbel hertekenen is onschadelijk; etappe 5 ruimt op). | W11, K10 |
| R8 | Kaart | Tekencode verhuist **letterlijk** naar `route-kaart.js` (geen splitsing in "plan + toepassing": de kans op afwijking weegt niet op tegen de winst). Wat blijft: `updateKaart` krijgt alles expliciet (`date`, `allStops`, `routeData`, `currentRouteDate`, instellingen) en schrijft nog steeds `routeData.drukteOvergangAantal` (bestaand gedrag). Gedekt door DOM-karakterisering (markers, polyline, drukte-stroke-kleuren, legende, wegafsluiting-waarschuwing, geen duplicaten na herhaald renderen) en de kaartstijl-keuze. Enkel `drukteMagnitude` is puur en krijgt een unit-test. | W5 |
| R9 | Delegatie | Alleen knoppen van dit scherm: `#btn-optimize`, `#btn-route`, "✕ Leeg" (inline `onclick` → `data-actie`), en de vier knoppen op een ticketkaart in de lijst (Voorstel, Aankomst, Rapport, Uit planning halen; de ticket-id, datum en aankomstminuten staan als `data-*` op `.stop`). De datumkiezer `onchange` wordt een `change`-luisteraar in `initRoute` (`registreerActies` kent enkel `click`). Blijven ongewijzigd: de `.onclick`-closure van "Tijden vastleggen" (bewaart de `allStops` van het renderen; semantiek behouden), de weekstrook-luisteraars (staan al op de strook) en Navigeer/Details (al `addEventListener`). De functies waar de handlers naartoe wijzen (`openProposal`, …) zijn etappe 5 en worden via `afh` aangereikt. | K11, roadmap |
| R10 | Rendertelling | `route.js` houdt een teller bij (`renderRouteList` verhoogt hem) en exporteert `renderTelling()`; brug zet hem op `kern.route.renderTelling`. `e2e/kern.spec.mjs` leest die teller voor `renderRouteList` in plaats van `window.renderRouteList` te omwikkelen. Zo blijven de differentiële tellingen geldig voor ook interne oproepen. Dalen de aantallen doordat het `planning`-abonnement renders **samenvoegt** (R6), dan wordt dat per geval bewust bijgewerkt en in de commit vermeld; ze mogen nooit stijgen. | Carry-over 1 |
| R11 | Aanreiking | `initRoute(afh)` en `initKaart(afh)` worden aan het begin van de `DOMContentLoaded`-handler opgeroepen (modules zijn dan geladen, K3), vóór `initMap`-oproep en vóór `koppelRenders()`. `afh` bevat alleen de functies uit §2 (rij `calcWerktijdMin …`), plus `testModus: () => TEST_MODE`. Instellingen, `planning`, `localEvents`, `voorstelStatus`, `activeAssigneeFilter`, `klantBeschikbaarheid` worden uit `toestand` gelezen. `L` en `confirm`/`localStorage` blijven globals. | K3 |
| R12 | Niet bereikbaar in `?test` (niet migreren, niet asserteren) | (a) het `/api/plan-datum`-pad (R7); (b) de ticketpoll die `routeOrderBezig()` raadpleegt (5 min, klokstub niet nuttig): enkel de accessor verhuist, de lezer in `startTicketPolling` wordt `kern.route.routeOrderBezig()`; (c) `Navigeer` (opent een extern venster); (d) `abortDagklok` via echte stops ("te veel stops": nodig zijn >8 stops over de dagklok): enkel `buitenDagklok` krijgt een unit-test; (e) de Zoho-gebonden `planning`-schrijfblokken uit R7. Elk staat in de commitbody van de taak die het raakt. | Les etappe 2, taak 8 |
| R13 | Service worker | Elke taak die een bestand toevoegt, zet het in dezelfde commit in `SHELL` van `public/sw.js`. `CACHE_NAME`, `package.json`-versie en tags blijven onaangeroerd. | K14 |
| R14 | CHANGELOG | Onder "Refactor-tak — nog niet uitgebracht": één "Changed"-regel (route-scherm en kaart in eigen modules, één aankomsttijd-berekening, route hertekent nu ook bij wijzigingen in de planning) en een "Fixed"-regel per gevonden bug, elk met test. | W5 |
| R15 | Review | Taak-review: sonnet. Etappe-eindreview: **sonnet** (roadmap §5: opus enkel voor etappe 2 en de eindreview van de hele refactor). | W12 |
| R16 | Overgenomen restpunten | `autoPlan`'s eigen kopie van de eigen afspraken (~3758) gaat via `eigenAfsprakenVoor(...).filter(e => e.uur)` (taak 3). De verweesde commentaarregels over `planning` bij `index.html:692-693` worden opgeruimd (taak 3). | Carry-over 2, 3 |

## 4. Ontwerp per module

### 4.1 `route-tijden.js` (puur)

```js
export function berekenAankomsten(allStops, legs, { vanTijd, duurVoor, werktijdMin })  // -> { arrivalTimes, legIdx }
export function aankomstPerTicket(allStops, arrivalTimes)                               // -> { [ticketId]: minuten }
export function fmtTijd(totalMin)                                                       // 'HH:MM', uur mod 24
export function dagHeeftEenTechnieker(stops)                                            // <= 1 groep (leeg assignee = eigen groep)
export function buitenDagklok(minutenRuw, uurStr, totTijd)                              // >= 1440 | '00:00' | > totTijd + 120 min
export function mergeMetAnkers(geoptimaliseerd, ankers, { vanTijd, duurVoor, werktijdMin })
export function routeHandtekening(stops, eigenAfspraken)                                // gesorteerde 't<id>'/'l<id>' met '|'
export function stopZonderTijdstip(p, isAnker)                                          // !p.uur && !isAnker(p)
```
`vanTijd` is de ruwe tekst (`settings.vanTijd`); de module past het `|| '08:00'`-terugvalpatroon zelf toe, zoals nu. `duurVoor(ticketId)` en `werktijdMin(start, eind)` zijn de bestaande functies.

### 4.2 `route-kaart.js`

`initKaart({ instellingen, bewaarKaartStijl, standaardRouteKleur })`, `initMap()`, `applyKaartStijl()`, `updateKaart({ date, allStops, routeData, currentRouteDate })`, `wisKaart()`, `zoomOpGekendeStops(date, stops, localForDate, routeActueel)`, `herstelWegafsluitingToast()` (vervangt het resetten van `wegafsluitingToastGetoond` in `calculateRoute`), `invalideerKaartGrootte()`, `heeftKaart()`. `toast` en `escHtml` komen rechtstreeks uit `kern/ui.js`.

### 4.3 `route.js`

`initRoute(afh)`; `renderRouteList(date)`, `updateRouteBtns(date)`, `onDateChange(val)`, `clearDay()`, `calculateRoute()`, `optimizeRoute()`, `applyRouteOrder(date, entries)`; `isStopLocked`, `isStopAnchored` (intern, lezen `voorstelStatus` uit de store en `afh.kbPreferredTime`); `legsVoorDag`, `aankomstenVoorDag`, `aankomstTijdenVoorDag(date)` (= de oude `computeArrivalTimes`); `routeActueelVoor`, `routeOrderBezig`, `vernieuwKaart`, `renderTelling`. De stop-kaartjes tekenen `data-actie`-knoppen (R9); `initRoute` registreert de handlers met `kern.ui.registreerActies`.

## 5. Risico's en vangnetten

| Risico | Vangnet |
|---|---|
| Verouderde route-lijst na slepen/optimaliseren of na een wijziging in de planning | Taak 1 (karakterisering, ook de "verouderd"-hint), taak 3 (abonnement + `raak`), grep-controle `planning`-schrijfplaatsen versus `raak` |
| Aankomsttijden verschuiven (route-lijst, voorstel-tijdstip, detail, toewijzen) | e2e-karakterisering vooraf, unit-tests, eenmalige differentiële vergelijking met de oude functie |
| Sleepstatus verloren door een hertekening | `maakSorteerbaar` wordt per render vernietigd en herbouwd zoals nu; extra render-aantallen mogen niet stijgen (R10); sleeptest blijft groen |
| Kaart-markers of -lijnen dubbel na hertekenen | `updateKaart` wist de laag eerst (ongewijzigd); e2e telt markers/paden na herhaald renderen |
| Gedrag van Zoho-pad verandert (W11) | R7: letterlijk verhuizen, enkel `TEST_MODE`-verwijzing; byte-vergelijking in de review |
| Laadvolgorde (klassiek script vóór modules) | R11: `initRoute`/`initKaart` in `DOMContentLoaded`; geen gebruik van `kern.route` op het hoogste niveau (grep per taak) |

## 6. Succescriteria

- `public/js/schermen/` bevat `route-tijden.js`, `route-kaart.js`, `route.js`; unit-tests voor `route-tijden.js`.
- `index.html` bevat geen definities meer van de route-functies uit §3/R2 (enkel oproepen via de brug), geen `routeData`/`currentRouteDate`/`leafletMap`/`routeLayer`-`let`'s, en geen `window._routeSorteer`.
- Eén aankomsttijd-berekening; alle getoonde tijden ongewijzigd (e2e).
- Elk schrijfblok op `planning` heeft `raak('planning')`; het route-abonnement dekt `planning`.
- Geen nieuwe `window`-toewijzing buiten `kern/brug.js`.
- `npx playwright test` en `node --test` groen; Zoho/TomTom/mail nooit aangeroepen; sw `SHELL` compleet, `CACHE_NAME` ongewijzigd.
