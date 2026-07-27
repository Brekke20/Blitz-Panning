# Aantal Laadpalen + Installatie-blokkade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "aantal laadpalen" field next to the service-rapport wizard's serienummer field (labeled as the "master" unit), and block completing a report when the visit is classified as "Installatie".

**Architecture:** Both changes are client-side only, inside the single-file PWA `public/index.html`. No backend/Netlify Functions changes — `archiveerRapport()` already spreads the whole `R` object into `rapportData`, so the new field is archived automatically with no extra work.

**Tech Stack:** Vanilla JS (no framework, no build step), local dev server (`node dev-server.mjs`, port 3333) for manual verification.

## Global Constraints

- No backend/Netlify Functions changes — `public/index.html` only.
- All UI text in Dutch.
- **No automated test framework exists in this codebase.** Every verification step below is a manual procedure against the local dev server, using the app's `?test` query-param mode (`DUMMY_DATA`) for fixtures, plus direct browser-console state injection where needed.
- Commit after each task with `git add public/index.html` (never `-A`) and a `feat:`/`fix:` prefixed message. **Do not push** — this repo auto-deploys to production on push to `main`; Brent confirms separately when it's time to push.
- This plan is intended to run in an isolated git worktree (via `EnterWorktree`), per this project's established workflow.

---

### Task 1: Aantal laadpalen veld

**Files:**
- Modify: `public/index.html` (`R` object ~line 4834, `openRapport()`'s reset ~line 4914, `wizRenderProduct`/`wizSaveProduct` ~line 5226-5280, `buildRapportHtml()`'s Serienummer info-cell ~line 5792)

**Interfaces:**
- Produces: `R.aantalLaadpalen` (`number`, always ≥ 1) — no other task in this plan consumes it, but it's archived automatically via the existing `archiveerRapport()` spread.

- [ ] **Step 1: Manual baseline check**

Start the dev server: `node dev-server.mjs` (from the repo root). In a browser, open `http://localhost:3333/?test`, open dummy ticket **#1006**'s rapport wizard (Ingepland tab → click the ticket → 📋 Rapport), click **Volgende →** twice (Algemeen → Facturatie) to reach the **Product** step.

Confirm today's baseline: the field is labeled just "Serienummer", with no count field next to it. Close the wizard without printing.

- [ ] **Step 2: Add `aantalLaadpalen` to the `R` object**

Find (line 4828-4837):

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
```

Replace the `installateur` line with:

```js
  installateur: '', serienummer: '', aantalLaadpalen: 1, type: '', uitvoering: '', kabel: '', kabellengte: '',
```

- [ ] **Step 3: Reset `aantalLaadpalen` when a new wizard session starts**

Find (line 4914, inside `openRapport()`):

```js
  R.type = ''; R.uitvoering = ''; R.kabel = ''; R.kabellengte = '';
```

Replace with:

```js
  R.type = ''; R.uitvoering = ''; R.kabel = ''; R.kabellengte = ''; R.aantalLaadpalen = 1;
```

- [ ] **Step 4: Rename the Serienummer field and add the Aantal field**

Find (line 5226-5236, the start of `wizRenderProduct`):

```js
function wizRenderProduct(el) {
  el.innerHTML = `
    <div class="wiz-step-title">Productinformatie</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Installateur / partner</label>
      <input class="wiz-input" id="f-installateur" type="text" value="${escHtml(R.installateur)}" placeholder="Installateur" />
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Serienummer</label>
      <input class="wiz-input" id="f-serienummer" type="text" value="${escHtml(R.serienummer)}" placeholder="CHARX-XXXX" />
    </div>
```

Replace with:

```js
function wizRenderProduct(el) {
  el.innerHTML = `
    <div class="wiz-step-title">Productinformatie</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Installateur / partner</label>
      <input class="wiz-input" id="f-installateur" type="text" value="${escHtml(R.installateur)}" placeholder="Installateur" />
    </div>
    <div class="wiz-field-row">
      <div class="wiz-field">
        <label class="wiz-field-label">Serienummer (master laadpaal)</label>
        <input class="wiz-input" id="f-serienummer" type="text" value="${escHtml(R.serienummer)}" placeholder="CHARX-XXXX" />
      </div>
      <div class="wiz-field">
        <label class="wiz-field-label">Aantal laadpalen</label>
        <input class="wiz-input" id="f-aantal-laadpalen" type="number" min="1" step="1" value="${R.aantalLaadpalen || 1}" />
      </div>
    </div>
```

Everything after this (Type/Uitvoering/Kabeltype radio-cards, and the closing backtick) stays exactly as-is — do not touch the rest of the function body.

- [ ] **Step 5: Save the new field**

Find (line 5273-5280):

```js
function wizSaveProduct() {
  R.installateur = wizV('f-installateur');
  R.serienummer  = wizV('f-serienummer');
  R.type         = wizChecked('f-type');
  R.uitvoering   = wizChecked('f-uitvoering');
  R.kabel        = wizChecked('f-kabel');
  R.kabellengte  = wizChecked('f-kabellengte');
}
```

Replace with:

```js
function wizSaveProduct() {
  R.installateur     = wizV('f-installateur');
  R.serienummer      = wizV('f-serienummer');
  R.aantalLaadpalen  = parseInt(wizV('f-aantal-laadpalen')) || 1;
  R.type             = wizChecked('f-type');
  R.uitvoering       = wizChecked('f-uitvoering');
  R.kabel            = wizChecked('f-kabel');
  R.kabellengte      = wizChecked('f-kabellengte');
}
```

- [ ] **Step 6: Show the count on the PDF when there's more than 1**

Find (line 5791-5794, inside `buildRapportHtml()`):

```js
  <div class="info-row cols-2">
    <div class="info-cell"><div class="info-lbl">Serienummer</div><div class="info-val">${escHtml(R.serienummer)||'—'}</div></div>
    <div class="info-cell"><div class="info-lbl">Type / uitvoering</div><div class="info-val">${productInfo}</div></div>
  </div>
```

Replace with:

```js
  <div class="info-row cols-2">
    <div class="info-cell"><div class="info-lbl">Serienummer</div><div class="info-val">${R.aantalLaadpalen > 1 ? `${escHtml(R.serienummer)||'—'} (master) — ${R.aantalLaadpalen}×` : (escHtml(R.serienummer)||'—')}</div></div>
    <div class="info-cell"><div class="info-lbl">Type / uitvoering</div><div class="info-val">${productInfo}</div></div>
  </div>
```

This line is inside the template-literal function `buildRapportHtml()` — `R` is in module scope, no import needed.

- [ ] **Step 7: Manual verification — field renders, saves, and shows on the PDF correctly**

Hard-refresh `http://localhost:3333/?test`, open ticket #1006's rapport wizard again, click through to the **Product** step.

Confirm:
1. The field now reads "Serienummer (master laadpaal)", with a new "Aantal laadpalen" field next to it showing `1` by default.
2. Type `CHARX-9999` in the serienummer field, change "Aantal laadpalen" to `3`, click **Volgende →** then **← Terug** — both values are still there (state persisted on `R`).
3. Click through to the last step and print (**🖨️ Afdrukken / PDF**). In the new report tab, confirm the "Serienummer" info-cell reads `CHARX-9999 (master) — 3×`.
4. Open a fresh wizard session for a different ticket, leave "Aantal laadpalen" untouched (still `1`), print. Confirm the Serienummer info-cell shows just the plain serienummer (no "(master)"/"×" suffix) — i.e. zero visible change for the single-charger case.
5. Test the edge case: open a fresh session, clear the "Aantal laadpalen" field entirely (empty string) before printing. Confirm the report doesn't crash and effectively treats it as `1` (no "(master)"/"×" suffix shown) — run `console.log(R.aantalLaadpalen)` right after clicking Volgende off the Product step to confirm it reads `1`, not `NaN` or `0`.

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "feat: voeg aantal-laadpalen veld toe aan service rapport"
```

---

### Task 2: Installatie-blokkade in de rapport-wizard

**Files:**
- Modify: `public/index.html` (`wizNext()` ~line 4958-4971, `wizSaveOmschrijving()` ~line 5311-5318, `wizSaveAlgemeen()` ~line 5069-5077)

**Interfaces:**
- Produces: a step's `save()` function may now return a `string` (in addition to the existing `false`) to block step advancement with that string as the toast message. Any future wizard step that needs this same validation-block pattern can return a string from its own `save()` — no other code changes needed elsewhere.

- [ ] **Step 1: Manual baseline check**

With the dev server running, open `http://localhost:3333/?test`, open dummy ticket **#1006**'s rapport wizard, on the **Algemeen** step select "Installatie" for "Type bezoek", then click **Volgende →**.

Confirm today's baseline bug: the wizard advances to the **Facturatie** step with no warning at all — a technician can currently finish and print/archive a report for an installation visit.

- [ ] **Step 2: Generalize `wizNext()`'s block-with-message handling**

Find (line 4958-4971):

```js
function wizNext() {
  const step = WIZ_STEPS[_wizStep];
  \ NOTE: toast text is Omschrijving-specific; generalize (e.g. save() returning the message) if another step opts into save()===false
  if (step.save && step.save() === false) {
    toast('⚠️ Selecteer minstens één oorzaak storing', 3500);
    return;
  }
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
  const step   = WIZ_STEPS[_wizStep];
  const result = step.save ? step.save() : undefined;
  if (result === false || typeof result === 'string') {
    toast(typeof result === 'string' ? result : '⚠️ Kan niet doorgaan naar de volgende stap', 3500);
    return;
  }
  if (_wizStep < WIZ_STEPS.length - 1) {
    _wizStep++;
    wizRenderStep();
  } else {
    printRapport();
  }
}
```

- [ ] **Step 3: Move the Omschrijving-specific message into its own step**

Find (line 5311-5318):

```js
function wizSaveOmschrijving() {
  R.probleem = wizV('f-probleem');
  R.acties   = wizV('f-acties');
  R.oorzaakStoring = Object.entries(OORZAAK_STORING_MAP)
    .filter(([id]) => document.getElementById(id)?.checked)
    .map(([, label]) => label);
  return R.oorzaakStoring.length > 0;
}
```

Replace with:

```js
function wizSaveOmschrijving() {
  R.probleem = wizV('f-probleem');
  R.acties   = wizV('f-acties');
  R.oorzaakStoring = Object.entries(OORZAAK_STORING_MAP)
    .filter(([id]) => document.getElementById(id)?.checked)
    .map(([, label]) => label);
  if (!R.oorzaakStoring.length) return '⚠️ Selecteer minstens één oorzaak storing';
}
```

(This preserves the exact same toast text and blocking behavior as before — only the *mechanism* changes, from a hardcoded check in `wizNext()` to the step owning its own message.)

- [ ] **Step 4: Block advancement when "Installatie" is selected**

Find (line 5069-5077):

```js
function wizSaveAlgemeen() {
  R.datum           = wizV('f-datum');
  R.technieker      = wizV('f-technieker');
  R.adres           = wizV('f-adres');
  R.start           = wizV('f-start');
  R.stop            = wizV('f-stop');
  R.werktijd        = calcWerktijd(R.start, R.stop);
  R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
}
```

Replace with:

```js
function wizSaveAlgemeen() {
  R.datum           = wizV('f-datum');
  R.technieker      = wizV('f-technieker');
  R.adres           = wizV('f-adres');
  R.start           = wizV('f-start');
  R.stop            = wizV('f-stop');
  R.werktijd        = calcWerktijd(R.start, R.stop);
  R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
  if (R.interventieType === 'Installatie') {
    return '⚠️ Voor installaties wordt geen rapport aangemaakt — de klant kreeg hiervoor al een offerte.';
  }
}
```

- [ ] **Step 5: Manual verification — Installatie blocks, Interventie and Omschrijving still work, Terug still works**

Hard-refresh `http://localhost:3333/?test`, open ticket #1006's rapport wizard.

Confirm:
1. On the **Algemeen** step, select "Installatie", click **Volgende →** → a toast reads "⚠️ Voor installaties wordt geen rapport aangemaakt — de klant kreeg hiervoor al een offerte." and the step does **not** advance (still on "Algemeen").
2. With "Installatie" still selected, click **← Terug**... there is no step before Algemeen, so instead confirm you can still close the wizard entirely with the ✕ button — no dead end.
3. Reopen the wizard, leave "Type bezoek" on the default "Interventie", click **Volgende →** → advances normally to Facturatie (no regression for the common case).
4. Click through to the **Omschrijving** step, leave all "Oorzaak storing" checkboxes unchecked, click **Volgende →** → still shows "⚠️ Selecteer minstens één oorzaak storing" and still blocks (confirms Step 3's refactor didn't change this step's existing behavior). Check one box, click **Volgende →** again → advances normally.
5. Go back to the **Algemeen** step (via **← Terug** repeatedly), switch "Type bezoek" back to "Installatie", then click **← Terug** (if there's an earlier step) or otherwise confirm backward navigation is never blocked regardless of which radio is selected — `wizBack()` was intentionally left unchanged.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "fix: blokkeer rapport-wizard bij bezoektype Installatie"
```

---

## Post-plan note

Neither commit above is pushed. When Brent confirms it's time to deploy, push both (plus any earlier unpushed commits from prior sessions) with a single `git push origin main` — Netlify auto-deploys ~30s after.
