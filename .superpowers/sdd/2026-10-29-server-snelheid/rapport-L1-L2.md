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
