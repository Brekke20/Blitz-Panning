# Thema's als uploadbare pakketten — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feestthema's worden data (uploadbare pakketten zonder code) die de beheerder in Beheer → Thema's aan/uit zet, met negen voorgeladen thema's en een themaskin in Blitz Run per thema.

**Architecture:** Eén pure kernmodule (`kern/themapakket.js` + `kern/themapakket-validatie.js`) bevat periodes, overlap en validatie en wordt gedeeld door client en server, net als `spel/spel-regels.js`. De server bewaart de index en de pakketten in Blobs en zaait de negen pakketten uit `netlify/themas/`. De client cachet ze in `localStorage` en bouwt de versiering met een vaste set bewegingsbouwers. SVG wordt opgebouwd met `createElementNS` uit een whitelist, nooit uit een string.

**Tech Stack:** Vanilla ES-modules (PWA in `public/`), Netlify Functions v2 + Netlify Blobs, `node --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-themas-upload-design.md`. Beslissing: `docs/adr/0001-themas-als-pakket-zonder-code.md`. Begrippen: `GLOSSARY.md`.

## Global Constraints

- Tak `feat/themas` vanaf `main`, in een worktree (`.claude/worktrees/themas`). Elke subagent begint zijn commando's met `cd` naar die worktree en controleert `git branch --show-current` = `feat/themas` vóór elke commit. Nooit pushen; release enkel na Brents uitdrukkelijke ja (taak 10).
- Een pakket bevat nooit code: geen `innerHTML`/`insertAdjacentHTML`/`outerHTML` met pakketinhoud, geen `href`, `style`-attribuut, `on*`, `<script>`, `<foreignObject>`, `<use>` of `<image>` uit een pakket. Tekst uit een pakket alleen via `textContent`. Kleuren alleen via `style.setProperty` na validatie.
- Limieten (letterlijk uit de spec): pakket ≤ **512 kB** (JSON-tekst), rasterbeeld ≤ **200 kB**, POST-body ≤ **600 kB** (anders 413), `versiering` ≤ **8** elementen, alle bewegende elementen samen ≤ **16**, `hangen + kruipen` ≤ **3**, delen per vorm ≤ **400**, delen per pakket ≤ **3000**, `d` ≤ 20000 tekens, naam ≤ 40, versie ≤ 20, teksten ≤ 80, id `^[a-z0-9-]{2,30}$`, client-cache ≤ **1,5 MB**, voorladen van pakketten die binnen **14 dagen** beginnen.
- Rasterbeelden enkel `data:image/png|webp|jpeg`, met controle van de magic bytes; `image/svg+xml` geweigerd.
- Kleuren `^#[0-9a-f]{6}([0-9a-f]{2})?$` (hoofdletterongevoelig). Contour van een themaskin tegen `HEMEL` ≥ 3:1 (zelfde formule als `tests/spel-skins.test.mjs`).
- Periode: Belgische kalenderdag (Europe/Brussels), grenzen inclusief; overlap: kortste periode wint, bij een gelijke lengte de laatste start, daarna de alfabetische id.
- Skin-id's `halloween` en `kerst` blijven gelijk (bestaande ontgrendelingen).
- `node --test` zonder pad; `npx playwright test` na elke taak die een scherm raakt. Elk nieuw bestand onder `public/js` of `public/css` komt in dezelfde commit in `SHELL` van `public/sw.js`. Eager modules ook als `modulepreload` in `index.html`; lazy modules (Beheer, spel) enkel in `SHELL`. `CACHE_NAME` pas ophogen in taak 10.
- Nieuwe serverfunctie: rij in `netlify/lib/rechten.js` en `beveiligV2`; `tests/rechten.test.mjs` telt 51 functies.
- UI-teksten in het Nederlands; knoppen via `data-actie`, geen inline handlers.
- Een karakteriseringstest wijzig je enkel bewust, met commentaar waarom.

## Review Focus

1. **Een kwaadaardig of kapot pakket** (script in `d`, `javascript:` in een kleur, SVG als data-URI, een onbekende sleutel, 700 kB, `__proto__` als id) wordt geweigerd met een Nederlandse foutmelding per veld; de app toont dan gewoon het vorige of geen thema. Tests in taak 2 en taak 4.
2. **Lege of volle opslag**: geen cache, een kapotte JSON in `blitz_themas`, of `setItem` die gooit → de app start zonder thema en zonder fout; offline met cache → het thema verschijnt. Tests in taak 5.
3. **Thema uitgezet terwijl het loopt** → na de volgende herberekening (minuutklok of terugkeer naar de pagina) verdwijnt de versiering, is de skin niet meer ontgrendelbaar, en blijft een al ontgrendelde skin geldig. Tests in taak 6 en taak 8.
4. **Twee beheerders tegelijk** → de tweede `PATCH` krijgt 409 en de tab herlaadt met een melding; niets gaat verloren. Tests in taak 4 en taak 7.
5. **Datumgrenzen**: 31 oktober 23:59 en 1 november 00:00 Brussel (zomertijd ten einde), een periode over de jaarwissel, Pasen en Carnaval in 2026, 2027 en 2028. Tests in taak 1.

---

### Task 1: Periodes en actief thema (`kern/themapakket.js`)

**Files:**
- Create: `public/js/kern/themapakket.js`
- Test: `tests/themapakket.test.mjs`
- Modify: `public/sw.js` (SHELL), `public/index.html` (modulepreload: de module is eager zodra taak 6 haar importeert; zet ze nu al in SHELL, de preload in taak 6)

**Interfaces:**
- Produces:
  - `belgischeDag(datum: Date|number|string) → { jaar, maand, dag }` (verhuist uit `kern/evenementen.js`; daar voorlopig her-exporteren)
  - `periodeVoorJaar(periode, jaar) → { start: 'YYYY-MM-DD', einde: 'YYYY-MM-DD' }`; `periode` is `{ van:{maand,dag}, tot:{maand,dag} }` of `{ basis:'pasen', van:number, tot:number }`. Bij een vaste periode over de jaarwissel begint `start` in `jaar` en eindigt `einde` in `jaar+1`.
  - `effectievePeriode(thema: { periode, periodeOverride? }) → periode`
  - `isActief(thema: { aan, periode, periodeOverride? }, datum) → boolean` (false als `aan === false`)
  - `periodeLengte(periode, jaar) → number` (dagen, inclusief)
  - `actiefThema(datum, themas: Array<{ id, aan, periode, periodeOverride? }>) → thema | null` (overlapregel)
  - `actieveThemas(datum, themas) → thema[]` (alle actieve, voor de skins)
  - `volgendThema(datum, themas) → { thema, start } | null` (eerstvolgende start van een thema dat aan staat)
  - `vensterTekst(periode, jaar) → string` (bv. "1 tot 31 oktober", "1 december tot 6 januari", "29 maart tot 6 april 2026" voor beweeglijk)
- Consumes: `easterDate(year)` uit `public/js/kern/feestdagen.js`.

- [ ] **Step 1: Write the failing tests** (`process.env.TZ = 'Europe/Brussels'` bovenaan)
  - `isActief` voor halloween `{ van:{10,1}, tot:{10,31} }`: waar op `2026-10-31T23:59:00+01:00`, onwaar op `2026-11-01T00:00:00+01:00`, onwaar met `aan:false`.
  - Over de jaarwissel `{ van:{12,7}, tot:{1,6} }`: waar op 2026-12-31 en 2027-01-06, onwaar op 2027-01-07.
  - Pasen `{ basis:'pasen', van:-7, tot:1 }`: 2026 → `start '2026-03-29'`, `einde '2026-04-06'`; 2027 → `'2027-03-21'`/`'2027-03-29'`; 2028 → `'2028-04-09'`/`'2028-04-17'`.
  - Carnaval `{ basis:'pasen', van:-52, tot:-46 }`: 2026 → `'2026-02-12'`/`'2026-02-18'` (Aswoensdag 18 februari).
  - Overlap: sinterklaas (1-6 dec) wint van kerst (1 dec-6 jan) op 2026-12-03; nationale-feestdag (19-21 jul) wint van zomer (1 jul-31 aug) op 2026-07-20; bij een gelijke lengte wint de latere start, daarna de alfabetische id.
  - `periodeOverride` gaat voor `periode`; `periodeOverride: null` geeft de periode van het pakket.
  - `volgendThema` op 2026-11-02 met halloween en kerst aan → kerst met `start '2026-12-07'` (periode 7-31 dec); een uitgezet thema telt niet.
  - `vensterTekst` voor de drie vormen.
- [ ] **Step 2: Run** `node --test` → de nieuwe tests FAIL ("Cannot find module").
- [ ] **Step 3: Implement** `public/js/kern/themapakket.js` (puur: geen DOM, geen window, geen opslag). Datums als `'YYYY-MM-DD'`-strings vergelijken; Pasen-offsets met UTC-datumrekenkunde. Voor een datum in januari ook de periode van het vorige jaar toetsen (wraparound).
- [ ] **Step 4: Run** `node --test` → PASS (alle 871+ tests).
- [ ] **Step 5: Commit** `feat(themas): periodes en actief thema als pure kernmodule`

### Task 2: Pakketvalidatie (`kern/themapakket-validatie.js`)

**Files:**
- Create: `public/js/kern/themapakket-validatie.js`
- Test: `tests/themapakket-validatie.test.mjs`
- Modify: `public/sw.js` (SHELL)

**Interfaces:**
- Consumes: `HEMEL`, `RAND_KLEUR` uit `public/js/spel/skins.js`.
- Produces:
  - `valideerPakket(pakket: unknown, { tekstLengte?: number } = {}) → { ok: true, pakket } | { ok: false, fouten: Array<{ veld: string, fout: string }> }` (fouten in het Nederlands, bv. `{ veld: 'vormen.spin.delen[3].d', fout: 'Ongeldige tekening (enkel padcommando's en getallen).' }`)
  - Constanten: `MAX_PAKKET_BYTES = 524288`, `MAX_BEELD_BYTES = 204800`, `MAX_ELEMENTEN = 8`, `MAX_BEWEGEND = 16`, `PLAFONDS = { hoek: 4, hangen: 3, kruipen: 1, vliegen: 2, vallen: 12, opstijgen: 8, vuurwerk: 1, mist: 1 }`, `BEWEGINGEN = Object.keys(PLAFONDS)`, `DEEL_SOORTEN = ['path','circle','ellipse','rect','polygon','line','groep']`
  - `contrastVerhouding(kleurA: string, kleurB: string) → number`

**Schema-aanvulling op de spec:** een deel mag `transform` hebben (`^((translate|rotate|scale)\([-0-9.eE\s,]+\)\s*)+$`). Een `groep` heeft `delen` (één niveau diep) en een optionele `transform`. Zo kan de Halloween-scène (die nu `<g transform>` en `<use>` gebruikt) als gegevens. `<use>` wordt een herhaalde groep in het pakket. Een vulling met verloop: `vul: { verloop: 'lineair'|'radiaal', x1?, y1?, x2?, y2?, cx?, cy?, r?, stops: [{ op: 0..1, kleur }] }`, maximaal 8 stops.

- [ ] **Step 1: Write the failing tests**
  - Het minimale geldige pakket (formaat 1, id, naam, versie, periode, kleuren, één vorm, één `hoek`-element, spelskin) → `ok: true`.
  - Elk van deze geeft `ok:false` met het genoemde `veld`: onbekende sleutel op topniveau (`'onbekend'`); id `'Halloween!'` (`'id'`); id `'__proto__'`; `d: 'M0 0 <script>'`; kleur `'red'` en `'javascript:alert(1)'`; beeld `'data:image/svg+xml;base64,…'`; beeld met PNG-type maar JPEG-bytes; beeld > 200 kB; `versiering` met 9 elementen; `hangen: 3` + `kruipen: 1`; `vallen` met `aantal: 13`; 401 delen in één vorm; `teksten.wachtrijLeeg` van 81 tekens; ontbrekende `spelskin`; skin met `rand: '#2f4358'` (contrast < 3:1 met `HEMEL.boven`); `beeld: 'bestaatniet'`; `spelskin.extra` die naar een onbekende vorm verwijst; `transform: 'url(x)'`.
  - Pakket als JSON-tekst > 524288 bytes → fout `veld: 'pakket'` met "groter dan 512 kB" (`tekstLengte` meegeven).
  - `contrastVerhouding('#ffffff','#000000')` ≈ 21.
- [ ] **Step 2: Run** `node --test` → FAIL.
- [ ] **Step 3: Implement** de validator als één recursieve controle met een vaste lijst sleutels per object. Prototype-vervuiling voorkomen: enkel `Object.hasOwn`, nooit `in`. Magic bytes: PNG `89 50 4E 47`, JPEG `FF D8 FF`, WebP `RIFF....WEBP`, base64 decoderen met `atob` (client) of `Buffer` (server), te kiezen via `typeof atob`. Geeft bij `ok:true` een diepe kopie terug met enkel de toegelaten sleutels.
- [ ] **Step 4: Run** `node --test` → PASS.
- [ ] **Step 5: Commit** `feat(themas): validatie van themapakketten (enkel gegevens)`

### Task 3: Halloween- en Kerstpakket

**Files:**
- Create: `netlify/themas/halloween.blitzthema.json`, `netlify/themas/kerst.blitzthema.json`, `netlify/themas/pakketten.js`
- Test: `tests/themas-pakketten.test.mjs`

**Interfaces:**
- Consumes: `valideerPakket` (taak 2).
- Produces: `VOORGELADEN: ReadonlyArray<pakket>` uit `netlify/themas/pakketten.js` (imports `with { type: 'json' }`; taak 9 voegt er zeven aan toe).

- [ ] **Step 1: Write the failing tests**
  - Elk pakket in `VOORGELADEN` geeft `valideerPakket(p).ok === true` en `JSON.stringify(p).length <= 524288`; de id's zijn uniek.
  - Halloween: `periode` 1/10-31/10; `versiering` = `hoek` (beeld `web`, 4 hoeken), `hangen` (spin, 2), `kruipen` (spin, 1), `vliegen` (vleermuis, 1), `mist`; `kleuren.donker.accent === '#f97316'`, `kleuren.licht.accent === '#c2570c'`, `voorkeurThema: 'donker'`; `teksten` gelijk aan de huidige `LEGE_TEKSTEN.halloween` ("Geen spoken in de wachtrij.", "Geen spookbezoeken gepland deze week"); `spelskin` met de kleuren van de huidige halloween-skin in `skins.js` en `extra: 'heksenhoed'`.
  - De vormen `spin`, `vleermuis` en `web` bevatten exact de padstrings van de (niet-geëxporteerde) constanten `SPIN`, `VLEERMUIS` en `WEB` in `public/js/schermen/evenement-laag.js:23-25`. De test bevat daarvan een vastgelegde kopie, met als commentaar "karakterisering van de Halloween-vormen van v2.2.0", zodat hij blijft werken nadat taak 6 de constanten schrapt.
  - De vorm `scene` telt evenveel elementen per soort als `sceneSvg()` (cirkels, paden, rechthoeken; `<use>` uitgeschreven als groepen).
  - Kerst: periode 7/12-31/12; `versiering` met `vallen` (sneeuw) en `hangen` (kerstbal, 2) en `vliegen` (rendier, 1); `spelskin` met de kleuren van de huidige kerst-skin en `extra: 'kerstmuts'`.
- [ ] **Step 2: Run** `node --test` → FAIL.
- [ ] **Step 3: Maak de twee JSON-bestanden.** Zet de canvascode van `heksenhoed` en `kerstmuts` in `public/js/spel/skins.js` om naar padvormen in dezelfde coördinaten (box 0 0 100 100 relatief aan de paal; documenteer de box in `pakketten.js`). Neem de scène element per element over uit `evenement-scene.js`.
- [ ] **Step 4: Run** `node --test` → PASS.
- [ ] **Step 5: Commit** `feat(themas): Halloween en Kerst als pakket`

### Task 4: Server — opslag, zaaien en `/api/themas`

**Files:**
- Create: `netlify/lib/themas.js`, `netlify/functions/themas.js`
- Modify: `netlify/lib/rechten.js` (rij), `tests/rechten.test.mjs` (50 → 51, rij-assertion)
- Test: `tests/server-themas.test.mjs` (met `tests/nep-fetch.mjs`-patronen en een in-memory store zoals `tests/server-spel.test.mjs`)

**Interfaces:**
- Consumes: `valideerPakket`, `MAX_PAKKET_BYTES` (taak 2); `isActief`, `periodeVoorJaar`, `belgischeDag` (taak 1); `VOORGELADEN` (taak 3); `wijzigBlob` (`netlify/lib/blob-wijzig.js`); `logActiviteit(store, { gebruiker, actie, onderwerp, details })` (`netlify/lib/activiteit.js`); `datumBrussel` (`spel-regels.js`).
- Produces (`netlify/lib/themas.js`):
  - Sleutels `INDEX_SLEUTEL = 'themas/index'`, `pakketSleutel(id) = 'themas/pakket/' + id`
  - `pakketHash(pakket) → string` (sha256-hex van `JSON.stringify`)
  - `zaai(store, voorgeladen = VOORGELADEN) → Promise<index>` (best-effort; enkel id's die niet in `index.gezaaid` staan; nieuwe met `aan: true`)
  - `leesIndex(store) → Promise<{ versie, themas: [{ id, naam, aan, periode, periodeOverride, pakketHash, geuploadOp, geuploadDoor }], gezaaid: string[] }>`
  - `openbareLijst(index, datum, store) → Promise<{ versie, themas: [{ id, naam, aan, periode, periodeOverride, pakketHash }], pakketten: { [id]: pakket } }>` (pakketten van de thema's die nu actief zijn of binnen 14 dagen beginnen, `aan` of niet: de client beslist met `aan`)
  - `bewaarPakket(store, pakket, gebruiker, { nu }) → Promise<{ ok, nieuw: boolean, index }>` (behoudt `aan` en `periodeOverride` van een bestaand thema)
  - `wijzigThema(store, { id, aan?, periode?, versie }, gebruiker) → Promise<{ ok: true, index } | { ok: false, status: 404|409|422, ... }>`
- `netlify/functions/themas.js`: `maakHandler({ getStore, nu, auth, voorgeladen })`, `export const config = { path: '/api/themas' }`, `MAX_BODY = 614400`. Rechtenrij: `'themas': { GET: ALLE, POST: BEHEER, PATCH: BEHEER }`.

- [ ] **Step 1: Write the failing tests**
  - Rechten: GET mag voor alle vier de rollen; POST/PATCH als planner → 403; POST zonder `X-Blitz: 1` → geweigerd zoals bij andere schrijfroutes.
  - Eerste GET op een lege store zaait halloween en kerst (`aan: true`); na `PATCH { id:'halloween', aan:false }` en een nieuwe GET blijft halloween uit; een tweede GET zaait niets opnieuw (`gezaaid` ongewijzigd).
  - GET op 2026-10-15 geeft `pakketten.halloween`, niet `pakketten.kerst`; op 2026-11-25 wel kerst (binnen 14 dagen van 7 december).
  - `GET ?id=kerst` → het pakket; `?id=bestaatniet` → 404.
  - POST geldig nieuw pakket → 200, `nieuw: true`, `logActiviteit` met `actie: 'thema-upload'`; POST nieuwe versie van halloween → `aan` en `periodeOverride` blijven; POST ongeldig → 422 `{ fouten: [...] }`; body > 614400 bytes (ook zonder content-length) → 413; onleesbare JSON → 400.
  - PATCH met een verouderde `versie` → 409 `{ serverVersie }`; PATCH `periode: null` wist de override; PATCH met ongeldige periode → 422; elke PATCH logt `actie: 'thema-wijzig'`.
  - Een Blobs-fout → 503 `OPSLAG_STORING`; een zaaifout breekt de GET niet.
- [ ] **Step 2: Run** `node --test` → FAIL.
- [ ] **Step 3: Implement** `netlify/lib/themas.js` en de functie volgens het patroon van `netlify/functions/spel.js` (CORS via `maakCors`, `Cache-Control: no-store`, store `winkelNaam(req)` met `consistency: 'strong'`). Index en pakket in twee aparte blobs. De index via `wijzigBlob`. Optimistic locking op `index.versie`, zoals `fotos.js`.
- [ ] **Step 4: Run** `node --test` → PASS. Controleer ook dat `netlify/functions/themas.js` de JSON-imports bundelt: `npx netlify functions:build --src netlify/functions --functions-dist $TMPDIR/themas-build` (geen fout over `with { type: 'json' }`).
- [ ] **Step 5: Commit** `feat(themas): /api/themas met zaaien, upload en aan/uit`

### Task 5: Client-cache en themabron

**Files:**
- Create: `public/js/kern/themas-cache.js` (puur, opslag meegegeven), `public/js/schermen/themas-bron.js` (fetch + cache)
- Test: `tests/themas-cache.test.mjs`
- Modify: `public/sw.js` (SHELL), `e2e/helpers.mjs` (stub `themas` in `maakStandaardStubs()`: geeft `{ versie: 1, themas: [halloween-rij], pakketten: { halloween } }` met het pakket uit `netlify/themas/halloween.blitzthema.json`; overschrijfbaar)

**Interfaces:**
- Consumes: `actiefThema`, `periodeVoorJaar` (taak 1); `valideerPakket` (taak 2).
- Produces:
  - `kern/themas-cache.js`: `CACHE_SLEUTEL = 'blitz_themas'`, `ACTIEF_SLEUTEL = 'blitz_thema_actief'`, `MAX_CACHE_BYTES = 1572864`; `leesCache(opslag) → { index, pakketten } | null` (kapotte JSON → null; elk pakket opnieuw gevalideerd, ongeldige weggelaten); `bewaarCache(opslag, { index, pakketten }, { datum }) → boolean` (bij overschrijding enkel het actieve pakket; `setItem` die gooit → false); `actiefRecord(index, pakketten, datum) → { id, tot: 'YYYY-MM-DD', kleuren, voorkeurThema } | null`; `bewaarActiefRecord(opslag, record)`.
  - `schermen/themas-bron.js`: `laadThemas({ datum = new Date() } = {}) → Promise<{ index, pakketten }>` (GET `/api/themas`, haalt `?id=` op voor een gewijzigde `pakketHash` die nog niet in het antwoord zit, bewaart de cache; bij een netwerkfout de cache; zonder cache `{ index: null, pakketten: {} }`); `themasNu() → { index, pakketten }` (laatst gekend, synchroon); `zetVoorbeeld(pakket|null)` / `voorbeeld() → pakket|null` (enkel in het geheugen).

- [ ] **Step 1: Write the failing tests** (`tests/themas-cache.test.mjs`, nep-opslag)
  - Geen sleutel → `leesCache` null; `'{kapot'` → null; een pakket met `d: '<script>'` in de cache wordt weggelaten.
  - `bewaarCache` met 2 MB aan pakketten op 2026-10-15 → bewaart enkel halloween, geeft true; een opslag die gooit → false, zonder exceptie.
  - `actiefRecord` op 2026-10-15 → `{ id:'halloween', tot:'2026-10-31', voorkeurThema:'donker', kleuren:{…} }`; met halloween `aan:false` → null.
- [ ] **Step 2: Run** `node --test` → FAIL.
- [ ] **Step 3: Implement** beide modules. `themas-bron.js` gebruikt `apiVerzoek` uit `kern/api.js` en geeft nooit een fout naar boven.
- [ ] **Step 4: Run** `node --test` → PASS; `npx playwright test --project=chromium` → alle specs groen (de nieuwe stub mag geen `onverwacht`-verzoek geven).
- [ ] **Step 5: Commit** `feat(themas): client-cache en themabron`

### Task 6: Data-gestuurde versieringslaag

**Files:**
- Create: `public/js/schermen/vorm-svg.js` (vorm → SVG-element), `public/js/schermen/versiering-bewegingen.js` (één bouwer per beweging)
- Modify: `public/js/kern/versiering-logica.js` (`beslis` op basis van het actieve pakket; `LEGE_TEKSTEN` en `MAX_SPINNEN` weg), `public/js/kern/versiering-thema.js` (sleutel op thema-id, ongewijzigde vorm), `public/js/schermen/evenement-laag.js` (herschreven tot dunne orkestratie), `public/css/evenement.css` (generiek op `:root[data-event]` met `--ev-accent*`), `public/index.html:20-27` (inline script leest `blitz_thema_actief`; geen `d.month === '10'` meer) en modulepreloads, `public/js/schermen/instellingen.js:152-169` (uitleg via `actiefThema`/`volgendThema`), `public/js/app.js` (start: `laadThemas()` en daarna `herbereken()`; minuutklok en `visibilitychange` blijven), `public/sw.js` (SHELL: nieuwe bestanden erbij, `evenement-scene.js` eruit)
- Delete: `public/js/schermen/evenement-scene.js`
- Test: `tests/versiering-logica.test.mjs` (aangepast), `tests/vorm-svg.test.mjs` (met een minimale DOM-shim of enkel de pure attribuutlijst `svgAttributen(deel)`), `e2e/versiering.spec.mjs` (aangepast), `e2e/versiering-bewegingen.spec.mjs` (nieuw)

**Interfaces:**
- Consumes: `themasNu`, `voorbeeld` (taak 5); `actiefThema` (taak 1).
- Produces:
  - `kern/versiering-logica.js`: `beslis({ nu, voorkeur, testMode, testForceer, soort, aanraak, reducedMotion, themas: { index, pakketten }, voorbeeld }) → { actief, thema: pakket|null, sober, beweging }` (`voorbeeld` gaat voor alles behalve `voorkeur === 'uit'`); `legeTekst(pakket, 'wachtrijLeeg'|'ingeplandLeeg', standaard)`; `STAP_MS = 33` blijft.
  - `schermen/vorm-svg.js`: `svgAttributen(deel) → Array<[naam, waarde]>` (puur, whitelist) en `vormNaarSvg(vorm, { klasse }) → SVGSVGElement` (enkel `createElementNS`; verlopen krijgen een unieke id per laag).
  - `schermen/versiering-bewegingen.js`: `BOUWERS: { [beweging]: (element, pakket, { laag, sober }) → { stap?(t): void, stop(): void } }` voor alle acht bewegingen uit de spec (§3.3). `hangen`/`kruipen`/`vliegen`/`mist` gedragen zich zoals nu in `evenement-laag.js` (kruiper 22 px/s, ontwijkt de muis binnen 90 px; vleermuis eerste vlucht na 4-12 s, pauze 15-45 s, vlucht voor de muis binnen 140 px). `vallen`/`opstijgen` gebruiken CSS-animaties met `steps()` (zoals de hangspinnen). `vuurwerk` = maximaal één pluim tegelijk, elke 6-14 s.
  - `evenement-laag.js` houdt zijn exports: `huidigeBeslissing`, `eventTekst`, `meetEvTop`, `bewaarThemaWissel`, `herbereken`, `zetVersieringAan`, `versieringAanVoorkeur`, `startVersiering`.
  - `data-event` op `<html>` = de id van het actieve thema.

- [ ] **Step 1: Write the failing tests**
  - Unit `beslis`: halloween in `themas` op 2026-10-05 → `thema.id === 'halloween'`, `beweging: true`; `voorkeur: 'uit'` → niets; `testMode` zonder `testForceer` → niets; halloween `aan:false` → niets; `voorbeeld` = kerst in oktober → kerst; `soort: 'gsm'` → `sober: true, beweging: false`.
  - Unit `svgAttributen`: een deel met `onload`, `href`, `style` of `xlink:href` geeft die nooit terug; `d` en `fill` wel.
  - E2e `versiering.spec.mjs`: dezelfde verwachtingen als nu (3 `.ev-spin`, `data-event="halloween"`, klikken door de laag, print, toggle, reduced motion, verborgen tab, 31 okt middernacht, sober op gsm, scène), maar gevoed door de `themas`-stub. Sleutels `blitz_theme_halloween_<jaar>` blijven werken.
  - E2e `versiering-bewegingen.spec.mjs`: een stubpakket per beweging (`vallen` 12, `opstijgen` 8, `vuurwerk`, `hoek` 4); het aantal elementen per beweging klopt en wordt nooit hoger dan `PLAFONDS`; op een gsm (sober) enkel `hoek` en achtergrond; met `aan:false` geen `#event-laag`; geen enkel `<script>`, `foreignObject` of `on*`-attribuut in `#event-laag` (via `page.evaluate`).
  - E2e eerste schermopbouw: met `blitz_thema_actief` in `localStorage` vóór de laad heeft `<html>` meteen `data-event` en de accentkleur, vóór de eerste `/api/themas`.
- [ ] **Step 2: Run** `node --test` en `npx playwright test --project=chromium e2e/versiering*.spec.mjs` → FAIL.
- [ ] **Step 3: Implement** de bovenstaande bestanden. In `evenement-laag.js` verdwijnen `SPIN`, `VLEERMUIS`, `WEB` en de import van `evenement-scene.js`. De scène-test uit taak 3 (die `sceneSvg()` importeert) krijgt de aantallen per soort als vastgelegde getallen, met hetzelfde karakteriseringscommentaar.
- [ ] **Step 4: Run** `node --test` en de volledige `npx playwright test` → PASS (`tests/sw-schil.test.mjs` controleert SHELL en preloads).
- [ ] **Step 5: Commit** `feat(themas): versiering gestuurd door het actieve themapakket`

### Task 6b: Instelling "Bewegende beelden" per gebruiker

**Files:**
- Modify: `public/js/kern/instellingen-regels.js` (veld `bewegingUit`: boolean; onbekend type → weigering "Ongeldige waarde voor bewegende beelden."), `netlify/lib/instellingen.js` (`INSTELLING_VELDEN` + `'bewegingUit'`), `public/js/schermen/instellingen.js` + `public/index.html` (schakelaar bij de persoonlijke instellingen, label "Bewegende beelden tijdens een thema", `data-wijzig`), `public/js/kern/versiering-logica.js` (`beslis` krijgt `bewegingUit`; dan `beweging: false`, stilstaande versiering blijft), `public/js/schermen/evenement-laag.js` (leest de instelling uit `kern.toestand` `settings`, herberekent bij een wijziging)
- Test: `tests/instellingen-regels.test.mjs` (of het bestaande testbestand van de regels), `tests/server-instellingen*.test.mjs`, `tests/versiering-logica.test.mjs`, `e2e/versiering.spec.mjs`

**Interfaces:**
- Consumes: `beslis` (taak 6), `settings` uit `kern.toestand`, instellingen-sync.
- Produces: instellingsveld `bewegingUit: boolean` (standaard `false`).

- [ ] **Step 1: Write the failing tests:** `valideerVelden({ bewegingUit: true })` → `{ waarden: { bewegingUit: true } }`; `'ja'` → fout; de server bewaart en geeft het veld terug; `beslis({ …, bewegingUit: true })` → `actief: true, beweging: false`; e2e: met `bewegingUit: true` in de instellingen-stub geen `.ev-beweeg`-elementen in de voorste laag, wel de achtergrond en de hoeken; de schakelaar zet het veld en de versiering past zich meteen aan zonder herladen; "Feestelijke versiering" uit gaat voor.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** volgens het bestaande patroon van de persoonlijke instellingen (bewaren via de bestaande instellingenroute; geen nieuwe serverfunctie).
- [ ] **Step 4: Run** `node --test` en `npx playwright test --project=chromium --workers=2 e2e/versiering.spec.mjs e2e/instellingen*.spec.mjs` → PASS.
- [ ] **Step 5: Commit** `feat(themas): bewegende beelden uit per gebruiker`

### Task 7: Beheer → Thema's

**Files:**
- Create: `public/js/schermen/beheer-themas.js`, `public/js/schermen/beheer-themas-logica.js` (puur: statustekst, kaartgegevens, periode-invoer naar periode)
- Modify: `public/js/schermen/beheer-tabs.js` (import na `beheer-systeemstatus.js`), `public/css/beheer.css`, `public/sw.js` (SHELL)
- Test: `tests/beheer-themas-logica.test.mjs`, `e2e/beheer-themas.spec.mjs`

**Interfaces:**
- Consumes: `registreerBeheerTab`, `h`, `beheerVerzoek`, `beheerFoutTekst`, `openBeheerVenster` (`schermen/beheer.js`); `valideerPakket` (taak 2); `actiefThema`, `periodeVoorJaar`, `vensterTekst` (taak 1); `zetVoorbeeld` (taak 5); `herbereken` (taak 6); `appConfirm`, `toast`.
- Produces: tab `{ id: 'themas', label: "Thema's", rollen: ['beheerder'] }`; `beheer-themas-logica.js`: `statusVan(thema, alle, datum) → { soort: 'actief'|'binnenkort'|'later'|'uit'|'overschaduwd', tekst }` (bv. "Nu actief", "Begint over 5 dagen", "Uit", "Loopt, maar Sinterklaas gaat voor"); `periodeUitInvoer({ soort, vanDatum, totDatum, vanDagen, totDagen }) → periode | { fout }`.

- [ ] **Step 1: Write the failing tests**
  - Unit `statusVan` voor alle vijf de soorten, en `periodeUitInvoer` (datums en dagen rond Pasen, "van na tot" over de jaarwissel geldig, lege velden → fout).
  - E2e (rol beheerder, stub `themas` stateful in de spec via `overschrijf`): de tab toont negen kaarten zodra taak 9 klaar is (nu twee); uploaden van een geldig pakket (`setInputFiles`) → nieuwe kaart; uploaden van een ongeldig pakket → foutlijst in het Nederlands, er wordt geen POST verstuurd; bestaande id → bevestiging "Nieuwe versie van Halloween uploaden?"; schakelaar uit → PATCH met `aan:false` en de status "Uit"; een 409 → melding en herladen; Periode aanpassen → PATCH met de nieuwe periode, en "terug naar standaard" → `periode: null`; Voorbeeld → `html[data-event]` wordt het thema, Stop voorbeeld → terug, geen schrijfverzoek; Downloaden → bestand `<id>.blitzthema.json` met het pakket.
  - `e2e/beheer-rollen.spec.mjs` blijft ongewijzigd groen (planner en sales zien geen "Thema's").
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** volgens het patroon van `beheer-systeemstatus.js` (volgnummer tegen races, `toonSkelet`, `beheerVerzoek`, `beheerFoutTekst`, `appConfirm` vóór uitzetten). Bestanden lezen met `File.text()`; vóór het verzenden valideren met `valideerPakket`; groter dan 512 kB → fout zonder verzenden.
- [ ] **Step 4: Run** `node --test` en `npx playwright test` → PASS.
- [ ] **Step 5: Commit** `feat(beheer): tab Thema's (upload, aan/uit, periode, voorbeeld, download)`

### Task 8: Blitz Run — themaskins uit pakketten

**Files:**
- Modify: `public/js/spel/skins.js` (event-skins en `EXTRAS` eruit; `themaSkins(pakketten)`; `tekenPaal` tekent `skin.extraVorm` met `Path2D`), `public/js/spel/spel-regels.js` (soort `'thema'`; `ontgrendelVoorwaarde` → "<Naam>-thema"), `public/js/spel/spel-ui.js:101,119-130` (lijst = basis + thema's), `public/js/spel/spel-opening.js`/`spel-voortgang.js` (afh `actieveThemas` + `skins` in plaats van `actieveEvenementen`), `public/js/app.js:57,153`, `netlify/lib/spel.js`, `netlify/functions/spel.js`
- Delete: `public/js/kern/evenementen.js` (en uit `SHELL`); `tests/evenementen.test.mjs` gaat op in `tests/themapakket.test.mjs`
- Test: `tests/spel-skins.test.mjs`, `tests/spel-regels.test.mjs`, `tests/server-spel.test.mjs` (aangepast), `e2e/spel.spec.mjs`

**Interfaces:**
- Consumes: `actieveThemas` (taak 1); `leesIndex`, `zaai` en pakket lezen (taak 4); `themasNu` (taak 5).
- Produces:
  - `skins.js`: `BASIS_SKINS` (de tien basis + goud, ongewijzigd); `themaSkins(pakketten: pakket[]) → skin[]` met `{ id: pakket.id, naam, soort: 'thema', behuizing, faceplate, bliksem, rand, extraVorm }`; `alleSkins(pakketten) → [...BASIS_SKINS, ...themaSkins(pakketten)]`; `SKINS` blijft als alias van `BASIS_SKINS`.
  - `spel-regels.js`: `ontgrendeldeSkins({ besteScore, bewaard, actieveThemaIds = [], skins })`. Een themaskin is open als zijn id in `actieveThemaIds` zit. `schoonVoortgang(r, skins)` ongewijzigd van vorm.
  - Server: `maakHandler({ getStore, nu, auth, themaBron })` met `themaBron(store, datum) → Promise<{ skins, actieveThemaIds }>` (standaard: leest index + pakketten uit de store, zaait indien nodig).

- [ ] **Step 1: Write the failing tests**
  - `spel-skins.test.mjs`: tien basis + één goud blijven; de oude assert "precies 1 halloween" wordt "elke themaskin uit `VOORGELADEN` haalt het contrast" (commentaar: event-skins verhuisd naar pakketten).
  - `spel-regels.test.mjs`: halloween open met `actieveThemaIds: ['halloween']`, dicht zonder; `bewaard: ['halloween']` blijft open zonder actief thema; `ontgrendelVoorwaarde` → "Halloween-thema".
  - `server-spel.test.mjs`: een record van v2.2.0 met `ontgrendeld: ['blitz','halloween']` en `gekozenSkin: 'halloween'` blijft na GET in november geldig (migratie); halloween uitgezet in de index op 2026-10-15 → niet nieuw ontgrendeld; POST met `gekozenSkin: 'kerst'` in december met kerst aan → bewaard.
  - E2e `spel.spec.mjs`: in de keuzerij staat een themaskin met slotje en "Kerst-thema".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Pad-extra's tekenen met `ctx.fill(new Path2D(d))` na `ctx.translate/scale` naar de paalbox uit taak 3. Andere deelsoorten zet je om naar een pad in `skins.js`: cirkel en ellips naar twee bogen, rechthoek en veelhoek naar M/L/Z. `spel.js` gebruikt `alleSkins(themasNu().pakketten)`.
- [ ] **Step 4: Run** `node --test` en `npx playwright test` → PASS.
- [ ] **Step 5: Commit** `feat(spel): themaskins uit de themapakketten; evenementenkalender vervalt`

### Task 9: De zeven nieuwe themapakketten

**Files:**
- Create: `netlify/themas/{nieuwjaar,valentijn,carnaval,pasen,zomer,nationale-feestdag,sinterklaas}.blitzthema.json`
- Modify: `netlify/themas/pakketten.js`, `tests/themas-pakketten.test.mjs`

**Interfaces:**
- Consumes: alles hierboven; elke beweging uit `PLAFONDS`.

Periodes en inhoud (uit spec §7):

| id | periode | versiering | skin (`extra`) |
|---|---|---|---|
| `nieuwjaar` | 1/1-6/1 | `vuurwerk`, `vallen` confetti goud/zilver (10), achtergrond nachtlucht | Feestpaal (feesthoedje) |
| `valentijn` | 10/2-14/2 | `opstijgen` hartjes (8), `hoek` hartjes (2) | Liefdespaal (hartje) |
| `carnaval` | pasen −52 tot −46 | `vallen` confetti veelkleurig (12), `hoek` slingers (2) | Carnavalspaal (masker) |
| `pasen` | pasen −7 tot +1 | `hoek` eieren (2), `opstijgen` bloesem (6) | Paaspaal (konijnenoren) |
| `zomer` | 1/7-31/8 | `hoek` zon (1), `opstijgen` bellen (6) | Zomerpaal (zonnebril) |
| `nationale-feestdag` | 19/7-21/7 | `hoek` driekleur-slingers (2), `vuurwerk` | Driekleurpaal (vlaggetje) |
| `sinterklaas` | 1/12-6/12 | `vallen` pepernoten (10), `hoek` mijter (1) | Sintpaal (mijter) |

- [ ] **Step 1: Write the failing test:** `VOORGELADEN` heeft precies negen id's (de lijst hierboven plus halloween en kerst), elk geldig, elk ≤ 512 kB; de periodes zijn gelijk aan de tabel; elk accent heeft contrast ≥ 3:1 met de achtergrond van de app in licht en donker (`#181e24` / `#f5f6f7`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Maak de zeven pakketten** (vectorvormen; geen rasterbeelden tenzij nodig).
- [ ] **Step 4: Run** `node --test` → PASS. Maak dan van elk thema een schermafdruk (desktop en gsm) via de app met de stub en het voorbeeld uit Beheer (`npx playwright test` met een tijdelijke spec onder de kladmap, niet in `e2e/`). Stuur ze naar Brent en **wacht op zijn akkoord per thema**; pas aan waar hij iets vraagt.
- [ ] **Step 5: Commit** `feat(themas): zeven nieuwe themapakketten`

### Task 10: Release v2.3.0

**Files:**
- Modify: `public/sw.js` (`CACHE_NAME` `blitz-planning-v37` → `blitz-planning-v38`), `tests/sw-schil.test.mjs` (verwachte naam), `package.json` (`2.3.0`), `CHANGELOG.md` (Added: thema's als pakket, Beheer → Thema's, negen thema's, themaskins; Changed: Kerst 7-31 december), `CLAUDE.md` (sectie "Feestelijke versiering" en Blitz Run event-skins herschrijven naar themapakketten)

- [ ] **Step 1:** `node --test` en de volledige `npx playwright test` (beide projecten) → alles groen; output bewaren voor het rapport.
- [ ] **Step 2:** Volledige eindreview van de tak (fresh reviewer, Opus), met nadruk op de veiligheidsregels uit Global Constraints.
- [ ] **Step 3:** Commit `release: v2.3.0 — thema's als uploadbare pakketten`.
- [ ] **Step 4:** Samenvatting voor Brent (opdrachtgever-samenvatting) en vraag om zijn uitdrukkelijke ja. Pas daarna: merge naar `main`, tag `v2.3.0`, push. Na de deploy: in Beheer → Thema's nagaan dat de negen thema's er staan en Halloween actief is.
