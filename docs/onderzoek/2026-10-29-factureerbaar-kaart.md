# Onderzoek: kaart "Factureerbaar" in Beheer › Performance (2026-10-29)

## Samenvatting voor Brent

- Het kan, en het hoeft geen nieuwe prijslogica: de regels voor onderdelen en loon bestaan al. Ze staan alleen verspreid op twee plekken.
- Het rapportarchief rekent per rapport al een "factureerbaar" bedrag uit. Dat zijn de bedragen "elders op de pagina". De Performance-tab telt wel onderdelenwaarde en loon, maar nergens als "factureerbaar".
- De nieuwe kaart zou tonen: onderdelen (€), werkuren en loon (€), en het totaal. Ze volgt de periodekeuze, de technieker- en de type-filter, net als de andere kaarten.
- Eén verschil moet je kennen: de huidige onderdelencijfers op Performance tellen ook onderdelen die in het rapport als "niet aangerekend" staan. Voor de nieuwe kaart laten we die weg, zoals het archief doet. Het bestaande cijfer blijft ongewijzigd.
- Er zijn gaten. Onderdelen zonder prijs tellen voor € 0 (de kaart zegt hoeveel). Rapporten zonder start- of stoptijd geven geen loon (de kaart zegt ook dat). Installatierapporten geven geen loon, en bij garantie wordt het loon niet aangerekend.
- Het is nieuwe functionaliteit, dus een MINOR-versie. Omdat we de nieuwe functie op `refactor` of `main` zetten, moet jij beslissen (zie hieronder).
- Geschatte omvang: klein tot middelgroot, één blok server en één kaart in het scherm, plus tests.

## Technisch

**Hoe de Performance-tab werkt**
- Eén serverfunctie `/api/dashboard` levert alle cijfers. De client roept ze aan met de filters in `maakQuery(t.filters)`: [beheer-performance.js:64](public/js/schermen/beheer-performance.js:64) en [:155](public/js/schermen/beheer-performance.js:155). De periodekiezer (presets en datumvelden) staat in [beheer-performance.js:189-224](public/js/schermen/beheer-performance.js:189) en roept `laadDashboard()` opnieuw aan. Alle kaarten krijgen dus dezelfde periode.
- De server rekent in `berekenDashboard` ([netlify/lib/dashboard-metrics.js:46-106](netlify/lib/dashboard-metrics.js:46)). Het filtert rapporten op periode, technieker en type, en stuurt per blok een stuk JSON terug: `tijd`, `kwaliteit`, `onderdelen`, `klant`, `sales`.
- Blokken tekenen: `BLOKKEN = [renderTijd, renderKwaliteit, renderOnderdelen, renderKlant, renderSales]` ([beheer-performance.js:24](public/js/schermen/beheer-performance.js:24)). Een renderer is een pure stringbouwer die uit `data` HTML maakt. Een falend blok wordt netjes opgevangen ([:115-120](public/js/schermen/beheer-performance.js:115)).
- Rolfilter: `deelVoorRol` ([:27](public/js/schermen/beheer-performance.js:27)). Beheerder = alles, planner = `techniekers` (geen sales), sales-manager = enkel sales ("geen kosten"). Een nieuwe kaart met bedragen hoort in het deel `alles` en `techniekers`, niet bij `sales`.

**Waar de bedragen al berekend worden**
1. Rapportarchief (de "factureerbaar"-regel per rapport), [rapport-archief.js:179-211](public/js/rapport-archief.js:179):
   - werktijd = `calcWerktijdMin(start, stop)`, loon = `berekenLoonkost(servicetype, werkMin, aanrijtijdMin).bruto`;
   - loon telt niet bij garantie of bij een installatierapport (`loonNetto = 0`, regel 182);
   - onderdelen = som van `prijs × aantal` over regels met naam en `factureren !== false` (regel 184-185);
   - totaal = loonNetto + onderdelen.
2. `berekenLoonkost` staat in [kern/loonkost.js](public/js/kern/loonkost.js) en wordt door het dashboard al hergebruikt ([netlify/lib/dashboard/klant.js:3](netlify/lib/dashboard/klant.js:3)). Tarieven: 2e lijn € 175 (+ € 75 per extra uur boven 3 u), 1e lijn en garantie € 115 per gestart uur, op werktijd + aanrijtijd.
3. Dashboard onderdelen: `waardeTotaal(rapporten)` ([onderdelen.js:12](netlify/lib/dashboard/onderdelen.js:12)) telt `aantal × prijs` voor ALLE onderdeelregels, ook die niet aangerekend zijn. De prijs komt uit het rapport, anders uit de prijslijst, anders 0 (`prijsBron: 'geen'`; [gemeenschappelijk.js:121-140](netlify/lib/dashboard/gemeenschappelijk.js:121)).
4. Dashboard loon: alleen in de Garantie-kaart, per groep garantie/overig, enkel interventies met werktijd ([klant.js:75-90](netlify/lib/dashboard/klant.js:75)). Daar is het loon bruto, ook bij garantie.

**Gaten**
- `leesOnderdelen` neemt `p.factureren` niet over ([gemeenschappelijk.js:131-137](netlify/lib/dashboard/gemeenschappelijk.js:131)). De "niet aangerekend"-vlag gaat dus verloren voor het dashboard. Voor de kaart moet de vlag (bv. `factureren: p.factureren !== false`) in de genormaliseerde regel komen. De bestaande cijfers (top 10, waarde) mogen niet veranderen.
- Onderdelen zonder prijs (`prijsBron === 'geen'`) tellen voor € 0. De bestaande `dekking.zonderPrijs` is een bruikbare voetnoot.
- Werktijd ontbreekt of is onbetrouwbaar (≤ 0 of > 720 min, [gemeenschappelijk.js:34-52](netlify/lib/dashboard/gemeenschappelijk.js:34)): geen loon en geen uren voor dat rapport. Telling nodig als voetnoot (zoals "Zonder werktijd" in klant.js:56).
- Het archief tekent `loon` ook als werktijd 0 is met alleen aanrijtijd niet (`wMin > 0`). Het dashboard moet dezelfde regel volgen, anders verschillen de totalen.
- Installatierapporten: loon 0 (archief). Het dashboard heeft `interventieType` al op het rapport.
- Servicetype leeg (oudere rapporten) valt in `berekenLoonkost` terug op het 1e-lijn-tarief; zo doet het archief het ook. Dat laten we gelijk.
- Er is niets over btw: bedragen zijn excl. btw (zoals de wizard).
- "Werkuren": drie opties: werktijd alleen, werktijd + aanrijtijd (de basis van het loon), of gefactureerde uren (gestarte uren of 2e-lijn-blok). Zie open vragen.

**Optie A (aanbevolen): berekenen op de server, nieuw blok `factureerbaar`**
- Nieuw: `netlify/lib/dashboard/factureerbaar.js` met `berekenFactureerbaar(rapporten)` → `{ onderdelen, loon, totaal, uren, dekking: { rapporten, zonderPrijs, zonderWerktijd, nietAangerekend } }`. Hergebruikt `berekenLoonkost`.
- Wijzig `gemeenschappelijk.js` (neem `factureren` mee in `leesOnderdelen`) en `dashboard-metrics.js` (blok erbij + `dekking.factureerbaar`, niet bij `deel === 'sales'`).
- Wijzig `beheer-performance-onderdelen.js` of een nieuw `beheer-performance-factureerbaar.js` (nieuw bestand ook in `SHELL` van `public/sw.js`); één kaart met drie waarden en voetnoten. Opnemen in `BLOKKEN` in [beheer-performance.js:24](public/js/schermen/beheer-performance.js:24) (en dus `blokkenVoor`).
- Voordeel: één rekenpunt, volgt automatisch periode en filters, geen extra verzoek, goed te testen, hergebruikt alles.
- Risico: de server-JSON krijgt een nieuw veld (oudere clients negeren het, geen probleem); het dashboard en het archief mogen niet uit elkaar groeien (zie tests).

**Optie B: enkel client**
- Het rapportarchief in de browser gebruiken en daar sommen. Niet aanbevolen: het archief is niet per periode of rol opgehaald op dit scherm, de planner/sales-rol en de technieker-/type-filters zouden dubbel gebouwd moeten worden, en de zware lijst moet apart geladen worden.

**Tests**
- `node --test` (zonder pad): nieuw `tests/dashboard-factureerbaar.test.mjs` met: onderdelen met `factureren:false` weg; prijs uit rapport/prijslijst/geen; garantie = loon niet, onderdelen wel; installatie = geen loon; 2e lijn boven 3 u; werktijd ontbreekt; een pariteitstest tegen dezelfde invoer als de archiefformule (`calcWerktijdMin`, `berekenLoonkost`) zodat beide gelijk blijven. Uitbreiden: `tests/dashboard-metrics.test.mjs` (blok aanwezig, ontbreekt bij `deel='sales'`), `tests/server-dashboard.test.mjs` (antwoordvorm), `tests/rechten.test.mjs` verandert niet (geen nieuwe functie).
- Playwright: `e2e/performance.spec.mjs` (project `chromium`, `/api/dashboard` gestubd): kaart zichtbaar, waarden uit de stub, wijziging van periode haalt nieuwe waarden, voetnoot bij ontbrekende prijs. Gericht draaien: `npx playwright test e2e/performance.spec.mjs --project=chromium --workers=1`, niet de hele suite.

**Versionering en branch**
- Nieuwe functionaliteit (nieuwe kaart) = MINOR, volgens CLAUDE.md. Branchbeleid: "refactor" is sinds 2.0.0 afgelopen (zie memory), maar CLAUDE.md zegt nog dat `main` alleen bugfixes krijgt. Dat is verouderd; laat Brent het bevestigen. Release: versie in `package.json`, CHANGELOG-entry, en `CACHE_NAME` in `public/sw.js` ophogen (verplicht bij elke wijziging onder `public/`).

## Open vragen voor Brent

1. **Niet-aangerekende onderdelen:** weglaten uit het factureerbaar-bedrag, zoals in het archief? Aanbeveling: ja, weglaten. (Het bestaande "waarde onderdelen" blijft gewoon alles tellen.)
2. **Wat telt als werkuren:** werktijd bij de klant alleen, of werktijd + aanrijtijd (waarop het loon berekend wordt)? Aanbeveling: werktijd + aanrijtijd, zodat uren en loonbedrag bij elkaar passen. Garantie-uren apart tonen als "niet gefactureerd".
3. **Garantie en installaties:** loon niet meetellen (zoals het archief), maar de uren wel zichtbaar houden in een regel "niet aangerekend"? Aanbeveling: ja.
4. **Wie ziet de kaart:** beheerder en planner (techniekers-deel), niet de sales-manager? Aanbeveling: ja.
5. **Op welke tak/versie:** op `main` als MINOR-release (bv. 2.7.0)? Aanbeveling: ja, omdat de refactor-tak niet meer bestaat; bevestig dat.
