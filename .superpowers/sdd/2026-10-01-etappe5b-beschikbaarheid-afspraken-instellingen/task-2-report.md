# Task 2 — klantbeschikbaarheid.js (rapport)

## Gebouwd
- `public/js/schermen/klantbeschikbaarheid.js`: `initKlantbeschikbaarheid(afh)` (strengeAfh), `kbFor/kbBlocked/kbPreferred/kbPreferredTime`, `loadKlantBeschikbaarheid`, `saveKlantBeschikbaarheid`, `gcKlantBeschikbaarheid`, `renderKbSection`, `saveKbAll`. `kbVersie` en `kbLocallyDeleted` module-privé.
- `public/js/schermen/klantbeschikbaarheid-logica.js` (puur): `voegSamenKb(server, lokaal, lokaalVerwijderd)`, `kbStand(draft, standaardDuur)` (dirty-handtekening), `verouderdeKbIds(items, liveIds, nu)` (GC-selectie).
- `tests/klantbeschikbaarheid-logica.test.mjs`: 7 tests, handberekend (lokaal verwijderd blijft verwijderd, serverwijziging ander ticket blijft, eigen wijziging wint, handtekening, GC 90 dagen).
- `index.html`: definities (state, load/save, GC, UI: 266 regels) weg; oproepplaatsen naar `kern.klantbeschikbaarheid.*` (duurVoor, afh van wachtrij/route/ticketdetail, DOMContentLoaded-load, `_applyTicketsData`-GC, `addTicketToDate`, `autoPlan` x2); init als eerste in DOMContentLoaded met afh `{ loadFromCache, saveToCache, zetKbDirty }`.
- `brug.js`: `window.kern.klantbeschikbaarheid`; geen nieuwe LEGACY-namen. `sw.js`: beide nieuwe bestanden in `SHELL`.

## D12 — verhuisde schrijffuncties
- `saveKlantBeschikbaarheid`: `kbVersie`/`kbLocallyDeleted` blijven module-privé (zelfde naam); `klantBeschikbaarheid` -> `toestand.get('klantBeschikbaarheid')` (waarde) en `toestand.set(...)` (na samenvoeging); `kern.api.bewaarMetVersie` -> import `bewaarMetVersie`; `export`. De `voegSamen`-callback delegeert aan de pure `voegSamenKb` (zelfde logica, bewust uit stap 2 van de brief; zelfde argumenten, zelfde commentaar). Verder byte voor byte (pad, veld, foutafhandeling, toasttekst).
- `saveKbAll`: `klantBeschikbaarheid`/`settings` -> één synchrone `toestand.get(...)`-lezing vóór het eerste await (commentaar), en na de await (`!ok`-terugdraaien) een verse `toestand.get('klantBeschikbaarheid')` (snapshot-regel: saveKlantBeschikbaarheid kan de toestand vervangen bij 409); `export`.
- `loadKlantBeschikbaarheid`: leest (geen backend-schrijf) `kern.api.apiJson` -> `apiJson`, `loadFromCache/saveToCache` -> `afh.`, toewijzingen -> `toestand.set`; de `saveToCache`-lezing na de await is live.
- `gcKlantBeschikbaarheid` (triggert een save): selectie via `verouderdeKbIds`, daarna in-place `delete` en `saveKlantBeschikbaarheid()` als er ids waren (zelfde als `changed`).

## Tests
- `node --test`: 663 pass (656 basis + 7 nieuwe). RED niet apart vertoond: logica en test zijn in dezelfde stap geschreven (pure functies uit bestaande code).
- `npx playwright test`: 388 passed.
- `--repeat-each=3`: conflict-409, voorstel-afspraak-blokkering, ticketdetail, vensters en e2e/productie: zie onderaan.

## Keuzes
- Geen `data-actie`/`registreerWijzigActies`: `renderKbSection` heeft geen HTML-string-handlers (alles `addEventListener` op dynamisch getekende velden, plus `input`/`change` op die velden), dus er is niets te converteren en geen "echte wijziging"-e2e nodig. Geen venster/backdrop: de sectie is geen dialoog, dus geen `registreerVenster`.
- `zetKbDirty` via afh (brief), waarde `kern.ticketdetail.zetKbIsDirty`; `ticketdetail.js` ongewijzigd (afh-sleutelnamen onveranderd, enkel de waarden in index.html).
- `loadFromCache`/`saveToCache` blijven klassieke helpers (ook door andere loaders gebruikt); via afh aangereikt.
- Bare-gebruikersaudit: geen bare gebruikers in modules buiten de afh-sleutels; `planner.js` bouwt eigen kb-lezers uit invoer. Geen e2e-spec gebruikte een kale kb-functie.

## Bugfixes
Geen.

## Zorgen
- Het basisgetal van `node --test` is 656 (brief); met de 7 nieuwe tests is het 663.
- De Zoho-blokken `addTicketToDate`/`autoPlan` zijn enkel in de naam van de aanroep gewijzigd (kern.klantbeschikbaarheid.*).
- --repeat-each=3 (conflict-409, voorstel-afspraak-blokkering, ticketdetail, vensters, e2e/productie): 558 passed, 0 failed.
