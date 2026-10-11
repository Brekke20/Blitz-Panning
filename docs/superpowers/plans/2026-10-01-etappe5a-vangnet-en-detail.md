# Etappe 5a — Productiemodus-vangnet, ticketdetail, voorstel en annuleren Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Een tweede e2e-modus **zonder `?test`** met een volledig gestubde backend, waarin de exacte Zoho-gebonden payloads van `plan`, `plan-datum`, `propose`, `voorstel-status`, `annuleer` en `optimize` zijn vastgelegd; (2) ticketdetail, voorstel en annuleren verhuizen naar `public/js/schermen/` met `data-actie`-delegatie, zonder zichtbare gedragswijziging.

**Architecture:**
- Productietests staan in `e2e/productie/`, met een eigen fixture (`e2e/productie-hulp.mjs`) en een puur, unit-getest regelbestand (`e2e/vangnet-regels.mjs`). Ze hergebruiken `stubExtern` en de standaard-stubs van `helpers.mjs`, maar dwingen af: geen `?test`, geen `X-Blitz-Test`, per test een lijst toegestane schrijfpaden, enkel `127.0.0.1:3338`.
- Nieuwe modules zijn `init…(afh)`-schermen (patroon etappe 3 en 4); de pure delen staan in `ticketdetail-logica.js` met unit-tests. Zoho-functies verhuizen letterlijk, ná hun productietest.
- `kern/ui.js` krijgt `registreerWijzigActies` en `registreerBackdrop`; `venster.js` krijgt een ES-export `registreerVenster` zodat modules hun eigen overlay registreren.

**Tech Stack:** vanilla ES-modules zonder bouwstap, `node --test`, `@playwright/test` (bestaand).

**Spec:** `docs/superpowers/specs/2026-10-01-etappe5a-vangnet-en-detail-design.md`. Lees §2 (feiten, inventarissen) en §3 (D1–D16) vóór Taak 1. Elke taak heeft een feasibility-regel: de weg waarlangs ze bewijsbaar is, gecontroleerd in de code (les etappe 2).

## Global Constraints

- Werk in de worktree `.claude/worktrees/planner-brein` (tak `refactor`). Prefix elke shell-opdracht met `cd "<worktree>" &&` en controleer vóór elke commit `git branch --show-current` = `refactor`. Nooit `git checkout`, nooit committen in de main-checkout, niet pushen, `.claude/launch.json` nooit stagen.
- Zichtbaar gedrag identiek (W5). Een gevonden bug: eigen test + "Fixed"-regel (Taak 9) + vermelding in de commit.
- **Nooit echte Zoho-, TomTom- of mail-aanroepen**, ook niet "even om te kijken". Productietests lopen enkel tegen `e2e/statische-server.mjs` (geen backend) met de stubs. Een test die een host buiten `127.0.0.1:3338` of de CDN-lijst bereikt, is een fout in de test.
- Zoho-paden (W11, D12): letterlijke verhuizing, productietest eerst groen. `rapport-wizard.js`, `outbox.js`, `planner.js`, `route*.js`, `kalender.js` en `wachtrij.js` niet wijzigen, behalve wat een taak uitdrukkelijk noemt (importregels, één afh-sleutel). `autoPlan`, `addTicketToDate`, `removeTicketFromDate`, `bevestigUitplannen` blijven in `index.html` (5b-7).
- K3: klassieke code op het hoogste niveau gebruikt `window.kern` of verhuisde functies nooit; per verhuizing `grep -nE "^(let|const|var) .*<naam>" public/index.html`.
- `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` blijft leeg.
- Tests: `npx playwright test` en `node --test` (zonder pad). Nieuwe unit-tests in `tests/*.test.mjs` (`process.env.TZ = 'Europe/Brussels'` bij tijdlogica). Nieuwe e2e in `e2e/*.spec.mjs` (importeren uit `./helpers.mjs`) of `e2e/productie/*.spec.mjs` (importeren uit `../productie-hulp.mjs`); geen `waitForTimeout`, geen screenshots. Gemeten waarden mogen in een test mits commentaar "Gemeten". Nieuwe specs gebruiken `kern.toestand.get/set/raak`.
- Eén dev-/testserverproces: stop enkel je eigen PID.
- `public/sw.js`: elk nieuw bestand in dezelfde commit in `SHELL`; `CACHE_NAME`, versie en tags onaangeroerd (D15).
- Namen en commentaar in het Nederlands; `sjLog(...)`-regels blijven (via `afh.sjLog`); commentaar verhuist mee.
- Commit-trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ledger: `.superpowers/sdd/2026-10-01-etappe5a-vangnet-en-detail/`. Brief en diff als bestand naar subagents; terugmelding maximaal 15 regels.
- Modelkeuze per taak staat bij de taak (W12).

## Review Focus

1. **Geen route naar buiten**: in elke productietest `?test` afwezig, geen `x-blitz-test`, per test een schrijfpadenlijst; `e2e/vangnet-regels.mjs` weigert Zoho/TomTom/mail en niet-GET naar CDN; de zelftest bestaat en is groen.
2. **Payloads exact**: `toEqual` op de volledige body (en methode, header `content-type`), niet `toMatchObject`; vaste klok bij `tijdstip`-velden; antwoordvormen uit de etappe-6-tests.
3. **Zoho letterlijk (W11)**: `git diff -w --color-moved=dimmed-zebra` van de verhuisde functies toont enkel verplaatsing plus `afh.`/`kern.`/`TEST_MODE`-import; de productietest is vóór de verhuizing gecommit en ongewijzigd.
4. **Venster en toetsenbord**: Escape en focusval per verhuisd venster; de tabelregel in `venster.js` is weg en de module registreert.
5. **Delegatie**: geen `onclick`/`onchange`/`oninput` meer in de gebieden 5, 6, 15, 16, 22 van de inventaris; geen `data-actie`-naam dubbel (`grep -rn "registreerActies\|registreerWijzigActies" public/`); overlay-klik in de inhoud sluit niet.
6. **Oudere modules**: de wizard-, route- en kalender-diffs bevatten enkel importregels of één `afh`-sleutel; bare-gebruikersaudit (bijlage A) in de ledger.
7. **Geen nieuwe legacy-namen** in `kern/brug.js`; geen `window`-toewijzing in `schermen/*.js`.

---

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `e2e/vangnet-regels.mjs` (nieuw, T1) | puur: welke host/methode/pad mag in productiemodus |
| `tests/e2e-vangnet.test.mjs` (nieuw, T1) | unit-test van de regels |
| `e2e/productie-hulp.mjs` (nieuw, T1) | eigen `test`-fixture, `startAppProductie`, nep-Zoho-stubs met payloadopname |
| `e2e/fixtures/tickets.json` (nieuw, T1) | `DUMMY_DATA` voor de `tickets`-stub |
| `e2e/productie/opstart.spec.mjs`, `planning.spec.mjs`, `voorstel.spec.mjs`, `annuleren.spec.mjs` (nieuw, T1–T3) | productietests |
| `e2e/ticketdetail.spec.mjs`, `e2e/vensters.spec.mjs` (T4) | karakterisering detail (in `?test`), Escape/focus per dialoog |
| `public/js/kern/omgeving.js`, `kern/ui.js`, `venster.js` (T5) | `TEST_MODE`, `registreerWijzigActies`, `registreerBackdrop`, `registreerVenster` |
| `public/js/schermen/ticketdetail-logica.js` (nieuw, T5), `tests/ticketdetail-logica.test.mjs` | pure logica |
| `public/js/schermen/ticketdetail.js` (T6), `voorstel.js` (T7), `annuleren.js` (T8) | DOM-modules |
| `public/js/kern/brug.js`, `public/index.html`, `public/sw.js` | brug, dunne oproepen, `SHELL` |
| `CHANGELOG.md`, `CLAUDE.md` | T9 |

## Interfaces (eindtoestand 5a)

```js
// e2e/vangnet-regels.mjs (puur)
export const ZOHO_TOMTOM_MAIL_PATRONEN            // /zoho|tomtom|smtp|mail\./i en bekende hosts
export function isToegestaan({ url, methode })     // -> { ok, reden }; enkel 127.0.0.1:3338|localhost:3338, GET/HEAD naar cdnjs|jsdelivr
// e2e/productie-hulp.mjs
export const test, expect, VASTE_NU
export async function startAppProductie(page, { rol, technieker, overschrijf, vasteKlok = false })
export function verwachtSchrijven(verzoeken, paden)  // whitelist per test; alles anders faalt in afterEach
export function zohoStubs()                           // plan, plan-datum, propose, voorstel-status, annuleer, optimize met opname + configureerbare antwoorden

// kern/omgeving.js            export const TEST_MODE
// kern/ui.js                  registreerWijzigActies(wortel, handlers) ; registreerBackdrop(overlayEl, sluit)
// venster.js                  export function registreerVenster({ el, isOpen, sluit })  (naast window.vensterBeheer tot 5b-9)

// schermen/ticketdetail-logica.js (puur)
export function tijdslotVoor(minuten, slotMinuten), roundToNextQuarterStr(hhmm), cleanTicketSubject(raw), joinNL(items), meervoud(n, e, m)
export function telNummer(tel), voorstelOntvangers(ticket), bevestigdLabel(vs), heeftLopendVoorstel(t)

// schermen/ticketdetail.js    initTicketdetail(afh), openDetail(t), closeDet(e), sluitDetailStil(), actiefTicket(), detailDatum(),
//                             openRescheduleModal(), saveReschedule(), togglePlanFromDetail(), contactActiesHtml(t), koppelAdresNavigatie(root),
//                             registerArrival(id, datum), arrivalData, getPlanningTicket(id), toggleAssignRow(id), saveToewijzen(id), tijdslotLabelVoor(stop, datum)
// schermen/voorstel.js        initVoorstel(afh), loadVoorstelStatus(), openProposal(id, datum, aankomstMin), updateProposalPreview(), closeProposal(e), sendProposal()
// schermen/annuleren.js       initAnnuleren(afh), openAnnuleerVenster(id, datum, opties), sluitAnnuleerVenster(e), verstuurAnnulatie(), annuleerWijzig()

// afh per module (alles uit index.html / andere schermen; in 5b wordt het meeste kern.*)
// ticketdetail: renderKbSection, saveKbAll, openProposal, openAnnuleerVenster, openFotoModal, openRapport, addTicketToDate, bevestigUitplannen,
//               navigate, kbBlocked, kbPreferredTime, getHolidayName, bevestigdLabel-lezer, heeftLopendVoorstel, computeArrivalTimes, inFlight(id), sjLog
// voorstel:     getPlanningTicket, sluitDetailStil, actiefTicket, zetActiefTicket, renderRouteList, inFlight, sjLog
// annuleren:    sluitDetailStil, actiefTicket, loadVoorstelStatus, renderRouteList, updateRouteBtns, inFlight, sjLog
```

---

### Task 1: Productiemodus-vangnet (infrastructuur, opstartverzoeken, zelftest)

**Aanbevolen model:** sonnet (testinfrastructuur met veiligheidseisen; beoordeling nodig)

**Feasibility:** gecontroleerd in de code (spec §2.1). Zonder `?test` laadt de app dezelfde pagina; enkel `GET /api/tickets` ontbreekt in `maakStandaardStubs()` (alle andere opstartverzoeken staan er al: `prijzen`, `availability`, `inventaris`, `afspraken`, `klantbeschikbaarheid`, `voorstel-status`, `rapport-archief`, `planning-sinds`). `e2e/statische-server.mjs` heeft geen backend; `stubExtern` registreert het host-vangnet vóór de catch-all. De pariteit met `DUMMY_DATA` is bewijsbaar in `?test` via `page.evaluate(() => DUMMY_DATA)` (klassiek `const`, dus als kale naam in `evaluate` bereikbaar). Niet bereikbaar: de 5-minutenpoll (klok niet vooruitzetten).

**Files:**
- Maak: `e2e/vangnet-regels.mjs`, `tests/e2e-vangnet.test.mjs`, `e2e/productie-hulp.mjs`, `e2e/fixtures/tickets.json`, `e2e/productie/opstart.spec.mjs`
- Wijzig: `e2e/helpers.mjs` (enkel: exporteer `stubExtern`-onderdelen die nog niet geëxporteerd zijn; voeg stub `tickets` toe aan `maakStandaardStubs`)

- [ ] **Step 1: Inventaris.** Noteer in de ledger de opstartverzoeken zonder `?test` door ze te meten: draai een wegwerp-spec (niet committen) die `stubExtern` gebruikt, `/` laadt en `verzoeken.alle` plus `verzoeken.onverwacht` print. Verwacht: één `onverwacht`-pad (`/api/tickets`). Dit is de feitelijke lijst voor Step 4.
- [ ] **Step 2: `e2e/vangnet-regels.mjs` + unit-test (TDD).** `isToegestaan({ url, methode })`: `http://127.0.0.1:3338|localhost:3338` alle methodes (de statische server), `cdnjs.cloudflare.com`/`cdn.jsdelivr.net` enkel GET/HEAD, al het andere `ok:false` met reden. Unit-tests (`tests/e2e-vangnet.test.mjs`): `https://desk.zoho.eu/api/v1/tickets`, `https://accounts.zoho.eu/oauth/v2/token`, `https://www.zohoapis.eu/`, `https://api.tomtom.com/routing/…`, `https://smtp.example.com`, `https://mail.google.com`, `https://127.0.0.1:3339/api/plan` (andere poort), `http://localhost:3338.evil.com/` (hostnaam-truc) en een `POST` naar cdnjs → allemaal geweigerd; `http://127.0.0.1:3338/api/plan` POST en `GET https://cdnjs.cloudflare.com/…` → toegestaan. RED eerst, dan GREEN.
- [ ] **Step 3: Stub `tickets` en fixture.** `e2e/fixtures/tickets.json` = het resultaat van `JSON.stringify(DUMMY_DATA)` uit `index.html` (regels 664–682), met vaste `inPlanningSinds` (`2026-10-04T…`, `2026-09-25T…`, `2026-09-10T…` voor `t1`–`t3`, zoals de klok `VASTE_NU` ze zou berekenen: 1, 10 en 25 dagen terug). Voeg in `helpers.mjs` `tickets: () => json(200, structuredClone(FIX.tickets))` toe aan `maakStandaardStubs()`; `FIX.tickets = fixture('tickets.json')`. In `?test` wordt de stub nooit aangeroepen.
- [ ] **Step 4: `e2e/productie-hulp.mjs`.** Eigen `test = basis.extend({...})` (van `@playwright/test`, **niet** van `helpers.mjs`, want daar faalt een schrijfverzoek naar de `VERBODEN_PADEN`): fixtures `verzoeken` (via `verzamelVerzoeken`), `consoleFouten` (zelfde ruislijst als `helpers.mjs`: exporteer die lijst of importeer ze), `toegestaneSchrijfpaden` (leeg begin), en een auto-`productieVangnet` dat na de test controleert: `buitenHost`, `onverwacht` en `consoleFouten` leeg; **elk** opgenomen `/api`-verzoek heeft `x-blitz-test === null`; alle niet-GET `/api`-verzoeken staan in `toegestaneSchrijfpaden`; `page.url()` bevat geen `test`-parameter; elk verzoek door `isToegestaan` (registreer daarvoor een extra `context.route`-waarnemer, zonder iets door te laten dat `stubExtern` blokkeert). `startAppProductie(page, { rol, technieker, overschrijf, vasteKlok })`: zoals `startApp` (`blitz_rol`, `blitz_active_person`, `blitz_theme` via `addInitScript`; `page.clock.install({ time: VASTE_NU })`; `stubExtern`) maar `page.goto('/')`; bij `vasteKlok` daarna `page.clock.setFixedTime(VASTE_NU)`; wacht tot `#cnt-tickets` de verwachte telling toont (`TE_PLANNEN` uit helpers). `verwachtSchrijven(verzoeken, paden)` registreert de whitelist. Exporteer `zohoStubs()` (leeg begin; vult in de taken 2–3 aan: elk eindpunt neemt `{ methode, body, query }` op in een eigen lijst en geeft een instelbaar antwoord).
- [ ] **Step 5: Opstartspec (`e2e/productie/opstart.spec.mjs`).**
  1. **Laden**: `startAppProductie(page, { technieker: 'Tim' })`; de verzoekenlijst (methode + pad, op volgorde van eerste voorkomen genegeerd, als verzameling vergeleken) is exact: `GET /api/prijzen`, `/api/availability`, `/api/inventaris`, `/api/afspraken`, `/api/klantbeschikbaarheid`, `/api/voorstel-status`, `/api/tickets`, `/api/rapport-archief` en `POST /api/planning-sinds`; geen enkel ander; `#test-badge` onzichtbaar; het toastbericht na het laden is "`3 te plannen · 2 wacht bevestiging · 1 gepland`" (de tellingen zijn die van het hele antwoord, niet van de technieker; de testmodus-tekst "🧪 Testmodus actief" ontbreekt) — Gemeten, mits commentaar.
  2. **`X-Blitz-Test` ontbreekt** op elk `/api`-verzoek en de body van `POST /api/planning-sinds` is exact `{ opzoeken: [<alle te-plannen ids>], actief: [<alle ids van tickets, pending, gepland>] }` (Gemeten volgorde uit `tickets.json`).
  3. **Pariteit**: in een gewone `?test`-test (`startApp` uit `helpers.mjs`, in hetzelfde bestand): `await page.evaluate(() => JSON.parse(JSON.stringify(DUMMY_DATA)))` gelijk aan `tickets.json` na normalisatie van `inPlanningSinds` (het zijn de enige datumvelden die afhangen van de klok).
  4. **Zelftest van het vangnet**: in de pagina `fetch` naar `https://desk.zoho.eu/api/v1/tickets`, `https://api.tomtom.com/routing/1/calculateRoute/x`, `https://smtp.example.com/` en een `POST` naar `https://cdnjs.cloudflare.com/x`: elk faalt (`TypeError`), elk staat in `verzoeken.buitenHost`; de test leegt `buitenHost` zelf (`verzoeken.buitenHost.length = 0`) zodat het vangnet daarna slaagt, na een expliciete `expect` op de inhoud.
  5. **De catch-all blijft dicht**: een `fetch('/api/onbestaand')` geeft 599 en komt in `verzoeken.onverwacht`; de test leegt die lijst na de assertie.
- [ ] **Step 6: Run.** `node --test` (586 + nieuwe) en `npx playwright test` (137 + nieuwe) groen; herhaal de e2e-run een keer (geen flaky). `git diff --stat` toont enkel `e2e/`, `tests/`.
- [ ] **Step 7: Commit** `test(vangnet): productiemodus zonder ?test met volledig gestubde backend (etappe 5a)`. De body noemt de gemeten opstartverzoeken, de vijf sloten (statische server, host-vangnet, per-pad stubs, schrijfpaden-whitelist, GET-only CDN) en dat er niets in `public/` wijzigde.

---

### Task 2: Productietests — planning-, plan-datum- en optimize-verzoeken

**Aanbevolen model:** sonnet (veel vertakkingen, exacte payloads, foutpaden)

**Feasibility:** gecontroleerd. In productiemodus lopen `addTicketToDate` (via de `+`-knop, `quickAdd` → `afh.addTicketToDate`, index.html:1522), `removeTicketFromDate` (via `✕` in de kalender met bevestigingsdialoog, 1585), `saveReschedule` (verzetvenster in het detail, 3088), `saveToewijzen` (kalender, "zonder datum"-pil, `📅 Toewijzen`, 4476), `route.js:758` (route "Vastleggen" met een voorkeursuur-stop, `afh.testModus()` onwaar) en `autoPlan` (knop "⚡ Plan deze week": `nogTeGeocoden` → `POST /api/optimize` enkel `!TEST_MODE`, daarna `/api/matrix` en `/api/plan` per ticket via `addTicketToDate`). Antwoordvorm: `{ success: true }`-achtig voor `plan` en `{ ok: true }` voor `plan-datum` — **lees de exacte vorm uit `tests/server-plan.test.mjs`** (de client leest `data.error` voor plan en `data.ok` voor plan-datum). Feestdag-/klantgeblokkeerd-`confirm()` wordt met `page.on('dialog')` beantwoord. `appConfirm` is een eigen dialoog (rol `dialog`).

**Files:**
- Wijzig: `e2e/productie-hulp.mjs` (`zohoStubs`: `plan`, `plan-datum`, `optimize`)
- Maak: `e2e/productie/planning.spec.mjs`

- [ ] **Step 1: Stubs.** `zohoStubs()` krijgt `plan` (opname `{ methode, body }`, standaardantwoord uit de servertest, instelbaar op `{ error: '…' }` of status 500), `plan-datum` (idem), `optimize` (de bestaande stub uit `helpers.mjs`, mét opname). De `matrix`-stub blijft de bestaande.
- [ ] **Step 2: `+` in de wachtrij (Tim).** Klik `+` van het eerste ticket: `POST /api/plan` precies één keer met body exact `{ ticketId: 't1', date: '<Gemeten datum>', utcInterventieDatum: '<ISO van datum 00:00 lokaal>' }` (00:00 is de "geen tijdstip"-sentinel; zonder voorkeursuur), `content-type: application/json`; daarna: ticket uit de wachtrij, in de kalender, toast "✓ Toegevoegd aan …". Met klantvoorkeursuur (seed `klantbeschikbaarheid` `voorkeurTijd: '10:00'`): `utcInterventieDatum` = die datum om 10:00 lokaal. **Fout**: stub antwoordt `{ error: 'Zoho kapot' }`: het ticket staat weer in de wachtrij (rollback), toast "✕ …", `planning` zonder die dag (`kern.toestand.get('planning')`). **Dubbelklik**: tweede klik terwijl de eerste loopt geeft geen tweede verzoek (houd de stub vast met een belofte die de test zelf oplost).
- [ ] **Step 3: `✕ Uit planning halen` (kalender, #1004 pending).** Bevestigen: `POST /api/plan` body exact `{ ticketId: 'p1', date: null }`; ticket terug in de wachtrij, `#cnt-tickets` +1; stub-fout: rollback (ticket blijft op de dag), toast met "Bijwerken in Zoho mislukt". **Opmerking:** #1004 heeft in `DUMMY_DATA` geen lopend voorstel; een ticket mét `voorstelStatus` opent het annuleervenster (taak 3).
- [ ] **Step 4: `saveReschedule`.** Open #1004, "Verzetten": `POST /api/plan` body exact `{ ticketId: 'p1', date: '<nieuwe dag>', utcInterventieDatum: '<ISO>' }`; lokale staat: oude dag leeg, nieuwe dag bevat het ticket, `status` "Wachten op bevestiging planning", `allGepland` zonder het ticket (test ook #1006 "Geplande service": verhuist naar `allPending`); `confirm()`-waarschuwing bij een feestdag (11 nov) en bij klant-geblokkeerd; weigeren = geen verzoek; stub-fout: toast "✕ Bijwerken in Zoho mislukt. Probeer opnieuw; …" en `planning` ongewijzigd (let op: het venster sluit vóór de fetch; leg dat gedrag vast, het is het huidige).
- [ ] **Step 5: `saveToewijzen`.** "Zonder datum"-paneel (#1005): `📅 Toewijzen`, datum en tijd invullen, Opslaan: `POST /api/plan-datum` body exact `{ ticketId: 'p2', utcInterventieDatum: '<ISO>' }`; antwoord `{ ok: true }` → ticket in `planning[datum]`, toast "✓ Datum ingesteld op … om …"; antwoord `{ ok: false, error: 'x' }` → toast "✕ x", geen lokale wijziging. Zonder datum: toast "⚠ Selecteer een datum", geen verzoek.
- [ ] **Step 6: Route "Vastleggen" (`route.js:758`).** Stel een dag samen met een stop met voorkeursuur, sleep/optimaliseer zodat `item.uur` afwijkt van het huidige uur van de ticket, klik "Vastleggen" (zie `e2e/route.spec.mjs` voor de bestaande handgrepen): per gewijzigde niet-verankerde stop één `POST /api/plan-datum` met `{ ticketId, utcInterventieDatum }` (volgorde = stopvolgorde); stub-fout op de tweede: toast "Volgorde bewaren mislukt voor #…", `GET /api/tickets` herlaadt (`afh.loadTickets`), geen derde verzoek.
- [ ] **Step 7: `autoPlan`.** "⚡ Plan deze week" (Tim): `POST /api/optimize` voor ontbrekende geocodes (exacte body: `{ origin: <startlocatie>, stops: [<adressen>] }`, Gemeten), daarna `POST /api/matrix`-verzoeken (bestaande stub; asserteer enkel dat ze lopen), daarna per geplande ticket één `POST /api/plan` met exact `{ ticketId, date, utcInterventieDatum }` (Gemeten datums/uren); resultaatvenster toont de plannen; stub-fout op één `plan`-verzoek: het ticket staat in de lijst "niet gepland" van het resultaatvenster of krijgt de foutmelding die de code nu geeft (leg Gemeten vast).
- [ ] **Step 8: Run** (alles twee keer) en **commit** `test(vangnet): productiepaden plan, plan-datum en optimize met exacte payloads (etappe 5a)`. De body somt per pad op: aanroeper, payload, foutgedrag, en bijzonderheden (00:00-sentinel, venster sluit vóór de fetch).

---

### Task 3: Productietests — voorstel, voorstelstatus en annuleren

**Aanbevolen model:** sonnet (meerdere asynchrone takken, 409-herhaling, drie annuleer-verzoektypen)

**Feasibility:** gecontroleerd. `sendProposal` (index.html:4096) draait in productiemodus de tak vanaf `fetch('/api/propose')` (regel 4143); daarna `POST /api/voorstel-status` met `reset: true` (4168) bij minstens één verzonden doelgroep, anders `DELETE /api/voorstel-status?ticketId=` (4192); een `409` op de POST laadt `GET /api/voorstel-status` en herhaalt één keer (4175–4178). `verstuurAnnulatie` (3988) en `annuleerVoorbeeld` (3953) hebben geen `TEST_MODE`-tak: zonder `?test` loopt alles; `laadAnnuleerRedenen` (3837) doet `GET /api/annuleer`. De vorm van de antwoorden (`ontvangers`, `emailSent`, `interventieDatum`; `redenen`, `html`, `opgeruimd`, `fouten`, `waarschuwing`, `nietGepland`) staat in `tests/server-propose.test.mjs`, `annulatie.test.mjs` en `server-annuleer-confirm.test.mjs`. De stub van `voorstel-status` in `helpers.mjs` is een minimale; de productiestub krijgt een eigen, opnemende versie. Klok: `vasteKlok: true`, want `tijdstip` komt uit `new Date().toISOString()`.

**Files:**
- Wijzig: `e2e/productie-hulp.mjs` (`zohoStubs`: `propose`, `voorstel-status`, `annuleer`)
- Maak: `e2e/productie/voorstel.spec.mjs`, `e2e/productie/annuleren.spec.mjs`

- [ ] **Step 1: Stubs.** `propose`, `voorstel-status` (GET: `{ versie, status }` uit een stateful object; POST/DELETE: opname en `versie + 1`; instelbaar 409 met `{ error, serverVersie, data }` zoals de echte functie — lees `netlify/functions/voorstel-status.js`), `annuleer` (GET: `{ redenen: [{ code, label }, …] }`; POST met `voorbeeld: true` → `{ html }`; POST echt → instelbaar succes/`nietGepland` 409/500).
- [ ] **Step 2: Voorstel verzenden (#1004, Tim).** Datum en tijd invullen, "✉️ Verstuur voorstel" (de knop wordt wél aangeklikt, tegen de stub): `POST /api/propose` body exact `{ ticketId: 'p1', date, time, utcInterventieDatum, recipientName: 'Luc Wouters', subject: <cleanTicketSubject>, serienummer: 'CHARX-3301', appointmentWindow: <tijdslotlabel> }` (Gemeten waarden). Antwoord met `emailSent: { contact: true }`: `POST /api/voorstel-status` body exact `{ ticketId, doelgroepen: ['contact'], tijdstip: '2026-10-05T07:00:00.000Z', reset: true, versie: <versie uit GET>, tijdslot, tijdslotDatum }`; lokaal: `voorstelStatus[ticketId]` = `{ contact: tijdstip, tijdslot, tijdslotDatum }`, ticket in `allPending`, `planning` zonder oude dag, toast "✓ Voorstel verstuurd naar contactpersoon", venster dicht. Drie doelgroepen (ticket met `emailEindklant` en `emailInstallateur`, verschillende adressen): `doelgroepen: ['contact','klant','installateur']` in de volgorde van de code.
- [ ] **Step 3: Randgevallen voorstel.** (a) `emailSent` leeg → `DELETE /api/voorstel-status?ticketId=p1` (geen POST), `voorstelStatus[p1]` weg; (b) ticket zonder e-mailadres: toast "✓ Status bijgewerkt (geen e-mailadres)", verzoek `propose` met lege `recipientName` indien geen contact; (c) `409` op voorstel-status: daarna `GET /api/voorstel-status` en een tweede `POST` met de nieuwe `versie`, precies twee POSTs; (d) `propose` antwoordt `{ error: 'x' }`: toast "✕ x", knop terug "✉️ Verstuur voorstel", geen voorstel-status-verzoek, ticket ongewijzigd; (e) datum leeg: toast "⚠ Selecteer een datum", geen verzoek; (f) datumwijziging via het venster: het ticket staat niet op beide dagen (bugfix 2026-09-22 item E) — asserteer `planning`.
- [ ] **Step 4: Annuleren.** Seed een lopend voorstel (via `voorstel-status`-GET-stub: `{ p1: { contact: iso, tijdslot, tijdslotDatum } }`), open #1004 → "Afspraak annuleren" (in het detail) of `✕` in de kalender (opent het annuleervenster in plaats van uitplannen): `GET /api/annuleer` (redenen) precies één keer per sessie; reden kiezen, toelichting typen (`oninput`: het voorbeeld in `#annuleer-frame` verschijnt na debounce, `POST /api/annuleer` met body exact `{ voorbeeld: true, naam, datum, tijdslot, uur?, reden, toelichting }`); "Afspraak annuleren": `POST /api/annuleer` body exact `{ ticketId: 'p1', reden, toelichting, mailKlant: true, door, naam }`; succes `{ ok: true, … }`: ticket terug in de wachtrij met `status` "Wachten op planning", `interventieDatum` null, `voorstelStatus` weg (na `GET /api/voorstel-status`), `#cnt-tickets` +1, toast "Afspraak geannuleerd — klant verwittigd per mail"; met `mailKlant: false` ("Nee"): toast "klant niet gemaild" en body `mailKlant: false`. Dubbele klik op de verzendknop geeft één verzoek (`s.busy`).
- [ ] **Step 5: Foutpaden annuleren.** (a) `409 { nietGepland: true, error }`: venster blijft open, keuze "Nee" voorgeselecteerd, toast "⚠ …", geen lokale wijziging; (b) `500 { error }` met `mailKlant: true`: toast "✕ Annuleren mislukt: … De klant kan al gemaild zijn — controleer in Zoho vóór je opnieuw probeert."; (c) `fouten: [{ doelgroep: 'klant' }]`: toast "Afspraak geannuleerd, maar de mail naar klant kon niet verstuurd worden. Verwittig de klant zelf."; (d) `opgeruimd: true`: toast "Vergrendeling opgeruimd — ticket stond al niet meer gepland in Zoho"; (e) `waarschuwing` wordt achter de tekst gezet; (f) `verstuurAnnulatie` bij `inFlight`: toast "Even geduld — dit ticket wordt nog bijgewerkt." (houd een `plan`-verzoek vast).
- [ ] **Step 6: Run** (twee keer) en **commit** `test(vangnet): productiepaden propose, voorstel-status en annuleer met exacte payloads (etappe 5a)`.

---

### Task 4: Karakterisering ticketdetail in `?test` en Escape/focus per dialoog

**Aanbevolen model:** sonnet (veel UI-gedrag vastleggen, handgrepen per dialoog)

**Feasibility:** gecontroleerd. Alles hieronder is bereikbaar in `?test`: `saveReschedule`/`saveToewijzen` doen in testmodus geen fetch (`!TEST_MODE`), `sendProposal` heeft zijn lokale tak (`await 600 ms`: wacht via `toBeHidden`), `openFotoModal` doet `GET /api/fotos` (gestubd), `registerArrival` is localStorage, `openRapport` opent de wizard (enkel openen). `kern/venster.js`-gedrag is meetbaar met `keyboard.press('Escape')` en `document.activeElement`. **Niet bereikbaar:** `annuleer` (verboden pad, taak 3), `import-overlay` zonder bestand (te openen via `➕`-knop? nee: via de Import-knop en `#import-file-input`; gebruik `setInputFiles` met een klein JSON-bestand dat `handleImportFile` accepteert; als dat niet kan zonder netwerk, noteer en sla over), `rapport-preview-overlay` (enkel productiemodus, 5b-1), `result-overlay` (vereist autoPlan; bereikbaar via "Plan deze week" in `?test`, zie `plan-week.spec.mjs`).

**Files:**
- Wijzig: `e2e/ticketdetail.spec.mjs` (uitbreiden)
- Maak: `e2e/vensters.spec.mjs`

- [ ] **Step 1: Detailknoppen (`ticketdetail.spec.mjs`).** (1) #1001 (wachtrij): tags (status, prioriteit `Hoog`, technieker), contactacties (`tel:`-link zonder `(0)`, `mailto:`), adres-navigatielink opent `window.open` (stub `window.open` in de pagina, asserteer de Google-Maps-URL zonder iets te laden), de plan-knop "+ Voeg toe aan planning" (klik: toast "✓ Toegevoegd aan …", detail sluit, ticket in `planning`), pending #1004: knop "✕ Uit planning halen" (opent het bevestigingsdialoog "Uit planning halen"; Annuleren laat alles staan), de knoppen Aankomst/Voorstel/Foto's/Rapport/Verzetten zichtbaar **enkel** voor een ingepland ticket (`display`), "Afspraak annuleren" enkel bij een lopend voorstel (seed via `kern.toestand`). (2) **Aankomst registreren**: toast "⏱ Aankomst geregistreerd: 09:xx", `localStorage.blitz_arrivals` bevat `<datum>__p1`; tweede klik: `confirm` "Aankomst al geregistreerd om …. Overschrijven?" (accepteer en weiger). (3) **Verzetten in `?test`**: venster opent met de huidige datum/tijd van het ticket, Opslaan: toast "🧪 Testmodus — niet opgeslagen", `planning` verhuisd, status "Wachten op bevestiging planning"; "Selecteer een datum" bij lege datum; `confirm` bij feestdag. (4) **Voorstel in `?test`**: de lokale tak: toast "🧪 Testmodus — voorstel verstuurd (demo)", `voorstelStatus[p1]` bevat `contact` en `tijdslot`. (5) **Foto's**: knop opent `#foto-overlay` (`GET /api/fotos?ticketId=p1`), de grid toont de stubfoto's. (6) **Klantbeschikbaarheid-sectie**: bestaande test blijft; voeg toe dat een ongeopgeslagen wijziging bij Sluiten de waarschuwing "Je hebt wijzigingen … weggooien?" toont (dialoog "Weggooien"/"Terug"). (7) **Toewijzen** in `?test`: `saveToewijzen` toast "🧪 Testmodus — niet opgeslagen", ticket in `planning` (de test uit `route-tijden.spec.mjs` over de uitklap niet dupliceren). (8) **Bubbel/focus**: Enter op een gefocuste kaart opent het detail, Escape sluit het.
- [ ] **Step 2: Escape en focusval per dialoog (`vensters.spec.mjs`).** Per bereikbare overlay (`det-overlay`, `reschedule-overlay`, `set-overlay`, `block-overlay`, `proposal-overlay`, `manueel-overlay`, `local-det-overlay`, `foto-overlay`, `prijs-overlay`, `rapport-wizard`, `result-overlay`, `import-overlay` indien bereikbaar): open; (a) focus staat binnen het venster (eerste niet-tekstveld); (b) Tab van de laatste focusbare knop springt naar de eerste, Shift+Tab omgekeerd; (c) Escape sluit het venster en de focus keert terug naar de opener; (d) een klik op de achtergrond (de overlay zelf) sluit, een klik in de inhoud niet (voor de vensters die dat nu doen; leg per venster het huidige gedrag vast, bv. de wizard en prijsbeheer vragen bevestiging: Escape toont het dialoog); (e) gestapeld: open detail, daarna het verzetvenster: Escape sluit enkel het bovenste. Tabel in de test: `[overlayId, opener]`.
- [ ] **Step 3: Run** (twee keer; geen vaste wachttijden) en **commit** `test(detail): karakterisering ticketdetail en vensterbeheer (etappe 5a)`. De body noemt de niet-bereikbare vensters en waarom.

---

### Task 5: Kern-aanvullingen, pure logica en spec-migratie (deel 1)

**Aanbevolen model:** sonnet (kleine kern-API's met unit-tests, mechanische migratie)

**Feasibility:** unit voor `kern/omgeving.js`, `kern/ui.js` en `ticketdetail-logica.js` (alles puur, in node importeerbaar; `registreerWijzigActies`/`registreerBackdrop` testen met een nep-wortel zoals `tests/ui.test.mjs` voor `registreerActies`); `venster.js` blijft e2e-getest (taak 4). De spec-migratie is vandaag al mogelijk omdat `kern.toestand` bestaat en de `window.kern`-brug laadt vóór de tests evalueren.

**Files:**
- Maak: `public/js/kern/omgeving.js`, `public/js/schermen/ticketdetail-logica.js`, `tests/omgeving.test.mjs`, `tests/ticketdetail-logica.test.mjs`
- Wijzig: `public/js/kern/ui.js`, `tests/ui.test.mjs`, `public/js/venster.js`, `public/js/rapport-wizard.js`, `inventaris.js`, `rapport-archief.js`, `outbox.js`, `prijzen.js` (alleen importregel `TEST_MODE`), `public/js/kern/brug.js`, `public/sw.js`, e2e-specs (spec-migratie)

- [ ] **Step 1: `kern/omgeving.js`.** `export const TEST_MODE = new URLSearchParams(globalThis.location?.search ?? '').has('test');` Unit-test met `globalThis.location` gezet vóór dynamische import (`laadVers`-patroon via querystring-import) voor beide waarden.
- [ ] **Step 2: Importregels in de vijf oudere modules.** Bovenaan: `import { TEST_MODE } from './kern/omgeving.js';`. Verder niets (D7). Controle: `git diff --stat` toont per bestand `1 insertion`; de wizard-e2e blijft groen. Het klassieke `const TEST_MODE` in `index.html` blijft.
- [ ] **Step 3: `kern/ui.js`: `registreerWijzigActies(wortel, handlers)`** — luistert `change` (attribuut `data-wijzig`) en `input` (attribuut `data-invoer`) op de wortel, handler `(el, e, arg)` met `arg = el.dataset.arg`; geeft een afmeld-functie. **`registreerBackdrop(overlay, sluit)`** — `click`-luisteraar op de overlay die `sluit(e)` aanroept enkel als `e.target === overlay`. Unit-tests: juiste handler per naam, onbekende naam negeren, `closest` vanuit een kindelement, afmelden, backdrop met kindklik (geen aanroep) en eigen klik (aanroep).
- [ ] **Step 4: `venster.js`.** Voeg `export` toe aan `registreer` onder de naam `registreerVenster` (zelfde functie; `window.vensterBeheer` blijft voor nu). De tabelregel-lus (`sluitVia`) blijft tot de laatste dialoog verhuisd is; elke taak 6–8 schrapt zijn eigen regel. Geen gedragswijziging: `tests` van taak 4 blijven groen.
- [ ] **Step 5: `ticketdetail-logica.js`.** Letterlijk overgenomen uit `index.html`: `tijdslotVoor(minuten, slotMinuten)` (3644), `roundToNextQuarterStr` (3668), `cleanTicketSubject` (3722), `joinNL` (4090), `meervoud` (4256), `telNummer` (2919), `voorstelOntvangers(ticket)` (de ontdubbelde, hoofdletterongevoelige lijst uit `openProposal` 3695–3704), `bevestigdLabel(vs)` (2837), `heeftLopendVoorstel(t)` (3818; parameter `voorstelStatus` toevoegen). Parameters in plaats van globals; geen `window`/`document`.
- [ ] **Step 6: Unit-tests (handberekend, `TZ = 'Europe/Brussels'`).** `tijdslotVoor(540, 180)` en randen (afronding, negatieve of te kleine slot: gedrag zoals nu, noteer "Gemeten"), `roundToNextQuarterStr('09:00')`/`'09:01'`/`'23:50'`, `cleanTicketSubject` (geneste `RE: FW:`, "Nieuw contactbericht van …" → "uw laadstation", leeg), `joinNL` (1, 2, 3 items), `meervoud`, `telNummer('+32 (0)9 123 45 67')`, `voorstelOntvangers` (zelfde adres in andere hoofdletters, drie verschillende, geen), `bevestigdLabel` (alle bronnen), `heeftLopendVoorstel`.
- [ ] **Step 7: Brug en `sw.js`.** `window.kern.ticketdetailLogica = { ...ticketdetailLogica }` in `brug.js`; de klassieke kopieën in `index.html` blijven in deze taak ongewijzigd staan (geen gedragswijziging); ze verdwijnen in de taken 6–8 bij hun gebruikers, die `kern.ticketdetailLogica.*` aanroepen. `SHELL`: `/js/kern/omgeving.js`, `/js/schermen/ticketdetail-logica.js`.
- [ ] **Step 8: Spec-migratie deel 1 (D14).** Vervang in `e2e/conflict-409.spec.mjs`, `kern.spec.mjs`, `route.spec.mjs`, `kalender-hulp.mjs`, `kalender.spec.mjs`, `kalender-indelingen.spec.mjs`, `route-tijden.spec.mjs`, `ticketdetail.spec.mjs` elk kaal gebruik van `planning`, `localEvents`, `allTickets`, `avExceptions`, `activeAssigneeFilter` door `kern.toestand.get('…')`/`set`/`raak`: lezen `get`; `localEvents = [...localEvents, e]` → `kern.toestand.set('localEvents', [...kern.toestand.get('localEvents'), e])`; `planning[...].ticket.assignee = 'Sam'` → muteer via `get` en `raak('planning')`; `window.activeAssigneeFilter` → `get('activeAssigneeFilter')`. Functies (`removeLocalEvent`, `openManueelModalEdit`, `saveAvailability`, `addTicketToDate`, `removeTicketFromDate`, `avVersie`) blijven in deze taak onaangeroerd (migreren in 5b bij hun module). Controle: een grep in de ledger-stijl van bijlage A over `e2e/` (kale toestandsnaam binnen `page.evaluate`/`waitForFunction`) is leeg.
- [ ] **Step 9: Run** (`node --test`, `npx playwright test`, e2e twee keer) en **commit** `refactor(kern): omgeving, wijzig- en backdrop-delegatie, pure detaillogica en spec-migratie deel 1 (etappe 5a)`.

---

### Task 6: `ticketdetail.js` — detail, verzetvenster, toewijzen en aankomst

**Aanbevolen model:** sonnet (grote verhuizing met Zoho-takken en veel afh; letterlijk)

**Feasibility:** de productiepaden (`saveReschedule` → `plan`, `saveToewijzen` → `plan-datum`) hebben hun test uit taak 2 en de `?test`-gedragstests uit taak 4; de verhuizing is bewijsbaar doordat die tests ongewijzigd groen blijven. `openDetail` wordt door kalender, wachtrij, route en ingepland via `afh.openDetail` aangeroepen (geen kale oproepen: grep in Step 1). Niet bereikbaar: de `!TEST_MODE`-tak van `saveReschedule` in `?test` (gedekt door de productietest).

**Files:**
- Maak: `public/js/schermen/ticketdetail.js`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/js/venster.js`, `public/js/rapport-wizard.js` (importregels), `public/sw.js`, `e2e/kern.spec.mjs`

- [ ] **Step 1: Inventaris (ledger).** Lezers/schrijvers van `activeTicket`, `_detailDate`, `_kbIsDirty`, `arrivalData`, `openDetail`, `closeDet`, `sluitDetailStil`, `getPlanningTicket`, `registerArrival`, `toggleAssignRow`, `saveToewijzen`, `tijdslotLabelVoor`, `telNummer`, `contactActiesHtml`, `koppelAdresNavigatie`, `openRescheduleModal`, `togglePlanFromDetail`. **Bare-gebruikersaudit** (bijlage A) voor de oudere modules: verwacht de wizard (`arrivalData`, `getPlanningTicket`, `sluitDetailStil`) en `venster.js` (`closeDet`, `closeRescheduleModal`). Noteer ook de klassieke lezers van `activeTicket` (voorstel, annuleer, kb-sectie, foto) die via accessors blijven lopen tot hun taak.
- [ ] **Step 2: `initTicketdetail(afh)`.** `afh` zoals Interfaces; `strengeAfh('ticketdetail', afh)`. Registreert: `registreerActies(document.body, { 'det-sluit', 'det-plan', 'det-aankomst', 'det-voorstel', 'det-fotos', 'det-rapport', 'det-annuleer', 'det-verzet', 'verzet-sluit', 'verzet-opslaan' })` met de huidige `onclick`-inhoud (de `openProposal(...)`-aanroep met `computeArrivalTimes` via `afh`; `activeTicket?.id` en `_detailDate` uit de module), `registreerBackdrop(#det-overlay, closeDet)` en `registreerBackdrop(#reschedule-overlay, closeRescheduleModal)`, `registreerVenster({ el: #det-overlay, sluit: closeDet })` en idem voor het verzetvenster, en de luisteraars `registerArrival`-knop. **Verwijder** de tabelregels `det-overlay` en `reschedule-overlay` uit `venster.js`. `index.html`: de 13 inline handlers van gebied 5 en 6 worden `data-actie="…"` (ids, `aria-*`, teksten, `style` ongewijzigd); de knop in `det-overlay` die `closeDet()` aanroept (zonder event) en de achtergrond (met event) blijven onderscheiden: de achtergrond is `registreerBackdrop`, de knop `data-actie="det-sluit"`.
- [ ] **Step 3: Verhuis letterlijk** (D12): `openDetail` (incl. de plan-knoplogica, gebruikt `afh.renderKbSection`), `closeDet`, `sluitDetailStil`, `openRescheduleModal`, `closeRescheduleModal`, `saveReschedule`, `togglePlanFromDetail` (`kern.capaciteit.nextAvailableDay`, `afh.addTicketToDate`, `afh.bevestigUitplannen`), `contactActiesHtml`, `koppelAdresNavigatie` (`afh.navigate`), `registerArrival` en `arrivalData` (de `localStorage`-sleutel `blitz_arrivals`; `afh.renderRouteList`), `getPlanningTicket`, `toggleAssignRow`, `saveToewijzen`, `tijdslotLabelVoor` (gebruikt `kern.ticketdetailLogica.tijdslotVoor` en `settings` uit `kern.toestand`). `TEST_MODE` uit `kern/omgeving.js`. Exports volgens Interfaces. `window.getActiveAssignee` blijft in `index.html` (wizard).
- [ ] **Step 4: Oproepplaatsen.** `index.html` (klassiek, binnen function-bodies): `openDetail(...)`-oproepen in `afh`-objecten (`initWachtrij`, `initKalender`, `initIngepland`, `initRoute`) worden `kern.ticketdetail.openDetail`; idem `tijdslotLabelVoor`, `telNummer`, `contactActiesHtml`, `koppelAdresNavigatie`, `toggleAssignRow`, `saveToewijzen`, `registerArrival`, `aankomstVoor: key => kern.ticketdetail.arrivalData[key]`. Klassieke `openProposal`, `sendProposal` en `verstuurAnnulatie` lezen `activeTicket`/`_detailDate` via `kern.ticketdetail.actiefTicket()`/`detailDatum()`; waar ze `activeTicket = …` toewijzen (openProposal: `activeTicket = getPlanningTicket(ticketId)`), gebruiken ze `kern.ticketdetail.zetActiefTicket(t)` (exporteer die). Verwijder de verhuisde `let`'s en functies (K3-grep). `rapport-wizard.js`: importregels voor `arrivalData`, `getPlanningTicket`, `sluitDetailStil` uit `./schermen/ticketdetail.js` (D2; geen andere wijziging).
- [ ] **Step 5: `e2e/kern.spec.mjs`.** Eventuele aanpassingen aan hertekentellers uitsluitend als `renderKalender`-aantallen door de verhuizing wijzigen (verwachting: ongewijzigd; ze mogen niet stijgen).
- [ ] **Step 6: `brug.js`, `sw.js`.** `window.kern.ticketdetail = { ...ticketdetail }`; `SHELL` + `/js/schermen/ticketdetail.js`. Geen nieuwe legacy-namen.
- [ ] **Step 7: Zoho-diffcontrole (D12).** `git diff -w --color-moved=dimmed-zebra` van `saveReschedule`/`saveToewijzen`: noteer het resultaat in de commitbody (enkel verplaatsing plus `afh.`/`kern.`-prefixen).
- [ ] **Step 8: Run.** `node --test`, `npx playwright test` (taken 2 en 4 ongewijzigd groen; wizard- en route-e2e groen); `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` leeg; `grep -nE "onclick=\"(closeDet|togglePlanFromDetail|registerArrival|openProposal|openFotoModal|openRapport|openAnnuleerVenster|openRescheduleModal|closeRescheduleModal|saveReschedule)" public/index.html` leeg.
- [ ] **Step 9: Commit** `refactor(ticketdetail): ticketdetail.js — detail, verzetvenster, toewijzen en aankomst (etappe 5a)`.

---

### Task 7: `voorstel.js` — voorstel, voorstelstatus en bevestigingslabel

**Aanbevolen model:** sonnet (Zoho-/mailpad, asynchrone takken, letterlijk)

**Feasibility:** `sendProposal` en `loadVoorstelStatus` zijn productie-bewezen (taak 3: payloads, 409-herhaling, DELETE, lokale staat) en `?test`-bewezen (taak 4). `updateProposalPreview` volgt uit de bestaande voorstelspec (`voorstel-afspraak-blokkering.spec.mjs`). De `oninput`-handlers (`proposal-date`, `proposal-time`) zijn met `fill` te triggeren. Niet bereikbaar: niets nieuws.

**Files:**
- Maak: `public/js/schermen/voorstel.js`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/js/venster.js`, `public/sw.js`

- [ ] **Step 1: Inventaris.** Lezers van `voorstelStatus`, `_voorstelStatusVersie`, `_proposalOntvangers`, `loadVoorstelStatus` (opstart in `DOMContentLoaded`, `kern.route` via `afh.loadVoorstelStatus`, `verstuurAnnulatie`), `openProposal` (route via `afh.openProposal`, detailknop), `bevestigdLabel`/`heeftLopendVoorstel` (route, detail, kalender: `afh.bevestigdLabel`), `DOELGROEP_LABEL`, `ANN_DOELGROEP`.
- [ ] **Step 2: `initVoorstel(afh)`.** Registreert `registreerActies(document.body, { 'voorstel-sluit', 'voorstel-verstuur' })`, `registreerWijzigActies(document.body, { 'voorstel-voorbeeld' })` (de twee `oninput`-velden krijgen `data-invoer="voorstel-voorbeeld"`), `registreerBackdrop(#proposal-overlay, closeProposal)`, `registreerVenster`. **Verwijder** de tabelregel `proposal-overlay` uit `venster.js`. Het inerte anker in het voorbeeld (`onclick="return false"`, gebied 22) wordt `data-actie="voorstel-inert"` met een handler die `e.preventDefault()` doet (identiek gedrag, geen navigatie). In `index.html` de zes handlers van gebied 15.
- [ ] **Step 3: Verhuis letterlijk** (D12): `loadVoorstelStatus`, `openProposal`, `updateProposalPreview`, `closeProposal`, `sendProposal`; de pure helpers komen uit `kern.ticketdetailLogica`; `DOELGROEP_LABEL`, `_voorstelStatusVersie`, `_proposalOntvangers` module-privé. `hertekenStatus` en andere kale `renderTickets()/renderKalender()/renderRouteList()`-aanroepen worden `kern.wachtrij.renderTickets()`, `kern.kalender.renderKalender()` en `afh.renderRouteList(date)`. `activeTicket` via `afh.actiefTicket()` en `afh.zetActiefTicket()`.
- [ ] **Step 4: Oproepplaatsen.** `DOMContentLoaded`: `kern.voorstel.loadVoorstelStatus()`; `afh` van `initRoute`: `loadVoorstelStatus`, `heeftLopendVoorstel`, `bevestigdLabel`, `openProposal` → `kern.voorstel.*`/`kern.ticketdetailLogica.*`; `initKalender`/`initIngepland` krijgen `bevestigdLabel` indien ze die gebruiken. Verwijder de verhuisde `let`'s (`_proposalOntvangers`, `_voorstelStatusVersie`) en functies uit `index.html` (K3-grep). Bare-gebruikersaudit: oudere modules gebruiken geen van deze namen (verwacht: leeg).
- [ ] **Step 5: `brug.js`, `sw.js`.** `window.kern.voorstel`; `SHELL` + `/js/schermen/voorstel.js`.
- [ ] **Step 6: Zoho-diffcontrole.** `git diff -w --color-moved` van `sendProposal`: enkel verplaatsing plus prefixen; noteer in de commitbody. Controleer dat `e2e/productie/voorstel.spec.mjs` ongewijzigd groen is (`git diff --stat` op die map leeg sinds taak 3).
- [ ] **Step 7: Run** (zoals taak 6) en grep `onclick="(closeProposal|sendProposal)` / `oninput="updateProposalPreview` leeg.
- [ ] **Step 8: Commit** `refactor(voorstel): voorstel.js — voorstel, voorstelstatus en bevestigingslabel (etappe 5a)`.

---

### Task 8: `annuleren.js` — annuleervenster

**Aanbevolen model:** sonnet (Zoho-/mailpad met drie verzoektypen, `busy`-toestand, oninput/onchange)

**Feasibility:** productie-bewezen in taak 3 (redenen, voorbeeld, versturen, alle foutpaden, `inFlight`); het bubbel-/focusgedrag volgt uit taak 4 (`annuleer-overlay` is er enkel in productiemodus bereikbaar: de Escape/focus-test voor dit venster staat dus in `e2e/productie/annuleren.spec.mjs` en wordt in deze taak toegevoegd). `annuleerWijzig` bij elke `input`/`change` is met `fill` en `check` te triggeren.

**Files:**
- Maak: `public/js/schermen/annuleren.js`
- Wijzig: `e2e/productie/annuleren.spec.mjs` (Escape/focus), `public/js/kern/brug.js`, `public/index.html`, `public/js/venster.js`, `public/sw.js`

- [ ] **Step 1: Inventaris.** Oproepers van `openAnnuleerVenster` (detailknop, `bevestigUitplannen` in `index.html`, route via `afh.bevestigUitplannen`), `sluitAnnuleerVenster`, `verstuurAnnulatie`, `annuleerWijzig`, `annuleerVoorbeeld`, `_ann`, `_annuleerRedenen`, `ANN_DOELGROEP`. `bevestigUitplannen` (klassiek, 1632) roept `openAnnuleerVenster` → `kern.annuleren.openAnnuleerVenster`.
- [ ] **Step 2: Escape/focus in productiemodus.** Voeg aan `annuleren.spec.mjs` toe: open het venster; focus binnen; Tab-val; Escape sluit (niet tijdens `busy`: houd het `annuleer`-verzoek vast en druk Escape: venster blijft open); klik op de achtergrond sluit niet tijdens `busy`. (Vóór de verhuizing groen.)
- [ ] **Step 3: `initAnnuleren(afh)`.** Registreert `registreerActies(document.body, { 'annuleer-sluit', 'annuleer-terug', 'annuleer-verstuur' })`, `registreerWijzigActies(document.body, { 'annuleer-wijzig' })` (`data-invoer` voor de toelichting, `data-wijzig` voor de mailkeuze-radio's en reden-select), `registreerBackdrop(#annuleer-overlay, sluitAnnuleerVenster)`, `registreerVenster`. **Verwijder** de tabelregel `annuleer-overlay`. De zeven handlers van gebied 16 in `index.html`.
- [ ] **Step 4: Verhuis letterlijk** (D12): alles uit 3818–4090 behalve wat in taak 7 ging: `heeftLopendVoorstel` is al logica; `annuleerDoor`, `laadAnnuleerRedenen`, `annuleerZoekTicket`, `annuleerStopDatum`, `openAnnuleerVenster`, `annuleerLees`, `annuleerWijzig`, `annuleerVoorbeeld`, `sluitAnnuleerVenster`, `verstuurAnnulatie`; kale `renderTickets()/renderKalender()/renderRouteList()/updateRouteBtns()` → `kern.*`/`afh`; `inFlightTickets.has` → `afh.inFlight`; `loadVoorstelStatus` → `afh`; `joinNL`, `ANN_DOELGROEP` lokaal/logica.
- [ ] **Step 5: Oproepplaatsen, brug, sw.** `window.kern.annuleren`; `SHELL` + `/js/schermen/annuleren.js`; K3-grep voor `_ann`, `_annuleerRedenen`; bare-gebruikersaudit.
- [ ] **Step 6: Zoho-diffcontrole.** `git diff -w --color-moved` van `verstuurAnnulatie`, `annuleerVoorbeeld`, `laadAnnuleerRedenen`; noteer in de commitbody; `git diff --stat` op `e2e/productie/` toont enkel de Escape/focus-toevoeging uit Step 2 (in een eerdere commit van deze taak, vóór de verhuizing).
- [ ] **Step 7: Run** en grep `onclick="(sluitAnnuleerVenster|verstuurAnnulatie)`, `oninput="annuleerWijzig`, `onchange="annuleerWijzig` leeg.
- [ ] **Step 8: Commit** (twee commits: `test(annuleren): Escape en focus in productiemodus (etappe 5a)` en `refactor(annuleren): annuleren.js — annuleervenster (etappe 5a)`).

---

### Task 9: Afronding 5a — docs en eindcontrole

**Aanbevolen model:** haiku (mechanisch; commando's en verwachte uitkomsten staan hieronder; geen code schrijven; bij mislukken één tier hoger = sonnet)

**Feasibility:** enkel grep-, diff- en testcommando's plus tekst.

**Files:** Wijzig: `CHANGELOG.md`, `CLAUDE.md`, `public/sw.js` (alleen als de controle iets mist)

- [ ] **Step 1: `public/sw.js`.** `grep -o "'/js/\(kern\|schermen\)/[a-z-]*\.js'" public/sw.js` bevat `kern/omgeving.js`, `schermen/ticketdetail-logica.js`, `ticketdetail.js`, `voorstel.js`, `annuleren.js`. `CACHE_NAME` onveranderd (`git diff` toont geen wijziging).
- [ ] **Step 2: Audits (resultaat in de ledger).** (a) `grep -nE "onclick=\"|onchange=\"|oninput=\"" public/index.html | wc -l` = **78** (105 − 27). (b) `grep -nE "^(async )?function (openDetail|closeDet|sluitDetailStil|openProposal|sendProposal|verstuurAnnulatie|openAnnuleerVenster|saveReschedule|saveToewijzen|toggleAssignRow|registerArrival|getPlanningTicket|telNummer|contactActiesHtml|koppelAdresNavigatie|loadVoorstelStatus|tijdslotVoor|tijdslotLabelVoor|roundToNextQuarterStr|cleanTicketSubject|joinNL|meervoud|bevestigdLabel|heeftLopendVoorstel)" public/index.html` leeg. (c) `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` leeg. (d) `grep -rn "registreerActies\|registreerWijzigActies" public/js | grep -o "'[a-z-]*':" | sort | uniq -d` leeg (geen naam dubbel). (e) `git diff 531cf1d..HEAD -- public/js/kern/brug.js` toont enkel nieuwe `window.kern.*`-regels, geen nieuwe legacy-namen. (f) `venster.js` tabel bevat de regels `det-overlay`, `reschedule-overlay`, `proposal-overlay`, `annuleer-overlay` niet meer.
- [ ] **Step 3: `CHANGELOG.md`** onder "Refactor-tak — nog niet uitgebracht", **Added**: "Extra testrobot die de app draait zoals in productie (zonder testmodus) tegen een volledig nagebootste backend, zodat de berichten naar Zoho (plannen, datum, voorstel, annuleren) exact gecontroleerd worden." **Changed**: "Ticketdetail, afspraakvoorstel en annuleervenster zijn intern herbouwd en staan nu in eigen onderdelen; voor jou ziet alles er hetzelfde uit en werkt het hetzelfde." Plus een **Fixed**-regel voor elke bug uit de ledger (met test).
- [ ] **Step 4: `CLAUDE.md`.** Sectie "Tests": aantallen bijwerken (unit en e2e) en een alinea **Productiemodus** (map `e2e/productie/`, fixture `productie-hulp.mjs`, de vijf sloten, `verwachtSchrijven`, `tickets.json`-fixture en pariteitstest; "nooit `helpers.mjs`' `test` gebruiken voor schrijfpaden"). Sectie "Kern": `omgeving.js`, `registreerWijzigActies` (`data-wijzig`/`data-invoer`), `registreerBackdrop`. Sectie "Schermen": **Etappe 5a** met de vier bestanden, hun rol, `init…(afh)` vóór `koppelRenders`, private toestand, accessors (`actiefTicket()`, `detailDatum()`), `registreerVenster` in plaats van de `venster.js`-tabel, en de regel dat Zoho-functies letterlijk verhuizen met de productietest als vangnet.
- [ ] **Step 5: Run.** `node --test` en `npx playwright test` groen; noteer de aantallen in de ledger. De controller doet daarna een visuele steekproef (ingebouwde browser: detail, verzetvenster, voorstelvenster, annuleervenster; computer en gsm) en de etappe-eindreview (sonnet, Review Focus 1–7).
- [ ] **Step 6: Commit** `docs(detail): changelog en conventies voor etappe 5a`.

---

## Na de taken

Etappe-eindreview 5a (sonnet) met het diffpakket van `index.html`, de vier modules en `e2e/productie/`, gericht op de zeven punten van de Review Focus. Daarna `git merge main` vanuit de refactor-worktree en een volledige testrun. Restpunten voor 5b in de ledger: `inFlightTickets`, `window.getActiveAssignee`, `window.syncOplossingNaarZoho`, de `venster.js`-tabel (laatste tien regels), de LEGACY-namen, kale functieaanroepen in specs.

## Bijlage A — bare-gebruikersaudit (per verhuizing)

Een verhuisde functie of `let` uit het klassieke script was stilzwijgend een globale naam. Oudere modules (`rapport-wizard.js`, `inventaris.js`, `rapport-archief.js`, `outbox.js`, `prijzen.js`, `venster.js`, `planner.js`) en e2e-specs kunnen er nog een kaal naam van gebruiken. Schrijf in de scratchpad een script dat (1) de top-level namen van `index.html` verzamelt (`/^(?:async )?function (\w+)|^(?:let|const|var) (\w+)/gm`), (2) per oudere module commentaar wegstript, (3) per naam test met `(?<![.\w$])naam(?![\w$])` en (4) de resultaten per module print. Verwachte uitkomst vóór etappe 5a (gemeten): wizard `TEST_MODE arrivalData getPlanningTicket loadFotos renderFotoGrid closeLocalDet sluitDetailStil DAGEN renderFotoGridInto handleFotoFiles`; inventaris `TEST_MODE loadFromCache saveToCache`; rapport-archief `TEST_MODE metBehoudScroll voorbeeldRapport`; outbox `TEST_MODE meervoud`; prijzen `TEST_MODE closeSettings`; venster `closeImportModal closeManueelModal closeLocalDet closeBlock closeResult closeDet closeRescheduleModal closeSettings closeFotoModal closeProposal sluitAnnuleerVenster closeRapportPreview` (namen als parameter of eigenschap, zoals `duurVoor` in `route.js` en `kbFor` in `planner.js`, zijn valse treffers). Elke echte treffer krijgt in dezelfde taak een importregel in die module (geen aanroep aanpassen) of, voor `venster.js`, een registratie door de module. Voor e2e: dezelfde lijst tegen `page.evaluate`-regels.
