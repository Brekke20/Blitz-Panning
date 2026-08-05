# Contactpersoon als derde ontvangercategorie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De klant-e-mailbug oplossen (contact-info-adres verdrong het echte klantveld) door contactpersoon een volwaardige, derde ontvangercategorie te maken naast klant en installateur, met deduplicatie bij een gedeeld adres.

**Architecture:** `propose.js` en `send-rapport.js` bepalen voortaan 3 potentiële ontvangers (contact/klant/installateur) i.p.v. 2, met een dedup-check die klant weglaat als die hetzelfde adres heeft als contact. De bestaande, generieke per-ontvanger-lussen in beide functies (sendReply, foutafhandeling) blijven ongewijzigd. De centrale statusopslag (`voorstel-status.js`/`rapport-verzonden.js`) en de frontend (doelgroep-lussen, badges, berichten) worden uitgebreid om een derde doelgroep-waarde te accepteren/tonen.

**Tech Stack:** Vanilla JS (geen build-stap), Netlify Functions (classic-stijl voor `propose.js`/`send-rapport.js`, v2-stijl voor `voorstel-status.js`/`rapport-verzonden.js`). Geen testframework — gestubte `global.fetch` voor de backend-taken, live browserverificatie voor de frontend-taken.

## Global Constraints

- **`propose.js` en `send-rapport.js` zijn LIVE productiecode zonder testmodus.** Elke test tegen deze functies gebruikt een gestubte `global.fetch` die nooit `desk.zoho.eu`/`accounts.zoho.eu` bereikt.
- Elke taak wijzigt UITSLUITEND de in deze taak aangeduide regels — geen andere aanpassingen aan dezelfde, al-in-productie functies.
- Doelgroep-waarden zijn voortaan `'contact'` | `'klant'` | `'installateur'` (uitgebreid van de vorige 2-waardige set) — consistent gebruikt in alle 5 taken.
- Veld-namen voor "verzonden"-status: `verzondenContact` | `verzondenKlant` | `verzondenInstallateur`.

---

## Task 1: `netlify/functions/propose.js` — contact/klant/installateur + dedup

**Files:**
- Modify: `netlify/functions/propose.js`

**Interfaces:**
- Produces: `ontvangers` array met mogelijk 3 entries `{doelgroep: 'contact'|'klant'|'installateur', email}` i.p.v. 2 — response-vorm (`emailSent`, `fouten`, `ontvangers`) blijft verder ongewijzigd, nu met mogelijk een `'contact'`-sleutel erbij.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek in `netlify/functions/propose.js` naar `const klantEmail` — bevestig dat de context nog overeenkomt met onderstaand citaat.

- [ ] **Step 2: Ontvangers-opbouw vervangen**

Zoek:
```js
    const klantEmail        = ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId || cf.cf_e_mail_eindklant || '';
    const installateurEmail = cf.cf_e_mail_installateur || '';
    const ontvangers = [
      klantEmail        ? { doelgroep: 'klant',        email: klantEmail }        : null,
      installateurEmail ? { doelgroep: 'installateur', email: installateurEmail } : null,
    ].filter(Boolean);
```
Vervang door:
```js
    const contactEmail      = ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId || '';
    const klantEmail        = cf.cf_e_mail_eindklant || '';
    const installateurEmail = cf.cf_e_mail_installateur || '';
    // Als klant hetzelfde adres heeft als de contactpersoon, telt dat als 1 ontvanger --
    // geen dubbele mail naar hetzelfde adres.
    const klantIsContact = klantEmail && contactEmail && klantEmail.toLowerCase() === contactEmail.toLowerCase();
    const ontvangers = [
      contactEmail                    ? { doelgroep: 'contact',      email: contactEmail }      : null,
      (klantEmail && !klantIsContact) ? { doelgroep: 'klant',        email: klantEmail }        : null,
      installateurEmail               ? { doelgroep: 'installateur', email: installateurEmail } : null,
    ].filter(Boolean);
```
**Geen andere regel in dit bestand verandert** — de per-ontvanger `sendReply`-lus, de foutafhandeling (`fouten`-array), en de PATCH-stap na de lus itereren al generiek over `ontvangers` en werken ongewijzigd met 3 entries i.p.v. 2.

- [ ] **Step 3: Verifieer ZONDER een echte e-mail te versturen**

Maak (niet committen) een tijdelijk testscript naast dit bestand, bv. `scratchpad-test-propose-contact.mjs`:
```js
// Tijdelijk test-scriptje -- NIET committen. Simuleert Zoho volledig via een neppe
// global.fetch, zodat propose.js getest kan worden zonder ooit desk.zoho.eu te bereiken.
process.env.ZOHO_REFRESH_TOKEN = 'fake';
process.env.ZOHO_CLIENT_ID = 'fake';
process.env.ZOHO_CLIENT_SECRET = 'fake';
process.env.ZOHO_FROM_EMAIL = 'test@blitzpower.com';

let ticketCf = {};
let ticketEmail = null;
let ticketContact = null;
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('accounts.zoho.eu')) return { ok: true, json: async () => ({ access_token: 'fake-token' }) };
  if (u.includes('/organizations')) return { ok: true, json: async () => ({ data: [{ id: 'org1' }] }) };
  if (u.match(/\/tickets\/\d+$/) && (!opts || !opts.method)) {
    return { ok: true, json: async () => ({ email: ticketEmail, contact: ticketContact, cf: ticketCf }) };
  }
  if (u.includes('/uploads')) return { ok: true, json: async () => ({ id: 'upload123' }) };
  if (u.includes('/sendReply')) {
    console.log('  -> sendReply naar:', JSON.parse(opts.body).to);
    return { ok: true, text: async () => '{}' };
  }
  if (u.match(/\/tickets\/\d+$/) && opts?.method === 'PATCH') return { ok: true, text: async () => '{}' };
  throw new Error('Onverwachte fetch-aanroep in test: ' + u);
};

const { handler } = await import('./netlify/functions/propose.js');

async function run(label, cf, email, contact) {
  ticketCf = cf; ticketEmail = email; ticketContact = contact;
  console.log(`\n--- ${label} ---`);
  const result = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ ticketId: '123456', date: '2026-08-01', time: '10:00', recipientName: 'Test', subject: 'Test' }),
  });
  const body = JSON.parse(result.body);
  console.log('ontvangers:', body.ontvangers);
}

// (a) contact + klant verschillend + installateur bekend -> 3 ontvangers
await run('contact != klant, installateur bekend',
  { cf_e_mail_eindklant: 'klant@test.be', cf_e_mail_installateur: 'installateur@test.be' },
  'contact@test.be', null);

// (b) contact === klant (hoofdletterongevoelig) -> dedup, 2 ontvangers (contact+installateur)
await run('contact === klant (dedup)',
  { cf_e_mail_eindklant: 'Contact@Test.be', cf_e_mail_installateur: 'installateur@test.be' },
  'contact@test.be', null);

// (c) enkel contact bekend -> 1 ontvanger
await run('enkel contact bekend',
  {}, 'contact@test.be', null);

global.fetch = realFetch;
```
Run: `node scratchpad-test-propose-contact.mjs`
Verwacht:
- Scenario (a): `ontvangers: [ 'contact', 'klant', 'installateur' ]`, 3 `sendReply`-regels (naar `contact@test.be`, `klant@test.be`, `installateur@test.be`).
- Scenario (b): `ontvangers: [ 'contact', 'installateur' ]` — **geen** `'klant'`-entry, en **slechts 2** `sendReply`-regels (naar `contact@test.be` en `installateur@test.be`, NIET naar `Contact@Test.be` apart).
- Scenario (c): `ontvangers: [ 'contact' ]`, 1 `sendReply`-regel.

Verwijder het scriptje na gebruik (`rm scratchpad-test-propose-contact.mjs`).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/propose.js
git commit -m "fix: klant-e-mailbug + contactpersoon als aparte ontvanger in propose.js"
```

---

## Task 2: `netlify/functions/send-rapport.js` — idem + naam-personalisatie

**Files:**
- Modify: `netlify/functions/send-rapport.js`

**Interfaces:**
- Produces: `ontvangers` array met mogelijk 3 entries `{doelgroep, email, naam}` — preview- en echte-verzendrespons blijven verder ongewijzigd.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek naar `const klantEmail` in `netlify/functions/send-rapport.js`.

- [ ] **Step 2: Ontvangers-opbouw vervangen**

Zoek:
```js
    const klantEmail        = ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId || cf.cf_e_mail_eindklant || '';
    const installateurEmail = cf.cf_e_mail_installateur || '';
    const klantNaam         = cf.cf_naam_eindklant       || '';
    const installateurNaam  = cf.cf_partner_installateur || '';
    const ontvangers = [
      klantEmail        ? { doelgroep: 'klant',        email: klantEmail,        naam: klantNaam }        : null,
      installateurEmail ? { doelgroep: 'installateur', email: installateurEmail, naam: installateurNaam } : null,
    ].filter(Boolean);
```
Vervang door:
```js
    const contactEmail      = ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId || '';
    const contactNaam       = ticketData.contact?.name || ticketData.contact?.fullName
                             || (ticketData.contact?.firstName ? `${ticketData.contact.firstName} ${ticketData.contact.lastName || ''}`.trim() : '')
                             || '';
    const klantEmail        = cf.cf_e_mail_eindklant || '';
    const klantNaam         = cf.cf_naam_eindklant       || '';
    const installateurEmail = cf.cf_e_mail_installateur || '';
    const installateurNaam  = cf.cf_partner_installateur || '';
    const klantIsContact = klantEmail && contactEmail && klantEmail.toLowerCase() === contactEmail.toLowerCase();
    const ontvangers = [
      contactEmail                    ? { doelgroep: 'contact',      email: contactEmail,      naam: contactNaam }      : null,
      (klantEmail && !klantIsContact) ? { doelgroep: 'klant',        email: klantEmail,        naam: klantNaam }        : null,
      installateurEmail               ? { doelgroep: 'installateur', email: installateurEmail, naam: installateurNaam } : null,
    ].filter(Boolean);
```
**Geen andere regel in dit bestand verandert** — de preview-modus, de per-ontvanger echte-verzendlus, en `buildRapportEmailHtml({ticketNumber, naam})` blijven ongewijzigd; ze gebruiken `naam` al generiek per ontvanger.

- [ ] **Step 3: Verifieer ZONDER een echte e-mail te versturen**

Zelfde aanpak als Task 1 — maak (niet committen) `scratchpad-test-send-rapport-contact.mjs`, hergebruik het stub-patroon uit Task 1's testscript maar importeer `./netlify/functions/send-rapport.js` i.p.v. `propose.js`, en roep de handler aan met `{ ticketId: '123456', html: '<html><body>test</body></html>', ticketNumber: '123456', preview: true }` (preview-modus, raakt geen chromium/uploads/sendReply, veiligst voor deze test). Voeg ook `cf_naam_eindklant`/`contact.name` toe aan de test-fixtures om te bevestigen dat elke ontvanger zijn eigen `naam` correct meekrijgt.

Test dezelfde 3 scenario's (a/b/c) als Task 1, en controleer voor scenario (a) specifiek dat `body.ontvangers` 3 entries heeft, elk met de juiste `naam` (contact krijgt de contactpersoon-naam, klant krijgt `cf_naam_eindklant`, installateur krijgt `cf_partner_installateur`), en voor scenario (b) dat er maar 2 entries zijn (dedup werkt ook in preview-modus, want preview-modus gebruikt dezelfde `ontvangers`-opbouw als de echte verzending).

Verwijder het scriptje na gebruik.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/send-rapport.js
git commit -m "fix: klant-e-mailbug + contactpersoon als aparte ontvanger in send-rapport.js"
```

---

## Task 3: `voorstel-status.js` + `rapport-verzonden.js` — doelgroep uitbreiden

**Files:**
- Modify: `netlify/functions/voorstel-status.js`
- Modify: `netlify/functions/rapport-verzonden.js`

**Interfaces:**
- Produces: beide endpoints accepteren voortaan `doelgroep: 'contact'|'klant'|'installateur'` i.p.v. enkel `'klant'|'installateur'`. `rapport-verzonden.js` schrijft `verzondenContact` als nieuw mogelijk veld.

- [ ] **Step 1: `voorstel-status.js` — whitelist uitbreiden**

Zoek:
```js
    if (!ticketId || !['klant', 'installateur'].includes(doelgroep) || !tijdstip) {
      return new Response(JSON.stringify({ error: 'ticketId, doelgroep (klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
    }
```
Vervang door:
```js
    if (!ticketId || !['contact', 'klant', 'installateur'].includes(doelgroep) || !tijdstip) {
      return new Response(JSON.stringify({ error: 'ticketId, doelgroep (contact|klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
    }
```

- [ ] **Step 2: `rapport-verzonden.js` — whitelist + veld-mapping uitbreiden**

Zoek:
```js
  if (!id || !['klant', 'installateur'].includes(doelgroep) || !tijdstip) {
    return new Response(JSON.stringify({ error: 'id, doelgroep (klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
  }
```
Vervang door:
```js
  if (!id || !['contact', 'klant', 'installateur'].includes(doelgroep) || !tijdstip) {
    return new Response(JSON.stringify({ error: 'id, doelgroep (contact|klant|installateur) en tijdstip zijn verplicht' }), { status: 400, headers });
  }
```
Zoek:
```js
  const veld = doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
```
Vervang door:
```js
  const veld = doelgroep === 'contact' ? 'verzondenContact' : doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
```

- [ ] **Step 3: Verifieer**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. In de browserconsole:
```js
fetch('/api/voorstel-status', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ticketId:'test-contact', doelgroep:'contact', tijdstip:new Date().toISOString()})}).then(r=>r.json()).then(console.log);
```
Verwacht: `{ok:true, versie:N}` (geen 400-fout meer op `doelgroep:'contact'`).
```js
fetch('/api/rapport-verzonden', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id:'niet-bestaand-id', doelgroep:'contact', tijdstip:new Date().toISOString()})}).then(r=>r.json()).then(console.log);
```
Verwacht: `{error:'Rapport niet gevonden'}` met status 404 (bevestigt dat de validatie voorbij `doelgroep`-check komt — een 400 zou betekenen dat de whitelist nog niet klopt).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/voorstel-status.js netlify/functions/rapport-verzonden.js
git commit -m "feat: doelgroep 'contact' toevoegen aan verzonden-status-endpoints"
```

---

## Task 4: Frontend — gedeelde helper + voorstel-flow

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `/api/propose`'s nieuwe `ontvangers`-vorm (Task 1), `/api/voorstel-status`'s uitgebreide whitelist (Task 3).
- Produces: nieuwe functie `joinNL(items)`, nieuwe constante `DOELGROEP_LABEL`. Task 5 hergebruikt beide.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function openProposal`, `async function sendProposal` in `public/index.html` — regelnummers kunnen licht verschoven zijn, zoek op functienaam.

- [ ] **Step 2: Gedeelde helper toevoegen**

Voeg toe, vlak vóór `function sendProposal`:
```js
function joinNL(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' en ' + items[items.length - 1];
}
const DOELGROEP_LABEL = { contact: 'contactpersoon', klant: 'klant', installateur: 'installateur' };
```

- [ ] **Step 3: `openProposal()` — preview-tekst toont contact en klant apart**

Zoek:
```js
  const ontvangers = [
    activeTicket.emailEindklant || activeTicket.email || null,
    activeTicket.emailInstallateur || null,
  ].filter(Boolean);
  _proposalOntvangers = ontvangers;
```
Vervang door:
```js
  const contactEmail = activeTicket.email || null;
  const klantIsContact = activeTicket.emailEindklant && contactEmail
    && activeTicket.emailEindklant.toLowerCase() === contactEmail.toLowerCase();
  const ontvangers = [
    contactEmail,
    (activeTicket.emailEindklant && !klantIsContact) ? activeTicket.emailEindklant : null,
    activeTicket.emailInstallateur || null,
  ].filter(Boolean);
  _proposalOntvangers = ontvangers;
```

- [ ] **Step 4: `sendProposal()` — doelgroep-lus + bericht uitbreiden**

Zoek:
```js
    for (const doelgroep of ['klant', 'installateur']) {
```
(binnen `sendProposal()`, niet de gelijknamige lus elders) Vervang door:
```js
    for (const doelgroep of ['contact', 'klant', 'installateur']) {
```
Zoek:
```js
    const gelukt = (data.ontvangers || []).filter(d => data.emailSent?.[d]);
    const msg = gelukt.length
      ? `✓ Voorstel verstuurd naar ${gelukt.join(' en ')}`
      : (data.ontvangers || []).length
        ? '✓ Ticket bijgewerkt — e-mail kon niet verstuurd worden via Zoho'
        : '✓ Status bijgewerkt (geen e-mailadres)';
```
Vervang door:
```js
    const gelukt = (data.ontvangers || []).filter(d => data.emailSent?.[d]);
    const msg = gelukt.length
      ? `✓ Voorstel verstuurd naar ${joinNL(gelukt.map(d => DOELGROEP_LABEL[d] || d))}`
      : (data.ontvangers || []).length
        ? '✓ Ticket bijgewerkt — e-mail kon niet verstuurd worden via Zoho'
        : '✓ Status bijgewerkt (geen e-mailadres)';
```

- [ ] **Step 5: Verifieer live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Open een ticket met zowel een contact-e-mail (`email`) als een apart, verschillend klant-e-mailadres (`emailEindklant`) — indien de testdata dit niet al zo heeft, pas tijdelijk in de console `activeTicket.emailEindklant = 'ander-adres@test.be'` aan vóór je op "📨 Voorstel" klikt (of open het ticket-detail opnieuw na de aanpassing). Klik "📨 Voorstel" → bevestig dat de preview-tekst NU BEIDE adressen toont (`Wordt verstuurd naar: contact@..., ander-adres@..., installateur@...`), niet enkel één ervan zoals voorheen. Klik "Verstuur voorstel" (TEST_MODE, geen echte aanroep) → bevestig geen consolefouten.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "fix: contactpersoon als aparte ontvanger in het afspraaksvoorstel"
```

---

## Task 5: Frontend — rapport-verzendflow + badges

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `/api/send-rapport`'s nieuwe `ontvangers`-vorm (Task 2), `/api/rapport-verzonden`'s uitgebreide whitelist (Task 3), `joinNL()`/`DOELGROEP_LABEL` (Task 4).

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `async function voorbeeldRapport`, `async function verstuurRapport`, `function renderRapportArchief` in `public/index.html`.

- [ ] **Step 2: `voorbeeldRapport()` — generiek label**

Zoek:
```js
      <div style="font-size:0.72rem;color:var(--muted);margin:10px 0 5px">
        Aan ${o.doelgroep === 'klant' ? 'klant' : 'installateur'} — ${escHtml(o.email)}
      </div>
```
Vervang door:
```js
      <div style="font-size:0.72rem;color:var(--muted);margin:10px 0 5px">
        Aan ${escHtml(DOELGROEP_LABEL[o.doelgroep] || o.doelgroep)} — ${escHtml(o.email)}
      </div>
```

- [ ] **Step 3: `verstuurRapport()` — doelgroep-lus + veld-mapping + berichten uitbreiden**

Zoek:
```js
    for (const doelgroep of ['klant', 'installateur']) {
```
(binnen `verstuurRapport()`) Vervang door:
```js
    for (const doelgroep of ['contact', 'klant', 'installateur']) {
```
Zoek:
```js
      const veld = doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
```
Vervang door:
```js
      const veld = doelgroep === 'contact' ? 'verzondenContact' : doelgroep === 'klant' ? 'verzondenKlant' : 'verzondenInstallateur';
```
Zoek:
```js
    renderRapportArchief();
    if (verzondenOntvangers.length > 0) {
      const msg = verzondenOntvangers.length === 2
        ? '✓ Rapport verstuurd naar klant en installateur'
        : verzondenOntvangers[0] === 'klant'
          ? '✓ Rapport verstuurd naar klant'
          : '✓ Rapport verstuurd naar installateur';
      toast(msg, 3500);
    } else if (emailedMaarNietOpgeslagen.length === 0) {
```
Vervang door:
```js
    renderRapportArchief();
    if (verzondenOntvangers.length > 0) {
      toast(`✓ Rapport verstuurd naar ${joinNL(verzondenOntvangers.map(d => DOELGROEP_LABEL[d] || d))}`, 3500);
    } else if (emailedMaarNietOpgeslagen.length === 0) {
```
Zoek:
```js
    if (emailedMaarNietOpgeslagen.length > 0) {
      toast(`✓ Rapport verstuurd naar ${emailedMaarNietOpgeslagen.join(' en ')}, maar status kon niet opgeslagen worden — NIET opnieuw versturen, herlaad eerst de pagina`, 8000);
    }
```
Vervang door:
```js
    if (emailedMaarNietOpgeslagen.length > 0) {
      toast(`✓ Rapport verstuurd naar ${joinNL(emailedMaarNietOpgeslagen.map(d => DOELGROEP_LABEL[d] || d))}, maar status kon niet opgeslagen worden — NIET opnieuw versturen, herlaad eerst de pagina`, 8000);
    }
```

- [ ] **Step 4: `renderRapportArchief()` — badge/knop houdt ook rekening met contact**

Zoek:
```js
${(rapportId && rd._html && r.ticketId) ? `<button class="cal-btn btn-verstuur-rapport" data-rapport-id="${escHtml(rapportId)}" title="${(r.verzondenKlant || r.verzondenInstallateur) ? 'Al verzonden op ' + escHtml(fmtDate(r.verzondenKlant || r.verzondenInstallateur)) + ' — opnieuw versturen?' : ''}">${(r.verzondenKlant || r.verzondenInstallateur) ? '✅ Verzonden' : '✉️ Verstuur rapport'}</button>` : ''}
```
Vervang door:
```js
${(rapportId && rd._html && r.ticketId) ? `<button class="cal-btn btn-verstuur-rapport" data-rapport-id="${escHtml(rapportId)}" title="${(r.verzondenContact || r.verzondenKlant || r.verzondenInstallateur) ? 'Al verzonden op ' + escHtml(fmtDate(r.verzondenContact || r.verzondenKlant || r.verzondenInstallateur)) + ' — opnieuw versturen?' : ''}">${(r.verzondenContact || r.verzondenKlant || r.verzondenInstallateur) ? '✅ Verzonden' : '✉️ Verstuur rapport'}</button>` : ''}
```

- [ ] **Step 5: Route-lijst "voorstel verzonden"-badge — ook contact meetellen**

Zoek:
```js
${(voorstelStatus[item.ticket.id]?.klant || voorstelStatus[item.ticket.id]?.installateur) ? '<div class="stop-proposal-sent">✉️ Voorstel verstuurd</div>' : ''}
```
Vervang door:
```js
${(voorstelStatus[item.ticket.id]?.contact || voorstelStatus[item.ticket.id]?.klant || voorstelStatus[item.ticket.id]?.installateur) ? '<div class="stop-proposal-sent">✉️ Voorstel verstuurd</div>' : ''}
```

- [ ] **Step 6: Verifieer live in de browser (fetch-stub, geen echte e-mail)**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`, ga naar het Rapporten-tabblad. Stub `window.fetch` tijdelijk in de console zodat `/api/send-rapport` (preview en echt) en `/api/rapport-verzonden` neprespons geven met 3 ontvangers:
```js
const realFetch = window.fetch;
window.fetch = (url, opts) => {
  const u = String(url);
  if (u.startsWith('/api/send-rapport')) {
    const body = JSON.parse(opts.body);
    if (body.preview) {
      return Promise.resolve({ json: async () => ({ preview: true, ontvangers: [
        { doelgroep: 'contact', naam: 'Jan (contact)', email: 'contact@test.be', html: '<html><body>Test contact</body></html>' },
        { doelgroep: 'klant', naam: 'Jan Peeters', email: 'klant@test.be', html: '<html><body>Test klant</body></html>' },
        { doelgroep: 'installateur', naam: 'Installatiebedrijf BV', email: 'installateur@test.be', html: '<html><body>Test installateur</body></html>' },
      ] }) });
    }
    return Promise.resolve({ json: async () => ({ success: true, emailSent: { contact: true, klant: true, installateur: true } }) });
  }
  if (u.startsWith('/api/rapport-verzonden')) return Promise.resolve({ json: async () => ({ ok: true, versie: 1 }) });
  return realFetch(url, opts);
};
```
Klik "✉️ Verstuur rapport" op een bestaand rapport (buiten `?test`, of test de preview-stap zelf ongeacht TEST_MODE door `voorbeeldRapport()` rechtstreeks aan te roepen in de console met een reëel `rapportId`) → bevestig dat het voorbeeldvenster nu **3 rijen** toont: "Aan contactpersoon — contact@test.be", "Aan klant — klant@test.be", "Aan installateur — installateur@test.be". Bevestig na een simulatie van de echte verzending dat de toast "✓ Rapport verstuurd naar contactpersoon, klant en installateur" toont (correcte Nederlandse opsomming, niet "contact en klant en installateur"). Herstel `window.fetch` erna.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "fix: contactpersoon als aparte ontvanger bij rapport-verzending + badges"
```

---

## Eindcontrole (na alle taken)

- [ ] Bevestig dat geen enkele taak ooit een echte Zoho-aanroep (`sendReply`, `/uploads`) heeft gedaan tijdens deze implementatieronde.
- [ ] Doorloop nog eens het volledige voorstel- en rapport-verzendtraject in de browser (met fetch-stubs) voor een ticket waar contact- en klantadres IDENTIEK zijn — bevestig dat er dan geen dubbele "klant"-rij/badge verschijnt en de toast-tekst niet "contactpersoon en contactpersoon" o.i.d. toont.
- [ ] Live verificatie door de sessie-orchestrator vóór er iets teruggekoppeld wordt aan Brent, conform de bestaande sessieafspraak. Vraag Brent om, zodra dit online staat, één keer een echte test te doen met een ticket waarvan hij zelf weet dat contact- en klantadres verschillen, om te bevestigen dat beide de mail effectief ontvangen.
