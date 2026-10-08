# Sales-planner — ontwerp

**Datum:** 2026-10-08
**Tak:** `refactor` (nieuwe functionaliteit)
**Status:** ontwerp goedgekeurd door Brent in chat (2026-10-08), spec ter review
**Volgorde:** deelproject 3 van 4 — steunt op de logins (`2026-10-08-logins-beheer-design.md`:
rol `sales`, `salesNaam`, `magAlleSales`, centrale instellingen) en op het planner-brein
(`public/js/planner.js`, spec `2026-09-30-planner-brein-design.md`).

## Doel

Een planner per verkoper, die werkt zoals de planner voor de techniekers, maar:
- leads komen uit een **JSON-export** van hun sales-tool, niet uit Zoho;
- leads hebben vaak **enkel een postcode**; het volledige adres komt later;
- geen stock, geen Zoho, geen mails vanuit de app.

## Beslissingen (Brent, 2026-10-08)

| Onderwerp | Keuze |
|---|---|
| Wie plant | Elke verkoper zelf; beheerder (en verkopers met "mag alle sales zien") bekijken iedereen |
| Herimport | **Samenvoegen**: nieuwe leads erbij, bestaande (zelfde e-mail of gsm) niet dubbel, ingevulde gegevens/planning blijven; verdwenen leads blijven staan tot de verkoper ze wegklikt |
| Afspreken | Planner stelt voor ("voorgesteld"), verkoper belt en zet het uur vast ("bevestigd"); geen mails |
| Manueel uur | Verkoper kan bij elke lead zelf een dag + uur vastleggen (ook als die nog niet ingepland was); de planner plant daarrond en verschuift het nooit |
| Na het bezoek | Kort resultaat: Offerte / Verkocht / Geen interesse / Opnieuw langsgaan + optionele notitie |
| Privacy | Leads enkel achter login; verwijderen = echt weg; afgewerkte bezoeken 12 maanden bewaard, dan automatisch gewist |

## Exportformaat (voorbeeld: `planningsexport_Ward_Houwen_2026-10-08.json`)

```json
{
  "geexporteerdOp": "2026-10-08T10:24:18.039Z",
  "verantwoordelijke": "Ward Houwen",
  "statussen": ["Nieuw", "1e contactpoging gedaan", "2e contactpoging gedaan"],
  "aantal": 19,
  "leads": [ { "naam": "…", "voornaam": "…", "gsm": "+32 4xx xx xx xx", "email": "…", "adres": "3640" } ]
}
```

Inlezen (`public/js/sales/import.js`, pure functie, getest):
- Verplicht: `leads` is een array; max. 500 leads per bestand; bestand max. 2 MB.
- `adres`: enkel 4 cijfers → **postcode-only**. Anders poging tot ontleden als
  "straat nr, 1234 gemeente" → **volledig adres**; lukt dat niet, dan bewaard als vrije tekst en
  gemarkeerd "adres nakijken".
- **Herkenning bestaande lead:** e-mail (lowercase, getrimd); anders gsm (enkel cijfers, met `32`
  genormaliseerd). Een gsm met minder dan 9 cijfers (zoals `+32000000` in het voorbeeld) telt
  niet als herkenning.
- `verantwoordelijke` ≠ `salesNaam` van de ingelogde verkoper → waarschuwing "Deze export is van
  X. Toch inladen?" vóór er iets bewaard wordt.
- Na het inlezen: samenvatting "12 nieuw, 7 al aanwezig, 1 adres nakijken".
- `statussen`/`aantal` worden niet gebruikt (enkel getoond in de importsamenvatting).

## Datamodel (Netlify Blobs, store `blitz-data`, `consistency: 'strong'`)

| Key | Inhoud |
|---|---|
| `sales/<gebruikerId>` | `{ versie, leads: [Lead], blokken: [Blok] }` — één blob per verkoper (geen botsingen tussen verkopers) |
| `postcode-cache` | `{ [postcode]: { lat, lon, gemeente } }` — middelpunt per Belgische postcode, één keer opgezocht |

```
Lead {
  id, voornaam, naam, gsm, email,
  postcode, gemeente, straat?, huisnr?, adresTekst?,
  locatie: { lat, lon, bron: 'postcode' | 'adres' } | null,
  notitie?, duurMin?,                        // leeg = standaard bezoekduur van de verkoper
  status: 'te-plannen' | 'voorgesteld' | 'bevestigd' | 'afgewerkt',
  planning?: { datum, start, vast: boolean }, // vast = door verkoper vastgelegd uur
  resultaat?: { soort: 'offerte'|'verkocht'|'geen-interesse', notitie?, op },
  bezoeken: [{ datum, resultaat: 'offerte'|'verkocht'|'geen-interesse'|'opnieuw', notitie?, op }], // historiek per bezoek
  geimporteerdOp, bronExport: { verantwoordelijke, geexporteerdOp }
}
Blok { id, datum, start, eind, omschrijving, soort: 'verlof'|'kantoor'|'afspraak', lat?, lon? }
```

Optimistische locking op `versie` (zoals `afspraken.js`).

## Serverfuncties

| Functie | Wat | Rol |
|---|---|---|
| `GET /api/sales` | eigen blob; `?gebruiker=<id>` voor beheerder / `magAlleSales` | sales, beheerder |
| `POST /api/sales-import` | export samenvoegen (server herhaalt de herkenning, zodat twee toestellen niet dubbel importeren) | sales (eigen) |
| `PATCH /api/sales` | lead of blok wijzigen (adres, notitie, duur, planning, status, resultaat) | sales (eigen), beheerder |
| `DELETE /api/sales?lead=<id>` | lead echt verwijderen | sales (eigen), beheerder |
| `GET /api/postcode?pc=3640` | middelpunt postcode via TomTom (bestaande sleutel), met cache | sales, beheerder |

Adres-geocoding van een volledig adres gebruikt de bestaande geocoding-route (TomTom), ook met de
TOMTOM-sleutel server-side. Elke import, verwijdering en resultaat komt in het activiteitenlog.

Geplande functie (dagelijks): afgewerkte leads waarvan het laatste bezoek > 12 maanden oud is,
worden gewist (ook uit `bezoeken`).

## Schermen (rol sales)

Navigatie: **Te plannen** · **Kalender** · **Route** · **Afgewerkt**. Beheerder en
`magAlleSales` krijgen bovenaan een keuzelijst per verkoper (zoals de technieker-filter).
De weergave volgt de bestaande toestel-logica (gsm/tablet/computer).

1. **Te plannen** (`schermen/sales-lijst.js`)
   - Knop **Export laden** (bestandskiezer, `.json`).
   - Kaartjes: naam, gemeente + postcode, bel-knop (`tel:`), e-mail, label **enkel postcode** /
     **volledig adres** / **adres nakijken**, eventueel vast uur.
   - **✕** verwijderen: korte bevestiging, daarna 5 s "ongedaan maken" vóór de server-delete.
   - Zoeken (naam, gemeente, postcode) en filter op postcodegebied (eerste 2 cijfers).
   - Openklikken → detailvenster: straat, huisnr, postcode, gemeente; notitie; bezoekduur;
     **"Vast uur afspreken"** (datum + uur → `planning.vast = true`, status `bevestigd`);
     opgeslagen adres → opnieuw geocoderen, `locatie.bron = 'adres'`.
2. **Kalender** — het bestaande kalenderscherm met een sales-gegevensbron: voorgestelde bezoeken
   in een lichtere tint, bevestigde vol, blokken zoals eigen afspraken bij techniekers. Klik op een
   bezoek: bellen, navigeren, **Bevestigen** (uur vastzetten), **Terug naar te plannen**,
   **Resultaat**.
3. **Route** — het bestaande Route-scherm (kaart, volgorde, reistijden) met de sales-gegevensbron.
   Een bezoek met enkel een postcode krijgt op de kaart een gestippelde markering
   ("ongeveer — enkel postcode").
4. **Afgewerkt** — lijst met resultaat, datum, notitie; filter op resultaat en periode.

**Resultaat** (`schermen/sales-resultaat.js`): vier grote knoppen + notitie.
"Opnieuw langsgaan" → bezoek in `bezoeken`, status terug `te-plannen`, planning gewist.
De andere drie → status `afgewerkt`.

## Plannen

"Plan deze week" roept het **bestaande** planner-brein aan via een adapter
(`public/js/sales/planner-adapter.js`) die leads omzet naar kandidaten:

| Planner-brein | Uit lead |
|---|---|
| `id` | `lead.id` |
| `lat`, `lon` | `lead.locatie` (postcode-middelpunt of adres) |
| `duurMin` | `lead.duurMin ?? instellingen.bezoekDuurMin ?? 60` |
| `priority` | `'medium'` voor iedereen |
| `inPlanningSinds` | `lead.geimporteerdOp` (wie langer wacht, komt eerder aan bod) |
| bestaande stops met vast uur | leads met `planning.vast` of status `bevestigd` |
| eigen afspraken/blokkeringen | `blokken` |
| depot, werkdagen, werkuren, max. reistijd | centrale instellingen van de verkoper |

- Leads zonder locatie (postcode niet gevonden) krijgen de bestaande reden "adres niet gevonden".
- Geplaatste leads → status `voorgesteld`, `planning = { datum, start, vast: false }`.
- Opnieuw "Plan deze week" mag `voorgesteld`-bezoeken herschikken, nooit `bevestigd` of `vast`.
- Wijzigt een adres van postcode naar volledig adres, dan worden de route en de uren van die dag
  herberekend (de bestaande route-herberekening).
- Geen Zoho-aanroepen, geen voorstel-mails, geen stock in de sales-gegevensbron.

Bij het bouwplan wordt nagegaan welke delen van het kalender- en Route-scherm al los staan van de
ticket-gegevens; waar dat niet zo is, komt er een kleine gegevensbron-laag tussen
(tickets ↔ sales), zonder het technieker-gedrag te wijzigen.

## Testen

- Automatisch: import-ontleding (postcode-only, volledig adres, onleesbaar), herkenning (e-mail,
  gsm, placeholder-gsm), samenvoegen behoudt adres/planning, waarschuwing andere verantwoordelijke,
  adapter-omzetting, vast uur wordt nooit verschoven, opruiming na 12 maanden.
- Playwright (testmodus): export laden (het voorbeeldbestand, geanonimiseerd als testdata),
  lead verwijderen + ongedaan maken, adres invullen, vast uur zetten, "Plan deze week",
  bevestigen, resultaat ingeven, rol sales ziet geen tickets/stock, verkoper A ziet verkoper B niet.
