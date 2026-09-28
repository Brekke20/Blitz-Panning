# UX-audit gsm-weergave (technieker) — Blitz Planning
Datum: 2026-09-28 · Viewport 375×812 (kort ook 414×896) · http://localhost:3333/?test · v1.6.0
Methode: design-critique + accessibility-review + ux-copy; meetwaarden via DOM (tikgrootte, fontgrootte, contrast, scrollWidth), plus code-inspectie.

## 0. Let op — incident tijdens de audit (eerlijk melden)
Bij het doorlopen van de wizard klikte mijn automatische stap-lus per ongeluk op de laatste knop "🖨️ Afdrukken / PDF". Die knop doet méér dan afdrukken: hij maakt een outbox-item aan en stuurt naar de lokale dev-server. Gevolgen (testdata, ticket #1004 "Energiemeting klopt niet", datum 2026-09-30):
- `POST /api/rapport-archief` → 200: er staat nu een testrapport (id `32465231-a8ea-4fed-b050-18ad3e6e4718`) in het rapportarchief van de omgeving waarop localhost draait (waarschijnlijk lokale/dev Blobs-store; controleren of dit de echte `blitz-data` store is).
- `POST /api/rapport` → 400 "Ongeldig ticketId" (Zoho-upload mislukt, dus niets naar echt Zoho). Het item blijft in de outbox van die browser (IndexedDB) en toont een banner "PDF naar Zoho versturen (2/2)" met Opnieuw proberen/Annuleren.
- Ook `POST /api/optimize` en `/api/route` liepen (aanrijtijd-berekening bij openen van de wizard; gebeurt telkens bij openen).
- Er is niets verwijderd of aangepast aan echte tickets. Opruimen (archief-item + outbox-item) is aan Brent/hoofdagent; ik heb bewust niets verwijderd.
Dit is zelf een UX-bevinding: zie B-wizard #1 (label "Afdrukken / PDF" verzwijgt dat het verstuurt en archiveert).

## A. Wat goed werkt en behouden moet blijven
- Geen horizontale scroll: scrollWidth = innerWidth op 375 en 414, in alle drie de tabs en in de wizard.
- Wizard-invoervelden zijn 16px (geen iOS-inzoom) en 48px hoog; radio-kaarten 50px; footerknoppen Vorige/Volgende 44px. Volgende-knop: zwart op #00dfa3 = 12,1:1.
- Bellen/Navigeer op de kalenderkaart zijn nu 165×44 (v1.6.0-winst bevestigd). `tel:` en `geo:` (Android-keuzemenu voor navigatie-app) zijn de juiste keuze.
- Prioriteit staat nu in het Nederlands ("Middel"); ticketnummers groot en mono; status-badge met tekst (niet enkel kleur).
- Wizard-stappen zijn kort (8 stappen, één onderwerp per stap), sticky voettekst met Vorige/Volgende, stapindicator "4 / 8 — Omschrijving", Installatie slaat "Facturatie" over.
- Validatie per stap met duidelijke zin ("Selecteer minstens één oorzaak storing").
- Foutstaat "Ongeldig ticketId"/outbox-banner is zichtbaar en heeft een actie (Opnieuw proberen); outbox-idee (offline-veilig) is sterk.
- Bottom-sheet-patroon voor ticketdetail (duimbereik, sluit met Escape, slide-up).
- Globale `:focus-visible` (2px accent) bestaat; alle knoppen hebben een naam (title of tekst); geen `<img>` zonder alt.
- Geen "Alleen dark": licht/donker schakelt en wordt onthouden.

## B. Problemen per scherm

### Startscherm / kalender (week)
1. **Sticky-stapel eet 22–32 % van het scherm** [nieuw] — topbar-sticky 93px + outbox-banner 86px (enkel bij openstaand item) + kal-header 82px = 261px van 812 (32 %); zonder outbox 175px (22 %). Op een gsm in landschap of met toetsenbord blijft bijna niets over. Hoog/Middel. Voorstel: kal-header niet sticky op < 600px (of week/maand-schakelaar en datumnavigatie samenvoegen in één rij van ~48px); outbox-banner inklappen tot één regel ("⏳ 1 rapport wacht — Details") die pas op tik uitklapt. S–M.
2. **"×" op ticketkaart plant het ticket uit** [nieuw] — 17×20px, rechtsboven op elke kalenderkaart, zonder aria-label, zonder bevestiging, zonder undo (`removeTicketFromDate` → `/api/plan` date:null, ticket wordt weer "Service in te plannen" in Zoho). Een technieker die de kaart wil aantikken of wegscrollen raakt dit makkelijk; het is bovendien een coördinatorfunctie (de rest ervan is `.desktop-only`). Hoog. Voorstel: verbergen op < 1024px (klasse `desktop-only`), en op desktop confirm + "Ongedaan maken"-toast. S.
3. **Lege dagen nemen een half scherm in** [nieuw] — Ma en Di zonder afspraken = 2 × ~145px met een "—" van 11px; het eerste echte ticket staat pas op ~640px scrollpositie. Middel. Voorstel: lege dag als compacte rij (dagnaam + "Geen afspraken", ~44px) of standaard scrollen naar vandaag/eerste afspraak. S.
4. **Ticketkaart: fonts te klein** [nieuw] — adres 10,2px, badge "Wacht bevestiging" 9,4px, "(gepland 22:58)" 10,9px, Bellen/Navigeer-label 11,8px. Voor iemand met handschoenen/zonlicht/leesbril onleesbaar. Middel. Voorstel: adres ≥13px, badge ≥11px, knoplabels 14–15px. S.
5. **Kaart is niet focusbaar en heeft geen rol** [nieuw] — `.cal-ticket` tabindex −1, geen role=button; enkel muis/touch werkt. Laag (gsm) / Middel (WCAG 2.1.1). Voorstel: `role="button" tabindex="0"` + Enter/Space. S.
6. **Maandweergave onbruikbaar op gsm** [nieuw] — cellen 53×88px; afspraak toont "22:0…" (afgekapt), titel onzichtbaar, tik-doel ±14px hoog. Middel. Voorstel: maand op gsm = puntjes/badge per dag; tik op dag opent daglijst. M.
7. **Vernieuwen (↺) en licht/donker (🌙) zijn 32×32**, persoonskiezer 88×36, ‹ › 30×30, "Vandaag" 70×30, Week/Maand 55×25 en 61×25 [deels bekend: bestaande lijst-tikgroottes]. Hoog voor Week/Maand (25px) en ‹ › (30px). Voorstel: min 44×44 (padding, niet de icoongrootte). S.
8. **Persoonskiezer start op "Alle"** [nieuw] — een technieker ziet standaard collega's hun tickets (en Inventaris toont bij "Alle" niets nuttigs: "Nog geen bewegingen."). Subtitel "Persoonlijke planning" onder elke naam is nietszeggend. Middel. Voorstel: onthoud laatst gekozen persoon per toestel en vraag bij de eerste start "Wie ben je?"; verwijder de subtitel of maak hem "Toon enkel mijn planning". S.
9. **Achtergrondpagina scrolt door onder een open sheet** [nieuw] — bij het scrollen in het ticketdetail schuift `body` mee (scrollY 334 gemeten, geen scroll-lock). Sheet zelf past (572px). Laag/Middel. Voorstel: `body{overflow:hidden}` of `overscroll-behavior:contain` bij open overlay. S.
10. **Toast overlapt de wizard-voettekst** [nieuw, gedeeltelijk bekend als "toast kan kaart overlappen"] — toast staat vast op y 764–800, de wizard-footer (Vorige/Volgende) op 745–812: de validatie-toast ligt dus over "Volgende →" (232–357px) en verbergt het label 3,5 s. Middel. Voorstel: toast boven de footer plaatsen (bottom = footerhoogte + 12px) zolang de wizard open is. S.
11. **Toasts hebben geen aria-live/role=status** [nieuw] — schermlezer meldt "Rapport nog niet bevestigd…" niet. Laag/Middel (4.1.3). S.
12. **Thema-wissel duurt >1,5 s zichtbaar** [nieuw] — kleurmeting direct na wissel gaf mengkleuren (transitie op alle elementen); voelt traag en flitst. Laag. Voorstel: transitie op `body` weglaten of ≤150ms. S.

### Outbox-balkje
13. **Technische foutmelding + kleine knoppen** [nieuw] — "Ongeldig ticketId" is voor de technieker onbegrijpelijk; knoppen "Opnieuw proberen" 125×23px / "Annuleren" 79×23px, 11,5px; "Annuleren" (rood) staat pal naast "Opnieuw proberen" zonder bevestigingsstap in de balk zelf (outbox.js:162 heeft wel een `confirm()`). Hoog (gegevensverlies-risico + mistap). Voorstel: knoppen 44px hoog, "Annuleren" → "Verwijderen uit wachtrij" en secundair maken; foutzin vertalen: "Dit ticket bestaat niet meer in Zoho. Vraag de planner…". M.
14. Contrast "poging 1" 3,7:1 (donker) / 2,7:1 (licht); foutregel oranje op licht 1,9:1 — zie C.

### Ticketdetail (sheet)
15. **Telefoon/e-mail zijn kleine tekstlinks** [nieuw] — telefoon 80×16px, e-mail 75×16px (13px tekst). De grote "Bellen"-knop bestaat enkel op de kalenderkaart, niet in het detail. Hoog (bellen is primaire actie). Voorstel: "📞 Bel Luc Wouters" als vlakke knop 48px bovenaan de sheet, naast "🧭 Navigeer"; tekstlinks blijven als secundair maar met 44px rij. S.
16. **Actieknoppen onderaan zijn 33px hoog, 13px tekst** [nieuw] — "⏱️ Aankomst / 📷 Foto's / 📋 Rapport / 📅 Datum/tijd" (113/89/100/115×33px), verspreid over twee rijen. "Rapport" is dé primaire actie van de technieker maar is visueel gelijk aan "Datum/tijd" (een coördinatoractie). Hoog. Voorstel: "📋 Rapport maken" volledige breedte, 52px, accentkleur; Aankomst/Foto's als 2 gelijke knoppen 48px; "Datum/tijd" verbergen voor technieker of naar "⋯ Meer". S.
17. **Sluiten-knop 28×28** [nieuw] (`.mhdr-close`), rechtsboven — buiten duimbereik. Middel. Voorstel: 44×44 raakvlak + ook sluiten via slepen/tik op achtergrond (tik-op-achtergrond werkt al). S.
18. **Prioriteit/status-tags 10,2px** (`.mtag`), sectiekoppen 10,2px in muted grijs (3,4:1). Laag/Middel. S.
19. **Aankomst registreren overschrijft met `confirm()`** ("Aankomst al geregistreerd om … Overschrijven?") — native dialoog met knoppen OK/Annuleren. Laag. Voorstel: eigen dialoog met "Overschrijven / Behouden". S.

### Foto's-sheet
20. **Geen padding** [nieuw] — `#foto-modal` heeft padding 0 (de `.modal` krijgt normaal padding via `.mhdr`/`.mbody`, dit modal niet): tekst "Nog geen foto's toegevoegd." en knop "+ Foto toevoegen" plakken tegen de linkerschermrand (x=0–1px); sluitknop 27×27. Middel (visueel afgewerkt oogt het niet). Voorstel: `#foto-modal{padding:18px 20px}`. S.
21. **Bestandsinput zonder `accept="image/*"`/`capture`** [nieuw] — `<input type="file" id="foto-file-input" multiple>` en `#wiz-foto-file-input`: op gsm toont de kiezer alle bestandstypes i.p.v. rechtstreeks camera/galerij. Middel. Voorstel: `accept="image/*"` (en desgewenst een tweede knop "📷 Neem foto" met `capture="environment"`). S.
22. "+ Foto toevoegen" 139×33px, 13px [nieuw]. Middel. S.

### Rapport-wizard
23. **"🖨️ Afdrukken / PDF" verstuurt en sluit de wizard** [nieuw, Hoog] — de laatste knop opent een afdrukvenster (geblokkeerd → "Pop-upblokkering actief", zie [bekend]) én archiveert het rapport, zet het in de outbox, pusht acties naar Zoho ("Oplossing"), boekt voorraad af en sluit de wizard. De technieker verwacht een preview/print. Bij het incident hierboven gebeurde dit zonder enige bevestiging of samenvatting. Voorstel: laatste stap = samenvatting ("Controleer je rapport") + knop "✓ Rapport versturen"; PDF/afdrukken als secundaire knop "Bekijk PDF". M.
24. **Geen concept-opslag** [nieuw, Hoog] — geen `draft`/localStorage in rapport-wizard.js. ✕ (25×28px) toont `confirm('Rapport sluiten? Niet-opgeslagen wijzigingen gaan verloren.')`; wordt de pagina op gsm herladen (geheugen, app-wissel naar camera of Bellen) dan is alles weg. Voorstel: bewaar `R` bij elke stapwissel/`input` in localStorage per ticket en bied "Verder waar je bleef" aan. M.
25. **Sluitknop ✕ 25×28** naast de titel; mistap = confirm-dialoog. Middel. Voorstel: 44×44, en verplaats naar links-boven met tekst "Sluiten". S.
26. **"Technieker Blitz" leeg** [nieuw] — veld is niet voorgevuld uit de gekozen persoon (Tim) terwijl dat bekend is; ook geen `autocomplete`/`autocapitalize="words"`. Middel. Voorstel: voorinvullen, bij bekende persoon read-only. S.
27. **Validatie zonder veldmarkering** [nieuw] — bij ontbrekende oorzaak enkel toast (die bovendien over de knop ligt, zie 10); het veld krijgt geen rode rand, de pagina scrollt niet naar de fout. Middel. Voorstel: inline melding onder "Oorzaak storing" + `scrollIntoView`. S.
28. **Stapindicator is 7px stippen, niet aanklikbaar**; label "1 / 8 — Algemeen" 11,2px; veldlabels 10,4px, uppercase, muted (3,4:1). Laag/Middel. Voorstel: label 13px, kleur `--text2`. S.
29. **Stap "Onderdelen": tag-chips 20px hoog, 11,5px** [nieuw] — "1000", "1000A", "11kW", "40A", "4P", "5m", … zijn ruwe tags zonder uitleg; 42–55×20px = zeer mistap-gevoelig. Zoekveld 14,4px (iOS zoomt in; `.wiz-cat-search` overschrijft 16px), aantal-veldje 14px, `Vrije regel` knop 38px. Hoog. Voorstel: chips 36–40px hoog met horizontale scroll in één rij, of vervangen door categorie-keuze ("Controllers / Kabels / CT-klemmen"); alle invoervelden in deze stap 16px. S–M.
30. **Dubbele/tegenstrijdige CSS** [nieuw, technisch] — `.wiz-part-omschr`, `.wiz-part-prijs`, `.wiz-part-del`, `.wiz-part-bottom` staan twee keer in wizard.css; de tweede (later) versie wint en zet lettergrootte terug op 14px en hoogte weg. Laag maar oorzaak van #29-achtige regressies. S.
31. **Nummervelden zonder `inputmode`** [nieuw] — `type="number"` (aantal laadpalen, aanrijtijd, aantal onderdelen, prijs) zonder `inputmode="numeric"`/`"decimal"`: Android toont dan soms een volledig toetsenbord met minteken; prijs met komma (BE) werkt slecht met `step="0.01"`. Laag/Middel. Voorstel: `inputmode="numeric"` resp. `"decimal"`. S.
32. **Handtekening-stap**: doek min 230px (goed), "Wissen" 73×40px, hintkleur #bbb op wit (1,9:1, maar decoratief). Laatste stap: knoppen wrappen naar 57px hoog omdat de label "🖨️ Afdrukken / PDF" lang is. Laag. S.
33. **Aanrijtijd-berekening start automatisch bij openen** ("📡 Aanrijtijd berekenen…", `/api/optimize` + `/api/route`): geen voortgang in de wizard, enkel toast; op traag mobiel netwerk onduidelijk wat er wacht. Laag. Voorstel: klein statusregeltje bij het veld Aanrijtijd. S.
34. **Popupblokkering bij rapport/PDF** [bekend] — bevestigd: `window.open(blobUrl)` toont "Pop-upblokkering actief — sta pop-ups toe voor deze pagina" (in het incident geblokkeerd). Zie #23 voor de aanbevolen ombouw.

### Ingepland-tab
35. **Kaart zonder Bellen/Navigeer** [nieuw] — de lijstkaart (`#1006`, tijd, klant, adres) heeft geen actieknoppen; er is een extra tik + de detailsheet nodig. Tijd staat er nu wel bij (winst uit v1.6.0). Middel. Voorstel: dezelfde twee knoppen (44px) als op de kalenderkaart. S.
36. **Tab-badge "1"/"25"** tellen niet hetzelfde: "Inventaris 25" is het aantal artikelsoorten, geen alarm; oogt als openstaande taken. Laag. Voorstel: badge enkel voor lage voorraad/nieuw. S.
37. Het `Ingepland`-scherm toont enkel *bevestigde* tickets; het wacht-bevestiging-ticket van woensdag staat enkel in de kalender. Onduidelijk voor de technieker waarom hij het niet in "Ingepland" ziet. Laag. Voorstel: sectiekop "Wacht op bevestiging" toevoegen of hernoemen naar "Bevestigd". S.

### Inventaris (technieker)
38. **Edit-modus: −/+ en 🔔 zijn 28×28px, aantalveld 52×26 op 13,6px, geen `inputmode`** [nieuw] — voor iemand in een camionette schrikwekkend klein; iOS zoomt in bij de aantalinvoer. Hoog. Voorstel: 44×44 stepper-knoppen, invoer 16px + `inputmode="numeric"`. S.
39. **Opslaan/Annuleren staan bovenaan en scrollen weg** [nieuw] — bij 25 rijen (≈1400px) moet de technieker terug naar boven scrollen om "✓ Opslaan" (98×32px) te tikken. Hoog. Voorstel: sticky actiebalk onderaan zolang er wijzigingen zijn ("2 wijzigingen · Annuleren · Opslaan"). S–M.
40. **Geen zoekveld/filter op 25 artikelen**, geen sortering op "laag/0 eerst"; alle rijen tonen rood "0" in testdata dus geen onderscheid. Middel. Voorstel: zoekveld + chip "Enkel lage voorraad". M.
41. **Knop "✏️ Edit"** — Engels, 73×31px [nieuw]. Middel. Voorstel: "✏️ Voorraad aanpassen". S.
42. **🔔 enkel via `title`** ("Lage-voorraadmelding voor dit item uitschakelen") — tooltips bestaan niet op touch en er is geen `aria-label`. Middel. Voorstel: `aria-label` + korte tekst "Melding aan/uit" in de rij of uitlegregel bovenaan. S.
43. Exportbalk (twee datumvelden 128×27px 12px + "📊 Excel export" 122×32px) staat op gsm bovenaan zonder uitleg; datumvelden 12px (iOS-inzoom). Laag (technieker exporteert zelden). Voorstel: verbergen op gsm. S.
44. Lege staat "Nog geen bewegingen." zonder uitleg (bij "Alle"). Zie D.

### 414 breed
45. Geen extra problemen: scrollWidth = 414 in alle tabs; topbar en tabbalk passen; de kaarten en de outbox-balk schalen. De sticky-stapel (#1) blijft even hoog (93+86+82). Tablet-indeling ontbreekt nog [bekend]; "Opslaan Klantbeschikbaarheid" en "Blokkade opheffen" [bekend] zijn niet in de technieker-weergave zichtbaar getest (coördinatorfuncties).

### Bekend — status bevestigd
- Pop-upblokkering bij rapport openen op mobiel: **nog zo** (toast bij `window.open`; oplossing in #23).
- Bellen/Navigeer 44px: **opgelost** op kalenderkaart, **niet** in ticketdetail (#15) en Ingepland-lijst (#35).
- Prioriteit NL: **opgelost** (Middel).
- Tablet-indeling: niet getest (buiten scope), bekend.

## C. Toegankelijkheid (WCAG 2.1 AA)
Contrast, gemeten (kleur op achtergrond):
| Element | Thema | Ratio | Vereist | OK? |
|---|---|---|---|---|
| `--muted` #6b7784 op surface #1d252d (adres 10,2px, dagkop DI, "poging 1", "—") | donker | 3,4–3,7:1 | 4,5 | Nee |
| `--muted` #8896a8 op wit (tab "Ingepland", ‹/×, Week/Maand, adres, dagkop) | licht | 3,0:1 | 4,5 | Nee |
| accent #00dfa3 op wit (dag "MA" vandaag 1,74:1; badge "Bevestigd" 1,74:1; outbox #1004/stap 1,55:1; avatar "T" 1,61:1) | licht | 1,5–1,7:1 | 4,5 | Nee (hoog: buitengebruik bij zon = licht thema) |
| oranje #f59e0b op wit (badge "Wacht bevestiging" 2,15:1; outbox-fout 1,9:1) | licht | 1,9–2,2:1 | 4,5 | Nee |
| rood #ff5a52 op licht (outbox "Annuleren" 2,84:1) | licht | 2,8:1 | 4,5 | Nee |
| oranje op donker (outbox-fout) | donker | 7,8:1 | 4,5 | Ja |
| toast #d9d9d6 op #2b3542 | donker | 8,8:1 | 4,5 | Ja |
| wizard Volgende zwart op accent | beide | 12,1:1 | 4,5 | Ja |
| kal-meta/`cal-sub` primaire tekst | donker | 11:1 | 4,5 | Ja |
Voorstel licht thema: accenttekst → donkerder groen (#007a58 ≈ 5,3:1 op wit), oranje tekst → #b45309 (≈ 5,0:1), muted → #5b6878 (≈ 5,6:1); in donker muted → #8b97a5 (≈ 5,6:1). S.

Tikdoelen (2.5.5, doel ≥ 44×44) — onder de grens: ↺ 32×32, 🌙 32×32, persoonskiezer 88×36, tabs 40px hoog, Week/Maand 25px, ‹ › 30×30, Vandaag 30px, kaart-× 17×20, sheet-✕ 28×28, wizard-✕ 25×28, telefoonlink 80×16, e-maillink 75×16, adreslink 183×35, Aankomst/Foto's/Rapport/Datum 33px, outbox-knoppen 23px, foto-knop 33px, inventaris −/+/🔔 28×28, aantalveld 52×26, "Edit" 31px, tag-chips 20px. Wel OK: Bellen/Navigeer 44, wizard Vorige/Volgende 44, wizard-invoer 48, radio-kaarten 50.

Lettergrootte in invoerveld < 16px (iOS zoomt in): wizard-zoekveld 14,4px; wizard-aantal 14px; inventaris-aantal 13,6px; export-datumvelden 12px; ticketdetail-klantbeschikbaarheid-velden 12,8px (coördinator, code index.html:5582); man-input 13,1px. Wizard hoofdvelden zijn wel 16px.

Overig:
- 1.3.1/2.4.1/2.4.6: geen `<main>`, `<nav>`, `<h1>`/`<h2>` (alleen 2 × h3); tabs zijn `<div class="tab">` zonder `role="tab"`/`tabindex`/toetsenbord (2.1.1, 4.1.2). S.
- 4.1.2: sheets en wizard hebben geen `role="dialog"`/`aria-modal`, geen focus-trap of focus-terugkeer. S–M.
- 4.1.3: toast zonder `role="status"`/`aria-live="polite"`. S.
- 2.4.7: globale `:focus-visible` OK, maar 12 `:focus{outline:none}`-regels (o.a. `.wiz-part-omschr`, `.wiz-cat-search`, `.man-input`, `.av-time-input`) hebben geen vervangend zichtbaar focusteken (enkel border-kleur in sommige). S.
- 1.4.4/1.4.10: geen viewport-blokkade (`user-scalable` niet uitgeschakeld) — goed; tekst schaalt niet mee bij grotere systeemlettergrootte omdat veel px/rem-waarden 0,6–0,7rem zijn: test op 130 % systeemtekst nodig. Middel.
- 2.3.3: geen `prefers-reduced-motion` (slide-up, spring, thema-transitie). Laag. S.
- 1.1.1/4.1.2: emoji als enige label zonder `aria-label`: ‹ › (datumnavigatie), ✕ in foto-/wizardsheet (wizard-✕ geen naam), 🔔 (enkel title), "×" op kaart. S.
- 2.5.3: zichtbaar label "📞 Bellen" bevat emoji vooraan — schermlezer leest "telefoon Bellen"; OK maar `aria-hidden` op emoji netter. Laag.
- iOS/Android: geen `env(safe-area-inset-*)`; `.modal max-height:90vh` en `#import-modal 100vh` rekenen niet mee met de adresbalk (dvh). Laag/Middel bij PWA-standalone. S.

## D. Copy / microcopy
| Nu | Probleem | Beter |
|---|---|---|
| "🖨️ Afdrukken / PDF" (laatste wizardstap) | Verzwijgt dat het rapport wordt verzonden, gearchiveerd en de wizard sluit | Knop "✓ Rapport versturen" + secundair "Bekijk PDF" |
| "Pop-upblokkering actief" / "Pop-upblokkering actief — sta pop-ups toe voor deze pagina" | Twee verschillende teksten voor hetzelfde; onduidelijk wat er gebeurt met het rapport | "Het PDF-venster werd geblokkeerd. Je rapport is wel bewaard. Sta pop-ups toe om de PDF te zien." |
| "Rapport sluiten? Niet-opgeslagen wijzigingen gaan verloren." (OK/Annuleren) | Native dialoog, knoppen zeggen niets | Eigen dialoog: "Rapport verlaten?" · "Je invoer wordt bewaard als concept." · [Verder invullen] [Verlaten] |
| "⏳ Rapport nog niet bevestigd — wordt automatisch opnieuw geprobeerd" | Vaag: wat is niet bevestigd, door wie, wat moet ik doen? | "Rapport staat klaar om te versturen. We proberen opnieuw zodra je verbinding hebt. Je hoeft niets te doen." |
| "Ongeldig ticketId" (outbox) | Ontwikkelaarstaal | "Dit ticket werd niet gevonden in Zoho. Meld dit aan de planner." |
| "⏳ PDF naar Zoho versturen (2/2)" / "poging 1" | Jargon (Zoho, poging) | "Rapport #1004 wordt verstuurd (stap 2 van 2)" / "1e poging" |
| "Annuleren" (outbox) | Onduidelijk: annuleert het rapport? | "Verwijderen uit wachtrij" (met bevestiging: "Het rapport gaat verloren. Zeker?") |
| "Opnieuw proberen" | Prima, maar knop te klein | Behouden, groter |
| "⚠️ Selecteer minstens één oorzaak storing" | Goed, maar enkel toast | Inline onder het veld: "Kies minstens één oorzaak." |
| "⚠️ Kan niet doorgaan naar de volgende stap" | Zegt niet waarom | "Vul eerst de verplichte velden in (gemarkeerd)." |
| "📡 Aanrijtijd berekenen..." | Neutraal, maar toast overlapt | Statusregeltje bij veld: "Aanrijtijd wordt berekend…" |
| "✏️ Edit" | Engels | "✏️ Voorraad aanpassen" |
| "Nog geen bewegingen." (Inventaris bij "Alle") | Geen uitleg, "bewegingen" is jargon | "Kies bovenaan je naam om jouw voorraad te zien." |
| Tab "Inventaris 25" | Badge suggereert taken | "Voorraad" (zonder badge) of badge enkel bij lage voorraad |
| "Persoonlijke planning" (onder elke naam in de persoonsmenu) | Nietszeggend | "Toon enkel de planning van Tim" of weglaten |
| "Alle" (persoonskiezer) | Voor technieker verwarrend | "Iedereen (planner)" of standaard eigen naam |
| "Wachten op bevestiging planning" (status-tag in detail) + "Wacht bevestiging" (kaart) | Twee formuleringen | Eén: "Wacht op klant" |
| "+ Foto toevoegen" | Goed; mist context | "📷 Foto toevoegen" (opent camera/galerij) |
| "Nog geen foto's toegevoegd." | OK | "Nog geen foto's. Voeg foto's toe van de storing en de oplossing." |
| "Aankomst al geregistreerd om 14:05. Overschrijven?" (OK/Annuleren) | Native OK/Annuleren | Eigen dialoog: [Overschrijven] [Behouden] |
| "Technieker Blitz" (veldlabel) | Ambigu | "Jouw naam" (voorgevuld) |
| "#ZOHO" (veldlabel) | Jargon | "Ticketnummer" |
| "Interventie adres" | Woordvolgorde | "Adres van de interventie" |
| "Starttijd (aankomst)" / "Stoptijd (einde)" | OK | "Aangekomen om" / "Klaar om" |
| "⏳ Rapport wordt verstuurd — je kan gewoon verder, dit gebeurt op de achtergrond" | Goed toon | Behouden |
| "📶 Geen internetverbinding — wijzigingen worden niet opgeslagen in Zoho" | Alarmerend en niet actiegericht voor technieker | "Geen verbinding. Je rapport wordt bewaard en verstuurd zodra je weer online bent." (indien outbox dat dekt; anders scherper) |

### Prioriteitenlijst (aanbeveling voor Brent)
1. Wizard laatste stap: samenvatting + "Rapport versturen" (#23) en concept-opslag (#24).
2. "×" op de kalenderkaart verbergen/beveiligen (#2).
3. Ticketdetail: grote Bel/Navigeer + Rapport-knop ≥ 48px, Datum/tijd weg voor technieker (#15, #16).
4. Inventaris-edit: grote −/+, sticky Opslaan, zoekveld, 16px invoer (#38–#40).
5. Contrast in licht thema (accent/oranje/muted) — technieker werkt buiten (C).
6. Sticky-stapel verkleinen en outbox-balk inklappen (#1, #13).
7. Toast boven wizard-footer plaatsen (#10), foto-sheet padding (#20), `accept="image/*"` (#21).
