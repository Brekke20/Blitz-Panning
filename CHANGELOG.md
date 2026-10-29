# Changelog

Alle noemenswaardige wijzigingen aan Blitz Planning worden hier bijgehouden.

Formaat gebaseerd op [Keep a Changelog](https://keepachangelog.com/nl/1.0.0/),
versienummering volgens [Semantic Versioning](https://semver.org/lang/nl/) (zie ook
de "Versioning & changelog"-sectie in `CLAUDE.md`).

Vóór v1.0.0 (2026-08-13) werd geen versiegeschiedenis bijgehouden — de volledige
ontwikkelgeschiedenis daarvoor staat wel in de git-historiek en in
`docs/superpowers/specs/`/`docs/superpowers/plans/`.

## [Unreleased]

### Added
- (nog niets sinds de laatste release)

### Fixed
- Het verborgen spel Blitz Run opent nu ook voor verkopers en sales managers (5× snel tikken op het bliksem-icoon). Voorheen werd het enkel voor de andere rollen ingeschakeld.

## [2.6.0] — 2026-10-29

### Added
- Kalender, Ingepland, Route, Rapporten en Inventaris tonen tijdens het laden grijze plaatsvervangers in plaats van "geen geplande service" of nullen. Pas als de gegevens er echt zijn, zie je wat er staat.

### Changed
- De app start sneller op een trage verbinding: de aanmelding en de instellingen worden opgevraagd terwijl de app zelf nog laadt.
- Terugkeren naar de Kalender op de gsm gaat veel sneller, en ook Ingepland en Rapporten voelen vlotter. Een scherm wordt enkel nog opnieuw opgebouwd als er echt iets veranderd is.
- Het scrollen door de lijstkaarten op de gsm is vlotter. Overdag zijn de kaarten daar niet langer lichtjes wazig; 's nachts, tijdens een themaweek, op de computer en op een liggende tablet blijft alles zoals het was.
- Als de lijst met rapporten niet geladen kan worden, blijft de lijst die je al ziet staan en verschijnt er een melding, in plaats van een foutregel in de plaats van de hele lijst.
- Beheer: de tabbladen Instellingen en Performance laden sneller, want hun gegevens worden tegelijk opgevraagd.
- Achter de schermen krijgt het laden van de tickets meer tijd voordat de server opgeeft, en wordt per aanvraag bijgehouden hoe lang het duurt, zodat trage plekken makkelijker te vinden zijn. Je merkt hier niets van.

### Fixed
- Bij een trage aanmelding op een gedeelde tablet kon het gebeuren dat de instellingen onder de verkeerde gebruiker werden bewaard. Dat gebeurt niet meer.
- De Kalender tekent zich opnieuw als de beschikbaarheid van een klant verandert; voorheen bleef de oude stand soms staan.

## [2.5.1] — 2026-10-28

### Changed
- Het glas van balken en kaarten is doorzichtiger.

### Fixed
- Op de computer staat de bovenbalk nu echt vast bij scrollen (op gsm en tablet blijft trekken-om-te-verversen werken).
- Op de gsm licht een knop in de onderste balk niet meer eerst vierkant op bij een tik.
- In de weekkalender op de computer schemeren de uren niet meer door de dagkoppen.

## [2.5.0] — 2026-10-28

### Added
- Nieuwe stijl "Open dag": een hemel achter de hele app die het uur van de dag volgt (ochtend, middag, avond, nacht; in licht en donker), met een groene gloed onderaan. Een thema met achtergrond vervangt de hemel zoals voorheen.
- Alle kaarten en rijen zijn nu altijd van glas (niet enkel tijdens een thema), met een gloeiende rand in de kleur van de urgentie: rood voor verlopen of hoog, oranje voor middel of wacht op bevestiging, groen voor laag of bevestigd, paars voor een eigen afspraak. Ook het ticketvenster krijgt die gloed.
- Op pc en liggende tablet staat de navigatie in een zwevende zijkolom links, met een icoon per tabblad en de persoonkiezer onderaan. Op gsm en staande tablet staat ze in een glazen dok onderaan; zijn er meer dan vijf tabbladen, dan staan de eerste vier in het dok en de rest achter "Meer".
- Op pc staat bovenaan elk scherm een paginakop met de titel en een korte samenvatting (bv. "5 tickets wachten op een datum, 2 verlopen"). Je ziet ze bij Wachtrij, Kalender, Ingepland, Inventaris en Leads.
- Knoppen en tabbladen krijgen bij hover een zachte glans die invervaagt (enkel met een muis).

### Changed
- Nieuwe letters: Bricolage Grotesque voor titels en Figtree voor de rest, in plaats van Inter.
- Knoppen en kaarten springen of vergroten niet meer bij hover; ze vervagen naar een andere kleur.
- Tekst op de hemel en op de scène van een thema blijft overal leesbaar: donkerblauw glas in het donkere thema, een eigen tekstkleur voor losse tekst op de hemel, en donkere tekst op de groene (en oranje) knoppen in elk thema. Het dok is in het donkere thema dichter, zodat de tabbladen goed te lezen blijven.
- De balk met rapporten die nog niet verzonden zijn is altijd Blitz-groen met donkere tekst, ook tijdens een feestthema; fout en knoppen blijven overal leesbaar.
- Alle vensters, de rapport-wizard, Beheer, Dashboard, Sales en het inlogscherm hebben de nieuwe vormen en kleuren. De werking, de knoppen en de teksten in de knoppen blijven dezelfde.
- Op een gsm staat het zoekvak van de wachtrij op een eigen rij, zodat de hulptekst en de sorteerkeuze volledig leesbaar zijn.
- Op de computer staat de paginatitel mooi in het midden van de bovenbalk en hebben alle panelen ronde hoeken.
- De kalender springt op de gsm meteen naar vandaag en het huidige uur, en een tablet rechtop ziet eruit en werkt zoals de gsm (liggend blijft hij zoals op de computer).
- Tabbladen tonen geen cijfer meer maar een bolletje: rood als er voorraad op is, oranje als ze bijna op is, groen voor iets nieuws. Op de gsm krijgt ook 'Meer' zo'n bolletje als er achter die knop iets aandacht vraagt.

### Fixed
- Op de pc begonnen de spinnen en webben van een feestthema (Halloween) achter de zwevende balk van het tabblad in plaats van eronder. Ze beginnen weer onder de balk, ook bij de ronde balken met marge van de nieuwe stijl.

### Notes
- Snelheid gemeten op een gesimuleerd traag toestel (gsm, CPU 4× trager) tegen v2.4.0: geen enkel cijfer is 10 % of meer slechter, dus er is geen terugval nodig. Op gsm is het glas lichter (minder vervaging, hogere dekking) dan op pc en tablet.
- De rapport-PDF, de mails naar klanten en de Excel-exports zijn ongewijzigd.

## [2.4.0] — 2026-10-27

### Added
- Inventaris: per product een meldgrens in je wagenvoorraad. Onder Bewerken staat naast het belletje "meld bij ≤ …": zet je bv. 1 bij een energiemeter, dan waarschuwt de app als er nog 1 of minder in je wagen ligt. Instellen kan op pc en tablet (op de gsm zie je het belletje en de grens niet).
- Bij het opstarten van de app een korte melding "⚠ Check je voorraad" als er iets onder de grens zit.
- Na het versturen van een rapport: "⚠ Bijna op in je wagen: …" voor de gebruikte producten die onder hun grens zakten.

### Changed
- Een product dat bijna op is, staat oranje in je voorraad; een product dat op is blijft rood.
- Het cijfer op het tabblad Inventaris telt enkel nog producten onder hun grens: oranje als iets bijna op is, rood als iets op is.
- Een product meldt standaard niets meer: enkel als het belletje aanstaat. Wat je al in je wagen had, blijft zoals vroeger melden op 0; producten die je nooit meenam tellen niet meer mee.

## [2.3.1] — 2026-10-27

### Changed
- Instellingen: de schakelaar "Bewegende beelden tijdens een thema" staat nu onder "Dit toestel", vlak onder "Feestelijke versiering", zodat beide keuzes over de versiering samen staan. De keuze wordt meteen bewaard (dat tabblad heeft geen Opslaan) en blijft gelden op al je toestellen.

## [2.3.0] — 2026-10-23

### Added
- Feestthema's zijn nu pakketten die je zelf kunt beheren, zonder nieuwe release. Onder Beheer → Thema's kun je een thema uploaden, aan- of uitzetten, de periode aanpassen, een voorbeeld bekijken en het pakket downloaden.
- Negen thema's staan klaar: Nieuwjaar, Valentijn, Carnaval, Pasen, Zomer, 21 juli, Halloween, Sinterklaas en Kerst. Elk heeft een eigen achtergrond en een eigen laadpaal in Blitz Run.
- Nieuwe persoonlijke instelling "Bewegende beelden tijdens een thema": zet je ze uit, dan zie je enkel de achtergrond en de hoekbeelden.
- Tijdens een thema is de achtergrond altijd zichtbaar en zijn de ticketkaarten van glas: je ziet de achtergrond zacht doorschemeren en de tekst blijft goed leesbaar.

### Changed
- Kerst loopt nu van 7 tot 31 december; Sinterklaas loopt van 1 tot 6 december en Nieuwjaar van 1 tot 6 januari.
- Stilstaande versiering staat achter de inhoud, bewegende versiering ervoor.
- De Halloween-maan is in het donkere thema iets gedempt.
- De feesthoedjes in Blitz Run wiebelen niet meer.
- De tekstkleuren op de kaarten passen zich aan tijdens een thema, zodat alles leesbaar blijft; de kleuren van status en prioriteit (rood voor "Verlopen" en "Hoog") blijven gewoon.

### Notes
- Op een nieuw toestel verschijnt het thema pas na het inloggen.

## [2.2.0] — 2026-10-21

### Added
- Inventaris: een onderdeel dat na een rapport van de wagenvoorraad wordt afgeboekt, draagt nu het ticketnummer van dat rapport (bv. "#3979"). Je ziet het in het logboek onder "Iedereen" en in de Excel-export (nieuwe kolom "Ticket", achteraan).
- Inventaris: knop "🕘 Historiek" naast Bewerken. Die toont wat er de laatste 3 maanden met de wagenvoorraad van de gekozen persoon gebeurde (aanvullingen, correcties en verbruik met ticketnummer), zoals het logboek onder "Iedereen" maar enkel voor die persoon.

### Changed
- Inventaris: de wagenvoorraad staat per soort, in dezelfde groepen als in Prijzen (Controllers, Energiemeters, CT-klemmen, Overige componenten, Laadkabels & aansluitingen). Binnen een groep staan de onderdelen in een raster: naam en aantal staan naast elkaar en een breed scherm toont meerdere kolommen, in plaats van één brede rij met het aantal helemaal rechts.

## [2.1.6] — 2026-10-15

### Fixed
- Tablet: de keuzes van "Oorzaak storing" ontbraken in het rapport, terwijl de app "Versie 2.1.5" toonde. Bij een haperende verbinding kon de app een stuk oude code (de rapportwizard van vóór 2.1.3) uit de bewaarde kopie van een vorige versie halen en die mengen met de nieuwe versie. Dat kan niet meer: een pagina van de nieuwe versie krijgt nooit nog onderdelen van een oudere versie. Lukt het laden van een onderdeel niet, dan laadt de app zichzelf één keer opnieuw.
- Een app die lang openstaat (zoals op de tablet) kijkt bij het terugkeren naar de app geregeld of er een nieuwe versie is. Is die er, dan meldt Instellingen dat eerlijk naast het versienummer en laadt de app de nieuwe versie zodra je de app wegzet (nooit midden in een rapport of een open venster).
- De melding "nieuwe versie klaar" verschijnt enkel nog als er echt een andere versie klaarstaat.
- Een item dat op de pc uit de planning gehaald of verwijderd werd, bleef op de tablet staan. Eigen afspraken werden enkel bij het opstarten opgehaald; nu ververst de app ze elke 5 minuten, bij het terugkeren naar de app en zodra de verbinding terug is. De Zoho-planning wordt bij het terugkeren naar de app ook meteen opnieuw opgehaald in plaats van pas bij de volgende ronde. Een eigen wijziging die nog wordt opgeslagen, gaat daarbij niet verloren.
- "+" in de wachtrij en "+ Voeg toe aan planning" kiezen enkel nog een dag die echt haalbaar is: maximaal de ingestelde rijtijd (45 min) van de andere afspraken (behalve op een lege dag) en elke latere afspraak met een vast uur blijft op tijd haalbaar, zoals bij "⚡ Plan deze week". Past er de komende weken geen dag, dan zegt een melding waarom en blijft het ticket in de wachtrij; kunnen de reistijden niet opgevraagd worden, dan vraagt de app eerst bevestiging. Tijdens het zoeken toont de knop dat hij bezig is en een tweede klik plant niet dubbel (klantmelding: #3979 Oostduinkerke kwam naast #3894 Meise).

## [2.1.5] — 2026-10-14

### Fixed
- Voorkeursdatum van de klant: de knop "+" in de wachtrij en "+ Voeg toe aan planning" in het ticket keken enkel naar het voorkeursuur en zetten het ticket daarom op de eerstvolgende vrije dag (bv. vandaag om 14:00) in plaats van op de gevraagde dag. Nu komt het ticket op de voorkeursdag van de klant, of als die dag vol is op de eerste vrije dag daarna. "⚡ Plan deze week" deed dit al goed; dat is nu ook met tests vastgelegd.
- Bij het openen en afdrukken van een rapport uit het archief werden de vakken voor de handtekeningen soms in twee gesneden over twee pagina's; het hele blok Handtekeningen blijft nu bij elkaar op één pagina.

## [2.1.4] — 2026-10-14

### Changed
- Het verborgen spel staat nu netjes in het midden van het scherm, is groter en toont altijd zijn titelbalk.
- Het spel op telefoon en tablet heeft twee duidelijke knoppen onderaan in plaats van tikvlakken, zodat je niet per ongeluk bukt.
- Het verborgen spel reageert voortaan enkel op het bliksem-icoon en vraagt een vlotte reeks tikken; een kleine melding helpt onderweg.

### Fixed
- Het spelvenster stond te ver naar rechts door twee onzichtbare hulpvlakken die op een computer ruimte innamen.

## [2.1.3] — 2026-10-14

### Added
- Rapportwizard: de keuzes bij "Oorzaak storing" staan nu in een uitklapbaar overzicht met keuzeknoppen (zie ook Changed).

### Changed
- Rapportwizard, stap Omschrijving: "Oorzaak storing" heeft nu 14 keuzes in 4 groepen (Toestel, Communicatie en instellingen, Plaatsing en omgeving, Overig) in plaats van de vroegere vier. De groepen klappen open en dicht, er staat telkens maar één groep open, en in de kop van elke groep zie je hoeveel en welke keuzes je al aangeduid hebt. De keuzes zijn grote knoppen die groen worden met een vinkje. Meerdere keuzes blijven mogelijk en er blijft minstens één oorzaak verplicht.
- Oude rapporten en concepten blijven kloppen: "Productfout" en "Configuratiefout" worden nergens herschreven en blijven in het archief, het voorbeeld, de pdf en de Excel staan zoals ze waren. Opent een oud concept opnieuw, dan staat zo'n oude waarde als "(oud) Productfout" bij de keuzes; ze blijft behouden tot de technieker ze zelf weghaalt.

### Fixed
- Het spel (Blitz Run) wordt niet meer afgesneden onder de bovenbalk en het tabbladenbalkje: de kaart staat nu altijd volledig in beeld, ook na scrollen, het venster aanpassen of het toestel draaien.
- Het spel op een gsm vult nu bijna het hele scherm onder de balken. Het hele scherm is tikbaar: tik in de bovenste helft om te springen, houd in de onderste helft om te bukken (met een zachte aanduiding). Tijdens het spelen verdwijnen de keuze van de laadpaal en de uitleg, het beeld is scherper en liggend gebruikt het spel de volle breedte. Op een staande gsm staat een tip om het toestel te draaien.
- De ronde plus-knoppen in de wachtrij zijn op de tablet weer echte cirkels (en blijven minstens 44 px groot om aan te raken).
- Rapport op de tablet: het rapportvoorbeeld en het handtekeningvlak vullen nu de beschikbare hoogte van het scherm, de handtekening is veel groter en wordt scherp en op de juiste plek getekend.
- Halloween-versiering op de computer: de spin, de vleermuis, de hangende spinnen en de mist bewegen nog altijd doorlopend, maar de app tekent ze nu ongeveer 30 keer per seconde in plaats van 60 (de bewegingen blijven vloeiend). Dat spaart de processor en de grafische kaart van de pc.
- Zolang het spelletje Blitz Run open staat of de pagina op de achtergrond staat, staat de versiering stil, zodat het spel en de versiering niet tegelijk de computer bezighouden.
- De achtergrondscène staat nu als een losse, vaste laag achter de app, zodat wijzigingen elders op het scherm ze niet opnieuw laten tekenen.

## [2.1.2] — 2026-10-13

### Added
- Halloween: een spookachtige achtergrond met een boerderij en een schuur op een heuvel, een volle maan, sterren, een dode boom, een hek, vleermuizen en vogelverschrikkers in het veld, 's nachts. Ze staat vast achter alles, verdwijnt met het thema (schakelaar uit of einde van het evenement) en wordt nooit afgedrukt. Kaarten, balken en vensters blijven gewoon leesbaar; in het lichte thema is de scène slechts vaag zichtbaar.
- Tijdens Halloween staat de app standaard in het donkere thema, ook als je toestel op licht stond. Kies je tijdens het evenement zelf een thema, dan blijft die keuze tot het einde gelden; je gewone themakeuze blijft onaangeroerd en geldt weer na het evenement of met de versiering uit.

### Fixed
- Kalender: de versiering begint nu onder de werkbalk in plaats van midden in het uurrooster.
- De vleermuis vliegt wisselende, golvende banen en vlucht weg van de muis.
- De kaart van een verlopen ticket was licht doorschijnend; nu is ze ondoorzichtig, zodat de achtergrond er niet door schijnt.

## [2.1.1] — 2026-10-13

### Changed
- Het verborgen spel telt punten vier keer trager, en de skins gaan pas open na echt overleven: de eerste na ongeveer een minuut in één run, de gouden paal na zo'n vijf minuten. Wat al ontgrendeld was, blijft ontgrendeld; een eerder behaalde beste score wordt omgerekend naar de nieuwe telling.
- De bliksems in het spel zijn nu het Blitz-logo (twee schuine streken), en ook de plaat op de laadpaal toont dat logo.

### Fixed
- Bukken: de paal werd te plat en te breed getekend. Nu is het dezelfde paal, lager en breder, precies zo groot als waar hij tegen botst, met het logo-plaatje en de eventhoed mee.
- Halloween-versiering: de spinnenwebben en spinnen bovenaan zaten verstopt achter de zoekbalk (en de andere vaste balken). Ze beginnen nu net onder de vaste balk van het tabblad waar je op staat.

## [2.1.0] — 2026-10-13

### Added
- Halloween-sfeer in oktober: pompoenoranje accentkleur, spinnenwebben in de hoeken, spinnen die aan een draadje hangen of langs de tabbalk kruipen (ze lopen weg voor de muis), af en toe een vleermuis en een lichte mist onderaan. Bij een lege wachtrij of een lege week bij Ingepland staat een Halloween-tekst. De versiering ligt als doorzichtig laagje over de app: je kan er niet op klikken, ze staat onder de vensters en meldingen en onder de vaste balken bovenaan, en schermlezers slaan ze over.
- Nieuwe instelling "Feestelijke versiering" bij Instellingen, tabblad "Dit toestel". De keuze geldt per toestel en blijft bewaard. Standaard staat ze aan tijdens een feestperiode; je kan ze uitzetten, en de teksten wisselen meteen mee.
- Op gsm, tablet en aanraakschermen blijft de versiering sober: enkel stilstaande webben en de kleur. Staat "beweging verminderen" aan op het toestel, dan beweegt er ook niets. De animaties pauzeren als het tabblad verborgen is.
- De versiering verschijnt nooit op papier, in PDF-rapporten, in Excel-bestanden of in het rapportvoorbeeld, en niet in de testversie van de app.
- Een app die dagen openstaat, volgt de datum: na middernacht op 31 oktober verdwijnt de versiering vanzelf (en verschijnt ze op 1 oktober).
- Op de kaart van de Route-tab staat de startlocatie nu aangeduid met een groen vierkantje met de Blitz-bliksem, groter dan de gewone stops en erboven getekend. Keert de route terug naar de startlocatie, dan krijgt ook dat eindpunt dit icoon.
- Er zit iets verborgens voor het team in de app. Het doet niets met de planning en staat nergens aangekondigd; wie goed zoekt, vindt het misschien.

## [2.0.2] — 2026-10-12

### Fixed
- Het tabblad Rapporten kon "✕ Laden mislukt: Cannot read properties of null (reading 'id')" tonen (gemeld bij een beheerder met een gekozen technieker). Het archief tekent het overzicht én de kalender in één stap; één leeg (null) record in de wachtrij-lijst van het toestel, in de planning, in de afspraken, in de blokkeringen of in het archief zelf liet die stap falen. Alle lezers negeren nu zo'n record en tonen de rest gewoon: `planItemsVanTechnieker`, `ticketsVanTechnieker`, `eigenAfsprakenVoor` en `blokkeringenVoor` (`kern/selecties.js`), de rapportcontrole in de kalender, de "In wachtrij"-tag, het laden van het archief en `refreshOutboxCache`. Gedrag bij geldige gegevens ongewijzigd.
- Als het laden van Rapporten toch nog mislukt, stuurt de app één keer per paginalading de foutmelding met de functienamen en regelnummers (geen persoonsgegevens) naar het foutenlog (`/api/client-log`), zodat de echte bron te vinden is. In testmodus (?test) wordt er niets verstuurd.
- Een beheerder ziet in Rapporten alle rapporten, ook met een persoon gekozen in de kop; dit staat nu vast in een test.
- Nieuwe controles: `tests/selecties.test.mjs` (null-records), `tests/verklikker.test.mjs` (foutmelding naar het log) en `e2e/rapporten-null-records.spec.mjs` (Rapporten laadt met een null in de wachtrij, de planning of het archief; beheerder ziet alle rapporten).

## [2.0.1] — 2026-10-11

### Fixed
- De balken onder de tabbladen (zoeken en sorteren in de Wachtrij, de balk van Leads, de kalenderkop, de Route-werkbalk, de weekkop van Ingepland en de filterbalk van Rapporten) plakken bij het scrollen weer vlak onder de tabbalk. Bij een lange lijst schoof de kop van de app na een tijdje weg, waardoor er een strook ontstond waarin de kaarten doorschoven. Oorzaak: de pagina had een vaste hoogte ter grootte van het scherm, waardoor de kop alleen binnen die ene schermhoogte kon blijven plakken.
- Eén gedeelde regel voor alle balken: ze plakken onder kop, tabbalk en eventuele meldingsbalken (offline, verzendwachtrij), berekend uit wat echt op het scherm staat in plaats van een vaste waarde. Ook als de offline- of verzendbalk zichtbaar is, bedekt de balk ze niet meer (Wachtrij, Leads, Kalender, Route en Ingepland deden dat wel).
- Performance: de keuzelijst "Technieker" toont enkel echte Zoho-namen in plaats van wat er in het rapport getypt werd ("brent", "K.Deniz", "Brent + Deniz"…). Elk rapport hangt aan de Zoho-naam van wie het indiende, of aan de Zoho-naam die in de tekst herkend wordt; een rapport met twee techniekers telt voor beiden (in het totaal één keer); wat niet eenduidig te koppelen is, staat onder "Niet gekoppeld".
- Nieuwe controles: een test die voor elk tabblad met zo'n balk (alle rollen, computer en gsm) nagaat dat hij na scrollen vlak onder de tabbalk staat, en een bronscan die vaste top-waarden voor sticky balken weigert.

## [2.0.0] — 2026-10-11

Grote release: logins en beheer, de sales-planner, het performance-dashboard, een herschreven planner ("Plan deze week"), controle van verzonden mails, en een onderhoudbaardere interne structuur. De opgeslagen gegevens (rapporten, afspraken, instellingen) blijven gewoon bruikbaar. Techniekers openen de app na de update één keer op wifi; de service worker (`CACHE_NAME` `blitz-planning-v28`) haalt dan de nieuwe versie op.

### Fixed
- Acceptatietest (proefronde 2): wisselen van persoon bewaart niet langer per ongeluk de kaartstijl als instelling (gaf een technieker 403); sales-bezoeken tonen hun echte duur in de kalender; een nieuwe blokkering start op een werkdag en verwijderen vraagt bevestiging; de verkoperslijst ververst vanzelf; "Resultaat bewaard" blijft zichtbaar.
- Route: vindt TomTom met een vertrektijd geen route (NO_ROUTE_FOUND), dan wordt één keer opnieuw gerekend zonder vertrektijd, met de melding "verkeer niet beschikbaar voor dat tijdstip", in plaats van een foutmelding.
- Sales-planning rekent met een kleine veiligheidsmarge op de reistijd (+10 % en +2 min), zodat "Plan deze week" en de routecontrole niet meer van mening verschillen; de waarschuwing noemt het betrokken bezoek.
- In het weekend opent de app (service en sales) op de komende werkweek in plaats van de voorbije; een lege week toont hoeveel tickets in een andere week ingepland staan, met een sprongknop.
- "Plan deze week" laat geen bezoeken meer liggen omdat één ver bezoek een lege dag opende: zo'n dag wordt opnieuw ingedeeld als daardoor meer bezoeken passen (zonder dat een dringender ticket moet wijken; vaste en bevestigde afspraken schuiven nooit). Ligt een bezoek echt te ver, dan zegt de melding "Te ver van de andere afspraken" in plaats van "Geen plaats meer deze week".
- De kortste bezoekduur is overal 15 minuten (instellingen van de verkoper en van de beheerder, en op de server).
- Op de leadkaarten zijn telefoon en e-mail enkel nog aanklikbaar op de tekst zelf; klikken ernaast opent de lead.
- ⚙ opent altijd je eigen instellingen, ook als je de week van een collega bekijkt; een andere achtergrondkaart kiezen bewaart je eigen keuze, nooit bij de collega.
- Een technieker met "Mag zelf plannen" ziet bij de week van een collega geen "Plan deze week", "Optimaliseer" of "Leeg" meer (die deden al niets).
- Activiteitenlog: de kolommen staan over alle dagen netjes onder elkaar, en bij Onderwerp staat de naam van de gebruiker in plaats van een code. Beschikbaarheden heeft dezelfde opmaak als de andere Beheer-tabs.
- Bij het opstarten flitst de verkeerde schil (bv. technieker-tabs voor een verkoper) niet meer even op.
- Proefperiode op de Deploy Preview: `/api/tickets`, `/api/route` en de andere event-functies (plan, propose, comment, rapport, send-rapport, optimize, matrix, drukte, setup) gaven voor elke ingelogde gebruiker 503 "opslag niet bereikbaar". Oorzaak: deze functies draaiden als Lambda-compat (v1); daar levert `connectLambda(event)` een Blobs-omgeving zonder `uncachedEdgeURL`, waardoor elke lezing met `consistency: 'strong'` (de loginlaag leest zo de gebruikers) faalde. Alle elf draaien nu als v2-functie via een kleine adapter (`netlify/lib/v2-adapter.js`, `export default alsV2(beveiligV1(...))`), zodat ze de volledige Blobs-omgeving krijgen; hun bedrijfslogica is ongewijzigd en `netlify/lib/blobs-context.js` is verdwenen. `planning-export` blijft een gewone event-functie (raakt geen Blobs). De persoonskiezer wordt bovendien bij het opstarten en na een mislukte ticketlading opgebouwd, zodat hij nooit leeg blijft.

### Added
- **Inloggen** met e-mailadres en wachtwoord voor vier rollen: beheerder, planner, technieker en sales. Het eerste beheerdersaccount maak je met een tijdelijke setupcode (`BEHEER_SETUP_CODE`); de beheerder krijgt daarbij tien eenmalige herstelcodes. Een sessie duurt 30 dagen; na vijf foute pogingen volgt een tijdelijke vergrendeling. Een beheerder die zijn wachtwoord vergeet herstelt het met een herstelcode, of met de noodsleutel `BEHEER_HERSTELSLEUTEL` (eenmalig, instelbaar in Netlify).
- **Beheer voor planner en sales manager**: een planner ziet in Beheer enkel Instellingen (techniekers) en Performance (techniekers-deel); een sales manager (vroeger "Mag alle sales zien") enkel Instellingen (verkopers) en Performance (sales-deel). De server geeft elke rol enkel zijn deel; e-mailadressen ziet enkel de beheerder.
- **Beschikbaarheden voor iedereen**: "Voor wie" toont alle actieve medewerkers in twee groepen (Techniek, Sales) met hun rol. Verlof voor een verkoper wordt een geblokkeerde dag in zijn sales-agenda, zodat "Plan deze week" die dag overslaat; bij Iedereen zie je ook het verlof van de verkopers.
- **Beschikbaarheden**: één keuzelijst "Voor wie" (Iedereen of een technieker) met enkel actieve accounts met een Zoho-naam.
- **Beschikbaarheden** (afwezigheden van techniekers) staan voortaan in Beheer, voor beheerder en planner, met een eigen keuze van technieker; ze zijn uit het ⚙-venster gehaald.
- **Eén persoonskiezer bovenaan voor iedereen**: een technieker en een planner zien enkel techniekers, een sales manager enkel verkopers, een gewone verkoper geen kiezer; de beheerder ziet iedereen in twee groepen met de rol achter de naam. De aparte tab "Sales" van de beheerder is weg: kiest hij een verkoper, dan schakelt de app naar diens sales-schermen ("↩ Terug naar techniekers" in het menu).
- **Eén werkbalk per scherm**, bij techniekers en sales gelijk (Route, Kalender, Wachtrij, Leads); op Route kies je de datum via 📅. ⚙ en ↺ staan voor sales nu ook in de kop.
- **Geen Route meer op een gsm** (voor niemand); de kalender is daar het dagoverzicht, ook voor verkopers (📞 Bellen, 🧭 Navigeer, 📋 Resultaat, nu-lijn).
- **Laadschermen**: bij trage schermen (Wachtrij, Beheer, sales) verschijnt een skelet in de vorm van de inhoud in plaats van een leeg vlak of "Laden…".
- **Sales-route zoals bij de techniekers**: dezelfde werkbalk met ⚡ Optimaliseer (kortste volgorde; vaste en bevestigde bezoeken blijven op hun uur), Bereken tijden en ✕ Leeg (niet-bevestigde bezoeken terug naar Nog in te plannen), compacte stopkaarten en een grotere kaart.
- **Route (technieker en sales)**: de lijst links scrollt los van de kaart; de kaart heeft afgeronde hoeken.
- **Routekleur** kies je uit acht vaste kleuren in plaats van met de kleurkiezer van de browser.
- **Gebruiker verwijderen**: de beheerder kan een geblokkeerde gebruiker definitief verwijderen (naam overtikken ter bevestiging; nooit jezelf of de laatste beheerder). Zijn instellingen verdwijnen mee, bij een verkoper ook zijn leads en planning; rapporten, archief, Zoho en het activiteitenlog blijven. De verwijdering staat in het log.
- **Inloggen**: vinkje "Onthoud mij" (bewaart enkel het e-mailadres op dit toestel, nooit het wachtwoord) en een oogje om het wachtwoord te tonen, op elk wachtwoordveld.
- **Sales**: dezelfde kaartvarianten als bij de techniekers (per verkoper onthouden); een kruisje op kaarten in Ingepland en Bevestigd zet de lead terug bij Nog in te plannen (bij Bevestigd na bevestiging).
- **Beheerder voegt leads toe**: in de tab Sales kan de beheerder met "+ Lead" een lead toevoegen voor de gekozen verkoper (staat in het activiteitenlog). Het inladen van een export blijft voor de verkoper zelf.
- **Beheerpagina** (enkel voor de beheerder) met tabs Gebruikers (aanmaken, bewerken, blokkeren, startwachtwoord opnieuw instellen, overal uitloggen), Instellingen, Activiteitenlog, Systeemstatus (Zoho-verbinding, laatste fouten en mislukte rapporten, met een knop "Opnieuw versturen" bij elk mislukt rapport; de actie staat als `rapport-opnieuw` in het log) en Performance.
- **Instellingen centraal op de server**, per gebruiker, zodat ze de gebruiker naar elk toestel volgen. De app wacht er hooguit ongeveer 7 seconden op en start daarna met de lokale kopie; bij afmelden met nog niet gesynchroniseerde instellingen vraagt ze eerst bevestiging. Een planner past de instellingen van techniekers aan, de beheerder alle instellingen; sales en technieker enkel hun eigen. Elke wijziging van andermans instellingen staat in het log.
- Vinkje **Mag zelf plannen** bij een technieker (Beheer, Gebruikers; enkel de beheerder kan het zetten, gelogd als gebruiker-gewijzigd). Zo'n technieker ziet ook de Wachtrij en de Route, plant, verzet en annuleert zijn EIGEN tickets, stuurt voorstellen en gebruikt "Plan deze week" voor zichzelf; collega's blijven alleen-lezen en "Alle technici" ontbreekt in zijn kiezer. De server dwingt het af: `plan`, `plan-datum`, `propose`, `annuleer`, `voorstel-status` en `klantbeschikbaarheid` laten hem enkel door (rechtentabel: `planEigen`) en vragen aan Zoho of het ticket van hem is (`netlify/lib/eigen-ticket.js`); een collega-ticket geeft 403, een Zoho-storing 503, een testverzoek raakt Zoho nooit. Alleen tickets die al in de planningsflow zitten zijn te plannen (Service in te plannen, Wachten op planning, Wachten op bevestiging planning; voor enkel de datum ook Geplande service/support); een gesloten of afgewerkt ticket heropenen geeft 409. Klantbeschikbaarheid bewaren mislukt niet als zijn lijst ook tickets van collega's of gesloten tickets raakt: de server bewaart wat hij mag en negeert de rest per ticket. Zonder het vinkje verandert er niets.
- Beheer, Gebruikers: de **Zoho-naam kiezen uit een lijst** met de actieve Zoho-gebruikers (nieuw, enkel lezen endpoint `/api/zoho-agenten`, enkel voor de beheerder; 10 minuten onthouden; een testverzoek roept Zoho nooit aan). Namen die al bij een ander account horen zijn niet te kiezen, "— geen —" ontkoppelt en "Andere naam…" laat een uitzondering toe. Bij een Zoho-storing blijft het een vrij tekstveld met de namen uit de tickets als suggestie.
- Elk account behalve sales kan een **Zoho-naam** krijgen (Beheer, Gebruikers). Een beheerder of planner met een Zoho-naam is bovenop zijn eigen rechten ook technieker voor zijn eigen werk: hij start op zijn eigen naam in de persoonskiezer, staat altijd in de lijst (ook zonder tickets), krijgt de melding bij een mislukt eigen rapport en een filter "Mijn rapporten". Een Zoho-naam hoort bij één account: een dubbele naam wordt geweigerd (409, ook zonder verschil in hoofdletters of spaties). Bij een rolwijziging blijft de naam staan (enkel sales verliest hem).
- Een technieker ziet de tab Rapporten met enkel zijn eigen rapporten, op elk toestel.
- **Activiteitenlog**: foto-, notitie- en rapportacties, inloggen, mislukte pogingen en alle beheerwijzigingen staan met naam en tijdstip in het log (12 maanden bewaard, daarna automatisch opgeruimd). Een rapport dat een technieker onder de naam van een collega indient wordt aanvaard en gelogd (`rapport-verstuurd` met vlag); elk rapport bewaart wie het indiende (`ingediendDoor`). Een rapport met een id dat bij andermans rapport hoort wordt geweigerd (403), gelogd als `rapport-geweigerd` en blijft in de outbox met de melding dat de planner verwittigd moet worden.
- De achtergrondfunctie `rapport-verwerk-background` (upload-fix v1.10.2) is beschermd met een interne sleutel (header `X-Blitz-Intern`, afgeleid van `SESSIE_GEHEIM`), omdat achtergrondfuncties via hun URL bereikbaar zijn.
- Een toestel onthoudt van wie de lokale gegevens zijn (eigenaarsmarker); bij een andere gebruiker op hetzelfde toestel worden de persoonlijke gegevens vervangen, maar onverzonden rapporten in de outbox blijven altijd bewaard. De verbruikswachtrij (wagenvoorraad) is per gebruiker.
- **Performance-dashboard** (enkel beheerder, tab "Performance"): een filterrij (deze maand, vorige maand, dit kwartaal, dit jaar of eigen periode; technieker, type en herhaalbezoek binnen 30 of 90 dagen), zes kerncijfer-tegels met het verschil met de vorige periode en vijf blokken: Tijd & stiptheid, Kwaliteit, Onderdelen, Klant & planning en Sales. De cijfers komen uit de nieuwe functie `/api/dashboard` (anderen krijgen 403); onder elk blok staat een voetnoot met de dekking (op basis van hoeveel rapporten, welke bronnen niet gelezen konden worden, sinds wanneer annulaties geteld worden).
  - Ringen met instelbare kleurgrenzen (groen, oranje of rood) voor % op tijd, first-time-fix, bevestigd via de knop, garantie en "installateur al langs geweest"; de beheerder stelt de grenzen zelf in en bewaart ze (met versiecontrole). Standaard: op tijd 90 en 75, first-time-fix 80 en 65, de rest zonder kleur. Naast de kleur staan altijd een icoon, een woord en het getal.
  - "Op tijd" in drie categorieën: te vroeg, op tijd en te laat (aankomst tegenover het geplande tijdslot).
  - Nieuwe velden in de rapporten, vanaf de livegang: `geplandTijdslot`, `partner`, `regio` en `installateurAlLangsGeweest` (uit Zoho `cf_installateur_al_langs_geweest`, zonder nieuwe rapportvraag). Oudere rapporten tellen in die cijfers niet mee.
  - Jaar-archief `rapportlijst-archief-<jaar>`: een rapport dat uit de lijst van de nieuwste 500 valt, wordt eerst in het archief van zijn jaar bewaard (append-only, ontdubbeld op id), zodat het dashboard ook over lange periodes kan rekenen. De rapportenlijst zelf (`/api/rapport-archief`) en het verwijderen uit de lijst blijven ongewijzigd.
- **Sales-planner**: een verkoper (rol sales) plant zijn eigen bezoeken in dezelfde app, apart van de technieken. Het gaat om nieuwe verkoop-leads, niet om tickets: geen koppeling met Zoho, geen stock en geen mails.
  - *Leads binnenhalen.* De verkoper laadt het exportbestand van zijn leadlijst (.json). Dezelfde klant komt nooit dubbel in de lijst: bij een nieuwe export worden bestaande leads aangevuld, en wat de verkoper zelf toevoegde (adres, notities, vast uur) wordt nooit overschreven. Een weggeklikte lead die in een latere export terugkomt, krijgt het label "eerder verwijderd"; hij beslist zelf. Hij kan ook zelf een lead toevoegen (minstens naam, gsm of e-mail en postcode, met een notitieveld).
  - *Adres.* Een lead met enkel een postcode wordt op het middelpunt van die postcode gezet ("ongeveer"); met een volledig adres wordt hij exact gezocht. Een adres dat niet gevonden wordt, komt in de lijst als "adres nakijken".
  - *Plannen.* De tab **Leads** toont de leads in drie kolommen naast elkaar: Nog in te plannen (langst wachtende eerst, ook een verlopen voorstel), Ingepland (voorgesteld, op datum en uur, met een knop Bevestigen) en Bevestigd (op datum en uur), elk met zijn aantal; op een telefoon zijn het drie tabbladen met aantal. Er is zoeken en een filter op postcodegebied; verwijderen kan met 5 seconden om het ongedaan te maken. In de Kalender (week en maand) zet "Plan deze week" de leads voor, met hetzelfde planner-brein als de techniekerplanning (reistijd, werkuren, laatste start, maximaal per dag). Het resultaat staat in hetzelfde venster als bij de technieker ("⚡ Planningsresultaat" met Ingepland, Niet ingepland en de reden per bezoek, ⚠-waarschuwingen en ✕ om te sluiten; venster en zinnen zijn gedeeld, enkel het woord "bezoek" i.p.v. "ticket" verschilt). Een bezoek kan op een vast uur gezet worden, en blokken (verlof, kantoor of een eigen afspraak, ook een hele dag) houden tijd vrij. Een voorgesteld bezoek (lichte kleur) kan bevestigd worden; een bevestigd of vast bezoek verschuift nooit vanzelf.
  - *Route.* De tab Route werkt zoals bij de technieker. Bovenaan staat dezelfde weekstrook: de werkdagen van de gekozen week (volgens de werkdagen in de instellingen) met het aantal bezoeken en of ze bevestigd zijn ("✓ bevestigd") of nog bevestigd moeten worden ("☎ bevestigen"); een dag aanklikken kiest die dag (dezelfde als in de Kalender), ‹ › springen een week en de pijltjestoetsen lopen langs de dagen. De kaart toont de bezoeken van de dag met de rit van stop tot stop: de TomTom-lijn in de routekleur (instelling, standaard amber), de verwachte drukte per wegvak (rood, oranje, geel; voor een toekomstige dag via `/api/drukte`), wegenwerken (paars gestippeld), wegafsluitingen met de waarschuwing "⚠ wegafsluiting op de route" en dezelfde legende. De vertraging staat in de samenvatting ("vertraging +12min", of "(verwacht)" op een toekomstige dag). Ook in testmodus (de demo) vraagt de verkoper route, drukte en reistijden bij TomTom op; de demo-leads krijgen daarvoor echte Limburgse coördinaten. Mislukt de route, dan blijft de geschatte, gestippelde lijn met "Rit geschat". Er is een waarschuwing als een bezoek het volgende niet meer haalt en de vertrekwaarschuwing voor het eerste bezoek. De weekstrook en de tekening van de route zijn gedeeld met de technieker, wiens Route-tab niet wijzigt.
  - *Resultaat.* Na het bezoek legt de verkoper het resultaat vast (offerte, verkocht, geen interesse of opnieuw langsgaan, met notitie); de lead staat dan onder Afgewerkt, behalve bij "opnieuw langsgaan": die komt terug in de lijst. Elke lead, elk blok en de sporen van weggeklikte leads worden 12 maanden na de laatste activiteit automatisch opgeruimd (ook bij geblokkeerde verkopers en in de testopslag); een lead die dan opnieuw in een export staat, komt als gewone nieuwe lead terug. Een voorstel waarvan de dag voorbij is zonder bevestiging telt weer als te plannen ("voorstel verlopen").
  - *Eigen instellingen.* De verkoper stelt startadres (of enkel een postcode), werkuren, laatste start en standaard bezoekduur zelf in. Zonder instellingen: maandag tot vrijdag 08:00 tot 17:00, laatste start 16:00, bezoek 60 minuten, geen startpunt. Lukt het laden van de instellingen niet, dan toont het venster een melding (er wordt niets overschreven) en plant "Plan deze week" niet.
  - *Wie ziet wat.* Een verkoper ziet enkel zijn eigen leads. Heeft hij "mag alle sales zien", dan kiest hij een collega en ziet diens leads alleen-lezen. De beheerder krijgt één tab "Sales" met dezelfde verkoperkeuze, mag schrijven maar geen export laden, en kan de leads van een geblokkeerde verkoper nog bekijken. Planner en technieker zien niets van sales; de server weigert hun verzoeken.
  - *Privacy.* Alles staat in een eigen opslagplek per verkoper. Verwijderen is echt verwijderen; van een weggeklikte lead blijft enkel een niet-terug te herleiden code over (12 maanden). In het activiteitenlog staan geen namen, nummers of notities van klanten.
  - *Nieuw op de server:* `/api/sales` (leads en blokken, met versiecontrole), `/api/sales-import`, `/api/postcode` (postcode naar plaats en middelpunt, met cache) en een dagelijkse opruiming (`sales-opruimen`).
- **Mailcontrole**: na een onzeker resultaat bij het versturen van een voorstel, een rapport of een annulatie (time-out, geen verbinding, 502/503/504) controleert de app vanzelf in Zoho of de mail al vertrokken is (nieuw endpoint `/api/mail-check`, enkel lezen). Ze meldt "Mail is verzonden om hh:mm" (niets opnieuw doen), "Mail is niet verzonden — je kan veilig opnieuw versturen", of, als de controle zelf mislukt, "De klant kan al gemaild zijn — kijk dit na in Zoho voor je opnieuw verstuurt". Tijdens de controle blijft de verzendknop (of het annuleervenster) op slot, zodat er nooit vanzelf een tweede mail vertrekt. "Niet verzonden" wordt pas gemeld na een tweede controle, 30 seconden na het versturen (de server werkt tot 26 seconden door). De controle gebruikt de klok van de server, zodat een afwijkende tabletklok geen vals "niet verzonden" geeft. Is er bij een rapport een mail gedetecteerd, dan vraagt de app bij een volgende verzending eerst: "Er is om hh:mm al een mail naar de klant gedetecteerd. Toch opnieuw versturen?". Bij een onleesbaar adres of een niet-verzonden status (concept, mislukt) meldt de app nooit "niet verzonden", maar de waarschuwing om in Zoho na te kijken.
- **"In planning sinds"** in het ticketdetail: sinds wanneer een ticket in het planningstraject zit (opgezocht in de Zoho-statusgeschiedenis via `/api/planning-sinds`, en onthouden, zodat Zoho maar één keer per ticket gevraagd wordt).
- Instelling **"Laatste start"** (standaard 16:00, één waarde voor iedereen): na dat uur plant "Plan deze week" geen nieuw ticket meer in.
- Het resultaatvenster van "Plan deze week" toont per niet-gepland ticket de reden (geen plaats, te ver, klant niet beschikbaar, voorkeursdag vol of te ver, voorkeursuur botst, adres niet gevonden, Zoho-fout) en waarschuwt als reistijden geschat moesten worden.
- Twee extra testrobots: één die de app draait zoals in productie (zonder testmodus) tegen een volledig nagebootste backend, en één met een echte service worker (offline starten, traag netwerk, updatepad vanaf de live-versie 1.10.3) met een eigen vangnet dat ook het verkeer van de service worker bewaakt.

### Changed
- **Rechten op de server**: elke actie wordt op rol gecontroleerd (rechtentabel in `netlify/lib/rechten.js`, met een test die dwingt dat elke functie een rij heeft). Zonder geldige sessie geeft elke beveiligde functie 401, ook de drie uploadfuncties (`rapport-ontvangen`, `rapport-verwerk-background`, `rapport-vangnet`).
- Een technieker ziet de tickets en afspraken van collega's alleen-lezen: de knoppen Aankomst, Foto's en Rapport verschijnen enkel bij eigen werk (planner en beheerder altijd). De server blokkeert dit voor vijf ticketfuncties niet (besluit klant 2026-10-08), maar elke schrijfactie staat met naam in het log. Een technieker ziet de startlocatie (vaak een thuisadres) van collega's niet meer in het instellingenoverzicht.
- Kop: de persoonskiezer is een benoemde knop ("Planning: Tim ▾", op een gsm enkel icoon en naam) zonder rondje met initialen; het rondje met initialen is voorbehouden aan het gebruikersmenu (account, uitloggen). Het item "Beheer" in dat menu is weg: Beheer is de tab. De persoonskiezer toont "Alle technici" altijd aan wie mag plannen (beheerder, planner), ook op een gsm of tablet.
- De werkinstellingen per persoon (startlocatie, duur, werkuren, laatste start, ...) bewerkt de beheerder enkel nog in Beheer → Instellingen; het ⚙-venster toont ze alleen-lezen met de knop "Aanpassen in Beheer → Instellingen" (routekleur en drukte blijven daar bewerkbaar). De planner (geen Beheer-tab) bewerkt de werkinstellingen van technici nog in ⚙. Een opslag in Beheer voor een technieker ververst ook diens lokale kopie. Het label van "Laatste start" klopt in beide schermen (waarde van de gebruiker zelf, geldt voor al zijn planning).
- De keuze "Rol op dit toestel" (Instellingen → Dit toestel) en de eenmalige tablet-vraag "Wie gebruikt deze tablet?" zijn weggehaald; enkel de weergave (automatisch/gsm/tablet/computer) blijft. Het account bepaalt de weergave op elk toestel (beheerder/planner: volledige coördinatorweergave; eerder kregen zij op een gsm of tablet stil de techniekerweergave). "Annuleren" heet "Sluiten" op de tabs zonder iets om op te slaan.
- De knop "Route berekenen" in de kalender heet "Route bekijken" (hij opent enkel de tab Route); de sales-kalender heeft één ingang voor een blok (➕ Blok); de tabbalk op een gsm past voor de technieker en toont scrollschaduwen bij veel tabs; vijf dialogen gebruiken dezelfde knopstijl.
- Het loginscherm komt over de app heen bij een verlopen sessie; de app blijft staan en de onderbroken actie wordt na het inloggen één keer herhaald.
- Opstart met een bewaarde sessie wacht hooguit ongeveer 5 seconden op de server en start daarna uit de bewaarde gegevens; een serverfout (5xx) of een inlogpagina van een klant-wifi stopt de app niet meer. De instellingensynchronisatie krijgt het resterende deel van ongeveer 8 seconden totaal.
- Op het toestel van een planner of beheerder gaan lokaal bewaarde instellingen van een technieker eenmalig naar de server als de server er nog niets van heeft; heeft de server al waarden, dan wint de server.
- Elke verwijdering van een rapport uit het archief staat als `rapport-verwijderd` (met ticketnummer) in het log; een herhaald geweigerd rapport wordt per gebruiker en id maar één keer gelogd. De lokale proefserver luistert enkel nog op 127.0.0.1.
- **"Plan deze week"** is herschreven als apart, getest onderdeel (`public/js/planner.js`):
  - werkt enkel met een gekozen technieker (bij "Iedereen" een melding) en plant enkel in de bekeken week; alleen een ticket met een latere voorkeursdatum krijgt die dag;
  - voorrang = prioriteit + wachttijd (+0,5 per week in planning, max +1,5 na 3 weken); dringende en lang wachtende tickets krijgen eerst een lege dag;
  - rekent de dag uur per uur af: eigen afspraken, blokkeringen en voorkeursuren tellen als bezette tijd, en de rit vanaf het depot telt mee;
  - tussen opeenvolgende stops nooit meer dan de maximale reistijd (45 min), ook richting een vaste afspraak later op de dag, en elke stop moet die afspraak op tijd kunnen halen;
  - tickets met een voorkeursdag worden eerst op die dag gezet; botsen twee voorkeursdagen qua afstand, dan wordt het tweede gemeld in plaats van ingepland;
  - valt TomTom uit, dan wordt de reistijd geschat uit de afstand (met melding) in plaats van de controle over te slaan.
- De Kalender, de Route-tab en Ingepland tonen dezelfde week: kies je in één tab een andere week of dag (met ‹ ›, de datumkiezer of de weekstrook), dan staan de andere tabs er ook op, en "Vandaag" zet ze allemaal terug. De maandweergave toont de maand van de gekozen dag; "Plan deze week" plant altijd de week van de gekozen dag (in de maandweergave met een melding). Na het herladen staat alles weer op vandaag.
- Voorstel versturen: de route-lijst volgt daarna de gekozen datum in de Route-tab in plaats van de datum van het voorstel. De route-lijst ververst nu zelf bij elke wijziging in de planning, en de stops van een dag worden op één plaats bepaald (was zes kopieën).
- **Trage verbinding en offline**: de app wacht nog maximaal 4 seconden op de nieuwste versie van de pagina en start daarna uit de bewaarde kopie op het toestel (maximaal één versie oud); eerder bleef ze onbeperkt wachten. Haalt de app zijn pagina uit de bewaarde kopie, dan komen alle onderdelen van die start ook uit die kopie, zodat er geen mengeling van oude en nieuwe versie kan ontstaan. De service worker bewaart ook Leaflet, de handtekeningbibliotheek, de Excel-bibliotheek en de pictogrammen van de kaart, zodat de kaart ook zonder verbinding werkt; hij bewaart enkel volledige antwoorden, geeft zijn voorbereiding op externe bibliotheken een tijdlimiet en laat `/.netlify/`-paden met rust. Bij een update haalt hij bibliotheken die al op het toestel staan niet opnieuw op.
- **Sneller opstarten**: de app laadt haar onderdelen vooraf parallel, het Excel-onderdeel (`excel-export.js`, 258 kB) wordt pas bij de eerste export opgehaald (de verbinding naar de Excel-server wordt niet vooraf opgebouwd) en de service worker wordt pas geregistreerd nadat de pagina volledig geladen is.
- Foutmeldingen bij verbindingsproblemen zijn gewoon Nederlands: "Geen verbinding met de server", "De server antwoordt niet (time-out na 20 s)" en "Serverfout (HTTP 502)". De rapportwizard en de wachtrij voor verzonden rapporten blijven ongewijzigd.
- **Interne herbouw** (voor jou ziet alles er hetzelfde uit en werkt het hetzelfde): ticketdetail, afspraakvoorstel, annuleervenster, kalender, wachtrij, de lijst Ingepland, Route-tab en kaart, klantbeschikbaarheid, blokkeringen, eigen afspraken, instellingen, foto's, rapport verzenden, inplannen en de opstart staan nu in eigen onderdelen; gedeelde fundamenten in `public/js/kern/` (tijd, selecties, toestand met automatisch hertekenen, api, ui); aankomsttijden worden op één plaats berekend; de serverkant heeft gedeelde `netlify/lib/zoho.js` en `http.js` (14 functies overgezet, identiek gedrag, nieuwe tests).

### Fixed
- Tijdvelden en datumvelden openen op Android de klok of kalender bij een tik op het veld zelf, niet enkel op het klokje.
- **Voorstel versturen**: de registratie dat een voorstelmail verstuurd is (het vinkje en het slotje in de planning) gaat niet meer verloren als twee mensen tegelijk werken: de app leest de nieuwste stand in, probeert opnieuw en meldt duidelijk als bewaren toch niet lukt ("NIET opnieuw versturen, herlaad eerst de pagina"). Is de mail al vertrokken maar kon Zoho het ticket daarna niet bijwerken (status en datum), dan krijgt de planner een duidelijke waarschuwing met wie de mail kreeg en wie niet, en de opdracht om status en datum in Zoho zelf recht te zetten (bewust geen knop "ticket alsnog bijwerken", besluit klant). Is de mail maar naar een deel van de ontvangers vertrokken, dan blijft de verzendknop dicht met de melding om de ontbrekende mail in Zoho zelf te sturen.
- **Voorstel en rapport na een onzeker resultaat**: vindt de app de mail terug in Zoho, dan vinkt ze het voorstel of rapport zelf aan als verzonden, per ontvanger; bij een deel van de ontvangers wordt enkel dat deel aangevinkt en blijft de waarschuwing staan. Lukt het aanvinken niet, dan zegt de melding het. De bevestigingsvraag bij opnieuw versturen blijft bestaan en de knop blijft dicht tot de registratie klaar is, zodat er geen dubbele klantmail kan vertrekken.
- **Rapport versturen**: na een duidelijke serverfout is de verzendknop weer bruikbaar, ook bij "geen e-mailadres". Is het antwoord onduidelijk (afgekapt, onleesbaar of een foutstatus zonder eigen foutmelding, bv. een time-out van Netlify), dan controleert de app eerst in Zoho of de mail vertrokken is; kan ze dat niet beoordelen, dan blijft de knop dicht met de melding om in Zoho na te kijken of de pagina te herladen. Er komt één melding met het resultaat, ook als er meerdere dingen misliepen (niet opgeslagen status, geweigerde ontvangers, ticketstatus in Zoho niet gezet).
- **Mailcontrole en slaapstand**: viel het toestel kort na het verzenden in slaapstand, dan telde de app die tijd niet mee en kon ze vals melden dat de mail "niet verzonden" was, met een dubbele klantmail tot gevolg. De slaapstand telt nu mee.
- Rapportwizard, stap Facturatie: kon de aanrijtijd niet berekend worden, dan staat er een duidelijke melding met een invoerveld; de technieker moet een waarde invullen (0 mag) voor hij verder kan. De aanrijtijd wordt nooit meer stil 0, ook niet via een omweg (Installatie wijzigen naar Interventie, of een bewaard concept hervatten).
- Wagenvoorraad: lukt het aftrekken van het gebruikte materiaal niet na een verzonden rapport, dan krijgt de technieker een melding. Is het zeker dat er niets is afgetrokken, dan probeert de app het later vanzelf opnieuw (bij het starten, zodra de verbinding terug is en bij elke verversing); eerder ging zo'n aftrek stilletjes verloren. Is het onzeker (bv. een time-out), dan probeert ze het bewust niet opnieuw, zodat er nooit dubbel wordt afgetrokken; de melding vraagt dan de voorraad te controleren. Ook met twee geopende vensters verwerkt maar één ervan de wachtrij.
- **Plannen na de werkuren**: een ticket kwam soms na de werkuren terecht op een dag die al vol zat (zowel via het plusje als via "Plan deze week"), en de Route-tab zette het dan achteraan. Nu rekenen het plusje, "Plan deze week" en de Route-tab met dezelfde regel: een nieuw ticket komt op de eerste dag waar het echt past, rekening houdend met afspraken (met en zonder vast uur), eigen afspraken, blokkeringen, feestdagen en 30 minuten reistijd per rit. De aankomst is hoogstens het "laatste startuur" (standaard 16:00). Zit de hele week vol, dan schuift het door naar de eerste dag met vrije tijd in de volgende week. Er gaat nog steeds alleen de dag naar Zoho, geen uur. De Route-tab toont tickets zonder uur op de plek waar ze volgens deze regel vallen en waarschuwt bij een stop die de klant niet meer vóór het laatste startuur bereikt. De kop van een dagkolom ("n/cap") toont het aantal tickets dat er echt nog bij kan (een lege dag: 0/4). Het plusje plant vandaag nooit een aankomst vóór het huidige uur.
- Vastleggen van tijden, slepen of optimaliseren in de Route-tab dat een ticket na het laatste startuur zou laten starten, vraagt eerst bevestiging met de lijst van de late tickets; bij Terug wordt er niets bewaard. De rode waarschuwing blijft zichtbaar bij een vast uur na het laatste startuur, en de vertrektijd volgt de eerste stop in de werkelijke volgorde.
- "Toewijzen" stelt het eerste vrije uur van de gekozen dag voor in plaats van altijd 09:00 (zonder overlap met vaste stops en blokkeringen, afgerond op een kwartier, gelijk aan wat het plusje kiest). Een voorkeursuur van de klant gaat voor; op een feestdag of bij een blokkering van de hele dag blijft 09:00 het voorstel. Wijzig je de datum, dan volgt het uur mee, tenzij je het uur zelf aanpaste.
- **Route-tab**: een nieuwe eigen afspraak met adres en een ticket dat je via "Toewijzen" plant staan nu meteen in de route (voorheen pas na "Bereken tijden"; de app rekent nu bij het openen van de Route-tab opnieuw en zet de route op "verouderd" als je een afspraak maakt terwijl de tab openstaat). Na een mislukte "uit planning halen" verschijnt de teruggezette stop weer in de route. Na een mislukte opslag van de routevolgorde blijft de foutmelding zichtbaar.
- Afspraken: een eigen afspraak zonder adres toont de notitie als "Notitie" en niet meer op de plaats van het adres ("Navigeer" blijft beschikbaar); een afspraak zonder uur staat als chip "Zonder uur" in de dagkop. Afspraken opslaan bij een gelijktijdige wijziging door een collega: de eigen wijziging gaat niet meer verloren maar wordt samengevoegd met de nieuwe stand.
- Beschikbaarheid: een blokkering zonder datum, of een periode over meerdere werkdagen zonder einddatum, wordt niet meer bewaard maar geeft een melding; in het blokkeringsvenster laat een andere datum kiezen de getoonde dag niet meer verspringen. De tab Beschikbaarheden loopt niet meer vast als in de instellingen geen enkele werkdag is aangevinkt. De klantvoorkeur-labels in de wachtrij verschijnen ook als de klantbeschikbaarheid later binnenkomt dan de wachtrij.
- Rapportwizard: de keuzerijen (Type, Oorzaak storing, ...) lopen op een gsm niet meer buiten beeld (ze gaan naar een volgende regel).
- Kalender: de ✕ op een afspraak wist niet meer in één tik. Er komt eerst een bevestiging ("Afspraak '…' verwijderen?"); de ✕ staat enkel bij wie mag wissen (planner, beheerder, of de technieker bij zijn eigen afspraak), is op een aanraakscherm 44 px groot, en "🗑 Verwijderen" in het detail volgt dezelfde regel.
- Sales, tab Route: de twee datumnavigaties boven elkaar zijn één datumveld met de weekstrook geworden (met ‹ › voor de week).
- Instellingen: een weekdag aanklikken en dan Annuleren (of Esc, of buiten het venster klikken) houdt de wijziging niet meer vast; weekdagen gelden pas na Opslaan. Prijsbeheer: na "+ Onderdeel" staat de cursor in het nieuwe veld. Blokkeringsvenster: de cursor en de selectie blijven staan als het venster opnieuw getekend wordt.
- Na het sluiten van een venster met Escape komt de cursor terug op een logische plek (afspraakvoorstel, prijsbeheer, planningsresultaat, lokaal afspraakdetail); lokale afspraken in de kalender zijn met het toetsenbord te openen (Enter of spatie).
- De wachtrij toont "Geen tickets om in te plannen" in plaats van eindeloos "Laden...". De TEST-badge in de kop is zichtbaar in de testmodus. Kalender op de gsm: op "Bellen" tikken start het gesprek, maar opent niet langer ook het ticketdetail.
- **Verbinding en serverfouten**: een serverfout met een onleesbaar antwoord (bv. een HTML-foutpagina) toont bij inplannen, toewijzen, verzetten, route, optimaliseren, drukte, een voorstel of rapport versturen en het bijwerken van de oplossing in Zoho een duidelijke melding (bv. "HTTP 502"). "Oplossing → Zoho" meldt niet langer ten onrechte een fout wanneer Zoho een leeg antwoord teruggeeft; een echte Zoho-fout noemt de Zoho-status. Een hangende verbinding vergrendelt een ticket, het annuleervenster of de verzendknop niet meer: na 20 tot 60 seconden verschijnt de foutmelding (met als detail "Time-out na … s") en kun je opnieuw proberen.
- Een verversing (knop Vernieuwen of de automatische controle) zet geen verouderde gegevens meer terug: een ticket dat je net gepland hebt, springt niet meer terug naar de wachtrij als de verbinding net wegvalt. Na een weggevallen verbinding tijdens plannen, uitplannen, verzetten, toewijzen of opslaan klopt het scherm weer met Zoho en de opslag: de app haalt de gegevens één keer opnieuw op, zodat een wijziging die toch doorging weer verschijnt en een volgende wijziging niet vastloopt op een conflict.
- De "In planning sinds"-opzoeking blijft Zoho niet meer elke 5 minuten bevragen voor een ticket waarvoor de opzoeking mislukte: een mislukte opzoeking wordt 6 uur bewaard en dan pas opnieuw geprobeerd. Per verzoek worden nooit meer dan 200 tickets bekeken.

### Deprecated
- Niets.

### Removed
- Ongebruikte oude code: de clusterfuncties (`geoCluster`, `geoClusterFrom`, `estimateTravelMinFromRoute`) en de ongebruikte functie `removeTicketFromAllDays`; niets riep ze nog aan.

### Bekend, ongewijzigd
- Serverkant, bewust niet aangepast: token-foutdata komt in 8 van 10 functies mee, in 2 niet; `tickets` heeft geen OPTIONS; `route`, `optimize` en `drukte` hebben geen methodecontrole; `plan-datum` antwoordt 405 als tekst, de v1-functies als JSON; `comment` heeft Engelse validatie- en orgfouten, `plan` Nederlandse.

## [1.10.3] — 2026-10-08

### Fixed
- De knop "+" plant een ticket niet meer op vandaag als er binnen de werkuren geen tijd meer is voor een
  interventie (bv. na 14u30 bij werkuren tot 17u en een interventie van 2 uur); dan kiest hij de volgende werkdag.
- Route-tabblad: de oranje balk "ticket zonder tijdstip" met de knop "Tijden vastleggen" schoof over de
  eerste afspraak heen en verborg de titel. De balk neemt nu zijn eigen plek in boven de lijst.
- Rapporten-tabblad: de filterbalk (Alle / Interventie / Installatie / datums / Excel / Herladen) bleef met
  een kier onder de kop hangen, zodat rapporten erboven door schoven. Hij sluit nu aan onder de kop, ook als
  de melding "geen verbinding" of "rapport wordt verstuurd" zichtbaar is. Die meldingsbalken zijn nu ook
  niet meer doorzichtig.

### Added
- Het versienummer staat nu onderaan bij Instellingen.

## [1.10.2] — 2026-10-08

### Fixed
- Rapporten worden nu op de server verwerkt in plaats van op de telefoon. Dat werkt ook als het
  scherm vergrendeld is (Android via Background Sync; iOS zet het verder bij het heropenen van de app).
- Een rapport gaat in één korte overdracht naar de server en wordt niet meer dubbel verstuurd.
- De rapportlijst wordt licht: HTML en foto's worden apart bewaard, oude rapporten worden
  automatisch verhuisd.
- Per rapport zie je de status: *In verwerking*, *In Zoho*, *Mislukt* of *Lokaal*. Bij *Mislukt*
  kun je met de knop **Opnieuw versturen** het rapport opnieuw sturen. Bij een definitieve fout krijgt
  de technieker een melding.
- Automatisch opnieuw proberen (na 5 min, 15 min, 30 min, 1 u en 2 u), met een vangnet dat elke
  5 minuten controleert of er nog rapporten vastzitten.
- Rapporten die al vastzaten op een toestel (bewaard maar nog niet in Zoho) worden na de update alsnog verstuurd.

### Changed
- Annuleren kan enkel zolang het rapport nog niet naar de server verstuurd is.

## [1.10.1] — 2026-09-30

### Fixed
- Kalender: korte blokken (bv. een afgerond ticket van 36 minuten) worden minstens zo hoog getekend
  als de kaart nodig heeft, maar de kolomverdeling keek naar de werkelijke duur. Daardoor
  overlapten kaarten die kort na elkaar stonden. Ze staan nu naast elkaar.

## [1.10.0] — 2026-09-30

### Added
- Afspraak annuleren (coördinator): knop in het ticketdetail bij een verstuurd of bevestigd
  voorstel. Verplichte reden uit een vaste lijst (Andere = toelichting verplicht), optionele
  interne toelichting, keuze om de klant per mail te verwittigen met live voorbeeld van de mail.
  Het ticket gaat terug naar "Wachten op planning" zonder datum, met een interne Zoho-notitie
  (reden, datum, wie, wie gemaild werd). Nieuw endpoint `/api/annuleer`.
- Bevestiging per ontvanger: klant, installateur en contactpersoon krijgen elk een eigen
  ondertekende bevestigingslink. Zoho-notitie en planner tonen "✓ Bevestigd door …".

### Changed
- × / "Uit planning halen" bij een ticket met verstuurd voorstel leidt naar het annuleervenster;
  "Dag leegmaken" slaat zulke tickets over.
- Een nieuw voorstel vervangt de vorige voorstel-registratie volledig.

### Fixed
- Slotje en "Voorstel verstuurd" bleven hangen na annuleren/opnieuw inplannen.
- Een oude bevestigingslink kon een nieuw voorstel voor een andere dag bevestigen.
- Bij een voorstel naar meerdere ontvangers ging de registratie van de tweede soms verloren.

## [1.9.5] — 2026-09-30

### Added
- Tabblad Route: weekstrook boven de lijst en kaart met per werkdag het aantal stops en de
  tijdstatus (tijden klaar, tijden nodig of niets gepland), met vorige/volgende week en
  pijltjestoetsen. De datumkiezer blijft bestaan voor verre datums.
- Tabblad Route: balk "zonder tijdstip" met knop Tijden vastleggen (houdt de volgorde en bewaart
  de tijdstippen zoals bij slepen; bij meerdere technici eerst één kiezen).

### Changed
- Routekaart: de druktekleuren lopen ook vloeiend over in de gewone routekleur waar er geen
  vertraging is (niet naar onbetrouwbare stukken).

### Fixed
- Het personenmenu verdween op het tabblad Route achter de kaart.
- Na het verwijderen van stops bleef de oude route (met drukte-kleuren, markers en samenvatting) op
  de kaart van het tabblad Route staan; de kaart wordt nu leeggemaakt, met een hint om opnieuw te
  berekenen.

## [1.9.4] — 2026-09-30

### Fixed
- Kalenderkop op de computer: de pijltjes ‹ › werden in sommige browsers platgedrukt of
  verdwenen achter Week|Maand (sinds v1.9.2).

## [1.9.3] — 2026-09-30

### Changed
- Routekaart: de druktekleuren lopen vloeiend in elkaar over (±300 m) in plaats van abrupt te
  wisselen; wegenwerken en afsluitingen blijven scherp afgelijnd.

## [1.9.2] — 2026-09-30

### Changed
- Kalenderkop op computer en tablet: de pijltjes ‹ › staan dicht bij de periode in plaats van
  over de volle breedte.

## [1.9.1] — 2026-09-30

UI/UX-traject fase 5: toegankelijkheid afronden en opruimen
(plan `docs/superpowers/plans/2026-09-30-uiux-fase5.md`).

### Added
- Schermlezers: vaste structuur (hoofdinhoud, menu, titel), "Naar inhoud"-sprong, alle vensters
  als dialoog met titel, labels bij alle invulvelden en namen voor alle pictogramknoppen,
  aan/uit-toestand van schakelaars wordt meegedeeld, de verzendwachtrij kondigt haar status aan.
- Wie "minder beweging" instelt op zijn toestel, krijgt gedempte animaties.
- Klantbeschikbaarheid: waarschuwing bij sluiten met niet-opgeslagen wijzigingen.

### Changed
- Kalenderkop compact op één rij (‹ periode › en Week|Maand); "↺ Vandaag" verschijnt onder de
  periode als je niet op vandaag staat; dagkoppen in de lijst op één regel ("MA 28").
- Overal hetzelfde sluit-, vink- en waarschuwingsteken (✕ ✓ ⚠).
- Datum in het rapportoverzicht als dd/mm/jjjj; "1 ticket" i.p.v. "1 tickets".

### Fixed
- Telefoonnummers met "(0)" (bv. +32 (0)9 …) bellen nu correct; geen Bel-knop meer zonder nummer.
- Zoekveld in de inventaris wordt leeggemaakt bij wisselen van technieker.
- Oude, ongebruikte stijlen opgeruimd.

## [1.9.0] — 2026-09-30

UI/UX-traject fase 3: één stijl en betere technieker-schermen
(plan `docs/superpowers/plans/2026-09-30-uiux-fase3.md`).

### Added
- Rapport: het ingevulde rapport wordt per ticket als concept bewaard (7 dagen). Bij opnieuw
  openen vraagt de app "Concept hervatten?"; een misklik wist het concept nooit. Nieuwe
  overzichtsstap vóór het versturen, met "Wijzig" per onderdeel.
- Ticketdetail en Ingepland: grote knoppen Bellen, Mailen en Navigeer; "Rapport" is de hoofdknop.
- Inventaris: zoekveld, grotere −/+ en een Opslaan-balk die onderaan in beeld blijft.
- Wachtrij (computer): zoeken (ook op ticketnummer) en sorteren; de sorteerkeuze wordt onthouden.
- Toetsenbord: tabbladen en kaarten zijn met Tab/Enter/Spatie te bedienen, zichtbare focusrand,
  Escape sluit enkel het bovenste venster, de focus blijft binnen een open venster.

### Changed
- Eén vaste knopstijl (hoofd-, gewone, gevaar- en tekstknop) in ticketdetail, rapport,
  instellingen en bevestigingsvensters; vaste tekstgroottes (niets meer onder 12 px), afstanden en
  afrondingen. Het Blitz-groen blijft exact.
- Klantbeschikbaarheid: één "✓ Opslaan" voor alle velden i.p.v. een knop per veld.
- "Datum/tijd" in het ticketdetail is enkel nog voor coördinatoren; de technieker wordt in het
  rapport vooraf ingevuld.
- Foto's kiezen opent direct camera of galerij.

### Fixed
- Het prijzenvenster kon achter het rapport verdwijnen.

## [1.8.1] — 2026-09-30

Testopslag (spec `docs/superpowers/specs/2026-09-29-testopslag-design.md`).

### Added
- Testmodus (`?test`) is volledig losgekoppeld: elke vraag van de app in testmodus krijgt een
  testmarkering, en de server gebruikt dan een aparte testopslag (bij de eerste keer een kopie
  van de echte gegevens) en schrijft nooit naar Zoho. Echte planning, voorraad, prijzen,
  afspraken en het archief worden in testmodus niet meer aangeraakt.
- Instellingen → "Dit toestel" (enkel in testmodus): knop "Testgegevens opnieuw kopiëren".

### Changed
- De bestaande blokkades in de app blijven daarnaast bestaan (dubbel slot).

## [1.8.0] — 2026-09-29

Tablet-fase (spec `docs/superpowers/specs/2026-09-29-tablet-fase-design.md`).

### Added
- Centrale apparaatherkenning: de app kijkt naar hoe het toestel bediend wordt (vinger of muis)
  en naar de kortste schermzijde (gsm < 600, tablet ≥ 600) in plaats van enkel de
  schermbreedte. Draaien, andere beeldverhoudingen of het schermtoetsenbord gooien de indeling
  niet meer om.
- Instellingen → "Dit toestel": toont wat herkend werd, met de keuze van de rol
  (coördinator/technieker) en een vaste weergave. Het tandwiel is voor iedereen bereikbaar;
  techniekers zien er enkel dit deel.
- Een tablet vraagt bij het eerste gebruik één keer "Wie gebruikt deze tablet?".
- Tablet rechtop: een 24u-tijdlijn van 3 werkdagen (per dag verder schuiven, weekend
  overgeslagen).
- Routestops verschuiven: met de muis meteen slepen, met de vinger een halve seconde vasthouden
  (het toestel trilt kort) en dan verschuiven. Meteen vegen scrolt gewoon.
- Na een herstart van de app kom je terug op hetzelfde tabblad en dezelfde scrollpositie
  (tot 10 minuten).
- Tijdelijke diagnose: springt het scherm onverwacht naar boven, dan wordt een klein, anoniem
  logbericht bewaard (wordt verwijderd na analyse).

### Changed
- Planknoppen en -tabbladen volgen de rol op het toestel, niet de schermbreedte: een
  coördinator ziet ze ook op de tablet, een technieker nergens.
- Op aanraakschermen zijn knoppen minstens 44 punten hoog. De gsm-kopbalk past op smalle
  toestellen.
- Bij nieuwe gegevens springt het scherm niet meer naar boven. Een tabwissel begint wel
  altijd bovenaan.

### Fixed
- Het logboek-endpoint weigert grote berichten en bewaart enkel vooraf bepaalde velden.

## [1.7.0] — 2026-09-29

UI/UX-traject fase 2: agenda over 24 uur.

### Added
- De weekagenda (computer) toont het hele etmaal, 00:00–24:00. Uren buiten de werkuren
  (08:30–17:00) hebben een donkerdere achtergrond.
- Rode "nu"-lijn met het uur in de kolom van vandaag; schuift elke minuut mee.
- Bij het openen springt de agenda naar de werkdag (een uur vóór nu, of 08:00 in een andere week).
- Tickets zonder uur staan als klikbare labeltjes ("Zonder uur") in de dagkop, altijd zichtbaar.
- Op gsm/tablet rechtop: een rood "nu"-streepje tussen voorbije en komende afspraken, en een
  label "buiten werkuren" bij afspraken vóór 08:30 of vanaf 17:00.

### Changed
- Eén scrollbalk voor de agenda; de dagkoppen blijven bovenaan staan tijdens het scrollen.
- De geïnstalleerde app draait nu mee naar liggend (was vergrendeld op staand).
- Op een tablet rechtop staan de dagen onder elkaar in plaats van vijf samengedrukte kolommen.

### Fixed
- Afspraken vóór 08:00 of na 18:00 verdwenen onzichtbaar uit de weekagenda.

## [1.6.1] — 2026-09-29

UI/UX-traject fase 1: veiligheid en leesbaarheid (audit `docs/reviews/2026-09-28-ui-ux-audit/`).

### Added
- Eigen bevestigingsvenster in de stijl van de app (grote knoppen, Escape of "Terug" annuleert).
- Rapport versturen vraagt eerst bevestiging en toont wat er gebeurt (archiveren, PDF naar het
  ticket, oplossing naar Zoho, voorraad afboeken). De laatste knop heet nu "✓ Rapport versturen".
- "Uit planning halen" vraagt overal eerst bevestiging (kalenderkaart, routestop, ticketdetail).

### Changed
- Licht thema volledig leesbaar: groene tekst op wit wordt donkere tekst, groene knoppen krijgen
  donkere tekst, diepere tinten voor oranje/rood/blauw, grijze bijtekst donkerder. Het Blitz-groen
  `#00dfa3` blijft overal exact behouden.
- "Verwijder uit planning" in het ticketdetail is een rustige knop met rood kader; het kleine
  kruisje op de kalenderkaart is op gsm verborgen.
- Meldingen blijven langer staan (4 s, fouten 7 s), lopen over meerdere regels, bedekken de
  wizardknoppen niet meer en zijn in gewone taal geschreven.
- Labels: "Bewerken" i.p.v. "Edit", "Blokkade beheren" i.p.v. "Blokkade opheffen", uitleg bij de
  "+" in de wachtrij. De offline-melding belooft niet langer dat alle wijzigingen later doorgaan.
- Invulvelden zijn op gsm/tablet minstens 16 px, zodat iPhone niet meer inzoomt; aantalvelden
  openen het cijfertoetsenbord.

### Fixed
- Testmodus (`?test`) schrijft niets meer naar de server: geen rapportverzending of -archivering,
  geen voorraadwijziging, geen archief-verwijdering, geen datumwijziging. Voorheen kon testen op
  de live site echte gegevens aanpassen.

## [1.6.0] — 2026-09-23

### Fixed
- Een ticket dat van een dag verwijderd werd, of waarvan de datum via het voorstel-venster
  gewijzigd werd, kon tot de volgende automatische ververs dubbel/op de verkeerde plek in de
  planning blijven staan.
- De automatische weekplanner ("Plan deze week") kon een dag meer tijdslots toewijzen dan de
  ingestelde capaciteit toeliet, met name bij een ticket met een lange (multi-slot)
  interventieduur.
- Twee coördinatoren die bijna gelijktijdig klantvoorkeuren wijzigden, konden elkaars
  verwijdering stil ongedaan maken.
- De restcapaciteit van een dag met meerdere, deels overlappende verlof-/blokkeer-uitzonderingen
  werd soms te laag berekend.
- Het voorgestelde tijdstip in een afspraaksvoorstel kon verschillen naargelang je het opende
  vanuit het ticketdetail-scherm of vanuit de Route-tab.
- De app startte niet meer op (geen tickets, geen polling) als de kaart-bibliotheek (Leaflet)
  een keer niet laadde; een falende kaart blokkeert de rest van de app nu niet meer.
- Foto's bij een service-rapport werden dubbel opgeslagen in het archief, wat bij rapporten met
  veel foto's het archiveren stil kon laten mislukken.

### Changed
- Prioriteit (Laag/Middel/Hoog) staat overal consequent in het Nederlands, niet meer soms in het
  Engels of met wisselende hoofdletters.
- De "Geblokkeerd"-knop op een volledig geblokkeerde kalenderdag heet voortaan "Blokkade
  opheffen".
- De kleurkiezer "Kleur routelijn" in Instellingen toont een duidelijk kleurstaaltje + hex-code.
- Het datumveld bij Beschikbaarheden toont de volledige datum (niet langer afgekapt).
- De Bellen/Navigeer-knoppen op een ticketkaart zijn op mobiel en tablet minstens 44 px hoog.
- De "Ingepland"-lijst op mobiel toont ook het tijdstip van de afspraak.
- Het afspraaksvoorstel-mailtje toont een opgekuiste, klantvriendelijke omschrijving i.p.v. de
  ruwe interne ticket-titel (bv. geen "FW:"/"Nieuw contactbericht van ..." meer).
- Het kaartstijl-keuzemenu op de Route-tab-kaart is altijd zichtbaar i.p.v. pas bij hover.
- Het ticketnummer op ticketkaarten (Wachtrij, Kalender, Route-stops, ticketdetail) is groter en
  duidelijker leesbaar.
- De kaart en routeberekening zijn merkbaar sneller bij een tweede berekening op dezelfde dag
  (adressen worden lokaal onthouden i.p.v. telkens opnieuw opgezocht) en de standaardkaartstijl
  is vervangen door een snellere kaartbron; OpenStreetMap blijft apart kiesbaar.
- Het "rapport nog niet verzonden"-balkje toont voortaan per rapport het ticketnummer, de stap,
  het aantal pogingen en de laatste fout, met knoppen om opnieuw te proberen of te annuleren.
- Het risico dat een rapport als dubbele PDF-bijlage op hetzelfde Zoho-ticket terechtkomt (bv.
  als de verbinding wegviel net nadat de upload server-side al gelukt was) wordt nu zo goed als
  uitgesloten (een herhaalde verzending wordt server-side herkend); een klein restrisico blijft
  bij een netwerkonderbreking op exact het verkeerde moment.
- Probeert de wachtrij een rapport te verzenden dat op datzelfde moment al vanuit een ander
  venster/toestel verstuurd wordt, dan toont het balkje een duidelijke melding ("Verzending is
  al bezig in een ander venster") i.p.v. een foutmelding; het opzoeken van adressen en het
  berekenen van de route tonen nu ook tussentijdse voortgangsmeldingen ("Adressen opzoeken…",
  "Route berekenen…", "Drukte laden…").

## [1.5.1] — 2026-09-22

### Fixed
- Drukte-stukjes op de kaart toonden soms keerlussen of omweggetjes bij de tussenpunten.
  De gekleurde stukjes worden nu altijd op de eigen routelijn getekend; een stukje waarvan
  de berekening een omweg bevat, wordt niet ingekleurd in plaats van fout ingekleurd.
- Op toekomstige dagen verdween de verwachte-drukte-kleuring zodra er ergens wegenwerken
  op de route lagen; wegenwerken en wegafsluitingen worden nu apart getoond (gestippeld)
  bovenop de drukte-kleuring, met een waarschuwing bij een wegafsluiting op de route.

## [1.5.0] — 2026-09-22

Verfijning van de drukte-kleuring op de Route-tab kaart voor toekomstige dagen: van per
rit naar per wegvak.

### Added
- **Verwachte drukte per wegvak voor toekomstige dagen**: de route wordt in stukken van
  ±1,5 km doorgerekend voor het uur waarop de technieker daar rijdt, zodat je binnen één
  rit ziet waar het druk wordt (geel/oranje/rood) en waar niet — zoals in Google Maps.
  Klik op een stuk voor de verwachte vertraging en het tijdstip. Vandaag blijft het live
  verkeer.

### Changed
- Kleuring per volledige rit is nu enkel nog het vangnet als de detailberekening niet
  beschikbaar is.

## [1.4.0] — 2026-09-21

Invoering van klantvoorkeuren voor uur en datum, echte route-aanpassingen met
bewaring, en permanente bewaring van gemailde uurblokken.

### Added
- **Voorkeursuur van de klant**: naast een voorkeursdatum kan nu ook een uur
  (of enkel een uur) ingesteld worden; "Plan deze week" en de "+"-knop zetten
  het ticket dan op exact dat uur. Botst dat met een ander vast uur van die
  technieker, dan kiest de planner een andere dag.
- **Route-tab: kaartjes slepen wijzigt nu écht de volgorde**: de app rekent
  de nieuwe tijdstippen uit, bewaart ze en werkt kaart, rijtijden en kalender
  bij. Stops met een verstuurd voorstel of bevestigde afspraak zijn vergrendeld
  (🔒) en blijven op hun uur; handmatige afspraken zijn een vast anker.
- **Het uurblok dat naar de klant gemaild is, wordt bewaard en overal getoond**
  (kalender, maandoverzicht, route), zodat technieker en klant altijd hetzelfde
  blok zien — ook als de instelling voor de blokgrootte later wijzigt.
- **Kaartstijl-keuze op de Route-tab kaart** (Standaard/Licht/Donker/Satelliet),
  onthouden per persoon.
- **Instelbare kleur van de routelijn.**
- **Verwachte drukte per wegstuk op de route** (geel/oranje/rood/donkerrood,
  met legende en uitleg bij klik), berekend voor de geplande dag en het
  geplande uur i.p.v. het verkeer van dit moment. Voor een dag in de toekomst
  is de kleuring gebaseerd op de verwachte vertraging volgens historische
  verkeerspatronen per rit; voor vandaag op het live verkeer.

### Changed
- **Uurblok in het afspraakvoorstel**: start 30 min vóór de geschatte aankomst
  (afgerond op het halve uur), 3 uur breed (instelbaar), begrensd door de
  werkdag. Bv. aankomst 09:15 → "tussen 08:30–11:30". Voorheen een vast raster
  (08–11/11–14/14–17) met wisselende marges.
- **"Optimaliseer" start altijd vanaf nul** (negeert wat je versleept hebt),
  laat vergrendelde stops en afspraken op hun uur staan, en bewaart het
  resultaat als tijdstippen (voorheen bleef een optimalisatie niet bewaard).
- Slepen en Optimaliseren in de Route-tab werken enkel wanneer de dag (na filter) stops van
  één technieker bevat — kies eerst een technieker. Tickets met een voorkeursuur van de klant
  houden altijd hun uur.
- **Rijtijden en vertraging in de Route-tab worden berekend voor de geplande dag/uur
  (verwacht verkeer) i.p.v. het verkeer op het moment van berekenen.**

### Fixed
- **Een ingestelde voorkeursdatum kon niet meer gewijzigd of gewist worden.**
- **De "verwachte duur" per ticket werd niet bewaard na herladen.**

## [1.3.1] — 2026-08-21

Herwerking van de Inventaris-tab op basis van live gebruikersfeedback. Nieuwe,
backward-compatible functionaliteit — geen bestaand gedrag verwijderd.

### Added
- **Edit-modus voor de eigen wagenvoorraad**: de technieker-weergave toont voortaan altijd de
  volledige materialenlijst (niet enkel wat je al hebt). Één "Edit"-knop schakelt de hele lijst
  om: elk item krijgt een `−`/intikbaar aantal/`+` en een bel-icoon om de lage-voorraadmelding
  voor dat item persoonlijk te dempen (bv. materiaal dat je toch niet standaard meeneemt). Niets
  wordt verstuurd tot je op "Opslaan" klikt; "Annuleren" verwerpt alles.
- **Dag-gegroepeerde supervisor-log**: het overzicht bij "Alle technici" toont voortaan een
  duidelijke datum-scheiding per dag, met per beweging enkel het uur. Nieuwe bewegingen die
  binnenkomen terwijl je op dat scherm staat (elke 30 seconden gecontroleerd) krijgen een
  pulserende gloed, die verdwijnt zodra je naar een ander tabblad wisselt.
- **Excel-export van de inventaris-historiek**: met een van/tot-datumfilter, in dezelfde stijl
  als de bestaande Rapporten-export.

### Changed
- **Log-historiek wordt nu beperkt tot 3 maanden** — bewegingen ouder dan 3 maanden worden niet
  langer bewaard (dit voorkomt onbeperkte opslaggroei, maar betekent ook dat een jaaroverzicht
  of oudere accounting-terugblik op deze data niet meer mogelijk is eens ze verwijderd is).
- De vorige "+ Materiaal"-zoek-en-kiesmodal is vervangen door de altijd-volledige lijst hierboven.

## [1.3.0] — 2026-08-20

Fase 2: het inventarissysteem. Nieuwe, backward-compatible functionaliteit — geen bestaand
gedrag gewijzigd of verwijderd.

### Added
- **Nieuw tabblad "Inventaris"**: elke technieker houdt er zijn wagenvoorraad bij (materiaal +
  aantal), zichtbaar op zowel mobiel als desktop. De weergave hangt af van de bestaande
  technieker-kiezer: sta je op een naam, dan zie je die technieker's voorraad; sta je op "Alle
  technici", dan zie je in plaats daarvan een neemlog — wie heeft wanneer wat uit de algemene
  stock genomen, met een "Verwerkt"-knop zodra jij dat manueel in AFAS geboekt hebt. Geen
  AFAS-integratie, enkel dit overzicht.
- **"+ Materiaal"-knop**: een technieker kan materiaal manueel toevoegen aan zijn wagenvoorraad
  (aanvulling uit de algemene stock) of corrigeren — bv. kapot, verloren, een telfout rechtzetten
  — via een negatief aantal. Hergebruikt de bestaande materiaalzoeker uit het rapport, geen
  tweede zoekscherm.
- **Automatische voorraad-aftrek**: materiaal dat op een afgerond rapport staat, wordt bij het
  afronden automatisch van de wagenvoorraad van de betrokken technieker afgetrokken — geen
  extra stap nodig, en dit kan het afronden van een rapport nooit tegenhouden of vertragen.
- **Lage-voorraadmelding**: een badge op de Inventaris-tab (enkel zichtbaar zodra iets op 0 of
  minder staat) + een rode markering op de betrokken rij in de lijst zelf — enkel zichtbaar voor
  de technieker zelf, geen e-mail of melding naar de supervisor.

## [1.2.2] — 2026-08-20

### Fixed
- **1e lijns interventies rekenden geen aanrijtijd aan** — enkel de effectieve werktijd bij de
  klant telde mee voor de €115/uur-berekening. De aanrijtijd (kantoor → klant) telt nu, net als
  bij 2e lijns interventies, mee in het aantal gestarte uren. Hetzelfde geldt voor
  garantie-bezoeken (die dezelfde basisformule gebruiken; het gefactureerde bedrag blijft €0).
- **De knop "⏱️ Aankomst" ontbrak bij manuele afspraken/interventies** (niet afkomstig uit Zoho)
  — die knop bestond enkel voor Zoho-tickets. Toegevoegd aan zowel de dagplanning-rij als het
  detailvenster van manuele afspraken.

## [1.2.1] — 2026-08-17

### Fixed
- **Afgeronde rapporten stonden altijd onderaan de kalender-tijdlijn**, los van hun werkelijke
  tijdstip — ook al is dat tijdstip (start/stop) net zo goed gekend als bij een ingepland ticket.
  Ze tonen nu op hun eigen plaats op de tijdlijn, inclusief correcte naast-elkaar-plaatsing bij
  overlap met andere tickets/afspraken. Rapporten zonder gekende tijd blijven zoals voorheen
  onderaan staan.

## [1.2.0] — 2026-08-17

Opkuis van het ticketdetail-scherm en de kalender-tijdlijn, plus een fix aan de planningslogica —
alles op basis van live gebruikersfeedback.

### Added
- **Datum/tijd wijzigen** is nu een eigen pop-up venster i.p.v. een inklapbare rij onderaan het
  ticketdetail.

### Changed
- **Sluiten-knop overal vervangen door een kruisje** rechtsboven — ticketdetail, detail van een
  manueel toegevoegde afspraak/installatie, Instellingen, Beschikbaarheid-blokkering, Prijsbeheer,
  Rapport-import, Manuele afspraak, Foto's, Planningsresultaat, Afspraakvoorstel en Rapport
  versturen.
- **"Oplossing invoeren"-knop verwijderd**: de uitgevoerde acties die je toch al in het service
  rapport noteert, worden bij het versturen van het rapport nu automatisch als oplossing op het
  Zoho-ticket gezet — geen aparte stap meer nodig.
- Bel-/navigeerknoppen op de kaartjes in de kalender-tijdlijn (desktop) staan er nu ook bij
  manueel toegevoegde afspraken/installaties enkel nog op mobiel, consistent met de tickets zelf.

### Fixed
- **"Aankomst geregistreerd"-melding was onzichtbaar** wanneer ze verscheen terwijl het
  ticketdetail nog open stond — de melding lag achter de modal. Toont nu altijd zichtbaar boven
  een openstaande pop-up.
- **Kop- en tabbladbalk bovenaan konden een zichtbare naad tonen** (achtergrondkleur zichtbaar
  ertussen) — beide zitten nu in één gezamenlijke balk zodat ze altijd naadloos aansluiten.
- **Kalender-tijdlijn**: de dag-kolommen (maandag t.e.m. vrijdag) hadden ongelijke afmetingen —
  maandag reserveerde ruimte voor de uur-labels, de andere dagen reserveerden dezelfde ruimte
  zonder ze te tonen, wat als lege ruimte in de tickets opviel. De uren staan nu in een eigen
  smalle kolom vóór maandag; alle dag-kolommen hebben voortaan exact dezelfde breedte. Ook een
  bijkomende verticale inconsistentie verholpen (dagen met/zonder de "Route berekenen"-knop
  begonnen hun tijdlijn op een net iets andere hoogte).
- **"Plan deze week" negeerde een voorkeursdatum van de klant** zodra die in een latere week viel
  dan de week die net bekeken werd — het ticket werd dan gewoon deze week ingepland i.p.v. te
  wachten op zijn voorkeursdag. De planning kijkt nu verder dan de bekeken week zodra een nog te
  plannen ticket dat nodig heeft.

## [1.1.2] — 2026-08-17

Verdere bugfixes op de kalender-tijdlijn, op basis van live gebruikersfeedback na v1.1.1.

### Fixed
- De in v1.1.1 toegevoegde per-dag-kolom-scroll (elke dag met een eigen vaste hoogte en
  scrollbalk, onderling gesynchroniseerd) zorgde in de praktijk voor een tragere, haperende
  pagina. Teruggedraaid: de tijdlijn neemt nu weer gewoon zijn volledige hoogte in en de hele
  pagina scrollt, zoals voorheen.
- Tickets met een korte geplande duur waren te kort om hun eigen inhoud (nummer, tijd, onderwerp,
  adres) volledig te tonen — de onderkant van de kaart werd afgekapt. Elk tijdlijn-blok krijgt nu
  een minimumhoogte die de volledige kaart toont, ongeacht de geplande duur.

### Changed
- De bel-/navigeerknoppen op ticketkaarten staan er enkel nog op mobiel — op de pc-weergave
  volstaat een klik op de kaart, die opent het ticketdetail (met bel/navigeer erin). Ticketblokken
  zijn hierdoor ook wat compacter, wat de minimumhoogte hierboven mee beperkt houdt.

## [1.1.1] — 2026-08-17

Bugfixes op de kalender-tijdlijn en Beschikbaarheden-tab, op basis van feedback na de v1.1.0-lancering.

### Fixed
- **Kalender-tijdlijn**: toont voortaan altijd minstens 08:00–18:00 (voorheen enkel de ingestelde
  werkuren, waardoor vroege/late afspraken buiten beeld konden vallen). Overlappende tickets/
  afspraken worden nu naast elkaar getoond in plaats van elkaar te verbergen. Het uur-overzicht
  (08:00, 09:00, …) stond voorheen bij elke dag herhaald — dit staat nu enkel nog bij de eerste
  dag van de week, met de verticale scroll gesynchroniseerd tussen alle dagen zodat het uur-
  overzicht mee blijft passen.
- **Beschikbaarheden-tab**: een filter bovenaan laat nu toe per persoon te bekijken/beheren i.p.v.
  alles door elkaar te tonen. Verlof over meerdere dagen toont als één periode (met begin- en
  einddatum) in plaats van een aparte regel per dag. Het invoerformulier staat nu bovenaan, vóór
  de lijst met geplande uitzonderingen.

## [1.1.0] — 2026-08-17

Fase 1: de PDF-verbeterpunten. Nieuwe, backward-compatible functionaliteit — geen bestaand
gedrag gewijzigd of verwijderd.

### Added
- **Bevestigingsknop in de voorstelmail**: naast "antwoorden op de mail" kan de klant een
  afspraak nu ook bevestigen via een beveiligde link. Bewust in twee stappen (de link zelf toont
  enkel een tussenpagina, pas een expliciete tweede klik bevestigt) zodat automatische
  e-mail-scanners de afspraak niet per ongeluk kunnen bevestigen. Tijdstip en IP-adres van de
  bevestiging worden als interne notitie op het Zoho-ticket vastgelegd; een verlopen of
  reeds-afgehandelde link wordt geweigerd i.p.v. blindelings herbevestigd.
- **"Beschikbaarheden"-tab onder Instellingen**: verlof/ziekte/uitzonderingen kunnen nu ook
  rechtstreeks ingegeven worden, zonder eerst een kalenderdag aan te klikken. Het bestaande
  per-dag-blokkeermenu blijft ongewijzigd naast deze nieuwe tab bestaan.
- **Kalender-tijdlijn op desktop**: de week-weergave toont per dag nu een echte uur-tijdlijn met
  proportioneel geplaatste afspraken, inclusief geblokkeerde/verlof-periodes als zichtbaar
  segment. Mobiel blijft de bestaande kaartjeslijst gebruiken.
- **Tijdsloten i.p.v. exacte tijdstippen**: klant en technieker zien voortaan een configureerbaar
  tijdvak (bv. "10:00–13:00", instelbaar via Instellingen) in plaats van een exact uur — in de
  voorstelmail, de kalendertijdlijn en de maandweergave. De interne planning/routeberekening
  blijft op de exacte tijd rekenen; enkel de weergave veranderde.
- **Snellere opstart**: tickets, beschikbaarheid, afspraken en klantbeschikbaarheid tonen bij het
  openen van de app meteen de laatst gekende gegevens (uit lokale opslag) en verversen daarna op
  de achtergrond. Bij een tijdelijke verbindingsstoring blijft de laatst gekende informatie
  zichtbaar in plaats van een leeg scherm.

## [1.0.0] — 2026-08-14

Eerste versie onder de nieuwe versiediscipline — markeert het einde van de bèta-fase.

### Changed
- `public/index.html` (voorheen ~7.500 regels) opgesplitst in aparte modules: `public/js/`
  (outbox, rapport-wizard, rapport-archief, excel-export, prijzen) en `public/css/` (base, app,
  wizard, prijzen) — geen zichtbare functionaliteitswijziging, wel een onderhoudbaarder
  codebase (`public/index.html` nu ~4.160 regels, enkel nog kalender/planning/tickets/
  beschikbaarheid/UI-chrome) voor de features die hierna komen.
