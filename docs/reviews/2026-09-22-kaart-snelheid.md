# Kaart-snelheid (Route-tab) — onderzoek 22 september 2026

Klacht: *"De kaart is niet altijd even snel, soms moet deze lang laden."* (Route-tab, desktop)

Dit is een **read-only onderzoek** — er is niets aangepast, enkel code gelezen en de oorzaken herleid.

---

## Samenvatting voor Brent

Het "soms" in de klacht is het belangrijkste woord: de kaart is niet *altijd* traag, maar wel telkens
opnieuw traag op precies voorspelbare momenten. De oorzaak zit niet in de kaart zelf (Leaflet, tegels),
maar in wat er **vóór** de kaart gebeurt: adressen opzoeken (geocoderen) bij TomTom.

**Wat ik gevonden heb, van grootste naar kleinste impact:**

1. **De app onthoudt de opgezochte adressen (coördinaten) nergens tussen twee momenten.** Zodra je de
   pagina herlaadt (F5, PWA opnieuw openen, of gewoon 5 minuten wachten — de tickets worden dan
   automatisch ververst op de achtergrond), gooit de app de al opgezochte coördinaten van geplande/
   bevestigde tickets weg en moet TomTom bij de eerstvolgende routeberekening alle adressen van die dag
   *opnieuw* opzoeken. Dat verklaart waarom de kaart de ene keer meteen staat (alles nog "warm" in het
   geheugen) en de andere keer merkbaar moet laden (net herladen, of er is 5 minuten voorbijgegaan).
2. **Elke routeberekening zoekt ook het vaste vertrekpunt (de zaak/thuisbasis) opnieuw op bij TomTom**
   — ook al verandert dat adres praktisch nooit. Dat is een volledig overbodige extra wachttijd, elke
   keer opnieuw, bovenop de eerste oorzaak.
3. **Die adres-opzoekingen gebeuren na elkaar (drie keer na elkaar wachten) in plaats van in één keer** —
   dat kan in principe in één aanvraag, wat sneller is en minder kans geeft op TomTom's "te veel
   aanvragen"-foutmelding (die in de code zelf al beschreven staat als een gekend, terugkerend probleem).

**Wat ik heb kunnen uitsluiten** (goed nieuws, geen actie nodig): de kaarttegels (OpenStraatKaart/Esri)
zijn al correct ingesteld, de service worker blokkeert geen enkele API- of kaartaanvraag, en de
zware PDF-bibliotheek (puppeteer) van de rapporten zit niet "verstopt" in de routefuncties — die
starten dus niet trager dan nodig door zulke bagage.

**Voorstel:** de twee grootste oorzaken (1 en 2) oplossen kost relatief weinig werk en zou de kaart in
de meeste gevallen (tweede keer op dezelfde dag, na een sleepbeweging, na "Optimaliseren") merkbaar
sneller maken, omdat er dan vaak *helemaal geen* TomTom-adresopzoeking meer nodig is. Zie de voorstellen
onderaan — ik heb dit nog niet gebouwd, enkel de oorzaken in kaart gebracht zoals gevraagd.

---

## Technische bijlage

### 1. Netwerkaanroepen bij "Bereken tijden" / tabwissel

`calculateRoute()` (`public/index.html:3952-4042`) doet, **sequentieel na elkaar** (elke `await` wacht
op de vorige):

| # | Call | Wanneer | Waarom traag |
|---|------|---------|---------------|
| 1 | `POST /api/optimize` — geocode Zoho-stops zonder `_lat` (`:3969-3977`) | enkel als er stops zonder coördinaten zijn | TomTom geocode per adres (parallel binnen dít verzoek, zie §optimize.js) |
| 2 | `POST /api/optimize` — geocode lokale afspraken zonder `_lat` (`:3980-3988`) | enkel als er zulke afspraken zijn | idem |
| 3 | `POST /api/optimize` — geocode **startlocatie** (`:3990-3995`) | **altijd, onvoorwaardelijk, elke keer** | overbodig: `settings.startlocatie` verandert vrijwel nooit |
| 4 | `POST /api/route` (`:4013-4018`) | altijd | TomTom `calculateRoute` met traffic |
| 5 | `POST /api/drukte` (async, niet ge-awaited) (`:4041`, functie `laadDrukteDetail` `:4048-4072`) | enkel bij toekomstig `departAt` én `settings.drukteKleuring` aan | 1 TomTom-call per chunk van max 100 waypoints (`drukte.js:45,136-146`) — voor een normale dagroute meestal 1 call |

Calls 1-4 zijn **alle sequentieel** (drie aparte `await fetch('/api/optimize', ...)`-blokken, dan pas
`/api/route`), terwijl call 3 (startlocatie) volledig onafhankelijk is van 1 en 2 en dus net zo goed
parallel — of zelfs helemaal niet elke keer opnieuw — zou kunnen.

Binnen `optimize.js` zelf gebeurt geocoding wél al parallel:
```js
// optimize.js:57-61
const [originGeo, ...stopsGeo] = await Promise.all([
  geocode(origin),
  ...stops.map(geocode),
]);
```
Dat betekent: de 3 aparte client-aanroepen zouden **in 1 aanroep** samengevoegd kunnen worden
(needsGeo-adressen + localNeedsGeo-adressen + startlocatie-adres in dezelfde `stops`-array), en de
server geocodeert ze dan toch al parallel. Dat scheelt 2 van de 3 netwerk-rondritjes (en dus 2×
Netlify-function-cold-start-kans, zie §6).

**Kern van oorzaak 1** — geocoding wordt niet hergebruikt tussen sessies:
- `let planning = {}` (`:557`) is een **puur in-memory** variabele. Er is geen `localStorage`- of
  backend-persistentie van `planning[date][i]._lat/_lon` gevonden (`saveToCache`/`loadFromCache`,
  `:829-843`, cachen enkel de rauwe ticketdata van `/api/tickets`, niet de geocode-resultaten).
- Erger nog: `applyTicketsData()` (`:845-903`), aangeroepen bij **elke** `loadTickets()` — dus bij
  laden van de pagina én bij elke 30s-poll-check die na 5 minuten effectief herlaadt (`:2146-2158`) —
  **verwijdert en herbouwt** de `planning[date]`-entries voor pending/geplande tickets volledig opnieuw:
  ```js
  // :855-864 — verwijdert alle bestaande entries voor pending/gepland...
  Object.keys(planning).forEach(date => {
    planning[date] = planning[date].filter(p => {
      if (teplanIds.has(p.ticket.id)) return false;
      if (pendingIds.has(p.ticket.id) || geplandIds.has(p.ticket.id)) return false;
      return true;
    });
  });
  // :867-874 — ...en voegt ze terug toe als GLOEDNIEUW object, zonder _lat/_lon
  [...allPending, ...allGepland].forEach(t => {
    ...
    planning[date].push({ ticket: t, address: t.address, uur: extractLocalHour(t.interventieDatum) });
  });
  ```
  Er wordt nergens de oude `_lat/_lon` van het object dat net verwijderd wordt, overgenomen naar het
  nieuwe object. Resultaat: **elke ticketherlaad-cyclus (opstart én 5-min-poll) wist stilzwijgend de
  geocode-cache** voor alle pending/geplande tickets van die dag, ook al is het adres niet gewijzigd.
  De volgende `calculateRoute()`-aanroep ziet die tickets dan weer als `needsGeo` (`:3969`) en moet ze
  opnieuw laten geocoderen door TomTom.

### 2. Wordt `calculateRoute()`/`updateMap()` te vaak getriggerd?

Alle aanroepen van `calculateRoute()`:
- `:3339` `onDateChange()` — bij datumwissel, verwacht/nodig.
- `:3723` `applyRouteOrder()` — na slepen/`Optimaliseren`, verwacht/nodig (1x per actie).
- `:3934`, `:3949` `optimizeRoute()` — foutafhandeling/fallback na optimalisatie, verwacht.
- `:4365` `setTab('planning')` — **al goed afgeschermd**:
  ```js
  // :4362-4365
  if (date && !(routeData?.polyline?.length && currentRouteDate === date)) calculateRoute();
  ```
  Herberekent dus **niet** bij elke tabwissel, enkel als er nog geen (actuele) route voor die datum in
  het geheugen zit. Geen probleem hier.

De 30s/5min-ticketpoll (`startTicketPolling`, `:2146-2158`) roept **zelf geen** `calculateRoute()` of
`updateMap()` aan — maar zoals hierboven beschreven ondermijnt hij wel stilzwijgend de geocode-cache
waar de eerstvolgende berekening op vertrouwt. Dat is een indirecte, vertraagde impact, geen directe
her-render.

`updateMap()` wordt binnen **één** `calculateRoute()`-cyclus twee keer aangeroepen: synchroon meteen na
het `/api/route`-antwoord (`:4022`, "rit-vangnet") en opnieuw asynchroon zodra `laadDrukteDetail()`
klaar is (`:4067`, per-wegvak-detail). Dat is bewust zo gebouwd (comments bij `:3952-3956` en
`:4104-4107`) om meteen iets te tonen terwijl het detail nog binnenkomt — geen bug, wel een bewuste
dubbele render (zie §4).

### 3. Tegelbronnen (`KAART_LAGEN`, `:4078-4086`)

| Laag | Bron | Bijzonderheden |
|---|---|---|
| Standaard | `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` | **gebruikt al** de `{s}`-subdomeinsharding (a/b/c) — Leaflet vult dit automatisch in; geen aanpassing nodig |
| Licht/Donker | Esri Canvas (`server.arcgisonline.com/.../Canvas/...`) | `maxNativeZoom: 16` — verder inzoomen gebruikt de laatste geladen tegel uitvergroot (minder scherp, maar laadt geen extra tegels, dus geen extra vertraging) |
| Satelliet | Esri World Imagery | geen subdomeinsharding, maar Esri's CDN is normaal snel genoeg voor 1 host |

`fitBounds()` wordt **1×** per routeberekening aangeroepen (`:4197` bij route, `:4335` als fallback
zonder route) — geen herhaalde zoom-stappen die extra tegelsets zouden laden buiten wat Leaflet zelf al
normaal doet bij een boundswissel.

**Conclusie:** tegelbronnen zijn geen aantoonbare oorzaak van de klacht.

### 4. Kaart-render-kost

`updateMap()` (`:4171-4336`) doet altijd `routeLayer.clearLayers()` gevolgd door een volledige
heropbouw: 1 polyline voor de route, plus per drukte-sectie/segment een aparte `L.polyline` (bij een
toekomstige dag met detail: 1 per ±1500m-segment — bij een langere route dus tientallen tot ~100+
polylines), plus 1 marker per stop. Dit gebeurt **2×** per berekening (zie §2: sync vangnet + async
detail). Leaflet-polylines zijn goedkoop om te tekenen; voor een dagroute (doorgaans <20 stops, route
van enkele tientallen km) is dit orde-grootte tientallen tot ~100 DOM/SVG-elementen, twee keer — een
merkbare maar waarschijnlijk niet dominante bijdrage aan de trage momenten (hypothese, niet gemeten).

`berekenAankomsten()` (`:3400-3428`) is **O(n)** over `allStops` (één lus, geen geneste lus over
stops) — geen kwadratische complexiteit gevonden.

### 5. Service worker (`public/sw.js`)

```js
// sw.js:19-26
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;   // API-calls: laat door, geen SW-bemoeienis
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
```
`/api/*`-aanvragen (optimize/route/drukte) worden **niet** onderschept — bevestigd geen blokkerende
factor. Kaarttegel-aanvragen lopen wel door de generieke fetch-handler (network-first, cache-fallback
bij offline) — dat voegt een verwaarloosbare JS-dispatch-overhead per tegel toe, geen meetbare
vertraging, en zeker geen blokkade.

### 6. Netlify function cold starts / bundling

`netlify.toml` geeft geen expliciete `timeout`-override voor `optimize`/`route`/`drukte`/`matrix`
(wel voor `rapport`, `send-rapport`, `propose`, `planning-export`, `confirm-afspraak` — allemaal
functies die zwaardere/PDF-gerelateerde taken doen).

`package.json`-dependencies bevatten `puppeteer-core` + `@sparticuz/chromium-min` (zwaar, voor
PDF-rapporten). Nazicht van `optimize.js`, `route.js`, `drukte.js`, `matrix.js`: **geen enkele import**
buiten de ingebouwde `fetch` — deze 4 functies bundelen dus niets zwaars mee en hebben geen
puppeteer-gerelateerde cold-start-penalty. Dat is uitgesloten als oorzaak.

Wel relevant: omdat calls 1-4 in §1 **sequentieel** lopen (niet `Promise.all` aan de kliëntkant),
stapelen eventuele cold-starts van afzonderlijke Netlify-functies zich op (elke losse `/api/optimize`-
aanroep kan een aparte lambda-cold-start betekenen als die functie een tijdje niet gebruikt is). Bij
parallellisatie (§ voorstellen) zou de cold-start-tijd van de trage functie het totaal bepalen in
plaats van de som van alle cold starts.

### 7. TomTom 429-rate-limiting (hypothese, wel met code-bevestiging)

`optimize.js:10-15` documenteert expliciet:
> *"Deze app vuurt per knopklik gemakkelijk 5-10 gelijktijdige geocode-aanvragen af... dat overschrijdt
> die limiet vaak (HTTP 429)... vandaar de eerder onbetrouwbare/onverklaarbare foutmeldingen."*

Retry-met-backoff (`sleep(attempt * 400)`, tot 3 pogingen = tot +2,4s in het slechtste geval per
geocode) lost dit meestal op, maar bevestigt dat er al een gekend patroon van trage/herhaalde
TomTom-aanvragen bestaat — precies het patroon dat oorzaak 1+2 hierboven onnodig vaker triggeren dan
nodig. Hoe vaak dit in de praktijk daadwerkelijk 429't, is niet uit de code af te leiden (geen
telemetrie/logging van retry-frequentie gezien) — dit blijft een hypothese qua frequentie, niet qua
bestaan.

---

## Voorstellen (niet geïmplementeerd — enkel ter beoordeling)

Gerangschikt op verwachte winst t.o.v. moeite:

1. **Geocode-cache persisteren per adres** (localStorage, key = genormaliseerd adres →
   `{lat, lon, ts}`). `calculateRoute()`/`applyTicketsData()` checken deze cache vóór ze `/api/optimize`
   aanroepen. **Winst: hoog** (lost oorzaak 1 op — de meeste routeberekeningen op eenzelfde dag zouden
   dan 0 TomTom-geocode-aanvragen meer nodig hebben). **Moeite: medium** (cache-key-normalisatie,
   invalidatie bij adreswijziging).
2. **Startlocatie-geocode cachen** (in-memory of in `settings`) en enkel herberekenen als
   `settings.startlocatie`-tekst wijzigt. **Winst: medium-hoog**, **moeite: laag** (paar regels).
3. **De 3 sequentiële `/api/optimize`-calls samenvoegen tot 1** (needsGeo + localNeedsGeo + startlocatie
   in dezelfde aanvraag; server geocodeert al parallel). **Winst: medium** (minder rondritjes, minder
   429-kans), **moeite: laag-medium** (resultaten terug moeten splitsen per bron).
4. **`applyTicketsData()` laten hergebruiken i.p.v. weggooien**: vóór het filteren de bestaande
   `_lat/_lon` (op ticket-id) opzoeken en overzetten naar het nieuwe entry-object. **Winst: medium**
   (vermijdt dat de 5-min-poll de cache om de 5 minuten stilzwijgend wist), **moeite: laag** — kleinere,
   snellere ingreep dan #1, maar lost het "verse pagina-load"-scenario niet op (daarvoor is #1 nodig).
5. **Gefaseerde voortgangsindicator** i.p.v. één generieke "Route berekenen..."-toast: bv. "Adressen
   opzoeken (3)... / Route berekenen... / Drukte laden...". Verklaart voor de gebruiker wélke stap traag
   is, zonder de wachttijd zelf te verkorten. **Winst: laag qua snelheid, hoog qua perceptie/vertrouwen**
   ("nu snap ik waarom het soms langer duurt"), **moeite: laag**.

Niet aanbevolen om nu aan te pakken (lage winst of risico op regressie):
- De dubbele `updateMap()`-redraw (sync vangnet + async detail) is bewust ontworpen UX (toon meteen
  iets, verfijn later) — aanraken risqueert de huidige, gedocumenteerde beslissing terug te draaien.
- Tegelbronnen/`fitBounds` zijn al correct ingesteld — geen wijziging nodig.
