# Planner-brein — design (v1.11.0)

Datum: 2026-09-30 · Opdrachtgever: Brent Calaerts · Basis: code v1.10.1 (`6da4f68`)

## 1. Doel

"⚡ Plan deze week" (`autoPlan()` in `public/index.html`) wordt herschikt tot een apart, testbaar
**planner-brein** en krijgt nieuwe beslisregels. Aanleiding is de planner-review van 2026-09-30.
Die leverde acht bevindingen op:

1. geen blokkering bij de filter "Iedereen";
2. eigen afspraken tellen niet mee als bezette tijd;
3. hoge prioriteit garandeert geen plaats;
4. wachttijd telt niet mee;
5. een ticket met voorkeursdag krijgt geen voorrang op die dag;
6. de planner plant voorbij de bekeken week;
7. het einde van de dag wordt niet op het uur bewaakt;
8. als de reistijdcontrole uitvalt, gebeurt dat zonder melding.

Succes betekent:
- Dringende tickets en tickets die lang wachten, krijgen eerst een plaats. Techniekers rijden niet
  heen en weer door het land: tussen opeenvolgende stops ligt altijd maximaal
  `settings.maxReistijdMin` (45 minuten).
- Elke beslisregel is afgedekt met een automatische test (`node --test`), zonder TomTom of Zoho.
- Het gedrag in de route-tab (slepen, optimaliseren, "Tijden vastleggen") blijft ongewijzigd.

## 2. Rulings van Brent (2026-09-30)

| # | Onderwerp | Beslissing |
|---|---|---|
| R1 | Filter "Iedereen" | "Plan deze week" blokkeren met de melding "Kies eerst een technieker". Niet per technieker plannen. |
| R2 | Reikwijdte | Alleen de bekeken week, vanaf vandaag. Alleen een ticket met een voorkeursdatum in een latere week wordt op die dag gezet. |
| R3 | Voorrang | Evenwicht: dringend en lang wachtend bepalen **welke dag** een ticket krijgt, afstand bepaalt **wat erbij mag**. |
| R4 | Wachttijd meten | Via de Zoho-statusgeschiedenis: sinds wanneer het ticket in het planningstraject zit. Niet sinds de aanmaak, niet via de vervaldatum. |
| R5 | Weging wachttijd | Geleidelijk: +0,5 per week, maximaal +1,5 na 3 weken. |
| R6 | 45-minutenregel | Geldt voor **elk** ticket dat bij een dag komt waar al iets op staat. Een starter zonder afstandscontrole kan alleen op een lege dag. |
| R7 | Twee voorkeursdagen ver uit elkaar | Het ticket met de meeste voorrang krijgt de dag. Het andere komt bij "past niet", met de reden erbij. |
| R8 | Einde van de dag | Geen harde eindtijd. In de plaats komt een **laatste starttijd**, standaard 16:00, één instelling voor iedereen. |
| R9 | Klok wachttijd | De klok loopt door zolang het ticket in het traject zit (te plannen → wachten op bevestiging → gepland → en terug). Hij begint opnieuw zodra het ticket het traject verlaat. |
| R10 | Aanpak | Optie 1: een apart, puur rekenend brein. Eerst verhuizen met tests die het huidige gedrag vastleggen, daarna de nieuwe regels. |

## 3. Beslisregels van het brein

### 3.1 Vooraf
- Staat `activeAssigneeFilter === 'all'`, dan toont de app een toast "Kies eerst een technieker"
  en roept ze het brein niet aan. (R1)
- **Dagen**: de werkdagen van de bekeken week (`getWeekStart(today, kalOffset)` + 6), alleen
  vanaf vandaag.
  - Feestdagen en volledig geblokkeerde dagen (`avExceptions` met kind `fullday`) vallen af.
  - Extra **voorkeursdagen** buiten de week komen erbij, maar alleen voor het ticket (of de
    tickets) met die voorkeursdatum. (R2)
- **Kandidaten**: de tickets van de gekozen technieker met adres die nog niet in behandeling
  zijn, zoals nu (`toplan`). Tickets zonder adres blijven `skipped`.

### 3.2 Voorrangsscore
```
voorrang(t) = prioBasis(t) + wachtBonus(t)
prioBasis   : High → 3, Medium → 2, Low → 1, leeg/onbekend → 1
wachtBonus  : min(1.5, 0.5 × dagenInPlanning / 7)     (doorlopend, niet per volle week)
              interventieDatum in het verleden (achterstallig) → 1.5
dagenInPlanning = (vandaag − t.inPlanningSinds) in dagen; ontbreekt inPlanningSinds → bonus 0
```
Controle op de voorbeelden: een Laag-ticket dat 3 weken wacht (2,5) gaat voor een nieuw
Middel-ticket (2), maar niet voor een nieuw Hoog-ticket (3).

Bij gelijke voorrang beslist eerst de kortste reistijd, daarna het laagste ticketnummer. Zo blijft
de uitkomst reproduceerbaar.

### 3.3 Een dag als tijdlijn
Het brein rekent elke dag uur per uur af. Het oude grove tellen verdwijnt: `capacityForDay()` met
een gemiddelde reistijd en "slots".
- **Blokken** zijn vaste bezettingen op de tijdlijn:
  - bestaande stops met een uur;
  - eigen afspraken (`localEvents` van die persoon of zonder persoon), met hun eigen duur, of
    60 minuten zonder einduur;
  - tijdvak-blokkeringen (`avExceptions` kind `range`, scope global of die persoon);
  - geplaatste tickets met een voorkeursuur (`kbPreferredTime`).
- **Blokken met een locatie** worden stops in de keten: bestaande tickets en eigen afspraken met
  coördinaten. Tijdvak-blokkeringen hebben geen locatie.
- **Bestaande stops zonder uur** worden vooraan in de keten gezet, vanaf `vanTijd`, in hun huidige
  volgorde.
- **De klok** start om `vanTijd` + de reistijd vanaf het depot naar de eerste stop. Die eerste rit
  telt dus mee voor de klok, maar niet voor de 45-minutencontrole.
- **Een vrij ticket** komt op het eerste moment waarop [aankomst, aankomst + duur) niet overlapt met
  een blok. Overlapt het wel, dan springt de klok naar het einde van dat blok, en de positie wordt de
  locatie van dat blok, als het er een heeft.
- **Een ticket met voorkeursuur** komt precies op zijn uur. Overlapt het, dan past het niet op die
  dag (zoals `botstMetVastUur` nu).
- **Laatste starttijd** (`settings.laatsteStart`, standaard `'16:00'`): een vrij ticket past alleen
  als de geschatte aankomst ≤ `laatsteStart` valt. Een voorkeursuur van de klant gaat voor op deze
  grens. (R8)
- **`settings.maxPerDag`** blijft een extra rem, geteld als het **aantal tickets** op de dag
  (bestaande + nieuwe). Lange tickets worden al door de tijdlijn begrensd, dus het omrekenen naar
  slots met `ceil(duur/duurMinuten)` vervalt.
- **Duur** blijft `duurVoor(id)`: `duurOverride` of `settings.duurMinuten`.

### 3.4 Afstandsregel (R6)
- **Reistijdcontrole**: een ticket mag bij een dag met minstens één stop met gekende locatie alleen
  als de reistijd vanaf de **vorige stop in tijd** met gekende locatie ≤ `maxReistijdMin` is.
  - Voor een voorkeursuur-ticket is dat de stop die in tijd net vóór zijn uur ligt.
  - Heeft die stop geen gekende locatie, dan gebruikt het brein de laatste eerdere stop die er wel
    een heeft.
  - Is er geen enkele stop met gekende locatie, dan geldt de dag als leeg voor deze regel.
- **Reistijden** zijn historische TomTom-reistijden voor het geschatte vertrekmoment, zoals nu via
  `/api/matrix`.

### 3.5 Volgorde van vullen, per dag, in chronologische volgorde
1. **Voorkeursdag**: tickets met `kbPreferred(id) === dag` en de dag niet door de klant
   geblokkeerd, gesorteerd op voorrang. Elk ticket moet passen volgens 3.3 en 3.4.
   - Past het niet door afstand, dan komt het bij "past niet", met de reden `voorkeursdag-afstand`
     (R7).
   - Past het niet door tijd of een blok, dan is de reden `voorkeursdag-vol`.
   - Een ticket met voorkeursdag wordt nooit op een andere dag gezet, zolang zijn voorkeursdag
     binnen de dagenlijst valt en die dag bruikbaar is. Anders is het een gewone kandidaat (zoals
     nu).
2. **Starter**: is de dag daarna nog leeg (geen stop met gekende locatie), dan gaat de dag naar de
   kandidaat met de hoogste voorrang die past volgens 3.3. Er is dan geen afstandscontrole.
3. **Aanvullen**: kandidaten die passen volgens 3.3 en 3.4. De keuze valt op de laagste
   `reistijdMin / voorrang`. Dat herhaalt zich tot:
   - er niemand meer past;
   - `maxPerDag` bereikt is;
   - de laatste starttijd voorbij is.
- **Uitgesloten voor een dag**: tickets die de klant op die dag blokkeerde (`kbBlocked`), en
  tickets die gereserveerd zijn voor een andere voorkeursdag.

### 3.6 Uitkomst
```
{
  geplaatst:    [{ ticketId, datum, verwachteAankomst /* 'HH:MM' */ }],
  nietGepland:  [{ ticketId, reden }],
  waarschuwingen: [{ soort, ticketIds }]
}
```
- **Redenen**:

  | Reden | Betekenis |
  |---|---|
  | `geen-plaats` | week vol |
  | `te-ver` | op geen enkele dag binnen de reistijd, en geen lege dag meer |
  | `klant-geblokkeerd` | alle overblijvende dagen geblokkeerd |
  | `voorkeursdag-afstand` | zie 3.5, stap 1 |
  | `voorkeursdag-vol` | zie 3.5, stap 1 |
  | `vast-uur-botst` | het voorkeursuur overlapt op elke dag |

  Het brein houdt per ticket de meest specifieke reden bij die het tegenkwam.
  `zoho-fout` voegt de app zelf toe, na het wegschrijven.
- **Waarschuwingen**:
  - `reistijd-geschat`: TomTom gaf geen antwoord. Het brein rekende dan met een schatting uit de
    hemelsbrede afstand (reistijdMin ≈ km × 1,3) in plaats van de controle over te slaan. Dit
    vervangt het huidige stille fail-open (bevinding 8).
  - `locatie-onbekend`: een ankerstop heeft geen coördinaten.
- **Resultaatvenster** (`showResult`): toont de geplaatste tickets zoals nu. Bij elk ticket uit
  "past niet" staat de reden in gewone taal, en de waarschuwingen staan bovenaan.

## 4. Opbouw

### 4.1 Nieuw: `public/js/planner.js` (ES-module, geen DOM, geen globals)
- `export async function planWeek(invoer)`, waarbij de invoer bestaat uit:
  - `{ kandidaten, dagen, bestaandPerDag, eigenAfspraken, blokkeringen, klant, instellingen, depot, vandaag, reistijden }`
  - `klant` bevat per ticketId `{ voorkeur, voorkeurTijd, geblokkeerd[], duurOverride }`;
  - `reistijden(van, naarLijst, vertrekIso) → Promise<Map<id, minuten | null>>` is een ingespoten
    functie;
  - uitvoer volgens 3.6.
- `export function voorrang(ticket, vandaag)` (3.2), plus kleine pure hulpfuncties voor de tijdlijn.
- **Geheugen voor reistijden**: het brein onthoudt reistijden per (van, naar, vertrekkwartier), één
  keer per planning. Eén matrix-aanvraag per stap blijft mogelijk, maar een combinatie die al
  gekend is, wordt niet opnieuw gevraagd.
- Zoals `sorteer.js` zet de module ook `window.planWeek` wanneer `window` bestaat, zodat het
  klassieke script in `index.html` hem kan aanroepen.

### 4.2 `autoPlan()` in `index.html` wordt een dunne schil
1. controle R1;
2. dagenlijst en invoer opbouwen uit de globals;
3. geocoderen: cache en `/api/optimize`, zoals nu;
4. een `reistijden`-adapter op `/api/matrix`, met de schatting en waarschuwing bij een fout;
5. `planWeek`;
6. per geplaatst ticket `addTicketToDate`, zoals nu, en een mislukking wordt reden `zoho-fout`;
7. `showResult`.

### 4.3 Gedeelde dagstop-opbouw
- **`stopsVoorDag(date)`** geeft `{ stops, localForDate, allStops }` terug, met exact de huidige
  filter- en sorteerregels.
  - Die functie vervangt de vijf identieke kopieën in `renderRouteList`, `applyRouteOrder`,
    `optimizeRoute`, `calculateRoute` en `computeArrivalTimes`.
  - Dit is een mechanische vervanging zonder gedragswijziging. Verder wordt de route-tab niet
    herschikt.

### 4.4 Opruimen
- **Verwijderen**:
  - dode code `geoCluster`, `geoClusterFrom`, `estimateTravelMinFromRoute`;
  - de in-`autoPlan` functies `fillScore` en `botstMetVastUur`, die opgaan in het brein;
  - de gemiddelde-reistijdberekening via `/api/route` in `autoPlan`.
- **`capacityForDay()` en `nextAvailableDay()`** blijven bestaan voor `quickAdd` en de kalenderkop.
  Ze vallen buiten de scope, zie §8.

### 4.5 Instelling
- **`DEFAULT_SETTINGS.laatsteStart = '16:00'`**, met een tijdveld "Laatste start" naast van/tot in
  Instellingen.
- Oude opgeslagen instellingen zonder dit veld vallen terug op `'16:00'`.

## 5. Wachttijd uit Zoho (R4, R9)

### 5.1 Pure logica: `netlify/lib/planningsinds.js`
- **Traject** = `['Service in te plannen', 'Wachten op planning', 'Wachten op bevestiging planning', 'Geplande service', 'Geplande support']`.
- **`berekenSinds(statusEvents, createdTime)`**: de events staan nieuwste eerst, zoals de Zoho
  `GET /tickets/{id}/History?fieldName=status` ze teruggeeft (geverifieerd op ticket 3638). Het
  algoritme:
  - loop van nieuw naar oud;
  - zolang `previousValue` in het traject zit, loop verder;
  - het eerste event waarvan `previousValue` **niet** in het traject zit, levert
    `inPlanningSinds = eventTime`;
  - is de geschiedenis op zonder zo'n event, dan geldt `createdTime`.
- **Paginering**: Zoho geeft maximaal 50 events per pagina. De functie haalt zo nodig meer
  pagina's op, met een maximum van 4.

### 5.2 Register: blob `planning-sinds` (store `blitz-data`)
- Structuur: `{ [ticketId]: { sinds } }`, met `leesRegister`/`schrijfRegister` in de stijl van
  `voorstelregister.js`.
- **`tickets.js`**:
  - leest het register;
  - vult voor elk ticket in `tickets` (te plannen) zonder entry `sinds` aan via de history-aanroep;
  - doet dat in batches van 5, met **maximaal 20 nieuwe opzoekingen per aanroep** om binnen de
    tijdslimiet van de functie te blijven (de rest volgt bij de volgende keer laden);
  - verwijdert entries van tickets die in geen enkele traject-status meer voorkomen;
  - schrijft het register alleen als er iets veranderde.
- Elk ticket in `tickets`, `pendingTickets` en `plannedTickets` krijgt `inPlanningSinds`
  (ISO of `null`).
- Een ticket dat tussen twee keer laden het traject verlaat en er weer in komt, behoudt zijn oude
  datum. Dat is aanvaard: een zeldzaam randgeval.

### 5.3 Fouten
- **De history-aanroep of het register faalt**: het ticket krijgt `inPlanningSinds: null`, dus
  bonus 0. Het laden van de tickets faalt nooit op dit onderdeel, en de volgende keer laden
  probeert opnieuw.
- **Testmodus** (`?test`, `netlify/lib/testmodus.js` en de dummy-tickets in `index.html`): de
  dummy-tickets krijgen verzonnen `inPlanningSinds`-waarden, onder meer 1 dag, 10 dagen en 25 dagen
  geleden.

### 5.4 Weergave
Het ticketdetail krijgt een rij "In planning sinds" (dd/mm), naast "Interventiedatum".

## 6. Bouwvolgorde (voor het plan)
1. **Verhuizen zonder gedragswijziging**:
   - het huidige `autoPlan`-algoritme één op één naar `planner.js`, met ingespoten `reistijden`;
   - `autoPlan` wordt de schil;
   - karakterisatietests in `tests/planner.test.mjs` leggen de huidige uitkomst vast op een reeks
     voorbeeldweken, met een nep-`reistijden` (km × 1,3);
   - `stopsVoorDag` en het opruimen van dode code horen ook in deze stap.
2. **Nieuwe regels, één per taak, telkens met eerst de test**:
   - R1;
   - R2;
   - voorrang (3.2);
   - tijdlijn met blokken en laatste starttijd (3.3);
   - afstandsregel en starter alleen op een lege dag (3.4, 3.5);
   - voorkeursdag-voorrang en botsing (3.5, stap 1);
   - redenen en waarschuwingen (3.6), met de reistijd-schatting als fallback.

   Bij elke taak worden de karakterisatietests die het bewust wijzigt, expliciet aangepast, met een
   verwijzing naar de regel.
3. **Wachttijd**: `planningsinds.js` met tests (`tests/planningsinds.test.mjs`), daarna het
   register in `tickets.js`, dan de weergave in het ticketdetail en de testmodus-data.
4. **Instelling** `laatsteStart`, en het resultaatvenster met redenen.
5. **Afronden**: v1.11.0 (MINOR), `CHANGELOG.md`, `CACHE_NAME` +1 in `public/sw.js`, tag.

## 7. Testen
- **`node --test`**:
  - `planner.test.mjs`, met minimaal deze scenario's:
    - twee Hoog-tickets 150 km uit elkaar komen op verschillende dagen;
    - een Laag-ticket van 21 dagen gaat voor een nieuw Middel-ticket, maar niet voor een nieuw
      Hoog-ticket;
    - een eigen afspraak van 10:00 tot 12:00 blokkeert, en de klok springt eroverheen;
    - geen enkele aankomst valt na 16:00, behalve bij een voorkeursuur;
    - twee voorkeursdagen ver uit elkaar geven `voorkeursdag-afstand`;
    - een voorkeursdatum over 3 weken plaatst alleen dat ticket buiten de week;
    - bij `reistijden` die `null` teruggeeft, verschijnt de waarschuwing `reistijd-geschat`, en de
      45-minutenregel werkt nog op de schatting;
    - `maxPerDag` wordt gerespecteerd;
    - dagen die de klant blokkeerde, worden niet gebruikt.
  - `planningsinds.test.mjs`: het echte patroon van ticket 3638, een ticket dat nooit het traject
    verliet (valt terug op `createdTime`), terugkeer na "Wachten op klant", en paginering.
- **In de browser** op `http://localhost:3333/?test`: "Iedereen" geblokkeerd, "Plan deze week" met
  de dummy-tickets, het resultaatvenster met redenen, de instelling "Laatste start", het ticketdetail
  "In planning sinds", en de route-tab ongewijzigd (slepen, optimaliseren, tijden vastleggen).

## 8. Buiten scope (bewust)
- Een voorstel tonen en bevestigen vóór het wegschrijven naar Zoho: kan later, dankzij het brein.
- Instellingen per technieker (duur, laatste starttijd) en een vertrekadres per technieker: op de
  backlog.
- `quickAdd`/`nextAvailableDay` en de capaciteitsweergave in de kalenderkop gebruiken nog het oude
  slotmodel.
- De route-tab verder herschikken, en botsingsdetectie bij vaste tijdstippen.
- Bestaande geplande tickets herschikken: het brein plaatst alleen nieuwe tickets.
