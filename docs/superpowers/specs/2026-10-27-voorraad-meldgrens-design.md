# Meldgrens per product in de wagenvoorraad — ontwerp (2026-10-27)

## Aanleiding

Een technieker gebruikte al zijn energiemeters en kreeg geen melding. Tot nu toe was de enige "melding" het cijfer op het
tabblad Inventaris. Dat cijfer telde elk catalogusproduct op 0 met een belletje dat aanstond, en het belletje stond standaard
aan. Het cijfer zat dus vol producten die niemand meeneemt, en een product dat echt op raakte viel niet op. Er was ook geen
waarschuwing vóór een product op was.

## Beslissingen (Brent, 2026-10-27)

- **Per wagen een grens per product.** Brent: "sommige mogen pas een melding geven op 0, andere al vroeger."
- **Instellen kan alleen op pc en tablet.** Op de gsm zijn het belletje en de grens verborgen, zodat het scherm rustig blijft.
  Aantallen aanpassen kan wel.
- **Standaard geen melding.** Een product meldt pas iets als het belletje aanstaat.
- **Drie meldingen:**
  - bij elke opstart een korte melding "Check je voorraad" als er iets onder de grens zit;
  - "Bijna op" na het versturen van een rapport;
  - een gekleurd tabcijfer.
- **Geen overzicht bij "Alle technici"**: Brent koos die optie niet. De supervisorweergave blijft ongewijzigd.

## Datamodel

Een voorraadregel is `wagenvoorraad[technieker][materiaalId] = { aantal, gedempt, drempel }`.

- `drempel` is een geheel getal van 0 tot en met 999, of `null`. Met een getal meldt het product bij `aantal <= drempel`. `null` betekent geen melding.
- `gedempt` blijft bestaan en is altijd gelijk aan `drempel === null`. Een oudere client (2.3.0, gecacht door de SW) en een terugrol blijven zo werken.
- **Migratie bij het lezen**, zonder dat er iets geschreven wordt. Dit staat in `voorraadRegel` (`public/js/kern/voorraad-drempel.js`), gedeeld door client en server:
  - **geen regel** (product nooit in de wagen) → geen melding;
  - **een getal** (oudste vorm) → grens 0;
  - **een object zonder `drempel`** → grens 0, tenzij `gedempt`, dan geen melding.

  Wat iemand al in de wagen had, blijft dus op 0 melden zoals vroeger. Al het andere is stil.
- **POST `mutatie`** aanvaardt `drempel`. Een oudere client stuurt enkel `gedempt`:
  - `gedempt: true` zet `drempel: null`;
  - `gedempt: false` zet de bestaande grens, of 0 als die er niet was.
- `drempel` mag niet bij `verbruik`. Een wijziging die enkel de grens raakt, schrijft geen logregel, net als vroeger een demp-wijziging.

## Toestand per product

`voorraadStatus` geeft één van vier toestanden:

| Toestand | Wanneer | Weergave |
|---|---|---|
| `uit` | `drempel` is null | gewone rij |
| `op` | `aantal <= 0` | rode rij (`inv-low`), telt rood mee |
| `bijna` | `aantal <= drempel` | oranje rij (`inv-bijna`), telt oranje mee |
| `ok` | daarboven | gewone rij; bij een grens boven 0 staat "≤ n" naast het aantal |

## Scherm

- **Bewerken.** Na het belletje staat "meld bij ≤ [n]". Dat veld is verborgen als het belletje uit staat. Belletje aan zet de grens op 0.
  Op de gsm (`html[data-apparaat="gsm"]`) zijn het belletje en het veld verborgen. Een verborgen veld behoudt zijn waarde, dus er wordt niets gewijzigd.
- **Tabcijfer** (`#cnt-inventaris`, technieker). Het telt de producten in `op` en `bijna`. Het is rood (`badge--op`) als er iets op is, anders oranje (`badge--bijna`).
  Bij "Alle technici" blijft het tellen wat het altijd telde: de openstaande aanvullingen.
- **Opstartmelding** (`meldLageVoorraadBijStart`, één keer per pagina-lading). Ze geldt voor wie een eigen Zoho-naam heeft en de rol beheerder, planner of technieker.
  Ze verschijnt 4,5 s nadat inventaris en tickets geladen zijn. Er is maar één meldingsvak, en anders duwt de opstartmelding van de tickets ze meteen weg.
- **Na een rapport.** `registreerVerbruik` geeft na een geslaagde aftrek de producten uit dat rapport die onder hun grens zitten.
  - Is de aftrek klaar vóór de rapportmelding, dan komt "⚠ Bijna op in je wagen: …" mee in dezelfde melding.
  - Is ze later klaar, dan verschijnt ze als eigen melding.
  - Een aftrek die pas later uit de wachtrij lukt, toont geen "Bijna op". Het tabcijfer en de opstartmelding vangen dat op.

## Tests

- `tests/voorraad-drempel.test.mjs`: de pure logica en de teksten.
- `tests/server-inventaris.test.mjs`:
  - de karakterisering van vóór de wijziging;
  - de grens: migratie, validatie, oudere client, verbruik behoudt de grens.
- `tests/verbruik-wachtrij.test.mjs`: `meld` geeft de uitkomst terug.
- `e2e/inventaris-drempel.spec.mjs` (`?test`):
  - kleuren en tabcijfer;
  - Bewerken op pc, tablet en gsm;
  - de opstartmelding.
- `e2e/productie/voorraad-drempel.spec.mjs`:
  - opslaan stuurt `drempel`;
  - `registreerVerbruik` geeft de lage producten van het rapport.
