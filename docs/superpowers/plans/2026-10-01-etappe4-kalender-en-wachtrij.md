# Etappe 4 — Kalender en wachtrij Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De Kalender-, Wachtrij- en Ingepland-tab verhuizen naar `public/js/schermen/` (`kalender.js`, `wachtrij.js`, `ingepland.js`, met pure `capaciteit.js`, `wachtrij-logica.js`, `kalender-logica.js`), op de fundamenten van `kern/`, zonder zichtbare gedragswijziging. `quickAdd` en de capaciteitskop blijven op het aantalmodel (spec C3).

**Architecture:**
- Pure bestanden zijn unit-getest; DOM-bestanden raken `document`/`window` enkel binnen functies of in `init…(afh)`. Alleen `kern/brug.js` wijst `window`-namen toe (`window.kern.kalender|wachtrij|ingepland|capaciteit` plus drie nieuwe LEGACY-namen).
- Afhankelijkheden uit het klassieke script komen via `init…(afh)` (Proxy-terugval); gegevens en instellingen uit `kern.toestand`; schermtoestand (`kalOffset`, `wqSorteer`, `gepOffset`, …) is module-privé.
- Knoppen die de verhuisde code tekent gebruiken `data-actie`-delegatie met een bubbel-guard op de kaartluisteraars (C8).

**Tech Stack:** vanilla ES-modules zonder bouwstap, `node --test`, `@playwright/test` (bestaand).

**Spec:** `docs/superpowers/specs/2026-10-01-etappe4-kalender-en-wachtrij-design.md`. Lees §2 (feiten) en §3 (eisen C1–C20) vóór Taak 1. Elke taak heeft een feasibility-regel: de unit- of e2e-weg waarlangs ze bewijsbaar is, gecontroleerd in de code (les etappe 2).

## Global Constraints

- Werk in de worktree `.claude/worktrees/planner-brein` (tak `refactor`). Prefix elke shell-opdracht met `cd "<worktree>" &&` en controleer vóór elke commit `git branch --show-current` = `refactor`. Nooit `git checkout`, nooit committen in de main-checkout, niet pushen.
- Zichtbaar gedrag identiek (W5). Een gevonden bug: eigen test + "Fixed"-regel (Taak 7) en vermelding in de commit.
- Nooit echte Zoho-, TomTom- of mail-aanroepen. Zoho-paden (W11, C11): `addTicketToDate`, `removeTicketFromDate`, `bevestigUitplannen`, `saveToewijzen`, `autoPlan` niet bewerken (enige uitzondering C13, één token). Controle in elke review: `git diff` van die functies toont enkel regelverschuivingen.
- `rapport-wizard.js`, `planner.js`, `sorteer.js`, `route*.js` en andere bestaande modules niet wijzigen, behalve wat een taak uitdrukkelijk noemt (`kern/ui.js`, `kern/selecties.js`, `kern/brug.js`).
- K3: klassieke code op het hoogste niveau gebruikt `window.kern`, accessors of verhuisde functies nooit. Per verhuizing: `grep -nE "^(let|const|var) .*<naam>" public/index.html` en controleer gebruik buiten function-bodies.
- `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` moet leeg zijn.
- Tests: `npx playwright test` en `node --test` (zonder pad; nooit `node --test tests/`). Nieuwe unit-tests in `tests/*.test.mjs` (`process.env.TZ = 'Europe/Brussels'` bovenaan bij tijdlogica); nieuwe e2e in `e2e/*.spec.mjs` die `test`/`expect` uit `./helpers.mjs` importeren; geen `waitForTimeout`, geen screenshots. Gemeten waarden mogen in een test mits commentaar "Gemeten". Nieuwe specs gebruiken `kern.toestand.get/set/raak`, geen kale globals (C16).
- Eén dev-/testserverproces: stop enkel je eigen PID.
- `public/sw.js`: elk nieuw bestand in dezelfde commit in `SHELL`; `CACHE_NAME`, `package.json`-versie en tags onaangeroerd (C17).
- Namen en commentaar in het Nederlands. Houd de `sjLog(...)`-regels aan (K16, via `afh.sjLog`). Verhuis commentaar mee met de code.
- Commit-trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ledger: `.superpowers/sdd/2026-10-01-etappe4-kalender-en-wachtrij/`. Brief en diff als bestand naar subagents; terugmelding maximaal 15 regels.
- Modelkeuze per taak staat bij de taak (W12). Eindreview van de etappe: sonnet (C19).

## Review Focus

1. **Zoho onaangeroerd (W11)**: `git diff main..HEAD` voor `addTicketToDate`, `removeTicketFromDate`, `bevestigUitplannen`, `saveToewijzen`, `autoPlan`: enkel regelverschuivingen plus de ene `weekOffset()`-token in `autoPlan`; geen `/api/plan*`, `/api/annuleer`-verzoek in e2e.
2. **Kaartklik opent het detail**: elke delegatie-knop (`+`, `✕`, Toewijzen, pil) opent het detail níét; bubbel-guard aanwezig op elke kaartluisteraar (`grep -n "closest('\[data-actie\]')"`).
3. **Dubbele handlers**: `kal-nav` en `kal-vandaag` staan nergens meer in `index.html`; geen `data-actie`-naam twee keer geregistreerd (`grep -rn "registreerActies" public/`).
4. **Renderaantallen**: `kern.spec.mjs` ongewijzigde getallen; tellers uit de modules, `WINDOW_RENDERS` weg; geen extra abonnement.
5. **Aantalmodel behouden (C3)**: `quickAdd` kiest dezelfde dag, de capaciteitskop toont dezelfde `n/cap · ±u` (differentiële vergelijking Taak 2 plus karakterisering Taak 1); `kalender-logica.js` en `capaciteit.js` roepen het brein niet aan.
6. **Hoogste-niveau-effecten**: geen `ResizeObserver`/`addEventListener`/`setInterval` op moduleniveau in de nieuwe bestanden; de init draait vóór `koppelRenders` en leest geen `settings`.
7. **Legacy-namen**: LEGACY-BRUG heeft precies `renderTickets`, `renderKalender`, `renderGepland` erbij; de lijst uit C4 is uit `index.html` verdwenen.

---

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `public/js/schermen/capaciteit.js` (nieuw, Taak 2) | aantalmodel: `blokkeerMinuten`, `capaciteitVoorDag`, `volgendeBeschikbareDag`, `capaciteitsKop`, `capacityForDay`/`nextAvailableDay` (toestandslezers), `initCapaciteit` |
| `public/js/schermen/wachtrij-logica.js` (nieuw, Taak 2) | zoeken, sorteren, scoren |
| `public/js/schermen/kalender-logica.js` (nieuw, Taak 2) | tijdlijnindeling, zichtbare dagen, maandraster, scrollsleutel |
| `public/js/schermen/wachtrij.js` (nieuw, Taak 3) | `renderTickets`, `quickAdd`, zoek/sorteer-init |
| `public/js/schermen/kalender.js` (nieuw, Taken 4–5) | kaartjes, tijdlijn, maand, nu-lijn, hoogte, state, `renderKalender`, navigatie |
| `public/js/schermen/ingepland.js` (nieuw, Taak 6) | `renderGepland`, `gepNav` |
| `public/js/kern/ui.js`, `public/js/kern/selecties.js` | `maakActiveerbaar`, `blokkeringenVoor` (Taak 2) |
| `tests/capaciteit.test.mjs`, `tests/wachtrij-logica.test.mjs`, `tests/kalender-logica.test.mjs` (nieuw), `tests/ui.test.mjs`, `tests/selecties.test.mjs` | unit-tests (Taak 2) |
| `e2e/kalender.spec.mjs` (uitgebreid), `e2e/wachtrij.spec.mjs`, `e2e/kalender-indelingen.spec.mjs` (nieuw), `e2e/kern.spec.mjs` | karakterisering (Taak 1); tellers (Taken 3, 5, 6) |
| `public/js/kern/brug.js`, `public/index.html`, `public/sw.js` | brug, dunne oproepen, `SHELL` |
| `CHANGELOG.md`, `CLAUDE.md` | Taak 7 |

## Interfaces (eindtoestand, gedeeld door alle taken)

```js
// schermen/capaciteit.js
export function blokkeerMinuten(rangeUitzonderingen, dagStartMin, dagEindMin)             // unie van geknipte intervallen, minuten
export function capaciteitVoorDag({ datum, isFeestdag, vanTijd, totTijd, duurMinuten, maxPerDag, dagBlokkering, rangeUitzonderingen, travelMin = 30 }) // -> aantal
export function volgendeBeschikbareDag(van, { nu, werkdagen, capaciteitVan, reedsGepland })     // -> 'YYYY-MM-DD' | null (60 dagen)
export function capaciteitsKop({ aantal, cap, duurMinuten, travelMin })                   // -> { label, vol }
export function initCapaciteit({ duurVoor, getHolidayName })                              // toestandslezers hieronder
export function capacityForDay(datum, travelMin = 30), nextAvailableDay(van)

// schermen/wachtrij-logica.js
export function wqNorm(x), wqZoekTekst(t), filterOpZoek(tickets, zoek), isOverdue(t, vandaag)
export function urgencyFactor(t, nu), queueScore(t, nu)
export function sorteerWachtrij(tickets, modus, { vandaag, nu })                          // 'standaard'|'oudst'|'nieuwst'|'interventie'; muteert niet

// schermen/kalender-logica.js
export const TIMELINE_PX_PER_MIN, TIMELINE_MIN_BLOCK_PX, WERKUUR_START, WERKUUR_EIND
export function isBuitenWerkuren(hhmm), timelineTopHeight(startMin, endMin, dagStartMin, totalHeight)
export function bepaalLanes(items)                                                        // zet lane/laneCount, geeft items terug
export function bouwTijdlijnItems({ dayStops, dayEvents, dayReports }, { duurVoor, tijdslotMinuten, duurMinuten })
export function zichtbareDagen(today, { werkdagen, tabletStaand, weekOffset, dagOffset })
export function maandRaster(ref)                                                          // 42 datums vanaf de maandag voor de 1e
export function autoScrollSleutel(weekStart, weergave)

// schermen/wachtrij.js     initWachtrij(afh), renderTickets(), quickAdd(ticketId), renderTelling()
// schermen/kalender.js     initKalender(afh), renderKalender(), activeerKalender(), weekOffset(), renderTelling(), togglePendingPanel()
// schermen/ingepland.js    initIngepland(afh), renderGepland(), renderTelling()
// kern/ui.js               maakActiveerbaar(el, handler, label)
// kern/selecties.js        blokkeringenVoor(avExceptions, datum, filter, soort)

// afh per module (alles uit index.html / andere schermen)
// wachtrij:  addTicketToDate, openDetail, prioLabel, kbFor, kbPreferred, kbPreferredTime, meervoud, inFlight(id), sjLog
// kalender:  tijdslotLabelVoor, telNummer, navigate, openDetail, openLocalEventDetail, removeLocalEvent, bevestigUitplannen,
//            herOpenRapport(entry), rapportArchief(), matchRespToPerson, duurVoor, getHolidayName, setTab, sjLog,
//            toggleAssignRow, saveToewijzen, openBlockModal
// ingepland: openDetail, tijdslotLabelVoor, contactActiesHtml, koppelAdresNavigatie, sjLog
```

---

### Task 1: Karakteriseringstests (geen productiecode)

**Aanbevolen model:** sonnet (test-zwaar, meet gedrag zoals het nu is)

**Feasibility:** gecontroleerd. Alles in `?test` met de standaard-stubs: `quickAdd` loopt via `addTicketToDate`, dat in testmodus geen fetch doet (de `!TEST_MODE`-tak is overgeslagen; `/api/plan` staat in `VERBODEN_PADEN` en de afterEach-vangnetten bewaken dat); de indelingen `smal` (`blitz_weergave = 'gsm'`) en `tablet-staand` (`blitz_weergave = 'tablet'` plus portretviewport) volgen uit `apparaat.js` los van pointer-media; de seed (eigen afspraken, blokkades) loopt via `opslagStub` zoals `kalender.spec.mjs`; `DUMMY_DATA` heeft een verlopen ticket (#1001, interventiedatum twee dagen geleden), `createdTime`-waarden, een "zonder datum"-ticket (#1005) en een bevestigd (#1006). **Niet bereikbaar en dus niet in deze taak (C18):** de `!TEST_MODE`-takken (`/api/plan`, `/api/plan-datum`), `✕` op een ticket met lopend voorstel, de minuuttimer en de poll, `Navigeer`.

**Files:**
- Wijzig: `e2e/kalender.spec.mjs`
- Maak: `e2e/wachtrij.spec.mjs`, `e2e/kalender-indelingen.spec.mjs`

Alle tests slagen op de **huidige** code. Waar de verwachting een gemeten waarde is: draai eerst, noteer de waarde in de test met commentaar "Gemeten". Hergebruik `seed()`/`dag()` uit `kalender.spec.mjs` (exporteer naar `e2e/kalender-hulp.mjs` als twee bestanden ze nodig hebben) en `zetInstellingenTim` uit `route-hulp.mjs`.

- [ ] **Step 1: Wachtrij (`wachtrij.spec.mjs`).**
  1. **Zoeken**: `#wq-zoek` met "1002", met "#1002" (het `#` valt weg), met een accentloze/andere hoofdletter-variant van een klantnaam, met twee woorden (alle moeten voorkomen); teller `#wq-teller` ("1 van 3 tickets"), de lege tekst "Geen tickets gevonden voor 'xyz'" en het terugkeren van de oorspronkelijke tekst na wissen; de badge `#cnt-tickets` blijft het totaal (vóór zoeken). Wacht via `toHaveCount` (debounce 150 ms), nooit via vaste tijd.
  2. **Sorteren**: de vier opties van `#wq-sorteer`; verwachte volgorde van de `.tnum`'s per optie (Gemeten uit `DUMMY_DATA`: #1001 verlopen en `high`); `localStorage.blitz_wachtrij_sorteer` bevat de keuze; na `page.reload()` staat de keuze er nog (het `select` en de volgorde).
  3. **Verlopen-tag en kbPref-tags**: #1001 toont "Verlopen" (class `overdue`); een klant-voorkeur (via `klantbeschikbaarheid`-seed met `voorkeur`, `voorkeurTijd` en `geblokkeerd`) toont de `📌`-/`🚫`-tags met de titelteksten.
  4. **Snelinplannen `+`**: klik op de `+` van het eerste ticket (technieker Tim): toast "✓ Toegevoegd aan …" (Gemeten datum: de eerste werkdag met vrije capaciteit vanaf de vaste klok), het ticket verlaat de lijst en `#cnt-tickets` daalt, de kalender toont het ticket op die dag, de kop van die dag toont `1/3 stops` en de `±`-uren (Gemeten); **het detailvenster opent niet** (`#d-num` blijft onzichtbaar); `verzoeken.van('/api/plan')` is leeg.
  5. **Volgende dag bij een volle dag**: plan drie tickets via `+` achter elkaar (of zet via `kern.toestand` drie planning-stops op maandag): het volgende gaat naar de volgende werkdag (Gemeten). Geblokkeerde hele dag (seed `fullday` op die dag) en een feestdag worden overgeslagen. Geen vrije dag (instelling `maxPerDag: 0` via `zetInstellingenTim`; controleer eerst dat de instelling 0 toelaat, zo niet gebruik 60 dagen `fullday`-blokkades): toast "Geen beschikbare werkdag gevonden".
  6. **Klik op de kaart** opent het detail (`#d-num` toont het nummer); Enter op de gefocuste kaart ook (`maakActiveerbaar`: `role="button"`, `tabindex="0"`, `aria-label="Open ticket #…"`).
  7. **Leeg**: zonder tickets (technieker zonder wachtrij) toont `#empty-tickets` zijn tekst.
- [ ] **Step 2: Kalender week (`kalender.spec.mjs`, uitbreiden).**
  1. **Capaciteitskop**: dinsdag `0/3 stops` (bestaat); na één ingeplande stop `1/3 stops · ±2.5u`; drie stops: `.day-cap` krijgt class `full`; een tijdvak-blokkering (seed `range` 10:00–17:00) geeft `0/0 stops` (Gemeten) en de `⏱ 1 uitzondering`-knoptekst; een hele-dag-blokkering geeft "🔒 Geblokkeerd"; een feestdag (navigeer vijf weken vooruit naar 11 nov, "Wapenstilstand") toont "🎌 Wapenstilstand" in kop en knop en class `holiday-day`; een tijdvak van een andere persoon telt niet bij filter Tim (bestaat gedeeltelijk in `voorstel-afspraak-blokkering.spec.mjs`: niet dupliceren, enkel de kop erbij).
  2. **Weergavewissel**: knoppen `#kal-view-week`/`#kal-view-month` (`aria-pressed`), wissel naar Maand: label "oktober 2026", 42 cellen (`.month-cell`), `.today-cell` op 5 okt, chips voor #1004 (`.pending`), de eigen afspraak (`.local`, met tijdprefix), de geblokkeerde dag (`.blocked`), `+N meer` bij meer dan vier chips (voeg via `kern.toestand` vijf eigen afspraken op één dag toe en `raak('localEvents')`); `›` in maandweergave gaat een maand verder, `Vandaag` terug; wissel naar Week reset de offset (label "5 okt – 11 okt").
  3. **Zonder uur**: na "Plan deze week" (Tim) staan #1001/#1002 als `.zu-chip` in de dagkop van maandag; klik op een chip opent het detail; vijf stops zonder uur op één dag (via `kern.toestand`) tonen vier chips en `+1 meer` met titel.
  4. **Tijdlijn**: twee overlappende eigen afspraken (14:00–15:30 en 15:00–16:00) staan in twee lanen (`style.width` bevat `/ 2 - 2px`); een late afspraak (23:30) blijft binnen de tijdlijn (top + hoogte ≤ de hoogte van `.tl-wrap`, Gemeten `1872px` = 1440 min × 1,3); buiten-werkuren-banden `.tl-offhours` ×2 per kolom; de rode `.tl-now` in de kolom van vandaag met label `/^09:\d\d$/`; `#week-grid` krijgt een inline `height` in `px` (≥ 400).
  5. **"Zonder datum"-paneel**: pil `#kal-pending-pill` zichtbaar met `1` (#1005), `aria-expanded` wisselt bij klikken (`togglePendingPanel`), het paneel toont het kaartje met "Wacht bevestiging — zonder datum"; klik op het kaartje opent het detail; "📅 Toewijzen" klapt de rij uit (bestaat in `route-tijden.spec.mjs`: enkel de `aria-expanded`-wisseling erbij); Sluiten-knop in de rij verbergt hem weer; **een klik op "Toewijzen" opent het detail niet**.
  6. **`✕ Uit planning halen` in de kalender**: na "Plan deze week" een `✕` op een tijdlijnblok: het bevestigingsdialoog "Uit planning halen" (dialoogknop, zoals `route.spec.mjs`), na bevestigen verdwijnt het blok, `#cnt-tickets` stijgt, het ticket staat weer in de wachtrij; Annuleren laat alles staan; **het detail opent niet**; geen `/api/plan` (vangnet).
  7. **"Route berekenen"-knop** per dag: opent de Route-tab met de datum ingevuld (bestaat via `maakRouteMetStops`; enkel de `renderRouteList`-gevolgen niet dupliceren).
  8. **Blokknop `⏱ Beschikbaar`** opent het blokvenster voor die datum (bestaat in `voorstel-afspraak-blokkering.spec.mjs`: niet dupliceren).
  9. **"Plan deze week" volgt de getoonde week (C13)**: ga met `›` naar 12–18 okt, "⚡ Plan deze week" (Tim): de tickets staan op 12 okt e.v. (kalender van die week toont `.tl-ticket`; de huidige week niet) en het matrix-verzoek bevat de bestemmingen. **Maandweergave**: ga naar Maand, `›` één keer, "⚡ Plan deze week": leg Gemeten vast welke week gepland wordt (verwacht: de week van 12–18 okt, omdat `kalOffset` = 1 maand in de maandweergave als 1 week wordt gebruikt; ga je twee maanden verder, dan is het 19–25 okt). Dit is de bekende eigenaardigheid uit C13: **de test beschrijft het huidige gedrag met commentaar "Bekende eigenaardigheid, zie spec C13"**.
- [ ] **Step 3: Indelingen (`kalender-indelingen.spec.mjs`).**
  1. **Gsm (`smal`)**: `addInitScript` zet `blitz_weergave = 'gsm'`, viewport 390×844. Kaarten (`.cal-ticket`, `.cal-local-event`) staan in tijdvolgorde (`data-sortkey`), zonder-uur-kaarten achteraan (`99:99`), een eigen afspraak om 07:00 toont de badge "buiten werkuren", `.kal-nu-marker` ("nu 09:xx") staat in de kolom van vandaag, geen `.tl-wrap`, `#week-grid` zonder `tl-mode`, `.cal-unplan-x` is verborgen (CSS), de knoppen Bellen/Navigeer staan op de kaart; weekwissel werkt.
  2. **Tablet staand (`tablet-staand`)**: `blitz_weergave = 'tablet'`, viewport 820×1180: drie opeenvolgende werkdagen (5, 6, 7 okt); `›` schuift één werkdag (6, 7, 8), `‹` terug, `kal-label` krijgt class `niet-vandaag` en de knop "↺ Vandaag" brengt terug; in maandweergave schuift `›` een maand (los van de dagverschuiving); vandaag geen werkdag (de vaste klok is een maandag: zet via `zetInstellingenTim` `werkdagen: [2,3,4,5]`): de eerstvolgende werkdag (dinsdag 6 okt) is het beginpunt (Gemeten).
  3. **Apparaatwijziging**: `page.evaluate(() => window.zetWeergave('gsm'))` (het API van `apparaat.js`) wisselt een open kalender van tijdlijn naar lijst zonder fout en zonder extra weergave-resten (`.tl-wrap` weg).
- [ ] **Step 4: Ingepland (`kalender.spec.mjs`, uitbreiden).** Kaart toont de tijdregel "🕐 08:30–11:30 (gepland 09:00)" voor #1006; "Geen geplande service deze week" in een lege week; de contactknoppen (`tel:`-link met `(0)` verwijderd, `mailto:`) en Navigeer openen het detail níét; de badge `#cnt-gepland` blijft het gefilterde totaal ook in een andere week; met technieker Roel (geen gepland ticket) is de lijst leeg en de badge `0`.
- [ ] **Step 5: Run.** `npx playwright test` en `node --test`: alles groen, geen productiecode gewijzigd (`git diff --stat` toont enkel `e2e/`). Herhaal de run één keer: geen flaky tests (geen vaste wachttijden).
- [ ] **Step 6: Commit** `test(kalender): karakterisering kalender, wachtrij en ingepland (etappe 4)`. De body noemt de Gemeten waarden van `quickAdd` (datum), de capaciteitskop en de maandweergave-planning (C13), en de niet-bereikbare paden (C18).

---

### Task 2: Pure laag — `capaciteit.js`, `wachtrij-logica.js`, `kalender-logica.js`, `kern`-aanvullingen

**Aanbevolen model:** sonnet (pure logica letterlijk overnemen, unit-tests, wrapper-omzetting)

**Feasibility:** unit (`node --test`), plus de e2e van Taak 1 als bewijs dat getoonde getallen, volgorde en `quickAdd`-dag gelijk blijven. De differentiële vergelijking draait eenmalig lokaal. `capaciteit.js` importeert alleen `kern/toestand.js` (puur) en is dus in node importeerbaar; de toestandslezers worden niet unit-getest maar door e2e gedekt.

**Files:**
- Maak: `public/js/schermen/capaciteit.js`, `public/js/schermen/wachtrij-logica.js`, `public/js/schermen/kalender-logica.js`, `tests/capaciteit.test.mjs`, `tests/wachtrij-logica.test.mjs`, `tests/kalender-logica.test.mjs`
- Wijzig: `public/js/kern/ui.js`, `public/js/kern/selecties.js`, `tests/ui.test.mjs`, `tests/selecties.test.mjs`, `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`

- [ ] **Step 1: Inventaris.** Noteer regels en oproepers van `capacityForDay`, `nextAvailableDay`, `PRIO_WEIGHT`/`urgencyFactor`/`queueScore`, `isOverdue`, `wqNorm`/`wqZoekTekst`, de sorteer-blokken in `renderTickets`, `isBuitenWerkuren`, `timelineTopHeight`, `assignTimelineLanes`, het `positioned`-opbouwblok in `renderDayTimeline`, `kalZichtbareDagen`, het rasterblok in `renderMonthView`, de sleutelberekening in `kalAutoScroll`, de zes `avExceptions`-filters (C12) en `maakActiveerbaar`. Noteer in de ledger dat `removeTicketFromAllDays` nergens wordt opgeroepen (grep).
- [ ] **Step 2: `kern/selecties.js` en `kern/ui.js`.** `blokkeringenVoor(avExceptions, datum, filter, soort)` (`soort` optioneel; filter `'all'` geeft enkel globale), `maakActiveerbaar` (letterlijk, gaat naar `kern/ui.js`; geen `window`). Unit-tests: globaal vs persoon, `'all'`, soort, lege invoer; `maakActiveerbaar` met een nep-element (`tabIndex`, `role`, `aria-label`, Enter/Space roept de handler, toets uit een binnenste knop niet, `preventDefault`).
- [ ] **Step 3: `capaciteit.js`.** Letterlijke overname met parameters in plaats van globals: `blokkeerMinuten` (clip op werkdag, sorteren, unie), `capaciteitVoorDag` (feestdag 0, hele-dag-blokkering 0, `Math.min(Math.floor(beschikbaar / (duurMinuten + travelMin)), maxPerDag)`), `volgendeBeschikbareDag` (60 dagen, verleden overslaan, `werkdagen.includes(getDay())`, `capaciteitVan(dag) − reedsGepland(dag) > 0`), `capaciteitsKop` (`${aantal}/${cap} stops · ±${Math.round(aantal * (duurMinuten + travelMin) / 60 * 10) / 10}u`, `vol = aantal >= cap`). De toestandslezers `capacityForDay(datum, travelMin)` en `nextAvailableDay(van)` lezen `settings`, `avExceptions`, `planning`, `activeAssigneeFilter` uit `toestand` en gebruiken `kern/selecties` (`persoonOfNull`, `blokkeringenVoor`, `planItemsVanTechnieker`); `reedsGepland` = som van `Math.ceil(duurVoor(id) / duurMinuten)` over de plan-items van de technieker (letterlijk). `initCapaciteit({ duurVoor, getHolidayName })`.
- [ ] **Step 4: `wachtrij-logica.js`.** `urgencyFactor(t, nu)`/`queueScore(t, nu)` krijgen `nu` als parameter (verder letterlijk); `isOverdue(t, vandaag)` (`vandaag` als `'YYYY-MM-DD'`); `filterOpZoek(tickets, zoek)` (de woorden-opsplitsing met weggelaten leidende `#`); `sorteerWachtrij(tickets, modus, …)` bevat de vier takken uit `renderTickets` (verlopen eerst, dan `queueScore`; `oudst`/`nieuwst` op `createdTime`; `interventie` op `interventieDatum`; ontbrekende datums achteraan) en geeft een nieuwe array.
- [ ] **Step 5: `kalender-logica.js`.** Constanten en pure functies letterlijk: `isBuitenWerkuren`, `timelineTopHeight`, `bepaalLanes` (= `assignTimelineLanes`, zichtbare-hoogte-overlap), `bouwTijdlijnItems` (het `positioned`-blok: tickets `uur` + `duurVoor`, eigen afspraken met de **kalender**-terugval `tijdslotMinuten / 3` (C3d), rapporten met `rapportData.start`/`stop` en `duurMinuten`), `zichtbareDagen` (week of tablet-staand 3 werkdagen met `dagOffset`), `maandRaster(ref)` (42 datums), `autoScrollSleutel`.
- [ ] **Step 6: Unit-tests** (handberekende cases, `TZ = 'Europe/Brussels'`):
  - `blokkeerMinuten`: één interval, overlappend, binnen een ander, buiten de werkdag (geknipt), leeg; `capaciteitVoorDag`: standaard 08:00–17:00, duur 120 + 30 → `3` (maxPerDag 4), maxPerDag 2 → 2, feestdag/dagblokkering → 0, tijdvak 10:00–17:00 → 0 (`120 / 150`); `volgendeBeschikbareDag`: vandaag vol → morgen, weekend overgeslagen, geen vrije dag in 60 → `null`, een datum in het verleden wordt overgeslagen; `capaciteitsKop`: `1/3 stops · ±2.5u`, `3/3` → `vol`, `0/0` → `vol`.
  - `filterOpZoek`: accenten, hoofdletters, `#`, meerdere woorden; `sorteerWachtrij`: vier modi met `null`-datums achteraan, verlopen eerst, stabiel bij gelijke score, muteert de invoer niet; `queueScore`: `high` bij datum over 7+ dagen = `1`, `low` zonder datum = `6`, onbekende prio = `9 × factor`.
  - `isBuitenWerkuren` (`'08:29'` true, `'08:30'` false, `'17:00'` true, `'24:00'`/`'abc'` false), `timelineTopHeight` (minimumhoogte 155, laat blok blijft binnen), `bepaalLanes` (twee overlappende → lanen 0/1 `laneCount 2`; kort blok dat visueel overlapt telt mee; drie keten-overlappende delen één cluster), `bouwTijdlijnItems` (ticket zonder uur uitgesloten, afspraak zonder einduur → 60 bij 180, rapport zonder `stop` → `duurMinuten`), `zichtbareDagen` (vijf werkdagen; tablet-staand 3 dagen met negatieve en positieve offset; vandaag geen werkdag), `maandRaster` (start op maandag, 42 stuks, oktober 2026 start 28 sep), `autoScrollSleutel`.
- [ ] **Step 7: Differentiële vergelijking (eenmalig, niet committen).** Haal in de scratchpad de oude teksten van `capacityForDay`, `nextAvailableDay` en de sorteerblokken uit `git show HEAD:public/index.html` en laat ze naast de nieuwe functies lopen op ≥ 300 willekeurige invoeren (instellingen, blokkades per soort en persoon, planning, feestdagen, `nu`). Resultaat moet identiek zijn. Noteer "differentieel: N invoeren, 0 verschillen" in de commitbody.
- [ ] **Step 8: Brug en `index.html`.** `brug.js`: `window.kern.capaciteit = { ...capaciteit }`. In `index.html`: `initCapaciteit({ duurVoor, getHolidayName })` in `DOMContentLoaded` (vóór `settings`); `capacityForDay` en `nextAvailableDay` worden eenregelige wrappers rond `kern.capaciteit.*`; de oude `urgencyFactor`/`queueScore`/`isOverdue`/`wqNorm`/`wqZoekTekst`/`PRIO_WEIGHT` en `maakActiveerbaar` verdwijnen en hun gebruikers (nog in `renderTickets`, `buildTicketCard`, `renderKalender`, `renderGepland`) roepen `kern.*` aan (`kern.ui.maakActiveerbaar`); de zes `avExceptions`-filters in `renderDayTimeline`, `renderKalender` en `renderMonthView` gaan naar `kern.selecties.blokkeringenVoor`. `removeTicketFromAllDays` weg. `autoPlan` blijft ongemoeid (C11).
- [ ] **Step 9: `sw.js`**: de drie schermbestanden in `SHELL`.
- [ ] **Step 10: Run.** `node --test` (500 + nieuwe), `npx playwright test` (Taak 1 ongewijzigd groen; `kern.spec` getallen gelijk). `grep -nE "^(let|const|var) .*(PRIO_WEIGHT|wqNorm)" public/index.html` leeg.
- [ ] **Step 11: Commit** `refactor(kalender): pure laag — capaciteit, wachtrij-logica en kalender-logica (etappe 4)`.

---

### Task 3: `wachtrij.js` — lijst, zoeken, sorteren en snelinplannen

**Aanbevolen model:** sonnet (state uit globals halen, delegatie, teller)

**Feasibility:** `renderTickets`, zoeken, sorteren, de `+`-knop en de bubbel-guard zijn volledig in `?test` bereikbaar en gedekt door Taak 1 (Step 1). `quickAdd` roept `afh.addTicketToDate` ongewijzigd aan (testmodus-tak, geen `/api/plan`). `inFlight` is niet waarneembaar (de testmodus-tak is synchroon): enkel de accessor verhuist (C18a).

**Files:**
- Maak: `public/js/schermen/wachtrij.js`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`, `e2e/kern.spec.mjs`

- [ ] **Step 1: Inventaris.** Lezers/schrijvers van `wqZoek`, `wqSorteer`, `WQ_SORTEER_OPTIES`, `renderTickets` (kale oproepen: `addTicketToDate`/`removeTicketFromDate`-paden, `reconcilePlanning`, instellingen opslaan, `saveToewijzen`, `verstuurAnnulatie`, `sendProposal`, `koppelRenders`), `quickAdd` (inline `onclick` in `renderTickets`).
- [ ] **Step 2: `initWachtrij(afh)`.** `afh` zoals Interfaces. Verhuist: het lezen van `blitz_wachtrij_sorteer`, de `wqKoppel`-luisteraars (`input` met debounce 150 ms, `change`), `sel.value = wqSorteer`; registreert `registreerActies(document.body, { 'wq-inplannen': el => quickAdd(el.dataset.ticketId) })`. Geen `settings` lezen (C6).
- [ ] **Step 3: Verhuis** `renderTickets` (met `sjLog` via `afh`, de logica uit `wachtrij-logica.js`, `kern.ui.maakActiveerbaar`, `kern.selecties.ticketsVanTechnieker`) en `quickAdd` (`kern.capaciteit.nextAvailableDay`, `afh.addTicketToDate`, `kern.tijd.fmtDateShort`, `toast`). De `+`-knop: `data-actie="wq-inplannen" data-ticket-id="…"` (`escHtml`), `disabled` volgens `afh.inFlight`; de kaartluisteraar begint met de bubbel-guard (C8). De rendertelling `renderTelling()`.
- [ ] **Step 4: Brug en `index.html`.** `window.kern.wachtrij`; LEGACY `renderTickets`. `koppelRenders`: `() => kern.wachtrij.renderTickets()`. `togglePlanFromDetail` (4304): `kern.capaciteit.nextAvailableDay(…)`; de `nextAvailableDay`-wrapper uit Taak 2 verdwijnt. `initWachtrij({...})` aan het begin van `DOMContentLoaded`. Verwijder de verhuisde `let`'s/functies en de IIFE uit `index.html` (K3-grep: `^(let|const|var) .*wq`). Raak `addTicketToDate` niet aan.
- [ ] **Step 5: `e2e/kern.spec.mjs`.** `renderTickets` uit `WINDOW_RENDERS`; de teller komt uit `kern.wachtrij.renderTelling()` (in `tellers()`); idem in de "onbekende technieker"-test (telt nu vanaf het laden; vergelijking blijft differentieel). Alle getallen ongewijzigd.
- [ ] **Step 6: `sw.js`**: `/js/schermen/wachtrij.js` in `SHELL`.
- [ ] **Step 7: Run.** `node --test`, `npx playwright test` (Taak-1-tests voor de wachtrij ongewijzigd groen, bubbel-guard: geen detail na `+`).
- [ ] **Step 8: Commit** `refactor(wachtrij): wachtrij.js — lijst, zoeken, sorteren en snelinplannen (etappe 4)`. De body noemt: `addTicketToDate` ongewijzigd (C11) en `inFlight` niet waarneembaar (C18a).

---

### Task 4: `kalender.js` deel 1 — stateloze bladeren (kaartjes, tijdlijn, nu-lijn, hoogte)

**Aanbevolen model:** sonnet (veel DOM-code verplaatsen met behoud van gedrag; init-effecten van het hoogste niveau)

**Feasibility:** `buildTicketCard`/`buildReportCard`/`buildLocalEventCard`, `renderDayTimeline`, `renderTimelineGutter`, de nu-lijn, het hoogte-meten en de `✕`-delegatie zijn waarneembaar via Taak 1 (Step 2.4, 2.6; Step 3.1 voor de lijstweergave). De minuuttimer en de `ResizeObserver`-reactie zelf zijn niet te triggeren (C18c); de hoogte na render is wel meetbaar. Bewust nog klassiek in deze taak: `renderKalender`, `renderMonthView`, `kalAutoScroll`, de state en de navigatie (Taak 5).

**Files:**
- Maak: `public/js/schermen/kalender.js`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`

- [ ] **Step 1: Inventaris.** Welke verhuisde functies lezen state? Verwacht: geen (`kalOffset`/`kalView` zitten in `renderKalender`, `kalAutoScroll`, `renderMonthView`, `kalNav`). `renderMonthView` blijft in Taak 4 klassiek en bouwt zijn raster uit `kalender-logica.js` (`maandRaster(ref)`) met de bestaande `kalOffset`.
- [ ] **Step 2: `initKalender(afh)`.** Registreert de `data-actie` `kal-uitplannen` (`el.dataset.ticketId`/`datum` → `afh.bevestigUitplannen`) en verhuist de hoogste-niveau-effecten (C7): `kalStartHoogteObserver()`, de `resize`-luisteraar (debounce 100 ms), de `visibilitychange`-luisteraar van de nu-lijn. `afh` zoals Interfaces; `window.apparaat` en `document` blijven globals. `initKalender` draait vóór `koppelRenders`.
- [ ] **Step 3: Verhuis** (letterlijk, met commentaar): de drie `build*Card` (de `✕`-knop wordt `data-actie="kal-uitplannen" data-ticket-id data-datum`; elke kaartluisteraar krijgt de bubbel-guard van C8), `appendOffhoursBands`, `renderTimelineGutter`, `computeTimelineRange`, `renderDayTimeline` (het `positioned`-blok wordt `bouwTijdlijnItems` + `bepaalLanes` uit `kalender-logica.js`; de `zonderUur`-chips en lanen-stijlen identiek), `kalPasGridHoogteAan`, `updateNuMarker`, `updateNuLijn`, `startNuLijnTimer`. Exports voor de klassieke `renderKalender` zolang die nog in `index.html` staat: `renderDayTimeline`, `renderTimelineGutter`, `build*Card`, `kalPasGridHoogteAan`, `updateNuLijn`, `startNuLijnTimer`. `TIMELINE_PX_PER_MIN` en `WERKUUR_*` komen uit `kalender-logica.js`.
- [ ] **Step 4: Brug en `index.html`.** `window.kern.kalender = { ...kalender }` (de pure logica importeert `kalender.js` rechtstreeks, die hoeft niet op `window.kern`). `renderKalender` (nog klassiek) roept `kern.kalender.*` aan; verwijder de verhuisde functies, `const TIMELINE_*`/`WERKUUR_*`, `_kalRO`, `_kalROFrame`, `_kalResizeTimer`, `_nuLijnTimer` en de drie hoogste-niveau-oproepen uit `index.html`. `initKalender({...})` aan het begin van `DOMContentLoaded`. `_kalAutoScrollKey` blijft klassiek tot Taak 5.
- [ ] **Step 5: `sw.js`**: `/js/schermen/kalender.js` in `SHELL`.
- [ ] **Step 6: Run.** `node --test`, `npx playwright test`: kalenderspecs (tijdlijn, lanen, chips, nu-lijn, hoogte, `✕`, gsm-lijst) ongewijzigd groen; geen consolefouten. `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` leeg.
- [ ] **Step 7: Commit** `refactor(kalender): kalender.js — kaartjes, tijdlijn, nu-lijn en hoogte verhuisd (etappe 4)`. De body noemt het niet-triggerbare timer-/observerpad (C18c).

---

### Task 5: `kalender.js` deel 2 — toestand, `renderKalender`, navigatie en delegatie

**Aanbevolen model:** sonnet (grootste verhuizing; state uit globals, abonnement, `autoPlan`-token)

**Feasibility:** week, maand, tablet-dag, gsm-lijst, navigatie, "zonder datum"-paneel, capaciteitskop, weergavewissel, de blokknop en "Route berekenen" zijn allemaal in `?test` bereikbaar en door Taak 1 gedekt. De `autoPlan`-koppeling is bereikbaar (`plan-week.spec`, Taak 1 Step 2.9). De Zoho-gebonden functies erachter worden niet geraakt (C11). Niet bereikbaar: C18.

**Files:**
- Wijzig: `public/js/schermen/kalender.js`, `public/js/kern/brug.js`, `public/index.html`, `e2e/kern.spec.mjs`

- [ ] **Step 1: Inventaris.** Alle lezers/schrijvers van `kalOffset`, `kalDagOffset`, `kalView`, `_kalAutoScrollKey`, `renderKalender`, `kalAutoScroll`, `setKalView`, `kalNav`, `kalToday`, `togglePendingPanel`, `onBlockBtnClick`. Verwacht buiten het blok: `autoPlan` (`kalOffset`), `setTab` (`renderKalender()` en `kalAutoScroll(true)`), de `apparaatwijziging`-handler en `koppelRenders`, twee oude commentaarregels.
- [ ] **Step 2: State en export.** Module-privé `kalOffset`, `kalDagOffset`, `kalView`, `_kalAutoScrollKey`, rendertelling. Exports: `renderKalender`, `renderTelling`, `weekOffset()` (geeft `kalOffset` ongewijzigd terug, C13), `activeerKalender()` (= `renderKalender(); kalAutoScroll(true)`), `togglePendingPanel`, `setKalView`, `kalNav`, `kalToday`.
- [ ] **Step 3: Verhuis** (letterlijk): `setKalView`, `kalZetVandaagKnop`, `kalZetLabel`, `kalAutoScroll` (met `autoScrollSleutel`), `kalNav`, `kalToday`, `renderMonthView(today)` (leest de eigen `kalOffset`, raster uit `maandRaster`), `renderKalender` (week + maand-vertakking, "zonder datum"-kaartjes, de dagkolom met `capaciteitsKop` uit `kern.capaciteit`, de `blokkeringenVoor`-oproepen uit Taak 2, `rb.onclick`-"Route berekenen": `document.getElementById('plan-date').value = dateStr; afh.setTab('planning'); renderRouteList(dateStr)` met `renderRouteList` uit `./route.js`), `togglePendingPanel`. `sjLog` via `afh`.
- [ ] **Step 4: Delegatie (C8).** Statische knoppen in `index.html`: `#kal-view-week`/`#kal-view-month` → `data-actie="kal-weergave" data-arg="week|month"`, `#kal-pending-pill` → `data-actie="kal-pending"`; in de gerenderde kolom `.day-block-btn` → `data-actie="kal-blok"` (`data-date` bestaat al); in het "zonder datum"-kaartje de drie knoppen → `kal-toewijzen-open|opslaan|sluit` met `data-ticket-id`. `initKalender` registreert ze en nu ook `kal-nav` en `kal-vandaag`; **verwijder** die twee uit de `registreerActies` in `index.html` en controleer met grep dat geen naam dubbel staat. De kaartluisteraars van het paneel krijgen de bubbel-guard. Raak de ids, `disabled`, titels en teksten niet aan; `autoPlan`, Import en `➕ Afspraak` blijven inline (andere schermen).
- [ ] **Step 5: `index.html` oproepplaatsen.** `autoPlan`: `getWeekStart(today, kern.kalender.weekOffset())` (enige wijziging in die functie, C13). `setTab`: `kern.kalender.activeerKalender()` in de `setTimeout` voor `kalender`. `apparaatwijziging`-handler en `koppelRenders`: `kern.kalender.renderKalender()`. LEGACY `renderKalender` in de brug. Verwijder de verhuisde functies, `let kalOffset, kalDagOffset, kalView`, `_kalAutoScrollKey` en de oude commentaarregels (C20). K3-grep: `^(let|const|var) .*(kalOffset|kalDagOffset|kalView|_kalAutoScrollKey)` leeg.
- [ ] **Step 6: `e2e/kern.spec.mjs`.** `renderKalender` uit `WINDOW_RENDERS`; teller uit `kern.kalender.renderTelling()`. Alle getallen ongewijzigd.
- [ ] **Step 7: Controle Zoho-diff.** `git diff` van `addTicketToDate`, `removeTicketFromDate`, `bevestigUitplannen`, `saveToewijzen`, `autoPlan` (enkel de `weekOffset`-token): noteer het resultaat in de commitbody.
- [ ] **Step 8: Run.** `node --test`, `npx playwright test`: alle Taak-1-tests (week, maand, tablet-dag, gsm, capaciteitskop, paneel, weergavewissel, plan-deze-week-per-week) groen; `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` leeg; `grep -rn "'kal-nav'" public/` toont één registratie.
- [ ] **Step 9: Commit** `refactor(kalender): kalender.js — toestand, renderKalender en navigatie verhuisd (etappe 4)`.

---

### Task 6: `ingepland.js` — Ingepland-tab en opruiming

**Aanbevolen model:** sonnet (kleine verhuizing, maar tellers en delegatie; daarna de audits)

**Feasibility:** `renderGepland`, `gepNav` en de badge zijn bereikbaar en gedekt (`kalender.spec.mjs`, Taak 1 Step 4); de teller volgt uit `kern.spec` (technieker wisselen en Vernieuwen: `renderGepland: 1`).

**Files:**
- Maak: `public/js/schermen/ingepland.js`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`, `e2e/kern.spec.mjs`

- [ ] **Step 1: Inventaris.** Lezers van `gepOffset`, `renderGepland` (kale oproepen: `removeTicketFromDate` foutpad, `verstuurAnnulatie`; `setTab` met `setTimeout`), de twee inline `gepNav`-knoppen (171–173).
- [ ] **Step 2: `ingepland.js`.** `initIngepland(afh)` registreert `gep-nav` (`data-arg` ±1 → `gepOffset += dir; renderGepland()`); verhuist `renderGepland` (tijdregel via `afh.tijdslotLabelVoor`, `afh.contactActiesHtml`, `afh.koppelAdresNavigatie`, `kern.ui.maakActiveerbaar`, bubbel-guard op de kaartluisteraar, badge `#cnt-gepland`, `sjLog` via `afh`) en `renderTelling`; `gepOffset` is module-privé.
- [ ] **Step 3: `index.html` en brug.** Statische knoppen `onclick="gepNav(±1)"` → `data-actie="gep-nav" data-arg="-1|1"`; `window.kern.ingepland`; LEGACY `renderGepland`; `koppelRenders` en `setTab` (`kern.ingepland.renderGepland()`); verwijder `gepOffset`, `renderGepland`, `gepNav`, het kopje "GEPLAND TAB" en de `let gepOffset`.
- [ ] **Step 4: `e2e/kern.spec.mjs`.** `WINDOW_RENDERS` en de omwikkeling verdwijnen helemaal; `RENDERS` leest alle vier de tellers uit de modules. Getallen ongewijzigd.
- [ ] **Step 5: Audits (resultaat in de ledger).**
  - `grep -nE "^(let|const|var) .*(kalOffset|kalDagOffset|kalView|gepOffset|wqZoek|wqSorteer|_kalAutoScrollKey|inFlightTickets)" public/index.html` → enkel `inFlightTickets`.
  - `grep -nE "function (renderTickets|renderKalender|renderGepland|quickAdd|setKalView|gepNav|kalNav|kalToday|kalAutoScroll|capacityForDay|nextAvailableDay|maakActiveerbaar|removeTicketFromAllDays|togglePendingPanel|onBlockBtnClick|buildTicketCard|renderDayTimeline|renderMonthView)" public/index.html` → leeg.
  - `grep -nE "onclick=\"(quickAdd|setKalView|gepNav|bevestigUitplannen)" public/index.html` → leeg (de `bevestigUitplannen`-oproepen in andere schermen zijn `afh`/route).
  - `grep -n "window\.[A-Za-z_]* *=" public/js/schermen/*.js` → leeg.
  - `git diff` van de vijf Zoho-functies (C11): enkel regelverschuivingen plus de `weekOffset`-token.
  - `public/sw.js`: `SHELL` bevat de zes nieuwe bestanden; `CACHE_NAME` ongewijzigd (`blitz-planning-v25`).
- [ ] **Step 6: Run.** `node --test`, `npx playwright test` groen; noteer de aantallen in de ledger.
- [ ] **Step 7: Commit** `refactor(ingepland): ingepland.js — Ingepland-tab verhuisd, opruiming (etappe 4)`.

---

### Task 7: Afronding — docs en eindcontrole

**Aanbevolen model:** haiku (mechanisch; commando's en verwachte uitkomsten staan hieronder; geen code schrijven; bij mislukken één tier hoger = sonnet)

**Feasibility:** enkel grep-, diff- en testcommando's plus tekst; geen nieuwe paden.

**Files:** Wijzig: `CHANGELOG.md`, `CLAUDE.md`, `public/sw.js` (alleen als de controle iets mist)

- [ ] **Step 1: `public/sw.js` controle.** `grep -o "'/js/schermen/[a-z-]*\.js'" public/sw.js`: precies `route-tijden`, `route-kaart`, `route`, `capaciteit`, `wachtrij-logica`, `kalender-logica`, `wachtrij`, `kalender`, `ingepland`. Voeg een ontbrekende toe; `CACHE_NAME` blijft `blitz-planning-v25`, geen versie- of tag-wijziging.
- [ ] **Step 2: `CHANGELOG.md`** onder "Refactor-tak — nog niet uitgebracht", **Changed**, in gewone taal: "Kalender, wachtrij en de lijst Ingepland zijn intern herbouwd en staan nu in eigen onderdelen; voor jou ziet alles er hetzelfde uit en werkt het hetzelfde." Plus een **Fixed**-regel voor elke bug die in de ledger staat (met test); staat er geen, dan geen regel. Noem de bekende eigenaardigheid van "Plan deze week" in maand- en dagweergave **niet** als fix (nog niet beslist).
- [ ] **Step 3: `CLAUDE.md`**, sectie "Schermen (`public/js/schermen/`)": voeg **Etappe 4 (Kalender en wachtrij)** toe: de zes bestanden en hun rol (puur: `capaciteit`, `wachtrij-logica`, `kalender-logica` met unit-tests; DOM: `kalender`, `wachtrij`, `ingepland`); `initKalender/Wachtrij/Ingepland/Capaciteit(afh)` in `DOMContentLoaded` vóór `koppelRenders`; private toestand per module; `kern.kalender|wachtrij|ingepland|capaciteit.renderTelling()` voor de e2e-tellers; knoppen via `data-actie` met de **bubbel-guard** (`if (e.target.closest('[data-actie]')) return;` in elke kaartluisteraar); `quickAdd` en de capaciteitskop blijven op het aantalmodel (niet op het brein, spec C3); `kern.selecties.blokkeringenVoor` en `kern.ui.maakActiveerbaar`. Werk de regel "Resterende LEGACY-BRUG-namen" bij met `renderTickets`, `renderKalender`, `renderGepland` (verdwijnen in etappe 5). Werk in "Tests" de aantallen bij (unit en e2e).
- [ ] **Step 4: Run.** `node --test` en `npx playwright test` groen; noteer de aantallen in de ledger. De controller doet daarna een visuele steekproef in de ingebouwde browser (computer, tablet staand, gsm; kalender week en maand, wachtrij, ingepland) en de etappe-eindreview (sonnet, Review Focus 1–7).
- [ ] **Step 5: Commit** `docs(kalender): changelog en conventies voor etappe 4`.

---

## Na de taken

Etappe-eindreview (sonnet, C19) met het volledige diff-pakket van `index.html` en de zes modules, gericht op de zeven punten van de Review Focus. Daarna `git merge main` vanuit de refactor-worktree (branchbeleid) en een volledige testrun. Restpunten voor etappe 5/7 in de ledger: de LEGACY-namen `renderTickets`/`renderKalender`/`renderGepland` en `window.maakSorteerbaar`; het afbreken van een sleepactie door een achtergrondrender in de route-lijst (C14, etappe 7); de keuze van Brent over "Plan deze week" in maand- en dagweergave (C13); het verschil in eindtijd van een eigen afspraak zonder einduur tussen kalender (`tijdslotMinuten / 3`) en route/brein (`60`) (C3d); specs met kale `planning`/`localEvents` (etappe 5).
