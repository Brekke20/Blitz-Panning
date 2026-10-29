# Rapport L1 en L2 (laadskeletten), tak f1-skelet

Commits: `dd8567d` (L1), `356b697` (L2). Geen versie- of CACHE_NAME-ophoging, geen nieuw bestand onder `public/js/` (dus geen SHELL-wijziging), L3 niet aangeraakt.

## L1 (Kalender, Ingepland, Route)
- `kern/skelet.js`: `maakTicketsStand` (`onbekend`/`bekend`/`mislukt`, één JS-timer van 150 ms die `data-tickets-laden="zichtbaar"` op `<html>` zet), `bouwTicketsSkelet`, `bouwTicketsMelding`. CSS (`base.css`): `.skelet--tickets` is dekking 0 tot het attribuut er staat (op de wortel, niet op `.skelet-blok`: reduced motion toont het skelet dus wel). Geen CSS-vertraging (review C-L1-2).
- `app.js`: de stand gaat vlak VÓÓR `applyTicketsData(cached)` en vóór `applyTicketsData(data, { reconcile: true })` op `bekend` (review C-L1-1). Mislukte eerste lading zonder kopie: `mislukt()` en expliciet hertekenen (O3-markering voor Kalender en Ingepland, zichtbaar scherm meteen, routelijst altijd). Afh-sleutel `ticketsBekend` voor kalender, ingepland, route (geen nieuwe toestand-sleutel; `skeletVertragingMs` vervalt).
- Kalender: skeletkaartje in elke dagkolom (ook naast afspraken), blokje i.p.v. "0/x"; Ingepland: skelet met kopblok i.p.v. de lege tekst en "andere week"-hint; Route: skelet in de lijst, kaart blijft. `aria-busy` op de container, één `role="status"` "Laden…" per scherm (pas aanwezig onder het attribuut).
- Extra: paginakop zegt tijdens het laden niets over "nog niets gepland"/"Geen afspraken deze week" (`geladen`-vlag, unit-getest); de vaste beginregel van `#route-list` in `index.html` is weg (loog tijdens het laden).
- Maandweergave van de Kalender krijgt bewust geen skelet (een lege cel beweert niets).

## L2 (Rapporten, Inventaris)
- Rapporten: de vaste "Laden…" kreeg een id; skelet enkel als dat de enige inhoud is (I-L2-1: `toondeLaden` was bij de start onwaar). `meldLaadFout` en `toondeLaden` ongewijzigd. Eén skelet voor opstart en tabopening. Gevonden tijdens het bouwen: `flushOutbox` riep bij de start `renderRapportArchief()` aan en zette "Nog geen rapporten gearchiveerd." over de lading heen (valse lege staat); nu tekent het niets zolang de eerste lading loopt.
- Inventaris: idem voor de eerste lading zonder kopie. Ook hier tekenden de ticket-abonnementen een lege voorraad (allemaal nul) vóór de gegevens: `renderInventaris` slaat dat over zolang er geen gegevens zijn en een lading loopt (bij een mislukte lading tekent de lading zelf, zoals voorheen).

## Tests
- `node --test`: 3585 pass, 0 fail (nieuw: 11 in `tests/skelet.test.mjs`, 2 in `tests/paginakop.test.mjs`).
- Nieuw: `e2e/productie/skelet-tickets.spec.mjs` (13): onder een stilstaande nepklok (auth-ik vastgehouden tot de klok staat) t=0/100 ms onzichtbaar, t=160 ms zichtbaar; snelle lading; lege staat voor een technieker zonder tickets (ook na tab weg en terug); bewaarde kopie (geen skelet); poll met hangend antwoord; mislukte eerste lading (500); reduced motion (WEL zichtbaar); paginakop; lay-out (weekbalk, routelijst en kalenderkop ongewijzigd, eerste echte kaart op dezelfde y, x en breedte ± 2 px in Ingepland en Route). Op de computer geldt dat voor de Kalender enkel de kop (de tijdlijn zet kaarten op uurposities).
- `e2e/skelet.spec.mjs`: +7 (L2); `gezien()` negeert `skelet--tickets`.
- Playwright (chromium, `--workers=2`, zonder @contrast): 171 pass in de L1-set (skelet, kalender, weekend, route, tab-hertekenen, kern, schil-flits, wachtrij, kalender-gsm-vandaag, kalender-indelingen, versiering-bewegingen, productie/opstart, skelet-tickets) + 254 pass in de L2-set (o.a. rapport-verzenden, paginakop, tab-bolletjes, dok-meer, voorraad-specs, excel-export, kern, kalender). `--project=sw`: 16 pass + de 5 bewuste zelftests.
- `@contrast` (versiering + hemel-contrast, `--workers=1`): 67 pass.
- Flakes onder belasting (andere agent draaide mee), elk apart opnieuw groen: `kalender-gsm-vandaag` "gegevens die na de sprong binnenkomen" (2x herhaald groen), `productie/excel-export` (CDN-lading, time-out 31 s), `sw/traag` (2x, bovengrens 3 s).

## Afwijkingen
- M-L2-1 (inventariskopie meteen tekenen) NIET gedaan: de supervisor-weergave baselinet `_invSeenLogIds` bij de eerste tekening; vroeg tekenen uit de kopie verandert wat als "nieuw" geldt. Minor, dus bewust gelaten.
- Skelet in de Kalender staat bovenaan de dagkolom (in de tijdlijnweergave boven het uurraster); bij binnenkomen van de data verschuift daar het raster (zoals vandaag de "—").
- Hulpmiddelen: niets echts aangeroepen; geen processen achtergelaten.

## Reviewer, kijk vooral naar
1. Volgorde in `loadTickets` (`ticketsStand.bekend()` vóór beide `applyTicketsData`; `start()` na de kopie-stap; `mislukt()` in de catch).
2. `hertekenNaMisluktEersteLading` (O3-markering, routelijst).
3. De guards in `renderRapportArchief` en `renderInventaris` (nieuw gedrag: niet tekenen tijdens een eerste lading).
4. `planDatum` is van binnen `koppelRenders` naar moduleniveau verplaatst (zelfde uitdrukking).

## Reviewfixes (commit 8d9da4c)
De eerdere tekst hierboven over een "flake" van `kalender-gsm-vandaag` klopte niet: het was een echte regressie (A/B: basis 28/28, tak 4-6 rode per run).
- **C1 oorzaak en fix**: het kalenderskelet was een kaart van ~72 px in elke dagkolom, vervangen door "—" (~58 px) of niets; de paginahoogte veranderde, scrollY werd geklemd en kalLijstScroll las dat als een scroll van de gebruiker. Nu is het skelet één balkje in precies de doos van `.day-empty` (DAG_SKELET in kalender.js, `.skelet--kal` in base.css), enkel in lege kolommen (een kolom met afspraak of rapport verliest "—" én skelet), ook in de tijdlijnweergave vóór het uurraster: de hoogte verspringt dus niet.
- **I1**: test van de echte technieker-start op een gsm zonder tabklik. **I2**: `eersteLading && ticketsStand.mislukt()`, met test (Vernieuwen faalt terwijl de eerste loopt: skelet blijft).
- **M1** route met enkel eigen afspraken: skelet onderaan, met test. **M2** inventaris: skelet blijft tot de laatste lading klaar is en stopt zodra de gegevens er zijn; aria-busy weg bij tekenen (ook rapport-archief). **M3** supervisor-poll tekent ook zolang de inventaris niet geladen is (`isInventarisGeladen`). **M5** `gezien()` beperkt tot dagkolom, Ingepland en routelijst.
- Nieuwe tests (18 in skelet-tickets.spec): lege dag en weekraster even hoog (gsm), uurraster op dezelfde y (computer), technieker-start, latere mislukte lading, route met afspraak. De pil "zonder datum" in de kalenderbalk groeit met de data (Roel): dat is geen skelet, de test meet het weekraster.
- Runs: `node --test` 3585 pass (1x de bekende `server-spel` "gelijktijdige inzendingen" rood onder belasting, los 38/38). kalender-gsm-vandaag `--workers=2 --repeat-each=4`: 28/28, twee keer. L1/L2-set (24 specbestanden): 264 pass, 1 rood: `skelet.spec` Sales "snelle lading" (bestaande real-time test, Sales-skelet na 150 ms echte tijd onder belasting; los 3x groen). `--project=sw`: 18 pass (incl. 5 verwachte zelftest-fouten). `@contrast` `--workers=1`: 67 pass.
