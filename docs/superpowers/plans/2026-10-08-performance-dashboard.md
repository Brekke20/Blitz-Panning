# Performance-dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Een beheerders-dashboard (tab "Performance" op de beheerpagina) met tijd/stiptheid, kwaliteit, onderdelen, klant/planning en sales, waarin elk percentage een ring met kleurgrenzen is en de sales-resultaten een ringdiagram met legende.

**Architecture:**
- Alle rekenregels staan in kleine pure serverbestanden (`netlify/lib/dashboard/*.js`, samengevoegd door `netlify/lib/dashboard-metrics.js`), los van Blobs en logins getest. Een dunne functie `netlify/functions/dashboard.js` leest de bronnen (`dashboard-bronnen.js`), controleert de rol en geeft kant-en-klare reeksen terug.
- De client tekent met zuivere SVG-generators (`public/js/kern/grafiek-*.js`, geen bibliotheek) en een lazy geladen scherm `schermen/beheer-performance.js` (met logica- en blokbestanden ernaast). Kleurgrenzen en een paar zuivere regels (loonkost, grenzen) zitten in `public/js/kern/` zodat client en server dezelfde code gebruiken.

**Tech Stack:** vanilla ES-modules zonder bouwstap, Netlify Functions v2 + Blobs, `node:test`, `@playwright/test`. Geen nieuwe dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-performance-dashboard-design.md`. Bindend: `docs/superpowers/plans/2026-10-08-koppelvlakken.md` (gebruikt: `vereisGebruiker`/`weigeringV2`, `registreerBeheerTab`, `leesGebruikers`, activiteitenlog, de sales-blob uit `docs/superpowers/specs/2026-10-08-sales-planner-design.md`) en `docs/superpowers/specs/2026-10-08-rapport-achtergrond-upload-design.md` (lichte rapportenlijst, `netlify/lib/rapportlijst.js`).

## Global Constraints

- **Uitvoering:** worktree `.claude/worktrees/refactor-dashboard`, tak `refactor-dashboard` (vertrekt van `refactor`). Na elke taak `git branch --show-current` controleren; nooit committen in een andere checkout. **Nooit mergen of pushen naar `main`** (pre-push-hook; `--no-verify` verboden). Geen versie-, `package.json`- of `CACHE_NAME`-wijziging; wel elk nieuw bestand onder `public/js/` en `public/css/` in `SHELL` van `public/sw.js`. CHANGELOG pas in de laatste taak, onder "Refactor-tak — nog niet uitgebracht".
- **Structuur (bindend, opdrachtgever):** niets toevoegen aan `public/index.html` of `public/js/app.js` behalve één minimale import/registratie-regel (hier: één regel op de plek waar de logins-tabs registreren; `index.html` blijft onaangeroerd, de stijl laadt lazy). Eén verantwoordelijkheid per bestand; geen bestand boven ~300 regels.
- **Geen nieuwe npm-dependencies, geen grafiekbibliotheek:** inline SVG (ringen, donut, kolommen, lijn); horizontale balken zijn rijen met een inline-SVG-balk (`<rect width="62%">`).
- **XSS:** elke tekst uit data (technieker, klant, partner, onderdeel, oorzaak, verkoper) gaat in HTML/SVG-strings door `escHtml` (`public/js/kern/ui.js`), in tooltips door `textContent`.
- **Geen doorlooptijd "ticket aangemaakt → interventie uitgevoerd"** (heropende tickets verstoren die). Wat geen bron met tijdstip heeft, valt weg; er wordt nooit geschat.
- **Rechten:** `GET /api/dashboard` en `/api/dashboard-instellingen` enkel rol `beheerder` (`vereisGebruiker(req, { rollen: ['beheerder'] })`, de PUT met `schrijven: true`); andere rollen 401/403. Het antwoord bevat geen persoonsgegevens van sales-leads (enkel tellingen per verkoper).
- **Blobs:** `getStore({ name: winkelNaam(req), consistency: 'strong' })` uit `netlify/lib/testmodus.js`; in testmodus werkt alles op de testkopie.
- **Tijd:** datums `'YYYY-MM-DD'` in `Europe/Brussels` (`datumInBrussel` uit `netlify/lib/bevestigingslink.js` voor ISO-tijdstippen); periode `van`/`tot` beide inclusief; tijden binnen een dag in minuten na middernacht.
- **Rapportlimiet** gaat van 500 naar **5000** (de gedeelde `netlify/lib/rapportlijst.js` uit de upload-fix).
- **Kleur en grafieken (skill `dataviz`, gevalideerd):** kleur komt als laatste en wordt berekend, niet geschat.
  - *Status (vast, nooit themed)* enkel voor ringen met kleurgrenzen: goed `#0ca30c`, aandacht (oranje) `#fab219`, slecht `#d03b3b`, in licht én donker. Altijd icoon + woord + getal, nooit kleur alleen (op wit haalt aandacht 1,83:1, goed 3,35:1: het icoon + woord + getal in het midden is de verplichte compensatie).
  - *Neutrale ring* (metric zonder grenzen) en elke enkelvoudige reeks: categorisch slot 1 (licht `#2a78d6`, donker `#3987e5`).
  - *Categorisch* (identiteit): vaste volgorde, nooit gecycled, kleur volgt de entiteit niet de rang. Slots licht `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4 #008300 #4a3aa7 #e34948`, donker `#3987e5 #d95926 #199e70 #c98500 #d55181 #008300 #9085e9 #e66767`; meer dan 7 reeksen: de rest in "Overige" (grijs). Sales-resultaten: offerte = slot 1, verkocht = slot 2, geen interesse = slot 3, opnieuw langsgaan = slot 4 (gevalideerd op de app-oppervlakken wit/`#1d252d`: alle checks PASS, enkel contrast licht aqua 2,82 en geel 2,17 geeft WARN; verplichte compensatie: zichtbare legende met aantallen + tabelweergave + 2px oppervlakte-gap).
  - *Mark-specs:* staaf/kolom ≤ 24px dik, 4px afgeronde data-kant en vierkant op de basislijn; lijn 2px; markers ≥ 8px met 2px oppervlakte-ring; gridlijnen hairline 1px, massief; 2px gap in oppervlaktekleur tussen aanliggende vlakken (nooit een rand rond een mark); tekst nooit in de reekskleur (tekst-tokens); geen getal op elk punt; geen dual-axis.
  - *Ring/donut (Brents uitdrukkelijke eis, afwijkend van de skill-voorkeur):* diameter 96px (viewBox 100), dikte 10, start 12 uur met de klok mee, spoor = dezelfde tint op ~20 % over het oppervlak, percentage (heel getal, proportionele cijfers, ≥ 22px semibold) in het midden, onder de ring `n` en de statusregel. Donut maximaal 6 segmenten, altijd legende (kleurblokje + naam + aantal + %), nooit een donut om bijna-gelijke waarden te vergelijken.
  - *Toegankelijkheid:* elke grafiek heeft een tabel-twin (`<details>` "Tabel"), `role="img"` + `aria-label` met de waarde, tooltip = hover én focus (hit-doel ≥ 24px), filters in één rij boven alles, bij herladen de vorige render op verminderde opaciteit houden (geen skeleton). Thema volgt de app: standaard donker, `:root[data-theme="light"]` licht (zoals `public/css/base.css`).
- **Tests:** `node --test` (stijl `tests/voorstelregister.test.mjs`: `node:test`, `assert/strict`, `nepStore`); e2e `npx playwright test` (helpers `e2e/helpers.mjs`, `/api` gestubd). Browsercontrole op `http://localhost:3333/?test` met `node blobs-local-bootstrap.mjs` (kopieer dat bestand en `.env.local` vooraf uit de hoofdmap; `.env.local` nooit committen).
- **Taken gemarkeerd [los van logins]** raken geen auth, geen `rapportlijst.js` en geen beheerpagina en mogen starten vóór de logins en de upload-fix in `refactor` zitten.
- **Commits:** één per taak, Nederlands, met de attributie-regel die de uitvoerder meekrijgt (`Co-Authored-By: …`). Ledger `.superpowers/sdd/2026-10-08-performance-dashboard/progress.md` (niet in git). Na elke taak de skill `opruimen-na-werk`. Dit plan zelf wordt niet gecommit door de planner.

## Bronnen per metric (vastgesteld in de code, 2026-10-08)

Grondregel: `rapport` = een entry uit de lichte rapportenlijst (`rapportlijst`, na de upload-fix zonder `_html`/handtekeningen). Geannuleerde rapporten (`geannuleerd === true` of `verwerking.status === 'geannuleerd'`) tellen nergens mee. Alle rapportvelden komen uit de entry-top (`datum`, `technieker`, `hersteld`, `nieuwInter`, `servicetype`, `facturatie`, `interventieType`) of uit `rapportData` (de wizard-`R`, zonder `fotos`).

| Metric | Exacte bron en regel |
|---|---|
| Aantal interventies | entries met `interventieType === 'Interventie'` in periode+filters |
| Werktijd (basis van alle duren) | `start`/`stop` ("HH:MM"): `stop − start`, **negatief → +1440 (middernacht, bekende bug in `excel-export.js` die dat als 0 telt)**; zonder start/stop: `rapportData.werktijd` tekst ("1u30", "2u", "45 min") ontleden; ≤ 0 of > 720 min = onbetrouwbaar → buiten de gemiddelden en geteld in `dekking`. (Spec noemt `werktijd` eerst; dat is een tekst afgeleid van dezelfde `start/stop`, dus start/stop eerst is gelijkwaardig en betrouwbaarder.) |
| Gem. duur per laadpaaltype / oorzaak / technieker / type bezoek | werktijd gegroepeerd op `rapportData.type` (leeg = "Onbekend"), elke waarde in `oorzaakStoring` (rapport met 2 oorzaken telt in beide), `technieker`, `interventieType` |
| % op tijd | `rapportData.start` ligt in `[geplandTijdslot.van, geplandTijdslot.tot]` (inclusief). `R.start` is de **geregistreerde aankomst** (knop "Aankomst registreren", `registerArrival`), geen planning. Rapporten zonder `geplandTijdslot` (alles van vóór livegang, en lokale afspraken) of zonder geldige `start` tellen niet mee. Te vroeg aankomen = niet op tijd (spec: "binnen"). |
| Rijtijd vs werktijd per dag | som per `datum` van `rapportData.aanrijtijdMin` (>0; 0 = berekening mislukt/geen adres = ontbreekt, nooit meegeteld) tegenover werktijd. `aanrijtijdMin` is de reistijd startlocatie → adres (niet vanaf de vorige stop): de titel zegt "aanrijtijd (schatting vanaf startlocatie)". |
| Interventies per dag per technieker | aantal entries per (`datum`, `technieker`) |
| % first-time-fix | enkel `Interventie`: `hersteld === 'ja' && nieuwInter === 'nee'` / aantal interventies |
| Herhaalbezoeken | rapport B (Interventie) is herhaal als er een eerder rapport A (Interventie, `dagen(B.datum − A.datum)` van 1 t/m N, N = 30 of 90) bestaat met dezelfde genormaliseerde `serienummer`, anders (bij ontbrekend serienummer) hetzelfde genormaliseerd `adres` (≥ 6 tekens). A mag buiten de gekozen periode liggen (er wordt op de volledige lijst gezocht); B volgt periode en filters. |
| Top-oorzaken per type | `oorzaakStoring` × `rapportData.type` |
| Top 10 onderdelen, waarde, verbruik per maand/technieker/type | `rapportData.onderdelen[]` (`id`, `naam`, `aantal`, `prijs`). **Waarde = `prijs` zoals in het rapport staat** (de wizard kopieert de prijslijst bij het kiezen en laat aanpassen; zo blijft historische waarde juist, en het is dezelfde som als `totaalOnderdelen`/TicketLog); is `prijs` leeg of 0 en is `id` een catalogus-id, dan de prijs uit de blob `prijslijst`; anders 0 (geteld als "zonder prijs"). Alle gebruikte onderdelen tellen mee, ook niet-factureerbare. Groepering op `id`, voor vrije regels (`vrij-…`) op genormaliseerde naam. (Afwijking van de spec-formulering "× prijslijst".) |
| Bevestigingssnelheid voorstel | voorstelregister (`voorstel-status`): per ticket `status[id].klant/contact/installateur` = ISO-tijdstip verstuurd (client `new Date().toISOString()`), `status[id].bevestigd = { door, tijdstip }` (ISO, server, **enkel geschreven door `confirm-afspraak` na een klik op de knop**). Snelheid = `bevestigd.tijdstip − status[id][bevestigd.door]`. Valt weg per voorstel als `door` null is (oude link) of het verzendtijdstip van die doelgroep ontbreekt. Beperking: bij opnieuw versturen (`reset`) en bij annuleren (`wisVoorstel`) verdwijnt de oudere stand: enkel het laatste, nog bestaande voorstel per ticket telt. |
| % bevestigd via de knop | zelfde register: teller = voorstellen met `bevestigd`; noemer = voorstellen met een verzendtijdstip in de periode, **zonder lopende** (niet bevestigd en jonger dan 14 dagen, de levensduur van de link). Handmatig bevestigen schrijft niets in het register: de ring meet dus "via de knop", niet "bevestigd". Periode = vroegste verzendtijdstip (Brusselse datum). Technieker- en laadpaalfilter gelden hier niet (register kent ze niet): de UI zegt dat. |
| Aantal annulaties | **Er is vandaag geen annulatieregister**: `annuleer.js` wist enkel het register van het ticket (`wisVoorstel`) en schrijft een notitie in Zoho; nergens staat een tijdstip in een blob. Bron wordt daarom het activiteitenlog van de logins (`activiteit/<YYYY-MM>`, `{ versie, items: [{ op, gebruikerId, naam, actie, onderwerp?, details? }] }`, actie `'annulatie'`), **enkel vanaf de livegang van de logins**; `dekking.annulatiesVanaf` = datum van de oudste log-entry (elke actie). Eerder: geen cijfer. Reden-verdeling valt weg (niet gegarandeerd in het log). |
| Garantie vs klant (ring), waarde onderdelen + loon | enkel `Interventie` (de wizard slaat de facturatiestap bij Installatie over, `servicetype` blijft daar op de standaardwaarde): % `servicetype === 'garantie'`; per groep (garantie / overige) som onderdelenwaarde en som `berekenLoonkost(servicetype, werktijdMin, aanrijtijdMin).bruto` (nieuwe pure module `kern/loonkost.js`); rapport zonder bruikbare werktijd telt niet mee voor loon. |
| % met installateur, per partner/regio | ring: `rapportData.installateur` gevuld (CLAUDE.md-conventie). **Let op:** de wizard vult dat veld vooraf met `ticket.partner \|\| ticket.account`, het percentage zal hoog zijn (open punt). Per partner/regio: `partner` en `regio` worden **vanaf livegang** in `rapportData` bewaard (Taak 16; `regio`/`partner` staan op het Zoho-ticket maar niet in het rapport); oudere rapporten vallen in die twee uitsplitsingen weg (`dekking`). |
| Bezoeken per verkoper per week | `sales/<id>.leads[].bezoeken[]` (datum, resultaat, op) plus het slotresultaat `lead.resultaat` als dat niet al als bezoek (zelfde `op`) in `bezoeken` staat (de sales-spec noemt beide); week = maandag-datum |
| Sales-resultaten (ringdiagram) | zelfde bezoeken in de periode, `resultaat` ∈ offerte / verkocht / geen-interesse / opnieuw |
| Leads die wachten | leads met `status === 'te-plannen'`; wachttijd = nu − max(`geimporteerdOp`, laatste bezoek-`op`); momentopname (geen periode). |

---

## Review Focus

De vijf invoerklassen die de spec niet noemt maar die het eerst zullen bijten; elk heeft een test in de genoemde taak.

1. **Lege of dunne data** (geen rapporten, noemer 0, één rapport, rapport zonder `geplandTijdslot`/serienummer/`start`): nooit `NaN`, `Infinity` of deling door nul; ring toont "—" zonder statuskleur en "geen gegevens". (Taak 3, 4, 5, 10)
2. **Werktijd over middernacht en vergeten stop-uur** (22:00 → 02:00 = 240 min, niet 0; 08:00 → 07:59 of > 12 u = onbetrouwbaar, buiten de gemiddelden, wel geteld). (Taak 3)
3. **Dubbele of ingetrokken rapporten:** `geannuleerd`-entries tellen niet; een heropend/herverzonden rapport staat één keer in de lijst (dedup ticket+datum) en mag een herhaalbezoek niet vervalsen: dezelfde ticket+datum telt nooit als herhaal van zichzelf. (Taak 3, 5)
4. **Tekst met opmaak/script** in technieker, klant, partner, oorzaak, onderdeelnaam en verkopersnaam: overal ge-escaped in tegel-, ring-, legende-, tooltip- en tabel-HTML. (Taak 10–13, 19)
5. **Tijdzone en zomertijd aan de randen:** voorstel verstuurd om 23:30 UTC is de volgende dag in Brussel; `van`/`tot` inclusief; "vorige periode" even lang over een zomer-/wintertijdwissel; de week begint op maandag. (Taak 3, 7, 8)
6. (Bijkomend) **Niet-beheerder en grote lijst:** 401/403 zonder cijfers; de rapportenlijst van 5000 stuks blijft binnen de 6 MB-antwoordgrens van de lijst-GET en binnen de functie-tijdlimiet. (Taak 15, 17)

---

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `public/js/kern/loonkost.js` (nieuw, T1) | `berekenLoonkost` uit de wizard, zuiver; wizard hergebruikt het |
| `public/js/kern/dashboard-grenzen.js` (nieuw, T2) | standaardgrenzen, validatie, `statusVoor` (client én server) |
| `netlify/lib/dashboard/gemeenschappelijk.js` (T3) | werktijd, rapport-normalisatie, periodes, filters, kleine statistiek |
| `netlify/lib/dashboard/tijd.js`, `kwaliteit.js`, `onderdelen.js`, `klant.js`, `sales.js`, `kern.js` (T4–T9) | één metricblok per bestand |
| `netlify/lib/dashboard-metrics.js` (T9) | `berekenDashboard(invoer)`: voegt de blokken samen |
| `netlify/lib/dashboard-bronnen.js` (T17) | enige I/O: leest rapportlijst, prijslijst, register, log, sales |
| `netlify/functions/dashboard.js`, `dashboard-instellingen.js` (T17) | dunne handlers |
| `public/js/kern/grafiek-ring.js`, `grafiek-donut.js`, `grafiek-balken.js`, `grafiek-lijn.js`, `grafiek-tabel.js` (T10–T13) | SVG/HTML-generators |
| `public/css/dashboard.css` (T10) | kleurtokens licht/donker + ring/grafiekstijl |
| `public/js/schermen/beheer-performance-logica.js` (T14) | periode-presets, tegeldefinities, query, opmaak |
| `public/js/schermen/beheer-performance.js` + `beheer-performance-{tijd,kwaliteit,onderdelen,klant,sales}.js` (T18–T19) | scherm en blokrenderers |
| `public/js/rapport-wizard.js`, `schermen/ticketdetail-logica.js` (T16), `public/js/rapport-archief.js` (T20) | geplandTijdslot/partner/regio bewaren; rapport openen op id |
| `tests/dashboard-*.test.mjs`, `tests/fixtures/dashboard-testset.mjs`, `e2e/performance.spec.mjs`, `e2e/fixtures/dashboard.json` | tests |

---

### Task 0: Worktree en nulmeting

**Files:** geen codewijziging.

- [ ] **Step 1: Worktree aanmaken** — `cd "C:/Users/BRENT/OneDrive - Hertsens Transport (Walding)/Claude-Projects/blitz-planning/.claude/worktrees/planner-brein" && git worktree add ../refactor-dashboard -b refactor-dashboard refactor`. Controleer `git -C ../refactor-dashboard branch --show-current` = `refactor-dashboard`.
- [ ] **Step 2: Omgeving** — in de nieuwe worktree `npm ci`; kopieer `.env.local` en `blobs-local-bootstrap.mjs` uit de hoofdmap (niet committen). Ledger-map `.superpowers/sdd/2026-10-08-performance-dashboard/` aanmaken.
- [ ] **Step 3: Nulmeting** — `node --test` en `npx playwright test --project=chromium`; noteer de aantallen (baseline) in de ledger. Beide moeten groen zijn voor je verder gaat.

### Task 1: `kern/loonkost.js` [los van logins]

**Files:** Create `public/js/kern/loonkost.js`; Modify `public/js/rapport-wizard.js:491-507`; Test `tests/loonkost.test.mjs`.

**Interfaces:** Produces `berekenLoonkost(servicetype, werktijdMin, aanrijtijdMin) -> { bruto, totMin, extraUren, gestartUren?, netto? }` (zelfde formules en teruggegeven velden als nu: 2e-lijn `175 + extraUren×75` met extra = `ceil(uren − 3)` boven 3 u; 1e-lijn en garantie `ceil(uren)×115`, garantie `netto: 0`).

- [ ] **Step 1: Test eerst** (`tests/loonkost.test.mjs`): `berekenLoonkost('2e-lijn', 120, 30).bruto === 175`; `('2e-lijn', 180, 60)` → totMin 240, extraUren 1, bruto 250; `('1e-lijn', 61, 0).bruto === 230`; `('garantie', 90, 0)` → bruto 230, netto 0; `undefined` invoer telt als 0.
- [ ] **Step 2: Run, verwacht FAIL** (`node --test tests/loonkost.test.mjs`).
- [ ] **Step 3: Verplaats de functie ongewijzigd** naar `kern/loonkost.js`; in `rapport-wizard.js` `import { berekenLoonkost } from './kern/loonkost.js'` en `export { berekenLoonkost }` zodat de `window.berekenLoonkost`-brug en `rapport-archief.js` blijven werken.
- [ ] **Step 4: Run** de nieuwe test en daarna `node --test` + `npx playwright test e2e/instellingen-rapport.spec.mjs e2e/rapport-verzenden.spec.mjs`: groen.
- [ ] **Step 5: Commit** `refactor: berekenLoonkost naar kern/loonkost.js (gedeeld met dashboard)`.

### Task 2: `kern/dashboard-grenzen.js` [los van logins]

**Files:** Create `public/js/kern/dashboard-grenzen.js`; Test `tests/dashboard-grenzen.test.mjs`.

**Interfaces:**
```js
export const RING_METRICS = ['opTijd','firstTimeFix','bevestigdViaKnop','garantie','metInstallateur'];
export const STANDAARD_GRENZEN = { // groen = drempel voor groen, oranje = drempel voor oranje; null = neutraal; richting 'hoog' = hoog is goed
  opTijd:{groen:90,oranje:75,richting:'hoog'}, firstTimeFix:{groen:80,oranje:65,richting:'hoog'},
  bevestigdViaKnop:{groen:null,oranje:null,richting:'hoog'}, garantie:{groen:null,oranje:null,richting:'laag'},
  metInstallateur:{groen:null,oranje:null,richting:'hoog'} };
export function valideerGrenzen(invoer) // -> { ok:true, waarde:grenzen } | { ok:false, fout:string }  (vult ontbrekende sleutels aan met de standaard; getallen 0-100; hoog: groen ≥ oranje; laag: groen ≤ oranje; groen en oranje samen null of samen getal)
export function statusVoor(sleutel, pct, grenzen = STANDAARD_GRENZEN) // -> 'goed'|'aandacht'|'slecht'|'neutraal'|null (null = geen gegevens)
```
Beslist op het **afgeronde** getal dat de ring toont (89,6 toont 90 en is groen).

- [ ] **Step 1: Tests:** `statusVoor('opTijd', 90) === 'goed'`; `89.4 → 'aandacht'` (rondt naar 89); `89.6 → 'goed'`; `75 → 'aandacht'`; `74.4 → 'slecht'`; `statusVoor('firstTimeFix', 80) === 'goed'`, `64.9 → 'aandacht'` (rondt naar 65); `statusVoor('metInstallateur', 50) === 'neutraal'`; `statusVoor('opTijd', null) === null`; richting laag: grenzen `{groen:5,oranje:10,richting:'laag'}` → 3 goed, 7 aandacht, 12 slecht; `valideerGrenzen({opTijd:{groen:70,oranje:80,richting:'hoog'}}).ok === false`; `valideerGrenzen({opTijd:{groen:90,oranje:null}})` ongeldig (één null); `valideerGrenzen({}).waarde` deep-equal de standaard; 101 en `'abc'` ongeldig.
- [ ] **Step 2: Run, FAIL.** **Step 3: Implementeer** de drie exports. **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat(dashboard): kleurgrenzen en statusregels`.

### Task 3: `dashboard/gemeenschappelijk.js` [los van logins]

**Files:** Create `netlify/lib/dashboard/gemeenschappelijk.js`; Test `tests/dashboard-gemeenschappelijk.test.mjs`.

**Interfaces (Produces):**
```js
export const TYPE_ONBEKEND = 'Onbekend', MAX_WERKTIJD_MIN = 720;
export function werktijdMinuten(rd) // number|null, regel zie Bronnen: start/stop met middernacht-wrap; anders rd.werktijd-tekst; ≤0 of >720 → null
export function normaliseerRapport(entry, { prijzen = new Map() } = {}) // -> Rapport | null  (null = geannuleerd of zonder datum YYYY-MM-DD)
// Rapport = { id, datum, technieker, ticketId, ticketNumber, klant, adres, type, interventieType, hersteld:bool, nieuwInter:bool,
//   servicetype, facturatie, werktijdMin:number|null, werktijdOnbetrouwbaar:bool, aanrijtijdMin:number|null, start:string,
//   oorzaken:string[], onderdelen:[{sleutel,naam,aantal,prijs,prijsBron:'rapport'|'prijslijst'|'geen'}], serienummer:string,
//   installateur:bool, partner:string|null, regio:string|null, geplandTijdslot:{van,tot}|null }
// prijzen: Map<catalogusId, { naam, prijs }>
export function normaliseerSerienummer(s) // trim, hoofdletters, spaties weg; '' als leeg
export function normaliseerAdres(s)       // lowercase, diakrieten weg, enkel [a-z0-9]; '' als < 6 tekens
export function dagenTussen(a, b)         // hele dagen b − a (YYYY-MM-DD, UTC-rekenen: zomertijd-veilig)
export function inPeriode(datum, van, tot) // inclusief
export function vorigePeriode(van, tot)   // { van, tot } even lang, direct vóór `van`
export function weekStart(datum)          // maandag van die week, YYYY-MM-DD
export function filterRapporten(rapporten, { technieker = '', type = '' } = {}) // '' = alles
export function pct(teller, noemer)       // null bij noemer 0, anders 1 decimaal
export function gemiddelde(waarden)       // null bij leeg
export function mediaan(waarden)          // null bij leeg
```

- [ ] **Step 1: Tests:**
  - [RF2] `werktijdMinuten({start:'22:00',stop:'02:00'}) === 240`; `({start:'08:00',stop:'09:30'}) === 90`; `({start:'08:00',stop:'07:59'}) === null` (23u59 > 720); `({start:'08:00',stop:'08:00'}) === null`; `({werktijd:'1u30'}) === 90`, `'2u' → 120`, `'45 min' → 45`, `'' → null`; `({}) === null`.
  - `normaliseerRapport`: `geannuleerd:true` → null; `verwerking:{status:'geannuleerd'}` → null; `datum:''` → null; `rapportData.type:''` → `type === 'Onbekend'`; ontbrekende `rapportData` (oude entry) crasht niet; `hersteld:'ja'` → `true`; `rapportData.installateur:'Proxes'` → `installateur === true`, `''` → false; `rapportData.partner` ontbreekt → `partner === null`; onderdeel `{id:'led',prijs:'8',aantal:2}` → prijs 8, prijsBron 'rapport'; `{id:'led',prijs:'',aantal:1}` met `prijzen` Map → prijs uit Map, 'prijslijst'; `{id:'vrij-1',naam:' Zekering ',prijs:'',aantal:1}` → prijs 0, 'geen', sleutel `'zekering'`; `werktijdOnbetrouwbaar` true bij 25 uur; `aanrijtijdMin 0` → null.
  - `normaliseerSerienummer(' charx-12 34 ') === 'CHARX-1234'`; `normaliseerAdres('Antwerpseweg 50, 2440 Geel') === 'antwerpseweg502440geel'`; `normaliseerAdres('Geel') === ''`.
  - [RF5] `dagenTussen('2026-03-28','2026-03-30') === 2` (zomertijdwissel); `vorigePeriode('2026-10-01','2026-10-08')` = `{van:'2026-09-23',tot:'2026-09-30'}`; `weekStart('2026-10-08') === '2026-10-05'`, `weekStart('2026-10-11') === '2026-10-05'`, `weekStart('2026-10-12') === '2026-10-12'`.
  - [RF1] `pct(0,0) === null`; `pct(1,3) === 33.3`; `gemiddelde([]) === null`; `mediaan([1,3,2,10]) === 2.5`; `filterRapporten` met `type:'Dual 1'` en `technieker:'Tim'`.
- [ ] **Step 2: Run, FAIL.** **Step 3: Implementeer** (geen I/O, geen imports behalve niets nodig; datums via `Date.UTC`). **Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat(dashboard): gemeenschappelijke rapportnormalisatie en periodehulpen`.

### Task 4: `dashboard/tijd.js` [los van logins]

**Files:** Create `netlify/lib/dashboard/tijd.js`; Test `tests/dashboard-tijd.test.mjs`.

**Interfaces:** Consumes `Rapport[]` (Task 3, al op periode+filters gefilterd).
```js
export function gemiddeldeDuur(rapporten)   // minuten|null over Interventies met werktijdMin ≠ null
export function opTijd(rapporten)           // { n, opTijd, pct } over rapporten met geplandTijdslot én geldige start (inclusief grenzen)
export function berekenTijd(rapporten)      // -> { duurPer:{ laadpaal:[{sleutel,label,n,gemMin}], oorzaak:[…], technieker:[…], bezoektype:[…] },
//   opTijdPerTechnieker:[{technieker,n,opTijd,pct}], opTijdTotaal:{n,opTijd,pct},
//   rijtijdPerDag:[{datum,aanrijtijdMin,werktijdMin,n}], perDagPerTechnieker:{ datums:[…], techniekers:[…], waarden:{[tech]:{[datum]:n}} },
//   dekking:{ rapporten, metDuur, duurOnbetrouwbaar, metSlot, zonderSlot, metAanrijtijd } }
// lijsten aflopend op n; techniekers in volgorde van eerste voorkomen (vaste kleur), dagen oplopend
```

- [ ] **Step 1: Tests:** (a) twee interventies 60 en 120 min + een installatie 180 → `gemiddeldeDuur === 90`, `duurPer.bezoektype` bevat `Installatie` met 180; (b) [RF2] 22:00→02:00 telt 240 mee, een rapport met 25 u valt buiten het gemiddelde en `dekking.duurOnbetrouwbaar === 1`; (c) `opTijd`: slot 08:30–11:30 met start 08:30 → op tijd (grens inclusief), 11:31 → niet, 08:29 → niet; rapport zonder slot telt niet in `n`, wel in `dekking.zonderSlot`; (d) [RF1] lege lijst → `gemiddeldeDuur === null`, `opTijd` `{n:0,opTijd:0,pct:null}`, alle lijsten leeg, geen `NaN`; (e) rapport met 2 oorzaken telt in beide `duurPer.oorzaak`-rijen; (f) `rijtijdPerDag` negeert `aanrijtijdMin === null` maar telt de werktijd; (g) `perDagPerTechnieker.techniekers` in volgorde van eerste voorkomen.
- [ ] **Step 2–4:** FAIL → implementeren → PASS. **Step 5: Commit** `feat(dashboard): tijd en stiptheid`.

### Task 5: `dashboard/kwaliteit.js` [los van logins]

**Files:** Create `netlify/lib/dashboard/kwaliteit.js`; Test `tests/dashboard-kwaliteit.test.mjs`.

**Interfaces:**
```js
export function firstTimeFix(rapporten)    // { n, ftf, pct } enkel interventieType 'Interventie'
export function herhaalbezoeken(alle, geselecteerd, dagen) // -> [{ id, ticketNumber, datum, vorigeId, vorigeDatum, dagen, technieker, klant, sleutel }]  (alle = volledige Rapport[]; geselecteerd = periode+filters)
export function berekenKwaliteit({ rapporten, alle, herhaalDagen = 30 }) // -> { ftfTotaal, ftfPerTechnieker:[{sleutel,label,n,ftf,pct}], ftfPerType:[…],
//   herhaal:{ dagen, aantal, lijst:[…max 200] }, topOorzaken:[{oorzaak,n,perType:{[type]:n}}] (top 8), dekking:{ interventies, herhaalZonderSleutel } }
```

- [ ] **Step 1: Tests:** (a) `hersteld ja + nieuwInter nee` telt, `ja+ja` niet, `nee+nee` niet; installaties tellen niet; (b) [RF1] geen interventies → `pct === null`; (c) herhaal: zelfde serienummer 20 dagen eerder → herhaal bij 30 en bij 90; 45 dagen eerder → enkel bij 90; zelfde datum → nooit herhaal [RF3]; zelfde ticket+datum (dubbele entry) → nooit herhaal van zichzelf [RF3]; zonder serienummer maar zelfde `normaliseerAdres` → herhaal; serienummer én adres leeg → geen herhaal, `dekking.herhaalZonderSleutel` +1; eerder rapport vóór de periode telt mee, het eerdere moet `Interventie` zijn; (d) `topOorzaken` sorteert op n, `perType` klopt, maximum 8.
- [ ] **Step 2–4**, **Step 5: Commit** `feat(dashboard): kwaliteit en herhaalbezoeken`.

### Task 6: `dashboard/onderdelen.js` [los van logins]

**Files:** Create `netlify/lib/dashboard/onderdelen.js`; Test `tests/dashboard-onderdelen.test.mjs`.

**Interfaces:**
```js
export function waardeTotaal(rapporten) // -> { waarde, aantal, zonderPrijs }  (som aantal×prijs; aantal = som van aantallen)
export function berekenOnderdelen(rapporten) // -> { top10:[{sleutel,naam,aantal,waarde,rapporten}] (aflopend op aantal, dan waarde),
//   perMaand:{ maanden:['2026-09',…], perTechnieker:{[tech]:{[maand]:{aantal,waarde}}}, perType:{[type]:{[maand]:{aantal,waarde}}}, totaal:{[maand]:{aantal,waarde}} },
//   dekking:{ rapporten, metOnderdelen, zonderPrijs } }
```
Naam van een rij: de meest voorkomende `naam` binnen de groep.

- [ ] **Step 1: Tests:** twee rapporten met 2× `led` (8 €) en 1× `led` → top10[0] `{aantal:3, waarde:24, rapporten:2}`; `prijsBron:'geen'` telt 0 en `dekking.zonderPrijs === 1`; niet-factureerbaar telt mee; vrije regel ' Zekering ' en 'zekering' vormen één groep; maanden oplopend en aaneensluitend ('2026-08', '2026-09', '2026-10' ook als september leeg is); top10 begrensd op 10; [RF1] lege lijst → `waarde 0`, lege lijsten.
- [ ] **Step 2–5:** `feat(dashboard): onderdelen`.

### Task 7: `dashboard/klant.js` [los van logins]

**Files:** Create `netlify/lib/dashboard/klant.js`; Test `tests/dashboard-klant.test.mjs`.

**Interfaces:** Consumes `Rapport[]`, `voorstelregister` (vorm uit `netlify/lib/voorstelregister.js`: `{ versie, status:{[ticketId]:{contact?,klant?,installateur?,tijdslot?,tijdslotDatum?,bevestigd?:{door,tijdstip}}} }`), `activiteit` (`[{op,actie,…}]`), `nu` (ISO).
```js
export function voorstellen(register, { van, tot, nu }) // -> [{ ticketId, verstuurd:ISO, datum, bevestigdOp:ISO|null, door, snelheidMin:number|null, lopend:bool }]
export function berekenKlant({ rapporten, register, activiteit, van, tot, vorigeVan, vorigeTot, nu })
// -> { bevestiging:{ n, mediaanMin, gemiddeldeMin, nMetSnelheid, buckets:[{label,n}] /* <1u, 1–4u, 4–24u, 1–3d, >3d */ },
//      bevestigdViaKnop:{ n, bevestigd, pct },
//      annulaties:{ aantal, vorige, beschikbaar:bool, vanaf:'YYYY-MM-DD'|null },
//      garantie:{ n, garantie, pct, onderdelenWaarde:{garantie,overig}, loon:{garantie,overig}, zonderWerktijd },
//      installateur:{ n, met, pct, perPartner:[{label,n,met}], perRegio:[{label,n,met}] },
//      dekking:{ voorstellen, lopend, annulatiesVanaf, partnerRegioMetVeld, partnerRegioTotaal } }
```
Gebruikt `berekenLoonkost` uit `public/js/kern/loonkost.js` (relatief `../../../public/js/kern/loonkost.js`) en `datumInBrussel` uit `../bevestigingslink.js`.

- [ ] **Step 1: Tests:**
  - [RF5] voorstel `klant:'2026-10-05T22:30:00.000Z'` valt op datum `2026-10-06` (Brussel) en dus in een periode die op 6/10 begint, niet in één die op 5/10 eindigt.
  - Snelheid: verstuurd 09:00, `bevestigd:{door:'klant', tijdstip: +3 u}` → 180 min; `door:null` → geen snelheid maar wél `bevestigd` in de ring; `door:'installateur'` zonder `installateur`-tijdstip → geen snelheid; buckets: 180 min → '1–4u'.
  - `lopend`: niet bevestigd en 5 dagen oud → buiten de noemer; niet bevestigd en 20 dagen oud → in de noemer; `bevestigdViaKnop` 1 van 2 → 50.
  - [RF1] leeg register → `pct null`, `mediaanMin null`.
  - Annulaties: log met 3 `annulatie`-items waarvan 1 in de vorige periode; `vanaf` = datum van het oudste item (elke actie); periode die vóór `vanaf` begint → `beschikbaar:false` voor `vorige`; log leeg → `aantal 0, beschikbaar:false, vanaf:null`.
  - Garantie: 2 interventies (1 garantie 60 min, 1 `2e-lijn` 120 min) → pct 50, loon garantie = `berekenLoonkost('garantie',60,0).bruto`; Installatie telt niet; rapport zonder werktijd → `zonderWerktijd` +1.
  - Installateur: `installateur:true` voor 3 van 4 → 75; `perPartner` groepeert enkel rapporten met `partner !== null`; `dekking.partnerRegioMetVeld`.
- [ ] **Step 2–5:** `feat(dashboard): klant en planning`.

### Task 8: `dashboard/sales.js` [los van logins]

**Files:** Create `netlify/lib/dashboard/sales.js`; Test `tests/dashboard-sales.test.mjs`.

**Interfaces:** Consumes `salesBlobs: [{ verkoper:string, leads:Lead[] }]` (blob `sales/<id>` uit de sales-spec; `verkoper` = `salesNaam || naam` van de gebruiker, door `dashboard-bronnen.js` ingevuld).
```js
export const SALES_RESULTATEN = ['offerte','verkocht','geen-interesse','opnieuw']; // vaste volgorde = kleurslots 1-4
export function bezoekenVanLead(lead) // -> [{ datum, resultaat, op }]  bezoeken[] + lead.resultaat als dat niet al (zelfde op) in bezoeken staat; resultaat 'geen-interesse' enz. gelijk aan de sales-spec
export function berekenSales({ salesBlobs, van, tot, nu }) // -> { perWeek:{ weken:[maandag…], verkopers:[…], waarden:{[verkoper]:{[week]:n}} },
//   resultaten:{ totaal, perSoort:[{soort,n,pct}] }, wachtend:{ n, gemDagen, oudsteDagen, buckets:[{label,n}] /* <7d,7–14d,14–30d,>30d */, perVerkoper:[{verkoper,n}] }, dekking:{ verkopers, bezoeken } }
```

- [ ] **Step 1: Tests:** bezoeken buiten de periode tellen niet; week = maandag; slotresultaat zonder dubbele telling als `bezoeken` het al bevat (zelfde `op`), wél geteld als het enkel in `lead.resultaat` staat; `resultaten.perSoort` altijd 4 rijen in vaste volgorde (ook met 0); [RF1] geen sales-blobs → alle nul en lege lijsten, `pct` 0 niet NaN; wachtend: lead `te-plannen`, `geimporteerdOp` 10 dagen geleden → bucket '7–14d'; lead met recent bezoek `opnieuw` wacht vanaf dat bezoek; leads met andere status tellen niet; [RF4] verkopersnaam met `<b>` blijft ruwe tekst in de data (escaping gebeurt in de client).
- [ ] **Step 2–5:** `feat(dashboard): sales`.

### Task 9: `dashboard/kern.js` en `dashboard-metrics.js` + testset [los van logins]

**Files:** Create `netlify/lib/dashboard/kern.js`, `netlify/lib/dashboard-metrics.js`, `tests/fixtures/dashboard-testset.mjs`, `scripts/maak-dashboard-fixture.mjs`; Test `tests/dashboard-metrics.test.mjs`.

**Interfaces:**
```js
// kern.js
export function berekenKern({ rapporten, alle, herhaalDagen }) // -> { interventies:{n}, gemDuurMin:{waarde,n}, opTijd:{pct,n}, firstTimeFix:{pct,n}, herhaalbezoeken:{aantal}, onderdelenWaarde:{waarde} }
// dashboard-metrics.js
export function berekenDashboard({ rapporten /*ruwe entries*/, register, activiteit, salesBlobs, prijslijst /*blob of null*/,
  filters:{ van, tot, technieker='', type='', herhaalDagen=30 }, nu /*ISO*/ })
// -> { versie:1, gegenereerd:nu, periode:{van,tot}, vorige:{van,tot}, filters, opties:{ techniekers:[…vaste volgorde], types:[…] },
//      kern:{ huidig:<berekenKern>, vorige:<berekenKern> }, tijd, kwaliteit, onderdelen, klant, sales, dekking:{ tijd, kwaliteit, onderdelen, klant, sales } }
```
`opties` komen uit de **ongefilterde** volledige lijst (filter-keuzes verdwijnen nooit); `type: ''` = alles. Technieker-/laadpaalfilter geldt voor tijd, kwaliteit, onderdelen en de rapportgebonden delen van klant; niet voor het voorstelregister, het annulatielog en sales (de UI meldt dat).

- [ ] **Step 1: Testset** `maakTestset()` (deterministisch, `nu = '2026-10-08T10:00:00+02:00'`): ~24 rapporten over twee periodes (techniekers Tim/Roel/een naam met `<img src=x>`, types Single/Dual 1/leeg, oorzaken, onderdelen, een geannuleerd, een zonder `geplandTijdslot`, een over middernacht, een zonder serienummer), een register met bevestigde, lopende en annulatie-gewiste voorstellen, een log, twee verkopers met leads/bezoeken, een prijslijst.
- [ ] **Step 2: Tests** (`tests/dashboard-metrics.test.mjs`): kernwaarden voor huidig en vorige periode kloppen met vooraf berekende getallen uit de testset (aantal, gem. duur, op-tijd-%, ftf-%, herhaal, waarde); filter `technieker:'Tim'` wijzigt de rapportgebonden delen maar niet `klant.bevestiging` of `sales`; `opties.techniekers` is gelijk met en zonder filter; [RF1] lege invoer geeft een volledig gevormd resultaat zonder `NaN` (`JSON.stringify` bevat geen `null` waar een getal hoort behalve bewust `pct:null`); resultaat bevat geen sleutels `naam/gsm/email` van leads; `JSON.stringify(resultaat).length < 200000`.
- [ ] **Step 3: Implementeer** `kern.js` en `dashboard-metrics.js` (roept de zes blokken aan, `normaliseerRapport` één keer op de volledige lijst, prijzen-Map uit `prijslijst.onderdelen`). **Step 4: Run** `node --test tests/dashboard-*.test.mjs`: PASS.
- [ ] **Step 5: `scripts/maak-dashboard-fixture.mjs`** schrijft `berekenDashboard(maakTestset())` naar `e2e/fixtures/dashboard.json` (voor Taak 21); run en commit het bestand.
- [ ] **Step 6: Commit** `feat(dashboard): berekenDashboard en testset`.

### Task 10: `kern/grafiek-ring.js` + `public/css/dashboard.css` [los van logins]

**Files:** Create `public/js/kern/grafiek-ring.js`, `public/css/dashboard.css`; Test `tests/grafiek-ring.test.mjs`.

**Interfaces:**
```js
export const STATUS_TEKST = { goed:{icoon:'✓',woord:'Op doel'}, aandacht:{icoon:'!',woord:'Let op'}, slecht:{icoon:'✕',woord:'Onder doel'} };
export function ringSvg({ pct, status, titel, grootte = 96 }) // -> string <svg role="img" aria-label="{titel}: 87 %"> spoor + boog + percentage in het midden; pct null → "—"; geen boog
export function ringFiguur({ pct, status, titel, n = null, noemer = null, sub = '' }) // -> <figure class="ring ring--{status|geen}"> ringSvg + <figcaption> met statusregel (icoon+woord, enkel bij goed/aandacht/slecht), `n van noemer` of "geen gegevens", sub
```
Boog = cirkel met `stroke-dasharray` (omtrek `2π·45`), `stroke-linecap="round"`, `transform="rotate(-90 50 50)"`; pct begrensd 0–100; midden toont `Math.round(pct)` + "%". CSS-klassen i.p.v. inline kleuren: `.ring--goed/--aandacht/--slecht/--neutraal/--geen` zetten `--ring-kleur`, spoor via `color-mix(in srgb, var(--ring-kleur) 20%, var(--surface))`.

- [ ] **Step 1: Kleurtokens vaststellen en valideren (dataviz stap 3):** `public/css/dashboard.css` definieert onder `:root` (donker) en `:root[data-theme="light"]` (licht) `--viz-1..8` (categorisch, zie Global Constraints), `--viz-goed/--viz-aandacht/--viz-slecht`, `--viz-ink`, `--viz-ink2`, `--viz-muted`, `--viz-grid`, `--viz-as`, `--viz-overige`. Voer uit en bewaar de uitvoer in de ledger: `node "<dataviz-skill>/scripts/validate_palette.js" "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7" --mode light --surface "#ffffff"` en `… "#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9" --mode dark --surface "#1d252d"`. Een FAIL (niet WARN) betekent: stap de slot bij volgens "snap-to-passing" en herhaal; WARN op contrast mag enkel met de compensaties uit Global Constraints. De statuskleuren en de donut-slots 1-4 zijn hierboven al PASS gemeten (licht wit, donker `#1d252d`).
- [ ] **Step 2: Tests:** `ringSvg({pct:87,status:'goed',titel:'Op tijd'})` bevat `role="img"`, `aria-label="Op tijd: 87 %"`, `>87%<`, `stroke-dasharray` met de verwachte lengte (87 % van `2π·45` ≈ 245,9); `pct:null` → `>—<` en geen boog-element; `pct:140` en `-5` worden 100 en 0 (geen NaN in de string); [RF4] `titel:'<script>x</script>'` komt ge-escaped terug; `ringFiguur` bij `status:'aandacht'` bevat `!` en `Let op`; bij `status:'neutraal'` geen statusregel; `n:12, noemer:15` toont `12 van 15`; bij `pct:null` `geen gegevens` en klasse `ring--geen`.
- [ ] **Step 3: Implementeer** en **Step 4: Run, PASS.**
- [ ] **Step 5: Kijken (dataviz stap 7):** een wegwerp-HTML in de scratchpad met alle vijf toestanden in licht en donker openen in de browserpane (`http://localhost:3333/?test` via `node dev-server.mjs`, of `file://`) en controleren op overlap, afgekapte tekst en leesbaarheid; niet committen.
- [ ] **Step 6: Commit** `feat(dashboard): ring-SVG en kleurtokens`.

### Task 11: `kern/grafiek-balken.js` en `kern/grafiek-tabel.js` [los van logins]

**Files:** Create `public/js/kern/grafiek-balken.js`, `public/js/kern/grafiek-tabel.js`; Test `tests/grafiek-balken.test.mjs`.

**Interfaces:**
```js
// grafiek-tabel.js
export function grafiekTabel({ kolommen, rijen, titel }) // -> <details class="tabel-twin"><summary>Tabel</summary><table> (kolommen:[string], rijen:[[cel…]]); alles ge-escaped; getallen rechts met tabular-nums
// grafiek-balken.js
export function balkenRijen({ rijen, slot = 1, eenheid = '', titel }) // rijen:[{label,waarde,tekst?}] → HTML-raster: label (wrap) | <svg width="100%" height="16" role="img"> balk (rect met %-breedte, 4px afgerond aan de data-kant, vierkant aan de basis, ≤ 24px) | waardetekst aan de balkpunt; + tabel-twin
export function gestapeldeKolommen({ categorieen, reeksen, titel, eenheid = '', maxReeksen = 7 }) // categorieen:[string], reeksen:[{sleutel,label,slot,waarden:[number]}] → <svg viewBox> kolommen met 2px gap, hairline gridlijnen + ticks (nette afronding), legende, tabel-twin; meer dan maxReeksen → rest in 'Overige' (grijs); elke kolom/segment heeft <title> en tabindex=0 (hover én focus)
export function gestapeldeBalken({ categorieen, reeksen, titel }) // horizontale variant voor 'top-oorzaken per type'
```
Reeks-`slot` komt van buiten (kleur volgt de entiteit, niet de rang).

- [ ] **Step 1: Tests:** `balkenRijen` met waarden 10/5 → eerste rect `width="100%"`, tweede `width="50%"`; alle waarden 0 → breedte 0 en geen NaN; label-tekst ge-escaped [RF4]; `gestapeldeKolommen` met 9 reeksen → 7 + 'Overige', slots niet hergebruikt; waarde 0 tekent geen rect; ticks `0 / 1.000 / 2.000`-stijl voor max 1840 (`Intl nl-BE`); elke kolom bevat `<title>` met categorie + reeks + waarde; lege `categorieen` → leeg-bericht, geen crash; `grafiekTabel` ge-escaped.
- [ ] **Step 2–5:** FAIL → implementeer → PASS → commit `feat(dashboard): balken, kolommen en tabel-twin`.

### Task 12: `kern/grafiek-donut.js` [los van logins]

**Files:** Create `public/js/kern/grafiek-donut.js`; Test `tests/grafiek-donut.test.mjs`.

**Interfaces:**
```js
export function donutSvg({ segmenten, titel, midden }) // segmenten:[{sleutel,label,waarde,slot}] (slot 1-8 → var(--viz-N)); -> <svg role="img" aria-label="{titel}: …">; midden = { groot:'48', klein:'bezoeken' }
export function donutLegende(segmenten) // -> <ul class="legende"> kleurblokje + label + aantal + % (de verplichte identiteitskanaal); ook bij 0 totaal
export function donutFiguur({ segmenten, titel, midden }) // svg + legende + <details> tabel-twin (via grafiek-tabel.js)
```
Segmentvolgorde = invoervolgorde (vaste volgorde, nooit op grootte herschikt); elk segment = cirkel met `stroke-dasharray`/`dashoffset`, 2px korter dan zijn aandeel (de gap in oppervlaktekleur); segmenten met waarde 0 krijgen geen boog maar wel een legenderij; totaal 0 → neutrale lege ring met "geen gegevens".

- [ ] **Step 1: Tests:** vier segmenten 10/20/30/40 → vier boog-elementen met `stroke="var(--viz-1)"`…`--viz-4`, som van de dash-lengtes = omtrek − 4×2; segment 0 → 3 bogen en 4 legenderijen; totaal 0 → geen NaN, tekst `geen gegevens`; legenderij toont `30 (30 %)`; [RF4] label `<b>x</b>` ge-escaped in svg-aria-label, legende en tabel; meer dan 6 segmenten → fout gooien (`RangeError`) zodat een verkeerd gebruik opvalt.
- [ ] **Step 2–5:** FAIL → implementeer (gebruikt `grafiekTabel` uit Taak 11) → PASS → commit `feat(dashboard): ringdiagram met legende`.

### Task 13: `kern/grafiek-lijn.js` [los van logins]

**Files:** Create `public/js/kern/grafiek-lijn.js`; Test `tests/grafiek-lijn.test.mjs`.

**Interfaces:**
```js
export function lijnGrafiek({ punten, reeksen, titel, eenheid = 'min' }) // punten:[string datums]; reeksen:[{sleutel,label,slot,waarden:[number|null]}] (max 4, één y-as) → <svg viewBox> 2px lijnen (ronde join/cap), eind-marker r=4 met 2px oppervlakte-ring, label aan het eind in tekstkleur + legende, onzichtbare verticale hit-stroken ≥ 24px breed met <title> (alle reeksen op die dag), hairline gridlijnen, ticks met nette afronding; null onderbreekt de lijn; tabel-twin
```

- [ ] **Step 1: Tests:** twee reeksen over 3 dagen → twee `<path>` met `stroke-width="2"`; `null` in het midden → twee subpaden (`M` twee keer); één punt → enkel een marker, geen pad; geen dual-axis (één set ticks); `<title>` per dag bevat beide waarden; alle waarden null → leeg-bericht; titel/labels ge-escaped [RF4]; meer dan 4 reeksen → `RangeError`.
- [ ] **Step 2–5:** FAIL → implementeer → PASS → commit `feat(dashboard): lijngrafiek`.

### Task 14: `schermen/beheer-performance-logica.js` [los van logins]

**Files:** Create `public/js/schermen/beheer-performance-logica.js`; Test `tests/beheer-performance-logica.test.mjs`.

**Interfaces:**
```js
export const PRESETS = [{id:'deze-maand',label:'Deze maand'},{id:'vorige-maand',…},{id:'kwartaal',label:'Dit kwartaal'},{id:'jaar',label:'Dit jaar'},{id:'zelf',label:'Zelf kiezen'}];
export function periodeVoorPreset(preset, nu /*Date*/, zelf = null) // -> { van, tot } (YYYY-MM-DD, Brussel); 'tot' loopt voor deze maand/kwartaal/jaar tot en met vandaag (zodat de vorige, even lange periode eerlijk vergelijkt); vorige maand = volledige vorige maand
export function maakQuery(filters) // -> '?van=…&tot=…&technieker=…&type=…&herhaal=30' (encodeURIComponent; lege filters weggelaten)
export const TEGELS = [ // volgorde en gedrag van de kerncijfer-tegels
  { sleutel:'interventies', label:'Interventies', soort:'aantal', omhoogIsGoed:null },
  { sleutel:'gemDuurMin', label:'Gemiddelde duur', soort:'duur', omhoogIsGoed:false },
  { sleutel:'opTijd', label:'Op tijd', soort:'ring', ringSleutel:'opTijd', omhoogIsGoed:true },
  { sleutel:'firstTimeFix', label:'First-time-fix', soort:'ring', ringSleutel:'firstTimeFix', omhoogIsGoed:true },
  { sleutel:'herhaalbezoeken', label:'Herhaalbezoeken', soort:'aantal', omhoogIsGoed:false },
  { sleutel:'onderdelenWaarde', label:'Waarde onderdelen', soort:'euro', omhoogIsGoed:null } ];
export function verschil(huidig, vorige, omhoogIsGoed) // -> { tekst:'↑ 12 %'|'↓ 3,5 pt'|'= 0'|'—', richting:'op'|'neer'|'gelijk'|'geen', goed:true|false|null }  (ringen: procentpunten; geen vorige of vorige 0 → '—' voor aantallen)
export function formatDuur(min)   // 90 → '1u30', 45 → '45 min', null → '—'
export function formatEuro(x)     // nl-BE, geen decimalen boven 1000
export function kleurSlotVoor(sleutel, lijst) // stabiele categorische slot (1-7, daarna 'overige') op volgorde in `lijst` (= opties.techniekers, vaste volgorde)
```

- [ ] **Step 1: Tests:** [RF5] `periodeVoorPreset('deze-maand', new Date('2026-10-08T10:00:00+02:00'))` = `{van:'2026-10-01',tot:'2026-10-08'}`; `'vorige-maand'` = `{van:'2026-09-01',tot:'2026-09-30'}`; `'kwartaal'` = `{van:'2026-10-01',tot:'2026-10-08'}`; `'jaar'` = `{van:'2026-01-01',tot:'2026-10-08'}`; 31 december rond middernacht correct in Brussel; `maakQuery({van,tot,technieker:'Tim & Co',type:'',herhaalDagen:90})` bevat `technieker=Tim%20%26%20Co`, geen `type=`, `herhaal=90`; `verschil(80, 70, true)` → `{tekst:'↑ 10 pt', richting:'op', goed:true}`, `verschil(60, 70, false)` (duur lager = goed) → `goed:true`; `verschil(5, 0, null)` → `'—'`; `formatDuur(90) === '1u30'`; `kleurSlotVoor('Roel', ['Tim','Roel']) === 2`, achtste → `'overige'`.
- [ ] **Step 2–5:** FAIL → implementeer → PASS → commit `feat(dashboard): schermlogica (periodes, tegels, verschil)`.

### Task 15: Bijwerken met logins + upload-fix, rapportlimiet 5000 en meting

Vooronderstelling: de logins staan in `refactor` en de upload-fix (v1.10.2) is via `git merge main` in `refactor` gekomen (opzichter).

**Files:** Modify `netlify/lib/rapportlijst.js`, `netlify/functions/rapport-archief.js`; Create `scripts/meet-rapportlijst.mjs`; Test `tests/dashboard-rapportlijst.test.mjs`.

- [ ] **Step 1: Bijwerken** — in de worktree `git merge refactor`. **Controle (stop bij een ontbrekend onderdeel en meld het als koppelvlakgat, niets nabouwen of stubben):** `netlify/lib/auth.js` exporteert `vereisGebruiker`, `weigeringV2`; `netlify/lib/gebruikers.js` exporteert `leesGebruikers`, `publiek`; `netlify/lib/activiteit.js` bestaat en `netlify/functions/annuleer.js` roept `logActiviteit` aan met actie `'annulatie'` (`grep -n "annulatie" netlify/functions/annuleer.js`); `public/js/schermen/beheer.js` exporteert `registreerBeheerTab`; `netlify/lib/rapportlijst.js` bestaat; `rapport-archief.js` kent `?inhoud=`. Noteer in het ledger de gevonden namen (de upload-spec noemt geen export voor "lijst lezen" of de limiet; gebruik wat er staat).
- [ ] **Step 2: Test eerst** (`tests/dashboard-rapportlijst.test.mjs`, nepStore): na 5001 toegevoegde entries bevat de lijst er 5000 (de oudste valt weg); de lijst-GET zonder parameter geeft maximaal de nieuwste 500 terug (`?limiet=` tot 5000 is toegelaten, groter wordt 5000) en `versie` blijft de echte versie; een bestaand 500-testgeval in de suite wordt bijgewerkt naar de nieuwe constante, niet verwijderd.
- [ ] **Step 3: Implementeer** in `rapportlijst.js` een geëxporteerde `MAX_RAPPORTEN = 5000` (vervangt de vaste `500`/`slice`) en in de lijst-GET de `limiet`-parameter (standaard 500: het Rapporten-tabblad blijft precies zoals nu, en blijft onder de 6 MB-antwoordgrens van Netlify Functions). Het dashboard leest de volledige lijst rechtstreeks via de store (Taak 17), niet via HTTP.
- [ ] **Step 4: Meting** — `scripts/meet-rapportlijst.mjs <blob.json>` print aantal, gemiddelde bytes per entry en projectie bij 5000; draai op de testkopie (`blitz-data-test`, `rapportlijst`) en noteer in het ledger. **Beslisregel:** projectie > 4 MB → het ledger krijgt het punt "splitsen per jaar (`rapportlijst-<jaar>`) nodig" en het wordt in het eindverslag gemeld; het dashboard leest dan meerdere blobs, via de ene functie `leesRapportenVoorDashboard` in Taak 17. (Schatting vooraf: ~2 KB per lichte entry, dus ~10 MB bij 5000; bij het huidige tempo duurt het jaren voor de lijst zo groot is, de limiet is een plafond.)
- [ ] **Step 5: Run** `node --test`: groen. **Commit** `feat(rapporten): lijstlimiet 5000, lijst-GET met limiet`.

### Task 16: `geplandTijdslot`, `partner` en `regio` in het rapport

**Files:** Modify `public/js/schermen/ticketdetail-logica.js`, `public/js/rapport-wizard.js` (`openRapportIntern` ~129-200, `CONCEPT_UIT` ~line 58); Test `tests/gepland-tijdslot.test.mjs`.

**Interfaces:** Produces in `ticketdetail-logica.js`:
```js
export function geplandTijdslotVoor({ voorstel, datum, planUur, isLocal, settings }) // -> { van:'HH:MM', tot:'HH:MM' } | null
```
Regel (spec): (1) `voorstel.tijdslot` ("08:30–11:30", en-streepje) als `voorstel.tijdslotDatum === datum`; (2) anders `tijdslotVoor(timeStrToMin(planUur), undefined, settings)` rond het geplande uur (`planUur` = `stop.uur` uit `toestand.get('planning')[datum]`, stop met `ticket.id === ticketId`); (3) `isLocal` of niets bekend → `null`.

- [ ] **Step 1: Test:** voorstel met passende datum → het voorgestelde slot; voorstel met andere `tijdslotDatum` → valt terug op `planUur` ('09:10', settings `tijdslotMinuten:180` → het slot dat `tijdslotVoor` geeft); `isLocal:true` → `null`; geen voorstel en geen `planUur` → `null`; ongeldig tijdslot-formaat → terugval op `planUur`.
- [ ] **Step 2: Run, FAIL. Step 3: Implementeer** `geplandTijdslotVoor`; in `openRapportIntern`, vóór het concept wordt teruggezet: `R.geplandTijdslot = geplandTijdslotVoor({ voorstel: toestand.get('voorstelStatus')[ticketId], datum: date, planUur, isLocal: !!ticket.isLocal, settings: toestand.get('settings') })`, `R.partner = ticket.partner || ''`, `R.regio = ticket.regio || ''`. Voeg `'geplandTijdslot'`, `'partner'`, `'regio'` toe aan `CONCEPT_UIT` zodat een teruggezet concept ze nooit overschrijft of bewaart. Ze reizen mee in `rapportData` (de spread van `R` in `printRapport` neemt ze mee; controleer dat `fotos` het enige uitgesloten veld blijft).
- [ ] **Step 4: Run** unit-test en `npx playwright test e2e/rapport-verzenden.spec.mjs e2e/instellingen-rapport.spec.mjs`; breid één bestaande e2e-assertie uit zodat de outbox-`archiveBody.rapportData` `geplandTijdslot`, `partner`, `regio` bevat.
- [ ] **Step 5: Commit** `feat(rapport): geplandTijdslot, partner en regio bewaren voor het dashboard`.

### Task 17: Server — bronnen en handlers

**Files:** Create `netlify/lib/dashboard-bronnen.js`, `netlify/functions/dashboard.js`, `netlify/functions/dashboard-instellingen.js`; Modify `netlify.toml` (`[functions.dashboard] timeout = 26`); Test `tests/server-dashboard.test.mjs`.

**Interfaces:**
```js
// dashboard-bronnen.js (enige I/O)
export async function leesRapportenVoorDashboard(store) // -> ruwe entries (volledige lijst; via rapportlijst.js, evt. meerdere jaarblobs)
export async function leesBronnen(store, { van, tot, vorigeVan }) // -> { rapporten, register:leesRegister(store), activiteit:[items van de maandblobs `activiteit/<YYYY-MM>` die [vorigeVan..tot] raken], salesBlobs:[{verkoper, leads}], prijslijst:blob|null }
export async function leesGrenzen(store) / schrijfGrenzen(store, grenzen, versie)  // blob `dashboard-instellingen` = { versie, grenzen }, optimistische locking (409 bij oude versie), validatie via valideerGrenzen
// functions/dashboard.js  (v2, maakHandler({ getStore }) zoals annuleer.js)
// GET /api/dashboard?van&tot&technieker&type&herhaal  -> berekenDashboard(...) JSON; 400 bij ongeldige datum (YYYY-MM-DD, van ≤ tot, max 800 dagen); 401/403 via weigeringV2
// functions/dashboard-instellingen.js: GET -> { versie, grenzen }; PUT { grenzen, versie } -> { versie } | 409 | 400
```
Sales: `leesGebruikers(store)` → gebruikers met `rol === 'sales'` → `store.get('sales/' + id, { type: 'json' })`; `verkoper = salesNaam || naam`. Ontbrekende blob = lege leads. Elke bron in een eigen `try`: faalt één bron (bv. log), dan blijft de rest werken en meldt `dekking.fouten: ['activiteit']` (nooit een 500 om één blok).

- [ ] **Step 1: Tests (nepStore + nep-gebruiker via de testmodus-rolheader of een geïnjecteerde `vereis`):** zonder login 401; rol `planner` en `technieker` 403; `beheerder` 200 met `kern`/`tijd`/…; `?van=2026-13-01` 400; `van > tot` 400; PUT zonder `X-Blitz: 1` 403; PUT met ongeldige grenzen 400; PUT met oude `versie` 409; een bron die gooit (log) geeft 200 met `dekking.fouten`; [RF6] een store met 5000 lichte entries geeft binnen redelijke tijd (< 2 s lokaal) een antwoord < 200 kB.
- [ ] **Step 2: Run, FAIL. Step 3: Implementeer.** `dashboard.js` blijft dun: parseren, `vereisGebruiker`, `leesBronnen`, `berekenDashboard`, JSON. In testmodus `zorgVoorTestkopie` zoals de andere functies.
- [ ] **Step 4: Run** `node --test`: PASS. Start `node dev-server.mjs`, en controleer in de browser (`?test`, rol beheerder) dat `/api/dashboard?van=2026-10-01&tot=2026-10-08` JSON geeft; en dat de relatieve import van `public/js/kern/loonkost.js` en `dashboard-grenzen.js` door de functie-bundel meekomt (bij de eerste Netlify-preview opnieuw controleren: open punt in het eindverslag).
- [ ] **Step 5: Commit** `feat(dashboard): /api/dashboard en /api/dashboard-instellingen`.

### Task 18: Scherm — skeleton, filters, tegels, grenzen

**Files:** Create `public/js/schermen/beheer-performance.js`; Modify de plek waar de logins de beheer-tabs registreren (grep `registreerBeheerTab`): **één** regel `registreerBeheerTab({ id: 'performance', label: 'Performance', render: c => import('./beheer-performance.js').then(m => m.render(c)) })`; Modify `public/sw.js` (`SHELL`: alle nieuwe `public/js/…` en `public/css/dashboard.css`); Test `tests/beheer-performance.test.mjs`.

**Interfaces:** `export async function render(container)`: laadt `dashboard.css` lazy (één `<link>` dat het scherm zelf toevoegt, `index.html` onaangeroerd), tekent de filterrij (periode-presets + zelf kiezen, technieker, type laadpaal, herhaalbezoek 30/90 dagen), haalt `/api/dashboard` + `/api/dashboard-instellingen`, tekent de zes tegels (ring via `ringFiguur` + `statusVoor`, overige als getal met `verschil`-pijl en woord), roept de vijf blokrenderers aan (Taak 19) en toont `dekking` als voetnoten ("Op basis van 38 van 52 rapporten, 14 zonder gepland tijdslot", "Annulaties sinds 12/10"). Bij herladen: vorige render blijft op opaciteit 0,6 staan. Een instellingen-paneel (tabelletje per ring: groen-drempel, oranje-drempel, richting) schrijft via PUT met `bewaarMetVersie` uit `kern/api.js`; fouten als `toast`.

- [ ] **Step 1: Test** (pure deel, node): een `tegelHtml(tegel, data, grenzen)`-functie in dit bestand of in `-logica.js` (plaats ze in `beheer-performance-logica.js` als ze zuiver is): ring-tegel `opTijd` 92 % → bevat `ring--goed` en `Op doel`; 70 % → `ring--slecht`; `pct:null` → `geen gegevens`; verschilpijl ↑ met woord; [RF4] technieker met `<script>` in de filter-`<option>` ge-escaped.
- [ ] **Step 2: Run, FAIL. Step 3: Implementeer.** **Step 4: Run, PASS.**
- [ ] **Step 5: Kijken:** `http://localhost:3333/?test`, rol beheerder via de rolwisselaar, tab Performance: filters wijzigen de cijfers; licht en donker; telefoonbreedte (filters wrappen, geen horizontale paginascroll). Screenshot in de ledger.
- [ ] **Step 6: Commit** `feat(dashboard): scherm Performance (filters, tegels, grenzen)`.

### Task 19: Blokrenderers

**Files:** Create `public/js/schermen/beheer-performance-tijd.js`, `-kwaliteit.js`, `-onderdelen.js`, `-klant.js`, `-sales.js`; Test `tests/beheer-performance-blokken.test.mjs` (fixture `e2e/fixtures/dashboard.json`).

**Interfaces:** elk bestand exporteert `render<Blok>(data, ctx) -> string` met `ctx = { grenzen, techniekers, filters }`; `beheer-performance.js` plakt de strings in vaste volgorde (Tijd & stiptheid, Kwaliteit, Onderdelen, Klant & planning, Sales).
- **Tijd:** vier "gemiddelde duur"-kaartjes (laadpaal / oorzaak / technieker / type bezoek) als `balkenRijen` (slot 1, duur in `formatDuur`); op-tijd-ringen per technieker (`ringFiguur`, `statusVoor('opTijd')`); `lijnGrafiek` rijtijd vs werktijd per dag (titel "Aanrijtijd (schatting vanaf startlocatie) en werktijd per dag"); `gestapeldeKolommen` interventies per dag per technieker (slots via `kleurSlotVoor`).
- **Kwaliteit:** ringen first-time-fix per technieker en per laadpaaltype; herhaalbezoek-tegel + lijst (rijen met "Open rapport"-knop → `openRapportOpId`, Taak 20); `gestapeldeBalken` top-oorzaken per laadpaaltype.
- **Onderdelen:** `balkenRijen` top 10 (aantal) met waarde ernaast; `gestapeldeKolommen` verbruik per maand per technieker en per type laadpaal (twee kaarten, geen schakelaar in een kaart); één maand → enkel tabel.
- **Klant & planning:** bevestigingssnelheid (mediaan, gemiddelde, buckets als `balkenRijen`), ring "bevestigd via de knop", annulatie-tegel met "sinds …", ring garantie (+ waarde onderdelen en loon per groep), ring met installateur + `balkenRijen` per partner/regio; een zichtbare regel dat technieker-/laadpaalfilter hier niet geldt voor voorstellen en annulaties.
- **Sales:** `gestapeldeKolommen` bezoeken per verkoper per week; **`donutFiguur` van de vier resultaten** (slots 1-4 in de vaste volgorde, midden = totaal bezoeken, legende met aantal en %); wachtende leads (tegel + buckets + per verkoper). Geen persoonsgegevens.
- Lege blokken tonen een korte lege-toestand-zin, nooit een lege kaart.

- [ ] **Step 1: Tests per renderer** op de fixture: bevat de verwachte aantal ringen/`<svg`; geen `NaN`/`undefined`/`[object`; [RF4] de testset-naam `<img src=x>` komt nergens ongeëscaped voor (`assert.ok(!html.includes('<img src=x>'))`); sales-donut heeft vier legenderijen; leeg blok (alle lijsten leeg) geeft de lege-toestand-zin.
- [ ] **Step 2: Run, FAIL. Step 3: Implementeer** (elk bestand klein, enkel strings bouwen met de generators uit Taak 10-13 en `-logica.js`). **Step 4: Run, PASS.**
- [ ] **Step 5: Kijken:** alle vijf blokken in licht/donker en op telefoonbreedte; kleurverschil goed/aandacht/slecht herkenbaar dankzij icoon + woord; controleer de lengte van labels (afbreken, niet afkappen).
- [ ] **Step 6: Commit** `feat(dashboard): blokken Tijd, Kwaliteit, Onderdelen, Klant, Sales`.

### Task 20: Doorklik herhaalbezoek → rapport openen

**Files:** Modify `public/js/rapport-archief.js` (exporteer `openRapportOpId(id)` en splits er `toonRapportHtml(html)` uit, hergebruikt door `herOpenRapport`; houd de sandbox-iframe-aanpak ongewijzigd); Test `tests/rapport-archief-open.test.mjs`.

- [ ] **Step 1: Test:** `openRapportOpId` haalt de HTML uit `_rapportArchief` als die er al in zit, anders via `GET /api/rapport-archief?inhoud=<id>` (nep-fetch uit `tests/nep-fetch.mjs`/`setFetch`-patroon), en meldt een toast bij een 404 of lege inhoud; `herOpenRapport` gedraagt zich ongewijzigd.
- [ ] **Step 2–4:** FAIL → implementeer (lees de dan geldende `herOpenRapport` na de upload-merge; die leest `_html` of haalt `?inhoud=`) → PASS; `npx playwright test` voor de bestaande rapport-archief-specs groen.
- [ ] **Step 5: Commit** `feat(dashboard): rapport openen op id (doorklik herhaalbezoek)`.

### Task 21: Playwright

**Files:** Create `e2e/performance.spec.mjs`; gebruikt `e2e/fixtures/dashboard.json` (Taak 9) en de helpers uit `e2e/helpers.mjs` (stub `/api/dashboard` en `/api/dashboard-instellingen` met dat bestand; rolwisselaar via `X-Blitz-Test-Rol`).

- [ ] **Step 1: Specs:** (a) beheerder opent Beheer → Performance en ziet zes tegels en de vijf blokken; (b) ring "Op tijd" met 92 % heeft klasse `ring--goed`, 70 % `ring--slecht`, en de tekst `92%` staat in het midden; (c) een technieker kiezen in de filterrij stuurt `technieker=…` mee en het scherm hertekent met de gestubde tweede respons; (d) de sales-donut toont vier legenderijen en het totaal in het midden; (e) rol planner en technieker krijgen (gestubde) `403` en zien een melding, geen cijfers; (f) licht thema: dezelfde ring heeft de ingestelde statuskleur (`getComputedStyle` van `--ring-kleur`); (g) twee ringen met 3 % verschil rond een grens: de aangepaste grens (PUT gestubd) verandert de klasse; (h) geen console-fouten (de helper-vangnetten).
- [ ] **Step 2: Run** `npx playwright test e2e/performance.spec.mjs --repeat-each=3`: groen; daarna de hele suite.
- [ ] **Step 3: Commit** `test(dashboard): e2e Performance`.

### Task 22: Afronding

**Files:** Modify `CHANGELOG.md` (onder "Refactor-tak — nog niet uitgebracht": **Added** — Performance-dashboard; ringen met instelbare grenzen; geplandTijdslot/partner/regio in rapporten vanaf livegang; rapportlimiet 5000; **Changed** — lijst-GET geeft standaard de nieuwste 500), `docs/bugs-en-open-punten.md` (open punt: `public/js/excel-export.js` telt werktijd over middernacht als 0 en negeert `werktijd`-tekst; installateur-veld vooraf ingevuld; vroeg aankomen telt als niet op tijd).

- [ ] **Step 1: Volledige run** `node --test` en `npx playwright test` (chromium + sw): groen en minstens de nulmeting plus de nieuwe tests.
- [ ] **Step 2: Spec-dekking nalopen** tegen `2026-10-08-performance-dashboard-design.md` (filters, zes tegels, alle metrics, ringen, donut, kleurgrenzen, instelbaar, 403, tests) en `git diff refactor --stat -- public/index.html public/js/app.js` is leeg of precies één regel.
- [ ] **Step 3: Opruimen** (skill `opruimen-na-werk`): testservers en browsers stoppen, scratch-HTML weg, `git status` schoon op de bedoelde bestanden.
- [ ] **Step 4: Commit** `docs: changelog en open punten performance-dashboard`. Niet mergen; het ledger bijwerken en terugmelden.
