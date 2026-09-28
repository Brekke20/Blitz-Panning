# UI/UX-audit Blitz Planning — desktop (coordinator), 1440x900

Datum: 2026-09-28 · App: http://localhost:3333/?test (v1.6.0) · Alleen bekeken, niets gewijzigd/opgeslagen/verstuurd.
Doorlopen: Wachtrij, Kalender (week + maand + "zonder datum"-paneel), Route (1x automatische route-berekening, gebeurde vanzelf bij openen), Ingepland, Inventaris (Alle + Tim), Rapporten, ticketdetail (wachtrij + ingepland), Afspraak-toevoegen, Beschikbaarheid-venster, Instellingen (Algemeen + Beschikbaarheden), persoonskeuze, thema donker + licht. Contrast/tikgroottes gemeten in de browser (eigen script: contrastverhouding tekst vs. effectieve achtergrond, lettergrootte, elementgrootte).
NIET beoordeeld: outbox-balk (verschijnt alleen bij een wachtende verzending; enkel code gelezen), Rapport-wizard, Voorstel-venster, Import-venster.
Opmerking testdata: de dummy-afspraken staan om 22:00-01:00, buiten de kalender-tijdlijn (zie B-K1), dus in de weekkalender waren geen afspraakkaarten zichtbaar; kaartstijl beoordeeld via maandweergave, "Ingepland" en code.

---

## A. Wat goed werkt en behouden moet blijven

1. **Duidelijke, rustige hoofdstructuur**: één kop met logo, zes tabs, rechts persoon/vernieuwen/thema/instellingen. Tab "Wachtrij" heeft teller-badge, "Ingepland" ook; actieve tab heeft duidelijke groene onderlijn.
2. **Wachtrij-kaarten**: ticketnummer in monospace + prioriteit (Hoog/Middel/Laag nu Nederlands en consistent) + technieker-label + titel in vet + klant + adres. Rode linkerrand voor "Verlopen" en rode "Geen adres bekend" zijn goede signalen (label "Verlopen" + rand = niet enkel kleur).
3. **Maandweergave**: netjes, "vandaag" gemarkeerd, chips met tijd + ticketnr + titel, afgekapt met "…", leesbaar bij meerdere afspraken.
4. **Kalender-toolbar**: Week/Maand-schakelaar, vorige/volgende/Vandaag, oranje "zonder datum"-pil met teller, duidelijk primaire actie "Plan deze week" (groen) tegenover secundaire "Import"/"Afspraak". Goede hiërarchie.
5. **Dagkolom-kop in weekweergave**: dagnaam, groot dagnummer, "0/3 stops · ±0u" (capaciteit in één oogopslag) en de "Route berekenen"-knop bovenaan de kolom.
6. **Route-scherm**: lijst links (nr., titel, adres, tijd, acties), kaart rechts, kleurlegende mét tekst ("lichte vertraging", "wegafsluiting"), samenvattingsbalk onderaan (Stops · Afstand · Rijtijd · Vertraging · ETA). "Optimaliseer" en "Bereken tijden" hebben uitleg via tooltip (title).
7. **Instellingen**: gegroepeerd, labels boven velden, routelijn-kleur heeft nu een echt kleurstaaltje + hex-code (eerdere bevinding is opgelost), werkdagen als aan/uit-chips, "Beschikbaarheden"-tab met duidelijke stappen Type / Voor / Reden.
8. **"Afspraak toevoegen"-dialoog**: compact, logische volgorde, voorbeeld-placeholders ("bv. Installatie Pietersen"), primaire knop "Opslaan" naast "Annuleren".
9. **Ticketdetail**: overzichtelijke secties Klantgegevens / Ticketdetails / Klantbeschikbaarheid, klikbare mail/telefoon/adres in accentkleur, sluitknop met aria-label.
10. **Rapporten-rij**: type (2e lijns), status met icoon én tekst ("⚠ Niet hersteld"), drie gelijkwaardige acties onderaan, verwijderen vraagt bevestiging met ticket + datum + "kan niet ongedaan worden".
11. **Inventaris**: rijen op 0 rood omlijnd mét cijfer; contrast in dit scherm is in orde (0 faalders bij meting).
12. **Toetsenbord**: Escape sluit de meeste vensters; globale `:focus-visible`-ring (2px accent) bestaat en is zichtbaar op knoppen.
13. **Thema**: licht en donker werken, keuze wordt onthouden; donker is prettig voor lang gebruik.
14. **Bevestigingen op risicovolle acties**: feestdag/klant-niet-beschikbaar-waarschuwing bij inplannen, "Alle stops verwijderen?", rapport verwijderen.

---

## B. Problemen per scherm

Legenda: ernst Hoog/Middel/Laag · moeite S (<1u) / M (halve dag) / L (meerdere dagen) · [bekend] = staat al in backlog/vorige ronde.

### Globaal / kop

**B-G1. Tabs (Wachtrij…Rapporten) zijn geen knoppen maar `<div onclick>`**
- Gezien: 18 klikbare `div/span` (o.a. alle 6 tabs, en de ticketkaarten in Wachtrij/Ingepland/kalender) hebben tabindex=null; 0 van 18 bereikbaar met Tab. Toetsenbordgebruiker komt na de kop rechtstreeks in de kalender-toolbar, nooit in de tabs of op een ticket.
- Waarom: navigatie en "ticket openen" (de kernactie) zijn zonder muis onmogelijk; schermlezer meldt niets bruikbaars.
- Ernst: Hoog (toegankelijkheid), voor de coördinator zelf Laag. Voorstel: tabs als `<button role="tab">` in `role="tablist"` (of gewone `<button>`), ticketkaarten `role="button" tabindex="0"` + Enter/Space. Moeite M.

**B-G2. Modale vensters vangen de focus niet op**
- Gezien: met ticketdetail open ging Tab (3x) naar de "+"-knop ACHTER het venster (`inModal=false`). Geen `role="dialog"`, `aria-modal`, `aria-labelledby` op de 12 overlays; focus keert niet terug naar de opener.
- Waarom: toetsenbord/schermlezergebruiker verdwaalt achter de overlay.
- Ernst: Middel. Voorstel: `role="dialog" aria-modal="true"`, focus naar eerste veld/sluitknop bij openen, Tab-lus binnen het venster, focus terug bij sluiten. Moeite M.

**B-G3. Escape sluit niet alle vensters**
- Gezien: "Afspraak toevoegen" (`manueel-overlay`) bleef open na Escape (bevestigd). De Escape-handler (index.html r.5944) sluit niet: Import, Lokale-afspraak-detail, Foto's, Afspraak toevoegen. Ook het persoonsmenu bleef open bij tabwissel.
- Waarom: inconsistent; wie de rest met Escape sluit, blijft hier "vastzitten".
- Ernst: Laag-Middel. Voorstel: handler aanvullen met closeImportModal/closeLocalDet/closeFotoModal/closeManueelModal, of generiek "sluit bovenste `.overlay.open`". Moeite S.

**B-G4. Lichte modus heeft ernstige leesbaarheidsproblemen**
- Gezien (gemeten): accentgroen `#00dfa3` wordt als TEKST op wit gebruikt: badge 1.49:1, "Laag"-label 1.57:1, "Route berekenen" 1.39:1, "Bevestigd" 1.57:1, "Toewijzen" 1.54:1, "vandaag ma" 1.74:1, "2e lijns" 1.54:1, avatar-letter "A" 1.43:1. Overige: oranje "Middel" 1.93:1, "⚠ Niet hersteld" 2.15:1, "Tim"-label 2.04:1, grijze tekst (`--muted #8896a8`) 2.4–3.0:1. Kalender: 26 elementen falen, Rapporten 16, Ingepland 14, Route 12, Wachtrij 17.
- Waarom: in lichte modus zijn statussen, knoppen en labels bijna onzichtbaar (vooral bij daglicht/beamer).
- Ernst: Hoog (als licht thema gebruikt wordt; zo niet: Middel). Voorstel: aparte, donkerder tekstkleuren voor licht thema (bv. accent-tekst `#00775a` ≈ 5.3:1, oranje `#9a5b00`, blauw `#1d5fb8`, muted `#5b6675` ≈ 5.5:1); accent alleen als vulling met donkere tekst. Moeite M.

**B-G5. Overige kleine tikdoelen in de kop**
- Gezien: ↺, 🌙 en ⚙ zijn 32x32 px; persoonskeuze 88x36; tab-hoogte 40 px. Icoon-only knoppen hebben enkel `title` (geen `aria-label`): "Vernieuwen", "Wissel licht/donker", "Instellingen".
- Ernst: Laag (muis desktop). Voorstel: aria-label toevoegen; 36–40 px. Moeite S.

**B-G6. Persoonskeuze "Alle" is onduidelijk**
- Gezien: knop toont enkel "A · Alle ▾"; menu heet "Alle technici / Gecombineerde weergave". Bij "Alle" toont Inventaris een ander scherm (bewegingenlog "Nog geen bewegingen") dan bij "Tim" (voorraadlijst met "Edit"). Instellingen zegt "Instellingen voor: Standaard (alle technici)".
- Waarom: niet duidelijk dat instellingen/inventaris afhangen van de gekozen persoon; "Alle" alleen lezen? gedeelde standaard?
- Ernst: Middel. Voorstel: knoplabel "Alle technici" (of "👥 Alle technici"); in Instellingen expliciet: "Je past de standaard aan voor alle technici die geen eigen instelling hebben"; in Inventaris met "Alle": duidelijke titel "Bewegingen (alle technici)" + tip "Kies een technieker om de voorraad te zien". Moeite S.

**B-G7. Geen reduced-motion, hover-transformaties**
- Gezien: `.sico:hover {transform: scale(1.07)}`, `.filter-pill:hover translateY(-1px)`, geen `@media (prefers-reduced-motion)`.
- Ernst: Laag. Moeite S.

**B-G8. Toasts: onder, tijdelijk, niet aangekondigd, lange fouttekst wordt afgekapt**
- Gezien: `#toast` heeft `white-space: nowrap; max-width: 90vw` (lange foutmeldingen als "❌ Zoho update mislukt: <foutcode>" lopen buiten de pil of worden afgekapt), standaardduur 2,5 s (te kort voor foutmeldingen), geen `role="status"/aria-live`, geen sluitknop. Mengeling ⚠ / ⚠️ / ❌ / ✓ / 🧪 / 🔑 emoji.
- Waarom: foutmeldingen zijn juist de meldingen die je moet kunnen lezen; klantenservice-tools tonen vaak een technische string.
- Ernst: Middel. Voorstel: `white-space: normal`, min. 6 s (of tot klik) voor ❌/⚠, `role="status"` (fouten `role="alert"`), één icoonset. Moeite S.

### Wachtrij

**B-W1. "+"-knop (ticket inplannen) heeft geen tekst, geen tooltip, geen aria-label** [deels bekend: 22-9-ronde noemde het ontbrekende label]
- Gezien: 30x30 px, enkel "+"; klik doet `quickAdd()` (plant meteen in, zonder te tonen op welke dag/tijd). Bevestigd nog zo.
- Waarom: coördinator weet niet wat/wanneer het gebeurt, geen ongedaan maken.
- Ernst: Middel. Voorstel: label "Inplannen" (icoon + tekst) of tooltip "Inplannen op eerstvolgende vrije dag"; toast met dag + "Ongedaan maken". Moeite S (label) / M (undo).

**B-W2. Smalle kolom, geen zoeken/sorteren/groeperen**
- Gezien: lijst is een 396 px brede (van 1440) gecentreerde kolom; 3 tickets vullen 20% van het scherm; rechts en links leeg. Geen zoekveld, sortering (prioriteit/datum/regio), of filterchips terwijl kalender wel filter-pills heeft.
- Waarom: bij 30+ tickets moet de coördinator veel scrollen zonder overzicht; desktopruimte onbenut (kalenderweergave ernaast/sleep-naar-dag ontbreekt).
- Ernst: Middel. Voorstel: kolom naar ~640–760 px, of 2-koloms (lijst + mini-week); zoekveld + sorteren "Prioriteit / Verlopen eerst / Regio". Moeite M-L.

**B-W3. Kaartteksten zijn erg klein**
- Gezien: ticketnummer 11-12 px monospace, meta/adres 11.5–11.8 px in grijs (contrast 3.6:1 donker), tags 10.2 px. Titel is wel goed (~14 px vet).
- Ernst: Middel. Voorstel: meta/adres 13 px, tags 11.5–12 px, grijs `--muted` lichter. Moeite S.

### Kalender (week)

**B-K1. Afspraken buiten 08:00–18:00 verdwijnen uit beeld**
- Gezien: `computeTimelineRange()` toont minimaal 08–18u (breidt enkel uit via werkuren-instelling, niet via de afspraken). Testafspraken van 22:00–01:00 stonden op top=1489 px in een 780 px hoge dagkolom: onzichtbaar; in het weekbeeld zag ik geen enkele kaart terwijl "1/3 stops" in de kolomkop staat.
- Waarom: een spoedbezoek om 19:30 of 06:30 verdwijnt zonder waarschuwing; kolomkop zegt 1 stop, grid is leeg.
- Ernst: Middel (Hoog bij spoedinterventies). Voorstel: tijdlijnbereik uitbreiden naar min/max van de zichtbare afspraken, of een "buiten werkuren"-strook bovenaan de kolom. Moeite M.

**B-K2. Dubbele scroll + dagkoppen scrollen weg**
- Gezien: `#week-grid` is 968 px hoog terwijl het onder de toolbar (140 px) slechts ~760 px zichtbaar is → pagina scrolt (documentScrollHeight 1108) én het grid scrolt intern (max ±537 px). Dagkoppen (MA 28 …) zijn niet sticky: na scrollen zie je enkel uren zonder dag. Bij open "zonder datum"-paneel schuift alles nog 170 px naar beneden.
- Waarom: verlies van context (welke dag/kolom), twee scrollbars naast elkaar.
- Ernst: Middel. Voorstel: grid `height: calc(100vh - <toolbar>)`, `.day-hdr {position: sticky; top: 0}`; paneel "zonder datum" met max-hoogte en eigen scroll of als zijbalk. Moeite M.

**B-K3. Zeer kleine tekst in kolomkop en kaarten**
- Gezien: `day-cap` ("0/3 stops · ±0u") 10.1 px, "⏱ Beschikbaar" 10.1 px, dagnaam 10.4 px, uurlabels 10.9 px (3.7:1), `cal-badge` 9.4 px, `cal-addr` 10.2 px, "(gepland 22:58)" 10.1 px, maand-chips 9.9 px, maand-weekdagkop 10.1 px.
- Ernst: Middel. Voorstel: minimum 11–12 px, kernwaarden (capaciteit) 12 px. Moeite S.

**B-K4. Knop "⏱ Beschikbaar" leest als status, is een actie [gedeeltelijk bekend: "Blokkade opheffen"-label]**
- Gezien: onder elke dagkop staat een knop "⏱ Beschikbaar" (of "⏱ 2 uitzonderingen" of "🔓 Blokkade opheffen") die het venster "⛔ Beschikbaarheid" opent. Op een geblokkeerde dag staat bovenaan "🔒 Geblokkeerd" én onderaan de knop "🔓 Blokkade opheffen" [bekend].
- Waarom: labelt de huidige toestand, niet wat er gebeurt; niet herkenbaar als knop (geen rand, 21 px hoog, 10 px tekst).
- Ernst: Middel. Voorstel: "Beschikbaarheid aanpassen" (neutraal) of "Dag blokkeren…"; geblokkeerd: "Blokkade beheren" [bekend]. Moeite S.

**B-K5. Knoppen in kalender te klein / weinig als knop herkenbaar**
- Gezien: "Route berekenen" 261x23 px, "×" (verwijderen van afspraak uit kalender) 17x20 px direct op de kaart, "Toewijzen" 94x24 px, kal-nav 30x30, Week/Maand 25 px hoog.
- Waarom: "×" op de kaart verwijdert/plant uit met één klik ernaast; klein doel.
- Ernst: Laag-Middel. Voorstel: "×" ≥ 28 px + confirm/undo; overige 28–32 px. Moeite S.

**B-K6. "Route berekenen" berekent niet, maar opent het Routescherm (dat zelf meteen TomTom bevraagt)**
- Gezien: klik op de knop → tabwissel naar Route → `calculateRoute()` start automatisch (toast "Route berekenen…"). Label belooft iets anders dan "Toon route".
- Ernst: Laag. Voorstel: "Route bekijken" (of "Route van deze dag →"). Moeite S.

**B-K7. Paneel "Wacht bevestiging — zonder datum"**
- Gezien: klein oranje kopje 11.2 px, één kaart met knop "📅 Toewijzen"; pil erboven toont enkel "⚠ 1 zonder datum". Paneel klapt open en duwt kalender omlaag; beweegt met animatie.
- Ernst: Laag. Voorstel: label in de pil "1 wacht op datum"; paneel als overlay of zijbalk. Moeite M.

### Kalender (maand)

**B-M1. Onderste ±20% ongebruikt, weekdagkoppen 10 px, vorige/volgende maand zeer flets**
- Gezien: rijen ~48 px hoog met veel lucht; tot 41 cel-nummers 11.5 px en 3.7:1 (donker); datums buiten de maand nog zwakker. Er is geen "+ meer"-aanduiding bij >1 afspraak/dag getest.
- Ernst: Laag. Voorstel: rijhoogte vullend (`grid-auto-rows: 1fr`), nummers 12–13 px. Moeite S.

### Route

**B-R1. Stopacties als 5 kleine, gelijkwaardige pillen; "Verwijderen" zonder bevestiging**
- Gezien: 🧭 Navigeer 82x24, 📨 Voorstel 78x24, ⏱️ Aankomst 88x24, 📋 Rapport 77x24, ✕ Verwijderen 91x24, tekst 10.9 px, contrast donker 3.06:1. "✕ Verwijderen" (`removeTicketFromDate`) haalt het ticket zonder confirm uit de planning (en synchroniseert), zit direct naast Rapport.
- Waarom: kans op misklik met gevolgen (planning weg, Zoho-status); "Verwijderen" klinkt als het ticket zelf wissen — in detail heet het wél "Verwijder uit planning".
- Ernst: Middel. Voorstel: "Uit planning halen" (rood, gescheiden rechts) met bevestiging of "Ongedaan maken"-toast; knoppen 28–32 px, 12 px tekst. Moeite S-M.

**B-R2. Twee klok-iconen voor verschillende dingen**
- Gezien: "⏱ 22:58" (aankomsttijd) en knop "⏱️ Aankomst" (registreren) gebruiken hetzelfde ⏱-icoon. Tijd 10.9 px.
- Ernst: Laag. Voorstel: 🕐 voor geplande tijd, "Aankomst melden" voor knop. Moeite S.

**B-R3. Lege staat en samenvatting**
- Gezien: leeg: "Voeg tickets of installaties toe via de Kalender" (13 px, contrast 3.39:1) bovenaan het smalle paneel, kaart toont heel België. In de Wachtrij-view zou de tekst (`index.html` r.117) "Voeg tickets toe via de Wachtrij of Kalender" moeten zijn; er zijn dus twee verschillende teksten. Samenvatting onderaan 11.7 px met streepjes "Stops: 0 · Afstand: —".
- Ernst: Laag. Voorstel: "Nog geen stops voor deze dag. Plan tickets in via de Wachtrij (+) of de Kalender." + knop naar Wachtrij; samenvatting 13 px, vet cijfers. Moeite S.

**B-R4. Kaartlaagkiezer**
- Gezien: klein paneel rechtsboven met 5 radioknoppen 13x13 px; namen "Standaard" en "OpenStreetMap" zijn niet te onderscheiden; scrollpijltjes zichtbaar (lijst 116 px, klipt). Bestaat nu open bij het laden (niet enkel hover) — verbetering.
- Ernst: Laag. Voorstel: "Standaard (Esri)" vs "OpenStreetMap" hernoemen of één weglaten; radio's groter. Moeite S.

**B-R5. Datuminput zonder label**
- Gezien: datumveld linksboven (`plan-date`) toont alleen "30/09/2026", geen label of "Route voor:".
- Ernst: Laag. Moeite S.

### Ingepland

**B-I1. Navigatiepijlen aan uiterste randen, geen "Vandaag", geen totaal**
- Gezien: "‹" op x=14 en "›" op x=1395 (1381 px uit elkaar) met weeklabel in het midden links; kaart in kolom van ~400 px midden. Geen "Vandaag"-knop (kalender heeft die wel); 31x26 px.
- Waarom: onnodig veel muisbeweging; inconsistent met Kalender.
- Ernst: Laag. Voorstel: pijlen naast het weeklabel, "Vandaag"-knop, "N afspraken deze week". Moeite S.

**B-I2. Tekstgrootte kaart**
- Gezien: dagkop "VRIJDAG 2 OKTOBER" 10.6 px (3.7:1), tijd 11.8 px, "(gepland 22:58)" 10.1 px, adres 11.5 px.
- Ernst: Laag-Middel. Moeite S.

### Inventaris

**B-V1. Rij over 1393 px breed: naam links, aantal helemaal rechts**
- Gezien (Tim): `inv-row` 1393x38 px; naam en aantal liggen 1300 px uit elkaar. In de testdata is alles 0 → 25 rode rijen achter elkaar ("alarmmoeheid"); knop "✏️ Edit" is Engels.
- Ernst: Middel. Voorstel: max-breedte ±720 px gecentreerd of tabel met vaste kolommen; rood enkel voor 0 én "laag" onderscheiden van "op"; knop "Voorraad bewerken". Moeite S.

**B-V2. Bij "Alle" geen voorraad maar leeg bewegingenlog**
- Gezien: twee lege datumvelden (dd/mm/jjjj, geen label, "–" ertussen), "📊 Excel export" en "Nog geen bewegingen." Ook geen uitleg waarom voorraad niet zichtbaar is (zie B-G6).
- Ernst: Middel. Moeite S.

### Rapporten

**B-P1. Toolbar en lijst zijn losgekoppeld**
- Gezien: titel "📋 Rapport archief" uiterst links, filters + Excel + Herladen uiterst rechts (1440 px breed), lijst als 720 px brede kolom in het midden; datuminputs zonder zichtbaar label ("–" tussen). De rij toont geen prijs in testdata.
- Ernst: Laag. Voorstel: toolbar in dezelfde kolombreedte, labels "Van"/"Tot". Moeite S.

**B-P2. "Verwijderen" even breed en zwaar als "Openen"**
- Gezien: drie knoppen elk 219x32 px, "Verwijderen" met volle rode rand naast "Openen" en "Verstuur rapport"; wel confirm. Actieve filterknop "Alle": witte tekst op groen 1.74:1 (donker én licht).
- Ernst: Middel (contrast), Laag (gewicht). Voorstel: Verwijderen als tekstlink/kleine icoonknop rechts; actieve filter donkere tekst op groen. Moeite S.

**B-P3. Rapportregel toont wel klantnaam, maar geen technieker/prijs bij deze testregel**
- Gezien: regel toont "Luc Wouters" (contactpersoon) zonder label; niet duidelijk of dit klant of technieker is (vorige ronde meldde technieker).
- Ernst: Laag. Voorstel: "Klant: Luc Wouters · Technieker: Tim". Moeite S.

### Ticketdetail

**B-D1. Footer met 6 knoppen wrapt over 2 rijen; verkeerde nadruk**
- Gezien (ingepland ticket): "✕ Verwijder uit planning" (vol rood, 186 px, eerste) domineert; daaronder Aankomst, Voorstel, Foto's, Rapport, Datum/tijd als gelijkwaardige grijze knoppen (13 px), rij breekt af. Geen bevestiging op "Verwijder uit planning". Het venster (±500 px breed) vult nagenoeg de hoogte (scrollbalk in modal).
- Waarom: gevaarlijkste actie het meest prominent; logische volgende stap (Rapport/Voorstel) niet benadrukt.
- Ernst: Middel. Voorstel: primaire actie afhankelijk van status (bv. "Voorstel sturen" bij wacht bevestiging, "Rapport maken" na bezoek); "Uit planning halen" rechts, tekstknop rood met confirm. Moeite M.

**B-D2. Drie losse opslagknoppen (Voorkeur / Duur / Notitie)** [bekend]
- Gezien: "✓ Instellen" 72x22 px, tekst 11.5 px, contrast 3.39:1; "+ Blokkeer datum" 108x18 px. Bevestigd nog zo.
- Ernst: Middel. Voorstel: één "Opslaan"-knop onderaan het blok; datumvelden tonen "dd/mm/jjjj". Moeite M.

**B-D3. Kleine velden en labels**
- Gezien: labels "Contact/Bedrijf/E-mail…" 11.5 px in grijs (3.39:1), sectietitels 10.2 px, datum/tijd-inputs 22–27 px hoog, "Aangemaakt ma 15 jun 2026" (andere notatie dan `dd/mm/jjjj`-invoer).
- Ernst: Laag-Middel. Moeite S.

**B-D4. Primaire knop "+ Voeg toe aan planning": wit op groen**
- Gezien: 1.74:1 (13 px vet). Zie ook C.
- Ernst: Hoog (contrast). Moeite S.

### Instellingen

**B-S1. Voegen "Prijzen" (beheer) toe naast Annuleren/Opslaan; venstergrootte verspringt** 
- Gezien: knop "💰 Prijzen" staat in dezelfde voetbalk als Opslaan/Annuleren en verschijnt ook op de Beschikbaarheden-tab, waar "Opslaan" ontbreekt (wijzigingen daar gebeuren via "Toevoegen"). Venster is hoog op "Algemeen" (±410 px) en lager op "Beschikbaarheden" (±300 px): springt bij tabwissel.
- Ernst: Laag. Voorstel: "Prijzen beheren" als aparte rij/link bovenaan; vaste minimumhoogte. Moeite S.

**B-S2. Werkdagen beginnen op zondag; "Tijdslot-grootte" onduidelijk**
- Gezien: chips Zo Ma Di Wo Do Vr Za (Belgische week begint maandag); "Tijdslot-grootte voor klant/technieker (minuten)" = 180, zonder uitleg; "Instellingen voor: Standaard (alle technici)" in groene monospace 11 px.
- Ernst: Laag. Voorstel: Ma–Zo; helptekst "Zo groot is het tijdvak dat de klant in het voorstel krijgt (bv. 13:00–16:00)". Moeite S.

**B-S3. Datumformaat en invoer**
- Gezien: browser-datumvelden tonen "dd/mm/jjjj" (taal browser), formaat elders "wo 30 sep 2026".
- Ernst: Laag.

### Andere dialogen

**B-X1. "Afspraak toevoegen": labels niet gekoppeld, geen verplichte velden gemarkeerd**
- Gezien: 10 velden zonder `<label for>`/aria-label (`labels=0`); Titel/Datum/Van/Tot zijn verplicht (toasts "⚠ Voer een titel in") maar niet gemarkeerd; velden 30–33 px hoog.
- Ernst: Middel (a11y). Moeite S-M.

**B-X2. Native `confirm()`-dialogen naast eigen modals**
- Gezien: 11 plaatsen (`confirm(`) — "Toch inplannen?", "Alle N stops verwijderen?", "Rapport verwijderen?" — in browserstijl met OK/Annuleren; niet consistent met app, niet themaafhankelijk, knopnamen "OK/Annuleren".
- Ernst: Laag. Voorstel: eigen bevestigingsvenster met benoemde knoppen ("Toch inplannen" / "Kies andere dag"). Moeite M.

**B-X3. Outbox-balk (enkel code)**
- Gezien in code: `position: sticky; top: 92px` hard gecodeerd; toont "⏳ Archiveren (1/2)", "poging N", ruwe foutmelding, "Opnieuw proberen"/"Annuleren" (rood). Kan tegen kop/toolbar aanliggen als die van hoogte verandert.
- Ernst: Laag. Voorstel: menselijke foutzin i.p.v. ruwe `lastError`; "Annuleren" → "Verzending annuleren".

### Tablet [bekend, niet opnieuw getest]
- Eigen tablet-indeling ontbreekt; alle `@media (max-width: 1023px)`-regels in app.css (r.459, 879, 904, 920) verbergen `.desktop-only`. Bevestigd in code.

---

## C. Toegankelijkheid (WCAG 2.1 AA)

### C1. Contrast (1.4.3 / 1.4.11) — gemeten
Donker thema (achtergrond ±#1d252d):
| Element | Voorgrond | Verhouding | Vereist | Pass |
|---|---|---|---|---|
| Witte tekst op groene knop "+ Voeg toe aan planning" (13 px vet) | #fff op #00dfa3 | 1.74:1 | 4.5:1 | Nee |
| Actieve filter "Alle" (Rapporten) 12 px | #fff op #00dfa3 | 1.74:1 | 4.5:1 | Nee |
| Teller in "zonder datum"-pil (11 px) | #fff op oranje | 2.15:1 | 4.5:1 | Nee |
| `--muted #6b7784` badge in tab "Ingepland" 10.9 px | | 2.72:1 | 4.5:1 | Nee |
| Sectie-/veldlabels, tabs, meta, adressen, uurlabels, dagkoppen, "tot", weekdag-chips (hele app) | #6b7784 | 3.06–3.68:1 | 4.5:1 | Nee (±60 elementen per scherm) |
| Rode "Geen adres bekend" 11.5 px (80% doorzicht) | | 3.39:1 | 4.5:1 | Nee |
| Prioriteit "Hoog" 10.2 px | #ff5a52 | 4.49:1 | 4.5:1 | Net niet |
| Tab-tekst niet actief 12.96 px | | 3.39:1 | 4.5:1 | Nee |
| Iconknoppen ↺ 🌙 ⚙ | #6b7784 | 3.39:1 | 3:1 (UI) | Ja (net) |

Licht thema (achtergrond ±#fff): zie B-G4 — accentgroen 1.39–1.74:1, oranje 1.93–2.15:1, blauw 2.04–2.34:1, rood 2.29:1, muted `#8896a8` 2.4–3.0:1; 12–26 faalders per scherm.

Oplossing in één keer: nieuwe tokens `--muted` (donker → ≈#8d99a6 ≥ 5:1; licht → ≈#5b6675) en aparte `--accent-text` (licht) + donkere tekst op groene vlakken.

### C2. Tekstgrootte (1.4.4 / leesbaarheid)
Veel tekst < 12 px: tags/badges 10.2–10.9 px; kalender: capaciteit 10.1, kolomkoppen 10.4, badges 9.4, adres 10.2, maandchips 9.9, weekdagkop 10.1; route: 10.9–11.7 px; detail-labels 10.2–11.5 px; kaartmeta 11.5–11.8 px. Aanbeveling: nergens < 12 px, kerninformatie ≥ 13 px. Body is 16 px (goed), maar bijna niets gebruikt het.

### C3. Toetsenbord (2.1.1, 2.4.3, 2.4.7)
| Element | Tab | Enter/Space | Escape | Opmerking |
|---|---|---|---|---|
| Tabs (6) | nee (div) | n.v.t. | – | onbereikbaar |
| Ticketkaart (Wachtrij/Ingepland/kalender) | nee (div) | n.v.t. | – | onbereikbaar |
| "+"-knop, kop-knoppen, toolbar | ja | ja | – | focusring OK (2 px accent, `:focus-visible`) |
| Ticketdetail/Instellingen/Beschikbaarheid | focus verlaat het venster (geen trap) | – | sluit | – |
| Afspraak toevoegen, Import, Foto's, Lokale detail | – | – | sluit NIET | zie B-G3 |
| Persoonsmenu | knop ja, items niet gecontroleerd | – | sluit niet | – |
Inputs: `.man-input`, `.set-input`, `.av-*`, `.prijs-*`, `.wiz-*` hebben `outline:none` met enkel randkleurwissel (één pixel) — 1.4.11-risico; enkel `.set-input`/`.wiz-*` krijgen extra `box-shadow`.

### C4. Naam, rol, waarde (4.1.2) en labels (1.3.1 / 3.3.2)
- Slechts 12 `aria-label` in `index.html` (alle sluitkruisjes), 0 `role=` attributen, geen `aria-live`, geen `role="dialog"`, geen `role="tab/tablist"`.
- "+"-knop, "×" (kalender), "‹ ›" (weeknavigatie), ↺/🌙/⚙ (title enkel), Week/Maand (geen `aria-pressed`), Hele dag/Tijdvak/Iedereen (chip-knoppen zonder `aria-pressed`/radiogroup), werkdagen-chips (geen `aria-pressed`).
- Formulieren: "Afspraak toevoegen" 0/10 velden gekoppeld; ticketdetail-invoer (voorkeur, duur, notitie) enkel visueel gelabeld; datumvelden `rapp-van/tot` hebben enkel `title`.
- Emoji als enige inhoud (✕, ↺, ⚙, 🌙) — sluitkruisjes hebben wel aria-label.
- Emoji in knoplabels worden voorgelezen ("mobiele telefoon Bellen"); voeg `aria-hidden="true"` op emoji-spans toe.

### C5. Tikdoelen (2.5.5 — AAA, best practice; desktop is muisgebruik)
Onder 32x32: "+" 30x30, sluitkruis 28x28, "×" 17x20, kal-nav 30x30, "✓ Instellen" 72x22, "+ Blokkeer datum" 108x18, mailtjes/tel-links 74x16 / 79x16, adreslink 201x16, kalender "Toewijzen" 94x24, "Route berekenen" 261x23, day-block 21 px, stopacties 24 px hoog, Leaflet-radio's 13x13, weekdag-chips 27 px, datuminputs 22–33 px. Desktop-toelaatbaar, maar 28–32 px minimum zou de foutgevoeligheid verlagen.

### C6. Overig
- Toasts: geen `aria-live` (4.1.3), verdwijnen na 2.5 s (2.2.1-neigend voor fouten).
- Kleur niet als enige aanwijzing: over het algemeen goed (tekst bij status, ↑ Hoog/Middel/Laag), uitzondering: kalenderkaarten kleur = status (Bevestigd/Wacht) — badge-tekst bestaat, maar 9.4 px.
- Kaart (Leaflet) is enkel muisbedienbaar; alternatief is de lijst links (goed).
- `prefers-reduced-motion` ontbreekt (2.3.3, AAA).
- Zoom 200 %: niet volledig getest; vaste hoogte week-grid (968 px) en `top: 92px` sticky elementen risico bij grotere tekst.

---

## D. Copy / microcopy

| Waar | Nu | Voorstel | Waarom |
|---|---|---|---|
| Kalender-dagknop | "⏱ Beschikbaar" | "Beschikbaarheid aanpassen" (of "Dag blokkeren…") | actie i.p.v. status |
| Kalender geblokkeerde dag | "🔒 Geblokkeerd" + "🔓 Blokkade opheffen" | "🔒 Geblokkeerd" + "Blokkade beheren" [bekend] | knop opent venster |
| Kalender "Route berekenen" | "Route berekenen" | "Route van deze dag" | opent enkel het Routescherm |
| Routestop | "✕ Verwijderen" | "Uit planning halen" | verwijdert het ticket niet |
| Ticketdetail | "✕ Verwijder uit planning" | "Uit planning halen" (rood, met bevestiging) | consistent met Route |
| Ticketdetail knoppen | "⏱️ Aankomst", "📅 Datum/tijd", "📨 Voorstel" | "Aankomst melden", "Datum/tijd wijzigen", "Voorstel sturen" | werkwoord + duidelijke actie |
| Klantbeschikbaarheid | "✓ Instellen" / "✓ Opslaan" (3x) | één "Opslaan" | [bekend] |
| Klantbeschikbaarheid | "+ Blokkeer datum" | "+ Datum uitsluiten" | eerlijk over gevolg voor klant |
| Wachtrij "+" | "+" (geen tekst) | "Inplannen" (tooltip: "Plan in op de eerstvolgende vrije dag") | onduidelijke knop |
| Inventaris | "✏️ Edit" | "Voorraad bewerken" | Nederlands |
| Inventaris "Alle" | "Nog geen bewegingen." | "Nog geen voorraadbewegingen in deze periode. Kies een technieker om de voorraad te zien." | wat + waarom + wat nu |
| Persoonsknop | "A · Alle" | "Alle technici" | herkenbaar |
| Route leeg | "Voeg tickets of installaties toe via de Kalender" (en elders "…via de Wachtrij of Kalender") | "Nog geen stops voor deze dag. Plan een ticket in via de Wachtrij (+) of de Kalender." | één tekst, volledig |
| Route "Leeg" | "✕ Leeg" | "Dag leegmaken" | "Leeg" is dubbelzinnig (bijvoeglijk) |
| Route "Optimaliseer" / "Bereken tijden" | "⚡ Optimaliseer" / "Bereken tijden" | "Beste volgorde zoeken" / "Rijtijden berekenen" | zegt wat er gebeurt |
| Kaartlagen | "Standaard" / "OpenStreetMap" | "Kaart (Esri)" / "OpenStreetMap" | niet te onderscheiden |
| Rapporten | "📋 Rapport archief" | "Rapporten" (tab heet al zo) of "Rapportarchief" | 1 woord |
| Rapporten | "📄 Openen" / "✉️ Verstuur rapport" / "🗑 Verwijderen" | "Openen" / "Rapport versturen" / "Rapport verwijderen" | verbaal + duidelijk object |
| Rapporten | "↺ Herladen" (vs. kop "↺ Vernieuwen") | overal "Vernieuwen" | één woord |
| Instellingen kop | "Instellingen voor: Standaard (alle technici)" | "Deze instellingen gelden voor: alle technici (standaard)" | leesbaar, geen monospace |
| Instellingen | "Max. reistijd tussen interventies (minuten)" | "Max. reistijd tussen twee bezoeken (min.)" + helptekst | eenduidig |
| Instellingen | "Tijdslot-grootte voor klant/technieker" | "Tijdvenster in klantvoorstel (min.)" + helptekst "bv. 180 = 13:00–16:00" | wat het doet |
| Instellingen | "Drukte tonen op de route (verwachte vertraging per wegstuk)" | "Verkeersdrukte tonen op de kaart" + subtekst "Kleurt wegstukken volgens verwachte vertraging" | kortere kop |
| Toast (technisch) | "🔑 Authenticatie verlopen — herinstalleer via /api/setup" | "Sessie met Zoho verlopen. Meld dit aan Brent; de koppeling moet opnieuw ingesteld worden." | geen URL/jargon |
| Toast | "⚠ Conflict — data herladen" | "Iemand anders paste dit net aan. Ik heb de laatste gegevens geladen; probeer opnieuw." | wat + waarom + actie |
| Toast | "❌ Zoho update mislukt: <foutcode>" | "Bijwerken in Zoho mislukt. Probeer opnieuw; blijft het fout, meld dit. (Detail: <code>)" | menselijk, code secundair |
| Toast | "❌ Opslaan mislukt" | "Opslaan is niet gelukt. Controleer je verbinding en probeer opnieuw." | reden + actie |
| Toast | "Ticket niet gevonden in planning" | "Dit ticket staat niet (meer) in de planning." | vloeiend |
| Toast | "⚠ Geen werkdagen in de geselecteerde periode" | "In deze periode zijn er geen werkdagen. Kies andere data." | actie |
| Toast | "⚠️ Kies eerst een technieker — de dag bevat stops van meerdere technici" | ok, maar toon in dialoog of naast de dropdown | zichtbaar bij actie |
| Emoji-mix | ⚠ / ⚠️ / ❌ / ✓ | één set (✓ / ! / ×) of geen | consistent |
| Outbox | "⏳ PDF naar Zoho versturen (2/2)" + "poging 2" + ruwe fout | "Rapport #1004 wordt verstuurd (stap 2 van 2)…" + "Lukt niet, ik probeer het opnieuw" + "Opnieuw proberen" / "Verzending annuleren" | jargon "PDF/archief" vermijden |
| Confirm-dialoog | "Toch inplannen?" (OK/Annuleren) | Knoppen: "Toch inplannen" / "Andere dag kiezen" | knoplabel = actie |
| Confirm bij rapport verwijderen | "Deze actie kan niet ongedaan worden gemaakt." | ok — behouden | |
| Afspraak-formulier | "Titel", "Notitie: Extra info …" | "Titel *" (verplicht markeren); "Notitie (optioneel)" | verplichte velden duidelijk |
| Testtoast | "🧪 Testmodus actief — dummy data geladen" | ok voor test; overweeg vaste "TESTMODUS"-badge i.p.v. toast | test niet verwarren met prod |

---

## E. Top-prioriteiten (voor jouw schifting)

1. Contrast lichte modus + witte tekst op groen (knoppen, actieve filter): S-M, groot effect.
2. Tabs en ticketkaarten toetsenbord/schermlezer-bereikbaar + dialoogfocus + Escape overal: M.
3. Kalender: afspraken buiten 08–18u zichtbaar maken; dagkoppen sticky; enkele scroll: M.
4. Destructieve acties ("Verwijder uit planning", "✕ Verwijderen" op route, "×" in kalender) zonder bevestiging/undo en te prominent: S-M.
5. Kleine tekst (< 12 px) en `--muted`-grijs verlichten: S.
6. Wachtrij-"+" labelen + Inventaris/Rapporten/Ingepland-lay-out (bredere/brede-balans): S.
7. Toasts: niet afkappen, langer bij fouten, `aria-live`, menselijke foutteksten: S.
