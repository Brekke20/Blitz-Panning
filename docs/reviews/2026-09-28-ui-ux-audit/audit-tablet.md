# UX-audit tablet (768x1024, 820x1180, 1024x768) — Blitz Planning

Datum: 2026-09-28. Alleen bekeken en gemeten (app op localhost:3333/?test), niets gewijzigd of verstuurd.
Kanttekening: de bevindingen voor Wachtrij/Route/Rapporten op 768px komen uit een simulatie (ik heb de "desktop-only"-verberging tijdelijk in de browser uitgezet, zonder code te wijzigen), zodat je ziet hoe de bestaande schermen er zonder codewerk uitzien.

## Hoe de app nu tablet behandelt (kern)

- Er is precies een breekpunt voor "technieker/gsm-indeling": `max-width: 1023px`. Daaronder krijgt alles met de CSS-klasse `desktop-only` `display:none`. Dit gebeurt op vier plaatsen in `public/css/app.css` (regel 459, 879, 904, 920) plus JS in `public/index.html`: `matchMedia('(max-width: 1023px)')` (regel 838 en 4591) en `window.innerWidth >= 1024` (regel 1696 en 1757) die kiest tussen de tijdlijn-kalender en de kaartenlijst.
- Verborgen onder 1024px: tabs Wachtrij, Route, Rapporten; het tandwiel Instellingen; "Plan deze week"; Import; "+ Afspraak"; "zonder datum"-pil; per dag "Beschikbaar"-knop en "x/3 stops"; Route berekenen; in ticketdetail de Klantbeschikbaarheid, "Plan"-knop en "Voorstel"-knop.
- Een tweede breekpunt op 680px (Route/weekraster gaan in 1 kolom, sleepfunctie van de route wordt aan/uit gezet). Een derde op 600px (modals worden gecentreerd i.p.v. onderaan).
- Een resize/rotatie over 1024px is netjes afgehandeld: de actieve tab springt naar Kalender en de kalender wordt opnieuw opgebouwd (geen lege scherm, zoals de code-commentaar beschrijft).

## A. Wat goed werkt

- Rotatie/resize over de 1024-grens crasht niet: van Rapporten op 1024px naar 1000px springt de app terug naar Kalender en toont meteen de kaarten (getest). Geen horizontale scroll op 1000px.
- Op 1024x768 (desktop-indeling) past alles: 6 tabs in 1 rij, tijdlijn-kalender met 5 kolommen van ca. 170px en uren-as, Route met lijst (300px) + kaart, Rapporten-filterbalk in 1 rij. De desktop-indeling is dus al tablet-liggend-waardig qua ruimte.
- De bestaande schermen Wachtrij, Route en Rapporten werken zonder aanpassing goed op 768px (simulatie): 6 tabs passen in 768px (geen scroll), Wachtrij-kaarten zijn leesbaar, Route toont lijst 300px + kaart ca. 468px met werkende zoom- en laagkiezer. Dit betekent dat "ontbrekende tabs terugbrengen" technisch bijna gratis is.
- Tabs zijn 40px hoog en de kaartknoppen "Bellen/Navigeer" krijgen al 44px+ min-hoogte onder 1024px (gemeten 52px hoog op 768).
- Rapport-wizard is op 768 een volledig scherm met vloeiende velden (361px per kolom-veld, 732px volle breedte), radio-kaarten zijn groot, "Volgende" is 44px hoog. Bruikbaar.
- Ticketdetail-modal is 520px breed, gecentreerd en leesbaar.
- Geen horizontale scroll op paginaniveau op 768 en 820.

## B. Problemen per formaat / scherm

### 768x1024 (iPad staand) — huidige toestand

| # | Wat ik zag | Waarom het hindert | Ernst | Voorstel | Moeite |
|---|---|---|---|---|---|
| B1 | Tabs Wachtrij, Route, Rapporten ontbreken (alleen Kalender/Ingepland/Inventaris). | Coordinator op tablet kan geen tickets uit de Wachtrij plannen, geen route bekijken, geen rapporten openen. Ook Instellingen (tandwiel) ontbreekt. | Hoog | Breekpunt naar ca. 768 verschuiven (zie variant 1) zodat de bestaande desktop-tabs verschijnen. | S |
| B2 | Weekkalender: 5 kolommen x min-width 155px = 775px, in een scherm van 768px. Horizontale mini-scrollbalk voor 7px. | Onnodige, storende scrollbalk; laatste kolom (vr) is half afgesneden, ook in de screenshot. | Middel | `.day-col { min-width: 140px }` of `flex:1 1 0; min-width:0` in tabletbereik. Op 820 past het wel (164px/kolom). | S |
| B3 | Kalender eindigt op y=540 van 1024px: 47% van het scherm blijft leeg (op 820x1180: 54%). Kaarten staan in smal kaartformaat, tekst 10px (adres `.cal-addr` 10,2px), tijd wordt over 2-3 regels gebroken ("22:00–\n01:00 (gepland\n22:59)"). | Verspilde ruimte; leesbaarheid; techniekers op tablet zien weinig per scherm. | Middel | Tijdlijn-weergave (die desktop al heeft) ook op tablet gebruiken, of minstens kaarten vullen tot onderaan (`min-height: 100%`), tijd op 1 regel. | M |
| B4 | Ticketdetail toont geen Klantbeschikbaarheid, "Plan"-knop of "Voorstel"-knop op tablet. | Coordinator kan op tablet geen afspraakvoorstel sturen of tijdstip plannen. Onduidelijk waarom (knoppen zijn gewoon weg, geen uitleg). | Hoog (voor coordinatoren) | Zie B1: `desktop-only` afhankelijk maken van de rol/apparaat, niet enkel van de breedte. | S-M |
| B5 | Bij het automatisch wisselen van tab (resize onder 1024px) blijft de groene tab-onderstreping staan onder de vorige tab (bv. onder Ingepland/Inventaris terwijl Kalender actief is). | Verwarrend: lijkt of een andere tab actief is. Ook zichtbaar bij `setTab()` via script. `enforceMobileTabRestriction()` roept `setTab('kalender')` aan maar de indicator lijkt achter te lopen. | Laag | `updateTabIndicator()` aanroepen na de automatische tabwissel (en na rotatie). | S |
| B6 | Tik-doelen: ticketmodal-knoppen Aankomst/Foto's/Rapport/Datum-tijd zijn 33px hoog, sluitknop (X) 28x28px, header-knoppen 32x32px, persoon-knop 36px, weekwissel-knoppen "Week/Maand" 25px hoog. | Onder de 44px-aanbeveling (WCAG 2.5.5, Apple 44pt). Op tablet met vinger (en handschoenen) foutgevoelig; X van de modal is klein. | Middel | Op `pointer: coarse` of tabletbreedte min-hoogte 44px voor `.hbtn`, `.mhdr-close`, modalknoppen en kalender-toolbar. | S-M |
| B7 | Wizard: velden lopen op 768px vol breedte zonder maximum (732px). Labels 0,65rem (ca. 10px) hoofdletters in grijs, stapdots 9px, stapindicator "1/8 - Algemeen" ca. 10px. | Kleine tekst op een groot scherm; slechte leesbaarheid en contrast voor grijze micro-labels; bij liggend 1024 worden velden 900+ px breed. | Middel | In de wizard `max-width: 720px; margin: 0 auto` voor `.wiz-body` bij >=768px; labels 0,75rem; grotere stap-indicator. | S |
| B8 | Bij het openen van de wizard start automatisch "Aankomsttijd berekenen..." (toast) — mogelijk een echte routeaanroep. | Niet tablet-specifiek, maar op tablet zichtbaar; onverwachte netwerkactie bij het openen van een rapport. | Laag | Melding duidelijk maken of pas na actie. | S |
| B9 | Ingepland en Inventaris zijn 1 kolom over de volle breedte met kleine tekst (ca. 10-11px). Inventaris toont "Nog geen bewegingen" met datumvelden. | Lange, dunne rijen op breed scherm; veel leegte. | Laag | Max-breedte 720px of 2 kolommen; grotere tekst. | S |
| B10 | Op de Wachtrij (in de simulatie) staat de outbox-balk "PDF naar Zoho versturen (2/2)" met Opnieuw proberen / Annuleren. Ik heb er niet op geklikt. Waarschijnlijk restant van andere testsessies in dezelfde browser. | Niet tablet-specifiek. Wel vermelden zodat niemand per ongeluk "Opnieuw proberen" tikt. | Info | n.v.t. | - |

### 820x1180 (iPad Air/10e generatie staand)

| # | Wat ik zag | Ernst | Voorstel | Moeite |
|---|---|---|---|---|
| B11 | Dezelfde gsm-indeling als 768; 5 kolommen van 164px passen net (geen scrollbalk). Kalender vult slechts 540 van 1180px (54% leeg). Zelfde ontbrekende tabs, knoppen en modalonderdelen (zie lijst verborgen elementen bovenaan). | Hoog (functies) / Middel (ruimte) | Zelfde als B1-B3. | S / M |

### 1024x768 (iPad liggend) en de overgang rond 1024

| # | Wat ik zag | Ernst | Voorstel | Moeite |
|---|---|---|---|---|
| B12 | Op exact 1024 breed (of meer) krijg je de volledige desktop-indeling, op 1000 breed (bv. iPad mini liggend 1133 werkt, maar kleine Androidtablets 960/1000, iPad 9e gen. 1080 wel desktop) de gsm-indeling. Grens is scherp: 1023 = geen Wachtrij/Route/Rapporten/Instellingen, 1024 = alles. Een iPad 10,2" liggend is 1080 en krijgt dus desktop; een iPad mini/Android-tablet van 960-1000 niet. Gelijkaardige tablets krijgen zo verschillend gedrag. | Middel | Grens verlagen (zie variant 1) zodat alle gangbare tablets dezelfde indeling krijgen. | S |
| B13 | Desktop-indeling op 1024 (touch): tik-doelen 21-30px hoog (kalender-toolbar "Plan deze week" 29px, "Beschikbaar" 21px, "Route berekenen" 23px, "Toewijzen" 24px, "Week/Maand" 25px, `‹ ›` 30px). | Middel | Op `pointer: coarse` minimaal 40-44px voor deze knoppen. | M |
| B14 | Sleep-en-neerzetten van routestops gebruikt HTML5 `draggable` (aan bij `innerWidth > 680`, `index.html` r. 3721/3766). HTML5-drag werkt slecht of niet met vingers op iPad/Android. Tablet zou dit dus niet kunnen terwijl de UI het suggereert. | Middel | Extra "omhoog/omlaag"-knoppen of aanraak-vriendelijke drag-bibliotheek (bv. SortableJS met touch). Ook nodig voor variant 1 als Route op tablet komt. | M |
| B15 | Kaartlaagkiezer staat nu open (`collapsed:false`), dus de eerdere hover-klacht is opgelost. Mooi. Wel: de kiezer beslaat een groot deel van de kaart op 768. | Laag | In tabletbereik inklappen achter knop. | S |
| B16 | Hover-afhankelijke effecten (`.hbtn:hover` scale) hebben op touch geen betekenis; er zijn geen echte hover-only functies gevonden. | OK | - | - |
| B17 | Rotatie staand naar liggend: getest via resizes 768 -> 1000 -> 1024. Tab-restrictie en kalender worden herbouwd; enkel de tabindicator loopt achter (B5). | Laag | Zie B5. | S |

### Toegankelijkheid (WCAG 2.1 AA) — tablet-relevante punten

- 2.5.5 tikgrootte: zie B6 en B13 (Middel, breed aanwezig).
- 1.4.4/leesbaarheid: veel tekst tussen 10 en 11px (`.cal-addr` 10,2px, wizardlabels 10,4px, `.cal-badge` 9,4px, `.cal-sub` 11,8px). Op tablet op leesafstand te klein; minimum 12px aanhouden. Middel.
- 1.4.3 contrast: grijze micro-labels op donkere achtergrond (`--muted`) zijn kandidaten voor een contrastcontrole (niet gemeten met tool). Laag-Middel.
- 4.1.2: het "+"-icoon op Wachtrijkaarten heeft geen tekstlabel (al gemeld in de vorige ronde); op tablet blijft dat relevant (groene cirkel 30px?).
- 2.4.7: focusstijl wordt voor invoervelden getoond (accent-rand + schaduw); knoppen niet getest.
- 1.3.4 oriëntatie: geen vergrendeling; beide standen werken. Goed.

## C. Voorstel tablet-indeling

### Variant 1 — Licht: "breekpunt verschuiven + ontbrekende tabs" (aanbevolen eerste stap)

Idee: `1023px` vervangen door een lager breekpunt, bv. `767px`, zodat alles vanaf 768px de bestaande desktop-indeling gebruikt (met kleine aanpassingen). Gsm blijft precies zoals nu.

Wat de gebruiker terugkrijgt
- Op tablet (staand en liggend): alle 6 tabs, Instellingen, "Plan deze week", Import, "+ Afspraak", Beschikbaar-knoppen, Klantbeschikbaarheid + Voorstel in ticketdetail.
- Route (lijst + kaart) en Rapporten werken al vanaf 768 (getest via simulatie).
- Kalender: op tablet de kaartenlijst (5 kolommen) of de tijdlijn (zie keuze hieronder).

Wat er moet gebeuren
- `public/css/app.css`: 4 media queries aanpassen van `max-width:1023px` naar `max-width:767px` (regel 459, 879, 904, 920). Regel 459 (`.cal-btn` 44px) liever juist uitbreiden naar tablet via `@media (pointer: coarse)`.
- `public/index.html`: 3-4 JS-checks: `matchMedia('(max-width: 1023px)')` (r. 838, 4591) en `innerWidth >= 1024` (r. 1696, 1757) allemaal naar dezelfde constante (bv. `const BP_TABLET = 768`) laten wijzen. Een enkele constante voorkomt dat CSS en JS uit elkaar lopen.
- Kalendertijdlijn op 768px: 5 kolommen + uren-as (40px) = 728/5 = ca. 138px per kolom; tijdlijnblokken zouden krap zijn. Twee opties: (a) tijdlijn pas vanaf 900px, daaronder kaartenlijst met `.day-col{min-width:140px}`; (b) 3-daagse weergave op staand tablet. Keuze (a) is klein.
- Tikgroottes: `@media (pointer: coarse)` met `min-height: 44px` voor `.hbtn`, `.mhdr-close`, kalender-toolbar, modalknoppen (ca. 1 blok CSS, 20 regels).
- Tab-indicator (B5) en wizardbreedte (B7) meenemen.
- Route slepen (B14): toevoegen van omhoog/omlaag-knoppen of touch-drag; anders documenteren dat op tablet "Optimaliseer" gebruikt moet worden.

Risico's
- De rol-gedachte "techniekers krijgen een afgeslankte weergave" verdwijnt op tablet: een technieker met een tablet ziet dan ook Wachtrij, Plan deze week, Voorstel, wat hij niet zou moeten aanraken. Oplossing: rol/persoon-afhankelijk maken (bv. instelling "Weergave: technieker / coordinator") in plaats van op breedte. Anders kan een technieker per ongeluk plannen of voorstellen versturen.
- Gsm in liggende stand (bv. 812-932px) valt dan ook in de tabletindeling. Overweeg extra voorwaarde `(min-width:768px) and (min-height:600px)` of `pointer`/hoogte-check.
- Kalendertijdlijn op smalle breedte moet getest worden.

Ruwe omvang: klein. 2 bestanden (`app.css`, `index.html`), ca. 4 media queries + 4 JS-checks + 1 blok `pointer: coarse` + 2 kleine fixes (tabindicator, wizard max-width). Geschat 0,5 tot 1 dag met testen op 3 formaten.

### Variant 2 — Volwaardig: eigen tablet-layout met lijst + detail

Idee: een aparte tabletklasse (bv. `body.is-tablet`, 768-1180px) met twee kolommen: links een lijst (Wachtrij / Ingepland / Rapporten), rechts detail of kalender/kaart. Het huidige detail-venster (modal) wordt een vast rechterpaneel.

Voorgestelde indeling
- Breekpunten: `<768` gsm (ongewijzigd), `768-1179` tablet (nieuw), `>=1180` desktop (huidige). iPad 10,9" liggend (1180) en 12,9" (1366) blijven desktop; iPad staand en mini-liggend zijn tablet.
- Navigatie: onderaan een vaste tabbalk (duimbereik) met Kalender / Wachtrij / Route / Ingepland / Rapporten / Meer (Inventaris, Instellingen). Tablet staand: 5-6 iconen met tekst, 56px hoog.
- Wachtrij (liggend): links lijst (360px), rechts ticketdetail als paneel (Klantgegevens, Beschikbaarheid, Plan, Voorstel) i.p.v. modal. Staand: lijst volle breedte, detail als zijpaneel (slide-over, 480px).
- Ingepland: idem, lijst links + detail rechts; Rapporten: lijst links, rapport-preview rechts.
- Kalender: liggend = tijdlijn zoals desktop met 5 dagen (kolommen ca. 150px). Staand = 3-daagse of dagweergave met dagkiezer (7 dagen als strip bovenaan), 1 grote dagkolom met de uren-as; kaarten volledig leesbaar (12-13px tekst).
- Route: liggend lijst (300px) + kaart; staand kaart boven (45% hoogte) + lijst onder, met omhoog/omlaag-knoppen i.p.v. slepen.
- Rapport-wizard: gecentreerd paneel `max-width: 720px` (staand) of twee kolommen (liggend): links stappenlijst (8 stappen, zichtbaar en aanklikbaar), rechts stapinhoud. Vervangt de 9px-bolletjes.
- Inventaris: tabel met vaste kolommen, 2 kolommen of tabel vanaf 768.
- Alle tikdoelen minimaal 44px, minimum lettergrootte 12px.

Wat de gebruiker terugkrijgt: een echte tabletervaring (minder klikken, detail naast lijst, geen modals), beter gebruik van de 47-54% lege ruimte, rolafhankelijke weergave, consistente tikgrootte.

Risico's
- Veel nieuwe layoutcode in een enkel bestand van 5.952 regels (`public/index.html`), dat al desktop- en gsm-tak bevat; een derde tak verhoogt onderhoudslast en kans op regressies (herhaalde valkuil: kalender-kolomuitlijning, SW-cache).
- Detailmodal omvormen naar paneel raakt `openDetail()` en alle plaatsen die de modal sluiten/openen (Escape, achtergrondklik, wizard-overgang).
- Testen vereist echte iPad(s): de emulatie toont geen touch-drag, toetsenbord dat de wizard overlapt en Safari-adresbalk (100vh).
- Service worker cachen van CSS/JS: bump vereist bij elke wijziging.

Ruwe omvang: groot. Betrokken: `public/index.html` (nieuwe renderpaden voor kalender staand, ticketlijst+paneel, navigatie, wizard-layout; ca. 10-15 JS-checks), `public/css/app.css` (ca. 10-15 nieuwe media queries of een nieuw `tablet.css`), `wizard.css` (2-3 queries), `inventaris.css`, `prijzen.css` (1-2 elk), eventueel `sw.js` (cachelijst). Geschat 4 tot 7 dagen incl. tests en iteraties.

### Aanbeveling

1. Nu variant 1, maar dan rolbewust (technieker- vs coordinatorweergave als instelling of afgeleid van de persoon) en met een gedeelde breekpuntconstante. Levert direct de ontbrekende tabs, opent Route/Rapporten op tablet en lost de 7px-scrollbalk en tikgrootte op.
2. Variant 2 in delen, pas na feedback: eerst het ticketdetail als zijpaneel en de wizard-layout (`max-width` + stappenlijst), daarna de kalender staand (3-daags). Dit geeft het meeste effect per uur.

## Snelle winsten (tablet, elk < 1 uur)
- `.day-col { min-width: 140px }` op 768 (verwijdert 7px-scrollbalk).
- Tabindicator herberekenen na automatische tabwissel.
- `.wiz-body { max-width: 720px; margin: 0 auto }` op tablet.
- 44px min-hoogte voor `.mhdr-close` en modal-actieknoppen bij `pointer: coarse`.
- Kalenderkaarten: tijd op 1 regel en tekst minimaal 12px op tablet.
