# Blitz Planning — project conventions

## Stack

Single-file PWA: `public/index.html`  
Serverless backend: `netlify/functions/` (ES modules, Netlify Blobs `blitz-data` store, `consistency: 'strong'`)  
Login: eigen sessiecookie (`netlify/lib/auth.js`), rechten per functie in `netlify/lib/rechten.js`; elke nieuwe functie krijgt een rij daar en een `beveiligV1/V2`-wrapper (`tests/rechten.test.mjs` dwingt dit af).

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

- `node --test` (zonder pad) — logica-tests. Nooit `node --test tests/`. De test "gelijktijdige inzendingen" in `tests/server-spel.test.mjs` faalt zelden onder zware belasting; los draait ze altijd.
- `npx playwright test` — alle Playwright-projecten samen (`chromium` en `sw`), alle `/api/*` gestubd; een volledige run duurt lang: reken op 30 tot 40 minuten met `--workers=2` (de pc is zwak: draai hem in shards met `--shard=K/4` en nooit twee runs tegelijk). Draai dit na elke taak die een scherm raakt. Gericht: `npx playwright test --project=chromium` of `--project=sw`.
- `@contrast` (in de titel): de 67 zware contrastproeven: negen per thema in `e2e/versiering.spec.mjs` (foto's van de achtergrond, vervaging, vier vensters, donker en licht, hover) en de rest in `e2e/hemel-contrast.spec.mjs` (de vier hemels, licht en donker, pc en gsm, plus de thema-scène; echte pixels); samen ongeveer 7 minuten. Een gewone run slaat ze over: `npx playwright test --workers=2 --grep-invert @contrast` (voor de rest van de suite). De releaserun draait ze apart erbij: `npx playwright test e2e/versiering.spec.mjs e2e/hemel-contrast.spec.mjs --grep @contrast --workers=1`. Draai ze ook na elke wijziging aan `css/base.css` (glas- of tekstkleuren), `css/hemel.css`, `css/evenement.css` (kaartkleuren), aan een themapakket of aan de achtergrond.
- Eerste keer: `npm install` en daarna `npx playwright install chromium`.

De e2e-suite heeft internet nodig: de app laadt Leaflet en signature_pad van cdnjs.cloudflare.com (bewust niet gestubd) en de Excel-export-tests halen ExcelJS van cdn.jsdelivr.net. Faalt een run op netwerkfouten voor die hosts (bv. een script dat niet laadt), dan is dat geen regressie in de app: controleer de verbinding en draai opnieuw.

**OneDrive en `ENOENT`-fouten.** De repo staat in OneDrive, dat nieuwe bestanden vergrendelt en synchroniseert; dat gaf `ENOENT` op trace- en tijdelijke bestanden. Daarom schrijft Playwright zijn uitvoer naar `path.join(os.tmpdir(), 'blitz-planning-pw')` (`outputDir` in `playwright.config.mjs`, buiten OneDrive) en staat `trace` lokaal uit (`process.env.CI ? 'retain-on-failure' : 'off'`). Zet een trace dus enkel gericht aan (`--trace=on`). Sluit bovendien `node_modules/`, `test-results/` en `.blobs-local-test/` uit van OneDrive-synchronisatie (rechtsklik > "Altijd op dit apparaat bewaren" uitzetten, of de repo buiten OneDrive plaatsen). `tests/playwright-config.test.mjs` pint `outputDir`, de trace-instelling en het DNS-slot (`--host-resolver-rules`) van het project `sw` vast.

## Mapdocumenten (laden enkel bij werk aan die bestanden)

Details per onderdeel staan in een eigen document. `e2e/` en `netlify/` hebben een eigen CLAUDE.md; de documenten over `public/` staan in `.claude/rules/` (met `paths`), want Netlify zet `public/` online:
- `e2e/CLAUDE.md`: productiemodus-tests en service worker-tests (fixtures, sloten, importguard, zelftests).
- `netlify/CLAUDE.md`: serverkant (`netlify/lib/`: zoho, http, mail-check, karakteriseringstests).
- `.claude/rules/kern.md`: de kernmodules (toestand, api, netwerk, opslag, mailcontrole, voorraad-drempel, versiering, ...).
- `.claude/rules/schermen.md`: de schermmodules en hun conventies (etappes 3 tot 7, `afh`, `data-actie`, vensters).
- `.claude/rules/spel.md`: het verborgen spel Blitz Run.
- `.claude/rules/stijl.md`: de stijl Open dag (kop, balken, glas, navigatie).
- `.claude/rules/service-worker.md`: de service worker (`sw.js`, `sw-strategie.js`).

Regels die overal gelden (ook al staan de details in een mapdocument):
- Een spec importeert `test` enkel uit zijn fixture: `./helpers.mjs` (gewoon), `../productie-hulp.mjs` (`e2e/productie/`) of `../sw-hulp.mjs` (`e2e/sw/`). Nooit `@playwright/test` rechtstreeks, nooit `waitForTimeout`.
- Elk nieuw laadbaar bestand onder `public/js/` komt in dezelfde commit in `SHELL` van `public/sw.js`; een eager module ook in de modulepreload-lijst van `index.html` (`tests/sw-schil.test.mjs`).
- Nooit `backdrop-filter`, `filter`, `transform` of `contain` op `.topbar-sticky`, `header` of `nav` (containing-block-regel; zie `.claude/rules/stijl.md`).

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
bugfixes op `main` en voor een rollback.

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

## Agent skills

### Issue tracker

Issues staan in GitHub Issues van `Brekke20/Blitz-Panning` (via de `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

De vijf standaardrollen, label gelijk aan de naam (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` en `docs/adr/` in de root (pas aangemaakt wanneer nodig). See `docs/agents/domain.md`.
