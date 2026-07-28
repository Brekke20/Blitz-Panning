# Datum/tijd wijzigen van een al ingepland ticket

**Datum:** 2026-07-28
**Status:** Approved, ready for implementation plan

## Aanleiding

Als een klant laat weten dat een al ingepland moment niet past, kan Brent dit vandaag niet rechtstreeks aanpassen. Uitgezocht in de code:

- **Lokale/manuele afspraken** (`localEvents`, aangemaakt via de "manueel toevoegen"-knop) kunnen al volledig bewerkt worden, inclusief datum en tijd, via de bestaande "bewerk afspraak"-flow (`editFromLocalDet()` → `openManueelModalEdit()`). Geen gat hier.
- **Zoho-tickets (interventies) die al een datum hebben** (dus al zichtbaar in de Kalender, in `planning[datum]`) hebben geen enkele manier om naar een nieuwe datum/tijd te verhuizen:
  - De enige datum+tijd-kiezer in de app (`saveToewijzen()`, index.html:4789) bestaat enkel voor tickets **zonder** datum ("Wacht bevestiging — zonder datum"-lijst).
  - Het enige wat je vandaag kan doen met een al-ingepland ticket is het via de ×-knop verwijderen (`removeTicketFromDate()`, index.html:2144) — dat zet het terug naar "Service in te plannen" zonder datum, en je moet het dan opnieuw oppikken. Er is geen dag-naar-dag drag&drop in de Kalender, en geen tijdstip-controle bij het opnieuw toevoegen (`addTicketToDate()` zet altijd middernacht, index.html:2106).

## Beslissingen uit het gesprek met Brent

- Scope: enkel Zoho-interventies. Lokale afspraken hebben dit al.
- Locatie in de UI: in het ticket-detailvenster (niet inline op de kalenderkaart).
- Statusgedrag: bij het wijzigen van datum/tijd gaat de Zoho-status terug naar **"Wachten op bevestiging planning"** — consistent met hoe een eerste toewijzing vandaag al werkt, en voorkomt dat een verzet moment per ongeluk als definitief bevestigd blijft staan.
- De 45-minuten-reistijdregel (zie `[[project-maxreistijd-evaluatie]]` en de designdoc van dezelfde datum) geldt hier **niet** — die regel is en blijft beperkt tot de automatische planner (`autoPlan()`), niet tot handmatige acties.

## Scope

- `public/index.html`: nieuwe knop + inline datum/tijd-kiezer in het ticket-detailvenster, plus de bijhorende opslaan-functie.
- Geen wijzigingen aan Netlify-functies nodig — de bestaande `/api/plan`-endpoint (die al status + datum in één PATCH naar Zoho zet) wordt hergebruikt, exact zoals `addTicketToDate()` dat vandaag al doet voor een eerste toewijzing.
- Geen wijziging aan lokale afspraken (`localEvents`) — die hebben dit al.

## 1. Detailvenster — nieuwe knop

**HTML** (`#det-overlay` footer, ~index.html:1354-1355, naast de bestaande knoppen):
```html
<button class="btn-cancel" id="d-btn-reschedule" style="display:none" title="Datum/tijd wijzigen" onclick="toggleRescheduleRow()">📅 Datum/tijd</button>
```

**Inline picker** (nieuwe `msec`-blok in `.mbody`, na de bestaande "Ticketdetails"-sectie, ~index.html:1346), zelfde stijl als de bestaande assign-row op de kalenderkaart:
```html
<div class="msec" id="d-reschedule-row" style="display:none">
  <div class="msec-title">Nieuwe datum/tijd</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
    <input type="date" id="d-reschedule-date" class="set-input" style="width:auto">
    <input type="time" id="d-reschedule-time" class="set-input" style="width:auto">
    <button class="btn-save" onclick="saveReschedule()">✓ Opslaan</button>
  </div>
</div>
```

**`openDetail(t)`** (~index.html:4198-4202): de nieuwe knop volgt dezelfde zichtbaarheidsregel als de andere plan-afhankelijke knoppen (`showPlanBtns`, d.w.z. het ticket staat al in `planning`):
```js
document.getElementById('d-btn-reschedule').style.display = showPlanBtns ? '' : 'none';
document.getElementById('d-reschedule-row').style.display  = 'none'; // altijd ingeklapt bij (her)openen
```

## 2. Nieuwe functies

```js
function toggleRescheduleRow() {
  const row = document.getElementById('d-reschedule-row');
  const opening = row.style.display === 'none';
  row.style.display = opening ? '' : 'none';
  if (opening && activeTicket) {
    const d = activeTicket.interventieDatum ? new Date(activeTicket.interventieDatum) : new Date();
    document.getElementById('d-reschedule-date').value = localISO(d);
    document.getElementById('d-reschedule-time').value =
      `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
}

async function saveReschedule() {
  if (!activeTicket || !_detailDate) return;
  const date = document.getElementById('d-reschedule-date').value;
  const time = document.getElementById('d-reschedule-time').value || '09:00';
  if (!date) return toast('⚠️ Selecteer een datum');

  const oldDate  = _detailDate;
  const ticketId = activeTicket.id;

  // Zelfde waarschuwingen als bij een eerste toewijzing (addTicketToDate) — enkel
  // relevant als de dag effectief verandert.
  if (date !== oldDate) {
    const feestdag = getHolidayName(date);
    if (feestdag && !confirm(`🎌 ${feestdag} is een wettelijke feestdag (${fmtDateShort(date)}).\nToch inplannen?`)) return;
    if (kbBlocked(ticketId, date) && !confirm(`⚠️ Klant gaf aan NIET beschikbaar te zijn op ${fmtDateShort(date)}.\nToch inplannen?`)) return;
  }

  const utcInterventieDatum = new Date(`${date}T${time}:00`).toISOString();
  closeDet();
  try {
    const res  = await fetch('/api/plan', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketId, date, utcInterventieDatum }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Lokale state: uit de oude dag halen, aan de nieuwe dag toevoegen.
    if (planning[oldDate]) {
      planning[oldDate] = planning[oldDate].filter(p => p.ticket.id !== ticketId);
      if (!planning[oldDate].length) delete planning[oldDate];
    }
    activeTicket.interventieDatum = utcInterventieDatum;
    activeTicket.status = 'Wachten op bevestiging planning';
    if (!planning[date]) planning[date] = [];
    if (!planning[date].find(p => p.ticket.id === ticketId)) {
      planning[date].push({ ticket: activeTicket, address: activeTicket.address, uur: extractLocalHour(utcInterventieDatum) });
    }
    renderKalender();
    toast(`✓ Verzet naar ${fmtDateShort(date)} om ${time}`);
  } catch (err) {
    toast('❌ Zoho update mislukt: ' + err.message, 4000);
  }
}
```

**Waarom `/api/plan` en niet `/api/plan-datum`:** `/api/plan` (netlify/functions/plan.js) zet in één PATCH zowel de Zoho-status (`Wachten op bevestiging planning`) als het datumveld — exact het gedrag dat Brent koos. `/api/plan-datum` zet enkel het datumveld en laat de status ongemoeid; dat is niet wat hier nodig is.

## Edge cases

- **Nieuwe datum = zelfde dag, enkel tijdstip verandert:** de feestdag-/klant-geblokkeerd-waarschuwingen worden overgeslagen (die golden al toen de dag oorspronkelijk gekozen werd) — enkel relevant bij een echte dagwissel.
- **Zoho-aanroep mislukt:** het detailvenster is dan al gesloten (optimistische UX, zelfde afweging als `addTicketToDate`/`removeTicketFromDate` vandaag) — de fout verschijnt als toast, de lokale planning blijft ongewijzigd (geen optimistische update vóór de aanroep, in tegenstelling tot `addTicketToDate`, omdat hier zowel een verwijdering als toevoeging tegelijk zouden moeten terugdraaien bij falen — eenvoudiger en veiliger om pas na succes bij te werken).
- **Ticket heeft geen `activeTicket.address`/coördinaten:** geen impact — dit wijzigt geen adresvelden, enkel datum/tijd/status.
- **Dubbelklik op "Opslaan":** geen expliciete dubbelklik-bescherming (zoals `inFlightTickets` bij `addTicketToDate`); het detailvenster sluit onmiddellijk bij de eerste klik, dus een tweede klik is in de praktijk niet mogelijk.

## Niet in scope

- Geen wijziging aan lokale afspraken — die kunnen dit al.
- Geen koppeling met de max-reistijd-regel van de automatische planner — dit is een handmatige actie.
- Geen dag-naar-dag drag&drop in de Kalender — dit designdoc lost het probleem op via het detailvenster, niet via drag&drop.
