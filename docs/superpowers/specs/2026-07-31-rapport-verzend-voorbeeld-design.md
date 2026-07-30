# Voorbeeld tonen vóór het versturen van een service rapport

**Datum:** 2026-07-31
**Status:** Approved, ready for implementation

## Aanleiding

Bij het bestaande afspraaksvoorstel toont de app al een live voorbeeld van de e-mail (`updateProposalPreview()` in `public/index.html`, gerenderd in `#proposal-preview` binnen de voorstel-modal) vóórdat er iets verstuurd wordt. Sinds gisteren (2026-07-30) bestaat er ook een "Verstuur rapport"-knop op het Rapporten-tabblad (`verstuurRapport()`), maar die heeft geen voorbeeldstap — enkel een korte ja/nee-vraag (`confirm()`) en dan meteen de echte verzending.

Brent wil, analoog aan het voorstel, ook bij het rapport-versturen eerst kunnen zien wat er precies naar klant en installateur gestuurd gaat worden, vóór het effectief gebeurt.

## Beslissingen (uit het brainstormgesprek)

1. **Venster-aanpak, net als bij het voorstel.** Klik op "Verstuur rapport" opent een voorbeeldvenster met de e-mail-inhoud en de ontvangers; de échte verstuurknop zit in dat venster (vervangt de huidige `confirm()`-vraag volledig).
2. **Aanspreken met naam waar gekend.** Klant en installateur krijgen elk hun eigen versie van de mail, met hun eigen naam in de aanhef (net als het voorstel: "Geachte {naam}," i.p.v. het huidige generieke "Beste,"). Blijft de naam onbekend, dan valt de tekst terug op "Beste,".
3. **Enkel de begeleidende e-mailtekst in het voorbeeld**, niet het PDF-rapport zelf — dat kan al apart bekeken worden via de bestaande "📄 Openen"-knop.
4. **Beide versies na elkaar tonen** in één scherm (eerst klant, dan installateur), niet een wisselknop of één gedeeld voorbeeld.
5. **Het voorbeeld moet gegarandeerd exact overeenkomen** met wat er echt verstuurd wordt: de server bouwt de echte e-mail-inhoud op (met de echte namen en adressen uit het ticket) en geeft die terug voor het voorbeeld, zonder iets te versturen. Pas na bevestiging in het venster gebeurt de effectieve verzending, met exact diezelfde inhoud.

## Architectuur

`netlify/functions/send-rapport.js` krijgt een extra, optionele **preview-modus**: dezelfde ticket-opzoeking en naam/adres-bepaling als vandaag, maar in plaats van een PDF te genereren en echt te versturen, bouwt en retourneert de functie de kant-en-klare e-mail-HTML per ontvanger. De frontend roept deze modus aan zodra op "Verstuur rapport" geklikt wordt, toont het resultaat in een nieuw voorbeeldvenster (gestileerd zoals de bestaande voorstel-modal), en roept pas bij bevestiging de bestaande (al gebouwde en gecontroleerde) echte-verzendlogica aan — die blijft ongewijzigd.

## Wijzigingen

### 1. `netlify/functions/send-rapport.js` — naam per ontvanger + preview-modus

**a) Namen ophalen naast de adressen.** Huidige code (rond regel 80-87):
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
wordt:
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

**b) `escHtml()` toevoegen** (dit bestand heeft er nog geen — `propose.js` heeft dezelfde functie al, letterlijk overnemen), vlak vóór `buildRapportEmailHtml`:
```js
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

**c) `buildRapportEmailHtml` krijgt een `naam`-parameter.** Huidig:
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
wordt:
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

**d) Preview-modus in `handler()`.** Huidige destructuring (rond regel 70):
```js
const { ticketId, html, ticketNumber } = JSON.parse(event.body || '{}');
```
wordt:
```js
const { ticketId, html, ticketNumber, preview } = JSON.parse(event.body || '{}');
```
Direct na de `ontvangers`/lege-adressen-check (na punt a hierboven, vóór de puppeteer/chromium-launch), invoegen:
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

**e) De echte-verzendlus geeft nu de naam mee.** Huidig (in de `for (const { doelgroep, email } of ontvangers)`-lus):
```js
    for (const { doelgroep, email } of ontvangers) {
      try {
        ...
        const replyRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/sendReply`, {
          method: 'POST',
          headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'EMAIL', contentType: 'html', content: buildRapportEmailHtml({ ticketNumber }),
            fromEmailAddress, to: email, attachmentIds: [uploadData.id],
          }),
        });
```
wordt:
```js
    for (const { doelgroep, email, naam } of ontvangers) {
      try {
        ...
        const replyRes = await fetch(`${ZOHO_DESK}/tickets/${ticketId}/sendReply`, {
          method: 'POST',
          headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'EMAIL', contentType: 'html', content: buildRapportEmailHtml({ ticketNumber, naam }),
            fromEmailAddress, to: email, attachmentIds: [uploadData.id],
          }),
        });
```
(enkel de destructuring van de lus-kop en de `buildRapportEmailHtml`-aanroep veranderen — de rest van de lus blijft ongewijzigd.)

**f) Module-docblok bijwerken** (regel 6, `// POST body: { ticketId, html, ticketNumber }`) naar:
```js
// POST body: { ticketId, html, ticketNumber, preview? }
// preview: true -> bouwt de e-mail-inhoud per ontvanger op en geeft die terug zonder iets
// te versturen (voor het voorbeeldvenster in de app); anders (of ontbrekend): echte verzending.
```

### 2. `public/index.html` — voorbeeldvenster vóór het versturen

**a) Nieuwe modal-HTML**, toegevoegd direct na de bestaande `#proposal-overlay`-modal (zelfde `.overlay`/`.modal`/`.mhdr`/`.mbody`/`.mftr`-opbouw, zie regel 1597-1627 voor het patroon):
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

**b) Knop-template aanpassen** — de bestaande knop op de rapportkaart (zoek `btn-verstuur-rapport` in `renderRapportArchief()`) roept vandaag rechtstreeks `verstuurRapport()` aan via de `addEventListener`-koppeling:
```js
body.querySelectorAll('.btn-verstuur-rapport').forEach(btn => {
  btn.addEventListener('click', () => verstuurRapport(btn.dataset.rapportId || ''));
});
```
wordt:
```js
body.querySelectorAll('.btn-verstuur-rapport').forEach(btn => {
  btn.addEventListener('click', () => voorbeeldRapport(btn.dataset.rapportId || '', btn));
});
```
(De knop-HTML zelf, `data-rapport-id` en de al-verzonden-styling, blijft ongewijzigd.)

**c) `confirm()`-regel verwijderen uit `verstuurRapport()`.** De bevestiging gebeurt voortaan door op "Bevestig en verstuur" te klikken in het voorbeeldvenster — een extra browser-`confirm()`-popup daarna zou een verwarrende dubbele bevestiging geven. Huidig (begin van `verstuurRapport()`, na de TEST_MODE-branch):
```js
  if (!confirm(`Rapport versturen naar alle gekende adressen voor ticket ${r.ticketNumber || r.ticketId}?\n\nDit verstuurt een echte e-mail (en kan niet ongedaan gemaakt worden).`)) return;
  if (btn) btn.disabled = true;
```
wordt:
```js
  if (btn) btn.disabled = true;
```
(De rest van `verstuurRapport()` blijft volledig ongewijzigd.)

**d) Nieuwe functie `voorbeeldRapport(rapportId, btn)`** — vervangt de rol van de oude `confirm()`-regel als instappunt. Voegt toe, vlak vóór `async function verstuurRapport`:
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
- `sandbox=""` op de `<iframe>` blokkeert scripts en elke vorm van uitbraak uit de iframe — de e-mail-HTML zelf bevat geen scripts, maar dit is verdedigende diepte tegen ooit gewijzigde e-mail-inhoud.
- `escHtml(o.html)` in het `srcdoc`-attribuut is nodig omdat de HTML-string zelf aanhalingstekens/`&`-tekens kan bevatten die het attribuut zouden breken — de browser decodeert dit attribuut vóór het als document-inhoud te renderen, dus de e-mail zelf toont wel degelijk correct opgemaakte HTML (dit is een ander mechanisme dan de eerder in dit project vermeden `onclick="..."`-aanpak: hier gaat het om een `srcdoc`-attribuut dat de browser als HTML-document parsed, niet als JavaScript, dus er is geen JS-uitvoerbaarheids-risico).
- **TEST_MODE slaat het voorbeeld over** en roept meteen de bestaande, al-geteste demo-verzending (`verstuurRapport`) aan — geen wijziging aan het bestaande testgedrag.
- `verstuurRapport(rapportId, btn)` zelf **blijft volledig ongewijzigd** — enkel de manier waarop hij aangeroepen wordt (nu via het voorbeeldvenster in plaats van rechtstreeks vanaf de knop) verandert.

## Resultaat

Klik op "Verstuur rapport" toont eerst een venster met, na elkaar, de mail zoals de klant ze ziet en de mail zoals de installateur ze ziet (elk met hun eigen naam waar gekend, en het echte adres ernaast), gebouwd door dezelfde functie die ook echt verstuurt. Pas na klikken op "Bevestig en verstuur" gebeurt de effectieve verzending — via de bestaande, ongewijzigde verzendlogica.

## Niet in scope

- Geen wijziging aan het afspraaksvoorstel (`propose.js`/`sendProposal()`) — dat gebruikt vandaag nog altijd één en dezelfde naam voor klant én installateur (een apart, al eerder gesignaleerd punt, niet meegenomen in deze wijziging).
- Geen weergave van het PDF-rapport zelf in het voorbeeld — enkel de begeleidende e-mailtekst (bewuste keuze, zie Beslissingen hierboven).
- Geen wijziging aan `rapport-verzonden.js`, `voorstel-status.js` of de rest van het "verzonden"-bijhoudsysteem.
