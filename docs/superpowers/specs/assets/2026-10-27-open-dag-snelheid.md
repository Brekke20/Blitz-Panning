# Open dag: is de app trager geworden?

**In gewone woorden**

- Nee. Op een gsm (nagebootst, met een processor die 4 keer trager is dan die van deze pc) is de nieuwe stijl met glas niet trager dan de live versie 2.4.0.
- Het scrollen liep in deze meting in de nieuwe stijl even vlot of vlotter: van ongeveer 8 % (Kalender, binnen de ruis) tot 57 % (Ingepland) meer beelden in 3 seconden, en op een thema-scène (Halloween) 22 tot 46 % meer. De live versie haperde daar zichtbaar (lange taken tot 899 ms); de nieuwe stijl niet één keer. Let op: dit is gemeten op een nagebootste gsm in een browser op een pc, zonder echte grafische kaart. Dat de nieuwe stijl op een echt toestel vlotter scrolt, is daarom niet zeker. Het belangrijkste besluit blijft staan: nergens is de app 10 % trager.
- Het enige cijfer dat iets omhoog ging, is de tijd tot het eerste ticket zichtbaar is: in het middelste geval 7 % langer (ongeveer 120 ms, bij 20 metingen per versie). Dat blijft onder de grens van 10 % die we afspraken.
- Daarom is er geen terugval nodig: er is aan de stijl niets veranderd (de vervaging op de gsm staat al op 10 px). Enkel het meetscript en dit rapport zijn nieuw.

## De cijfers

Mediaan van het aantal metingen per versie; "voor" = live versie 2.4.0, "na" = de tak met de Open dag-stijl. Tussen haakjes de laagste en hoogste meting. Minder is beter bij tijden en lange taken, meer is beter bij beelden (180 beelden in 3 s = 60 per seconde, het maximum).

**Gewone hemel (7 metingen per versie, 3 s scrollen per scherm)**

| Cijfer | voor (v2.4.0) | na (Open dag) | verschil |
|---|---|---|---|
| Tijd tot eerste ticket (ms) | 1905 (1556-2049) | 2069 (2008-2361) | +8,6 % (zie ook de 20 metingen hieronder) |
| Wachtrij: lange taken (ms) | 0 | 0 | gelijk |
| Wachtrij: beelden in 3 s | 144 (114-155) | 169 (163-175) | +17 % (beter) |
| Kalender: lange taken (ms) | 0 | 0 | gelijk |
| Kalender: beelden in 3 s | 126 (112-147) | 136 (121-147) | +8 % (beter) |
| Ingepland: lange taken (ms) | 0 | 0 | gelijk |
| Ingepland: beelden in 3 s | 115 (95-134) | 180 (115-183) | +57 % (beter) |

**Alleen de laadtijd, 20 metingen per versie (om de ruis te drukken)**

| Cijfer | voor (v2.4.0) | na (Open dag) | verschil |
|---|---|---|---|
| Tijd tot eerste ticket (ms) | 1784 (1607-3619) | 1903 (1673-2576) | +6,7 % |

**Thema-scène Halloween (5 metingen per versie)**: hier hebben ook de dagkoppen en de lege staten glas.

| Cijfer | voor (v2.4.0) | na (Open dag) | verschil |
|---|---|---|---|
| Tijd tot eerste ticket (ms) | 2077 (1752-2542) | 2163 (2051-2386) | +4,1 % |
| Wachtrij: lange taken (ms) | 132 (72-899) | 0 | beter |
| Wachtrij: beelden in 3 s | 134 (110-145) | 180 (176-184) | +34 % (beter) |
| Kalender: lange taken (ms) | 163 (0-687) | 0 | beter |
| Kalender: beelden in 3 s | 145 (120-161) | 177 (174-186) | +22 % (beter) |
| Ingepland: lange taken (ms) | 370 (184-629) | 0 | beter |
| Ingepland: beelden in 3 s | 125 (120-145) | 183 (178-186) | +46 % (beter) |

## Hoe gemeten

- Script: `node scripts/meet-snelheid.mjs --voor=<map met public/ van v2.4.0> --runs=7 [--thema] [--laden]`. Het script start zelf een kleine server per versie en stopt die aan het einde. Er worden geen Zoho, TomTom of mail aangeroepen; enkel de vaste bibliotheken van de app (kaart, handtekening, Excel) komen, zoals altijd, van een CDN.
- De basis is een uitpakking van de tag `v2.4.0` (`git archive`) in een tijdelijke map buiten OneDrive. Beide versies zijn met hetzelfde script, op dezelfde pc en in dezelfde sessie gemeten; de metingen wisselen elkaar af (voor, na, na, voor, ...), zodat een drukke pc beide versies even hard raakt.
- Opstelling: Chromium als gsm (375 x 812, schaal 2, aanraking), `blitz_weergave = gsm`, donker thema, processor 4 keer trager (CDP `setCPUThrottlingRate`), testmodus (`?test`).
- De testmodus heeft maar 3 tickets, te weinig om te scrollen. Daarom zet het script na het laden 30 tickets in de wachtrij en 28 geplande tickets over de werkweek (Kalender en Ingepland), via dezelfde toestand die de app zelf gebruikt.
- Scrollen: 3 s lang met vaste snelheid (1200 px/s, elke seconde andere richting), per scherm. Zo leggen beide versies dezelfde weg af, ook als de ene trager tekent.
- Beelden = het aantal keer dat de browser in die 3 s een nieuw beeld kon tekenen. Lange taken = de som van de stukken werk die de pagina langer dan 50 ms vastzetten.
- Controle van de methode: met de vervaging kunstmatig op 80 px zakt het aantal beelden van ongeveer 176 naar 59. De meting merkt een te zware vervaging dus wel op.
- Beperking: dit is een nagebootste gsm in een headless browser op een pc, geen echt toestel. De verhoudingen tussen voor en na zijn een goede aanwijzing, de absolute getallen niet. Zonder echte grafische kaart zegt de meting weinig over hoe vlot het scrollen op een echte telefoon aanvoelt.

## Besluit

Geen enkel cijfer is 10 % of meer slechter, dus geen terugval. Er is niets aan `base.css` of de proeven gewijzigd. Zou een echte telefoon later toch trager aanvoelen, dan blijft de afgesproken volgorde: eerst minder vervaging (op de gsm staat die al op 10 px), daarna geen `backdrop-filter` op de lijstkaarten (dok, kop en vensters houden het glas).
