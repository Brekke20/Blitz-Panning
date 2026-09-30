# Planner-brein (v1.11.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "⚡ Plan deze week" herschikken tot een puur, testbaar planner-brein met de nieuwe beslisregels van Brent, plus wachttijd uit de Zoho-statusgeschiedenis.

**Architecture:**
- Nieuwe ES-module `public/js/planner.js`, zonder DOM en zonder globals, met `planWeek(invoer)`. Reistijden krijgt de module via een ingespoten functie.
- `autoPlan()` in `public/index.html` wordt een dunne schil: invoer opbouwen, `planWeek` aanroepen, wegschrijven naar Zoho en het resultaat tonen.
- De wachttijd komt uit een nieuw v2-endpoint `planning-sinds`, met pure logica in `netlify/lib/planningsinds.js` en een register in Blobs.

**Tech Stack:** vanilla JS (klassiek script + ES-modules), Netlify Functions (ES modules), `@netlify/blobs` 8.x, `node:test`, TomTom Matrix via `/api/matrix`.

**Spec:** `docs/superpowers/specs/2026-09-30-planner-brein-design.md`. Lees §2 (rulings R1–R10) en §3 (beslisregels) vóór elke brein-taak.

## Global Constraints

- Werk in een worktree (`EnterWorktree`). Na elke implementer-taak `git branch --show-current` controleren. Nooit committen in de main-checkout.
- Geen nieuwe npm-dependencies.
- Tests: `node --test tests/` (Node 24). Stijl zoals `tests/annulatie.test.mjs`: `import test from 'node:test'`, `assert/strict`.
- Namen en commentaar in het Nederlands, zoals de bestaande code.
- Blobs: `getStore({ name: winkelNaam(req), consistency: 'strong' })` uit `netlify/lib/testmodus.js`. `getStore()` staat binnen een `try`.
- `planner.js` mag **niets** lezen uit `window`/`document`/globals, behalve de ene regel `if (typeof window !== 'undefined') window.planWeek = planWeek;` (patroon `public/js/sorteer.js:182`).
- Tijden binnen het brein zijn minuten na middernacht (lokaal). Datums zijn `'YYYY-MM-DD'`, uren `'HH:MM'`.
- Standaardwaarden:
  - `laatsteStart` `'16:00'`;
  - `maxReistijdMin` `45`;
  - duur van een eigen afspraak zonder einduur: `60` min;
  - reistijdschatting bij uitval: `km × 1,3` (hemelsbreed);
  - wachtbonus: `min(1.5, 0.5 × dagen / 7)`;
  - prio: `High 3 / Medium 2 / Low 1 / anders 1`.
- De route-tab (slepen, optimaliseren, "Tijden vastleggen") mag niet van gedrag veranderen.
- Commit-trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Niet pushen.
- Browsercontrole altijd op `http://localhost:3333/?test`, via `node blobs-local-bootstrap.mjs`. Kopieer dat bestand en `.env.local` vooraf uit de hoofdmap naar de worktree.
- Versie ophogen, `CHANGELOG`, `CACHE_NAME` en de tag horen **niet** bij deze taken. Dat gebeurt bij het afronden (`finishing-a-development-branch`).

## Review Focus

1. **Kandidaat zonder coördinaten** (geocode mislukt): nooit inplannen, en nooit een crash. Reden `adres-niet-gevonden`. Test in Taak 6.
2. **Oude opgeslagen instellingen zonder `laatsteStart`**: de planner valt terug op `'16:00'`. Test in Taak 5 (brein) en Taak 11 (UI).
3. **Een dag die volledig bezet is** door een tijdvak-blokkering of eigen afspraken: geen oneindige lus, niets geplaatst, en de tickets schuiven door. Test in Taak 5.
4. **Voorkeursuur vóór `vanTijd` of ná `laatsteStart`**: wordt toch op dat uur geplaatst, als er geen overlap is. Test in Taak 5.
5. **Bestaande stop zonder coördinaten** als laatste stop: waarschuwing `locatie-onbekend`, en de brein valt terug op de laatste eerdere stop met een locatie, of beschouwt de dag als leeg. Test in Taak 6.

---

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `public/js/planner.js` (nieuw) | het brein: `planWeek`, `voorrang`, `bouwDagen`, `haversine`, tijdlijn-hulpfuncties |
| `tests/planner.test.mjs` (nieuw) | karakterisatie- en regeltests van het brein |
| `public/index.html` | de schil `autoPlan()`, `stopsVoorDag()`, `showResult()` met redenen, instelling "Laatste start", "In planning sinds" in het ticketdetail, dummy-data, de aanroep van `/api/planning-sinds` |
| `netlify/lib/planningsinds.js` (nieuw) | pure logica: `berekenSinds`, register lezen en schrijven |
| `netlify/functions/planning-sinds.js` (nieuw) | v2-endpoint via `maakHandler({ getStore, fetch })` |
| `tests/planningsinds.test.mjs` (nieuw) | tests voor de lib en de handler, met nep-store en nep-fetch |

## Interfaces (eindtoestand, gedeeld door alle taken)

```js
// public/js/planner.js
export function haversine(lat1, lon1, lat2, lon2) -> number        // km
export function voorrang(kandidaat, vandaag) -> number             // §3.2
export function bouwDagen({ weekStart, vandaag, werkdagen, uitgesloten, voorkeuren }) -> { dagen: string[], extraVoor: { [datum]: string[] } }
export async function planWeek(invoer) -> Uitkomst

invoer = {
  kandidaten:     [{ id, number, priority, interventieDatum, inPlanningSinds, lat, lon, duurMin }],
  dagen:          ['YYYY-MM-DD', ...],             // chronologisch
  extraVoor:      { [datum]: [ticketId, ...] },    // voorkeursdagen buiten de week (R2)
  bestaandPerDag: { [datum]: [{ id, uur, duurMin, lat, lon }] },  // uur: 'HH:MM' | null
  eigenAfspraken: { [datum]: [{ uur, duurMin, lat, lon }] },      // uur verplicht
  blokkeringen:   { [datum]: [{ van, tot }] },     // tijdvak-blokkeringen
  klant:          { [ticketId]: { voorkeur, voorkeurTijd, geblokkeerd: [] } },
  instellingen:   { vanTijd, laatsteStart, maxPerDag, maxReistijdMin },
  depot:          { lat, lon } | null,
  vandaag:        'YYYY-MM-DD',
  reistijden:     async (van /* {lat,lon} */, naar /* [{id,lat,lon}] */, vertrekIso) => Map<id, number | null>,
}
Uitkomst = {
  geplaatst:      [{ ticketId, datum, verwachteAankomst /* 'HH:MM' */ }],
  nietGepland:    [{ ticketId, reden }],
  waarschuwingen: [{ soort /* 'reistijd-geschat' | 'locatie-onbekend' */, ticketIds: [] }],
}
Redenen, van meest naar minst specifiek:
'adres-niet-gevonden' > 'voorkeursdag-afstand' > 'voorkeursdag-vol' > 'vast-uur-botst' > 'te-ver' > 'klant-geblokkeerd' > 'geen-plaats'
// 'zoho-fout' voegt enkel de schil toe.

// netlify/lib/planningsinds.js
export const TRAJECT = ['Service in te plannen','Wachten op planning','Wachten op bevestiging planning','Geplande service','Geplande support'];
export function berekenSinds(statusEvents, createdTime) -> string | null   // ISO
export function volgendePaginaNodig(statusEvents, paginaGrootte) -> boolean
export async function leesRegister(store) -> { [ticketId]: { sinds } }
export async function schrijfRegister(store, register) -> void
// blob-sleutel 'planning-sinds'

// netlify/functions/planning-sinds.js
export function maakHandler({ getStore, fetch }) -> (req) => Response
// POST { opzoeken: [id], actief: [id] } -> 200 { sinds: { [id]: ISO|null } }
```

---

### Task 1: Brein-module met het huidige algoritme (karakterisatie)

Verhuis het huidige algoritme **ongewijzigd**. Dat gaat over de lus in `autoPlan()` (`public/index.html` rond regel 3665–3961), plus `fillScore`, `botstMetVastUur`, `pickNearbyCandidate` en `minToDepartAt`. Alles komt in `planWeek`.

Tijdelijk krijgt de invoer extra `capPerDag: { [datum]: number }`. Die berekent de schil nog met `capacityForDay(d, travelMin) - alreadyPlanned`. Het veld verdwijnt in Taak 5.

**Files:**
- Create: `public/js/planner.js`, `tests/planner.test.mjs`
- Modify: `public/index.html`
  - `autoPlan()`: de lus vervangen door de opbouw van de invoer + `await window.planWeek(invoer)` + de bestaande `addTicketToDate`-lus + `showResult`;
  - `<script type="module" src="/js/planner.js">` naast `sorteer.js`, rond regel 641;
  - `haversine` en `batchTravelTimes` blijven voorlopig staan voor andere gebruikers (controleer met grep).

**Interfaces:**
- Produces: `planWeek`, `haversine` (zie Interfaces). De uitkomst in deze taak: `geplaatst` + `nietGepland` met reden `'geen-plaats'` voor alles wat overblijft, en `waarschuwingen: []`.
- De schil levert `reistijden` als adapter op `/api/matrix`. Die geeft `null` voor ontbrekende cellen en een lege Map bij een fout (het huidige fail-open).

- [ ] **Step 1: Karakterisatietests schrijven** (`tests/planner.test.mjs`). Hulpfuncties in de test:
  - `nepReistijden = async (van, naar) => new Map(naar.map(n => [n.id, haversine(van.lat, van.lon, n.lat, n.lon) * 1.3]))`;
  - een vaste set van 8 kandidaten rond Antwerpen/Gent/Hasselt (verzonnen coördinaten);
  - `vandaag = '2026-10-05'` (maandag), 5 werkdagen, `capPerDag` 3 per dag, `maxReistijdMin 45`.

  Tests:
  - `huidig: vult dagen chronologisch en respecteert capPerDag`: geen enkele datum heeft meer dan 3 `geplaatst`;
  - `huidig: voorkeursdag-ticket enkel op zijn dag`: kandidaat met `klant[id].voorkeur='2026-10-07'` staat alleen met die datum in `geplaatst`;
  - `huidig: klant-geblokkeerde dag wordt overgeslagen`;
  - `huidig: vast uur botst met bestaande stop` → dat ticket staat niet op die dag;
  - `huidig: snapshot`: `assert.deepEqual` op de volledige `geplaatst`-lijst van de vaste set. Genereer de verwachte waarde één keer met de verhuisde code en controleer die met de hand tegen de oude code, door in `?test` dezelfde invoer te loggen.
- [ ] **Step 2:** `node --test tests/planner.test.mjs` → FAIL (module bestaat niet).
- [ ] **Step 3:** `planner.js` schrijven: de verhuisde code, alle globals vervangen door velden van `invoer`. Daarna `autoPlan()` herschrijven als schil. De geocoding en de gemiddelde reistijd via `/api/route` blijven in de schil.
- [ ] **Step 4:** `node --test tests/` → alles PASS.
- [ ] **Step 5:** In de browser op `?test`: "Plan deze week" met een gekozen technieker geeft dezelfde verdeling als `main` met dezelfde dummy-data. Vergelijk in twee tabbladen, geen console-fouten.
- [ ] **Step 6: Commit** `refactor(planner): algoritme naar public/js/planner.js met karakterisatietests`

### Task 2: `stopsVoorDag()` en dode code weg

**Files:**
- Modify: `public/index.html`:
  - nieuw `function stopsVoorDag(date) -> { stops, localForDate, allStops }`, met exact de huidige filters en de sortering op `(a.uur||'99:99').localeCompare(...)`;
  - die functie vervangt de opbouw in `renderRouteList` (~4358), `applyRouteOrder` (~4581, het blok van stap 3), `optimizeRoute` (~4822, alleen `stops`/`localForDate`), `calculateRoute` (~4913, alleen `stops`/`localForDate`) en `computeArrivalTimes` (~6254);
  - verwijderen: `geoCluster`, `geoClusterFrom`, `estimateTravelMinFromRoute`. Eerst met grep controleren dat ze nergens aangeroepen worden.

**Interfaces:**
- Produces: `stopsVoorDag(date)`. `allStops`-items hebben de vorm `{ kind: 'ticket'|'local', item, uur }`.

- [ ] **Step 1:** `stopsVoorDag` toevoegen en de vijf plaatsen vervangen. `applyRouteOrder` muteert `entry.uur`/`item.uur`: controleer dat het nog op dezelfde objectreferenties werkt.
- [ ] **Step 2:** Dode code verwijderen.
- [ ] **Step 3:** `node --test tests/` → PASS.
- [ ] **Step 4: Browsercontrole** op `?test`, route-tab, dag met ≥ 3 stops waaronder een eigen afspraak:
  - de lijst en de aankomsttijden zijn identiek aan vóór de wijziging;
  - slepen herschikt en bewaart;
  - "Optimaliseren" werkt;
  - "Tijden vastleggen" werkt;
  - het ticketdetail "Voorstel" toont hetzelfde uur.
- [ ] **Step 5: Commit** `refactor(route): gedeelde stopsVoorDag() i.p.v. vijf kopieën, dode clustercode weg`

### Task 3: R1 "Iedereen" blokkeren en R2 reikwijdte (`bouwDagen`)

**Files:**
- Modify: `public/js/planner.js` (`bouwDagen`), `public/index.html` (`autoPlan`-schil), `tests/planner.test.mjs`

**Interfaces:**
- Produces: `bouwDagen({ weekStart, vandaag, werkdagen, uitgesloten, voorkeuren }) -> { dagen, extraVoor }`, met:
  - `weekStart` `'YYYY-MM-DD'`;
  - `werkdagen` getallen 0–6;
  - `uitgesloten(datum) -> boolean`, voor feestdag of een volledige blokkering;
  - `voorkeuren` = `[{ ticketId, datum }]`.
- `dagen` = werkdagen in [weekStart, weekStart+6], ≥ vandaag, niet uitgesloten, **plus** voorkeursdatums na weekStart+6 die werkdag en niet uitgesloten zijn.
- `extraVoor[datum]` = de ticketIds die op zo'n extra dag mogen.
- `planWeek` laat op een datum uit `extraVoor` alleen de kandidaten uit die lijst toe.

- [ ] **Step 1: Tests**:
  - `bouwDagen: enkel bekeken week vanaf vandaag` (vandaag woensdag → wo/do/vr);
  - `bouwDagen: voorkeursdatum over 3 weken komt erbij als extra dag voor enkel dat ticket`;
  - `planWeek: op extra dag enkel het voorkeursticket` (8 kandidaten, 1 met voorkeur over 3 weken; geen andere kandidaat heeft die datum in `geplaatst`);
  - `bouwDagen: uitgesloten dag valt weg`.
- [ ] **Step 2:** `node --test tests/planner.test.mjs` → FAIL.
- [ ] **Step 3:** `bouwDagen` implementeren. De schil gebruikt hem in plaats van de huidige `scanEnd`-lus, met `uitgesloten = d => !!getHolidayName(d) || avExceptions.some(fullday global/persoon)`. Bovenaan `autoPlan()`: `if (activeAssigneeFilter === 'all') return toast('Kies eerst een technieker');`, vóór de knop op "Bezig…" gaat.
- [ ] **Step 4:** `node --test tests/` → PASS. Pas de karakterisatie-snapshot alleen aan als de oude scan verder reikte, met een commentaar `// gewijzigd door R2`.
- [ ] **Step 5:** Browser `?test`: filter "Iedereen" → toast, en er verandert niets.
- [ ] **Step 6: Commit** `feat(planner): blokkering bij Iedereen (R1) en enkel bekeken week (R2)`

### Task 4: Voorrangsscore en starter

**Files:**
- Modify: `public/js/planner.js`, `tests/planner.test.mjs`, `public/index.html` (de schil geeft `inPlanningSinds` mee, voorlopig altijd `t.inPlanningSinds ?? null`)

**Interfaces:**
- Produces: `voorrang(kandidaat, vandaag) -> number`, volgens spec §3.2. Achterstallig = `interventieDatum` < vandaag → bonus 1,5.
- De starter (seed) wordt: hoogste `voorrang`, bij gelijke waarde de kortste reistijd vanaf het depot, dan het laagste `number`. Het huidige `fillScore` voor de seed verdwijnt. Het aanvullen blijft in deze taak nog zoals het was.

- [ ] **Step 1: Tests**:
  - `voorrang: High nieuw = 3, Medium nieuw = 2, Low nieuw = 1, leeg = 1`;
  - `voorrang: Low 21 dagen = 2.5; Low 60 dagen = 2.5 (plafond)`;
  - `voorrang: Low 7 dagen = 1.5`;
  - `voorrang: achterstallige interventieDatum = prio + 1.5`;
  - `voorrang: inPlanningSinds null = geen bonus`;
  - `starter: Laag-ticket van 21 dagen wint van nieuw Middel, verliest van nieuw Hoog` (drie kandidaten, één dag met `capPerDag` 1; de verwachte `geplaatst` bevat het juiste ticket).
- [ ] **Step 2:** FAIL. **Step 3:** implementeren. **Step 4:** `node --test tests/` → PASS. Werk de snapshot bij met `// gewijzigd door R3`.
- [ ] **Step 5: Commit** `feat(planner): voorrangsscore met wachttijd, starter op hoogste voorrang`

### Task 5: Tijdlijn per dag en laatste starttijd (vervangt `capPerDag`)

**Files:**
- Modify: `public/js/planner.js`, `tests/planner.test.mjs`, `public/index.html` (de schil)
- Schil: `capPerDag` wordt niet meer meegegeven. Daarvoor in de plaats komen:
  - `bestaandPerDag` (uit `planning`, gefilterd op de technieker, `duurMin = duurVoor(id)`);
  - `eigenAfspraken` (`localEvents` van die persoon of zonder persoon, met `uur`; `duurMin = calcWerktijdMin(uur, einduur) || 60`);
  - `blokkeringen` (`avExceptions` kind `range`, global of die persoon);
  - `instellingen.laatsteStart = settings.laatsteStart || '16:00'`.

  De `/api/route`-aanroep voor de gemiddelde reistijd verdwijnt.

**Interfaces:**
- Een dag is een tijdlijn volgens spec §3.3.
- De klok start op `vanTijd` + de reistijd depot → eerste stop.
- Een vrij ticket past als [aankomst, aankomst+duur) niet overlapt en aankomst ≤ `laatsteStart`. Bij overlap springt de klok naar het einde van het blok, en de positie wordt de locatie van het blok.
- Een voorkeursuur-ticket staat exact op zijn uur, zonder de `laatsteStart`-grens.
- `maxPerDag` telt tickets (bestaande + nieuwe).
- `verwachteAankomst` wordt gevuld.
- De redenen `'geen-plaats'`, `'vast-uur-botst'` en `'klant-geblokkeerd'` worden bijgehouden volgens de rangorde.

- [ ] **Step 1: Tests**:
  - `tijdlijn: eigen afspraak 10:00–12:00 → geen ticket overlapt, klok springt erover`;
  - `tijdlijn: geen verwachteAankomst na 16:00`;
  - `tijdlijn: instellingen zonder laatsteStart gebruikt 16:00` (Review Focus 2);
  - `tijdlijn: voorkeursuur 16:30 wordt toch geplaatst op 16:30` (Review Focus 4);
  - `tijdlijn: voorkeursuur 07:00 vóór vanTijd wordt geplaatst indien vrij`;
  - `tijdlijn: blokkering 08:00–17:00 → niets op die dag, tickets naar volgende dag, planWeek eindigt` (Review Focus 3);
  - `tijdlijn: maxPerDag 2 met 1 bestaande → hoogstens 1 nieuw`;
  - `tijdlijn: rit depot→eerste stop telt mee in verwachteAankomst` (depot 30 min verder → eerste aankomst 08:30 bij `vanTijd` 08:00);
  - `reden: ticket met voorkeurTijd dat elke dag botst → 'vast-uur-botst'`;
  - `reden: alle dagen klant-geblokkeerd → 'klant-geblokkeerd'`.
- [ ] **Step 2:** FAIL. **Step 3:** implementeren. `capPerDag` verdwijnt uit het brein. **Step 4:** `node --test tests/` → PASS. Werk de snapshot bij met `// gewijzigd door R8`.
- [ ] **Step 5:** Browser `?test`: een dag met een eigen afspraak krijgt minder of verschoven tickets, en de console is schoon.
- [ ] **Step 6: Commit** `feat(planner): tijdlijn per dag met blokken en laatste starttijd`

### Task 6: Afstandsregel, aanvullen, reistijdgeheugen en schatting bij uitval

**Files:**
- Modify: `public/js/planner.js`, `tests/planner.test.mjs`, `public/index.html` (de adapter geeft `null` per ontbrekende cel en gooit geen fout; bij een fout geeft ze een Map met alle waarden `null`)

**Interfaces:**
- Afstandsregel volgens spec §3.4 (R6):
  - de reistijd vanaf de vorige stop in tijd met gekende locatie moet ≤ `maxReistijdMin` zijn;
  - is er geen stop met een locatie, dan is de dag leeg en kan er een starter komen;
  - staat de laatste stop zonder locatie, dan volgt de waarschuwing `'locatie-onbekend'` met die stop-id.
- Aanvullen: kies de laagste `reistijdMin / voorrang`.
- Geheugen: `Map` op sleutel `${van.lat},${van.lon}|${naar.id}|${vertrekkwartier}`, geldig per `planWeek`-aanroep. Alleen ontbrekende sleutels gaan naar `reistijden`.
- Een waarde `null` wordt de schatting `haversine × 1,3`, met de waarschuwing `'reistijd-geschat'` en de betrokken ticketIds.
- Kandidaten zonder `lat`/`lon` worden nooit geplaatst: reden `'adres-niet-gevonden'`.
- Reden `'te-ver'` wanneer een kandidaat alleen door de afstandsregel werd afgewezen.

- [ ] **Step 1: Tests**:
  - `afstand: twee Hoog-tickets 150 km uit elkaar komen op verschillende dagen`;
  - `afstand: dag met bestaande stop → nieuw ticket op 60 min komt er niet bij, op 30 min wel`;
  - `afstand: starter alleen op lege dag` (dag met een bestaande stop ver weg: het ticket met de hoogste voorrang, dat ver ligt, komt niet op die dag);
  - `aanvullen: keuze op reistijd/voorrang`, met twee gevallen:
    - Hoog op 40 min vs Laag op 15 min → **Hoog** (40/3 = 13,3 < 15/1);
    - Hoog op 44 min vs Laag op 10 min → **Laag** (10/1 < 44/3 = 14,7);
  - `uitval: reistijden geeft null → 45-min-regel werkt op schatting en waarschuwing 'reistijd-geschat'`;
  - `geheugen: zelfde paar wordt niet twee keer opgevraagd` (tel de aanroepen van een spion-`reistijden`);
  - `geen coords: kandidaat zonder lat → 'adres-niet-gevonden', rest gewoon gepland` (Review Focus 1);
  - `locatie-onbekend: laatste bestaande stop zonder coords → waarschuwing, anker = eerdere stop met coords` (Review Focus 5);
  - `reden: enkel te ver voor elke niet-lege dag en geen lege dag meer → 'te-ver'`.
- [ ] **Step 2:** FAIL. **Step 3:** implementeren. Verwijder daarna `pickNearbyCandidate`/`batchTravelTimes` uit `index.html` als niets anders ze nog gebruikt (grep). **Step 4:** `node --test tests/` → PASS. Werk de snapshot bij met `// gewijzigd door R6`.
- [ ] **Step 5: Commit** `feat(planner): 45-min-regel voor elke niet-lege dag, aanvullen op reistijd/voorrang, schatting bij uitval`

### Task 7: Voorkeursdag eerst en botsingen (R7)

**Files:**
- Modify: `public/js/planner.js`, `tests/planner.test.mjs`

**Interfaces:**
- Per dag eerst de kandidaten met `klant[id].voorkeur === dag` (en niet door de klant geblokkeerd), gesorteerd op voorrang. Ze moeten passen volgens de tijdlijn- en afstandsregels.
  - Past een kandidaat niet door afstand: `'voorkeursdag-afstand'`.
  - Past hij niet door tijd, een blok of `maxPerDag`: `'voorkeursdag-vol'`.
  - Die kandidaten worden daarna nergens anders geplaatst.
- Een voorkeursdag buiten `dagen`/`extraVoor`, of een onbruikbare voorkeursdag: gewone kandidaat, zoals vandaag.

- [ ] **Step 1: Tests**:
  - `voorkeursdag: ticket krijgt zijn dag ook als nabije tickets meer zouden passen` (dag vol genoeg: het voorkeursticket staat erop, een nabij gewoon ticket schuift door);
  - `voorkeursdag: twee voorkeuren 150 km uit elkaar → hoogste voorrang geplaatst, andere 'voorkeursdag-afstand'`;
  - `voorkeursdag: dag vol door blokkering → 'voorkeursdag-vol'`;
  - `voorkeursdag: voorkeursdag op feestdag (niet in dagen) → gewone kandidaat`.
- [ ] **Step 2:** FAIL. **Step 3:** implementeren. **Step 4:** `node --test tests/` → PASS. Werk de snapshot bij met `// gewijzigd door R7`.
- [ ] **Step 5: Commit** `feat(planner): voorkeursdag eerst, botsing op afstand gemeld`

### Task 8: Resultaatvenster met redenen en waarschuwingen

**Files:**
- Modify: `public/index.html`:
  - `showResult()` (~4015) krijgt de signatuur `showResult(geplande, nietGepland /* [{ticket, reden}] */, skipped, bericht, waarschuwingen = [])`;
  - `autoPlan` levert `nietGepland`, met `'zoho-fout'` voor een mislukte `addTicketToDate`;
  - de andere aanroepers van `showResult` (grep) geven het nieuwe formaat mee.

**Interfaces — vaste teksten (UI-copy):**

| Reden of waarschuwing | Tekst |
|---|---|
| `geen-plaats` | "Geen plaats meer deze week" |
| `te-ver` | "Te ver van de andere afspraken (meer dan 45 min)". Gebruik de waarde uit `settings.maxReistijdMin`. |
| `klant-geblokkeerd` | "Klant is niet beschikbaar op de vrije dagen" |
| `voorkeursdag-afstand` | "Voorkeursdag botst qua afstand met een ander ticket" |
| `voorkeursdag-vol` | "Voorkeursdag is al vol" |
| `vast-uur-botst` | "Voorkeursuur botst met een andere afspraak" |
| `adres-niet-gevonden` | "Adres niet gevonden" |
| `zoho-fout` | "Kon niet opgeslagen worden in Zoho" |
| `reistijd-geschat` | bovenaan: "⚠ Reistijd kon niet gecontroleerd worden voor N tickets — kijk de route na" |
| `locatie-onbekend` | bovenaan: "⚠ Locatie van een bestaande afspraak onbekend — reistijdcontrole minder nauwkeurig" |

Alle tekst gaat via `escHtml`.

- [ ] **Step 1:** Implementeren.
- [ ] **Step 2:** `node --test tests/` → PASS.
- [ ] **Step 3:** Browser `?test`: een testticket zonder adres of met een voorkeursuur dat botst geeft de juiste reden. Neem ook een screenshot van het venster.
- [ ] **Step 4: Commit** `feat(planner): resultaatvenster toont reden per niet-gepland ticket en waarschuwingen`

### Task 9: `planningsinds.js`, pure logica

**Files:**
- Create: `netlify/lib/planningsinds.js`, `tests/planningsinds.test.mjs`

**Interfaces:**
- Zie het Interfaces-blok bovenaan.
- `statusEvents` = Zoho history-items, nieuwste eerst, met de vorm `{ eventTime, eventInfo: [{ propertyName: 'Status', propertyValue: { previousValue, updatedValue } }] }`. Items zonder Status-transitie negeren.
- `berekenSinds`: loop van nieuw naar oud. Het eerste event waarvan `previousValue` niet in `TRAJECT` zit, levert zijn `eventTime`. Zonder zo'n event: `createdTime`.
- `volgendePaginaNodig(events, 50)` = geen verlaat-event gevonden **en** `events.length === 50`.
- Register: sleutel `'planning-sinds'`, en een leesfout geeft `{}`.

- [ ] **Step 1: Tests**:
  - `berekenSinds: patroon ticket 3638`. Echte Zoho-events, nieuwste eerst:
    1. `2026-09-30T13:33:36.000Z` Wachten op planning → Wachten op bevestiging planning;
    2. `2026-09-29T08:13:43.000Z` Wachten op klant → Wachten op planning;
    3. `2026-09-29T08:13:31.000Z` Open → Wachten op klant;
    4. `2026-09-26T09:49:42.000Z` Gesloten → Open.

    `createdTime` = `2026-06-29T17:07:44.000Z`. Verwacht: `'2026-09-29T08:13:43.000Z'`;
  - `berekenSinds: nooit uit traject → createdTime`;
  - `berekenSinds: terugkeer na Wachten op klant → laatste instap`;
  - `berekenSinds: bevestiging → terug naar te plannen telt door` (klok loopt door, R9);
  - `volgendePaginaNodig: 50 events zonder verlaat-event → true`;
  - `leesRegister: kapotte blob → {}`.
- [ ] **Step 2:** FAIL. **Step 3:** implementeren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(planning-sinds): pure berekening sinds wanneer een ticket in het planningstraject zit`

### Task 10: Endpoint `planning-sinds`

**Files:**
- Create: `netlify/functions/planning-sinds.js`. Structuur zoals `netlify/functions/annuleer.js`: `maakHandler({ getStore, fetch })`, `getAccessToken` met dezelfde env-variabelen, `orgId` via `/organizations`, en `export default maakHandler({ getStore, fetch: globalThis.fetch })`.
- Modify: `tests/planningsinds.test.mjs`, met nep-store en nep-fetch zoals in `tests/annulatie.test.mjs`.

**Interfaces:**
- `POST { opzoeken: string[], actief: string[] }` → `200 { sinds }`.
- History-URL: `${ZOHO_DESK}/tickets/${id}/History?fieldName=status&limit=50&from=${from}`, maximaal 4 pagina's.
- `createdTime` komt uit `GET /tickets/${id}`, maar alleen als `berekenSinds` die nodig heeft.
- Maximaal 20 nieuwe opzoekingen per aanroep, in batches van 5.
- Entries buiten `actief` worden verwijderd.
- Het register wordt alleen geschreven bij een wijziging.
- Faalt een opzoeking, dan wordt die waarde `null` en komt ze niet in het register.
- Een Blobs-fout geeft toch 200, met de waarden die gekend zijn.
- `isTestVerzoek(req)` → `{ sinds: {} }`, zonder Zoho.
- Methode ≠ POST → 405.

- [ ] **Step 1: Tests**:
  - `handler: bestaand register-entry → geen Zoho-aanroep`;
  - `handler: 25 nieuwe → 20 opgezocht, 5 null`;
  - `handler: entry buiten actief wordt verwijderd`;
  - `handler: Zoho-fout bij één ticket → dat ticket null, rest ok, status 200`;
  - `handler: testverzoek → {sinds:{}} zonder fetch`;
  - `handler: GET → 405`.
- [ ] **Step 2:** FAIL. **Step 3:** implementeren. **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** `feat(planning-sinds): endpoint met register in Blobs`

### Task 11: Frontend-koppeling, ticketdetail, dummy-data en instelling "Laatste start"

**Files:**
- Modify: `public/index.html`:
  - na een geslaagde `loadTickets()` (niet in `TEST_MODE`): fire-and-forget `POST /api/planning-sinds` met `opzoeken` = ids van `allTickets` en `actief` = ids van `allTickets + allPending + allGepland`. Zet `t.inPlanningSinds` op de ticketobjecten. Fouten alleen via `console.warn`.
  - `DUMMY_DATA` (~660): de te plannen tickets krijgen `inPlanningSinds` op 1, 10 en 25 dagen geleden, ten opzichte van `new Date()`, en verzonnen `_lat`/`_lon`, zodat de reistijdregels in `?test` echt werken.
  - Ticketdetail (~5574): rij `row('In planning sinds', t.inPlanningSinds && fmtDateShort(t.inPlanningSinds))`, direct na `Interventiedatum`.
  - Instellingen (~285–289): een extra tijdveld `set-laatste-start`, label "Laatste start", met laden (~6047) en bewaren (~6076). `DEFAULT_SETTINGS.laatsteStart = '16:00'`. Bewaren weigert een waarde die niet tussen `vanTijd` en `totTijd` ligt, met een toast.

- [ ] **Step 1:** Implementeren.
- [ ] **Step 2:** `node --test tests/` → PASS.
- [ ] **Step 3: Browser `?test`**:
  - het ticketdetail toont "In planning sinds";
  - Instellingen tonen 16:00;
  - wijzigen naar 15:00, bewaren en "Plan deze week": geen aankomst na 15:00;
  - na het wissen van de opgeslagen instelling (localStorage) valt de waarde terug op 16:00;
  - de console is schoon;
  - de route-tab werkt nog: slepen, optimaliseren, tijden vastleggen.
- [ ] **Step 4: Commit** `feat(planner): wachttijd in ticketdetail, instelling laatste start, testdata`

### Task 12: Eindcontrole van de hele branch

- [ ] **Step 1:** `node --test tests/` → alles PASS. Output bewaren voor het rapport.
- [ ] **Step 2:** Browser `?test`, de volledige doorloop uit spec §7, op desktop en op gsm-formaat (`resize_window` mobile, daarna terug naar desktop).
- [ ] **Step 3:** `git diff main --stat` nakijken: geen onbedoelde bestanden, zoals `.claude/launch.json`.
- [ ] **Step 4:** Eindreview (opus) over de hele branch, daarna `finishing-a-development-branch`. Dat omvat:
  - v1.11.0 in `package.json` en `package-lock.json`;
  - `CHANGELOG`;
  - `CACHE_NAME` +1;
  - een tag.

  **Niet pushen zonder de expliciete "ja" van Brent.**
