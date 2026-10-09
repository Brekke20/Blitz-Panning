# Eindreview-fixronde (refactor-logins), 2026-10-09

Basis 57d4dc2. Alle rulings uit progress.md gevolgd. Niet gepusht, niet gemerged.

| Punt | Status | Commit | Tests |
|---|---|---|---|
| I1 auth-ik 5xx / niet-JSON | gedaan | `fix(auth)` 43c0f10 | `tests/sessie.test.mjs` (500, 502, 504, 200 met HTML, 200 zonder gebruiker: met cache start de app, zonder cache toonGeenVerbinding), `tests/server-auth-sessie.test.mjs` (Blobs-fout in de kern geeft 503 opslag-storing), `e2e/opstart-terugval.spec.mjs` |
| I2 korte limiet | gedaan | 43c0f10 | `sessie.test.mjs` (mock timers: start uit cache na 5 s, late 200 ververst, late 401 opent loginscherm), `instellingen-sync.test.mjs` (`resterendSyncBudget`), e2e: auth-ik hangt, app zichtbaar na ~5 s; late 401 opent het inlogscherm |
| I3 eenmalige upload technieker-instellingen | gedaan | `fix(instellingen)` e1810c1 | `instellingen-sync.test.mjs`: oude test "techniekers zonder waarde blijven ongemoeid" omgedraaid (die legde juist het verliesgedrag vast); nieuw: upload enkel op planner/beheerder, server wint bij waarden, eenmalig, retry bij mislukking, lege of vreemde cache niets |
| I4 verwijderen loggen | gedaan | `fix(rapporten)` 75881dd | `server-eigen.test.mjs` (technieker en planner loggen `rapport-verwijderd` met ticketnummer; 403/404 loggen niets); label in ACTIES, scan-test groen |
| M1 dev-server localhost | gedaan | `fix(beveiliging)` (M1+M4) | bronscan in `tests/lokale-dev.test.mjs` |
| M4 rapport-geweigerd dedupe | gedaan | idem | `logActiviteit({ uniek })` per maand/gebruiker/actie/onderwerp/details; `activiteit.test.mjs`, `server-upload-beveiliging.test.mjs` (4 pogingen = 1 regel) |
| M7 geen startlocatie van collega's voor technieker | gedaan | `fix(instellingen)` (M7) | `server-instellingen.test.mjs` |
| M5 loginpogingen per sleutel | uitgesteld (F14) | docs | raakt ~12 tests en vraagt opruiming van verlopen blobs per sleutel; alternatief 503 i.p.v. 429 genoteerd |
| M6 grens op anoniem scrypt-werk | uitgesteld (F15) | docs | zou in dezelfde pogingenblob moeten, verergert M5 |
| M2, M3, M8, M9, M10 | alleen buglijst (F12, F13, F16, F17, F18) | `docs:` | geen code |

Extra in de buglijst: F19 (Brent beslist: mag een technieker zijn eigen rapport verwijderen? nu ja, gelogd) en F20 (gevolg van M7: route van een collega rekent met de standaardstartlocatie voor een technieker).
Release-checklist (sectie 1b): traag netwerk/vliegtuigmodus, volgorde eerste dag (planner eerst), zohoNaam exact, outbox van vóór de update, koude start auth-login, Bearer-sleutel bij planning-export samengevoegd met bestaande regels.

## Ontwerp I1/I2 (kern/sessie.js)
- `haalAuthIk()` deelt elk antwoord in: ok / 401 / storing / serverfout / netwerk. Alles behalve ok en 401 valt terug op `blitz_sessie_cache`; zonder cache "geen verbinding".
- Met cache: `Promise.race` van de aanvraag en een 5 s-timer. Bij overschrijding start de app uit de cache; de lopende aanvraag wordt NIET afgebroken maar verwerkt (`verwerkLaat`): 401 of verplichte wachtwoordwijziging opent het gewone scherm via `laadSessie()`, 200 ververst gebruiker en rechten (andere gebruiker = herladen zoals voorheen).
- `startNaInlog` geeft `synchroniseerInstellingen` het resterende budget (`resterendSyncBudget`: 8 s min de wachttijd op auth-ik, begrensd tot 1 s..7 s). Enkel een opstart met cache telt mee; wie net inlogt behoudt het volle budget.

## Testresultaat
`node --test`: 1713/1713 groen. `npx playwright test` (chromium + sw): 637 van 639 groen in de volledige run; de twee missers (`route-tijden:87`, `sw/traag:34`) slaagden bij een afzonderlijke herhaling (bekende flakes onder belasting).
