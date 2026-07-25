# Interventiedatum-veld Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop reading/writing Zoho's native `dueDate` ticket field for scheduling; use the new custom field `cf_interventie_datm` ("Interventie Datum") exclusively instead, renaming the app's internal concept from `dueDate` to `interventieDatum` everywhere it appears.

**Architecture:** Zoho Desk custom fields are read/written via the `cf` object nested in the ticket JSON (`t.cf.cf_interventie_datm` on read, `{ cf: { cf_interventie_datm: <value> } }` on a PATCH write) — same convention this codebase already uses for `cf_adres`, `cf_serienummer`, etc. in `tickets.js`. The value format is unchanged: a DST-correct ISO8601 UTC string computed client-side via `new Date(...).toISOString()`. Only the field name and its nesting in the PATCH body change.

**Tech Stack:** Netlify Functions (ES modules, mixed "classic" `handler(event)` and v2 `export default (req)` styles), vanilla JS in `public/index.html`, no test framework — verification is via sandboxed Node scripts (mocked `fetch`) for backend and the app's built-in `?test` mode in a browser for the client.

## Global Constraints

- Zoho custom field API name: **`cf_interventie_datm`** (confirmed live, read-only, 2026-07-25 — note the field is literally named "datm", not "datum", in Zoho's internal API name).
- Zoho custom-field PATCH shape: **`{ "cf": { "cf_interventie_datm": "<ISO8601 string>" } }`** — confirmed via Zoho's own documentation (nested under `cf`, not top-level).
- Value format: identical ISO8601 UTC string with `.000Z` suffix already used for `dueDate` (e.g. `"2026-07-28T11:00:00.000Z"`) — confirmed by reading a live ticket's stored value.
- Internal app-wide naming: `dueDate` → `interventieDatum` (ticket field), `utcDueDate` → `utcInterventieDatum` (computed UTC value passed to the backend). Apply this rename to every occurrence, including local variable names derived from it (e.g. `noDueDate` → `noInterventieDatum`).
- Zoho's native `dueDate` field must not be read or written anywhere in this app after this plan is complete.
- No migration script — all currently-scheduled tickets already have `cf_interventie_datm` set manually in Zoho by Brent. This is a clean cutover.
- Detail-modal label: `"Vervaldatum"` → `"Interventiedatum"`.
- The "leegmaken" (clearing the field when un-scheduling) behavior — whether Zoho accepts `''` or requires `null` to clear a custom Date/Time field — is unverified. Implement with `''` per the existing `dueDate` convention, but this MUST be confirmed with a live test on a real (non-critical) ticket, with Brent's explicit go-ahead, before this plan's changes are pushed to `main`. Do not treat this as done until that live test has happened.

---

### Task 1: Backend read path — `tickets.js`

**Files:**
- Modify: `netlify/functions/tickets.js:140`

**Interfaces:**
- Produces: the ticket object returned by `/api/tickets` now has an `interventieDatum` field (was `dueDate`). Every other field in `mapTicket()` is unchanged. This is the field Task 3's client code will consume.

- [ ] **Step 1: Make the change**

In `mapTicket()`, replace:

```js
        dueDate:           t.dueDate     || null,
```

with:

```js
        interventieDatum:  cf.cf_interventie_datm || null,
```

(`cf` is already destructured at the top of `mapTicket()` via `const cf = t.cf || {};` — no new variable needed.)

- [ ] **Step 2: Verify against a live ticket (read-only, safe)**

This function only does GET requests to Zoho — no writes — so it's safe to run directly against the real API using the credentials in `.env.local`. Start the local dev server (it loads `.env.local` automatically — check `dev-server.mjs` if unsure how) and hit the endpoint:

```bash
node dev-server.mjs &
sleep 2
curl -s http://localhost:8888/api/tickets > /tmp/tickets-response.json
node -e "
const j = JSON.parse(require('fs').readFileSync('/tmp/tickets-response.json', 'utf8'));
const all = [...j.tickets, ...j.pendingTickets, ...j.plannedTickets];
const withDate = all.filter(t => t.interventieDatum);
console.log(withDate.length + ' van ' + all.length + ' tickets hebben interventieDatum');
console.log(withDate.slice(0, 3).map(t => ({ number: t.number, interventieDatum: t.interventieDatum })));
console.log('Nog dueDate-key aanwezig in response:', JSON.stringify(all[0]).includes('dueDate'));
"
```

Expected: at least the tickets Brent manually set in Zoho show a non-null `interventieDatum` in valid ISO8601 format, and the last line prints `false` (the old `dueDate` key should no longer exist in the response at all).

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/tickets.js
git commit -m "feat: lees interventieDatum uit cf_interventie_datm i.p.v. Zoho dueDate"
```

---

### Task 2: Backend write paths — `plan.js`, `plan-datum.js`, `propose.js`

**Files:**
- Modify: `netlify/functions/plan.js:42,59-73`
- Modify: `netlify/functions/plan-datum.js:3,42-47,59,66`
- Modify: `netlify/functions/propose.js:124,145,226-229,242`
- Test (sandbox, not committed): a throwaway Node script per function, mocked `fetch`, no real Zoho calls.

**Interfaces:**
- Consumes: nothing new from Task 1 — these are independent write paths.
- Produces: all three functions now accept `utcInterventieDatum` in their request body (was `utcDueDate`), write it to Zoho as `{ cf: { cf_interventie_datm } }`, and return `interventieDatum` in their response body (was `dueDate`). Task 3's client code will send/consume these exact names.

#### `plan.js`

- [ ] **Step 1: Rename the destructured request field**

Replace:
```js
    const { ticketId, date, utcDueDate } = JSON.parse(event.body || '{}');
```
with:
```js
    const { ticketId, date, utcInterventieDatum } = JSON.parse(event.body || '{}');
```

- [ ] **Step 2: Repoint the patch body to the custom field**

Replace:
```js
      // Inplannen: Zoho vereist geldige ISO8601 (bv. "2025-12-01T10:00:00.000Z").
      // utcDueDate komt van de client als DST-correcte UTC-omzetting van lokale
      // middernacht (new Date(`${date}T00:00:00`).toISOString()); zonder Z-suffix
      // verwerpt Zoho de PATCH met een 422 INVALID_DATA op dueDate.
      patch = {
        status:  'Wachten op bevestiging planning',
        dueDate: utcInterventieDatum || `${date}T00:00:00.000Z`,
      };
    } else {
      // Uit planning halen → terug naar "Wachten op planning" (werkelijke Zoho statusnaam)
      patch = {
        status:  'Wachten op planning',
        dueDate: '',
      };
    }
```
with:
```js
      // Inplannen: Zoho custom Date/Time-velden verwachten geldige ISO8601
      // (bv. "2025-12-01T10:00:00.000Z"), genest onder "cf". utcInterventieDatum
      // komt van de client als DST-correcte UTC-omzetting van lokale middernacht
      // (new Date(`${date}T00:00:00`).toISOString()).
      patch = {
        status: 'Wachten op bevestiging planning',
        cf:     { cf_interventie_datm: utcInterventieDatum || `${date}T00:00:00.000Z` },
      };
    } else {
      // Uit planning halen → terug naar "Wachten op planning" (werkelijke Zoho statusnaam)
      patch = {
        status: 'Wachten op planning',
        cf:     { cf_interventie_datm: '' },
      };
    }
```

- [ ] **Step 3: Write and run a sandboxed verification script (no real Zoho calls)**

Create a scratch file (not committed — use your own temp/scratch directory) `test-plan.mjs`:

```js
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, opts });
  if (url.includes('/oauth/v2/token')) return { json: async () => ({ access_token: 'fake-token' }) };
  if (url.includes('/organizations')) return { json: async () => ({ data: [{ id: 'org123' }] }) };
  if (url.includes('/tickets/')) return { ok: true, text: async () => JSON.stringify({ id: 'ticket123' }) };
  throw new Error('Unexpected fetch: ' + url);
};
process.env.ZOHO_REFRESH_TOKEN = 'x';
process.env.ZOHO_CLIENT_ID = 'x';
process.env.ZOHO_CLIENT_SECRET = 'x';

import { pathToFileURL } from 'url';
const { handler } = await import(pathToFileURL(process.argv[2]).href);

const utcInterventieDatum = new Date('2026-07-27T00:00:00').toISOString();
await handler({ httpMethod: 'POST', body: JSON.stringify({ ticketId: 't1', date: '2026-07-27', utcInterventieDatum }) });
const call1 = calls.find(c => c.url.includes('/tickets/t1'));
console.log('Inplannen PATCH body:', call1.opts.body);
const parsed1 = JSON.parse(call1.opts.body);
console.log('Heeft cf.cf_interventie_datm:', !!parsed1.cf?.cf_interventie_datm, '| Geen top-level dueDate:', !('dueDate' in parsed1));

calls.length = 0;
await handler({ httpMethod: 'POST', body: JSON.stringify({ ticketId: 't2', date: null }) });
const call2 = calls.find(c => c.url.includes('/tickets/t2'));
console.log('Uit-planning-halen PATCH body:', call2.opts.body);
```

Run: `node test-plan.mjs "/absolute/path/to/netlify/functions/plan.js"`

Expected output shows `cf.cf_interventie_datm` present with a valid `...000Z` string for the inplannen case, no top-level `dueDate` key in either PATCH body, and the uit-planning-halen case shows `cf: { cf_interventie_datm: '' }`.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/plan.js
git commit -m "feat: plan.js schrijft naar cf_interventie_datm i.p.v. Zoho dueDate"
```

#### `plan-datum.js`

- [ ] **Step 1: Update the doc comment, destructuring, PATCH body, and response**

Replace the header comment:
```js
// /api/plan-datum
// Stelt de geplande datum/tijd in op een Zoho-ticket (geen e-mail).
// POST body: { ticketId, utcDueDate }   (utcDueDate = volledige ISO-string in UTC)
// Zet status op "Wachten op bevestiging planning" als die nog niet zo staat.
```
with:
```js
// /api/plan-datum
// Stelt de geplande datum/tijd in op een Zoho-ticket (geen e-mail).
// POST body: { ticketId, utcInterventieDatum }   (volledige ISO-string in UTC)
// Schrijft naar het cf_interventie_datm custom field (niet Zoho's dueDate).
```

Replace:
```js
  const { ticketId, utcDueDate } = body;
  if (!ticketId || !utcDueDate) {
    return new Response(JSON.stringify({ error: 'ticketId en utcDueDate zijn verplicht' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
```
with:
```js
  const { ticketId, utcInterventieDatum } = body;
  if (!ticketId || !utcInterventieDatum) {
    return new Response(JSON.stringify({ error: 'ticketId en utcInterventieDatum zijn verplicht' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
```

Replace:
```js
      body:    JSON.stringify({ dueDate: utcDueDate }),
    });
    if (!patchRes.ok) {
      const txt = await patchRes.text();
      throw new Error(`Zoho PATCH fout (${patchRes.status}): ${txt}`);
    }

    return new Response(JSON.stringify({ ok: true, dueDate: utcDueDate }), {
```
with:
```js
      body:    JSON.stringify({ cf: { cf_interventie_datm: utcInterventieDatum } }),
    });
    if (!patchRes.ok) {
      const txt = await patchRes.text();
      throw new Error(`Zoho PATCH fout (${patchRes.status}): ${txt}`);
    }

    return new Response(JSON.stringify({ ok: true, interventieDatum: utcInterventieDatum }), {
```

- [ ] **Step 2: Write and run a sandboxed verification script**

This is a v2-style (`export default async (req) => ...`) function — it does not run under `dev-server.mjs` (a known, pre-existing limitation), so verify with a mocked-`fetch` sandbox script, same pattern as `plan.js` Step 3 above, but adapted to call the default export with a `Request`-like object:

```js
globalThis.fetch = async (url, opts) => {
  if (url.includes('/oauth/v2/token')) return { json: async () => ({ access_token: 'fake-token' }) };
  if (url.includes('/organizations')) return { json: async () => ({ data: [{ id: 'org123' }] }) };
  if (url.includes('/tickets/')) {
    console.log('PATCH body:', opts.body);
    return { ok: true, text: async () => '' };
  }
  throw new Error('Unexpected fetch: ' + url);
};
process.env.ZOHO_REFRESH_TOKEN = 'x';
process.env.ZOHO_CLIENT_ID = 'x';
process.env.ZOHO_CLIENT_SECRET = 'x';

import { pathToFileURL } from 'url';
const mod = (await import(pathToFileURL(process.argv[2]).href)).default;

const utcInterventieDatum = new Date('2026-07-27T14:30:00').toISOString();
const req = { method: 'POST', json: async () => ({ ticketId: 't1', utcInterventieDatum }) };
const res = await mod(req);
console.log('Response:', await res.text());
```

Run: `node test-plan-datum.mjs "/absolute/path/to/netlify/functions/plan-datum.js"`

Expected: PATCH body logs `{"cf":{"cf_interventie_datm":"2026-07-27T14:30:00.000Z"}}`, response is `{"ok":true,"interventieDatum":"2026-07-27T14:30:00.000Z"}`.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/plan-datum.js
git commit -m "feat: plan-datum.js schrijft naar cf_interventie_datm i.p.v. Zoho dueDate"
```

#### `propose.js`

- [ ] **Step 1: Rename the destructured field, local variable, PATCH body, and response**

Replace:
```js
    const { ticketId, date, time, recipientEmail, recipientName, subject, serienummer, utcDueDate } =
      JSON.parse(event.body || '{}');
```
with:
```js
    const { ticketId, date, time, recipientEmail, recipientName, subject, serienummer, utcInterventieDatum } =
      JSON.parse(event.body || '{}');
```

Replace:
```js
    // Gebruik utcDueDate van de client (browser kent de lokale tijdzone en
    // rekent DST-correct om naar UTC). Fallback moet geldige ISO8601 zijn
    // (met .000Z) — Zoho verwerpt dueDate zonder tijdzone-suffix met een
    // 422 INVALID_DATA fout.
    const dueDate = utcDueDate || `${date}T${appointmentTime}:00.000Z`;
```
with:
```js
    // Gebruik utcInterventieDatum van de client (browser kent de lokale
    // tijdzone en rekent DST-correct om naar UTC). Fallback moet geldige
    // ISO8601 zijn (met .000Z) voor het cf_interventie_datm custom field.
    const interventieDatum = utcInterventieDatum || `${date}T${appointmentTime}:00.000Z`;
```

Replace:
```js
    // 2. Ticket PATCH NA sendReply: status → Wachten op bevestiging planning + dueDate
    // Volgorde is belangrijk: Zoho zet status automatisch op "Wachten op klant" na sendReply,
    // dus de PATCH moet daarna komen om de juiste status te garanderen.
    const patchRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
      method:  'PATCH',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status:  'Wachten op bevestiging planning',
        dueDate,
      }),
    });
```
with:
```js
    // 2. Ticket PATCH NA sendReply: status → Wachten op bevestiging planning + interventieDatum
    // Volgorde is belangrijk: Zoho zet status automatisch op "Wachten op klant" na sendReply,
    // dus de PATCH moet daarna komen om de juiste status te garanderen.
    const patchRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}`, {
      method:  'PATCH',
      headers: {
        Authorization:  `Zoho-oauthtoken ${accessToken}`,
        orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'Wachten op bevestiging planning',
        cf:     { cf_interventie_datm: interventieDatum },
      }),
    });
```

Replace:
```js
      body: JSON.stringify({ success: true, ticketId, dueDate, appointmentTime, emailSent }),
```
with:
```js
      body: JSON.stringify({ success: true, ticketId, interventieDatum, appointmentTime, emailSent }),
```

- [ ] **Step 2: Write and run a sandboxed verification script**

Same pattern as `plan.js` Step 3 (this is also a classic `handler(event)` function). `sendReply` (the email step) only runs `if (recipientEmail)` ([netlify/functions/propose.js:170](netlify/functions/propose.js:170)) — omit `recipientEmail` from the test body so that step is skipped entirely and the mock doesn't need to cover it. Set `process.env.ZOHO_FROM_EMAIL = 'test@example.com'` before importing the module so the `/emailAddresses` lookup fallback ([netlify/functions/propose.js:150-166](netlify/functions/propose.js:150)) is also skipped.

```js
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, opts });
  if (url.includes('/oauth/v2/token')) return { json: async () => ({ access_token: 'fake-token' }) };
  if (url.includes('/organizations')) return { json: async () => ({ data: [{ id: 'org123' }] }) };
  if (url.includes('/tickets/')) return { ok: true, text: async () => JSON.stringify({ id: 'ticket123' }) };
  throw new Error('Unexpected fetch: ' + url);
};
process.env.ZOHO_REFRESH_TOKEN = 'x';
process.env.ZOHO_CLIENT_ID = 'x';
process.env.ZOHO_CLIENT_SECRET = 'x';
process.env.ZOHO_FROM_EMAIL = 'test@example.com';

import { pathToFileURL } from 'url';
const { handler } = await import(pathToFileURL(process.argv[2]).href);

const utcInterventieDatum = new Date('2026-07-27T09:00:00').toISOString();
const res = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({ ticketId: 't1', date: '2026-07-27', time: '09:00', utcInterventieDatum }),
});
const patchCall = calls.find(c => c.url.includes('/tickets/t1') && c.opts.method === 'PATCH');
console.log('PATCH body:', patchCall.opts.body);
console.log('Response:', await res.body);
```

Run: `node test-propose.mjs "/absolute/path/to/netlify/functions/propose.js"`

Expected: PATCH body is `{"status":"Wachten op bevestiging planning","cf":{"cf_interventie_datm":"2026-07-27T07:00:00.000Z"}}` (or the correct DST-adjusted UTC offset), response body has `interventieDatum` not `dueDate`.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/propose.js
git commit -m "feat: propose.js schrijft naar cf_interventie_datm i.p.v. Zoho dueDate"
```

---

### Task 3: Client rename — `public/index.html`

**Files:**
- Modify: `public/index.html` (all locations below)

**Interfaces:**
- Consumes: `interventieDatum` field from `/api/tickets` (Task 1), `interventieDatum`/`utcInterventieDatum` request/response fields from `/api/plan`, `/api/plan-datum`, `/api/propose` (Task 2).
- Produces: nothing consumed by other tasks — this is the leaf of the chain.

This task is a mechanical rename with no behavior change. Do every replacement below, then verify once at the end via the browser.

- [ ] **Step 1: Rename in the test-mode mock tickets** (`public/index.html:1649-1658`)

In each of the 5 mock ticket objects, rename the `dueDate:` key to `interventieDatum:` (keep the values exactly as they are — some are `null`, some are IIFE-computed `.toISOString()` calls). Example for the first one (line 1649):

Replace `dueDate: (() => { const d = new Date(); d.setDate(d.getDate()-2); return d.toISOString(); })(),` with `interventieDatum: (() => { const d = new Date(); d.setDate(d.getDate()-2); return d.toISOString(); })(),` — and the analogous change for lines 1650, 1651, 1654, 1655, 1658 (some are `dueDate:null,` → `interventieDatum:null,`).

- [ ] **Step 2: Rename in urgency scoring** (`public/index.html:1744,1746`)

Replace:
```js
  if (!t.dueDate) return 1.0;
```
with:
```js
  if (!t.interventieDatum) return 1.0;
```

Replace:
```js
  const due    = new Date(t.dueDate); due.setHours(0,0,0,0);
```
with:
```js
  const due    = new Date(t.interventieDatum); due.setHours(0,0,0,0);
```

- [ ] **Step 3: Rename in `reconcilePlanning`** (`public/index.html:1872,1880,1887,1889,1890,1893`)

Update the three comments (lines 1872, 1880, 1887) to say `interventieDatum` instead of `dueDate` (same meaning, just the new name — e.g. `// Wis alle pending/gepland entries eerst (interventieDatum kan gewijzigd zijn → re-seed hieronder)`).

Replace:
```js
      if (!t.dueDate) return;
      const date = t.dueDate.split('T')[0];
```
with:
```js
      if (!t.interventieDatum) return;
      const date = t.interventieDatum.split('T')[0];
```

Replace:
```js
        planning[date].push({ ticket: t, address: t.address, uur: extractLocalHour(t.dueDate) });
```
with:
```js
        planning[date].push({ ticket: t, address: t.address, uur: extractLocalHour(t.interventieDatum) });
```

- [ ] **Step 4: Rename in the "is overdue" check** (`public/index.html:2007`)

Replace:
```js
  return t.dueDate && t.dueDate.split('T')[0] < todayStr();
```
with:
```js
  return t.interventieDatum && t.interventieDatum.split('T')[0] < todayStr();
```

- [ ] **Step 5: Rename the "no date" filter in `renderKalender`** (`public/index.html:2200-2209`)

Replace:
```js
  const noDueDate = allPending.filter(t => !t.dueDate);
  const pill      = document.getElementById('kal-pending-pill');
  const noDateSec = document.getElementById('kal-no-date-section');
  if (noDueDate.length) {
    document.getElementById('kal-pending-count').textContent = noDueDate.length;
    pill.style.display = '';
    const inner = document.createElement('div');
    inner.className = 'kal-pending-inner';
    inner.innerHTML = `<div class="kal-pending-hdr">Wacht bevestiging — zonder datum</div>`;
    noDueDate.forEach(t => {
```
with:
```js
  const noInterventieDatum = allPending.filter(t => !t.interventieDatum);
  const pill      = document.getElementById('kal-pending-pill');
  const noDateSec = document.getElementById('kal-no-date-section');
  if (noInterventieDatum.length) {
    document.getElementById('kal-pending-count').textContent = noInterventieDatum.length;
    pill.style.display = '';
    const inner = document.createElement('div');
    inner.className = 'kal-pending-inner';
    inner.innerHTML = `<div class="kal-pending-hdr">Wacht bevestiging — zonder datum</div>`;
    noInterventieDatum.forEach(t => {
```

(This covers all 4 occurrences of `noDueDate` in this function — lines 2200, 2203, 2204, 2209. Confirmed via `grep -n "noDueDate" public/index.html` that no further occurrences exist.)

- [ ] **Step 6: Rename in Route-tab grouping** (`public/index.html:3675`)

Replace:
```js
      const key = t.dueDate ? t.dueDate.split('T')[0] : 'none';
```
with:
```js
      const key = t.interventieDatum ? t.interventieDatum.split('T')[0] : 'none';
```

- [ ] **Step 7: Rename and relabel the detail-modal row** (`public/index.html:4059`)

Replace:
```js
    row('Vervaldatum',  t.dueDate && fmtDate(t.dueDate)),
```
with:
```js
    row('Interventiedatum',  t.interventieDatum && fmtDate(t.interventieDatum)),
```

- [ ] **Step 8: Rename in "voorstel versturen"** (`public/index.html:4402-4432`)

Replace:
```js
    const timeStr    = rawTime || '09:00';
    const utcDueDate = new Date(`${date}T${timeStr}:00`).toISOString();

    const res  = await fetch('/api/propose', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ticketId,
        date,
        time:          rawTime,
        utcDueDate,
        recipientEmail,
```
with:
```js
    const timeStr             = rawTime || '09:00';
    const utcInterventieDatum = new Date(`${date}T${timeStr}:00`).toISOString();

    const res  = await fetch('/api/propose', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        ticketId,
        date,
        time: rawTime,
        utcInterventieDatum,
        recipientEmail,
```

Replace:
```js
    activeTicket.status  = 'Wachten op bevestiging planning';
    activeTicket.dueDate = data.dueDate;

    allTickets = allTickets.filter(t => t.id !== ticketId);
    if (!allPending.find(t => t.id === ticketId)) allPending.push({ ...activeTicket });
    if (!planning[date]) planning[date] = [];
    if (!planning[date].find(p => p.ticket.id === ticketId)) {
      planning[date].push({ ticket: activeTicket, address: activeTicket.address, uur: extractLocalHour(data.dueDate) });
```
with:
```js
    activeTicket.status           = 'Wachten op bevestiging planning';
    activeTicket.interventieDatum = data.interventieDatum;

    allTickets = allTickets.filter(t => t.id !== ticketId);
    if (!allPending.find(t => t.id === ticketId)) allPending.push({ ...activeTicket });
    if (!planning[date]) planning[date] = [];
    if (!planning[date].find(p => p.ticket.id === ticketId)) {
      planning[date].push({ ticket: activeTicket, address: activeTicket.address, uur: extractLocalHour(data.interventieDatum) });
```

- [ ] **Step 9: Rename `extractLocalHour`'s parameter** (`public/index.html:4459-4467`)

Replace:
```js
// Haal lokaal uur:minuten op uit een ISO dueDate-string (null als 00:00 = geen uur)
function extractLocalHour(dueDate) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
```
with:
```js
// Haal lokaal uur:minuten op uit een ISO interventieDatum-string (null als 00:00 = geen uur)
function extractLocalHour(interventieDatum) {
  if (!interventieDatum) return null;
  const d = new Date(interventieDatum);
```

And further down in the same function, replace:
```js
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && dueDate.endsWith('Z')) return null;
```
with:
```js
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && interventieDatum.endsWith('Z')) return null;
```

- [ ] **Step 10: Rename in `addTicketToDate`'s scheduling fetch** (`public/index.html:2096-2100`)

This is the call site from the earlier (uncommitted) `dueDate` ISO8601 bugfix — it gets folded into this rename rather than reverted separately. Replace:
```js
      const utcDueDate = new Date(`${date}T00:00:00`).toISOString();
      const res  = await fetch('/api/plan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticketId, date, utcDueDate }),
      });
```
with:
```js
      const utcInterventieDatum = new Date(`${date}T00:00:00`).toISOString();
      const res  = await fetch('/api/plan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticketId, date, utcInterventieDatum }),
      });
```

- [ ] **Step 11: Rename in `saveToewijzen`** (`public/index.html:4589-4614`)

Replace:
```js
  const utcDueDate = new Date(`${date}T${time}:00`).toISOString();

  try {
    const res  = await fetch('/api/plan-datum', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketId, utcDueDate }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Onbekende fout');

    // Update lokale state
    const t = allPending.find(p => p.id === ticketId);
    if (t) {
      t.dueDate = utcDueDate;
      if (!planning[date]) planning[date] = [];
      if (!planning[date].find(p => p.ticket.id === ticketId)) {
        planning[date].push({ ticket: t, address: t.address, uur: extractLocalHour(utcDueDate) });
```
with:
```js
  const utcInterventieDatum = new Date(`${date}T${time}:00`).toISOString();

  try {
    const res  = await fetch('/api/plan-datum', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketId, utcInterventieDatum }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Onbekende fout');

    // Update lokale state
    const t = allPending.find(p => p.id === ticketId);
    if (t) {
      t.interventieDatum = utcInterventieDatum;
      if (!planning[date]) planning[date] = [];
      if (!planning[date].find(p => p.ticket.id === ticketId)) {
        planning[date].push({ ticket: t, address: t.address, uur: extractLocalHour(utcInterventieDatum) });
```

- [ ] **Step 12: Grep-sweep for anything missed**

```bash
grep -n "dueDate" public/index.html
```
Expected: **zero matches**. If anything remains, it was missed by the steps above — find it and rename it too (it will be one of the same two patterns: reading `t.dueDate`/`data.dueDate`, or the `utcDueDate` variable name).

- [ ] **Step 13: Verify in the browser with `?test` mode**

Start the dev server, open `http://localhost:8888/?test` (or however this repo's test mode is normally reached — check `TEST_MODE` in the code if unsure), and confirm:
- The calendar renders the 6 mock tickets on the expected days (urgency/overdue/no-date grouping all still work).
- Opening a scheduled mock ticket's detail modal shows an "Interventiedatum" row (not "Vervaldatum") with a sensible date.
- The Route tab groups tickets by date correctly.
- No console errors mentioning `undefined` where a date was expected.

- [ ] **Step 14: Commit**

```bash
git add public/index.html
git commit -m "feat: hernoem dueDate naar interventieDatum in de client"
```

---

## Before pushing to main

Per the spec's open point: test the "leegmaken" (clear-field) behavior — un-scheduling a ticket via the queue's remove action — against one real, non-critical Zoho ticket, with Brent watching/confirming. Confirm in Zoho's own UI that the "Interventie Datum" field is actually empty afterward (not just that the API call returned 200). Only after that live confirmation should this branch be pushed to `origin/main`, per the standing rule to always get fresh explicit confirmation before any push/deploy.
