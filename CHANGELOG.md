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
