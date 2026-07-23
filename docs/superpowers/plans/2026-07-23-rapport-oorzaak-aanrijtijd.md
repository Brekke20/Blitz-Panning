# Rapport: Oorzaak storing + zichtbare aanrijtijd Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a required "Oorzaak storing" field and an always-visible "Aanrijtijd" info-cell to the service-rapport wizard, report HTML, and TicketLog Excel export.

**Architecture:** All changes are client-side, inside the single-file PWA `public/index.html`. No backend/Netlify Functions changes — the existing `archiveerRapport()` already spreads the whole `R` object into `rapportData`, so new `R` fields are archived automatically.

**Tech Stack:** Vanilla JS (no framework, no build step), ExcelJS 4.4.0 (CDN) for export, local dev server (`node dev-server.mjs`, port 3333) for manual verification.

## Global Constraints

- No backend/Netlify Functions changes — `public/index.html` only.
- All UI text in Dutch.
- No external CSS frameworks — reuse existing inline classes (`.wiz-radio-card`, `.info-cell`, `.sec`, `.block`).
- Excel export must keep dynamic column width (`max(header_len+2, max_data_len+1, 8)`, capped at 36 or `WRAP_MAX` for wrap columns) and dynamic row height (`ceil(text.length / (colWidth*1.15)) * 14 + 2`) — per project convention in `CLAUDE.md`.
- **No automated test framework exists in this codebase.** Every verification step below is a manual procedure against the local dev server, using the app's built-in `?test` query-param mode (`DUMMY_DATA`) for deterministic fixtures, and direct browser-console state injection where the dev server can't reach a real backend (see note in Task 3). This replaces the "write failing test / make it pass" cycle referenced by the general plan template.
- Commit after each task with `git add public/index.html` (never `-A`) and a `feat:`/`fix:` prefixed message, per `CLAUDE.md` commit convention. **Do not push** — this repo auto-deploys to production on push to `main`; the user (Brent) confirms separately when it's time to push.

---

### Task 1: Data model + wizard "Omschrijving" step — Oorzaak storing field

**Files:**
- Modify: `public/index.html` (CSS ~line 950, `R` object ~line 4489, `openRapport()` ~line 4529, `wizRenderOmschrijving`/`wizSaveOmschrijving` ~line 4925-4941, `wizNext()` ~line 4613)

**Interfaces:**
- Produces: `R.oorzaakStoring` (`string[]`, values from `'Productfout' | 'Installatiefout' | 'Configuratiefout' | 'Andere'`) — consumed by Task 2 (report HTML) and Task 3 (Excel export) via the archived `rapportData.oorzaakStoring`.
- Produces: `wizNext()` now aborts step advancement when a step's `save()` returns exactly `false` — any future step's `save` function can opt into this same validation contract.

- [ ] **Step 1: Locate the current wizard step-save contract**

Read `public/index.html` around line 4613 and confirm it currently reads:

```js
function wizNext() {
  if (WIZ_STEPS[_wizStep].save) WIZ_STEPS[_wizStep].save();
  if (_wizStep < WIZ_STEPS.length - 1) {
    _wizStep++;
    wizRenderStep();
  } else {
    printRapport();
  }
}
```

If the surrounding code differs from this (e.g. already refactored), stop and re-read this task's remaining steps before editing — line numbers below assume this exact starting state.

- [ ] **Step 2: Manual baseline check (no validation exists yet)**

Start the dev server: `node dev-server.mjs` (from the repo root; requires `.env.local` to already exist, which it does in this repo).

In a browser, open `http://localhost:3333/?test`, click the **Ingepland** tab, click ticket **#1006** (Periodiek onderhoud laadpalen) to open its detail modal, click **📋 Rapport**. Click **Volgende →** three times (through Algemeen → Facturatie → Product) to reach the **Omschrijving** step.

Confirm today's baseline: there is no "Oorzaak storing" field on this step, and clicking **Volgende →** always advances regardless of what's filled in. This confirms the gap this task closes. Close the wizard (✕) without printing.

- [ ] **Step 3: Add checkbox accent styling for the existing radio-card CSS rule**

In `public/index.html`, find (around line 950):

```css
    .wiz-radio-card input[type=radio] { accent-color: var(--accent); width: 20px; height: 20px; flex-shrink: 0; cursor: pointer; }
```

Replace with:

```css
    .wiz-radio-card input[type=radio], .wiz-radio-card input[type=checkbox] { accent-color: var(--accent); width: 20px; height: 20px; flex-shrink: 0; cursor: pointer; }
```

(The existing `.wiz-radio-card:has(input:checked)` selector on the next line already works for any input type — no change needed there.)

- [ ] **Step 4: Add `oorzaakStoring` to the `R` object**

Find (around line 4489):

```js
const R = {
  datum: '', technieker: '', adres: '', start: '', stop: '', werktijd: '',
  facturatie: 'klant', facturatieVrij: '',
  servicetype: '2e-lijn',
  aanrijtijdMin: 0,
  interventieType: 'Interventie',
  installateur: '', serienummer: '', type: '', uitvoering: '', kabel: '', kabellengte: '',
  probleem: '', acties: '',
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
  hersteld: 'nee', nieuwInter: 'nee',
  varia: '',
  onderdelen: [],
};
```

- [ ] **Step 5: Reset `oorzaakStoring` when a new wizard session starts**

In `openRapport()`, find (around line 4529):

```js
  R.probleem     = ticket.subject || '';
  R.acties       = '';
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
```

- [ ] **Step 6: Add the checkbox UI to the "Omschrijving" step**

Find (around line 4925-4941):

```js
// ── Stap 4: Omschrijving & acties ──
function wizRenderOmschrijving(el) {
  el.innerHTML = `
    <div class="wiz-step-title">Omschrijving &amp; acties</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Omschrijving probleem</label>
      <textarea class="wiz-textarea" id="f-probleem" rows="4" placeholder="Beschrijf het probleem...">${R.probleem}</textarea>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Ondernomen acties</label>
      <textarea class="wiz-textarea" id="f-acties" rows="6" placeholder="Beschrijf de uitgevoerde werkzaamheden...">${R.acties}</textarea>
    </div>`;
}
function wizSaveOmschrijving() {
  R.probleem = wizV('f-probleem');
  R.acties   = wizV('f-acties');
}
```

Replace with:

```js
// ── Stap 4: Omschrijving & acties ──
const OORZAAK_STORING_MAP = {
  'f-oorzaak-product':      'Productfout',
  'f-oorzaak-installatie':  'Installatiefout',
  'f-oorzaak-configuratie': 'Configuratiefout',
  'f-oorzaak-andere':       'Andere',
};

function wizRenderOmschrijving(el) {
  el.innerHTML = `
    <div class="wiz-step-title">Omschrijving &amp; acties</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Omschrijving probleem</label>
      <textarea class="wiz-textarea" id="f-probleem" rows="4" placeholder="Beschrijf het probleem...">${R.probleem}</textarea>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Ondernomen acties</label>
      <textarea class="wiz-textarea" id="f-acties" rows="6" placeholder="Beschrijf de uitgevoerde werkzaamheden...">${R.acties}</textarea>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Oorzaak storing</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-product" ${R.oorzaakStoring.includes('Productfout')?'checked':''}><div><div class="wiz-radio-card-label">Productfout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-installatie" ${R.oorzaakStoring.includes('Installatiefout')?'checked':''}><div><div class="wiz-radio-card-label">Installatiefout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-configuratie" ${R.oorzaakStoring.includes('Configuratiefout')?'checked':''}><div><div class="wiz-radio-card-label">Configuratiefout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-andere" ${R.oorzaakStoring.includes('Andere')?'checked':''}><div><div class="wiz-radio-card-label">Andere</div></div></label>
      </div>
    </div>`;
}
function wizSaveOmschrijving() {
  R.probleem = wizV('f-probleem');
  R.acties   = wizV('f-acties');
  R.oorzaakStoring = Object.entries(OORZAAK_STORING_MAP)
    .filter(([id]) => document.getElementById(id)?.checked)
    .map(([, label]) => label);
  if (!R.oorzaakStoring.length) {
    toast('⚠️ Selecteer minstens één oorzaak storing', 3500);
    return false;
  }
}
```

- [ ] **Step 7: Make `wizNext()` respect a `false` return from `save()`**

Find (around line 4613):

```js
function wizNext() {
  if (WIZ_STEPS[_wizStep].save) WIZ_STEPS[_wizStep].save();
  if (_wizStep < WIZ_STEPS.length - 1) {
    _wizStep++;
    wizRenderStep();
  } else {
    printRapport();
  }
}
```

Replace with:

```js
function wizNext() {
  const step = WIZ_STEPS[_wizStep];
  if (step.save && step.save() === false) return;
  if (_wizStep < WIZ_STEPS.length - 1) {
    _wizStep++;
    wizRenderStep();
  } else {
    printRapport();
  }
}
```

This only short-circuits when a `save()` explicitly returns `false` — every other existing step's `save()` returns `undefined`, so their behavior is unchanged.

- [ ] **Step 8: Manual verification — validation blocks the step**

Restart/reload the dev server page (hard refresh `http://localhost:3333/?test` so the edited script loads). Repeat the navigation from Step 2 to reach the **Omschrijving** step.

Confirm:
1. Four checkboxes now render under a new "Oorzaak storing" label: Productfout, Installatiefout, Configuratiefout, Andere.
2. Click **Volgende →** with none checked → a toast appears reading "⚠️ Selecteer minstens één oorzaak storing" and the step does **not** advance (still shows "4 / 7 — Omschrijving").
3. Check "Productfout", click **Volgende →** again → the wizard advances to the **Status** step (5 / 7).
4. Click **← Terug** back to Omschrijving → "Productfout" is still checked (state persisted on `R`).

Close the wizard without printing.

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: add required oorzaak-storing veld aan rapport-wizard"
```

---

### Task 2: Report HTML — Oorzaak storing sectie + altijd-zichtbare aanrijtijd

**Files:**
- Modify: `public/index.html` (CSS ~line 5299, `berekenLoonkost` area ~line 4727 for new helper, `buildRapportHtml` info-grid ~line 5320-5347)

**Interfaces:**
- Consumes: `R.oorzaakStoring` (`string[]`, from Task 1), `R.aanrijtijdMin` (`number`, pre-existing).
- Produces: `fmtDuur(min: number): string` — new module-level helper (formats minutes as `"1u30"`/`"1u"`/`"45 min"`), available for reuse by any future report section that needs the same formatting (the two pre-existing inline duplicates in `wizLoonkostPreview`/`buildRapportHtml`'s loonkosten block are intentionally left as-is — out of scope for this plan).

- [ ] **Step 1: Manual baseline check**

With the dev server running, open `http://localhost:3333/?test`, open ticket **#1006**'s rapport wizard (as in Task 1 Step 2), click through to the last step ("Handtekening 2"), then click **🖨️ Afdrukken / PDF**. A new tab opens with the report HTML.

Confirm today's baseline: there is no "Oorzaak storing" section, and no "Aanrijtijd" info-cell anywhere in the Start/Stop/Werktijd row (regardless of servicetype). Close that tab; back in the wizard tab, close the wizard.

- [ ] **Step 2: Add the `fmtDuur` helper**

Find (around line 4727-4728):

```js
function berekenLoonkost(servicetype, werktijdMin, aanrijtijdMin) {
```

Insert immediately **before** that line:

```js
function fmtDuur(min) {
  const h = Math.floor(min / 60), mn = min % 60;
  return h > 0 ? (mn > 0 ? `${h}u${String(mn).padStart(2,'0')}` : `${h}u`) : `${mn} min`;
}

function berekenLoonkost(servicetype, werktijdMin, aanrijtijdMin) {
```

- [ ] **Step 3: Add a 4-column grid CSS rule**

Find (around line 5299):

```css
  .info-row.cols-3{grid-template-columns:1fr 1fr 1fr}
```

Insert immediately after:

```css
  .info-row.cols-3{grid-template-columns:1fr 1fr 1fr}
  .info-row.cols-4{grid-template-columns:1fr 1fr 1fr 1fr}
```

- [ ] **Step 4: Make the Start/Stop/Werktijd row show Aanrijtijd when known**

Find (around line 5329-5333):

```html
  <div class="info-row cols-3">
    <div class="info-cell accent"><div class="info-lbl">Starttijd</div><div class="info-val">${R.start||'—'}</div></div>
    <div class="info-cell accent"><div class="info-lbl">Stoptijd</div><div class="info-val">${R.stop||'—'}</div></div>
    <div class="info-cell accent"><div class="info-lbl">Totale werktijd</div><div class="info-val">${R.werktijd||'—'}</div></div>
  </div>
```

Replace with:

```html
  <div class="info-row ${R.aanrijtijdMin > 0 ? 'cols-4' : 'cols-3'}">
    <div class="info-cell accent"><div class="info-lbl">Starttijd</div><div class="info-val">${R.start||'—'}</div></div>
    <div class="info-cell accent"><div class="info-lbl">Stoptijd</div><div class="info-val">${R.stop||'—'}</div></div>
    <div class="info-cell accent"><div class="info-lbl">Totale werktijd</div><div class="info-val">${R.werktijd||'—'}</div></div>
    ${R.aanrijtijdMin > 0 ? `<div class="info-cell accent"><div class="info-lbl">Aanrijtijd</div><div class="info-val">${fmtDuur(R.aanrijtijdMin)}</div></div>` : ''}
  </div>
```

This is inside the template-literal function `buildRapportHtml()` — `R` and `fmtDuur` are both in scope (module-level).

- [ ] **Step 5: Add the Oorzaak storing sectie**

Find (around line 5344-5347):

```html
<div class="sec">Omschrijving probleem</div>
<div class="block">${R.probleem||'&nbsp;'}</div>
<div class="sec">Ondernomen acties</div>
<div class="block">${R.acties||'&nbsp;'}</div>
```

Replace with:

```html
<div class="sec">Omschrijving probleem</div>
<div class="block">${R.probleem||'&nbsp;'}</div>
<div class="sec">Ondernomen acties</div>
<div class="block">${R.acties||'&nbsp;'}</div>
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
```

- [ ] **Step 6: Manual verification — report shows both additions**

Hard-refresh `http://localhost:3333/?test`. Open ticket #1006's rapport wizard. On the **Omschrijving** step, check "Productfout" and "Andere", click Volgende. Click through Status/handtekening steps without filling signatures (they're optional — `save: () => {}`). Click **🖨️ Afdrukken / PDF**.

In the new report tab, confirm:
1. A section titled "Oorzaak storing" appears after "Ondernomen acties", showing `Productfout, Andere`.
2. No "Aanrijtijd" info-cell appears yet (ticket #1006's dummy address may not resolve to a non-zero `aanrijtijdMin` locally without a configured `settings.startlocatie` + live TomTom key — this is expected, not a bug: the cell is conditional on `R.aanrijtijdMin > 0`).

To verify the Aanrijtijd cell itself deterministically (without depending on live TomTom/geocoding), open the browser devtools console **before** clicking print, and run:

```js
R.aanrijtijdMin = 42;
```

Then click **🖨️ Afdrukken / PDF** again and confirm the report now shows a 4th info-cell "Aanrijtijd" with value "42 min", and the row uses a 4-column layout (all 4 cells roughly equal width, none wrapping awkwardly).

Also open the **Facturatie** step of a fresh wizard session for the same ticket with servicetype "2e lijns" and re-run `R.aanrijtijdMin = 42` before printing — confirm the existing loonkosten-tabel detail line (`Aanrijtijd: 42 min · Werktijd: ...`) still renders unchanged, i.e. this task didn't regress that pre-existing display.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: toon oorzaak storing en aanrijtijd altijd in service rapport"
```

---

### Task 3: TicketLog Excel-export — Oorzaak storing kolom

**Files:**
- Modify: `public/index.html` (`exportTicketLog()` ~line 5625-5682)

**Interfaces:**
- Consumes: `rd.oorzaakStoring` where `rd = r.rapportData || {}` (from Task 1/2 — may be `undefined` for archief-records created before this change).
- Produces: a new trailing Excel column "Oorzaak storing" — no other function reads this, so no downstream interface to document.

- [ ] **Step 1: Manual baseline check**

The local dev server cannot exercise this end-to-end: `rapport-archief.js` uses the Netlify Functions v2 `export default` convention, and `dev-server.mjs` only calls a `handler` export — so `/api/rapport-archief` throws locally regardless of this change (a pre-existing limitation, documented in the project's landmine list, not something this task fixes). Verification therefore uses direct console injection of `_rapportArchief` instead of the real fetch.

With the dev server running and `http://localhost:3333/?test` open, open the browser devtools console and run:

```js
_rapportArchief = [
  { datum:'2026-07-20', technieker:'Tim', ticketId:'g1', ticketNumber:'1006',
    klant:'Shopping Antwerpen', prioriteit:'low', interventieType:'Interventie',
    hersteld:'ja', servicetype:'2e-lijn',
    rapportData: { probleem:'Test probleem', acties:'Test actie', oorzaakStoring:['Productfout','Andere'], werktijd:'1,50', start:'09:00', stop:'10:30', onderdelen:[] } },
  { datum:'2026-07-15', technieker:'Roel', ticketId:'g2', ticketNumber:'1099',
    klant:'Oud record zonder oorzaak', prioriteit:'medium', interventieType:'Interventie',
    hersteld:'ja', servicetype:'1e-lijn',
    rapportData: { probleem:'Legacy record', acties:'Legacy actie', werktijd:'1,00', start:'09:00', stop:'10:00', onderdelen:[] } },
];
```

(The second record deliberately omits `oorzaakStoring` — it simulates an archief-entry created before this feature existed.)

Go to the **Rapporten** tab, click **📊 Excel export** (leave the date filters empty). Open the downloaded `TicketLog_begin_huidig.xlsx`.

Confirm today's baseline: the sheet has 22 data columns (A–V), ending in "Notities"/"Actie" — no "Oorzaak storing" column exists yet.

- [ ] **Step 2: Add the header and data column**

Find (around line 5625-5633):

```js
  const headers = [
    'Ticket ID', 'Datum open', 'Datum interventie',
    'Technieker', 'Klant / Installateur', 'Type', 'Prio',
    'Installateur betrokken', 'Uren besteed', 'Status',
    'Remote opgelost', 'Garantiegeval', 'Component verzenden',
    'Componentbeschrijving', 'Factureerbaar', 'Bedrag EUR',
    'Factuur verzonden', 'Dagen open', 'SLA-flag',
    'PB', 'Notities', 'Actie',
  ];
  const ncols = headers.length; // 22
```

Replace with:

```js
  const headers = [
    'Ticket ID', 'Datum open', 'Datum interventie',
    'Technieker', 'Klant / Installateur', 'Type', 'Prio',
    'Installateur betrokken', 'Uren besteed', 'Status',
    'Remote opgelost', 'Garantiegeval', 'Component verzenden',
    'Componentbeschrijving', 'Factureerbaar', 'Bedrag EUR',
    'Factuur verzonden', 'Dagen open', 'SLA-flag',
    'PB', 'Notities', 'Actie', 'Oorzaak storing',
  ];
  const ncols = headers.length; // 23
```

Find (around line 5637-5639):

```js
  // 0-indexed kolommen met wrapText (lange tekst)
  // N=13 (Componentbeschrijving), U=20 (Notities), V=21 (Actie)
  const WRAP_COLS  = new Set([13, 20, 21]);
  const WRAP_MAX   = { 13: 42, 20: 58, 21: 58 };
```

Replace with:

```js
  // 0-indexed kolommen met wrapText (lange tekst)
  // N=13 (Componentbeschrijving), U=20 (Notities), V=21 (Actie), W=22 (Oorzaak storing)
  const WRAP_COLS  = new Set([13, 20, 21, 22]);
  const WRAP_MAX   = { 13: 42, 20: 58, 21: 58, 22: 40 };
```

Find (around line 5679-5682):

```js
      '', '', '', '',                               // Q R S T
      rd.probleem || '',                            // U: Notities
      rd.acties   || '',                            // V: Actie
    ];
```

Replace with:

```js
      '', '', '', '',                               // Q R S T
      rd.probleem || '',                            // U: Notities
      rd.acties   || '',                            // V: Actie
      (rd.oorzaakStoring || []).join(', '),          // W: Oorzaak storing
    ];
```

- [ ] **Step 3: Manual verification — new column present and backward-compatible**

Hard-refresh the page (the console-injected `_rapportArchief` from Step 1 is lost on refresh — re-run that same injection snippet from Step 1). Go to **Rapporten** → **📊 Excel export** again. Open the new file.

Confirm:
1. Column W is headed "Oorzaak storing", styled the same as other headers (bold, dark blue fill).
2. Row 4 (the `g1`/#1006 record) shows `Productfout, Andere` in column W, and the column is wide enough to show the full text without truncation (auto-width formula applied).
3. Row 5 (the `g2`/#1099 record, no `oorzaakStoring` in its `rapportData`) shows an **empty** cell in column W — no error, no `"undefined"` text, export didn't fail.
4. The existing columns (A–V) are unaffected — spot-check "Notities" (U) and "Actie" (V) still show `Test probleem`/`Test actie` and `Legacy record`/`Legacy actie` respectively on the right rows.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: voeg oorzaak-storing kolom toe aan TicketLog Excel-export"
```

---

## Post-plan note

None of the three commits above are pushed. When Brent confirms it's time to deploy, push all three (plus the still-pending bug #24 fix from the earlier session, if not already pushed) with a single `git push origin main` — Netlify auto-deploys ~30s after.
