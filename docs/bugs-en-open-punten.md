# Bugs en open punten (gevonden tijdens de refactor)

Bijgehouden sinds oktober 2026. Status per punt: **opgelost op refactor** of **open**.
De live versie (`main`) krijgt enkel bugfixes; bij elk punt in deel A kan Brent kiezen of het
als losse bugfix al live moet, of wacht tot de refactor uitkomt.

## A. Fouten die nu in de live versie zitten — al opgelost op de refactor-tak

Kandidaten voor een losse bugfix op `main`.

| # | Wat gaat er mis (live) | Ernst | Opgelost in |
|---|---|---|---|
| A1 | Afspraken: slaat een collega op hetzelfde moment iets op, dan gaat jouw wijziging stil verloren (pagina herlaadt, enkel een melding). | Hoog: gegevensverlies | etappe 2 |
| A2 | "Oplossing → Zoho" toont soms "Oplossing kon niet automatisch bijgewerkt worden" terwijl het wél gelukt is (leeg antwoord van Zoho). | Middel | etappe 6 |
| A3 | Een onleesbaar serverantwoord (bv. Netlify-time-out, foutpagina 502) toont een technische tekst ("Unexpected token '<' … is not valid JSON") bij inplannen, toewijzen, verzetten, voorstel, rapport en oplossing. | Middel | etappe 5b |
| A4 | De routelijst ververst niet na "Toewijzen" of een nieuwe eigen afspraak, tot je op "Bereken tijden" klikt. | Laag | etappe 3 |
| A5 | "Bellen" op een gsm-kaartje in de kalender opent ook de ticketfiche. | Laag | etappe 4 |
| A6 | De wachtrij toont eindeloos "Laden..." als er geen tickets (meer) zijn. | Laag | etappe 4 |
| A7 | Mislukt het bewaren van de routevolgorde, dan verdwijnt de foutmelding meteen (overschreven door de telmelding). | Laag | etappe 5a |
| A8 | De tab Beschikbaarheden loopt vast als in de instellingen geen enkele werkdag is aangevinkt en er ≥ 2 blokkeringen in de toekomst staan. | Middel | etappe 5b |
| A9 | De klantvoorkeur-labels in de wachtrij ontbreken soms bij de eerste keer openen (klantbeschikbaarheid komt later binnen dan de wachtrij getekend wordt). | Middel | etappe 7 |
| A10 | Wagenvoorraad: past een collega tegelijk de voorraad aan, dan gaat de aftrek na een verzonden rapport stil verloren. | Middel | etappe 7 |
| A11 | Een hangende verbinding laat een knop of het annuleervenster eindeloos vast staan (geen tijdslimiet). | Middel | etappe 7 |
| A12 | Na een mislukte "Vernieuwen" kan de app oude (bewaarde) gegevens terugzetten. | Middel | etappe 7 |
| A13 | De TEST-badge in de kop was onzichtbaar in testmodus. | Laag | etappe 0/2 |
| A14 | (Enkel op refactor, nooit live: nieuw in etappe 7, I1.) De mailcontrole na een onzeker resultaat kon na een snelle fout (bv. verbinding valt na 1 s weg) vals "niet verzonden — veilig opnieuw" melden terwijl de serverfunctie nog tot 26 s doorwerkte en de mail alsnog vertrok: dubbele klantmail. Nu pas "niet verzonden" na een tweede controle 30 s na de start. | Hoog (op refactor) | etappe 7, finale fix A |
| A15 | (Enkel op refactor, nooit live: nieuw in etappe 7, I2.) De brede mailcontrole (rapport, annuleren) gebruikte de klok van het toestel als begintijd: liep die ook maar een seconde voor, dan werd een wél verzonden mail gemist (vals "niet verzonden"). Nu stuurt het toestel enkel de verstreken tijd en rekent de server met zijn eigen klok; de marge per adres is van 2 min naar 10 s (M11). | Hoog (op refactor) | etappe 7, finale fix A |

## B. Bekende fouten en ongemakken — nog NIET opgelost (beslissing nodig)

Deze zijn met tests vastgelegd zoals ze nu werken, zodat een oplossing later bewust gebeurt.

### Na een mail naar de klant (W11 — beslissing bij Brent)
| # | Wat gaat er mis |
|---|---|
| B1 | Werken twee mensen tegelijk aan hetzelfde voorstel (dubbel conflict), dan wordt niet bijgehouden dat het voorstel verstuurd is; de mail is wel vertrokken. Geen waarschuwing. |
| B2 | Faalt het voorstel ná het versturen van de mail met een duidelijke serverfout (bv. Zoho-update mislukt), dan geen waarschuwing "klant kan al gemaild zijn" en geen mailcontrole. |
| B3 | Annuleren: valt de server weg nádat de annulatiemail vertrokken is, dan blijft het ticket gepland. De melding raadt aan om in Zoho na te kijken. |
| B4 | Blijkt na een twijfelgeval dat de mail tóch vertrokken is, dan wordt het voorstel/rapport niet automatisch als "verzonden" aangevinkt (de app vraagt wel bevestiging bij opnieuw versturen). |

### Rapporten
| # | Wat gaat er mis |
|---|---|
| B5 | Na een serverfout bij rapport versturen blijft de verzendknop uitgeschakeld tot je de pagina herlaadt. |
| B6 | Mislukt een deel van de statusupdates, dan zie je enkel de laatste melding. |
| B7 | Rapportformulier zonder verbinding: foto's die al bij het ticket staan laden stil niet, en de aanrijtijd wordt stil 0. (Brent: formulier nu ongemoeid laten, na de release bekijken.) **Sinds etappe 7 (M3, release-vraag):** de centrale time-out van 20 s op `/api/optimize` en `/api/route` zet de aanrijtijd in de wizard na 20 s trage verbinding ook stil op 0 (de wizard bleef vroeger wachten), waardoor aanrijtijd en loonkost te laag kunnen zijn. De wizard is bewust niet aangepast (Q3); Brent beslist bij de release. |

### Beschikbaarheid, afspraken, instellingen
| # | Wat gaat er mis |
|---|---|
| B8 | Afwezigheid over meerdere dagen zonder einddatum bewaart maar één dag; een lege datum wordt zonder waarschuwing bewaard. |
| B9 | Blokkeringsvenster: de datum aanpassen laat ook de getoonde dag verspringen. |
| B10 | Eigen afspraak zonder adres: de fiche toont de notitie op de plaats van het adres. |
| B11 | Eigen afspraak zonder uur staat niet op de tijdlijn (computer). |
| B12 | Instellingen: een weekdag aanklikken en dan Annuleren houdt de wijziging toch even vast. |
| B13 | Prijsbeheer: na "+ Onderdeel" springt de cursor naar het verkeerde veld. |
| B14 | Blokkeringsvenster: wordt het venster opnieuw opgebouwd terwijl je typt, dan verspringt de cursor (de tekst blijft staan). |

### Planning
| # | Wat gaat er mis |
|---|---|
| B15 | "⚡ Plan deze week" plant in de maandweergave en in de dagweergave van een rechtop gehouden tablet een andere week dan je ziet. |
| B16 | Toewijzen stelt altijd 09:00 voor als uur. |
| B17 | Route slepen: komt er net een verversing binnen terwijl je sleept, dan wordt het slepen afgebroken (zeldzaam, bewust zo gelaten). |

## C. Open vragen voor Brent

| # | Vraag |
|---|---|
| C1 | Is "Geen tickets om in te plannen" een goede tekst voor de lege wachtrij? |
| C2 | B4: moet een rapport/voorstel automatisch op "verzonden" komen als de app de mail in Zoho terugvindt? |
| C3 | B15: moet "Plan deze week" altijd de week plannen die je ziet? |
| C4 | B7 (M3): is een stille aanrijtijd 0 na 20 s trage verbinding in de rapportwizard aanvaardbaar, of moet de wizard dan een melding tonen / langer wachten? |

## D. Te doen vóór de release (proefperiode)

- Mailcontrole één keer testen op een echt ticket in Zoho (formaat van de antwoorden van Zoho nakijken).
- Rapport-PDF (standaardPdf) handmatig testen.
- Excel-export van het inventarislogboek handmatig testen.
- Volledige releasechecklist: zie de release-checklist in `docs/`.
