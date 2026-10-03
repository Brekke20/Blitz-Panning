# Blitz Planning — project conventions

## Stack

Single-file PWA: `public/index.html`  
Serverless backend: `netlify/functions/` (ES modules, Netlify Blobs `blitz-data` store, `consistency: 'strong'`)

## Excel exports (browser-side)

**Use ExcelJS, not SheetJS.**  
SheetJS community edition (v0.18.5, the free build) silently ignores the `.s` cell style property — styled output looks completely unstyled with no error. ExcelJS supports full cell styling.

ExcelJS wordt NIET met een `<script>`-tag in `index.html` geladen (dat blokkeert de opstart). Gebruik `laadExcelJs()` uit `public/js/kern/exceljs.js`: die haalt de bibliotheek (`EXCELJS_URL`, `https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js`) pas bij de eerste export op. Zet het blokkerende script nooit terug.

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

- `node --test` (zonder pad) — logica-tests (871). Nooit `node --test tests/`.
- `npx playwright test` — alle Playwright-projecten samen (`chromium` en `sw`), alle `/api/*` gestubd; 488 + 15 = 503 tests (een volledige run duurt ongeveer 12 minuten). Draai dit na elke taak die een scherm raakt. Gericht: `npx playwright test --project=chromium` of `--project=sw`.
- Eerste keer: `npm install` en daarna `npx playwright install chromium`.

De e2e-suite heeft internet nodig: de app laadt Leaflet en signature_pad van cdnjs.cloudflare.com (bewust niet gestubd) en de Excel-export-tests halen ExcelJS van cdn.jsdelivr.net. Faalt een run op netwerkfouten voor die hosts (bv. een script dat niet laadt), dan is dat geen regressie in de app: controleer de verbinding en draai opnieuw.

**OneDrive en `ENOENT`-fouten.** De repo staat in OneDrive, dat nieuwe bestanden vergrendelt en synchroniseert; dat gaf `ENOENT` op trace- en tijdelijke bestanden. Daarom schrijft Playwright zijn uitvoer naar `path.join(os.tmpdir(), 'blitz-planning-pw')` (`outputDir` in `playwright.config.mjs`, buiten OneDrive) en staat `trace` lokaal uit (`process.env.CI ? 'retain-on-failure' : 'off'`). Zet een trace dus enkel gericht aan (`--trace=on`). Sluit bovendien `node_modules/`, `test-results/` en `.blobs-local-test/` uit van OneDrive-synchronisatie (rechtsklik > "Altijd op dit apparaat bewaren" uitzetten, of de repo buiten OneDrive plaatsen). `tests/playwright-config.test.mjs` pint `outputDir`, de trace-instelling en het DNS-slot (`--host-resolver-rules`) van het project `sw` vast.

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

### Service worker-tests (project `sw`)

Specs in `e2e/sw/` draaien met een ECHTE service worker (`serviceWorkers: 'allow'`) in het aparte Playwright-project `sw`; het project `chromium` blijft `serviceWorkers: 'block'` en negeert `e2e/sw/**`. Draaien: `npx playwright test --project=sw`. Ze zijn apart omdat een echte SW het verkeer van alle andere specs zou veranderen (cache, offline start) en omdat ze extra sloten nodig hebben.

- Fixture `e2e/sw-hulp.mjs` (enkel hieruit importeren, nooit `helpers.mjs`, `productie-hulp.mjs` of `@playwright/test`): bovenop de zes sloten van de productiemodus (host-toelatingslijst, `/api` gestubd, schrijfpaden-whitelist, `isToegestaan`, WebSocket-slot, geen testmodus-signalen; ze zien ook het verkeer van de SW zelf) komen een SW-waarnemer (`e2e/sw-waarnemer.mjs`: een verzoek van de SW naar `/api`, een niet-GET of een vreemde host faalt de test) en het browserslot `--host-resolver-rules` in `playwright.config.mjs` (buiten localhost en de twee CDN-hosts lost niets op, ook niet voor de SW). Geen `?test`.
- De `sw`-fixture bedient offline-modus (`zetOffline`), traag verkeer (`hangVoor`, `vertraag`, `breekAf`), een eigen `navTimeout` (`registreerSwMetNavTimeout`) en het vervangen van `sw.js`. `serviceWorkers` en `setOffline` mogen enkel in `e2e/sw-hulp.mjs` voorkomen; de importguard (`tests/e2e-import-guard.test.mjs`, derde klasse "sw-bestanden") dwingt dat af, naast alle productieregels (geen eigen routes, geen `waitForTimeout`, geen `test.use`/`test.extend`).
- Het updatepad (oude SW naar nieuwe SW) wordt getest met een bevroren kopie van de live-SW: `e2e/fixtures/sw-v25-main.js` (`e2e/sw/update.spec.mjs`). Elke test draait in een verse browsercontext, dus `CACHE_NAME` hoeft voor de tests niet te veranderen.
- Zelftest `e2e/sw/vangnet-zelftest.spec.mjs` bewijst dat de sloten ook voor SW-verkeer werken.

Nieuwe fixture-helpers van etappe 7 (productie-fixture `e2e/productie-hulp.mjs`, ook via `sw-hulp.mjs`):
- `zetAntwoord(naam, { afbreken: 'failed' })` en een hangend antwoord om een time-out of netwerkfout na te bootsen; `verwachtNetwerkFout(verzoeken, [{ pad, methode }])` laat precies die netwerkfout (eenmalig, op pad, methode en eigen origin) toe en faalt als ze uitblijft.
- `verwachtConsoleFout(verzoeken, fouten)`: een toegelaten consolefout, exact of als `RegExp`; een lege of te losse waarde wordt geweigerd.
- `startAppProductie(page, { klok: false })` laat de echte klok lopen; standaard staat de nepklok (`page.clock`) aan en laten tests timers lopen met `page.clock.runFor`.
- `staaOfflineSwFoutenToe` / `herroepOfflineSwFoutenToe` (enkel voor de `sw`-fixture, smal en herroepbaar) en `OPSTART_SCHRIJVEN`.

## Serverkant (`netlify/lib/`)

Etappe 6 van de refactor: gedeelde serverbouwstenen. Gebruik ze voor elke nieuwe Zoho- of TomTom-functie.

- `netlify/lib/zoho.js`: `maakZoho({ fetch, env, nu, tokenFoutMetData, orgFoutTekst })` voor token (55 min cache in de instantie), org-id, headers en `verzoek`; `leesJsonVeilig` voor antwoorden die leeg of geen JSON kunnen zijn. Maak de instantie op moduleniveau, of in `maakHandler` voor functies met injecteerbare fetch.
- `netlify/lib/http.js`: CORS-sets en v1/v2-antwoord-, OPTIONS- en methodehulpen. Geen eigen CORS-literals in functies.
- `/api/mail-check` (`netlify/functions/mail-check.js` + `netlify/lib/mailcontrole.js`, etappe 7): GET `?ticketId=&verlopenMs=[&ontvangers=]` (`verlopenMs` = verstreken ms sinds de start van de verzending, 0 tot 900000; de server rekent `sinds` met zijn eigen klok, marge 10 s; timeout 26 s in `netlify.toml`); leest de uitgaande threads van het ticket in Zoho Desk (met paginering) en antwoordt `{ ok, verzonden, twijfel, tijdstip, uitgaand, ontvangers? }`. ENKEL LEZEN: nooit `sendReply`, PATCH of een andere schrijfactie. Bij elke twijfel (onleesbaar adres, concept- of mislukte status) is `twijfel` waar. Nog niet getest op een echt Zoho-ticket (zie de release-checklist).
- Uitzonderingen met een eigen kopie: `rapport.js` (Chromium en Blobs-register zijn onbereikbaar voor tests) en `setup.js` (grant-code-uitwisseling).
- Tests: `tests/nep-fetch.mjs` (`maakNepFetch`, `laadVers`, `metGlobaleFetch`, `v1Event`, `zetEnv`). Nooit echte Zoho-, TomTom- of mailaanroepen; `globalThis.fetch` staat standaard op een functie die gooit.
- Karakterisering eerst: leg bij het migreren of wijzigen van een functie eerst het huidige gedrag vast (uitgaande verzoeken, statussen, headers, foutteksten) in `tests/server-*.test.mjs`. Een karakteriseringstest wijzig je alleen bewust (bv. bij een bugfix, met commentaar), nooit stilzwijgend.

## Kern (`public/js/kern/`)

Gedeelde fundamenten (etappe 2, 5b en 7 van de refactor): `tijd`, `ui`, `selecties`, `toestand`, `api`, `omgeving`, `opslag`, `feestdagen`, `testdata`, `verklikker`, `netwerk`, `exceljs`, `verbruik-wachtrij`, `mailcontrole`.

- Het zijn pure ES-modules, importeerbaar in `node --test`. Enkel `kern/brug.js` raakt `window` aan
  (`window.kern` en de `window.kern.<scherm>`-namespaces; er zijn geen oude globale namen of state-accessors meer).
- `kern/omgeving.js`: exporteert enkel `TEST_MODE` (true bij `?test` in de URL; de enige bron, zonder setter en niet op `window`).
- `kern/ui.js`: `registreerWijzigActies(wortel, handlers)` voor `data-wijzig`- en `data-invoer`-delegatie; `registreerBackdrop(overlayEl, sluit)` voor de donkere achtergrond van vensters.
- Er is geen klassiek app-script meer: `index.html` laadt `kern/brug.js` eerst en `app.js` laatst als modules (enkel `apparaat.js` blijft een klassiek script) en elke module importeert wat ze nodig heeft. Een kale naam die niet geïmporteerd of lokaal gedefinieerd is, bestaat dus niet; `tests/window-namen.test.mjs` bewaakt dat (geen `window.<naam>`-lezing zonder definitie, geen kale lezer van opgeruimde namen, `window`-toewijzingen onder `kern/` en `schermen/` alleen in `brug.js`).
- `kern/ui.js` bevat ook `metBehoudScroll(fn)` en `zetPressed(el, aan)`; `kern/opslag.js` de cache- en geocachehulp (`loadFromCache`, `saveToCache`, `geocache*`); `kern/feestdagen.js` de Belgische feestdagen (puur); `kern/testdata.js` de dummydata van de testmodus (puur, `maakDummyData()`); `kern/verklikker.js` de tijdelijke scrollsprong-verklikker (`sjLog`, `startVerklikker`).
- Muteer je een geabonneerde toestandssleutel in-place (`localEvents.push`, `avExceptions.splice`, `allTickets.sort`, ...),
  roep dan `kern.toestand.raak('<sleutel>')` aan; een toewijzing verwittigt vanzelf.
- Een abonnee die gooit wordt gelogd (`toestand: abonnee faalde`) en bereikt de oproeper niet; een abonnee die tijdens een flush
  wordt toegevoegd mist die ronde; `settings` is `null` tot DOMContentLoaded.
- Abonnementen op de toestand staan op één plek: `koppelRenders()` in `public/js/app.js`. Geen losse `renderX()` naast een abonnement.
- Opslaan met optimistic locking via `kern.api.bewaarMetVersie` (merge + één retry bij 409), zoals `saveAfspraken` en `saveKlantBeschikbaarheid`.
- Tijd-tests zetten `process.env.TZ = 'Europe/Brussels'` bovenaan; draai `node --test` zonder pad, nooit `node --test tests/`.
- `kern/netwerk.js` (etappe 7): `installeerFetchTimeout(window)` omhult `window.fetch` voor same-origin `/api`-verzoeken met een time-out: `TIJDLIMIETEN` = standaard 20 s, lang 35 s (`propose`, `send-rapport`, `annuleer`, `rapport`, `planning-sinds`, `planning-export`), foto-upload (`PUT /api/fotos`) 60 s; `limietVoor(pad, methode)`. Een aanroeper die zelf een `signal` meegeeft (de outbox) blijft onaangeroerd: hij beheert zijn eigen annulering. De timer loopt tot de antwoordkop. Een `TypeError` van fetch zelf krijgt `vanFetch = true`.
- `kern/api.js`: `leesFout(err)` geeft `{ soort: 'offline'|'timeout'|'netwerk'|'http'|'onbekend', onzeker, status? }` (`onzeker` = het is niet zeker dat de server niets deed); `foutTekst(err)` geeft de Nederlandse tekst ('Geen verbinding met de server', 'De server antwoordt niet (time-out na 20 s)', 'Serverfout (HTTP 502)'; een 4xx is 'Verzoek geweigerd (HTTP n)'). Gebruik `foutTekst` in nieuwe `catch`-blokken in plaats van `err.message`. Na een onzeker resultaat van een schrijfactie haalt de aanroeper de gegevens één keer opnieuw op (resync, met volgordeguard en weggooien van verouderde antwoorden).
- `kern/exceljs.js`: `laadExcelJs()` laadt ExcelJS pas bij de eerste export (TicketLog of Inventaris; een gedeelde belofte, tijdlimiet 20 s, een mislukte lading wordt niet onthouden). Gebruik dit in plaats van een `<script>`-tag; `excel-export.js` zelf wordt ook lazy geïmporteerd (geen `<script type="module">` en geen modulepreload in `index.html`; wel in `SHELL`).
- `kern/verbruik-wachtrij.js`: melding en herpoging voor de wagenvoorraad-aftrek na een verzonden rapport. Een herpoging gebeurt enkel als zeker is dat er niets geschreven werd (409, 503 met eigen boodschap, offline); alles wat onzeker is geeft enkel een melding (nooit dubbel aftrekken). Twee tabs: `navigator.locks` (Web Locks) met terugval op een lease met eigenaar-token. Puur, alle afhankelijkheden worden meegegeven.
- `kern/mailcontrole.js`: na een onzeker resultaat van een verzending naar de klant (propose, send-rapport, annuleer) controleert de app via `/api/mail-check` (één GET, enkel lezen) of de mail al weg is en geeft `verzonden`, `niet-verzonden` of `onbekend`; elke twijfel is `onbekend` (nooit 'niet verzonden'). De client stuurt nooit een absolute tijd, enkel `verlopenMs`. Is er minder dan `SERVER_MAX_MS` (30 s = functielimiet 26 s + 4 s) verstreken en zegt de eerste controle 'niet verzonden', dan wacht ze de rest af en controleert nog één keer; pas dan geldt 'niet verzonden'. Het onthouden van een gedetecteerde rapportmail (`localStorage`, `blitz_mail_gedetecteerd`) en de bevestiging via `appConfirm` bij een volgende verzending staan in `schermen/rapport-verzenden.js`, niet hier.
- Een nieuw kern-bestand komt in dezelfde commit in `SHELL` van `public/sw.js`.

## Schermen (`public/js/schermen/`)

Schermonderdelen die hun eigen toestand beheren (niet in `kern.toestand`), maar via `initRoute(afh)`, `initKaart(afh)`, `initWachtrij(afh)`, `initKalender(afh)`, `initIngepland(afh)`, `initCapaciteit(afh)` en de init-functies van etappe 5 in `DOMContentLoaded` initialiseren (vóór `koppelRenders`).

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
- Nieuwe schermen volgen dit patroon: module-privé toestand, expliciet aangereikte functies, exports voor lezers.

**Etappe 4 (Kalender en wachtrij):**
- `capaciteit.js`: vrije tijd per dag volgens de gedeelde plaatsingsregel `public/js/planner-tijdlijn.js` (`bouwDagItems`, `volgendeBeschikbareDag`, `capaciteitsKop`, lezers `capacityForDay` en `nextAvailableDay(van, ticketId)`); het vroegere aantalmodel (slots tellen) is vervangen (proefperiode-bugfix A17). Unit-getest met `node --test`.
- `wachtrij-logica.js`: pure berekeningen (zoeken, sorteren, scoren: `filterOpZoek`, `sorteerWachtrij`, `queueScore`). Unit-getest.
- `kalender-logica.js`: pure berekeningen (tijdlijnindeling, zichtbare dagen, maandraster: `bepaalLanes`, `zichtbareDagen`, `maandRaster`). Unit-getest met DST-weken.
- `wachtrij.js`: Wachtrij-scherm (kaarten, zoeken, sorteren, teller). Private toestand: `wqZoek` en de sorteerinstelling `wqSorteer`. Bevat ook `quickAdd`. Init via `initWachtrij(afh)` vóór `koppelRenders()`.
- `kalender.js`: Kalender-scherm (week/maand, kaarten, navigatie, teller). Private toestand: `kalView`, `_kalAutoScrollKey`; de getoonde week/maand/dag volgt de gedeelde `toestand`-sleutel `gekozenDatum` (YYYY-MM-DD, bij de start vandaag, niet bewaard) die ook de Route-tab (datumkiezer, weekstrook; `route.volgGekozenDatum`), Ingepland en "Plan deze week" (week van de gekozen dag; maandweergave: idem met melding) gebruiken. Datumhulpen: `verschuifDatum`, `weekVerschil`, `volgendeWerkdagVan` in `kern/tijd.js`; `weekOffset()` blijft bestaan (afgeleid). Lezers: `kern.kalender.weekOffset()` en `kern.kalender.activeerKalender()`. De capaciteitskop wordt hier getekend. Init via `initKalender(afh)` vóór `koppelRenders()`.
- `ingepland.js`: Ingepland-scherm (kaarten, teller). Geen eigen weekverschuiving meer: de week volgt de gedeelde `gekozenDatum`. Init via `initIngepland(afh)` vóór `koppelRenders()`.

**Etappe 5a (Ticketdetail, voorstel, annuleren):**
- `ticketdetail-logica.js`: pure berekeningen (aankomsttijden, afrondingstijden, onderwerpschoning, termen: `tijdslotVoor()`, `roundToNextQuarterStr()`, `cleanTicketSubject()`, `joinNL()`, `meervoud()`, `telNummer()`, `bevestigdLabel()`, `heeftLopendVoorstel()`, plus de gedeelde constante `DOELGROEP_LABEL`). Unit-getest met `node --test`.
- `ticketdetail.js`: Ticketdetail-venster (taken, voorstel, annuleren, toewijzen, aankomst). Init via `initTicketdetail(afh)` vóór `koppelRenders()`. Private toestand: `activeTicket` en `_detailDate` (lezers `actiefTicket()`, `detailDatum()`) en `_kbIsDirty` (via `zetKbIsDirty`); `arrivalData` is een export (route en wizard lezen het). Knoppen gebruiken `data-actie`-delegatie; Zoho-functies verhuizen via productietest als vangnet.
- `voorstel.js`: Voorstelvenster (datum, tijd, ontvangers, voorbeeld, verzenden). Init via `initVoorstel(afh)`. Private toestand beheerd via accessors. Afh: `getPlanningTicket`, `sluitDetailStil`, `actiefTicket`, `zetActiefTicket`, `renderRouteList`.
- `annuleren.js`: Annuleervenster (reden, toelichting, mailkeuze). Init via `initAnnuleren(afh)`. Private toestand. Afh: `sluitDetailStil`, `actiefTicket`, `loadVoorstelStatus`, `renderRouteList`, `updateRouteBtns`, `inFlight`. `zetRedenenVoorTest` gooit buiten `?test`.
- `venster.js` export `registreerVenster({ el, isOpen, sluit, terugFocus })`: registreert per venster Escape-gedrag en focusbeheer; `terugFocus: () => HTMLElement | null` (optioneel) bepaalt waar de focus na sluiten terugkomt, en een venster dat vanuit een ander venster opent erft het terugkeerpunt (korte erfenisperiode) (de achtergrondklik loopt via `kern.ui.registreerBackdrop`); `venster.js` registreert zelf enkel nog de rapport-wizard (die sluit via `window.closeWizard`, zie hieronder).

**Conventies:**
- Afhankelijkheden (functies uit de app-schil `app.js`) worden via `afh` aangereikt; instellingen en toestandsgegevens uit `kern.toestand`.
- `kern.wachtrij.renderTelling()`, `kern.kalender.renderTelling()`, `kern.ingepland.renderTelling()` zijn de tellers die de e2e-tests gebruiken.
- Knoppen gebruiken `data-actie`-delegatie in plaats van inline handlers. Elke kaartluisteraar heeft een **bubbel-guard**: `if (e.target.closest('[data-actie]')) return;` om te voorkomen dat kaarten openen.
- `quickAdd` (`wachtrij.js`), de capaciteitskop (`n/cap · ±u`, getekend in `kalender.js`) en de volgorde van de Route-tab (`kern/selecties.js` `stopsVoorDag` met opties) gebruiken dezelfde plaatsingsregel (`planner-tijdlijn.js`: aankomst uiterlijk `laatsteStart`, 30 min reistijd per rit, items zonder uur in lijstvolgorde vanaf `vanTijd`). Het brein volgt dezelfde regel met echte reistijden.
- `kern.ui.strengeAfh(scherm, afh)` bewaakt de `afh`-objecten: een ontbrekende `afh`-sleutel gooit, zowel vóór als na de init.
- Blokkeringen en selecties gebruiken `kern.selecties.blokkeringenVoor` en `kern.ui.maakActiveerbaar`.

**Etappe 5b (Beschikbaarheid, afspraken, instellingen, planacties en de app-schil):**
- `klantbeschikbaarheid.js` (+ `-logica.js`): klantbeschikbaarheid per ticket (laden/bewaren met optimistic locking, `kbFor`, `kbBlocked`, `kbPreferred*`, het blok in het detail). De samenvoeg-logica staat puur in `klantbeschikbaarheid-logica.js` (`voegSamenKb`).
- `beschikbaarheid.js` (+ `-logica.js`): blokkeringen (venster en tab Beschikbaarheden). `nextWorkday` en `groupExceptionsForDisplay` krijgen de werkdagen als parameter en lopen niet meer vast zonder werkdag.
- `afspraken.js` (+ `-logica.js`): eigen afspraken (manueel venster, detail, importeren). Schrijven via `saveAfspraken(wijzigingen)`.
- `instellingen.js` (+ `-logica.js`): instellingen per persoon en tabblad Dit toestel; `valideerInstellingen` is puur en unit-getest. De prijsbeheer-knoppen lopen via `kern.prijzen`.
- `fotos.js`: foto's bij een ticket. Deelt `_fotoState` met de rapport-wizard (import-cyclus `fotos.js` <-> `rapport-wizard.js`, bewust gelaten: loskoppelen vraagt wizard-wijzigingen buiten D19).
- `rapport-verzenden.js`: rapportvoorbeeld, rapport versturen en `syncOplossingNaarZoho`. `sendBtn.onclick =` blijft een toewijzing (anders verstuurt elke preview meerdere keren).
- `planacties.js`: inplannen, uitplannen en "Plan deze week" (`addTicketToDate`, `removeTicketFromDate`, `bevestigUitplannen`, `autoPlan`).
- `public/js/app.js`: de app-schil (opstart, persoonkiezer, tabs, polling, `koppelRenders`, `reconcilePlanning`); het vroegere klassieke script. Het exporteert niets en start zichzelf op `DOMContentLoaded`. Schermmodules importeren `app.js` nooit: wat ze van de schil nodig hebben, krijgen ze via `afh`. Oudere modules mogen uit schermmodules importeren (eenrichting).
- Conventies: `init…(afh)` met `kern.ui.strengeAfh`; knoppen via `data-actie`, wijzigingen via `data-wijzig` en live invoer via `data-invoer` (`kern.ui.registreerWijzigActies`); vensters via `registreerVenster` en `registreerBackdrop`. Geen `onclick=`/`onchange=`/`oninput=` in `index.html` of in de HTML-strings van modules.
- Gedocumenteerd restant: de rapport-wizard blijft inline handlers gebruiken (30 in `rapport-wizard.js`, D2) en biedt daarvoor het `wiz*`-blok op `window` aan, plus `openRapport`, `closeWizard`, `printRapport`, `calcWerktijdMin`, `berekenLoonkost` en de `_fotoState`-accessor. Andere `window`-namen die blijven omdat de wizard of `outbox.js` ze als kale naam leest: `PRIJZEN`, `PRIJZEN_DEFAULTS`, `zoekOnderdelen`, `getAlleTags`, `renderRapportArchief`, `registreerVerbruik`, `outboxAdd`, `runOutboxItem`, `nextOutboxAction`, `refreshOutboxCache`, `_outboxItems`, `appConfirm` en de `apparaat`-familie (`apparaat.js`, klassiek script). Specs lezen het rapportarchief via `kern.rapportArchief.lijst()` en `.versie()`.
- Nieuw bestand in `public/js/`: dezelfde commit zet het in `SHELL` van `public/sw.js`.

**Etappe 7 (Technieker):**
- `rapport-verzenden.js`: de rijknop gaat vóór de bevestiging van een eerder gedetecteerde mail op slot en komt bij 'Terug' weer open. Na een onzeker resultaat controleert `kern/mailcontrole.js` of de mail al weg is; tijdens de controle blijft de knop op slot.
- `excel-export.js` wordt pas bij de eerste export geladen (dynamische import in `app.js`; niet in `index.html`) en haalt ExcelJS via `kern/exceljs.js`.
- Lokale afspraakkaarten in de kalender zijn met het toetsenbord te openen (`maakActiveerbaar`).
- Gedocumenteerd restant (N12): een route-volgorde slepen tijdens een render kan af en toe geannuleerd worden (`applyRouteOrder` werkt op verouderde objecten; vastgelegd in `e2e/route-slepen-render.spec.mjs`, bewust niet gewijzigd: W11). Ook `negeerSchrijfstand` in `loadTickets` (aangeroepen door `route.js`) slaat de hele schrijfstand-controle over in plaats van enkel het routedeel; zeldzaam, bewust gelaten.

## Service worker (`public/sw.js`, `public/sw-strategie.js`)

- `sw-strategie.js` bevat alle beslislogica (UMD: `self.SwStrategie` in de SW, `module.exports` in `node --test`; `tests/sw-strategie.test.mjs`). `sw.js` is een dun omhulsel met `CACHE_NAME`, `EXTERN_CACHE`, `SHELL`, `CDN_VAST` en `FONT_HOSTS`.
- Strategie: eigen schil netwerk-eerst met de cache als terugval (de cache wordt bij een netwerksucces niet ververst, zodat de modules onderling consistent blijven); de CDN-bibliotheken (exacte URL, `CDN_VAST`) cache-eerst in `blitz-extern-v1`; Google Fonts stale-while-revalidate; enkel een antwoord met status 200 gaat de cache in; `/api`, `/.netlify/` en alles wat geen GET is wordt nooit afgehandeld of bewaard. De installatie heeft een tijdlimiet en breekt niet op een storing van een CDN.
- `NAV_TIMEOUT_MS = 4000` (Brent, 2026-10-02): wacht een navigatie langer dan 4 s op het netwerk, dan start de app uit de bewaarde kopie (maximaal één release oud). Tests overschrijven dit via `/sw.js?navTimeout=<ms>` (0 tot 30000; 0 = uit).
- `CACHE_NAME` (nu `blitz-planning-v25`) wordt NIET aangepast op `refactor`; dat gebeurt bij de release (zie `docs/release-checklist-2.0.md`). Elk nieuw laadbaar bestand onder `public/js/` komt in dezelfde commit in `SHELL`; `tests/sw-schil.test.mjs` bewaakt dat de modulepreload-lijst in `index.html` precies de eager modulegraaf is (statische imports; dynamische `import()`-randen zoals `excel-export.js` horen er niet bij, maar staan wel in `SHELL`), dat de preloads na de stijlbladen staan en dat er enkel een preconnect is voor de hosten die de opstart gebruikt; `tests/sw-strategie.test.mjs` bewaakt de beslislogica.

Aanvullingen (finale fix B):
- Cache-modus per client: valt een navigatie (of een submodule) op de cache terug, na een time-out of een netwerkfout, dan komen alle verdere shell-verzoeken van die client uit de cache zolang de client leeft (`resultingClientId`/`clientId`; begrensd tot 50 clients; een SW-herstart wist dit, dan geldt nog de globale 60 s). Zo mengt een module nooit met een `index.html` van een andere versie.
- Installatie: CDN-URL's die al in `blitz-extern-v1` staan worden niet opnieuw opgehaald (ze zijn op versie vastgepind); `CDN_LUI` (URL's die niet vooraf worden opgehaald) is leeg: ExcelJS (258 kB gzip) wordt weer vooraf opgehaald, één keer per toestel, zodat de eerste Excel-export offline werkt. Wijzigt `CDN_VAST` van versie, verhoog dan `EXTERN_CACHE` of ruim de oude sleutels op (zie de release-checklist).
- De SW wordt geregistreerd na de `load`-gebeurtenis (`app.js`), zodat de installatie niet met de eerste laad concurreert.
- Subresources hebben bewust geen time-out (`subTimeoutMs = 0`): komt `index.html` binnen 4 s en stokt daarna een module, dan blijft de app wachten in plaats van te mengen met een andere versie.

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

**CACHE_NAME-regel (verplicht):** elke release die iets onder `public/` wijzigt, MOET `CACHE_NAME` in
`public/sw.js` ophogen. De service worker ververst zijn schil-kopie nooit bij een netwerksucces en de navigatie-time-out
van 4 s serveert die kopie bij trage starts; zonder bump blijft die kopie op de laatste SW-installatie staan (mogelijk
meerdere releases oud, met opgeloste bugs er nog in, en met kans op een mengeling van versies). Dit geldt ook voor
bugfixes op `main` en voor een rollback. Op `refactor` blijft `CACHE_NAME` voorlopig op v25; de bump gebeurt bij de releasestap.

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
