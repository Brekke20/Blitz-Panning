# Inventaris Edit-modus & Supervisor-log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vervang de zoek-en-kies-modal op de Inventaris-tab door een altijd-volledige
materialenlijst met een globale Edit/Opslaan/Annuleren-modus (+/−/intikbaar aantal, per-item
"dempen" van de lage-voorraadmelding), en herwerk het supervisor-overzicht ("Alle technici")
naar een dag-gegroepeerde lijst met live-detectie van nieuwe regels (pulserende gloed, 30s-
polling) en een Excel-export met datumfilter. Log-historiek wordt serverside tot 3 maanden
terug bijgehouden.

**Architecture:** Backend-datamodel voor `wagenvoorraad[technieker][materiaalId]` wijzigt van
een plein getal naar `{ aantal, gedempt }` (met transparante normalisatie voor bestaande,
nog-niet-aangeraakte data — geen migratiestap nodig). De frontend-module
`public/js/inventaris.js` wordt op twee plaatsen herschreven (technieker-weergave,
supervisor-weergave); `public/index.html` krijgt een kleine, nieuwe polling-timer die — net als
vandaag al voor `activeAssigneeFilter` geldt — bewust ín de classic-script blijft, niet in de
module (de module leest die globale variabele nooit rechtstreeks).

**Tech Stack:** Vanilla JS (ES modules, geen bundler), Netlify Functions v2, Netlify Blobs,
ExcelJS (al via CDN geladen, zie `public/js/excel-export.js` voor het bestaande patroon).

**Spec:** Geen apart ontwerpdocument — dit plan volgt rechtstreeks uit de conversatie met Brent
op 2026-08-20/21 (chat-brainstorm, geen `docs/superpowers/specs/`-bestand). De bindende
afspraken staan hieronder in "Global Constraints" en zijn woordelijk uit die conversatie
overgenomen.

## Global Constraints

- **Volledige catalogus altijd zichtbaar** in de technieker-weergave (Task 2's bevestigde
  keuze) — niet enkel materiaal dat de technieker al heeft.
- **Bel-icoon = per technieker, per materiaal** (niet globaal/gedeeld tussen techniekers).
- **Alles pas bij "Opslaan"**: +/−/intikken/bel-toggle gebeurt enkel lokaal; niets wordt
  verstuurd tot op "Opslaan" geklikt wordt. "Annuleren" verwerpt alle lokale wijzigingen.
- **Aantal kan nooit onder 0**: een correctie gebeurt door het aantal te verlagen, nooit door
  een negatief getal in te tikken.
- Gedempte items tellen niet meer mee voor de rode markering of de lage-voorraad-badge, ook al
  staat het aantal op 0.
- **Supervisor-log**: dag-gegroepeerd (witregel met datum, erdoor per dag alle bewegingen),
  geen aparte "te verwerken"-sectie — één doorlopende, chronologische lijst.
- **Live-detectie van nieuwe regels**: elke 30 seconden een achtergrond-check zolang je op de
  Inventaris-tab staat; nieuwe regels krijgen een pulserende gloed die verdwijnt zodra je naar
  een ander tabblad wisselt.
- **Retentie: 3 maanden** — regels ouder dan 3 maanden worden niet bewaard (serverside opschonen,
  niet enkel client-side verbergen).
- **Excel-export**: volledige historiek (aanvulling + correctie + verbruik) binnen een
  gekozen van/tot-periode, in dezelfde ExcelJS-stijl als de bestaande Rapporten-export
  (`public/js/excel-export.js`) — nooit SheetJS (zie `CLAUDE.md`).
- Cross-module-aanroepen blijven via `window.x = x`-bridges, nooit `import`/`export` tussen
  `public/js/*.js`-bestanden (bestaande conventie).
- Geen geautomatiseerde testsuite — verificatie via `curl` (backend, met de lokale
  Netlify-Blobs-emulatie, zie Task 1) en de browser (frontend).
- Versie-ophoging (SemVer) en CHANGELOG-entry gebeuren als aparte, expliciete stap bij het
  afronden van de branch — niet per taak (`CLAUDE.md`, "Versioning & changelog").

---

## Task 1: Backend — genormaliseerde voorraad, dempen, 3-maanden-retentie

**Files:**
- Modify: `netlify/functions/inventaris.js` (volledige herschrijving)

**Interfaces:**
- Produces: `GET /api/inventaris` → `{ versie, wagenvoorraad: { [technieker]: { [materiaalId]: { aantal, gedempt } } }, log: [...] }` (altijd genormaliseerd, log max. 3 maanden terug).
  `POST /api/inventaris` body `{ versie, technieker, actie: 'mutatie'|'verbruik', items: [{ materiaalId, materiaalNaam, aantal?, gedempt? }] }` — elk item heeft `aantal` (niet-nul getal, signed bij `mutatie`, positief bij `verbruik`) en/of `gedempt` (boolean, enkel toegestaan bij `actie:'mutatie'`); minstens één van beide is verplicht. Response: zelfde shape als GET (nieuwe versie), of `{ error, serverVersie?, data? }` bij 409/400/503.
  `PATCH /api/inventaris` body `{ versie, id }` → ongewijzigd t.o.v. vandaag.
- Consumes: niets van eerdere taken (eerste taak).

- [ ] **Step 1: Schrijf de volledige, nieuwe functie**

Vervang de volledige inhoud van `netlify/functions/inventaris.js` door:

```js
// /api/inventaris
// GET   → volledige inventarisstaat (wagenvoorraad per technieker + volledige log, altijd
//         genormaliseerd + max. 3 maanden log-historiek)
// POST  → mutatie (technieker vult wagenvoorraad bij, corrigeert, en/of dempt de
//         lage-voorraadmelding voor een materiaal) of verbruik (automatische aftrek bij een
//         afgerond rapport) — beide muteren wagenvoorraad + loggen een regel (behalve een
//         zuivere demp-wijziging, die niet gelogd wordt)
// PATCH → een 'aanvulling'-logregel op status 'verwerkt' zetten (supervisor heeft ze in AFAS geboekt)
import { getStore } from '@netlify/blobs';

const BLOB_KEY = 'inventaris';
const ALLOWED_ORIGINS = [
  'https://blitz-planning.netlify.app',
  'http://localhost:8888',
];
const RETENTIE_MAANDEN = 3;

const EMPTY = { versie: 0, wagenvoorraad: {}, log: [] };

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(data, status, hdrs) {
  return new Response(JSON.stringify(data), { status, headers: { ...hdrs, 'Content-Type': 'application/json' } });
}

// Oude opslag had per materiaal enkel een getal (aantal); nieuwe opslag heeft {aantal, gedempt}.
// Bestaande, nog niet aangeraakte data blijft in de oude vorm tot ze opnieuw geschreven wordt --
// elk antwoord aan de frontend normaliseert daarom altijd naar de nieuwe vorm, zodat de
// frontend nooit met de oude vorm rekening moet houden.
function normStock(val) {
  if (val == null) return { aantal: 0, gedempt: false };
  if (typeof val === 'number') return { aantal: val, gedempt: false };
  return { aantal: val.aantal || 0, gedempt: !!val.gedempt };
}

function normalizeWagenvoorraad(wv) {
  const out = {};
  for (const [tech, stock] of Object.entries(wv || {})) {
    out[tech] = {};
    for (const [id, val] of Object.entries(stock || {})) {
      out[tech][id] = normStock(val);
    }
  }
  return out;
}

function toResponse(data) {
  return { ...data, wagenvoorraad: normalizeWagenvoorraad(data.wagenvoorraad) };
}

// Log-historiek wordt beperkt tot RETENTIE_MAANDEN, om de opslag niet onbeperkt te laten
// aangroeien. Bewuste keuze: dit bumpt de 'versie' niet -- het is opschoning, geen inhoudelijke
// wijziging waarop een client optimistic-lock zou moeten conflicteren op.
function pruneOldLog(log) {
  const grens = new Date();
  grens.setMonth(grens.getMonth() - RETENTIE_MAANDEN);
  const grensISO = grens.toISOString();
  return (log || []).filter(e => e.datum >= grensISO);
}

async function pruneAndGet(store) {
  let current;
  try { current = (await store.get(BLOB_KEY, { type: 'json' })) ?? EMPTY; }
  catch { return { current: null, error: true }; }

  const pruned = pruneOldLog(current.log);
  if (pruned.length !== (current.log || []).length) {
    current = { ...current, log: pruned };
    try { await store.setJSON(BLOB_KEY, current); } catch { /* best effort, niet fataal */ }
  }
  return { current, error: false };
}

export default async (req) => {
  const hdrs = corsHeaders(req);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: hdrs });

  const store = getStore({ name: 'blitz-data', consistency: 'strong' });

  // ── GET ──────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { current, error } = await pruneAndGet(store);
    if (error) return json(toResponse(EMPTY), 200, { ...hdrs, 'X-Source': 'fallback' });
    return json(toResponse(current), 200, hdrs);
  }

  // ── POST (mutatie of verbruik) ──────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Ongeldige JSON' }, 400, hdrs); }

    const { versie, technieker, actie, items } = body;

    if (typeof versie !== 'number') return json({ error: 'versie is verplicht en moet een getal zijn' }, 400, hdrs);
    if (!technieker || typeof technieker !== 'string') return json({ error: 'technieker is verplicht' }, 400, hdrs);
    if (actie !== 'mutatie' && actie !== 'verbruik') return json({ error: "actie moet 'mutatie' of 'verbruik' zijn" }, 400, hdrs);
    if (!Array.isArray(items) || !items.length) return json({ error: 'items moet een niet-lege array zijn' }, 400, hdrs);
    for (const it of items) {
      if (!it.materiaalId || typeof it.materiaalId !== 'string') return json({ error: 'elk item heeft een materiaalId nodig' }, 400, hdrs);
      if (!it.materiaalNaam || typeof it.materiaalNaam !== 'string') return json({ error: 'elk item heeft een materiaalNaam nodig' }, 400, hdrs);
      const heeftAantal  = it.aantal  !== undefined;
      const heeftGedempt = it.gedempt !== undefined;
      if (!heeftAantal && !heeftGedempt) return json({ error: `item voor ${it.materiaalId} heeft aantal of gedempt nodig` }, 400, hdrs);
      if (heeftAantal && (typeof it.aantal !== 'number' || !Number.isFinite(it.aantal) || it.aantal === 0)) {
        return json({ error: `ongeldig aantal voor ${it.materiaalId}` }, 400, hdrs);
      }
      if (heeftGedempt && typeof it.gedempt !== 'boolean') return json({ error: `ongeldige gedempt-waarde voor ${it.materiaalId}` }, 400, hdrs);
      if (heeftGedempt && actie !== 'mutatie') return json({ error: 'gedempt kan enkel bij actie mutatie' }, 400, hdrs);
    }

    const { current, error } = await pruneAndGet(store);
    if (error) return json({ error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }, 503, hdrs);

    if (versie !== current.versie) {
      return json({ error: 'Inventaris ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie, data: toResponse(current) }, 409, hdrs);
    }

    const wagenvoorraad = { ...current.wagenvoorraad };
    const stock = { ...(wagenvoorraad[technieker] || {}) };
    const nieuweLogRegels = [];
    const nu = new Date().toISOString();

    for (const it of items) {
      const bestaand = normStock(stock[it.materiaalId]);
      let nieuweAantal  = bestaand.aantal;
      let nieuweGedempt = bestaand.gedempt;

      if (it.aantal !== undefined) {
        // verbruik: 'aantal' is de gebruikte hoeveelheid (positief) -> wagenvoorraad daalt.
        // mutatie: 'aantal' is al signed (positief = aanvulling, negatief = correctie).
        const delta = actie === 'verbruik' ? -Math.abs(it.aantal) : it.aantal;
        nieuweAantal = bestaand.aantal + delta;

        const type   = actie === 'verbruik' ? 'verbruik' : (delta > 0 ? 'aanvulling' : 'correctie');
        const status = type === 'aanvulling' ? 'nieuw' : null;
        nieuweLogRegels.push({
          id: crypto.randomUUID(),
          technieker,
          materiaalId:   it.materiaalId,
          materiaalNaam: it.materiaalNaam,
          aantal: delta,
          datum: nu,
          type,
          status,
        });
      }
      if (it.gedempt !== undefined) nieuweGedempt = it.gedempt;

      stock[it.materiaalId] = { aantal: nieuweAantal, gedempt: nieuweGedempt };
    }

    wagenvoorraad[technieker] = stock;

    const nieuw = {
      versie: current.versie + 1,
      wagenvoorraad,
      log: [...current.log, ...nieuweLogRegels],
    };

    try {
      await store.setJSON(BLOB_KEY, nieuw);
      return json(toResponse(nieuw), 200, hdrs);
    } catch (err) {
      return json({ error: 'Opslaan mislukt: ' + err.message }, 500, hdrs);
    }
  }

  // ── PATCH (logregel als verwerkt markeren) ──────────────────────────────────
  if (req.method === 'PATCH') {
    let body;
    try { body = await req.json(); }
    catch { return json({ error: 'Ongeldige JSON' }, 400, hdrs); }

    const { versie, id } = body;
    if (typeof versie !== 'number') return json({ error: 'versie is verplicht en moet een getal zijn' }, 400, hdrs);
    if (!id || typeof id !== 'string') return json({ error: 'id is verplicht' }, 400, hdrs);

    const { current, error } = await pruneAndGet(store);
    if (error) return json({ error: 'Inventaris-opslag tijdelijk niet bereikbaar, probeer opnieuw.' }, 503, hdrs);

    if (versie !== current.versie) {
      return json({ error: 'Inventaris ondertussen gewijzigd, herlaad en probeer opnieuw', serverVersie: current.versie, data: toResponse(current) }, 409, hdrs);
    }

    const idx = current.log.findIndex(e => e.id === id);
    if (idx < 0) return json({ error: 'Logregel niet gevonden' }, 404, hdrs);
    if (current.log[idx].type !== 'aanvulling') return json({ error: 'Enkel aanvullingen kunnen als verwerkt gemarkeerd worden' }, 400, hdrs);

    const log = [...current.log];
    log[idx] = { ...log[idx], status: 'verwerkt' };

    const nieuw = { versie: current.versie + 1, wagenvoorraad: current.wagenvoorraad, log };

    try {
      await store.setJSON(BLOB_KEY, nieuw);
      return json(toResponse(nieuw), 200, hdrs);
    } catch (err) {
      return json({ error: 'Opslaan mislukt: ' + err.message }, 500, hdrs);
    }
  }

  return json({ error: 'Method not allowed' }, 405, hdrs);
};

export const config = { path: '/api/inventaris' };
```

- [ ] **Step 2: Zet de lokale Netlify-Blobs-emulatie op**

Deze functie kan niet lokaal getest worden met louter `node dev-server.mjs` (Netlify Blobs
heeft een `siteID`/`token`-context nodig die normaal enkel `netlify dev` levert). Er bestaat al
een niet-meegecommit hulpscript hiervoor in de repo-root: `blobs-local-bootstrap.mjs` (staat in
`.gitignore` onder "Lokale verificatie-tooling", dus niet zichtbaar via `git status` maar wel
gewoon aanwezig op schijf naast `dev-server.mjs`). Start het met:

```bash
node blobs-local-bootstrap.mjs
```

Dit start zowel een lokale Blobs-emulator als `dev-server.mjs` (poort 3333) als kindproces.
Als dit bestand er toch niet is: maak het aan met exact deze inhoud (het staat sowieso in
`.gitignore`, dus dit is geen inbreuk op enige conventie):

```js
// Lokale verificatie-tool, NIET onderdeel van de app -- start een lokale Netlify
// Blobs-emulatie (dezelfde BlobsServer die `netlify dev` intern gebruikt) en start
// daarna dev-server.mjs als kindproces met NETLIFY_BLOBS_CONTEXT ingesteld, zodat
// getStore()-aanroepen in de functions echt lokaal wegschrijven i.p.v. te falen met
// MissingBlobsEnvironmentError.
import { BlobsServer } from '@netlify/blobs/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const server = new BlobsServer({
  directory: path.join(__dirname, '.blobs-local-test'),
  token: 'test-token',
});
const { port } = await server.start();
console.log(`[blobs-local-bootstrap] lokale Blobs-server op port ${port}`);

const context = {
  edgeURL:         `http://localhost:${port}`,
  uncachedEdgeURL: `http://localhost:${port}`, // vereist voor consistency:'strong', geen apart CDN-endpoint lokaal
  siteID:          'test-site',
  token:           'test-token',
};
const encoded = Buffer.from(JSON.stringify(context)).toString('base64');

const child = spawn(process.execPath, ['dev-server.mjs'], {
  cwd: __dirname,
  env: { ...process.env, NETLIFY_BLOBS_CONTEXT: encoded },
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
```

- [ ] **Step 3: Verifieer GET op een lege staat**

Run: `curl -s http://localhost:3333/api/inventaris`
Expected: `{"versie":0,"wagenvoorraad":{},"log":[]}`

- [ ] **Step 4: Verifieer POST — aanvulling + gedempt tegelijk in één item**

```bash
curl -s -X POST http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":0,"technieker":"Jan Peeters","actie":"mutatie","items":[{"materiaalId":"led","materiaalNaam":"LED","aantal":5,"gedempt":true}]}'
```
Expected: `versie:1`, `wagenvoorraad["Jan Peeters"].led` = `{"aantal":5,"gedempt":true}`, `log`
heeft 1 regel `type:"aanvulling"`, `status:"nieuw"`, `aantal:5` (de demp-wijziging zelf wordt
niet apart gelogd, enkel meegenomen in de stock-update).

- [ ] **Step 5: Verifieer POST — zuiver dempen, geen aantal-wijziging, geen logregel**

Run (versie `1`):
```bash
curl -s -X POST http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":1,"technieker":"Jan Peeters","actie":"mutatie","items":[{"materiaalId":"led","materiaalNaam":"LED","gedempt":false}]}'
```
Expected: `versie:2`, `wagenvoorraad["Jan Peeters"].led` = `{"aantal":5,"gedempt":false}` (aantal
ongewijzigd), `log` heeft nog steeds maar 1 regel (geen nieuwe regel voor deze zuivere
demp-wijziging).

- [ ] **Step 6: Verifieer validatiefout — item zonder aantal én zonder gedempt**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":2,"technieker":"Jan Peeters","actie":"mutatie","items":[{"materiaalId":"led","materiaalNaam":"LED"}]}'
```
Expected: `400`.

- [ ] **Step 7: Verifieer validatiefout — gedempt bij actie verbruik**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3333/api/inventaris \
  -H "Content-Type: application/json" \
  -d '{"versie":2,"technieker":"Jan Peeters","actie":"verbruik","items":[{"materiaalId":"led","materiaalNaam":"LED","aantal":1,"gedempt":true}]}'
```
Expected: `400`.

- [ ] **Step 8: Verifieer normalisatie van bestaande (oude-vorm) data**

Zoek het lokale blob-bestand terug: de exacte submap-/bestandsnaamstructuur onder
`.blobs-local-test/` is een implementatiedetail van `@netlify/blobs`'s lokale server (mogelijk
geen leesbare bestandsnaam) — zoek daarom op **inhoud**, niet op naam:
```bash
grep -rl '"wagenvoorraad"' .blobs-local-test/
```
Dat levert het juiste JSON-bestand op. Open het en wijzig manueel `wagenvoorraad["Jan Peeters"].led`
van `{"aantal":5,...}` terug
naar het oude formaat: een plein getal, bv. `5` (simuleert data van vóór deze wijziging), en
sla op. Run daarna:
```bash
curl -s http://localhost:3333/api/inventaris
```
Expected: `wagenvoorraad["Jan Peeters"].led` komt terug als `{"aantal":5,"gedempt":false}` —
dus automatisch genormaliseerd in het antwoord, ook al stond de opslag zelf nog in de oude vorm.

- [ ] **Step 9: Verifieer 3-maanden-retentie**

In hetzelfde blob-bestand: voeg manueel een logregel toe met een `datum` van meer dan 3 maanden
geleden (bv. `"datum": "2026-01-01T09:00:00.000Z"`) en sla op. Run daarna een willekeurige GET,
POST of PATCH (bv. Step 3's GET opnieuw) en controleer dat die regel **niet** meer voorkomt in
het antwoord — en, door het blob-bestand opnieuw te openen, dat ze ook niet meer in de opslag
zelf staat (effectief opgeschoond, niet enkel verborgen in het antwoord). Voeg ook een logregel
toe met een datum van *minder* dan 3 maanden geleden en bevestig dat die wél blijft staan.

- [ ] **Step 10: Commit**

```bash
git add netlify/functions/inventaris.js
git commit -m "feat: genormaliseerde wagenvoorraad ({aantal,gedempt}) + 3-maanden log-retentie"
```

---

## Task 2: Frontend — technieker-Edit-modus + supervisor-dag-groepering + export (volledige herschrijving `inventaris.js` + CSS)

**Files:**
- Modify: `public/js/inventaris.js` (volledige herschrijving)
- Modify: `public/css/inventaris.css` (volledige herschrijving)

**Interfaces:**
- Consumes: `PRIJZEN`/`PRIJZEN_DEFAULTS` (bare reference, window-bridged door `prijzen.js`);
  `toast`, `escHtml`, `loadFromCache`, `saveToCache` (bare reference, window-globale functies in
  `public/index.html`); `ExcelJS` (globaal via CDN-scripttag, al gebruikt door
  `public/js/excel-export.js`).
- Produces (window-bridged, gebruikt vanuit `public/index.html`): `loadInventaris()`,
  `renderInventaris(persoon)`, `updateInventarisBadge(persoon)` (signatures ongewijzigd t.o.v.
  vandaag), `registreerVerbruik(technieker, onderdelen)` (ongewijzigd), **nieuw:**
  `resetInvSeenLog()` — leest/schrijft geen `activeAssigneeFilter`, wordt door Task 3's
  index.html-wijziging aangeroepen bij het verlaten van de Inventaris-tab.

- [ ] **Step 1: Vervang de volledige inhoud van `public/js/inventaris.js`**

```js
// public/js/inventaris.js
// Wagenvoorraad per technieker (Fase 2) + supervisor-neemlog. Weergave hangt af van de
// bestaande persoon-kiezer (activeAssigneeFilter in index.html), die als parameter
// doorgegeven wordt door renderInventaris()/updateInventarisBadge() -- deze module leest
// activeAssigneeFilter niet rechtstreeks (het is een `let` in een classic script, dus geen
// impliciete window-global, in tegenstelling tot function-declarations zoals toast/escHtml).
// Zie docs/superpowers/plans/2026-08-21-inventaris-edit-en-supervisorlog.md.

export let _invData = { versie: 0, wagenvoorraad: {}, log: [] };

let _invEditActive   = false;  // is de technieker-weergave momenteel in Edit-modus?
let _invEditPersoon  = null;   // voor welke technieker die Edit-modus loopt
let _invEditSnapshot = null;   // Map<materiaalId, {aantal, gedempt}> -- stand bij het openen van Edit
let _invSeenLogIds   = null;   // Set<id> -- null = nog niet ge-baseline'd deze weergave-sessie

const INV_API       = '/api/inventaris';
const INV_CACHE_KEY = 'blitz_inventaris_cache';

const TYPE_LABEL = { aanvulling: 'Aanvulling', correctie: 'Correctie', verbruik: 'Verbruik' };

// ── Laden ──
export async function loadInventaris() {
  const cached = loadFromCache(INV_CACHE_KEY);
  if (cached) _invData = cached;
  try {
    const res = await fetch(INV_API);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _invData = data;
    saveToCache(INV_CACHE_KEY, data);
  } catch (err) {
    console.warn('Inventaris laden mislukt, laatst gekende stand blijft staan:', err);
  }
}

// ── Weergave ──
export function renderInventaris(persoon) {
  const body = document.getElementById('inventaris-body');
  if (!body) return;

  if (persoon === 'all') {
    body.innerHTML = renderSupervisorLog();
    wireSupervisorLog(body);
  } else {
    body.innerHTML = renderEigenVoorraad(persoon);
    wireEigenVoorraad(body, persoon);
  }
}

// ── Technieker-weergave: volledige catalogus + Edit-modus ──
function renderEigenVoorraad(persoon) {
  const stock = _invData.wagenvoorraad[persoon] || {};
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const materialen = [...src.onderdelen].sort((a, b) => a.naam.localeCompare(b.naam));
  const editing = _invEditActive && _invEditPersoon === persoon;

  const rijen = materialen.map(o => {
    const entry  = stock[o.id] || { aantal: 0, gedempt: false };
    const aantal = entry.aantal || 0;
    const gedempt = !!entry.gedempt;
    const laag = aantal <= 0 && !gedempt;

    if (!editing) {
      return `<div class="inv-row${laag ? ' inv-low' : ''}">
        <span class="inv-row-naam">${escHtml(o.naam)}</span>
        <span class="inv-row-aantal">${aantal}</span>
      </div>`;
    }
    return `<div class="inv-row inv-cat-row" data-mat-id="${escHtml(o.id)}" data-mat-naam="${escHtml(o.naam)}">
      <span class="inv-row-naam">${escHtml(o.naam)}</span>
      <div class="inv-qty-edit">
        <button class="inv-qty-btn inv-qty-minus" type="button" title="Verminder">−</button>
        <input class="inv-qty-input" type="number" min="0" step="1" value="${aantal}" />
        <button class="inv-qty-btn inv-qty-plus" type="button" title="Vermeerder">+</button>
        <button class="inv-bell-btn${gedempt ? ' inv-bell-muted' : ''}" type="button" title="Lage-voorraadmelding voor dit item ${gedempt ? 'inschakelen' : 'uitschakelen'}">${gedempt ? '🔕' : '🔔'}</button>
      </div>
    </div>`;
  }).join('');

  const toolbar = editing
    ? `<div class="inv-toolbar">
         <button class="btn-cancel" id="inv-cancel-btn">Annuleren</button>
         <button class="btn-save" id="inv-save-btn">✓ Opslaan</button>
       </div>`
    : `<div class="inv-toolbar"><button class="btn-primary" id="inv-edit-btn">✏️ Edit</button></div>`;

  return toolbar + `<div class="inv-list">${rijen}</div>`;
}

function wireEigenVoorraad(body, persoon) {
  body.querySelector('#inv-edit-btn')?.addEventListener('click', () => invStartEdit(persoon));
  body.querySelector('#inv-cancel-btn')?.addEventListener('click', () => invCancelEdit());
  body.querySelector('#inv-save-btn')?.addEventListener('click', () => invSaveEdit());
  body.querySelectorAll('.inv-cat-row').forEach(row => {
    const input = row.querySelector('.inv-qty-input');
    row.querySelector('.inv-qty-minus')?.addEventListener('click', () => {
      input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
    });
    row.querySelector('.inv-qty-plus')?.addEventListener('click', () => {
      input.value = (parseInt(input.value, 10) || 0) + 1;
    });
    row.querySelector('.inv-bell-btn')?.addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const nowMuted = !btn.classList.contains('inv-bell-muted');
      btn.classList.toggle('inv-bell-muted', nowMuted);
      btn.textContent = nowMuted ? '🔕' : '🔔';
    });
  });
}

function invStartEdit(persoon) {
  const stock = _invData.wagenvoorraad[persoon] || {};
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  _invEditSnapshot = new Map();
  src.onderdelen.forEach(o => {
    const entry = stock[o.id] || { aantal: 0, gedempt: false };
    _invEditSnapshot.set(o.id, { aantal: entry.aantal || 0, gedempt: !!entry.gedempt });
  });
  _invEditActive  = true;
  _invEditPersoon = persoon;
  renderInventaris(persoon);
}

function invCancelEdit() {
  const persoon = _invEditPersoon;
  _invEditActive   = false;
  _invEditPersoon  = null;
  _invEditSnapshot = null;
  renderInventaris(persoon);
}

async function invSaveEdit() {
  const persoon = _invEditPersoon;
  const body = document.getElementById('inventaris-body');
  const items = [];

  body.querySelectorAll('.inv-cat-row').forEach(row => {
    const id    = row.dataset.matId;
    const naam  = row.dataset.matNaam;
    const input = row.querySelector('.inv-qty-input');
    const bel   = row.querySelector('.inv-bell-btn');

    const nieuweAantal  = Math.max(0, parseInt(input.value, 10) || 0);
    const nieuweGedempt = bel.classList.contains('inv-bell-muted');
    const oud = _invEditSnapshot.get(id) || { aantal: 0, gedempt: false };

    const item = { materiaalId: id, materiaalNaam: naam };
    let gewijzigd = false;
    if (nieuweAantal !== oud.aantal)   { item.aantal  = nieuweAantal - oud.aantal; gewijzigd = true; }
    if (nieuweGedempt !== oud.gedempt) { item.gedempt = nieuweGedempt;             gewijzigd = true; }
    if (gewijzigd) items.push(item);
  });

  if (!items.length) { invCancelEdit(); return; }

  try {
    const res = await fetch(INV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versie: _invData.versie, technieker: persoon, actie: 'mutatie', items }),
    });
    if (res.status === 409) {
      const errBody = await res.json();
      _invData = errBody.data || _invData;
      toast('⚠ Conflict — inventaris herladen, probeer opnieuw', 3000);
      _invEditActive = false; _invEditPersoon = null; _invEditSnapshot = null;
      renderInventaris(persoon);
      updateInventarisBadge(persoon);
      return;
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || ('HTTP ' + res.status));
    }
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
    _invEditActive = false; _invEditPersoon = null; _invEditSnapshot = null;
    renderInventaris(persoon);
    updateInventarisBadge(persoon);
    toast('✓ Wagenvoorraad opgeslagen', 2500);
  } catch (err) {
    toast('❌ Opslaan mislukt: ' + err.message, 4000);
  }
}

// ── Supervisor-weergave: dag-gegroepeerde log + live nieuw-detectie ──
function renderSupervisorLog() {
  const entries = [...(_invData.log || [])].sort((a, b) => new Date(b.datum) - new Date(a.datum));
  const currentIds = new Set(entries.map(e => e.id));

  let nieuweIds;
  if (_invSeenLogIds === null) {
    nieuweIds = new Set();      // eerste weergave deze sessie: nog niets als 'nieuw' markeren
    _invSeenLogIds = currentIds;
  } else {
    nieuweIds = new Set([...currentIds].filter(id => !_invSeenLogIds.has(id)));
  }

  const toolbar = `<div class="inv-toolbar inv-export-toolbar">
    <input type="date" id="inv-export-van" title="Export van" />
    <span style="color:var(--muted);font-size:0.75rem">–</span>
    <input type="date" id="inv-export-tot" title="Export tot" />
    <button class="btn-sec" id="inv-export-btn">📊 Excel export</button>
  </div>`;

  if (!entries.length) return toolbar + '<div class="inv-empty">Nog geen bewegingen.</div>';

  let html = '';
  let huidigeDag = null;
  entries.forEach(e => {
    const dag = e.datum.slice(0, 10);
    if (dag !== huidigeDag) {
      huidigeDag = dag;
      const label = new Date(dag + 'T12:00:00').toLocaleDateString('nl-BE', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
      html += `<div class="inv-day-sep">${label}</div>`;
    }
    const tijd = new Date(e.datum).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
    html += `<div class="inv-log-row${nieuweIds.has(e.id) ? ' inv-day-new' : ''}">
      <span class="inv-log-type inv-log-${e.type}">${TYPE_LABEL[e.type] || e.type}</span>
      <span class="inv-log-technieker">${escHtml(e.technieker)}</span>
      <span class="inv-log-materiaal">${escHtml(e.materiaalNaam)}</span>
      <span class="inv-log-aantal">${e.aantal > 0 ? '+' : ''}${e.aantal}</span>
      <span class="inv-log-tijd">${tijd}</span>
      ${e.type === 'aanvulling'
        ? (e.status === 'nieuw'
            ? `<button class="btn-sec inv-log-verwerkt-btn" data-log-id="${e.id}">Verwerkt</button>`
            : '<span class="inv-log-status-done">✓ verwerkt</span>')
        : ''}
    </div>`;
  });

  return toolbar + `<div class="inv-list">${html}</div>`;
}

function wireSupervisorLog(body) {
  body.querySelectorAll('.inv-log-verwerkt-btn').forEach(btn => {
    btn.addEventListener('click', () => markVerwerkt(btn.dataset.logId));
  });
  body.querySelector('#inv-export-btn')?.addEventListener('click', () => exportInventarisLog());
}

// Aangeroepen vanuit public/index.html's setTab() zodra een ANDER tabblad dan Inventaris
// geopend wordt -- maakt de volgende weergave van de supervisor-log weer een schone baseline
// (geen pulserende gloed meer), exact zoals afgesproken: "gloed gaat weg als men van tabblad
// wisselt".
export function resetInvSeenLog() {
  _invSeenLogIds = null;
}

export function updateInventarisBadge(persoon) {
  const el = document.getElementById('cnt-inventaris');
  if (!el) return;
  let count;
  if (persoon === 'all') {
    count = (_invData.log || []).filter(e => e.type === 'aanvulling' && e.status === 'nieuw').length;
  } else {
    const stock = _invData.wagenvoorraad[persoon] || {};
    count = Object.values(stock).filter(entry => entry.aantal <= 0 && !entry.gedempt).length;
  }
  el.textContent = String(count);
  el.style.display = count > 0 ? '' : 'none';
}

// ── Verwerkt-actie (supervisor) ──
async function markVerwerkt(logId) {
  try {
    const res = await fetch(INV_API, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versie: _invData.versie, id: logId }),
    });
    if (res.status === 409) {
      const body = await res.json();
      _invData = body.data || _invData;
      toast('⚠ Conflict — inventaris herladen, probeer opnieuw', 3000);
      renderInventaris('all');
      updateInventarisBadge('all');
      return;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
    renderInventaris('all');
    updateInventarisBadge('all');
    toast('✓ Gemarkeerd als verwerkt', 2500);
  } catch (err) {
    toast('❌ Verwerkt-markering mislukt: ' + err.message, 4000);
  }
}

// ── Excel-export van de volledige log (aanvulling + correctie + verbruik) ──
export async function exportInventarisLog() {
  const vanVal = document.getElementById('inv-export-van')?.value;
  const totVal = document.getElementById('inv-export-tot')?.value;

  let rows = _invData.log || [];
  if (vanVal) rows = rows.filter(e => e.datum.slice(0, 10) >= vanVal);
  if (totVal) rows = rows.filter(e => e.datum.slice(0, 10) <= totVal);
  rows = [...rows].sort((a, b) => new Date(a.datum) - new Date(b.datum));

  if (!rows.length) return toast('Geen bewegingen in dit datumbereik', 2500);

  toast('📊 Excel wordt opgemaakt…', 3000);

  const vanLabel = vanVal || 'begin';
  const totLabel = totVal || 'huidig';

  const headers = ['Datum', 'Tijd', 'Technieker', 'Type', 'Materiaal', 'Aantal', 'Status'];
  const ncols = headers.length;

  const data = rows.map(e => {
    const d = new Date(e.datum);
    return [
      d.toLocaleDateString('nl-BE'),
      d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }),
      e.technieker,
      TYPE_LABEL[e.type] || e.type,
      e.materiaalNaam,
      e.aantal,
      e.type === 'aanvulling' ? (e.status === 'verwerkt' ? 'Verwerkt' : 'Nieuw') : '',
    ];
  });

  const colWidths = headers.map((h, i) => {
    const hLen   = h.length + 2;
    const maxVal = data.reduce((m, row) => Math.max(m, String(row[i] ?? '').length + 1), 0);
    return Math.min(Math.max(hLen, maxVal, 8), 36);
  });

  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Blitz Planning';
    const ws = wb.addWorksheet('Inventaris');
    ws.columns = colWidths.map(w => ({ width: w }));
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3, activeCell: 'A4' }];

    const r1 = ws.addRow(Array(ncols).fill(''));
    r1.height = 26;
    ws.mergeCells(1, 1, 1, ncols);
    Object.assign(r1.getCell(1), {
      value:     'INVENTARIS — BLITZ POWER',
      font:      { bold: true, size: 14, color: { argb: 'FFFFFFFF' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101820' } },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });

    const r2 = ws.addRow(Array(ncols).fill(''));
    r2.height = 16;
    ws.mergeCells(2, 1, 2, ncols);
    Object.assign(r2.getCell(1), {
      value:     `Periode: ${vanLabel} → ${totLabel}  |  Export: ${new Date().toLocaleDateString('nl-BE')}  |  ${rows.length} record${rows.length !== 1 ? 's' : ''}`,
      font:      { size: 9, color: { argb: 'FFAAAAAA' } },
      fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF101820' } },
      alignment: { horizontal: 'left', vertical: 'middle' },
    });

    const r3 = ws.addRow(headers);
    r3.height = 22;
    for (let c = 1; c <= ncols; c++) {
      const cell     = r3.getCell(c);
      cell.font      = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border    = { bottom: { style: 'medium', color: { argb: 'FF00DFA3' } } };
    }
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: ncols } };

    data.forEach((rowData, ri) => {
      const row = ws.addRow(rowData);
      row.height = 15;
      const rowBg = ri % 2 === 0 ? 'FFFFFFFF' : 'FFEEF2F7';
      for (let c = 1; c <= ncols; c++) {
        const cell     = row.getCell(c);
        cell.font      = { size: 9 };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
        cell.alignment = { vertical: 'middle' };
        cell.border    = { bottom: { style: 'thin', color: { argb: 'FFDDDDDD' } } };
      }
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href       = url;
    a.download   = `Inventaris_${vanLabel}_${totLabel}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast(`✓ ${rows.length} rijen geëxporteerd`, 2500);
  } catch (err) {
    toast(`❌ Export mislukt: ${err.message}`, 4000);
    console.error('exportInventarisLog:', err);
  }
}

// ── Automatische aftrek bij rapport-afronding ──
// Aangeroepen (niet afgewacht, best-effort) vanuit public/js/rapport-wizard.js's printRapport().
// 'vrije regel'-onderdelen (id begint met 'vrij-') zijn handmatig ingevoerde tekst zonder
// koppeling aan de prijzencatalogus -- die hebben geen materiaalId om tegen af te boeken, en
// worden dus bewust overgeslagen (geen fout, gewoon genegeerd).
export async function registreerVerbruik(technieker, onderdelen) {
  if (!technieker) return;
  const items = (onderdelen || [])
    .filter(p => p.naam && !String(p.id || '').startsWith('vrij-') && (parseInt(p.aantal) || 0) > 0)
    .map(p => ({ materiaalId: p.id, materiaalNaam: p.naam, aantal: parseInt(p.aantal) || 1 }));
  if (!items.length) return;

  try {
    const res = await fetch(INV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ versie: _invData.versie, technieker, actie: 'verbruik', items }),
    });
    if (!res.ok) { console.warn('Inventaris-aftrek (verbruik) niet gelukt, HTTP', res.status); return; }
    _invData = await res.json();
    saveToCache(INV_CACHE_KEY, _invData);
  } catch (err) {
    console.warn('Inventaris-aftrek (verbruik) niet gelukt:', err);
  }
}

// ── Window-bridge ──
// Zelfde patroon als prijzen.js/rapport-wizard.js: functies die vanuit index.html (setTab/
// selectPerson/DOMContentLoaded/rapport-wizard.js) aangeroepen worden, moeten expliciet op
// window staan (modules maken geen impliciete globals). Functies die enkel via addEventListener
// vanuit dit bestand zelf aangeroepen worden (invStartEdit, invSaveEdit, invCancelEdit,
// markVerwerkt, exportInventarisLog, ...) hebben GEEN bridge nodig.
window.loadInventaris        = loadInventaris;
window.renderInventaris      = renderInventaris;
window.updateInventarisBadge = updateInventarisBadge;
window.registreerVerbruik    = registreerVerbruik;
window.resetInvSeenLog       = resetInvSeenLog;
```

- [ ] **Step 2: Vervang de volledige inhoud van `public/css/inventaris.css`**

```css
/* Inventaris-tab: wagenvoorraad per technieker (volledige catalogus + Edit-modus) +
   supervisor-neemlog (dag-gegroepeerd, met live nieuw-detectie) */

.inv-toolbar {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 16px;
}

.inv-empty {
  padding: 20px 16px;
  color: var(--muted);
  font-size: 0.82rem;
}

.inv-list {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inv-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--surface);
}

.inv-row.inv-low {
  border-color: var(--red);
  background: var(--red-dim);
}

.inv-row-naam { font-size: 0.85rem; }
.inv-row-aantal { font-size: 0.85rem; font-weight: 700; }
.inv-row.inv-low .inv-row-aantal { color: var(--red); }

/* ── Editeerbare rij (technieker-weergave, Edit-modus) ── */
.inv-qty-edit {
  display: flex;
  align-items: center;
  gap: 6px;
}

.inv-qty-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--r);
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text);
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.inv-qty-btn:hover { background: var(--surface3); }

.inv-qty-input {
  width: 52px;
  text-align: center;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--text);
  padding: 4px 2px;
  font-size: 0.85rem;
  font-family: inherit;
}

.inv-bell-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--r);
  border: 1px solid var(--border);
  background: var(--surface2);
  cursor: pointer;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.inv-bell-btn.inv-bell-muted { opacity: 0.5; }

/* ── Supervisor-log: dag-scheiding + regels ── */
.inv-day-sep {
  padding: 10px 16px 4px;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--muted);
  text-transform: capitalize;
}

.inv-log-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r);
  background: var(--surface);
  flex-wrap: wrap;
  font-size: 0.82rem;
}

.inv-log-type {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 20px;
  text-transform: uppercase;
}
.inv-log-type.inv-log-aanvulling { background: var(--accent-dim); color: var(--accent); }
.inv-log-type.inv-log-correctie  { background: var(--red-dim); color: var(--red); }
.inv-log-type.inv-log-verbruik   { background: var(--surface3); color: var(--muted); }

.inv-log-materiaal { flex: 1; min-width: 140px; }
.inv-log-tijd { color: var(--muted); font-size: 0.75rem; }
.inv-log-status-done { color: var(--muted); font-size: 0.75rem; }

/* Nieuwe regel, ontdekt terwijl je op dit scherm staat: pulserende gloed. Verdwijnt door
   resetInvSeenLog() (aangeroepen bij het verlaten van de Inventaris-tab) en een her-render. */
@keyframes invNewGlow {
  0%, 100% { box-shadow: 0 0 0 0 var(--accent-dim); }
  50%      { box-shadow: 0 0 0 6px var(--accent-dim); }
}
.inv-log-row.inv-day-new {
  border-color: var(--accent);
  animation: invNewGlow 1.6s ease-in-out infinite;
}

/* ── Export-toolbar (datumfilters + knop) ── */
.inv-export-toolbar {
  justify-content: flex-start;
  flex-wrap: wrap;
}
.inv-export-toolbar input[type="date"] {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--text);
  padding: 4px 7px;
  font-size: 0.75rem;
  font-family: inherit;
}
```

- [ ] **Step 3: Handmatige verificatie in de browser (dev-server uit Task 1 blijft draaien)**

1. Herlaad de app, kies een technieker → Inventaris toont nu de **volledige catalogus**
   (~24 materialen), niet enkel wat die technieker al had. Materialen op `0` en niet gedempt
   tonen rood.
2. Klik **"Edit"** → elke rij toont nu `−`, een intikbaar vak, `+`, en een bel-icoon. De
   Edit-knop is vervangen door "Annuleren" + "✓ Opslaan".
3. Verhoog een materiaal met de `+`-knop een paar keer, verlaag een ander materiaal tot onder
   het startpunt met `−` (nooit onder 0 — test dit door een paar keer op `−` te klikken bij een
   materiaal dat al op `0` staat: blijft op `0`), en tik bij een derde materiaal een groot getal
   rechtstreeks in (bv. `50`) — geen 50 klikken nodig.
4. Klik het bel-icoon van een materiaal dat op `0` staat → wordt visueel "gedempt" (bv. 🔕,
   halftransparant).
5. Klik **"Annuleren"** → alles staat terug op de oorspronkelijke waarden (niets verstuurd —
   controleer via de Network-tab: geen `/api/inventaris`-POST).
6. Herhaal stap 2-4, klik nu **"✓ Opslaan"** → toast "✓ Wagenvoorraad opgeslagen", de lijst
   toont de nieuwe aantallen buiten Edit-modus, en het gedempte materiaal op `0` toont **geen**
   rode markering meer.
7. Schakel naar "Alle technici" → de neemlog toont nu **dag-gescheiden groepen** (een regel met
   de volledige datum, daaronder de bewegingen van die dag met enkel het **uur**, niet meer de
   datum per regel). De grote intik-wijziging staat als `aanvulling` met een "Verwerkt"-knop; de
   verlaging staat als `correctie`.
8. Wacht op de tabblad zonder iets te doen, en post via curl (zoals Task 1) een nieuwe
   `mutatie`-aanvulling voor eender welke technieker op de achtergrond. **Binnen de 30 seconden**
   moet die nieuwe regel verschijnen met een **pulserende gloed** rond de kaart (zonder dat je
   zelf iets hoeft aan te klikken — dit toetst Task 3's polling-logica, die in deze taak al
   client-side voorbereid is via `_invSeenLogIds`/`resetInvSeenLog`, maar pas écht aangestuurd
   wordt door Task 3's `startInvPoll()`. **Als Task 3 nog niet uitgevoerd is, zal deze stap nog
   niet werken — dat is verwacht; kom hier dan pas op terug ná Task 3.**).
9. Test de Excel-export: vul een van/tot-periode in (of laat leeg voor alles), klik "📊 Excel
   export" → een `.xlsx`-bestand downloadt. Open het (of inspecteer met een quick tool) en
   controleer: kolommen Datum/Tijd/Technieker/Type/Materiaal/Aantal/Status, gestileerde
   titelrij, correcte rij-aantallen voor het gekozen bereik.

- [ ] **Step 4: Commit**

```bash
git add public/js/inventaris.js public/css/inventaris.css
git commit -m "feat: Inventaris — volledige-catalogus Edit-modus, dag-gegroepeerde supervisor-log, Excel-export"
```

---

## Task 3: `public/index.html` — modal verwijderen, polling-timer, tab-wissel-hooks

**Files:**
- Modify: `public/index.html` (verwijdert de oude modal-markup, voegt polling-functies toe, wijzigt `setTab`)

**Interfaces:**
- Consumes: `loadInventaris`, `renderInventaris`, `updateInventarisBadge`, `resetInvSeenLog`
  (window-bridged door Task 2's `inventaris.js`).
- Produces: `startInvPoll()`, `stopInvPoll()` — nieuwe, module-loze classic-script-functies
  (bewust NIET in `inventaris.js`: enkel hier is `activeAssigneeFilter` een bare, leesbare
  variabele — zie Architecture hierboven).

- [ ] **Step 1: Verwijder de oude "+ Materiaal"-modal-markup**

Zoek en verwijder dit volledige blok (de modal die Task 3 van het vorige plan toevoegde, nu
overbodig sinds de volledige catalogus altijd zichtbaar is):

```html
<!-- Inventaris: materiaal toevoegen/corrigeren modal -->
<div class="overlay" id="inv-add-overlay" onclick="closeInventarisAddModal(event)">
  <div class="modal" id="inv-add-modal" style="max-width:420px">
    <div class="mhdr">
      <button class="mhdr-close" onclick="closeInventarisAddModal()" title="Sluiten" aria-label="Sluiten">✕</button>
      <div class="mhdr-title">📦 Materiaal toevoegen/corrigeren</div>
    </div>
    <div class="mbody" id="inv-add-body">
      <!-- Ingevuld door openInventarisAddModal()/_invRenderAddModal() -->
    </div>
  </div>
</div>
```

- [ ] **Step 2: Voeg de polling-functies toe**

Zoek de plaats waar `let activeAssigneeFilter = 'all';` gedeclareerd wordt, en voeg er direct
na toe:

```js
// Live-detectie van nieuwe Inventaris-log-regels (enkel relevant op de supervisor-weergave,
// "Alle technici") -- bewust HIER, niet in inventaris.js: enkel de classic-script van deze
// pagina leest activeAssigneeFilter als bare variabele (zie CLAUDE.md/module-conventie).
let _invPollTimer = null;

function startInvPoll() {
  stopInvPoll(); // idempotent: nooit twee actieve timers naast elkaar
  _invPollTimer = setInterval(() => {
    if (activeAssigneeFilter !== 'all') return;
    loadInventaris().then(() => {
      renderInventaris(activeAssigneeFilter);
      updateInventarisBadge(activeAssigneeFilter);
    });
  }, 30000);
}

function stopInvPoll() {
  if (_invPollTimer) { clearInterval(_invPollTimer); _invPollTimer = null; }
}
```

- [ ] **Step 3: Koppel start/stop aan `setTab`**

Zoek in `setTab(tab)`:
```js
  if (tab === 'inventaris') setTimeout(() => {
    loadInventaris().then(() => {
      renderInventaris(activeAssigneeFilter);
      updateInventarisBadge(activeAssigneeFilter);
    });
  }, 0);
```
en vervang door:
```js
  if (tab === 'inventaris') {
    setTimeout(() => {
      loadInventaris().then(() => {
        renderInventaris(activeAssigneeFilter);
        updateInventarisBadge(activeAssigneeFilter);
      });
    }, 0);
    startInvPoll();
  } else {
    stopInvPoll();
    resetInvSeenLog();
  }
```

- [ ] **Step 4: Handmatige verificatie in de browser**

1. Open Inventaris op "Alle technici", laat het tabblad open staan, en post via curl (zoals
   Task 2's Step 3.8) een nieuwe aanvulling op de achtergrond. Binnen 30 seconden verschijnt de
   nieuwe regel met een pulserende gloed, zonder dat je zelf iets aanklikte. Dit voltooit Task
   2's Step 3.8-verificatie die daar nog niet kon werken.
2. Wissel naar een ander tabblad (bv. Kalender), wacht een paar seconden, en schakel terug naar
   Inventaris → de regel van hierboven staat er nog steeds, maar toont **geen** gloed meer (de
   baseline is gereset).
3. Controleer via de browser-devtools (Network-tab, "throttling" niet nodig, gewoon een korte
   observatie over ~35-40 seconden op de Inventaris-tab) dat er om de 30 seconden een
   `GET /api/inventaris`-aanroep gebeurt zolang je op dat tabblad blijft, en dat die aanroepen
   **stoppen** zodra je naar een ander tabblad wisselt.
4. Herhaal de "+ Materiaal"-verwijdering-check: er is nergens in de app nog een knop of
   verwijzing naar de oude modal (zoek in de rendered HTML naar `inv-add-overlay` — mag nergens
   meer voorkomen).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: Inventaris — live-polling (30s) + tab-wissel reset voor supervisor-log, oude modal verwijderd"
```

---

## Task 4: Service-worker cache-versie ophogen

**Files:**
- Modify: `public/sw.js`

**Interfaces:** geen — dit raakt geen enkele functie-signatuur, enkel het cache-versienummer.

- [ ] **Step 1: Bump `CACHE_NAME`**

De precachete bestanden `public/js/inventaris.js` en `public/css/inventaris.css` zijn qua
*inhoud* grondig gewijzigd (geen nieuwe bestanden, dus de `SHELL`-array zelf hoeft niet
uitgebreid te worden) — enkel `CACHE_NAME` ophogen zodat de service worker zijn cache verplicht
vernieuwt (defensieve gewoonte in dit project, zie `CLAUDE.md`/projectgeheugen over
SW-cache-valkuilen).

Wijzig:
```js
const CACHE_NAME = 'blitz-planning-v8';
```
naar:
```js
const CACHE_NAME = 'blitz-planning-v9';
```

- [ ] **Step 2: Verifieer**

Herlaad de app in de browser met devtools open (Application-tab → Service Workers): bevestig
dat een nieuwe service worker (`v9`) geïnstalleerd wordt en de oude (`v7`/`v8`) cache-namen
opgeruimd worden (Application → Cache Storage toont enkel nog `blitz-planning-v9`).

- [ ] **Step 3: Commit**

```bash
git add public/sw.js
git commit -m "chore: service-worker cache-versie v8 → v9 (Inventaris-herwerking)"
```
