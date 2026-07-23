# Foto's toevoegen aan het service rapport

**Datum:** 2026-07-24
**Status:** Approved, ready for implementation plan

## Aanleiding

Technici moeten foto's kunnen toevoegen aan een interventie — bij aankomst, tijdens de interventie, op het einde, of op eender welk moment daartussen — **voordat** het service-rapport zelf wordt aangemaakt. Dit is een fundamenteel ander patroon dan de bestaande handtekeningen, die enkel binnen één ononderbroken wizard-sessie bestaan (canvas → base64 → direct ingebed in het rapport): foto's moeten een sessie, een tabblad-sluiting, en zelfs een toestelwissel overleven, omdat "aankomst" en "einde interventie" uren uit elkaar kunnen liggen.

## Scope

- Nieuwe Netlify Function `netlify/functions/fotos.js` — server-side opslag per ticket, overleeft sessies.
- Nieuwe "📷 Foto's"-knop in het detail-modaal ([public/index.html:1341](public/index.html:1341) e.o.), buiten de wizard, altijd beschikbaar voor een ingepland ticket.
- Nieuwe wizard-stap "Foto's", ingevoegd in `WIZ_STEPS` ([public/index.html:4518](public/index.html:4518)) na "Omschrijving".
- Foto's ingebed in `buildRapportHtml()` ([public/index.html:5279](public/index.html:5279)), zelfde principe als de handtekeningen ([public/index.html:5320](public/index.html:5320)).

## 1. Backend — `netlify/functions/fotos.js`

Zelfde GET/PUT/optimistic-lock-conventie als `klantbeschikbaarheid.js`, met **één belangrijke afwijking**: waar bestaande endpoints (`klantbeschikbaarheid.js`, `afspraken.js`) alle tickets samen in **één gedeelde blob** bewaren (haalbaar want de velden zijn klein — een paar datums en een notitie per ticket), zou dat voor foto's niet schalen: elke GET/PUT zou dan de volledige foto-geschiedenis van *alle* tickets ooit moeten downloaden/uploaden om één foto toe te voegen. Foto's krijgen daarom **één blob-key per ticket** (`foto-<ticketId>`) — zelfde aanpak als `prijzen.js` al gebruikt voor zijn backup-blobs (`prijslijst-backup-N`), dus geen nieuw patroon in dit project.

- `GET /api/fotos?ticketId=<id>` → `{ versie, fotos: [ { id, dataUrl, caption, tijdstip } ] }` (leeg `{ versie: 0, fotos: [] }` als er nog niets is).
- `PUT /api/fotos` met body `{ ticketId, versie, fotos: [...] }` → optimistic-lock replace van die ticket-blob, `409` bij versie-mismatch (zelfde conflict-respons als `klantbeschikbaarheid.js`).
- Validatie: `dataUrl` moet met `data:image/` beginnen (voorkomt willekeurige data-injectie in de blob), `caption` afgekapt op bv. 200 tekens, `fotos` max bv. 30 items per ticket (ruime marge, geen harde productvereiste maar een sanity-cap tegen een verkeerd werkende client).

## 2. Client-side compressie (vóór elke upload)

Elke gekozen foto wordt, vóór de PUT, via een `<canvas>` verkleind:
- Max breedte/hoogte ~1600px (schaal proportioneel als de foto groter is).
- Geëxporteerd als JPEG, kwaliteit ~0.7.

**Waarom dit niet optioneel is:** ruwe telefoonfoto's zijn vaak 3–8MB. Meerdere daarvan ongecomprimeerd in de uiteindelijke rapport-HTML zouden de PDF-generatie in `rapport.js` (26s functie-timeout) risico op timeout geven, en de Blob-opslag onnodig laten groeien. Na compressie landt een foto typisch op enkele honderden KB.

## 3. "📷 Foto's"-knop in het detail-modaal

Nieuwe knop naast Aankomst/Voorstel/Rapport in de `mftr`-footer ([public/index.html:1330-1341](public/index.html:1330)), zelfde zichtbaarheidsregel (`showPlanBtns = !!_detailDate`) — dus enkel voor een ingepland ticket, op zowel mobiel als desktop (dit is on-site technieker-werk, geen coördinator-actie, dus **geen** `desktop-only`). Toont een telling als er al foto's zijn genomen, bv. "📷 Foto's · 3".

Klikken opent een nieuw, eenvoudig modaal (`#foto-overlay`):
- Grid met miniaturen van de reeds opgeslagen foto's voor dit ticket (opgehaald via `GET /api/fotos?ticketId=`).
- Per foto: een ✕-knopje om te verwijderen (zelfde stijl als `kb-chip-del`), en een klein tekstveld voor een optioneel bijschrift met een "✓"-knopje om op te slaan (zelfde patroon als de klantbeschikbaarheid-notitie, [public/index.html](public/index.html) `renderKbSection`).
- Knop **"+ Foto toevoegen"** → `<input type="file" accept="image/*" multiple>` (geen `capture`-attribuut geforceerd — dit laat het toestel zelf de systeemkeuze "Camera nemen" vs. "Kies uit galerij" aanbieden). Per gekozen bestand: comprimeren (zie boven), tijdstip erbij (`new Date().toISOString()`), en direct PUT-en naar de server (optimistisch bijwerken + PUT, zelfde patroon als `updateKb()`).
- Sluitknop.

## 4. Wizard-stap "Foto's"

`WIZ_STEPS` ([public/index.html:4518](public/index.html:4518)) krijgt een nieuwe entry na "omschrijving": `{ id: 'fotos', label: "Foto's", render: wizRenderFotos, save: wizSaveFotos }`. Volgorde wordt: Algemeen → Facturatie → Product → Omschrijving → **Foto's** → Status → Handtekening 1 → Handtekening 2 (8 stappen totaal, was 7).

- `openRapport()` ([public/index.html:4528](public/index.html:4528)) haalt bij het starten van een nieuwe sessie de bestaande foto's voor dit ticket op (`GET /api/fotos?ticketId=`) en zet ze in `R.fotos` — zelfde moment waarop andere `R`-velden gereset/gevuld worden.
- De stap zelf toont dezelfde miniaturen-grid als het detail-modaal-foto's-scherm — toevoegen/verwijderen/bijschrift-bewerken kan hier ook nog (voor het geval er net vóór het afronden nog een foto bij moet), en gebruikt dezelfde `GET`/`PUT /api/fotos`-aanroepen.
- **Geen verplicht minimum** — deze stap is altijd optioneel doorloopbaar, zoals "Varia" nu ook is.
- `buildRapportHtml()` ([public/index.html:5279](public/index.html:5279)) krijgt een nieuwe sectie "Foto's" (analoog aan de bestaande `<div class="sec">`/`<div class="block">`-secties), die elke foto toont met tijdstip en bijschrift — zelfde `<img>`-inbed-principe als de handtekeningen ([public/index.html:5320-5324](public/index.html:5320)). Wordt automatisch mee gearchiveerd zodra het rapport wordt opgeslagen, want de volledige `_html` (incl. ingebedde foto's) wordt al gearchiveerd door de bestaande `archiveerRapport()`.

## Niet in scope

- Foto's automatisch opruimen uit de `foto-<ticketId>`-blob na afronding van het rapport (geen bewezen probleem vandaag).
- Een eigen in-app camera-interface (`getUserMedia`/canvas) — de systeem-bestandkiezer volstaat.
- Vaste foto-categorieën (Aankomst/Tijdens/Einde) — enkel automatisch tijdstip + vrij bijschrift.
- Foto's tonen/beheren op de "Rapporten"-archiefpagina los van het rapport zelf — ze zijn enkel bereikbaar via het detail-modaal (vóór het rapport) en ingebed in het rapport zelf (na het rapport).
- Wijzigingen aan hoe/waar handtekeningen werken.

## Edge cases

- **Ticket wordt herpland naar een andere datum tussen foto's nemen en rapport afwerken:** geen probleem — foto's zijn gekoppeld aan `ticketId` alleen, niet aan datum (bewuste afwijking van hoe `arrivalData` werkt, zie sectie 1).
- **Geen internetverbinding op het moment van een foto nemen:** de PUT faalt; zelfde foutafhandeling/toast-patroon als andere server-calls in de app (bv. `addTicketToDate`'s "❌ ... mislukt"-toast) — foto blijft *niet* achter in een lokale wachtrij, technieker moet opnieuw proberen zodra er verbinding is. Geen offline-queue in scope.
- **`dataUrl` die niet met `data:image/` begint:** door de backend-validatie afgewezen met `400` (voorkomt corrupte/kwaadaardige payloads in de blob).
- **Meer dan ~30 foto's op één ticket:** door de backend-cap afgewezen — in de praktijk zal dit nooit gehaald worden voor een normale interventie.
