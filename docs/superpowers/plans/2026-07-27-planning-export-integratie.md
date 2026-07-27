# Planning-export Integratie (Blitz Planning → Base44) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eén nieuw, read-only Netlify Function-endpoint (`GET /api/planning-export`) dat alle geplande Blitz Planning-activiteit (Zoho-tickets met ingevulde interventiedatum + handmatige afspraken) teruggeeft als JSON, beveiligd met een gedeelde API-sleutel, zodat de collega's Base44-app dit periodiek kan bevragen.

**Architecture:** Eén nieuw bestand, `netlify/functions/planning-export.js` (classic Netlify Functions-stijl). Geen enkel bestaand bestand wijzigt. Het endpoint hergebruikt bestaande, al werkende endpoints via interne HTTP-zelfaanroepen (`/api/tickets`, `/api/klantbeschikbaarheid`, `/api/afspraken`) in plaats van Zoho/blob-logica te dupliceren — dit garandeert dat de export-data altijd exact overeenkomt met wat de app zelf al toont, en voorkomt dat twee plekken los van elkaar met Zoho-veldnamen omgaan.

**Tech Stack:** Node.js ES modules, Netlify Functions (classic stijl), `fetch` (nativief in Node 18+, geen nieuwe dependency).

## Global Constraints

- Geen nieuw bestand mag een bestaand bestand wijzigen, behalve `.env.local.example` (nieuwe placeholder-regel) en `ONBOARDING.md` (korte vermelding van het nieuwe endpoint) in Task 2's laatste stap.
- Volg de bestaande conventie: kleine, per-bestand gedupliceerde helpers, geen gedeelde module (zie `docs/superpowers/plans/2026-07-25-bug-fix-roadmap.md`'s Global Constraints voor dezelfde afspraak).
- Geen testframework in dit project — verificatie via `node dev-server.mjs` + curl, en live tegen testticket **#3731** (intern ID `157486000011122009`) waar Zoho-data nodig is.
- Nooit pushen naar `origin/main` zonder telkens opnieuw expliciete bevestiging. Lokaal committen mag zonder te vragen.
- Spec: `docs/superpowers/specs/2026-07-27-planning-export-integratie-design.md` — elk detail hieronder (veldmapping, weggelaten velden, reikwijdte, foutafhandeling) moet exact overeenkomen met dat document.

---

### Task 1: Zoho-deel van het endpoint — auth, zelf-fetch tickets, filteren, mappen

**Files:**
- Create: `netlify/functions/planning-export.js`
- Modify: `.env.local.example` (nieuwe placeholder-regel toevoegen)

**Interfaces:**
- Consumes: het bestaande `GET /api/tickets`-endpoint (`netlify/functions/tickets.js`), dat een JSON-object teruggeeft met (op basis van `DUMMY_DATA`'s vorm, die dezelfde vorm als de echte respons volgt) de vorm `{ tickets: [...], pendingTickets: [...], plannedTickets: [...] }`, waarbij elk ticket-object minstens de velden `id`, `number`, `subject`, `status`, `assignee`, `contact`, `account`, `address`, `hasAddress`, `naamEindklant`, `interventieDatum` (ISO-datetime-string of `null`) bevat.
- Produces: `GET /api/planning-export` → `200` met JSON-array van export-items in de vorm uit de spec (zie Step 3 hieronder), of `401`/`500` bij respectievelijk auth- en Zoho-fouten. Deze vorm wordt in Task 2 uitgebreid met handmatige afspraken — de array-structuur en het `id`/`bron`-veld per item blijven ongewijzigd.

- [ ] **Step 1: Bevestig de exacte respons-vorm van `/api/tickets`**

  Lees `netlify/functions/tickets.js` volledig (met name het einde van de `handler`-functie, waar de uiteindelijke `body: JSON.stringify(...)` wordt opgebouwd) om te bevestigen dat de respons-sleutels exact `tickets`, `pendingTickets`, `plannedTickets` zijn, en dat elk ticket-object een `interventieDatum`-veld heeft (ISO-datetime-string wanneer gepland, anders `null`/afwezig). Pas de veldnamen in de volgende stappen aan als de werkelijke respons afwijkt van wat hierboven staat.

- [ ] **Step 2: Maak `netlify/functions/planning-export.js` aan met de auth-guard en de zelf-fetch-basis**

  ```js
  // /api/planning-export
  // Geeft alle geplande Blitz Planning-activiteit (Zoho-tickets met ingevulde
  // interventiedatum + handmatige afspraken) terug als JSON, voor externe
  // koppelingen (bv. de Base44-planningsapp van een collega). Read-only,
  // machine-naar-machine — geen gebruikersauthenticatie, enkel een gedeelde
  // API-sleutel via de Authorization-header.
  // Zie docs/superpowers/specs/2026-07-27-planning-export-integratie-design.md

  const DEFAULT_DUUR_MIN = 120; // zelfde standaardwaarde als DEFAULT_SETTINGS.duurMinuten in index.html

  function baseUrl(event) {
    const host = event.headers.host || event.headers.Host;
    const proto = host && host.startsWith('localhost') ? 'http' : 'https';
    return `${proto}://${host}`;
  }

  function checkAuth(event) {
    const header = event.headers.authorization || event.headers.Authorization || '';
    const expected = process.env.PLANNING_EXPORT_API_KEY;
    if (!expected) return false; // fail-closed: geen sleutel geconfigureerd = geen toegang
    return header === `Bearer ${expected}`;
  }

  export async function handler(event) {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
    if (!checkAuth(event)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    try {
      const url = baseUrl(event);

      const ticketsRes = await fetch(`${url}/api/tickets`);
      if (!ticketsRes.ok) {
        const errBody = await ticketsRes.json().catch(() => ({}));
        throw new Error(`Tickets ophalen mislukt (${ticketsRes.status}): ${JSON.stringify(errBody)}`);
      }
      const ticketsData = await ticketsRes.json();
      const alleTickets = [
        ...(ticketsData.tickets || []),
        ...(ticketsData.pendingTickets || []),
        ...(ticketsData.plannedTickets || []),
      ];

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(alleTickets), // tijdelijk — Step 3 vervangt dit door de echte mapping
      };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }
  ```

- [ ] **Step 3: Filter tot geplande tickets en map naar de export-vorm**

  Vervang de `return`-instructie uit Step 2 (met de tijdelijke `alleTickets`-array) door de echte filtering en mapping:

  ```js
      const gisteren = new Date();
      gisteren.setDate(gisteren.getDate() - 1);
      gisteren.setHours(0, 0, 0, 0);

      const geplandeTickets = alleTickets.filter(t => t.interventieDatum);

      const items = geplandeTickets
        .map(t => {
          const dt = new Date(t.interventieDatum);
          if (isNaN(dt.getTime()) || dt < gisteren) return null;
          const datum = dt.toISOString().slice(0, 10);
          const uur = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
          const eindMin = dt.getHours() * 60 + dt.getMinutes() + DEFAULT_DUUR_MIN;
          const eindtijd = `${String(Math.floor(eindMin / 60) % 24).padStart(2, '0')}:${String(eindMin % 60).padStart(2, '0')}`;
          return {
            id: t.id,
            bron: 'zoho',
            ticketnummer: t.number || null,
            type: 'Interventie',
            datum,
            starttijd: uur,
            eindtijd,
            technieker: t.assignee || null,
            klant: t.account || t.naamEindklant || null,
            adres: t.address || null,
            omschrijving: t.subject || null,
            status: t.status || null,
          };
        })
        .filter(Boolean);

      items.sort((a, b) => (a.datum + a.starttijd).localeCompare(b.datum + b.starttijd));

      return { statusCode: 200, headers, body: JSON.stringify(items) };
  ```

  Dit gebruikt bewust nog geen `klantbeschikbaarheid`-duur-override (dat komt in Task 2 samen met de rest) — voorlopig altijd `DEFAULT_DUUR_MIN` (120 min), exact zoals de spec als aanvaardbare eerste-versie-vereenvoudiging vermeldt.

- [ ] **Step 4: Voeg de env-var-placeholder toe**

  In `.env.local.example`, voeg een nieuwe regel toe (na de bestaande 4):
  ```
  PLANNING_EXPORT_API_KEY=jouw-eigen-gegenereerde-sleutel-hier
  ```

  Genereer voor je eigen lokale `.env.local` een echte willekeurige waarde:
  ```bash
  openssl rand -hex 32
  ```
  Zet die waarde (niet de placeholder) in je eigen `.env.local` (niet in `.env.local.example`).

- [ ] **Step 5: Verifieer lokaal**

  ```bash
  node dev-server.mjs &
  # zonder sleutel → verwacht 401
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3333/api/planning-export
  # met correcte sleutel → verwacht 200 en een JSON-array
  curl -s -H "Authorization: Bearer <jouw-sleutel-uit-.env.local>" http://localhost:3333/api/planning-export | head -c 500
  ```
  Controleer dat enkel tickets met een ingevulde interventiedatum verschijnen (test dit tegen ticket #3731 — plan het even in als het nog niet gepland staat, en bevestig dat het in de export-lijst verschijnt met de juiste `datum`/`starttijd`).

- [ ] **Step 6: Commit**

  ```bash
  git add netlify/functions/planning-export.js .env.local.example
  git commit -m "feat: nieuw read-only /api/planning-export endpoint (Zoho-deel)"
  ```

---

### Task 2: Handmatige afspraken samenvoegen, duur-override, documentatie

**Files:**
- Modify: `netlify/functions/planning-export.js`
- Modify: `ONBOARDING.md` (korte vermelding van het nieuwe endpoint)

**Interfaces:**
- Consumes: Task 1's `checkAuth`/`baseUrl`-helpers en de `items`-array-vorm uit Task 1 (elk item met `id`/`bron`/`ticketnummer`/`type`/`datum`/`starttijd`/`eindtijd`/`technieker`/`klant`/`adres`/`omschrijving`/`status`). Ook het bestaande `GET /api/afspraken`- en `GET /api/klantbeschikbaarheid`-endpoint (exacte respons-vorm te bevestigen in Step 1).
- Produces: de finale, volledige `GET /api/planning-export`-respons zoals in de spec beschreven (Zoho + handmatige items samengevoegd, gesorteerd op datum+starttijd).

- [ ] **Step 1: Bevestig de exacte respons-vorm van `/api/afspraken` en `/api/klantbeschikbaarheid`**

  Lees `netlify/functions/afspraken.js` en `netlify/functions/klantbeschikbaarheid.js` volledig (hun GET-handlers) om te bevestigen:
  - onder welke sleutel `afspraken.js` de array van lokale afspraken teruggeeft (bv. `items`, `afspraken`, iets anders — pas Step 2 hieronder aan op wat je werkelijk aantreft), en of elk item de velden `id`/`titel`/`datum`/`uur`/`einduur`/`type`/`persoon`/`adres`/`notitie` heeft zoals het datamodel in `CLAUDE.md`/`ONBOARDING.md` beschrijft.
  - onder welke sleutel `klantbeschikbaarheid.js` zijn data teruggeeft, en of `duurOverride` per ticket-ID daarin zit zoals verwacht (`{ [ticketId]: { duurOverride, ... } }`).

- [ ] **Step 2: Voeg de klantbeschikbaarheid-duur-override toe aan de Zoho-mapping**

  In `netlify/functions/planning-export.js`, voeg vóór de `geplandeTickets.map(...)`-aanroep uit Task 1 een zelf-fetch naar klantbeschikbaarheid toe, en gebruik de override waar aanwezig:

  ```js
      const kbRes = await fetch(`${url}/api/klantbeschikbaarheid`);
      const kbData = kbRes.ok ? await kbRes.json().catch(() => ({})) : {};
      // Pas de sleutel hieronder aan op wat Step 1 werkelijk aantrof (bv. kbData.items of kbData zelf).
      const kbPerTicket = kbData.items || kbData || {};

      const duurVoor = (ticketId) => {
        const override = kbPerTicket[ticketId]?.duurOverride;
        return (typeof override === 'number' && override > 0) ? override : DEFAULT_DUUR_MIN;
      };
  ```

  Vervang in de mapping uit Task 1 Step 3 de regel
  ```js
          const eindMin = dt.getHours() * 60 + dt.getMinutes() + DEFAULT_DUUR_MIN;
  ```
  door
  ```js
          const eindMin = dt.getHours() * 60 + dt.getMinutes() + duurVoor(t.id);
  ```

  Als de klantbeschikbaarheid-aanroep faalt (netwerkfout, niet gevonden), mag dat de hele export niet laten falen — vandaar de `kbRes.ok ? ... : {}`-guard hierboven; ontbrekende overrides vallen gewoon terug op `DEFAULT_DUUR_MIN`.

- [ ] **Step 3: Voeg de handmatige afspraken toe en voeg samen met de Zoho-items**

  Na de `kbRes`-fetch (of na de tickets-fetch, volgorde maakt niet uit), voeg toe:

  ```js
      const afsprakenRes = await fetch(`${url}/api/afspraken`);
      if (!afsprakenRes.ok) {
        const errBody = await afsprakenRes.json().catch(() => ({}));
        throw new Error(`Afspraken ophalen mislukt (${afsprakenRes.status}): ${JSON.stringify(errBody)}`);
      }
      const afsprakenData = await afsprakenRes.json();
      // Pas de sleutel hieronder aan op wat Step 1 werkelijk aantrof.
      const lokaleAfspraken = afsprakenData.items || afsprakenData.afspraken || [];

      const lokaleItems = lokaleAfspraken
        .filter(ev => ev.datum && new Date(ev.datum + 'T00:00:00') >= gisteren)
        .map(ev => ({
          id: ev.id,
          bron: 'handmatig',
          ticketnummer: null,
          type: ev.type || null,
          datum: ev.datum,
          starttijd: ev.uur || null,
          eindtijd: ev.einduur || null,
          technieker: ev.persoon || null,
          klant: ev.notitie || null,
          adres: ev.adres || null,
          omschrijving: ev.titel || null,
          status: 'gepland',
        }));
  ```

  Vervang de `items.sort(...)`/`return`-instructies uit Task 1 Step 3 door:
  ```js
      const alleItems = [...items, ...lokaleItems];
      alleItems.sort((a, b) => (a.datum + (a.starttijd || '')).localeCompare(b.datum + (b.starttijd || '')));

      return { statusCode: 200, headers, body: JSON.stringify(alleItems) };
  ```

- [ ] **Step 4: Verifieer lokaal — volledige respons**

  ```bash
  node dev-server.mjs &
  curl -s -H "Authorization: Bearer <jouw-sleutel>" http://localhost:3333/api/planning-export | python3 -m json.tool | head -80
  ```
  (of een gelijkaardige JSON-pretty-printer — zolang je de volledige, leesbare array kan nakijken). Controleer:
  - minstens één item met `"bron": "zoho"` en de correcte velden voor ticket #3731 (indien gepland).
  - als er een lokale afspraak/installatie in de eerstkomende dagen staat: een item met `"bron": "handmatig"` met de juiste `datum`/`starttijd`/`eindtijd`.
  - de lijst is gesorteerd op datum, dan starttijd.
  - een ticket zonder ingevulde interventiedatum (uit de "te plannen"-wachtrij) verschijnt NIET in de lijst.

- [ ] **Step 5: Documenteer het nieuwe endpoint in ONBOARDING.md**

  Voeg in de sectie "Netlify Functions overzicht" een rij toe voor `planning-export.js` (classic stijl, doel: "read-only export van geplande activiteit voor externe koppelingen (Base44), beveiligd met `PLANNING_EXPORT_API_KEY`"). Voeg in "Openstaande punten" of een nieuwe sectie een korte vermelding toe dat dit endpoint nu bestaat, met een link naar de spec, en dat de collega's Base44-app dit elke 3-5 minuten moet bevragen met de gedeelde sleutel (die apart, buiten git, met hem gedeeld moet worden — niet in `.env.local.example`).

- [ ] **Step 6: Commit**

  ```bash
  git add netlify/functions/planning-export.js ONBOARDING.md
  git commit -m "feat: planning-export voegt handmatige afspraken en duur-overrides samen"
  ```

---

## Self-Review (door de planschrijver zelf uitgevoerd)

**Spec-dekking:** alle onderdelen van de spec komen terug — auth (Task 1 Step 2), Zoho-filtering+mapping (Task 1 Step 3), reikwijdte "vanaf gisteren" (Task 1 Step 3, Task 2 Step 3), handmatige afspraken (Task 2 Step 3), duur-override (Task 2 Step 2), foutafhandeling 401/500/lege-200 (Task 1 Step 2-3), weggelaten velden (`btw_regime` e.d. komen nergens in de mapping voor — bewust). Documentatie (Task 2 Step 5) dekt de "gedeelde sleutel apart communiceren"-vereiste uit de spec.

**Placeholder-scan:** geen "TBD"/"later" gevonden; de twee "pas aan op wat je werkelijk aantreft"-instructies (Task 2 Step 1) zijn bewuste, expliciete discovery-stappen — zelfde patroon als in de bugfix-roadmap gebruikt voor onzekere externe respons-vormen (bv. Task 25's TomTom-verificatie), niet een placeholder voor ontbrekende code.

**Type-consistentie:** `checkAuth`/`baseUrl` (Task 1) worden in Task 2 niet opnieuw gedefinieerd, enkel gebruikt. `duurVoor(ticketId)` (Task 2 Step 2) gebruikt exact `t.id` zoals gedefinieerd in Task 1's mapping. Het item-schema (`id`/`bron`/`ticketnummer`/`type`/`datum`/`starttijd`/`eindtijd`/`technieker`/`klant`/`adres`/`omschrijving`/`status`) is identiek tussen de Zoho-mapping (Task 1) en de lokale-afspraken-mapping (Task 2) — geen veldnaam-drift.
