# Onafhankelijke review van het optimalisatieplan (2026-10-29)

Plan: `docs/superpowers/plans/2026-10-29-optimalisatie.md` (tak `optimalisatie-2.5.1`, commit `d7aa2fd`).
Reviewer: onafhankelijk (schreef het plan niet). Methode: elke bewijsregel van het plan in de code nagelezen, de baseline-JSON's
nagekeken, `node --test tests/server-tickets.test.mjs tests/window-namen.test.mjs tests/sw-schil.test.mjs` gedraaid (90/90 groen
op de basis). Geen e2e en geen meetscripts gedraaid.

## Oordeel in één oogopslag

**Het plan is goed onderbouwd en mag grotendeels gebouwd worden, maar niet volledig vannacht.** De bewijsregels kloppen
(regelnummers op een paar plaatsen een paar regels naast, inhoud juist). Twee onderdelen zijn te riskant of te zwak onderbouwd
voor een onbewaakte nacht: **O4 (tickets vroeg ophalen + identieke poll overslaan) niet vannacht**, en **O6 deel 2 (identiek
rapportantwoord niet hertekenen) enkel in een smallere vorm**, omdat het de knopvergrendeling van het rapportmailpad raakt.
O3 stap B ook niet vannacht.

| Taak | Oordeel | Bindende wijzigingen (kort) |
|---|---|---|
| O1 vroege auth-ik/instellingen | APPROVE WITH CHANGES | instellingen vroeg enkel met bewaarde sessie; vroeg overzicht enkel bij zelfde gebruiker-id en zonder tussenliggend inlogscherm; extra tests (zie O1) |
| O2 kaarten zonder vervaging (gsm) | APPROVE WITH CHANGES + Brent beslist bij release | aparte, los terug te draaien commit; pixeltest ook op een Kalenderkaart; meten niet tijdens andere testruns |
| O3 Kalender/Ingepland niet opnieuw opbouwen | APPROVE WITH CHANGES (enkel stap A) | sleutel uitbreiden (venstermaat, rechten); test voor ELKE toestandssleutel; opus-review; stap B niet vannacht |
| O4 tickets vroeg + poll overslaan | REJECT (vannacht) | volgende ronde, na O1 in productie gemeten |
| O5 server tickets: agents parallel, glijdend venster | APPROVE WITH CHANGES | foutvolgorde exact behouden, geen onafgehandelde rejections; productiecontrole van de duur |
| O6 rapportarchief robuust | APPROVE WITH CHANGES | deel 1 ja; lagere versie stil negeren; deel 2 enkel `renderKalender()` overslaan, nooit `renderRapportArchief()` |
| O7 geocache in geheugen | APPROVE | geen |
| O8 routekaart pas bij Route | APPROVE WITH CHANGES (laagste prioriteit) | volledige toestand naspelen i.p.v. "laatste opdracht"; foutafhandeling bij het late maken; extra tests |

## Algemene, bindende procesregels

1. **Isolatie per implementeerder.** Drie agents tegelijk in één werkmap geeft botsende bewerkingen en `index.lock`-fouten. Elke
   taak in een eigen worktree/tak van `optimalisatie-2.5.1`, de opzichter voegt samen. (OneDrive: worktrees met `node_modules`
   buiten de synchronisatie houden, zie CLAUDE.md.)
2. **Meten nooit tijdens andere testruns.** Met 3 agents tegelijk draaien er Playwright-runs naast elkaar op een trage pc; een
   `meet-*`-run onder die last is ruis (vooral `meet-snelheid`-beelden en `meet-interactie`-ms). Per taak: functionele tests ja,
   meten enkel als geen andere agent test (één "meetslot" bij de opzichter), anders de meting overlaten aan de eindmeting.
3. **Drempels binnen de ruis.** `meet-laden` bij 0 ms is erg wisselvallig (koud: muurtijden 631-1955 ms in de baseline). Het
   criterium "bij 0 ms hoogstens 5 % boven de basis" (O1, O4, O8) vervangen door de 10 %-regel van sectie 5, met `--runs=7`; een
   overschrijding betekent eerst opnieuw meten, pas daarna terugdraaien. De 150 ms-rijen zijn stabiel (±1 %): die criteria blijven.
4. **Volgorde bij tijdnood** (wat eerst valt): O8, dan O7, dan O5, dan O6. O1 en O3 zijn de waardevolste.
5. `tests/sw-schil.test.mjs` en `tests/window-namen.test.mjs` draaien bij elke `node --test`; geen enkele goedgekeurde taak voegt
   een bestand onder `public/js/` toe (nagekeken: O1 t/m O8 wijzigen enkel bestaande bestanden plus tests).

---

## O1 — Opstartverzoeken vroeg starten: APPROVE WITH CHANGES

**Bewijs nagekeken.** Klopt: `startNaInlog` (`schermen/rol-schil.js:140-161`, het plan noemt `rol-schil.js` zonder `schermen/`)
wacht `laadSessie()` af, daarna `synchroniseerInstellingen`, daarna `opstart()`. `haalAuthIk` (`kern/sessie.js:123-141`) en
`voerSynchronisatieUit` (`kern/instellingen-sync.js:215-217`) hangen enkel van de cookie af. Er is geen CSP (geen `_headers`, geen
CSP in `netlify.toml`), dus een extra inline script is toegestaan. `window-namen.test.mjs` scant `index.html` mee: een
`window.__blitzVroeg = …` in het inline script telt als definitie, een lezing via `globalThis.__blitzVroeg` in `kern/api.js` is dan
toegestaan zonder de test te verzwakken. `sw-schil.test.mjs` kijkt enkel naar `<script type="module" src>` en de preloads: een
gewoon inline script raakt die niet.

**Winst plausibel?** Ja, en het is ook in productie echt (niet enkel een HTTP/1.1-artefact van het harnas): auth-ik en
instellingen zijn elk een functie-aanroep met Blobs-lezing; ze lopen nu pas na het laden en parsen van ~114 modules, na elkaar.
Met een bewaarde sessie wacht de app tot 5 s op auth-ik vóór er iets (ook de bewaarde tickets) verschijnt; elke ms die hier
wegvalt ziet de technieker.

**Risico's die het plan mist of te licht neemt:**
- **Gedeelde tablet / andere gebruiker.** Verloopt de sessie tussen het vroege instellingenverzoek (200, gebruiker A) en auth-ik
  (401), dan logt gebruiker B in en zou `synchroniseerInstellingen(B)` het vroege overzicht van A kunnen gebruiken
  (`mijnId = gebruiker.id` = B, `neemCacheOver(B)`): instellingen van A onder B. Zeldzaam, maar precies het soort fout dat T15/T16
  moesten uitsluiten.
- **Zinloos 401-verzoek.** Zonder bewaarde sessie (eerste gebruik, na afmelden) geeft het vroege instellingenverzoek altijd 401:
  een extra verzoek en een extra "Failed to load resource 401" in de console.
- Het late pad (`metLimiet` 5 s, `verwerkLaat`) moet met een vroege belofte exact hetzelfde blijven.

**Bindende wijzigingen:**
1. Het inline script start `instellingen?overzicht=1` enkel als `localStorage.blitz_sessie_cache` geldige JSON met een `id` is
   (zelfde test als `leesCache` in `kern/sessie.js`); `auth-ik` mag altijd (buiten `?test`). Het hele script in `try/catch`; geen
   extra kopteksten; de tijdlimiet loopt (zoals `kern/netwerk.js`) enkel tot de antwoordkop.
2. `synchroniseerInstellingen` gebruikt het vroege overzicht enkel als: status 2xx, **`overzicht.eigen.gebruikerId === gebruiker.id`**,
   en de sessie kwam uit de EERSTE ronde van `laad()` (geen inlog- of wachtwoordscherm, dus dezelfde cookie). Anders: weggooien
   en de gewone `apiJson`-aanroep.
3. `neemVroeg` geeft elke belofte hoogstens één keer, ook als die eerste ronde op de korte limiet uit de cache startte (dan loopt
   het vroege antwoord via `verwerkLaat`, zoals nu het lopende verzoek).
4. Extra tests bovenop het plan:
   - node: vroeg overzicht van een ander id -> genegeerd en een gewone aanroep; vroeg auth-ik trager dan `KORTE_LIMIET_MS` met
     cache -> start uit cache, late 401 opent het inlogscherm (`verwerkLaat`).
   - e2e `vroege-start.spec.mjs`: (a) zonder bewaarde sessie: geen vroeg instellingenverzoek, inlogscherm, na inloggen precies één
     vers `auth-ik` en één `instellingen`; (b) met bewaarde sessie en auth-ik 401: inlogscherm, inloggen als ANDERE gebruiker, de
     instellingen in `localStorage` zijn die van de nieuwe gebruiker; (c) 0 consolefouten in elk scenario (of een exact benoemde
     toegelaten 401-bronfout via `verwachtConsoleFout`, nooit een losse regex).
   - `npx playwright test --project=sw` blijft verplicht (offline start: de vroege `TypeError` mag nergens als "Uncaught" opduiken).
5. Acceptatie bij 0 ms: 10 %-regel (zie algemene regel 3).

**Enkel in productie aantoonbaar** (manuele controle Brent na release): op een echte gsm in DevTools `auth-ik` en `instellingen`
elk één keer, gestart vóór de modules klaar zijn; een verlopen sessie op de gedeelde tablet -> inlogscherm -> andere gebruiker ziet
zijn eigen instellingen.

---

## O2 — Lijstkaarten op de gsm zonder vervaging: APPROVE WITH CHANGES, beslissing bij Brent vóór release

**Bewijs nagekeken.** `css/app.css:176-185` (de kaartregel; `backdrop-filter: blur(var(--blur)) saturate(180%)`), `base.css:184`
(`--blur: 10px` op gsm) en `css/hemel.css` (zachte verlopen; sterren enkel `nacht` donker) kloppen. Het afgesproken terugvalpad
staat in `docs/superpowers/specs/assets/2026-10-27-open-dag-snelheid.md` (Besluit), **maar met een voorwaarde**: "Zou een echte
telefoon later toch trager aanvoelen". Die voorwaarde is niet vastgesteld; het bewijs komt uit headless Chromium zonder grafische
kaart, waar vervaging in software uitzonderlijk duur is. De winst op een echt toestel is dus onzeker (vermoedelijk kleiner).

**Is dit een ontwerpbesluit?** Niet als het pixelcriterium slaagt: dan verandert het beeld niet (≤ 3/255 op ≥ 99,5 % van de
kaartpixels), en dat is een sterk, objectief criterium. Wel raakt het de glasregel die Brent zelf vastlegde. Mijn oordeel: bouwen
mag (het is pixel-gelijk en omkeerbaar), maar **Brent geeft bij de release expliciet ja of nee**; tot dan is het een kandidaat.

**Bindende wijzigingen:**
1. Eén aparte commit met enkel de CSS-regel, zodat ze los teruggedraaid kan worden zonder de rest van de release te raken.
2. De pixeltest ook op een **Kalenderkaart (`.cal-ticket`) in de gsm-lijstweergave**, op de dag van vandaag (nu-lijn in beeld), niet
   enkel Wachtrij en Ingepland: dat is de lijst met de meeste structuur in de buurt van de kaarten.
3. Een portret-tablet is ook `data-apparaat="gsm"`: de bestaande `e2e/tablet-rechtop.spec.mjs` mee draaien.
4. `meet-snelheid` voor O2 enkel in het meetslot (algemene regel 2); de @contrast-runs `--workers=1` zoals CLAUDE.md.

**Enkel in productie aantoonbaar:** op een echte gsm overdag en 's nachts de Wachtrij bekijken en scrollen (ziet het er hetzelfde
uit, scrolt het vlotter?). Dat is de eigenlijke reden voor Brents ja/nee.

---

## O3 — Kalender en Ingepland niet opnieuw opbouwen: APPROVE WITH CHANGES (enkel stap A)

**Bewijs nagekeken.** `setTab` roept bij elk bezoek `kalender.activeerKalender()` (= `renderKalender()` + `kalAutoScroll(true)`,
`kalender.js:51`) en `ingepland.renderGepland()` (`app.js:942-943`); `.view { display: none }` (`app.css:129`). `koppelRenders`
(`app.js:741-768`) abonneert de kalender niet op `planning`, `klantBeschikbaarheid`, `voorstelStatus`, `settings`, terwijl
`renderKalender` ze wel leest (`planning` via `dayStops`, `voorstelStatus` via `tijdslotLabelVoor`, `klantBeschikbaarheid` via
`duurVoor`, `settings`). De verborgen heropbouw maskeert dat nu: het plan ziet dat correct en dekt het met een abonnement op alle
`SLEUTELS`. Andere invoer buiten de toestand: het rapportarchief (`rapport-archief.js` roept zelf `renderKalender()`, wat als
verborgen render "verouderd" telt), de rechten (`magPlannenVoor`), de indeling, de datum en de venstermaat (hoogte van het raster).

**Risico.** Dit is het belangrijkste risico van de nacht voor de technieker: de Kalender is zijn standaardtab. Elke invoer die
NIET via `toestand` of een directe render loopt, toont na deze wijziging verouderde gegevens tot er iets anders verandert. Daarom
strenger dan het plan:

**Bindende wijzigingen:**
1. De sleutel bevat ook: `innerWidth x innerHeight` (een venster-/schermwissel terwijl Kalender verborgen is: de rasterhoogte wordt
   verborgen niet gemeten, `kalPasGridHoogteAan`), en de rol/`planEigen` van `huidigeRechten()` (een laat auth-ik kan de rechten
   wijzigen zonder herladen, `verwerkLaat`).
2. `tab-hertekenen.spec.mjs` test **elke** sleutel uit `SLEUTELS` (lus), niet enkel `planning` en `klantBeschikbaarheid`; plus:
   een rapportarchieflading terwijl Kalender verborgen is -> +1 bij terugkeer; een vensterwissel terwijl verborgen -> +1 en de
   rasterhoogte klopt; het herstel van de schermstaat bij de start (`app.js:440-453`, scroll na `activeerKalender`) blijft werken.
3. Een in-place mutatie zonder `raak()` is de restkans. De implementeerder zoekt (grep) naar in-place schrijfacties op
   `klantBeschikbaarheid`, `voorstelStatus`, `avExceptions`, `localEvents`, `planning` zonder `raak` en meldt ze (niet stil
   oplossen buiten de taak; een ontbrekende `raak` is een bugfix die in het rapport komt).
4. **Opus-review** (het plan zegt "kritisch pad: nee"; voor de standaardtab van de technieker is dat te licht).
5. **Stap B niet vannacht**: hij wijzigt een karakteriseringstest (`e2e/kern.spec.mjs:173`) en raakt specs die de DOM van een
   verborgen tab lezen; de winst (week terug 335 -> ≤ 285 ms) rechtvaardigt dat niet onbewaakt.

**Enkel in productie aantoonbaar:** technieker op een echte gsm: na een poll, na een rapport en na een wijziging door de planner
(andere tablet) toont de Kalender bij terugkeer de verse stand.

---

## O4 — Tickets vroeg ophalen en een identiek poll-antwoord overslaan: REJECT (vannacht)

**Bewijs.** Klopt op zich (`loadTickets`, `app.js:587-649`; poll `app.js:814-828`; terugkeer `app.js:884-891`).

**Waarom niet vannacht:**
- **Zoho-last.** Elk niet-gebruikt vroeg antwoord betekent een tweede volledige Zoho-scan (pagina's + één detailverzoek per
  ticket): wachtwoordscherm langer dan 60 s, id-verschil, en het opstartherstel in `index.html` (herladen na een mislukte module)
  terwijl het vroege verzoek op de server doorloopt. Elk afzonderlijk zeldzaam, maar het plan kan het niet testen in de modus die
  ertoe doet: de vroege fetch loopt bewust NIET in `?test`, dus enkel de productiespecs en Brents controle na de release dekken het.
- **Poll overslaan (deel 2).** Het bewijs ("geen schok of scrollsprong elke 5 minuten") is niet gemeten; `metBehoudScroll` beschermt
  de scroll al. De winst is dus niet aangetoond, het risico (een scherm dat bij een gelijk antwoord iets niet bijwerkt dat nu als
  bijwerking van de poll ververst, bv. een `inFlight`-uitzondering in `reconcilePlanning`) wel aanwezig.
- **Overlap met O1 en tijdsdruk.** O4 hangt af van O1, O3 en O7 (golf 3), vraagt een opus-review en raakt de gevoeligste functie
  van de app. Met de nachtelijke tijdslimiet blijft er geen marge voor een fixronde.
- Volgende ronde: eerst O1 in productie meten (hoe lang duurt de staat tussen modules en `tickets` op een echte gsm?), dan O4 deel 1
  met dezelfde id-/leeftijdsregels; deel 2 enkel met een meting die een echte schok aantoont.

---

## O5 — `/api/tickets`: agents parallel en een glijdend venster van 5: APPROVE WITH CHANGES

**Bewijs nagekeken.** `netlify/functions/tickets.js:25` wacht op `/agents` vóór de paginering (het commentaar zegt "parallel");
`:43-60` pagina's na elkaar; `:70-83` lock-step batches van 5. Geen `[functions.tickets]` in `netlify.toml`.

**Correctie op het plan:** "een falende agents-JSON laat de assignee leeg" geldt enkel voor een JSON-foutantwoord zonder `data`
(test `server-tickets.test.mjs:211`). Een agents-antwoord dat GEEN JSON is, laat `agentsRes.json()` gooien en geeft vandaag 500.
Dat gedrag moet ongewijzigd blijven.

**Bindende wijzigingen:**
1. Start agents en pagina 0 tegelijk (in die volgorde), maar **verwerk agents (inclusief `.json()`) eerst, zoals nu**, vóór het
   resultaat van pagina 0 bekeken wordt: dan blijft de foutvolgorde exact gelijk (agents-fout vóór paginafout).
2. Geen onafgehandelde rejections: de belofte van pagina 0 krijgt meteen een lege `catch`-aftakking (faalt agents, dan wordt ze
   nooit afgewacht), net als elk nog lopend detailverzoek na de eerste detailfout. Test: `process.on('unhandledRejection')` telt 0
   in de nieuwe fout-tests.
3. De bestaande tests blijven ONGEWIJZIGD groen (o.a. "batches van vijf" met `max === 5` en de `afgerond`-volgorde, de volledige
   aanroepenreeks, "ticketdetail-fout ... alle batchaanvragen zijn al verstuurd").
4. `timeout = 26`: let op het samenspel met de client. `kern/netwerk.js` breekt `/api/tickets` af na 20 s (standaardlimiet) en een
   mislukte lading wordt elke 30 s opnieuw geprobeerd (`_lastTicketLoad` wordt enkel bij een geslaagde lading gezet, `app.js:572`; pollcontrole `app.js:822`). Een
   functie die 20-26 s loopt, verbruikt dus Zoho-aanroepen waarvan de client het antwoord niet meer leest. Niet aanpassen vannacht
   (dat zou de client-limiet veranderen), wel in het rapport vermelden.

**Enkel in productie aantoonbaar:** de duur van `tickets` in de Netlify-logs voor/na; geen Zoho 429; geen time-outs boven 20 s.

---

## O6 — Rapportarchief: robuust laden: APPROVE WITH CHANGES

**Bewijs nagekeken.** `rapport-archief.js:30-51`: geen `res.ok`-controle, `_archiefVersie = data.versie || 0`, de catch vervangt
de lijst door een foutregel. De serverterugval (200 met `{ versie: 0, rapports: [] }` bij een Blobs-fout,
`netlify/functions/rapport-archief.js:88-94`) en de stijgende versie (`netlify/lib/rapportlijst.js:112`; jaararchief
`netlify/lib/rapport-jaararchief.js:75`) kloppen. `_archiefVersie` gaat mee in `schrijfRapportStatus`
(`schermen/rapport-verzenden.js:186, 278`): deel 1 is een echte stabiliteitsfix.

**Probleem met deel 2 (identiek antwoord niet hertekenen).** `renderRapportArchief()` hangt NIET enkel van het antwoord af: ook van
`_outboxItems` ("In wachtrij") en van lokale in-place wijzigingen (`r.verzondenKlant = …`), en het rapportmailpad steunt er
uitdrukkelijk op dat een latere hertekening de verstuurknop terug opent (`rapport-verzenden.js:118` en `:264`: "Een latere
hertekening zet de knop weer open"; na een onzeker resultaat blijft hij bewust op slot). Met deel 2 zou zelfs de knop "Vernieuwen"
(`rapport-herlaad`, `app.js:267`) bij een gelijk antwoord niets meer hertekenen: de knop blijft op slot tot de pagina herlaadt, of
er blijft een lokaal gezette "verzonden"-stand staan die de server niet heeft. Dat is een wijziging in het mailgedrag.

**Bindende wijzigingen:**
1. Deel 1 zoals beschreven, met één aanpassing: een antwoord met een versie **lager** dan de gekende is geen gebruikersfout maar
   een verouderd of terugvalantwoord (dat kan ook gewoon een oudere GET zijn die later binnenkomt dan een `zetArchiefVersie` uit
   het verzendpad): lijst en versie ongemoeid, `console.warn`, **geen** foutmelding. Echte fouten (`!res.ok`, geen array, netwerk)
   krijgen de toast als er al een lijst staat, anders de foutregel zoals nu.
2. Deel 2 enkel als: bij een byte-gelijk antwoord wordt `renderKalender()` overgeslagen; `_rapportArchief` wordt altijd
   toegewezen en `renderRapportArchief()` loopt altijd. Vooraf nakijken dat de kalenderrapportkaartjes geen lokaal gewijzigde
   velden tonen (`verzonden*`, `geannuleerd`, outbox-stand); doen ze dat wel, dan vervalt deel 2.
3. Extra e2e: na een onzeker verzendresultaat (knop op slot) opent "Vernieuwen" met een identieke stub de knop zoals nu.
4. Zichtbaar (klein, gemeld): bij een fout blijft de lijst staan met een melding i.p.v. een foutregel.

---

## O7 — Geocache één keer inlezen: APPROVE

**Bewijs nagekeken.** `kern/opslag.js:35-44` (`JSON.parse` van de hele cache per opzoeking) en `app.js:544` (per gepland ticket in
`applyTicketsData`). `kern/eigenaar.js` wist de geocache bewust nooit (ook niet bij een gebruikerswissel), dus het geheugen kan niet
verouderen door een wissel in dezelfde tab; andere tabs via de `storage`-gebeurtenis zoals het plan zegt. Laag risico, kleine maar
echte winst op een toestel met een volle cache; enkel met de node-test aantoonbaar. Geen wijzigingen.

---

## O8 — Routekaart pas bij Route: APPROVE WITH CHANGES (laagste prioriteit)

**Bewijs nagekeken.** `initMap()` in `opstart` (`app.js:323-334`) maakt meteen `L.map` met tegellaag (`route-kaart.js:315-324`);
de e2e-hulp stubt `server.arcgisonline.com` (dus de tegel komt in elke start). Winst: één tegelverzoek en de kaartopbouw minder per
start; op de gsm bestaat Route niet.

**Risico.** "De laatste tekenopdracht naspelen" is te smal: de opdrachten zijn niet gelijkwaardig. `updateKaart` bepaalt de inhoud
(lagen, markers, legende, wegafsluitingsmelding), `zoomOpGekendeStops` enkel het beeld, `wisKaart` maakt leeg. Een reeks
`updateKaart(A)` -> `zoomOpGekendeStops(B)` (TomTom faalt daarna) zou met "enkel de laatste" de markers van A verliezen.

**Bindende wijzigingen:**
1. Bewaar de laatste INHOUDSopdracht (`updateKaart`/`wisKaart`, met argumenten) en daarna apart de laatste BEELDopdracht
   (`zoomOpGekendeStops`); speel ze na het maken in die volgorde af.
2. Het late maken in `zorgVoorKaart()` staat in `try/catch` en toont bij een fout dezelfde melding als `app.js:327-333` in
   `#map-wrap`; een fout mag de routelijst niet breken.
3. Extra e2e: Route openen terwijl de route al actueel is (geen `calculateRoute`, enkel `invalideerKaartGrootte` maakt de kaart);
   tablet rechtop -> liggend -> Route; `kern.route`-tellers en de kaartstijlknop (`applyKaartStijl` na een persoonswissel vóór het
   eerste openen) zoals nu.

**Enkel in productie aantoonbaar:** eerste opening van Route op de pc toont markers en route; geen tegelverzoek bij de start op de gsm.

---

## Golven en volgorde (tijdslimiet: bouwen tot ~04:00, daarna volledige suite + @contrast + eindmeting tot ~05:45)

Gedeelde bestanden nagekeken: binnen elke golf hieronder geen gedeeld bestand (O1: `index.html`, `kern/api.js`, `kern/sessie.js`,
`kern/instellingen-sync.js`; O2: `css/app.css`; O6: `rapport-archief.js`; O3: `app.js`, `schermen/kalender.js`,
`schermen/ingepland.js`; O5: `netlify/functions/tickets.js`, `netlify.toml`; O7: `kern/opslag.js`; O8: `schermen/route-kaart.js`).
O6 deel 2 en O3 raken elkaar inhoudelijk (`renderKalender` uit het archief), maar niet in bestanden; volgorde O6 -> O3 is goed.

| Golf | Start | Taken |
|---|---|---|
| 1 | ~01:00 | O1 (opus-review), O6 (opus-review, licht), O2 |
| 2 | ~02:15 | O3 stap A (opus-review), O5 (opus-review), O7 |
| 3 | ~03:30, enkel als golf 2 samengevoegd en groen is | O8 |
| eind | uiterlijk ~04:05 | volledige `node --test`, `npx playwright test --workers=2 --grep-invert @contrast` (30-40 min), @contrast apart `--workers=1` (7 min), `--project=sw`, eindmeting met `--voor` (~25 min), opruimen |

Valt O8 af wegens tijd, dan niets verloren: het is de kleinste winst.

## Naar Brent (beslissingen en manuele controles na release)

Beslissingen:
1. **O2**: ja/nee op het weglaten van de vervaging achter de lijstkaarten op gsm (pixel-gelijk getest; de afgesproken voorwaarde
   "een echte telefoon voelt trager" is niet vastgesteld). Aparte commit, los terug te draaien.
2. **O6**: akkoord met het zichtbare verschil (bij een laadfout blijft de lijst staan met een melding).
3. Uit het plan "Niet nu", ongewijzigd naar Brent: SW cache-eerst (punt 1), vervaging ook 's nachts/thema/pc (punt 2), verdwenen
   ticket overslaan (punt 11).

Manuele controles in productie:
- O1: DevTools op een echte gsm: `auth-ik` en `instellingen` elk één keer en vroeg; gedeelde tablet: verlopen sessie -> inloggen als
  iemand anders -> eigen instellingen.
- O2: echte gsm, Wachtrij overdag en 's nachts: zelfde beeld, vlotter scrollen?
- O3: technieker: Kalender na een poll, na een rapport en na een wijziging van de planner toont de verse stand.
- O5: Netlify-logs: duur van `tickets` voor/na, geen Zoho 429, geen time-out.
- O8: pc: Route de eerste keer openen toont markers en route; gsm-start zonder tegelverzoek.
