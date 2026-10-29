# Vergelijking Blitz Planning 2.5.1: nu en geoptimaliseerd

*Opgesteld in de nacht van 28 op 29 oktober 2026. Dit is de tekst. De plekken met [[CIJFER]] en [[TEST]] worden ingevuld nadat de eindmeting en de eindtests klaar zijn. Er staat niets live: de verbeteringen staan klaar op een aparte werkversie en gaan pas mee bij een release die jij goedkeurt.*

## In het kort

- **Wat er vannacht gedaan is**: vier verbeteringen gebouwd en door een onafhankelijke nakijker gecontroleerd (sneller opstarten, lijstkaarten op de gsm lichter, kalender en ingepland minder onnodig opnieuw tekenen, het rapportenarchief robuuster laden). Daarnaast zijn twee bestaande foutjes gevonden en hersteld.
- **Wat het oplevert**: de app start op een trage verbinding ongeveer [[CIJFER]] sneller, en het terugkeren naar een tabblad op een telefoon is ongeveer [[CIJFER]] sneller. Het scrollen op een gsm is overdag ongeveer [[CIJFER]] vloeiender (let op: dat laatste is gemeten zonder echte grafische kaart en dus nog niet bevestigd op een echte telefoon).
- **Wat er niet slechter werd**: de automatische testen slagen ([[TEST]]) en geen enkele meting is meer dan 10 procent slechter geworden ([[CIJFER]]).
- **Jij beslist over twee zichtbare wijzigingen**: (1) de vervaging achter de lijstkaarten op de gsm valt overdag weg; (2) bij een laadfout in het rapportenarchief blijft de lijst staan met een melding, in plaats van een foutregel. Beide zijn los terug te draaien.
- **Jij beslist later over drie grotere vragen** die ik bewust niet vannacht heb aangepakt: de regel van 4 seconden bij het opstarten, nog meer glas weglaten, en wat er moet gebeuren als een ticket tussendoor verdwijnt.
- **Niet gebouwd**: vier andere verbeteringen zijn niet gedaan. Eén omdat de onafhankelijke nakijker het te riskant vond (kans op dubbele aanvragen bij Zoho), drie door tijdgebrek. Die komen in een volgende ronde.
- **Eerlijk over de winst**: de eerste verbetering levert minder op dan het plan hoopte. Op een echte verbinding kan de winst anders uitvallen dan op onze testopstelling.
- **Niets is live.** Na een release moet je zelf een paar dingen op een echte telefoon nakijken (zie "Wat je na een release zelf moet nakijken").

## Hoe gemeten

- **Machine**: een Windows 11-laptop met een Intel Core i5-1135G7 (8 verwerkingsdraden) en 40 GB geheugen. De app draait in een onzichtbare browser, dus zonder echt scherm en zonder grafische kaart. Tijdens de metingen liep er geen andere test op dezelfde machine.
- **Verzonnen gegevens**: er is geen echte klantendata, geen Zoho, geen kaartdienst en geen mail bij betrokken. Elk verzoek naar de server wordt door een eigen minimale nepserver beantwoord en alles buiten de eigen computer is afgesloten (op de twee bibliotheek-hosts na waar de app zijn kaart en handtekeningmodule vandaan haalt). Voor de meting van het opstarten draait de app zoals in het echt, want de eerste verbetering werkt enkel zo. De overige metingen draaien in een testmodus.
- **Rol**: de standaardrol van de planner, ingelogd als beheerder, zodat alle tabbladen bereikbaar zijn.
- **Gegevens**: 30 tickets in de wachtrij en 28 geplande tickets verspreid over de werkweek, zoals een drukke dag. De klok staat vast op maandag 5 oktober 2026, 09:00, zodat elke meting dezelfde week toont.
- **Telefoon**: schermgrootte 375 x 812 met aanraking en de processor kunstmatig 4 keer trager gemaakt (een middenklasse-gsm). **Computer**: schermgrootte 1440 x 900, processor op volle snelheid.
- **Aantal metingen en mediaan**: elke meting is 5 keer herhaald. In de tabellen staat de **mediaan** (de middelste waarde, zodat een uitschieter niet doorweegt) met tussen haakjes de laagste en hoogste waarde (de "spreiding").
- **Oud en nieuw om en om**: de eindvergelijking meet de oude versie (2.5.1, de live versie) en de nieuwe versie afwisselend (oud, nieuw, nieuw, oud, ...) in dezelfde sessie. Een drukke of rustige minuut van de computer raakt dan beide versies even hard. Daardoor komt de kolom "2.5.1 (nu)" in de tabellen uit deze eindmeting.
- **Waarom niet de eerste meting van 00:30**: er bestaat een eerdere meting van de live versie (de "nulmeting" van vannacht, rond half één). Die is gedaan met een oudere versie van het meetgereedschap. Dat gereedschap is daarna op twee punten verbeterd: het geeft de nepserver nu een geldig antwoord op de instellingen, en het wacht bij het wisselen van tabblad niet meer op een teken dat in de nieuwe situatie bewust niet meer verschijnt. Daardoor liggen sommige tijden van het wisselen van tabblad ongeveer 33 ms hoger dan in de eerste meting. De eerste meting en de eindmeting zijn dus niet een-op-een vergelijkbaar; vergelijk alleen cijfers binnen de eindmeting.
- **Opstarten** wordt gemeten met een server die 0 ms of 150 ms wacht per bestand (150 ms bootst een trage verbinding na).
- **De handelingen**: een vast scenario van 29 handelingen op de computer en 26 op de telefoon (op de telefoon bestaat het tabblad Route niet): alle tabbladen drie keer rond, 6 keer van week wisselen, 4 keer een ticket openen en weer sluiten. Een handeling is klaar als het scherm getekend is.
- **Stabiliteit**: een selectie van 8 testbestanden van de automatische testen (opstart, kalender, wachtrij, ticketdetail, verbinding en offline), twee keer na elkaar uitgevoerd, zonder opnieuw proberen.
- **Kleine schommelingen**: schermen worden 60 keer per seconde getekend, dus tijden onder ongeveer 17 ms schommelen vanzelf. Kijk naar de mediaan en de spreiding, niet naar één run.
- De ruwe cijfers van elke run worden bewaard in de projectmap, zodat ze later nagekeken kunnen worden.

**Wat je moet weten bij het lezen van de cijfers:**

- **De testserver is trager per bestand dan de echte hosting.** Onze nepserver handelt een beperkt aantal bestanden tegelijk af, de echte hosting kan er veel meer tegelijk. Daardoor overdrijven de opstartcijfers bij 150 ms vertraging het deel dat door het netwerk komt. Op de echte hosting zal het verschil kleiner of anders zijn.
- **De testbrowser heeft geen grafische kaart.** Een echte telefoon tekent veel via zijn grafische chip. De cijfers voor soepel scrollen (beelden per seconde) zijn daarom een aanwijzing, geen telefoonwaarde.
- **Elke verbetering is maar op één plek zichtbaar.** Verbetering 1 (opstarten) zie je enkel in de opstartmeting. Verbetering 2 (kaarten zonder vervaging) zie je enkel in de scrollmeting en enkel overdag, want 's nachts geldt de regel bewust niet. Verbetering 3 (tabbladen niet onnodig hertekenen) zie je enkel in de meting van het wisselen tussen tabbladen. In de andere metingen mag er dus niets veranderen; veranderen er toch cijfers, dan is dat ruis.

## Wat er veranderd is

De nummers volgen het plan van vannacht. De nummers 4, 5, 7 en 8 ontbreken hier omdat die niet gebouwd zijn (zie "Niet gedaan en waarom").

**1. Sneller opstarten: aanmelding en instellingen worden vroeger opgevraagd.** Bij het opstarten vroeg de app twee dingen pas op nadat al zijn onderdelen binnen waren: wie je bent (aanmelding) en jouw instellingen. Nu worden die twee meteen gevraagd, terwijl de onderdelen nog binnenkomen. De app wacht dus minder op zichzelf. Je ziet geen verschil in het scherm, enkel dat de app op een trage verbinding iets eerder klaar is. In de test was dat ongeveer 174 ms sneller bij een eerste bezoek en 252 ms bij een tweede bezoek (bij 150 ms vertraging); het plan hoopte op ongeveer 200 tot 350 ms. Met de achtergrondservice van de app was het verschil binnen de ruis. Risico: dit raakt het inlogpad en het opstarten zonder internet. Daarom is het door een onafhankelijke nakijker gecontroleerd en met extra tests afgedekt, ook voor een verlopen sessie, een scherm voor wachtwoordwijziging en een start zonder verbinding. Kan los teruggedraaid worden.

**2. Lijstkaarten op de gsm zonder vervaging (overdag).** De kaarten van tickets en afspraken hebben een glaseffect met een lichte vervaging van wat erachter ligt. Op de gsm, overdag, ligt daar alleen een zachte kleurverloop-hemel. Die vervaging is dus niets wat je ziet, maar ze kost de telefoon wel rekenwerk bij het scrollen. Nu is ze daar weggelaten. 's Nachts (met sterren), tijdens een themaweek, op de computer en op een liggende tablet verandert er niets. Wat je merkt: het beeld is hetzelfde (een pixelvergelijking met de oude weergave toonde hooguit 3 op 255 verschil, dat is onzichtbaar), en het scrollen kan vlotter gaan. Risico: het raakt een afspraak die jij zelf maakte over het glaslook. Daarom beslis jij hierover (zie het volgende deel). Kan los teruggedraaid worden, met één handeling, zonder de rest te raken.

**3. Kalender en Ingepland niet onnodig opnieuw tekenen.** Telkens je naar het tabblad Kalender of Ingepland ging, bouwde de app dat scherm helemaal opnieuw op, ook als er niets veranderd was. Op een telefoon kostte dat ongeveer een halve seconde per bezoek. Nu wordt het scherm enkel opnieuw getekend als er echt iets veranderd is: nieuwe gegevens, een andere dag, een andere schermindeling of een andere filter. Wat je merkt: terugkeren naar die tabbladen voelt sneller. Risico: een scherm dat verouderd blijft omdat een wijziging niet als wijziging geteld wordt. Daarom telt nu elke soort wijziging mee, en de dag van vandaag en de schermindeling zitten in de controle. De onafhankelijke nakijker vond twee gaten (het aanpassen van de route-volgorde en een klein onderdeel dat de status van een voorstel toont); die zijn daarna dichtgemaakt, met 22 nieuwe tests. Kan los teruggedraaid worden. Een tweede, grotere stap (Ingepland helemaal niet tekenen zolang het verborgen is) is bewust niet gedaan.

**6. Rapportenarchief robuuster laden.** Als het laden van de rapportenlijst mislukte (storing, geen verbinding, of een leeg antwoord van de server tijdens een storing), kon de app de al getoonde lijst wissen en het gekende versienummer van de lijst kwijtraken. Nu blijft de bestaande lijst staan en verschijnt een melding. Is er nog niets geladen, dan zie je zoals vroeger een foutregel. Ook wordt de lijst en de kalender niet opnieuw getekend als het antwoord precies gelijk is aan het vorige. Wat je merkt: bij een storing blijft je lijst staan met een melding (zichtbaar, zie het volgende deel); verder voelt het tabblad Rapporten iets sneller. Risico: dit raakt het versienummer bij het verzenden van rapporten, daarom is het door een onafhankelijke nakijker gecontroleerd, die na een eerste ronde met aanpassingen goedkeurde. Kan los teruggedraaid worden.

### Twee bestaande fouten die onderweg zijn gevonden en hersteld

- **Instellingen van de ene gebruiker onder de andere bewaard.** Als bij het opstarten de aanmelding heel traag was (meer dan 5 seconden), op een toestel waar eerder iemand anders was ingelogd, konden de instellingen van gebruiker B onder de naam van gebruiker A bewaard worden. Dat kon al in de live versie. Dit is hersteld in een eigen aparte wijziging, die los terug te draaien is. De eindcontrole kijkt dit nog na.
- **Wijzigingen aan de beschikbaarheid van een klant werden niet altijd als "kalender is verouderd" gemeld.** In de live versie viel dat niet op, omdat de kalender bij elk bezoek toch opnieuw werd opgebouwd. Met de derde verbetering zou het wel zichtbaar geworden zijn. Het is hersteld voordat die verbetering mee ging.

## Zichtbare wijzigingen — jij beslist

Normaal verandert er niets aan wat je ziet. Twee dingen wel. Een "nee" van jou betekent gewoon: die ene wijziging wordt teruggedraaid, de rest blijft.

**A. Lijstkaarten op de gsm zonder vervaging (verbetering 2).**
- Wat verandert: overdag zijn de kaarten (Wachtrij, Kalender-lijst, Ingepland, Route-stops en Inventaris) op de gsm niet meer lichtjes wazig voor wat erachter ligt.
- Waarom het volgens de proef mag: een pixelvergelijking zegt dat het er hetzelfde uit ziet, en de leesbaarheid (contrast) van de tekst is op vier schermmaten gemeten en is niet veranderd.
- Waarom jij moet beslissen: de winst is gemeten op een testbrowser zonder grafische kaart. Op een echte telefoon is die winst onzeker en vermoedelijk kleiner. Het raakt ook het glaslook dat jij zelf hebt vastgelegd.
- Zo beoordeel je het op je eigen gsm (laat zo mogelijk ook iemand met een andere telefoon kijken):
  1. Open de Wachtrij overdag en kijk naar de kaarten. Zien ze er hetzelfde uit als in de huidige versie?
  2. Doe dat 's nachts nog eens: 's nachts moet de vervaging er nog gewoon zijn.
  3. Scroll op en neer door de Wachtrij, Kalender en Ingepland. Gaat het vlotter?
  4. Kijk zowel op een iPhone (Safari) als op een Android-toestel (Chrome), als je die hebt.
  5. Kijk ook op een tablet in rechtopstaande stand (die telt als gsm) en in een themaweek (daar moet alles ongewijzigd blijven).
- Beslissing: ziet het er hetzelfde uit en scrolt het vlotter, dan houden we het. Scrolt het niet merkbaar vlotter, dan draaien we het terug: dan is er niets te winnen en is er geen reden om aan het glaslook te raken.

**B. Rapportenarchief bij een laadfout (verbetering 6).**
- Wat verandert: als de rapportenlijst niet geladen kan worden terwijl er al een lijst staat, blijft die lijst staan en verschijnt een melding. Vroeger verving een foutregel de hele lijst.
- Waarom we het aanraden: een kort storinkje wist niet meer je overzicht, en het versienummer van de lijst blijft bewaard.
- Beslissing: akkoord met dit andere gedrag bij een fout? Een "nee" draait enkel dit onderdeel terug.

## Meetresultaten

Alle cijfers komen uit de eindmeting, waarin de oude (2.5.1) en nieuwe versie afwisselend zijn gemeten. Per cel: de mediaan van 5 runs, met tussen haakjes de laagste en hoogste waarde. De kolom "Verschil" is nieuw min oud (bij tijden is negatief beter), met een percentage.

### 5.1 Opstarten

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tijd tot bruikbaar, snelle server: eerste bezoek (niets onthouden) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tijd tot bruikbaar, snelle server: tweede bezoek (browser onthoudt bestanden) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tijd tot bruikbaar, snelle server: tweede bezoek met de achtergrondservice van de app (service worker) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tijd tot bruikbaar, server met 150 ms vertraging: eerste bezoek (niets onthouden) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tijd tot bruikbaar, server met 150 ms vertraging: tweede bezoek (browser onthoudt bestanden) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tijd tot bruikbaar, server met 150 ms vertraging: tweede bezoek met de achtergrondservice van de app (service worker) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Aantal verzoeken aan de server: eerste bezoek (niets onthouden) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Aantal verzoeken aan de server: tweede bezoek (browser onthoudt bestanden) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Aantal verzoeken aan de server: tweede bezoek met de achtergrondservice van de app (service worker) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Overgedragen gegevens: eerste bezoek (niets onthouden) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Overgedragen gegevens: tweede bezoek (browser onthoudt bestanden) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Overgedragen gegevens: tweede bezoek met de achtergrondservice van de app (service worker) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Inladen van het rapportscherm (84 kB) op een 4x tragere processor | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |

- **Tijd tot bruikbaar**: hoe lang het duurt vanaf het openen van de app tot de lijst met tickets er staat en de app reageert. Lager is beter.
- **Eerste bezoek / tweede bezoek**: het eerste bezoek haalt alles op; bij een tweede bezoek heeft de browser al bestanden bewaard (met of zonder de achtergrondservice van de app).
- **Aantal verzoeken**: hoeveel losse bestanden de app bij het opstarten opvraagt. Minder is beter, want elk bestand kost wachttijd op een trage verbinding. Verbetering 1 verandert dit aantal niet; ze verschuift enkel wanneer twee ervan gevraagd worden.
- **Overgedragen gegevens**: hoeveel kilobyte er echt over de lijn gaat. Minder is beter, vooral op mobiel internet.
- **Inladen van het rapportscherm**: de rekentijd die de telefoon nodig heeft om het rapportscherm klaar te maken; de grens is 150 ms.

### 5.2 Scrollen op de telefoon

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tijd tot het eerste ticket zichtbaar is (telefoon) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Soepel scrollen in Wachtrij: beelden in 3 seconden (hoger is beter, 180 = perfect) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Haperingen tijdens scrollen in Wachtrij: totale duur van lange taken | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Soepel scrollen in Kalender: beelden in 3 seconden (hoger is beter, 180 = perfect) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Haperingen tijdens scrollen in Kalender: totale duur van lange taken | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Soepel scrollen in Ingepland: beelden in 3 seconden (hoger is beter, 180 = perfect) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Haperingen tijdens scrollen in Ingepland: totale duur van lange taken | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |

- **Tijd tot het eerste ticket**: hoe lang een telefoon nodig heeft voordat het eerste ticket op het scherm staat. Lager is beter.
- **Beelden in 3 seconden**: hoeveel keer het scherm ververst wordt terwijl er drie seconden heen en weer wordt geveegd; 180 betekent perfect vloeiend (60 per seconde), lager betekent schokkerig. Hoger is beter. Dit is gemeten overdag; 's nachts geldt de nieuwe regel bewust niet.
- **Lange taken**: momenten waarop de app langer dan 50 ms vastzit. Bij een telefoon die via de grafische chip scrolt, blijft dit meestal nul; het cijfer verandert alleen als er echt iets stokt.

### 5.3 Computer: tabbladen, kalender, ticketdetail en geheugen (1440 x 900)

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tabblad Kalender openen, eerste bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Kalender openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Route openen, eerste bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Route openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Ingepland openen, eerste bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Ingepland openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Inventaris openen, eerste bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Inventaris openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Rapporten openen, eerste bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Rapporten openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Wachtrij openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Kalender: volgende week openen (lege week) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Kalender: terug naar de volle week | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Ticketdetail openen vanuit de Wachtrij | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Ticketdetail openen vanuit de Kalender | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Langste hapering (lange taak) tijdens de sessie | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Aantal haperingen (lange taken) tijdens de sessie | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Geheugen van de app na het laden | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Geheugen van de app na de sessie | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Foutmeldingen van de app in de console | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Waarschuwingen van de app in de console | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |

- **Tabblad openen**: de tijd tussen het klikken op een tabblad en het moment dat het scherm getekend is. Het eerste bezoek moet alles opbouwen, een herhaald bezoek profiteert van wat al klaarstaat (bij de Wachtrij is elk bezoek een terugkeer, want die staat bij het opstarten al open). Lager is beter.
- **Kalender: week wisselen**: de tijd tussen het klikken op de pijl voor volgende of vorige week en het getekende resultaat. "Volgende week" is een lege week, "terug" is de volle week met 28 tickets en toont dus de echte opbouwtijd.
- **Ticketdetail openen**: de tijd tussen het klikken op een ticketkaart en het getekende detailvenster.
- **Hapering (lange taak)**: een moment waarop de app langer dan 50 ms niets anders kan doen; tijdens zo'n moment reageert het scherm niet. De langste is de ergste ervaring in de sessie. Lager is beter.
- **Geheugen**: hoeveel geheugen de app zelf vasthoudt, nadat de browser opgeruimd heeft. Een sessie van 29 handelingen mag dit nauwelijks laten groeien.
- **Foutmeldingen en waarschuwingen**: meldingen die de app zelf in het technische logboek van de browser schrijft. Het doel is nul. (Meldingen over bewust afgesloten externe websites en de bekende testruis van de geblokkeerde achtergrondservice tellen niet mee.)

### 5.4 Telefoon: tabbladen, kalender, ticketdetail en geheugen (375 x 812, processor 4x trager)

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tabblad Kalender openen, eerste bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Kalender openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Ingepland openen, eerste bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Ingepland openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Inventaris openen, eerste bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Inventaris openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Rapporten openen, eerste bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Rapporten openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tabblad Wachtrij openen, herhaald bezoek | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Kalender: volgende week openen (lege week) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Kalender: terug naar de volle week | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Ticketdetail openen vanuit de Wachtrij | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Ticketdetail openen vanuit de Kalender | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Langste hapering (lange taak) tijdens de sessie | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Aantal haperingen (lange taken) tijdens de sessie | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Geheugen van de app na het laden | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Geheugen van de app na de sessie | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Foutmeldingen van de app in de console | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Waarschuwingen van de app in de console | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |

De uitleg bij de cijfers is dezelfde als bij 5.3. Eventuele waarschuwingen op de telefoon komen van een tijdelijke controlefunctie die enkel in de testmodus draait en niets verstuurt.

### 5.5 Stabiliteit (automatische testen)

De kolom "2.5.1 (nu)" is de meting van de live versie van vannacht; de kolom "Geoptimaliseerd" is dezelfde selectie testen op de nieuwe versie.

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Aantal verschillende tests | 127 | [[CIJFER]] | [[CIJFER]] |
| Uitvoeringen (elke test 2x) | 254 | [[CIJFER]] | [[CIJFER]] |
| Geslaagd | 254 | [[CIJFER]] | [[CIJFER]] |
| Mislukt | 0 | [[CIJFER]] | [[CIJFER]] |
| Flaky (slaagt pas bij een tweede poging) | 0 | [[CIJFER]] | [[CIJFER]] |
| Overgeslagen | 0 | [[CIJFER]] | [[CIJFER]] |
| Tests die de ene keer slaagden en de andere keer faalden | 0 | [[CIJFER]] | [[CIJFER]] |
| Duur van de run | 7 minuten | [[CIJFER]] | [[CIJFER]] |

- **Geslaagd / mislukt**: het aantal uitvoeringen van een test dat slaagde of faalde. Doel: geen enkele mislukking.
- **Flaky**: een test die faalt en bij een nieuwe poging slaagt. In deze meting wordt er niet opnieuw geprobeerd, dus dit blijft nul; het echte signaal staat in de volgende regel.
- **Een keer geslaagd, een keer gefaald**: een test die in de ene van de twee herhalingen slaagt en in de andere faalt: dat is onbetrouwbaarheid, en precies wat we willen terugdringen.

In de meting van de live versie slaagden alle tests in beide herhalingen.

### 5.6 Bijdrage van de kaarten zonder vervaging (apart gemeten)

Hier meten we enkel wat verbetering 2 bijdraagt, door een kopie van de nieuwe versie zonder die ene verbetering naast de volledige nieuwe versie te zetten. Telefoon, overdag, zelfde afwisselende meetmethode. Zo zie je of het wegvallen van de vervaging het scrollen echt vlotter maakt, los van de andere verbeteringen.

| Metriek (telefoon, overdag) | Nieuwe versie zonder verbetering 2 | Nieuwe versie met verbetering 2 | Verschil |
|---|---|---|---|
| Soepel scrollen in Wachtrij: beelden in 3 seconden (hoger is beter, 180 = perfect) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Soepel scrollen in Kalender: beelden in 3 seconden | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Soepel scrollen in Ingepland: beelden in 3 seconden | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |
| Tijd tot het eerste ticket zichtbaar is (telefoon) | [[CIJFER]] | [[CIJFER]] | [[CIJFER]] |

Ook dit blijft een aanwijzing: zonder grafische kaart in de testbrowser kan het verschil op een echte telefoon groter of kleiner zijn. Daarom jouw controle op een echte gsm (zie "Zichtbare wijzigingen").

## Testresultaten

Alle testen zijn op de samengevoegde nieuwe versie uitgevoerd, nadat elke verbetering al afzonderlijk was getest en nagekeken.

| Soort test | Resultaat |
|---|---|
| Snelle tests (de brede reeks controles van de logica van de app) | [[TEST]] |
| Volledige klik-tests (de app wordt in een echte browser bediend, alle schermen en rollen) | [[TEST]] |
| Tests van de achtergrondservice van de app (service worker), die het offline opstarten en updates regelt | [[TEST]] |
| Contrasttests (is alle tekst nog goed leesbaar, ook op de kaarten zonder vervaging) | [[TEST]] |

## Niet gedaan en waarom

**Vier verbeteringen uit het plan zijn niet gebouwd:**

- **Verbetering 4: tickets al vroeg opvragen en niet hertekenen bij een gelijk antwoord.** Afgekeurd door de onafhankelijke nakijker voor vannacht. Er is een kans op dubbele aanvragen bij Zoho (dezelfde lijst twee keer opgevraagd, met dubbele belasting en mogelijke fouten). Dat risico nemen we niet zomaar in een nacht. Komt terug in een volgende ronde, met een veiliger opzet.
- **Verbetering 5: de server haalt tickets bij Zoho parallel op.** Dit is een aanpassing aan de kant van de server en is enkel in de echte situatie meetbaar. Niet gedaan wegens tijd; volgende ronde. Een kleine kanttekening voor dan: de server wacht nu langer op Zoho (26 seconden) dan de app zelf geduld heeft (20 seconden), waardoor de server werk kan doen dat niemand meer leest. Dat is niet aangepast.
- **Verbetering 7: opgeslagen adressen (locaties) één keer in het geheugen inlezen.** Klein, en met de testgegevens niet meetbaar. Wegens tijd naar de volgende ronde.
- **Verbetering 8: de routekaart pas laden als je Route opent.** Nu laadt elke start al een kaarttegel, ook op een gsm waar je Route niet eens hebt. Het is de kleinste winst en daarom als laatste gepland; wegens tijd niet gedaan. Volgende ronde.

Bij deze vier is niets verloren: de app werkt ongewijzigd zoals voorheen.

**Dingen die we bewust niet nu aanpakken ("Niet nu"), met de beslissingen voor jou:**

- **Beslissing voor jou: de achtergrondservice eerst uit het geheugen laten starten.** Dit zou de grootste winst geven bij een tweede start op een trage verbinding (nu is de start met de achtergrondservice niet sneller dan zonder). Maar het verandert jouw regel dat de app tot 4 seconden op het netwerk wacht voordat ze uit het geheugen start, en een correctie komt dan een start later aan. Alleen doen als jij dat wilt.
- **Beslissing voor jou: nog meer glas weglaten.** 's Nachts, tijdens een thema, op de computer of bij de vaste balken zou je het verschil wel zien. Pas bespreken als een echte telefoon na verbetering 2 nog traag scrolt.
- **Beslissing voor jou: een ticket dat tussen de lijst en het openen verdwijnt (bijvoorbeeld opgeruimd in Zoho).** Nu mislukt dan de hele lijst; overslaan is robuuster maar verandert de uitkomst. Wil je dat de lijst gewoon doorloopt zonder dat ene ticket?
- **Het eerste bezoek aan de Kalender op een telefoon (ongeveer 914 ms) blijft traag.** In gewone woorden: de telefoon moet bij de allereerste keer de hele pagina met ongeveer duizend onderdelen één keer uitmeten en plaatsen. Dat duurt bijna een seconde, tijdens welke het scherm niet reageert. Daarna gaat het veel sneller. We hebben geprobeerd dat werk te verplaatsen en dat hielp niet. Het is een eenmalig, ingebouwd stukje werk van de pagina zelf en kan niet zomaar kleiner gemaakt worden. We kijken eerst op een echte telefoon of dat daar ook zo is.
- **Verborgen tabbladen hun opmaak laten houden, het rapportscherm later laden, de kaartbibliotheek later laden, minder bestanden door ze te bundelen, alle verborgen tabbladen niet meer tekenen, de Zoho-lijst kleiner maken, meer dan 5 Zoho-aanvragen tegelijk, het rapportarchief kleiner maken.** Telkens te riskant of te weinig winst voor vannacht, of er is eerst een proef of een aparte keuze nodig. Staat uitgewerkt in het plan.

## Wat je na een release zelf moet nakijken

Dit zijn controles die onze testopstelling niet kan doen, omdat ze een echte verbinding, echte accounts of een echte telefoon vragen. Bij de release hoort ook dat het versienummer van de app opgehoogd wordt, anders krijgen gebruikers de nieuwe bestanden niet.

**Verbetering 1 (opstarten)**
- [ ] Open de app op een echte gsm en kijk in de ontwikkelaarshulpmiddelen van de browser: de aanvraag van de aanmelding en die van de instellingen komen elk precies één keer voor, en nog voor de onderdelen van de app binnenkomen.
- [ ] Gedeelde tablet: laat de sessie verlopen, kijk dat het inlogscherm verschijnt, log in als een andere gebruiker en controleer dat je zijn eigen instellingen ziet.
- [ ] Op wifi met een inlogpagina (zoals in een hotel of bij een klant) start de app nog uit het geheugen.
- [ ] Een gebruiker die zijn wachtwoord moet wijzigen krijgt nog gewoon het wachtwoordscherm.
- [ ] Zonder internet starten: twee mislukte aanvragen voor instellingen, en geen foutmelding in het logboek van de browser.

**Verbetering 2 (kaarten zonder vervaging)**
- [ ] Echte gsm: Wachtrij overdag en 's nachts zien er hetzelfde uit als voorheen.
- [ ] Het scrollen gaat merkbaar vlotter. Zo niet: terugdraaien.
- [ ] Controleer ook een tablet in rechtopstaande stand en een themaweek.

**Verbetering 3 (Kalender en Ingepland)**
- [ ] Technieker: de Kalender toont de verse stand na de vernieuwing van de lijst, na het maken van een rapport en na een wijziging door de planner op een ander toestel.
- [ ] Een nieuwe dag (na middernacht) toont de nieuwe dag, zonder handmatig vernieuwen.

**Verbetering 6 (rapportenarchief)**
- [ ] Na een onzekere verzending van een rapport: "Herladen" zet de knop weer open.

## Beslissingen die de opzichter in jouw plaats nam

Je was vannacht niet bereikbaar. Dit zijn de keuzes die ik in jouw plaats maakte, met wat het kost als ze fout blijken.

1. **Werken vanuit de hoofdsessie met hulpagenten** in plaats van een aparte sessie. De app weigert 's nachts een nieuwe sessie te starten zonder jouw woorden. Kost als het fout is: niets, dezelfde werkwijze.
2. **Oud en nieuw om en om meten** met het bestaande meetgereedschap. Kost als het fout is: niets.
3. **Elke bouwer een eigen werkplek, samengevoegd door mij.** Kost als het fout is: botsende wijzigingen. Opgevangen door taken te kiezen die geen bestanden delen.
4. **Klik-tests één voor één laten draaien** (de testpoort is vast). Kost als het fout is: iets meer wachttijd, geen risico.
5. **De kleinere winst van verbetering 1 aanvaard** (174 en 252 ms in plaats van 200 tot 350). Het is veilig en positief. Kost als het fout is: niets, enkel minder winst. Eerlijk vermeld in dit document.
6. **Het meetgereedschap aangepast vóór de eindmeting** (geldige instellingen, ander teken bij het wisselen van tabblad). Kost als het fout is: de nulmeting van 00:30 is niet een-op-een vergelijkbaar. Daarom meten we in één sessie om en om.
7. **Het bestaande instellingenfoutje meteen mee hersteld**, in een eigen wijziging. Kost als het fout is: los terug te draaien.
8. **Bij verbetering 6 een bestaande lijst behouden bij een gelijk antwoord** in plaats van een nieuwe kopie, zodat kaartjes in de kalender dezelfde blijven. De onafhankelijke nakijker keurde dit goed. Kost als het fout is: een kalenderkaartje dat een keer te veel of te weinig opnieuw getekend wordt, geen fout in gegevens.
9. **Bij verbetering 2 een strengere variant verlaten.** Een scherpere uitwerking gaf op drie plekken een net te lage leesbaarheid (4,23 tegen de norm van 4,5); die is teruggedraaid voor de variant die op de pixel gelijk blijft. De bestaande leesbaarheidscontrole eiste vervaging op de gsm overdag; die eis is aangepast omdat ze daar nu bewust ontbreekt. Een nieuwe pixelproef bewaakt dat nu. Kost als het fout is: een kaart met net te weinig leesbaarheid; los terug te draaien met verbetering 2.
10. **Verbetering 5, 7 en 8 niet bouwen** wegens tijd, zodat de volledige tests en de eindmeting op tijd konden starten. Kost als het fout is: minder winst, geen risico.
11. **Verbetering 4 afgekeurd laten** op advies van de onafhankelijke nakijker. Kost als het fout is: de grootste opstartwinst (tickets vroeg opvragen) is niet binnengehaald.

## Ander nieuws

Tijdens de controle van verbetering 2 viel iets op dat niets met onze wijzigingen te maken heeft en ook al in de live versie zit: het label "Wacht bevestiging" in de Kalender op de gsm, in het lichte uiterlijk, haalt op sommige scrollposities de leesbaarheidsnorm (4,5 op 1) niet. Gemeten werd ongeveer 4,05 tot 4,08. Op een heel klein scherm (360 x 640) kwamen enkele veel lagere uitschieters voor, maar die zijn mogelijk een meetfout. Mijn voorstel: een apart ticket om dit label iets donkerder te maken; het is klein en staat los van deze optimalisatie.
