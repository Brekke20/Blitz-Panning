# Etappe 0 — Vangnet (Playwright e2e) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een deterministische Playwright-testrobot die de kernhandelingen van de huidige app vastlegt, zodat etappes 2–7 veilig kunnen herstructureren.

**Architecture:**
- Config `playwright.config.mjs` + eigen statische server `e2e/statische-server.mjs` (poort 3338, enkel `public/`).
- Elke test start met `startApp()`: vaste klok, localStorage-rol, alle `/api/*` gestubd, `/?test` geladen.
- `afterEach` faalt bij onverwachte of verboden verzoeken en bij consolefouten.

**Tech Stack:** `@playwright/test` (devDependency, Chromium), Node 24 ES-modules, de bestaande app (`public/index.html`, `?test`).

**Spec:** `docs/superpowers/specs/2026-10-01-etappe0-vangnet-design.md`. Lees §2 (rulings E1–E15) en §4 (eindpunten) vóór Taak 1.

## Global Constraints

- Werk in de worktree `.claude/worktrees/planner-brein` (tak `refactor`). Prefix elke shell-opdracht met `cd "<worktree>" &&` en controleer vóór elke commit `git branch --show-current` = `refactor`. Nooit committen in de main-checkout. Niet pushen.
- De app verandert **niet**. Enige toegestane wijziging in `public/`: onzichtbare `data-testid`-attributen, en een bugfix voor consolefouten (Taak 1, alleen als de oorzaak triviaal is; vermeld in de commit).
- Nooit echte Zoho-, TomTom- of mail-aanroepen. Alle `/api/*` wordt gestubd (E4). Geen `.env.local` nodig.
- Rapportwizard en Zoho-paden: alleen UI aansturen, nooit versturen (W11, E12).
- Tests: `npx playwright test` voor e2e; `node --test` (zonder pad `tests/`) blijft ongewijzigd groen (136 tests).
- Bestandsnamen in `e2e/`: nooit beginnend met `test-` of eindigend op `.test.mjs` (anders pikt `node --test` ze op). Specs: `*.spec.mjs`.
- Geen `waitForTimeout`, geen screenshots, geen visuele snapshots (E10). Wacht op zichtbare toestand.
- Eén dev-/testserver-proces: stop alleen je eigen PID, nooit alle node-processen. Playwright's `webServer` ruimt zijn eigen server op.
- Namen en commentaar in het Nederlands, zoals de bestaande code.
- Commit-trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Versie, `CHANGELOG`, `CACHE_NAME` en tag horen **niet** bij deze taken.
- Modelkeuze per taak staat bij de taak (W12). Brief en diff als bestand naar de subagent, korte terugmelding (max. 15 regels).

## Review Focus

1. **Geen enkel pad naar buiten**: de catch-all (599) staat vóór alle andere routes opgesteld en elke test faalt bij een niet-gestubd eindpunt. Controleer dat `afterEach` ook echt in elk spec-bestand geldt (via fixture, niet via copy-paste).
2. **Determinisme**: klok en tijdzone staan vast; geen test hangt af van echte datum, volgorde van andere tests of echte timers.
3. **Echt vangnet**: elke test asserteert gedrag (tekst, aantal, payload), geen "pagina laadt". Taak 7 bewijst dit met sabotage.
4. **Voorstel en rapport worden nooit verstuurd**: de verboden-verzoeken-controle uit E12 is actief in alle specs.
5. **`node --test` blijft onaangetast** en de allowlist voor consolefouten bevat alleen precieze, uitgelegde patronen.

---

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `package.json` / `package-lock.json` | devDependency `@playwright/test`, script `test:e2e` |
| `playwright.config.mjs` (nieuw) | Chromium, tijdzone, locale, SW geblokkeerd, `webServer` |
| `e2e/statische-server.mjs` (nieuw) | statische server voor `public/` op poort 3338 |
| `e2e/helpers.mjs` (nieuw) | `startApp`, `stubExtern`, `verzamelVerzoeken`, `test` (fixture met `afterEach`-controles), `VASTE_NU` |
| `e2e/fixtures/*.json` (nieuw) | antwoorden van matrix, route, optimize, drukte, planning-sinds |
| `e2e/*.spec.mjs` (nieuw) | zie taken |
| `public/index.html` | enkel `data-testid` waar nodig (en eventueel één bugfix, Taak 1) |
| `.gitignore` | `test-results/`, `playwright-report/` |

## Interfaces (eindtoestand, gedeeld door alle taken)

```js
// e2e/helpers.mjs
export const VASTE_NU = '2026-10-05T09:00:00+02:00';           // maandag, Europe/Brussels

export async function startApp(page, { rol = 'coordinator', technieker = 'all', viewport } = {}) -> Promise<void>
//   addInitScript (localStorage: blitz_rol, blitz_active_person, blitz_theme), clock.install(VASTE_NU),
//   stubExtern(page), goto('/?test'), wacht tot #cnt-tickets de verwachte telling toont

export async function stubExtern(page, { overschrijf = {} } = {}) -> Promise<Verzoeken>
//   page.route('**/api/**') catch-all (599) + stubs per eindpunt (spec §4); `overschrijf` laat een test
//   één eindpunt vervangen: { matrix: (verzoek) => ({ status, json }) }

export function verzamelVerzoeken(page) -> Verzoeken
//   Verzoeken = {
//     alle: [{ methode, pad, body /* geparsed JSON | null */ }],
//     van(pad, methode?) -> [...],          // bv. van('/api/matrix')
//     onverwacht: [pad],                    // door de catch-all afgehandeld
//     verboden: [pad]                       // propose, annuleer, send-rapport, rapport, rapport-verzonden, plan, plan-datum, comment
//   }

export const VERBODEN_PADEN = [...]                              // lijst voor `verboden`
export const TOEGESTANE_CONSOLERUIS = [{ patroon: RegExp, reden: string }]   // precies, leeg als kan
export const test                                                // base.extend: elke test krijgt `verzoeken` + automatische afterEach-controle
export { expect }                                                // doorgegeven uit @playwright/test

// e2e/fixtures/
//   matrix.json, route.json, optimize.json, drukte.json, planning-sinds.json   (vormen overgenomen uit netlify/functions/*.js en de aanroepers)

// DUMMY_DATA (public/index.html:660), voor asserties:
//   te plannen: #1001 (Tim, hoog, Geel), #1002 (Tim, middel, Hasselt), #1003 (Roel, laag, geen adres)
//   wachtend:   #1004 (Tim, Beringen), #1005 (Tim, Mechelen)
//   gepland:    #1006 (Tim, Antwerpen)
```

---

### Task 1: Setup, config, helpers en rooktest

**Aanbevolen model:** sonnet (vormen van de antwoorden uitzoeken, onderzoek naar de consoleruis)

**Files:**
- Wijzig: `package.json`, `package-lock.json`, `.gitignore`
- Maak: `playwright.config.mjs`, `e2e/statische-server.mjs`, `e2e/helpers.mjs`, `e2e/fixtures/*.json`, `e2e/rooktest.spec.mjs`
- Mogelijk wijzig: `public/index.html` (bugfix, zie stap 7)

**Interfaces:** levert alles uit "Interfaces" hierboven.

- [ ] **Step 1: Dependency installeren.**
  - `npm install --save-dev @playwright/test`, daarna `npx playwright install chromium`.
  - Voeg `"test:e2e": "playwright test"` toe aan `scripts` in `package.json` (er is nu nog geen `scripts`-blok).
  - `.gitignore`: `test-results/` en `playwright-report/`.
  - Controle: `node --test` geeft nog steeds `tests 136 / pass 136`.
- [ ] **Step 2: `e2e/statische-server.mjs`.** Node `http` zonder dependencies; serveert `public/` met de MIME-types uit `dev-server.mjs` (plus `.mjs`, `.webmanifest` indien nodig); `/` → `index.html`; onbekend pad → 404 (geen SPA-fallback, zodat een fout pad opvalt); `/api/*` → 599 met JSON `{ error: 'niet gestubd' }` (tweede slot naast de catch-all). Poort 3338.
- [ ] **Step 3: `playwright.config.mjs`.** `testDir: 'e2e'`, `testMatch: '*.spec.mjs'`, `timeout: 30000`, `use: { baseURL: 'http://localhost:3338', timezoneId: 'Europe/Brussels', locale: 'nl-BE', serviceWorkers: 'block', trace: 'retain-on-failure' }`, project `chromium` (Desktop Chrome), `webServer: { command: 'node e2e/statische-server.mjs', port: 3338, reuseExistingServer: false }`, `retries: process.env.CI ? 1 : 0`, `reporter: 'list'`.
- [ ] **Step 4: Antwoordvormen uitzoeken.** Lees `netlify/functions/{matrix,route,optimize,drukte,planning-sinds,afspraken,availability,klantbeschikbaarheid,voorstel-status,rapport-archief}.js` en de aanroepers in `public/index.html` (zoek op `/api/matrix` rond regel 3787, `/api/drukte` rond 4878, `/api/planning-sinds` rond 1234, `AFG_API`, `AV_API`, `KB_API`) en `public/js/rapport-wizard.js:163`. Schrijf fixtures met exact de velden die de aanroepers lezen (reistijd 20 min tussen elk paar; route met stops in invoervolgorde; leeg drukte-antwoord; planning-sinds met vaste ISO-datums voor `t1`–`t3`).
- [ ] **Step 5: `e2e/helpers.mjs`** volgens "Interfaces". Details:
  - `stubExtern` registreert **eerst** de catch-all (`page.route('**/api/**')` die `onverwacht` bijwerkt en 599 geeft) en daarna de specifieke routes (Playwright kiest de laatst geregistreerde passende route).
  - Opslag-eindpunten stateful: GET geeft de laatst gePOST/PUT toestand terug met het versieveld dat de echte functie ook teruggeeft; zonder POST een lege lijst.
  - Schrijf- en mail-eindpunten: `{ ok: true }` en registratie in `alle`.
  - `test` = `base.extend` met auto-fixture: verzamelt console-fouten (`console.error`, `pageerror`, `requestfailed`, responses ≥ 400 behalve de eigen 599) minus `TOEGESTANE_CONSOLERUIS`, en faalt na de test als `onverwacht`, `verboden` of console-fouten niet leeg zijn. Tests die bewust een verboden pad verwachten bestaan niet.
- [ ] **Step 6: `e2e/rooktest.spec.mjs`, test `app laadt als coördinator zonder consolefouten`.** `startApp(page)`; asserties: `#cnt-tickets` heeft tekst `3`; `#test-badge` zichtbaar; knop `⚡ Plan deze week` zichtbaar; `#tab-planning` zichtbaar; `verzoeken.onverwacht` is `[]` (dat doet ook de auto-controle).
- [ ] **Step 7: Consoleruis onderzoeken.**
  - Draai de rooktest eerst met `serviceWorkers: 'block'` en lege allowlist. Verwacht dat de ×2–3 "An unknown error occurred when fetching the script" weg is (SW-registratie, `index.html:1002`).
  - Blijft er een 400 over: zoek met `read_network_requests`/`page.on('response')` welk eindpunt of bestand het is.
  - Triviale oorzaak in de app (bv. een ontbrekend bestand of een verkeerd verzoek): oplossen als bugfix, in de commit en in een notitie voor de CHANGELOG-sectie van de refactor-tak vermelden. Anders: precies patroon in `TOEGESTANE_CONSOLERUIS` met `reden`.
- [ ] **Step 8: Run.** `npx playwright test` → verwacht `1 passed`. `node --test` → `tests 136 / pass 136`.
- [ ] **Step 9: Commit** `test(e2e): Playwright-opzet, helpers met nep-backend en rooktest (etappe 0)`. Noem de ruisbeslissing in de body.

---

### Task 2: Laden, rol, technieker kiezen en ticketdetail

**Aanbevolen model:** sonnet (locators uitzoeken in `index.html`, `data-testid` waar nodig)

**Files:**
- Maak: `e2e/laden-en-rol.spec.mjs`, `e2e/ticketdetail.spec.mjs`
- Mogelijk wijzig: `public/index.html` (`data-testid`)

**Interfaces:** gebruikt `startApp`, `test`, `expect`, `verzoeken`.

- [ ] **Step 1: `laden-en-rol.spec.mjs`** met deze tests (`test.describe('laden en rol')`):
  - `coördinator ziet alle tabs`: `startApp(page, { rol: 'coordinator' })`; tabs Wachtrij, Kalender, Route, Ingepland, Inventaris, Rapporten zichtbaar; `html[data-rol="coordinator"]`.
  - `technieker ziet geen coördinator-tabs`: `rol: 'technieker', technieker: 'Tim'`; Wachtrij, Route en Rapporten niet zichtbaar, Kalender en Ingepland wel; geen knop `⚡ Plan deze week`; `html[data-rol="technieker"]`.
  - `technieker kiezen filtert de wachtrij`: als coördinator; open `#person-btn`, kies `Tim` → `#person-name-hdr` toont `Tim`; ticket #1003 (Roel) niet in de wachtrij, #1001 en #1002 wel; kies daarna `Alle` → #1003 weer zichtbaar. Kies de tekst van de menu-items zoals ze in de DOM staan (`togglePersonMenu`).
  - `tablet vraagt eenmalig de rol`: viewport 820×1180, `hasTouch`, geen `blitz_rol` in localStorage; dialoog "Wie gebruikt deze tablet?" zichtbaar; klik `Technieker` → `html[data-rol="technieker"]` en `localStorage.blitz_rol === 'technieker'`. (Vereist `startApp` met `viewport` en `hasTouch`; breid de context-opties uit zonder de helper-signatuur te breken.)
- [ ] **Step 2: `ticketdetail.spec.mjs`** (`test.describe('ticketdetail')`):
  - `ticket openen toont gegevens en sinds-datum`: klik ticket #1001 → detailvenster toont `Laadpaal offline na stroomuitval`, `Antwerpseweg 50, 2440 Geel`, en een regel "In planning sinds" met de waarde uit de stub (`planning-sinds.json`, tekst zoals `index.html` ze opmaakt: lees de renderfunctie rond de `laadPlanningSinds`-uitkomst en assert de echte string); `verzoeken.van('/api/planning-sinds')` heeft precies één POST met `body.opzoeken` of `body.actief` dat `t1` bevat.
  - `detailvenster sluit`: sluitknop of Escape → venster niet meer zichtbaar.
- [ ] **Step 3: Run.** `npx playwright test e2e/laden-en-rol.spec.mjs e2e/ticketdetail.spec.mjs` → verwacht `6 passed`. Daarna de hele suite: `npx playwright test` → alles groen.
- [ ] **Step 4: Commit** `test(e2e): laden, rol, technieker kiezen en ticketdetail`.

---

### Task 3: "Plan deze week" en resultaatvenster

**Aanbevolen model:** sonnet (brein-uitkomst bepalen en vastleggen)

**Files:**
- Maak: `e2e/plan-week.spec.mjs`
- Mogelijk wijzig: `public/index.html` (`data-testid` op resultaatrijen)

**Interfaces:** gebruikt `stubExtern`'s `overschrijf` voor matrix.

- [ ] **Step 1: Voorbereiding.** Draai de stap eerst handmatig (`startApp` als coördinator met technieker `Tim`, klik `#btn-autoplan`) en noteer de werkelijke uitkomst bij de vaste klok en de matrixstub (20 min): welke tickets krijgen welke dag, welke staan bij "Niet ingepland" met welke reden. Dat is het vastgelegde HUIDIGE gedrag; leg het vast, niet wat je verwacht.
- [ ] **Step 2: Tests** (`test.describe('plan deze week')`):
  - `plant de tickets van de gekozen technieker`: technieker `Tim`, klik `⚡ Plan deze week`; resultaatvenster (`#result-body`) toont `Ingepland (n)` met het in stap 1 gemeten aantal, en per ticket `#1001`/`#1002` + dagtekst; `Niet ingepland` volgens meting; `verzoeken.van('/api/matrix')` bevat minstens één POST.
  - `Iedereen geeft een toast en plant niets`: filter `Alle`; klik de knop → toast `Kies eerst een technieker` zichtbaar; `#result-body` niet zichtbaar; `verzoeken.van('/api/matrix')` is leeg.
  - `resultaat toont de reden bij tickets die niet passen`: `overschrijf.matrix` geeft overal 90 min terug (boven `maxReistijdMin` 45); resultaat toont `Te ver van de andere afspraken (meer dan 45 min)` bij het ticket dat daardoor afvalt. Lees eerst welk ticket dat bij de meting wordt.
  - `matrix valt uit: waarschuwing`: `overschrijf.matrix` geeft status 500; resultaat toont `Reistijd kon niet gecontroleerd worden` en het plannen crasht niet.
- [ ] **Step 3: Run.** `npx playwright test e2e/plan-week.spec.mjs` → `4 passed`; hele suite groen.
- [ ] **Step 4: Commit** `test(e2e): Plan deze week, resultaatvenster en reden-teksten`.

---

### Task 4: Route berekenen, slepen en tijden vastleggen

**Aanbevolen model:** sonnet (slepen en route-DOM vragen beoordeling)

**Files:**
- Maak: `e2e/route.spec.mjs`
- Mogelijk wijzig: `public/index.html` (`data-testid` op stops en dagknoppen)

**Interfaces:** gebruikt de route- en optimize-fixtures.

- [ ] **Step 1: Uitgangstoestand.** Zorg dat er voor een vaste dag minstens twee stops staan (bv. door in de test eerst `Plan deze week` te draaien, of via de wachtend-/gepland-dummydata met een datum in de bekeken week; kies de eenvoudigste die in testmodus werkt en leg de keuze vast in een hulpfunctie `maakRouteMetStops(page)` in het spec-bestand).
- [ ] **Step 2: Tests** (`test.describe('route')`):
  - `route berekenen toont tijden per stop`: tab Route (`#tab-planning`), klik `Route berekenen` → `verzoeken.van('/api/route')` bevat een POST met de coördinaten van de stops in de verwachte volgorde; elke stop toont een aankomsttijd (`HH:MM`); `verzoeken.van('/api/drukte')` bevat een POST.
  - `stops slepen wijzigt de volgorde en de tijden`: sleep de tweede stop boven de eerste (`dragTo` met stappen; val terug op `mouse.down/move/up`); de lijst toont de nieuwe volgorde (lees de ticketnummers uit de DOM); de aankomsttijden zijn opnieuw berekend (eerste stop vroeger dan tweede).
  - `Tijden vastleggen bewaart de tijden`: klik `Tijden vastleggen`; toast met bevestiging (lees de echte tekst in `index.html` rond `4262`); de stops tonen de vastgezette tijden bij herladen van de route-tab; `verzoeken.van('/api/plan-datum')` bevat in testmodus **geen** verzoek (de `TEST_MODE`-tak slaat Zoho over). Als de app het toch aanroept: leg de payload vast en meld dat in de commit (en schrap `plan-datum` uit `VERBODEN_PADEN` alleen na overleg, W11).
  - `optimaliseren zet de stops in de volgorde van de optimizer`: klik de optimaliseerknop; `verzoeken.van('/api/optimize')` heeft een POST; lijst volgt `optimize.json`.
- [ ] **Step 3: Run.** `npx playwright test e2e/route.spec.mjs` → `4 passed`; hele suite groen.
- [ ] **Step 4: Commit** `test(e2e): route berekenen, slepen, optimaliseren en tijden vastleggen`.

---

### Task 5: Voorstel (zonder versturen), eigen afspraak en blokkering

**Aanbevolen model:** sonnet

**Files:**
- Maak: `e2e/voorstel-afspraak-blokkering.spec.mjs`
- Mogelijk wijzig: `public/index.html` (`data-testid` op modal-velden)

**Interfaces:** gebruikt de stateful nep voor `afspraken` en `availability`.

- [ ] **Step 1: Tests** (`test.describe('voorstel, afspraak en blokkering')`):
  - `voorstel openen toont ontvangers en voorbeeld zonder te versturen`: ticket #1001 openen → `📨 Voorstel` → modal (`#proposal-overlay`) open; datum en tijd invullen; ontvangers bevatten `jan@test.be`; het voorbeeld (preview) toont de gekozen datum en klantnaam `Jan Peeters`; de knop `✉️ Verstuur voorstel` is zichtbaar maar wordt **niet** aangeklikt; sluit de modal. `verzoeken.van('/api/propose')` is leeg (ook door de auto-controle).
  - `klantbeschikbaarheid bewaren`: in het ticketdetail een beschikbaarheid toevoegen en `✓ Opslaan`; `verzoeken.van('/api/klantbeschikbaarheid')` bevat een POST/PUT waarvan de payload de ingevoerde datum bevat; de sectie toont de bewaarde datum.
  - `eigen afspraak toevoegen`: open het afspraakformulier (knop in de kalender, id van `saveManueelAfspraak` rond `index.html:491`), vul titel, datum (maandag 2026-10-05) en uur in, `Opslaan`; `verzoeken.van('/api/afspraken')` heeft een POST met die titel; de afspraak staat op de juiste dag in de kalender (tekst zichtbaar in `#tab-kalender`-weergave).
  - `blokkering (uitzondering) toevoegen`: open het beschikbaarheids-/blokkeringsformulier (zoek `_avFormDate` en `AV_API` rond `index.html:3290`), kies een hele dag (dinsdag 2026-10-06), opslaan; POST naar `/api/availability` bevat die datum met `kind: 'fullday'`; de dag wordt in de kalender als geblokkeerd getoond (lees de echte markering uit de DOM).
- [ ] **Step 2: Run.** `npx playwright test e2e/voorstel-afspraak-blokkering.spec.mjs` → `4 passed`; hele suite groen.
- [ ] **Step 3: Commit** `test(e2e): voorstel-modal (zonder versturen), eigen afspraak en blokkering`.

---

### Task 6: Instellingen en rapportwizard tot het voorbeeld

**Aanbevolen model:** sonnet (wizard-stappen en validatie beoordelen; W11 extra voorzichtig)

**Files:**
- Maak: `e2e/instellingen-rapport.spec.mjs`
- Mogelijk wijzig: `public/index.html`, `public/js/rapport-wizard.js` (enkel `data-testid`, niets anders: W11)

**Interfaces:** `rapport-archief`-stub (stateful); optimize/route-fixtures voor het route-gedeelte van de wizard (`rapport-wizard.js:163`).

- [ ] **Step 1: Tests** (`test.describe('instellingen en rapport')`):
  - `instellingen bewaren`: klik `⚙` (Instellingen), zet `Laatste start` op `15:00` (`#set-laatste-start`), `Opslaan`; toast `Instellingen opgeslagen voor alle technici`; heropenen toont `15:00`; localStorage-sleutel van de instelling bevat `15:00` (lees de sleutel in `index.html` rond `856`).
  - `laatste start buiten de werktijden wordt geweigerd`: zet `Laatste start` op `23:00` met eindtijd 17:00 → toast `Laatste start moet tussen begin- en eindtijd liggen`; instelling blijft de oude waarde.
  - `instellingen voor één technieker`: kies technieker `Tim`, open Instellingen → titel `Instellingen voor: Tim`; toast na opslaan noemt `Tim`.
  - `rapportwizard loopt tot het voorbeeld zonder te versturen`: als technieker `Tim`, open de rapportwizard voor ticket #1001 (via ticketdetail, knop `Rapport`; zoek de ingang in `index.html`/`rapport-wizard.js`); vul de verplichte velden per stap in (type bezoek `Interventie`, probleem, acties; geen foto's, geen handtekening tenzij verplicht: lees de validatie); ga door tot het voorbeeld of de samenvatting; assert dat de ingevulde tekst `probleem` en `acties` in het voorbeeld staat; klik **niet** op versturen of archiveren. `verzoeken.van('/api/send-rapport')`, `'/api/rapport'` en `'/api/rapport-verzonden'` zijn leeg. Een `rapport-archief`-aanroep is toegestaan alleen als de wizard die zelf doet bij het openen (lees dan alleen GET).
- [ ] **Step 2: Run.** `npx playwright test e2e/instellingen-rapport.spec.mjs` → `4 passed`; hele suite groen.
- [ ] **Step 3: Commit** `test(e2e): instellingen en rapportwizard tot het voorbeeld (zonder versturen)`.

---

### Task 7: Afronding — stabiliteit, sabotage en documentatie

**Aanbevolen model:** haiku voor stap 1–3 en 5 (mechanisch, volledige instructie hieronder); sonnet voor stap 4 (sabotagekeuzes beoordelen)

**Files:**
- Wijzig: `CLAUDE.md` (sectie "Tests", 3 regels), `docs/superpowers/specs/2026-10-01-etappe0-vangnet-design.md` (alleen als een ruling in de praktijk moest afwijken, met `Ruling:`-regel)

**Interfaces:** geen.

- [ ] **Step 1: Stabiliteit.** `npx playwright test --repeat-each=3` → alles groen, 0 flaky. Zijn er flaky tests: oorzaak verhelpen (wachten op toestand), niet de retries verhogen.
- [ ] **Step 2: Duur.** Noteer `npx playwright test` totale looptijd; moet < 2 min (spec §1). Zo niet: `workers` verhogen of tests splitsen.
- [ ] **Step 3: `node --test`** zonder pad: nog steeds `tests 136 / pass 136` en geen enkel `e2e/`-bestand in de uitvoer.
- [ ] **Step 4: Sabotage (sonnet).** Per flow één tijdelijke app-wijziging, test moet falen, wijziging terugzetten (`git checkout -- public/index.html`):
  - `autoPlan`: `if (activeAssigneeFilter === 'all')`-blokkade uitcommentariëren → `Iedereen geeft een toast` faalt;
  - `redenTekst`: tekst van `te-ver` wijzigen → `resultaat toont de reden` faalt;
  - `saveSettings`: validatieregel (`index.html:5913`) uitcommentariëren → `laatste start buiten werktijden` faalt;
  - `sendProposal` laten fetchen naar `/api/propose` bij openen → de auto-controle (verboden verzoek) faalt;
  - een `/api/tickets`-aanroep in `?test` toevoegen → de vangnet-controle faalt.
  Meld welke sabotage niet opviel (dan is er een gat: aanvullen).
- [ ] **Step 5: Documentatie.** `CLAUDE.md`: sectie "Tests" met `node --test` (logica) en `npm run test:e2e` (flows, na elke taak die een scherm raakt), met de eerste-keer-installatie (`npx playwright install chromium`).
- [ ] **Step 6: Eindcontrole.** `git status` schoon op de bedoelde bestanden; `git diff main -- public/` toont alleen `data-testid` (en eventueel de gedocumenteerde bugfix).
- [ ] **Step 7: Commit** `docs: testinstructies e2e in CLAUDE.md; etappe 0 afgerond`.

---

## Na de etappe

- Sonnet-eindreview van de etappe (geen opus, roadmap §5), met nadruk op Review Focus 1 en 4.
- De e2e-suite wordt vanaf nu na elke taak in etappes 2–7 gedraaid; een rode test is een gedragswijziging en wordt opgelost of expliciet gelogd (W5).
- Een bugfix uit Taak 1 (consoleruis) komt in de CHANGELOG-sectie van de refactor-tak.
