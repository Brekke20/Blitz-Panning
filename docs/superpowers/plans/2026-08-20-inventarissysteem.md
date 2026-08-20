# Inventarissysteem (Fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give elke technieker een wagenvoorraad in de app (materiaal + aantal), laat hem die
bijvullen/corrigeren en automatisch laten aftrekken bij een afgerond rapport, en geef de
supervisor een neemlog om manueel in AFAS te boeken — zonder AFAS-integratie, zonder e-mail-
notificaties, en met een minimale, niet-drukke UI (1 nieuwe tab, 2 knoppen).

**Architecture:** Nieuwe Netlify-function `inventaris.js` (zelfde vorm als `availability.js`/
`prijzen.js`: Netlify Blobs, `blitz-data`-store, optimistic locking via `versie`) + een nieuwe
frontend-module `public/js/inventaris.js` die de bestaande persoon-kiezer hergebruikt om te
bepalen of de technieker-wagenvoorraad of de supervisor-log getoond wordt. Cross-module-aanroepen
volgen de bestaande app-conventie: **geen ES-`import`/`export` tussen modules**, enkel
`window.x = x`-bridges (zie `public/js/outbox.js:234-239`, `public/js/prijzen.js:338-368`) — dit
plan volgt exact hetzelfde patroon, geen nieuwe conventie.

**Tech Stack:** Vanilla JS (ES modules via `<script type="module">`, geen bundler), Netlify
Functions v2 (`export default async (req) => new Response(...)`), Netlify Blobs.

**Spec:** [docs/superpowers/specs/2026-08-20-inventarissysteem-design.md](../specs/2026-08-20-inventarissysteem-design.md)
(bouwt verder op de scope in
[docs/superpowers/specs/2026-08-13-roadmap-inventaris-en-verbeteringen-design.md](../specs/2026-08-13-roadmap-inventaris-en-verbeteringen-design.md))

## Global Constraints

- Gebruik ExcelJS niet SheetJS voor Excel-exports — niet van toepassing in dit plan (geen export
  hier), enkel vermeld omdat het in `CLAUDE.md` staat.
- Geen build-stap: browser-native `<script type="module">`, geen bundler, geen TypeScript.
- Netlify Blobs: altijd `getStore({ name: 'blitz-data', consistency: 'strong' })` — nooit een
  andere store-naam of een zwakkere consistency.
- Cross-module-aanroepen tussen `public/js/*.js`-bestanden gebeuren via `window.x = x`
  (bottom-of-file bridge), nooit via ES-`import`/`export` tussen die modules — bestaande
  conventie, zie Architecture hierboven.
- Elke nieuwe modal volgt de bestaande `.overlay`/`.modal`/`.mhdr`/`.mbody`/`.mftr`-structuur
  (zie `public/index.html:328-396`, manueel-modal).
- Elke dynamisch-gegenereerde lijst met klikbare items zonder vaste id's gebruikt
  `data-*`-attributen + `addEventListener`, nooit een inline `onclick="...(id)"` met een
  waarde die uit data komt (zie comment bij `wizVoegCatToe`, `public/js/rapport-wizard.js:690-701`)
  — reden: HTML-entity-decodering vóór JS-compilatie kan een inline string-literal breken.
- Geen geautomatiseerde testsuite in dit project — elke taak wordt handmatig geverifieerd via
  `curl` (backend) en de browser (frontend), via `node dev-server.mjs` (poort 3333) zoals de rest
  van het project.
- Elke afgeronde taak: git commit met een duidelijke, beschrijvende message (geen automatische
  versie-ophoging per taak — dat gebeurt pas als aparte stap bij het afronden van de branch, zie
  `CLAUDE.md` "Versioning & changelog").

---

## Task 1: Backend endpoint `/api/inventaris`

**Files:**
- Create: `netlify/functions/inventaris.js`

**Interfaces:**
- Produces: `GET /api/inventaris` → `{ versie, wagenvoorraad: { [technieker]: { [materiaalId]: aantal } }, log: [{ id, technieker, materiaalId, materiaalNaam, aantal, datum, type: 'aanvulling'|'correctie'|'verbruik', status: 'nieuw'|'verwerkt'|null }] }`.
  `POST /api/inventaris` body `{ versie, technieker, actie: 'mutatie'|'verbruik', items: [{ materiaalId, materiaalNaam, aantal }] }` → zelfde shape als GET (nieuwe versie), of `{ error, serverVersie?, data? }` bij 409/400/503.
  `PATCH /api/inventaris` body `{ versie, id }` → zelfde shape (status van die logregel op `'verwerkt'`), of `{ error, serverVersie?, data? }`.
- Consumes: niets van eerdere taken (eerste taak van dit plan).

- [ ] **Step 1: Schrijf de volledige functie**

Maak `netlify/functions/inventaris.js` met exact deze inhoud:

```js
// /api/inventaris
// GET   → volledige inventarisstaat (wagenvoorraad per technieker + volledige log)
// POST  → mutatie (technieker vult wagenvoorraad bij of corrigeert) of verbruik (automatische
//         aftrek bij een afgerond rapport) — beide muteren wagenvoorraad + loggen een regel
// PATCH → een 'aanvulling'-logregel op status 'verwerkt' zetten (supervisor heeft ze in AFAS geboekt)
import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'inventaris';
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];

const EMPTY = { versie: 0, wagenvoorraad: {}, log: [] };

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(data, status, hdrs) {
  return new Response(JSON.stringify(data), { status, headers: { ...hdrs, 'Content-Type': 'application/json' } });
}

export default async (req) => {
  const hdrs = corsHeaders(req);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const data = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY;
      return json(data, 200, hdrs);
    } catch {
      return json(EMPTY, 200, { ...hdrs, 'X-Source': 'fallback' });
    }
  }

  // ── POST (mutatie of verbruik) ──────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Ongeldige JSON' }, 400, hdrs); }

    const { versie, technieker, actie, items } = body;

    if (typeof versie !== 'number') return json({ error: 'versie is verplicht en moet een getal zijn' }, 400, hdrs);
    if (!technieker || typeof technieker !== 'string') return json({ error: 'technieker is verplicht' }, 400, hdrs);
    if (actie !== 'mutatie' && actie !== 'verbruik') return json({ error: "actie moet 'mutatie' of 'verbruik' zijn" }, 400, hdrs);
    if (!Array.isArray(items) || !items.length) return json({ error: 'items moet een niet-lege array zijn' }, 400, hdrs);
    for (const it of items) {
      if (!it.materiaalId || typeof it.materiaalId !== 'string') return json({ error: 'elk item heeft een materiaalId nodig' }, 400, hdrs);
      if (!it.materiaalNaam || typeof it.materiaalNaam !== 'string') return json({ error: 'elk item heeft een materiaalNaam nodig' }, 400, hdrs);
      if (typeof it.aantal !== 'number' || !Number.isFinite(it.aantal) || it.aantal === 0) return json({ error: `ongeldig aantal voor ${it.materiaalId}` }, 400, hdrs);
    }

    let current;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch { return json({ error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }, 503, hdrs); }

    if (versie !== current.versie) {
      return json({ error: 'Inventaris ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie, data: current }, 409, hdrs);
    }

    const wagenvoorraad = { ...current.wagenvoorraad };
    const stock = { ...(wagenvoorraad[technieker] || {}) };
    const nieuweLogRegels = [];
    const nu = new Date().toISOString();

    for (const it of items) {
      // verbruik: 'aantal' is de gebruikte hoeveelheid (positief) -> wagenvoorraad daalt.
      // mutatie: 'aantal' is al signed (positief = aanvulling, negatief = correctie).
      const delta = actie === 'verbruik' ? -Math.abs(it.aantal) : it.aantal;
      stock[it.materiaalId] = (stock[it.materiaalId] || 0) + delta;

      const type   = actie === 'verbruik' ? 'verbruik' : (delta > 0 ? 'aanvulling' : 'correctie');
      const status = type === 'aanvulling' ? 'nieuw' : null;

      nieuweLogRegels.push({
        id: crypto.randomUUID(),
        technieker,
        materiaalId:   it.materiaalId,
        materiaalNaam: it.materiaalNaam,
        aantal: delta,
        datum: nu,
        type,
        status,
      });
    }

    wagenvoorraad[technieker] = stock;

    const nieuw = {
      versie: current.versie + 1,
      wagenvoorraad,
      log: [...current.log, ...nieuweLogRegels],
    };

    try {
      await store.setJSON(BLOB_KEY, nieuw);
      return json(nieuw, 200, hdrs);
    } catch (err) {
      return json({ error: 'Opslaan mislukt: ' + err.message }, 500, hdrs);
    }
  }

  // ── PATCH (logregel als verwerkt markeren) ──────────────────────────────────
  if (req.method === 'PATCH') {
    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Ongeldige JSON' }, 400, hdrs); }

    const { versie, id } = body;
    if (typeof versie !== 'number') return json({ error: 'versie is verplicht en moet een getal zijn' }, 400, hdrs);
    if (!id || typeof id !== 'string') return json({ error: 'id is verplicht' }, 400, hdrs);

    let current;
    try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
    catch { return json({ error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }, 503, hdrs); }

    if (versie !== current.versie) {
      return json({ error: 'Inventaris ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie, data: current }, 409, hdrs);
    }

    const idx = current.log.findIndex(e => e.id === id);
    if (idx < 0) return json({ error: 'Logregel niet gevonden' }, 404, hdrs);
    if (current.log[idx].type !== 'aanvulling') return json({ error: 'Enkel aanvullingen kunnen als verwerkt gemarkeerd worden' }, 400, hdrs);

    const log = [...current.log];
    log[idx] = { ...log[idx], status: 'verwerkt' };

    const nieuw = { versie: current.versie + 1, wagenvoorraad: current.wagenvoorraad, log };

    try {
      await store.setJSON(BLOB_KEY, nieuw);
      return json(nieuw, 200, hdrs);
    } catch (err) {
      return json({ error: 'Opslaan mislukt: ' + err.message }, 500, hdrs);
    }
  }

  return json({ error: 'Method not allowed' }, 405, hdrs);
};

export const config = { path: '/api/inventaris' };
```

- [ ] **Step 2: Start de lokale dev-server**

Run: `node dev-server.mjs` (achtergrondproces, poort 3333 — vereist een bestaand `.env.local`,
zie `dev-server.mjs` header; de Zoho/TomTom-credentials daarin zijn niet nodig voor deze
endpoint, enkel het bestand moet bestaan).

- [ ] **Step 3: Verifieer GET op een lege staat**

Run: `curl -s http://localhost:3333/api/inventaris`
Expected: `{"versie":0,"wagenvoorraad":{},"log":[]}`

- [ ] **Step 4: Verifieer POST — aanvulling**

Run:
```bash
curl -s -X POST http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":0,"technieker":"Jan Peeters","actie":"mutatie","items":[{"materiaalId":"led","materiaalNaam":"LED","aantal":5}]}'
```
Expected: `versie:1`, `wagenvoorraad["Jan Peeters"].led === 5`, `log` heeft 1 regel met
`type:"aanvulling"`, `status:"nieuw"`, `aantal:5`.

- [ ] **Step 5: Verifieer POST — correctie (negatief aantal)**

Run (versie uit Step 4's respons, hier `1`):
```bash
curl -s -X POST http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":1,"technieker":"Jan Peeters","actie":"mutatie","items":[{"materiaalId":"led","materiaalNaam":"LED","aantal":-1}]}'
```
Expected: `versie:2`, `led` staat nu op `4`, nieuwe logregel `type:"correctie"`, `status:null`,
`aantal:-1`.

- [ ] **Step 6: Verifieer POST — verbruik**

Run (versie `2`):
```bash
curl -s -X POST http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":2,"technieker":"Jan Peeters","actie":"verbruik","items":[{"materiaalId":"led","materiaalNaam":"LED","aantal":2}]}'
```
Expected: `versie:3`, `led` staat op `2`, nieuwe logregel `type:"verbruik"`, `status:null`,
`aantal:-2` (verbruik wordt altijd als negatieve delta gelogd, ook al werd `2` — positief — als
input meegegeven).

- [ ] **Step 7: Verifieer PATCH — verwerkt markeren**

Kopieer het `id` van de `aanvulling`-regel uit Step 4's respons (`_LOG_ID_` hieronder), dan:
```bash
curl -s -X PATCH http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":3,"id":"_LOG_ID_"}'
```
Expected: `versie:4`, die logregel heeft nu `status:"verwerkt"`.

- [ ] **Step 8: Verifieer conflict (409) en validatie (400)**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":0,"technieker":"Jan Peeters","actie":"mutatie","items":[{"materiaalId":"led","materiaalNaam":"LED","aantal":1}]}'
```
Expected: `409` (versie `0` is verlopen, huidige server-versie is `4`).

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":4,"technieker":"Jan Peeters","actie":"mutatie","items":[{"materiaalId":"led","materiaalNaam":"LED","aantal":0}]}'
```
Expected: `400` (aantal `0` is ongeldig — noch aanvulling, noch correctie).

- [ ] **Step 9: Commit**

```bash
git add netlify/functions/inventaris.js
git commit -m "feat: backend endpoint /api/inventaris (wagenvoorraad + neemlog)"
```

---

## Task 2: Frontend module + tabblad "Inventaris" (weergave + Verwerkt-actie)

**Files:**
- Create: `public/js/inventaris.js`
- Create: `public/css/inventaris.css`
- Modify: `public/index.html:26` (CSS-link), `public/index.html:60-61` (tabbalk), `public/index.html:149-150` (nieuwe view), `public/index.html:500` (script-tag), `public/index.html:718` (DOMContentLoaded), `public/index.html:942-943` (selectPerson), `public/index.html:3616` (setTab)
- Modify: `public/sw.js` (SHELL + CACHE_NAME)

**Interfaces:**
- Consumes: `zoekOnderdelen`, `PRIJZEN`, `PRIJZEN_DEFAULTS` (window-bridged door `public/js/prijzen.js`, bare reference, geen import); `toast(msg, ms)`, `escHtml(str)`, `fmtDateShort(date)`, `loadFromCache(key)`, `saveToCache(key,data)` (window-globale functies uit `public/index.html`, bare reference); `activeAssigneeFilter` (gelezen door index.html zelf, doorgegeven als parameter — niet rechtstreeks door de module gelezen).
- Produces (window-bridged, voor gebruik vanuit `public/index.html`): `loadInventaris(): Promise<void>`, `renderInventaris(persoon: string): void`, `updateInventarisBadge(persoon: string): void`. Ook exported (module-intern hergebruikt in Task 3): `_invData` (state object).

- [ ] **Step 1: Maak `public/css/inventaris.css`**

```css
/* Inventaris-tab: wagenvoorraad per technieker + supervisor-neemlog */

.inv-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px;
}

.inv-empty {
  padding: 20px 16px;
  color: var(--muted);
  font-size: 0.82rem;
}

.inv-list {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inv-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--surface);
}

.inv-row.inv-low {
  border-color: var(--red);
  background: var(--red-dim);
}

.inv-row-naam { font-size: 0.85rem; }
.inv-row-aantal { font-size: 0.85rem; font-weight: 700; }
.inv-row.inv-low .inv-row-aantal { color: var(--red); }

.inv-log-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--surface);
  flex-wrap: wrap;
  font-size: 0.82rem;
}

.inv-log-type {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 20px;
  text-transform: uppercase;
}
.inv-log-type.inv-log-aanvulling { background: var(--accent-dim); color: var(--accent); }
.inv-log-type.inv-log-correctie  { background: var(--red-dim); color: var(--red); }
.inv-log-type.inv-log-verbruik   { background: var(--surface3); color: var(--muted); }

.inv-log-materiaal { flex: 1; min-width: 140px; }
.inv-log-datum { color: var(--muted); font-size: 0.75rem; }
.inv-log-status-done { color: var(--muted); font-size: 0.75rem; }
```

- [ ] **Step 2: Maak `public/js/inventaris.js` (state, laden, weergave, Verwerkt-actie)**

```js
// public/js/inventaris.js
// Wagenvoorraad per technieker (Fase 2) + supervisor-neemlog. Weergave hangt af van de
// bestaande persoon-kiezer (activeAssigneeFilter in index.html), die als parameter
// doorgegeven wordt door renderInventaris()/updateInventarisBadge() — deze module leest
// activeAssigneeFilter niet rechtstreeks (het is een `let` in een classic script, dus geen
// impliciete window-global, in tegenstelling tot function-declarations zoals toast/escHtml).
// Zie docs/superpowers/specs/2026-08-20-inventarissysteem-design.md.

export let _invData = { versie: 0, wagenvoorraad: {}, log: [] };
let _invPersoon  = null; // technieker voor wie de "+ Materiaal"-modal momenteel open staat
let _invSelected = null; // { id, naam } van het gekozen materiaal in die modal, of null tijdens het zoeken

const INV_API       = '/api/inventaris';
const INV_CACHE_KEY = 'blitz_inventaris_cache';

const TYPE_LABEL = { aanvulling: 'Aanvulling', correctie: 'Correctie', verbruik: 'Verbruik' };

function materiaalNaamVoorId(id) {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  return src.onderdelen.find(o => o.id === id)?.naam || id;
}

// ── Laden ──
export async function loadInventaris() {
  const cached = loadFromCache(INV_CACHE_KEY);
  if (cached) _invData = cached;
  try {
    const res = await fetch(INV_API);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _invData = data;
    saveToCache(INV_CACHE_KEY, data);
  } catch (err) {
    console.warn('Inventaris laden mislukt, laatst gekende stand blijft staan:', err);
  }
}

// ── Weergave ──
export function renderInventaris(persoon) {
  const body = document.getElementById('inventaris-body');
  if (!body) return;

  if (persoon === 'all') {
    body.innerHTML = renderSupervisorLog();
    body.querySelectorAll('.inv-log-verwerkt-btn').forEach(btn => {
      btn.addEventListener('click', () => markVerwerkt(btn.dataset.logId));
    });
  } else {
    body.innerHTML = renderEigenVoorraad(persoon);
    body.querySelector('#inv-add-btn')?.addEventListener('click', () => openInventarisAddModal(persoon));
  }
}

function renderEigenVoorraad(persoon) {
  const stock = _invData.wagenvoorraad[persoon] || {};
  const ids = Object.keys(stock).sort((a, b) => materiaalNaamVoorId(a).localeCompare(materiaalNaamVoorId(b)));

  const rijen = ids.length
    ? ids.map(id => {
        const aantal = stock[id];
        return `<div class="inv-row${aantal <= 0 ? ' inv-low' : ''}">
          <span class="inv-row-naam">${escHtml(materiaalNaamVoorId(id))}</span>
          <span class="inv-row-aantal">${aantal}</span>
        </div>`;
      }).join('')
    : '<div class="inv-empty">Nog geen materiaal geregistreerd voor deze technieker.</div>';

  return `<div class="inv-toolbar"><button class="btn-primary" id="inv-add-btn">+ Materiaal</button></div>
    <div class="inv-list">${rijen}</div>`;
}

function renderSupervisorLog() {
  const entries = [...(_invData.log || [])].sort((a, b) => new Date(b.datum) - new Date(a.datum));

  const rijen = entries.length
    ? entries.map(e => `<div class="inv-log-row">
        <span class="inv-log-type inv-log-${e.type}">${TYPE_LABEL[e.type] || e.type}</span>
        <span class="inv-log-technieker">${escHtml(e.technieker)}</span>
        <span class="inv-log-materiaal">${escHtml(e.materiaalNaam)}</span>
        <span class="inv-log-aantal">${e.aantal > 0 ? '+' : ''}${e.aantal}</span>
        <span class="inv-log-datum">${fmtDateShort(new Date(e.datum))}</span>
        ${e.type === 'aanvulling'
          ? (e.status === 'nieuw'
              ? `<button class="btn-sec inv-log-verwerkt-btn" data-log-id="${e.id}">Verwerkt</button>`
              : '<span class="inv-log-status-done">✓ verwerkt</span>')
          : ''}
      </div>`).join('')
    : '<div class="inv-empty">Nog geen bewegingen.</div>';

  return `<div class="inv-list">${rijen}</div>`;
}

export function updateInventarisBadge(persoon) {
  const el = document.getElementById('cnt-inventaris');
  if (!el) return;
  let count;
  if (persoon === 'all') {
    count = (_invData.log || []).filter(e => e.type === 'aanvulling' && e.status === 'nieuw').length;
  } else {
    const stock = _invData.wagenvoorraad[persoon] || {};
    count = Object.values(stock).filter(a => a <= 0).length;
  }
  el.textContent = String(count);
  el.style.display = count > 0 ? '' : 'none';
}

// ── Verwerkt-actie (supervisor) ──
async function markVerwerkt(logId) {
  try {
    const res = await fetch(INV_API, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versie: _invData.versie, id: logId }),
    });
    if (res.status === 409) {
      const body = await res.json();
      _invData = body.data || _invData;
      toast('⚠ Conflict — inventaris herladen, probeer opnieuw', 3000);
      renderInventaris('all');
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
    renderInventaris('all');
    toast('✓ Gemarkeerd als verwerkt', 2500);
  } catch (err) {
    toast('❌ Verwerkt-markering mislukt: ' + err.message, 4000);
  }
}

// ── "+ Materiaal"-modal (Task 3 vult dit verder aan — openInventarisAddModal wordt hier al
// aangeroepen vanuit renderEigenVoorraad, dus de functie moet vanaf deze taak al bestaan.
// De modal-markup zelf (#inv-add-overlay) bestaat pas vanaf Task 3 — deze placeholder raakt
// dus bewust geen DOM-elementen aan die nog niet bestaan, enkel een zichtbare toast) ──
export function openInventarisAddModal(persoon) {
  _invPersoon  = persoon;
  _invSelected = null;
  toast('⚠️ "+ Materiaal" komt in de volgende taak — nog niet geïmplementeerd', 3000);
}

// ── Window-bridge ──
// Zelfde patroon als prijzen.js/rapport-wizard.js: functies die vanuit index.html (onclick=,
// setTab/selectPerson/DOMContentLoaded) aangeroepen worden, moeten expliciet op window staan
// (modules maken geen impliciete globals).
window.loadInventaris        = loadInventaris;
window.renderInventaris      = renderInventaris;
window.updateInventarisBadge = updateInventarisBadge;
```

> **Let op — dit is een BEWUSTE, tijdelijke afwijking van "geen placeholders":** `openInventarisAddModal` móet in deze taak al bestaan (Step 2 hierboven roept hem aan vanuit `renderEigenVoorraad`'s `addEventListener`), maar de echte modal-inhoud komt pas in Task 3. Zonder deze functie zou de "+ Materiaal"-knop een `undefined`-fout geven bij een klik. De toast hierboven is een expliciete, zichtbare "nog niet af"-melding — geen stille no-op — zodat Step 5's handmatige verificatie hieronder meteen duidelijk maakt dat dit klopt. Task 3 vervangt deze hele functie.

- [ ] **Step 3: Voeg CSS-link, tabblad, view en script-tag toe in `public/index.html`**

Voeg na regel 26 (`<link rel="stylesheet" href="/css/prijzen.css">`) toe:
```html
  <link rel="stylesheet" href="/css/inventaris.css">
```

Voeg in de tabbalk, na de "Ingepland"-tab (regel 60) en vóór de "Rapporten"-tab (regel 61) toe:
```html
    <div class="tab"        id="tab-inventaris" onclick="event.stopPropagation(); setTab('inventaris')">Inventaris <span class="badge" id="cnt-inventaris" style="display:none">0</span></div>
```

Voeg na de RAPPORTEN-tab-view (na regel 149, vóór `<!-- Detail modal -->` op regel 151) toe:
```html
<!-- ══ INVENTARIS TAB ══ -->
<div class="view" id="view-inventaris">
  <div id="inventaris-body">
    <div class="inv-empty">Laden...</div>
  </div>
</div>
```

Voeg na regel 500 (`<script type="module" src="/js/rapport-wizard.js"></script>`) toe:
```html
<script type="module" src="/js/inventaris.js"></script>
```

- [ ] **Step 4: Koppel `setTab`, `selectPerson` en `DOMContentLoaded` aan de nieuwe module**

In `setTab(tab)` (rond regel 3616), voeg na de bestaande `if (tab === 'rapporten') ...`-regel toe:
```js
  if (tab === 'inventaris') setTimeout(() => renderInventaris(activeAssigneeFilter), 0);
```

In `selectPerson(name)` (rond regel 942-943), voeg na de bestaande
`renderRouteList(...)`-aanroep toe:
```js
  renderInventaris(activeAssigneeFilter);
  updateInventarisBadge(activeAssigneeFilter);
```

In de `DOMContentLoaded`-handler, voeg na `loadAvailability();` (regel 718) toe:
```js
  loadInventaris().then(() => {
    renderInventaris(activeAssigneeFilter);
    updateInventarisBadge(activeAssigneeFilter);
  });
```

- [ ] **Step 5: Bump de service worker**

In `public/sw.js`, wijzig:
```js
const CACHE_NAME = 'blitz-planning-v7';
const SHELL = ['/', '/index.html', '/manifest.json', '/js/outbox.js', '/js/rapport-archief.js', '/js/excel-export.js', '/js/prijzen.js', '/js/rapport-wizard.js', '/css/base.css', '/css/app.css', '/css/wizard.css', '/css/prijzen.css'];
```
naar:
```js
const CACHE_NAME = 'blitz-planning-v8';
const SHELL = ['/', '/index.html', '/manifest.json', '/js/outbox.js', '/js/rapport-archief.js', '/js/excel-export.js', '/js/prijzen.js', '/js/rapport-wizard.js', '/js/inventaris.js', '/css/base.css', '/css/app.css', '/css/wizard.css', '/css/prijzen.css', '/css/inventaris.css'];
```

- [ ] **Step 6: Handmatige verificatie in de browser**

1. Zorg dat `node dev-server.mjs` nog draait (van Task 1) en dat de curl-testdata uit Task 1
   nog in de blob staat (technieker "Jan Peeters" met `led` op stand `2`, één `aanvulling` op
   status `verwerkt`, één `correctie`, één `verbruik`).
2. Open `http://localhost:3333/` in de browser. Klik het tabblad **Inventaris** — de tab moet
   zowel zichtbaar zijn op desktop-breedte als na `resize_window` naar mobiel (`375×812`, geen
   `desktop-only`-class).
3. Kies "Jan Peeters" in de persoon-kiezer rechtsboven, open Inventaris → rij "LED" met aantal
   `2` (géén rode markering, want `2 > 0`).
4. Kies "Alle technici" → de neemlog toont 3 regels (aanvulling/correctie/verbruik), de
   `aanvulling`-regel toont "✓ verwerkt" (geen knop meer, want al verwerkt in Task 1's Step 7).
5. Via `curl` (zoals Task 1) een nieuwe `mutatie`-aanvulling posten voor "Jan Peeters" → op
   "Alle technici" opnieuw naar Inventaris schakelen (of "↺" klikken + opnieuw laden) → de
   nieuwe regel toont nu wél een "Verwerkt"-knop; erop klikken → regel toont meteen "✓ verwerkt",
   toast "✓ Gemarkeerd als verwerkt", en de tab-badge (die eerst "1" toonde) verdwijnt weer.
6. Klik "+ Materiaal" bij Jan Peeters → toast "⚠️ ... nog niet geïmplementeerd" verschijnt
   (bevestigt Step 2's bewuste tussenstand — Task 3 vervangt dit).

- [ ] **Step 7: Commit**

```bash
git add public/js/inventaris.js public/css/inventaris.css public/index.html public/sw.js
git commit -m "feat: tabblad Inventaris — wagenvoorraad-weergave, supervisor-neemlog, Verwerkt-actie"
```

---

## Task 3: "+ Materiaal"-modal (toevoegen/corrigeren)

**Files:**
- Modify: `public/index.html` (nieuwe modal-markup, na regel 396 — na de Manuele-afspraak-modal)
- Modify: `public/js/inventaris.js` (vervangt de placeholder-`openInventarisAddModal` uit Task 2,
  voegt de modal-logica + `submitInventarisMutatie` toe)

**Interfaces:**
- Consumes: `_invData`, `renderInventaris`, `updateInventarisBadge` (uit Task 2, zelfde
  bestand); `zoekOnderdelen`, `PRIJZEN`, `PRIJZEN_DEFAULTS`, `toast`, `escHtml` (zelfde bronnen
  als Task 2).
- Produces (window-bridged): `closeInventarisAddModal(e?)`, `invZoekInput()`,
  `invZoekOpnieuw()`, `invSubmitAdd()`. `openInventarisAddModal(persoon: string)` blijft
  module-intern aangeroepen (via `addEventListener`, zie Task 2 Step 2), geen bridge nodig.

- [ ] **Step 1: Voeg de modal-markup toe in `public/index.html`**

Voeg na regel 396 (sluiting van de Manuele-afspraak-modal, vóór
`<!-- Auto-plan resultaat modal -->` op regel 398) toe:

```html
<!-- Inventaris: materiaal toevoegen/corrigeren modal -->
<div class="overlay" id="inv-add-overlay" onclick="closeInventarisAddModal(event)">
  <div class="modal" id="inv-add-modal" style="max-width:420px">
    <div class="mhdr">
      <button class="mhdr-close" onclick="closeInventarisAddModal()" title="Sluiten" aria-label="Sluiten">✕</button>
      <div class="mhdr-title">📦 Materiaal toevoegen/corrigeren</div>
    </div>
    <div class="mbody" id="inv-add-body">
      <!-- Ingevuld door openInventarisAddModal()/_invRenderAddModal() -->
    </div>
  </div>
</div>
```

- [ ] **Step 2: Vervang `openInventarisAddModal` en voeg de modal-logica toe in `public/js/inventaris.js`**

Vervang het volledige blok
```js
// ── "+ Materiaal"-modal (Task 3 vult dit verder aan — openInventarisAddModal wordt hier al
// aangeroepen vanuit renderEigenVoorraad, dus de functie moet vanaf deze taak al bestaan.
// De modal-markup zelf (#inv-add-overlay) bestaat pas vanaf Task 3 — deze placeholder raakt
// dus bewust geen DOM-elementen aan die nog niet bestaan, enkel een zichtbare toast) ──
export function openInventarisAddModal(persoon) {
  _invPersoon  = persoon;
  _invSelected = null;
  toast('⚠️ "+ Materiaal" komt in de volgende taak — nog niet geïmplementeerd', 3000);
}
```
door:
```js
// ── "+ Materiaal"-modal ──
export function openInventarisAddModal(persoon) {
  _invPersoon  = persoon;
  _invSelected = null;
  document.getElementById('inv-add-overlay').classList.add('open');
  _invRenderAddModal();
}

export function closeInventarisAddModal(e) {
  if (e && e.target !== document.getElementById('inv-add-overlay')) return;
  document.getElementById('inv-add-overlay').classList.remove('open');
}

export function invZoekOpnieuw() {
  _invSelected = null;
  _invRenderAddModal();
}

export function invZoekInput() {
  _invUpdateZoekResults();
}

export function invSubmitAdd() {
  const aantal = parseInt(document.getElementById('inv-aantal')?.value, 10);
  if (!aantal) { toast('⚠️ Vul een aantal in (niet 0)', 3000); return; }
  submitInventarisMutatie(_invSelected.id, _invSelected.naam, aantal);
}

function _invRenderAddModal() {
  const body = document.getElementById('inv-add-body');
  if (!_invSelected) {
    body.innerHTML = `
      <div class="wiz-cat-search-wrap">
        <span class="wiz-cat-search-icon">🔍</span>
        <input class="wiz-cat-search" id="inv-zoek-q" type="search"
          placeholder="Zoek op naam of tag…" oninput="invZoekInput()" autocomplete="off" />
      </div>
      <div class="wiz-cat-results" id="inv-zoek-results"></div>`;
    _invUpdateZoekResults();
  } else {
    body.innerHTML = `
      <div class="inv-gekozen-naam" style="font-weight:600;margin-bottom:10px">${escHtml(_invSelected.naam)}</div>
      <label class="wiz-field-label" for="inv-aantal">Aantal (negatief = correctie: kapot, verloren, telfout)</label>
      <input class="man-input" id="inv-aantal" type="number" step="1" value="1" />
      <div class="mftr" style="padding:12px 0 0">
        <button class="btn-cancel" onclick="invZoekOpnieuw()">‹ Ander materiaal</button>
        <button class="btn-save" onclick="invSubmitAdd()">Toevoegen</button>
      </div>`;
    document.getElementById('inv-aantal')?.focus();
  }
}

function _invUpdateZoekResults() {
  const q = document.getElementById('inv-zoek-q')?.value || '';
  const resultEl = document.getElementById('inv-zoek-results');
  if (!resultEl) return;
  const resultaten = zoekOnderdelen(q, []);
  if (!resultaten.length) {
    resultEl.innerHTML = '<div class="wiz-cat-empty">Geen onderdelen gevonden</div>';
    return;
  }
  resultEl.innerHTML = resultaten.slice(0, 20).map(o =>
    `<div class="wiz-cat-item" data-ond-id="${escHtml(o.id)}">
      <span class="wiz-cat-item-naam">${escHtml(o.naam)}</span>
    </div>`
  ).join('');
  resultEl.querySelectorAll('.wiz-cat-item').forEach(item => {
    item.addEventListener('click', () => invKiesMateriaal(item.dataset.ondId || ''));
  });
}

function invKiesMateriaal(id) {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const o = src.onderdelen.find(x => x.id === id);
  if (!o) return;
  _invSelected = { id: o.id, naam: o.naam };
  _invRenderAddModal();
}

async function submitInventarisMutatie(materiaalId, materiaalNaam, aantal) {
  const technieker = _invPersoon;
  try {
    const res = await fetch(INV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versie: _invData.versie,
        technieker,
        actie: 'mutatie',
        items: [{ materiaalId, materiaalNaam, aantal }],
      }),
    });
    if (res.status === 409) {
      const body = await res.json();
      _invData = body.data || _invData;
      toast('⚠ Conflict — inventaris herladen, probeer opnieuw', 3000);
      closeInventarisAddModal();
      renderInventaris(technieker);
      return;
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || ('HTTP ' + res.status));
    }
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
    closeInventarisAddModal();
    renderInventaris(technieker);
    updateInventarisBadge(technieker);
    toast(aantal > 0 ? '✓ Toegevoegd aan wagenvoorraad' : '✓ Correctie geregistreerd', 2500);
  } catch (err) {
    toast('❌ Opslaan mislukt: ' + err.message, 4000);
  }
}
```

Voeg daarnaast, in het window-bridge-blok onderaan het bestand, deze drie regels toe (na de
bestaande `window.updateInventarisBadge = updateInventarisBadge;`):
```js
window.closeInventarisAddModal = closeInventarisAddModal;
window.invZoekInput            = invZoekInput;
window.invZoekOpnieuw          = invZoekOpnieuw;
window.invSubmitAdd            = invSubmitAdd;
```

- [ ] **Step 3: Handmatige verificatie in de browser**

1. Herlaad de app, kies "Jan Peeters", open Inventaris, klik **"+ Materiaal"** → modal opent
   met een zoekveld.
2. Typ "kabel" → resultaten filteren live. Klik een resultaat (bv. "Laadkabel 5m Zwart") →
   modal toont naam + aantal-invoerveld (standaard `1`).
3. Klik **"Toevoegen"** met aantal `3` → modal sluit, toast "✓ Toegevoegd aan wagenvoorraad",
   nieuwe rij "Laadkabel 5m Zwart — 3" verschijnt in de lijst.
4. Open opnieuw "+ Materiaal", kies hetzelfde materiaal, geef aantal `-1` in, klik Toevoegen →
   toast "✓ Correctie geregistreerd", rij toont nu `2`.
5. Schakel naar "Alle technici" → de neemlog toont de nieuwe `aanvulling`-regel (met
   "Verwerkt"-knop) én de `correctie`-regel (zonder knop, met het `Correctie`-label).
6. Test het "‹ Ander materiaal"-knopje: open de modal, kies een materiaal, klik "‹ Ander
   materiaal" → terug naar het zoekscherm.
7. Test aantal `0`: kies een materiaal, laat het aantal-veld op `0` staan, klik Toevoegen →
   toast "⚠️ Vul een aantal in (niet 0)", modal blijft open, geen netwerk-aanroep (te
   verifiëren via de Network-tab: geen nieuwe `/api/inventaris`-POST).

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/js/inventaris.js
git commit -m "feat: \"+ Materiaal\"-modal — toevoegen en corrigeren van wagenvoorraad"
```

---

## Task 4: Automatische aftrek bij rapport-afronding

**Files:**
- Modify: `public/js/inventaris.js` (nieuwe `registreerVerbruik`-functie + window-bridge)
- Modify: `public/js/rapport-wizard.js:1197-1207` (aanroep vanuit `printRapport`)

**Interfaces:**
- Produces (window-bridged, aangeroepen vanuit `rapport-wizard.js` als bare reference —
  zelfde cross-module-conventie als `outboxAdd`/`PRIJZEN`): `registreerVerbruik(technieker: string, onderdelen: Array<{id, naam, aantal}>): Promise<void>` — faalt nooit zichtbaar voor de aanroeper (interne try/catch, enkel `console.warn` bij een fout).
- Consumes: `_invData`, `INV_API`, `INV_CACHE_KEY` (module-intern, al aanwezig sinds Task 2).

- [ ] **Step 1: Voeg `registreerVerbruik` toe in `public/js/inventaris.js`**

Voeg toe vóór het window-bridge-blok onderaan:
```js
// ── Automatische aftrek bij rapport-afronding ──
// Aangeroepen (niet afgewacht, best-effort) vanuit public/js/rapport-wizard.js's printRapport().
// 'vrije regel'-onderdelen (id begint met 'vrij-') zijn handmatig ingevoerde tekst zonder
// koppeling aan de prijzencatalogus — die hebben geen materiaalId om tegen af te boeken, en
// worden dus bewust overgeslagen (geen fout, gewoon genegeerd).
export async function registreerVerbruik(technieker, onderdelen) {
  if (!technieker) return;
  const items = (onderdelen || [])
    .filter(p => p.naam && !String(p.id || '').startsWith('vrij-') && (parseInt(p.aantal) || 0) > 0)
    .map(p => ({ materiaalId: p.id, materiaalNaam: p.naam, aantal: parseInt(p.aantal) || 1 }));
  if (!items.length) return;

  try {
    const res = await fetch(INV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versie: _invData.versie, technieker, actie: 'verbruik', items }),
    });
    if (!res.ok) { console.warn('Inventaris-aftrek (verbruik) niet gelukt, HTTP', res.status); return; }
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
  } catch (err) {
    console.warn('Inventaris-aftrek (verbruik) niet gelukt:', err);
  }
}
```

Voeg in het window-bridge-blok toe:
```js
window.registreerVerbruik = registreerVerbruik;
```

- [ ] **Step 2: Roep `registreerVerbruik` aan in `printRapport`**

In `public/js/rapport-wizard.js`, zoek dit fragment (rond regel 1197-1207):
```js
      await outboxAdd(item);
      await refreshOutboxCache();

      // Post-launch feedback (2026-08-17): geen apart "Oplossing invoeren"-knopje meer -- de
      // uitgevoerde acties staan toch al hier (R.acties), dus die worden meteen als oplossing op
      // het Zoho-ticket gezet. Enkel zinvol bij een echt gekoppeld ticket (niet bij een lokale,
      // manueel toegevoegde afspraak) en enkel als er effectief iets ingevuld is. Best-effort,
      // niet afgewacht: mag de rapport-verzending zelf niet vertragen of laten falen.
      if (!item.isLocal && R.acties?.trim()) {
        window.syncOplossingNaarZoho?.(item.ticket.id, R.acties);
      }
```
en voeg er direct na toe:
```js

      // Zelfde best-effort-aanpak als hierboven: wagenvoorraad-aftrek voor gebruikt materiaal
      // mag het afronden van het rapport nooit vertragen of laten falen (zie
      // docs/superpowers/specs/2026-08-20-inventarissysteem-design.md, "Randgevallen").
      registreerVerbruik(R.technieker, R.onderdelen).catch(err =>
        console.warn('Inventaris-aftrek mislukt (niet blokkerend):', err));
```

- [ ] **Step 3: Handmatige verificatie in de browser**

1. Herlaad de app, zorg dat de dev-server nog draait.
2. Kies "Jan Peeters", open Inventaris, onthoud het aantal "Laadkabel 5m Zwart" (uit Task 3:
   `2`).
3. Open een ticket/afspraak voor Jan Peeters → open het rapport (📋) → doorloop de wizard tot
   stap "Status & onderdelen" → voeg "Laadkabel 5m Zwart" toe met aantal `1` → doorloop verder
   tot "🖨️ Afdrukken / PDF" → klik die knop.
4. Na het afdrukvoorbeeld: schakel naar het tabblad Inventaris (nog steeds "Jan Peeters") →
   "Laadkabel 5m Zwart" moet nu op `1` staan (was `2`, min `1` verbruikt).
5. Schakel naar "Alle technici" → de neemlog toont een nieuwe `verbruik`-regel voor "Laadkabel
   5m Zwart", `aantal: -1`, geen "Verwerkt"-knop.
6. Herhaal met een rapport dat een "Vrije regel" (handmatig ingevoerd onderdeel, geen
   catalogus-item) bevat → na afronden: geen nieuwe log-regel voor die vrije regel (bevestigt
   dat de `vrij-`-filter uit Step 1 werkt).
7. Test dat een falende aftrek het rapport niet blokkeert: stop de dev-server (`Ctrl+C`) net
   vóór je op "🖨️ Afdrukken / PDF" klikt bij een volgend rapport → het rapport moet nog
   steeds normaal afronden (afdrukvoorbeeld + "Rapport opgeslagen"-toast), enkel de browser-
   console toont de `console.warn`-regel over de mislukte inventaris-aftrek.

- [ ] **Step 4: Commit**

```bash
git add public/js/inventaris.js public/js/rapport-wizard.js
git commit -m "feat: automatische wagenvoorraad-aftrek bij rapport-afronding"
```
