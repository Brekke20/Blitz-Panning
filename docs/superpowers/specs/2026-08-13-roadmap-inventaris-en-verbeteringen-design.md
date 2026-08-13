# Roadmap: refactor, PDF-verbeteringen en inventarissysteem

**Datum:** 2026-08-13
**Status:** Approved, klaar voor gedetailleerde fase-plannen

## Aanleiding

Brent gaf drie soorten input tegelijk:
1. Een PDF-checklist (`Planning tool_260813_080737.pdf`) met 6 losse verbeterpunten.
2. Een nieuw inventarissysteem: wagenvoorraad per technieker, een "toevoegen aan wagen"-actie
   die de supervisor manueel kan verwerken in AFAS (extern boekhoud-/stocksysteem — **geen**
   integratie, enkel een overzicht), automatische aftrek uit de wagenvoorraad bij
   materiaalgebruik op een rapport, en een lage-voorraad-melding voor de technieker zelf.
3. Vraag om na te denken over een refactor van `public/index.html` (7.661 regels, één bestand),
   en om vanaf nu semver-versienummering + een changelog bij te houden (**al opgezet** — zie
   `CLAUDE.md`, sectie "Versioning & changelog", en `CHANGELOG.md`).

Dit document groepeert alles in fases, met per fase genoeg technisch detail om te weten wat het
werk betekent — de exacte, regel-per-regel implementatieplannen komen per fase apart, vlak vóór
die fase uitgevoerd wordt (zie "Waarom niet alles in één plan" onderaan).

## Volgorde (bevestigd door Brent)

**Fase 0 (refactor) → Fase 1 (PDF-verbeteringen) → Fase 2 (inventarissysteem)**

---

## Fase 0 — Refactor van `public/index.html`

### Waarom nu

7.661 regels in 1 bestand (≈1.215 regels CSS, ≈480 regels HTML-frame, ≈5.963 regels JS in **één**
`<script>`-blok). Alles wat hierna komt (kalender-herwerking, inventaris) voegt makkelijk
1.500-2.500 regels toe aan datzelfde bestand als er niets verandert. Refactoren vóór die nieuwe
code erbij komt is goedkoper dan hem er nadien weer uit te trekken.

### Wat al goed zit (opsplitsen zonder risico)

Uit codeonderzoek blijken 5 domeinen al intern goed afgebakend (eigen sectie-markeringen, weinig
gedeelde state met de rest):

| Domein | Omvang | Belangrijkste functies |
|---|---|---|
| Outbox / offline-verzendlogica | ~290 regels | `outboxAdd/outboxGetAll/nextOutboxAction/attemptOutboxItem/runOutboxItem` |
| Rapport-wizard (incl. installatie-variant) | ~1.300 regels | `R`, `WIZ_STEPS_*`, `wizRender*/wizSave*`, `buildRapportHtml`, `printRapport` |
| Rapport-archief | ~270 regels | `laadRapportArchief/renderRapportArchief/herOpenRapport` |
| Excel-export (TicketLog) | ~190 regels | `exportTicketLog` — "beste isolatie-kandidaat", raakt niets anders |
| Prijzencatalogus/Prijsbeheer | ~380 regels | `PRIJZEN_DEFAULTS/loadPrijzen/renderPrijsEditor/zoekOnderdelen` |

Samen goed voor ~2.430 regels — die eruit trekken brengt het hoofdbestand meteen terug naar
~5.200 regels, zonder gedragswijziging.

### Wat NIET in deze fase gebeurt (bewust uitgesteld)

Eén domein — kalender/planning/route-optimalisatie/beschikbaarheid/foto's-per-ticket/lokale
afspraken — is met ~2.800 regels het grootste, en zit intern volledig door elkaar (geen
sectiegrenzen, gedeelde globals zoals `planning{}`, `allTickets`, `klantBeschikbaarheid{}`
overal). Dit "in het kaal" opsplitsen zonder gedragswijziging is een apart, riskanter project.

**Belangrijker:** Fase 1 (kalender-herwerking, beschikbaarheden-tab, tijdsloten) moet toch bijna
elke functie in dat domein aanraken. Dit domein nu al opsplitsen zou dus dubbel werk zijn — één
keer opsplitsen zonder gedragswijziging, dan meteen daarna weer aanraken om het gedrag te
wijzigen. **Voorstel: dit domein wordt herstructureerd tijdens Fase 1, terwijl we het toch al
herschrijven** — niet als aparte, voorafgaande stap.

### Technische aanpak

- **Geen bundler nodig.** Bevestigd: geen build-stap vandaag (`netlify.toml`: `echo 'No build
  step needed'`; `dev-server.mjs` serveert `public/` kaal als statische bestanden). Browser-
  native `<script type="module" src="...">` werkt dus meteen, zonder build-tooling toe te voegen.
- **Val op te letten:** modules maken geen impliciete globals. De HTML gebruikt overal inline
  `onclick="functieNaam(...)"`. Een functie die naar een module verhuist, moet expliciet
  `window.functieNaam = functieNaam` krijgen (of — beter op termijn, maar niet verplicht nu —
  omgezet worden naar `addEventListener` + `data-*`-attributen, zoals recente code al deels doet).
  Voor déze fase: bridge via `window.x = x` (mechanisch, geen risico), geen grote
  onclick-opkuisronde.
- **CSS**: al goed opgedeeld met sectie-commentaar, 1-op-1 met de JS-domeinen. Kan gewoon per
  domein in een eigen `.css`-bestand, met een gedeeld `base.css` voor thema-variabelen
  (`--accent`, `--surface3`, …) die eerst moeten laden.
- **Service worker** (`public/sw.js`, bestond al — precachet enkel `/`, `/index.html`,
  `/manifest.json`): de `SHELL`-array moet de nieuwe bestanden erbij krijgen + `CACHE_NAME`
  ophogen, anders werken de nieuwe modules niet offline.
- **Bestandsstructuur (voorstel):** `public/js/outbox.js`, `public/js/rapport-wizard.js`,
  `public/js/rapport-archief.js`, `public/js/excel-export.js`, `public/js/prijzen.js`,
  `public/js/app.js` (het overblijvende hoofdbestand: kalender/planning/tickets/beschikbaarheid/
  UI-chrome, tot Fase 1 dat verder opsplitst), plus een gelijkaardige `public/css/`-opdeling.
- **Gedeelde state** (`PRIJZEN`, `R`, `planning{}`, `allTickets`, `settings`, …): waar een module
  enkel LEEST van een andere module se eigen state (bv. wizard leest `PRIJZEN` via de al-bestaande
  "exported" zoekfuncties), gewoon die functies importeren — geen herontwerp van de state zelf
  nodig, enkel module-grenzen rond wat vandaag al de facto de grenzen zijn.

### Wat dit oplevert

Geen zichtbare functionaliteitswijziging voor Brent — puur interne opkuis, te verifiëren via
dezelfde live-browsertest-aanpak als de rest van dit project (geen automatische testsuite,
bevestigd). **Dit is een goed moment voor de v1.0.0-tag**: eerste release na de refactor,
markeert het einde van de bèta-fase zoals Brent vroeg.

---

## Fase 1 — PDF-verbeteringen (6 punten, gegroepeerd in 3 blokken)

### Blok 1A — Bevestigingsknop in de voorstelmail (PDF-punt 1+2, samen 1 feature)

**Vandaag:** `netlify/functions/propose.js` stuurt een voorstel-mail (klant moet antwoorden om te
bevestigen) en zet het ticket op status "Wachten op bevestiging planning".

**Nieuw:** een knop/link in diezelfde mail. Klikken → ticket-status wordt "Geplande support".
Afzeggen blijft zoals vandaag (antwoorden op de mail, geen knop nodig — bevestigd door Brent).

**Technisch:**
- Nieuw: een ondertekende bevestigingslink (bv. HMAC van `ticketId` + geheime sleutel + vervaldatum)
  — dit bestaat nergens in de codebase vandaag, is nieuw te bouwen. Reden: een klant die op een
  link in een e-mail klikt kan niet inloggen, dus de link zelf moet bewijzen dat hij geldig is.
- Nieuwe publieke Netlify-function (bv. `/api/confirm-afspraak`), zonder authenticatie maar met
  token-validatie — consistent met hoe `fotos.js`/`rapport-archief.js` vandaag al publiek
  toegankelijk zijn (met CORS-origin-lijst, geen login).
- PATCH-patroon hergebruiken van `propose.js:316-327` (Zoho-status wijzigen) — dezelfde vorm,
  andere status.
- Knop toevoegen aan `buildEmailHtml()` in `propose.js` (inline-HTML-tabel, geen template-engine
  vandaag — knop wordt een gestylede `<a href="...">`-link, want e-mail-clients voeren geen JS uit).
- Klant krijgt na een klik een simpele bevestigingspagina te zien (nieuw, statisch).

### Blok 1B — Beschikbaarheden-tab + zichtbaarheid in kalender (PDF-punt 3, verduidelijkt)

**Vandaag:** verlof/blokkering ingeven kan enkel via een knop op een specifieke kalenderdag
(`onBlockBtnClick` → `openBlockModal`), niet los. Eens ingegeven, is het enkel zichtbaar als een
klein label in de dag-header — niet als een blok in de planning zelf.

**Nieuw:** een apart tabblad **"Beschikbaarheden"** onder Instellingen (dat vandaag nog één plat
formulier is, geen tabs) waar verlof/ziekte/etc. rechtstreeks ingegeven kan worden, zonder eerst
een dag aan te klikken. Zichtbaar gemaakt in de kalender (zie Blok 1C — dat is waar de
tijdlijn-weergave dit toont als een echt geblokkeerd segment).

**Technisch:** het formulier, de datamodel (`avExceptions[]`) en de opslagfunctie
(`saveAvailability()` → `/api/availability`) bestaan al en worden hergebruikt — enkel een nieuw
toegangspunt (tab i.p.v. per-dag-knop) en de kalender-weergave zijn nieuw.

### Blok 1C — Kalender: dag-tijdlijn i.p.v. gestapelde kaartjes (PDF-punt 4) + tijdsloten (PDF-punt 6)

**Samengevoegd omdat ze dezelfde code raken.** Beide herschrijven hoe een dag in de kalender
getoond wordt.

**Vandaag (`renderKalender()`, weekweergave):** elke dag is een simpele, verticaal gestapelde
lijst van kaartjes, gesorteerd op tekst-vergelijking van het uur — géén tijd-proportionele
layout (geen "9u-blok is twee keer zo hoog als een half-uur-blok"). Startuur is gekend per
ticket, een einduur/duur wordt nergens expliciet bijgehouden per kaart (enkel een losse
instelling `settings.duurMinuten`).

**Bevestigd: geen apart mobiel renderpad.** Dezelfde `renderKalender()`-functie tekent zowel
week- als maandweergave, mobiel/desktop-verschil gebeurt puur via CSS (`.desktop-only`). Dit
betekent: de tijdlijn-herwerking moet **expliciet** een responsive-vertakking krijgen (bv. de
tijdlijn enkel tonen vanaf een bepaalde breedte, mobiel blijft de huidige kaartjeslijst) — er is
vandaag niets dat "gewoon met rust gelaten" kan worden, want het is dezelfde functie.

**Nieuw:**
- Een echte tijdlijn (uur-as, blokken proportioneel aan duur) voor **desktop/web** (bevestigd
  door Brent), mobiel blijft ongewijzigd via een expliciete responsive-vertakking in dezelfde
  render-functie.
- Geblokkeerde/verlof-segmenten (uit Blok 1B) als een echt gepositioneerd blok in de tijdlijn,
  niet enkel een dag-header-label.
- **Tijdsloten (PDF-punt 6):** klant/technieker zien voortaan een configureerbaar tijdvak
  (2-3 uur, bevestigd door Brent) i.p.v. een exact tijdstip. Intern blijft `computeArrivalTimes()`
  / de route-optimalisatie exacte minuten berekenen (bevestigd: dit blijft ongewijzigd) — enkel
  een nieuwe weergave-laag rondom vertaalt een exact tijdstip naar "welk configureerbaar blok valt
  dit in". Raakt: de voorstel-mail (Blok 1A se `buildEmailHtml()`), de technieker-kaart in de
  tijdlijn, en de maandweergave-labels.

### Blok 1D — Lokale caching voor snellere opstart (PDF-punt 5)

**Vandaag:** enkel `loadPrijzen()` heeft een `localStorage`-cache (network-first, valt terug bij
falen — dus niet "toon meteen cache, ververs op de achtergrond"). Tickets/planning/beschikbaarheid/
afspraken/rapport-archief hebben geen enkele client-side caching. Er bestaat al een service
worker (`public/sw.js`), maar die cachet enkel de app-schil, expliciet NIET de `/api/*`-data.

**Nieuw:** een cache-first, "stale-while-revalidate"-laag voor de belangrijkste opstart-data
(tickets, planning, beschikbaarheid) — toon meteen wat lokaal bekend is, ververs meteen daarna op
de achtergrond via de bestaande fetch-calls. Kan als generieke helper gebouwd worden en per
loader (`loadTickets`, `loadAvailability`, …) toegepast worden, naar analogie van het bestaande
`loadPrijzen()`-patroon maar dan echt cache-first i.p.v. network-first-met-fallback.

**Onafhankelijk van Blok 1A-1C** — kan in willekeurige volgorde t.o.v. die blokken.

---

## Fase 2 — Inventarissysteem

### Scope (bevestigd door Brent)

- **Geen integratie met AFAS** (het externe stocksysteem van de algemene voorraad). De
  supervisor wil enkel een **overzicht** van wie wanneer welk materiaal uit de algemene stock
  heeft genomen, zodat hij dat zelf manueel in AFAS kan verwerken.
- **Wagenvoorraad per technieker is volledig nieuw** — bestaat nergens vandaag, wordt vanaf nul
  in deze tool gebouwd.
- **Lage-voorraad-melding**: enkel zichtbaar voor de technieker zelf, in de tool (niet naar de
  supervisor, niet per e-mail — bevestigd).

### Datamodel (voorstel)

- **Wagenvoorraad**: per technieker een lijst `{ materiaalId, aantal }`. `materiaalId` verwijst
  naar de bestaande prijzencatalogus (`netlify/functions/prijzen.js`/`PRIJZEN_DEFAULTS`) —
  dezelfde materiaal-identiteit als nu al gebruikt in rapporten, geen aparte materialenlijst.
  Nieuwe Netlify Blobs-store of nieuwe key in de bestaande `blitz-data`-store.
- **Voorraad-log** ("wie nam wanneer wat uit de algemene stock"): `{ technieker, materiaalId,
  aantal, datum, status: 'nieuw' | 'verwerkt' }`. Ontstaat automatisch elke keer een technieker
  iets aan zijn wagenvoorraad toevoegt. De supervisor krijgt een overzicht van alle `'nieuw'`-
  items, en kan ze als `'verwerkt'` markeren eens hij het manueel in AFAS geboekt heeft (zodat de
  lijst niet oneindig aangroeit met al-verwerkte items).
- **Koppeling met rapporten:** wanneer een technieker materiaal aanduidt op een rapport
  (bestaand `R.onderdelen[]`-mechanisme), wordt dat bij het **afronden/archiveren** van het
  rapport (niet tijdens het bewerken — anders telt een toegevoegd-en-weer-verwijderd item al
  mee) automatisch afgetrokken van zijn wagenvoorraad voor dat materiaal.
- **Lage voorraad**: een drempel per materiaal (of één simpele standaardregel, bv. "0 of minder"),
  getoond als banner aan de technieker bij het openen van de tool of bij het proberen gebruiken
  van een materiaal dat op is — zelfde soort banner-patroon als het bestaande "⏳ rapport nog niet
  bevestigd"-banner.

### Nieuwe UI

- Nieuw hoofdtabblad **"Inventaris"** (naast Kalender/Route/Ingepland/Rapporten): toont de
  wagenvoorraad van de momenteel geselecteerde technieker (dezelfde technieker-selector die
  vandaag al bestaat — er is geen echte login/auth in deze tool, "wie ben ik" = wie er
  geselecteerd staat, zelfde vertrouwensmodel als de rest van de tool vandaag), met een "+
  materiaal toevoegen"-actie (zoekt in dezelfde prijzencatalogus als de rapport-wizard).
- Supervisor-overzicht van openstaande voorraad-log-items (wie/wat/wanneer), met een
  "verwerkt"-knop per regel.
- **Bewust niet in scope (kan later, niet gevraagd):** een overzicht van ALLE technieker-
  wagenvoorraden tegelijk voor de supervisor — enkel de log van wat er genomen werd is gevraagd,
  niet een volledig live overzicht van elke wagen.

### Afhankelijkheid van Fase 0/1

Bouwt bovenop de gerefactorde structuur (eigen `public/js/inventaris.js`-module vanaf het begin,
geen legacy om in te passen) en hergebruikt het rapport-wizard-archiveermoment uit Fase 0's
rapport-wizard-module.

---

## Waarom niet alles in één plan

Dit document dekt de vraag ("werk alles uit, groepeer, geef aan wat uitgesteld wordt"). Een
regel-per-regel implementatieplan (zoals bij eerdere, kleinere features in dit project) voor
Fase 1 en 2 nu al schrijven zou voor een groot deel giswerk zijn: Fase 1's exacte coderegels
verschuiven zodra Fase 0 het bestand opsplitst, en Fase 2 (inventaris) is groot genoeg om zijn
eigen korte brainstorm-ronde te verdienen vlak vóór de bouw (bv. exact welke velden op het
lage-voorraad-banner, exacte styling van de tijdlijn). **Aanpak:** een volledig, uitvoerbaar
implementatieplan voor Fase 0 (refactor) volgt meteen na dit document; Fase 1 en 2 krijgen elk
hun eigen plan vlak vóór ze aan de beurt zijn.

## Niet in scope / bewust uitgesteld

- Volledige herstructurering van het kalender/planning-mega-domein als aparte, losstaande stap
  (gebeurt organisch tijdens Fase 1 in plaats van als voorbereidende stap — zie Fase 0).
- AFAS-integratie (expliciet niet gevraagd).
- Supervisor-overzicht van alle wagenvoorraden tegelijk (enkel de neem-log is gevraagd).
- Mobiele kalender-tijdlijn (blijft de bestaande kaartjeslijst, enkel desktop krijgt de tijdlijn).
- Automatische e-mail/notificatie bij lage voorraad (enkel in-app voor de technieker zelf).
