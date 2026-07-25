# Rapport-paginering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the multi-page service-report PDF break cleanly between sections instead of mid-section, and add page numbers to the Zoho-archived (puppeteer-generated) copy.

**Architecture:** Add print-pagination CSS to `buildRapportHtml()`'s inline `<style>` block and wrap short sections in a `.rapport-section` container with `break-inside: avoid`. Long sections (photos, tables) stay unwrapped but get item/row-level `break-inside: avoid` plus a repeating table header, so they can span pages without cutting an individual item. Add puppeteer's `displayHeaderFooter`/`footerTemplate`/`margin` options in `rapport.js` for page numbers on the archived copy only.

**Tech Stack:** Plain CSS (`break-inside`, `break-after`, `page-break-*` for broader compatibility), Puppeteer's `page.pdf()` header/footer API.

## Global Constraints

- Two rendering paths share the same `buildRapportHtml()` output: browser-print (`printRapport()`, technician's own download) and puppeteer (`rapport.js`, Zoho-archived copy). The CSS fix in Task 1 applies to both automatically.
- Page numbers are puppeteer-only (Task 2). Do not attempt to add page numbers to the browser-print path — Chromium's print engine does not reliably support CSS Paged Media margin-box content, confirmed during brainstorming.
- Short sections that must never be cut mid-section: klantgegevens-infogrid, Omschrijving probleem, Ondernomen acties, Oorzaak storing, Status laadinfrastructuur, Varia (if present), Handtekeningen.
- Long sections that MAY span pages, but never mid-item/mid-row: Foto's grid, Vervangen onderdelen table, Loonkosten table. Each individual photo/row gets `break-inside: avoid`; table headers repeat via `display: table-header-group`; the `.sec` header itself gets `break-after: avoid` so it's never left alone at the bottom of a page.
- `rapport.js`'s `page.pdf()` currently has no `margin` set (defaults to 0) — the footer needs `margin.bottom` reserved so it doesn't overlap report content; `buildRapportHtml()`'s own `body{padding:13mm 17mm}` already simulates the visual margins, so only `margin.bottom` needs a non-zero value for the footer's own space.

---

### Task 1: Section-aware print CSS in `buildRapportHtml()` (`public/index.html`)

**Files:**
- Modify: `public/index.html:5539-5669` (inside `buildRapportHtml()`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by Task 2 — the two tasks are independent (Task 2 only needs the same `buildRapportHtml()` output HTML, which is unaffected in shape/data, only in CSS).

- [ ] **Step 1: Add the pagination CSS rules to the `<style>` block**

Replace:
```css
  .sec{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;border-bottom:1px solid #ddd;padding-bottom:2px;margin:12px 0 7px}
```
with:
```css
  .sec{font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#555;border-bottom:1px solid #ddd;padding-bottom:2px;margin:12px 0 7px;break-after:avoid;page-break-after:avoid}
  .rapport-section{break-inside:avoid;page-break-inside:avoid}
```

Replace:
```css
  table.parts{width:100%;border-collapse:collapse;font-size:9pt}
  table.parts th{background:#f5f5f5;border:1px solid #ddd;padding:4px 7px;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;text-align:left}
  table.parts td{border:1px solid #ddd;padding:4px 7px}
```
with:
```css
  table.parts{width:100%;border-collapse:collapse;font-size:9pt}
  table.parts thead{display:table-header-group}
  table.parts tr{break-inside:avoid;page-break-inside:avoid}
  table.parts th{background:#f5f5f5;border:1px solid #ddd;padding:4px 7px;font-size:7.5pt;text-transform:uppercase;letter-spacing:.05em;text-align:left}
  table.parts td{border:1px solid #ddd;padding:4px 7px}
```

Replace:
```css
  .foto-report-item{border:1px solid #e0e0e0;border-radius:4px;padding:4px;background:#fafafa}
```
with:
```css
  .foto-report-item{border:1px solid #e0e0e0;border-radius:4px;padding:4px;background:#fafafa;break-inside:avoid;page-break-inside:avoid}
```

- [ ] **Step 2: Wrap the klantgegevens-infogrid in `.rapport-section`**

Replace:
```html
<div class="info-grid">
  <div class="info-row cols-3">
```
with:
```html
<div class="rapport-section info-grid">
  <div class="info-row cols-3">
```

(The closing `</div>` for `.info-grid` is unchanged — it already closes this same element, now also serving as the `.rapport-section` wrapper. No other edit needed here.)

- [ ] **Step 3: Wrap Omschrijving probleem, Ondernomen acties, and Oorzaak storing**

Replace:
```html
<div class="sec">Omschrijving probleem</div>
<div class="block">${R.probleem||'&nbsp;'}</div>
<div class="sec">Ondernomen acties</div>
<div class="block">${R.acties||'&nbsp;'}</div>
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
```
with:
```html
<div class="rapport-section">
<div class="sec">Omschrijving probleem</div>
<div class="block">${R.probleem||'&nbsp;'}</div>
</div>
<div class="rapport-section">
<div class="sec">Ondernomen acties</div>
<div class="block">${R.acties||'&nbsp;'}</div>
</div>
<div class="rapport-section">
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
</div>
```

- [ ] **Step 4: Wrap Status laadinfrastructuur**

Replace:
```html
<div class="sec">Status laadinfrastructuur</div>
<div class="status-row">
  <div class="status-cell"><div class="info-lbl">Definitief hersteld</div><strong>${R.hersteld==='ja'?'Ja':'Nee'}</strong></div>
  <div class="status-cell"><div class="info-lbl">Nieuwe interventie nodig</div><strong>${R.nieuwInter==='ja'?'Ja':'Nee'}</strong></div>
</div>
```
with:
```html
<div class="rapport-section">
<div class="sec">Status laadinfrastructuur</div>
<div class="status-row">
  <div class="status-cell"><div class="info-lbl">Definitief hersteld</div><strong>${R.hersteld==='ja'?'Ja':'Nee'}</strong></div>
  <div class="status-cell"><div class="info-lbl">Nieuwe interventie nodig</div><strong>${R.nieuwInter==='ja'?'Ja':'Nee'}</strong></div>
</div>
</div>
```

- [ ] **Step 5: Wrap Varia (conditional section)**

Replace:
```html
${R.varia ? `<div class="sec">Varia</div><div class="block">${R.varia}</div>` : ''}
```
with:
```html
${R.varia ? `<div class="rapport-section"><div class="sec">Varia</div><div class="block">${R.varia}</div></div>` : ''}
```

- [ ] **Step 6: Wrap Handtekeningen**

Replace:
```html
<div class="sec">Handtekeningen</div>
<div class="sig-row">
  <div class="sig-box"><div class="sig-box-title">Technieker</div>${sigTechImg}</div>
  <div class="sig-box"><div class="sig-box-title">Klant</div>${sigKlantImg}</div>
</div>
```
with:
```html
<div class="rapport-section">
<div class="sec">Handtekeningen</div>
<div class="sig-row">
  <div class="sig-box"><div class="sig-box-title">Technieker</div>${sigTechImg}</div>
  <div class="sig-box"><div class="sig-box-title">Klant</div>${sigKlantImg}</div>
</div>
</div>
```

- [ ] **Step 7: Do NOT wrap Foto's, Vervangen onderdelen, or Loonkosten**

Leave these three sections exactly as they are in the source — no wrapping `.rapport-section` div. Their pagination behavior comes entirely from the CSS added in Step 1 (`.sec{break-after:avoid}`, `table.parts tr{break-inside:avoid}`, `table.parts thead{display:table-header-group}`, `.foto-report-item{break-inside:avoid}`), which already applies globally without needing a wrapper. This is intentional per the plan's Global Constraints — these three sections may legitimately span multiple pages.

- [ ] **Step 8: Verify in the browser**

Start the dev server, open the app, go through the rapport wizard for a test ticket, and add enough content to force at least 2 pages: a long paragraph in "Omschrijving probleem" (e.g. paste several sentences repeated), a long paragraph in "Ondernomen acties", 3+ photos if the photo feature is reachable in test mode, and 2-3 "Vervangen onderdelen" rows. Generate the report (`printRapport()` — this opens a new tab with the report HTML). In that new tab, use the browser's print preview (Ctrl+P, or File > Print) to check pagination across pages:
- No section's `.sec` heading appears alone at the bottom of a page with its content starting on the next page.
- No text block, table row, or photo is visually split across a page boundary.
- If the onderdelen table spans two pages, confirm the column headers repeat at the top of the second page.

Use `mcp__Claude_Browser__*` tools to actually navigate through this and take a screenshot of the print preview if the tooling allows it — don't just claim you verified it.

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: voorkom mid-sectie pagina-afbrekingen in het service rapport"
```

---

### Task 2: Page numbers on the puppeteer-generated (Zoho) PDF (`netlify/functions/rapport.js`)

**Files:**
- Modify: `netlify/functions/rapport.js:77-80`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing consumed elsewhere — this is a leaf change to one function's `page.pdf()` call.

- [ ] **Step 1: Add header/footer and margin options to `page.pdf()`**

Replace:
```js
    const pdfBuffer = await page.pdf({
      format:          'A4',
      printBackground: true,
    });
```
with:
```js
    const pdfBuffer = await page.pdf({
      format:             'A4',
      printBackground:    true,
      displayHeaderFooter: true,
      headerTemplate:      '<span></span>',
      footerTemplate: `
        <div style="font-size:8px;width:100%;text-align:center;color:#888;font-family:Arial,Helvetica,sans-serif">
          Pagina <span class="pageNumber"></span> van <span class="totalPages"></span>
        </div>`,
      margin: { top: '0mm', bottom: '12mm', left: '0mm', right: '0mm' },
    });
```

(`headerTemplate: '<span></span>'` is required — without an explicit, non-empty-string header template, Chromium falls back to its own default header showing the document title and URL. An empty-looking but valid element suppresses that without adding visible content.)

- [ ] **Step 2: Verify locally**

`rapport.js` is a classic `handler(event)`-style function and runs under `dev-server.mjs`. Start the dev server, and either:
- Trigger a real report generation through the app (rapport wizard → generate → this calls `/api/rapport` in the background to archive to Zoho), or
- Call the endpoint directly with a minimal test payload:

```bash
curl -s -X POST http://localhost:8888/api/rapport \
  -H "Content-Type: application/json" \
  -d '{"html":"<html><body><h1>Test</h1><p>Pagina-test</p></body></html>","ticketId":"157486000011122009","filename":"test-paginering.pdf"}'
```

(Use the existing test ticket #3731, internal id `157486000011122009`, already used for prior live tests this session — this call uploads a real attachment to that real ticket, same as the earlier PDF-attachment feature's live tests. No email is sent by this endpoint.)

Expected: `{"success":true,"attachmentId":"..."}`. Then check that ticket's attachments in Zoho (or via a follow-up read-only API call) to confirm the uploaded PDF has a visible "Pagina 1 van 1" footer and no default Chromium header (title/URL) at the top.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/rapport.js
git commit -m "feat: voeg paginanummers toe aan het gearchiveerde service-rapport"
```
