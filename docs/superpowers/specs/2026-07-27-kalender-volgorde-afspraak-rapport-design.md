# Kalendervolgorde, leesbaarheid & service rapport voor manuele/geïmporteerde afspraken

**Datum:** 2026-07-27
**Status:** Approved, ready for implementation plan

## Aanleiding

Drie verwante verbeteringen aan `public/index.html`, samen ontworpen in één brainstorm-sessie op vraag van Brent:

1. In het Kalender-tabblad (weekoverzicht) staan interventies niet in chronologische volgorde.
2. Het uur-label bij ingeplande items is te klein en te grijs om snel te lezen.
3. Een service rapport kan momenteel enkel aangemaakt worden voor tickets die uit Zoho komen — niet voor manueel toegevoegde of geïmporteerde afspraken. Dat moet ook kunnen (behalve voor "Installatie"-afspraken, die komen later).

Tijdens het uitwerken van punt 3 kwam een vierde, breder punt naar boven: hoe de aanrijtijd in het rapport berekend wordt. Brent besliste dat dit voor **alle** tickets (niet enkel de nieuwe afspraken) moet veranderen naar altijd-vanaf-startlocatie.

## Scope

- Kalender-tabblad rendering (`renderKalender`'s week-grid, ~index.html:2250-2382).
- CSS voor het uur-label (`.cal-meta`, `.cal-local-time`).
- `getPlanningTicket()`, `openRapport()`, `openLocalEventDetail()`, en de wizard-afrondingslogica (~index.html:5880-5891).
- Aanrijtijd-berekening binnen `openRapport()` (~index.html:4851-4899).
- Geen wijziging aan Netlify functions — `rapport-archief.js` accepteert al elke string als `ticketId`; `rapport.js` (Zoho-upload) blijft ongewijzigd, wordt enkel conditioneel niet meer aangeroepen.
- Route-tabblad en Ingepland-tabblad blijven ongewijzigd (bevestigd met Brent: "de planning" = het Kalender-tabblad).

## 1. Kalender-volgorde + leesbaarheid

### Huidig gedrag

In de week-grid render-lus (~index.html:2299-2358) worden twee aparte lijsten na elkaar in de DOM gezet:

1. `dayStops` (Zoho-tickets uit `planning[dateStr]`) — gerenderd in invoegvolgorde, niet gesorteerd op tijd.
2. `dayEvents` (lokale afspraken uit `localEvents`) — altijd ná alle `dayStops`, ongeacht hun uur.

Het uur-label gebruikt:
```css
.cal-meta { font-size: 0.65rem; color: var(--muted); margin-left: 4px; }
.cal-local-time { font-size: 0.65rem; color: var(--muted); margin-left: 4px; }
```
— klein en grijs, weinig leesbaar op een drukke dag.

### Nieuw gedrag

**Eén samengevoegde tijdlijn per dag**, tickets en afspraken door elkaar, chronologisch:

- Bouw per dag één array van `{ kind: 'ticket'|'event', uur, data }`-items (uit `dayStops` + `dayEvents`).
- Sorteer met `localeCompare` op `uur` (zelfde patroon als elders in de code, bv. index.html:4875) — lege/ontbrekende `uur` komt **onderaan**, in de oorspronkelijke volgorde (stabiele sort: items zonder uur krijgen een sleutel die altijd na elke ingevulde tijd sorteert, bv. `uur || '99:99'`).
- Vervang de twee losse `forEach`-render-lussen door één lus over deze gesorteerde array, die per item op `kind` beslist welk kaart-template (`cal-ticket` of `cal-local-event`) te bouwen — de bestaande template-HTML per soort kaart blijft ongewijzigd, enkel de volgorde en het samenvoegen zijn nieuw.
- De bestaande checks die op `dayStops.length`/`dayEvents.length` steunen (lege-dag-placeholder, "Route berekenen"-knop) blijven werken doordat beide tellingen nog steeds apart beschikbaar zijn vóór het samenvoegen.

**Leesbaarheid:**
```css
.cal-meta { font-size: 0.8rem; color: var(--text); margin-left: 4px; }
.cal-local-time { font-size: 0.8rem; color: var(--text); font-weight: 600; margin-left: 4px; }
```
`.cal-meta` wordt ook gebruikt voor de technieker-naam-regel (index.html:2312) — die krijgt dus ook de grotere/donkerdere stijl, wat consistent en gewenst is (leesbaarheid geldt niet enkel voor het uur). De ticket-kaart zet nu al `style="font-weight:600"` inline op het uur-element; dat blijft staan en is voortaan overbodig (CSS zet het al), maar hoeft niet verwijderd te worden.

## 2. Service rapport voor manuele/geïmporteerde afspraken

### Huidig gedrag

- `openRapport(ticketId, date)` (index.html:4822) haalt het ticket op via `getPlanningTicket()` (index.html:2499), die enkel zoekt in `allTickets`/`allPending`/`allGepland`/`planning`-tickets — nooit in `localEvents`.
- Bij het afronden van de wizard (index.html:5880-5891): `uploadRapportToZoho(html, _wizTicket.id, filename)` (vereist numeriek Zoho ticket-ID, `rapport.js:65` valideert `/^\d+$/`) + `archiveerRapport(html)` (accepteert elke string als `ticketId`, geen Zoho-afhankelijkheid).
- Lokale afspraken (`bron: 'manueel'`/`'import'`) hebben velden: `id` (UUID), `titel`, `datum`, `uur`, `einduur`, `type` (`'Installatie'|'Service'|'Overige'`), `persoon`, `adres`, `notitie`, `telefoon`, `email`. Geen serienummer, geen installateur/partner, geen prioriteit.
- `openLocalEventDetail()` (index.html:3016) heeft geen "📋 Rapport"-knop; de ticket-detail-modal wel (`d-btn-rapport`, index.html:1350).

### Nieuw gedrag

**a) `getPlanningTicket()` uitbreiden** — als geen match in de bestaande bronnen, zoek in `localEvents` en geef bij een match een pseudo-ticket-object terug:

```js
{
  id: ev.id,                 // UUID — botst nooit met numerieke Zoho ticket-ID's
  number: '',
  subject: ev.titel,
  address: ev.adres || '',
  hasAddress: !!ev.adres,
  assignee: ev.persoon || '',
  phone: ev.telefoon || '',
  telefoonEindklant: ev.telefoon || '',
  contact: ev.titel,          // enkel voor het "klant"-label in het rapport-archief
  account: '',                // NIET ev.titel — zie onder
  partner: '',
  serienummer: '',
  priority: '',
  isLocal: true,
}
```

**Waarom `account`/`partner` leeg blijven:** `R.installateur` (index.html:4836) leest `ticket.partner || ticket.account`. Als `account` de titel van de afspraak zou krijgen, zou "Installateur betrokken" bij élke afspraak automatisch op "Ja" komen te staan met de titel als tekst — een foutieve pre-fill. `contact` wordt daarom apart gehouden, enkel gebruikt voor het klant-label in het archief-overzicht, en beïnvloedt `R.installateur` niet.

Bestaande aanroepers van `getPlanningTicket()` blijven ongewijzigd werken.

**b) Rapport-knop in `openLocalEventDetail()`'s modal**, zichtbaar wanneer `ev.type !== 'Installatie'` (dus bij "Service" en "Overige"):
```js
onclick="openRapport('${ev.id}', '${ev.datum}')"
```
Hergebruikt zo de bestaande wizard-entry ongewijzigd.

**c) Wizard-afronding vertakken op `_wizTicket.isLocal`** (index.html:5880-5891):
- `true` → enkel `archiveerRapport(html)` aanroepen, **niet** `uploadRapportToZoho`. Toast: `"✅ Rapport opgeslagen in archief — geen Zoho-ticket gekoppeld"` i.p.v. de Zoho-upload-toast.
- `false` (bestaande tickets) → ongewijzigd, beide stappen.

**d) Rest van de wizard** (oorzaak storing, onderdelen, foto's, handtekeningen, prijsberekening, `buildRapportHtml`) blijft **ongewijzigd** — die logica is al ticket-onafhankelijk en werkt op `R`/`_wizTicket` zonder Zoho-specifieke aannames, behalve de aanrijtijd-berekening (zie sectie 3).

## 3. Aanrijtijd altijd vanaf startlocatie (alle tickets)

### Huidig gedrag (index.html:4851-4899)

Twee paden, geen van beide onvoorwaardelijk vanaf de startlocatie:

1. Als er al een route berekend is voor die dag in het Route-tabblad (`routeData.legs` aanwezig, `currentRouteDate === date`) → hergebruikt de reistijd van de bijhorende "leg" uit die berekende route (chained van stop tot stop, niet vanaf startlocatie).
2. Anders → rechtstreekse TomTom-opvraging (`/api/optimize` + `/api/route`), met als vertrekpunt het adres van de **vorige** afspraak van diezelfde technieker die dag (op basis van `uur`, indien aanwezig), anders pas `settings.startlocatie`.

### Nieuw gedrag

Aanrijtijd wordt **altijd** berekend als de TomTom-reistijd van `settings.startlocatie` naar het interventie-adres — voor alle tickets (Zoho én de nieuwe lokale afspraken uit sectie 2), ongeacht een al-berekende route en ongeacht wat er die dag voordien gepland stond.

**Implementatie:** de twee bestaande paden (routeData.legs-shortcut op regel 4853-4866, en de vorige-stop-fallback op regel 4872-4878) worden vervangen door één rechtstreekse aanroep:

```js
R.aanrijtijdMin = 0;
if (ticket.hasAddress && settings.startlocatie) {
  try {
    toast('📡 Aanrijtijd berekenen...', 5000);
    const gRes  = await fetch('/api/optimize', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ origin: settings.startlocatie, stops: [ticket.address] }),
    });
    // ... zelfde geocode + /api/route afhandeling als de bestaande fallback (regel 4888-4899),
    // enkel de origin-bepaling zelf (routeData.legs-check + prevStop-lookup) vervalt.
  } catch { /* ongewijzigd bestaand fout-gedrag: R.aanrijtijdMin blijft 0 */ }
}
```

`routeData`, `currentRouteDate`, `sameDayOwnStops`/`aanrijOrigin`-berekening vervallen volledig uit deze functie. De Route-tabblad-functionaliteit zelf (`calculateRoute`/`autoPlan`/`optimizeRoute`, die `routeData` vullen voor de dagroute-planning) blijft **volledig ongewijzigd** — dit raakt uitsluitend de aanrijtijd-waarde die in het rapport/facturatie terechtkomt, exact zoals nu al in de code gedocumenteerd stond ("Enkel voor de rapport-facturatie").

**Neveneffect:** bij elke rapport-opening gebeurt nu altijd een verse TomTom-aanroep (voorheen kon een al-berekende route soms hergebruikt worden zonder extra aanroep) — beperkte extra belasting op de TomTom-quota, functioneel exact wat gevraagd is.

## Backward compatibility & edge cases

- **Bestaande gearchiveerde rapporten**: ongewijzigd, `rapportData.aanrijtijdMin` blijft staan zoals opgeslagen; enkel nieuw gegenereerde rapporten gebruiken de nieuwe berekening.
- **`ticket.hasAddress` is `false`** (geen adres, of `settings.startlocatie` niet ingesteld): `R.aanrijtijdMin` blijft `0` — zelfde gedrag als vandaag.
- **Lokale afspraak zonder adres** (`ev.adres` leeg): pseudo-ticket krijgt `hasAddress: false` → geen aanrijtijd-berekening, consistent met tickets zonder adres.
- **`getPlanningTicket()` dubbele match**: onmogelijk in praktijk — afspraak-ID's zijn UUID's (`crypto.randomUUID()`), Zoho ticket-ID's zijn numeriek; geen overlap.
- **Rapport-archief dedup** (rapport-archief.js:90-92, matcht op `ticketId`+`datum`): werkt ongewijzigd voor lokale afspraken, want `ticketId` wordt daar als opaque string behandeld.

## Niet in scope

- Rapport-knop voor afspraken met `type === 'Installatie'` — komt later (expliciet uitgesteld door Brent).
- Geen wijziging aan Route-tabblad of Ingepland-tabblad.
- Geen wijziging aan hoe `calculateRoute`/`autoPlan`/`optimizeRoute` de dagroute zelf bepalen — enkel de aanrijtijd-waarde in het rapport verandert.
- Geen nieuwe velden in `rapport-archief.js` of andere Netlify functions.
