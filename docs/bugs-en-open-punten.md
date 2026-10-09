# Bugs en open punten (gevonden tijdens de refactor)

Bijgehouden sinds oktober 2026. Status per punt: **opgelost op refactor** of **open**.
De live versie (`main`) krijgt enkel bugfixes; bij elk punt in deel A kan Brent kiezen of het
als losse bugfix al live moet, of wacht tot de refactor uitkomt.

## A. Fouten die nu in de live versie zitten — al opgelost op de refactor-tak

Kandidaten voor een losse bugfix op `main`.

| # | Wat gaat er mis (live) | Ernst | Opgelost in |
|---|---|---|---|
| A1 | Afspraken: slaat een collega op hetzelfde moment iets op, dan gaat jouw wijziging stil verloren (pagina herlaadt, enkel een melding). | Hoog: gegevensverlies | etappe 2 |
| A2 | "Oplossing → Zoho" toont soms "Oplossing kon niet automatisch bijgewerkt worden" terwijl het wél gelukt is (leeg antwoord van Zoho). | Middel | etappe 6 |
| A3 | Een onleesbaar serverantwoord (bv. Netlify-time-out, foutpagina 502) toont een technische tekst ("Unexpected token '<' … is not valid JSON") bij inplannen, toewijzen, verzetten, voorstel, rapport en oplossing. | Middel | etappe 5b |
| A4 | De routelijst ververst niet na "Toewijzen" of een nieuwe eigen afspraak, tot je op "Bereken tijden" klikt. | Laag | etappe 3 |
| A5 | "Bellen" op een gsm-kaartje in de kalender opent ook de ticketfiche. | Laag | etappe 4 |
| A6 | De wachtrij toont eindeloos "Laden..." als er geen tickets (meer) zijn. | Laag | etappe 4 |
| A7 | Mislukt het bewaren van de routevolgorde, dan verdwijnt de foutmelding meteen (overschreven door de telmelding). | Laag | etappe 5a |
| A8 | De tab Beschikbaarheden loopt vast als in de instellingen geen enkele werkdag is aangevinkt en er ≥ 2 blokkeringen in de toekomst staan. | Middel | etappe 5b |
| A9 | De klantvoorkeur-labels in de wachtrij ontbreken soms bij de eerste keer openen (klantbeschikbaarheid komt later binnen dan de wachtrij getekend wordt). | Middel | etappe 7 |
| A10 | Wagenvoorraad: past een collega tegelijk de voorraad aan, dan gaat de aftrek na een verzonden rapport stil verloren. | Middel | etappe 7 |
| A11 | Een hangende verbinding laat een knop of het annuleervenster eindeloos vast staan (geen tijdslimiet). | Middel | etappe 7 |
| A12 | Na een mislukte "Vernieuwen" kan de app oude (bewaarde) gegevens terugzetten. | Middel | etappe 7 |
| A13 | De TEST-badge in de kop was onzichtbaar in testmodus. | Laag | etappe 0/2 |
| A14 | (Enkel op refactor, nooit live: nieuw in etappe 7, I1.) De mailcontrole na een onzeker resultaat kon na een snelle fout (bv. verbinding valt na 1 s weg) vals "niet verzonden — veilig opnieuw" melden terwijl de serverfunctie nog tot 26 s doorwerkte en de mail alsnog vertrok: dubbele klantmail. Nu pas "niet verzonden" na een tweede controle 30 s na de start. | Hoog (op refactor) | etappe 7, finale fix A |
| A15 | (Enkel op refactor, nooit live: nieuw in etappe 7, I2.) De brede mailcontrole (rapport, annuleren) gebruikte de klok van het toestel als begintijd: liep die ook maar een seconde voor, dan werd een wél verzonden mail gemist (vals "niet verzonden"). Nu stuurt het toestel enkel de verstreken tijd en rekent de server met zijn eigen klok; de marge per adres is van 2 min naar 10 s (M11). | Hoog (op refactor) | etappe 7, finale fix A |
| A16 | (Enkel op refactor, nooit live: gevonden in de eindreview, I1.) De mailcontrole mat de verstreken tijd met `performance.now()`, die stilstaat terwijl het toestel slaapt. Na verzenden en slaapstand viel de mail buiten het zoekvenster van de server: vals "niet verzonden" en een dubbele klantmail. Nu `verlopenMs = max(performance.now-verschil, Date.now-verschil)`, nooit negatief; zelfde maximum voor de wachttijd van de tweede controle. | Hoog (op refactor) | etappe 9, release-fixes |
| A17 | (Live bug, gevonden in de proefperiode van de refactor; opgelost op refactor.) Op een dag die al 2 interventies heeft en binnen de werkuren geen ruimte meer, plaatsten zowel "+" (eerstvolgende vrije dag) als "⚡ Plan deze week" nog een ticket, dat in de Route-tab achter de werkuren verscheen. "+" telde slots (standaard 3) en kende vaste uren, eigen afspraken en reistijd niet; het brein ketende bestaande stops zonder uur vanaf de starttijd terwijl de Route-tab ze achteraan zette; het uur van het brein werd niet bewaard. Nu één gedeelde plaatsingsregel (`public/js/planner-tijdlijn.js`) voor "+", het brein en de Route-tab: aankomst uiterlijk op "laatste start", echte vrije tijd per dag, doorschuiven naar de volgende week, en een waarschuwing in de Route-tab. | Hoog | proefperiode, refactor |

## B. Bekende fouten en ongemakken — nog NIET opgelost (beslissing nodig)

Deze zijn met tests vastgelegd zoals ze nu werken, zodat een oplossing later bewust gebeurt.

### Na een mail naar de klant (W11 — beslissing bij Brent)
| # | Wat gaat er mis |
|---|---|
| B1 | ~~Werken twee mensen tegelijk aan hetzelfde voorstel (dubbel conflict), dan wordt niet bijgehouden dat het voorstel verstuurd is; de mail is wel vertrokken. Geen waarschuwing.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) De derde poging gaat zonder versiecontrole (`reset` vervangt enkel de entry van dit ticket); mislukt het bewaren toch, dan een waarschuwing. |
| B2 | ~~Faalt het voorstel ná het versturen van de mail met een duidelijke serverfout (bv. Zoho-update mislukt), dan geen waarschuwing "klant kan al gemaild zijn" en geen mailcontrole.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) Enkel een waarschuwing (besluit klant): de planner zet status en datum in Zoho zelf recht. |
| B3 | Annuleren: valt de server weg nádat de annulatiemail vertrokken is, dan blijft het ticket gepland. De melding raadt aan om in Zoho na te kijken. **Bewust zo gelaten (Brent, 2026-10-08).** |
| B4 | ~~Blijkt na een twijfelgeval dat de mail tóch vertrokken is, dan wordt het voorstel/rapport niet automatisch als "verzonden" aangevinkt (de app vraagt wel bevestiging bij opnieuw versturen).~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) Voorstel en rapport worden automatisch aangevinkt (per ontvanger); de bevestigingsvraag bij opnieuw versturen blijft. |

### Rapporten
| # | Wat gaat er mis |
|---|---|
| B5 | ~~Na een serverfout bij rapport versturen blijft de verzendknop uitgeschakeld tot je de pagina herlaadt.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) Knop enkel vrij bij een duidelijke serverfout; bij een onduidelijk antwoord beslist de mailcontrole. |
| B6 | ~~Mislukt een deel van de statusupdates, dan zie je enkel de laatste melding.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) Eén melding met alles, ook geweigerde ontvangers. |
| B7 | ~~Rapportformulier zonder verbinding: foto's die al bij het ticket staan laden stil niet, en de aanrijtijd wordt stil 0. (Brent: formulier nu ongemoeid laten, na de release bekijken.) **Sinds etappe 7 (M3, release-vraag):** de centrale time-out van 20 s op `/api/optimize` en `/api/route` zet de aanrijtijd in de wizard na 20 s trage verbinding ook stil op 0 (de wizard bleef vroeger wachten), waardoor aanrijtijd en loonkost te laag kunnen zijn. De wizard is bewust niet aangepast (Q3); Brent beslist bij de release.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) Melding en invoerveld in de stap Facturatie, nooit meer stil 0 (de bestaande verbindingsproblemen met foto's blijven los daarvan). |

### Beschikbaarheid, afspraken, instellingen
| # | Wat gaat er mis |
|---|---|
| B8 | ~~Afwezigheid over meerdere dagen zonder einddatum bewaart maar één dag; een lege datum wordt zonder waarschuwing bewaard.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) |
| B9 | ~~Blokkeringsvenster: de datum aanpassen laat ook de getoonde dag verspringen.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) |
| B10 | ~~Eigen afspraak zonder adres: de fiche toont de notitie op de plaats van het adres.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) De notitie staat als "Notitie"; Navigeer blijft, met de notitie als plaats; de route gebruikt de notitie nog steeds als locatie. |
| B11 | ~~Eigen afspraak zonder uur staat niet op de tijdlijn (computer).~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) |
| B12 | ~~Instellingen: een weekdag aanklikken en dan Annuleren houdt de wijziging toch even vast.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) |
| B13 | ~~Prijsbeheer: na "+ Onderdeel" springt de cursor naar het verkeerde veld.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) |
| B14 | ~~Blokkeringsvenster: wordt het venster opnieuw opgebouwd terwijl je typt, dan verspringt de cursor (de tekst blijft staan).~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) |

### Planning
| # | Wat gaat er mis |
|---|---|
| B15 | ~~"⚡ Plan deze week" plant in de maandweergave en in de dagweergave van een rechtop gehouden tablet een andere week dan je ziet.~~ **Opgelost op refactor** (proefverzoek 2: gedeelde week): het plant de week van de gekozen dag; in de maandweergave de week van de gekozen dag, met een melding. |
| B16 | ~~Toewijzen stelt altijd 09:00 voor als uur.~~ **Opgelost op refactor** (kleine fouten, 2026-10-09) Zonder overlap, op een kwartier, gelijk aan het plusje; op een feestdag of bij een hele-dag-blokkering terugval op 09:00. |
| B17 | Route slepen: komt er net een verversing binnen terwijl je sleept, dan wordt het slepen afgebroken (zeldzaam, bewust zo gelaten). **Bewust zo gelaten (Brent, 2026-10-08).** |

## C. Open vragen voor Brent

| # | Vraag |
|---|---|
| C1 | Is "Geen tickets om in te plannen" een goede tekst voor de lege wachtrij? **Beantwoord: de tekst blijft.** |
| C2 | B4: moet een rapport/voorstel automatisch op "verzonden" komen als de app de mail in Zoho terugvindt? **Beantwoord en opgelost op refactor (kleine fouten, 2026-10-09):** ja, automatisch aangevinkt (zie B4). |
| C3 | ~~B15: moet "Plan deze week" altijd de week plannen die je ziet?~~ **Beantwoord/opgelost op refactor**: ja, de week van de gekozen dag (in de maandweergave de week van de gekozen dag, met een melding). |
| C4 | B7 (M3): is een stille aanrijtijd 0 na 20 s trage verbinding in de rapportwizard aanvaardbaar, of moet de wizard dan een melding tonen / langer wachten? **Beantwoord en opgelost op refactor (kleine fouten, 2026-10-09):** de wizard toont een melding en een invoerveld (zie B7). |

## Proefverzoeken (afgehandeld op refactor)

- Proefverzoek 2: Kalender, Route-tab en Ingepland tonen dezelfde week (gedeelde gekozen datum); "Plan deze week" plant die week. Klaar.

## D. Te doen vóór de release (proefperiode)

- Mailcontrole één keer testen op een echt ticket in Zoho (formaat van de antwoorden van Zoho nakijken).
- Op een echt ticket (samen met de mailcontrole-test): na een afgebroken verzending van voorstel en van rapport controleren dat het voorstel/rapport automatisch als verzonden aangevinkt wordt; de foutpaden (Zoho-PATCH faalt na de mail) zijn enkel met nep-antwoorden getest.
- Rapport-PDF (standaardPdf) handmatig testen.
- Excel-export van het inventarislogboek handmatig testen.
- Volledige releasechecklist: zie de release-checklist in `docs/`.

## E. Beslissingen Brent (2026-10-08) over deel B en C

- **Oplossen vóór v2.0.0** (apart deelproject "kleine fouten" op de refactor-tak): B1, B2, B4 (= C2: ja, automatisch op "verzonden" als de mail in Zoho teruggevonden wordt), B5, B6 (alle mislukte statusupdates tonen), B8, B9, B10, B11, B12, B13, B14, B16 (eerste vrije uur voorstellen i.p.v. 09:00).
- **B7 / C4:** het rapportformulier toont een duidelijke melding "aanrijtijd kon niet berekend worden" met een veld om ze zelf in te vullen; nooit meer stil 0. (Kleine, gerichte aanpassing aan de wizard; de wizard wordt verder niet herwerkt.)
- **Laten zoals het is:** B3 (melding volstaat), B17 (zeldzaam).
- **C1:** "Geen tickets om in te plannen" is goed.
- Uitgevoerd in `docs/superpowers/plans/2026-10-09-kleine-fouten.md` (zie de rij "Opgelost op refactor" bij elk punt in deel B).

## F. Logins en beheer (nieuwe punten, allemaal open)

Bron: `.superpowers/sdd/2026-10-08-logins-beheer/progress.md` en de taakrapporten. Handleiding: `docs/logins-en-beheer.md`.

### Bekende beperkingen en beslissingen

| # | Punt |
|---|---|
| F1 | Bekende beperking, beslist door de klant op 2026-10-08: `fotos`, `rapport`, `send-rapport`, `comment` en `mail-check` controleren niet of het ticket van de technieker is (alleen `ticketId` in de aanvraag). De app verbergt de knoppen bij collega-tickets (en bij lokale afspraken van een collega) en elke schrijfactie staat met naam in het activiteitenlog. |
| F2 | Sales-gebruikers mogen de TomTom-functies gebruiken. |
| F3 | Tijdens het aanmaken van de eerste beheerder kan een gelijktijdige tweede aanvraag niet atomair uitgesloten worden (Blobs 8.2 heeft geen conditionele schrijfactie). Gemitigeerd met controle-na-schrijven; `laatsteLogin` staat in een eigen blob zodat een login `gebruikers` nooit herschrijft. Een upgrade naar `@netlify/blobs` 11.x (heeft `onlyIfMatch`/`onlyIfNew`, vraagt Node 22.12 of hoger) is een vervolgvoorstel. |
| F4 | ~~De knop "Opnieuw versturen" op de tab Systeemstatus is NIET gebouwd.~~ **Gebouwd op refactor** (kleine fouten, 2026-10-09; Brent besliste ja): de knop staat bij elk mislukt rapport, met bevestiging; de actie staat als `rapport-opnieuw` in het activiteitenlog. |
| F5 | Een rapport onder de naam van een collega wordt aanvaard en gelogd (`rapport-verstuurd` met vlag `andereNaam`); een id-botsing met andermans rapport geeft 403, gelogd als `rapport-geweigerd`, en het item blijft in de outbox met "meld dit aan de planner". |

### Open fouten en kleine punten

| # | Punt |
|---|---|
| F6 | `/api/activiteit` filtert `van`/`tot` op UTC-dagen, het scherm toont Brusselse dagen: aan de randen van een dag (1 tot 2 uur) kan een regel in de verkeerde dag vallen. |
| F7 | Onbetrouwbare tests onder belasting (alleen opnieuw draaien lost het op): unit `beschikbaarheid-logica`; e2e `verbinding` P2, `sw/traag`, `app-schil:88`, `route-tijden:64`, `productie/planning:450`. |
| F8 | De tab Kalender is 478 px breed bij 375 px schermbreedte. Mogelijk bewust (weekraster): nakijken. |
| F9 | Een opnieuw verstuurd oud rapport (zonder `ingediendDoor`, dus van vóór de release) met een andere naam geeft 403: het item blijft in de outbox en staat in het log. Zeldzaam; de coördinator handelt het handmatig af. |
| F10 | `rapport-vangnet` kiest de teststore nog op basis van de header `X-Blitz-Test`. Niet bereikbaar via een URL (geplande functie), laag risico. |
| F11 | De sleutellijst in `public/js/kern/eigenaar.js` (welke lokale gegevens bij een gebruikerswissel gewist worden) is een handmatige kopie van de cache-sleutels: een nieuwe cachesleutel moet er ook bij. |
| F12 | `zohoNaam` wordt niet op uniciteit of op exacte overeenkomst met Zoho gecontroleerd (`netlify/lib/gebruikers.js:56-60`). Twee techniekers met dezelfde genormaliseerde naam delen elkaars eigen rechten en de tweede valt uit het instellingenoverzicht (`netlify/lib/instellingen.js`); de client filtert exact (`public/js/kern/selecties.js:15`) en de server genormaliseerd, dus "tim" in plaats van "Tim" geeft de technieker een lege planning. Idee: een dubbele naam weigeren (409) en in het beheerscherm waarschuwen. (Eindreview M2.) |
| F13 | Lokale instellingen die de servervalidatie niet halen, komen nooit op de server en dat blijft onzichtbaar (`public/js/kern/instellingen-sync.js`, ronde 2 en de migratie van een planner-toestel). Voorbeeld: een globale `laatsteStart` van 16:00 bij een technieker met eindtijd 15:30 geeft 400 en wordt bij elke start opnieuw geweigerd. Idee: bij een weigering `laatsteStart` weglaten en opnieuw proberen, of een melding tonen. (Eindreview M3.) |
| F14 | Eén gedeelde blob `login-pogingen` (`netlify/lib/login-poging.js`, `netlify/lib/blob-wijzig.js`): bij drukte kan een gelijktijdige schrijver een login als "Te veel mislukte pogingen" (429) laten eindigen terwijl de gebruiker niets fout deed. Fail-closed is bewust; mogelijke verbetering is een blob per sleutel (met opruiming van verlopen blobs) of een eigen melding 503 voor "teller niet bewaard". Niet gebouwd: raakt een twaalftal tests en de opschoning. (Eindreview M5.) |
| F15 | Onbeperkt scrypt-werk voor anonieme aanroepers: `auth-herstel` doet per verzoek 10 verificaties (`netlify/lib/herstel.js`), de vergrendeling geldt per e-mailadres, een stroom met telkens een ander adres wordt niet afgeremd (kost enkel rekentijd). Idee: een globale bovengrens per minuut. Niet gebouwd: zou in dezelfde pogingenblob moeten (zie F14). (Eindreview M6.) |
| F16 | `leesActiviteit` geeft maximaal 1000 nieuwste regels (`netlify/lib/activiteit.js`, `MAX_RESULTATEN`). Het dashboard dat dit als koppelvlak gebruikt telt over een lange periode dus stil te weinig: in het koppelvlak vermelden of een `limiet`-optie geven. (Eindreview M8.) |
| F17 | Herlogin tijdens een outbox-verzending: de pagina-outbox gebruikt de omhulde fetch (`public/js/outbox-verzend.js:118-131`, `public/js/kern/api.js:300-304`); duurt het herinloggen langer dan 60 s, dan is het signaal afgebroken en faalt de herhaling meteen met "time-out". Geen verlies (het item blijft), enkel een verwarrende melding. (Eindreview M9.) |
| F18 | De melding "kon niet naar Zoho" voor de technieker kijkt enkel naar de naam (`public/js/rapport-status.js:101`): een rapport dat hij onder een andere naam indiende (aanvaard en gelogd) levert hem die melding niet. Idee: `ingediendDoor` gebruiken. (Eindreview M10.) |
| F19 | **Brent beslist:** mag een technieker zijn eigen rapport uit het archief verwijderen? Nu wel (zoals in de live versie, en de knop staat zichtbaar in zijn tab Rapporten); elke verwijdering staat sinds de eindreview als `rapport-verwijderd` met ticketnummer in het activiteitenlog. Wil je dat niet: één regel in `netlify/lib/rechten.js` (`DELETE` voor `rapport-archief` enkel coördinator) en de knop verbergen voor de technieker. (Eindreview I4.) |
| F20 | Een technieker krijgt van collega's de startlocatie (vaak een thuisadres) niet meer in het instellingenoverzicht. Bekijkt hij de route van een collega, dan rekent die met de standaardstartlocatie in plaats van het vertrekpunt van die collega. Gewenst voor de privacy; controleer of dat in de alleen-lezen-weergave acceptabel is. (Eindreview M7.) |

## G. Beslissingen Brent (2026-10-09, ochtend)

- **Rapport verwijderen door technieker:** mag (eigen rapporten), elke verwijdering staat in het activiteitenlog (`rapport-verwijderd`). Zo laten.
- **Knop "Opnieuw versturen"** in Beheer → Systeemstatus bij een mislukt rapport: **ja, bouwen** (opgenomen in het plan kleine fouten).
- **Sales-lead na 12 maanden:** wordt gewist zonder spoor; komt hij later opnieuw in een export, dan is het gewoon een nieuwe lead (privacy). Zo laten.
- **Proef zonder testmodus** (eerste beheerdersaccount, inloggen, gebruiker aanmaken): bij de release / proefperiode.
- **Plan kleine fouten — open vragen beantwoord (= de aannames van het plan):** (1) mail vertrokken maar Zoho niet bijgewerkt → enkel duidelijke waarschuwing, planner zet het zelf recht; (2) eigen afspraak zonder adres → notitie tonen als "Notitie", route blijft de notitie als plaats gebruiken; (3) toewijzen op een volle dag → eerste vrije uur toch voorstellen, ook na het laatste startuur; (4) aanrijtijd niet berekend → verplicht invullen (0 mag) vóór de technieker verder kan.
- Keuzes die de opzichter 's nachts maakte en die Brent liet staan: rapport met naam van een collega wordt aanvaard en gelogd; opstart wacht max. ~5–8 s; bevestiging bij afmelden met niet-verstuurde instellingen; techniekers zien geen vertrekadres van collega's; "opgeruimde" annulaties tellen niet mee in het dashboard; verkoper heeft een eigen rol in de app.

## H. Nieuwe aandachtspunten uit de kleine fouten (2026-10-09)

| # | Punt |
|---|---|
| H1 | Verstuurt een tweede planner op hetzelfde moment een voorstel voor HETZELFDE ticket, dan wint de laatst geschreven registratie: `reset` vervangt de hele entry van dat ticket, ook het vinkje van de ander (en de derde, versieloze poging bereikt dat sneller). Bestaand gedrag van `reset`, aanvaard. (Review taken 4-6, M1.) |
| H2 | Het automatisch aanvinken na een teruggevonden mail koppelt een uitgaande mail naar hetzelfde adres in het zoekvenster (10 s voor het versturen tot nu) aan het rapport of voorstel. Een andere mail naar dezelfde klant op dat ticket in dat venster zou dus ten onrechte "verzonden" kunnen aanvinken. Kans klein, besluit klant (B4: ja). (Review taken 2-3, M3.) |
| H3 | Tijdens de mailcontrole van een rapport (tot ongeveer 30 s) kan een hertekening van het archief (bv. outbox-flush) de verzendknop van dat rapport weer openen, zodat een snelle gebruiker kan hersturen vóór de uitkomst. Bestond al; de bevestigingsvraag vangt het enkel op als er al een mail gedetecteerd is. Idee: een vergrendeling per rapport-id die het tekenen respecteert. (Review taken 2-3, M4.) |
| H4 | Een onleesbaar antwoord op een 4xx (bv. een foutpagina van een proxy of klant-wifi) bij het versturen van een rapport laat de knop dicht met de melding "kijk in Zoho na of de mail vertrokken is, of herlaad de pagina en probeer opnieuw": de app kan niet bewijzen dat er niets verstuurd is. |
| H5 | De B4-melding "voorstel/rapport als verzonden aangevinkt" zegt niets over de Zoho-ticketstatus (de server kan na de mail zijn afgebroken vóór de ticket-update); de herlading van de tickets toont de echte stand. (Review taken 4-6, M6.) |
| H6 | Onbetrouwbare tests onder belasting (de PC van de klant is traag): bij een volledige run falen soms tijdens het opstarten (`#cnt-tickets` blijft 0 of een CDN-verzoek krijgt `ERR_NETWORK_CHANGED`/`NAME_NOT_RESOLVED`) bv. ticketdetail, vensters, wachtrij, werkuren, route-tijden en voorstel-tests; de mailcontrole-reeks in `e2e/productie/rapport.spec.mjs` ("niet verzonden … onthoudt niets", "afgebroken en de mail is niet verzonden") wacht op een tweede controle en faalt soms onder belasting; unit `beschikbaarheid-logica` heeft een limiet van 3 s. Alleen opnieuw draaien lost het op (zie ook F7). |
| H7 | Voorstel B2 (mail weg, ticket-update mislukt): `propose.js` schrijft in dat geval geen `voorstel-verstuurd`-regel in het activiteitenlog, terwijl de klant wel gemaild is. Bewust zo gelaten omdat een bestaande test vastlegt dat een mislukte actie niets logt; de waarschuwing in de app en het register volstaan. (Eindreview M1.) |
| H8 | Beheer, Systeemstatus: wordt de lijst hertekend terwijl de bevestiging bij "Opnieuw versturen" openstaat (Vernieuwen of de herlaad na 10 s), dan blijft de nieuwe knop grijs na Annuleren of een mislukking tot de volgende hertekening. Cosmetisch. (Eindreview M3.) |
| H9 | Rapportwizard: past de technieker een met TomTom berekende aanrijtijd handmatig aan, dan blijft de badge "📡 TomTom" staan (de bron wordt niet 'handmatig'). Geen effect op PDF of TicketLog. (Eindreview M5.) |
| H10 | `rapport-verzonden.js` leest en schrijft de hele `rapportlijst` zonder controle-na-schrijven (de upload gebruikt `wijzigLijst`): een gelijktijdige schrijver kan overschreven worden. Bestond al; het automatisch aanvinken roept het vaker aan. Idee: omzetten naar `wijzigLijst`. (Eindreview M7.) |
| H11 | Een voorstel waarvan de mail maar naar een deel van de ontvangers vertrok blijft voor dat ticket vergrendeld tot de pagina herladen wordt: de planner stuurt de ontbrekende mail in Zoho zelf (ruling eindreview I3). |
