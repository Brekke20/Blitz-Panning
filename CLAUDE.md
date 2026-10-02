# Blitz Planning — project conventions

## Stack

Single-file PWA: `public/index.html`  
Serverless backend: `netlify/functions/` (ES modules, Netlify Blobs `blitz-data` store, `consistency: 'strong'`)

## Excel exports (browser-side)

**Use ExcelJS, not SheetJS.**  
SheetJS community edition (v0.18.5, the free build) silently ignores the `.s` cell style property — styled output looks completely unstyled with no error. ExcelJS supports full cell styling.

```html
<script src="https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"></script>
```

All Excel exports must auto-size columns and rows so all text is always visible:
- Dynamic column width: `max(header_length + 2, max_data_length + 1, 8)`, capped at 36 (non-wrap) or `WRAP_MAX` for wrap columns
- Dynamic row height: `Math.ceil(text.length / (colWidth * 1.15)) * 14 + 2`

## TicketLog export — field mappings

| Excel column | Source field | Values |
|---|---|---|
| Type | `rd.interventieType` | Interventie / Installatie |
| Prio | `rd.prioriteit` / `_wizTicket.priority` | Laag / Middel / Hoog |
| Notities | `rd.probleem` | vrije tekst (gerapporteerd probleem) |
| Actie | `rd.acties` | vrije tekst (uitgevoerde werkzaamheden) |

**Type is NOT the charger hardware type** — it is the visit type (Interventie vs Installatie), stored in `R.interventieType`.

## Rapport wizard — R object key fields

- `R.interventieType` — "Interventie" | "Installatie" (type bezoek, radio in stap Algemeen)
- `R.probleem` — gerapporteerd probleem (Notities in TicketLog)
- `R.acties` — uitgevoerde acties (Actie in TicketLog)
- `R.prioriteit` — comes from `_wizTicket.priority`, stored in archief POST body
- Installateur betrokken: leeg = "Nee", gevuld = "Ja" (source: `rd.installateur`)

## Tests

- `node --test` (zonder pad) — logica-tests (649). Nooit `node --test tests/`.
- `npx playwright test` — Playwright-flows (kernhandelingen van de app, alle `/api/*` gestubd); 276 tests. Draai dit na elke taak die een scherm raakt.
- Eerste keer: `npm install` en daarna `npx playwright install chromium`.

De e2e-suite heeft internet nodig: de app laadt zijn scripts van externe CDN's (cdnjs.cloudflare.com, cdn.jsdelivr.net) en die worden bewust niet gestubd. Faalt een run op netwerkfouten voor die hosts (bv. een script dat niet laadt), dan is dat geen regressie in de app: controleer de verbinding en draai opnieuw.

### Productiemodus-tests

Productietests staan in `e2e/productie/` en draaien de app zonder `?test` querystring tegen een volledig gestubde backend. Het doel: de Zoho-berichten van planning, voorstel en annuleren precies controleren.

- Fixture `e2e/productie-hulp.mjs` (enkel hieruit importeren, nooit `helpers.mjs` of `@playwright/test`; `serviceWorkers: 'block'` staat ook in de fixture): `startAppProductie()` met rol/technieker/opties, `zohoStubs()` met nep-endpoints voor `plan`, `plan-datum`, `propose`, `voorstel-status`, `annuleer` en `optimize`, `settle`/`openKalender` als wachthulpen (geen `waitForTimeout`).
- `verwachtSchrijven(verzoeken, paden)`: whitelist per test; elk niet-GET verzoek naar de eigen server buiten de lijst faalt.
- `verwachtHttpFout(verzoeken, fouten)`: per test gescoped; faalt ook als de verwachte HTTP-fout niet voorkwam.
- `e2e/productie-waarnemer.mjs`: de waarnemer die lekmeldingen, onverwachte verzoeken en consolefouten bijhoudt, plus de alleen-lezen weergaven (`alleenLezen`, `origineelVan`) zodat een spec ze niet kan wissen of wijzigen; enkel de fixture en de zelftest importeren hem.
- `e2e/vangnet-regels.mjs`: `isToegestaan`, de regels van de extra route met voorrang (geen Zoho/TomTom/mail, CDN enkel GET/HEAD); unit-getest in `tests/e2e-vangnet.test.mjs`.
- WebSocket-slot (`zetWebSocketSlot`): elke WebSocket-verbinding faalt de test.
- Parity-tests: `e2e/tickets-pariteit.spec.mjs` (aparte `?test`-spec: `e2e/fixtures/tickets.json` is gelijk aan `DUMMY_DATA` in `index.html`) en `tests/e2e-annuleer-redenen.test.mjs` (`ANNULEER_REDENEN` in de fixture is gelijk aan `REDENEN` in `netlify/lib/annulatie.js`).
- Importguard `tests/e2e-import-guard.test.mjs` (draait bij elke `node --test`, scant `e2e/` recursief): een spec importeert `test` enkel uit de juiste fixture (`./helpers.mjs` of, onder `e2e/productie/`, `../productie-hulp.mjs`); geen `@playwright/test` rechtstreeks; productiebestanden hebben geen eigen routes, geen `waitForTimeout`, geen `?test`/`X-Blitz-Test`, geen eval/`child_process`/`vm`/`createRequire`, geen `page.request`/`context.request`/`request`-fixture, geen `browser.newContext`/`newPage`, geen `node:http`/`https`/`net`/`tls`/`dns`/`http2` en geen `fetch(`; de ontsnappingskleppen van de waarnemer enkel in de zelftest.
- Zelftest `e2e/productie/vangnet-zelftest.spec.mjs` (met `zelftest-hulp.mjs`): bewijst op de echte host dat Zoho, TomTom, smtp, POST naar de CDN, WebSockets en onbekende `/api`-paden geblokkeerd of gemeld worden, dat de whitelist en de alleen-lezen weergaven werken en dat `verwachtHttpFout` faalt als de fout uitblijft.

## Serverkant (`netlify/lib/`)

Etappe 6 van de refactor: gedeelde serverbouwstenen. Gebruik ze voor elke nieuwe Zoho- of TomTom-functie.

- `netlify/lib/zoho.js`: `maakZoho({ fetch, env, nu, tokenFoutMetData, orgFoutTekst })` voor token (55 min cache in de instantie), org-id, headers en `verzoek`; `leesJsonVeilig` voor antwoorden die leeg of geen JSON kunnen zijn. Maak de instantie op moduleniveau, of in `maakHandler` voor functies met injecteerbare fetch.
- `netlify/lib/http.js`: CORS-sets en v1/v2-antwoord-, OPTIONS- en methodehulpen. Geen eigen CORS-literals in functies.
- Uitzonderingen met een eigen kopie: `rapport.js` (Chromium en Blobs-register zijn onbereikbaar voor tests) en `setup.js` (grant-code-uitwisseling).
- Tests: `tests/nep-fetch.mjs` (`maakNepFetch`, `laadVers`, `metGlobaleFetch`, `v1Event`, `zetEnv`). Nooit echte Zoho-, TomTom- of mailaanroepen; `globalThis.fetch` staat standaard op een functie die gooit.
- Karakterisering eerst: leg bij het migreren of wijzigen van een functie eerst het huidige gedrag vast (uitgaande verzoeken, statussen, headers, foutteksten) in `tests/server-*.test.mjs`. Een karakteriseringstest wijzig je alleen bewust (bv. bij een bugfix, met commentaar), nooit stilzwijgend.

## Kern (`public/js/kern/`)

Gedeelde fundamenten (etappe 2 van de refactor): `tijd`, `ui`, `selecties`, `toestand`, `api`.

- Het zijn pure ES-modules, importeerbaar in `node --test`. Enkel `kern/brug.js` raakt `window` aan
  (`window.kern` + de oude globale namen en state-accessors in het `LEGACY-BRUG`-blok; dat blok verdwijnt in etappe 5b-9).
- `kern/omgeving.js`: exporteert enkel `TEST_MODE` (true bij `?test` in de URL; de enige bron, zonder setter en niet op `window`).
- `kern/ui.js`: `registreerWijzigActies(wortel, handlers)` voor `data-wijzig`- en `data-invoer`-delegatie; `registreerBackdrop(overlayEl, sluit)` voor de donkere achtergrond van vensters.
- Regel K3: klassieke code op het hoogste niveau van `index.html` gebruikt `window.kern`, accessors of
  verhuisde functies nooit (de brug laadt pas als module); alleen binnen function-bodies. Controle bij een
  verhuizing: `grep -nE "^(let|const|var) .*<naam>"`.
- Muteer je een geabonneerde toestandssleutel in-place (`localEvents.push`, `avExceptions.splice`, `allTickets.sort`, ...),
  roep dan `kern.toestand.raak('<sleutel>')` aan; een toewijzing verwittigt vanzelf.
- Een abonnee die gooit wordt gelogd (`toestand: abonnee faalde`) en bereikt de oproeper niet; een abonnee die tijdens een flush
  wordt toegevoegd mist die ronde; `settings` is `null` tot DOMContentLoaded.
- Abonnementen op de toestand staan op één plek: `koppelRenders()` in `index.html`. Geen losse `renderX()` naast een abonnement.
- Opslaan met optimistic locking via `kern.api.bewaarMetVersie` (merge + één retry bij 409), zoals `saveAfspraken` en `saveKlantBeschikbaarheid`.
- Tijd-tests zetten `process.env.TZ = 'Europe/Brussels'` bovenaan; draai `node --test` zonder pad, nooit `node --test tests/`.
- Een nieuw kern-bestand komt in dezelfde commit in `SHELL` van `public/sw.js`.

## Schermen (`public/js/schermen/`)

Schermonderdelen die hun eigen toestand beheren (niet in `kern.toestand`), maar via `initRoute(afh)`, `initKaart(afh)`, `initWachtrij(afh)`, `initKalender(afh)`, `initIngepland(afh)` en `initCapaciteit(afh)` in `DOMContentLoaded` initialiseren (vóór `koppelRenders`).

**Etappe 3 (Route en kaart):**
- `route-tijden.js`: pure berekeningen (aankomsttijden, samenvoegen met ankers, handtekening, dagklok). Unit-getest met `node --test`.
- `route-kaart.js`: Leaflet-kaart, markers, polylines, drukte-tekening, legende. Geen `L` of DOM op moduleniveau, enkel in functies.
- `route.js`: Route-scherm (lijst, weekstrook, berekenen, slepen, optimaliseren, vastleggen). Private toestand: `routeData`, `currentRouteDate`, `routeVerouderdDatum`, `_routeOrderBezig`, sorteer-instantie. Unit-tests: `tests/route.test.mjs` en `tests/route-volgorde.test.mjs` (naast `route-tijden`).

**Conventies:**
- Routetoestand (private: `routeData`, `currentRouteDate`, …) blijft buiten de store; lezers gebruiken exports: `routeActueelVoor(date)`, `routeOrderBezig()`, `vernieuwKaart()`, `invalideerKaartGrootte()`.
- Afhankelijkheden (functies uit andere schermen) worden via `afh` aangereikt; instellingen en toestandsgegevens uit `kern.toestand`.
- `kern.route.renderTelling()` is de teller die de e2e-tests gebruiken (interne aanroepen omzeilen een wrapper op `window`). Een wijziging in de planning geeft via het abonnement precies één route-render.
- `kern.route` is de namespace van het routescherm op `window.kern` (o.a. `renderTelling`); e2e-tests lezen daar de render-teller en de kaartaantallen uit.
- Knoppen van het scherm gebruiken `data-actie="route-..."` (delegatie in `route.js`) in plaats van inline handlers; gegevens staan op `data-*` attributen van de stop.
- Resterende LEGACY-BRUG-namen voor het routescherm: `renderRouteList`, `updateRouteBtns`, `calculateRoute`, `computeArrivalTimes`, `initMap`, `applyKaartStijl`. Ze verdwijnen in etappe 5b-9; gebruik ze niet in nieuwe code.
- Nieuwe schermen volgen dit patroon: module-privé toestand, expliciet aangereikte functies, exports voor lezers.

**Etappe 4 (Kalender en wachtrij):**
- `capaciteit.js`: pure berekeningen (aantalmodel: `blokkeerMinuten`, `capaciteitVoorDag`, `volgendeBeschikbareDag`, `capaciteitsKop`, lezers `capacityForDay` en `kern.capaciteit.nextAvailableDay()`). Unit-getest met `node --test`.
- `wachtrij-logica.js`: pure berekeningen (zoeken, sorteren, scoren: `filterOpZoek`, `sorteerWachtrij`, `queueScore`). Unit-getest.
- `kalender-logica.js`: pure berekeningen (tijdlijnindeling, zichtbare dagen, maandraster: `bepaalLanes`, `zichtbareDagen`, `maandRaster`). Unit-getest met DST-weken.
- `wachtrij.js`: Wachtrij-scherm (kaarten, zoeken, sorteren, teller). Private toestand: `wqZoek` en de sorteerinstelling `wqSorteer`. Bevat ook `quickAdd`. Init via `initWachtrij(afh)` vóór `koppelRenders()`.
- `kalender.js`: Kalender-scherm (week/maand, kaarten, navigatie, teller). Private toestand: `kalOffset` (een getal: weken, in maandweergave maanden), `kalDagOffset`, `kalView`, `_kalAutoScrollKey`. Lezers: `kern.kalender.weekOffset()` en `kern.kalender.activeerKalender()`. De capaciteitskop wordt hier getekend. Init via `initKalender(afh)` vóór `koppelRenders()`.
- `ingepland.js`: Ingepland-scherm (kaarten, teller). Private toestand: `gepOffset`. Init via `initIngepland(afh)` vóór `koppelRenders()`.

**Etappe 5a (Ticketdetail, voorstel, annuleren):**
- `ticketdetail-logica.js`: pure berekeningen (aankomsttijden, afrondingstijden, onderwerpschoning, termen: `tijdslotVoor()`, `roundToNextQuarterStr()`, `cleanTicketSubject()`, `joinNL()`, `meervoud()`, `telNummer()`, `bevestigdLabel()`, `heeftLopendVoorstel()`, plus de gedeelde constante `DOELGROEP_LABEL`). Unit-getest met `node --test`.
- `ticketdetail.js`: Ticketdetail-venster (taken, voorstel, annuleren, toewijzen, aankomst). Init via `initTicketdetail(afh)` vóór `koppelRenders()`. Private toestand: `activeTicket` en `_detailDate` (lezers `actiefTicket()`, `detailDatum()`) en `_kbIsDirty` (via `zetKbIsDirty`); `arrivalData` is een export (route en wizard lezen het). Knoppen gebruiken `data-actie`-delegatie; Zoho-functies verhuizen via productietest als vangnet.
- `voorstel.js`: Voorstelvenster (datum, tijd, ontvangers, voorbeeld, verzenden). Init via `initVoorstel(afh)`. Private toestand beheerd via accessors. Afh: `getPlanningTicket`, `sluitDetailStil`, `actiefTicket`, `zetActiefTicket`, `renderRouteList`.
- `annuleren.js`: Annuleervenster (reden, toelichting, mailkeuze). Init via `initAnnuleren(afh)`. Private toestand. Afh: `sluitDetailStil`, `actiefTicket`, `loadVoorstelStatus`, `renderRouteList`, `updateRouteBtns`, `inFlight`. `zetRedenenVoorTest` gooit buiten `?test`.
- `venster.js` export `registreerVenster({ el, isOpen, sluit })`: registreert per venster Escape-gedrag en focusbeheer (de achtergrondklik loopt via `kern.ui.registreerBackdrop`); de tabel in `venster.js` blijft bestaan voor de dialogen die nog niet verhuisd zijn. Geen nieuwe LEGACY-BRUG-namen (D13).

**Conventies:**
- Afhankelijkheden (functies uit klassieke code) worden via `afh` aangereikt; instellingen en toestandsgegevens uit `kern.toestand`.
- `kern.wachtrij.renderTelling()`, `kern.kalender.renderTelling()`, `kern.ingepland.renderTelling()` zijn de tellers die de e2e-tests gebruiken.
- Knoppen gebruiken `data-actie`-delegatie in plaats van inline handlers. Elke kaartluisteraar heeft een **bubbel-guard**: `if (e.target.closest('[data-actie]')) return;` om te voorkomen dat kaarten openen.
- `quickAdd` (`wachtrij.js`) en de capaciteitskop (`n/cap · ±u`, getekend in `kalender.js`) gebruiken het aantalmodel van `capaciteit.js`, niet het brein (spec C3).
- `kern.ui.strengeAfh(scherm, afh)` bewaakt de `afh`-objecten: een ontbrekende `afh`-sleutel gooit, zowel vóór als na de init.
- Blokkeringen en selecties gebruiken `kern.selecties.blokkeringenVoor` en `kern.ui.maakActiveerbaar`.
- Resterende LEGACY-BRUG-namen voor deze schermen: `renderTickets`, `renderKalender` (`renderGepland` is weg; gebruik `kern.ingepland.renderGepland()`). Het LEGACY-BRUG-blok verdwijnt in etappe 5b-9; gebruik ze niet in nieuwe code.

## Versioning & changelog

Sinds 2026-08-13 uit bèta — semver vanaf **v1.0.0**, bijgehouden in `package.json`
(`version`) en als git-tag (`vX.Y.Z`) op de commit die effectief gedeployed wordt.

- **PATCH** (`x.y.Z+1`): bugfixes, kleine niet-zichtbare aanpassingen, geen nieuwe functionaliteit.
- **MINOR** (`x.Y+1.0`): nieuwe, backward-compatible functionaliteit (nieuwe rapporttypes, nieuwe
  tabs/schermen, uitbreidingen op bestaande features).
- **MAJOR** (`X+1.0.0`): breekt bestaand gedrag/data (bv. een datamodel-wijziging die oude
  gearchiveerde data niet meer correct weergeeft, verwijderen van een bestaande feature).

Elke release die naar productie gaat: versie ophogen in `package.json`, een entry toevoegen aan
`CHANGELOG.md` (Keep a Changelog-stijl, secties **Added/Changed/Fixed/Deprecated**), git-tag zetten
op de merge/deploy-commit. Dit gebeurt als aparte, expliciete stap bij het afronden van een
branch (`finishing-a-development-branch`) — niet per taak/subagent-commit.

## Branchbeleid (sinds 2026-10-01, besluit van Brent) — LEES DIT VOOR JE IETS BOUWT

Er lopen twee sporen naast elkaar. Houd ze strikt gescheiden.

| Tak | Wat | Wat mag erop |
|---|---|---|
| `main` | de **live versie** (Netlify deployt bij elke push) | **alleen bugfixes** (PATCH, v1.10.x). Geen nieuwe functies, geen herstructurering, geen refactors. |
| `refactor` | de **volledige refactor** in uitvoering, te beginnen met het planner-brein (`public/js/planner.js`). Worktree `.claude/worktrees/planner-brein` | alle structurele werk en nieuwe functies, tot de volledige refactor klaar en getest is |

Regels:
- **Nooit `refactor` (of een tak die ervan afstamt) mergen naar `main` of pushen naar `main`**, tot Brent uitdrukkelijk zegt dat de volledige refactor klaar en getest is. Een lokale pre-push-hook (`.git/hooks/pre-push`) blokkeert zo'n push. Omzeil die hook nooit (`--no-verify` is verboden).
- Een nieuwe functie of structurele wijziging die Brent vraagt, hoort op `refactor`, niet op `main`. Twijfel je of iets een "bugfix" is: vraag het Brent.
- **Elke bugfix op `main` wordt daarna ook in `refactor` binnengehaald** (`git merge main` vanuit de refactor-worktree), zodat de twee sporen niet uit elkaar groeien. Noteer het in de ledger van de refactor.
- Versienummers: `main` krijgt PATCH-versies (1.10.2, 1.10.3, …). Op `refactor` wordt de versie **niet** opgehoogd en `CACHE_NAME` in `public/sw.js` niet aangepast; dat gebeurt pas bij de uiteindelijke release (vermoedelijk 2.0.0 of 1.11.0, beslissing bij Brent). Wijzigingen op `refactor` staan in `CHANGELOG.md` onder "Refactor-tak — nog niet uitgebracht".
- Stand van de refactor en alle beslissingen: `docs/superpowers/specs/2026-09-30-planner-brein-design.md`, `docs/superpowers/plans/2026-10-01-planner-brein.md` en de ledger `.superpowers/sdd/2026-10-01-planner-brein/progress.md` in de refactor-worktree.
