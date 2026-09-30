# Afspraak annuleren + bevestiging per ontvanger — bouwplan (v1.10.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coördinatoren kunnen een afspraak annuleren met een verplichte reden (optioneel met klantmail). Bij een bevestiging zie je via welke ontvanger (klant, installateur of contact) er bevestigd werd.

**Architecture:**
- Pure logica komt in kleine, testbare modules onder `netlify/lib/`:
  - `bevestigingslink.js`: HMAC, oud en nieuw linkformaat, datum in Brussel;
  - `voorstelregister.js`: het blob `voorstel-status`;
  - `annulatie.js`: redenen, validatie, mail-HTML en notitie.
- De functies `annuleer.js` (nieuw), `voorstel-status.js`, `propose.js` en `confirm-afspraak.js` gebruiken die modules.
- De planner (`public/index.html`) haalt de redenenlijst en het mailvoorbeeld bij de server op. De mailtekst bestaat dus maar op één plek.

**Tech Stack:** Netlify Functions (ESM; v1 `handler(event)` en v2 `export default (req)`), Netlify Blobs, Zoho Desk REST, vanilla JS-PWA. Tests met de ingebouwde `node --test` (Node 24), zonder nieuwe dependencies.

**Spec:** `docs/superpowers/specs/2026-09-30-afspraak-annuleren-design.md`

## Global Constraints
- **Branch** `worktree-afspraak-annuleren` in deze worktree. Elke implementer voert eerst `git branch --show-current` uit. Commits alleen hier, nooit in de main-checkout.
- **Geen push of merge naar main** zonder Brents "ja". Geen enkele echte Zoho-call of mail tijdens bouw of test.
- **Testmodus:**
  - `isTestVerzoek(req|event)` betekent geen `fetch` naar Zoho;
  - antwoorden via `nepZohoAntwoord(...)`;
  - Blobs via `getStore({ name: winkelNaam(req), consistency: 'strong' })`.
- **Doelgroepen** exact `'contact' | 'klant' | 'installateur'`.
- **Status na annuleren** exact `'Wachten op planning'`, met `cf: { cf_interventie_datm: '' }`.
- **Volgorde bij Zoho:** eerst `sendReply`, pas daarna de PATCH (anders zet Zoho de status terug op "Wachten op klant").
- **Redenen en klantzinnen, letterlijk:**
  - `ziek`: "Technieker ziek of onbeschikbaar" → "Onze technieker is onverwacht niet beschikbaar."
  - `onderdelen`: "Onderdelen niet op tijd geleverd" → "De nodige onderdelen zijn niet op tijd bij ons geleverd."
  - `klant`: "Klant vroeg om te verzetten" → "Zoals met u besproken, verplaatsen we deze afspraak."
  - `weer`: "Weersomstandigheden" → "De weersomstandigheden laten niet toe om de werken veilig uit te voeren."
  - `fout`: "Dubbele of foute planning" → "Door een fout in onze planning kan deze afspraak niet doorgaan."
  - `andere`: "Andere" → de toelichting zelf.
- **Toelichting:** max. 1000 tekens. Verplicht bij `andere`, en alleen dan komt ze in de mail.
- **UI-stijl:**
  - bestaande tokens en `.btn`-set (`btn--danger`, `btn--secondary`, `btn--ghost`);
  - Blitz-groen `#00dfa3` ongewijzigd;
  - aanraakdoelen ≥ 44 px bij `html[data-aanraak="ja"]`;
  - dialoog met `role="dialog"`, focus trap en Escape via `public/js/venster.js`;
  - knop `coord-only`.
- **Regressie per taak:**
  - `node --check` op elke gewijzigde `.js` of `.mjs`;
  - inline scripts van `index.html` compileren (zelfde `new Function`-check als eerdere fases);
  - `node --test tests/` groen.

> **Afwijking t.o.v. spec §3.5 (ruling):** in plaats van `reset: true` op de eerste van meerdere parallelle POSTs komt er één atomische POST met `doelgroepen[]`. De parallelle POSTs met dezelfde `versie` gaven vandaag al een 409 op de tweede doelgroep.

## Review Focus
1. **Doelgroep ontbreekt of is vervalst:** een link zonder `d` (oud formaat) moet werken en "onbekende ontvanger (oude link)" loggen. Een link met aangepaste `d` is ongeldig. Test in Taak 1.
2. **Datum rond middernacht:** `cf_interventie_datm` = `2026-10-13T22:30:00.000Z` is in Brussel 14/10, dus de link voor `2026-10-14` is geldig. Test in Taak 1.
3. **Parallelle registerschrijvingen:** een voorstel naar klant én installateur schreef vroeger twee POSTs met dezelfde `versie`. Daardoor faalde de tweede met 409 en ontbrak die doelgroep stil. Dat wordt één atomische POST met `doelgroepen[]`. Test in Taak 2.
4. **Annuleren zonder mailadres of met mail = Nee:** geen `sendReply`, wel PATCH, notitie en register wissen. Test in Taak 4.
5. **Dubbele klik en Escape tijdens het versturen:** geen tweede request, en het venster sluit niet halverwege. Controle in Taak 5.

---

### Task 1: Gedeelde bevestigingslink (model: sonnet)

**Files:**
- Create: `netlify/lib/bevestigingslink.js`
- Create: `tests/bevestigingslink.test.mjs`
- Modify: `netlify/functions/propose.js` (verwijder de lokale `signConfirmToken` rond regel 20–28, en maak de link per ontvanger in de lus rond regel 320–345)
- Modify: `netlify/functions/confirm-afspraak.js` (vervang `sign`/`signConfirmToken`/`verify` rond regel 70–100 door de helper; `d` in het GET-formulier en in de POST)

**Interfaces:**
- Produces:
  - `tekenLink(ticketId: string, date: string, exp: number, doelgroep?: string) -> string` (hex HMAC-SHA256 met `CONFIRM_LINK_SECRET`). Bericht: `${ticketId}.${date}.${exp}` zonder doelgroep, `${ticketId}.${date}.${exp}.${doelgroep}` met doelgroep. Gooit een fout zonder secret.
  - `maakBevestigingsUrl({ basis: string, ticketId, date, exp, doelgroep }) -> string`: `${basis}/api/confirm-afspraak?ticketId=…&date=…&exp=…&d=…&sig=…`.
  - `controleerLink({ ticketId, date, exp, d, sig }) -> { geldig: boolean, doelgroep: string|null }`.
    - Numeriek `ticketId`, niet verlopen, `timingSafeEqual`.
    - Is `d` aanwezig, dan moet het een geldige doelgroep zijn en is het nieuwe formaat verplicht.
    - Is `d` afwezig, dan geldt het oude formaat en is `doelgroep` null.
  - `datumInBrussel(iso: string) -> 'YYYY-MM-DD' | null`, via `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' })`. Leeg of ongeldig geeft null.

- [ ] **Step 1: Tests schrijven** in `tests/bevestigingslink.test.mjs` (`node:test` + `node:assert/strict`; zet `process.env.CONFIRM_LINK_SECRET = 'test-geheim'` vóór de dynamische import):
  - `nieuw formaat geldig` → `{geldig:true, doelgroep:'installateur'}`
  - `oud formaat geldig` → `{geldig:true, doelgroep:null}`
  - `d gewijzigd na ondertekenen` (link voor `klant`, gecontroleerd met `d:'installateur'`) → `geldig:false`
  - `onbekende doelgroep` (`d:'baas'`) → `geldig:false`
  - `verlopen` (`exp` = nu − 10) → `geldig:false`
  - `niet-numeriek ticketId` → `geldig:false`
  - `datumInBrussel('2026-10-13T22:30:00.000Z') === '2026-10-14'`, `datumInBrussel('2026-07-01T21:59:00.000Z') === '2026-07-01'`, `datumInBrussel('') === null`
  - `maakBevestigingsUrl` bevat `&d=klant&sig=` en de `sig` klopt met `tekenLink`
- [ ] **Step 2:** `node --test tests/bevestigingslink.test.mjs`. Verwacht: FAIL (module bestaat niet).
- [ ] **Step 3:** `netlify/lib/bevestigingslink.js` implementeren volgens de Interfaces.
- [ ] **Step 4:** `node --test tests/`. Verwacht: alles PASS.
- [ ] **Step 5: `propose.js` aanpassen.**
  - Het `confirmUrl`-blok verhuist naar binnen de `for (const { doelgroep, email } of ontvangers)`-lus: per ontvanger `maakBevestigingsUrl({ basis: process.env.URL || 'http://localhost:8888', ticketId, date, exp, doelgroep })`.
  - De eigen try/catch blijft: bij een fout is `confirmUrl = null`.
- [ ] **Step 6: `confirm-afspraak.js` aanpassen.**
  - `d` lezen uit de query (GET) en het formulier (POST).
  - `confirmFormHtml` krijgt een hidden `d` (alleen als aanwezig; veilig om letterlijk in te voegen omdat `controleerLink` `d` al tegen de lijst van doelgroepen gecontroleerd heeft).
  - `verify(...)` wordt vervangen door `controleerLink(...)`.
  - De rest van de flow wijzigt nog niet (dat is Taak 3).
- [ ] **Step 7:** `node --check` op de drie functiebestanden plus `node --test tests/`. Verwacht: geen uitvoer of fout, tests PASS.
- [ ] **Step 8: Commit:** `feat(bevestiging): eigen ondertekende link per ontvanger (oud formaat blijft geldig)`

### Task 2: Voorstelregister — wissen en atomisch schrijven (model: sonnet)

**Files:**
- Create: `netlify/lib/voorstelregister.js`
- Create: `tests/voorstelregister.test.mjs`
- Modify: `netlify/functions/voorstel-status.js`
- Modify: `public/index.html` (voorstel-verzendlus rond regel 6390–6415)

**Interfaces:**
- Produces (alle functies werken op een meegegeven `store` met `get(key,{type:'json'})` en `setJSON(key,val)`, zodat ze testbaar zijn met een nep-store):
  - `leesRegister(store) -> {versie:number, status:object}`
  - `schrijfVoorstel(store, { ticketId, doelgroepen: string[], tijdstip, tijdslot?, tijdslotDatum?, reset?: boolean, versie?: number }) -> {ok:true, versie} | {conflict:true, serverVersie}`.
    - Eén schrijfbeurt.
    - `reset:true` vervangt de hele entry van het ticket, inclusief een eventuele `bevestigd`.
    - `tijdslot` en `tijdslotDatum` worden alleen bewaard als ze voldoen aan de bestaande regexen.
  - `wisVoorstel(store, ticketId) -> {versie}`: verwijdert de entry en doet altijd `versie + 1`, zonder conflictcontrole (idempotent).
  - `markeerBevestigd(store, ticketId, { door: string|null, tijdstip }) -> {versie}`: zet `status[ticketId].bevestigd = { door, tijdstip }`. Bestaat de entry niet, dan wordt ze aangemaakt.
- **API `voorstel-status.js`:**
  - POST aanvaardt `doelgroepen: [...]` (nieuw) naast het oude `doelgroep` (wordt `[doelgroep]`), plus `reset`;
  - nieuw: `DELETE ?ticketId=123` geeft `{ok:true, versie}`, en 400 bij een niet-numeriek ticketId.

- [ ] **Step 1: Tests** met een nep-store (object met een `Map`):
  - `schrijft meerdere doelgroepen in één keer` (klant + installateur → beide aanwezig, versie +1);
  - `versieconflict geeft conflict`;
  - `reset wist oude doelgroep, tijdslot en bevestigd`;
  - `zonder reset blijven bestaande velden`;
  - `ongeldig tijdslot wordt genegeerd`;
  - `wisVoorstel verwijdert entry en verhoogt versie, ook als entry niet bestaat`;
  - `markeerBevestigd bewaart door en tijdstip, ook met door:null`.
- [ ] **Step 2:** `node --test tests/voorstelregister.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3:** `netlify/lib/voorstelregister.js` implementeren. `voorstel-status.js` omzetten naar de helper en DELETE toevoegen. CORS `Access-Control-Allow-Methods` moet DELETE bevatten als die header gezet wordt.
- [ ] **Step 4:** `node --test tests/`. Verwacht: PASS.
- [ ] **Step 5: `index.html` aanpassen.** Na een geslaagde `/api/propose` (niet-TEST_MODE-pad) vervangt **één** POST de lus per doelgroep:
  - `{ ticketId, doelgroepen: [alle doelgroepen met data.emailSent[d] === true], tijdstip, reset: true, versie: _voorstelStatusVersie, ...tijdslot }`;
  - bij succes: `voorstelStatus[ticketId] = { [d]: tijdstip…, tijdslot?, tijdslotDatum? }` (vervangen, niet aanvullen) en `_voorstelStatusVersie` bijwerken;
  - bij een 409: `loadVoorstelStatus()` en dan één keer opnieuw.
  - In het TEST_MODE-pad wordt `voorstelStatus[ticketId]` ook vervangen in plaats van aangevuld.
- [ ] **Step 6:** `node --check` plus de inline-scriptcheck. In de browser op `http://127.0.0.1:3333/?test` (eigen tab, niets versturen buiten testmodus): een voorstel doen in testmodus. Daarna gaat een GET `/api/voorstel-status` via `javascript_tool` (met testheader). Verwacht: één entry, zonder oude velden.
- [ ] **Step 7: Commit:** `feat(voorstel-status): atomisch schrijven, reset bij nieuw voorstel, DELETE`

### Task 3: Bevestiging registreert ontvanger en controleert datum (model: sonnet)

**Files:**
- Modify: `netlify/functions/confirm-afspraak.js` (POST-pad rond regel 230–295)
- Test: `tests/bevestigingslink.test.mjs` (alleen als `bevestigingsNotitie` in de lib komt; zie hieronder)

**Interfaces:**
- Consumes: `controleerLink`, `datumInBrussel` (Taak 1); `markeerBevestigd` (Taak 2).
- Produces: `bevestigingsNotitie({ date, doelgroep: string|null, email: string, tijdstip: string, ip: string }) -> string` in `netlify/lib/bevestigingslink.js`:
  - met doelgroep: `Afspraak bevestigd voor ${date} door ${doelgroep} (${email}) via bevestigingslink op ${tijdstip} (Europe/Brussels). IP-adres: ${ip}.`;
  - zonder email: de haakjes vallen weg;
  - zonder doelgroep: `door onbekende ontvanger (oude link)`.

- [ ] **Step 1: Tests** `bevestigingsNotitie` voor de drie vormen (met doelgroep en email, met doelgroep zonder email, oude link). Verwacht: eerst FAIL, na implementatie PASS.
- [ ] **Step 2: Ticket ophalen.** De bestaande status-GET leest ook `cf.cf_interventie_datm`, `contact.email`, `contact.emailId`, `email`, `cf.cf_e_mail_eindklant` en `cf.cf_e_mail_installateur`.
  - Weigeren met de bestaande 409-pagina "Afspraak niet meer actueel" als de status niet exact `'Wachten op bevestiging planning'` is, **of** als `datumInBrussel(cf_interventie_datm) !== date`.
  - Mislukt de GET zelf, dan geldt het bestaande terugvalgedrag (gewoon PATCHen).
- [ ] **Step 3: Notitie.** Het mailadres voor de notitie is `klant` → `cf_e_mail_eindklant`, `installateur` → `cf_e_mail_installateur`, `contact` → het contactadres. De notitie gebruikt `bevestigingsNotitie`.
- [ ] **Step 4: Registreren.** Na een geslaagde PATCH volgt `markeerBevestigd(getStore({ name: 'blitz-data', consistency: 'strong' }), ticketId, { door: doelgroep, tijdstip: new Date().toISOString() })`.
  - De store is vast `blitz-data`: de externe link draagt nooit de testheader.
  - Dit staat in een eigen try/catch die alleen logt. De klant krijgt nooit een foutpagina door het register.
- [ ] **Step 5:** `node --check netlify/functions/confirm-afspraak.js` plus `node --test tests/`. Verwacht: PASS.
- [ ] **Step 6: Commit:** `feat(bevestiging): ontvanger en datumcontrole bij bevestigen, registratie in voorstel-status`

### Task 4: Annuleer-endpoint (model: sonnet)

**Files:**
- Create: `netlify/lib/annulatie.js`
- Create: `netlify/functions/annuleer.js`
- Create: `tests/annulatie.test.mjs`

**Interfaces:**
- Produces in `netlify/lib/annulatie.js`:
  - `REDENEN: Array<{code, label, klantzin}>` (letterlijk uit Global Constraints; `andere` heeft `klantzin: null`).
  - `valideerAnnulatie(body) -> { ok:true, waarde:{ticketId, reden, toelichting, mailKlant, door} } | { ok:false, fout:string }`.
    - `ticketId` numeriek (string of number).
    - `reden` ∈ codes.
    - `toelichting` getrimd, ≤ 1000, verplicht bij `andere`.
    - `mailKlant` boolean.
    - `door` optioneel, getrimd, ≤ 60.
  - `bouwAnnulatieMail({ naam, datum: 'YYYY-MM-DD', tijdslot?: string, uur?: string, reden, toelichting }) -> string`: HTML.
    - Tekst letterlijk zoals in spec §3.3.
    - Datum als `toLocaleDateString('nl-BE', {weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Brussels'})`.
    - Met tijdslot: `(tijdslot)`; zonder: `(om hh:mm)`.
    - Alle ingevoegde tekst (naam, toelichting) HTML-geëscaped.
    - Opmaak: huisstijl van `buildEmailHtml` in `propose.js` (kop en voet overnemen, zonder bevestigingsknop of bijlage).
  - `bouwAnnulatieNotitie({ datum, tijdslot?, uur?, door?, tijdstip, redenLabel, toelichting?, mailKlant, gemaild: string[] }) -> string`. Vorm uit spec §3.4 stap 5. Zonder `door` wordt het "via Blitz Planning".
- Produces **API `/api/annuleer`** (v2, `export const config = { path: '/api/annuleer' }`):
  - `GET` → `{ redenen: [{code,label}] }`, zonder Zoho.
  - `POST {voorbeeld:true, naam, datum, tijdslot?, uur?, reden, toelichting?}` → `{ html }`, zonder Zoho, ook buiten testmodus.
  - `POST {ticketId, reden, toelichting, mailKlant, door}`:
    - 400 bij een validatiefout.
    - **Testmodus:** geen `fetch` naar Zoho, wel `wisVoorstel` in de teststore, en antwoord `nepZohoAntwoord({ ok:true, emailSent:{contact:mailKlant,klant:false,installateur:false}, fouten:[] })`.
    - **Echt:**
      1. token plus org (zelfde gedupliceerd patroon als `confirm-afspraak.js`);
      2. GET ticket, 404 als het niet bestaat;
      3. ontvangers plus ontdubbeling exact zoals `propose.js`;
      4. als `mailKlant`: `sendReply` per ontvanger met foutafhandeling per ontvanger (fouten verzameld);
      5. PATCH `{status:'Wachten op planning', cf:{cf_interventie_datm:''}}` (niet-ok geeft 502, geen registerwijziging);
      6. interne notitie (alleen loggen bij een fout);
      7. `wisVoorstel`;
      8. antwoord `{ok:true, emailSent, fouten}`.
    - `tijdslot` voor mail en notitie komt uit `leesRegister` (`status[ticketId].tijdslot` als `tijdslotDatum` gelijk is aan de datum); anders het uur uit `cf_interventie_datm` in Brussel.
    - Is er geen `cf_interventie_datm` en geen tijdslot, dan zegt de mail "(tijdstip nog te bevestigen)". Mailen blijft toegestaan.

- [ ] **Step 1: Tests (`tests/annulatie.test.mjs`):**
  - `valideerAnnulatie`:
    - ok-geval;
    - `andere` zonder toelichting → fout;
    - toelichting van 1001 tekens → fout;
    - onbekende reden → fout;
    - `ticketId:'12a'` → fout.
  - `bouwAnnulatieMail`:
    - bevat de klantzin van `onderdelen`;
    - bevat de toelichting bij `andere`;
    - bevat de toelichting **niet** bij `weer`;
    - `<script>` in de naam wordt geëscaped;
    - de datum `2026-10-14` geeft "woensdag 14 oktober 2026".
  - `bouwAnnulatieNotitie` met en zonder `door`.
  - **Endpoint in testmodus:** stub `globalThis.fetch` die gooit bij elke aanroep. Import `annuleer.js` default. `new Request('http://x/api/annuleer?test', { method:'POST', headers:{'X-Blitz-Test':'1'}, body })` en mock `@netlify/blobs` niet. Kan de handler de store niet mocken zonder dependency-injectie, dan exporteert `annuleer.js` ook `maakHandler({ getStore, fetch })` en is `default = maakHandler({ getStore, fetch: globalThis.fetch })`. De test gebruikt een nep-store. Verwacht: status 200, `test:true`, nul fetch-aanroepen, entry gewist.
  - **Endpoint echt, met `mailKlant:false`** (nep-fetch die token, org, ticket en PATCH beantwoordt): geen `sendReply`-URL in de aanroepen, wel een PATCH met `Wachten op planning` en een notitie, en de entry gewist.
  - **Endpoint echt, met een PATCH-fout (500):** antwoord 502, entry **niet** gewist.
- [ ] **Step 2:** `node --test tests/annulatie.test.mjs`. Verwacht: FAIL.
- [ ] **Step 3:** `netlify/lib/annulatie.js` en `netlify/functions/annuleer.js` implementeren volgens de Interfaces.
- [ ] **Step 4:** `node --test tests/` plus `node --check` op beide. Verwacht: PASS.
- [ ] **Step 5: Commit:** `feat(annuleer): endpoint met reden, optionele klantmail, Zoho-notitie en register wissen`

### Task 5: Annuleervenster in de planner (model: sonnet)

**Files:**
- Modify: `public/index.html`: `openDetail` (±5438) voor de knop; `bevestigUitplannen` (±1627) voor de omleiding; nieuw venster-HTML naast de bestaande overlays; nieuwe functies `heeftLopendVoorstel`, `openAnnuleerVenster` en `verstuurAnnulatie`.
- Modify: `public/css/app.css` (annuleervenster, alleen tokens en bestaande klassen)

**Interfaces:**
- Consumes: `GET /api/annuleer`, `POST /api/annuleer` met `voorbeeld` en echt (Taak 4); `loadVoorstelStatus()`, `sluitDetailStil()`, `appConfirm`, `venster.js`.
- Produces:
  - `heeftLopendVoorstel(ticket) -> boolean`: `voorstelStatus[id]` heeft contact, klant, installateur of bevestigd, **of** de status is 'Wachten op bevestiging planning', 'Geplande service' of 'Geplande support'.
  - `openAnnuleerVenster(ticketId, date, { mailStandaard = true } = {})`.

- [ ] **Step 1: Knop in het detail.** In `openDetail` komt `<button class="btn btn--danger coord-only" …>Afspraak annuleren</button>` wanneer `heeftLopendVoorstel(t)`. "✕ Verwijder uit planning" blijft voor de overige tickets.
- [ ] **Step 2: Omleiding bij uitplannen.** `bevestigUitplannen(ticketId, date)`: als `heeftLopendVoorstel(t)`, dan `appConfirm`:
  - titel: `Ticket #${nr}: afspraak annuleren?`;
  - tekst letterlijk uit spec §3.1;
  - `bevestigLabel: 'Afspraak annuleren'`, `annuleerLabel: 'Terug'`, `gevaar: true`.
  - Bij ja: `openAnnuleerVenster(ticketId, date)` en `return false` (er is nog niets uitgepland). Anders blijft het bestaande gedrag.
- [ ] **Step 3: Venster** (`id="annuleer-overlay"`, `role="dialog"`, `aria-labelledby`), in de volgorde van spec §3.2 punt 1–6:
  - de redenen haalt het venster één keer op via `GET /api/annuleer` en bewaart ze in cache;
  - ontvangers en ontdubbeling uit `ticket.email`/`ticket.emailEindklant`/`ticket.emailInstallateur`;
  - zonder adres: "Ja" uitgeschakeld en "Geen mailadres bekend";
  - hint "Komt niet in de mail aan de klant" onder het tekstvak, verborgen bij `andere`;
  - voorbeeld ingeklapt (`<details>`), bij openen en bij elke wijziging (300 ms debounce) opgehaald via `POST {voorbeeld:true,…}` en getoond in een `iframe` met `sandbox=""` en `srcdoc`;
  - de verzendknop is uitgeschakeld tot de validatie klopt.
- [ ] **Step 4: Versturen** (`verstuurAnnulatie`):
  - knop uitgeschakeld met tekst "Bezig…";
  - Escape en de achtergrondklik doen niets zolang het verzoek loopt;
  - `door` = de persoon die op het toestel gekozen is (dezelfde bron als de persoonskiezer/`window.apparaat`; leeg als er niemand gekozen is);
  - POST naar `/api/annuleer`;
  - **Bij succes:**
    - `delete voorstelStatus[ticketId]`;
    - ticket lokaal uit `planning[date]` halen en terugzetten naar de wachtrij, zoals `removeTicketFromDate` dat doet, maar **zonder** een tweede `/api/plan`-call;
    - status `'Wachten op planning'`, `interventieDatum = null`;
    - `loadVoorstelStatus()`, `sluitDetailStil()`, venster dicht;
    - hertekenen: tickets, kalender, gepland en route;
    - toast `Afspraak geannuleerd — klant verwittigd per mail` of `— klant niet gemaild`;
    - bij `fouten.length`: toast (7 s) `Afspraak geannuleerd, maar de mail naar ${doelgroep} kon niet verstuurd worden. Verwittig de klant zelf.`
  - **Bij fout:** het venster blijft open met de ingevulde waarden, de knop wordt weer actief, en een toast met de fout.
  - Ook in TEST_MODE gaat de call naar het endpoint (de testheader zorgt voor de beveiliging).
- [ ] **Step 5: CSS.** Het venster volgt het bestaande modal-patroon (`.mhdr`, sluitknop binnen de kop). Keuzerondjes en velden ≥ 16 px tekst en ≥ 44 px bij aanraken. Het iframe-voorbeeld is max. 320 px hoog en scrollt.
- [ ] **Step 6: Verificatie** op `http://127.0.0.1:3333/?test` (eigen tab, service worker uitgeschreven en caches gewist), op 1440, 768 en 375 met aanraken, in beide thema's. Ruwe uitvoer:
  - knop zichtbaar voor een coördinator bij testticket `p1` (Wachten op bevestiging), onzichtbaar als technieker en bij een ticket zonder voorstel;
  - "Andere" zonder tekst houdt de knop uit;
  - het voorbeeld verandert met de reden;
  - de toelichting staat niet in het voorbeeld bij "Weersomstandigheden";
  - × op kaart of routestop van `p1` opent eerst de vraag, dan het venster;
  - Escape sluit zonder actie, Tab blijft binnen het venster;
  - na annuleren: geen 🔒 en geen "Voorstel verstuurd" meer, het ticket staat in de Wachtrij, toast zichtbaar;
  - een snelle dubbele klik geeft precies één POST (`read_network_requests`);
  - de devserver-log toont nul Zoho-requests;
  - screenshots van het venster op 375 en 1440.
- [ ] **Step 7: Commit:** `feat(planner): afspraak annuleren met reden, mailvoorbeeld en omleiding bij uitplannen`

### Task 6: "Bevestigd door …" tonen (model: haiku)

**Files:**
- Modify: `public/index.html`: routestop rond 4424, ticketdetail en `isStopLocked` (±4116).
- Modify: `public/css/app.css`.

**Interfaces:**
- Consumes: `voorstelStatus[id].bevestigd = { door: 'contact'|'klant'|'installateur'|null, tijdstip }` (Taak 3).
- Produces: `bevestigdLabel(vs) -> string|null`:
  - met `door`: `✓ Bevestigd door ${{contact:'contactpersoon', klant:'klant', installateur:'installateur'}[door]}`;
  - zonder `door`: `✓ Bevestigd`;
  - zonder `bevestigd`: null.

- [ ] **Step 1:** `isStopLocked` telt `vs?.bevestigd` ook als vergrendeld.
- [ ] **Step 2:** Waar nu "✉️ Voorstel verstuurd" staat (routestop), en in het detail: als `bevestigdLabel` een waarde geeft, wordt dat label getoond, met `title` = datum en uur van `tijdstip` in `nl-BE`, en de tooltip "Via welke mail bevestigd werd, niet wie er fysiek op drukte". Anders blijft het bestaande label.
  - Stijl: groen vlakje met `--on-accent`-tekst of `--accent-ink`, zoals bij de andere statuslabels. Geen nieuwe kleur.
- [ ] **Step 3: Verificatie** in `?test`: zet via `javascript_tool` `voorstelStatus[<id>] = { klant: '…', bevestigd: { door: 'installateur', tijdstip: new Date().toISOString() } }`, render opnieuw en maak een screenshot van routestop en detail in beide thema's. Dit is enkel een lokale variabele, er wordt niets opgeslagen.
- [ ] **Step 4: Commit:** `feat(planner): toon via welke ontvanger een afspraak bevestigd werd`

### Task 7: Release v1.10.0 (hoofdsessie)
- [ ] Eindreview van de volledige branch door **opus**. Gevonden punten gaan via een fixronde (sonnet).
- [ ] `package.json` en `package-lock.json` → `1.10.0`.
- [ ] `CACHE_NAME` in `public/sw.js` + 1.
- [ ] `CHANGELOG.md`:
  - **Added:** annuleren, bevestiging per ontvanger;
  - **Fixed:** blijvende 🔒/"Voorstel verstuurd" na annuleren of opnieuw plannen, oude link bevestigt nieuw voorstel, tweede doelgroep ging verloren bij een gelijktijdige registratie.
- [ ] Commit `chore: v1.10.0 — afspraak annuleren en bevestiging per ontvanger`, merge naar main lokaal en tag `v1.10.0`. **Push pas na Brents "ja".** Daarna de live cacheversie controleren.
- [ ] Brent test na de release één echte annulatie en één echte bevestiging op een eigen testticket.
