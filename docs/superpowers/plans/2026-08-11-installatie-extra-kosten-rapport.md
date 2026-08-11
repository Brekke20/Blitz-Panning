# Installatierapport "Extra kosten buiten standaard" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Het installatierapport (voor particuliere installaties, altijd lokale afspraken zonder Zoho-koppeling) vervangen door een op-maat rapport voor meerkosten buiten het standaardpakket: datum/technieker/adres/start-eind/serienummer, foto's, een meerkosten-catalogus (Prijzen 2026) + vrij totaalbedrag voor overige materialen, en handtekeningen technieker + klant.

**Architecture:** De rapport-wizard krijgt twee losstaande stappen-arrays (`WIZ_STEPS_INTERVENTIE`, ongewijzigd t.o.v. vandaag; `WIZ_STEPS_INSTALLATIE`, nieuw, 6 stappen) i.p.v. één array met steeds meer `if (isInstallatie)`-vertakkingen per stap. Beide hergebruiken zoveel mogelijk bestaande, gedeelde functies (Algemeen, Foto's, de onderdelen-catalogus-mechanica, handtekeningen). De prijzencatalogus (`netlify/functions/prijzen.js` + het client-side `PRIJZEN_DEFAULTS`-fallback in `public/index.html`) krijgt een `groep`-veld per categorie ('interventie'/'installatie') en de nieuwe Prijzen-2026-items; de prijzenbeheer-pagina toont die als 2 tabs.

**Tech Stack:** Vanilla JS (geen build-stap), Netlify Functions (classic-stijl). Geen testframework — verificatie via `node dev-server.mjs` (poort 3333) met `?test` in de URL (TEST_MODE — prijzen laden dan puur client-side uit `PRIJZEN_DEFAULTS`/`localStorage`, geen Blobs-backend nodig voor dit hele plan).

## Global Constraints

- **Elke taak die een gedeelde functie aanraakt** (`wizRenderStep`, `wizNext`, `wizBack`, `wizRenderAlgemeen`, `wizSaveAlgemeen`, `wizRenderStatus`, `zoekOnderdelen`, `getAlleTags`, `renderPrijsEditor`, `buildRapportHtml`) **moet BEIDE paden live in de browser testen**: een interventie-rapport (bestaand gedrag, moet identiek blijven) én een installatie-rapport (nieuw gedrag). Maak, vóór je begint, minstens 1 lokale afspraak met type "Installatie" aan (via "+ afspraak") zodat je een installatie-rapport kan openen.
- **TEST_MODE-valkuil:** in TEST_MODE (`?test` in de URL) leest `loadPrijzen()` eerst `localStorage['blitz_prijzen_cache']` en gebruikt die cache i.p.v. de (bijgewerkte) `PRIJZEN_DEFAULTS` als er al een cache-entry bestaat van een eerdere testsessie. Vóór je Taak 1/2/3 test: open de browserconsole en run `localStorage.removeItem('blitz_prijzen_cache')`, herlaad de pagina, en verifieer daarna pas.
- Functies die in dit plan aangepast worden zijn lang en kunnen ondertussen licht van regelnummer verschoven zijn t.o.v. wat hieronder geciteerd wordt — lees de functie steeds eerst volledig opnieuw in vóór je wijzigt, zoek op functienaam/exacte bestaande tekst, niet blindelings op regelnummer.
- Nieuwe velden/functies volgen de bestaande naamconventie (camelCase, Nederlandse namen waar de rest van het bestand dat ook doet).
- **Geen wijziging aan Zoho, aan `rapport-archief.js`, of aan de outbox/verzend-flow** — die blijven letterlijk ongewijzigd.
- **Geen deploy/push naar productie zonder expliciete bevestiging van Brent** (bestaande projectafspraak) — dit plan stopt bij lokale verificatie + commits; deployen is een apart, door Brent te bevestigen moment.

---

## Task 1: Meerkosten-2026-catalogus — data + categorie-groepen

**Files:**
- Modify: `netlify/functions/prijzen.js`
- Modify: `public/index.html`

**Interfaces:**
- Produces: `groep: 'interventie'|'installatie'` op elke categorie-definitie; nieuwe categorieën `inst-kabels`/`inst-automaten`/`inst-kasten`/`inst-extras`/`inst-infra`; nieuwe `onderdelen[]`-items met die categorieën; module-scope `PRIJS_CATEGORIEEN`-array (in `public/index.html`) en helper `categorieenVoorGroep(groep)`. Task 2 (beheer-tabs) en Task 3 (catalogus-zoekscoping) gebruiken beide.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `const DEFAULTS` in `netlify/functions/prijzen.js`, en `const PRIJZEN_DEFAULTS`, `function renderPrijsEditor`, `function zoekOnderdelen`, `function getAlleTags` in `public/index.html`.

- [ ] **Step 2: `netlify/functions/prijzen.js` — nieuwe items toevoegen aan `DEFAULTS.onderdelen`**

Zoek het einde van de `onderdelen`-array (vlak vóór `],` dat de array afsluit, na het `socket`-item):
```js
    { id:'socket',                naam:'Socket',                     categorie:'kabel', tags:['socket','aansluiting'],                   prijs:88,  eenheid:'stuk' },
  ],
```
Vervang door (nieuwe items ná `socket`, vóór de sluitende `],`):
```js
    { id:'socket',                naam:'Socket',                     categorie:'kabel', tags:['socket','aansluiting'],                   prijs:88,  eenheid:'stuk' },
    // ── Meerkosten Installatie 2026 (bron: "Particuliere Installaties - Extra Kosten buiten Standaard 2026.xlsx") ──
    // Kabels & benodigdheden
    { id:'inst-elek-datakabel-boven10m',      naam:'Elektriciteitskabel + datakabel boven 10 meter', categorie:'inst-kabels', tags:['kabel','elektriciteit','data','boven 10m'],      prijs:17.72, eenheid:'meter' },
    { id:'inst-elekkabel-boven10m',           naam:'Elektriciteitskabel boven 10 meter',             categorie:'inst-kabels', tags:['kabel','elektriciteit','boven 10m'],              prijs:14.49, eenheid:'meter' },
    { id:'inst-datakabel-boven10m',           naam:'Datakabel boven 10 meter',                       categorie:'inst-kabels', tags:['kabel','data','boven 10m'],                      prijs:4.57,  eenheid:'meter' },
    { id:'inst-datakabel-cat6',               naam:'Data kabel CAT6',                                categorie:'inst-kabels', tags:['kabel','data','cat6'],                           prijs:6.5,   eenheid:'stuk' },
    { id:'inst-xgb5g10-datakabel-boven10m',   naam:'Elektriciteitskabel XGB5G10 + datakabel boven 10 meter', categorie:'inst-kabels', tags:['kabel','xgb5g10','data','boven 10m'],     prijs:22.65, eenheid:'meter' },
    { id:'inst-kabel-xgb5g10',                naam:'Kabel XGB5G10',                                  categorie:'inst-kabels', tags:['kabel','xgb5g10'],                               prijs:20.77, eenheid:'stuk' },
    { id:'inst-aardingkabel',                 naam:'Aardingkabel 6mm² - 25mm²',                      categorie:'inst-kabels', tags:['kabel','aarding'],                               prijs:9.27,  eenheid:'stuk' },
    // Automaten & differentieels
    { id:'inst-automaat-4p-20a',              naam:'Automaat 4P 20A',                                categorie:'inst-automaten', tags:['automaat','4p','20a'],                        prijs:39.21, eenheid:'stuk' },
    { id:'inst-automaat-4p-40a',              naam:'Automaat 4P 40A',                                categorie:'inst-automaten', tags:['automaat','4p','40a'],                        prijs:51.74, eenheid:'stuk' },
    { id:'inst-diff-30ma-40a',                naam:'Differentieel Automaat 30mA 40A',                categorie:'inst-automaten', tags:['differentieel','30ma','40a'],                 prijs:115,   eenheid:'stuk' },
    { id:'inst-automaat-4p-32a',              naam:'Automaat 4P 32A',                                categorie:'inst-automaten', tags:['automaat','4p','32a'],                        prijs:55.70, eenheid:'stuk' },
    { id:'inst-diff-typea-40a-3ka-4p-30ma',   naam:'Differentieel Type A 40A 3KA 4P 30mA',           categorie:'inst-automaten', tags:['differentieel','type a','40a','4p','30ma'],   prijs:67.05, eenheid:'stuk' },
    { id:'inst-diff-typea-63a-3ka-4p-300ma',  naam:'Differentieel Type A 63A 3KA 4P 300mA',          categorie:'inst-automaten', tags:['differentieel','type a','63a','4p','300ma'],  prijs:107.50,eenheid:'stuk' },
    { id:'inst-diff-typeb-63a-10ka-4p',       naam:'Differentieel Type B 63A 10kA 4P 30mA/300mA',    categorie:'inst-automaten', tags:['differentieel','type b','63a','4p'],          prijs:263,   eenheid:'stuk' },
    // Kasten & benodigdheden
    { id:'inst-kast-6mod',                    naam:'Zekeringskastje 6 modules',                      categorie:'inst-kasten', tags:['kast','zekeringskastje','6 modules'],            prijs:46.73, eenheid:'stuk' },
    { id:'inst-kast-9mod',                    naam:'Zekeringskastje 9 modules',                      categorie:'inst-kasten', tags:['kast','zekeringskastje','9 modules'],            prijs:53.12, eenheid:'stuk' },
    { id:'inst-kast-12mod',                   naam:'Zekeringskastje 12 modules',                     categorie:'inst-kasten', tags:['kast','zekeringskastje','12 modules'],           prijs:78.74, eenheid:'stuk' },
    { id:'inst-kast-18mod',                   naam:'Zekeringskastje 18 modules',                     categorie:'inst-kasten', tags:['kast','zekeringskastje','18 modules'],           prijs:120.48,eenheid:'stuk' },
    // Extra's
    { id:'inst-doorboring-32mm',              naam:'Standaard doorboring tot 32mm per muur',         categorie:'inst-extras', tags:['doorboring','muur'],                             prijs:16.37, eenheid:'stuk' },
    { id:'inst-diamantboring',                naam:'Diamant boring',                                 categorie:'inst-extras', tags:['boring','diamant'],                              prijs:133.38,eenheid:'stuk' },
    { id:'inst-klein-materiaal-1',            naam:'Klein materiaal (optie 1)',                      categorie:'inst-extras', tags:['klein materiaal'],                               prijs:20.52, eenheid:'stuk' },
    { id:'inst-klein-materiaal-2',            naam:'Klein materiaal (optie 2)',                      categorie:'inst-extras', tags:['klein materiaal'],                               prijs:30.78, eenheid:'stuk' },
    { id:'inst-klein-materiaal-3',            naam:'Klein materiaal (optie 3)',                      categorie:'inst-extras', tags:['klein materiaal'],                               prijs:41.04, eenheid:'stuk' },
    { id:'inst-kabelgoot-pvc-2m',             naam:'Kabelgoot PVC uv-bestendig per 2m',              categorie:'inst-extras', tags:['kabelgoot','pvc'],                               prijs:23.04, eenheid:'stuk' },
    { id:'inst-accessoires-hoeken',           naam:'Accessoires hoeken, eindstukken',                categorie:'inst-extras', tags:['kabelgoot','accessoires'],                       prijs:5.76,  eenheid:'stuk' },
    { id:'inst-wachtbuis-rood',               naam:'Rode wachtbuis extra',                           categorie:'inst-extras', tags:['wachtbuis'],                                     prijs:2.20,  eenheid:'stuk' },
    { id:'inst-connectiviteitsoplossing',     naam:'Connectiviteitsoplossing (stopcontact, automaat, uplift zekeringskast)', categorie:'inst-extras', tags:['connectiviteit'],       prijs:49.17, eenheid:'stuk' },
    { id:'inst-switch-5poorten',              naam:'Switch 5 poorten',                               categorie:'inst-extras', tags:['switch','netwerk','5 poorten'],                  prijs:102.60,eenheid:'stuk' },
    // Infra, graafwerken en buiten de standaard
    { id:'inst-paal-grondinstallatie',        naam:'Paal model installatie in de grond (aangeleverd anker, betonnen sokkel, snelbeton)', categorie:'inst-infra', tags:['paal','graafwerk','infra'], prijs:150.56, eenheid:'stuk' },
  ],
```
**Bewust weggelaten** (blanco/onbepaalde prijs in het Excel-bestand — niet importeren, later manueel toevoegbaar via de beheer-UI zodra geprijsd): "Automaat 2P 32A", 3× "Differentieel Type A ... 2P/4P 300mA of 30mA (uplift)"-varianten, "Zekeringskastje 36 modules", "Switch 8/16 poorten".
**Let op — "Klein materiaal" (3×):** het Excel-bestand herhaalt exact dezelfde naam 3× met 3 verschillende prijzen zonder verder onderscheid. Bovenstaande code geeft ze tijdelijke namen "(optie 1/2/3)" — vraag Brent na implementatie om deze via de prijzenbeheer-pagina te hernoemen naar wat de 3 prijzen werkelijk onderscheidt (bv. verpakkingsgrootte).

- [ ] **Step 3: `public/index.html` — dezelfde items toevoegen aan `PRIJZEN_DEFAULTS.onderdelen`**

Zoek in `public/index.html` het einde van `PRIJZEN_DEFAULTS.onderdelen` (vlak vóór de sluitende `],` na het `socket`-item, regel ~7222-7223):
```js
    { id:'socket',               naam:'Socket',                     categorie:'kabel', tags:['socket','aansluiting'],                   prijs:88,  eenheid:'stuk' },
  ],
```
Vervang door exact dezelfde 29 nieuwe regels als in Step 2 (identieke `id`/`naam`/`categorie`/`tags`/`prijs`/`eenheid` — dit bestand is de client-side fallback en moet met de server-defaults in sync blijven), gevolgd door de sluitende `],`.

- [ ] **Step 4: `public/index.html` — `PRIJS_CATEGORIEEN` als module-scope constante**

Zoek, vlak na de sluitende `};` van `PRIJZEN_DEFAULTS` (vóór `// ── Laden bij startup ──`):
```js
};

// ── Laden bij startup ─────────────────────────────────────────────────────────
async function loadPrijzen() {
```
Vervang door:
```js
};

// ── Categorieën, per prijzen-beheer-tab (Task 1 van het meerkosten-installatie-plan) ──
const PRIJS_CATEGORIEEN = [
  { id:'controller',     label:'Controllers',                groep:'interventie' },
  { id:'energiemeter',   label:'Energiemeters',              groep:'interventie' },
  { id:'ct-klem',        label:'CT-klemmen',                 groep:'interventie' },
  { id:'overig',         label:'Overige componenten',        groep:'interventie' },
  { id:'kabel',          label:'Laadkabels & aansluitingen', groep:'interventie' },
  { id:'inst-kabels',    label:'Kabels & benodigdheden',     groep:'installatie' },
  { id:'inst-automaten', label:'Automaten & differentieels', groep:'installatie' },
  { id:'inst-kasten',    label:'Kasten & benodigdheden',     groep:'installatie' },
  { id:'inst-extras',    label:"Extra's",                    groep:'installatie' },
  { id:'inst-infra',     label:'Infra & graafwerken',        groep:'installatie' },
];
function categorieenVoorGroep(groep) {
  return PRIJS_CATEGORIEEN.filter(c => c.groep === groep).map(c => c.id);
}

// ── Laden bij startup ─────────────────────────────────────────────────────────
async function loadPrijzen() {
```

- [ ] **Step 5: Verifieer live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. In de browserconsole: `localStorage.removeItem('blitz_prijzen_cache')`, herlaad de pagina. Run `console.log(categorieenVoorGroep('installatie'))` → bevestig dat de 5 nieuwe categorie-id's teruggegeven worden. Run `console.log(PRIJZEN_DEFAULTS.onderdelen.filter(o => o.categorie.startsWith('inst-')).length)` → bevestig **29**.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/prijzen.js public/index.html
git commit -m "feat: meerkosten-2026-catalogus toevoegen aan prijzencatalogus"
```

---

## Task 2: Prijzenbeheer-pagina — tabs Interventies/Installaties

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `PRIJS_CATEGORIEEN` (Task 1).
- Produces: `let _prijsTab`, nieuwe functie `setPrijsTab(tab)`.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function renderPrijsEditor` volledig in `public/index.html` — bevestig dat de lokale `const cats = [...]`-array er nog exact zo uitziet als hieronder geciteerd (5 categorieën, geen `groep`-veld).

- [ ] **Step 2: CSS voor de tabs**

Zoek in de globale `<style>`-sectie:
```css
    /* Banner */
    .prijs-cache-banner {
      background: var(--orange-dim); border: 1px solid var(--orange); border-radius: var(--r);
      padding: 8px 12px; font-size: 0.78rem; color: var(--orange); margin-bottom: 10px;
    }
```
Vervang door:
```css
    /* Banner */
    .prijs-cache-banner {
      background: var(--orange-dim); border: 1px solid var(--orange); border-radius: var(--r);
      padding: 8px 12px; font-size: 0.78rem; color: var(--orange); margin-bottom: 10px;
    }
    /* Tabs (Interventies/Installaties) */
    .prijs-tabs { display: flex; gap: 6px; margin-bottom: 14px; }
    .prijs-tab-btn {
      background: var(--surface2); border: 1px solid var(--border); color: var(--text2);
      border-radius: var(--r); padding: 7px 14px; font-size: 0.82rem; cursor: pointer;
      font-family: inherit;
    }
    .prijs-tab-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
```

- [ ] **Step 3: `renderPrijsEditor()` — tab-state, tab-knoppen, categorie-filter, Tarieven enkel bij interventie**

Zoek de volledige functie:
```js
function renderPrijsEditor() {
  const data = getPrijzen();
  // Meta
  const meta = document.getElementById('prijs-meta');
  if (data.bijgewerkt) {
    const d = new Date(data.bijgewerkt);
    meta.textContent = `v${data.versie} · ${d.toLocaleDateString('nl-BE')} ${d.toLocaleTimeString('nl-BE', {hour:'2-digit',minute:'2-digit'})}`;
  }
  // Controleer of data van cache komt
  const body = document.getElementById('prijs-body');
  let html = '';
  if (!TEST_MODE && !navigator.onLine) {
    html += `<div class="prijs-cache-banner">⚠️ Offline — prijzen uit lokale cache</div>`;
  }

  // Categorieën
  const cats = [
    { id:'controller',   label:'Controllers' },
    { id:'energiemeter', label:'Energiemeters' },
    { id:'ct-klem',      label:'CT-klemmen' },
    { id:'overig',       label:'Overige componenten' },
    { id:'kabel',        label:'Laadkabels & aansluitingen' },
  ];
  for (const cat of cats) {
```
Vervang door:
```js
let _prijsTab = 'interventie'; // 'interventie' | 'installatie'
function setPrijsTab(tab) {
  _prijsTab = tab;
  renderPrijsEditor();
}

function renderPrijsEditor() {
  const data = getPrijzen();
  // Meta
  const meta = document.getElementById('prijs-meta');
  if (data.bijgewerkt) {
    const d = new Date(data.bijgewerkt);
    meta.textContent = `v${data.versie} · ${d.toLocaleDateString('nl-BE')} ${d.toLocaleTimeString('nl-BE', {hour:'2-digit',minute:'2-digit'})}`;
  }
  // Controleer of data van cache komt
  const body = document.getElementById('prijs-body');
  let html = '';
  if (!TEST_MODE && !navigator.onLine) {
    html += `<div class="prijs-cache-banner">⚠️ Offline — prijzen uit lokale cache</div>`;
  }

  html += `<div class="prijs-tabs">
    <button class="prijs-tab-btn${_prijsTab==='interventie'?' active':''}" data-tab="interventie">Interventies</button>
    <button class="prijs-tab-btn${_prijsTab==='installatie'?' active':''}" data-tab="installatie">Installaties</button>
  </div>`;

  // Categorieën (enkel de actieve tab/groep)
  const cats = PRIJS_CATEGORIEEN.filter(c => c.groep === _prijsTab);
  for (const cat of cats) {
```
(De rest van de `for (const cat of cats)`-loop-body blijft ongewijzigd — die leest enkel `cat.id`/`cat.label`, beide nog steeds aanwezig.)

Zoek daarna, meteen na het einde van die loop:
```js
  // Tarieven
  html += `<div class="prijs-tarieven-sep"></div>
    <div class="prijs-cat-title">Tarieven</div>`;
  for (let i = 0; i < data.tarieven.length; i++) {
    const t = data.tarieven[i];
    html += `<div class="prijs-tarief-row">
      <span class="prijs-tarief-naam">${escHtml(t.naam)}</span>
      <div class="prijs-input-wrap">
        <span class="prijs-euro">€</span>
        <input class="prijs-prijs-input" type="number" min="0" step="0.01"
          value="${t.prijs}" oninput="prijsTariefUpdate(${i},this.value)" />
      </div>
      <span class="prijs-eenheid">/ ${t.eenheid}</span>
    </div>`;
  }

  body.innerHTML = html;

  // cat.id komt uit een hardcoded lijst (geen risico), maar data-attribuut + addEventListener
  // voor consistentie met de rest van de prijzen-blob-afgeleide knoppen.
  body.querySelectorAll('.prijs-btn-voegtoe').forEach(btn => {
    btn.addEventListener('click', () => prijsVoegOnderdeel(btn.dataset.catId || ''));
  });
}
```
Vervang door:
```js
  // Tarieven (enkel bij Interventies — arbeidsforfaits, niet relevant bij installatie-meerkost)
  if (_prijsTab === 'interventie') {
    html += `<div class="prijs-tarieven-sep"></div>
      <div class="prijs-cat-title">Tarieven</div>`;
    for (let i = 0; i < data.tarieven.length; i++) {
      const t = data.tarieven[i];
      html += `<div class="prijs-tarief-row">
        <span class="prijs-tarief-naam">${escHtml(t.naam)}</span>
        <div class="prijs-input-wrap">
          <span class="prijs-euro">€</span>
          <input class="prijs-prijs-input" type="number" min="0" step="0.01"
            value="${t.prijs}" oninput="prijsTariefUpdate(${i},this.value)" />
        </div>
        <span class="prijs-eenheid">/ ${t.eenheid}</span>
      </div>`;
    }
  }

  body.innerHTML = html;

  body.querySelectorAll('.prijs-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setPrijsTab(btn.dataset.tab));
  });
  // cat.id komt uit een hardcoded lijst (geen risico), maar data-attribuut + addEventListener
  // voor consistentie met de rest van de prijzen-blob-afgeleide knoppen.
  body.querySelectorAll('.prijs-btn-voegtoe').forEach(btn => {
    btn.addEventListener('click', () => prijsVoegOnderdeel(btn.dataset.catId || ''));
  });
}
```

- [ ] **Step 4: Verifieer live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test` (localStorage-cache voor prijzen leeg, zie Global Constraints). Open Prijsbeheer → bevestig 2 tabs, "Interventies" actief/gemarkeerd. Bevestig dat de 5 bestaande categorieën + "Tarieven" nog gewoon staan. Klik "Installaties" → bevestig de 5 nieuwe categorieën (Kabels & benodigdheden, Automaten & differentieels, Kasten & benodigdheden, Extra's, Infra & graafwerken) met alle prijzen uit Task 1, GEEN "Tarieven"-sectie. Test "+ Onderdeel toevoegen" op een installatie-categorie → nieuw item krijgt de juiste `categorie`. Wijzig een prijs, klik "Opslaan" (test-modus) → herlaad Prijsbeheer, bevestig dat de wijziging bewaard is op de juiste tab.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: tabs Interventies/Installaties op de prijzenbeheer-pagina"
```

---

## Task 3: Catalogus-zoekfunctie — scoping per groep

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `categorieenVoorGroep(groep)` (Task 1).
- Produces: `zoekOnderdelen(query, activeTags, categorieIds)` en `getAlleTags(categorieIds)` krijgen een optioneel 3e/2e parameter — bestaande aanroepen zonder dat argument blijven exact hetzelfde gedrag vertonen (parameter is `undefined` → geen filter). Task 6 gebruikt dit voor de "Meerkost"-stap.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function zoekOnderdelen` en `function getAlleTags` in `public/index.html`.

- [ ] **Step 2: `zoekOnderdelen()` — categorie-filter**

Zoek:
```js
function zoekOnderdelen(query, activeTags) {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const q = (query || '').toLowerCase().trim();
  return src.onderdelen.filter(o => {
    if (activeTags && activeTags.length) {
      const oTags = (o.tags || []).map(t => t.toLowerCase());
      if (!activeTags.every(t => oTags.includes(t.toLowerCase()))) return false;
    }
    if (!q) return true;
    return o.naam.toLowerCase().includes(q) || (o.tags || []).some(t => t.toLowerCase().includes(q));
  });
}
```
Vervang door:
```js
function zoekOnderdelen(query, activeTags, categorieIds) {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const q = (query || '').toLowerCase().trim();
  return src.onderdelen.filter(o => {
    if (categorieIds && !categorieIds.includes(o.categorie)) return false;
    if (activeTags && activeTags.length) {
      const oTags = (o.tags || []).map(t => t.toLowerCase());
      if (!activeTags.every(t => oTags.includes(t.toLowerCase()))) return false;
    }
    if (!q) return true;
    return o.naam.toLowerCase().includes(q) || (o.tags || []).some(t => t.toLowerCase().includes(q));
  });
}
```

- [ ] **Step 3: `getAlleTags()` — categorie-filter**

Zoek:
```js
function getAlleTags() {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const set = new Set();
  src.onderdelen.forEach(o => (o.tags || []).forEach(t => set.add(t)));
  return [...set].sort();
}
```
Vervang door:
```js
function getAlleTags(categorieIds) {
  const src = PRIJZEN || PRIJZEN_DEFAULTS;
  const set = new Set();
  src.onderdelen
    .filter(o => !categorieIds || categorieIds.includes(o.categorie))
    .forEach(o => (o.tags || []).forEach(t => set.add(t)));
  return [...set].sort();
}
```

- [ ] **Step 4: Verifieer live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test` (localStorage-cache leeg). In de browserconsole: `zoekOnderdelen('', [], categorieenVoorGroep('installatie')).length` → bevestig **29**. `zoekOnderdelen('', [], null).length` → bevestig dat dit het VOLLEDIGE aantal onderdelen teruggeeft (interventie + installatie samen, ongewijzigd t.o.v. vóór deze taak). Open het rapport-wizard-stap "Status & onderdelen" van een interventie-rapport (nog ongewijzigd, gebruikt `zoekOnderdelen(q, tags)` zonder 3e argument) → bevestig dat zoeken nog exact werkt zoals voorheen (alle onderdelen doorzoekbaar, geen enkel item verdwenen).

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: categorie-scoping toevoegen aan zoekOnderdelen/getAlleTags"
```

---

## Task 4: Nieuwe stappen-architectuur — `WIZ_STEPS_INTERVENTIE`/`WIZ_STEPS_INSTALLATIE` + stap "Extra materialen"

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Produces: `R.extraMaterialenTotaal: string`; `WIZ_STEPS_INTERVENTIE`, `WIZ_STEPS_INSTALLATIE`, `activeWizSteps()`; nieuwe functies `wizRenderMaterialenTotaal(el)`/`wizSaveMaterialenTotaal()`. Task 5 en Task 6 breiden stappen uit die hier al in `WIZ_STEPS_INSTALLATIE` staan. Task 9 (`buildRapportHtml`) leest `R.extraMaterialenTotaal`.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `const R = {`, `const WIZ_STEPS = [`, `async function openRapport`, `function wizRenderStep`, `function wizNext`, `function wizBack` in `public/index.html`.

- [ ] **Step 2: `R`-object — nieuw veld**

Zoek:
```js
const R = {
  datum: '', technieker: '', adres: '', start: '', stop: '', werktijd: '',
  facturatie: 'klant', facturatieVrij: '',
  servicetype: '2e-lijn',
  aanrijtijdMin: 0,
  interventieType: 'Interventie',
  installateur: '', serienummer: '', aantalLaadpalen: 1, type: '', uitvoering: '', kabel: '', kabellengte: '',
  probleem: '', acties: '',
  oorzaakStoring: [],
  fotos: [],
  hersteld: 'nee', nieuwInter: 'nee',
  varia: '',
  onderdelen: [],
};
```
Vervang door:
```js
const R = {
  datum: '', technieker: '', adres: '', start: '', stop: '', werktijd: '',
  facturatie: 'klant', facturatieVrij: '',
  servicetype: '2e-lijn',
  aanrijtijdMin: 0,
  interventieType: 'Interventie',
  installateur: '', serienummer: '', aantalLaadpalen: 1, type: '', uitvoering: '', kabel: '', kabellengte: '',
  probleem: '', acties: '',
  oorzaakStoring: [],
  fotos: [],
  hersteld: 'nee', nieuwInter: 'nee',
  varia: '',
  onderdelen: [],
  extraMaterialenTotaal: '',
};
```

- [ ] **Step 3: Nieuwe stap "Extra materialen" — render/save**

Voeg toe, vlak vóór `// ── Stap 6: Handtekening technieker ──`:
```js
// ── Stap: Extra materialen (enkel installatierapport) ──
function wizRenderMaterialenTotaal(el) {
  el.innerHTML = `
    <div class="wiz-step-title">Extra materialen</div>
    <p style="font-size:0.85rem;color:var(--muted);margin-bottom:14px;line-height:1.5">
      Materiaal dat niet in de meerkosten-catalogus staat — vul hier het totaalbedrag in.
    </p>
    <div class="wiz-field">
      <label class="wiz-field-label">Totaalbedrag extra materialen (excl. btw)</label>
      <div style="position:relative">
        <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted)">€</span>
        <input class="wiz-input" id="f-extra-materialen" type="number" min="0" step="0.01"
          style="padding-left:26px" value="${R.extraMaterialenTotaal || ''}" placeholder="0.00" />
      </div>
    </div>`;
}
function wizSaveMaterialenTotaal() {
  R.extraMaterialenTotaal = wizV('f-extra-materialen');
}

// ── Stap 6: Handtekening technieker ──
```

- [ ] **Step 4: `WIZ_STEPS` → `WIZ_STEPS_INTERVENTIE` + nieuwe `WIZ_STEPS_INSTALLATIE` + `activeWizSteps()`**

Zoek:
```js
const WIZ_STEPS = [
  { id: 'algemeen',     label: 'Algemeen',      render: wizRenderAlgemeen,     save: wizSaveAlgemeen     },
  { id: 'facturatie',   label: 'Facturatie',     render: wizRenderFacturatie,   save: wizSaveFacturatie   },
  { id: 'product',      label: 'Product',        render: wizRenderProduct,      save: wizSaveProduct      },
  { id: 'omschrijving', label: 'Omschrijving',   render: wizRenderOmschrijving, save: wizSaveOmschrijving },
  { id: 'fotos',        label: "Foto's",         render: wizRenderFotos,        save: wizSaveFotos        },
  { id: 'status',       label: 'Status',         render: wizRenderStatus,       save: wizSaveStatus       },
  { id: 'sig-tech',     label: 'Handtekening 1', render: wizRenderSigTech,      save: wizSaveSigTech      },
  { id: 'sig-klant',    label: 'Handtekening 2', render: wizRenderSigKlant,     save: wizSaveSigKlant     },
];
```
Vervang door:
```js
const WIZ_STEPS_INTERVENTIE = [
  { id: 'algemeen',     label: 'Algemeen',      render: wizRenderAlgemeen,     save: wizSaveAlgemeen     },
  { id: 'facturatie',   label: 'Facturatie',     render: wizRenderFacturatie,   save: wizSaveFacturatie   },
  { id: 'product',      label: 'Product',        render: wizRenderProduct,      save: wizSaveProduct      },
  { id: 'omschrijving', label: 'Omschrijving',   render: wizRenderOmschrijving, save: wizSaveOmschrijving },
  { id: 'fotos',        label: "Foto's",         render: wizRenderFotos,        save: wizSaveFotos        },
  { id: 'status',       label: 'Status',         render: wizRenderStatus,       save: wizSaveStatus       },
  { id: 'sig-tech',     label: 'Handtekening 1', render: wizRenderSigTech,      save: wizSaveSigTech      },
  { id: 'sig-klant',    label: 'Handtekening 2', render: wizRenderSigKlant,     save: wizSaveSigKlant     },
];

// Installatierapport: geen Facturatie/Product/Omschrijving — enkel wat het
// meerkosten-rapport nodig heeft. "meerkost" hergebruikt bewust dezelfde
// render/save als de interventie-stap "status" (zie Task 6): identiek
// onderdelen-catalogus-mechanisme, enkel titel + zoekscope verschillen.
const WIZ_STEPS_INSTALLATIE = [
  { id: 'algemeen',   label: 'Algemeen',        render: wizRenderAlgemeen,          save: wizSaveAlgemeen          },
  { id: 'fotos',      label: "Foto's",          render: wizRenderFotos,             save: wizSaveFotos             },
  { id: 'meerkost',   label: 'Meerkost',        render: wizRenderStatus,            save: wizSaveStatus            },
  { id: 'materialen', label: 'Extra materialen',render: wizRenderMaterialenTotaal,  save: wizSaveMaterialenTotaal  },
  { id: 'sig-tech',   label: 'Handtekening 1',  render: wizRenderSigTech,           save: wizSaveSigTech           },
  { id: 'sig-klant',  label: 'Handtekening 2',  render: wizRenderSigKlant,          save: wizSaveSigKlant          },
];

function activeWizSteps() {
  return R.interventieType === 'Installatie' ? WIZ_STEPS_INSTALLATIE : WIZ_STEPS_INTERVENTIE;
}
```

- [ ] **Step 5: `wizRenderStep()`/`wizNext()`/`wizBack()` — vereenvoudigen (geen filter/skip-logica meer nodig)**

Zoek:
```js
function wizRenderStep() {
  const step  = WIZ_STEPS[_wizStep];
  const visibleSteps = R.interventieType === 'Installatie'
    ? WIZ_STEPS.filter(s => s.id !== 'facturatie')
    : WIZ_STEPS;
  const total = visibleSteps.length;
  const visibleIndex = visibleSteps.indexOf(step);

  // Dots
  const dotsEl = document.getElementById('wiz-dots');
  dotsEl.innerHTML = visibleSteps.map((s, i) =>
    `<div class="wiz-step-dot ${i === visibleIndex ? 'active' : i < visibleIndex ? 'done' : ''}"></div>`
  ).join('');

  document.getElementById('wiz-step-label').textContent = `${visibleIndex+1} / ${total} — ${step.label}`;
  document.getElementById('wiz-ftr-info').textContent   = step.label;

  const btnBack = document.getElementById('wiz-btn-back');
  const btnNext = document.getElementById('wiz-btn-next');
  btnBack.style.display = _wizStep > 0 ? '' : 'none';
  btnNext.textContent   = visibleIndex === total - 1 ? '🖨️ Afdrukken / PDF' : 'Volgende →';

  const body = document.getElementById('wiz-body');
  body.scrollTop = 0;
  body.innerHTML = '';
  step.render(body);
}

function wizNext() {
  const step   = WIZ_STEPS[_wizStep];
  const result = step.save ? step.save() : undefined;
  if (result === false || typeof result === 'string') {
    toast(typeof result === 'string' ? result : '⚠️ Kan niet doorgaan naar de volgende stap', 3500);
    return;
  }
  let nextStep = _wizStep + 1;
  if (R.interventieType === 'Installatie' && WIZ_STEPS[nextStep]?.id === 'facturatie') nextStep++;
  if (nextStep < WIZ_STEPS.length) {
    _wizStep = nextStep;
    wizRenderStep();
  } else {
    printRapport();
  }
}

function wizBack() {
  if (WIZ_STEPS[_wizStep].save) WIZ_STEPS[_wizStep].save();
  let prevStep = _wizStep - 1;
  if (R.interventieType === 'Installatie' && WIZ_STEPS[prevStep]?.id === 'facturatie') prevStep--;
  if (prevStep >= 0) {
    _wizStep = prevStep;
    wizRenderStep();
  }
}
```
Vervang door:
```js
function wizRenderStep() {
  const steps = activeWizSteps();
  const step  = steps[_wizStep];
  const total = steps.length;

  // Dots
  const dotsEl = document.getElementById('wiz-dots');
  dotsEl.innerHTML = steps.map((s, i) =>
    `<div class="wiz-step-dot ${i === _wizStep ? 'active' : i < _wizStep ? 'done' : ''}"></div>`
  ).join('');

  document.getElementById('wiz-step-label').textContent = `${_wizStep+1} / ${total} — ${step.label}`;
  document.getElementById('wiz-ftr-info').textContent   = step.label;

  const btnBack = document.getElementById('wiz-btn-back');
  const btnNext = document.getElementById('wiz-btn-next');
  btnBack.style.display = _wizStep > 0 ? '' : 'none';
  btnNext.textContent   = _wizStep === total - 1 ? '🖨️ Afdrukken / PDF' : 'Volgende →';

  const body = document.getElementById('wiz-body');
  body.scrollTop = 0;
  body.innerHTML = '';
  step.render(body);
}

function wizNext() {
  const steps  = activeWizSteps();
  const step   = steps[_wizStep];
  const result = step.save ? step.save() : undefined;
  if (result === false || typeof result === 'string') {
    toast(typeof result === 'string' ? result : '⚠️ Kan niet doorgaan naar de volgende stap', 3500);
    return;
  }
  if (_wizStep < steps.length - 1) {
    _wizStep++;
    wizRenderStep();
  } else {
    printRapport();
  }
}

function wizBack() {
  const steps = activeWizSteps();
  if (steps[_wizStep].save) steps[_wizStep].save();
  if (_wizStep > 0) {
    _wizStep--;
    wizRenderStep();
  }
}
```

- [ ] **Step 6: `openRapport()` — nieuw veld resetten**

Zoek in `openRapport()`:
```js
  R.varia        = '';
  R.onderdelen   = [];
```
Vervang door:
```js
  R.varia        = '';
  R.onderdelen   = [];
  R.extraMaterialenTotaal = '';
```

- [ ] **Step 7: Verifieer BEIDE paden live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`.

**Interventie-pad (moet ongewijzigd blijven):** open een normaal ticket-rapport → doorloop alle 8 stappen tot en met "🖨️ Afdrukken / PDF" op de laatste stap ("Handtekening 2"), voortgangsindicator toont "1/8" t.e.m. "8/8", labels identiek aan voorheen (Algemeen, Facturatie, Product, Omschrijving, Foto's, Status, Handtekening 1, Handtekening 2).

**Installatie-pad (nieuw):** open een installatie-afspraak-rapport → bevestig 6 stappen: "1/6 — Algemeen" → "2/6 — Foto's" → "3/6 — Meerkost" (nog met de oude titel/inhoud "Materialen" tot Task 6) → "4/6 — Extra materialen" (nieuw scherm met €-invoerveld) → "5/6 — Handtekening 1" → "6/6 — Handtekening 2", waar de knoptekst op de laatste stap "🖨️ Afdrukken / PDF" toont. Klik "Terug" vanaf elke stap → keert telkens correct één stap terug. Vul op stap "Extra materialen" een bedrag in, ga terug en weer verder → bevestig dat de waarde bewaard blijft.

- [ ] **Step 8: Commit**

```bash
git add public/index.html
git commit -m "feat: aparte stappen-arrays voor installatie- en interventierapport + stap Extra materialen"
```

---

## Task 5: "Algemeen"-stap — serienummer voor installatierapporten

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `R.interventieType` (bestaand).
- Produces: `R.serienummer` blijft bewaard/wijzigbaar via de "Algemeen"-stap wanneer `R.interventieType === 'Installatie'` (voorheen enkel via de nu voor installatie niet meer bereikbare "Product"-stap).

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function wizRenderAlgemeen` en `function wizSaveAlgemeen` in `public/index.html`.

- [ ] **Step 2: `wizRenderAlgemeen()` — serienummer-veld bij installatie**

Zoek:
```js
function wizRenderAlgemeen(el) {
  const zohoRef = _wizTicket.number ? `#${_wizTicket.number}` : (_wizTicket.isLocal ? '' : (_wizTicket.id || ''));
  el.innerHTML = `
```
Vervang door:
```js
function wizRenderAlgemeen(el) {
  const zohoRef = _wizTicket.number ? `#${_wizTicket.number}` : (_wizTicket.isLocal ? '' : (_wizTicket.id || ''));
  const isInstallatie = R.interventieType === 'Installatie';
  el.innerHTML = `
```
Zoek daarna:
```js
        <label class="wiz-radio-card">
          <input type="radio" name="f-interventieType" value="Installatie" ${R.interventieType === 'Installatie' ? 'checked' : ''}>
          <div><div class="wiz-radio-card-label">Installatie</div></div>
        </label>
      </div>
    </div>
    <div class="wiz-field-row">
      <div class="wiz-field">
        <label class="wiz-field-label">Starttijd (aankomst)</label>
```
Vervang door:
```js
        <label class="wiz-radio-card">
          <input type="radio" name="f-interventieType" value="Installatie" ${R.interventieType === 'Installatie' ? 'checked' : ''}>
          <div><div class="wiz-radio-card-label">Installatie</div></div>
        </label>
      </div>
    </div>
    ${isInstallatie ? `
    <div class="wiz-field">
      <label class="wiz-field-label">Serienummer</label>
      <input class="wiz-input" id="f-serienummer" type="text" value="${escHtml(R.serienummer)}" placeholder="CHARX-XXXX" />
    </div>` : ''}
    <div class="wiz-field-row">
      <div class="wiz-field">
        <label class="wiz-field-label">Starttijd (aankomst)</label>
```

- [ ] **Step 3: `wizSaveAlgemeen()` — serienummer opslaan, enkel als het veld bestaat**

Zoek:
```js
function wizSaveAlgemeen() {
  R.datum           = wizV('f-datum');
  R.technieker      = wizV('f-technieker');
  R.adres           = wizV('f-adres');
  R.start           = wizV('f-start');
  R.stop            = wizV('f-stop');
  R.werktijd        = calcWerktijd(R.start, R.stop);
  R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
}
```
Vervang door:
```js
function wizSaveAlgemeen() {
  R.datum           = wizV('f-datum');
  R.technieker      = wizV('f-technieker');
  R.adres           = wizV('f-adres');
  // Enkel overschrijven als het veld op dit moment gerenderd was (installatierapport) —
  // bij een interventierapport bestaat #f-serienummer hier niet en zou wizV() anders
  // R.serienummer blindelings leegmaken (dat veld wordt daar via de "Product"-stap beheerd).
  const serienummerEl = document.getElementById('f-serienummer');
  if (serienummerEl) R.serienummer = serienummerEl.value;
  R.start           = wizV('f-start');
  R.stop            = wizV('f-stop');
  R.werktijd        = calcWerktijd(R.start, R.stop);
  R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
}
```

- [ ] **Step 4: Verifieer BEIDE paden live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`.

**Interventie-pad (moet ongewijzigd blijven):** open een ticket-rapport → stap "Algemeen" toont GEEN serienummer-veld (zit nog steeds enkel op stap "Product", verder in de wizard). Vul daar een serienummer in, ga door naar "Handtekening 2" → controleer in de rapport-preview dat het serienummer correct verschijnt.

**Installatie-pad (nieuw):** open een installatie-afspraak-rapport → stap "Algemeen" toont nu een "Serienummer"-veld. Vul iets in, ga naar "Foto's" en terug naar "Algemeen" → waarde blijft bewaard. Doorloop tot "Handtekening 2" → controleer in de rapport-preview dat "Serienummer" het ingevulde nummer toont.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: serienummer-veld op Algemeen-stap voor installatierapporten"
```

---

## Task 6: "Status"-stap hernoemen naar "Meerkost" + catalogus-scoping voor installatie

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `categorieenVoorGroep('installatie')` (Task 1/3).
- Produces: geen nieuwe interfaces — hergebruikt `wizRenderStatus`/`_wizUpdateCatResults` (nu met scoping).

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function wizRenderStatus` en `function _wizUpdateCatResults` volledig in `public/index.html`.

- [ ] **Step 2: `wizRenderStatus()` — titel "Meerkost" i.p.v. "Materialen", label "Meerkost toevoegen"**

Zoek:
```js
  const isInstallatie = R.interventieType === 'Installatie';
  el.innerHTML = `
    <div class="wiz-step-title">${isInstallatie ? 'Materialen' : 'Status &amp; onderdelen'}</div>
```
Vervang door:
```js
  const isInstallatie = R.interventieType === 'Installatie';
  el.innerHTML = `
    <div class="wiz-step-title">${isInstallatie ? 'Meerkost' : 'Status &amp; onderdelen'}</div>
```
Zoek daarna:
```js
    <div class="wiz-field">
      <label class="wiz-field-label">Onderdelen toevoegen</label>
      <div class="wiz-cat-search-wrap">
```
Vervang door:
```js
    <div class="wiz-field">
      <label class="wiz-field-label">${isInstallatie ? 'Meerkost toevoegen' : 'Onderdelen toevoegen'}</label>
      <div class="wiz-cat-search-wrap">
```

- [ ] **Step 3: `wizRenderStatus()` — tag-lijst scopen tot installatie-categorieën**

Zoek (bovenaan de functie, vóór de `isInstallatie`-toewijzing die je in Step 2 al zag):
```js
function wizRenderStatus(el) {
  const selHtml = _wizRenderGeselecteerd();
  // Populaire tags (max 8 meest voorkomende)
  const allTags = getAlleTags().slice(0, 12);
```
Vervang door:
```js
function wizRenderStatus(el) {
  const selHtml = _wizRenderGeselecteerd();
  const isInstallatieVoorTags = R.interventieType === 'Installatie';
  // Populaire tags (max 8 meest voorkomende) — bij installatie enkel uit de meerkosten-catalogus
  const allTags = getAlleTags(isInstallatieVoorTags ? categorieenVoorGroep('installatie') : null).slice(0, 12);
```
(Losse naam `isInstallatieVoorTags` bewust — de bestaande `const isInstallatie` staat pas verderop in de functie gedefinieerd, op het punt waar de titel bepaald wordt; deze regel staat er vóór. Functioneel identiek, enkel om geen dubbele `const isInstallatie` in dezelfde functie te krijgen.)

- [ ] **Step 4: `_wizUpdateCatResults()` — catalogusresultaten scopen tot installatie-categorieën**

Zoek:
```js
function _wizUpdateCatResults() {
  const q = document.getElementById('wiz-cat-q')?.value || '';
  const resultEl = document.getElementById('wiz-cat-results');
  if (!resultEl) return;
  const resultaten = zoekOnderdelen(q, _wizActiveTags);
```
Vervang door:
```js
function _wizUpdateCatResults() {
  const q = document.getElementById('wiz-cat-q')?.value || '';
  const resultEl = document.getElementById('wiz-cat-results');
  if (!resultEl) return;
  const categorieIds = R.interventieType === 'Installatie' ? categorieenVoorGroep('installatie') : null;
  const resultaten = zoekOnderdelen(q, _wizActiveTags, categorieIds);
```

- [ ] **Step 5: Verifieer BEIDE paden live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test` (localStorage-cache voor prijzen leeg, zie Global Constraints).

**Interventie-pad (moet ongewijzigd blijven):** open een ticket-rapport, ga naar stap "Status" → titel blijft "Status & onderdelen", label "Onderdelen toevoegen". Dit pad blijft ongescoped (`categorieIds = null` in `_wizUpdateCatResults()`, want `R.interventieType` is hier niet `'Installatie'`) — zoek op "kabel" → bevestig dat je gewoon alle onderdelen met "kabel" in naam/tag ziet, nu inclusief de nieuwe meerkosten-kabelitems uit Task 1 in de resultatenlijst. Dat is verwacht en onschadelijk (enkel het installatie-pad wordt in deze taak gescoped); bevestig vooral dat er geen bestaand onderdeel uit de lijst verdwenen is t.o.v. vóór deze taak.

**Installatie-pad (nieuw):** open een installatie-afspraak-rapport, ga naar stap "Meerkost" (titel nu effectief "Meerkost", label "Meerkost toevoegen"). Zoek op "controller" → GEEN resultaten (laadpaal-onderdelen zijn uitgesloten). Zoek op "kabel" → enkel de nieuwe meerkosten-kabelitems, geen laadkabels. Voeg een item toe, aantal wijzigen → subtotaal/totaal blijft correct rekenen (ongewijzigde onderliggende mechanica).

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: Meerkost-stap voor installatie scopen tot de meerkosten-2026-catalogus"
```

---

## Task 7: Cleanup — "Omschrijving"-stap terug naar pure interventie-vorm

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Geen — dit is een opschoning zonder gedragswijziging: `wizRenderOmschrijving`/`wizSaveOmschrijving` worden na Task 4 nooit meer aangeroepen met `R.interventieType === 'Installatie'` (die stap staat niet in `WIZ_STEPS_INSTALLATIE`), dus de bestaande `isInstallatie`-vertakkingen erin zijn dode code.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function wizRenderOmschrijving` en `function wizSaveOmschrijving` in `public/index.html`.

- [ ] **Step 2: `wizRenderOmschrijving()` — dode `isInstallatie`-tak verwijderen**

Zoek:
```js
function wizRenderOmschrijving(el) {
  const isInstallatie = R.interventieType === 'Installatie';
  el.innerHTML = `
    <div class="wiz-step-title">Omschrijving &amp; acties</div>
    <div class="wiz-field">
      <label class="wiz-field-label">${isInstallatie ? 'Omschrijving installatie' : 'Omschrijving probleem'}</label>
      <textarea class="wiz-textarea" id="f-probleem" rows="4" placeholder="${isInstallatie ? 'Beschrijf de uitgevoerde installatie...' : 'Beschrijf het probleem...'}">${escHtml(R.probleem)}</textarea>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Ondernomen acties</label>
      <textarea class="wiz-textarea" id="f-acties" rows="6" placeholder="Beschrijf de uitgevoerde werkzaamheden...">${escHtml(R.acties)}</textarea>
    </div>
    ${isInstallatie ? '' : `
    <div class="wiz-field">
      <label class="wiz-field-label">Oorzaak storing</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-product" ${R.oorzaakStoring.includes('Productfout')?'checked':''}><div><div class="wiz-radio-card-label">Productfout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-installatie" ${R.oorzaakStoring.includes('Installatiefout')?'checked':''}><div><div class="wiz-radio-card-label">Installatiefout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-configuratie" ${R.oorzaakStoring.includes('Configuratiefout')?'checked':''}><div><div class="wiz-radio-card-label">Configuratiefout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-andere" ${R.oorzaakStoring.includes('Andere')?'checked':''}><div><div class="wiz-radio-card-label">Andere</div></div></label>
      </div>
    </div>`}`;
}
```
Vervang door:
```js
function wizRenderOmschrijving(el) {
  el.innerHTML = `
    <div class="wiz-step-title">Omschrijving &amp; acties</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Omschrijving probleem</label>
      <textarea class="wiz-textarea" id="f-probleem" rows="4" placeholder="Beschrijf het probleem...">${escHtml(R.probleem)}</textarea>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Ondernomen acties</label>
      <textarea class="wiz-textarea" id="f-acties" rows="6" placeholder="Beschrijf de uitgevoerde werkzaamheden...">${escHtml(R.acties)}</textarea>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Oorzaak storing</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-product" ${R.oorzaakStoring.includes('Productfout')?'checked':''}><div><div class="wiz-radio-card-label">Productfout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-installatie" ${R.oorzaakStoring.includes('Installatiefout')?'checked':''}><div><div class="wiz-radio-card-label">Installatiefout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-configuratie" ${R.oorzaakStoring.includes('Configuratiefout')?'checked':''}><div><div class="wiz-radio-card-label">Configuratiefout</div></div></label>
        <label class="wiz-radio-card"><input type="checkbox" id="f-oorzaak-andere" ${R.oorzaakStoring.includes('Andere')?'checked':''}><div><div class="wiz-radio-card-label">Andere</div></div></label>
      </div>
    </div>`;
}
```

- [ ] **Step 3: `wizSaveOmschrijving()` — dode `isInstallatie`-tak verwijderen**

Zoek:
```js
function wizSaveOmschrijving() {
  R.probleem = wizV('f-probleem');
  R.acties   = wizV('f-acties');
  if (R.interventieType === 'Installatie') { R.oorzaakStoring = []; return; }
  R.oorzaakStoring = Object.entries(OORZAAK_STORING_MAP)
    .filter(([id]) => document.getElementById(id)?.checked)
    .map(([, label]) => label);
  if (!R.oorzaakStoring.length) return '⚠️ Selecteer minstens één oorzaak storing';
}
```
Vervang door:
```js
function wizSaveOmschrijving() {
  R.probleem = wizV('f-probleem');
  R.acties   = wizV('f-acties');
  R.oorzaakStoring = Object.entries(OORZAAK_STORING_MAP)
    .filter(([id]) => document.getElementById(id)?.checked)
    .map(([, label]) => label);
  if (!R.oorzaakStoring.length) return '⚠️ Selecteer minstens één oorzaak storing';
}
```

- [ ] **Step 4: Verifieer live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Open een interventie-ticket-rapport, ga naar stap "Omschrijving" → gedrag exact zoals vóór deze taak (label "Omschrijving probleem", "Oorzaak storing" verplicht, waarschuwing bij geen selectie). Een installatie-rapport doorloopt deze stap sowieso niet meer (zie Task 4) — geen apart te testen pad hier.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "chore: dode installatie-vertakking verwijderen uit Omschrijving-stap"
```

---

## Task 8: `buildRapportHtml()` — installatierapport-PDF

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `R.extraMaterialenTotaal` (Task 4), `R.serienummer` (Task 5).

- [ ] **Step 1: Lees `buildRapportHtml()` volledig, opnieuw, vlak vóór je wijzigt**

`function buildRapportHtml() {` — bevestig dat de functie nog overeenkomt met de citaten hieronder; regelnummers kunnen licht verschoven zijn (zoek op exacte geciteerde tekst).

- [ ] **Step 2: Documenttitel + header-sublabel**

Zoek:
```js
<title>Service Rapport Blitz Power — ${R.datum}</title>
```
Vervang door:
```js
<title>${isInstallatie ? 'Rapport Meerkost Installatie' : 'Service Rapport'} Blitz Power — ${R.datum}</title>
```
Zoek:
```js
<div class="header">${bolt}<div><div class="logo-text">BLITZ POWER</div><div class="logo-sub">SERVICE RAPPORT</div></div></div>
```
Vervang door:
```js
<div class="header">${bolt}<div><div class="logo-text">BLITZ POWER</div><div class="logo-sub">${isInstallatie ? 'RAPPORT MEERKOST INSTALLATIE' : 'SERVICE RAPPORT'}</div></div></div>
```

- [ ] **Step 3: Serienummer/"Type · uitvoering"-rij — verberg de productinfo-cel bij installatie**

Zoek:
```js
  <div class="info-row cols-2">
    <div class="info-cell"><div class="info-lbl">Serienummer</div><div class="info-val">${R.aantalLaadpalen > 1 ? `${escHtml(R.serienummer) || 'Geen serienummer'} (master) — ${R.aantalLaadpalen}×` : (escHtml(R.serienummer)||'—')}</div></div>
    <div class="info-cell"><div class="info-lbl">Type / uitvoering</div><div class="info-val">${productInfo}</div></div>
  </div>
```
Vervang door:
```js
  <div class="info-row ${isInstallatie ? 'cols-1' : 'cols-2'}">
    <div class="info-cell"><div class="info-lbl">Serienummer</div><div class="info-val">${R.aantalLaadpalen > 1 ? `${escHtml(R.serienummer) || 'Geen serienummer'} (master) — ${R.aantalLaadpalen}×` : (escHtml(R.serienummer)||'—')}</div></div>
    ${isInstallatie ? '' : `<div class="info-cell"><div class="info-lbl">Type / uitvoering</div><div class="info-val">${productInfo}</div></div>`}
  </div>
```

- [ ] **Step 4: Omschrijving/Acties/Oorzaak storing — volledig verbergen bij installatie**

Zoek (3 aparte, opeenvolgende blokken):
```js
<div class="rapport-section">
<div class="sec">${isInstallatie ? 'Omschrijving installatie' : 'Omschrijving probleem'}</div>
<div class="block">${escHtml(R.probleem)||'&nbsp;'}</div>
</div>
<div class="rapport-section">
<div class="sec">Ondernomen acties</div>
<div class="block">${escHtml(R.acties)||'&nbsp;'}</div>
</div>
${isInstallatie ? '' : `
<div class="rapport-section">
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
</div>`}
```
Vervang door (samengevoegd tot 1 conditioneel blok — bij installatie wordt geen van de 3 secties nog getoond, want geen van de 3 wordt daar nog ingevuld sinds Task 4/7):
```js
${isInstallatie ? '' : `
<div class="rapport-section">
<div class="sec">Omschrijving probleem</div>
<div class="block">${escHtml(R.probleem)||'&nbsp;'}</div>
</div>
<div class="rapport-section">
<div class="sec">Ondernomen acties</div>
<div class="block">${escHtml(R.acties)||'&nbsp;'}</div>
</div>
<div class="rapport-section">
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
</div>`}
```

- [ ] **Step 5: Onderdelentabel — titel "Meerkost" bij installatie**

Zoek:
```js
${geldigeOnderdelen.length ? `<div class="sec">${isInstallatie ? 'Gebruikte materialen' : 'Vervangen onderdelen'}</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:center">Aantal</th><th style="text-align:right">Stukprijs</th><th style="text-align:right">Subtotaal</th></tr></thead>
<tbody>${partsHtml}</tbody></table>` : ''}
```
Vervang door:
```js
${geldigeOnderdelen.length ? `<div class="sec">${isInstallatie ? 'Meerkost' : 'Vervangen onderdelen'}</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:center">Aantal</th><th style="text-align:right">Stukprijs</th><th style="text-align:right">Subtotaal</th></tr></thead>
<tbody>${partsHtml}</tbody></table>` : ''}
```

- [ ] **Step 6: `extraMaterialenTotaalNum` berekenen**

Zoek:
```js
  const geldigeOnderdelen  = R.onderdelen.filter(p => p.naam);
  const billableOnderdelen = geldigeOnderdelen.filter(p => p.factureren !== false);
  const totaalOnderdelen   = billableOnderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
```
Vervang door:
```js
  const geldigeOnderdelen  = R.onderdelen.filter(p => p.naam);
  const billableOnderdelen = geldigeOnderdelen.filter(p => p.factureren !== false);
  const totaalOnderdelen   = billableOnderdelen.reduce((s, p) => s + (parseFloat(p.prijs)||0) * (parseInt(p.aantal)||1), 0);
  const extraMaterialenTotaalNum = parseFloat(R.extraMaterialenTotaal) || 0;
```

- [ ] **Step 7: Kostenoverzicht — "Meerkost" i.p.v. "Onderdelen", rij "Extra materialen" i.p.v. "Loonkosten" bij installatie**

Zoek:
```js
<div class="rapport-section">
<div class="sec">Kostenoverzicht</div>
<table class="parts"><tbody>
<tr><td>Onderdelen (excl. btw)</td><td style="text-align:right">€ ${totaalOnderdelen.toFixed(2)}</td></tr>
${isInstallatie ? '' : `<tr><td>Loonkosten (excl. btw)${isGarantieTotaal ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}</td><td style="text-align:right">€ ${nettoTotaal.toFixed(2)}</td></tr>`}
<tr style="background:#111;color:#fff;font-weight:700"><td style="text-transform:uppercase;letter-spacing:.05em;font-size:8pt">Totaal te factureren (excl. btw)</td><td style="text-align:right;font-size:11pt">€ ${(totaalOnderdelen + (isInstallatie ? 0 : nettoTotaal)).toFixed(2)}</td></tr>
</tbody></table>
</div>
```
Vervang door:
```js
<div class="rapport-section">
<div class="sec">Kostenoverzicht</div>
<table class="parts"><tbody>
<tr><td>${isInstallatie ? 'Meerkost' : 'Onderdelen'} (excl. btw)</td><td style="text-align:right">€ ${totaalOnderdelen.toFixed(2)}</td></tr>
${isInstallatie
  ? `<tr><td>Extra materialen (excl. btw)</td><td style="text-align:right">€ ${extraMaterialenTotaalNum.toFixed(2)}</td></tr>`
  : `<tr><td>Loonkosten (excl. btw)${isGarantieTotaal ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}</td><td style="text-align:right">€ ${nettoTotaal.toFixed(2)}</td></tr>`}
<tr style="background:#111;color:#fff;font-weight:700"><td style="text-transform:uppercase;letter-spacing:.05em;font-size:8pt">Totaal te factureren (excl. btw)</td><td style="text-align:right;font-size:11pt">€ ${(totaalOnderdelen + (isInstallatie ? extraMaterialenTotaalNum : nettoTotaal)).toFixed(2)}</td></tr>
</tbody></table>
</div>
```

- [ ] **Step 8: Verifieer BEIDE paden live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test` (localStorage-cache voor prijzen leeg).

**Interventie-pad (moet ongewijzigd blijven):** doorloop een volledig interventie-rapport tot het einde, klik "🖨️ Afdrukken / PDF" → bevestig: titel "Service Rapport Blitz Power — …", header "SERVICE RAPPORT", "Type / uitvoering"-cel nog zichtbaar naast Serienummer, "Omschrijving probleem"/"Ondernomen acties"/"Oorzaak storing" alle 3 zichtbaar, "Vervangen onderdelen"-tabel (als er onderdelen zijn), Kostenoverzicht met "Onderdelen"+"Loonkosten"-rijen en correct totaal (identiek aan vóór deze taak).

**Installatie-pad (nieuw):** doorloop een volledig installatie-rapport (serienummer ingevuld, minstens 1 meerkost-item toegevoegd, een bedrag bij "Extra materialen"), klik "🖨️ Afdrukken / PDF" → bevestig: titel "Rapport Meerkost Installatie Blitz Power — …", header "RAPPORT MEERKOST INSTALLATIE", GEEN "Type / uitvoering"-cel, GEEN Omschrijving/Acties/Oorzaak-secties, tabel heet "Meerkost", Kostenoverzicht toont "Meerkost (excl. btw)" + "Extra materialen (excl. btw)" + correct eindtotaal (= som van beide, geen loonkost erbij).

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: installatie-variant van het rapport-PDF-sjabloon (meerkost + extra materialen)"
```

---

## Task 9: Eindcontrole

**Files:** geen wijzigingen — enkel verificatie.

- [ ] **Step 1: Volledige end-to-end-test, beide types, in dezelfde sessie**

Start `node dev-server.mjs`, open `http://localhost:3333/?test` (localStorage-cache voor prijzen leeg). Doorloop een volledig interventie-rapport van begin tot PDF, sluit de wizard, doorloop daarna een volledig installatie-rapport van begin tot PDF — bevestig dat beide onafhankelijk correct werken en dat `R`'s nieuwe/aangepaste velden (`extraMaterialenTotaal`, `serienummer`) correct resetten tussen de twee (open een 3e rapport en controleer dat "Extra materialen" weer leeg start, niet het bedrag van het vorige installatie-rapport).

- [ ] **Step 2: Oudere, al-gearchiveerde rapporten controleren**

Open het rapportenoverzicht (Rapporten-tab) en open minstens 1 rapport dat al vóór dit plan gearchiveerd was (heeft geen `extraMaterialenTotaal`-veld). Bevestig dat de weergave geen `undefined`/`NaN`/lege-tekst-artefacten toont (`parseFloat(undefined)||0` valt netjes terug op `€ 0.00`).

- [ ] **Step 3: Notitie voor Brent — eenmalige productie-migratie van de meerkosten-catalogus (GEEN onderdeel van deze implementatie, enkel documenteren)**

De ~29 nieuwe meerkosten-items staan nu in de `DEFAULTS`/`PRIJZEN_DEFAULTS`-broncode (Task 1), maar de LIVE `/api/prijzen`-blob op productie is waarschijnlijk al eerder gezaaid (seed-on-first-read gebeurt maar 1×) en krijgt deze nieuwe items dus **niet automatisch** bij deployen. Rapporteer aan Brent, na deployen en met zijn expliciete bevestiging vóór je iets richting productie uitvoert: de items zijn na deploy manueel toevoegbaar via Prijsbeheer → tab "Installaties" → "+ Onderdeel toevoegen" per categorie (28-29× naam+prijs intikken), óf via een eenmalig, door Brent bevestigd `PUT /api/prijzen`-verzoek dat de huidige live-lijst aanvult met de nieuwe items (GET huidige lijst → items met een `inst-`-id die nog niet aanwezig zijn toevoegen → PUT terug met `versie+1`). Voer dat laatste niet uit zonder expliciete bevestiging (bestaande projectafspraak over productie-wijzigingen).

- [ ] **Step 4: Geen commit nodig (enkel verificatie/documentatie in dit gesprek)**
