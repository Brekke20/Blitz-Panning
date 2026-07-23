# Service rapport: Oorzaak storing + zichtbare aanrijtijd

**Datum:** 2026-07-23
**Status:** Approved, ready for implementation plan

## Aanleiding

Twee losse aanvullingen op de service-rapport wizard (`public/index.html`), samen ontworpen omdat ze allebei dezelfde bestanden/functies raken (rapport-wizard, `buildRapportHtml`, TicketLog Excel-export):

1. Technici moeten kunnen registreren wat de oorzaak van de storing was: Productfout, Installatiefout of Configuratiefout.
2. De aanrijtijd wordt meegerekend in de kosten (bij servicetype "2e lijns"), maar staat nu enkel als klein grijs detail-lijntje in de loonkosten-tabel, en alleen bij dat servicetype. Dit moet transparanter/zichtbaarder worden voor de klant.

## Scope

- Wizard-stap "Omschrijving": nieuw veld "Oorzaak storing".
- Rapport-HTML (`buildRapportHtml`): nieuwe sectie voor oorzaak storing + nieuwe, altijd-zichtbare info-cel voor aanrijtijd.
- TicketLog Excel-export (`exportTicketLog`): nieuwe kolom "Oorzaak storing".
- Geen wijziging aan Netlify functions, geen nieuwe backend-velden — alles blijft binnen `public/index.html`, gearchiveerd via de bestaande spread van `R` in `archiveerRapport()`.

## 1. Data model

`R` object (~index.html:4489) krijgt een nieuw veld:

```js
oorzaakStoring: [],  // array van strings, bv. ['Productfout', 'Configuratiefout']
```

Toegestane waarden: `'Productfout' | 'Installatiefout' | 'Configuratiefout' | 'Andere'`.

Reset naar `[]` in `openRapport()` bij het starten van een nieuwe wizard-sessie, samen met de andere per-sessie velden (`R.varia`, `R.onderdelen`).

Geen wijziging nodig in `archiveerRapport()` — die spreidt `{ ...R, _html: html }` in `rapportData`, dus `oorzaakStoring` wordt automatisch mee gearchiveerd.

## 2. Wizard UI — stap "Omschrijving"

In `wizRenderOmschrijving`: nieuw blok direct onder "Ondernomen acties", met 4 checkboxes (geen radio's — meerdere oorzaken mogelijk):

- Productfout
- Installatiefout
- Configuratiefout
- Andere

In `wizSaveOmschrijving`: leest de aangevinkte checkboxes uit in `R.oorzaakStoring`. **Verplicht veld** — als de array leeg is, toont de functie `toast('Selecteer minstens 1 oorzaak', 3000)` en blokkeert de stap-overgang (return zonder de wizard naar de volgende stap te laten gaan). Dit is de eerste harde validatie-guard in de wizard-stappen; volgt hetzelfde patroon als de bestaande vroege-return-toasts elders in de app (bv. `quickAdd`'s "Geen beschikbare werkdag gevonden").

## 3. Rapport-HTML (`buildRapportHtml`)

**Oorzaak storing sectie** — nieuw, direct na "Ondernomen acties" (~index.html:5347):

```html
<div class="sec">Oorzaak storing</div>
<div class="block">${R.oorzaakStoring.join(', ') || '&nbsp;'}</div>
```

Weergave als komma-gescheiden tekst, consistent met de bestaande `.block`-stijl van "Omschrijving probleem"/"Ondernomen acties" — geen nieuwe CSS-klasse nodig.

**Aanrijtijd info-cel** — nieuwe cel in het bestaande info-blok naast Start/Stop/Werktijd (~index.html:5330-5333), zichtbaar zodra `R.aanrijtijdMin > 0`, **onafhankelijk van servicetype**:

```html
${R.aanrijtijdMin > 0 ? `<div class="info-cell accent"><div class="info-lbl">Aanrijtijd</div><div class="info-val">${fmtMin(R.aanrijtijdMin)}</div></div>` : ''}
```

(`fmtMin` is de bestaande formatter uit de loonkosten-IIFE — verplaatsen naar een plek waar beide secties hem kunnen gebruiken, of dupliceren als kleine inline helper; implementatie-detail voor het plan.)

De bestaande vermelding van aanrijtijd in de loonkosten-tabel (waar hij bij "2e lijns" effectief de prijs beïnvloedt — regel 5373) **blijft ongewijzigd**. Dat blijft de plek die toont *dat* en *hoe* aanrijtijd wordt aangerekend; de nieuwe info-cel toont enkel *dat er aanrijtijd was*, ook wanneer die niet wordt aangerekend (1e lijns/garantie) — dat is precies het transparantie-doel.

## 4. TicketLog Excel-export (`exportTicketLog`)

Nieuwe kolom toegevoegd aan het einde van de bestaande structuur:

- `headers`: `'Oorzaak storing'` toegevoegd na `'Actie'`.
- Data-rij: `(rd.oorzaakStoring || []).join(', ')` toegevoegd als laatste element.
- `WRAP_COLS`/`WRAP_MAX`: nieuwe kolomindex toegevoegd met max ~40 tekens (lange combinaties zoals "Productfout, Installatiefout, Configuratiefout" wrappen dan netjes i.p.v. de kolom onleesbaar breed te maken).
- `ncols` is al dynamisch (`headers.length`) — geen wijziging nodig in de rij-opbouw/styling-loop, die itereert generiek over `ncols`.

## 5. Backward compatibility & edge cases

- **Oude gearchiveerde rapporten** (vóór deze wijziging) hebben geen `oorzaakStoring` in hun opgeslagen `rapportData`. Excel-export: `(undefined || []).join(', ')` → lege string, geen crash. Hun opgeslagen `_html` (via `herOpenRapport`) toont simpelweg geen Oorzaak-storing-sectie — verwacht en correct, die info bestond nog niet toen het rapport gemaakt werd.
- **`R.aanrijtijdMin === 0`** (geen adres bekend, of TomTom-call gefaald): geen Aanrijtijd-cel getoond — zelfde gedrag als vandaag al in de loonkosten-tabel.
- **Geen wijziging aan backend/Netlify functions** — alles blijft client-side in `index.html`; `rapport-archief.js` slaat `rapportData` op als opaque blob en heeft geen kennis van individuele velden.

## Niet in scope

- Geen statistiek/dashboard over oorzaak-verdeling (mogelijke toekomstige uitbreiding, niet gevraagd).
- Geen wijziging aan hoe/wanneer aanrijtijd berekend wordt (TomTom-call blijft ongewijzigd) — enkel de weergave verandert.
- Geen validatie/UI-wijziging voor bestaande verplichte/optionele velden buiten `oorzaakStoring`.
