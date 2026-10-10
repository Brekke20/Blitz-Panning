# Fixronde na de eindreview (performance-dashboard)

Tak `refactor-dashboard`, vertrekpunt `6fe3bd0`. Niets gepusht, niets gemerged, geen stash, geen subagents.

## Commits

| Commit | Inhoud |
|---|---|
| `a0a27a3` | I1: annulatie-tegel toont het aantal van de gekozen periode zodra het log die periode dekt (`vanaf` bekend); enkel de vergelijking met de vorige periode verdwijnt, met de korte zin "geen vergelijking: de vorige periode valt (deels) vóór het log". "Het log start bij de livegang…" staat enkel nog bij `vanaf === null`. Test: go-live-week (3 en 0 annulaties), "Dit jaar" na juli (12), en het geval mét vergelijking. |
| `be1616a` | I2: datum intypen. Nieuwe `isGeldigeFilterDatum` (volledig, echte kalenderdatum, jaar 2000-2100). Bij een ongeldige of onvolledige datum (o.a. `0002-10-01` tijdens het intypen) blijft het filter ongemoeid: geen verzoek, geen hertekening. De filterrij wordt niet meer onder de vingers vervangen (enkel `aria-pressed` van de presets); `tekenFilters` laat een datumveld met focus staan (ook na de respons). Een ongewijzigde datum (bv. tussentijds teruggetypt) geeft geen verzoek. Unit-test + e2e met echt toetsenbord (`01092026`, nl-BE, cijfer voor cijfer). |
| `b42e750` | M1: `MAX_HERHAAL` 365 → 90 (gelijk aan `TERUGBLIK_DAGEN`); M3: plaatshouder-serienummers (nvt, n.v.t., n/a, -, 0, ?, onbekend, geen, leeg, ...) worden `''` en vallen terug op het adres. Tests. |
| `7b62d6c` | Docs: sectie G wordt "H. Performance-dashboard — open punten", G1-G8 → H1-H8, verwijzingen in `docs/release-checklist-2.0.md` aangepast; nieuwe punten H9 (sales-leads na 12 maanden gewist), H10 (M5 archief-herschrijving per upload), H11 (M9 tab-stops grafieken), H12 (M12 statische import); H3 vermeldt de I1-regel. |
| `cb85a52` | M2 titel "Bezoeken per dag/week per technieker" (de metric telt alle bezoeken); M4 geen "log start bij livegang"-zin bij een leesfout van het log; M6 voetnoot "% op tijd: op basis van x van y rapporten"; M7 vaste sales-noot (leads na 12 maanden gewist); M8 uitleg per richting bij de kleurgrenzen en koppen "Groene/Oranje drempel (%)"; tests aangepast/toegevoegd. |
| (laatste) | M10: RF6-grens van 2 s naar 10 s (onder belasting van de volle suite en andere agents haalde hij 3,3 s en zelfs 8 s). |

## Niet gedaan, in docs/bugs-en-open-punten.md gezet

- M5 (H10): archief-herschrijving per upload; meetbeslissing bij de release.
- M9 (H11): tab-stops in grafieken; toegankelijkheidsontwerp, niet in een fixronde.
- M11: opgelost met de hernummering G → H.
- M12 (H12): ter kennisname.

## Verificatie I2 in een echte browser

De e2e-test typt `01092026` met `page.keyboard.type` in het Van-veld (nl-BE, dag/maand/jaar). Tegen de oude code faalt hij
(het veld eindigt op `2026-10-01` in plaats van `2026-09-01`: de hertekening nam het veld-segment weg), met de nieuwe code
slaagt hij: exact één extra verzoek `van=2026-09-01&tot=2026-10-05&herhaal=30`, geen enkel verzoek met jaar `000x`, focus blijft op het veld,
"Zelf kiezen" staat ingedrukt. Een `fill('0002-09-01')` daarna geeft geen verzoek.

## Testaantal 2032 vs 2033

Het ledger meldt 2033, de reviewer telde 2032. Ik heb `node --test tests/*.test.mjs` gedraaid op een tijdelijke checkout van `e07feb9`
(de commit waarop 2033 gemeld werd) en op `6fe3bd0`: beide **2032**; tussen die twee commits is geen enkele test toegevoegd of verwijderd
(enkel de asserts in `tests/grafiek-ring.test.mjs` zijn aangepast). De 2033 in het ledger is dus niet reproduceerbaar op de commit
(vermoedelijk een telfout of een niet-gecommit bestand in de werkmap van de implementer). Na deze ronde: 2032 + 5 nieuwe tests = **2037**.

## Testresultaten

- `node --test tests/*.test.mjs`: 2037/2037 (de RF6-test slaagde apart in 2,3 s; in de volle suite onder belasting door andere agents faalde hij eerder op de oude grens van 5 s, daarom 10 s).
- `e2e/performance.spec.mjs`: 21/21 (incl. nieuwe datum-intypen-test).
- Volledige `npx playwright test` (660 tests): 655 geslaagd, 3 gefaald: `rollen.spec.mjs:76` (`net::ERR_NETWORK_CHANGED` op css-bestanden, netwerkwissel op de machine) en twee SW-specs (`navigator.serviceWorker.ready` time-out onder parallelle belasting). Apart herdraaid: `rollen.spec.mjs` 15/15 groen; het hele project `sw` serieel (`--workers=1`) 14/14 groen (parallel faalden er bij een tweede run andere SW-tests, dus load-flake, niet reproduceerbaar en geen relatie met deze wijzigingen: `sw.js` en de SW-specs zijn ongewijzigd). Netto: alle 660 groen.

## Opmerking

Een achtergebleven `blobs-local-bootstrap.mjs`-proces uit deze werkmap (gestart tijdens de volle e2e-run) is gestopt; er draaien geen processen van deze werkmap meer.


Bij het opruimen van een tijdelijke `git worktree` (voor het tellen van de tests) bleef de map `.git/worktrees/wt-e07` achter (Windows/OneDrive "Permission denied"); een `git worktree prune` mislukte op dezelfde manier voor reeds bestaande verouderde worktree-mappen. Er is niets verwijderd of gewijzigd aan andere worktrees.
