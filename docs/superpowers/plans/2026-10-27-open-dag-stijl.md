# Open dag-stijl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De hele app krijgt in één release (v2.5.0) de stijl "Open dag": glas altijd, zijkolom op pc, dok op gsm, gloeiende omtrek per urgentie, glans bij hover, een hemel die het uur volgt; de werking verandert niet.

**Architecture:** Aanpak 2 uit de spec: de bestaande opmaak wordt omgevormd waar ze staat. De DOM blijft grotendeels gelijk: `.topbar-sticky > header` wordt de kop (pc: paginakop met titel en samenvatting), de bestaande `.tabs`/`.tabs-inner`/`.tab` wordt met CSS een vaste zijkolom (`breed`) of een vast dok (`smal`, `tablet-staand`). Nieuwe stukken zijn kleine modules met een pure logica-helft (unit-getest) en een DOM-helft: hemel, tabiconen, "Meer"-blad, paginakop.

**Tech Stack:** Vanilla ES-modules, CSS custom properties, `backdrop-filter`, Google Fonts (Bricolage Grotesque + Figtree), `node --test`, Playwright (projecten `chromium` en `sw`).

**Spec:** `docs/superpowers/specs/2026-10-27-open-dag-stijl-design.md` (lees ook de sectie "Beslissingen na de bouwerscheck"). Mockup: `docs/superpowers/specs/assets/2026-10-27-open-dag-mockup.html`, kaart "Keuze" (= opbouw `data-versie="2"`, `data-hover="glans"`, `data-gloed="omtrek"`); de CSS-tokens daar zijn het vertrekpunt.

## Global Constraints

- Werking ongewijzigd: geen wijziging aan id's, klassen, `data-actie`/`data-arg`, ARIA-rollen of volgordes die JS of tests gebruiken; enkel opmaak plus de nieuwe elementen uit dit plan.
- Kleuren: Blitz-groen `#00dfa3` blijft het accent; statuskleuren (`--red`, `--orange`, `--green`, ...) worden nooit overschreven; gloed via eigen tokens afgeleid met `color-mix`.
- Letters: Bricolage Grotesque 500/700 (titels) + Figtree 400/500/600/700 (tekst), Google Fonts, `display=swap`; Inter verdwijnt.
- Contrast: elke tekst op glas ≥ 4,5:1 over wat er echt achter ligt (4 tijdstippen × licht/donker, en de 9 thema's).
- Snelheid: niet merkbaar trager dan v2.4.x; terugvalvolgorde op gsm = eerst vervaging 10 px, dan geen `backdrop-filter` op lijstkaarten (dok, kop, vensters houden hem).
- Knoppen: geen `transform` in `:hover`-regels; hover = vervagen (achtergrond/rand/kleur ± 0,28 s, glans ± 0,4 s).
- Gsm-kop: niets verbergen; volgorde van wijken op 360 px: tekst "Blitz Planning" → randen icoonknoppen → TEST-badge klein boven het logo; nooit tweede regel, nooit horizontaal scrollen.
- Dok: meer dan 5 zichtbare tabbladen → 4 + "Meer"; de echte `.tab`-knoppen blijven in `.tabs-inner`.
- Projectregels (CLAUDE.md): nieuw bestand onder `public/js/` of `public/css/` → zelfde commit in `SHELL` van `public/sw.js` (+ modulepreload als eager, na de stijlbladen); geen `onclick=`; `koppelRenders()` is de enige plek voor toestand-abonnementen; tijd-tests zetten `process.env.TZ = 'Europe/Brussels'`; `node --test` zonder pad.
- Containing block: `.topbar-sticky`, `header` en `nav` mogen GEEN `backdrop-filter`, `filter`, `transform` of `contain` krijgen (de vaste zijkolom, het dok en de persoonkiezer zitten erin en zouden dan aan hun ouder vastzitten); vervaging van de kop via een `::before`-laag.

## Review Focus

1. Beheerder wisselt van werkruimte (Techniek ↔ Sales) op een gsm: dok en "Meer" moeten de nieuwe tabvolgorde volgen → test in Task 6.
2. Weergave handmatig wisselen (`window.zetWeergave`) zonder herladen: zijkolom ↔ dok meteen, `--dok-h` mee, niets onder het dok → test in Task 5.
3. Offline- of outbox-balk zichtbaar op gsm en pc: balk niet onder de kop of naast de zijkolom verstopt, laatste kaart niet onder het dok → test in Task 7.
4. Venster met knoppen onderaan (ticketdetail) op gsm: het dok bedekt de knoppen niet → test in Task 8.
5. Toestel uit slaap na de nacht (pagina verborgen bij een tijdsgrens): hemel klopt meteen bij terugkeer → test in Task 2.

---

### Task 0: Werkruimte

- [ ] **Step 1:** Maak met `superpowers:using-git-worktrees` een worktree met tak `feat/open-dag`, vertrekkend van de tak die v2.4.0 (meldgrens) bevat: `main` als die al gemerged is, anders `feat/voorraad-drempel`. Controleer met `git -C <worktree> branch --show-current` dat je op `feat/open-dag` staat (geheugen: subagents committen soms in de hoofdcheckout).
- [ ] **Step 2:** Zet spec, mockup en dit plan in de worktree als ze er nog niet staan, `npm install` indien nodig, draai `node --test` (verwacht: alles groen) en commit: `docs: ontwerp en bouwplan Open dag-stijl`.

### Task 1: Tokens, glas-basis en letters

**Files:**
- Modify: `public/css/base.css` (`:root` en `[data-theme="light"]`), `public/index.html:14` (Google Fonts-link), `public/index.html:16-51` (inline bootstrap: enkel als hij een lettertype noemt)
- Test: `tests/open-dag-tokens.test.mjs` (nieuw)

**Interfaces:**
- Produces (CSS-tokens op `:root`, licht en donker): `--glas`, `--glas-hover`, `--glas-sterk`, `--glas-venster`, `--glas-rand`, `--glas-rand-hover`, `--glas-licht`, `--blur`, `--glas-schaduw`, `--knop2`, `--knop2-hover`, `--veld`, `--r-kaart` (22px), `--r-venster` (28px), `--r-ev` (16px), `--r-pil` (999px), `--font-tekst` ('Figtree', system-ui, …), `--font-kop` ('Bricolage Grotesque', 'Figtree', …), `--gloed-rood`, `--gloed-oranje`, `--gloed-groen`, `--gloed-paars`, `--duur` (.28s), `--duur-glans` (.4s). Waarden donker/licht: de mockup (`.app` en `.app[data-modus="licht"]`).
- `html[data-apparaat="gsm"]` zet `--blur: 10px` en een hogere glasdekking; `@media (prefers-reduced-transparency: reduce)` en `@supports not (backdrop-filter: blur(1px))` zetten `--blur: 0px` en een dekking ≥ 94 %.

- [ ] **Step 1: Failing test** — `tests/open-dag-tokens.test.mjs`: leest `base.css` en `index.html` als tekst.
  - `test('base.css definieert alle Open dag-tokens in donker')`: voor elke tokennaam hierboven `assert.match(css, new RegExp('--' + naam + '\\s*:'))` binnen het eerste `:root {…}`-blok.
  - `test('licht thema herdefinieert de glastokens')`: het `[data-theme="light"]`-blok bevat `--glas:`, `--glas-rand:`, `--knop2:`.
  - `test('gsm krijgt minder vervaging')`: `assert.match(css, /html\[data-apparaat="gsm"\][^{]*\{[^}]*--blur:\s*10px/)`.
  - `test('verminderde transparantie zet de vervaging uit')`: `prefers-reduced-transparency: reduce` met `--blur: 0px`.
  - `test('letters: Figtree en Bricolage, geen Inter')`: `index.html` bevat `family=Bricolage+Grotesque` en `family=Figtree` en `display=swap`, niet `family=Inter`.
- [ ] **Step 2:** `node --test` → FAIL op de nieuwe test.
- [ ] **Step 3:** Voeg de tokens toe in `base.css`, zet `html, body { font-family: var(--font-tekst) }`, vervang de Inter-link door één `css2`-link met beide families. Bestaande tokens (`--surface`, `--bg`, …) blijven bestaan (andere bladen gebruiken ze); stem hun waarden af op de hemel (donker: `--bg` dicht bij de nachthemel, licht: dicht bij de middaghemel).
- [ ] **Step 4:** `node --test` → PASS (ook `tests/sw-schil.test.mjs`: preconnect en `fonts.googleapis.com/css2` blijven).
- [ ] **Step 5:** Commit `feat(stijl): Open dag-tokens en letters`.

### Task 2: Hemel

**Files:**
- Create: `public/js/kern/hemel.js` (puur), `public/js/schermen/hemel-laag.js` (DOM), `public/css/hemel.css`
- Modify: `public/index.html` (`<div id="hemel" aria-hidden="true"></div>` als eerste kind van `<body>`; `<link rel="stylesheet" href="/css/hemel.css">` bij de andere stijlbladen, vóór de modulepreloads; modulepreloads voor beide modules), `public/sw.js` (`SHELL`), `public/js/app.js` (`startHemel()` in `DOMContentLoaded`, vóór `koppelRenders`)
- Test: `tests/hemel.test.mjs`, `e2e/hemel.spec.mjs`

**Interfaces:**
- Produces: `tijdstipVoor(datum: Date) → 'ochtend'|'middag'|'avond'|'nacht'` (uur in Europe/Brussels via `Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: 'numeric', hourCycle: 'h23' })`); `TIJDSTIPPEN` (de vier waarden). `startHemel({ nu = () => new Date() } = {}) → void`: zet `data-hemel` op `<html>`, herberekent elke 60 s (overslaan als `document.hidden`) en bij `visibilitychange` naar zichtbaar; eenmalig geregistreerd.
- CSS: `#hemel { position: fixed; inset: 0; z-index: -2; pointer-events: none }` met de verlopen per `html[data-hemel=…]` en `[data-theme="light"]` uit de mockup (`--h1/--h2/--h3/--horizon/--zon/--zon-x/--zon-y/--sterren`); `html[data-event-achtergrond="ja"] #hemel { display: none }`; `@media print { #hemel { display: none } }`; `body` krijgt `background: transparent` boven de hemel (de effen `--bg` blijft als terugval op `html`).

- [ ] **Step 1: Failing tests** — `tests/hemel.test.mjs` (`process.env.TZ = 'Europe/Brussels'` bovenaan):
  - grenzen: `04:59 → 'nacht'`, `05:00 → 'ochtend'`, `09:59 → 'ochtend'`, `10:00 → 'middag'`, `16:59 → 'middag'`, `17:00 → 'avond'`, `20:59 → 'avond'`, `21:00 → 'nacht'` (data als `new Date('2026-10-27T05:00:00+01:00')` enz.).
  - zomertijd: `new Date('2026-07-01T03:30:00Z')` (= 05:30 in Brussel) → `'ochtend'`; wintertijd `new Date('2026-12-01T04:30:00Z')` (= 05:30) → `'ochtend'`.
  - onafhankelijk van de TZ van het proces: zelfde resultaat met `process.env.TZ = 'UTC'` in een tweede bestand of via een expliciete `Date`-instant.
- [ ] **Step 2:** `node --test` → FAIL.
- [ ] **Step 3:** Implementeer `kern/hemel.js`, `schermen/hemel-laag.js`, `css/hemel.css`, de markup en de SW-/preload-regels.
- [ ] **Step 4:** `node --test` → PASS (ook `sw-schil`: preload-graaf, `SHELL`).
- [ ] **Step 5: e2e** — `e2e/hemel.spec.mjs` (fixture `./helpers.mjs`):
  - `hemel volgt het uur`: `startApp(page)` (VASTE_NU = 09:00) → `html[data-hemel="ochtend"]`; `page.clock.fastForward('01:01:00')` → `"middag"`.
  - `hemel klopt meteen na terugkeer (Review Focus 5)`: zet `document.hidden` via `page.evaluate(() => Object.defineProperty(document, 'hidden', { value: true, configurable: true }))`, `fastForward` voorbij 17:00, minuut laten lopen → nog `"middag"`; daarna `hidden` terug op `false` en `document.dispatchEvent(new Event('visibilitychange'))` → `"avond"`.
  - `thema met achtergrond vervangt de hemel`: `startApp(page, { query: '?test&versiering=aan', overschrijf: { themas: … } })` zoals `e2e/versiering.spec.mjs` → `#hemel` heeft `display: none`.
  - `print toont geen hemel`: `page.emulateMedia({ media: 'print' })` → `#hemel` niet zichtbaar.
- [ ] **Step 6:** `npx playwright test e2e/hemel.spec.mjs --project=chromium` → PASS. Commit `feat(stijl): hemel volgt het uur`.

### Task 3: Glas en kaarten met gloeiende omtrek

**Files:**
- Modify: `public/css/app.css` (`.ticket` 241-275, `.cal-ticket` 520-541, `.cal-local-event` 565-586, `.stop` 724-734, `.kal-header` 359+), `public/css/inventaris.css` (`.inv-row`), `public/css/sales.css` (sales-kaarten en -rijen), `public/css/evenement.css` (130-210: het themaglas gaat op in de algemene regel)
- Test: `tests/open-dag-kaarten.test.mjs`, `e2e/glas-kaarten.spec.mjs`; bijwerken: `e2e/versiering.spec.mjs` (`controleerKaarten` 465: verwachte alpha en `blur(…)`)

**Interfaces:**
- Consumes: tokens uit Task 1.
- Produces: klasse-onafhankelijke regel "glaskaart" = `background-color: var(--glas)`, `backdrop-filter: blur(var(--blur)) saturate(180%)`, `border: 1px solid var(--glas-rand)`, `border-radius: var(--r-kaart)`, `box-shadow: inset 0 1px 0 var(--glas-licht), var(--gloed-schaduw, 0 0 0 transparent), var(--glas-schaduw)`, `background-image: var(--gloed-beeld, none)`; urgentie via `--gloed` op de kaart: `.ticket.overdue` en prioriteit hoog → `--gloed-rood`; middel en "wacht op bevestiging" → `--gloed-oranje`; laag en bevestigd → `--gloed-groen`; eigen afspraak → `--gloed-paars`. Omtrek-recept uit de mockup (`[data-gloed="omtrek"] .gloeit`). Welke klasse de prioriteit draagt: gebruik wat `wachtrij.js` en `kalender.js` nu al zetten (`overdue`, `prtag.high/medium/low`, `stag.pending/confirmed`); ontbreekt een klasse op de kaart zelf, voeg dan één `data-urgentie="rood|oranje|groen|paars"` toe bij het renderen (enkel attribuut, geen gedrag).

- [ ] **Step 1: Failing tests** — `tests/open-dag-kaarten.test.mjs`: de oude linkerbalk is weg (`.ticket::before` en `.ticket.overdue::before` zetten geen `background` meer met `var(--red)`); `evenement.css` bevat geen `backdrop-filter` meer binnen een `[data-event-achtergrond="ja"]`-selector voor de kaarten (het glas is algemeen).
  `e2e/glas-kaarten.spec.mjs`:
  - `kaarten zijn glas op pc`: `getComputedStyle(#view-tickets .ticket).backdropFilter` bevat `blur(28px)`; `borderRadius === '22px'`.
  - `gsm: minder vervaging`: `blitz_weergave = 'gsm'`, viewport 375×812 → `blur(10px)` (of `none` na de terugval van Task 10; houd de assert in één helper die Task 10 aanpast).
  - `verlopen ticket gloeit rood`: de `borderTopColor` van `.ticket.overdue` ≠ die van een ticket met lage prioriteit, en bevat een roodtint (R > G en R > B).
  - `afspraak in de kalender gloeit volgens status` (pending → oranje-tint).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementeer. Dichtheid (spec): wachtrijkaarten op `breed` padding 15px 18px en tussenruimte 10px; op `smal` 18px 20px, tussenruimte 12px, hoeken 26px. Neem de themaspecifieke tekstkleuren uit `evenement.css` (de lichtere tekst op kaarten in donker, donkerder in licht, de eigen kleur voor losse rode tekst) over als algemene kaartregels; in `evenement.css` blijft enkel wat bij een thema hoort (scène, `--ev-*`, versiering).
- [ ] **Step 4:** Pas in `e2e/versiering.spec.mjs` de verwachte glaswaarden van `controleerKaarten` aan naar de nieuwe tokens, met commentaar `// Open dag (v2.5.0): glas is algemeen, waarden uit base.css`. De contrastdrempel 4,5:1 blijft.
- [ ] **Step 5:** `node --test` en `npx playwright test e2e/glas-kaarten.spec.mjs e2e/versiering.spec.mjs --project=chromium --grep-invert @contrast` → PASS. Commit `feat(stijl): glazen kaarten met gloeiende omtrek`.

### Task 4: Knoppen vervagen met glans

**Files:**
- Modify: alle hover-regels met `transform` (app.css 51, 220, 260-265, 302, 312, 328, 385, 399, 687, 696, 729, 756, 785, 823, 855, 863, 883, 1044, 540, 584; prijzen.css 22); `.btn` 867-942, `.hbtn` 40-52, `.btn-add`, `.person-btn`, `.gebruiker-btn` (1322); `base.css:140-150` (reduced-motion-lijst: de transform-uitzonderingen worden overbodig, laat de regel staan maar haal de verwijzingen naar verdwenen transforms weg)
- Test: `tests/open-dag-knoppen.test.mjs`, `e2e/knoppen-glans.spec.mjs`

**Interfaces:**
- Produces: klasse `glans`-gedrag op `.btn, .hbtn, .btn-add, .person-btn, .gebruiker-btn, .tab, .dok-meer` (en de legacy `.btn-primary/.btn-sec/.btn-cancel/.btn-save`): `position: relative; isolation: isolate; overflow: hidden` + `::before` met `radial-gradient(120% 140% at 50% -20%, rgba(255,255,255,.45), transparent 60%)`, `opacity: 0 → 1` bij `:hover`, `transition: opacity var(--duur-glans) ease`. Primair: verloop `#2df0bb → #00d49b`, donkere tekst; secundair: `var(--knop2)` glazen pil; gevaar: rode rand en tekst. Elementen die `::before` al gebruiken: controleer per selector; gebruik daar `::after` of sla de glans over en vervaag enkel de achtergrond.

- [ ] **Step 1: Failing tests** — `tests/open-dag-knoppen.test.mjs`: scan alle `public/css/*.css`; voor elke regel waarvan de selector `:hover` bevat, mag de declaratieblok geen `transform:` hebben met een andere waarde dan `none` → lijst de overtreders in de foutmelding.
  `e2e/knoppen-glans.spec.mjs`: `page.hover('.btn--primary')` (bv. in Instellingen) → na `page.waitForFunction` is `getComputedStyle(el, '::before').opacity === '1'` en `getComputedStyle(el).transform === 'none'`; idem voor `.hbtn[data-actie="vernieuw"]`.
- [ ] **Step 2:** Run → FAIL (overtreders opgesomd).
- [ ] **Step 3:** Implementeer; `:active` mag een kleurwijziging geven, geen transform.
- [ ] **Step 4:** `node --test` en de nieuwe spec → PASS. Commit `feat(stijl): knoppen vervagen met glans`.

### Task 5: Navigatie — zijkolom op pc, dok op gsm, tabiconen

**Files:**
- Create: `public/js/kern/tab-iconen.js`, `public/css/navigatie.css`
- Modify: `public/index.html` (in `<nav>` vóór `.tabs-inner`: `<div class="zijkolom-logo">` met het bestaande bliksemlogo en "Blitz Planning"; stijlblad-link), `public/js/app.js` (bij de opstart `zetTabIconen(document)`), `public/js/schermen/rol-schil.js:47-74` (`maakTab` roept `zetTabIconen` voor de nieuwe knop), `public/css/app.css` (`.tabs`, `.tab`, `.tabs::after` 120-170: onderlijn verbergen; `#person-sel` op `breed` vast onderaan de zijkolom), `public/js/sticky-offset.js` (`--dok-h`), `public/sw.js`
- Test: `tests/tab-iconen.test.mjs`, `e2e/navigatie.spec.mjs`; bijwerken `tests/sticky-balken-css.test.mjs` (63-65: ook `--dok-h` vermelden)

**Interfaces:**
- Produces: `tabIcoonSvg(id: string) → string` (inline `<svg class="tab-icoon" aria-hidden="true" focusable="false">…</svg>`, lijnstijl 1,8; onbekende id → een neutraal rondje); `ICOON_IDS` = `['tickets','kalender','planning','gepland','inventaris','rapporten','beheer','sales-lijst','sales-kalender','sales-route','sales-afgewerkt']`; `zetTabIconen(wortel: ParentNode) → void` (voegt het icoon als eerste kind toe aan elke `.tab[data-arg]` zonder `.tab-icoon`; idempotent). Iconen: de mockup (`#i-wachtrij`, `#i-kalender`, `#i-route`, `#i-ingepland`, `#i-inventaris`, `#i-rapporten`, `#i-beheer`); Leads = lijst met persoon, Afgewerkt = vinkje in cirkel.
- CSS-variabelen: `--zijkolom-b: 256px` (228 + 2×14), `--dok-h` (gemeten door `sticky-offset.js`, 0 op `breed`).
- Opmaak: `html[data-indeling="breed"] .tabs { position: fixed; top: 14px; bottom: 14px; left: 14px; width: 228px }` (glas, hoeken 30 px, kolom); `body { padding-left: var(--zijkolom-b) }` op `breed`; `html:is([data-indeling="smal"],[data-indeling="tablet-staand"]) .tabs { position: fixed; left: 12px; right: 12px; bottom: calc(14px + env(safe-area-inset-bottom)) }` (glas, hoeken 30 px), tabs als icoon boven naam; `main { padding-bottom: calc(var(--dok-h) + 24px) }` op die indelingen. Actief tabblad = `var(--knop2-hover)` pil, icoon en teller groen. `updateTabIndicator` in `app.js` blijft ongewijzigd (de test `app-schil.spec.mjs:51-63` vergelijkt enkel de variabelen met de tab-box).

- [ ] **Step 1: Failing tests** — `tests/tab-iconen.test.mjs`: elke id in `ICOON_IDS` geeft een `<svg` met `aria-hidden="true"`; onbekende id geeft ook een `<svg`; `zetTabIconen` is idempotent (twee keer aanroepen op een nep-DOM met `linkedom` of een minimale stub → één icoon). Gebruik de bestaande DOM-stubstijl van de andere `tests/*.test.mjs`; is er geen DOM-hulp, test dan enkel `tabIcoonSvg`.
  `e2e/navigatie.spec.mjs`:
  - `pc: zijkolom links`: viewport 1366×768 → box van `.tabs`: `x < 20`, `width` 220-236, `height > 600`; elke zichtbare `.tab` bevat `svg.tab-icoon`; box van `.view.active` heeft `x >= 250`.
  - `gsm: dok onderaan`: `blitz_weergave='gsm'`, 375×812 → `.tabs`-box onderkant tussen 812-40 en 812; scroll `#view-kalender` (technieker) helemaal naar beneden → onderkant van het laatste item ≤ bovenkant van `.tabs`.
  - `tablet staand: dok`, `tablet liggend: zijkolom` (`blitz_weergave='tablet'`, 768×1024 en 1024×768).
  - `wisselen zonder herladen (Review Focus 2)`: start pc, `page.evaluate(() => window.zetWeergave('gsm'))` + viewport 375×812 → dok, `getComputedStyle(document.documentElement).getPropertyValue('--dok-h')` > 40px; terug `zetWeergave('computer')` + 1366×768 → zijkolom, `--dok-h` = 0px.
  - `elke rol ziet dezelfde tabbladen als voorheen`: per rol (`loginRol`: beheerder, planner, technieker, sales) de lijst van zichtbare `#tab-*`-id's gelijk aan een vaste verwachte lijst (neem de lijst over uit `rol-schil.js`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementeer. Let op de containing-block-regel uit Global Constraints.
- [ ] **Step 4:** `node --test`; `npx playwright test e2e/navigatie.spec.mjs e2e/app-schil.spec.mjs e2e/sales-schil.spec.mjs e2e/sticky-balken.spec.mjs e2e/kop-balken.spec.mjs --project=chromium` → PASS. Wat in `kop-balken.spec.mjs` faalt op vaste hoogtes of posities van de kop mag aangepast worden, met commentaar.
- [ ] **Step 5:** Commit `feat(stijl): zijkolom op pc, dok op gsm, tabiconen`.

### Task 6: "Meer" in het dok

**Files:**
- Create: `public/js/schermen/dok-meer-logica.js` (puur), `public/js/schermen/dok-meer.js` (DOM)
- Modify: `public/index.html` (in `.tabs`, na `.tabs-inner`: `<button type="button" class="dok-meer" aria-haspopup="dialog" aria-expanded="false" hidden>` met icoon en "Meer"; het blad `<div class="overlay dok-meer-overlay"><div class="dok-meer-blad" role="dialog" aria-label="Meer tabbladen"></div></div>`), `public/js/app.js` (`initDokMeer()` vóór `koppelRenders`), `public/css/navigatie.css`, `public/sw.js`
- Test: `tests/dok-meer.test.mjs`, `e2e/dok-meer.spec.mjs`

**Interfaces:**
- Produces: `dokVerdeling(ids: string[], actiefId: string|null, max = 5) → { inDok: string[], inMeer: string[], meerActief: boolean }` — `ids.length <= max` → alles in het dok; anders de eerste `max - 1` in het dok en de rest in "Meer"; `meerActief = inMeer.includes(actiefId)`. `initDokMeer() → void`: telt de zichtbare `.tabs-inner .tab` (niet `hidden`, `offsetParent !== null`) enkel op `smal`/`tablet-staand`; zet `tab--in-meer` op de overtollige knoppen (CSS verbergt ze in het dok), toont `.dok-meer` (actief als `meerActief`), vult het blad met knoppen die `document.getElementById('tab-' + id).click()` doen en het blad sluiten; herberekent via een `MutationObserver` op `.tabs-inner` (`childList`, `attributes: ['hidden','class']`) en op `apparaatwijziging`. Blad openen/sluiten met `registreerVenster` (`public/js/venster.js`) en `registreerBackdrop` (`kern/ui.js`). `.dok-meer` heeft NIET de klasse `.tab` (app-schil telt `.tab.active`).

- [ ] **Step 1: Failing tests** — `tests/dok-meer.test.mjs`: `dokVerdeling(['a','b','c','d','e'], 'a')` → alles in dok, `inMeer: []`; met 6 ids en actief `'f'` → `inDok: ['a','b','c','d']`, `inMeer: ['e','f']`, `meerActief: true`; `max = 5` standaard; lege lijst → beide leeg.
  `e2e/dok-meer.spec.mjs` (gsm 375×812):
  - `planner ziet 4 tabbladen en Meer`: zichtbare dok-tabs = Wachtrij, Kalender, Ingepland, Inventaris; `.dok-meer` zichtbaar; klik → blad met Rapporten en Beheer; klik Beheer → `#tab-beheer` heeft `aria-selected="true"`, `.dok-meer` heeft klasse actief, blad dicht.
  - `Escape sluit het blad`.
  - `technieker: geen Meer` (Kalender, Ingepland, Inventaris, Rapporten); `technieker met Mag zelf plannen: 5 tabbladen, geen Meer`.
  - `beheerder wisselt van werkruimte (Review Focus 1)`: beheerder in Sales-werkruimte op gsm → dok volgt de sales-volgorde (Leads, Kalender, Afgewerkt, Beheer: 4, geen Meer); terug naar Techniek → Meer met Rapporten en Beheer.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementeer.
- [ ] **Step 4:** Run → PASS; ook `e2e/app-schil.spec.mjs` (pijltjestoetsen, één actieve tab). Commit `feat(stijl): Meer-blad in het dok`.

### Task 7: Kop en paginakop

**Files:**
- Create: `public/js/schermen/paginakop-logica.js` (puur), `public/js/schermen/paginakop.js` (DOM)
- Modify: `public/index.html:207-231` (in `header` na `.logo`: `<div class="paginakop"><h2 id="paginatitel"></h2><p id="paginasub"></p></div>`), `public/css/app.css` (header 11-52, `#test-badge` 1166-1170, `.gebruiker-sel/.gebruiker-btn` 1321-1322, `#offline-banner`/`#outbox-banner` 1126-1141), `public/js/app.js` (`initPaginakop()` vóór `koppelRenders`), schermen die een samenvatting leveren: `schermen/wachtrij.js` (`renderTickets`), `schermen/kalender.js` (weekrender), `schermen/ingepland.js` (`renderGepland`), `inventaris.js` (`updateInventarisBadge` 391-407), `schermen/sales-lijst.js` (render), `public/sw.js`
- Test: `tests/paginakop.test.mjs`, `e2e/paginakop.spec.mjs`

**Interfaces:**
- Produces: `samenvattingVoor(tabId: string, cijfers: object) → string` met precies deze teksten (gebruik `meervoud` uit `schermen/ticketdetail-logica.js`):
  - `'tickets'`, `{ wachtend, verlopen }` → `"4 tickets wachten op een datum, 1 verlopen"`; `wachtend 1` → `"1 ticket wacht op een datum"`; `verlopen 0` → zonder tweede deel; `wachtend 0` → `"Geen tickets wachten op een datum"`.
  - `'kalender'`, `{ week, gepland, zonderDatum }` → `"Week 44 · 3 stops gepland, 1 zonder datum"`; `gepland 1` → `"1 stop gepland"`; `gepland 0` → `"Week 44 · nog niets gepland"` (+ zonder-datum-deel indien > 0).
  - `'gepland'`, `{ dezeWeek, wachtBevestiging }` → `"5 afspraken deze week, 2 wachten op bevestiging"`; enkelvoud `"1 afspraak deze week, 1 wacht op bevestiging"`; `0` → `"Geen afspraken deze week"`.
  - `'inventaris'`, `{ onderGrens }` → `"3 producten onder hun meldgrens"`, `"1 product onder zijn meldgrens"`, `0` → `"Alles boven de meldgrens"`.
  - `'sales-lijst'`, `{ open }` → `"6 open leads"`, `"1 open lead"`, `0` → `"Geen open leads"`.
  - elke andere tabId → `""`.
- Produces: `zetSamenvatting(tabId: string, tekst: string) → void` (bewaart per tab, toont meteen als die tab actief is); `initPaginakop() → void` (volgt de actieve `.tabs-inner .tab` met een `MutationObserver` op `class`; titel = tekst van de tab zonder teller en icoon; samenvatting = de bewaarde tekst).
- Elk scherm roept `zetSamenvatting` aan op de plek waar het zijn teller of lijst al tekent, met cijfers die het daar al heeft (verlopen = `isOverdue`, zonder datum = de bron van de kalender-pil "zonder datum", wacht op bevestiging = dezelfde test als het label "Wacht bevestiging", onder grens = `lageItems(...).length`). Geen nieuwe abonnementen buiten `koppelRenders`.
- Opmaak `breed`: logo in de kop verborgen (zit in de zijkolom), `.paginakop` zichtbaar (Bricolage 26 px, samenvatting 13 px), knoppen rechts als ronde glazen knoppen; kopvervaging via `.topbar-sticky::before`. `smal`/`tablet-staand`: `.paginakop` verborgen, logo + alle knoppen zichtbaar; wijkvolgorde op 360 px uit Global Constraints. Banners: op `breed` beginnen ze na de zijkolom (komt vanzelf door `body` padding), op gsm onder de kop.

- [ ] **Step 1: Failing tests** — `tests/paginakop.test.mjs`: één `test` per regel hierboven met exact de genoemde strings.
  `e2e/paginakop.spec.mjs`:
  - `pc: titel en samenvatting`: `#paginatitel` = "Wachtrij", `#paginasub` matcht `/^\d+ tickets? wacht(en)? op een datum/`; klik `#tab-kalender` → titel "Kalender", sub begint met "Week ".
  - `gsm 360 px: alles in de kop zichtbaar, geen horizontaal scrollen`: viewport 360×780, `blitz_weergave='gsm'` → `#person-btn`, `[data-actie="vernieuw"]`, `[data-actie="thema"]`, `[data-actie="instellingen"]`, `.gebruiker-btn` zijn zichtbaar en binnen `0..360`; `document.scrollingElement.scrollWidth <= 360`; `header` hoogte < 70 px (één regel).
  - `offline-balk zichtbaar (Review Focus 3)`: `page.context().setOffline(true)` is in deze fixture niet toegelaten; toon de balk via de bestaande testweg van `e2e/sticky-balken.spec.mjs` → op pc: balk `x >= 250`; op gsm: balk onder de kop, laatste kaart niet onder het dok.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementeer.
- [ ] **Step 4:** `node --test`; `npx playwright test e2e/paginakop.spec.mjs e2e/sticky-balken.spec.mjs e2e/app-schil.spec.mjs e2e/sales-instellingen.spec.mjs e2e/sales-rollen.spec.mjs --project=chromium` → PASS. Commit `feat(stijl): kop en paginakop met samenvatting`.

### Task 8: Overige schermen en vensters

**Files:**
- Modify: `public/css/app.css` (route, ingepland, rapporten, kalender-maand, `.overlay`/`.modal`/`.mhdr` 795-830, toast 1070-1089, banners 1126-1163, skeletten in `base.css`), `public/css/wizard.css`, `prijzen.css`, `inventaris.css`, `inloggen.css`, `beheer.css`, `dashboard.css`, `sales.css`
- Test: `e2e/open-dag-schermen.spec.mjs`

**Interfaces:**
- Consumes: tokens (Task 1), glaskaart en gloed (Task 3), glans (Task 4).
- Regels: Leaflet-kaart ondoorzichtig; vensters `var(--glas-venster)`, hoeken `var(--r-venster)`, gloed langs de rand in de kleur van het ticket (ticketdetail); `.overlay` z-index boven het dok; offline/outbox-balk effen eigen kleur (geen glas); inlogscherm: hemel + één glazen kaart; tabelkoppen en invoervelden met `var(--veld)`; minimale aanraakmaten blijven (`beschikbaarheid.spec.mjs:416-419`: 44 px, 16 px).

- [ ] **Step 1: Failing tests** — `e2e/open-dag-schermen.spec.mjs`:
  - `venster bedekt door niets op gsm (Review Focus 4)`: gsm 375×812, open een ticket in Ingepland → de onderkant van de laatste knop in `.mfoot` (of de knoppenrij van het detailvenster) ligt boven `812` en `document.elementFromPoint` in het midden van die knop geeft die knop (niet het dok).
  - `vensters zijn glas`: `.modal` heeft `borderRadius === '28px'` en een `backdropFilter` met `blur(`.
  - `inlogscherm op de hemel`: zonder sessie (zoals `e2e/inloggen*.spec.mjs`) → `#hemel` zichtbaar en de inlogkaart heeft `backdropFilter` met `blur(`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementeer scherm per scherm; commit per stijlblad (`feat(stijl): <scherm> in Open dag`).
- [ ] **Step 4:** Volledige chromium-run zonder contrast: `npx playwright test --project=chromium --workers=2 --grep-invert @contrast` → PASS. Aanpassingen aan bestaande tests enkel voor opmaakwaarden, met commentaar.
- [ ] **Step 5:** Maak schermafdrukken (pc 1366×768 en gsm 375×812, licht en donker) van Wachtrij, Kalender, Route, Ingepland, Inventaris, Rapporten, Beheer, Leads, ticketdetail, wizard, inloggen, naar `docs/superpowers/specs/assets/open-dag-schermen/` (buiten de suite, met een eenmalig script) voor Brent.

### Task 9: Contrast voor hemel en thema's

**Files:**
- Create: `e2e/contrast-meting.mjs` (de helpers `leesPng`, `vervaag`, `meng`, `lum`, `contrast`, `uitersteBlokken`, `meetKaarten`, `fotoAchtergrond`, `wachtOpStilstand`, `controleerKaarten` verhuizen uit `e2e/versiering.spec.mjs:351-500`; geen `test`-import), `e2e/hemel-contrast.spec.mjs`
- Modify: `e2e/versiering.spec.mjs` (importeert de helpers), `public/css/base.css`/`hemel.css` (tokens bijsturen tot alles slaagt)

**Interfaces:**
- Consumes: `controleerKaarten(page, sel, label, slechtste)` ongewijzigd van signatuur; de glascontrole erin leest de verwachte waarden uit één constante `VERWACHT_GLAS` die Task 10 kan aanpassen.

- [ ] **Step 1:** Verhuis de helpers; `npx playwright test e2e/versiering.spec.mjs --grep @contrast --workers=1` → PASS (zuivere verhuizing). Controleer dat `tests/e2e-import-guard.test.mjs` slaagt (`node --test`).
- [ ] **Step 2: Failing test** — `e2e/hemel-contrast.spec.mjs`: voor elk tijdstip (`ochtend`, `middag`, `avond`, `nacht`) × `dark`/`light` × viewports `1366×768` en `375×812` (gsm met `blitz_weergave='gsm'`): zet `data-hemel` en `data-theme` direct op `<html>` (de klok is hier niet nodig), meet `#view-tickets .ticket` en `#view-kalender .cal-ticket` met `controleerKaarten`. Titel met `@contrast` (draait in de releaserun mee).
- [ ] **Step 3:** `npx playwright test e2e/hemel-contrast.spec.mjs --grep @contrast --workers=1` → bij FAIL: eerst tekstkleur, dan glasdekking, hemelkleur pas als laatste (spec-beslissing 6). Herhaal tot PASS, plus de negen thema-proeven.
- [ ] **Step 4:** Commit `test(stijl): contrast van de hemel en de thema's`.

### Task 10: Snelheid meten en terugval

**Files:**
- Create: `scripts/meet-snelheid.mjs` (Playwright-script, geen test), rapport `docs/superpowers/specs/assets/2026-10-27-open-dag-snelheid.md`
- Modify (enkel bij terugval): `public/css/base.css` (gsm-regel), `e2e/glas-kaarten.spec.mjs` en `VERWACHT_GLAS`

**Interfaces:**
- `node scripts/meet-snelheid.mjs <url>`: start Chromium, gsm 375×812 met `blitz_weergave='gsm'` en CDP `Emulation.setCPUThrottlingRate({ rate: 4 })`, `?test`; meet 5 keer (mediaan): tijd tot de eerste `.ticket` zichtbaar is, en tijdens 3 s scrollen van Wachtrij en Kalender de som van lange taken (`PerformanceObserver` `longtask`) en het aantal beelden (`requestAnimationFrame`-teller). Print één tabel.

- [ ] **Step 1:** Meet op de basistak (v2.4.x, aparte worktree) en op `feat/open-dag` met de dev-server (`blitz-planning-blobs` uit `.claude/launch.json`, via `preview_start`).
- [ ] **Step 2:** Is "na" ≥ 10 % slechter op één van de drie cijfers: pas de terugval toe (geen `backdrop-filter` op lijstkaarten op `gsm`), pas `VERWACHT_GLAS` en de gsm-assert aan, meet opnieuw.
- [ ] **Step 3:** Schrijf de cijfers (voor/na, eventueel na terugval) in het rapport. Commit `perf(stijl): snelheidsmeting Open dag`.

### Task 11: Release v2.5.0

**Files:**
- Modify: `package.json` (`version: "2.5.0"`), `CHANGELOG.md` (sectie 2.5.0: Added/Changed), `public/sw.js` (`CACHE_NAME` = `blitz-planning-v41`), `tests/sw-schil.test.mjs:149-156` (pin `v41`), `CLAUDE.md` (nieuwe korte sectie "Stijl Open dag": tokens, hemel, navigatie/dok/Meer, paginakop, containing-block-regel, glans; `CACHE_NAME`-vermelding bijwerken)

- [ ] **Step 1:** Pas de bestanden aan.
- [ ] **Step 2:** `node --test` → PASS.
- [ ] **Step 3:** `npx playwright test --workers=2 --grep-invert @contrast` (chromium + sw) → PASS; daarna `npx playwright test e2e/versiering.spec.mjs e2e/hemel-contrast.spec.mjs --grep @contrast --workers=1` → PASS.
- [ ] **Step 4:** Commit `release: v2.5.0 — stijl Open dag`. Niet pushen of mergen naar `main` zonder uitdrukkelijk akkoord van Brent; de schermafdrukken (Task 8) en het snelheidsrapport (Task 10) gaan eerst naar hem.
