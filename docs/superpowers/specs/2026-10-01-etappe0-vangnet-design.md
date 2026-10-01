# Etappe 0 — Vangnet (Playwright e2e testrobot) — design

Datum: 2026-10-01 · Opdrachtgever: Brent Calaerts · Tak: `refactor` · Basis: roadmap `2026-10-01-refactor-roadmap-design.md` (W1–W12)

## 1. Doel

Een **deterministische end-to-end testrobot** die het HUIDIGE gedrag van de app vastlegt, vóór de
etappes 2–7 `public/index.html` herstructureren. De suite draait na elke taak die een scherm raakt.
Slaagt ze vóór en na een wijziging, dan gedraagt de app zich voor de gebruiker identiek (W5).

Succes betekent:
- de kernhandelingen uit roadmap §4 (rij 0) zijn gedekt, als coördinator én als technieker;
- de suite is **herhaalbaar**: dezelfde uitkomst bij elke run, ongeacht datum, netwerk of server;
- er gaat **nooit** een verzoek naar TomTom, Zoho of een mailserver (W11);
- de volledige suite draait in minder dan 2 minuten;
- de app zelf verandert niet (hooguit onzichtbare `data-testid`-attributen).

## 2. Rulings

| # | Onderwerp | Beslissing | Reden |
|---|---|---|---|
| E1 | Tool | `@playwright/test` als devDependency, enkel Chromium (`npx playwright install chromium`) | W6 (goedgekeurd) |
| E2 | Mapnamen | Config `playwright.config.mjs` in de root; tests in `e2e/*.spec.mjs`; hulpcode in `e2e/helpers.mjs`; fixtures in `e2e/fixtures/` | Gecontroleerd op Node 24: `node --test` pikt alleen `*.test.*`, `*-test.*`, `*_test.*`, `test-*.*`, `test.*` en mappen `test/` op. `e2e/*.spec.mjs` en `helpers.mjs` vallen erbuiten (geprobeerd: het aantal tests bleef 136). **Verboden namen in `e2e/`**: alles dat met `test-` begint of op `.test.mjs` eindigt. |
| E3 | Server | Een eigen statische server `e2e/statische-server.mjs` (enkel `public/`, poort **3338**, geen `/api`), gestart via Playwright `webServer`. Niet `dev-server.mjs` of `blobs-local-bootstrap.mjs`. | Alle `/api/*` wordt gestubd, dus de functies zijn niet nodig. Zo vereist de suite geen `.env.local` (geheimen) en geen Blobs-emulatie, en kan een verzoek de backend niet per ongeluk bereiken. Een eigen poort voorkomt dat de test tegen een dev-server draait die uit een andere checkout (bv. `main`) serveert. `reuseExistingServer: false`. |
| E4 | Vangnetroute | **Elk** `/api/*`-verzoek wordt afgevangen met `page.route`. Een catch-all beantwoordt een niet-gestubd eindpunt met status 599 en registreert het; elke test faalt in `afterEach` als zo'n verzoek voorkwam. | Bewijsbaar nooit Zoho/TomTom/mail, en een nieuw eindpunt in de app valt meteen op. |
| E5 | Stubs per eindpunt | Zie §4. TomTom-eindpunten (`matrix`, `route`, `optimize`, `drukte`): vaste fixtures, afgeleid van het verzoek. Opslag-eindpunten (`afspraken`, `availability`, `klantbeschikbaarheid`, `voorstel-status`, `rapport-archief`, `inventaris`, `prijzen`, `fotos`): kleine **stateful** in-memory nep per test. Schrijf- en mail-eindpunten (`propose`, `plan`, `plan-datum`, `annuleer`, `comment`, `send-rapport`, `rapport`, `rapport-verzonden`, `testdata`, `client-log`): neutraal succesantwoord, **maar elke aanroep wordt geregistreerd** zodat tests kunnen asserteren dat ze (niet) plaatsvonden. | Determinisme zonder de functies te draaien; payloads blijven controleerbaar (W11). Geen enkel eindpunt mag de echte functie in testmodus aanroepen: ook die zijn niet bewezen vrij van TomTom/Zoho. |
| E6 | Klok | `page.clock.install({ time })` vóór `goto`, met maandag 2026-10-05 09:00 Europe/Brussels (+02:00, zomertijd tot 25/10). `timezoneId: 'Europe/Brussels'`, `locale: 'nl-BE'` in de config. De klok loopt daarna gewoon door. | "Vandaag", weekindeling, `DUMMY_DATA` (datums relatief aan nu) en wachtdagen zijn vast. |
| E7 | Service worker | `serviceWorkers: 'block'` | Geen cache die tussen tests lekt; geen SW-registratiefout. |
| E8 | Testmodus | De app laadt altijd via `/?test`: `DUMMY_DATA` (3 te plannen, 2 wachtend, 1 gepland), en `addTicketToDate`, `sendProposal`, `verstuurRapport` hebben een `TEST_MODE`-tak die niet naar Zoho schrijft. De stubs zijn een **tweede** slot, niet het enige. | Dubbele beveiliging (W11). |
| E9 | Rol en filter | Rol via `localStorage.blitz_rol` (`coordinator` / `technieker`), technieker via `localStorage.blitz_active_person`, vóór het laden gezet met `page.addInitScript`. De tablet-rolvraag ("Wie gebruikt deze tablet?") krijgt één eigen test op een tabletviewport met aanraak. | Dat zijn de echte opslagplekken (`apparaat.js`, `DOMContentLoaded`); de test hoeft zo niet door een dialoog. |
| E10 | Asserties | Gedragsmatig: zichtbare tekst, aantal elementen, request-payloads. **Geen screenshots of visuele snapshots.** | Snapshots breken bij elke UI/UX-fase en zijn waardeloos als vangnet voor herstructurering. |
| E11 | Locators | Rollen en tekst eerst (`getByRole`, `getByText`); bestaande `id`'s zijn toegestaan (`#btn-autoplan`, `#tab-planning`, …). Alleen waar dat niet volstaat een `data-testid` toevoegen (onzichtbaar, geen gedrag). Er bestaan er nog geen (gecontroleerd: 0 in `index.html` en `public/js/`). Elke toevoeging wordt in de commit genoemd. | W5: zichtbaar gedrag identiek. |
| E12 | Voorstel en rapport | Alleen UI aansturen. Voorstel: modal openen, voorbeeld controleren, **niet** op "Verstuur voorstel" klikken. Rapportwizard: stappen doorlopen tot het voorbeeld, niet versturen. In `afterEach` geldt voor alle tests: nul aanroepen van `propose`, `annuleer`, `send-rapport`, `rapport`, `rapport-verzonden`, `plan`, `plan-datum`, `comment`. | W11. |
| E13 | Consolefouten | De rooktest faalt bij elke `console.error`, `pageerror` of mislukt verzoek. Bekende ruis wordt **eerst onderzocht** (Taak 1): de "An unknown error occurred when fetching the script" (×2–3) is vrijwel zeker de service-worker-registratie (`index.html:1002`) en verdwijnt met E7; de eenmalige 400 wordt herleid tot één eindpunt. Wat overblijft komt op een allowlist in `helpers.mjs`, met een precieze patroonmatch en één regel uitleg per item (nooit een brede). Is de oorzaak een triviale app-bug, dan wordt hij als bugfix opgelost en in de CHANGELOG-sectie van de refactor-tak vermeld (W5). | Een rooktest met een brede allowlist is geen vangnet. |
| E14 | Scripts | `package.json`: `"test:e2e": "playwright test"`. `node --test` blijft ongewijzigd; er komt geen `test`-script bij. | Twee aparte suites, elk met één commando. |
| E15 | Uitvoering | `reporter: 'list'`; trace `retain-on-failure`; 1 retry in CI, 0 lokaal; `test-results/` en `playwright-report/` in `.gitignore`. Bestanden mogen parallel draaien (eigen pagina en eigen nep-backend per test). | Snelheid (< 2 min) en geen vervuiling van de repo. |

## 3. Werking

```
npx playwright test
  └─ webServer: node e2e/statische-server.mjs  (poort 3338, serveert public/)
  └─ per test: startApp(page, { rol, technieker })
        1. addInitScript: localStorage (rol, technieker, thema)
        2. page.clock.install(vaste datum)
        3. stubExtern(page): catch-all + alle eindpunten (§4)
        4. goto('/?test'), wacht tot de wachtrij getekend is
  └─ afterEach: onverwachte verzoeken? verboden aanroepen? consolefouten? → test faalt
```

## 4. Eindpunten

| Eindpunt | Gebruikt door | Stub |
|---|---|---|
| `/api/matrix` | "Plan deze week" (brein) | vaste reistijd (20 min) tussen elk paar, in het formaat dat `index.html` verwacht |
| `/api/route`, `/api/optimize` | route berekenen, optimaliseren, rapportwizard | vaste route (volgorde = invoer, vaste duur en afstand per been) |
| `/api/drukte` | drukte op de kaart na de route | vlak antwoord (geen drukte) |
| `/api/tickets` | niet gebruikt in `?test` (dummy data) | vangnet 599: wordt het toch aangeroepen, dan faalt de test |
| `/api/planning-sinds` | "In planning sinds" | vaste ISO-datums per ticket-id |
| `/api/afspraken`, `/api/availability`, `/api/klantbeschikbaarheid`, `/api/voorstel-status`, `/api/rapport-archief`, `/api/inventaris`, `/api/prijzen`, `/api/fotos` | laden en opslaan | stateful nep (versienummer meeliften, zoals de echte functies) |
| `/api/plan`, `/api/plan-datum`, `/api/propose`, `/api/annuleer`, `/api/comment`, `/api/send-rapport`, `/api/rapport`, `/api/rapport-verzonden`, `/api/testdata`, `/api/client-log` | schrijven naar Zoho, mailen | neutraal succes; aanroepen geregistreerd. In `?test` horen er geen of bijna geen voor te komen. |
| overig `/api/*` | — | vangnet 599 |

De exacte antwoordvormen leest de implementer uit `netlify/functions/*.js` en de aanroepers in
`index.html`; ze komen als JSON of als kleine functies in `e2e/fixtures/`.

## 5. Dekking

| Spec-bestand | Flows |
|---|---|
| `rooktest.spec.mjs` | app laden (coördinator): geen consolefouten, wachtrij toont 3 tickets, TEST-badge zichtbaar |
| `laden-en-rol.spec.mjs` | laden als coördinator (alle tabs); laden als technieker (`coord-only`-tabs verborgen); technieker kiezen via de persoonsmenu → wachtrij gefilterd; tablet-rolvraag |
| `ticketdetail.spec.mjs` | ticket openen: onderwerp, adres, "In planning sinds"; sluiten |
| `plan-week.spec.mjs` | "⚡ Plan deze week" bij een gekozen technieker → resultaatvenster met "Ingepland (n)" en "Niet ingepland (m)" met redentekst; "Iedereen" → toast "Kies eerst een technieker", geen `matrix`-verzoek |
| `route.spec.mjs` | route-tab: "Route berekenen"; stops slepen → volgorde en tijden veranderen; "Tijden vastleggen" |
| `voorstel-afspraak-blokkering.spec.mjs` | voorstel-modal: openen, ontvangers en voorbeeld, **niet versturen**; eigen afspraak toevoegen (verschijnt in de kalender); blokkering (uitzondering) toevoegen |
| `instellingen-rapport.spec.mjs` | instellingen bewaren (incl. validatie "Laatste start moet tussen begin- en eindtijd liggen"); rapportwizard tot voorbeeld, nul verzend-verzoeken |

## 6. Risico's

| Risico | Vangnet |
|---|---|
| Flaky door timers (`setTimeout` 400–600 ms in testmodus, scrollherstel) | Alleen wachten op zichtbare toestand (`expect(...).toBeVisible()`), nooit een vaste `waitForTimeout`. Elk bestand 3× achter elkaar groen vóór de laatste commit (Taak 7). |
| Slepen is in Playwright wankel | `locator.dragTo` met stappen; werkt dat niet, dan pointer-events rechtstreeks (`mouse.down/move/up`). De test beschrijft het resultaat (nieuwe volgorde), niet het mechanisme. |
| Suite slaagt maar test niets (vals vertrouwen) | Taak 7: per flow één opzettelijke sabotage in de app, vaststellen dat de test faalt, daarna terugzetten. |
| Tests koppelen aan opmaak | E10/E11: geen snapshots, geen CSS-selectors behalve bestaande `id`'s. |

## 7. Buiten scope

- Visuele regressie, prestatiemetingen, andere browsers.
- Echte integratietests met Zoho (daar zijn de unit-tests met nep-fetch van etappe 6 voor).
- Het daadwerkelijk versturen van voorstel of rapport, ook in testmodus (kan later per etappe 5 als demo-send-test).
