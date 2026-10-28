# Vergelijking Blitz Planning 2.5.1: nu en geoptimaliseerd

*Skelet, opgesteld op 2026-10-28. De kolom "2.5.1 (nu)" is ingevuld met de meting van de live versie. De kolommen "Geoptimaliseerd" en "Verschil" worden na de optimalisatie aangevuld (nu staat er overal "volgt").*

## Waarom deze meting

Het doel van deze nacht is dat de app sneller en stabieler wordt, zonder dat iets er anders uitziet of werkt. Om dat te kunnen bewijzen meten we eerst hoe de app NU presteert (versie 2.5.1, de live versie), en daarna opnieuw met exact dezelfde meetmethode op de geoptimaliseerde versie. Alleen zo is het verschil eerlijk.

## Hoe gemeten

- **Machine**: een Windows 11-laptop met een Intel Core i5-1135G7 (8 verwerkingsdraden) en 40 GB geheugen; Node v24.18.0, Playwright 1.63.0, een onzichtbare Chromium-browser (geen echt scherm). Tijdens elke meting liep er geen andere browsertest op de machine; de metingen draaiden na elkaar.
- **Testmodus**: de app draait in testmodus (`?test`) met verzonnen gegevens. Er is geen echte klantendata, geen Zoho, geen TomTom en geen mail bij betrokken; elk verzoek naar de server wordt door een eigen minimale nepserver beantwoord en alles buiten de eigen computer is afgesloten (op de twee bibliotheek-hosts na waar de app zijn kaart en handtekeningmodule vandaan haalt).
- **Rol**: de standaardrol van de planner (Coordinator), ingelogd als beheerder, zodat alle tabbladen bereikbaar zijn.
- **Gegevens**: 30 tickets in de wachtrij en 28 geplande tickets verspreid over de werkweek, zoals een drukke dag. De klok staat vast op maandag 5 oktober 2026, 09:00, zodat elke meting dezelfde week toont.
- **Telefoon**: schermgrootte 375 x 812 met aanraking en de processor kunstmatig 4 keer trager gemaakt (een middenklasse-gsm). **Computer**: schermgrootte 1440 x 900, processor op volle snelheid.
- **Aantal metingen en mediaan**: elke meting is 5 keer herhaald; in de tabellen staat de **mediaan** (de middelste waarde, zodat een uitschieter niet doorweegt) met tussen haakjes de laagste en hoogste waarde ("spreiding").
- **Afwisselend meten**: bij de vergelijking meten we de oude en de nieuwe versie om en om (oud, nieuw, nieuw, oud, ...) in dezelfde sessie, zodat een drukke of rustige minuut van de computer beide versies even hard raakt. Voor de baseline is enkel de oude versie gemeten.
- **Opstarten** wordt gemeten met een server die 0 ms of 150 ms wacht per bestand (150 ms bootst een trage verbinding na).
- **De handelingen**: een vast scenario van 29 handelingen op de computer en 26 op de telefoon (op de telefoon bestaat het tabblad Route niet): alle tabbladen drie keer rond, 6 keer van week wisselen, 4 keer een ticket openen en weer sluiten. Een handeling is klaar als het scherm getekend is.
- **Stabiliteit**: een selectie van 8 testbestanden van de automatische testen (opstart, kalender, wachtrij, ticketdetail, verbinding en offline), twee keer na elkaar uitgevoerd, zonder opnieuw proberen.
- **Kleine schommelingen**: schermen worden 60 keer per seconde getekend, dus tijden onder ongeveer 17 ms schommelen vanzelf; kijk naar de mediaan en de spreiding, niet naar één run.
- Ruwe cijfers en alle runs staan in `docs/optimalisatie/meting-baseline-*.json`; de meetscripts zijn `scripts/meet-laden.mjs`, `scripts/meet-snelheid.mjs` en `scripts/meet-interactie.mjs`.

## 1. Opstarten

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tijd tot bruikbaar, snelle server: eerste bezoek (niets onthouden) | 682 ms (631 tot 1955) | volgt | volgt |
| Tijd tot bruikbaar, snelle server: tweede bezoek (browser onthoudt bestanden) | 533 ms (443 tot 695) | volgt | volgt |
| Tijd tot bruikbaar, snelle server: tweede bezoek met de achtergrondservice van de app (service worker) | 447 ms (389 tot 477) | volgt | volgt |
| Tijd tot bruikbaar, server met 150 ms vertraging: eerste bezoek (niets onthouden) | 4298 ms (4268 tot 4413) | volgt | volgt |
| Tijd tot bruikbaar, server met 150 ms vertraging: tweede bezoek (browser onthoudt bestanden) | 3853 ms (3821 tot 3904) | volgt | volgt |
| Tijd tot bruikbaar, server met 150 ms vertraging: tweede bezoek met de achtergrondservice van de app (service worker) | 3858 ms (3849 tot 3867) | volgt | volgt |
| Aantal verzoeken aan de server: eerste bezoek (niets onthouden) | 142 | volgt | volgt |
| Aantal verzoeken aan de server: tweede bezoek (browser onthoudt bestanden) | 142 | volgt | volgt |
| Aantal verzoeken aan de server: tweede bezoek met de achtergrondservice van de app (service worker) | 155 | volgt | volgt |
| Overgedragen gegevens: eerste bezoek (niets onthouden) | 1489 kB | volgt | volgt |
| Overgedragen gegevens: tweede bezoek (browser onthoudt bestanden) | 36 kB | volgt | volgt |
| Overgedragen gegevens: tweede bezoek met de achtergrondservice van de app (service worker) | 6 kB | volgt | volgt |
| Inladen van het rapportscherm (rapport-wizard.js, 84 kB) op een 4x tragere processor | 9 ms (8 tot 11) | volgt | volgt |

- **Tijd tot bruikbaar**: hoe lang het duurt vanaf het openen van de app tot de lijst met tickets er staat en de app reageert. Lager is beter.
- **Eerste bezoek / tweede bezoek**: het eerste bezoek haalt alles op; bij een tweede bezoek heeft de browser al bestanden bewaard (met of zonder de achtergrondservice van de app).
- **Aantal verzoeken**: hoeveel losse bestanden de app bij het opstarten opvraagt. Minder is beter, want elk bestand kost wachttijd op een trage verbinding.
- **Overgedragen gegevens**: hoeveel kilobyte er echt over de lijn gaat. Minder is beter, vooral op mobiel internet.
- **Inladen van het rapportscherm**: de rekentijd die de telefoon nodig heeft om het rapportscherm klaar te maken; de grens is 150 ms.

## 2. Scrollen op de telefoon

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tijd tot het eerste ticket zichtbaar is (telefoon) | 2956 ms (2675 tot 3530) | volgt | volgt |
| Soepel scrollen in Wachtrij: beelden in 3 seconden (hoger is beter, 180 = perfect) | 119 (111 tot 137) | volgt | volgt |
| Haperingen tijdens scrollen in Wachtrij: totale duur van lange taken | 0 ms | volgt | volgt |
| Soepel scrollen in Kalender: beelden in 3 seconden (hoger is beter, 180 = perfect) | 98 (86 tot 102) | volgt | volgt |
| Haperingen tijdens scrollen in Kalender: totale duur van lange taken | 0 ms | volgt | volgt |
| Soepel scrollen in Ingepland: beelden in 3 seconden (hoger is beter, 180 = perfect) | 165 (133 tot 167) | volgt | volgt |
| Haperingen tijdens scrollen in Ingepland: totale duur van lange taken | 0 ms | volgt | volgt |

- **Tijd tot het eerste ticket**: hoe lang een telefoon nodig heeft voordat het eerste ticket op het scherm staat. Lager is beter.
- **Beelden in 3 seconden**: hoeveel keer het scherm ververst wordt terwijl er drie seconden heen en weer wordt geveegd; 180 betekent perfect vloeiend (60 per seconde), lager betekent schokkerig. Hoger is beter.
- **Lange taken**: momenten waarop de app langer dan 50 ms vastzit. In de baseline is dit nul tijdens het scrollen: de telefoon scrolt via de grafische chip, dus dit cijfer verandert alleen als er echt iets stokt.

## 3. Computer: tabbladen, kalender, ticketdetail en geheugen (1440 x 900)

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tabblad Kalender openen, eerste bezoek | 99,8 ms (88,1 tot 106,8) | volgt | volgt |
| Tabblad Kalender openen, herhaald bezoek | 42,8 ms (36,4 tot 46,5) | volgt | volgt |
| Tabblad Route openen, eerste bezoek | 111,5 ms (89,5 tot 135,6) | volgt | volgt |
| Tabblad Route openen, herhaald bezoek | 76,1 ms (34,6 tot 107,3) | volgt | volgt |
| Tabblad Ingepland openen, eerste bezoek | 50,8 ms (35,9 tot 61,9) | volgt | volgt |
| Tabblad Ingepland openen, herhaald bezoek | 52,6 ms (41,3 tot 75,9) | volgt | volgt |
| Tabblad Inventaris openen, eerste bezoek | 55,6 ms (41,5 tot 65,7) | volgt | volgt |
| Tabblad Inventaris openen, herhaald bezoek | 56 ms (40,3 tot 75,6) | volgt | volgt |
| Tabblad Rapporten openen, eerste bezoek | 28,1 ms (21,2 tot 31,7) | volgt | volgt |
| Tabblad Rapporten openen, herhaald bezoek | 24,2 ms (20,2 tot 33,8) | volgt | volgt |
| Tabblad Wachtrij openen, herhaald bezoek | 37,3 ms (29 tot 52,3) | volgt | volgt |
| Kalender: volgende week openen (lege week) | 16,1 ms (11,3 tot 39,1) | volgt | volgt |
| Kalender: terug naar de volle week | 25,8 ms (20,5 tot 28,1) | volgt | volgt |
| Ticketdetail openen vanuit de Wachtrij | 52,6 ms (20,5 tot 79,1) | volgt | volgt |
| Ticketdetail openen vanuit de Kalender | 37,5 ms (20,6 tot 78,8) | volgt | volgt |
| Langste hapering (lange taak) tijdens de sessie | 81 ms (72 tot 88) | volgt | volgt |
| Aantal haperingen (lange taken) tijdens de sessie | 2 | volgt | volgt |
| Geheugen van de app na het laden | 3,4 MB | volgt | volgt |
| Geheugen van de app na de sessie | 4 MB | volgt | volgt |
| Foutmeldingen van de app in de console | 0 | volgt | volgt |
| Waarschuwingen van de app in de console | 0 | volgt | volgt |

- **Tabblad openen**: de tijd tussen het klikken op een tabblad en het moment dat het scherm getekend is. Het eerste bezoek moet alles opbouwen, een herhaald bezoek profiteert van wat al klaarstaat (bij de Wachtrij is elk bezoek een terugkeer, want die staat bij het opstarten al open). Lager is beter.
- **Kalender: week wisselen**: de tijd tussen het klikken op de pijl voor volgende of vorige week en het getekende resultaat. "Volgende week" is een lege week, "terug" is de volle week met 28 tickets en toont dus de echte opbouwtijd.
- **Ticketdetail openen**: de tijd tussen het klikken op een ticketkaart en het getekende detailvenster.
- **Hapering (lange taak)**: een moment waarop de app langer dan 50 ms niets anders kan doen; tijdens zo'n moment reageert het scherm niet. De langste is de ergste ervaring in de sessie. Lager is beter.
- **Geheugen**: hoeveel geheugen de app zelf (de JavaScript-gegevens) vasthoudt, nadat de browser opgeruimd heeft. Een sessie van 29 handelingen mag dit nauwelijks laten groeien.
- **Foutmeldingen en waarschuwingen**: meldingen die de app zelf in het technische logboek van de browser schrijft. Het doel is nul. (Meldingen over bewust afgesloten externe websites en de bekende testruis van de geblokkeerde achtergrondservice tellen niet mee; die staan apart in het JSON-bestand.)

## 4. Telefoon: tabbladen, kalender, ticketdetail en geheugen (375 x 812, processor 4x trager)

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Tabblad Kalender openen, eerste bezoek | 1267,2 ms (1129,6 tot 1317,6) | volgt | volgt |
| Tabblad Kalender openen, herhaald bezoek | 466 ms (410,8 tot 527,4) | volgt | volgt |
| Tabblad Ingepland openen, eerste bezoek | 629,9 ms (579,9 tot 808,9) | volgt | volgt |
| Tabblad Ingepland openen, herhaald bezoek | 563,2 ms (518,1 tot 669,4) | volgt | volgt |
| Tabblad Inventaris openen, eerste bezoek | 194,3 ms (161,7 tot 232,4) | volgt | volgt |
| Tabblad Inventaris openen, herhaald bezoek | 143,8 ms (129,9 tot 154,6) | volgt | volgt |
| Tabblad Rapporten openen, eerste bezoek | 241,5 ms (209 tot 251,2) | volgt | volgt |
| Tabblad Rapporten openen, herhaald bezoek | 157,9 ms (136,6 tot 187,3) | volgt | volgt |
| Tabblad Wachtrij openen, herhaald bezoek | 151,6 ms (123,1 tot 164) | volgt | volgt |
| Kalender: volgende week openen (lege week) | 119,3 ms (112,4 tot 147,3) | volgt | volgt |
| Kalender: terug naar de volle week | 334,9 ms (293,5 tot 342,1) | volgt | volgt |
| Ticketdetail openen vanuit de Wachtrij | 110 ms (78,7 tot 127,8) | volgt | volgt |
| Ticketdetail openen vanuit de Kalender | 221,6 ms (203,8 tot 253,8) | volgt | volgt |
| Langste hapering (lange taak) tijdens de sessie | 914 ms (844 tot 969) | volgt | volgt |
| Aantal haperingen (lange taken) tijdens de sessie | 50 | volgt | volgt |
| Geheugen van de app na het laden | 3,4 MB | volgt | volgt |
| Geheugen van de app na de sessie | 3,7 MB | volgt | volgt |
| Foutmeldingen van de app in de console | 0 | volgt | volgt |
| Waarschuwingen van de app in de console | 2 | volgt | volgt |

De uitleg bij de cijfers is dezelfde als bij punt 3. De twee waarschuwingen op de telefoon zijn meldingen van de tijdelijke "scrollsprong-verklikker" (alleen in testmodus, niets wordt verzonden).

## 5. Stabiliteit (automatische testen)

| Metriek | 2.5.1 (nu) | Geoptimaliseerd | Verschil |
|---|---|---|---|
| Aantal verschillende tests | 127 | volgt | volgt |
| Uitvoeringen (elke test 2x) | 254 | volgt | volgt |
| Geslaagd | 254 | volgt | volgt |
| Mislukt | 0 | volgt | volgt |
| Flaky (slaagt pas bij een tweede poging) | 0 | volgt | volgt |
| Overgeslagen | 0 | volgt | volgt |
| Tests die de ene keer slaagden en de andere keer faalden | 0 | volgt | volgt |
| Duur van de run | 7 minuten | volgt | volgt |

- **Geslaagd / mislukt**: het aantal uitvoeringen van een test dat slaagde of faalde. Doel: geen enkele mislukking.
- **Flaky**: een test die faalt en bij een nieuwe poging slaagt. In deze meting wordt er niet opnieuw geprobeerd, dus dit blijft nul; het echte signaal staat in de volgende regel.
- **Een keer geslaagd, een keer gefaald**: een test die in de ene van de twee herhalingen slaagt en in de andere faalt: dat is onbetrouwbaarheid, en precies wat we willen terugdringen.

In de baseline slaagden alle tests in beide herhalingen.

## Conclusie

Volgt na de optimalisatie.
