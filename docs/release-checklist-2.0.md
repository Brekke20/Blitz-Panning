# Release-checklist refactor-tak (2.0.0 of 1.11.0)

Voor het moment dat Brent de refactor vrijgeeft (zie "Branchbeleid" in `CLAUDE.md`). Bron: spec etappe 7 (N5) en de ledgers in `.superpowers/sdd/*/progress.md`. Vink af wat gedaan is.

## 1. CACHE_NAME-bump en updatepad van de service worker (spec etappe 7, N5)

- [ ] `CACHE_NAME` in `public/sw.js` ophogen (nu `blitz-planning-v25`, naar het eerstvolgende nummer). `EXTERN_CACHE` (`blitz-extern-v1`) NIET ophogen.
- [ ] De test "N19 (refactor-tak vóór release): CACHE_NAME staat nog op blitz-planning-v25 ..." in `tests/sw-schil.test.mjs` bewust aanpassen aan het nieuwe nummer; daarna `node --test` groen (SHELL-test, N16).
- [ ] `NAV_TIMEOUT_MS` staat op 4000 (Brent, 2026-10-02: een trage verbinding start na 4 s uit de bewaarde kopie, die één release oud mag zijn). Controleren dat dit nog zo is.
- [ ] `npx playwright test --project=sw` groen, ook `e2e/sw/update.spec.mjs` na de bump (de oude cachenaam is weg uit `caches.keys()`).
- [ ] Handmatig in een echte browser met een v25-installatie: één herlading toont de nieuwe versie; `skipWaiting` en `clients.claim` werken.
- [ ] Netlify cachet `sw.js` en `sw-strategie.js` niet lang: de standaard `max-age=0, must-revalidate` volstaat; controleren op de live site.
- [ ] Geen hotfix op `main` die JS wijzigt zonder ook de SHELL-test (`tests/sw-schil.test.mjs`) te draaien.
- [ ] `EXTERN_CACHE` (`blitz-extern-v1`): heeft `CDN_VAST` in `public/sw.js` sinds deze release een andere bibliotheekversie of -URL gekregen, dan blijven de oude sleutels eeuwig in de externe cache staan (`activeer` bewaart de naam). Verhoog dan `EXTERN_CACHE` (en pas de N19-test aan), of ruim de oude sleutels op in `activeer`. Is `CDN_VAST` ongewijzigd, dan niets doen.
- [ ] Versienummer in `package.json`, `CHANGELOG.md` (sectie "Refactor-tak — nog niet uitgebracht" hernoemen naar de versie), git-tag.

## 2. Handmatige controles die geen test kan doen

- [ ] **standaardPdf** (etappe 6): een echt rapport laten genereren met echte Chromium (`rapport.js`) en de PDF openen; Chromium en het Blobs-register zijn niet testbaar.
- [ ] **mailcontrole live** (I1/I2): een mail die laat vertrekt (bv. verbinding wegnemen vlak na het versturen): de app meldt niet vroeg "niet verzonden" maar controleert na 30 s opnieuw. Een tablet met een afwijkende klok (enkele minuten voor of achter): de brede controle (rapport, annuleren) blijft kloppen, want de server rekent met zijn eigen klok. `[functions.mail-check] timeout = 26` staat in `netlify.toml`; controleer in de Netlify-UI dat die overgenomen is.
- [ ] **mail-check op een echt Zoho-ticket** (etappe 7, Q1): `/api/mail-check` op een ticket waarvan zeker een mail verstuurd is en een ticket zonder. Controleren: formaat van het veld `to` (ontvangers), de statuswaarden van threads, de hoofdlettergebruik van het kanaal (`direction`/`channel`) en de paginering. Het formaat van de Zoho-threads is nooit live gecontroleerd. Daarna op een testticket een time-out nabootsen en kijken of de melding "Mail is verzonden om hh:mm" of "niet verzonden" klopt.
- [ ] **planning-sinds op een echt ticket** (eindreview I2): één live, enkel-lezen test van `/api/planning-sinds` op een echt ticket (via `netlify dev` of een eenmalige curl met `{"opzoeken":["<id>"],"actief":["<id>"]}`). Vergelijk de teruggegeven datum met de statusgeschiedenis in Zoho. De aanroep `GET /tickets/{id}/History?fieldName=status` en de vorm van het antwoord (`eventInfo[].propertyName/propertyValue.previousValue`) zijn nooit live gecontroleerd. Mislukt de opzoeking, dan staat `{ mislukt }` 6 uur in het register `planning-sinds` en volgt geen nieuwe Zoho-aanroep voor dat ticket: kijk in de Netlify-logs naar `planning-sinds:`.
- [ ] **Inventaris-export** (etappe 7): de Excel-export van de Inventaris (lazy geladen ExcelJS) met de hand draaien en in Excel openen: kolombreedtes, rijhoogtes, opmaak. De TicketLog-export idem (Type, Prio, Notities, Actie).
- [ ] **CONFIRM_LINK_SECRET** nog ingesteld in Netlify, en de groene bevestigknop in de voorstelmail testen zodra de release live staat, op een testticket (op de lokale proefserver ontbreekt die knop omdat het geheim niet in `.env.local` staat: verwacht).
- [ ] **confirm-afspraak getStore-seam** (etappe 6): de functie `confirm-afspraak` heeft een `getStore`-naad die enkel de test raakt; echt doorlopen met een bevestigde afspraak.
- [ ] **Non-JSON token- of org-antwoord** (etappe 6, T3): wat doet de app als Zoho bij het token of de organisatie een antwoord zonder JSON geeft? Nagaan dat de fout begrijpelijk is.
- [ ] **Offline start** op een gsm met de oude v25 geïnstalleerd en daarna de nieuwe versie: de app start zonder verbinding met de kaartbibliotheek aanwezig.
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
- [ ] **(c) Versiekeuze.** 2.0.0 of 1.11.0 beslist Brent (strikt volgens semver is 1.11.0 verdedigbaar: niets breekt data of verwijdert een functie; "Plan deze week" met "Iedereen" toont nu een melding). Zet `package.json`, geef de CHANGELOG-sectie de versie én een datum, en zet de git-tag op de deploy-commit.
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
