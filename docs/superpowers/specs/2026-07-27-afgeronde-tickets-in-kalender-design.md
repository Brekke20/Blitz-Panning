# Afgeronde tickets (met rapport) blijven zichtbaar in de Kalender

**Datum:** 2026-07-27
**Status:** Approved, ready for implementation plan

## Aanleiding

Brent merkte op dat tickets die in Zoho gesloten worden, uit de app verdwijnen — ook uit de Kalender, ook voor voorgaande dagen. Hij herinnerde zich een eerdere afspraak dat er bij het maken van een service rapport een "snapshot" bewaard zou blijven zodat je kan terugkijken, en stelde voor om in plaats daarvan de kalenderweergave te baseren op de gegevens uit het service rapport zelf (de echte gewerkte uren).

**Grondoorzaak, uitgezocht in de code:** er bestaat al een beschermingsmechanisme (`reconcilePlanning()`, ~index.html:2735) dat tickets van vandaag/het verleden bewust NIET uit `planning[date]` verwijdert wanneer ze in Zoho sluiten — maar dat helpt niets, want `planning` (~index.html:1671, `let planning = {}`) is een **puur in-memory object zonder enige opslag** (geen localStorage, geen backend). Bij elke herlaad/herstart van de app wordt `planning` leeg herschapen en enkel opnieuw gevuld vanuit de op dat moment nog levende Zoho-tickets (`loadTickets()`, ~index.html:1857-1899). Een ticket dat ooit gesloten is, komt dus na de eerste volgende herstart nooit meer terug — niet door een bug bij het sluiten zelf, maar door het ontbreken van elke vorm van persistente opslag voor de kalenderweergave.

Er bestaat al wél een persistente bron: het **rapport-archief** (`/api/rapport-archief`, Netlify Blob store) — elk gearchiveerd rapport bevat `datum`, `technieker`, `ticketNumber`, `klant`, `adres`, en de volledige `rapportData` (met de échte `start`/`stop`/`werktijd`/`aanrijtijdMin`). Dit bestaat al precies voor het doel dat Brent nodig heeft, maar wordt vandaag enkel getoond als losse lijst in het "Rapporten"-tabblad, niet in de Kalender.

**Scope-beslissing van Brent:** enkel tickets waarvoor ooit een rapport gemaakt is moeten terug zichtbaar zijn — niet elk ooit ingepland ticket (bv. een geannuleerde afspraak zonder rapport moet niet terugkomen).

## Scope

- Enkel `public/index.html` (client-side). Geen wijziging aan `rapport-archief.js` of andere Netlify Functions — de bestaande archief-structuur bevat al alle nodige velden.
- Enkel het Kalender-tabblad (weekoverzicht). Route-tabblad, Ingepland-tabblad en Rapporten-tabblad blijven ongewijzigd.
- Geen wijziging aan hoe/wanneer tickets uit Zoho verdwijnen (`tickets.js`, `reconcilePlanning()`) — dat mechanisme blijft zoals het is, het is niet de oorzaak en niet stuk.

## 1. Rapport-archief eager laden bij app-start

### Huidig gedrag

`_rapportArchief` (~index.html:5975) wordt enkel gevuld via `laadRapportArchief()` (~5983-5996), die enkel aangeroepen wordt wanneer de gebruiker het Rapporten-tabblad opent (~4138, `setTab('rapporten')` → `laadRapportArchief()`). Bij app-start (~1836, `loadTickets(); startTicketPolling();`) wordt het archief niet geladen — als je meteen naar Kalender navigeert zonder ooit het Rapporten-tabblad te openen, is `_rapportArchief` leeg.

### Nieuw gedrag

- **App-start** (~index.html:1836): `laadRapportArchief();` toevoegen naast de bestaande `loadTickets(); startTicketPolling();` aanroepen, zodat het archief altijd al geladen is tegen de tijd dat de gebruiker naar Kalender navigeert.
- **`laadRapportArchief()`** (~5983-5996): na het vullen van `_rapportArchief` en het aanroepen van `renderRapportArchief()`, ook `renderKalender();` aanroepen — zodat een reeds-geopende Kalender-view meteen de nieuw geladen historische tegels toont, en niet pas na een volgende onafhankelijke re-render.

### Edge cases

- **Archief-fetch mislukt** (bestaand gedrag, ongewijzigd): `_rapportArchief` blijft `[]`, de Kalender toont dan gewoon geen historische tegels — geen crash, geen foutmelding in de Kalender zelf (de bestaande foutafhandeling in `laadRapportArchief()` toont de fout enkel in het Rapporten-tabblad, dat blijft zo).
- **`renderKalender()` aanroepen vóór de DOM klaar is**: bestaat al als patroon (`loadTickets()` roept ook al `renderKalender()` aan) — geen nieuw risico.

## 2. Historische tegels in de Kalender week-view

### Huidig gedrag

De week-view render-lus (`renderKalender()`, ~index.html:2257-2372) bouwt per dag een `timeline` van `dayStops` (live Zoho-tickets) + `dayEvents` (lokale afspraken), gesorteerd op tijdstip, en rendert die met `buildTicketCard()`/`buildLocalEventCard()`.

### Nieuw gedrag

**a) Nieuwe derde bron: `dayReports`**, direct na de bestaande `dayEvents`-filter (~2360):

```js
const dayReports = _rapportArchief.filter(r =>
  r.datum === dateStr &&
  (activeAssigneeFilter === 'all' || r.technieker === activeAssigneeFilter) &&
  !dayStops.some(s => s.ticket.id === r.ticketId)
);
```

De laatste voorwaarde (`!dayStops.some(...)`) voorkomt dubbels: als een ticket toevallig nog live in `planning[date]` staat (bv. rapport 's ochtends gemaakt, ticket pas later gesloten in Zoho), telt de live tegel en wordt de historische versie overgeslagen.

**b) Opname in de gesorteerde tijdlijn** (~2362-2365):

```js
const timeline = [
  ...dayStops.map(stop => ({ kind: 'ticket', sortKey: stop.uur || '99:99', stop })),
  ...dayEvents.map(ev   => ({ kind: 'event',  sortKey: ev.uur   || '99:99', ev })),
  ...dayReports.map(r    => ({ kind: 'report', sortKey: r.rapportData?.start || '99:99', report: r })),
].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
```

**c) Rendering** (~2367-2372): de `timeline.forEach`-lus krijgt een derde tak voor `kind === 'report'`, die een nieuwe `buildReportCard(entry)`-functie aanroept (zelfde plaats als `buildTicketCard`/`buildLocalEventCard`, ~index.html:2202-2256):

```js
function buildReportCard(entry) {
  const rd = entry.rapportData || {};
  const tijdLabel = rd.start ? `${rd.start}${rd.stop ? '–' + rd.stop : ''}` : '';
  const card = document.createElement('div');
  card.className = 'cal-ticket afgerond';
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
      <div style="flex:1;min-width:0">
        <div class="cal-num">#${escHtml(entry.ticketNumber || entry.ticketId || '')}</div>
        <span class="cal-badge afgerond">✅ Afgerond</span>
        ${tijdLabel ? `<div class="cal-meta" style="font-weight:600">🕐 ${tijdLabel}</div>` : ''}
        <div class="cal-sub">${escHtml(entry.klant) || '—'}</div>
        ${entry.technieker ? `<div class="cal-meta">${escHtml(entry.technieker)}</div>` : ''}
        <div class="cal-addr ${entry.adres ? '' : 'miss'}">${entry.adres ? escHtml(entry.adres) : 'Geen adres'}</div>
      </div>
    </div>`;
  card.addEventListener('click', () => herOpenRapport(_rapportArchief.indexOf(entry)));
  return card;
}
```

Geen "×"-verwijderknop en geen bel/navigeer-actierij — het archief bewaart geen telefoonnummer, en "verwijderen uit planning" is hier niet van toepassing (dat zou het rapport zelf niet verwijderen; verwijderen van een rapport kan al via het Rapporten-tabblad).

**d) Klikgedrag**: opent het opgeslagen rapport via de bestaande `herOpenRapport(idx)` (~index.html:6111) — exact dezelfde functie die het Rapporten-tabblad al gebruikt, dus dezelfde sandboxed weergave.

**e) Visuele stijl — nieuwe CSS-regels** naast de bestaande `.cal-badge.pending`/`.cal-badge.confirmed` (~index.html:529-530) en `.cal-ticket.pending::before`/`.cal-ticket.confirmed::before` (~522-523):

```css
.cal-badge.afgerond { background: var(--surface3); color: var(--muted); }
.cal-ticket.afgerond::before { background: var(--muted); }
.cal-ticket.afgerond { opacity: 0.7; }
```

**f) Lege-dag-placeholder bijwerken** (~2374-2378): de bestaande check die de "—" plaatshouder verwijdert zodra er lokale afspraken zijn, moet ook rekening houden met `dayReports`:

```js
if (dayStops.length === 0 && (dayEvents.length > 0 || dayReports.length > 0)) {
  const empty = col.querySelector('.day-empty');
  if (empty) empty.remove();
}
```

(De initiële placeholder-conditie in de `col.innerHTML`-template, ~2352, blijft ongewijzigd — die toont de plaatshouder standaard als er nog geen `dayStops` zijn; deze latere check verwijdert hem alsnog zodra er events of rapporten zijn, exact zoals vandaag al voor `dayEvents` gebeurt.)

De "Route berekenen"-knop-conditie (~2381) blijft ongewijzigd — historische rapporten horen niet bij dagroute-planning.

### Edge cases

- **`activeAssigneeFilter` matcht `entry.technieker` op exacte string** — `R.technieker` is vrije tekst die de technieker zelf intypt in de wizard, dus een typfout of afwijkende schrijfwijze kan een rapport laten missen bij filteren op technieker. Dit is een bestaand datakwaliteitsrisico van het rapport-archief zelf (niet nieuw door deze feature) en blijft buiten scope — geen fuzzy matching toevoegen.
- **Ticket zonder `rapportData.start`**: `tijdLabel` wordt dan `''`, de tijd-regel wordt gewoon niet getoond (zelfde patroon als bij lokale afspraken zonder `uur`) — sorteert dan naar `'99:99'`, dus onderaan die dag.
- **Meerdere rapporten voor hetzelfde ticket op dezelfde dag**: kan niet voorkomen — `rapport-archief.js`'s bestaande dedup-logica (matcht op `ticketId`+`datum`) zorgt dat er per ticket+datum maximaal 1 archief-entry is.
- **`entry.adres` leeg**: toont "Geen adres", zelfde patroon als de bestaande ticket-kaart.

## Niet in scope

- Geen wijziging aan het Route-, Ingepland- of Rapporten-tabblad.
- Geen historische weergave voor tickets zonder rapport (expliciete keuze van Brent).
- Geen wijziging aan `reconcilePlanning()`/`tickets.js` — die logica blijft ongewijzigd, ze is niet de oorzaak.
- Geen paginering/limiet bovenop wat het rapport-archief zelf al doet (max 500 bewaarde rapporten, bestaand gedrag).
