# Kleine fouten (B1–B16, B7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De bekende fouten en ongemakken B1, B2, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14 en B16 uit `docs/bugs-en-open-punten.md` zijn opgelost vóór v2.0.0, elk met een bewuste omkering van de test die het oude gedrag vastlegde. B3 en B17 blijven bewust zoals ze zijn.

**Architecture:** Geen nieuwe serverfuncties en geen nieuw datamodel. Eén kleine serverwijziging (`propose.js` meldt bij een fout ná de mails welke mails vertrokken zijn). De rest zijn gerichte clientwijzigingen in de bestaande schermen, met de nieuwe logica in kleine, apart testbare modules: `schermen/voorstel-register.js` (voorstelregister bewaren zonder verlies, adres→doelgroep), `schermen/rapport-verzend-melding.js` (één melding met alle mislukte statusupdates), `rapport-aanrijtijd.js` (aanrijtijd berekenen zonder stille 0), plus kleine uitbreidingen van `kern/mailcontrole.js`, `schermen/beschikbaarheid-logica.js`, `schermen/afspraken-logica.js` en `planner-tijdlijn.js`/`schermen/capaciteit.js`. Alles wat een klantmail of een Zoho-status raakt is apart gegroepeerd en gemarkeerd (**LIVE-KRITIEK**).

**Tech Stack:** vanilla ES-modules zonder bouwstap, Netlify Functions v1 (`propose.js`), `node --test` (nep-fetch via `kern/api.js` `zetFetch`, nep-store), `@playwright/test` (project `chromium`, productietests via `e2e/productie-hulp.mjs`). Geen nieuwe dependencies.

**Spec:** geen aparte spec. Bindend zijn sectie **E** ("Beslissingen Brent (2026-10-08) over deel B en C") van `docs/bugs-en-open-punten.md` en de omschrijvingen van B1–B16 en C1–C4 in sectie B/C van datzelfde bestand. Regelnummers in dit plan verwijzen naar de tak `refactor-logins` (= `refactor` + logins); het plan wordt uitgevoerd ná de merge van `refactor-logins` in `refactor`, de nummers kunnen dan enkele regels verschoven zijn (zoek op functienaam).

## Global Constraints

- **Branchbeleid (CLAUDE.md):** dit is nieuw werk en hoort op `refactor`. Werk op een nieuwe tak `refactor-kleine-fouten` vanaf `refactor` (worktree `.claude/worktrees/refactor-kleine-fouten`). **Nooit** mergen of pushen naar `main`; de pre-push-hook blokkeert dat en wordt nooit omzeild (`--no-verify` verboden). Pushen en mergen naar `refactor` doet de opzichter na akkoord van Brent.
- **Geen versie-bump:** `package.json` en `CACHE_NAME` in `public/sw.js` blijven ongewijzigd. Wijzigingen komen in `CHANGELOG.md` onder "Refactor-tak — nog niet uitgebracht" (sectie **Fixed**, Task 12). De ExcelJS-regel is hier niet van toepassing.
- **Kleine modules, Nederlandse namen:** nieuwe logica in aparte bestanden (zie Architecture), geen groei van `public/index.html` en `public/js/app.js` buiten één wiring-regel waar het plan dat uitdrukkelijk vermeldt. Pure logica zonder DOM; schermcode raakt `document` enkel binnen functies; geen nieuwe `window.<naam>`-toewijzing buiten `kern/brug.js` (`tests/window-namen.test.mjs`).
- **Elk nieuw `public/js/**/*.js`-bestand** (Task 5, 1, 7) krijgt een pad in `SHELL` van `public/sw.js` en, als het statisch geïmporteerd wordt, één `<link rel="modulepreload">` in `public/index.html` (`tests/sw-schil.test.mjs` dwingt dit af).
- **Geen echte Zoho- of TomTom-aanroepen in tests.** Node-tests: `zetFetch`/`maakNepFetch` (`tests/nep-fetch.mjs`), nep-store (`tests/nep-blobs.mjs`). E2E: enkel de stubs van `e2e/productie-hulp.mjs` (`zohoStubs`, `z.zetAntwoord`, `z.forceerConflicten`); nooit `?test`-uitzonderingen toevoegen, nooit `waitForTimeout`, nooit eigen routes (`tests/e2e-import-guard.test.mjs`). Lokale browsercontrole altijd via `http://localhost:3333/?test`.
- **Nieuwe serverfuncties:** er komen er geen. Mocht een taak er toch een nodig hebben, dan hoort er een rij in `netlify/lib/rechten.js` bij en een `beveiligV1`/`beveiligV2`-omhulling (`tests/rechten.test.mjs` faalt anders). `propose.js` blijft `beveiligV1('propose', …)` met rij `{ POST: COORD }`.
- **Nooit een tweede klantmail:** geen enkele taak mag zelf `/api/propose` of `/api/send-rapport` (opnieuw) aanroepen. `/api/mail-check` blijft enkel lezen.
- **Bewuste omkering van vastgelegd gedrag:** elke test die een fout "zoals ze nu werkt" vastlegt (tag `HUIDIG GEDRAG (bug?)` in de spec of de naam) wordt in dezelfde taak omgedraaid: nieuwe testnaam zonder `HUIDIG GEDRAG`, nieuwe assertion, en de uitleg-regel in de spec bijgewerkt. Per taak staat de lijst bij "Omgekeerde tests". Een test omdraaien zonder dat hij eerst rood werd op de oude code is niet toegestaan.
- **Stijl:** UI-teksten Nederlands, exact zoals vermeld; commits klein, per taak, prefix `fix(...)`/`test(...)`/`docs(...)`, elke commit eindigt met `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Modelkeuze per taak (project): sonnet voor implementatie en review, haiku enkel voor exploratie; de LIVE-KRITIEKE taken (2, 3, 4, 5, 6) krijgen een eindreview door opus.
- **Opruimen:** na elke taak die een server of Playwright draaide: skill `opruimen-na-werk` (poort 3333/3338 vrij, geen achtergebleven node/chrome).

## Review Focus

1. **Nooit een tweede of vergeten klantmail.** "Verzonden" wordt enkel gezet op basis van (a) `emailSent` van de server of (b) een zekere, per adres bevestigde uitkomst van `/api/mail-check`; een gedeeltelijk resultaat (1 van 2 ontvangers) vinkt enkel de gevonden doelgroepen aan en houdt de waarschuwing "kijk dit na in Zoho" (Task 2, 3, 6).
2. **De registratie van een al verzonden mail gaat niet verloren.** Voorstelregister: twee pogingen met versie, een derde zonder versie (enkel het eigen ticket wordt vervangen, `reset: true`); rapportstatus na een gevonden mail: zonder `versie`; faalt het toch, dan een zichtbare melding "NIET opnieuw versturen" (Task 3, 5, 6).
3. **Een fout ná de mail is nooit meer stil.** `propose.js` antwoordt bij een mislukte ticket-update met `emailSent`/`fouten`/`ontvangers`; de client waarschuwt dan, sluit het venster, schrijft het register en leest de tickets opnieuw (Task 4, 6). Een 500 zonder `emailSent` blijft een gewone fout.
4. **Elke omgekeerde test is bewust en volledig.** Per taak staat welke `HUIDIG GEDRAG`-test omslaat; niet-gepinde teksten en de overige tests (o.a. B3 en B17) blijven ongewijzigd groen.
5. **Zichtbare stille waarden zijn weg:** aanrijtijd nooit stil 0 (Task 7), geen blokkering met lege datum of één dag i.p.v. een periode (Task 8), geen focus/cursor/instelling die "blijft hangen" (Task 10), en B10/B16 raken de route- en capaciteitslogica niet (alleen weergave resp. voorstel van het uur).

Verder in de tests verwerkt: HTML in vrije tekst (`laatsteFout`, notitie, titel, fouttekst van de server) blijft via `escHtml`/`textContent` lopen; geen nieuwe `innerHTML` met ruwe tekst.

## Buiten bereik (bewust niet gedaan)

- **B3** (annuleren, server valt weg ná de annulatiemail): de bestaande melding volstaat (Brent). De test `e2e/productie/annuleren.spec.mjs` ("HUIDIG GEDRAG (bug?)", rond regel 396) blijft ongewijzigd.
- **B17** (route slepen, verversing breekt het slepen af): zeldzaam, bewust zo gelaten. `e2e/route-slepen-render.spec.mjs` blijft ongewijzigd.
- **C1:** de tekst "Geen tickets om in te plannen" is goed; niets te doen.
- **B15** is al opgelost (proefverzoek 2).
- De rapportwizard wordt **niet** herwerkt: enkel Task 7 raakt hem, gericht op de aanrijtijd. De foto's-zonder-verbinding-kwestie uit B7 blijft zoals ze is (Brent: enkel de aanrijtijd).

## Bestandsoverzicht

| Bestand | Taak | Actie |
|---|---|---|
| `public/js/schermen/rapport-verzend-melding.js` | 1 | nieuw (pure melding) |
| `public/js/schermen/rapport-verzenden.js` | 1, 3 | wijzigen (`verstuurRapport`, `voorbeeldRapport`, `naOnzekerRapport`) |
| `public/js/kern/mailcontrole.js` | 2 | wijzigen (`gevonden`, `mailControleAfsluiting`) |
| `netlify/functions/propose.js` | 4 | wijzigen (antwoord bij fout ná de mails) |
| `public/js/schermen/voorstel-register.js` | 5 | nieuw (registreren zonder verlies, adres→doelgroep) |
| `public/js/schermen/voorstel.js` | 5, 6 | wijzigen (`sendProposal`, `naOnzekerVoorstel`) |
| `public/js/rapport-aanrijtijd.js` | 7 | nieuw |
| `public/js/rapport-wizard.js` | 7 | wijzigen (aanrijtijd-blok in `openRapportIntern`, stap Facturatie) |
| `public/js/schermen/beschikbaarheid-logica.js`, `beschikbaarheid.js` | 8, 10 | wijzigen |
| `public/js/schermen/afspraken-logica.js`, `afspraken.js`, `kalender.js` | 9 | wijzigen |
| `public/js/schermen/instellingen.js`, `public/js/prijzen.js` | 10 | wijzigen |
| `public/js/planner-tijdlijn.js`, `schermen/capaciteit.js`, `schermen/ticketdetail.js`, `schermen/kalender.js`, `public/js/app.js` (1 wiring-regel) | 11 | wijzigen |
| `public/sw.js` (SHELL), `public/index.html` (modulepreload) | 1, 5, 7 | één regel per nieuwe module |
| `CHANGELOG.md`, `docs/bugs-en-open-punten.md`, `docs/release-checklist-2.0.md` | 12 | bijwerken |

---

### Task 0: Worktree en baseline

**Files:** geen codewijzigingen.

**Interfaces:**
- Produces: worktree `.claude/worktrees/refactor-kleine-fouten` op tak `refactor-kleine-fouten` (vanaf `refactor`, ná de merge van `refactor-logins`), met `node_modules`.

- [ ] **Step 1:** `git worktree add .claude/worktrees/refactor-kleine-fouten -b refactor-kleine-fouten refactor` (skill `superpowers:using-git-worktrees`). Verifieer met `git branch --show-current` vóór elke commit; elke Bash-call met `cd "<worktree>" && …` (bekende valkuil: subagents die in een andere checkout committen).
- [ ] **Step 2:** `npm ci`. Controleer dat de regelverwijzingen van dit plan nog kloppen: `grep -n "schrijfStatus\|HUIDIG GEDRAG" public/js/schermen/voorstel.js e2e -r`. Verschuivingen zijn geen probleem, ontbrekende functies wel (dan eerst de opzichter raadplegen).
- [ ] **Step 3: Baseline.** `node --test` (volledig) en `npx playwright test --project=chromium` (volledig). Noteer het aantal geslaagde tests van beide in de ledger `.superpowers/sdd/2026-10-09-kleine-fouten/progress.md` (niet in git). Alles moet groen zijn vóór je begint. Poort 3333/3338 vrij.

---

### Task 1: B5 + B6 — rapport versturen: knop weer bruikbaar en alle mislukte statusupdates tonen (**LIVE-KRITIEK: rapport versturen**)

**Files:**
- Create: `public/js/schermen/rapport-verzend-melding.js`
- Modify: `public/js/schermen/rapport-verzenden.js` (`verstuurRapport`, regels ~118–213), `public/sw.js` (SHELL), `public/index.html` (modulepreload)
- Test: `tests/rapport-verzend-melding.test.mjs` (nieuw), `e2e/productie/rapport.spec.mjs` (omkeringen)

**Interfaces:**
- Produces: `bouwVerzendMelding({ verzonden = [], nietOpgeslagen = [], fouten = [], statusFout = null }): { tekst: string, duurMs: number }`. `verzonden` = doelgroepen waarvan mail én status-write slaagden, `nietOpgeslagen` = mail weg maar status-write mislukt, `fouten` = `[{ doelgroep, fout }]` van de server, `statusFout` = tekst of `null`. Volgorde van doelgroepen altijd `contact`, `klant`, `installateur`; labels via `joinNL`/`DOELGROEP_LABEL`.
- Consumes: `joinNL`, `DOELGROEP_LABEL` uit `schermen/ticketdetail-logica.js`.

Vaste uitkomsten van `bouwVerzendMelding` (alle bestaande teksten blijven letterlijk; nieuw is enkel het samenvoegen en de gedeeltelijke gevallen):

| Situatie | `tekst` | `duurMs` |
|---|---|---|
| niets verstuurd, `fouten` gevuld | `⚠ Rapport versturen geweigerd door Zoho (contact: <fout>; klant: <fout>)` | 6000 |
| niets verstuurd, geen `fouten` | `⚠ Rapport kon niet verstuurd worden (geen adressen bekend)` | 4500 |
| enkel `verzonden` | `✓ Rapport verstuurd naar <labels>` | 3500 |
| alles mail-weg maar niets opgeslagen | `✓ Rapport verstuurd naar <labels>, maar status kon niet opgeslagen worden — NIET opnieuw versturen, herlaad eerst de pagina` | 8000 |
| deels opgeslagen | `✓ Rapport verstuurd naar <alle mail-weg>, maar status kon niet opgeslagen worden voor <nietOpgeslagen> — NIET opnieuw versturen, herlaad eerst de pagina` | 8000 |
| mail weg én `fouten` gevuld (deel geweigerd) | bovenstaande + ` ⚠ Niet verstuurd naar <labels van fouten>: <doelgroep: fout; …>` | 8000 |
| mail weg én `statusFout` | bovenstaande + ` ⚠ Ticketstatus in Zoho kon niet naar "Gesloten - ov" gezet worden: <statusFout>` | 8000 |

(Het samenvoegen van de laatste twee regels is B6: tot nu toe overschreef elke volgende `toast()` de vorige. De regel over geweigerde ontvangers bij een deels gelukte verzending is een uitbreiding binnen B6: dezelfde fout, "een melding verdwijnt"; ze hoeft niet mee als Brent dat liever niet wil.)

- [ ] **Step 1: Failing tests** `tests/rapport-verzend-melding.test.mjs` (pure functie, geen DOM):
  - `bouwVerzendMelding: de zeven situaties uit de tabel geven exact die tekst en duur` (één assertion per rij).
  - `bouwVerzendMelding: volgorde contact, klant, installateur ook als de invoer anders staat`.
  - `bouwVerzendMelding: foutteksten worden ongewijzigd doorgegeven` (geen HTML-bewerking; de toast gebruikt `textContent`).
  Omgekeerde e2e-tests (`e2e/productie/rapport.spec.mjs`), eerst aanpassen en rood laten worden:
  - `echt verzoek: 500 { error }: toast "✕ …", geen status-verzoeken en de knop blijft uitgeschakeld` (regel ~313) → hernoemen naar `… en de knop is weer bruikbaar`; `toBeEnabled()`; de `HUIDIG GEDRAG (bug?)`-opmerking weg. (**B5**)
  - `een 500 { error } (definitief antwoord) start geen controle` (regel ~525) → `toBeEnabled()` i.p.v. `toBeDisabled()`. (**B5**)
  - `rapport-verzonden: 502 met HTML-body voor contact, daarna lukt klant niet meer met de oude versie: enkel klant mist` (regel ~252) → verwachte toast wordt `✓ Rapport verstuurd naar contactpersoon en klant, maar status kon niet opgeslagen worden voor contactpersoon — NIET opnieuw versturen, herlaad eerst de pagina`; de `HUIDIG GEDRAG`-regel weg. (**B6**)
  - `statusFout: mail verstuurd, maar ticketstatus niet gezet: de waarschuwing komt na de succestoast` (regel ~299) → verwachte toast wordt `✓ Rapport verstuurd naar contactpersoon ⚠ Ticketstatus in Zoho kon niet naar "Gesloten - ov" gezet worden: Zoho 500`, naam hernoemd naar "…staat in dezelfde melding".
  - Nieuwe e2e-test `echt verzoek: 400 { error } (geen adressen) maakt de knop weer bruikbaar` met stub `{ status: 400, json: { error: 'Geen gekend e-mailadres (klant of installateur) op dit ticket' } }`.
  - Behouden (moeten ongewijzigd groen blijven): `rapport-verzonden faalt (409) voor de klant: …` (enkel één doelgroep, tekst identiek aan de tabelrij "alles mail-weg"), en de 502/afgebroken-reeks uit "onzeker resultaat" (daar blijft de knop op slot tot de controle klaar is, Task 3).
- [ ] **Step 2: Run** `node --test tests/rapport-verzend-melding.test.mjs` en `npx playwright test --project=chromium e2e/productie/rapport.spec.mjs` → Expected: FAIL (module bestaat niet; omgekeerde tests rood op de oude code).
- [ ] **Step 3: Implementeer** `schermen/rapport-verzend-melding.js` volgens de tabel. In `verstuurRapport`: (a) de vier `toast(...)`-aanroepen na de status-lus (regels ~193–208) vervangen door één `const m = bouwVerzendMelding({ verzonden: verzondenOntvangers, nietOpgeslagen: emailedMaarNietOpgeslagen, fouten: data.fouten, statusFout: data.statusFout }); toast(m.tekst, m.duurMs)`; (b) in de `catch` (regel ~209): bij een fout die **niet** `leesFout(err).onzeker` is `if (btn) btn.disabled = false` (een 400/500 met `{ error }` bewijst dat er geen mail vertrok: `send-rapport.js` antwoordt enkel vóór de verzendlus met een fout, en `logVoorVerzoek` slikt zijn fouten); bij een onzekere fout blijft de knop op slot tot de controle klaar is (ongewijzigd, Task 3). Registreer het nieuwe bestand in `SHELL` en als `modulepreload`.
- [ ] **Step 4: Run** dezelfde commando's → Expected: PASS. Daarna `node --test tests/sw-schil.test.mjs tests/e2e-import-guard.test.mjs tests/window-namen.test.mjs` → PASS.
- [ ] **Step 5: Commit** `fix(rapport): knop weer bruikbaar na een definitieve serverfout en één melding met alle mislukte statusupdates (B5, B6)`

---

### Task 2: Mailcontrole levert de gevonden ontvangers ook bij een gedeeltelijk resultaat (voorbereiding B4)

**Files:**
- Modify: `public/js/kern/mailcontrole.js` (`beoordeelAntwoord`, regel ~40; `mailControleTekst`-omgeving)
- Test: `tests/mailcontrole.test.mjs`

**Interfaces:**
- Produces:
  - `beoordeelAntwoord(data, verwacht)` geeft bij een gedeeltelijk resultaat (minstens één, niet alle verwachte adressen gevonden) `{ uitkomst: 'onbekend', verzonden: [], gevonden: [{ aan, tijdstip }] }`. Alle andere uitkomsten blijven **byte-identiek** (geen `gevonden`-veld).
  - `mailControleAfsluiting(soort, stand): string` met `soort ∈ 'rapport' | 'voorstel'` en `stand ∈ 'alles' | 'deel' | 'mislukt'`, precies:
    - `rapport`/`alles`: ` — rapport als verzonden aangevinkt`; `voorstel`/`alles`: ` — voorstel als verzonden aangevinkt`
    - `deel` (beide soorten): ` — voor wie de mail al kreeg is "verzonden" aangevinkt`
    - `mislukt` (beide soorten): ` — maar kon niet als verzonden aangevinkt worden (herlaad de pagina)`
- Consumes: niets nieuws.

- [ ] **Step 1: Failing tests** (`tests/mailcontrole.test.mjs`):
  - Omgekeerd: in `beoordeelAntwoord met verwachte adressen: alles, niets of een deel` wordt de derde assertion `{ uitkomst: 'onbekend', verzonden: [], gevonden: [{ aan: 'luc@test.be', tijdstip: T1 }] }` (adres in kleine letters, tijdstip uit het antwoord).
  - Nieuw: `beoordeelAntwoord: twijfel zonder enige gevonden ontvanger blijft { uitkomst: 'onbekend', verzonden: [] }` (geen `gevonden`-veld).
  - Nieuw: `de andere onbekend-uitkomsten (onvolledig antwoord, geen ontvangers-veld, ongeldig uur) hebben geen gevonden-veld` (bestaande `deepEqual`'s blijven daarvoor staan).
  - Nieuw: `mailControleAfsluiting geeft de zes exacte teksten`.
  - `controleerMail` geeft de `gevonden`-lijst ongewijzigd door (één test met `zetFetch`).
- [ ] **Step 2: Run** `node --test tests/mailcontrole.test.mjs` → Expected: FAIL.
- [ ] **Step 3: Implementeer** in `beoordeelAntwoord` enkel de tak `vonden.length > 0 && < adressen.length`; voeg `mailControleAfsluiting` toe naast `mailControleTekst`.
- [ ] **Step 4: Run** `node --test tests/mailcontrole.test.mjs` → PASS, daarna `node --test` (volledig) → PASS.
- [ ] **Step 5: Commit** `fix(mailcontrole): gevonden ontvangers ook bij een gedeeltelijk resultaat (voorbereiding B4)`

---

### Task 3: B4 (rapport) — automatisch "verzonden" aanvinken als de mail in Zoho teruggevonden wordt (**LIVE-KRITIEK: rapport versturen**)

**Files:**
- Modify: `public/js/schermen/rapport-verzenden.js` (`voorbeeldRapport` regels ~97–103, `verstuurRapport` regels ~118–213, `naOnzekerRapport` regels ~233–244)
- Test: `e2e/productie/rapport.spec.mjs` (omkeringen en nieuwe tests)

**Interfaces:**
- Consumes: `controleerMail`, `mailControleTekst`, `mailControleAfsluiting` (Task 2), `data.ontvangers` van de voorbeeldaanroep (`[{ doelgroep, naam, email, html }]`, de server bepaalt zelf de ontvangers).
- Produces: `verstuurRapport(rapportId, btn, ontvangers?)` (derde parameter optioneel, enkel gevuld vanuit het voorbeeldvenster: `sendBtn.onclick` geeft `data.ontvangers` door). Intern: `schrijfRapportStatus({ rapportId, doelgroep, tijdstip, versie? }): Promise<{ ok: true, versie } | { ok: false, fout }>` (de status-write per doelgroep, nu uit de lus van `verstuurRapport` getrokken; de lus blijft `versie: afh.archiefVersie()` sturen, de nieuwe aanroep laat `versie` weg).

Gedrag: na een onzeker resultaat start `controleerMail({ ticketId, start, startWand, verwacht: ontvangers.map(o => o.email) })` (per adres, zoals het voorstel). Uitkomst `verzonden` → voor elk gevonden adres de bijhorende doelgroep (zoek `o.email` hoofdletterongevoelig) `POST /api/rapport-verzonden` met `{ id, doelgroep, tijdstip: <gevonden tijdstip>, ... }` **zonder `versie`** (het item wordt enkel op id aangepast; een versieconflict zou een al verstuurde mail anders weer "niet verzonden" laten lijken), lokaal `r[veld] = tijdstip`, `afh.zetArchiefVersie(versie)`, `afh.renderRapportArchief()`. Uitkomst `onbekend` met `gevonden` (deel) → enkel die doelgroepen. De bestaande bevestigingsvraag bij opnieuw versturen blijft: `zetMailGedetecteerd(rapportId, vroegste tijdstip)` gebeurt **altijd** bij een gevonden mail (ook als het aanvinken lukt). Zonder `ontvangers` (andere aanroepers, testmodus) blijft het huidige gedrag (breed controleren, enkel onthouden).

Toasts (exact, `mailControleTekst` ongewijzigd):
- alles aangevinkt: `✓ Mail is verzonden om 09:01 (c@y.be) — rapport als verzonden aangevinkt`
- deel: `⚠ De klant kan al gemaild zijn — kijk dit na in Zoho voor je opnieuw verstuurt — voor wie de mail al kreeg is "verzonden" aangevinkt`
- aanvinken mislukt (409/404/netwerk): `✓ Mail is verzonden om 09:01 (c@y.be) — maar kon niet als verzonden aangevinkt worden (herlaad de pagina)`; de detectie in `localStorage` blijft staan.

- [ ] **Step 1: Failing tests** (e2e, `rapport.spec.mjs`; stubs van `mail-check` krijgen nu per-adres-antwoorden want de controle stuurt `ontvangers=` mee: `MAIL_VERZONDEN` wordt `{ ok: true, twijfel: false, verzonden: true, tijdstip: T_MAIL, uitgaand: [{ aan: 'c@y.be', tijdstip: T_MAIL }], ontvangers: { 'c@y.be': { verzonden: true, tijdstip: T_MAIL } } }`, `MAIL_NIET` krijgt `ontvangers: { 'c@y.be': { verzonden: false, tijdstip: null } }`, en `mailCheckQuery`-verwachtingen krijgen `ontvangers: 'c@y.be'`):
  - Omgekeerd: `afgebroken en de mail is al verzonden: melding met uur, de knop blijft uit en er komt geen tweede verzending` → nieuwe naam `… de mail is al verzonden: rapport wordt als verzonden aangevinkt, geen tweede verzending`. Verwacht: toast `✓ Mail is verzonden om 09:01 (c@y.be) — rapport als verzonden aangevinkt`; schrijflijst `[START, SEND, SEND, VERZONDEN]`; `z.opnames['rapport-verzonden']` = `[{ methode: 'POST', body: { id: 'r1', doelgroep: 'contact', tijdstip: T_MAIL }, query: {} }]` (geen `versie`); lokaal `verzondenContact = T_MAIL`; knop `✓ Verzonden`; precies één controle, nog steeds één `send-rapport` (echt).
  - Omgekeerd: in `na "verzonden" vraagt een volgende verzending …` blijft de bevestigingsvraag (localStorage) bestaan; wat verandert: na de eerste (onzekere) verzending staat `verzondenContact` al, de knop is na de hertekening `✓ Verzonden`, en de assertion `expect(z.opnames['rapport-verzonden']).toEqual([])` aan het begin wordt `toHaveLength(1)` (de automatische) en aan het einde `toHaveLength(2)` (automatisch + de bevestigde tweede verzending).
  - Nieuw: `afgebroken, twee ontvangers en enkel de eerste kreeg de mail: enkel die doelgroep wordt aangevinkt en de waarschuwing blijft` (voorbeeld met `contact` en `klant`; mail-check antwoordt per adres; verwacht één status-POST voor `contact`, toast `⚠ De klant kan al gemaild zijn — kijk dit na in Zoho voor je opnieuw verstuurt — voor wie de mail al kreeg is "verzonden" aangevinkt`, knop blijft uit).
  - Nieuw: `afgebroken, mail gevonden maar rapport-verzonden geeft 409: melding "… maar kon niet als verzonden aangevinkt worden (herlaad de pagina)", detectie onthouden, geen tweede verzending` (stub `rapport-verzonden` → 409).
  - Behouden: `niet verzonden of onzekere controle onthoudt niets`, `onleesbaar adres of draft-status (twijfel)`, `de controle zelf faalt (502)`, `een antwoord … niet te lezen` — ongewijzigd groen (geen status-POST, knop op slot).
- [ ] **Step 2: Run** `npx playwright test --project=chromium e2e/productie/rapport.spec.mjs` → Expected: FAIL (de omgekeerde en nieuwe tests).
- [ ] **Step 3: Implementeer** de extractie `schrijfRapportStatus` en de nieuwe tak in `naOnzekerRapport(rapportId, ticketId, start, startWand, btn, ontvangers)`. Houd de lus in `verstuurRapport` inhoudelijk gelijk (zelfde body `{ id, doelgroep, tijdstip, versie }`, zelfde volgorde, zelfde console-waarschuwing).
- [ ] **Step 4: Run** de spec → PASS; daarna het volledige `npx playwright test --project=chromium e2e/productie` → PASS.
- [ ] **Step 5: Commit** `fix(rapport): rapport automatisch als verzonden aanvinken als de mail in Zoho teruggevonden wordt (B4)`

---

### Task 4: B2 (server) — `propose.js` meldt welke mails vertrokken zijn als de ticket-update daarna faalt (**LIVE-KRITIEK: klantmail + Zoho-status**)

**Files:**
- Modify: `netlify/functions/propose.js` (de PATCH en de `catch`, regels ~354–374)
- Test: `tests/server-propose.test.mjs`

**Interfaces:**
- Produces: bij een mislukte ticket-PATCH ná de mail-lus blijft de HTTP-status **500** en de `error`-tekst `Zoho PATCH fout (<status>): <json>` onveranderd, maar de body krijgt er (in deze volgorde) `emailSent`, `fouten`, `ontvangers` (zelfde vorm als bij succes: `ontvangers` = lijst doelgroepen) bij. Fouten vóór de mail-lus (token, org, ticket-GET, geen from-adres) blijven `{ error }` zonder die velden. Geen log-regel `voorstel-verstuurd` bij de fout. Er komt geen nieuwe functie (dus geen nieuwe `rechten.js`-rij).
- Consumes: bestaande variabelen `emailSent`, `fouten`, `ontvangers` in `kern()`.

- [ ] **Step 1: Failing tests** (`tests/server-propose.test.mjs`, sectie PATCH, regel ~475):
  - Omgekeerd: `propose: PATCH-fout geeft 500 "Zoho PATCH fout (<status>): {…}" (na de mails)` → `… en meldt welke mails vertrokken zijn`. De eerste `deepEqual` op het antwoord wordt `{ statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Zoho PATCH fout (422): …', emailSent: { contact: true, klant: false, installateur: false }, fouten: [], ontvangers: ['contact'] }) }` (sleutelvolgorde vast!). De vervolgassertions (`error`-tekst bij 500/400 zonder body) blijven, de lege-204-tak blijft 200.
  - Nieuw: `propose: PATCH-fout zonder enige geslaagde mail (geen ontvangers): zelfde velden met alles false en ontvangers []`.
  - Nieuw: `propose: PATCH-fout nadat één van twee ontvangers faalde: emailSent en fouten geven beide kanten weer`.
  - Behouden: `tokenfout`, `ticket niet gevonden`, `zonder ZOHO_FROM_EMAIL en zonder adres: 500 met de bestaande tekst` blijven `{ error }` zonder extra velden (regressietest dat enkel de PATCH-tak verandert).
- [ ] **Step 2: Run** `node --test tests/server-propose.test.mjs` → Expected: FAIL.
- [ ] **Step 3: Implementeer** in `kern()`: de PATCH-aanroep krijgt een eigen `try/catch` (of de `!patchRes.ok`-tak) die `v1Json(500, { error, emailSent, fouten, ontvangers: ontvangers.map(o => o.doelgroep) }, CORS_V1)` teruggeeft; de algemene `catch (err)` blijft voor al het andere.
- [ ] **Step 4: Run** `node --test tests/server-propose.test.mjs tests/rechten.test.mjs` → PASS.
- [ ] **Step 5: Commit** `fix(propose): antwoord bij een mislukte ticket-update vermeldt welke mails vertrokken zijn (B2, server)`

---

### Task 5: B1 — voorstelregister bewaren zonder verlies, ook bij gelijktijdig werken (**LIVE-KRITIEK: voorstelstatus na een klantmail**)

**Files:**
- Create: `public/js/schermen/voorstel-register.js`
- Modify: `public/js/schermen/voorstel.js` (`sendProposal`, regels ~241–270 `schrijfStatus`), `public/sw.js` (SHELL), `public/index.html` (modulepreload)
- Test: `tests/voorstel-register.test.mjs` (nieuw), `e2e/productie/voorstel.spec.mjs` (omkeringen)

**Interfaces:**
- Produces (alles `export`):
  - `bewaarVoorstelRegister({ ticketId, doelgroepen, tijdstip, tijdslot, tijdslotDatum, leesVersie, herlaad }): Promise<{ ok: true, versie: number } | { ok: false, reden: 'http' | 'netwerk', status?: number }>`. `leesVersie()` geeft de huidige bekende serverversie (`number | null`), `herlaad()` is `async () => boolean` (`loadVoorstelStatus`, werkt `leesVersie` bij). Algoritme: poging 1 met `versie: leesVersie()`; bij **409** → `herlaad()` en poging 2 met de nieuwe versie; bij een tweede **409** (of een mislukte herlaad) → poging 3 **zonder `versie`-veld** (de server schrijft dan zonder versiecontrole; `reset: true` vervangt enkel de entry van dit ticket, dus een andermans wijziging aan een ander ticket gaat niet verloren). Elke andere fout (5xx, netwerk, onleesbaar antwoord) stopt meteen: `ok: false`. Nooit meer dan 3 POSTs. Body altijd `{ ticketId, doelgroepen, tijdstip, reset: true, [versie], [tijdslot, tijdslotDatum] }` (zelfde sleutelvolgorde als nu).
  - `registerEntry({ doelgroepen, tijdstip, tijdslot, tijdslotDatum }): object` — de lokale entry zoals de server ze maakt (`{ [doelgroep]: tijdstip, … , tijdslot?, tijdslotDatum? }`).
  - `doelgroepenVoorAdressen(ticket, adressen): string[]` — doelgroepen (volgorde `contact`, `klant`, `installateur`) waarvan het ticket-adres (`ticket.email`, `ticket.emailEindklant`, `ticket.emailInstallateur`) hoofdletterongevoelig in `adressen` zit; een adres dat al bij een eerdere doelgroep telde, telt niet nogmaals (zoals `openProposal` en de server ontdubbelen).
- Consumes: `apiVerzoek` (`kern/api.js`), in `sendProposal`: `loadVoorstelStatus`, `_voorstelStatusVersie`.

- [ ] **Step 1: Failing tests**
  - `tests/voorstel-register.test.mjs` (met `zetFetch`):
    - `bewaarVoorstelRegister: gewone poging slaagt met één POST en de meegegeven versie`;
    - `409 daarna succes: herlaad wordt één keer aangeroepen en poging 2 gebruikt de nieuwe versie`;
    - `twee keer 409: de derde POST heeft geen versie-veld en slaagt`;
    - `herlaad mislukt na een 409: meteen de versieloze poging`;
    - `500 of netwerkfout: stopt na één POST met ok:false (reden http/netwerk)`;
    - `nooit meer dan drie POSTs`;
    - `bodysleutelvolgorde: ticketId, doelgroepen, tijdstip, reset, versie, tijdslot, tijdslotDatum`;
    - `registerEntry` en `doelgroepenVoorAdressen` (hoofdletters, ontdubbelen contact=klant, ontbrekend adres).
  - E2E (`e2e/productie/voorstel.spec.mjs`):
    - Omgekeerd: `tweede 409 in een rij: geen derde POST en het register blijft lokaal leeg` (regel ~238) → `tweede 409 in een rij: de derde poging zonder versie slaagt en het register is geschreven`: 3 POSTs, de derde zonder `versie`; `registerLokaal` en `z.register().status` bevatten de entry `{ p1: { contact: TIJDSTIP, tijdslot, tijdslotDatum } }`; de `HUIDIG GEDRAG`-regel weg.
    - Nieuw: `register-POST geeft 500 (niet 409): geen retry en een waarschuwing`: toast `⚠ Voorstel verstuurd, maar de status kon niet bewaard worden — NIET opnieuw versturen, herlaad eerst de pagina`, precies één POST, planning en lijsten wel bijgewerkt (de mail is weg), knop terug.
    - Behouden: `409 op voorstel-status: register herladen en één keer opnieuw met de nieuwe versie` (regel ~213) ongewijzigd groen.
- [ ] **Step 2: Run** `node --test tests/voorstel-register.test.mjs` en `npx playwright test --project=chromium e2e/productie/voorstel.spec.mjs` → Expected: FAIL.
- [ ] **Step 3: Implementeer** de module en vervang in `sendProposal` het blok `schrijfStatus` (regels ~248–270) door een aanroep: `bewaarVoorstelRegister({ ticketId, doelgroepen: verzonden, tijdstip, tijdslot: apptWindowSend || undefined, tijdslotDatum: apptWindowSend ? date : undefined, leesVersie: () => _voorstelStatusVersie, herlaad: loadVoorstelStatus })`; bij `ok` de versie overnemen, `toestand.get('voorstelStatus')[ticketId] = registerEntry(…)` en `hertekenStatus()`; bij `!ok` de waarschuwing hierboven (8000 ms) en toch de lokale entry zetten (de mail is weg; de entry verdwijnt bij de volgende lading van de server). De `DELETE`-tak (geen enkele mail) blijft ongewijzigd.
- [ ] **Step 4: Run** beide commando's → PASS; `node --test tests/sw-schil.test.mjs` → PASS.
- [ ] **Step 5: Commit** `fix(voorstel): voorstelregister gaat niet meer verloren bij gelijktijdig werken en meldt een mislukte registratie (B1)`

---

### Task 6: B2 (client) + B4 (voorstel) — waarschuwing na een fout ná de mail, en automatisch "verzonden" bij een teruggevonden mail (**LIVE-KRITIEK: voorstel versturen**)

**Files:**
- Modify: `public/js/schermen/voorstel.js` (`sendProposal` regels ~219–327, `naOnzekerVoorstel` regels ~331–343)
- Test: `e2e/productie/voorstel.spec.mjs`

**Interfaces:**
- Consumes: Task 4 (`data.emailSent`, `data.fouten`, `data.ontvangers` bij een fout), Task 5 (`bewaarVoorstelRegister`, `doelgroepenVoorAdressen`, `registerEntry`), Task 2 (`gevonden`, `mailControleAfsluiting`).
- Produces: intern `naMailZonderTicketUpdate(...)` en een uitgebreide `naOnzekerVoorstel(ticketId, start, startWand, verwacht, btn, registerInvoer)` waarbij `registerInvoer = { ticketMails: { email, emailEindklant, emailInstallateur }, tijdslot, date }` bij het begin van de verzending is vastgelegd (niet uit het dan mogelijk gewisselde actieve ticket gelezen).

Gedrag **B2:** komt het antwoord van `/api/propose` met `error` én `emailSent` waarvan minstens één waarde `true` (vorm uit Task 4): het venster sluit, de knop gaat terug open, `afh.planResync()` leest de tickets opnieuw, het register wordt eerst geschreven (afgewacht) voor precies de doelgroepen met `emailSent[d] === true` (via `bewaarVoorstelRegister`, zelfde meldingen bij mislukken) en pas daarna leest `planResync` de tickets opnieuw, het ticket wordt **niet** lokaal naar "Wachten op bevestiging planning" verplaatst (Zoho zegt dat de update faalde; de herlading toont de echte stand), en er komt één toast (8000 ms): `⚠ Voorstel is verstuurd naar <labels>, maar Zoho kon het ticket niet bijwerken (<fout van de server>). Stuur het voorstel NIET opnieuw: zet de status en de datum in Zoho zelf recht.` Er is **geen** mailcontrole nodig (de server weet het zeker). Een 500 zonder `emailSent` (of met enkel `false`) blijft de gewone foutmelding `✕ <fout>`.
Gedrag **B4:** in `naOnzekerVoorstel` bij uitkomst `verzonden` (alle verwachte adressen gevonden): `doelgroepenVoorAdressen(ticketMails, r.verzonden.map(v => v.aan))` → `bewaarVoorstelRegister` met het vroegste gevonden tijdstip; bij `ok` lokale entry + hertekenen + toast `✓ Mail is verzonden om 09:01 (luc@test.be) — voorstel als verzonden aangevinkt`; bij mislukken `… — maar kon niet als verzonden aangevinkt worden (herlaad de pagina)`. Bij `onbekend` met `gevonden` (deel): enkel die doelgroepen registreren, toast `⚠ De klant kan al gemaild zijn — kijk dit na in Zoho voor je opnieuw verstuurt — voor wie de mail al kreeg is "verzonden" aangevinkt`, venster blijft open (zoals nu). De bestaande `planResync()` na `verzonden` blijft.

- [ ] **Step 1: Failing tests** (`e2e/productie/voorstel.spec.mjs`):
  - Omgekeerd: `propose faalt na het versturen (Zoho-PATCH 500): foutmelding, knop terug, geen registerverzoek, ticket ongewijzigd` (regel ~257) → `propose faalt na het versturen (Zoho-PATCH 500): waarschuwing, register geschreven, tickets opnieuw gelezen`. De stub wordt `{ status: 500, json: { error: 'Zoho PATCH fout (500): {"message":"Zoho kapot"}', emailSent: { contact: true, klant: false, installateur: false }, fouten: [], ontvangers: ['contact'] } }`. Verwacht: toast `⚠ Voorstel is verstuurd naar contactpersoon, maar Zoho kon het ticket niet bijwerken (Zoho PATCH fout (500): {"message":"Zoho kapot"}). Stuur het voorstel NIET opnieuw: zet de status en de datum in Zoho zelf recht.`; venster dicht; schrijflijst `[START, PROPOSE, STATUS_POST, START]` (opnieuw lezen = `planning-sinds`); register `{ p1: { contact: TIJDSTIP, tijdslot, tijdslotDatum } }`; `planningVan` ongewijzigd t.o.v. `BASIS_PLANNING` (geen lokale verplaatsing); `HUIDIG GEDRAG`-regel weg.
  - Nieuw: `propose 500 zonder emailSent (ticket niet bijgewerkt, geen mail): gewone foutmelding en geen registerverzoek` (de bestaande test `een definitieve fout (500 { error }) … start geen controle`, regel ~469, blijft ongewijzigd groen en dekt dit al; verwijs ernaar).
  - Omgekeerd: `afgebroken en de mail is al verzonden: melding met uur, venster dicht, tickets opnieuw gelezen, geen tweede verzending` (regel ~386): toast wordt `✓ Mail is verzonden om 09:01 (luc@test.be) — voorstel als verzonden aangevinkt`; schrijflijst `[START, PROPOSE, STATUS_POST, START]`; `registerLokaal` = `{ p1: { contact: T_MAIL, tijdslot: '09:30–12:30', tijdslotDatum: '2026-10-08' } }`; `z.register().status` idem. (`eenVerzendingEnEenControle` krijgt een optie voor de extra POST.)
  - Omgekeerd: `twee ontvangers en beide kregen de mail: één melding per ontvanger`: tekst krijgt het achtervoegsel ` — voorstel als verzonden aangevinkt`; register bevat `contact` én `klant`.
  - Omgekeerd: `twee ontvangers en enkel de eerste kreeg de mail: geen zekere uitspraak, de waarschuwing` (regel ~446): toast `⚠ De klant kan al gemaild zijn — kijk dit na in Zoho voor je opnieuw verstuurt — voor wie de mail al kreeg is "verzonden" aangevinkt`; register bevat enkel `contact`; knop blijft bruikbaar, venster blijft open.
  - Nieuw: `afgebroken, mail gevonden, register-POST geeft 500: "… maar kon niet als verzonden aangevinkt worden (herlaad de pagina)"`.
  - Behouden groen: `afgebroken en de mail is niet verzonden`, `de controle zelf faalt (502)`, `een uitgaande mail met onleesbaar adres (twijfel)`, `tijdens de controle blijft de knop op slot…`, `zonder e-mailadres…` (geen register-POST, geen extra melding).
- [ ] **Step 2: Run** `npx playwright test --project=chromium e2e/productie/voorstel.spec.mjs` → Expected: FAIL.
- [ ] **Step 3: Implementeer** in `sendProposal` de takken hierboven; leg `registerInvoer` vast vóór de `fetch`. Verander niets aan de succespad-volgorde (planning/lijsten) en laat de testmodus-tak (regels ~191–213) ongemoeid.
- [ ] **Step 4: Run** de spec → PASS; daarna `npx playwright test --project=chromium e2e/productie e2e/voorstel-afspraak-blokkering.spec.mjs e2e/route.spec.mjs` → PASS.
- [ ] **Step 5: Commit** `fix(voorstel): waarschuwing als het ticket niet bijgewerkt raakte na de mail en automatisch "verzonden" bij een teruggevonden mail (B2, B4)`

---

### Task 7: B7/C4 — rapportwizard: "aanrijtijd kon niet berekend worden" met een veld om ze zelf in te vullen, nooit stil 0 (**wizard, kleine gerichte wijziging**)

**Files:**
- Create: `public/js/rapport-aanrijtijd.js`, `public/sw.js` (SHELL), `public/index.html` (modulepreload)
- Modify: `public/js/rapport-wizard.js` (blok in `openRapportIntern` regels ~163–191; `wizRenderFacturatie` regels ~567–633; `wizSaveFacturatie` regel ~644; `R` regel ~27)
- Test: `tests/rapport-aanrijtijd.test.mjs` (nieuw), `e2e/instellingen-rapport.spec.mjs` (nieuwe wizardtest)

**Interfaces:**
- Produces: `berekenAanrijtijd({ adres, startlocatie }): Promise<{ minuten: number | null, reden: null | 'geen-adres' | 'geen-startlocatie' | 'geocode' | 'route' | 'netwerk' }>`: `POST /api/optimize` (`{ origin, stops: [adres] }`) en daarna `POST /api/route` (`{ waypoints: [origin, dest] }`) via `apiVerzoek`; `minuten = Math.round(travelTimeSeconds / 60)` voor een getal ≥ 0 (**0 seconden is een geldige uitkomst**, enkel een ontbrekend of ongeldig getal is een mislukking); gooit nooit (time-out van 20 s, netwerkfout, 4xx/5xx, onleesbaar of onvolledig antwoord → `minuten: null`). Nieuw veld `R.aanrijtijdBron ∈ '' | 'tomtom' | 'onbekend' | 'handmatig'` (komt via `rapportData` mee in het archief; harmloos).
- Consumes: `apiVerzoek` (`kern/api.js`).

Gedrag: `openRapportIntern` roept `berekenAanrijtijd` aan (de toast "📡 Aanrijtijd wordt berekend…" en de 20 s wachttijd blijven). Gelukt: `R.aanrijtijdMin = minuten`, `R.aanrijtijdBron = 'tomtom'`. Mislukt (ook geen adres of geen startlocatie): `R.aanrijtijdMin = 0`, `R.aanrijtijdBron = 'onbekend'`. In de stap **Facturatie** (alleen zichtbaar voor interventies; installaties slaan die stap al over) toont het scherm bij `'onbekend'` boven het veld een opvallend blok met de tekst `⚠ Aanrijtijd kon niet berekend worden — vul ze hieronder zelf in (minuten, enkel heen). Typ 0 als er geen aanrijtijd is.` (`role="alert"`, geen `innerHTML` met ruwe tekst), het veld `f-aanrijtijd` krijgt `aria-invalid="true"` en de "📡 TomTom"-badge verdwijnt (die toont enkel bij `'tomtom'`). `wizSaveFacturatie` geeft bij `'onbekend'` en een leeg veld (`trim() === ''`; `0` is wel geldig) de string `⚠ Vul de aanrijtijd in (minuten, enkel heen). Typ 0 als er geen aanrijtijd is.` terug: de bestaande `wizNext` blokkeert dan met die toast. Bij een ingevulde waarde wordt `R.aanrijtijdBron = 'handmatig'`. Een teruggezet concept (`leesConcept`) neemt de bron uit het concept over; een concept zonder bron-sleutel laat de vers berekende bron staan.

- [ ] **Step 1: Failing tests**
  - `tests/rapport-aanrijtijd.test.mjs` (met `zetFetch`): `gelukt: minuten uit travelTimeSeconds afgerond (1799 s → 30)`; `0 seconden is geldig (minuten 0, reden null)`; `geen locations → reden geocode, minuten null`; `origin of dest ontbreekt → geocode`; `route zonder legs of zonder getal → reden route`; `HTTP 500/502 → reden route of geocode afhankelijk van de stap, nooit een throw`; `netwerkfout en TimeoutError → reden netwerk`; `geen adres of geen startlocatie → geen enkele fetch, de juiste reden`; `eerste aanroep gaat met { origin, stops: [adres] }, tweede met { waypoints }`.
  - `e2e/instellingen-rapport.spec.mjs` (testmodus-stubs): `aanrijtijd mislukt: de stap Facturatie toont de melding, blokkeert Volgende zonder waarde en laat 0 of een getal toe` — de stub van `/api/route` (of `optimize`) geeft een fout; verwacht: de exacte meldingstekst zichtbaar, `Volgende` blijft op stap 2 met toast `⚠ Vul de aanrijtijd in (minuten, enkel heen). Typ 0 als er geen aanrijtijd is.`, na `35` invullen gaat de wizard door en staat `35` in het Overzicht/loonberekening. Nieuw: `aanrijtijd gelukt: geen melding en de TomTom-badge staat er` (bestaande stubs, ongewijzigd gedrag). **Let op:** de bestaande wizardtest in hetzelfde bestand laat de stap Facturatie leeg door ("niets verplicht"); controleer dat de stubs daar slagen (`verzoeken.van('/api/optimize').length > 0`), anders zou de test nu blokkeren.
- [ ] **Step 2: Run** `node --test tests/rapport-aanrijtijd.test.mjs` en `npx playwright test --project=chromium e2e/instellingen-rapport.spec.mjs e2e/productie/oplossing.spec.mjs` → Expected: FAIL (nieuwe tests; module bestaat niet).
- [ ] **Step 3: Implementeer** de module en de drie wizardplekken (blok, render, save). Verder niets in de wizard aanraken (geen herstructurering).
- [ ] **Step 4: Run** de commando's → PASS; `node --test tests/sw-schil.test.mjs` → PASS.
- [ ] **Step 5: Commit** `fix(rapport-wizard): melding en invoerveld als de aanrijtijd niet berekend kon worden, nooit meer stil 0 (B7, C4)`

---

### Task 8: B8 + B9 — blokkeringen: geen één-dag-bij-periode of lege datum, en het venster behoudt de getoonde dag

**Files:**
- Modify: `public/js/schermen/beschikbaarheid-logica.js` (nieuwe pure functie), `public/js/schermen/beschikbaarheid.js` (`openBlockModal` ~152, `renderBlockModal` ~170–255, handlers ~37–41, `avAddException` ~274–352, `avAddExceptionFromSettings` ~528–588)
- Test: `tests/beschikbaarheid-logica.test.mjs`, `e2e/beschikbaarheid.spec.mjs`

**Interfaces:**
- Produces: `valideerNieuweBlokkering({ kind, meerdaags, datum, datumTot, van, tot }): { ok: true } | { ok: false, melding: string }`, controles in deze volgorde met exacte meldingen:
  1. `kind === 'range'` en `van >= tot` → `⚠ Eindtijd moet na begintijd liggen` (bestaand);
  2. `datum` leeg → `⚠ Kies een datum` (nieuw, **B8**);
  3. `kind === 'fullday'`, `meerdaags` en `datumTot` leeg → `⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit` (nieuw, **B8**);
  4. `kind === 'fullday'`, `meerdaags` en `datumTot < datum` → `⚠ Einddatum moet na startdatum liggen` (bestaand).
  De bestaande melding `⚠ In deze periode zijn er geen werkdagen. Kies andere data.` blijft in de uitbreidingslus (heeft `werkdagen` nodig).
- Beide formulieren (venster en tab "Beschikbaarheden") blijven afzonderlijke functies maar gebruiken dezelfde validator; toast-duur blijft 2500 ms.
- **B9:** nieuwe module-privé variabele `_avVanDatum` (de waarde van het veld "Van datum" in het venster). `_avFormDate` blijft de **getoonde dag** (titel en lijst "Bestaande blokkeringen") en wordt na het openen niet meer door het datumveld gewijzigd. Het veld `av-date-van` schrijft naar `_avVanDatum` (handler `'av-datum'`); een periode begint bij `_avVanDatum`, een enkele dag blijft op `_avFormDate`; na het toevoegen van een periode gaat `_avVanDatum` terug naar `_avFormDate`. De tab "Beschikbaarheden" heeft geen "getoonde dag" en blijft zoals ze is (enkel B8 geldt daar).

- [ ] **Step 1: Failing tests**
  - `tests/beschikbaarheid-logica.test.mjs`: `valideerNieuweBlokkering: de vier weigeringen met exacte tekst en in de vastgelegde volgorde`; `geldig: hele dag, tijdvak, periode`; `lege datum bij een tijdvak wordt ook geweigerd`; `meerdaags uitgevinkt met lege datumTot is geldig`.
  - `e2e/beschikbaarheid.spec.mjs`:
    - Omgekeerd: `meerdaags aangevinkt zonder einddatum: HUIDIG GEDRAG (bug?) er wordt één enkele dag toegevoegd` (regel ~160) → `… zonder einddatum: toast "⚠ Kies een einddatum, of vink "Meerdere werkdagen" uit", geen PUT`.
    - Omgekeerd: `lege datum: HUIDIG GEDRAG (bug?) geen validatie, …` (regel ~171) → `lege datum: toast "⚠ Kies een datum" en geen PUT`.
    - Omgekeerd (venster): `datum wijzigen bij meerdere werkdagen: de blokkades komen op de gekozen data, niet op de geopende dag` (regel ~380) → de titel blijft `dinsdag 6 oktober` én de lijst "Bestaande blokkeringen" toont nu `Geen blokkeringen voor deze dag.` (geen `.av-item`; de `HUIDIG GEDRAG`-regel weg); de PUT-assertion (13 en 14 okt) blijft.
    - Nieuw (venster): `Van datum leeg bij meerdere werkdagen: "⚠ Kies een datum"`; `meerdaags zonder Tot-datum: "⚠ Kies een einddatum, …"`.
    - Behouden groen: `weigeringen bij meerdere werkdagen: einddatum voor begindatum en een periode zonder werkdagen` (beide formulieren), `weigeringen: eindtijd voor begintijd, …`.
- [ ] **Step 2: Run** `node --test tests/beschikbaarheid-logica.test.mjs` en `npx playwright test --project=chromium e2e/beschikbaarheid.spec.mjs` → Expected: FAIL.
- [ ] **Step 3: Implementeer** de validator en gebruik hem in `avAddException` en `avAddExceptionFromSettings` vóór elke wijziging van de lokale lijst (dus nooit een optimistische toevoeging die direct weer terug moet); voeg `_avVanDatum` toe volgens bovenstaande beschrijving.
- [ ] **Step 4: Run** beide commando's → PASS; `npx playwright test --project=chromium e2e/kalender.spec.mjs e2e/productie/verbinding.spec.mjs` → PASS (de blokkeringsvensters worden daar ook geraakt).
- [ ] **Step 5: Commit** `fix(beschikbaarheid): geen blokkering met lege datum of zonder einddatum en het venster houdt de getoonde dag vast (B8, B9)`

---

### Task 9: B10 + B11 — eigen afspraken: notitie niet meer als adres tonen (handmatig) en een afspraak zonder uur zichtbaar op de tijdlijn

**Files:**
- Modify: `public/js/schermen/afspraken-logica.js` (nieuwe pure functie), `public/js/schermen/afspraken.js` (`openLocalEventDetail`, regels ~353–392), `public/js/schermen/kalender.js` (`buildLocalEventCard` regels ~136–160; chips "zonder uur" regels ~314–318)
- Test: `tests/afspraken-logica.test.mjs`, `e2e/afspraken.spec.mjs`, `e2e/kalender.spec.mjs`

**Interfaces:**
- Produces: `zichtbaarAdres(ev): string` in `afspraken-logica.js`: `ev.adres` als die gevuld is; anders de `notitie` **enkel als `ev.bron !== 'manueel'`** (geïmporteerde en oudere afspraken zonder `bron` hebben hun adres in het notitieveld, zie `planning-export.js`); anders `''`. Alleen de **weergave** gebruikt dit (fiche en kaart). De locatielogica van Route-tab, kaart, capaciteit en export (`adres || notitie` in `route.js`, `route-kaart.js`, `capaciteit.js`, `selecties.js`, `planacties.js`, `ticketdetail.js`, `planning-export.js`) blijft **ongewijzigd** (zie open vraag 2).
- Fiche (`openLocalEventDetail`): rij **Adres** (met navigatielink) enkel bij `zichtbaarAdres(ev)`; rij **Notitie** wanneer er een notitie is die niet als adres getoond wordt (dus altijd bij een handmatige afspraak met notitie, ook zonder adres); het huidige `ev.adres && ev.notitie ? row('Notitie', …)` wordt daarmee `ev.notitie && zichtbaarAdres(ev) !== ev.notitie`.
- Kaart (`buildLocalEventCard`): `.cal-addr` en de knop "🧭 Navigeer" enkel bij `zichtbaarAdres(ev)`; bij een handmatige afspraak zonder adres staat de notitie als regel `.cal-meta` (`📝 <notitie>`, `escHtml`).
- **B11:** de dagkop-chips "Zonder uur:" (`zonderUur`) krijgen er bij: elke afspraak uit `dayEvents` zonder `uur` → `{ label: ev.titel || ev.type, title: (ev.type ? ev.type + ': ' : '') + (ev.titel || ''), open: () => afh.openLocalEventDetail(ev) }`. De bestaande limiet van vier chips en "+N meer" blijft; de gsm-lijst toont zulke afspraken al achteraan (ongewijzigd).

- [ ] **Step 1: Failing tests**
  - `tests/afspraken-logica.test.mjs`: `zichtbaarAdres: adres gaat voor; import zonder adres toont de notitie; legacy zonder bron toont de notitie; manueel zonder adres geeft lege tekst; alles leeg geeft lege tekst`.
  - `e2e/afspraken.spec.mjs`:
    - Omgekeerd: `HUIDIG GEDRAG (bug?): zonder adres wordt de notitie als adres getoond …` (regel ~163) → `een handmatige afspraak zonder adres toont de notitie als Notitie, niet als adres`: geen rij `Adres`, wel rij `Notitie` met `Sleutel op kantoor`, de kaart heeft geen `.cal-addr` maar de notitieregel, geen "🧭 Navigeer"; kop `wo 7 okt 2026 · 09:00` blijft.
    - Nieuw: `een geïmporteerde afspraak (bron "import") met enkel een notitie toont die nog steeds als adres met navigatielink`.
    - Behouden: `detail: type, titel, datum en tijd, adres, telefoon, e-mail, notitie en technieker` (afspraak met adres én notitie, ongewijzigd).
  - `e2e/kalender.spec.mjs` (naast `kalender: items zonder uur`, regel ~264): omgekeerd in `e2e/afspraken.spec.mjs`: `HUIDIG GEDRAG (bug?): een afspraak zonder uur staat bewaard maar verschijnt niet op de kalendertijdlijn` (regel ~183) → `een afspraak zonder uur staat als chip "Zonder uur:" in de dagkop`: `.zu-chip` met `Zonder uur`, klik opent het detail; nog steeds geen `.cal-local-event` op de tijdlijn. Nieuw in `kalender.spec.mjs`: `vijf items zonder uur (tickets en afspraken samen): vier chips en "+1 meer"`.
- [ ] **Step 2: Run** `node --test tests/afspraken-logica.test.mjs` en `npx playwright test --project=chromium e2e/afspraken.spec.mjs e2e/kalender.spec.mjs e2e/kalender-indelingen.spec.mjs` → Expected: FAIL.
- [ ] **Step 3: Implementeer** volgens bovenstaande beschrijving (twee weergaveplekken en de chip). Geen wijziging aan `route.js`, `capaciteit.js` of de server.
- [ ] **Step 4: Run** de commando's → PASS; `node --test tests/kalender-logica.test.mjs tests/capaciteit.test.mjs` → PASS (ongewijzigd).
- [ ] **Step 5: Commit** `fix(afspraken): notitie niet meer als adres tonen bij handmatige afspraken en afspraken zonder uur als chip in de dagkop (B10, B11)`

---

### Task 10: B12 + B13 + B14 — instellingen, prijsbeheer en blokkeringsvenster: concept, focus en cursor

**Files:**
- Modify: `public/js/schermen/instellingen.js` (`openSettings` ~166–200, `saveSettings` ~207–244), `public/js/prijzen.js` (`prijsVoegOnderdeel` ~236–245), `public/js/schermen/beschikbaarheid.js` (`hertekenMetBehoudVanInvoer` ~125–134)
- Test: `e2e/instellingen-toestel.spec.mjs`, `e2e/productie/verbinding.spec.mjs`

**Interfaces:**
- **B12:** nieuwe module-privé `_werkdagenConcept: number[]` in `instellingen.js`. `openSettings` zet hem op een kopie van `settings.werkdagen`; een klik op een weekdag wijzigt enkel het concept (en de knop-klasse/`aria-pressed`); `saveSettings` valideert met `werkdagen: _werkdagenConcept` en schrijft pas bij succes `settings.werkdagen = [..._werkdagenConcept]`; `closeSettings` (Annuleren, achtergrondklik, Esc) laat `settings` onaangeroerd. Verifieer met `grep -rn "werkdagen" public/js/schermen/beheer-instellingen.js` of het beheerscherm hetzelfde patroon heeft; zo ja, dezelfde aanpassing, zo nee niets.
- **B13:** `prijsVoegOnderdeel`: na `renderPrijsEditor()` synchroon focussen op `#prijs-body .prijs-naam-input[data-arg="<index van het nieuwe onderdeel>"]` (index = `PRIJZEN_DIRTY.onderdelen.length - 1`) en `scrollIntoView({ block: 'nearest' })`; de `setTimeout(…, 50)` en de "laatste naamveld van de pagina"-selector verdwijnen.
- **B14:** `hertekenMetBehoudVanInvoer(el, render)` bewaart naast de waarden ook het element met focus (id) en bij tekstachtige velden (`text`, `search`, `tel`, `url`, `password`, `textarea`) `selectionStart`/`selectionEnd`/`selectionDirection`; na het hertekenen: `focus({ preventScroll: true })` en `setSelectionRange(...)` in een `try/catch` (voor `number`/`date`/`time` bestaat geen selectie). Geen nieuw bestand: het blijft de bestaande lokale hulpfunctie.

- [ ] **Step 1: Failing tests**
  - `e2e/instellingen-toestel.spec.mjs`:
    - Omgekeerd: `HUIDIG GEDRAG (bug?): een weekdagklik wijzigt de instellingen in het geheugen ook zonder te bewaren` (regel ~231) → `Annuleren verwerpt een weekdagklik: bij heropenen staat de dag weer zoals bewaard`: na `Za` aan, `Annuleren`, heropenen: `aria-pressed="false"` voor Za; ook na Esc en achtergrondklik; nieuw: `Opslaan neemt de weekdagwijziging wel over` (bestaande opslagtest rond regel ~210 blijft groen).
    - Omgekeerd: in `onderdeel verwijderen en toevoegen; een nieuw onderdeel start leeg met prijs 0` (regel ~475): de `HUIDIG GEDRAG (bug?)`-focusassertions worden `await expect(nieuw).toBeFocused()` en `await expect(naamInvoer(page).last()).not.toBeFocused()`; de rest (opslaan, `nieuw-<n>`-id, plaatsing in de lijst) blijft.
  - `e2e/productie/verbinding.spec.mjs`, test `beschikbaarheid: de herlading wist een half getypte reden in het blokkeringsvenster niet` (regel ~667): uitbreiden (en hernoemen naar `… en laat de cursor staan`): vóór `page.clock.runFor(1)` met `evaluate` de cursor op positie 3 zetten (`setSelectionRange(3, 3)` op `#av-reden`), na de herlading `await expect(modal.getByLabel('Reden')).toBeFocused()` en `selectionStart === 3 && selectionEnd === 3`. Nieuw: dezelfde controle voor het tabblad "Beschikbaarheden" (`#bav-reden`).
- [ ] **Step 2: Run** `npx playwright test --project=chromium e2e/instellingen-toestel.spec.mjs e2e/productie/verbinding.spec.mjs` → Expected: FAIL (de drie omgekeerde/uitgebreide tests rood op de oude code).
- [ ] **Step 3: Implementeer** de drie wijzigingen hierboven.
- [ ] **Step 4: Run** de commando's → PASS; `npx playwright test --project=chromium e2e/instellingen-rapport.spec.mjs e2e/beschikbaarheid.spec.mjs` → PASS.
- [ ] **Step 5: Commit** `fix(ui): weekdagen pas bij Opslaan, focus op het nieuwe prijsonderdeel en cursor blijft staan bij hertekenen (B12, B13, B14)`

---

### Task 11: B16 — "Toewijzen" stelt het eerste vrije uur voor i.p.v. altijd 09:00

**Files:**
- Modify: `public/js/planner-tijdlijn.js` (nieuwe pure functie), `public/js/schermen/capaciteit.js` (toestandslezer), `public/js/schermen/ticketdetail.js` (`toggleAssignRow` regels ~327–352), `public/js/schermen/kalender.js` (de toewijsrij regels ~480–481 en `initKalender`-acties ~55–65), `public/js/app.js` (één afhankelijkheid in de `initTicketdetail`-aanroep en één in `initKalender`)
- Test: `tests/planner-tijdlijn.test.mjs`, `tests/capaciteit.test.mjs`, `e2e/route-tijden.spec.mjs`

**Interfaces:**
- Produces:
  - `eersteVrijeStart({ items, duurMin, vanTijd, laatsteStart, reisMin, vroegst }): { startMin: number, laat: boolean }` in `planner-tijdlijn.js`: plaatst één nieuw ticket (zonder uur) met dezelfde regel als `leggDagUit`/`plaatsNieuw` (zelfde reistijd, vaste uren, botsing en "volgende stop"-controle) maar **zonder** grens op `maxPerDag`; `laat = startMin > laatsteStart`. Pure functie, geen DOM.
  - `eersteVrijUur(datum, ticketId): string | null` in `capaciteit.js` (toestandslezer, gebruikt `eersteVrijeStart`): `'HH:MM'` (naar het volgende kwartier afgerond met `roundToNextQuarterStr(minToTimeStr(startMin))`) op basis van `dagItemsVan(datum)`, `settings.vanTijd`/`laatsteStart`, de duur van het ticket (`afh.duurVoor`) en voor **vandaag** `vroegst` = de klok van nu; `null` bij een feestdag of een hele-dag-blokkering.
- Gedrag in `toggleAssignRow(ticketId)`: voorkeursuur van de klant (`kbPreferredTime`) heeft voorrang (ongewijzigd); anders `afh.eersteVrijUur(datum, ticketId)`; is dat `null` of er gaat iets mis, dan blijft de terugval `09:00` (de huidige `afh.computeArrivalTimes`-tak vervalt, die leverde voor een ticket zonder datum nooit een waarde op). Als de datum in de rij wijzigt (`data-wijzig="kal-toewijzen-datum"`) wordt het uur opnieuw voorgesteld, **tenzij** de gebruiker het uur al zelf aanpaste (`data-invoer="kal-toewijzen-tijd"` zet `dataset.handmatig`). `saveToewijzen` en de `value="09:00"`-terugval bij een leeg veld blijven als vangnet.

- [ ] **Step 1: Failing tests**
  - `tests/planner-tijdlijn.test.mjs`: `eersteVrijeStart: lege dag geeft vanTijd + reistijd`; `een vast uur 08:30–10:30 duwt het voorstel naar 11:00 (reistijd inbegrepen)`; `een gat tussen twee vaste stops waar het ticket past`; `een tijdvak-blokkering (soort blok) telt mee zonder reistijd`; `vroegst (vandaag 10:12) geeft niet vóór 10:42`; `volle dag: startMin na laatsteStart met laat true`; `maxPerDag speelt geen rol`.
  - `tests/capaciteit.test.mjs`: `eersteVrijUur(datum): afrondend naar het volgende kwartier` en `null bij feestdag/hele-dag-blokkering` (met de bestaande toestand-opzet van de andere tests in dat bestand).
  - `e2e/route-tijden.spec.mjs`, test `📅 Toewijzen: tijdstip vooraf ingevuld, met en zonder berekende route` (regel ~140): omgekeerd — de twee `toHaveValue('09:00')`-assertions worden het uur dat de plaatsingsregel voor die dag geeft (meet eerst op de rode run, leg dan de gemeten waarde vast met een commentaarregel die de afleiding geeft: `vanTijd 10:00`, twee bestaande stops, reistijd 30 min); de omschrijving ("terugvalwaarde 09:00") wordt aangepast. Nieuw: `datum wijzigen in de toewijsrij stelt het uur opnieuw voor; een zelf aangepast uur blijft staan`.
  - Behouden groen: `📅 Toewijzen` met een voorkeursuur van de klant (voorrang), `BUGFIX (etappe 3, R6)`-tests in hetzelfde bestand.
- [ ] **Step 2: Run** `node --test tests/planner-tijdlijn.test.mjs tests/capaciteit.test.mjs` en `npx playwright test --project=chromium e2e/route-tijden.spec.mjs e2e/kalender.spec.mjs` → Expected: FAIL.
- [ ] **Step 3: Implementeer** de pure functie, de lezer en de aanpassingen in `ticketdetail.js`/`kalender.js`; in `app.js` komt enkel `eersteVrijUur: capaciteit.eersteVrijUur` bij de bestaande afhankelijkhedenlijst van `initTicketdetail` (geen andere wijziging).
- [ ] **Step 4: Run** de commando's → PASS; `node --test` (volledig) → PASS.
- [ ] **Step 5: Commit** `fix(planning): "Toewijzen" stelt het eerste vrije uur voor i.p.v. altijd 09:00 (B16)`

---

### Task 11b: Knop "Opnieuw versturen" in Beheer → Systeemstatus (beslissing Brent 2026-10-09) (**LIVE-KRITIEK: rapport naar Zoho**)

**Files:**
- Modify: `public/js/schermen/beheer-systeemstatus.js` (knop per mislukt rapport), eventueel een pure helper in een `-logica.js`-bestand ernaast
- Test: unit voor de pure helper; e2e in `e2e/beheer-tabs.spec.mjs` (of een nieuwe `e2e/beheer-opnieuw.spec.mjs`)

**Interfaces:**
- Consumes: het bestaande serverpad om een mislukt rapport opnieuw te laten verwerken: `POST /api/rapport-archief` met `{ opnieuw: <id> }` (upload-fix + logins T17b: start de achtergrondverwerking met de interne sleutel `X-Blitz-Intern`; voor de beheerder toegelaten — controleer de rechten in `netlify/functions/rapport-archief.js` en `netlify/lib/eigen.js`). Geen nieuwe serverfunctie.
- Produces: per rij in de tabel "Mislukte rapporten" een knop **"Opnieuw versturen"**.

Gedrag: klik → bevestiging "Dit rapport opnieuw naar Zoho sturen?" → knop uitgeschakeld met "Bezig…" → bij succes (202/200) toast "Rapport staat opnieuw in de wachtrij" en de rij toont "opnieuw in behandeling"; de lijst herlaadt na ±10 s of via "Vernieuwen"; 503 → toast "De opslag is tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw." en knop weer bruikbaar; 4xx → toast met de servermelding. Dubbelklik stuurt nooit twee aanvragen. Het activiteitenlog krijgt de bestaande actie `rapport-opnieuw` (staat al in het koppelvlak; controleer dat de server ze logt, anders toevoegen met het label in `ACTIES`).

- [ ] **Step 1: Tests (RED):** pure helper (knoptoestand per antwoordstatus); e2e met gestubde `/api/systeemstatus` (één mislukt rapport) en gestubde `POST /api/rapport-archief`: bevestigen → precies één POST met `{ opnieuw: '<id>' }` en header `X-Blitz: 1`, toast, rij toont "opnieuw in behandeling"; 503-variant: knop weer bruikbaar. (De e2e-vangnetfixture faalt op HTTP ≥ 400: verwijder die regels zelf na de controle, zoals `e2e/logins-rechten.spec.mjs`.)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implementeer.** **Step 4: Run** → PASS; `node --test` volledig.
- [ ] **Step 5: Commit** `feat(beheer): knop "Opnieuw versturen" bij mislukte rapporten (Systeemstatus)`

---

### Task 12: Afronding — changelog, bugsdocument, releasechecklist en volledige controle

**Files:**
- Modify: `CHANGELOG.md`, `docs/bugs-en-open-punten.md`, `docs/release-checklist-2.0.md`
- Geen code.

**Interfaces:** geen.

- [ ] **Step 1: Changelog.** Voeg onder "Refactor-tak — nog niet uitgebracht" een sectie **Fixed** toe met één regel per opgelost punt, in gewone taal (niet technisch): B1 voorstelstatus gaat niet meer verloren bij gelijktijdig werken; B2 duidelijke waarschuwing als de mail al weg is maar Zoho het ticket niet bijwerkte; B4 voorstel en rapport worden automatisch als verzonden aangevinkt als de mail in Zoho terugvindt; B5 verzendknop weer bruikbaar na een serverfout; B6 één melding met alle mislukte statusupdates; B7 rapportwizard vraagt de aanrijtijd zelf als ze niet berekend kon worden; B8 geen blokkering zonder datum of einddatum; B9 blokkeringsvenster houdt de getoonde dag vast; B10 notitie van een handmatige afspraak staat niet meer op de plaats van het adres; B11 afspraak zonder uur zichtbaar in de dagkop; B12 weekdagen in de instellingen pas bij Opslaan; B13 focus op het nieuwe prijsonderdeel; B14 cursor blijft staan bij het hertekenen van het blokkeringsvenster; B16 "Toewijzen" stelt het eerste vrije uur voor. Geen versie-bump.
- [ ] **Step 2: Bugsdocument.** In `docs/bugs-en-open-punten.md`: B1, B2, B4, B5, B6, B7, B8, B9, B10, B11, B12, B13, B14 en B16 doorstrepen met "**Opgelost op refactor** (kleine fouten, <datum>)"; C2 en C4 als beantwoord/opgelost markeren (zoals C3); B3 en B17 krijgen de toevoeging "bewust zo gelaten (Brent, 2026-10-08)"; C1 "beantwoord: tekst blijft". Sectie E blijft als beslissingslog staan, met één regel "Uitgevoerd in `docs/superpowers/plans/2026-10-09-kleine-fouten.md`".
- [ ] **Step 3: Releasechecklist.** In het deel "Te doen vóór de release" van `docs/bugs-en-open-punten.md` en in `docs/release-checklist-2.0.md`: één regel toevoegen: "Op een echt ticket (samen met de mailcontrole-test): na een afgebroken verzending van voorstel en van rapport controleren dat het voorstel/rapport automatisch als verzonden aangevinkt wordt; de foutpaden (Zoho-PATCH faalt na de mail) zijn enkel met nep-antwoorden getest."
- [ ] **Step 4: Volledige controle.** `node --test` (volledig) en `npx playwright test --project=chromium` (volledig): alle tests groen, aantal ≥ de baseline van Task 0 plus de nieuwe tests. `grep -rn "HUIDIG GEDRAG" e2e tests` moet enkel nog de bewust behouden gevallen tonen: B3 (`e2e/productie/annuleren.spec.mjs`), B17 (`e2e/route-slepen-render.spec.mjs`) en de niet-B-gevallen (`e2e/productie/oplossing.spec.mjs`, `tests/rapport-verzenden.test.mjs`). `git diff --stat refactor` mag geen wijziging tonen in `package.json` of `CACHE_NAME` (`public/sw.js`, enkel de SHELL-regel).
- [ ] **Step 5: Handmatige browsercontrole** via `node blobs-local-bootstrap.mjs` en `http://localhost:3333/?test` (nooit zonder `?test`): in de testmodus doen de voorstel- en rapportpaden niets echts, dus enkel visueel nakijken: wizardstap Facturatie met een geforceerde aanrijtijdfout (poort van `/api/route` blokkeren in DevTools), blokkeringsvenster, weekdagen annuleren, prijsbeheer "+ Onderdeel", "Toewijzen"-uur, afspraak zonder uur. Daarna skill `opruimen-na-werk`.
- [ ] **Step 6: Commit** `docs: changelog, bugsdocument en releasechecklist voor de kleine fouten (B1–B16, B7)`

---

## Open vragen voor Brent — BEANTWOORD 2026-10-09: alle vier zoals het plan aannam (zie `docs/bugs-en-open-punten.md` sectie G); daarnaast Task 11b toegevoegd

1. **B2:** is de mail al weg maar kon Zoho het ticket niet bijwerken (status en datum), dan waarschuwt de app en laat ze het rechtzetten in Zoho zelf over aan de planner. Moet er in plaats daarvan een knop "Ticket alsnog bijwerken" komen (die enkel het ticket bijwerkt, zonder opnieuw te mailen)? (Plan: enkel waarschuwen.)
2. **B10:** bij handmatige afspraken zonder adres staat de notitie voortaan als "Notitie" in de fiche en op het kaartje. De routeberekening en de capaciteit blijven die notitie wel als locatie gebruiken (zoals nu). Akkoord, of moet de route dan ook stoppen met de notitie als adres te gebruiken? (Plan: route ongewijzigd.)
3. **B16:** zit de gekozen dag al vol, dan kan het eerste vrije uur na het laatste startuur vallen. Stellen we dat uur toch voor (plan), of vallen we terug op het begin van de werkdag?
4. **B7:** de technieker moet bij een mislukte aanrijtijdberekening een waarde invullen (0 mag) voor hij verder kan in de stap Facturatie. Akkoord, of mag hij ook doorgaan met een leeg veld zolang de melding zichtbaar blijft? (Plan: invullen is verplicht.)

## Zelfreview tegen sectie E (uitgevoerd bij het schrijven)

| Punt in sectie E | Waar gedekt |
|---|---|
| B1 dubbel conflict, geen waarschuwing | Task 5 |
| B2 fout ná de mail zonder waarschuwing/controle | Task 4 (server) + Task 6 (client) |
| B4 / C2 automatisch "verzonden" bij teruggevonden mail (voorstel én rapport) | Task 2 (basis) + Task 3 (rapport) + Task 6 (voorstel) |
| B5 knop blijft uitgeschakeld | Task 1 |
| B6 alle mislukte statusupdates tonen | Task 1 |
| B7 / C4 melding "aanrijtijd kon niet berekend worden" met invoerveld | Task 7 |
| B8 afwezigheid zonder einddatum en lege datum | Task 8 |
| B9 datum verspringt de getoonde dag | Task 8 |
| B10 notitie op de plaats van het adres | Task 9 |
| B11 afspraak zonder uur niet op de tijdlijn | Task 9 |
| B12 weekdag + Annuleren | Task 10 |
| B13 cursor na "+ Onderdeel" | Task 10 |
| B14 cursor verspringt in het blokkeringsvenster | Task 10 |
| B16 eerste vrije uur i.p.v. 09:00 | Task 11 |
| **Niet** doen: B3, B17 | uitdrukkelijk onder "Buiten bereik"; hun `HUIDIG GEDRAG`-tests blijven (Task 12 stap 4) |
| C1 tekst is goed | niets te doen (onder "Buiten bereik") |

Gevolgde afwijkingen/keuzes die Brent niet expliciet vroeg: de derde, versieloze poging bij het voorstelregister (Task 5) en de status-write zonder `versie` na een gevonden rapportmail (Task 3) — beide om te voorkomen dat een al verzonden mail "niet geregistreerd" blijft; de uitbreiding van B6 met geweigerde ontvangers bij een deels gelukte verzending (Task 1); `aanrijtijdBron` in `rapportData` (Task 7).
