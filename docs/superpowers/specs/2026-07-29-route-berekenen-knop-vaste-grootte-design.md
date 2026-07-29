# "Route berekenen"-knop: vaste grootte + verplaatsen naar boven

**Datum:** 2026-07-29
**Status:** Approved, ready for implementation plan

## Aanleiding

De "Route berekenen"-knop in elke dagkolom van de Kalender schaalt mee in grootte met de interventiekaarten ernaast — in dagen met weinig interventies wordt hij een groot, opvallend groen blok (zie screenshot van Brent). Brent wil een vaste grootte, en oppert om de knop te verplaatsen naar net onder de dag-header (bovenaan de kolom) i.p.v. onderaan na alle kaarten.

**Oorzaak, uitgezocht in de code:** de knop hergebruikt de CSS-klasse `.cal-btn` (index.html:540-546), die `flex: 1` bevat — correct voor het oorspronkelijke gebruik (de "Bellen"/"Navigeer"-knoppen naast elkaar in `.cal-actions`, een horizontale flex-rij, waar `flex:1` de breedte gelijk verdeelt). De Route-knop wordt echter toegevoegd als rechtstreeks kind van `.day-body` (index.html:502), een **verticale** flex-kolom (`flex-direction: column`). In die context betekent `flex:1` "vul de overblijvende hoogte op" — vandaar het grote blok.

## Wijziging

**`renderKalender()`** (index.html:2431-2443), huidige code:
```js
    // Route knop als er stops zijn
    if (dayStops.length > 0 || dayEvents.some(e => e.adres || e.notitie)) {
      const rb = document.createElement('button');
      rb.className = 'cal-btn desktop-only';
      rb.style.cssText = 'width:100%;margin-top:4px;background:var(--accent-dim);border:1px solid rgba(245,158,11,0.2);color:var(--accent);padding:4px;border-radius:4px;cursor:pointer;font-size:0.7rem;font-weight:600;font-family:inherit;';
      rb.textContent = 'Route berekenen';
      rb.onclick = () => {
        document.getElementById('plan-date').value = dateStr;
        setTab('planning');
        renderRouteList(dateStr);
      };
      col.querySelector('.day-body').appendChild(rb);
    }
```

Wordt:
```js
    // Route knop als er stops zijn — bovenaan de kolom, vaste grootte (geen flex-grow,
    // anders vult hij in .day-body (een verticale flex-kolom) alle overblijvende hoogte
    // op — dat is exact de bug die dit oploste).
    if (dayStops.length > 0 || dayEvents.some(e => e.adres || e.notitie)) {
      const rb = document.createElement('button');
      rb.className = 'cal-btn desktop-only';
      rb.style.cssText = 'flex:none;width:100%;margin-bottom:4px;background:var(--accent-dim);border:1px solid rgba(245,158,11,0.2);color:var(--accent);padding:4px;border-radius:4px;cursor:pointer;font-size:0.7rem;font-weight:600;font-family:inherit;';
      rb.textContent = 'Route berekenen';
      rb.onclick = () => {
        document.getElementById('plan-date').value = dateStr;
        setTab('planning');
        renderRouteList(dateStr);
      };
      col.querySelector('.day-body').prepend(rb);
    }
```

Twee wijzigingen aan de inline stijl/plaatsing:
- `flex:none` toegevoegd (neutraliseert de overgeërfde `flex:1` van `.cal-btn`) — dit is de eigenlijke bugfix.
- `margin-top:4px` → `margin-bottom:4px` en `appendChild` → `prepend`, zodat de knop bovenaan de kolom verschijnt (net onder de dag-header, die zelf buiten `.day-body` staat) i.p.v. onderaan na alle kaarten.

De zichtbaarheidsvoorwaarde (`dayStops.length > 0 || ...`) blijft exact hetzelfde.

## Niet in scope

- Geen wijziging aan `.cal-btn` zelf (die klasse wordt op veel andere plaatsen correct gebruikt in horizontale context — een wijziging daar zou dat breken). De fix zit uitsluitend in de inline stijl van de Route-knop.
- Geen wijziging aan de route-berekeningslogica zelf (`renderRouteList`, `calculateRoute`, `optimizeRoute`) — enkel plaatsing/grootte van de knop.
