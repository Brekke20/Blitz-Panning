# Testopslag (v1.8.1) — Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Verzoeken uit testmodus gebruiken op de server een aparte opslag (`blitz-data-test`, gestart als kopie van de echte opslag) en schrijven nooit naar Zoho. In de app komt een resetknop.

**Architecture:**
- Een fetch-wrapper in `<head>` zet `X-Blitz-Test: 1` op `/api/`-verzoeken.
- Een gedeelde helper `netlify/lib/testmodus.js` bepaalt het testverzoek, de naam van de opslag, de testkopie en het nep-antwoord voor Zoho.
- Functies gebruiken die helper.
- Een nieuwe functie `testdata.js` doet de reset.

**Spec:** `docs/superpowers/specs/2026-09-29-testopslag-design.md` (lees volledig).

## Global Constraints
- Header: `X-Blitz-Test: 1`. Opslagnamen: `blitz-data` (echt) en `blitz-data-test` (test).
- Uitgesloten van de kopie: sleutels die beginnen met `client-log`, `rapport-verzend-status` of `foto-`. Markeersleutel `_testkopie`.
- Zoho-schrijffuncties geven bij een testverzoek een nep-succes **vóór** elke token- of Zoho-fetch.
- `confirm-afspraak`, `tickets`, `setup`, `planning-export` en de TomTom-functies blijven ongewijzigd.
- **Tijdens het testen nooit een Zoho-schrijffunctie aanroepen zonder testheader.** Lokaal gebruikt `.env.local` echte Zoho-gegevens.
- Buiten testmodus: exact hetzelfde gedrag als nu.
- Branch `worktree-testopslag`. Regels uit `implementer-rules.md` in de SDD-map.

## Review Focus
1. Buiten testmodus is er geen verschil. Voor elke aangepaste functie: zonder header dezelfde opslag en hetzelfde Zoho-gedrag als vroeger.
2. Het kopiëren mag geen verzoek blokkeren of eindeloos herhalen. Het is idempotent, ook bij gelijktijdige eerste verzoeken.
3. De vorm van het nep-antwoord van Zoho klopt met wat de app verwacht (geen foutmelding, en geen staat die half blijft hangen).
4. `rapport.js` (v1, met eigen idempotentie- en reservatielogica) gebruikt in test de testopslag en uploadt niets.
5. De helper wordt meegebundeld (import-pad) zowel op Netlify als in `dev-server.mjs`.

---

### Task 1: Helper, fetch-markering en de reset-functie (model: sonnet)
**Files:**
- Create: `netlify/lib/testmodus.js`, `netlify/functions/testdata.js`
- Modify: `public/index.html` (`<head>`: inline fetch-wrapper vóór de andere scripts)

**Interfaces:**
- Produces: `isTestVerzoek(reqOfEvent)`, `winkelNaam(reqOfEvent)`, `zorgVoorTestkopie(getStore)`, `nepZohoAntwoord(extra)`. Taak 2 en 3 gebruiken ze.
- Produces: `POST /api/testdata`.

- [ ] **Stap 1:** De helper volgens spec §2. De geheugenvlag geldt per koude start. Kopieer met `store.list()` plus `get` en `set` (binary-safe: `type: 'arrayBuffer'` en `set` met een ArrayBuffer, of JSON als alles JSON is; nagaan). Gelijktijdige kopieën vermijden via een in-memory promise.
- [ ] **Stap 2:** `testdata.js` volgens spec §5. CORS en OPTIONS zoals in de andere v2-functies.
- [ ] **Stap 3:** De fetch-wrapper volgens spec §1. Hij werkt met string-URL's, `URL`-objecten en `Request`-objecten, en behoudt de bestaande headers (`Headers` samenvoegen).
- [ ] **Stap 4:** Verificatie op `http://127.0.0.1:3333` (lokale Blobs):
  - `curl -X POST /api/testdata` → 403;
  - met header → 200 en `gekopieerd > 0`;
  - in de browser met `?test` het netwerk inspecteren: `/api/afspraken` heeft de header, zonder `?test` niet (bv. `performance`, of een tijdelijke logregel in de dev-server);
  - ruwe uitvoer.
- [ ] **Stap 5:** Commit `feat(test): testmodus-markering en gedeelde server-helper met testkopie`.

### Task 2: Opslagfuncties gebruiken de testopslag (model: sonnet)
**Files:** `netlify/functions/{afspraken,availability,client-log,fotos,inventaris,klantbeschikbaarheid,prijzen,rapport-archief,rapport-verzonden,voorstel-status}.js`.

- [ ] **Stap 1:** In elke functie: `name: 'blitz-data'` wordt `name: winkelNaam(req)`. Bij een testverzoek komt `await zorgVoorTestkopie(getStore)` vóór het eerste gebruik van de opslag, binnen de bestaande try waar die er is.
- [ ] **Stap 2:** Verificatie met curl, voor elke functie die kan schrijven:
  - GET zonder header, en noteer;
  - PUT/POST met header, met een kleine, geldige wijziging die de functie accepteert (lees de code);
  - GET met header toont de wijziging;
  - GET zonder header toont ze niet.
  Ruwe uitvoer. Voor `fotos` is een kleine dummy genoeg.
- [ ] **Stap 3:** Commit `feat(test): opslagfuncties schrijven in testmodus naar blitz-data-test`.

### Task 3: Zoho-schrijffuncties en rapport.js (model: sonnet)
**Files:** `netlify/functions/{comment,plan,plan-datum,propose,send-rapport,rapport}.js`.

- [ ] **Stap 1:** Bij `isTestVerzoek` meteen na de CORS- en OPTIONS-afhandeling en de methodecontrole: return met status 200 en `nepZohoAntwoord(...)`, in de antwoordvorm die de app van die functie verwacht (lees de client-code; bv. `propose` kan velden terugsturen die de app gebruikt). Nergens een token- of Zoho-fetch.
- [ ] **Stap 2:** `rapport.js`: de opslag gaat via `winkelNaam(event)`. Bij een test wordt de PDF-generatie en de upload overgeslagen (dure chromium-stap) en komt direct het succesantwoord dat de app verwacht (lees outbox.js `attemptOutboxItem` en de stappen). De opslag van de idempotentie in de testopslag mag, maar is niet nodig.
- [ ] **Stap 3:** Verificatie: voor elke functie een curl **met** header en een minimale body → 200 en `test: true`. Aantonen dat er geen Zoho-fetch gebeurde, via een tijdelijke `globalThis.fetch`-spy in een node-script dat de handler rechtstreeks importeert (aanbevolen), of via de serverlog. **Geen enkele aanroep zonder header.** Ruwe uitvoer.
- [ ] **Stap 4:** Commit `feat(test): Zoho-schrijffuncties en rapport-upload geven in testmodus nep-succes`.

### Task 4: Resetknop in "Dit toestel" (model: sonnet)
**Files:** `public/index.html` (het subtabblad "Dit toestel" in het instellingenvenster).

- [ ] **Stap 1:** Een blok "Testgegevens" dat alleen zichtbaar is als `TEST_MODE`, met de knop en de teksten uit spec §5 (bevestiging via `appConfirm`, dan `POST /api/testdata`, toast en reload). Bij een fout: de toast "Testgegevens kopiëren mislukt — probeer opnieuw".
- [ ] **Stap 2:** Verificatie:
  - zonder `?test` is het blok niet zichtbaar;
  - met `?test`: op "Terug" klikken doet niets; op "Opnieuw kopiëren" klikken geeft een POST met header, 200 en een herlaadbeurt.
  Ruwe uitvoer.
- [ ] **Stap 3:** Commit `feat(test): knop 'Testgegevens opnieuw kopiëren' in Dit toestel`.

### Task 5: Afronden (hoofdsessie)
- [ ] Eindreview (**opus**).
- [ ] Versie 1.8.1, CHANGELOG, `CACHE_NAME` v17.
- [ ] Samenvatting voor Brent. **Pas na zijn ja**: pushen en taggen `v1.8.1`.
- [ ] Na de deploy de live check:
  - `POST /api/testdata` zonder header → 403;
  - met `?test` op de live site een afspraak toevoegen → die is niet zichtbaar zonder `?test`.
