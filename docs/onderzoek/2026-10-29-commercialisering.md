# Onderzoek: de planner als product voor andere bedrijven (2026-10-29)

Verkennend rapport, nog geen spec. Er is niets gebouwd of gewijzigd. Brent moet eerst de keuzes onder "Grote keuzes" maken.

## Samenvatting voor Brent

- Het kan. Het grootste deel van de app is niet aan Blitz gebonden: de planner (wie gaat wanneer waarheen), de kalender, routes en reistijden, beschikbaarheid, logins en rollen, het beheer, de offline werking en de thema's.
- Drie stukken zitten wel vast aan Blitz. **Zoho**: tickets, klantgegevens, statussen én alle uitgaande mails lopen via Zoho Desk. **Het rapport**: de velden gaan over laadpalen (serienummer, CHARX, kabel, oorzaak storing), en het logo en de naam "BLITZ POWER" staan in de code. **Prijzen en tarieven**: de onderdelenlijst en de uurtarieven (€ 175 / € 115) staan in de code.
- Daarnaast staan op een tiental plaatsen de naam, het adres en de website van Blitz Power vast in de tekst (mails, foutmeldingen, de app-omschrijving).
- Mijn aanbeveling voor de opbouw: één codebasis, waarin Blitz zelf ook gewoon een klant is (met Zoho als koppeling aan). In het begin krijgt elk bedrijf een eigen kopie op Netlify uit diezelfde code. Dan zijn de gegevens van bedrijven volledig gescheiden en hoeft de opslag niet herbouwd te worden. Pas vanaf een tiental klanten loont één gedeelde app met een echte database.
- PDF-bouwer: ik raad een "blokken"-editor aan. Het bedrijf kiest blokken (logo, klantgegevens, werkzaamheden, foto's, handtekeningen, onderdelen), zet ze in een volgorde, kiest kleuren en uploadt een logo. De app maakt er dezelfde soort PDF van als nu. Vrij slepen op een A4-vel is veel meer werk voor weinig winst.
- Belangrijk inzicht: een PDF-bouwer kan alleen velden tonen die de technieker in het rapport invult. "Eigen velden in het rapport" en "eigen PDF" zijn dus één onderwerp, niet twee.
- Zoho vervangen: een eenvoudige eigen lijst van klanten en tickets in de app, plus importeren uit Excel/CSV. Koppelingen met andere systemen (bv. Teamleader, Odoo) komen later. Voor de mails is een aparte mailservice nodig.
- **Eerst te regelen, vóór er code geschreven wordt:** van wie is de app? Ze is gebouwd voor Blitz Power, terwijl jij er werkt. Verkopen aan andere bedrijven kan pas als dat met Blitz Power schriftelijk geregeld is.
- Ook belangrijk: de gegevens staan nu waarschijnlijk in een Amerikaans datacenter van Netlify (standaardinstelling). Voor verkoop aan Europese bedrijven moet dat naar de EU. Dat is ook voor Blitz zelf het nakijken waard.
- Grove omvang tot een eerste proefklant (MVP): fase 1 tot 4 hieronder, ruwweg 2 à 3 maanden deeltijds werk met Claude. Een volwaardige v1 (facturatie, koppelingen, meerdere talen) is daarna nog eens zo veel.
- Je moet nu niets bouwen: beantwoord eerst de "Grote keuzes". Begin bij K1 (eigendom) en K3 (opbouw).

## Grote keuzes

Elke keuze kan later als klikbare vraag gesteld worden. De aanbevolen optie staat telkens eerst.

### K1. Van wie is het product en via welk bedrijf wordt het verkocht?
- **a) Eerst schriftelijk regelen met de directie van Blitz Power, met juridisch advies (aanbevolen als eerste stap).** Pas daarna kiezen tussen b, c en d.
- b) Blitz Power BV verkoopt het zelf; jij bouwt en beheert het.
- c) Jij verkoopt het via een eigen vennootschap, met een licentie- of overdrachtsakkoord van Blitz Power.
- d) Een apart (spin-off-)bedrijf met Blitz Power als mede-eigenaar en eerste klant.

Aanbeveling: a. Over het vehikel zelf geef ik geen voorkeur; dat is een juridische en persoonlijke keuze. Zonder akkoord is elk volgend werk een risico (zie Risico R1).

### K2. Eén codebasis met Blitz als klant, of een aparte kopie (fork) voor het product?
- **a) Eén codebasis; Blitz wordt een "tenant" met Zoho aan (aanbevolen).** Eén keer bugs oplossen, Blitz krijgt nieuwe functies er gratis bij.
- b) Een aparte fork voor het product; de Blitz-app blijft zoals ze is.
- c) Eerst forken en later terug samenvoegen.

Aanbeveling: a. Een fork betekent dat elke bugfix twee keer moet, en dat de twee versies snel uit elkaar groeien (dat zagen we al bij `main` en `refactor`). Nadeel van a: elke productwijziging kan Blitz raken, dus de bestaande testsuite moet blijven slagen voor de Blitz-tenant.

### K3. Hoe worden bedrijven van elkaar gescheiden (multi-tenancy)?
- **a) Een aparte Netlify-site per bedrijf, gebouwd uit dezelfde code (aanbevolen voor de eerste 1 à 10 klanten).**
- b) Eén gedeelde app op Netlify Blobs, met per bedrijf een eigen opslagnaam.
- c) Eén gedeelde app met een echte database (Postgres, bv. Netlify DB/Neon of Supabase in de EU), met per rij een bedrijfsnummer.

Aanbeveling: a nu, c later. Uitleg en voor- en nadelen onder "Technisch › Multi-tenancy". Optie b raad ik af: hetzelfde risico op datalekken als c, zonder de voordelen van een database.

### K4. Voor welke bedrijven is het product bedoeld?
- **a) Energie-installateurs: laadpalen, zonnepanelen, warmtepompen, batterijen (aanbevolen).** Dicht bij wat de app al doet en bij jouw netwerk.
- b) Alleen laadpaal-servicebedrijven (zoals Blitz).
- c) Elk buitendienstbedrijf (HVAC, liften, schoonmaak, IT op locatie, ...).

Aanbeveling: a. Bij b is de markt klein. Bij c moet alles meteen generiek zijn en concurreer je met grote spelers.

### K5. Waar komen tickets en klanten vandaan zonder Zoho?
- **a) Een eigen eenvoudig ticket- en klantenregister in de app, plus import uit Excel/CSV (aanbevolen voor de MVP).**
- b) Meteen koppelingen met de systemen die klanten al hebben (Teamleader, Odoo, HubSpot, ...).
- c) Beide tegelijk.

Aanbeveling: a. Een koppeling per systeem is telkens apart werk en apart onderhoud; eerst zien welke systemen de proefklanten echt gebruiken.

### K6. Hoe worden mails verstuurd (afspraakvoorstel, annulatie, rapport)?
- **a) Een Europese mailservice (bv. Brevo of Mailjet), met het domein van de klant als afzender na een DNS-instelling (aanbevolen).**
- b) Via het eigen mailaccount van de klant (Microsoft 365 / Google Workspace / SMTP).
- c) Alles van één eigen productadres versturen (bv. planning@<product>.be).

Aanbeveling: a. b vraagt per klant een moeilijke goedkeuring (we liepen daar bij de Outlook-koppeling al op vast); c ziet er voor de eindklant vreemd uit.

### K7. Hoe vrij mag een bedrijf de velden van het rapport kiezen?
- **a) Een sjabloon per branche (laadpaal, zonnepanelen, warmtepomp, algemeen), velden aan/uit, en een beperkt aantal eigen velden (tekst, keuze, getal, ja/nee) (aanbevolen).**
- b) Vaste velden; enkel aan/uit.
- c) Een volledige formulierbouwer (eigen stappen, voorwaarden, berekeningen).

Aanbeveling: a. Eigen velden zijn gegevens, geen code; dat volgt de regel van ADR 0001 (thema's als pakket zonder code).

### K8. Wat voor PDF-bouwer?
- **a) Een blokken-editor: blokken kiezen, ordenen, aan/uit, logo, kleuren en voettekst (aanbevolen).**
- b) Vrij slepen op een A4-vel, op de millimeter.
- c) Het bedrijf levert een eigen PDF-formulier aan en de app vult de velden in.

Aanbeveling: a. c kan later als extra (met de bibliotheek pdf-lib), voor bedrijven die al een verplicht formulier hebben.

### K9. Rollen en rechten
- **a) De vier vaste rollen behouden (beheerder, planner, technieker, sales), met namen die het bedrijf zelf kiest en extra vinkjes per gebruiker zoals "Mag zelf plannen" (aanbevolen).**
- b) Volledig eigen rollen, met per rol een lijst rechten om aan te vinken.

Aanbeveling: a. De rechtentabel is een veiligheidsgrens met tests; vrije rollen maken ze veel moeilijker te bewaken.

### K10. Welke onderdelen staan standaard aan?
- **a) Kern (tickets, planning, kalender, routes, rapporten, beheer) standaard; sales-planner, voorraad per wagen en thema's als optie; Blitz Run enkel voor Blitz (aanbevolen).**
- b) Alles voor iedereen.
- c) Enkel de kern; de rest blijft Blitz-only.

Aanbeveling: a. Zo blijft het product voor een nieuwe klant eenvoudig, en kost een module die niemand gebruikt geen support.

### K11. Talen
- **a) Enkel Nederlands in de MVP, maar teksten wel al uit de code halen (aanbevolen).**
- b) Meteen Nederlands en Frans.
- c) Nederlands, Frans en Engels.

Aanbeveling: a. Vertalen is veel werk (alle schermen, mails, PDF) en heeft pas zin bij de eerste Franstalige klant.

### K12. Prijsmodel
- **a) Per actieve technieker per maand, plus een eenmalige opstartkost (aanbevolen).**
- b) Een vast bedrag per bedrijf per maand, in staffels.
- c) Een eenmalige licentie plus een jaarlijks onderhoudscontract.

Aanbeveling: a, zoals de meeste planningssoftware voor buitendiensten. Het bedrag zelf vraagt een kleine marktverkenning. Ik geef hier bewust geen prijzen.

### K13. Waar staan de gegevens?
- **a) Verplicht in de EU, ook voor Blitz zelf (aanbevolen).**
- b) Enkel voor nieuwe klanten in de EU; Blitz blijft zoals nu.

Aanbeveling: a. Klanten en hun verwerkersovereenkomst zullen dit vragen, en Blitz overzetten is een goede generale repetitie.

### K14. Hosting
- **a) Op Netlify blijven voor de MVP (aanbevolen).**
- b) Eerst naar Azure verhuizen (zie de eerdere verkenning `docs/azure-migratie.md`).

Aanbeveling: a. Twee grote verhuizingen tegelijk is te veel risico; Azure kan later.

### K15. Verhouding met Voltara
- **a) Later bekijken, na K1 (aanbevolen).**
- b) Volledig gescheiden houden.
- c) Onder één merk of één bedrijf brengen.

Ik weet niet wat Voltara inhoudt en maak er geen aannames over. Brent beslist of het raakvlakken heeft (doelgroep, techniek, bedrijf).

## Technisch

### 1. Inventaris: wat zit vast aan Blitz?

Legende: **H** = herbruikbaar zoals het is, **V** = veralgemenen (instelbaar maken), **N** = opnieuw bouwen.

| Onderdeel | Waar | Oordeel | Opmerking |
|---|---|---|---|
| Ticketbron = Zoho Desk | [zoho.js:9-10](netlify/lib/zoho.js:9), [tickets.js:29-36](netlify/functions/tickets.js:29) | **N** (achter een tussenlaag) | Zie §4. |
| Statusnamen van Zoho | [tickets.js:33-35](netlify/functions/tickets.js:33), ook in `propose.js`, `plan.js`, `confirm-afspraak.js`, client | **V** | "Wachten op planning", "Wachten op bevestiging planning", "Geplande service/support", "Gesloten - ov" worden een vaste interne lijst; per koppeling vertaald. |
| Zoho-velden (`cf_…`) | `cf_interventie_datm` (14×), `cf_e_mail_eindklant`, `cf_e_mail_installateur`, `cf_regio`, `cf_serienummer`, … | **V** | Worden velden van het eigen ticketmodel. |
| Alle uitgaande mails via Zoho `sendReply` | [propose.js:2](netlify/functions/propose.js:2), [propose.js:329](netlify/functions/propose.js:329), `annuleer.js`, `send-rapport.js`, `rapport-zoho.js` | **N** | Mailservice nodig (K6). |
| Mailcontrole na een onzekere verzending | [mail-check.js:1-7](netlify/functions/mail-check.js:1) leest Zoho-threads | **V** | Met een eigen mailregister wordt dit eenvoudiger: we weten zelf wat verstuurd is. |
| Rapport-PDF naar Zoho als bijlage | [rapport-zoho.js:1-14](netlify/lib/rapport-zoho.js:1) | **V** | PDF maken blijft; "bewaren bij het ticket" gaat naar de eigen opslag. |
| Gebruikers gekoppeld aan Zoho-agenten | [gebruikers.js:68-69](netlify/lib/gebruikers.js:68) (technieker *moet* een Zoho-naam hebben), `zoho-agenten.js`, `eigen-ticket.js` | **V** | Wordt "externe naam/ID", enkel nodig als er een koppeling is. |
| Rapportvelden laadpaal-specifiek | [rapport-wizard.js:29-43](public/js/rapport-wizard.js:29) (`serienummer`, `aantalLaadpalen`, `kabel`, `oorzaakStoring`, `servicetype` 1e/2e lijn), stappen [rapport-wizard.js:45-55](public/js/rapport-wizard.js:45), invoer "CHARX-XXXX" [rapport-wizard.js:671-672](public/js/rapport-wizard.js:671) | **V/N** | Wordt een rapportsjabloon (K7). De wizard is 1588 regels; de stappen-structuur is herbruikbaar, de inhoud niet. |
| Rapport-opmaak met vast logo en naam | [rapport-wizard.js:1247-1250](public/js/rapport-wizard.js:1247) ("BLITZ POWER — SERVICE RAPPORT") | **N** | Wordt de PDF-bouwer (§3). |
| Prijslijst met CHARX-onderdelen | [prijzen.js:19-25](public/js/prijzen.js:19) (categorieën), [prijzen.js:31](public/js/prijzen.js:31) (standaardlijst), ook in [netlify/functions/prijzen.js](netlify/functions/prijzen.js) | **V** | Lege lijst + import; categorieën instelbaar. Het beheerscherm zelf is herbruikbaar. |
| Uurtarieven in de code | [loonkost.js:3-17](public/js/kern/loonkost.js:3) (€ 175 + € 75/u, € 115/gestart uur, garantie) | **V** | Tariefregels per bedrijf. |
| Bedrijfsnaam, adres, website in mails en pagina's | [propose.js:40](netlify/functions/propose.js:40), [propose.js:172-181](netlify/functions/propose.js:172), [annulatie.js:108-117](netlify/lib/annulatie.js:108), [confirm-afspraak.js:133](netlify/functions/confirm-afspraak.js:133), [manifest.json:4](public/manifest.json:4) | **V** | Uit een bedrijfsprofiel halen. |
| Servicevoorwaarden-PDF als bijlage | `netlify/functions/assets/service-voorwaarden.pdf`, [netlify.toml](netlify.toml) (`included_files`) | **V** | Per bedrijf uploaden. |
| Vaste domeinnaam | `https://blitz-planning.net` in 11 serverbestanden (o.a. [afspraken.js:12](netlify/functions/afspraken.js:12)) | **V** | Toegelaten herkomst (CORS) en links: per site instellen. |
| Opslagnaam `blitz-data` | [testmodus.js:5](netlify/lib/testmodus.js:5), [testmodus.js:35](netlify/lib/testmodus.js:35) (`winkelNaam`), maar ook rechtstreeks in [auth-antwoord.js:22](netlify/lib/auth-antwoord.js:22), [auth.js:95](netlify/lib/auth.js:95), [activiteit.js:52](netlify/lib/activiteit.js:52), [confirm-afspraak.js:240](netlify/functions/confirm-afspraak.js:240) | **H** bij K3a, **V** bij K3b/c | Blobs zijn per Netlify-site gescheiden: bij een aparte site per bedrijf mag de naam blijven. |
| Dataregio Blobs | alle `getStore`-aanroepen zonder `region` | **V** | Volgens de Netlify-documentatie is de standaard `us-east-2` (VS). Na te kijken voor Blitz zelf. |
| Geheimen per installatie | `SESSIE_GEHEIM`, `CONFIRM_LINK_SECRET`, `PLANNING_EXPORT_API_KEY`, `TOMTOM_API_KEY`, `ZOHO_*` | **H** bij K3a | Per site in te stellen; bij K3b/c moeten ze per bedrijf in de opslag. |
| Land en taal | [feestdagen.js](public/js/kern/feestdagen.js) (Belgische feestdagen), [optimize.js:24](netlify/functions/optimize.js:24) (`countrySet=BE,NL,LU,FR,DE`), [sales-geocode.js:84](netlify/lib/sales-geocode.js:84) (`countrySet=BE`), gsm-nummers naar `32` in [sales/import.js](public/js/sales/import.js), alle schermteksten Nederlands | **V** | Per bedrijf: land, feestdagen, taal (K11). |
| Rollen | [rechten.js:20-25](netlify/lib/rechten.js:20) (4 rollen), [rechten.js:27](netlify/lib/rechten.js:27) (tabel per functie) | **H** | Generiek genoeg (K9). Enkel het `zoho-agenten`-recht valt weg zonder Zoho. |
| Login, sessies, wachtwoordherstel, eerste beheerder | [auth.js](netlify/lib/auth.js), `auth-setup.js` (eerste beheerder met `BEHEER_SETUP_CODE` bij 0 gebruikers) | **H** | Ideaal voor de start van een nieuwe klant. |
| Planner-brein, tijdlijn, routes, reistijden | [planner.js](public/js/planner.js), [planner-tijdlijn.js](public/js/planner-tijdlijn.js), `route.js`, `matrix.js`, `optimize.js`, `drukte.js` (TomTom) | **H** | Het hart van het product, en wat het onderscheidt. |
| Kalender, beschikbaarheid, klantbeschikbaarheid, voorstellen | `public/js/schermen/` | **H** (na de statuslaag) | |
| Offline werking, outbox, service worker | [outbox.js](public/js/outbox.js), [sw.js](public/sw.js) | **H** | |
| Thema's als pakket | [ADR 0001](docs/adr/0001-themas-als-pakket-zonder-code.md) | **H** | Ook bruikbaar als "huisstijl van de klant". |
| Excel-exports | [excel-export.js](public/js/excel-export.js) | **V** | De TicketLog-kolommen volgen de rapportvelden. |
| Performance-dashboard | [dashboard-metrics.js](netlify/lib/dashboard-metrics.js), `netlify/lib/dashboard/*` | **V** | Leest `servicetype`, garantie, onderdelen, `interventieType`. Bij instelbare rapportvelden moet het dashboard mee, of het valt buiten de MVP. |
| Sales-planner | `public/js/sales/`, `public/js/schermen/sales-*` | **H**, als module (K10) | De import uit Excel is ook bruikbaar als basis voor de klantenimport. |
| Voorraad per wagen | [inventaris.js](public/js/inventaris.js) | **H**, als module | |
| Blitz Run (spel) | `public/js/spel/` | Blitz-only | |
| Lijsten in één blob | o.a. `rapportlijst`, `afspraken` | **H** voor kleine bedrijven | Groeit mee met het aantal rapporten; bij grote klanten een reden voor een echte database. |

Ruwe verhouding: ongeveer twee derde van de app is herbruikbaar zoals het is (planning, routes, beheer, login, offline). Ongeveer een kwart moet instelbaar worden (teksten, tarieven, prijzen, statussen, land). Opnieuw te bouwen zijn de ticketbron, het mailen en de rapportopmaak.

Over de Zoho-omvang: een zoekopdracht vindt 689 vermeldingen in 93 bestanden, maar dat overdrijft. Echte Zoho-aanroepen staan in een tiental serverfuncties (`tickets`, `plan`, `plan-datum`, `propose`, `annuleer`, `confirm-afspraak`, `comment`, `planning-sinds`, `mail-check`, `send-rapport`) en vier bibliotheekbestanden (`zoho.js`, `zoho-agenten.js`, `eigen-ticket.js`, `rapport-zoho.js`). De client kent Zoho vooral via de statusnamen en het veld `zohoNaam` bij gebruikers.

### 2. Multi-tenancy

| | a) Site per bedrijf | b) Gedeelde app, Blobs per bedrijf | c) Gedeelde app, database |
|---|---|---|---|
| Scheiding van gegevens | Volledig (Blobs, geheimen en logins per site) | Enkel zo goed als de code: één vergeten `getStore` lekt | Goed, met rijbeveiliging (RLS) als vangnet |
| Wijzigingen aan de opslag | Geen | Elke `getStore`-aanroep, ook de 4 vaste `blitz-data` | Alles herschrijven + Blitz-gegevens overzetten |
| Login per bedrijf | Vanzelf (eigen site, eigen cookie) | Bedrijf uit subdomein en sessie halen | Idem |
| Domein | `klant.<productdomein>` als eigen domein per site | Eén wildcard-domein | Eén wildcard-domein |
| Nieuwe versie uitrollen | Netlify bouwt alle sites uit dezelfde tak; wel N keer opvolgen | Eén keer | Eén keer |
| Beheerlast voor jou | Groeit per klant (instellingen, geheimen, mailinstellingen per site) | Laag | Laag, maar een database erbij om te bewaken |
| Overzicht over klanten heen (facturatie, gebruik) | Apart te bouwen | Makkelijk | Makkelijk |
| Zoeken en rapportages | Zoals nu (lijsten in blobs) | Zoals nu | Veel beter |
| Geschikt tot | ~10 à 20 klanten | — | Honderden |

Aanbeveling: **a** voor de MVP en de eerste klanten. Het belangrijkste argument voor een bouwer alleen, met een zwakke pc: geen risico dat bedrijf A de gegevens van bedrijf B ziet, en geen herbouw van de opslag. Een nieuwe klant opzetten wordt een vaste reeks stappen (nieuwe site aan de repo koppelen, geheimen instellen, EU-regio, eerste beheerder via `auth-setup`); die reeks kan later in een script.

Wat we nu al wel moeten doen, zodat c later kan: alle instellingen van een bedrijf als gegevens bewaren (één "bedrijfsprofiel"), nooit als code; en de opslag via één helper laten lopen (de seam `winkelNaam` in [testmodus.js:35](netlify/lib/testmodus.js:35) bestaat al, maar wordt nog niet overal gebruikt).

Na te kijken: of de Netlify-tegoeden per team of per site gelden (meerdere sites in één team), en hoe het bouwen van N sites bij elke push zich in tegoeden vertaalt.

### 3. PDF-bouwer

Hoe het nu werkt: de wizard bouwt de HTML van het rapport in de browser ([rapport-wizard.js:1247](public/js/rapport-wizard.js:1247)). De server maakt er met Chromium (headless browser, `@sparticuz/chromium-min` + `puppeteer-core`) een PDF van ([rapport-zoho.js](netlify/lib/rapport-zoho.js), [send-rapport.js:10-20](netlify/functions/send-rapport.js:10)). Er is ook een afdrukweergave in de browser (`printRapport`, [rapport-wizard.js:1560](public/js/rapport-wizard.js:1560)).

Mogelijke aanpakken:

| Aanpak | Voordelen | Nadelen |
|---|---|---|
| **Sjabloon als gegevens + bestaande Chromium-pijplijn (aanbevolen)** | Eén manier van tekenen; HTML/CSS geeft alles (tabellen, foto's, handtekeningen); voorbeeld in de browser = de PDF | Chromium is de zwaarste functie (tijd, kosten); tijdslimiet 26 s |
| pdfmake (beschrijving als JSON → PDF in de browser) | Werkt offline, geen server | Tweede manier van tekenen naast de bestaande; foto's en opmaak beperkter |
| jsPDF | Klein | Alles op coördinaten tekenen; veel werk voor tabellen en tekst die doorloopt |
| pdf-lib | Goed om een bestaande PDF in te vullen of samen te voegen | Niet bedoeld om een opmaak te ontwerpen |
| Aparte HTML-naar-PDF-dienst (Gotenberg, DocRaptor, ...) | Neemt de Chromium-last weg | Extra dienst, kosten, subverwerker voor GDPR |

Aanbevolen model ("rapportsjabloon"), volledig als gegevens (ADR 0001):

- **Velden**: lijst met id, label, type (tekst, lange tekst, getal, keuze, ja/nee, datum, foto's, handtekening, onderdelenlijst), verplicht, in welke wizardstap.
- **Opmaak**: een lijst blokken in volgorde: kop (logo, bedrijfsgegevens, titel), blok "klant en adres", blok "velden" (welke velden, in 1 of 2 kolommen), werkzaamheden, onderdelen met prijzen (aan/uit), foto's, handtekeningen, voettekst (bv. btw-nummer, voorwaarden). Plus kleuren en lettertype uit een vaste keuzelijst.
- **Invulvelden in tekst**: `{{klant.naam}}`, `{{ticket.nummer}}`, `{{rapport.datum}}`, … in titels en voetteksten.
- **Eén tekenaar** die sjabloon + rapportgegevens omzet in HTML. Die draait zowel in de browser (voorbeeld en afdruk) als op de server (PDF via de bestaande Chromium).
- **Editor in Beheer**: blokken toevoegen, slepen in volgorde, aan/uit, logo uploaden, met een live voorbeeld naast de editor. Geen vrije coördinaten.
- **Later**: "eigen PDF-formulier invullen" met pdf-lib (K8c), en de afspraakmails op dezelfde manier instelbaar maken.

Startsjablonen per branche (K7) zorgen dat een nieuw bedrijf niet met een leeg blad begint. Het huidige Blitz-rapport wordt het eerste sjabloon; zo kunnen we ook nagaan dat Blitz na de omschakeling dezelfde PDF krijgt.

### 4. Zoho vervangen

**Tussenlaag "ticketbron".** Alle functies praten met een vaste tussenlaag in plaats van rechtstreeks met Zoho. Er komen twee uitvoeringen: `ZohoBron` (Blitz, de huidige code erachter) en `EigenBron` (tickets in de eigen opslag). Nagegaan tegen alle huidige Zoho-aanroepen:

| Methode | Vervangt (huidig) |
|---|---|
| `lijst(statussen)` | `GET /tickets` met paginering in `tickets.js` |
| `haal(id)` | `GET /tickets/{id}` in `plan`, `plan-datum`, `propose`, `annuleer`, `comment`, `confirm-afspraak`, `planning-sinds`, `eigen-ticket` |
| `zetStatus(id, status, velden)` | `PATCH /tickets/{id}` (status + interventiedatum) in `propose`, `plan`, `plan-datum`, `annuleer`, `confirm-afspraak` |
| `notitie(id, tekst)` | `POST /tickets/{id}/comments` in `annuleer`, `confirm-afspraak`, `comment` |
| `bijlage(id, bestand)` | `/uploads` + bijlage in `propose`, `send-rapport`, `rapport-zoho` |
| `stuurMail(id, aan, onderwerp, html, bijlagen)` | `sendReply` (+ `/emailAddresses` voor de afzender) in `propose`, `annuleer`, `send-rapport` |
| `verzondenSinds(id, tijdstip)` | `GET /tickets/{id}/threads` in `mail-check` |
| `medewerkers()` | `/agents` in `tickets.js`, `zoho-agenten.js`, `eigen-ticket.js` |

Twee aandachtspunten:
- **Volgorde bij Zoho**: Zoho zet na `sendReply` de status zelf terug ("Wachten op klant"), daarom eerst mailen en dan pas de status zetten ([propose.js:288](netlify/functions/propose.js:288), [propose.js:359-360](netlify/functions/propose.js:359)). Dat gedrag hoort in `ZohoBron`, niet in de functies.
- **Het vangnet** (`rapport-vangnet`, elke 5 minuten, [netlify.toml](netlify.toml)) en de achtergrondverwerking gaan ervan uit dat Zoho de bestemming is. Bij `EigenBron` wordt "uploaden" gewoon "bewaren in de eigen opslag", wat het vangnet eenvoudiger maakt.

**Minimaal eigen model** (als blobs, zoals de rest):
- **Klant**: naam, contactpersoon, e-mail, telefoon, facturatieadres, btw-nummer (optioneel), notities.
- **Locatie/adres**: straat, postcode, gemeente, land, coördinaten (geocoding bestaat al via TomTom).
- **Ticket**: nummer (oplopend per bedrijf), klant, locatie, onderwerp, omschrijving, type (Interventie/Installatie of eigen lijst), prioriteit (Laag/Middel/Hoog), status (vaste interne lijst), toegewezen technieker, voorkeursdatum, interventiedatum, extra velden uit het rapportsjabloon, notities en historiek, bijlagen (foto's, PDF's), contacten voor mails (klant, installateur).
- **Schermen**: klantenlijst, "nieuw ticket", ticket bewerken, import uit Excel/CSV (kolommen koppelen; de importlogica van de sales-planner is een goed vertrekpunt), ticket sluiten.

**Mail**: een Europese mailservice (K6) met een register van verstuurde mails (wie, wanneer, welk ticket). Daarmee wordt `mail-check` een eenvoudige opzoeking. Antwoorden van klanten komen in de gewone mailbox van het bedrijf; de bevestigingslink ([confirm-afspraak.js](netlify/functions/confirm-afspraak.js)) blijft de manier om een afspraak te bevestigen.

**Koppelingen later** (na de MVP, op vraag van klanten): een eenvoudige inkomende API/webhook ("maak ticket aan"), daarna per systeem: Zoho (bestaat al), Teamleader, Odoo, HubSpot, Freshdesk. Welke eerst, hangt af van wat de proefklanten gebruiken; niet op voorhand bouwen.

### 5. Commercieel en praktisch

- **GDPR**: jij (of het verkopende bedrijf, K1) wordt **verwerker** van de gegevens van elke klant; het klantbedrijf is verwerkingsverantwoordelijke. Nodig: een verwerkersovereenkomst per klant, een lijst van subverwerkers (Netlify, TomTom, de mailservice; Zoho enkel voor Blitz), een bewaartermijn per soort gegeven (de opruimfuncties voor activiteit en sales doen dit al voor 12 maanden), een procedure bij datalekken, en export/wissen van alle gegevens als een klant stopt. Netlify heeft een eigen verwerkersaddendum (DPA); na te kijken welke garanties dat geeft voor doorgifte naar de VS.
- **Dataregio**: volgens de Netlify-documentatie bewaart Blobs standaard in `us-east-2` (VS), tenzij je een regio meegeeft. EU-regio's zouden er zijn, maar dat moet bij Netlify bevestigd worden. Na te kijken, ook voor Blitz zelf.
- **Hostingkosten**: Netlify rekent sinds april 2026 in "credits": Free (300 credits), Personal ($ 9/maand, 1.000 credits), Pro vanaf $ 20/maand met staffels tot $ 126/maand (20.000 credits). Dat zijn cijfers van prijsvergelijkers; nakijken op netlify.com/pricing. Grootste kostenposten per klant: het maken van PDF's (Chromium), reistijdberekeningen bij TomTom (per aanvraag) en mails. Na te kijken: of de TomTom-licentie gebruik binnen een product voor derden toelaat, of dat elke klant een eigen sleutel nodig heeft.
- **Onboarding**: een nieuwe site, bedrijfsprofiel invullen (naam, logo, kleuren, adres, afzender, tarieven, land), rapportsjabloon kiezen, gebruikers toevoegen, klanten/tickets importeren. De bestaande setup voor de eerste beheerder helpt. Reken in het begin op een paar uur begeleiding per klant.
- **Facturatie**: in het begin met de hand factureren (vanuit de boekhouding van het verkopende bedrijf); automatische betaling (bv. Stripe) pas bij een tiental klanten.
- **Support**: dit is de grootste verborgen kost voor een bouwer alleen. Nodig: één supportadres, een korte handleiding (er is al `documentatie.html`), duidelijke afspraken over reactietijd, en de bestaande foutenlog en systeemstatus per klant. Wie neemt over als jij met verlof bent?
- **Aparte repo of zelfde codebasis**: zie K2; aanbevolen: dezelfde codebasis met Blitz als tenant. Branchbeleid: het oude beleid (`main` alleen bugfixes, `refactor` voor groot werk) is afgelopen sinds v2.0.0; voor dit project een nieuw afspraak maken (bv. een eigen lange tak, met `main` als live Blitz-versie die steeds binnengehaald wordt).
- **Voltara**: Brent bouwt daarnaast Voltara. Dit rapport maakt daar geen aannames over; zie K15.

## Stappenplan

Omvang: S = enkele dagen, M = 1 à 2 weken, L = 3 à 4 weken, XL = meer dan een maand (telkens deeltijds met Claude). Elke fase eindigt met de Blitz-tenant ongewijzigd werkend (bestaande tests groen).

| Fase | Inhoud | Omvang |
|---|---|---|
| **0. Beslissen** | K1 (eigendom, schriftelijk), K2-K4, K13; één proefklant zoeken die meewil | geen code |
| **1. Blitz uit de code** | Bedrijfsprofiel als gegevens: naam, logo, kleuren, adres, website, afzender, voorwaarden-PDF, domein/CORS, tarieven, prijscategorieën, land en feestdagen. Alle vaste Blitz-teksten in mails, pagina's en manifest daarvan laten afhangen. Modules aan/uit (K10). Blobs naar een EU-regio (eerst testen hoe Blitz overgezet wordt). | M |
| **2. Eigen tickets en mail** | Tussenlaag "ticketbron" met `ZohoBron` (Blitz) en `EigenBron`. Statussen als vaste interne lijst. Schermen: klanten, nieuw ticket, import CSV/Excel. Mailservice + mailregister; `mail-check` daarop. `zohoNaam` wordt optioneel. | L |
| **3. Rapportsjabloon + PDF-bouwer** | Velden en opmaak als gegevens; één tekenaar voor browser en server; blokken-editor in Beheer; startsjablonen per branche; het huidige Blitz-rapport als eerste sjabloon (zelfde PDF als nu). TicketLog-export en dashboard aan de velden aanpassen, of het dashboard voorlopig beperken tot de vaste velden. | L |
| **4. Eerste proefklant (MVP)** | Stappen voor een nieuwe site (later een script), verwerkersovereenkomst, handleiding, begeleide start, twee à vier weken meekijken. | M |
| **5. v1** | Op basis van wat de proefklant zegt: facturatie en betaling, een eenvoudige inkomende API, de eerste koppeling(en), Frans, zelf starten zonder begeleiding, overzicht over alle klanten heen. Bij meer dan ~10 klanten: overstap naar één gedeelde app met database (K3c). | XL |

MVP = fase 1 tot 4: ruwweg 2 à 3 maanden. Dat is een grove schatting. De echte onzekerheden zijn niet het programmeerwerk, maar fase 0 (het akkoord met Blitz) en de feedback van de proefklant.

## Risico's

| # | Risico | Gevolg | Wat eraan te doen |
|---|---|---|---|
| R1 | **Eigendom van de code onduidelijk** (gebouwd voor Blitz Power, door een werknemer) | Juridisch conflict, verkoop onmogelijk | K1 eerst en schriftelijk; niets verkopen of beloven vóór dat akkoord |
| R2 | Gegevens van bedrijf A zichtbaar voor bedrijf B | Datalek, GDPR-melding, vertrouwen weg | Aparte site per bedrijf (K3a); bij een latere gedeelde app: database met rijbeveiliging en tests op scheiding |
| R3 | Productwerk breekt de live Blitz-app | Storing bij Blitz | Blitz als eerste tenant, bestaande tests als vangnet, apart spoor in git, uitrollen zoals nu met versie- en cachenummer |
| R4 | Gegevens in de VS (standaardregio Blobs) | GDPR-bezwaar van klanten | EU-regio instellen en bij Netlify bevestigen (K13); Netlify-DPA nakijken |
| R5 | Supportlast voor één persoon, naast een voltijdse job | Trage hulp, ontevreden klanten, overbelasting | Klein beginnen (1 proefklant), handleiding, duidelijke reactietijden, een vervanger afspreken |
| R6 | Kosten van PDF's en TomTom stijgen per klant | Marge weg | Gebruik per klant meten (de meting van v2.6.0 is een basis), prijsmodel per technieker (K12), TomTom-licentie nakijken |
| R7 | Chromium-functie te traag of te zwaar (limiet 26 s) bij grotere rapporten met veel foto's | PDF mislukt | Het vangnet bestaat al; foto's verkleinen; eventueel een aparte PDF-dienst |
| R8 | Lijsten in één blob (`rapportlijst`, `afspraken`) worden groot bij grotere klanten | Traag, kans op botsende schrijfacties | Grens per klant bewaken; overstap naar een database (K3c) wanneer nodig |
| R9 | Concurrentie van gevestigde planningssoftware voor buitendiensten | Moeilijk verkopen | Focus op een niche (K4) en op de sterkte: het planner-brein met reistijden en routes |
| R10 | Aansprakelijkheid (bv. een gemiste afspraak door een fout in de planner) | Schadeclaims | Algemene voorwaarden met beperking van aansprakelijkheid, mee in het juridisch advies van K1 |
| R11 | Alleen Nederlands | Kleinere markt | K11: teksten nu al uit de code halen, vertalen bij de eerste Franstalige klant |

Bronnen (prijzen en regio, na te kijken bij Netlify zelf): [Netlify Blobs-documentatie](https://docs.netlify.com/build/data-and-storage/netlify-blobs.md), [Netlify changelog: credit-based plans](https://www.netlify.com/changelog/updates-credit-based-personal-and-pro-plans.md), [prijsoverzicht (derde partij)](https://netli.fyi/blog/netlify-pricing-and-limits).

## In drie regels

1. Ongeveer twee derde van de app is herbruikbaar; Zoho (tickets én mails), het rapport en de Blitz-teksten, prijzen en tarieven moeten instelbaar of vervangen worden.
2. Aanbevolen: één codebasis met Blitz als klant, een aparte Netlify-site per bedrijf, een eigen ticketregister met import, en een blokken-PDF-bouwer bovenop de bestaande Chromium-pijplijn.
3. Eerst het eigendom met Blitz Power schriftelijk regelen en de gegevens naar de EU brengen; daarna ruwweg 2 à 3 maanden tot een eerste proefklant.
