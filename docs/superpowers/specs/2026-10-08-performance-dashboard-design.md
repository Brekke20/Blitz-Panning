# Performance-dashboard — ontwerp

**Datum:** 2026-10-08
**Tak:** `refactor` (nieuwe functionaliteit)
**Status:** ontwerp goedgekeurd door Brent in chat (2026-10-08), spec ter review
**Volgorde:** deelproject 4 van 4 — op de beheerpagina (`2026-10-08-logins-beheer-design.md`),
enkel rol beheerder. Gebruikt de lichte rapportenlijst uit de upload-fix
(`2026-10-08-rapport-achtergrond-upload-design.md`, `main` v1.10.2) en de sales-gegevens
(`2026-10-08-sales-planner-design.md`).

## Doel

Brent wil inzicht in hoe de service draait: hoe lang interventies duren, welke onderdelen veel
vervangen worden, hoe vaak men op tijd is, de kwaliteit van het werk, en de resultaten van sales.

## Beslissingen (Brent, 2026-10-08)

- Groepen: Tijd & stiptheid, Kwaliteit, Onderdelen, Klant & planning, Sales.
- **Niet:** doorlooptijd "ticket aangemaakt → interventie uitgevoerd" (heropende oude tickets
  verstoren die telling; geen prioriteit).
- **Elk percentage** als ring (donut) met het percentage in het midden, gekleurd groen/oranje/rood
  volgens instelbare grenzen. Sales-resultaten als ringdiagram met een eigen kleur per resultaat
  en een legende. Alles in de stijl van de rest van het dashboard.

## Filters

Periode (deze maand / vorige maand / kwartaal / jaar / zelf kiezen), technieker, type laadpaal.
Elke kerncijfer-tegel toont het verschil met de vorige, even lange periode (↑/↓).

## Metrics

**Kerncijfers (tegels):** aantal interventies · gemiddelde duur · % op tijd (ring) ·
% first-time-fix (ring) · aantal herhaalbezoeken · waarde gebruikte onderdelen.

| Blok | Metric | Bron / definitie |
|---|---|---|
| ⏱️ Tijd & stiptheid | Gemiddelde duur per type laadpaal, oorzaak, technieker, interventie vs installatie | `rapportData.werktijd` (anders `stop − start`); `type`, `oorzaakStoring`, `technieker`, `interventieType` |
| | % op tijd, per technieker (ringen), met de verdeling te vroeg / op tijd / te laat | `rapportData.start` t.o.v. `geplandTijdslot` (nieuw veld, zie hieronder): vóór het slot = te vroeg, erin = op tijd, erna = te laat; de ring toont % op tijd. Rapporten zonder dat veld tellen niet mee voor deze metric (beslissing opdrachtgever, 2026-10-08) |
| | Rijtijd vs werktijd per dag | `aanrijtijdMin` (geschat via route) vs `werktijd` |
| | Interventies per dag per technieker | aantal rapporten per `datum` + `technieker` |
| ✅ Kwaliteit | % first-time-fix, per technieker en type laadpaal (ringen) | `hersteld === 'ja' && nieuwInter === 'nee'` |
| | Herhaalbezoeken | zelfde `serienummer` (anders zelfde genormaliseerd `adres`) binnen 30 of 90 dagen (schakelaar); lijst met doorklik naar de rapporten |
| | Top-oorzaken, per type laadpaal | `oorzaakStoring` |
| 🔧 Onderdelen | Top 10 onderdelen (aantal, waarde) | `rapportData.onderdelen` × prijslijst |
| | Verbruik per maand, per technieker, per type laadpaal | idem, gegroepeerd |
| 📅 Klant & planning | Bevestigingssnelheid voorstel | voorstelregister: verstuurd → bevestigd |
| | % bevestigd via de knop (ring) | voorstelregister / bevestigingslink-audit |
| | Aantal annulaties | activiteitenlog van de logins (actie `annulatie`), enkel vanaf de livegang van de logins (er is geen annulatieregister) |
| | Garantie vs klant (ring), waarde onderdelen + loon | `facturatie`, onderdelen × prijs, `berekenLoonkost` |
| | % installateur al langs geweest (ring), per partner/regio | Zoho-ticketveld "Installateur al langs geweest" (`cf_installateur_al_langs_geweest`, Ja/Nee), bij het maken van het rapport bewaard als `rapportData.installateurAlLangsGeweest` (geen nieuwe rapportvraag; beslissing opdrachtgever, 2026-10-08); `partner`, `regio` van het ticket |
| 💼 Sales | Bezoeken per verkoper per week | `sales/<id>.leads[].bezoeken` |
| | Resultaten (ringdiagram: offerte / verkocht / geen interesse / opnieuw langsgaan) | idem |
| | Leads die wachten en hoe lang | status `te-plannen` + `geimporteerdOp` |

Welke bron precies het voorstel- en annulatieregister levert (bestaande `voorstelregister.js`,
`annulatie.js`), wordt in het bouwplan vastgesteld; ontbreekt een tijdstip, dan valt die metric
weg in plaats van geschat te worden.

## Nieuwe gegevens die vanaf livegang bewaard worden

- **`geplandTijdslot: { van, tot }`** in `rapportData` bij het maken van een rapport: het
  tijdslot dat aan de klant voorgesteld werd (of, zonder voorstel, het geplande uur ± de
  standaard tijdslotbreedte). Nodig voor "% op tijd"; oudere rapporten hebben het niet.
- **`installateurAlLangsGeweest`**, **`partner`** en **`regio`** in `rapportData`: de waarden van het Zoho-ticket op het moment van het rapport (voor `installateurAlLangsGeweest`: `'Ja'`/`'Nee'`/`''`); oudere rapporten hebben ze niet en tellen in die metrics niet mee.
- **Rapportenlimiet (ruling controller, 2026-10-08):** de actieve lijst blijft op 500 lichte entries
  (snel te herschrijven, klein lost-update-venster). Entries die eruit vallen gaan naar een append-only
  jaar-archief `rapportlijst-archief-<jaar>`; het dashboard leest de actieve lijst plus de archieven die
  de gekozen periode bestrijken. Historiek begint dus bij de livegang van het archief.

## Kleurgrenzen (instelbaar op de beheerpagina, tab Performance)

| Metric | Groen | Oranje | Rood |
|---|---|---|---|
| % op tijd | ≥ 90 % | 75–90 % | < 75 % |
| % first-time-fix | ≥ 80 % | 65–80 % | < 65 % |
| Overige percentages | standaard neutraal (geen oordeel), per metric instelbaar |

De groen/oranje/rood-kleuren en de categoriekleuren van het sales-ringdiagram worden gekozen in
lijn met de huisstijl (Blitz-groen) en gecontroleerd op leesbaarheid in licht/donker en voor
kleurenblindheid (de waarde staat altijd als getal in de ring, kleur is nooit de enige drager).

## Architectuur

- `GET /api/dashboard?van&tot&technieker&type` (enkel beheerder) berekent de cijfers server-side
  uit de lichte rapportenlijst, prijslijst, voorstel-/annulatieregister en sales-blobs, en geeft
  kant-en-klare reeksen terug. De rekenregels staan in een pure module
  (`netlify/lib/dashboard-metrics.js`) zodat ze zonder Blobs getest kunnen worden.
- Client: `schermen/beheer-performance.js` tekent tegels, ringen en grafieken met inline SVG
  (geen nieuwe grafiekbibliotheek nodig voor ringen/staven/lijnen).

## Testen

- Automatisch: elke metric-definitie op een vaste testset (incl. randgevallen: geen rapporten,
  rapport zonder `geplandTijdslot`, rapport zonder serienummer, middernacht-overschrijdende
  werktijd), kleurgrenzen, vergelijking met vorige periode.
- Playwright (testmodus): beheerder ziet het dashboard, andere rollen krijgen `403`; filters
  wijzigen de cijfers; ringen tonen het juiste percentage en de juiste kleur.
