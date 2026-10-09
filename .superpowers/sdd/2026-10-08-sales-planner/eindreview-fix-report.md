# Eindreview-fixronde sales-planner

Tak `refactor-sales`, basis `ded4d81`. Niets gepusht of gemerged.

## Deel A: regressie tweede mailcontrole (6 e2e-tests)

**Oorzaak (geen sales-code):** Leaflet's tegel-fade (`GridLayer._updateOpacity`) is een `requestAnimationFrame`-lus op `+new Date()` (200 ms per tegel).
De productie-e2e zet met `page.clock.setFixedTime` (`vasteKlok`) de tijd vast, dus de lus eindigt nooit; elke `page.clock.runFor(2000)` van
`laatMailControleHerhalen` laat daardoor ~125 nep-frames lopen en kost ~1,9 s echte tijd, omdat elke frame op deze machine een echte timer van
15,6 ms kost (Windows-timerresolutie; `node -e "100x setTimeout(1)"` = 1535 ms). De tweede mailcontrole komt 30 s nep-tijd na de eerste =
~15 polls x 1,9 s = 28 s > de poll-timeout van 20 s. Of de test slaagt hangt dus van de timerresolutie van de machine af (afhankelijk van welke
andere programma's een hoge resolutie aanvragen); bij 1 ms per frame past hij ruim.

**Bewijs:**
- De test faalt ook op `6cbf0e9` (Task 11) en op `ec1501b` (basis van de tak, voor sales) in een scratch-worktree met dezelfde `node_modules`: op 6cbf0e9 faalde test :328, op ec1501b faalden :328, :436 en :495 (heel rapport.spec: 3 gefaald, 25 geslaagd). Het is dus geen sales-regressie en de bisect tussen `6cbf0e9` en HEAD is niet nodig (de fout zit al in de basis; het groene run van Task 11 gebeurde onder een snellere timerresolutie).
- Gemeten: `runFor(2000)` = 1,86 s, `runFor(250)` = 0,16 s, `20 x runFor(100)` = 0,23 s (de rAF-lus start pas na het laden van een tegel); in de pagina registreerde een wrapper rond `requestAnimationFrame` 716 aanroepen (stack: `leaflet.min.js`) en geen andere herhalende timers.
- Op een lege pagina met nepklok kost `runFor(2000)` 5 ms; met `fadeAnimation: false` slaagden de 3 rapport-tests in 2,7 s per test i.p.v. 22 s (time-out).

**Fix:** `public/js/schermen/route-kaart.js`: `L.map('map', { zoomControl: true, fadeAnimation: false })` (tegels verschijnen zonder 200 ms fade; geen functionele
wijziging). Tests niet aangepast. Commit `de89a68`.

## Deel B

- **I1 instellingen** (`00c138c`): `sales-data.js` houdt `instellingenGeladen` + `instellingenDoel` bij; `laadInstellingen`/`laadSales` van een ander doel of een mislukte lading wissen de
  instellingen van de vorige verkoper; een onleesbaar antwoord telt als mislukt (`instellingen: null` blijft geldig). Het venster toont dan een melding met "Opnieuw proberen" en
  Sluiten (geen formulier, geen Bewaren; ook bij Bewaren een extra controle); de PUT vertrekt van het geladen serverobject. "Plan deze week" laadt eerst opnieuw en breekt af met een toast als de instellingen van de
  getoonde verkoper niet geladen zijn. Tests: 6 unit, 2 e2e (venster: 503 -> melding -> hersteld -> echte waarden en PUT behoudt `kaartStijl`/`werkdagen`/`maxPerDag`; beheerder wisselt naar verkoper met mislukte lading
  -> geen PATCH; die test faalt zonder de fix).
- **I2 verlopen voorstel** (`eeb93ae`): `isVerlopenVoorstel` (lead-regels); de adapter maakt zo'n voorstel (ook buiten de bekeken week) kandidaat en `vrijgegeven` (valt terug op te-plannen zonder plaats);
  de lijst zet het bij "Nog in te plannen" met chip "voorstel verlopen". Bevestigd en vast: nooit. Tests: 3 unit (adapter) + 1 (lijst), 1 e2e.
- **I3 bewaartermijn** (`2f00fed`): `ruimOp` wist elke lead 12 maanden na de laatste activiteit (`geimporteerdOp`, nieuw serverveld `gewijzigdOp` bij elke wijziging, `eerderVerwijderd.op`, `resultaat.op`,
  bezoek `op` en `datum`; een bezoekdatum in de toekomst telt hoogstens tot vandaag = M6), en blokken op hun datum; een lead met een voorgestelde of bevestigde afspraak van vandaag of later blijft. Een
  nieuwe import van dezelfde lead zet `gewijzigdOp` bij een aanvulling of als de laatste activiteit > 30 dagen oud is (een identieke herimport schrijft dus nog steeds niets). De dagelijkse functie ruimt ook
  `blitz-data-test` op (zonder logregel); blobs van geblokkeerde/verwijderde verkopers werden al meegenomen (nu getest). De beheerder kan een geblokkeerde verkoper lezen (`bepaalDoel`; schrijven = 403 `geblokkeerd`),
  `GET /api/gebruikers?rol=sales&geblokkeerd=1` (enkel beheerder) levert ze, de keuzelijst toont "(geblokkeerd)", de weergave is alleen-lezen en de standaardkeuze is een actieve verkoper. Tests: opruimregels
  (leads/blokken/grafstenen/grens/schrikkel/toekomstige afspraak), functie met testopslag en fouten, toegangsmatrix, gebruikerslijst, `gewijzigdOp`, herkenning, 1 e2e. CHANGELOG, handleiding en `docs/bugs-en-open-punten.md` aangepast (I7 herschreven, I23/I24 nieuw).
- **Minors:** M2 (laat PATCH-antwoord na verkoperwissel genegeerd), M4 (tekst bij vervallen), M6 (zie I3) opgelost in `39044b8`/`2f00fed`; de rest (M1, M3, M5, M7-M13) staat in `docs/bugs-en-open-punten.md` sectie I (I23).

## Tests
- `node --test`: 2283/2283.
- Playwright (`--workers=2`, chromium): alle `e2e/sales-*.spec.mjs` + `route-kaart.spec` + de 6 regressietests: 138/138; `route*.spec` (4 bestanden): 22/22.

## Aandachtspunten
- De regressie-oorzaak is machine-afhankelijk (timerresolutie); zonder `fadeAnimation: false` kunnen die 6 tests op elke trage Windows-sessie opnieuw falen, ook op `refactor`.
- De beheerder kan de leads van een geblokkeerde verkoper enkel lezen (ruling): een wis-verzoek van een klant vergt deblokkeren of de 12 maanden.
- Het scratch-worktree (`C:/Users/BRENT/AppData/Local/Temp/bsec`) is verwijderd; het lag buiten de scratchpad omdat de scratchpad-padlengte op Windows `git worktree add` liet falen.
