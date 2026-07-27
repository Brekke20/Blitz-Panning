# Aantal laadpalen op rapport + rapport blokkeren bij Installaties

**Datum:** 2026-07-27
**Status:** Approved, ready for implementation plan

## Aanleiding

Twee losse, kleine aanvullingen op de service-rapport wizard (`public/index.html`), samen ontworpen in één brainstorm-sessie op vraag van Brent:

1. Soms staan er meerdere laadpalen op één locatie/interventie. Brent wilde eerst een volledige oplossing met een apart serienummer + eigen configuratie per laadpaal (single/dual-one/dual-two/socket/kabel/...) laten uitwerken. Na het bekijken van 3 concrete layout-opties (via de visuele brainstorm-companion) koos hij bewust voor de eenvoudigere terugvaloptie: **1 serienummer (van de "master" laadpaal) + 1 gedeelde configuratie, met gewoon een extra "aantal"-veldje** — de volledige multi-configuratie-aanpak zou op een GSM-scherm te onoverzichtelijk worden, ook al zou de auto-overname van configuratie het aantal keuzes beperken.
2. Tijdens diezelfde sessie kwam naar boven dat er bij Installaties eigenlijk **geen service rapport** zou mogen aangemaakt worden — de klant heeft daarvoor al op voorhand een offerte gekregen. Vandaag kan een technieker toch gewoon doorgaan en een volledig rapport afronden nadat hij "Installatie" als bezoektype kiest in stap 1 van de wizard.

## Scope

- Enkel `public/index.html` (client-side, geen backend-wijzigingen).
- Rapport-archief (`archiveerRapport()`) archiveert de hele `R`-snapshot al generisch — geen aanpassing nodig, het nieuwe veld wordt automatisch mee opgeslagen.
- TicketLog Excel-export bevat vandaag geen serienummer/type-kolommen en blijft dat ook — geen wijziging.
- Manuele/geïmporteerde afspraken (`localEvents`) hebben al een eigen blokkade voor "Installatie" (de Rapport-knop is daar al verborgen bij dat type, zie eerdere sessie) — dat blijft ongewijzigd; dit deel van de spec gaat over de blokkade bij **Zoho-tickets**, waar "Type bezoek" pas gekozen wordt ín de wizard zelf.

## 1. Aantal laadpalen

### Huidig gedrag

De wizard-stap "Productinformatie" (`wizRenderProduct`, ~index.html:5226-5267) heeft precies 1 set velden: Serienummer (vrije tekst), Type (Single/Dual 1/Dual 2), Uitvoering (Tower/Wall), Kabeltype (Socket/Vaste kabel + lengte). `wizSaveProduct()` (~5273-5280) slaat die op in `R.serienummer`/`R.type`/`R.uitvoering`/`R.kabel`/`R.kabellengte`. Op de PDF (`buildRapportHtml()`, ~5792) staat het serienummer in een eigen info-cel, los van de gecombineerde "Type / uitvoering"-cel (~5686-5689, 5793).

### Nieuw gedrag

- **`R`-object** (~index.html:4834): nieuw veld `aantalLaadpalen: 1` toegevoegd naast de bestaande `serienummer/type/uitvoering/kabel/kabellengte`.
- **Reset bij nieuwe wizard-sessie** (`openRapport()`, ~index.html:4914, waar `R.type = ''; R.uitvoering = ''; ...` al gereset wordt): `R.aantalLaadpalen = 1;` toevoegen.
- **Wizard-veld** (`wizRenderProduct`): het Serienummer-veld wordt hernoemd naar **"Serienummer (master laadpaal)"**, en krijgt een nieuw veldje ernaast in een `wiz-field-row` (zelfde patroon als het bestaande Datum/#Zoho-paar):
  ```html
  <div class="wiz-field-row">
    <div class="wiz-field">
      <label class="wiz-field-label">Serienummer (master laadpaal)</label>
      <input class="wiz-input" id="f-serienummer" type="text" value="${escHtml(R.serienummer)}" placeholder="CHARX-XXXX" />
    </div>
    <div class="wiz-field">
      <label class="wiz-field-label">Aantal laadpalen</label>
      <input class="wiz-input" id="f-aantal-laadpalen" type="number" min="1" step="1" value="${R.aantalLaadpalen || 1}" />
    </div>
  </div>
  ```
  (Vervangt het huidige losse "Serienummer"-veld; de rest van de stap — Type/Uitvoering/Kabeltype — blijft ongewijzigd, want die configuratie geldt voor alle laadpalen samen.)
- **`wizSaveProduct()`**: `R.aantalLaadpalen = parseInt(wizV('f-aantal-laadpalen')) || 1;` toevoegen (nooit lager dan 1, zelfs bij een leeg/ongeldig veld).
- **PDF** (`buildRapportHtml()`): de Serienummer-info-cel toont het aantal erbij wanneer het groter is dan 1:
  ```js
  const serienummerLabel = R.aantalLaadpalen > 1
    ? `${escHtml(R.serienummer)||'—'} (master) — ${R.aantalLaadpalen}×`
    : (escHtml(R.serienummer)||'—');
  ```
  gebruikt in de bestaande info-cel (~5792) i.p.v. de huidige `${escHtml(R.serienummer)||'—'}`. Bij precies 1 laadpaal (het overgrote deel van de rapporten) verandert er dus **niets zichtbaar** op de PDF.

### Edge cases

- **Leeg/0/negatief ingevuld**: `parseInt(...) || 1` valt terug op 1 — nooit een rapport met "0 laadpalen" of een leeg getal.
- **Oude gearchiveerde rapporten**: hebben geen `aantalLaadpalen` in hun opgeslagen `rapportData`; hun bewaarde `_html` (via `herOpenRapport`) toont gewoon het oude formaat — verwacht en correct, dat veld bestond nog niet.
- **Geen wijziging aan facturatie/prijsberekening**: het aantal laadpalen beïnvloedt geen enkele bestaande prijs- of onderdelenberekening — dat blijft volledig gescheiden (onderdelen worden nog steeds los toegevoegd via de bestaande "Onderdelen"-stap, ongeacht hoeveel laadpalen er zijn).

## 2. Rapport blokkeren bij Installaties

### Huidig gedrag

Wizard-stap "Algemeen" (`wizRenderAlgemeen`, ~index.html:5015-5053) heeft een radio "Type bezoek": Interventie (standaard) / Installatie. `wizSaveAlgemeen()` (~5069-5077) slaat de keuze op in `R.interventieType`, maar blokkeert nooit — de technieker kan gewoon doorklikken en het rapport volledig afronden, ook bij "Installatie".

`wizNext()` (~4958-4971) heeft al een validatie-patroon: als een stap se `save()` exact `false` teruggeeft, wordt de stap-overgang geblokkeerd met een toast. Vandaag is die toast-tekst hardcoded specifiek voor de Omschrijving-stap ("⚠️ Selecteer minstens één oorzaak storing") — de code heeft zelf al een `NOTE`-commentaar dat dit veralgemeend moet worden zodra een andere stap dit patroon ook gebruikt (~4960).

### Nieuw gedrag

- **`wizNext()` veralgemenen**: een stap se `save()` mag nu ofwel `false` teruggeven (blokkeert met de bestaande generieke fallback-tekst — geen enkele bestaande stap gebruikt dit meer na deze wijziging, maar de fallback blijft voor toekomstige stappen) ofwel een **string** (blokkeert met die string als toast-tekst). `wizSaveOmschrijving()` wordt aangepast om zijn eigen boodschap terug te geven i.p.v. `false`, zodat de tekst bij de stap zelf hoort i.p.v. hardcoded in `wizNext()`:
  ```js
  function wizNext() {
    const step = WIZ_STEPS[_wizStep];
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
- **`wizSaveOmschrijving()`** (~5311-5318): retourneert nu de specifieke tekst i.p.v. `false`:
  ```js
  if (!R.oorzaakStoring.length) return '⚠️ Selecteer minstens één oorzaak storing';
  ```
- **`wizSaveAlgemeen()`** (~5069-5077): na het opslaan van `R.interventieType`, blokkeert bij "Installatie":
  ```js
  function wizSaveAlgemeen() {
    R.datum           = wizV('f-datum');
    R.technieker      = wizV('f-technieker');
    R.adres           = wizV('f-adres');
    R.start           = wizV('f-start');
    R.stop            = wizV('f-stop');
    R.werktijd        = calcWerktijd(R.start, R.stop);
    R.interventieType = document.querySelector('input[name="f-interventieType"]:checked')?.value || 'Interventie';
    if (R.interventieType === 'Installatie') {
      return '⚠️ Voor installaties wordt geen rapport aangemaakt — de klant kreeg hiervoor al een offerte.';
    }
  }
  ```
- **Gevolg**: de technieker kan de wizard nog altijd sluiten (bestaande ✕-knop, ongewijzigd) als hij per ongeluk op "Installatie" klikte — hij zit niet vast, hij kan gewoon niet *verder* met een rapport voor dat bezoektype.

### Edge cases

- **Standaardwaarde blijft "Interventie"** (`R.interventieType = 'Interventie'` bij het starten van elke nieuwe wizard-sessie, ongewijzigd) — een technieker die de radio niet aanraakt, ondervindt geen enkele wijziging.
- **Terug-navigatie** (`wizBack()`, ~4973-4979): roept `save()` ook aan, maar negeert het returnwaarde volledig (enkel `wizNext()` blokkeert) — teruggaan naar een vorige stap moet altijd kunnen, ook al staat "Installatie" nog aangevinkt. Geen wijziging nodig aan `wizBack()`.
- **Lokale afspraken**: ongewijzigd — die blokkade gebeurt al vóór de wizard opent (Rapport-knop verborgen bij `ev.type === 'Installatie'`), dus deze nieuwe blokkade binnen de wizard raakt enkel het Zoho-ticket-pad, waar het bezoektype pas gekozen wordt nadat de wizard al open is.

## Niet in scope

- Geen volledige multi-laadpaal-met-eigen-configuratie (bewust afgewezen na het bekijken van 3 layout-voorstellen — te onoverzichtelijk op een GSM-scherm).
- Geen wijziging aan hoe/wanneer tickets uit de app verdwijnen bij sluiting in Zoho, en geen rapport-gebaseerde kalenderweergave — apart onderwerp, opgepakt in een volgende sessie.
- Geen nieuwe kolom in de TicketLog Excel-export voor aantal laadpalen (niet gevraagd; serienummer/type staan daar vandaag ook al niet in).
