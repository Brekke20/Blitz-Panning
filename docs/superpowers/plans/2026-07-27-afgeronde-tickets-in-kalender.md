# Afgeronde Tickets in Kalender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep tickets visible in the Kalender week-view after they close in Zoho, for any date on which a service rapport was actually filed for them — using the rapport's own real start/stop hours, not the original plan.

**Architecture:** All changes are client-side, inside the single-file PWA `public/index.html`. The existing rapport-archief (`/api/rapport-archief`, unchanged) is the only new data source — it's just not loaded early enough today, and its data isn't rendered in the Kalender yet. No backend/Netlify Functions changes.

**Tech Stack:** Vanilla JS (no framework, no build step), local dev server (`node dev-server.mjs`, port 3333) for manual verification.

## Global Constraints

- No backend/Netlify Functions changes — `public/index.html` only.
- All UI text in Dutch.
- **No automated test framework exists in this codebase.** Every verification step below is a manual procedure against the local dev server, using the app's `?test` query-param mode and direct browser-console state injection.
- Only tickets that have an actual archived rapport get a historical tile — never tickets that were merely planned and then vanished without a rapport (explicit scope decision).
- Commit after each task with `git add public/index.html` (never `-A`) and a `feat:`/`fix:` prefixed message. **Do not push** — this repo auto-deploys to production on push to `main`; Brent confirms separately when it's time to push.
- **⚠️ Known failure mode from an earlier session today:** an implementer subagent's `git commit` landed directly on local `main` in the main repository checkout instead of the isolated worktree branch, because its Bash tool's working directory did not reliably follow the parent session's `EnterWorktree` switch. This created a stray commit on `main` that had to be reverted. **Every dispatch to an implementer/fixer subagent in this plan's execution MUST explicitly instruct it to prefix every Bash command with an absolute `cd "<worktree path>" &&`, and to run `git branch --show-current` to confirm it matches the expected worktree branch name immediately before any `git commit`.** The controller must also independently check `git log --oneline -3` in *both* the worktree and the main checkout after each implementer report, not just at final-merge time.

---

### Task 1: Rapport-archief eager laden bij app-start

**Files:**
- Modify: `public/index.html` (DOMContentLoaded handler ~line 1836, `laadRapportArchief()` ~line 5983-5996)

**Interfaces:**
- Produces: `_rapportArchief` (existing global array) is now populated before the user ever opens the Kalender or Rapporten tab, not only on-demand. Task 2 consumes `_rapportArchief` directly (it's already a module-level global, no new interface needed).

- [ ] **Step 1: Manual baseline check**

Start the dev server: `node dev-server.mjs` (from the repo root). In a browser, open `http://localhost:3333/?test`, immediately click the **Kalender** tab (without ever opening the Rapporten tab first), open devtools console, and run:

```js
console.log(_rapportArchief);
```

Confirm today's baseline: this logs `[]` (empty) — the archive hasn't been fetched yet, because it's only loaded when the Rapporten tab is opened.

- [ ] **Step 2: Load the archive eagerly at startup**

Find (line 1830-1837):

```js
  });
  initMap();
  loadPrijzen();
  loadAvailability();
  loadAfspraken();
  loadKlantBeschikbaarheid();
  loadTickets();
  startTicketPolling();
```

Replace with:

```js
  });
  initMap();
  loadPrijzen();
  loadAvailability();
  loadAfspraken();
  loadKlantBeschikbaarheid();
  loadTickets();
  laadRapportArchief();
  startTicketPolling();
```

- [ ] **Step 3: Re-render the Kalender once the archive finishes loading**

Find (line 5983-5996):

```js
async function laadRapportArchief() {
  const body = document.getElementById('rapp-archief-body');
  if (!body) return;
  body.innerHTML = '<div style="color:var(--muted);font-size:0.82rem">Laden…</div>';
  try {
    const res  = await fetch('/api/rapport-archief');
    const data = await res.json();
    _rapportArchief = data.rapports || [];
    _archiefVersie = data.versie || 0;
    renderRapportArchief();
  } catch (err) {
    body.innerHTML = `<div style="color:var(--red);font-size:0.82rem">❌ Laden mislukt: ${err.message}</div>`;
  }
}
```

Replace with:

```js
async function laadRapportArchief() {
  const body = document.getElementById('rapp-archief-body');
  if (!body) return;
  body.innerHTML = '<div style="color:var(--muted);font-size:0.82rem">Laden…</div>';
  try {
    const res  = await fetch('/api/rapport-archief');
    const data = await res.json();
    _rapportArchief = data.rapports || [];
    _archiefVersie = data.versie || 0;
    renderRapportArchief();
    renderKalender();
  } catch (err) {
    body.innerHTML = `<div style="color:var(--red);font-size:0.82rem">❌ Laden mislukt: ${err.message}</div>`;
  }
}
```

**Note for the implementer:** `document.getElementById('rapp-archief-body')` (line 5984) always exists in the page's static HTML (the Rapporten tab's container div is always in the DOM, just hidden via CSS when that tab isn't active) — so the early `if (!body) return;` guard does not block this from running at startup, before Task 2 exists this has no visible effect since nothing reads `_rapportArchief` in the Kalender yet.

- [ ] **Step 4: Manual verification — archive loads before any tab is opened, and refresh doesn't break anything**

Hard-refresh `http://localhost:3333/?test`. Without clicking anything else, open devtools console and run:

```js
await new Promise(r => setTimeout(r, 500));
console.log(_rapportArchief.length, _archiefVersie);
```

Confirm `_rapportArchief.length` is now a number greater than or equal to 0 reflecting real fetched data (in `?test` mode this hits the real `/api/rapport-archief` endpoint against the dev server — if it's empty because no rapports exist yet in the local Blob store, that's fine and expected; the key check is that the fetch *ran* without you opening the Rapporten tab first — confirm via the Network tab that a GET to `/api/rapport-archief` fired automatically on page load).

Then click the **Rapporten** tab manually — confirm it still loads/re-renders correctly (no double-fetch race, no crash) — this exercises the exact same `laadRapportArchief()` function from its original call site, now just also called earlier.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: laad rapport-archief al bij app-start i.p.v. enkel bij Rapporten-tab"
```

---

### Task 2: Historische "Afgerond"-tegels in de Kalender week-view

**Files:**
- Modify: `public/index.html` (CSS ~line 522-531; `buildTicketCard`/`buildLocalEventCard` area ~line 2202-2256 for the new `buildReportCard`; `renderKalender()`'s week-view loop ~line 2355-2378)

**Interfaces:**
- Consumes: `_rapportArchief` (populated by Task 1 at startup, but this task works correctly regardless of *when* it was populated — even if empty, it just renders nothing extra).
- Produces: `buildReportCard(entry)` — new module-level function, self-contained, no other task depends on it.

- [ ] **Step 1: Manual baseline check**

With the dev server running, open `http://localhost:3333/?test`, open devtools console, and inject a fake archived rapport for a date in the current visible week (so you don't have to navigate):

```js
const d = localISO(new Date());
_rapportArchief.push({
  id: 'test-report-1', datum: d, technieker: 'Tim',
  ticketId: 'ticket-that-is-now-closed', ticketNumber: '9001',
  klant: 'Voorbeeld Klant BV', adres: 'Teststraat 1, Gent',
  rapportData: { start: '09:00', stop: '10:45' },
});
renderKalender();
```

Confirm today's baseline: nothing new appears on that day's column — the archive entry is completely ignored by the Kalender today.

- [ ] **Step 2: Add the "Afgerond" CSS classes**

Find (line 522-523):

```css
    .cal-ticket.pending::before  { background: var(--orange); }
    .cal-ticket.confirmed::before { background: var(--green); }
```

Replace with:

```css
    .cal-ticket.pending::before  { background: var(--orange); }
    .cal-ticket.confirmed::before { background: var(--green); }
    .cal-ticket.afgerond::before { background: var(--muted); }
```

Find (line 529-530):

```css
    .cal-badge.pending  { background: var(--orange-dim); color: var(--orange); }
    .cal-badge.confirmed { background: var(--green-dim);  color: var(--green); }
```

Replace with:

```css
    .cal-badge.pending  { background: var(--orange-dim); color: var(--orange); }
    .cal-badge.confirmed { background: var(--green-dim);  color: var(--green); }
    .cal-badge.afgerond { background: var(--surface3); color: var(--muted); }
```

Find (line 524, right after the `.confirmed::before` rule you just extended — locate this exact line, which stays unchanged, to anchor the next insertion after it):

```css
    .cal-ticket:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.35); background: var(--surface2); }
```

Replace with:

```css
    .cal-ticket.afgerond { opacity: 0.7; }
    .cal-ticket:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.35); background: var(--surface2); }
```

- [ ] **Step 3: Add the `buildReportCard` function**

Find (line 2230-2232, the blank line and start of `buildLocalEventCard` right after `buildTicketCard`'s closing brace):

```js
  return card;
}

function buildLocalEventCard(ev) {
```

Replace with:

```js
  return card;
}

function buildReportCard(entry) {
  const rd = entry.rapportData || {};
  const tijdLabel = rd.start ? `${rd.start}${rd.stop ? '–' + rd.stop : ''}` : '';
  const card = document.createElement('div');
  card.className = 'cal-ticket afgerond';
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
      <div style="flex:1;min-width:0">
        <div class="cal-num">#${escHtml(entry.ticketNumber || entry.ticketId || '')}</div>
        <span class="cal-badge afgerond">✅ Afgerond</span>
        ${tijdLabel ? `<div class="cal-meta" style="font-weight:600">🕐 ${tijdLabel}</div>` : ''}
        <div class="cal-sub">${escHtml(entry.klant) || '—'}</div>
        ${entry.technieker ? `<div class="cal-meta">${escHtml(entry.technieker)}</div>` : ''}
        <div class="cal-addr ${entry.adres ? '' : 'miss'}">${entry.adres ? escHtml(entry.adres) : 'Geen adres'}</div>
      </div>
    </div>`;
  card.addEventListener('click', () => herOpenRapport(_rapportArchief.indexOf(entry)));
  return card;
}

function buildLocalEventCard(ev) {
```

- [ ] **Step 4: Add the `dayReports` filter and merge it into the timeline**

Find (line 2355-2365):

```js
    // Lokale afspraken (import / manueel)
    const dayEvents = localEvents.filter(e => {
      if (e.datum !== dateStr) return false;
      if (activeAssigneeFilter === 'all') return true;
      return !e.persoon || e.persoon === activeAssigneeFilter;
    });

    const timeline = [
      ...dayStops.map(stop => ({ kind: 'ticket', sortKey: stop.uur || '99:99', stop })),
      ...dayEvents.map(ev   => ({ kind: 'event',  sortKey: ev.uur   || '99:99', ev })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
```

Replace with:

```js
    // Lokale afspraken (import / manueel)
    const dayEvents = localEvents.filter(e => {
      if (e.datum !== dateStr) return false;
      if (activeAssigneeFilter === 'all') return true;
      return !e.persoon || e.persoon === activeAssigneeFilter;
    });

    // Afgeronde tickets met een rapport (blijven zichtbaar ook nadat Zoho ze sluit/verwijdert).
    // Uitgesloten als het ticket toevallig nog live in dayStops staat (rapport al gemaakt,
    // ticket in Zoho nog niet gesloten) — anders zie je hetzelfde ticket dubbel.
    const dayReports = _rapportArchief.filter(r =>
      r.datum === dateStr &&
      (activeAssigneeFilter === 'all' || r.technieker === activeAssigneeFilter) &&
      !dayStops.some(s => s.ticket.id === r.ticketId)
    );

    const timeline = [
      ...dayStops.map(stop => ({ kind: 'ticket', sortKey: stop.uur || '99:99', stop })),
      ...dayEvents.map(ev   => ({ kind: 'event',  sortKey: ev.uur   || '99:99', ev })),
      ...dayReports.map(r    => ({ kind: 'report', sortKey: r.rapportData?.start || '99:99', report: r })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
```

- [ ] **Step 5: Render the `report` timeline items and fix the empty-day placeholder**

Find (line 2367-2378):

```js
    timeline.forEach(item => {
      const card = item.kind === 'ticket'
        ? buildTicketCard(item.stop, dateStr)
        : buildLocalEventCard(item.ev);
      col.querySelector('.day-body').appendChild(card);
    });

    // "—" placeholder verwijderen als er nu events zijn
    if (dayStops.length === 0 && dayEvents.length > 0) {
      const empty = col.querySelector('.day-empty');
      if (empty) empty.remove();
    }
```

Replace with:

```js
    timeline.forEach(item => {
      const card = item.kind === 'ticket' ? buildTicketCard(item.stop, dateStr)
        : item.kind === 'event' ? buildLocalEventCard(item.ev)
        : buildReportCard(item.report);
      col.querySelector('.day-body').appendChild(card);
    });

    // "—" placeholder verwijderen als er nu events of afgeronde rapporten zijn
    if (dayStops.length === 0 && (dayEvents.length > 0 || dayReports.length > 0)) {
      const empty = col.querySelector('.day-empty');
      if (empty) empty.remove();
    }
```

**Note for the implementer:** do not touch the "Route berekenen"-button visibility condition a few lines further down (`if (dayStops.length > 0 || dayEvents.some(...))`) — historical rapporten deliberately do not affect that button, per the spec.

- [ ] **Step 6: Manual verification — tile appears, correct style, correct click behavior, no duplicates**

Hard-refresh `http://localhost:3333/?test`, re-run the exact injection from Step 1, and confirm:

1. A new tile appears on that day, styled distinctly (dimmed, grey left-edge bar) with a **"✅ Afgerond"** badge, showing **"🕐 09:00–10:45"**, **"Voorbeeld Klant BV"**, and **"Teststraat 1, Gent"**. No "×" button, no Bellen/Navigeer buttons.
2. Click the tile. Confirm it attempts to open a rapport (it will show the toast `"Geen opgeslagen HTML beschikbaar"` since this fake test entry has no `rapportData._html` — that confirms `herOpenRapport()` was correctly reached with the correct index, not that a real PDF renders; that part of the code is untouched by this plan).
3. **Duplicate check**: add a live ticket to `planning[d]` with the *same* `ticket.id` as the fake report's `ticketId`, then call `renderKalender()` again:
   ```js
   planning[d] = planning[d] || [];
   planning[d].push({ ticket: { id: 'ticket-that-is-now-closed', number: '9001', subject: 'Live versie', status: 'Ingepland', assignee: 'Tim', hasAddress: false, phone: '' }, address: '', uur: '08:00' });
   renderKalender();
   ```
   Confirm only ONE tile for this ticket appears now (the live "Ingepland"-style one at 08:00, not a second "Afgerond" duplicate) — this proves the `!dayStops.some(...)` dedup works.
4. Remove that live entry (`planning[d] = planning[d].filter(p => p.ticket.id !== 'ticket-that-is-now-closed'); renderKalender();`) and confirm the "Afgerond" tile reappears.
5. **Empty-day placeholder check**: pick a day in the visible week with zero live tickets/events, inject a fake report entry for that day's date, call `renderKalender()`, and confirm the "—" placeholder is gone and the Afgerond tile shows instead.
6. **Assignee filter check**: switch the active technician filter (top of Kalender) to someone other than `'Tim'` and confirm the injected report disappears; switch back to "Iedereen"/`'Tim'` and confirm it reappears.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: toon afgeronde tickets met rapport als historische tegel in de kalender"
```

---

## Post-plan note

Neither commit above is pushed. When Brent confirms it's time to deploy, push both with a single `git push origin main` — Netlify auto-deploys ~30s after.
