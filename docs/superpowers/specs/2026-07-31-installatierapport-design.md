# Installatierapport + automatische invulling van bezoektype/servicetype

**Datum:** 2026-07-31
**Status:** Approved, ready for implementation

## Aanleiding

Een collega vroeg de volledige flow interventies/particuliere installaties (planning tem facturatie) te herbekijken, met als concreet voorstel: een rapport voor installaties analoog aan het bestaande service-rapport, met foto's, een prijstabel per gebruikt materiaal (prijs/stuk of prijs/meter × aantal → automatisch totaal), en een handtekening ter plaatse — plus een filter Service/Installatie in het rapportenoverzicht.

Brent stelde initieel voor alles via Zoho te laten lopen met een nieuw type-veld. Onderzoek wees uit dat particuliere installaties **nooit** als Zoho-ticket binnenkomen — ze worden altijd manueel ingepland in de app (het bestaande "Manuele afspraak"-scherm heeft al een `type`-veld met de waarde "Installatie"). Een Zoho-wijziging voor het type zelf is dus niet aan de orde; **Voorstel 1** (hergebruik van wat al bestaat, puur lokaal) is de gekozen richting.

Tijdens de uitwerking gaf Brent 2 nieuwe, al-bestaande Zoho-velden door die de invulling verder automatiseren:
- `cf_garantie_status` — waarden: ja / nee / onzeker
- `cf_installateur_al_langs_geweest` — waarden: ja / nee / onzeker (bepaalt 1e- vs 2e-lijns)

## Beslissingen (uit het brainstormgesprek)

1. **Geen wijziging aan Zoho voor het type zelf.** Installaties blijven manueel ingeplande lokale afspraken (bestaand `event.type === 'Installatie'`-veld); Zoho-tickets zijn altijd interventies.
2. **Het keuzevak "Interventie"/"Installatie" in de rapport-wizard wordt automatisch ingevuld** op basis van de bron (Zoho-ticket → altijd Interventie; lokale afspraak met `type === 'Installatie'` → Installatie), maar blijft ten allen tijde manueel wijzigbaar.
3. **De 2 nieuwe Zoho-velden vullen automatisch het servicetype-keuzevak** (1e-lijn / 2e-lijn / garantie), blijft manueel wijzigbaar. Logica (bevestigd):

   | `cf_garantie_status` | `cf_installateur_al_langs_geweest` | Voorgevinkt |
   |---|---|---|
   | ja | (maakt niet uit) | garantie |
   | nee | ja | 2e-lijn |
   | nee | nee | 1e-lijn |
   | nee | onzeker | *(geen auto-selectie, huidig gedrag)* |
   | onzeker | ja | 2e-lijn |
   | onzeker | nee | 1e-lijn |
   | onzeker | onzeker | *(geen auto-selectie, huidig gedrag)* |

   Garantie wint dus altijd bij "ja"; anders bepaalt "installateur al langsgeweest" 1e/2e-lijn; enkel bij een dubbele "onzeker" blijft het een pure handmatige keuze zoals vandaag.
4. **De wizardstap "Facturatie & Servicetype" (1e-lijn/2e-lijn/garantie) wordt volledig overgeslagen bij een installatierapport** — dit zijn interventie-begrippen, niet relevant bij een installatie.
5. **Nieuw installatierapport-sjabloon**, met deze structuur (bevestigd via mockup):
   - Klantgegevens + datum/technieker (ongewijzigd)
   - Installatiegegevens (product-info: type/uitvoering/kabel/serienummer/aantal — al installatie-vormig, ongewijzigd)
   - "Omschrijving installatie" i.p.v. "Omschrijving probleem" (geen "Oorzaak storing"-sectie — niet relevant bij een verse installatie)
   - "Gebruikte materialen" i.p.v. "Vervangen onderdelen", met eenheid-ondersteuning (stuk/meter)
   - Geen "Status laadinfrastructuur" (hersteld/nieuwe interventie nodig)
   - Geen Loonkosten-sectie — enkel het materiaaltotaal
   - Foto's (ongewijzigd)
   - Handtekening technieker + klant (ongewijzigd, bestaat al volledig)
6. **De onderdelentabel krijgt een eenheid-veld (stuk/meter)** i.p.v. altijd impliciet "stuk", met automatische totaalberekening — voor beide rapporttypes bruikbaar (een interventie kan ook per-meter materiaal gebruiken).
7. **Het rapportenoverzicht krijgt een filter Service/Installatie.**

## Belangrijke aanname om te bevestigen

De vergelijkingslogica in punt 3 gaat ervan uit dat Zoho voor beide velden letterlijk de tekst "ja"/"nee"/"onzeker" opslaat (hoofdletterongevoelig vergeleken). Als het Zoho-veld andere interne waarden gebruikt (bv. een andere spelling of taal), zal de automatische invulling stil niets doen (veilige uitval naar de huidige handmatige keuze) — even nakijken in Zoho's veldconfiguratie welke exacte tekst er per keuze opgeslagen wordt.

---

## Technische uitwerking

### 1. `netlify/functions/tickets.js` — 2 nieuwe Zoho-velden doorgeven

In `mapTicket` (regel 121-153), na `interventieDatum` en vóór `createdTime`:
```js
    interventieDatum:  cf.cf_interventie_datm || null,
    garantieStatus:            cf.cf_garantie_status              || '',
    installateurAlLangsGeweest: cf.cf_installateur_al_langs_geweest || '',
    createdTime:       t.createdTime || null,
```

### 2. `getPlanningTicket()` — lokaal-afspraak-type doorgeven aan de pseudo-ticket

Huidig (`public/index.html:2613-2621`):
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
wordt:
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

### 3. `openRapport()` — `R.interventieType` automatisch bepalen

Huidig (`public/index.html`, in de `R`-seeding-blok, huidige regel met commentaar):
```js
R.interventieType = 'Interventie'; // default; radio in stap Algemeen kan dit expliciet naar 'Installatie' zetten
```
wordt:
```js
// Automatisch bepaald uit de bron: een Zoho-ticket is altijd een interventie, een lokale
// afspraak van het type "Installatie" is een installatie. Radio in stap Algemeen kan dit
// nog steeds manueel overschrijven.
R.interventieType = (ticket.isLocal && ticket.type === 'Installatie') ? 'Installatie' : 'Interventie';
```
Geen wijziging nodig aan de radio-HTML zelf in `wizRenderAlgemeen` (`:5378-5389`) — die leest al correct van `R.interventieType`.

### 4. Rapportknop niet langer verbergen bij lokale installatie-afspraken

Huidig (`openLocalEventDetail`, `public/index.html:3134-3136`):
```js
function openLocalEventDetail(ev) {
  _localDetEvent = ev;
  document.getElementById('ld-btn-rapport').style.display = ev.type === 'Installatie' ? 'none' : '';
```
wordt:
```js
function openLocalEventDetail(ev) {
  _localDetEvent = ev;
  document.getElementById('ld-btn-rapport').style.display = '';
```

### 5. De blokkerende melding in `wizSaveAlgemeen()` verwijderen

Huidig:
```js
R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
if (R.interventieType === 'Installatie') {
  return '⚠️ Voor installaties wordt geen rapport aangemaakt — de klant kreeg hiervoor al een offerte.';
}
```
wordt:
```js
R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
```

### 6. `wizRenderFacturatie()` — automatische selectie op basis van de 2 nieuwe velden

Vóór de HTML-opbouw in `wizRenderFacturatie` (`public/index.html:5507` e.v.), invoegen:
```js
function wizAutoServicetype() {
  const garantie = String(_wizTicket?.garantieStatus || '').trim().toLowerCase();
  const langsgeweest = String(_wizTicket?.installateurAlLangsGeweest || '').trim().toLowerCase();
  if (garantie === 'ja') return 'garantie';
  if (langsgeweest === 'ja') return '2e-lijn';
  if (langsgeweest === 'nee') return '1e-lijn';
  return null; // onduidelijk -- geen auto-selectie, huidig gedrag (R.servicetype behoudt zijn waarde)
}
```
En, bij het BINNENKOMEN van deze stap (dus vóór de radio-HTML gerenderd wordt, enkel de eerste keer dat deze stap bereikt wordt voor dit rapport — gebruik een vlag op `R` zodat een latere, manuele wijziging door de technieker niet telkens overschreven wordt bij terug/verder navigeren):
```js
function wizRenderFacturatie(el) {
  if (!R._servicetypeAutoApplied) {
    const auto = wizAutoServicetype();
    if (auto) R.servicetype = auto;
    R._servicetypeAutoApplied = true;
  }
  el.innerHTML = `
    ...
```
(De rest van `wizRenderFacturatie`'s HTML-opbouw blijft ongewijzigd — de radio's lezen toch al van `R.servicetype`, dus de auto-toegepaste waarde verschijnt gewoon voorgevinkt.) `R._servicetypeAutoApplied` moet mee gereset worden waar `R` zelf gereset wordt bij het openen van een nieuw rapport (naast de andere `R.*`-defaults).

### 7. Wizardstap "Facturatie" overslaan bij Installatie

Huidig `wizNext()` (`public/index.html:5294-5307`):
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
wordt:
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
Huidig `wizBack()` (`public/index.html:5309-5315`):
```js
function wizBack() {
  if (WIZ_STEPS[_wizStep].save) WIZ_STEPS[_wizStep].save();
  if (_wizStep > 0) {
    _wizStep--;
    wizRenderStep();
  }
}
```
wordt:
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
**Follow-up voor het implementatieplan:** als er een visuele stap-indicator/voortgangsbalk bestaat die de 8 `WIZ_STEPS`-labels toont, moet die ook het "Facturatie"-label overslaan/verbergen voor een installatierapport — exacte code hiervoor moet bij het schrijven van het implementatieplan opgezocht worden (niet in dit onderzoek meegenomen).

### 8. `wizRenderOmschrijving()` — ander label + geen "Oorzaak storing" bij installatie

Huidig (`public/index.html:5636-5656`):
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
wordt:
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
`wizSaveOmschrijving()` moet bij een installatierapport het uitlezen van de (dan niet-gerenderde) `f-oorzaak-*`-checkboxen overslaan — `document.getElementById(...)?.checked` op een niet-bestaand element geeft al veilig `undefined`/falsy, dus dit werkt zonder verdere aanpassing (`R.oorzaakStoring` wordt dan gewoon een lege array).

### 9. `wizRenderStatus()` — geen "Definitief hersteld"/"Nieuwe interventie nodig" bij installatie

Huidig begin (`public/index.html:5702-5714`, ingekort):
```js
  el.innerHTML = `
    <div class="wiz-step-title">Status &amp; onderdelen</div>
    <div class="wiz-field">
      <label class="wiz-field-label">Definitief hersteld</label>
      ...
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Nieuwe interventie nodig</label>
      ...
    </div>
    ... (onderdelen-sectie erna, ongewijzigd te behouden)
```
wordt (`isInstallatie`-check zoals in punt 8, de twee "Definitief hersteld"/"Nieuwe interventie nodig"-`wiz-field`-blokken samen in een `${isInstallatie ? '' : `...`}`-template gewrapt, de rest van de functie — titel wordt "Materialen" bij installatie, en de hele onderdelen-sectie erna — ongewijzigd):
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
    ...` // rest van de functie (tag-filters + onderdelen-sectie) ongewijzigd
```
`wizSaveStatus()` moet net als bij punt 8 de `hersteld`/`nieuwInter`-radio's overslaan bij installatie — zelfde redenering (`querySelector` op niet-gerenderde radio's geeft veilig `null`/`''`), exacte huidige `wizSaveStatus`-code moet bij het schrijven van het implementatieplan opgezocht worden om dit te bevestigen.

### 10. Eenheid (stuk/meter) op de onderdelenregel

Huidig lijnitem-vorm (uit catalogus, `wizVoegCatToe`, `public/index.html:5843`):
```js
R.onderdelen.push({ id: o.id, naam: o.naam, prijs: o.prijs, aantal: 1, factureren: true });
```
wordt (eenheid overnemen uit de catalogus i.p.v. laten vallen — de catalogus heeft dit veld al, `PRIJZEN.onderdelen[].eenheid`, vandaag altijd `'stuk'`):
```js
R.onderdelen.push({ id: o.id, naam: o.naam, prijs: o.prijs, aantal: 1, factureren: true, eenheid: o.eenheid || 'stuk' });
```
Vrije regel (`wizAddVrijeRegel`, `:5850`) krijgt een keuzevak in plaats van een vaste waarde:
```js
R.onderdelen.push({ id: 'vrij-' + Date.now(), naam: '', prijs: '', aantal: 1, factureren: true, eenheid: 'stuk' });
```
In `_wizRenderGeselecteerd()` (`:5750-5783`), de vaste tekst `/ stuk` (`:5773`) wordt vervangen door de werkelijke eenheid, en het "Aantal"-label wordt dynamisch (bv. "Aantal (meter)" i.p.v. altijd "Aantal"):
```js
<span class="wiz-sel-aantal-lbl">Aantal${p.eenheid==='meter' ? ' (meter)' : ''}</span>
...
<span class="wiz-sel-stukprijs">€ ${(parseFloat(p.prijs)||0).toFixed(2)} / ${p.eenheid || 'stuk'}</span>
```
Voor de vrije regel (waar de technieker zelf een prijs intikt, geen catalogus-item) wordt een klein keuzevakje toegevoegd naast het prijsveld:
```js
<select class="wiz-part-eenheid" style="width:60px;font-size:0.8rem" onchange="wizUpdSelEenheid(${i},this.value)">
  <option value="stuk" ${p.eenheid!=='meter'?'selected':''}>stuk</option>
  <option value="meter" ${p.eenheid==='meter'?'selected':''}>meter</option>
</select>
```
en een nieuwe helper naast de bestaande `wizUpdSel*`-functies (`:5864-5867`):
```js
function wizUpdSelEenheid(i, val) { if (R.onderdelen[i]) R.onderdelen[i].eenheid = val; _wizUpdateTotaalRow(); }
```
De subtotaalberekening zelf (`prijs * aantal`) verandert niet — enkel het label/de eenheid-weergave, het rekenwerk blijft identiek ongeacht stuk of meter.

### 11. `buildRapportHtml()` — installatie-variant

Voorgestelde aanpak: **binnen dezelfde functie**, een `isInstallatie = R.interventieType === 'Installatie'`-vlag bovenaan, en de bestaande secties conditioneel anders labelen/weglaten in plaats van een volledig aparte functie te schrijven — zo blijft het gedeelde skelet (header, klantgegevens, product-info, foto's, handtekeningen) letterlijk gedeeld, enkel de interventie-specifieke secties wijzigen:
- Sectiekop "Interventie adres" → "Installatie adres" bij `isInstallatie` (regel rond `:6123`).
- "Omschrijving probleem" (`:6142`) → "Omschrijving installatie" (herbruikt dezelfde `R.probleem`-inhoud, enkel het label verandert — consistent met punt 8's wizard-wijziging).
- De volledige "Status laadinfrastructuur"-sectie (`:6155-6161`) wordt overgeslagen bij `isInstallatie`.
- Sectiekop "Vervangen onderdelen" → "Gebruikte materialen" bij `isInstallatie`; de tabel toont nu ook de eenheid per regel (bv. "18 meter" i.p.v. enkel "18").
- De volledige "Loonkosten"-sectie (`:6199-6208`) wordt overgeslagen bij `isInstallatie` — het "Kostenoverzicht" (`:6209-6216`) toont dan enkel het materiaaltotaal, geen loonkost-regel.
- Tijdsregistratie (Starttijd/Stoptijd/Aanrijtijd, `:6125-6130`): blijft getoond als informatieve data (nuttig voor interne opvolging), maar wordt niet meer gekoppeld aan een kostenberekening bij installatie.
- Product-info, foto's, handtekeningen: ongewijzigd voor beide types.

Exacte diff-precisie voor dit onderdeel (welke regel exact welke `${isInstallatie ? ... : ...}`-vorm krijgt) wordt uitgewerkt bij het schrijven van het implementatieplan, aangezien `buildRapportHtml()` een lange, aaneengesloten functie is die best in zijn geheel gelezen wordt vlak vóór de wijziging (regelnummers kunnen ondertussen licht verschoven zijn door de Kostenoverzicht-wijziging van eerder deze week).

### 12. Filter Service/Installatie op het rapportenoverzicht

`renderRapportArchief()` (huidig geen filter, rendert altijd de volledige `_rapportArchief`-array) krijgt een module-scope filterstatus en een klein knoppenrijtje boven de lijst:
```js
let _rapportFilter = 'alle'; // 'alle' | 'Interventie' | 'Installatie'
function setRapportFilter(type) {
  _rapportFilter = type;
  renderRapportArchief();
}
```
In `renderRapportArchief()`, vóór het bestaande `_rapportArchief.map(...)`, een filterstap invoegen:
```js
const gefilterd = _rapportFilter === 'alle'
  ? _rapportArchief
  : _rapportArchief.filter(r => (r.interventieType || 'Interventie') === _rapportFilter);
```
en `gefilterd.map(...)` gebruiken i.p.v. `_rapportArchief.map(...)`. De knoppenrij (bv. naast de bestaande datumvelden in de Rapporten-tab-header) met 3 knoppen "Alle" / "Interventie" / "Installatie", elk met `onclick="setRapportFilter('...')"` en een actieve-staat-highlight op basis van `_rapportFilter` — exacte plaatsing/HTML wordt uitgewerkt in het implementatieplan.

---

## Niet in scope

- Geen wijziging aan Zoho zelf (geen nieuw custom field voor het type) — enkel de 2 al-bestaande garantie/langsgeweest-velden worden nu voor het eerst uitgelezen.
- Geen wijziging aan hoe `PRIJZEN.tarieven` (labor-rate-catalogus) werkt — die blijft losstaand, ongebruikt in de eigenlijke facturatielogica, zoals vandaag.
- Geen wijziging aan de bestaande interventie-flow zelf, buiten de nu-conditionele secties die voor interventies exact hetzelfde blijven renderen als vandaag.
- De visuele stap-voortgangsindicator (indien die bestaat) wordt niet in dit designdoc uitgewerkt — zie de follow-up-noot bij punt 7.
