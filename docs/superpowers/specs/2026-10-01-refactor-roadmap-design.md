# Volledige refactor — roadmap (design)

Datum: 2026-10-01 · Opdrachtgever: Brent Calaerts · Tak: `refactor` (worktree `.claude/worktrees/planner-brein`)

## 1. Doel en succes

Brent wil dat de refactor vier dingen oplevert:
1. **minder fouten**: een wijziging raakt niet onverwacht iets anders;
2. **sneller nieuwe functies**;
3. **beter voor de technieker**: snelheid en betrouwbaarheid op gsm en tablet;
4. **klaar voor groei**.

Succes betekent:
- Elk scherm-domein (route, kalender, wachtrij, ticketdetail, voorstel, beschikbaarheid, instellingen) staat in een eigen ES-module onder `public/js/`.
- `public/index.html` bevat alleen nog markup en een dunne opstartcode.
- De zuivere logica is unit-getest met `node --test`.
- De kernhandelingen worden afgedekt door een end-to-end testrobot (Playwright).
- Voor de gebruiker gedraagt alles zich identiek, behalve opgeloste bugs.

## 2. Rulings van Brent (2026-10-01)

| # | Onderwerp | Beslissing |
|---|---|---|
| W1 | Aanpak | Stap voor stap opsplitsen in ES-modules, zonder framework en zonder bouwstap. Een framework kan later per scherm, als de app sterk groeit. |
| W2 | Release | **Alles in één keer live** wanneer de volledige refactor klaar en getest is. Tot dan krijgt `main` alleen bugfixes (zie `CLAUDE.md`, "Branchbeleid"). |
| W3 | Etappe 8 (instellingen per technieker) | **Na** de release. |
| W4 | Goedkeuring | Claude keurt ontwerpen die alleen code herschikken zelf goed en logt ze als `Ruling:`. Claude stopt alleen bij een keuze die Brent merkt of moet beslissen: iets zichtbaars, een gedragswijziging of een nieuwe dependency. |
| W5 | Zichtbaar gedrag | Identiek. Duidelijke bugs die onderweg gevonden worden, mogen opgelost worden; ze komen in de CHANGELOG-sectie van de refactor-tak. |
| W6 | Testrobot | Playwright als devDependency, met Chromium. Goedgekeurd. |
| W7 | Proefperiode | **Alleen lokaal** (`?test` op deze laptop, met Claude erbij). Geen aparte proefsite. |
| W8 | Back-up | Pushen van de tak `refactor` naar GitHub mag, maar **pas nadat Brent bevestigt** dat "Branch deploys" in Netlify op "alleen productie" staat. Nooit een pull request voor `refactor`: deploy previews staan aan en zouden een werkende kopie bouwen die met het echte Zoho praat. |
| W9 | Communicatie | Alleen bij vragen en op het einde. |
| W10 | Doorwerken | Ook onbewaakt, met een heartbeat-cron en een lopende agent (skill `autonoom-doorwerken`). |
| W11 | Extra voorzichtigheid | De **rapportwizard** krijgt alleen de gedeelde hulpmiddelen, verder niets. Het **Zoho-verkeer** (statussen, datums, mails) gedraagt zich identiek, en elke aanraking wordt extra getest: unit-test en e2e met nep-Zoho. |
| W12 | Token-optimalisatie | Het juiste model en de juiste effort per taak; zie §5. |

## 3. Architectuur (doelbeeld)

- **`public/js/kern/`** — gedeelde fundamenten:
  - `toestand.js`: centrale toestand (tickets, planning, eigen afspraken, blokkeringen, klantbeschikbaarheid, voorstelstatus, instellingen, actieve technieker) met een eenvoudig **abonneer/verwittig**-mechanisme. Schermen worden zo automatisch opnieuw getekend als de gegevens wijzigen, en dat kan niet meer vergeten worden. Dit is het kernvoordeel van een framework, zonder het framework.
  - `selecties.js`: pure afleidingen, zoals `stopsVoorDag`, de tickets van de technieker en de dag-capaciteit. Vervangt de 30× herhaalde filter.
  - `tijd.js`: alle omzettingen tussen datum en tijd (lokaal versus UTC, 'HH:MM', minuten).
  - `api.js`: één fetch-helper met uniforme foutafhandeling en toast, plus de testmodus-header.
  - `ui.js`: toast, `escHtml` en event delegation (`data-actie`-attributen in plaats van inline `onclick`).
- **Schermmodules** (`public/js/schermen/`): `route.js` (+ kaart en drukte), `kalender.js`, `wachtrij.js`, `ticketdetail.js`, `voorstel.js`, `beschikbaarheid.js`, `instellingen.js`, `afspraken.js`.
  - Elke module krijgt `init()` en een render die op de toestand geabonneerd is.
  - De pure delen (berekeningen) staan in aparte, geteste bestanden.
- **Bestaande modules** (`planner.js`, `rapport-wizard.js`, `outbox.js`, `inventaris.js`, `prijzen.js`, …) blijven. Ze schakelen alleen over naar `kern/` waar ze nu `window.*` gebruiken (W11: de wizard minimaal).
- **Serverkant** (`netlify/lib/`): `zoho.js` (token, org en verzoek met foutafhandeling: vervangt 11 kopieën), `http.js` (CORS, JSON-antwoord, methodecontrole), en de bestaande `testmodus.js`.
- **Modules zonder bouwstap**: native `<script type="module">`. De service worker cachet ze (SHELL-lijst bijwerken).

## 4. Etappes (elk met een eigen spec → plan → uitvoering)

| # | Etappe | Kern | Afhankelijk van |
|---|---|---|---|
| 0 | **Vangnet** | Playwright e2e op `?test` voor de kernhandelingen: app laden als coördinator en als technieker, filter en technieker kiezen, "Plan deze week" met resultaatvenster, route berekenen, slepen en tijden vastleggen, ticketdetail openen, voorstel opstellen (zonder versturen), eigen afspraak toevoegen, blokkering, instellingen bewaren, rapportwizard doorlopen tot het voorbeeld (zonder versturen). Netwerk naar TomTom en Zoho gestubd met vaste antwoorden, zodat de tests deterministisch zijn en geen verbruik kosten. | — |
| 1 | Planner-brein | ✅ klaar (zie spec 2026-09-30) | — |
| 2 | **Fundament** | `kern/` (toestand + abonneren, selecties, tijd, api, ui). index.html gaat er stapsgewijs op over; dubbele hulpcode verdwijnt. | 0 |
| 3 | **Route en kaart** | `schermen/route.js`, één aankomsttijd-berekening (`berekenAankomsten` en `computeArrivalTimes` worden één, backlog-item), slepen, optimaliseren en tijden vastleggen, kaart en drukte. | 2 |
| 4 | **Kalender en wachtrij** | `schermen/kalender.js`, `wachtrij.js`; quickAdd en de capaciteitskop gaan over op het tijdlijnmodel van het brein, waar dat gedrag identiek houdt (anders gelogd). | 2 |
| 5 | **Detail en dialogen** | ticketdetail, voorstel en bevestiging, klantbeschikbaarheid, blokkeringen, eigen afspraken, instellingen; alle inline `onclick` vervangen door event delegation. Zoho-paden extra getest (W11). | 2 |
| 6 | **Serverkant** | `netlify/lib/zoho.js` en `http.js`; functies daarop overzetten, één voor één, met unit-tests (nep-fetch). | 0 (onafhankelijk van 2–5) |
| 7 | **Technieker** | laadsnelheid (modules pas laden als nodig), SW-caching van modules, gedrag bij een slechte verbinding (duidelijke melding, geen half-opgeslagen toestand). | 3–5 |
| 9 | **Proef en release** | lokale proefperiode met Brent (W7), eindreview van de hele refactor, versie (waarschijnlijk 2.0.0), CHANGELOG, merge naar main, push na Brents "ja". | alles |
| 8 | Instellingen per technieker | **na de release** (W3) | 9 |

Volgorde van uitvoering: 0 → 2 → 6 (kan tussendoor) → 3 → 4 → 5 → 7 → 9.

Bugfixes die intussen op `main` komen, worden na elke etappe binnengehaald (`git merge main`).

## 5. Werkwijze en token-optimalisatie (W12)

- **Per etappe**:
  - spec: Claude, kort, met de rulings;
  - plan: de skill `writing-plans`, in `docs/superpowers/plans/`;
  - uitvoering: `subagent-driven-development`, met een ledger per plan in `.superpowers/sdd/<plan>/`.
- **Modelkeuze** (altijd expliciet `model` meegeven):

  | Rol | Model |
  |---|---|
  | Verkennen, inventariseren, mechanische vervangingen met volledige instructie (bv. `onclick` → `data-actie`), CSS of labels | **haiku** |
  | Implementer met logica of integratie, taak-reviewer, scoped re-review | **sonnet** |
  | Eindreview per etappe | **sonnet**; alleen **opus** voor etappe 2 (fundament: alles bouwt erop) en voor de eindreview van de hele refactor vóór de release (etappe 9) |
  | Fix-escalatie (ronde 4–5) | één tier hoger dan de vastgelopen implementer |

- **Zuinig met context**:
  - briefs en diffs gaan als bestanden naar de subagents, nooit geplakt;
  - korte terugmeldingen (maximaal 15 regels);
  - kleine gelijksoortige wijzigingen worden gebundeld in één dispatch;
  - geen dubbele reviews.
- **Testen**:
  - `node --test` voor de logica;
  - Playwright voor de flows, na elke taak die een scherm raakt;
  - de ingebouwde browser alleen voor een visuele steekproef aan het einde van een etappe.
- **Dev-server**: elke agent stopt alleen zijn eigen proces, nooit alle node-processen.
- **Grenzen** (W11):
  - wijzigingen aan de wizard of aan Zoho-paden krijgen extra tests en worden in de review expliciet genoemd;
  - nooit echte Zoho-aanroepen of mails vanuit tests of agents.

## 6. Risico's en vangnetten

| Risico | Vangnet |
|---|---|
| Een grote release in één keer (W2) maakt fouten moeilijker te lokaliseren | Etappe 0 eerst. De e2e-suite draait na elke taak. Elke etappe eindigt groen. |
| De tak loopt uit de pas met bugfixes op `main` | Na elke etappe `git merge main` + volledige test. |
| Modules zonder bouwstap, en caching door de service worker | De SHELL-lijst wordt per etappe bijgewerkt; `CACHE_NAME` pas bij de release. |
| Verlies van lokaal werk (OneDrive) | Push van `refactor` naar GitHub na Brents bevestiging (W8). |
| Stille gedragswijziging in Zoho-verkeer | W11: nep-Zoho in e2e, request-payloads worden geasserteerd in de tests. |

## 7. Buiten scope

- Een framework of bouwstap (W1).
- Een visueel herontwerp; dat is het UI/UX-traject, dat apart loopt.
- Nieuwe functies, behalve etappe 8, die na de release komt.
- Een proefsite (W7).
