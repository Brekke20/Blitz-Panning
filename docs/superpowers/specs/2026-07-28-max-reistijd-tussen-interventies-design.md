# Max. reistijd tussen interventies (automatische planner)

**Datum:** 2026-07-28
**Status:** Approved, ready for implementation plan

## Aanleiding

Brent wil dat de automatische dagplanner (⚡ "Plan deze week", `autoPlan()`) technici forceert om interventies te groeperen: tussen 2 opeenvolgende interventies op dezelfde dag mag de **theoretische reistijd** (geen live verkeer, geen aanrijtijd naar de allereerste stop van de dag) maximaal een instelbaar aantal minuten bedragen (standaard 45).

**Huidig gedrag, uitgezocht in de code:** `autoPlan()` kiest per dag telkens de dichtstbijzijnde volgende interventie via een `fillScore` (prioriteitsgewicht × **rechte-lijn-afstand in km** × urgentiefactor, ~index.html:3554-3561) — er bestaat nergens een concept van "te ver om samen op een dag te zetten". De enige rem is de dagcapaciteit (`capacityForDay()`), gebaseerd op één gemiddelde reistijd-schatting voor de hele week, niet per paar interventies.

**Beslissingen uit het gesprek met Brent:**
- Geen live/actuele rijtijd (verkeer) — de "theoretische" rijtijd via het echte wegennet, dus TomTom's basis-reistijd (zonder de actuele-verkeer-vertraging die er in de Route-tabblad wél bovenop komt).
- Een interventie die nergens binnen de max-reistijd van een andere ligt, mag gewoon **als eerste (of enige) interventie van een nieuwe dag** dienen — de regel geldt pas vanaf de 2e interventie van een dag.
- Max-reistijd wordt een **instelling**, per technieker aanpasbaar (zelfde patroon als "Tijd per interventie"/"Max per dag").
- Geldt **enkel** bij de automatische planner — niet bij handmatig toewijzen (Wachtrij-tab, "Toewijzen"-knop, drag&drop).
- **Geen vaste pogingslimiet** (bv. "stop na 3 kandidaten"): de planner probeert de volledige overblijvende wachtrij voor die dag (dichtstbijzijnde eerst, op basis van de bestaande rechte-lijn-score), tot er een kandidaat binnen de max-reistijd gevonden wordt of de wachtrij op is. Reden: rechte-lijn-afstand is niet altijd representatief voor echte rijtijd in deze regio (Schelde, kanalen, grens met Nederland) — een vaste pogingslimiet zou net de gevallen missen waarvoor deze functie gebouwd wordt. Zie `[[project-maxreistijd-evaluatie]]`-geheugennotitie: dit wordt rond eind augustus 2026 geëvalueerd met Brent op basis van echt gebruik.

## Scope

- `public/index.html`: nieuwe instelling + wijziging aan `autoPlan()`'s fill-lus.
- `netlify/functions/route.js`: retry-met-backoff bij TomTom 429, zelfde patroon als de recent gefixte `optimize.js` — nodig omdat deze feature `/api/route` nu vaker na elkaar aanroept.
- Geen wijziging aan `calculateRoute()`/`optimizeRoute()` (Route-tabblad) — die herordenen enkel een al vastgelegde dagset, dit raakt enkel WELKE tickets samen op een dag komen.
- Geen wijziging aan handmatig toewijzen (Wachtrij-tab "Toewijzen", drag&drop) — expliciet buiten scope per Brent's keuze.

## 1. Nieuwe instelling: "Max. reistijd tussen interventies"

**`DEFAULT_SETTINGS`** (~index.html:1763-1770): nieuw veld `maxReistijdMin: 45`.

**Instellingen-modal HTML** (~index.html:1376-1379, naast het bestaande "Max interventies per dag"-veld):
```html
<div class="set-field">
  <label class="set-label">Max. reistijd tussen interventies (minuten)</label>
  <input class="set-input" id="set-maxreistijd" type="number" min="0" max="240" step="5" />
</div>
```
(`min="0"` toegestaan: op 0 zetten betekent in de praktijk "elke dag altijd maar 1 interventie" — een geldige, zij het extreme, keuze; geen speciale validatie nodig buiten de bestaande patronen.)

**`openSettings()`** (~index.html:4284-4288): extra regel `document.getElementById('set-maxreistijd').value = settings.maxReistijdMin;`

**`saveSettings()`** (~index.html:4310-4331): extra uitlezen/opslaan, zelfde patroon als `duur`/`max`:
```js
const maxReistijd = +document.getElementById('set-maxreistijd').value;
...
settings.maxReistijdMin = maxReistijd || DEFAULT_SETTINGS.maxReistijdMin;
```
Geen aparte validatie-toast nodig (0 is geldig, negatieve waarden zijn niet in te geven door de HTML `min="0"`).

## 2. `autoPlan()` — reistijd-check in de fill-lus

### Nieuwe helper: `travelTimeMin(from, to)`

Nieuwe kleine functie naast `autoPlan()` (module-scope), hergebruikt de bestaande `/api/route`-endpoint (geen backend-wijziging nodig voor deze functie zelf):
```js
async function travelTimeMin(from, to) {
  try {
    const res  = await fetch('/api/route', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ waypoints: [from, to] }),
    });
    const data = await res.json();
    const sec  = data.legs?.[0]?.travelTimeSeconds;
    return typeof sec === 'number' ? sec / 60 : null;
  } catch { return null; }
}
```
- Gebruikt `travelTimeSeconds` (de basis-rijtijd), **niet** `travelTimeWithTrafficSeconds` — dat is precies het verschil tussen "theoretische reistijd" (wat Brent vroeg) en de actuele-verkeer-tijd die de Route-tabblad wél toont.
- Geeft `null` terug bij eender welke fout (netwerkfout, TomTom-fout, ontbrekende data) — behandeld als "kan niet beoordelen, blokkeer niet" (fail-open, zie edge cases).

### Wijziging aan de fill-lus (~index.html:3607-3627)

Huidige code kiest altijd domweg de eerste (beste) kandidaat uit `fillPool`. Nieuw: probeer kandidaten in de bestaande volgorde (dichtstbijzijnd eerst, ongewijzigde `fillScore`-sortering) tot er een binnen de max-reistijd valt:

```js
let curLat = seed._lat, curLon = seed._lon;
let usedSlots = Math.ceil(duurVoor(seed.id) / settings.duurMinuten); // seed telt al mee — geen reistijd-check voor de seed zelf
while (usedSlots < day.cap && pool.length) {
  const fillPool = pool.filter(t => {
    if (kbBlocked(t.id, day.date)) return false;
    const pref = prefDayAvailable.get(t.id);
    if (pref && pref !== day.date) return false;
    return true;
  });
  if (!fillPool.length) break;
  fillPool.sort((a, b) => fillScore(a, curLat, curLon) - fillScore(b, curLat, curLon));

  // Probeer kandidaten in volgorde (dichtstbijzijnd eerst) tot er 1 binnen de
  // ingestelde max-reistijd valt. Geen vaste pogingslimiet — rechte-lijn-afstand is
  // niet altijd representatief voor echte rijtijd (zie designdoc), dus de hele
  // overblijvende wachtrij voor deze dag komt in aanmerking.
  let chosen = null;
  for (const candidate of fillPool) {
    if (!curLat || !curLon || !candidate._lat || !candidate._lon) { chosen = candidate; break; } // geen coords → kan niet checken, niet blokkeren
    const travelMin = await travelTimeMin({ lat: curLat, lon: curLon }, { lat: candidate._lat, lon: candidate._lon });
    if (travelMin === null || travelMin <= settings.maxReistijdMin) { chosen = candidate; break; }
  }
  if (!chosen) break; // niemand in de wachtrij past nog binnen de max-reistijd voor deze dag

  const chosenSlots = Math.ceil(duurVoor(chosen.id) / settings.duurMinuten);
  if (usedSlots + chosenSlots > day.cap) break; // ongewijzigd bestaand gedrag
  pool.splice(pool.indexOf(chosen), 1);
  dayTickets.push(chosen);
  usedSlots += chosenSlots;
  if (chosen._lat && chosen._lon) { curLat = chosen._lat; curLon = chosen._lon; }
}
```

**Belangrijk:** de bestaande capaciteitscheck (`usedSlots + chosenSlots > day.cap` → `break`) blijft volledig ongewijzigd en wordt nu gewoon toegepast op de kandidaat die de reistijd-check doorstond, in plaats van altijd op `fillPool[0]`. De seed (eerste interventie van de dag) doorloopt deze nieuwe lus niet — die wordt gekozen zoals vandaag, ongewijzigd (~index.html:3599-3604), wat exact overeenkomt met "aanrijtijd naar de eerste stop telt niet mee".

## 3. `netlify/functions/route.js` — retry bij TomTom 429

Deze feature roept `/api/route` nu potentieel meerdere keren na elkaar aan tijdens één "Plan deze week"-run (1 keer per interventie die effectief ingepland wordt, in het slechtste geval vaker als meerdere kandidaten na elkaar geprobeerd worden). Zelfde retry-met-backoff-patroon toevoegen als recent al in `optimize.js` gebeurde voor exact hetzelfde soort probleem (TomTom's rate-limit bij te veel aanvragen kort na elkaar):

```js
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchTomTomRoute(url, attempt = 1) {
  const res = await fetch(url);
  if (res.status === 429 && attempt <= 3) {
    await sleep(attempt * 400);
    return fetchTomTomRoute(url, attempt + 1);
  }
  return res;
}
```
En de bestaande `const res = await fetch(url);` (~route.js:39) vervangen door `const res = await fetchTomTomRoute(url);`.

## Edge cases

- **`travelTimeMin` geeft `null` terug (TomTom-fout, netwerkfout, ontbrekende coördinaten)**: de kandidaat wordt **niet geblokkeerd** (fail-open) — beter een keer een net-iets-te-verre interventie toch groeperen dan de hele automatische planning laten vastlopen op een tijdelijke TomTom-hik. Dit is bewust een minder strikte keuze dan "bij twijfel blokkeren"; als dit in de praktijk (zie evaluatie eind augustus) te vaak fout gokt, kan dit later omgedraaid worden.
- **Kandidaat zonder coördinaten** (geocoding mislukt voor dat ticket): zelfde fail-open behandeling — wordt gewoon gekozen zonder reistijd-check, exact zoals de bestaande `fillScore`'s `dist = 999`-fallback voor tickets zonder coords al doet (die komen dan wel achteraan in de sortering, maar worden niet uitgesloten).
- **Dag waar al interventies op staan** (`lastExisting`, ~index.html:3592-3597): de seed-keuze voor zo'n dag blijft ongewijzigd (geen reistijd-check), ook al is er strikt genomen al een "vorige interventie" die dag. Dit is de eenvoudigste, met de bestaande code meest consistente aanpak — een bewuste keuze, geen scope-uitbreiding.
- **`settings.maxReistijdMin` op 0**: elke fill-poging zal zo goed als altijd falen (tenzij twee adressen exact samenvallen) → elke dag krijgt in de praktijk maar 1 interventie. Geen technisch probleem, wel een expliciet mogelijke (extreme) instelling.
- **Performance/TomTom-belasting**: in het slechtste geval (weinig geografische clustering mogelijk) wordt de volledige wachtrij voor een dag doorlopen met telkens 1 `/api/route`-aanroep — begrensd door de wachtrijgrootte (typisch klein), en nu beschermd door de retry-met-backoff in `route.js`. Dit is precies het punt dat over een maand geëvalueerd wordt.

## Niet in scope

- Geen wijziging aan handmatig toewijzen/drag&drop (Wachtrij-tab) — enkel de automatische planner.
- Geen wijziging aan `calculateRoute()`/`optimizeRoute()` (Route-tabblad) — die blijven puur de volgorde/tijden binnen een al vastgelegde dagset berekenen.
- Geen vaste pogingslimiet — bewuste keuze, zie Aanleiding. Wordt rond eind augustus 2026 samen met Brent geëvalueerd op basis van echt gebruik.
- Geen matrix-achtige vooraf-berekening van alle onderlinge reistijden — de aanpak berekent enkel wat effectief nodig is tijdens het vullen van een dag.
