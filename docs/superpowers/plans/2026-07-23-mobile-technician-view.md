# Mobiele technieker-weergave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict the app to a simplified, on-site-only view for screens narrower than 1024px, while leaving the full coordinator view unchanged at 1024px and up.

**Architecture:** Pure CSS: a single `desktop-only` class plus one `@media (max-width: 1023px)` rule hides every coordinator-only tab/button/section. A small JS safeguard forces the active tab to Kalender if a hidden tab was active when the viewport crosses into mobile width (or on initial load on a phone, where the HTML's default active tab is Wachtrij).

**Tech Stack:** Vanilla JS/CSS in `public/index.html`, no build step, no framework.

## Global Constraints

- No backend/Netlify Functions changes — `public/index.html` only.
- Mechanism is CSS class + media query (`desktop-only` / `max-width: 1023px`), not JS-conditional rendering — matches the plan's design decision to keep this low-risk and consistent with the file's existing all-CSS-driven visibility pattern.
- No automated test framework exists in this codebase. Verification is manual: resize the browser to an exact width (e.g. via the `resize_window` browser tool, or a plain browser resize) at 1000px (mobile) and 1280px (desktop) and confirm the expected elements are present/absent. State plainly in any report which parts were actually exercised in a browser vs. verified by code inspection only.
- Commit after each task with `git add public/index.html` (never `-A`) and a `feat:` prefixed message. **Do not push.**

---

### Task 1: CSS-mechanisme + statische HTML-elementen

**Files:**
- Modify: `public/index.html` (CSS ~line 1048-1054, tab bar ~line 1231-1235, header ~line 1226, detail-modaal ~line 1327-1334)

**Interfaces:**
- Produces: a `.desktop-only` CSS class — any element carrying it disappears below 1024px viewport width. This is the single mechanism Task 2 also uses for dynamically-created elements.

- [ ] **Step 1: Add the media query rule**

Find (around line 1048-1054):

```css
    @media (max-width: 680px) {
      .plan-body { flex-direction: column; }
      #route-list { width: 100%; border-right: none; border-bottom: 1px solid var(--border); }
      #map-wrap { height: 260px; } #map { height: 260px; }
      .week-grid { flex-direction: column; }
      .day-col { min-width: unset; border-right: none; border-bottom: 1px solid var(--border); }
    }
```

Insert immediately after (before the `/* ── Prijsbeheer admin modal ── */` comment that follows):

```css
    /* Beperkte technieker-weergave: verbergt coördinator/planning-functionaliteit onder 1024px */
    @media (max-width: 1023px) {
      .desktop-only { display: none !important; }
    }
```

- [ ] **Step 2: Hide the Wachtrij/Route/Rapporten tabs**

Find (around line 1231):

```html
    <div class="tab active" id="tab-tickets"  onclick="event.stopPropagation(); setTab('tickets')">Wachtrij <span class="badge" id="cnt-tickets">0</span></div>
```

Replace with:

```html
    <div class="tab active desktop-only" id="tab-tickets"  onclick="event.stopPropagation(); setTab('tickets')">Wachtrij <span class="badge" id="cnt-tickets">0</span></div>
```

Find (around line 1233):

```html
    <div class="tab"        id="tab-planning" onclick="event.stopPropagation(); setTab('planning')">Route</div>
```

Replace with:

```html
    <div class="tab desktop-only" id="tab-planning" onclick="event.stopPropagation(); setTab('planning')">Route</div>
```

Find (around line 1235):

```html
    <div class="tab"        id="tab-rapporten" onclick="event.stopPropagation(); setTab('rapporten')">Rapporten</div>
```

Replace with:

```html
    <div class="tab desktop-only" id="tab-rapporten" onclick="event.stopPropagation(); setTab('rapporten')">Rapporten</div>
```

(Kalender-tab (`#tab-kalender`) en Ingepland-tab (`#tab-gepland`) blijven ongewijzigd — geen `desktop-only`.)

- [ ] **Step 3: Hide the Instellingen header button**

Find (around line 1226):

```html
  <button class="hbtn" onclick="openSettings()" title="Instellingen">⚙</button>
```

Replace with:

```html
  <button class="hbtn desktop-only" onclick="openSettings()" title="Instellingen">⚙</button>
```

- [ ] **Step 4: Hide Klantbeschikbaarheid, plan-toggle, and Voorstel in the detail modal**

Find (around line 1327):

```html
      <div class="msec"><div class="msec-title">Ticketdetails</div><div id="d-ticket"></div><div id="kb-section"></div></div>
```

Replace with:

```html
      <div class="msec"><div class="msec-title">Ticketdetails</div><div id="d-ticket"></div><div class="desktop-only" id="kb-section"></div></div>
```

Find (around line 1331):

```html
      <button class="btn-save"   id="d-plan-btn" onclick="togglePlanFromDetail()"></button>
```

Replace with:

```html
      <button class="btn-save desktop-only" id="d-plan-btn" onclick="togglePlanFromDetail()"></button>
```

Find (around line 1334):

```html
      <button class="btn-cancel" id="d-btn-proposal" style="display:none" title="Afspraakvoorstel sturen" onclick="openProposal(activeTicket?.id,_detailDate,(()=>{const t=computeArrivalTimes(_detailDate);return activeTicket?t[activeTicket.id]??null:null})())">📨 Voorstel</button>
```

Replace with:

```html
      <button class="btn-cancel desktop-only" id="d-btn-proposal" style="display:none" title="Afspraakvoorstel sturen" onclick="openProposal(activeTicket?.id,_detailDate,(()=>{const t=computeArrivalTimes(_detailDate);return activeTicket?t[activeTicket.id]??null:null})())">📨 Voorstel</button>
```

(`#d-btn-arrival` and `#d-btn-rapport`, the two lines directly below `#d-btn-proposal`, are deliberately **not** touched — Aankomst and Rapport stay visible on mobile per the spec.)

- [ ] **Step 5: Manual verification**

Open the app in a browser (any static file server or `node dev-server.mjs` works — this task touches no backend behavior). Resize the viewport to **1000px wide** (e.g. the `resize_window` browser tool with `width: 1000, height: 800`, or manually).

Confirm at 1000px:
1. Tab bar shows only "Kalender" and "Ingepland" — Wachtrij, Route, Rapporten tabs are gone.
2. The ⚙️ Instellingen button in the header is gone (🔄 Vernieuwen and 🌙/☀️ theme toggle remain).
3. Open any ticket's detail modal (from Kalender or Ingepland) — confirm the "Klantbeschikbaarheid" section is gone, and the footer shows only Sluiten / ✏️ Oplossing / ⏱️ Aankomst / 📋 Rapport (no plan-toggle button, no "📨 Voorstel" button).

Resize to **1280px wide**. Confirm all of the above are back: 5 tabs visible, Instellingen button visible, and reopening a detail modal shows Klantbeschikbaarheid + the plan-toggle button + Voorstel button again (exact visibility of the plan-toggle button still depends on ticket status, as before — that logic is untouched).

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: verberg planning-tabs en coördinator-acties onder 1024px"
```

---

### Task 2: Dynamisch aangemaakte elementen (Kalender-chrome + persoon-kiezer)

**Files:**
- Modify: `public/index.html` (`buildPersonSelector()` ~line 1929, `renderKalender()` ~line 2253-2256 and ~line 2327)

**Interfaces:**
- Consumes: the `.desktop-only` mechanism from Task 1 (same CSS rule, no new CSS needed).

- [ ] **Step 1: Manual baseline check**

At 1000px viewport width, open the persoon-kiezer dropdown (top-right "Alle ▾") and open the Kalender tab. Confirm today's baseline: "Alle technici" still appears as an option in the dropdown, and each day column still shows a capacity badge (e.g. "0/3 stops · ±0u"), a "⏱ Beschikbaar"/"🔒 Geblokkeerd" button, and (for days with stops) a "Route berekenen" button.

- [ ] **Step 2: Hide "Alle technici" from the person-selector on mobile**

Find (around line 1929-1933):

```js
  const allItem = document.createElement('button');
  allItem.className = `pm-item${activeAssigneeFilter === 'all' ? ' active' : ''}`;
  allItem.innerHTML = `<div class="pm-avatar">A</div><div class="pm-item-info"><div class="pm-item-name">Alle technici</div><div class="pm-item-sub">Gecombineerde weergave</div></div>`;
  allItem.onclick = () => selectPerson('all');
  menu.appendChild(allItem);
```

Replace the `className` line with:

```js
  const allItem = document.createElement('button');
  allItem.className = `pm-item desktop-only${activeAssigneeFilter === 'all' ? ' active' : ''}`;
  allItem.innerHTML = `<div class="pm-avatar">A</div><div class="pm-item-info"><div class="pm-item-name">Alle technici</div><div class="pm-item-sub">Gecombineerde weergave</div></div>`;
  allItem.onclick = () => selectPerson('all');
  menu.appendChild(allItem);
```

- [ ] **Step 3: Hide the day-capacity badge and beschikbaarheid-knop per Kalender day**

Find (around line 2249-2260):

```js
    col.innerHTML = `
      <div class="day-hdr">
        <div class="day-hdr-name ${isToday ? 'today' : isPast ? 'past' : ''}">${day.toLocaleDateString('nl-BE', { weekday:'short' })}</div>
        <div class="day-hdr-num${isToday ? ' today' : ''}">${day.getDate()}</div>
        <div class="day-cap ${capFull ? 'full' : ''}">${holidayName ? `🎌 ${holidayName}` : isDayBlocked ? '🔒 Geblokkeerd' : capLabel}</div>
        <button class="day-block-btn ${holidayName ? 'holiday' : isDayBlocked ? 'blocked' : ''}" data-date="${dateStr}" onclick="event.stopPropagation(); onBlockBtnClick(this)">
          ${holidayName ? `🎌 ${holidayName}` : isDayBlocked ? '🔒 Geblokkeerd' : dayBlockCount > 0 ? `⏱ ${dayBlockCount} uitzondering${dayBlockCount > 1 ? 'en' : ''}` : '⏱ Beschikbaar'}
        </button>
      </div>
      <div class="day-body${holidayName ? ' holiday-day' : isDayBlocked ? ' blocked-day' : ''}" id="daybody-${dateStr}">
        ${dayStops.length === 0 ? '<div class="day-empty">—</div>' : ''}
      </div>`;
```

Replace with:

```js
    col.innerHTML = `
      <div class="day-hdr">
        <div class="day-hdr-name ${isToday ? 'today' : isPast ? 'past' : ''}">${day.toLocaleDateString('nl-BE', { weekday:'short' })}</div>
        <div class="day-hdr-num${isToday ? ' today' : ''}">${day.getDate()}</div>
        <div class="day-cap desktop-only ${capFull ? 'full' : ''}">${holidayName ? `🎌 ${holidayName}` : isDayBlocked ? '🔒 Geblokkeerd' : capLabel}</div>
        <button class="day-block-btn desktop-only ${holidayName ? 'holiday' : isDayBlocked ? 'blocked' : ''}" data-date="${dateStr}" onclick="event.stopPropagation(); onBlockBtnClick(this)">
          ${holidayName ? `🎌 ${holidayName}` : isDayBlocked ? '🔒 Geblokkeerd' : dayBlockCount > 0 ? `⏱ ${dayBlockCount} uitzondering${dayBlockCount > 1 ? 'en' : ''}` : '⏱ Beschikbaar'}
        </button>
      </div>
      <div class="day-body${holidayName ? ' holiday-day' : isDayBlocked ? ' blocked-day' : ''}" id="daybody-${dateStr}">
        ${dayStops.length === 0 ? '<div class="day-empty">—</div>' : ''}
      </div>`;
```

(Only the `class` attributes on the `day-cap` div and `day-block-btn` button gain `desktop-only` — no other change on this block.)

- [ ] **Step 4: Hide the "Route berekenen" button per day**

Find (around line 2326-2337):

```js
    // Route knop als er stops zijn
    if (dayStops.length > 0 || dayEvents.some(e => e.adres || e.notitie)) {
      const rb = document.createElement('button');
      rb.className = 'cal-btn';
      rb.style.cssText = 'width:100%;margin-top:4px;background:var(--accent-dim);border:1px solid rgba(245,158,11,0.2);color:var(--accent);padding:4px;border-radius:4px;cursor:pointer;font-size:0.7rem;font-weight:600;font-family:inherit;';
      rb.textContent = 'Route berekenen';
      rb.onclick = () => {
        document.getElementById('plan-date').value = dateStr;
        setTab('planning');
        renderRouteList(dateStr);
      };
      col.querySelector('.day-body').appendChild(rb);
    }
```

Replace the `className` line with:

```js
      rb.className = 'cal-btn desktop-only';
```

- [ ] **Step 5: Manual verification**

Reload at **1000px** width. Open the persoon-kiezer — confirm "Alle technici" no longer appears (only actual technician names). Open the Kalender tab — confirm day columns show no capacity badge and no "⏱ Beschikbaar"/"🔒 Geblokkeerd" button, and days with stops show no "Route berekenen" button, while the stops themselves (`.cal-ticket` cards) still render normally with their "Bellen"/"Details" actions.

Reload at **1280px** width — confirm "Alle technici" is back in the dropdown, and every day column shows its capacity badge, beschikbaarheid-knop, and (where applicable) "Route berekenen" button again, unchanged from before this task.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: verberg coördinator-chrome in kalender en persoon-kiezer onder 1024px"
```

---

### Task 3: Mobiel tab-vangnet (initial load + resize)

**Files:**
- Modify: `public/index.html` (new function near `setTab()` ~line 3893-3904, hook in `DOMContentLoaded` ~line 1805-1810)

**Interfaces:**
- Consumes: `.desktop-only` class (Task 1/2) and the existing `setTab(tab)` function — no changes to `setTab` itself.
- Produces: `enforceMobileTabRestriction()` — a module-level function, callable with no arguments, safe to call at any time (no-op above 1023px width or when the active tab isn't hidden).

- [ ] **Step 1: Manual baseline check**

At **1000px** width, hard-reload the app fresh (not resized from wider — an actual fresh load, e.g. open a new tab or hard refresh). The default active tab in the HTML is Wachtrij (`<div class="tab active desktop-only" id="tab-tickets">`, per Task 1). Confirm today's baseline bug: the tab bar correctly shows no visible active tab (Wachtrij's button is hidden), but the ticket-queue **view content** is still what's displayed (`#view-tickets.active`) — since nothing currently forces a switch to Kalender. This is the gap this task closes.

- [ ] **Step 2: Add the enforcement function**

Find (around line 3893-3904):

```js
function setTab(tab) {
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('view-' + tab).classList.add('active');
  updateTabIndicator('tab-' + tab);
  if (tab === 'planning') setTimeout(() => leafletMap?.invalidateSize(), 50);
  // Defer kalender/gepland render één tick zodat de tab-click geen elementen in de nieuw gerenderde view raakt
  if (tab === 'kalender')  setTimeout(() => renderKalender(), 0);
  if (tab === 'gepland')   setTimeout(() => renderGepland(), 0);
  if (tab === 'rapporten') setTimeout(() => laadRapportArchief(), 0);
}
```

Insert immediately after (before the `// ══...  DETAIL MODAL` comment that follows):

```js

function enforceMobileTabRestriction() {
  if (!window.matchMedia('(max-width: 1023px)').matches) return;
  const active = document.querySelector('.tab.active');
  if (active && active.classList.contains('desktop-only')) setTab('kalender');
}
```

- [ ] **Step 3: Call it on initial load and on viewport-crossing**

Find (around line 1805-1810):

```js
  // Initialiseer tab indicator op de actieve tab
  setTimeout(() => updateTabIndicator('tab-tickets'), 0);
  window.addEventListener('resize', () => {
    const active = document.querySelector('.tab.active');
    if (active) updateTabIndicator(active.id);
  });
```

Replace with:

```js
  // Initialiseer tab indicator op de actieve tab
  setTimeout(() => updateTabIndicator('tab-tickets'), 0);
  window.addEventListener('resize', () => {
    const active = document.querySelector('.tab.active');
    if (active) updateTabIndicator(active.id);
  });
  enforceMobileTabRestriction();
  window.matchMedia('(max-width: 1023px)').addEventListener('change', enforceMobileTabRestriction);
```

- [ ] **Step 4: Manual verification**

Hard-reload the app at **1000px** width (fresh load, default HTML state). Confirm: the app lands on the Kalender tab (not Wachtrij) — the "Kalender" tab button shows `active`, and the calendar view is what's displayed, not the ticket queue.

At **1280px** width, hard-reload again. Confirm: the app lands on Wachtrij as before (unchanged behavior for desktop — this task must not change the default tab above 1023px).

At **1280px**, manually click into the "Route" tab, then resize the window down to **1000px** without reloading. Confirm: the view automatically switches to Kalender (the "Route" tab was active and hidden, triggering the safeguard). Resize back up to **1280px** — confirm the Kalender tab stays active (no forced switch back to Route; only the narrow-crossing direction forces a switch, per the spec).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: forceer Kalender-tab op mobiel als een verborgen tab actief was"
```

---

## Post-plan note

None of the three commits above are pushed. When Brent confirms it's time to deploy, push together with any other pending local commits.
