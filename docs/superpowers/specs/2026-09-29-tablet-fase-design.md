# Tablet-fase (v1.8.0): ontwerp

**Status:** ontwerp goedgekeurd door Brent in de chat op 2026-09-29.
**Aanleiding:**
- Brent gebruikt sinds kort een Samsung Galaxy Tab S7 FE. In CSS-pixels is dat ongeveer 800×1280 staand en 1280×800 liggend.
- De app besliste alles op schermbreedte (grens 1024 px). Daardoor kreeg een tablet staand de gsm-indeling zonder planfuncties.
- Andere techniekers kunnen andere tablets hebben, en schermbreedte alleen is onbetrouwbaar bij verschillende beeldverhoudingen en bij draaien.
**Voorgaande stappen:** v1.7.0 zette de draaivergrendeling uit en zet de dagen onder elkaar onder 1024 px (quick fix). Deze fase vervangt die quick fix.

## Doelen
1. **Eén centrale apparaatherkenning** die niet op schermbreedte alleen steunt en die bij draaien opnieuw evalueert.
2. **Planfuncties hangen af van de rol op het toestel** (coördinator of technieker), niet van de schermbreedte.
3. **Tablet staand** krijgt een eigen indeling: een tijdlijn van 3 dagen in plaats van de gsm-lijst.
4. **Vasthouden en verschuiven** voor routestops, zodat dat met een vinger werkt.
5. **Vingervriendelijke knoppen** op elk aanraakscherm.
6. **Handmatige override per toestel** als veiligheidsklep.

## Niet in scope
- De volledige tablet-indeling met lijst links en detail rechts (fase 6, wacht op evaluatie).
- Login of echte rechten. De rol verbergt alleen knoppen en is **geen beveiliging**.
- Een native app. Afgeraden voor nu; later herbekijken als achtergrond-GPS of betrouwbare iOS-push nodig blijkt.
- Slepen in de kalender. Dat bestaat vandaag niet en komt er niet bij.

## 1. Apparaatherkenning (`public/js/apparaat.js`)

Het is een klassiek script, geen module. Het wordt in `<head>` geladen vóór de CSS-afhankelijke rendering en vóór het hoofdscript, zodat de attributen al op `<html>` staan bij de eerste render. Er is geen flits.

**Signalen:**
- `grof` = `matchMedia('(pointer: coarse)').matches`: het primaire invoermiddel is een vinger.
- `kortsteZijde` = `Math.min(innerWidth, innerHeight)`. Dat getal verandert niet bij draaien. Het is dezelfde regel als Android's "smallest width".
- `staand` = `innerHeight >= innerWidth`.

**Soort toestel (automatisch):**
- `!grof` → `computer`. Dat geldt ook voor een laptop met aanraakscherm, want het primaire invoermiddel is dan fijn.
- `grof && kortsteZijde < 600` → `gsm`.
- `grof && kortsteZijde >= 600` → `tablet`.

**Override:** `localStorage['blitz_weergave']` met `auto` (standaard), `gsm`, `tablet` of `computer`. Bij een waarde die niet `auto` is, telt die in plaats van de automatische soort.

**Indeling:**
- `computer` → `breed`;
- `tablet` en liggend → `breed`;
- `tablet` en staand → `tablet-staand`;
- `gsm` → `smal`.

**Aanraken:** `aanraak = grof`. Dat staat los van de override: een tablet met muis blijft zo bediend als hij bediend wordt.

**Rol:** `localStorage['blitz_rol']` met `coordinator` of `technieker`. Standaard als niets bewaard is:
- `computer` → `coordinator`;
- `gsm` → `technieker`;
- `tablet` → nog niet bepaald. Bij het eerste gebruik vraagt de app het één keer (zie §4). Tot er gekozen is, geldt `technieker`.

**Uitgang:**
- zet op `document.documentElement` de attributen `data-apparaat`, `data-indeling`, `data-orientatie` (`staand`/`liggend`), `data-aanraak` (`ja`/`nee`) en `data-rol`;
- `window.apparaat` = `{ soort, indeling, staand, aanraak, rol, automatischeSoort, kortsteZijde }`;
- functies `window.zetWeergave(w)` en `window.zetRol(r)`, die bewaren en opnieuw evalueren.

**Opnieuw evalueren** gebeurt bij `resize` (met debounce via `requestAnimationFrame`), bij `orientationchange` en bij `change` van de pointer-media-query. Verandert `indeling`, `rol` of `aanraak`, dan wordt een `CustomEvent('apparaatwijziging')` op `window` verstuurd.

## 2. Wat de app per situatie toont

**Coördinatorfuncties.** De klasse `desktop-only` wordt `coord-only`. Ze wordt verborgen via `html[data-rol="technieker"] .coord-only { display: none }`, niet meer via de schermbreedte. Een coördinator ziet ze op elk toestel, een technieker nergens.

Het gaat om:
- de tabbladen Wachtrij, Route en Rapporten;
- Plan deze week, Import en + Afspraak;
- Instellingen;
- de knoppen Beschikbaar en Blokkade;
- de capaciteit in de dagkop;
- in het ticketdetail: Klantbeschikbaarheid, Plan en Voorstel.

Bij `apparaatwijziging` (of bij het laden): is de rol technieker en staat het actieve tabblad op `coord-only`, dan springt de app naar Kalender. Dat vervangt `enforceMobileTabRestriction` en de `matchMedia('(max-width: 1023px)')`-listener.

**Kalender (week):**

| Indeling | Weergave |
|---|---|
| `breed` | De weektijdlijn van v1.7.0, ongewijzigd. |
| `tablet-staand` | Een tijdlijn van **3 dagen**, met dezelfde 24u-tijdlijn, banden, nu-lijn, vaste koppen, "zonder uur"-chips en auto-scroll. De startdag is vandaag, plus een eigen dagverschuiving `kalDagOffset`. Getoond worden 3 opeenvolgende **werkdagen** vanaf de startdag (niet-werkdagen worden overgeslagen). ‹ › verschuift 1 werkdag, "Vandaag" zet de verschuiving terug op 0. Het label wordt "29 sep – 1 okt". De auto-scroll-sleutel bevat de startdatum. |
| `smal` | De gsm-lijst van v1.7.0 (dagen onder elkaar, nu-streepje en badge). |

- De maandweergave blijft ongewijzigd in alle indelingen.
- De tijdlijn wordt dus getoond als `indeling !== 'smal'`, in plaats van `innerWidth >= 1024`.
- De quick fix van v1.7.0 (dagen onder elkaar onder 1024 px) wordt `html[data-indeling="smal"] .week-grid`.

**Route-tabblad:**
- `breed` → lijst en kaart naast elkaar;
- `tablet-staand` en `smal` → onder elkaar, zoals de huidige 680 px-regel.

**Aanraken (`data-aanraak="ja"`):**
- alle knoppen, tabbladen, chips, `.kal-nav` en headerknoppen krijgen `min-height: 44px`;
- tikbare pictogramknoppen worden minstens 44×44;
- de 16 px-regel voor invulvelden hangt aan `data-aanraak="ja"` in plaats van aan `max-width: 1023px`.

## 3. Vasthouden en verschuiven (routestops)

Het HTML5-slepen in de routelijst (`index.html` ±3905–3975, inclusief de `innerWidth > 680`-voorwaarde en de drop-zone aan het einde) wordt vervangen door een eigen module `public/js/sorteer.js`, met Pointer Events.

- **Muis of pen:** het slepen start na 4 px beweging, dus je kunt meteen slepen.
- **Aanraken:**
  - het slepen start na **450 ms** vasthouden zonder meer dan 8 px te bewegen;
  - beweegt de vinger eerder, dan wordt het slepen geannuleerd en scrolt de pagina gewoon;
  - bij de start volgen `navigator.vibrate?.(15)`, de klasse `.sorteer-actief` op het kaartje (licht op, iets groter en een schaduw) en `touch-action: none` tijdens het slepen.
- **Tijdens het slepen:**
  - een placeholder toont waar het kaartje terechtkomt;
  - de lijst scrolt automatisch als je binnen 40 px van de rand van de scrollcontainer of het venster komt.
- **Loslaten:** de nieuwe volgorde wordt berekend op basis van indices in `allStops`, net zoals nu, en de bestaande `applyRouteOrder(date, nieuw)` wordt aangeroepen. Die blijft ongewijzigd, met dezelfde tijdberekening en dezelfde schrijfacties naar Zoho.
- **Annuleren:** met Escape of `pointercancel`, zonder wijziging.
- **Dezelfde regels als nu:**
  - enkel niet-vergrendelde tickets zijn versleepbaar;
  - alle kaartjes zijn een geldig doel;
  - niets is versleepbaar bij meerdere technici (filter "Alle").
- **Interface:** `maakSorteerbaar(lijstEl, { itemSelector, isVersleepbaar(el), opVolgorde(vanIndex, naarIndex) })`, met een `vernietig()` om opnieuw renderen zonder dubbele listeners mogelijk te maken.

## 4. Instellingen: "Dit toestel"

Er komt een nieuw subtabblad **Dit toestel** in het instellingenvenster. Het is ook zichtbaar voor een technieker: het instellingenvenster zelf blijft coördinator-only, maar het tandwiel of een aparte ingang moet voor iedereen bereikbaar zijn.

**Beslissing:** het tandwiel wordt zichtbaar voor iedereen. Een technieker ziet enkel het subtabblad "Dit toestel". De subtabbladen Algemeen en Beschikbaarheden en de knop Prijzen krijgen `coord-only`.

Inhoud van het subtabblad:
- "Herkend als: Tablet · rechtop · aanraakscherm". Dit toont de automatische waarde en, als er een override actief is, ook "(handmatig: Computer)".
- **Rol op dit toestel:** keuzerondjes Coördinator / Technieker, via `zetRol`.
- **Weergave:** Automatisch / Gsm / Tablet / Computer, via `zetWeergave`.
- Uitleg: "Deze keuzes gelden enkel voor dit toestel. De rol verbergt knoppen maar is geen beveiliging."
- Wijzigingen gelden meteen. Ze hangen niet af van de knop "Opslaan" van het tabblad Algemeen.

**Eerste gebruik op een tablet** (soort `tablet`, nog geen `blitz_rol`): na het laden verschijnt `appConfirm` met titel "Wie gebruikt deze tablet?", tekst "Dit kan je later wijzigen in Instellingen → Dit toestel.", bevestigknop "Coördinator" en annuleerknop "Technieker".
- `true` → `zetRol('coordinator')`;
- `false`, ook bij Escape of klikken naast het venster → `zetRol('technieker')`.

De vraag komt maar één keer, want de keuze wordt bewaard.

## 5. Migratie van de bestaande breedte-controles

| Nu | Wordt |
|---|---|
| CSS `@media (max-width:1023px)` die `.desktop-only` verbergt (app.css 464 en 910) | `html[data-rol="technieker"] .coord-only` |
| CSS `max-width:1023px` voor 44 px `.cal-btn` en 16 px invulvelden (app.css, wizard.css, inventaris.css) | `html[data-aanraak="ja"]` |
| CSS `max-width:1023px` voor de tijdlijn en de urenkolom (app.css ±920–980) | `html[data-indeling="smal"]` |
| CSS `max-width:1023px` voor de week onder elkaar (v1.7.0) | `html[data-indeling="smal"]` |
| CSS `max-width:680px` voor de route onder elkaar | `html[data-indeling="smal"], html[data-indeling="tablet-staand"]`. De regel blijft ook bestaan voor smalle computervensters. |
| JS `innerWidth >= 1024` (renderKalender ±1752/1823) | `apparaat.indeling !== 'smal'` |
| JS `innerWidth > 680` (slepen in de route) | vervalt, `sorteer.js` werkt overal |
| JS `matchMedia('(max-width:1023px)')` en `enforceMobileTabRestriction` | de `apparaatwijziging`-listener: tabbeperking + `renderKalender()` + route opnieuw renderen |

De CSS-regels die op pure breedte blijven (overlay-centrering vanaf 600 px, dialoogknoppen onder 480 px) blijven zoals ze zijn. Dat is lay-out naar beschikbare ruimte, en dat is correct.

## 6. Randgevallen
- **Laptop met aanraakscherm:** pointer fijn, dus computer.
- **Tablet met muis of toetsenbord (DeX):** pointer fijn, dus computer, en aanraak nee. Dat is correct.
- **Gsm liggend (932×430):** kortste zijde 430, dus gsm en indeling smal.
- **iPad mini (744×1133):** tablet.
- **Samsung Galaxy Tab S7 FE (800×1280):** tablet. Staand geeft tablet-staand, liggend geeft breed.
- **Venster op de computer smal gemaakt:** soort computer en indeling breed. De tijdlijn blijft dan horizontaal scrollbaar (bestaand gedrag, `overflow:auto`). De route-regel op 680 px blijft gelden.
- **Draaien terwijl een venster openstaat:** geen herrender van open vensters, enkel van de kalender en de route. Een open wizard blijft werken.
- **Rol wijzigen naar technieker terwijl je op het tabblad Route staat:** de app springt naar Kalender.
- **Oude localStorage-sleutels** (`blitz_active_person`, `blitz_settings_*`) blijven ongemoeid.

## 7. Verificatie
- De herkenning met nagebootste toestellen: `resize_window` plus een override van `matchMedia` voor `(pointer: coarse)` in de console, of `zetWeergave`. Te controleren: de S7 FE staand en liggend, een gsm 375×812 en 932×430, een iPad mini 744×1133, een computer op 1440×900, en de override.
- De rol: een technieker ziet op geen enkel toestel coördinatorknoppen, en de tabbladsprong werkt.
- De tijdlijn van 3 dagen: ‹ › en "Vandaag", het label, weekends overgeslagen, de nu-lijn in de kolom van vandaag, de auto-scroll.
- Sorteren:
  - muisslepen werkt;
  - de aanraaksimulatie (pointerType `touch` via een gedispatchte PointerEvent) start pas na 450 ms;
  - vroeg bewegen scrolt;
  - de volgorde komt correct in `applyRouteOrder`. In `?test` worden geen writes naar Zoho gedaan, want die zijn geguard.
- 44 px op aanraakschermen.
- Brent test op de echte S7 FE.
