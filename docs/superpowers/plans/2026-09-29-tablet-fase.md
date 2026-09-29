# Tablet-fase (v1.8.0) — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een centrale apparaatherkenning (invoer, kortste zijde, rol, override) vervangt alle beslissingen op schermbreedte. Een tablet staand krijgt een tijdlijn van 3 dagen, routestops zijn met een vinger te verschuiven via vasthouden, knoppen zijn vingervriendelijk, en "Dit toestel" komt in Instellingen.

**Architecture:**
- `public/js/apparaat.js` is een klassiek script in `<head>`. Het zet `data-*` op `<html>`, levert `window.apparaat` en verstuurt `apparaatwijziging`.
- CSS en JS lezen alleen nog die attributen en dat object.
- `public/js/sorteer.js` (ES-module) is een herbruikbare sorteerfunctie op basis van Pointer Events.
- De rest zit in `public/index.html` en `public/css/*.css`.

**Tech Stack:** vanilla JS en CSS, geen build en geen testframework. Verificatie gebeurt met `node --check`, het compileren van de inline scripts en browsercontrole op `http://127.0.0.1:3333/?test`.

**Spec:** `docs/superpowers/specs/2026-09-29-tablet-fase-design.md`. Lees §1–§6. Brent keurde het ontwerp goed op 2026-09-29.

## Global Constraints
- **Herkenning, exact zoals in de spec §1:**
  - `!grof` → computer;
  - `grof && kortsteZijde < 600` → gsm;
  - `grof && kortsteZijde >= 600` → tablet.
- **Indeling:**
  - computer → `breed`;
  - tablet liggend → `breed`;
  - tablet staand → `tablet-staand`;
  - gsm → `smal`.
- **localStorage-sleutels:** `blitz_weergave` (`auto|gsm|tablet|computer`) en `blitz_rol` (`coordinator|technieker`).
- **Standaardrol:** computer → coordinator; gsm → technieker; tablet → eenmalig vragen, tot dan technieker.
- **Attributen op `<html>`:** `data-apparaat`, `data-indeling`, `data-orientatie` (`staand|liggend`), `data-aanraak` (`ja|nee`), `data-rol`.
- **Event:** `window` `CustomEvent('apparaatwijziging')`, alleen bij een echte wijziging van indeling, rol, aanraak of oriëntatie.
- **Sorteren:**
  - vasthouden bij aanraken: **450 ms**, annuleren bij meer dan **8 px** beweging;
  - slepen met de muis start na **4 px**;
  - auto-scroll binnen **40 px** van de rand;
  - `navigator.vibrate?.(15)` bij de start.
- **Aanraakdoelen:** ≥ 44 px bij `data-aanraak="ja"`.
- Blitz-groen `#00dfa3` blijft exact. Tekst ≥ 4,5:1. UI-tekst in het Nederlands.
- Geen gedragswijziging voor computer + coördinator (de huidige desktop) en voor gsm + technieker (de huidige gsm), behalve grotere aanraakdoelen op de gsm.
- De rol is **geen beveiliging**. Niets aan de server wijzigen.
- Branch `worktree-uiux-tablet`. Regels uit `implementer-rules.md` in de SDD-map.

## Review Focus
1. **Eerste render zonder flits:** de attributen moeten op `<html>` staan vóór de eerste paint en vóór de eerste `renderKalender()`. `apparaat.js` loopt synchroon in `<head>`.
2. **Draaien tijdens gebruik:** kalender en route renderen opnieuw, een open ticketdetail of wizard blijft open en bruikbaar, en er komen geen dubbele listeners bij (sorteren, ResizeObserver, timers).
3. **Technieker op een computer of tablet:** nergens coördinatorknoppen, ook niet in het ticketdetail en in dynamisch opgebouwde HTML (grep op `desktop-only` in JS-templates).
4. **Aanraken tegenover scrollen:** een vinger die over de routelijst veegt, scrolt de lijst en start nooit een sleepbeweging.
5. **Tijdlijn van 3 dagen rond het weekend:** vrijdag toont vr, ma, di. De nu-lijn verschijnt enkel als vandaag in het venster zit.

---

### Task 1: Apparaatherkenning (model: sonnet)

**Files:**
- Create: `public/js/apparaat.js`
- Modify: `public/index.html` (`<script src="/js/apparaat.js"></script>` in `<head>`, direct na het bestaande inline themascript, ±regel 22, vóór de stylesheets), `public/sw.js` (precache-lijst, zonder CACHE_NAME-bump).

**Interfaces:**
- Produces:
  - `window.apparaat: { soort: 'gsm'|'tablet'|'computer', automatischeSoort, indeling: 'smal'|'tablet-staand'|'breed', staand: boolean, aanraak: boolean, rol: 'coordinator'|'technieker', rolGekozen: boolean, kortsteZijde: number }`;
  - `window.zetWeergave(w: 'auto'|'gsm'|'tablet'|'computer'): void`;
  - `window.zetRol(r: 'coordinator'|'technieker'): void`;
  - `window.herevalueerApparaat(): void`;
  - event `apparaatwijziging`.
  Alle latere taken gebruiken deze.

- [ ] **Stap 1:** `apparaat.js` schrijven volgens spec §1:
  - de `pointer: coarse`-media-query één keer aanmaken en bewaren, met een `change`-listener;
  - `resize` via `requestAnimationFrame` (debounce), plus `orientationchange`;
  - `rolGekozen` = `blitz_rol` is aanwezig in localStorage;
  - ongeldige waarden in localStorage worden `auto` of de standaard;
  - elke toegang tot localStorage in try/catch.
- [ ] **Stap 2:** In `<head>` opnemen. In `sw.js` toevoegen aan de lijst van gecachete bestanden.
- [ ] **Stap 3:** `node --check public/js/apparaat.js`.
- [ ] **Stap 4:** Browsercontrole. Pointer nabootsen door vóór het laden van de pagina `matchMedia` te overschrijven, of via DevTools-emulatie (mobile preset = touch). De volgende cases elk met hun `JSON.stringify(window.apparaat)` en de html-attributen, als ruwe uitvoer:
  - 1440×900 zonder aanraken → computer / breed / coordinator;
  - 375×812 met aanraken → gsm / smal / technieker;
  - 932×430 met aanraken → gsm / smal;
  - 800×1280 met aanraken → tablet / tablet-staand, `rolGekozen` false, rol technieker;
  - 1280×800 met aanraken → tablet / breed;
  - `zetWeergave('computer')` op 800×1280 → breed, en `zetWeergave('auto')` terug;
  - `zetRol('coordinator')` → het attribuut verandert en er vuurt precies 1 `apparaatwijziging`.
- [ ] **Stap 5:** Commit: `feat(apparaat): centrale herkenning op invoer, kortste zijde, rol en override`.

### Task 2: Rol bepaalt de coördinatorfuncties (model: sonnet)

**Files:**
- Modify: `public/index.html` (alle `desktop-only` in HTML en in JS-templates, `enforceMobileTabRestriction` ±4784 en de `matchMedia('(max-width: 1023px)')`-listener), `public/js/*.js` (grep `desktop-only`), `public/css/app.css` (±464 en ±910: de regels die `.desktop-only` verbergen).

**Interfaces:**
- Consumes: `window.apparaat`, event `apparaatwijziging` (Taak 1).
- Produces:
  - CSS-klasse `coord-only`;
  - `function pasRolBeperkingToe(): void`: staat het actieve tabblad op `coord-only` en is de rol technieker, dan `setTab('kalender')`.

- [ ] **Stap 1:** Elke `desktop-only` hernoemen naar `coord-only` (`grep -rn "desktop-only" public/`, nadien 0 treffers). Commentaar dat naar desktop-only verwijst mee bijwerken.
- [ ] **Stap 2:** CSS: `html[data-rol="technieker"] .coord-only { display: none !important; }`. De verberging van `.desktop-only` in de `max-width:1023px`-blokken verwijderen. De andere regels in die blokken blijven voorlopig staan voor Taak 3.
- [ ] **Stap 3:** `enforceMobileTabRestriction` en de listener op `(max-width: 1023px)` vervangen door `pasRolBeperkingToe()`. Die wordt aangeroepen bij het laden (na de eerste `setTab`) en in een `apparaatwijziging`-listener, eenmalig geregistreerd. Die listener roept ook `renderKalender()` aan, en `renderRouteList(document.getElementById('plan-date').value)` als het tabblad Route actief is.
- [ ] **Stap 4:** Instellingen: het tandwiel (headerknop) wordt **niet** `coord-only`. Taak 6 geeft het een subtabblad voor iedereen. Tot Taak 6 klaar is, opent het het bestaande venster; dat is aanvaardbaar tussen twee taken.
- [ ] **Stap 5:** Browsercontrole (ruwe uitvoer):
  - 1440 als coördinator: alle 6 tabbladen zichtbaar en de coördinatorknoppen in het ticketdetail zichtbaar;
  - `zetRol('technieker')` op 1440: Wachtrij, Route, Rapporten, Plan deze week, Import en + Afspraak verborgen; stond Route open, dan springt de app naar Kalender; in het ticketdetail geen Klantbeschikbaarheid, Plan of Voorstel;
  - 375 als technieker: hetzelfde beeld als vóór de wijziging (tabbladen Kalender, Ingepland, Inventaris);
  - daarna `localStorage.removeItem('blitz_rol')`.
- [ ] **Stap 6:** Commit: `feat(rol): coördinatorfuncties volgen de rol op het toestel i.p.v. de schermbreedte`.

### Task 3: Indeling en aanraken vervangen de overige breedte-controles (model: sonnet)

**Files:**
- Modify: `public/css/app.css`, `public/css/wizard.css`, `public/css/inventaris.css` (alle `max-width:1023px`-blokken en het 680 px-blok voor de route), `public/index.html` (`innerWidth >= 1024` ±1752/1823 en `kalPasGridHoogteAan`/de auto-scroll-voorwaarden die daarop steunen).

**Interfaces:**
- Consumes: `window.apparaat.indeling` en de attributen (Taak 1). Taak 4 gebruikt `apparaat.indeling === 'tablet-staand'` in renderKalender.

- [ ] **Stap 1:** Volgens de tabel in spec §5:
  - tijdlijn en urenkolom verbergen, de week onder elkaar, lijstmodus → `html[data-indeling="smal"]`;
  - 44 px en 16 px → `html[data-aanraak="ja"]`;
  - route onder elkaar → `html[data-indeling="smal"], html[data-indeling="tablet-staand"]`, en de bestaande `max-width:680px`-regel behouden.
  Na afloop bevat geen enkel CSS-bestand nog `1023px`; een grep toont dat. Controleren dat de 44 px-regel bij aanraken alle `button`, `.tab`, `.kal-nav`, `.kal-view-btn`, headerknoppen en de chips in de dagkop dekt (`min-height: 44px`, en voor pictogramknoppen ook `min-width: 44px`).
- [ ] **Stap 2:** JS: `window.innerWidth >= 1024` → `window.apparaat.indeling !== 'smal'`. Alle overige `innerWidth`-, `screen.width`- en `matchMedia`-breedtecontroles in `public/` opsommen en ofwel omzetten, ofwel in het rapport motiveren waarom ze blijven (bv. de 680-sleepregel, die Taak 5 schrapt).
- [ ] **Stap 3:** Browsercontrole (ruwe uitvoer):
  - 1440 zonder aanraken: tijdlijn, knoppen op de gewone grootte (niets ongewild 44 px), `document.scrollingElement.scrollHeight <= innerHeight + 1`;
  - 375 met aanraken: lijst, en alle zichtbare knoppen ≥ 44 px (lijst van elementen die eronder zitten: moet leeg zijn, of gemotiveerd);
  - 1280×800 met aanraken: tijdlijn en 44 px-knoppen;
  - 800×1280 met aanraken: voorlopig een weektijdlijn met 5 kolommen (Taak 4 maakt er 3 dagen van), en de route onder elkaar.
- [ ] **Stap 4:** Commit: `refactor(indeling): lay-out volgt apparaatherkenning i.p.v. 1024px-grens`.

### Task 4: Tijdlijn van 3 dagen voor een tablet staand (model: sonnet)

**Files:**
- Modify: `public/index.html` (`renderKalender` weektak ±1746–1900, `kalNav` ±2023, `kalToday`, `kalAutoScroll`-sleutel, globale `let kalDagOffset = 0` bij `kalOffset` ±574).

**Interfaces:**
- Consumes: `window.apparaat.indeling`, de bestaande tijdlijnfuncties (v1.7.0) en `werkdagen` uit `settings`.
- Produces: `function kalZichtbareDagen(today: Date): Date[]`:
  - weektak met indeling ≠ tablet-staand: de werkdagen van de week (bestaand gedrag);
  - tablet-staand: 3 opeenvolgende werkdagen vanaf `today + kalDagOffset` werkdagen.

- [ ] **Stap 1:** De lus in `renderKalender` over `for (i<7)` met de werkdagen-filter omzetten naar een lus over `kalZichtbareDagen(today)`. Het gedrag voor breed blijft identiek; vergelijk vóór en na het aantal kolommen en de datums op 1440.
- [ ] **Stap 2:** Bij tablet-staand:
  - label `fmtDateShort(eerste) + ' – ' + fmtDateShort(laatste)`;
  - `kalNav(dir)` past `kalDagOffset += dir` aan (per werkdag, negatief toegestaan) in plaats van `kalOffset`;
  - `kalToday()` zet `kalDagOffset = 0`;
  - de auto-scroll-sleutel wordt de ISO-datum van de eerste dag plus de weergave.
  Terug naar breed toont gewoon de week van `kalOffset`; beide verschuivingen blijven los van elkaar bestaan.
- [ ] **Stap 3:** Controleren dat de nu-lijn (`updateNuLijn` zoekt `.day-col[data-date=vandaag]`), de chips "zonder uur", de banden, de vaste koppen, de gelijke kolomhoogte en `kalPasGridHoogteAan` allemaal werken met 3 kolommen. Kolombreedte: 3 kolommen vullen de beschikbare breedte (ongeveer 250 px per kolom op 800 px).
- [ ] **Stap 4:** Browsercontrole op 800×1280 met aanraken (ruwe uitvoer):
  - 3 kolommen met de datums (vandaag plus de volgende 2 werkdagen), label klopt;
  - `kalNav(1)` schuift 1 werkdag op;
  - met een nagebootste vrijdag (`Date`-mock, zie het plan van fase 2): vr, ma, di;
  - nu-lijn enkel in de kolom van vandaag, `kalToday()` terug;
  - naar 1280×800 draaien (resize): een weektijdlijn met 5 kolommen;
  - maandweergave ongewijzigd.
- [ ] **Stap 5:** Commit: `feat(kalender): 3-dagen-tijdlijn op tablet rechtop`.

### Task 5: Vasthouden en verschuiven voor routestops (model: sonnet)

**Files:**
- Create: `public/js/sorteer.js` (ES-module, `export function maakSorteerbaar(...)` en `window.maakSorteerbaar = maakSorteerbaar`)
- Modify: `public/index.html` (het slepen in de routelijst ±3905–3975: de HTML5-handlers, `draggable`, de drop-zone aan het einde en de `innerWidth > 680`-voorwaarde verwijderen en vervangen door één `maakSorteerbaar`-aanroep per render van de lijst; module-script-tag ±522), `public/css/app.css` (`.sorteer-actief`, `.sorteer-placeholder`), `public/sw.js` (precache-lijst).

**Interfaces:**
- Produces: `maakSorteerbaar(lijstEl: HTMLElement, opts: { itemSelector: string, isVersleepbaar: (el) => boolean, opVolgorde: (vanIndex: number, naarIndex: number) => void }) => { vernietig(): void }`. De indices zijn posities onder de elementen die aan `itemSelector` voldoen, in DOM-volgorde op het moment van starten. `naarIndex` is de positie waar het item komt te staan.
- Consumes: de bestaande `applyRouteOrder(date, nieuw)`. De huidige drop-logica vertaalt `(van, naar)` naar de gesplicete `allStops`-volgorde; dat moet behouden blijven.

- [ ] **Stap 1:** `sorteer.js` volgens spec §3 en de Global Constraints:
  - `pointerdown` op een versleepbaar item;
  - voor aanraken een timer van 450 ms, geannuleerd door meer dan 8 px beweging of door `pointerup`;
  - voor muis of pen: start na 4 px;
  - bij de start: `setPointerCapture`, `.sorteer-actief`, een placeholder met de hoogte van het item, het item volgt de vinger (`transform: translateY`), `touch-action: none` op het item, en `navigator.vibrate?.(15)`;
  - auto-scroll binnen 40 px van de rand (het dichtstbijzijnde scrollbare ouderelement of het venster);
  - Escape of `pointercancel` annuleert;
  - bij `pointerup`: `opVolgorde(van, naar)` alleen als `van !== naar`;
  - `vernietig()` verwijdert alle listeners.
  Een klik zonder slepen moet het kaartje gewoon openen zoals nu; na een sleepbeweging wordt de volgende klik opgeslokt.
- [ ] **Stap 2:** De routelijst omzetten. De bestaande regels blijven: enkel niet-vergrendelde tickets zijn versleepbaar, alle kaartjes zijn een geldig doel, en niets is versleepbaar bij meerdere technici. Een vorige instantie vernietigen vóór de nieuwe render. `cursor: grab` enkel bij `data-aanraak="nee"`.
- [ ] **Stap 3:** `node --check` op `sorteer.js`, en de inline scripts compileren.
- [ ] **Stap 4:** Browsercontrole in testmodus op het tabblad Route, met een dag van één technieker. Eerst nagaan of `applyRouteOrder` in `TEST_MODE` naar Zoho schrijft (`/api/plan-datum`). Schrijft het, stop dan en meld `BLOCKED`. TomTom `/api/route` is toegestaan. Ruwe uitvoer van:
  - een muisslepen met gedispatchte `PointerEvent`s (`pointerType: 'mouse'`): de volgorde wisselt;
  - aanraken (`pointerType: 'touch'`): na 200 ms 20 px bewegen geeft geen slepen; 500 ms vasthouden en dan bewegen geeft wel slepen en een wissel;
  - klik zonder beweging: het detail opent;
  - na twee keer renderen: maar één set listeners (via een teller of door de code te lezen, zeg hoe).
- [ ] **Stap 5:** Commit: `feat(route): vasthouden en verschuiven voor routestops (muis en vinger)`.

### Task 6: Instellingen "Dit toestel" en de vraag bij het eerste gebruik van een tablet (model: sonnet)

**Files:**
- Modify: `public/index.html` (het instellingenvenster ±209–271, `setSettingsTab` ±4965, `openSettings` ±5233, de headerknop voor het tandwiel, de init), `public/css/app.css` indien nodig.

**Interfaces:**
- Consumes: `window.apparaat`, `zetRol`, `zetWeergave` (Taak 1), `appConfirm` (v1.6.1), `coord-only` (Taak 2).

- [ ] **Stap 1:** Nieuw subtabblad "Dit toestel" (`set-subtab` met id `toestel`) met de inhoud en teksten uit spec §4:
  - "Herkend als: <Soort> · <rechtop|liggend> · <aanraakscherm|muis/trackpad>", en bij een override "(handmatig: <Soort>)";
  - keuzerondjes voor de rol;
  - keuzerondjes voor de weergave;
  - de uitlegtekst.
  Wijzigingen gelden meteen via `zetRol`/`zetWeergave`, en de tekst "Herkend als" wordt bijgewerkt. De knop Opslaan wordt op dit subtabblad verborgen, zoals bij Beschikbaarheden.
- [ ] **Stap 2:** Het tandwiel is zichtbaar voor iedereen:
  - de subtabbladen Algemeen en Beschikbaarheden en de knop Prijzen krijgen `coord-only`;
  - een technieker die het venster opent, komt meteen op "Dit toestel" terecht;
  - kiest een coördinator in het venster "Technieker", dan schakelt het venster naar "Dit toestel" zonder te crashen.
- [ ] **Stap 3:** Eerste gebruik: na de init, als `apparaat.soort === 'tablet' && !apparaat.rolGekozen`, eenmalig `appConfirm` met de exacte teksten uit spec §4. `true` → `zetRol('coordinator')`, anders `zetRol('technieker')`. Niet vragen in `?test` als `localStorage['blitz_rol']` al bestaat. Nooit meer dan één keer per laden.
- [ ] **Stap 4:** Browsercontrole (ruwe uitvoer):
  - 800×1280 met aanraken, `blitz_rol` gewist, herladen: de vraag verschijnt, en klikken op "Coördinator" maakt de rol coordinator en toont de tabbladen;
  - herladen: geen vraag;
  - Instellingen → "Dit toestel": de juiste herkenningstekst;
  - weergave op "Computer" zetten: de indeling wordt breed; terug op Automatisch;
  - als technieker op 375: het tandwiel opent direct "Dit toestel", zonder de subtabbladen Algemeen, Beschikbaarheden en Prijzen.
  `blitz_rol` en `blitz_weergave` achteraf opruimen.
- [ ] **Stap 5:** Commit: `feat(instellingen): "Dit toestel" met rol en weergave, eenmalige rolvraag op tablet`.

### Task 7: Afronden (hoofdsessie)
- [ ] Eindreview over de hele branch (model: **opus**).
- [ ] Browsercontrole door de hoofdsessie op de toestellen uit spec §7.
- [ ] Versie 1.8.0 (`package.json`/`package-lock.json`), `CHANGELOG.md` `[1.8.0]`, `CACHE_NAME` v16.
- [ ] Samenvatting voor Brent. **Pas na zijn "ja"**: pushen en taggen `v1.8.0`. Daarna test Brent op de S7 FE.
