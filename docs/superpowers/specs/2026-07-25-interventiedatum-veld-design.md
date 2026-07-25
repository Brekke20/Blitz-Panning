# Interventiedatum: eigen Zoho custom field i.p.v. dueDate

**Datum:** 2026-07-25
**Status:** Approved, ready for implementation plan

## Aanleiding

De app gebruikte Zoho's native `dueDate`-veld op het ticket om de geplande interventie-datum/-tijd bij te houden. Dit botst met Zoho-automatiseringsregels die zelf op `dueDate` reageren (los van deze app), met soms onvoorspelbare gevolgen. Brent heeft daarom een eigen custom field aangemaakt op het Tickets-module in Zoho Desk: **"Interventie Datum"** (Date/Time-veld, API-naam `cf_interventie_datm`), en heeft alle huidige actief-geplande tickets al manueel op dit veld ingesteld. Deze app schakelt daarom volledig over: geen enkele lees- of schrijfactie raakt Zoho's native `dueDate` nog aan.

**Vooronderzoek (bevestigd via een read-only live check, geen wijzigingen):** `cf.cf_interventie_datm` bevat exact hetzelfde ISO8601-formaat als `dueDate` altijd deed (bv. `"2026-07-28T11:00:00.000Z"`), en Zoho's API verwacht custom fields genest onder `cf` in de PATCH-body: `{"cf": {"cf_interventie_datm": "..."}}`. De bestaande DST-bewuste `new Date(...).toISOString()`-berekening (browser kent de lokale tijdzone) blijft dus ongewijzigd correct — enkel de plek waar de waarde in de PATCH-body terechtkomt verandert.

## Scope

Volledige hernoeming: het interne veld `dueDate` wordt overal `interventieDatum` (in plaats van enkel de databron om te wisselen met de oude naam te behouden) — dit is een bewuste keuze van Brent voor duidelijkheid op lange termijn, ondanks de grotere diff.

- `netlify/functions/tickets.js` — leest `cf.cf_interventie_datm` i.p.v. `t.dueDate`.
- `netlify/functions/plan.js`, `netlify/functions/plan-datum.js`, `netlify/functions/propose.js` — schrijven naar `{ cf: { cf_interventie_datm } }` i.p.v. top-level `dueDate`.
- `public/index.html` — alle ~20 referenties naar `dueDate`/`utcDueDate` hernoemd naar `interventieDatum`/`utcInterventieDatum`, plus het label "Vervaldatum" → "Interventiedatum" in het detailscherm.

**Buiten scope:** `cf_garantie_status` (apart, later te bespreken). Geen migratiescript nodig — Brent heeft alle huidige geplande tickets al manueel bijgewerkt in Zoho, dus dit is een schone snit zonder backward-compat laag.

## 1. Backend — lezen (`tickets.js`)

`mapTicket()` ([netlify/functions/tickets.js:140](netlify/functions/tickets.js:140)):
```js
interventieDatum: cf.cf_interventie_datm || null,
```
(i.p.v. `dueDate: t.dueDate || null`). Geen andere wijziging nodig in dit bestand — `cf` wordt al opgehaald voor de andere custom fields.

## 2. Backend — schrijven (`plan.js`, `plan-datum.js`, `propose.js`)

Overal waar vandaag `dueDate: <waarde>` top-level in een PATCH-body naar `${ZOHO_DESK}/tickets/${ticketId}` staat, wordt dat `cf: { cf_interventie_datm: <waarde> }`. De waarde zelf (een DST-correcte `.toISOString()`-string, client-side berekend) blijft ongewijzigd — enkel de payload-vorm verandert. `status` blijft top-level staan (ongewijzigd, geen custom field).

- **`plan.js`** ([netlify/functions/plan.js:42](netlify/functions/plan.js:42), [:59-73](netlify/functions/plan.js:59)): request-veld `utcDueDate` → `utcInterventieDatum`. Inplannen: `patch = { status: '...', cf: { cf_interventie_datm: utcInterventieDatum || `${date}T00:00:00.000Z` } }`. Uit-planning-halen: `patch = { status: 'Wachten op planning', cf: { cf_interventie_datm: '' } }`.
- **`plan-datum.js`** ([netlify/functions/plan-datum.js:42](netlify/functions/plan-datum.js:42), [:59](netlify/functions/plan-datum.js:59), [:66](netlify/functions/plan-datum.js:66)): `utcDueDate` → `utcInterventieDatum` in body-destructuring, PATCH-body, en response (`{ ok: true, interventieDatum: utcInterventieDatum }`).
- **`propose.js`** ([netlify/functions/propose.js:124](netlify/functions/propose.js:124), [:145](netlify/functions/propose.js:145), [:226-229](netlify/functions/propose.js:226), [:242](netlify/functions/propose.js:242)): `utcDueDate` → `utcInterventieDatum`, lokale variabele `dueDate` → `interventieDatum`, PATCH-body en response-body volgens hetzelfde patroon.

**Open punt — leegmaken bij uit-planning-halen:** onbevestigd of Zoho een custom Date/Time-veld met een lege string (`''`) daadwerkelijk leegmaakt, of dat `null` nodig is. Dit wordt tijdens implementatie geverifieerd met een echte test-actie op een niet-kritiek ticket, met Brents akkoord vooraf (een schrijfactie op een live Zoho-ticket testen we niet blind).

## 3. Client — hernoeming en label (`public/index.html`)

Mechanische hernoeming, geen gedragswijziging:
- Mock-tickets in testmodus ([public/index.html:1649-1658](public/index.html:1649)): `dueDate` → `interventieDatum`.
- Urgentie-score ([public/index.html:1744](public/index.html:1744), [:1746](public/index.html:1746)), `reconcilePlanning` ([:1889-1893](public/index.html:1889)), "is te laat"-check ([:2007](public/index.html:2007)), `noDueDate`-filter ([:2200](public/index.html:2200), variabele wordt `noInterventieDatum`), Route-tab groepering ([:3675](public/index.html:3675)): allemaal `t.dueDate` → `t.interventieDatum`.
- Detailscherm-rij ([public/index.html:4059](public/index.html:4059)): label `'Vervaldatum'` → `'Interventiedatum'`, en `t.dueDate` → `t.interventieDatum`.
- Voorstel versturen ([public/index.html:4402-4432](public/index.html:4402)): `utcDueDate` → `utcInterventieDatum`, request-body-key mee hernoemd, `data.dueDate` (server-response) → `data.interventieDatum`, `activeTicket.dueDate` → `activeTicket.interventieDatum`.
- `extractLocalHour()` ([public/index.html:4459-4467](public/index.html:4459)): parameternaam `dueDate` → `interventieDatum` (puur cosmetisch, geen gedragswijziging).
- Toewijzen-flow / `saveToewijzen()` ([public/index.html:4589-4614](public/index.html:4589)): `utcDueDate` → `utcInterventieDatum`, `t.dueDate` → `t.interventieDatum`.
- Reeds bestaande (nog niet gecommit) wijziging in `addTicketToDate` ([public/index.html:2096-2100](public/index.html:2096)) — van de eerdere dueDate-ISO8601-bugfix — wordt binnen deze taak vervangen door dezelfde hernoeming (niet apart teruggedraaid; gaat gewoon mee in de nieuwe naamgeving).

## Testen

- **Backend PATCH-vorm:** sandbox-test per functie met gemockte `fetch` (zoals al gedaan voor de oorspronkelijke `plan.js`-fix) — verifieert dat de PATCH-body `{ cf: { cf_interventie_datm } }` bevat, zonder een echte Zoho-aanroep te doen. `plan-datum.js` is een v2-stijl functie en draait niet onder de lokale `dev-server.mjs` (bekende, bestaande beperking) — ook hiervoor een gemockte sandbox-test.
- **Lezen:** `tickets.js` is read-only en kan veilig tegen de echte Zoho API getest worden (geen schrijfactie) om te bevestigen dat `interventieDatum` correct gevuld wordt voor tickets die al een `cf_interventie_datm`-waarde hebben.
- **Leegmaken (schrijfactie):** enige write-actie die we live moeten verifiëren — met Brents expliciete akkoord, op een aangewezen test-ticket, vóór we de wijziging naar main pushen.
- **Client:** testmodus (`?test`) in de browser om te bevestigen dat kalenderweergave, urgentie, en het detailscherm nog correct werken met de hernoemde mock-data.
