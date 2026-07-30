# Voorbeeldvenster bij rapport-verzending — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vóór een service rapport effectief verstuurd wordt naar klant/installateur, eerst een voorbeeldvenster tonen met de echte e-mailinhoud (met naam waar gekend), gebouwd door dezelfde functie die ook echt verstuurt.

**Architecture:** `netlify/functions/send-rapport.js` krijgt een optionele preview-modus die dezelfde ticket-opzoeking/e-mailopbouw doet als een echte verzending, maar zonder PDF te genereren of Zoho's verzend-endpoints aan te roepen. De frontend roept deze modus aan bij een klik op "Verstuur rapport", toont het resultaat in een nieuw venster (gestileerd zoals de bestaande voorstel-modal), en roept pas bij bevestiging de bestaande, ongewijzigde echte-verzendfunctie aan.

**Tech Stack:** Vanilla JS (geen build-stap), Netlify Functions (classic-stijl), Zoho Desk API (enkel een ticket-GET in preview-modus — geen sendReply/uploads). Geen testframework — verificatie via `node dev-server.mjs` (poort 3333), gestubte `global.fetch` voor alles wat Zoho raakt, en live browserverificatie.

## Global Constraints

- `netlify/functions/send-rapport.js` is LIVE productiecode. Preview-modus (`preview: true` in de request-body) mag NOOIT Zoho's `/uploads`- of `/tickets/{id}/sendReply`-endpoints aanroepen, en genereert geen PDF (geen puppeteer/chromium) — enkel een ticket-`GET` (leesactie) en het opbouwen/teruggeven van e-mail-HTML per ontvanger.
- Elke test tegen deze functie (preview én de bestaande echte-verzendlogica) gebruikt een gestubte `global.fetch` die nooit echt `desk.zoho.eu`/`accounts.zoho.eu` bereikt — nooit een live aanroep tegen een echt ticket.
- `verstuurRapport()` in `public/index.html` blijft functioneel ongewijzigd, op het verwijderen van de `confirm()`-regel na — geen andere aanpassingen aan die functie.
- Namen die uit Zoho-tickets komen (`cf_naam_eindklant`, `cf_partner_installateur`) worden ge-escaped (`escHtml()`) vóór ze in e-mail-HTML terechtkomen.

---

## Task 1: `send-rapport.js` — naam per ontvanger + preview-modus

**Files:**
- Modify: `netlify/functions/send-rapport.js`

**Interfaces:**
- Produces: `POST /api/send-rapport` met `{ticketId, html, ticketNumber, preview: true}` in de body → `{preview: true, ontvangers: [{doelgroep: 'klant'|'installateur', naam: string, email: string, html: string}, ...]}` (enkel entries met een gekend adres); `{preview: true}` weglaten of `false` meegeven → ongewijzigd bestaand gedrag (`{success, emailSent, fouten}`, echte verzending). Task 2 consumeert de preview-responsvorm.

- [ ] **Step 1: Lees het huidige bestand ter controle**

Bevestig dat `netlify/functions/send-rapport.js` nog overeenkomt met de staat na de laatste wijziging (zoek op `function buildRapportEmailHtml`, `const ontvangers = [`, en `for (const { doelgroep, email } of ontvangers)`).

- [ ] **Step 2: Namen ophalen naast de adressen**

Zoek:
```js
    const cf = ticketData.cf || {};
    const klantEmail        = ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId || cf.cf_e_mail_eindklant || '';
    const installateurEmail = cf.cf_e_mail_installateur || '';
    const ontvangers = [
      klantEmail        ? { doelgroep: 'klant',        email: klantEmail }        : null,
      installateurEmail ? { doelgroep: 'installateur', email: installateurEmail } : null,
    ].filter(Boolean);
    if (!ontvangers.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Geen gekend e-mailadres (klant of installateur) op dit ticket' }) };
```
Vervang door:
```js
    const cf = ticketData.cf || {};
    const klantEmail        = ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId || cf.cf_e_mail_eindklant || '';
    const installateurEmail = cf.cf_e_mail_installateur || '';
    const klantNaam         = cf.cf_naam_eindklant       || '';
    const installateurNaam  = cf.cf_partner_installateur || '';
    const ontvangers = [
      klantEmail        ? { doelgroep: 'klant',        email: klantEmail,        naam: klantNaam }        : null,
      installateurEmail ? { doelgroep: 'installateur', email: installateurEmail, naam: installateurNaam } : null,
    ].filter(Boolean);
    if (!ontvangers.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Geen gekend e-mailadres (klant of installateur) op dit ticket' }) };
```

- [ ] **Step 3: `escHtml()` toevoegen**

Voeg toe, vlak vóór `function buildRapportEmailHtml`:
```js
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

- [ ] **Step 4: `buildRapportEmailHtml` krijgt een `naam`-parameter**

Zoek:
```js
function buildRapportEmailHtml({ ticketNumber }) {
  const bolt = `<svg width="20" height="30" viewBox="0 0 20 30" xmlns="http://www.w3.org/2000/svg"><line x1="15" y1="2" x2="3" y2="16" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/><line x1="17" y1="14" x2="5" y2="28" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/></svg>`;
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:32px 0"><tr><td>
  <table width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10)">
    <tr><td style="background:#181e24;padding:26px 32px">${bolt}<span style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:4px;color:#00dfa3;margin-left:12px">BLITZ</span></td></tr>
    <tr><td style="background:#00dfa3;height:3px;font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:32px 36px">
      <p style="margin:0 0 16px;font-size:15px;color:#181e24">Beste,</p>
      <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.65">In bijlage vindt u het service rapport${ticketNumber ? ` voor ticket #${ticketNumber}` : ''}.</p>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65">Met vriendelijke groeten,<br><strong style="color:#181e24">Team Blitz Power &mdash; Service &amp; Support</strong></p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}
```
Vervang volledig door:
```js
function buildRapportEmailHtml({ ticketNumber, naam }) {
  const bolt = `<svg width="20" height="30" viewBox="0 0 20 30" xmlns="http://www.w3.org/2000/svg"><line x1="15" y1="2" x2="3" y2="16" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/><line x1="17" y1="14" x2="5" y2="28" stroke="#00dfa3" stroke-width="4" stroke-linecap="round"/></svg>`;
  const greeting = naam ? `Geachte ${escHtml(naam)}` : 'Beste';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:32px 0"><tr><td>
  <table width="600" align="center" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.10)">
    <tr><td style="background:#181e24;padding:26px 32px">${bolt}<span style="font-family:'Arial Black',Arial,sans-serif;font-size:24px;font-weight:900;letter-spacing:4px;color:#00dfa3;margin-left:12px">BLITZ</span></td></tr>
    <tr><td style="background:#00dfa3;height:3px;font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:32px 36px">
      <p style="margin:0 0 16px;font-size:15px;color:#181e24">${greeting},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#3a3a3a;line-height:1.65">In bijlage vindt u het service rapport${ticketNumber ? ` voor ticket #${ticketNumber}` : ''}.</p>
      <p style="margin:0;font-size:14px;color:#3a3a3a;line-height:1.65">Met vriendelijke groeten,<br><strong style="color:#181e24">Team Blitz Power &mdash; Service &amp; Support</strong></p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}
```

- [ ] **Step 5: Destructuring van de request-body uitbreiden met `preview`**

Zoek (in `handler()`):
```js
    const { ticketId, html, ticketNumber } = JSON.parse(event.body || '{}');
```
Vervang door:
```js
    const { ticketId, html, ticketNumber, preview } = JSON.parse(event.body || '{}');
```

- [ ] **Step 6: Preview-modus invoegen**

Direct ná het blok uit Step 2 (de `if (!ontvangers.length) return ...` regel), vóór de puppeteer/chromium-launch (`const executablePath = await chromium.executablePath(...)`), invoegen:
```js
    // Voorbeeldmodus: dezelfde ticket-opzoeking en e-mail-opbouw als een echte verzending,
    // maar zonder PDF te genereren of Zoho's upload/sendReply-endpoints aan te roepen -- dit
    // garandeert dat het voorbeeld dat de gebruiker ziet exact is wat er bij een echte
    // verzending verstuurd wordt (zelfde functie, zelfde data), niet een aparte kopie die
    // uit sync kan lopen.
    if (preview) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          preview: true,
          ontvangers: ontvangers.map(o => ({
            doelgroep: o.doelgroep,
            naam:      o.naam,
            email:     o.email,
            html:      buildRapportEmailHtml({ ticketNumber, naam: o.naam }),
          })),
        }),
      };
    }
```

- [ ] **Step 7: De echte-verzendlus geeft de naam mee aan `buildRapportEmailHtml`**

Zoek:
```js
    for (const { doelgroep, email } of ontvangers) {
      try {
        const formData = new FormData();
```
Vervang door:
```js
    for (const { doelgroep, email, naam } of ontvangers) {
      try {
        const formData = new FormData();
```
Zoek verderop in dezelfde lus:
```js
        const replyRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/sendReply`, {
          method: 'POST',
          headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'EMAIL', contentType: 'html', content: buildRapportEmailHtml({ ticketNumber }),
            fromEmailAddress, to: email, attachmentIds: [uploadData.id],
          }),
        });
```
Vervang door:
```js
        const replyRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/sendReply`, {
          method: 'POST',
          headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'EMAIL', contentType: 'html', content: buildRapportEmailHtml({ ticketNumber, naam }),
            fromEmailAddress, to: email, attachmentIds: [uploadData.id],
          }),
        });
```

- [ ] **Step 8: Module-docblok bijwerken**

Zoek (bovenaan het bestand):
```js
// /api/send-rapport
// Genereert een PDF van een al-gearchiveerd service rapport (uit de opgeslagen HTML) en
// verstuurt die naar klant en/of installateur (wie een e-mailadres heeft), via Zoho Desk
// sendReply -- zelfde aanpak als propose.js. Manuele, bewuste actie vanuit het
// Rapporten-tabblad, nooit automatisch.
// POST body: { ticketId, html, ticketNumber }
```
Vervang door:
```js
// /api/send-rapport
// Genereert een PDF van een al-gearchiveerd service rapport (uit de opgeslagen HTML) en
// verstuurt die naar klant en/of installateur (wie een e-mailadres heeft), via Zoho Desk
// sendReply -- zelfde aanpak als propose.js. Manuele, bewuste actie vanuit het
// Rapporten-tabblad, nooit automatisch.
// POST body: { ticketId, html, ticketNumber, preview? }
// preview: true -> bouwt de e-mail-inhoud per ontvanger op en geeft die terug zonder iets
// te versturen (voor het voorbeeldvenster in de app); anders (of ontbrekend): echte verzending.
```

- [ ] **Step 9: Verifieer ZONDER een echte e-mail te versturen of echt Zoho te raken**

Maak (niet committen) een tijdelijk testscript naast dit bestand, bv. `scratchpad-test-preview.mjs`:
```js
// Tijdelijk test-scriptje -- NIET committen. Simuleert Zoho volledig via een neppe
// global.fetch, zodat send-rapport.js getest kan worden zonder ooit desk.zoho.eu te bereiken.
process.env.ZOHO_REFRESH_TOKEN = 'fake';
process.env.ZOHO_CLIENT_ID = 'fake';
process.env.ZOHO_CLIENT_SECRET = 'fake';
process.env.ZOHO_FROM_EMAIL = 'test@blitzpower.com';

const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('accounts.zoho.eu')) {
    return { ok: true, json: async () => ({ access_token: 'fake-token' }) };
  }
  if (u.includes('/organizations')) {
    return { ok: true, json: async () => ({ data: [{ id: 'org1' }] }) };
  }
  if (u.match(/\/tickets\/\d+$/)) {
    return { ok: true, json: async () => ({
      email: null, contact: null,
      cf: {
        cf_e_mail_eindklant: 'klant@test.be', cf_naam_eindklant: 'Jan Peeters',
        cf_e_mail_installateur: 'installateur@test.be', cf_partner_installateur: 'Installatiebedrijf BV',
      },
    }) };
  }
  throw new Error('Onverwachte fetch-aanroep in preview-test (mag Zoho sendReply/uploads niet raken): ' + u);
};

const { handler } = await import('./netlify/functions/send-rapport.js');

// Test 1: preview-modus met beide adressen gekend
const previewResult = await handler({
  httpMethod: 'POST',
  body: JSON.stringify({ ticketId: '123456', html: '<html><body>test</body></html>', ticketNumber: '123456', preview: true }),
});
console.log('Preview status:', previewResult.statusCode);
const previewData = JSON.parse(previewResult.body);
console.log('Preview ontvangers:', previewData.ontvangers.map(o => ({ doelgroep: o.doelgroep, naam: o.naam, email: o.email })));
console.log('Klant-html bevat "Geachte Jan Peeters":', previewData.ontvangers[0].html.includes('Geachte Jan Peeters'));
console.log('Installateur-html bevat "Geachte Installatiebedrijf BV":', previewData.ontvangers[1].html.includes('Geachte Installatiebedrijf BV'));

global.fetch = realFetch;
```
Run: `node scratchpad-test-preview.mjs`
Verwacht:
- `Preview status: 200`
- `Preview ontvangers:` toont beide doelgroepen met hun naam en e-mailadres, GEEN enkele regel `sendReply`/`uploads` wordt aangeroepen (de neppe `fetch` gooit een fout als dat wel gebeurt, dus als het script zonder fout eindigt is dit bevestigd).
- Beide "bevat"-regels tonen `true`.

Test ook het geval waarbij de neppe ticket-respons geen `cf_naam_eindklant`/`cf_partner_installateur` bevat (leeg) — verwacht dan dat de betreffende `html`-waarde `'Beste,'` bevat i.p.v. `'Geachte ...,'`.

Verwijder het scriptje na gebruik (`rm scratchpad-test-preview.mjs`) — het hoort niet in de commit.

- [ ] **Step 10: Commit**

```bash
git add netlify/functions/send-rapport.js
git commit -m "feat: voorbeeldmodus + naam-per-ontvanger in send-rapport.js"
```

---

## Task 2: Frontend — voorbeeldvenster vóór het versturen

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `POST /api/send-rapport` met `{preview: true}` (Task 1) → `{preview: true, ontvangers: [{doelgroep, naam, email, html}, ...]}` of `{error: string}`.
- Produces: nieuwe functie `voorbeeldRapport(rapportId, btn)`, nieuwe functie `closeRapportPreview(e)`. De bestaande `verstuurRapport(rapportId, btn)` blijft ongewijzigd op het verwijderen van de `confirm()`-regel na.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek in `public/index.html` op `btn-verstuur-rapport`, `async function verstuurRapport`, en `id="proposal-overlay"` (voor het te herbruiken modal-patroon) om te bevestigen dat de structuur nog overeenkomt met wat hieronder staat. Regelnummers kunnen licht verschoven zijn t.o.v. wat hier genoteerd staat — zoek op functienaam/patroon, niet blindelings op regelnummer.

- [ ] **Step 2: Nieuwe modal-HTML toevoegen**

Zoek de sluitende `</div>` van de bestaande `#proposal-overlay`-modal (rond regel 1597-1627, herken aan `<div class="overlay" id="proposal-overlay" onclick="closeProposal(event)">` als openings-tag). Voeg er, direct NA die volledige modal (na haar sluitende `</div>`), dit nieuwe blok aan toe:
```html
<div class="overlay" id="rapport-preview-overlay" onclick="closeRapportPreview(event)">
  <div class="modal" id="rapport-preview-modal" style="max-width:560px">
    <div class="mhdr">
      <div class="mhdr-title">📤 Rapport versturen</div>
      <div id="rapport-preview-ticket-label" style="font-size:0.78rem;color:var(--muted);margin-top:3px"></div>
    </div>
    <div class="mbody" id="rapport-preview-body">
      <!-- gevuld door voorbeeldRapport() -->
    </div>
    <div class="mftr">
      <button class="btn-cancel" onclick="closeRapportPreview()">Annuleren</button>
      <button class="btn-save" id="rapport-preview-send-btn">✅ Bevestig en verstuur</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Knop-koppeling aanpassen**

Zoek (in `renderRapportArchief()`):
```js
  body.querySelectorAll('.btn-verstuur-rapport').forEach(btn => {
    btn.addEventListener('click', () => verstuurRapport(btn.dataset.rapportId || ''));
  });
```
Vervang door:
```js
  body.querySelectorAll('.btn-verstuur-rapport').forEach(btn => {
    btn.addEventListener('click', () => voorbeeldRapport(btn.dataset.rapportId || '', btn));
  });
```
(De knop-HTML zelf, met `data-rapport-id` en de al-verzonden-styling, blijft ongewijzigd — enkel deze ene `addEventListener`-regel verandert.)

- [ ] **Step 4: `confirm()`-regel verwijderen uit `verstuurRapport()`**

Zoek, aan het begin van `async function verstuurRapport(rapportId, btn)`, direct ná de TEST_MODE-branch (de `if (TEST_MODE) { ... return toast(...); }`-blok):
```js
  if (!confirm(`Rapport versturen naar alle gekende adressen voor ticket ${r.ticketNumber || r.ticketId}?\n\nDit verstuurt een echte e-mail (en kan niet ongedaan gemaakt worden).`)) return;
  if (btn) btn.disabled = true;
```
Vervang door:
```js
  if (btn) btn.disabled = true;
```
**Geen enkele andere regel in `verstuurRapport()` verandert** — de rest van de functie (de echte `/api/send-rapport`-aanroep, de `/api/rapport-verzonden`-lus, de toasts) blijft exact zoals hij is.

- [ ] **Step 5: Nieuwe functies `voorbeeldRapport()` en `closeRapportPreview()` toevoegen**

Voeg toe, direct vóór `async function verstuurRapport`:
```js
async function voorbeeldRapport(rapportId, btn) {
  const r = _rapportArchief.find(x => x.id === rapportId);
  if (!r) return toast('⚠️ Rapport niet gevonden');
  if (!r.ticketId) return toast('⚠️ Geen ticket gekoppeld aan dit rapport');
  const html = r.rapportData?._html;
  if (!html) return toast('⚠️ Geen opgeslagen rapport-inhoud om te versturen');

  if (TEST_MODE) return verstuurRapport(rapportId, btn);

  toast('🔎 Voorbeeld ophalen...', 4000);
  try {
    const res  = await fetch('/api/send-rapport', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketId: r.ticketId, html, ticketNumber: r.ticketNumber, preview: true }),
    });
    const data = await res.json();
    if (data.error) return toast('⚠️ ' + data.error, 4500);
    if (!data.ontvangers?.length) return toast('⚠️ Geen gekend e-mailadres (klant of installateur) op dit ticket', 4500);

    document.getElementById('rapport-preview-ticket-label').textContent =
      `Ticket #${r.ticketNumber || r.ticketId}`;
    document.getElementById('rapport-preview-body').innerHTML = data.ontvangers.map(o => `
      <div style="font-size:0.72rem;color:var(--muted);margin:10px 0 5px">
        Aan ${o.doelgroep === 'klant' ? 'klant' : 'installateur'} — ${escHtml(o.email)}
      </div>
      <iframe srcdoc="${escHtml(o.html)}" sandbox=""
        style="width:100%;height:260px;border:1px solid var(--border);border-radius:6px"></iframe>
    `).join('');

    const sendBtn = document.getElementById('rapport-preview-send-btn');
    sendBtn.onclick = () => {
      document.getElementById('rapport-preview-overlay').classList.remove('open');
      verstuurRapport(rapportId, btn);
    };
    document.getElementById('rapport-preview-overlay').classList.add('open');
  } catch (err) {
    toast('❌ Voorbeeld ophalen mislukt: ' + err.message, 5000);
  }
}

function closeRapportPreview(e) {
  if (e && e.target !== document.getElementById('rapport-preview-overlay')) return;
  document.getElementById('rapport-preview-overlay').classList.remove('open');
}
```

- [ ] **Step 6: Verifieer in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`.

**In test-modus (geen echte aanroep, `?test` slaat de preview over):** ga naar het Rapporten-tabblad, klik "✉️ Verstuur rapport" op een aanwezig rapport (of injecteer er eerst één via de browserconsole, zelfde methode als eerder in dit project: zet `_rapportArchief`/`_archiefVersie` en roep `renderRapportArchief()` aan). Verwacht: het bestaande TEST_MODE-demo-gedrag (toast "🧪 Testmodus — rapport verstuurd (demo)", knop wordt "✅ Verzonden") — **geen** voorbeeldvenster verschijnt, exact zoals voorheen.

**Om het echte (niet-test) preview-pad te controleren zonder een echte Zoho-aanroep te doen:** stub `window.fetch` tijdelijk in de browserconsole zodat `/api/send-rapport` een nep-preview-respons teruggeeft:
```js
const realFetch = window.fetch;
window.fetch = (url, opts) => {
  if (String(url).startsWith('/api/send-rapport')) {
    const body = JSON.parse(opts.body);
    if (body.preview) {
      return Promise.resolve({ json: async () => ({
        preview: true,
        ontvangers: [
          { doelgroep: 'klant', naam: 'Jan Peeters', email: 'klant@test.be', html: '<html><body>Geachte Jan Peeters, test-mail klant</body></html>' },
          { doelgroep: 'installateur', naam: 'Installatiebedrijf BV', email: 'installateur@test.be', html: '<html><body>Geachte Installatiebedrijf BV, test-mail installateur</body></html>' },
        ],
      }) });
    }
  }
  return realFetch(url, opts);
};
```
(Om dit pad te bereiken buiten `?test` moet `TEST_MODE` tijdelijk op `false` gezet worden in de console, bv. `window.TEST_MODE = false;` als dat een globale variabele is — controleer de exacte variabele-declaratie in het bestand; indien `TEST_MODE` een `const` is die niet herschreven kan worden, open de pagina dan zonder `?test` in de query-string in plaats daarvan, wat hetzelfde effect heeft.)

Klik op "✉️ Verstuur rapport" → verwacht: toast "🔎 Voorbeeld ophalen...", daarna het nieuwe venster met de titel "📤 Rapport versturen", ticketlabel, en twee rijen (klant, dan installateur) met telkens het adres en een ingebed voorbeeld dat de neptekst toont. Klik "Annuleren" → venster sluit, niets verstuurd (bevestig via `read_console_messages`/`read_network_requests` dat er geen aanroep naar `/api/send-rapport` zonder `preview:true` gebeurd is). Herstel `window.fetch` erna.

- [ ] **Step 7: Defensieve controle**

```bash
grep -n "confirm(\`Rapport versturen" public/index.html
```
Verwacht: **geen output** (0 matches) — de oude `confirm()`-regel is volledig weg.

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "feat: voorbeeldvenster vóór rapport-verzending"
```

---

## Eindcontrole (na beide taken)

- [ ] Bevestig dat `verstuurRapport()` zelf, buiten de verwijderde `confirm()`-regel, geen enkele andere wijziging bevat (`git diff` op die functie mag enkel die ene regel tonen).
- [ ] Bevestig nogmaals expliciet dat geen enkele taak ooit een echte Zoho-aanroep (`sendReply`, `/uploads`) heeft gedaan tijdens deze implementatieronde.
- [ ] Live verificatie door de sessie-orchestrator in een echte browser vóór er iets teruggekoppeld wordt aan Brent, conform de bestaande sessieafspraak.
