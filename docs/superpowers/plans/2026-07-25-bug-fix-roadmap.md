# Blitz Planning — Bug-Fix Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Geen testframework in dit project.** Verificatiestappen gebruiken daarom de bestaande projectconventie: `node dev-server.mjs` (poort 3333) + curl/browser voor backend-functies, en de browser (`?test`-modus, `getComputedStyle`, console) voor de frontend — zie CLAUDE.md/ONBOARDING.md. Waar een fix een Zoho-call raakt die niet zonder gevolgen te herhalen is, wordt live getest tegen testticket **#3731** (intern ID `157486000011122009`).

**Goal:** Alle openstaande bevindingen uit `docs/reviews/bug-audit-2026-07-25.md` gestructureerd oplossen — van internet-exploiteerbare security-gaten tot facturatie-foutjes in het rapport — in een volgorde die op lange termijn het minste totale werk en het laagste regressierisico oplevert.

**Architecture:** Geen architecturale wijziging aan de app zelf (single-file PWA + losse Netlify Functions blijft de conventie). Wel één infrastructurele voorbereidende stap (Task 1: v2-functions lokaal draaibaar maken) omdat die alle latere taken sneller en veiliger verifieerbaar maakt.

**Tech Stack:** Vanilla JS/HTML/CSS (`public/index.html`), Node.js ES-module Netlify Functions (`netlify/functions/*.js`), Netlify Blobs, Zoho Desk EU API, TomTom API, puppeteer-core + `@sparticuz/chromium-min`.

## Global Constraints

- Nooit naar `origin/main` pushen zonder Brents expliciete bevestiging per keer (staande afspraak, zie ONBOARDING.md). Lokaal committen/mergen mag zonder te vragen.
- Geen externe CSS/JS-frameworks toevoegen; alles blijft inline in `index.html`.
- Volg de bestaande conventie van kleine, per-bestand gedupliceerde helpers in `netlify/functions/*.js` (bv. `getAccessToken()` komt al 6× voor) — geen gedeelde module introduceren, dat is een grotere architecturale stap die hier niet aan de orde is.
- Elke taak die Zoho raakt: live-testen tegen ticket **#3731**, nooit tegen een echt klantticket.
- Geen enkele taak in dit plan voegt een login/auth-systeem toe aan de app zelf — waar een bevinding dat écht vereist (zie Task 8) wordt dat expliciet als *beslispunt voor Brent* gemarkeerd, niet als stilzwijgende aanname.
- Gebruik git-worktrees voor isolatie tijdens uitvoering (bestaande conventie, zie ONBOARDING.md) — vergeet niet lokale, nog niet gepushte commits op `main` mee te cherry-picken bij het aanmaken van de worktree.

---

## Waarom deze volgorde afwijkt van het audit-rapport

Het audit-rapport (`docs/reviews/bug-audit-2026-07-25.md`) somt bevindingen op naar *ernst per bevinding*. Dit plan herschikt ze naar *efficiëntie op de lange termijn* — zelfde bevindingen, andere volgorde, om drie redenen:

1. **Eén infrastructurele blokkade eerst oplossen (Task 1).** Zeven van de geplande fixes raken een Netlify Functions v2-bestand (`prijzen.js`, `rapport-archief.js`, `fotos.js`, `afspraken.js`, `availability.js`, `klantbeschikbaarheid.js`, `plan-datum.js`) — en die draaien vandaag **niet** lokaal via `dev-server.mjs`. Zonder die ene fix zou elke volgende taak op een v2-bestand alleen op een live Netlify-deploy te verifiëren zijn: trager, risicovoller, en moeilijker te herhalen. Eén kleine, veilige uitbreiding van `dev-server.mjs` maakt alle latere taken sneller én veiliger te testen.
2. **Quick wins vóór grote taken, ongeacht hun oorspronkelijke prioriteitslabel.** `showToast` bestaat nergens (crasht *nu al* elke keer dat iemand een prijs opslaat) en de `prijzen.js`-versiebug is een 1-regelfix. Beide kosten minuten, hebben nul regressierisico, en hoeven niet te wachten op de grotere security-taken.
3. **Bevindingen die dezelfde grondoorzaak delen worden samen als één taak gefixt**, in plaats van bestand per bestand zoals de originele lijst het toevallig aantrof. Voorbeelden: alle vijf plekken met een ongevalideerde `ticketId` in een Zoho-URL (Task 7); alle ontbrekende `escHtml()`-aanroepen op Zoho-ticketvelden (Task 11); de twee route-leg-index-bugs die in dezelfde functie-familie zitten (Task 13). Dit voorkomt dat dezelfde code drie keer apart wordt heropend.

De oorspronkelijke "beveiliging eerst"-volgorde blijft grotendeels overeind (Fase 2 staat nog steeds vóór de correctness-bugs) — wat verschuift is vooral *waar quick wins zitten* en *welke bevindingen samen horen*.

**Beslispunt dat dit plan bewust NIET zelf beslist:** de app heeft nergens een login. Een "echte" auth-laag voor `rapport.js`/`propose.js` (Task 8) is met een publieke SPA zonder sessiesysteem niet zinvol te bouwen (een geheim in de frontend-JS is voor iedereen zichtbaar via "Bekijk broncode"). Task 8 kiest daarom gerichte, code-only mitigaties die het echte risico (SSRF, willekeurige phishingmail) wegnemen zonder een auth-systeem te verzinnen. Volledige afsluiting van deze endpoints voor de buitenwereld vereist een infrastructuurbeslissing (Netlify-wachtwoordbeveiliging voor de hele site, of een echt login-systeem) — dat is een aparte beslissing voor Brent, geen onderdeel van dit plan.

---

# FASE 0 — Fundament

### Task 1: `dev-server.mjs` laten werken met Netlify Functions v2

**Files:**
- Modify: `dev-server.mjs:50-71` (functie `callFunction`)

**Interfaces:**
- Consumes: bestaand `event`-object-formaat voor classic handlers (ongewijzigd)
- Produces: dezelfde `{ statusCode, headers, body }`-vorm voor **beide** functiestijlen, zodat de rest van `dev-server.mjs` niets hoeft te weten van het verschil

- [ ] **Step 1: Reproduceer het probleem**

  Start de dev-server en roep een v2-endpoint aan:
  ```bash
  node dev-server.mjs &
  curl -s -X GET "http://localhost:3333/api/prijzen"
  ```
  Verwacht: een 500 met `TypeError: mod.handler is not a function` (of vergelijkbaar) — `prijzen.js` exporteert `export default`, geen `handler`.

- [ ] **Step 2: Pas `callFunction` aan om beide stijlen te ondersteunen**

  Vervang in `dev-server.mjs`:
  ```js
  async function callFunction(fnName, req, body) {
    const fnPath = path.join(__dirname, 'netlify', 'functions', `${fnName}.js`);
    if (!fs.existsSync(fnPath)) return { statusCode: 404, body: JSON.stringify({ error: `Functie niet gevonden: ${fnName}` }) };

    // Cache-bust op basis van bestandswijzigingstijd zodat code-wijzigingen
    // direct worden opgepikt zonder server-herstart.
    const mtime = fs.statSync(fnPath).mtimeMs;
    const mod = await import(url.pathToFileURL(fnPath).href + `?t=${mtime}`);

    const parsedUrl  = new URL(req.url, 'http://localhost');
    const queryStringParameters = Object.fromEntries(parsedUrl.searchParams.entries());

    const event = {
      httpMethod:            req.method,
      path:                  parsedUrl.pathname,
      headers:               req.headers,
      queryStringParameters,
      body:                  body || null,
    };

    return mod.handler(event);
  }
  ```
  door:
  ```js
  async function callFunction(fnName, req, body) {
    const fnPath = path.join(__dirname, 'netlify', 'functions', `${fnName}.js`);
    if (!fs.existsSync(fnPath)) return { statusCode: 404, body: JSON.stringify({ error: `Functie niet gevonden: ${fnName}` }) };

    // Cache-bust op basis van bestandswijzigingstijd zodat code-wijzigingen
    // direct worden opgepikt zonder server-herstart.
    const mtime = fs.statSync(fnPath).mtimeMs;
    const mod = await import(url.pathToFileURL(fnPath).href + `?t=${mtime}`);

    const parsedUrl  = new URL(req.url, 'http://localhost');
    const queryStringParameters = Object.fromEntries(parsedUrl.searchParams.entries());

    // Classic-stijl: export async function handler(event) { ... }
    if (typeof mod.handler === 'function') {
      const event = {
        httpMethod:            req.method,
        path:                  parsedUrl.pathname,
        headers:               req.headers,
        queryStringParameters,
        body:                  body || null,
      };
      return mod.handler(event);
    }

    // Netlify Functions v2-stijl: export default async (req) => new Response(...)
    if (typeof mod.default === 'function') {
      const fetchHeaders = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v !== undefined) fetchHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v));
      }
      const init = { method: req.method, headers: fetchHeaders };
      if (body && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;
      const request  = new Request(`http://localhost${req.url}`, init);
      const response = await mod.default(request);
      const resBody    = await response.text();
      const resHeaders = {};
      response.headers.forEach((v, k) => { resHeaders[k] = v; });
      return { statusCode: response.status, headers: resHeaders, body: resBody };
    }

    return { statusCode: 500, body: JSON.stringify({ error: `${fnName}.js exporteert geen 'handler' en geen 'default'` }) };
  }
  ```

  Node 18+ (project-vereiste, zie o.a. `propose.js`-comment "Node 18+ heeft native FormData en Blob") heeft `Request`/`Response`/`Headers` als globals zonder import — geen extra dependency nodig.

- [ ] **Step 3: Verifieer dat classic én v2 nu allebei werken**

  ```bash
  # classic (moet blijven werken zoals voorheen)
  curl -s "http://localhost:3333/api/tickets" | head -c 200

  # v2 GET
  curl -s "http://localhost:3333/api/prijzen" | head -c 200

  # v2 PUT met een klein testpayload (versie 0 → verwacht 200 met versie 1, of 409 als er al data staat)
  curl -s -X PUT "http://localhost:3333/api/prijzen" \
    -H "Content-Type: application/json" \
    -d '{"versie":0,"onderdelen":[],"tarieven":[]}'
  ```
  Verwacht: alle drie geven een JSON-response terug (geen `TypeError`, geen crash van de dev-server-thread).

- [ ] **Step 4: Startup-log bijwerken**

  In hetzelfde bestand, in het `server.listen(...)`-blok, is er al een regel die `debug-ticket` adverteert — die verdwijnt sowieso in Task 6. Laat die voorlopig staan; Task 6 ruimt hem op.

- [ ] **Step 5: Commit**

  ```bash
  git add dev-server.mjs
  git commit -m "fix: dev-server ondersteunt nu ook Netlify Functions v2-stijl lokaal"
  ```

---

# FASE 1 — Snelle, veilige fixes (minuten werk, geen regressierisico)

### Task 2: `showToast` bestaat nergens — prijsbeheer-opslaan crasht altijd

**Files:**
- Modify: `public/index.html:6323, 6343, 6357, 6359, 6371, 6374` (functie `prijsOpslaan`)

- [ ] **Step 1: Reproduceer**

  Open de app, ga naar Prijsbeheer, wijzig een prijs, klik "Opslaan". Open de devtools-console: `Uncaught ReferenceError: showToast is not defined`.

- [ ] **Step 2: Vervang alle 6 voorkomens van `showToast(` door `toast(`**

  Alleen `toast()` (gedefinieerd op regel 4652) bestaat in dit bestand. Vervang in `prijsOpslaan()`:
  ```js
  if (!PRIJZEN_DIRTY) { showToast('Geen wijzigingen'); return; }
  ...
  showToast('Prijzen opgeslagen (test)');
  ...
  showToast('⚠️ Conflict: prijslijst werd elders gewijzigd. Herlaad de pagina.');
  ...
  showToast('Fout: ' + (data.error || res.status));
  ...
  showToast('✓ Prijzen opgeslagen');
  ...
  showToast('Verbindingsfout: ' + err.message);
  ```
  door dezelfde 6 regels met `toast(` in plaats van `showToast(`.

- [ ] **Step 3: Verifieer**

  `node dev-server.mjs`, open `http://localhost:3333/?test`, ga naar Prijsbeheer, wijzig een prijs, klik Opslaan. Verwacht: groene toast "✓ Prijzen opgeslagen" (of "(test)" in test-mode), geen console-error, de editor toont de nieuwe waarde na het opslaan.

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: prijsbeheer-opslaan gebruikt toast() ipv niet-bestaande showToast()"
  ```

---

### Task 3: CORS-allowlist verwijst naar het verkeerde domein (+ subdomain-takeover-risico wegnemen)

**Files:**
- Modify: `netlify/functions/afspraken.js:9`
- Modify: `netlify/functions/availability.js:9`
- Modify: `netlify/functions/klantbeschikbaarheid.js:10`
- Modify: `netlify/functions/rapport-archief.js:9`
- Modify: `netlify/functions/prijzen.js:9`
- Modify: `netlify/functions/fotos.js:11`

- [ ] **Step 1: Reproduceer (optioneel, alleen zichtbaar bij cross-origin gebruik)**

  ```bash
  curl -s -X OPTIONS "http://localhost:3333/api/afspraken" -H "Origin: https://blitz-planning.netlify.app" -i | grep -i access-control-allow-origin
  ```
  Verwacht vóór de fix: `Access-Control-Allow-Origin: https://blitz-power.netlify.app` (het verkeerde, niet-geclaimd-bevestigde domein) in plaats van het echte origin.

- [ ] **Step 2: Vervang de verkeerde regel in alle 6 bestanden**

  In elk van de 6 bestanden staat exact deze regel in de `ALLOWED_ORIGINS`-array:
  ```js
  'https://blitz-power.netlify.app',
  ```
  Vervang die door:
  ```js
  'https://blitz-planning.netlify.app',
  ```
  In `afspraken.js`, `availability.js`, `klantbeschikbaarheid.js`, `rapport-archief.js` staat dit de énige domein-entry — na de fix bevat de array het juiste productiedomein + `localhost:8888`.
  In `prijzen.js` en `fotos.js` staat het echte domein al als tweede entry — na de fix verdwijnt het niet-geclaimde `blitz-power.netlify.app` daar simpelweg (geen dubbele entries meer nodig), en resulteert in dezelfde 2-regelige array als de andere vier.

- [ ] **Step 3: Verifieer**

  Herhaal de curl uit Step 1 voor alle 6 endpoints (via `dev-server.mjs`, ook al negeert die server zelf de CORS-headers niet strikt — de headers in de response zijn wat telt):
  ```bash
  for fn in afspraken availability klantbeschikbaarheid rapport-archief prijzen fotos; do
    echo "== $fn =="
    curl -s -X OPTIONS "http://localhost:3333/api/$fn" -H "Origin: https://blitz-planning.netlify.app" -i | grep -i access-control-allow-origin
  done
  ```
  Verwacht: elke regel toont `https://blitz-planning.netlify.app`.

- [ ] **Step 4: Commit**

  ```bash
  git add netlify/functions/afspraken.js netlify/functions/availability.js netlify/functions/klantbeschikbaarheid.js netlify/functions/rapport-archief.js netlify/functions/prijzen.js netlify/functions/fotos.js
  git commit -m "fix: CORS-allowlist wijst naar het echte blitz-planning.netlify.app-domein"
  ```

---

### Task 4: `prijzen.js` optimistic-locking is kapot

**Files:**
- Modify: `netlify/functions/prijzen.js:124-136`

- [ ] **Step 1: Reproduceer**

  ```bash
  # Twee "gelijktijdige" saves met dezelfde versie — de tweede hoort een 409 te krijgen, krijgt nu een 200
  curl -s -X PUT "http://localhost:3333/api/prijzen" -H "Content-Type: application/json" \
    -d '{"versie":1,"onderdelen":[{"id":"x","naam":"X","prijs":10}],"tarieven":[]}'
  curl -s -X PUT "http://localhost:3333/api/prijzen" -H "Content-Type: application/json" \
    -d '{"versie":1,"onderdelen":[{"id":"y","naam":"Y","prijs":20}],"tarieven":[]}'
  ```
  Verwacht (bug): beide geven 200, de tweede overschrijft de eerste stil in plaats van een 409 conflict te melden.

- [ ] **Step 2: Fix de conflict-check en de non-number-`versie`-afhandeling**

  Vervang:
  ```js
    try {
      const current = await store.get(BLOB_KEY, { type: 'json' });
      if (current && typeof body.versie === 'number' && body.versie < current.versie) {
        return new Response(JSON.stringify({
          error: 'Prijslijst werd ondertussen aangepast door iemand anders. Herlaad en probeer opnieuw.',
          serverVersie: current.versie,
        }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
      }
      // Backup van vorige versie (max 5 bewaard)
      if (current) await store.setJSON(`${BLOB_KEY}-backup-${current.versie}`, current);
    } catch { /* blob niet bereikbaar, ga door */ }

    const nieuweVersie = (typeof body.versie === 'number' ? body.versie : 0) + 1;
  ```
  door:
  ```js
    if (typeof body.versie !== 'number') {
      return new Response(JSON.stringify({ error: 'versie is verplicht en moet een getal zijn' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    let current;
    try {
      current = await store.get(BLOB_KEY, { type: 'json' });
    } catch {
      return new Response(JSON.stringify({ error: 'Prijslijst-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }), {
        status: 503, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    if (current && body.versie !== current.versie) {
      return new Response(JSON.stringify({
        error: 'Prijslijst werd ondertussen aangepast door iemand anders. Herlaad en probeer opnieuw.',
        serverVersie: current.versie,
      }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }
    // Backup van vorige versie (max 5 bewaard)
    if (current) {
      try { await store.setJSON(`${BLOB_KEY}-backup-${current.versie}`, current); } catch { /* backup is best-effort */ }
    }

    const nieuweVersie = (current?.versie ?? 0) + 1;
  ```

  Belangrijkste gedragswijziging: `!==` in plaats van `<` (gelijke versies botsen nu ook), een ontbrekende/niet-numerieke `versie` wordt een expliciete 400 in plaats van stilzwijgend `versie=0` aan te nemen, en een blob-leesfout stopt nu de save (503) in plaats van door te gaan zonder conflictcheck én zonder backup.

- [ ] **Step 3: Verifieer**

  Herhaal de curl's uit Step 1. Verwacht nu: eerste call → 200 met `versie:2`; tweede call (nog met `versie:1`) → **409** met `serverVersie:2`. Test ook: `{"versie":"1", ...}` (string ipv number) → **400**.

- [ ] **Step 4: Commit**

  ```bash
  git add netlify/functions/prijzen.js
  git commit -m "fix: prijzen.js optimistic-locking gebruikt !== ipv < en valideert versie strikt"
  ```

---

### Task 5: `rapport-archief.js` mist optimistic locking

**Files:**
- Modify: `netlify/functions/rapport-archief.js:47-95` (POST-handler)
- Modify: `netlify/functions/rapport-archief.js:103-125` (DELETE-handler, zelfde patroon)

**Interfaces:**
- Consumes: bestaand `EMPTY = { versie: 0, rapports: [] }`-formaat
- Produces: 409-response met `{ error, serverVersie }` bij versiemismatch — zelfde vorm als `afspraken.js`/`availability.js`/`klantbeschikbaarheid.js` al gebruiken, zodat de frontend (als die ooit op deze 409 gaat reageren) een consistente vorm ziet.

- [ ] **Step 1: Reproduceer**

  Twee gelijktijdige "rapport afsluiten"-acties zonder versie-conflictdetectie: de tweede write overschrijft de eerste zonder foutmelding. (Moeilijk 1-op-1 met curl te reproduceren zonder race — controleer in plaats daarvan gewoon dat er geen enkele versie-check in de code staat, zie Step 2 voor en na.)

- [ ] **Step 2: Voeg dezelfde locking toe als `afspraken.js` (regel 73) al gebruikt**

  De frontend (`archiveerRapport`, `index.html:5711-5740`) stuurt vandaag geen `versie` mee in de POST-body — dat moet ook aangepast worden zodat de client weet welke versie hij als basis had. Twee delen:

  **2a — server (`rapport-archief.js`), POST-handler.** Vervang:
  ```js
    let current = EMPTY;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch {}

    const entry = {
  ```
  door:
  ```js
    let current;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch {
      return new Response(JSON.stringify({ error: 'Rapportarchief tijdelijk niet bereikbaar, probeer opnieuw.' }), {
        status: 503, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    if (typeof body.versie === 'number' && body.versie !== current.versie) {
      return new Response(JSON.stringify({
        error: 'Rapportarchief werd ondertussen gewijzigd door iemand anders. Herlaad en probeer opnieuw.',
        serverVersie: current.versie,
      }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }

    const entry = {
  ```
  (De check is `typeof body.versie === 'number'` — niet verplicht zoals bij `prijzen.js` — omdat we de frontend-aanroep in dezelfde taak bijwerken maar bestaande, nog niet herladen tabbladen geen harde breking mogen geven tijdens de overgangsperiode van een deploy.)

  **2b — client (`index.html`), `archiveerRapport`.** Voeg een module-scoped `_archiefVersie`-variabele toe (naast de bestaande `_rapportArchief`-array bij `laadRapportArchief`), en stuur die mee:
  ```js
  // in laadRapportArchief(), na `_rapportArchief = data.rapports || [];`
  _archiefVersie = data.versie || 0;
  ```
  ```js
  // in archiveerRapport(), in de POST-body:
  body: JSON.stringify({
    versie:          _archiefVersie,
    datum:           R.datum,
    ...
  }),
  ```
  En verwerk een eventuele 409 (herlaad het archief en toon een toast in plaats van de fout stil te negeren):
  ```js
  async function archiveerRapport(html) {
    const totaal = /* zie Task 15 voor de gecorrigeerde berekening */;
    try {
      const res = await fetch('/api/rapport-archief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ versie: _archiefVersie, /* ...rest ongewijzigd... */ }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast('⚠️ Rapport niet gearchiveerd: ' + (data.error || res.status), 5000);
        return;
      }
    } catch (err) {
      toast('⚠️ Rapport archiveren mislukt (netwerkfout) — controleer het Rapporten-tabblad', 5000);
      console.warn('Rapport archiveren mislukt:', err);
    }
  }
  ```

  **2c — DELETE-handler**, zelfde soort check toevoegen vóór `const filtered = current.rapports.filter(...)` op regel 115, met dezelfde 409-vorm. `verwijderRapport()` in de frontend (`index.html:5849-5866`) kan de gebruiker bij een 409 vragen de pagina te herladen (`toast('⚠️ Archief gewijzigd — herlaad de pagina en probeer opnieuw', 5000)`).

- [ ] **Step 3: Verifieer**

  ```bash
  # eerste POST zonder versie (bestaand gedrag, moet nog werken)
  curl -s -X POST "http://localhost:3333/api/rapport-archief" -H "Content-Type: application/json" \
    -d '{"ticketId":"999","datum":"2026-07-25","technieker":"Test"}'
  # tweede POST met een opzettelijk verkeerde versie → verwacht 409
  curl -s -X POST "http://localhost:3333/api/rapport-archief" -H "Content-Type: application/json" \
    -d '{"versie":999,"ticketId":"998","datum":"2026-07-25","technieker":"Test"}'
  ```
  Daarna in de browser: open het Rapporten-tabblad, rond een test-rapport af op ticket #3731, controleer dat het rapport in de lijst verschijnt en er geen console-error is.

- [ ] **Step 4: Commit**

  ```bash
  git add netlify/functions/rapport-archief.js public/index.html
  git commit -m "fix: rapport-archief.js krijgt optimistic locking zoals de andere blob-endpoints"
  ```

---

# FASE 2 — Internet-exploiteerbare gaten dichten

### Task 6: De 4 onbeveiligde debug-endpoints verwijderen

**Files:**
- Delete: `netlify/functions/debug-agents.js`
- Delete: `netlify/functions/debug-list.js`
- Delete: `netlify/functions/debug-ticket.js`
- Delete: `netlify/functions/debug-zoho.js`
- Modify: `dev-server.mjs` (startup-log regel die `debug-ticket` adverteert)

Geen enkele van deze 4 wordt door de frontend aangeroepen (bevestigd tijdens de audit), en ze zijn stuk voor stuk onbeveiligd: `debug-zoho.js` PATCHt bij elke GET een hardcoded productieticket, `debug-ticket.js` heeft een path-traversal-bug die willekeurige Zoho Desk-endpoints blootlegt, `debug-agents.js`/`debug-list.js` lekken org-data. Verwijderen is veiliger dan patchen — er is geen legitiem gebruik om te behouden.

- [ ] **Step 1: Bevestig dat er geen frontend-referentie is**

  ```bash
  grep -rn "debug-agents\|debug-list\|debug-ticket\|debug-zoho" public/index.html
  ```
  Verwacht: geen output.

- [ ] **Step 2: Verwijder de 4 bestanden**

  ```bash
  git rm netlify/functions/debug-agents.js netlify/functions/debug-list.js netlify/functions/debug-ticket.js netlify/functions/debug-zoho.js
  ```

- [ ] **Step 3: Verwijder de adverterende startup-log-regel in `dev-server.mjs`**

  Vervang:
  ```js
  server.listen(PORT, () => {
    console.log(`\n🚀  Dev server draait op http://localhost:${PORT}`);
    console.log(`    Test mode:  http://localhost:${PORT}/?test`);
    console.log(`    Debug:      http://localhost:${PORT}/api/debug-ticket?id=TICKET_ID\n`);
  });
  ```
  door:
  ```js
  server.listen(PORT, () => {
    console.log(`\n🚀  Dev server draait op http://localhost:${PORT}`);
    console.log(`    Test mode:  http://localhost:${PORT}/?test\n`);
  });
  ```

- [ ] **Step 4: Verifieer**

  ```bash
  node dev-server.mjs &
  curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3333/api/debug-zoho"
  ```
  Verwacht: `404` (functie niet gevonden), en géén PATCH-call naar Zoho in de logs.

- [ ] **Step 5: Commit**

  ```bash
  git add -A
  git commit -m "fix: verwijder 4 onbeveiligde, ongebruikte debug-endpoints"
  ```

---

### Task 7: Path traversal via ongevalideerde `ticketId` in Zoho-URL's

**Files:**
- Modify: `netlify/functions/plan.js:42-45`
- Modify: `netlify/functions/plan-datum.js:42-47`
- Modify: `netlify/functions/comment.js:43-46`
- Modify: `netlify/functions/propose.js:164-169`
- Modify: `netlify/functions/rapport.js:61-64`

Zoho ticket-ID's zijn zuiver numeriek (bv. `157486000011122009`). `ticketId` wordt in alle 5 bestanden zonder formaatcontrole in het Zoho-URL-pad geplakt (`/tickets/${ticketId}`); `fetch` normaliseert `..`-segmenten, dus een `ticketId` als `../organizations` bereikt een ander Zoho-endpoint met het app-brede OAuth-token.

- [ ] **Step 1: Reproduceer (tegen de lokale dev-server, geen echte Zoho-call nodig om het patroon te zien)**

  ```bash
  curl -s -X POST "http://localhost:3333/api/plan" -H "Content-Type: application/json" \
    -d '{"ticketId":"../organizations","date":null}'
  ```
  Vóór de fix: de call gaat door naar Zoho (met een fout omdat `/organizations` geen PATCH ondersteunt, maar het bewijst dat het pad ongevalideerd doorgaat). Na de fix: een directe 400 vóór er ooit een Zoho-call gebeurt.

- [ ] **Step 2: Voeg in elk van de 5 bestanden dezelfde validatie toe, net na de bestaande `if (!ticketId)`-check**

  In `plan.js`, vervang:
  ```js
    const { ticketId, date, utcInterventieDatum } = JSON.parse(event.body || '{}');
    if (!ticketId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId verplicht' }) };
    }
  ```
  door:
  ```js
    const { ticketId, date, utcInterventieDatum } = JSON.parse(event.body || '{}');
    if (!ticketId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId verplicht' }) };
    }
    if (!/^\d+$/.test(String(ticketId))) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig ticketId' }) };
    }
  ```

  In `plan-datum.js`, vervang:
  ```js
    const { ticketId, utcInterventieDatum } = body;
    if (!ticketId || !utcInterventieDatum) {
      return new Response(JSON.stringify({ error: 'ticketId en utcInterventieDatum zijn verplicht' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  ```
  door:
  ```js
    const { ticketId, utcInterventieDatum } = body;
    if (!ticketId || !utcInterventieDatum) {
      return new Response(JSON.stringify({ error: 'ticketId en utcInterventieDatum zijn verplicht' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!/^\d+$/.test(String(ticketId))) {
      return new Response(JSON.stringify({ error: 'Ongeldig ticketId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  ```

  In `comment.js`, vervang:
  ```js
    const { ticketId, content } = JSON.parse(event.body || '{}');
    if (!ticketId || !content?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId and content required' }) };
    }
  ```
  door:
  ```js
    const { ticketId, content } = JSON.parse(event.body || '{}');
    if (!ticketId || !content?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId and content required' }) };
    }
    if (!/^\d+$/.test(String(ticketId))) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid ticketId' }) };
    }
  ```

  In `propose.js`, vervang:
  ```js
    const { ticketId, date, time, recipientEmail, recipientName, subject, serienummer, utcInterventieDatum } =
      JSON.parse(event.body || '{}');

    if (!ticketId || !date) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId en date zijn verplicht' }) };
    }
  ```
  door:
  ```js
    const { ticketId, date, time, recipientEmail, recipientName, subject, serienummer, utcInterventieDatum } =
      JSON.parse(event.body || '{}');

    if (!ticketId || !date) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'ticketId en date zijn verplicht' }) };
    }
    if (!/^\d+$/.test(String(ticketId))) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig ticketId' }) };
    }
  ```

  In `rapport.js`, vervang:
  ```js
    const { html, ticketId, filename = 'service-rapport.pdf' } = JSON.parse(event.body || '{}');
    if (!html || !ticketId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'html en ticketId zijn verplicht' }) };
    }
  ```
  door:
  ```js
    const { html, ticketId, filename = 'service-rapport.pdf' } = JSON.parse(event.body || '{}');
    if (!html || !ticketId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'html en ticketId zijn verplicht' }) };
    }
    if (!/^\d+$/.test(String(ticketId))) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig ticketId' }) };
    }
  ```

- [ ] **Step 3: Verifieer**

  ```bash
  for fn in plan plan-datum comment propose rapport; do
    echo "== $fn =="
    curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://localhost:3333/api/$fn" \
      -H "Content-Type: application/json" -d '{"ticketId":"../organizations","date":"2026-08-01","html":"<p>x</p>","content":"x"}'
  done
  ```
  Verwacht: alle vijf geven **400**. Test daarna één keer met een echt numeriek ticketId (bv. tegen #3731) om te bevestigen dat legitiem gebruik niet gebroken is.

- [ ] **Step 4: Commit**

  ```bash
  git add netlify/functions/plan.js netlify/functions/plan-datum.js netlify/functions/comment.js netlify/functions/propose.js netlify/functions/rapport.js
  git commit -m "fix: valideer ticketId als numerieke string vóór gebruik in Zoho-API-paden"
  ```

---

### Task 8: `rapport.js` SSRF-blast-radius wegnemen + `propose.js` als open mail-relay dichten

**Files:**
- Modify: `netlify/functions/rapport.js:74-76`
- Modify: `netlify/functions/propose.js` (nieuwe helper + validatie vóór het versturen van de mail)

**Beslispunt (niet iets wat dit plan zelf beslist):** beide endpoints blijven, net als de rest van de app, bereikbaar zonder login — dat vereist een aparte infrastructuurbeslissing (zie "Waarom deze volgorde afwijkt" hierboven). Deze taak neemt wél het **echte risico** weg dat achter elk endpoint zit, code-only:

**8a — `rapport.js`: sluit alle netwerktoegang vanuit de gerenderde pagina af.**
Het rapport is al volledig zelfvoorzienend (foto's zitten als base64 `data:`-URLs ingebed, zie `buildRapportHtml`) — de pagina heeft dus nooit legitiem netwerktoegang nodig. Door alle requests behalve `data:`/`about:blank` te blokkeren, verdwijnt het SSRF-scenario (metadata-endpoints uitlezen, interne poorten scannen, exfiltreren) volledig, ongeacht wie de HTML aanlevert.

- [ ] **Step 1: Reproduceer (lokaal, ongevaarlijk voorbeeld)**

  Roep `/api/rapport` aan met HTML die een externe fetch probeert (bv. naar `httpbin.org`, geen echt intern doelwit nodig om het principe te tonen):
  ```bash
  curl -s -X POST "http://localhost:3333/api/rapport" -H "Content-Type: application/json" \
    -d '{"ticketId":"157486000011122009","html":"<script>fetch(\"https://httpbin.org/get\").then(r=>r.text()).then(t=>document.title=t.slice(0,20))</script><p>test</p>"}'
  ```
  (Dit raakt ook meteen Zoho-uploadlogica — voer dit alleen uit tegen testticket #3731, of comment tijdelijk de upload-stap uit voor een pure lokale proef.)

- [ ] **Step 2: Blokkeer netwerkverkeer in de Puppeteer-pagina**

  Vervang in `rapport.js`:
  ```js
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
  ```
  door:
  ```js
    const page = await browser.newPage();
    // De rapport-HTML is volledig zelfvoorzienend (foto's als base64 data:-URLs) en
    // heeft dus nooit netwerktoegang nodig — alles behalve data:/about:blank blokkeren
    // sluit het SSRF-risico (interne endpoints/metadata uitlezen) volledig af.
    await page.setRequestInterception(true);
    page.on('request', req => {
      const reqUrl = req.url();
      if (reqUrl.startsWith('data:') || reqUrl.startsWith('about:blank')) {
        req.continue();
      } else {
        req.abort();
      }
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
  ```
  Let op: `waitUntil: 'networkidle0'` wacht op afgeronde netwerkrequests — met alles geblokkeerd zou dat nooit "idle" worden voor externe requests, dus die optie moet naar `'domcontentloaded'` (voldoende, want er is geen legitiem netwerkverkeer meer om op te wachten).

- [ ] **Step 3: Verifieer dat legitieme rapporten nog steeds correct renderen**

  Genereer een volledig testrapport (met foto's) op ticket #3731 via de UI, controleer dat de PDF er identiek uitziet aan vóór de wijziging (dit raakt de layout niet, enkel netwerktoegang).

  Verifieer daarnaast dat de blokkade werkt:
  ```bash
  curl -s -X POST "http://localhost:3333/api/rapport" -H "Content-Type: application/json" \
    -d '{"ticketId":"157486000011122009","html":"<script>window.__got = null; fetch(\"https://httpbin.org/get\").then(r=>window.__got=r.status).catch(e=>window.__got=\"blocked\")</script><p>test</p>"}'
  ```
  (De PDF zelf toont het resultaat niet direct, maar je kan tijdelijk `console.log(await page.evaluate(() => window.__got))` na `page.setContent` toevoegen tijdens het testen, en nadien weer weghalen — verwacht `"blocked"` of een hangende/mislukte fetch, nooit een echte 200.)

- [ ] **Step 4: Commit**

  ```bash
  git add netlify/functions/rapport.js
  git commit -m "fix: rapport.js blokkeert alle netwerktoegang in de gerenderde pagina (SSRF-mitigatie)"
  ```

**8b — `propose.js`: recipient-e-mail valideren tegen het echte Zoho-ticket + HTML-escapen van vrije velden.**
Vandaag accepteert de functie eender welk `recipientEmail`/`recipientName`/`subject` en stuurt dat, HTML-injectie incluis, vanaf het geverifieerde Blitz Power-supportadres. Door eerst het ticket bij Zoho op te vragen en te controleren dat `recipientEmail` overeenkomt met een van de op dat ticket geregistreerde adressen, kan de functie niet langer als generieke mailbom gebruikt worden — een aanvaller zou een bestaand ticket-ID mét het bijhorende, echte klantadres moeten kennen, en de mailinhoud blijft beperkt tot het vaste template.

- [ ] **Step 5: Reproduceer**

  ```bash
  curl -s -X POST "http://localhost:3333/api/propose" -H "Content-Type: application/json" \
    -d '{"ticketId":"157486000011122009","date":"2026-08-01","recipientEmail":"willekeurig@example.com","recipientName":"<img src=x onerror=alert(1)>","subject":"Test"}'
  ```
  Vóór de fix: mail wordt verstuurd naar `willekeurig@example.com`, ongeacht of dat iets met ticket #3731 te maken heeft, en `recipientName` gaat ongeëscaped de HTML-mail in.

- [ ] **Step 6: Voeg ticket-verificatie en escaping toe**

  Voeg een kleine escape-helper toe (dezelfde soort als `escHtml()` in de frontend, hier lokaal in dit bestand omdat elk functiebestand zijn eigen kleine helpers dupliceert):
  ```js
  function escHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  ```

  Vervang in `buildEmailHtml`:
  ```js
    return `<!DOCTYPE html>
  ...
      <p style="margin:0 0 16px;font-size:15px;color:#181e24">Geachte ${recipientName || 'klant'},</p>
      <p style="margin:0 0 24px;font-size:15px;color:#3a3a3a;line-height:1.65">
        Wij plannen een servicebezoek voor: <strong style="color:#181e24">${subject}</strong>.
      </p>
  ```
  door dezelfde tekst met `${escHtml(recipientName) || 'klant'}` en `${escHtml(subject)}` (en `${escHtml(serienummer)}` in de `serial`-variabele iets verderop in dezelfde functie).

  Voeg in de handler, vóór het versturen van de mail (na het orgId ophalen, vóór de `roundToNextQuarter`-regel), een ticket-check toe:
  ```js
    // Haal het ticket op en controleer dat recipientEmail bij dit ticket hoort —
    // voorkomt dat dit endpoint als open mail-relay naar een willekeurig adres misbruikt wordt.
    if (recipientEmail) {
      const ticketRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
      });
      const ticketData = await ticketRes.json().catch(() => ({}));
      if (!ticketRes.ok) {
        return {
          statusCode: 404, headers,
          body: JSON.stringify({ error: 'Ticket niet gevonden' }),
        };
      }
      const cf = ticketData.cf || {};
      const geldigeAdressen = [
        ticketData.email, ticketData.contact?.email, ticketData.contact?.emailId, cf.cf_e_mail_eindklant,
      ].filter(Boolean).map(e => e.toLowerCase());
      if (!geldigeAdressen.includes(String(recipientEmail).toLowerCase())) {
        return {
          statusCode: 400, headers,
          body: JSON.stringify({ error: 'recipientEmail komt niet overeen met een geregistreerd adres op dit ticket' }),
        };
      }
    }
  ```

- [ ] **Step 7: Verifieer**

  Tegen ticket #3731: haal eerst het echte contactadres op (via `/api/debug-ticket` is intussen verwijderd — gebruik in plaats daarvan de Zoho Desk UI, of tijdelijk `console.log(ticketData)` tijdens het testen). Roep `/api/propose` aan met (a) het echte adres → verwacht 200 + mail verstuurd, (b) een willekeurig ander adres → verwacht 400.

- [ ] **Step 8: Commit**

  ```bash
  git add netlify/functions/propose.js
  git commit -m "fix: propose.js valideert recipientEmail tegen het ticket en escaped vrije mailvelden"
  ```

---

### Task 9: `.env.local.example` schonen (code-kant) + rotatie als actiepunt voor Brent

**Files:**
- Modify: `.env.local.example`

- [ ] **Step 1: Vervang de echte waarden door placeholders**

  ```bash
  cat .env.local.example
  ```
  Vervang de huidige (live) `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `TOMTOM_API_KEY`-waarden door:
  ```
  ZOHO_CLIENT_ID=jouw-zoho-client-id-hier
  ZOHO_CLIENT_SECRET=jouw-zoho-client-secret-hier
  ZOHO_REFRESH_TOKEN=jouw-zoho-refresh-token-hier
  TOMTOM_API_KEY=jouw-tomtom-api-key-hier
  ```
  (exacte variabelenamen overnemen zoals ze nu in het bestand staan — enkel de waarden vervangen).

- [ ] **Step 2: Verifieer dat er geen echte waarde meer in staat**

  ```bash
  diff <(grep -E "ZOHO_CLIENT_ID|ZOHO_CLIENT_SECRET|TOMTOM_API_KEY" .env.local) \
       <(grep -E "ZOHO_CLIENT_ID|ZOHO_CLIENT_SECRET|TOMTOM_API_KEY" .env.local.example)
  ```
  Verwacht: verschil op alle 3 regels (voorheen: geen verschil = bug).

- [ ] **Step 3: Commit**

  ```bash
  git add .env.local.example
  git commit -m "fix: vervang live secrets in .env.local.example door placeholders"
  ```

- [ ] **Step 4 — HANDMATIG ACTIEPUNT VOOR BRENT, niet uit te voeren door dit plan:**
  1. In `api-console.zoho.eu`: het bestaande Self Client-record verwijderen/deactiveren en een nieuw Client ID + Secret genereren.
  2. Een nieuwe refresh token aanmaken via de Self Client-flow met scope `Desk.tickets.ALL,Desk.basic.ALL,Desk.settings.ALL` (zelfde procedure als eerder al eens gedaan, zie ONBOARDING.md).
  3. De 3 nieuwe waarden bijwerken in **Netlify → Site settings → Environment variables** én lokaal in `.env.local` (niet in `.env.local.example`).
  4. Nagaan of het oude Client Secret ooit ergens anders dan in git terecht is gekomen (bv. gedeeld in een chatbericht) — zo ja, ook daar laten weten dat het niet meer geldig is na rotatie.

---

# FASE 3 — XSS-sweep

### Task 10: Vrije-tekstvelden in `buildRapportHtml` escapen

**Files:**
- Modify: `public/index.html:5587, 5591, 5592, 5601, 5607, 5611, 5629` (functie `buildRapportHtml`)

- [ ] **Step 1: Reproduceer**

  Open een testrapport op ticket #3731. Vul bij "Ondernomen acties" iets in met een `<`, bv. `spanning < 230V gemeten, kabel vervangen`. Ga naar de preview (stap "Handtekening klant") of klik "🖨️ Afdrukken/PDF". Verwacht (bug): alles vanaf `< 230V` tot de eerstvolgende `>` in de rest van het document verdwijnt uit het gerenderde rapport.

- [ ] **Step 2: Escape de niet-geëscapete velden**

  In `buildRapportHtml`, vervang elk van deze regels (ze staan verspreid in de functie, zie de bestandscontext rond regel 5580-5630):
  ```js
  <div class="info-cell"><div class="info-lbl">Interventie adres</div><div class="info-val">${R.adres||'—'}</div></div>
  ```
  →
  ```js
  <div class="info-cell"><div class="info-lbl">Interventie adres</div><div class="info-val">${escHtml(R.adres)||'—'}</div></div>
  ```
  ```js
  <div class="info-cell"><div class="info-lbl">Installateur</div><div class="info-val">${R.installateur||'—'}</div></div>
  ```
  →
  ```js
  <div class="info-cell"><div class="info-lbl">Installateur</div><div class="info-val">${escHtml(R.installateur)||'—'}</div></div>
  ```
  ```js
  <div class="info-cell"><div class="info-lbl">Serienummer</div><div class="info-val">${R.serienummer||'—'}</div></div>
  ```
  →
  ```js
  <div class="info-cell"><div class="info-lbl">Serienummer</div><div class="info-val">${escHtml(R.serienummer)||'—'}</div></div>
  ```
  ```js
  <div class="block">${R.probleem||'&nbsp;'}</div>
  ```
  →
  ```js
  <div class="block">${escHtml(R.probleem)||'&nbsp;'}</div>
  ```
  ```js
  <div class="block">${R.acties||'&nbsp;'}</div>
  ```
  →
  ```js
  <div class="block">${escHtml(R.acties)||'&nbsp;'}</div>
  ```
  ```js
  ${R.varia ? `<div class="rapport-section"><div class="sec">Varia</div><div class="block">${R.varia}</div></div>` : ''}
  ```
  →
  ```js
  ${R.varia ? `<div class="rapport-section"><div class="sec">Varia</div><div class="block">${escHtml(R.varia)}</div></div>` : ''}
  ```

  (`R.technieker`, `zohoRef`, `datumStr`, `R.start`, `R.stop`, `R.werktijd`, `stLabel`, `facturatieLabel`, `productInfo` zijn ofwel intern gegenereerde waarden ofwel al eerder in de functie verwerkt — enkel de 6 bovenstaande directe vrije-tekstinvoervelden ontbreken `escHtml()`.)

- [ ] **Step 3: Verifieer**

  Herhaal Step 1: hetzelfde testrapport met `<` in "Ondernomen acties" moet nu de tekst tonen als `spanning &lt; 230V gemeten...` — zichtbaar als `<` in de PDF, niets verdwijnt.

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: buildRapportHtml escaped vrije-tekstvelden (adres/installateur/serienummer/probleem/acties/varia)"
  ```

---

### Task 11: `escHtml()`-sweep op Zoho-ticketvelden in `innerHTML`

**Files:**
- Modify: `public/index.html` — `renderTickets`, `showResult`, `renderGepland`, `renderRouteList`, `openDetail`, `updateProposalPreview`, `renderKalender` (zoek elke functie op via Grep, exacte regelnummers verschuiven licht na Taken 1-10)

Dit is één taak omdat het overal dezelfde mechanische fix is: waar een Zoho-ticketveld (`t.subject`, `t.address`, `t.account`, `t.naamEindklant`, `t.assignee`, `t.telefoonEindklant`, `ticket.subject`, `item.ticket.subject`, ...) rechtstreeks in een template-literal terechtkomt dat via `innerHTML` in de DOM gaat, ontbreekt `escHtml()`. Lokale afspraken (`localEvents`) gebruiken dit patroon al correct — dat is het te volgen voorbeeld.

- [ ] **Step 1: Vind alle resterende plekken**

  ```bash
  grep -n '\.innerHTML' public/index.html | grep -E '\bt\.(subject|address|account|naamEindklant|assignee|telefoonEindklant)\b|ticket\.subject|item\.ticket\.subject'
  ```
  Dit geeft de exacte, actuele regelnummers (verschuiven na eerdere taken in dit plan) voor: `renderTickets`, `showResult`, `renderGepland`, `renderRouteList`, `openDetail` (en zijn `row()`-helper), `updateProposalPreview`, `renderKalender`.

- [ ] **Step 2: Wrap elk gevonden veld in `escHtml(...)`**

  Voorbeeldpatroon (pas toe op elke match uit Step 1):
  ```js
  // vóór
  `<div class="tsub">${t.subject || '—'}</div>`
  // na
  `<div class="tsub">${escHtml(t.subject) || '—'}</div>`
  ```
  ```js
  // vóór (href-attribuut is extra gevoelig — attribuut-breakout via een dubbele quote)
  `<a href="tel:${t.telefoonEindklant}">...</a>`
  // na
  `<a href="tel:${escHtml(t.telefoonEindklant)}">...</a>`
  ```
  Doe dit voor elk veld in elke functie uit Step 1's greplijst. Laat interne/berekende waarden (bv. `stLabel`, geformatteerde datums, cijfers) met rust — die zijn niet extern beïnvloedbaar.

- [ ] **Step 3: Verifieer**

  In `?test`-modus: pas in `DUMMY_DATA` (regel 1647-1660) tijdelijk een `subject` aan naar `<img src=x onerror=alert(1)>` voor één test-ticket, herlaad de pagina met `?test`, en controleer in elk van de 7 aangepaste weergaves (wachtrij, kalender, gepland, routelijst, detailmodal, voorstel-preview, plan-resultaat na "⚡ Plan deze week") dat de tekst letterlijk als `<img src=x onerror=alert(1)>` zichtbaar is (geen popup, geen verdwenen tekst). Zet de `DUMMY_DATA`-wijziging nadien terug.

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: escHtml() consequent toegepast op Zoho-ticketvelden in innerHTML-renders"
  ```

---

### Task 12: `escHtml()` escaped geen apostrof + prijsbeheer-tags XSS + `navigate()`-injectie

**Files:**
- Modify: `public/index.html:1643-1645` (`escHtml`)
- Modify: `public/index.html` — prijsbeheer tag-rendering (zoek `class="prijs-tag"`)
- Modify: `public/index.html:2316, 3816, 3859` (of actuele regelnummers — zoek `navigate('${encodeURIComponent`)

**Interfaces:**
- Produces: `escHtml()` blijft dezelfde signatuur (`string → string`), enkel het escape-gedrag wordt strikter — alle 60+ bestaande aanroepen blijven werken, sommige worden er *veiliger* door (met name onclick-handlers die een geëscapete waarde tussen enkele quotes plaatsen).

- [ ] **Step 1: Reproduceer — apostrof breekt de Navigeer-knop**

  In `?test`-modus, geef een ticket een adres met een apostrof, bv. `Rue de l'Église 5, 1000 Brussel`. Klik "🧭 Navigeer" in de routelijst of detailmodal. Verwacht (bug): niets gebeurt, console toont een `SyntaxError` in de inline `onclick`.

- [ ] **Step 2: Escape apostrof in `escHtml()`**

  Vervang:
  ```js
  function escHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  ```
  door:
  ```js
  function escHtml(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  ```
  Dit lost meteen de prijsbeheer-tag-XSS op zodra Task 13 in de originele audit (tag-rendering, zie hieronder) ook effectief `escHtml()` gebruikt.

- [ ] **Step 3: Escape de prijsbeheer-tags (die vandaag helemaal geen `escHtml()` gebruiken)**

  ```bash
  grep -n 'class="prijs-tag"' public/index.html
  ```
  Vervang (patroon, exacte context opzoeken via de grep):
  ```js
  `<span class="prijs-tag">${t}...`
  ```
  door:
  ```js
  `<span class="prijs-tag">${escHtml(t)}...`
  ```

- [ ] **Step 4: Fix de `navigate()`-apostrof-bug door van inline `onclick` naar `addEventListener` te schakelen**

  `encodeURIComponent` codeert een apostrof niet (staat in de lijst "niet-gereserveerde tekens" samen met `!()*~-`), dus zelfs met Step 2's fix blijft het probleem bestaan zolang het adres rechtstreeks in een inline `onclick="navigate('...')"`-string-literal terechtkomt. De niet-inline variant (`addEventListener('click', () => navigate(encodeURIComponent(adres)))`, elders in het bestand al correct gebruikt) heeft dit probleem niet.

  Zoek de 3 inline-varianten:
  ```bash
  grep -n "onclick=\"[^\"]*navigate('" public/index.html
  ```
  Voor elk gevonden element: verwijder de inline `onclick="...navigate('${encodeURIComponent(adres)}')"`-tekst uit de template-literal, geef het element een stabiele `data-adres="${escHtml(adres)}"`-attribuut in plaats daarvan, en voeg na het inserten in de DOM een `addEventListener` toe:
  ```js
  // in de template-literal: vóór
  `<button onclick="event.stopPropagation();navigate('${encodeURIComponent(stop.address||'')}')">🧭 Navigeer</button>`
  // na
  `<button class="btn-navigeer" data-adres="${escHtml(stop.address||'')}">🧭 Navigeer</button>`
  ```
  En, na het toekennen van `container.innerHTML = ...` in dezelfde functie:
  ```js
  container.querySelectorAll('.btn-navigeer').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigate(encodeURIComponent(btn.dataset.adres));
    });
  });
  ```
  Herhaal dit patroon voor alle 3 gevonden plekken (elke plek rendert in een eigen functie — pas de `querySelectorAll`-aanroep aan de juiste containerscope van die functie aan, niet `document` globaal, om geen dubbele listeners op herhaalde renders te krijgen).

- [ ] **Step 5: Verifieer**

  Herhaal Step 1 met hetzelfde apostrof-adres: "🧭 Navigeer" opent nu correct Google Maps met het juiste adres, geen console-error. Test ook een tag met een apostrof in Prijsbeheer (bv. `L'origine`) — moet correct opslaan en tonen zonder de pagina te breken.

- [ ] **Step 6: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: escHtml() escaped apostrof, prijsbeheer-tags geëscaped, navigate() niet meer injecteerbaar via inline onclick"
  ```

---

# FASE 4 — Geld- en datacorrectheid

### Task 13: Route-leg-index off-by-one (rijtijd-label + aanrijtijd/facturatie)

**Files:**
- Modify: `public/index.html` — `renderRouteList` (rijtijd-chip tussen stops, rond regel 3786-3791)
- Modify: `public/index.html` — `openRapport` (aanrijtijd-berekening, rond regel 4744-4750)

Beide bugs hebben dezelfde grondoorzaak: `routeData.legs[i]` is de rit *naar* waypoint `i` (waypoint 0 = vertrekpunt), maar op twee plekken wordt de verkeerde index gebruikt.

- [ ] **Step 1: Reproduceer — rijtijd-chip**

  Bereken een route voor een dag met minstens 3 stops. In de routelijst staat tussen stop 1 en stop 2 een "🚗 X min · Y km"-chip. Vergelijk die met het verschil tussen de twee ⏱-aankomsttijden minus de interventieduur — ze komen niet overeen (de chip toont de rit *naar de vorige* stop).

- [ ] **Step 2: Fix de chip-index**

  Vervang in `renderRouteList`:
  ```js
    allStops.forEach((entry, i) => {
      if (i > 0 && hasRoute && routeData.legs[i-1]) {
        const leg = routeData.legs[i-1];
  ```
  door:
  ```js
    allStops.forEach((entry, i) => {
      if (i > 0 && hasRoute && routeData.legs[i]) {
        const leg = routeData.legs[i];
  ```
  (`legs[i]` is de rit van waypoint `i-1` náár waypoint `i` — waypoint 0 is het vertrekpunt, dus voor stoplijst-index `i` (0-based, entry i in `allStops` correspondeert met waypoint `i+1`)... **controleer dit exact tegen `netlify/functions/route.js` en de waypoint-opbouw in `calculateRoute` vóór je commit** — de audit-bevinding zegt expliciet `legs[i-1]` i.p.v. de juiste leg zonder één-op-één te bevestigen of dat exact `legs[i]` is of een andere offset; verifieer met een handmatige proef (Step 3) in plaats van blind te vertrouwen op deze suggestie.)

- [ ] **Step 3: Verifieer met een handmatige proef, niet enkel door te lezen**

  Plan 3 tickets met bekende, ver uit elkaar liggende adressen op één dag voor één technieker (zodat de rijtijden duidelijk verschillend en herkenbaar zijn). Bereken de route. Noteer voor elke stop de getoonde ⏱-aankomsttijd. Bereken zelf (interventieduur + reistijd tussen elk paar adressen, via bv. Google Maps als referentie) wat de chip *zou moeten* tonen tussen stop 1→2 en 2→3. Vergelijk met wat de UI na de fix toont. Pas de index (`i` vs `i-1` vs `i+1`) net zo lang aan tot de chips kloppen met de onafhankelijk berekende waarden.

- [ ] **Step 4: Fix dezelfde grondoorzaak in `openRapport`'s aanrijtijd-berekening**

  Vervang:
  ```js
    R.aanrijtijdMin = 0;
    if (routeData?.legs && currentRouteDate === date) {
      const dayStops = (planning[date] || []);
      const stopIdx  = dayStops.findIndex(p => p.ticket.id === ticketId);
      if (stopIdx >= 0 && routeData.legs[stopIdx]) {
        R.aanrijtijdMin = Math.round(routeData.legs[stopIdx].travelTimeSeconds / 60);
      }
    }
  ```
  door (gebruik de gefilterde lijst die ook echt de basis was van `routeData`, niet de ongefilterde `planning[date]` — zie ook Task 14 voor exact dezelfde ongefilterd-vs-gefilterd-verwarring elders):
  ```js
    R.aanrijtijdMin = 0;
    if (routeData?.legs && currentRouteDate === date) {
      const filterPerson = activeAssigneeFilter === 'all' ? null : activeAssigneeFilter;
      const dayStops = (planning[date] || []).filter(p => !filterPerson || p.ticket.assignee === filterPerson);
      const stopIdx  = dayStops.findIndex(p => p.ticket.id === ticketId);
      // stopIdx is 0-based binnen de gefilterde lijst die ook de waypoints van calculateRoute vormde;
      // waypoint 0 is het vertrekpunt, dus de leg náár deze stop is legs[stopIdx] (zelfde index-conventie
      // als hierboven in renderRouteList geverifieerd — gebruik dezelfde offset die daar bevestigd werd).
      if (stopIdx >= 0 && routeData.legs[stopIdx]) {
        R.aanrijtijdMin = Math.round(routeData.legs[stopIdx].travelTimeSeconds / 60);
      }
    }
  ```
  **Belangrijk:** gebruik exact dezelfde index-offset (`legs[stopIdx]` vs `legs[stopIdx-1]` etc.) die in Step 3 empirisch bevestigd is voor `renderRouteList` — beide plekken moeten dezelfde conventie gebruiken.

- [ ] **Step 5: Verifieer**

  Open het rapport voor een stop uit de Step 3-proef met een actief technieker-filter. Vergelijk `R.aanrijtijdMin` (zichtbaar in stap "Algemeen" van de wizard) met de onafhankelijk berekende reistijd naar die stop.

- [ ] **Step 6: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: route-leg-index klopt nu voor rijtijd-chip en rapport-aanrijtijd (was off-by-one/ongefilterd)"
  ```

---

### Task 13b: Aanrijtijd-fallback in `openRapport` vertrekt altijd vanaf het bureau, ook voor de 2e/3e stop van de dag

**Files:**
- Modify: `public/index.html:4751-4775` (`openRapport`, fallback-blok ná de `routeData.legs`-check uit Task 13)

**Context (feedback van Brent, niet in het oorspronkelijke audit-rapport):** wanneer er voor een dag nog geen route berekend is (`routeData` leeg of voor een andere datum), valt `openRapport` terug op een directe TomTom-aanvraag "bureau → dit adres" — voor élke stop van die dag afzonderlijk, ook de 2e/3e/... Dat maakt de gefactureerde aanrijtijd van elke stop na de eerste te hoog/onjuist: die klant wordt gefactureerd alsof de technieker speciaal van het bureau kwam, terwijl hij in werkelijkheid van de vorige klant kwam. **Dit raakt uitsluitend de rapport-facturatie** (`R.aanrijtijdMin` → `berekenLoonkost`) — de routeplanning/-optimalisatie bij het inplannen (`calculateRoute`, `autoPlan`, `optimizeRoute`) blijft ongewijzigd.

**Aanname die hier gemaakt wordt (bevestig bij Brent vóór uitvoering indien twijfel):** "vorige klant" = de stop bij dezelfde technieker op diezelfde dag met het eerstvolgende vroegere geplande tijdstip (`uur`-veld op elke `planning[date]`-entry). Dit is het enige beschikbare ordeningsgegeven wanneer er nog geen echte route berekend is; het is *niet* noodzakelijk dezelfde volgorde als een later berekende/geoptimaliseerde route zou opleveren (die kan geografisch herschikken) — voor facturatie is de geplande bezoekvolgorde het meest verdedigbare uitgangspunt.

- [ ] **Step 1: Reproduceer**

  Plan 2 tickets voor dezelfde technieker op dezelfde dag (bv. 09:00 en 11:00), zonder ooit "Bereken route" te klikken voor die dag. Open het rapport voor de 11:00-stop. Verwacht (bug): `R.aanrijtijdMin` (zichtbaar in wizard-stap "Algemeen") toont de reistijd bureau→11:00-adres, niet 09:00-adres→11:00-adres.

- [ ] **Step 2: Bepaal de vorige stop en gebruik die als origin in de fallback**

  Vervang in `openRapport`:
  ```js
    // Geen routeData beschikbaar maar adres en startlocatie zijn bekend → TomTom direct bevragen
    if (R.aanrijtijdMin === 0 && ticket.hasAddress && settings.startlocatie) {
      try {
        toast('📡 Aanrijtijd berekenen...', 5000);
        const gRes  = await fetch('/api/optimize', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ origin: settings.startlocatie, stops: [ticket.address] }),
        });
        const gData = await gRes.json();
        const origin = gData.locations?.[0];
        const dest   = gData.locations?.[1];
        if (origin && dest) {
          const rRes  = await fetch('/api/route', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ waypoints: [origin, dest] }),
          });
          const rData = await rRes.json();
          if (rData.legs?.[0]?.travelTimeSeconds) {
            R.aanrijtijdMin = Math.round(rData.legs[0].travelTimeSeconds / 60);
          }
        }
      } catch { /* niet fataal, aanrijtijd blijft 0 */ }
    }
  ```
  door:
  ```js
    // Geen routeData beschikbaar → TomTom direct bevragen, maar vertrek vanaf de vorige
    // stop van diezelfde dag/technieker (op basis van geplande tijd) indien die er is —
    // anders wordt elke stop na de eerste onterecht gefactureerd alsof de technieker apart
    // van het bureau vertrok. Enkel voor de rapport-facturatie; de routeplanning zelf
    // (calculateRoute/autoPlan/optimizeRoute) gebruikt deze functie niet en blijft ongewijzigd.
    if (R.aanrijtijdMin === 0 && ticket.hasAddress) {
      const sameDayOwnStops = (planning[date] || [])
        .filter(p => p.ticket.assignee === ticket.assignee && p.ticket.hasAddress)
        .sort((a, b) => (a.uur || '').localeCompare(b.uur || ''));
      const ownIdx   = sameDayOwnStops.findIndex(p => p.ticket.id === ticketId);
      const prevStop = ownIdx > 0 ? sameDayOwnStops[ownIdx - 1] : null;
      const aanrijOrigin = prevStop ? prevStop.address : settings.startlocatie;

      if (aanrijOrigin) {
        try {
          toast('📡 Aanrijtijd berekenen...', 5000);
          const gRes  = await fetch('/api/optimize', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ origin: aanrijOrigin, stops: [ticket.address] }),
          });
          const gData = await gRes.json();
          const origin = gData.locations?.[0];
          const dest   = gData.locations?.[1];
          if (origin && dest) {
            const rRes  = await fetch('/api/route', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ waypoints: [origin, dest] }),
            });
            const rData = await rRes.json();
            if (rData.legs?.[0]?.travelTimeSeconds) {
              R.aanrijtijdMin = Math.round(rData.legs[0].travelTimeSeconds / 60);
            }
          }
        } catch { /* niet fataal, aanrijtijd blijft 0 */ }
      }
    }
  ```

- [ ] **Step 3: Verifieer**

  Herhaal Step 1 na de fix: het rapport voor de 11:00-stop toont nu de reistijd 09:00-adres→11:00-adres. Test ook de 09:00-stop zelf (moet nog steeds bureau→09:00-adres tonen, want dat is écht de eerste stop) en een dag met slechts 1 stop (moet ongewijzigd bureau→adres blijven tonen).

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: rapport-aanrijtijd vertrekt vanaf de vorige klant ipv altijd vanaf het bureau"
  ```

---

### Task 14: Drag & drop in de routelijst herschikt de ongefilterde array

**Files:**
- Modify: `public/index.html:3829-3839` (drag/drop-handlers in `renderRouteList`)

- [ ] **Step 1: Reproduceer**

  Zorg voor een dag met 4 stops afwisselend tussen 2 technici (bv. Roel-A, Tim-B, Roel-C, Tim-D in `planning[date]`). Filter op "Tim" — de lijst toont enkel B en D. Sleep D vóór B. Verwacht (bug): de volgorde van Roel's stops in `planning[date]` verandert mee, zichtbaar door daarna de filter naar "Roel" of "Alle technici" te zetten en de kalender/route te herladen.

- [ ] **Step 2: Fix — splice op de gefilterde lijst zelf, herbouw daarna `planning[date]` in de juiste volgorde**

  Vervang:
  ```js
        stop.addEventListener('drop', e => {
          e.preventDefault(); stop.classList.remove('drag-over');
          const from = +e.dataTransfer.getData('text/plain');
          if (from !== i && from < stops.length && i < stops.length) {
            const arr = planning[date];
            arr.splice(i, 0, arr.splice(from, 1)[0]);
            routeData = null;
            renderRouteList(date);
            updateRouteBtns(date);
          }
        });
  ```
  door:
  ```js
        stop.addEventListener('drop', e => {
          e.preventDefault(); stop.classList.remove('drag-over');
          const from = +e.dataTransfer.getData('text/plain');
          if (from !== i && from < stops.length && i < stops.length) {
            // `stops` is de GEFILTERDE lijst (zie boven in renderRouteList) — splice die zelf,
            // en herschrijf dan planning[date] zodat enkel de volgorde van de eigen (gefilterde)
            // stops verandert; stops van andere technici blijven op hun eigen relatieve plek staan.
            const movedTicketIds = stops.map(s => s.ticket.id);
            const [movedId] = movedTicketIds.splice(from, 1);
            movedTicketIds.splice(i, 0, movedId);

            const arr = planning[date];
            const reordered = [];
            let ownIdx = 0;
            for (const entry of arr) {
              const isOwn = stops.some(s => s.ticket.id === entry.ticket.id);
              if (isOwn) {
                const targetId = movedTicketIds[ownIdx++];
                reordered.push(arr.find(a => a.ticket.id === targetId));
              } else {
                reordered.push(entry);
              }
            }
            planning[date] = reordered;

            routeData = null;
            renderRouteList(date);
            updateRouteBtns(date);
          }
        });
  ```

- [ ] **Step 3: Verifieer**

  Herhaal Step 1's scenario na de fix: sleep binnen Tim's gefilterde lijst, controleer daarna (filter op "Alle technici" of "Roel") dat Roel's stops in exact dezelfde volgorde staan als vóór het slepen, en dat Tim's stops wél in de nieuwe volgorde staan.

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: drag&drop in routelijst herschikt enkel de eigen (gefilterde) stops, niet planning[date] als geheel"
  ```

---

### Task 15: "Totaal onderdelen" unificeren (wizard-preview / rapport / archief)

**Files:**
- Modify: `public/index.html:5287-5294` (`_wizTotaalRij`)
- Modify: `public/index.html:5711-5715` (`archiveerRapport`)
- Modify: `public/index.html` — garantie-weergave in `renderRapportArchief` (rond regel 5812-5824)

Het rapport zelf (`buildRapportHtml`, regel 5504-5506) rekent al correct: enkel onderdelen met `factureren !== false` tellen mee. `_wizTotaalRij` (wizard-preview) en `archiveerRapport` (wat naar het archief geschreven wordt) tellen nog **alle** onderdelen, incl. niet-gefactureerde — dat maakt het getoonde totaal tijdens het invullen inconsistent met het uiteindelijke rapport, en vervuilt de opgeslagen `totaalOnderdelen` die de garantie-weergave in het archief gebruikt.

- [ ] **Step 1: Reproduceer**

  Voeg in de wizard-stap "Status & onderdelen" een onderdeel van €160 toe, vink "Factureren" uit. De wizard-preview toont "Totaal € 160,00". Ga verder naar het rapport zelf — dat toont "Totaal onderdelen € 0,00" (correct, want niet-gefactureerd). Rond het rapport af en bekijk het in het Rapporten-archief — de garantie-badge (indien van toepassing) gebruikt het opgeslagen bedrag, dat nog steeds €160 is.

- [ ] **Step 2: Fix `_wizTotaalRij`**

  Vervang:
  ```js
  function _wizTotaalRij() {
    const totaal = R.onderdelen.reduce((sum, p) => sum + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
    if (!R.onderdelen.length) return '';
    return `<div class="wiz-totaal-row">
      <span class="wiz-totaal-lbl">Totaal (excl. btw)</span>
      <span class="wiz-totaal-val">€ ${totaal.toFixed(2)}</span>
    </div>`;
  }
  ```
  door:
  ```js
  function _wizTotaalRij() {
    const billable = R.onderdelen.filter(p => p.factureren !== false);
    const totaal   = billable.reduce((sum, p) => sum + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
    if (!R.onderdelen.length) return '';
    const nietFactureerbaar = R.onderdelen.length - billable.length;
    return `<div class="wiz-totaal-row">
      <span class="wiz-totaal-lbl">Totaal factureerbaar (excl. btw)${nietFactureerbaar ? ` <span style="font-size:0.75em;color:var(--muted)">(${nietFactureerbaar} niet aangerekend)</span>` : ''}</span>
      <span class="wiz-totaal-val">€ ${totaal.toFixed(2)}</span>
    </div>`;
  }
  ```

- [ ] **Step 3: Fix `archiveerRapport`**

  Vervang:
  ```js
  async function archiveerRapport(html) {
    const totaal = R.onderdelen
      .filter(p => p.naam)
      .reduce((s, p) => s + (parseFloat(p.prijs) || 0) * (parseInt(p.aantal) || 1), 0);
  ```
  door:
  ```js
  async function archiveerRapport(html) {
    const totaal = R.onderdelen
      .filter(p => p.naam && p.factureren !== false)
      .reduce((s, p) => s + (parseFloat(p.prijs) || 0) * (parseInt(p.aantal) || 1), 0);
  ```
  (Zelfde filter als `buildRapportHtml`'s `billableOnderdelen`, regel 5505 — nu zijn alle drie plekken consistent.)

- [ ] **Step 4: Fix de garantie-weergave in `renderRapportArchief` — onderdelen blijven factureerbaar, enkel loon is 100% korting**

  Vervang (rond regel 5812-5818):
  ```js
    let prijsHtml = '';
    if (isGarantie && loonBruto > 0) {
      prijsHtml = `<span style="margin-left:auto;text-align:right;line-height:1.3">
        <span style="font-size:0.68rem;color:var(--muted);display:block">Niet factureerbaar</span>
        <span style="text-decoration:line-through;color:var(--muted);font-size:0.72rem">€ ${(loonBruto + (r.totaalOnderdelen||0)).toFixed(2)}</span>
        <span style="color:var(--muted);font-size:0.72rem;margin-left:4px">garantie</span>
      </span>`;
    } else if (!isGarantie && (totFactureerbaar > 0)) {
      prijsHtml = `<span style="margin-left:auto;text-align:right;line-height:1.3">
        <span style="font-size:0.68rem;color:var(--muted);display:block">Factureerbaar</span>
        <span style="font-size:0.85rem;font-weight:700;color:var(--accent)">€ ${totFactureerbaar.toFixed(2)}</span>
      </span>`;
    }
  ```
  door:
  ```js
    let prijsHtml = '';
    if (isGarantie) {
      // Bij garantie is enkel het loon 100% korting — onderdelen blijven factureerbaar
      // (zelfde regel als in buildRapportHtml, regel ~5667: "100% korting" geldt op de loonkosten-post, niet op onderdelen).
      const rows = [];
      if (loonBruto > 0) {
        rows.push(`<span style="font-size:0.68rem;color:var(--muted);display:block">Loon niet factureerbaar (garantie): <s>€ ${loonBruto.toFixed(2)}</s></span>`);
      }
      if (totOnderdelen > 0) {
        rows.push(`<span style="font-size:0.85rem;font-weight:700;color:var(--accent)">Onderdelen factureerbaar: € ${totOnderdelen.toFixed(2)}</span>`);
      }
      if (rows.length) {
        prijsHtml = `<span style="margin-left:auto;text-align:right;line-height:1.3">${rows.join('')}</span>`;
      }
    } else if (totFactureerbaar > 0) {
      prijsHtml = `<span style="margin-left:auto;text-align:right;line-height:1.3">
        <span style="font-size:0.68rem;color:var(--muted);display:block">Factureerbaar</span>
        <span style="font-size:0.85rem;font-weight:700;color:var(--accent)">€ ${totFactureerbaar.toFixed(2)}</span>
      </span>`;
    }
  ```
  (`totOnderdelen` en `loonBruto` zijn hierboven in dezelfde functie al correct berekend, regel 5798-5804 — enkel de weergave-tak voor garantie was fout.)

- [ ] **Step 5: Verifieer**

  Herhaal Step 1's scenario end-to-end: wizard-preview, rapport, én archief-kaart tonen nu alle drie €0 voor het niet-gefactureerde onderdeel. Test daarna een garantiegeval mét een wél-gefactureerd onderdeel (bv. een CHARX-3000-vervanging onder garantie): het archief moet nu tonen "Loon niet factureerbaar (garantie): ~~€175~~" + "Onderdelen factureerbaar: €442,13" in plaats van het hele bedrag als "niet factureerbaar".

- [ ] **Step 6: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: unificeer 'totaal onderdelen'-berekening (factureren-aware) in wizard/archief; garantie discount geldt enkel op loon"
  ```

---

### Task 16: Middernacht-overschrijdende werktijd berekent 0 minuten

**Files:**
- Modify: `public/index.html:4844-4861` (`calcWerktijd`, `calcWerktijdMin`)

- [ ] **Step 1: Reproduceer**

  Vul in de wizard-stap "Algemeen" Starttijd `23:00` en Stoptijd `01:30` in. Verwacht (bug): "Totale werktijd" toont niets/"—", en de loonkost-preview toont €0.

- [ ] **Step 2: Voeg een +24u-correctie toe bij een negatief verschil**

  Vervang:
  ```js
  function calcWerktijd(start, stop) {
    if (!start || !stop) return '';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = stop.split(':').map(Number);
    let totalMin = (eh * 60 + em) - (sh * 60 + sm);
    if (totalMin <= 0) return '';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m} min`;
    return m > 0 ? `${h}u${String(m).padStart(2,'0')}` : `${h}u`;
  }
  function calcWerktijdMin(start, stop) {
    if (!start || !stop) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = stop.split(':').map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    return diff > 0 ? diff : 0;
  }
  ```
  door:
  ```js
  function calcWerktijd(start, stop) {
    if (!start || !stop) return '';
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = stop.split(':').map(Number);
    let totalMin = (eh * 60 + em) - (sh * 60 + sm);
    if (totalMin < 0) totalMin += 24 * 60; // interventie loopt over middernacht heen
    if (totalMin <= 0) return '';
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m} min`;
    return m > 0 ? `${h}u${String(m).padStart(2,'0')}` : `${h}u`;
  }
  function calcWerktijdMin(start, stop) {
    if (!start || !stop) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = stop.split(':').map(Number);
    let diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff < 0) diff += 24 * 60; // interventie loopt over middernacht heen
    return diff > 0 ? diff : 0;
  }
  ```
  Let op: een écht ongeldige invoer (bv. start === stop, of een tikfout) geeft nu ook 0 min in plaats van (voorheen ook al) 0 min — dat gedrag verandert niet, enkel een *stop vóór start als gevolg van middernacht* wordt nu correct behandeld i.p.v. altijd als 0 geïnterpreteerd.

- [ ] **Step 3: Verifieer**

  Herhaal Step 1: `23:00` → `01:30` toont nu "2u30" en de loonkost-preview rekent op basis van 150 minuten. Test ook een normaal geval (`09:00` → `12:00`) om te bevestigen dat er geen regressie is.

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: werktijdberekening corrigeert voor interventies die middernacht overschrijden"
  ```

---

### Task 17: `R.interventieType` (en andere R-velden) niet gereset tussen wizard-sessies

**Files:**
- Modify: `public/index.html:4713-4780` (`openRapport`)

- [ ] **Step 1: Reproduceer**

  Maak 's ochtends een rapport voor ticket A, kies servicetype-onafhankelijk "Installatie" in stap Algemeen. Rond af. Open daarna een rapport voor ticket B (een gewone interventie) zonder de radio "Interventie/Installatie" aan te raken. Verwacht (bug): stap Algemeen toont nog "Installatie" aangevinkt, en de TicketLog-export voor ticket B krijgt kolom "Type" = "Installatie".

- [ ] **Step 2: Voeg de ontbrekende reset toe**

  Vervang in `openRapport`:
  ```js
    R.type = ''; R.uitvoering = ''; R.kabel = ''; R.kabellengte = '';
    R.hersteld = 'nee'; R.nieuwInter = 'nee';
    _sigTech = _sigKlant = null;
    _rapportUploaded = false; // reset guard bij nieuwe wizard-sessie
  ```
  door:
  ```js
    R.type = ''; R.uitvoering = ''; R.kabel = ''; R.kabellengte = '';
    R.hersteld = 'nee'; R.nieuwInter = 'nee';
    R.interventieType = 'Interventie'; // default; radio in stap Algemeen kan dit expliciet naar 'Installatie' zetten
    R.handtekeningTech = null; R.handtekeningKlant = null; // zie Task 23
    _sigTech = _sigKlant = null;
    _rapportUploaded = false; // reset guard bij nieuwe wizard-sessie
  ```

- [ ] **Step 3: Verifieer**

  Herhaal Step 1: ticket B's wizard start nu altijd op "Interventie" tenzij de gebruiker zelf "Installatie" kiest.

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: openRapport reset R.interventieType (en handtekeningvelden) bij een nieuwe wizard-sessie"
  ```

---

### Task 18: `roundToNextQuarter` produceert "24:00"/"09:NaN"

**Files:**
- Modify: `public/index.html` — `roundToNextQuarterStr` (rond regel 4309-4315)
- Modify: `netlify/functions/propose.js:71-76` (`roundToNextQuarter`, gedupliceerde logica)

- [ ] **Step 1: Reproduceer**

  Zet in het voorstel-scherm de tijd op `23:50`. Verwacht (bug): het voorgestelde tijdstip in de mail toont "om 24:00 uur" (ongeldige tijd).

- [ ] **Step 2: Fix beide kopieën met een uur-overloop-correctie**

  In `netlify/functions/propose.js`, vervang:
  ```js
  function roundToNextQuarter(timeStr) {
    const [h, m] = (timeStr || '09:00').split(':').map(Number);
    const raw = Math.ceil(m / 15) * 15;
    if (raw >= 60) return `${String(h + 1).padStart(2, '0')}:00`;
    return `${String(h).padStart(2, '0')}:${String(raw).padStart(2, '0')}`;
  }
  ```
  door:
  ```js
  function roundToNextQuarter(timeStr) {
    const [hRaw, mRaw] = (timeStr || '09:00').split(':').map(Number);
    const h = Number.isFinite(hRaw) ? hRaw : 9;
    const m = Number.isFinite(mRaw) ? mRaw : 0;
    const raw = Math.ceil(m / 15) * 15;
    const totalMin = (h * 60 + raw) % (24 * 60); // uur-overloop wrapt naar 00:xx i.p.v. "24:00"
    const outH = Math.floor(totalMin / 60);
    const outM = totalMin % 60;
    return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
  }
  ```
  Doe dezelfde aanpassing in `index.html`'s `roundToNextQuarterStr` (zoek de exacte huidige tekst op met Grep — functioneel identiek patroon, enkel de functienaam verschilt).

- [ ] **Step 3: Verifieer**

  Test `23:50` → verwacht `00:00` (i.p.v. `24:00`); test `9` (onvolledige/ongeldige invoer) → verwacht `09:00` (i.p.v. `09:NaN`); test een normaal geval `14:07` → verwacht `14:15` (ongewijzigd gedrag).

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html netlify/functions/propose.js
  git commit -m "fix: roundToNextQuarter wrapt correct rond middernacht en valt niet meer op ongeldige invoer"
  ```

---

### Task 19: `exportTicketLog` kolom "Bedrag EUR" inconsistent met kolom "Factureerbaar"

**Files:**
- Modify: `public/index.html:5916-5920` (`exportTicketLog`)

**Beslispunt voor Brent (kort te beantwoorden, dan verder te implementeren):** moet "Bedrag EUR" enkel de onderdelen tonen (huidige — inconsistente — bedoeling), of onderdelen + loonkost (wat de kolomnaam en het gebruik als facturatiebasis suggereren)? Deze taak lost in elk geval de **inconsistentie** met kolom "Factureerbaar" op (dat is onomstreden een bug); de vraag "moet loon erbij" is een scope-vraag die de taak in twee varianten hieronder aanbiedt.

- [ ] **Step 1: Reproduceer**

  Maak een testrapport waarbij alle onderdelen op "niet factureren" staan. Exporteer de TicketLog. Verwacht (bug): kolom "Factureerbaar" (O) = "Nee", kolom "Bedrag EUR" (P) toont toch het volledige onderdelenbedrag.

- [ ] **Step 2 (verplicht) — Fix de inconsistentie: "Bedrag EUR" filtert net als "Factureerbaar"**

  Vervang:
  ```js
    const rd         = r.rapportData || {};
    const onderdelen = (rd.onderdelen || []).filter(p => p.naam);
    const totaal     = onderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
    const fac        = onderdelen.some(p => p.factureren !== false) ? 'Ja' : 'Nee';
  ```
  door:
  ```js
    const rd                = r.rapportData || {};
    const onderdelen         = (rd.onderdelen || []).filter(p => p.naam);
    const billableOnderdelen = onderdelen.filter(p => p.factureren !== false);
    const totaal             = billableOnderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
    const fac                = billableOnderdelen.length > 0 ? 'Ja' : 'Nee';
  ```

- [ ] **Step 3 (optioneel, enkel na Brents antwoord op het beslispunt) — loonkost meetellen**

  Indien Brent bevestigt dat "Bedrag EUR" ook de loonkost moet omvatten:
  ```js
    const wMinExp = calcWerktijdMin(rd.start, rd.stop);
    const aMinExp = parseInt(rd.aanrijtijdMin) || 0;
    const { bruto: loonExp } = wMinExp > 0 ? berekenLoonkost(rd.servicetype || r.servicetype, wMinExp, aMinExp) : { bruto: 0 };
    const loonFactureerbaar = (rd.servicetype || r.servicetype) === 'garantie' ? 0 : loonExp;
    const totaalMetLoon = totaal + loonFactureerbaar;
  ```
  en gebruik `totaalMetLoon` in plaats van `totaal` in de returned rij (kolom P). Werk in dat geval ook de kolomnaam bij naar iets duidelijkers, bv. "Bedrag EUR (onderdelen + loon)".

- [ ] **Step 4: Verifieer**

  Herhaal Step 1: kolom O = "Nee" correspondeert nu met kolom P = leeg/0 voor hetzelfde rapport. Test ook een normaal gefactureerd rapport om te bevestigen dat het bedrag nog steeds correct verschijnt.

- [ ] **Step 5: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: exportTicketLog 'Bedrag EUR' is nu consistent met de 'Factureerbaar'-kolom"
  ```

---

# FASE 5 — Betrouwbaarheid (medium)

### Task 20: Belgische feestdagen ontbreken in `capacityForDay`/`nextAvailableDay`

**Files:**
- Modify: `public/index.html:3326-3354` (`capacityForDay`)
- Modify: `public/index.html:3356-3372` (`nextAvailableDay`)

- [ ] **Step 1: Reproduceer**

  Roep in de browserconsole `capacityForDay('2026-07-21')` op (Nationale Feestdag). Verwacht (bug): een positief getal (bv. `3`), terwijl de kalender diezelfde dag als "🔒 Geblokkeerd" toont.

- [ ] **Step 2: Fix — feestdag = 0 capaciteit, net als een volledige dagblokkering**

  Vervang in `capacityForDay`:
  ```js
  function capacityForDay(dateStr, travelMin = 30) {
    const [vanH, vanM] = settings.vanTijd.split(':').map(Number);
    const [totH, totM] = settings.totTijd.split(':').map(Number);
    const totalMin     = (totH * 60 + totM) - (vanH * 60 + vanM);
    const myPerson     = activeAssigneeFilter === 'all' ? null : activeAssigneeFilter;

    // Controleer volledige dagblokkering
    const dayBlocked = avExceptions.some(e =>
      e.date === dateStr && e.kind === 'fullday' &&
      (e.scope === 'global' || (myPerson && e.person === myPerson))
    );
    if (dayBlocked) return 0;
  ```
  door:
  ```js
  function capacityForDay(dateStr, travelMin = 30) {
    if (getHolidayName(dateStr)) return 0;

    const [vanH, vanM] = settings.vanTijd.split(':').map(Number);
    const [totH, totM] = settings.totTijd.split(':').map(Number);
    const totalMin     = (totH * 60 + totM) - (vanH * 60 + vanM);
    const myPerson     = activeAssigneeFilter === 'all' ? null : activeAssigneeFilter;

    // Controleer volledige dagblokkering
    const dayBlocked = avExceptions.some(e =>
      e.date === dateStr && e.kind === 'fullday' &&
      (e.scope === 'global' || (myPerson && e.person === myPerson))
    );
    if (dayBlocked) return 0;
  ```

- [ ] **Step 3: Fix `nextAvailableDay` zodat het geen feestdag meer voorstelt**

  ```bash
  grep -n -A15 "^function nextAvailableDay" public/index.html
  ```
  Zoek de lus die dagen doorloopt (rond regel 3359-3372) en voeg, naast de bestaande werkdagen/capaciteitscheck, een `if (getHolidayName(dStr)) continue;` (of gelijkaardig, aansluitend bij de bestaande lus-structuur) toe vóór de dag als kandidaat aanvaard wordt. Omdat `capacityForDay` na Step 2 al `0` teruggeeft op een feestdag, is dit mogelijk al voldoende als `nextAvailableDay` capaciteit > 0 vereist — controleer de exacte voorwaarde in de huidige lus-body en pas enkel aan indien de feestdag niet al impliciet wordt uitgesloten door de capaciteitscheck.

- [ ] **Step 4: Verifieer**

  Herhaal Step 1: `capacityForDay('2026-07-21')` geeft nu `0`. Roep "⚡ Plan deze week" aan in een week met een feestdag: geen enkel ticket wordt op die datum gepland, en er verschijnt geen blocking `confirm()`-dialoog meer voor die dag tijdens de auto-plan-lus.

- [ ] **Step 5: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: capacityForDay/nextAvailableDay houden rekening met Belgische feestdagen"
  ```

---

### Task 21: `DEFAULT_SETTINGS.werkdagen` wordt in-place gemuteerd

**Files:**
- Modify: `public/index.html:1769-1777` (`loadPersonSettings`)

- [ ] **Step 1: Reproduceer**

  Wissel naar een technieker zonder eigen opgeslagen instellingen (of `localStorage.clear()` eerst voor een schone test). Open Instellingen, klik "Za" aan, sluit de modal zonder op te slaan (klik ergens buiten de modal). Wissel naar een andere technieker zonder eigen instellingen. Open Instellingen opnieuw: "Za" staat al aangevinkt, hoewel niemand die technieker ooit expliciet zo heeft ingesteld.

- [ ] **Step 2: Fix — diepe kopie van `werkdagen`**

  Vervang:
  ```js
  function loadPersonSettings(person) {
    const saved = JSON.parse(localStorage.getItem(settingsKey(person)) || '{}');
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      // Lege strings mogen de default niet overschrijven
      startlocatie: saved.startlocatie || DEFAULT_SETTINGS.startlocatie,
    };
  }
  ```
  door:
  ```js
  function loadPersonSettings(person) {
    const saved = JSON.parse(localStorage.getItem(settingsKey(person)) || '{}');
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      // Lege strings mogen de default niet overschrijven
      startlocatie: saved.startlocatie || DEFAULT_SETTINGS.startlocatie,
      // Eigen array-kopie — anders deelt elke technieker zonder opgeslagen werkdagen
      // hetzelfde array-object, en muteert openSettings() dat in-place (zie regel ~4148).
      werkdagen: [...(saved.werkdagen || DEFAULT_SETTINGS.werkdagen)],
    };
  }
  ```

- [ ] **Step 3: Verifieer**

  Herhaal Step 1 na de fix: het aanvinken van "Za" voor technieker A zonder op te slaan mag technieker B's (of de globale default's) werkdagen niet meer beïnvloeden. Test ook dat "Opslaan" nog steeds normaal werkt voor de technieker die de wijziging wél bevestigt.

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: loadPersonSettings kopieert werkdagen diep, voorkomt gedeelde mutatie tussen technici"
  ```

---

### Task 22: Wizard-onderdelen-inputs verliezen focus / kunnen geen decimalen

**Files:**
- Modify: `public/index.html:5359-5373` (`wizUpdSelNaam`, `wizUpdSelAantal`, `wizUpdSelPrijs`, `_wizHertekenGeselecteerd`)

- [ ] **Step 1: Reproduceer**

  Voeg in de wizard een vrije regel toe, typ in het naamveld "Zekering" letter voor letter. Verwacht (bug): na elke toets verliest het veld focus (moet telkens opnieuw aangeklikt worden). Typ in het prijsveld "12.50": na de "." springt de waarde terug naar "12".

- [ ] **Step 2: Fix — her-render enkel het totaal, niet de hele lijst, bij elke toetsaanslag**

  De kernfout is dat `_wizHertekenGeselecteerd()` (aangeroepen bij elke `oninput`) de volledige `#wiz-sel-list`-`innerHTML` herschrijft, wat het actieve input-element vernietigt. Splits de twee verantwoordelijkheden: het totaal moet live bijwerken, de rij-inputs zelf niet.

  Vervang:
  ```js
  function wizUpdSelNaam(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].naam      = val; _wizHertekenGeselecteerd(); }
  function wizUpdSelAantal(i, val){ if (R.onderdelen[i]) R.onderdelen[i].aantal    = parseInt(val)||1; _wizHertekenGeselecteerd(); }
  function wizUpdSelPrijs(i, val) { if (R.onderdelen[i]) R.onderdelen[i].prijs     = parseFloat(val)||0; _wizHertekenGeselecteerd(); }
  function wizUpdSelFact(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].factureren = val; }

  function _wizHertekenGeselecteerd() {
    const selList = document.getElementById('wiz-sel-list');
    const selSection = document.getElementById('wiz-sel-section');
    if (!selList) return;
    selList.innerHTML = _wizRenderGeselecteerd();
    // Herrender totaal
    let totaalEl = selSection?.querySelector('.wiz-totaal-row');
    if (totaalEl) totaalEl.outerHTML = _wizTotaalRij();
    else if (selSection) selSection.insertAdjacentHTML('beforeend', _wizTotaalRij());
  }
  ```
  door:
  ```js
  function wizUpdSelNaam(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].naam      = val; _wizUpdateTotaalRow(); }
  function wizUpdSelAantal(i, val){ if (R.onderdelen[i]) R.onderdelen[i].aantal    = parseInt(val)||1; _wizUpdateTotaalRow(); }
  function wizUpdSelPrijs(i, val) { if (R.onderdelen[i]) R.onderdelen[i].prijs     = val; _wizUpdateTotaalRow(); }
  function wizUpdSelFact(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].factureren = val; _wizUpdateTotaalRow(); }

  // Werkt enkel het totaal-rijtje bij — laat de input-elementen zelf (en dus de focus/cursorpositie) met rust.
  function _wizUpdateTotaalRow() {
    const selSection = document.getElementById('wiz-sel-section');
    if (!selSection) return;
    let totaalEl = selSection.querySelector('.wiz-totaal-row');
    if (totaalEl) totaalEl.outerHTML = _wizTotaalRij();
    else selSection.insertAdjacentHTML('beforeend', _wizTotaalRij());
  }

  // Volledige her-render blijft nodig zodra een rij wordt toegevoegd/verwijderd
  // (aantal DOM-nodes verandert) — gebruikt door wizAddVrijeRegel/wizRemovePart/wizVoegCatToe.
  function _wizHertekenGeselecteerd() {
    const selList = document.getElementById('wiz-sel-list');
    if (!selList) return;
    selList.innerHTML = _wizRenderGeselecteerd();
    _wizUpdateTotaalRow();
  }
  ```
  Belangrijk: `wizUpdSelPrijs` slaat nu de **ruwe string** op (`val`, niet `parseFloat(val)||0`) zodat een tussentijdse invoer als `"12."` niet meteen wordt afgerond naar `12` terwijl je nog typt. `_wizTotaalRij()` en `buildRapportHtml`/`archiveerRapport` doen al `parseFloat(p.prijs)||0` op het moment dat het bedrag *gebruikt* wordt — een ruwe stringwaarde tussentijds opslaan is dus veilig, zolang je controleert dat er geen plek is die `R.onderdelen[i].prijs` als getal aanneemt vóór het definitief wordt gebruikt (grep op `.prijs` binnen deze functiefamilie om dat te bevestigen vóór je commit).

  Overal waar `_wizHertekenGeselecteerd()` wordt aangeroepen ná een structurele wijziging (rij toevoegen/verwijderen — `wizAddVrijeRegel`, `wizRemovePart`, `wizVoegCatToe`) blijft die aanroep ongewijzigd; enkel de drie per-toetsaanslag-updates (naam/aantal/prijs/factureren) gebruiken voortaan de lichte `_wizUpdateTotaalRow()`.

- [ ] **Step 3: Verifieer**

  Herhaal Step 1: typ "Zekering" in één ononderbroken toetsenreeks zonder de focus te verliezen; typ "12.50" in het prijsveld en zie de volledige waarde blijven staan (het totaal-rijtje update wel live). Test daarna nog dat "+ Vrije regel toevoegen" en "verwijderen" nog steeds een volledige, correcte her-render geven.

- [ ] **Step 4: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: wizard-onderdelen-inputs verliezen geen focus meer bij elke toetsaanslag"
  ```

---

### Task 23: Handtekeningen persisteren over wizard-navigatie heen

**Files:**
- Modify: `public/index.html:4702-4711` (`WIZ_STEPS`-array, `save`-functies voor sig-tech/sig-klant)
- Modify: `public/index.html:5387-5427` (`wizRenderSigTech`, `wizClearSigTech`)
- Modify: `public/index.html:5429-5479` (`wizRenderSigKlant`, `wizClearSigKlant`)
- Modify: `public/index.html:5527-5531` (`buildRapportHtml`'s `sigTechImg`/`sigKlantImg`)
- Modify: `public/index.html:4713-4780` (`openRapport` — zie ook Task 17, zelfde plek)

Afhankelijk van Task 17 (voegt `R.handtekeningTech`/`R.handtekeningKlant = null` toe aan de reset in `openRapport`).

- [ ] **Step 1: Reproduceer**

  Teken op stap "Handtekening 1" (technieker), ga naar stap "Handtekening 2" (klant), klik "← Terug" naar stap 1. Verwacht (bug): het canvas is leeg — de eerder gezette handtekening is weg.

- [ ] **Step 2: `save` van beide sig-stappen vult daadwerkelijk iets in**

  Vervang in `WIZ_STEPS`:
  ```js
    { id: 'sig-tech',     label: 'Handtekening 1', render: wizRenderSigTech,      save: () => {}            },
    { id: 'sig-klant',    label: 'Handtekening 2', render: wizRenderSigKlant,     save: () => {}            },
  ```
  door:
  ```js
    { id: 'sig-tech',     label: 'Handtekening 1', render: wizRenderSigTech,      save: wizSaveSigTech      },
    { id: 'sig-klant',    label: 'Handtekening 2', render: wizRenderSigKlant,     save: wizSaveSigKlant     },
  ```

  Voeg de twee nieuwe functies toe (bv. net vóór `wizRenderSigTech`):
  ```js
  function wizSaveSigTech() {
    R.handtekeningTech = (_sigTech && !_sigTech.isEmpty()) ? _sigTech.toDataURL() : null;
  }
  function wizSaveSigKlant() {
    R.handtekeningKlant = (_sigKlant && !_sigKlant.isEmpty()) ? _sigKlant.toDataURL() : null;
  }
  ```

- [ ] **Step 3: Restaureer een eerder getekende handtekening bij het opnieuw renderen van de stap**

  Vervang in `wizRenderSigTech`:
  ```js
    requestAnimationFrame(() => {
      const canvas = document.getElementById('sig-tech-canvas');
      const wrap   = document.getElementById('sig-tech-wrap');
      canvas.width  = wrap.offsetWidth;
      canvas.height = wrap.offsetHeight || Math.max(260, window.innerHeight * 0.38);
      if (window.SignaturePad) {
        _sigTech = new SignaturePad(canvas, { penColor: '#181e24', backgroundColor: '#ffffff' });
        _sigTech.addEventListener('endStroke', () => {
          document.getElementById('sig-tech-hint').style.display = 'none';
          const st = document.getElementById('sig-tech-status');
          if (st) { st.textContent = '✅ Getekend'; st.style.color = 'var(--accent)'; }
          wrap.classList.add('has-sig');
        });
      }
    });
  }
  ```
  door:
  ```js
    requestAnimationFrame(() => {
      const canvas = document.getElementById('sig-tech-canvas');
      const wrap   = document.getElementById('sig-tech-wrap');
      canvas.width  = wrap.offsetWidth;
      canvas.height = wrap.offsetHeight || Math.max(260, window.innerHeight * 0.38);
      if (window.SignaturePad) {
        _sigTech = new SignaturePad(canvas, { penColor: '#181e24', backgroundColor: '#ffffff' });
        _sigTech.addEventListener('endStroke', () => {
          document.getElementById('sig-tech-hint').style.display = 'none';
          const st = document.getElementById('sig-tech-status');
          if (st) { st.textContent = '✅ Getekend'; st.style.color = 'var(--accent)'; }
          wrap.classList.add('has-sig');
        });
        // Terugnavigeren mag een eerder getekende handtekening niet wissen.
        if (R.handtekeningTech) {
          _sigTech.fromDataURL(R.handtekeningTech);
          document.getElementById('sig-tech-hint').style.display = 'none';
          const st = document.getElementById('sig-tech-status');
          if (st) { st.textContent = '✅ Getekend'; st.style.color = 'var(--accent)'; }
          wrap.classList.add('has-sig');
        }
      }
    });
  }
  ```
  Pas `wizRenderSigKlant` analoog aan met `R.handtekeningKlant`/`_sigKlant`.

- [ ] **Step 4: `wizClearSigTech`/`wizClearSigKlant` wissen ook het persistente veld**

  Vervang:
  ```js
  function wizClearSigTech() {
    if (_sigTech) {
      _sigTech.clear();
      const hint = document.getElementById('sig-tech-hint');
      if (hint) hint.style.display = '';
      const st = document.getElementById('sig-tech-status');
      if (st) { st.textContent = 'Nog niet getekend'; st.style.color = ''; }
      document.getElementById('sig-tech-wrap')?.classList.remove('has-sig');
    }
  }
  ```
  door:
  ```js
  function wizClearSigTech() {
    if (_sigTech) {
      _sigTech.clear();
      R.handtekeningTech = null;
      const hint = document.getElementById('sig-tech-hint');
      if (hint) hint.style.display = '';
      const st = document.getElementById('sig-tech-status');
      if (st) { st.textContent = 'Nog niet getekend'; st.style.color = ''; }
      document.getElementById('sig-tech-wrap')?.classList.remove('has-sig');
    }
  }
  ```
  Analoog voor `wizClearSigKlant`.

- [ ] **Step 5: `buildRapportHtml` leest de gepersisteerde dataURL i.p.v. het live canvas-object**

  Vervang:
  ```js
    const sigTechImg  = (_sigTech  && !_sigTech.isEmpty())
      ? `<img src="${_sigTech.toDataURL()}" style="max-width:220px;max-height:90px;display:block">`
      : '<span style="color:#aaa;font-style:italic;font-size:9pt">(niet getekend)</span>';
    const sigKlantImg = (_sigKlant && !_sigKlant.isEmpty())
      ? `<img src="${_sigKlant.toDataURL()}" style="max-width:220px;max-height:90px;display:block">`
      : '<span style="color:#aaa;font-style:italic;font-size:9pt">(niet getekend)</span>';
  ```
  door:
  ```js
    const sigTechImg  = R.handtekeningTech
      ? `<img src="${R.handtekeningTech}" style="max-width:220px;max-height:90px;display:block">`
      : '<span style="color:#aaa;font-style:italic;font-size:9pt">(niet getekend)</span>';
    const sigKlantImg = R.handtekeningKlant
      ? `<img src="${R.handtekeningKlant}" style="max-width:220px;max-height:90px;display:block">`
      : '<span style="color:#aaa;font-style:italic;font-size:9pt">(niet getekend)</span>';
  ```
  Dit werkt correct omdat `wizNext()`/`wizBack()` altijd `step.save()` van de *huidige* stap aanroepen vóór ze de stap wisselen (zie `index.html:4818-4838`) — op het moment dat `buildRapportHtml()` als preview op stap "Handtekening klant" draait, is `R.handtekeningTech` dus al gezet door het verlaten van stap "Handtekening technieker", en bij het klikken op "🖨️ Afdrukken/PDF" op de laatste stap wordt `R.handtekeningKlant` gezet vlak vóór `printRapport()` aangeroepen wordt.

- [ ] **Step 6: (afhankelijkheid van Task 17) reset in `openRapport`**

  Bevestig dat Task 17's toevoeging (`R.handtekeningTech = null; R.handtekeningKlant = null;`) al is toegepast — zo niet, voeg die hier alsnog toe.

- [ ] **Step 7: Verifieer**

  Herhaal Step 1: teken op stap 1, ga naar stap 2, ga terug naar stap 1 — de handtekening staat er nog. Ga weer vooruit naar stap 2, teken de klanthandtekening, klik "Afdrukken/PDF" — beide handtekeningen staan correct op het gegenereerde rapport. Test ook: wis een handtekening (Wissen-knop), navigeer weg en terug — moet leeg blijven (niet per ongeluk hersteld).

- [ ] **Step 8: Commit**

  ```bash
  git add public/index.html
  git commit -m "fix: wizard-handtekeningen persisteren in R over terug/verder-navigatie heen"
  ```

---

### Task 24: `tickets.js` verbergt Zoho HTTP-fouten als 200 OK

**Files:**
- Modify: `netlify/functions/tickets.js:64-90`

- [ ] **Step 1: Reproduceer (gesimuleerd — een echte Zoho-rate-limit is niet on-demand op te wekken)**

  Zet tijdelijk een ongeldige `ZOHO_REFRESH_TOKEN` in `.env.local`, herstart de dev-server, roep `/api/tickets` aan. Verwacht (bug, afhankelijk van waar de fout optreedt): mogelijks alsnog een 200 met lege arrays in plaats van een duidelijke 401/500. Zet de token nadien terug.

- [ ] **Step 2: Laat `safeJson` de HTTP-status doorgeven, en stop de paginering-lus bij een fout in plaats van door te gaan met een lege pagina**

  Vervang:
  ```js
    // Stap 1: alle tickets ophalen via paginering (max 6 pagina's = 600 tickets)
    const safeJson = async (res) => {
      const text = await res.text();
      if (!text) return {};
      try { return JSON.parse(text); } catch { return {}; }
    };

    // Paginering zonder statusType filter (Zoho filtert custom statuses er anders uit)
    // Zodra een pagina 0 relevante tickets oplevert EN de vorige pagina ook 0 had, stoppen we vroeg.
    let allRaw = [];
    let emptyRelevantPages = 0;
    for (let from = 0; from < 600; from += 100) {
      const res  = await fetch(`${ZOHO_DESK}/tickets?limit=100&from=${from}`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
      });
      const data = await safeJson(res);
      const page = data.data || [];
      const relevantOnPage = page.filter(t => RELEVANT.includes(t.status)).length;
      allRaw = allRaw.concat(page);
      if (page.length < 100) break; // laatste pagina
      if (relevantOnPage === 0) {
        emptyRelevantPages++;
        if (emptyRelevantPages >= 2) break; // 2 lege pagina's op rij → stoppen
      } else {
        emptyRelevantPages = 0;
      }
    }
  ```
  door:
  ```js
    // Stap 1: alle tickets ophalen via paginering (max 6 pagina's = 600 tickets)
    const safeJson = async (res) => {
      const text = await res.text();
      if (!text) return {};
      try { return JSON.parse(text); } catch { return {}; }
    };

    // Paginering zonder statusType filter (Zoho filtert custom statuses er anders uit)
    // Zodra een pagina 0 relevante tickets oplevert EN de vorige pagina ook 0 had, stoppen we vroeg.
    let allRaw = [];
    let emptyRelevantPages = 0;
    for (let from = 0; from < 600; from += 100) {
      const res  = await fetch(`${ZOHO_DESK}/tickets?limit=100&from=${from}`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
      });
      if (!res.ok) {
        const errBody = await safeJson(res);
        throw new Error(`Zoho tickets-ophalen mislukt (${res.status}): ${JSON.stringify(errBody)}`);
      }
      const data = await safeJson(res);
      const page = data.data || [];
      const relevantOnPage = page.filter(t => RELEVANT.includes(t.status)).length;
      allRaw = allRaw.concat(page);
      if (page.length < 100) break; // laatste pagina
      if (relevantOnPage === 0) {
        emptyRelevantPages++;
        if (emptyRelevantPages >= 2) break; // 2 lege pagina's op rij → stoppen
      } else {
        emptyRelevantPages = 0;
      }
    }
  ```
  De `throw` wordt al opgevangen door de bestaande buitenste `try/catch` van de handler (regel 154-160), die correct een 500 met `err.message` teruggeeft — dus geen extra catch-blok nodig.

  Doe dezelfde `if (!res.ok) throw ...`-toevoeging voor de detail-fetch-lus (rond regel 100-110): één mislukte detail-call mag niet stilzwijgend als `{}` doorgaan (wat het ticket met een lege/undefined status uit alle filters laat vallen). Vervang:
  ```js
      const results = await Promise.all(
        batch.map(id =>
          fetch(`${ZOHO_DESK}/tickets/${id}`, {
            headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
          }).then(safeJson)
        )
      );
  ```
  door:
  ```js
      const results = await Promise.all(
        batch.map(async id => {
          const res = await fetch(`${ZOHO_DESK}/tickets/${id}`, {
            headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
          });
          if (!res.ok) {
            const errBody = await safeJson(res);
            throw new Error(`Zoho ticketdetail ${id} mislukt (${res.status}): ${JSON.stringify(errBody)}`);
          }
          return safeJson(res);
        })
      );
  ```

- [ ] **Step 3: Verifieer**

  Met een geldige token: `/api/tickets` werkt zoals voorheen (200, gevulde arrays). Met een tijdelijk ongeldige token (Step 1's proef): verwacht nu een duidelijke 500 met een Zoho-foutbericht, in plaats van een misleidende 200 met lege data.

- [ ] **Step 4: Commit**

  ```bash
  git add netlify/functions/tickets.js
  git commit -m "fix: tickets.js geeft Zoho HTTP-fouten door ipv ze als lege data te maskeren"
  ```

---

### Task 25: `optimize.js` gebruikt de TomTom Waypoint Optimization API verkeerd

**Files:**
- Modify: `netlify/functions/optimize.js:57-91`

- [ ] **Step 1: Reproduceer**

  Roep `/api/optimize` aan met minstens 3 `stops` en een ongeldige/lege `TOMTOM_API_KEY` (tijdelijk aanpassen in `.env.local`), en observeer dat de response toch `optimizedOrder: [0,1,2]` (de niet-geoptimaliseerde volgorde) teruggeeft met **200**, zonder enige aanduiding dat de optimalisatie zelf mislukt is.

- [ ] **Step 2: Verplaats origin/destination/travelMode naar de request body (waar de TomTom Waypoint Optimization v1-API ze verwacht) en controleer expliciet op een mislukte call**

  Vervang:
  ```js
    // TomTom Waypoint Optimization
    const waypointsBody = {
      waypoints: stopsGeo.map((s, i) => ({
        point: { latitude: s.lat, longitude: s.lon },
        waypoint_id: String(i),
      })),
      departureTime: new Date().toISOString(),
    };

    const optRes = await fetch(
      `${TOMTOM_BASE}/routing/waypointoptimization/1?key=${API_KEY()}` +
      `&origin=${originGeo.lat},${originGeo.lon}` +
      `&destination=${originGeo.lat},${originGeo.lon}` + // return to origin optional
      `&travelMode=car`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(waypointsBody),
      }
    );

    const optData = await optRes.json();

    // Extract optimized order
    const optimizedOrder = optData.optimizedOrder || stopsGeo.map((_, i) => i);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        optimizedOrder,
        locations: [originGeo, ...stopsGeo],
        rawResponse: optData,
      }),
    };
  ```
  door:
  ```js
    // TomTom Waypoint Optimization v1: origin/destination zijn zelf waypoints
    // (eerste en laatste element), en de opties horen in de body onder "options" —
    // niet als query-parameters (die worden door deze API genegeerd).
    const allPoints = [originGeo, ...stopsGeo, originGeo]; // start en eind bij het vertrekpunt
    const waypointsBody = {
      waypoints: allPoints.map((s, i) => ({
        point: { latitude: s.lat, longitude: s.lon },
        waypointId: String(i),
      })),
      options: {
        travelMode: 'car',
        departAt: new Date().toISOString(),
      },
    };

    const optRes = await fetch(
      `${TOMTOM_BASE}/routing/waypointoptimization/1?key=${API_KEY()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(waypointsBody),
      }
    );

    if (!optRes.ok) {
      const errBody = await optRes.json().catch(() => ({}));
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `TomTom route-optimalisatie mislukt (${optRes.status})`, details: errBody }),
      };
    }

    const optData = await optRes.json();
    if (!Array.isArray(optData.optimizedOrder)) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'TomTom gaf geen geldige optimizedOrder terug', details: optData }),
      };
    }

    // Eerste en laatste waypoint zijn het vertrekpunt (index 0 in allPoints) — die horen niet
    // in de teruggegeven volgorde van de tussenliggende stops.
    const optimizedOrder = optData.optimizedOrder
      .filter(i => i !== 0 && i !== allPoints.length - 1)
      .map(i => i - 1); // terug naar 0-based index in stopsGeo

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        optimizedOrder,
        locations: [originGeo, ...stopsGeo],
        rawResponse: optData,
      }),
    };
  ```
  **Let op:** de exacte vorm van TomTom's `optimizedOrder`-response (bevat die de vertrekpunt-waypoints wel/niet, en in welke sleutelnaam — `waypointId` vs `waypoint_id`) moet tegen een echte, geldige TomTom-call geverifieerd worden vóór dit als afgerond te beschouwen — zie Step 3. Pas de exacte filter-/mapping-logica aan op wat de live-respons daadwerkelijk teruggeeft.

- [ ] **Step 3: Verifieer tegen een echte TomTom-call (niet enkel lezen — de API-vorm moet empirisch bevestigd worden)**

  ```bash
  curl -s -X POST "http://localhost:3333/api/optimize" -H "Content-Type: application/json" \
    -d '{"origin":"Heirbaan 9, 9150 Kruibeke","stops":["Antwerpseweg 50, 2440 Geel","Kuringersteenweg 12, 3500 Hasselt","Groenplaats 1, 2000 Antwerpen"]}'
  ```
  Inspecteer de ruwe `rawResponse` in de output: bevestig het exacte veld voor de geoptimaliseerde volgorde en pas Step 2's mapping aan indien de structuur afwijkt van de aanname hierboven. Vergelijk de teruggegeven `optimizedOrder` met een handmatige, logische inschatting (dichtsbijzijnde-eerst) om te bevestigen dat er nu écht geoptimaliseerd wordt, niet toevallig weer `[0,1,2]`.

  Test ook de foutafhandeling: zet tijdelijk een ongeldige `TOMTOM_API_KEY`, herhaal de call — verwacht nu een **502** met een duidelijke foutmelding, geen 200 met een stille fallback.

- [ ] **Step 4: Commit**

  ```bash
  git add netlify/functions/optimize.js
  git commit -m "fix: optimize.js gebruikt de TomTom Waypoint Optimization API correct en faalt niet meer stil"
  ```

---

## BACKLOG — bewust niet met volledige stappen uitgewerkt

Deze bevindingen uit `docs/reviews/bug-audit-2026-07-25.md` zijn wél echt, maar hebben lagere ernst/impact dan Fase 0-5 en zijn hier bewust als tabel opgenomen in plaats van als volledig uitgewerkte taken — anders zou dit plan onwerkbaar lang worden voor bevindingen die individueel weinig gevolg hebben. Pak ze op zodra Fase 0-5 klaar zijn, of laat een volgend plan ze in dezelfde stijl uitwerken.

| Bevinding | Bestand(en) | Korte aanpak |
|---|---|---|
| Rapport-paginanummers nog niet live geverifieerd | `netlify/functions/rapport.js`, `public/index.html` (buildRapportHtml) | Geen code-wijziging — genereer een rapport met veel inhoud op de live site na de eerstvolgende deploy, controleer paginering visueel |
| `removeTicketFromDate` ruimt `allPending`/`allGepland` niet mee op | `index.html` | Filter beide arrays op ticketId na een succesvolle removal |
| Race tussen 30s-poll en `addTicketToDate` | `index.html` (`loadTickets`, `addTicketToDate`) | Voeg `inFlightTickets`-uitzondering toe aan de re-seed-lus in `loadTickets`, zoals `reconcilePlanning` al heeft |
| 409-merge in `saveKlantBeschikbaarheid` maakt deletes ongedaan | `index.html` | Merge-strategie herzien: expliciet bijhouden welke keys lokaal verwijderd zijn i.p.v. enkel te overschrijven |
| Diverse tab-badges tonen verouderde/ongefilterde aantallen | `index.html` | Badges bijwerken op dezelfde plekken waar `renderGepland`/`selectPerson` al draaien |
| `capacityForDay` trekt geblokkeerde minuten af zonder overlap met werkuren | `index.html:3340-3349` | Clip `[e.from, e.to]` tegen `[vanTijd, totTijd]` vóór de aftrek; dedupliceer overlappende blokken |
| Seed-ticket in `autoPlan` zonder capaciteitscheck | `index.html:3512-3519` | Capaciteitscheck ook voor het seed-ticket toepassen |
| `alreadyPlanned` telt tickets i.p.v. slots | `index.html` (`autoPlan`, `nextAvailableDay`) | Vervang `.length` door een som van `duurVoor(id)`-gebaseerde slotberekening |
| Voorstel met aangepaste datum maakt dubbele planning-entry | `index.html` (`sendProposal`) | Verwijder het ticket uit de oude datum vóór het aan de nieuwe datum toe te voegen |
| `computeArrivalTimes` negeert lokale events | `index.html` | Neem `localForDate` mee in dezelfde volgorde/indexering als `calculateRoute` |
| `initMap()` niet afgeschermd tegen falende Leaflet-CDN | `index.html` | Wrap in try/catch, laat de rest van `DOMContentLoaded` onafhankelijk doorlopen |
| 409-rollback in `saveManueelAfspraak`/`removeLocalEvent`/`avRemoveException` schrijft naar verkeerde index | `index.html` | Rollback op basis van `id`-match zoeken i.p.v. index, ná een 409 |
| Import: datumloze/ongeldige items verdwijnen zonder melding | `index.html` (`startImport`) | Valideer datumformaat vóór filtering, toon een expliciete telling van overgeslagen rijen |
| `matchRespToPerson` korte-naam-substring-match zonder lengtegrens | `index.html` | Voeg een minimumlengte toe aan de partial-match, net als de woorddeel-match al heeft |
| Dode code (`geoCluster`, `estimateTravelMinFromRoute`, `wizUpdatePart`/`wizAddPart`, `getPrijsVoorId`, ...) | `index.html` | Verwijderen zodra iemand toch al in die functiefamilie zit — geen aparte taak nodig |
| `openFotoModal` state-race bij snel na elkaar wisselen van ticket | `index.html` | `_fotoState` pas zetten na de laatst-gestarte `loadFotos()`-call (bv. via een oplopende request-teller) |
| `updateKb('duur', ...)` — `duurOverride` niet persistent opgeslagen server-side | `index.html`, `netlify/functions/klantbeschikbaarheid.js` | `cleaned[ticketId]` in de PUT-handler ook `duurOverride` laten meenemen |
| `route.js` telt traffic-delay dubbel (dood veld, ongebruikt) | `netlify/functions/route.js:48` | Verwijderen of correct berekenen vóór het ooit gebruikt wordt |
| `initMap`/`updateMap`: geen marker voor lokale events, nummering klopt niet bij ontbrekend adres | `index.html` | Marker-nummering baseren op dezelfde index als `renderRouteList` i.p.v. een aparte lus |
| Overige kleinere input-validatie-gaten in `availability.js`/`afspraken.js`/`klantbeschikbaarheid.js` (element-niveau, geeft 500 i.p.v. 400) | genoemde bestanden | Per-element type-check toevoegen naast de bestaande top-level `Array.isArray`-check |

**Frontend-refactor (`public/index.html` opsplitsen in modules)** — expliciet **niet** in dit plan, zoals eerder met Brent besproken: waardevol op lange termijn (voorkomt herhaalde patroonfouten zoals de 5× teruggekomen `activeAssigneeFilter`-bug), maar een aparte, niet-triviale ingreep met regressierisico op een live tool. Pas oppakken als eigen plan, ná Fase 0-5 hierboven.

---

## Dekking t.o.v. het audit-rapport (zelf-controle)

**Task 13b is toegevoegd na Brents review van dit plan (niet uit het oorspronkelijke audit-rapport)**: de rapport-aanrijtijd-fallback in `openRapport` rekent voor elke stop na de eerste van de dag onterecht vanaf het bureau i.p.v. vanaf de vorige klant — enkel de facturatie in het rapport, niet de routeplanning zelf. Zie de aanname over stopvolgorde (op basis van geplande `uur`) expliciet vermeld bovenaan die taak.

Elke KRITIEK/HOOG-bevinding uit `docs/reviews/bug-audit-2026-07-25.md` is toegewezen aan een taak hierboven; MEDIUM/LAAG-bevindingen die geen taak kregen staan in de Backlog-tabel — niets is stilzwijgend weggelaten. Namen/functiesignaturen die in latere taken gebruikt worden (`escHtml`, `getHolidayName`, `berekenLoonkost`, `calcWerktijdMin`, `WIZ_STEPS`, `_wizTotaalRij`) komen overeen met wat in de huidige codebase staat (geverifieerd via Read/Grep tijdens het opstellen van dit plan, 2026-07-25) — regelnummers verschuiven na elke voorgaande taak; gebruik de gegeven Grep-patronen om ze opnieuw te lokaliseren in plaats van blind op de genoemde regelnummers te vertrouwen vanaf Task 7 en later.
