# Onderzoek: Blitz Run werkt niet voor een echte verkoper (Ward)

Datum: 2026-10-29. Alleen onderzoek, niets gewijzigd, niets gecommit. Basis: `main` op v2.6.0 (`package.json`; de opdracht sprak van live v2.5.1, maar `main` staat al op 2.6.0, dus de patch wordt 2.6.1).

## Samenvatting voor Brent

- **Wat er mis is:** voor een echte verkoper (zoals Ward) wordt het geheime "5× tikken op de bliksem"-mechanisme nooit aangezet. Hij tikt dus tien keer en er gebeurt niets: geen spel, geen melding, geen foutmelding.
- **Waarom bij jou wel:** als beheerder start de app via de "gewone" route, en daar wordt het spel wel ingeschakeld. Een verkoper start via een eigen, lichtere route (die bestaat omdat de gewone start oproepen doet waar verkopers geen toegang toe hebben). Bij het bouwen van die lichte route is het spel vergeten.
- **Ligt het aan zijn rechten?** Nee. De server laat verkopers het spel gewoon gebruiken. Ook de scores bewaren zou werken, zodra het spel opent.
- **Wie zijn er nog getroffen?** Elke verkoper, ook een sales manager. Planners, techniekers en jij niet.
- **Zeker?** Ja, dit is uit de code zelf af te leiden en het enige verschil tussen beide routes. Ik heb het nog niet in een browser uitgeprobeerd (geen echte accounts, en er wordt niets gebouwd).
- **Oplossing:** klein: het spel moet voor alle rollen worden ingeschakeld, niet enkel in de gewone start. Eén verplaatsing van een blok code plus één testscenario.
- **Bugfix of nieuwe functie?** Bugfix: het spel hoort al voor iedereen te werken (de documentatie zegt "alle rollen"). Past op `main` als patch (v2.6.1).
- **Vraag aan jou:** niets blokkerends; zie onderaan.

## Technisch

### Oorzaak (zeker)

Het spel wordt alleen geactiveerd in `opstart()`, en verkopers doorlopen `opstart()` nooit.

1. `public/js/app.js:156-166`: `installeerSpelOpening({ doel: [.logo-icon, .zijkolom-logo-icoon], ... })` staat **binnen** `function opstart()`. Dat is de enige plek in de hele app waar het wordt aangeroepen (grep op `installeerSpelOpening` buiten `spel/`: alleen `app.js:64` (import) en `app.js:161`). Het koppelt de klik-luisteraar die de 5 tikken telt (`spel/spel-opening.js:43-64`).
2. `public/js/schermen/rol-schil.js:158-161`: `const start = startVoorRol(gebruiker.rol); if (start) { await start() } else { geefSchilVrij(); opstart(); }`. Een rol met een eigen start krijgt **in plaats van** `opstart()` die eigen start.
3. `public/js/schermen/sales-registratie.js:23`: `registreerStart('sales', () => import('./sales-start.js').then(m => m.start()))`. Enkel rol `sales` heeft zo'n eigen start. De beheerder niet, dus die loopt wel door `opstart()` (ook als hij in de werkruimte Sales staat; dat is enkel een andere tabset, `rol-schil.js:80-83`).
4. `public/js/schermen/sales-start.js:61-93` zet enkel tabs, thema, ⚙, ↺, persoonskiezer en sticky offsets op en noemt het spel nergens (de header zegt zelf: "vervangt voor sales de gewone `opstart()`"). `sales-start.js:1-2`: de reden is dat `opstart()` ~15 endpoints aanroept die voor sales 403 geven.
5. Gevolg: voor rol `sales` (ook sales manager, `magAlleSales`; zelfde rol) hangt er geen luisteraar op `.logo-icon`/`.zijkolom-logo-icoon`. Geen overlay, geen `#spel-tik-toast` na de 3e/4e tik, `spel-ui.js` wordt nooit geladen, `/api/spel` wordt nooit aangeroepen. Dat past bij "het werkt niet" zonder enige fout.

De logo-iconen zelf zijn aanwezig voor alle rollen (`index.html:251` en `:280`, geen rolregel in `css/navigatie.css` of `css/app.css:1207-1213`: `.coord-only` raakt ze niet).

Historie: het spel is toegevoegd in `a717d70` (feat(spel)) enkel in `opstart()`; de sales-start (`86c0f56`) bestond al of had er geen weet van. `.claude/rules/spel.md` zegt "Rechten: rij `spel` (`GET`/`POST`: alle rollen)", dus bedoeld gedrag is: werkt voor iedereen.

Dezelfde fout-klasse zit ook in `e2e/helpers.mjs:367`: voor `loginRol === 'sales'` wacht `startApp` niet op de app, en `e2e/spel.spec.mjs` start alleen als standaardrol. Er is dus geen test die een verkoper het spel laat openen.

### Uitgesloten (met bewijs)

| Mogelijkheid | Uitslag |
|---|---|
| Server weigert sales | Nee. `netlify/lib/rechten.js:78-79`: `'spel': { GET: ALLE, POST: ALLE }`, `ALLE` = beheerder, planner, technieker, sales (`rechten.js:23`). `beveiligd.js:35-78` toetst enkel de echte sessierol, geen "bekeken rol". |
| Sessie/CSRF voor sales | Nee. `auth.js:103-111`: zelfde controle voor alle rollen; POST vraagt `X-Blitz: 1` (de client stuurt dat overal). `moetWachtwoordWijzigen` geldt voor elke rol. |
| Ongeldig gebruikers-id | Nee. `nieuwId()` = `u-<12 hex>` (`gebruikers.js:18-20`), past in `geldigId` (`lib/spel.js:19`). |
| `/api/themas` voor de skinlijst | Nee. `rechten.js:81`: GET voor `ALLE`; `vernieuwThemas()` loopt voor alle rollen (`app.js:1061-1065`). |
| Lazy module niet in SHELL | Geen rol-verschil; alle spelbestanden staan in de SHELL (zou voor iedereen falen en bij jou werkt het). |
| Feature-flag/rolcheck in spelcode | Geen enkele: `spel/*.js` en `lib/spel.js` kennen geen rol. |
| Het spel zelf heeft sales-data nodig | Nee: `spel-ui.js` importeert enkel `api`, `sessie`, `venster`, skins (geen app.js-afhankelijkheid). |

### Alternatieven, geordend (als de hoofdoorzaak onverwacht niet blijkt te kloppen)

1. (zeer onwaarschijnlijk) Ward tikt op de tekst "Blitz Planning" i.p.v. het bliksem-icoon of te traag (>600 ms per tik). Dat is gedrag volgens ontwerp, niet rol-afhankelijk; bij Brent werkt het met dezelfde tikken.
2. (onwaarschijnlijk) Een oude service-worker-schil bij Ward. Dat verklaart geen rolverschil.
3. (alleen na het spel openen) Een Blobs-fout geeft 503 op `/api/spel`; het spel werkt dan offline door met de lokale kopie.

Een test in de browser bij Ward bevestigt het in 10 seconden: opent de pagina als verkoper, devtools > Console: `document.querySelector('.logo-icon')` heeft geen luisteraar (`getEventListeners` in Chrome). Niet nodig om het te fixen.

### Minimale fix (NIET geïmplementeerd)

In `public/js/app.js`:

1. Verplaats het blok `installeerSpelOpening({...})` (regels 157-166, met de commentaar) uit `opstart()` naar de gedeelde `DOMContentLoaded`-keten onderaan, in de `.then(() => { if (!huidigeGebruiker()) return; ... })` van `startNaInlog(opstart)` (`app.js:1061-1065`). Die runt na login voor élke rol (ook sales, zie het commentaar op `app.js:1053-1054`).
2. Verwijder het blok uit `opstart()`, anders komen er twee luisteraars op het logo: elke tik telt dan dubbel (de twee tellers openen en sluiten het overlay in dezelfde 5e tik). Maak de aanroep voor de zekerheid idempotent (`let spelOpening = null; spelOpening ??= installeerSpelOpening(...)`).
3. Een spel op het inlogscherm is niet gewenst: daarom na de login installeren (en niet los in `DOMContentLoaded` voor `startNaInlog`).
4. **Ontwerpkeuze voor wie het bouwt:** nu is de installatie de eerste regel van `opstart()`, dus het spel overleeft een latere fout in `opstart()`. Staat de aanroep in `startNaInlog(opstart).then(...)`, dan valt het spel weg voor álle rollen zodra `opstart()` gooit (dan loopt de belofte naar `.catch`). Installeer het dus zo dat het niet afhangt van het slagen van `opstart()`: bij voorkeur in `startNaInlog` zelf (`rol-schil.js`, vlak vóór de keuze `start`/`opstart`, via een door `app.js` meegegeven haak), of in een `.then`/`.catch`-gedeelde stap gated op `huidigeGebruiker()`. Een eigen try/catch binnen `.then` is niet genoeg.

Risico's/aandachtspunten:
- Voor de andere rollen verschuift de installatie van "begin `opstart()`" naar "net nadat `opstart()` terugkeert" (`opstart()` wordt niet gewacht): een fractie van een seconde, onmerkbaar.
- `index.html` modulepreload en `SHELL` in `sw.js` veranderen niet (geen nieuw bestand).
- Wijziging onder `public/` ⇒ `CACHE_NAME` in `public/sw.js:10` ophogen (nu `blitz-planning-v43`), volgens de CACHE_NAME-regel.
- Documentatie: één zin in `.claude/rules/spel.md` ("geïnstalleerd in `app.js` voor alle rollen, ook sales, dat `opstart` niet doorloopt").

Alternatief (minder mooi, niet aanbevolen): dezelfde aanroep nogmaals in `sales-start.js` zetten; dupliceert de themabronnen en kan dezelfde fout bij een volgende rol met eigen start opnieuw maken.

### Regressietests

1. **Playwright, aanbevolen:** in `e2e/spel.spec.mjs` een test "een verkoper opent het spel met 5 tikken". Opzet: kopieer de sales-start uit `e2e/skelet.spec.mjs:133-140` (of `e2e/sales-rollen.spec.mjs:143`): `maakSalesBackend()`, `startApp(page, { loginRol: 'sales', overschrijf: { 'auth-ik': authIkVoor(SALES_GEBRUIKER), ...backend.stubs } })`; wacht op `#view-sales-lijst` of de eerste sales-tab; `snelTikken(page, spelLogo(page), 5)` (`helpers.mjs:414`); verwacht `#spel-overlay` met `open` en `data-status`. Tweede controle: `Escape` of 5× tikken sluit hem. Run gericht: `npx playwright test e2e/spel.spec.mjs --project=chromium` (geen volledige suite).
2. **`node --test`, aanvullend en goedkoop:** een bronbewaker in `tests/` die controleert dat in `public/js/app.js` `installeerSpelOpening(` niet binnen het lichaam van `function opstart()` staat en precies één keer wordt aangeroepen. Eenvoudig, maar pint de reden vast ("sales loopt `opstart` niet door"). Optioneel: in `tests/rechten.test.mjs` een regel `rollen('spel','GET')` en `'POST'` = `[B,P,T,S]` (vangt een server-regressie; verklaart deze bug niet).

### Bugfix of niet?

**Ja, bugfix (PATCH op `main`, v2.6.1).** Het spel hoort volgens `spel.md` en `rechten.js:78` voor alle rollen te werken; het ontbrak enkel door de aparte sales-start. Geen nieuwe functionaliteit, geen datamodelwijziging. Volgens het branchbeleid mag dit dus rechtstreeks op `main` (met CHANGELOG-entry en CACHE_NAME-bump; de refactor is sinds 2.0.0 live, dus geen aparte tak meer nodig voor het binnenhalen). Niet implementeren zolang jij geen go geeft (deploy altijd eerst navragen).

## Open vragen voor Brent

1. **Wil je dat de bugfix op `main` komt als v2.6.1 (met deploy), of meeliften met de volgende release?** Aanbeveling: meeliften met de eerstvolgende release die toch naar productie gaat; het is een verborgen extraatje zonder hinder, en een aparte deploy kost een CACHE_NAME-bump voor alle toestellen.
2. **Moet het spel ook voor een sales manager openen?** Aanbeveling: ja (zelfde rol, zelfde gedrag als alle anderen; spel.md zegt "alle rollen"). Dit is de standaardkeuze van de fix.
3. **Wat Ward precies ziet?** Niet meer nodig: zonder luisteraar is "tikken, niets gebeurt" het enige mogelijke beeld, en dat past bij wat je beschrijft. Enkel als hij een foutmelding of een leeg overlay noemt, is de analyse onvolledig; vraag dat dan.

## Samenvatting (3 regels)

- Oorzaak: `installeerSpelOpening` staat enkel in `opstart()` (`app.js:161`); rol sales gebruikt `sales-start.js` (`rol-schil.js:161`) en krijgt de luisteraar nooit.
- Fix: de aanroep verplaatsen naar de gedeelde post-login-keten (`app.js:1061`), plus e2e-test als verkoper in `e2e/spel.spec.mjs`; PATCH + `CACHE_NAME`-bump.
- Server en rechten zijn in orde (`rechten.js:79`); alleen echte sales-accounts (ook sales manager) zijn getroffen.
