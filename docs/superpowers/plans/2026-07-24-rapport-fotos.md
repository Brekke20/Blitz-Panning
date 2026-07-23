# Foto's op het service rapport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let technicians attach photos to a ticket at any point between arrival and finishing the service rapport — surviving app/tab closure in between — and have those photos embedded in the final printed/archived report.

**Architecture:** A new Netlify Function (`fotos.js`) stores photos per ticket in its own Blob key (`foto-<ticketId>`), separate from the shared multi-ticket blobs the rest of the app uses, because photo payloads are far larger than the small text fields those blobs hold. Client-side, photos are compressed via canvas before upload. A shared render/CRUD helper drives two UIs against the same backend: a detail-modal "📷 Foto's" panel (available before the report exists) and a new wizard step (a last chance to add/review before printing). Both funnel into `R.fotos`, embedded into the report HTML exactly like the existing signature images.

**Tech Stack:** Vanilla JS/CSS in `public/index.html`, one new Netlify Function (`netlify/functions/fotos.js`, ES module, `@netlify/blobs`), no build step, no framework.

## Global Constraints

- Backend changes are limited to one new file: `netlify/functions/fotos.js`. No other Netlify Function is modified.
- Frontend changes are limited to `public/index.html`.
- CORS allowlist for the new function must be exactly `['https://blitz-power.netlify.app', 'https://blitz-planning.netlify.app', 'http://localhost:8888']` — copied from `netlify/functions/prijzen.js`, the one existing function with the correct (non-stale) list.
- Photos are keyed by `ticketId` alone (not `ticketId + datum`) — a ticket's photos must survive being rescheduled to a different date.
- Every photo is compressed client-side (canvas resize to max 1600px on the longest side, JPEG quality 0.7) before it is ever sent to the backend — never send an uncompressed file.
- **No automated test framework exists in this codebase.** `fotos.js` uses the Netlify Functions v2 `export default` convention (matching `klantbeschikbaarheid.js`/`afspraken.js`/`prijzen.js`) — the local `dev-server.mjs` only calls a `handler` export, so **this endpoint cannot be exercised against the local dev server at all** (a pre-existing, documented limitation affecting 6+ other functions already, not something this plan fixes). Task 1's verification is therefore careful line-by-line comparison against `klantbeschikbaarheid.js`'s working implementation, not a live request. Tasks 2-5 (client-side) are verified in a real browser by mocking `window.fetch` for `/api/fotos` calls (the same technique already used successfully earlier in this project's history to test `/api/plan` failure paths) — this proves the client-side logic is correct even though the real endpoint can't run locally.
- Commit after each task with `git add` naming the specific file(s) touched (never `-A`) and a `feat:` prefixed message. **Do not push.**

---

### Task 1: Backend — `netlify/functions/fotos.js`

**Files:**
- Create: `netlify/functions/fotos.js`

**Interfaces:**
- Produces: `GET /api/fotos?ticketId=<id>` → `200 { versie: number, fotos: [{ id, dataUrl, caption, tijdstip }] }`. `PUT /api/fotos` body `{ ticketId, versie, fotos }` → `200` (same shape, `versie` incremented) on success, `409 { error, serverVersie, data }` on version mismatch, `400 { error }` on invalid input. This is the only interface Task 2 (client helpers) depends on.

- [ ] **Step 1: Read the precedent file in full**

Read `netlify/functions/klantbeschikbaarheid.js` completely before writing anything — this task's file follows its exact conventions (CORS headers, OPTIONS handling, optimistic-lock response shape, `getStore({ name: 'blitz-data', consistency: 'strong' })`), with two deliberate differences: (a) the blob key is per-ticket (`foto-<ticketId>`) instead of one shared key for all tickets, and (b) `GET` takes a `ticketId` query parameter instead of returning everyone's data at once.

- [ ] **Step 2: Create the file**

Create `netlify/functions/fotos.js` with exactly this content:

```js
// /api/fotos
// GET  ?ticketId=<id> → foto's voor één ticket
// PUT  → foto's opslaan voor één ticket (open, geen auth)
// Structuur per ticket (eigen blob-key, NIET gedeeld met andere tickets —
// foto-payloads zijn te groot om samen met alle tickets in één blob te bewaren):
//   { versie, fotos: [ { id, dataUrl, caption, tijdstip } ] }

import { getStore } from '@netlify/blobs';

const ALLOWED_ORIGINS = [
  'https://blitz-power.netlify.app',
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];
const EMPTY        = { versie: 0, fotos: [] };
const MAX_FOTOS     = 30;
const MAX_CAPTION   = 200;

function corsHeaders(req) {
  const origin  = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function blobKey(ticketId) { return `foto-${ticketId}`; }

export default async (req) => {
  const hdrs  = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });
  const url   = new URL(req.url);

  // ── GET ───────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const ticketId = url.searchParams.get('ticketId');
    if (!ticketId) {
      return new Response(JSON.stringify({ error: 'ticketId is verplicht' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
    try {
      const raw = await store.get(blobKey(ticketId), { type: 'json' });
      return new Response(JSON.stringify(raw ?? EMPTY), {
        status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    } catch {
      return new Response(JSON.stringify(EMPTY), {
        status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
  }

  // ── PUT ───────────────────────────────────────────────────────────────────
  if (req.method === 'PUT') {
    let body;
    try { body = await req.json(); }
    catch { return new Response(JSON.stringify({ error: 'Ongeldige JSON' }), { status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' } }); }

    const { ticketId, versie, fotos } = body;
    if (!ticketId || typeof ticketId !== 'string') {
      return new Response(JSON.stringify({ error: 'ticketId is verplicht' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
    if (!Array.isArray(fotos)) {
      return new Response(JSON.stringify({ error: 'fotos moet een array zijn' }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }
    if (fotos.length > MAX_FOTOS) {
      return new Response(JSON.stringify({ error: `Maximaal ${MAX_FOTOS} foto's per ticket` }), {
        status: 400, headers: { ...hdrs, 'Content-Type': 'application/json' },
      });
    }

    // Optimistic locking
    let current = EMPTY;
    try { current = (await store.get(blobKey(ticketId), { type: 'json' })) ?? EMPTY; }
    catch {}

    if (versie !== current.versie) {
      return new Response(JSON.stringify({
        error: 'Versiematch mislukt', serverVersie: current.versie, data: current,
      }), { status: 409, headers: { ...hdrs, 'Content-Type': 'application/json' } });
    }

    // Valideer en schoon elke foto op
    const cleaned = [];
    for (const f of fotos) {
      if (!f || typeof f.dataUrl !== 'string' || !f.dataUrl.startsWith('data:image/')) continue;
      cleaned.push({
        id:       String(f.id || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
        dataUrl:  f.dataUrl,
        caption:  String(f.caption || '').slice(0, MAX_CAPTION),
        tijdstip: f.tijdstip || new Date().toISOString(),
      });
    }

    const nieuw = { versie: current.versie + 1, fotos: cleaned };
    await store.setJSON(blobKey(ticketId), nieuw);

    return new Response(JSON.stringify(nieuw), {
      status: 200, headers: { ...hdrs, 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method Not Allowed', { status: 405, headers: hdrs });
};

export const config = { path: '/api/fotos' };
```

Note: `crypto.randomUUID()` is available in Netlify's Node runtime, but the fallback ID generation above (`Date.now()` + random suffix) avoids relying on it since the client will normally always send an `id` anyway (Task 2 generates one before upload) — this is only a backstop for a malformed request.

- [ ] **Step 3: Verification (code comparison, not a live request — see Global Constraints)**

Compare the new file against `netlify/functions/klantbeschikbaarheid.js` side by side and confirm:
1. CORS headers, OPTIONS handling, and the `409` conflict response shape are structurally identical (same header names, same status codes, same `{ error, serverVersie, data }` shape on conflict).
2. The only structural differences are: (a) `blobKey()` is a function of `ticketId` instead of a constant, (b) `GET` requires and reads a `ticketId` query param, (c) the PUT body carries `ticketId` alongside `versie`/the collection, (d) the collection is called `fotos` (an array) instead of `items` (a map).
3. `MAX_FOTOS`/`MAX_CAPTION` guards exist and are checked before the optimistic-lock read (so an oversized payload gets rejected before touching the store).
4. `dataUrl.startsWith('data:image/')` is checked for every element of `fotos` in the PUT handler — anything not matching is silently dropped from `cleaned`, not written to the store.

State plainly in your report that this was a code-comparison verification, not a live HTTP test, and why (per Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/fotos.js
git commit -m "feat: nieuwe /api/fotos endpoint voor foto-opslag per ticket"
```

---

### Task 2: Client-side helpers — compressie, laden/opslaan, gedeelde grid-renderer

**Files:**
- Modify: `public/index.html` (new CSS block near `.kb-chip`/`.kb-add-btn` ~line 597-600, new JS section placed near the other cloud-sync helpers — e.g. right after `saveKlantBeschikbaarheid()` ~line 2560, exact line TBD by the implementer based on where that function's closing brace lands)

**Interfaces:**
- Produces: `compressFotoFile(file: File): Promise<string>` (resolves to a `data:image/jpeg;base64,...` string, resized/compressed per Global Constraints). `loadFotos(ticketId: string): Promise<{versie, fotos}>`. `saveFotos(ticketId: string, versie: number, fotos: array): Promise<{versie, fotos}>` (throws on non-2xx, including a `409` — caller decides how to handle a conflict; this plan's UI is single-editor-at-a-time so Tasks 3/4 will simply reload and retry once rather than merge, see those tasks). `renderFotoGrid(container: HTMLElement, fotos: array, callbacks: {onDelete(id), onCaptionInput(id, value)}): void` — pure DOM rendering, no network calls of its own; Tasks 3 and 4 both call this and handle persistence themselves in the callbacks.
- Consumes: nothing from earlier tasks except the `/api/fotos` contract from Task 1.

- [ ] **Step 1: Add the CSS for the photo grid**

Find the existing `.kb-chip`/`.kb-add-btn` rules (search for `.kb-add-btn { font-size: 0.72rem`). Insert immediately after that rule:

```css
    .foto-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; margin: 8px 0; }
    .foto-thumb { position: relative; border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; background: var(--surface2); }
    .foto-thumb img { width: 100%; height: 90px; object-fit: cover; display: block; }
    .foto-thumb-del { position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,.55); color: #fff; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 0.75rem; line-height: 1; }
    .foto-caption { width: 100%; box-sizing: border-box; font-size: 0.68rem; padding: 3px 5px; border: none; border-top: 1px solid var(--border); background: var(--surface); color: var(--text); font-family: inherit; }
    .foto-add-btn { padding: 8px 14px; background: var(--accent-dim); color: var(--accent); border: 1px solid var(--accent); border-radius: var(--r); font-weight: 600; cursor: pointer; font-family: inherit; }
```

- [ ] **Step 2: Add the compression + load/save helpers**

Find `saveKlantBeschikbaarheid()` and its closing brace (search for `async function saveKlantBeschikbaarheid()`, the function ends at the next blank line before the following function declaration). Insert this new section immediately after that closing brace:

```js

// ══════════════════════════════════════════════
// FOTO'S (service rapport bijlagen)
// ══════════════════════════════════════════════
const FOTO_API           = '/api/fotos';
const FOTO_MAX_DIM       = 1600;
const FOTO_JPEG_QUALITY  = 0.7;
const FOTO_MAX_COUNT     = 30;

function compressFotoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Bestand lezen mislukt'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Afbeelding laden mislukt'));
      img.onload = () => {
        let width = img.width, height = img.height;
        if (width > FOTO_MAX_DIM || height > FOTO_MAX_DIM) {
          const scale = FOTO_MAX_DIM / Math.max(width, height);
          width  = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', FOTO_JPEG_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function loadFotos(ticketId) {
  try {
    const res = await fetch(`${FOTO_API}?ticketId=${encodeURIComponent(ticketId)}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    console.warn("Foto's laden mislukt:", err);
    return { versie: 0, fotos: [] };
  }
}

async function saveFotos(ticketId, versie, fotos) {
  const res = await fetch(FOTO_API, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ticketId, versie, fotos }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || ('HTTP ' + res.status)), { status: res.status, data });
  return data;
}

function renderFotoGrid(container, fotos, callbacks) {
  if (!fotos.length) {
    container.innerHTML = '<div style="font-size:0.78rem;color:var(--muted);padding:6px 0">Nog geen foto\'s toegevoegd.</div>';
    return;
  }
  container.innerHTML = fotos.map(f => `
    <div class="foto-thumb" data-id="${f.id}">
      <img src="${f.dataUrl}" alt="">
      <button class="foto-thumb-del" title="Verwijderen" data-action="del" data-id="${f.id}">✕</button>
      <input class="foto-caption" type="text" placeholder="Bijschrift..." value="${escHtml(f.caption || '')}" data-action="caption" data-id="${f.id}">
    </div>`).join('');
  container.querySelectorAll('[data-action="del"]').forEach(btn =>
    btn.addEventListener('click', () => callbacks.onDelete(btn.dataset.id)));
  container.querySelectorAll('[data-action="caption"]').forEach(inp =>
    inp.addEventListener('change', () => callbacks.onCaptionInput(inp.dataset.id, inp.value)));
}
```

`escHtml` is an existing helper already used elsewhere in the file (e.g. by `renderKbSection`) — do not redefine it.

- [ ] **Step 3: Manual verification (mocked backend, real browser)**

Start the dev server (`node dev-server.mjs`) and open the app in a browser. In the devtools console:

1. Test compression in isolation — pick any small local image file via a throwaway `<input type=file>` you create in the console, or use this snippet to build a synthetic 3000×2000 canvas image and feed it through the pipeline:

```js
const testCanvas = document.createElement('canvas');
testCanvas.width = 3000; testCanvas.height = 2000;
testCanvas.getContext('2d').fillStyle = '#ff0000';
testCanvas.getContext('2d').fillRect(0, 0, 3000, 2000);
testCanvas.toBlob(async (blob) => {
  const file = new File([blob], 'test.jpg', { type: 'image/jpeg' });
  const result = await compressFotoFile(file);
  const img = new Image();
  img.onload = () => console.log('compressed dims:', img.width, img.height, 'dataUrl length:', result.length);
  img.src = result;
}, 'image/jpeg', 1.0);
```

Confirm the logged dimensions are capped at 1600 on the longest side (should log `1600 1067` or similar, never `3000 2000`), and the resulting `dataUrl` string is dramatically shorter than a naive uncompressed encode of the same canvas would be.

2. Test `loadFotos`/`saveFotos` against a mocked backend (the real `/api/fotos` can't run locally per Global Constraints):

```js
window.__origFetch = window.fetch;
window.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('/api/fotos')) {
    if (opts?.method === 'PUT') {
      const body = JSON.parse(opts.body);
      return Promise.resolve({ ok: true, json: async () => ({ versie: body.versie + 1, fotos: body.fotos }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ versie: 3, fotos: [{ id: 'a', dataUrl: 'data:image/jpeg;base64,xx', caption: 'test', tijdstip: '2026-07-24T09:00:00.000Z' }] }) });
  }
  return window.__origFetch(url, opts);
};
const loaded = await loadFotos('t1');
console.log('loadFotos result:', loaded); // expect versie:3, 1 foto
const saved = await saveFotos('t1', loaded.versie, loaded.fotos);
console.log('saveFotos result:', saved); // expect versie:4
window.fetch = window.__origFetch;
```

3. Test `renderFotoGrid` in isolation:

```js
const div = document.createElement('div');
document.body.appendChild(div);
renderFotoGrid(div, [{ id: 'x', dataUrl: 'data:image/jpeg;base64,xx', caption: 'hallo' }], {
  onDelete: (id) => console.log('delete called with', id),
  onCaptionInput: (id, v) => console.log('caption called with', id, v),
});
div.querySelector('.foto-thumb-del').click();       // expect "delete called with x" logged
div.querySelector('.foto-caption').value = 'nieuw';
div.querySelector('.foto-caption').dispatchEvent(new Event('change'));  // expect "caption called with x nieuw" logged
div.remove();
```

Report the actual console output for all three checks.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: client-side helpers voor foto-compressie en /api/fotos laden/opslaan"
```

---

### Task 3: Detail-modaal — "📷 Foto's"-knop + foto-overlay

**Files:**
- Modify: `public/index.html` (new overlay HTML near `#opl-overlay` ~line 1542-1552, detail-modal footer button ~line 1335-1342, `openDetail()` ~line 3924-3936)

**Interfaces:**
- Consumes: `loadFotos`, `saveFotos`, `renderFotoGrid`, `compressFotoFile` (Task 2).
- Produces: `openFotoModal(ticketId)` / `closeFotoModal(e)` — no other task calls these directly, but Task 4 follows the identical calling pattern for its own step, so keep the internal state shape (`_fotoState = { ticketId, versie, fotos }`) exactly as written here since Task 4's brief assumes this same variable exists and behaves this way.

- [ ] **Step 1: Manual baseline check**

Open the app (`?test` mode is fine), open any planned ticket's detail modal. Confirm today's baseline: there is no "📷 Foto's" button anywhere in the footer.

- [ ] **Step 2: Add the module-scope state and the overlay markup**

Find `let _sigTech   = null;` (around line 4500) and `let _sigKlant  = null;` right after it. Insert a new state variable immediately after:

```js
let _sigKlant  = null;
let _fotoState = { ticketId: null, versie: 0, fotos: [] };
```

Find the `#opl-overlay` block (search for `id="opl-overlay"`) and insert a new overlay immediately after its closing `</div>` (before the `<!-- Afspraakvoorstel modal -->` comment):

```html

<!-- Foto's modal -->
<div class="overlay" id="foto-overlay" onclick="closeFotoModal(event)">
  <div class="modal" id="foto-modal">
    <h3>📷 Foto's</h3>
    <div id="foto-grid" class="foto-grid"></div>
    <input type="file" id="foto-file-input" accept="image/*" multiple style="display:none" onchange="handleFotoFiles(this)">
    <button class="foto-add-btn" onclick="document.getElementById('foto-file-input').click()">+ Foto toevoegen</button>
    <div class="row-btns">
      <button class="btn-cancel" onclick="closeFotoModal()">Sluiten</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add the "📷 Foto's" button to the detail-modal footer**

Find (in the `mftr` footer, search for `id="d-btn-rapport"`):

```html
      <button class="btn-cancel" id="d-btn-rapport"  style="display:none" title="Service rapport" onclick="openRapport(activeTicket?.id,_detailDate)">📋 Rapport</button>
```

Insert a new button immediately before it:

```html
      <button class="btn-cancel" id="d-btn-fotos" style="display:none" title="Foto's" onclick="openFotoModal(activeTicket?.id)">📷 Foto's</button>
      <button class="btn-cancel" id="d-btn-rapport"  style="display:none" title="Service rapport" onclick="openRapport(activeTicket?.id,_detailDate)">📋 Rapport</button>
```

- [ ] **Step 4: Show/hide the button alongside the other plan-only buttons**

Find `openDetail()`'s visibility block (search for `document.getElementById('d-btn-rapport').style.display`):

```js
  document.getElementById('d-btn-arrival').style.display  = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-proposal').style.display = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-rapport').style.display  = showPlanBtns ? '' : 'none';
```

Replace with:

```js
  document.getElementById('d-btn-arrival').style.display  = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-proposal').style.display = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-fotos').style.display    = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-rapport').style.display  = showPlanBtns ? '' : 'none';
```

Do **not** add `desktop-only` to `#d-btn-fotos` — taking/attaching photos is on-site technician work and must stay visible on mobile, same as Aankomst and Rapport.

- [ ] **Step 5: Implement the modal's open/close/add/delete/caption logic**

Place this new function block right after `closeOpl(e)` (search for `function closeOpl(e)`, insert after its closing brace, before `async function saveOpl()`):

```js
async function openFotoModal(ticketId) {
  if (!ticketId) return;
  const { versie, fotos } = await loadFotos(ticketId);
  _fotoState = { ticketId, versie, fotos };
  renderFotoGridInto('foto-grid');
  document.getElementById('foto-overlay').classList.add('open');
}

function closeFotoModal(e) {
  if (e && e.target !== document.getElementById('foto-overlay')) return;
  document.getElementById('foto-overlay').classList.remove('open');
}

function renderFotoGridInto(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  renderFotoGrid(el, _fotoState.fotos, {
    onDelete:      (id) => persistFotoChange(_fotoState.fotos.filter(f => f.id !== id), containerId),
    onCaptionInput: (id, value) => persistFotoChange(
      _fotoState.fotos.map(f => f.id === id ? { ...f, caption: value } : f), containerId
    ),
  });
}

async function persistFotoChange(newFotos, containerId) {
  try {
    const result = await saveFotos(_fotoState.ticketId, _fotoState.versie, newFotos);
    _fotoState.versie = result.versie;
    _fotoState.fotos  = result.fotos;
  } catch (err) {
    if (err.status === 409) {
      toast('⚠️ Foto\'s zijn elders gewijzigd, herladen...', 3000);
      const fresh = await loadFotos(_fotoState.ticketId);
      _fotoState.versie = fresh.versie;
      _fotoState.fotos  = fresh.fotos;
    } else {
      toast('❌ Foto opslaan mislukt: ' + err.message, 4000);
    }
  }
  renderFotoGridInto(containerId);
}

async function handleFotoFiles(input) {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  if (_fotoState.fotos.length + files.length > FOTO_MAX_COUNT) {
    return toast(`⚠️ Maximaal ${FOTO_MAX_COUNT} foto's per ticket`, 3500);
  }
  toast(`📷 ${files.length} foto${files.length > 1 ? "'s" : ''} verwerken...`, 4000);
  const nieuwe = [];
  for (const file of files) {
    try {
      const dataUrl = await compressFotoFile(file);
      nieuwe.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, dataUrl, caption: '', tijdstip: new Date().toISOString() });
    } catch (err) {
      toast('❌ Foto verwerken mislukt: ' + err.message, 4000);
    }
  }
  if (nieuwe.length) await persistFotoChange([..._fotoState.fotos, ...nieuwe], 'foto-grid');
}
```

- [ ] **Step 6: Manual verification (mocked backend)**

With the dev server running, open the app, mock `window.fetch` for `/api/fotos` exactly as in Task 2 Step 3.2 (keep it installed for this whole verification — don't restore `window.fetch` yet). Open a planned ticket's detail modal, confirm the "📷 Foto's" button is now visible (and hidden for an unplanned ticket, matching Aankomst/Rapport). Click it — confirm the modal opens showing the one mocked photo. Click its ✕ — confirm (via a `console.log` you temporarily add to the mock's PUT branch, or by inspecting `_fotoState.fotos.length` in the console afterward) that a PUT was sent with an empty `fotos` array. Type into the caption field and blur it — confirm a PUT was sent with the caption included. Click "+ Foto toevoegen" and select a real small image file from disk — confirm a new thumbnail appears and a PUT fired with the compressed result appended. Close the modal. Restore `window.fetch = window.__origFetch` when done.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: foto's toevoegen/beheren via detail-modaal (buiten de wizard)"
```

---

### Task 4: Wizard-stap "Foto's"

**Files:**
- Modify: `public/index.html` (`R` object ~line 4504-4516, `WIZ_STEPS` ~line 4518-4526, `openRapport()` ~line 4528+, new render/save functions inserted after `wizSaveOmschrijving()` ~line 4988)

**Interfaces:**
- Consumes: `_fotoState`, `renderFotoGridInto`, `persistFotoChange`, `handleFotoFiles` (Task 3) — the wizard step reuses these verbatim rather than duplicating the grid/CRUD logic. `loadFotos` (Task 2).
- Produces: `R.fotos` (array, same shape as `_fotoState.fotos`) — consumed by Task 5 for report embedding.

- [ ] **Step 1: Manual baseline check**

Open the rapport wizard for any planned ticket (mock `/api/fotos` as before, or note that `openRapport` doesn't call it yet at this point). Confirm today's baseline: the wizard has 7 steps (Algemeen → Facturatie → Product → Omschrijving → Status → Handtekening 1 → Handtekening 2), no "Foto's" step.

- [ ] **Step 2: Add `R.fotos` and the new step**

Find the `R` object (around line 4504-4516):

```js
const R = {
  datum: '', technieker: '', adres: '', start: '', stop: '', werktijd: '',
  facturatie: 'klant', facturatieVrij: '',
  servicetype: '2e-lijn',
  aanrijtijdMin: 0,
  interventieType: 'Interventie',
  installateur: '', serienummer: '', type: '', uitvoering: '', kabel: '', kabellengte: '',
  probleem: '', acties: '',
  oorzaakStoring: [],
  hersteld: 'nee', nieuwInter: 'nee',
  varia: '',
  onderdelen: [],
};
```

Replace with:

```js
const R = {
  datum: '', technieker: '', adres: '', start: '', stop: '', werktijd: '',
  facturatie: 'klant', facturatieVrij: '',
  servicetype: '2e-lijn',
  aanrijtijdMin: 0,
  interventieType: 'Interventie',
  installateur: '', serienummer: '', type: '', uitvoering: '', kabel: '', kabellengte: '',
  probleem: '', acties: '',
  oorzaakStoring: [],
  fotos: [],
  hersteld: 'nee', nieuwInter: 'nee',
  varia: '',
  onderdelen: [],
};
```

Find `WIZ_STEPS` (around line 4518-4526):

```js
const WIZ_STEPS = [
  { id: 'algemeen',     label: 'Algemeen',      render: wizRenderAlgemeen,     save: wizSaveAlgemeen     },
  { id: 'facturatie',   label: 'Facturatie',     render: wizRenderFacturatie,   save: wizSaveFacturatie   },
  { id: 'product',      label: 'Product',        render: wizRenderProduct,      save: wizSaveProduct      },
  { id: 'omschrijving', label: 'Omschrijving',   render: wizRenderOmschrijving, save: wizSaveOmschrijving },
  { id: 'status',       label: 'Status',         render: wizRenderStatus,       save: wizSaveStatus       },
  { id: 'sig-tech',     label: 'Handtekening 1', render: wizRenderSigTech,      save: () => {}            },
  { id: 'sig-klant',    label: 'Handtekening 2', render: wizRenderSigKlant,     save: () => {}            },
];
```

Replace with:

```js
const WIZ_STEPS = [
  { id: 'algemeen',     label: 'Algemeen',      render: wizRenderAlgemeen,     save: wizSaveAlgemeen     },
  { id: 'facturatie',   label: 'Facturatie',     render: wizRenderFacturatie,   save: wizSaveFacturatie   },
  { id: 'product',      label: 'Product',        render: wizRenderProduct,      save: wizSaveProduct      },
  { id: 'omschrijving', label: 'Omschrijving',   render: wizRenderOmschrijving, save: wizSaveOmschrijving },
  { id: 'fotos',        label: "Foto's",         render: wizRenderFotos,        save: wizSaveFotos        },
  { id: 'status',       label: 'Status',         render: wizRenderStatus,       save: wizSaveStatus       },
  { id: 'sig-tech',     label: 'Handtekening 1', render: wizRenderSigTech,      save: () => {}            },
  { id: 'sig-klant',    label: 'Handtekening 2', render: wizRenderSigKlant,     save: () => {}            },
];
```

- [ ] **Step 3: Fetch existing photos when a wizard session opens**

Find, inside `openRapport()`, the line that resets `R.oorzaakStoring`:

```js
  R.probleem     = ticket.subject || '';
  R.acties       = '';
  R.oorzaakStoring = [];
  R.varia        = '';
  R.onderdelen   = [];
```

Replace with:

```js
  R.probleem     = ticket.subject || '';
  R.acties       = '';
  R.oorzaakStoring = [];
  R.varia        = '';
  R.onderdelen   = [];
  const fotoData  = await loadFotos(ticketId);
  _fotoState      = { ticketId, versie: fotoData.versie, fotos: fotoData.fotos };
  R.fotos         = _fotoState.fotos;
```

`openRapport` is already declared `async function openRapport(ticketId, date) {`, so this `await` is valid without further changes.

- [ ] **Step 4: Add the step's render/save functions**

Find `wizSaveOmschrijving()`'s closing brace and the `// ── Stap 5: Status & onderdelen ──` comment right after it (around line 4988-4990). Insert a new step block between them:

```js

// ── Stap 4b: Foto's ──
function wizRenderFotos(el) {
  el.innerHTML = `
    <div class="wiz-step-title">Foto's</div>
    <div class="wiz-field">
      <div id="wiz-foto-grid" class="foto-grid"></div>
      <input type="file" id="wiz-foto-file-input" accept="image/*" multiple style="display:none" onchange="handleWizFotoFiles(this)">
      <button class="foto-add-btn" onclick="document.getElementById('wiz-foto-file-input').click()">+ Foto toevoegen</button>
    </div>`;
  renderFotoGridInto('wiz-foto-grid');
}
function wizSaveFotos() {
  R.fotos = _fotoState.fotos;
}
async function handleWizFotoFiles(input) {
  await handleFotoFiles(input);
  R.fotos = _fotoState.fotos;
}
```

`handleFotoFiles` (Task 3) already re-renders whichever grid container currently holds the photos via `persistFotoChange`'s `containerId` argument — but it was written assuming the detail-modal's `'foto-grid'` id. Since `wizRenderFotos` uses a different container id (`'wiz-foto-grid'`), **you must first make `handleFotoFiles` container-aware.** Find (from Task 3, in `handleFotoFiles`):

```js
  if (nieuwe.length) await persistFotoChange([..._fotoState.fotos, ...nieuwe], 'foto-grid');
```

Replace with a version that takes the container id as a parameter — update the function signature and this call together:

```js
async function handleFotoFiles(input, containerId = 'foto-grid') {
  const files = Array.from(input.files || []);
  input.value = '';
  if (!files.length) return;
  if (_fotoState.fotos.length + files.length > FOTO_MAX_COUNT) {
    return toast(`⚠️ Maximaal ${FOTO_MAX_COUNT} foto's per ticket`, 3500);
  }
  toast(`📷 ${files.length} foto${files.length > 1 ? "'s" : ''} verwerken...`, 4000);
  const nieuwe = [];
  for (const file of files) {
    try {
      const dataUrl = await compressFotoFile(file);
      nieuwe.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, dataUrl, caption: '', tijdstip: new Date().toISOString() });
    } catch (err) {
      toast('❌ Foto verwerken mislukt: ' + err.message, 4000);
    }
  }
  if (nieuwe.length) await persistFotoChange([..._fotoState.fotos, ...nieuwe], containerId);
}
```

And update `wizRenderFotos`'s file input to pass the container id explicitly:

```html
    <input type="file" id="wiz-foto-file-input" accept="image/*" multiple style="display:none" onchange="handleWizFotoFiles(this)">
```

stays calling `handleWizFotoFiles`, but `handleWizFotoFiles` itself now reads:

```js
async function handleWizFotoFiles(input) {
  await handleFotoFiles(input, 'wiz-foto-grid');
  R.fotos = _fotoState.fotos;
}
```

(This step touches one line inside Task 3's `handleFotoFiles` — that is expected and is the reason Task 4 depends on Task 3 being complete first; it is not a sign Task 3 was done wrong.)

- [ ] **Step 5: Manual verification (mocked backend)**

Mock `/api/fotos` as before. Open the rapport wizard for a planned ticket. Click "Volgende →" three times to reach the new "Foto's" step (5 / 8 now, not 5 / 7). Confirm the mocked photo appears in the grid. Add a photo via "+ Foto toevoegen" — confirm it appears and `R.fotos` (check via console: `R.fotos.length`) reflects the addition. Click "← Vorige" then "Volgende →" again — confirm the photo is still there (state survives step navigation, same as other fields). Click "Volgende →" to proceed to "Status" (6 / 8) — confirm no validation blocks this step (it's optional, unlike Omschrijving's oorzaak-storing check).

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: nieuwe wizard-stap Foto's, haalt en toont opgeslagen foto's"
```

---

### Task 5: Foto's inbedden in het gegenereerde rapport

**Files:**
- Modify: `public/index.html` (`buildRapportHtml()`, the section right after "Oorzaak storing" ~line 5397-5398)

**Interfaces:**
- Consumes: `R.fotos` (Task 4).

- [ ] **Step 1: Manual baseline check**

Open the rapport wizard, add at least one photo via the new "Foto's" step (mocked backend as before), click through to the end and print/preview the report (or call `buildRapportHtml()` directly in the console, as done earlier in this project's history for similar verifications). Confirm today's baseline: no photos appear anywhere in the generated HTML.

- [ ] **Step 2: Add the photo section**

Find (around line 5397-5398):

```html
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
```

Replace with:

```html
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
${R.fotos.length ? `<div class="sec">Foto's</div>
<div class="foto-report-grid">${R.fotos.map(f => `<div class="foto-report-item"><img src="${f.dataUrl}" style="max-width:100%;border-radius:3px"><div style="font-size:7.5pt;color:#777;margin-top:2px">${new Date(f.tijdstip).toLocaleString('nl-BE')}${f.caption ? ' — ' + f.caption : ''}</div></div>`).join('')}</div>` : ''}
```

- [ ] **Step 3: Add the report-only grid CSS**

`buildRapportHtml()`'s `<style>` block (inside the template string, distinct from the app's own `<style>` at the top of the file — it's the print/PDF stylesheet) already defines `.info-grid`/`table.parts` etc. Find that block's `.sig-row`/`.sig-box` rules near the end (search for `.sig-box-title` inside `buildRapportHtml`) and insert immediately after:

```css
  .foto-report-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px}
  .foto-report-item{border:1px solid #e0e0e0;border-radius:4px;padding:4px;background:#fafafa}
```

- [ ] **Step 4: Manual verification**

Repeat Step 1's setup (mocked backend, one photo added via the wizard's Foto's step), reach the end of the wizard, and call `buildRapportHtml()` directly in the console (as in Step 1) rather than relying on the popup-blocked print window:

```js
const html = buildRapportHtml();
console.log(html.includes('Foto\'s'), html.includes(R.fotos[0].dataUrl.slice(0, 50)));
```

Confirm both log `true` — the section header is present and the actual photo data made it into the generated HTML. Also verify with `R.fotos = []` (no photos added) that the section is entirely absent (`html.includes("Foto's")` → `false`) rather than rendering an empty section — re-run `buildRapportHtml()` after clearing `R.fotos` to confirm.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: foto's inbedden in het gegenereerde service rapport"
```

---

## Post-plan note

None of the five commits above are pushed. When Brent confirms it's time to deploy, push together with any other pending local commits.
