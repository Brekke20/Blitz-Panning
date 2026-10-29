# Onafhankelijke review van het plan "Server-snelheid" (2026-10-29)

Plan: `docs/superpowers/plans/2026-10-29-server-snelheid.md` (tak `server-snelheid`, commit `b0a7f26`).
Reviewer: onafhankelijk (schreef het plan niet). Methode: elke bewijsregel van het plan in de code nagelezen (client: `index.html`,
`app.js`, `rol-schil.js`, `kern/sessie.js`, `kern/instellingen-sync.js`, `kern/skelet.js`, `css/base.css`, `css/app.css`, `kalender.js`,
`ingepland.js`, `route.js`, `rapport-archief.js`, `inventaris.js`, `beheer-instellingen.js`, `beheer-performance.js`; server:
`tickets.js`, `lib/zoho.js`, `lib/auth.js`, `lib/beveiligd.js`, `auth-ik.js`, `auth-uitloggen.js`, `lib/gebruikers.js`, `lib/rechten.js`,
`planning-sinds.js`, `lib/zoho-agenten.js`, `netlify.toml`) en de betrokken tests en specs (`tests/server-tickets.test.mjs`,
`tests/server-zoho.test.mjs`, `e2e/skelet.spec.mjs`, `e2e/helpers.mjs`, `e2e/hemel-contrast.spec.mjs` en de geciteerde regels van
`kalender`, `weekend`, `route`, `wachtrij`, `kern`). Geen test, geen app en geen externe aanroep gedraaid.

## Oordeel in één oogopslag

**Het plan is eerlijk en goed onderbouwd; het mag gebouwd worden met de wijzigingen hieronder.** De analyse van waar het wachten
vandaan komt klopt (regelnummers hooguit 1-2 regels naast). Het grootste inhoudelijke gemis: **de huidige time-out van `tickets` is
vermoedelijk 10 s, niet "de standaard" in de zin van ruim**; dan is de time-out van 20 s een versoepeling die mislukte ladingen redt
en geen inperking. L1 (laadskelet) heeft twee fouten die eerst weg moeten: de volgorde van de stand `bekend` en een 150 ms-vertraging
in CSS die `page.clock` niet stuurt. C3b (tickets in het inline script) introduceert een nieuwe dubbele Zoho-lading.

| Taak | Oordeel | Bindende wijzigingen (kort) |
|---|---|---|
| S1 meten | APPROVE WITH CHANGES | statusverdeling van `tickets` uit observability erbij; geen `Server-Timing`-kop op open rijen en weigeringen; logbewaring nakijken |
| S2 O5 + time-out | APPROVE WITH CHANGES | 20 s blijft (niet 26), maar het vertrekpunt is ~10 s: framing en risico herschrijven; de `netlify.toml`-regel mag naar release A |
| S3 org-id bewaren | APPROVE | cache in `haalToegang`, niet in `haalOrgId` (Minor) |
| S4 Zoho-proef | APPROVE WITH CHANGES (bouwen ja; draaien pas na Brents ja én deze wijzigingen) | V7 niet tijdens werkuren zolang de editie onbekend is; poort in een eigen module; extra poorttests; liefst een aparte alleen-lezen Zoho-sleutel |
| L1 skelet Kalender/Ingepland/Route | APPROVE WITH CHANGES | `bekend` VÓÓR het toepassen; 150 ms met een JS-timer i.p.v. CSS-vertraging; tests in productiemodus |
| L2 skelet Rapporten/Inventaris | APPROVE WITH CHANGES | het vaste "Laden…" in `index.html:404` maakt `toondeLaden` bij de start onwaar |
| L3 ↺ "Bijwerken…" | APPROVE WITH CHANGES (klein; Brent beslist) | teller i.p.v. aan/uit (overlappende ladingen); poll draait de ↺ ook |
| C1 Beheer niet na elkaar | APPROVE | Minor: de gebruiker vooraf halen die ook echt gekozen wordt |
| A1a auth-ik één lezing | APPROVE WITH CHANGES | ontbrekende waarde = opnieuw lezen zoals nu (fail-safe), nooit stil `false` |
| Fase 2: Z1, Z3, R1, T1, K1 | voorwaardelijk APPROVE | opnieuw voorleggen met de S1- en S4-cijfers |
| Fase 2: Z2 | voorwaardelijk APPROVE WITH CHANGES | Z2-A: contact/account niet uit de cache; Z2-B: registerschrijven strikt best-effort |
| Fase 2: A1b / A1c | analyse correct; A1b eens met "waarschijnlijk niet"; A1c = Brent | geen |
| Fase 2: C3 | C3a APPROVE; **C3b REJECT zoals beschreven** | C3b geeft een extra volledige Zoho-scan bij een herlading tijdens de start |

---

## 1. Kloppen de oorzaken? (vraag 1)

**Ja.** Nagekeken:

- **Tickets-stroom.** `tickets.js:25` wacht op `/agents` vóór de paginering (het commentaar op `:24` zegt "parallel"); `:43-60` tot zes
  pagina's na elkaar zonder statusfilter; `:70-83` lock-step batches van 5; `zoho.js:56-60` vraagt bij elke aanroep `/organizations`
  (vastgelegd in `tests/server-tickets.test.mjs:303` en `tests/server-zoho.test.mjs:79`). Het antwoord hangt niet van de gebruiker af
  (`kern` leest `gebruiker` niet). Kleine aanvulling: de rechtenrij is `{ '*': INTERN, service: true }` (`rechten.js:29`), niet enkel
  `INTERN`.
- **Verborgen schil.** `index.html:2` (`data-schil="laden"`), `css/app.css:1204-1205` (tabs, persoonskiezer, `#hoofdinhoud`, ↺ en
  instellingen `visibility: hidden`), `rol-schil.js:140-161` (`await laadSessie()`, dan `await synchroniseerInstellingen`, pas dan
  `geefSchilVrij()` + `opstart()`). `KORTE_LIMIET_MS = 5000` (`kern/sessie.js:148`), `SYNC_BUDGET_MS = 7000`
  (`kern/instellingen-sync.js:33`). O1 staat op de tak (`index.html:72-99`). Klopt: met een bewaarde ticketkopie ziet de gebruiker
  toch enkel logo en hemel tot auth-ik en de sync klaar zijn.
- **Misleidende lege staten.** Kalender `kalender.js:626` (`<div class="day-empty">—</div>`) en de capaciteitskop `:609`/`:620`;
  Ingepland `ingepland.js:128`; Route `route.js:244`. `planning` wordt enkel uit de tickets gezaaid (`app.js:516-547`), dus zonder
  kopie is de Kalender echt leeg tot de tickets er zijn.
- **Beheer na elkaar.** `beheer-instellingen.js:30` (gebruikers) → `:208` (`await laad()`) → `:112` (instellingen); Performance
  `beheer-performance.js:57` (`await laadCss()`) vóór `:252`.
- **Rapporten / Inventaris.** `app.js:348` en `:948` (archief bij de start en bij elk openen), `app.js:949-956` + `:101-114`
  (inventaris bij elk openen, 30 s-poll), `index.html:404` en `:411`.

**Wat ontbreekt in de oorzakenanalyse:** de time-out van `tickets` vandaag (zie 4). Met p90 7,8 s en p99 10,6 s, en drie bronnen in de
repo die de Netlify-standaard op ~10 s zetten (`docs/azure-migratie.md:61`; `docs/superpowers/specs/2026-10-02-etappe7-technieker-design.md:115`:
"de functies zonder eigen limiet hebben 10 s"; `metingen-live-2026-10-29.md:40`), worden de traagste ladingen vermoedelijk al op de
server afgebroken. Voor de gebruiker is dat "Kon tickets niet laden" en een nieuwe poging na 30 s (`_lastTicketLoad` enkel bij succes,
`app.js:572`, pollcontrole `:825`): exact "wachten tot alles erop staat".

---

## 2. Per taak

### S1 — Meten: APPROVE WITH CHANGES

**Goed:** de seam die enkel in een Netlify-runtime meet, zodat alle karakteriseringstests byte-gelijk blijven; `AsyncLocalStorage` per
verzoek; geen persoonsgegevens in de logregel; de beslistabel.

**Important**
- **I-S1-1 Statusverdeling ontbreekt.** Het plan wil de 10 s-vraag (zie 4) pas na een release beantwoorden. Dat kan vandaag, alleen
  lezen: de statuscodes van `/api/tickets` in Netlify observability (hoeveel 5xx/502/504, en bij welke duur). Fix: als stap 0 van S1
  (geen code) en als kolom in §8.

**Minor**
- **M-S1-1 Kop niet op open rijen en weigeringen.** `confirm-afspraak` is een open, publieke klantlink (`rechten.js:91`) en open rijen
  lopen wel door de wrapper (`beveiligd.js:47`: `regel === 'open'` roept de handler aan; het plan zegt dat ze "buiten deze stap" vallen,
  dat klopt niet voor de wrapper). Een publiek `Server-Timing` met `zoho;desc="n=…"`, `koud` en precieze `kern`-tijden op
  `auth-login` (als die gewrapt is) of een 401 geeft onnodig informatie. Fix: de kop enkel op antwoorden voor een ingelogde gebruiker
  (`b.gebruiker` gezet); de logregel overal.
- **M-S1-2** Definieer of `n` de token- en org-aanvraag meetelt (de test "k = exact het aantal nep-fetch-aanroepen naar Zoho" hangt
  ervan af). En noem dat "tot de antwoordkop" het lezen van de body (100 tickets per pagina) niet meetelt: `kern − zoho` is dan niet
  enkel eigen rekenwerk.
- **M-S1-3 Logbewaring.** 1-2 werkdagen logregels verzamelen vraagt dat Netlify ze zo lang bewaart; dat hangt van het abonnement af.
  Nakijken vóór de release (hoort bij Brents vraag 4); anders volstaat de `Server-Timing`-kop met een handmatige steekproef.

### S2 — O5 + time-out: APPROVE WITH CHANGES

**Goed:** precies O5 met de bindende wijzigingen van de vorige review. Nagekeken dat de bestaande tests ONGEWIJZIGD groen kunnen
blijven met een glijdend venster: "batches van vijf" (`server-tickets.test.mjs:192`, `max === 5`, `afgerond` in volgorde omdat elke
nepaanroep één tik duurt), "ticketdetail-fout" (`:255`, drie ids < 5, dus alle drie verstuurd), "netwerkfout op een paginaaanvraag"
(`:294`, `calls.length === 4`: agents en pagina 0 tegelijk blijven 4 aanroepen, mits pagina 0 een lege `catch`-aftakking heeft).

**Important**
- **I-S2-1 Het vertrekpunt is ~10 s, niet "standaard" (zie 4).** §1d, S2 punt 4 en §6 ("een lading die vandaag na 20-26 s zou lukken,
  faalt voortaan op de server") gaan uit van een ruime huidige limiet. Is de standaard 10 s, dan is `timeout = 20` een VERSOEPELING:
  ladingen van 10-20 s die nu mislukken, lukken voortaan (zichtbaar beter), en ze doen 10 s langer Zoho-werk. Fix: stap 0 van S1
  beslist het; herschrijf §1d/§6; en zet de ene `netlify.toml`-regel `[functions.tickets] timeout = 20` (met de node-test die hem
  leest) los van de codewijziging van S2 al in **release A**: het is de goedkoopste betrouwbaarheidswinst van het plan, zonder
  Zoho-risico.
- **I-S2-2 "Nooit meer dan 5 tegelijk" geldt per aanroep, niet voor de portal.** Twee gebruikers die tegelijk laden = 10; vlak na een
  lading volgt `planning-sinds` met ook batches van 5 (`planning-sinds.js:15`, `:105-108`). Dat is vandaag al zo (S2 verandert de piek
  niet, wel het gemiddelde: het venster houdt 5 bezet i.p.v. af te bouwen per batch). Een 429 op één detail geeft de hele lading 500
  (geen herpoging). Fix: zo in het risico zetten, en na release B in de logs zoeken naar `TOO_MANY_REQUESTS` (staat al in §6).

### S3 — org-id bewaren: APPROVE

**Minor**
- **M-S3-1** Bewaar het org-id in `haalToegang` (naast het token) en laat `haalOrgId` zelf ongecachet: dan blijft
  `tests/server-zoho.test.mjs:79` ("haalOrgId … niet gecachet") ongewijzigd en schuiven enkel de reeksen over twee aanroepen in één
  geladen module (`server-tickets.test.mjs:303`). Noem `server-zoho.test.mjs` hoe dan ook in de acceptatie.
- **M-S3-2** Winst enkel voor functies met een instantie op moduleniveau of in een eenmalig aangeroepen `maakHandler` (alle huidige
  Zoho-functies, nagekeken); `systeemstatus` maakt bewust per aanroep een nieuwe instantie en verandert niet. Dat is goed zo.
- **M-S3-3** Een cache van de agentenlijst (id → naam) in de warme instantie zou de `/agents`-aanroep ook sparen, maar na S2 loopt die
  parallel (geen tijdwinst), `maakAgentenCache` (`lib/zoho-agenten.js:35`) bewaart enkel NAMEN van ACTIEVE agenten (tickets heeft id →
  naam van alle agenten nodig) en bij ~75 ladingen per dag is de instantie vaak koud. Niet doen; Z3 volstaat.

### S4 — Zoho-proef: APPROVE WITH CHANGES

Zie 3 hieronder (de veiligheid apart besproken). Bouwen (script + poorttest) mag meteen; draaien enkel na Brents ja én na de
bindende wijzigingen I-S4-1 t/m I-S4-3.

### L1 — Skelet in Kalender, Ingepland, Route: APPROVE WITH CHANGES

**Critical**
- **C-L1-1 `bekend` moet vóór het toepassen gezet worden, niet erna.** Het plan zet `_ticketsStand = 'bekend'` "na het toepassen van de
  kopie (`:598`) of een geslaagde lading (`:626`)". Maar `applyTicketsData` tekent synchroon: de transactie (`app.js:510-557`) spoelt
  aan het einde en de abonnementen (`app.js:761`, `:762`, `:764-771`) roepen dan `renderKalender`, `renderGepland` en `renderRouteList`
  aan, NOG vóór de regel erna. Die renders zien `ticketsBekend() === false` en tekenen het skelet waar de lege staat hoort (een dag
  zonder stops, een lege week in Ingepland, een lege dag in Route). Het skelet blijft dan staan tot de volgende toestandswijziging, en
  met O3 (`kalIsVers`, `kalender.js:63-66`; `activeerGepland`, `ingepland.js:47-50`) zelfs bij het terugkeren naar de tab. Fix: zet
  `'bekend'` direct vóór `applyTicketsData(cached)` (`:598`) en vóór `applyTicketsData(data, …)` (`:626`). Test: een technieker met 0
  geplande tickets deze week (productiefixture, stub vertraagd) → na de lading staat "Geen geplande service deze week" en geen skelet,
  ook na tab weg en terug.
- **C-L1-2 De 150 ms in CSS is niet deterministisch te testen.** `page.clock` (startApp zet hem altijd, `helpers.mjs:364`) bestuurt
  `Date`, timers en `requestAnimationFrame`, maar niet de tijdlijn van CSS-animaties: een `animation-delay` van 150 ms loopt in echte
  tijd. "Op t = 100 ms geen zichtbaar skelet" kan dus falen op een trage pc (de echte tijd is al voorbij 150 ms) en "op t = 250 ms
  zichtbaar" kan slagen of falen los van de klok. Fix: één JS-timer per eerste lading in `app.js`
  (`setTimeout(…, max(0, 150 − (nu − _ticketsLaadStart)))`) die een attribuut zet, bv. `html[data-tickets-laden="zichtbaar"]`, en CSS die
  het skelet van deze drie schermen enkel onder dat attribuut toont (`opacity`, geen beweging). Hertekenen tijdens het laden begint dan
  niets opnieuw, en de test stuurt alles met `page.clock.runFor`. `--skelet-vertraging` per render vervalt.

**Important**
- **I-L1-1 De testscenario's bestaan niet in `?test`.** In testmodus komen de tickets altijd na 400 ms uit `DUMMY_DATA`
  (`app.js:604-606`): er is geen kopie, geen vertraagde stub en nooit een mislukking. "Met een bewaarde kopie", "een poll met een
  vertraagde stub" en "een mislukte eerste lading (stub 500)" moeten in `e2e/productie/` met `startAppProductie`, `zetAntwoord`,
  `verwachtHttpFout` (CLAUDE.md, productiemodus-tests). Bovendien wacht `startApp` op `#cnt-tickets` (`helpers.mjs:369`): de gewone
  `?test`-specs zien het skelet zelden (enkel bij een technieker met 0 te plannen, waar `toHaveText('0')` meteen slaagt). Fix: de
  L1-specs in `e2e/productie/` plus `e2e/productie/opstart.spec.mjs` en `--project=sw` (offline start met kopie) in de lijst.

**Minor**
- **M-L1-1 Reduced motion.** Leg de verschijnregel op de `.skelet`-wortel, nooit op `.skelet-blok`: `base.css:352-354` zet daar
  `animation: none !important`, wat een vertraging via animatie zou doden (dekking blijft 0, skelet nooit zichtbaar). De algemene regel
  `base.css:271-277` raakt `animation-delay` niet. Met de JS-timer van C-L1-2 vervalt dit, maar voeg de test toe: onder
  `reducedMotion: 'reduce'` is het skelet op t = 250 ms WEL zichtbaar (niet enkel `animation-name: none` op de blokken).
- **M-L1-2 Kalenderkolommen met andere items.** Een dag met een eigen afspraak of rapportkaart heeft geen "—" (`kalender.js:667`
  haalt het weg). Kies expliciet: skeletkaartjes in elke kolom (ook naast afspraken), anders leest een dag met enkel een afspraak als
  "geen tickets". Aanrader: in elke kolom één skeletkaartje onderaan.
- **M-L1-3 Getroffen specs.** De themaversie van de lege tekst staat in `e2e/versiering-bewegingen.spec.mjs:167`, niet in
  `e2e/versiering.spec.mjs`. In `hemel-contrast.spec.mjs` raakt L1 ook regel 242 (Ingepland) en L2 regel 244 (Rapporten); die
  schermen wachten via `startApp` al op de tickets, dus de echte reden om `@contrast` te draaien is de wijziging aan `css/base.css`.

### L2 — Rapporten en Inventaris: APPROVE WITH CHANGES

**Important**
- **I-L2-1 Het vaste "Laden…" in `index.html:404` maakt het skelet bij de start onmogelijk.** `toondeLaden = !body.children.length`
  (`rapport-archief.js:58`) is bij de eerste lading ONWAAR, want het vak heeft al dat ene kind uit `index.html`. Met
  `isLeeg: () => toondeLaden` verschijnt er bij de start dus nooit een skelet; enkel na een eerdere fout of lege tekening. Fix: de
  voorwaarde wordt "er is nog nooit een lijst getekend" (`_archiefVersie === null` of een eigen vlag) en het vaste "Laden…" in
  `index.html:404` wordt het element in `verberg`; `meldLaadFout` (`:36-38`) blijft ongewijzigd met `toondeLaden || _archiefVersie === null`.
  Test: eerste opening van Rapporten met een trage stub → skelet na 150 ms.

**Minor**
- **M-L2-1** Inventaris met een eigen kopie maar zonder ticketkopie: `loadInventaris` zet de kopie synchroon (`inventaris.js:42-43`),
  maar getekend wordt pas na het verzoek (`app.js:337-340`) of na de eerste ticketlading (abonnement `app.js:764-767`). Teken de kopie
  meteen; dat is meer waard dan een skelet.

### L3 — ↺ "Bijwerken…": APPROVE WITH CHANGES (klein; Brent beslist)

**Minor**
- **M-L3-1 Overlappende ladingen.** De poll roept een NIET-stille lading (`app.js:826`, `loadTickets()`), daarnaast "Vernieuwen" en het
  `online`-event. Een klasse zetten en in de `finally` weghalen stopt de ↺ terwijl een tweede lading nog loopt. Fix: een teller (aan bij
  > 0). En zeg Brent dat de ↺ dan ook elke 5 minuten een paar seconden draait.
- **M-L3-2** De ↺ is een tekstteken in de knop (`index.html:268`): zet het in een `<span>` voor de draaiing (enkel daarop `transform`).
  `aria-busy` op een knop wordt niet voorgelezen; zet `aria-label` tijdelijk op "Vernieuwen, bezig met bijwerken".

### C1 — Beheer niet na elkaar: APPROVE

**Minor**
- **M-C1-1** Haal vooraf de gebruiker die ook gekozen wordt: de bewaarde keuze (`sessionStorage` `blitz_beheer_instellingen_persoon`)
  als die er is, anders de eigen id. Een weggegooide belofte krijgt een `catch`-aftakking; twee gelijktijdige 401's openen het
  inlogscherm één keer (bestaand gedrag van de fetch-omhulling nakijken).

### A1a — auth-ik één lezing: APPROVE WITH CHANGES

**Important**
- **I-A1a-1 Fail-safe bij een ontbrekende waarde.** `vereisGebruiker` heeft paden zonder record: `vasteGebruiker` (`auth.js:56-58`), de
  testrol in lokale dev (`:61-68`) en de servicesleutel (`:72-80`). Geeft de wrapper `moetWachtwoordWijzigen` door, dan moet auth-ik bij
  `undefined` terugvallen op de huidige lezing (`auth-ik.js:24`), niet stil `false` gebruiken: anders kan een later pad dat het veld
  vergeet het verplichte wachtwoordscherm overslaan (de server weigert dan elk ander verzoek met `wachtwoord-wijzigen`, de gebruiker zit
  vast). Enkel het recordpad geeft een expliciete boolean. Test: met record → één `get('gebruikers')`; zonder doorgegeven waarde →
  zoals nu; `moetWachtwoordWijzigen: true` komt door. Kijk ook na dat `zetKernSpyVoorTests` (`beveiligd.js:85`, `:97`) en
  `tests/server-beveiliging.test.mjs` geen exacte argumentlijst vergelijken.

**Minor**
- **M-A1a-1 Eerlijke winst.** Met O1 lopen auth-ik en `instellingen?overzicht=1` tegelijk; de start wacht op de traagste. A1a helpt
  enkel als auth-ik de traagste is. S1 toont dat (`blobs-auth` en `kern` van beide).

### Fase 2

- **Z1** (statusfilter): voorwaardelijk APPROVE na V2/V3. Nagerekend: de vijf namen met komma's zijn 107 tekens; de drie huidige 70
  (URL-gecodeerd ongeveer 88). Test ook of Zoho de limiet op de gecodeerde of de gedecodeerde waarde toepast.
- **Z2-A** voorwaardelijk APPROVE WITH CHANGES.
  - **I-Z2-1 Contact en account komen uit gekoppelde records.** `mapTicket` leest `t.contact.name/email/phone` en `t.account.name`
    (`tickets.js:98-103`). Wijzigt iemand het telefoonnummer van een CONTACT, dan verandert de `modifiedTime` van het ticket
    vermoedelijk niet: de cache toont dan een oud nummer, zonder einde. Fix: contact en account uit de lijst nemen
    (`include=contacts`, V1) en enkel `cf` uit de cache; of V8 uitbreiden met een contactwijziging. Plus een maximale ouderdom per regel
    (bv. 24 u) als vangnet.
  - Minor: de Blobs-lezing en -schrijving kosten zelf twee Blobs-rondes (H1); trek ze van de winst af. Ruim regels van verdwenen ids op.
    De blob bevat klantgegevens (zelfde velden als `blitz_tickets_cache` op elk toestel): aanvaardbaar, maar vermelden.
- **Z2-B** voorwaardelijk APPROVE WITH CHANGES.
  - **I-Z2-2 Registerschrijven mag een schrijfactie nooit laten mislukken.** Het register komt in `plan`, `plan-datum`, `propose`,
    `annuleer`, `confirm-afspraak`. Een Blobs-fout daar mag status en body niet veranderen (strikt `try/catch`, NA de Zoho-schrijfactie),
    anders volgt een 500 na een al verstuurde mail en kan de client opnieuw proberen: dubbele mail of dubbele planning. Test per functie:
    register-store gooit → zelfde antwoord als nu, Zoho-aanroepen gelijk.
- **Z3**: voorwaardelijk APPROVE (na V5); na S2 enkel krediet en één verbinding.
- **A1b / A1c**: de veiligheidsanalyse klopt. Nagekeken: afmelden verhoogt `sessieVersie` niet (`auth-uitloggen.js:22`, enkel de cookie
  gewist); blokkeren en rolwijziging wel (`lib/gebruikers.js:137`), wachtwoordreset en "overal uitloggen" ook
  (`functions/gebruikers.js:164`, `:185`). "Kan enkel ten onrechte toelaten, nooit ten onrechte weigeren" is juist. Eens met: A1b
  waarschijnlijk niet bouwen; A1c enkel met Brents ja op het venster.
- **R1, T1, K1**: correct als vraag of na meting. T1 raakt een geheim: opus-review, zoals gezegd.
- **C3**: C3a APPROVE. **C3b REJECT zoals beschreven.**
  - **I-C3-1 C3b voegt een dubbele Zoho-lading toe.** `kern/sessie.js:112` herlaadt de pagina als auth-ik een andere gebruiker geeft dan
    de bewaarde. Vandaag is `/api/tickets` op dat moment nog niet gestart; met C3b loopt de vroege lading al, de herlading start een
    tweede: twee volledige scans. Hetzelfde bij het opstartherstel (`index.html:102-113`, `location.reload()` na een mislukte module) en
    bij een tab die tijdens de start sluit (de functie loopt door, zie de 499's in de metingen). "Een dubbele lading blijft enkel mogelijk
    bij een herlading van de pagina (zoals vandaag)" klopt dus niet: C3b maakt die herladingen duur. Enkel C3a, of C3b pas met deze drie
    scenario's in `vroege-start.spec.mjs` en een gemeten winst die het rechtvaardigt.

---

## 3. De Zoho-proef (S4): veilig genoeg? (vraag 3)

De basis is goed: enkel GET naar `desk.zoho.eu`, één token-POST, hoogstens 2 tegelijk, stoppen bij 429 zonder herpoging, plafond 150,
uitvoer zonder waarden, weigeren zonder vlag. Wat ontbreekt:

**Important**
- **I-S4-1 Gelijktijdigheid sluit niet op een Free-editie.** De app doet zelf al 5 tegelijk per lading (`tickets.js:70-83`), plus
  `planning-sinds` (5); 5 + 2 = 7 > 5. V7 ("elke 15 min over een werkdag") valt gegarandeerd samen met polls van techniekers: dan kan
  de APP `TOO_MANY_REQUESTS` krijgen en ziet een technieker "Kon tickets niet laden". Fix: (a) eerst één run V9 + V1-V6 buiten de
  werkuren, met gelijktijdigheid 1; (b) V7 pas als de editie ≥ Standard (10) bekend is, of V7 afslanken tot lijst + search (geen
  details: de status vergelijken kan op de lijst; ~4-5 aanroepen per run) met gelijktijdigheid 1.
- **I-S4-2 Tokens.** Elke run vraagt een nieuw access token met DEZELFDE refresh-token als productie. Zoho begrenst het aantal tokens
  per refresh-token (per tijdsvenster en tegelijk geldig; het plan noemt dat zelf bij T1 "nakijken"). Veertig runs per dag erbovenop
  kunnen een warm productietoken ongeldig maken of de tokenaanvraag van een koude functie weigeren ("Sessie met Zoho verlopen"). Fix:
  V7 als één proces dat zijn token 55 min hergebruikt; liefst een **aparte Zoho Self Client met enkel leesrechten**
  (`Desk.tickets.READ`, `Desk.search.READ`, `Desk.basic.READ`): dan is schrijven ook op de Zoho-kant onmogelijk en raakt de proef de
  productiesleutel niet. Dat vraagt Brent één handeling (vraag 1 hieronder).
- **I-S4-3 Poort en tests.** (a) De poort in een eigen module zonder bijwerkingen (bv. `scripts/zoho-proef-poort.mjs`) die het script
  en de test importeren; de test mag `scripts/zoho-proef.mjs` nooit importeren. (b) Test: zonder `--ik-heb-toestemming` gebeurt er
  GEEN enkele fetch (de taak vraagt dit; de acceptatie noemt het niet). (c) `redirect: 'error'` op elke fetch (een omleiding mag de
  hostcontrole niet omzeilen). (d) Een lijst toegelaten paden (`/organizations`, `/agents`, `/tickets`, `/tickets/{id}`,
  `/tickets/search`), niet enkel de host. (e) Stoppen ook bij `errorCode: TOO_MANY_REQUESTS` in de body met een andere status, bij 3
  opeenvolgende 5xx, en als `X-Rate-Limit-Remaining-v3` onder een marge zakt. (f) De token-POST enkel met `grant_type=refresh_token`,
  hoogstens één per run (V7-proces: één per 55 min).

**Minor**
- Nooit een responsbody, URL met ticket-id, token of omgevingsvariabele printen; de buitenste `catch` print enkel de foutnaam. V5 geeft
  enkel "gelijk / niet gelijk: aantal", geen agentnamen. De toestand voor V8 (id's + `modifiedTime` + een hash van de velden, geen
  waarden) buiten de repo.
- Een agent die het script draait, ziet de Zoho-sleutels in zijn omgeving: hij mag ze nooit tonen of loggen. Nog een reden voor een
  aparte alleen-lezen sleutel.
- Mogelijke extra vraag V10 (enkel GET): kan `GET /tickets` met een Zoho-weergave (`viewId`, een opgeslagen filter op de vijf statussen)?
  Dat zou Z1 zonder de grens van 100 tekens en zonder twijfel over custom statussen geven, en de lijst blijft realtime. Na te kijken in
  de documentatie; Brent of een beheerder maakt de weergave.

---

## 4. Time-out 20 s of 26 s (vraag 4)

**Oordeel: 20 s, maar om een andere reden dan het plan geeft.**

- Vandaag: geen `[functions.tickets]` in `netlify.toml`, dus de Netlify-standaard. De eigen documentatie zegt drie keer ~10 s (zie 1).
  p99 10,64 s (edge-duur, dus inclusief ~1 s overhead) past bij afbreken op 10 s. Als dat klopt, is elke keuze (20 of 26) een
  versoepeling en geen inperking.
- 20 boven 26: de client breekt af na 20 s, gemeten vanaf de start van de fetch tot de antwoordkop (`kern/netwerk.js:3`). De functie
  start later (edge, koude start), dus bij 20 s op de server is hooguit ~1 s Zoho-werk verspild; bij 26 s tot ~7 s, en een mislukte
  lading wordt 30 s later opnieuw geprobeerd (`app.js:825`), terwijl de vorige nog op de server loopt. 26 zou bovendien `tickets` in
  de lange klasse van `kern/netwerk.js:4` vragen (clientwijziging). Met 20 geen clientwijziging.
- Bindend: §1d, S2 en §6 herschrijven met het echte vertrekpunt (na stap 0 van S1), en de regel naar release A (I-S2-1).

---

## 5. Laadskeletten (vraag 5)

| Eis | Plan | Oordeel |
|---|---|---|
| Geen flits (150 ms) | `toonSkelet` voor schermen met een verzoek (goed); CSS-vertraging voor de abonnementsschermen | CSS-vertraging vervangen door één JS-timer (C-L1-2) |
| Nooit over getoonde gegevens | enkel bij `ticketsBekend() === false` / `isLeeg` | goed, mits `bekend` vóór het toepassen (C-L1-1) |
| `aria-busy`, skelet `aria-hidden`, één `role="status"` | ja | goed |
| Geen lay-outsprong | maat van een echte `.cal-ticket`; e2e op balk en eerste kaart | goed; let op `.skelet-kaarten` (raster 240 px, `base.css:334`) in Ingepland en Route |
| Reduced motion | bestaande regel | verschijnregel op de wortel, test dat het skelet zichtbaar wordt (M-L1-1) |
| Getroffen tests | lijst in §3d | aanvullen: productiespecs en `--project=sw` (I-L1-1), `versiering-bewegingen.spec.mjs:167`, `hemel-contrast` 242/244 (M-L1-3); `@contrast` apart `--workers=1` omdat `base.css` wijzigt |

De rangschikking L1 > L3 > L2 is juist: L1 haalt een misleidende boodschap weg, L3 zegt op het dagelijkse toestel dat er nog iets komt.

---

## 6. Volgorde en "Niet doen" (vraag 6)

- **Volgorde.** Goed, met één verschuiving: de `netlify.toml`-regel van S2 (`timeout = 20`) naar release A (I-S2-1). S3 mag ook in A
  (één kleine wijziging, geen Zoho-onzekerheid; de vóór-meting is de edge-duur van vandaag); het plan houdt hem in B om hem apart in S1
  te zien. Beide verdedigbaar; niet bindend.
- **Grotere, veilige winst die ontbreekt?** Geen grote. De echte winst op `tickets` blijft Z2 (na S4). Kleine aanvullingen: de statusverdeling
  (I-S1-1, gratis), de inventariskopie meteen tekenen (M-L2-1), en V10 (`viewId`) als alternatief voor Z1.
- **"Niet doen"**: alle twaalf punten eens. Toevoegen:
  13. V7 van de Zoho-proef tijdens werkuren zolang de editie onbekend is (I-S4-1).
  14. Een register- of cacheschrijving die het antwoord van een Zoho-schrijffunctie kan veranderen (I-Z2-2).
  15. C3b zonder de herlaadscenario's (I-C3-1).

---

## 7. Vragen aan Brent (vraag 7)

De acht vragen zijn volledig voor wat het plan beslist. Voorstellen om ze voor een niet-programmeur beantwoordbaar te maken:

1. **Zoho-proef (S4)**: zeg wat er nodig is. "Mag een script enkel LEZEN in Zoho Desk (niets wijzigen, max ~150 aanroepen per keer,
   buiten de werkuren)? Het liefst met een aparte Zoho-sleutel die enkel mag lezen: wil je die aanmaken als we je stap voor stap
   uitleggen hoe, of gebruiken we de bestaande sleutel?" Plus: "Kan het één keer gebeuren dat een technieker tijdens de proef 'Kon
   tickets niet laden' ziet? Dan stoppen we meteen."
2. **Zoho-editie**: zeg waar hij het vindt (Zoho Desk → Setup → abonnement / Subscription), of dat de proef (V9) het zelf kan aflezen.
3. **Oude statusnamen**: pas vragen als V3 toont dat ze nog voorkomen; dan als "Mogen tickets met status X genegeerd worden?"
4. **Netlify**: welk abonnement (Netlify → Team → Billing), want dat bepaalt de regio én hoe lang de logs bewaard blijven (S1).
5-6. Goed geformuleerd.
7. **Laadskeletten**: toevoegen dat de ↺ ook bij de automatische verversing (elke 5 minuten) even draait.
8. **K1**: concreet maken: "De app opent na hoogstens 2 s met je laatst bewaarde gegevens. Heel zelden (account geblokkeerd, sessie
   verlopen) verschijnt daarna toch het inlogscherm. Of: zoals nu tot 5 s wachten."
9. **Nieuw, ter controle van het 10 s-vermoeden**: "Zie je soms 'Kon tickets niet laden', of een wachtrij die pas na een halve minuut
   gevuld raakt?"

---

## Eindoordeel

**APPROVE WITH CHANGES.** Bouwen in de volgorde van het plan, met:

- Critical (vóór L1 gebouwd wordt): C-L1-1 (`bekend` vóór `applyTicketsData`), C-L1-2 (JS-timer i.p.v. CSS-vertraging).
- Important: I-S1-1 (statusverdeling), I-S2-1 (vertrekpunt 10 s; time-outregel naar release A), I-S2-2 (gelijktijdigheid per aanroep),
  I-S4-1/2/3 (proef: gelijktijdigheid, tokens, poort), I-L1-1 (tests in productiemodus), I-L2-1 (vast "Laden…"), I-A1a-1 (fail-safe),
  I-Z2-1/2 (fase 2), I-C3-1 (C3b).
- Opus-review zoals het plan voorstelt (S1, S2+S3, S4-poort, L1, A1a; fase 2 per taak).

**Enkel in productie aantoonbaar** (manuele controle na de release): `Server-Timing` zichtbaar in DevTools en `[meting]`-regels zonder
persoonsgegevens; `tickets` zonder 5xx rond 10 s na de nieuwe time-out; op een gsm zonder kopie (andere gebruiker op een testtoestel)
een skelet in Kalender, daarna de tickets, en bij een lege week de gewone tekst; de ↺ draait tijdens het verversen en stopt erna.
