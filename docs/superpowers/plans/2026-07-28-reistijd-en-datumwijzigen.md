# Max-reistijd, datum/tijd wijzigen & vaste-tijdstip-fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement drie samenhangende, door Brent goedgekeurde designdocs: (A) `computeArrivalTimes()` respecteert voortaan vastgezette tijdstippen, (B) een al ingepland Zoho-ticket kan vanuit het detailvenster naar een nieuwe datum/tijd verzet worden, en (C) de automatische weekplanner (`autoPlan()`) forceert geografische groepering via een instelbare max-reistijd tussen interventies.

**Architecture:** Alle drie zijn wijzigingen binnen het bestaande single-file PWA-frontend (`public/index.html`, vanilla JS, geen build-stap, geen modules) plus één kleine backend-wijziging (`netlify/functions/route.js`). Geen nieuwe bestanden, geen nieuwe dependencies. Groep A wordt eerst gebouwd omdat groep B er functioneel op leunt (een verzet ticket met een vast tijdstip moet correct in de aankomsttijd-berekening verschijnen); groep C is volledig onafhankelijk en kan in willekeurige volgorde t.o.v. A/B.

**Tech Stack:** Vanilla JS (geen framework), Netlify Functions (ES modules), TomTom Routing/Geocoding API, Zoho Desk API. Geen testframework in dit project — verificatie gebeurt via de lokale dev server (`node dev-server.mjs`, poort 3333, `?test`-querystring voor test-modus) en live browserverificatie (Browser-pane), zoals bij alle eerdere features in dit project.

## Global Constraints

- Geen wijzigingen aan `calculateRoute()`/`optimizeRoute()` (Route-tabblad).
- Geen wijziging aan lokale afspraken (`localEvents`) — die ondersteunen datum/tijd wijzigen al.
- Geen vaste pogingslimiet bij het zoeken naar een geografische kandidaat in `autoPlan()` — de volledige overblijvende dagwachtrij komt in aanmerking.
- Geen botsingsdetectie in `computeArrivalTimes()` — bewust uitgesteld, zie `docs/superpowers/specs/2026-07-28-vaste-tijdstippen-in-aankomsttijd-berekening-design.md`.
- Elke taak eindigt met een commit; alle drie de designdocs zijn al gecommit en goedgekeurd door Brent, niet opnieuw ter discussie stellen.
- Test in de browser via `node dev-server.mjs` (poort 3333) met `?test` in de URL waar mogelijk, om echte Zoho-writes te vermijden. TomTom-aanroepen (geocoding/routing) zijn read-only en mogen wél echt uitgevoerd worden (zelfde aanpak als bij de eerdere route-tabblad-fixes deze sessie).

---

## Groep A — Vaste tijdstippen in aankomsttijd-berekening

### Task 1: `timeStrToMin` helper + `computeArrivalTimes()` fix

**Spec:** `docs/superpowers/specs/2026-07-28-vaste-tijdstippen-in-aankomsttijd-berekening-design.md`

**Files:**
- Modify: `public/index.html:4431-4468` (naast `minToTimeStr`, en binnen `computeArrivalTimes`)

**Interfaces:**
- Consumes: bestaande globals `planning` (object, `{ [dateStr]: [{ ticket, address, uur? }] }`), `settings.vanTijd`, `routeData`, `currentRouteDate`, `duurVoor(ticketId)`.
- Produces: `timeStrToMin(hhmm: string): number` — nieuwe module-scope functie, minuten na middernacht. `computeArrivalTimes(date)` blijft dezelfde return-vorm (`{ [ticketId]: minutenNaMiddernacht }`), enkel het interne gedrag wijzigt.

- [ ] **Step 1: Lees de huidige functie ter controle**

Open `public/index.html` rond regel 4428-4468 en bevestig dat de inhoud nog exact overeenkomt met:
```js
function minToTimeStr(totalMin) {
  const hh = String(Math.floor((totalMin || 0) / 60) % 24).padStart(2, '0');
  const mm  = String((totalMin || 0) % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Bereken aankomsttijden (minuten na middernacht) per ticket voor een dag.
// Gebruikt routeData als beschikbaar, anders positie-schatting (30 min reistijd).
// Geeft { [ticketId]: arrivalMin } terug.
function computeArrivalTimes(date) {
  const stops = (planning[date] || []).filter(p =>
    activeAssigneeFilter === 'all' || p.ticket.assignee === activeAssigneeFilter
  );
  if (!stops.length) return {};
  const [h, m]   = (settings.vanTijd || '08:00').split(':').map(Number);
  const hasRoute = routeData?.legs && currentRouteDate === date;
  let curMin     = h * 60 + m;
  const result   = {};
  let legIdx = 0;
  for (let i = 0; i < stops.length; i++) {
    const isWaypoint = !!stops[i]._lat;
    const legSec = (hasRoute && isWaypoint)
      ? (routeData.legs[legIdx]?.travelTimeSeconds ?? 30 * 60)
      : 30 * 60;
    if (isWaypoint) legIdx++;
    curMin += Math.round(legSec / 60);
    result[stops[i].ticket.id] = curMin;
    curMin += duurVoor(stops[i].ticket.id); // per-ticket duur override of standaard
  }
  return result;
}
```
Als de regelnummers of inhoud afwijken (door eerdere sessiewijzigingen), zoek de functie op naam (`function computeArrivalTimes`) i.p.v. op regelnummer.

- [ ] **Step 2: Voeg de `timeStrToMin`-helper toe**

Direct na `minToTimeStr` (dus vóór het commentaarblok van `computeArrivalTimes`), voeg toe:
```js
function timeStrToMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
```

- [ ] **Step 3: Pas `computeArrivalTimes` aan**

Vervang binnen de `for`-lus:
```js
    if (isWaypoint) legIdx++;
    curMin += Math.round(legSec / 60);
    result[stops[i].ticket.id] = curMin;
    curMin += duurVoor(stops[i].ticket.id); // per-ticket duur override of standaard
```
door:
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
De rest van de functie (signature, filter, `hasRoute`, return) blijft ongewijzigd.

- [ ] **Step 4: Verifieer in de browser (dev server + console)**

Start de dev server (indien nog niet actief):
```bash
node dev-server.mjs
```
Open `http://localhost:3333/?test` in de Browser-pane. Open de devtools-console (via `javascript_tool`) en voer een geïsoleerde test uit die niet van echte Zoho-data afhangt:
```js
// Fixture: 3 fake stops op dezelfde dag, B heeft een vast tijdstip.
const testDate = '2099-01-01';
planning[testDate] = [
  { ticket: { id: 'A', assignee: undefined }, address: '', _lat: null, _lon: null },
  { ticket: { id: 'B', assignee: undefined }, address: '', uur: '14:00', _lat: null, _lon: null },
  { ticket: { id: 'C', assignee: undefined }, address: '', _lat: null, _lon: null },
];
const times = computeArrivalTimes(testDate);
console.log(minToTimeStr(times['A']), minToTimeStr(times['B']), minToTimeStr(times['C']));
delete planning[testDate]; // opruimen
```
Verwacht: het tijdstip voor `B` is exact `14:00` (niet de opgetelde schatting vanaf 08:00), en `C`'s tijdstip is `14:00 + duurVoor('B')` later (standaard 120 min tenzij ingesteld anders) plus 30 min fallback-reistijd — dus `16:30` bij standaardinstellingen. `A`'s tijdstip blijft de bestaande sequentiële schatting (08:30 bij 08:00 start + 30 min fallback-reistijd, standaardinstellingen).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
fix: respecteer vastgezette tijdstippen in aankomsttijd-berekening

computeArrivalTimes() rekende voorheen altijd sequentieel door vanaf de
ochtend-starttijd, ook als een afspraak al een expliciet gekozen tijdstip
had (via Toewijzen of Datum/tijd wijzigen). De berekening springt nu naar
zo'n vast tijdstip en rekent daarna verder vanaf vast-tijdstip + duur.
EOF
)"
```

---

## Groep B — Datum/tijd wijzigen van een ingepland ticket

### Task 2: Detailvenster — nieuwe knop + inline datum/tijd-picker (HTML + zichtbaarheid)

**Spec:** `docs/superpowers/specs/2026-07-28-datum-tijd-wijzigen-ingepland-ticket-design.md`

**Files:**
- Modify: `public/index.html:1346` (nieuwe `msec` na "Ticketdetails")
- Modify: `public/index.html:1354-1355` (nieuwe knop in `.mftr`)
- Modify: `public/index.html:4189-4253` (`openDetail(t)` — zichtbaarheidsregel)

**Interfaces:**
- Consumes: bestaande globals `activeTicket`, `_detailDate`, `showPlanBtns` (lokale variabele in `openDetail`).
- Produces: DOM-elementen `#d-btn-reschedule`, `#d-reschedule-row`, `#d-reschedule-date`, `#d-reschedule-time` — geconsumeerd door Task 3's `toggleRescheduleRow()`/`saveReschedule()`.

- [ ] **Step 1: Lees de huidige detailvenster-HTML ter controle**

Bevestig dat `public/index.html:1337-1358` nog overeenkomt met:
```html
<div class="overlay" id="det-overlay" onclick="closeDet(event)">
  <div class="modal">
    <div class="mhdr">
      <div class="mhdr-num" id="d-num"></div>
      <div class="mhdr-title" id="d-title"></div>
      <div class="mhdr-tags" id="d-tags"></div>
    </div>
    <div class="mbody">
      <div class="msec"><div class="msec-title">Klantgegevens</div><div id="d-klant"></div></div>
      <div class="msec"><div class="msec-title">Ticketdetails</div><div id="d-ticket"></div><div class="desktop-only" id="kb-section"></div></div>
    </div>
    <div class="mftr">
      <button class="btn-cancel" onclick="closeDet()">Sluiten</button>
      <button class="btn-save desktop-only" id="d-plan-btn" onclick="togglePlanFromDetail()"></button>
      <button class="btn-cancel" onclick="openOpl()">✏️ Oplossing</button>
      <button class="btn-cancel" id="d-btn-arrival" style="display:none" title="Aankomst registreren" onclick="registerArrival(activeTicket?.id,_detailDate)">⏱️ Aankomst</button>
      <button class="btn-cancel desktop-only" id="d-btn-proposal" style="display:none" title="Afspraakvoorstel sturen" onclick="openProposal(activeTicket?.id,_detailDate,(()=>{const t=computeArrivalTimes(_detailDate);return activeTicket?t[activeTicket.id]??null:null})())">📨 Voorstel</button>
      <button class="btn-cancel" id="d-btn-fotos" style="display:none" title="Foto's" onclick="openFotoModal(activeTicket?.id)">📷 Foto's</button>
      <button class="btn-cancel" id="d-btn-rapport"  style="display:none" title="Service rapport" onclick="openRapport(activeTicket?.id,_detailDate)">📋 Rapport</button>
    </div>
  </div>
</div>
```
Als de inhoud afwijkt, zoek op `id="det-overlay"` i.p.v. op regelnummer.

- [ ] **Step 2: Voeg de inline datum/tijd-picker toe in `.mbody`**

Vervang:
```html
      <div class="msec"><div class="msec-title">Ticketdetails</div><div id="d-ticket"></div><div class="desktop-only" id="kb-section"></div></div>
    </div>
```
door:
```html
      <div class="msec"><div class="msec-title">Ticketdetails</div><div id="d-ticket"></div><div class="desktop-only" id="kb-section"></div></div>
      <div class="msec" id="d-reschedule-row" style="display:none">
        <div class="msec-title">Nieuwe datum/tijd</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <input type="date" id="d-reschedule-date" class="set-input" style="width:auto">
          <input type="time" id="d-reschedule-time" class="set-input" style="width:auto">
          <button class="btn-save" onclick="saveReschedule()">✓ Opslaan</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 3: Voeg de knop toe in `.mftr`**

Vervang:
```html
      <button class="btn-cancel" id="d-btn-rapport"  style="display:none" title="Service rapport" onclick="openRapport(activeTicket?.id,_detailDate)">📋 Rapport</button>
    </div>
```
door:
```html
      <button class="btn-cancel" id="d-btn-rapport"  style="display:none" title="Service rapport" onclick="openRapport(activeTicket?.id,_detailDate)">📋 Rapport</button>
      <button class="btn-cancel" id="d-btn-reschedule" style="display:none" title="Datum/tijd wijzigen" onclick="toggleRescheduleRow()">📅 Datum/tijd</button>
    </div>
```

- [ ] **Step 4: Wire zichtbaarheid in `openDetail(t)`**

Bevestig eerst dat `public/index.html:4198-4202` nog overeenkomt met:
```js
  const showPlanBtns = !!_detailDate;
  document.getElementById('d-btn-arrival').style.display  = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-proposal').style.display = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-fotos').style.display    = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-rapport').style.display  = showPlanBtns ? '' : 'none';
```
Vervang door:
```js
  const showPlanBtns = !!_detailDate;
  document.getElementById('d-btn-arrival').style.display  = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-proposal').style.display = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-fotos').style.display    = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-rapport').style.display  = showPlanBtns ? '' : 'none';
  document.getElementById('d-btn-reschedule').style.display = showPlanBtns ? '' : 'none';
  document.getElementById('d-reschedule-row').style.display = 'none'; // altijd ingeklapt bij (her)openen
```

- [ ] **Step 5: Verifieer in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Klik in de Kalender op een kaart van een reeds ingepland ticket → detailvenster opent. Controleer via `read_page` of de knop **"📅 Datum/tijd"** zichtbaar is in de footer, en dat het blok "Nieuwe datum/tijd" nog dicht is (`display:none`). Klik op een ticket dat NOG NIET ingepland is (vanuit de Wachtrij-tab, `openDetail` op een niet-geplande ticket) en controleer dat de knop daar verborgen blijft.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
feat: knop + inline picker voor datum/tijd wijzigen in detailvenster

Voorbereidende HTML/zichtbaarheid voor het verzetten van een al ingepland
Zoho-ticket naar een nieuwe datum/tijd. De opslaan-logica volgt in de
volgende commit.
EOF
)"
```

### Task 3: `toggleRescheduleRow()` + `saveReschedule()`

**Spec:** `docs/superpowers/specs/2026-07-28-datum-tijd-wijzigen-ingepland-ticket-design.md`

**Files:**
- Modify: `public/index.html` — nieuwe functies naast `openDetail`/`closeDet` (rond regel 4253-4260, ná `closeDet`)

**Interfaces:**
- Consumes: `activeTicket`, `_detailDate`, `planning`, `getHolidayName(dateStr)`, `kbBlocked(ticketId, dateStr)`, `fmtDateShort(dateStr)`, `localISO(date)`, `extractLocalHour(isoString)`, `closeDet()`, `renderKalender()`, `toast(msg, ms?)`. DOM-elementen uit Task 2: `#d-reschedule-row`, `#d-reschedule-date`, `#d-reschedule-time`.
- Produces: `toggleRescheduleRow(): void`, `saveReschedule(): Promise<void>` — beide aangeroepen vanuit de HTML `onclick`-attributen uit Task 2.

- [ ] **Step 1: Lees `closeDet` ter controle van de invoegplek**

Bevestig dat na `closeDet` (public/index.html, direct na `openDetail`) volgende code staat:
```js
function closeDet(e) {
  if (e && e.target !== document.getElementById('det-overlay')) return;
  document.getElementById('det-overlay').classList.remove('open');
}
```

- [ ] **Step 2: Voeg de twee nieuwe functies toe, direct na `closeDet`**

```js
function toggleRescheduleRow() {
  const row = document.getElementById('d-reschedule-row');
  const opening = row.style.display === 'none';
  row.style.display = opening ? '' : 'none';
  if (opening && activeTicket) {
    const d = activeTicket.interventieDatum ? new Date(activeTicket.interventieDatum) : new Date();
    document.getElementById('d-reschedule-date').value = localISO(d);
    document.getElementById('d-reschedule-time').value =
      `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
}

async function saveReschedule() {
  if (!activeTicket || !_detailDate) return;
  const date = document.getElementById('d-reschedule-date').value;
  const time = document.getElementById('d-reschedule-time').value || '09:00';
  if (!date) return toast('⚠️ Selecteer een datum');

  const oldDate  = _detailDate;
  const ticketId = activeTicket.id;

  // Zelfde waarschuwingen als bij een eerste toewijzing (addTicketToDate) — enkel
  // relevant als de dag effectief verandert.
  if (date !== oldDate) {
    const feestdag = getHolidayName(date);
    if (feestdag && !confirm(`🎌 ${feestdag} is een wettelijke feestdag (${fmtDateShort(date)}).\nToch inplannen?`)) return;
    if (kbBlocked(ticketId, date) && !confirm(`⚠️ Klant gaf aan NIET beschikbaar te zijn op ${fmtDateShort(date)}.\nToch inplannen?`)) return;
  }

  const utcInterventieDatum = new Date(`${date}T${time}:00`).toISOString();
  closeDet();
  try {
    const res  = await fetch('/api/plan', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketId, date, utcInterventieDatum }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Lokale state: uit de oude dag halen, aan de nieuwe dag toevoegen.
    if (planning[oldDate]) {
      planning[oldDate] = planning[oldDate].filter(p => p.ticket.id !== ticketId);
      if (!planning[oldDate].length) delete planning[oldDate];
    }
    activeTicket.interventieDatum = utcInterventieDatum;
    activeTicket.status = 'Wachten op bevestiging planning';
    if (!planning[date]) planning[date] = [];
    if (!planning[date].find(p => p.ticket.id === ticketId)) {
      planning[date].push({ ticket: activeTicket, address: activeTicket.address, uur: extractLocalHour(utcInterventieDatum) });
    }
    renderKalender();
    toast(`✓ Verzet naar ${fmtDateShort(date)} om ${time}`);
  } catch (err) {
    toast('❌ Zoho update mislukt: ' + err.message, 4000);
  }
}
```

- [ ] **Step 3: Verifieer in de browser (fetch stub, geen echte Zoho-writes)**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Open in de Browser-pane devtools-console en stub `fetch` tijdelijk om `/api/plan` te onderscheppen zonder Zoho aan te spreken:
```js
const realFetch = window.fetch;
window.fetch = (url, opts) => {
  if (String(url).startsWith('/api/plan')) {
    return Promise.resolve({ json: async () => ({ success: true }) });
  }
  return realFetch(url, opts);
};
```
Klik in de Kalender op een ingepland ticket → "📅 Datum/tijd" → wijzig datum en tijd → "✓ Opslaan". Controleer:
- De toast toont "✓ Verzet naar ... om ...".
- Het ticket verdwijnt van de oude dag-kolom en verschijnt op de nieuwe dag-kolom in de Kalender, met het nieuwe tijdstip zichtbaar op de kaart (`🕐 HH:MM`).
- Herstel `fetch` nadien: `window.fetch = realFetch;`

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
feat: datum/tijd van een ingepland ticket kunnen wijzigen

Nieuwe "Datum/tijd wijzigen"-knop in het detailvenster laat een al
ingepland Zoho-ticket naar een nieuwe datum/tijd verzetten. Hergebruikt
/api/plan (zelfde endpoint als een eerste toewijzing), dus de Zoho-status
gaat terug naar "Wachten op bevestiging planning" en dezelfde
feestdag-/klantbeschikbaarheid-waarschuwingen gelden.
EOF
)"
```

---

## Groep C — Max-reistijd tussen interventies (autoPlan)

### Task 4: Retry-met-backoff in `netlify/functions/route.js`

**Spec:** `docs/superpowers/specs/2026-07-28-max-reistijd-tussen-interventies-design.md`, sectie 3.

**Files:**
- Modify: `netlify/functions/route.js`

**Interfaces:**
- Consumes: niets nieuws — bestaande `handler(event)`-signature blijft ongewijzigd.
- Produces: interne functie `fetchTomTomRoute(url, attempt?)` — enkel gebruikt binnen dit bestand.

- [ ] **Step 1: Lees het bestand ter controle**

Bevestig dat `netlify/functions/route.js` nog de simpele `const res = await fetch(url);` op regel 39 bevat (zie huidige bestandsinhoud — geen retry-logica).

- [ ] **Step 2: Voeg de retry-helper toe**

Voeg toe na de bestaande `const API_KEY = () => process.env.TOMTOM_API_KEY;` (regel 6):
```js
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// TomTom's routing-tier laat maar een beperkt aantal aanvragen per seconde toe. De
// max-reistijd-check in autoPlan() roept dit endpoint nu potentieel meerdere keren na
// elkaar aan tijdens één "Plan deze week"-run — zelfde retry-met-backoff-patroon als
// optimize.js's geocode() voor exact hetzelfde soort probleem.
async function fetchTomTomRoute(url, attempt = 1) {
  const res = await fetch(url);
  if (res.status === 429 && attempt <= 3) {
    await sleep(attempt * 400);
    return fetchTomTomRoute(url, attempt + 1);
  }
  return res;
}
```

- [ ] **Step 3: Gebruik de helper in `handler`**

Vervang:
```js
    const res = await fetch(url);
    const data = await res.json();
```
door:
```js
    const res = await fetchTomTomRoute(url);
    const data = await res.json();
```

- [ ] **Step 4: Verifieer**

Start `node dev-server.mjs` (leest `.env.local` voor `TOMTOM_API_KEY`). Voer in de Browser-pane console een directe test uit tegen de lokale server:
```js
fetch('/api/route', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ waypoints: [{ lat: 51.1739, lon: 4.3181 }, { lat: 51.2194, lon: 4.4025 }] }),
}).then(r => r.json()).then(console.log);
```
Verwacht: een geldige JSON-respons met `legs[0].travelTimeSeconds` (een getal). Dit bevestigt dat de retry-wrapper de normale werking niet breekt (429 komt normaal niet voor bij één enkele aanvraag, dus dit test vooral de happy path — de retry-tak zelf is niet zonder een echte TomTom-rate-limit te forceren, wat we hier niet doen).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/route.js
git commit -m "$(cat <<'EOF'
fix: retry-met-backoff bij TomTom 429 in /api/route

De nieuwe max-reistijd-check in autoPlan() roept dit endpoint vaker na
elkaar aan; zelfde retry-patroon als optimize.js's geocode() voorkomt
onnodige mislukkingen bij TomTom's rate-limit.
EOF
)"
```

### Task 5: Instelling "Max. reistijd tussen interventies"

**Spec:** `docs/superpowers/specs/2026-07-28-max-reistijd-tussen-interventies-design.md`, sectie 1.

**Files:**
- Modify: `public/index.html:1763-1770` (`DEFAULT_SETTINGS`)
- Modify: `public/index.html:1376-1379` (instellingen-modal HTML)
- Modify: `public/index.html:4281-4331` (`openSettings`/`saveSettings`)

**Interfaces:**
- Consumes: bestaande `settings`-object, `DEFAULT_SETTINGS`, `savePersonSettings(person)`, `toast(msg, ms?)`.
- Produces: `settings.maxReistijdMin: number` (nieuw veld) — geconsumeerd door Task 6.

- [ ] **Step 1: Lees de 3 betrokken plekken ter controle**

Bevestig dat de huidige inhoud overeenkomt met wat hierboven in "Files" vermeld staat (zie de exacte code hieronder bij elke stap — als het afwijkt, zoek op `DEFAULT_SETTINGS`, op `id="set-max"`, en op `function saveSettings`).

- [ ] **Step 2: `DEFAULT_SETTINGS` uitbreiden**

Vervang:
```js
const DEFAULT_SETTINGS = {
  startlocatie: 'Heirbaan 9, 9150 Kruibeke',
  duurMinuten:  120,
  maxPerDag:    4,
  vanTijd:      '08:00',
  totTijd:      '17:00',
  werkdagen:    [1,2,3,4,5],
};
```
door:
```js
const DEFAULT_SETTINGS = {
  startlocatie:   'Heirbaan 9, 9150 Kruibeke',
  duurMinuten:    120,
  maxPerDag:      4,
  vanTijd:        '08:00',
  totTijd:        '17:00',
  werkdagen:      [1,2,3,4,5],
  maxReistijdMin: 45,
};
```

- [ ] **Step 3: Nieuw instellingenveld in de modal-HTML**

Vervang:
```html
      <div class="set-field">
        <label class="set-label">Max interventies per dag</label>
        <input class="set-input" id="set-max" type="number" min="1" max="20" />
      </div>
```
door:
```html
      <div class="set-field">
        <label class="set-label">Max interventies per dag</label>
        <input class="set-input" id="set-max" type="number" min="1" max="20" />
      </div>
      <div class="set-field">
        <label class="set-label">Max. reistijd tussen interventies (minuten)</label>
        <input class="set-input" id="set-maxreistijd" type="number" min="0" max="240" step="5" />
      </div>
```

- [ ] **Step 4: `openSettings()` uitbreiden**

Vervang:
```js
  document.getElementById('set-max').value      = settings.maxPerDag;
```
door:
```js
  document.getElementById('set-max').value      = settings.maxPerDag;
  document.getElementById('set-maxreistijd').value = settings.maxReistijdMin;
```

- [ ] **Step 5: `saveSettings()` uitbreiden**

Vervang:
```js
function saveSettings() {
  const duur   = +document.getElementById('set-duration').value;
  const max    = +document.getElementById('set-max').value;
  const van    = document.getElementById('set-van').value;
  const tot    = document.getElementById('set-tot').value;

  if (van && tot && van >= tot) return toast('⚠️ Begintijd moet voor eindtijd liggen', 3500);
  if (duur < 15)                return toast('⚠️ Minimale interventieduur is 15 minuten', 3500);
  if (max < 1)                  return toast('⚠️ Maximaal per dag moet minstens 1 zijn', 3500);
  if (!settings.werkdagen.length) return toast('⚠️ Selecteer minstens één werkdag', 3500);

  settings.startlocatie = document.getElementById('set-start').value.trim() || DEFAULT_SETTINGS.startlocatie;
  settings.duurMinuten  = duur || DEFAULT_SETTINGS.duurMinuten;
  settings.maxPerDag    = max  || DEFAULT_SETTINGS.maxPerDag;
  settings.vanTijd      = van  || DEFAULT_SETTINGS.vanTijd;
  settings.totTijd      = tot  || DEFAULT_SETTINGS.totTijd;
  savePersonSettings(activeAssigneeFilter);
```
door:
```js
function saveSettings() {
  const duur        = +document.getElementById('set-duration').value;
  const max         = +document.getElementById('set-max').value;
  const van         = document.getElementById('set-van').value;
  const tot         = document.getElementById('set-tot').value;
  const maxReistijd = +document.getElementById('set-maxreistijd').value;

  if (van && tot && van >= tot) return toast('⚠️ Begintijd moet voor eindtijd liggen', 3500);
  if (duur < 15)                return toast('⚠️ Minimale interventieduur is 15 minuten', 3500);
  if (max < 1)                  return toast('⚠️ Maximaal per dag moet minstens 1 zijn', 3500);
  if (maxReistijd < 0)          return toast('⚠️ Max. reistijd kan niet negatief zijn', 3500);
  if (!settings.werkdagen.length) return toast('⚠️ Selecteer minstens één werkdag', 3500);

  settings.startlocatie   = document.getElementById('set-start').value.trim() || DEFAULT_SETTINGS.startlocatie;
  settings.duurMinuten    = duur || DEFAULT_SETTINGS.duurMinuten;
  settings.maxPerDag      = max  || DEFAULT_SETTINGS.maxPerDag;
  settings.vanTijd        = van  || DEFAULT_SETTINGS.vanTijd;
  settings.totTijd        = tot  || DEFAULT_SETTINGS.totTijd;
  settings.maxReistijdMin = maxReistijd || maxReistijd === 0 ? maxReistijd : DEFAULT_SETTINGS.maxReistijdMin;
  savePersonSettings(activeAssigneeFilter);
```
**Let op:** `maxReistijd || DEFAULT_SETTINGS.maxReistijdMin` (het patroon van de andere velden) zou 0 incorrect vervangen door de default, omdat `0` falsy is — vandaar de expliciete `maxReistijd || maxReistijd === 0 ? maxReistijd : DEFAULT_SETTINGS.maxReistijdMin`, zodat 0 (een geldige, want in het designdoc toegelaten waarde) niet stiekem overschreven wordt.

- [ ] **Step 6: Verifieer in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Open Instellingen (tandwiel-icoon) → controleer dat "Max. reistijd tussen interventies (minuten)" verschijnt, standaard `45`. Zet op `0`, sla op, heropen Instellingen → moet `0` blijven tonen (niet terugspringen naar 45). Zet op `30`, sla op, herlaad de pagina (`F5`), heropen Instellingen → moet `30` tonen (bevestigt persistente opslag via `localStorage`).

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
feat: instelling "max. reistijd tussen interventies" toevoegen

Nieuw per-technieker instelbaar veld (standaard 45 min), nog niet
gebruikt door de planner zelf — dat volgt in de volgende commit.
EOF
)"
```

### Task 6: `travelTimeMin`/`pickNearbyCandidate` + wijziging aan `autoPlan()`'s seed- en fill-logica

**Spec:** `docs/superpowers/specs/2026-07-28-max-reistijd-tussen-interventies-design.md`, sectie 2.

**Files:**
- Modify: `public/index.html` — nieuwe helpers vóór `autoPlan()`, en wijzigingen binnen `autoPlan()` (rond regel 3476-3650)

**Interfaces:**
- Consumes: `settings.maxReistijdMin` (Task 5), bestaande `fillScore(t, fromLat, fromLon)`, `duurVoor(id)`, `kbBlocked`, `prefDayAvailable`, `planning`, `activeAssigneeFilter`, `addTicketToDate(ticketId, date)`.
- Produces: `travelTimeMin(from, to): Promise<number|null>`, `pickNearbyCandidate(candidates, fromLat, fromLon): Promise<object|null>` — beide module-scope, enkel gebruikt binnen `autoPlan()`.

- [ ] **Step 1: Lees de huidige `autoPlan()`-kern ter controle**

Bevestig dat `public/index.html` rond regel 3589-3627 nog overeenkomt met:
```js
      // ── Fix 2: Geografisch seeden ─────────────────────────────────────────
      // Startpositie = positie van het laatste al ingeplande ticket op deze dag
      // (zodat we verder bundelen vanuit de bestaande regio), of anders de depot.
      const existingOnDay = (planning[day.date] || []).filter(p =>
        activeAssigneeFilter === 'all' || p.ticket.assignee === activeAssigneeFilter
      );
      const lastExisting = existingOnDay[existingOnDay.length - 1];
      const startLat = lastExisting?._lat ?? lastExisting?.ticket?._lat ?? originCoords?.lat ?? null;
      const startLon = lastExisting?._lon ?? lastExisting?.ticket?._lon ?? originCoords?.lon ?? null;

      // Seed: geografisch dichtste ticket (met urgentie/prio als tiebreaker via fillScore)
      const seedPool = [...dayPool];
      seedPool.sort((a, b) => fillScore(a, startLat, startLon) - fillScore(b, startLat, startLon));
      if (!seedPool.length) continue;
      const seed = seedPool[0];
      pool.splice(pool.indexOf(seed), 1);
      const dayTickets = [seed];

      // Fill: ticket met laagste score t.o.v. huidige positie op die dag.
      // Tickets met duurOverride tellen als meerdere slots (naar boven afgerond).
      let curLat = seed._lat, curLon = seed._lon;
      let usedSlots = Math.ceil(duurVoor(seed.id) / settings.duurMinuten); // seed telt al mee
      while (usedSlots < day.cap && pool.length) {
        const fillPool = pool.filter(t => {
          if (kbBlocked(t.id, day.date)) return false;
          const pref = prefDayAvailable.get(t.id);
          if (pref && pref !== day.date) return false;
          return true;
        });
        if (!fillPool.length) break;
        fillPool.sort((a, b) => fillScore(a, curLat, curLon) - fillScore(b, curLat, curLon));
        const chosen = fillPool[0];
        const chosenSlots = Math.ceil(duurVoor(chosen.id) / settings.duurMinuten);
        if (usedSlots + chosenSlots > day.cap) break; // past niet meer
        pool.splice(pool.indexOf(chosen), 1);
        dayTickets.push(chosen);
        usedSlots += chosenSlots;
        if (chosen._lat && chosen._lon) { curLat = chosen._lat; curLon = chosen._lon; }
      }
```
Als de inhoud afwijkt, zoek op de commentaarregel `// ── Fix 2: Geografisch seeden` binnen `function autoPlan()`.

- [ ] **Step 2: Voeg de twee nieuwe helpers toe, vóór `async function autoPlan()`**

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

- [ ] **Step 3: Pas de seed-selectie aan (`seedExempt`)**

Vervang:
```js
      // Seed: geografisch dichtste ticket (met urgentie/prio als tiebreaker via fillScore)
      const seedPool = [...dayPool];
      seedPool.sort((a, b) => fillScore(a, startLat, startLon) - fillScore(b, startLat, startLon));
      if (!seedPool.length) continue;
      const seed = seedPool[0];
      pool.splice(pool.indexOf(seed), 1);
      const dayTickets = [seed];
```
door:
```js
      // Seed: geografisch dichtste ticket (met urgentie/prio als tiebreaker via fillScore).
      // Enkel een volledig lege dag (geen lastExisting) is vrijgesteld van de
      // reistijd-check — de aanrijtijd vanaf het depot telt niet mee. Zodra de dag al
      // een ticket bevat (manueel verzet of van een eerdere planningsronde), moet ook
      // de eerste toevoeging binnen settings.maxReistijdMin vallen (bevestigd door Brent).
      const seedPool = [...dayPool];
      seedPool.sort((a, b) => fillScore(a, startLat, startLon) - fillScore(b, startLat, startLon));
      if (!seedPool.length) continue;
      const seedExempt = !lastExisting;
      const seed = seedExempt ? seedPool[0] : await pickNearbyCandidate(seedPool, startLat, startLon);
      if (!seed) continue; // dag heeft al een ticket, maar niemand past binnen de max-reistijd
      pool.splice(pool.indexOf(seed), 1);
      const dayTickets = [seed];
```

- [ ] **Step 4: Pas de fill-lus aan**

Vervang:
```js
        if (!fillPool.length) break;
        fillPool.sort((a, b) => fillScore(a, curLat, curLon) - fillScore(b, curLat, curLon));
        const chosen = fillPool[0];
        const chosenSlots = Math.ceil(duurVoor(chosen.id) / settings.duurMinuten);
```
door:
```js
        if (!fillPool.length) break;
        fillPool.sort((a, b) => fillScore(a, curLat, curLon) - fillScore(b, curLat, curLon));
        const chosen = await pickNearbyCandidate(fillPool, curLat, curLon);
        if (!chosen) break; // niemand in de wachtrij past nog binnen de max-reistijd voor deze dag
        const chosenSlots = Math.ceil(duurVoor(chosen.id) / settings.duurMinuten);
```
De rest van de lus (capaciteitscheck, `pool.splice`, `dayTickets.push`, `usedSlots +=`, `curLat`/`curLon` bijwerken) blijft ongewijzigd.

- [ ] **Step 5: Verifieer in de browser met een kunstmatig lage max-reistijd**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Zet in Instellingen "Max. reistijd tussen interventies" tijdelijk op een zeer lage waarde (bv. `1` minuut) zodat vrijwel geen enkele kandidaat een dag mag delen met een andere. Klik "⚡ Plan deze week" met minstens 2 te plannen tickets op verschillende adressen. Verwacht: elke dag krijgt hooguit 1 interventie (tenzij twee tickets toevallig op dezelfde locatie liggen) — controleer dit via de Kalender-weergave na afloop. Zet de instelling nadien terug op `45`.

Controleer ook via `preview_logs`/netwerktab (`read_network_requests`, filter op `/api/route`) dat er tijdens deze run herhaalde POST-aanvragen naar `/api/route` gebeuren (één per geprobeerde kandidaat) — dit bevestigt dat `pickNearbyCandidate` daadwerkelijk wordt aangeroepen i.p.v. stilzwijgend te falen.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
feat: max-reistijd tussen interventies in de automatische planner

autoPlan() controleert nu de echte (theoretische, geen live-verkeer)
reistijd tussen opeenvolgende interventies op dezelfde dag via TomTom's
/api/route, en probeert de volledige overblijvende dagwachtrij (geen
vaste pogingslimiet) tot een kandidaat binnen de ingestelde max-reistijd
valt. Enkel de allereerste interventie van een volledig lege dag is
vrijgesteld (aanrijtijd vanaf het depot); zodra de dag al een ticket
bevat geldt de check ook voor de eerste toevoeging.
EOF
)"
```

---

## Eindcontrole (na alle taken)

- [ ] **Volledige regressietest van de Kalender + Instellingen + autoPlan in de browser**, via `node dev-server.mjs` met `?test`: open de Kalender, verifieer dat bestaande tickets nog correct tonen (geen crash door de nieuwe `d-reschedule-row`/`d-btn-reschedule`-elementen), open Instellingen en sla op zonder iets te wijzigen (moet geen foutmelding geven), en draai "⚡ Plan deze week" één keer met de standaardinstelling (45 min) om te bevestigen dat een normale planningsronde nog steeds tickets toewijst (niet alles naar overflow duwt).
- [ ] **Live verificatie door de sessie-orchestrator in een echte browser** (Browser-pane) vóór er iets naar Brent teruggekoppeld wordt — niet enkel op basis van de subagent-rapportage, conform de bestaande sessieafspraak.
