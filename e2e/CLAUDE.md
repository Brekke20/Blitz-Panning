# e2e — productiemodus- en service worker-tests

Verplaatst uit de CLAUDE.md in de hoofdmap (2026-10-29); laadt enkel bij werk in deze map. De algemene regels staan in de hoofdmap.

### Productiemodus-tests

Productietests staan in `e2e/productie/` en draaien de app zonder `?test` querystring tegen een volledig gestubde backend. Het doel: de Zoho-berichten van planning, voorstel en annuleren precies controleren.

- Fixture `e2e/productie-hulp.mjs` (enkel hieruit importeren, nooit `helpers.mjs` of `@playwright/test`; `serviceWorkers: 'block'` staat ook in de fixture): `startAppProductie()` met rol/technieker/opties, `zohoStubs()` met nep-endpoints voor `plan`, `plan-datum`, `propose`, `voorstel-status`, `annuleer` en `optimize`, `settle`/`openKalender` als wachthulpen (geen `waitForTimeout`).
- `verwachtSchrijven(verzoeken, paden)`: whitelist per test; elk niet-GET verzoek naar de eigen server buiten de lijst faalt.
- `verwachtHttpFout(verzoeken, fouten)`: per test gescoped; faalt ook als de verwachte HTTP-fout niet voorkwam.
- `e2e/productie-waarnemer.mjs`: de waarnemer die lekmeldingen, onverwachte verzoeken en consolefouten bijhoudt, plus de alleen-lezen weergaven (`alleenLezen`, `origineelVan`) zodat een spec ze niet kan wissen of wijzigen; enkel de fixture en de zelftest importeren hem.
- `e2e/vangnet-regels.mjs`: `isToegestaan`, de regels van de extra route met voorrang (geen Zoho/TomTom/mail, CDN enkel GET/HEAD); unit-getest in `tests/e2e-vangnet.test.mjs`.
- WebSocket-slot (`zetWebSocketSlot`): elke WebSocket-verbinding faalt de test.
- Parity-tests: `e2e/tickets-pariteit.spec.mjs` (aparte `?test`-spec: `e2e/fixtures/tickets.json` is gelijk aan `DUMMY_DATA` in `index.html`) en `tests/e2e-annuleer-redenen.test.mjs` (`ANNULEER_REDENEN` in de fixture is gelijk aan `REDENEN` in `netlify/lib/annulatie.js`).
- Importguard `tests/e2e-import-guard.test.mjs` (draait bij elke `node --test`, scant `e2e/` recursief): een spec importeert `test` enkel uit de juiste fixture (`./helpers.mjs` of, onder `e2e/productie/`, `../productie-hulp.mjs`); geen `@playwright/test` rechtstreeks; productiebestanden hebben geen eigen routes, geen `waitForTimeout`, geen `?test`/`X-Blitz-Test`, geen eval/`child_process`/`vm`/`createRequire`, geen `page.request`/`context.request`/`request`-fixture, geen `browser.newContext`/`newPage`, geen `node:http`/`https`/`net`/`tls`/`dns`/`http2` en geen `fetch(`; de ontsnappingskleppen van de waarnemer enkel in de zelftest.
- Zelftest `e2e/productie/vangnet-zelftest.spec.mjs` (met `zelftest-hulp.mjs`): bewijst op de echte host dat Zoho, TomTom, smtp, POST naar de CDN, WebSockets en onbekende `/api`-paden geblokkeerd of gemeld worden, dat de whitelist en de alleen-lezen weergaven werken en dat `verwachtHttpFout` faalt als de fout uitblijft.

### Service worker-tests (project `sw`)

Specs in `e2e/sw/` draaien met een ECHTE service worker (`serviceWorkers: 'allow'`) in het aparte Playwright-project `sw`; het project `chromium` blijft `serviceWorkers: 'block'` en negeert `e2e/sw/**`. Draaien: `npx playwright test --project=sw`. Ze zijn apart omdat een echte SW het verkeer van alle andere specs zou veranderen (cache, offline start) en omdat ze extra sloten nodig hebben.

- Fixture `e2e/sw-hulp.mjs` (enkel hieruit importeren, nooit `helpers.mjs`, `productie-hulp.mjs` of `@playwright/test`): bovenop de zes sloten van de productiemodus (host-toelatingslijst, `/api` gestubd, schrijfpaden-whitelist, `isToegestaan`, WebSocket-slot, geen testmodus-signalen; ze zien ook het verkeer van de SW zelf) komen een SW-waarnemer (`e2e/sw-waarnemer.mjs`: een verzoek van de SW naar `/api`, een niet-GET of een vreemde host faalt de test) en het browserslot `--host-resolver-rules` in `playwright.config.mjs` (buiten localhost en de twee CDN-hosts lost niets op, ook niet voor de SW). Geen `?test`.
- De `sw`-fixture bedient offline-modus (`zetOffline`), traag verkeer (`hangVoor`, `vertraag`, `breekAf`), een eigen `navTimeout` (`registreerSwMetNavTimeout`) en het vervangen van `sw.js`. `serviceWorkers` en `setOffline` mogen enkel in `e2e/sw-hulp.mjs` voorkomen; de importguard (`tests/e2e-import-guard.test.mjs`, derde klasse "sw-bestanden") dwingt dat af, naast alle productieregels (geen eigen routes, geen `waitForTimeout`, geen `test.use`/`test.extend`).
- Het updatepad (oude SW naar nieuwe SW) wordt getest met een bevroren kopie van de live-SW: `e2e/fixtures/sw-v25-main.js` (`e2e/sw/update.spec.mjs`). Elke test draait in een verse browsercontext, dus `CACHE_NAME` hoeft voor de tests niet te veranderen.
- Zelftest `e2e/sw/vangnet-zelftest.spec.mjs` bewijst dat de sloten ook voor SW-verkeer werken.

Nieuwe fixture-helpers van etappe 7 (productie-fixture `e2e/productie-hulp.mjs`, ook via `sw-hulp.mjs`):
- `zetAntwoord(naam, { afbreken: 'failed' })` en een hangend antwoord om een time-out of netwerkfout na te bootsen; `verwachtNetwerkFout(verzoeken, [{ pad, methode }])` laat precies die netwerkfout (eenmalig, op pad, methode en eigen origin) toe en faalt als ze uitblijft.
- `verwachtConsoleFout(verzoeken, fouten)`: een toegelaten consolefout, exact of als `RegExp`; een lege of te losse waarde wordt geweigerd.
- `startAppProductie(page, { klok: false })` laat de echte klok lopen; standaard staat de nepklok (`page.clock`) aan en laten tests timers lopen met `page.clock.runFor`.
- `staaOfflineSwFoutenToe` / `herroepOfflineSwFoutenToe` (enkel voor de `sw`-fixture, smal en herroepbaar) en `OPSTART_SCHRIJVEN`.
