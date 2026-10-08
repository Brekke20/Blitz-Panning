# Logins en beheerderspagina Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elke `/api/*`-aanroep (behalve de klantgerichte bevestigingslink) vereist een ingelogde gebruiker met de juiste rol (beheerder, planner, technieker, sales), en Brent beheert gebruikers, instellingen, activiteitenlog en systeemstatus op één beheerpagina.

**Architecture:** Eigen login in de app: scrypt-wachtwoorden en een HMAC-ondertekende sessiecookie, alles in kleine modules onder `netlify/lib/` met dunne functies in `netlify/functions/`. Elke bestaande functie wordt bij het exporteren omhuld door één wrapper (`beveiligd.js`) die de rol uit één rechtentabel (`rechten.js`) afdwingt; "eigen"-regels voor de technieker staan in `eigen.js`. De client krijgt `kern/sessie.js` (sessie), `kern/navigatie.js` (tabs per rol), één centrale fetch-omhulling in `kern/api.js` (header `X-Blitz`, herinloggen bij 401) en schermmodules `schermen/inloggen*.js`, `rol-schil.js`, `gebruikersmenu.js` en `beheer*.js`.

**Tech Stack:** vanilla ES-modules zonder bouwstap, `node:crypto` (scrypt, HMAC-SHA256, `timingSafeEqual`), Netlify Functions v1/v2 + Blobs (`blitz-data`, `consistency: 'strong'`), `node --test`, `@playwright/test`. Geen nieuwe npm-dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-logins-beheer-design.md` (lees volledig) en het BINDENDE `docs/superpowers/plans/2026-10-08-koppelvlakken.md` (dit plan levert die koppelvlakken met exact die namen en signaturen; afwijkingen en uitbreidingen staan in "Koppelvlak: uitbreidingen en bevindingen" hieronder).

## Global Constraints

- **Refactor-structuur (bindend, opdrachtgever)**: aan `public/index.html` en `public/js/app.js` komt niets bij behalve minimale import- of registratieregels (de `modulepreload`/`<link>`-regels, maximaal twee importregels in `app.js` (het doel is minimaal, niet het getal), één aanroep bij het starten, één regel in `setTab`). Nieuwe logica in kleine, gerichte modules: client in `public/js/kern/` (sessie, navigatie, api, instellingen-sync) en `public/js/schermen/` (`inloggen.js`, `beheer-*.js`, ...), pure logica apart in `*-logica.js` (bestaand patroon, bv. `instellingen-logica.js`); server in `netlify/lib/` (auth, gebruikers, activiteit, instellingen, ...) met dunne functies in `netlify/functions/`. Eén verantwoordelijkheid per bestand; de beheerpagina wordt per tabblad gesplitst (`beheer-gebruikers.js`, `beheer-instellingen.js`, `beheer-activiteit.js`, `beheer-systeemstatus.js`).
- **Branchbeleid** (`CLAUDE.md`): werk op tak `refactor-logins` (vanaf `refactor`) in worktree `.claude/worktrees/refactor-logins`. NIET mergen naar `refactor` of `main`, NIET pushen (de opzichter beslist). Geen versie-bump in `package.json`, `CACHE_NAME` in `public/sw.js` blijft `blitz-planning-v25`; wijzigingen komen in `CHANGELOG.md` onder "Refactor-tak — nog niet uitgebracht". Nooit `--no-verify`.
- **Testmodus bestaat ook in productie** (header `X-Blitz-Test` kiest de teststore). De testrol (`X-Blitz-Test-Rol`) en de rolwisselaar werken ENKEL als `process.env.BLITZ_LOKALE_DEV === '1'` (door `dev-server.mjs` gezet, nooit door een request) én er geen Netlify-runtime-variabele (`NETLIFY`, `AWS_LAMBDA_FUNCTION_NAME`, `LAMBDA_TASK_ROOT`) bestaat. `NETLIFY_DEV` telt NIET (`netlify dev --live` is publiek bereikbaar). In productie vereist ook `?test` een echte login.
- **Crypto**: `node:crypto` scrypt (`N=16384, r=8, p=1`, 64 bytes, eigen salt van 16 bytes, parameters in de hashstring `scrypt$16384$8$1$<salt-b64>$<hash-b64>`), vergelijken met `timingSafeEqual`; sessietoken `base64url(JSON{uid,sv,exp}) + '.' + base64url(HMAC-SHA256)` met geheim `SESSIE_GEHEIM`; wachtwoord minimaal 10 en maximaal 200 tekens. Cookie `blitz_sessie`: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 dagen; `Secure` weggelaten enkel bij lokale dev), verlengd door `auth-ik` als er minder dan 15 dagen resten. Schrijvende aanroepen (alles behalve GET/HEAD/OPTIONS) eisen header `X-Blitz: 1`.
- **Vergrendeling**: 5 mislukte pogingen per e-mail binnen 15 min → 15 min vergrendeld; herstel: 5 pogingen → 1 uur. Foutmeldingen verraden niet of een e-mailadres bestaat (ook de tijd niet: onbekend adres doet een schijn-verificatie).
- **Authenticatiegegevens staan altijd in de ECHTE store `blitz-data`**, ook bij een testverzoek (`gebruikers`, `login-pogingen`, `login-laatst`, `herstel-noodroute`, `activiteit/*` komen in `NIET_KOPIEREN` van `testmodus.js`). `instellingen` volgt de testmodus-regel (testverzoek = teststore).
- **Antwoordvorm bij weigering**: HTTP `401` (niet ingelogd), `403` (geen recht, ontbrekende `X-Blitz`, of `wachtwoord-wijzigen`), body `{ error: <tekst>, code: 'niet-ingelogd' | 'geen-recht' | 'csrf' | 'wachtwoord-wijzigen' }`.
- **Klantgericht blijft open**: `confirm-afspraak` (GET en POST) en de links in voorstelmails mogen niet breken. `planning-export` behoudt zijn eigen API-sleutel (`PLANNING_EXPORT_API_KEY`).
- **XSS**: elke vrije tekst (naam, e-mail, zohoNaam, activiteit-details) gaat via `escHtml` uit `public/js/kern/ui.js` in `innerHTML`; nooit ruwe tekst.
- **Elk nieuw `public/js/**/*.js`-bestand** staat in `SHELL` van `public/sw.js`; elke STATISCH geïmporteerde module krijgt een `<link rel="modulepreload">` in `public/index.html`, lazy (`import()`) geladen modules niet (`tests/sw-schil.test.mjs` dwingt dit af). Elk nieuw `.css` staat in `SHELL` en heeft één `<link rel="stylesheet">`. Geen `window.<naam>`-toewijzing buiten `kern/brug.js` en de klassieke `apparaat.js` (`tests/window-namen.test.mjs`).
- **Tests**: `node --test` zonder pad (volledige suite) en `npx playwright test` (project `chromium`); geen `waitForTimeout`. Lokale verificatie in de browser altijd via `http://localhost:3333/?test` (start met `node blobs-local-bootstrap.mjs`).
- **Werkwijze** (uit het project): modelkeuze staat per taak; brief en diff als bestand naar subagents; na elk afgewerkt stuk de skill `opruimen-na-werk` (achtergebleven node/chrome-processen stoppen); ledger in `.superpowers/sdd/2026-10-08-logins-beheer/progress.md` (niet in git).

## Koppelvlak: uitbreidingen en bevindingen (voor de opzichter)

Elk gebruikt de bindende namen uit het koppelvlakdocument ongewijzigd. Wat erbij komt is additief; wat verkeerd lijkt staat bij "Bevindingen".

**Uitbreidingen (additief, sales- en dashboard-plan mogen erop steunen):**
- E1 `navigatie.js` krijgt ook `registreerStart(rol, fn)` en `startVoorRol(rol)`. Rol `sales` kan niet de gewone `opstart()` van `app.js` draaien (die roept ~15 endpoints aan die voor sales `403` geven); het sales-plan registreert zijn eigen startfunctie. `registreerTabs(rol, tabs)` VOEGT toe aan wat er al geregistreerd is (volgorde van registreren). Het registratiepunt voor tabs en start per deelproject is `schermen/rol-schil.js` (één regel per deelproject).
- E2 `schermen/beheer-tabs.js` bevat één `import './beheer-xxx.js'`-regel per beheertab (zij roepen `registreerBeheerTab` bij het laden aan). Het dashboard-plan voegt `import './beheer-performance.js'` toe. `beheer.js` zelf wordt lazy geladen (`import()`), dus niet-beheerders downloaden het niet.
- E3 Server: `vereisGebruiker` geeft bij weigering ook `code` terug; wrapper-handlers krijgen de gebruiker als derde parameter (`handler(req, context, gebruiker)` / `handler(event, context, gebruiker)`). Nieuwe functies van de andere plannen worden ingehangen met `beveiligV2('<naam>', handler)` en MOETEN een rij in `netlify/lib/rechten.js` krijgen; `tests/rechten.test.mjs` faalt voor elke functie in `netlify/functions/` zonder rij.
- E4 `GET /api/instellingen?overzicht=1` (beheerder, planner, technieker; sales krijgt enkel `eigen`) geeft `{ eigen: { gebruikerId, versie, instellingen|null }, techniekers: { [zohoNaam]: { gebruikerId, instellingen } } }`. Nodig omdat de planner de instellingen (werkuren, startlocatie) van de gekozen technieker leest. Schrijven voor een ander (`PUT` met `gebruiker`): de beheerder voor iedereen; de planner enkel voor een gebruiker met rol technieker (elke zo'n wijziging staat in het activiteitenlog als `instellingen-gewijzigd`); technieker en sales enkel eigen (besluit Brent, 2026-10-08).
- E5 Client: `kern/sessie.js` exporteert ook `huidigeRechten()` (`{ beheer, plannen, alleSales }`) en `afmelden()`.
- E6 De TomTom-functies `route`, `optimize`, `matrix`, `drukte` zijn toegelaten voor alle vier de rollen (stateloze berekeningen op coördinaten; de rapportwizard van de technieker en de sales-route gebruiken ze).
- E7 Server-seam voor tests: `zetAuthVoorTests({ vasteGebruiker })` in `netlify/lib/auth.js` (weigert te draaien in een Netlify-runtime). `tests/nep-fetch.mjs` zet standaard een beheerder, zodat de ~300 bestaande karakteriseringstests ongewijzigd blijven. `tests/auth-hulp.mjs` (Taak 4) levert `metRol(rol, werk, { zohoNaam, magAlleSales })` en `metGeenSessie(werk)`; Taak 7-11 gebruiken die.

**Bevindingen in het koppelvlakdocument:**
- B1 `vereisGebruiker`: "enkel als `NETLIFY_DEV === 'true'` of de lokale dev-server" is onveilig: `netlify dev --live` zet `NETLIFY_DEV` en is publiek bereikbaar. Dit plan gebruikt uitsluitend `BLITZ_LOKALE_DEV` (door `dev-server.mjs` gezet) plus het ontbreken van Netlify-runtimevariabelen.
- B2 "de service worker voor de rapport-outbox ook" (header `X-Blitz`) klopt niet: de service worker raakt `/api` nooit aan en de outbox (`outbox.js`) draait in de pagina. Eén fetch-omhulling op `window.fetch` (brug.js) dekt alle ~33 losse `fetch('/api/...')`-aanroepen en de outbox.
- B3 `PUT /api/instellingen` met `versie`: de blob bevat de instellingen van alle gebruikers; een 409 bij elke gelijktijdige wijziging van een ander zou onzinnig zijn. De server voegt per gebruikerssleutel samen (laatste schrijver per sleutel wint, met controle na het schrijven); `versie` in de body is informatief en het antwoord geeft de nieuwe blobversie terug.
- B4 `GET /api/instellingen?gebruiker=<id>` is voor de planner onbruikbaar (zij leest de techniekerinstellingen) → uitbreiding E4.
- B5 De actienaam `rapport-opnieuw` heeft in dit plan geen aanroeper (de server kan "opnieuw versturen" niet onderscheiden); alleen `rapport-verstuurd` wordt gelogd.

## Review Focus

1. **Testrol omzeilt in productie nooit een login**: een verzoek met `X-Blitz-Test: 1` en `X-Blitz-Test-Rol: beheerder` zonder sessie geeft `401` zodra `BLITZ_LOKALE_DEV` ontbreekt, ook als `NETLIFY_DEV=true`, en ook als `BLITZ_LOKALE_DEV=1` samen met `AWS_LAMBDA_FUNCTION_NAME` of `NETLIFY` staat. (Taak 3; ook in `tests/rechten.test.mjs`.)
2. **Technieker en collega's**: elke schrijfactie op data van een collega geeft `403`, ook bij hoofdletter- of spatieverschillen ("tim " vs "Tim"), een ontbrekende of lege `technieker`/`persoon`-waarde, een technieker zonder `zohoNaam`, een rapport dat via de ticket+datum-dedup een bestaand rapport van een collega zou overschrijven, en een lijst-PUT die een collega-item wijzigt of verwijdert terwijl het eigen item correct is. (Taak 11.)
3. **Blokkeren werkt meteen en blijft staan**: een geblokkeerde gebruiker krijgt bij zijn eerstvolgende aanroep `401`, ook met een nog geldig token; een login herschrijft de blob `gebruikers` nooit (`laatsteLogin` staat in de aparte blob `login-laatst`), zodat een gelijktijdige login een blokkering niet ongedaan kan maken; de laatste actieve beheerder is niet te blokkeren of te degraderen, ook niet door zichzelf. (Taak 2, 7.)
4. **Open schakels blijven open**: `confirm-afspraak` GET en POST zonder cookie, `planning-export` met zijn sleutel (zijn interne aanroepen van tickets/klantbeschikbaarheid/afspraken lukken met de sleutel), en de loginpagina's zelf (`auth-login`, `auth-setup`, `auth-herstel`) zonder sessie. (Taak 4, 10, 12.)
5. **Verlopen sessie midden in een actie**: meerdere gelijktijdige `401`'s geven één loginscherm; een rapport in de outbox of een openstaand concept gaat niet verloren en wordt na het inloggen verstuurd; een ander account na herinloggen herlaadt de pagina; offline starten gebruikt de bewaarde gebruiker i.p.v. een loginscherm. (Taak 13, 15.)
6. **Instellingen van een ander**: een planner schrijft enkel de instellingen van een doelgebruiker met rol technieker (nooit van een planner, beheerder of sales; onbekend id geeft 404), technieker en sales schrijven nooit die van een ander, de beheerder die van iedereen; elke schrijfactie voor een ander staat in het activiteitenlog (`instellingen-gewijzigd`, zonder de waarden); een wijziging voor een ander raakt de blob-sleutel van die persoon en niet de eigen, en neemt de globale `laatsteStart` van de planner niet mee. (Taak 8, 16.)

Verder in de tests verwerkt: naam- en e-mailvelden met `<script>` tonen als tekst (Taak 17, 18), wachtwoord van 201 tekens of enkel spaties wordt geweigerd (Taak 1), een e-mailadres met hoofdletters of spaties logt in als het kleine-lettervorm (Taak 5).

---

## Bestandsoverzicht

| Bestand | Rol | Taak |
|---|---|---|
| `netlify/lib/wachtwoord.js` | hash, verificatie, beleid, generatoren (wachtwoord, herstelcodes) | 1 |
| `netlify/lib/sessie-token.js` | token ondertekenen/controleren, cookie bouwen/lezen | 1 |
| `netlify/lib/verzoek.js` | header en cookie uit een v1-event of v2-Request | 1 |
| `netlify/lib/blob-wijzig.js` | lezen-wijzigen-schrijven met controle (retry) | 2 |
| `netlify/lib/gebruikers.js` | `leesGebruikers`, `publiek`, wijzigen, laatste-beheerder-regel, `leesLaatsteLogins`/`schrijfLaatsteLogin` (blob `login-laatst`) | 2 |
| `netlify/lib/vergrendeling.js` | pure vergrendelingslogica + blob `login-pogingen` | 2 |
| `netlify/lib/activiteit.js` | `logActiviteit`, `logVoorVerzoek`, `leesActiviteit`, opruimen | 2 |
| `netlify/lib/lokale-dev.js` | `isLokaleDev`, testgebruikers | 3 |
| `netlify/lib/auth.js` | `maakAuth`, `vereisGebruiker`, `weigeringV1/V2`, `zetAuthVoorTests` | 3 |
| `netlify/lib/rechten.js` | rechtentabel `RECHTEN`, `rechtenVoor` | 4 |
| `netlify/lib/beveiligd.js` | `beveiligV1`, `beveiligV2`, `zetKernSpyVoorTests` | 4 |
| `tests/auth-hulp.mjs` | testhulp `metRol`, `metGeenSessie`, `zetStandaard` | 4 |
| `netlify/lib/eigen.js` | "eigen"-regels technieker (pure) | 11 |
| `netlify/lib/instellingen.js` | `leesInstellingen`, `bewaarInstellingen`, `overzichtVoor` | 8 |
| `netlify/lib/herstel.js` | herstelcode- en noodsleutelcontrole | 6 |
| `netlify/lib/systeemstatus.js` | status verzamelen | 9 |
| `netlify/functions/auth-login.js`, `auth-uitloggen.js`, `auth-ik.js`, `auth-wachtwoord.js` | sessiefuncties | 5 |
| `netlify/functions/auth-setup.js`, `auth-herstel.js` | eerste beheerder en herstel | 6 |
| `netlify/functions/gebruikers.js` | CRUD beheerder | 7 |
| `netlify/functions/instellingen.js` | instellingen lezen/schrijven | 8 |
| `netlify/functions/activiteit.js`, `activiteit-opruimen.js`, `systeemstatus.js` | log en status | 9 |
| alle bestaande `netlify/functions/*.js` | wrapper + eigen-regels + activiteit | 10, 11, 12 |
| `public/js/kern/api.js`, `kern/sessie.js`, `kern/brug.js` | fetch-omhulling, sessie | 13 |
| `public/js/schermen/inloggen-logica.js`, `inloggen.js`, `public/css/inloggen.css` | loginschermen en herstelscherm (in Taak 14 nog niet gekoppeld, Taak 15 koppelt ze) | 14 |
| `public/js/kern/navigatie.js`, `schermen/rol-schil.js`, `gebruikersmenu.js`, `apparaat.js` | rol, tabs, menu | 15 |
| `public/js/kern/instellingen-sync.js`, `schermen/instellingen.js` | overgang naar server | 16 |
| `public/js/schermen/beheer.js`, `beheer-tabs.js`, `beheer-gebruikers(-logica).js`, `public/css/beheer.css` | beheer + tab Gebruikers | 17 |
| `schermen/beheer-instellingen.js`, `beheer-activiteit(-logica).js`, `beheer-systeemstatus.js` | overige tabs | 18 |
| `schermen/rolwisselaar.js`, `ticketdetail.js`, `e2e/*` | testmodus, collega's alleen-lezen, rolspecs | 19 |
| `CHANGELOG.md`, `docs/*` | afronding | 20 |

## Rechtentabel (de beslissing per functie; Taak 4 giet de rijen van de 28 bestaande functies in `rechten.js`; de rijen van de nieuwe functies `auth-*`, `gebruikers`, `instellingen`, `activiteit`, `activiteit-opruimen` en `systeemstatus` komen in hun eigen taak, 5-9)

Rollen: B = beheerder, P = planner, T = technieker, S = sales. "T eigen" = technieker enkel voor eigen data (Taak 11); de rechten van collega's zijn alleen-lezen.

| Functie (methode) | Rol | Opmerking op basis van wat de rol vandaag doet |
|---|---|---|
| `tickets` (GET) | B P T | tickets zien; ook service-sleutel van `planning-export` |
| `planning-sinds` (POST) | B P T | wachttijd in ticketdetail |
| `plan`, `plan-datum`, `propose`, `annuleer` (POST; `annuleer` ook GET) | B P | inplannen, voorstel, annuleren zijn coördinatorwerk (`coord-only`) |
| `optimize`, `matrix`, `route`, `drukte` (POST) | B P T S | TomTom-berekeningen; wizard van T en sales-route gebruiken ze |
| `afspraken` (GET / PUT) | B P T / B P, T eigen | lijst-PUT; T enkel items met eigen `persoon` |
| `availability` (GET / PUT) | B P T / B P, T eigen | verlof; T enkel `scope:'person'` met eigen naam |
| `klantbeschikbaarheid` (GET / PUT) | B P T / B P | klantvoorkeuren |
| `voorstel-status` (GET / POST, DELETE) | B P T / B P | vinkjes in de UI |
| `prijzen` (GET / PUT) | B P T / B P | wizard van T leest prijzen |
| `inventaris` (GET / POST / PATCH) | B P T / B P, T eigen / B P | T bijvullen en verbruik van eigen wagen; PATCH = supervisor-boeking |
| `rapport-archief` (GET / POST / DELETE) | B P T, T eigen | T ziet en schrijft enkel rapporten met eigen `technieker` |
| `rapport-verzonden` (POST) | B P T, T eigen | zet verzonden-vinkje op eigen rapport |
| `rapport`, `send-rapport`, `comment`, `fotos` (GET/PUT), `mail-check` | B P T | enkel `ticketId` in de body: per ticket niet server-afdwingbaar zonder Zoho-opzoeking (zie open punt 3) |
| `client-log` (GET / POST) | B / B P T S | diagnostiek; lezen enkel beheerder |
| `testdata` (POST), `setup` (GET) | B | testkopie opnieuw maken; Zoho-eenmalig |
| `auth-ik`, `auth-wachtwoord` | B P T S | alle ingelogde rollen; rij-veld `ookBijWijzigen: true` (anders login-lus bij een verplichte wachtwoordwijziging) |
| `auth-login`, `auth-uitloggen`, `auth-setup`, `auth-herstel` | open | eigen controles (uitloggen wist enkel de cookie) |
| `gebruikers` (GET / POST, PATCH) | B (GET `?rol=sales` ook S met `magAlleSales`) / B | |
| `instellingen` (GET, PUT) | B P T S | functie beperkt: eigen; B alles (lezen en schrijven); P en T lezen `?overzicht=1`; P schrijft (PUT met `gebruiker`) de instellingen van een technieker, gelogd; S `?gebruiker=` met `magAlleSales`; de rij blijft `B P T S` voor PUT, het onderscheid zit in de functie |
| `activiteit`, `systeemstatus` (GET) | B | |
| `activiteit-opruimen` | open | geplande functie, idempotent en onschadelijk |
| `confirm-afspraak`, `planning-export` | open | klantlink (ondertekend) en machine-sleutel |

---

### Task 0: Worktree, omgeving en basislijn

**Uitgevoerd door de controller** (setup is controllerwerk; ledger: worktree, `npm ci`, `.env.local` en de basislijn van 906 groene `node --test`-tests zijn klaar; de Playwright-basislijn, chromium en sw, noteert de controller vóór Taak 1). Een subagent voert deze taak niet uit; de stappen blijven als naslag. Geen productiecode.

**Files:** geen productiebestanden; `.superpowers/sdd/2026-10-08-logins-beheer/progress.md` (ledger, niet in git).

- [ ] **Step 1: Worktree.** Vanuit de repo-root (of een andere worktree): `git worktree add .claude/worktrees/refactor-logins -b refactor-logins refactor`. Controle: `git -C <worktree> branch --show-current` geeft `refactor-logins` en `git log -1 --format=%h` is de kop van `refactor`. Alle volgende stappen gebruiken `cd "<worktree>" && ...` (zie `feedback_subagent_worktree_cwd`: nooit in de main-checkout committen).
- [ ] **Step 2: Afhankelijkheden en `.env.local`.** `npm ci` in de worktree. Kopieer `.env.local` uit de hoofdcheckout naar de worktree (bestaat daar niet; `dev-server.mjs` stopt zonder). Voeg NIET toe: `BLITZ_LOKALE_DEV` (die zet de dev-server zelf).
- [ ] **Step 3: Basislijn.** `node --test` en `npx playwright test`; noteer de aantallen (groen) in het ledger. Verwacht: alles groen; dit is de basislijn voor elke latere taak.
- [ ] **Step 4:** Maak de ledger-map en schrijf de basislijn erin. Geen commit.

---

### Task 1: Crypto-bouwstenen (wachtwoord, sessietoken, verzoekhulp)

**Model: sonnet.** Zuivere modules; elke fout hier is een beveiligingslek, dus fijnmazige tests.

**Files:**
- Create: `netlify/lib/wachtwoord.js`, `netlify/lib/sessie-token.js`, `netlify/lib/verzoek.js`
- Test: `tests/wachtwoord.test.mjs`, `tests/sessie-token.test.mjs`, `tests/verzoek.test.mjs`

**Interfaces:**
- Produces:
```js
// wachtwoord.js
export const MIN_LENGTE = 10, MAX_LENGTE = 200;
export function beleidsFout(wachtwoord): string | null      // null = geldig; tekst NL anders
export async function hashWachtwoord(wachtwoord): Promise<string>        // 'scrypt$16384$8$1$<salt>$<hash>'
export async function verifieerWachtwoord(wachtwoord, hash): Promise<boolean>  // nooit gooien; kapotte hash = false
export const SCHIJN_HASH: string                             // geldige hash van een willekeurig wachtwoord, voor tijdloze weigering
export function genereerWachtwoord(): string                 // 12 tekens, alfabet zonder 0/O/1/l/I
export function genereerHerstelcodes(aantal = 10): string[]  // 'XXXX-XXXX', alfabet A-Z zonder I,L,O + 2-9
export function normaliseerHerstelcode(invoer): string       // hoofdletters, streepje en spaties tolerant
// sessie-token.js
export const SESSIE_LEVENSDUUR_S = 2592000, VERLENG_ONDER_S = 1296000, COOKIE_NAAM = 'blitz_sessie';
export function ondertekenToken({ uid, sv, exp }, geheim): string
export function controleerToken(token, geheim, nuS): { uid, sv, exp } | null  // fout handtekening, vervallen, rommel = null
export function maakSessieCookie(token, { secure = true } = {}): string      // 'blitz_sessie=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000'
export function wisSessieCookie({ secure = true } = {}): string              // Max-Age=0
// verzoek.js (v1-event en v2-Request)
export function kop(reqOfEvent, naam): string | undefined    // hoofdletterongevoelig
export function leesCookie(reqOfEvent, naam): string | undefined
```

- [ ] **Step 1: Tests schrijven (RED).** `wachtwoord.test.mjs`: `hash → verifieer` met het juiste wachtwoord is `true`, met een fout wachtwoord `false`; twee hashes van hetzelfde wachtwoord verschillen (eigen salt); de hashstring begint met `scrypt$16384$8$1$`; `verifieerWachtwoord('x', 'rommel')` en `verifieerWachtwoord('x', undefined)` zijn `false` zonder te gooien; `beleidsFout('kort')` is een tekst, `beleidsFout('a'.repeat(10))` is `null`, `beleidsFout('a'.repeat(201))` is een tekst, `beleidsFout('          ')` (10 spaties) is een tekst; `genereerWachtwoord()` heeft 12 tekens zonder tekens uit `0O1lI` en voldoet aan het beleid; `genereerHerstelcodes()` geeft 10 unieke codes die matchen met `/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/`; `normaliseerHerstelcode(' 7k4m 2qxp ')` is `'7K4M-2QXP'`. `sessie-token.test.mjs`: roundtrip geeft `{uid,sv,exp}`; een token met één gewijzigd teken (payload of handtekening) is `null`; ander geheim is `null`; `exp <= nu` is `null`; token zonder punt, lege string en `undefined` zijn `null`; de cookiestring bevat `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000`; met `{ secure: false }` ontbreekt `Secure`; `wisSessieCookie()` bevat `Max-Age=0`. `verzoek.test.mjs`: `kop` werkt voor een `Request` en voor een v1-event met sleutel `X-Blitz-Test`/`x-blitz-test`; `leesCookie` haalt `blitz_sessie` uit `a=1; blitz_sessie=abc.def; b=2` en geeft `undefined` zonder cookiekop.
- [ ] **Step 2: Draai** `node --test tests/wachtwoord.test.mjs tests/sessie-token.test.mjs tests/verzoek.test.mjs`. Verwacht: FAIL (modules ontbreken).
- [ ] **Step 3: Implementeer** de drie modules volgens de interface. Gebruik `promisify(crypto.scrypt)` met `maxmem: 64 * 1024 * 1024`; vergelijk met `timingSafeEqual` na een lengtecontrole; `SCHIJN_HASH` wordt bij het laden van de module met vaste salt afgeleid (synchroon `scryptSync`) zodat er geen top-level await is; `genereer*` gebruikt `crypto.randomInt`.
- [ ] **Step 4: Draai de drie testbestanden.** Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(auth): wachtwoord, sessietoken en verzoekhulp (logins T1)`.

---

### Task 2: Gebruikersopslag, vergrendeling en activiteitenlog (server-lib)

**Model: sonnet.**

**Files:**
- Create: `netlify/lib/blob-wijzig.js`, `netlify/lib/gebruikers.js`, `netlify/lib/vergrendeling.js`, `netlify/lib/activiteit.js`, `tests/nep-blobs.mjs` (testhulp, geen `*.test.mjs`)
- Modify: `netlify/lib/testmodus.js:10` (`NIET_KOPIEREN`)
- Test: `tests/gebruikers-lib.test.mjs`, `tests/vergrendeling.test.mjs`, `tests/activiteit.test.mjs`, `tests/testmodus-auth.test.mjs`

**Interfaces:**
- Consumes: Task 1 (`wachtwoord.js`, `normaliseer…`).
- Produces:
```js
// tests/nep-blobs.mjs
export function maakNepStore(begin = {}): { get(key, { type }), set(key, waarde), setJSON(key, obj), delete(key), list({ prefix }), _data }  // in het geheugen
// blob-wijzig.js — leest, past `wijzig(huidig) -> nieuw|null` toe (null = niets doen), schrijft, leest terug en herhaalt tot 3x als een gelijktijdige schrijver erover schreef
export async function wijzigBlob(store, key, { leeg, wijzig, controleer = (gelezen) => true, pogingen = 3 }): Promise<{ ok, waarde }>
// gebruikers.js
export const ROLLEN_LIJST: ['beheerder','planner','technieker','sales']
export async function leesGebruikers(store): Promise<Gebruiker[]>           // [] bij ontbreken
export function publiek(gebruiker): PubliekeGebruiker                        // { id, email, naam, rol, zohoNaam?, salesNaam?, magAlleSales? } — nooit hashes
export function beheerWeergave(gebruiker, laatsteLogin = null)               // publiek + { actief, laatsteLogin (uit de blob `login-laatst`, niet uit `gebruikers`), aangemaakt, moetWachtwoordWijzigen }
export function normaliseerEmail(e): string                                  // trim + kleine letters
export function normaliseerNaam(n): string                                   // trim + kleine letters + inklappen van spaties (voor "eigen"-vergelijking)
export function valideerNieuweGebruiker(invoer): { fout } | { waarden }
export function kanWijzigen(gebruikers, id, wijziging): { ok: true } | { ok: false, fout }  // laatste actieve beheerder: niet blokkeren, niet degraderen
export async function wijzigGebruikers(store, wijzig): Promise<{ ok, gebruikers }>        // via wijzigBlob; blob `gebruikers` = { versie, gebruikers }
export function nieuwId(): string                                            // 'u-' + 12 hex
export async function leesLaatsteLogins(store): Promise<{ [gebruikerId]: ISO }>      // blob `login-laatst`; {} bij ontbreken. `laatsteLogin` staat NIET in de blob `gebruikers`
export async function schrijfLaatsteLogin(store, gebruikerId, iso): Promise<void>   // via wijzigBlob op `login-laatst`; raakt `gebruikers` NOOIT (anders kan een login een gelijktijdige blokkering ongedaan maken, Review Focus 3)
// vergrendeling.js (pure) + blob-wrappers
export function isVergrendeld(staat, soort, sleutel, nuMs): { vergrendeld: boolean, tot?: number }
export function registreerMislukt(staat, soort, sleutel, nuMs): { staat, vergrendeldNu: boolean }  // soort 'login' (5/15min, 15min) of 'herstel' (5/15min?, 1u) — zie Global Constraints
export function wisPogingen(staat, soort, sleutel): staat
export async function leesPogingen(store) / schrijfPogingen(store, staat)    // blob `login-pogingen`, via wijzigBlob
// activiteit.js
export async function logActiviteit(store, { gebruiker, actie, onderwerp = null, details = null }, { nu = () => Date.now() } = {})  // best-effort, gooit nooit
export async function logVoorVerzoek(reqOfEvent, gebruiker, { actie, onderwerp, details }, { getStore })  // slaat testverzoeken over; echte store; gooit nooit
export async function leesActiviteit(store, { van, tot, gebruikerId, actie }): Promise<Activiteit[]>  // nieuwste eerst, max 1000
export async function ruimActiviteitOp(store, { nu, maanden = 12 }): Promise<string[]>   // verwijderde sleutels
```
`Activiteit = { op: ISO, gebruikerId, naam, actie, onderwerp, details }` (details afgekapt op 500 tekens). Blob `activiteit/<YYYY-MM>` = `{ versie, items }`.

- [ ] **Step 1: Tests (RED).**
  - `gebruikers-lib`: `valideerNieuweGebruiker` weigert een ongeldig e-mailadres, een onbekende rol, `naam` leeg, technieker zonder `zohoNaam`, sales zonder `salesNaam`; normaliseert het adres naar kleine letters; `publiek()` bevat nooit `wachtwoordHash`, `herstelcodes` of `sessieVersie`; `normaliseerNaam(' Tim  Janssens ')` is `'tim janssens'`; `kanWijzigen` weigert `actief:false` én `rol:'planner'` voor de enige actieve beheerder en laat het toe als er een tweede actieve beheerder is; `wijzigGebruikers` met twee `Promise.all`-gelijktijdige wijzigingen op een nep-store die de eerste schrijf met een gelijktijdige schrijf overschrijft eindigt met BEIDE wijzigingen (de controle-na-schrijven herhaalt); `schrijfLaatsteLogin` schrijft enkel de blob `login-laatst` (spy: geen schrijfactie op `gebruikers`), twee gelijktijdige schrijfacties voor verschillende gebruikers bewaren beide, `leesLaatsteLogins` geeft `{}` zonder blob; `beheerWeergave(g, iso)` bevat `laatsteLogin: iso`.
  - `vergrendeling`: na 4 mislukte pogingen is `isVergrendeld` `false`, na de 5e `true` tot `nu + 15 min`; pogingen ouder dan 15 min tellen niet mee; na `wisPogingen` weer vrij; soort `'herstel'` vergrendelt 1 uur; een niet-bestaand e-mailadres vergrendelt precies zo (geen verschil in gedrag); de staat bevat geen oude vermeldingen (opgeschoond bij elke registratie).
  - `activiteit`: `logActiviteit` schrijft in `activiteit/2026-10` bij een geklokte `nu`, voegt toe aan een bestaande blob, snijdt `details` af op 500 tekens, gooit niet bij een store die faalt; `logVoorVerzoek` schrijft niets als het verzoek de header `X-Blitz-Test: 1` heeft en gooit niet als `getStore` zelf gooit; `leesActiviteit` filtert op gebruiker, actie en periode over twee maand-blobs; `ruimActiviteitOp` met `nu = 2026-10-08` verwijdert `activiteit/2025-09` en bewaart `activiteit/2025-10`.
  - `testmodus-auth`: `zorgVoorTestkopie` kopieert `gebruikers`, `login-pogingen`, `login-laatst`, `herstel-noodroute` en `activiteit/2026-10` NIET naar de testopslag (vul de nep-echte store met die sleutels en `afspraken`; verwacht: alleen `afspraken` gekopieerd).
- [ ] **Step 2: Draai** de vier testbestanden. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de modules; `testmodus.js`: voeg `/^gebruikers$/, /^login-pogingen$/, /^login-laatst$/, /^herstel-noodroute$/, /^activiteit\//` toe aan `NIET_KOPIEREN`. `wijzigBlob` leest, voert `wijzig` uit, schrijft met `versie + 1`, leest terug en vergelijkt via `controleer`; bij mislukking opnieuw uit de verse lezing (max 3).
- [ ] **Step 4: Draai** de vier testbestanden en `node --test tests/testmodus*.test.mjs tests/testdata.test.mjs`. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(auth): gebruikersopslag, vergrendeling en activiteitenlog (logins T2)`.

---

### Task 3: `auth.js` — sessiecontrole, lokale dev, testgebruikers

**Model: sonnet** (daarna gerichte review door opus: dit is het beveiligingshart).

**Files:**
- Create: `netlify/lib/lokale-dev.js`, `netlify/lib/auth.js`
- Test: `tests/lokale-dev.test.mjs`, `tests/auth.test.mjs`

**Interfaces:**
- Consumes: Task 1 en 2.
- Produces (koppelvlak, exact):
```js
// lokale-dev.js
export function isLokaleDev(env = process.env): boolean     // env.BLITZ_LOKALE_DEV === '1' && geen van NETLIFY, AWS_LAMBDA_FUNCTION_NAME, LAMBDA_TASK_ROOT gezet. NETLIFY_DEV telt niet.
export const TESTGEBRUIKERS: { 'test-beheerder', 'test-planner', 'test-technieker' (zohoNaam 'Tim'), 'test-sales' (salesNaam 'Test Verkoper', magAlleSales false) }  // PubliekeGebruiker-vormen, ids gelijk aan de sleutel
// auth.js
export const ROLLEN = ['beheerder', 'planner', 'technieker', 'sales'];
export function maakAuth({ getStore, env = process.env, nu = () => Date.now(), vasteGebruiker = null } = {}): { vereisGebruiker }
export async function vereisGebruiker(reqOfEvent, { rollen = [], schrijven = false, ookBijWijzigen = false, service = false } = {})
  // -> { ok: true, gebruiker: PubliekeGebruiker } | { ok: false, status: 401 | 403, fout: string, code: string }
export function weigeringV1(resultaat, cors)   // -> { statusCode, headers, body } met body { error, code }
export function weigeringV2(resultaat, cors)   // -> Response
export function zetAuthVoorTests(opties | null)  // vervangt de standaardinstantie; gooit in een Netlify-runtime
```
Volgorde in `vereisGebruiker` (de eerste die van toepassing is wint):
1. `isTestVerzoek(req) && isLokaleDev(env)` en header `X-Blitz-Test-Rol` is een van de vier rollen → `TESTGEBRUIKERS['test-<rol>']`.
2. `service: true` en header `Authorization: Bearer <PLANNING_EXPORT_API_KEY>` (niet leeg, `timingSafeEqual`) en methode GET → pseudo-gebruiker `{ id: 'service-planning-export', rol: 'planner', naam: 'planning-export', email: '' }`.
3. Cookie `blitz_sessie` → `controleerToken` → `gebruikers` uit de ECHTE store `blitz-data` (nooit de teststore) → bestaat, `actief`, `sv === sessieVersie`; anders `401` `niet-ingelogd`.
4. `moetWachtwoordWijzigen` en niet `ookBijWijzigen` → `403` `wachtwoord-wijzigen`.
5. Rol niet in `rollen` (en `rollen` niet leeg) → `403` `geen-recht`.
6. `schrijven` en header `X-Blitz` niet `'1'` → `403` `csrf`. (Voor de testrol en de service-sleutel gelden 5 en 6 ook; de service-sleutel kent geen schrijven.)
Ontbreekt `SESSIE_GEHEIM` → `401` (fail-closed, nooit een uitzondering). `vasteGebruiker` slaat 1–4 en 6 over maar houdt 5.

- [ ] **Step 1: Tests (RED).**
  - `lokale-dev`: `isLokaleDev({})` `false`; `{BLITZ_LOKALE_DEV:'1'}` `true`; `{BLITZ_LOKALE_DEV:'1', NETLIFY:'true'}`, `{…, AWS_LAMBDA_FUNCTION_NAME:'x'}`, `{…, LAMBDA_TASK_ROOT:'/var'}` `false`; `{NETLIFY_DEV:'true'}` `false`; `{BLITZ_LOKALE_DEV:'true'}` `false`.
  - `auth` (nep-store met een beheerder, een planner, een geblokkeerde gebruiker; vaste klok): geldige cookie → ok; geen cookie → 401 `niet-ingelogd`; vervallen token → 401; verkeerde handtekening → 401; `sessieVersie` verhoogd na het uitgeven → 401 (blokkeren werkt meteen); gebruiker `actief:false` met geldig token → 401; gebruiker verwijderd → 401; `rollen: ['beheerder']` met een planner → 403 `geen-recht`; `schrijven: true` zonder `X-Blitz` → 403 `csrf`, met `X-Blitz: 1` ok; `moetWachtwoordWijzigen: true` → 403 `wachtwoord-wijzigen`, met `ookBijWijzigen: true` ok; `SESSIE_GEHEIM` leeg → 401.
  - **Testrol (Review Focus 1)**: met `X-Blitz-Test: 1` + `X-Blitz-Test-Rol: beheerder` en `env = {}` → 401; met `env = {NETLIFY_DEV:'true'}` → 401; met `env = {BLITZ_LOKALE_DEV:'1', AWS_LAMBDA_FUNCTION_NAME:'f'}` → 401; met `env = {BLITZ_LOKALE_DEV:'1'}` → ok met `id: 'test-beheerder'`; testrol zonder `X-Blitz-Test` header → 401; onbekende rol `root` → 401; `X-Blitz-Test-Rol` zonder `X-Blitz-Test` maar mét geldige cookie → de cookie telt (geen verrassing).
  - Service-sleutel: `Bearer geheim` met `PLANNING_EXPORT_API_KEY='geheim'` en `service: true` op GET → ok als planner; op POST → 401; sleutel leeg in de omgeving en header `Bearer ` → 401; zonder `service: true` → 401.
  - Echte store: bij een testverzoek (`X-Blitz-Test: 1`, geen testrol) leest `vereisGebruiker` de gebruikers uit `blitz-data` (spy op `getStore`-naam), niet uit `blitz-data-test`.
  - `zetAuthVoorTests` gooit als `process.env.NETLIFY === 'true'`; `weigeringV1` en `weigeringV2` geven status, CORS-headers en body `{ error, code }`.
  - Statische controle: geen enkel bestand onder `netlify/` of `public/` bevat `zetAuthVoorTests` behalve `netlify/lib/auth.js` (leest de bestanden).
- [ ] **Step 2: Draai** `node --test tests/lokale-dev.test.mjs tests/auth.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** `lokale-dev.js` en `auth.js`. `maakAuth` leest `SESSIE_GEHEIM`, `PLANNING_EXPORT_API_KEY` uit `env` bij elke aanroep (zoals `maakZoho`); de standaardinstantie gebruikt `getStore` uit `@netlify/blobs` en wordt lui gemaakt (zodat tests zonder Blobs-omgeving kunnen laden). De ECHTE store is `getStore({ name: 'blitz-data', consistency: 'strong' })`.
- [ ] **Step 4: Draai** de twee testbestanden. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(auth): vereisGebruiker, lokale dev en testgebruikers (logins T3)`.

---

### Task 4: Rechtentabel en wrapper

**Model: sonnet.**

**Files:**
- Create: `netlify/lib/rechten.js`, `netlify/lib/beveiligd.js`, `tests/auth-hulp.mjs` (testhulp, geen `*.test.mjs`)
- Test: `tests/rechten.test.mjs`, `tests/auth-hulp.test.mjs`

**Interfaces:**
- Consumes: Task 3.
- Produces:
```js
// rechten.js
export const RECHTEN: { [functienaam]: { [methode | '*']: string[] | 'open', service?: true, ookBijWijzigen?: true } }   // exact de tabel hierboven, enkel de 28 bestaande functies; elke latere taak die een functie toevoegt voegt zelf zijn rij toe. `ookBijWijzigen: true` is een veld van het rij-schema en wordt door de wrapper doorgegeven aan `vereisGebruiker`
export function rolIsToegelaten(naam, methode, rol): boolean | 'open'
export function rechtenVoor(gebruiker): { beheer: boolean, plannen: boolean, alleSales: boolean }   // beheer = rol beheerder; plannen = beheerder|planner; alleSales = beheerder || magAlleSales
// beveiligd.js — omhult een handler; OPTIONS en 'open'-regels gaan ongewijzigd door; methode zonder regel gaat ongewijzigd door (de handler antwoordt zelf 405)
export function beveiligV1(naam, handler, { auth } = {}): (event, context) => Promise<{ statusCode, headers, body }>   // roept handler(event, context, gebruiker)
export function beveiligV2(naam, handler, { auth } = {}): (req, context) => Promise<Response>                          // roept handler(req, context, gebruiker)
export function zetKernSpyVoorTests(spy | null): void   // gooit in een Netlify-runtime (zoals zetAuthVoorTests). Als gezet roept de wrapper, op de plek waar ze de kern zou aanroepen, `spy({ naam, methode, gebruiker })` aan IN PLAATS VAN de kern en geeft het resultaat van de spy terug (dus nooit Blobs of Zoho); bij een weigering gebeurt geen van beide; `null` zet het uit. Enkel voor de wrappertest van Taak 10
// tests/auth-hulp.mjs (testhulp, vanaf nu door alle servertests gebruikt)
export async function metRol(rol, werk, { zohoNaam, magAlleSales } = {}): Promise<any>   // zet via zetAuthVoorTests tijdelijk een vaste gebruiker met die rol (technieker: standaard zohoNaam 'Tim'; sales: salesNaam 'Test Verkoper'), roept `await werk()` en herstelt in een `finally` de vorige instelling
export async function metGeenSessie(werk): Promise<any>            // vasteGebruiker null: echte cookiecontrole, zonder cookie dus 401 `niet-ingelogd`
export function zetStandaard(opties | null): void                   // legt vast wat `metRol`/`metGeenSessie` na afloop herstellen (Taak 10: nep-fetch.mjs zet hier de standaardbeheerder)
```
Schrijvend = methode niet in `GET|HEAD|OPTIONS`; `service: true` geeft `{ service: true }` en `ookBijWijzigen: true` geeft `{ ookBijWijzigen: true }` door aan `vereisGebruiker` (zonder dat laatste krijgt een gebruiker met `moetWachtwoordWijzigen` een 403 op `auth-ik` en `auth-wachtwoord` en kan hij zijn wachtwoord nooit wijzigen). Een weigering gebruikt de CORS van de handler niet; gebruik `{ 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }`.

- [ ] **Step 1: Tests (RED), `tests/rechten.test.mjs`.**
  - **Dekking**: elke `*.js` onder `netlify/functions/` heeft een rij in `RECHTEN` (de 28 bestaande functies; faalt voor een vergeten rij). Geen `test.todo`: de rijen van functies die in latere taken ontstaan (`auth-*`, `gebruikers`, `instellingen`, `activiteit`, `activiteit-opruimen`, `systeemstatus`) worden in hun eigen taak toegevoegd, en Taak 10 voegt de omgekeerde richting toe (elke rij is een bestand).
  - Matrix (`rolIsToegelaten`) voor de tabel: `tickets` GET B/P/T ja, S nee; `plan` POST B/P ja, T/S nee; `propose`, `annuleer`, `plan-datum` idem; `optimize`/`matrix`/`route`/`drukte` alle vier ja; `inventaris` PATCH P ja, T nee; `prijzen` PUT T nee, GET T ja; `client-log` GET enkel B, POST alle vier; `testdata`, `setup` enkel B; `confirm-afspraak` en `planning-export` `'open'`.
  - Wrapper: `beveiligV2('plan-datum', h, { auth: stub })` roept `h` niet bij een weigering en geeft `401`/`403` met `{error, code}`; bij succes krijgt `h` de gebruiker als derde argument; `OPTIONS` roept `h` zonder auth; methode zonder regel (`PUT` op `plan-datum`) roept `h` (die 405 geeft); schrijvende methode geeft `schrijven: true` door; `service: true` wordt doorgegeven voor `tickets` GET; `ookBijWijzigen: true` wordt doorgegeven voor een rij met dat veld (een testrij die de test tijdelijk in `RECHTEN` zet en daarna verwijdert); met `zetKernSpyVoorTests(spy)` wordt na een geslaagde autorisatie de spy aangeroepen en de kern niet, en bij een weigering geen van beide.
  - `rechtenVoor`: planner → `{ beheer:false, plannen:true, alleSales:false }`, sales met `magAlleSales` → `alleSales:true`.
  - `tests/auth-hulp.test.mjs`: `metRol('planner', …)` laat `vereisGebruiker` een planner zien en herstelt daarna de vorige instelling (ook als `werk` gooit); `metRol('technieker', …)` heeft standaard `zohoNaam: 'Tim'`, met `{ zohoNaam: 'Roel' }` Roel; `metRol('sales', …, { magAlleSales: true })` zet de vlag; `metGeenSessie` geeft 401 `niet-ingelogd`.
- [ ] **Step 2: Draai** `node --test tests/rechten.test.mjs tests/auth-hulp.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** `rechten.js` (de tabel als constante, `ALLE/INTERN/COORD/BEHEER`-hulpsets; enkel de rijen van de 28 bestaande functies), `beveiligd.js` (met `ookBijWijzigen`-doorgave en `zetKernSpyVoorTests`) en `tests/auth-hulp.mjs`.
- [ ] **Step 4: Draai** `node --test tests/rechten.test.mjs tests/auth-hulp.test.mjs`. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(auth): rechtentabel en beveiligd-wrapper (logins T4)`.

---

### Task 5: Sessiefuncties — `auth-login`, `auth-uitloggen`, `auth-ik`, `auth-wachtwoord`

**Model: sonnet.**

**Files:**
- Create: `netlify/functions/auth-login.js`, `auth-uitloggen.js`, `auth-ik.js`, `auth-wachtwoord.js`
- Modify: `netlify/lib/rechten.js` (rijen voor de vier functies)
- Test: `tests/server-auth-sessie.test.mjs`

**Interfaces:**
- Consumes: Task 1–4. Elke functie exporteert `maakHandler({ getStore, env = process.env, nu = () => Date.now() })` (zoals `annuleer.js`) en `export default beveiligV2('<naam>', maakHandler({ getStore }))` of, voor de open functies, `export default maakHandler({ getStore })`; `export const config = { path: '/api/<naam>' }`. De auth-functies gebruiken ALTIJD `getStore({ name: 'blitz-data', consistency: 'strong' })`, ook bij `X-Blitz-Test`.
- Produces:
  - `POST /api/auth-login` `{ email, wachtwoord }` → `200 { gebruiker: PubliekeGebruiker, moetWachtwoordWijzigen }` + `Set-Cookie`; `401 { error: 'Onjuist e-mailadres of wachtwoord' }` (identiek voor onbekend, fout wachtwoord en geblokkeerde gebruiker); `429 { error, opnieuwOp: ISO }` bij vergrendeling (ook bij een juist wachtwoord tijdens de vergrendeling); schrijft `laatsteLogin` met `schrijfLaatsteLogin` in de blob `login-laatst` (de login herschrijft `gebruikers` NIET), wist de pogingen bij succes; logt `login`, en `login-mislukt-reeks` op het moment van vergrendelen.
  - `POST /api/auth-uitloggen` → `200 { ok: true }` + cookie gewist; logt `uitloggen` als er een geldige sessie was; werkt ook zonder sessie.
  - `GET /api/auth-ik` → `200 { gebruiker, rechten, moetWachtwoordWijzigen, lokaleDev }` (verlengt de cookie als `exp - nu < VERLENG_ONDER_S`); `401 { error, code:'niet-ingelogd', setupNodig: boolean }` waar `setupNodig = (er zijn nog 0 gebruikers) && BEHEER_SETUP_CODE is gezet`. `lokaleDev: isLokaleDev(env)`. Rij in `RECHTEN`: `ookBijWijzigen: true` (de wrapper geeft het door, zie Taak 4).
  - `POST /api/auth-wachtwoord` `{ huidig, nieuw }` → `200 { ok: true }` + verse cookie (nieuwe `sessieVersie`); `400` bij fout huidig wachtwoord (NIET 401, om geen herinlog-lus te veroorzaken), beleidsfout, of `nieuw === huidig`; wist `moetWachtwoordWijzigen`; logt `wachtwoord-gewijzigd`. Rij in `RECHTEN`: `ookBijWijzigen: true` (de wrapper geeft het door, zie Taak 4).

- [ ] **Step 1: Tests (RED).** Nep-store met een planner (bekende hash) en een beheerder; vaste klok.
  - Login: juist → 200 + cookie die `controleerToken` aanvaardt met de juiste `uid`/`sv`; e-mail `'  Jan@Blitz.TEST '` logt in als `jan@blitz.test`; fout wachtwoord en onbekend adres geven byte-identieke 401-body; geblokkeerde gebruiker met juist wachtwoord → dezelfde 401-body; na 5 fouten → de 6e (zelfs juist) 429 met `opnieuwOp` = nu + 15 min; na verstrijken weer mogelijk; `login-laatst[<id>]` is gezet en de blob `gebruikers` is na de login ongewijzigd (geen schrijfactie op `gebruikers`); `activiteit/2026-10` bevat `login` en `login-mislukt-reeks`; de login met header `X-Blitz-Test: 1` gebruikt toch de echte store (spy op de storenaam); body zonder JSON → 400; `GET` → 405.
  - Uitloggen: antwoord bevat `Max-Age=0`; zonder sessie ook 200.
  - `auth-ik`: met cookie → gebruiker zonder hashes (`JSON.stringify` bevat niet `Hash`, `herstelcodes`, `sessieVersie`); cookie die over 10 dagen verloopt → antwoord bevat `Set-Cookie` met nieuw token; verloopt over 20 dagen → geen `Set-Cookie`; zonder cookie en met 0 gebruikers en `BEHEER_SETUP_CODE` → 401 met `setupNodig: true`; met gebruikers → `setupNodig: false`; `moetWachtwoordWijzigen` gebruiker krijgt 200 (niet 403), via de echte wrapper en rij.
  - `auth-wachtwoord`: juist huidig + geldig nieuw → 200, nieuw token wijkt af (sv+1), oud token nu 401 bij `vereisGebruiker`; fout huidig → 400 en `login-pogingen` telt dit als mislukte poging voor die gebruiker; `nieuw` van 9 tekens → 400; `nieuw === huidig` → 400; een gebruiker met `moetWachtwoordWijzigen: true` kan via de wrapper zijn wachtwoord wijzigen (geen 403) en daarna normaal verder.
- [ ] **Step 2: Draai** `node --test tests/server-auth-sessie.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de vier functies met de rijen in `rechten.js` (`auth-login`/`auth-uitloggen` `'open'`, `auth-ik`/`auth-wachtwoord` `ALLE` met het rij-veld `ookBijWijzigen: true`). Voor de schijn-verificatie bij een onbekend adres: `verifieerWachtwoord(w, SCHIJN_HASH)`.
- [ ] **Step 4: Draai** de test. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(auth): login, uitloggen, auth-ik en wachtwoord wijzigen (logins T5)`.

---

### Task 6: Eerste beheerder en herstel (`auth-setup`, `auth-herstel`)

**Model: sonnet** (daarna opus-review samen met Taak 3).

**Files:**
- Create: `netlify/lib/herstel.js`, `netlify/functions/auth-setup.js`, `netlify/functions/auth-herstel.js`
- Modify: `netlify/lib/rechten.js`
- Test: `tests/server-auth-herstel.test.mjs`

**Interfaces:**
- Consumes: Task 1, 2, 5.
- Produces:
```js
// herstel.js
export async function maakHerstelcodes(): Promise<{ codes: string[], hashes: string[] }>
export async function gebruikHerstelcode(beheerder, invoer): Promise<{ ok: boolean, resterend?: string[] }>   // vergelijkt met alle hashes; resterend = hashes zonder de gebruikte
export async function controleerNoodsleutel(invoer, env, store): Promise<{ ok: boolean, hash?: string }>   // BEHEER_HERSTELSLEUTEL >= 32 tekens, timingSafeEqual op sha256, niet gelijk aan de hash in blob `herstel-noodroute`
```
  - `POST /api/auth-setup` `{ setupCode, email, naam, wachtwoord }` → enkel als er 0 gebruikers zijn: `403` bij foute of ontbrekende `BEHEER_SETUP_CODE` (fail-closed: ontbreekt de variabele dan nooit toegelaten), `409` als er al een gebruiker is (ook als de code juist is); anders rol `beheerder`, beleid op het wachtwoord, `200 { gebruiker, herstelcodes: [10] }` + sessiecookie; codes worden als hashes bewaard en enkel nu getoond.
  - `POST /api/auth-herstel` `{ email, bewijs, nieuwWachtwoord }` waar `bewijs` een herstelcode OF de noodsleutel is: enkel voor een actieve BEHEERDER (andere rollen en onbekende adressen krijgen dezelfde generieke `401` als een fout bewijs); vergrendeling soort `'herstel'` (5 pogingen → 1 uur); succes → nieuw wachtwoord, `moetWachtwoordWijzigen:false`, `sessieVersie + 1`, gebruikte code verwijderd of noodsleutelhash in `herstel-noodroute`, `200` + cookie; logt `herstel` (met `details: 'code' | 'noodsleutel'`).
  Beide functies `'open'` in `RECHTEN` en gebruiken altijd de echte store.

- [ ] **Step 1: Tests (RED).**
  - Setup: juiste code → 200, 10 codes van het formaat `XXXX-XXXX`, opgeslagen alleen als hashes (de blob bevat de platte codes niet), cookie geldig, activiteit `gebruiker-aangemaakt`; foute code 403; variabele ontbreekt of leeg → 403 ook met lege `setupCode`; tweede aanroep → 409 (ook met juiste code); wachtwoord van 5 tekens → 400; na succes toont `auth-ik` `setupNodig:false`.
  - Herstel met code: juiste code → nieuw wachtwoord werkt voor `auth-login`, oud wachtwoord niet, oud token 401, dezelfde code een tweede keer 401, een andere code uit de set nog wel geldig; code in kleine letters en met spatie wordt aanvaard (`normaliseerHerstelcode`); onbekend e-mailadres en niet-beheerder geven dezelfde 401-body als een foute code; 5 foute pogingen → 429 gedurende 1 uur, ook voor een niet-bestaand adres.
  - Noodsleutel: sleutel van 31 tekens in de omgeving → nooit aanvaard; sleutel van 32+ tekens juist → ok en de hash staat in `herstel-noodroute`; dezelfde sleutel een tweede keer → 401 (ook als de variabele blijft staan); zonder variabele → 401; sleutel + e-mail van een planner → 401.
- [ ] **Step 2: Draai** `node --test tests/server-auth-herstel.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** `herstel.js` en de twee functies. Races bij het aanmaken van de eerste beheerder (twee gelijktijdige setup-oproepen) worden afgedekt door `wijzigGebruikers` met `controleer` ("nog steeds precies één gebruiker, de mijne"); Blobs 8.2 heeft geen `onlyIfNew` (zie open punt 5).
- [ ] **Step 4: Draai** de test. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(auth): eerste beheerder en herstel met codes of noodsleutel (logins T6)`.

---

### Task 7: Gebruikersbeheer (`/api/gebruikers`)

**Model: sonnet.**

**Files:**
- Create: `netlify/functions/gebruikers.js`
- Modify: `netlify/lib/gebruikers.js` (hulpen), `netlify/lib/rechten.js`
- Test: `tests/server-gebruikers.test.mjs`

**Interfaces:**
- Consumes: Task 1–4 (ook `tests/auth-hulp.mjs`), 6.
- Produces (`beveiligV2('gebruikers', …)`, rechten: GET B (+S met `?rol=sales`), POST/PATCH B):
  - `GET /api/gebruikers` (beheerder) → `{ gebruikers: BeheerGebruiker[] }` (`laatsteLogin` per gebruiker uit de blob `login-laatst`: één extra blob-read via `leesLaatsteLogins`). `GET ?rol=sales` → `{ gebruikers: PubliekeGebruiker[] }` voor beheerder en voor sales met `magAlleSales`; andere `rol`-waarden of sales zonder `magAlleSales` → 403.
  - `POST` body `{ actie: 'maak', email, naam, rol, zohoNaam?, salesNaam?, magAlleSales?, startWachtwoord? }` → `201 { gebruiker, startWachtwoord, herstelcodes? }` (server genereert het startwachtwoord als niet gegeven; één keer in het antwoord; `moetWachtwoordWijzigen: true`); bij `rol: 'beheerder'` bevat het antwoord ook `herstelcodes` (10 codes via `maakHerstelcodes` uit Taak 6, bewaard als hashes in `herstelcodes`, enkel nu getoond: elk beheerdersaccount krijgt herstelcodes bij aanmaak, ook een tweede beheerder); andere rollen krijgen geen `herstelcodes`; `409` bij dubbel e-mailadres.
  - `POST { actie: 'reset-wachtwoord', id, startWachtwoord? }` → `200 { startWachtwoord }`, `moetWachtwoordWijzigen: true`, `sessieVersie + 1`; logt `wachtwoord-gereset` (onderwerp = doelgebruiker-id). `POST { actie: 'uitloggen-overal', id }` → `sessieVersie + 1`; logt `gebruiker-gewijzigd` (onderwerp = doelgebruiker-id, details `overal-uitgelogd`). `POST { actie: 'nieuwe-herstelcodes', wachtwoord }` → enkel voor de eigen beheerdersaccount, vraagt het eigen wachtwoord, vervangt de oude codes, `200 { herstelcodes }`.
  - `PATCH` body `{ id, naam?, rol?, actief?, zohoNaam?, salesNaam?, magAlleSales? }` → `200 { gebruiker }`; `actief` van true naar false of een rolwijziging verhoogt `sessieVersie`; logt `gebruiker-geblokkeerd` bij blokkeren, anders `gebruiker-gewijzigd`/`gebruiker-aangemaakt`; weigert (409 `{ error }`) wat `kanWijzigen` weigert.

- [ ] **Step 1: Tests (RED).** Beheerder maakt een technieker (zonder `zohoNaam` → 400; met → 201, hash niet in antwoord, `startWachtwoord` 12 tekens); dubbel adres (andere hoofdletters) → 409; planner of technieker (via `metRol` uit `tests/auth-hulp.mjs`) roept GET/POST aan → 403; `?rol=sales` als sales zonder `magAlleSales` → 403, met → 200 en enkel sales-gebruikers, zonder hashes; blokkeren van een gebruiker → de eerstvolgende `vereisGebruiker` met zijn oude token geeft 401; blokkeren van de enige actieve beheerder en degraderen van de enige beheerder → 409; als er een tweede actieve beheerder is → toegelaten; `reset-wachtwoord` laat de gebruiker enkel met het nieuwe startwachtwoord inloggen en met verplichte wijziging, en schrijft precies één activiteitregel `wachtwoord-gereset` (onderwerp = die gebruiker, naam = de beheerder); `uitloggen-overal` schrijft precies één `gebruiker-gewijzigd`, `maak` een `gebruiker-aangemaakt` en blokkeren een `gebruiker-geblokkeerd`; `maak` met `rol:'beheerder'` geeft 10 `herstelcodes` terug (formaat `XXXX-XXXX`, in de blob enkel als hashes, en een van die codes werkt bij `auth-herstel`), een planner geeft geen `herstelcodes`; naam `<img src=x onerror=alert(1)>` wordt bewaard zoals gegeven (de functie bewaart tekst, de client escaped) maar `naam` boven 100 tekens → 400; gelijktijdig `PATCH` (blokkeren) en `auth-login` van dezelfde gebruiker eindigt met `actief:false` (Review Focus 3: de login schrijft enkel `login-laatst`, nooit `gebruikers`); `GET` toont de `laatsteLogin` uit `login-laatst`; `nieuwe-herstelcodes` met fout wachtwoord → 400 en de oude codes blijven.
- [ ] **Step 2: Draai** `node --test tests/server-gebruikers.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de functie als dunne laag boven `lib/gebruikers.js`; alle schrijfacties via `wijzigGebruikers` (nooit rechtstreeks `store.setJSON`).
- [ ] **Step 4: Draai** de test plus `tests/server-auth-sessie.test.mjs`. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(auth): gebruikersbeheer-endpoint (logins T7)`.

---

### Task 8: Instellingen op de server (`lib/instellingen.js` en `/api/instellingen`)

**Model: sonnet.**

**Files:**
- Create: `netlify/lib/instellingen.js`, `netlify/functions/instellingen.js`
- Modify: `netlify/lib/rechten.js`
- Test: `tests/server-instellingen.test.mjs`

**Interfaces:**
- Consumes: Task 2–4 (ook `tests/auth-hulp.mjs`).
- Produces:
```js
// lib/instellingen.js — blob `instellingen` = { versie, perGebruiker: { [gebruikerId]: Instellingen } }; store = de store van het VERZOEK (testverzoek = teststore)
export async function leesInstellingen(store, gebruikerId): Promise<Instellingen | null>      // koppelvlak
export async function bewaarInstellingen(store, gebruikerId, instellingen): Promise<{ versie }>  // via wijzigBlob, per sleutel samenvoegen
export function schoonInstellingen(invoer): { fout: string } | { waarden: Instellingen }   // `fout` = de eerste weigeringstekst (Nederlands); whitelist: startlocatie, duurMinuten, maxPerDag, vanTijd, totTijd, laatsteStart, werkdagen, maxReistijdMin, tijdslotMinuten, kaartStijl, routeKleur, drukteKleuring, bezoekDuurMin; types en grenzen zoals instellingen-logica.js (duur >= 15, max >= 1, tijdslot >= 60, werkdagen niet leeg, routeKleur #rrggbb, bezoekDuurMin 5..480); onbekende velden vallen weg
export async function overzichtVoor(store, authStore, gebruiker): Promise<{ eigen, techniekers }>  // E4
```
  - `GET /api/instellingen` → `{ versie, instellingen: Instellingen | null }` (eigen). `GET ?gebruiker=<id>` → B voor iedereen; S met `magAlleSales` enkel voor een sales-gebruiker; anders 403. `GET ?overzicht=1` → B P T (eigen + actieve techniekers per `zohoNaam`), S enkel `eigen`.
  - `PUT /api/instellingen` `{ gebruiker?, instellingen, versie? }` → schrijft de eigen instellingen, of die van `gebruiker`: de beheerder voor iedereen; de planner enkel voor een doelgebruiker met `rol === 'technieker'` (opgezocht in de ECHTE store `blitz-data`; onbekend id → 404); technieker en sales met `gebruiker` ≠ eigen id → 403 (vóór de opzoeking, zodat het bestaan van een id niet lekt); een planner voor een andere planner, een beheerder of een sales → 403. Ongeldige instellingen → 400 met de `fout`-tekst van `schoonInstellingen` (toegepast vóór het schrijven); `200 { versie }`. Na een geslaagde schrijfactie voor een ANDER (`gebruiker` ≠ eigen id) logt de functie met `logVoorVerzoek` de actie `instellingen-gewijzigd`, `onderwerp` = doelgebruiker-id, `details` = kommagescheiden namen van de gewijzigde velden (nooit de waarden); een schrijfactie voor jezelf logt niets. Een testgebruiker (`test-*`) schrijft naar de teststore (store van het verzoek).

- [ ] **Step 1: Tests (RED).** `schoonInstellingen` geeft `{ fout: <tekst> }` voor `duurMinuten: 10`, `werkdagen: []`, `routeKleur: 'rood'`, laat onbekende velden weg en geeft `{ waarden }` met `bezoekDuurMin` door; een PUT met ongeldige invoer geeft 400 met die tekst; GET eigen zonder blob → `instellingen: null`; PUT eigen dan GET → dezelfde (zonder extra velden); twee gebruikers PUTten gelijktijdig: beide sleutels bestaan achteraf (B3); (rollen via `metRol` uit `tests/auth-hulp.mjs`) planner PUT voor een technieker → 200 en precies één activiteitregel (`instellingen-gewijzigd`, onderwerp = die technieker, `details` bevat de gewijzigde veldnamen en geen waarden); planner PUT voor een andere planner, een beheerder of een sales → 403 en voor een onbekend id → 404; technieker en sales PUT voor een ander → 403; beheerder PUT voor iedereen → 200 (met een activiteitregel); een PUT voor jezelf logt niets; een testverzoek logt niet; schrijven voor een technieker wijzigt de blob-sleutel van die technieker en niet de eigen; technieker `?gebruiker=` een collega → 403; sales met `magAlleSales` leest een andere sales-gebruiker maar niet een technieker (403); overzicht voor planner bevat enkel actieve techniekers met `zohoNaam` en nooit planners of beheerders; overzicht voor sales bevat enkel `eigen`; de testgebruiker `test-planner` met `X-Blitz-Test` schrijft in `blitz-data-test`.
- [ ] **Step 2: Draai** `node --test tests/server-instellingen.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer.** `instellingen.js` (functie) gebruikt de verzoekstore (`winkelNaam(req)`) voor `instellingen` en de ECHTE store voor `gebruikers` (techniekerlijst én de rol-opzoeking van de doelgebruiker bij een PUT voor een ander); `schoonInstellingen` wordt vóór het schrijven toegepast; de logregel gaat via `logVoorVerzoek`. Voeg de rij `instellingen` (`B P T S`) toe.
- [ ] **Step 4: Draai** de test. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(auth): instellingen op de server (logins T8)`.

---

### Task 9: Activiteitenlog, opruimen en systeemstatus (server)

**Model: sonnet.**

**Files:**
- Create: `netlify/functions/activiteit.js`, `netlify/functions/activiteit-opruimen.js`, `netlify/functions/systeemstatus.js`, `netlify/lib/systeemstatus.js`
- Modify: `netlify/lib/rechten.js`
- Test: `tests/server-activiteit.test.mjs`, `tests/server-systeemstatus.test.mjs`

**Interfaces:**
- Consumes: Task 2–4; `maakZoho` uit `netlify/lib/zoho.js`.
- Produces:
  - `GET /api/activiteit?van=<YYYY-MM-DD>&tot=<YYYY-MM-DD>&gebruiker=<id>&actie=<naam>` (B) → `{ items: Activiteit[], gebruikers: [{ id, naam }] }` (nieuwste eerst, max 1000; `gebruikers` uit de log zelf, voor de filter); ongeldige datum → 400.
  - `activiteit-opruimen`: `export default async () => {...}` + `export const config = { schedule: '@daily' }`; roept `ruimActiviteitOp(store, { nu, maanden: 12 })`; `'open'` in `RECHTEN` (idempotent en onschadelijk, een aanroep van buitenaf wist enkel wat al verouderd is).
  - `GET /api/systeemstatus` (B) → `{ zoho: { ok, fout?, tijdstip }, foutenlog: [{ tijdstip, ticketId, stap, fout }] (laatste 20 uit blob `foutenlog` van de verzoekstore), rapporten: { mislukt: [{ id, ticketNumber, technieker, datum, laatsteFout }] } }`. `rapporten.mislukt` leest `rapportlijst`-entries met `verwerking?.status === 'mislukt'` (het veld komt pas na de upload-fix, v1.10.2; ontbreekt het dan is de lijst leeg). Een testverzoek voert GEEN Zoho-aanroep uit (`zoho: { ok: true, test: true, tijdstip }`).
  `lib/systeemstatus.js`: `verzamelStatus({ store, zoho, test, nu })`.

- [ ] **Step 1: Tests (RED).** Activiteit: planner → 403 (via `metRol` uit `tests/auth-hulp.mjs`); `systeemstatus`: planner, technieker en sales → 403; de rijen `activiteit` en `systeemstatus` (enkel B) en `activiteit-opruimen` (`'open'`) voegt deze taak zelf toe; beheerder → items van twee maanden gefilterd op actie en gebruiker, nieuwste eerst; `van` na `tot` → leeg; `tot=morgen-formaat fout` → 400. Opruimen: `activiteit/2025-09` weg, `activiteit/2025-10` blijft (klok 2026-10-08), tweede run verandert niets, gooit niet bij een kapotte store. Systeemstatus: Zoho-token ophalen lukt → `ok:true` met tijdstip; token mislukt (nep-fetch 400) → `ok:false` met korte fout zonder geheimen (de foutstring bevat niet `refresh_token`, `client_secret`); 25 foutregels → 20 teruggegeven; entries met en zonder `verwerking` → enkel de `mislukt` ervan; testverzoek → geen uitgaande fetch.
- [ ] **Step 2: Draai** beide testbestanden. Verwacht: FAIL.
- [ ] **Step 3: Implementeer.** De functies zijn dun; de status-logica staat in `lib/systeemstatus.js`.
- [ ] **Step 4: Draai** beide. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(beheer): activiteit-, opruim- en systeemstatusfuncties (logins T9)`.

---

### Task 10: Alle bestaande functies achter de wrapper

**Model: sonnet** (mechanisch maar breed; daarna review van de diff per bestand).

**Files:**
- Modify: alle bestaande `netlify/functions/*.js` behalve `confirm-afspraak.js`, `planning-export.js` (zie Taak 12) en de in Taak 5–9 nieuw gemaakte functies (die zijn al omhuld); `tests/nep-fetch.mjs`; `dev-server.mjs`
- Test: `tests/rechten.test.mjs` (omgekeerde dekkingsrichting erbij), `tests/server-beveiliging.test.mjs`

**Interfaces:**
- Consumes: Task 3 en 4 (`beveiligV1/V2`, `zetKernSpyVoorTests`, `tests/auth-hulp.mjs`). Patroon per bestand:
  - v1 (`export async function handler(event)`): hernoem de kern naar `async function kern(event, context, gebruiker)` en `export const handler = beveiligV1('<naam>', kern);`
  - v2 default: `export default beveiligV2('<naam>', async (req, context, gebruiker) => {...})`; bij `maakHandler`-bestanden (`annuleer`, `mail-check`, `planning-sinds`, `send-rapport`) blijft `maakHandler` de RUWE handler (tests blijven ermee werken) en wordt enkel de standaardexport omhuld: `export default beveiligV2('annuleer', maakHandler({ getStore, fetch: globalThis.fetch }))`, resp. `export const handler = beveiligV1('send-rapport', maakHandler())`.
  - Geen functionele wijziging aan de kern van een functie; `config` blijft.
- Produces: `tests/nep-fetch.mjs` zet bij het laden `zetAuthVoorTests({ vasteGebruiker: { id: 'test-beheerder', email: 'b@test', naam: 'Test Beheerder', rol: 'beheerder' } })` en legt die vast als standaard met `zetStandaard` uit `tests/auth-hulp.mjs`. `metRol` en `metGeenSessie` komen uit `tests/auth-hulp.mjs` (Taak 4) en worden hier hergebruikt, niet opnieuw gemaakt. `dev-server.mjs` zet bovenaan `process.env.BLITZ_LOKALE_DEV = '1'`, en `process.env.SESSIE_GEHEIM ||= 'lokaal-dev-geheim-niet-voor-productie'` en `process.env.BEHEER_SETUP_CODE ||= 'lokaal'` (enkel hier), en breidt `Access-Control-Allow-Headers` uit met `X-Blitz, X-Blitz-Test, X-Blitz-Test-Rol`.

- [ ] **Step 1: Tests (RED).** `tests/server-beveiliging.test.mjs`, tabelgedreven over ALLE omhulde functies en methodes uit `RECHTEN` (laad elke functie met `laadVers`). De wrapper wordt getoetst met `zetKernSpyVoorTests(spy)` (Taak 4): de spy vervangt de kern, dus geen Blobs- of Zoho-aanroep, en een wrapper-weigering is nooit te verwarren met een 403 `geen-recht` of 400 uit de functie zelf (de eigen-regels van Taak 11):
  - `metGeenSessie` (uit `tests/auth-hulp.mjs`): elke niet-`open` functie/methode → `401` met `code: 'niet-ingelogd'` en de spy is NIET aangeroepen;
  - `metRol(rol, werk)`: voor elke (functie, methode, rol) uit de tabel: toegelaten rol → de spy is precies één keer aangeroepen met de juiste `naam`, `methode` en gebruiker; niet-toegelaten rol → `403` `geen-recht` en de spy is NIET aangeroepen. De statuscode van de kern speelt geen rol (rijen waarvan de functie zelf nog verder beslist, zoals `gebruikers` GET voor sales en `instellingen` PUT voor een planner, tellen als toegelaten);
  - `OPTIONS` op elke functie → 204 zonder auth;
  - de `open` functies (`confirm-afspraak`, `planning-export`, `activiteit-opruimen`, `auth-login`, `auth-uitloggen`, `auth-setup`, `auth-herstel`) geven zonder sessie GEEN `401` `niet-ingelogd` van de wrapper (`confirm-afspraak` GET zonder parameters geeft zijn eigen 400, niet 401);
  - dekking: `tests/rechten.test.mjs` krijgt de omgekeerde richting erbij: elke sleutel van `RECHTEN` is een bestand in `netlify/functions/` (alle rijen, ook die van de auth-functies, staan er sinds Taak 5–9).
- [ ] **Step 2: Draai** `node --test tests/server-beveiliging.test.mjs tests/rechten.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Pas de functies aan** volgens het patroon, `tests/nep-fetch.mjs` en `dev-server.mjs`. De rijen in `rechten.js` staan er al (Taak 4–9); pas ze hier niet opnieuw aan.
- [ ] **Step 4: Draai de VOLLEDIGE suite** `node --test`. Verwacht: PASS, en het aantal ongewijzigde karakteriseringstests blijft gelijk aan de basislijn (geen enkele bestaande `server-*.test.mjs` is aangepast behalve `nep-fetch.mjs`).
- [ ] **Step 5: Lokaal rooktest** (handmatig, korte): `node blobs-local-bootstrap.mjs`; `curl -s -o /dev/null -w "%{http_code}" http://localhost:3333/api/tickets` → `401`; met `-H "X-Blitz-Test: 1" -H "X-Blitz-Test-Rol: planner"` → `200` of een Zoho-fout, niet 401; `curl http://localhost:3333/api/confirm-afspraak` → niet 401. Stop het proces daarna (skill `opruimen-na-werk`).
- [ ] **Step 6: Commit** `feat(auth): alle functies achter de rechtentabel (logins T10)`.

---

### Task 11: "Eigen"-regels voor de technieker (server)

**Model: sonnet.**

**Files:**
- Create: `netlify/lib/eigen.js`
- Modify: `netlify/functions/afspraken.js`, `availability.js`, `inventaris.js`, `rapport-archief.js`, `rapport-verzonden.js`
- Test: `tests/eigen.test.mjs`, `tests/server-eigen.test.mjs`

**Interfaces:**
- Consumes: Task 2 (`normaliseerNaam`), Task 4 (`tests/auth-hulp.mjs`), Task 10 (gebruiker als derde parameter).
- Produces:
```js
// eigen.js (pure)
export function isEigenNaam(gebruiker, naam): boolean       // technieker met zohoNaam; normaliseerNaam gelijk en niet leeg; planner/beheerder altijd true; sales false
export function eigenWijzigingen(oudeLijst, nieuweLijst, { sleutel = 'id', eigenaar }): { ok: true } | { ok: false, reden }
  // `eigenaar(item) -> naam|null`. Elk toegevoegd, gewijzigd (deep-equal van het opgeschoonde item) of verwijderd item moet eigen zijn; globale items (eigenaar null) kunnen niet door de technieker veranderen
export function filterRapportenVoor(gebruiker, rapports): rapports[]   // technieker: enkel eigen `technieker`; anderen alles
```
Toepassing (alleen als `gebruiker.rol === 'technieker'`; `403 { error, code: 'geen-recht' }`):
- `afspraken` PUT: `eigenWijzigingen(current.afspraken, cleaned, { eigenaar: a => a.persoon })`.
- `availability` PUT: `eigenaar: e => e.scope === 'person' ? e.person : null`.
- `inventaris` POST: `body.technieker` moet eigen zijn; PATCH is al P/B.
- `rapport-archief`: GET filtert met `filterRapportenVoor` (ook `?id=`: een rapport van een collega geeft `rapport: null`); POST: `body.technieker` moet eigen zijn en een via dedup te overschrijven entry moet eigen zijn; DELETE: de entry moet eigen zijn.
- `rapport-verzonden`: de entry moet eigen zijn.

- [ ] **Step 1: Tests (RED).** `eigen.test.mjs`: `isEigenNaam` met `'tim '` vs `'Tim'` true, met lege naam false, technieker zonder `zohoNaam` false, sales false, planner true; `eigenWijzigingen`: eigen item toevoegen ok; collega-item wijzigen reden; collega-item verwijderen reden; een eigen item correct wijzigen terwijl een collega-item verdwijnt → reden (Review Focus 2); globaal item (`persoon: null`) wijzigen reden; ongewijzigde lijst ok. `server-eigen.test.mjs` (met `metRol('technieker', werk, { zohoNaam: 'Tim' })` uit `tests/auth-hulp.mjs`, nep-store): afspraken PUT met eigen item ok, met collega-item 403, met een collega-item stilletjes verwijderd 403; availability idem (globale blokkade toevoegen 403); inventaris POST voor `technieker:'Roel'` 403, voor `'Tim'` ok, voor `''` 403; rapport-archief GET toont enkel Tims rapporten, `?id=` van een collega → `rapport: null`; POST met `technieker:'Roel'` 403, met `technieker:''` 403, met `'tim'` ok; POST die via ticket+datum een rapport van Roel zou overschrijven → 403 en de blob onveranderd; DELETE van Roels rapport 403, van Tims ok; rapport-verzonden op Roels rapport 403. Dezelfde acties als planner 200.
- [ ] **Step 2: Draai** `node --test tests/eigen.test.mjs tests/server-eigen.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** `eigen.js` en de vijf aanpassingen (telkens een korte `if (gebruiker.rol === 'technieker')`-tak vóór het schrijven; de rest van de functie blijft).
- [ ] **Step 4: Draai** de twee testbestanden en de volledige `node --test`. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(auth): technieker schrijft enkel eigen data (logins T11)`.

---

### Task 12: Activiteit loggen in de bedrijfsfuncties en `planning-export` met service-sleutel

**Model: sonnet.**

**Files:**
- Modify: `netlify/functions/plan.js`, `plan-datum.js`, `propose.js`, `annuleer.js`, `send-rapport.js`, `planning-export.js`, `netlify/lib/rechten.js` (`service: true` op `tickets`, `klantbeschikbaarheid`, `afspraken` GET)
- Test: `tests/server-activiteit-logging.test.mjs`, `tests/server-planning-export-auth.test.mjs`

**Interfaces:**
- Consumes: `logVoorVerzoek` (Taak 2), gebruiker als derde parameter (Taak 10).
- Produces: na een GESLAAGDE actie `await logVoorVerzoek(req, gebruiker, { actie, onderwerp: ticketId, details }, { getStore })` met acties `'plannen'` (plan, plan-datum; `details`: datum of `'uitgepland'`), `'voorstel-verstuurd'` (propose), `'annulatie'` (annuleer; `details`: reden-code), `'rapport-verstuurd'` (send-rapport, niet bij `preview`). Nooit bij een testverzoek, nooit bij een fout, nooit blokkerend. `planning-export.js` stuurt `Authorization: Bearer <PLANNING_EXPORT_API_KEY>` mee op zijn drie interne `fetch`-aanroepen (`/api/tickets`, `/api/klantbeschikbaarheid`, `/api/afspraken`); zijn eigen sleutelcontrole blijft ongewijzigd.

- [ ] **Step 1: Tests (RED).** Per functie: een geslaagde actie schrijft precies één regel in `activiteit/<maand>` van de ECHTE store met `actie`, `onderwerp` en de naam van de gebruiker; een mislukte actie (Zoho 500) schrijft niets; een testverzoek (`X-Blitz-Test: 1`) schrijft niets; een store die gooit verandert het HTTP-antwoord niet; de uitgaande Zoho-aanroepen zijn identiek aan de basislijn (de bestaande karakteriseringstests blijven ongewijzigd groen). `planning-export`: met de juiste sleutel en een nep-fetch die controleert dat de drie interne aanroepen de `Authorization`-header met dezelfde sleutel dragen → 200; de sleutel valt weg bij een interne aanroep → die krijgt 401 (de nep-fetch roept de wrapper van `tickets` aan met `service: true`: ok met sleutel, 401 zonder).
- [ ] **Step 2: Draai** beide testbestanden. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de logging (één regel per succesvolle tak; geen herstructurering) en de header in `planning-export.js`.
- [ ] **Step 4: Draai** de volledige `node --test`. Verwacht: PASS, bestaande tests ongewijzigd.
- [ ] **Step 5: Commit** `feat(auth): activiteit loggen en planning-export met service-sleutel (logins T12)`.

---

### Task 13: Client — fetch-omhulling en sessie

**Model: sonnet.**

**Files:**
- Create: `public/js/kern/sessie.js`
- Modify: `public/js/kern/api.js` (export `installeerApiBeveiliging`), `public/js/kern/brug.js` (één regel + import), `public/index.html` (modulepreload `kern/sessie.js`), `public/sw.js` (`SHELL`)
- Test: `tests/api-beveiliging.test.mjs`, `tests/sessie.test.mjs`

**Interfaces:**
- Consumes: Task 5 (`auth-ik`).
- Produces:
```js
// api.js (naast apiVerzoek/apiJson/bewaarMetVersie/leesFout)
export function installeerApiBeveiliging(doel, { herlogin, testRol = () => null }): () => void
  // omhult doel.fetch (buitenste laag, ná installeerFetchTimeout). Voor same-origin /api/-verzoeken: zet 'X-Blitz: 1' bij elke methode behalve GET/HEAD/OPTIONS;
  // zet 'X-Blitz-Test-Rol: <rol>' als testRol() een tekst geeft; bij een 401 (niet van /api/auth-*) of een 403 met code 'wachtwoord-wijzigen': await herlogin() en het verzoek ÉÉN keer herhalen
  // (enkel als invoer een string/URL is of de body een string is); een tweede 401 wordt gewoon doorgegeven. Eigen signal van de aanroeper blijft gerespecteerd.
// sessie.js (koppelvlak)
export async function laadSessie(): Promise<PubliekeGebruiker>    // GET /api/auth-ik; één gedeelde lopende belofte (gelijktijdige aanroepen delen ze)
export function huidigeGebruiker(): PubliekeGebruiker | null
export function heeftRol(...rollen): boolean
export function magSchrijvenVoor(zohoNaam): boolean               // technieker: genormaliseerd gelijk aan eigen zohoNaam; planner/beheerder true; sales false
export function huidigeRechten(): { beheer, plannen, alleSales }  // E5
export async function afmelden(): Promise<void>                   // POST /api/auth-uitloggen, wist `blitz_sessie_cache`, roept de geregistreerde afmeldhaken aan en herlaadt de pagina
export function registreerAfmeldHaak(fn): void                    // haak die `afmelden` aanroept vóór het herladen (Taak 16 registreert hier het wissen van de instellingen-cache; sessie.js kent instellingen niet)
export function isLokaleDev(): boolean                            // vlag `lokaleDev` uit het laatste `auth-ik`-antwoord; false zolang er geen antwoord was
export function zetInlogUi({ toonInloggen, toonWachtwoordWijzigen, toonGeenVerbinding })  // geregistreerd door schermen/inloggen.js (kern importeert geen schermen)
export function testRolVoorHeader(): string | null                // enkel in testmodus: localStorage 'blitz_test_rol' (standaard 'beheerder'); null buiten testmodus en null zodra het laatste auth-ik `lokaleDev:false` gaf (productie met ?test stuurt de header niet meer)
```
`laadSessie`: 200 → bewaar gebruiker, de vlag `lokaleDev` (voor `isLokaleDev()`) en `localStorage.blitz_sessie_cache` (PubliekeGebruiker) → resolve; 200 met `moetWachtwoordWijzigen` → `toonWachtwoordWijzigen()` eerst; 401 → `toonInloggen({ setupNodig })` en daarna opnieuw `auth-ik`; netwerkfout → bewaarde gebruiker uit de cache gebruiken (offline start), zonder cache `toonGeenVerbinding()` (belofte die pas oplost bij "opnieuw proberen"). Wisselt de gebruikers-id t.o.v. de vorige in-memory gebruiker (herinloggen als iemand anders) → `location.reload()`.

- [ ] **Step 1: Tests (RED).** `api-beveiliging.test.mjs` (nep-`doel` met nep-fetch en `location.href`, zoals `tests/netwerk.test.mjs`): POST naar `/api/plan` krijgt `X-Blitz: 1`, GET niet; een extern adres (`https://cdn…`) en `data:` blijven onaangeroerd; `testRol: () => 'planner'` zet `X-Blitz-Test-Rol: planner`, `() => null` niet; 401 op `/api/tickets` → `herlogin` één keer aangeroepen en het verzoek herhaald (tweede antwoord 200 wordt teruggegeven); een tweede 401 wordt doorgegeven zonder derde poging; 401 op `/api/auth-login` triggert `herlogin` niet; 403 `code:'wachtwoord-wijzigen'` triggert `herlogin`; 403 `geen-recht` niet; drie gelijktijdige 401's → `herlogin` wordt drie keer aangeroepen maar het is dezelfde gedeelde belofte (de test van `laadSessie` bewijst dat dit één loginscherm is); een verzoek met eigen `signal` blijft die `signal` houden; de body van het eerste antwoord blijft leesbaar voor de aanroeper bij een niet-herhaald antwoord (clone gebruiken). `sessie.test.mjs` (nep-`fetch`, nep-`localStorage`, nep-UI): 200 → `huidigeGebruiker()`; 401 → `toonInloggen` aangeroepen met `setupNodig`, na zijn resolutie een tweede `auth-ik`; twee gelijktijdige `laadSessie()` → één `auth-ik` en één `toonInloggen`; netwerkfout met cache → resolve met de cache-gebruiker zonder loginscherm; netwerkfout zonder cache → `toonGeenVerbinding`; `magSchrijvenVoor('tim ')` voor technieker `Tim` true en voor `'Roel'` false, voor planner true, sales false; `heeftRol('beheerder','planner')`; `afmelden` wist `blitz_sessie_cache`, roept alle met `registreerAfmeldHaak` geregistreerde haken aan (ook als er één gooit) en herlaadt de pagina (het wissen van de instellingen-cache is een haak van Taak 16); `isLokaleDev()` is `false` vóór het eerste `auth-ik` en volgt daarna de vlag; `testRolVoorHeader()` geeft in testmodus standaard `'beheerder'` (vlag onbekend of `true`), `null` na een `auth-ik` met `lokaleDev:false` en `null` buiten testmodus.
- [ ] **Step 2: Draai** `node --test tests/api-beveiliging.test.mjs tests/sessie.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** `installeerApiBeveiliging` in `api.js` en `sessie.js`; in `brug.js` direct na `installeerFetchTimeout(window);`: `installeerApiBeveiliging(window, { herlogin: () => laadSessie(), testRol: testRolVoorHeader });`. Voeg `<link rel="modulepreload" href="/js/kern/sessie.js">` toe en `'/js/kern/sessie.js'` in `SHELL`.
- [ ] **Step 4: Draai** de twee tests, `node --test tests/sw-schil.test.mjs tests/window-namen.test.mjs tests/netwerk.test.mjs tests/api.test.mjs`, daarna de volledige `node --test`. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(client): fetch-omhulling met X-Blitz en herinloggen, kern/sessie.js (logins T13)`.

---

### Task 14: Loginschermen

**Model: sonnet.**

**Files:**
- Create: `public/js/schermen/inloggen-logica.js`, `public/js/schermen/inloggen.js`, `public/css/inloggen.css`
- Modify: `public/index.html` (enkel één `<link rel="stylesheet">`; GEEN modulepreloads: vóór Taak 15 importeert niets `inloggen*.js` statisch en `tests/sw-schil.test.mjs` eist dat de preloadlijst precies de statische modulegraaf is), `public/sw.js` (`SHELL`), `e2e/helpers.mjs` en `e2e/productie-hulp.mjs` (standaardstubs, zie Stap 4)
- Test: `tests/inloggen-logica.test.mjs` (de e2e `e2e/inloggen.spec.mjs` staat in Taak 15, waar de modules gekoppeld worden)

**Interfaces:**
- Consumes: `zetInlogUi` (Taak 13), `escHtml`/`registreerActies` uit `kern/ui.js`.
- Produces:
```js
// inloggen-logica.js (pure)
export function valideerInlog({ email, wachtwoord }): { fout } | { waarden }                 // e-mail met @, wachtwoord niet leeg
export function valideerNieuwWachtwoord({ huidig, nieuw, herhaal }): { fout } | { waarden }  // 10..200, nieuw !== huidig, herhaal gelijk
export function valideerSetup({ setupCode, email, naam, wachtwoord, herhaal }): { fout } | { waarden }
export function valideerHerstel({ email, bewijs, nieuw, herhaal }): { fout } | { waarden }  // e-mail met @, bewijs (herstelcode of noodsleutel, één veld) niet leeg, nieuw 10..200 en gelijk aan herhaal; waarden = { email, bewijs, nieuwWachtwoord }
export function loginFoutTekst(status, data): string        // 401 -> 'Onjuist e-mailadres of wachtwoord'; 429 -> 'Te veel pogingen. Probeer opnieuw om hh:mm.'; overig 'Inloggen mislukt'
export function formatHerstelcodes(codes): string           // 'XXXX-XXXX' twee kolommen, voor tonen en afdrukken
// inloggen.js — één overlay #login-overlay (bovenop de app, ondoorzichtig, focusval, Enter verstuurt); registreert zichzelf via zetInlogUi bij het laden
export function toonInloggen({ setupNodig }): Promise<void>  // formulier e-mail+wachtwoord; link 'Wachtwoord vergeten (beheerder)' die `toonHerstel()` opent; met setupNodig het scherm 'Beheerder instellen'; na een geslaagde login: overlay weg, belofte lost op; bij setup toont het eerst eenmalig de 10 herstelcodes met 'Ik heb ze bewaard'
export function toonWachtwoordWijzigen({ verplicht }): Promise<void>
export function toonHerstel(): Promise<void>               // scherm 'Wachtwoord vergeten (beheerder)': e-mail, herstelcode of noodsleutel (één veld), nieuw wachtwoord + herhaal; POST /api/auth-herstel { email, bewijs, nieuwWachtwoord }; 200 = ingelogd (cookie), overlay weg, belofte lost op; 401 = generieke foutmelding, 429 = vergrendelingstekst (loginFoutTekst); knop 'Terug naar inloggen'
export function toonGeenVerbinding(): Promise<void>          // 'Geen verbinding' + knop 'Opnieuw proberen'
```

- [ ] **Step 1: Tests (RED), `inloggen-logica.test.mjs`.** `valideerInlog({email:'a',wachtwoord:'x'})` → fout; `valideerNieuwWachtwoord` weigert 9 tekens, 201 tekens, `nieuw === huidig`, afwijkende herhaling, en aanvaardt 10 tekens; `loginFoutTekst(429, { opnieuwOp: '2026-10-08T14:30:00.000Z' })` bevat het tijdstip in Brusselse tijd; `loginFoutTekst(401)` is exact `'Onjuist e-mailadres of wachtwoord'` en verraadt niets; `formatHerstelcodes` geeft 10 regels; `valideerHerstel` weigert een ongeldig e-mailadres, een leeg bewijs, een nieuw wachtwoord van 9 of 201 tekens en een afwijkende herhaling, en geeft bij geldige invoer `{ email, bewijs, nieuwWachtwoord }`. De e2e voor de loginschermen (`e2e/inloggen.spec.mjs`, inclusief het herstelscherm) staat in Taak 15 Stap 1: pas daar worden de modules gekoppeld.
- [ ] **Step 2: Draai** `node --test tests/inloggen-logica.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de logica en `inloggen.js` (DOM-opbouw met `escHtml`; formulierwaarden via `.value`, nooit in `innerHTML`); `inloggen.css` met bestaande CSS-variabelen (`--bg`, `--accent`, `.set-input`, `.btn`) en 16 px lettergrootte voor invoervelden (geen iOS-zoom). `inloggen.js` bevat het inlog-, setup-, wijzig-, herstel- en geen-verbindingsscherm en wordt in Taak 14 NERGENS geïmporteerd (Taak 15 koppelt het via `rol-schil.js`).
- [ ] **Step 4: Stubs voor de bestaande e2e.** In `e2e/helpers.mjs` `maakStandaardStubs()`: `'auth-ik'` geeft `{ gebruiker: { id: 'u-test', email: 'b@test.be', naam: 'Test Beheerder', rol: 'beheerder' }, rechten: { beheer: true, plannen: true, alleSales: true }, moetWachtwoordWijzigen: false, lokaleDev: false }`, `'auth-uitloggen'` `ok`; `startApp` krijgt optie `loginRol` (standaard `'beheerder'`) die de rol van die stub bepaalt; `e2e/productie-hulp.mjs`: zelfde stubs (controleer eerst waar de standaardstubs van de productiemodus vandaan komen en hergebruik `maakStandaardStubs`). `'auth-ik'` en `'auth-uitloggen'` in geen enkele `VERBODEN_PADEN`-lijst.
- [ ] **Step 5: Draai** de volledige `node --test` (incl. `sw-schil` en `window-namen`: groen, want de modules zijn nog niet gekoppeld en hebben geen preload). Verwacht: PASS. De e2e van de loginschermen volgt in Taak 15, waar de app daadwerkelijk wacht op de sessie.
- [ ] **Step 6: Commit** `feat(client): inlog-, setup- en wachtwoordschermen (logins T14)`.

---

### Task 15: Rol, tabs en gebruikersmenu — de app start na de login

**Model: sonnet.**

**Files:**
- Create: `public/js/kern/navigatie.js`, `public/js/schermen/rol-schil.js`, `public/js/schermen/gebruikersmenu.js`, `e2e/inloggen.spec.mjs`
- Modify: `public/js/apparaat.js` (`zetLoginRol`), `public/js/app.js` (twee importregels, de vervangen DOMContentLoaded-regel en één regel in `setTab`), `public/index.html` (modulepreloads voor de hele statische graaf die `rol-schil.js` binnenhaalt: `kern/navigatie.js`, `schermen/rol-schil.js`, `schermen/gebruikersmenu.js`, `schermen/inloggen.js`, `schermen/inloggen-logica.js`), `public/sw.js` (`SHELL`)
- Test: `tests/navigatie.test.mjs`, `e2e/rollen.spec.mjs`

**Interfaces:**
- Consumes: Task 13 (`laadSessie`, `huidigeGebruiker`), Task 14.
- Produces:
```js
// navigatie.js (pure; koppelvlak + E1)
export function registreerTabs(rol, tabs)       // tabs: [{ id, label, laad: () => Promise<void> }]; VOEGT toe (dubbele id per rol wordt vervangen)
export function tabsVoorRol(rol): tab[]         // in registratievolgorde
export function registreerStart(rol, fn)        // E1; fn() start de app voor die rol i.p.v. de gewone opstart
export function startVoorRol(rol): (() => void) | null
export async function laadTab(id): Promise<void>  // roept laad() van de geregistreerde tab van de huidige rol; onbekend = niets
// rol-schil.js
export async function startNaInlog(opstart): Promise<void>
//   await laadSessie(); pasRolToe(gebruiker); const start = startVoorRol(rol); start ? start() : opstart()
export function pasRolToe(gebruiker): void
// gebruikersmenu.js
export function toonGebruikersmenu(gebruiker): void   // knop in <header> na ⚙: naam + rol, 'Wachtwoord wijzigen', 'Uitloggen' (→ afmelden), voor beheerder een link naar tab Beheer
```
Registratie in `rol-schil.js` (de tabs `id` zijn de bestaande `tab-<id>`-knoppen van `index.html`, zodat `setTab` ongewijzigd werkt): beheerder en planner `tickets, kalender, planning, gepland, inventaris, rapporten`; beheerder krijgt bovendien `beheer` (label "Beheer", `laad: () => import('./beheer.js').then(m => m.openBeheer(document.getElementById('view-beheer')))`); technieker `kalender, gepland, inventaris`; sales: `[]` plus `registreerStart('sales', toonSalesPlaceholder)` (een neutraal scherm "Het sales-gedeelte volgt" met het gebruikersmenu; de sales-planning vervangt dit).
`rol-schil.js` importeert STATISCH `./inloggen.js` (registreert `zetInlogUi`: de eerste koppeling van de loginschermen uit Taak 14), `./gebruikersmenu.js`, `../kern/navigatie.js` en `../kern/sessie.js`; Taak 16 en 19 voegen daar `../kern/instellingen-sync.js`, resp. `./rolwisselaar.js` aan toe (telkens met modulepreload). `beheer*.js` blijft lazy, zonder preload.
`pasRolToe`: `window.zetLoginRol(rol)` (technieker en sales forceren het toestel-rolgedrag); verbergt bestaande `.tab`-knoppen die niet in `tabsVoorRol(rol)` zitten (`hidden` + `aria`-attributen) en maakt voor onbekende ids een nieuwe knop (`#tab-<id>`, `data-actie="hoofdtab"`, `data-arg`) en view (`#view-<id>`, `class="view"`, `role="tabpanel"`) in `<main>`; voor een technieker zet het `localStorage.blitz_active_person` op de eigen `zohoNaam` als die nog niet op een bestaande persoon staat; roept `toonGebruikersmenu` aan.
`apparaat.js`: `window.zetLoginRol(r)` bewaart `loginRol` (enkel `'technieker'`/`'sales'` tellen) en `bepaal()` geeft `rol: 'technieker'` en `rolGekozen: true` als `loginRol` gezet is (geen tablet-rolvraag voor een ingelogde technieker).
`app.js`: `import { startNaInlog } from './schermen/rol-schil.js'; import { laadTab } from './kern/navigatie.js';` onderaan `document.addEventListener('DOMContentLoaded', () => startNaInlog(opstart));` en in `setTab` één regel `laadTab(tab);`.

- [ ] **Step 1: Tests (RED).** `navigatie.test.mjs`: `registreerTabs('planner', [a])` en daarna `[b]` → `tabsVoorRol('planner')` is `[a, b]`; opnieuw `a` registreren vervangt, dupliceert niet; onbekende rol → `[]`; `registreerStart`/`startVoorRol` roundtrip; `laadTab` roept enkel de `laad` van de geregistreerde tab aan en gooit niet bij een onbekende id of een falende `laad`. E2E `rollen.spec.mjs` (via `startApp({ loginRol })`, stubs uit Taak 14): beheerder ziet 7 tabs incl. "Beheer"; planner 6 zonder "Beheer"; technieker ziet "Kalender", "Ingepland", "Inventaris" en geen "Wachtrij"/"Route"/"Rapporten", ook op een computer-toestel (`blitz_rol: 'coordinator'` in localStorage wordt genegeerd: `.coord-only`-knoppen zijn verborgen) en krijgt geen tablet-rolvraag; technieker start met `blitz_active_person` = eigen `zohoNaam`; sales ziet het placeholder-scherm en het testverzoek-log bevat GEEN aanroep van `/api/tickets`; gebruikersmenu toont de naam als tekst (naam `<b>x</b>` letterlijk), "Uitloggen" roept `auth-uitloggen` aan en herlaadt. Daarnaast `e2e/inloggen.spec.mjs` (de loginschermen uit Taak 14, nu gekoppeld) (stub `auth-ik` 401 `setupNodig:false`, stub `auth-login`): overlay zichtbaar en `#cnt-tickets` pas gevuld na de login; foute login toont de foutmelding en het formulier blijft; Enter in het wachtwoordveld verstuurt; `setupNodig:true` toont "Beheerder instellen" en na succes de codes; `moetWachtwoordWijzigen` toont eerst het wijzigscherm; de overlay is niet te sluiten met Escape; elke vrije tekst uit antwoorden (fout met `<b>`) verschijnt als tekst (`escHtml`); het herstelscherm: de link 'Wachtwoord vergeten (beheerder)' toont het herstelscherm; herstel met een herstelcode (stub `auth-herstel` 200; het verzoek draagt `bewijs: <code>` en `nieuwWachtwoord`) en apart met een noodsleutel (`bewijs: <sleutel>`) → overlay weg en de app start; stub 401 → generieke foutmelding en het formulier blijft; afwijkende herhaling → foutmelding zonder verzoek. Alle bestaande e2e-specs blijven groen met de standaard-stubs (beheerder).
- [ ] **Step 2: Draai** `node --test tests/navigatie.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de modules en de minimale wijzigingen in `apparaat.js`/`app.js`/`index.html`/`sw.js` zoals hierboven (`rol-schil.js`, `navigatie.js`, `gebruikersmenu.js`, `inloggen.js` en `inloggen-logica.js` zitten nu in de statische graaf: modulepreload + `SHELL`; `beheer.js` lazy, zonder preload).
- [ ] **Step 4: Draai** `node --test` (incl. `sw-schil` en `window-namen`) en de VOLLEDIGE `npx playwright test` (project `chromium`, plus `--project=sw`). Verwacht: PASS; aantal bestaande e2e ongewijzigd, nieuwe erbij; `e2e/inloggen.spec.mjs` ook met `--repeat-each=3`.
- [ ] **Step 5: Commit** `feat(client): app start na login, tabs en toestelrol per gebruikersrol, gebruikersmenu (logins T15)`.

---

### Task 16: Instellingen van de server (overgang localStorage → server)

**Model: sonnet.**

**Files:**
- Create: `public/js/kern/instellingen-sync.js`
- Modify: `public/js/schermen/instellingen.js` (`savePersonSettings`, toast bij `geen-recht`), `public/js/schermen/rol-schil.js` (importeert `../kern/instellingen-sync.js` statisch, registreert de afmeldhaak en roept de sync aan na de login), `public/index.html` (modulepreload), `public/sw.js` (`SHELL`), `e2e/helpers.mjs` (stub `instellingen`)
- Test: `tests/instellingen-sync.test.mjs`, `e2e/instellingen-server.spec.mjs`

**Interfaces:**
- Consumes: Task 8 (E4), Task 13.
- Produces:
```js
// instellingen-sync.js — de server is de bron; localStorage (settingsKey) blijft de snelle, synchrone cache zodat loadPersonSettings ongewijzigd werkt
export async function synchroniseerInstellingen(gebruiker, { apiJson = ..., opslag = localStorage }): Promise<void>
  // GET /api/instellingen?overzicht=1. Eigen: serverwaarde -> opslag[settingsKey(eigenPersoon)] (eigenPersoon = zohoNaam voor technieker, anders 'all'), én opslag.blitz_laatste_start (R8). Techniekers: opslag[settingsKey(zohoNaam)] = hun serverwaarden.
  // Overgang: bestaat er voor mij nog niets op de server (instellingen null) en staat er lokaal iets en hoort die lokale waarde bij mij (marker 'blitz_instellingen_eigenaar' ontbreekt of is mijn id) -> PUT omhoog; zet de marker op mijn id. Hoort de marker bij een ander -> niets uploaden.
  // Vuil-markering (voorkomt stil dataverlies): `blitz_instellingen_vuil` = JSON `{ [persoon]: true }` met de personen wier laatste PUT mislukte (`reden: 'netwerk'`). Bij de volgende synchronisatie wordt voor elke gemarkeerde persoon EERST de lokale waarde opgeladen (PUT) vóór er iets van de server in de opslag komt; slaagt dat, dan verdwijnt de markering; slaagt het niet, dan blijft de lokale waarde staan en wordt niets overschreven.
export function bewaarOpServer(persoon, instellingen, gebruiker, { apiVerzoek = ..., opslag = localStorage }): Promise<{ ok: boolean, reden?: 'geen-recht' | 'geen-account' | 'netwerk' }>
  // doel: persoon 'all' of eigen zohoNaam -> eigen id; andere technieker -> het gebruikerId uit de overzicht-cache (beheerder en planner slagen; andere rollen krijgen 403 `geen-recht`); onbekende persoon zonder account -> { ok:false, reden:'geen-account' } (blijft lokaal)
  // Bij een ANDERE persoon laat `bewaarOpServer` `laatsteStart` weg uit de body (het is een globale instelling van het toestel, `blitz_laatste_start`, en hoort niet in het record van die persoon). `reden: 'netwerk'` zet de vuil-markering van die persoon; een geslaagde PUT wist ze; `geen-recht` zet geen markering.
export function wisInstellingenCache(opslag): void   // alle 'blitz_settings*', 'blitz_laatste_start', de marker 'blitz_instellingen_eigenaar' en 'blitz_instellingen_vuil'; door `rol-schil.js` geregistreerd als afmeldhaak via `registreerAfmeldHaak` (Taak 13)
```
`instellingen.js` `savePersonSettings(person)` schrijft zoals nu naar `localStorage` EN roept `bewaarOpServer` aan (fire-and-forget); bij een echte 403 (`reden: 'geen-recht'`) een toast "Je mag de instellingen van deze persoon niet wijzigen; lokaal bewaard." (`toast` uit `kern/ui.js`).

- [ ] **Step 1: Tests (RED).** `instellingen-sync.test.mjs` (nep-opslag en nep-`apiJson`): serverwaarde overschrijft lokale waarde onder `blitz_settings` voor een planner (`'all'`) en onder `blitz_settings_Tim` voor een technieker `Tim`; techniekerinstellingen uit het overzicht worden onder hun `settingsKey` gezet; server `null` + lokale waarde + geen marker → één PUT met de lokale waarde en marker = mijn id; server `null` + marker van een ander → geen PUT en lokale waarde van de ander NIET onder mijn sleutel (opslag gewist voor 'all'); server heeft waarde → geen PUT; mislukt het overzicht (netwerk) → opslag ongewijzigd, geen gooi; `bewaarOpServer('Roel', …)` door een planner → PUT met `gebruiker: <id van Roel>` en bij server 200 `{ ok:true }`; apart: server 403 → `{ ok:false, reden:'geen-recht' }` (geen vuil-markering); server onbereikbaar → `{ ok:false, reden:'netwerk' }` en `blitz_instellingen_vuil` bevat die persoon; voor een ANDERE persoon bevat de PUT-body geen `laatsteStart`, voor de eigen persoon wel; een volgende `synchroniseerInstellingen` met een vuile persoon uploadt EERST de lokale waarde (PUT vóór de serverwaarden in de opslag komen), laat de lokale waarde staan als die PUT opnieuw mislukt en wist de markering na een geslaagde PUT; `bewaarOpServer('Onbekend', …)` → `geen-account` zonder PUT; `wisInstellingenCache` wist enkel `blitz_settings*`, `blitz_laatste_start` en de marker. E2E `instellingen-server.spec.mjs`: stub met server-instellingen (startlocatie "Teststraat 1") → het instellingenvenster toont die; opslaan doet een `PUT /api/instellingen` met de nieuwe waarde; planner met Tim gekozen: de `PUT` draagt `gebruiker: <Tim-id>`, er verschijnt geen toast en `localStorage` bevat de waarde; apart met een stub die op `PUT` met `gebruiker` ≠ eigen id `403 geen-recht` geeft: toast met de tekst hierboven en `localStorage` bevat toch de waarde; uitloggen wist `blitz_settings`.
- [ ] **Step 2: Draai** `node --test tests/instellingen-sync.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de module en de aanpassingen; `rol-schil.js` importeert `../kern/instellingen-sync.js` statisch (modulepreload in `index.html`), registreert `registreerAfmeldHaak(() => wisInstellingenCache(localStorage))` en roept `synchroniseerInstellingen(gebruiker)` aan vóór `opstart()` (de aanroep faalt nooit hard: bij een fout start de app met de lokale cache). Stub in `e2e/helpers.mjs`: `instellingen` geeft op GET `{ eigen: { gebruikerId: 'u-test', versie: 0, instellingen: null }, techniekers: {} }` en op PUT `{ versie: 1 }`; `startApp` laat de bestaande `localStorage`-instellingen van specs ongemoeid (migratie uploadt enkel).
- [ ] **Step 4: Draai** `node --test` en de volledige `npx playwright test`. Verwacht: PASS (de bestaande instellingenspecs `instellingen-*.spec.mjs` en `werkuren.spec.mjs` ongewijzigd groen: dat bewijst dat `loadPersonSettings` synchroon bleef).
- [ ] **Step 5: Commit** `feat(client): instellingen komen van de server, localStorage als cache (logins T16)`.

---

### Task 17: Beheerpagina — schil en tab Gebruikers

**Model: sonnet.**

**Files:**
- Create: `public/js/schermen/beheer.js`, `public/js/schermen/beheer-tabs.js`, `public/js/schermen/beheer-gebruikers-logica.js`, `public/js/schermen/beheer-gebruikers.js`, `public/css/beheer.css`
- Modify: `public/index.html` (`<link rel="stylesheet" href="/css/beheer.css">`), `public/sw.js` (`SHELL`: de vijf nieuwe js-bestanden en de css)
- Test: `tests/beheer-gebruikers-logica.test.mjs`, `e2e/beheer-gebruikers.spec.mjs`

**Interfaces:**
- Consumes: Task 7, 13, 15.
- Produces:
```js
// beheer.js (koppelvlak) — lazy geladen
export function registreerBeheerTab({ id, label, render })      // render(container) -> Promise<void>
export async function openBeheer(container): Promise<void>      // importeert './beheer-tabs.js' (registreert de tabs), tekent een tabbalk (role=tablist, pijltjestoetsen) en rendert de gekozen tab; onthoudt de gekozen tab in sessionStorage
// beheer-tabs.js: import './beheer-gebruikers.js'; import './beheer-instellingen.js'; import './beheer-activiteit.js'; import './beheer-systeemstatus.js';  (Taak 18 voegt de laatste drie toe; E2: dashboard voegt zijn regel toe)
// beheer-gebruikers-logica.js (pure)
export function sorteerGebruikers(lijst): lijst                 // actief eerst, dan naam
export function valideerGebruikerFormulier(invoer, rol): { fout } | { waarden }   // zelfde regels als de server (technieker -> zohoNaam, sales -> salesNaam)
export function zohoNaamOpties(tickets, huidige): string[]      // unieke assignees uit allTickets/allPending/allGepland, plus huidige, gesorteerd
export function rolLabel(rol): string                           // 'Beheerder' | 'Planner' | 'Technieker' | 'Sales'
export function kanBlokkeren(gebruikers, id): boolean           // spiegelt de laatste-beheerder-regel voor de knop (de server beslist)
```
Tab Gebruikers: tabel (naam, e-mail, rol, actief, laatste login), "Nieuwe gebruiker" (rol-afhankelijke velden: Zoho-naam als keuzelijst met vrije invoer, "naam in export", vinkje "mag alle sales zien"; bij rol Beheerder toont het venster na het aanmaken naast het startwachtwoord ook eenmalig de 10 herstelcodes via `formatHerstelcodes`, zoals het setup-scherm), bewerken, blokkeren/deblokkeren, "Startwachtwoord opnieuw instellen" en "Overal uitloggen" (tonen het gegenereerde startwachtwoord één keer in een venster met kopieerknop), "Nieuwe herstelcodes maken" voor de eigen beheerdersaccount (vraagt het eigen wachtwoord, toont de 10 codes één keer). Bevestiging via `appConfirm` bij blokkeren en wachtwoord resetten. Alle tekst via `escHtml`; foutmeldingen van de server (409 laatste beheerder) als toast.

- [ ] **Step 1: Tests (RED).** Pure logica: `sorteerGebruikers` zet inactief onderaan; `valideerGebruikerFormulier({rol:'technieker', zohoNaam:''})` → fout, sales zonder `salesNaam` → fout, planner zonder beide → ok; `zohoNaamOpties` dedupliceert en negeert lege namen; `kanBlokkeren` false voor de enige actieve beheerder, true bij twee. E2E (stub `gebruikers`, stateful): beheerder opent "Beheer" → tab Gebruikers toont de lijst; nieuwe technieker met `zohoNaam` kiezen uit de lijst (Tim/Roel uit de dummy-tickets) → `POST` met `actie:'maak'`; het startwachtwoord verschijnt één keer en nergens in de pagina daarna (`page.content()` bevat het niet meer na sluiten); een nieuwe gebruiker met rol Beheerder toont ook de 10 herstelcodes één keer (stub `201` met `herstelcodes`) en die staan daarna niet meer in de pagina, een nieuwe planner toont er geen; blokkeren vraagt bevestiging; stub die 409 geeft → toast met de servertekst; gebruikersnaam `<img src=x onerror=window.__xss=1>` verschijnt als tekst en `window.__xss` blijft `undefined` (Review Focus: XSS); de tab is niet bereikbaar voor planner (geen "Beheer"-tab, zie Taak 15).
- [ ] **Step 2: Draai** `node --test tests/beheer-gebruikers-logica.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de bestanden. `beheer.css` gebruikt de bestaande tokens; tabel wordt een kaartenlijst onder 600 px (gsm). `public/js/app.js` en `index.html` krijgen niets meer (de tab en view maakt `rol-schil.js` zoals in Taak 15).
- [ ] **Step 4: Draai** `node --test` en `npx playwright test e2e/beheer-gebruikers.spec.mjs --repeat-each=3` en de volledige e2e. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(beheer): beheerpagina en tab Gebruikers (logins T17)`.

---

### Task 18: Beheerpagina — tabs Instellingen, Activiteitenlog en Systeemstatus

**Model: sonnet.**

**Files:**
- Create: `public/js/schermen/beheer-instellingen.js`, `beheer-activiteit-logica.js`, `beheer-activiteit.js`, `beheer-systeemstatus.js`
- Modify: `public/js/schermen/beheer-tabs.js` (drie import-regels), `public/sw.js` (`SHELL`)
- Test: `tests/beheer-activiteit-logica.test.mjs`, `e2e/beheer-tabs.spec.mjs`

**Interfaces:**
- Consumes: Task 8, 9, 17; `valideerInstellingen` en `DEFAULT_SETTINGS` uit `instellingen-logica.js`/`instellingen.js` (hergebruik, geen kopie van de regels).
- Produces:
```js
// beheer-activiteit-logica.js (pure)
export function actieLabel(actie): string                          // 'login' -> 'Ingelogd', 'plannen' -> 'Ingepland', ... voor alle 18 namen uit het koppelvlak (inclusief de toevoegingen `instellingen-gewijzigd` en `wachtwoord-gereset`); onbekend -> de ruwe naam
export function bouwActiviteitUrl({ van, tot, gebruiker, actie }): string   // '/api/activiteit?...' met alleen ingevulde filters, encodeURIComponent
export function groepeerPerDag(items): [{ dag, items }]            // Brusselse kalenderdag, nieuwste eerst
export function standaardPeriode(nu): { van, tot }                 // laatste 30 dagen
```
  - Tab Instellingen: keuzelijst met alle gebruikers; formulier met de bestaande velden (startlocatie, duur, max per dag, werkuren, laatste start, max reistijd, tijdslot, werkdagen) en voor rol sales `bezoekDuurMin`; opslaan via `PUT /api/instellingen` met `gebruiker`; validatie met `valideerInstellingen`; leest met `GET ?gebruiker=<id>`.
  - Tab Activiteitenlog: filters persoon/actie/periode, lijst per dag, `escHtml` voor `naam`, `onderwerp` en `details`; "Meer laden" is niet nodig (max 1000 per server).
  - Tab Systeemstatus: Zoho-status (groen/rood met tijdstip), laatste fouten (tabel), mislukte rapporten (alleen lezen: de knop "Opnieuw versturen" komt na de merge van de upload-fix, zie open punt 4), knop "Vernieuwen".
  Elk tabmodul roept `registreerBeheerTab({ id, label, render })` aan bij het laden.

- [ ] **Step 1: Tests (RED).** Pure: `bouwActiviteitUrl({ van:'2026-10-01', actie:'login' })` is exact `'/api/activiteit?van=2026-10-01&actie=login'`, lege filters vallen weg, `gebruiker` met `&` wordt geëncodeerd; `actieLabel` kent alle 18 namen (de 16 uit het koppelvlak plus `instellingen-gewijzigd` → 'Instellingen gewijzigd' en `wachtwoord-gereset` → 'Wachtwoord gereset'); `groepeerPerDag` rond middernacht UTC naar de juiste Brusselse dag; `standaardPeriode(2026-10-08)` is `{ van:'2026-09-08', tot:'2026-10-08' }`. E2E (stubs): tab Instellingen toont de waarden van de gekozen gebruiker en een ongeldige duur (10) toont de bestaande foutmelding "Minimale interventieduur is 15 minuten" zonder PUT; opslaan stuurt `PUT` met `gebruiker`; sales-gebruiker toont het veld bezoekduur; Activiteitenlog filtert (de stub ontvangt de filter in de querystring) en toont `details` met `<` als tekst; Systeemstatus toont rood bij `zoho.ok:false` en de lijst mislukte rapporten, geen "Opnieuw versturen"-knop.
- [ ] **Step 2: Draai** `node --test tests/beheer-activiteit-logica.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de vier modules en de drie import-regels in `beheer-tabs.js`.
- [ ] **Step 4: Draai** `node --test` en `npx playwright test e2e/beheer-tabs.spec.mjs --repeat-each=3` en de volledige e2e. Verwacht: PASS.
- [ ] **Step 5: Commit** `feat(beheer): tabs Instellingen, Activiteitenlog en Systeemstatus (logins T18)`.

---

### Task 19: Testmodus-rolwisselaar, collega's alleen-lezen en rolspecs

**Model: sonnet.**

**Files:**
- Create: `public/js/schermen/rolwisselaar.js`, `e2e/logins-rechten.spec.mjs`
- Modify: `public/js/schermen/ticketdetail.js` (rond regel 120–126, de knoppen Aankomst/Foto's/Rapport), `public/js/schermen/rol-schil.js` (importeert `./rolwisselaar.js` statisch en toont de wisselaar), `public/index.html` (modulepreload), `public/sw.js` (`SHELL`)
- Test: `tests/rolwisselaar.test.mjs`

**Interfaces:**
- Consumes: Task 13 (`isLokaleDev()`, `testRolVoorHeader()`), Task 15.
- Produces:
```js
// rolwisselaar.js
export function rolwisselaarZichtbaar({ testModus, lokaleDev }): boolean     // enkel beide true
export function toonRolwisselaar(): void       // <select id="test-rol-wissel"> naast #test-badge: beheerder|planner|technieker|sales; bij wisselen localStorage 'blitz_test_rol' zetten en de pagina herladen
```
`auth-ik` onthult `lokaleDev`; `kern/sessie.js` (Taak 13) bewaart die vlag al en levert `isLokaleDev()` en `testRolVoorHeader()` (null bij `lokaleDev:false`); deze taak gebruikt ze enkel. In productie (`lokaleDev:false`) bestaat de wisselaar niet en stuurt de client toch `X-Blitz-Test-Rol` mee in `?test` (de server negeert die header, Review Focus 1); de client mag dat niet meer sturen als `lokaleDev` bij de eerste `auth-ik` `false` bleek (`testRolVoorHeader` geeft dan `null`).
`ticketdetail.js`: de knoppen `d-btn-arrival`, `d-btn-fotos`, `d-btn-rapport` worden enkel getoond als `showPlanBtns && magSchrijvenVoor(t.assignee)` (planner en beheerder altijd; technieker enkel eigen tickets; een collega-ticket toont het detail alleen-lezen).

- [ ] **Step 1: Tests (RED).** `rolwisselaar.test.mjs`: `rolwisselaarZichtbaar({testModus:true, lokaleDev:true})` true; alle andere combinaties false (`isLokaleDev` en `testRolVoorHeader` zijn al getest in Taak 13). E2E `logins-rechten.spec.mjs`: met `lokaleDev:true`-stub is de wisselaar zichtbaar, kiezen van "technieker" zet `blitz_test_rol` en na herladen draagt elk `/api`-verzoek `X-Blitz-Test-Rol: technieker`; met `lokaleDev:false` bestaat `#test-rol-wissel` niet en geen verzoek draagt `X-Blitz-Test-Rol`; technieker (Tim) opent een ticket van Roel: geen knoppen Aankomst/Foto's/Rapport, en wel bij een ticket van Tim; stub die `403 geen-recht` geeft op een schrijfactie toont een toast (de app crasht niet); planner heeft de knoppen bij elk ticket; per rol (beheerder, planner, technieker, sales) een controle van de zichtbare tabs en knoppen (tabel uit "Rechtentabel"). Een verlopen sessie: `auth-ik` eerst 200, daarna een `plan`-stub die eerst 401 geeft → het loginscherm verschijnt over de app (de app eronder blijft staan), na login wordt `plan` één keer herhaald; een openstaande rapport-outbox-regel (IndexedDB) blijft bewaard en wordt na het inloggen verstuurd (Review Focus 5); als een ander account inlogt (andere `id`) herlaadt de pagina.
- [ ] **Step 2: Draai** `node --test tests/rolwisselaar.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3: Implementeer** de wisselaar (statisch geïmporteerd door `rol-schil.js`, met modulepreload) en de aanpassing in `ticketdetail.js` (alleen de zichtbaarheidsregel; verder geen wijziging in dat bestand).
- [ ] **Step 4: Draai** `node --test` en de volledige `npx playwright test` (chromium en sw), `--repeat-each=3` op de nieuwe specs. Verwacht: PASS.
- [ ] **Step 5: Lokale verificatie in de browser** (`node blobs-local-bootstrap.mjs`, `http://localhost:3333/?test`): de wisselaar toont vier rollen, "technieker" verbergt Wachtrij/Route/Rapporten, "sales" toont het placeholder, "beheerder" toont "Beheer". Eenmalig ZONDER `?test`: eerste-beheerderscherm met `BEHEER_SETUP_CODE=lokaal`, daarna login, gebruiker aanmaken, uitloggen, blokkeren. Stop servers en testprocessen (skill `opruimen-na-werk`).
- [ ] **Step 6: Commit** `feat(client): rolwisselaar in lokale testmodus, collega's alleen-lezen, rolspecs (logins T19)`.

---

### Task 20: Afronding — changelog en documentatie

**Model: sonnet.**

**Files:**
- Modify: `CHANGELOG.md` (sectie "Refactor-tak — nog niet uitgebracht"), `docs/release-checklist-2.0.md`, `docs/bugs-en-open-punten.md`, `CLAUDE.md` (korte regel onder Stack)
- Create: `docs/logins-en-beheer.md` (instructie voor Brent in gewone taal)

- [ ] **Step 1: `CHANGELOG.md`.** Onder Added: inloggen met e-mail en wachtwoord voor beheerder, planner, technieker en sales; beheerpagina met gebruikers, instellingen, activiteitenlog en systeemstatus; herstelcodes en noodroute via Netlify; instellingen centraal op de server; een planner past de instellingen van techniekers aan en elke wijziging staat in het activiteitenlog. Onder Changed: elke actie wordt server-side op rol gecontroleerd; een technieker ziet collega's alleen-lezen. Geen versienummer wijzigen.
- [ ] **Step 2: `docs/logins-en-beheer.md`** (Nederlands, voor een niet-programmeur): welke Netlify-omgevingsvariabelen aan te maken (`SESSIE_GEHEIM` = lange willekeurige tekst van minstens 32 tekens, `BEHEER_SETUP_CODE` = tijdelijke code voor het eerste beheerdersaccount, optioneel `BEHEER_HERSTELSLEUTEL` van minstens 32 tekens), de livegangstappen (eerst eigen beheerdersaccount, dan de andere accounts, startwachtwoorden persoonlijk doorgeven), hoe herstelcodes bewaard worden (afdrukken, in een kluis), het noodscenario met `BEHEER_HERSTELSLEUTEL` (instellen, herstelpagina gebruiken, variabele daarna verwijderen), en de aanbeveling tweestapsverificatie op zijn Netlify-login; plus één zin over rechten: een planner past de instellingen van techniekers aan (elke wijziging staat in het activiteitenlog), de beheerder alle instellingen, sales en technieker enkel hun eigen. Expliciet: `BLITZ_LOKALE_DEV` NOOIT in Netlify instellen.
- [ ] **Step 3: `docs/release-checklist-2.0.md`.** Nieuwe sectie "Logins": variabelen ingesteld; `BLITZ_LOKALE_DEV` en `NETLIFY_DEV` niet gezet in Netlify (anders valt de bescherming van de testrol weg); één live-proef: verzoek met `X-Blitz-Test-Rol` zonder sessie geeft 401; `confirm-afspraak`-link uit een echte voorstelmail werkt zonder login; `planning-export` met zijn sleutel geeft nog data; Netlify-functie-timeouts voor `auth-login` (scrypt) ruim genoeg; na de merge van de upload-fix (v1.10.2): rijen in `rechten.js` voor `rapport-ontvangen` (alle intern, technieker enkel eigen), de achtergrondfunctie `rapport-verwerk-background` en de geplande `rapport-vangnet` (intern/geen gebruiker, met een eigen interne sleutel, want achtergrondfuncties zijn via hun URL bereikbaar), en de knop "Opnieuw versturen" op de tab Systeemstatus.
- [ ] **Step 4: `docs/bugs-en-open-punten.md`** (nieuwe punten, open): (1) `fotos`, `rapport`, `send-rapport`, `comment` en `mail-check` controleren niet of het ticket van de technieker is (alleen `ticketId` in de aanvraag); (2) sales-gebruikers mogen de TomTom-functies gebruiken; (3) tijdens het aanmaken van de eerste beheerder kan een gelijktijdige tweede aanvraag niet atomair uitgesloten worden (Blobs 8.2 heeft geen conditionele schrijfactie); (4) "Opnieuw versturen" op de systeemstatus volgt na de upload-fix; (5) de tab Rapporten blijft voor een technieker verborgen (`coord-only`), ook al mag hij zijn eigen rapporten lezen (server filtert al).
- [ ] **Step 5: `CLAUDE.md`** onder "Stack": één zin: "Login: eigen sessiecookie (`netlify/lib/auth.js`), rechten per functie in `netlify/lib/rechten.js`; elke nieuwe functie krijgt een rij daar en een `beveiligV1/V2`-wrapper (`tests/rechten.test.mjs` dwingt dit af)."
- [ ] **Step 6: Eindcontrole.** `node --test` en `npx playwright test` (chromium + sw) volledig groen; `git status` schoon op niet-gecommitteerde bestanden; `git diff refactor..HEAD --stat -- public/index.html public/js/app.js` toont enkel de minimale regels (Global Constraints); `git diff refactor..HEAD -- package.json public/sw.js | grep CACHE_NAME` is leeg. NIET mergen, NIET pushen: de opzichter beslist.
- [ ] **Step 7: Commit** `docs: logins en beheer — changelog, handleiding, checklist (logins T20)`.

---

## Open punten voor de opzichter (samengevat)

1. **Besloten** (ledger, 2026-10-08): E1–E7 en B1–B5 aanvaard; planners lezen techniekerinstellingen via `?overzicht=1` én wijzigen die van techniekers (gelogd als `instellingen-gewijzigd`, besluit Brent); TomTom-functies ook voor sales (E6).
2. De technieker ziet de tab "Rapporten" niet (blijft `coord-only` op de gsm), ook al mag hij zijn eigen rapporten lezen; de server filtert wel al. Gewenst, of de tab openzetten voor technieker?
3. `fotos`, `rapport`, `send-rapport`, `comment`, `mail-check`: per ticket niet server-afdwingbaar zonder Zoho-opzoeking per aanroep (kost tijd en quota). Aanvaarden voor nu?
4. De upload-fix (v1.10.2) zit nog op `main`: het plan werkt zonder en leest `verwerking.status` tolerant; na de merge zijn er rijen in `rechten.js` voor `rapport-ontvangen`, `rapport-verwerk-background`, `rapport-vangnet` nodig (staat in de release-checklist) en komt "Opnieuw versturen".
5. Eerste-beheerder-race en gelijktijdige `gebruikers`-wijzigingen zonder conditionele Blobs-schrijfactie: gemitigeerd met controle-na-schrijven en herhalen, niet atomair; `laatsteLogin` staat daarom in een eigen blob (`login-laatst`), zodat een login `gebruikers` nooit herschrijft.
6. Planner/technieker/sales-schermen die nog niet bestaan (sales) tonen een placeholder; het sales-plan registreert zijn tabs en start via `registreerTabs`/`registreerStart` in `rol-schil.js`.
