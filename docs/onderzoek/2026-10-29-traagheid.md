# Onderzoek traagheid Blitz Planning (2026-10-29)

*Enkel onderzoek, niets gewijzigd (geen code, geen Netlify, geen Zoho, geen commit). Onderzocht op `main` = v2.6.0. **Let op: v2.6.0 staat al live** (gecontroleerd: de live `sw.js` bevat `blitz-planning-v43` en `versie.js` bevat `2.6.0`); de opdracht ging nog uit van v2.5.1. Daardoor bestond er één meting die de vorige onderzoeken nog misten: de server-tijdmeting van 2.6.0 schrijft sinds vandaag per aanvraag een regel `[meting]` in de Netlify-logs. Die cijfers staan hieronder en zijn de belangrijkste nieuwe vondst.*

*Wat al bekend was (niet opnieuw uitgezocht): `docs/server-snelheid/metingen-live-2026-10-29.md` (p50/p90 per functie over 24 u), `docs/optimalisatie/vergelijking-2.5.1.md` en `docs/superpowers/specs/assets/2026-10-27-open-dag-snelheid.md` (opstart- en scrollmetingen op een testbrowser). Wat NIEUW is, staat in "Technisch" gemarkeerd met **[nieuw]**.*

---

## Samenvatting voor Brent

- **Het wachten komt vooral van de server, niet van jouw pc.** Het ophalen van de tickets (`/api/tickets`) duurt vandaag 4 tot 6 seconden. Daarvan gaat ruim 95 % naar het praten met Zoho: de server stelt per keer ongeveer 27 vragen aan Zoho, en elke vraag kost 0,3 tot 0,4 seconde. Dat is jouw zin "een tab laadt oké, maar we wachten tot alles erop staat".
- **De server staat in de Verenigde Staten (us-east-1), Zoho en jij zitten in Europa.** Elke vraag van de server aan Zoho en elk antwoord naar jou moet over de oceaan. Dit is nieuw: het stond nergens vast, nu staat het in de logs. Een server in Europa zou dit vermoedelijk flink korter maken. Dat is een instelling in Netlify (jouw account), geen codewijziging. Ik heb het niet getest en niets verzet.
- **Elke andere aanvraag kost ongeveer 1 seconde**, ook de kleinste. De code zelf doet er maar een kwart seconde over; de rest is opstarten van de server-instantie en het heen-en-weer over de oceaan. Bij het opstarten van de app lopen er ongeveer tien van zulke aanvragen tegelijk, dus die kosten samen geen 10 seconden maar ongeveer 1 seconde. Het wachten bepaalt de tickets-aanvraag.
- **Daarbovenop komt het laden van de app zelf**: ruim 140 bestanden die telkens bij de server nagevraagd worden. Op een snelle verbinding merk je dat nauwelijks; op een trage verbinding (gsm met weinig bereik, wifi in een werkplaats) is dat 3 tot 4 seconden voor het scherm er staat. Dit gaat over de app en de verbinding, niet over je pc.
- **Je pc kan wel meespelen, maar dan op een andere manier**: haperend scrollen, niet wachten. De glas-effecten (vervaging van 28 px op de computer) en bewegende beelden tijdens een thema zoals nu Halloween vragen veel van een zwakke grafische chip. Dit is nog nooit op echte hardware gemeten; de eerdere metingen draaiden zonder grafische kaart.
- **Hoe weet je welke het is?** Zie "Wat Brent zelf kan meten": drie korte proeven (zelfde account op je gsm via 4G, op je pc via wifi, en je pc via de hotspot van je gsm) en twee cijfers uit de Chrome-ontwikkeltools. Geef me die door en we weten het.
- **Wat ik zou doen, in volgorde**: (1) kijken of de Netlify-functieregio naar Europa kan; (2) de ticketlading bij Zoho slimmer maken (minder en parallelle vragen, het adres-detail bewaren zodat enkel gewijzigde tickets opnieuw gevraagd worden); (3) de app minder bestanden laten nagaan bij het opstarten. Het glas aanpassen pas na de proef op je pc.
- Eén punt is een kleine, veilige bugfix: de server vraagt bij elke Zoho-aanroep opnieuw het organisatienummer op (één overbodige vraag van ongeveer 0,3 s). De rest is groter werk.

---

## Wat Brent zelf kan meten

Doel: scheiden of het aan **jouw pc**, **de verbinding**, **de app** of **de server** ligt. Alles hieronder is lezen en kijken; er verandert niets aan de app. Doe elke proef met hetzelfde account, na een verse herlading, en schrijf de getallen op.

### Proef 1: dezelfde pagina op twee plekken (5 minuten)
1. Open de app op je **pc via wifi** en let op: na hoeveel seconden staan de tickets er? (stopwatch op je telefoon: start bij het indrukken van Enter, stop zodra de wachtrij gevuld is).
2. Doe dit nogmaals op je **gsm via 4G** (wifi uit), met een verse herlading (veeg de app weg en open ze opnieuw).
3. Doe het nog eens op je **pc met de hotspot van je gsm** (pc verbonden met de gsm in plaats van het bedrijfswifi).
4. Lees het resultaat zo:
   - Pc wifi traag, gsm 4G ook traag, pc via hotspot ook traag, dan ligt het aan de **server of de app** (het maakt niet uit welk toestel of welk netwerk).
   - Pc traag en gsm snel (op dezelfde stap), dan ligt het aan **je pc**.
   - Pc via bedrijfswifi traag maar via de hotspot snel, dan ligt het aan **het netwerk op kantoor**.

### Proef 2: de tijden van de server aflezen (Chrome, 3 minuten, geen login bij Netlify nodig)
1. Open de app in Chrome op je pc. Druk op **F12** (ontwikkeltools) en klik bovenaan op het tabblad **Netwerk** (Network).
2. Vink **Cache uitschakelen** (Disable cache) uit; laat het gewoon staan zoals het is. Druk op **Ctrl+Shift+R** (harde herlading) en wacht tot de wachtrij gevuld is.
3. Onderaan in de balk staat een regel zoals "142 verzoeken, 1,5 MB overgedragen, Voltooid: 4,8 s". **Noteer die drie getallen.**
4. Typ in het zoekvak van het Netwerk-tabblad `api/tickets` en klik op de regel. Klik rechts op het tabblad **Timing**. Onderaan staat **Server-Timing**: noteer de getallen die daar staan (v2.6.0 voegt die toe). Doe hetzelfde voor `api/afspraken`.
5. Stuur me: de drie getallen onderaan, de Server-Timing-regels van `api/tickets` en `api/afspraken`, en de kolom **Tijd** van de trage regels (klik op de kolomkop "Tijd" om te sorteren; neem de bovenste vijf).

### Proef 3: ligt het aan het tekenen op je pc? (5 minuten)
1. Open de app op de **Wachtrij** met minstens tien tickets en scroll snel op en neer. Haperen de kaarten?
2. Druk op **Ctrl+Shift+Esc** (Taakbeheer), kies **Prestaties**, en kijk naar **GPU** terwijl je blijft scrollen. Zit de GPU dicht bij 100 %? Noteer het percentage (en of je pc een aparte videokaart heeft of een ingebouwde).
3. Zet in de app onder **Instellingen, "Dit toestel"** de versiering/bewegende beelden **uit** (nu loopt er een Halloween-thema). Scroll opnieuw. Beter? Noteer ja of nee.
4. Nog een test voor het glas: F12, dan de drie puntjes rechtsboven, **Meer hulpprogramma's, Rendering**, en kies bij "Emuleer een CSS-mediafunctie prefers-reduced-transparency" de waarde **reduce** (als die keuze bestaat in jouw Chrome). Dat zet de vervaging uit. Scroll nog eens: beter?

### Proef 4: de Netlify-logs (alleen als je er toch naar wilt kijken; ik kan ze ook lezen)
Netlify, site blitz-planning, **Logs, Functions**: zoek op `[meting]`. De velden: `totaal` (duur in de functie), `zoho` (opgetelde wachttijd op Zoho), `zn` (aantal Zoho-vragen), `regio`. Ik kan die zelf voor je lezen; je hoeft hier niets voor te doen.

### Welke getallen terugsturen (samengevat)
- Seconden tot gevulde wachtrij: pc wifi, gsm 4G, pc via hotspot.
- Onderaan het Netwerk-tabblad: aantal verzoeken, overgedragen MB, "Voltooid"-tijd.
- Server-Timing van `api/tickets` en `api/afspraken`.
- GPU-percentage tijdens het scrollen, en of het beter werd met versiering uit of vervaging uit.
- Welke pc (merk of type) en of de repo/app in OneDrive-map of gewoon in de browser draait (de app zelf draait gewoon in de browser; OneDrive speelt enkel bij het bouwen en testen een rol, niet bij het gebruik).

---

## Technisch

### T0. Context en methode
- Live = v2.6.0 (`blitz-planning-v43`). Plan Netlify: `nf_team_dev`. Functieregio volgens de eigen logs: **us-east-1** (veld `regio` in elke `[meting]`-regel). **[nieuw]**
- Metingen in dit onderzoek: (a) de `[meting]`-regels van vandaag (Netlify-observability, alleen lezen), (b) 24 u-percentielen per functie (`get-topk functions`), (c) een lichte meting van de publieke site met curl vanaf deze pc: enkel statische bestanden en `/api/auth-ik` en `/api/themas` **zonder cookie** (dat geeft 401 zonder Blobs of Zoho aan te raken). **Er is niet ingelogd en geen echte gegevens opgehaald.** De bundel- en netwerktijden zijn dus niet die van een ingelogde pagina; de ingelogde servercijfers komen uit de logs van de echte gebruikers van vandaag.
- Geen Playwright, geen testsuite gedraaid.

### T1. Server: `/api/tickets` is het lange wachten **[nieuw: gesplitst per onderdeel]**
Vijf ladingen van vandaag, uit de `[meting]`-regels (`netlify/functions/tickets.js`):

| Tijd (UTC) | duur aan de rand (edge) | `totaal` in functie | `auth` (Blobs) | `zoho` (opgeteld) | `zn` (Zoho-vragen) | max. gelijktijdig |
|---|---|---|---|---|---|---|
| 16:25 | 5,59 s | 5,21 s | 101 ms | 9,49 s | 27 | 5 |
| 16:30 | 6,31 s | 5,81 s | 53 ms | 11,46 s | 27 | 5 |
| 16:36 | 4,26 s | 3,88 s | 56 ms | 7,56 s | 27 | 5 |
| 16:41 | 4,93 s | 4,46 s | 78 ms | 8,80 s | 27 | 5 |
| 16:47 | 4,60 s | 4,10 s | 67 ms | 8,29 s | 27 | 5 |

24 u-percentielen `tickets` (118 verzoeken, 0 fouten): p50 5,5 s, p75 6,4 s, p90 7,2 s, p99 8,4 s.

Lezing:
- **De functie wacht bijna de hele tijd op Zoho**: `auth` is 50 tot 100 ms, de rest is Zoho. De opgetelde Zoho-tijd (7,5 tot 11,5 s) is groter dan de echte duur omdat vijf vragen tegelijk lopen. Gemiddeld 0,28 tot 0,42 s per Zoho-vraag, van de server in **us-east-1** naar `desk.zoho.eu`. Dat past bij een oceaanovergang per vraag (hypothese; niet bewezen dat de afstand de oorzaak is, wel dat de regio US is en Zoho in de EU staat: `netlify/lib/zoho.js:10`).
- **De opbouw van 27 vragen** (`tickets.js:20-76`, `zoho.js:41-49`): token (gecachet, 0 vragen bij een warme instantie), organisatie-id (1 vraag, elke keer; zie T6), `/agents` (1 vraag, **vóór** de paginering; de code-opmerking "parallel met tickets" klopt niet), de pagina's `/tickets?limit=100` één voor één (`for`-lus, 1 tot 6 vragen) en daarna `/tickets/{id}` per relevant ticket in blokken van 5 met `Promise.all` (`tickets.js:63-75`, de rest van de 27). Elke fase wacht op de vorige. Daarom `max = 5`.
- Het detailverzoek per ticket dient enkel voor de custom fields (adres e.d.): ~20 van de 27 vragen.
- Geen `[functions.tickets]`-regel in `netlify.toml`: standaard time-out (p99 8,4 s vandaag, maar eerder gemeten p99 10,6 s; reserve is klein). 2.6.0 verhoogde de time-out zelf al (zie CHANGELOG).
- Het scherm toont bij een volgend bezoek eerst de bewaarde kopie (`blitz_tickets_cache`, `app.js:606`) en ververst na 4 tot 6 s. De volle wachttijd treft dus vooral: de eerste keer op een toestel, na uitloggen of wissen van gegevens, en wie de verse stand nodig heeft (nadat een collega iets plande).

### T2. Server: elke aanvraag ≈ 1 s, waarvan 0,25 s code **[nieuw: gesplitst]**
Vergelijking van de duur aan de rand en de tijd in de functie (`[meting]`, vandaag, parallelle opstartaanvragen):

| Functie | edge | `totaal` | `auth` (Blobs, strong) | `kern` | `koud` |
|---|---|---|---|---|---|
| afspraken (16:41) | 1,35 s | 274 ms | 183 ms | 90 ms | 322 ms |
| voorstel-status (16:47) | 1,24 s | 233 ms | 165 ms | 67 ms | 344 ms |
| planning-sinds (16:36) | 0,99 s | 223 ms | 169 ms | 53 ms | 312 ms |
| themas (16:45) | 1,64 s | 463 ms | 120 ms | 342 ms | 448 ms |

24 u-percentielen (p50): prijzen 1,02 s, klantbeschikbaarheid 1,03 s, inventaris 0,99 s, rapport-archief 0,99 s, availability 0,98 s, themas 1,11 s, auth-ik 0,94 s; afspraken 0,58 s en voorstel-status 0,51 s (die zijn vaker warm). Allemaal ver boven wat een Blobs-lezing hoort te kosten.

Lezing:
- **De eigen code is klein**: 50 tot 100 ms in `kern`. De sessiecontrole leest bij elke beveiligde aanroep de **volledige gebruikerslijst uit Blobs met `consistency: 'strong'`** (`netlify/lib/auth.js:93-96`): 120 tot 210 ms, **meer dan de eigenlijke functie**. De "kost" van beveiligd zijn zit dus in elke aanvraag.
- **Het grootste stuk zit buiten de functiecode**: edge 1,0 tot 1,35 s tegen `totaal` 0,22 tot 0,27 s, ongeveer 0,8 tot 1,0 s verschil. Het veld `koud` is volgens `netlify/lib/meting.js:17` de `process.uptime()` in ms bij de eerste meting van een instantie (daarna 0). Een waarde van ≈ 260 tot 450 ms bij bijna elke parallelle opstartaanvraag betekent dus: **de instantie was nog geen halve seconde oud, een verse start** (de aanvragen komen op dezelfde milliseconde binnen en kunnen één instantie niet delen; `tickets` toont `koud: 0`, die draaide op een al warme instantie). Dat de hele resterende ~0,6 à 0,9 s daaruit bestaat is een **hypothese**: de rest is de oceaanovergang en het opzetten van de Blobs-verbinding, niet verder te splitsen zonder de Server-Timing van een echte browser.
- **De vloer van een aanvraag zonder Blobs of Zoho** (onze curl-meting, `/api/auth-ik` zonder cookie, `/api/themas` zonder cookie, 10 metingen vanaf deze pc): warm 0,23 tot 0,52 s totale tijd (verbinding 0,05 s, TLS 0,10 s), koude eerste aanroepen 1,1, 1,2 en 2,3 s. In de logs van die aanroepen staat `totaal` 0 ms en `regio us-east-1`. De vloer vanuit België is dus **0,3 tot 0,5 s per aanvraag, zonder één regel eigen code**. Dat sluit aan bij de transatlantische afstand en de koude start.
- Gevolg: **~10 gelijktijdige opstartaanvragen** (T3) kosten ongeveer 1,2 tot 1,6 s samen, niet 10 s. Het totale wachten wordt dus bepaald door de langste, `tickets`.
- Overige serverpunten: blob-lezingen per verzoek zijn één `get` (geen N+1) in de opstartpaden: `rapport-archief.js:75` leest één blob (de hele lijst; groeit met elk rapport; vandaag 1 MB bandbreedte over 32 aanroepen = ~32 kB per aanroep), `instellingen.js:59` leest versie en instellingen parallel. **N+1 bestaat wel in het Beheer**: `dashboard-bronnen.js:91-92` leest per verkoper één blob na elkaar; `activiteit.js:66-` leest alle maandblobs na elkaar. Dit raakt enkel het Dashboard (p50 2,6 s, `dashboard` 11 aanroepen vandaag), niet het dagelijks werk.
- `propose` (voorstel versturen): p50 5,0 s, p90 7,0 s; `send-rapport` p50 4,4 s tot p99 10,9 s; `plan` p50 1,7 s, `plan-datum` p50 2,1 s. Dit zijn schrijfacties met Zoho (mail, comment, statuswissel); ze draaien na een klik van de gebruiker en tonen een lader. Niet verder onderzocht.

### T3. Wat de app bij het opstarten aanroept
Uit `app.js:322-348` en `public/index.html:73-100`:
- Vóór de modules klaar zijn: `/api/auth-ik` en (enkel met bewaarde sessie) `/api/instellingen?overzicht=1` (vroege start, 2.6.0). Dat werkt.
- Direct daarna, allemaal tegelijk, zonder wachten op elkaar: `prijzen`, `availability`, `inventaris`, `afspraken`, `klantbeschikbaarheid`, `voorstel-status`, `tickets`, `rapport-archief` en `themas` (±10 tot 12 aanvragen). Dus **parallel**, geen opeenvolging. `planning-sinds` volgt pas na `tickets` (`app.js:638`; dit is "fire and forget", gecachet in een Blob-register, elk ~1 s maar blokkeert niets).
- Niets blokkeert de UI op Zoho: `loadTickets` toont eerst de bewaarde kopie en een laadskelet (2.6.0). Er is geen opeenvolgende ketting van aanvragen op de gewone tabwissel: **een tab wisselen doet geen serveraanvraag** (de schermen tekenen uit de toestand; 2.6.0 tekent Kalender en Ingepland enkel opnieuw bij een echte wijziging).
- Terugkeren naar de app (`app.js:915-921`): altijd `afspraken`, en tickets als de laatste lading meer dan 1 minuut oud is. Een tablet die vaak weggelegd en opgepakt wordt, laadt dus vaak de 5 tot 6 seconden-aanvraag opnieuw (stil, maar op de achtergrond).
- Achtergrondverkeer: tickets + voorstel-status + afspraken elke 5 minuten als de tab zichtbaar is (`app.js:847-860`, controle elke 30 s); **inventaris elke 30 s** zolang "Alle technici" actief is (`app.js:103-117`) = 120 aanvragen per uur met elk de volledige sessiecontrole. Per aanvraag laag, maar het is achtergrondbelasting die op de serverkant meetelt (en de functies tellen mee voor het Netlify-plan).
- Geen enkele `setInterval` doet zwaar tekenwerk (60 s-timers voor de huidige-tijdlijn en de hemel, `kalender.js:461`, `hemel-laag.js:17`).

### T4. Opstarten van de app zelf (statisch) **[deels nieuw: koppeling met de logs]**
- `public/index.html` is 54 kB; er zijn **113 modulepreload-regels** en 12 stylesheets; totaal ruim 2,1 MB JS (onverkleind en ongebundeld, ~100 modules) en 268 kB CSS. Metingen van de optimalisatieronde bij 150 ms per bestand: **142 verzoeken**, "klaar" na 4,3 s (koud), 4,1 s (na 2.6.0), en **3,8 s bij een warme cache** (`docs/optimalisatie/meting-na-laden-150.json`: warm 142 verzoeken, slechts 36 kB). Dat een warme cache nauwelijks sneller is, komt doordat de cache de verzoeken niet overslaat maar enkel de bytes.
- Reden: `Cache-Control: public,max-age=0,must-revalidate` op alle bestanden (live gemeten op `/` en `/js/app.js`; geen `_headers`-bestand in `public/`, geen Cache-Control in `netlify.toml`). De service worker is **netwerk-eerst voor de schil** (`public/sw-strategie.js:113-118`, `sw.js:22-23`: wacht tot 4 s op het netwerk voor de navigatie; voor elke submodule geen time-out, `subTimeoutMs = 0`), dus elk van die ruim 140 bestanden gaat bij elke start naar het netwerk om te vragen "is dit nog hetzelfde?" (een 304). Op een snelle verbinding is dat 20 tot 40 ms per bestand en merk je het niet; op een trage verbinding of met hoge latentie loopt het op tot seconden.
- Gemeten vanaf deze pc (statische bestanden, 6 metingen per bestand): tijd tot eerste byte 0,11 tot 0,38 s per bestand, verbinding 0,05 s. Dat is al 0,1 tot 0,3 s per bestand voor een 304-controle; met ~6 parallelle verbindingen per host en HTTP/2 is dat in de praktijk een paar seconden op trage netwerken.
- Het blokkeert bij een eerste bezoek zonder cache nog: Google Fonts-stylesheet en Leaflet-stylesheet (`index.html:14-15`) staan in `<head>` als renderblokkerend; Leaflet en signature_pad staan als klassieke `<script>` aan het eind van de body (`index.html:855-856`) en houden het uitvoeren van de modules op tot ze binnen zijn. Na het eerste bezoek komen ze uit de service worker-cache (cache-eerst) en kost dat niets meer. Dit is dus enkel een eerste-bezoek-probleem.
- De eerste verf en het thema-script zijn inline en klein (`index.html:16-116`): geen probleem. ExcelJS wordt pas bij de eerste export geladen (`kern/exceljs.js`), niet bij het opstarten: correct.
- **Het zwaarste verzoek bij het opstarten is dus niet een bestand maar `/api/tickets`.** De 142 bestandsverzoeken bepalen wanneer het scherm er staat; de tickets bepalen wanneer de wachtrij gevuld is.

### T5. Tekenen op een zwakke pc (enkel pc-symptoom: haperen bij scrollen) **[nog niet op echte hardware gemeten]**
- `public/css/base.css:93`: op de computer is `--blur: 28px`, in donker én licht. Er zijn **53 plaatsen met `backdrop-filter`** (`app.css` 31, `navigatie.css` 7, `base.css` 4, rest 11): op de pc krijgen alle lijstkaarten (`app.css:~180`, selector `.ticket, .cal-ticket, .stop, .inv-row, .sales-kaart…`), de weekraster, de zijkolom, het dok, de kop (`.topbar-sticky::before`, `app.css:1336`), de balken en elk venster een vervaging van 28 px met `saturate(180%)`. Bij een lijst met tientallen kaarten, boven een volledig scherm van hemel, vraagt dat per beeld veel van een zwakke of ingebouwde grafische chip.
- Op de gsm staat de vervaging op 10 px (`base.css:184`) en vanaf 2.6.0 zijn de lijstkaarten overdag zonder vervaging. De pc heeft die versoepeling **niet**.
- De regel die alle vervaging uitzet (`base.css:205-213`) hangt aan `@media (prefers-reduced-transparency: reduce)` (en een `@supports not`-regel), **niet** aan een gewone modus: een pc zonder die instelling krijgt dus altijd de volle 28 px. (Gecontroleerd: dit staat in een media query, niet in `[data-theme="light"]` zelf.)
- De hemel zelf (`hemel.css`, 3,5 kB) is een vaste laag met drie verlopen, **geen animatie** en geen beeld: goedkoop.
- Bewegende beelden bij een thema (nu Halloween): `evenement.css:40-67` animeert vallende en stijgende beelden met `steps(150…600)`, `will-change: transform` en oneindige lussen (`ev-val` 18 s, `ev-stijg` 20 s, `ev-drift` 45 s). Dit kan per beeld een eigen laag kosten; in de eerdere meting (Halloween, v2.4.0) veroorzaakte dit lange taken tot 899 ms (`2026-10-27-open-dag-snelheid.md`). De schakelaar "Bewegende beelden tijdens een thema" onder Instellingen > Dit toestel (`instellingen.js:134`) zet ze uit. Dit is dus een pc-factor die jij tijdens een themaweek zelf kunt wegnemen.
- De eerdere snelheidsmetingen (`2026-10-27-open-dag-snelheid.md`, `vergelijking-2.5.1.md`) draaiden in een headless browser **zonder grafische kaart** en dus zonder de plek waar vervaging echt kost. Ze bewijzen: geen lange taken van de eigen code, niet: vlot scrollen op een echte pc met integrated graphics.
- OneDrive: het repo staat in OneDrive; dat speelt een rol bij bouwen en testen (zie CLAUDE.md, ENOENT), niet bij het draaien van de live app in de browser.

### T6. Kleine bevindingen die nergens genoteerd staan **[nieuw]**
1. `netlify/lib/zoho.js:41-49` (`haalOrgId`) doet bij **elke** aanroep een `GET /organizations`; alleen het token wordt 55 minuten bewaard. `tickets` en `planning-sinds` (en de schrijffuncties) betalen dat elke keer (≈ 0,3 s, 1 van de 27 vragen).
2. `tickets.js:20-27`: de `/agents`-vraag wordt voor de paginering afgewacht (de commentaarregel zegt "parallel"). Ook de pagina's gaan één voor één. Vereist een nieuwe aanpak van de fasen (kan binnen S2/S3 uit het plan Server-snelheid).
3. `auth.js:93-96`: de volledige gebruikerslijst wordt in elke beveiligde functie opnieuw met `consistency: 'strong'` gelezen (en bij `instellingen.js:35`, `dashboard-bronnen.js` opnieuw). Bij 10 parallelle opstartaanvragen zijn dat 10 identieke lezingen. Een korte cache per warme instantie (enkele seconden) zou ze samenvoegen, maar **botst met uitloggen op alle toestellen** (`sessieVersie`-controle): een keuze voor Brent, niet iets dat ik zonder overleg zou doen.
4. `tickets` heeft geen eigen time-out in `netlify.toml` en `zoho.verzoek` heeft geen eigen time-out per vraag: een trage Zoho laat de hele lading wachten tot de standaardlimiet.
5. Netlify-observability toont een kleine hoeveelheid fouten: `auth-ik` 10 van 39 (waarschijnlijk 401 zonder sessie: normaal bij het inlogscherm), `themas` 4 van 105 (statuscode niet uitgezocht), `confirm-afspraak` 2 van 19. Niet onderzocht; vermelden voor volledigheid.
6. `rapport-vangnet` draait elke 5 minuten (288 aanroepen/24 u, p50 0,54 s): geen invloed op de gebruiker, wel op het aantal functie-aanroepen.

### T7. Wat ik niet kon meten
- Server-Timing zoals een echte browser ze ziet (die kop komt enkel bij een ingelogde aanvraag; ik heb niet ingelogd).
- De daadwerkelijke verdeling van de ~1 s per aanvraag tussen koude start, de oceaanovergang en Blobs-opzet. De logs geven `totaal`, `auth`, `koud` en de rand-duur; de rest is afgeleid.
- Het effect van een Europese regio (zie Voorstel 1): niet getest, enkel een redenering uit de gemeten cijfers.
- De prestatie op een echte pc van Brent (geen toegang; zie proef 3).
- Hoe lang de bestandsverzoeken op een echte 4G-verbinding duren (enkel nagebootst door de eerdere metingen).

---

## Voorstellen

Gerangschikt naar verwachte invloed op "wachten tot alles erop staat". Markering: **[PATCH]** = bugfix/kleine aanpassing op `main` (v2.6.x); **[GROTER]** = nieuwe functionaliteit of herstructurering (volgens het branchbeleid in CLAUDE.md; de refactor is sinds 2.0.0 live, dus dit gaat in overleg met Brent over takken en versie).

| # | Voorstel | Raakt | Verwachte winst (schatting) | Soort | Opmerking / risico |
|---|---|---|---|---|---|
| 1 | **Netlify-functieregio naar Europa zetten** (bv. Frankfurt of Ierland) in plaats van us-east-1 | tickets en elke aanvraag | Elke Zoho-vraag en elke aanvraag wint ongeveer de oceaanovergang: tickets mogelijk van ~5 s naar ~2 à 3 s, andere aanvragen van ~1 s naar ~0,5 s. **Niet getest**; de schatting volgt uit 0,3 à 0,4 s per Zoho-vraag en 0,3 à 0,5 s vloer. | Geen code; instelling in Netlify (Brent) | Of het kan op plan `nf_team_dev` weet ik niet; Netlify Blobs kunnen hun eigen locatie hebben: eerst meten, dan beslissen. Het wijzigt een Netlify-instelling, dus alleen met uitdrukkelijk akkoord. |
| 2 | **Tickets bij Zoho slimmer ophalen** (S2/S3 uit het plan Server-snelheid): org-id cachen, `/agents` en pagina's tegelijk starten, grotere batches binnen Zoho-limieten (nu 5 gelijktijdig) | tickets | Minder dan 27 vragen en minder fasen: ~1,5 à 2,5 s van de 4 à 6 s | **[PATCH]** voor het org-id; de rest **[GROTER]** (S2 en S3, S4 is een proef die enkel met een uitdrukkelijk ja draait) | Rate-limiet van Zoho: de `zohoGewicht`/`zohoRest`-velden in de meting geven al zicht. De onafhankelijke nakijker vond eerder dat "dubbele aanvragen" een risico zijn (zie `docs/release-checklist-2.6.0.md` sectie d). |
| 3 | **Ticketdetails bewaren in Blobs en enkel gewijzigde tickets opnieuw vragen** (per ticket: id + wijzigingstijd uit de lijstvraag; adres en custom fields uit de bewaarde kopie) | tickets | Van ~20 detailvragen naar enkel de gewijzigde: tickets in ~1 à 2 s | **[GROTER]** | Zoho's lijstvraag levert een wijzigingstijd per ticket (niet gecontroleerd in deze code); nodig is een zorgvuldige cache-invalidatie. Beste kwaliteit/prijs na 1 en 2. |
| 4 | **Statische bestanden langer laten cachen** (`Cache-Control: immutable` met versie in de bestandsnaam, of enkel de service worker-cache vertrouwen) | opstarten, elke herstart | Op een trage verbinding ~3 à 4 s sneller tot er een scherm staat; op snelle verbinding weinig | **[GROTER]** (raakt de service worker-strategie en de regel van 4 s; open vraag 3 in `release-checklist-2.6.0.md`) | De regel "app wacht tot 4 s op het netwerk" is een besluit van Brent (2026-10-02). Opties: cache-eerst met achtergrondvernieuwing, of een bundel (bijv. één of enkele bestanden). Pc-snelheid verandert hier nauwelijks. |
| 5 | **Eén gebundeld JS-bestand** (of enkele) in plaats van ~113 modules | opstarten | Minder aanvragen, op trage netwerken enkele seconden | **[GROTER]** | Vraagt een buildstap (nu geen: `[dev] command = "echo 'No build step needed'"`); raakt tests en de modulepreload-controle in `tests/sw-schil.test.mjs`. Heeft pas zin samen met 4. |
| 6 | **Sessiecontrole minder vaak met Blobs** (korte cache per warme instantie van de gebruikerslijst) | alle aanvragen | ~100 à 200 ms per aanvraag, minder belasting | **[GROTER]**/beslissing | Botst met direct uitloggen op alle toestellen (`sessieVersie`); Brent beslist over de afweging. |
| 7 | **Vervaging op de pc voorzichtiger of aan-/uitschakelbaar** (bv. 12 à 16 px of geen vervaging op lijstkaarten, zoals op de gsm) | haperen bij scrollen op een zwakke pc | Onbekend: **eerst proef 3 afwachten**; nu enkel een hypothese | **[GROTER]** (raakt de stijlbeslissing en de contrastproeven `@contrast`) | Eerdere volgorde van de afspraak: eerst minder vervaging, dan geen `backdrop-filter` op lijstkaarten (`.claude/rules/stijl.md`, sectie Snelheid). Geen wijziging zonder meting op echte hardware. |
| 8 | **Inventaris-poll van 30 s versoepelen** (bv. 2 min, of enkel bij zichtbaar tabblad én actief scherm) | achtergrondbelasting | Weinig merkbaar voor de gebruiker; 120 aanvragen/uur minder | **[PATCH]** (kleine aanpassing; wel afspraak met Brent over hoe vers de live-detectie moet zijn) | Past enkel op de weergave "Alle technici". |
| 9 | **Dashboard-N+1** (`dashboard-bronnen.js:91`, `activiteit.js:66`): per verkoper/maand parallel lezen | Beheer-dashboard (p50 2,6 s) | ~1 s op het dashboard | **[PATCH]** | Raakt enkel Beheer. |
| 10 | **Eerste bezoek: Leaflet-CSS en Fonts niet renderblokkerend** (`media="print" onload`-patroon, of Leaflet pas bij Route) | eerste bezoek zonder cache | 0,2 à 0,6 s eerste keer | **[PATCH]** of klein | Heeft op een volgend bezoek geen effect (SW-cache). Laagste prioriteit. |

Volgorde van aanpak als Brent akkoord is: eerst de **metingen van proeven 1 tot 3** (geen risico), daarna **1** (regio, als het kan), **2 en 3** (tickets), en pas daarna 4 en 5 (opstarten). Voorstel 7 (glas) pas na proef 3.

---

## Open vragen voor Brent

1. Mag ik in Netlify **alleen lezen** of ook de **functieregio** laten bekijken/wijzigen (jouw account)? Zonder jouw akkoord verzet ik niets. Ken je het plan (nu `nf_team_dev`) en of een regiokeuze mogelijk is?
2. Welk toestel en welk netwerk geeft jou de trage ervaring: pc op kantoorwifi, gsm, tablet, thuis? En is het traag **bij het opstarten**, **na een herlading**, of ook **bij het wisselen van tab**? (Een tab wisselen doet in de app geen serveraanvraag; als dat traag voelt, ligt het aan het tekenen op de pc.)
3. Hoe oud/welk type is je pc (processor, ingebouwde of aparte grafische kaart)? Heb je nog Chrome open met veel tabs of andere zware programma's?
4. Mag de **4 seconden-regel** (de app wacht tot 4 s op het netwerk) versoepeld worden naar "eerst uit de kopie starten, ondertussen controleren" (open vraag 3 in `docs/release-checklist-2.6.0.md`)?
5. Hoe vers moeten de tickets zijn? Is 1 tot 2 minuten oud (met bewaarde details en enkel de wijzigingen opnieuw opvragen) goed genoeg, of moet elke lading echt rechtstreeks uit Zoho komen?
6. Het uitloggen op alle toestellen moet nu **onmiddellijk** werken (gebruikerslijst wordt elke aanvraag opnieuw gelezen). Mag dat enkele seconden vertraging hebben als de aanvragen daardoor sneller worden (voorstel 6)?
7. Mag de inventaris-controle op "Alle technici" van 30 s naar 2 minuten (voorstel 8)?
8. Wil je dat ik op een volgend moment, na je metingen, een gerichte proef met een gsm of tablet in de browser nabootst, of is een echte meting op jouw toestel beter?

---

## Samenvatting in drie regels
1. Het wachten komt vooral van de server: `/api/tickets` duurt 4 à 6 s (95 % Zoho, 27 vragen vanuit een server in de VS, `us-east-1`), de rest van de aanvragen ± 1 s; je pc speelt enkel een rol bij haperend scrollen (glas 28 px, thema-animaties), nog niet gemeten op echte hardware.
2. Voorstellen in volgorde: functieregio naar Europa (geen code, Brent beslist), tickets slimmer ophalen (org-id cachen = PATCH; parallel/gewijzigde enkel = groter), daarna het opstarten (140 bestandscontroles, 4 s-regel) en pas na proef 3 het glas.
3. Brent kan het zelf scheiden met drie proeven (pc wifi / gsm 4G / pc via hotspot) en twee cijfers uit F12 (Netwerk-onderaan en Server-Timing van `api/tickets`); stuur die door.
