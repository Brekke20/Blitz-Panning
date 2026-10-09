# Release-checklist refactor-tak (2.0.0 of 1.11.0)

Voor het moment dat Brent de refactor vrijgeeft (zie "Branchbeleid" in `CLAUDE.md`). Bron: spec etappe 7 (N5) en de ledgers in `.superpowers/sdd/*/progress.md`. Vink af wat gedaan is.

## 1. CACHE_NAME-bump en updatepad van de service worker (spec etappe 7, N5)

- [ ] `CACHE_NAME` in `public/sw.js` ophogen (nu `blitz-planning-v27`, naar het eerstvolgende nummer). `EXTERN_CACHE` (`blitz-extern-v1`) NIET ophogen.
- [ ] De test "N19 (refactor-tak vóór release): CACHE_NAME staat op de live waarde blitz-planning-v27 ..." in `tests/sw-schil.test.mjs` bewust aanpassen aan het nieuwe nummer; daarna `node --test` groen (SHELL-test, N16).
- [ ] `NAV_TIMEOUT_MS` staat op 4000 (Brent, 2026-10-02: een trage verbinding start na 4 s uit de bewaarde kopie, die één release oud mag zijn). Controleren dat dit nog zo is.
- [ ] `npx playwright test --project=sw` groen, ook `e2e/sw/update.spec.mjs` na de bump (de oude cachenaam is weg uit `caches.keys()`).
- [ ] Handmatig in een echte browser met een v27-installatie: één herlading toont de nieuwe versie; `skipWaiting` en `clients.claim` werken.
- [ ] Netlify cachet `sw.js` en `sw-strategie.js` niet lang: de standaard `max-age=0, must-revalidate` volstaat; controleren op de live site.
- [ ] Geen hotfix op `main` die JS wijzigt zonder ook de SHELL-test (`tests/sw-schil.test.mjs`) te draaien.
- [ ] `EXTERN_CACHE` (`blitz-extern-v1`): heeft `CDN_VAST` in `public/sw.js` sinds deze release een andere bibliotheekversie of -URL gekregen, dan blijven de oude sleutels eeuwig in de externe cache staan (`activeer` bewaart de naam). Verhoog dan `EXTERN_CACHE` (en pas de N19-test aan), of ruim de oude sleutels op in `activeer`. Is `CDN_VAST` ongewijzigd, dan niets doen.
- [ ] Versienummer in `package.json`, `CHANGELOG.md` (sectie "Refactor-tak — nog niet uitgebracht" hernoemen naar de versie), git-tag.

## 1b. Logins (logins + beheer, `refactor-logins`)

Handleiding voor Brent: `docs/logins-en-beheer.md`. Ledger: `.superpowers/sdd/2026-10-08-logins-beheer/progress.md`.

**Netlify-instellingen**
- [ ] `SESSIE_GEHEIM` ingesteld (lange willekeurige tekst, minstens 32 tekens). Dezelfde waarde voedt de interne sleutel van de achtergrondfunctie.
- [ ] `BEHEER_SETUP_CODE` ingesteld voor het eerste beheerdersaccount; na het aanmaken van de eerste beheerder weer verwijderd.
- [ ] `BEHEER_HERSTELSLEUTEL` staat er NIET (enkel tijdelijk bij een noodgeval, minstens 32 tekens, daarna weer weg).
- [ ] `BLITZ_LOKALE_DEV` en `NETLIFY_DEV` zijn NIET gezet in Netlify (anders valt de bescherming van de testrol weg).
- [ ] Netlify-functietime-outs: `auth-login` (scrypt) heeft ruim genoeg tijd, ook bij een koude start.
- [ ] `CACHE_NAME` staat op `blitz-planning-v27` (komt van `refactor`, niet door de logins-tak gewijzigd) en wordt bij de release bewust opgehoogd (zie sectie 1).
- [ ] Tweestapsverificatie aangezet op Brents Netlify-login (aanbeveling).

**Live-proeven (één keer, kort)**
- [ ] Een verzoek met de kop `X-Blitz-Test-Rol` zonder sessie geeft 401 (de testrol werkt dus niet in productie).
- [ ] De `confirm-afspraak`-link uit een echte voorstelmail werkt zonder login.
- [ ] `planning-export` met zijn sleutel geeft nog data (ook de interne aanroepen naar tickets, afspraken en klantbeschikbaarheid met de Bearer-sleutel).
- [ ] Rechtenrijen in `netlify/lib/rechten.js` voor de upload-fix: `rapport-ontvangen` (POST voor alle interne rollen; geen weigering op naam, een rapport onder de naam van een collega wordt aanvaard en gelogd; enkel een id-botsing met andermans rapport geeft 403), `rapport-verwerk-background` en de geplande `rapport-vangnet` (rij `open`, want niet door een gebruiker aangeroepen; de achtergrondfunctie wordt in de functie zelf beschermd met de interne sleutel, omdat ze via haar URL bereikbaar is). `tests/rechten.test.mjs` is groen.
- [ ] **De interne sleutel overleeft de server-naar-server-aanroep.** `rapport-ontvangen` roept `rapport-verwerk-background` aan met de kop `X-Blitz-Intern`. Live bewijzen zoals het bewijs van v1.10.2: een rapport versturen, het scherm meteen vergrendelen, en controleren dat het rapport toch in Zoho aankomt. Een rechtstreeks verzoek naar de achtergrondfunctie zonder die kop moet geweigerd worden. Controleer ook dat `SESSIE_GEHEIM` echt gezet is (zonder geeft de achtergrondverwerking een fout).
- [ ] **Opstart op een gsm met traag netwerk** (eindreview I1/I2): in DevTools "Slow 3G", en in vliegtuigmodus met een gecachte sessie. De planning moet binnen ongeveer 8 s zichtbaar zijn (auth-ik wacht met een gecachte sessie hooguit 5 s, daarna start de app uit de cache) en de app moet gewoon starten bij een 5xx of een inlogpagina van een klant-wifi op `/api/auth-ik`. Een verlopen sessie opent daarna het inlogscherm.
- [ ] **Eerste dag, volgorde** (eindreview I3): laat eerst de planner inloggen op het coördinatortoestel (daar staan de instellingen per technieker; die gaan bij de eerste synchronisatie eenmalig naar de server als de server er nog niets van heeft), daarna pas de techniekers. Vergelijk per technieker startlocatie, werkuren en maximaal per dag met de waarden van vóór de release.
- [ ] **zohoNaam per technieker** (eindreview M2): exact gelijk aan de naam waaronder Zoho de tickets toewijst (hoofdletters en spaties). De technieker ziet na zijn eerste login zijn eigen tickets.
- [ ] **Outbox van vóór de update** (eindreview, punt 8): bestaande items in de outbox (oude service worker nog actief) blijven staan tot na de login en worden dan verzonden.
- [ ] **`auth-login` bij een koude start** antwoordt binnen de functietime-out (scrypt plus drie of vier Blobs-rondes).
- [ ] **Proef ZONDER `?test` samen met Brent** (niet 's nachts gedaan, want zonder `?test` kan de lokale server echte Zoho aanspreken): het eerste-beheerderscherm met `BEHEER_SETUP_CODE`, inloggen, een gebruiker aanmaken (startwachtwoord, verplichte wijziging), uitloggen, en een gebruiker blokkeren (die kan niet meer inloggen).

**Uitrolnotities**
- [ ] Een gedeelde tablet zonder eigenaarsmarker (de app draaide er al vóór de logins) geeft zijn lokale instellingen aan de EERSTE gebruiker die inlogt. Laat op zo'n toestel eerst de bedoelde gebruiker inloggen.
- [ ] Onverzonden rapporten in de outbox blijven bij een gebruikerswissel altijd bewaard; een rapport dat met 403 geweigerd wordt (id van andermans rapport) blijft in de outbox met de melding "meld dit aan de planner" en staat als `rapport-geweigerd` in het activiteitenlog.
- [ ] De knop "Opnieuw versturen" op de tab Systeemstatus is NIET gebouwd. Brent beslist of dat nog vóór de release komt (zie `docs/bugs-en-open-punten.md`, sectie F).

## 1c. Sales-planner (`refactor-sales`)

Handleiding voor Brent: `docs/logins-en-beheer.md` (sectie "Sales"). Ledger: `.superpowers/sdd/2026-10-08-sales-planner/progress.md`. Open punten: `docs/bugs-en-open-punten.md`, sectie I.

- [ ] **Echte TomTom-geocoding.** De sales-code is nooit tegen de echte dienst getest (alle tests gebruiken nepantwoorden). Doe één live-proef met een export van enkele verzonnen of eigen leads: (1) een lead met enkel een postcode krijgt een marker op het middelpunt van die postcode; (2) een lead met volledig adres staat op het juiste adres; (3) controleer in het antwoord van `structuredGeocode` dat het veld `address.postalCode` bestaat en overeenkomt met de gevraagde postcode (de code controleert de postcode van het antwoord en weigert anders); (4) `/api/postcode?pc=3640` geeft plaats en middelpunt en de tweede aanroep komt uit de cache (blob `postcode-cache`).
- [ ] **Netlify bundelt `public/js/sales/*` voor `sales-import`.** De serverfuncties `sales`, `sales-import` en `sales-opruimen` importeren de pure regelmodules uit `public/js/sales/` en `public/js/kern/`. Controleer in de eerste deploy-preview dat `/api/sales-import` een export inleest (geen "Cannot find module" in de functielogs).
- [ ] **De geplande opruiming `sales-opruimen` staat geregistreerd.** Netlify-UI, Functions: `sales-opruimen` staat als geplande functie (`@daily`) en draait; de functielogs tonen na de eerste nacht een uitvoering (hoogstens eens per 6 uur, via de marker `sales-opruimen-laatste`). Controleer ook dat `activiteit-opruimen` ernaast nog draait.
- [ ] **`/api/route` live met `departAt`.** De tab Route stuurt `{ waypoints, departAt }`. Controleer met een echte verkoper en een dag met 3 bezoeken dat de ritten op de kaart en in de lijst geen "Rit geschat"-toast geven en dat de rijtijd verschilt naargelang het vertrekuur (verkeer).
- [ ] **`SESSIE_GEHEIM` blijft ongewijzigd na de livegang.** De code die onthoudt dat een lead weggeklikt werd (grafsteen) is afgeleid van dit geheim; wijzigt het, dan komen weggeklikte leads zonder label "eerder verwijderd" terug.
- [ ] **Functietime-outs.** `[functions.sales]`, `[functions.postcode]` en `[functions.sales-import]` staan op 26 s in `netlify.toml`; controleer dat de Netlify-UI dat overneemt. Het geocodingbudget van een import is 12 s.
- [ ] **Rollen live nakijken.** Een testverkoper ziet enkel de vier sales-tabs; met "Mag alle sales zien" ziet hij een collega alleen-lezen; een planner en een technieker krijgen 403 op `/api/sales`; de beheerder heeft één tab Sales en geen knop Export laden.
- [ ] **Hele keten met echte gebruikers (samen met Brent).** De beheerder maakt een verkoper aan (Naam in export, eventueel Mag alle sales zien); de verkoper logt in, laadt een echte export, voegt met + Lead een lead toe, plant de week en bekijkt de route. Daarna controleren dat een tweede verkoper niets van de eerste ziet.
- [ ] **Smalle schermen.** De beheerder heeft nu 8 hoofdtabs (7 + Sales): controleer de tabbalk op 375 px.
- [ ] **Sales-bestanden in de service worker.** `public/sw.js` `SHELL` bevat de sales-bestanden (de SHELL-test is groen); de `CACHE_NAME`-bump van sectie 1 geldt ook voor deze bestanden.

## 2. Handmatige controles die geen test kan doen

- [ ] **standaardPdf** (etappe 6): een echt rapport laten genereren met echte Chromium (`rapport.js`) en de PDF openen; Chromium en het Blobs-register zijn niet testbaar.
- [ ] **mailcontrole live** (I1/I2): een mail die laat vertrekt (bv. verbinding wegnemen vlak na het versturen): de app meldt niet vroeg "niet verzonden" maar controleert na 30 s opnieuw. Een tablet met een afwijkende klok (enkele minuten voor of achter): de brede controle (rapport, annuleren) blijft kloppen, want de server rekent met zijn eigen klok. `[functions.mail-check] timeout = 26` staat in `netlify.toml`; controleer in de Netlify-UI dat die overgenomen is.
- [ ] **mail-check op een echt Zoho-ticket** (etappe 7, Q1): `/api/mail-check` op een ticket waarvan zeker een mail verstuurd is en een ticket zonder. Controleren: formaat van het veld `to` (ontvangers), de statuswaarden van threads, de hoofdlettergebruik van het kanaal (`direction`/`channel`) en de paginering. Het formaat van de Zoho-threads is nooit live gecontroleerd. Daarna op een testticket een time-out nabootsen en kijken of de melding "Mail is verzonden om hh:mm" of "niet verzonden" klopt.
- [ ] **planning-sinds op een echt ticket** (eindreview I2): één live, enkel-lezen test van `/api/planning-sinds` op een echt ticket (via `netlify dev` of een eenmalige curl met `{"opzoeken":["<id>"],"actief":["<id>"]}`). Vergelijk de teruggegeven datum met de statusgeschiedenis in Zoho. De aanroep `GET /tickets/{id}/History?fieldName=status` en de vorm van het antwoord (`eventInfo[].propertyName/propertyValue.previousValue`) zijn nooit live gecontroleerd. Mislukt de opzoeking, dan staat `{ mislukt }` 6 uur in het register `planning-sinds` en volgt geen nieuwe Zoho-aanroep voor dat ticket: kijk in de Netlify-logs naar `planning-sinds:`.
- [ ] **Inventaris-export** (etappe 7): de Excel-export van de Inventaris (lazy geladen ExcelJS) met de hand draaien en in Excel openen: kolombreedtes, rijhoogtes, opmaak. De TicketLog-export idem (Type, Prio, Notities, Actie).
- [ ] **CONFIRM_LINK_SECRET** nog ingesteld in Netlify, en de groene bevestigknop in de voorstelmail testen zodra de release live staat, op een testticket (op de lokale proefserver ontbreekt die knop omdat het geheim niet in `.env.local` staat: verwacht).
- [ ] **confirm-afspraak getStore-seam** (etappe 6): de functie `confirm-afspraak` heeft een `getStore`-naad die enkel de test raakt; echt doorlopen met een bevestigde afspraak.
- [ ] **Non-JSON token- of org-antwoord** (etappe 6, T3): wat doet de app als Zoho bij het token of de organisatie een antwoord zonder JSON geeft? Nagaan dat de fout begrijpelijk is.
- [ ] **Offline start** op een gsm met de oude v27 geïnstalleerd en daarna de nieuwe versie: de app start zonder verbinding met de kaartbibliotheek aanwezig.
- [ ] **Wagenvoorraad-aftrek** (Q4): een rapport versturen met een kortstondig weggevallen verbinding; de melding verschijnt, de aftrek komt later vanzelf, en er wordt nooit dubbel afgetrokken (ook niet met twee tabs open).

- [ ] **Laadmeting op een echte tablet** (`docs/bugs-en-open-punten.md`, laadmeting): Chrome DevTools met "Slow 4G"-throttling of een echt toestel; koude start, warme start en start met service worker, en `node scripts/meet-laden.mjs` (mediaan van alternerende voor/na-runs) als vergelijking. Het harnas draait HTTP/1.1 op localhost en kan de winst van modulepreload niet tonen; beslis pas na een meting op een echt netwerk.
- [ ] Overzicht van alle bekende bugs en open punten van de refactor: `docs/bugs-en-open-punten.md` doorlopen vóór de release.

## 3. Vragen voor Brent bij de release (etappe 7)

- [ ] Na "mail is verzonden" (na een twijfelgeval) wordt het register en de badge "Verzonden" niet geschreven. Gewenst zo? (W11)
- [ ] Een definitieve 500 na de mail (Zoho PATCH faalt na `sendReply`) krijgt geen mailcontrole. Gewenst zo?
- [ ] Meerkost-kabel drempelprijs ("boven 10 m", PR #2) is een voorlopige aanname: navragen bij zijn supervisor.
- [ ] Bugs die mogelijk een bugfix op `main` waard zijn (Brent beslist): wachtrij-klantvoorkeur-labels die ontbreken als klantbeschikbaarheid later binnenkomt. (Het afspraken-409-verlies is al in etappe 2 opgelost op `refactor`; op `main` bestaat het nog: Brent beslist of dat een bugfix op `main` wordt.)

## 4. Bekende, bewust gelaten restanten

- Een route-volgorde slepen tijdens een render kan af en toe geannuleerd worden (N12, `applyRouteOrder` op verouderde objecten).
- `negeerSchrijfstand` in `loadTickets` (via `route.js`) slaat de hele schrijfstand-controle over in plaats van enkel het routedeel.
- Focus en cursor kunnen verloren gaan bij een hertekening van de tab Beschikbaarheden (`beschikbaarheid.js:437`).
- De rapportwizard blijft inline handlers gebruiken en wordt in deze refactor niet aangepast; de waarschuwing in de wizard bij offline gaan staat op de lijst voor na de release (Q3).

## 5. Releasestappen (Brent keurt elke stap goed)

- [ ] **(a) Pre-push-hook.** `.git/hooks/pre-push` blokkeert elke push naar `main` die `ea28f2f` bevat. De release-push heeft dus een bewuste stap nodig die Brent goedkeurt: de hook aanpassen of verwijderen. NOOIT `--no-verify`. In dezelfde stap: de sectie "Branchbeleid" in `CLAUDE.md` bijwerken (refactor is nu de hoofdlijn) en de memory-notitie `feedback_branchbeleid_refactor.md`.
- [ ] **(b) Hotfixes.** `git fetch`, daarna `origin/main` nakijken op nieuwe commits (hotfixes) en `git merge main` in `refactor` vóór de release. Lokale `main` is een voorouder van `refactor`, maar `origin/main` is nog niet opgehaald. Draai na de merge opnieuw `node --test` en de sw-tests.
- [ ] **(c) Versiekeuze.** BESLIST (Brent, 2026-10-08): **2.0.0** — de release met de sales-planner is een grote release. (Vroeger: 2.0.0 of 1.11.0 beslist Brent (strikt volgens semver is 1.11.0 verdedigbaar: niets breekt data of verwijdert een functie; "Plan deze week" met "Iedereen" toont nu een melding). Zet `package.json`, geef de CHANGELOG-sectie de versie én een datum, en zet de git-tag op de deploy-commit.
- [ ] **(d) Netlify-UI.**
  - [ ] Controleer de functietime-outs (`timeout = 26`) van alle functies waar `netlify.toml` er een instelt (`propose`, `send-rapport`, `annuleer`, `mail-check`, enz.), niet enkel `mail-check`. De clientlogica (`SERVER_MAX_MS = 30000`) gaat ervan uit dat ze uiterlijk na 26 s stoppen.
  - [ ] Controleer dat de nieuwe functies `mail-check` en `planning-sinds` in de deploy staan, en dat de `ZOHO_*`-variabelen site-breed zijn.
  - [ ] Volg de functielogs een dag lang op `planning-sinds:`, `mail-check fout` en "Token refresh mislukt" (twee extra functies betekenen meer token-verversingen bij een koude start, en Zoho beperkt die per refresh-token).
- [ ] **(e) Terugdraaiplan.** De vorige deploy kan in de Netlify-UI opnieuw gepubliceerd worden ("Publish deploy"). Het servercontract is achterwaarts compatibel: een oude v1.10.1-client werkt tegen de nieuwe functies. Een terugdraaiing heeft óók een nieuwe `CACHE_NAME`-bump nodig in de oude code, want de nieuwe service worker blijft zijn eigen schil-kopie serveren bij trage starts.
- [ ] **(f) Technieker-mededeling.** Zeg de techniekers dat ze de app na de release één keer openen op wifi, en herladen als het scherm leeg blijft (tijdelijk risico bij een wankele eerste verbinding na de update).
- [ ] **(g) Regel voor de toekomst.** Elke release die iets onder `public/` wijzigt, verhoogt `CACHE_NAME` (staat in `CLAUDE.md`, "Versioning & changelog").

## 6. Handtests in de proefperiode (de vijf scenario's uit de eindreview)

- [ ] **Versturen, dan slaap.** Op een gsm: een voorstel of rapport op een testticket versturen, meteen het scherm vergrendelen en de verbinding weghalen (vliegtuigmodus) gedurende enkele minuten, dan weer wakker maken. De app mag nooit "niet verzonden" melden als de mail wel vertrokken is (I1). Probeer ook de gewone variant: de verbinding wegnemen vlak na het versturen.
- [ ] **"In planning sinds".** Open het detail van enkele oude en nieuwe tickets en vergelijk met de statusgeschiedenis in Zoho; kijk in de Netlify-logs naar `planning-sinds:`-fouten (I2).
- [ ] **Update vanaf v1.10.1 op een echte tablet en gsm** met de oude app geïnstalleerd: één herlading na de deploy toont de nieuwe versie; daarna offline starten (app en kaart werken); daarna starten met trage 4G (de app start na ongeveer 4 s).
- [ ] **De volledige Zoho-keten op een testticket** (zonder `?test`, via `netlify dev` tegen echte Zoho of meteen na de release): inplannen, verzetten, voorstel versturen, annuleren met mail, rapport schrijven (PDF controleren), rapport versturen, "Oplossing → Zoho". Controleer in Zoho dat elke status, datum en mail klopt en **precies één keer** voorkomt.
- [ ] **Twee toestellen tegelijk.** Afspraken en klantbeschikbaarheid gelijktijdig aanpassen (er mag niets verdwijnen); twee rapporten met materiaal uit twee tabs versturen (de wagenvoorraad wordt precies één keer afgetrokken); op een trage verbinding "Vernieuwen" tijdens het plannen (geen ticket springt terug).
