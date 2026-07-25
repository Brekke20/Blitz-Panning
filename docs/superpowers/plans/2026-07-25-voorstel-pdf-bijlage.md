# Voorstel-PDF-bijlage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach the "Service Voorwaarden Blitz Power" PDF to every afspraakvoorstel e-mail, and strengthen the e-mail copy to explicitly ask for confirmation of the proposed date instead of only prompting a reply when it doesn't suit.

**Architecture:** `netlify/functions/propose.js` gains a small upload step — read the PDF from disk, upload it to the ticket via Zoho's already-proven `/tickets/{ticketId}/attachments` endpoint (the same mechanism `rapport.js` already uses in production), then reference the resulting attachment id in the `sendReply` call's `attachmentIds`. The client-side preview in `public/index.html` gets the same copy change plus an attachment indicator, kept in sync by hand (it's a separate hard-coded HTML string, not shared code with the backend).

**Tech Stack:** Netlify Functions (classic `handler(event)` style, ES module), Node's built-in `fs`/`path`/`url`, native `FormData`/`Blob` (Node 18+, same pattern as `rapport.js`).

## Global Constraints

- PDF lives at **`netlify/functions/assets/service-voorwaarden.pdf`** (moved from `Foutmeldingen en verbeteringen/SERVICE VOORWAARDEN BLITZ POWER BV.pdf`, a scratch folder for this conversation, not a permanent location).
- Netlify's function bundler does not auto-detect `fs.readFileSync` paths — `netlify.toml` needs an `included_files` entry for the `propose` function so the PDF ships to production.
- Upload endpoint: **`${ZOHO_DESK}/tickets/${ticketId}/attachments`** (multipart `FormData`, field name `file`) — confirmed working, this exact codebase's existing pattern in `rapport.js`. A generic `/uploads` endpoint returned 401 in a live test and is NOT used.
- Attachment reference in `sendReply`: `attachmentIds: [<id>]`, where `<id>` is the `id` field from the upload response (same shape `rapport.js` already relies on: `uploadData.id`).
- Display filename for the customer: **"Service Voorwaarden Blitz Power.pdf"** (independent of the file's name on disk).
- New e-mail copy (replaces the current single line in both `propose.js`'s `buildEmailHtml()` and `index.html`'s `updateProposalPreview()`):
  > *"Gelieve deze afspraak te bevestigen door op deze e-mail te antwoorden. Komt het voorgestelde tijdstip u niet uit? Laat het ons dan ook weten, zodat we samen een alternatief zoeken. In bijlage vindt u onze service voorwaarden — door de afspraak te bevestigen gaat u hiermee akkoord."*
- The PDF is uploaded fresh on every send — no caching or reuse of a previous attachment id.
- Upload/attach only happens when `recipientEmail` is present (same existing guard that already wraps the whole `sendReply` block in `propose.js:169`) — no email, no attachment, no copy change needed (nothing is sent).
- A full end-to-end live test (an actual e-mail arriving with a readable attachment) requires sending to a real inbox — this is NOT something an implementer subagent should trigger unsupervised. It happens after Task 1, with the controller and Brent together, before this branch is considered done.

---

### Task 1: Backend — PDF upload, attach, and copy change (`propose.js`, file move, `netlify.toml`)

**Files:**
- Move: `Foutmeldingen en verbeteringen/SERVICE VOORWAARDEN BLITZ POWER BV.pdf` → `netlify/functions/assets/service-voorwaarden.pdf`
- Modify: `netlify/functions/propose.js:1-9` (imports), `:92-94` (copy), `:167-213` (attachment upload + sendReply body)
- Modify: `netlify.toml` (add `[functions.propose]` section)
- Test (sandbox, not committed): a throwaway Node script, mocked `fetch`, no real Zoho calls.

**Interfaces:**
- Consumes: nothing from other tasks — this is a self-contained backend change.
- Produces: nothing consumed by Task 2 (the client preview is a separate hard-coded string, not driven by this function) — Task 2 only needs to match the new copy defined in Global Constraints above.

- [ ] **Step 1: Move the PDF into place**

```bash
mkdir -p netlify/functions/assets
git mv "Foutmeldingen en verbeteringen/SERVICE VOORWAARDEN BLITZ POWER BV.pdf" "netlify/functions/assets/service-voorwaarden.pdf"
```

- [ ] **Step 2: Add the `included_files` entry to `netlify.toml`**

Current end of file:
```toml
[functions.rapport]
  timeout = 26
```

Replace with:
```toml
[functions.rapport]
  timeout = 26

[functions.propose]
  included_files = ["netlify/functions/assets/*.pdf"]
```

- [ ] **Step 3: Add the imports `propose.js` needs to read the PDF from disk**

Replace the top of the file:
```js
// /api/propose
// Verstuurt een afspraakvoorstel naar de klant via Zoho Desk sendReply.
// POST body:
//   { ticketId, date, time, recipientEmail, recipientName, subject, serienummer }
//   time wordt afgerond naar het volgende kwartier.

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';
```

with:
```js
// /api/propose
// Verstuurt een afspraakvoorstel naar de klant via Zoho Desk sendReply.
// POST body:
//   { ticketId, date, time, recipientEmail, recipientName, subject, serienummer }
//   time wordt afgerond naar het volgende kwartier.
// Bij recipientEmail wordt ook de service-voorwaarden-PDF als bijlage meegestuurd.

import fs   from 'node:fs';
import path from 'node:path';
import url  from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const TERMS_PDF_PATH = path.join(__dirname, 'assets', 'service-voorwaarden.pdf');
const TERMS_PDF_DISPLAY_NAME = 'Service Voorwaarden Blitz Power.pdf';

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK     = 'https://desk.zoho.eu/api/v1';
```

- [ ] **Step 4: Add the attachment-upload helper function**

Add this function after `getAccessToken()` (i.e. after line 31, before `roundToNextQuarter`):
```js
async function uploadTermsAttachment(accessToken, orgId, ticketId) {
  const fileBuffer = fs.readFileSync(TERMS_PDF_PATH);
  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), TERMS_PDF_DISPLAY_NAME);

  const uploadRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/attachments`, {
    method:  'POST',
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
    body:    formData,
  });
  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) throw new Error(`Zoho attachment-upload fout (${uploadRes.status}): ${JSON.stringify(uploadData)}`);
  return uploadData.id;
}
```

- [ ] **Step 5: Update the e-mail copy in `buildEmailHtml()`**

Replace:
```js
    <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.65">
      Kan dit tijdstip u niet schikken? Beantwoord dan deze e-mail en wij zoeken samen naar een alternatief.
    </p>
```
with:
```js
    <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.65">
      Gelieve deze afspraak te bevestigen door op deze e-mail te antwoorden. Komt het voorgestelde tijdstip u
      niet uit? Laat het ons dan ook weten, zodat we samen een alternatief zoeken. In bijlage vindt u onze
      service voorwaarden — door de afspraak te bevestigen gaat u hiermee akkoord.
    </p>
```

- [ ] **Step 6: Upload the attachment and include it in the `sendReply` body**

Replace:
```js
    // 1. E-mail via sendReply EERST (anders overschrijft Zoho de status terug naar "Wachten op klant")
    let emailSent = false;
    if (recipientEmail) {
      const dateObj       = new Date(`${date}T12:00:00`);
      const formattedDate = dateObj.toLocaleDateString('nl-BE', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });

      const emailHtml = buildEmailHtml({
        recipientName: recipientName || '',
        subject:       subject || 'Servicebezoek',
        formattedDate,
        appointmentTime,
        serienummer:   serienummer || '',
      });

      const replyRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/sendReply`, {
        method:  'POST',
        headers: {
          Authorization:  `Zoho-oauthtoken ${accessToken}`,
          orgId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel:          'EMAIL',
          contentType:      'html',
          content:          emailHtml,
          fromEmailAddress,
          to:               recipientEmail,
        }),
      });
```
with:
```js
    // 1. E-mail via sendReply EERST (anders overschrijft Zoho de status terug naar "Wachten op klant")
    let emailSent = false;
    if (recipientEmail) {
      const dateObj       = new Date(`${date}T12:00:00`);
      const formattedDate = dateObj.toLocaleDateString('nl-BE', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });

      const emailHtml = buildEmailHtml({
        recipientName: recipientName || '',
        subject:       subject || 'Servicebezoek',
        formattedDate,
        appointmentTime,
        serienummer:   serienummer || '',
      });

      // Service-voorwaarden-PDF als bijlage: eerst uploaden naar het ticket
      // (zelfde bewezen patroon als rapport.js), dan meegeven aan sendReply.
      const attachmentId = await uploadTermsAttachment(accessToken, orgId, ticketId);

      const replyRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/sendReply`, {
        method:  'POST',
        headers: {
          Authorization:  `Zoho-oauthtoken ${accessToken}`,
          orgId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel:          'EMAIL',
          contentType:      'html',
          content:          emailHtml,
          fromEmailAddress,
          to:               recipientEmail,
          attachmentIds:    [attachmentId],
        }),
      });
```

- [ ] **Step 7: Write and run a sandboxed verification script (no real Zoho calls)**

Create a scratch file (not committed) `test-propose-attachment.mjs`:

```js
const calls = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, opts });
  if (url.includes('/oauth/v2/token')) return { json: async () => ({ access_token: 'fake-token' }) };
  if (url.includes('/organizations')) return { json: async () => ({ data: [{ id: 'org123' }] }) };
  if (url.includes('/attachments')) return { ok: true, json: async () => ({ id: 'attach-999' }) };
  if (url.includes('/sendReply')) return { ok: true, text: async () => '' };
  if (url.includes('/tickets/') && opts.method === 'PATCH') return { ok: true, text: async () => '' };
  throw new Error('Unexpected fetch: ' + url);
};
process.env.ZOHO_REFRESH_TOKEN = 'x';
process.env.ZOHO_CLIENT_ID = 'x';
process.env.ZOHO_CLIENT_SECRET = 'x';
process.env.ZOHO_FROM_EMAIL = 'test@example.com';

import { pathToFileURL } from 'url';
const { handler } = await import(pathToFileURL(process.argv[2]).href);

const res = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({
    ticketId: 't1', date: '2026-07-27', time: '09:00',
    recipientEmail: 'klant@test.be', recipientName: 'Test Klant',
    subject: 'Test', serienummer: 'X1',
    utcInterventieDatum: new Date('2026-07-27T09:00:00').toISOString(),
  }),
});

const uploadCall = calls.find(c => c.url.includes('/attachments'));
const replyCall  = calls.find(c => c.url.includes('/sendReply'));
console.log('Upload happened:', !!uploadCall);
console.log('sendReply body includes attachmentIds:', JSON.parse(replyCall.opts.body).attachmentIds);
console.log('sendReply body includes new copy:', JSON.parse(replyCall.opts.body).content.includes('Gelieve deze afspraak te bevestigen'));
console.log('Handler response:', res);
```

Run: `node test-propose-attachment.mjs "/absolute/path/to/netlify/functions/propose.js"`

Expected: upload happened is `true`, `attachmentIds` is `['attach-999']`, the new copy string is found in the email HTML, handler returns `statusCode: 200`.

- [ ] **Step 8: Live, safe upload-only check (no email sent)**

This confirms the real Zoho upload call itself works against the real org, without sending any email to anyone. Using the existing test ticket #3731 (internal id `157486000011122009`, already used earlier this session for the `cf_interventie_datm` live test):

```js
// scratch script, not committed
import fs from 'node:fs';
import path from 'node:path';

const ZOHO_ACCOUNTS = 'https://accounts.zoho.eu/oauth/v2/token';
const ZOHO_DESK = 'https://desk.zoho.eu/api/v1';
const params = new URLSearchParams({
  refresh_token: process.env.ZOHO_REFRESH_TOKEN,
  client_id: process.env.ZOHO_CLIENT_ID,
  client_secret: process.env.ZOHO_CLIENT_SECRET,
  grant_type: 'refresh_token',
});
const tokenRes = await fetch(ZOHO_ACCOUNTS, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
const accessToken = (await tokenRes.json()).access_token;
const orgRes = await fetch(`${ZOHO_DESK}/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${accessToken}` } });
const orgId = (await orgRes.json()).data?.[0]?.id;

const fileBuffer = fs.readFileSync(path.resolve('netlify/functions/assets/service-voorwaarden.pdf'));
const formData = new FormData();
formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), 'Service Voorwaarden Blitz Power.pdf');
const uploadRes = await fetch(`${ZOHO_DESK}/tickets/157486000011122009/attachments`, {
  method: 'POST',
  headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, orgId },
  body: formData,
});
console.log('status:', uploadRes.status);
console.log('body:', await uploadRes.text());
```

Expected: 200/201 status, response body contains an `id` field. This confirms the upload mechanism works for this exact PDF against the real org — no email is sent by this step.

- [ ] **Step 9: Commit**

```bash
git add netlify/functions/propose.js netlify.toml "netlify/functions/assets/service-voorwaarden.pdf" "Foutmeldingen en verbeteringen/SERVICE VOORWAARDEN BLITZ POWER BV.pdf"
git commit -m "feat: voeg service-voorwaarden PDF toe aan afspraakvoorstel-mail + sterkere bevestigingstekst"
```

---

### Task 2: Client — sync the proposal preview (`public/index.html`)

**Files:**
- Modify: `public/index.html`, inside `updateProposalPreview()` (currently around line 4324-4369).

**Interfaces:**
- Consumes: the exact copy string from Global Constraints (must match Task 1's `buildEmailHtml()` change word-for-word, since this preview's whole purpose is to show the coordinator what the customer will actually receive).
- Produces: nothing consumed elsewhere — this is a leaf, purely cosmetic/preview change.

- [ ] **Step 1: Locate the current preview text**

In `updateProposalPreview()`, find:
```js
      <p style="margin:0 0 10px;font-size:12px;color:#3a3a3a">Kan dit tijdstip u niet schikken? Beantwoord dan deze e-mail.</p>
```

- [ ] **Step 2: Replace it with the new copy plus an attachment indicator**

Replace:
```js
      <p style="margin:0 0 10px;font-size:12px;color:#3a3a3a">Kan dit tijdstip u niet schikken? Beantwoord dan deze e-mail.</p>
      <p style="margin:0;font-size:12px;color:#3a3a3a">Met vriendelijke groeten,<br><strong>Team Blitz Power — Service &amp; Support</strong></p>
    </div>
    <div style="background:#f7f7f7;border-top:1px solid #e8e8e8;padding:10px 18px;font-size:10px;color:#8a9aaa">
      Blitz Power BV &nbsp;·&nbsp; Tel: +32 3 36 16 404 &nbsp;·&nbsp;
      <span style="color:#00dfa3">www.blitzpower.com</span>
    </div>`;
```
with:
```js
      <p style="margin:0 0 10px;font-size:12px;color:#3a3a3a">Gelieve deze afspraak te bevestigen door op deze e-mail te antwoorden. Komt het voorgestelde tijdstip u niet uit? Laat het ons dan ook weten, zodat we samen een alternatief zoeken. In bijlage vindt u onze service voorwaarden — door de afspraak te bevestigen gaat u hiermee akkoord.</p>
      <p style="margin:0;font-size:12px;color:#3a3a3a">Met vriendelijke groeten,<br><strong>Team Blitz Power — Service &amp; Support</strong></p>
    </div>
    <div style="background:#f7f7f7;border-top:1px solid #e8e8e8;padding:10px 18px;font-size:10px;color:#8a9aaa">
      📎 Bijlage: Service Voorwaarden Blitz Power.pdf
    </div>
    <div style="background:#f7f7f7;border-top:1px solid #e8e8e8;padding:10px 18px;font-size:10px;color:#8a9aaa">
      Blitz Power BV &nbsp;·&nbsp; Tel: +32 3 36 16 404 &nbsp;·&nbsp;
      <span style="color:#00dfa3">www.blitzpower.com</span>
    </div>`;
```

- [ ] **Step 3: Verify in the browser with `?test` mode**

Start the dev server, open `?test`, open a pending ticket's detail modal, click "Afspraakvoorstel sturen" (or the equivalent proposal button), and confirm the preview panel shows:
- The new confirmation-request copy.
- The "📎 Bijlage: Service Voorwaarden Blitz Power.pdf" line.
- No leftover reference to the old "Kan dit tijdstip u niet schikken?" copy anywhere in the preview.

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: synchroniseer voorstel-preview met nieuwe mailtekst + bijlage-indicatie"
```

---

## Before this is done

Per the spec's open question: with the controller and Brent together, send one real test proposal e-mail (to a test ticket/address Brent controls, not a real customer) and confirm:
1. The e-mail arrives with the PDF attached and readable, named "Service Voorwaarden Blitz Power.pdf".
2. The new copy reads correctly and the confirmation ask is clear.

Only after that live confirmation should this branch be considered ready to merge/push, per the standing rule to always confirm before any push/deploy.
