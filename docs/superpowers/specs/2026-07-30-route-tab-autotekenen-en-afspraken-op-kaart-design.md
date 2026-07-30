# Route-tab: automatisch tekenen, afspraken op kaart, geen nieuwe uren voor bevestigde tickets

**Datum:** 2026-07-30
**Status:** Approved, ready for implementation

## Aanleiding

Brent meldde na de vorige ronde (Route-tab-volgorde) drie samenhangende problemen op de Route-tab:

1. De route wordt niet automatisch getekend/berekend bij het openen van de tab of het kiezen van een datum — enkel bij een handmatige klik op "Bereken tijden". Dit is bestaand, niet-recent gedrag, maar niet vanzelfsprekend.
2. Handmatige afspraken verschijnen niet op de kaart — `updateMap()` leest enkel Zoho-tickets, niet `localEvents`. Bij een dag met enkel handmatige afspraken toont de kaart niets; bij een gemengde dag klopt de nummering (1,2,3...) niet meer met de lijst ernaast sinds de vorige ronde tickets en afspraken door elkaar sorteerde.
3. De routelijst herberekent voor **elke** stop een geschat tijdstip, ook voor tickets/afspraken die al een echt, afgesproken uur hebben — dezelfde soort fout die `computeArrivalTimes()` (gebruikt door Kalender/Voorstel) een paar dagen geleden al opgelost kreeg, maar `renderRouteList()` heeft zijn eigen, aparte berekening die dat nog niet doet.

Brent's expliciete kader: bevestigde afspraken mogen geen "nieuw" tijdstip krijgen — de Route-tab moet gewoon de al-afgesproken volgorde/uren tonen. Het gebruiken van die verschillende tijdstippen om verkeersdrukte per moment te tonen (kleurcodering) is bewust voor een latere, aparte ronde.

## Scope

Enkel `public/index.html`: `setTab()`, `onDateChange()`, `updateMap()`, `renderRouteList()`'s aankomsttijd-berekening. Geen wijziging aan `calculateRoute()`/`optimizeRoute()` zelf, geen backend-wijziging.

## Fix A — route automatisch berekenen

**`setTab(tab)`** (index.html:4297-4308), huidige `planning`-tak:
```js
  if (tab === 'planning') setTimeout(() => leafletMap?.invalidateSize(), 50);
```
wordt:
```js
  if (tab === 'planning') {
    setTimeout(() => leafletMap?.invalidateSize(), 50);
    const date = document.getElementById('plan-date').value;
    // Automatisch berekenen (in de al-geplande volgorde, niet optimaliseren) als er nog
    // geen actuele route voor deze dag in het geheugen zit -- vermijdt onnodige
    // TomTom-aanvragen bij elke tabwissel zonder wijzigingen.
    if (date && !(routeData?.polyline?.length && currentRouteDate === date)) calculateRoute();
  }
```

**`onDateChange(val)`** (index.html:3932-3936):
```js
function onDateChange(val) {
  renderRouteList(val);
  updateRouteBtns(val);
  routeData = null;
}
```
wordt:
```js
function onDateChange(val) {
  renderRouteList(val);
  updateRouteBtns(val);
  routeData = null;
  calculateRoute();
}
```
`calculateRoute()` zelf doet al niets als er niets te plannen valt voor die datum (bestaande vroege `return`), dus dit is veilig ook op lege dagen.

## Fix B — handmatige afspraken op de kaart

**`updateMap(date)`** (index.html:4257-4280), volledig vervangen door dezelfde combinatie +
sortering die `renderRouteList()` al gebruikt:
```js
function updateMap(date) {
  routeLayer.clearLayers();
  // Zelfde combinatie + sortering als renderRouteList()/calculateRoute(), zodat de
  // kaartnummering (1,2,3...) exact overeenkomt met de lijst ernaast, en handmatige
  // afspraken ook zichtbaar worden (voorheen enkel Zoho-tickets).
  const stops = (planning[date] || []).filter(p =>
    activeAssigneeFilter === 'all' || p.ticket.assignee === activeAssigneeFilter
  );
  const localForDate = localEvents.filter(e =>
    e.datum === date && (e.adres || e.notitie) &&
    (activeAssigneeFilter === 'all' || !e.persoon || e.persoon === activeAssigneeFilter)
  );
  const allStops = [
    ...stops.map(s => ({ kind: 'ticket', item: s, uur: s.uur })),
    ...localForDate.map(e => ({ kind: 'local', item: e, uur: e.uur })),
  ].sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'));
  if (!allStops.length) return;
  if (routeData?.polyline?.length && currentRouteDate === date) {
    const poly = L.polyline(routeData.polyline, { color:'#f59e0b', weight:4, opacity:0.85 }).addTo(routeLayer);
    leafletMap.fitBounds(poly.getBounds(), { padding:[30,30] });
  }
  const pts = [];
  allStops.forEach((entry, i) => {
    const item = entry.item;
    if (!item._lat) return;
    const label = entry.kind === 'ticket' ? escHtml(item.ticket.subject) : escHtml(item.titel || 'Afspraak');
    const addr  = entry.kind === 'ticket' ? item.address : (item.adres || item.notitie);
    L.marker([item._lat, item._lon], { icon: L.divIcon({
      html:`<div style="background:#f59e0b;color:#000;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;border:2px solid #000;box-shadow:0 2px 5px rgba(0,0,0,.4)">${i+1}</div>`,
      iconSize:[24,24], iconAnchor:[12,12], className:'',
    })}).bindPopup(`<b>#${i+1}</b> ${label}<br>${escHtml(addr || '')}`).addTo(routeLayer);
    pts.push([item._lat, item._lon]);
  });
  if (pts.length && !(routeData?.polyline?.length && currentRouteDate === date))
    leafletMap.fitBounds(L.latLngBounds(pts), { padding:[40,40] });
}
```
Zelfde marker-stijl voor beide types (geen visueel onderscheid gevraagd) — enkel label/adres in de popup verschilt naargelang `kind`.

## Fix C — geen herberekend uur voor al-vastgezette stops

**`renderRouteList()`'s aankomsttijd-blok** (index.html:3993-4012):
```js
  let arrivalTimes = [];
  if (hasRoute) {
    const [h, m] = (settings.vanTijd || '08:00').split(':').map(Number);
    let curMin = h * 60 + m;
    for (let i = 0; i < allStops.length; i++) {
      // Geen waypoint → geen echte leg; val terug op de bestaande 30-min-schatting.
      const legSec = (legIdx[i] !== undefined
        ? routeData.legs[legIdx[i]]?.travelTimeSeconds
        : undefined) ?? 30 * 60;
      curMin += Math.round(legSec / 60);
      arrivalTimes.push(curMin);
      const entry = allStops[i];
      if (entry.kind === 'ticket') {
        curMin += duurVoor(entry.item.ticket.id) || 60;
      } else {
        const ev = entry.item;
        curMin += (ev.uur && ev.einduur ? calcWerktijdMin(ev.uur, ev.einduur) : 0) || 60;
      }
    }
  }
```
wordt:
```js
  let arrivalTimes = [];
  if (hasRoute) {
    const [h, m] = (settings.vanTijd || '08:00').split(':').map(Number);
    let curMin = h * 60 + m;
    for (let i = 0; i < allStops.length; i++) {
      const entry = allStops[i];
      // Vastgezet tijdstip (via "Toewijzen" of "Datum/tijd wijzigen"): toon dat effectief
      // afgesproken uur i.p.v. de opgetelde rijtijd -- zelfde principe als
      // computeArrivalTimes() al toepast voor de Kalender/het Voorstel. Geen
      // botsingsdetectie (bewust, zie eerdere designdoc over computeArrivalTimes).
      const legSec = (legIdx[i] !== undefined
        ? routeData.legs[legIdx[i]]?.travelTimeSeconds
        : undefined) ?? 30 * 60;
      curMin = entry.uur ? timeStrToMin(entry.uur) : curMin + Math.round(legSec / 60);
      arrivalTimes.push(curMin);
      if (entry.kind === 'ticket') {
        curMin += duurVoor(entry.item.ticket.id) || 60;
      } else {
        const ev = entry.item;
        curMin += (ev.uur && ev.einduur ? calcWerktijdMin(ev.uur, ev.einduur) : 0) || 60;
      }
    }
  }
```
`entry.uur` bestaat al op elk item van `allStops` (`{kind, item, uur}`, zie de bestaande opbouw
vlak boven dit blok) — geen nieuwe data nodig. `timeStrToMin` bestaat al (index.html, naast
`minToTimeStr`).

De route/volgorde zelf (`allWpStops` in `calculateRoute()`, de polyline) verandert niet —
enkel het getoonde tijdstip per rij.

## Niet in scope

- Verkeerskleuring op de kaart (rood/oranje/groen) — apart, later traject, zoals afgesproken.
- Botsingsdetectie (wat als eerdere afspraken een vastgezet tijdstip onhaalbaar maken) —
  al eerder bewust uitgesteld, blijft zo.
- `routeData`/`currentRouteDate` invalideren wanneer `planning[date]` elders wijzigt (bv. via
  een reschedule terwijl de Route-tab al een route toonde) — bestaand, apart gedrag, niet
  aangeraakt in deze ronde.
