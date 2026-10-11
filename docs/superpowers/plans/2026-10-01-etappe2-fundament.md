# Etappe 2 — Fundament (`kern/`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `public/js/kern/` (tijd, ui, selecties, toestand, api + brug) bouwen en `public/index.html` er stapsgewijs op laten overgaan, plus twee bugfixes (afspraken-409, TEST-badge), zonder dat het zichtbare gedrag verandert.

**Architecture:**
- Kern-modules zijn pure ES-modules (importeerbaar in `node --test`); alleen `kern/brug.js` raakt `window` aan (`window.kern` + oude globale namen in een `LEGACY-BRUG`-blok).
- Globale toestand blijft voor de klassieke code bereikbaar onder dezelfde namen via `window`-accessors die de toestand lezen/schrijven; render-functies abonneren zich per functie op de sleutels waarvan ze afhangen.
- Elke taak eindigt groen: `npx playwright test` + `node --test`.

**Tech Stack:** vanilla ES-modules zonder bouwstap, `node --test`, `@playwright/test` (bestaand).

**Spec:** `docs/superpowers/specs/2026-10-01-etappe2-fundament-design.md`. Lees §2 (feiten, vooral de laadvolgorde) en §3 (rulings K1–K18) vóór Taak 1.

## Global Constraints

- Werk in de worktree `.claude/worktrees/planner-brein` (tak `refactor`). Prefix elke shell-opdracht met `cd "<worktree>" &&` en controleer vóór elke commit `git branch --show-current` = `refactor`. Nooit committen in de main-checkout. Niet pushen.
- Zichtbaar gedrag identiek (W5), behalve K12 (afspraken-409) en K13 (TEST-badge).
- Nooit echte Zoho-, TomTom- of mail-aanroepen. Zoho-paden (W11): request-payloads blijven byte-voor-byte gelijk en worden door een e2e geasserteerd vóór een call site migreert (K10).
- `rapport-wizard.js` en de andere bestaande modules worden niet gewijzigd (K15).
- Klassieke code op het hoogste niveau mag `window.kern` of accessors niet gebruiken (K3). Bij elke verhuizing: `grep -nE "^(let|const|var) .*<naam>"` en kijk of de naam buiten function-bodies wordt gebruikt.
- Tests: `npx playwright test` en `node --test` (zonder pad; nooit `node --test tests/`). Nieuwe unit-tests in `tests/` als `*.test.mjs`. Nieuwe e2e in `e2e/*.spec.mjs` die `test`/`expect` uit `./helpers.mjs` importeren; geen `waitForTimeout`, geen screenshots.
- Eén dev-/testserverproces: stop enkel je eigen PID.
- `public/sw.js`: nieuw kern-bestand erbij in `SHELL` in dezelfde commit; `CACHE_NAME`, `package.json`-versie en tags blijven onaangeroerd (K14, K17).
- Namen en commentaar in het Nederlands. Houd `sjLog(...)`-regels aan (K16).
- Commit-trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ledger: `.superpowers/sdd/2026-10-01-etappe2-fundament/`. Brief en diff als bestand naar subagents; terugmelding maximaal 15 regels.
- Modelkeuze per taak staat bij de taak (W12). Eindreview van de etappe: **opus**.

## Review Focus

1. **Renderlussen en -stormen**: abonnees die zelf een gesubscribed sleutel schrijven (bv. `buildPersonSelector` zet `activeAssigneeFilter` terug naar `'all'`), dubbele renders doordat een handmatige `renderX()` naast het abonnement bleef staan, flush buiten `metBehoudScroll`. Controleer de renderteller-e2e (Taak 6) en de lusbeveiliging.
2. **Gemiste abonnement of `raak()` → verouderd scherm**: elke in-place mutatie van een geabonneerde sleutel (`localEvents.push`, `avExceptions.push/splice`, `allTickets.sort`, …) heeft `raak(...)`; elke schrijf met toewijzing verwittigt vanzelf. Vergelijk de lijst in de commit met `grep`.
3. **Gewijzigde request-payload** (W11): per gemigreerde call site dezelfde methode, pad, body (veldnamen, waarden, volgorde niet vereist) en `Content-Type` alleen bij body. Zoho-paden alleen met geasserteerde payload.
4. **Tijdzone-afwijking**: `localISO`/`getWeekStart`/`extractLocalHour` gebruiken lokale getters; sentinel 00:00 (lokaal én UTC-`Z`); zomertijd 2026-03-29 en 2026-10-25; geen stille overstap naar UTC.
5. **Laadvolgorde/timing met het klassieke script**: `brug.js` is de eerste module; niets op het hoogste niveau van het klassieke script gebruikt `kern`, accessors of verhuisde functies (`settings`, `_bavFormDate` zijn bekende gevallen); `window.toast`/`escHtml` bestaan voor de andere modules draaien; `sw.js SHELL` compleet.

---

## Bestandsoverzicht

| Bestand | Rol |
|---|---|
| `public/js/kern/brug.js` (nieuw, Taak 1) | enige `window`-toewijzer: `window.kern`, legacy-namen, state-accessors |
| `public/js/kern/tijd.js` (nieuw, Taak 1) | datum-/tijdhulpen |
| `public/js/kern/ui.js` (nieuw, Taak 2) | `escHtml`, `toast`, `toastDuur`, `registreerActies` |
| `public/js/kern/selecties.js` (nieuw, Taak 3) | pure afleidingen |
| `public/js/kern/toestand.js` (nieuw, Taak 4) | observable store |
| `public/js/kern/api.js` (nieuw, Taak 7) | fetch-helpers + `bewaarMetVersie` |
| `tests/tijd.test.mjs`, `ui.test.mjs`, `selecties.test.mjs`, `toestand.test.mjs`, `api.test.mjs` (nieuw) | unit-tests |
| `e2e/kern.spec.mjs` (nieuw, Taken 2, 6, 8) | renderteller, delegatie-pilot, extra payload-asserties |
| `public/index.html` | geleidelijk over op kern |
| `public/js/planner.js` | importeert `timeStrToMin` uit `kern/tijd.js` (Taak 1) |
| `public/sw.js` | `SHELL` uitgebreid |
| `e2e/conflict-409.spec.mjs`, `e2e/rooktest.spec.mjs` | bewust bijgewerkt (Taak 9) |
| `CHANGELOG.md`, `CLAUDE.md` | Taak 9 |

## Interfaces (eindtoestand, gedeeld door alle taken)

```js
// kern/tijd.js
export function localISO(d)                       // 'YYYY-MM-DD' in lokale tijd
export function todayISO(nu = new Date())         // = localISO(nu)
export function getWeekStart(baseDate, offset)    // maandag 00:00 lokaal, offset in weken
export function timeStrToMin(hhmm)                // 'HH:MM' -> minuten
export function minToTimeStr(totalMin)            // minuten -> 'HH:MM' (mod 24u, `|| 0`)
export function extractLocalHour(interventieDatum) // 'HH:MM' lokaal, of null (00:00 lokaal of UTC-00:00 met 'Z')
export function fmtDate(s), fmtDateShort(d), fmtSec(s)

// kern/ui.js
export function escHtml(str)
export function toastDuur(msg, ms)                // pure: standaard 4000, fout (⚠|✕|mislukt|fout) 7000, ms mag enkel verlengen
export function toast(msg, ms)                    // DOM: #toast, klasse 'show'
export function registreerActies(wortel, handlers) -> () => void   // data-actie / data-arg, luistert op `wortel` (click)

// kern/selecties.js
export function isAlle(filter), persoonOfNull(filter)
export function ticketsVanTechnieker(tickets, filter)
export function planItemsVanTechnieker(items, filter)
export function eigenAfsprakenVoor(events, datum, filter, { alleenMetLocatie = false } = {})
export function stopsVoorDag({ planning, localEvents }, filter, date) -> { stops, localForDate, allStops }

// kern/toestand.js
export const SLEUTELS = ['allTickets','allPending','allGepland','planning','localEvents','avExceptions','klantBeschikbaarheid','voorstelStatus','settings','activeAssigneeFilter'];
export function maakToestand(begin = {}) -> { get, set, patch, raak, abonneer, transactie, spoel, zetOmhulling }
export const toestand

// kern/api.js
export class ApiFout extends Error { status; data }
export function zetFetch(fn)
export async function apiVerzoek(pad, { methode = 'GET', body, headers } = {}) -> { ok, status, data }
export async function apiJson(pad, { methode, body, headers } = {}) -> data
export async function bewaarMetVersie({ pad, veld, versie, waarde, voegSamen }) ->
  { ok: true, versie, waarde } | { ok: false, reden: 'conflict'|'http'|'netwerk', status?, versie, waarde }

// index.html (blijft)
function stopsVoorDag(date)                       // wrapper rond kern.selecties.stopsVoorDag
function koppelRenders()                          // één plek met alle abonnementen (Taak 6)
async function saveAfspraken({ toegevoegd = [], gewijzigd = [], verwijderd = [] } = {})  // Taak 9
```

---

### Task 1: `kern/tijd.js`, `kern/brug.js` en de laadkoppeling

**Aanbevolen model:** sonnet (maakt de brug en lost de laadvolgorde-valkuil op; gedrag exact bewaren)

**Files:**
- Maak: `public/js/kern/tijd.js`, `public/js/kern/brug.js`, `tests/tijd.test.mjs`
- Wijzig: `public/index.html`, `public/js/planner.js`, `public/sw.js`

**Interfaces:** `tijd.js` zoals hierboven. `brug.js` begint met:
```js
import * as tijd from './tijd.js';
window.kern = { tijd };
// LEGACY-BRUG (verdwijnt in etappe 5): oude globale namen voor klassieke code en oudere modules
Object.assign(window, { localISO: tijd.localISO, timeStrToMin: tijd.timeStrToMin, /* … */ });
```

- [ ] **Step 1: Inventaris.** Zoek de huidige definities in `index.html` (`localISO`, `getWeekStart`, `todayStr`, `timeStrToMin`, `minToTimeStr`, `extractLocalHour`, `fmtDate`, `fmtDateShort`, `fmtSec`). Noteer de regelnummers. Zoek **hoogste-niveau-gebruik**: `grep -nE "^(let|const|var) .*(localISO|todayStr|timeStrToMin|minToTimeStr|extractLocalHour|getWeekStart|fmtDate|fmtSec)"` (bekend: `let _bavFormDate = localISO(new Date());`, ~5612) en kijk ook naar IIFE's/`try`-blokken op hoogste niveau. Vergelijk `timeStrToMin` in `planner.js` met die in `index.html` (moet identiek zijn).
- [ ] **Step 2: Test eerst** (`tests/tijd.test.mjs`). Eerste regel `process.env.TZ = 'Europe/Brussels';` vóór alle `Date`-gebruik; een bewakingstest `new Date(2026, 6, 1, 12).getTimezoneOffset() === -120` (faalt luid als TZ niet gezet kon worden; fallback: de testrunner opnieuw starten met `TZ=Europe/Brussels` via `child_process`). Cases:
  - `localISO`: `new Date(2026, 2, 29, 0, 30)` → `'2026-03-29'`; `new Date(2026, 9, 25, 2, 30)` → `'2026-10-25'`; `new Date(2026, 0, 1)` → `'2026-01-01'`; lokale 00:30 geeft de lokale dag (niet de UTC-dag van gisteren).
  - `getWeekStart(new Date(2026, 2, 25), 1)` → maandag 2026-03-30 00:00 lokaal (over de zomertijdgrens); offset 0 op een zondag geeft de voorgaande maandag; uren op 0.
  - `timeStrToMin('08:30')` = 510; `minToTimeStr(510)` = `'08:30'`; `minToTimeStr(1500)` = `'01:00'`; `minToTimeStr(undefined)` = `'00:00'`.
  - `extractLocalHour`: `null`/`''` → `null`; `'2026-10-05T07:30:00+02:00'` → `'07:30'`; `'2026-10-05T22:00:00.000Z'` (= 00:00 lokaal 6 okt) → `null`; `'2026-10-05T00:00:00.000Z'` (UTC-middernacht met Z, backward compat) → `null`; `'2026-10-05T09:15:00.000Z'` → `'11:15'`; wintertijd `'2026-11-05T09:15:00.000Z'` → `'10:15'`.
  - `fmtDate`, `fmtDateShort`, `fmtSec`: vorm-asserties (jaar/maandafkorting aanwezig, `'2u'`-achtige uitkomsten van `fmtSec(3660)` = `'1u 1min'`, `fmtSec(300)` = `'5min'`); geen exacte ICU-tekst voor datums.
- [ ] **Step 3: `tijd.js` schrijven** door de bestaande implementaties letterlijk over te nemen (kopiëren, niet herschrijven). `todayISO` is nieuw en `= localISO(nu)`.
- [ ] **Step 4: `brug.js`** zoals in Interfaces, met alle negen namen + `todayStr: tijd.todayISO`. Voeg in `index.html`, **vóór** `<script type="module" src="/js/app-dialog.js">`, toe: `<script type="module" src="/js/kern/brug.js"></script>`.
- [ ] **Step 5: `index.html` omzetten.** Verwijder de negen/tien definities uit het klassieke script. Alle oproepen blijven kaal (via de brug). Los elk hoogste-niveau-gebruik op (Step 1): `let _bavFormDate = null;` en zet `_bavFormDate = localISO(new Date());` aan het begin van de `DOMContentLoaded`-handler (controleer dat niets vóór die handler `_bavFormDate` leest). `planner.js`: vervang de eigen `timeStrToMin` door `import { timeStrToMin } from './kern/tijd.js';` en verwijder de kopie.
- [ ] **Step 6: `sw.js`**: voeg `/js/kern/brug.js` en `/js/kern/tijd.js` toe aan `SHELL`.
- [ ] **Step 7: Run.** `node --test` (verwacht 136 + nieuwe, alles groen), `npx playwright test` → 37 passed, geen console-fouten.
- [ ] **Step 8: Commit** `refactor(kern): tijd.js en brug.js — datum/tijd-hulpen verhuisd (etappe 2)`. Noem de gevonden hoogste-niveau-gevallen in de body.

---

### Task 2: `kern/ui.js` (toast, escHtml, delegatie) met zeven pilot-knoppen

**Aanbevolen model:** haiku (kleine module met volledige instructie; mechanische vervanging van zeven attributen)

**Files:**
- Maak: `public/js/kern/ui.js`, `tests/ui.test.mjs`, `e2e/kern.spec.mjs`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`

**Interfaces:** `ui.js` zoals hierboven.

- [ ] **Step 1: Test eerst** (`tests/ui.test.mjs`): `escHtml(null)` → `''`; `escHtml('<a href="x">&\'')` → `'&lt;a href=&quot;x&quot;&gt;&amp;&#39;'`; `toastDuur('Opgeslagen')` = 4000; `toastDuur('✕ Mislukt')` = 7000; `toastDuur('⚠ kan niet')` = 7000; `toastDuur('Fout bij laden')` = 7000; `toastDuur('Ok', 9000)` = 9000; `toastDuur('Ok', 1000)` = 4000. `registreerActies` met een nep-wortel (`{ addEventListener(t, fn){...}, removeEventListener }`) en een nep-event waarvan `target.closest('[data-actie]')` een element met `dataset: { actie: 'a', arg: '-1' }` teruggeeft: handler `a` wordt één keer opgeroepen met `(el, event, '-1')`; onbekende actie of geen `closest` → niets; de teruggegeven functie meldt de luisteraar af.
- [ ] **Step 2: `ui.js` schrijven.** `escHtml` en `toast` letterlijk uit `index.html` (zoek ze; `toastTimer` wordt moduleniveau-`let`). `toast` gebruikt `toastDuur`. `registreerActies(wortel, handlers)`: `wortel.addEventListener('click', e => { const el = e.target?.closest?.('[data-actie]'); const h = el && handlers[el.dataset.actie]; if (h) h(el, e, el.dataset.arg); })`; retourneert de afmeld-functie.
- [ ] **Step 3: Brug.** In `brug.js`: `window.kern.ui = ui;` en in het LEGACY-blok `escHtml`, `toast`. Verwijder `escHtml` en `toast` (+ `toastTimer`) uit het klassieke script. Controleer met grep dat `escHtml`/`toast` niet op het hoogste niveau van het klassieke script of van een andere module **tijdens het laden** worden opgeroepen (buiten functies); `brug.js` draait toch eerst.
- [ ] **Step 4: Pilot.** In `index.html` (geverifieerde plaatsen; zoek op de huidige regel): `onclick="togglePersonMenu()"` (#person-btn), `onclick="loadTickets()"` (↺), `onclick="toggleTheme()"`, `onclick="openSettings()"`, `onclick="kalNav(-1)"`, `onclick="kalNav(1)"`, `onclick="kalToday()"` → telkens `data-actie="..."` (resp. `persoon-menu`, `vernieuw`, `thema`, `instellingen`, `kal-nav` met `data-arg="-1"`/`"1"`, `kal-vandaag`) in plaats van `onclick`. Aan het begin van de `DOMContentLoaded`-handler: `kern.ui.registreerActies(document.body, { 'persoon-menu': () => togglePersonMenu(), vernieuw: () => loadTickets(), thema: () => toggleTheme(), instellingen: () => openSettings(), 'kal-nav': (el, e, arg) => kalNav(Number(arg)), 'kal-vandaag': () => kalToday() })`. Wijzig niets anders aan die elementen.
- [ ] **Step 5: e2e** (`e2e/kern.spec.mjs`, `test.describe('kern: ui-delegatie')`): (a) `↺ Vernieuwen`-knop → opnieuw een `toast` "Testmodus actief" binnen 5 s (of `#cnt-tickets` blijft `3`); (b) persoonmenu opent en sluit via `#person-btn`, klik buiten sluit; (c) `Instellingen` opent het instellingenvenster; (d) kalender: `‹`/`›` verandert `#kal-label`, `Naar vandaag` zet terug. Gebruik rollen/labels uit de bestaande specs (`kalender.spec.mjs`, `laden-en-rol.spec.mjs`) als voorbeeld.
- [ ] **Step 6: `sw.js`** `/js/kern/ui.js` toevoegen. Run `node --test` en `npx playwright test` (alles groen, o.a. `inventaris`/rapportwizard als bewijs dat `window.toast`/`escHtml` voor de andere modules bestaan).
- [ ] **Step 7: Commit** `refactor(kern): ui.js — toast, escHtml en actie-delegatie (pilot, 7 knoppen)`.

---

### Task 3: `kern/selecties.js`

**Aanbevolen model:** sonnet (equivalentie van filters moet exact bewezen worden)

**Files:**
- Maak: `public/js/kern/selecties.js`, `tests/selecties.test.mjs`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`

**Interfaces:** `selecties.js` zoals hierboven.

- [ ] **Step 1: Inventaris** (`grep -n "activeAssigneeFilter" public/index.html`). Classificeer elke regel in de commit-notitie als: (A) `lijst.filter(t => activeAssigneeFilter === 'all' || t.assignee === activeAssigneeFilter)`; (B) hetzelfde op `p.ticket.assignee`; (C) afspraken-filter `!e.persoon || e.persoon === filter` (met of zonder `(e.adres || e.notitie)`); (D) `myPerson = filter === 'all' ? null : filter`; (E) **afwijkend** (bv. rond regel 2301 `matchRespToPerson(...)`, `activeAssigneeFilter !== 'all' && e.person === ...` voor blokkeringen, UI-labels): niet aanraken.
- [ ] **Step 2: Test eerst** (`tests/selecties.test.mjs`): per functie een tabel: filter `'all'` geeft alles; filter `'Tim'` geeft alleen Tim; ongetrouwde `persoon: null` blijft in `eigenAfsprakenVoor` bij een filter; `alleenMetLocatie` sluit events zonder `adres` én `notitie` uit; `stopsVoorDag` levert voor een vaste `planning`/`localEvents` exact dezelfde `{stops, localForDate, allStops}` als de oorspronkelijke functie (kopieer de bestaande functie als `const oud = ...` in de test en vergelijk met `deepEqual` over meerdere filters/datums); `allStops` gesorteerd op `uur` met `'99:99'` voor ontbrekend uur; `item` is hetzelfde object (referentie, `assert.equal`).
- [ ] **Step 3: `selecties.js` schrijven** door de bestaande uitdrukkingen over te nemen. `persoonOfNull`: `filter === 'all' ? null : filter`.
- [ ] **Step 4: Overzetten.** `stopsVoorDag(date)` in `index.html` wordt een wrapper: `return kern.selecties.stopsVoorDag({ planning, localEvents }, activeAssigneeFilter, date);`. Vervang de A-, B-, C-, D-patronen één voor één door de helpers (`kern.selecties.ticketsVanTechnieker(allTickets, activeAssigneeFilter)` enz.). Laat E staan. Wijzig per commit-stap hooguit één patroonklasse en draai tussendoor `npx playwright test e2e/kalender.spec.mjs e2e/route.spec.mjs e2e/laden-en-rol.spec.mjs`.
- [ ] **Step 5: `brug.js`** `window.kern.selecties`; `sw.js` toevoegen. Run `node --test` en `npx playwright test`.
- [ ] **Step 6: Commit** `refactor(kern): selecties.js — technieker-filters en stopsVoorDag (etappe 2)`. Body: tellingen vóór/na per patroonklasse en de lijst met bewust ongemoeide E-regels.

---

### Task 4: `kern/toestand.js` (puur, nog niet gekoppeld)

**Aanbevolen model:** sonnet (concurrency-achtige details: bundelen, re-entrancy, lusbeveiliging)

**Files:**
- Maak: `public/js/kern/toestand.js`, `tests/toestand.test.mjs`
- Wijzig: `public/js/kern/brug.js` (`window.kern.toestand`), `public/sw.js`

**Interfaces:** `toestand.js` zoals hierboven. Gedrag:
- `get(k)`: huidige waarde (live referentie). `set(k, v)`: onbekende sleutel → `Error`; `Object.is` gelijke primitieve → geen verwittiging; anders waarde zetten en `k` als gewijzigd noteren. `patch(k, deel)`: `set(k, { ...get(k), ...deel })`. `raak(k)`: noteert `k` zonder wijziging.
- `abonneer(sleutels, fn)`: `fn(gewijzigdSet)` draait **één keer per flush** als minstens één van de sleutels wijzigde; registratievolgorde; retourneert de afmeld-functie. Een abonnee die gooit: `console.error` en de rest gaat door.
- Bundelen: de eerste wijziging plant `queueMicrotask(spoel)`. `transactie(fn)`: tellers voor nesting; geen microtask-flush binnenin; bij het einde van de buitenste transactie (ook bij een fout, in `finally`) `spoel()`. `spoel()`: voert openstaande wijzigingen uit (ronde voor ronde); wijzigingen tijdens een flush gaan naar een volgende ronde; na 10 rondes `console.error('toestand: renderlus afgebroken', sleutels)` en de resterende wijzigingen worden gewist. `zetOmhulling(fn)`: elke flush draait als `fn(() => echteFlush())`.

- [ ] **Step 1: Test eerst** (`tests/toestand.test.mjs`, met `await Promise.resolve()` om microtasks af te wachten): bundelen (3 `set`s op twee sleutels → 1 aanroep van een abonnee op beide); `gewijzigd` bevat de juiste sleutels; identieke primitieve → geen aanroep; identiek object (`raak`) → wel aanroep; `patch` maakt een nieuw object; onbekende sleutel gooit; `transactie` spoelt synchroon bij het einde en niet eerder, ook met nesting en met een fout; abonnee die een andere sleutel schrijft → tweede ronde; abonnee die zijn eigen sleutel blijft schrijven → afgebroken na 10 rondes met `console.error` (vang via `mock.method(console, 'error')`); gooiende abonnee breekt een tweede niet; afmelden werkt; `zetOmhulling` wikkelt de flush; registratievolgorde bepaalt uitvoervolgorde.
- [ ] **Step 2: `toestand.js` schrijven.** `BEGINWAARDEN`: lijsten `[]`, objecten `{}`, `activeAssigneeFilter: 'all'`, `settings: null`.
- [ ] **Step 3: Brug**: `window.kern.toestand = toestand`; `sw.js` toevoegen. (Nog geen accessors, nog geen index.html-wijziging.)
- [ ] **Step 4: Run** `node --test` en `npx playwright test` (ongewijzigd groen). **Step 5: Commit** `feat(kern): toestand.js — observable store met gebundelde verwittiging`.

---

### Task 5: De tien sleutels naar de toestand (accessors, nog zonder abonnementen)

**Aanbevolen model:** sonnet (veel schrijfplaatsen; in-place mutaties opsporen)

**Files:** Wijzig `public/js/kern/brug.js`, `public/index.html`.

**Interfaces:** `brug.js` krijgt
```js
function installeerToestandAlsGlobals(toestand, sleutels) {
  for (const k of sleutels) Object.defineProperty(window, k, {
    configurable: true, enumerable: true,
    get: () => toestand.get(k), set: v => toestand.set(k, v),
  });
}
```
aangeroepen met `SLEUTELS`. `index.html` verliest per sleutel de `let ...` (let op: een resterende `let` met dezelfde naam **overschaduwt** de accessor).

- [ ] **Step 1: Inventaris per sleutel.** Voor elke van de tien sleutels, in de commit-notitie: (a) de `let`-regel; (b) hoogste-niveau-gebruik (`let settings = loadPersonSettings(...)` ~884 is bekend: wordt `let`-loos en `kern.toestand.set('settings', loadPersonSettings(localStorage.getItem('blitz_active_person') || 'all'))` als eerste regel van `DOMContentLoaded`, vóór `activeAssigneeFilter = ...`; controleer dat geen functie vóór die handler `settings` leest, bv. `applyKaartStijl`); (c) alle **in-place mutaties**: `grep -nE "\b<k>(\.(push|splice|sort|reverse|pop|shift|unshift|length *=)|\[[^\]]+\] *=[^=]|\.[a-zA-Z_]+ *=[^=])"`; (d) alle andere modules die de sleutel lezen (`grep` in `public/js/`).
- [ ] **Step 2: Installeren.** Voeg de accessors toe in `brug.js`. Verwijder in dezelfde commit de tien `let`-declaraties (alleen de declaratie, niet de companion-variabelen zoals `localEventsVersie`, `kbVersie`, `_voorstelStatusVersie`).
- [ ] **Step 3: Gedrag houdt stand.** Draai de volledige e2e. Verwacht: alles groen, geen `ReferenceError` in de console. Faalt iets op "x is not defined" op het hoogste niveau, dan is dat een K3-geval: verplaats de initialisatie naar `DOMContentLoaded`.
- [ ] **Step 4: Schrijfwijze herkennen.** Voeg nog **geen** `raak()` toe (er zijn nog geen abonnementen); noteer enkel de in-place lijst uit Step 1(c) in de ledger voor Taak 6.
- [ ] **Step 5: Run** `node --test`, `npx playwright test`. **Commit** `refactor(kern): tien toestandssleutels via window-accessors op de toestand`.

---

### Task 6: Renders aan de toestand koppelen (`koppelRenders`)

**Aanbevolen model:** sonnet (kernrisico van de etappe: renderlussen, dubbele renders, scroll)

**Files:** Wijzig `public/index.html`; maak `e2e/kern.spec.mjs` uit (aanvullen).

- [ ] **Step 1: Inventaris van de ketens.** Lees `_applyTicketsData`, `selectPerson`, `loadAfspraken`, `loadAvailability`, `saveAfspraken`, `saveAvailability`, `confirmImport`, `submitManueel`/`removeLocalEvent`, `avAddException` (+ varianten) en alle plaatsen die `renderKalender()`/`renderTickets()`/`renderGepland()`/`renderRouteList(`/`updateRouteBtns(`/`renderInventaris(` direct na het schrijven van een sleutel aanroepen. Vul spec §5 bij of corrigeer ze op basis van de echte code (bv. leest `renderTickets` ook `allPending`?). Documenteer afwijkingen in de ledger. **Regel:** een abonnement doet precies wat de code nu na die schrijf doet.
- [ ] **Step 2: Renderteller-e2e eerst** (`e2e/kern.spec.mjs`, `test.describe('kern: renders')`): met `page.evaluate` de globale functies omwikkelen (`const o = window.renderKalender; window.__n = {}; window.renderKalender = (...a) => { window.__n.kalender++; return o(...a); }` enz. voor `renderKalender`, `renderTickets`, `renderGepland`, `renderRouteList`). Cases: (a) technieker wisselen via `#person-btn` → `Tim`: elk van de vier telt **precies 1** extra render; (b) `↺ Vernieuwen` → elk 1 (`_applyTicketsData`); (c) een eigen afspraak toevoegen → `renderKalender` precies 1, `renderTickets` 0; (d) na elk van deze acties geen console-fouten. Draai de test op de **huidige** code om de uitgangswaarden te bepalen; pas de verwachte aantallen aan op wat de code vandaag doet (de test legt vast, het abonneren mag het aantal niet verhogen).
- [ ] **Step 3: `koppelRenders()` schrijven** (één functie, bovenaan aangeroepen in `DOMContentLoaded`, na de accessors/settings-init): `kern.toestand.zetOmhulling(draai => metBehoudScroll(draai))` en per render-functie één `kern.toestand.abonneer([...unie van sleutels], () => renderX(...))` in de volgorde van de huidige aanroepen (zie spec §5). `renderRouteList`/`updateRouteBtns` lezen `document.getElementById('plan-date').value` zoals nu.
- [ ] **Step 4: Handmatige ketens vervangen.** In `_applyTicketsData`: de schrijfacties (`allTickets = ...`, planning-herseed + `raak('planning')` niet nodig) in `kern.toestand.transactie(() => {...})`; de render-aanroepen op het einde verwijderen (de transactie spoelt synchroon aan het einde, binnen `metBehoudScroll` zoals voorheen); de overige code na de renders (`reconcile`, `gcKlantBeschikbaarheid`, `_lastTicketLoad`) blijft erna staan. In `selectPerson`: na `activeAssigneeFilter = name` en `settings = ...` de render-aanroepen verwijderen en de functie in `transactie` wikkelen (de niet-render-neveneffecten `applyKaartStijl`, `localStorage`, `zetPersonMenuOpen` blijven). `loadAfspraken`/`loadAvailability`: `metBehoudScroll(renderKalender)` vervalt waar een schrijf van `localEvents`/`avExceptions` volgt; zorg dat ze precies **één** verwittiging per load geven (cache + server geven vandaag twee renders; het aantal mag niet stijgen). Aanroepers van `saveAfspraken`/`saveAvailability` e.d.: de `renderKalender()` direct na `localEvents.push(...)`/`splice` vervalt en wordt vervangen door `kern.toestand.raak('localEvents')` (in-place) of niets (toewijzing). Plaatsen die direct na het schrijven het DOM lezen: `kern.toestand.spoel()`.
- [ ] **Step 5: Lus- en randgevallen controleren.** `buildPersonSelector()` kan `activeAssigneeFilter` terugzetten: controleer in de e2e dat dit (technieker bestaat niet meer) niet tot een lus leidt (de renderteller-test mag hiervoor een extra case krijgen: `localStorage.blitz_active_person = 'Onbekend'` → app laadt, filter valt terug op `all`, tellers eindig). `settings`: enkel een abonnement toevoegen als de inventaris een uniforme keten toont (anders niet; log de keuze).
- [ ] **Step 6: Run** de hele e2e en `node --test`; extra: `npx playwright test --repeat-each=3 e2e/kern.spec.mjs e2e/kalender.spec.mjs` (stabiliteit). **Step 7: Commit** `refactor(kern): koppelRenders — schermen volgen de toestand (etappe 2)`. Body: tabel sleutel → renders zoals gerealiseerd, en de verwijderde handmatige aanroepen met aantal.

---

### Task 7: `kern/api.js` + niet-Zoho call sites

**Aanbevolen model:** sonnet (foutafhandeling per call site verschilt; identieke requests bewaken)

**Files:**
- Maak: `public/js/kern/api.js`, `tests/api.test.mjs`
- Wijzig: `public/js/kern/brug.js`, `public/index.html`, `public/sw.js`

**Interfaces:** `api.js` zoals hierboven. `apiJson`: bij `!res.ok` `throw new ApiFout(res.status, data)` (met `message = 'HTTP ' + status`). Geen toasts in `api.js` (puur); de oproeper toont ze met de bestaande teksten.

- [ ] **Step 1: Test eerst** (`tests/api.test.mjs`) met `zetFetch(nepFetch)`: `apiVerzoek` geeft `{ok:true,status:200,data}`; 500 → `{ok:false,status:500,data:null}`; netwerkfout gooit; `body` wordt `JSON.stringify` + `Content-Type: application/json`, zonder body **geen** `Content-Type`; `apiJson` gooit `ApiFout` met `.message === 'HTTP 404'`; `bewaarMetVersie`: (a) 200 → `{ok:true, versie: antwoord.versie, waarde}` en de body `{versie, [veld]: waarde}` met de juiste sleutelnaam; (b) 409 + `voegSamen` → tweede PUT met `server.versie` en samengevoegde waarde, resultaat `ok:true`; (c) 409 zonder `voegSamen` → `reden:'conflict'` met de serverstand; (d) 409 gevolgd door 409 → `reden:'conflict'`, `waarde`/`versie` = laatste stand; (e) 500 → `reden:'http', status:500`; (f) fetch gooit → `reden:'netwerk'`.
- [ ] **Step 2: `api.js` schrijven.** Gebruik `globalThis.fetch` laat-gebonden (zodat de testmodus-patch uit `<head>` en `zetFetch` beide werken).
- [ ] **Step 3: Bestaande payloads vastleggen.** Voor elke call site in de lijst van Step 4: bevestig dat een bestaande e2e de **volledige** body asserteert; zo niet, voeg in `e2e/kern.spec.mjs` een test toe die de actie uitvoert en `toEqual` op de hele body doet (Taak 8 doet dit voor de Zoho-paden). Doe dit **vóór** de migratie, op de oude code, en laat de test eerst slagen.
- [ ] **Step 4: Migreren** (telkens zelfde methode, pad, body; `Content-Type` alleen bij body; eigen `try/catch` en toasts blijven bij de oproeper): `loadVoorstelStatus` (GET), `laadPlanningSinds` (POST `/api/planning-sinds`), `loadAfspraken`, `loadKlantBeschikbaarheid`, `loadAvailability` (GET's), `saveAvailability` (PUT), `/api/matrix`, `/api/optimize` (3×), `/api/route`, `/api/drukte`. **`saveKlantBeschikbaarheid`** gaat over op `bewaarMetVersie({ pad: KB_API, veld: 'items', versie: kbVersie, waarde: klantBeschikbaarheid, voegSamen })` met `voegSamen = (server, lokaal) => { const merged = { ...server }; Object.assign(merged, lokaal); for (const id of kbLocallyDeleted) delete merged[id]; return merged; }`; daarna de oproeper: `klantBeschikbaarheid = result.waarde; kbVersie = result.versie;` en bij `ok` `kbLocallyDeleted.clear()`; foutafhandeling/toast `'✕ Klantbeschikbaarheid opslaan mislukt'` identiek. `e2e/conflict-409.spec.mjs` (klantbeschikbaarheid) is het bewijs en blijft **ongewijzigd** groen.
- [ ] **Step 5: Niet migreren** (K10): `/api/plan`, `/api/annuleer`, `/api/comment`, `/api/client-log`, `/api/testdata`, `/api/tickets`, `/api/fotos`, en alle andere modules. Noteer de reden per regel in de commit-body.
- [ ] **Step 6: `brug.js`** `window.kern.api`; `sw.js` toevoegen. Run `node --test` en `npx playwright test` (alles groen, `verzoeken.onverwacht` leeg).
- [ ] **Step 7: Commit** `refactor(kern): api.js en bewaarMetVersie — eerste call sites (etappe 2)`.

---

### Task 8: Zoho-gerelateerde call sites (met geasserteerde payloads)

**Aanbevolen model:** sonnet (W11: elke aanraking extra getest)

**Files:** Wijzig `public/index.html`, `e2e/kern.spec.mjs` en zo nodig bestaande specs (alleen asserties aanscherpen).

**Doelen** (enkel die met e2e-dekking; K10): `/api/plan-datum` (2×), `/api/propose`, `/api/voorstel-status` (POST en DELETE), `/api/send-rapport` en `/api/rapport-verzonden` **alleen zoals ze in `index.html` staan** (niet in `rapport-wizard.js`, K15).

- [ ] **Step 1: Per call site de bestaande assertie lezen** (`route.spec.mjs` voor `plan-datum`/`voorstel-status`, `voorstel-afspraak-blokkering.spec.mjs` voor `propose`, `instellingen-rapport.spec.mjs` voor `send-rapport`/`rapport-verzonden`). Is de assertie partieel (enkel enkele velden), verscherp ze tot een volledige `toEqual` op `body` (en `methode`), **op de huidige code**, en laat ze slagen.
- [ ] **Step 2: Ontbrekende dekking** (bv. de tweede `plan-datum`-site in het detailvenster, `DELETE /api/voorstel-status?ticketId=`): schrijf een e2e in `e2e/kern.spec.mjs` die de handeling uitvoert en pad, methode, query en body asserteert; faalt de handeling in testmodus omdat `TEST_MODE` ze afkapt, dan **niet migreren** en noteren.
- [ ] **Step 3: Migreren** naar `apiJson`/`apiVerzoek`, één site per stap; na elke stap `npx playwright test` voor de betrokken spec.
- [ ] **Step 4: Controle op identieke verzoeken.** Verifieer in de test-output (of met een tijdelijk `page.on('request')`-logje, daarna verwijderen) dat methode, pad, `content-type` en body gelijk zijn aan vóór de migratie.
- [ ] **Step 5: Run** de volledige suites. **Commit** `refactor(kern): Zoho-verkeer over op api.js met geasserteerde payloads (W11)`. Body: lijst gemigreerd / bewust gelaten, met reden.

---

### Task 9: Bugfixes, afronding en documentatie

**Aanbevolen model:** sonnet (K12 vergt zorgvuldige merge- en rollbacklogica)

**Files:** Wijzig `public/index.html`, `e2e/conflict-409.spec.mjs`, `e2e/rooktest.spec.mjs`, `CHANGELOG.md`, `CLAUDE.md`, `public/sw.js` (controle).

- [ ] **Step 1: Test eerst (K12).** Pas in `e2e/conflict-409.spec.mjs` de test `afspraken: ...` **bewust** aan en hernoem ze naar `afspraken: lokale wijziging wordt gemerged met de server-stand en herhaald`. Nieuwe verwachtingen: na het toevoegen van `Eigen wijziging` is er geen waarschuwingstoast en wel `✓ Afspraak opgeslagen`; de kalender toont zowel `Collega-afspraak` (dinsdag) als `Eigen wijziging` (maandag); `verzoeken.van('/api/afspraken','PUT')` heeft 2 stuks: de eerste met `versie 0` en alleen `['Eigen wijziging']`, de tweede met `versie 5` en `['Collega-afspraak','Eigen wijziging']`. De rest van de test (tweede toevoeging op de server-versie) blijft; pas de verwachte volgorde/aantallen aan. Voeg een tweede test toe voor **verwijderen met 409** (`removeLocalEvent` na een conflict verwijdert enkel het gekozen id; de collega-afspraak blijft) en een voor **wijzigen met 409** (`gewijzigd` overschrijft op id). Voeg een test toe voor een **dubbele 409** (de stub antwoordt twee keer 409): waarschuwing `⚠ Iemand anders wijzigde dit net. De afspraken zijn opnieuw geladen.` en geen derde PUT. Laat ze falen op de oude code (rode run).
- [ ] **Step 2: Implementatie.** `saveAfspraken({ toegevoegd = [], gewijzigd = [], verwijderd = [] } = {})` gebruikt `bewaarMetVersie({ pad: AFG_API, veld: 'afspraken', versie: localEventsVersie, waarde: localEvents, voegSamen })` met `voegSamen(server, lokaal)`: begin van de serverlijst; verwijder ids uit `verwijderd`; vervang per `gewijzigd` op id (bestaat het id niet meer op de server: toevoegen); voeg `toegevoegd` toe als het id nog niet voorkomt. Na afloop: `localEvents = result.waarde; localEventsVersie = result.versie;` (ook bij `ok:false, reden:'conflict'`, zodat de server-stand zichtbaar wordt). Bij `reden:'conflict'` de bestaande toast en `return false`; bij andere fouten `'✕ Afspraken opslaan mislukt'`. Behoud `console.error('Afspraken opslaan mislukt:', err)`-gedrag. De vier aanroepers geven hun wijziging mee (`confirmImport`: `{toegevoegd: nieuweItems}`; bewerken: `{gewijzigd: [nieuwEvent]}`; nieuw: `{toegevoegd: [event]}`; `removeLocalEvent`: `{verwijderd: [id]}`) en hun rollbacks werken op **id** (`findIndex` op id op het moment van de rollback; teruggezette verwijdering enkel als het id niet al aanwezig is).
- [ ] **Step 3: TEST-badge (K13).** `style.display = ''` → `'inline-block'`. Haal in `e2e/rooktest.spec.mjs` de `test.fixme`, de commentaar erboven en de bijbehorende bevinding in de eerste test weg; `TEST-badge is zichtbaar` wordt een gewone test; de eerste test assert `toBeVisible()` i.p.v. enkel `toHaveText`.
- [ ] **Step 4: SHELL-controle.** `public/sw.js SHELL` bevat `/js/kern/brug.js`, `toestand.js`, `selecties.js`, `tijd.js`, `api.js`, `ui.js`; `CACHE_NAME` ongewijzigd.
- [ ] **Step 5: Documentatie.** `CHANGELOG.md`, sectie "Refactor-tak — nog niet uitgebracht": onder **Fixed**: "Afspraken opslaan bij een gelijktijdige wijziging door een collega: de eigen wijziging gaat niet meer verloren maar wordt samengevoegd met de nieuwe stand en opnieuw bewaard." en "De TEST-badge in de kop is nu zichtbaar in de testmodus."; onder **Changed**: "Interne herstructurering: gedeelde fundamenten in `public/js/kern/` (tijd, selecties, toestand met automatisch hertekenen, api, ui)." `CLAUDE.md`: korte sectie "Kern (`public/js/kern/`)": pure modules, `brug.js` als enige `window`-plek (LEGACY-BRUG verdwijnt in etappe 5), regel K3 (geen kern-gebruik op het hoogste niveau van het klassieke script), `raak()` bij in-place mutaties, abonneren in `koppelRenders()`, `node --test` `TZ`-opmerking.
- [ ] **Step 6: Volledige run.** `node --test` en `npx playwright test` groen; `npx playwright test --repeat-each=2` voor stabiliteit. Geen verzoek naar buiten (`verzoeken.onverwacht` leeg in alle specs).
- [ ] **Step 7: Commit** `fix(afspraken,test-badge): 409 merge+retry en zichtbare TEST-badge; kern-documentatie (etappe 2)`.

---

## Na de taken

- Etappe-eindreview: **opus**, op het volledige diff van etappe 2, met de Review Focus hierboven. Resultaat in de ledger.
- `git merge main` (bugfixes) en volledige test; ledger bijwerken in `.superpowers/sdd/roadmap-voortgang.md`.
- Vervolg: etappe 3 (route en kaart) abonneert o.a. `planning` en vervangt de dubbele aankomsttijd-berekening; het `LEGACY-BRUG`-blok verdwijnt in etappe 5.
