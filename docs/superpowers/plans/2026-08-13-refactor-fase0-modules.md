# Refactor Fase 0: `public/index.html` opsplitsen in modules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De 5 domeinen die vandaag al intern goed afgebakend zijn (Outbox, Rapport-archief,
Excel-export, Prijzencatalogus, Rapport-wizard) uit het ene 7.500+ regels tellende
`public/index.html` trekken naar eigen bestanden onder `public/js/` — zonder enige
gedragswijziging.

**Architecture:** Browser-native ES modules (`<script type="module" src="...">`), geen bundler.
Elke module `export`eert zijn eigen top-level functies/constanten, én hangt elke functie die
vanuit HTML `onclick=`/`onchange=`/... aangeroepen wordt, of vanuit een ANDER bestand aangeroepen
wordt, expliciet aan `window` (`window.functieNaam = functieNaam`). Cross-module-aanroepen
gebeuren via die `window.`-referentie, niet via `import`/`export` tussen de 5 nieuwe bestanden
onderling — dat maakt de 5 extractietaken onderling onafhankelijk uitvoerbaar (geen
laadvolgorde-afhankelijkheid tussen bv. de wizard-module en de outbox-module).
`public/index.html` zelf blijft over als het "restbestand" (kalender/planning/tickets/
beschikbaarheid/UI-chrome) en wordt zelf ook `type="module"` (voor consistente uitvoeringstiming
t.o.v. de andere modules — zie Task 1).

**Tech Stack:** Vanille JS, browser-native ES modules, geen build-stap (bevestigd: geen bundler/
transpiler in dit project — `netlify.toml` zegt letterlijk `command = "echo 'No build step
needed'"`). Geen testframework — verificatie via `node dev-server.mjs` + live browsertest, zoals
de rest van dit project.

**Spec:** `docs/superpowers/specs/2026-08-13-roadmap-inventaris-en-verbeteringen-design.md` (Fase 0)

## Global Constraints

- **Voorwaarde vóór je start:** PR #2 (`worktree-installatie-extra-kosten-rapport`, de
  installatie-meerkosten-rapport-feature) raakt zwaar dezelfde code als Task 5 hieronder
  (rapport-wizard). Merge die branch EERST (na bevestiging door Brent's supervisor over de
  kabelprijzen — zie memory `project_meerkost_kabel_drempel_prijs.md`), vóór je aan dit plan
  begint. Anders moet die hele PR nadien herschreven worden tegen de nieuwe bestandsstructuur.
  Als je hieraan begint zonder dat PR #2 gemerged is: stop en meld dit — vraag niet zelf om
  alvast te beginnen "want het kan toch nog aangepast worden."
- **Geen enkele gedragswijziging in dit hele plan.** Elke taak is een pure verplaatsing van
  bestaande code. Als je tijdens het werk een bug vindt in verplaatste code: verplaats hem mee
  zoals hij is, en meld de bug apart — fix hem niet stiekem terwijl je toch bezig bent (dat maakt
  het onmogelijk om een regressie te onderscheiden van een bewuste fix).
- **Elke taak eindigt met een volledige live-regressietest** van de kernflow van dat domein (zie
  per taak) — dit project heeft geen automatische testsuite.
- **Windowbridge-conventie** (herhaald in elke taak, dit is de kernregel van heel dit plan):
  - Voor elke top-level `function`/`const` die je verplaatst EN die (a) vanuit een HTML
    `onclick=`/`onchange=`/`oninput=`-attribuut wordt aangeroepen, OF (b) vanuit code buiten dit
    nieuwe bestand wordt aangeroepen (zoek dit na met `grep -n "functieNaam("` over heel
    `public/index.html`, exclusief de plek waar hij zelf staat) — voeg onderaan het nieuwe
    bestand een regel toe: `window.functieNaam = functieNaam;`.
  - Functies die uitsluitend intern binnen de nieuwe module gebruikt worden (geen enkele
    `onclick=`/externe aanroep) hoeven niet aan `window` gehangen te worden.
  - Bij twijfel: wél aan `window` hangen — een overbodige window-toewijzing is onschadelijk, een
    ontbrekende breekt de app zichtbaar (ReferenceError in de console, functionaliteit die niet
    meer reageert op een klik).

---

## Task 1: Scaffolding + Outbox-module

**Files:**
- Create: `public/js/outbox.js`
- Modify: `public/index.html` (outbox-declaraties eruit knippen, nieuwe `<script type="module">`-tags toevoegen, hoofd-`<script>`-tag zelf ook `type="module"` maken)

**Interfaces:**
- Produces: `window.flushOutbox`, `window.renderOutboxBanner`, `window.outboxAdd`,
  `window.runOutboxItem`, `window.nextOutboxAction`, `window.refreshOutboxCache` — gebruikt door
  Task 5 (rapport-wizard roept `outboxAdd`/`runOutboxItem`/`nextOutboxAction` aan) en door de
  rest van `index.html` (bv. een `online`-event-listener die vermoedelijk `flushOutbox()`
  aanroept — zoek dit na met `grep -n "flushOutbox("`).

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek in `public/index.html` (huidige branch, dus VÓÓR PR #2 gemerged is — regelnummers
hieronder gelden voor die staat) de volgende declaraties en bevestig dat ze er nog exact zo
uitzien (zoek op naam, regelnummers kunnen ondertussen licht verschoven zijn):
`OUTBOX_DB_NAME`, `OUTBOX_DB_VERSION`, `OUTBOX_STORE`, `_outboxItems`, `outboxOpenDb`,
`outboxAdd`, `outboxPut`, `outboxGetAll`, `outboxRemove`, `nextOutboxAction`,
`refreshOutboxCache`, `renderOutboxBanner`, `logOutboxFailure`, `attemptOutboxItem`,
`_outboxInFlight`, `runOutboxItem`, `flushOutbox`.

**Let op:** deze declaraties liggen NIET allemaal aaneengesloten — `flushOutbox` staat fysiek
veel verderop in het bestand (vlak vóór de rapport-archief-sectie, na `printRapport`), de rest
zit wel aaneengesloten samen (rond `OUTBOX_DB_NAME` tot en met `runOutboxItem`). Knip elke
declaratie apart uit op zijn eigen plek — knip GEEN doorlopend regelbereik, want daartussen
staan ook wizard-eigen state-variabelen (`_wizTicket`, `_wizDate`, `_wizStep`, `_sigTech`,
`_sigKlant`, `_fotoState`) die bij Task 5 horen, niet hier.

- [ ] **Step 2: Nieuw bestand `public/js/outbox.js` aanmaken**

Plak alle 16 declaraties uit Step 1 in deze volgorde in het nieuwe bestand, ONGEWIJZIGD qua
inhoud (enkel de eerste `const`/`let`/`function` van elke declaratie krijgt `export` ervoor):

```js
// public/js/outbox.js
// Lokale IndexedDB-wachtrij voor rapport-verzending (archiveren + Zoho-upload), met retry-logica
// bij offline/mislukte pogingen. Zie docs/superpowers/specs/2026-08-11-rapport-verzend-betrouwbaarheid-design.md
// voor de achtergrond van dit ontwerp.

export const OUTBOX_DB_NAME    = 'blitz-rapport-outbox';
export const OUTBOX_DB_VERSION = 1;
export const OUTBOX_STORE      = 'items';
export let _outboxItems = [];

export function outboxOpenDb() {
  // ... (exacte, ongewijzigde body zoals in het huidige index.html)
}

// ... outboxAdd, outboxPut, outboxGetAll, outboxRemove, nextOutboxAction, refreshOutboxCache,
// renderOutboxBanner, logOutboxFailure, attemptOutboxItem (met export ervoor), _outboxInFlight
// (met export let), runOutboxItem, flushOutbox — telkens de EXACTE bestaande body, enkel
// `export` toegevoegd.

// ── Window-bridge (zie Global Constraints) ──
window.flushOutbox         = flushOutbox;
window.renderOutboxBanner  = renderOutboxBanner;
window.outboxAdd           = outboxAdd;
window.runOutboxItem       = runOutboxItem;
window.nextOutboxAction    = nextOutboxAction;
window.refreshOutboxCache  = refreshOutboxCache;
```

Bevestig zelf, vóór je verdergaat, met `grep -n "outboxOpenDb\|outboxPut\|outboxRemove\|logOutboxFailure\|attemptOutboxItem" public/index.html`
of één van die 5 (niet-hierboven-gebridgde) functies toch ergens buiten dit nieuwe bestand wordt
aangeroepen — zo ja, hang die ook aan `window`.

- [ ] **Step 3: De 16 declaraties uit `public/index.html` verwijderen**

Verwijder exact de 16 declaraties die je in Step 2 hebt overgenomen, op hun oorspronkelijke
plekken. Laat alles ertussen/errond (toast, registerArrival, de wizard-state-variabelen,
printRapport, enz.) volledig ongewijzigd staan.

- [ ] **Step 4: Nieuwe `<script>`-tags toevoegen**

Zoek de bestaande `<script>`-tag die het hele huidige inline script bevat (waarschijnlijk
`<script>` zonder attributen, ergens na de HTML-body). Vervang de openende tag door
`<script type="module">` (dit maakt het HOOFDSCRIPT zelf ook een module — nodig zodat alle
scripts in consistente, gedefereerde volgorde uitvoeren). Voeg er vlak vóór, in deze volgorde,
een nieuwe tag toe:

```html
<script type="module" src="/js/outbox.js"></script>
<script type="module">
  <!-- bestaande hoofdscript-inhoud, nu met de 16 outbox-declaraties eruit -->
</script>
```

- [ ] **Step 5: Service worker bijwerken**

Zoek `public/sw.js`, de `SHELL`-array (of gelijkaardige naam) en `CACHE_NAME`-constante. Voeg
`/js/outbox.js` toe aan de shell-lijst en hoog `CACHE_NAME` met 1 op (bv. `blitz-shell-v1` →
`blitz-shell-v2`) zodat gebruikers met een oude service-worker-cache de nieuwe bestanden ook
effectief ophalen.

- [ ] **Step 6: Verifieer live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Open de browserconsole:
bevestig GEEN rode fouten bij het laden (met name geen "flushOutbox is not defined" of
gelijkaardig — dat zou wijzen op een ontbrekende window-bridge). Doorloop een volledig
interventierapport tot en met "🖨️ Afdrukken / PDF" — bevestig dat het rapport nog steeds in de
outbox terechtkomt en normaal verwerkt wordt (zelfde gedrag als vóór deze taak: archiveren lukt,
of bij offline/trage verbinding het "⏳ nog niet bevestigd"-banner verschijnt). Zet de browser
kort offline (devtools → Network → Offline), maak nog een rapport, zet weer online, bevestig dat
`flushOutbox` de wachtrij alsnog verwerkt (banner verdwijnt / rapport verschijnt in het archief).

- [ ] **Step 7: Commit**

```bash
git add public/js/outbox.js public/index.html public/sw.js
git commit -m "refactor: outbox-module uit index.html trekken naar public/js/outbox.js"
```

---

## Task 2: Rapport-archief-module

**Files:**
- Create: `public/js/rapport-archief.js`
- Modify: `public/index.html`, `public/sw.js`

**Interfaces:**
- Consumes: `window.outboxAdd`/`window.runOutboxItem` (Task 1) — niet rechtstreeks door dit
  bestand zelf, wel door Task 5 die dit bestand se `window.renderRapportArchief` aanroept.
- Produces: `window.renderRapportArchief`, `window.laadRapportArchief`, `window.setRapportFilter`,
  `window.verwijderRapport`, `window.herOpenRapport` — gebruikt door Task 1's `flushOutbox`
  (roept `renderRapportArchief()` aan na het verwerken van de wachtrij) en door Task 5's
  `printRapport`/rapport-wizard-flow.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `_rapportArchief`, `laadRapportArchief`, `setRapportFilter`, `renderRapportArchief`,
`verwijderRapport`, `herOpenRapport` — deze 6 declaraties liggen aaneengesloten (van
`let _rapportArchief = []` tot net vóór `exportTicketLog`).

- [ ] **Step 2: Nieuw bestand `public/js/rapport-archief.js`**

```js
// public/js/rapport-archief.js
// Overzicht van gearchiveerde rapporten (interventie + installatie), met filter op type en
// Excel-export-aanroep (zie excel-export.js). Leest `R`/rapport-records uit de outbox-archivering.

export let _rapportArchief = [];

export async function laadRapportArchief() {
  // ... exacte, ongewijzigde body
}

// ... setRapportFilter, renderRapportArchief, verwijderRapport, herOpenRapport — telkens exact
// dezelfde body, enkel `export` ervoor.

window.renderRapportArchief = renderRapportArchief;
window.laadRapportArchief   = laadRapportArchief;
window.setRapportFilter     = setRapportFilter;
window.verwijderRapport     = verwijderRapport;
window.herOpenRapport       = herOpenRapport;
```

Controleer met `grep -n "_rapportArchief"` of dat array ook van BUITEN dit bestand rechtstreeks
gelezen/gemuteerd wordt (niet enkel via de functies hierboven) — zo ja, moet dat ook een
window-bridge krijgen (`window._rapportArchief` als getter/array-referentie) of moet die
externe code aangepast worden om via een van de geëxporteerde functies te lopen in plaats van
het array rechtstreeks aan te spreken. Meld dit als een afwijking van de rest van dit plan als
je dit tegenkomt — het is de enige plek waar mogelijk meer dan een pure knip-en-plak nodig is.

- [ ] **Step 3: Verwijderen uit `public/index.html`, script-tag + service worker**

Zelfde patroon als Task 1 Step 3-5: verwijder de 6 declaraties uit hun huidige plek, voeg
`<script type="module" src="/js/rapport-archief.js"></script>` toe (na de outbox-tag, vóór het
hoofdscript), voeg `/js/rapport-archief.js` toe aan `sw.js`'s shell-lijst, hoog `CACHE_NAME` weer
met 1 op.

- [ ] **Step 4: Verifieer live in de browser**

Start de dev-server, open de Rapporten-tab. Bevestig: bestaande gearchiveerde rapporten laden en
tonen nog normaal, de filterknoppen "Alle"/"Interventie"/"Installatie" werken nog, "📄 Openen"
opent nog het juiste rapport (test specifiek met het filter actief — dit was ooit een
index-bug, zie eerdere designspec), "🗑 Verwijderen" werkt nog, Excel-export-knop is nog
zichtbaar (de knop zelf werkt pas na Task 3).

- [ ] **Step 5: Commit**

```bash
git add public/js/rapport-archief.js public/index.html public/sw.js
git commit -m "refactor: rapport-archief-module uit index.html trekken naar public/js/rapport-archief.js"
```

---

## Task 3: Excel-export-module (TicketLog)

**Files:**
- Create: `public/js/excel-export.js`
- Modify: `public/index.html`, `public/sw.js`

**Interfaces:**
- Produces: `window.exportTicketLog`.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `async function exportTicketLog()` — dit is de enige declaratie in dit domein (de
"schoonste isolatie-kandidaat" uit het vooronderzoek: raakt geen enkele andere module se state
behalve het rapport-archief dat het als parameter/gedeelde data leest).

- [ ] **Step 2: Nieuw bestand `public/js/excel-export.js`**

```js
// public/js/excel-export.js
// Genereert het TicketLog Excel-exportbestand (ExcelJS, zie CLAUDE.md — nooit SheetJS
// gebruiken, silent style-bug). Leest gearchiveerde rapport-data, schrijft niets terug.

export async function exportTicketLog() {
  // ... exacte, ongewijzigde body
}

window.exportTicketLog = exportTicketLog;
```

Let op: deze functie gebruikt `ExcelJS` (CDN-script, blijft ongewijzigd een klassiek,
niet-module `<script src="...">`-tag — CDN-scripts hoeven niet mee verplaatst/aangepast te
worden) en leest rapport-archiefdata — bevestig dat het geen eigen kopie van `_rapportArchief`
declareert (zou een dubbele state creëren), enkel leest van de gedeelde bron.

- [ ] **Step 3: Verwijderen uit `public/index.html`, script-tag + service worker**

Zelfde patroon: verwijder `exportTicketLog` uit `index.html`, voeg
`<script type="module" src="/js/excel-export.js"></script>` toe, werk `sw.js` bij.

- [ ] **Step 4: Verifieer live in de browser**

Klik "📊 Excel export" op de Rapporten-tab, met een van-tot-datumbereik ingesteld. Bevestig: het
gedownloade `.xlsx`-bestand opent zonder fouten, kolommen zijn nog auto-sized, styling (kleuren,
wrap-tekst) is nog aanwezig — kortom exact hetzelfde bestand als vóór deze taak.

- [ ] **Step 5: Commit**

```bash
git add public/js/excel-export.js public/index.html public/sw.js
git commit -m "refactor: excel-export-module (TicketLog) uit index.html trekken naar public/js/excel-export.js"
```

---

## Task 4: Prijzencatalogus/Prijsbeheer-module

**Files:**
- Create: `public/js/prijzen.js`
- Modify: `public/index.html`, `public/sw.js`

**Interfaces:**
- Produces: `window.zoekOnderdelen`, `window.getAlleTags`, `window.getPrijsVoorId`,
  `window.openPrijsBeheer`, `window.PRIJZEN` (leesbare state-referentie, zie Step 2) — gebruikt
  door Task 5 (rapport-wizard's cataloguszoekfunctie voor "Status & onderdelen").

- [ ] **Step 1: Lees de huidige code ter controle**

Dit is letterlijk de STAART van het huidige bestand — alles vanaf `let PRIJZEN = null;` tot en
met het allerlaatste `}` vóór `</script></body></html>`. Bevestig met `tail -20 public/index.html`
dat het bestand nog zo eindigt (met `getAlleTags`/`getPrijsVoorId` als laatste functies).

Volledige lijst: `PRIJZEN`, `PRIJZEN_DIRTY`, `PRIJZEN_LS_CACHE`, `PRIJZEN_API_URL`,
`PRIJZEN_DEFAULTS`, `loadPrijzen`, `openPrijsBeheer`, `closePrijsBeheer`, `showPrijsEditor`,
`getPrijzen`, `markDirty`, `prijsReset`, `renderPrijsEditor`, `prijsUpdateNaam`,
`prijsUpdatePrijs`, `prijsTariefUpdate`, `prijsVerwijderOnderdeel`, `prijsVerwijderTag`,
`prijsVoegTagToe`, `prijsVoegOnderdeel`, `prijsOpslaan`, `zoekOnderdelen`, `getAlleTags`,
`getPrijsVoorId`.

- [ ] **Step 2: Nieuw bestand `public/js/prijzen.js`**

```js
// public/js/prijzen.js
// Prijzencatalogus (onderdelen + tarieven) en het admin-beheerscherm. `PRIJZEN` is de geladen
// server-state (via /api/prijzen, met localStorage-fallback); `zoekOnderdelen`/`getAlleTags`/
// `getPrijsVoorId` worden door de rapport-wizard gebruikt (via window, zie onderaan).

export let PRIJZEN = null;
export let PRIJZEN_DIRTY = null;
export const PRIJZEN_LS_CACHE = 'blitz_prijzen_cache';
export const PRIJZEN_API_URL  = '/api/prijzen';
export const PRIJZEN_DEFAULTS = {
  // ... exacte, ongewijzigde inhoud
};

export async function loadPrijzen() { /* ... */ }
// ... alle overige functies uit Step 1, telkens exact dezelfde body + `export`.

window.zoekOnderdelen  = zoekOnderdelen;
window.getAlleTags     = getAlleTags;
window.getPrijsVoorId  = getPrijsVoorId;
window.openPrijsBeheer = openPrijsBeheer;
window.loadPrijzen     = loadPrijzen;
```

**Let op — `PRIJZEN`/`PRIJZEN_DIRTY` zijn `let`, geen `const`:** een `export let` exporteert een
LEVENDE binding (andere modules die `import { PRIJZEN } from './prijzen.js'` doen, zien
updates) — maar dit plan gebruikt bewust GEEN cross-module `import`, enkel `window`-bridges.
`window.PRIJZEN = PRIJZEN` zou daarentegen een KOPIE van de huidige waarde vastzetten op het
moment van toewijzen, niet meer meeveranderen bij een latere `loadPrijzen()`-herlaad. Als Task 5
(of iets anders buiten dit bestand) rechtstreeks `PRIJZEN`/`PRIJZEN_DIRTY` als variabele leest
(niet via een functie): zoek dat na met `grep -n "PRIJZEN\b" public/index.html` vóór je Task 5
start, en gebruik daar in plaats van een statische window-toewijzing een kleine
`window.getPrijzenState = () => PRIJZEN;`-achtige accessor-functie, zodat de lezende kant altijd
de actuele waarde krijgt. Beschrijf dit expliciet als een openstaand aandachtspunt in je
Task 5-rapport als je dit patroon nodig hebt.

- [ ] **Step 3: Verwijderen uit `public/index.html`, script-tag + service worker**

Verwijder de volledige staart (Step 1's lijst) uit `index.html` — na deze stap eindigt
`index.html`'s hoofdscript op wat vandaag de kalender/planning/wizard-aanroepende UI-chrome is.
Voeg `<script type="module" src="/js/prijzen.js"></script>` toe, werk `sw.js` bij.

- [ ] **Step 4: Verifieer live in de browser**

Open Instellingen → "Beheer productprijzen" — bevestig dat de admin-editor nog volledig werkt
(categorieën tonen, prijs/naam/tags bewerken, item toevoegen/verwijderen, opslaan). Open een
interventierapport, stap "Status & onderdelen" — bevestig dat de cataloguszoekbalk nog resultaten
toont en een item toevoegen nog werkt (dit hangt af van de window-bridges naar
`zoekOnderdelen`/`getAlleTags`, dus dit is de belangrijkste regressiecheck van deze taak).

- [ ] **Step 5: Commit**

```bash
git add public/js/prijzen.js public/index.html public/sw.js
git commit -m "refactor: prijzencatalogus/prijsbeheer-module uit index.html trekken naar public/js/prijzen.js"
```

---

## Task 5: Rapport-wizard-module (grootste, laatste extractie)

**Files:**
- Create: `public/js/rapport-wizard.js`
- Modify: `public/index.html`, `public/sw.js`

**Interfaces:**
- Consumes: `window.outboxAdd`/`window.runOutboxItem`/`window.nextOutboxAction` (Task 1),
  `window.renderRapportArchief` (Task 2), `window.zoekOnderdelen`/`window.getAlleTags`/
  `window.getPrijsVoorId` (Task 4) — én, zoals genoteerd in Task 4 Step 2, mogelijk een
  `window.getPrijzenState()`-accessor i.p.v. rechtstreekse `PRIJZEN`-lezing.
- Produces: `window.openRapport`, `window.closeWizard`, `window.wizNext`, `window.wizBack`, en elke
  andere `wiz*`-functie die vanuit HTML `onclick=` wordt aangeroepen (zoek dit systematisch na,
  zie Step 3) — gebruikt door de rest van `index.html` (bv. de "📋 Rapport"-knoppen op tickets en
  lokale afspraken roepen `openRapport(...)` aan).

- [ ] **Step 1: Lees de huidige code ter controle**

Dit is het grootste, ~1.300 regels tellende blok, van `let _wizTicket = null;` (staat los, vóór
de outbox-sectie, NIET verplaatst door Task 1) samen met de aaneengesloten sectie van
`const R = { ... }` tot en met `printRapport()` (net vóór `let _rapportArchief`). Volledige lijst
(bevestig elk met `grep -n "^functieNaam\|^const functieNaam\|^let functieNaam"`):

`_wizTicket, _wizDate, _wizStep, _sigTech, _sigKlant, _fotoState, R, WIZ_STEPS, openRapport,
closeWizard, wizRenderStep, wizNext, wizBack, wizV, wizChecked, calcWerktijd, calcWerktijdMin,
updateWerktijd, wizRenderAlgemeen, wizSaveAlgemeen, fmtDuur, berekenLoonkost, wizLoonkostPreview,
wizAutoServicetype, wizRenderFacturatie, wizFacturatieChange, wizServicetypeChange,
wizSaveFacturatie, wizRenderProduct, wizKabelChange, wizSaveProduct, OORZAAK_STORING_MAP,
wizRenderOmschrijving, wizSaveOmschrijving, wizRenderFotos, wizSaveFotos, handleWizFotoFiles,
_wizActiveTags, wizRenderStatus, _wizRenderGeselecteerd, _wizTotaalRij, _wizUpdateCatResults,
wizCatFilter, wizToggleTagFilter, wizVoegCatToe, wizAddVrijeRegel, wizRemovePart, wizUpdSelNaam,
wizUpdSelAantal, wizUpdSelPrijs, wizUpdSelFact, wizUpdSelEenheid, _wizUpdateTotaalRow,
_wizHertekenGeselecteerd, wizUpdatePart, wizAddPart, wizSaveStatus, wizSaveSigTech,
wizSaveSigKlant, wizRenderSigTech, wizClearSigTech, wizRenderSigKlant, wizClearSigKlant,
_rapportUploaded, buildRapportHtml, printRapport`.

**Belangrijke cross-referentie, na te kijken vóór je knipt:** `calcWerktijdMin` wordt OOK gebruikt
buiten dit blok (in de planning/autoPlan-code, bv. rond een berekening van bezette tijd per dag).
Zoek dit na met `grep -n "calcWerktijdMin(" public/index.html` — de aanroep(en) buiten dit blok
moet(en) NIET aangepast worden (blijft een kale `calcWerktijdMin(...)`-aanroep); dat werkt
automatisch via de window-bridge zolang het restbestand ná deze module in de HTML geladen wordt
(zie Step 4) en zelf een klassiek/`type="module"`-script blijft dat de globale scope-chain
gebruikt. Doe dezelfde `grep -n "functieNaam("`-controle voor `fmtDuur`, `wizV`, `wizChecked` —
dit zijn generiek klinkende namen, bevestig dat ze niet per ongeluk ELDERS ook al bestaan
(naamconflict) vóór je verplaatst.

- [ ] **Step 2: Nieuw bestand `public/js/rapport-wizard.js`**

```js
// public/js/rapport-wizard.js
// De rapport-wizard (service rapport voor interventies + installaties): stappen-state (`R`),
// alle wizRender*/wizSave*-stapfuncties, PDF-opbouw (buildRapportHtml) en verzending
// (printRapport, via de outbox-module). Zie CLAUDE.md "Rapport wizard — R object key fields".

export let _wizTicket = null;
export let _wizDate   = null;
export let _wizStep   = 0;
export let _sigTech   = null;
export let _sigKlant  = null;
export let _fotoState = { ticketId: null, versie: 0, fotos: [] };

export const R = {
  // ... exacte, ongewijzigde inhoud
};

export const WIZ_STEPS = [
  // ... exacte, ongewijzigde inhoud
];

export async function openRapport(ticketId, date) { /* ... */ }
// ... alle overige functies/consts uit Step 1, telkens exacte body + `export`.

// ── Window-bridge ──
// Alle wiz*-functies die in index.html via onclick="..." aangeroepen worden (bevestig de
// volledige lijst zelf met: grep -n 'onclick="wiz\|onclick="openRapport\|onclick="closeWizard\|onclick="printRapport' public/index.html)
window.openRapport      = openRapport;
window.closeWizard      = closeWizard;
window.wizNext          = wizNext;
window.wizBack          = wizBack;
window.wizKabelChange   = wizKabelChange;
window.wizCatFilter     = wizCatFilter;
window.wizToggleTagFilter = wizToggleTagFilter;
window.wizVoegCatToe    = wizVoegCatToe;
window.wizAddVrijeRegel = wizAddVrijeRegel;
window.wizRemovePart    = wizRemovePart;
window.wizUpdSelNaam    = wizUpdSelNaam;
window.wizUpdSelAantal  = wizUpdSelAantal;
window.wizUpdSelPrijs   = wizUpdSelPrijs;
window.wizUpdSelFact    = wizUpdSelFact;
window.wizUpdSelEenheid = wizUpdSelEenheid;
window.wizAddPart       = wizAddPart;
window.wizClearSigTech  = wizClearSigTech;
window.wizClearSigKlant = wizClearSigKlant;
window.printRapport     = printRapport;
window.updateWerktijd   = updateWerktijd;
window.wizFacturatieChange  = wizFacturatieChange;
window.wizServicetypeChange = wizServicetypeChange;
// (deze lijst is een startpunt op basis van bekende onclick-patronen in dit project — voer de
// grep hierboven zelf uit en vul aan met elke wiz*-functie die je erin terugvindt en hier nog
// niet staat; ontbrekende bridges geven een zichtbare "function is not defined"-fout bij de
// eerstvolgende klik, dus dit is meteen zichtbaar in Step 4's live-test)
```

- [ ] **Step 3: Alle 65 declaraties uit `public/index.html` verwijderen**

Verwijder ze op hun 2 originele plekken (de losse state-variabelen vóór de outbox-sectie, en de
grote aaneengesloten sectie van `R` tot `printRapport`).

- [ ] **Step 4: Script-tag + service worker**

Voeg `<script type="module" src="/js/rapport-wizard.js"></script>` toe — plaats deze NA de tags
van Task 1 (outbox) en Task 4 (prijzen), aangezien deze module's window-bridges hun
`window.outboxAdd`/`window.zoekOnderdelen`-tegenhangers verondersteld al te bestaan tegen de tijd
dat een gebruiker een knop indrukt (module-scripts voeren in documentvolgorde uit, dus deze
volgorde is voldoende — een absolute laadvolgorde-garantie, geen race condition, aangezien alle
`wiz*`-functies pas bij een KLIK aangeroepen worden, ruim na het initiële scriptuitvoeringsmoment).
Werk `sw.js` bij zoals in de vorige taken.

- [ ] **Step 5: Volledige regressietest — dit is de belangrijkste verificatie van heel Fase 0**

Start de dev-server, open `http://localhost:3333/?test`, `localStorage.removeItem('blitz_prijzen_cache')`
+ herlaad.

Doorloop een VOLLEDIG interventierapport van begin tot PDF: Algemeen → Facturatie (met
loonkost-voorbeeld) → Product → Omschrijving (incl. de oorzaak-storing-validatie) → Foto's toevoegen
→ Status & onderdelen (catalogus doorzoeken, item toevoegen, vrije regel toevoegen) → Handtekening
technieker → Handtekening klant (incl. het live rapport-voorbeeld in de iframe) → "🖨️ Afdrukken /
PDF". Bevestig: geen enkele stap geeft een console-fout, het rapport archiveert normaal, en
`window.renderRapportArchief()` (Task 2) wordt effectief aangeroepen na het verzenden (rapport
verschijnt in de Rapporten-tab).

Herhaal minstens de stappen Algemeen/Foto's/Status/Handtekeningen voor een tweede rapport om te
bevestigen dat `R`/`_wizTicket`/etc. correct resetten tussen twee sessies (ongewijzigd
bestaand gedrag, maar juist dit soort module-scope-state is gevoelig voor een foute verplaatsing).

- [ ] **Step 6: Commit**

```bash
git add public/js/rapport-wizard.js public/index.html public/sw.js
git commit -m "refactor: rapport-wizard-module uit index.html trekken naar public/js/rapport-wizard.js"
```

---

## Task 6: CSS opsplitsen per domein

**Files:**
- Create: `public/css/base.css`, `public/css/wizard.css`, `public/css/prijzen.css`,
  `public/css/rapport-archief.css` (of gebundeld met wizard.css als de secties sterk overlappen —
  zie Step 1), `public/css/app.css` (het overblijvende, kalender/planning/UI-chrome-restant)
- Modify: `public/index.html`, `public/sw.js`

**Interfaces:** geen — CSS heeft geen runtime-interfaces, enkel laadvolgorde is relevant
(`base.css` met de `--accent`/`--surface3`/thema-variabelen moet als eerste `<link>` staan).

- [ ] **Step 1: Lees de huidige `<style>`-sectie ter controle**

Het `<style>`-blok in `public/index.html` (huidig ~1.215 regels) gebruikt al consistente
`/* ── Sectienaam ── */`-commentaarbanners. Maak een lijst van die sectienamen met
`grep -n "── " public/index.html | head -60` en groepeer ze volgens de JS-modules uit Task 1-5
(bv. een sectie "Wizard onderdelen"/"Prijsbeheer" hoort bij `wizard.css`/`prijzen.css`; secties
als "Header"/"Tabs"/"Modals" horen bij `base.css` of `app.css`).

- [ ] **Step 2: CSS-bestanden aanmaken**

Knip elke sectie (inclusief zijn `/* ── ... ── */`-banner-commentaar) naar het bijhorende nieuwe
bestand, ONGEWIJZIGD qua inhoud — dit is een pure verplaatsing, geen herformattering. Thema-
variabelen (`:root { --accent: ...; --surface3: ...; ... }`, licht/donker-thema-blokken) gaan
naar `base.css`, want elk ander bestand gebruikt ze.

- [ ] **Step 3: `<link>`-tags in `public/index.html`**

Vervang het `<style>...</style>`-blok door, in deze volgorde:
```html
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/app.css">
<link rel="stylesheet" href="/css/wizard.css">
<link rel="stylesheet" href="/css/prijzen.css">
```
(pas de exacte bestandslijst aan op wat je in Step 1-2 effectief afgebakend hebt).

- [ ] **Step 4: Service worker**

Voeg alle nieuwe `.css`-bestanden toe aan `sw.js`'s shell-lijst, hoog `CACHE_NAME` weer op.

- [ ] **Step 5: Verifieer live in de browser**

Open de app, doorloop visueel alle belangrijke schermen (kalender, ticket-detail, rapport-wizard
alle stappen, prijsbeheer, instellingen) in zowel licht- als donker-thema (🌙-knop). Bevestig:
geen enkel element ziet er kapot/ongestyled uit — dat zou wijzen op een CSS-sectie die per
ongeluk niet mee verplaatst is, of een verkeerde `<link>`-volgorde (bv. een thema-variabele die
pas na gebruik gedefinieerd wordt).

- [ ] **Step 6: Commit**

```bash
git add public/css/ public/index.html public/sw.js
git commit -m "refactor: CSS opsplitsen per domein onder public/css/"
```

---

## Task 7: v1.0.0 — versie, changelog, tag

**Files:**
- Modify: `package.json`, `CHANGELOG.md`

**Interfaces:** geen.

- [ ] **Step 1: `package.json`**

Bevestig dat `"version": "1.0.0"` er al staat (was al zo, ongebruikt totnogtoe) — dit wordt nu
de eerste ECHTE, getagde release onder de nieuwe conventie (zie `CLAUDE.md` "Versioning &
changelog", en memory `feedback_blitz_versienummering.md`).

- [ ] **Step 2: `CHANGELOG.md` invullen**

Vervang de `## [1.0.0] — nog niet gereleased`-sectie door een ingevulde entry met de datum van
vandaag en de kern van wat Fase 0 opleverde:

```markdown
## [1.0.0] — YYYY-MM-DD

Eerste versie onder de nieuwe versiediscipline — markeert het einde van de bèta-fase.

### Changed
- `public/index.html` opgesplitst in aparte modules onder `public/js/` (outbox, rapport-wizard,
  rapport-archief, excel-export, prijzencatalogus) en `public/css/` — geen zichtbare
  functionaliteitswijziging, wel een onderhoudbaarder codebase voor de features die hierna komen.
```

- [ ] **Step 3: Commit + tag**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: v1.0.0 — release na Fase 0-refactor"
git tag v1.0.0
```

**Let op:** `git push --tags` (of het pushen van deze commit naar `main`) gebeurt pas na
uitdrukkelijke bevestiging van Brent (bestaande projectafspraak, zie memory
`feedback_blitz_deploy_confirm.md`) — dit geldt zowel voor een directe push als voor het mergen
van de PR die dit hele plan oplevert.

---

## Eindcontrole (na alle taken)

- [ ] Volledige, koude paginalaad (harde herlaad, cache leeg) — bevestig dat de service worker
  de nieuwe bestandenset correct precachet (DevTools → Application → Service Workers →
  Cache Storage, controleer dat alle nieuwe `.js`/`.css`-bestanden in de cache staan).
- [ ] `public/index.html`'s regelaantal is nu fors kleiner dan de oorspronkelijke ~7.500 (het
  restbestand bevat enkel nog kalender/planning/tickets/beschikbaarheid/UI-chrome).
- [ ] Doorloop nog eens, in dezelfde sessie na elkaar: een interventierapport, een
  Excel-export, een prijsbeheer-wijziging, en een rapport-archief-filter — bevestig dat geen
  van deze features elkaar stoort (elke module reset/werkt onafhankelijk).
