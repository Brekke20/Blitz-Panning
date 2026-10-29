# Vergelijking Blitz Planning 2.5.1: nu en geoptimaliseerd

*Opgesteld in de nacht van 28 op 29 oktober 2026. De cijfers komen uit de eindmeting (oud en nieuw om en om gemeten, in één sessie) en de testresultaten uit de eindtests. Er staat niets live: de verbeteringen staan klaar op een aparte werkversie en gaan pas mee bij een release die jij goedkeurt.*

## In het kort

- **Wat er vannacht gedaan is**: vier verbeteringen gebouwd en door een onafhankelijke nakijker gecontroleerd (sneller opstarten, lijstkaarten op de gsm lichter, kalender en ingepland minder onnodig opnieuw tekenen, het rapportenarchief robuuster laden). Daarnaast zijn twee bestaande foutjes gevonden en hersteld.
- **Wat het oplevert** (eindmeting, mediaan van 5 tot 7 runs): de app start op een trage verbinding (150 ms per bestand) ongeveer 170 tot 310 ms sneller, dat is 4 tot 8 procent. Het terugkeren naar een tabblad op een telefoon is een stuk sneller: Kalender 486 naar 240 ms (−51 %), Rapporten 159 naar 99 ms (−38 %), Ingepland 546 naar 441 ms (−19 %). Het scrollen op een gsm is overdag 15 tot 36 procent vloeiender (beelden in 3 seconden: Wachtrij 133 naar 181, Kalender 100 naar 130, Ingepland 157 naar 181; 180 is perfect). Let op: het scrollen is gemeten zonder echte grafische kaart en dus nog niet bevestigd op een echte telefoon. Op een snelle verbinding start de app niet merkbaar sneller of trager (verschillen van ongeveer 50 ms zijn daar ruis).
- **Wat er niet slechter werd**: alle testen slagen (wel nadat 20 verkeerd geschreven tests, die al op de live versie faalden, zijn hersteld; zie Testresultaten). Bij de metingen liggen een paar cijfers 10 procent of meer hoger dan bij de oude versie. Bijna allemaal vallen die binnen de normale schommeling van de testopstelling (oud en nieuw overlappen). Eén echte aandachtspost: Route openen op de computer is ongeveer 40 tot 65 ms trager (+20 tot +28 %). Zie "Wat slechter of gelijk bleef" bij de meetresultaten.
- **Jij beslist over twee zichtbare wijzigingen**: (1) de vervaging achter de lijstkaarten op de gsm valt overdag weg; (2) bij een laadfout in het rapportenarchief blijft de lijst staan met een melding, in plaats van een foutregel. Beide zijn los terug te draaien.
- **Jij beslist later over drie grotere vragen** die ik bewust niet vannacht heb aangepakt: de regel van 4 seconden bij het opstarten, nog meer glas weglaten, en wat er moet gebeuren als een ticket tussendoor verdwijnt.
- **Niet gebouwd**: vier andere verbeteringen zijn niet gedaan. Eén omdat de onafhankelijke nakijker het te riskant vond (kans op dubbele aanvragen bij Zoho), drie door tijdgebrek. Die komen in een volgende ronde.
- **Eerlijk over de winst**: de eerste verbetering levert minder op dan het plan hoopte (4 tot 8 procent op een trage verbinding, niets merkbaars op een snelle). Op de echte hosting kan de winst anders uitvallen dan op onze testopstelling.
- **Niets is live.** Na een release moet je zelf een paar dingen op een echte telefoon nakijken (zie "Wat je na een release zelf moet nakijken").

## Hoe gemeten

- **Machine**: een Windows 11-laptop met een Intel Core i5-1135G7 (8 verwerkingsdraden) en 40 GB geheugen. De app draait in een onzichtbare browser, dus zonder echt scherm en zonder grafische kaart. Tijdens de metingen liep er geen andere test op dezelfde machine.
- **Verzonnen gegevens**: er is geen echte klantendata, geen Zoho, geen kaartdienst en geen mail bij betrokken. Elk verzoek naar de server wordt door een eigen minimale nepserver beantwoord en alles buiten de eigen computer is afgesloten (op de twee bibliotheek-hosts na waar de app zijn kaart en handtekeningmodule vandaan haalt). Voor de meting van het opstarten draait de app zoals in het echt, want de eerste verbetering werkt enkel zo. De overige metingen draaien in een testmodus.
- **Rol**: de standaardrol van de planner, ingelogd als beheerder, zodat alle tabbladen bereikbaar zijn.
- **Gegevens**: 30 tickets in de wachtrij en 28 geplande tickets verspreid over de werkweek, zoals een drukke dag. De klok staat vast (bij het wisselen van tabbladen op maandag 5 oktober 2026 om 12:05, bij de scrollmeting midden op de dag om 12:05), zodat elke meting dezelfde week en dezelfde dagstand toont. Dat laatste is belangrijk voor verbetering 2, want die geldt enkel overdag.
- **Telefoon**: schermgrootte 375 x 812 met aanraking en de processor kunstmatig 4 keer trager gemaakt (een middenklasse-gsm). **Computer**: schermgrootte 1440 x 900, processor op volle snelheid.
- **Aantal metingen en mediaan**: elke meting is 5 keer herhaald (het opstarten bij 150 ms zelfs 7 keer). In de tabellen staat de **mediaan** (de middelste waarde, zodat een uitschieter niet doorweegt) met tussen haakjes de laagste en hoogste waarde (de "spreiding").
- **Oud en nieuw om en om**: de eindvergelijking meet de oude versie (2.5.1, de live versie) en de nieuwe versie afwisselend (oud, nieuw, nieuw, oud, ...) in dezelfde sessie. Een drukke of rustige minuut van de computer raakt dan beide versies even hard. Daardoor komt de kolom "2.5.1 (nu)" in de tabellen uit deze eindmeting.
- **Waarom niet de eerste meting van 00:30**: er bestaat een eerdere meting van de live versie (de "nulmeting" van vannacht, rond half één). Die is gedaan met een oudere versie van het meetgereedschap. Dat gereedschap is daarna op twee punten verbeterd: het geeft de nepserver nu een geldig antwoord op de instellingen, en het wacht bij het wisselen van tabblad niet meer op een teken dat in de nieuwe situatie bewust niet meer verschijnt. Daardoor liggen de tijden van het wisselen van tabblad met het nieuwe gereedschap merkbaar hoger dan in de eerste meting. Dat komt door een strengere manier van meten, niet door de app. De eerste meting en de eindmeting zijn dus niet een-op-een vergelijkbaar. In deze tekst komen daarom uitsluitend cijfers uit de eindmeting voor, behalve één zin die dat zelf aangeeft (het rapportscherm).
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

**1. Sneller opstarten: aanmelding en instellingen worden vroeger opgevraagd.** Bij het opstarten vroeg de app twee dingen pas op nadat al zijn onderdelen binnen waren: wie je bent (aanmelding) en jouw instellingen. Nu worden die twee meteen gevraagd, terwijl de onderdelen nog binnenkomen. De app wacht dus minder op zichzelf. Je ziet geen verschil in het scherm, enkel dat de app op een trage verbinding iets eerder klaar is. In de eindmeting was dat bij 150 ms vertraging 168 ms sneller bij een eerste bezoek (4301 naar 4133 ms), 306 ms bij een tweede bezoek (3847 naar 3541 ms) en 273 ms bij een tweede bezoek met de achtergrondservice van de app (3841 naar 3568 ms). Dat is 4 tot 8 procent; het plan hoopte op ongeveer 200 tot 350 ms. Op een snelle verbinding is er geen merkbaar verschil. Risico: dit raakt het inlogpad en het opstarten zonder internet. Daarom is het door een onafhankelijke nakijker gecontroleerd en met extra tests afgedekt, ook voor een verlopen sessie, een scherm voor wachtwoordwijziging en een start zonder verbinding. Kan los teruggedraaid worden.

**2. Lijstkaarten op de gsm zonder vervaging (overdag).** De kaarten van tickets en afspraken hebben een glaseffect met een lichte vervaging van wat erachter ligt. Op de gsm, overdag, ligt daar alleen een zachte kleurverloop-hemel. Die vervaging is dus niets wat je ziet, maar ze kost de telefoon wel rekenwerk bij het scrollen. Nu is ze daar weggelaten. 's Nachts (met sterren), tijdens een themaweek, op de computer en op een liggende tablet verandert er niets. Wat je merkt: het beeld is hetzelfde (een pixelvergelijking met de oude weergave toonde hooguit 3 op 255 verschil, dat is onzichtbaar), en het scrollen kan vlotter gaan. Risico: het raakt een afspraak die jij zelf maakte over het glaslook. Daarom beslis jij hierover (zie het volgende deel). Kan los teruggedraaid worden, met één handeling, zonder de rest te raken.

**3. Kalender en Ingepland niet onnodig opnieuw tekenen.** Telkens je naar het tabblad Kalender of Ingepland ging, bouwde de app dat scherm helemaal opnieuw op, ook als er niets veranderd was. Op een telefoon kostte dat ongeveer een halve seconde per bezoek. Nu wordt het scherm enkel opnieuw getekend als er echt iets veranderd is: nieuwe gegevens, een andere dag, een andere schermindeling of een andere filter. Wat je merkt: terugkeren naar die tabbladen voelt sneller. Op de telefoon (4 keer tragere processor) ging het terugkeren naar Kalender van 486 naar 240 ms (−51 %) en naar Ingepland van 546 naar 441 ms (−19 %). Risico: een scherm dat verouderd blijft omdat een wijziging niet als wijziging geteld wordt. Daarom telt nu elke soort wijziging mee, en de dag van vandaag en de schermindeling zitten in de controle. De onafhankelijke nakijker vond twee gaten (het aanpassen van de route-volgorde en een klein onderdeel dat de status van een voorstel toont); die zijn daarna dichtgemaakt, met 22 nieuwe tests. Kan los teruggedraaid worden. Een tweede, grotere stap (Ingepland helemaal niet tekenen zolang het verborgen is) is bewust niet gedaan. Een bijkomend, gunstig neveneffect van de herstelling rond de route-volgorde: een zeldzame wedstrijd tussen twee updates is nu dicht. Het ging om het geval waarin oude datums uit Zoho vers ingestelde uren konden overschrijven. Prijs: in dat zeldzame geval volgt één extra herlaadbeurt.

**6. Rapportenarchief robuuster laden.** Als het laden van de rapportenlijst mislukte (storing, geen verbinding, of een leeg antwoord van de server tijdens een storing), kon de app de al getoonde lijst wissen en het gekende versienummer van de lijst kwijtraken. Nu blijft de bestaande lijst staan en verschijnt een melding. Is er nog niets geladen, dan zie je zoals vroeger een foutregel. Ook wordt de lijst en de kalender niet opnieuw getekend als het antwoord precies gelijk is aan het vorige. Wat je merkt: bij een storing blijft je lijst staan met een melding (zichtbaar, zie het volgende deel); verder voelt het tabblad Rapporten sneller: terugkeren op de telefoon ging van 159 naar 99 ms (−38 %). Risico: dit raakt het versienummer bij het verzenden van rapporten, daarom is het door een onafhankelijke nakijker gecontroleerd, die na een eerste ronde met aanpassingen goedkeurde. Kan los teruggedraaid worden.

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

Alle cijfers komen uit de eindmeting, waarin de oude (2.5.1) en nieuwe versie afwisselend zijn gemeten. Per cel: de mediaan van 5 runs (opstarten bij 150 ms: 7 runs), met tussen haakjes de laagste en hoogste waarde. De kolom "Verschil" is nieuw min oud (bij tijden is negatief beter), met een percentage.

**Wat slechter of gelijk bleef.** Bij een paar metingen ligt het nieuwe cijfer 10 procent of meer boven het oude. Bij bijna al die metingen overlappen de laagste en hoogste waarden van oud en nieuw. Dan valt het verschil binnen de normale schommeling van de testopstelling, zeker bij tijden van 20 tot 300 ms, waar een paar tientallen milliseconden al veel procent zijn. Alles wat 10 procent of meer hoger is:

- **Opstarten, snelle server (0 ms)**: tweede bezoek met achtergrondservice 357 naar 402 ms (+13 %) en eerste bezoek 437 naar 480 ms (+9,8 %; in de nieuwe runs zat één uitschieter van 2567 ms). Verschillen van ongeveer 50 ms zijn bij een snelle server ruis en de spreidingen overlappen.
- **Computer, tabbladen**: Route eerste bezoek 239 naar 305 ms (+28 %), Route herhaald bezoek 205 naar 246 ms (+20 %), Wachtrij herhaald 88 naar 109 ms (+23 %), kalender terug naar de volle week 25 naar 48 ms (+92 %), ticketdetail vanuit de Wachtrij 23 naar 40 ms (+78 %). Alle overlappen met de spreiding van de oude versie, **behalve Route herhaald bezoek (+20 %)**: daar is het nieuwe laagste cijfer hoger dan het oude hoogste. Route is niet aangepast, behalve een kleine markering in de herstelling van de route-volgorde. Een oorzaak is niet vastgesteld. Het gaat om 40 tot 65 ms. Controleer bij de handcontrole na de release of Route openen op de computer niet trager aanvoelt.
- **Telefoon**: Kalender eerste bezoek 1188 naar 1309 ms (+10 %), Inventaris herhaald 121 naar 146 ms (+21 %). Beide overlappen met de spreiding van de oude versie.

Op dezelfde computer werd ook veel sneller: Kalender eerste bezoek −41 %, ticketdetail vanuit de Kalender −44 %, de duur van alle haperingen samen op de telefoon −14 %. De totale geheugengroei en het aantal foutmeldingen bleven gelijk.

### 5.1 Opstarten

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tijd tot bruikbaar, snelle server: eerste bezoek (niets onthouden) | 437 ms (402 tot 652) | 480 ms (438 tot 2567) | +43 ms (+9,8 %) |
| Tijd tot bruikbaar, snelle server: tweede bezoek (browser onthoudt bestanden) | 487 ms (422 tot 496) | 457 ms (382 tot 506) | −30 ms (−6,2 %) |
| Tijd tot bruikbaar, snelle server: tweede bezoek met de achtergrondservice van de app (service worker) | 357 ms (336 tot 463) | 402 ms (355 tot 456) | +45 ms (+13 %) |
| Tijd tot bruikbaar, server met 150 ms vertraging: eerste bezoek (niets onthouden) | 4301 ms (4204 tot 4563) | 4133 ms (4084 tot 4233) | −168 ms (−3,9 %) |
| Tijd tot bruikbaar, server met 150 ms vertraging: tweede bezoek (browser onthoudt bestanden) | 3847 ms (3814 tot 3898) | 3541 ms (3517 tot 3587) | −306 ms (−8,0 %) |
| Tijd tot bruikbaar, server met 150 ms vertraging: tweede bezoek met de achtergrondservice van de app (service worker) | 3841 ms (3822 tot 3874) | 3568 ms (3536 tot 3574) | −273 ms (−7,1 %) |
| Aantal verzoeken aan de server, server met 150 ms vertraging: eerste bezoek (niets onthouden) | 142 | 144 | +2 (+1,4 %) |
| Aantal verzoeken aan de server, server met 150 ms vertraging: tweede bezoek (browser onthoudt bestanden) | 142 | 142 | 0 |
| Aantal verzoeken aan de server, server met 150 ms vertraging: tweede bezoek met de achtergrondservice van de app (service worker) | 142 | 142 | 0 |
| Aantal verzoeken aan de server, snelle server: eerste bezoek (niets onthouden) | 142 | 142 | 0 |
| Aantal verzoeken aan de server, snelle server: tweede bezoek (browser onthoudt bestanden) | 142 | 142 | 0 |
| Aantal verzoeken aan de server, snelle server: tweede bezoek met de achtergrondservice van de app (service worker) | 159 | 182 | +23 (+14 %) |
| Overgedragen gegevens: eerste bezoek (niets onthouden) | 1489 kB | 1505 kB | +16 kB (+1,1 %) |
| Overgedragen gegevens: tweede bezoek (browser onthoudt bestanden) | 36 kB | 36 kB | 0 kB |
| Overgedragen gegevens: tweede bezoek met de achtergrondservice van de app (service worker) | 6 kB | 6 kB | 0 kB |
| Inladen van het rapportscherm (84 kB) op een 4x tragere processor | 9 ms (8 tot 11) | 12 ms (11 tot 19) | +3 ms (+33 %) |

- **Tijd tot bruikbaar**: hoe lang het duurt vanaf het openen van de app tot de lijst met tickets er staat en de app reageert. Lager is beter.
- **Eerste bezoek / tweede bezoek**: het eerste bezoek haalt alles op; bij een tweede bezoek heeft de browser al bestanden bewaard (met of zonder de achtergrondservice van de app).
- **Aantal verzoeken**: hoeveel losse bestanden de app bij het opstarten opvraagt. Minder is beter, want elk bestand kost wachttijd op een trage verbinding. Verbetering 1 verandert in principe niet welke bestanden gevraagd worden, enkel wanneer. Bij 150 ms zie je bij het eerste bezoek 2 verzoeken meer (142 naar 144): de twee vroege aanvragen (aanmelding en instellingen) worden nu apart meegeteld; het zijn geen extra gegevens. Bij de snelle server met de achtergrondservice staat er 159 tegen 182. Dat aantal is in dat ene profiel al in de eerste meting van vannacht hoger dan elders (155) en schommelt dus; bij 150 ms is het in beide versies 142. We hebben dit vannacht niet verder kunnen uitzoeken.
- **Overgedragen gegevens**: hoeveel kilobyte er echt over de lijn gaat. Minder is beter, vooral op mobiel internet.
- **Inladen van het rapportscherm**: de rekentijd die de telefoon nodig heeft om het rapportscherm klaar te maken; de grens is 150 ms. Dit scherm is in deze ronde niet aangepast. De nieuwe meetbestanden meten enkel de nieuwe versie (11 tot 12 ms). Voor de oude versie staat hier daarom de waarde uit de eerste meting van 00:30 (9 ms, op dezelfde manier gemeten); het verschil van 3 ms is ruis en ver onder de grens.

### 5.2 Scrollen op de telefoon

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tijd tot het eerste ticket zichtbaar is (telefoon) | 2927 ms (2314 tot 4724) | 2864 ms (2573 tot 4678) | −63 ms (−2,2 %) |
| Soepel scrollen in Wachtrij: beelden in 3 seconden (hoger is beter, 180 = perfect) | 133 (103 tot 144) | 181 (174 tot 183) | +48 (+36 %) |
| Haperingen tijdens scrollen in Wachtrij: totale duur van lange taken | 0 ms (0 tot 0) | 0 ms (0 tot 0) | 0 ms (n.v.t.) |
| Soepel scrollen in Kalender: beelden in 3 seconden (hoger is beter, 180 = perfect) | 100 (93 tot 112) | 130 (116 tot 158) | +30 (+30 %) |
| Haperingen tijdens scrollen in Kalender: totale duur van lange taken | 0 ms (0 tot 0) | 0 ms (0 tot 0) | 0 ms (n.v.t.) |
| Soepel scrollen in Ingepland: beelden in 3 seconden (hoger is beter, 180 = perfect) | 157 (140 tot 171) | 181 (178 tot 182) | +24 (+15 %) |
| Haperingen tijdens scrollen in Ingepland: totale duur van lange taken | 0 ms (0 tot 0) | 0 ms (0 tot 0) | 0 ms (n.v.t.) |

- **Tijd tot het eerste ticket**: hoe lang een telefoon nodig heeft voordat het eerste ticket op het scherm staat. Lager is beter.
- **Beelden in 3 seconden**: hoeveel keer het scherm ververst wordt terwijl er drie seconden heen en weer wordt geveegd; 180 betekent perfect vloeiend (60 per seconde), lager betekent schokkerig. Hoger is beter. Dit is gemeten overdag; 's nachts geldt de nieuwe regel bewust niet.
- **Lange taken**: momenten waarop de app langer dan 50 ms vastzit. Bij een telefoon die via de grafische chip scrolt, blijft dit meestal nul; het cijfer verandert alleen als er echt iets stokt.

### 5.3 Computer: tabbladen, kalender, ticketdetail en geheugen (1440 x 900)

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tabblad Kalender openen, eerste bezoek | 302,2 ms (260,1 tot 333,4) | 178,1 ms (170,8 tot 273,2) | −124,1 ms (−41 %) |
| Tabblad Kalender openen, herhaald bezoek | 183 ms (136,6 tot 199,6) | 164,8 ms (140 tot 187,5) | −18,2 ms (−9,9 %) |
| Tabblad Route openen, eerste bezoek | 238,7 ms (164,8 tot 292,5) | 304,7 ms (232,4 tot 307,1) | +66 ms (+28 %) |
| Tabblad Route openen, herhaald bezoek | 204,6 ms (148,7 tot 227,4) | 245,9 ms (230,8 tot 310,9) | +41,3 ms (+20 %) |
| Tabblad Ingepland openen, eerste bezoek | 305 ms (265,5 tot 315,7) | 326,4 ms (259,2 tot 434,9) | +21,4 ms (+7,0 %) |
| Tabblad Ingepland openen, herhaald bezoek | 137,8 ms (108,4 tot 156) | 122,6 ms (102,1 tot 163,2) | −15,2 ms (−11 %) |
| Tabblad Inventaris openen, eerste bezoek | 155,1 ms (153,7 tot 222) | 128,2 ms (123 tot 189) | −26,9 ms (−17 %) |
| Tabblad Inventaris openen, herhaald bezoek | 105,1 ms (90,9 tot 196,8) | 96,3 ms (79,2 tot 147,7) | −8,8 ms (−8,4 %) |
| Tabblad Rapporten openen, eerste bezoek | 75,1 ms (68,3 tot 91,8) | 68,9 ms (56,3 tot 80,1) | −6,2 ms (−8,3 %) |
| Tabblad Rapporten openen, herhaald bezoek | 69,3 ms (59,6 tot 70,9) | 74,7 ms (50,3 tot 91) | +5,4 ms (+7,8 %) |
| Tabblad Wachtrij openen, herhaald bezoek | 88,4 ms (76 tot 105,4) | 108,5 ms (87,6 tot 116,9) | +20,1 ms (+23 %) |
| Kalender: volgende week openen (lege week) | 14,5 ms (11,9 tot 17,9) | 15,5 ms (12,2 tot 34) | +1 ms (+6,9 %) |
| Kalender: terug naar de volle week | 25,1 ms (20,7 tot 37,3) | 48,3 ms (25 tot 73,1) | +23,2 ms (+92 %) |
| Ticketdetail openen vanuit de Wachtrij | 22,6 ms (16,8 tot 66,4) | 40,2 ms (21,6 tot 51,2) | +17,6 ms (+78 %) |
| Ticketdetail openen vanuit de Kalender | 62,3 ms (59,7 tot 107,1) | 34,6 ms (18,6 tot 54,3) | −27,7 ms (−44 %) |
| Langste hapering (lange taak) tijdens de sessie | 123 ms (110 tot 157) | 93 ms (69 tot 101) | −30 ms (−24 %) |
| Aantal haperingen (lange taken) tijdens de sessie | 4 (3 tot 4) | 4 (2 tot 5) | 0 |
| Totale duur van alle haperingen tijdens de sessie | 328 ms (290 tot 367) | 288 ms (126 tot 355) | −40 ms (−12 %) |
| Geheugen van de app na het laden | 3,4 MB | 3,5 MB | +0,1 MB (+2,9 %) |
| Geheugen van de app na de sessie | 4 MB | 4 MB | 0 MB |
| Foutmeldingen van de app in de console | 0 | 0 | 0 |
| Waarschuwingen van de app in de console | 0 | 0 | 0 |

- **Tabblad openen**: de tijd tussen het klikken op een tabblad en het moment dat het scherm getekend is. Het eerste bezoek moet alles opbouwen, een herhaald bezoek profiteert van wat al klaarstaat (bij de Wachtrij is elk bezoek een terugkeer, want die staat bij het opstarten al open). Lager is beter.
- **Kalender: week wisselen**: de tijd tussen het klikken op de pijl voor volgende of vorige week en het getekende resultaat. "Volgende week" is een lege week, "terug" is de volle week met 28 tickets en toont dus de echte opbouwtijd.
- **Ticketdetail openen**: de tijd tussen het klikken op een ticketkaart en het getekende detailvenster.
- **Hapering (lange taak)**: een moment waarop de app langer dan 50 ms niets anders kan doen; tijdens zo'n moment reageert het scherm niet. De langste is de ergste ervaring in de sessie. Lager is beter.
- **Geheugen**: hoeveel geheugen de app zelf vasthoudt, nadat de browser opgeruimd heeft. Een sessie van 29 handelingen mag dit nauwelijks laten groeien.
- **Foutmeldingen en waarschuwingen**: meldingen die de app zelf in het technische logboek van de browser schrijft. Het doel is nul. (Meldingen over bewust afgesloten externe websites en de bekende testruis van de geblokkeerde achtergrondservice tellen niet mee.)

### 5.4 Telefoon: tabbladen, kalender, ticketdetail en geheugen (375 x 812, processor 4x trager)

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tabblad Kalender openen, eerste bezoek | 1187,8 ms (1139,7 tot 1324,3) | 1308,5 ms (860,8 tot 1346,5) | +120,7 ms (+10 %) |
| Tabblad Kalender openen, herhaald bezoek | 486 ms (477,5 tot 548,9) | 239,9 ms (228,4 tot 270,1) | −246,1 ms (−51 %) |
| Tabblad Ingepland openen, eerste bezoek | 718,7 ms (658,3 tot 832,8) | 694,1 ms (662,9 tot 808,5) | −24,6 ms (−3,4 %) |
| Tabblad Ingepland openen, herhaald bezoek | 546,4 ms (513,8 tot 619,6) | 440,9 ms (424,9 tot 467,7) | −105,5 ms (−19 %) |
| Tabblad Inventaris openen, eerste bezoek | 199,3 ms (130,3 tot 299,3) | 198,9 ms (173,2 tot 253,4) | −0,4 ms (−0,2 %) |
| Tabblad Inventaris openen, herhaald bezoek | 120,5 ms (109,1 tot 178,2) | 146,2 ms (136,8 tot 184,5) | +25,7 ms (+21 %) |
| Tabblad Rapporten openen, eerste bezoek | 263 ms (149,5 tot 305,7) | 227,8 ms (198,9 tot 267,5) | −35,2 ms (−13 %) |
| Tabblad Rapporten openen, herhaald bezoek | 159,4 ms (143,5 tot 198,7) | 99,3 ms (93,9 tot 105,9) | −60,1 ms (−38 %) |
| Tabblad Wachtrij openen, herhaald bezoek | 206,6 ms (138,8 tot 216,2) | 192,5 ms (146,8 tot 216,8) | −14,1 ms (−6,8 %) |
| Kalender: volgende week openen (lege week) | 113,6 ms (58,8 tot 147,6) | 122,9 ms (93,4 tot 138,8) | +9,3 ms (+8,2 %) |
| Kalender: terug naar de volle week | 277,2 ms (124,8 tot 303,9) | 296,2 ms (240,4 tot 317,5) | +19 ms (+6,9 %) |
| Ticketdetail openen vanuit de Wachtrij | 102,4 ms (93,9 tot 108,3) | 95 ms (80,2 tot 132,5) | −7,4 ms (−7,2 %) |
| Ticketdetail openen vanuit de Kalender | 215,9 ms (198,7 tot 222,2) | 199,9 ms (171,1 tot 228,5) | −16 ms (−7,4 %) |
| Langste hapering (lange taak) tijdens de sessie | 853 ms (777 tot 938) | 925 ms (478 tot 954) | +72 ms (+8,4 %) |
| Aantal haperingen (lange taken) tijdens de sessie | 47 (42 tot 50) | 37 (36 tot 40) | −10 (−21 %) |
| Totale duur van alle haperingen tijdens de sessie | 6277 ms (5551 tot 6838) | 5405 ms (5007 tot 5470) | −872 ms (−14 %) |
| Geheugen van de app na het laden | 3,4 MB | 3,4 MB | 0 MB |
| Geheugen van de app na de sessie | 3,7 MB | 3,7 MB | 0 MB |
| Foutmeldingen van de app in de console | 0 | 0 | 0 |
| Waarschuwingen van de app in de console | 2 | 2 | 0 |

De uitleg bij de cijfers is dezelfde als bij 5.3. De twee waarschuwingen op de telefoon (in beide versies) komen van een tijdelijke controlefunctie die enkel in de testmodus draait en niets verstuurt.

### 5.5 Stabiliteit (automatische testen)

De kolom "2.5.1 (nu)" is de meting van de live versie van vannacht; de kolom "Geoptimaliseerd" is dezelfde selectie testen op de nieuwe versie.

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Aantal verschillende tests | 127 | 127 | 0 |
| Uitvoeringen (elke test 2x) | 254 | 254 | 0 |
| Geslaagd | 254 | 253 | −1 |
| Mislukt | 0 | 1 | +1 |
| Flaky (slaagt pas bij een tweede poging) | 0 | 0 | 0 |
| Overgeslagen | 0 | 0 | 0 |
| Tests die de ene keer slaagden en de andere keer faalden | 0 | 1 | +1 |
| Duur van de run | 7 minuten | 6,0 minuten | −1 minuut |

- **Geslaagd / mislukt**: het aantal uitvoeringen van een test dat slaagde of faalde. Doel: geen enkele mislukking.
- **Flaky**: een test die faalt en bij een nieuwe poging slaagt. In deze meting wordt er niet opnieuw geprobeerd, dus dit blijft nul; het echte signaal staat in de volgende regel.
- **Een keer geslaagd, een keer gefaald**: een test die in de ene van de twee herhalingen slaagt en in de andere faalt: dat is onbetrouwbaarheid, en precies wat we willen terugdringen.

In de meting van de live versie slaagden alle tests in beide herhalingen. Bij de nieuwe versie faalde één test in één van de twee herhalingen. Het gaat om de test "trage aanmelding: de app start binnen ongeveer 6 seconden uit de bewaarde kopie". Die mat 8508 ms tegen een grens van 8500 ms, dus 8 ms te traag. Daarna is die test 6 keer op de oude en 6 keer op de nieuwe versie herhaald: telkens geslaagd, met dezelfde tijden (7,4 tot 8,4 seconden). Conclusie: een tijdsgrens die in een drukke run net te strak staat, geen achteruitgang door de verbeteringen. De run duurde 6,0 minuten tegen 7 minuten.

### 5.6 Bijdrage van de kaarten zonder vervaging (apart gemeten)

Hier meten we enkel wat verbetering 2 bijdraagt, door een kopie van de nieuwe versie zonder die ene verbetering naast de volledige nieuwe versie te zetten. Telefoon, overdag, zelfde afwisselende meetmethode. Zo zie je of het wegvallen van de vervaging het scrollen echt vlotter maakt, los van de andere verbeteringen.

| Metriek (telefoon, overdag) | Nieuwe versie zonder verbetering 2 | Nieuwe versie met verbetering 2 | Verschil |
|---|---|---|---|
| Soepel scrollen in Wachtrij: beelden in 3 seconden (hoger is beter, 180 = perfect) | 145 (108 tot 150) | 181 (174 tot 182) | +36 (+25 %) |
| Soepel scrollen in Kalender: beelden in 3 seconden | 108 (86 tot 122) | 131 (107 tot 144) | +23 (+21 %) |
| Soepel scrollen in Ingepland: beelden in 3 seconden | 160 (149 tot 171) | 181 (178 tot 182) | +21 (+13 %) |
| Tijd tot het eerste ticket zichtbaar is (telefoon) | 2743 ms (2352 tot 4052) | 2975 ms (2517 tot 3005) | +232 ms (+8,5 %) |

Ook dit blijft een aanwijzing: zonder grafische kaart in de testbrowser kan het verschil op een echte telefoon groter of kleiner zijn. Daarom jouw controle op een echte gsm (zie "Zichtbare wijzigingen").

## Testresultaten

Alle testen zijn op de samengevoegde nieuwe versie uitgevoerd, nadat elke verbetering al afzonderlijk was getest en nagekeken.

| Soort test | Resultaat |
|---|---|
| Snelle tests (de brede reeks controles van de logica van de app) | 3574 van 3574 geslaagd |
| Volledige klik-tests (de app wordt in een echte browser bediend, alle schermen en rollen) | 1541 geslaagd, 21 mislukt bij de eerste volledige run. Daarna hersteld, zie hieronder: alle 21 geslaagd. |
| Tests van de achtergrondservice van de app (service worker), die het offline opstarten en updates regelt | 18 van 18 geslaagd |
| Contrasttests (is alle tekst nog goed leesbaar, ook op de kaarten zonder vervaging) | 73 van 73 geslaagd |

**De 21 mislukte klik-tests.** 20 daarvan faalden ook al op de huidige live versie 2.5.1. Die tests zochten tabbladen met een naam als "Ingepland 12", maar sinds versie 2.5.0 is de naam die een schermlezer voorleest "Ingepland, 12 gepland". De app klopt dus, de tests waren fout. Die tests zijn aangepast. Daarna zijn alle 21 opnieuw gedraaid en slaagden ze. De ene overblijvende was een eenmalige timingstoring: ze was in 40 pogingen niet te reproduceren, ook niet op de oude versie.

## Eindcontrole van het geheel

Na het samenvoegen van alle verbeteringen heeft een onafhankelijke nakijker de hele werkversie nog eens als geheel bekeken. Het oordeel: **klaar voor Brent**, zonder ernstige bevindingen. Er is niets veranderd aan wat er naar Zoho gaat, aan de mails, aan de rechten per rol en aan de uitgaande wachtrij (de berichten die wachten om verstuurd te worden). De kleine open punten die de nakijker wel noemde staan hieronder bij "Niet gedaan en waarom".

## Niet gedaan en waarom

**Vier verbeteringen uit het plan zijn niet gebouwd:**

- **Verbetering 4: tickets al vroeg opvragen en niet hertekenen bij een gelijk antwoord.** Afgekeurd door de onafhankelijke nakijker voor vannacht. Er is een kans op dubbele aanvragen bij Zoho (dezelfde lijst twee keer opgevraagd, met dubbele belasting en mogelijke fouten). Dat risico nemen we niet zomaar in een nacht. Komt terug in een volgende ronde, met een veiliger opzet.
- **Verbetering 5: de server haalt tickets bij Zoho parallel op.** Dit is een aanpassing aan de kant van de server en is enkel in de echte situatie meetbaar. Niet gedaan wegens tijd; volgende ronde. Een kleine kanttekening voor dan: de server wacht nu langer op Zoho (26 seconden) dan de app zelf geduld heeft (20 seconden), waardoor de server werk kan doen dat niemand meer leest. Dat is niet aangepast.
- **Verbetering 7: opgeslagen adressen (locaties) één keer in het geheugen inlezen.** Klein, en met de testgegevens niet meetbaar. Wegens tijd naar de volgende ronde.
- **Verbetering 8: de routekaart pas laden als je Route opent.** Nu laadt elke start al een kaarttegel, ook op een gsm waar je Route niet eens hebt. Het is de kleinste winst en daarom als laatste gepland; wegens tijd niet gedaan. Volgende ronde.

Bij deze vier is niets verloren: de app werkt ongewijzigd zoals voorheen.

**Drie kleine open punten voor de volgende ronde** (geen van drie is een probleem voor de release):

- Als je "Tijden vastleggen" annuleert, kan de kalender de tijdelijke uren blijven tonen tot er een andere wijziging komt.
- Als de server een overzicht van instellingen stilzwijgend weigert, laat dat nu geen spoor na. Voor het opsporen van problemen moet daar een korte aantekening van komen.
- Een puur cosmetische, extra keer opnieuw tekenen die je niet merkt.

**Dingen die we bewust niet nu aanpakken ("Niet nu"), met de beslissingen voor jou:**

- **Beslissing voor jou: de achtergrondservice eerst uit het geheugen laten starten.** Dit zou de grootste winst geven bij een tweede start op een trage verbinding (nu is de start met de achtergrondservice niet sneller dan zonder). Maar het verandert jouw regel dat de app tot 4 seconden op het netwerk wacht voordat ze uit het geheugen start, en een correctie komt dan een start later aan. Alleen doen als jij dat wilt.
- **Beslissing voor jou: nog meer glas weglaten.** 's Nachts, tijdens een thema, op de computer of bij de vaste balken zou je het verschil wel zien. Pas bespreken als een echte telefoon na verbetering 2 nog traag scrolt.
- **Beslissing voor jou: een ticket dat tussen de lijst en het openen verdwijnt (bijvoorbeeld opgeruimd in Zoho).** Nu mislukt dan de hele lijst; overslaan is robuuster maar verandert de uitkomst. Wil je dat de lijst gewoon doorloopt zonder dat ene ticket?
- **Het eerste bezoek aan de Kalender op een telefoon (ongeveer 914 ms) blijft traag.** In gewone woorden: de telefoon moet bij de allereerste keer de hele pagina met ongeveer duizend onderdelen één keer uitmeten en plaatsen. Dat duurt bijna een seconde, tijdens welke het scherm niet reageert. Daarna gaat het veel sneller. We hebben geprobeerd dat werk te verplaatsen en dat hielp niet. Het is een eenmalig, ingebouwd stukje werk van de pagina zelf en kan niet zomaar kleiner gemaakt worden. We kijken eerst op een echte telefoon of dat daar ook zo is.
- **Verborgen tabbladen hun opmaak laten houden, het rapportscherm later laden, de kaartbibliotheek later laden, minder bestanden door ze te bundelen, alle verborgen tabbladen niet meer tekenen, de Zoho-lijst kleiner maken, meer dan 5 Zoho-aanvragen tegelijk, het rapportarchief kleiner maken.** Telkens te riskant of te weinig winst voor vannacht, of er is eerst een proef of een aparte keuze nodig. Staat uitgewerkt in het plan.

## Wat je na een release zelf moet nakijken

Dit zijn controles die onze testopstelling niet kan doen, omdat ze een echte verbinding, echte accounts of een echte telefoon vragen. Bij de release **moet** de naam van de opslag van de app (de cachenaam) verhoogd worden; dat is verplicht, anders krijgen gebruikers de nieuwe bestanden niet. Het meest risicovolle onderdeel is verbetering 3, omdat de Kalender het standaardscherm van de technieker is: kijk daar dus eerst en het nauwkeurigst.

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
- [ ] Op de computer: Route openen voelt niet trager aan dan vroeger (in de eindmeting kwam dit cijfer iets hoger uit, zonder bekende oorzaak).
- [ ] Op een gewone start (zonder de testmodus) doet de app niet merkbaar meer aanvragen dan vroeger (in de meting met de achtergrondservice op een snelle server telde de nieuwe versie 182 aanvragen tegen 159).

**Verbetering 6 (rapportenarchief)**
- [ ] Na een onzekere verzending van een rapport: "Herladen" zet de knop weer open.

## Beslissingen die de opzichter in jouw plaats nam

Je was vannacht niet bereikbaar. Dit zijn de keuzes die ik in jouw plaats maakte, met wat het kost als ze fout blijken.

1. **Werken vanuit de hoofdsessie met hulpagenten** in plaats van een aparte sessie. De app weigert 's nachts een nieuwe sessie te starten zonder jouw woorden. Kost als het fout is: niets, dezelfde werkwijze.
2. **Oud en nieuw om en om meten** met het bestaande meetgereedschap. Kost als het fout is: niets.
3. **Elke bouwer een eigen werkplek, samengevoegd door mij.** Kost als het fout is: botsende wijzigingen. Opgevangen door taken te kiezen die geen bestanden delen.
4. **Klik-tests één voor één laten draaien** (de testpoort is vast). Kost als het fout is: iets meer wachttijd, geen risico.
5. **De kleinere winst van verbetering 1 aanvaard** (168 tot 306 ms in plaats van 200 tot 350). Het is veilig en positief. Kost als het fout is: niets, enkel minder winst. Eerlijk vermeld in dit document.
6. **Het meetgereedschap aangepast vóór de eindmeting** (geldige instellingen, ander teken bij het wisselen van tabblad). Kost als het fout is: de nulmeting van 00:30 is niet een-op-een vergelijkbaar. Daarom meten we in één sessie om en om.
7. **Het bestaande instellingenfoutje meteen mee hersteld**, in een eigen wijziging. Kost als het fout is: los terug te draaien.
8. **Bij verbetering 6 een bestaande lijst behouden bij een gelijk antwoord** in plaats van een nieuwe kopie, zodat kaartjes in de kalender dezelfde blijven. De onafhankelijke nakijker keurde dit goed. Kost als het fout is: een kalenderkaartje dat een keer te veel of te weinig opnieuw getekend wordt, geen fout in gegevens.
9. **Bij verbetering 2 een strengere variant verlaten.** Een scherpere uitwerking gaf op drie plekken een net te lage leesbaarheid (4,23 tegen de norm van 4,5); die is teruggedraaid voor de variant die op de pixel gelijk blijft. De bestaande leesbaarheidscontrole eiste vervaging op de gsm overdag; die eis is aangepast omdat ze daar nu bewust ontbreekt. Een nieuwe pixelproef bewaakt dat nu. Kost als het fout is: een kaart met net te weinig leesbaarheid; los terug te draaien met verbetering 2.
10. **Verbetering 5, 7 en 8 niet bouwen** wegens tijd, zodat de volledige tests en de eindmeting op tijd konden starten. Kost als het fout is: minder winst, geen risico.
11. **Verbetering 4 afgekeurd laten** op advies van de onafhankelijke nakijker. Kost als het fout is: de grootste opstartwinst (tickets vroeg opvragen) is niet binnengehaald.

## Ander nieuws

Tijdens de controle van verbetering 2 viel iets op dat niets met onze wijzigingen te maken heeft en ook al in de live versie zit: het label "Wacht bevestiging" in de Kalender op de gsm, in het lichte uiterlijk, haalt op sommige scrollposities de leesbaarheidsnorm (4,5 op 1) niet. Gemeten werd ongeveer 4,05 tot 4,08. Op een heel klein scherm (360 x 640) kwamen enkele veel lagere uitschieters voor, maar die zijn mogelijk een meetfout. Mijn voorstel: een apart ticket om dit label iets donkerder te maken; het is klein en staat los van deze optimalisatie.

Nog iets dat opvalt: de live versie 2.5.1 is live gegaan terwijl 20 klik-tests faalden, om de hierboven uitgelegde reden die enkel de tests betreft. Voor gebruikers had dat geen gevolgen. Wel moet de testreeks ook op de live lijn hersteld worden; de reparatie staat klaar op deze werkversie.
