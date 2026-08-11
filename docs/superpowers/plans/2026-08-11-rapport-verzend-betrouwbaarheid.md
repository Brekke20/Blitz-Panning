# Betrouwbare rapport-verzending (outbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zorg dat een service-rapport bij het afsluiten (`printRapport()`) nooit meer stil verloren gaat op mobiel, door het lokaal te bufferen en automatisch te herhalen tot bevestigd, met een blijvend zichtbaar signaal en een server-side foutenlog.

**Architecture:** Een IndexedDB-"outbox" op de client bewaart elk rapport vanaf het moment van klikken tot het bevestigd bewaard is (en, indien van toepassing, doorgestuurd naar Zoho). Eén gedeelde functie voert de nog-ontbrekende stappen uit en wordt zowel direct na het klikken (met een kort tijdsvenster) als bij elke herhaling (bij opstarten, terug-online, terug-zichtbaar) aangeroepen. De server krijgt een klein uitbreiding (een `zohoUploaded`-vlag + lookup-by-id) om een dubbele Zoho-bijlage te voorkomen, en een nieuwe, aparte functie voor het foutenlogboek.

**Tech Stack:** Vanilla JS in `public/index.html` (geen build-stap, geen framework — bestaand patroon), IndexedDB (browser-native), Netlify Functions v2-stijl (`export default async (req) => new Response(...)`), `@netlify/blobs` met store `blitz-data`.

## Global Constraints

- Geen nieuwe dependencies, geen build-tooling — dit blijft één HTML-bestand + losse Netlify functions, zoals de rest van het project.
- Geen `localStorage` voor de outbox — payloads met ingebedde foto's kunnen enkele MB's zijn; gebruik IndexedDB.
- Wachtrij-items mogen **nooit** stilletjes verdwijnen na X mislukte pogingen — enkel verwijderen na bevestigd succes.
- De Zoho-PDF-upload (`/api/rapport`) mag nooit tweemaal dezelfde bijlage aanmaken bij een herhaalde poging — altijd eerst server-side checken via het nieuwe `zohoUploaded`-veld vóór een herhaalde upload.
- Elke mislukte stap wordt naar `/api/client-log` gelogd, maar het loggen zelf is best-effort (falen daarvan wordt genegeerd, geen eigen retry).
- Scope is uitsluitend het moment van rapport-afsluiten in `printRapport()` — foto-uploads en alle andere server-calls blijven ongewijzigd.

---

### Task 1: Backend — `rapport-archief.js` uitbreiden met `zohoUploaded` + lookup-by-id

**Files:**
- Modify: `netlify/functions/rapport-archief.js:32-45` (GET-handler)
- Modify: `netlify/functions/rapport-archief.js:68-86` (entry-constructie)

**Interfaces:**
- Produces: `GET /api/rapport-archief?id=<id>` → `{ versie: number, rapport: object|null }` (nieuw, naast de bestaande `GET /api/rapport-archief` zonder param die ongewijzigd de volledige lijst teruggeeft).
- Produces: elke archief-entry heeft nu een `zohoUploaded: boolean` veld (default `false`, `true` als de POST-body `zohoUploaded: true` meestuurt).

- [ ] **Step 1: GET-handler aanpassen voor optionele `?id=`**

Vervang in `netlify/functions/rapport-archief.js` het bestaande GET-blok:

```js
  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const raw = await store.get(BLOB_KEY, { type: 'json' });
      return new Response(JSON.stringify(raw ?? EMPTY), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify(EMPTY), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
  }
```

door:

```js
  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id');
    try {
      const raw = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY;
      if (id) {
        const rapport = raw.rapports.find(r => r.id === id) || null;
        return new Response(JSON.stringify({ versie: raw.versie, rapport }), {
          status: 200,
          headers: { ...hdrs, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(raw), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    } catch {
      const fallback = id ? { versie: EMPTY.versie, rapport: null } : EMPTY;
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
  }
```

- [ ] **Step 2: `zohoUploaded`-veld toevoegen aan de entry-constructie**

Vervang het bestaande `entry`-object:

```js
    const entry = {
      id:              String(body.id || crypto.randomUUID()),
      datum:           String(body.datum           || ''),
      aangemaakt:      new Date().toISOString(),
      technieker:      String(body.technieker       || ''),
      ticketId:        String(body.ticketId         || ''),
      ticketNumber:    String(body.ticketNumber     || ''),
      klant:           String(body.klant            || ''),
      adres:           String(body.adres            || ''),
      nieuwInter:      body.nieuwInter === 'ja' ? 'ja' : 'nee',
      hersteld:        body.hersteld   === 'ja' ? 'ja' : 'nee',
      servicetype:     String(body.servicetype      || ''),
      facturatie:      String(body.facturatie       || ''),
      prioriteit:      String(body.prioriteit       || ''),
      interventieType: String(body.interventieType  || 'Interventie'),
      totaalOnderdelen: parseFloat(body.totaalOnderdelen) || 0,
      // Bewaar het volledige R-object om rapport te kunnen hergeneren
      rapportData:     body.rapportData || null,
    };
```

door (enkel `zohoUploaded`-regel toegevoegd):

```js
    const entry = {
      id:              String(body.id || crypto.randomUUID()),
      datum:           String(body.datum           || ''),
      aangemaakt:      new Date().toISOString(),
      technieker:      String(body.technieker       || ''),
      ticketId:        String(body.ticketId         || ''),
      ticketNumber:    String(body.ticketNumber     || ''),
      klant:           String(body.klant            || ''),
      adres:           String(body.adres            || ''),
      nieuwInter:      body.nieuwInter === 'ja' ? 'ja' : 'nee',
      hersteld:        body.hersteld   === 'ja' ? 'ja' : 'nee',
      servicetype:     String(body.servicetype      || ''),
      facturatie:      String(body.facturatie       || ''),
      prioriteit:      String(body.prioriteit       || ''),
      interventieType: String(body.interventieType  || 'Interventie'),
      totaalOnderdelen: parseFloat(body.totaalOnderdelen) || 0,
      zohoUploaded:    body.zohoUploaded === true,
      // Bewaar het volledige R-object om rapport te kunnen hergeneren
      rapportData:     body.rapportData || null,
    };
```

- [ ] **Step 3: Verifiëren met de lokale dev server**

Run:
```bash
node dev-server.mjs
```
In een tweede terminal:
```bash
curl -s -X POST http://localhost:3333/api/rapport-archief \
  -H "Content-Type: application/json" \
  -d '{"id":"test-plan-1","datum":"2026-08-11","ticketId":"1","ticketNumber":"1"}' | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d)))"

curl -s "http://localhost:3333/api/rapport-archief?id=test-plan-1" | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d)))"

curl -s -X POST http://localhost:3333/api/rapport-archief \
  -H "Content-Type: application/json" \
  -d '{"id":"test-plan-1","datum":"2026-08-11","ticketId":"1","ticketNumber":"1","zohoUploaded":true}' | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d)))"

curl -s "http://localhost:3333/api/rapport-archief?id=test-plan-1" | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d)))"

curl -s "http://localhost:3333/api/rapport-archief?id=bestaat-niet" | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d)))"
```
Expected: eerste `?id=`-call toont `"zohoUploaded":false`, derde POST met `zohoUploaded:true` slaagt, vierde call toont `"zohoUploaded":true`, vijfde call (`bestaat-niet`) toont `{"versie":...,"rapport":null}`. `GET /api/rapport-archief` zonder `?id=` moet nog steeds de volledige `{"versie":...,"rapports":[...]}`-vorm teruggeven (ongewijzigd gedrag).

- [ ] **Step 4: Testrapport opruimen en committen**

```bash
curl -s -X DELETE http://localhost:3333/api/rapport-archief -H "Content-Type: application/json" -d '{"id":"test-plan-1"}'
git add netlify/functions/rapport-archief.js
git commit -m "feat: zohoUploaded-veld en lookup-by-id op rapport-archief"
```

---

### Task 2: Backend — nieuwe functie `client-log.js`

**Files:**
- Create: `netlify/functions/client-log.js`

**Interfaces:**
- Produces: `POST /api/client-log` body `{ ticketId?, ticketNumber?, stap, fout, poging? }` → `{ ok: true }`.
- Produces: `GET /api/client-log` → `{ fouten: [ { tijdstip, ticketId, ticketNumber, stap, fout, poging } ] }`, nieuwste eerst, max 500.

- [ ] **Step 1: Functie aanmaken**

```js
// /api/client-log
// GET  → volledige lijst van client-side fouten (enkel voor handmatige inspectie)
// POST → nieuwe foutregel toevoegen (open, geen auth) — puur diagnostisch,
//         dit endpoint mag zelf nooit een reden zijn om een rapport te blokkeren.

import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'foutenlog';
const MAX_ENTRIES = 500;
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];
const EMPTY = { fouten: [] };

function corsHeaders(req) {
  const origin  = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default async (req, context) => {
  const hdrs = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  if (req.method === 'GET') {
    try {
      const raw = await store.get(BLOB_KEY, { type: 'json' });
      return new Response(JSON.stringify(raw ?? EMPTY), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify(EMPTY), {
        status: 200,
        headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' } }); }

    let current;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch { current = EMPTY; }

    const entry = {
      tijdstip:     new Date().toISOString(),
      ticketId:     String(body.ticketId     || ''),
      ticketNumber: String(body.ticketNumber || ''),
      stap:         String(body.stap         || ''),
      fout:         String(body.fout         || '').slice(0, 500),
      poging:       parseInt(body.poging) || 1,
    };

    const nieuw = { fouten: [entry, ...current.fouten].slice(0, MAX_ENTRIES) };
    try { await store.setJSON(BLOB_KEY, nieuw); }
    catch { /* diagnostisch, best-effort — falen hier mag genegeerd worden */ }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...hdrs, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405, headers: hdrs });
};

export const config = { path: '/api/client-log' };
```

- [ ] **Step 2: Verifiëren met de lokale dev server**

Run (dev server moet nog draaien uit Task 1):
```bash
curl -s -X POST http://localhost:3333/api/client-log \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"1","ticketNumber":"1","stap":"archiveren","fout":"test-fout","poging":1}' | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d)))"

curl -s http://localhost:3333/api/client-log | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d)))"
```
Expected: eerste call `{"ok":true}`, tweede call toont `fouten`-array met de net toegevoegde regel als eerste element.

- [ ] **Step 3: Committen**

```bash
git add netlify/functions/client-log.js
git commit -m "feat: nieuwe client-log functie voor diagnostisch foutenlogboek"
```

---

### Task 3: Client — pure beslissingsfunctie + IndexedDB-outbox helpers

**Files:**
- Modify: `public/index.html` — nieuwe sectie toevoegen na de bestaande `_fotoState`-declaratie op regel 5185.

**Interfaces:**
- Produces: `nextOutboxAction(item)` → `'archive' | 'check-zoho' | 'done'` (pure functie, geen I/O).
- Produces: `outboxAdd(item)`, `outboxPut(item)`, `outboxGetAll()`, `outboxRemove(id)` — alle `Promise`-gebaseerd, werken op IndexedDB-store `items` in database `blitz-rapport-outbox`.
- Consumes: niets van eerdere taken.

- [ ] **Step 1: Pure functie eerst apart verifiëren (buiten de grote HTML-file)**

Maak een tijdelijk scratch-bestand `scratch-nextOutboxAction.mjs` (niet in de repo, gewoon lokaal om de logica te verifiëren vóór je ze in `index.html` plakt):

```js
function nextOutboxAction(item) {
  if (!item.archived) return 'archive';
  if (item.isLocal)   return 'done';
  if (!item.zohoUploaded) return 'check-zoho';
  return 'done';
}

const cases = [
  [{ archived: false, isLocal: false, zohoUploaded: false }, 'archive'],
  [{ archived: false, isLocal: true,  zohoUploaded: false }, 'archive'],
  [{ archived: true,  isLocal: true,  zohoUploaded: false }, 'done'],
  [{ archived: true,  isLocal: false, zohoUploaded: false }, 'check-zoho'],
  [{ archived: true,  isLocal: false, zohoUploaded: true  }, 'done'],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = nextOutboxAction(input);
  if (got !== expected) {
    failed++;
    console.error('FAIL', JSON.stringify(input), 'expected', expected, 'got', got);
  }
}
console.log(failed === 0 ? `OK — alle ${cases.length} gevallen kloppen` : `${failed} van ${cases.length} gevallen FOUT`);
```

- [ ] **Step 2: Scratch-script runnen**

Run:
```bash
node scratch-nextOutboxAction.mjs
```
Expected: `OK — alle 5 gevallen kloppen`

- [ ] **Step 3: Scratch-bestand verwijderen (logica is gecontroleerd, mag niet in de repo blijven)**

```bash
rm scratch-nextOutboxAction.mjs
```

- [ ] **Step 4: De gecontroleerde functie + IndexedDB-helpers toevoegen aan `public/index.html`**

Zoek in `public/index.html`:

```js
let _fotoState = { ticketId: null, versie: 0, fotos: [] };
```

Voeg er onmiddellijk na toe (nieuwe sectie):

```js
let _fotoState = { ticketId: null, versie: 0, fotos: [] };

// ══════════════════════════════════════════════
// RAPPORT VERZEND-WACHTRIJ (OUTBOX)
// ══════════════════════════════════════════════
const OUTBOX_DB_NAME    = 'blitz-rapport-outbox';
const OUTBOX_DB_VERSION = 1;
const OUTBOX_STORE      = 'items';
let _outboxItems = [];

function outboxOpenDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OUTBOX_DB_NAME, OUTBOX_DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function outboxAdd(item) {
  const db = await outboxOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

const outboxPut = outboxAdd; // put() op een keyPath-store is ook een upsert

async function outboxGetAll() {
  const db = await outboxOpenDb();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(OUTBOX_STORE, 'readonly');
    const req = tx.objectStore(OUTBOX_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function outboxRemove(id) {
  const db = await outboxOpenDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    tx.objectStore(OUTBOX_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

// Pure functie — geen I/O — bepaalt welke stap van een wachtrij-item nog moet gebeuren.
function nextOutboxAction(item) {
  if (!item.archived) return 'archive';
  if (item.isLocal)   return 'done';
  if (!item.zohoUploaded) return 'check-zoho';
  return 'done';
}
```

- [ ] **Step 5: Handmatig verifiëren in de browserconsole**

Run:
```bash
node dev-server.mjs
```
Open `http://localhost:3333` in een browser, open de devtools-console, en voer uit:
```js
await outboxAdd({ id: 'devtest-1', archived: false, isLocal: false, zohoUploaded: false });
console.log(await outboxGetAll());          // moet 1 item tonen met id 'devtest-1'
console.log(nextOutboxAction({ archived: false, isLocal: false, zohoUploaded: false })); // 'archive'
await outboxRemove('devtest-1');
console.log(await outboxGetAll());          // moet [] tonen
```
Expected: geen console-errors, uitkomsten exact zoals hierboven aangegeven.

- [ ] **Step 6: Committen**

```bash
git add public/index.html
git commit -m "feat: IndexedDB-outbox helpers en nextOutboxAction voor rapport-verzending"
```

---

### Task 4: Client — blijvend "wachtrij"-signaal (banner) in de UI

**Files:**
- Modify: `public/index.html:1259` (HTML, naast `#offline-banner`)
- Modify: `public/index.html:856` (CSS, naast `#offline-banner`-stijl)

**Interfaces:**
- Consumes: `_outboxItems` (array, van Task 3), `outboxGetAll()`.
- Produces: `refreshOutboxCache()` (async, herleest IndexedDB in `_outboxItems` en rendert de banner), `renderOutboxBanner()` (synchrone render, leest enkel `_outboxItems`). Latere taken roepen `refreshOutboxCache()` aan na elke wijziging aan de wachtrij.

- [ ] **Step 1: HTML-banner toevoegen**

Zoek:
```html
<div id="offline-banner">📶 Geen internetverbinding — wijzigingen worden niet opgeslagen in Zoho</div>
```

Voeg er onmiddellijk na toe:
```html
<div id="offline-banner">📶 Geen internetverbinding — wijzigingen worden niet opgeslagen in Zoho</div>

<div id="outbox-banner" onclick="flushOutbox()"></div>
```

- [ ] **Step 2: CSS toevoegen**

Zoek:
```css
    /* ── Offline banner ── */
    #offline-banner {
      display: none; align-items: center; gap: 8px;
      background: var(--orange-dim); border-bottom: 1px solid rgba(245,158,11,0.3);
      padding: 7px 14px; font-size: 0.78rem; color: var(--orange);
      position: sticky; top: 92px; z-index: 27;
    }
```

Voeg er onmiddellijk na toe:
```css
    /* ── Offline banner ── */
    #offline-banner {
      display: none; align-items: center; gap: 8px;
      background: var(--orange-dim); border-bottom: 1px solid rgba(245,158,11,0.3);
      padding: 7px 14px; font-size: 0.78rem; color: var(--orange);
      position: sticky; top: 92px; z-index: 27;
    }

    /* ── Outbox banner (rapport nog niet bevestigd verzonden) ── */
    #outbox-banner {
      display: none; align-items: center; gap: 8px;
      background: var(--accent-dim); border-bottom: 1px solid rgba(0,223,163,0.3);
      padding: 7px 14px; font-size: 0.78rem; color: var(--accent);
      position: sticky; top: 92px; z-index: 27; cursor: pointer;
    }
```

- [ ] **Step 3: Render-functies toevoegen**

Zoek (toegevoegd in Task 3, direct na `nextOutboxAction`):
```js
// Pure functie — geen I/O — bepaalt welke stap van een wachtrij-item nog moet gebeuren.
function nextOutboxAction(item) {
  if (!item.archived) return 'archive';
  if (item.isLocal)   return 'done';
  if (!item.zohoUploaded) return 'check-zoho';
  return 'done';
}
```

Voeg er onmiddellijk na toe:
```js
// Pure functie — geen I/O — bepaalt welke stap van een wachtrij-item nog moet gebeuren.
function nextOutboxAction(item) {
  if (!item.archived) return 'archive';
  if (item.isLocal)   return 'done';
  if (!item.zohoUploaded) return 'check-zoho';
  return 'done';
}

async function refreshOutboxCache() {
  _outboxItems = await outboxGetAll();
  renderOutboxBanner();
}

function renderOutboxBanner() {
  const banner = document.getElementById('outbox-banner');
  if (!_outboxItems.length) { banner.style.display = 'none'; return; }
  const offlineBanner  = document.getElementById('offline-banner');
  const offlineVisible = offlineBanner && getComputedStyle(offlineBanner).display !== 'none';
  banner.style.top = offlineVisible ? `${92 + offlineBanner.offsetHeight}px` : '92px';
  banner.textContent = _outboxItems.length === 1
    ? '⏳ 1 rapport nog niet bevestigd — wordt automatisch opnieuw geprobeerd (tik om nu te proberen)'
    : `⏳ ${_outboxItems.length} rapporten nog niet bevestigd — wordt automatisch opnieuw geprobeerd (tik om nu te proberen)`;
  banner.style.display = 'flex';
}
```

- [ ] **Step 4: Handmatig verifiëren in de browserconsole**

Run:
```bash
node dev-server.mjs
```
Open `http://localhost:3333`, devtools-console:
```js
await outboxAdd({ id: 'devtest-2', archived: false, isLocal: false, zohoUploaded: false });
await refreshOutboxCache();
// Controleer visueel: banner "⏳ 1 rapport nog niet bevestigd..." verschijnt bovenaan.
await outboxRemove('devtest-2');
await refreshOutboxCache();
// Controleer visueel: banner verdwijnt weer.
```
Expected: banner verschijnt/verdwijnt precies zoals beschreven, geen console-errors, geen overlap met de offline-banner (test dit ook met de browser offline gezet via devtools Network-tab, met een outbox-item toegevoegd: beide banners moeten na elkaar zichtbaar zijn, niet overlappend).

- [ ] **Step 5: Committen**

```bash
git add public/index.html
git commit -m "feat: blijvend wachtrij-signaal (outbox-banner) in de UI"
```

---

### Task 5: Client — `attemptOutboxItem()` en foutenlog-koppeling

**Files:**
- Modify: `public/index.html` — nieuwe functies toevoegen direct na `renderOutboxBanner()` (Task 4).

**Interfaces:**
- Consumes: `nextOutboxAction`, `outboxPut`, `outboxRemove` (Task 3); `/api/rapport-archief`, `/api/rapport`, `/api/client-log` (Task 1/2).
- Produces: `attemptOutboxItem(item)` (async, muteert en persisteert `item`, retourneert het bijgewerkte item), `logOutboxFailure(item, stap, fout)` (async, best-effort).

- [ ] **Step 1: Functies toevoegen**

Zoek (einde van Task 4's toevoeging):
```js
  banner.textContent = _outboxItems.length === 1
    ? '⏳ 1 rapport nog niet bevestigd — wordt automatisch opnieuw geprobeerd (tik om nu te proberen)'
    : `⏳ ${_outboxItems.length} rapporten nog niet bevestigd — wordt automatisch opnieuw geprobeerd (tik om nu te proberen)`;
  banner.style.display = 'flex';
}
```

Voeg er onmiddellijk na toe:
```js
  banner.textContent = _outboxItems.length === 1
    ? '⏳ 1 rapport nog niet bevestigd — wordt automatisch opnieuw geprobeerd (tik om nu te proberen)'
    : `⏳ ${_outboxItems.length} rapporten nog niet bevestigd — wordt automatisch opnieuw geprobeerd (tik om nu te proberen)`;
  banner.style.display = 'flex';
}

async function logOutboxFailure(item, stap, fout) {
  item.attempts  = (item.attempts || 0) + 1;
  item.lastError = fout;
  try { await outboxPut(item); } catch { /* best-effort */ }
  try {
    await fetch('/api/client-log', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ticketId:     item.ticket?.id     || '',
        ticketNumber: item.ticket?.number || '',
        stap,
        fout,
        poging: item.attempts,
      }),
    });
  } catch { /* diagnostisch, best-effort — falen hier mag genegeerd worden */ }
}

async function attemptOutboxItem(item) {
  const action = nextOutboxAction(item);

  if (action === 'archive') {
    try {
      const res  = await fetch('/api/rapport-archief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...item.archiveBody, id: item.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || String(res.status));
      item.archived = true;
      await outboxPut(item);
      // Houd de globale archief-versie synchroon — verwijderRapport()/verstuurRapport()
      // gebruiken _archiefVersie voor hun eigen optimistic-lock en zouden anders een
      // vals-positief conflict kunnen krijgen na een outbox-archivering.
      if (typeof data.versie === 'number') _archiefVersie = data.versie;
    } catch (err) {
      await logOutboxFailure(item, 'archiveren', err.message);
      return item;
    }
    return attemptOutboxItem(item);
  }

  if (action === 'check-zoho') {
    let alreadyDone = false;
    try {
      const res  = await fetch(`/api/rapport-archief?id=${encodeURIComponent(item.id)}`);
      const data = await res.json();
      alreadyDone = data?.rapport?.zohoUploaded === true;
    } catch { /* check mislukt — probeer de upload gewoon, geen erg bij een extra check-poging later */ }

    if (alreadyDone) {
      item.zohoUploaded = true;
      await outboxPut(item);
      return attemptOutboxItem(item);
    }

    try {
      const res  = await fetch('/api/rapport', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ html: item.html, ticketId: item.ticket.id, filename: item.ticket.filename }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload mislukt');

      const confirmRes  = await fetch('/api/rapport-archief', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...item.archiveBody, id: item.id, zohoUploaded: true }),
      });
      const confirmData = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) throw new Error('Bevestigen van Zoho-upload in archief mislukt');
      if (typeof confirmData.versie === 'number') _archiefVersie = confirmData.versie;

      item.zohoUploaded = true;
      await outboxPut(item);
    } catch (err) {
      await logOutboxFailure(item, 'zoho-upload', err.message);
      return item;
    }
    return attemptOutboxItem(item);
  }

  // action === 'done'
  await outboxRemove(item.id);
  return item;
}
```

- [ ] **Step 2: Handmatig verifiëren — succesvol pad**

Run (dev server draait al):
```bash
node dev-server.mjs
```
Browserconsole op `http://localhost:3333`:
```js
const item = {
  id: 'devtest-3', archived: false, isLocal: true, zohoUploaded: false, attempts: 0,
  html: '<html>test</html>',
  ticket: { id: '', number: '', filename: 'test.pdf' },
  archiveBody: { datum: '2026-08-11', technieker: 'Test', ticketId: '', ticketNumber: '', klant: 'Test', adres: '', nieuwInter: 'nee', hersteld: 'ja', servicetype: '2e-lijn', facturatie: 'klant', prioriteit: '', interventieType: 'Interventie', totaalOnderdelen: 0, rapportData: {} },
};
await outboxAdd(item);
await attemptOutboxItem(item);
console.log(await outboxGetAll()); // moet [] tonen — isLocal, dus enkel archiveren nodig, direct 'done'
```
Expected: lege array (item volledig afgehandeld en verwijderd uit de wachtrij), geen console-errors.
Controleer ook: `curl -s "http://localhost:3333/api/rapport-archief?id=devtest-3"` toont de zonet aangemaakte entry.

- [ ] **Step 3: Handmatig verifiëren — mislukt pad + foutenlog**

Browserconsole (dev server nog draaiend, maar simuleer een netwerkfout door een niet-bestaand pad aan te roepen — makkelijkste manier: zet de Network-tab op "Offline" in devtools):
```js
const item2 = {
  id: 'devtest-4', archived: false, isLocal: true, zohoUploaded: false, attempts: 0,
  html: '<html>test</html>',
  ticket: { id: '', number: '', filename: 'test.pdf' },
  archiveBody: { datum: '2026-08-11', technieker: 'Test', ticketId: '', ticketNumber: '', klant: 'Test', adres: '', nieuwInter: 'nee', hersteld: 'ja', servicetype: '2e-lijn', facturatie: 'klant', prioriteit: '', interventieType: 'Interventie', totaalOnderdelen: 0, rapportData: {} },
};
await outboxAdd(item2);
await attemptOutboxItem(item2);
console.log(await outboxGetAll()); // moet nog steeds 1 item tonen (devtest-4), met attempts:1 en lastError gezet
```
Zet Network-tab terug "Online", en check:
```bash
curl -s http://localhost:3333/api/client-log | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d)))"
```
Expected: item blijft in de wachtrij staan met `attempts: 1` en een `lastError`, en er staat een nieuwe regel met `stap: "archiveren"` in het foutenlogboek.

- [ ] **Step 4: Testdata opruimen**

```bash
curl -s -X DELETE http://localhost:3333/api/rapport-archief -H "Content-Type: application/json" -d '{"id":"devtest-3"}'
```
Browserconsole: `await outboxRemove('devtest-4');`

- [ ] **Step 5: Committen**

```bash
git add public/index.html
git commit -m "feat: attemptOutboxItem met dubbele-Zoho-bijlage-preventie en foutenlog"
```

---

### Task 6: Client — `printRapport()` herschrijven, `flushOutbox()` bedraden, wachtrij-tag in Rapporten-lijst

**Files:**
- Modify: `public/index.html:6289-6317` (`printRapport()`)
- Modify: `public/index.html:6319-6372` (oude `archiveerRapport()` + `uploadRapportToZoho()` — verwijderen)
- Modify: `public/index.html:1899` (DOMContentLoaded — `flushOutbox`-triggers toevoegen)
- Modify: `public/index.html` rond regel 6477-6495 (`renderRapportArchief()` rij-template — wachtrij-tag toevoegen)

**Interfaces:**
- Consumes: `outboxAdd`, `attemptOutboxItem`, `refreshOutboxCache`, `_outboxItems` (Tasks 3-5).
- Produces: `flushOutbox()` (async, probeert alle openstaande wachtrij-items opnieuw).

- [ ] **Step 1: `printRapport()` en de oude upload-functies vervangen**

Zoek het volledige blok:
```js
function printRapport() {
  const html    = buildRapportHtml();
  const blob    = new Blob([html], { type: 'text/html; charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const win     = window.open(blobUrl, '_blank');
  if (!win) {
    URL.revokeObjectURL(blobUrl);
    return toast('Pop-upblokkering actief — sta pop-ups toe voor deze pagina');
  }
  // Revoke na 2 min — genoeg tijd om te printen
  setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);

  // Upload en archiveer slechts één keer per wizard-sessie (guard tegen dubbele uploads)
  if (!_rapportUploaded) {
    _rapportUploaded = true;
    if (_wizTicket.isLocal) {
      // Geen Zoho-ticket gekoppeld aan manuele/geïmporteerde afspraken — enkel archiveren.
      archiveerRapport(html);
      toast('✅ Rapport opgeslagen in archief — geen Zoho-ticket gekoppeld', 4000);
    } else {
      const rapportFilename = `rapport-${_wizTicket.number || _wizTicket.id}-${R.datum || 'onbekend'}.pdf`;
      uploadRapportToZoho(html, _wizTicket.id, rapportFilename);
      archiveerRapport(html);
    }
  }

  // Wizard sluiten na geslaagd rapport — geen bevestigingsdialoog meer nodig
  document.getElementById('rapport-wizard').classList.remove('open');
}

async function archiveerRapport(html) {
  const totaal = R.onderdelen
    .filter(p => p.naam && p.factureren !== false)
    .reduce((s, p) => s + (parseFloat(p.prijs) || 0) * (parseInt(p.aantal) || 1), 0);

  try {
    const res = await fetch('/api/rapport-archief', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        versie:          _archiefVersie,
        datum:           R.datum,
        technieker:      R.technieker,
        ticketId:        _wizTicket.id   || '',
        ticketNumber:    _wizTicket.number ? String(_wizTicket.number) : '',
        klant:           _wizTicket.contact || _wizTicket.account || '',
        adres:           R.adres,
        nieuwInter:      R.nieuwInter,
        hersteld:        R.hersteld,
        servicetype:     R.servicetype,
        facturatie:      R.facturatie,
        prioriteit:      _wizTicket.priority || '',
        interventieType: R.interventieType || 'Interventie',
        totaalOnderdelen: totaal,
        rapportData:     { ...R, _html: html }, // bewaar voor hergen
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast('⚠️ Rapport niet gearchiveerd: ' + (data.error || res.status), 5000);
      return;
    }
    if (typeof data.versie === 'number') _archiefVersie = data.versie;
  } catch (err) {
    toast('⚠️ Rapport archiveren mislukt (netwerkfout) — controleer het Rapporten-tabblad', 5000);
    console.warn('Rapport archiveren mislukt:', err);
  }
}

async function uploadRapportToZoho(html, ticketId, filename) {
  toast('📤 Rapport uploaden naar Zoho…');
  try {
    const res = await fetch('/api/rapport', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ html, ticketId, filename }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload mislukt');
    toast('✅ Rapport opgeslagen als bijlage in Zoho');
  } catch (err) {
    toast('⚠️ Zoho upload mislukt: ' + err.message);
  }
}
```

Vervang door:
```js
async function printRapport() {
  const html    = buildRapportHtml();
  const blob    = new Blob([html], { type: 'text/html; charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);

  // Wachtrij-item aanmaken en proberen te verzenden vóórdat het afdrukvoorbeeld opent —
  // op mobiel duwt window.open() de tab naar de achtergrond, en dat mocht niet meer
  // gelijktijdig lopen met de niet-afgewachte verzending zoals voorheen (zie design doc
  // 2026-08-11-rapport-verzend-betrouwbaarheid-design.md, "Root cause").
  if (!_rapportUploaded) {
    _rapportUploaded = true;

    const totaal = R.onderdelen
      .filter(p => p.naam && p.factureren !== false)
      .reduce((s, p) => s + (parseFloat(p.prijs) || 0) * (parseInt(p.aantal) || 1), 0);

    const item = {
      id:           crypto.randomUUID(),
      html,
      isLocal:      !!_wizTicket.isLocal,
      archived:     false,
      zohoUploaded: false,
      attempts:     0,
      lastError:    null,
      createdAt:    new Date().toISOString(),
      ticket: {
        id:       _wizTicket.id   || '',
        number:   _wizTicket.number || '',
        filename: `rapport-${_wizTicket.number || _wizTicket.id}-${R.datum || 'onbekend'}.pdf`,
      },
      archiveBody: {
        datum:            R.datum,
        technieker:       R.technieker,
        ticketId:         _wizTicket.id   || '',
        ticketNumber:     _wizTicket.number ? String(_wizTicket.number) : '',
        klant:            _wizTicket.contact || _wizTicket.account || '',
        adres:            R.adres,
        nieuwInter:       R.nieuwInter,
        hersteld:         R.hersteld,
        servicetype:      R.servicetype,
        facturatie:       R.facturatie,
        prioriteit:       _wizTicket.priority || '',
        interventieType:  R.interventieType || 'Interventie',
        totaalOnderdelen: totaal,
        rapportData:      { ...R, _html: html },
        // Geen 'versie' hier — dedup gebeurt server-side op ticketId+datum
        // (rapport-archief.js), zodat opgestapelde wachtrij-items elkaar niet
        // vals-positief als conflict blokkeren.
      },
    };

    await outboxAdd(item);
    await refreshOutboxCache();

    const TIMEOUT_MS = 5000;
    const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), TIMEOUT_MS));
    const result  = await Promise.race([attemptOutboxItem(item), timeout]);

    toast(result === 'timeout'
      ? '⏳ Rapport wordt verstuurd — je kan gewoon verder, dit gebeurt op de achtergrond'
      : (item.isLocal
          ? '✅ Rapport opgeslagen in archief — geen Zoho-ticket gekoppeld'
          : '✅ Rapport bewaard en doorgestuurd naar Zoho'),
      4500);

    await refreshOutboxCache();
    renderRapportArchief();
  }

  const win = window.open(blobUrl, '_blank');
  if (!win) {
    URL.revokeObjectURL(blobUrl);
    toast('Pop-upblokkering actief — sta pop-ups toe voor deze pagina');
  } else {
    // Revoke na 2 min — genoeg tijd om te printen
    setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
  }

  // Wizard sluiten na geslaagd rapport — geen bevestigingsdialoog meer nodig
  document.getElementById('rapport-wizard').classList.remove('open');
}

async function flushOutbox() {
  const items = await outboxGetAll();
  for (const item of items) {
    await attemptOutboxItem(item);
  }
  await refreshOutboxCache();
  renderRapportArchief();
}
```

- [ ] **Step 2: `flushOutbox`-triggers toevoegen aan `DOMContentLoaded`**

Zoek:
```js
  loadTickets();
  laadRapportArchief();
  startTicketPolling();
```

Vervang door:
```js
  loadTickets();
  laadRapportArchief();
  startTicketPolling();
  refreshOutboxCache();
  flushOutbox();
  window.addEventListener('online', flushOutbox);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushOutbox();
  });
```

- [ ] **Step 3: Wachtrij-tag toevoegen in `renderRapportArchief()`**

Zoek binnen `renderRapportArchief()`:
```js
    const nieuw     = (!isInstallatieRapport && r.nieuwInter === 'ja') ? '<span style="color:var(--orange)">🔁 Nieuwe interventie</span>' : '';
```

Voeg er onmiddellijk na toe:
```js
    const nieuw     = (!isInstallatieRapport && r.nieuwInter === 'ja') ? '<span style="color:var(--orange)">🔁 Nieuwe interventie</span>' : '';
    const inWachtrij = _outboxItems.some(o => o.id === r.id)
      ? '<span style="color:var(--accent);font-weight:600">⏳ In wachtrij</span>'
      : '';
```

Zoek in dezelfde functie (de regel die `${hersteld} ${nieuw}` samenvoegt):
```js
          ${hersteld} ${nieuw}
```

Vervang door:
```js
          ${hersteld} ${nieuw} ${inWachtrij}
```

- [ ] **Step 4: Handmatig end-to-end verifiëren — snel-genoeg pad**

Run:
```bash
node dev-server.mjs
```
Open `http://localhost:3333/?test` (TEST_MODE, geen echte Zoho-calls nodig voor dit scenario met een lokale afspraak):
1. Maak een rapport voor een lokale (niet-Zoho) afspraak en klik "Afdrukken/Verzenden".
2. Verwacht: toast "✅ Rapport opgeslagen in archief — geen Zoho-ticket gekoppeld" binnen ~5s, afdrukvoorbeeld opent, geen outbox-banner verschijnt (want direct gelukt).
3. Open het Rapporten-tabblad → het nieuwe rapport staat er, zonder "⏳ In wachtrij"-tag.

- [ ] **Step 5: Handmatig end-to-end verifiëren — traag/mislukt pad**

1. Open devtools → Network-tab → zet op "Offline".
2. Maak opnieuw een rapport aan voor een lokale afspraak en klik "Afdrukken/Verzenden".
3. Verwacht: na ~5s toast "⏳ Rapport wordt verstuurd — je kan gewoon verder..."; afdrukvoorbeeld opent alsnog; de "⏳ N rapport(en) nog niet bevestigd"-banner verschijnt bovenaan.
4. Zet Network-tab terug op "Online".
5. Klik op de outbox-banner (of herlaad de pagina).
6. Verwacht: banner verdwijnt binnen enkele seconden, rapport staat nu in het Rapporten-tabblad zonder "⏳ In wachtrij"-tag.

- [ ] **Step 6: Committen**

```bash
git add public/index.html
git commit -m "feat: printRapport gebruikt de outbox, flushOutbox bedraad, wachtrij-tag in Rapporten"
```

---

### Task 7: Testscript uitbreiden + openstaand testpunt vastleggen

**Files:**
- Modify: `TESTSCRIPT.html` — nieuwe sectie toevoegen.

**Interfaces:**
- Geen — dit is een documentatie/QA-taak, geen productiecode.

- [ ] **Step 1: Nieuwe sectie toevoegen aan `TESTSCRIPT.html`**

Zoek een bestaande `<!-- ─── ITEM N ─── -->`-sectie (bv. de laatste in het bestand) en voeg er, volgens exact hetzelfde patroon, een nieuwe sectie na toe:

```html
<!-- ─── NIEUW: RAPPORT-VERZENDING BETROUWBAARHEID (OUTBOX) ────────── -->
<div class="section" id="s-outbox">
  <div class="section-header" onclick="toggle('outbox')">
    <span class="badge dev">Vereist netlify dev</span>
    <span class="section-title">Nieuw — Rapport-verzending betrouwbaarheid (outbox)</span>
    <span class="section-toggle" id="tog-outbox">▶</span>
  </div>
  <div class="section-body" id="body-outbox">
    <div class="env-req dev">Vereist lokale server: <code>netlify dev</code> of <code>node dev-server.mjs</code></div>
    <div class="setup">
      <strong>Voorbereiding:</strong> Open een ticket (of lokale afspraak) en start de rapport-wizard.
    </div>
    <ul class="steps">
      <li class="step"><span class="step-check" onclick="check(this)"></span><span class="step-text">Doorloop de wizard en klik op "Afdrukken/Verzenden" met een normale verbinding<span class="verwacht">Bevestigingstoast binnen ~5s, geen "⏳ In wachtrij"-banner, rapport staat meteen in het Rapporten-tabblad</span></span></li>
      <li class="step"><span class="step-check" onclick="check(this)"></span><span class="step-text">Zet devtools Network-tab op "Offline", maak een nieuw rapport aan en klik "Afdrukken/Verzenden"<span class="verwacht">Na ~5s toast "wordt verstuurd, je kan gewoon verder"; afdrukvoorbeeld opent alsnog; "⏳ N rapport(en) nog niet bevestigd"-banner verschijnt</span></span></li>
      <li class="step"><span class="step-check" onclick="check(this)"></span><span class="step-text">Zet Network-tab terug "Online" en herlaad de pagina<span class="verwacht">Banner verdwijnt vanzelf binnen enkele seconden, rapport staat nu in het Rapporten-tabblad</span></span></li>
      <li class="step"><span class="step-check" onclick="check(this)"></span><span class="step-text">Herhaal met een Zoho-gekoppeld ticket (niet lokaal) i.p.v. een lokale afspraak<span class="verwacht">Zelfde gedrag, en de PDF-bijlage staat maar één keer op het Zoho-ticket, ook na de offline/online-cyclus</span></span></li>
      <li class="step"><span class="step-check" onclick="check(this)"></span><span class="step-text"><strong>Openstaand — echte telefoon:</strong> verstuur bewust een rapport met wifi/4G uitgeschakeld op een telefoon, en observeer of het signaal en de latere automatische verzending werken<span class="let-op">Dit specifieke achtergrond-gedrag is vanaf een computer niet volledig te simuleren — pas na deze test is het probleem met zekerheid bevestigd opgelost</span></span></li>
    </ul>
    <div class="result-row">
      <button class="result-btn btn-ok"  onclick="setResult('outbox','ok')">✓ OK</button>
      <button class="result-btn btn-nok" onclick="setResult('outbox','nok')">✗ NOK</button>
      <span class="result-label">Markeer dit item</span>
      <span class="result-status" id="res-outbox"></span>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Visueel verifiëren**

Open `TESTSCRIPT.html` rechtstreeks in een browser en klik de nieuwe sectie open.
Expected: sectie plooit open/dicht zoals de andere secties, geen layout-afwijkingen, OK/NOK-knoppen werken.

- [ ] **Step 3: Committen**

```bash
git add TESTSCRIPT.html
git commit -m "test: testscript-sectie voor rapport-verzending betrouwbaarheid (outbox)"
```

---

## Na afronding

Meld aan Brent dat de echte-telefoon-test (Task 7, laatste stap) nog moet gebeuren vóór dit als volledig opgelost beschouwd wordt — dat kan niet vanaf hier gesimuleerd worden.
