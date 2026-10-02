# Task 3 — beschikbaarheid.js (blokkeringen)

## Gebouwd
- `public/js/schermen/beschikbaarheid.js`: loadAvailability, saveAvailability, versie(), openBlockModal, closeBlock, renderBeschikbaarhedenTab (export); privé: renderBlockModal, avSet*/bavSet*, avAddException(+FromSettings), avRemoveException(+Group), formulierstatus `_avForm*`/`_bav*`, `avVersie`. Twee formulieren blijven afzonderlijk.
- `beschikbaarheid-logica.js`: `nextWorkday(dateStr, werkdagen)`, `groupExceptionsForDisplay(sortedList, werkdagen)` (pure parameter i.p.v. `settings.werkdagen`).
- Delegatie: data-actie `blok-sluit`, `av-scope|kind|toevoegen`, `bav-scope|kind|toevoegen`; data-wijzig `av-multiday|datum|datum-tot`, `bav-multiday|datum|datum-tot|filter-persoon`; `registreerBackdrop` + `registreerVenster`; tabelregel `block-overlay` uit `venster.js`.
- Brug: `kern.beschikbaarheid` (geen nieuwe LEGACY-namen); SHELL in sw.js (module + logica). Oproepers: kalender `openBlockModal`, `setSettingsTab`, opstart `loadAvailability`; `_bavFormDate`-initialisatie verhuisd van DOMContentLoaded naar `initBeschikbaarheid`. `kern.spec` gemigreerd naar `kern.beschikbaarheid.saveAvailability()/versie()`.
- Inline handlers in index.html: 19 verwijderd in totaal (waarvan 2 in het statische deel: block-overlay en sluitknop); `grep onclick="(avSet|bavSet|avAdd|closeBlock)` en `onchange="(_av|_bav|avSet|bavSet)` leeg.

## Tests
- Unit nieuw: `tests/beschikbaarheid-logica.test.mjs` (12; RED = module ontbrak, daarna GREEN), plus carry-over `voegSamenKb({}, {A:1}, new Set(['A']))` -> `{}`.
- `node --test`: 676 pass (663 + 12 + 1).
- Carry-over e2e (conflict-409): (1) gewiste kb-entry blijft weg na 409-merge+retry; mutatiecontrole: met `new Set()` i.p.v. `kbLocallyDeleted` faalt de test (daarna hersteld). (2) `!ok`-rollback in saveKbAll is bereikbaar via 409 gevolgd door 500 op de retry: test controleert foutmelding, herstelde entry en actieve Opslaan-knop.
- e2e nieuw in beschikbaarheid.spec: echte bubbling change op `bav-datum`/`bav-datum-tot`, status overleeft hertekenen.
- `npx playwright test`: 391 passed (388 + 3 nieuwe).
- `--repeat-each=3` op beschikbaarheid, voorstel-afspraak-blokkering, e2e/productie, conflict-409: 408 passed.

## D12
Letterlijk verhuisd, enkel voorvoegsels: saveAvailability (PUT via apiVerzoek met `{versie, exceptions}`, 409 -> server-stand overnemen + toast + renderBlockModal + return false, geen retry; niet via bewaarMetVersie, zoals voorheen), loadAvailability (cache-/fallbackgedrag ongewijzigd), avAddException/FromSettings (push + raak, rollback via filter), avRemoveException(+Group). Wijzigingen: `avExceptions = x` -> `toestand.set('avExceptions', x)`; reads `toestand.get(...)` inline en live (geen gehoiste snapshots, dus snapshotregel niet van toepassing; in loadAvailability staat een "live lezen na de await"-commentaar bij de cache-schrijfactie). Rollbacks na `await` lezen de actuele toestand. `avVersie` module-privé.

## Keuzes die ik maakte
- `nextWorkday`/`groupExceptionsForDisplay` krijgen `werkdagen` als parameter (pure module, briefsignatuur had enkel dateStr).
- Actienamen: `av-toevoegen` (brief noemde `blok-toevoegen`, maar er is geen statische toevoegknop; de enige statische knop is `blok-sluit`).
- Legacy HUIDIG GEDRAG-pins (meerdaags zonder einddatum, lege datum, datumveld in het venster) ongewijzigd groen.

## Bugfixes
Geen.

## Zelfreview / zorgen
- Geen bare-gebruikers van de verhuisde namen meer buiten de module (grep leeg); autoPlan/Zoho-code niet aangeraakt.
- Het statische index.html-commentaar (regel ~317/359/690) noemt nog de oude functienamen; bewust gelaten.
