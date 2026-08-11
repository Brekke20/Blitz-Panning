# Installatierapport "Extra kosten buiten standaard"

**Datum:** 2026-08-11
**Status:** Approved, ready for implementation plan

## Aanleiding

Brent's leidinggevende wil voor particuliere installaties een servicerapport analoog aan het
bestaande interventie-service-rapport, specifiek om meerkosten buiten het standaardpakket vast
te leggen (prijslijst in bijlage: "Particuliere Installaties - Extra Kosten buiten Standaard
2026.xlsx", tabblad "Prijzen 2026" — ~35 vaste-prijs-items: kabels/utp, automaten/differentieels,
kastjes, extra's, infra/graafwerk). Gevraagde velden: datum, technieker, adres, start/eindtijd,
serienummer (manueel), foto's, loonkost (meerkosten-tabel + vrij totaal voor extra materialen),
handtekeningen technieker + klant.

Particuliere installaties komen **nooit** als Zoho-ticket binnen — ze worden altijd manueel
aangemaakt via "+ afspraak" in de planning-tab (`event.type === 'Installatie'`, lokale
pseudo-ticket via `getPlanningTicket()`). Er verandert dus niets aan Zoho-koppeling of de
outbox/archief-flow: dit rapport wordt, net als vandaag, enkel lokaal gearchiveerd (geen
`check-zoho`-stap, want `ticket.isLocal === true`).

Er bestaat al een eerder designdoc/implementatie voor installatierapporten
(`2026-07-31-installatierapport-design.md`): dat voegde een automatisch bepaald
`R.interventieType`, een aparte "Materialen"-labeling van de bestaande onderdelen-stap
(met eenheid stuk/meter), het overslaan van de Facturatie/Status-velden, en een
Service/Installatie-filter op het rapportenoverzicht toe. Dit designdoc **bouwt daarop verder**
— het vervangt niet de architectuur, maar herschikt welke stappen een installatierapport
doorloopt en herbruikt het bestaande onderdelen-mechanisme voor de nieuwe meerkosten-catalogus.

## Beslissingen (uit het brainstormgesprek)

1. **Dit rapport vervangt het installatierapport volledig** — geen tweede, apart document.
   Interventierapporten blijven ongewijzigd.
2. **Geen backend-wijziging.** Opslag blijft de bestaande `blitz-data`-blob
   (`rapportlijst` via `rapport-archief.js`), gediscrimineerd via het al-bestaande
   `R.interventieType`. Het bestaande Service/Installatie-filter op het rapportenoverzicht
   werkt hier ongewijzigd op mee.
3. **De Meerkosten-2026-prijslijst wordt geïmporteerd in de bestaande prijzencatalogus**
   (`netlify/functions/prijzen.js` / `PRIJZEN_DEFAULTS`), niet als los systeem. De
   prijzen-beheerpagina (instellingen) krijgt **2 tabs: "Interventies" en "Installaties"**,
   bepaald door een nieuw `groep`-veld op elke categorie (`'interventie'` | `'installatie'`).
   Nieuwe categorieën onder "Installaties": Kabels & benodigdheden, Automaten & differentieels,
   Kasten & benodigdheden, Extra's, Infra & graafwerken — 1-op-1 uit de secties van het
   Excel-bestand, inclusief alle prijzen. Nadien op dezelfde manier aanpasbaar als vandaag bij
   interventie-onderdelen (naam/prijs/tags bewerken, item toevoegen/verwijderen).
4. **De bestaande "Materialen"-stap (onderdelen-catalogus, vandaag al actief bij
   installatierapporten sinds 31/07) wordt hernoemd naar "Meerkost" en gescopet tot enkel de
   categorieën met `groep:'installatie'`** — de technieker ziet dus geen laadpaal-onderdelen
   (controllers, energiemeters, …) meer in dit rapport, enkel de meerkosten-catalogus. Aantal
   invullen per item werkt zoals vandaag; subtotaal wordt automatisch berekend.
5. **Nieuw veld `R.extraMaterialenTotaal`**: één vrij invoerbaar totaalbedrag (naast de
   Meerkost-tabel) voor materiaal dat niet in de catalogus staat. Geen regel-items, gewoon één
   bedrag — eigen nieuwe wizardstap "Extra materialen".
6. **Serienummer verhuist naar de "Algemeen"-stap.** Vandaag leeft `R.serienummer` in de
   "Product"-stap (`f-serienummer`, regel 5840-5841 van vóór deze wijziging) — die stap valt
   weg (zie punt 7), dus het veld moet ergens anders landen. "Algemeen" (datum/technieker/adres/
   start-stop) is de logische plek, blijft een vrij tekstveld, geen validatie.
7. **De stappen "Product" (laadpaal type/uitvoering/kabel) en "Omschrijving" (probleem/acties)
   vallen volledig weg voor installatierapporten** — bewust, in lijn met het exacte lijstje van
   de leidinggevende. Dat betekent: laadpaal-configuratie (Single/Dual, Tower/Wall, Socket/vaste
   kabel) wordt vanaf nu nergens meer geregistreerd bij installaties, en de TicketLog-export-
   kolommen "Notities"/"Actie" (die `R.probleem`/`R.acties` uitlezen) blijven leeg voor
   installatie-rijen. Beide bewust aanvaard, geen mitigatie voorzien.
8. **Nieuwe stappenset voor installatierapporten (6 stappen, i.p.v. de huidige 7):**
   1. Algemeen — datum, technieker, adres, type bezoek, start/stoptijd, **+ serienummer**
   2. Foto's — ongewijzigd, bestaand mechanisme
   3. Meerkost — hernoemde/geschaalde bestaande onderdelen-stap (zie punt 4)
   4. Extra materialen — nieuw, één vrij totaalbedrag (zie punt 5)
   5. Handtekening technieker — ongewijzigd
   6. Handtekening klant — ongewijzigd (incl. live rapport-voorbeeld)

   Interventierapporten behouden hun bestaande 8 stappen ongewijzigd. Architecturaal worden dit
   twee losstaande stappen-arrays (`WIZ_STEPS_INTERVENTIE`, `WIZ_STEPS_INSTALLATIE`) i.p.v. één
   array met steeds meer `if (isInstallatie)`-vertakkingen per stap — voorkomt dat de al
   aanwezige vertakkingen (Facturatie/Status, sinds 31/07) verder uitdijen tot onleesbaarheid.
9. **PDF-rapport (`buildRapportHtml()`) — installatie-variant, aangepast t.o.v. 31/07:**
   - Header/branding, klantgegevens, datum/technieker/start-stop/serienummer, foto's,
     handtekeningen: ongewijzigd/gedeeld met het interventierapport.
   - Productinfo-sectie en "Omschrijving installatie"-sectie: volledig weggelaten (velden
     bestaan niet meer, zie punt 7).
   - Tabel "Gebruikte materialen" → **"Meerkost"** (zelfde tabelopmaak, nu gevoed vanuit de
     installatie-catalogus).
   - Kostenoverzicht toont: Meerkost-subtotaal + Extra materialen (`R.extraMaterialenTotaal`)
     + eindtotaal. Geen loonkosten-regel (zoals al sinds 31/07 het geval is bij installatie).
   - Documenttitel: **"Rapport Meerkost Installatie"** i.p.v. "Service Rapport".

## Addendum (2026-08-12) — lengte-afhankelijke tarieven voor kabels

Tijdens Brent's lokale acceptatietest bleek de "boven 10 meter"-naamgeving in de Prijzen-2026-
kabelitems niet zomaar een letterlijk label te zijn, maar een echte tarief-logica die de
oorspronkelijke import (§3, "Meerkosten-catalogus") niet correct verwerkte. **Voorlopige aanname,
nog te bevestigen door Brent's supervisor:**

- **"Datakabel" (was 2 losse catalogus-items: "Datakabel boven 10 meter" € 4,57/m en "Data kabel
  CAT6" € 6,50/m)** — dit is hetzelfde materiaal, twee tarieven naargelang lengte. Samengevoegd tot
  1 item "Datakabel": bij een ingegeven lengte ≤ 10m geldt € 6,50/m voor de volledige lengte, bij
  > 10m geldt € 4,57/m voor de volledige lengte (1 tarief voor de hele lengte, geen mix). De
  technieker ziet nu nog maar 1 materiaal, geen CAT6-benaming meer.
- **De overige 3 "boven 10 meter"-items** (Elektriciteitskabel boven 10m € 14,49/m;
  Elektriciteitskabel + datakabel boven 10m € 17,72/m; Elektriciteitskabel XGB5G10 + datakabel
  boven 10m € 22,65/m) — voorlopige aanname: de eerste 10 meter zit al in de standaardofferte,
  enkel het aantal meter **daarboven** wordt aangerekend (`(lengte - 10) × tarief`, minimum € 0).
- **Kabel XGB5G10 en Aardingkabel** blijven een vast tarief per meter (geen drempel), maar stonden
  aanvankelijk foutief op eenheid "stuk" i.p.v. "meter" — gecorrigeerd.

Technisch: nieuwe, optionele velden op een catalogus-/onderdelen-item — `prijsmodel: 'overschot' |
'drempel'`, `drempel` (meter), `prijsOnder` (enkel bij `'drempel'`) — gelezen door een nieuwe,
overal herbruikte helper `berekenOnderdeelSubtotaal(p)`. Zonder `prijsmodel` verandert er niets
(`aantal × prijs`, exact zoals voorheen — interventierapporten gebruiken dit veld nooit).

**Belangrijk:** deze helper is nu de ENIGE plek waar een onderdeel-subtotaal berekend wordt, en
wordt gebruikt door alle 6 plekken die dat ooit deden: de wizard-preview
(`_wizRenderGeselecteerd`/`_wizTotaalRij`), de PDF (`buildRapportHtml`), het archiefoverzicht
(`renderRapportArchief`), de TicketLog-Excel-export, en de outbox-archiefpayload
(`printRapport`). Vóór dit addendum berekenden minstens 2 van die plekken (archiefoverzicht en
TicketLog-export) een eigen, ongesynchroniseerde `aantal × prijs`-som — exact het patroon dat de
finale review van deze PR al eerder blootlegde voor `extraMaterialenTotaal` (zie git-historiek).
Bij een volgende prijsmodel-wijziging: enkel `berekenOnderdeelSubtotaal()` aanpassen, nooit een
nieuwe losse berekening toevoegen.

**Nog niet gebouwd:** een beheerscherm voor `prijsmodel`/`drempel`/`prijsOnder` — die 6 velden
zijn enkel in de broncode aanpasbaar, niet via Prijsbeheer. Bewust uitgesteld gezien de regel nog
niet definitief bevestigd is; als de regel standhoudt na bevestiging door Brent's supervisor, is
een beheer-UI hiervoor een aparte, kleine vervolgtaak.

## Niet in scope

- Geen wijziging aan Zoho (installaties blijven volledig lokaal, zoals sinds 31/07 vastgelegd).
- Geen wijziging aan het interventierapport, de outbox/archief-flow, of `rapport-archief.js`.
- Geen validatie/verplichting op het vrije `extraMaterialenTotaal`-veld — technieker kan het
  ook op 0/leeg laten.
- Geen mitigatie voor het verlies van laadpaal-configuratie- en
  omschrijving/actie-registratie bij installaties (bewust aanvaard, zie punt 7).
- Geen wijziging aan `PRIJZEN.tarieven` (labor-rate-catalogus) — blijft ongebruikt, zoals vandaag.
