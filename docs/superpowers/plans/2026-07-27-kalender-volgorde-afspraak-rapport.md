# Kalendervolgorde, Leesbaarheid & Rapport bij Manuele Afspraken Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort the Kalender week-view into one chronological timeline (tickets + local afspraken mixed by time), make the hour label readable, let manual/imported afspraken get a service rapport (except "Installatie" ones), and make report travel-time always originate from the configured start location instead of chaining from the previous stop.

**Architecture:** All changes are client-side, inside the single-file PWA `public/index.html`. No backend/Netlify Functions changes — `rapport-archief.js` already accepts any string as `ticketId`; `rapport.js` (Zoho upload) is untouched, just conditionally not called for local events.

**Tech Stack:** Vanilla JS (no framework, no build step), local dev server (`node dev-server.mjs`, port 3333) for manual verification.

## Global Constraints

- No backend/Netlify Functions changes — `public/index.html` only.
- All UI text in Dutch.
- **No automated test framework exists in this codebase.** Every verification step below is a manual procedure against the local dev server, using the app's `?test` query-param mode (`DUMMY_DATA`) for fixtures, plus direct browser-console state injection where realistic out-of-order data or Zoho-absent scenarios need to be forced. This replaces the "write failing test / make it pass" cycle referenced by the general plan template.
- `/api/rapport-archief` and 5 other v2-style Netlify Functions crash under the local dev server (documented project limitation, unrelated to this work) — Task 3's verification therefore spies on the client-side call rather than relying on a real network round-trip.
- `/api/optimize` and `/api/route` (used for aanrijtijd) are classic-style functions and **do** work locally, provided `.env.local` has a valid `TOMTOM_API_KEY` (it does) — Task 4's verification uses the real local network call.
- Commit after each task with `git add public/index.html` (never `-A`) and a `feat:`/`fix:` prefixed message. **Do not push** — this repo auto-deploys to production on push to `main`; Brent confirms separately when it's time to push.
- This plan is intended to run in an isolated git worktree (via `EnterWorktree`), per this project's established workflow — implementer + reviewer per task, final whole-branch review before merge.

---

### Task 1: Kalender — chronologische volgorde + leesbaarheid

**Files:**
- Modify: `public/index.html` (CSS `.cal-meta`/`.cal-local-time` ~line 531/562; `renderKalender()` week-grid render loop ~line 2201-2382)

**Interfaces:**
- Produces: `buildTicketCard(stop, dateStr): HTMLElement` and `buildLocalEventCard(ev): HTMLElement` — new module-level helper functions, extracted from the existing inline render logic. No other task depends on these; self-contained to this task.

- [ ] **Step 1: Manual baseline check**

Start the dev server: `node dev-server.mjs` (from the repo root). In a browser, open `http://localhost:3333/?test`, click the **Kalender** tab.

Open the browser devtools console and force an out-of-order scenario on a visible day (use today's date so it's in the current week view):

```js
const d = localISO(new Date());
planning[d] = [{
  ticket: { id: 't-baseline', number: '9001', subject: 'Ticket om 14u', status: 'Ingepland', assignee: 'Tim', hasAddress: true, phone: '' },
  address: 'Kerkstraat 1, Gent', uur: '14:00',
}];
localEvents.push({
  id: 'ev-baseline', datum: d, titel: 'Afspraak om 09u', type: 'Service',
  uur: '09:00', einduur: '10:00', persoon: null, adres: '', notitie: '', telefoon: '', email: '',
});
renderKalender();
```

Confirm today's baseline bug: the "Ticket om 14u" card appears **above** the "Afspraak om 09u" card in that day's column, even though 09:00 is earlier — because tickets are always rendered before local events regardless of time. Also confirm the "🕐 14:00" text is small and grey.

- [ ] **Step 2: Make the hour label readable**

Find (line 531):

```css
    .cal-meta { font-size: 0.65rem; color: var(--muted); margin-left: 4px; }
```

Replace with:

```css
    .cal-meta { font-size: 0.8rem; color: var(--text); margin-left: 4px; }
```

Find (line 562):

```css
    .cal-local-time { font-size: 0.65rem; color: var(--muted); margin-left: 4px; }
```

Replace with:

```css
    .cal-local-time { font-size: 0.8rem; color: var(--text); font-weight: 600; margin-left: 4px; }
```

- [ ] **Step 3: Extract the ticket-card builder into its own function**

Find (~line 2299-2326, inside `renderKalender()`'s week-view branch, right after the `col.innerHTML` template is set):

```js
    dayStops.forEach(stop => {
      const isPending   = stop.ticket.status === 'Wachten op bevestiging planning';
      const cardClass   = isPending ? 'pending' : 'confirmed';
      const badgeLabel  = isPending ? 'Wacht bevestiging' : 'Bevestigd';
      const card        = document.createElement('div');
      card.className    = `cal-ticket ${cardClass}`;
      card.innerHTML    = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
          <div style="flex:1;min-width:0">
            <div class="cal-num">#${escHtml(stop.ticket.number)}</div>
            <span class="cal-badge ${cardClass}">${badgeLabel}</span>
            ${stop.uur ? `<div class="cal-meta" style="font-weight:600">🕐 ${stop.uur}</div>` : ''}
            <div class="cal-sub">${escHtml(stop.ticket.subject) || '—'}</div>
            ${stop.ticket.assignee ? `<div class="cal-meta">${escHtml(stop.ticket.assignee)}</div>` : ''}
            <div class="cal-addr ${stop.ticket.hasAddress ? '' : 'miss'}">${stop.ticket.hasAddress ? escHtml(stop.address) : 'Geen adres'}</div>
          </div>
          <button onclick="event.stopPropagation();removeTicketFromDate('${stop.ticket.id}','${dateStr}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;flex-shrink:0;padding:2px 4px;line-height:1">×</button>
        </div>
        <div class="cal-actions">
          ${stop.ticket.phone || stop.ticket.telefoonEindklant ? `<a class="cal-btn" href="tel:${escHtml(stop.ticket.telefoonEindklant||stop.ticket.phone)}">📞 Bellen</a>` : ''}
          ${stop.ticket.hasAddress ? `<button class="cal-btn btn-navigeer" data-adres="${escHtml(stop.address||stop.ticket.address||'')}">🧭 Navigeer</button>` : ''}
        </div>`;
      card.querySelector('.btn-navigeer')?.addEventListener('click', e => {
        e.stopPropagation();
        navigate(encodeURIComponent(e.currentTarget.dataset.adres));
      });
      card.addEventListener('click', () => openDetail(stop.ticket));
      col.querySelector('.day-body').appendChild(card);
    });

    // Lokale afspraken (import / manueel)
    const dayEvents = localEvents.filter(e => {
      if (e.datum !== dateStr) return false;
      if (activeAssigneeFilter === 'all') return true;
      return !e.persoon || e.persoon === activeAssigneeFilter;
    });
    dayEvents.forEach(ev => {
      const card = document.createElement('div');
      card.className = 'cal-local-event';
      const tijdLabel = ev.uur ? `${ev.uur}${ev.einduur ? '–' + ev.einduur : ''}` : '';
      const adresLabel = ev.adres || ev.notitie;
      card.innerHTML = `
        <button class="cal-local-del" title="Verwijderen">✕</button>
        <span class="cal-local-type">${escHtml(ev.type)}</span>
        <div class="cal-sub" style="margin-top:2px">${escHtml(ev.titel)}</div>
        ${tijdLabel ? `<div class="cal-local-time">⏱ ${tijdLabel}</div>` : ''}
        ${adresLabel ? `<div class="cal-addr">${escHtml(adresLabel)}</div>` : ''}
        ${ev.persoon ? `<div class="cal-meta">${escHtml(ev.persoon)}</div>` : ''}
        <div class="cal-actions">
          ${ev.telefoon ? `<a class="cal-btn cal-ev-call" href="tel:${escHtml(ev.telefoon)}">📞 Bellen</a>` : ''}
          ${adresLabel ? `<button class="cal-btn cal-ev-nav">🧭 Navigeer</button>` : ''}
        </div>`;
      card.querySelector('.cal-local-del')?.addEventListener('click', e => { e.stopPropagation(); removeLocalEvent(ev.id); });
      card.querySelector('.cal-ev-call')?.addEventListener('click', e => e.stopPropagation());
      card.querySelector('.cal-ev-nav')?.addEventListener('click', e => { e.stopPropagation(); navigate(encodeURIComponent(adresLabel)); });
      card.addEventListener('click', () => openLocalEventDetail(ev));
      col.querySelector('.day-body').appendChild(card);
    });
```

Replace with (same template HTML for both card kinds, unchanged — only the control flow around them changes: two builder functions instead of two inline `forEach` bodies, plus one merged, sorted render loop):

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

    timeline.forEach(item => {
      const card = item.kind === 'ticket'
        ? buildTicketCard(item.stop, dateStr)
        : buildLocalEventCard(item.ev);
      col.querySelector('.day-body').appendChild(card);
    });
```

Then add the two extracted builder functions as standalone, module-level functions. Find (line 2201):

```js
function renderKalender() {
```

Insert immediately **before** that line:

```js
function buildTicketCard(stop, dateStr) {
  const isPending   = stop.ticket.status === 'Wachten op bevestiging planning';
  const cardClass   = isPending ? 'pending' : 'confirmed';
  const badgeLabel  = isPending ? 'Wacht bevestiging' : 'Bevestigd';
  const card        = document.createElement('div');
  card.className    = `cal-ticket ${cardClass}`;
  card.innerHTML    = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
      <div style="flex:1;min-width:0">
        <div class="cal-num">#${escHtml(stop.ticket.number)}</div>
        <span class="cal-badge ${cardClass}">${badgeLabel}</span>
        ${stop.uur ? `<div class="cal-meta" style="font-weight:600">🕐 ${stop.uur}</div>` : ''}
        <div class="cal-sub">${escHtml(stop.ticket.subject) || '—'}</div>
        ${stop.ticket.assignee ? `<div class="cal-meta">${escHtml(stop.ticket.assignee)}</div>` : ''}
        <div class="cal-addr ${stop.ticket.hasAddress ? '' : 'miss'}">${stop.ticket.hasAddress ? escHtml(stop.address) : 'Geen adres'}</div>
      </div>
      <button onclick="event.stopPropagation();removeTicketFromDate('${stop.ticket.id}','${dateStr}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:1rem;flex-shrink:0;padding:2px 4px;line-height:1">×</button>
    </div>
    <div class="cal-actions">
      ${stop.ticket.phone || stop.ticket.telefoonEindklant ? `<a class="cal-btn" href="tel:${escHtml(stop.ticket.telefoonEindklant||stop.ticket.phone)}">📞 Bellen</a>` : ''}
      ${stop.ticket.hasAddress ? `<button class="cal-btn btn-navigeer" data-adres="${escHtml(stop.address||stop.ticket.address||'')}">🧭 Navigeer</button>` : ''}
    </div>`;
  card.querySelector('.btn-navigeer')?.addEventListener('click', e => {
    e.stopPropagation();
    navigate(encodeURIComponent(e.currentTarget.dataset.adres));
  });
  card.addEventListener('click', () => openDetail(stop.ticket));
  return card;
}

function buildLocalEventCard(ev) {
  const card = document.createElement('div');
  card.className = 'cal-local-event';
  const tijdLabel = ev.uur ? `${ev.uur}${ev.einduur ? '–' + ev.einduur : ''}` : '';
  const adresLabel = ev.adres || ev.notitie;
  card.innerHTML = `
    <button class="cal-local-del" title="Verwijderen">✕</button>
    <span class="cal-local-type">${escHtml(ev.type)}</span>
    <div class="cal-sub" style="margin-top:2px">${escHtml(ev.titel)}</div>
    ${tijdLabel ? `<div class="cal-local-time">⏱ ${tijdLabel}</div>` : ''}
    ${adresLabel ? `<div class="cal-addr">${escHtml(adresLabel)}</div>` : ''}
    ${ev.persoon ? `<div class="cal-meta">${escHtml(ev.persoon)}</div>` : ''}
    <div class="cal-actions">
      ${ev.telefoon ? `<a class="cal-btn cal-ev-call" href="tel:${escHtml(ev.telefoon)}">📞 Bellen</a>` : ''}
      ${adresLabel ? `<button class="cal-btn cal-ev-nav">🧭 Navigeer</button>` : ''}
    </div>`;
  card.querySelector('.cal-local-del')?.addEventListener('click', e => { e.stopPropagation(); removeLocalEvent(ev.id); });
  card.querySelector('.cal-ev-call')?.addEventListener('click', e => e.stopPropagation());
  card.querySelector('.cal-ev-nav')?.addEventListener('click', e => { e.stopPropagation(); navigate(encodeURIComponent(adresLabel)); });
  card.addEventListener('click', () => openLocalEventDetail(ev));
  return card;
}

function renderKalender() {
```

**Note for the implementer:** the `dayEvents` filter block must stay **before** the `timeline` construction (it still needs to run once per day, same as today) — only its render loop changes. Do not duplicate the `dayEvents` filter.

- [ ] **Step 4: Manual verification — order + readability**

Hard-refresh `http://localhost:3333/?test`, click **Kalender**, re-run the exact console snippet from Step 1 (the injected `planning`/`localEvents` state is lost on refresh).

Confirm:
1. "Afspraak om 09u" now appears **above** "Ticket om 14u" in that day's column (chronological order, mixed ticket+event).
2. The "🕐 14:00" and "⏱ 09:00–10:00" hour texts are visibly larger and darker than before (compare against another day column with unmodified older data, or zoom in on the text).
3. Add a third item with no `uur` to the same day and confirm it renders at the **bottom** of that day's column, after both timed items:
```js
planning[d].push({ ticket: { id: 't-noboor', number: '9002', subject: 'Ticket zonder uur', status: 'Ingepland', assignee: 'Tim', hasAddress: false, phone: '' }, address: '' });
renderKalender();
```
4. Existing interactions still work: click the "Afspraak om 09u" card → the local-event detail modal opens; click "Ticket om 14u" → the ticket detail modal opens; the "×" button on the ticket card still removes it from the day (`removeTicketFromDate`).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: sorteer kalender chronologisch en maak uur-label leesbaarder"
```

---

### Task 2: `getPlanningTicket()` uitbreiden + Rapport-knop voor lokale afspraken

**Files:**
- Modify: `public/index.html` (`getPlanningTicket()` ~line 2499-2504; local-afspraak detail modal HTML ~line 1461-1466 and `openLocalEventDetail()` ~line 3016-3053)

**Interfaces:**
- Produces: `getPlanningTicket(id)` now also resolves local-afspraak IDs, returning a pseudo-ticket object with `{ id, number:'', subject, address, hasAddress, assignee, phone, telefoonEindklant, contact, account:'', partner:'', serienummer:'', priority:'', isLocal:true }`. Task 3 consumes `isLocal` to branch the wizard-finish behavior. `openRapport()` (existing, unmodified in this task) consumes this return value as `ticket` — its field reads (`ticket.address`, `ticket.subject`, `ticket.partner || ticket.account`, `ticket.hasAddress`, `ticket.phone`, `ticket.telefoonEindklant`) all already work against this shape since it mirrors a real ticket's fields.

- [ ] **Step 1: Manual baseline check**

With the dev server running, open `http://localhost:3333/?test`, add a manual afspraak via the **Kalender** tab's "+ Afspraak" flow (or console-inject one, see Step 3 below), open its detail modal (click the local-event card). Confirm today's baseline: there is no "📋 Rapport" button in the footer (only Sluiten / 📷 Foto's / ✏️ Bewerken / 🗑 Verwijderen).

- [ ] **Step 2: Extend `getPlanningTicket()` to resolve local afspraken**

Find (line 2499-2504):

```js
function getPlanningTicket(id) {
  return allTickets.find(t => t.id === id)
      || allPending.find(t => t.id === id)
      || allGepland.find(t => t.id === id)
      || Object.values(planning).flat().find(p => p.ticket.id === id)?.ticket;
}
```

Replace with:

```js
function getPlanningTicket(id) {
  const real = allTickets.find(t => t.id === id)
      || allPending.find(t => t.id === id)
      || allGepland.find(t => t.id === id)
      || Object.values(planning).flat().find(p => p.ticket.id === id)?.ticket;
  if (real) return real;

  const ev = localEvents.find(e => e.id === id);
  if (!ev) return undefined;
  // Pseudo-ticket voor manuele/geïmporteerde afspraken zonder Zoho-ticket, zodat
  // openRapport() ze kan behandelen als een gewoon ticket. account/partner blijven
  // bewust leeg (niet ev.titel) — R.installateur leest ticket.partner||ticket.account,
  // en zou anders bij élke afspraak foutief op "Ja" komen te staan.
  return {
    id: ev.id, number: '', subject: ev.titel,
    address: ev.adres || '', hasAddress: !!ev.adres,
    assignee: ev.persoon || '',
    phone: ev.telefoon || '', telefoonEindklant: ev.telefoon || '',
    contact: ev.titel, account: '', partner: '',
    serienummer: '', priority: '',
    isLocal: true,
  };
}
```

- [ ] **Step 3: Manual verification — pseudo-ticket resolves correctly**

Hard-refresh, open devtools console:

```js
localEvents.push({
  id: 'ev-rapporttest', datum: localISO(new Date()), titel: 'Service bij Janssens',
  type: 'Service', uur: '11:00', einduur: '12:00', persoon: 'Tim',
  adres: 'Dorpsstraat 5, Deinze', notitie: '', telefoon: '0470123456', email: '',
});
console.log(getPlanningTicket('ev-rapporttest'));
```

Confirm the logged object has `isLocal: true`, `subject: 'Service bij Janssens'`, `address: 'Dorpsstraat 5, Deinze'`, `hasAddress: true`, `assignee: 'Tim'`, `phone: '0470123456'`, and — importantly — `account: ''` and `partner: ''` (not the title).

- [ ] **Step 4: Add the Rapport-knop to the local-afspraak detail modal**

Find (line 1461-1466):

```html
    <div class="mftr">
      <button class="btn-cancel" onclick="closeLocalDet()">Sluiten</button>
      <button class="btn-cancel" onclick="openFotoModal(_localDetEvent?.id)">📷 Foto's</button>
      <button class="btn-cancel" id="ld-edit-btn" onclick="editFromLocalDet()">✏️ Bewerken</button>
      <button class="btn-cancel" id="ld-del-btn" style="color:var(--red);border-color:var(--red)" onclick="deleteFromLocalDet()">🗑 Verwijderen</button>
    </div>
```

Replace with:

```html
    <div class="mftr">
      <button class="btn-cancel" onclick="closeLocalDet()">Sluiten</button>
      <button class="btn-cancel" onclick="openFotoModal(_localDetEvent?.id)">📷 Foto's</button>
      <button class="btn-cancel" id="ld-btn-rapport" onclick="openRapport(_localDetEvent?.id, _localDetEvent?.datum)">📋 Rapport</button>
      <button class="btn-cancel" id="ld-edit-btn" onclick="editFromLocalDet()">✏️ Bewerken</button>
      <button class="btn-cancel" id="ld-del-btn" style="color:var(--red);border-color:var(--red)" onclick="deleteFromLocalDet()">🗑 Verwijderen</button>
    </div>
```

- [ ] **Step 5: Toggle the Rapport-knop's visibility based on `ev.type`**

Find (line 3016-3019, start of `openLocalEventDetail`):

```js
function openLocalEventDetail(ev) {
  _localDetEvent = ev;
  document.getElementById('ld-type').innerHTML  = `<span class="cal-local-type">${escHtml(ev.type)}</span>`;
  document.getElementById('ld-titel').textContent = ev.titel || '—';
```

Replace with:

```js
function openLocalEventDetail(ev) {
  _localDetEvent = ev;
  document.getElementById('ld-btn-rapport').style.display = ev.type === 'Installatie' ? 'none' : '';
  document.getElementById('ld-type').innerHTML  = `<span class="cal-local-type">${escHtml(ev.type)}</span>`;
  document.getElementById('ld-titel').textContent = ev.titel || '—';
```

- [ ] **Step 6: Manual verification — knop zichtbaarheid + wizard-prefill**

Hard-refresh, re-run the console snippet from Step 3, then click the "Service bij Janssens" card in the Kalender tab (or reopen via `openLocalEventDetail(localEvents.find(e=>e.id==='ev-rapporttest'))` in console if it's not on today's visible week).

Confirm:
1. The "📋 Rapport" button is visible (type is "Service").
2. Click it → the rapport-wizard opens on the "Algemeen" step, with **Adres** pre-filled as "Dorpsstraat 5, Deinze" and **Technieker** pre-filled as "Tim" (check the wizard's rendered fields, or run `console.log(R.adres, _wizTicket.assignee)` in console).
3. Close the wizard, then test the negative case: change the local event's type and re-open its detail:
```js
const evT = localEvents.find(e => e.id === 'ev-rapporttest');
evT.type = 'Installatie';
openLocalEventDetail(evT);
```
Confirm the "📋 Rapport" button is now hidden.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: maak service rapport mogelijk voor manuele/geimporteerde afspraken"
```

---

### Task 3: Wizard-afronding — Zoho-upload overslaan voor lokale afspraken

**Files:**
- Modify: `public/index.html` (`printRapport()` ~line 5869-5891)

**Interfaces:**
- Consumes: `_wizTicket.isLocal` (from Task 2's `getPlanningTicket()` pseudo-ticket).

- [ ] **Step 1: Manual baseline check**

With the dev server running, open a rapport wizard for the `ev-rapporttest` local event from Task 2 (console-inject it again since state doesn't survive refresh), click through all wizard steps to the end (signatures are optional — clicking "Volgende" without drawing one is fine) and click **🖨️ Afdrukken / PDF**.

Confirm today's baseline bug: the console shows a call attempt to `/api/rapport` (Zoho upload) for a ticket that has no real Zoho ticket — open devtools **Network** tab before printing, filter on "rapport", and confirm a POST to `/api/rapport` fires with `ticketId: "ev-rapporttest"` (a non-numeric string) even though there's no matching Zoho ticket to attach to.

- [ ] **Step 2: Branch the wizard-finish on `isLocal`**

Find (line 5869-5891):

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
    const rapportFilename = `rapport-${_wizTicket.number || _wizTicket.id}-${R.datum || 'onbekend'}.pdf`;
    uploadRapportToZoho(html, _wizTicket.id, rapportFilename);
    archiveerRapport(html);
  }

  // Wizard sluiten na geslaagd rapport — geen bevestigingsdialog meer nodig
  document.getElementById('rapport-wizard').classList.remove('open');
}
```

Replace with:

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

  // Wizard sluiten na geslaagd rapport — geen bevestigingsdialog meer nodig
  document.getElementById('rapport-wizard').classList.remove('open');
}
```

**Note for the implementer:** `uploadRapportToZoho()` itself already shows its own toast on success/failure (`"✅ Rapport opgeslagen als bijlage in Zoho"` / `"⚠️ Zoho upload mislukt: ..."`) — that's why the non-local branch doesn't add an extra toast, but the local branch does, since `archiveerRapport()` has no success toast of its own (only a failure one).

- [ ] **Step 3: Manual verification — no Zoho call for local afspraken, unchanged for real tickets**

Hard-refresh, re-inject `ev-rapporttest`, open its rapport wizard, click through to the end, open devtools **Network** tab, click **🖨️ Afdrukken / PDF**.

Confirm:
1. **No** POST request to `/api/rapport` fires.
2. A POST to `/api/rapport-archief` **is attempted** (it will fail/error locally per the Global Constraints note — that's expected, not a regression; confirm via the Network tab that the request was *sent*, status doesn't matter here).
3. A toast reading "✅ Rapport opgeslagen in archief — geen Zoho-ticket gekoppeld" appears.

Then confirm the existing behavior is unchanged for a real ticket: open the rapport wizard for dummy ticket **#1006** (Ingepland tab, `?test` mode), click through to the end, print. Confirm in the Network tab that **both** `/api/rapport` (with a numeric `ticketId`) and `/api/rapport-archief` fire, same as before this change.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "fix: sla zoho-upload over voor rapporten bij lokale afspraken"
```

---

### Task 4: Aanrijtijd altijd vanaf startlocatie (alle tickets)

**Files:**
- Modify: `public/index.html` (`openRapport()`'s aanrijtijd-berekening ~line 4851-4904)

**Interfaces:**
- Consumes: `settings.startlocatie` (pre-existing), `ticket.hasAddress`/`ticket.address` (pre-existing, and from Task 2's pseudo-ticket).
- No longer consumes: `routeData`, `currentRouteDate`, `planning[date]` (all removed from this calculation — still used elsewhere in the file for actual route planning, untouched).

- [ ] **Step 1: Manual baseline check**

With the dev server running, open `http://localhost:3333/?test`. First simulate "a route was already calculated for today" so the old shortcut path triggers:

```js
const d = localISO(new Date());
routeData = { legs: [{ travelTimeSeconds: 999999 }] }; // absurd value, to make the bug obvious
currentRouteDate = d;
```

Open the rapport wizard for dummy ticket **#1006**, assuming it's scheduled today (if not, adjust `d`/`currentRouteDate` to match wherever #1006 is actually planned — check via `Object.entries(planning).find(([date, stops]) => stops.some(s => s.ticket.id === '1006'))`). Confirm today's baseline bug: `R.aanrijtijdMin` becomes `16666` minutes (999999/60), i.e. it reused the fake `routeData.legs[0]` instead of doing a real TomTom lookup from `settings.startlocatie`. Check via `console.log(R.aanrijtijdMin)` right after opening the wizard.

Close the wizard and clear the injected state: `routeData = null; currentRouteDate = null;`

- [ ] **Step 2: Simplify the aanrijtijd calculation**

Find (line 4851-4904):

```js
  // Aanrijtijd ophalen uit TomTom routeData als die beschikbaar is voor deze datum
  R.aanrijtijdMin = 0;
  if (routeData?.legs && currentRouteDate === date) {
    const filterPerson = activeAssigneeFilter === 'all' ? null : activeAssigneeFilter;
    // Zelfde filter als calculateRoute()'s `stops.filter(p => p._lat)` (zie allWpStops daar):
    // enkel stops die daadwerkelijk als waypoint meegingen tellen mee — anders schuift stopIdx
    // uit fase met routeData.legs zodra er een niet-geocodeerde/adresloze stop tussen zit.
    const dayStops = (planning[date] || []).filter(p => (!filterPerson || p.ticket.assignee === filterPerson) && p._lat);
    const stopIdx  = dayStops.findIndex(p => p.ticket.id === ticketId);
    // stopIdx is 0-based binnen de gefilterde lijst die ook de waypoints van calculateRoute vormde;
    // legs[stopIdx] is de rit die aankomt bij deze stop (empirisch bevestigd: legs[i] = leg die
    // aankomt bij allStops[i], zelfde conventie als hierboven in renderRouteList) — geen offset nodig.
    if (stopIdx >= 0 && routeData.legs[stopIdx]) {
      R.aanrijtijdMin = Math.round(routeData.legs[stopIdx].travelTimeSeconds / 60);
    }
  }
  // Geen routeData beschikbaar → TomTom direct bevragen, maar vertrek vanaf de vorige
  // stop van diezelfde dag/technieker (op basis van geplande tijd) indien die er is —
  // anders wordt elke stop na de eerste onterecht gefactureerd alsof de technieker apart
  // van het bureau vertrok. Enkel voor de rapport-facturatie; de routeplanning zelf
  // (calculateRoute/autoPlan/optimizeRoute) gebruikt deze functie niet en blijft ongewijzigd.
  if (R.aanrijtijdMin === 0 && ticket.hasAddress) {
    const sameDayOwnStops = (planning[date] || [])
      .filter(p => p.ticket.assignee === ticket.assignee && p.ticket.hasAddress && p.uur)
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

Replace with:

```js
  // Aanrijtijd wordt altijd berekend vanaf de ingestelde startlocatie naar het
  // interventie-adres — nooit hergebruikt uit een al-berekende route, nooit vanaf
  // de vorige stop van de dag. Geldt voor elk ticket (Zoho én lokale afspraken).
  R.aanrijtijdMin = 0;
  if (ticket.hasAddress && settings.startlocatie) {
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

- [ ] **Step 3: Manual verification — always from startlocatie**

Hard-refresh, repeat the Step 1 setup (`routeData`/`currentRouteDate` with the absurd fake leg) on dummy ticket #1006, open devtools **Network** tab, open the rapport wizard.

Confirm:
1. `R.aanrijtijdMin` is **not** `16666` anymore — it's a real (small) number of minutes, or `0` if the geocode/route call fails.
2. The Network tab shows a **new** POST to `/api/optimize` with request body `origin` equal to `settings.startlocatie`'s exact value (check via **Instellingen** tab what that value currently is, or `console.log(settings.startlocatie)`), and `stops: [<#1006's address>]`.
3. Repeat with a second ticket scheduled **later the same day** for the same technician (or inject one) — confirm its `/api/optimize` request also has `origin` equal to `settings.startlocatie`, **not** the first ticket's address (this is the actual regression test for the old "chain from previous stop" behavior).
4. Open the rapport wizard for the local afspraak from Task 2 (`ev-rapporttest`) and confirm it also gets a real aanrijtijd calculated the same way (its `hasAddress` is `true`).
5. Test the guard: temporarily clear `settings.startlocatie = ''` in console, open the wizard for a ticket, confirm no `/api/optimize` call fires and `R.aanrijtijdMin` stays `0` (restore `settings.startlocatie` afterward, or just reload the page).

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "fix: bereken aanrijtijd altijd vanaf startlocatie i.p.v. vorige stop"
```

---

## Post-plan note

None of the four commits above are pushed. When Brent confirms it's time to deploy, push all four with a single `git push origin main` — Netlify auto-deploys ~30s after.
