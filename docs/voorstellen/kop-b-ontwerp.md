# Kop B: één persoonskiezer, één werkbalk, geen Route op de gsm (ontwerp en bouwplan)

Datum: 2026-10-11 · Tak: `refactor` (niet `main`) · Gebaseerd op voorstel B uit `sales-kop-voorstellen.html`
Tekeningen: `kop-b-mockups.html` (zelfde map)

---

## 1. Samenvatting voor Brent

**Het idee in één zin:** bovenaan staat voor iedereen dezelfde kop met één knop "wiens planning bekijk ik". Elk
planningsscherm heeft één werkbalk, bij techniekers en verkopers in dezelfde vorm. Op de gsm is er geen Route meer:
daar loop je je dag door in de Kalender, met per afspraak Bellen en Navigeer, en dat geldt voor de technieker en voor
de verkoper.

**Wat verandert er voor wie?**

- **Technieker**
  - Zonder "Mag zelf plannen" (de meeste techniekers): **bijna niets**. De kop, de tabs (Kalender, Ingepland,
    Inventaris, Rapporten) en de schermen blijven zoals ze zijn. In de persoonskiezer staat "(jij)" achter zijn
    eigen naam.
  - Met "Mag zelf plannen", **op de gsm**: de tab Route verdwijnt (zoals bij alle andere rollen op een gsm). Hij
    doorloopt zijn dag in de Kalender, zoals zijn collega's dat al doen. In de Kalender wordt "⚡ Plan deze week" een
    kort "⚡ Plan" naast de weekknoppen, zodat de kop één regel blijft.
  - Met "Mag zelf plannen", **op tablet en computer**: op Route komen de knoppen en de weekstrook op één regel. De
    datum kies je met het kalendericoontje 📅 of door op een dag in de weekstrook te tikken.
- **Planner (computer)**
  - Persoonskiezer: zoals nu, alleen techniekers en "Alle technici". Geen verkopers.
  - **Route**: knoppen en weekstrook op één regel. De kaart begint 56 px hoger. **Wachtrij**: zoeken en sorteren
    komen op een vaste balk onder de tabs, in dezelfde vorm als de balk boven de Leads.
  - Kalender, Ingepland, Inventaris en Rapporten blijven zoals ze zijn. Op een gsm heeft ook de planner geen Route.
- **Verkoper**
  - De aparte balk met "⚙ Instellingen" verdwijnt. ⚙ staat voortaan bovenaan in de kop, net als bij de techniekers,
    en opent zijn eigen sales-instellingen. ↺ (vernieuwen) staat er nu ook.
  - Geen persoonskiezer: hij ziet alleen zichzelf, en zijn initialen-knop zegt al wie er ingelogd is.
  - **Op de gsm**: de tabs zijn Leads · Kalender · Afgewerkt, zonder Route. De Kalender toont, net als bij de
    technieker, de dagen onder elkaar met de bezoeken op volgorde. Op elk bezoek staan **📞 Bellen, 🧭 Navigeer en
    📋 Resultaat**, en een rode lijn "nu 10:42" toont waar hij in zijn dag zit.
  - **Op tablet en computer**: Route en Leads hebben elk één werkbalk. De kaart begint op 153 px in plaats van 270 px.
- **Sales manager**
  - De verkoperkeuze verhuist van de eigen balk naar de persoonskiezer in de kop ("👥 Sales: An ▾"). In de lijst
    staan **alleen verkopers**. "Alleen lezen" staat voortaan in die knop.
  - ⚙ in de kop opent altijd zijn **eigen** sales-instellingen, ook als hij de leads van een collega bekijkt.
  - Op de gsm: geen Route, wel het dagoverzicht in de Kalender.
- **Beheerder**
  - De hoofdtab **"Sales" verdwijnt**, samen met de titel en de subtabs. Je kiest in de persoonskiezer wie je wilt
    zien. Daar staat **iedereen**, gegroepeerd in "Techniek" en "Sales", met de rol achter de naam
    ("Tim Peeters · technieker", "An Maes · verkoper").
  - Kies je een verkoper, dan worden de tabs **Leads · Kalender · Route · Afgewerkt · Beheer** (op de gsm zonder
    Route). Kies je een technieker of "Alle technici", dan krijg je de gewone tabs terug. Je blijft op hetzelfde soort
    scherm: Route blijft Route, Kalender blijft Kalender.
  - De knop bovenaan laat zien waar je zit: "👤 Planning: Tim" of "👥 Sales: An" (met een groene rand).
  - Bovenaan het menu staat "↩ Terug naar techniekers (Tim)". Daarmee ben je met één klik terug.

**Wat je moet weten**

- **Route op de gsm verdwijnt voor iedereen**, ook voor de planner, de beheerder, de sales manager en de technieker
  met "Mag zelf plannen". Wie een route wil optimaliseren, doet dat op een tablet of computer. Op een tablet blijft
  Route bestaan.
- Er komt **geen nieuwe toegang op de server**. Techniekers en planners krijgen hun namenlijst zoals nu uit de
  tickets. De sales manager gebruikt de lijst die hij nu al krijgt, zonder e-mailadressen. Alleen de beheerder vraagt
  de volledige gebruikerslijst op, en het menu toont daarvan alleen naam en rol, nooit een e-mailadres.
- Dit gebeurt op de tak `refactor` en gaat pas live met de volledige refactor.
- Bouwtijd: **±3 u tot 3 u 40** (5 taken en een volledige test), zie §4.

**Wat je moet beslissen:** drie punten, zie §5, elk met mijn aanbeveling.

---

## 2. Ontwerp

### 2.1 Huidige toestand (gelezen uit de code, tak `refactor`)

| Onderdeel | Nu |
|---|---|
| App-kop (`index.html` `<header>`) | logo · TEST · persoonskiezer `#person-sel` ("👤 Planning: Alle ▾") · ↺ · 🌙 · ⚙ · account-knop (initialen, `gebruikersmenu.js`) |
| Persoonskiezer (`app.js` `buildPersonSelector`) | De namen zijn de Zoho-toegewezenen uit de tickets plus de eigen Zoho-naam (`personenUitTickets`). "Alle technici" staat er alleen voor wie mag plannen. De keuze zit in `localStorage.blitz_active_person`. Het menu bouwt HTML met `innerHTML` en zet de Zoho-naam er **niet ge-escaped** in. |
| Sales (rol `sales`) | `sales-start.js` verbergt ↺, ⚙ en de persoonskiezer. Er zijn vier hoofdtabs, Leads/Kalender/Route/Afgewerkt, plus Beheer voor de sales manager. Dat geldt ook op de gsm. |
| Verkoperkeuze | `sales-verkoper.js` `renderVerkoperBalk` tekent een eigen balk (`.sales-balk`) bovenaan elk sales-scherm, met een `<select>`, "Alleen lezen", een foutmelding en "⚙ Instellingen" (alleen bij de eigen leads). De keuze zit in `localStorage.blitz_sales_verkoper`. |
| Beheerder en sales | Er is een extra hoofdtab "Sales" (`sales-registratie.js`). `sales-beheer.js` tekent daarin de titel "Sales" en een eigen subtabbalk. |
| ⚙ | Opent **altijd de eigen** instellingen (`instellingen.openSettings`, eigen kopie `_doelSettings`), los van de persoonskiezer. |
| Route (technieker en sales) | `.plan-header` (datumveld, ⚡ Optimaliseer, Bereken tijden, ✕ Leeg) en daaronder `.week-strip` (weekstrook, `week-strook.js`, gedeeld). Route wordt verborgen **per rol** (`.coord-only`), niet per toestel: een technieker met "Mag zelf plannen", een planner en een verkoper hebben Route vandaag ook op de gsm. |
| Kalender op de gsm (`data-indeling="smal"`) | **Technieker** (`kalender.js`): de dagen staan onder elkaar, met de kaartjes per dag gesorteerd op uur (tickets, eigen afspraken en afgewerkte rapporten). Elk ticketkaartje heeft 📞 Bellen en 🧭 Navigeer; een tik opent het ticket, en van daaruit start het rapport. Een rode regel "nu 10:42" staat vóór het eerstvolgende kaartje van vandaag (`updateNuMarker`), en er is een badge "buiten werkuren". De knop "Route bekijken" bovenaan een dag is `.coord-only`. **Sales** (`sales-kalender.js` `kaartjesDag`): ook dagen onder elkaar met kaartjes op uur, en ook 📞 Bellen en 🧭 Navigeer. Een tik opent het bezoekvenster, met Resultaat daarin. Er is **geen** nu-lijn, en afgewerkte bezoeken verdwijnen uit de dag. |
| Kalenderkop | Technieker: `.kal-header` (plakt bovenaan, één regel). Sales: `.sales-kal-kop` binnen de inhoud, met 16 px witruimte erboven, en dezelfde knopklassen. |
| Wachtrij / Leads | Wachtrij: `.wq-toolbar` in de lijst (zoeken en sorteren, de teller op een eigen regel). Leads: `.sales-lijst-acties` en `.sales-filter`, op twee regels. |
| Gebruikerslijsten (server) | `GET /api/gebruikers`: de beheerder krijgt alles (met e-mail); de planner alleen techniekers en zichzelf (geen e-mail); de sales manager alleen verkopers (geen e-mail). `?rol=sales`: beheerder en sales manager. **De technieker heeft geen toegang.** |

Twee dingen die uit de code blijken:

1. Een sales-account heeft nooit een Zoho-naam (`eigenZohoNaam()` geeft '' voor sales). In de lijst van een
   technieker of planner staan dus **vandaag al geen verkopers**. Het enige grensgeval zijn beheerders en planners
   met een Zoho-naam, omdat ze zelf interventies uitvoeren (open beslissing 1).
2. Het "patroon van de technieker op de gsm" bestaat al: **de Kalender is zijn dagoverzicht.** Hij heeft geen Route
   nodig, omdat de volgorde van zijn dag al vastligt in de planning. De sales-kalender op de gsm volgt dat patroon al
   grotendeels. Er ontbreken alleen de nu-lijn, de afgewerkte bezoeken en een directe Resultaat-knop.

### 2.2 De persoonskiezer: één plek voor iedereen

De knop `#person-btn` blijft op dezelfde plek. Het menu wordt door één nieuwe module getekend
(`schermen/persoonskiezer.js`). Die gebruiken zowel de gewone opstart (`app.js`) als de sales-start
(`sales-start.js`). De lijst zelf berekent een pure functie (`schermen/persoonskiezer-logica.js`), zodat ze zonder
browser te testen is.

**Lijst per rol**

| Rol | Knop toont | In het menu | "Alle" |
|---|---|---|---|
| Technieker (met of zonder vinkje) | "👤 Planning: Tim ▾" | alle namen uit de tickets en zichzelf, alfabetisch, de eigen naam met "(jij)" | **geen** "Alle" (zoals nu: hij bekijkt één persoon tegelijk) |
| Planner | "👤 Planning: Alle ▾" | "Alle technici" en de namen uit de tickets (en zichzelf als hij een Zoho-naam heeft) | **"Alle technici"** = de gecombineerde weergave van alle techniekers (zoals nu) |
| Gewone verkoper | **geen kiezer** (knop verborgen) | — | — |
| Sales manager | "👥 Sales: An ▾" | alle actieve verkopers (`GET /api/gebruikers?rol=sales`), de eigen naam met "(jij)" | **geen** "Alle": een sales-scherm toont altijd één verkoper, want een gecombineerde sales-weergave bestaat niet |
| Beheerder | "👤 Planning: Tim ▾" of "👥 Sales: An ▾" | twee groepen, met de rol achter elke naam (zie hieronder) | **"Alle technici"** in de groep Techniek; geen "Alle verkopers" |

Een gewone verkoper krijgt geen kiezer en ook geen uitgeschakelde knop. Er valt niets te kiezen, en op de gsm is de
plaats nodig voor ↺ en ⚙.

**Beheerdersmenu (gegroepeerd)**

```
  ↩ Terug naar techniekers (Tim)        ← alleen als je nu een verkoper bekijkt
  TECHNIEK
  [A]  Alle technici                    gecombineerde weergave
  [BC] Brent Calaerts (jij)   beheerder
  [JV] Jens Vermeulen         technieker
  [KD] Kris Dons              planner
  [TP] Tim Peeters            technieker
  [WS] Wim Smets              technieker · geen login
  SALES
  [AM] An Maes                verkoper
  [SM] Sofie Maes             sales manager
  [TP] Tom Peeters            verkoper · geblokkeerd (alleen lezen)
```

- De groep **Techniek** bevat iedereen die in de tickets staat of een account met een Zoho-naam heeft. De rol komt
  uit de gebruikerslijst: de Zoho-naam wordt gekoppeld, ongevoelig voor hoofdletters en spaties. Een Zoho-naam
  zonder account krijgt "technieker · geen login".
- De groep **Sales** bevat alle verkopers, ook de geblokkeerde (zoals nu: alleen lezen).
- De rol staat als klein grijs label rechts van de naam. Op de gsm staat het label onder de naam, want ernaast is
  geen plaats.
- Namen komen **alleen via `textContent`** in het menu. De huidige code zet de Zoho-naam via `innerHTML`; dat
  verdwijnt meteen mee.
- Het menu is een echte lijst: pijltjes op en neer, Enter kiest, Escape sluit en zet de focus terug op de knop. Een
  lange lijst krijgt een maximale hoogte (`calc(100dvh - 80px)`) en scrollt.

**De keuze bewaren**

- `blitz_active_person` (technieker: Zoho-naam of `all`) en `blitz_sales_verkoper` (verkoper-id) blijven bestaan.
- Nieuw, alleen voor de beheerder: `blitz_werkruimte` = `techniek` | `sales`. Kies je een verkoper, dan wordt dat
  `sales`. Kies je een technieker of "Alle technici", dan wordt het `techniek`. De andere keuze blijft bewaard; zo
  weet "↩ Terug naar techniekers" dat het Tim was.
- `kern/eigenaar.js` wist `blitz_werkruimte` mee bij het afmelden en bij een andere gebruiker op hetzelfde toestel.

### 2.3 De beheerder kiest een verkoper: de tabs wisselen

**De hoofdtab "Sales" vervalt**, samen met `sales-beheer.js` (de titel "Sales" en de eigen subtabbalk). De beheerder
werkt voortaan in één van twee **werkruimtes**:

| Werkruimte | Hoofdtabs (tablet en computer) | Hoofdtabs (gsm) |
|---|---|---|
| Techniek | Wachtrij · Kalender · Route · Ingepland · Inventaris · Rapporten · Beheer | idem zonder Route |
| Sales | Leads · Kalender · Route · Afgewerkt · Beheer | Leads · Kalender · Afgewerkt · Beheer |

De sales-werkruimte heeft dus precies de tabs van een sales manager. Technisch registreert `sales-registratie.js` de
vier sales-tabs voor de beheerder onder een eigen sleutel (`beheerder-sales`). `pasRolToe` toont de tabs van de
actieve werkruimte en verbergt de andere met `hidden`, zoals nu al per rol gebeurt. De views met id `view-sales-*`
worden gewone hoofdtab-views, net als bij de verkoper.

**Wat gebeurt er met de huidige tab?** Je blijft op het gelijkaardige scherm:

| Van (techniek) | Naar (sales) | | Van (sales) | Naar (techniek) |
|---|---|---|---|---|
| Wachtrij | Leads | | Leads | Wachtrij |
| Kalender | Kalender | | Kalender | Kalender |
| Route | Route (op de gsm: Kalender) | | Route | Route (op de gsm: Kalender) |
| Ingepland | Leads | | Afgewerkt | Rapporten |
| Inventaris | Leads | | Beheer | Beheer |
| Rapporten | Afgewerkt | | | |
| Beheer | Beheer (de kiezer verandert niets aan Beheer) | | | |

De gekozen datum blijft in dezelfde week: de sales-schermen krijgen bij de wissel de datum van Kalender/Route mee.
De pagina springt naar boven, zoals bij elke tabwissel.

**Hoe merkt de beheerder het?**

- De knop in de kop verandert: "👤 Planning: Tim" wordt "👥 Sales: An", met een groene rand en een groene
  achtergrond (dezelfde stijl als in voorstel B). Bekijkt hij een geblokkeerde verkoper, dan staat er "Alleen lezen"
  in de knop. Op de gsm vallen de woorden "Planning:" en "Sales:" weg; dan tonen het icoon (👤/👥) en de groene rand
  de werkruimte.
- De tabs zelf veranderen: Leads en Afgewerkt in plaats van Wachtrij en Rapporten.
- Bij de wissel verschijnt één korte melding: "Je bekijkt nu de sales-planning van An Maes." (en omgekeerd).
- Een aparte rolbadge in de kop is **niet** nodig. De knop toont de werkruimte al, en op de gsm is er geen plaats.

**Terug-navigatie.** De app gebruikt geen browsergeschiedenis (de terugknop van Android sluit de app), en dat blijft
zo. Terug gaat via het menu, met bovenaan "↩ Terug naar techniekers (Tim)". Na een herlaadbeurt komt de beheerder
terug in dezelfde werkruimte en op dezelfde tab. `planHerstelSchermStaat` bewaart voortaan ook de werkruimte. Een
bewaarde tab die niet bij de werkruimte of het toestel past, wordt via de tabel hierboven omgezet.

**Wat er achter de schermen blijft lopen.** In de sales-werkruimte blijven de tickets op de achtergrond verversen
(de bestaande polling). Zo is de techniekwerkruimte meteen actueel als je terugkeert. Dat kost niets extra: het
gebeurt vandaag ook als de beheerder op de tab Sales staat.

### 2.4 De gsm: geen Route, de Kalender is het dagoverzicht

**De regel.** Route is een scherm om te plannen (volgorde optimaliseren, rijtijden berekenen, een kaart naast een
lijst). Dat is te zwaar voor een telefoonscherm. Op een gsm (`data-indeling="smal"`, uit `apparaat.js`) bestaat de
tab Route daarom **voor niemand**: niet voor de technieker met vinkje, de planner, de beheerder, de verkoper of de
sales manager. Op een **tablet** (staand of liggend) en een **computer** blijft Route zoals hieronder in §2.6.

**Het patroon (van de technieker, nu voor iedereen).** Op de gsm doorloop je je dag in de **Kalender**:

1. De Kalender opent op de huidige week, met de dagen onder elkaar en per dag de afspraken op uur.
2. Elk kaartje toont het uur, de klant, de plaats en de status, met de knoppen voor onderweg:
   - technieker: **📞 Bellen · 🧭 Navigeer**. Een tik op het kaartje opent het ticket, en van daaruit het rapport
     (zoals nu);
   - verkoper: **📞 Bellen · 🧭 Navigeer · 📋 Resultaat**. Een tik op het kaartje opent het bezoekvenster (Bevestigen,
     Uur wijzigen, Details), zoals nu.
3. Een rode regel **"nu 10:42"** staat vóór het eerstvolgende kaartje van vandaag.
4. Wat vandaag al gedaan is, blijft in de dag staan als grijs kaartje: bij de technieker het rapport (zoals nu), bij
   de verkoper het afgewerkte bezoek met zijn resultaat ("✓ Afgewerkt · Offerte gevraagd").
5. Een kaartje buiten de werkuren krijgt de badge "buiten werkuren", bij beide.

**Wat de sales-kalender op de gsm erbij krijgt** (`sales-kalender.js` `kaartjesDag`, `sales-kalender-logica.js`):

| Onderdeel | Technieker (bestaat) | Verkoper (nu) | Verkoper (na) |
|---|---|---|---|
| Dagen onder elkaar, kaartjes op uur | ja | ja | ja |
| 📞 Bellen, 🧭 Navigeer op het kaartje | ja | ja | ja |
| Directe knop voor het verslag | nee (via het ticket) | nee (via het venster) | **📋 Resultaat** op het kaartje (alleen als de leads schrijfbaar zijn) |
| Nu-lijn "nu 10:42" | ja | nee | **ja** (dezelfde klasse `.kal-nu-marker`) |
| Afgewerkt blijft zichtbaar in de dag | ja (rapportkaartje) | nee (verdwijnt) | **ja**, grijs kaartje met het resultaat (`bouwKalenderItems` neemt `afgewerkt` met een `planning.datum` mee als `soort: 'afgewerkt'`) |
| Badge "buiten werkuren" | ja | nee | **ja** |
| Knop "Route bekijken" bovenaan een dag | ja (coördinator) | nee | op de gsm voor **niemand** (de Route-tab bestaat er niet) |

De nu-lijn en de werkuren-badge gaan in een gedeeld stukje code (`schermen/dag-lijst.js`), zodat de twee kalenders
dezelfde functie gebruiken in plaats van een kopie.

**Waar staat het in sales?** In de **Kalender** (weekweergave, die op de gsm al de lijst onder elkaar is), net als bij
de technieker. Niet in Leads: Leads is de werkvoorraad (in te plannen, ingepland, bevestigd), net zoals de Wachtrij
dat is bij de technieker.

**Technisch:**

- Elke tab met de klasse `.alleen-groot` (nieuw; op `tab-planning` en `tab-sales-route`) wordt verborgen met
  `html[data-indeling="smal"] .tab.alleen-groot { display: none !important }`. Daarnaast past `pasRolBeperkingToe`
  (app.js) / de sales-start dezelfde regel toe op de actieve tab: staat iemand op Route en wordt het venster een gsm
  (draaien, venster smaller), dan gaat hij naar Kalender. Dat gebeurt via de bestaande gebeurtenis
  `apparaatwijziging`.
- De knop "Route bekijken" in de techniekerkalender krijgt ook `.alleen-groot`.
- `planHerstelSchermStaat` zet een bewaarde Route-tab op de gsm om naar Kalender.
- De server verandert niet: de route-functies blijven bereikbaar zoals nu. Dit gaat over de weergave.

### 2.5 De kop zoals B, met ⚙ = eigen instellingen

De kop wordt voor iedereen dezelfde rij: **logo · (TEST) · persoonskiezer · ↺ · 🌙 · ⚙ · account**. De hoofdtabs
blijven één regel eronder. Er komen **geen** subtabs of knopjes meer in de tabregel: in voorstel B stonden de vier
sales-onderdelen als knopjes naast "Sales", maar door de werkruimte-wissel is dat niet meer nodig.

**⚙ blijft altijd "mijn eigen instellingen"** (de regel van gisteren), en dat past precies bij B:

| Wie | ⚙ opent |
|---|---|
| Technieker, planner, beheerder | zijn eigen instellingen (zoals nu, `openSettings`), ook als hij een collega of een verkoper bekijkt |
| Verkoper | zijn eigen sales-instellingen (startadres, werkuren, bezoekduur); vroeger "⚙ Instellingen" in de verkoperbalk |
| Sales manager | zijn **eigen** sales-instellingen, ook als hij de leads van een collega bekijkt |

In voorstel B zat "⚙ Sales-instellingen" nog in het menu van de verkoperknop. Dat vervalt: het menu kiest alleen
*wie*, ⚙ is alleen *ik*. De instellingen van een andere verkoper wijzig je (zoals nu) via Beheer → Instellingen.

Technisch: `openSalesInstellingen()` werkt nu alleen als je je eigen leads bekijkt (`kanImporteren`). Het krijgt
dezelfde opbouw als de techniekersinstellingen. De eigen instellingen worden apart opgehaald in een eigen kopie
(`GET /api/instellingen` zonder `gebruiker`). Bewaren gaat naar het eigen record, en de getoonde sales-toestand
wordt alleen bijgewerkt als je je eigen leads bekijkt. Zo kan ⚙ altijd zichtbaar zijn.

↺ herlaadt voor sales de leads en instellingen van het getoonde scherm (dezelfde `herlaad` als de knop "Opnieuw").
Nu is ↺ voor sales verborgen.

### 2.6 De werkbalken: één vorm per soort scherm

De regel: onder de tabs staat **hoogstens één werkbalk**. Die loopt over de volle breedte en plakt onder de kop
(`top: var(--topbar-h)`), met achtergrond `--surface` en onderrand `--border`. Links staat wat je bekijkt (dagen,
periode, zoeken), rechts wat je doet (knoppen). Technieker en sales gebruiken dezelfde klassen.

**Route (alleen tablet en computer; technieker en sales identiek).** De nieuwe `.route-balk` vervangt `.plan-header`
en `.week-strip`:

```
[📅] [‹] [ma 12 ✓ 3] [di 13 ! 2] [wo 14 ✓ 4] [do 15 – 0] [vr 16 ! 1] [›]        [⚡ Optimaliseer] [Bereken tijden] [✕ Leeg]
```

- Elke dag is één knop van 44 px hoog, met links twee regels ("ma 12" / "✓ tijden") en rechts het aantal.
- 📅 is een knop die de datumkiezer opent (`input.showPicker()`). Het bestaande `input#plan-date` blijft in de
  pagina, onzichtbaar over de knop gelegd, zodat alles wat de datum leest of zet blijft werken. Waar `showPicker`
  ontbreekt, opent een tik op het onzichtbare veld zelf de kiezer.
- In een smaller venster (tablet staand) scrollen de dagen zijwaarts en blijven de knoppen rechts zichtbaar. Onder
  ±820 px breed gaan de knoppen naar een tweede regel.
- Een technieker die een collega bekijkt, ziet zoals nu geen Optimaliseer en Leeg (`data-plan-ander`).
- De samenvatting onderaan (stops, afstand, rijtijd) blijft.

**Kalender.** De sales-kalender krijgt dezelfde `.kal-header` als de techniekerkalender. Nu is dat `.sales-kal-kop`
binnen de inhoud, met 16 px witruimte erboven. De vorm: ‹ periode › · Week | Maand · rechts de knoppen (technieker:
⚡ Plan deze week, 📥 Import, ➕ Afspraak; sales: ⚡ Plan deze week, ➕ Blok). Op de gsm:

- technieker met vinkje: ‹ periode › · Week|Maand · "⚡ Plan" op **één regel** (53 px);
- verkoper: ‹ periode › · Week|Maand op regel 1; ⚡ Plan deze week · ➕ Blok op regel 2 (105 px). Vier knoppen passen
  niet op 375 px met aanraakmaten. Dat is dezelfde regel als bij de technieker: wat niet past, schuift naar een
  tweede regel.

**Wachtrij en Leads.** Beide krijgen dezelfde balk, `.lijst-balk`:

- Wachtrij: [zoeken ......] [sorteren ▾] en rechts de teller ("12 tickets").
- Leads: [+ Lead] [Export laden (alleen verkoper)] [zoeken ......] [gebied ▾].

**Ingepland, Inventaris, Rapporten, Afgewerkt.** Deze schermen blijven zoals ze zijn. Ingepland heeft al één balk
(‹ week ›), en Rapporten kreeg net zijn plakkende filterbalk (v1.10.3). Afgewerkt verliest alleen de verkoperbalk,
want die zit nu in de kop.

### 2.7 Wat er voor techniekers concreet verandert (en wat niet)

| Scherm | Computer en tablet | Gsm | Wie ziet het |
|---|---|---|---|
| Kop | ongewijzigd; "(jij)" achter de eigen naam in het menu | ongewijzigd (icoon en voornaam in de knop) | iedereen |
| Wachtrij | zoeken, sorteren en teller op één plakkende balk | zoeken en sorteren op één regel, de teller klein rechts | planner, beheerder, technieker met vinkje |
| Kalender | **niet** | met vinkje: "⚡ Plan deze week" wordt "⚡ Plan" (zelfde knop, korter label; de volledige naam blijft als hulptekst), zodat de kop één regel blijft. Zonder vinkje: niets. | technieker |
| Route | knoppen en weekstrook op één regel, datum via 📅 | **tab verdwijnt** (ook "Route bekijken" in de Kalender) | planner, beheerder, technieker met vinkje |
| Ingepland, Inventaris, Rapporten | niet | niet | — |
| Rapport-wizard, ticketdetail, vensters | niet | niet | — |

**Bewust niet veranderd:** de tabs en hun volgorde (behalve Route op de gsm), de inhoud van elk scherm, het
dagoverzicht van de technieker zelf (dat is het voorbeeld), alle knoplabels behalve "⚡ Plan" op de gsm, het
datumgedrag (de gedeelde week tussen Kalender, Route en Ingepland), en de rechten en wat de server toelaat.

**Telefoonweergave technieker (375 px breed)**

- **Kop** (52 px): ⚡-logo · "👤 Tim ▾" (max. 108 px, voornaam) · ↺ · 🌙 · ⚙ · TP. Ongewijzigd.
- **Tabs** (45 px): Kalender · Ingepland · Inventaris · Rapporten. Met vinkje komt Wachtrij erbij, Route niet meer.
  Vijf tabs passen nog op 375 px; de balk scrollt alleen als het nodig is (met schaduwranden, zoals nu).
- **Kalender = dagoverzicht**: één kopregel van 53 px (‹ "12–16 okt" › · Week|Maand · met vinkje ⚡ Plan),
  daaronder de dagen onder elkaar met de kaartjes, de nu-lijn en Bellen/Navigeer.
- **Persoonsmenu**: opent rechts onder de knop, max. 300 px breed, en scrollt als de lijst lang is. Elke regel is
  44 px hoog (aanraakmaat).

### 2.8 Server en rechten: wie krijgt welke lijst

Voorstel: **geen enkele wijziging aan de server of aan `netlify/lib/rechten.js`.**

| Rol | Bron van de namen | Velden die de kiezer gebruikt | E-mail? |
|---|---|---|---|
| Technieker | tickets (`/api/tickets`, heeft hij al) en de eigen Zoho-naam | Zoho-naam | nee (de bron bevat er geen) |
| Planner | tickets en de eigen Zoho-naam (zoals nu) | Zoho-naam | nee |
| Sales manager | `GET /api/gebruikers?rol=sales` (heeft hij al; geeft `id, naam, rol, salesNaam`) | id, naam | nee (de server stuurt er geen) |
| Gewone verkoper | geen lijst | — | — |
| Beheerder | tickets, `GET /api/gebruikers` (rol en Zoho-naam) en `GET /api/gebruikers?rol=sales&geblokkeerd=1` (verkopers); die heeft hij allebei al | naam, rol, zohoNaam, id, actief | De server stuurt het mee (alleen naar de beheerder, zoals nu in Beheer), maar de kiezer **neemt het niet over**. De logica-functie geeft alleen `{ soort, sleutel, naam, rol, actief, jij }` terug, en een eenheidstest controleert dat er nergens een e-mailveld in de uitvoer zit. |

Waarom dit de minst risicovolle aanpak is: er komt geen nieuw eindpunt en geen nieuwe projectie bij, dus er is
niets dat per ongeluk te veel kan lekken. Een technieker krijgt nog steeds geen toegang tot `/api/gebruikers`.

De twee aanvragen van de beheerder gebeuren pas als hij het menu voor het eerst opent, of bij de start als de
bewaarde werkruimte `sales` is. Ze blijven bewaard tot de volgende herlaadbeurt; Beheer → Gebruikers vraagt ze
opnieuw op na een wijziging. Lukt de aanvraag niet, dan toont het menu de techniekers uit de tickets zonder
rol-labels, met de regel "De lijst met verkopers kon niet geladen worden".

(Kiest Brent bij open beslissing 1 voor "alleen echte techniekers", dan is voor de technieker wél een kleine nieuwe
projectie nodig: zie §5.)

### 2.9 Pixels: waar begint de inhoud?

Gemeten uit de CSS van de app (kop 52 px; tabs 41 px met muis, 45 px met aanraken), met dezelfde methode als in het
voorstellenbestand. "Inhoud" is de eerste stop, de eerste kaart of de eerste kalenderdag.

**Computer (1280 × 800)**

| Rol · scherm | Nu | Na | Winst |
|---|---|---|---|
| Planner/beheerder · Route (techniek) | 209 px | **153 px** | −56 |
| Planner/beheerder · Kalender (techniek) | ±137 px | ±137 px | 0 |
| Planner/beheerder · Wachtrij (eerste ticket) | ±177 px | **±150 px** | −27 |
| Beheerder · Route (sales) | 371 px | **153 px** | −218 |
| Beheerder · Leads | 379 px | **166 px** | −213 |
| Beheerder · Kalender (sales) | ±316 px | **±137 px** | −179 |
| Verkoper · Route | 270 px | **153 px** | −117 |
| Verkoper · Leads | ±278 px | **166 px** | −112 |
| Verkoper · Kalender | ±234 px | **±137 px** | −97 |
| Sales manager | zoals de verkoper; de kiezer zit in de kop en neemt geen extra regel | zoals de verkoper | |

**Gsm (375 px breed, aanraken)**

| Rol · scherm | Nu | Na | Winst |
|---|---|---|---|
| Technieker · Kalender, zonder vinkje (dagoverzicht) | ±150 px | ±150 px | 0 |
| Technieker · Kalender, met vinkje (dagoverzicht) | ±202 px | **±150 px** | −52 |
| Verkoper / sales manager · Kalender (dagoverzicht) | ±290 px | **±202 px** | −88 |
| Verkoper · Leads (kolomtabs) | ±330 px | **±210 px** | −120 |
| Iedereen · Route | ±252 px (technieker) / ±357 px (verkoper) | **bestaat niet op de gsm** | — |

De kop zelf (kop en tabs) blijft voor elke rol even hoog: 93 px op de computer, 97 px op de gsm. Alle winst komt van
de balken eronder.

---

## 3. Mockups

`docs/voorstellen/kop-b-mockups.html` (alles inline, zelfde stijl als `sales-kop-voorstellen.html`):

1. **Gsm, naast elkaar**: het dagoverzicht van de technieker (Kalender) en dat van de verkoper (Kalender), met de
   tabs zonder Route, de nu-lijn, Bellen/Navigeer (en Resultaat bij de verkoper). Daarnaast de technieker met het
   persoonsmenu open.
2. **Planner, computer**: Kalender en Route (één werkbalk).
3. **Verkoper, computer**: Route en Leads (⚙ in de kop, geen kiezer).
4. **Beheerder, computer**: het open persoonsmenu met de rol achter elke naam, en het scherm na het kiezen van een
   verkoper (tabs gewisseld, "👥 Sales: An").

Elke tekening heeft een roze lijn waar de inhoud begint.

---

## 4. Bouwplan (tak `refactor`, worktree `.claude/worktrees/planner-brein`)

Er zijn twee sporen die los van elkaar kunnen lopen: **Kop** (taak 1 → 2 → 3) en **Schermen** (taak 4 → 5). Beide
sporen raken `public/css/app.css`, maar in andere blokken. Na elk spoor volgen `git merge` en de volledige test.

### Taak 1: Persoonskiezer per rol (logica en menu)
- **Nieuw:** `public/js/schermen/persoonskiezer-logica.js` (pure functie `kiezerLijst({ rol, rechten, ticketNamen,
  eigen, gebruikers, verkopers, werkruimte })` → `{ knop, groepen[] }`) en `public/js/schermen/persoonskiezer.js`
  (menu tekenen met `textContent`, groepen, rol-labels, toetsenbord, max-hoogte, "↩ Terug naar techniekers").
- **Wijzigt:** `public/js/app.js` (`buildPersonSelector`, `updatePersonHeader` en `selectPerson` gaan via de module;
  `personenUitTickets` blijft de bron), `public/css/app.css` (menugroepen, rol-label, gsm), `public/index.html`
  (geen nieuwe elementen, alleen `aria`).
- **Tests:** nieuw `tests/persoonskiezer-logica.test.mjs` (elke rol; "Alle" per rol; "(jij)"; geen e-mailveld in de
  uitvoer; koppeling Zoho-naam → rol; "geen login"). Bijwerken: `e2e/persoon-menu.spec.mjs`, `e2e/rollen.spec.mjs`.
- **Bouwtijd:** 30–40 min (3+ onderdelen).

### Taak 2: Werkruimte-wissel voor de beheerder (tab "Sales" weg)
- **Wijzigt:** `public/js/schermen/sales-registratie.js` (sales-tabs voor `beheerder-sales` in plaats van de tab
  "Sales"), `public/js/schermen/rol-schil.js` (`pasRolToe` toont de tabs van de werkruimte), `public/js/app.js`
  (`setTab`, de tab-omzetting bij de wissel, `planHerstelSchermStaat` met werkruimte), `public/js/kern/eigenaar.js`
  (`blitz_werkruimte` wissen), `public/js/schermen/sales-schil.js` en `sales-verkoper.js` (verkoperbalk weg; de keuze
  komt uit de kop; "Alleen lezen" gaat naar de knop), `public/js/schermen/persoonskiezer.js` (sales-groep en
  `blitz_werkruimte`).
- **Verwijdert:** `public/js/schermen/sales-beheer.js` en de bijhorende CSS (`.sales-beheer`, `.sales-titel`,
  `.sales-subtabs`) in `public/css/sales.css`.
- **Tests:** bijwerken `tests/sales-registratie.test.mjs`, `e2e/sales-rollen.spec.mjs`, `e2e/sales-schil.spec.mjs`,
  `e2e/beheer-tabs.spec.mjs`, `e2e/laden-en-rol.spec.mjs`. Nieuw e2e-geval: "beheerder kiest een verkoper → tabs
  Leads/Kalender/Route/Afgewerkt/Beheer, op Route blijft Route; ↩ terug; herladen houdt de werkruimte".
- **Bouwtijd:** 35–45 min. Dit raakt de opstart, de tabs en de opslag: het grootste risico.

### Taak 3: ⚙ en ↺ in de kop voor sales
- **Wijzigt:** `public/js/schermen/sales-start.js` (↺, ⚙ en voor de sales manager de kiezer tonen; de gewone
  verkoper krijgt geen kiezer), `public/js/schermen/sales-instellingen.js` en `sales-data.js` (eigen instellingen in
  een eigen kopie, zodat ⚙ ook werkt bij de leads van een collega), `public/js/schermen/sales-verkoper.js`
  (`maakInstellingenKnop` weg).
- **Tests:** bijwerken `e2e/sales-instellingen.spec.mjs` (⚙ in de kop; een sales manager die een collega bekijkt,
  bewaart in zijn eigen record, en de getoonde leads veranderen niet) en `e2e/schil-flits.spec.mjs`.
- **Bouwtijd:** 15–22 min (1–3 kleine onderdelen).

### Taak 4: Route alleen op tablet en computer, met één werkbalk
- **Wijzigt:** `public/index.html` (`.route-balk` met de 📅-knop, `#plan-date` onzichtbaar erover, `#week-strip` en
  de knoppen; de id's blijven; `tab-planning` krijgt `.alleen-groot`), `public/js/schermen/route.js` (📅 →
  `showPicker`), `public/js/schermen/sales-route.js` (dezelfde opbouw), `public/js/schermen/sales-registratie.js`
  (`sales-route` krijgt `.alleen-groot`), `public/js/schermen/week-strook.js` (compacte dagknop: naam en status
  links, aantal rechts), `public/js/app.js` en `sales-start.js` (actieve Route-tab op de gsm → Kalender, ook bij
  `apparaatwijziging` en bij het herstellen van de schermstaat), `public/js/schermen/kalender.js` ("Route bekijken"
  krijgt `.alleen-groot`), `public/css/app.css` (`.route-balk`, `.alleen-groot`, smalle vensters).
- **Tests:** bijwerken `e2e/route-weekstrook.spec.mjs`, `e2e/route-indeling.spec.mjs` (de gsm-gevallen worden "geen
  Route-tab"), `e2e/sales-route-knoppen.spec.mjs` en `e2e/sales-route.spec.mjs`. Nieuwe e2e-gevallen: "📅 zet de
  datum"; "gsm 375 px: geen Route-tab voor planner, technieker met vinkje en verkoper; draaien van tablet naar gsm op
  Route → Kalender"; "tablet 800 px: Route er wel". `tests/week-strook-logica.test.mjs` blijft.
- **Bouwtijd:** 35–45 min.

### Taak 5: Kalender- en lijstbalken in dezelfde vorm, en het dagoverzicht voor sales
- **Nieuw:** `public/js/schermen/dag-lijst.js` (nu-lijn en werkuren-badge, gedeeld door `kalender.js` en
  `sales-kalender.js`; de techniekerkalender gebruikt het zonder zichtbare wijziging).
- **Wijzigt:** `public/js/schermen/sales-kalender.js` (kop als `.kal-header`, buiten de inhoudsmarge; gsm-kaartje
  met 📋 Resultaat, nu-lijn, afgewerkt kaartje, werkuren-badge), `public/js/schermen/sales-kalender-logica.js`
  (afgewerkte bezoeken met datum meenemen als `soort: 'afgewerkt'`), `public/js/schermen/sales-lijst.js` (+ Lead,
  Export, zoeken en gebied op één `.lijst-balk`), `public/index.html` en `public/js/schermen/wachtrij.js`
  (`.wq-toolbar` → `.lijst-balk`, teller inline; gsm-label "⚡ Plan" via `<span>`), `public/css/app.css`,
  `public/css/sales.css`.
- **Tests:** nieuw `tests/sales-kalender-logica.test.mjs`-gevallen (afgewerkt in de dag; zonder datum niet). Bijwerken:
  `e2e/sales-kalender.spec.mjs` (gsm: kaartje met Bellen/Navigeer/Resultaat, nu-lijn, afgewerkt grijs),
  `e2e/sales-lijst-kolommen.spec.mjs`, `e2e/wachtrij.spec.mjs` en `e2e/kalender-indelingen.spec.mjs` (gsm met
  vinkje: kalenderkop op één regel; de nu-lijn van de technieker ongewijzigd).
- **Bouwtijd:** 35–45 min (3+ onderdelen).

### Afronding
- Volledige e2e (`npx playwright test`) en unit-tests (`node --test tests/`), plus schermafbeeldingen op 1280 × 800,
  800 × 1280 (tablet) en 375 × 812, per rol: **±20 min**.
- Ledger bijwerken (`.superpowers/sdd/2026-10-01-planner-brein/progress.md`) en CHANGELOG onder "Refactor-tak — nog
  niet uitgebracht". Geen versieophoging en geen `CACHE_NAME`-wijziging (refactor-regel).

**Totaal:** 150–197 min bouwen en 20 min test = **±2 u 50 tot 3 u 40**.

### Risico's

| Risico | Waar | Wat we doen |
|---|---|---|
| Twee werkruimtes op één pagina (ticket-opstart en sales-schermen tegelijk) | taak 2 | De sales-id's blijven `sales-*`; de e2e-tests doen elke tabwissel in beide richtingen en herladen daarna. |
| Een bewaarde tab of keuze past niet meer na de wissel (oude `blitz_sales_subtab`, oude tab "sales", Route op de gsm) | taken 2 en 4 | Omzettingstabel; een onbekende waarde wordt de eerste tab van de werkruimte; `blitz_sales_subtab` wordt genegeerd en opgeruimd. |
| Een planner of technieker met vinkje mist Route op de gsm | taak 4 | Dat is bewust (Brents regel). Plannen kan op de gsm nog altijd met "⚡ Plan" in de Kalender en via de Wachtrij; optimaliseren gebeurt op een tablet of computer. Komt in de CHANGELOG. |
| Een tablet die als gsm herkend wordt (of andersom) | taak 4 | De indeling komt uit `apparaat.js` (kortste schermzijde < 600 px = gsm) en kan per toestel overschreven worden (Instellingen → weergave). De e2e-test controleert beide kanten. |
| `showPicker()` ontbreekt op oudere toestellen | taak 4 | Het onzichtbare `<input type="date">` ligt over de 📅-knop; een tik opent dan de gewone kiezer. |
| Afgewerkte bezoeken hebben na het resultaat geen datum meer | taak 5 | Eerst nakijken in `sales-resultaat.js`. Ontbreekt de datum, dan wordt het afgewerkte kaartje overgeslagen (niets breekt) en melden we het in de ledger. |
| Bestaande e2e-tests zoeken de verkoperbalk, de subtabs of het datumveld | taken 2–5 | Per taak de betrokken specs mee aanpassen (lijst hierboven). |
| De kop op de gsm wordt voller voor de sales manager (kiezer, ↺ en ⚙ erbij) | taak 3 | Dezelfde regels als bij de technieker: de logo-tekst gaat weg, de knop is max. 108 px. Nagekeken op 360 px. |
| Een sales manager bewaart per ongeluk in het record van een collega | taak 3 | ⚙ bewaart altijd zonder `gebruiker` (= het eigen record; de server dwingt dat af). Er is een e2e-test op. |

---

## 5. Open beslissingen voor Brent

1. **Staan beheerders en planners met een Zoho-naam in de lijst van een technieker en een planner?**
   Vandaag wel: wie tickets op zijn naam heeft (bijvoorbeeld jij, als je zelf interventies doet), staat erin. "Alleen
   techniekers" letterlijk nemen betekent dat een planner jouw week niet meer apart kan bekijken. Voor de technieker
   is dan ook een nieuwe, beperkte namenlijst van de server nodig (+20–30 min).
   **Aanbeveling:** laten staan. "Technieker" betekent in de kiezer "wie interventies uitvoert"; verkopers staan er
   hoe dan ook nooit in. De beheerder ziet de echte rol achter elke naam.

2. **Krijgt de verkoper op de gsm een knop "📋 Resultaat" rechtstreeks op het kaartje?**
   De technieker heeft dat niet: hij tikt op het kaartje, opent het ticket en start daar het rapport (een wizard met
   meerdere stappen). Het resultaat van een verkoper is één kort formulier. Met de knop op het kaartje is hij één tik
   sneller; zonder de knop werkt het exact zoals bij de technieker (tik op het kaartje → venster → Resultaat).
   **Aanbeveling:** wel de knop op het kaartje, alleen bij bezoeken van vandaag of eerder. Het is de handeling die
   een verkoper na elk bezoek doet, en Bellen en Navigeer staan er al naast.

3. **Datum op Route (tablet en computer) via 📅 in plaats van een zichtbaar datumveld, ook voor de techniekers?**
   Dit was het belangrijkste nadeel van B. De weekstrook toont de gekozen dag al (groen omrand), ‹ › springt een
   week verder, en 📅 is alleen nodig voor een datum ver weg.
   **Aanbeveling:** ja, voor iedereen gelijk. Anders zien de Route van de technieker en die van sales er niet meer
   hetzelfde uit.
