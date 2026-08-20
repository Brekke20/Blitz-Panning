# Ontwerp: Inventarissysteem (Fase 2)

**Datum:** 2026-08-20
**Status:** Approved, klaar voor implementatieplan
**Vervangt/verfijnt:** sectie "Fase 2 — Inventarissysteem" in
`docs/superpowers/specs/2026-08-13-roadmap-inventaris-en-verbeteringen-design.md`
(scope daar bevestigd op 2026-08-13 en op 2026-08-20 herbevestigd; dit document werkt
de UX/knoppen en het datamodel in detail uit).

## Aanleiding

Brent vroeg om, vóór er iets gebouwd wordt, een brainstormronde specifiek over waar nieuwe
knoppen in de interface komen — met de expliciete randvoorwaarde dat de app niet "druk" mag
aanvoelen met knoppen die niet op een logische plek staan. Dit document legt de uitkomst van
die brainstorm vast.

## Scope-bevestiging (2026-08-20, ongewijzigd t.o.v. 2026-08-13)

- Geen AFAS-integratie — enkel een overzicht voor de supervisor, die zelf manueel in AFAS boekt.
- Lage-voorraaddrempel = **0 of minder** (één simpele regel voor alle materialen, geen
  per-materiaal-instelbare drempel).
- Geen overzicht van alle wagenvoorraden gelijktijdig voor de supervisor — enkel de neem-log.
  (Een supervisor kan wél, via de bestaande persoon-kiezer, één specifieke wagenvoorraad
  bekijken — dat is geen "alle-tegelijk"-overzicht en dus geen scope-uitbreiding, zie
  "Componenten" hieronder.)
- Geen automatische e-mail/notificatie bij lage voorraad — enkel in-app, enkel zichtbaar voor
  de technieker zelf.

## Nieuw t.o.v. de roadmap van 2026-08-13

Tijdens deze brainstorm kwamen twee gaten in de oorspronkelijke scope naar boven, en is er een
concrete keuze gemaakt over hergebruik van bestaande UI-elementen (zie "Componenten"):

1. **Manuele correctie** (materiaal kapot/verloren, of een telfout rechtzetten) was niet
   voorzien — enkel "toevoegen" en "automatisch aftrekken bij rapport" stonden in de roadmap.
   Zonder correctiemogelijkheid loopt de voorraad onvermijdelijk scheef zonder herstelpad, wat
   op termijn foutieve lage-voorraadwaarschuwingen oplevert. **Toegevoegd**: hetzelfde
   "+ Materiaal"-scherm accepteert ook een negatief aantal, gelabeld als `correctie`.
2. Een correctie is geen opname uit de algemene stock, maar de supervisor wil dit toch kunnen
   zien (iets is voorgoed weg, ook al hoeft hij niets in AFAS te boeken). **Toegevoegd**:
   correcties verschijnen in dezelfde log als de aanvullingen, met een duidelijk `type`-label,
   maar zonder "Verwerkt"-actie (er is niets te verwerken).

## Componenten

### 1. Nieuwe hoofdtab "Inventaris"

- Toegevoegd aan de bestaande tabbalk (`Wachtrij · Kalender · Route · Ingepland · Rapporten`),
  **niet** als `desktop-only` — zichtbaar op zowel mobiel als desktop. Reden: zowel de
  technieker (mobiel, in de wagen, snel iets aftikken) als de supervisor (vaak desktop, overzicht
  nakijken) hebben dit evenveel nodig — in tegenstelling tot bv. Route, dat vooral een
  desktop-werkstroom is.
- **Inhoud hangt af van de bestaande persoon-kiezer** (`activeAssigneeFilter`, het avatar-menu
  rechtsboven dat vandaag al "Alle technici" of een specifieke naam laat kiezen — zie
  `public/index.html:901-936`). Geen nieuwe kiezer nodig:
  - **Specifieke technieker geselecteerd** → toont de wagenvoorraad van die technieker
    (lijst materiaal + aantal) + knop **"+ Materiaal"**.
  - **"Alle technici" geselecteerd** → toont de supervisor-log (zie datamodel) + knop
    **"Verwerkt"** per regel met `type: aanvulling` en `status: nieuw`.
- **Tab-badge** (zelfde stijl als de bestaande badges op Wachtrij/Ingepland,
  `<span class="badge">`): telt, afhankelijk van de huidige stand van de persoon-kiezer,
  ofwel het aantal materialen op ≤0 bij de geselecteerde technieker, ofwel het aantal
  openstaande (`status: nieuw`) log-regels bij "Alle technici". Herberekend telkens de
  persoon-kiezer wisselt, zelfde patroon als de bestaande `cnt-tickets`/`cnt-gepland`-badges.
- **Lage voorraad in de lijst zelf**: een rij met `aantal <= 0` krijgt een duidelijke rode
  markering (zelfde soort visuele nadruk als andere waarschuwingsstaten elders in de app, geen
  nieuw kleurenschema). Geen toast, geen apart pop-up-venster.

### 2. "+ Materiaal"-knop (technieker-weergave)

- Opent hetzelfde zoekscherm dat vandaag al bestaat in de rapport-wizard voor het toevoegen van
  onderdelen (`zoekOnderdelen()` in `public/js/prijzen.js:303`, hergebruikt zoals de
  rapport-wizard het vandaag al doet — geen tweede zoekcomponent bouwen).
- Na het kiezen van een materiaal: invoerveld voor het aantal. **Aantal mag negatief zijn.**
  - Aantal > 0 → log-regel `type: 'aanvulling'`, `status: 'nieuw'`, wagenvoorraad +aantal.
  - Aantal < 0 → log-regel `type: 'correctie'`, geen `status`-veld (geen "Verwerkt"-actie
    nodig), wagenvoorraad +aantal (dus effectief een aftrek).
- Geen validatie die een negatieve eindvoorraad blokkeert — zie "Randgevallen".

### 3. "Verwerkt"-knop (supervisor-weergave, "Alle technici")

- Per log-regel met `type: 'aanvulling'` en `status: 'nieuw'`. Klikken → `status: 'verwerkt'`.
- Regels met `type: 'correctie'` of `type: 'verbruik'` (zie datamodel) tonen **geen**
  "Verwerkt"-knop — puur informatief, er is niets in AFAS te boeken.
- Verwerkte `aanvulling`-regels blijven in de log staan (voor historiek/traceerbaarheid) maar
  vallen weg uit de "openstaand"-telling die de tab-badge voedt.

### 4. Automatische aftrek bij rapport-archivering — geen nieuwe knop

- Op het moment dat een rapport **afgerond/gearchiveerd** wordt (niet tijdens het bewerken —
  zie de bestaande afspraak hierover in de roadmap van 2026-08-13), wordt voor elk item in
  `R.onderdelen[]` het bijhorende `aantal` afgetrokken van de wagenvoorraad van de technieker
  die het rapport indient, en verschijnt een log-regel `type: 'verbruik'` (geen `status`, geen
  "Verwerkt"-knop — dit kwam nooit uit de algemene stock, het was al in de wagen).
- De technieker moet hier niets voor aanklikken — dit is een neveneffect van een actie
  (rapport afronden) die al bestaat. **Geen nieuwe UI.**
- Exact aanknopingspunt in de code (waar "rapport afronden/archiveren" vandaag al gebeurt) wordt
  bepaald tijdens het implementatieplan — dit ontwerp legt enkel het gedrag vast: de aftrek
  gebeurt bij het archiveren, niet bij het bewerken.

## Datamodel

### Wagenvoorraad

Per technieker een lijst van `{ materiaalId, aantal }`. `materiaalId` verwijst naar de
bestaande prijzencatalogus (`PRIJZEN_DEFAULTS` in `public/js/prijzen.js`) — geen aparte
materialenlijst. Een technieker-materiaal-combinatie die nog nooit voorkwam, bestaat gewoon nog
niet in de lijst (geen vooraf aangemaakte lege regels voor elk mogelijk materiaal).

Opslag: nieuwe key in de bestaande Netlify Blobs-store `blitz-data` (`consistency: 'strong'`),
naar analogie van hoe `availability.js`/`klantbeschikbaarheid.js` vandaag al een eigen key in
diezelfde store gebruiken.

### Voorraad-log

Eén doorlopende lijst, elke regel:

```
{
  technieker: string,
  materiaalId: string,
  aantal: number,        // signed: positief = toevoeging, negatief = aftrek
  datum: ISO-datetime,
  type: 'aanvulling' | 'correctie' | 'verbruik',
  status: 'nieuw' | 'verwerkt' | null   // enkel relevant/aanwezig bij type 'aanvulling'
}
```

| Type | Ontstaat wanneer | "Verwerkt"-knop? | Telt mee in tab-badge (Alle technici)? |
|---|---|---|---|
| `aanvulling` | technieker vult wagenvoorraad bij via "+ Materiaal" met positief aantal | Ja | Ja, zolang `status: 'nieuw'` |
| `correctie` | technieker corrigeert via "+ Materiaal" met negatief aantal | Nee | Nee — enkel informatief |
| `verbruik` | rapport wordt afgerond/gearchiveerd, materiaal stond op `R.onderdelen[]` | Nee | Nee — enkel informatief |

Nieuwe Netlify-function (bv. `netlify/functions/inventaris.js`), zelfde vorm als
`availability.js`: GET voor ophalen, POST voor een nieuwe wagenvoorraad-mutatie (die zowel de
wagenvoorraad als de log in één keer bijwerkt), PATCH voor "Verwerkt" (enkel `status`-wijziging).

## Randgevallen

- **Aftrek zonder dat het materiaal in de wagenvoorraad-lijst stond** (technieker had het nooit
  geregistreerd, of nieuw materiaal): de lijst krijgt gewoon een regel met een negatief aantal.
  Dit is meteen zichtbaar als rode rij — het signaal voor de technieker dat zijn wagenvoorraad
  niet meer overeenkomt met de realiteit. **Geen blokkering**: een rapport afronden mag nooit
  tegengehouden worden door een voorraad-inconsistentie.
- **Nieuwe technieker / materiaal dat nog niet voorkomt**: geen vooraf aangemaakte lege regels;
  ontstaat pas bij de eerste mutatie.
- **Gelijktijdige wijzigingen** (bv. technieker voegt iets toe terwijl tegelijk een rapport
  wordt afgerond met hetzelfde materiaal): dit is een informatief overzicht, geen boekhouding
  die tot op de eenheid moet kloppen — geen extra locking/conflictafhandeling nodig, de
  bestaande `strong`-consistency van Netlify Blobs is voldoende.

## Niet in scope (bevestigd)

- AFAS-integratie.
- Supervisor-overzicht van alle wagenvoorraden gelijktijdig (enkel de neem-log, en optioneel
  één-voor-één inkijken via de persoon-kiezer).
- E-mail/notificatie bij lage voorraad.
- Per-materiaal instelbare lage-voorraaddrempel (vaste regel: ≤0).

## Bouwt bovenop

De gerefactorde structuur uit Fase 0 (`public/js/`-modules): nieuwe module
`public/js/inventaris.js`, hergebruikt `zoekOnderdelen()` uit `prijzen.js` en hangt in op het
bestaande archiveermoment uit de rapport-wizard-module. Geen wijziging aan de bestaande
prijzencatalogus of aan `R.onderdelen[]` zelf nodig.

## Verificatie

Geen geautomatiseerde testsuite in dit project — verificatie gebeurt zoals de rest van de app,
via live uittesten in de browser vóór het naar productie gaat: materiaal toevoegen, corrigeren,
een rapport afronden en de aftrek zien gebeuren, en "Verwerkt" aanklikken en de regel uit de
openstaande lijst zien verdwijnen.
