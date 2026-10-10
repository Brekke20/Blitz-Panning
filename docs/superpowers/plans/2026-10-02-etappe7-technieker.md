# Etappe 7 — Technieker (laadsnelheid, service worker, slechte verbinding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De app start sneller en robuuster op gsm en tablet: modulepreload en lazy ExcelJS, een service worker die ook de externe bibliotheken bewaart, time-outs en een eerlijke synchronisatie na een onzeker resultaat bij elke `/api`-aanroep, en de vier focusfouten na Escape weg. Zichtbaar gedrag identiek, behalve opgeloste bugs (W5); alles wat iets nieuws toont of na een klantmail gebeurt, wacht op Brent (spec §7).

**Architecture:**
- Eén klein, zuiver bestand per verantwoordelijkheid: `kern/netwerk.js` (time-outs), `kern/api.js` (`leesFout`), `public/sw-strategie.js` (SW-beslislogica, UMD, `node --test`-baar), dunne `public/sw.js`.
- Karakterisering eerst (T1), dan de bouwstenen (T2–T5), dan de schrijfpaden (T6, W11-voorzichtig), dan toegankelijkheid (T7), de antwoorden van Brent (T8) en afronding (T9). Elke taak eindigt groen.
- Een apart Playwright-project `sw` voor tests met een echte service worker; het project `chromium` blijft `serviceWorkers: 'block'`.

**Tech Stack:** vanilla ES-modules zonder bouwstap, `node --test`, `@playwright/test` 1.63.

**Spec:** `docs/superpowers/specs/2026-10-02-etappe7-technieker-design.md` (N1–N22, §7 vragen). Basis: HEAD c37c92e, baseline **745 unit + 412 e2e** groen. Elke taak heeft een feasibility-regel, gecontroleerd in de code op 2026-10-02.

## Global Constraints

- Alle Global Constraints van `docs/superpowers/plans/2026-10-01-etappe5a-vangnet-en-detail.md` en `…5b-….md` gelden: worktree `C:\Users\BRENT\OneDrive - Hertsens Transport (Walding)\Claude-Projects\blitz-planning\.claude\worktrees\planner-brein`, `cd "<pad>" &&` vóór elk shellcommando, `git branch --show-current` == `refactor` vóór elke commit, nooit pushen, nooit `.claude/launch.json` stagen, **nooit `git add -f` onder `.superpowers/`**, nooit echte Zoho/TomTom/mail, één serverproces (stop enkel je eigen PID), Nederlandse namen, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Geen `CACHE_NAME`-bump, geen versie, geen `package.json`-wijziging.** Elk nieuw laadbaar bestand onder `public/js/` komt in dezelfde commit in `SHELL` van `public/sw.js` (N19). Het "CACHE_NAME-bump + SW-updatepad"-item staat in de release-checklist van spec N5 en wordt in T9 in de ledger overgenomen voor etappe 9.
- **Wizard (D19/N18)**: `git diff c37c92e..HEAD -- public/js/rapport-wizard.js public/js/outbox.js` is leeg bij het einde van elke taak.
- **Zoho en mail (W11)**: `planacties.js`, `ticketdetail.js`, `route.js`, `voorstel.js`, `annuleren.js`, `rapport-verzenden.js` krijgen enkel wat de taak noemt, diff `-w --color-moved` in de commitbody, alle productietests ongewijzigd groen. Geen wijziging aan request, payload, volgorde of rollback.
- **Teksten (N17)**: geen enkele zichtbare tekst wijzigt vóór T8 en Brents akkoord.
- **Tests**: `node --test` zonder pad; e2e met `npx playwright test` (project `chromium`) en vanaf T5 `npx playwright test --project=sw`; geen `waitForTimeout`; `page.clock.runFor` voor timers; `--repeat-each=3` bewijst stabiliteit van nieuwe e2e.
- Ledger: `.superpowers/sdd/2026-10-02-etappe7-technieker/` (niet in git). Brief en diff als bestand naar subagents; terugmelding maximaal 15 regels.
- Modelkeuze per taak staat bij de taak (W12). Geen taak is puur documentatie, dus geen haiku.

## Review Focus

1. **Geen gedragswijziging buiten de rulings**: elke wijziging in een W11-pad is enkel de toegestane (N7: één regel in de `catch`).
2. **Time-outs (N6)**: een meegegeven `signal` blijft onaangeroerd; tijden volgens de tabel; geen wijziging in de wizard of outbox; productietests groen.
3. **SW-consistentie**: momentopname wordt bij succes niet ververst (N3e); `cacheModus`; `install` breekt niet op een CDN-storing; `/api` en niet-GET onaangeroerd; `CACHE_NAME` nog v25.
4. **Vangnet van de SW-tests (N14/N15)**: de zes sloten en de waarnemer; de guard blokkeert `serviceWorkers`/`setOffline` buiten `e2e/sw-hulp.mjs`; geen eigen routes in specs.
5. **Pins omgedraaid, niet gewist**: elke `HUIDIG GEDRAG`-pin van T1 is in een aparte, benoemde commit omgedraaid (RED → GREEN) met een regel in de CHANGELOG-sectie "Refactor-tak".
6. **Lazy loading (N2)**: enkel ExcelJS en `excel-export.js`; geen `window`-naam erbij; modulepreload-test gelijk aan de graaf.

---

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `scripts/meet-laden.mjs` (nieuw, T1) | laadmeting voor/na (buiten de suites) |
| `e2e/helpers.mjs`, `e2e/productie-hulp.mjs` (T1) | `afbreken`/`hangen`-antwoorden, `verwachtNetwerkFout`, optie `klok` |
| `e2e/productie/excel-export.spec.mjs` (T1, T3), `e2e/productie/verbinding.spec.mjs` (T1, T2, T6), `e2e/route-slepen-render.spec.mjs` (T1) | karakterisering en omgedraaide pins |
| `public/js/kern/netwerk.js` (nieuw, T2), `public/js/kern/api.js` (T2), `public/js/kern/brug.js` (T2) | time-outs en `leesFout` |
| `tests/netwerk.test.mjs` (T2), `tests/api.test.mjs` (T2) | unit |
| `public/index.html` (T3), `public/js/excel-export.js` (T3), `public/js/app.js` (T3, T4, T6) | modulepreload, lazy ExcelJS, SW-registratie, `loadTickets` |
| `public/sw.js`, `public/sw-strategie.js` (nieuw, T4), `tests/sw-strategie.test.mjs`, `tests/sw-schil.test.mjs` (nieuw, T4) | service worker en consistentietests |
| `playwright.config.mjs`, `e2e/sw-hulp.mjs`, `e2e/sw/*.spec.mjs`, `e2e/fixtures/sw-v25-main.js` (nieuw, T5), `tests/e2e-import-guard.test.mjs` (T5) | SW-testproject |
| `public/js/schermen/planacties.js`, `ticketdetail.js`, `route.js`, `beschikbaarheid.js`, `afspraken.js`, `klantbeschikbaarheid.js` (T6) | resync na onzeker resultaat |
| `public/js/venster.js`, `schermen/voorstel.js`, `instellingen.js`, `planacties.js`, `afspraken.js`, `kalender.js`, `e2e/vensters.spec.mjs` (T7) | focus na Escape |
| `CHANGELOG.md`, `CLAUDE.md` | T9 |

## Interfaces (eindtoestand)

```js
// kern/netwerk.js
export const TIJDLIMIETEN = { standaard: 20000, lang: 35000, fotoUpload: 60000 };
export function limietVoor(pad, methode) // -> ms (lang: propose, send-rapport, annuleer, rapport, planning-sinds, planning-export; fotoUpload: PUT /api/fotos)
export function installeerFetchTimeout(doel, { limieten = TIJDLIMIETEN, setTimeoutFn, clearTimeoutFn } = {}) // omhult doel.fetch; geeft een herstelfunctie terug
// kern/api.js (nieuw naast apiVerzoek/apiJson/bewaarMetVersie)
export function leesFout(err) // -> { soort: 'offline'|'timeout'|'netwerk'|'http'|'onbekend', onzeker: boolean, status?: number }
// public/sw-strategie.js  (UMD: self.SwStrategie in de SW, module.exports in node)
//   maakStrategie({ cacheNaam, externNaam, shell, cdnVast, fontHosts, eigenOrigin, navTimeoutMs = 0, subTimeoutMs = 0, cacheModusMs = 60000,
//                   caches, fetchFn, nu, wacht }) -> { installeer(), activeer(), behandel(request) } ; behandel geeft null voor "niet afhandelen"
// public/sw.js: CACHE_NAME 'blitz-planning-v25' (niet ophogen), EXTERN_CACHE 'blitz-extern-v1', SHELL, CDN_VAST; navTimeoutMs uit '?navTimeout=' (enkel tests) of de constante NAV_TIMEOUT_MS (standaard 0)
// registreerVenster({ el, isOpen, sluit, terugFocus })   // terugFocus: () => HTMLElement | null, optioneel
```

---

## Task 1: Karakterisering en meting

**Model: sonnet.** Test- en meetwerk, geen productiewijziging (behalve de twee testhulpbestanden).

**Feasibility (gecontroleerd):**
- `e2e/helpers.mjs:257-269` verwerkt een handlerantwoord `{ status, json }` of `{ raw }` in `route.fulfill`; twee extra takken (`afbreken` → `route.abort(naam)`, `hangen` → nooit antwoorden) passen daar. `helpers.mjs` is geen productiebestand (de guard laat het routes registreren).
- `productie-hulp.mjs`: `zohoStubs().zetAntwoord(naam, antwoord)` bewaart het antwoord ongezien (`antwoorden[naam] = antwoord`), `verwachtHttpFout` is het voorbeeld voor `verwachtNetwerkFout`; de `requestfailed`-luisteraar staat in de fixture `consoleFouten`.
- `startAppProductie` installeert altijd `page.clock`; een optie `klok: false` (standaard `true`) is een regel.
- `exportTicketLog` leest `_rapportArchief`, `#rapp-van`/`#rapp-tot` en bouwt de bestandsnaam `TicketLog_<van>_<tot>.xlsx`; `zohoStubs({ rapporten })` vult het archief (gebruikt in `productie/rapport.spec.mjs`). ExcelJS komt van de CDN (GET toegelaten, de suite heeft al internet nodig).
- Slepen: `sorteer.js` `maakSorteerbaar` met pointer events; `route.js` vernietigt de instantie bij elke `renderRouteList` (`sorteer?.vernietig()`), dus een render midden in een drag is te veroorzaken met `kern.toestand.raak('planning')` terwijl `page.mouse` de muisknop vasthoudt.
- Meetscript: de grafiekscan (46 modules, diepte 10) en de proef met hangende CDN werkten als wegwerpscript; `playwright-core` is importeerbaar vanuit `node_modules`.

**Files:** `e2e/helpers.mjs`, `e2e/productie-hulp.mjs`, `e2e/productie/excel-export.spec.mjs` (nieuw), `e2e/productie/verbinding.spec.mjs` (nieuw), `e2e/route-slepen-render.spec.mjs` (nieuw), `scripts/meet-laden.mjs` (nieuw).

- [ ] **Step 1: Testhulp (N13).** `helpers.mjs`: antwoord `{ afbreken: 'failed' }` en `{ hangen: true }` in `stubExtern`. `productie-hulp.mjs`: `verwachtNetwerkFout(verzoeken, [{ pad }])` (per test gescoped, zoals `verwachtHttpFout`: enkel dat pad is toegelaten als `requestfailed`, de test faalt als het uitblijft; ook de bijbehorende `console.error`-regel van de browser), optie `klok` in `startAppProductie`. Een zelftest in `e2e/productie/vangnet-zelftest.spec.mjs` bewijst dat een niet-verwachte `requestfailed` nog steeds faalt en dat `verwachtNetwerkFout` faalt als de fout uitblijft.
- [ ] **Step 2: Excel-karakterisering (N20).** `productie/excel-export.spec.mjs`: archief met 2 rapporten, klik "📊 Excel export", `page.waitForEvent('download')`, bestandsnaam, bytes beginnen met `PK`, het zip bevat `xl/worksheets/sheet1.xml` met beide ticket-id's; toast "✓ 2 rijen geëxporteerd". Tweede geval: leeg archief → "Geen rapporten beschikbaar om te exporteren". (Unzippen met een node-ingebouwde `zlib`-lezer of een kleine functie in het spec; geen nieuwe dependency.)
- [ ] **Step 3: Pins (HUIDIG GEDRAG, benoemd, elk met een `// → T<n>`-verwijzing).** In `productie/verbinding.spec.mjs`, telkens met alleen de whitelist `verwachtSchrijven`:
  - **P1 (→ T6, H1)**: ticket X gepland (stub `plan` slaagt), daarna `{ afbreken }` op `GET /api/tickets` en klik "Vernieuwen": X staat weer in de wachtrij en niet meer in de route (verouderde cache toegepast).
  - **P2 (→ T2, H2)**: `{ hangen }` op `plan`; na `page.clock.runFor(120000)` is het ticket nog "in flight" (een tweede klik op Inplannen doet niets, geen tweede `plan`-verzoek).
  - **P3 (→ T2, H6)**: `{ hangen }` op `annuleer` (met een voorstel in het register): na `runFor(120000)` staat de knop op "Bezig…", "Terug" is uit en Escape sluit het venster niet.
  - **P4 (→ T6, H3)**: `plan` met `{ afbreken }` na het opnemen van het verzoek: rollback klopt, maar er volgt géén herlading (`GET /api/tickets` blijft op het aantal van de opstart) en de stub `tickets` (die het ticket als gepland toont) wordt niet geraadpleegd.
  - **P5 (→ T6, H5)**: stateful `availability`-stub die de schrijf opslaat en daarna afbreekt: het item is lokaal teruggedraaid; de volgende schrijf geeft 409 en het weggerolde item komt terug met de melding "Iemand anders wijzigde dit net".
  - **P6 (blijft, N12)**: `e2e/route-slepen-render.spec.mjs`: sleep een stop (muis neer, 20 px bewegen), roep midden in de drag `kern.toestand.raak('planning')` aan, laat los: geen `plan-datum`-verzoek, geen `.sorteer-actief`, geen `.sorteer-placeholder`, de lijst heeft dezelfde volgorde als vóór de drag.
- [ ] **Step 4: Meetscript (N22).** `scripts/meet-laden.mjs`: eigen mini-server op een vrije poort (lege `/api`-antwoorden met 200, geen backend), Chromium met `--host-resolver-rules` (enkel localhost en de twee CDN-hosts) en `context.route`-vertraging per verzoek voor de eigen server (0, 150, 400 ms). Meet per profiel, koud (nieuw profiel, zonder SW) en warm (tweede bezoek), het aantal verzoeken, de overgedragen bytes en de tijd tot `window.kern` bestaat én `#cnt-tickets` gevuld is; plus de koude-start-parsetijd van `rapport-wizard.js` onder CPU-vertraging 4× (`Emulation.setCPUThrottlingRate`, Performance-entry van het module-script). Druk de tabel af. Draai het één keer en schrijf het resultaat (**"voor"**) in het ledger. Overschrijdt de wizard-parsetijd 150 ms op 4×: noteer het als vraag voor Brent in het ledger (N2).
- [ ] **Step 5: Draai alles.** `node --test` (745) en `npx playwright test` (412 + de nieuwe), `--repeat-each=3` op de nieuwe specs. Commit: `test(technieker): karakterisering — Excel-export, verbindingspins, slepen door render, testhulp afbreken/hangen, laadmeting (etappe 7)`.

---

## Task 2: Time-outs en foutclassificatie (N6, N7-basis)

**Model: sonnet.** Logica en integratie in de enige `window`-brug.

**Feasibility (gecontroleerd):**
- `index.html:23-43` patcht `window.fetch` in de `<head>` enkel bij `?test` (header `X-Blitz-Test`); `brug.js` is de eerste module (`index.html:637`), dus een omhulsel daar komt er als buitenste laag boven. `brug.js` is de enige module die `window` toewijst (`tests/window-namen.test.mjs`); `netwerk.js` krijgt `doel` als parameter en bevat het woord `window` niet.
- `outbox.js:94` geeft zijn eigen `signal` mee en blijft dus onaangeroerd; `apiVerzoek` (`kern/api.js`) gebruikt de globale fetch laat-gebonden.
- `AbortController.abort(reden)` en `DOMException('…', 'TimeoutError')`: Chromium 98+, Safari 15.4+, voldoende voor de doeltoestellen. De controller wordt handmatig aan een meegegeven `signal` gekoppeld (geen `AbortSignal.any`, pas Safari 17.4).
- e2e met `page.clock`: `setTimeout` in de pagina is nep-klok, dus `page.clock.runFor(21000)` laat de time-out vuren.

**Files:** `public/js/kern/netwerk.js` (nieuw), `public/js/kern/api.js`, `public/js/kern/brug.js`, `public/sw.js` (`SHELL`), `tests/netwerk.test.mjs` (nieuw), `tests/api.test.mjs`, `e2e/productie/verbinding.spec.mjs`.

- [ ] **Step 1: Unit RED (`tests/netwerk.test.mjs`, nep-`fetch` en nep-timers).** `limietVoor` per pad/methode (tabel van N6, ook query en trailing slash); het omhulsel: geen `/api/` (CDN, tegels, fonts, `data:`) → onaangeroerd doorgegeven; `/api/x` slaagt vóór de limiet → timer opgeruimd, antwoord ongewijzigd; limiet verstreken → rejects met `DOMException` `TimeoutError` en `init.signal` aborted; een meegegeven `signal` (eerder of later aborted) wint en wordt niet vervangen; `Request` als invoer; `URL` als invoer; de herstelfunctie zet de oorspronkelijke fetch terug; method `PUT /api/fotos` krijgt 60 s.
- [ ] **Step 2: `kern/netwerk.js` implementeren (GREEN).** Zie interface. Niet meer dan ± 60 regels.
- [ ] **Step 3: `leesFout` (RED → GREEN, `tests/api.test.mjs`).** `TimeoutError` → `{ soort: 'timeout', onzeker: true }`; `AbortError` (door de gebruiker) → `onzeker: true`; `TypeError` met `fetch` → `{ soort: 'netwerk', onzeker: true }`, en `offline` wanneer `navigator.onLine === false` (injecteerbaar); `ApiFout`/`Error('HTTP 502|503|504')` → `{ soort: 'http', status, onzeker: true }`; `HTTP 400/404/409/500` → `onzeker: false` (een 500 van onze eigen functie is een definitief antwoord); onbekend object → `{ soort: 'onbekend', onzeker: false }`.
- [ ] **Step 4: Installeren.** `kern/brug.js`: `installeerFetchTimeout(window)` vóór de `window.kern`-toewijzingen. `public/sw.js`: `/js/kern/netwerk.js` in `SHELL` (zelfde commit).
- [ ] **Step 5: e2e, pins omdraaien.** In `productie/verbinding.spec.mjs` P2 en P3 omdraaien (aparte, benoemde commit, RED → GREEN): na `runFor(36000)` (resp. 21000 voor `plan`) toont `plan` de bestaande foutmelding met de nieuwe detailtekst, het ticket is terug bedienbaar en geen half ticket; het annuleervenster is ontgrendeld ("Afspraak annuleren", "Terug" aan, Escape sluit) en de toast bevat de bestaande waarschuwing "De klant kan al gemaild zijn" als `mailKlant` aanstond. Daarnaast per soort een test dat een snelle, geslaagde aanroep niets verandert (de bestaande productiesuite is het bewijs) en dat `PUT /api/fotos` pas na 60 s afbreekt.
- [ ] **Step 6: Draai alles** (`node --test`, `npx playwright test`, `--repeat-each=3` op de nieuwe), `git diff c37c92e..HEAD -- public/js/rapport-wizard.js public/js/outbox.js` leeg. Commits: `feat(kern): netwerk.js — time-outs op /api en leesFout (etappe 7)` en `fix(verbinding): hangende aanroepen eindigen na de tijdlimiet (etappe 7)`; CHANGELOG-regel (Fixed): "Een hangende verbinding vergrendelt een ticket, het annuleervenster of de verzendknop niet meer; na 20–60 s verschijnt de bestaande foutmelding."

---

## Task 3: Laadvolgorde en lazy ExcelJS (N1, N2, N20)

**Model: sonnet.**

**Feasibility (gecontroleerd):**
- `index.html:634-636` bevat de drie synchrone CDN-scripts; `<link rel="preconnect">` voor Google Fonts staat er al. De modulegraaf is af te leiden uit de `import`-regels (de scan uit T1 werkt) en telt 46 bestanden; `modulepreload` wordt door oudere Safari genegeerd (onschadelijk).
- `app.js:42` importeert `exportTicketLog`, `app.js:225` koppelt hem aan `rapport-export`; `brug.js` en `window-namen.test.mjs` verwijzen er niet naar (de lijst in `window-namen.test.mjs:194` is een naamlijst van bestaande functies: de naam blijft bestaan als export van `excel-export.js`, de lijst controleren). `new ExcelJS.Workbook()` staat in de `try` van `exportTicketLog` (`excel-export.js:102`), dus een mislukte lading valt in het bestaande `catch`.
- `signature_pad` en Leaflet blijven (N2).

**Files:** `public/index.html`, `public/js/excel-export.js`, `public/js/app.js`, `tests/sw-schil.test.mjs` (nieuw, gedeeld met T4), `e2e/productie/excel-export.spec.mjs`.

- [ ] **Step 1: Graaftest RED (`tests/sw-schil.test.mjs`, onderdeel N16d).** Leidt de graaf af uit de `<script>`-tags van `index.html` en de `import`-regels; faalt zolang de `modulepreload`-tags niet precies de 46 modules dekken (geen ontbrekende, geen overbodige, geen dubbele) en zolang een `preconnect` naar `cdnjs.cloudflare.com` of `cdn.jsdelivr.net` ontbreekt.
- [ ] **Step 2: `index.html`.** `modulepreload` voor alle modules (volgorde: kritieke keten eerst: `brug.js`, `app.js` en zijn imports), `preconnect`; het ExcelJS-`<script>` weg.
- [ ] **Step 3: Lazy bibliotheek en module.** In `excel-export.js` een privéfunctie `laadExcelJs()` (script-element met de vastgepinde jsdelivr-URL als constante, `onload`/`onerror`, één gedeelde belofte, `window.ExcelJS`-controle vooraf zodat een tweede export niet opnieuw laadt) die binnen de bestaande `try` wordt afgewacht; foutafhandeling: het bestaande `toast('✕ Export mislukt: …')`, tekst ongewijzigd (N17). `app.js`: `'rapport-export': async () => (await import('./excel-export.js')).exportTicketLog()` en de statische import weg; de bestaande lege-archieftoast loopt via dezelfde module.
- [ ] **Step 4: Tests.** De Excel-karakterisering uit T1 blijft ongewijzigd groen; nieuw: een test dat bij het opstarten en na het openen van de rapport-tab **geen verzoek naar `cdn.jsdelivr.net`** gaat en dat de eerste klik er precies één doet; de graaftest uit stap 1 groen; `window-namen.test.mjs` groen.
- [ ] **Step 5: Bewijs.** Draai `scripts/meet-laden.mjs` opnieuw (koud, 0/150/400 ms) en noteer het **"na T3"**-resultaat in het ledger. Verwachting: koude start zonder 258 KB gzip en met een ketendiepte van 1. Draai alles. Commit: `perf(laden): modulepreload en preconnect; ExcelJS en excel-export.js lazy (etappe 7)`; CHANGELOG (Changed): "De app laadt zijn onderdelen vooraf parallel en haalt de Excel-bibliotheek pas op bij de eerste export."

---

## Task 4: Service worker — strategie, CDN-cache, consistentietests (N3, N16, N19)

**Model: sonnet.**

**Feasibility (gecontroleerd):**
- `public/sw.js` is klassiek en kort; `importScripts('/sw-strategie.js')` is toegelaten in een klassieke SW en `sw-strategie.js` wordt bij een SW-update mee op wijziging gecontroleerd.
- Testbaarheid: `tests/` importeert al ES-`.js` uit `public/js` zonder `"type": "module"` (Node 24 detecteert het); een CJS/UMD-`.js` uit een ESM-test importeren (`import s from '../public/sw-strategie.js'`) werkt zonder extra vlag. `caches` en `fetch` worden geïnjecteerd.
- CDN-URL's: `index.html` bevat Leaflet-js/-css (cdnjs 1.9.4) en signature_pad (cdnjs 4.1.7); ExcelJS staat na T3 als constante in `excel-export.js`. Beide hosts sturen `Access-Control-Allow-Origin: *` (gemeten voor jsdelivr; cdnjs idem), dus `new Request(url, { mode: 'cors' })` bij `install` geeft een niet-ondoorzichtig antwoord; `cache.match` voor een later `no-cors` scriptverzoek vindt het op URL.
- Registratie: `app.js:337` `navigator.serviceWorker.register('/sw.js').catch(() => {})`.
- `EXTERN_CACHE` moet de `activate`-opruiming overleven (de huidige `keys.filter(k => k !== CACHE_NAME)` zou hem wissen).

**Files:** `public/sw-strategie.js` (nieuw), `public/sw.js`, `public/js/app.js` (één regel), `tests/sw-strategie.test.mjs` (nieuw), `tests/sw-schil.test.mjs`.

- [ ] **Step 1: Unit RED (`tests/sw-strategie.test.mjs`, nep-caches/-fetch/-klok).**
  - `behandel`: `/api/…`, niet-GET en onbekende hosts → `null`.
  - Shell, netwerk geslaagd → antwoord van het netwerk, cache **niet** bijgewerkt (N3e).
  - Shell, netwerkfout → de cache; navigatie met een querystring (`/?x=1`) → `/index.html` uit de cache.
  - Navigatie met `navTimeoutMs = 500` en een fetch die niet antwoordt → cache na 500 ms (nep-klok) en `cacheModus` aan: een volgend submoduleverzoek gaat cache-eerst; na `cacheModusMs` terug netwerk-eerst. Met `navTimeoutMs = 0` wacht een hangende fetch (geen timer).
  - CDN-URL: cache-eerst; ontbreekt hij, dan netwerk en bewaren; een CDN-host buiten `cdnVast` → `null`.
  - Fonts: `stale-while-revalidate` (oude kopie direct, vers bewaard erna) in `externNaam`.
  - `installeer`: `addAll(shell)` faalt de installatie bij één 404; de CDN's gaan via `allSettled` en een onbereikbare CDN laat de installatie slagen.
  - `activeer`: verwijdert caches die niet `cacheNaam` of `externNaam` heten.
- [ ] **Step 2: `public/sw-strategie.js` (GREEN).** UMD-omhulsel (`self.SwStrategie` of `module.exports`); alle beslissingen hierin, geen directe globals (alles geïnjecteerd).
- [ ] **Step 3: `public/sw.js` dun maken.** `CACHE_NAME` blijft `'blitz-planning-v25'`; `EXTERN_CACHE = 'blitz-extern-v1'`; SHELL ongewijzigd (plus `/js/kern/netwerk.js` uit T2); `CDN_VAST` (Leaflet js + css, signature_pad, ExcelJS); `FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']`; `NAV_TIMEOUT_MS = 0` (standaard UIT, Q5) en `navTimeout` uit `new URL(self.location).searchParams` (alleen gehele getallen 0–30000, anders de constante); events delegeren naar de strategie, `skipWaiting` en `clients.claim` blijven; `fetch`-event: `const r = strategie.behandel(e.request); if (r) e.respondWith(r)`. Het T20-commentaar over Background Sync blijft staan. **`CACHE_NAME` niet wijzigen.**
- [ ] **Step 4: Registratie.** `app.js`: `register('/sw.js', { updateViaCache: 'none' })`.
- [ ] **Step 5: Consistentietests (RED → GREEN, `tests/sw-schil.test.mjs`).** N16 (a) elke `SHELL`-regel bestaat in `public/`; (b) elk `.js` onder `public/js` en `.css` onder `public/css` staat in SHELL; (c) `CDN_VAST` is gelijk aan de externe `<script src>`/`<link href>` van `index.html` plus de ExcelJS-constante uit `excel-export.js`; `CACHE_NAME === 'blitz-planning-v25'` (bewaakt N19 tot de release; de test wordt bij de bump van etappe 9 bewust aangepast).
- [ ] **Step 6: Draai alles.** Commit: `feat(sw): sw-strategie.js — CDN-cache, fonts, navigatie-time-out (uit) en consistentietests (etappe 7)`; CHANGELOG (Changed): "De service worker bewaart ook Leaflet, de handtekeningbibliotheek en de Excel-bibliotheek, zodat de app ook zonder verbinding de kaartbibliotheek heeft."

---

## Task 5: SW-testproject, guard en SW-specs (N4, N14, N15, N21)

**Model: sonnet.** Het veiligheidsnet van de suite: elke fout hier kan een extern verzoek betekenen.

**Feasibility (gecontroleerd, met proeven):**
- Playwright 1.63 + `serviceWorkers: 'allow'`: registratie, `ready`, `controller`, 55 cachebestanden werkten; `context.route` ziet SW-verzoeken (`request.serviceWorker()`); `/api`-verzoeken komen van de pagina; `context.setOffline(true)` laat de app uit de cache starten; `--host-resolver-rules` werkt als `launchOptions.args`.
- `playwright.config.mjs`: `testMatch: '*.spec.mjs'` matcht ook onder submappen (97 productietests draaien); een tweede project vraagt `testIgnore` op `chromium` en een eigen `testMatch`/`use` op `sw`; de `webServer` (poort 3338) is gedeeld.
- Guard (`tests/e2e-import-guard.test.mjs`): `productie = pad.startsWith('e2e/productie/') || pad.startsWith('e2e/productie-')`; het woord `serviceWorkers` is enkel in `PRODUCTIE_FIXTURES` toegestaan. Een derde klasse `e2e/sw/` + `e2e/sw-hulp.mjs` past in dezelfde structuur (importtabel, fixtureset, zelftests).
- `productie-hulp.mjs` exporteert `test` met `serviceWorkers: ['block', { option: true }]` als overschrijfbare optie; `sw-hulp.mjs` kan er met `basis.extend({ serviceWorkers: ['allow', …] })` overheen.

**Files:** `playwright.config.mjs`, `e2e/sw-hulp.mjs` (nieuw), `e2e/sw/installatie.spec.mjs`, `e2e/sw/offline.spec.mjs`, `e2e/sw/traag.spec.mjs`, `e2e/sw/geen-api.spec.mjs`, `e2e/sw/update.spec.mjs` (nieuw), `e2e/fixtures/sw-v25-main.js` (bevroren kopie van `git show main:public/sw.js`), `tests/e2e-import-guard.test.mjs`, `tests/e2e-vangnet.test.mjs` (indien de regels uitbreiden).

- [ ] **Step 1: Guard RED.** Breid `controleer()` uit met de klasse `sw` (pad begint met `e2e/sw/` of is `e2e/sw-hulp.mjs`): alle productieregels gelden (geen `?test`/`X-Blitz-Test`, geen eigen routes, geen netwerkmodules, geen `fetch(`, geen `waitForTimeout`, geen `test.use`/`test.extend`, geen `browser.`), importeren enkel `../sw-hulp.mjs`; het fixturebestand `e2e/sw-hulp.mjs` mag `@playwright/test` niet importeren maar enkel `./productie-hulp.mjs`; de woorden `serviceWorkers` en `setOffline` zijn enkel in `e2e/sw-hulp.mjs` toegestaan (`PRODUCTIE_FIXTURES` krijgt het bestand erbij voor routes). Zelftests (RED eerst): een sw-spec met `?test`, `page.route`, `serviceWorkers`, `setOffline`, `fetch(`, `waitForTimeout` of een import uit `../helpers.mjs` faalt; de fixture zelf slaagt.
- [ ] **Step 2: Config.** Project `chromium` krijgt `testIgnore: 'sw/**'`; project `sw` (`testMatch: 'sw/**/*.spec.mjs'`, `use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow', launchOptions: { args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE cdnjs.cloudflare.com, EXCLUDE cdn.jsdelivr.net'] } }`). Controleer dat `npx playwright test --list` in project `chromium` precies de huidige 412 + de nieuwe niet-SW-tests toont en dat de SW-specs er niet in staan.
- [ ] **Step 3: `e2e/sw-hulp.mjs`.** `test = basis.extend({ serviceWorkers: ['allow', { option: true }], … })` met: `startAppMetSw(page, opties)` (via `startAppProductie` met `klok: false`, wacht op `navigator.serviceWorker.ready` en een controlerende SW na een herlading), een waarnemer-route (`route.fallback`) die `request.serviceWorker()` per verzoek noteert (`swVerzoeken`), de verkeersregels `hangVoor(patroon)`, `vertraag(patroon, ms)`, `herstel()` (routes in de fixture), `zetOffline(page, aan)`, `registreerSwMetNavTimeout(page, ms)` (unregister + `register('/sw.js?navTimeout=<ms>')`) en `serveerOudeSw(page)`/`serveerNieuweSw(page)` voor het updatepad. Een `afterEach`-vangnet: geen `/api`-verzoek of niet-GET van de SW, geen SW-bestemming buiten de eigen host, de twee CDN's en de fonthosts, plus alle vangnetten van `productie-hulp` (die ook de SW-verzoeken zien).
- [ ] **Step 4: Specs.**
  - `installatie.spec`: na het eerste bezoek bevat `blitz-planning-v25` alle SHELL-bestanden (SHELL uit `public/sw.js` gelezen met `node:fs`) en `blitz-extern-v1` de CDN-URL's; `/api` is nergens gecachet.
  - `offline.spec` (N21): na één online bezoek `zetOffline(true)`, herladen: de app start (6 tabs, `#cnt-tickets` bestaat, offline-balk zichtbaar), `typeof L === 'object'` (Leaflet uit de extern-cache), `serviceWorker`-verzoeken naar de eigen server nul (alles uit de cache); online terug: de balk verdwijnt.
  - `traag.spec`: met `registreerSwMetNavTimeout(500)` en `hangVoor('/')`: de navigatie levert de app uit de cache binnen 4 s echt-tijd; zonder de queryparameter (standaard 0) volgt de pagina het netwerk (de navigatie is na 3 s nog niet afgerond).
  - `geen-api.spec`: een volledige opstart + een inplanactie: geen enkel `/api`-verzoek komt van de SW (`swVerzoeken`), geen niet-GET van de SW.
  - `update.spec` (N4): eerst `serveerOudeSw` (de bevroren v25-kopie), laden, wachten tot actief; dan `serveerNieuweSw`, `registration.update()`: de nieuwe SW neemt over (`clients.claim`), `/js/kern/netwerk.js` zit nu in de cache, `caches.keys()` is `['blitz-planning-v25', 'blitz-extern-v1']` (na de bump van etappe 9 wordt de verwachting de nieuwe naam: de test leest `CACHE_NAME` uit `public/sw.js`), de app werkt offline daarna.
- [ ] **Step 5: Bewijs van het vangnet.** Een RED-demonstratie in het ledger: tijdelijk een SW-spec met een verzoek naar een niet-toegestane host faalt (of door `--host-resolver-rules` met een netwerkfout eindigt), en de guard-zelftests tonen de nieuwe klasse. Draai `npx playwright test --project=sw --repeat-each=3`, `npx playwright test --project=chromium` en `node --test`. Commit: `test(sw): service worker-testproject met zes sloten, guard-uitbreiding en SW-specs (etappe 7)`.

---

## Task 6: Schrijfpaden — onzeker resultaat en verouderde cache (N7, N8)

**Model: sonnet.** Raakt W11-paden: minimaal en met diff `-w --color-moved`.

**Feasibility (gecontroleerd):**
- Alle plekken zijn één `catch`/terugdraaitak: `planacties.js` `addTicketToDate` (`catch` na de rollback, regels ~99-109) en `removeTicketFromDate` (regels ~158-165), `ticketdetail.js` `saveReschedule` (~296) en `saveToewijzen` (~383), `route.js` de `plan-datum`-lus in `applyRouteOrder` (~758-770, roept al `afh.loadTickets({ stilleToast: true })` aan), `beschikbaarheid.saveAvailability`, `afspraken.saveAfspraken`, `klantbeschikbaarheid.saveKlantBeschikbaarheid`.
- `loadTickets` (`app.js:543-575`) past `loadFromCache('blitz_tickets_cache')` bij elke aanroep toe; een module-variabele en twee opties volstaan. De drie lezers (`loadAvailability`, `loadAfspraken`, `loadKlantBeschikbaarheid`) hebben dezelfde cache-eerst-opbouw (bovenaan de functie).
- De rollback van de aanroepers gebeurt in de continuatie direct na het `return false`/`'fout'` van de save-functie; een `setTimeout(…, 0)` binnen de save-functie loopt dus ná die rollback (onder de nepklok: `runFor(1)`).
- `planacties.js` kent `inFlightTickets` (privé) en `route.js` `routeOrderBezig()`: de samengevoegde resync kan beide controleren (net als de poll: `app.js:741`).
- Productietest-patroon: `productie/planning.spec.mjs` heeft voor `plan` al foutscenario's met payload-asserties.

**Files:** `public/js/app.js`, `planacties.js`, `ticketdetail.js`, `route.js`, `beschikbaarheid.js`, `afspraken.js`, `klantbeschikbaarheid.js`, `public/js/kern/api.js` (alleen import), `e2e/productie/verbinding.spec.mjs`, `tests/…` (loader-opties indien puur te toetsen).

- [ ] **Step 1: P1 omdraaien (N8, H1).** RED: de pin uit T1 flipt naar de verwachte stand (X blijft gepland in route en niet in de wachtrij na een mislukte "Vernieuwen"). `loadTickets({ stilleToast = false, stil = false, zonderCache = false } = {})`: een module-variabele `_eersteLading`; de cache wordt enkel toegepast als `_eersteLading` waar is en `zonderCache` onwaar; daarna `_eersteLading = false`. Een geslaagde lading zonder wijziging hertekent niet (bestaand). `stil` onderdrukt ook de foutmelding van de herlading zelf (de aanroeper heeft de zijne al getoond). Test: opstart met cache blijft werken (offline start); poll en "Vernieuwen" passen de cache niet toe.
- [ ] **Step 2: Gedeelde resync (H3).** In `planacties.js` een privé `planResync()`: coalescerend (300 ms), roept `afh.loadTickets({ stil: true, zonderCache: true })` alleen als `inFlightTickets.size === 0` en `!route.routeOrderBezig()` (anders opnieuw proberen na de volgende ronde, hoogstens 3×). Export `vraagResyncNaOnzeker(err)`: `if (leesFout(err).onzeker) planResync()`. Eén regel in elke `catch` van de vier plan-paden (`addTicketToDate`, `removeTicketFromDate`, `saveReschedule`, `saveToewijzen`) na de bestaande rollback en toast; `autoPlan` krijgt niets (zijn lus roept `addTicketToDate`; de coalescer geeft één herlading na de reeks). `route.js`: in de bestaande `catch` van de `plan-datum`-lus de herlading van `{ stilleToast: true }` naar `{ stilleToast: true, zonderCache: true }` (H4).
- [ ] **Step 3: Tests per scenario (RED → GREEN, productiemodus, payloads geasserteerd).** P4: `plan` met `afbreken` na opname → rollback, daarna precies één extra `GET /api/tickets` (zonder cache), en het ticket staat in de stub-toestand van de server als gepland → de UI toont het als gepland; hetzelfde voor een 504-antwoord (HTML) en voor een time-out (`runFor`); geen resync bij een 400-antwoord of een JSON-fout van de functie; "Plan deze week" met drie tickets waarvan twee afbreken: één herlading; geen herlading terwijl een ander ticket nog in flight is. `removeTicketFromDate`, `saveReschedule`, `saveToewijzen` elk één geval. H4: de lus faalt bij stop 2 van 3: toast "Volgorde bewaren mislukt voor #n", herlading zonder cache, UI = serverstand.
- [ ] **Step 4: Spookschrijf (H5, P5 omdraaien).** `saveAvailability`, `saveAfspraken`, `saveKlantBeschikbaarheid` roepen bij `leesFout(err).onzeker` (of `reden: 'netwerk'`) in een `setTimeout(…, 0)` hun lader aan met `{ zonderCache: true }` (de lader krijgt die optie: de cache-eerst-tak wordt overgeslagen). P5: na de afgebroken schrijf (server heeft hem) toont de UI na `runFor(1)` het item en een volgende schrijf geeft geen 409. Geen resync bij een 409 of 4xx (bestaande afhandeling).
- [ ] **Step 5: Bewijs.** Alle productietests van 5a/5b ongewijzigd groen (`npx playwright test e2e/productie`), `--repeat-each=3` op de nieuwe, `git diff -w --color-moved` van `planacties.js`/`ticketdetail.js`/`route.js` in de commitbody (enkel de toegestane regels). Commits (aparte, benoemde): `fix(tickets): verouderde cache niet meer toepassen bij verversen (etappe 7)`, `fix(verbinding): synchroniseren na een onzeker resultaat bij plannen en opslaan (etappe 7)`; CHANGELOG (Fixed): "Na een weggevallen verbinding tijdens plannen of opslaan klopt het scherm weer met Zoho; een verversing zet geen verouderde gegevens meer terug."

---

## Task 7: Focus na Escape (N11)

**Model: sonnet.** Logica in `venster.js`, geen datarisico.

**Feasibility (gecontroleerd):**
- `venster.js` `registreer({ el, isOpen, sluit })` onthoudt `vorigeFocus` bij openen en zet hem terug bij sluiten als hij zichtbaar is; de vier gevallen zijn de gepinde `huidig: true`-regels in `e2e/vensters.spec.mjs` (34–47): `proposal-overlay` en `prijs-overlay` (opener zit in een venster dat stil sluit), `local-det-overlay` (opener is een niet-focusbare `div.cal-local-event`) en `result-overlay` (knop `#btn-autoplan` is tijdens het plannen uitgeschakeld).
- `kalender.js:130` bouwt de lokale afspraakkaart als `div`; `maakActiveerbaar(el, handler, label)` (`kern/ui.js:92`) bestaat en wordt voor de ticketkaarten gebruikt (`kalender.js:103`, `480`). De klik op de kaart opent het detail via de bestaande luisteraar.
- Registraties: `voorstel.js:33`, `instellingen.js:42` (prijsOverlay), `planacties.js:36`, `afspraken.js:47` (lus over drie overlays).
- `appDialogOpen()` en `bovenste()` blijven de bestaande randvoorwaarden.

**Files:** `public/js/venster.js`, `public/js/schermen/voorstel.js`, `instellingen.js`, `planacties.js`, `afspraken.js`, `kalender.js`, `e2e/vensters.spec.mjs`, `tests/…` (puur gedeelte indien afgesplitst).

- [ ] **Step 1: Pins omdraaien (RED).** In `vensters.spec.mjs` de vier `huidig: true`-regels vervangen door de verwachte plaats: `proposal-overlay` → de opener van het detail (de kaart waarmee het detail opende; als die er niet meer is, de bovenste actieve tab), `prijs-overlay` → de ⚙️-knop die de instellingen opende, `local-det-overlay` → de kaart zelf, `result-overlay` → `#btn-autoplan`. Het testtitelachtervoegsel `[HUIDIG GEDRAG…]` verdwijnt.
- [ ] **Step 2: `registreerVenster({ …, terugFocus })`.** Bij sluiten: is `vorigeFocus` onbruikbaar (weg, onzichtbaar of `<body>`), probeer eerst de erfenis, dan `terugFocus()`; pas daarna het bestaande venster-eronder-gedrag. **Erfenis:** wanneer venster A sluit en binnen 500 ms (echte tijd, `performance.now()`) venster B opent, en `document.activeElement` bij het openen `<body>` is, neemt B de opener van A over (`vorigeFocus` van A, mits zichtbaar). Registreer `terugFocus` voor `result-overlay` (`#btn-autoplan`). Het resultaatvenster opent nadat de knop opnieuw ingeschakeld is; de focus wordt pas teruggezet bij het sluiten.
- [ ] **Step 3: Lokale afspraakkaart.** `kalender.js`: `maakActiveerbaar(card, () => <de bestaande klikactie>, 'Open afspraak <titel>')` met de bubbel-guard intact (een klik op `[data-actie]` opent niets).
- [ ] **Step 4: Controle.** Alle 14 vensters in `vensters.spec.mjs` groen (Tab-val, Escape, focus), de kalender- en ingepland-specs ongewijzigd groen, een a11y-steekproef: Enter/Space op de lokale afspraakkaart opent het detail. Commit: `fix(a11y): focus na Escape keert terug bij voorstel, prijsbeheer, afspraakdetail en planningsresultaat (etappe 7)`; CHANGELOG (Fixed): "Na Escape staat de focus weer op een logische plek in vier dialogen; lokale afspraken zijn met het toetsenbord te openen."

---

## Task 8: Antwoorden van Brent verwerken (spec §7)

**Model: sonnet.** **Voorwaardelijk**: dit taakonderdeel wordt enkel uitgevoerd voor de vragen waarop Brent "ja" (of een aangepaste tekst) antwoordde. Zonder antwoord blijft de code zoals na T7 (alle teksten ongewijzigd, `NAV_TIMEOUT_MS = 0`); de controller markeert de overgeslagen stappen in het ledger. De taak draait ná de eindreview-voorbereiding, niet eerder dan het antwoord.

**Feasibility (gecontroleerd):** `leesFout` (T2) is de enige plek die tekst kent; de callers tonen vandaag `err.message`; `NAV_TIMEOUT_MS` staat als één constante in `public/sw.js`; de klantmailpaden hebben al productietests (`productie/voorstel.spec.mjs`, `rapport.spec.mjs`, `annuleren.spec.mjs`) met toastasserties die dan bewust meegaan.

**Files:** `public/js/kern/api.js`, `public/js/schermen/voorstel.js`, `rapport-verzenden.js`, `excel-export.js`, `public/sw.js`, de bijbehorende productiespecs.

- [ ] **Q1 (klantmail):** de bevestigde zin toevoegen aan de foutmeldingen van `sendProposal` en `verstuurRapport` voor onzekere uitkomsten (`leesFout(err).onzeker` of 5xx), zoals `annuleren.js` (`onzeker`-vlag), met productietests (RED eerst) per pad.
- [ ] **Q2 (teksten en hint):** de bevestigde teksten in `leesFout.tekst` en op de call sites; bij "Trage verbinding"-melding een uitbreiding van de bestaande offline-balk (`#offline-banner`) na een `TimeoutError`, met een e2e.
- [ ] **Q3 (wizard):** enkel als Brent een D19-uitbreiding toestaat: een afzonderlijke, expliciet benoemde wijziging in `rapport-wizard.js` (waarschuwing bij mislukt laden van foto's en bij aanrijtijd 0), met wizard-e2e; anders niets.
- [ ] **Q4 (voorraad):** de bevestigde melding of herpoging in `inventaris.registreerVerbruik`, met test.
- [ ] **Q5 (SW-time-out):** `NAV_TIMEOUT_MS` op de bevestigde waarde (4000), de SW-spec `traag.spec` zonder queryparameter aanpassen, item (3) van de release-checklist (N5) invullen.
- [ ] Draai alles; commit per vraag; CHANGELOG-regels.

---

## Task 9: Afronding

**Model: sonnet** (docs plus draaien en herhalen van meting en suites).

**Feasibility (gecontroleerd):** `CLAUDE.md` heeft de secties "Tests", "Productiemodus-tests", "Schermen" en "Kern" waar de wijzigingen in passen; `CHANGELOG.md` heeft de sectie "Refactor-tak — nog niet uitgebracht"; `scripts/meet-laden.mjs` is herdraaibaar.

**Files:** `CLAUDE.md`, `CHANGELOG.md`, ledger.

- [ ] **Step 1: Meting "na".** Draai `scripts/meet-laden.mjs` (koud en warm, 0/150/400 ms); zet voor/na-tabel en de wizard-parsetijd in het ledger.
- [ ] **Step 2: CLAUDE.md.** Onder "Tests": het project `sw` (hoe te draaien, waarom apart, de zes sloten, `--host-resolver-rules`, geen `?test`, `serviceWorkers`/`setOffline` enkel in `e2e/sw-hulp.mjs`), de aantallen. Onder "Kern": `netwerk.js` (tijden, hoe een aanroeper een eigen `signal` meegeeft), `leesFout`. Onder "Schermen": `terugFocus` en de erfenis in `registreerVenster`; het slepen-door-render-gedrag onder "Gedocumenteerd restant" (N12); lazy `excel-export.js`. Een nieuwe sectie "Service worker": strategie, `sw-strategie.js`, `NAV_TIMEOUT_MS`, `CACHE_NAME` niet op `refactor`, SHELL-test, `?navTimeout`.
- [ ] **Step 3: CHANGELOG** (Refactor-tak): Added (modulepreload, CDN-cache, SW-tests), Changed (lazy Excel), Fixed (de regels uit T2, T6, T7).
- [ ] **Step 4: Release-checklist overnemen.** Kopieer spec N5 naar het ledger onder "Voor etappe 9" en naar `docs/superpowers/specs/…etappe7…` §3 (staat er al); controleer dat het item "CACHE_NAME-bump + SW-updatepad" en "NAV_TIMEOUT_MS conform Q5" erin staat.
- [ ] **Step 5: Eindcontrole.** `node --test`, `npx playwright test --project=chromium`, `npx playwright test --project=sw`, `--repeat-each=3` op alle nieuwe specs; `git diff c37c92e..HEAD -- public/js/rapport-wizard.js public/js/outbox.js` leeg; `CACHE_NAME` v25; `git diff c37c92e..HEAD --stat -- package.json` leeg; het vangnetbewijs van T5 staat in het ledger. Aantallen in het ledger. Commit: `docs(technieker): CLAUDE.md, CHANGELOG en release-checklist voor etappe 7`.
