# Onderzoek: datum en uur meteen bij "+ Lead" (2026-10-29)

Status: enkel onderzoek, niets gebouwd. Live is v2.5.1 op `main`.

## Samenvatting voor Brent

Nu maak je met "+ Lead" een lead aan met naam, gsm of e-mail, postcode en eventueel adres en notitie. Die lead staat daarna in de lijst als "te plannen". Een dag en uur geef je pas later: open de lead en gebruik het blok "Vast uur afspreken" in de fiche, of laat "Plan deze week" een voorstel doen.

Het blok "Vast uur afspreken" bestaat dus al, met een datumveld, een uurveld en een waarschuwing bij botsingen. Het enige dat ontbreekt is die stap in het "+ Lead"-venster zelf.

Voorstel: voeg onderaan het "+ Lead"-venster twee **optionele** velden toe, Datum en Uur. Laat je ze leeg, dan verandert er niets. Vul je ze in, dan wordt de lead meteen als vaste afspraak ingepland. De planning verschuift die afspraak daarna nooit meer, en hij verschijnt direct in agenda en route.

Botst de afspraak met een andere afspraak of een blokkering, dan krijg je dezelfde waarschuwing als in de fiche, met "Toch vastleggen". Reistijd tussen afspraken wordt bij een vast uur niet gecontroleerd, ook niet in de fiche. De planning plant erom heen. Dat blijft zo, zodat het gedrag overal hetzelfde is.

Als de klant al in je lijst staat (zelfde gsm of e-mail), zetten we geen uur over een bestaande lead heen. Je krijgt dan de melding dat de klant al bestaat en de fiche opent, zoals nu.

Type: MINOR (nieuwe functionaliteit). Omdat dit een nieuwe functie is, komt het volgens het branchbeleid op `refactor` of op `main`, afhankelijk van wat nu geldt (zie de open vragen). Geschat werk: klein tot middelgroot (ongeveer 1 dag met tests).

## Technisch

### 1. Huidige flow van "+ Lead"

- Knop: `public/js/schermen/sales-lijst.js:94` (`data-actie: 'sales-lead-toevoegen'`, tekst "+ Lead"). Zichtbaar als `kanLeadToevoegen()` waar is (`sales-verkoper.js:64`): de verkoper bij zijn eigen leads, de beheerder bij een niet-geblokkeerde gekozen verkoper.
- Venster: `public/js/schermen/sales-lead-toevoegen.js` (`openLeadToevoegen`). Velden: voornaam, naam, gsm, e-mail, postcode*, gemeente, straat, huisnr, notitie (`:22-31`). Het formulier staat op `:38-46`, het opslaan op `:63-86`.
- Validatie (pure logica, ook server): `public/js/sales/manueel.js` `valideerManueleLead` (`:30`), `bouwManueelExport` (`:48`), `controleerManueleExport` (`:57`), `zoekBestaandeLead` (`:69`).
- Opslaan: `importeer(bouwManueelExport(lead))` (`sales-data.js:240`) doet een POST naar `/api/sales-import` en herlaadt daarna met `laadSales`. De export heeft `bron: 'manueel'` en precies één lead. Het veld `leads[0]` bevat nu enkel de negen formuliervelden.
- Server: `netlify/functions/sales-import.js` roept `netlify/lib/sales-import-server.js` `importeerExport` aan (`:48-58` controle, `:62-72` samenvoegen onder slot via `muteerSales`). Dat gebruikt `voegSamen` en `nieuweLead` uit `public/js/sales/herkenning.js` (`:51`, `:102`). Een nieuwe lead krijgt `status: 'te-plannen'`, `bezoeken: []` en `bronExport.bron: 'manueel'`. Daarna volgt `bewaarLocaties` (geocoding binnen een tijdsbudget); de client vult de rest aan via `vulLocatiesAan`.
- Een bestaande klant (zelfde gsm of e-mail) wordt niet dubbel aangemaakt (`alAanwezig`). De client toont dan een toast en opent de fiche (`sales-lead-toevoegen.js:78-82`).

### Hoe een lead vandaag dag en uur krijgt

1. **Vast uur in de fiche**: `sales-detail.js:123-160`. De velden zijn `veld('Datum', { soort: 'date', min: vandaag })` en `veld('Uur', { soort: 'time' })`. Het gaat via `valideerVastUur` (`sales-detail-logica.js:49`), daarna `vindBotsingen` (`:64`), `appConfirm` "Botsing met een andere afspraak" met "Toch vastleggen", en dan `zetVastUur` (`sales/lead-regels.js`) binnen `wijzig(...)`. Dat zet `status: 'bevestigd'` en `planning: { datum, start, vast: true }`. Het mag voor elke lead die niet afgewerkt is.
2. **"Plan deze week"**: `sales-plan.js:62`. Het planner-brein (`planner.js` via `sales/planner-adapter.js`) stelt een voorstel voor (`voorgesteld`), dat de verkoper bevestigt. Een vaste lead (`isVast`) is nooit kandidaat: het brein plant eromheen en verschuift hem niet.
3. Slepen op de agenda en optimaliseren op de route-tab (`sales-kalender.js`, `sales-route*.js`) werken op leads die al een planning hebben.

### 2. Datum en uur elders in de app, en wat er bij aanmaak moet gebeuren

- Conventie: `veld(label, { soort: 'date' | 'time', ... })` uit `schermen/sales-dom.js`: gewone native `<input type="date/time">`, geen eigen picker. Datumhulp en "vandaag": `localISO` en `fmtDateShort` uit `kern/tijd.js`. Voorbeelden: `sales-detail.js:127-128` en `sales-route.js:88`. Hergebruik dit; er is geen aparte picker nodig.
- Domeinregels: `isGeldigeDatum` en `isGeldigUur` in `sales/lead-regels.js`. De serverkant valideert `planning` al in `valideerLead` bij `wijzig` (toegelaten velden: `WIJZIGBARE_VELDEN`, `PLANNING_SLEUTELS = datum, start, vast`).
- Botsingen: `vindBotsingen` kijkt enkel naar vaste leads en blokken op dezelfde dag, met de bezoekduur (standaard `instellingen.bezoekDuurMin`). Een voorgesteld bezoek telt niet mee. Dat is bewust en moet zo blijven.
- Reistijd: een vast uur controleert geen reistijd, noch in de fiche, noch in de planner: de adapter zet het als bestaand bezoek met uur en plant eromheen (`sales-plan.js:4-5`). Reistijd valideren bij aanmaak zou dus een nieuw gedrag zijn dat nergens anders bestaat. Niet doen. Dat voorkomt inconsistentie en netwerkafhankelijkheid in het venster. Het adres is bij aanmaak bovendien vaak nog niet gegeocodeerd (locatie komt pas na de import).
- Kalender: `sales-kalender.js` en de route-tab lezen `planning.datum/start` van leads; een vast uur verschijnt dus zonder extra werk. Controleer dit in een test.
- Optioneel of verplicht: **optioneel**. Een lead zonder afspraak is de normale situatie (telefoon, beurs, doorverwijzing). Beide velden samen of geen van beide: een datum zonder uur (of omgekeerd) geeft een veldfout, zoals `valideerVastUur` ("Kies een datum vanaf vandaag" / "Geef het uur als UU:MM").

### 3. Opties

**Optie A, aanbevolen: optionele Datum + Uur in het "+ Lead"-venster; twee stappen op de client.**
Na een geslaagde import: de nieuwe lead opzoeken met `zoekBestaandeLead(salesToestand().leads, r.lead)` (de `id` is client-zijde pas na het herladen bekend) en daarna `wijzig(...)` met `zetVastUur`, net als `sales-detail.js:149-155`. Bij een bestaande klant (`alAanwezig > 0`, `nieuw === 0`) wordt de planning NIET gezet: toast "Deze klant staat al in je lijst; leg het uur vast in de fiche" en de fiche openen (dat doet de code nu al).
- Te raken bestanden: `public/js/schermen/sales-lead-toevoegen.js` (velden, validatie, botsingen, `appConfirm`, tweede stap); `public/js/sales/manueel.js` of `schermen/sales-detail-logica.js` (hergebruik van `valideerVastUur`; het uur NIET in `bouwManueelExport` stoppen); `public/sw.js` `CACHE_NAME` is alleen bij release nodig, geen nieuw bestand. `netlify/` blijft ongewijzigd.
- Tests: uitbreiden van `tests/sales-manueel.test.mjs` (datum/uur beide-of-geen-regel, als die in `manueel.js` komt), `tests/sales-detail-logica.test.mjs` voor een eventueel verplaatste botsing/validatie, en `e2e/sales-lead-toevoegen.spec.mjs`: lead met datum+uur wordt bevestigd en staat in de agenda; leeg blijft "te plannen"; botsing toont de bevestiging; bestaande klant zet niets; fout bij de tweede stap geeft een duidelijke melding. Draai gericht (`--project=chromium`, die ene spec).
- Risico's: (1) **niet atomair**: slaagt de import maar faalt `wijzig` (netwerk, 409 na versiewissel), dan bestaat de lead zonder uur. De toast moet dan zeggen "Lead toegevoegd, maar het uur kon niet vastgelegd worden: doe het in de fiche" en het venster mag niet blijven staan met "opnieuw proberen" (zou een duplicaat-melding geven). (2) `zoekBestaandeLead` vindt de lead op gsm of e-mail: bij een mogelijke oude lead met dezelfde sleutel is `alAanwezig` leidend, dus alleen bij `nieuw > 0` plannen. (3) De beheerder die voor een verkoper aanmaakt: `wijzig` loopt via dezelfde `doel` als `importeer`; testen.

**Optie B: server-kant, één atomaire schrijfactie.**
`planning` meegeven in de manuele export (`manueel.js`, `controleerManueleExport`), en in `herkenning.js` `nieuweLead` er `status: 'bevestigd'` en `planning` van maken, plus validatie met `isGeldigeDatum/isGeldigUur` op de server. Voordeel: geen halve toestand. Nadelen: raakt de importpijplijn en de karakteriseringstests van de server (`tests/` rond sales-import en herkenning), breidt het exportformaat uit, en laat een bestaande klant (`werkBij`) een ongewenste planning-vraag stellen. Meer risico voor weinig winst, omdat de gevolgen van het halve geval klein zijn (de verkoper ziet de melding en zet het uur in de fiche).

**Aanbeveling: optie A.** Alle regels (botsingen, validatie, `zetVastUur`) bestaan al en worden hergebruikt; de server blijft ongewijzigd.

Een kleine alternatieve UX binnen A: een knop "Opslaan en inplannen" naast "Opslaan", die de velden pas toont na een klik. Niet nodig: twee optionele velden zijn eenvoudiger en sneller op gsm.

### 4. Versionering

MINOR (nieuwe, backward-compatible functionaliteit; uitbreiding van een bestaand scherm), volgens `CLAUDE.md`. Release-stappen (versie in `package.json`, `CHANGELOG.md`, tag, `CACHE_NAME` in `public/sw.js`) volgen bij het afronden van de branch, niet per taak. Dit is geen bugfix; het hoort volgens het branchbeleid dus niet zomaar op een bugfix-patch. De "refactor-tak"-regel in `CLAUDE.md` is volgens het geheugen afgelopen (v2.0.0 live), dus het huidige beleid moet Brent bevestigen.

## Open vragen voor Brent

1. **Wat gebeurt er als de klant al in je lijst staat en je een datum en uur invult?**
   Opties: (a) niets plannen, melding en de fiche openen (nu ook het gedrag); (b) het uur toch op de bestaande lead zetten.
   Aanbeveling: (a). Zo overschrijf je nooit stilzwijgend een bestaande afspraak.

2. **Afspraak botst met iets: waarschuwen of blokkeren?**
   Aanbeveling: waarschuwen met "Toch vastleggen", net als in de fiche.

3. **Mag de lead meteen "bevestigd" zijn, dus vast?**
   Aanbeveling: ja, want een uur dat je zelf invult is een afspraak met de klant. De planning verschuift het dan niet meer. Alternatief: "voorgesteld" (de planning mag het verschuiven). Dat past niet bij "meteen ingepland".

4. **Op welke tak bouwen we dit?** Het branchbeleid in `CLAUDE.md` is verouderd (de refactor is al live sinds v2.0.0). Aanbeveling: vraag het bij de start van de bouw; als MINOR gaat het in de eerstvolgende release, niet in een bugfix-patch.

## Samenvatting in 3 regels

1. "+ Lead" slaat nu enkel de gegevens op (via `/api/sales-import`); een uur geef je later in de fiche ("Vast uur afspreken") of via "Plan deze week".
2. Aanbeveling: twee optionele velden Datum + Uur in het "+ Lead"-venster, na het opslaan hergebruik van `zetVastUur` en de bestaande botsingscontrole; geen serverwijziging, geen reistijdcontrole.
3. MINOR; vier kleine keuzes voor Brent hierboven (bestaande klant, botsing, vast of voorgesteld, tak).
