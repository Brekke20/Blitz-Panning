# Vaste tijdstippen respecteren in de aankomsttijd-berekening

**Datum:** 2026-07-28
**Status:** Approved, ready for implementation plan

## Aanleiding

`computeArrivalTimes(date)` (index.html:4440-4468) berekent voor elke afspraak van een dag een geschatte aankomsttijd, gebruikt door:
- de "📨 Voorstel"-knop in het ticket-detailvenster (index.html:1353) — stelt een tijdstip voor om naar de klant te sturen;
- de "📅 Toewijzen"-rij (`toggleAssignRow()`, index.html:4768-4784) — vult het tijdstip-veld vooraf in met de berekende aankomsttijd.

De berekening loopt vandaag simpelweg van boven naar onder door de afspraken van die dag en telt telkens rijtijd + interventieduur op, startend vanaf `settings.vanTijd`. Ze houdt geen rekening met een reeds **vastgezet** tijdstip op een afspraak (via "Toewijzen" of de nieuwe "Datum/tijd wijzigen", zie `[[datum-tijd-wijzigen-ingepland-ticket-design]]`) — zo'n vast tijdstip wordt gewoon overschreven door de doorgerekende schatting, die daardoor compleet kan afwijken van de werkelijkheid.

**Voorbeeld:** dag heeft 3 afspraken A, B, C. B is manueel vastgezet op 14:00. De berekening rekent nu gewoon door: start 08:00 → rijtijd+duur A → schat voor B bv. 10:15 (in plaats van de vastgezette 14:00) → rekent vanaf die foute 10:15 verder voor C.

## Beslissing uit het gesprek met Brent

- Zodra de berekening een afspraak met een vastgezet tijdstip tegenkomt, "springt" ze naar dat tijdstip (i.p.v. de opgetelde rijtijd te gebruiken) en rekent nadien verder vanaf **vast tijdstip + duur van die interventie** voor de afspraken erna.
- **Geen botsingsdetectie in deze ronde**: als de afspraken vóór het vastgezette tijdstip eigenlijk te lang duren om het te halen (bv. berekening zegt dat de vorige afspraak pas om 14:30 klaar is, terwijl B vaststaat op 14:00), toont de app hierover geen waarschuwing — ze springt gewoon naar het vaste tijdstip. Brent wil dit expliciet **later** oppakken (waarschuwing + eventueel automatische correctie) — zie "Niet in scope" hieronder.

## Scope

- `public/index.html`: enkel `computeArrivalTimes()` + één nieuwe kleine helper. Geen wijziging aan de 2 call sites (`openProposal`, `toggleAssignRow`) — die consumeren gewoon de teruggegeven `{ticketId: minutenNaMiddernacht}`-map, ongewijzigd.
- Geen backend-wijziging.

## Wijziging

**Nieuwe helper** (naast het bestaande `minToTimeStr`, ~index.html:4431-4435):
```js
function timeStrToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
```

**`computeArrivalTimes(date)`** (index.html:4440-4468) — binnen de bestaande `for`-lus, vlak vóór `result[stops[i].ticket.id] = curMin;`:

Huidig:
```js
    if (isWaypoint) legIdx++;
    curMin += Math.round(legSec / 60);
    result[stops[i].ticket.id] = curMin;
    curMin += duurVoor(stops[i].ticket.id); // per-ticket duur override of standaard
```

Nieuw:
```js
    if (isWaypoint) legIdx++;
    // Vastgezet tijdstip (via "Toewijzen" of "Datum/tijd wijzigen"): de berekening
    // springt naar dat tijdstip i.p.v. de opgetelde rijtijd te gebruiken, en rekent
    // nadien verder vanaf vast-tijdstip + duur. Geen botsingsdetectie (zie designdoc)
    // — als eerdere afspraken dit tijdstip eigenlijk niet halen, wordt dat niet gemeld.
    curMin = stops[i].uur ? timeStrToMin(stops[i].uur) : curMin + Math.round(legSec / 60);
    result[stops[i].ticket.id] = curMin;
    curMin += duurVoor(stops[i].ticket.id); // per-ticket duur override of standaard
```

`stops[i].uur` is al de bestaande vlag voor "dit stop heeft een expliciet gekozen tijdstip" — gezet door `saveToewijzen()` en de nieuwe `saveReschedule()` (via `extractLocalHour()`), en afwezig (`null`/`undefined`) voor stops die enkel via `addTicketToDate()` (manueel "+Voeg toe" of automatische planner) aan een dag toegevoegd zijn. Geen nieuwe datastructuur nodig.

`legIdx` blijft ongewijzigd meetellen ook als de legSec-waarde niet gebruikt wordt voor een vastgezet stop — nodig om de leg-index gesynchroniseerd te houden met de waypoint-lijst voor de afspraken erna (bestaande logica, zie commentaar in de huidige code).

## Edge cases

- **Meerdere vastgezette tijdstippen op één dag**: werkt vanzelf — elk vastgezet stop is een nieuw "ankerpunt", de berekening rekent telkens vanaf het laatst tegengekomen ankerpunt (vast of berekend) verder.
- **Vastgezet tijdstip ligt vóór de berekende aankomst van de vorige afspraak** (de botsing): geen waarschuwing, geen correctie — bewuste keuze voor deze ronde, zie hieronder.

## Niet in scope (bewust, voor later)

- **Botsingsdetectie/-waarschuwing**: als de opgetelde tijd van de afspraken vóór een vastgezet tijdstip dat tijdstip zou overschrijden, wil Brent hier later een waarschuwing voor, en mogelijk een vorm van automatische correctie (bv. eerdere afspraken automatisch inkorten/verschuiven, of voorstellen om het vastgezette tijdstip aan te passen). Dit is bewust apart gehouden — vraagt een eigen ontwerp (wanneer waarschuwen, waar tonen, wat "automatisch oplossen" precies betekent) en wordt best als apart brainstorm-traject opgepakt zodra dit issue zich in de praktijk voordoet.
