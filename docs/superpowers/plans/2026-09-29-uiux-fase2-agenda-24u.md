# UI/UX fase 2 (v1.7.0): agenda over 24 uur, werkuren en "nu"-lijn — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De weekkalender toont 00:00–24:00 met donkerdere banden buiten 08:30–17:00, een rode "nu"-lijn die elke minuut meeschuift, één scrollbalk met vaste dagkoppen en automatisch scrollen naar de werkdag. Op gsm krijgt de kaartenlijst een "nu"-streepje en een label "buiten werkuren".

**Architecture:** Alles zit in de bestaande tijdlijnrendering van `public/index.html`:
- `computeTimelineRange` (±1431), `timelineTopHeight` (±1420), `renderTimelineGutter` (±1447), `renderDayTimeline` (±1512) en `renderKalender` (±1650–1844);
- de CSS in `public/css/app.css` (±375–414, 901–935);
- de thematokens in `public/css/base.css`.

De tijdlijn wordt alleen getoond vanaf 1024 px breed (`window.innerWidth >= 1024`). Daaronder komt de gestapelde kaartenlijst.

**Tech Stack:** vanilla JS en CSS, geen build, geen testframework. Verificatie gebeurt met `node --check` en browsercontrole.

**Spec:** goedgekeurd chat-ontwerp fase 2 (2026-09-29) en `C:\Users\BRENT\.claude\plans\maak-een-plan-van-swift-grove.md` (fase 2). Keuzes van Brent: nu-lijn **rood**, werkuren **vast 08:30–17:00**.

## Global Constraints
- **Werkuren** zijn vaste constanten `WERKUUR_START = 8*60+30` en `WERKUUR_EIND = 17*60`, los van `settings.vanTijd/totTijd`.
- **Bereik** van de tijdlijn: 0–1440 minuten. De pixelschaal `TIMELINE_PX_PER_MIN = 1.3` blijft ongewijzigd.
- **Nu-lijn:** in `var(--red)`, alleen in de kolom van vandaag, alleen als de getoonde week vandaag bevat. Label in `HH:MM`-formaat. Leesbaar in beide thema's (≥ 4,5:1 voor het label).
- **Blitz-groen** `#00dfa3` blijft exact. Tekstkleuren volgen `--accent-ink`/`--on-accent`.
- De **maandweergave** blijft ongewijzigd. De gsm-lijst (onder 1024 px) behoudt haar volgorde en kaarten, en krijgt er alleen iets bij.
- Automatisch scrollen **mag de gebruiker niet wegtrekken** bij een gewone her-render (data-verversing/polling). Het gebeurt alleen bij het openen van het tabblad Kalender of bij wisselen van week of weergave.
- Werk in de worktree op branch `worktree-uiux-fase2-agenda`. De regels uit `implementer-rules.md` (SDD-map) gelden.

## Review Focus
1. **Her-render tijdens gebruik:** `renderKalender()` wordt ook aangeroepen na data-verversing. De scrollpositie moet dan blijven staan, en er mag geen extra `setInterval` bijkomen per render.
2. **Blok vlak voor middernacht** (bv. 23:30 met minimale blokhoogte 155 px): het blok moet volledig binnen de tijdlijn zichtbaar blijven en mag niet afgekapt worden.
3. **Dag wisselt terwijl de app openstaat** (na 23:59): de nu-lijn moet naar de nieuwe dag springen of verdwijnen, niet op de oude kolom blijven hangen.
4. **Venstergrootte wijzigen** over de grens van 1024 px: geen dubbele scrollbalken, geen hoogte die vastzit op de oude waarde.
5. **Uitlijning:** de bestaande code die de urenkolom en de dagkolommen gelijk zet (±1816–1843) moet blijven werken met vaste koppen. Uurlijnen en urenlabels moeten op dezelfde hoogte liggen.

---

### Task 1: 24-uursbereik en banden buiten de werkuren (model: sonnet)

**Files:**
- Modify:
  - `public/index.html`: `computeTimelineRange`, `timelineTopHeight`, `renderTimelineGutter`, `renderDayTimeline`;
  - `public/css/base.css`: token `--tl-offhours` in beide thema's;
  - `public/css/app.css`: `.tl-offhours`.

**Interfaces:**
- Produces:
  - globale constanten `WERKUUR_START`, `WERKUUR_EIND`;
  - `function isBuitenWerkuren(hhmm: string): boolean` ("HH:MM"; `true` als de start vóór 08:30 of op/na 17:00 ligt; `false` voor lege of ongeldige invoer);
  - `computeTimelineRange()` geeft `{dagStartMin: 0, dagEindMin: 1440, displayStartH: 0, displayEndH: 24, totalHeight}` terug.
  Taak 2, 3 en 4 gebruiken deze.

- [ ] **Stap 1:**
  - `computeTimelineRange()` geeft vast 0–1440 terug. Het commentaar over "minstens 08:00–18:00" wordt bijgewerkt.
  - `timelineTopHeight`: een `endMin` na 1440 wordt 1440. Zou `top + height` groter zijn dan `totalHeight`, dan wordt `top = max(0, totalHeight − height)`, zodat een laat blok volledig zichtbaar blijft.
- [ ] **Stap 2:** In `renderDayTimeline` en `renderTimelineGutter` komen twee absolute achtergrondbanden `div.tl-offhours`: 0 tot `WERKUUR_START` en `WERKUUR_EIND` tot 1440. Ze worden als eerste kinderen van de wrap toegevoegd, zodat ze onder uurlijnen, blokkeringen en tickets liggen, met `pointer-events: none`.
- [ ] **Stap 3:** Token `--tl-offhours`:
  - donker thema: `rgba(0,0,0,0.28)`;
  - licht thema: `rgba(26,36,51,0.07)`.
  CSS `.tl-offhours { position:absolute; left:0; right:0; background: var(--tl-offhours); pointer-events:none; }`.
  Controleren dat ticketteksten erop nog ≥ 4,5:1 halen. De kaarten hebben een eigen achtergrond, dus dat is normaal geen probleem.
- [ ] **Stap 4:** `isBuitenWerkuren` toevoegen naast de constanten.
- [ ] **Stap 5:** Verificatie op `127.0.0.1:3333/?test` bij 1440×900:
  - de urenkolom toont 00:00 tot en met 24:00;
  - er zijn banden boven 08:30 en onder 17:00, in beide thema's;
  - in de console een testitem toevoegen met `planning[<datum>]` en `uur` "22:00" (en "06:00"), gevolgd door `renderKalender()`. Beide zijn zichtbaar in de donkere band;
  - "23:30" staat volledig binnen de tijdlijn.
  Ruwe meetwaarden (`getBoundingClientRect`) in het rapport. Het testitem daarna weer verwijderen en opnieuw renderen.
- [ ] **Stap 6:** Commit: `feat(kalender): 24-uursweergave met donkere banden buiten 08:30–17:00`.

### Task 2: Rode "nu"-lijn (model: sonnet)

**Files:**
- Modify: `public/index.html` (`renderDayTimeline` of `renderKalender`, plus een nieuwe kleine updater), `public/css/app.css` (`.tl-now`, `.tl-now-label`).

**Interfaces:**
- Consumes: `computeTimelineRange()` en `TIMELINE_PX_PER_MIN` (Taak 1).
- Produces:
  - `function updateNuLijn(): void`: plaatst of verplaatst het element `.tl-now` in de `.tl-wrap` van de kolom van vandaag, of verwijdert het;
  - één module-brede timer `_nuLijnTimer` (idempotent gestart).

- [ ] **Stap 1:** Elke dagkolom in de tijdlijnweergave krijgt `data-date` (ISO) op `.day-col`. `updateNuLijn()` zoekt de kolom met `localISO(new Date())`:
  - niet gevonden: alle `.tl-now` verwijderen;
  - wel gevonden: één `.tl-now` op `top = (nuMin − dagStartMin) × TIMELINE_PX_PER_MIN` met het label `HH:MM`.
- [ ] **Stap 2:** Aan het einde van `renderKalender()` (enkel in de tijdlijnweergave) `updateNuLijn()` aanroepen. De timer wordt één keer gestart (`if (!_nuLijnTimer) _nuLijnTimer = setInterval(updateNuLijn, 60000)`), en bij `document.visibilitychange` naar zichtbaar wordt ook `updateNuLijn()` aangeroepen. Wisselt de dag ('dag-wissel'), dan springt de lijn naar de nieuwe dag of verdwijnt ze vanzelf, omdat de datum telkens opnieuw berekend wordt.
- [ ] **Stap 3:** CSS:
  - `.tl-now { position:absolute; left:0; right:0; height:0; border-top:2px solid var(--red); z-index:4; pointer-events:none; }`;
  - een bolletje via `::before` (8×8, rond, `var(--red)`, links op −4 px);
  - `.tl-now-label` klein (0,7 rem, vetjes), witte tekst op een `var(--red)`-achtergrond, contrast ≥ 4,5:1 in beide thema's (meten);
  - de lijn ligt boven de uurlijnen en banden. Tickets mag ze kruisen, maar ze moet zichtbaar blijven: `z-index` boven de blokken.
- [ ] **Stap 4:** Verificatie:
  - in de week van vandaag staat de lijn op het juiste uur (`top` vergelijken met de berekening);
  - volgende week: geen `.tl-now`;
  - `Date` nabootsen in de console (bv. `const _D=Date; Date=class extends _D{constructor(...a){a.length?super(...a):super(_D.now()+3600e3)}static now(){return _D.now()+3600e3}}`), `updateNuLijn()` aanroepen: de lijn verschuift 78 px. Daarna `Date=_D` terugzetten;
  - meerdere `renderKalender()`-aanroepen starten geen extra timer.
  Ruwe uitvoer in het rapport.
- [ ] **Stap 5:** Commit: `feat(kalender): rode nu-lijn die elke minuut meeschuift`.

### Task 3: Eén scrollbalk, vaste dagkoppen en automatisch scrollen (model: sonnet)

**Files:**
- Modify: `public/index.html` (`renderKalender`, plus de resize-afhandeling van de kalender als die bestaat), `public/css/app.css` (`.week-grid` in de tijdlijnweergave, `.day-hdr` sticky).

**Interfaces:**
- Consumes: `computeTimelineRange`, `TIMELINE_PX_PER_MIN`, `WERKUUR_START` (Taak 1). Taak 2 gebruikt `.day-col[data-date]`.
- Produces: `let _kalAutoScrollKey = null` en `function kalAutoScroll(force?: boolean): void`.

- [ ] **Stap 1:** In de tijdlijnweergave (vanaf 1024 px) wordt `#week-grid` de enige verticale scrollcontainer:
  - klasse `week-grid tl-mode`;
  - CSS `.week-grid.tl-mode { overflow:auto; }`;
  - de hoogte zet JS op `innerHeight − grid.getBoundingClientRect().top − 16` px (minstens 400), bij elke render en bij `resize`, met debounce en één listener.
  Onder 1024 px wordt de inline-hoogte gewist. Controleren dat de pagina zelf dan geen tweede verticale scrollbalk meer heeft voor de kalender.
- [ ] **Stap 2:** `.week-grid.tl-mode .day-hdr { position:sticky; top:0; z-index:5; }`, ook voor de lege kop van de urenkolom. De achtergrond blijft `var(--surface)`, zodat de inhoud er niet door schijnt. Horizontaal scrollen (smal venster met veel dagen) moet blijven werken.
- [ ] **Stap 3:** `kalAutoScroll(force)`:
  - de sleutel is `${weekStart ISO}|${kalView}`;
  - scrollen gebeurt alleen als `force` waar is of de sleutel verschilt van `_kalAutoScrollKey`;
  - doel: week bevat vandaag → `(nuMin − 60) × schaal`, anders `8*60 × schaal`, telkens plus de offset van de tijdlijn in de kolom en min de hoogte van de vaste kop, begrensd op ≥ 0.
  Aanroepen aan het einde van `renderKalender()` (tijdlijnweergave), met `force = true` bij het openen van het tabblad Kalender (via `setTab('kalender')` of het equivalent: zoek hoe het tabblad geactiveerd wordt), bij `kalNav`, bij `kalToday` en bij wisselen van weergave.
  Bij een her-render na polling blijft de sleutel gelijk, dus er wordt niet gescrold. Controleren dat `innerHTML = ''` bij een her-render de scrollpositie niet reset. Doet het dat wel, dan de `scrollTop` vóór het leegmaken opslaan en na het opbouwen terugzetten.
- [ ] **Stap 4:** Verificatie op 1440×900 en 1280×720:
  - er is één verticale scrollbalk (`document.scrollingElement.scrollHeight <= innerHeight + 1` en `#week-grid` scrollt);
  - de dagkoppen blijven staan bij scrollen (`getBoundingClientRect().top` van `.day-hdr` blijft gelijk na `scrollTop = 800`);
  - bij het openen van het tabblad staat de weergave rond 1 uur vóór nu, of rond 08:00 in een andere week;
  - na `scrollTop = 300` en een `renderKalender()` (zonder navigatie) is `scrollTop` nog 300;
  - uurlijnen en urenlabels zijn nog uitgelijnd (verschil in `top` ≤ 1 px).
  Ook het venster verkleinen naar 1000 px (gsm-lijst, geen vaste hoogte) en terug naar 1440.
  Ruwe uitvoer in het rapport.
- [ ] **Stap 5:** Commit: `feat(kalender): één scrollbalk, vaste dagkoppen, automatisch naar de werkdag`.

### Task 4: Gsm-lijst: nu-streepje en label "buiten werkuren" (model: sonnet)

**Files:**
- Modify: `public/index.html` (de tak van de gestapelde kaartenlijst in `renderKalender`, ±1776–1789, plus `buildTicketCard`/`buildLocalEventCard` of een wrapper), `public/css/app.css`.

**Interfaces:**
- Consumes: `isBuitenWerkuren(hhmm)` (Taak 1), en `updateNuLijn` (Taak 2) enkel als referentie. Deze taak heeft een eigen eenvoudige marker.

- [ ] **Stap 1:** In de kaartenlijst van vandaag komt één `div.kal-nu-marker` ("nu 14:32", rood, dun) vóór de eerste kaart waarvan `sortKey > HH:MM van nu`. Zijn alle kaarten voorbij, dan komt hij onderaan. Kaarten zonder uur (`'99:99'`) tellen als "later". Geen marker op andere dagen. Bijwerken gebeurt via dezelfde minuuttimer uit Taak 2: breid `updateNuLijn` uit zodat die in de lijstweergave ook de marker verplaatst, of roep een kleine `updateNuMarker()` aan vanuit dezelfde timer. Er komt geen tweede interval.
- [ ] **Stap 2:** Ticket- en afspraakkaarten met een uur waarvoor `isBuitenWerkuren(uur)` waar is, krijgen een kleine badge `buiten werkuren` in dezelfde stijl als de bestaande kleine badges op de kaart (klasse `.badge-buitenuren`, kleur `--orange` met `--orange-dim` als achtergrond, ≥ 4,5:1). Op de desktoptijdlijn is dit niet nodig, want daar tonen de banden het al.
- [ ] **Stap 3:** Verificatie op 375×812:
  - een testitem met `uur` "22:00" vandaag toont de badge;
  - de marker staat op de juiste plek (volgorde van de DOM-elementen afdrukken);
  - geen marker op een andere dag;
  - geen horizontale scroll.
  Testitems daarna opruimen.
- [ ] **Stap 4:** Commit: `feat(kalender): nu-markering en "buiten werkuren" in de gsm-lijst`.

### Task 5: Afronden (hoofdsessie)
- [ ] Eindreview over de hele branch (model: **opus**).
- [ ] Browsercontrole door de hoofdsessie: 1440 en 375, licht en donker thema.
- [ ] Versie 1.7.0 in `package.json`/`package-lock.json`, `CHANGELOG.md` onder `[1.7.0]`, `CACHE_NAME` v15.
- [ ] Samenvatting voor Brent. **Pas na zijn "ja"**: pushen naar main en taggen `v1.7.0`.
