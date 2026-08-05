# Contactpersoon als derde ontvangercategorie + klant-e-mailbug

**Datum:** 2026-07-31
**Status:** Approved, ready for implementation

## Aanleiding

Brent merkte op dat bij het versturen van een rapport naar de klant enkel het e-mailadres onder "contact info" gebruikt wordt, ook al staat er een apart klant-e-mailadres op het ticket (`cf_e_mail_eindklant`).

**Root cause (grondig bevestigd, niet enkel vermoed):** `netlify/functions/propose.js:203` en `netlify/functions/send-rapport.js:88` bepalen het klant-adres met:
```js
const klantEmail = ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId || cf.cf_e_mail_eindklant || '';
```
Het generieke contact-e-mailadres staat hier VÓÓR het specifieke klantveld — zodra er een contact-e-mailadres bestaat (bijna altijd het geval), wint dat en wordt `cf_e_mail_eindklant` genegeerd. Ter vergelijking: `netlify/functions/tickets.js:137,143` houdt deze twee velden al correct apart (`email` vs `emailEindklant`), en de frontend (`openProposal()`) prioriteert vandaag al correct `emailEindklant || email` voor de PREVIEW-tekst — enkel de twee backend-verzendfuncties hebben de volgorde fout.

Tijdens het bespreken van de fix bleek de gewenste oplossing groter dan een prioriteitswissel: Brent wil dat **beide** partijen een mail krijgen wanneer ze verschillen — niet de ene OF de andere.

## Beslissingen

1. **Contactpersoon wordt een volwaardige, derde ontvangercategorie** (`doelgroep: 'contact'`), naast de al-bestaande `klant` en `installateur` — geen aparte "OF/OF"-keuze meer tussen contact-e-mail en klantveld.
2. **Als contactpersoon en klant hetzelfde e-mailadres hebben (hoofdletterongevoelig vergeleken), wordt er maar 1 mail naar dat adres verstuurd** — geen dubbele mail naar hetzelfde adres.
3. **Dit geldt voor zowel het afspraaksvoorstel (`propose.js`) als het rapport-versturen (`send-rapport.js`)** — dezelfde onderliggende bug/beperking zat in beide, dezelfde oplossing hoort in beide.
4. **"Contactpersoon" = de bestaande generieke contact-e-mail van het ticket** (`ticketData.email || ticketData.contact?.email || ticketData.contact?.emailId`) — dit is exact wat vandaag al (verkeerd) als enige "klant"-adres gebruikt werd. **"Klant" = specifiek `cf_e_mail_eindklant`.** Deze scheiding bestaat al in `tickets.js`, wordt nu ook toegepast in de verzendfuncties.

## Technische uitwerking

### 1. `netlify/functions/propose.js` — 3-weg ontvangers + dedup

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
De rest van de functie (de per-ontvanger `sendReply`-lus, de foutafhandeling, de PATCH-stap) blijft ongewijzigd — die itereert al generiek over `ontvangers`, ongeacht hoeveel entries erin zitten.

### 2. `netlify/functions/send-rapport.js` — idem, met naam voor personalisatie

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
(`contactNaam` mirrort exact het bestaande naam-patroon uit `tickets.js:134-136`.) De rest van de functie (preview-modus, echte verzendlus, `buildRapportEmailHtml({ticketNumber, naam})`) blijft ongewijzigd — die geeft `naam` al generiek door per ontvanger.

### 3. `netlify/functions/voorstel-status.js` — doelgroep-whitelist uitbreiden

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

### 4. `netlify/functions/rapport-verzonden.js` — doelgroep-whitelist + veld-mapping uitbreiden

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

### 5. `public/index.html` — gedeelde helper voor Nederlandse opsomming

Nieuwe kleine helperfunctie, te gebruiken door zowel `sendProposal()` als `verstuurRapport()` (voorkomt "contact en klant en installateur", geeft correct "contactpersoon, klant en installateur"):
```js
function joinNL(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' en ' + items[items.length - 1];
}
const DOELGROEP_LABEL = { contact: 'contactpersoon', klant: 'klant', installateur: 'installateur' };
```
Plaats deze vlak vóór `function sendProposal()`.

### 6. `openProposal()` — preview-tekst toont contact en klant apart

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
(De rest van `openProposal()` — de `#proposal-email`-tekst, de ticketlabel — leest gewoon `ontvangers`, ongewijzigd.)

### 7. `sendProposal()` — doelgroep-lus + berichten uitbreiden

Zoek:
```js
    for (const doelgroep of ['klant', 'installateur']) {
```
Vervang door:
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

### 8. `voorbeeldRapport()` — generiek label i.p.v. hardcoded klant/installateur

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

### 9. `verstuurRapport()` — doelgroep-lus + veld-mapping + berichten uitbreiden

Zoek:
```js
    for (const doelgroep of ['klant', 'installateur']) {
```
Vervang door:
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

### 10. `renderRapportArchief()` — badge/knop houdt ook rekening met contact

Zoek:
```js
${(rapportId && rd._html && r.ticketId) ? `<button class="cal-btn btn-verstuur-rapport" data-rapport-id="${escHtml(rapportId)}" title="${(r.verzondenKlant || r.verzondenInstallateur) ? 'Al verzonden op ' + escHtml(fmtDate(r.verzondenKlant || r.verzondenInstallateur)) + ' — opnieuw versturen?' : ''}">${(r.verzondenKlant || r.verzondenInstallateur) ? '✅ Verzonden' : '✉️ Verstuur rapport'}</button>` : ''}
```
Vervang door:
```js
${(rapportId && rd._html && r.ticketId) ? `<button class="cal-btn btn-verstuur-rapport" data-rapport-id="${escHtml(rapportId)}" title="${(r.verzondenContact || r.verzondenKlant || r.verzondenInstallateur) ? 'Al verzonden op ' + escHtml(fmtDate(r.verzondenContact || r.verzondenKlant || r.verzondenInstallateur)) + ' — opnieuw versturen?' : ''}">${(r.verzondenContact || r.verzondenKlant || r.verzondenInstallateur) ? '✅ Verzonden' : '✉️ Verstuur rapport'}</button>` : ''}
```

### 11. Route-lijst "voorstel verzonden"-badge — ook contact meetellen

Zoek:
```js
${(voorstelStatus[item.ticket.id]?.klant || voorstelStatus[item.ticket.id]?.installateur) ? '<div class="stop-proposal-sent">✉️ Voorstel verstuurd</div>' : ''}
```
Vervang door:
```js
${(voorstelStatus[item.ticket.id]?.contact || voorstelStatus[item.ticket.id]?.klant || voorstelStatus[item.ticket.id]?.installateur) ? '<div class="stop-proposal-sent">✉️ Voorstel verstuurd</div>' : ''}
```

## Niet in scope

- Geen wijziging aan `propose.js`'s bestaande beperking dat alle ontvangers dezelfde `recipientName` krijgen in de aanhef (dat is een apart, al eerder gesignaleerd punt uit de vorige eindcontrole — niet meegenomen hier, enkel de ontvangerslijst zelf wordt uitgebreid).
- Geen wijziging aan de TEST_MODE-simulatiepaden in `sendProposal()`/`verstuurRapport()` — die blijven een eenvoudige demo, niet bedoeld om de echte 3-weg-logica te testen (dat gebeurt via gestubte fetch-scripts, niet via TEST_MODE).
- Geen wijziging aan `rapport-archief.js` zelf.
