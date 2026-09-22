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
- Een rapport kon in een zeldzaam geval als een dubbele PDF-bijlage op hetzelfde Zoho-ticket
  terechtkomen als de verbinding wegviel net nadat de upload server-side al gelukt was.

### Changed
- Prioriteit (Laag/Middel/Hoog) staat overal consequent in het Nederlands, niet meer soms in het
  Engels of met wisselende hoofdletters.
- De "Geblokkeerd"-knop op een volledig geblokkeerde kalenderdag heet voortaan "Blokkade
  opheffen".
- De kleurkiezer "Kleur routelijn" in Instellingen toont een duidelijk kleurstaaltje + hex-code.
- Het datumveld bij Beschikbaarheden toont de volledige datum (niet langer afgekapt).
- De Bellen/Navigeer-knoppen op een ticketkaart zijn op mobiel minstens 44px hoog.
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
