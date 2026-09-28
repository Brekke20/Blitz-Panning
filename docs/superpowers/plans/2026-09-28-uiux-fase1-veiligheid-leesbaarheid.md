# UI/UX fase 1 (v1.6.1) — Veiligheid en leesbaarheid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Geen per ongeluk verstuurde/uitgeplande tickets meer, een leesbaar licht thema met behoud van Blitz-groen, en een testmodus die niets naar de server schrijft.

**Architecture:** Vanilla PWA zonder build of testframework. `public/index.html` is een klassiek script met globale functies en `const TEST_MODE`, `public/js/*.js` zijn ES-modules die globale functies via `window.*` delen. Nieuw is één kleine module `public/js/app-dialog.js` voor een in-app bevestigingsvenster. Verificatie gebeurt met `node --check` voor syntaxis, plus browsercontrole op `http://localhost:3333/?test`.

**Tech Stack:** HTML/CSS/vanilla JS, Netlify Functions, CSS-variabelen in `public/css/base.css`.

**Spec:** goedgekeurd ontwerp fase 1 (in chat, 2026-09-28) + overkoepelend plan `C:\Users\BRENT\.claude\plans\maak-een-plan-van-swift-grove.md` (sectie Fase 1) + audit `docs/reviews/2026-09-28-ui-ux-audit/`.

## Global Constraints
- **Blitz-groen `#00dfa3` blijft exact** (`--accent`, `--green`) in beide thema's. Gebruik GEEN donkerdere groentint. Contrast los je op met donkere tekst op groen (`--on-accent`) of donkere tekst in plaats van groene tekst.
- Alle UI-tekst in het Nederlands. Code-commentaar volgt de stijl van het bestand (NL, met reden en datum waar dat gebruikelijk is).
- Geen nieuwe afhankelijkheden. Geen build-stap.
- Contrast: tekst ≥ 4,5:1 op `--bg`, `--surface` en `--surface2` in beide thema's.
- **Browser-agents mogen NOOIT op "Versturen" in het rapport-bevestigingsvenster drukken**, noch op een knop die iets opslaat naar Zoho. Gebruik altijd een eigen tab (`tabs_create`, en `tabId` bij elke aanroep).
- Werk uitsluitend in de worktree `.claude/worktrees/uiux-fase1-veiligheid`, op branch `worktree-uiux-fase1-veiligheid`. Prefix elk shellcommando met `cd "<worktree>" &&` en controleer `git branch --show-current` vóór elke commit.
- Commit-trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus
1. **Pop-upblokkering:** het afdrukvoorbeeld moet nog steeds openen na de bevestiging. `window.open` moet synchroon in de klik-handler van de knop "Versturen" gebeuren (iOS Safari). Een `await` vóór `printRapport()` is een fout.
2. **Bulk "alle stops verwijderen"** (`index.html:3501`, heeft al een eigen `confirm`) en `removeTicketFromAllDays` (`:1290`) mogen GEEN extra bevestiging per ticket krijgen.
3. **Toast op desktop met open modal:** de toast blijft boven `.overlay` (z-index 10000), ook als lange tekst over meerdere regels loopt.
4. **Testmodus met een al bestaand outbox-item:** het item mag niet in een eindeloze herhaallus komen en moet zichtbaar het label "Testmodus — niet verzonden" krijgen.
5. **Lokaal ticket** (`_wizTicket.isLocal`): het bevestigingsvenster noemt geen Zoho-stappen.

---

### Task 1: Kleurtokens en tekst op groen (model: haiku)

**Files:**
- Modify: `public/css/base.css:3-47`, `public/css/app.css` (287, 549, 582 en andere `color:#fff` op een groene achtergrond), `public/index.html:4655-4663` (planBtn inline-kleur), overige CSS/JS waar `color: var(--accent)` of `color: var(--green)` als TEKST gebruikt wordt (±65 treffers via `grep -n "color: *var(--accent)\|color: *var(--green)"`).

**Interfaces:**
- Produces: CSS-variabelen `--on-accent` en `--accent-ink` (beide thema's), en aangepaste `--muted`, plus in het lichte thema `--orange`, `--red` en `--blue`. Taak 4 gebruikt `--red` en `--on-accent`.

- [ ] **Stap 1:** In `:root` toevoegen:
  - `--on-accent: #0b1f18;`
  - `--accent-ink: var(--accent);`
  - `--muted` naar een waarde met ≥ 4,5:1 op `#181e24`, `#1d252d` en `#232d37` (startpunt `#8b97a5`, nameten).
- [ ] **Stap 2:** In `:root[data-theme="light"]` toevoegen:
  - `--accent-ink: var(--text);`
  - `--muted: #5b6778;`
  - `--orange: #b45309;`
  - `--red: #c81e1e;`
  - `--blue: #1d4ed8;`
  `--accent` en `--green` NIET overschrijven.
- [ ] **Stap 3:** Overal waar tekstkleur `var(--accent)` of `var(--green)` is, `var(--accent-ink)` gebruiken. Dit geldt niet voor `border`, `background`, `fill`, `stroke`, `outline` of `box-shadow`.
- [ ] **Stap 4:** Waar tekst op een groene achtergrond staat (`#fff`, `white` of `color:#fff` met `background: var(--accent|--green)`, ook inline in JS-templates en in de planBtn), `var(--on-accent)` gebruiken. `.pill-count` op oranje behoudt `#fff`: met het donkerdere lichte oranje haalt dat ≥ 4,5:1. In het donkere thema `--on-accent` gebruiken als wit < 4,5:1.
- [ ] **Stap 5:** Verifiëren in de browser (eigen tab, 1440×900, beide thema's) met `javascript_tool`: `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#00dfa3'` in beide thema's. Daarnaast een contrastscan over alle zichtbare tekstelementen (WCAG-luminantieformule) op Wachtrij, Kalender en Rapporten. Verwacht: geen tekst < 4,5:1, behalve tekst die bewust uitgeschakeld is.
- [ ] **Stap 6:** Commit met `fix(ui): leesbaar licht thema, --on-accent/--accent-ink, Blitz-groen behouden`.

### Task 2: In-app bevestigingsvenster `appConfirm` (model: sonnet)

**Files:**
- Create: `public/js/app-dialog.js`
- Modify: `public/index.html` (module laden, zoals de bestaande `public/js`-modules geladen worden), `public/css/app.css` (dialoogstijl, hergebruik de bestaande `.overlay`/modal-klassen waar mogelijk).

**Interfaces:**
- Produces: `window.appConfirm({ titel: string, tekst: string|string[], bevestigLabel: string, annuleerLabel?: string = 'Terug', gevaar?: boolean = false, onBevestig?: () => void }) => Promise<boolean>`
  - `onBevestig` wordt **synchroon** in de klik-handler van de bevestigknop aangeroepen, vóór de Promise resolvet (nodig voor `window.open`).
  - Een array voor `tekst` wordt als opsomming getoond.
  - Escape, klik op de achtergrond en "Terug" geven `false`.
  - De focus start op "Terug" en blijft binnen het venster (Tab-lus).
  - `role="dialog"`, `aria-modal="true"`, `aria-labelledby` naar de titel.
  - Bevestigknop: `gevaar` betekent rood kader en rode tekst, anders groen vlak met `var(--on-accent)`.
  - Tekst wordt via `textContent` gezet, geen innerHTML met gebruikersdata.

- [ ] **Stap 1:** `app-dialog.js` schrijven, exporteren en `window.appConfirm` zetten. Knoppen minstens 44 px hoog.
- [ ] **Stap 2:** `node --check public/js/app-dialog.js`. Verwacht: geen uitvoer.
- [ ] **Stap 3:** Browsercontrole (eigen tab): in de console `appConfirm({titel:'Test',tekst:['a','b'],bevestigLabel:'OK'})` uitvoeren. Controleren:
  - Escape geeft `false`;
  - opnieuw openen en op OK klikken geeft `true`;
  - screenshot in licht en donker thema, op 1440 en 375 breed.
- [ ] **Stap 4:** Commit met `feat(ui): in-app bevestigingsvenster appConfirm`.

### Task 3: Rapport versturen met bevestiging (model: sonnet)

**Files:**
- Modify: `public/js/rapport-wizard.js:144` (label) en `:152-167` (`wizNext`, laatste stap)

**Interfaces:**
- Consumes: `window.appConfirm` (Taak 2). Bestaand: `printRapport()`, `_wizTicket.isLocal`.

- [ ] **Stap 1:** Het label van de laatste stap wordt `'✓ Rapport versturen'`.
- [ ] **Stap 2:** In `wizNext()` roept de laatste stap niet meer rechtstreeks `printRapport()` aan, maar `appConfirm`:
  - `titel: 'Rapport versturen?'`
  - `bevestigLabel: 'Versturen'`
  - `onBevestig: () => printRapport()`
  - `tekst`, voor een niet-lokaal ticket:
    - `['Het rapport wordt gearchiveerd.', 'De PDF wordt aan ticket #<nummer> toegevoegd.', 'De uitgevoerde acties komen als oplossing op het Zoho-ticket.', 'Gebruikte onderdelen worden van je wagenvoorraad afgeboekt.', 'Het afdrukvoorbeeld opent in een nieuw venster.']`
  - `tekst`, voor een lokaal ticket: de Zoho-regels weglaten.
  Er komt geen `await` tussen de klik en `printRapport()`: `printRapport` wordt enkel via `onBevestig` aangeroepen.
- [ ] **Stap 3:** `node --check public/js/rapport-wizard.js`.
- [ ] **Stap 4:** Browsercontrole op 375×812 (eigen tab, `?test`):
  - rapport openen en naar de laatste stap gaan;
  - de knop toont "✓ Rapport versturen";
  - klikken opent het venster met de opsomming;
  - **op "Terug" klikken**: de wizard blijft open op dezelfde stap;
  - in de serverlog geen `POST /api/rapport*`.
  NOOIT op Versturen klikken.
- [ ] **Stap 5:** Commit met `feat(rapport): bevestiging vóór versturen, knop "Rapport versturen"`.

### Task 4: Uitplannen met bevestiging (model: sonnet)

**Files:**
- Modify: `public/index.html`:
  - `:1332` (× op de kalenderkaart);
  - `:3684` (routestop);
  - `:4742-4757` (`togglePlanFromDetail`);
  - `:4658-4661` (planBtn-stijl);
  - de bestaande `@media (max-width: 1023px)`-regels in `public/css/app.css` (±879/904/920).

**Interfaces:**
- Consumes: `window.appConfirm` (Taak 2). Bestaand: `removeTicketFromDate(ticketId, date)`, tickets met `.number`.
- Produces: `async function bevestigUitplannen(ticketId: string, date: string): Promise<boolean>`
  - zoekt het ticketnummer op;
  - roept `appConfirm` aan met `{titel: 'Ticket #<nr> uit de planning halen?', tekst: 'Het ticket gaat terug naar de wachtrij.', bevestigLabel: 'Uit planning halen', gevaar: true}`;
  - roept bij `true` `removeTicketFromDate` aan.

- [ ] **Stap 1:** `bevestigUitplannen` toevoegen, direct na `removeTicketFromDate`.
- [ ] **Stap 2:** Deze drie plekken omzetten naar `bevestigUitplannen`:
  - de × (klasse `cal-unplan-x` toevoegen, inline stijl behouden, `title` en `aria-label` = "Uit planning halen");
  - de routestop-knop (label `✕ Uit planning halen`, `title` gelijk);
  - de pending-tak van `togglePlanFromDetail`. `closeDet()` pas na bevestiging.
  `removeTicketFromAllDays` en de bulkverwijdering (`:3501`) NIET aanpassen.
- [ ] **Stap 3:** De planBtn-pendingvariant wordt:
  - label `'✕ Uit planning halen'`;
  - `background: transparent`, `color: var(--red)`, `border: 1px solid var(--red)`.
  Bij de "+ Voeg toe aan planning"-variant de border resetten.
- [ ] **Stap 4:** `.cal-unplan-x { display: none }` binnen het bestaande max-width-1023px-blok.
- [ ] **Stap 5:** Browsercontrole (eigen tab, 1440):
  - op de × klikken opent het venster;
  - "Terug" laat het ticket staan;
  - op 375 breed is de × niet zichtbaar.
  Op "Uit planning halen" mag geklikt worden: dat verandert enkel lokale testdata. Controleer eerst dat de serverlog bij `?test` geen PATCH naar Zoho toont. Toont hij wel iets richting Zoho, klik dan niet en meld het.
- [ ] **Stap 6:** Commit met `feat(planning): bevestiging bij uit planning halen, één label, × verborgen op gsm`.

### Task 5: Meldingen (toasts) en copy (model: sonnet)

**Files:**
- Modify: `public/index.html:5762-5769` (`toast`), `:517` (`#toast`-element), `public/css/app.css:782-797`, plus de berichtteksten uit de copy-tabellen in `docs/reviews/2026-09-28-ui-ux-audit/audit-desktop.md` §D en `audit-gsm.md` §D (enkel toast- en foutteksten).

**Interfaces:**
- Produces: `toast(msg: string, ms?: number)`. De standaardduur wordt 4000 ms. Is het bericht een fout (begint met `⚠️` of `❌`, of bevat het "mislukt" of "fout"), dan geldt een minimum van 7000 ms. Een meegegeven `ms` wordt `Math.max(ms, standaard)`.

- [ ] **Stap 1:** `toast()` aanpassen zoals beschreven.
- [ ] **Stap 2:** `#toast` krijgt `role="status" aria-live="polite"`. De CSS wordt:
  - `white-space: normal`;
  - `max-width: min(90vw, 480px)`;
  - `border-radius: 14px`;
  - `line-height: 1.4`.
- [ ] **Stap 3:** Als de rapport-wizard open is, staat de toast boven de wizard-footer. Via de open-klasse van de wizard-overlay (zoek de id en open-klasse in `index.html`/`rapport-wizard.js`) en een CSS-regel met `:has()`, of met een klasse op `body` die de wizard zet en weghaalt. `bottom` wordt dan hoogte van de footer + 16 px.
- [ ] **Stap 4:** De technische teksten uit de copy-tabellen vervangen door de voorgestelde mensentaal. Minimaal:
  - "Conflict — data herladen" wordt "Iemand anders wijzigde dit net. De gegevens zijn opnieuw geladen."
  - teksten met "/api/setup" krijgen een menselijke formulering zonder URL;
  - "Ongeldig ticketId" in de outbox-balk krijgt een menselijke formulering.
  Elke vervanging in de commitboodschap of in een lijst in het rapport noemen.
- [ ] **Stap 5:** `node --check` op de gewijzigde JS-modules. Browsercontrole: `toast('⚠️ ' + 'x'.repeat(200))` loopt over meerdere regels, blijft ±7 s staan en is ook zichtbaar boven een open ticketdetail.
- [ ] **Stap 6:** Commit met `fix(ui): leesbare toasts (duur, meerdere regels, aria-live) en menselijke foutteksten`.

### Task 6: Labels en invoervelden (model: haiku)

**Files:**
- Modify:
  - `public/index.html:1732` ("🔓 Blokkade opheffen" wordt "🔓 Blokkade beheren");
  - de "+"-knop in de Wachtrij (`title` en `aria-label` = "Toevoegen aan planning");
  - `public/js/inventaris.js` (zichtbare tekst "Edit" wordt "Bewerken", commentaar en variabelen ongemoeid; aantalveld krijgt `inputmode="numeric"`);
  - `public/css/app.css` / `wizard.css` / `inventaris.css`: invulvelden ≥ 16 px onder 1024 px, en dubbele `.wiz-part-*`-regels in `wizard.css` opruimen zodat de 16 px niet meer overschreven wordt.

- [ ] **Stap 1:** De labels aanpassen.
- [ ] **Stap 2:** Een `@media (max-width: 1023px) { input, select, textarea { font-size: 16px; } }`-regel toevoegen aan het einde van `app.css`, `inventaris.css` en `wizard.css`. Laad-volgorde nagaan zodat hij wint.
- [ ] **Stap 3:** Browsercontrole op 375 breed. Met `javascript_tool` alle zichtbare `input`, `select` en `textarea` in Inventaris (Bewerken) en in de wizardstap Onderdelen doorlopen: `getComputedStyle(el).fontSize` is ≥ 16 px.
- [ ] **Stap 4:** Commit met `fix(ui): NL-labels, "Blokkade beheren", 16px-invoer tegen iOS-zoom`.

### Task 7: Testmodus schrijft niets naar de server (model: sonnet)

**Files:**
- Modify: `public/js/rapport-wizard.js:1148-1235` (`printRapport`), `public/js/outbox.js:261` (`attemptOutboxItem`), `public/js/inventaris.js:440` (`registreerVerbruik`)

**Interfaces:**
- Consumes: de globale `TEST_MODE` uit `index.html:532`. Modules lezen die al zo, zie `public/js/prijzen.js:57`.

- [ ] **Stap 1:** In `printRapport`, bij `TEST_MODE`:
  - geen `outboxAdd`;
  - geen `syncOplossingNaarZoho` (heeft al een eigen guard);
  - geen `registreerVerbruik`;
  - wel het afdrukvoorbeeld openen en de wizard afsluiten zoals nu;
  - toast `'🧪 Testmodus — rapport niet verzonden (enkel afdrukvoorbeeld)'`.
- [ ] **Stap 2:** In `attemptOutboxItem`, bij `TEST_MODE`:
  - geen enkele `fetch`;
  - `item.lastError = 'Testmodus — niet verzonden'`;
  - `outboxPut(item)` en het item teruggeven.
  Nagaan dat de herhaallogica (`flushOutbox`/retry) hierdoor niet elke seconde opnieuw draait. Gebruik de bestaande backoff, of sla testitems over in `flushOutbox`.
- [ ] **Stap 3:** `registreerVerbruik`: `if (TEST_MODE) return;` bovenaan, met commentaar dat testmodus op de live site anders de echte wagenvoorraad wijzigt.
- [ ] **Stap 4:** `node --check` op de drie bestanden.
- [ ] **Stap 5:** Browsercontrole. Een outbox-item simuleren door in de console via de module een testitem met `outboxAdd` toe te voegen, zonder de wizard te versturen. Controleren:
  - de balk toont "Testmodus — niet verzonden";
  - de serverlog toont geen `POST /api/rapport`, geen `POST /api/rapport-archief` en geen `POST /api/inventaris`.
  Daarna het testitem weer verwijderen met `outboxRemove`.
- [ ] **Stap 6:** Commit met `fix(test): testmodus verstuurt geen rapport/archief/voorraad naar de server`.

### Task 8: Afronden (hoofdsessie, geen subagent)
- [ ] Eindreview over de hele branch (model: **opus**) met `superpowers:requesting-code-review`.
- [ ] Browsercontrole op 1440, 768 en 375, in licht en donker thema, met screenshots voor Brent.
- [ ] Versie 1.6.1 in `package.json`/`package-lock.json`, `CHANGELOG.md` onder `[1.6.1]` (Fixed/Changed/Added), `CACHE_NAME` in `public/sw.js` +1.
- [ ] Samenvatting voor Brent (`opdrachtgever-samenvatting`). **Pas na zijn "ja"**: mergen, taggen `v1.6.1` en pushen.
