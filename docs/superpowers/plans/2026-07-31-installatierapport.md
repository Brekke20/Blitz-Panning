# Installatierapport + automatische invulling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installaties (naast interventies) een volwaardig rapport laten krijgen in de bestaande rapport-wizard, met automatische invulling van het bezoektype en het servicetype op basis van al-bekende gegevens/Zoho-velden.

**Architecture:** De bestaande, gedeelde rapport-wizard (`WIZ_STEPS`) en het PDF-sjabloon (`buildRapportHtml()`) worden uitgebreid met `R.interventieType === 'Installatie'`-conditionals, in plaats van een aparte wizard/sjabloon te bouwen. Alle wijzigingen zijn additief: het interventie-pad moet na elke taak exact hetzelfde blijven ogen en werken als vandaag.

**Tech Stack:** Vanilla JS (geen build-stap), Netlify Functions (classic-stijl voor `tickets.js`). Geen testframework — verificatie via `node dev-server.mjs` (poort 3333) en live browserverificatie.

## Global Constraints

- **Dit raakt geen e-mailverzending.** Het risico hier is niet "per ongeluk iets versturen" maar wel "de bestaande, al-werkende interventie-flow per ongeluk breken". Elke taak die een gedeelde functie aanraakt (`wizRenderOmschrijving`, `wizSaveOmschrijving`, `wizRenderStatus`, `wizSaveStatus`, `wizNext`, `wizBack`, `wizRenderStep`, `buildRapportHtml`, `renderRapportArchief`) moet BEIDE paden live in de browser testen: een interventie-rapport (bestaand gedrag, moet identiek blijven) én een installatie-rapport (nieuw gedrag).
- Functies die in dit plan aangepast worden zijn lang en kunnen ondertussen licht van regelnummer verschoven zijn t.o.v. wat hieronder geciteerd wordt — lees de functie steeds eerst volledig opnieuw in vóór je wijzigt, zoek op functienaam/exacte bestaande tekst, niet blindelings op regelnummer.
- Nieuwe velden/functies volgen de bestaande naamconventie (camelCase, Nederlandse namen waar de rest van het bestand dat ook doet).

---

## Task 1: `netlify/functions/tickets.js` — 2 nieuwe Zoho-velden

**Files:**
- Modify: `netlify/functions/tickets.js`

**Interfaces:**
- Produces: `ticket.garantieStatus: string` en `ticket.installateurAlLangsGeweest: string` (nieuwe velden op elk ticket-object dat `/api/tickets` teruggeeft, waarden zoals opgeslagen in Zoho — verwacht "ja"/"nee"/"onzeker", niet genormaliseerd op dit niveau). Gebruikt door Task 3.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek in `netlify/functions/tickets.js` naar `interventieDatum:  cf.cf_interventie_datm || null,` binnen de `mapTicket`-functie — bevestig dat de regel erna `createdTime:` is.

- [ ] **Step 2: Voeg de 2 nieuwe velden toe**

Vervang:
```js
        interventieDatum:  cf.cf_interventie_datm || null,
        createdTime:       t.createdTime || null,
```
door:
```js
        interventieDatum:  cf.cf_interventie_datm || null,
        garantieStatus:             cf.cf_garantie_status               || '',
        installateurAlLangsGeweest: cf.cf_installateur_al_langs_geweest || '',
        createdTime:       t.createdTime || null,
```

- [ ] **Step 3: Verifieer**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. In de browserconsole: `fetch('/api/tickets').then(r=>r.json()).then(d => console.log(d.tickets?.[0] ?? d[0]))` (pas aan naargelang de exacte responsvorm die je in de console ziet — bevestig gewoon dat `garantieStatus` en `installateurAlLangsGeweest` als velden aanwezig zijn op minstens één ticket-object, leeg of gevuld).

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/tickets.js
git commit -m "feat: garantieStatus + installateurAlLangsGeweest-velden toevoegen aan ticketgegevens"
```

---

## Task 2: Installatie bereikbaar maken + automatisch bezoektype bepalen

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: niets nieuws van Task 1 (leest `ev.type`/`ticket.isLocal`, al bestaande velden).
- Produces: `getPlanningTicket()`'s pseudo-ticket krijgt een `type`-veld; `openRapport()` zet `R.interventieType` voortaan automatisch. Task 3 en Task 5 bouwen hierop verder (lezen `R.interventieType`).

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function getPlanningTicket`, `async function openRapport`, `function openLocalEventDetail`, en `function wizSaveAlgemeen` in `public/index.html` — bevestig dat ze nog overeenkomen met de onderstaande citaten (zoek op functienaam, regelnummers kunnen verschoven zijn).

- [ ] **Step 2: `getPlanningTicket()` — type doorgeven aan de pseudo-ticket**

Zoek in `getPlanningTicket(id)` de `return`-regel van de lokale-afspraak-tak:
```js
  return {
    id: ev.id, number: '', subject: ev.titel,
    address: ev.adres || ev.notitie || '', hasAddress: !!(ev.adres || ev.notitie),
    assignee: ev.persoon || '',
    phone: ev.telefoon || '', telefoonEindklant: ev.telefoon || '',
    contact: ev.titel, account: '', partner: '',
    serienummer: '', priority: '',
    isLocal: true,
  };
```
Vervang door:
```js
  return {
    id: ev.id, number: '', subject: ev.titel,
    address: ev.adres || ev.notitie || '', hasAddress: !!(ev.adres || ev.notitie),
    assignee: ev.persoon || '',
    phone: ev.telefoon || '', telefoonEindklant: ev.telefoon || '',
    contact: ev.titel, account: '', partner: '',
    serienummer: '', priority: '',
    isLocal: true,
    type: ev.type || '',
  };
```

- [ ] **Step 3: `openRapport()` — automatisch bezoektype bepalen**

Zoek de regel in `openRapport()`'s `R`-seeding-blok:
```js
R.interventieType = 'Interventie'; // default; radio in stap Algemeen kan dit expliciet naar 'Installatie' zetten
```
Vervang door:
```js
// Automatisch bepaald uit de bron: een Zoho-ticket is altijd een interventie, een lokale
// afspraak van het type "Installatie" is een installatie. Radio in stap Algemeen kan dit
// nog steeds manueel overschrijven.
R.interventieType = (ticket.isLocal && ticket.type === 'Installatie') ? 'Installatie' : 'Interventie';
```

- [ ] **Step 4: `openLocalEventDetail()` — Rapport-knop niet langer verbergen**

Zoek:
```js
function openLocalEventDetail(ev) {
  _localDetEvent = ev;
  document.getElementById('ld-btn-rapport').style.display = ev.type === 'Installatie' ? 'none' : '';
```
Vervang door:
```js
function openLocalEventDetail(ev) {
  _localDetEvent = ev;
  document.getElementById('ld-btn-rapport').style.display = '';
```

- [ ] **Step 5: `wizSaveAlgemeen()` — blokkerende melding verwijderen**

Zoek:
```js
R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
if (R.interventieType === 'Installatie') {
  return '⚠️ Voor installaties wordt geen rapport aangemaakt — de klant kreeg hiervoor al een offerte.';
}
```
Vervang door:
```js
R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
```

- [ ] **Step 6: Verifieer BEIDE paden live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`.

**Interventie-pad (moet ongewijzigd blijven):** open een normaal Zoho-ticket, klik "📋 Rapport" → wizard opent normaal op stap "Algemeen" met "Interventie" voorgevinkt. Doorloop tot en met stap 1, bevestig dat er niets veranderd is t.o.v. voorheen.

**Installatie-pad (nieuw):** maak via "Manuele afspraak" een nieuwe afspraak met type "Installatie" (of gebruik een bestaande als die er is). Open het detailvenster van die afspraak → bevestig dat de "📋 Rapport"-knop nu zichtbaar is (voorheen verborgen). Klik erop → bevestig dat de wizard nu opent (geen blokkerende foutmelding meer) met "Installatie" al voorgevinkt in stap "Algemeen".

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: installatie-afspraken bereikbaar maken in de rapport-wizard + automatisch bezoektype"
```

---

## Task 3: Servicetype automatisch invullen + facturatiestap overslaan bij installatie

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `_wizTicket.garantieStatus`/`_wizTicket.installateurAlLangsGeweest` (Task 1), `R.interventieType` (Task 2).
- Produces: nieuwe functie `wizAutoServicetype()`; `R._servicetypeAutoApplied`-vlag op het `R`-object.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function wizRenderFacturatie`, `function wizNext`, `function wizBack`, en `function wizRenderStep` in `public/index.html`.

- [ ] **Step 2: `wizAutoServicetype()` toevoegen + toepassen in `wizRenderFacturatie()`**

**Belangrijk — bijgewerkt na live verificatie in Task 1:** de werkelijke Zoho-keuzelijst voor `cf_garantie_status` bevat NIET "ja"/"nee"/"onzeker" (zoals het designdoc aanvankelijk aannam), maar de letterlijke keuzes **"Binnen garantie" / "Buiten garantie" / "Onzeker"** (bevestigd door Brent). Voor `cf_installateur_al_langs_geweest` zijn de keuzes wel degelijk **"Ja" / "Nee" / "Onzeker"** (ook bevestigd). De vergelijkingslogica hieronder is al aangepast aan deze bevestigde waarden — dit is de correcte, finale versie, gebruik deze code letterlijk.

Voeg toe, vlak vóór `function wizRenderFacturatie`:
```js
function wizAutoServicetype() {
  const garantie = String(_wizTicket?.garantieStatus || '').trim().toLowerCase();
  const langsgeweest = String(_wizTicket?.installateurAlLangsGeweest || '').trim().toLowerCase();
  if (garantie === 'binnen garantie') return 'garantie';
  if (langsgeweest === 'ja') return '2e-lijn';
  if (langsgeweest === 'nee') return '1e-lijn';
  return null; // onduidelijk -- geen auto-selectie, huidige/handmatige waarde van R.servicetype blijft staan
}
```
Zoek het begin van `function wizRenderFacturatie(el) {` en voeg er, als allereerste regels van de functie (vóór de bestaande `el.innerHTML = ...`), dit aan toe:
```js
function wizRenderFacturatie(el) {
  if (!R._servicetypeAutoApplied) {
    const auto = wizAutoServicetype();
    if (auto) R.servicetype = auto;
    R._servicetypeAutoApplied = true;
  }
  el.innerHTML = `
    ...` // bestaande inhoud, ongewijzigd
```
(De rest van `wizRenderFacturatie` blijft volledig ongewijzigd — de radio's lezen al van `R.servicetype`, dus de auto-toegepaste waarde verschijnt gewoon voorgevinkt.)

- [ ] **Step 3: `R._servicetypeAutoApplied` resetten bij het openen van een nieuw rapport**

Zoek in `openRapport()` de regel `R.servicetype    = '2e-lijn';` (in hetzelfde `R`-seeding-blok als Task 2 Step 3) en voeg er een regel aan toe:
```js
R.servicetype    = '2e-lijn';
R._servicetypeAutoApplied = false;
```

- [ ] **Step 4: `wizNext()`/`wizBack()` — facturatiestap overslaan bij installatie**

Zoek:
```js
function wizNext() {
  const step   = WIZ_STEPS[_wizStep];
  const result = step.save ? step.save() : undefined;
  if (result === false || typeof result === 'string') {
    toast(typeof result === 'string' ? result : '⚠️ Kan niet doorgaan naar de volgende stap', 3500);
    return;
  }
  if (_wizStep < WIZ_STEPS.length - 1) {
    _wizStep++;
    wizRenderStep();
  } else {
    printRapport();
  }
}
```
Vervang door:
```js
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
```
Zoek:
```js
function wizBack() {
  if (WIZ_STEPS[_wizStep].save) WIZ_STEPS[_wizStep].save();
  if (_wizStep > 0) {
    _wizStep--;
    wizRenderStep();
  }
}
```
Vervang door:
```js
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

- [ ] **Step 5: `wizRenderStep()` — voortgangsindicator (dots + "X / Y"-label) overslaat de facturatiestap bij installatie**

Zoek:
```js
function wizRenderStep() {
  const total = WIZ_STEPS.length;
  const step  = WIZ_STEPS[_wizStep];

  // Dots
  const dotsEl = document.getElementById('wiz-dots');
  dotsEl.innerHTML = WIZ_STEPS.map((s, i) =>
    `<div class="wiz-step-dot ${i === _wizStep ? 'active' : i < _wizStep ? 'done' : ''}"></div>`
  ).join('');

  document.getElementById('wiz-step-label').textContent = `${_wizStep+1} / ${total} — ${step.label}`;
  document.getElementById('wiz-ftr-info').textContent   = step.label;
```
Vervang door:
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
```
(De rest van `wizRenderStep` — knoppen terug/volgende, body-rendering — blijft ongewijzigd; `_wizStep` blijft de echte array-index in `WIZ_STEPS`, enkel de WEERGAVE (dots/telling) filtert de overgeslagen stap eruit.)

- [ ] **Step 6: Verifieer BEIDE paden live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`.

**Interventie-pad (moet ongewijzigd blijven):** open een Zoho-ticket-rapport, doorloop stap "Algemeen" → "Facturatie" moet nog steeds gewoon verschijnen, met de voortgangsindicator "2 / 8". Kies handmatig een servicetype, ga verder en terug — je keuze moet bewaard blijven (niet overschreven door de auto-logica, want die geldt maar één keer per rapport).

**Installatie-pad (nieuw):** open een installatie-afspraak-rapport (zie Task 2), doorloop stap "Algemeen" → klik "Volgende" → bevestig dat je RECHTSTREEKS op de stap "Product" terechtkomt (facturatiestap volledig overgeslagen), met voortgangsindicator "2 / 7" (niet "3 / 8"). Klik "Terug" vanaf "Product" → bevestig dat je terug op "Algemeen" belandt (niet op de overgeslagen facturatiestap).

Test ook de auto-invulling zelf: als je in de browserconsole tijdelijk `_wizTicket.garantieStatus='Binnen garantie'` zet vóór je een INTERVENTIE-rapport opent op stap "Facturatie" (via een Zoho-ticket, waar de facturatiestap wél getoond wordt), moet "Garantie" voorgevinkt staan. Herhaal met `_wizTicket.installateurAlLangsGeweest='Ja'` (zonder garantieStatus, of met `garantieStatus='Buiten garantie'`) → "2e lijn" moet voorgevinkt staan.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: servicetype automatisch invullen + facturatiestap overslaan bij installatie"
```

---

## Task 4: Eenheid (stuk/meter) op de onderdelenregel

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Produces: `R.onderdelen[].eenheid: 'stuk'|'meter'` (nieuw veld op elk lijnitem); nieuwe functie `wizUpdSelEenheid(i, val)`. Task 5 (weergave in `wizRenderStatus`) en Task 6 (weergave in `buildRapportHtml`) lezen dit veld.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function wizVoegCatToe`, `function wizAddVrijeRegel`, `function _wizRenderGeselecteerd`, en de `wizUpdSel*`-functiegroep in `public/index.html`.

- [ ] **Step 2: `wizVoegCatToe()` — eenheid overnemen uit de catalogus**

Zoek:
```js
    R.onderdelen.push({ id: o.id, naam: o.naam, prijs: o.prijs, aantal: 1, factureren: true });
```
Vervang door:
```js
    R.onderdelen.push({ id: o.id, naam: o.naam, prijs: o.prijs, aantal: 1, factureren: true, eenheid: o.eenheid || 'stuk' });
```

- [ ] **Step 3: `wizAddVrijeRegel()` — standaard eenheid**

Zoek:
```js
  R.onderdelen.push({ id: 'vrij-' + Date.now(), naam: '', prijs: '', aantal: 1, factureren: true });
```
Vervang door:
```js
  R.onderdelen.push({ id: 'vrij-' + Date.now(), naam: '', prijs: '', aantal: 1, factureren: true, eenheid: 'stuk' });
```

- [ ] **Step 4: `_wizRenderGeselecteerd()` — eenheid tonen + wijzigbaar maken bij vrije regels**

Zoek:
```js
      <div class="wiz-sel-bottom">
        <div class="wiz-sel-aantal-wrap">
          <span class="wiz-sel-aantal-lbl">Aantal</span>
          <input class="wiz-sel-aantal" type="number" min="1" step="1" value="${p.aantal||1}"
            oninput="wizUpdSelAantal(${i},this.value)" />
        </div>
        ${isVrij
          ? `<input class="wiz-part-prijs" type="number" placeholder="€ prijs" min="0" step="0.01"
              style="width:80px;font-size:0.82rem" value="${p.prijs||''}"
              oninput="wizUpdSelPrijs(${i},this.value)" />`
          : `<span class="wiz-sel-stukprijs">€ ${(parseFloat(p.prijs)||0).toFixed(2)} / stuk</span>`
        }
        <span class="wiz-sel-subtotaal">€ ${subtotaal.toFixed(2)}</span>
```
Vervang door:
```js
      <div class="wiz-sel-bottom">
        <div class="wiz-sel-aantal-wrap">
          <span class="wiz-sel-aantal-lbl">Aantal${p.eenheid==='meter' ? ' (meter)' : ''}</span>
          <input class="wiz-sel-aantal" type="number" min="1" step="1" value="${p.aantal||1}"
            oninput="wizUpdSelAantal(${i},this.value)" />
        </div>
        ${isVrij
          ? `<input class="wiz-part-prijs" type="number" placeholder="€ prijs" min="0" step="0.01"
              style="width:80px;font-size:0.82rem" value="${p.prijs||''}"
              oninput="wizUpdSelPrijs(${i},this.value)" />
             <select class="wiz-part-eenheid" style="width:60px;font-size:0.8rem" onchange="wizUpdSelEenheid(${i},this.value)">
               <option value="stuk" ${p.eenheid!=='meter'?'selected':''}>stuk</option>
               <option value="meter" ${p.eenheid==='meter'?'selected':''}>meter</option>
             </select>`
          : `<span class="wiz-sel-stukprijs">€ ${(parseFloat(p.prijs)||0).toFixed(2)} / ${p.eenheid || 'stuk'}</span>`
        }
        <span class="wiz-sel-subtotaal">€ ${subtotaal.toFixed(2)}</span>
```

- [ ] **Step 5: Nieuwe helper `wizUpdSelEenheid`**

Zoek de bestaande groep:
```js
function wizUpdSelNaam(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].naam      = val; _wizUpdateTotaalRow(); }
function wizUpdSelAantal(i, val){ if (R.onderdelen[i]) R.onderdelen[i].aantal    = parseInt(val)||1; _wizUpdateTotaalRow(); }
function wizUpdSelPrijs(i, val) { if (R.onderdelen[i]) R.onderdelen[i].prijs     = val; _wizUpdateTotaalRow(); }
function wizUpdSelFact(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].factureren = val; _wizUpdateTotaalRow(); }
```
Voeg eraan toe:
```js
function wizUpdSelNaam(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].naam      = val; _wizUpdateTotaalRow(); }
function wizUpdSelAantal(i, val){ if (R.onderdelen[i]) R.onderdelen[i].aantal    = parseInt(val)||1; _wizUpdateTotaalRow(); }
function wizUpdSelPrijs(i, val) { if (R.onderdelen[i]) R.onderdelen[i].prijs     = val; _wizUpdateTotaalRow(); }
function wizUpdSelFact(i, val)  { if (R.onderdelen[i]) R.onderdelen[i].factureren = val; _wizUpdateTotaalRow(); }
function wizUpdSelEenheid(i, val) { if (R.onderdelen[i]) R.onderdelen[i].eenheid = val; _wizHertekenGeselecteerd(); }
```
(`_wizHertekenGeselecteerd()` i.p.v. enkel `_wizUpdateTotaalRow()`, omdat de label "Aantal (meter)" mee moet herrenderen bij een eenheidswissel — de bestaande `_wizUpdateTotaalRow()` laat de input-elementen zelf bewust met rust, wat hier niet volstaat.)

- [ ] **Step 6: Verifieer BEIDE paden live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`. Open eender welk rapport (interventie of installatie, dit werkt identiek voor beide), ga naar de stap met de onderdelentabel. Voeg een catalogus-item toe → bevestig "€ X,XX / stuk" (bestaand gedrag ongewijzigd, aangezien alle catalogus-items vandaag `eenheid:'stuk'` hebben). Voeg een vrije regel toe → bevestig het nieuwe eenheid-keuzevakje naast het prijsveld; wissel naar "meter" → bevestig dat het "Aantal"-label meteen "Aantal (meter)" wordt en de subtotaalberekening (prijs × aantal) correct blijft rekenen.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: eenheid (stuk/meter) op onderdelenregels"
```

---

## Task 5: Installatie-specifieke inhoud in de wizardstappen Omschrijving en Status

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `R.interventieType` (Task 2), `p.eenheid` op onderdelenregels (Task 4, al zichtbaar via `_wizRenderGeselecteerd()` zonder verdere aanpassing hier).

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek `function wizRenderOmschrijving`, `function wizSaveOmschrijving`, `function wizRenderStatus`, en `function wizSaveStatus` in `public/index.html` — lees ze volledig, ze zijn hieronder integraal geciteerd.

- [ ] **Step 2: `wizRenderOmschrijving()` — ander label + geen "Oorzaak storing" bij installatie**

Zoek:
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
Vervang door:
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

- [ ] **Step 3: `wizSaveOmschrijving()` — validatie overslaan bij installatie**

De huidige functie valideert dat minstens 1 "oorzaak storing" aangevinkt is; bij installatie wordt die sectie niet meer getoond, dus deze validatie zou de wizard blokkeren als ze niet aangepast wordt. Zoek:
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
Vervang door:
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

- [ ] **Step 4: `wizRenderStatus()` — geen "Definitief hersteld"/"Nieuwe interventie nodig" bij installatie, andere titel**

Zoek (het volledige begin van de functie, tot en met de sluitende `</div>` van de "Nieuwe interventie nodig"-`wiz-field`, gevolgd door de bestaande `<div class="wiz-sep"></div>` die de onderdelen-sectie inluidt):
```js
  el.innerHTML = `
    <div class="wiz-step-title">Status &amp; onderdelen</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Definitief hersteld</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-hersteld" value="ja" ${R.hersteld==='ja'?'checked':''}><div><div class="wiz-radio-card-label">Ja</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-hersteld" value="nee" ${R.hersteld!=='ja'?'checked':''}><div><div class="wiz-radio-card-label">Nee</div></div></label>
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Nieuwe interventie nodig</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-nieuw-inter" value="ja" ${R.nieuwInter==='ja'?'checked':''}><div><div class="wiz-radio-card-label">Ja</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-nieuw-inter" value="nee" ${R.nieuwInter!=='ja'?'checked':''}><div><div class="wiz-radio-card-label">Nee</div></div></label>
      </div>
    </div>
    <div class="wiz-sep"></div>
```
Vervang door:
```js
  const isInstallatie = R.interventieType === 'Installatie';
  el.innerHTML = `
    <div class="wiz-step-title">${isInstallatie ? 'Materialen' : 'Status & onderdelen'}</div>
    ${isInstallatie ? '' : `
    <div class="wiz-field">
      <label class="wiz-field-label">Definitief hersteld</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-hersteld" value="ja" ${R.hersteld==='ja'?'checked':''}><div><div class="wiz-radio-card-label">Ja</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-hersteld" value="nee" ${R.hersteld!=='ja'?'checked':''}><div><div class="wiz-radio-card-label">Nee</div></div></label>
      </div>
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Nieuwe interventie nodig</label>
      <div class="wiz-radio-cards row">
        <label class="wiz-radio-card"><input type="radio" name="f-nieuw-inter" value="ja" ${R.nieuwInter==='ja'?'checked':''}><div><div class="wiz-radio-card-label">Ja</div></div></label>
        <label class="wiz-radio-card"><input type="radio" name="f-nieuw-inter" value="nee" ${R.nieuwInter!=='ja'?'checked':''}><div><div class="wiz-radio-card-label">Nee</div></div></label>
      </div>
    </div>`}
    <div class="wiz-sep"></div>
```
(De rest van `wizRenderStatus` — tag-filters, onderdelen-sectie, "Varia/opmerkingen" — blijft volledig ongewijzigd, ook bij installatie: de onderdelentabel is precies wat een installatierapport nodig heeft, nu met eenheid dankzij Task 4.)

`wizSaveStatus()` blijft ONGEWIJZIGD (geen aanpassing nodig — `wizChecked('f-hersteld') || 'nee'` geeft veilig `'nee'` terug wanneer de radio's niet gerenderd zijn, en `R.hersteld`/`R.nieuwInter` worden nergens gebruikt in een installatierapport, zie Task 6):
```js
function wizSaveStatus() {
  R.hersteld   = wizChecked('f-hersteld')    || 'nee';
  R.nieuwInter = wizChecked('f-nieuw-inter') || 'nee';
  R.varia      = wizV('f-varia');
}
```

- [ ] **Step 5: Verifieer BEIDE paden live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`.

**Interventie-pad (moet ongewijzigd blijven):** doorloop een interventie-rapport tot stap "Omschrijving" → "Oorzaak storing" moet nog gewoon verschijnen; probeer verder te gaan zonder een oorzaak aan te vinken → moet nog steeds de waarschuwing tonen en blokkeren. Vink er een aan, ga verder naar stap "Status" → "Definitief hersteld"/"Nieuwe interventie nodig" moeten nog gewoon verschijnen, titel "Status & onderdelen".

**Installatie-pad (nieuw):** doorloop een installatie-rapport tot stap "Omschrijving" → label moet "Omschrijving installatie" zijn, GEEN "Oorzaak storing"-sectie zichtbaar; klik "Volgende" → moet ZONDER waarschuwing doorgaan (geen blokkade meer). Op stap "Status" (titel nu "Materialen") → GEEN "Definitief hersteld"/"Nieuwe interventie nodig" zichtbaar, wél de onderdelen-sectie met zoekbalk en "+ Vrije regel"-knop, identiek werkend als bij interventies.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: installatie-specifieke inhoud in wizardstappen Omschrijving en Status"
```

---

## Task 6: `buildRapportHtml()` — installatie-variant van het PDF-sjabloon

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes: `R.interventieType` (Task 2), `p.eenheid` op onderdelenregels (Task 4), `R.probleem` (nu "Omschrijving installatie" bij installatie, Task 5).

- [ ] **Step 1: Lees `buildRapportHtml()` volledig, opnieuw, vlak vóór je wijzigt**

`function buildRapportHtml() {` (geen parameters — leest `R` rechtstreeks uit module-scope, net als de rest van de wizard). Bevestig dat de functie nog overeenkomt met de citaten hieronder; regelnummers kunnen licht verschoven zijn (zoek op de exacte geciteerde tekst, niet blindelings op regelnummer) sinds de Kostenoverzicht-wijziging van deze week.

- [ ] **Step 2: `isInstallatie`-vlag toevoegen bovenaan de functie**

Zoek:
```js
function buildRapportHtml() {
  const facturatieLabel = R.facturatie === 'vrij'
```
Vervang door:
```js
function buildRapportHtml() {
  const isInstallatie = R.interventieType === 'Installatie';
  const facturatieLabel = R.facturatie === 'vrij'
```

- [ ] **Step 3: Sectiekop "Interventie adres" → "Installatie adres"**

Zoek:
```js
    <div class="info-cell"><div class="info-lbl">Interventie adres</div><div class="info-val">${escHtml(R.adres)||'—'}</div></div>
```
Vervang door:
```js
    <div class="info-cell"><div class="info-lbl">${isInstallatie ? 'Installatie adres' : 'Interventie adres'}</div><div class="info-val">${escHtml(R.adres)||'—'}</div></div>
```

- [ ] **Step 4: "Omschrijving probleem" → "Omschrijving installatie"**

Zoek:
```js
<div class="rapport-section">
<div class="sec">Omschrijving probleem</div>
<div class="block">${escHtml(R.probleem)||'&nbsp;'}</div>
</div>
```
Vervang door:
```js
<div class="rapport-section">
<div class="sec">${isInstallatie ? 'Omschrijving installatie' : 'Omschrijving probleem'}</div>
<div class="block">${escHtml(R.probleem)||'&nbsp;'}</div>
</div>
```

- [ ] **Step 5: "Oorzaak storing"-sectie overslaan bij installatie**

Zoek:
```js
<div class="rapport-section">
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
</div>
```
Vervang door:
```js
${isInstallatie ? '' : `
<div class="rapport-section">
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
</div>`}
```

- [ ] **Step 6: "Status laadinfrastructuur"-sectie overslaan bij installatie**

Zoek:
```js
<div class="rapport-section">
<div class="sec">Status laadinfrastructuur</div>
<div class="status-row">
  <div class="status-cell"><div class="info-lbl">Definitief hersteld</div><strong>${R.hersteld==='ja'?'Ja':'Nee'}</strong></div>
  <div class="status-cell"><div class="info-lbl">Nieuwe interventie nodig</div><strong>${R.nieuwInter==='ja'?'Ja':'Nee'}</strong></div>
</div>
</div>
```
Vervang door:
```js
${isInstallatie ? '' : `
<div class="rapport-section">
<div class="sec">Status laadinfrastructuur</div>
<div class="status-row">
  <div class="status-cell"><div class="info-lbl">Definitief hersteld</div><strong>${R.hersteld==='ja'?'Ja':'Nee'}</strong></div>
  <div class="status-cell"><div class="info-lbl">Nieuwe interventie nodig</div><strong>${R.nieuwInter==='ja'?'Ja':'Nee'}</strong></div>
</div>
</div>`}
```

- [ ] **Step 7: "Vervangen onderdelen" → "Gebruikte materialen" + eenheid tonen in de tabel**

Zoek (het `partsHtml`-opbouwblok, rond regel 6050-6060):
```js
  let partsHtml = geldigeOnderdelen
    .map(p => {
      const aantal      = parseInt(p.aantal) || 1;
      const factureren  = p.factureren !== false;
      const stukprijs   = parseFloat(p.prijs) || 0;
      const subtotaal   = stukprijs * aantal;
      return `<tr>
        <td>${escHtml(p.naam)}${!factureren ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(niet aangerekend)</span>' : ''}</td>
        <td style="text-align:center">${aantal}</td>
        <td style="text-align:right">${factureren ? `€ ${stukprijs.toFixed(2)}` : '—'}</td>
        <td style="text-align:right">${factureren ? `€ ${subtotaal.toFixed(2)}` : '—'}</td>
```
Vervang door (enkel de `<td style="text-align:center">`-regel verandert):
```js
  let partsHtml = geldigeOnderdelen
    .map(p => {
      const aantal      = parseInt(p.aantal) || 1;
      const factureren  = p.factureren !== false;
      const stukprijs   = parseFloat(p.prijs) || 0;
      const subtotaal   = stukprijs * aantal;
      return `<tr>
        <td>${escHtml(p.naam)}${!factureren ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(niet aangerekend)</span>' : ''}</td>
        <td style="text-align:center">${aantal}${p.eenheid==='meter' ? ' meter' : ''}</td>
        <td style="text-align:right">${factureren ? `€ ${stukprijs.toFixed(2)}` : '—'}</td>
        <td style="text-align:right">${factureren ? `€ ${subtotaal.toFixed(2)}` : '—'}</td>
```
(oudere, al-gearchiveerde rapporten hebben geen `eenheid`-veld op hun onderdelen — `p.eenheid==='meter'` is dan gewoon `false`, dus die blijven een kaal getal tonen zoals vandaag.)

Zoek daarna:
```js
${geldigeOnderdelen.length ? `<div class="sec">Vervangen onderdelen</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:center">Aantal</th><th style="text-align:right">Stukprijs</th><th style="text-align:right">Subtotaal</th></tr></thead>
<tbody>${partsHtml}</tbody></table>` : ''}
```
Vervang door:
```js
${geldigeOnderdelen.length ? `<div class="sec">${isInstallatie ? 'Gebruikte materialen' : 'Vervangen onderdelen'}</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:center">Aantal</th><th style="text-align:right">Stukprijs</th><th style="text-align:right">Subtotaal</th></tr></thead>
<tbody>${partsHtml}</tbody></table>` : ''}
```

- [ ] **Step 8: "Loonkosten"-sectie overslaan bij installatie**

Zoek (de volledige IIFE, regel ~6166-6208):
```js
${(() => {
  const wMin = calcWerktijdMin(R.start, R.stop);
  const aMin = parseInt(R.aanrijtijdMin) || 0;
  const st   = R.servicetype;
  const { bruto, totMin, extraUren } = berekenLoonkost(st, wMin, aMin);
  const isGarantie = st === 'garantie';
  const netto = isGarantie ? 0 : bruto;

  const fmtMin = m => {
    const h = Math.floor(m / 60), mn = m % 60;
    return h > 0 ? (mn > 0 ? `${h}u${String(mn).padStart(2,'0')}` : `${h}u`) : `${mn} min`;
  };

  let detail = '';
  if (st === '2e-lijn') {
    const delen = [];
    if (aMin) delen.push(`Aanrijtijd: ${fmtMin(aMin)}`);
    delen.push(`Werktijd: ${fmtMin(wMin)}`);
    delen.push(`Totaal: ${fmtMin(totMin)} → forfait €175 (eerste 3u)`);
    if (extraUren > 0) delen.push(`${extraUren} extra gestart${extraUren > 1 ? 'e' : ''} uur × €75 = €${extraUren * 75}`);
    detail = delen.join(' &nbsp;·&nbsp; ');
  } else if (st === '1e-lijn') {
    const gu = Math.ceil(wMin / 60);
    detail = `Werktijd: ${fmtMin(wMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115`;
  } else {
    const gu = Math.ceil(wMin / 60);
    detail = `Werktijd: ${fmtMin(wMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115 — volledig gedekt door garantie`;
  }

  const nettoCel = isGarantie
    ? `<td style="text-align:right"><span style="text-decoration:line-through;color:#aaa;font-size:8pt">€ ${bruto.toFixed(2)}</span> &nbsp; <strong style="color:#00b87a">€ 0,00</strong></td>`
    : `<td style="text-align:right"><strong>€ ${netto.toFixed(2)}</strong></td>`;

  return `<div class="sec">Loonkosten</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:right">Bedrag (excl. btw)</th></tr></thead>
<tbody>
<tr>
  <td>${stLabel}${isGarantie ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}<br>
    <span style="font-size:7.5pt;color:#777">${detail}</span></td>
  ${nettoCel}
</tr>
</tbody></table>`;
})()}
```
Vervang door (de hele IIFE-aanroep wordt geconditioneerd, de inhoud van de IIFE zelf blijft ongewijzigd):
```js
${isInstallatie ? '' : (() => {
  const wMin = calcWerktijdMin(R.start, R.stop);
  const aMin = parseInt(R.aanrijtijdMin) || 0;
  const st   = R.servicetype;
  const { bruto, totMin, extraUren } = berekenLoonkost(st, wMin, aMin);
  const isGarantie = st === 'garantie';
  const netto = isGarantie ? 0 : bruto;

  const fmtMin = m => {
    const h = Math.floor(m / 60), mn = m % 60;
    return h > 0 ? (mn > 0 ? `${h}u${String(mn).padStart(2,'0')}` : `${h}u`) : `${mn} min`;
  };

  let detail = '';
  if (st === '2e-lijn') {
    const delen = [];
    if (aMin) delen.push(`Aanrijtijd: ${fmtMin(aMin)}`);
    delen.push(`Werktijd: ${fmtMin(wMin)}`);
    delen.push(`Totaal: ${fmtMin(totMin)} → forfait €175 (eerste 3u)`);
    if (extraUren > 0) delen.push(`${extraUren} extra gestart${extraUren > 1 ? 'e' : ''} uur × €75 = €${extraUren * 75}`);
    detail = delen.join(' &nbsp;·&nbsp; ');
  } else if (st === '1e-lijn') {
    const gu = Math.ceil(wMin / 60);
    detail = `Werktijd: ${fmtMin(wMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115`;
  } else {
    const gu = Math.ceil(wMin / 60);
    detail = `Werktijd: ${fmtMin(wMin)} → ${gu} gestart${gu !== 1 ? 'e' : ''} uur × €115 — volledig gedekt door garantie`;
  }

  const nettoCel = isGarantie
    ? `<td style="text-align:right"><span style="text-decoration:line-through;color:#aaa;font-size:8pt">€ ${bruto.toFixed(2)}</span> &nbsp; <strong style="color:#00b87a">€ 0,00</strong></td>`
    : `<td style="text-align:right"><strong>€ ${netto.toFixed(2)}</strong></td>`;

  return `<div class="sec">Loonkosten</div>
<table class="parts"><thead><tr><th>Omschrijving</th><th style="text-align:right">Bedrag (excl. btw)</th></tr></thead>
<tbody>
<tr>
  <td>${stLabel}${isGarantie ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}<br>
    <span style="font-size:7.5pt;color:#777">${detail}</span></td>
  ${nettoCel}
</tr>
</tbody></table>`;
})()}
```

- [ ] **Step 9: Kostenoverzicht — geen loonkost bij installatie**

Zoek:
```js
<div class="rapport-section">
<div class="sec">Kostenoverzicht</div>
<table class="parts"><tbody>
<tr><td>Onderdelen (excl. btw)</td><td style="text-align:right">€ ${totaalOnderdelen.toFixed(2)}</td></tr>
<tr><td>Loonkosten (excl. btw)${isGarantieTotaal ? ' <span style="font-size:7.5pt;color:#888;font-style:italic">(100% korting)</span>' : ''}</td><td style="text-align:right">€ ${nettoTotaal.toFixed(2)}</td></tr>
<tr style="background:#111;color:#fff;font-weight:700"><td style="text-transform:uppercase;letter-spacing:.05em;font-size:8pt">Totaal te factureren (excl. btw)</td><td style="text-align:right;font-size:11pt">€ ${(totaalOnderdelen + nettoTotaal).toFixed(2)}</td></tr>
</tbody></table>
</div>
```
Vervang door:
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
(`totaalOnderdelen`/`nettoTotaal`/`isGarantieTotaal` zijn bestaande variabelen, eerder in de functie berekend — deze stap raakt enkel de 3 tabelrijen hierboven, niets van de berekening zelf.)

- [ ] **Step 8: Verifieer BEIDE paden live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`.

**Interventie-pad (moet ongewijzigd blijven):** doorloop een volledig interventie-rapport tot het einde, klik "🖨️ Afdrukken / PDF" → bevestig dat het gegenereerde rapport er exact hetzelfde uitziet als vóór deze taak: "Interventie adres", "Omschrijving probleem", "Status laadinfrastructuur", "Vervangen onderdelen" (zonder eenheid-tekst als er geen `eenheid` op de regel staat, of "/ stuk" als die er wel staat — beide moeten kloppen), "Loonkosten"-sectie, correct "Totaal te factureren" inclusief loonkost.

**Installatie-pad (nieuw):** doorloop een volledig installatie-rapport (inclusief minstens 1 materiaal met eenheid "meter"), klik "🖨️ Afdrukken / PDF" → bevestig: "Installatie adres", "Omschrijving installatie", GEEN "Status laadinfrastructuur"-sectie, "Gebruikte materialen" met het meter-materiaal correct getoond (bv. "18 meter"), GEEN "Loonkosten"-sectie, "Totaal te factureren" = enkel het onderdelentotaal (geen loonkost erbij opgeteld).

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: installatie-variant van het rapport-PDF-sjabloon"
```

---

## Task 7: Filter Service/Installatie op het rapportenoverzicht

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Produces: `let _rapportFilter`, nieuwe functie `setRapportFilter(type)`.

- [ ] **Step 1: Lees de huidige code ter controle**

Zoek de Rapporten-tab-header-HTML (bevat `id="rapp-van"`/`id="rapp-tot"`) en `function renderRapportArchief` in `public/index.html`.

- [ ] **Step 2: Filterknoppen toevoegen aan de Rapporten-tab-header**

Zoek:
```html
<div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--surface);position:sticky;top:92px;z-index:26">
  <span style="font-size:0.84rem;font-weight:600;flex:1">📋 Rapport archief</span>
  <input type="date" id="rapp-van"  style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);color:var(--text);padding:4px 7px;font-size:0.75rem;font-family:inherit" title="Export van" />
  <span style="font-size:0.75rem;color:var(--muted)">–</span>
  <input type="date" id="rapp-tot"  style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);color:var(--text);padding:4px 7px;font-size:0.75rem;font-family:inherit" title="Export tot" />
  <button class="btn-sec" onclick="exportTicketLog()" style="font-size:0.75rem;padding:5px 10px">📊 Excel export</button>
  <button class="btn-sec" onclick="laadRapportArchief()" style="font-size:0.75rem;padding:5px 10px">↺ Herladen</button>
</div>
```
Vervang door:
```html
<div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--surface);position:sticky;top:92px;z-index:26">
  <span style="font-size:0.84rem;font-weight:600;flex:1">📋 Rapport archief</span>
  <div style="display:flex;gap:4px" id="rapp-filter-btns">
    <button class="btn-sec rapp-filter-btn active" data-filter="alle" style="font-size:0.75rem;padding:5px 10px">Alle</button>
    <button class="btn-sec rapp-filter-btn" data-filter="Interventie" style="font-size:0.75rem;padding:5px 10px">Interventie</button>
    <button class="btn-sec rapp-filter-btn" data-filter="Installatie" style="font-size:0.75rem;padding:5px 10px">Installatie</button>
  </div>
  <input type="date" id="rapp-van"  style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);color:var(--text);padding:4px 7px;font-size:0.75rem;font-family:inherit" title="Export van" />
  <span style="font-size:0.75rem;color:var(--muted)">–</span>
  <input type="date" id="rapp-tot"  style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r);color:var(--text);padding:4px 7px;font-size:0.75rem;font-family:inherit" title="Export tot" />
  <button class="btn-sec" onclick="exportTicketLog()" style="font-size:0.75rem;padding:5px 10px">📊 Excel export</button>
  <button class="btn-sec" onclick="laadRapportArchief()" style="font-size:0.75rem;padding:5px 10px">↺ Herladen</button>
</div>
```
Zoek in de globale `<style>`-sectie een bestaande `.btn-sec`-regel als ankerpunt, en voeg er vlak na toe (bevestigd: `var(--accent)` is de correcte, al 89× elders in dit bestand gebruikte CSS-variabelnaam voor het accentkleur):
```css
.rapp-filter-btn.active { background: var(--accent); color: #fff; border-color: var(--accent); }
```

- [ ] **Step 3: `setRapportFilter()` + event-wiring toevoegen**

Voeg toe, vlak vóór `function renderRapportArchief`:
```js
let _rapportFilter = 'alle'; // 'alle' | 'Interventie' | 'Installatie'
function setRapportFilter(type) {
  _rapportFilter = type;
  document.querySelectorAll('.rapp-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === type);
  });
  renderRapportArchief();
}
```
Zoek de plek waar de app zijn event-listeners bij opstart bindt (of, als er geen centrale plek is, direct na de definitie van `setRapportFilter` zelf) en voeg toe:
```js
document.querySelectorAll('.rapp-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => setRapportFilter(btn.dataset.filter));
});
```

- [ ] **Step 4: `renderRapportArchief()` — filteren + index-bug vermijden**

Zoek:
```js
function renderRapportArchief() {
  const body = document.getElementById('rapp-archief-body');
  if (!body) return;
  if (!_rapportArchief.length) {
    body.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;padding:20px 0">Nog geen rapporten gearchiveerd.</div>';
    return;
  }
  body.innerHTML = _rapportArchief.map((r, i) => {
```
Vervang door:
```js
function renderRapportArchief() {
  const body = document.getElementById('rapp-archief-body');
  if (!body) return;
  if (!_rapportArchief.length) {
    body.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;padding:20px 0">Nog geen rapporten gearchiveerd.</div>';
    return;
  }
  const gefilterd = _rapportFilter === 'alle'
    ? _rapportArchief
    : _rapportArchief.filter(r => (r.interventieType || 'Interventie') === _rapportFilter);
  if (!gefilterd.length) {
    body.innerHTML = `<div style="color:var(--muted);font-size:0.82rem;padding:20px 0">Geen rapporten van het type "${escHtml(_rapportFilter)}" gevonden.</div>`;
    return;
  }
  body.innerHTML = gefilterd.map((r, i) => {
```
**Belangrijk:** verderop in dezelfde `.map((r, i) => ...)`-callback wordt `i` gebruikt om `herOpenRapport(${i})` op te roepen — dat verwacht een index in het VOLLEDIGE, ongefilterde `_rapportArchief`-array. Nu de `.map()` over `gefilterd` loopt i.p.v. over `_rapportArchief`, is `i` niet langer de juiste index wanneer een filter actief is. Zoek in de callback-body de regel met `herOpenRapport(${i})` en voeg er, vlak vóór de `return` van de template-literal in diezelfde callback, een regel aan toe:
```js
    const origIdx = _rapportArchief.indexOf(r);
```
en vervang `herOpenRapport(${i})` door `herOpenRapport(${origIdx})`. Elders in dezelfde callback (bv. `data-rapport-id="${escHtml(rapportId)}"` voor verstuur-/verwijderknoppen) hoeft niets te veranderen — die gebruiken al `r.id`, niet de array-index.

- [ ] **Step 5: Verifieer live in de browser**

Start `node dev-server.mjs`, open `http://localhost:3333/?test`, ga naar het Rapporten-tabblad. Bevestig dat de 3 knoppen verschijnen, "Alle" standaard actief. Klik "Interventie" → enkel interventie-rapporten blijven zichtbaar (of de "geen rapporten van dit type"-melding als er geen zijn), knop krijgt de actieve-stijl. Klik "Installatie" → analoog. Klik "Alle" → volledige lijst terug. **Test specifiek de index-fix:** met het filter "Interventie" actief (en minstens 2 rapporten in de volledige, ongefilterde lijst waarvan niet het eerste een interventie is), klik "📄 Openen" op een zichtbaar rapport → bevestig dat het WERKELIJK dat rapport opent (niet een ander, verkeerd rapport door een foute index).

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: filter Service/Installatie op het rapportenoverzicht"
```

---

## Eindcontrole (na alle taken)

- [ ] Doorloop nog eens een volledig interventie-rapport van begin tot PDF, en een volledig installatie-rapport van begin tot PDF, in dezelfde browsersessie na elkaar — bevestig dat beide onafhankelijk correct werken zonder dat de ene het gedrag van de andere beïnvloedt (bv. dat `R._servicetypeAutoApplied` en andere nieuwe `R.*`-velden correct resetten tussen twee geopende rapporten).
- [ ] Bevestig dat er geen `undefined`/`NaN`/lege-tekst-artefacten verschijnen in oudere, al-vóór-deze-wijziging gearchiveerde rapporten (die geen `eenheid`-veld op hun onderdelen hebben, en geen `interventieType`-veld kunnen missen — dat laatste bestond al langer met een `'Interventie'`-fallback).
