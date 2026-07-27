# Planning-export integratie (Blitz Planning → Base44) — Design

## Context

Blitz Power wil Blitz Planning koppelen aan de interne installatie-planningsapp van
een collega (gebouwd op **Base44**, een managed platform-as-a-service met eigen
TypeScript-backend, NoSQL-opslag en een ingebouwd auth/rollensysteem op basis van
Row-Level Security). Twee wensen kwamen op tafel:

1. Een gedeelde/gekoppelde login tussen beide interne tools, met rechten per gebruiker.
2. Blitz Planning's planningsdata read-only beschikbaar maken zodat de collega's app
   ze in zijn eigen agenda kan tonen.

Na overleg (zowel met Brent als, via hem, met de Claude Code-sessie aan de kant van
de collega) is besloten dit te faseren:

- **Fase 1 (dit document): enkel de planning-export.** Geen gedeelde login. Base44
  beheert zijn eigen auth diep in zijn architectuur (RLS-policies per entiteit) —
  dat omzetten naar een externe identiteitsbron (bv. Microsoft Entra ID) is een
  aparte, veel grotere wijziging aan **beide** kanten, expliciet niet nu.
- **Fase 2 (later, apart traject): gedeelde login.** Voorlopig loggen gebruikers
  gewoon apart in op beide systemen. Wordt pas opgepakt als fase 1 werkt en er
  concrete behoefte/tijd voor is.

Dit document beschrijft enkel fase 1.

## Doel

Eén nieuw, read-only endpoint in Blitz Planning dat Base44 periodiek (elke 3-5 min)
kan bevragen om alle geplande Blitz Planning-activiteit (Zoho-tickets mét
ingevulde interventiedatum, én handmatige/lokale afspraken) op te halen, in een
vast JSON-formaat, zodat de collega's app dit in zijn eigen agenda/planning kan
tonen.

## Niet-doelen (expliciet uitgesloten uit fase 1)

- Geen gedeelde login/SSO.
- Geen schrijftoegang vanuit Base44 naar Blitz Planning (enkel lezen, één richting).
- Geen webhook/push — Base44 bevraagt zelf periodiek (pull), geen wijziging aan
  bestaande mutatie-plekken in `index.html` nodig.
- Geen automatische koppeling van technieker-naam naar e-mailadres — enkel de naam
  wordt meegestuurd; e-mailmatching lossen beide teams later apart op.
- Geen velden die Blitz Planning vandaag niet bijhoudt (bv. `btw_regime`,
  `tech_opmerking_haalbaarheid`) — die komen simpelweg niet mee, geen verzonnen
  data.

## Architectuur

Eén nieuw bestand: **`netlify/functions/planning-export.js`** (classic Netlify
Functions-stijl, zodat het ook lokaal via `dev-server.mjs` te testen is — in
tegenstelling tot de v2-stijl functies die Netlify Blobs gebruiken).

Geen enkele bestaande file wijzigt. Het endpoint combineert twee al bestaande,
beproefde databronnen zonder ze te herschrijven:

1. **Zoho Desk** — dezelfde aanpak als `tickets.js` (token ophalen, tickets
   bevragen), maar gefilterd tot enkel tickets met een ingevulde
   `cf.cf_interventie_datm` (d.w.z. daadwerkelijk gepland, niet de "te plannen"-wachtrij).
2. **De `afspraken`-blob** — dezelfde Netlify Blobs-store die `afspraken.js` al
   leest/schrijft voor handmatige afspraken/installaties.

```
Base44 (elke 3-5 min)
   │  GET /api/planning-export
   │  Header: Authorization: Bearer <gedeelde sleutel>
   ▼
netlify/functions/planning-export.js
   ├── fetch Zoho tickets met cf_interventie_datm ingevuld
   ├── fetch afspraken-blob (localEvents)
   └── merge + map naar vaste JSON-vorm → response
```

## Databeveiliging

Geen gebruikersauthenticatie — dit is een machine-naar-machine-koppeling. Eén lange,
willekeurig gegenereerde sleutel (bv. via `openssl rand -hex 32`), opgeslagen als
Netlify-omgevingsvariabele `PLANNING_EXPORT_API_KEY`. Base44 stuurt die mee als
`Authorization: Bearer <sleutel>`-header. Het endpoint vergelijkt en geeft `401`
terug bij ontbrekende/foute sleutel, vóór er enige Zoho- of blob-aanroep gebeurt.

## Response-vorm

`200 OK` met een JSON-array. Elk item:

```json
{
  "id": "157486000011122009",
  "bron": "zoho",
  "ticketnummer": "3731",
  "type": "Interventie",
  "datum": "2026-08-01",
  "starttijd": "09:00",
  "eindtijd": "11:00",
  "technieker": "Roel",
  "klant": "Jan Peeters",
  "adres": "Antwerpseweg 50, 2440 Geel",
  "omschrijving": "Laadpaal offline na stroomuitval",
  "status": "Wachten op bevestiging planning"
}
```

Veldherkomst:

| Veld | Zoho-ticket | Handmatige afspraak |
|---|---|---|
| `id` | `t.id` (Zoho-ticket-id) | `ev.id` |
| `bron` | `"zoho"` | `"handmatig"` |
| `ticketnummer` | `t.number` | `null` |
| `type` | altijd `"Interventie"` — Blitz Planning kent het onderscheid Interventie/Installatie pas ná het bezoek (ingevuld in het service-rapport), niet al bij het inplannen zelf | `ev.type` |
| `datum` | uit `cf_interventie_datm` | `ev.datum` |
| `starttijd` | uit `cf_interventie_datm` (lokale tijd) — **behalve** wanneer die op lokale middernacht (00:00) valt: dat is de sentinel die `addTicketToDate()` in `index.html` schrijft voor "wel datum, nog geen uur" (kalender/autoplan-pad), en dan is `starttijd` (net als `eindtijd`) `null`, consistent met hoe `extractLocalHour()` diezelfde waarde leest | `ev.uur` |
| `eindtijd` | `starttijd + duurVoor(ticketId)` (of `settings.duurMinuten` als er geen override is); `null` bij de middernacht-sentinel hierboven | `ev.einduur` (indien ingevuld, anders `null`) |
| `technieker` | `t.assignee` | `ev.persoon` |
| `klant` | `t.account \|\| t.naamEindklant` | `ev.notitie` (beste beschikbare aanduiding) |
| `adres` | `t.address` | `ev.adres` |
| `omschrijving` | `t.subject` | `ev.titel` |
| `status` | Zoho-status (bv. `"Wachten op bevestiging planning"`) | `"gepland"` (vaste waarde, handmatige afspraken hebben geen Zoho-status) |

**Bewust niet meegestuurd** (bestaat niet in Blitz Planning's datamodel):
`btw_regime`, `situation`, `tech_opmerking_haalbaarheid`, `installateur_email`.

## Reikwijdte van de data

Alle items met `datum >= gisteren` (kleine marge voor tijdzone-randgevallen), geen
kunstmatige bovengrens in de tijd — gewoon alles wat effectief gepland staat. Reeds
lang afgewerkte/verlopen interventies (van meer dan een dag geleden) worden niet
meegestuurd, om de lijst niet onnodig te laten aangroeien bij elke poll.

## Foutafhandeling

- Ontbrekende/foute API-sleutel → `401`, geen verdere verwerking.
- Zoho-aanroep faalt (token, rate limit, ticket-ophalen) → `500` met een duidelijke
  foutmelding in de body (zelfde conventie als recent toegepast in `tickets.js` —
  nooit stil een lege/gedeeltelijke lijst als succes voorstellen).
- Blob-aanroep voor `afspraken` faalt → `500`, zelfde reden.
- Niets gepland (lege resultaten, geen fout) → normale `200` met een lege array —
  dit is een geldige toestand, geen foutgeval.

## Verificatie (geen testframework in dit project — bestaande conventie)

- Lokaal: `node dev-server.mjs`, curl met en zonder correcte `Authorization`-header,
  bevestig `401`/`200`, bevestig veldstructuur tegen echte data van testticket #3731.
- Live tegen Zoho: controleer dat enkel tickets mét een ingevulde interventiedatum
  verschijnen (niet de "te plannen"-wachtrij).
- Cross-check met Base44: eerste succesvolle poll vanuit Base44 zelf, samen met de
  collega, om te bevestigen dat de veldmapping in de praktijk klopt.

## Openstaande vervolgpunten (niet in fase 1, wel genoteerd)

- **Technieker-e-mail-matching**: momenteel enkel naam. Als beide teams later exact
  dezelfde e-mailadressen per technieker willen afspreken, kan dit veld er in een
  latere iteratie bijkomen (opzoeken via Zoho's `/agents`-endpoint per naam).
- **Gedeelde login (fase 2)**: apart traject, pas op te starten na fase 1 en een
  aparte brainstorm/spec-cyclus — Base44's RLS-gebaseerde auth omzetten naar een
  externe identiteitsbron is een aanzienlijke ingreep aan zijn kant.
- **Push i.p.v. pull**: bewust uitgesteld; kan later alsnog, als 3-5 minuten
  vertraging in de praktijk te traag blijkt.
