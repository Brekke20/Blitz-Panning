# Historische reistijd + batch-opzoeking voor de max-reistijd-check

**Datum:** 2026-07-29
**Status:** Approved, ready for implementation plan
**Vervangt:** het reistijd-opzoekingsmechanisme (`travelTimeMin`/`pickNearbyCandidate`) uit
`docs/superpowers/specs/2026-07-28-max-reistijd-tussen-interventies-design.md` — de
instelling, `seedExempt`-logica en "geen pogingslimiet"-beslissing uit dat document blijven
ongewijzigd, enkel *hoe* de reistijd per kandidaat opgevraagd wordt verandert.

## Aanleiding

Sinds de max-reistijd-feature (2026-07-28) gebruikt de check `noTrafficTravelTimeSeconds`
(TomTom) — de rijtijd alsof er nooit file is. Brent vroeg of een realistischer, "typisch"
verkeersbeeld mogelijk is (zoals Google Maps' geschatte reistijd), en of de manier waarop de
planner dit per kandidaat-ticket opvraagt wel efficiënt genoeg is.

**Onderzoek (met bronnen):**

- TomTom's Calculate Route API heeft een apart veld `historicTrafficTravelTimeInSeconds`
  — "de geschatte reistijd berekend met tijdsafhankelijke historische verkeersdata", dus
  exact de middenweg tussen "nooit file" en "verkeer op dit letterlijke moment"
  ([TomTom docs](https://docs.tomtom.com/routing-api/documentation/tomtom-maps/calculate-route)).
- Dit hangt af van een meegegeven vertrekmoment (`departAt`) — professionele routeplanners
  lossen dit "welk uur nemen we aan"-probleem op via een **lopend geschat uur**: de rit naar
  stop 1 wordt berekend vanaf een gekend vertrekuur, wat een geschat aankomstuur bij stop 1
  oplevert; dát uur bepaalt vervolgens welk verkeersbeeld gebruikt wordt voor de rit naar stop
  2, enzovoort. Dit is een gevestigde aanpak in de vakliteratuur over het
  "Time-Dependent Vehicle Routing Problem" (TDVRP), al onderzocht sinds Malandraki & Daskin
  (1992) ([Transportation Science](https://pubsonline.informs.org/doi/10.1287/trsc.26.3.185)).
- Brent's terechte zorg: als de planner dit per kandidaat-ticket apart moet opvragen
  (zoals de huidige `pickNearbyCandidate` doet), kost dat bij een lange wachtrij
  onnodig veel opeenvolgende aanvragen/tijd. TomTom heeft hiervoor een **Matrix Routing
  v2 API**: 1 aanvraag met 1 vertrekpunt + N bestemmingen geeft alle N reistijden in
  één keer terug (tot 2500 combinaties synchroon)
  ([TomTom docs](https://developer.tomtom.com/routing-api/documentation/matrix-routing-v2/matrix-routing-v2-service)).
  Deze API staat bovendien standaard op `"traffic": "historical"` — exact wat we nodig
  hebben, zonder tussen meerdere teruggegeven velden te moeten kiezen (zoals bij
  Calculate Route).
- **Geverifieerd**: onze bestaande `TOMTOM_API_KEY` heeft effectief toegang tot deze
  Matrix-API — een echte testaanroep (Kruibeke → Antwerpen, 1 origin, 2 destinations)
  gaf `HTTP 200` met geldige reistijd-/afstandsdata terug.

## Scope

- Nieuw bestand: `netlify/functions/matrix.js`.
- Wijziging in `public/index.html`: `travelTimeMin`/`pickNearbyCandidate` (index.html:3489-3514)
  vervangen door een batch-gebaseerde versie, en de dag-lus in `autoPlan()`
  (index.html:3640-3702) uitgebreid met een lopend geschat uur (`curTimeOfDay`) per dag.
- `netlify/functions/route.js` blijft ongewijzigd (nog steeds gebruikt door
  `calculateRoute()`/Route-tab en autoPlan's eigen capaciteits-rijtijdschatting — beide
  buiten scope). De `noTrafficTravelTimeSeconds`-toevoeging van gisteren wordt niet
  verwijderd (onschadelijk, mogelijk later elders bruikbaar), maar is na deze wijziging
  niet langer in gebruik voor de max-reistijd-check specifiek.

## 1. Nieuw endpoint: `netlify/functions/matrix.js`

```js
// /api/matrix  (POST)
// Body: { origin: {lat, lon}, destinations: [{lat, lon}, ...], departAt: ISO-string }
// Geeft voor elke destination de historische reistijd + afstand terug, via TomTom's
// Matrix Routing v2 API -- 1 aanvraag voor N bestemmingen i.p.v. N losse /api/route-
// aanvragen (nodig omdat de max-reistijd-check anders per kandidaat-ticket een aparte,
// sequentiële aanvraag zou doen -- traag bij een lange wachtrij).

const TOMTOM_BASE = 'https://api.tomtom.com';
const API_KEY = () => process.env.TOMTOM_API_KEY;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchTomTomMatrix(body, attempt = 1) {
  const res = await fetch(`${TOMTOM_BASE}/routing/matrix/2?key=${API_KEY()}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (res.status === 429 && attempt <= 3) {
    await sleep(attempt * 400);
    return fetchTomTomMatrix(body, attempt + 1);
  }
  return res;
}

export async function handler(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { origin, destinations, departAt } = JSON.parse(event.body || '{}');
    if (!origin || !destinations?.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'origin en destinations zijn verplicht' }) };
    }

    const body = {
      origins:      [{ point: { latitude: origin.lat, longitude: origin.lon } }],
      destinations: destinations.map(d => ({ point: { latitude: d.lat, longitude: d.lon } })),
      options: {
        departAt:   departAt || 'any',
        traffic:    'historical',
        travelMode: 'car',
      },
    };

    const res  = await fetchTomTomMatrix(body);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.description || `TomTom Matrix-fout (${res.status})`);

    // Terugmappen naar de originele destination-volgorde via destinationIndex (niet
    // aannemen dat de teruggegeven array al in volgorde staat). Een individuele mislukte
    // cel (bv. onbereikbaar adres) geeft null -- de aanroeper behandelt dit fail-open.
    const results = destinations.map((_, i) => {
      const cell    = data.data?.find(c => c.destinationIndex === i);
      const summary = cell?.routeSummary;
      return summary
        ? { travelTimeSeconds: summary.travelTimeInSeconds, distanceMeters: summary.lengthInMeters }
        : null;
    });

    return { statusCode: 200, headers, body: JSON.stringify({ results }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
```

## 2. Frontend: batch-opzoeking i.p.v. losse aanvragen per kandidaat

**Vervangt** `travelTimeMin`/`pickNearbyCandidate` (index.html:3489-3514):

```js
// Vraagt in 1 aanvraag de historische reistijd op vanaf (fromLat, fromLon) naar alle
// candidates tegelijk (TomTom Matrix Routing API), voor het gegeven vertrekmoment.
// Geeft een Map terug: candidate.id → reistijd in minuten. Kandidaten zonder coords, of
// waarvoor de batch geen resultaat gaf (individuele mislukking), komen niet in de Map --
// de aanroeper behandelt dat fail-open.
async function batchTravelTimes(candidates, fromLat, fromLon, departAtIso) {
  const withCoords = candidates.filter(c => c._lat && c._lon);
  if (!fromLat || !fromLon || !withCoords.length) return new Map();
  try {
    const res  = await fetch('/api/matrix', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        origin:       { lat: fromLat, lon: fromLon },
        destinations: withCoords.map(c => ({ lat: c._lat, lon: c._lon })),
        departAt:     departAtIso,
      }),
    });
    const data = await res.json();
    const map = new Map();
    (data.results || []).forEach((r, i) => {
      if (typeof r?.travelTimeSeconds === 'number') map.set(withCoords[i].id, r.travelTimeSeconds / 60);
    });
    return map;
  } catch { return new Map(); }
}

// Doorloopt candidates in de gegeven (reeds op fillScore gesorteerde) volgorde en geeft de
// eerste terug die binnen settings.maxReistijdMin ligt t.o.v. (fromLat, fromLon), samen met
// de effectieve reistijd (om het lopend geschat uur bij te werken). Geen vaste
// pogingslimiet: de hele lijst komt in aanmerking (ongewijzigd t.o.v. het vorige ontwerp).
// Fail-open: kandidaten zonder coords, of zonder batch-resultaat, worden meteen aanvaard.
async function pickNearbyCandidate(candidates, fromLat, fromLon, departAtIso) {
  const times = await batchTravelTimes(candidates, fromLat, fromLon, departAtIso);
  for (const candidate of candidates) {
    if (!fromLat || !fromLon || !candidate._lat || !candidate._lon) return { candidate, legMin: 0 };
    const legMin = times.get(candidate.id);
    if (legMin === undefined || legMin <= settings.maxReistijdMin) return { candidate, legMin: legMin ?? 0 };
  }
  return null;
}

// Zet minuten-na-middernacht om naar een ISO-datetime voor de gegeven dag, voor gebruik als
// departAt bij de historische-reistijd-opzoeking hierboven.
function minToDepartAt(dateStr, minutesSinceMidnight) {
  const h = Math.floor(minutesSinceMidnight / 60) % 24;
  const m = Math.floor(minutesSinceMidnight) % 60;
  return new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`).toISOString();
}
```

`timeStrToMin`/`minToTimeStr` (index.html:4583-4592, al aanwezig sinds de
vaste-tijdstippen-fix) worden hergebruikt, geen nieuwe datum/tijd-helpers nodig buiten
`minToDepartAt` hierboven.

## 3. `autoPlan()`'s dag-lus: lopend geschat uur

Wijziging binnen de bestaande dag-`for`-lus (index.html:3640-3702). Na de bestaande
`existingOnDay`/`lastExisting`/`anchorLat`/`anchorLon`/`startLat`/`startLon`-berekening
(ongewijzigd), komt er een nieuw `curTimeOfDay`, en de seed-/fill-selectie roept
`pickNearbyCandidate` nu met een `departAt` aan:

```js
      // Lopend geschat uur voor deze dag (minuten na middernacht), voor de historische-
      // reistijd-opzoeking. Start bij het bestaande ticket zijn eigen uur + duur indien
      // gekend; anders (lege dag, of bestaand ticket zonder gekend uur) bij de ingestelde
      // starttijd -- een bewuste benadering, zie edge cases hieronder.
      const [vanH, vanM] = (settings.vanTijd || '08:00').split(':').map(Number);
      let curTimeOfDay = lastExisting?.uur
        ? timeStrToMin(lastExisting.uur) + duurVoor(lastExisting.ticket.id)
        : vanH * 60 + vanM;

      const seedPool = [...dayPool];
      seedPool.sort((a, b) => fillScore(a, startLat, startLon) - fillScore(b, startLat, startLon));
      if (!seedPool.length) continue;
      const seedExempt = !lastExisting || anchorLat == null || anchorLon == null;
      let seed;
      if (seedExempt) {
        seed = seedPool[0];
      } else {
        const result = await pickNearbyCandidate(seedPool, startLat, startLon, minToDepartAt(day.date, curTimeOfDay));
        if (!result) continue; // dag heeft al een ticket, maar niemand past binnen de max-reistijd
        seed = result.candidate;
        curTimeOfDay += result.legMin;
      }
      pool.splice(pool.indexOf(seed), 1);
      const dayTickets = [seed];
      curTimeOfDay += duurVoor(seed.id);

      let curLat = seed._lat, curLon = seed._lon;
      let usedSlots = Math.ceil(duurVoor(seed.id) / settings.duurMinuten);
      while (usedSlots < day.cap && pool.length) {
        const fillPool = pool.filter(t => {
          if (kbBlocked(t.id, day.date)) return false;
          const pref = prefDayAvailable.get(t.id);
          if (pref && pref !== day.date) return false;
          return true;
        });
        if (!fillPool.length) break;
        fillPool.sort((a, b) => fillScore(a, curLat, curLon) - fillScore(b, curLat, curLon));
        const result = await pickNearbyCandidate(fillPool, curLat, curLon, minToDepartAt(day.date, curTimeOfDay));
        if (!result) break; // niemand in de wachtrij past nog binnen de max-reistijd voor deze dag
        const chosen = result.candidate;
        const chosenSlots = Math.ceil(duurVoor(chosen.id) / settings.duurMinuten);
        if (usedSlots + chosenSlots > day.cap) break;
        pool.splice(pool.indexOf(chosen), 1);
        dayTickets.push(chosen);
        usedSlots += chosenSlots;
        curTimeOfDay += result.legMin + duurVoor(chosen.id);
        if (chosen._lat && chosen._lon) { curLat = chosen._lat; curLon = chosen._lon; }
      }
```

De rest van de dag-lus (capaciteitscheck, `mislukt`/`geplande`/`overflow`-afhandeling)
blijft ongewijzigd.

## Edge cases

- **Bestaand ticket zonder gekend uur** (autoPlan-geplaatst zonder specifiek tijdstip):
  `curTimeOfDay` valt terug op `settings.vanTijd` — een bewuste benadering (we weten het
  echte uur niet), geen poging tot een preciezere schatting via `computeArrivalTimes()`-
  stijl reconstructie. Kan later verfijnd worden als dit in de praktijk te grof blijkt.
- **Kandidaat zonder coördinaten, of batch-aanvraag mislukt**: fail-open zoals voorheen —
  de kandidaat wordt aanvaard, en `legMin` valt terug op `0` (het lopend uur schuift dan
  niet op voor die stap — een lichte onderschatting, maar consistent met "niet blokkeren
  bij onzekerheid").
- **Matrix-aanvraag geeft een individuele cel-fout terug** (bv. één kandidaat-adres
  onbereikbaar): die ene kandidaat krijgt geen entry in de Map en wordt dus, net als
  "geen coords", fail-open aanvaard — de rest van de batch blijft bruikbaar.
- **Matrix-grootte**: origins is altijd 1, destinations is de resterende wachtrij voor die
  dag (in de praktijk hooguit enkele tientallen) — ruim binnen de synchrone limiet van 2500
  combinaties.

## Niet in scope

- Geen wijziging aan `calculateRoute()`/Route-tab of autoPlan's eigen
  capaciteits-rijtijdschatting (`travelMin` voor `capacityForDay()`) — die blijven de
  bestaande `/api/route`-aanpak gebruiken.
- Geen verwijdering van `route.js`'s `noTrafficTravelTimeSeconds`-veld — onschadelijk laten
  staan i.p.v. onnodige bestandswijziging.
- Geen wijziging aan de instelling, `seedExempt`-logica, of de "geen pogingslimiet"-regel
  zelf — enkel de manier waarop de reistijd per kandidaat opgevraagd wordt.
