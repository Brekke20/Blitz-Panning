# Route-tab toont de echte geplande volgorde (sorteren op uur)

**Datum:** 2026-07-29
**Status:** Approved, ready for implementation

## Aanleiding

Brent: als afspraken die dag al een uur hebben (al ingepland zijn), wil hij in de Route-tab de route zien in de volgorde waarin ze effectief op de planning staan.

**Uitgezocht in de code:** `calculateRoute()`, `renderRouteList()` en `updateMap()` (index.html) gebruiken telkens gewoon de **toevoegvolgorde** van `planning[date]` — niet gesorteerd op `stop.uur`. Bovendien staan Zoho-tickets daar altijd vóór handmatige afspraken (`[...stops, ...localForDate]`), ongeacht welke van de twee eigenlijk eerder op de dag valt. De Kalender (`renderKalender()`'s `timeline`) doet dit al wél correct: die bouwt één gecombineerde lijst van tickets + afspraken + rapporten en sorteert die op `uur || '99:99'` (geen uur = achteraan).

## Wijziging

Dezelfde sorteerregel toepassen op de 3 functies die de Route-tab/kaart voeden, telkens vóór verder gebruik:

**`calculateRoute()`** (index.html:4127-4192) — de `allWpStops`-opbouw:
```js
const allWpStops = [
  ...stops.filter(p => p._lat),
  ...localForDate.filter(e => e._lat),
];
```
wordt:
```js
const allWpStops = [
  ...stops.filter(p => p._lat),
  ...localForDate.filter(e => e._lat),
].sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'));
```

**`renderRouteList()`** (index.html:3908-...) — de `allStops`-opbouw:
```js
const allStops = [
  ...stops.map(s => ({ kind: 'ticket', item: s })),
  ...localForDate.map(e => ({ kind: 'local', item: e })),
];
```
wordt:
```js
const allStops = [
  ...stops.map(s => ({ kind: 'ticket', item: s, uur: s.uur })),
  ...localForDate.map(e => ({ kind: 'local', item: e, uur: e.uur })),
].sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'));
```

**`updateMap()`** (index.html:4203-4224) — de `stops`-opbouw:
```js
const stops = (planning[date] || []).filter(p =>
  activeAssigneeFilter === 'all' || p.ticket.assignee === activeAssigneeFilter
);
```
wordt:
```js
const stops = (planning[date] || []).filter(p =>
  activeAssigneeFilter === 'all' || p.ticket.assignee === activeAssigneeFilter
).sort((a, b) => (a.uur || '99:99').localeCompare(b.uur || '99:99'));
```

## Waarom dit consistent blijft werken

`calculateRoute()` stuurt de waypoints naar `/api/route` in de gesorteerde volgorde (`allWpStops`). `renderRouteList()`'s `legIdx`-mapping (die bepaalt welke `routeData.legs[]`-rit bij welke rij hoort) loopt over `allStops` in **dezelfde** sorteervolgorde en telt enkel de items met coördinaten — omdat beide functies exact dezelfde sorteersleutel (`uur || '99:99'`) op conceptueel dezelfde onderliggende set toepassen, blijft de rit-naar-rij-koppeling correct. JavaScript's `sort()` is stabiel: bij gelijke sleutel (bv. twee items zonder uur) blijft de onderlinge volgorde behouden zoals ze in de brontabel stonden.

**Niet gewijzigd:** `planning[date]` zelf (de opslag) — enkel hoe de Route-tab/kaart die data weergeeft. De "Optimaliseren"-knop (`optimizeRoute()`) blijft een aparte, bewuste actie die de volgorde nog steeds mag herschikken voor een kortere route.

## Verificatie

Live in de browser (`?test`), een dag samenstellen met: een ticket zonder uur (autoPlan-stijl), een ticket met een later uur, een handmatige afspraak met een vroeger uur dan beide tickets. Bevestigen dat de Route-tab en de kaartnummering de afspraak met het vroegste uur eerst tonen, ongeacht toevoegvolgorde.
