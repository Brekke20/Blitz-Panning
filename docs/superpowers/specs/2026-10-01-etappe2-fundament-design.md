# Etappe 2 — Fundament (`public/js/kern/`) — design

Datum: 2026-10-01 · Opdrachtgever: Brent Calaerts · Tak: `refactor` · Basis: roadmap `2026-10-01-refactor-roadmap-design.md` (W1–W12), vangnet etappe 0 (37 e2e + 136 unit)

## 1. Doel

De gedeelde fundamenten uit roadmap §3 bouwen en `public/index.html` er **stapsgewijs** op laten overgaan, zodat de schermetappes 3–5 op een stevige basis kunnen verder bouwen:

- `kern/tijd.js`, `kern/selecties.js`, `kern/ui.js`, `kern/api.js`: pure, unit-geteste hulpmiddelen. De dubbele hulpcode in `index.html` verdwijnt.
- `kern/toestand.js`: een kleine centrale toestand met **abonneer/verwittig**. Een scherm wordt automatisch opnieuw getekend als zijn gegevens wijzigen; "vergeten `renderX()` aan te roepen" kan niet meer voor de gemigreerde gegevens.
- Twee bugfixes (W5): de 409 bij `saveAfspraken` en de onzichtbare TEST-badge.

Geen herschrijving. Elke taak laat de app volledig werkend; na elke taak zijn `npx playwright test` en `node --test` groen. Voor de gebruiker verandert niets, behalve de twee bugfixes.

Buiten scope: schermen opsplitsen (etappe 3–5), alle `onclick` omzetten (etappe 5), serverkant (6), de rapportwizard (W11, zie K15).

## 2. Uitgangspunten (geverifieerd in de code, 2026-10-01)

| Feit | Gevolg |
|---|---|
| `index.html` is één groot **klassiek** inline `<script defer>` (regel ~647). `defer` heeft op een inline script **geen effect**: het draait meteen tijdens het parsen, dus **vóór** alle `<script type="module">`. Modules (ook `planner.js`, `sorteer.js`) draaien daarna, in documentvolgorde, maar vóór `DOMContentLoaded`. | Klassieke code op het hoogste niveau (buiten functies) kan **nog niets** van een module gebruiken. Alles wat `kern` nodig heeft, moet in een functie of in de `DOMContentLoaded`-handler staan. |
| Globale toestand zijn `let`-variabelen op het hoogste niveau van dat script (`allTickets`, `allPending`, `allGepland`, `planning`, `localEvents`, `avExceptions`, `klantBeschikbaarheid`, `voorstelStatus`, `settings`, `activeAssigneeFilter`, `routeData`, `activeTicket`, …). Ze worden op ~60 plaatsen herschreven en op honderden gelezen; `planning` en de arrays worden ook **in-place** gemuteerd. | Een `set()`-API alleen is niet genoeg: lezen en toewijzen moeten ongewijzigd blijven werken (accessors, K5), en in-place mutaties moeten `raak()` krijgen. |
| `function`-declaraties in dat script (`toast`, `escHtml`, `localISO`, …) zijn `window`-globals en worden **kaal** gebruikt door `inventaris.js`, `outbox.js`, `prijzen.js`, `excel-export.js`, `rapport-archief.js`, `rapport-wizard.js`. `TEST_MODE` is een `const` en daardoor eveneens kaal bruikbaar. | Verhuizen van `toast`/`escHtml` vereist dat de globale namen blijven bestaan (brug, K2). |
| De testmodus-header (`X-Blitz-Test: 1`) komt uit een inline script in `<head>` dat `window.fetch` omwikkelt. | Blijft daar staan (K10). `api.js` gebruikt gewoon de globale `fetch` en krijgt de header "gratis". |
| Tellingen in `index.html`: `fetch(` 35, `toast(` 116, `escHtml(` 96, `onclick=` 110, `localISO(` 34, `timeStrToMin(` 17, `extractLocalHour(` 7, `stopsVoorDag(` 7, `activeAssigneeFilter` 62, `renderKalender()` 44, `renderRouteList(` 27, `renderTickets()` 17. `.superpowers/refactor-kaart.md` bestaat niet; deze cijfers zijn zelf geteld. | Richtgetallen; elke taak telt opnieuw vóór en na. |

## 3. Rulings

| # | Onderwerp | Beslissing | Reden |
|---|---|---|---|
| K1 | Aanpak | Incrementeel. Eerst de pure modules (tijd, ui, selecties), dan de toestand, dan abonneren, dan api. Per taak één commit die groen eindigt. Geen taak verplaatst een functie én wijzigt haar gedrag. | W1, W5 |
| K2 | Brug | Kern-modules zelf zijn **puur ES**: geen `window`, geen DOM op moduleniveau, importeerbaar in `node --test`. Eén bestand, `kern/brug.js`, is de enige plek die `window` aanraakt: het zet `window.kern = { toestand, selecties, tijd, api, ui }` en de **oude globale namen** (`window.toast`, `window.escHtml`, `window.localISO`, …) in een blok gemarkeerd `// LEGACY-BRUG`. `brug.js` is de **eerste** `<script type="module">` in `index.html`. Het legacy-blok verdwijnt in etappe 5, zodra niets meer kaal oproept (grep leeg); nieuwe code importeert rechtstreeks. | Zelfde patroon als `sorteer.js`/`planner.js`, maar op één plek, zodat het later in één keer weg kan. |
| K3 | Laadvolgorde | Regel voor `index.html`: op het hoogste niveau van het klassieke script geen toegang tot `window.kern` of tot geïnstalleerde accessors. Initialisatie die dat nodig heeft (bv. `settings`) verhuist naar het begin van de `DOMContentLoaded`-handler (modules zijn dan geladen). Elke taak controleert met grep dat verhuisde functies/variabelen niet op het hoogste niveau gebruikt worden (buiten function-bodies). **Reeds gevonden** (regel ~884 en ~5612): `let settings = loadPersonSettings(...)` en `let _bavFormDate = localISO(new Date());`. Beide worden `let x = null;` op het hoogste niveau en krijgen hun waarde aan het begin van `DOMContentLoaded`. | Zie §2, eerste rij. Grootste technische valkuil van de etappe. |
| K4 | Sleutels in de toestand | Tien: `allTickets`, `allPending`, `allGepland`, `planning`, `localEvents`, `avExceptions`, `klantBeschikbaarheid`, `voorstelStatus`, `settings`, `activeAssigneeFilter`. Sleutelnaam = bestaande variabelenaam. **Niet** in de toestand: versienummers (`localEventsVersie`, `avVersie`, `kbVersie`, `_voorstelStatusVersie`; ze blijven gewone variabelen en gaan als parameter naar/uit de opslaghelper), `routeData`, `currentRouteDate`, `activeTicket`, `kalOffset`/`gepOffset`/`kalView` (scherm-interne toestand: etappe 3–5), `arrivalData`, formulier-`_av*`/`_man*`-variabelen. | Kleinst zinvolle set die de render-ketens van §5 afdekt. |
| K5 | Toegang tot de toestand | Per sleutel verdwijnt de `let ...` uit `index.html` en installeert `brug.js` een **accessor** op `window` met dezelfde naam (`get` leest de toestand, `set` schrijft ze). Alle bestaande code (`allTickets.filter(...)`, `activeAssigneeFilter = x`) werkt daardoor ongewijzigd, ook in andere modules. **Toewijzing** (`x = ...`) verwittigt vanzelf. **In-place mutatie** (`x.push`, `x[k] = ...`, `x.prop = ...`) niet: die krijgt expliciet `kern.toestand.raak('x')`, enkel waar de sleutel geabonneerd is (K6). Per sleutel somt de taak alle in-place sites op (grep) en noteert ze in de commit. | Voorkomt 60 handmatige herschrijvingen; geen gedragsverschil. |
| K6 | Abonneren | **Eén abonnement per render-functie**, met de unie van de sleutels waarvan ze afhangt (`abonneer(['allTickets','activeAssigneeFilter'], renderTickets)`). Zo wordt een render per flush hoogstens één keer uitgevoerd, hoeveel sleutels er ook wijzigden. Alle koppelingen staan op één plek, `koppelRenders()` in `index.html` (aangeroepen als eerste in `DOMContentLoaded`). De abonnementen zijn **precies** wat de code nu na het schrijven van die sleutel doet (geen extra renders, geen minder). Handmatige `renderX()`-aanroepen die direct op een schrijf van een geabonneerde sleutel volgen, verdwijnen. `planning`, `voorstelStatus`, `klantBeschikbaarheid`: in de toestand, maar nog **zonder** abonnementen (geen render hangt er uniform aan; de route-etappe 3 beslist). `settings` krijgt enkel een abonnement als de code-inventaris een uniforme keten toont (taak 6 beslist en logt). | W5: identiek gedrag. |
| K7 | Verwittigen | `toestand.js` verwittigt **gebundeld per microtask**. `transactie(fn)` stelt uit en spoelt synchroon aan het einde van de buitenste transactie; `spoel()` spoelt meteen. Een omhulling (`zetOmhulling(fn)`) wikkelt elke flush; `koppelRenders()` geeft `metBehoudScroll`, zodat scrollbehoud blijft zoals nu. Plaatsen waar de huidige code direct na het schrijven het DOM leest (bv. einde van `_applyTicketsData`) gebruiken `transactie`. **Lusbeveiliging**: schrijft een abonnee tijdens een flush, dan volgt een nieuwe ronde; na 10 rondes stopt de flush met `console.error` (en de e2e-vangnetcontrole laat de test falen). Een abonnee die faalt breekt de andere niet. `set` met een identieke primitieve waarde verwittigt niet; objecten/arrays altijd. Een onbekende sleutel gooit een fout (typfouten vallen op). | Voorkomt render-stormen, lussen en stille mislukkingen. |
| K8 | Selecties | Alleen patronen die **letterlijk dezelfde** semantiek hebben worden gedeeld. Functies zijn pure functies van expliciete parameters (geen globals). `stopsVoorDag` verhuist; `index.html` houdt een wrapper `stopsVoorDag(date)` zodat de 7 oproepen ongewijzigd blijven. De afwijkende filters (o.a. `matchRespToPerson(r.technieker, …)` rond regel 2301) blijven ongemoeid en staan in de taaknotitie. | Een "bijna gelijke" filter samenvoegen is een stille gedragswijziging. |
| K9 | Tijd | Gedrag **identiek**, inclusief lokaal versus UTC. De drie `.toISOString().split('T')[0]`-plaatsen (regels ~3508 `avAddException`, ~5643 `nextWorkday`, ~5827) blijven zoals ze zijn: ze rekenen op een `12:00`-datum en zijn daar veilig; ze "verbeteren" is buiten scope. `extractLocalHour` behoudt de sentinel (lokale 00:00 én UTC-00:00 met `Z` = geen tijdstip). Unit-tests draaien met `TZ=Europe/Brussels` en dekken de zomertijdovergangen 2026-03-29 en 2026-10-25. `planner.js` importeert `timeStrToMin` uit `kern/tijd.js` (identieke implementatie); `minNaarUur` in `planner.js` is **niet** gelijk aan `minToTimeStr` (afronding, `|| 0`) en blijft staan. | W5 |
| K10 | api | `api.js` levert: `apiVerzoek` (geeft `{ok,status,data}`, gooit enkel bij netwerkfout), `apiJson` (gooit `ApiFout` met `message === 'HTTP <status>'`, zoals nu overal gebeurt), en `bewaarMetVersie` (gedeelde "bewaar met versie"-helper, K12). `Content-Type: application/json` wordt enkel gezet als er een body is (zoals nu). Foutteksten en toasts blijven bij de oproeper (identieke teksten); `api.js` blijft daardoor puur en toont zelf geen toast. De testmodus-fetch-patch in `<head>` blijft daar (moet vóór alle scripts staan, ook voor modules). **Migratiecriterium**: een call site gaat enkel over als (a) een e2e-test zijn request-payload volledig asserteert, of (b) in dezelfde taak zo'n assertie wordt toegevoegd. Eerst de bestaande payload vastleggen, dan migreren. **Niet gemigreerd in deze etappe** (geen payload-dekking, of Zoho-schrijfpad zonder e2e): `/api/plan` (3), `/api/annuleer` (3), `/api/comment`, `/api/client-log`, `/api/testdata`, `/api/tickets`, `/api/fotos`, en alle `fetch`-oproepen in andere modules. Ze staan in de taaknotitie met reden; etappe 5 pakt ze op. | W11 |
| K11 | ui | `ui.js` bevat `escHtml`, `toast` (met de pure `toastDuur(msg, ms)` apart getest), en `registreerActies(wortel, handlers)`: een delegatie-luisteraar op `document.body` die `closest('[data-actie]')` zoekt en `handlers[naam](el, event, arg)` oproept (`data-arg` als tekst). Pilot: zeven statische kop-/navigatieknoppen in de header en kalenderbalk (zie plan, taak 2). De rest (≈100 `onclick`) is etappe 5. Listener op `body` (niet `document`), zodat de volgorde ten opzichte van de bestaande "klik buiten het persoonsmenu sluit het"-listener op `document` gelijk blijft aan nu. | Minste risico; bewijst het mechanisme. |
| K12 | Bugfix: afspraken-409 (W5) | `saveAfspraken` krijgt dezelfde **merge + opnieuw proberen** als `saveKlantBeschikbaarheid`, via `bewaarMetVersie`. De aanroepers geven hun lokale wijziging mee (`{toegevoegd, gewijzigd, verwijderd}`); bij 409 wordt de server-stand genomen, de wijziging erover gelegd (toevoegen op id, wijzigen op id, verwijderen op id) en één keer opnieuw bewaard. Lukt dat opnieuw niet (tweede 409 of fout), dan geldt de bestaande foutafhandeling (waarschuwing + server-stand). De rollbacks in de aanroepers werken op **id**, niet op index (nu kan een rollback na een 409 een verkeerd element overschrijven). `e2e/conflict-409.spec.mjs` wordt **bewust** aangepast (zie plan, taak 9). | Gevonden in etappe 0; Brent heeft correct gedrag verwacht. |
| K13 | Bugfix: TEST-badge | `style.display = ''` (index.html ~915) laat de CSS-regel `#test-badge { display:none }` winnen, dus de badge is nooit zichtbaar. Wordt `'inline-block'`. De `test.fixme` in `e2e/rooktest.spec.mjs` wordt een gewone test. | W5 |
| K14 | Service worker | Elke taak die een kern-bestand toevoegt, voegt het in dezelfde commit toe aan `SHELL` in `public/sw.js`. `CACHE_NAME` blijft ongewijzigd (releasestap). | Roadmap §6 |
| K15 | Rapportwizard | `rapport-wizard.js` en de andere bestaande modules worden **niet aangeraakt**. Ze blijven kaal `toast`/`escHtml`/`TEST_MODE` gebruiken via de brug. De wizard-e2e (`instellingen-rapport.spec.mjs`) is het bewijs dat de brug werkt. Enige uitzondering: blijkt een kern-vervanging nodig om een regressie te voorkomen, dan minimaal, met extra test, en vermeld in de commit. | W11 |
| K16 | Tijdelijke verklikker | De `sjLog(...)`-regels (TIJDELIJK scrollsprong-verklikker v1.8.0) blijven staan en worden bij verhuizen mee behouden of ongemoeid gelaten. Niet opruimen in deze etappe. | Buiten scope |
| K17 | Versie en CHANGELOG | Geen versienummer of `CACHE_NAME` in deze etappe. Eén regel per bugfix onder de sectie "Refactor-tak — nog niet uitgebracht" in `CHANGELOG.md` (taak 9), plus een "Changed"-regel dat de interne structuur is vernieuwd. | W5 |
| K18 | Review | Taak-review: sonnet. **Etappe-eindreview: opus** (roadmap §5; alles bouwt hierop). | W12 |

## 4. Ontwerp per module

### 4.1 `kern/tijd.js` (puur)

Verhuist, ongewijzigd van gedrag: `localISO(d)`, `getWeekStart(baseDate, offset)`, `timeStrToMin(hhmm)`, `minToTimeStr(totalMin)`, `extractLocalHour(interventieDatum)`, `fmtDate(s)`, `fmtDateShort(d)`, `fmtSec(s)`, plus `todayISO(nu = new Date())` (= `localISO(nu)`, vervangt `todayStr`). Alles lokale tijd (`Date`-getters zonder UTC), zoals nu. `'00:00' = geen tijdstip` blijft de sentinel van `extractLocalHour`.

### 4.2 `kern/selecties.js` (puur)

```js
isAlle(filter)                                   // filter === 'all'
persoonOfNull(filter)                            // 'all' -> null, anders filter   (7× herhaald: myPerson)
ticketsVanTechnieker(tickets, filter)            // t.assignee            (~10× herhaald)
planItemsVanTechnieker(items, filter)            // p.ticket.assignee     (~8× herhaald, items = planning[d] || [])
eigenAfsprakenVoor(events, datum, filter, { alleenMetLocatie })  // e.datum===datum, (adres||notitie) optioneel, !e.persoon || e.persoon===filter
stopsVoorDag({ planning, localEvents }, filter, date)            // {stops, localForDate, allStops}, 1:1 de bestaande functie
```

### 4.3 `kern/toestand.js`

```js
export const SLEUTELS = [...10 sleutels...];
export function maakToestand(begin = {}) -> {
  get(sleutel), set(sleutel, waarde), patch(sleutel, deel), raak(sleutel),
  abonneer(sleutels: string | string[], fn: (gewijzigd: Set<string>) => void) -> () => void,
  transactie(fn) -> terugwaarde van fn, spoel(), zetOmhulling(fn: (draai: () => void) => void)
}
export const toestand = maakToestand(BEGINWAARDEN);   // singleton van de app
```
Beginwaarden: `[]` voor de vier lijsten en `avExceptions`/`localEvents`, `{}` voor `planning`, `voorstelStatus`, `klantBeschikbaarheid`, `'all'` voor `activeAssigneeFilter`, `null` voor `settings` (gezet in `DOMContentLoaded`, K3). Abonnees draaien in registratievolgorde (deterministisch). `patch` maakt een ondiepe kopie (nieuw object, dus altijd verwittigen).

### 4.4 `kern/api.js`

```js
export class ApiFout extends Error { status; data }                 // message = 'HTTP <status>'
export function zetFetch(fn)                                         // enkel voor unit-tests; standaard globalThis.fetch (laat-gebonden)
export async function apiVerzoek(pad, { methode, body, headers } = {}) -> { ok, status, data }
export async function apiJson(pad, { methode, body, headers } = {}) -> data   // gooit ApiFout
export async function bewaarMetVersie({ pad, veld, versie, waarde, voegSamen }) ->
   { ok: true,  versie, waarde }
 | { ok: false, reden: 'conflict' | 'http' | 'netwerk', status?, versie, waarde }
```
`bewaarMetVersie`: `PUT { versie, [veld]: waarde }`. Bij 409: `server = (await res.json()).data`; ontbreekt `voegSamen`, dan `{ok:false, reden:'conflict', versie: server.versie, waarde: server[veld]}`; anders `samen = voegSamen(server[veld], waarde)`, nieuwe `PUT` met `server.versie`; slaagt die: `{ok:true, versie, waarde: samen}`; faalt die: `ok:false` met `versie`/`waarde` = laatst bekende stand (zodat de oproeper de huidige restgedragingen van `saveKlantBeschikbaarheid` kan nabootsen). Geen toasts; de oproeper beslist.

### 4.5 `kern/ui.js`

`escHtml(str)`, `toastDuur(msg, ms)` (pure regel: standaard 4 s, fout minstens 7 s, een meegegeven duur mag enkel verlengen), `toast(msg, ms)` (DOM, `#toast`, dezelfde klasse `show` en dezelfde timer-logica), `registreerActies(wortel, handlers)`.

## 5. Eerste afbakening van de abonnementen (taak 6 bevestigt in de code)

| Render-functie | Abonneert op |
|---|---|
| teller `#cnt-tickets` / `#cnt-gepland` | `allTickets`, `allGepland` |
| `buildPersonSelector` | `allTickets`, `allPending`, `allGepland`, `activeAssigneeFilter` |
| `updatePersonHeader` | `activeAssigneeFilter` |
| `renderTickets` | `allTickets`, `activeAssigneeFilter` (+ `allPending` als de code dat leest) |
| `renderKalender` | `allTickets`, `allPending`, `allGepland`, `localEvents`, `avExceptions`, `activeAssigneeFilter` |
| `renderGepland` | `allGepland`, `activeAssigneeFilter` |
| `renderRouteList(planDatum)` + `updateRouteBtns(planDatum)` | `allTickets`, `allPending`, `allGepland`, `activeAssigneeFilter` |
| `renderInventaris` + `updateInventarisBadge` | `allTickets`, `allPending`, `allGepland`, `activeAssigneeFilter` |

Registratievolgorde = de huidige aanroepvolgorde in `_applyTicketsData` en `selectPerson`. `loadAfspraken` en `loadAvailability` omwikkelen nu `renderKalender` zelf met `metBehoudScroll`; dat doet voortaan de omhulling van de flush.

## 6. Risico's en vangnetten

| Risico | Vangnet |
|---|---|
| Hoogste-niveau-code gebruikt iets dat nog niet bestaat (§2) | K3-grep per taak; `brug.js` eerste module; e2e laadt de app volledig |
| Render-storm of -lus, dubbele renders, scrollsprong | Eén abonnement per render (K6), lusbeveiliging (K7), nieuwe e2e die het **aantal** renders telt bij `selectPerson` en ticketverversing, `metBehoudScroll` als omhulling |
| Verouderd scherm door gemiste `raak()` bij in-place mutatie | Lijst van in-place sites per sleutel in de commit; e2e's voor kalender, afspraken, blokkering |
| Gewijzigde request-payload (Zoho, W11) | K10-criterium: eerst de volledige payload asserteren, dan migreren |
| Tijdzone-afwijking (lokaal versus UTC, zomertijd) | Unit-tests met `TZ=Europe/Brussels` rond 2026-03-29 en 2026-10-25; geen UTC-"fixes" |
| Module-laadvolgorde en service-worker-cache | `brug.js` eerst, `SHELL` per taak bijgewerkt, `CACHE_NAME` onaangeroerd |

## 7. Succescriteria

- `public/js/kern/` bevat `brug.js`, `toestand.js`, `selecties.js`, `tijd.js`, `api.js`, `ui.js`; unit-tests voor de vijf pure modules.
- `index.html` bevat geen eigen `localISO`, `timeStrToMin`, `minToTimeStr`, `extractLocalHour`, `fmtDate*`, `getWeekStart`, `escHtml`, `toast`, `stopsVoorDag`-logica meer (wrappers uitgezonderd), en geen `let` meer voor de tien sleutels.
- Elke render uit §5 wordt door een abonnement aangestuurd; nergens volgt nog een handmatige `renderX()` direct op een schrijf van een geabonneerde sleutel.
- Alle gemigreerde fetch-sites sturen byte-voor-byte dezelfde JSON (door e2e geasserteerd).
- Bugfixes K12 en K13 groen, met bijgewerkte tests en CHANGELOG-regels.
- `npx playwright test` en `node --test` groen; Zoho/TomTom/mail nooit aangeroepen.
