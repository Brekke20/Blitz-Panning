# Etappe 5a — Productiemodus-vangnet, ticketdetail, voorstel en annuleren — design

Datum: 2026-10-01 · Opdrachtgever: Brent Calaerts · Tak: `refactor` · Basis: roadmap `2026-10-01-refactor-roadmap-design.md` (W1–W12, §4 rij 5), fundament etappe 2, patroon etappe 3 en 4 (`schermen/*.js`, `kern.ui.strengeAfh`), serverkant etappe 6 (`tests/server-*.test.mjs` = gezaghebbend voor antwoordvormen), vangnet: 586 unit + 137 e2e (basislijn gemeten op 531cf1d).

Etappe 5 is te groot voor één plan en is gesplitst (ruling D1): **5a** (dit document) levert eerst het vangnet dat tot nu toe ontbreekt (een e2e-modus **zonder `?test`**) en verhuist daarna ticketdetail, voorstel en annuleren. **5b** (`2026-10-01-etappe5b-beschikbaarheid-afspraken-instellingen-design.md`) verhuist de rest en lost het klassieke script en LEGACY-BRUG op. 5a eindigt groen en bruikbaar; 5b bouwt erop.

## 1. Doel

1. Elk Zoho- en mail-gebonden verzoek van de app krijgt een e2e-test op zijn **productiepad** (de code die zonder `?test` draait), met de exacte payload geasserteerd, tegen een volledig gestubde backend waarbij niets de eigen host kan verlaten. Vandaag zijn die paden onbereikbaar in de suite (de `TEST_MODE`-takken vervangen ze) en dus ongetest.
2. Ticketdetail (met verzetvenster, "zonder datum"-toewijzing, aankomstregistratie), voorstel (met voorstelstatus en bevestigingslabel) en annuleren verhuizen naar modules onder `public/js/schermen/`, met `data-actie`-delegatie in plaats van inline handlers.
3. Zichtbaar gedrag blijft **identiek** (W5).

Elke taak laat de app volledig werkend; na elke taak zijn `node --test` en `npx playwright test` groen.

Buiten scope voor 5a: alles van 5b, `autoPlan`/`addTicketToDate`/`removeTicketFromDate`/`bevestigUitplannen` (blijven klassiek tot 5b taak 7, wel getest in 5a), de rapportwizard (D2), `outbox.js`.

## 2. Uitgangspunten (geverifieerd in de code, 2026-10-01)

### 2.1 Hoe de app zonder `?test` laadt (haalbaarheidsproef, vraag 2)

| Feit | Gevolg |
|---|---|
| Zonder `?test` zijn er drie verschillen: (a) de `fetch`-patch in `<head>` (index.html:21–42) voegt `X-Blitz-Test: 1` toe enkel mét `?test`; (b) `loadTickets` doet `fetch('/api/tickets')` in plaats van `DUMMY_DATA` (index.html:1328–1366) en `laadPlanningSinds` doet `POST /api/planning-sinds` (1238); (c) de `!TEST_MODE`-takken van `addTicketToDate`, `removeTicketFromDate`, `saveReschedule`, `saveToewijzen`, `sendProposal`, `voorbeeldRapport`/`verstuurRapport`, `autoPlan` (geocoding via `/api/optimize`) en `route.js:758` (`/api/plan-datum`) lopen wél. | De modus is bereikbaar met dezelfde pagina: `page.goto('/')`. |
| Opstartverzoeken (`DOMContentLoaded`, index.html:876–1017) zonder `?test`: `GET /api/prijzen`, `/api/availability`, `/api/inventaris`, `/api/afspraken`, `/api/klantbeschikbaarheid`, `/api/voorstel-status`, `/api/tickets`, `/api/rapport-archief`, daarna `POST /api/planning-sinds`; de 5-minutenpoll (`startTicketPolling`) en `flushOutbox` (enkel bij een gevulde wachtrij, IndexedDB) doen bij opstart niets extra. Allemaal al aanwezig in `maakStandaardStubs()` (`e2e/helpers.mjs`) **behalve `GET /api/tickets`**. | Eén nieuwe stub (`tickets`, antwoord uit `e2e/fixtures/tickets.json`, D6); de rest hergebruiken we. |
| `e2e/statische-server.mjs` luistert op `127.0.0.1:3338`, bedient enkel `public/` en antwoordt op elk `/api/*` met 599; er bestaat geen echte backend in de testopstelling en `playwright.config.mjs` zet `reuseExistingServer: false`. `stubExtern` registreert eerst het host-vangnet (elk http(s)-verzoek buiten `localhost:3338` en de CDN-lijst wordt afgebroken en genoteerd), dan de catch-all (599 voor een niet-gestubd `/api`-pad). Externe absolute URL's in de app: kaarttegels (gestubd), Google Fonts (gestubd), `window.open(google maps)` (nieuwe pagina in dezelfde context: valt onder het vangnet). Zoho, TomTom en mail worden enkel via `/api/*` bereikt. | Er bestaat in de testopstelling **geen route** naar echt Zoho/TomTom/mail: drie onafhankelijke sloten (statische server zonder backend, host-vangnet, per-pad stubs met catch-all). D4 voegt er twee toe: een toegestane-schrijfpadenlijst per test en GET-only voor de CDN-hosts. |
| `TOEGESTANE_HOSTS` (cdnjs, jsdelivr) laten nu elke methode door. | In productiemodus enkel `GET`/`HEAD`; regel zit in een puur bestand (`e2e/vangnet-regels.mjs`) met unit-test. |
| `page.clock.install({ time })` laat de tijd doorlopen; payloads met `new Date().toISOString()` (`tijdstip` in `voorstel-status` en `rapport-verzonden`) zijn dan niet exact te asserteren. | Productiemodus gebruikt `page.clock.setFixedTime(VASTE_NU)` na het laden: exacte `toEqual` op de payload. |

### 2.2 Zoho- en mail-gebonden verzoeken (inventaris)

| Pad | Aanroeper (regel in index.html, tenzij anders) | In `?test` | Productietest |
|---|---|---|---|
| `POST /api/plan` | `addTicketToDate` 1522, `removeTicketFromDate` 1585 (`{ticketId, date:null}`), `saveReschedule` 3088 | overgeslagen | 5a taak 2 |
| `POST /api/plan-datum` | `saveToewijzen` 4476; `route.js:758` (vastleggen) | overgeslagen | 5a taak 2 |
| `POST /api/optimize` | `autoPlan` 2639 (enkel `!TEST_MODE`), `route.js` | geocoding overgeslagen | 5a taak 2 |
| `POST /api/propose` | `sendProposal` 4143 | andere tak (`TEST_MODE`, lokaal) | 5a taak 3 |
| `POST`/`DELETE`/`GET /api/voorstel-status` | `sendProposal` 4168/4192, `loadVoorstelStatus` 728 | lokaal | 5a taak 3 |
| `GET`/`POST /api/annuleer` | `laadAnnuleerRedenen` 3839, `annuleerVoorbeeld` 3963, `verstuurAnnulatie` 4011 | **geen** `TEST_MODE`-tak: de server herkent `X-Blitz-Test`; in e2e verboden (`VERBODEN_PADEN`) | 5a taak 3 |
| `POST /api/send-rapport` | `voorbeeldRapport` 4539 (`preview:true`), `verstuurRapport` 4600 | `TEST_MODE` → demo-tak | 5b taak 1 |
| `POST /api/rapport-verzonden` | `verstuurRapport` 4619 | demo-tak | 5b taak 1 |
| `POST /api/comment` | `syncOplossingNaarZoho` 3617 (enkel door de wizard bij afronden) | `TEST_MODE` → niets | node-test met nep-fetch, 5b taak 6 (D5) |
| `/api/rapport`, `POST /api/rapport-archief` | `outbox.js` (wizard-afronding) | — | **buiten scope** (W11, D5) |

Antwoordvormen van de nep-server komen letterlijk uit de karakteriseringstests van etappe 6 (`tests/server-plan.test.mjs`, `server-propose.test.mjs`, `server-annuleer-confirm.test.mjs`, `annulatie.test.mjs`, `server-send-rapport.test.mjs`) zodat de stub niet kan afwijken van de echte functies.

### 2.3 Inline handlers (inventaris, 105 + restpunten) — voor 5a én 5b

Geteld in `public/index.html` op 531cf1d (HTML-strings met `onclick=`, `onchange=`, `oninput=`): **84 `onclick`, 18 `onchange`, 3 `oninput` = 105**. Elk wordt in de taak van zijn gebied vervangen door delegatie (D8).

| # | Gebied (regels) | Aantal | Taak |
|---|---|---|---|
| 1 | Topbalk-tabs `setTab` (84–89) | 6 | 5b-8 |
| 2 | Werkbalk: `autoPlan` (139) | 1 | 5b-7 |
| 3 | Werkbalk: Import (140–141) en `➕ Afspraak` (142) | 3 | 5b-4 |
| 4 | Kop Rapporten: `exportTicketLog`, `laadRapportArchief` (190–191) | 2 | 5b-8 |
| 5 | Ticketdetail (208–228) | 9 | **5a-6** |
| 6 | Verzetvenster (235–249) | 4 | **5a-6** |
| 7 | Instellingen: sluiten ×3, tabs ×3, toestel `onchange` ×6, `resetTestdata`, `openPrijsBeheer`, `saveSettings` (255–345) | 15 | 5b-5 |
| 8 | Blokkeringsvenster, statisch (351–354) | 2 | 5b-3 |
| 9 | Prijsbeheer, statisch (365–378) | 4 | 5b-5 |
| 10 | Import-venster (385–397) | 4 | 5b-4 |
| 11 | Eigen afspraak, detail (403–419) | 7 | 5b-4 |
| 12 | Eigen afspraak, formulier (425–491) | 4 | 5b-4 |
| 13 | Planresultaat (497–501) | 2 | 5b-7 |
| 14 | Foto (508–516) | 4 | 5b-6 |
| 15 | Voorstel (521–553) | 6 | **5a-7** |
| 16 | Annuleren (559–589; 1 `oninput`, 2 `onchange`) | 7 | **5a-8** |
| 17 | Rapportvoorbeeld (594–605) | 3 | 5b-6 |
| 18 | Rapportwizard, statisch: `closeWizard`, `wizBack`, `wizNext` (615–627) | 3 | 5b-8 |
| 19 | Dynamisch: importreview `onchange` (2056) | 1 | 5b-4 |
| 20 | Dynamisch: blokkeringsformulier `avSet*` (2401–2451) | 8 | 5b-3 |
| 21 | Dynamisch: instellingen-tab Beschikbaarheden `bav*` (3319–3372) | 9 | 5b-3 |
| 22 | Dynamisch: voorstelvoorbeeld `onclick="return false"` op een inert anker (3787) | 1 | **5a-7** |
| | **Totaal** | **105** | 5a: 27 · 5b: 78 |

Restpunten buiten `index.html`:

| Plaats | Aantal | Beslissing |
|---|---|---|
| `rapport-wizard.js` templates (13 `onchange`, 8 `onclick`, 9 `oninput`) | 30 | **Blijven** (D2, W11) samen met het `wiz*`-`window`-blok; gedocumenteerd restant. |
| `prijzen.js` templates (3 `onclick`, 3 `oninput`) | 6 | Gaan mee in 5b-5. |
| `rapport-archief.js:132` (`herOpenRapport`) | 1 | Gaat mee in 5b-6. |
| Eigenschapstoewijzingen `el.onclick = fn` op zelfgemaakte elementen: `index.html` 1410, 1418 (persoonmenu), 3486 (weekdagknop), 4562 (rapportvoorbeeld); `kalender.js:613`; `route.js:295` | 6 | Geen HTML-string; **blijven** in `kalender.js`/`route.js`, de vier uit `index.html` verhuizen mee en worden `addEventListener`. |

## 3. Eisen

| # | Onderwerp | Eis |
|---|---|---|
| D1 | Splitsing | 5a (9 taken) dan 5b (9 taken). 5a eindigt groen met een volledig bijgewerkte CHANGELOG- en CLAUDE.md-sectie; 5b mag 5a niet openbreken. |
| D2 | Rapportwizard (roadmap §4 rij 5 noemt hem niet; W11) | Niet in etappe 5. `rapport-wizard.js` krijgt enkel: importregels voor namen die nu stilzwijgend globaal zijn (`escHtml`, `toast`, `TEST_MODE`, `arrivalData`, `getPlanningTicket`, `sluitDetailStil`, `closeLocalDet`, `DAGEN`, foto-functies), de vervanging van de kale `settings`-lezer (`settings.startlocatie`) door `kern.toestand.get(...)` (5b) en één `zetFotoState`-export (5b). Geen logica, geen sjabloon, geen inline handler wijzigt. Elke wizard-wijziging staat in de commitbody en in de review-focus; de wizard-e2e (`instellingen-rapport.spec.mjs`) blijft groen. |
| D3 | Klassiek script | Het `<script defer>` in `index.html` lost in 5b volledig op (taak 8, `public/js/app.js`). Daarom kan LEGACY-BRUG in 5b taak 9 helemaal weg. 5a laat het script staan; nieuwe modules gebruiken `kern.*`, nooit de legacy-namen. |
| D4 | Productiemodus | Aparte map `e2e/productie/` met `*.spec.mjs` en een eigen fixture-bestand `e2e/productie-hulp.mjs` (eigen `test`; importeer niets uit `helpers.mjs` dan `stubExtern`, `verzamelVerzoeken`, `VASTE_NU`, `opslagStub`). Elke test: (1) navigeert naar `/` zonder `?test` en asserteert dat de URL geen `test` bevat en dat **geen enkel** `/api`-verzoek `X-Blitz-Test` draagt; (2) declareert de verwachte schrijfpaden (`verwachtSchrijven(['/api/plan'])`); een schrijfverzoek (niet-GET) op een niet-gedeclareerd pad faalt de test; (3) vangnet na afloop: `buitenHost`, `onverwacht` en consolefouten leeg; (4) enkel `127.0.0.1:3338`/`localhost:3338` plus GET/HEAD naar de twee CDN-hosts. `playwright.config.mjs` blijft ongewijzigd (zelfde `testDir`, de submap valt onder `testMatch`). De regels staan in `e2e/vangnet-regels.mjs` (puur) met `tests/e2e-vangnet.test.mjs` (o.a. `desk.zoho.eu`, `accounts.zoho.eu`, `api.tomtom.com`, mailhosts → geweigerd). |
| D5 | Gedekte paden | De vijf uit de opdracht (`plan-datum`, `propose`, `voorstel-status`, `send-rapport`, `rapport-verzonden`) plus `plan`, `annuleer` (GET, preview, versturen) en `optimize` (autoPlan). `comment` krijgt een node-test (5b-6). `outbox.js`/`/api/rapport*` blijven buiten de e2e (de wizardafronding wordt niet gedreven, W11). |
| D6 | Tickets-stub | `e2e/fixtures/tickets.json` = `DUMMY_DATA` met vaste `inPlanningSinds`; een e2e-test in `?test` vergelijkt de fixture met `window.DUMMY_DATA` (pariteit). In 5b-8 gaat `DUMMY_DATA` naar `public/js/kern/testdata.js`, de stub importeert het en de fixture vervalt. |
| D7 | `TEST_MODE` | Nieuw `public/js/kern/omgeving.js` exporteert `TEST_MODE` (zonder `window`-toegang bij import in node: `globalThis.location?.search ?? ''`). De vijf oudere modules (`rapport-wizard.js`, `inventaris.js`, `rapport-archief.js`, `outbox.js`, `prijzen.js`) krijgen enkel een importregel; het klassieke `const TEST_MODE` blijft tot 5b-8 (zelfde waarde). |
| D8 | Delegatie | `kern/ui.js` krijgt `registreerWijzigActies(wortel, { 'naam': handler })` (luistert `change` en `input`; attributen `data-wijzig="naam"` en `data-invoer="naam"`, handler `(el, e, arg)`) en `registreerBackdrop(overlay, sluit)` (klik op de overlay zelf, `e.target === overlay`, zoals de huidige `closeX(event)`). Klikken gebruiken het bestaande `data-actie`. Een knop in een overlay die zelf een `data-actie` draagt wint van de overlay-luisteraar; de bubbel-guard van etappe 4 (`e.target.closest('[data-actie]')`) geldt waar een container een klikluisteraar heeft. |
| D9 | `venster.js` | De vaste tabel `sluitVia(naam) = window[naam]?.()` (venster.js:89–95) verdwijnt: elke verhuisde dialoog registreert zijn overlay in zijn eigen `init…` via `registreerVenster({ el, sluit })` (nieuwe ES-export van `venster.js`). Per taak wordt de bijbehorende tabelregel verwijderd; taak 4 legt Escape en focusval per dialoog vast. |
| D10 | Modules | Puur: `schermen/ticketdetail-logica.js` (`tijdslotVoor`, `roundToNextQuarterStr`, `cleanTicketSubject`, `joinNL`, `meervoud`, `telNummer`, `voorstelOntvangers`, `bevestigdLabel`, `heeftLopendVoorstel`), unit-getest. DOM: `schermen/ticketdetail.js`, `schermen/voorstel.js`, `schermen/annuleren.js`. Alle drie `init…(afh)` met `kern.ui.strengeAfh`, geen `window`-toewijzing (enkel `kern/brug.js`, tot 5b-9), geen DOM op moduleniveau. |
| D11 | Toestand | Naar de store (`kern.toestand`): onveranderd (`voorstelStatus`, `planning`, `allTickets`, …). Module-privé: `activeTicket`, `_detailDate`, `_kbIsDirty` (`ticketdetail.js`, lezers `actiefTicket()`, `detailDatum()`), `_proposalOntvangers`, `_voorstelStatusVersie` (`voorstel.js`), `_ann`, `_annuleerRedenen` (`annuleren.js`), `arrivalData` (`ticketdetail.js`, export `arrivalData` voor route en wizard). `inFlightTickets` blijft klassiek tot 5b-7 en komt via `afh.inFlight(id)`. |
| D12 | Zoho (W11) | Elke verhuisde Zoho-functie (`saveReschedule`, `saveToewijzen`, `sendProposal`, `verstuurAnnulatie`, `laadAnnuleerRedenen`, `annuleerVoorbeeld`, `loadVoorstelStatus`) verhuist **letterlijk** (tekstuele diff buiten namen, `afh.`-/`kern.`-prefix en `TEST_MODE`-import = niets). Zijn productietest uit taken 2–3 staat al groen vóór de verhuizing en blijft ongewijzigd groen erna. Een `git diff -w --color-moved` in de review toont enkel verplaatst blok plus die prefixen. |
| D13 | Brug | Nieuwe `window.kern.ticketdetail`, `.voorstel`, `.annuleren`, `.ticketdetailLogica`. LEGACY-BRUG krijgt **geen** nieuwe namen. Klassieke oproepers (nog te verhuizen code) gebruiken `kern.<module>.<fn>()` binnen function-bodies (K3). Verdwijnen uit `index.html`: alle functies van D10 plus `telNummer`, `contactActiesHtml`, `koppelAdresNavigatie`, `getPlanningTicket`, `registerArrival`, `toggleAssignRow`, `saveToewijzen`, `tijdslotVoor`, `tijdslotLabelVoor`, `roundToNextQuarterStr`, `cleanTicketSubject`, `joinNL`, `meervoud`. `window.getActiveAssignee` blijft (wizard) tot 5b-9. |
| D14 | Spec-migratie (deel 1) | Kale toestandsglobals in e2e (`planning`, `localEvents`, `allTickets`, `avExceptions`, `activeAssigneeFilter`; ± 28 plaatsen in `conflict-409`, `kern`, `route`, `kalender-hulp`, `kalender`, `kalender-indelingen`, `route-tijden`, `ticketdetail`) gaan naar `kern.toestand.get/set/raak` in 5a taak 5 (mechanisch, vandaag al mogelijk). Specs die verhuisde functies aanroepen (`removeLocalEvent`, `openManueelModalEdit`, `saveAvailability`, `addTicketToDate`, `removeTicketFromDate`) migreren mee in de taak van de module (5b). |
| D15 | Service worker, CHANGELOG | Elk nieuw bestand in dezelfde commit in `SHELL` (`public/sw.js`); `CACHE_NAME`, versie, tags onaangeroerd. CHANGELOG onder "Refactor-tak — nog niet uitgebracht": één "Changed"-regel plus "Fixed" per gevonden bug (met test). |
| D16 | Reviews | Taak-review sonnet; etappe-eindreview sonnet (roadmap §5); implementer-escalatie één tier hoger. |

## 4. Risico's en vangnetten

| Risico | Vangnet |
|---|---|
| Een productietest bereikt toch een echt systeem | D4: vijf sloten; een zelftest dwingt `fetch('https://desk.zoho.eu/…')`, `api.tomtom.com` en een mailhost af in de pagina en asserteert dat ze geblokkeerd en genoteerd zijn |
| Productietests zijn onderling afhankelijk of flaky (klok, 5-minutenpoll) | Vaste klok (`setFixedTime`), geen `waitForTimeout`, poll nooit afgewacht; de stubs zijn per test stateful |
| Escape of focusval werkt niet meer voor een verhuisd venster | D9; taak 4 legt Escape/focus per dialoog vast vóór de eerste verhuizing |
| Een overlay-klik sluit het venster ook bij een klik in de inhoud (of omgekeerd) | `registreerBackdrop` test `e.target === overlay`; e2e per dialoog: klik in de inhoud sluit niet, klik op de achtergrond wel |
| `onchange`/`oninput` verliest zijn timing (bv. `annuleerWijzig` bij elke toets) | `data-invoer` luistert `input`, `data-wijzig` luistert `change`; e2e typt in het annuleervenster en ziet het voorbeeld bijwerken |
| Zoho-gedrag verandert stilzwijgend | D12, productietests uit taken 2–3 vóór de verhuizing, review met `git diff -w --color-moved` |
| Oudere modules (wizard, route, kalender) breken omdat een stilzwijgend globale naam verdwijnt | Per taak de **bare-gebruikersaudit** (plan, bijlage A) en een importregel; e2e wizard en route groen |

## 5. Succescriteria

- `e2e/productie/` bestaat en bevat tests met geasserteerde payloads voor `plan`, `plan-datum`, `propose`, `voorstel-status`, `annuleer`, `optimize` (taken 2–3); `send-rapport` en `rapport-verzonden` volgen in 5b-1.
- `tests/e2e-vangnet.test.mjs` bewijst dat Zoho-, TomTom- en mailhosts geweigerd worden.
- `public/js/schermen/` bevat `ticketdetail-logica.js`, `ticketdetail.js`, `voorstel.js`, `annuleren.js`; `kern/omgeving.js` bestaat.
- De 27 handlers van 5a (§2.3: gebieden 5, 6, 15, 16, 22) zijn weg uit `index.html`; geen `window`-toewijzing in de nieuwe bestanden.
- `venster.js` bevat de tabelregels van `det-overlay`, `reschedule-overlay`, `proposal-overlay`, `annuleer-overlay` niet meer.
- `node --test` en `npx playwright test` groen, aantallen in de ledger; `sw.js` `SHELL` compleet.
