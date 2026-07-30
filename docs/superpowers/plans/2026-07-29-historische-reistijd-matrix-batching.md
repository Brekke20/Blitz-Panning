# Historische reistijd + Matrix-batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vervang de sequentiële, per-kandidaat `/api/route`-aanroepen in `autoPlan()`'s max-reistijd-check door één TomTom Matrix Routing-aanvraag per planningsstap, gebruik makend van historisch (typisch) verkeer op basis van een lopend geschat uur per dag, i.p.v. de huidige "nooit file"-aanname.

**Architecture:** Eén nieuwe Netlify-functie (`netlify/functions/matrix.js`) proxieert TomTom's Matrix Routing v2 API (1 origin, N destinations, `traffic: "historical"`). De frontend (`public/index.html`) vervangt `travelTimeMin`/`pickNearbyCandidate` (sequentieel, geen historisch verkeer) door nieuwe versies die deze batch-aanvraag gebruiken, en `autoPlan()`'s dag-lus houdt een lopend geschat uur (`curTimeOfDay`) bij zodat elke opzoeking het juiste moment van de dag gebruikt.

**Tech Stack:** Vanilla JS (geen build-stap, geen modules), Netlify Functions (classic `handler(event)`-stijl), TomTom Matrix Routing v2 API. Geen testframework in dit project — verificatie via de lokale dev server (`node dev-server.mjs`, poort 3333, `.env.local` bevat een geldige `TOMTOM_API_KEY` met bevestigde toegang tot de Matrix-API) en live browserverificatie.

## Global Constraints

- Dit vervangt bestaande, al-geshipte code (`travelTimeMin`/`pickNearbyCandidate`) — die functies moeten na Task 2 volledig verdwenen zijn, niet als dode code blijven staan.
- Geen wijziging aan `calculateRoute()`/Route-tab of autoPlan's eigen capaciteits-rijtijdschatting (`travelMin` voor `capacityForDay()`) — die blijven `/api/route` gebruiken, buiten scope.
- `netlify/functions/route.js` blijft ongewijzigd (inclusief zijn `noTrafficTravelTimeSeconds`-veld, dat na deze taken niet meer gebruikt wordt voor de max-reistijd-check maar bewust niet verwijderd wordt).
- De instelling (`settings.maxReistijdMin`), de `seedExempt`-logica en de "geen vaste pogingslimiet"-regel blijven functioneel ongewijzigd — enkel de manier waarop de reistijd per kandidaat opgevraagd wordt verandert.
- `timeStrToMin`/`minToTimeStr` bestaan al (`public/index.html:4583-4592`) en worden hergebruikt — niet opnieuw aanmaken.

---

## Task 1: Nieuw endpoint `netlify/functions/matrix.js`

**Spec:** `docs/superpowers/specs/2026-07-29-historische-reistijd-max-reistijd-design.md`, sectie 1.

**Files:**
- Create: `netlify/functions/matrix.js`

**Interfaces:**
- Consumes: niets nieuws — leest `process.env.TOMTOM_API_KEY` (al aanwezig, gebruikt door `optimize.js`/`route.js`).
- Produces: `POST /api/matrix` — body `{ origin: {lat, lon}, destinations: [{lat, lon}, ...], departAt?: string }`, response `{ results: [{ travelTimeSeconds, distanceMeters } | null, ...] }` (zelfde lengte en volgorde als `destinations`). Dit endpoint wordt in Task 2 geconsumeerd door de nieuwe `batchTravelTimes()`-functie in `public/index.html`.

- [ ] **Step 1: Bestand aanmaken met de volledige implementatie**

Schrijf `netlify/functions/matrix.js`:
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

- [ ] **Step 2: Verifieer met een echte aanvraag tegen het lokale endpoint**

Start de dev server (leest `.env.local` voor `TOMTOM_API_KEY`, die al bevestigd toegang heeft tot de Matrix-API):
```bash
node dev-server.mjs
```
Roep het endpoint rechtstreeks aan (bv. via de browserconsole op `http://localhost:3333`, of `curl` vanaf een terminal):
```js
fetch('/api/matrix', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    origin: { lat: 51.1739, lon: 4.3181 },       // Kruibeke
    destinations: [
      { lat: 51.2194, lon: 4.4025 },              // Antwerpen
      { lat: 51.1750, lon: 4.3190 },              // vlakbij
    ],
    departAt: '2026-08-04T10:00:00.000Z',
  }),
}).then(r => r.json()).then(console.log);
```
Verwacht: `{ results: [ { travelTimeSeconds: <getal>, distanceMeters: <getal> }, { travelTimeSeconds: <getal>, distanceMeters: <getal> } ] }` — 2 entries, in dezelfde volgorde als de opgegeven `destinations` (Antwerpen eerst, met een reistijd van ongeveer 20-25 minuten; het nabije punt met een veel kortere tijd).

Test ook de foutafhandeling: roep aan zonder `destinations` en bevestig `{ error: 'origin en destinations zijn verplicht' }` met status 400.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/matrix.js
git commit -m "$(cat <<'EOF'
feat: nieuw /api/matrix-endpoint voor batch-reistijdopzoeking

Proxieert TomTom's Matrix Routing v2 API (traffic: historical) -- geeft
in 1 aanvraag de reistijd naar meerdere bestemmingen tegelijk terug,
i.p.v. een aparte /api/route-aanroep per bestemming. Nog niet
geconsumeerd door de frontend -- dat volgt in de volgende taak.
EOF
)"
```

---

## Task 2: Frontend — batch-opzoeking + lopend geschat uur in `autoPlan()`

**Spec:** `docs/superpowers/specs/2026-07-29-historische-reistijd-max-reistijd-design.md`, secties 2 en 3.

**Files:**
- Modify: `public/index.html:3489-3514` (`travelTimeMin`/`pickNearbyCandidate` — volledig vervangen)
- Modify: `public/index.html:3640-3702` (`autoPlan()`'s dag-lus — seed-/fill-selectie + `curTimeOfDay`)

**Interfaces:**
- Consumes: `POST /api/matrix` (Task 1), bestaande `timeStrToMin(hhmm)`/`minToTimeStr(min)` (`public/index.html:4583-4592`), `settings.maxReistijdMin`, `duurVoor(id)`, `fillScore`, `kbBlocked`, `prefDayAvailable`.
- Produces: `batchTravelTimes(candidates, fromLat, fromLon, departAtIso): Promise<Map<ticketId, minutes>>`, `pickNearbyCandidate(candidates, fromLat, fromLon, departAtIso): Promise<{candidate, legMin} | null>` (**gewijzigde signature en returnwaarde** t.o.v. de huidige versie — geen enkele andere plaats in de codebase roept dit vandaag aan buiten `autoPlan()` zelf), `minToDepartAt(dateStr, minutesSinceMidnight): string`.

### Stap A — nieuwe helpers

- [ ] **Step 1: Lees de huidige code ter controle**

Bevestig dat `public/index.html:3489-3514` nog overeenkomt met:
```js
async function travelTimeMin(from, to) {
  try {
    const res  = await fetch('/api/route', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ waypoints: [from, to] }),
    });
    const data = await res.json();
    const sec  = data.legs?.[0]?.noTrafficTravelTimeSeconds ?? data.legs?.[0]?.travelTimeSeconds;
    return typeof sec === 'number' ? sec / 60 : null;
  } catch { return null; }
}

// Doorloopt candidates in de gegeven (reeds op fillScore gesorteerde) volgorde en
// geeft de eerste terug die binnen settings.maxReistijdMin ligt t.o.v. (fromLat, fromLon).
// Geen vaste pogingslimiet: de hele lijst komt in aanmerking (zie designdoc voor de reden
// — rechte-lijn-afstand is niet altijd representatief voor echte rijtijd in deze regio).
// Fail-open bij ontbrekende coords of een mislukte /api/route-aanroep: blokkeert niet.
async function pickNearbyCandidate(candidates, fromLat, fromLon) {
  for (const candidate of candidates) {
    if (!fromLat || !fromLon || !candidate._lat || !candidate._lon) return candidate;
    const travelMin = await travelTimeMin({ lat: fromLat, lon: fromLon }, { lat: candidate._lat, lon: candidate._lon });
    if (travelMin === null || travelMin <= settings.maxReistijdMin) return candidate;
  }
  return null;
}
```
Als de inhoud afwijkt, zoek op `async function travelTimeMin` en `async function pickNearbyCandidate`.

- [ ] **Step 2: Vervang volledig door de nieuwe helpers**

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

### Stap B — `autoPlan()`'s dag-lus

- [ ] **Step 3: Lees de huidige dag-lus ter controle**

Bevestig dat `public/index.html:3640-3702` nog overeenkomt met:
```js
    for (const day of availDays) {
      if (!pool.length) break;

      const dayPool = pool.filter(t => {
        if (kbBlocked(t.id, day.date)) return false;
        const pref = prefDayAvailable.get(t.id);
        if (pref && pref !== day.date) return false;
        return true;
      });

      const existingOnDay = (planning[day.date] || []).filter(p =>
        activeAssigneeFilter === 'all' || p.ticket.assignee === activeAssigneeFilter
      );
      const lastExisting = existingOnDay[existingOnDay.length - 1];
      const anchorLat = lastExisting?._lat ?? lastExisting?.ticket?._lat ?? null;
      const anchorLon = lastExisting?._lon ?? lastExisting?.ticket?._lon ?? null;
      const startLat  = anchorLat ?? originCoords?.lat ?? null;
      const startLon  = anchorLon ?? originCoords?.lon ?? null;

      const seedPool = [...dayPool];
      seedPool.sort((a, b) => fillScore(a, startLat, startLon) - fillScore(b, startLat, startLon));
      if (!seedPool.length) continue;
      const seedExempt = !lastExisting || anchorLat == null || anchorLon == null;
      const seed = seedExempt ? seedPool[0] : await pickNearbyCandidate(seedPool, startLat, startLon);
      if (!seed) continue;
      pool.splice(pool.indexOf(seed), 1);
      const dayTickets = [seed];

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
        const chosen = await pickNearbyCandidate(fillPool, curLat, curLon);
        if (!chosen) break;
        const chosenSlots = Math.ceil(duurVoor(chosen.id) / settings.duurMinuten);
        if (usedSlots + chosenSlots > day.cap) break;
        pool.splice(pool.indexOf(chosen), 1);
        dayTickets.push(chosen);
        usedSlots += chosenSlots;
        if (chosen._lat && chosen._lon) { curLat = chosen._lat; curLon = chosen._lon; }
      }
```
Als de inhoud afwijkt, zoek op de commentaarregel `// ── Fix 2: Geografisch seeden` binnen `function autoPlan()`.

- [ ] **Step 4: Vervang de seed-/fill-selectie en voeg `curTimeOfDay` toe**

Vervang het hele blok hierboven (van `const seedPool = [...dayPool];` tot en met de sluitende `}` van de `while`-lus) door:

```js
      // Lopend geschat uur voor deze dag (minuten na middernacht), voor de historische-
      // reistijd-opzoeking. Start bij het bestaande ticket zijn eigen uur + duur indien
      // gekend; anders (lege dag, of bestaand ticket zonder gekend uur) bij de ingestelde
      // starttijd -- een bewuste benadering, zie designdoc.
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

De rest van de dag-lus (het `mislukt`/`geplande`/`overflow`-blok na de `while`-lus) blijft ongewijzigd — enkel het stuk tussen `const seedPool = ...` en het einde van de `while`-lus wordt vervangen.

- [ ] **Step 5: Defensieve controle — bevestig dat de oude functies volledig verdwenen zijn**

```bash
grep -n "function travelTimeMin\b" public/index.html
```
Verwacht: **geen output** (0 matches) — de oude `travelTimeMin` bestaat niet meer als aparte functie (enkel binnen `batchTravelTimes` wordt nu rechtstreeks `/api/matrix` aangeroepen). Bevestig ook:
```bash
grep -n "async function pickNearbyCandidate\|async function batchTravelTimes\|function minToDepartAt" public/index.html
```
Verwacht: exact 3 matches, telkens 1 keer.

- [ ] **Step 6: Verifieer in de browser met echte coördinaten**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Omdat `autoPlan()`'s geocoding-stap in test-modus wordt overgeslagen (geen `_lat`/`_lon` op de dummy-tickets), test de nieuwe logica rechtstreeks via de console, zoals bij de vorige ronde van deze feature:

```js
// Zet settings.maxReistijdMin laag zodat de check effectief iets uitsluit.
settings.maxReistijdMin = 20;
const origin = { lat: 51.1739, lon: 4.3181 };    // Kruibeke
const near   = { id: 'matrixNear', _lat: 51.1750, _lon: 4.3190 };
const far    = { id: 'matrixFar',  _lat: 51.2194, _lon: 4.4025 }; // ~24 min, te ver
const departAtIso = minToDepartAt('2026-08-04', 10 * 60); // 10:00
pickNearbyCandidate([far, near], origin.lat, origin.lon, departAtIso).then(result => {
  window.__matrixTestResult = result;
  console.log('pickNearbyCandidate resultaat:', result);
});
```
Verwacht: `result.candidate.id === 'near'` (far wordt terecht overgeslagen), en `result.legMin` is een klein, plausibel getal (rijtijd naar het nabije punt).

Controleer via `read_network_requests` (filter op `/api/matrix`) dat er voor deze aanroep **precies 1** POST naar `/api/matrix` gebeurde (niet 2 losse aanroepen naar `/api/route` zoals voorheen) — dit is de kernverbetering van deze feature.

Reset nadien `settings.maxReistijdMin` terug naar de standaardwaarde (45) als die per ongeluk gewijzigd is opgeslagen.

- [ ] **Step 7: Regressietest — een normale planningsronde met standaardinstellingen**

Nog steeds in `?test`-modus: bevestig dat `autoPlan()` (via de "⚡ Plan deze week"-knop of rechtstreeks `autoPlan()` in de console) nog steeds normaal doorloopt zonder JavaScript-fouten, en dat de addresseerbare pending tickets ingepland worden (niet allemaal naar overflow geduwd) — zelfde controle als bij de vorige ronde van deze feature. Controleer de console op fouten (`read_console_messages`, `onlyErrors: true`).

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
feat: historische reistijd + batch-opzoeking in max-reistijd-check

Vervangt de sequentiële /api/route-aanroep-per-kandidaat (travelTimeMin/
pickNearbyCandidate) door 1 aanvraag naar het nieuwe /api/matrix-endpoint
per planningsstap, met een lopend geschat uur per dag (curTimeOfDay)
zodat de historische-verkeer-opzoeking het juiste moment van de dag
gebruikt -- zelfde aanpak als professionele routeplanners (Time-Dependent
Vehicle Routing Problem), zie designdoc voor de onderbouwing. De
instelling, seedExempt-logica en "geen pogingslimiet"-regel blijven
functioneel ongewijzigd.
EOF
)"
```

---

## Eindcontrole (na beide taken)

- [ ] **Volledige regressietest in de browser**, via `node dev-server.mjs` met `?test`: open de Kalender (geen consolefouten), open Instellingen en bevestig dat "Max. reistijd tussen interventies" nog steeds 45 toont en normaal opslaat, en draai "⚡ Plan deze week" nog een laatste keer met de standaardinstelling om te bevestigen dat een normale planningsronde nog steeds werkt.
- [ ] **Live verificatie door de sessie-orchestrator** in een echte browser vóór er iets naar Brent teruggekoppeld wordt — conform de bestaande sessieafspraak.
