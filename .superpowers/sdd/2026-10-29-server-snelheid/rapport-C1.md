# Rapport C1 — Beheer: verzoeken niet na elkaar

Tak `f1-beheer`. Alleen client-code en e2e; geen nieuwe bestanden onder `public/js/`, `CACHE_NAME` niet gewijzigd.

## Wijzigingen
- `public/js/schermen/beheer-instellingen.js`: `render` start `/api/instellingen?gebruiker=<eigen id>` tegelijk met `/api/gebruikers`.
  De eerste `laad()` gebruikt die belofte enkel als de gekozen gebruiker de eigen id is; anders (of bij de volgende ladingen) een
  gewoon verzoek. De volgnummerbescherming blijft ongewijzigd.
- Review M-C1-1: de bewaarde keuze (`blitz_beheer_instellingen_persoon`) is een Zoho-NAAM, geen id; de id volgt pas uit de lijst.
  Daarom: met een bewaarde keuze geen voorstart (de eerste `laad()` doet dan zijn gewone verzoek, dus geen verspild verzoek voor de
  verkeerde gebruiker); zonder bewaarde keuze de eigen id. De sleutel wordt nu vóór de lijst GELEZEN maar pas na een geslaagde,
  niet-lege lijst gewist (zoals voorheen).
- Foutafhandeling: `beheerVerzoek` gooit nooit (geeft `{ ok:false, ... }`), dus geen onverwerkte afwijzing; de voorstart-belofte krijgt
  toch een lege `catch` als vangnet. Een mislukte lijst toont dezelfde fout als voorheen; een mislukte eigen-instellingen-lading
  toont dezelfde "Instellingen laden is niet gelukt. ..."-melding.
- Twee gelijktijdige 401's: `kern/sessie.js` deelt één lopende herlogin-belofte ("Eén gedeelde lopende belofte"), dus één loginscherm.
- `public/js/schermen/beheer-performance.js`: `laadCss()`, `dashboard` en `dashboard-instellingen` starten tegelijk (filters via
  `startFilters()` vooraf berekend); getekend wordt na het stijlblad (of de bestaande wachttijd van 3 s). De eerste `laadDashboard()` /
  `laadGrenzen()` gebruikt de vroeg gestarte beloftes; latere ladingen (filter, herlaad) doen gewone verzoeken.

## Tests
- Nieuw in `e2e/beheer-tabs.spec.mjs` (4 tests, "tab Instellingen: gelijktijdige lading (C1)"): een hek houdt beide antwoorden vast tot
  beide verzoeken zijn aangekomen en telt wat er onderweg was bij het eerste antwoord (moet 2 zijn; was 1 vóór de wijziging: rood
  bevestigd); geen dubbel verzoek; bewaarde keuze `Tim` geeft Tims instellingen en geen verzoek voor de beheerder; lijst-fout en
  instellingen-fout geven de oude meldingen zonder consolefouten (het vangnet faalt op `pageerror`).
- Nieuw in `e2e/performance.spec.mjs` (1 test): `dashboard.css` wordt vastgehouden tot beide gegevensverzoeken aankomen (noodtijd 2,5 s,
  korter dan de 3 s van de app); de gegevensverzoeken noteren of het stijlblad al beantwoord was (rood bevestigd: `true, true`).
- `node --test`: 3574 pass, 0 fail.
- Playwright (chromium, enkel Beheer): `performance.spec.mjs` + `skelet.spec.mjs` (38 groen), `beheer-tabs.spec.mjs` +
  `beheer-rollen.spec.mjs` (58 groen).

## Let op bij de review
- Voorstart wordt niet gebruikt als de eigen id niet in de lijst staat (bv. planner die zichzelf niet ziet): dan een onschadelijk
  extra GET; de eerste lading doet het gewone verzoek.
- Performance: de vroege verzoeken vertrekken ook als de gebruiker de tab verlaat tijdens het stijlbladwachten (voorheen niet tot na
  het stijlblad); `levend()` beschermt het tekenen nog steeds. Sales manager: geen `dashboard-instellingen`-verzoek (zoals voorheen).
- De hek-tests zijn tijdsonafhankelijk in de zin dat een regressie (weer na elkaar) altijd faalt; de Performance-test heeft een
  noodtijd van 2,5 s waarbinnen de app de gegevensverzoeken moet starten (normaal enkele ms na het stijlbladverzoek).
