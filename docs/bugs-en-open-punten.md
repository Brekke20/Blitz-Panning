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
| B1 | Werken twee mensen tegelijk aan hetzelfde voorstel (dubbel conflict), dan wordt niet bijgehouden dat het voorstel verstuurd is; de mail is wel vertrokken. Geen waarschuwing. |
| B2 | Faalt het voorstel ná het versturen van de mail met een duidelijke serverfout (bv. Zoho-update mislukt), dan geen waarschuwing "klant kan al gemaild zijn" en geen mailcontrole. |
| B3 | Annuleren: valt de server weg nádat de annulatiemail vertrokken is, dan blijft het ticket gepland. De melding raadt aan om in Zoho na te kijken. |
| B4 | Blijkt na een twijfelgeval dat de mail tóch vertrokken is, dan wordt het voorstel/rapport niet automatisch als "verzonden" aangevinkt (de app vraagt wel bevestiging bij opnieuw versturen). |

### Rapporten
| # | Wat gaat er mis |
|---|---|
| B5 | Na een serverfout bij rapport versturen blijft de verzendknop uitgeschakeld tot je de pagina herlaadt. |
| B6 | Mislukt een deel van de statusupdates, dan zie je enkel de laatste melding. |
| B7 | Rapportformulier zonder verbinding: foto's die al bij het ticket staan laden stil niet, en de aanrijtijd wordt stil 0. (Brent: formulier nu ongemoeid laten, na de release bekijken.) **Sinds etappe 7 (M3, release-vraag):** de centrale time-out van 20 s op `/api/optimize` en `/api/route` zet de aanrijtijd in de wizard na 20 s trage verbinding ook stil op 0 (de wizard bleef vroeger wachten), waardoor aanrijtijd en loonkost te laag kunnen zijn. De wizard is bewust niet aangepast (Q3); Brent beslist bij de release. |

### Beschikbaarheid, afspraken, instellingen
| # | Wat gaat er mis |
|---|---|
| B8 | Afwezigheid over meerdere dagen zonder einddatum bewaart maar één dag; een lege datum wordt zonder waarschuwing bewaard. |
| B9 | Blokkeringsvenster: de datum aanpassen laat ook de getoonde dag verspringen. |
| B10 | Eigen afspraak zonder adres: de fiche toont de notitie op de plaats van het adres. |
| B11 | Eigen afspraak zonder uur staat niet op de tijdlijn (computer). |
| B12 | Instellingen: een weekdag aanklikken en dan Annuleren houdt de wijziging toch even vast. |
| B13 | Prijsbeheer: na "+ Onderdeel" springt de cursor naar het verkeerde veld. |
| B14 | Blokkeringsvenster: wordt het venster opnieuw opgebouwd terwijl je typt, dan verspringt de cursor (de tekst blijft staan). |

### Planning
| # | Wat gaat er mis |
|---|---|
| B15 | ~~"⚡ Plan deze week" plant in de maandweergave en in de dagweergave van een rechtop gehouden tablet een andere week dan je ziet.~~ **Opgelost op refactor** (proefverzoek 2: gedeelde week): het plant de week van de gekozen dag; in de maandweergave de week van de gekozen dag, met een melding. |
| B16 | Toewijzen stelt altijd 09:00 voor als uur. |
| B17 | Route slepen: komt er net een verversing binnen terwijl je sleept, dan wordt het slepen afgebroken (zeldzaam, bewust zo gelaten). |

## C. Open vragen voor Brent

| # | Vraag |
|---|---|
| C1 | Is "Geen tickets om in te plannen" een goede tekst voor de lege wachtrij? |
| C2 | B4: moet een rapport/voorstel automatisch op "verzonden" komen als de app de mail in Zoho terugvindt? |
| C3 | ~~B15: moet "Plan deze week" altijd de week plannen die je ziet?~~ **Beantwoord/opgelost op refactor**: ja, de week van de gekozen dag (in de maandweergave de week van de gekozen dag, met een melding). |
| C4 | B7 (M3): is een stille aanrijtijd 0 na 20 s trage verbinding in de rapportwizard aanvaardbaar, of moet de wizard dan een melding tonen / langer wachten? |

## Proefverzoeken (afgehandeld op refactor)

- Proefverzoek 2: Kalender, Route-tab en Ingepland tonen dezelfde week (gedeelde gekozen datum); "Plan deze week" plant die week. Klaar.

## D. Te doen vóór de release (proefperiode)

- Mailcontrole één keer testen op een echt ticket in Zoho (formaat van de antwoorden van Zoho nakijken).
- Rapport-PDF (standaardPdf) handmatig testen.
- Excel-export van het inventarislogboek handmatig testen.
- Volledige releasechecklist: zie de release-checklist in `docs/`.

## E. Beslissingen Brent (2026-10-08) over deel B en C

- **Oplossen vóór v2.0.0** (apart deelproject "kleine fouten" op de refactor-tak): B1, B2, B4 (= C2: ja, automatisch op "verzonden" als de mail in Zoho teruggevonden wordt), B5, B6 (alle mislukte statusupdates tonen), B8, B9, B10, B11, B12, B13, B14, B16 (eerste vrije uur voorstellen i.p.v. 09:00).
- **B7 / C4:** het rapportformulier toont een duidelijke melding "aanrijtijd kon niet berekend worden" met een veld om ze zelf in te vullen; nooit meer stil 0. (Kleine, gerichte aanpassing aan de wizard; de wizard wordt verder niet herwerkt.)
- **Laten zoals het is:** B3 (melding volstaat), B17 (zeldzaam).
- **C1:** "Geen tickets om in te plannen" is goed.

## F. Logins en beheer (nieuwe punten, allemaal open)

Bron: `.superpowers/sdd/2026-10-08-logins-beheer/progress.md` en de taakrapporten. Handleiding: `docs/logins-en-beheer.md`.

### Bekende beperkingen en beslissingen

| # | Punt |
|---|---|
| F1 | Bekende beperking, beslist door de klant op 2026-10-08: `fotos`, `rapport`, `send-rapport`, `comment` en `mail-check` controleren niet of het ticket van de technieker is (alleen `ticketId` in de aanvraag). De app verbergt de knoppen bij collega-tickets (en bij lokale afspraken van een collega) en elke schrijfactie staat met naam in het activiteitenlog. |
| F2 | Sales-gebruikers mogen de TomTom-functies gebruiken. |
| F3 | Tijdens het aanmaken van de eerste beheerder kan een gelijktijdige tweede aanvraag niet atomair uitgesloten worden (Blobs 8.2 heeft geen conditionele schrijfactie). Gemitigeerd met controle-na-schrijven; `laatsteLogin` staat in een eigen blob zodat een login `gebruikers` nooit herschrijft. Een upgrade naar `@netlify/blobs` 11.x (heeft `onlyIfMatch`/`onlyIfNew`, vraagt Node 22.12 of hoger) is een vervolgvoorstel. |
| F4 | De knop "Opnieuw versturen" op de tab Systeemstatus is NIET gebouwd. **Brent beslist** of hij er komt (vóór of na de release). |
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

## H. Performance-dashboard — open punten

Bron: `.superpowers/sdd/2026-10-08-performance-dashboard/` (ledger `progress.md`, taakrapporten en reviews). Spec: `docs/superpowers/specs/2026-10-08-performance-dashboard-design.md`.

| # | Punt |
|---|---|
| H1 | `public/js/excel-export.js` telt werktijd over middernacht als 0 en negeert de `werktijd`-tekst van het rapport. Het dashboard rekent zelf (`public/js/kern/loonkost.js`), dus de twee kunnen verschillen. Aparte fix, niet in het dashboard. |
| H2 | Rapporten van vóór de livegang hebben geen `geplandTijdslot`, `installateurAlLangsGeweest`, `partner` en `regio`. Ze tellen in die cijfers niet mee; de voetnoten onder het dashboard zeggen "op basis van x van y rapporten". Er is geen achterafvulling. |
| H3 | Annulaties worden pas geteld vanaf de livegang van de logins (het activiteitenlog bestaat pas dan) en het log wordt 12 maanden bewaard: een periode van meer dan 12 maanden toont "annulaties sinds …". Een annulatie die enkel een vergrendeling opruimt (`details` eindigt op ", opgeruimd", geen mail) telt bewust niet mee. Bij meer dan 1000 annulatieregels in een periode (zie F16) toont het scherm een noot dat het aantal onvolledig kan zijn. De annulatie-tegel toont het aantal van de gekozen periode zodra het log die periode dekt; enkel de vergelijking met de vorige periode verdwijnt als die vóór het log begint (eindreview I1). |
| H4 | Grootte en dekking van de jaar-archieven `rapportlijst-archief-<jaar>`: rapporten die vóór de invoering al uit de lijst van 500 vielen zijn niet gearchiveerd, dus het dashboard heeft pas historiek vanaf de livegang van het archief. De grootte is enkel synthetisch gemeten (ongeveer 12,8 KB per rapport, ongeveer 3 MB per jaar); een meting op de echte gegevens met `scripts/meet-rapportlijst.mjs` is nog niet gedaan (eerst Brents akkoord). Een rapport dat al in het archief staat, kan niet meer verwijderd worden via de app (verwijderen werkt enkel op de actieve lijst); zeldzaam. |
| H5 | Archief-overslaan (T17, reviewpunt M2, bewust uitgesteld): het dashboard slaat de archieven over als de actieve lijst de periode lijkt te dekken (`netlify/lib/dashboard-bronnen.js`). Eén laat ingediend rapport met een oude datum in de actieve lijst kan daardoor het archief laten overslaan terwijl de lijst de periode niet echt dekt. Zeer onwaarschijnlijk; de cijfers zijn dan te laag. |
| H6 | Tweede lijstaanroep (T17, reviewpunt M6, bewust uitgesteld): `oudsteActiviteit` doet nog een eigen `list('activiteit/')` naast die in `leesActiviteit`. Eén extra opslagaanroep per dashboardverzoek; aanvaardbaar. |
| H7 | Kleine cosmetische punten uit de review van T20 (`public/js/rapport-archief.js`): (1) het commentaarblok over `allow-same-origin` en het meten van de inhoudshoogte staat nog bij `herOpenRapport` in plaats van bij `toonInVenster`; (2) `openRapportOpId` vergelijkt `r.id === id` strikt, een id van een ander type (getal of tekst) valt dan terug op een extra ophaalronde (blijft correct); (3) de melding "PDF-venster werd geblokkeerd" staat dubbel (in `herOpenRapport` en `openRapportOpId`), een klein hulpfunctietje is netter; (4) de test voor de volgorde controleert dat `open` vóór `fetch` komt, niet dat er geen `await` tussen zit. |
| H8 | Weeklabels in de grafieken tonen geen jaar ("wk 28 sep"): bij een periode die over een jaargrens loopt, zijn "wk 28 dec" en "wk 28 dec" van een jaar eerder niet te onderscheiden. Idee: het jaar toevoegen zodra de periode twee kalenderjaren omvat. |
| H9 | **Sales-leads worden na 12 maanden gewist** (Brent, 2026-10-09; zie sectie G op de refactor-tak): de bezoeken van gewiste leads verdwijnen uit de sales-cijfers van het dashboard, dus "Dit jaar" (vanaf ongeveer november) of een eigen periode van meer dan 12 maanden terug toont minder sales-bezoeken. Onder het sales-blok staat daarom een vaste noot. (Eindreview M7.) |
| H10 | Het jaar-archief wordt bij elke upload volledig herschreven (get, setJSON, get) en de technieker wacht daarop (`netlify/lib/rapport-ontvangst.js`, `netlify/lib/rapport-jaararchief.js`). Bij het verwachte volume (~3 MB per jaar) verwaarloosbaar; bij een veel hoger volume groeit de uploadlatentie. Meet het echte volume bij de release (checklist 1c); is het archief groter dan ongeveer 3 MB per jaar: per maand splitsen of de archivering uit het verzoek halen. (Eindreview M5.) |
| H11 | Elk segment van de gestapelde kolommen en elke hitstrook van de lijngrafiek heeft `tabindex="0"` (`public/js/kern/grafiek-balken.js`, `grafiek-lijn.js`): "Dit jaar" met veel techniekers en weken geeft honderden tab-stops vóór het instellingenpaneel. Idee: enkel de kolomhitstrook focusbaar, of één stop per grafiek met pijltjesnavigatie; de tabel-twin dekt de toegankelijkheid intussen. Bewust niet in de eindreview-ronde aangepast (toegankelijkheidsontwerp). (Eindreview M9.) |
| H12 | De module `public/js/rapport-archief.js` wordt statisch geïmporteerd in `beheer-performance.js` (preflight #18 vroeg een lazy `import()`). Geen defect: de module zit al in de graaf via `app.js`. Enkel ter kennisname. (Eindreview M12.) |
